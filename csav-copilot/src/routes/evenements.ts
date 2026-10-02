import type { FastifyInstance } from 'fastify';
import { Redis } from 'ioredis';
import { env } from '../config/env.ts';
import { CANAL_EVENEMENTS, lireAnnonce, type TypeEvenement } from '../lib/evenements.ts';
import { logger } from '../lib/logger.ts';
import { requireSession } from '../plugins/auth.ts';

/**
 * Le fil d'événements de l'écran (Server-Sent Events).
 *
 * Un seul abonnement Redis par processus d'API, partagé par tous les écrans
 * ouverts ; chaque annonce n'est remise qu'aux écrans de SA boutique. La
 * connexion reste ouverte : un commentaire toutes les vingt-cinq secondes
 * l'empêche d'être coupée par un proxy qui la croirait morte, et le
 * navigateur se reconnecte seul après une coupure.
 */

type Ecoute = (type: TypeEvenement) => void;

const ecoutes = new Map<string, Set<Ecoute>>();
let abonnement: Redis | null = null;

function abonner(): void {
  if (abonnement) return;
  abonnement = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
  abonnement.subscribe(CANAL_EVENEMENTS).catch((error: unknown) => {
    logger.warn({ err: error }, 'Abonnement aux événements impossible : l’écran garde son tour de secours');
  });
  abonnement.on('message', (_canal, brut) => {
    const annonce = lireAnnonce(brut);
    if (!annonce) return;
    for (const ecoute of ecoutes.get(annonce.merchantId) ?? []) ecoute(annonce.type);
  });
}

export async function evenementRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/evenements', { preHandler: requireSession }, async (request, reply) => {
    const { merchantId } = request.session;
    abonner();

    reply.hijack();
    const flux = reply.raw;
    flux.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Pas de mise en tampon par un proxy : l'annonce doit passer tout de suite.
      'X-Accel-Buffering': 'no',
    });
    flux.write('retry: 5000\n\n');

    const ecoute: Ecoute = (type) => {
      flux.write(`event: ${type}\ndata: {}\n\n`);
    };
    const garde = setInterval(() => flux.write(': ping\n\n'), 25_000);

    const siennes = ecoutes.get(merchantId) ?? new Set<Ecoute>();
    siennes.add(ecoute);
    ecoutes.set(merchantId, siennes);

    request.raw.on('close', () => {
      clearInterval(garde);
      siennes.delete(ecoute);
      if (siennes.size === 0) ecoutes.delete(merchantId);
    });
  });
}
