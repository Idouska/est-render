import { getAiProvider } from '../ai/factory.ts';
import { getShopifyClient, ShopifyError } from '../shopify/client.ts';
import { prisma } from '../../lib/prisma.ts';
import { getCredentials } from './credentials.ts';

/**
 * Tests de connexion de la console d'administration.
 *
 * Chacun fait un vrai aller-retour réseau. Une clé « présente » ne veut rien
 * dire : c'est justement la différence entre une clé collée et une clé qui
 * fonctionne que ces tests servent à établir — la même question que règle
 * `npm run check:ai` en ligne de commande, ramenée dans l'interface.
 */

export interface CheckResult {
  ok: boolean;
  /** Message court, affichable tel quel. */
  message: string;
  /** Ce qu'il faut faire quand ça échoue. Vide si tout va bien. */
  hint?: string;
  details?: Record<string, unknown>;
}

const PROBE_SCHEMA = {
  type: 'object',
  properties: { ok: { type: 'boolean' } },
  required: ['ok'],
  additionalProperties: false,
} as const;

/** Traduit les échecs les plus fréquents en action concrète. */
function diagnose(message: string, host: string): string | undefined {
  if (/not in allowlist|egress/i.test(message)) {
    return `Le réseau de l’hébergement bloque ${host}. Ce n’est pas un problème de clé : autorisez ce domaine en sortie.`;
  }
  if (/401|invalid_api_key|unauthor|authentication/i.test(message)) {
    return 'La clé est refusée. Vérifiez qu’elle est complète, sans espace, et qu’elle correspond bien au fournisseur sélectionné.';
  }
  if (/402|balance|quota|insufficient/i.test(message)) {
    return 'La clé est valide mais le compte n’a plus de crédit. Rechargez le solde chez le fournisseur.';
  }
  if (/429|rate.?limit/i.test(message)) {
    return 'Trop de requêtes en ce moment. La clé fonctionne, réessayez dans un instant.';
  }
  if (/ENOTFOUND|ECONNREFUSED|fetch failed|timeout/i.test(message)) {
    return 'Service injoignable depuis ce serveur : réseau, DNS ou pare-feu.';
  }
  return undefined;
}

/** Envoie une requête minuscule au modèle actif. */
export async function checkAi(): Promise<CheckResult> {
  const credentials = await getCredentials();
  const active = credentials.AI_PROVIDER ?? 'anthropic';

  let provider;
  try {
    provider = await getAiProvider();
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
      hint: 'Renseignez la clé du fournisseur sélectionné, puis réessayez.',
    };
  }

  const started = Date.now();

  try {
    const result = await provider.completeJson<{ ok: boolean }>({
      system: 'Tu réponds uniquement en JSON, sans texte autour.',
      user: 'Réponds exactement {"ok": true}.',
      effort: 'low',
      maxTokens: 64,
      schema: PROBE_SCHEMA,
      validate: (value) => {
        if (typeof value !== 'object' || value === null || typeof (value as { ok?: unknown }).ok !== 'boolean') {
          throw new TypeError('champ ok manquant');
        }
        return value as { ok: boolean };
      },
    });

    if (result.refused) {
      return {
        ok: false,
        message: 'Le modèle a refusé de répondre.',
        hint: 'La clé est valide : le refus vient des garde-fous du modèle, pas de la configuration.',
      };
    }

    return {
      ok: true,
      message: `${provider.name} a répondu en ${Date.now() - started} ms.`,
      details: {
        model: result.model,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        retries: result.retries,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const cause = error instanceof Error && error.cause instanceof Error ? ` ${error.cause.message}` : '';
    const host = active === 'deepseek' ? new URL(credentials.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com/v1').hostname : 'api.anthropic.com';

    return { ok: false, message: `${message}${cause}`, hint: diagnose(`${message}${cause}`, host) };
  }
}

/**
 * Vérifie les identifiants de l'app Google sans toucher au compte d'un
 * marchand : on présente un code d'autorisation volontairement invalide au
 * point de terminaison de jeton. Google distingue les deux cas — `invalid_client`
 * si l'app est mal identifiée, `invalid_grant` si l'app est reconnue mais le
 * code ne vaut rien. Le second est donc la preuve que les identifiants sont bons.
 */
export async function checkGoogle(): Promise<CheckResult> {
  const credentials = await getCredentials();

  if (!credentials.GOOGLE_CLIENT_ID || !credentials.GOOGLE_CLIENT_SECRET) {
    return {
      ok: false,
      message: 'Identifiants OAuth Google incomplets.',
      hint: 'Renseignez GOOGLE_CLIENT_ID et GOOGLE_CLIENT_SECRET depuis Google Cloud → Identifiants.',
    };
  }

  try {
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: credentials.GOOGLE_CLIENT_ID,
        client_secret: credentials.GOOGLE_CLIENT_SECRET,
        grant_type: 'authorization_code',
        code: 'sonde-de-verification-sans-valeur',
        redirect_uri: 'urn:ietf:wg:oauth:2.0:oob',
      }),
    });

    const payload = (await response.json().catch(() => ({}))) as { error?: string; error_description?: string };

    if (payload.error === 'invalid_grant') {
      return {
        ok: true,
        message: 'Google reconnaît l’application : identifiants valides.',
        details: { note: 'Le code de test est rejeté, ce qui est le comportement attendu.' },
      };
    }

    if (payload.error === 'invalid_client') {
      return {
        ok: false,
        message: 'Google ne reconnaît pas ces identifiants (invalid_client).',
        hint: 'Vérifiez le client ID et le secret, et qu’ils appartiennent au même projet Google Cloud.',
      };
    }

    return {
      ok: false,
      message: `Réponse inattendue de Google : ${payload.error ?? response.status}`,
      hint: payload.error_description,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, message, hint: diagnose(message, 'oauth2.googleapis.com') };
  }
}

