import { logger } from '../../lib/logger.ts';
import { prisma } from '../../lib/prisma.ts';
import { getGmailClient } from './client.ts';
import { parseMessage, type ParsedMessage } from './messages.ts';

/**
 * Récupère les messages entrants depuis le dernier `historyId` connu.
 *
 * Si Gmail répond 404 (historyId trop ancien, > 1 semaine), on retombe sur un
 * `messages.list` borné dans le temps — le fallback polling du brief.
 */
export async function fetchNewMessages(merchantId: string): Promise<ParsedMessage[]> {
  const connection = await prisma.gmailConnection.findUnique({ where: { merchantId } });
  if (!connection) return [];

  const { gmail } = await getGmailClient(merchantId);

  let messageIds: string[] = [];
  let newHistoryId: string | null = null;

  if (connection.lastHistoryId) {
    try {
      const ids = new Set<string>();
      let pageToken: string | undefined;

      do {
        const response = await gmail.users.history.list({
          userId: 'me',
          startHistoryId: connection.lastHistoryId,
          historyTypes: ['messageAdded'],
          labelId: 'INBOX',
          pageToken,
        });

        for (const entry of response.data.history ?? []) {
          for (const added of entry.messagesAdded ?? []) {
            if (added.message?.id) ids.add(added.message.id);
          }
        }

        newHistoryId = response.data.historyId ?? newHistoryId;
        pageToken = response.data.nextPageToken ?? undefined;
      } while (pageToken);

      messageIds = [...ids];
    } catch (error) {
      const status = (error as { code?: number }).code;
      if (status !== 404) throw error;
      logger.warn({ merchantId }, 'historyId périmé, bascule sur le polling');
      messageIds = await listRecentMessageIds(gmail);
    }
  } else {
    messageIds = await listRecentMessageIds(gmail);
  }

  const parsed: ParsedMessage[] = [];

  for (const id of messageIds) {
    // On ne ré-appelle pas Gmail pour un message déjà ingéré : Pub/Sub est
    // at-least-once et rejoue régulièrement les mêmes notifications.
    const known = await prisma.message.findUnique({
      where: { merchantId_gmailMessageId: { merchantId, gmailMessageId: id } },
      select: { id: true },
    });
    if (known) continue;

    const { data } = await gmail.users.messages.get({ userId: 'me', id, format: 'full' });
    const message = parseMessage(data);

    if (!message) continue;
    // On ignore ce que le marchand a lui-même envoyé.
    if (message.fromEmail === connection.emailAddress.toLowerCase()) continue;
    if (message.labelIds.includes('DRAFT') || message.labelIds.includes('SENT')) continue;

    parsed.push(message);
  }

  const profileHistoryId =
    newHistoryId ?? (await gmail.users.getProfile({ userId: 'me' })).data.historyId ?? null;

  if (profileHistoryId) {
    await prisma.gmailConnection.update({
      where: { merchantId },
      data: { lastHistoryId: profileHistoryId },
    });
  }

  return parsed;
}

async function listRecentMessageIds(
  gmail: Awaited<ReturnType<typeof getGmailClient>>['gmail'],
): Promise<string[]> {
  const response = await gmail.users.messages.list({
    userId: 'me',
    q: 'in:inbox newer_than:2d',
    maxResults: 50,
  });
  return (response.data.messages ?? []).map((m) => m.id!).filter(Boolean);
}
