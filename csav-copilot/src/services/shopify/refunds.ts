import { ShopifyError, type ShopifyClient } from './client.ts';

export interface RefundLineInput {
  /** GID de la ligne de commande (`gid://shopify/LineItem/...`). */
  lineItemId: string;
  quantity: number;
}

export interface CreateRefundInput {
  orderId: string;
  /** Montant à rembourser sur le moyen de paiement d'origine. */
  amount: string;
  currency: string;
  gateway: string;
  parentTransactionId: string;
  reason: string;
  lines?: RefundLineInput[];
}

export interface RefundableTransaction {
  id: string;
  gateway: string;
  maximumRefundableAmount: string;
  currency: string;
}

/**
 * Récupère les transactions remboursables d'une commande.
 * Nécessaire pour construire l'input de `refundCreate` : Shopify exige
 * l'identifiant de la transaction parente.
 */
export async function getRefundableTransactions(
  client: ShopifyClient,
  orderId: string,
): Promise<{ refundableAmount: string; currency: string; transactions: RefundableTransaction[] }> {
  const data = await client.request<{
    order: {
      currencyCode: string;
      totalRefundedSet: { shopMoney: { amount: string } };
      totalPriceSet: { shopMoney: { amount: string; currencyCode: string } };
      suggestedRefund: {
        amountSet: { shopMoney: { amount: string; currencyCode: string } };
        suggestedTransactions: Array<{
          gateway: string;
          maximumRefundableSet: { shopMoney: { amount: string; currencyCode: string } };
          parentTransaction: { id: string } | null;
        }>;
      } | null;
    } | null;
  }>(
    /* GraphQL */ `
      query RefundableTransactions($id: ID!) {
        order(id: $id) {
          currencyCode
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
          suggestedRefund {
            amountSet {
              shopMoney {
                amount
                currencyCode
              }
            }
            suggestedTransactions {
              gateway
              maximumRefundableSet {
                shopMoney {
                  amount
                  currencyCode
                }
              }
              parentTransaction {
                id
              }
            }
          }
        }
      }
    `,
    { id: orderId },
  );

  if (!data.order) {
    throw new ShopifyError(`Commande introuvable : ${orderId}`);
  }

  const suggested = data.order.suggestedRefund;

  return {
    refundableAmount: suggested?.amountSet.shopMoney.amount ?? '0.00',
    currency: data.order.currencyCode,
    transactions: (suggested?.suggestedTransactions ?? [])
      .filter((t) => t.parentTransaction !== null)
      .map((t) => ({
        id: t.parentTransaction!.id,
        gateway: t.gateway,
        maximumRefundableAmount: t.maximumRefundableSet.shopMoney.amount,
        currency: t.maximumRefundableSet.shopMoney.currencyCode,
      })),
  };
}

/**
 * Crée le remboursement côté Shopify.
 *
 * Cette fonction ne doit être appelée que depuis un endpoint qui a déjà :
 *  1. authentifié un utilisateur humain du marchand,
 *  2. reçu une confirmation explicite (modale côté dashboard),
 *  3. écrit une entrée d'audit `refund.requested`.
 *
 * Aucun chemin automatique (worker, IA) ne doit y accéder.
 */
export async function createRefund(
  client: ShopifyClient,
  input: CreateRefundInput,
): Promise<{ refundId: string }> {
  const data = await client.request<{
    refundCreate: {
      refund: { id: string } | null;
      userErrors: Array<{ field: string[] | null; message: string }>;
    };
  }>(
    /* GraphQL */ `
      mutation CreateRefund($input: RefundInput!) {
        refundCreate(input: $input) {
          refund {
            id
          }
          userErrors {
            field
            message
          }
        }
      }
    `,
    {
      input: {
        orderId: input.orderId,
        note: input.reason,
        notify: false,
        refundLineItems: (input.lines ?? []).map((line) => ({
          lineItemId: line.lineItemId,
          quantity: line.quantity,
        })),
        transactions: [
          {
            orderId: input.orderId,
            gateway: input.gateway,
            kind: 'REFUND',
            parentId: input.parentTransactionId,
            amount: input.amount,
          },
        ],
      },
    },
  );

  const { refund, userErrors } = data.refundCreate;

  if (userErrors.length > 0) {
    throw new ShopifyError(
      `Remboursement refusé par Shopify : ${userErrors.map((e) => e.message).join(' | ')}`,
      undefined,
      userErrors,
    );
  }

  if (!refund) {
    throw new ShopifyError('Shopify n’a retourné aucun remboursement');
  }

  return { refundId: refund.id };
}
