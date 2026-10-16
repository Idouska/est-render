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

/* ------------------------------------------------------------------------ */

/**
 * Les remboursements d'une période, avec leurs articles — pour les
 * statistiques.
 *
 * La liste ci-dessus ne lit qu'un montant et une note par remboursement :
 * assez pour rapprocher une caisse, pas pour dire quels produits reviennent.
 * Ici chaque remboursement porte ses lignes remboursées, et chaque commande
 * ses premiers articles : un remboursement fait sans préciser d'article se
 * rattache à la commande entière, ou à son article unique.
 *
 * Les commandes sont lues par date de mise à jour : un remboursement met la
 * commande à jour, alors qu'une commande de janvier remboursée en mars ne
 * serait pas « créée » en mars.
 *
 * Shopify refuse une requête dont le coût dépasse 1 000 points, et ne publie
 * pas la formule exacte : la page rétrécit de moitié tant qu'il la trouve
 * trop chère, et on attend quand il demande d'attendre. Au-delà du temps ou
 * des pages accordés, le résultat est marqué partiel plutôt que faux.
 */
export interface LigneRemboursee {
  title: string;
  variantTitle: string | null;
  quantity: number;
  amount: number | null;
  image: string | null;
}

export interface RemboursementDetaille {
  id: string;
  shopifyOrderId: string;
  orderName: string;
  orderTotal: number;
  createdAt: string;
  amount: number;
  currency: string;
  note: string | null;
  lignes: LigneRemboursee[];
  lignesCommande: LigneRemboursee[];
}

const QUERY_DETAILS = /* GraphQL */ `
  query RefundStats($query: String!, $cursor: String, $first: Int!) {
    orders(first: $first, after: $cursor, query: $query, sortKey: UPDATED_AT, reverse: true) {
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
        lineItems(first: 5) {
          nodes {
            title
            variantTitle
            quantity
            discountedTotalSet {
              shopMoney {
                amount
              }
            }
            image {
              url
            }
          }
        }
        refunds(first: 5) {
          id
          createdAt
          note
          totalRefundedSet {
            shopMoney {
              amount
              currencyCode
            }
          }
          refundLineItems(first: 5) {
            nodes {
              quantity
              subtotalSet {
                shopMoney {
                  amount
                }
              }
              lineItem {
                title
                variantTitle
                image {
                  url
                }
              }
            }
          }
        }
      }
    }
  }
`;

interface RawLigne {
  title: string;
  variantTitle: string | null;
  quantity: number;
  discountedTotalSet?: { shopMoney: { amount: string } } | null;
  image: { url: string } | null;
}

interface RawOrderDetaille {
  id: string;
  name: string;
  totalPriceSet: { shopMoney: { amount: string } } | null;
  lineItems: { nodes: RawLigne[] } | null;
  refunds: Array<{
    id: string;
    createdAt: string;
    note: string | null;
    totalRefundedSet: { shopMoney: { amount: string; currencyCode: string } };
    refundLineItems: {
      nodes: Array<{
        quantity: number;
        subtotalSet: { shopMoney: { amount: string } } | null;
        lineItem: { title: string; variantTitle: string | null; image: { url: string } | null } | null;
      }>;
    } | null;
  }> | null;
}

const attendre = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function codesErreur(error: unknown): string[] {
  const details = (error as { details?: unknown })?.details;
  const codes = Array.isArray(details)
    ? details.map((e: { extensions?: { code?: string } }) => e?.extensions?.code ?? '')
    : [];
  return [...codes, String((error as Error)?.message ?? '')];
}

export async function fetchRefundDetails(
  client: ShopifyClient,
  depuis: Date,
  { pagesMax = 20, delaiMax = 25_000 }: { pagesMax?: number; delaiMax?: number } = {},
): Promise<{ remboursements: RemboursementDetaille[]; partiel: boolean }> {
  const query = `updated_at:>=${depuis.toISOString().slice(0, 10)} AND (financial_status:refunded OR financial_status:partially_refunded)`;
  const debut = Date.now();
  const remboursements: RemboursementDetaille[] = [];
  let cursor: string | null = null;
  let first = 25;
  let pages = 0;
  let essais = 0;

  for (;;) {
    if (pages >= pagesMax || Date.now() - debut > delaiMax) return { remboursements, partiel: true };

    let data: { orders: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: RawOrderDetaille[] } };
    try {
      data = await client.request(QUERY_DETAILS, { query, cursor, first });
    } catch (error) {
      const codes = codesErreur(error).join(' ');
      if (/MAX_COST_EXCEEDED|exceeds the single query max cost/i.test(codes) && first > 2) {
        first = Math.max(2, Math.floor(first / 2));
        continue;
      }
      if (/THROTTLED|throttled/i.test(codes) && essais < 4) {
        essais += 1;
        await attendre(1500 * essais);
        continue;
      }
      throw error;
    }
    essais = 0;
    pages += 1;

    for (const order of data.orders.nodes) {
      const lignesCommande = (order.lineItems?.nodes ?? []).map((ligne) => ({
        title: ligne.title,
        variantTitle: ligne.variantTitle,
        quantity: ligne.quantity,
        amount: ligne.discountedTotalSet ? Number(ligne.discountedTotalSet.shopMoney.amount) : null,
        image: ligne.image?.url ?? null,
      }));
      for (const refund of order.refunds ?? []) {
        if (new Date(refund.createdAt) < depuis) continue;
        remboursements.push({
          id: refund.id,
          shopifyOrderId: order.id,
          orderName: order.name,
          orderTotal: Number(order.totalPriceSet?.shopMoney.amount ?? 0),
          createdAt: refund.createdAt,
          amount: Number(refund.totalRefundedSet.shopMoney.amount),
          currency: refund.totalRefundedSet.shopMoney.currencyCode,
          note: refund.note?.trim() || null,
          lignes: (refund.refundLineItems?.nodes ?? [])
            .filter((ligne) => ligne.lineItem)
            .map((ligne) => ({
              title: ligne.lineItem!.title,
              variantTitle: ligne.lineItem!.variantTitle,
              quantity: ligne.quantity,
              amount: ligne.subtotalSet ? Number(ligne.subtotalSet.shopMoney.amount) : null,
              image: ligne.lineItem!.image?.url ?? null,
            })),
          lignesCommande,
        });
      }
    }

    if (!data.orders.pageInfo.hasNextPage) return { remboursements, partiel: false };
    cursor = data.orders.pageInfo.endCursor;
  }
}
