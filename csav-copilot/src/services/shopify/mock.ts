import type { ShopifyClient } from './client.ts';

/**
 * Boutique fictive, activée par `SHOPIFY_MOCK=1` en développement uniquement.
 *
 * Elle répond aux mêmes requêtes GraphQL que l'API Admin, avec la même forme de
 * données : le code de parsing, de rattachement et de remboursement traversé
 * est donc exactement celui qui tournera en production. Seule la source des
 * octets change.
 */

interface MockOrder {
  id: string;
  name: string;
  createdAt: string;
  displayFinancialStatus: string;
  displayFulfillmentStatus: string;
  total: string;
  currency: string;
  customerEmail: string;
  customerName: string;
  customerSince: string;
  customerOrders: number;
  customerSpent: string;
  items: Array<{ title: string; quantity: number; variantTitle: string | null }>;
  fulfillments: Array<{
    status: string;
    updatedAt: string;
    estimatedDeliveryAt: string | null;
    company: string;
    number: string;
  }>;
  address?: {
    name: string;
    address1: string;
    address2?: string;
    city: string;
    zip: string;
    province: string;
    country: string;
    phone?: string;
  };
}

const ORDERS: MockOrder[] = [
  {
    id: 'gid://shopify/Order/10428',
    name: '#10428',
    createdAt: '2026-02-03T10:12:00Z',
    displayFinancialStatus: 'PAID',
    displayFulfillmentStatus: 'IN_TRANSIT',
    total: '128.40',
    currency: 'EUR',
    customerEmail: 'lea.fontaine@gmail.com',
    customerName: 'Léa Fontaine',
    customerSince: '2024-03-11T09:00:00Z',
    customerOrders: 4,
    customerSpent: '512.60',
    items: [
      { title: 'Lampe Perce-neige', quantity: 1, variantTitle: 'Laiton' },
      { title: 'Ampoule E27 ambrée 4 W', quantity: 2, variantTitle: null },
    ],
    fulfillments: [
      {
        status: 'IN_TRANSIT',
        updatedAt: '2026-02-08T16:30:00Z',
        estimatedDeliveryAt: '2026-02-12T00:00:00Z',
        company: 'Colissimo',
        number: '6A18492037561',
      },
    ],
  },
  {
    id: 'gid://shopify/Order/10391',
    name: '#10391',
    createdAt: '2026-01-28T14:45:00Z',
    displayFinancialStatus: 'PAID',
    displayFulfillmentStatus: 'FULFILLED',
    total: '74.00',
    currency: 'EUR',
    customerEmail: 'm.delaunay@orange.fr',
    customerName: 'Marc Delaunay',
    customerSince: '2023-11-02T09:00:00Z',
    customerOrders: 7,
    customerSpent: '931.20',
    items: [{ title: 'Applique Halo', quantity: 1, variantTitle: 'Noir mat' }],
    fulfillments: [
      {
        status: 'DELIVERED',
        updatedAt: '2026-02-09T14:02:00Z',
        estimatedDeliveryAt: null,
        company: 'Mondial Relay',
        number: '84921047',
      },
    ],
    // Adresse volontairement incomplète (numéro et bâtiment manquants) —
    // sert la démo du cas « adresse incorrecte » remonté au fournisseur.
    address: {
      name: 'Marc Delaunay',
      address1: 'Résidence Les Tilleuls',
      city: 'Lyon',
      zip: '69003',
      province: 'FR-69',
      country: 'FR',
      phone: '+33 6 12 34 56 78',
    },
  },
  {
    id: 'gid://shopify/Order/10375',
    name: '#10375',
    createdAt: '2026-01-25T11:20:00Z',
    displayFinancialStatus: 'PAID',
    displayFulfillmentStatus: 'FULFILLED',
    total: '96.00',
    currency: 'EUR',
    customerEmail: 'a.rousseau@free.fr',
    customerName: 'Amélie Rousseau',
    customerSince: '2022-06-14T09:00:00Z',
    customerOrders: 12,
    customerSpent: '1840.75',
    items: [{ title: 'Lampe Rosée', quantity: 1, variantTitle: 'Verre soufflé' }],
    fulfillments: [
      {
        status: 'DELIVERED',
        updatedAt: '2026-02-08T09:15:00Z',
        estimatedDeliveryAt: null,
        company: 'Colissimo',
        number: '6A18471120043',
      },
    ],
  },
  {
    id: 'gid://shopify/Order/10402',
    name: '#10402',
    createdAt: '2026-01-30T08:05:00Z',
    displayFinancialStatus: 'PAID',
    displayFulfillmentStatus: 'FULFILLED',
    total: '62.00',
    currency: 'EUR',
    customerEmail: 'sophie.nguyen@laposte.net',
    customerName: 'Sophie Nguyen',
    customerSince: '2025-09-19T09:00:00Z',
    customerOrders: 2,
    customerSpent: '148.00',
    items: [{ title: 'Applique Halo', quantity: 1, variantTitle: 'Laiton' }],
    fulfillments: [
      {
        status: 'DELIVERED',
        updatedAt: '2026-02-07T11:40:00Z',
        estimatedDeliveryAt: null,
        company: 'Colissimo',
        number: '6A18468823901',
      },
    ],
  },
  // Trois commandes pour la même adresse : c'est le cas ambigu, celui où le
  // rattachement automatique doit refuser de choisir.
  {
    id: 'gid://shopify/Order/10410',
    name: '#10410',
    createdAt: '2026-02-02T17:30:00Z',
    displayFinancialStatus: 'PAID',
    displayFulfillmentStatus: 'IN_TRANSIT',
    total: '89.90',
    currency: 'EUR',
    customerEmail: 'julien.meyer91@gmail.com',
    customerName: 'Julien Meyer',
    customerSince: '2025-12-05T09:00:00Z',
    customerOrders: 3,
    customerSpent: '288.40',
    items: [{ title: 'Suspension Brume', quantity: 1, variantTitle: 'Opaline' }],
    fulfillments: [
      {
        status: 'IN_TRANSIT',
        updatedAt: '2026-02-09T08:00:00Z',
        estimatedDeliveryAt: '2026-02-11T00:00:00Z',
        company: 'Colissimo',
        number: '6A18490011223',
      },
    ],
  },
  {
    id: 'gid://shopify/Order/10344',
    name: '#10344',
    createdAt: '2026-01-14T09:15:00Z',
    displayFinancialStatus: 'PAID',
    displayFulfillmentStatus: 'FULFILLED',
    total: '156.00',
    currency: 'EUR',
    customerEmail: 'julien.meyer91@gmail.com',
    customerName: 'Julien Meyer',
    customerSince: '2025-12-05T09:00:00Z',
    customerOrders: 3,
    customerSpent: '288.40',
    items: [{ title: 'Lampadaire Sillage', quantity: 1, variantTitle: 'Chêne' }],
    fulfillments: [
      {
        status: 'DELIVERED',
        updatedAt: '2026-01-18T13:00:00Z',
        estimatedDeliveryAt: null,
        company: 'Colissimo',
        number: '6A18412299001',
      },
    ],
  },
  {
    id: 'gid://shopify/Order/10298',
    name: '#10298',
    createdAt: '2025-12-21T19:40:00Z',
    displayFinancialStatus: 'PAID',
    displayFulfillmentStatus: 'FULFILLED',
    total: '42.50',
    currency: 'EUR',
    customerEmail: 'julien.meyer91@gmail.com',
    customerName: 'Julien Meyer',
    customerSince: '2025-12-05T09:00:00Z',
    customerOrders: 3,
    customerSpent: '288.40',
    items: [{ title: 'Ampoule E27 ambrée 4 W', quantity: 3, variantTitle: null }],
    fulfillments: [
      {
        status: 'DELIVERED',
        updatedAt: '2025-12-24T10:00:00Z',
        estimatedDeliveryAt: null,
        company: 'Colissimo',
        number: '6A18333044556',
      },
    ],
  },
];

