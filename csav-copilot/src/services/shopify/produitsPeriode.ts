import type { ShopifyClient } from './client.ts';
import type { Plage } from '../stats/periode.ts';

/**
 * Classement des produits sur une période : unités vendues et chiffre
 * d'affaires, par produit et par pays de livraison — pour les ventes et,
 * séparément, pour les commandes annulées de la même période.
 *
 * Même requête que les commandes, enrichie des articles et de l'adresse de
 * livraison : on ne la sépare pas de `ventesPeriode.ts`, qui sert des cartes
 * différentes et n'a besoin ni de l'un ni de l'autre. Mêmes limites aussi —
 * trois mille commandes, vingt-cinq secondes — une boutique de PME n'en
 * dépasse pas la plage sur une période raisonnable.
 */

interface LigneBrute {
  titre: string;
  variante: string | null;
  sku: string | null;
  quantite: number;
  montant: number;
}

interface CommandeBrute {
  annulee: boolean;
  pays: string | null;
  lignes: LigneBrute[];
}

const QUERY = /* GraphQL */ `
  query ProduitsPeriode($query: String!, $cursor: String) {
    orders(first: 250, after: $cursor, query: $query, sortKey: CREATED_AT) {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        cancelledAt
        shippingAddress {
          countryCodeV2
        }
        lineItems(first: 50) {
          nodes {
            title
            variantTitle
            sku
            quantity
            discountedTotalSet {
              shopMoney {
                amount
              }
            }
          }
        }
      }
    }
  }
`;

export interface ProduitsBrutes {
  commandes: CommandeBrute[];
  tronque: boolean;
}

const COMMANDES_MAX = 3000;
const DELAI_MAX = 25_000;
const attendre = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function fetchProduitsEntre(client: ShopifyClient, depuis: Date, avant: Date): Promise<ProduitsBrutes> {
  const query = `created_at:>='${depuis.toISOString()}' created_at:<'${avant.toISOString()}'`;
  const commandes: CommandeBrute[] = [];
  let cursor: string | null = null;
  let essais = 0;
  const debut = Date.now();

  for (;;) {
    if (commandes.length >= COMMANDES_MAX || Date.now() - debut > DELAI_MAX) return { commandes, tronque: true };
    let data: {
      orders: {
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
        nodes: Array<{
          cancelledAt: string | null;
          shippingAddress: { countryCodeV2: string | null } | null;
          lineItems: { nodes: Array<{ title: string; variantTitle: string | null; sku: string | null; quantity: number; discountedTotalSet: { shopMoney: { amount: string } } | null }> };
        }>;
      };
    };
    try {
      data = await client.request(QUERY, { query, cursor });
    } catch (error) {
      const details = (error as { details?: unknown })?.details;
      const codes = Array.isArray(details) ? details.map((e) => e?.extensions?.code ?? '').join(' ') : '';
      if (/THROTTLED|throttled/i.test(`${codes} ${(error as Error)?.message}`) && essais < 4) {
        essais += 1;
        await attendre(1500 * essais);
        continue;
      }
      throw error;
    }
    essais = 0;

    for (const commande of data.orders.nodes) {
      commandes.push({
        annulee: Boolean(commande.cancelledAt),
        pays: commande.shippingAddress?.countryCodeV2 ?? null,
        lignes: commande.lineItems.nodes.map((ligne) => ({
          titre: ligne.title,
          variante: ligne.variantTitle ?? null,
          sku: ligne.sku ?? null,
          quantite: ligne.quantity,
          montant: Number(ligne.discountedTotalSet?.shopMoney.amount ?? 0) || 0,
        })),
      });
    }
    if (!data.orders.pageInfo.hasNextPage) return { commandes, tronque: false };
    cursor = data.orders.pageInfo.endCursor;
  }
}

/* ------------------------------------------------------------ cache ---- */

const DUREE_CACHE = 10 * 60_000;
const cache = new Map<string, { expire: number; valeur: Promise<ProduitsBrutes> }>();

function produitsEnCache(merchantId: string, client: ShopifyClient, p: Plage): Promise<ProduitsBrutes> {
  const cle = `${merchantId}|${p.depuis.getTime()}|${p.avant.getTime()}`;
  const connu = cache.get(cle);
  if (connu && connu.expire > Date.now()) return connu.valeur;
  const valeur = fetchProduitsEntre(client, p.depuis, p.avant);
  cache.set(cle, { expire: Date.now() + DUREE_CACHE, valeur });
  // Une erreur ne reste pas en mémoire : le prochain essai relit Shopify.
  valeur.catch(() => cache.delete(cle));
  if (cache.size > 200) cache.delete(cache.keys().next().value!);
  return valeur;
}

/* ------------------------------------------------------------ classement */

export interface LigneClassement {
  titre: string;
  variante: string | null;
  sku: string | null;
  unites: number;
  ca: number;
  pays: Record<string, number>;
  /** Le chiffre d'affaires de chaque pays, en regard de `pays` qui compte les
      unités : le filtre par pays ne doit pas afficher un CA resté global. */
  caPays: Record<string, number>;
}

/** Le produit d'une ligne : son SKU s'il en a un, sinon titre + déclinaison. */
const cleProduit = (titre: string, variante: string | null, sku: string | null) => sku || `${titre}__${variante ?? ''}`;

function classer(commandes: CommandeBrute[], annulee: boolean): LigneClassement[] {
  const parCle = new Map<string, LigneClassement>();
  for (const commande of commandes) {
    if (commande.annulee !== annulee) continue;
    for (const ligne of commande.lignes) {
      const cle = cleProduit(ligne.titre, ligne.variante, ligne.sku);
      let entree = parCle.get(cle);
      if (!entree) {
        entree = { titre: ligne.titre, variante: ligne.variante, sku: ligne.sku, unites: 0, ca: 0, pays: {}, caPays: {} };
        parCle.set(cle, entree);
      }
      entree.unites += ligne.quantite;
      entree.ca += ligne.montant;
      if (commande.pays) {
        entree.pays[commande.pays] = (entree.pays[commande.pays] ?? 0) + ligne.quantite;
        entree.caPays[commande.pays] = (entree.caPays[commande.pays] ?? 0) + ligne.montant;
      }
    }
  }
  return [...parCle.values()].sort((a, b) => b.unites - a.unites);
}

export async function classementProduits(merchantId: string, client: ShopifyClient, p: Plage) {
  const brutes = await produitsEnCache(merchantId, client, p);
  return {
    tronque: brutes.tronque,
    ventes: classer(brutes.commandes, false),
    annulations: classer(brutes.commandes, true),
  };
}
