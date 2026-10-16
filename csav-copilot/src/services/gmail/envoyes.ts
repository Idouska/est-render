import type { gmail_v1 } from 'googleapis';
import { logger } from '../../lib/logger.ts';
import { prisma } from '../../lib/prisma.ts';
import { parseMessage } from './messages.ts';

/**
 * Les réponses envoyées depuis Gmail, rapatriées dans leur conversation.
 *
 * La relève ne lit que la boîte de réception : une réponse tapée dans Gmail
 * — ou un brouillon de l'outil envoyé depuis Gmail — n'entrait dans la base
 * qu'à la première ouverture de la conversation, et plus jamais ensuite. Les
 * statistiques de l'équipe affichaient alors « — » pour la première réponse
 * et « 0 sur 275 » brouillons envoyés, alors que les réponses partaient tous
 * les jours.
 *
 * Même principe que le filet de la boîte de réception : on lit les derniers
 * messages du libellé « Envoyés », du plus récent au plus ancien, et on
 * s'arrête au premier déjà connu. Seuls ceux d'une conversation que l'outil
 * suit sont gardés — un mail perso envoyé depuis la même boîte n'a rien à
 * faire dans le SAV. Ni le curseur d'historique ni la relève des mails
 * reçus ne dépendent de ce passage : une panne ici ne retarde rien d'autre.
 */
const FILET_ENVOYES = 25;

export async function releverReponsesEnvoyees(
  merchantId: string,
  gmail: gmail_v1.Gmail,
  emailAddress: string,
): Promise<number> {
  let ajoutees = 0;
  try {
    const response = await gmail.users.messages.list({ userId: 'me', labelIds: ['SENT'], maxResults: FILET_ENVOYES });
    const recents = (response.data.messages ?? []).filter((m) => m.id && m.threadId);

    for (const { id, threadId } of recents) {
      const connu = await prisma.message.findUnique({
        where: { merchantId_gmailMessageId: { merchantId, gmailMessageId: id! } },
        select: { id: true },
      });
      // Le premier connu arrête la descente : la suite est plus ancienne.
      if (connu) break;

      const ticket = await prisma.ticket.findUnique({
        where: { merchantId_gmailThreadId: { merchantId, gmailThreadId: threadId! } },
        select: { id: true },
      });
      if (!ticket) continue;

      const { data } = await gmail.users.messages.get({ userId: 'me', id: id!, format: 'full' });
      const message = parseMessage(data);
      if (!message || message.labelIds.includes('DRAFT')) continue;
      if (message.fromEmail.toLowerCase() !== emailAddress.toLowerCase()) continue;
      if (message.bodyText.trim().length === 0) continue;

      try {
        await prisma.message.create({
          data: {
            merchantId,
            ticketId: ticket.id,
            gmailMessageId: message.gmailMessageId,
            direction: 'OUTBOUND',
            fromEmail: message.fromEmail,
            toEmail: message.toEmail,
            subject: message.subject,
            bodyText: message.bodyText,
            snippet: message.snippet,
            receivedAt: message.receivedAt,
          },
        });
        ajoutees += 1;
      } catch {
        // Course avec la relecture du fil : la clé unique tranche.
      }
    }
  } catch (error) {
    logger.warn({ merchantId, err: error }, 'Réponses envoyées depuis Gmail non rapatriées');
  }
  return ajoutees;
}
