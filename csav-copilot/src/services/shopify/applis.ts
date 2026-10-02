import { decryptSecret } from '../../lib/crypto.ts';
import { logger } from '../../lib/logger.ts';
import { prisma } from '../../lib/prisma.ts';
import { getCredentials, requireCredential } from '../platform/credentials.ts';

/**
 * Quelle appli Shopify parle pour une boutique.
 *
 * Une appli en distribution personnalisée ne s'installe que sur la boutique
 * pour laquelle son lien a été créé. Pour brancher autant de boutiques qu'on
 * veut, chacune peut avoir sa propre appli (table `ShopifyApp`) ; sinon,
 * c'est l'appli de la plateforme qui sert, comme avant — les boutiques déjà
 * branchées ne voient aucune différence.
 *
 * Tout ce qui signe ou vérifie au nom d'une boutique passe par ici :
 * l'installation, la signature du retour OAuth, l'échange du jeton, et les
 * webhooks. Une boutique installée avec son appli et vérifiée avec celle de
 * la plateforme serait refusée à chaque appel.
 */

export interface AppliShopify {
  clientId: string;
  clientSecret: string;
  source: 'boutique' | 'plateforme';
}

export const normaliserBoutique = (shop: string) => shop.trim().toLowerCase();

/** Seuls les domaines *.myshopify.com sont acceptés (anti-redirect arbitraire). */
export const estDomaineShopify = (shop: string) => /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(shop);

async function appliDeLaBoutique(shop: string): Promise<AppliShopify | null> {
  const ligne = await prisma.shopifyApp.findUnique({
    where: { shopDomain: normaliserBoutique(shop) },
    select: { clientId: true, clientSecretEnc: true },
  });
  if (!ligne) return null;
  try {
    return { clientId: ligne.clientId, clientSecret: decryptSecret(ligne.clientSecretEnc), source: 'boutique' };
  } catch (error) {
    // ENCRYPTION_KEY a changé depuis l'écriture : on le dit, et on retombe sur
    // l'appli de la plateforme plutôt que de bloquer la boutique.
    logger.error({ err: error, shop }, 'Secret d’appli Shopify indéchiffrable');
    return null;
  }
}

/** L'appli de cette boutique, ou celle de la plateforme. */
export async function appliPourBoutique(shop: string): Promise<AppliShopify> {
  const propre = await appliDeLaBoutique(shop);
  if (propre) return propre;
  return {
    clientId: await requireCredential('SHOPIFY_API_KEY', 'Nécessaire pour l’installation d’une boutique.'),
    clientSecret: await requireCredential('SHOPIFY_API_SECRET', 'Nécessaire pour vérifier les signatures Shopify.'),
    source: 'plateforme',
  };
}

/**
 * Les secrets qui peuvent avoir signé un webhook de cette boutique : le sien
 * d'abord, puis celui de la plateforme. Le domaine vient d'un en-tête que
 * n'importe qui peut écrire — mais la signature, elle, doit correspondre à
 * l'un de NOS secrets : essayer les deux n'ouvre rien.
 */
export async function secretsPourWebhook(shop: string | undefined): Promise<string[]> {
  const secrets: string[] = [];
  if (shop) {
    const propre = await appliDeLaBoutique(shop);
    if (propre) secrets.push(propre.clientSecret);
  }
  const plateforme = (await getCredentials()).SHOPIFY_API_SECRET;
  if (plateforme) secrets.push(plateforme);
  return secrets;
}
