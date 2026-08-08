import { logger } from '../../lib/logger.ts';
import { prisma } from '../../lib/prisma.ts';
import { deleteReplyDraft } from '../gmail/drafts.ts';

/**
 * Écarte les brouillons en attente d'un ticket — dans Gmail et dans la base.
 *
 * C'est la moitié manquante du cycle de vie : `processTicket` créait un
 * brouillon Gmail à chaque passage, mais aucun geste — retraitement, clôture,
 * suppression — ne retirait le précédent. La boîte du marchand a fini avec
 * plus de deux mille brouillons orphelins.
 *
 * Retourne le nombre de brouillons écartés. Les échecs Gmail non-404 sont
 * journalisés mais n'empêchent pas le marquage DISCARDED : mieux vaut un
 * brouillon fantôme dans Gmail qu'un ticket bloqué.
 */
export async function discardPendingDrafts(
  merchantId: string,
  ticketId: string,
): Promise<number> {
  const stale = await prisma.draft.findMany({
    where: {
      merchantId,
      ticketId,
      status: { in: ['PENDING_REVIEW', 'EDITED'] },
    },
    select: { id: true, gmailDraftId: true, ticket: { select: { mailboxId: true } } },
  });

  if (stale.length === 0) return 0;

  for (const draft of stale) {
    if (draft.gmailDraftId) {
      try {
        await deleteReplyDraft(merchantId, draft.gmailDraftId, draft.ticket?.mailboxId);
      } catch (error) {
        logger.warn({ ticketId, draftId: draft.id, err: error }, 'Brouillon Gmail non supprimé');
      }
    }
  }

  await prisma.draft.updateMany({
    where: { id: { in: stale.map((draft) => draft.id) } },
    data: { status: 'DISCARDED' },
  });

  return stale.length;
}
