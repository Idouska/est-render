import type { ShopifyClient } from './client.ts';

/**
 * Création du fulfillment Shopify quand l'atelier a fini d'emballer.
 *
 * Le chaînon qui manquait à toute la boucle fournisseur : le numéro de suivi
 * saisi dans l'atelier restait chez nous, Shopify considérait la commande
 * comme non expédiée, et le client n'avait jamais son mail d'expédition. La
 * première question du SAV — « où est mon colis ? » — était fabriquée par
 * l'outil lui-même.
 *
 * Déclenché quand le dernier colis de la commande est saisi, pas au premier :
 * un seul fulfillment portant tous les numéros vaut mieux que des expéditions
 * partielles qui envoient trois mails au client pour une seule commande.
 * `notifyCustomer` est le but de l'opération, pas une option.
 */

interface FulfillmentOrderNode {
  id: string;
  status: string;
}

export async function fulfillOrder(
  client: ShopifyClient,
  orderId: string,
  tracking: { numbers: string[]; company: string | null },
): Promise<{ fulfilled: boolean; reason?: string }> {
  const data = await client.request<{
    order: { fulfillmentOrders: { nodes: FulfillmentOrderNode[] } } | null;
  }>(
    /* GraphQL */ `
      query FulfillmentOrders($id: ID!) {
        order(id: $id) {
          fulfillmentOrders(first: 10) {
            nodes {
              id
              status
            }
          }
        }
      }
    `,
    { id: orderId },
  );

  // Seuls les fulfillment orders encore ouverts se remplissent : une commande
  // déjà expédiée depuis Shopify ne doit pas l'être une seconde fois.
  const open = (data.order?.fulfillmentOrders.nodes ?? []).filter(
    (node) => node.status === 'OPEN' || node.status === 'IN_PROGRESS',
  );

  if (open.length === 0) {
    return { fulfilled: false, reason: 'Commande déjà expédiée ou sans expédition ouverte.' };
  }

  const result = await client.request<{
    fulfillmentCreate: {
      fulfillment: { id: string } | null;
      userErrors: Array<{ message: string }>;
    };
  }>(
    /* GraphQL */ `
      mutation CreateFulfillment($fulfillment: FulfillmentInput!) {
        fulfillmentCreate(fulfillment: $fulfillment) {
          fulfillment {
            id
          }
          userErrors {
            message
          }
        }
      }
    `,
    {
      fulfillment: {
        lineItemsByFulfillmentOrder: open.map((node) => ({ fulfillmentOrderId: node.id })),
        trackingInfo: {
          numbers: tracking.numbers,
          company: tracking.company ?? undefined,
        },
        notifyCustomer: true,
      },
    },
  );

  const errors = result.fulfillmentCreate.userErrors;
  if (errors.length > 0 || !result.fulfillmentCreate.fulfillment) {
    return { fulfilled: false, reason: errors[0]?.message ?? 'Refus Shopify sans motif.' };
  }

  return { fulfilled: true };
}
