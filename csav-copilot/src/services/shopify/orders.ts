import type { ShopifyClient } from './client.ts';

export interface OrderLineItem {
  title: string;
  quantity: number;
  variantTitle: string | null;
}

export interface Fulfillment {
  status: string;
  trackingCompany: string | null;
  trackingNumber: string | null;
  trackingUrl: string | null;
  estimatedDeliveryAt: string | null;
  updatedAt: string;
}

export interface OrderSummary {
  id: string;
  name: string; // ex. #1042
  createdAt: string;
  displayFinancialStatus: string | null;
  displayFulfillmentStatus: string | null;
  totalPrice: string;
  currency: string;
  customer: {
    id: string | null;
    email: string | null;
    displayName: string | null;
    numberOfOrders: number | null;
    amountSpent: string | null;
    createdAt: string | null;
  } | null;
  lineItems: OrderLineItem[];
  fulfillments: Fulfillment[];
}

const ORDER_FIELDS = /* GraphQL */ `
  fragment OrderFields on Order {
    id
    name
    createdAt
    displayFinancialStatus
    displayFulfillmentStatus
    totalPriceSet {
      shopMoney {
        amount
        currencyCode
      }
    }
    customer {
      id
      email
      displayName
      numberOfOrders
      createdAt
      amountSpent {
        amount
      }
    }
    lineItems(first: 25) {
      nodes {
        title
        quantity
        variantTitle
      }
    }
    fulfillments(first: 10) {
      status
      updatedAt
      estimatedDeliveryAt
      trackingInfo {
        company
        number
        url
      }
    }
  }
`;

interface RawOrder {
  id: string;
  name: string;
  createdAt: string;
  displayFinancialStatus: string | null;
  displayFulfillmentStatus: string | null;
  totalPriceSet: { shopMoney: { amount: string; currencyCode: string } };
  customer: {
    id: string;
    email: string | null;
    displayName: string | null;
    numberOfOrders: string | number | null;
    createdAt: string | null;
    amountSpent: { amount: string } | null;
  } | null;
  lineItems: { nodes: Array<{ title: string; quantity: number; variantTitle: string | null }> };
  fulfillments: Array<{
    status: string;
    updatedAt: string;
    estimatedDeliveryAt: string | null;
    trackingInfo: Array<{ company: string | null; number: string | null; url: string | null }>;
  }>;
}

function toSummary(order: RawOrder): OrderSummary {
  return {
    id: order.id,
    name: order.name,
    createdAt: order.createdAt,
    displayFinancialStatus: order.displayFinancialStatus,
    displayFulfillmentStatus: order.displayFulfillmentStatus,
    totalPrice: order.totalPriceSet.shopMoney.amount,
    currency: order.totalPriceSet.shopMoney.currencyCode,
    customer: order.customer
      ? {
          id: order.customer.id,
          email: order.customer.email,
          displayName: order.customer.displayName,
          numberOfOrders:
            order.customer.numberOfOrders === null
              ? null
              : Number(order.customer.numberOfOrders),
          amountSpent: order.customer.amountSpent?.amount ?? null,
          createdAt: order.customer.createdAt,
        }
      : null,
    lineItems: order.lineItems.nodes,
    fulfillments: order.fulfillments.map((f) => ({
      status: f.status,
      updatedAt: f.updatedAt,
      estimatedDeliveryAt: f.estimatedDeliveryAt,
      trackingCompany: f.trackingInfo[0]?.company ?? null,
      trackingNumber: f.trackingInfo[0]?.number ?? null,
      trackingUrl: f.trackingInfo[0]?.url ?? null,
    })),
  };
}

/** Recherche par requête Shopify (`email:...`, `name:#1042`, ...). */
export async function searchOrders(
  client: ShopifyClient,
  query: string,
  limit = 10,
): Promise<OrderSummary[]> {
  const data = await client.request<{ orders: { nodes: RawOrder[] } }>(
    /* GraphQL */ `
      ${ORDER_FIELDS}
      query SearchOrders($query: String!, $limit: Int!) {
        orders(first: $limit, query: $query, sortKey: CREATED_AT, reverse: true) {
          nodes {
            ...OrderFields
          }
        }
      }
    `,
    { query, limit },
  );

  return data.orders.nodes.map(toSummary);
}

export async function getOrderById(
  client: ShopifyClient,
  orderId: string,
): Promise<OrderSummary | null> {
  const data = await client.request<{ order: RawOrder | null }>(
    /* GraphQL */ `
      ${ORDER_FIELDS}
      query GetOrder($id: ID!) {
        order(id: $id) {
          ...OrderFields
        }
      }
    `,
    { id: orderId },
  );

  return data.order ? toSummary(data.order) : null;
}

/** Échappe une valeur pour l'insérer dans une requête de recherche Shopify. */
export function quoteSearchValue(value: string): string {
  return `"${value.replace(/["\\]/g, '\\$&')}"`;
}
