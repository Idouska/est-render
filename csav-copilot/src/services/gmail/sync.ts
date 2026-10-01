import { logger } from '../../lib/logger.ts';
import { prisma } from '../../lib/prisma.ts';
import { getGmailClient } from './client.ts';
import { curseurApres } from './curseur.ts';
import { isUnknownCursor } from './errors.ts';
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
 * Le filet : combien des derniers messages de la boîte de réception on
 * re-regarde à chaque relève.
 *
 * POURQUOI UN FILET. L'historique Gmail est le chemin temps réel, mais il
 * n'est pas instantanément complet : un message peut être livré sans que son
 * enregistrement d'historique soit encore rendu par `history.list`. Et la
 * recherche (`q:`) ne rattrape pas ce trou, car elle passe par l'index de
 * recherche, qui met lui aussi un moment à voir un message tout neuf — c'est
 * elle qui faisait répondre « aucun nouveau message » à un clic sur
 * « Actualiser » donné dix secondes après l'arrivée du mail.
 *
 * `messages.list` filtré par LIBELLÉ ne demande rien à l'index de recherche :
 * il lit la liste de la boîte de réception. C'est le seul chemin qui réponde
 * juste tout de suite, et il coûte cinq unités de quota — contre six mille
 * disponibles par minute.
 */
const FILET_INBOX = 25;


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

/**
 * Reporte sur les tickets ce qui a bougé dans Gmail : lectures et archivages.
 *
 * Écrit directement plutôt que de remonter à l'appelant : c'est un effet de
 * bord de la relève, sans rapport avec les messages qu'elle rapporte, et le
 * faire transiter par sa valeur de retour obligerait chaque appelant à s'en
 * occuper pour un état qui ne le regarde pas.
 *
 * Un échec ici ne doit pas faire tomber la relève : perdre un archivage coûte
 * un message affiché en trop, perdre la relève coûte tout le courrier.
 */
