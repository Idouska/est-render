import cookie from '@fastify/cookie';
import Fastify, { type FastifyError } from 'fastify';
import { env } from './config/env.ts';
import { logger } from './lib/logger.ts';
import { prisma } from './lib/prisma.ts';
import { googleAuthRoutes } from './routes/auth.google.ts';
import { shopifyAuthRoutes } from './routes/auth.shopify.ts';
import { refundRoutes } from './routes/refunds.ts';
import { ticketRoutes } from './routes/tickets.ts';
import { gmailWebhookRoutes } from './routes/webhooks.gmail.ts';

declare module 'fastify' {
  interface FastifyRequest {
    rawBody?: string;
  }
}

export async function buildServer() {
  const app = Fastify({ loggerInstance: logger, trustProxy: true });

  await app.register(cookie);

  // Le corps brut est nécessaire pour vérifier le HMAC des webhooks Shopify :
  // toute re-sérialisation JSON change les octets et casse la signature.
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'string' },
    (request, body, done) => {
      const raw = typeof body === 'string' ? body : body.toString('utf8');
      request.rawBody = raw;
      try {
        done(null, raw.length === 0 ? {} : JSON.parse(raw));
      } catch (error) {
        done(error as Error, undefined);
      }
    },
  );

  app.get('/health', async () => {
    await prisma.$queryRaw`SELECT 1`;
    return { status: 'ok' };
  });

  await app.register(shopifyAuthRoutes);
  await app.register(googleAuthRoutes);
  await app.register(gmailWebhookRoutes);
  await app.register(ticketRoutes);
  await app.register(refundRoutes);

  app.setErrorHandler((error: FastifyError, request, reply) => {
    request.log.error({ err: error }, 'Erreur non gérée');
    const status = error.statusCode ?? 500;
    void reply.code(status).send({
      error: status >= 500 ? 'Erreur interne' : error.message,
    });
  });

  return app;
}

export async function startServer() {
  const app = await buildServer();
  await app.listen({ port: env.PORT, host: '0.0.0.0' });
  return app;
}
