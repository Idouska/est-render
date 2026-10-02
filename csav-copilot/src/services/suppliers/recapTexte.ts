import { TITRES_DEMANDE } from './urgence.ts';

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

function detail(demande: DemandeDuRecap): string | null {
  if (demande.kind === 'MISSING_ITEM' || demande.kind === 'TRACKING') return demande.beforeValue;
  if (demande.kind === 'DELAY') return demande.afterValue ? `au plus tard le ${demande.afterValue}` : null;
  return demande.afterValue ? `${demande.beforeValue ?? '?'} → ${demande.afterValue}` : null;
}

function message(texte: string): string | null {
  const uneLigne = texte.replace(/\s+/g, ' ').trim();
  if (!uneLigne) return null;
  return uneLigne.length > MESSAGE_MAX ? `${uneLigne.slice(0, MESSAGE_MAX - 1)}…` : uneLigne;
}

export function ligneDemande(demande: DemandeDuRecap): string {
  const titre = TITRES_DEMANDE[demande.kind] ?? 'Demande';
  const precision = detail(demande);
  const mot = message(demande.message);
  return [
    `- ${demande.orderName ?? 'Sans commande'} — ${titre}${precision ? ` : ${precision}` : ''}`,
    mot ? ` — « ${mot} »` : '',
  ].join('');
}

export function ligneRupture(rupture: RuptureDuRecap): string {
  const modeles = rupture.combien > 1 ? `${rupture.combien} modèles de remplacement` : 'un modèle de remplacement';
  return `- ${rupture.orderName ?? 'Sans commande'} — Rupture : ${modeles} à valider`;
}

const depuis = (jours: number) => ` (depuis ${Math.max(1, jours)} j)`;

export function recapDuJour(contexte: {
  merchantName: string;
  nouvelles: { demandes: readonly DemandeDuRecap[]; ruptures: readonly RuptureDuRecap[] };
  enAttente: { demandes: ReadonlyArray<EnAttente<DemandeDuRecap>>; ruptures: ReadonlyArray<EnAttente<RuptureDuRecap>> };
  lien: string | null;
  signature?: string | null;
}): { subject: string; body: string } | null {
  const nouvelles = [
    ...contexte.nouvelles.demandes.map(ligneDemande),
    ...contexte.nouvelles.ruptures.map(ligneRupture),
  ];
  const enAttente = [
    ...contexte.enAttente.demandes.map((demande) => ligneDemande(demande) + depuis(demande.jours)),
    ...contexte.enAttente.ruptures.map((rupture) => ligneRupture(rupture) + depuis(rupture.jours)),
  ];
  // Rien à dire : pas de mail. Un récapitulatif vide apprend à ne plus l'ouvrir.
  const n = nouvelles.length + enAttente.length;
  if (n === 0) return null;

  return {
    subject: `Récapitulatif du jour — ${n} demande${n > 1 ? 's' : ''} à traiter`,
    body: [
      'Bonjour,',
      '',
      'Voici ce qui attend votre réponse. Tout se répond d’un bouton dans votre atelier, rubrique « Tickets ».',
      ...(nouvelles.length ? ['', 'Nouvelles demandes :', ...nouvelles] : []),
      ...(enAttente.length ? ['', 'Toujours sans réponse :', ...enAttente] : []),
      '',
      contexte.lien ?? 'Ouvrez votre atelier avec le lien habituel.',
      '',
      contexte.signature?.trim() || contexte.merchantName,
    ].join('\n'),
  };
}
