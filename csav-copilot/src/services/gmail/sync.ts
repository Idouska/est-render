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
/**
 * Messages traités par passage.
 *
 * Sans plafond, une boîte restée longtemps sans relève rend des centaines
 * d'identifiants, chacun coûtant un appel Gmail : la requête dépasse le délai
 * du serveur et échoue au bout de plusieurs minutes, sans rien avoir ingéré.
 * Bornée, elle rend la main et le passage suivant reprend où celui-ci s'est
 * arrêté — le curseur n'avance que si tout a été traité.
 */
const MAX_PER_RUN = 60;

/**
 * Rattrape le courrier déjà présent dans la boîte.
 *
 * L'ingestion normale est incrémentale : elle ne connaît que ce qui arrive
 * après la pose du curseur, au moment du branchement. Tout ce qui attendait
 * déjà dans la boîte lui est invisible — d'où une file vide alors que le
 * diagnostic annonce du courrier manquant, chacun disant vrai de son point de
 * vue.
 *
 * Cette fonction ignore le curseur et relit la fenêtre demandée. Elle ne
 * l'avance pas non plus : le suivi incrémental doit continuer sa route sans
 * savoir qu'on est passé par là.
 */
export async function fetchRecentMessages(
  merchantId: string,
  mailboxId: string | null | undefined,
  days: number,
): Promise<ParsedMessage[]> {
  const connection = mailboxId
    ? await prisma.gmailConnection.findFirst({ where: { id: mailboxId, merchantId } })
    : await prisma.gmailConnection.findFirst({
        where: { merchantId },
        orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
      });
  if (!connection) return [];

  const { gmail } = await getGmailClient(merchantId, connection.id);

  const { data } = await gmail.users.messages.list({
    userId: 'me',
    // `-from:me` écarte ce que la boutique s'est envoyé : ce n'est pas du
    // courrier client, et le ramasser créerait des tickets sans demandeur.
    q: `newer_than:${days}d -from:me -in:spam -in:trash`,
    maxResults: MAX_PER_RUN,
  });

  const parsed: ParsedMessage[] = [];

  for (const entry of data.messages ?? []) {
    const id = entry.id;
    if (!id) continue;

    const known = await prisma.message.findUnique({
      where: { merchantId_gmailMessageId: { merchantId, gmailMessageId: id } },
      select: { id: true },
    });
    if (known) continue;

    const { data: raw } = await gmail.users.messages.get({ userId: 'me', id, format: 'full' });
    const message = parseMessage(raw);

    if (!message) continue;
    if (message.fromEmail === connection.emailAddress.toLowerCase()) continue;
    if (message.labelIds.includes('DRAFT') || message.labelIds.includes('SENT')) continue;

    parsed.push(message);
  }

  return parsed;
}

export async function fetchNewMessages(
  merchantId: string,
  mailboxId?: string | null,
): Promise<ParsedMessage[]> {
  const connection = mailboxId
    ? await prisma.gmailConnection.findFirst({ where: { id: mailboxId, merchantId } })
    : await prisma.gmailConnection.findFirst({
        where: { merchantId },
        orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
      });
  if (!connection) return [];

  const { gmail } = await getGmailClient(merchantId, connection.id);

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

  // Les identifiants arrivent du plus ancien au plus récent : tronquer par la
  // fin traite d'abord ce qui attend depuis le plus longtemps.
  const truncated = messageIds.length > MAX_PER_RUN;
  const batch = messageIds.slice(0, MAX_PER_RUN);

  const parsed: ParsedMessage[] = [];

  for (const id of batch) {
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

  // Curseur avancé seulement si le lot était complet. L'avancer après une
  // troncature sauterait définitivement le reliquat : ces messages ne
  // reviendraient dans aucun historique, et disparaîtraient sans trace.
  if (!truncated) {
    const profileHistoryId =
      newHistoryId ?? (await gmail.users.getProfile({ userId: 'me' })).data.historyId ?? null;

    if (profileHistoryId) {
      await prisma.gmailConnection.update({
        where: { id: connection.id },
        data: { lastHistoryId: profileHistoryId },
      });
    }
  } else {
    logger.info(
      { merchantId, remaining: messageIds.length - batch.length },
      'Relève tronquée, curseur inchangé',
    );
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
