import { MOTS, type LangueAtelier } from '../suppliers/langueAtelier.ts';

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
  langue?: LangueAtelier;
  merchantName: string;
  delaiJours: number;
  commandes: ReadonlyArray<{ orderName: string; articles: string | null; jours: number }>;
  lien: string | null;
  signature?: string | null;
}): { subject: string; body: string } {
  const n = contexte.commandes.length;
  const mots = MOTS[contexte.langue ?? 'fr'];
  return {
    subject: mots.retardSujet(n, contexte.delaiJours),
    body: [
      mots.bonjour,
      '',
      mots.retardIntro(contexte.delaiJours),
      '',
      ...contexte.commandes.map(
        (commande) =>
          `- ${commande.orderName}${commande.articles ? ` — ${commande.articles}` : ''}${mots.depuis(commande.jours)}`,
      ),
      '',
      contexte.lien ? `${mots.retardLien}${{ fr: ' :', en: ':', zh: '：' }[contexte.langue ?? 'fr']}\n${contexte.lien}` : `${mots.retardLien}.`,
      '',
      contexte.signature?.trim() || contexte.merchantName,
    ].join('\n'),
  };
}
