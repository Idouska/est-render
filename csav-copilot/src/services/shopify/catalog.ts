import type { ShopifyClient } from './client.ts';

/**
 * Catalogue — produits et collections.
 *
 * Ce que le SAV en fait : reconnaître l'article dont parle un client, vérifier
 * qu'il est encore en stock avant de promettre un échange, retrouver la
 * variante exacte d'une commande. D'où le stock et les variantes, et non les
 * champs de vente (SEO, canaux, prix comparé) qui appartiennent à l'admin
 * Shopify.
 */

export interface ProductSummary {
  id: string;
  title: string;
  handle: string;
  status: string;
  vendor: string | null;
  productType: string | null;
  image: string | null;
  totalInventory: number | null;
  variantCount: number;
  priceMin: string | null;
  priceMax: string | null;
  currency: string | null;
  updatedAt: string;
}

interface RawProduct {
  id: string;
  title: string;
  handle: string;
  status: string;
  vendor: string | null;
  productType: string | null;
  totalInventory: number | null;
  updatedAt: string;
  featuredMedia: { preview: { image: { url: string } | null } | null } | null;
  variantsCount: { count: number } | null;
  priceRangeV2: {
    minVariantPrice: { amount: string; currencyCode: string };
    maxVariantPrice: { amount: string };
  } | null;
}

const PRODUCT_FIELDS = /* GraphQL */ `
  fragment ProductFields on Product {
    id
    title
    handle
    status
    vendor
    productType
    totalInventory
    updatedAt
    featuredMedia {
      preview {
        image {
          url
        }
      }
    }
    variantsCount {
      count
    }
    priceRangeV2 {
      minVariantPrice {
        amount
        currencyCode
      }
      maxVariantPrice {
        amount
      }
    }
  }
`;

function toProduct(product: RawProduct): ProductSummary {
  return {
    id: product.id,
    title: product.title,
    handle: product.handle,
    status: product.status,
    vendor: product.vendor,
    productType: product.productType,
    image: product.featuredMedia?.preview?.image?.url ?? null,
    totalInventory: product.totalInventory,
    variantCount: product.variantsCount?.count ?? 0,
    priceMin: product.priceRangeV2?.minVariantPrice.amount ?? null,
    priceMax: product.priceRangeV2?.maxVariantPrice.amount ?? null,
    currency: product.priceRangeV2?.minVariantPrice.currencyCode ?? null,
    updatedAt: product.updatedAt,
  };
}

export interface ProductPage {
  products: ProductSummary[];
  cursor: string | null;
  hasNextPage: boolean;
}

export async function listProducts(
  client: ShopifyClient,
  options: { query?: string; limit?: number; cursor?: string | null } = {},
): Promise<ProductPage> {
  const { query = '', limit = 25, cursor = null } = options;

  const data = await client.request<{
    products: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: RawProduct[] };
  }>(
    /* GraphQL */ `
      ${PRODUCT_FIELDS}
      query ListProducts($query: String, $limit: Int!, $cursor: String) {
        products(first: $limit, after: $cursor, query: $query, sortKey: UPDATED_AT, reverse: true) {
          pageInfo {
            hasNextPage
            endCursor
          }
          nodes {
            ...ProductFields
          }
        }
      }
    `,
    { query: query || null, limit, cursor },
  );

  return {
    products: data.products.nodes.map(toProduct),
    cursor: data.products.pageInfo.endCursor,
    hasNextPage: data.products.pageInfo.hasNextPage,
  };
}

export interface CollectionSummary {
  id: string;
  title: string;
  handle: string;
  productsCount: number;
  updatedAt: string;
  image: string | null;
}

export interface CollectionPage {
  collections: CollectionSummary[];
  cursor: string | null;
  hasNextPage: boolean;
}

export async function listCollections(
  client: ShopifyClient,
  options: { query?: string; limit?: number; cursor?: string | null } = {},
): Promise<CollectionPage> {
  const { query = '', limit = 25, cursor = null } = options;

  const data = await client.request<{
    collections: {
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
      nodes: Array<{
        id: string;
        title: string;
        handle: string;
        updatedAt: string;
        productsCount: { count: number } | null;
        image: { url: string } | null;
      }>;
    };
  }>(
    /* GraphQL */ `
      query ListCollections($query: String, $limit: Int!, $cursor: String) {
        collections(first: $limit, after: $cursor, query: $query, sortKey: UPDATED_AT, reverse: true) {
          pageInfo {
            hasNextPage
            endCursor
          }
          nodes {
            id
            title
            handle
            updatedAt
            productsCount {
              count
            }
            image {
              url
            }
          }
        }
      }
    `,
    { query: query || null, limit, cursor },
  );

  return {
    collections: data.collections.nodes.map((collection) => ({
      id: collection.id,
      title: collection.title,
      handle: collection.handle,
      productsCount: collection.productsCount?.count ?? 0,
      updatedAt: collection.updatedAt,
      image: collection.image?.url ?? null,
    })),
    cursor: data.collections.pageInfo.endCursor,
    hasNextPage: data.collections.pageInfo.hasNextPage,
  };
}

/**
 * Litiges de paiement Shopify Payments.
 *
 * Un litige a une échéance : passée la date, la banque tranche sans nous. C'est
 * la seule donnée de cet écran qui commande une action datée, d'où sa présence
 * dans le SAV plutôt que dans la comptabilité.
 *
 * Renvoie une liste vide si la boutique n'utilise pas Shopify Payments — ce
 * n'est pas une erreur, juste une absence de données.
 */
export interface DisputeSummary {
  id: string;
  orderName: string | null;
  amount: string;
  currency: string;
  reason: string | null;
  status: string;
  type: string | null;
  evidenceDueBy: string | null;
  initiatedAt: string;
}

export async function listDisputes(
  client: ShopifyClient,
  options: { limit?: number } = {},
): Promise<DisputeSummary[]> {
  const { limit = 50 } = options;

  const data = await client.request<{
    shopifyPaymentsAccount: {
      disputes: {
        nodes: Array<{
          id: string;
          amount: { amount: string; currencyCode: string };
          reasonDetails: { reason: string | null } | null;
          status: string;
          type: string | null;
          evidenceDueBy: string | null;
          initiatedAt: string;
          order: { name: string } | null;
        }>;
      };
    } | null;
  }>(
    /* GraphQL */ `
      query ListDisputes($limit: Int!) {
        shopifyPaymentsAccount {
          disputes(first: $limit, reverse: true) {
            nodes {
              id
              amount {
                amount
                currencyCode
              }
              reasonDetails {
                reason
              }
              status
              type
              evidenceDueBy
              initiatedAt
              order {
                name
              }
            }
          }
        }
      }
    `,
    { limit },
  );

  const nodes = data.shopifyPaymentsAccount?.disputes.nodes ?? [];

  return nodes.map((dispute) => ({
    id: dispute.id,
    orderName: dispute.order?.name ?? null,
    amount: dispute.amount.amount,
    currency: dispute.amount.currencyCode,
    reason: dispute.reasonDetails?.reason ?? null,
    status: dispute.status,
    type: dispute.type,
    evidenceDueBy: dispute.evidenceDueBy,
    initiatedAt: dispute.initiatedAt,
  }));
}
