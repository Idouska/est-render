import { env } from '../../config/env.ts';
import { decryptSecret } from '../../lib/crypto.ts';
import { prisma } from '../../lib/prisma.ts';

export class ShopifyError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ShopifyError';
  }
}

export interface ShopifyClient {
  shopDomain: string;
  request<T>(query: string, variables?: Record<string, unknown>): Promise<T>;
}

/**
 * Construit un client Admin GraphQL scopé à un marchand.
 * Le token est déchiffré à l'usage et ne quitte jamais ce module.
 */
export async function getShopifyClient(merchantId: string): Promise<ShopifyClient> {
  const connection = await prisma.shopifyConnection.findUnique({
    where: { merchantId },
    include: { merchant: { select: { shopDomain: true } } },
  });

  if (!connection || connection.uninstalledAt) {
    throw new ShopifyError(`Aucune connexion Shopify active pour le marchand ${merchantId}`);
  }

  const accessToken = decryptSecret(connection.accessTokenEnc);
  const shopDomain = connection.merchant.shopDomain;
  const endpoint = `https://${shopDomain}/admin/api/${env.SHOPIFY_API_VERSION}/graphql.json`;

  return {
    shopDomain,
    async request<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': accessToken,
        },
        body: JSON.stringify({ query, variables }),
      });

      if (!response.ok) {
        throw new ShopifyError(
          `Appel Shopify en échec (${response.status})`,
          response.status,
          await response.text(),
        );
      }

      const payload = (await response.json()) as {
        data?: T;
        errors?: Array<{ message: string }>;
      };

      if (payload.errors?.length) {
        throw new ShopifyError(
          payload.errors.map((e) => e.message).join(' | '),
          response.status,
          payload.errors,
        );
      }

      if (!payload.data) {
        throw new ShopifyError('Réponse Shopify sans données');
      }

      return payload.data;
    },
  };
}
