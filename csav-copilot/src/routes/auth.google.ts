import { randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { google, type Auth } from 'googleapis';
import { env } from '../config/env.ts';
import { recordAudit } from '../lib/audit.ts';
import { encryptSecret, safeEqual } from '../lib/crypto.ts';
import { logger } from '../lib/logger.ts';
import { prisma } from '../lib/prisma.ts';
import { SESSION_COOKIE, signSession, verifySession } from '../lib/session.ts';
import { requireSession } from '../plugins/auth.ts';
import { createOAuthClient } from '../services/gmail/client.ts';
import { startWatch } from '../services/gmail/watch.ts';
import { requireCredential } from '../services/platform/credentials.ts';
import { boutiqueDemo } from '../services/modeTest.ts';

const STATE_COOKIE = 'csav_google_state';
const LOGIN_COOKIE = 'csav_google_login';

/*
 * « Se connecter avec Google ».
 *
 * Le lien par mail reste la porte d'entrée par défaut ; celle-ci évite
 * d'attendre le mail. Elle passe par la même appli Google que la connexion
 * des boîtes Gmail et par la même adresse de retour — aucune adresse de plus
 * à déclarer chez Google — mais ne demande que l'identité (`openid email`),
 * jamais l'accès au courrier. Un cookie d'état à part dit au retour qu'il
 * s'agit d'une connexion, pas d'un branchement de boîte.
 *
 * Elle n'ouvre que ce qui existe déjà : un compte actif portant l'adresse
 * vérifiée par Google. Pas de création de compte ici.
 */
const estConnexion = (request: FastifyRequest) => {
  const attendu = request.cookies[LOGIN_COOKIE];
  const recu = (request.query as { state?: string }).state;
  return Boolean(attendu && recu && safeEqual(recu, attendu));
};

type RaisonConnexion = 'refuse' | 'echec' | 'inconnu';
const retourConnexion = (reply: FastifyReply, raison: RaisonConnexion) => reply.redirect(`/login?google=${raison}`);

async function connexionGoogle(
  request: FastifyRequest<{ Querystring: { code?: string; state?: string; error?: string } }>,
  reply: FastifyReply,
) {
  reply.clearCookie(LOGIN_COOKIE, { path: '/' });
  const { code, error } = request.query;
  if (error || !code) return retourConnexion(reply, 'refuse');

  let email: string;
  try {
    const auth = await createOAuthClient();
    const { tokens } = await auth.getToken(code);
    if (!tokens.id_token) return retourConnexion(reply, 'echec');
    const ticket = await auth.verifyIdToken({
      idToken: tokens.id_token,
      audience: await requireCredential('GOOGLE_CLIENT_ID', 'Nécessaire pour se connecter avec Google.'),
    });
    const identite = ticket.getPayload();
    // Une adresse que Google n'a pas vérifiée ne prouve rien.
    if (!identite?.email || !identite.email_verified) return retourConnexion(reply, 'echec');
    email = identite.email.toLowerCase();
  } catch (err) {
    logger.warn({ err }, 'Connexion Google en échec');
    return retourConnexion(reply, 'echec');
  }

  // La boutique de la dernière connexion, comme le lien par mail : les autres
  // sont à un clic dans le sélecteur.
  const user = await prisma.user.findFirst({
    where: { email, active: true },
    orderBy: [{ lastLoginAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'asc' }],
    select: { id: true, merchantId: true },
  });
  if (!user) return retourConnexion(reply, 'inconnu');

  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  reply.setCookie(SESSION_COOKIE, signSession({ merchantId: user.merchantId, userId: user.id }), {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
  });
  await recordAudit({
    merchantId: user.merchantId,
    actorType: 'USER',
    actorId: user.id,
    action: 'user.logged_in',
    metadata: { methode: 'google' },
    ipAddress: request.ip,
  });
  return reply.redirect('/dashboard');
}

/*
 * Un refus ou un échec ramène dans l'outil, avec sa raison.
 *
 * Le retour de Google répondait par du JSON brut : une page noire, « {"error":
 * "Autorisation Google refusée : access_denied"} », sans lien pour revenir.
 * C'est pourtant le cas le plus courant — on clique « Annuler » ou « Retour à
 * la sécurité » sur l'écran de Google. Le marchand retrouve maintenant ses
 * Réglages et une phrase qui dit quoi faire (`retourGmail` dans app.js).
 */
type RaisonGmail = 'refuse' | 'etat' | 'jeton' | 'echec';

const retourGmail = (reply: FastifyReply, raison: RaisonGmail) =>
  reply.redirect(`/dashboard?gmail=${raison}`);

/* Sans session — expirée pendant qu'on était chez Google, ou perdue avec une
   fenêtre de navigation privée — le retour renvoie à la connexion plutôt qu'à
   la même page noire, « Session absente ou expirée ». */
async function sessionOuConnexion(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!verifySession(request.cookies[SESSION_COOKIE])) {
    await reply.redirect('/login');
    return;
  }
  await requireSession(request, reply);
}

