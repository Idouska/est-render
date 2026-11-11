import { prisma } from '../../lib/prisma.ts';
import type { Plage } from './periode.ts';

/**
 * Classement des retours et des échanges, par produit et par pays, sur une
 * période — pendant de `classementProduits` côté Shopify, mais tiré de
 * `ReturnCase`, qui porte déjà le produit et le pays du client. Toujours
 * disponible, même quand Shopify ne répond pas : rien ici ne l'interroge.
 */

export interface LigneRetour {
  titre: string;
  variante: string | null;
  sku: string | null;
  unites: number;
  pays: Record<string, number>;
}

const cleProduit = (titre: string, variante: string | null, sku: string | null) => sku || `${titre}__${variante ?? ''}`;

async function classerReturnCase(merchantId: string, p: Plage, resolution: 'REFUND' | 'EXCHANGE'): Promise<LigneRetour[]> {
  const lignes = await prisma.returnCase.groupBy({
    by: ['productTitle', 'variantTitle', 'sku', 'country'],
    where: {
      merchantId,
      test: false,
      resolution,
      createdAt: { gte: p.depuis, lt: p.avant },
    },
    _count: { _all: true },
  });

  const parCle = new Map<string, LigneRetour>();
  for (const ligne of lignes) {
    const cle = cleProduit(ligne.productTitle, ligne.variantTitle, ligne.sku);
    let entree = parCle.get(cle);
    if (!entree) {
      entree = { titre: ligne.productTitle, variante: ligne.variantTitle, sku: ligne.sku, unites: 0, pays: {} };
      parCle.set(cle, entree);
    }
    entree.unites += ligne._count._all;
    if (ligne.country) entree.pays[ligne.country] = (entree.pays[ligne.country] ?? 0) + ligne._count._all;
  }
  return [...parCle.values()].sort((a, b) => b.unites - a.unites);
}

export async function classementRetoursEchanges(merchantId: string, p: Plage) {
  const [retours, echanges] = await Promise.all([
    classerReturnCase(merchantId, p, 'REFUND'),
    classerReturnCase(merchantId, p, 'EXCHANGE'),
  ]);
  return { retours, echanges };
}