async function applyLabelChanges(
  merchantId: string,
  moves: {
    archived: Set<string>;
    restored: Set<string>;
    read: Set<string>;
    unread: Set<string>;
  },
): Promise<void> {
  const writes: [Set<string>, { gmailArchived?: boolean; gmailUnread?: boolean }][] = [
    [moves.archived, { gmailArchived: true }],
    [moves.restored, { gmailArchived: false }],
    [moves.read, { gmailUnread: false }],
    [moves.unread, { gmailUnread: true }],
  ];

  try {
    for (const [threads, data] of writes) {
      if (threads.size === 0) continue;

      await prisma.ticket.updateMany({
        where: { merchantId, gmailThreadId: { in: [...threads] } },
        data,
      });
    }
  } catch (error) {
    logger.warn({ merchantId, err: error }, 'Mouvements de libellés Gmail non reportés');
  }
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
  // Vrai quand la relève a bien suivi l'historique : le curseur se déduit
  // alors de ce qui a été lu. Faux au premier branchement et après un curseur
  // périmé, où il faut au contraire en poser un neuf.
  let suivaitLHistorique = false;
  let enregistrementsLus: string[] = [];

  if (connection.lastHistoryId) {
    try {
      const ids = new Set<string>();
      /*
       * Archiver ne crée aucun message.
       *
       * La relève ne demandait que `messageAdded` : un fil sorti de la boîte
       * de réception dans Gmail ne produisait donc aucun événement, et la file
       * continuait de l'afficher en gras indéfiniment. On écoute désormais
       * aussi les mouvements du libellé `INBOX`, dans les deux sens — Gmail
       * remet un fil en réception dès qu'une réponse arrive, et la file doit
       * suivre ce retour autant que le départ.
       */
      const archived = new Set<string>();
      const restored = new Set<string>();
      /* Lire un mail dans Gmail retire `UNREAD` : c'est ce mouvement-là qui
         éteint le gras dans la file. */
      const read = new Set<string>();
      const unread = new Set<string>();
      // Les identifiants des enregistrements réellement lus : c'est eux, et
      // eux seuls, qui ont le droit de faire avancer le curseur.
      const lus: string[] = [];
      let pageToken: string | undefined;

      do {
        const response = await gmail.users.history.list({
          userId: 'me',
          startHistoryId: connection.lastHistoryId,
          historyTypes: ['messageAdded', 'labelRemoved', 'labelAdded'],
          labelId: 'INBOX',
          pageToken,
        });

        for (const entry of response.data.history ?? []) {
          if (entry.id) lus.push(entry.id);

          for (const added of entry.messagesAdded ?? []) {
            if (added.message?.id) ids.add(added.message.id);
          }

          for (const change of entry.labelsRemoved ?? []) {
            const thread = change.message?.threadId;
            if (!thread) continue;

            if (change.labelIds?.includes('INBOX')) {
              archived.add(thread);
              restored.delete(thread);
            }

            if (change.labelIds?.includes('UNREAD')) {
              read.add(thread);
              unread.delete(thread);
            }
          }

          for (const change of entry.labelsAdded ?? []) {
            const thread = change.message?.threadId;
            if (!thread) continue;

            if (change.labelIds?.includes('INBOX')) {
              restored.add(thread);
              archived.delete(thread);
            }

            if (change.labelIds?.includes('UNREAD')) {
              unread.add(thread);
              read.delete(thread);
            }
          }
        }

        pageToken = response.data.nextPageToken ?? undefined;
      } while (pageToken);

      enregistrementsLus = lus;
      suivaitLHistorique = true;

      // L'historique est lu dans l'ordre : le dernier mouvement d'un fil est
      // celui qui compte, d'où les `delete` croisés ci-dessus plutôt qu'une
      // simple accumulation.
      await applyLabelChanges(merchantId, { archived, restored, read, unread });

      messageIds = [...ids];
    } catch (error) {
      if (!isUnknownCursor(error)) throw error;

      logger.warn({ merchantId }, 'historyId périmé, bascule sur le polling');
      messageIds = await listRecentMessageIds(gmail);

      /*
       * Le curseur mort est effacé.
       *
       * Le garder faisait rejouer la même erreur à chaque relève, indéfiniment :
       * la boîte restait muette et l'écran répétait « Requested entity was not
       * found » sans que rien ne puisse en sortir. Vidé, la relève suivante
       * repart sur un balayage et repose un curseur valide.
       */
      await prisma.gmailConnection.update({
        where: { id: connection.id },
        data: { lastHistoryId: null },
      });
    }
  } else {
    messageIds = await listRecentMessageIds(gmail);
  }

  /*
   * Le filet, sur chaque relève.
   *
   * On relit les derniers messages de la boîte de réception et on garde ceux
   * que la base ne connaît pas. C'est ce qui rattrape un enregistrement
   * d'historique arrivé en retard, sans attendre ni un curseur ni l'index de
   * recherche.
   *
   * On s'arrête au PREMIER message déjà connu : au-dessus de lui se trouve ce
   * qui est vraiment nouveau, en dessous ce qu'on a déjà. Après la première
   * passe, le filet ne coûte donc qu'un appel et un contrôle.
   */
  const dejaVus = new Set(messageIds);
  try {
    for (const id of await listerInbox(gmail, FILET_INBOX)) {
      if (dejaVus.has(id)) continue;
      const connu = await prisma.message.findUnique({
        where: { merchantId_gmailMessageId: { merchantId, gmailMessageId: id } },
        select: { id: true },
      });
      // Le premier connu arrête la descente : la suite est plus ancienne.
      if (connu) break;
      messageIds.push(id);
      dejaVus.add(id);
    }
  } catch (error) {
    // Le filet ne doit jamais faire tomber la relève : l'historique a déjà
    // fait son travail, et une panne ici ne doit pas annuler le sien.
    logger.warn({ merchantId, err: error }, 'Filet de la boîte de réception indisponible');
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

  /*
   * Le curseur.
   *
   * Deux situations, et une seule des deux a le droit de regarder l'heure.
   *
   * Quand la relève a SUIVI l'historique, le curseur ne va que jusqu'au
   * dernier enregistrement lu — voir `curseurApres`. Rien lu, rien à avancer :
   * le curseur attend, et ce qui tarde sera lu au passage suivant.
   *
   * Quand il n'y avait AUCUN curseur — premier branchement, ou curseur périmé
   * qu'on vient d'effacer — il faut bien en poser un, et l'identifiant courant
   * de la boîte est alors le bon point de départ : ce qui précède vient
   * d'être relu par le balayage.
   */
  if (!truncated) {
    const avance = suivaitLHistorique
      ? curseurApres(enregistrementsLus, truncated)
      : ((await gmail.users.getProfile({ userId: 'me' })).data.historyId ?? null);

    if (avance) {
      await prisma.gmailConnection.update({
        where: { id: connection.id },
        data: { lastHistoryId: avance },
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

/**
 * Les derniers messages de la boîte de réception, par LIBELLÉ.
 *
 * Sans `q` : une requête de recherche passerait par l'index, qui ne voit un
 * message tout neuf qu'au bout d'un moment. Le filtre par libellé lit la liste
 * de la boîte, qui est à jour dès la livraison.
 */
async function listerInbox(
  gmail: Awaited<ReturnType<typeof getGmailClient>>['gmail'],
  combien: number,
): Promise<string[]> {
  const response = await gmail.users.messages.list({
    userId: 'me',
    labelIds: ['INBOX'],
    maxResults: combien,
  });
  return (response.data.messages ?? []).map((m) => m.id!).filter(Boolean);
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
