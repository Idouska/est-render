import { prisma } from '../../lib/prisma.ts';
import { getCredentials } from '../platform/credentials.ts';
import { getShopifyClient } from '../shopify/client.ts';
import { getOrderById } from '../shopify/orders.ts';
import { getTracking, TRACK_STATUS_LABELS, type TrackInfo } from '../tracking/index.ts';

/**
 * La page Update : où en sont les colis qui ne bougent plus.
 *
 * Trois états, le chemin d'un colis bloqué :
 *   - À DEMANDER : aucun scan du transporteur depuis SEUIL_JOURS, et rien de
 *     demandé à l'atelier ;
 *   - EN ATTENTE : la demande « Update » est partie, l'atelier n'a pas
 *     répondu — à relancer après RELANCE_JOURS ;
 *   - RÉPONDUE : l'atelier a répondu, le client n'est pas encore prévenu.
 *
 * Les colis sont ceux que l'atelier a saisis (table Parcel) ; leur état vient
 * du suivi transporteur (17TRACK ou ParcelsApp). Sans clé de suivi, rien ne
 * peut être « bloqué » : la page ne liste alors que les demandes faites.
 */

export const SEUIL_JOURS = 3;
export const RELANCE_JOURS = 2;
/** Combien de temps « Attendre encore » laisse au transporteur. */
export const REPORT_JOURS = 2;
/** Un colis plus vieux ne se suit plus ici : il relève d'une réclamation. */
const FENETRE_JOURS = 45;
/** Les demandes prévenues restent visibles dans « Tout » ce temps-là. */
const GARDER_PREVENUES_JOURS = 14;
const JOUR = 86_400_000;

export type EtatUpdate = 'DEMANDER' | 'ATTENTE' | 'REPONDUE' | 'PREVENU';

export interface ColisUpdate {
  numero: string;
  transporteur: string | null;
  statut: string | null;
  statutLibelle: string | null;
  livre: boolean;
  /** Le dernier scan connu, ou la saisie du numéro faute de suivi. */
  dernierScan: { at: string; quoi: string; lieu: string | null } | null;
  joursSansScan: number;
  evenements: Array<{ at: string; quoi: string; lieu: string | null }>;
}

export interface LigneUpdate {
  orderId: string;
  orderName: string | null;
  client: string | null;
  article: { titre: string; declinaison: string | null; image: string | null } | null;
  autresArticles: number;
  atelier: { id: string; name: string } | null;
  colis: ColisUpdate[];
  joursSansScan: number;
  etat: EtatUpdate;
  aRelancer: boolean;
  /** Le message à l'atelier, déjà écrit. */
  messagePropose: string;
  demande: {
    id: string;
    status: string;
    message: string;
    supplierNote: string | null;
    createdAt: Date;
    acknowledgedAt: Date | null;
    remindedAt: Date | null;
    handledAt: Date | null;
  } | null;
  origine: { type: 'CLIENT' | 'MARCHAND' | 'AUTO'; ticketId: string | null; sujet: string | null; depuis: Date | null };
}

/** Jours entiers écoulés depuis `date`. */
export function joursDepuis(date: Date | string, maintenant = Date.now()): number {
  return Math.max(0, Math.floor((maintenant - new Date(date).getTime()) / JOUR));
}

/**
 * L'état d'un colis à partir de son suivi : livré, ou depuis quand il ne
 * bouge plus. Sans suivi, la saisie du numéro tient lieu de dernier signe.
 */
export function lireColis(
  numero: string,
  transporteur: string | null,
  saisiLe: Date,
  info: TrackInfo | undefined,
  maintenant = Date.now(),
): ColisUpdate {
  const evenements = (info?.events ?? [])
    .map((evenement) => ({ at: evenement.at, quoi: evenement.status, lieu: evenement.location }))
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  const livre = info?.status === 'Delivered' || Boolean(info?.deliveredAt);
  const dernier = evenements[0] ?? null;
  const reference = dernier?.at ?? saisiLe.toISOString();
  return {
    numero,
    transporteur: transporteur ?? info?.carrier ?? null,
    statut: info?.status ?? null,
    statutLibelle: info?.status ? (TRACK_STATUS_LABELS[info.status] ?? info.status) : null,
    livre,
    dernierScan: dernier,
    joursSansScan: livre ? 0 : joursDepuis(reference, maintenant),
    evenements: evenements.slice(0, 4),
  };
}

/** Le suivi déjà lu, gardé dix minutes : ouvrir la page ne doit pas coûter un appel par colis. */
const memoire = new Map<string, { at: number; info: TrackInfo | undefined }>();
const MEMOIRE_MS = 10 * 60 * 1000;

async function suivi(numeros: string[]): Promise<Map<string, TrackInfo>> {
  const maintenant = Date.now();
  const resultat = new Map<string, TrackInfo>();
  const aLire: string[] = [];
  for (const numero of numeros) {
    const connu = memoire.get(numero);
    if (connu && maintenant - connu.at < MEMOIRE_MS) {
      if (connu.info) resultat.set(numero, connu.info);
    } else aLire.push(numero);
  }
  if (aLire.length) {
    const lus = await getTracking(aLire).catch(() => new Map<string, TrackInfo>());
    for (const numero of aLire) {
      const info = lus.get(numero);
      memoire.set(numero, { at: maintenant, info });
      if (info) resultat.set(numero, info);
    }
  }
  return resultat;
}

