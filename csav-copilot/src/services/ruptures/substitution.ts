import { env } from '../../config/env.ts';
import { logger } from '../../lib/logger.ts';
import { prisma } from '../../lib/prisma.ts';
import { signSupplierWorkspaceToken } from '../../lib/supplierToken.ts';
import { sendPlainEmail } from '../gmail/send.ts';
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
 * dormirait. Mais il ne porte plus l'échange — seulement l'avis, et le lien
 * vers son atelier.
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
async function lienAtelier(merchantId: string, supplierId: string): Promise<string | null> {
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
 * L'avis envoyé à l'atelier : court, et qui renvoie à son atelier.
 *
 * Pas le contenu de la proposition. Le détail — modèle, taille, stock — vit
 * dans l'atelier, où il se répond en un clic ; le recopier ici inviterait à
 * répondre par mail, ce qu'on vient précisément de quitter.
 */
export function avisSubstitution(contexte: {
  merchantName: string;
  orderName: string | null;
  combien: number;
  lien: string;
  signature?: string | null;
}): { subject: string; body: string } {
  const commande = contexte.orderName ? ` ${contexte.orderName}` : '';
  const modeles =
    contexte.combien > 1 ? `${contexte.combien} modèles de remplacement` : 'un modèle de remplacement';

  return {
    subject: `Rupture${commande} : ${modeles} à valider`,
    body: [
      'Bonjour,',
      '',
      `Nous vous proposons ${modeles} pour la commande${commande || ' concernée'}.`,
      'Tout est dans votre atelier : le modèle en rupture, les remplacements possibles, et un bouton pour dire ce que vous pouvez envoyer.',
      '',
      contexte.lien,
      '',
      contexte.signature?.trim() || contexte.merchantName,
    ].join('\n'),
  };
}

/**
 * Propose des modèles de remplacement, et prévient l'atelier.
 *
 * L'e-mail part APRÈS l'écriture : une panne d'envoi ne doit pas perdre des
 * propositions déjà choisies, et l'atelier les trouvera de toute façon en
 * ouvrant son lien habituel.
 */
export async function proposerSubstitutions(params: {
  merchantId: string;
  ticketId: string;
  supplierId: string;
  propositions: readonly PropositionEntrante[];
}): Promise<{ creees: number; avertiPar: 'email' | null }> {
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

  const [merchant, ticket, supplier, lien] = await Promise.all([
    prisma.merchant.findUniqueOrThrow({
      where: { id: merchantId },
      select: { name: true, brandName: true, shopDomain: true, emailSignature: true },
    }),
    prisma.ticket.findFirstOrThrow({
      where: { id: ticketId, merchantId },
      select: { orderName: true },
    }),
    prisma.supplier.findFirstOrThrow({
      where: { id: supplierId, merchantId },
      select: { contactEmail: true },
    }),
    lienAtelier(merchantId, supplierId),
  ]);

  if (!lien) return { creees: params.propositions.length, avertiPar: null };

  const nom = merchant.brandName || merchant.name || merchant.shopDomain;
  const avis = avisSubstitution({
    merchantName: nom,
    orderName: ticket.orderName,
    combien: params.propositions.length,
    lien,
    signature: merchant.emailSignature,
  });

  try {
    await sendPlainEmail({
      merchantId,
      to: supplier.contactEmail,
      fromName: nom,
      subject: avis.subject,
      body: avis.body,
    });
    return { creees: params.propositions.length, avertiPar: 'email' };
  } catch (error) {
    // L'avis a échoué, les propositions sont posées : l'atelier les verra en
    // ouvrant son lien, et le marchand est prévenu que le mail n'est pas parti.
    logger.warn({ err: error, merchantId, supplierId }, 'Avis de substitution non envoyé');
    return { creees: params.propositions.length, avertiPar: null };
  }
}
