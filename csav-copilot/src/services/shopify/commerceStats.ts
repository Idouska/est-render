import type { ShopifyClient } from './client.ts';

/**
 * Chiffres de la boutique, agrégés par jour.
 *
 * Tout vient de Shopify à la demande, sans table d'agrégats : une boutique de
 * PME se compte en centaines de commandes par mois, et une copie locale serait
 * une deuxième vérité à tenir — le jour où elle diverge, c'est elle qu'on
 * croit, puisque c'est elle qu'on affiche.
 *
 * La requête est taillée exprès, distincte de `OrderFields` : ici on veut des
 * montants et des dates par centaines, pas des adresses et des articles.
 */

interface RawStatsOrder {
  createdAt: string;
  cancelledAt: string | null;
  displayFinancialStatus: string | null;
  displayFulfillmentStatus: string | null;
  totalPriceSet: { shopMoney: { amount: string; currencyCode: string } };
  totalRefundedSet: { shopMoney: { amount: string } } | null;
}

export interface CommerceDay {
  day: string; // AAAA-MM-JJ
  revenue: number;
  orders: number;
  refunded: number;
}

export interface CommerceStats {
  currency: string;
  days: CommerceDay[];
  totals: {
    revenue: number;
    orders: number;
    averageOrder: number;
    refunded: number;
    refundRate: number; // part du CA rendue, entre 0 et 1
    unfulfilled: number;
    cancelled: number;
  };
}

const STATS_QUERY = /* GraphQL */ `
  query CommerceStats($query: String!, $cursor: String) {
    orders(first: 250, after: $cursor, query: $query, sortKey: CREATED_AT, reverse: true) {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        createdAt
        cancelledAt
        displayFinancialStatus
        displayFulfillmentStatus
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

export async function fetchCommerceStats(
  client: ShopifyClient,
  daysBack: number,
): Promise<CommerceStats> {
  const since = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000);
  const query = `created_at:>=${since.toISOString().slice(0, 10)}`;

  const orders: RawStatsOrder[] = [];
  let cursor: string | null = null;

  // 2 000 commandes au plus : douze pages. Au-delà, la fenêtre demandée est
  // trop large pour un calcul à la demande et le graphe n'y gagnerait rien —
  // on tronque en le disant par le compte, plutôt que d'attendre trente pages.
  while (orders.length < 2000) {
    const data: {
      orders: {
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
        nodes: RawStatsOrder[];
      };
    } = await client.request(STATS_QUERY, { query, cursor });

    orders.push(...data.orders.nodes);
    if (!data.orders.pageInfo.hasNextPage) break;
    cursor = data.orders.pageInfo.endCursor;
  }

  // Tous les jours de la fenêtre, y compris ceux sans vente : un graphe qui
  // saute les jours à zéro ment sur les creux.
  const byDay = new Map<string, CommerceDay>();
  for (let back = daysBack - 1; back >= 0; back -= 1) {
    const day = new Date(Date.now() - back * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    byDay.set(day, { day, revenue: 0, orders: 0, refunded: 0 });
  }

  const currency = orders[0]?.totalPriceSet.shopMoney.currencyCode ?? 'EUR';
  let cancelled = 0;
  let unfulfilled = 0;

  for (const order of orders) {
    if (order.cancelledAt) {
      cancelled += 1;
      continue; // une commande annulée n'est ni du CA ni un colis à suivre
    }

    const bucket = byDay.get(order.createdAt.slice(0, 10));
    const amount = Number(order.totalPriceSet.shopMoney.amount) || 0;
    const refunded = Number(order.totalRefundedSet?.shopMoney.amount ?? 0) || 0;

    if (bucket) {
      bucket.revenue += amount;
      bucket.orders += 1;
      bucket.refunded += refunded;
    }

    if (order.displayFulfillmentStatus === 'UNFULFILLED') unfulfilled += 1;
  }

  const days = [...byDay.values()];
  const revenue = days.reduce((total, day) => total + day.revenue, 0);
  const count = days.reduce((total, day) => total + day.orders, 0);
  const refunded = days.reduce((total, day) => total + day.refunded, 0);

  return {
    currency,
    days,
    totals: {
      revenue,
      orders: count,
      averageOrder: count ? revenue / count : 0,
      refunded,
      refundRate: revenue ? refunded / revenue : 0,
      unfulfilled,
      cancelled,
    },
  };
}
