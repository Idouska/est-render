import { logger } from '../../lib/logger.ts';
import { prisma } from '../../lib/prisma.ts';
import { getGmailClient } from './client.ts';
import { parseMessage } from './messages.ts';

/**
 * Relit le fil Gmail d'un ticket et rapatrie ce qui manque.
 *
 * L'ingestion ne ramasse que la boîte de réception : les réponses de l'équipe
 * — envoyées depuis l'outil avant ce correctif, ou tapées directement dans
 * Gmail — n'entraient jamais en base. Le « fil complet » montrait donc une
 * conversation où le client parle seul, ce qui est faux et embarrassant :
 * l'agent suivant croit le message oublié et répond une seconde fois.
 *
 * Appelée à l'ouverture d'un ticket, une fois par ticket. Le marqueur
 * `threadSyncedAt` évite de rappeler Gmail à chaque clic — y compris sur les
 * fils où l'on n'a effectivement jamais répondu, qui sinon rejoueraient
 * l'appel indéfiniment.
 *
 * Tolérante : une relecture ratée ne doit pas empêcher d'ouvrir le message.
 * Rend le nombre de messages ajoutés.
 */
export async function syncTicketThread(merchantId: string, ticketId: string): Promise<number> {
  const ticket = await prisma.ticket.findFirst({
    where: { id: ticketId, merchantId },
    select: {
      id: true,
      gmailThreadId: true,
      mailboxId: true,
      threadSyncedAt: true,
      messages: { select: { gmailMessageId: true } },
    },
  });

  if (!ticket?.gmailThreadId || ticket.threadSyncedAt) return 0;

  let added = 0;

  try {
    const { gmail, emailAddress } = await getGmailClient(merchantId, ticket.mailboxId);
    const { data: thread } = await gmail.users.threads.get({
      userId: 'me',
      id: ticket.gmailThreadId,
      format: 'full',
    });

    const known = new Set(ticket.messages.map((message) => message.gmailMessageId));

    const parsed = (thread.messages ?? [])
      .map((message) => parseMessage(message))
      .filter((message): message is NonNullable<typeof message> => message !== null)
      .filter((message) => !known.has(message.gmailMessageId))
      .sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime());

    for (const message of parsed) {
      if (!message.fromEmail || message.bodyText.trim().length === 0) continue;

      // La direction se lit de l'expéditeur : ce qui part de l'adresse de la
      // boîte est une réponse de l'équipe, le reste vient du client.
      const outbound = message.fromEmail.toLowerCase() === emailAddress.toLowerCase();

      try {
        await prisma.message.create({
          data: {
            merchantId,
            ticketId: ticket.id,
            gmailMessageId: message.gmailMessageId,
            direction: outbound ? 'OUTBOUND' : 'INBOUND',
            fromEmail: message.fromEmail,
            toEmail: outbound ? null : emailAddress,
            subject: message.subject,
            bodyText: message.bodyText,
            snippet: message.snippet,
            receivedAt: message.receivedAt,
          },
        });
        added += 1;
      } catch {
        // Course avec l'ingestion sur le même message : la clé unique tranche,
        // et c'est très bien — le message est déjà là.
      }
    }
  } catch (error) {
    logger.warn({ err: error, ticketId }, 'Relecture du fil Gmail en échec');
    // Pas de marqueur : on retentera à la prochaine ouverture, une panne
    // passagère ne doit pas priver le ticket de ses réponses pour toujours.
    return added;
  }

  await prisma.ticket.update({
    where: { id: ticket.id },
    data: { threadSyncedAt: new Date() },
  });

  return added;
}
