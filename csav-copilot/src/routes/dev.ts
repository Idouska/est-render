import type { FastifyInstance } from 'fastify';
import { env } from '../config/env.ts';
import { logger } from '../lib/logger.ts';
import { prisma } from '../lib/prisma.ts';
import { SESSION_COOKIE, signSession } from '../lib/session.ts';

/**
 * Raccourci de développement : ouvre une session sans passer par l'OAuth
 * Shopify, pour travailler l'interface avant d'avoir une vraie boutique.
 *
 * Ces routes ne sont enregistrées que hors production (cf. `server.ts`), et
 * refusent de s'exécuter si jamais elles y arrivaient quand même.
 */
export async function devRoutes(app: FastifyInstance): Promise<void> {
  const guard = (): boolean => env.NODE_ENV !== 'production';

  app.get('/dev/login', async (request, reply) => {
    if (!guard()) return reply.code(404).send();

    const merchant = await prisma.merchant.findFirst({
      where: { status: 'ACTIVE' },
      include: { users: { take: 1 } },
    });

    if (!merchant || !merchant.users[0]) {
      return reply.code(404).send({
        error: 'Aucun marchand en base. Lancez `npm run db:seed` d’abord.',
      });
    }

    reply.setCookie(
      SESSION_COOKIE,
      signSession({ merchantId: merchant.id, userId: merchant.users[0].id }),
      { httpOnly: true, secure: false, sameSite: 'lax', path: '/' },
    );

    logger.warn({ merchantId: merchant.id }, 'Session ouverte via le raccourci de développement');

    return reply.redirect('/dashboard');
  });

  app.get('/dev/logout', async (request, reply) => {
    if (!guard()) return reply.code(404).send();
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return reply.redirect('/dashboard');
  });
}
