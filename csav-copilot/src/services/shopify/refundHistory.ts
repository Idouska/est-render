import type { ShopifyClient } from './client.ts';

/**
 * Remboursements enregistrés chez Shopify, y compris ceux passés hors de
 * l'outil.
 *
 * L'écran ne montrait que les remboursements initiés depuis cSAV : sur une
 * boutique en activité, il restait donc vide pendant que la comptabilité
 * enregistrait des retours tous les jours. Un écran « Remboursements » qui
 * ignore la moitié des remboursements ne sert à personne — pire, il laisse
 * croire qu'il n'y en a pas.
 */

interface RawRefund {
  id: string;
  createdAt: string;
  note: string | null;
  totalRefundedSet: { shopMoney: { amount: string; currencyCode: string } };
}

interface RawOrder {
  id: string;
  name: string;
  refunds: RawRefund[];
}

export interface ShopRefund {
  id: string;
  shopifyOrderId: string;
  orderName: string;
  createdAt: string;
  amount: string;
  currency: string;
  reason: string;
  /** Toujours effectué : Shopify n'expose que les remboursements aboutis. */
  status: 'COMPLETED';
  kind: 'PARTIAL' | 'FULL';
  /** Passé hors de l'outil : l'origine distingue les deux sources à l'écran. */
  external: true;
}

const QUERY = /* GraphQL */ `
  query RefundHistory($query: String!, $cursor: String) {
    orders(first: 100, after: $cursor, query: $query, sortKey: CREATED_AT, reverse: true) {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        id
        name
        refunds(first: 10) {
          id
          createdAt
          note
          totalRefundedSet {
            shopMoney {
              amount
              currencyCode
            }
          }
        }
      }
    }
  }
`;

export async function fetchShopRefunds(
  client: ShopifyClient,
  daysBack: number,
): Promise<ShopRefund[]> {
  const since = new Date(Date.now() - daysBack * 86_400_000).toISOString().slice(0, 10);
  // Shopify n'expose pas de liste de remboursements : on passe par les
  // commandes dont l'état financier en porte la trace.
  const query = `created_at:>=${since} AND (financial_status:refunded OR financial_status:partially_refunded)`;

  const found: ShopRefund[] = [];
  let cursor: string | null = null;

  // Trois pages au plus : au-delà, la page en montre déjà bien assez pour
  // rapprocher une caisse, et l'écran doit rester rapide à ouvrir.
  for (let page = 0; page < 3; page += 1) {
    const data: {
      orders: {
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
        nodes: RawOrder[];
      };
    } = await client.request(QUERY, { query, cursor });

    for (const order of data.orders.nodes) {
      for (const refund of order.refunds ?? []) {
        found.push({
          id: refund.id,
          shopifyOrderId: order.id,
          orderName: order.name,
          createdAt: refund.createdAt,
          amount: refund.totalRefundedSet.shopMoney.amount,
          currency: refund.totalRefundedSet.shopMoney.currencyCode,
          reason: refund.note?.trim() || 'Remboursement Shopify',
          status: 'COMPLETED',
          kind: 'PARTIAL',
          external: true,
        });
      }
    }

    if (!data.orders.pageInfo.hasNextPage) break;
    cursor = data.orders.pageInfo.endCursor;
  }

  return found;
}
