import { env } from '../../config/env.ts';
import { decryptSecret } from '../../lib/crypto.ts';
import { prisma } from '../../lib/prisma.ts';

export class ShopifyError extends Error {
  // Champs déclarés explicitement : la syntaxe raccourcie de TypeScript
  // (propriétés de constructeur) n'est pas comprise par `node --strip-types`,
  // et on veut pouvoir exécuter les sources sans étape de compilation.
  readonly status: number | undefined;
  readonly details: unknown;

  constructor(message: string, status?: number, details?: unknown) {
    super(message);
    this.name = 'ShopifyError';
    this.status = status;
    this.details = details;
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

  if (env.SHOPIFY_MOCK) {
    const { createMockShopifyClient } = await import('./mock.ts');
    const merchant = await prisma.merchant.findUnique({
      where: { id: merchantId },
      select: { shopDomain: true },
    });
    return createMockShopifyClient(merchant?.shopDomain ?? 'boutique-fictive.myshopify.com');
  }

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
