import type { ShopifyClient } from './client.ts';
import { cadres, serieVide, type Cadre, type Periode, type Plage } from '../stats/periode.ts';

/**
 * Les ventes d'une période, point par point : chiffre d'affaires, commandes,
 * panier moyen, remboursé.
 *
 * Mêmes champs que `CommerceStats`, bornés par deux instants plutôt que par
 * « N jours » : la période se choisit au calendrier, et la comparaison lit
 * une autre plage de dates. Le remboursé est celui des commandes passées
 * pendant la période, quelle que soit la date du remboursement — ce que dit
 * le sous-titre de la carte.
 *
 * Trois mille commandes au plus par plage, vingt-cinq secondes au plus :
 * au-delà, la réponse le dit (`tronque`) plutôt que de faire attendre. Le
 * résultat est gardé dix minutes : changer de regroupement ou rouvrir l'écran
 * ne relit pas Shopify.
 */

interface CommandeBrute {
  createdAt: string;
  cancelledAt: string | null;
  totalPriceSet: { shopMoney: { amount: string; currencyCode: string } };
  totalRefundedSet: { shopMoney: { amount: string } } | null;
}

const QUERY = /* GraphQL */ `
  query VentesPeriode($query: String!, $cursor: String) {
    orders(first: 250, after: $cursor, query: $query, sortKey: CREATED_AT) {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        createdAt
        cancelledAt
        totalPriceSet {
          shopMoney {
            amount
            currencyCode
          }
        }
        totalRefundedSet {
          shopMoney {
            amount
          }
        }
      }
    }
  }
`;

export interface VentesBrutes {
  devise: string | null;
  commandes: Array<{ instant: number; montant: number; rembourse: number }>;
  tronque: boolean;
}

const COMMANDES_MAX = 3000;
const DELAI_MAX = 25_000;
const attendre = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function fetchVentesEntre(client: ShopifyClient, depuis: Date, avant: Date): Promise<VentesBrutes> {
  const query = `created_at:>='${depuis.toISOString()}' created_at:<'${avant.toISOString()}'`;
  const commandes: VentesBrutes['commandes'] = [];
  let devise: string | null = null;
  let cursor: string | null = null;
  let essais = 0;
  const debut = Date.now();

  for (;;) {
    if (commandes.length >= COMMANDES_MAX || Date.now() - debut > DELAI_MAX) return { devise, commandes, tronque: true };
    let data: { orders: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: CommandeBrute[] } };
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
      devise ??= commande.totalPriceSet.shopMoney.currencyCode;
      // Une commande annulée n'est pas du chiffre d'affaires.
      if (commande.cancelledAt) continue;
      commandes.push({
        instant: Date.parse(commande.createdAt),
        montant: Number(commande.totalPriceSet.shopMoney.amount) || 0,
        rembourse: Number(commande.totalRefundedSet?.shopMoney.amount ?? 0) || 0,
      });
    }
    if (!data.orders.pageInfo.hasNextPage) return { devise, commandes, tronque: false };
    cursor = data.orders.pageInfo.endCursor;
  }
}

/* ------------------------------------------------------------ cache ---- */

const DUREE_CACHE = 10 * 60_000;
const cache = new Map<string, { expire: number; valeur: Promise<VentesBrutes> }>();

function ventesEnCache(merchantId: string, client: ShopifyClient, p: Plage): Promise<VentesBrutes> {
  const cle = `${merchantId}|${p.depuis.getTime()}|${p.avant.getTime()}`;
  const connu = cache.get(cle);
  if (connu && connu.expire > Date.now()) return connu.valeur;
  const valeur = fetchVentesEntre(client, p.depuis, p.avant);
  cache.set(cle, { expire: Date.now() + DUREE_CACHE, valeur });
  // Une erreur ne reste pas en mémoire : le prochain essai relit Shopify.
  valeur.catch(() => cache.delete(cle));
  if (cache.size > 200) cache.delete(cache.keys().next().value!);
  return valeur;
}

/* ------------------------------------------------------------ séries --- */

export interface ChiffresVentes {
  totaux: { ca: number; commandes: number; panier: number | null; rembourse: number; partRembourse: number | null };
  series: {
    ca: Array<number | null>;
    commandes: Array<number | null>;
    panier: Array<number | null>;
    rembourse: Array<number | null>;
  };
}

export function agregerVentes(brutes: VentesBrutes, p: Cadre): ChiffresVentes {
  const { place } = p;
  const ca = serieVide(p);
  const commandes = serieVide(p);
  const rembourse = serieVide(p);
  let total = 0;
  let nombre = 0;
  let rendu = 0;
  for (const commande of brutes.commandes) {
    const i = place(commande.instant);
    if (i < 0) continue;
    ca[i] = (ca[i] ?? 0) + commande.montant;
    commandes[i] = (commandes[i] ?? 0) + 1;
    rembourse[i] = (rembourse[i] ?? 0) + commande.rembourse;
    total += commande.montant;
    nombre += 1;
    rendu += commande.rembourse;
  }
  return {
    totaux: {
      ca: total,
      commandes: nombre,
      panier: nombre ? total / nombre : null,
      rembourse: rendu,
      partRembourse: total ? rendu / total : null,
    },
    series: {
      ca,
      commandes,
      panier: ca.map((v, i) => (v === null || !commandes[i] ? null : v / commandes[i]!)),
      rembourse,
    },
  };
}

export async function statsVentesPeriode(merchantId: string, client: ShopifyClient, periode: Periode) {
  const { courante, comparee } = periode;
  const cadre = cadres(periode);
  const [brutes, brutesComparees] = await Promise.all([
    ventesEnCache(merchantId, client, courante),
    comparee ? ventesEnCache(merchantId, client, comparee) : null,
  ]);
  return {
    devise: brutes.devise ?? brutesComparees?.devise ?? 'EUR',
    tronque: brutes.tronque || Boolean(brutesComparees?.tronque),
    courant: agregerVentes(brutes, cadre.courant),
    compare: brutesComparees && cadre.compare ? agregerVentes(brutesComparees, cadre.compare) : null,
  };
}
