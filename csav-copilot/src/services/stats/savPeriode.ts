import { prisma } from '../../lib/prisma.ts';
import { brouillonsUtilises, delaisParTicket } from '../tickets/premiereReponse.ts';
import type { GroupeMessages } from '../tickets/resolution.ts';
import { cadres, mediane, serieVide, type Cadre, type Periode, type Plage } from './periode.ts';

/**
 * Les chiffres du SAV sur une période, point par point.
 *
 * Quatre mesures, les mêmes que les cartes de l'écran : les messages reçus
 * (une conversation ouverte), la première réponse (médiane), les brouillons
 * qui ont servi (part), et la part « à classer » — les messages dont l'IA
 * n'a pas su dire le motif, ou pas encore. Chacune a sa série pour le
 * graphique ouvert en grand, et sa valeur sur toute la période.
 *
 * Une médiane ne s'additionne pas : celle de la période est calculée sur
 * toutes ses conversations, pas sur les médianes des jours.
 */

export interface DonneesSav {
  tickets: Array<{ id: string; createdAt: Date; intent: string | null }>;
  entrees: GroupeMessages[];
  sorties: GroupeMessages[];
  brouillons: Array<{ ticketId: string; sentAt: Date | null; createdAt: Date; ticket: { createdAt: Date } }>;
}

export interface ChiffresSav {
  totaux: {
    messages: number;
    premiereReponse: { mediane: number | null; mesurees: number };
    brouillons: { total: number; utilises: number; taux: number | null };
    aClasser: { n: number; part: number | null };
  };
  series: {
    messages: Array<number | null>;
    premiereReponse: Array<number | null>;
    brouillons: Array<number | null>;
    aClasser: Array<number | null>;
  };
  /** Par motif ; les messages sans motif sont comptés « OTHER », à classer. */
  motifs: Record<string, number>;
}

const aClasser = (intent: string | null) => intent === null || intent === 'OTHER';

export function agregerSav(donnees: DonneesSav, p: Cadre): ChiffresSav {
  const { place } = p;
  const vide = () => serieVide(p);
  const listes = () => p.cles.map(() => [] as number[]);

  const messages = vide();
  const sansMotif = vide();
  const motifs: Record<string, number> = {};
  const creeLe = new Map<string, number>();
  for (const ticket of donnees.tickets) {
    const motif = aClasser(ticket.intent) ? 'OTHER' : ticket.intent!;
    motifs[motif] = (motifs[motif] ?? 0) + 1;
    creeLe.set(ticket.id, ticket.createdAt.getTime());
    const i = place(ticket.createdAt.getTime());
    if (i < 0) continue;
    messages[i] = (messages[i] ?? 0) + 1;
    if (aClasser(ticket.intent)) sansMotif[i] = (sansMotif[i] ?? 0) + 1;
  }

  // La première réponse, rangée au jour où le client a écrit.
  const delais = delaisParTicket(
    donnees.entrees,
    donnees.sorties,
    donnees.brouillons.map((b) => ({ ticketId: b.ticketId, sentAt: b.sentAt, ticketCreatedAt: b.ticket.createdAt })),
  );
  const delaisParPoint = listes();
  const tousDelais: number[] = [];
  for (const [ticketId, minutes] of delais) {
    const cree = creeLe.get(ticketId);
    if (cree === undefined) continue;
    tousDelais.push(minutes);
    const i = place(cree);
    if (i >= 0) delaisParPoint[i]!.push(minutes);
  }

  // Les brouillons, rangés au jour où ils ont été rédigés.
  const servis = brouillonsUtilises(donnees.brouillons, donnees.sorties);
  const redigesParPoint = p.cles.map(() => 0);
  const servisParPoint = p.cles.map(() => 0);
  donnees.brouillons.forEach((brouillon, n) => {
    const i = place(brouillon.createdAt.getTime());
    if (i < 0) return;
    redigesParPoint[i]! += 1;
    if (servis[n]) servisParPoint[i]! += 1;
  });
  const utilises = servis.filter(Boolean).length;
  const nonClasses = donnees.tickets.filter((t) => aClasser(t.intent)).length;

  const futur = (i: number) => p.futurs.has(p.cles[i]!);
  return {
    totaux: {
      messages: donnees.tickets.length,
      premiereReponse: { mediane: mediane(tousDelais), mesurees: tousDelais.length },
      brouillons: {
        total: donnees.brouillons.length,
        utilises,
        taux: donnees.brouillons.length ? utilises / donnees.brouillons.length : null,
      },
      aClasser: {
        n: nonClasses,
        part: donnees.tickets.length ? nonClasses / donnees.tickets.length : null,
      },
    },
    series: {
      messages,
      premiereReponse: delaisParPoint.map((liste, i) => (futur(i) ? null : mediane(liste))),
      brouillons: redigesParPoint.map((n, i) => (futur(i) || n === 0 ? null : servisParPoint[i]! / n)),
      aClasser: messages.map((n, i) => (futur(i) || !n ? null : (sansMotif[i] ?? 0) / n)),
    },
    motifs,
  };
}

