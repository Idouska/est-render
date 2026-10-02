import { enTete } from './demande.ts';
import { MOTS } from './langueAtelier.ts';
import { DELAI_URGENCE_H } from './urgence.ts';

/**
 * Le mail au marchand : ses urgences restées sans réponse. Sans base ni
 * réseau : se teste seul.
 *
 * Il dit qui appeler, et avec quel numéro : c'est le seul geste qui reste
 * quand l'atelier ne répond pas et que le colis peut partir.
 */

export interface UrgenceSansReponse {
  kind: string;
  orderName: string | null;
  beforeValue: string | null;
  afterValue: string | null;
  heures: number;
  atelier: { name: string; phone: string | null };
}

export function ligneUrgence(urgence: UrgenceSansReponse): string {
  const titre = MOTS.fr.titres[urgence.kind] ?? 'Demande';
  const changement = enTete(urgence.kind, urgence.beforeValue, urgence.afterValue);
  const joindre = urgence.atelier.phone ? `${urgence.atelier.name}, ${urgence.atelier.phone}` : urgence.atelier.name;
  return `- ${urgence.orderName ?? 'Sans commande'} — ${titre}${changement ? ` (${changement})` : ''} · ${joindre} · depuis ${urgence.heures} h`;
}

export function mailUrgencesSansReponse(contexte: {
  urgences: readonly UrgenceSansReponse[];
  lien: string;
}): { subject: string; body: string } {
  const n = contexte.urgences.length;
  return {
    subject:
      n > 1
        ? `${n} demandes urgentes sans réponse de l’atelier`
        : `Urgent sans réponse — ${contexte.urgences[0]!.orderName ?? 'demande'} : ${MOTS.fr.titres[contexte.urgences[0]!.kind] ?? 'demande'}`,
    body: [
      `${n > 1 ? 'Ces demandes urgentes n’ont' : 'Cette demande urgente n’a'} pas de réponse de l’atelier depuis plus de ${DELAI_URGENCE_H} heures. Le colis peut partir tel quel : appelez l’atelier.`,
      '',
      ...contexte.urgences.map(ligneUrgence),
      '',
      contexte.lien,
    ].join('\n'),
  };
}
