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

/** Un numéro de suivi comparé sans espaces ni casse : « lx 123 cn » est « LX123CN ». */
const cleSuivi = (numero: string) => numero.replace(/\s+/g, '').toUpperCase();

/** Une expédition Shopify, réduite à ce que la correction d'un numéro consulte. */
export interface ExpeditionShopify {
  id: string;
  numeros: string[];
  transporteur: string | null;
}

/**
 * L'expédition Shopify qui porte déjà ce numéro de suivi, s'il y en a une.
 *
 * Si elle existe, le client a reçu ce numéro par e-mail : le corriger chez
 * nous seulement laisserait le mauvais chez lui. Une simple lecture — elle
 * part aussi en mode test.
 */
export async function expeditionPortant(
  client: ShopifyClient,
  orderId: string,
  numero: string,
): Promise<ExpeditionShopify | null> {
  const data = await client.request<{
    order: {
      fulfillments: Array<{ id: string; trackingInfo: Array<{ number: string | null; company: string | null }> }>;
    } | null;
  }>(
    /* GraphQL */ `
      query FulfillmentTracking($id: ID!) {
        order(id: $id) {
          fulfillments(first: 20) {
            id
            trackingInfo {
              number
              company
            }
          }
        }
      }
    `,
    { id: orderId },
  );

  for (const expedition of data.order?.fulfillments ?? []) {
    const numeros = expedition.trackingInfo.map((info) => info.number).filter((n): n is string => Boolean(n));
    if (numeros.some((n) => cleSuivi(n) === cleSuivi(numero))) {
      return { id: expedition.id, numeros, transporteur: expedition.trackingInfo[0]?.company ?? null };
    }
  }
  return null;
}

/**
 * Remplace un numéro de suivi dans une expédition déjà faite.
 *
 * Seul le numéro corrigé change : une commande de trois colis garde les deux
 * autres. Shopify écrit alors au client avec le numéro corrigé
 * (`notifyCustomer`) — c'est le but : il avait reçu le mauvais.
 */
export async function corrigerSuivi(
  client: ShopifyClient,
  expedition: ExpeditionShopify,
  ancien: string,
  nouveau: string,
  transporteur: string | null,
): Promise<{ corrige: true } | { corrige: false; raison: string }> {
  const numeros = expedition.numeros.map((n) => (cleSuivi(n) === cleSuivi(ancien) ? nouveau : n));

  const resultat = await client.request<{
    fulfillmentTrackingInfoUpdate: {
      fulfillment: { id: string } | null;
      userErrors: Array<{ message: string }>;
    };
  }>(
    /* GraphQL */ `
      mutation UpdateFulfillmentTracking(
        $fulfillmentId: ID!
        $trackingInfoInput: FulfillmentTrackingInput!
        $notifyCustomer: Boolean
      ) {
        fulfillmentTrackingInfoUpdate(
          fulfillmentId: $fulfillmentId
          trackingInfoInput: $trackingInfoInput
          notifyCustomer: $notifyCustomer
        ) {
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
      fulfillmentId: expedition.id,
      trackingInfoInput: { numbers: numeros, company: transporteur ?? expedition.transporteur ?? undefined },
      notifyCustomer: true,
    },
  );

  const erreurs = resultat.fulfillmentTrackingInfoUpdate.userErrors;
  if (erreurs.length > 0 || !resultat.fulfillmentTrackingInfoUpdate.fulfillment) {
    return { corrige: false, raison: erreurs[0]?.message ?? 'Refus Shopify sans motif.' };
  }
  return { corrige: true };
}
