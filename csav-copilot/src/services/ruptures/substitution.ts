import { env } from '../../config/env.ts';
import { prisma } from '../../lib/prisma.ts';
import { signSupplierWorkspaceToken } from '../../lib/supplierToken.ts';
import { fournisseurDuFil } from '../suppliers/signalement.ts';

/**
 * Les modèles de remplacement proposés à l'atelier.
 *
 * CE QUI CHANGE. La substitution se discutait par e-mail et par fil de
 * discussion : le marchand écrivait « on peut mettre la 44 à la place ? »,
 * l'atelier répondait en texte libre, et personne ne savait d'un coup d'œil ce
 * qui avait été proposé ni ce qui avait été accepté. Il fallait relire le fil.
 *
 * Une proposition est désormais une LIGNE : le modèle, sa taille, sa référence,
 * son stock, et une réponse en un bouton. Le marchand voit où en est chaque
 * proposition sans lire une phrase, et l'atelier répond sans écrire.
 *
 * L'e-mail ne disparaît pas pour autant : l'atelier n'a ni compte ni mot de
 * passe, et un ticket posé dans un outil qu'il n'ouvre pas ce jour-là
 * dormirait. Mais il ne porte plus l'échange — seulement une ligne du
 * récapitulatif du matin, et le lien vers son atelier.
 */

export interface PropositionEntrante {
  productTitle: string;
  variantTitle?: string | null;
  sku?: string | null;
  image?: string | null;
  inventory?: number | null;
  libre?: boolean;
}

/**
 * À quel atelier s'adresse ce dossier.
 *
 * Deux origines, et une seule des deux porte une escalade : une rupture
 * signalée par l'atelier n'en a pas — c'est le fil du ticket qui le nomme.
 */
export async function atelierDuDossier(
  merchantId: string,
  ticketId: string,
): Promise<string | null> {
  const ticket = await prisma.ticket.findFirst({
    where: { id: ticketId, merchantId },
    select: {
      gmailThreadId: true,
      escalations: {
        where: { reason: 'OUT_OF_STOCK' },
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { supplierId: true },
      },
    },
  });
  if (!ticket) return null;

  return ticket.escalations[0]?.supplierId ?? fournisseurDuFil(ticket.gmailThreadId) ?? null;
}

/** Le lien de travail de l'atelier — le même que celui du marchand. */
export async function lienAtelier(merchantId: string, supplierId: string): Promise<string | null> {
  const supplier = await prisma.supplier.findFirst({
    where: { id: supplierId, merchantId },
    select: { portalTokenVersion: true },
  });
  if (!supplier) return null;

  const token = signSupplierWorkspaceToken({
    merchantId,
    supplierId,
    version: supplier.portalTokenVersion,
  });
  return `${env.APP_URL}/fournisseur/${supplierId}?token=${encodeURIComponent(token)}`;
}

/**
 * Le dossier de rupture qu'une proposition suppose.
 *
 * Proposer un remplacement depuis la fenêtre « Contacter le fournisseur » est
 * la façon d'ouvrir une rupture : il n'y a plus d'autre message à envoyer.
 * Sans escalade, la console Ruptures et l'atelier ne verraient pas le dossier.
 *
 * Un signalement de l'atelier en a déjà un — son ticket — et une escalade
 * restée en brouillon passe en « envoyée » : la proposition est le message
 * qu'elle attendait.
 */
export async function ouvrirDossierRupture(params: {
  merchantId: string;
  ticketId: string;
  supplierId: string;
}): Promise<void> {
  const { merchantId, ticketId, supplierId } = params;

  const ticket = await prisma.ticket.findFirst({
    where: { id: ticketId, merchantId },
    select: {
      gmailThreadId: true,
      escalations: {
        where: { reason: 'OUT_OF_STOCK', supplierId, status: { not: 'RESOLVED' } },
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { id: true, status: true },
      },
    },
  });
  if (!ticket || fournisseurDuFil(ticket.gmailThreadId)) return;

  const maintenant = new Date();
  const existante = ticket.escalations[0];

  if (existante?.status === 'DRAFTING') {
    await prisma.supplierEscalation.updateMany({
      where: { id: existante.id, merchantId, status: 'DRAFTING' },
      data: { status: 'OPEN', notifiedAt: maintenant },
    });
  } else if (!existante) {
    await prisma.supplierEscalation.create({
      data: {
        merchantId,
        ticketId,
        supplierId,
        reason: 'OUT_OF_STOCK',
        status: 'OPEN',
        notifiedAt: maintenant,
      },
    });
  }

  await prisma.ticket.updateMany({
    where: { id: ticketId, merchantId },
    data: { status: 'AWAITING_SUPPLIER' },
  });
}

/**
 * Propose des modèles de remplacement à l'atelier.
 *
 * Pas de mail sur-le-champ : les propositions s'affichent dans son atelier
 * dès maintenant, et le récapitulatif du matin les lui annonce — avec le
 * reste de la journée, plutôt qu'un mail de plus parmi dix.
 */
export async function proposerSubstitutions(params: {
  merchantId: string;
  ticketId: string;
  supplierId: string;
  propositions: readonly PropositionEntrante[];
}): Promise<{ creees: number; avertiPar: 'recap' }> {
  const { merchantId, ticketId, supplierId } = params;

  await prisma.ruptureSubstitution.createMany({
    data: params.propositions.map((proposition) => ({
      merchantId,
      ticketId,
      supplierId,
      productTitle: proposition.productTitle,
      variantTitle: proposition.variantTitle ?? null,
      sku: proposition.sku ?? null,
      image: proposition.image ?? null,
      inventory: proposition.inventory ?? null,
      libre: proposition.libre ?? false,
    })),
  });

  return { creees: params.propositions.length, avertiPar: 'recap' };
}
