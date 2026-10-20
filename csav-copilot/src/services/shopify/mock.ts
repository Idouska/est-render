import type { ShopifyClient } from './client.ts';

/**
 * Boutique fictive, activée par `SHOPIFY_MOCK=1` en développement uniquement.
 *
 * Elle répond aux mêmes requêtes GraphQL que l'API Admin, avec la même forme de
 * données : le code de parsing, de rattachement et de remboursement traversé
 * est donc exactement celui qui tournera en production. Seule la source des
 * octets change.
 */

export interface MockOrder {
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
  items: Array<{
    title: string;
    quantity: number;
    variantTitle: string | null;
    sku?: string;
    vendor?: string;
    image?: string;
    /** Prix unitaire. Absent, la ligne prend un prix fictif. */
    prix?: number;
  }>;
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

/** Un produit du catalogue fictif, avec ses déclinaisons. */
export interface ProduitFictif {
  id: string;
  titre: string;
  type: string;
  image: string | null;
  statut: 'ACTIVE' | 'DRAFT';
  majLe: string;
  variantes: Array<{ id: string; titre: string; sku: string; prix: number; stock: number; image: string | null }>;
}

/*
 * Un jeu de données fictif : la boutique de développement (des luminaires,
 * plus bas) ou la boutique de démonstration (`services/demo/`). Le client
 * fictif est le même ; seules les données changent.
 */
export interface JeuFictif {
  nom: string;
  vendeur: string;
  typeProduit: string;
  commandes: MockOrder[];
  /** Le catalogue complet. Absent, il se déduit des articles commandés. */
  produits?: ProduitFictif[];
  collections: string[];
  /** Modèles des remboursements de l'historique : [titre, déclinaisons, prix]. */
  produitsStats: Array<[string, Array<string | null>, number]>;
  /** Le litige bancaire ouvert. */
  litige: { commande: string; montant: string };
  /** Les remboursements récents de l'écran Finance. */
  remboursementsRecents: Array<{ commande: MockOrder; montant: string; note: string; ilYaJours: number }>;
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
  // Pas encore payée, rien d'expédié : l'onglet « À expédier ».
  {
    id: 'gid://shopify/Order/10433',
    name: '#10433',
    createdAt: '2026-02-04T09:02:00Z',
    displayFinancialStatus: 'PENDING',
    displayFulfillmentStatus: 'UNFULFILLED',
    total: '58.00',
    currency: 'EUR',
    customerEmail: 'nora.haddad@exemple.fr',
    customerName: 'Nora Haddad',
    customerSince: '2026-02-04T09:00:00Z',
    customerOrders: 1,
    customerSpent: '0.00',
    items: [{ title: 'Abat-jour Lin naturel', quantity: 1, variantTitle: 'Ø 30 cm' }],
    fulfillments: [],
    address: {
      name: 'Nora Haddad',
      address1: '8 allée des Tanneurs',
      city: 'Nantes',
      zip: '44000',
      province: 'FR-44',
      country: 'FR',
      phone: '+33 7 81 22 40 19',
    },
  },
  // Remboursée après retour : l'onglet « Remboursées ».
  {
    id: 'gid://shopify/Order/10360',
    name: '#10360',
    createdAt: '2026-01-19T16:48:00Z',
    displayFinancialStatus: 'REFUNDED',
    displayFulfillmentStatus: 'FULFILLED',
    total: '45.00',
    currency: 'EUR',
    customerEmail: 'chloe.martin@exemple.fr',
    customerName: 'Chloé Martin',
    customerSince: '2025-10-02T09:00:00Z',
    customerOrders: 2,
    customerSpent: '91.00',
    items: [{ title: 'Applique Lune', quantity: 1, variantTitle: 'Opaline' }],
    fulfillments: [
      {
        status: 'DELIVERED',
        updatedAt: '2026-01-22T10:30:00Z',
        estimatedDeliveryAt: null,
        company: 'Colissimo',
        number: '6A18440098712',
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
  const lignes = order.items.map((item, rang) => ({
    title: item.title,
    quantity: item.quantity,
    variantTitle: item.variantTitle,
    sku: item.sku ?? null,
    vendor: item.vendor ?? null,
    image: item.image ? { url: item.image } : null,
    discountedTotalSet: {
      shopMoney: {
        amount: item.prix !== undefined ? (item.prix * item.quantity).toFixed(2) : prixFictif(rang + 2),
        currencyCode: 'EUR',
      },
    },
  }));
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
    // Le montant de la ligne, comme Shopify le donne : remises comprises.
    lineItems: { nodes: lignes },
    fulfillments: order.fulfillments.map((f) => ({
      // Comme l'API : `status` ne dit que « l'expédition existe », l'état du
      // colis chez le transporteur est dans `displayStatus`.
      status: 'SUCCESS',
      displayStatus: f.status,
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
          // Comme Shopify : nom, rues, « code postal ville », pays en toutes lettres.
          formatted: [
            order.address.name,
            order.address.address1,
            order.address.address2,
            [order.address.zip, order.address.city].filter(Boolean).join(' '),
            new Intl.DisplayNames(['fr'], { type: 'region' }).of(order.address.country) ?? order.address.country,
          ].filter((ligne): ligne is string => Boolean(ligne)),
        }
      : null,
  };
}

/*
 * Les filtres d'état de la recherche Shopify : plusieurs valeurs d'un même
 * champ se lisent en « ou », comme `(fulfillment_status:a OR fulfillment_status:b)`.
 */
const EXPEDITION: Record<string, (o: MockOrder) => boolean> = {
  unfulfilled: (o) => o.displayFulfillmentStatus === 'UNFULFILLED',
  unshipped: (o) => o.displayFulfillmentStatus === 'UNFULFILLED',
  partial: (o) => o.displayFulfillmentStatus === 'PARTIALLY_FULFILLED',
  shipped: (o) => !['UNFULFILLED', 'PARTIALLY_FULFILLED'].includes(o.displayFulfillmentStatus),
  fulfilled: (o) => !['UNFULFILLED', 'PARTIALLY_FULFILLED'].includes(o.displayFulfillmentStatus),
};

function valeurs(query: string, champ: string): string[] {
  return [...query.matchAll(new RegExp(`${champ}:(\\w+)`, 'gi'))].map((m) => m[1]!.toLowerCase());
}

/** Interprète les filtres `email:"…"`, `name:"#…"` et d'état de la recherche Shopify. */
function runSearch(ORDERS: MockOrder[], query: string): MockOrder[] {
  const email = query.match(/email:"([^"]+)"/i)?.[1]?.toLowerCase();
  // Plusieurs numéros reliés par OR : `name:"#1" OR name:"#2"`.
  const noms = [...query.matchAll(/name:"([^"]+)"/gi)].map((m) => m[1]!);
  const free = query.match(/^"([^"]+)"/)?.[1]?.toLowerCase();
  const paiements = valeurs(query, 'financial_status');
  const expeditions = valeurs(query, 'fulfillment_status');

  let result = ORDERS;
  if (email) result = result.filter((o) => o.customerEmail.toLowerCase() === email);
  if (noms.length) result = result.filter((o) => noms.includes(o.name));
  if (free) result = result.filter((o) => o.customerName.toLowerCase().includes(free));
  if (paiements.length) result = result.filter((o) => paiements.includes(o.displayFinancialStatus.toLowerCase()));
  if (expeditions.length) result = result.filter((o) => expeditions.some((v) => EXPEDITION[v]?.(o)));

  return [...result].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/*
 * Un an de remboursements fictifs, pour les statistiques : des motifs variés
 * (dont des notes vides, comme dans une vraie boutique), des remboursements
 * avec et sans articles précisés, des partiels. Déterministe : un graphique
 * de démonstration qui change à chaque appel ferait douter du vrai.
 */
const PRODUITS_FICTIFS: JeuFictif['produitsStats'] = [
  ['Lampe Perce-neige', ['Laiton', 'Noir'], 89],
  ['Applique Halo', ['Noir mat', 'Laiton'], 74],
  ['Lampe Rosée', ['Verre soufflé'], 96],
  ['Suspension Brume', ['Opaline', 'Fumé'], 89.9],
  ['Lampadaire Sillage', ['Chêne', 'Noyer'], 156],
  ['Ampoule E27 ambrée 4 W', [null], 14.5],
];
const NOTES_FICTIVES = [
  'Article endommagé à la réception',
  'Colis perdu par le transporteur',
  'Erreur de préparation',
  'Geste commercial',
  'Retour reçu et accepté',
  '',
  'Article endommagé à la réception',
  '',
  'Le client a changé d’avis',
];

function remboursementsFictifs(produits: JeuFictif['produitsStats']) {
  return Array.from({ length: 72 }, (_, i) => {
    const [titre, variantes, prix] = produits[(i * 7 + (i >> 2)) % produits.length]!;
    const quantite = i % 5 === 0 ? 2 : 1;
    const totalLigne = Math.round(prix * quantite * 100) / 100;
    const partiel = i % 4 === 0;
    const montant = partiel ? Math.round(totalLigne * 30) / 100 : totalLigne;
    const date = new Date(Date.now() - (((i * 37) % 360) + 1) * 86_400_000 - (i % 24) * 3_600_000);
    const ligne = {
      title: titre,
      variantTitle: variantes[i % variantes.length] ?? null,
      quantity: quantite,
      discountedTotalSet: { shopMoney: { amount: totalLigne.toFixed(2) } },
      image: null,
    };
    return {
      id: `gid://shopify/Order/2${1000 + i}`,
      name: `#2${1000 + i}`,
      totalPriceSet: { shopMoney: { amount: totalLigne.toFixed(2) } },
      lineItems: { nodes: [ligne] },
      refunds: [
        {
          id: `gid://shopify/Refund/7${1000 + i}`,
          createdAt: date.toISOString(),
          note: NOTES_FICTIVES[i % NOTES_FICTIVES.length] || null,
          totalRefundedSet: { shopMoney: { amount: montant.toFixed(2), currencyCode: 'EUR' } },
          // Un sur trois sans article précisé, comme un remboursement fait
          // d'un montant dans l'administration.
          refundLineItems: {
            nodes:
              i % 3 === 1 || partiel
                ? []
                : [{ quantity: quantite, subtotalSet: { shopMoney: { amount: totalLigne.toFixed(2) } }, lineItem: ligne }],
          },
        },
      ],
    };
  });
}

/** La boutique de développement : des luminaires, et trois commandes ambiguës. */
const JEU_DEV: JeuFictif = {
  nom: 'Boutique fictive',
  vendeur: 'Atelier Lumen',
  typeProduit: 'Luminaire',
  commandes: ORDERS,
  collections: ['Luminaires', 'Nouveautés', 'Fin de série'],
  produitsStats: PRODUITS_FICTIFS,
  litige: { commande: '#10428', montant: '128.40' },
  remboursementsRecents: [
    { commande: ORDERS.find((o) => o.name === '#10391')!, montant: '74.00', note: 'Article endommagé', ilYaJours: 3 },
  ],
};

export function createMockShopifyClient(shopDomain: string, jeu: JeuFictif = JEU_DEV): ShopifyClient {
  const refunds = new Map<string, string>();
  const ORDERS = jeu.commandes;
  // Le catalogue : celui du jeu, sinon les articles des commandes.
  const produits: ProduitFictif[] =
    jeu.produits ??
    [...new Set(ORDERS.flatMap((o) => o.items.map((i) => i.title)))].map((titre, index) => ({
      id: `gid://shopify/Product/${index + 1}`,
      titre,
      type: jeu.typeProduit,
      image: null,
      statut: index % 5 === 4 ? 'DRAFT' : 'ACTIVE',
      majLe: new Date(Date.UTC(2026, 1, 20 - index)).toISOString(),
      variantes: [],
    }));

  return {
    shopDomain,
    async request<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
      if (query.includes('query SearchOrders')) {
        const found = runSearch(ORDERS, String(variables?.query ?? '')).slice(
          0,
          Number(variables?.limit ?? 10),
        );
        return { orders: { nodes: found.map(toGraphQL) } } as T;
      }

      if (query.includes('query OrderCounts')) {
        return Object.fromEntries(
          Object.entries(variables ?? {}).map(([cle, filtre]) => [
            cle,
            { count: runSearch(ORDERS, String(filtre ?? '')).length, precision: 'EXACT' },
          ]),
        ) as T;
      }

      // Listes du carnet de commandes et du fichier client. La pagination
      // n'est pas simulée : le jeu fictif tient sur une page.
      if (query.includes('query ListOrders')) {
        // Le tri de l'écran Commandes, comme Shopify : date ou montant.
        const cle = (o: MockOrder) => (variables?.sortKey === 'TOTAL_PRICE' ? Number(o.total) : o.createdAt);
        const found = runSearch(ORDERS, String(variables?.query ?? ''))
          .sort((a, b) => (cle(a) < cle(b) ? -1 : cle(a) > cle(b) ? 1 : 0) * (variables?.reverse === false ? 1 : -1))
          .slice(0, Number(variables?.limit ?? 25));
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
        const term = String(variables?.query ?? '').toLowerCase();

        const nodes = produits
          .filter((produit) => !term || filtreRepond(term, { title: produit.titre, product_title: produit.titre }))
          .map((produit, index) => {
            const prix = produit.variantes.map((v) => v.prix);
            return {
              id: produit.id,
              title: produit.titre,
              handle: produit.titre.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
              status: produit.statut,
              vendor: jeu.vendeur,
              productType: produit.type,
              totalInventory: produit.variantes.length
                ? produit.variantes.reduce((somme, v) => somme + v.stock, 0)
                : index % 4 === 3 ? 0 : 12 + index * 3,
              updatedAt: produit.majLe,
              featuredMedia: produit.image ? { preview: { image: { url: produit.image } } } : null,
              variantsCount: { count: produit.variantes.length || 1 + (index % 3) },
              priceRangeV2: {
                minVariantPrice: { amount: String(prix.length ? Math.min(...prix) : 29 + index * 7), currencyCode: 'EUR' },
                maxVariantPrice: { amount: String(prix.length ? Math.max(...prix) : 29 + index * 11) },
              },
            };
          });

        return {
          products: { pageInfo: { hasNextPage: false, endCursor: null }, nodes },
        } as T;
      }

      // Les déclinaisons du catalogue fictif : celles des commandes ci-dessus,
      // pour qu'une paire ajoutée au stock corresponde à ce qui se commande.
      if (query.includes('query ListVariants') && jeu.produits) {
        const filtre = String(variables?.query ?? '');
        const nodes = jeu.produits
          .flatMap((produit) => produit.variantes.map((variante) => ({ produit, variante })))
          .filter(({ produit, variante }) =>
            varianteRepond(filtre, { title: produit.titre, variantTitle: variante.titre, sku: variante.sku }),
          )
          .slice(0, Number(variables?.limit ?? 20))
          .map(({ produit, variante }) => varianteGraphQL(produit, variante));
        return { productVariants: { nodes } } as T;
      }

      if (query.includes('query ProductVariants')) {
        const produit = produits.find((p) => p.id === variables?.id);
        return {
          product: produit
            ? {
                id: produit.id,
                title: produit.titre,
                vendor: jeu.vendeur,
                featuredMedia: produit.image ? { preview: { image: { url: produit.image } } } : null,
                variants: { nodes: produit.variantes.map((variante) => varianteGraphQL(produit, variante)) },
              }
            : null,
        } as T;
      }

      if (query.includes('query ListVariants')) {
        const filtre = String(variables?.query ?? '');
        const vues = new Set<string>();
        const nodes = ORDERS.flatMap((o) => o.items)
          .filter((item) => varianteRepond(filtre, item))
          .filter((item) => {
            const cle = `${item.title}|${item.variantTitle ?? ''}`;
            if (vues.has(cle)) return false;
            vues.add(cle);
            return true;
          })
          .map((item, index) => ({
            id: `gid://shopify/ProductVariant/${index + 1}`,
            title: item.variantTitle ?? 'Default Title',
            sku: null,
            price: prixFictif(index + 1),
            inventoryQuantity: 6,
            availableForSale: true,
            image: null,
            product: { id: `gid://shopify/Product/${item.title}`, title: item.title, featuredMedia: null },
          }));
        return { productVariants: { nodes } } as T;
      }

      // Lien de paiement d'une différence de prix : la commande provisoire
      // fictive se paie d'elle-même au premier coup d'œil, pour qu'on voie
      // l'échange se libérer en démonstration.
      if (query.includes('mutation CreerLienDifference')) {
        return {
          draftOrderCreate: {
            draftOrder: { id: `gid://shopify/DraftOrder/${Date.now()}`, invoiceUrl: 'https://boutique-fictive.myshopify.com/invoices/demo' },
            userErrors: [],
          },
        } as T;
      }
      if (query.includes('mutation EnvoyerLienDifference')) {
        return { draftOrderInvoiceSend: { draftOrder: { id: String(variables?.id ?? '') }, userErrors: [] } } as T;
      }
      if (query.includes('query StatutLienDifference')) {
        return { draftOrder: { status: 'COMPLETED' } } as T;
      }
      if (query.includes('query PrixDeclinaison')) {
        const rang = Number(String(variables?.id ?? '').split('/').pop()) || 1;
        return { productVariant: { price: prixFictif(rang) } } as T;
      }

      if (query.includes('query ListCollections')) {
        const nodes = jeu.collections.map((title, index) => ({
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
                  amount: { amount: jeu.litige.montant, currencyCode: 'EUR' },
                  reasonDetails: { reason: 'PRODUCT_NOT_RECEIVED' },
                  status: 'NEEDS_RESPONSE',
                  type: 'CHARGEBACK',
                  evidenceDueBy: new Date(Date.now() + 4 * 86400000).toISOString(),
                  initiatedAt: new Date(Date.now() - 3 * 86400000).toISOString(),
                  order: { name: jeu.litige.commande },
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

      if (query.includes('query RefundStats')) {
        const depuis = String(variables?.query ?? '').match(/updated_at:>=(\d{4}-\d{2}-\d{2})/)?.[1];
        const nodes = remboursementsFictifs(jeu.produitsStats).filter(
          (commande) => !depuis || commande.refunds[0]!.createdAt.slice(0, 10) >= depuis,
        );
        return { orders: { pageInfo: { hasNextPage: false, endCursor: null }, nodes } } as T;
      }

      if (query.includes('query RefundHistory')) {
        return {
          orders: {
            pageInfo: { hasNextPage: false, endCursor: null },
            nodes: jeu.remboursementsRecents.map((recent, rang) => ({
              id: recent.commande.id,
              name: recent.commande.name,
              totalPriceSet: { shopMoney: { amount: recent.commande.total } },
              customer: { displayName: recent.commande.customerName, email: recent.commande.customerEmail },
              refunds: [
                {
                  id: `gid://shopify/Refund/${9001 + rang}`,
                  createdAt: new Date(Date.now() - recent.ilYaJours * 86_400_000).toISOString(),
                  note: recent.note,
                  totalRefundedSet: { shopMoney: { amount: recent.montant, currencyCode: 'EUR' } },
                },
              ],
            })),
          },
        } as T;
      }

      // Deux ans de ventes déterministes, à l'heure près : la comparaison avec
      // l'an dernier et le regroupement par heure ont de quoi se montrer. La
      // graine est le jour du calendrier, pas « il y a N jours » : un même
      // jour garde ses ventes d'un appel à l'autre.
      if (query.includes('query VentesPeriode')) {
        const [, debut = '', fin = ''] = /created_at:>='([^']+)' created_at:<'([^']+)'/.exec(String(variables?.query ?? '')) ?? [];
        const depuis = Date.parse(debut);
        const avant = Math.min(Date.parse(fin), Date.now());
        const nodes = [];
        for (let jour = Math.floor(depuis / 86_400_000); jour * 86_400_000 < avant; jour += 1) {
          const graine = (jour * 7919) % 23;
          const saison = 1 + 0.25 * Math.sin(jour / 58);
          const nombre = Math.round((2 + (graine % 5)) * saison);
          for (let i = 0; i < nombre; i += 1) {
            const instant = jour * 86_400_000 + (7 + ((graine * 5 + i * 7) % 15)) * 3_600_000 + ((i * 17) % 60) * 60_000;
            if (instant < depuis || instant >= avant) continue;
            nodes.push({
              createdAt: new Date(instant).toISOString(),
              cancelledAt: (graine + i) % 29 === 0 ? new Date(instant).toISOString() : null,
              totalPriceSet: { shopMoney: { amount: (79 + ((graine * 13 + i * 31) % 90)).toFixed(2), currencyCode: 'EUR' } },
              totalRefundedSet: (graine + i) % 11 === 0 ? { shopMoney: { amount: '39.00' } } : null,
            });
          }
        }
        return { orders: { pageInfo: { hasNextPage: false, endCursor: null }, nodes } } as T;
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

      // Les mêmes ventes que « CommerceStats » ci-dessus, comptées par mois :
      // le coût par commande de la démonstration se recoupe avec ses statistiques.
      if (query.includes('query CommandesParMois')) {
        const jours = Array.from({ length: 60 }, (_, back) => ({
          instant: Date.now() - back * 86_400_000,
          nombre: 2 + (((back * 7919) % 23) % 5),
        }));
        return Object.fromEntries(
          Object.entries(variables ?? {}).map(([cle, filtre]) => {
            const [, debut = '', fin = ''] = /created_at:>='([^']+)' created_at:<'([^']+)'/.exec(String(filtre)) ?? [];
            const count = jours
              .filter((jour) => jour.instant >= Date.parse(debut) && jour.instant < Date.parse(fin))
              .reduce((somme, jour) => somme + jour.nombre, 0);
            return [cle.replace(/^q/, 'm'), { count, precision: 'EXACT' }];
          }),
        ) as T;
      }

      if (query.includes('query ShopPolicies')) {
        return {
          shop: {
            name: jeu.nom,
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

      // La boutique fictive n'a expédié aucun colis de l'atelier : corriger un
      // numéro n'a rien à répercuter chez elle.
      if (query.includes('query FulfillmentTracking')) {
        return { order: { fulfillments: [] } } as T;
      }

      if (query.includes('mutation CreateRefund')) {
        const input = variables?.input as { orderId: string };
        const id = `gid://shopify/Refund/${Date.now()}`;
        refunds.set(input.orderId, id);
        return { refundCreate: { refund: { id }, userErrors: [] } } as T;
      }

      // Une commande pas encore expédiée a une expédition ouverte : l'atelier
      // peut y saisir son numéro de suivi.
      if (query.includes('query FulfillmentOrders')) {
        const found = ORDERS.find((o) => o.id === variables?.id);
        return {
          order: found
            ? { fulfillmentOrders: { nodes: [{ id: `${found.id}/fo`, status: found.fulfillments.length ? 'CLOSED' : 'OPEN' }] } }
            : null,
        } as T;
      }

      // Les autres écritures reçoivent la réponse qu'aurait donnée Shopify,
      // comme en mode test : rien n'existe, rien ne part.
      // Import tardif : `modeTest` lit la configuration du serveur, que les
      // tests du catalogue fictif ne chargent pas.
      const { ecritureSimulee } = await import('../modeTest.ts');
      const simulee = ecritureSimulee(query);
      if (simulee !== null) return simulee as T;

      throw new Error(`Requête non gérée par la boutique fictive : ${query.slice(0, 60)}`);
    },
  };
}

/*
 * Le filtre de `productVariants`, lu comme Shopify le lit.
 *
 * Le catalogue fictif ignorait le filtre : une recherche sur le mauvais champ
 * marchait ici et ne trouvait rien en production. `title` est le titre de la
 * déclinaison, `product_title` celui du modèle ; « hok* » cherche le début
 * d'un mot. Des groupes reliés par AND, faits de termes reliés par OR.
 */
function varianteRepond(filtre: string, item: { title: string; variantTitle?: string | null; sku?: string | null }): boolean {
  return filtreRepond(filtre, {
    product_title: item.title,
    title: item.variantTitle ?? 'Default Title',
    sku: item.sku ?? '',
  });
}

/** Un filtre de recherche Shopify, appliqué aux champs d'un élément du catalogue. */
function filtreRepond(filtre: string, champs: Record<string, string>): boolean {
  if (!filtre.trim()) return true;
  const terme = (brut: string) => {
    const [, champ = '', valeur = ''] = /^(\w+):"?([^"]*)"?$/.exec(brut.trim()) ?? [];
    const texte = (champs[champ] ?? Object.values(champs).join(' ')).toLowerCase();
    const cherche = (champ ? valeur : brut.trim().replace(/^"|"$/g, '')).toLowerCase();
    // Sans champ, Shopify cherche le texte partout.
    if (!champ) return texte.includes(cherche.replace(/\*$/, ''));
    if (cherche.endsWith('*')) {
      const debut = cherche.slice(0, -1);
      return texte.split(/[^\p{L}\p{N}]+/u).some((mot) => mot.startsWith(debut));
    }
    return texte === cherche;
  };
  return filtre
    .split(/\s+AND\s+/)
    .every((groupe) => groupe.replace(/^\(|\)$/g, '').split(/\s+OR\s+/).some(terme));
}

function varianteGraphQL(produit: ProduitFictif, variante: ProduitFictif['variantes'][number]) {
  return {
    id: variante.id,
    title: variante.titre,
    sku: variante.sku,
    price: variante.prix.toFixed(2),
    inventoryQuantity: variante.stock,
    availableForSale: variante.stock > 0,
    image: variante.image ? { url: variante.image } : null,
    product: {
      id: produit.id,
      title: produit.titre,
      featuredMedia: produit.image ? { preview: { image: { url: produit.image } } } : null,
    },
  };
}

/** Des prix qui varient d'une déclinaison à l'autre : un échange montre son écart. */
function prixFictif(rang: number): string {
  return (39 + ((rang * 17) % 7) * 10).toFixed(2);
}
