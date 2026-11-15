import { logger } from '../../lib/logger.ts';
import { prisma } from '../../lib/prisma.ts';
import { getShopifyClient } from './client.ts';

/**
 * Le nom public de la boutique, lu chez Shopify et gardé en base.
 *
 * Sans lui, le sélecteur de boutiques affichait le préfixe technique du
 * domaine — « b1vvew-e6 » pour Crampons Elite. Lu à l'installation, et
 * rattrapé une fois pour les boutiques installées avant ; jamais par-dessus
 * un nom choisi par le marchand (`brandName`), qui reste prioritaire.
 */
export async function nommerBoutique(merchantId: string): Promise<string | null> {
  try {
    const client = await getShopifyClient(merchantId);
    const data = await client.request<{ shop: { name: string | null } }>(
      /* GraphQL */ `query NomBoutique { shop { name } }`,
    );
    const nom = data.shop?.name?.trim();
    if (!nom) return null;
    await prisma.merchant.update({ where: { id: merchantId }, data: { name: nom } });
    return nom;
  } catch (error) {
    logger.warn({ err: error, merchantId }, 'Nom de boutique illisible chez Shopify');
    return null;
  }
}
