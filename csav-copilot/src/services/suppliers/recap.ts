import { logger } from '../../lib/logger.ts';
import { prisma } from '../../lib/prisma.ts';
import { FERMETURE, heureAtelier, jourAtelier } from '../envoi/rappel.ts';
import { sendPlainEmail } from '../gmail/send.ts';
import { lienAtelier } from '../ruptures/substitution.ts';
import { langueAtelier } from './langueAtelier.ts';
import { recapDuJour, type RuptureDuRecap } from './recapTexte.ts';
import { KINDS_DU_RECAP } from './urgence.ts';

/**
 * Le récapitulatif du matin : un mail par atelier et par jour.
 *
 * Il porte ce qui n'est pas parti sur-le-champ — les demandes qui ne changent
 * pas le colis, les modèles de remplacement proposés — et, une fois, ce qui
 * attend toujours sa réponse depuis le récapitulatif précédent. Les demandes
 * urgentes ont eu leur mail et ont leur propre rappel (cron) : les remettre
 * ici ferait deux rappels pour une seule demande.
 *
 * Il part à 9 h chez l'atelier, au premier passage du worker après cette
 * heure : la journée du marchand, à Paris, tombe dans l'après-midi et la nuit
 * chinoises, et tout ce qu'il a demandé la veille est là au réveil.
 */

export const HEURE_RECAP = 9;

/** Au-delà, une demande jamais annoncée est trop vieille pour être « nouvelle ». */
const FRAICHEUR_MS = 7 * 86_400_000;
/** Annoncée depuis au moins ça, une demande sans réponse est rappelée. */
const ATTENTE_MS = 12 * 3_600_000;

const champsDemande = {
  id: true,
  kind: true,
  orderName: true,
  beforeValue: true,
  afterValue: true,
  message: true,
  createdAt: true,
} as const;

function parDossier(
  propositions: ReadonlyArray<{ id: string; ticketId: string; createdAt: Date; ticket: { orderName: string | null } }>,
  maintenant: Date,
): Array<RuptureDuRecap & { jours: number }> {
  const dossiers = new Map<string, RuptureDuRecap & { jours: number }>();
  for (const proposition of propositions) {
    const dossier = dossiers.get(proposition.ticketId);
    const jours = Math.floor((maintenant.getTime() - proposition.createdAt.getTime()) / 86_400_000);
    if (dossier) {
      dossier.combien += 1;
      dossier.jours = Math.max(dossier.jours, jours);
    } else {
      dossiers.set(proposition.ticketId, { orderName: proposition.ticket.orderName, combien: 1, jours });
    }
  }
  return [...dossiers.values()];
}

/** Un passage : à appeler régulièrement (le worker le fait toutes les quinze minutes). */
export async function envoyerRecapitulatifs(maintenant = new Date()): Promise<number> {
  const heure = heureAtelier(maintenant);
  if (heure < HEURE_RECAP || heure >= FERMETURE) return 0;
  const aujourdhui = jourAtelier(maintenant);
  const fraiches = new Date(maintenant.getTime() - FRAICHEUR_MS);
  const annoncees = new Date(maintenant.getTime() - ATTENTE_MS);

  const ateliers = await prisma.supplier.findMany({
    where: { active: true },
    select: {
      id: true,
      merchantId: true,
      contactEmail: true,
      recapLe: true,
      langue: true,
      merchant: { select: { name: true, brandName: true, shopDomain: true, emailSignature: true } },
    },
  });

  let envoyes = 0;
  for (const atelier of ateliers) {
    if (atelier.recapLe && jourAtelier(atelier.recapLe) === aujourdhui) continue;
    const chez = { merchantId: atelier.merchantId, supplierId: atelier.id };
    // Un dossier clos ne demande plus rien à l'atelier, même sans sa réponse.
    const dossierOuvert = { ticket: { status: { not: 'CLOSED' as const } } };

    const [nouvelles, enAttente, propositions, propositionsEnAttente] = await Promise.all([
      // Jamais annoncées : les non urgentes, et une urgente dont le mail a
      // échoué — le récapitulatif la rattrape plutôt que de la perdre.
      prisma.supplierAlert.findMany({
        where: { ...chez, status: 'PENDING', emailedAt: null, createdAt: { gte: fraiches } },
        orderBy: { createdAt: 'asc' },
        select: champsDemande,
      }),
      prisma.supplierAlert.findMany({
        where: {
          ...chez,
          status: 'PENDING',
          kind: { in: [...KINDS_DU_RECAP] },
          remindedAt: null,
          emailedAt: { not: null, lte: annoncees },
        },
        orderBy: { createdAt: 'asc' },
        select: champsDemande,
      }),
      prisma.ruptureSubstitution.findMany({
        where: { ...chez, ...dossierOuvert, avisLe: null, reponduLe: null, createdAt: { gte: fraiches } },
        orderBy: { createdAt: 'asc' },
        select: { id: true, ticketId: true, createdAt: true, ticket: { select: { orderName: true } } },
      }),
      prisma.ruptureSubstitution.findMany({
        where: { ...chez, ...dossierOuvert, reponduLe: null, rappelLe: null, avisLe: { not: null, lte: annoncees } },
        orderBy: { createdAt: 'asc' },
        select: { id: true, ticketId: true, createdAt: true, ticket: { select: { orderName: true } } },
      }),
    ]);

    const nom = atelier.merchant.brandName || atelier.merchant.name || atelier.merchant.shopDomain;
    const jours = (date: Date) => Math.floor((maintenant.getTime() - date.getTime()) / 86_400_000);
    const recap = recapDuJour({
      langue: langueAtelier(atelier.langue),
      merchantName: nom,
      nouvelles: { demandes: nouvelles, ruptures: parDossier(propositions, maintenant) },
      enAttente: {
        demandes: enAttente.map((demande) => ({ ...demande, jours: jours(demande.createdAt) })),
        ruptures: parDossier(propositionsEnAttente, maintenant),
      },
      lien: await lienAtelier(atelier.merchantId, atelier.id),
      signature: atelier.merchant.emailSignature,
    });

    try {
      if (recap) {
        await sendPlainEmail({ merchantId: atelier.merchantId, to: atelier.contactEmail, fromName: nom, ...recap });
      }
      // Noté seulement après l'envoi : un récapitulatif en échec repart au
      // passage suivant, avec tout son contenu.
      await prisma.$transaction([
        prisma.supplierAlert.updateMany({
          where: { id: { in: nouvelles.map((demande) => demande.id) } },
          data: { emailedAt: maintenant },
        }),
        prisma.supplierAlert.updateMany({
          where: { id: { in: enAttente.map((demande) => demande.id) } },
          data: { remindedAt: maintenant },
        }),
        prisma.ruptureSubstitution.updateMany({
          where: { id: { in: propositions.map((proposition) => proposition.id) } },
          data: { avisLe: maintenant },
        }),
        prisma.ruptureSubstitution.updateMany({
          where: { id: { in: propositionsEnAttente.map((proposition) => proposition.id) } },
          data: { rappelLe: maintenant },
        }),
        prisma.supplier.update({ where: { id: atelier.id }, data: { recapLe: maintenant } }),
      ]);
      if (recap) envoyes += 1;
    } catch (error) {
      logger.warn({ err: error, merchantId: atelier.merchantId, supplierId: atelier.id }, 'Récapitulatif non envoyé');
    }
  }
  return envoyes;
}
