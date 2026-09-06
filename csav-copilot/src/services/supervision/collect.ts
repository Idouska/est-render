import { prisma } from '../../lib/prisma.ts';
import { ingestQueue, ticketQueue } from '../../queue/index.ts';
import {
  cronIndicator,
  queueIndicator,
  watchIndicator,
  worstLevel,
  type HealthLevel,
  type Indicator,
} from './status.ts';

export interface HealthReport {
  level: HealthLevel;
  checkedAt: string;
  groups: { title: string; indicators: Indicator[] }[];
}

/**
 * Lit l'état réel et le confie aux fonctions de seuil.
 *
 * Ce relevé appartient à l'API, pas au cron, et ce n'est pas un détail : un
 * cron qui surveillerait sa propre mort n'alerterait jamais. Le surveillant
 * doit vivre dans un autre processus que le surveillé — ici le service web,
 * toujours en ligne, que l'hébergeur redémarre de lui-même.
 *
 * Aucune de ces lectures ne doit faire tomber la console : un Redis
 * injoignable est lui-même une information à afficher, pas une erreur 500 qui
 * masquerait les deux autres voyants.
 */
export async function collectHealth(now = new Date()): Promise<HealthReport> {
  const [cron, mailboxes, queues] = await Promise.all([
    lastSuccessfulCronRun(),
    activeMailboxes(),
    queueIndicators(),
  ]);

  const groups = [
    { title: 'Tâches planifiées', indicators: [cronIndicator(cron, now)] },
    {
      title: 'Écoute Gmail',
      indicators: mailboxes.length
        ? mailboxes.map((box) => watchIndicator(box.emailAddress, box.watchExpiration, now))
        : [
            {
              level: 'ok' as const,
              headline: 'Aucune boîte connectée',
              detail: 'Rien à surveiller tant qu’aucun marchand n’a autorisé Gmail.',
            },
          ],
    },
    { title: 'Files de traitement', indicators: queues },
  ];

  return {
    level: worstLevel(groups.flatMap((group) => group.indicators)),
    checkedAt: now.toISOString(),
    groups,
  };
}

/**
 * Le dernier passage réussi, toutes tâches confondues.
 *
 * Toutes confondues, parce que la question posée est « le cron tourne-t-il ? »
 * et non « telle tâche a-t-elle réussi ? ». Une tâche qui échoue de son côté
 * remonte déjà par le code de sortie du cron, que l'hébergeur relaie.
 */
async function lastSuccessfulCronRun(): Promise<Date | null> {
  const run = await prisma.cronRun.findFirst({
    where: { ok: true },
    orderBy: { ranAt: 'desc' },
    select: { ranAt: true },
  });

  return run?.ranAt ?? null;
}

/** Seules les boîtes des marchands actifs : les autres n'ont pas à alerter. */
async function activeMailboxes() {
  return prisma.gmailConnection.findMany({
    where: { merchant: { status: 'ACTIVE' } },
    orderBy: { emailAddress: 'asc' },
    select: { emailAddress: true, watchExpiration: true },
  });
}

async function queueIndicators(): Promise<Indicator[]> {
  const queues = [
    { name: 'Ingestion Gmail', queue: ingestQueue },
    { name: 'Traitement des messages', queue: ticketQueue },
  ];

  return Promise.all(
    queues.map(async ({ name, queue }) => {
      try {
        const counts = await queue.getJobCounts('waiting', 'active', 'completed', 'failed');

        return queueIndicator(name, {
          waiting: counts.waiting ?? 0,
          active: counts.active ?? 0,
          completed: counts.completed ?? 0,
          failed: counts.failed ?? 0,
        });
      } catch (error) {
        // Redis injoignable : c'est un diagnostic, pas une panne de la console.
        return {
          level: 'down' as const,
          headline: `${name} : file injoignable`,
          detail: error instanceof Error ? error.message : String(error),
        };
      }
    }),
  );
}
