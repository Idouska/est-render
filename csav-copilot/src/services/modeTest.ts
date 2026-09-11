import { prisma } from '../lib/prisma.ts';

/**
 * Le mode test d'un marchand.
 *
 * Allumé, l'outil fonctionne normalement — écrans, calculs, enregistrements
 * dans sa propre base — mais RIEN ne sort : aucune écriture chez Shopify
 * (expédition, remboursement), aucun e-mail aux clients ni aux fournisseurs.
 * Le marchand peut ainsi tester un parcours jusqu'au dernier bouton sans
 * qu'un client reçoive quoi que ce soit.
 *
 * Le blocage est posé aux seuls points de passage par où tout sort — le
 * client Shopify, les trois fonctions d'envoi Gmail — et non écran par
 * écran : une action ajoutée demain sera bloquée sans qu'on y pense.
 *
 * Il vaut pour tout le compte, ateliers compris : l'atelier n'a pas de
 * session, c'est donc le marchand qui porte le réglage.
 */
export async function enModeTest(merchantId: string): Promise<boolean> {
  const merchant = await prisma.merchant.findUnique({
    where: { id: merchantId },
    select: { testMode: true },
  });
  return merchant?.testMode ?? false;
}

/** Une action refusée parce que le mode test est allumé. */
export class ActionBloqueeEnTest extends Error {
  constructor(action: string) {
    super(`Mode test : l'action Shopify « ${action} » est bloquée, rien n'a été envoyé.`);
    this.name = 'ActionBloqueeEnTest';
  }
}

/** Marque des identifiants simulés : repérable d'un coup d'œil dans la base comme dans les journaux. */
const SIMULE = 'gid://csav/ModeTest';

/**
 * La réponse d'une requête Shopify en mode test.
 *
 * Une lecture (`query`) n'est pas concernée : `null`, elle part vraiment —
 * l'atelier doit voir ses vraies commandes. Une écriture connue reçoit la
 * réponse qu'aurait donnée Shopify en cas de succès, sans que Shopify l'ait
 * jamais reçue. Une écriture inconnue est REFUSÉE : mieux vaut un test qui
 * échoue qu'une action réelle qu'on n'avait pas prévu de simuler.
 */
export function ecritureSimulee(query: string): unknown {
  const operation = query.match(/^\s*(?:#[^\n]*\n\s*)*mutation\b\s*(\w*)/);
  if (!operation) return null;

  switch (operation[1]) {
    case 'CreateFulfillment':
      return {
        fulfillmentCreate: { fulfillment: { id: `${SIMULE}/Fulfillment/${Date.now()}` }, userErrors: [] },
      };
    case 'CreateRefund':
      return { refundCreate: { refund: { id: `${SIMULE}/Refund/${Date.now()}` }, userErrors: [] } };
    case 'UpdateFulfillmentTracking':
      return {
        fulfillmentTrackingInfoUpdate: { fulfillment: { id: `${SIMULE}/Fulfillment/${Date.now()}` }, userErrors: [] },
      };
    default:
      throw new ActionBloqueeEnTest(operation[1] || 'sans nom');
  }
}

/** Ce que rend un envoi Gmail simulé : pas d'identifiant Gmail, une adresse qui le dit. */
export const ENVOI_SIMULE = { gmailMessageId: null, fromEmail: 'mode-test@simulation' } as const;
