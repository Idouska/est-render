import { prisma } from '../../lib/prisma.ts';
import { getShopifyClient, ShopifyScopeError } from '../shopify/client.ts';
import { getOrderById } from '../shopify/orders.ts';
import { brouillonSimule, creerLienDifference, lienPaye, prixDeclinaison } from '../shopify/brouillons.ts';

/*
 * Échange contre un autre modèle : l'écart de prix, et ce qu'on en fait.
 *
 * Les deux prix sont relus chez Shopify — celui que le client a payé pour la
 * paire qui revient, sur sa commande ; celui de la paire voulue, sur le
 * catalogue. Un montant facturé au client ne vient jamais de l'écran.
 */

export const CHOIX_ECART = ['LIEN', 'OFFERT', 'REMBOURSER', 'GARDER'] as const;
export type ChoixEcart = (typeof CHOIX_ECART)[number];

const normal = (texte: string | null | undefined) => (texte ?? '').trim().toLowerCase();

/** Le prix unitaire payé pour l'article qui revient, ou `null`. */
export function prixPaye(
  lignes: ReadonlyArray<{ title: string; variantTitle: string | null; sku: string | null; quantity: number; price: string | null }>,
  article: { sku?: string | null; productTitle: string; variantTitle?: string | null },
): number | null {
  const ligne =
    (article.sku ? lignes.find((candidate) => candidate.sku && normal(candidate.sku) === normal(article.sku)) : undefined) ??
    lignes.find(
      (candidate) =>
        normal(candidate.title) === normal(article.productTitle) &&
        (!article.variantTitle || normal(candidate.variantTitle) === normal(article.variantTitle)),
    ) ??
    lignes.find((candidate) => normal(candidate.title) === normal(article.productTitle));
  const total = Number(ligne?.price);
  if (!ligne || !ligne.price || !Number.isFinite(total)) return null;
  return Math.round((total / Math.max(1, ligne.quantity)) * 100) / 100;
}

/**
 * Le choix retenu pour un écart : celui demandé s'il convient au sens de
 * l'écart, sinon le premier qui convient. Plus cher : payer ou offrir ;
 * moins cher : rembourser ou garder ; même prix : rien.
 */
export function choixPourEcart(ecart: number | null, demande: string | null | undefined): ChoixEcart | null {
  if (ecart === null || Math.abs(ecart) < 0.005) return null;
  const permis: ChoixEcart[] = ecart > 0 ? ['LIEN', 'OFFERT'] : ['REMBOURSER', 'GARDER'];
  return permis.includes(demande as ChoixEcart) ? (demande as ChoixEcart) : permis[0]!;
}

export async function calculerEcart(
  merchantId: string,
  params: { shopifyOrderId: string | null | undefined; wantedVariantId: string; sku?: string | null; productTitle: string; variantTitle?: string | null },
): Promise<{ prixRetour: number | null; prixVoulu: number | null; ecart: number | null; devise: string | null }> {
  const client = await getShopifyClient(merchantId);
  const [commande, prixVoulu] = await Promise.all([
    params.shopifyOrderId ? getOrderById(client, params.shopifyOrderId).catch(() => null) : Promise.resolve(null),
    prixDeclinaison(client, params.wantedVariantId).catch(() => null),
  ]);
  const prixRetour = commande ? prixPaye(commande.lineItems, params) : null;
  const ecart = prixRetour !== null && prixVoulu !== null ? Math.round((prixVoulu - prixRetour) * 100) / 100 : null;
  return { prixRetour, prixVoulu, ecart, devise: commande?.currency ?? null };
}

/** Envoie le lien de paiement d'un dossier ; garde la raison si Shopify refuse. */
export async function envoyerLienDifference(merchantId: string, id: string): Promise<{ envoye: boolean; erreur: string | null }> {
  const dossier = await prisma.returnCase.findFirst({
    where: { id, merchantId },
    select: { customerEmail: true, ecartPrix: true, devise: true, orderName: true, wantedTitle: true, wantedVariantTitle: true, payeLe: true },
  });
  if (!dossier) return { envoye: false, erreur: 'Dossier introuvable' };
  if (dossier.payeLe) return { envoye: false, erreur: 'La différence est déjà payée.' };
  const montant = Number(dossier.ecartPrix);
  if (!dossier.customerEmail) return enregistrerErreur(id, 'Le dossier n’a pas l’e-mail du client.');
  if (!(montant > 0)) return enregistrerErreur(id, 'Aucune différence à payer.');
  try {
    const client = await getShopifyClient(merchantId);
    const brouillon = await creerLienDifference(client, {
      email: dossier.customerEmail,
      montant,
      devise: dossier.devise,
      orderName: dossier.orderName,
      modele: [dossier.wantedTitle, dossier.wantedVariantTitle].filter(Boolean).join(' · '),
    });
    await prisma.returnCase.update({
      where: { id },
      data: { draftOrderId: brouillon.id, lienPaiement: brouillon.invoiceUrl, lienEnvoyeLe: new Date(), lienErreur: null },
    });
    return { envoye: true, erreur: null };
  } catch (error) {
    const raison =
      error instanceof ShopifyScopeError
        ? 'Shopify n’autorise pas encore l’outil à créer des liens de paiement : reconnectez la boutique dans Réglages.'
        : error instanceof Error
          ? error.message
          : 'Shopify n’a pas répondu.';
    return enregistrerErreur(id, raison);
  }
}

async function enregistrerErreur(id: string, raison: string) {
  await prisma.returnCase.update({ where: { id }, data: { lienErreur: raison } });
  return { envoye: false, erreur: raison };
}

/**
 * La différence est-elle réglée ? Relu chez Shopify quand un lien est parti ;
 * une commande provisoire simulée (mode test) attend un « Marquer payé ».
 */
export async function differenceReglee(merchantId: string, id: string): Promise<boolean> {
  const dossier = await prisma.returnCase.findFirst({
    where: { id, merchantId },
    select: { ecartChoix: true, payeLe: true, draftOrderId: true },
  });
  if (!dossier || dossier.ecartChoix !== 'LIEN' || dossier.payeLe) return true;
  if (!dossier.draftOrderId || brouillonSimule(dossier.draftOrderId)) return false;
  try {
    const client = await getShopifyClient(merchantId);
    if (!(await lienPaye(client, dossier.draftOrderId))) return false;
  } catch {
    return false;
  }
  await prisma.returnCase.update({ where: { id }, data: { payeLe: new Date() } });
  return true;
}