function toGraphQL(order: MockOrder) {
  return {
    id: order.id,
    name: order.name,
    createdAt: order.createdAt,
    displayFinancialStatus: order.displayFinancialStatus,
    displayFulfillmentStatus: order.displayFulfillmentStatus,
    totalPriceSet: { shopMoney: { amount: order.total, currencyCode: order.currency } },
    customer: {
      id: `gid://shopify/Customer/${order.customerEmail}`,
      email: order.customerEmail,
      displayName: order.customerName,
      numberOfOrders: order.customerOrders,
      createdAt: order.customerSince,
      amountSpent: { amount: order.customerSpent },
    },
    lineItems: { nodes: order.items },
    fulfillments: order.fulfillments.map((f) => ({
      status: f.status,
      updatedAt: f.updatedAt,
      estimatedDeliveryAt: f.estimatedDeliveryAt,
      trackingInfo: [{ company: f.company, number: f.number, url: `https://suivi.example/${f.number}` }],
    })),
    shippingAddress: order.address
      ? {
          name: order.address.name,
          address1: order.address.address1,
          address2: order.address.address2 ?? null,
          city: order.address.city,
          zip: order.address.zip,
          provinceCode: order.address.province,
          countryCodeV2: order.address.country,
          phone: order.address.phone ?? null,
        }
      : null,
  };
}

