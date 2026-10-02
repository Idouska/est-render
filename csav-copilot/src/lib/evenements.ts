import { Redis } from 'ioredis';
import { env } from '../config/env.ts';
import { logger } from './logger.ts';

/**
 * Prévenir l'écran qu'il y a du nouveau, sans attendre son prochain tour.
 *
 * Le mail entrait en base en quelques secondes (notification Gmail), puis
 * attendait que le tableau de bord vienne le chercher — jusqu'à vingt
 * secondes. Désormais le worker annonce chaque arrivée sur un canal Redis ;
 * l'API la relaie aux écrans ouverts de la boutique (`/api/evenements`), qui
 * se rafraîchissent aussitôt. Le tour de vingt secondes reste, en secours.
 *
 * L'annonce ne porte que le type et la boutique : aucun contenu de mail ne
 * transite par là. L'écran relit ses données par les routes habituelles, avec
 * ses droits habituels.
 */

export const CANAL_EVENEMENTS = 'csav:evenements';

export type TypeEvenement = 'tickets';

let editeur: Redis | null = null;

/** Annonce sans jamais faire échouer ce qui l'appelle : l'écran a son tour de secours. */
export async function annoncer(merchantId: string, type: TypeEvenement): Promise<void> {
  try {
    editeur ??= new Redis(env.REDIS_URL, { maxRetriesPerRequest: 2 });
    await editeur.publish(CANAL_EVENEMENTS, JSON.stringify({ merchantId, type }));
  } catch (error) {
    logger.warn({ err: error, merchantId, type }, 'Annonce à l’écran non envoyée');
  }
}

/** Lit une annonce reçue ; `null` si elle n'a pas la forme attendue. */
export function lireAnnonce(brut: string): { merchantId: string; type: TypeEvenement } | null {
  try {
    const annonce = JSON.parse(brut) as { merchantId?: unknown; type?: unknown };
    if (typeof annonce.merchantId !== 'string' || annonce.type !== 'tickets') return null;
    return { merchantId: annonce.merchantId, type: annonce.type };
  } catch {
    return null;
  }
}

export async function fermerEvenements(): Promise<void> {
  await editeur?.quit().catch(() => undefined);
  editeur = null;
}
