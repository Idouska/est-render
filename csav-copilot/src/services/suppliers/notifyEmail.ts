/**
 * Le mail que reçoit un fournisseur, et l'idée qu'il se fait de la boutique.
 *
 * Le précédent portait en objet un identifiant technique de vingt-cinq
 * caractères — « commande cmsj3nfsu000liz01f92sk2c7 » — et pour tout corps
 * trois lignes suivies d'une URL nue de trois cents caractères. Ni nom de
 * boutique, ni commande lisible, ni signature. Les filtres le classaient en
 * indésirables, et l'atelier qui le trouvait quand même n'y apprenait rien.
 *
 * La correction n'est pas d'en faire une carte : un mail de travail entre un
 * marchand et son atelier n'est pas une infolettre, et le déguiser en bandeau
 * coloré le rend plus suspect, pas moins. C'est un message ordinaire, écrit
 * comme le marchand l'écrirait dans Gmail — quelques phrases, le lien sur sa
 * ligne, la signature de la maison. Rien de plus.
 */

const REASON_LABELS: Record<string, string> = {
  OUT_OF_STOCK: 'rupture de stock',
  INCORRECT_ADDRESS: 'adresse incorrecte ou incomplète',
  MISSING_ITEM: 'article manquant',
  DAMAGED: 'article abîmé',
  LATE: 'retard de livraison',
  OTHER: 'demande particulière',
};

export interface EscalationMailContext {
  merchantName: string;
  supplierName: string;
  orderName: string | null;
  reason: string;
  portalUrl: string;
  /**
   * Signature du marchand, telle qu'il l'a écrite dans les réglages. Absente,
   * le nom de la boutique en tient lieu : mieux vaut une signature minimale
   * qu'un message qui s'arrête net.
   */
  signature?: string | null;
  /** Note laissée par l'agent au moment de l'escalade, s'il en a laissé une. */
  note?: string | null;
}

/**
 * L'objet du mail.
 *
 * Le numéro de commande quand on l'a — c'est ce que l'atelier cherchera dans
 * sa boîte trois jours plus tard. Jamais d'identifiant interne : il ne veut
 * rien dire pour le destinataire, et un objet incompréhensible est le premier
 * critère de mise en indésirables.
 */
export function escalationSubject(context: EscalationMailContext): string {
  const about = context.orderName ? `commande ${context.orderName}` : 'une commande';
  return `${context.merchantName} — ${about} : ${REASON_LABELS[context.reason] ?? 'demande'}`;
}

/**
 * Le corps du mail, en texte.
 *
 * Volontairement sans HTML. Un message tapé à la main dans Gmail part en
 * texte, et c'est exactement ce qu'on veut imiter : le fournisseur doit avoir
 * l'impression qu'une personne lui écrit, parce que c'est le cas — un agent
 * vient de cliquer.
 */
export function escalationText(context: EscalationMailContext): string {
  const reason = REASON_LABELS[context.reason] ?? 'demande particulière';

  const lines = [
    `Bonjour ${context.supplierName},`,
    '',
    context.orderName
      ? `Nous avons besoin de vous sur la commande ${context.orderName} : ${reason}.`
      : `Nous avons besoin de vous sur une commande en cours : ${reason}.`,
  ];

  // La note de l'agent, quand il en a écrit une : c'est le seul endroit où le
  // fournisseur apprend ce qu'on attend précisément de lui.
  const note = context.note?.trim();
  if (note) {
    lines.push('', note);
  }

  lines.push(
    '',
    'Le détail et le formulaire de réponse sont ici :',
    context.portalUrl,
    '',
    'Le lien ouvre directement la demande, sans mot de passe — merci de ne pas',
    'le transférer.',
    '',
    'Merci d’avance,',
  );

  const signature = context.signature?.trim() || context.merchantName;
  lines.push(signature);

  return lines.join('\n');
}
