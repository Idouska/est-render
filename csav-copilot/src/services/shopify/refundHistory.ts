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
  totalPriceSet: { shopMoney: { amount: string } };
  customer: { displayName: string | null; email: string | null } | null;
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
  /** Qui a été remboursé : la première question qu'on se pose devant la ligne. */
  customerName: string | null;
  customerEmail: string | null;
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
        totalPriceSet {
          shopMoney {
            amount
          }
        }
        customer {
          displayName
          email
        }
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
      const orderTotal = Number(order.totalPriceSet?.shopMoney.amount ?? 0);

      for (const refund of order.refunds ?? []) {
        const amount = refund.totalRefundedSet.shopMoney.amount;

        found.push({
          id: refund.id,
          shopifyOrderId: order.id,
          orderName: order.name,
          createdAt: refund.createdAt,
          amount,
          currency: refund.totalRefundedSet.shopMoney.currencyCode,
          // Une note vide n'est pas un motif : afficher « Remboursement
          // Shopify » sur trois cents lignes remplit une colonne sans rien
          // apprendre. Mieux vaut avouer l'absence.
          reason: refund.note?.trim() || '—',
          customerName: order.customer?.displayName ?? null,
          customerEmail: order.customer?.email ?? null,
          status: 'COMPLETED',
          // Total ou partiel se déduit du montant, il ne se devine pas. Annoncer
          // « Partiel » sur un remboursement intégral est un mensonge, et c'est
          // exactement ce que faisait la valeur codée en dur.
          kind:
            orderTotal > 0 && Number(amount) >= orderTotal - 0.01 ? 'FULL' : 'PARTIAL',
          external: true,
        });
      }
    }

    if (!data.orders.pageInfo.hasNextPage) break;
    cursor = data.orders.pageInfo.endCursor;
  }

  return found;
}
