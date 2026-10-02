import { prisma } from '../../lib/prisma.ts';
import { calculerFiabilite, type Fiabilite } from './fiabilite.ts';

/**
 * Les données de la fiabilité, lues en trois requêtes pour tous les ateliers
 * d'une boutique : demandes, commandes de lot, premiers colis.
 */
export async function fiabiliteDesFournisseurs(
  merchantId: string,
  jours = 30,
  maintenant = new Date(),
): Promise<Map<string, Fiabilite>> {
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

  const ateliers = new Set([
    ...demandes.map((demande) => demande.supplierId),
    ...commandes.map((commande) => commande.envoi.supplierId),
  ]);

  return new Map(
    [...ateliers].map((supplierId) => [
      supplierId,
      calculerFiabilite({
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
    ]),
  );
}
