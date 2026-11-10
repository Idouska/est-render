import { logger } from '../../lib/logger.ts';
import { prisma } from '../../lib/prisma.ts';
import { decryptSecret } from '../../lib/crypto.ts';
import { createOAuthClient } from './client.ts';
import { stopWatch } from './watch.ts';

/**
 * Coupe une boîte chez Google : arrête l'écoute Pub/Sub, révoque le jeton.
 *
 * Les deux gestes sont tentés séparément et sans bloquer : si l'un échoue, on
 * fait quand même l'autre. Laisser une autorisation vivante parce qu'une
 * révocation a échoué serait le pire des deux mondes — la boîte disparaît de
 * l'outil, mais le jeton permet toujours de la lire.
 *
 * Ne touche à rien côté base : appelé juste avant d'effacer une seule boîte
 * (`debrancherBoite`) ou toutes celles d'une boutique qu'on supprime.
 */
export async function couperAccesGoogle(
  merchantId: string,
  mailbox: { id: string; refreshTokenEnc: string },
): Promise<void> {
  try {
    await stopWatch(merchantId, mailbox.id);
  } catch (error) {
    logger.warn({ err: error, mailboxId: mailbox.id }, 'Arrêt du watch Gmail en échec');
  }
  try {
    const auth = await createOAuthClient();
    await auth.revokeToken(decryptSecret(mailbox.refreshTokenEnc));
  } catch (error) {
    logger.warn({ err: error, mailboxId: mailbox.id }, 'Révocation du jeton Google en échec');
  }
}

/**
 * Débranche une boîte : coupe l'accès chez Google, puis efface la boîte et
 * le courrier qu'elle a apporté. `null` si la boîte n'appartient pas à ce
 * marchand — ni trouvée, ni touchée.
 *
 * Partagé par deux appelants : le marchand, depuis ses propres Réglages ; la
 * console admin, pour n'importe quelle boutique sans s'y connecter.
 */
export async function debrancherBoite(
  merchantId: string,
  mailboxId: string,
): Promise<{ emailAddress: string } | null> {
  const mailbox = await prisma.gmailConnection.findFirst({
    where: { id: mailboxId, merchantId },
    select: { id: true, emailAddress: true, isDefault: true, refreshTokenEnc: true },
  });
  if (!mailbox) return null;

  await couperAccesGoogle(merchantId, mailbox);

  const remaining = await prisma.gmailConnection.findFirst({
    where: { merchantId, id: { not: mailbox.id } },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });

  // Débrancher la dernière boîte couperait toute entrée de courrier : on
  // laisse faire, mais l'envoi automatique n'a plus de sens sans elle.
  await prisma.$transaction([
    /*
     * Le courrier part avec l'adresse qui l'a apporté.
     *
     * Le laisser en place rendait la file impossible à nettoyer : sans son
     * lien de provenance, plus rien ne distinguait un message d'une boîte
     * débranchée par erreur d'un message de la boîte du SAV. Débrancher
     * est déjà un geste délibéré, précédé de sa confirmation.
     */
    prisma.ticket.deleteMany({ where: { merchantId, mailboxId: mailbox.id } }),
    prisma.gmailConnection.delete({ where: { id: mailbox.id } }),
    ...(mailbox.isDefault && remaining
      ? [prisma.gmailConnection.update({ where: { id: remaining.id }, data: { isDefault: true } })]
      : []),
    ...(remaining
      ? []
      : [prisma.merchant.update({ where: { id: merchantId }, data: { autoSendEnabled: false } })]),
  ]);

  return { emailAddress: mailbox.emailAddress };
}
