import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { google } from 'googleapis';
import { env } from '../config/env.ts';
import { recordAudit } from '../lib/audit.ts';
import { encryptSecret, safeEqual } from '../lib/crypto.ts';
import { logger } from '../lib/logger.ts';
import { prisma } from '../lib/prisma.ts';
import { requireSession } from '../plugins/auth.ts';
import { createOAuthClient } from '../services/gmail/client.ts';
import { startWatch } from '../services/gmail/watch.ts';

const STATE_COOKIE = 'csav_google_state';

export async function googleAuthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/auth/google', { preHandler: requireSession }, async (request, reply) => {
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
    { preHandler: requireSession },
    async (request, reply) => {
      const { merchantId, userId } = request.session;
      const { code, state, error } = request.query;

      if (error) {
        return reply.code(400).send({ error: `Autorisation Google refusée : ${error}` });
      }

      const expectedState = request.cookies[STATE_COOKIE];
      if (!code || !state || !expectedState || !safeEqual(state, expectedState)) {
        return reply.code(400).send({ error: 'State OAuth invalide' });
      }

      reply.clearCookie(STATE_COOKIE, { path: '/' });

      const auth = await createOAuthClient();
      const { tokens } = await auth.getToken(code);

      if (!tokens.refresh_token) {
        return reply.code(400).send({
          error:
            'Google n’a pas fourni de refresh token. Révoquez l’accès dans votre compte Google puis réessayez.',
        });
      }

      auth.setCredentials(tokens);
      const { data: profile } = await google
        .gmail({ version: 'v1', auth })
        .users.getProfile({ userId: 'me' });

      if (!profile.emailAddress) {
        return reply.code(502).send({ error: 'Adresse Gmail introuvable' });
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
        },
        update: {
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

      return reply.redirect('/dashboard');
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
