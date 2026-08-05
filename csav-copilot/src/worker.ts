import { Worker } from 'bullmq';
import { logger } from './lib/logger.ts';
import { disconnectPrisma } from './lib/prisma.ts';
import {
  closeQueues,
  connection,
  QUEUE_INGEST,
  QUEUE_TICKET,
  type IngestJob,
  type TicketJob,
} from './queue/index.ts';
import { ingestMerchantInbox } from './services/tickets/ingest.ts';
import { processTicket } from './services/tickets/process.ts';

const ingestWorker = new Worker<IngestJob>(
  QUEUE_INGEST,
  async (job) => {
    await ingestMerchantInbox(job.data.merchantId, job.data.mailboxId);
  },
  { connection, concurrency: 5 },
);

const ticketWorker = new Worker<TicketJob>(
  QUEUE_TICKET,
  async (job) => {
    await processTicket(job.data.merchantId, job.data.ticketId);
  },
  // Faible concurrence : chaque job consomme des appels Claude + Shopify.
  { connection, concurrency: 3 },
);

for (const worker of [ingestWorker, ticketWorker]) {
  worker.on('failed', (job, error) => {
    logger.error({ queue: worker.name, jobId: job?.id, err: error }, 'Job en échec');
  });
}

logger.info('Workers démarrés');

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'Arrêt des workers');
  await Promise.all([ingestWorker.close(), ticketWorker.close()]);
  await closeQueues();
  await disconnectPrisma();
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
