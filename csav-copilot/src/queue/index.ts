import { Queue, type JobsOptions } from 'bullmq';
import { Redis } from 'ioredis';
import { env } from '../config/env.ts';

export const connection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });

export const QUEUE_INGEST = 'gmail-ingest';
export const QUEUE_TICKET = 'ticket-process';

export interface IngestJob {
  merchantId: string;
  /** Boîte concernée : chacune a son propre curseur d'historique Gmail. */
  mailboxId?: string;
  /** historyId annoncé par la notification Pub/Sub, à titre de trace. */
  historyId?: string;
}

export interface TicketJob {
  merchantId: string;
  ticketId: string;
}

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

/**
 * Une notification Pub/Sub par mail reçu, mais un seul job d'ingestion utile
 * par marchand : on déduplique sur une fenêtre courte via un jobId stable.
 */
export async function enqueueIngest(job: IngestJob): Promise<void> {
  const bucket = Math.floor(Date.now() / 5000);
  await ingestQueue.add('ingest', job, {
    jobId: `ingest:${job.merchantId}:${job.mailboxId ?? 'default'}:${bucket}`,
  });
}

export async function enqueueTicket(job: TicketJob): Promise<void> {
  await ticketQueue.add('process', job, { jobId: `ticket:${job.ticketId}` });
}

export async function closeQueues(): Promise<void> {
  await Promise.all([ingestQueue.close(), ticketQueue.close()]);
  await connection.quit();
}
