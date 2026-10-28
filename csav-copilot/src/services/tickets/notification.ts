import { prisma } from '../../lib/prisma.ts';

/*
 * Les notifications d'applis : rangées à part, jamais dans la file.
 *
 * Judge.me qui annonce un nouvel avis, Shopify qui confirme un virement, une
 * infolettre, un réseau social, une réponse automatique « je suis absent » :
 * rien de tout cela n'est un client qui attend une réponse. Dans la file, ces
 * mails noyaient les vrais messages, faussaient les compteurs et passaient
 * chacun par l'IA — un brouillon de réponse à un robot, payé au prix d'un vrai.
 *
 * Le tri se fait à l'arrivée du mail, sur ce qu'il dit de lui-même : ses
 * en-têtes (désabonnement, envoi en masse, réponse automatique), l'onglet où
 * Gmail l'a rangé, son expéditeur. Il se trompe parfois : la file le dit, et
 * un clic le corrige — pour ce mail et pour les suivants du même expéditeur.
 *
 * Ce qui n'est JAMAIS écarté, même d'une adresse automatique : le formulaire
 * de contact de la boutique (un client, envoyé par Shopify) et tout ce qui
 * parle de litige ou d'opposition — un mail qu'on rate là coûte de l'argent.
 */

export interface IndicesMail {
  fromEmail: string;
  subject: string | null;
  labelIds?: string[];
  replyTo?: string | null;
  listUnsubscribe?: boolean;
  precedence?: string | null;
  autoSubmitted?: string | null;
}

export interface ReglagesNotif {
  /** Expéditeurs (adresse ou domaine) rangés à la main dans les notifications. */
  expediteursNotif: string[];
  /** Expéditeurs (adresse ou domaine) remis à la main dans la file. */
  expediteursClients: string[];
}

/** Toujours dans la file, d'où que le mail vienne. */
const SUJETS_PROTEGES = /formulaire de contact|contact form|customer message|message (?:d'un |du )?client|litige|dispute|chargeback|rétrofacturation|opposition/i;

/** Une adresse de robot, quel que soit le domaine. */
const ADRESSES_AUTOMATIQUES =
  /^[^@]*(?:no-?reply|do-?not-?reply|ne-?pas-?repondre|nepasrepondre|mailer-daemon|postmaster|bounces?|notifications?|newsletters?)[^@]*@/i;

/*
 * Les applis qui écrivent au marchand, pas ses clients. Les prestataires de
 * paiement n'y sont pas : leurs litiges arrivent par mail et ne doivent pas
 * disparaître d'une file.
 */
const DOMAINES_APPLIS = [
  'judge.me',
  'shopify.com',
  'shopifyemail.com',
  'klaviyo.com',
  'klaviyomail.com',
  'mailchimp.com',
  'mcsv.net',
  'facebookmail.com',
  'meta.com',
  'instagram.com',
  'tiktok.com',
  'google.com',
  'youtube.com',
  'linkedin.com',
  'canva.com',
  'trustpilot.com',
  '17track.net',
  'aftership.com',
];

const domaine = (email: string) => email.slice(email.lastIndexOf('@') + 1).toLowerCase();

/*
 * Les messageries grand public : leurs domaines sont partagés par des
 * millions de clients. Ranger « gmail.com » dans les notifications sortirait
 * la moitié du SAV de la file — on n'y range alors que l'adresse.
 */
const WEBMAILS = /^(?:gmail|googlemail|hotmail|outlook|live|msn|yahoo|ymail|icloud|me|mac|aol|gmx|proton|protonmail|orange|wanadoo|free|sfr|neuf|laposte|bbox|numericable)\./i;
export const estWebmail = (email: string): boolean => WEBMAILS.test(domaine(email));
const relevesDe = (email: string, liste: string[]) => {
  const adresse = email.toLowerCase();
  const dom = domaine(adresse);
  return liste.some((entree) => {
    const e = entree.toLowerCase().trim();
    return e === adresse || e === dom || dom.endsWith(`.${e}`);
  });
};

/** La raison pour laquelle ce mail est une notification, ou `null` si c'est peut-être un client. */
export function motifNotification(mail: IndicesMail, reglages?: ReglagesNotif): string | null {
  const email = mail.fromEmail.toLowerCase();
  if (!email) return null;

  // La main du marchand prime sur tout le reste.
  if (reglages && relevesDe(email, reglages.expediteursClients)) return null;
  if (reglages && relevesDe(email, reglages.expediteursNotif)) return 'Expéditeur rangé dans les notifications';

  if (SUJETS_PROTEGES.test(mail.subject ?? '')) return null;
  // Un « répondre à » humain derrière une adresse d'appli : un client qui
  // écrit par un formulaire. On lui répond, on ne le range pas.
  const repondreA = mail.replyTo?.toLowerCase();
  if (
    repondreA &&
    domaine(repondreA) !== domaine(email) &&
    !ADRESSES_AUTOMATIQUES.test(repondreA) &&
    !relevesDe(repondreA, DOMAINES_APPLIS)
  ) {
    return null;
  }

  const auto = mail.autoSubmitted?.trim().toLowerCase();
  if (auto && auto !== 'no') return 'Réponse automatique';
  if (/^(bulk|list|junk)$/i.test(mail.precedence?.trim() ?? '')) return 'Envoi en masse';
  if (mail.listUnsubscribe) return 'Lien de désabonnement : infolettre ou notification';

  const onglets = mail.labelIds ?? [];
  if (onglets.includes('CATEGORY_PROMOTIONS')) return 'Rangé par Gmail dans Promotions';
  if (onglets.includes('CATEGORY_SOCIAL')) return 'Rangé par Gmail dans Réseaux sociaux';

  if (ADRESSES_AUTOMATIQUES.test(email)) return 'Adresse d’envoi automatique';
  if (relevesDe(email, DOMAINES_APPLIS)) return `Appli : ${domaine(email)}`;
  return null;
}

/** Les réglages d'un marchand, lus une fois par relève. */
export async function reglagesNotif(merchantId: string): Promise<ReglagesNotif> {
  const merchant = await prisma.merchant.findUnique({
    where: { id: merchantId },
    select: { expediteursNotif: true, expediteursClients: true },
  });
  return { expediteursNotif: merchant?.expediteursNotif ?? [], expediteursClients: merchant?.expediteursClients ?? [] };
}
