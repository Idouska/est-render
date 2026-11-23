import { env } from '../../config/env.ts';
import { logger } from '../../lib/logger.ts';
import { prisma } from '../../lib/prisma.ts';

/*
 * Prévenir par e-mail quand Shopify ou Gmail se déconnecte.
 *
 * Une connexion coupée ne se voyait qu'en ouvrant l'outil : le 22 novembre,
 * Shopify a refusé l'accès et quinze messages sont restés sans traitement,
 * sans que personne ne le sache. Désormais, la panne est notée une seule fois
 * (`ShopifyConnection.accesRefuseLe`, `GmailConnection.panneLe`) et les
 * propriétaires et superviseurs reçoivent un e-mail qui dit ce qui est
 * arrêté et comment réparer. Rien d'autre tant que la panne dure ; la
 * reconnexion efface la marque, et une panne suivante sera signalée à nouveau.
 *
 * L'outil n'a pas de messagerie à lui : il écrit par Gmail. L'alerte part
 * donc d'une boîte qui marche — une autre boîte de la boutique, sinon celle
 * d'une autre boutique du même compte. Quand il n'y en a aucune, le bandeau
 * du tableau de bord reste le seul signal, et le journal le dit.
 */

export type Panne = { quoi: 'shopify' } | { quoi: 'gmail'; mailboxId: string; adresse: string };

type ParametresEnvoi = {
  merchantId: string;
  mailboxId?: string | null;
  to: string;
  subject: string;
  body: string;
  fromName?: string | null;
  memeEnModeTest?: boolean;
};

const DEPENDANCES = {
  prisma,
  // Chargé à l'usage : le client Shopify importe ce module, et l'envoi Gmail
  // n'a rien à faire dans son chargement.
  envoyer: async (params: ParametresEnvoi) => (await import('../gmail/send.ts')).sendPlainEmail(params),
  maintenant: () => new Date(),
};
export type DependancesAlerte = typeof DEPENDANCES;

/** Une autorisation Google retirée : jeton révoqué, mot de passe changé, accès supprimé. */
export function autorisationGoogleRetiree(error: unknown): boolean {
  const e = error as { message?: unknown; response?: { data?: { error?: unknown } } } | null;
  return e?.response?.data?.error === 'invalid_grant' || /invalid_grant/i.test(String(e?.message ?? ''));
}

/** Les propriétaires et superviseurs actifs, à une adresse qu'on peut lire. */
async function destinataires(merchantId: string, deps: DependancesAlerte): Promise<string[]> {
  const equipe = await deps.prisma.user.findMany({
    where: { merchantId, active: true, role: { in: ['OWNER', 'SUPERVISOR'] } },
    select: { email: true },
  });
  // `owner@boutique.myshopify.com` est un compte technique, pas une boîte.
  return [
    ...new Set(
      equipe
        .map((membre) => membre.email.trim().toLowerCase())
        .filter((email) => email.includes('@') && !email.endsWith('.myshopify.com')),
    ),
  ];
}

/** Une boîte en état d'écrire, autre que celle en panne. */
async function boiteDEnvoi(
  merchantId: string,
  organizationId: string | null,
  sauf: string | null,
  deps: DependancesAlerte,
): Promise<{ merchantId: string; mailboxId: string } | null> {
  const propre = await deps.prisma.gmailConnection.findFirst({
    where: { merchantId, panneLe: null, ...(sauf ? { id: { not: sauf } } : {}) },
    orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    select: { id: true },
  });
  if (propre) return { merchantId, mailboxId: propre.id };
  if (!organizationId) return null;

  const voisine = await deps.prisma.gmailConnection.findFirst({
    where: {
      panneLe: null,
      merchantId: { not: merchantId },
      merchant: { organizationId, demo: false },
    },
    orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    select: { id: true, merchantId: true },
  });
  return voisine ? { merchantId: voisine.merchantId, mailboxId: voisine.id } : null;
}

const quand = (date: Date) =>
  date.toLocaleString('fr-FR', {
    timeZone: 'Europe/Paris',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  });