/** Interprète les filtres `email:"…"` et `name:"#…"` de la recherche Shopify. */
function runSearch(query: string): MockOrder[] {
  const email = query.match(/email:"([^"]+)"/i)?.[1]?.toLowerCase();
  const name = query.match(/name:"([^"]+)"/i)?.[1];
  const free = query.match(/^"([^"]+)"/)?.[1]?.toLowerCase();

  let result = ORDERS;
  if (email) result = result.filter((o) => o.customerEmail.toLowerCase() === email);
  if (name) result = result.filter((o) => o.name === name);
  if (free) result = result.filter((o) => o.customerName.toLowerCase().includes(free));

  return [...result].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function createMockShopifyClient(shopDomain: string): ShopifyClient {
  const refunds = new Map<string, string>();

  return {
    shopDomain,
    async request<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
      if (query.includes('query SearchOrders')) {
        const found = runSearch(String(variables?.query ?? '')).slice(
          0,
          Number(variables?.limit ?? 10),
        );
        return { orders: { nodes: found.map(toGraphQL) } } as T;
      }

      // Listes du carnet de commandes et du fichier client. La pagination
      // n'est pas simulée : le jeu fictif tient sur une page.
      if (query.includes('query ListOrders')) {
        const found = runSearch(String(variables?.query ?? '')).slice(
          0,
          Number(variables?.limit ?? 25),
        );
        return {
          orders: {
            pageInfo: { hasNextPage: false, endCursor: null },
            nodes: found.map(toGraphQL),
          },
        } as T;
      }

      if (query.includes('query ListCustomers')) {
        const term = String(variables?.query ?? '')
          .replace(/^email:/, '')
          .replace(/"/g, '')
          .toLowerCase();

        // Un client par adresse distincte, avec sa commande la plus récente.
        const byEmail = new Map<string, typeof ORDERS>();
        for (const order of ORDERS) {
          const list = byEmail.get(order.customerEmail) ?? [];
          list.push(order);
          byEmail.set(order.customerEmail, list);
        }

        const nodes = [...byEmail.entries()]
          .map(([email, orders]) => ({
            email,
            latest: [...orders].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]!,
          }))
          .filter(
            ({ email, latest }) =>
              !term ||
              email.toLowerCase().includes(term) ||
              latest.customerName.toLowerCase().includes(term),
          )
          .map(({ email, latest }) => {
            return {
              id: `gid://shopify/Customer/${email}`,
              displayName: latest.customerName,
              defaultEmailAddress: { emailAddress: email },
              defaultPhoneNumber: { phoneNumber: latest.address?.phone ?? null },
              numberOfOrders: latest.customerOrders,
              amountSpent: { amount: latest.customerSpent, currencyCode: latest.currency },
              createdAt: latest.customerSince,
              defaultAddress: latest.address
                ? { city: latest.address.city, countryCodeV2: latest.address.country }
                : null,
              lastOrder: { name: latest.name, createdAt: latest.createdAt },
            };
          });

        return {
          customers: { pageInfo: { hasNextPage: false, endCursor: null }, nodes },
        } as T;
      }

      // Catalogue fictif : les articles cités dans les commandes ci-dessus,
      // pour que le mode démonstration reste cohérent d'un écran à l'autre.
      if (query.includes('query ListProducts')) {
        const titles = [...new Set(ORDERS.flatMap((o) => o.items.map((i) => i.title)))];
        const term = String(variables?.query ?? '').toLowerCase();

        const nodes = titles
          .filter((title) => !term || title.toLowerCase().includes(term))
          .map((title, index) => ({
            id: `gid://shopify/Product/${index + 1}`,
            title,
            handle: title.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
            status: index % 5 === 4 ? 'DRAFT' : 'ACTIVE',
            vendor: 'Atelier Lumen',
            productType: 'Luminaire',
            totalInventory: index % 4 === 3 ? 0 : 12 + index * 3,
            updatedAt: new Date(Date.UTC(2026, 1, 20 - index)).toISOString(),
            featuredMedia: null,
            variantsCount: { count: 1 + (index % 3) },
            priceRangeV2: {
              minVariantPrice: { amount: String(29 + index * 7), currencyCode: 'EUR' },
              maxVariantPrice: { amount: String(29 + index * 11) },
            },
          }));

        return {
          products: { pageInfo: { hasNextPage: false, endCursor: null }, nodes },
        } as T;
      }

      if (query.includes('query ListCollections')) {
        const nodes = ['Luminaires', 'Nouveautés', 'Fin de série'].map((title, index) => ({
          id: `gid://shopify/Collection/${index + 1}`,
          title,
          handle: title.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
          updatedAt: new Date(Date.UTC(2026, 1, 18 - index)).toISOString(),
          productsCount: { count: 4 - index },
          image: null,
        }));

        return {
          collections: { pageInfo: { hasNextPage: false, endCursor: null }, nodes },
        } as T;
      }

      // Un litige ouvert, pour que l'écran Finance montre le cas qui compte :
      // celui dont l'échéance approche.
      if (query.includes('query ListDisputes')) {
        return {
          shopifyPaymentsAccount: {
            disputes: {
              nodes: [
                {
                  id: 'gid://shopify/ShopifyPaymentsDispute/1',
                  amount: { amount: '128.40', currencyCode: 'EUR' },
                  reasonDetails: { reason: 'PRODUCT_NOT_RECEIVED' },
                  status: 'NEEDS_RESPONSE',
                  type: 'CHARGEBACK',
                  evidenceDueBy: new Date(Date.now() + 4 * 86400000).toISOString(),
                  initiatedAt: new Date(Date.now() - 3 * 86400000).toISOString(),
                  order: { name: '#10428' },
                },
              ],
            },
          },
        } as T;
      }

      if (query.includes('query GetOrder')) {
        const found = ORDERS.find((o) => o.id === variables?.id);
        return { order: found ? toGraphQL(found) : null } as T;
      }

      if (query.includes('query RefundableTransactions')) {
        const found = ORDERS.find((o) => o.id === variables?.id);
        if (!found) return { order: null } as T;
        return {
          order: {
            currencyCode: found.currency,
            totalPriceSet: { shopMoney: { amount: found.total, currencyCode: found.currency } },
            totalRefundedSet: { shopMoney: { amount: '0.00' } },
            suggestedRefund: {
              amountSet: { shopMoney: { amount: found.total, currencyCode: found.currency } },
              suggestedTransactions: [
                {
                  gateway: 'bogus',
                  maximumRefundableSet: {
                    shopMoney: { amount: found.total, currencyCode: found.currency },
                  },
                  parentTransaction: { id: `gid://shopify/OrderTransaction/${found.name.slice(1)}` },
                },
              ],
            },
          },
        } as T;
      }

      if (query.includes('query RefundHistory')) {
        return {
          orders: {
            pageInfo: { hasNextPage: false, endCursor: null },
            nodes: [
              {
                id: 'gid://shopify/Order/10391',
                name: '#10391',
                totalPriceSet: { shopMoney: { amount: '74.00' } },
                customer: { displayName: 'Marc Delaunay', email: 'm.delaunay@orange.fr' },
                refunds: [
                  {
                    id: 'gid://shopify/Refund/9001',
                    createdAt: new Date(Date.now() - 3 * 86_400_000).toISOString(),
                    note: 'Article endommagé',
                    totalRefundedSet: { shopMoney: { amount: '74.00', currencyCode: 'EUR' } },
                  },
                ],
              },
            ],
          },
        } as T;
      }

      if (query.includes('query CommerceStats')) {
        // Soixante jours de ventes plausibles, déterministes : un graphe de
        // démonstration qui change à chaque appel ferait douter du vrai.
        const nodes = [];
        for (let back = 0; back < 60; back += 1) {
          const date = new Date(Date.now() - back * 86_400_000);
          const seed = (back * 7919) % 23;
          const count = 2 + (seed % 5);
          for (let i = 0; i < count; i += 1) {
            const amount = (79 + ((seed * 13 + i * 31) % 90)).toFixed(2);
            nodes.push({
              createdAt: date.toISOString(),
              cancelledAt: null,
              displayFinancialStatus: 'PAID',
              displayFulfillmentStatus: back < 3 && i === 0 ? 'UNFULFILLED' : 'FULFILLED',
              totalPriceSet: { shopMoney: { amount, currencyCode: 'EUR' } },
              totalRefundedSet:
                (seed + i) % 11 === 0 ? { shopMoney: { amount: '39.00' } } : null,
            });
          }
        }
        return {
          orders: { pageInfo: { hasNextPage: false, endCursor: null }, nodes },
        } as T;
      }

      if (query.includes('query ShopPolicies')) {
        return {
          shop: {
            name: 'Boutique fictive',
            contactEmail: 'contact@exemple.test',
            shipsToCountries: ['FR', 'BE', 'CH'],
            shippingPolicy: {
              title: 'Livraison',
              body: '<p>Expédition sous 2 à 5 jours ouvrés vers la France.</p>',
            },
            refundPolicy: {
              title: 'Retours et remboursements',
              body: '<p>Retour accepté 30 jours après réception, article non porté.</p>',
            },
            privacyPolicy: null,
            termsOfService: null,
            subscriptionPolicy: null,
          },
        } as T;
      }

      if (query.includes('mutation CreateRefund')) {
        const input = variables?.input as { orderId: string };
        const id = `gid://shopify/Refund/${Date.now()}`;
        refunds.set(input.orderId, id);
        return { refundCreate: { refund: { id }, userErrors: [] } } as T;
      }

      throw new Error(`Requête non gérée par la boutique fictive : ${query.slice(0, 60)}`);
    },
  };
}
