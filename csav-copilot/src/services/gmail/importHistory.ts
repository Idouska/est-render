import { logger } from '../../lib/logger.ts';
import { prisma } from '../../lib/prisma.ts';
import { getGmailClient } from './client.ts';
import { parseMessage } from './messages.ts';

/**
 * Import de l'historique d'une boîte, pour donner de la matière à l'IA.
 *
 * Le modèle sait écrire ; il ne sait pas comment *cette* maison répond à un
 * retard de douane ou à une demande de remboursement hors délai. Les échanges
 * déjà traités par des humains le lui apprennent — c'est le corpus que
 * `findSimilarExchanges` interroge à chaque nouveau ticket.
 *
 * Trois principes, tenus délibérément :
 *
 * 1. **Jamais automatique.** Cette fonction ne tourne que sur demande
 *    explicite, pour une boîte nommée. Une boîte personnelle connectée pour
 *    des tests ne doit jamais être aspirée parce qu'elle se trouvait là.
 * 2. **Hors statistiques.** Les tickets créés portent `isHistorical`, donc
 *    n'apparaissent ni dans la file, ni dans les compteurs, ni dans les
 *    graphiques : ils décriraient un travail que l'outil n'a pas fait.
 * 3. **Rien à répondre.** Ils naissent clos et ne sont pas mis en file de
 *    traitement : importer six mois d'archives ne doit pas déclencher six mois
 *    de brouillons.
 */

export interface HistoryImportResult {
  threadsScanned: number;
  threadsImported: number;
  messagesImported: number;
  skippedNoReply: number;
  skippedAutomated: number;
}

/**
 * Expéditeurs qui n'apprennent rien : notifications Shopify, transporteurs,
 * infolettres. Leur inclure fausserait le corpus avec du langage de robot.
 */
const AUTOMATED_MARKERS = [
  'no-reply',
  'noreply',
  'ne-pas-repondre',
  'donotreply',
  'mailer-daemon',
  'notifications@',
  'postmaster@',
];

function isAutomated(email: string): boolean {
  const address = email.toLowerCase();
  return AUTOMATED_MARKERS.some((marker) => address.includes(marker));
}

export async function importMailboxHistory(params: {
  merchantId: string;
  mailboxId: string;
  /** Profondeur d'historique, en mois. */
  months?: number;
  /** Plafond de fils traités par appel, pour borner le temps et le quota. */
  maxThreads?: number;
}): Promise<HistoryImportResult> {
  const { merchantId, mailboxId, months = 6, maxThreads = 400 } = params;

  const connection = await prisma.gmailConnection.findFirst({
    where: { id: mailboxId, merchantId },
  });
  if (!connection) {
    throw new Error(`Boîte ${mailboxId} introuvable pour le marchand ${merchantId}`);
  }

  const { gmail } = await getGmailClient(merchantId, connection.id);
  const mailboxAddress = connection.emailAddress.toLowerCase();

  const result: HistoryImportResult = {
    threadsScanned: 0,
    threadsImported: 0,
    messagesImported: 0,
    skippedNoReply: 0,
    skippedAutomated: 0,
  };

  // On ne cherche que dans les fils où l'équipe a répondu : un mail resté sans
  // réponse n'enseigne rien, et ils forment le gros d'une boîte de support.
  const query = `in:anywhere from:me newer_than:${months}m`;

  const threadIds: string[] = [];
  let pageToken: string | undefined;

  do {
    const { data } = await gmail.users.threads.list({
      userId: 'me',
      q: query,
      maxResults: 100,
      pageToken,
    });

    for (const thread of data.threads ?? []) {
      if (thread.id) threadIds.push(thread.id);
    }

    pageToken = data.nextPageToken ?? undefined;
  } while (pageToken && threadIds.length < maxThreads);

  for (const threadId of threadIds.slice(0, maxThreads)) {
    result.threadsScanned += 1;

    // Déjà connu : soit importé lors d'un passage précédent, soit ingéré
    // normalement. Dans les deux cas on ne le retouche pas — écraser un ticket
    // vivant avec sa version archivée serait une perte.
    const existing = await prisma.ticket.findUnique({
      where: { merchantId_gmailThreadId: { merchantId, gmailThreadId: threadId } },
      select: { id: true },
    });
    if (existing) continue;

    const { data: thread } = await gmail.users.threads.get({
      userId: 'me',
      id: threadId,
      format: 'full',
    });

    const parsed = (thread.messages ?? [])
      .map((message) => parseMessage(message))
      .filter((message): message is NonNullable<typeof message> => message !== null)
      .sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime());

    if (parsed.length === 0) continue;

    // La direction se lit de l'expéditeur : ce qui part de l'adresse de la
    // boîte est une réponse de l'équipe, le reste vient du client.
    const withDirection = parsed.map((message) => ({
      message,
      direction: message.fromEmail === mailboxAddress ? ('OUTBOUND' as const) : ('INBOUND' as const),
    }));

    const firstInbound = withDirection.find((entry) => entry.direction === 'INBOUND');
    const hasOutbound = withDirection.some((entry) => entry.direction === 'OUTBOUND');

    if (!firstInbound || !hasOutbound) {
      result.skippedNoReply += 1;
      continue;
    }

    if (isAutomated(firstInbound.message.fromEmail)) {
      result.skippedAutomated += 1;
      continue;
    }

    const last = withDirection[withDirection.length - 1]!.message;

    const ticket = await prisma.ticket.create({
      data: {
        merchantId,
        gmailThreadId: threadId,
        subject: firstInbound.message.subject,
        customerEmail: firstInbound.message.fromEmail,
        customerName: firstInbound.message.fromName,
        // Clos d'emblée : l'échange a eu lieu, il est fini, personne n'attend.
        status: 'CLOSED',
        isHistorical: true,
        mailboxId: connection.id,
        lastMessageAt: last.receivedAt,
      },
    });

    for (const { message, direction } of withDirection) {
      if (!message.fromEmail || message.bodyText.trim().length === 0) continue;

      try {
        await prisma.message.create({
          data: {
            merchantId,
            ticketId: ticket.id,
            gmailMessageId: message.gmailMessageId,
            direction,
            fromEmail: message.fromEmail,
            toEmail: message.toEmail,
            subject: message.subject,
            bodyText: message.bodyText,
            snippet: message.snippet,
            receivedAt: message.receivedAt,
          },
        });
        result.messagesImported += 1;
      } catch (error) {
        // P2002 : ce message appartient déjà à un autre ticket. On le laisse
        // où il est plutôt que d'échouer l'import entier pour un doublon.
        if ((error as { code?: string }).code === 'P2002') continue;
        throw error;
      }
    }

    result.threadsImported += 1;
  }

  logger.info({ merchantId, mailboxId, ...result }, 'Import historique terminé');

  return result;
}
