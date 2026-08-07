import { Queue, type JobsOptions } from 'bullmq';
import { Redis } from 'ioredis';
import { env } from '../config/env.ts';
import { ingestJobId, ticketJobId } from './ids.ts';

export { ingestJobId, ticketJobId } from './ids.ts';
export type { IngestJob, TicketJob } from './types.ts';

export const connection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });

export const QUEUE_INGEST = 'gmail-ingest';
export const QUEUE_TICKET = 'ticket-process';

import type { IngestJob, TicketJob } from './types.ts';

const defaultJobOptions: JobsOptions = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 2000 },
  removeOnComplete: { age: 86_400, count: 1000 },
  removeOnFail: { age: 7 * 86_400 },
};

export const ingestQueue = new Queue<IngestJob>(QUEUE_INGEST, {
  connection,
  defaultJobOptions,
});

export const ticketQueue = new Queue<TicketJob>(QUEUE_TICKET, {
  connection,
  defaultJobOptions,
});

/*
 * Les identifiants de job ne contiennent pas de deux-points.
 *
 * BullMQ les réserve à ses propres clés Redis et rejette la tâche avec
 * « Custom Id cannot contain : ». L'erreur remonte au moment de la mise en
 * file, donc après la création du ticket : le mail entrait bien en base, mais
 * l'IA n'était jamais saisie et le webhook Pub/Sub échouait en boucle. Une
 * panne invisible, où chaque étage semble faire son travail.
 */

/**
 * Une notification Pub/Sub par mail reçu, mais un seul job d'ingestion utile
 * par marchand : on déduplique sur une fenêtre courte via un jobId stable.
 */
export async function enqueueIngest(job: IngestJob): Promise<void> {
  const bucket = Math.floor(Date.now() / 5000);
  await ingestQueue.add('ingest', job, { jobId: ingestJobId(job, bucket) });
}

/**
 * Met un ticket en traitement.
 *
 * L'identifiant stable évite qu'un même ticket soit traité deux fois quand
 * plusieurs mails d'un même fil arrivent coup sur coup. Mais BullMQ garde la
 * tâche après son passage — un jour si elle a réussi, sept si elle a échoué —
 * et **ignore silencieusement** tout ajout portant un identifiant déjà connu.
 *
 * Conséquence observée en production : « Relancer les messages en échec »
 * répondait « 3621 remis en traitement » sans que rien ne bouge. Les tâches
 * portaient le même identifiant que celles qui avaient échoué la veille, et
 * étaient jetées à l'entrée. Le compteur d'échecs restait figé, motifs
 * périmés compris, alors que la cause avait été corrigée.
 *
 * `replace` supprime la trace de la tâche précédente avant d'ajouter la
 * nouvelle. La suppression échoue si la tâche est en cours d'exécution : c'est
 * exactement ce qu'on veut — le ticket est déjà en train d'être traité, il n'y
 * a rien à relancer.
 */
export async function enqueueTicket(
  job: TicketJob,
  options: { replace?: boolean } = {},
): Promise<void> {
  const jobId = ticketJobId(job);

  if (options.replace) {
    try {
      await ticketQueue.remove(jobId);
    } catch {
      // Tâche en cours : elle fait déjà le travail demandé.
    }
  }

  await ticketQueue.add('process', job, { jobId });
}

export async function closeQueues(): Promise<void> {
  await Promise.all([ingestQueue.close(), ticketQueue.close()]);
  await connection.quit();
}
