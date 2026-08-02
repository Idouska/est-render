/**
 * Tâches planifiées. Un passage puis sortie : à déclencher par un ordonnanceur
 * externe (tâche cron de l'hébergeur, ou `cron` système), pas par un démon.
 *
 *   node dist/cron.js            les deux tâches
 *   node dist/cron.js watch      renouvellement des watch Gmail seulement
 *   node dist/cron.js purge      purge RGPD seulement
 *
 * Fréquence conseillée : une fois par jour. Le watch Gmail expire au bout de
 * 7 jours sans lever la moindre erreur — sans cette tâche, l'ingestion s'arrête
 * en silence et personne ne le voit.
 */

import { logger } from './lib/logger.ts';
import { disconnectPrisma, prisma } from './lib/prisma.ts';
import { renewExpiringWatches } from './services/gmail/watch.ts';

/**
 * Purge RGPD : supprime les messages et brouillons au-delà de la durée de
 * conservation du marchand, puis anonymise les tickets correspondants.
 *
 * Les tickets ne sont pas supprimés — leurs statistiques (intention, statut)
 * restent utiles et ne sont plus rattachables à une personne une fois l'email
 * et le nom effacés. Les entrées d'audit ne sont jamais touchées : elles
 * tracent des actions financières et relèvent d'une obligation comptable.
 */
export async function purgeExpiredData(): Promise<{
  messages: number;
  drafts: number;
  tickets: number;
}> {
  const merchants = await prisma.merchant.findMany({
    select: { id: true, retentionDays: true, shopDomain: true },
  });

  let messages = 0;
  let drafts = 0;
  let tickets = 0;

  for (const merchant of merchants) {
    const cutoff = new Date(Date.now() - merchant.retentionDays * 24 * 60 * 60 * 1000);

    const deletedMessages = await prisma.message.deleteMany({
      where: { merchantId: merchant.id, receivedAt: { lt: cutoff } },
    });

    const deletedDrafts = await prisma.draft.deleteMany({
      where: { merchantId: merchant.id, createdAt: { lt: cutoff } },
    });

    const anonymized = await prisma.ticket.updateMany({
      where: {
        merchantId: merchant.id,
        lastMessageAt: { lt: cutoff },
        customerEmail: { not: 'anonymise@supprime.local' },
      },
      data: {
        customerEmail: 'anonymise@supprime.local',
        customerName: null,
        subject: null,
      },
    });

    messages += deletedMessages.count;
    drafts += deletedDrafts.count;
    tickets += anonymized.count;

    if (deletedMessages.count + deletedDrafts.count + anonymized.count > 0) {
      await prisma.auditLog.create({
        data: {
          merchantId: merchant.id,
          actorType: 'SYSTEM',
          action: 'rgpd.purged',
          metadata: {
            retentionDays: merchant.retentionDays,
            cutoff: cutoff.toISOString(),
            messages: deletedMessages.count,
            drafts: deletedDrafts.count,
            ticketsAnonymises: anonymized.count,
          },
        },
      });
    }
  }

  return { messages, drafts, tickets };
}

async function main(): Promise<void> {
  const task = process.argv[2] ?? 'all';
  let failed = false;

  if (task === 'all' || task === 'watch') {
    try {
      const renewed = await renewExpiringWatches();
      logger.info({ renewed }, 'Watch Gmail renouvelés');
    } catch (error) {
      failed = true;
      logger.error({ err: error }, 'Renouvellement des watch Gmail en échec');
    }
  }

  if (task === 'all' || task === 'purge') {
    try {
      const purged = await purgeExpiredData();
      logger.info(purged, 'Purge RGPD effectuée');
    } catch (error) {
      failed = true;
      logger.error({ err: error }, 'Purge RGPD en échec');
    }
  }

  // Les deux tâches sont indépendantes : on tente les deux, mais un échec doit
  // ressortir en code de sortie pour que l'hébergeur alerte.
  if (failed) process.exitCode = 1;
}

await main();
await disconnectPrisma();
