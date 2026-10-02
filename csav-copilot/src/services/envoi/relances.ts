import { logger } from '../../lib/logger.ts';
import { prisma } from '../../lib/prisma.ts';
import { sendPlainEmail } from '../gmail/send.ts';
import { lienAtelier } from '../ruptures/substitution.ts';
import { FERMETURE, OUVERTURE, heureAtelier, rappelDuRetard } from './rappel.ts';

/**
 * Le rappel des commandes de lot en retard.
 *
 * Une commande non expédiée au-delà du délai laissé à l'atelier lui est
 * rappelée — une fois. Toutes ses commandes en retard partent dans le même
 * mail : dix rappels séparés se liraient comme du bruit, une liste se lit
 * comme une tâche. Au-delà de ce rappel, rien ne repart : le marchand voit la
 * commande en rouge, et c'est à lui de décrocher son téléphone.
 *
 * Il ne part qu'aux heures de travail de l'atelier : un rappel reçu à trois
 * heures du matin est enterré sous les mails de la nuit avant d'être lu.
 */

/** Un passage : à appeler régulièrement (le worker le fait toutes les quinze minutes). */
export async function relancerLotsEnRetard(maintenant = new Date()): Promise<number> {
  const heure = heureAtelier(maintenant);
  if (heure < OUVERTURE || heure >= FERMETURE) return 0;

  const boutiques = await prisma.merchant.findMany({
    where: { envoisFournisseur: { some: {} } },
    select: { id: true, lotDelaiJours: true, name: true, brandName: true, shopDomain: true, emailSignature: true },
  });

  let rappels = 0;
  for (const boutique of boutiques) {
    const limite = new Date(maintenant.getTime() - boutique.lotDelaiJours * 86_400_000);
    const candidates = await prisma.envoiCommande.findMany({
      where: {
        merchantId: boutique.id,
        rappeleLe: null,
        envoi: { emailedAt: { not: null, lt: limite } },
      },
      select: {
        id: true,
        shopifyOrderId: true,
        orderName: true,
        articles: true,
        envoi: { select: { supplierId: true, emailedAt: true } },
      },
    });
    if (candidates.length === 0) continue;

    // Une commande qui a un colis est expédiée : elle n'est pas en retard.
    const expediees = new Set(
      (
        await prisma.parcel.findMany({
          where: { merchantId: boutique.id, shopifyOrderId: { in: candidates.map((c) => c.shopifyOrderId) } },
          select: { shopifyOrderId: true },
        })
      ).map((colis) => colis.shopifyOrderId),
    );
    const enRetard = candidates.filter((commande) => !expediees.has(commande.shopifyOrderId));

    const parAtelier = new Map<string, typeof enRetard>();
    for (const commande of enRetard) {
      parAtelier.set(commande.envoi.supplierId, [...(parAtelier.get(commande.envoi.supplierId) ?? []), commande]);
    }

    const nom = boutique.brandName || boutique.name || boutique.shopDomain;
    for (const [supplierId, commandes] of parAtelier) {
      const atelier = await prisma.supplier.findFirst({
        where: { id: supplierId, merchantId: boutique.id, active: true },
        select: { contactEmail: true },
      });
      if (!atelier) continue;

      const rappel = rappelDuRetard({
        merchantName: nom,
        delaiJours: boutique.lotDelaiJours,
        commandes: commandes.map((commande) => ({
          orderName: commande.orderName,
          articles: commande.articles,
          jours: Math.floor((maintenant.getTime() - commande.envoi.emailedAt!.getTime()) / 86_400_000),
        })),
        lien: await lienAtelier(boutique.id, supplierId),
        signature: boutique.emailSignature,
      });

      try {
        await sendPlainEmail({ merchantId: boutique.id, to: atelier.contactEmail, fromName: nom, ...rappel });
        // Noté seulement s'il est parti : un rappel en échec repartira au
        // passage suivant au lieu d'être tenu pour envoyé.
        await prisma.envoiCommande.updateMany({
          where: { id: { in: commandes.map((commande) => commande.id) } },
          data: { rappeleLe: maintenant },
        });
        rappels += 1;
      } catch (error) {
        logger.warn({ err: error, merchantId: boutique.id, supplierId }, 'Rappel de retard non envoyé');
      }
    }
  }
  return rappels;
}
