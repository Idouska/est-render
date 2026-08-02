import type { FastifyReply, FastifyRequest } from 'fastify';
import { SESSION_COOKIE, verifySession, type SessionPayload } from '../lib/session.ts';

declare module 'fastify' {
  interface FastifyRequest {
    session: SessionPayload;
  }
}

/**
 * Garde-fou d'isolation multi-tenant : toute route du dashboard passe par ici,
 * et le `merchantId` de toute requête vient d'ici — jamais du corps ou de l'URL.
 */
export async function requireSession(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const session = verifySession(request.cookies[SESSION_COOKIE]);

  if (!session) {
    await reply.code(401).send({ error: 'Session absente ou expirée' });
    return;
  }

  request.session = session;
}