/** Le message : ce qui est arrêté, et le geste qui répare. */
export function texteAlerte(
  panne: Panne,
  boutique: { nom: string; domaine: string },
  depuis: Date,
): { subject: string; body: string } {
  const fin = [
    '',
    'Ce message n’est envoyé qu’une fois par panne.',
    '— cSAV Copilot',
  ];

  if (panne.quoi === 'shopify') {
    return {
      subject: `${boutique.nom} : Shopify est déconnecté du SAV`,
      body: [
        'Bonjour,',
        '',
        `Depuis le ${quand(depuis)}, Shopify refuse l’accès de cSAV Copilot à la boutique ${boutique.nom}.`,
        '',
        'Tant que ce n’est pas réparé :',
        '- les messages ne retrouvent plus leur commande ;',
        '- l’IA ne prépare plus de réponse aux nouveaux messages ;',
        '- les photos des produits ne s’affichent plus.',
        '',
        'Pour réparer (une minute) : ouvrez ce lien et acceptez l’installation dans Shopify.',
        `${env.APP_URL}/auth/shopify?shop=${encodeURIComponent(boutique.domaine)}`,
        '',
        'Ensuite, dans la Boîte de réception, cliquez sur « Relancer » pour les messages restés en échec.',
        ...fin,
      ].join('\n'),
    };
  }

  return {
    subject: `${boutique.nom} : la boîte ${panne.adresse} ne reçoit plus le SAV`,
    body: [
      'Bonjour,',
      '',
      `Depuis le ${quand(depuis)}, Google refuse l’accès de cSAV Copilot à la boîte ${panne.adresse} (boutique ${boutique.nom}).`,
      '',
      'Tant que ce n’est pas réparé :',
      '- les nouveaux messages des clients n’arrivent plus dans le SAV ;',
      '- aucune réponse ne peut partir de cette boîte.',
      '',
      `Pour réparer : ouvrez le SAV, Réglages › Connexions, puis « Reconnecter » sur la boîte ${panne.adresse}, et acceptez l’autorisation Google.`,
      `${env.APP_URL}/dashboard`,
      '',
      'Une fois la boîte reconnectée, « Relever » sur cette boîte rattrape les messages arrivés entre-temps.',
      ...fin,
    ].join('\n'),
  };
}

export type IssueAlerte = 'envoyee' | 'demo' | 'personne' | 'aucune-boite' | 'echec';

/** Écrit aux propriétaires et superviseurs. Ne lève jamais : une alerte ratée ne casse rien. */
export async function prevenirPanne(
  merchantId: string,
  panne: Panne,
  deps: DependancesAlerte = DEPENDANCES,
): Promise<IssueAlerte> {
  try {
    const marchand = await deps.prisma.merchant.findUnique({
      where: { id: merchantId },
      select: { name: true, brandName: true, shopDomain: true, organizationId: true, demo: true },
    });
    if (!marchand || marchand.demo) return 'demo';

    const a = await destinataires(merchantId, deps);
    if (a.length === 0) {
      logger.warn({ merchantId, panne: panne.quoi }, 'Panne de connexion : personne à prévenir');
      return 'personne';
    }

    const boite = await boiteDEnvoi(
      merchantId,
      marchand.organizationId,
      panne.quoi === 'gmail' ? panne.mailboxId : null,
      deps,
    );
    if (!boite) {
      logger.warn({ merchantId, panne: panne.quoi }, 'Panne de connexion : aucune boîte en état de prévenir');
      return 'aucune-boite';
    }

    const nom = marchand.brandName || marchand.name || marchand.shopDomain;
    const { subject, body } = texteAlerte(panne, { nom, domaine: marchand.shopDomain }, deps.maintenant());
    for (const destinataire of a) {
      await deps.envoyer({
        merchantId: boite.merchantId,
        mailboxId: boite.mailboxId,
        to: destinataire,
        subject,
        body,
        fromName: 'cSAV Copilot',
        // Une alerte à l'équipe, pas un mail à un client : le mode test ne la retient pas.
        memeEnModeTest: true,
      });
    }
    logger.info({ merchantId, panne: panne.quoi, destinataires: a.length }, 'Panne de connexion signalée par e-mail');
    return 'envoyee';
  } catch (error) {
    logger.error({ merchantId, panne: panne.quoi, err: error }, 'Alerte de panne non envoyée');
    return 'echec';
  }
}

/** Shopify a répondu 401 : noté une fois, et l'équipe prévenue une fois. */
export async function signalerPanneShopify(
  merchantId: string,
  deps: DependancesAlerte = DEPENDANCES,
): Promise<IssueAlerte | 'deja-signalee'> {
  // La marque se pose sous condition : deux appels refusés en même temps ne
  // font partir qu'un seul e-mail.
  const { count } = await deps.prisma.shopifyConnection.updateMany({
    where: { merchantId, accesRefuseLe: null },
    data: { accesRefuseLe: deps.maintenant() },
  });
  if (count !== 1) return 'deja-signalee';
  return prevenirPanne(merchantId, { quoi: 'shopify' }, deps);
}

/** Google refuse l'accès à une boîte : notée une fois, et l'équipe prévenue une fois. */
export async function signalerPanneGmail(
  merchantId: string,
  mailboxId: string | null | undefined,
  motif: string,
  deps: DependancesAlerte = DEPENDANCES,
): Promise<IssueAlerte | 'deja-signalee' | 'introuvable'> {
  const boite = await deps.prisma.gmailConnection.findFirst({
    where: mailboxId ? { id: mailboxId, merchantId } : { merchantId },
    orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    select: { id: true, emailAddress: true },
  });
  if (!boite) return 'introuvable';

  const { count } = await deps.prisma.gmailConnection.updateMany({
    where: { id: boite.id, panneLe: null },
    data: { panneLe: deps.maintenant(), panneMotif: motif },
  });
  if (count !== 1) return 'deja-signalee';
  return prevenirPanne(merchantId, { quoi: 'gmail', mailboxId: boite.id, adresse: boite.emailAddress }, deps);
}
