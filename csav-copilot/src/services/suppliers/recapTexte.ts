import { MOTS, type LangueAtelier } from './langueAtelier.ts';

/**
 * Le texte du récapitulatif du matin. Sans base ni réseau : se teste seul.
 *
 * Une ligne par demande, la commande en tête : c'est elle que l'atelier
 * cherche dans son carnet. Le détail se répond dans l'atelier — le mail dit
 * quoi, pas comment, sans quoi on y répondrait par mail.
 */

export interface DemandeDuRecap {
  kind: string;
  orderName: string | null;
  beforeValue: string | null;
  afterValue: string | null;
  message: string;
}

export interface RuptureDuRecap {
  orderName: string | null;
  /** Modèles de remplacement proposés sur ce dossier. */
  combien: number;
}

type EnAttente<T> = T & { jours: number };

const MESSAGE_MAX = 140;

function detail(demande: DemandeDuRecap, langue: LangueAtelier): string | null {
  if (demande.kind === 'MISSING_ITEM' || demande.kind === 'TRACKING') return demande.beforeValue;
  if (demande.kind === 'DELAY') return demande.afterValue ? MOTS[langue].auPlusTard(demande.afterValue) : null;
  return demande.afterValue ? `${demande.beforeValue ?? '?'} → ${demande.afterValue}` : null;
}

function message(texte: string): string | null {
  const uneLigne = texte.replace(/\s+/g, ' ').trim();
  if (!uneLigne) return null;
  return uneLigne.length > MESSAGE_MAX ? `${uneLigne.slice(0, MESSAGE_MAX - 1)}…` : uneLigne;
}

export function ligneDemande(demande: DemandeDuRecap, langue: LangueAtelier = 'fr'): string {
  const mots = MOTS[langue];
  const titre = mots.titres[demande.kind] ?? mots.demande;
  const precision = detail(demande, langue);
  const mot = message(demande.message);
  // Les deux-points à la française gardent leur espace ; pas les autres.
  const deuxPoints = langue === 'fr' ? ' : ' : langue === 'zh' ? '：' : ': ';
  return [
    `- ${demande.orderName ?? mots.sansCommande} — ${titre}${precision ? `${deuxPoints}${precision}` : ''}`,
    mot ? ` — « ${mot} »` : '',
  ].join('');
}

export function ligneRupture(rupture: RuptureDuRecap, langue: LangueAtelier = 'fr'): string {
  return `- ${rupture.orderName ?? MOTS[langue].sansCommande} — ${MOTS[langue].rupture(rupture.combien)}`;
}

export function recapDuJour(contexte: {
  langue?: LangueAtelier;
  merchantName: string;
  nouvelles: { demandes: readonly DemandeDuRecap[]; ruptures: readonly RuptureDuRecap[] };
  enAttente: { demandes: ReadonlyArray<EnAttente<DemandeDuRecap>>; ruptures: ReadonlyArray<EnAttente<RuptureDuRecap>> };
  lien: string | null;
  signature?: string | null;
}): { subject: string; body: string } | null {
  const langue = contexte.langue ?? 'fr';
  const mots = MOTS[langue];
  const depuis = (jours: number) => mots.depuis(Math.max(1, jours));
  const nouvelles = [
    ...contexte.nouvelles.demandes.map((demande) => ligneDemande(demande, langue)),
    ...contexte.nouvelles.ruptures.map((rupture) => ligneRupture(rupture, langue)),
  ];
  const enAttente = [
    ...contexte.enAttente.demandes.map((demande) => ligneDemande(demande, langue) + depuis(demande.jours)),
    ...contexte.enAttente.ruptures.map((rupture) => ligneRupture(rupture, langue) + depuis(rupture.jours)),
  ];
  // Rien à dire : pas de mail. Un récapitulatif vide apprend à ne plus l'ouvrir.
  const n = nouvelles.length + enAttente.length;
  if (n === 0) return null;

  return {
    subject: mots.recapSujet(n),
    body: [
      mots.bonjour,
      '',
      mots.recapIntro,
      ...(nouvelles.length ? ['', mots.nouvelles, ...nouvelles] : []),
      ...(enAttente.length ? ['', mots.enAttente, ...enAttente] : []),
      '',
      contexte.lien ?? mots.lienHabituel,
      '',
      contexte.signature?.trim() || contexte.merchantName,
    ].join('\n'),
  };
}