export async function googleAuthRoutes(app: FastifyInstance): Promise<void> {
  // Ouvert sans session : c'est une porte d'entrée.
  app.get('/auth/google/login', async (_request, reply) => {
    const state = randomBytes(24).toString('hex');
    reply.setCookie(LOGIN_COOKIE, state, {
      httpOnly: true,
      secure: env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 600,
    });
    const client = await createOAuthClient();
    return reply.redirect(
      client.generateAuthUrl({ scope: ['openid', 'email'], prompt: 'select_account', state }),
    );
  });

  app.get('/auth/google', { preHandler: requireSession }, async (request, reply) => {
    // Une boîte réelle n'a rien à faire dans la boutique de démonstration :
    // ses mails s'y mêleraient aux mails fictifs, sous les yeux des visiteurs.
    if (await boutiqueDemo(request.session.merchantId)) {
      return reply.code(403).type('text/plain; charset=utf-8').send('Boutique de démonstration : aucune boîte Gmail ne s’y branche.');
    }
    const state = randomBytes(24).toString('hex');

    reply.setCookie(STATE_COOKIE, state, {
      httpOnly: true,
      secure: env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 600,
    });

    const client = await createOAuthClient();

    const url = client.generateAuthUrl({
      access_type: 'offline',
      scope: env.GOOGLE_SCOPES,
      // `consent` force la délivrance d'un refresh token, y compris lors d'une
      // reconnexion — sans ça, Google n'en renvoie qu'à la première autorisation.
      prompt: 'consent',
      include_granted_scopes: true,
      state,
    });

    return reply.redirect(url);
  });

  app.get<{ Querystring: { code?: string; state?: string; error?: string } }>(
    '/auth/google/callback',
    {
      // Une connexion arrive par définition sans session : seule la pose
      // d'une boîte Gmail en exige une.
      preHandler: async (request, reply) => {
        if (!estConnexion(request)) await sessionOuConnexion(request, reply);
      },
    },
    async (request, reply) => {
      if (estConnexion(request)) return connexionGoogle(request, reply);
      const { merchantId, userId } = request.session;
      const { code, state, error } = request.query;

      if (error) {
        logger.warn({ merchantId, error }, 'Autorisation Google refusée');
        return retourGmail(reply, 'refuse');
      }

      // Un état absent ou différent : la page de Google a été ouverte trop
      // longtemps (dix minutes), dans un autre onglet, ou le lien a été rejoué.
      const expectedState = request.cookies[STATE_COOKIE];
      if (!code || !state || !expectedState || !safeEqual(state, expectedState)) {
        return retourGmail(reply, 'etat');
      }

      reply.clearCookie(STATE_COOKIE, { path: '/' });

      const auth = await createOAuthClient();
      let tokens: Auth.Credentials;
      let profile: { emailAddress?: string | null; historyId?: string | null };
      try {
        ({ tokens } = await auth.getToken(code));

        // Sans jeton durable, la boîte se déconnecterait d'elle-même dans
        // l'heure : Google n'en redonne qu'après qu'on lui a retiré l'accès.
        if (!tokens.refresh_token) return retourGmail(reply, 'jeton');

        auth.setCredentials(tokens);
        ({ data: profile } = await google.gmail({ version: 'v1', auth }).users.getProfile({ userId: 'me' }));
      } catch (err) {
        logger.error({ merchantId, err }, 'Échange du code Google en échec');
        return retourGmail(reply, 'echec');
      }

      if (!profile.emailAddress) {
        return retourGmail(reply, 'echec');
      }

      // La première boîte connectée devient celle par défaut : sans elle, un
      // message écrit hors ticket ne saurait pas d'où partir.
      const existing = await prisma.gmailConnection.count({ where: { merchantId } });

      // Clé (marchand, adresse) : reconnecter la même boîte la met à jour,
      // en connecter une autre l'ajoute au lieu de remplacer la première.
      const connection = await prisma.gmailConnection.upsert({
        where: {
          merchantId_emailAddress: { merchantId, emailAddress: profile.emailAddress },
        },
        create: {
          merchantId,
          emailAddress: profile.emailAddress,
          isDefault: existing === 0,
          refreshTokenEnc: encryptSecret(tokens.refresh_token),
          accessTokenEnc: tokens.access_token ? encryptSecret(tokens.access_token) : null,
          accessTokenExpiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
          lastHistoryId: profile.historyId ?? null,
          scopes: tokens.scope ?? null,
        },
        update: {
          scopes: tokens.scope ?? null,
          refreshTokenEnc: encryptSecret(tokens.refresh_token),
          accessTokenEnc: tokens.access_token ? encryptSecret(tokens.access_token) : null,
          accessTokenExpiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
        },
        select: { id: true },
      });

      try {
        await startWatch(merchantId, connection.id);
      } catch (watchError) {
        // Pas bloquant : le polling de secours prend le relais.
        logger.error({ merchantId, err: watchError }, 'Activation du watch Gmail en échec');
      }

      await recordAudit({
        merchantId,
        actorType: 'USER',
        actorId: userId,
        action: 'gmail.connected',
        metadata: { emailAddress: profile.emailAddress },
        ipAddress: request.ip,
      });

      return reply.redirect('/dashboard?gmail=connecte');
    },
  );

  // Droit de retrait : le marchand coupe l'accès sans désinstaller l'app.
  app.post('/auth/google/disconnect', { preHandler: requireSession }, async (request, reply) => {
    const { merchantId, userId } = request.session;

    await prisma.gmailConnection.deleteMany({ where: { merchantId } });
    await recordAudit({
      merchantId,
      actorType: 'USER',
      actorId: userId,
      action: 'gmail.disconnected',
      ipAddress: request.ip,
    });

    return reply.send({ ok: true });
  });
}
