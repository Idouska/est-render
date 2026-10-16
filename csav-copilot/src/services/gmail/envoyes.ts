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

/**
 * Une fois par boîte : les réponses déjà envoyées depuis Gmail, sur six mois.
 *
 * La relève ci-dessus ne prend que ce qui part à partir de maintenant ; les
 * statistiques des semaines passées resteraient vides. Le rattrapage lit le
 * libellé « Envoyés » depuis six mois, page après page, et range dans leur
 * conversation les réponses des fils que l'outil suit — les autres ne sont
 * même pas téléchargés.
 *
 * Il se fait au fil des relèves, vingt secondes au plus chacune, pour ne
 * jamais retarder l'arrivée des nouveaux mails. Il est sans danger à rejouer :
 * un message déjà rangé est sauté. La boîte n'est marquée faite qu'une fois
 * toutes les pages lues.
 */
const RATTRAPAGE_JOURS = 180;
const RATTRAPAGE_DUREE_MS = 20_000;

export async function rattraperReponsesEnvoyees(
  merchantId: string,
  gmail: gmail_v1.Gmail,
  connexion: { id: string; emailAddress: string; envoyesRattrapesAt: Date | null },
  { maintenant = Date.now() }: { maintenant?: number } = {},
): Promise<{ ajoutees: number; termine: boolean }> {
  if (connexion.envoyesRattrapesAt) return { ajoutees: 0, termine: true };

  const depuis = new Date(maintenant - RATTRAPAGE_JOURS * 86_400_000);
  const q = `in:sent after:${depuis.getUTCFullYear()}/${depuis.getUTCMonth() + 1}/${depuis.getUTCDate()}`;
  const debut = Date.now();
  let ajoutees = 0;
  let pageToken: string | undefined;

  try {
    do {
      if (Date.now() - debut > RATTRAPAGE_DUREE_MS) return { ajoutees, termine: false };

      const { data } = await gmail.users.messages.list({ userId: 'me', q, maxResults: 100, pageToken });
      const page = (data.messages ?? []).filter((m) => m.id && m.threadId);

      // Deux lectures par page plutôt qu'une par message : les fils suivis,
      // et les messages déjà rangés.
      const [suivis, connus] = await Promise.all([
        prisma.ticket.findMany({
          where: { merchantId, gmailThreadId: { in: [...new Set(page.map((m) => m.threadId!))] } },
          select: { id: true, gmailThreadId: true },
        }),
        prisma.message.findMany({
          where: { merchantId, gmailMessageId: { in: page.map((m) => m.id!) } },
          select: { gmailMessageId: true },
        }),
      ]);
      const ticketDuFil = new Map(suivis.map((t) => [t.gmailThreadId, t.id]));
      const dejaRanges = new Set(connus.map((m) => m.gmailMessageId));

      for (const { id, threadId } of page) {
        const ticketId = ticketDuFil.get(threadId!);
        if (!ticketId || dejaRanges.has(id!)) continue;
        if (Date.now() - debut > RATTRAPAGE_DUREE_MS) return { ajoutees, termine: false };

        const { data: brut } = await gmail.users.messages.get({ userId: 'me', id: id!, format: 'full' });
        const message = parseMessage(brut);
        if (!message || message.labelIds.includes('DRAFT')) continue;
        if (message.fromEmail.toLowerCase() !== connexion.emailAddress.toLowerCase()) continue;
        if (message.bodyText.trim().length === 0) continue;

        try {
          await prisma.message.create({
            data: {
              merchantId,
              ticketId,
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

      pageToken = data.nextPageToken ?? undefined;
    } while (pageToken);

    await prisma.gmailConnection.update({
      where: { id: connexion.id },
      data: { envoyesRattrapesAt: new Date() },
    });
    logger.info({ merchantId, ajoutees }, 'Réponses envoyées depuis Gmail rattrapées');
    return { ajoutees, termine: true };
  } catch (error) {
    logger.warn({ merchantId, err: error }, 'Rattrapage des réponses envoyées interrompu');
    return { ajoutees, termine: false };
  }
}
