import { prisma } from '../../lib/prisma.ts';
import { bornesDuMois, moisCourant } from '../suppliers/releve.ts';
import { coutsRenseignes, gestesParMois, lireCoutsUnitaires, moisJusqua, montants } from './calcul.ts';

/**
 * Les coûts du SAV des douze derniers mois, lus en une requête.
 *
 * Un mois de plus que l'écran n'en montre : le plus ancien ne sert qu'à
 * comparer le premier affiché à celui d'avant.
 */

export const MOIS_AFFICHES = 12;

export async function coutsDuSav(merchantId: string, maintenant = new Date()) {
  const courant = moisCourant(maintenant);
  const mois = moisJusqua(courant, MOIS_AFFICHES + 1);
  const depuis = { gte: bornesDuMois(mois[0]!)!.debut };

  const [merchant, lignes] = await Promise.all([
    prisma.merchant.findUnique({ where: { id: merchantId }, select: { coutsSav: true } }),
    prisma.returnCase.findMany({
      where: {
        merchantId,
        // Une paire ajoutée au stock à la main n'a rien coûté au SAV.
        origine: 'RETOUR',
        // Un dossier ancien coûte encore s'il a bougé dans la fenêtre : un
        // retour ouvert en mars peut n'être reçu qu'en avril.
        OR: [
          { createdAt: depuis },
          { labelSentAt: depuis },
          { receivedAt: depuis },
          { unusableAt: depuis },
          { reusedAt: depuis },
          { exchangeShippedAt: depuis },
          { reshippedAt: depuis },
        ],
      },
      select: {
        id: true,
        shopifyOrderId: true,
        orderName: true,
        productTitle: true,
        reason: true,
        agencyId: true,
        createdAt: true,
        labelSentAt: true,
        receivedAt: true,
        unusableAt: true,
        reusedAt: true,
        exchangeShippedAt: true,
        exchangeSupplierId: true,
        exchangeTrackingNumber: true,
        reshippedAt: true,
        reshipTrackingNumber: true,
        reusedShopifyOrderId: true,
        reusedOrderName: true,
      },
    }),
  ]);

  const couts = lireCoutsUnitaires(merchant?.coutsSav);
  return {
    courant,
    couts,
    renseignes: coutsRenseignes(couts),
    mois: gestesParMois(lignes, mois).map((ligne) => ({ ...ligne, montants: montants(ligne.volumes, couts) })),
  };
}
