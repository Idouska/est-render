import type { ShopifyClient } from './client.ts';

/**
 * Fiche client telle qu'affichée dans la liste.
 *
 * Volontairement plus courte que ce que renvoie Shopify : le SAV a besoin de
 * savoir qui écrit, depuis quand il achète et combien il a dépensé — pas de
 * son historique marketing.
 */
export interface CustomerSummary {
  id: string;
  displayName: string | null;
  email: string | null;
  phone: string | null;
  numberOfOrders: number;
  amountSpent: string;
  currency: string;
  createdAt: string;
  lastOrder: { name: string; createdAt: string } | null;
  city: string | null;
  country: string | null;
}

interface RawCustomer {
  id: string;
  displayName: string | null;
  defaultEmailAddress: { emailAddress: string | null } | null;
  defaultPhoneNumber: { phoneNumber: string | null } | null;
  numberOfOrders: string | number;
  amountSpent: { amount: string; currencyCode: string };
  createdAt: string;
  defaultAddress: { city: string | null; countryCodeV2: string | null } | null;
  lastOrder: { name: string; createdAt: string } | null;
}

const CUSTOMER_FIELDS = /* GraphQL */ `
  fragment CustomerFields on Customer {
    id
    displayName
    defaultEmailAddress {
      emailAddress
    }
    defaultPhoneNumber {
      phoneNumber
    }
    numberOfOrders
    amountSpent {
      amount
      currencyCode
    }
    createdAt
    defaultAddress {
      city
      countryCodeV2
    }
    lastOrder {
      name
      createdAt
    }
  }
`;

function toSummary(customer: RawCustomer): CustomerSummary {
  return {
    id: customer.id,
    displayName: customer.displayName,
    email: customer.defaultEmailAddress?.emailAddress ?? null,
    phone: customer.defaultPhoneNumber?.phoneNumber ?? null,
    numberOfOrders: Number(customer.numberOfOrders),
    amountSpent: customer.amountSpent.amount,
    currency: customer.amountSpent.currencyCode,
    createdAt: customer.createdAt,
    lastOrder: customer.lastOrder,
    city: customer.defaultAddress?.city ?? null,
    country: customer.defaultAddress?.countryCodeV2 ?? null,
  };
}

export interface CustomerPage {
  customers: CustomerSummary[];
  cursor: string | null;
  hasNextPage: boolean;
}

/** Liste paginée des clients, du plus récemment créé au plus ancien. */
export async function listCustomers(
  client: ShopifyClient,
  options: { query?: string; limit?: number; cursor?: string | null } = {},
): Promise<CustomerPage> {
  const { query = '', limit = 25, cursor = null } = options;

  const data = await client.request<{
    customers: {
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
      nodes: RawCustomer[];
    };
  }>(
    /* GraphQL */ `
      ${CUSTOMER_FIELDS}
      query ListCustomers($query: String, $limit: Int!, $cursor: String) {
        customers(
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
            ...CustomerFields
          }
        }
      }
    `,
    { query: query || null, limit, cursor },
  );

  return {
    customers: data.customers.nodes.map(toSummary),
    cursor: data.customers.pageInfo.endCursor,
    hasNextPage: data.customers.pageInfo.hasNextPage,
  };
}
