import { recordAudit } from '../../lib/audit.ts';
import { logger } from '../../lib/logger.ts';
import { prisma } from '../../lib/prisma.ts';
import { personneNEnvoie, type IssueEnvoi } from '../envoi/uneSeuleFois.ts';
import { sendDraft, sendReplyInThread } from '../gmail/drafts.ts';
import { recordOutbound } from './outbound.ts';

/**
 * Ce dont l'envoi a besoin, réuni pour qu'un test puisse le remplacer : une
 * base qui sérialise les écritures, un Gmail lent, et deux clics à la fois.
 * La route n'en passe aucun — ce sont les vrais.
 */
const DEPENDANCES = { prisma, sendDraft, sendReplyInThread, recordOutbound, recordAudit };
export type DependancesEnvoi = typeof DEPENDANCES;

/**
 * Envoie la réponse proposée — toujours déclenché par un humain en phase 1.
 *
 * La place est prise sur le brouillon avant l'appel à Gmail, et un second
 * envoi simultané repart sans rien faire : voir `services/envoi/uneSeuleFois`.
 */
export async function envoyerBrouillon(
  params: { draftId: string; merchantId: string; userId: string; ipAddress?: string | null },
  deps: DependancesEnvoi = DEPENDANCES,
): Promise<IssueEnvoi | 'introuvable'> {
  const { merchantId } = params;

  const draft = await deps.prisma.draft.findFirst({
    where: { id: params.draftId, merchantId },
    include: { ticket: true },
  });

  if (!draft) return 'introuvable';
  if (draft.status === 'SENT') return 'deja-envoye';

  // La prise. La lecture ci-dessus ne protège de rien : deux requêtes la
  // passent ensemble. Seule cette écriture, conditionnelle, départage — une
  // place, un gagnant.
  const maintenant = new Date();
  const prise = await deps.prisma.draft.updateMany({
    where: { id: draft.id, merchantId, status: { not: 'SENT' }, ...personneNEnvoie(maintenant) },
    data: { sendStartedAt: maintenant },
  });

  if (prise.count !== 1) {
    // Perdu : l'autre envoi a fini, ou il est en route. On relit pour le dire
    // juste — « déjà envoyé » et « en cours » n'appellent pas le même geste.
    const actuel = await deps.prisma.draft.findFirst({
      where: { id: draft.id, merchantId },
      select: { status: true },
    });
    return actuel?.status === 'SENT' ? 'deja-envoye' : 'en-cours';
  }

  // Deux chemins, le temps que les anciens tickets s'écoulent : un brouillon
  // Gmail hérité s'envoie tel quel — sinon il resterait dans la boîte après
  // l'envoi. Les propositions créées depuis partent directement dans le fil.
  let sent: { gmailMessageId: string | null; fromEmail: string };

  try {
    if (draft.gmailDraftId) {
      sent = await deps.sendDraft(merchantId, draft.gmailDraftId, draft.ticket.mailboxId);
    } else {
      const lastInbound = await deps.prisma.message.findFirst({
        where: { ticketId: draft.ticketId, merchantId, direction: 'INBOUND' },
        orderBy: { receivedAt: 'desc' },
        select: { gmailMessageId: true },
      });

      sent = await deps.sendReplyInThread({
        merchantId,
        mailboxId: draft.ticket.mailboxId,
        threadId: draft.ticket.gmailThreadId,
        to: draft.ticket.customerEmail,
        subject: draft.ticket.subject ?? 'Votre demande',
        body: draft.body,
        inReplyToMessageId: lastInbound?.gmailMessageId,
      });
    }
  } catch (error) {
    // Gmail a refusé : la place est rendue, un nouveau clic doit pouvoir
    // réessayer. Seulement si elle est encore la nôtre — un envoi plus lent
    // que le bail a pu la voir reprise par un autre.
    await deps.prisma.draft
      .updateMany({
        where: { id: draft.id, sendStartedAt: maintenant },
        data: { sendStartedAt: null },
      })
      .catch((liberation: unknown) =>
        logger.warn({ err: liberation, draftId: draft.id }, 'Place d’envoi non rendue : elle expirera'),
      );
    throw error;
  }

  await deps.prisma.$transaction([
    deps.prisma.draft.update({
      where: { id: draft.id },
      data: { status: 'SENT', sentAt: new Date(), sendStartedAt: null },
    }),
    deps.prisma.ticket.update({
      where: { id: draft.ticketId },
      data: { status: 'CLOSED', lastMessageAt: new Date() },
    }),
  ]);

  await deps.recordOutbound({
    merchantId,
    ticketId: draft.ticketId,
    gmailMessageId: sent.gmailMessageId,
    fromEmail: sent.fromEmail,
    toEmail: draft.ticket.customerEmail,
    subject: draft.ticket.subject,
    body: draft.body,
  });

  await deps.recordAudit({
    merchantId,
    actorType: 'USER',
    actorId: params.userId,
    action: 'draft.sent',
    targetType: 'Draft',
    targetId: draft.id,
    metadata: { ticketId: draft.ticketId },
    ipAddress: params.ipAddress ?? null,
  });

  return 'envoye';
}
