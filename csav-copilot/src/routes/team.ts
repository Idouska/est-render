import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { env } from '../config/env.ts';
import { recordAudit } from '../lib/audit.ts';
import { logger } from '../lib/logger.ts';
import { signLoginToken, verifyLoginToken } from '../lib/loginToken.ts';
import { prisma } from '../lib/prisma.ts';
import { SESSION_COOKIE, signSession } from '../lib/session.ts';
import { requirePermission, requireSession } from '../plugins/auth.ts';
import { sendPlainEmail } from '../services/gmail/send.ts';

/**
 * Équipe et connexion nominative.
 *
 * Avant, une seule identité existait : le propriétaire créé à l'installation
 * Shopify, et la session valait pour la boutique entière. Tout le journal
 * d'audit portait donc le même nom, ce qui le rendait décoratif.
 */

const inviteBody = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(120).optional(),
  role: z.enum(['OWNER', 'SUPERVISOR', 'AGENT', 'VIEWER']).default('AGENT'),
});

const updateBody = z.object({
  name: z.string().min(1).max(120).nullish(),
  role: z.enum(['OWNER', 'SUPERVISOR', 'AGENT', 'VIEWER']).optional(),
  active: z.boolean().optional(),
});

const ROLE_LABELS: Record<string, string> = {
  OWNER: 'Propriétaire',
  SUPERVISOR: 'Superviseur',
  AGENT: 'Agent',
  VIEWER: 'Lecture seule',
};

function inviteEmail(params: { merchantName: string; role: string; url: string }): string {
  return [
    `Vous avez été invité à rejoindre le service après-vente de ${params.merchantName}.`,
    '',
    `Votre rôle : ${ROLE_LABELS[params.role] ?? params.role}.`,
    '',
    'Ouvrez ce lien pour accéder au tableau de bord :',
    params.url,
    '',
    'Ce lien est valable 7 jours et ne fonctionne que pour votre adresse.',
  ].join('\n');
}

function loginEmail(params: { merchantName: string; url: string }): string {
  return [
    `Voici votre lien de connexion au service après-vente de ${params.merchantName} :`,
    '',
    params.url,
    '',
    'Il expire dans 30 minutes. Si vous n’êtes pas à l’origine de cette demande,',
    'ignorez ce message — personne ne peut se connecter sans ce lien.',
  ].join('\n');
}

/**
 * Envoie le lien et dit si l'envoi a réellement abouti.
 *
 * L'envoi passe par la boîte Gmail du marchand. Tant qu'elle n'est pas
 * connectée, aucun mail ne part — on renvoie alors le lien à l'écran pour que
 * le propriétaire le transmette lui-même, plutôt que de laisser croire à une
 * invitation envoyée qui n'arrivera jamais.
 */
async function deliverLink(params: {
  merchantId: string;
  to: string;
  subject: string;
  body: string;
}): Promise<boolean> {
  try {
    await sendPlainEmail(params);
    return true;
  } catch (error) {
    logger.warn({ err: error, to: params.to }, 'Envoi du lien de connexion impossible');
    return false;
  }
}

