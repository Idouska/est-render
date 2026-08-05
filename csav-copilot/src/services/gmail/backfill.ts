import { logger } from '../../lib/logger.ts';
import { prisma } from '../../lib/prisma.ts';
import { enqueueTicket } from '../../queue/index.ts';
import { getGmailClient } from './client.ts';
import { loadLabelNames, resolveLabels } from './labels.ts';
import { parseMessage } from './messages.ts';

/**
 * Rattrapage profond d'une boîte : le courrier antérieur au branchement entre
 * dans la file comme de vrais tickets, à traiter.
 *
 * Distinct de l'apprentissage, qui crée des archives closes et invisibles pour
 * nourrir l'IA. Ici on veut l'inverse : du travail, visible, que l'IA doit
 * classer et pour lequel elle doit proposer une réponse.
 *
 * Distinct aussi de la relève courte, qui tient dans une requête HTTP. Trois
 * mois de courrier, c'est potentiellement des centaines de messages et autant
 * d'appels Gmail : cette fonction tourne en arrière-plan et rend compte au fur
 * et à mesure.
 */

export interface BackfillProgress {
  scanned: number;
  ingested: number;
  tickets: number;
  done: boolean;
}

/** Avancement par boîte, lisible pendant que le travail tourne. */
export const backfillProgress = new Map<string, BackfillProgress>();

export async function backfillMailbox(params: {
  merchantId: string;
  mailboxId: string;
  days: number;
  /** Plafond dur, pour ne pas transformer une erreur de saisie en facture. */
  maxMessages?: number;
}): Promise<BackfillProgress> {
  const { merchantId, mailboxId, days, maxMessages = 1500 } = params;

  const connection = await prisma.gmailConnection.findFirst({
    where: { id: mailboxId, merchantId },
  });
  if (!connection) throw new Error('Boîte introuvable');

  const { gmail } = await getGmailClient(merchantId, connection.id);
  const address = connection.emailAddress.toLowerCase();
  const labelNames = await loadLabelNames(gmail, connection.id);

  const progress: BackfillProgress = { scanned: 0, ingested: 0, tickets: 0, done: false };
  backfillProgress.set(mailboxId, progress);

  const touched = new Set<string>();
  let pageToken: string | undefined;

  try {
    do {
      const { data } = await gmail.users.messages.list({
        userId: 'me',
        // `-from:me` écarte ce que la boutique s'est envoyé : ce n'est pas une
        // demande client, et en faire un ticket créerait du travail fantôme.
        q: `in:inbox newer_than:${days}d -from:me`,
        maxResults: 100,
        pageToken,
      });

      for (const entry of data.messages ?? []) {
        if (!entry.id) continue;
        progress.scanned += 1;

        const known = await prisma.message.findUnique({
          where: { merchantId_gmailMessageId: { merchantId, gmailMessageId: entry.id } },
          select: { id: true },
        });
        if (known) continue;

        const { data: raw } = await gmail.users.messages.get({
          userId: 'me',
          id: entry.id,
          format: 'full',
        });

        const message = parseMessage(raw);
        if (!message || !message.fromEmail) continue;
        if (message.fromEmail === address) continue;
        if (message.labelIds.includes('DRAFT') || message.labelIds.includes('SENT')) continue;

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
            mailboxId: connection.id,
            labels: resolveLabels(message.labelIds, labelNames),
            lastMessageAt: message.receivedAt,
          },
          update: {
            labels: resolveLabels(message.labelIds, labelNames),
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
          progress.ingested += 1;
          touched.add(ticket.id);
        } catch (error) {
          if ((error as { code?: string }).code !== 'P2002') throw error;
        }

        if (progress.scanned >= maxMessages) break;
      }

      pageToken = data.nextPageToken ?? undefined;
    } while (pageToken && progress.scanned < maxMessages);

    // Mise en file après coup : un échec ici ne doit pas faire perdre le
    // courrier déjà enregistré.
    for (const ticketId of touched) {
      try {
        await enqueueTicket({ merchantId, ticketId });
        progress.tickets += 1;
      } catch (error) {
        logger.error({ merchantId, ticketId, err: error }, 'Mise en file impossible');
      }
    }
  } finally {
    progress.done = true;
  }

  logger.info({ merchantId, mailboxId, ...progress }, 'Rattrapage terminé');
  return progress;
}
