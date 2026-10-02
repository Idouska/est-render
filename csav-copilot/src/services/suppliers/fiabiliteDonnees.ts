import { prisma } from '../../lib/prisma.ts';
import { calculerFiabilite, calculerQualite, type Fiabilite, type Qualite } from './fiabilite.ts';

/**
 * Les données de la fiabilité, lues en quelques requêtes pour tous les
 * ateliers d'une boutique : demandes, commandes de lot, premiers colis — et,
 * sur 90 jours, retours et articles manquants pour la qualité.
 */
export async function fiabiliteDesFournisseurs(
  merchantId: string,
  jours = 30,
  maintenant = new Date(),
): Promise<Map<string, Fiabilite & { qualite: Qualite }>> {
  const depuis = new Date(maintenant.getTime() - jours * 86_400_000);

  const [merchant, demandes, commandes] = await Promise.all([
    prisma.merchant.findUniqueOrThrow({ where: { id: merchantId }, select: { lotDelaiJours: true } }),
    prisma.supplierAlert.findMany({
      where: { merchantId, createdAt: { gte: depuis } },
      // La réponse de l'atelier pose `acknowledgedAt` en même temps que le statut.
      select: { supplierId: true, createdAt: true, acknowledgedAt: true, status: true },
    }),
    prisma.envoiCommande.findMany({
      where: { merchantId, envoi: { emailedAt: { not: null, gte: depuis } } },
      select: { shopifyOrderId: true, envoi: { select: { supplierId: true, emailedAt: true } } },
    }),
  ]);

  const premiers = new Map<string, Date>();
  if (commandes.length) {
    const colis = await prisma.parcel.groupBy({
      by: ['shopifyOrderId'],
      where: { merchantId, shopifyOrderId: { in: commandes.map((commande) => commande.shopifyOrderId) } },
      _min: { createdAt: true },
    });
    for (const ligne of colis) {
      if (ligne.shopifyOrderId && ligne._min.createdAt) premiers.set(ligne.shopifyOrderId, ligne._min.createdAt);
    }
  }

  const qualite = await qualiteDesFournisseurs(merchantId, maintenant);

  const ateliers = new Set([
    ...demandes.map((demande) => demande.supplierId),
    ...commandes.map((commande) => commande.envoi.supplierId),
    ...qualite.keys(),
  ]);

  return new Map(
    [...ateliers].map((supplierId) => [
      supplierId,
      {
        qualite: qualite.get(supplierId) ?? calculerQualite({ commandes: 0, retours: [], manquants: 0 }),
        ...calculerFiabilite({
        demandes: demandes
          .filter((demande) => demande.supplierId === supplierId)
          .map((demande) => ({ creeLe: demande.createdAt, reponduLe: demande.acknowledgedAt, statut: demande.status })),
        commandes: commandes
          .filter((commande) => commande.envoi.supplierId === supplierId)
          .map((commande) => ({
            envoyeLe: commande.envoi.emailedAt!,
            expedieeLe: premiers.get(commande.shopifyOrderId) ?? null,
          })),
        delaiJours: merchant.lotDelaiJours,
        maintenant,
      }),
      },
    ]),
  );
}

/**
 * La qualité, sur les commandes des lots des 90 derniers jours. Un retour ou
 * un « article manquant » se rattache à l'atelier par sa commande : celle
 * qu'on lui a envoyée à préparer.
 */
async function qualiteDesFournisseurs(merchantId: string, maintenant: Date): Promise<Map<string, Qualite>> {
  const depuis = new Date(maintenant.getTime() - 90 * 86_400_000);
  const commandes = await prisma.envoiCommande.findMany({
    where: { merchantId, envoi: { emailedAt: { not: null, gte: depuis } } },
    select: { shopifyOrderId: true, envoi: { select: { supplierId: true } } },
  });
  if (commandes.length === 0) return new Map();

  const atelierDe = new Map(commandes.map((commande) => [commande.shopifyOrderId, commande.envoi.supplierId]));
  const ids = [...atelierDe.keys()];
  const [retours, manquants] = await Promise.all([
    prisma.returnCase.findMany({
      where: { merchantId, shopifyOrderId: { in: ids } },
      select: { shopifyOrderId: true, reason: true },
    }),
    prisma.supplierAlert.findMany({
      where: { merchantId, kind: 'MISSING_ITEM', shopifyOrderId: { in: ids } },
      select: { shopifyOrderId: true, supplierId: true },
    }),
  ]);

  const parAtelier = new Map<string, { commandes: number; retours: { raison: string }[]; manquants: Set<string> }>();
  const fiche = (supplierId: string) => {
    if (!parAtelier.has(supplierId)) parAtelier.set(supplierId, { commandes: 0, retours: [], manquants: new Set() });
    return parAtelier.get(supplierId)!;
  };
  for (const supplierId of atelierDe.values()) fiche(supplierId).commandes += 1;
  for (const retour of retours) {
    const supplierId = atelierDe.get(retour.shopifyOrderId!);
    if (supplierId) fiche(supplierId).retours.push({ raison: retour.reason });
  }
  // Une commande signalée deux fois ne compte qu'une fois — et seulement chez
  // l'atelier qui l'a préparée.
  for (const manquant of manquants) {
    if (atelierDe.get(manquant.shopifyOrderId!) === manquant.supplierId) {
      fiche(manquant.supplierId).manquants.add(manquant.shopifyOrderId!);
    }
  }

  return new Map(
    [...parAtelier].map(([supplierId, donnees]) => [
      supplierId,
      calculerQualite({ commandes: donnees.commandes, retours: donnees.retours, manquants: donnees.manquants.size }),
    ]),
  );
}
