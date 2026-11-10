import { logger } from '../../lib/logger.ts';
import { prisma } from '../../lib/prisma.ts';
import { couperAccesGoogle } from '../gmail/disconnect.ts';

/**
 * Efface une boutique et tout ce qui lui appartient : tickets, brouillons,
 * remboursements, fournisseurs, retours, colis, journal d'audit — tout, en
 * cascade à la base (chaque table porte `onDelete: Cascade` sur son lien au
 * marchand). Irréversible : réservé à la console admin, derrière une
 * confirmation qui fait saisir le domaine de la boutique.
 *
 * `null` si la boutique n'existe pas : rien à faire, rien à journaliser.
 *
 * Les boîtes Gmail sont débranchées chez Google avant que leurs lignes ne
 * disparaissent — sinon le jeton reste vivant, sans plus personne dans
 * l'outil pour savoir qu'il faudrait le couper.
 */
export async function supprimerMarchand(merchantId: string): Promise<{ shopDomain: string } | null> {
  const merchant = await prisma.merchant.findUnique({
    where: { id: merchantId },
    select: {
      shopDomain: true,
      name: true,
      mailboxes: { select: { id: true, refreshTokenEnc: true } },
    },
  });
  if (!merchant) return null;

  for (const mailbox of merchant.mailboxes) {
    await couperAccesGoogle(merchantId, mailbox);
  }

  await prisma.merchant.delete({ where: { id: merchantId } });

  // Le journal d'audit disparaît avec la boutique qu'il décrivait : cette
  // ligne, dans les journaux du serveur et non en base, est la seule trace
  // qui survit à la suppression.
  logger.warn(
    { merchantId, shopDomain: merchant.shopDomain, name: merchant.name },
    'Boutique supprimée depuis la console admin',
  );

  return { shopDomain: merchant.shopDomain };
}
