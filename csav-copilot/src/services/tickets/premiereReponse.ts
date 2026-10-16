import type { GroupeMessages } from './resolution.ts';

/**
 * Le délai de première réponse, et les brouillons qui ont servi.
 *
 * Les deux ne se lisaient que dans `draft.sentAt`, qui n'est daté que quand
 * le brouillon part depuis l'outil. Une équipe qui répond depuis Gmail — en
 * partant du brouillon préparé ou non — n'y laissait aucune trace : l'écran
 * affichait « — » pour la première réponse et « 0 sur 275 » brouillons
 * envoyés, alors que les réponses partaient tous les jours.
 *
 * Elles sont pourtant dans la base : la relecture du fil Gmail enregistre
 * chaque message parti de la boîte comme une réponse (`OUTBOUND`). Le délai
 * se mesure donc du premier message du client à la première réponse qui le
 * suit, d'où qu'elle soit partie ; un fil ouvert par la boutique elle-même
 * n'a pas de délai d'attente et n'est pas mesuré.
 *
 * Un brouillon compte comme envoyé s'il est parti de l'outil, ou si une
 * réponse est partie du fil après qu'il a été rédigé : c'est le signe qu'on
 * s'en est servi. Approximation assumée — une réponse écrite de zéro après
 * un brouillon ignoré compterait aussi — et dite dans l'infobulle.
 */
export function premieresReponses(
  premiersEntrants: GroupeMessages[],
  premiersSortants: GroupeMessages[],
  brouillons: Array<{ ticketId: string; sentAt: Date | null; ticketCreatedAt: Date }>,
): number[] {
  const entree = new Map(premiersEntrants.map((g) => [g.ticketId, g._min?.receivedAt ?? null]));
  const delais = new Map<string, number>();

  for (const sortant of premiersSortants) {
    const debut = entree.get(sortant.ticketId);
    const fin = sortant._min?.receivedAt;
    if (!debut || !fin || fin <= debut) continue;
    delais.set(sortant.ticketId, (fin.getTime() - debut.getTime()) / 60000);
  }

  // Un brouillon envoyé depuis l'outil avant la synchronisation du fil.
  for (const brouillon of brouillons) {
    if (!brouillon.sentAt) continue;
    const debut = entree.get(brouillon.ticketId) ?? brouillon.ticketCreatedAt;
    const minutes = (brouillon.sentAt.getTime() - debut.getTime()) / 60000;
    if (minutes < 0) continue;
    const connu = delais.get(brouillon.ticketId);
    if (connu === undefined || minutes < connu) delais.set(brouillon.ticketId, minutes);
  }

  return [...delais.values()].sort((a, b) => a - b);
}

export function brouillonsEnvoyes(
  brouillons: Array<{ ticketId: string; sentAt: Date | null; createdAt: Date }>,
  derniersSortants: GroupeMessages[],
): number {
  const derniere = new Map(derniersSortants.map((g) => [g.ticketId, g._max?.receivedAt ?? null]));
  return brouillons.filter((brouillon) => {
    if (brouillon.sentAt) return true;
    const sortie = derniere.get(brouillon.ticketId);
    return Boolean(sortie && sortie > brouillon.createdAt);
  }).length;
}
