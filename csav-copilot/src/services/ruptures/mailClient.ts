import { logger } from '../../lib/logger.ts';
import { prisma } from '../../lib/prisma.ts';
import { sendPlainEmail } from '../gmail/send.ts';
import { getShopifyClient } from '../shopify/client.ts';
import { getOrderById } from '../shopify/orders.ts';
import { lireArticle } from '../suppliers/signalement.ts';
import { MODELE_RUPTURE, TITRE_REPONSE_TYPE, delaiAnnonce, remplirMail, type ValeursMail } from './mailTexte.ts';

/**
 * Le mail au client quand un article de sa commande est en rupture.
 *
 * Il se rédigeait à chaque fois, depuis la fenêtre de réponse : le même
 * message, à la main, cinq fois par semaine. C'est une réponse type, réglée
 * une fois — « Rupture de stock » dans Réglages › Réponses types — et
 * remplie pour la commande : le prénom, le numéro, l'article, le délai
 * annoncé par l'atelier.
 *
 * Il part au clic, depuis la ligne de la rupture, ou tout seul dès que
 * l'atelier signale — au choix du marchand (`Merchant.mailRuptureAuto`).
 */

export { TITRE_REPONSE_TYPE, MODELE_RUPTURE, delaiAnnonce, remplirMail, type ValeursMail } from './mailTexte.ts';

const adresseDeRepli = (email: string | null | undefined) => !email || email.startsWith('fournisseur+');

export class MailImpossible extends Error {
  readonly code: 'introuvable' | 'sans_adresse';

  constructor(code: 'introuvable' | 'sans_adresse', message: string) {
    super(message);
    this.code = code;
  }
}

/** Le mail prêt à relire : destinataire, objet, texte. */
export async function mailRupture(
  merchantId: string,
  ticketId: string,
): Promise<{ a: string; nom: string | null; sujet: string; corps: string }> {
  const ticket = await prisma.ticket.findFirst({
    where: { id: ticketId, merchantId },
    select: {
      customerEmail: true,
      customerName: true,
      gmailThreadId: true,
      orderName: true,
      shopifyOrderId: true,
      messages: { where: { direction: 'INBOUND' }, orderBy: { receivedAt: 'asc' }, take: 1, select: { bodyText: true } },
    },
  });
  if (!ticket) throw new MailImpossible('introuvable', 'Dossier introuvable.');

  const signalement = ticket.gmailThreadId.startsWith('supplier:');
  const texte = ticket.messages[0]?.bodyText ?? null;
  const declare = signalement ? lireArticle(texte) : null;

  /* L'adresse et le nom du client : sur le ticket quand c'est lui qui a écrit,
     sur la commande quand c'est l'atelier — dont le ticket porte le nom. */
  let email = adresseDeRepli(ticket.customerEmail) ? null : ticket.customerEmail;
  let nom = signalement ? null : ticket.customerName;
  let ligne: { title: string; variantTitle: string | null } | null = null;
  if (ticket.shopifyOrderId && (!email || !nom || !declare?.produit)) {
    try {
      const commande = await getOrderById(await getShopifyClient(merchantId), ticket.shopifyOrderId);
      email ??= commande?.customer?.email ?? null;
      nom ??= commande?.customer?.displayName ?? commande?.shippingAddress?.name ?? null;
      const trouvee = commande?.lineItems.find((item) => declare?.reference && item.sku === declare.reference) ?? commande?.lineItems[0];
      if (trouvee) ligne = { title: trouvee.title, variantTitle: trouvee.variantTitle ?? null };
    } catch (error) {
      logger.warn({ err: error, ticketId }, 'Commande non relue pour le mail de rupture');
    }
  }
  if (!email) throw new MailImpossible('sans_adresse', 'Adresse du client inconnue : ouvrez la commande pour la retrouver.');

  const article = declare?.produit
    ? `${declare.produit}${[declare.couleur, declare.taille].filter(Boolean).length ? ` (${[declare.couleur, declare.taille].filter(Boolean).join(', ')})` : ''}`
    : ligne
      ? `${ligne.title}${ligne.variantTitle ? ` (${ligne.variantTitle})` : ''}`
      : null;

  const [boutique, reponseType] = await Promise.all([
    prisma.merchant.findUnique({ where: { id: merchantId }, select: { name: true, brandName: true, shopDomain: true } }),
    prisma.cannedReply.findFirst({
      where: { merchantId, title: { equals: TITRE_REPONSE_TYPE, mode: 'insensitive' } },
      select: { body: true },
    }),
  ]);
  const valeurs: ValeursMail = {
    prenom: nom?.trim().split(/\s+/)[0] ?? null,
    commande: ticket.orderName,
    article,
    boutique: boutique?.brandName || boutique?.name || boutique?.shopDomain || '',
    jours: delaiAnnonce(texte),
  };

  return {
    a: email,
    nom,
    sujet: remplirMail(MODELE_RUPTURE.sujet, valeurs),
    corps: remplirMail(reponseType?.body ?? MODELE_RUPTURE.corps, valeurs),
  };
}

/**
 * Envoie le mail et l'inscrit au dossier.
 *
 * Inscrit comme un message sortant du ticket : c'est ce qui fait passer le
 * dossier à « client prévenu », dans la page des ruptures comme chez
 * l'atelier — la même règle que pour une réponse écrite à la main.
 */
export async function envoyerMailRupture(params: {
  merchantId: string;
  ticketId: string;
  a: string;
  sujet: string;
  corps: string;
  auto: boolean;
}): Promise<Date> {
  const boutique = await prisma.merchant.findUnique({
    where: { id: params.merchantId },
    select: { name: true, brandName: true, shopDomain: true },
  });
  const envoi = await sendPlainEmail({
    merchantId: params.merchantId,
    to: params.a,
    subject: params.sujet,
    body: params.corps,
    fromName: boutique?.brandName || boutique?.name || boutique?.shopDomain || null,
  });
  const maintenant = new Date();
  await prisma.message.create({
    data: {
      merchantId: params.merchantId,
      ticketId: params.ticketId,
      // Le préfixe dit d'où vient le message : « automatique » se lit sur la ligne.
      gmailMessageId: `${params.auto ? 'rupture-auto' : 'rupture-mail'}:${params.ticketId}:${envoi.gmailMessageId ?? maintenant.getTime()}`,
      direction: 'OUTBOUND',
      fromEmail: envoi.fromEmail,
      toEmail: params.a,
      subject: params.sujet,
      bodyText: params.corps,
      snippet: params.corps.replace(/\s+/g, ' ').trim().slice(0, 200),
      receivedAt: maintenant,
    },
  });
  return maintenant;
}

/** Le mail automatique, au signalement : sans adresse, il ne part pas, et rien ne casse. */
export async function mailRuptureAutomatique(merchantId: string, ticketId: string): Promise<boolean> {
  const reglage = await prisma.merchant.findUnique({ where: { id: merchantId }, select: { mailRuptureAuto: true } });
  if (!reglage?.mailRuptureAuto) return false;
  try {
    const mail = await mailRupture(merchantId, ticketId);
    await envoyerMailRupture({ merchantId, ticketId, a: mail.a, sujet: mail.sujet, corps: mail.corps, auto: true });
    return true;
  } catch (error) {
    logger.warn({ err: error, ticketId }, 'Mail de rupture automatique non envoyé');
    return false;
  }
}