/**
 * Côté Shopify, les identifiants de l'app ne peuvent pas être testés seuls :
 * ils ne servent qu'au moment d'une installation. Ce qu'on peut vérifier, en
 * revanche, c'est qu'un marchand déjà installé répond — ce qui prouve la
 * chaîne complète. Sans marchand connecté, on se limite à la présence.
 */
export async function checkShopify(): Promise<CheckResult> {
  const credentials = await getCredentials();

  if (!credentials.SHOPIFY_API_KEY || !credentials.SHOPIFY_API_SECRET) {
    return {
      ok: false,
      message: 'Identifiants de l’app Shopify incomplets.',
      hint: 'Renseignez la clé et le secret depuis votre app dans Shopify Partners.',
    };
  }

  const connection = await prisma.shopifyConnection.findFirst({
    where: { uninstalledAt: null, merchant: { status: 'ACTIVE' } },
    select: { merchantId: true, merchant: { select: { shopDomain: true } } },
  });

  if (!connection) {
    return {
      ok: true,
      message: 'Identifiants présents. Aucune boutique installée : rien de plus à vérifier ici.',
      hint: 'Le test complet devient possible dès qu’une boutique a installé l’application.',
    };
  }

  try {
    const client = await getShopifyClient(connection.merchantId);
    const data = await client.request<{ shop: { name: string; myshopifyDomain: string } }>(
      '{ shop { name myshopifyDomain } }',
    );

    return {
      ok: true,
      message: `Appel Admin API réussi sur ${data.shop.myshopifyDomain}.`,
      details: { shop: data.shop.name },
    };
  } catch (error) {
    const message =
      error instanceof ShopifyError
        ? `${error.message}${error.status ? ` (HTTP ${error.status})` : ''}`
        : error instanceof Error
          ? error.message
          : String(error);

    return {
      ok: false,
      message,
      hint:
        error instanceof ShopifyError && error.status === 401
          ? `Le token de ${connection.merchant.shopDomain} n’est plus valide : la boutique doit réinstaller l’application.`
          : diagnose(message, `${connection.merchant.shopDomain}`),
    };
  }
}

export const CHECKS = { ai: checkAi, google: checkGoogle, shopify: checkShopify } as const;

export type CheckName = keyof typeof CHECKS;