/** Une clé de suivi est-elle branchée ? Sans elle, rien ne se repère tout seul. */
export async function suiviActif(): Promise<boolean> {
  const cles = (await getCredentials()) as Record<string, string | undefined>;
  return Boolean(cles.PARCELSAPP_API_KEY || cles.TRACK17_API_KEY);
}

export async function etatUpdate(
  merchantId: string,
  options: { details?: boolean; maintenant?: number } = {},
): Promise<{
  suiviActif: boolean;
  seuilJours: number;
  lignes: LigneUpdate[];
}> {
  const maintenant = options.maintenant ?? Date.now();
  // Sans détails (la pastille du menu), pas un appel à Shopify.
  const details = options.details ?? true;
  const actif = await suiviActif();
  const depuis = new Date(maintenant - FENETRE_JOURS * JOUR);

  const [colis, demandes, reportes, fournisseurs] = await Promise.all([
    prisma.parcel.findMany({
      where: { merchantId, shopifyOrderId: { not: null }, createdAt: { gte: depuis } },
      orderBy: { createdAt: 'desc' },
      take: 400,
      select: {
        shopifyOrderId: true,
        orderName: true,
        trackingNumber: true,
        carrier: true,
        createdAt: true,
        escalation: { select: { supplierId: true } },
      },
    }),
    prisma.supplierAlert.findMany({
      where: {
        merchantId,
        kind: 'TRACKING',
        OR: [
          { status: 'PENDING' },
          { handledAt: null },
          { handledAt: { gte: new Date(maintenant - GARDER_PREVENUES_JOURS * JOUR) } },
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: {
        id: true,
        status: true,
        message: true,
        supplierNote: true,
        createdAt: true,
        acknowledgedAt: true,
        remindedAt: true,
        handledAt: true,
        shopifyOrderId: true,
        orderName: true,
        ticketId: true,
        createdById: true,
        supplier: { select: { id: true, name: true } },
      },
    }),
    prisma.updateReporte.findMany({
      where: { merchantId, jusqua: { gt: new Date(maintenant) } },
      select: { shopifyOrderId: true },
    }),
    prisma.supplier.findMany({
      where: { merchantId, active: true },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
      select: { id: true, name: true },
    }),
  ]);

  // La demande la plus récente fait foi pour sa commande.
  const demandeDe = new Map<string, (typeof demandes)[number]>();
  for (const demande of demandes) {
    if (demande.shopifyOrderId && !demandeDe.has(demande.shopifyOrderId)) demandeDe.set(demande.shopifyOrderId, demande);
  }
  const reporte = new Set(reportes.map((ligne) => ligne.shopifyOrderId));

  // Les colis par commande, et leur suivi.
  const parCommande = new Map<string, typeof colis>();
  for (const ligne of colis) {
    const id = ligne.shopifyOrderId!;
    parCommande.set(id, [...(parCommande.get(id) ?? []), ligne]);
  }
  const infos = actif ? await suivi(colis.map((ligne) => ligne.trackingNumber)) : new Map<string, TrackInfo>();

  const lus = new Map<string, ColisUpdate[]>();
  for (const [id, lignes] of parCommande) {
    lus.set(id, lignes.map((ligne) => lireColis(ligne.trackingNumber, ligne.carrier, ligne.createdAt, infos.get(ligne.trackingNumber), maintenant)));
  }

  /*
   * Les commandes à montrer : toutes celles qui ont une demande en cours ou
   * récente, plus celles dont un colis est bloqué et sur lesquelles rien n'a
   * été demandé depuis SEUIL_JOURS (sinon la même commande reviendrait le
   * lendemain du « client prévenu »).
   */
  const commandes = new Set<string>(demandeDe.keys());
  if (actif) {
    for (const [id, liste] of lus) {
      const bloque = liste.some((un) => !un.livre && un.joursSansScan >= SEUIL_JOURS);
      const recente = demandeDe.get(id);
      const demandeRecente = recente && joursDepuis(recente.createdAt, maintenant) < SEUIL_JOURS;
      if (bloque && !reporte.has(id) && !demandeRecente) commandes.add(id);
    }
  }

  // Les ateliers des commandes : la demande d'abord, puis le colis, puis le lot envoyé.
  const ids = [...commandes];
  const [lots, tickets] = await Promise.all([
    prisma.envoiCommande.findMany({
      where: { merchantId, shopifyOrderId: { in: ids } },
      select: { shopifyOrderId: true, envoi: { select: { supplier: { select: { id: true, name: true } } } } },
    }),
    prisma.ticket.findMany({
      where: { merchantId, shopifyOrderId: { in: ids }, status: { not: 'CLOSED' } },
      orderBy: { lastMessageAt: 'desc' },
      select: { id: true, shopifyOrderId: true, subject: true, lastMessageAt: true, customerName: true },
    }),
  ]);
  const atelierDuLot = new Map(lots.map((lot) => [lot.shopifyOrderId, lot.envoi.supplier]));
  const ticketDe = new Map<string, (typeof tickets)[number]>();
  for (const ticket of tickets) if (ticket.shopifyOrderId && !ticketDe.has(ticket.shopifyOrderId)) ticketDe.set(ticket.shopifyOrderId, ticket);
  const nomAtelier = new Map(fournisseurs.map((fournisseur) => [fournisseur.id, fournisseur]));

  // L'article et le client, relus chez Shopify : quarante commandes au plus.
  const client = details ? await getShopifyClient(merchantId).catch(() => null) : null;
  const commandesShopify = new Map<string, Awaited<ReturnType<typeof getOrderById>>>();
  if (client) {
    await Promise.all(
      ids.slice(0, 40).map(async (id) => commandesShopify.set(id, await getOrderById(client, id).catch(() => null))),
    );
  }

  const lignes: LigneUpdate[] = ids.map((id) => {
    const demande = demandeDe.get(id) ?? null;
    const liste = lus.get(id) ?? [];
    const enCours = liste.filter((un) => !un.livre);
    const joursSansScan = enCours.length ? Math.max(...enCours.map((un) => un.joursSansScan)) : 0;
    const commande = commandesShopify.get(id) ?? null;
    const premiere = commande?.lineItems?.[0];
    const ticket = ticketDe.get(id) ?? null;
    const parColis = parCommande.get(id)?.find((ligne) => ligne.escalation?.supplierId)?.escalation?.supplierId;
    const atelier =
      demande?.supplier ??
      (parColis ? nomAtelier.get(parColis) : undefined) ??
      atelierDuLot.get(id) ??
      fournisseurs[0] ??
      null;

    const etat: EtatUpdate = !demande
      ? 'DEMANDER'
      : demande.status === 'PENDING'
        ? 'ATTENTE'
        : demande.handledAt
          ? 'PREVENU'
          : 'REPONDUE';
    const derniereSollicitation = demande?.remindedAt ?? demande?.createdAt;

    return {
      orderId: id,
      orderName: commande?.name ?? demande?.orderName ?? parCommande.get(id)?.[0]?.orderName ?? null,
      client: commande?.customer?.displayName ?? commande?.shippingAddress?.name ?? ticket?.customerName ?? null,
      article: premiere ? { titre: premiere.title, declinaison: premiere.variantTitle ?? null, image: premiere.image ?? null } : null,
      autresArticles: Math.max(0, (commande?.lineItems?.length ?? 0) - 1),
      atelier: atelier ? { id: atelier.id, name: atelier.name } : null,
      colis: liste,
      joursSansScan,
      etat,
      aRelancer: etat === 'ATTENTE' && !!derniereSollicitation && joursDepuis(derniereSollicitation, maintenant) >= RELANCE_JOURS,
      messagePropose: messageAtelier({ colis: liste, joursSansScan }),
      demande: demande
        ? {
            id: demande.id,
            status: demande.status,
            message: demande.message,
            supplierNote: demande.supplierNote,
            createdAt: demande.createdAt,
            acknowledgedAt: demande.acknowledgedAt,
            remindedAt: demande.remindedAt,
            handledAt: demande.handledAt,
          }
        : null,
      // Le client a écrit ; sinon, un colis bloqué a été repéré ; sinon, la
      // demande a été faite à la main sur un colis qui avançait encore.
      origine: ticket
        ? { type: 'CLIENT', ticketId: ticket.id, sujet: ticket.subject, depuis: ticket.lastMessageAt }
        : demande && joursSansScan < SEUIL_JOURS
          ? { type: 'MARCHAND', ticketId: demande.ticketId, sujet: null, depuis: demande.createdAt }
          : { type: 'AUTO', ticketId: null, sujet: null, depuis: null },
    };
  });

  // Le plus urgent d'abord : à relancer, puis les plus longtemps immobiles.
  lignes.sort((a, b) => Number(b.aRelancer) - Number(a.aRelancer) || b.joursSansScan - a.joursSansScan);
  return { suiviActif: actif, seuilJours: SEUIL_JOURS, lignes };
}

/** Le message à l'atelier, déjà écrit : le numéro, depuis quand, le dernier scan. */
export function messageAtelier(ligne: Pick<LigneUpdate, 'colis' | 'joursSansScan'>): string {
  const bloques = ligne.colis.filter((un) => !un.livre);
  const numeros = bloques.map((un) => un.numero).join(', ') || ligne.colis.map((un) => un.numero).join(', ');
  const scan = bloques[0]?.dernierScan;
  return `Bonjour, le suivi ${numeros} ne bouge plus depuis ${ligne.joursSansScan} jours${
    scan ? ` (dernier scan : ${scan.quoi}${scan.lieu ? `, ${scan.lieu}` : ''})` : ''
  }. Pouvez-vous vérifier où en est le colis ?`;
}
