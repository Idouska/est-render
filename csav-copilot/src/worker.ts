import { Worker } from 'bullmq';
import { logger } from './lib/logger.ts';
import { disconnectPrisma } from './lib/prisma.ts';
import {
  closeQueues,
  connection,
  enqueueIngest,
  planifierEnvoiDuJour,
  QUEUE_ENVOI,
  QUEUE_INGEST,
  QUEUE_TICKET,
  type IngestJob,
  type TicketJob,
} from './queue/index.ts';
import { ingestMerchantInbox } from './services/tickets/ingest.ts';
import { processTicket } from './services/tickets/process.ts';
import { passageAutomatique } from './services/envoi/quotidien.ts';

/*
 * La relance d'une relève restée bredouille.
 *
 * Gmail n'envoie qu'UNE notification par message, et son historique n'est pas
 * complet dans la seconde : la relève déclenchée par la notification peut donc
 * ne rien trouver, et rien ne reviendra le lui dire. Sans relance, le message
 * attend qu'un autre mail arrive ou qu'un navigateur ouvre la file — des
 * minutes, parfois la nuit entière.
 *
 * Deux relances espacées de quinze secondes suffisent largement, et ne coûtent
 * que deux appels Gmail quand la notification ne concernait rien d'ingérable —
 * un libellé posé à la main, un message qu'on écarte. Bornées, pour qu'une
 * boîte bavarde ne s'auto-entretienne pas.
 */
const RELANCES_MAX = 2;
const RELANCE_APRES_MS = 15_000;

const ingestWorker = new Worker<IngestJob>(
  QUEUE_INGEST,
  async (job) => {
    const { ingested } = await ingestMerchantInbox(job.data.merchantId, job.data.mailboxId);

    const rang = job.data.relance ?? 0;
    if (ingested === 0 && rang < RELANCES_MAX) {
      await enqueueIngest({ ...job.data, relance: rang + 1 }, { delay: RELANCE_APRES_MS });
    }
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

// L'envoi automatique des commandes du jour : un passage toutes les quinze
// minutes, qui n'envoie que pour les boutiques dont l'heure est passée.
const envoiWorker = new Worker(
  QUEUE_ENVOI,
  async () => {
    await passageAutomatique();
  },
  { connection, concurrency: 1 },
);
await planifierEnvoiDuJour();

for (const worker of [ingestWorker, ticketWorker, envoiWorker]) {
  worker.on('failed', (job, error) => {
    logger.error({ queue: worker.name, jobId: job?.id, err: error }, 'Job en échec');
  });
}

logger.info('Workers démarrés');

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'Arrêt des workers');
  await Promise.all([ingestWorker.close(), ticketWorker.close(), envoiWorker.close()]);
  await closeQueues();
  await disconnectPrisma();
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
