import { prisma } from '../../lib/prisma.ts';

/**
 * Les remboursements décidés dans Ruptures de stock, que l'administration fait.
 *
 * L'équipe SAV choisit « Remboursement » sur une rupture ; l'administration
 * rembourse, dans Annulation/Remboursement. Quand c'est fait — par l'outil,
 * ou à la main dans Shopify — la ligne se ferme, et le dossier de rupture
 * avec elle : il n'y a plus rien à attendre de l'atelier ni du client.
 */

/** Ce qui attend, puis ce qui a été fait ces trente derniers jours. */
export async function listeARembourser(merchantId: string) {
  const depuis = new Date(Date.now() - 30 * 86_400_000);
  const lignes = await prisma.remboursementAFaire.findMany({
    where: { merchantId, OR: [{ faitLe: null }, { faitLe: { gte: depuis } }] },
    orderBy: [{ faitLe: { sort: 'asc', nulls: 'first' } }, { createdAt: 'asc' }],
    take: 200,
    select: {
      id: true,
      ticketId: true,
      orderName: true,
      shopifyOrderId: true,
      article: true,
      montant: true,
      devise: true,
      demandeParId: true,
      createdAt: true,
      faitLe: true,
      motif: true,
      clientNom: true,
      clientEmail: true,
      returnCaseId: true,
      ticket: { select: { customerName: true, customerEmail: true, gmailThreadId: true } },
    },
  });

  const auteurs = [...new Set(lignes.map((ligne) => ligne.demandeParId).filter((id): id is string => Boolean(id)))];
  const noms = new Map(
    (auteurs.length
      ? await prisma.user.findMany({ where: { id: { in: auteurs } }, select: { id: true, name: true, email: true } })
      : []
    ).map((utilisateur) => [utilisateur.id, utilisateur.name || utilisateur.email]),
  );

  return lignes.map((ligne) => {
    // Un signalement d'atelier porte le nom de l'atelier en guise de client.
    // Sans ticket — la différence d'un échange —, le client est sur la ligne.
    const signalement = ligne.ticket?.gmailThreadId.startsWith('supplier:') ?? false;
    const courriel = ligne.ticket?.customerEmail ?? ligne.clientEmail ?? null;
    const email = courriel?.startsWith('fournisseur+') ? null : courriel;
    return {
      id: ligne.id,
      ticketId: ligne.ticketId,
      orderName: ligne.orderName,
      shopifyOrderId: ligne.shopifyOrderId,
      article: ligne.article,
      montant: ligne.montant === null ? null : Number(ligne.montant),
      devise: ligne.devise,
      client: { nom: signalement ? null : (ligne.ticket?.customerName ?? ligne.clientNom ?? null), email },
      motif: ligne.motif,
      returnCaseId: ligne.returnCaseId,
      demandePar: ligne.demandeParId ? (noms.get(ligne.demandeParId) ?? null) : null,
      demandeLe: ligne.createdAt,
      faitLe: ligne.faitLe,
    };
  });
}

export const compteARembourser = (merchantId: string) =>
  prisma.remboursementAFaire.count({ where: { merchantId, faitLe: null } });

/**
 * Ferme la ligne « À rembourser » d'un dossier, et le dossier avec.
 *
 * Appelée après un remboursement fait dans l'outil, ou quand l'administration
 * dit l'avoir fait dans Shopify. Ne fait rien si rien n'attendait : un
 * remboursement ordinaire, sans rupture, ne touche pas aux tickets.
 */
export async function marquerRembourse(params: {
  merchantId: string;
  ticketId?: string | null;
  id?: string;
  refundId?: string | null;
}): Promise<number> {
  const { merchantId } = params;
  if (!params.ticketId && !params.id) return 0;

  const lignes = await prisma.remboursementAFaire.findMany({
    where: { merchantId, faitLe: null, ...(params.id ? { id: params.id } : { ticketId: params.ticketId! }) },
    select: { id: true, ticketId: true },
  });
  if (lignes.length === 0) return 0;

  const maintenant = new Date();
  const tickets = [...new Set(lignes.map((ligne) => ligne.ticketId).filter((id): id is string => Boolean(id)))];
  await prisma.$transaction([
    prisma.remboursementAFaire.updateMany({
      where: { id: { in: lignes.map((ligne) => ligne.id) } },
      data: { faitLe: maintenant, refundId: params.refundId ?? null },
    }),
    // Le dossier de rupture se ferme : signalement de l'atelier (le ticket),
    // ou escalade du marchand.
    prisma.ticket.updateMany({ where: { merchantId, id: { in: tickets } }, data: { status: 'CLOSED' } }),
    prisma.supplierEscalation.updateMany({
      where: { merchantId, ticketId: { in: tickets }, reason: 'OUT_OF_STOCK', status: { not: 'RESOLVED' } },
      data: { status: 'RESOLVED', resolvedAt: maintenant },
    }),
  ]);
  return lignes.length;
}
