import { env } from '../../config/env.ts';
import { logger } from '../../lib/logger.ts';
import { prisma } from '../../lib/prisma.ts';
import { enModeTest } from '../modeTest.ts';
import { getGmailClient } from './client.ts';
import { forgetLabelNames, loadLabelNames } from './labels.ts';

/**
 * Ce que l'outil fait aussi dans Gmail : mettre un fil à la corbeille, et
 * reporter ses libellés.
 *
 * Il lui faut l'autorisation `gmail.modify`. Une boîte connectée sans elle —
 * avant ce changement, ou si la case a été décochée — garde l'ancien
 * comportement : l'outil n'agit que chez lui, et le dit.
 *
 * Corbeille, pas suppression définitive : un fil supprimé par erreur se
 * récupère dans Gmail pendant trente jours. Effacer pour de bon demanderait
 * l'accès complet à la messagerie, hors de proportion.
 *
 * Jamais bloquant : un Gmail en panne ne doit pas empêcher de ranger l'outil.
 * Le résultat dit ce qui s'est passé, pour que l'écran le dise à son tour.
 */

export const SCOPE_MODIFY = 'https://www.googleapis.com/auth/gmail.modify';

export type IssueGmail = 'fait' | 'sans-droit' | 'simule' | 'sans-fil' | 'echec';

/** Les autorisations de la boîte permettent-elles d'agir sur Gmail ? */
export const peutModifier = (scopes: string | null | undefined): boolean =>
  (scopes ?? '').split(/[\s,]+/).includes(SCOPE_MODIFY);

/** Les fils internes (signalements d'atelier…) n'existent pas dans Gmail. */
const estUnFilGmail = (threadId: string) => /^[0-9a-f]+$/i.test(threadId);

type Preparation =
  | { issue: 'sans-fil' | 'simule' | 'sans-droit' }
  | { issue?: undefined; gmail: Awaited<ReturnType<typeof getGmailClient>>['gmail']; mailboxId: string };

async function preparer(merchantId: string, mailboxId: string | null, threadId: string): Promise<Preparation> {
  if (!estUnFilGmail(threadId)) return { issue: 'sans-fil' as const };
  if (env.GMAIL_MOCK || (await enModeTest(merchantId))) return { issue: 'simule' as const };

  const boite = mailboxId
    ? await prisma.gmailConnection.findFirst({ where: { id: mailboxId, merchantId }, select: { id: true, scopes: true } })
    : await prisma.gmailConnection.findFirst({
        where: { merchantId },
        orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
        select: { id: true, scopes: true },
      });
  if (!boite) return { issue: 'sans-fil' as const };
  if (!peutModifier(boite.scopes)) return { issue: 'sans-droit' as const };

  const { gmail } = await getGmailClient(merchantId, boite.id);
  return { gmail, mailboxId: boite.id };
}

/** Le fil part à la corbeille de Gmail. */
export async function mettreALaCorbeille(
  merchantId: string,
  ticket: { gmailThreadId: string; mailboxId: string | null },
): Promise<IssueGmail> {
  try {
    const pret = await preparer(merchantId, ticket.mailboxId, ticket.gmailThreadId);
    if (pret.issue) return pret.issue;
    await pret.gmail.users.threads.trash({ userId: 'me', id: ticket.gmailThreadId });
    return 'fait';
  } catch (error) {
    // Déjà supprimé dans Gmail : c'est l'état visé.
    if ((error as { code?: number }).code === 404) return 'fait';
    logger.warn({ err: error, merchantId, threadId: ticket.gmailThreadId }, 'Mise à la corbeille Gmail en échec');
    return 'echec';
  }
}

/**
 * Reporte dans Gmail les libellés ajoutés et retirés ici. Un libellé qui
 * n'existe pas encore dans la boîte y est créé : sinon il vivrait dans
 * l'outil seul, et la prochaine relecture de Gmail l'effacerait.
 */
export async function reporterLibelles(
  merchantId: string,
  ticket: { gmailThreadId: string; mailboxId: string | null },
  avant: readonly string[],
  apres: readonly string[],
): Promise<IssueGmail> {
  const ajoutes = apres.filter((nom) => !avant.includes(nom));
  const retires = avant.filter((nom) => !apres.includes(nom));
  if (ajoutes.length === 0 && retires.length === 0) return 'fait';

  try {
    const pret = await preparer(merchantId, ticket.mailboxId, ticket.gmailThreadId);
    if (pret.issue) return pret.issue;
    const { gmail, mailboxId } = pret;

    const idDe = new Map([...(await loadLabelNames(gmail, mailboxId))].map(([id, nom]) => [nom, id]));
    for (const nom of ajoutes) {
      if (idDe.has(nom)) continue;
      const { data } = await gmail.users.labels.create({
        userId: 'me',
        requestBody: { name: nom, labelListVisibility: 'labelShow', messageListVisibility: 'show' },
      });
      if (data.id) idDe.set(nom, data.id);
      forgetLabelNames(mailboxId);
    }

    await gmail.users.threads.modify({
      userId: 'me',
      id: ticket.gmailThreadId,
      requestBody: {
        addLabelIds: ajoutes.map((nom) => idDe.get(nom)).filter((id): id is string => Boolean(id)),
        removeLabelIds: retires.map((nom) => idDe.get(nom)).filter((id): id is string => Boolean(id)),
      },
    });
    return 'fait';
  } catch (error) {
    logger.warn({ err: error, merchantId, threadId: ticket.gmailThreadId }, 'Libellés Gmail non reportés');
    return 'echec';
  }
}
