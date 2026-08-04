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

/**
 * Autorisation manquante sur le token installé.
 *
 * Shopify répond 200 avec `ACCESS_DENIED` dans `errors[].extensions` — un
 * succès HTTP qui masque un problème d'installation. Sans type dédié, le
 * message remonte tel quel (« Access denied for products field ») et n'indique
 * pas la seule action utile : réinstaller l'application.
 */
export class ShopifyScopeError extends ShopifyError {
  readonly requiredAccess: string | null;
  readonly grantedScopes: string[];

  constructor(message: string, requiredAccess: string | null, grantedScopes: string[]) {
    super(message, 200);
    this.name = 'ShopifyScopeError';
    this.requiredAccess = requiredAccess;
    this.grantedScopes = grantedScopes;
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
  // Portées réellement accordées lors de l'installation : les citer dans
  // l'erreur évite de chercher côté code une autorisation qui manque côté
  // token — le cas où `SHOPIFY_SCOPES` a été élargi sans réinstaller.
  const grantedScopes = connection.scopes.split(',').map((scope) => scope.trim()).filter(Boolean);
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
        errors?: Array<{
          message: string;
          extensions?: { code?: string; requiredAccess?: string };
        }>;
      };

      const denied = payload.errors?.find(
        (error) =>
          error.extensions?.code === 'ACCESS_DENIED' || /access denied/i.test(error.message),
      );

      if (denied) {
        throw new ShopifyScopeError(
          denied.message,
          denied.extensions?.requiredAccess ?? null,
          grantedScopes,
        );
      }

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
