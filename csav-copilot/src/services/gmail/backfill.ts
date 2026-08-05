import { logger } from '../../lib/logger.ts';
import { prisma } from '../../lib/prisma.ts';
import { enqueueTicket } from '../../queue/index.ts';
import { getGmailClient } from './client.ts';
import { loadLabelNames, resolveLabels, syncTicketLabels } from './labels.ts';
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
  /** Tickets récents soumis à l'IA. Les plus anciens entrent sans traitement. */
  tickets: number;
  /** Tickets déjà connus dont les libellés ont été mis à jour. */
  relabelled: number;
  /** Le plafond a été atteint : il reste du courrier au-delà. */
  capped: boolean;
  done: boolean;
}

/** Avancement par boîte, lisible pendant que le travail tourne. */
export const backfillProgress = new Map<string, BackfillProgress>();

export async function backfillMailbox(params: {
  merchantId: string;
  mailboxId: string;
  days: number;
  /**
   * Plafond sur les messages *ingérés*, pas sur les messages examinés.
   *
   * L'inverse rendait les relances inutiles : le balayage recroisait les mêmes
   * courriers déjà connus, épuisait son quota sur eux et s'arrêtait toujours au
   * même point. On ne progressait jamais au-delà du premier lot.
   */
  maxIngested?: number;
}): Promise<BackfillProgress> {
  const { merchantId, mailboxId, days, maxIngested = 3000 } = params;

  const connection = await prisma.gmailConnection.findFirst({
    where: { id: mailboxId, merchantId },
  });
  if (!connection) throw new Error('Boîte introuvable');

  const { gmail } = await getGmailClient(merchantId, connection.id);
  const address = connection.emailAddress.toLowerCase();
  const labelNames = await loadLabelNames(gmail, connection.id);

  const progress: BackfillProgress = {
    scanned: 0,
    ingested: 0,
    tickets: 0,
    relabelled: 0,
    capped: false,
    done: false,
  };
  backfillProgress.set(mailboxId, progress);

  // Tickets à soumettre à l'IA : seulement ceux dont le dernier message est
  // récent.
  //
  // Trois mois d'archives, ce sont des milliers d'échanges dont la plupart sont
  // clos depuis longtemps. Les faire tous rédiger coûterait une facture d'IA
  // considérable pour produire des brouillons que personne n'enverra — on ne
  // répond pas à un client qui écrivait il y a onze semaines. Le reste entre
  // pour être consulté, ce qui est précisément ce qu'on demande à un
  // rattrapage.
  const AI_WINDOW_DAYS = 7;
  const aiCutoff = new Date(Date.now() - AI_WINDOW_DAYS * 86_400_000);

  const touched = new Set<string>();
  let pageToken: string | undefined;

  try {
    do {
      const { data } = await gmail.users.messages.list({
        userId: 'me',
        // `-from:me` écarte ce que la boutique s'est envoyé : ce n'est pas une
        // demande client, et en faire un ticket créerait du travail fantôme.
        // Toute la boîte, archivés compris : un mail traité puis rangé reste
        // un échange client. Seuls le spam et la corbeille sont écartés — ce
        // que le marchand a jeté n'a pas à revenir par une porte de service.
        q: `newer_than:${days}d -from:me -in:spam -in:trash`,
        maxResults: 100,
        pageToken,
      });

      for (const entry of data.messages ?? []) {
        if (!entry.id) continue;
        progress.scanned += 1;

        const known = await prisma.message.findUnique({
          where: { merchantId_gmailMessageId: { merchantId, gmailMessageId: entry.id } },
          select: { id: true, ticketId: true },
        });

        // Message déjà connu : on passe sans rien demander à Gmail. Les
        // libellés se rattrapent en fin de course, par libellé et non par
        // message — un appel par étiquette au lieu d'un par courrier.
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
          if (message.receivedAt >= aiCutoff) touched.add(ticket.id);
        } catch (error) {
          if ((error as { code?: string }).code !== 'P2002') throw error;
        }

        if (progress.ingested >= maxIngested) {
          progress.capped = true;
          break;
        }
      }

      pageToken = data.nextPageToken ?? undefined;
    } while (pageToken && progress.ingested < maxIngested);

    // Les libellés en dernier : c'est un confort, et il ne doit pas retarder
    // l'entrée du courrier dans la file.
    try {
      // Table rase sur la fenêtre traitée, avant de reposer les étiquettes.
      // Sans ça, un libellé retiré dans Gmail survivrait indéfiniment dans
      // l'outil : on ne saurait plus si l'étiquette décrit le présent ou un
      // classement abandonné il y a six mois.
      await prisma.ticket.updateMany({
        where: {
          merchantId,
          mailboxId: connection.id,
          lastMessageAt: { gte: new Date(Date.now() - days * 86_400_000) },
        },
        data: { labels: [] },
      });

      progress.relabelled = await syncTicketLabels({
        gmail,
        merchantId,
        mailboxId: connection.id,
        days,
        applyLabels: async (messageIds, label) => {
          const rows = await prisma.message.findMany({
            where: { merchantId, gmailMessageId: { in: messageIds } },
            select: { ticketId: true },
          });

          const ticketIds = [...new Set(rows.map((row) => row.ticketId))];
          if (ticketIds.length === 0) return 0;

          // Ajout et non remplacement : un ticket porte souvent plusieurs
          // étiquettes, et chaque libellé est traité par une requête distincte.
          // La remise à zéro a eu lieu une fois, juste avant la boucle.
          await prisma.$executeRaw`
            UPDATE "Ticket"
            SET "labels" = array_append("labels", ${label})
            WHERE "id" = ANY(${ticketIds}::text[])
              AND NOT (${label} = ANY("labels"))
          `;

          return ticketIds.length;
        },
      });
    } catch (error) {
      logger.warn({ merchantId, err: error }, 'Synchronisation des libellés en échec');
    }

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
