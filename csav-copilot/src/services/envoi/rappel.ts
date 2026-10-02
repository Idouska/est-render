/**
 * Le rappel de retard : son texte, et l'heure de l'atelier qui décide s'il
 * part. Sans base ni réseau : se teste seul.
 */

const FUSEAU_ATELIER = 'Asia/Shanghai';
export const OUVERTURE = 8;
export const FERMETURE = 19;

export function heureAtelier(date: Date): number {
  return Number(
    new Intl.DateTimeFormat('en-GB', { timeZone: FUSEAU_ATELIER, hour: '2-digit', hour12: false })
      .format(date)
      .replace('24', '0'),
  );
}

/** Le jour de l'atelier, « AAAA-MM-JJ » : deux dates du même jour se comparent ainsi. */
export function jourAtelier(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: FUSEAU_ATELIER,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

export function rappelDuRetard(contexte: {
  merchantName: string;
  delaiJours: number;
  commandes: ReadonlyArray<{ orderName: string; articles: string | null; jours: number }>;
  lien: string | null;
  signature?: string | null;
}): { subject: string; body: string } {
  const n = contexte.commandes.length;
  return {
    subject: `Rappel — ${n} commande${n > 1 ? 's' : ''} à expédier depuis plus de ${contexte.delaiJours} jours`,
    body: [
      'Bonjour,',
      '',
      `Ces commandes vous ont été envoyées il y a plus de ${contexte.delaiJours} jours et n'ont pas encore de colis :`,
      '',
      ...contexte.commandes.map(
        (commande) => `- ${commande.orderName}${commande.articles ? ` — ${commande.articles}` : ''} (depuis ${commande.jours} j)`,
      ),
      '',
      contexte.lien
        ? `Saisissez leur numéro de suivi dans votre atelier, onglet « Lots reçus » :\n${contexte.lien}`
        : 'Saisissez leur numéro de suivi dans votre atelier, onglet « Lots reçus ».',
      '',
      contexte.signature?.trim() || contexte.merchantName,
    ].join('\n'),
  };
}