/** Ce que la base sait d'une plage : conversations, premiers et derniers messages, brouillons. */
export async function lireDonneesSav(merchantId: string, p: Plage): Promise<DonneesSav> {
  const creees = { gte: p.depuis, lt: p.avant };
  const portee = { merchantId, ticket: { isHistorical: false, notification: false, createdAt: creees } };
  const [tickets, entrees, sorties, brouillons] = await Promise.all([
    prisma.ticket.findMany({
      where: { merchantId, isHistorical: false, notification: false, createdAt: creees },
      select: { id: true, createdAt: true, intent: true },
    }),
    prisma.message.groupBy({
      by: ['ticketId'],
      where: { ...portee, direction: 'INBOUND' },
      _min: { receivedAt: true },
    }),
    prisma.message.groupBy({
      by: ['ticketId'],
      where: { ...portee, direction: 'OUTBOUND' },
      _min: { receivedAt: true },
      _max: { receivedAt: true },
    }),
    prisma.draft.findMany({
      where: { merchantId, createdAt: creees },
      select: { ticketId: true, sentAt: true, createdAt: true, ticket: { select: { createdAt: true } } },
    }),
  ]);
  return { tickets, entrees, sorties, brouillons };
}

/** Qui a fait quoi sur la période : réponses envoyées, remboursements, escalades. */
export async function equipeSurPlage(merchantId: string, p: Plage) {
  const [users, audits] = await Promise.all([
    prisma.user.findMany({
      where: { merchantId },
      select: { id: true, name: true, email: true, role: true, active: true },
    }),
    prisma.auditLog.groupBy({
      by: ['actorId', 'action'],
      where: {
        merchantId,
        createdAt: { gte: p.depuis, lt: p.avant },
        action: { in: ['draft.sent', 'refund.completed', 'supplier.notified'] },
      },
      _count: { _all: true },
    }),
  ]);
  return users
    .map((user) => {
      const count = (action: string) =>
        audits.find((row) => row.actorId === user.id && row.action === action)?._count._all ?? 0;
      return {
        id: user.id,
        name: user.name ?? user.email,
        role: user.role,
        active: user.active,
        replies: count('draft.sent'),
        refunds: count('refund.completed'),
        escalations: count('supplier.notified'),
      };
    })
    .sort((a, b) => b.replies - a.replies);
}

export async function statsSavPeriode(merchantId: string, periode: Periode) {
  const { courante, comparee } = periode;
  const cadre = cadres(periode);
  const [donnees, donneesComparees, equipe] = await Promise.all([
    lireDonneesSav(merchantId, courante),
    comparee ? lireDonneesSav(merchantId, comparee) : null,
    equipeSurPlage(merchantId, courante),
  ]);
  return {
    courant: agregerSav(donnees, cadre.courant),
    compare: donneesComparees && cadre.compare ? agregerSav(donneesComparees, cadre.compare) : null,
    equipe,
  };
}