export async function teamRoutes(app: FastifyInstance): Promise<void> {
  /* ------------------------------------------------- connexion nominative */

  // Ouvert sans session : c'est précisément la porte d'entrée.
  app.get<{ Querystring: { token?: string } }>('/auth/link', async (request, reply) => {
    const payload = verifyLoginToken(request.query.token);

    if (!payload) {
      return reply
        .code(400)
        .type('text/html; charset=utf-8')
        .send(
          '<p style="font:16px system-ui;padding:40px">Ce lien a expiré ou n’est pas valide. Demandez-en un nouveau depuis la page de connexion.</p>',
        );
    }

    const user = await prisma.user.findFirst({
      where: { id: payload.userId, merchantId: payload.merchantId },
      select: { id: true, merchantId: true, active: true },
    });

    if (!user || !user.active) {
      return reply
        .code(403)
        .type('text/html; charset=utf-8')
        .send('<p style="font:16px system-ui;padding:40px">Ce compte est désactivé.</p>');
    }

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
      action: payload.kind === 'invite' ? 'user.joined' : 'user.logged_in',
      ipAddress: request.ip,
    });

    return reply.redirect('/dashboard');
  });

  /**
   * Demande de lien de connexion.
   *
   * Répond toujours la même chose, compte existant ou non : sinon l'endpoint
   * devient un moyen de tester si telle adresse travaille chez tel marchand.
   */
  app.post('/api/auth/request-link', async (request, reply) => {
    const parsed = z.object({ email: z.string().email() }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Adresse email invalide' });

    const user = await prisma.user.findFirst({
      where: { email: parsed.data.email.toLowerCase(), active: true },
      include: { merchant: { select: { id: true, name: true, shopDomain: true } } },
    });

    if (user) {
      const token = signLoginToken({ userId: user.id, merchantId: user.merchantId, kind: 'login' });
      await deliverLink({
        merchantId: user.merchantId,
        to: user.email,
        subject: 'Votre lien de connexion',
        body: loginEmail({
          merchantName: user.merchant.name ?? user.merchant.shopDomain,
          url: `${env.APP_URL}/auth/link?token=${token}`,
        }),
      });
    }

    return reply.send({
      ok: true,
      message: 'Si un compte existe pour cette adresse, un lien vient d’être envoyé.',
    });
  });

  app.post('/api/auth/logout', async (request, reply) => {
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return reply.send({ ok: true });
  });

  /* --------------------------------------------------- gestion de l'équipe */

  app.register(async (scoped) => {
    scoped.addHook('preHandler', requireSession);

    // Lisible par tout le monde : savoir qui d'autre traite les tickets fait
    // partie du travail. Seules les modifications sont réservées.
    scoped.get('/api/team', async (request, reply) => {
      const users = await prisma.user.findMany({
        where: { merchantId: request.session.merchantId },
        orderBy: [{ active: 'desc' }, { createdAt: 'asc' }],
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          active: true,
          createdAt: true,
          invitedAt: true,
          lastLoginAt: true,
        },
      });

      return reply.send({ users, me: { id: request.session.userId, role: request.session.role } });
    });

    scoped.post(
      '/api/team',
      { preHandler: requirePermission('manageTeam') },
      async (request, reply) => {
        const parsed = inviteBody.safeParse(request.body);
        if (!parsed.success) {
          return reply.code(400).send({ error: 'Requête invalide', details: parsed.error.issues });
        }

        const { merchantId, userId } = request.session;
        const email = parsed.data.email.toLowerCase();

        const existing = await prisma.user.findUnique({
          where: { merchantId_email: { merchantId, email } },
        });
        if (existing) {
          return reply.code(409).send({ error: 'Cette adresse fait déjà partie de l’équipe.' });
        }

        const merchant = await prisma.merchant.findUniqueOrThrow({
          where: { id: merchantId },
          select: { name: true, shopDomain: true },
        });

        const user = await prisma.user.create({
          data: {
            merchantId,
            email,
            name: parsed.data.name ?? null,
            role: parsed.data.role,
            invitedAt: new Date(),
          },
        });

        const token = signLoginToken({ userId: user.id, merchantId, kind: 'invite' });
        const url = `${env.APP_URL}/auth/link?token=${token}`;
        const sent = await deliverLink({
          merchantId,
          to: email,
          subject: `Invitation au SAV de ${merchant.name ?? merchant.shopDomain}`,
          body: inviteEmail({
            merchantName: merchant.name ?? merchant.shopDomain,
            role: parsed.data.role,
            url,
          }),
        });

        await recordAudit({
          merchantId,
          actorType: 'USER',
          actorId: userId,
          action: 'user.invited',
          targetType: 'User',
          targetId: user.id,
          metadata: { email, role: parsed.data.role, emailSent: sent },
          ipAddress: request.ip,
        });

        // Le lien n'est renvoyé que si le mail n'est pas parti : sinon on
        // afficherait sans raison un jeton de connexion à l'écran.
        return reply.send({ user, emailSent: sent, inviteUrl: sent ? null : url });
      },
    );

    scoped.patch<{ Params: { id: string } }>(
      '/api/team/:id',
      { preHandler: requirePermission('manageTeam') },
      async (request, reply) => {
        const parsed = updateBody.safeParse(request.body);
        if (!parsed.success) {
          return reply.code(400).send({ error: 'Requête invalide', details: parsed.error.issues });
        }

        const { merchantId, userId } = request.session;

        const target = await prisma.user.findFirst({
          where: { id: request.params.id, merchantId },
        });
        if (!target) return reply.code(404).send({ error: 'Utilisateur introuvable' });

        // Se retirer soi-même le rôle propriétaire ou se désactiver ferme la
        // porte de l'intérieur : plus personne ne peut gérer l'équipe.
        if (target.id === userId && (parsed.data.role !== undefined || parsed.data.active === false)) {
          return reply.code(409).send({
            error: 'Vous ne pouvez pas modifier votre propre rôle ni désactiver votre compte.',
          });
        }

        if (target.role === 'OWNER' && parsed.data.role && parsed.data.role !== 'OWNER') {
          const owners = await prisma.user.count({
            where: { merchantId, role: 'OWNER', active: true },
          });
          if (owners <= 1) {
            return reply.code(409).send({ error: 'Il doit rester au moins un propriétaire actif.' });
          }
        }

        const user = await prisma.user.update({
          where: { id: target.id },
          data: parsed.data,
        });

        await recordAudit({
          merchantId,
          actorType: 'USER',
          actorId: userId,
          action: 'user.updated',
          targetType: 'User',
          targetId: user.id,
          metadata: { email: user.email, ...parsed.data },
          ipAddress: request.ip,
        });

        return reply.send({ user });
      },
    );

    /** Renvoie une invitation — le lien précédent a pu expirer ou se perdre. */
    scoped.post<{ Params: { id: string } }>(
      '/api/team/:id/invite',
      { preHandler: requirePermission('manageTeam') },
      async (request, reply) => {
        const { merchantId } = request.session;

        const [target, merchant] = await Promise.all([
          prisma.user.findFirst({ where: { id: request.params.id, merchantId } }),
          prisma.merchant.findUniqueOrThrow({
            where: { id: merchantId },
            select: { name: true, shopDomain: true },
          }),
        ]);

        if (!target) return reply.code(404).send({ error: 'Utilisateur introuvable' });
        if (!target.active) return reply.code(409).send({ error: 'Ce compte est désactivé.' });

        const token = signLoginToken({ userId: target.id, merchantId, kind: 'invite' });
        const url = `${env.APP_URL}/auth/link?token=${token}`;
        const sent = await deliverLink({
          merchantId,
          to: target.email,
          subject: `Invitation au SAV de ${merchant.name ?? merchant.shopDomain}`,
          body: inviteEmail({
            merchantName: merchant.name ?? merchant.shopDomain,
            role: target.role,
            url,
          }),
        });

        await prisma.user.update({ where: { id: target.id }, data: { invitedAt: new Date() } });

        return reply.send({ emailSent: sent, inviteUrl: sent ? null : url });
      },
    );
  });
}
