import { prisma } from '../../lib/prisma.ts';

/**
 * Le lot du jour, suivi après l'envoi.
 *
 * Le fichier Excel part, puis plus rien : le marchand ne savait pas si
 * l'atelier avait lancé une commande sans lui écrire, et l'atelier n'avait
 * aucune liste de ce qu'il avait reçu. Chaque commande envoyée a maintenant
 * un statut, lisible des deux côtés :
 *
 *   à préparer → expédiée
 *
 * « Expédiée » ne se déclare pas : ce sont ses colis qui le disent, saisis
 * comme d'habitude. Un statut déclaré à côté des colis finirait par les
 * contredire.
 */

import { estEnRetard, joursDepuis, statutDeLaCommande, type StatutLot } from './statutLot.ts';

export { estEnRetard, joursDepuis, resumeArticles, statutDeLaCommande, type StatutLot } from './statutLot.ts';

export interface CommandeDuLot {
  shopifyOrderId: string;
  orderName: string;
  articles: string | null;
  statut: StatutLot;
  suivis: string[];
  /** Non expédiée au-delà du délai laissé à l'atelier. */
  enRetard: boolean;
  joursDepuis: number;
}

export interface Lot {
  id: string;
  envoyeLe: Date;
  fournisseur: { id: string; name: string };
  commandes: CommandeDuLot[];
  compte: Record<StatutLot, number> & { RETARD: number };
  delaiJours: number;
}

/**
 * Les lots partis ces derniers jours, avec le statut de chaque commande.
 *
 * `supplierId` borne la lecture à un atelier : c'est la seule chose qu'il
 * peut voir. Sans lui, le marchand voit tous ses fournisseurs.
 */
export async function lotsRecents(params: {
  merchantId: string;
  supplierId?: string;
  jours?: number;
  limite?: number;
}): Promise<Lot[]> {
  const maintenant = new Date();
  const depuis = new Date(maintenant.getTime() - (params.jours ?? 14) * 86_400_000);
  const { lotDelaiJours: delaiJours } = await prisma.merchant.findUniqueOrThrow({
    where: { id: params.merchantId },
    select: { lotDelaiJours: true },
  });
  const envois = await prisma.envoiFournisseur.findMany({
    where: {
      merchantId: params.merchantId,
      ...(params.supplierId ? { supplierId: params.supplierId } : {}),
      emailedAt: { not: null },
      createdAt: { gte: depuis },
    },
    orderBy: { createdAt: 'desc' },
    take: params.limite ?? 20,
    select: {
      id: true,
      emailedAt: true,
      supplier: { select: { id: true, name: true } },
      commandes: {
        orderBy: { orderName: 'asc' },
        select: { shopifyOrderId: true, orderName: true, articles: true },
      },
    },
  });

  const ids = envois.flatMap((envoi) => envoi.commandes.map((commande) => commande.shopifyOrderId));
  const colis = ids.length
    ? await prisma.parcel.findMany({
        where: { merchantId: params.merchantId, shopifyOrderId: { in: ids } },
        orderBy: { index: 'asc' },
        select: { shopifyOrderId: true, trackingNumber: true },
      })
    : [];
  const suivis = new Map<string, string[]>();
  for (const ligne of colis) {
    if (!ligne.shopifyOrderId) continue;
    suivis.set(ligne.shopifyOrderId, [...(suivis.get(ligne.shopifyOrderId) ?? []), ligne.trackingNumber]);
  }

  return envois.map((envoi) => {
    const commandes = envoi.commandes.map((commande) => {
      const numeros = suivis.get(commande.shopifyOrderId) ?? [];
      const statut = statutDeLaCommande({ colis: numeros.length });
      return {
        shopifyOrderId: commande.shopifyOrderId,
        orderName: commande.orderName,
        articles: commande.articles,
        statut,
        suivis: numeros,
        enRetard: estEnRetard({ statut, envoyeLe: envoi.emailedAt!, delaiJours, maintenant }),
        joursDepuis: joursDepuis(envoi.emailedAt!, maintenant),
      };
    });
    const compte = { A_PREPARER: 0, EXPEDIEE: 0, RETARD: 0 };
    for (const commande of commandes) {
      compte[commande.statut] += 1;
      if (commande.enRetard) compte.RETARD += 1;
    }
    return { id: envoi.id, envoyeLe: envoi.emailedAt!, fournisseur: envoi.supplier, commandes, compte, delaiJours };
  });
}

/**
 * Le nombre de commandes de lot en retard, pour la pastille du menu.
 *
 * Borné aux trente derniers jours : une commande d'il y a trois mois sans
 * colis est un dossier perdu à régler une fois, pas une alerte quotidienne.
 */
export async function compterRetards(merchantId: string, maintenant = new Date()): Promise<number> {
  const { lotDelaiJours } = await prisma.merchant.findUniqueOrThrow({
    where: { id: merchantId },
    select: { lotDelaiJours: true },
  });
  const commandes = await prisma.envoiCommande.findMany({
    where: {
      merchantId,
      envoi: {
        emailedAt: {
          not: null,
          lt: new Date(maintenant.getTime() - lotDelaiJours * 86_400_000),
          gte: new Date(maintenant.getTime() - 30 * 86_400_000),
        },
      },
    },
    select: { shopifyOrderId: true },
  });
  if (commandes.length === 0) return 0;
  const expediees = new Set(
    (
      await prisma.parcel.findMany({
        where: { merchantId, shopifyOrderId: { in: commandes.map((commande) => commande.shopifyOrderId) } },
        select: { shopifyOrderId: true },
      })
    ).map((colis) => colis.shopifyOrderId),
  );
  return commandes.filter((commande) => !expediees.has(commande.shopifyOrderId)).length;
}
