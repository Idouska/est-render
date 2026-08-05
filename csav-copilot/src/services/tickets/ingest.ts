import { logger } from '../../lib/logger.ts';
import { prisma } from '../../lib/prisma.ts';
import { enqueueTicket } from '../../queue/index.ts';
import { fetchNewMessages, fetchRecentMessages } from '../gmail/sync.ts';

/**
 * Ingère les nouveaux mails d'un marchand : upsert du ticket (un ticket = un
 * fil Gmail), insertion du message, puis mise en file du traitement IA.
 *
 * Idempotent : un message déjà connu est ignoré silencieusement, car Pub/Sub
 * livre at-least-once.
 */
export async function ingestMerchantInbox(
  merchantId: string,
  mailboxId?: string | null,
  options: {
    /**
     * Relire la boîte sur cette profondeur au lieu de suivre le curseur.
     *
     * Réservé à la relève manuelle : c'est le seul cas où l'on veut rattraper
     * ce qui attendait avant le branchement. L'ingestion automatique reste
     * incrémentale, sous peine de relire la même fenêtre à chaque
     * notification.
     */
    backfillDays?: number;
  } = {},
): Promise<{
  ingested: number;
  ticketIds: string[];
}> {
  const messages = options.backfillDays
    ? await fetchRecentMessages(merchantId, mailboxId, options.backfillDays)
    : await fetchNewMessages(merchantId, mailboxId);
  const ticketIds = new Set<string>();
  let ingested = 0;

  for (const message of messages) {
    if (!message.fromEmail) continue;

    const ticket = await prisma.ticket.upsert({
      where: {
        merchantId_gmailThreadId: { merchantId, gmailThreadId: message.gmailThreadId },
      },
      create: {
        merchantId,
        gmailThreadId: message.gmailThreadId,
        subject: message.subject,
        customerEmail: message.fromEmail,
        customerName: message.fromName,
        status: 'NEW',
        // Mémorisée à la création : la réponse repartira de la boîte qui a
        // reçu le message, pas d'une autre.
        mailboxId: mailboxId ?? null,
        lastMessageAt: message.receivedAt,
      },
      update: {
        // Un nouveau message sur un fil déjà traité rouvre le ticket.
        status: 'NEW',
        lastMessageAt: message.receivedAt,
      },
    });

    try {
      await prisma.message.create({
        data: {
          merchantId,
          ticketId: ticket.id,
          gmailMessageId: message.gmailMessageId,
          direction: 'INBOUND',
          fromEmail: message.fromEmail,
          toEmail: message.toEmail,
          subject: message.subject,
          bodyText: message.bodyText,
          snippet: message.snippet,
          receivedAt: message.receivedAt,
          // Un client qui signale une semelle décollée joint une photo. Sans
          // elle, l'agent répond à l'aveugle et redemande ce qui est déjà là.
          attachments: {
            create: message.attachments.map((file) => ({
              merchantId,
              gmailAttachmentId: file.gmailAttachmentId,
              filename: file.filename,
              mimeType: file.mimeType,
              size: file.size,
            })),
          },
        },
      });
      ingested += 1;
      ticketIds.add(ticket.id);
    } catch (error) {
      // P2002 = violation d'unicité (merchantId, gmailMessageId) : doublon Pub/Sub.
      if ((error as { code?: string }).code === 'P2002') continue;
      throw error;
    }
  }

  // Un échec de mise en file ne doit pas emporter l'ingestion : le mail est
  // déjà en base, et le perdre pour un problème de file serait le pire des
  // deux. C'est ce qui s'est produit avec des identifiants de job invalides —
  // le ticket existait, l'erreur remontait, et l'appelant croyait tout perdu.
  for (const ticketId of ticketIds) {
    try {
      await enqueueTicket({ merchantId, ticketId });
    } catch (error) {
      logger.error({ merchantId, ticketId, err: error }, 'Mise en file du ticket impossible');
    }
  }

  logger.info({ merchantId, ingested, tickets: ticketIds.size }, 'Ingestion terminée');

  return { ingested, ticketIds: [...ticketIds] };
}
