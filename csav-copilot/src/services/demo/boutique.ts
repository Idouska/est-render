import type { JeuFictif, ProduitFictif } from '../shopify/mock.ts';
import { commandesDemo, DEMO, imageDemo, PRODUITS, skuDemo } from './catalogue.ts';

const JOUR = 86_400_000;

/*
 * Les déclinaisons épuisées : celles que l'atelier signale en rupture dans la
 * démo. Le catalogue doit dire la même chose que la page des ruptures.
 */
const EPUISEES = new Set([skuDemo('trail', 0, '43'), skuDemo('street', 1, '41'), skuDemo('aero', 1, '40')]);

/** Le catalogue Kairo : chaque coloris de chaque modèle, en toutes tailles. */
export function catalogueDemo(maintenant = Date.now()): ProduitFictif[] {
  return PRODUITS.map((produit, rang) => ({
    id: `gid://shopify/Product/${8100 + rang}`,
    titre: produit.titre,
    type: produit.type,
    image: imageDemo(produit.coloris[0]!.image),
    statut: 'ACTIVE' as const,
    majLe: new Date(maintenant - (rang + 1) * 2 * JOUR).toISOString(),
    variantes: produit.coloris.flatMap((coloris, c) =>
      produit.tailles.map((taille, t) => {
        const sku = skuDemo(produit.cle, c, taille);
        return {
          id: `gid://shopify/ProductVariant/${8100 + rang}${c}${String(t).padStart(2, '0')}`,
          titre: `${coloris.nom} / ${taille}`,
          sku,
          prix: produit.prix,
          // Un stock plausible : plus dans les tailles du milieu, rien dans
          // les déclinaisons épuisées.
          stock: EPUISEES.has(sku) ? 0 : 2 + ((rang * 5 + c * 3 + t * 7) % 9) + (t > 1 && t < 6 ? 4 : 0),
          image: imageDemo(coloris.image),
        };
      }),
    ),
  }));
}

export function jeuDemo(maintenant = Date.now()): JeuFictif {
  const commandes = commandesDemo(maintenant);
  const commande = (nom: string) => commandes.find((c) => c.name === nom)!;
  return {
    nom: DEMO.marque,
    vendeur: DEMO.marque,
    typeProduit: 'Baskets',
    commandes,
    produits: catalogueDemo(maintenant),
    collections: ['Baskets', 'Nouveautés', 'Running', 'Accessoires'],
    produitsStats: PRODUITS.map((produit) => [produit.titre, produit.coloris.map((c) => `${c.nom} / 42`), produit.prix]),
    litige: { commande: '#4104', montant: '139.00' },
    remboursementsRecents: [
      { commande: commande('#4114'), montant: '139.00', note: 'Retour reçu et accepté', ilYaJours: 3 },
      { commande: commande('#4108'), montant: '38.70', note: 'Geste commercial — défaut de couture', ilYaJours: 6 },
    ],
  };
}
