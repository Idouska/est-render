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

export interface ShippingAddress {
  name: string | null;
  address1: string | null;
  address2: string | null;
  city: string | null;
  zip: string | null;
  province: string | null;
  country: string | null;
  phone: string | null;
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
  // Adresse au moment de la commande — utile pour vérifier une livraison en
  // litige, distincte de l'adresse actuelle du client s'il en a changé depuis.
  shippingAddress: ShippingAddress | null;
}

/** Représentation courte, sur une ligne — usage : messages, portail fournisseur. */
export function formatAddress(address: ShippingAddress | null): string | null {
  if (!address) return null;
  return [
    address.name,
    [address.address1, address.address2].filter(Boolean).join(' '),
    [address.zip, address.city].filter(Boolean).join(' '),
    address.province,
    address.country,
  ]
    .filter((part) => part && part.trim() !== '')
    .join(', ');
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
    shippingAddress {
      name
      address1
      address2
      city
      zip
      provinceCode
      countryCodeV2
      phone
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
  shippingAddress: {
    name: string | null;
    address1: string | null;
    address2: string | null;
    city: string | null;
    zip: string | null;
    provinceCode: string | null;
    countryCodeV2: string | null;
    phone: string | null;
  } | null;
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
    shippingAddress: order.shippingAddress
      ? {
          name: order.shippingAddress.name,
          address1: order.shippingAddress.address1,
          address2: order.shippingAddress.address2,
          city: order.shippingAddress.city,
          zip: order.shippingAddress.zip,
          province: order.shippingAddress.provinceCode,
          country: order.shippingAddress.countryCodeV2,
          phone: order.shippingAddress.phone,
        }
      : null,
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

export interface OrderPage {
  orders: OrderSummary[];
  /** Curseur du dernier élément, à repasser tel quel pour la page suivante. */
  cursor: string | null;
  hasNextPage: boolean;
}

/**
 * Liste paginée des commandes, de la plus récente à la plus ancienne.
 *
 * Distincte de `searchOrders` : celle-ci sert le rattachement d'un mail à une
 * commande et renvoie un lot court sans pagination. Ici on parcourt le carnet
 * de commandes, ce qui demande un curseur — Shopify pagine par `endCursor`,
 * jamais par numéro de page.
 */
export async function listOrders(
  client: ShopifyClient,
  options: { query?: string; limit?: number; cursor?: string | null } = {},
): Promise<OrderPage> {
  const { query = '', limit = 25, cursor = null } = options;

  const data = await client.request<{
    orders: {
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
      nodes: RawOrder[];
    };
  }>(
    /* GraphQL */ `
      ${ORDER_FIELDS}
      query ListOrders($query: String, $limit: Int!, $cursor: String) {
        orders(
          first: $limit
          after: $cursor
          query: $query
          sortKey: CREATED_AT
          reverse: true
        ) {
          pageInfo {
            hasNextPage
            endCursor
          }
          nodes {
            ...OrderFields
          }
        }
      }
    `,
    { query: query || null, limit, cursor },
  );

  return {
    orders: data.orders.nodes.map(toSummary),
    cursor: data.orders.pageInfo.endCursor,
    hasNextPage: data.orders.pageInfo.hasNextPage,
  };
}
