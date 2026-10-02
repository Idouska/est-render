import { prisma } from '../../lib/prisma.ts';

/**
 * Le lot du jour, suivi après l'envoi.
 *
 * Le fichier Excel part, puis plus rien : le marchand ne savait pas si
 * l'atelier avait lancé une commande sans lui écrire, et l'atelier n'avait
 * aucune liste de ce qu'il avait reçu. Chaque commande envoyée a maintenant
 * un statut, lisible des deux côtés :
 *
 *   à préparer → en production → expédiée
 *
 * « En production » est un geste de l'atelier. « Expédiée » ne se déclare
 * pas : ce sont ses colis qui le disent, saisis comme d'habitude. Un statut
 * déclaré à côté des colis finirait par les contredire.
 */

import { statutDeLaCommande, type StatutLot } from './statutLot.ts';

export { resumeArticles, statutDeLaCommande, type StatutLot } from './statutLot.ts';

export interface CommandeDuLot {
  shopifyOrderId: string;
  orderName: string;
  articles: string | null;
  statut: StatutLot;
  enProductionLe: Date | null;
  suivis: string[];
}

export interface Lot {
  id: string;
  envoyeLe: Date;
  fournisseur: { id: string; name: string };
  commandes: CommandeDuLot[];
  compte: Record<StatutLot, number>;
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
  const depuis = new Date(Date.now() - (params.jours ?? 14) * 86_400_000);
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
        select: { shopifyOrderId: true, orderName: true, articles: true, enProductionLe: true },
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
      return {
        shopifyOrderId: commande.shopifyOrderId,
        orderName: commande.orderName,
        articles: commande.articles,
        statut: statutDeLaCommande({ enProductionLe: commande.enProductionLe, colis: numeros.length }),
        enProductionLe: commande.enProductionLe,
        suivis: numeros,
      };
    });
    const compte: Record<StatutLot, number> = { A_PREPARER: 0, EN_PRODUCTION: 0, EXPEDIEE: 0 };
    for (const commande of commandes) compte[commande.statut] += 1;
    return { id: envoi.id, envoyeLe: envoi.emailedAt!, fournisseur: envoi.supplier, commandes, compte };
  });
}

/**
 * L'atelier lance (ou suspend) des commandes de ses lots.
 *
 * Bornée à SES envois : un identifiant de commande venu du navigateur ne
 * touche jamais la commande d'un lot adressé à un autre fournisseur.
 */
export async function marquerEnProduction(params: {
  merchantId: string;
  supplierId: string;
  shopifyOrderIds: readonly string[];
  enProduction: boolean;
}): Promise<number> {
  const resultat = await prisma.envoiCommande.updateMany({
    where: {
      merchantId: params.merchantId,
      shopifyOrderId: { in: [...params.shopifyOrderIds] },
      envoi: { supplierId: params.supplierId },
    },
    data: { enProductionLe: params.enProduction ? new Date() : null },
  });
  return resultat.count;
}
