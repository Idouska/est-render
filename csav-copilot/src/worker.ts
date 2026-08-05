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
  {
    connection,
    // Faible concurrence : chaque job consomme des appels d'IA + Shopify.
    concurrency: 3,
    /*
     * Débit plafonné, en plus de la concurrence.
     *
     * Un rattrapage de trois mois met des milliers de tickets en file d'un
     * seul coup. Sans limite de cadence, le worker les enchaîne aussi vite que
     * le réseau le permet et se fait couper par le fournisseur d'IA pour
     * dépassement de quota — les jobs échouent alors en masse, retentent, et
     * aggravent ce qu'ils subissent.
     *
     * Trente par minute laisse un gros rattrapage se déverser en quelques
     * heures sans jamais franchir la limite de personne, et n'a aucun effet
     * perceptible sur le trafic normal — un SAV reçoit rarement trente mails
     * dans la même minute.
     */
    limiter: { max: 30, duration: 60_000 },
  },
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
