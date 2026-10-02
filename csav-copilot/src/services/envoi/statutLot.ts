/**
 * L'état d'une commande d'un lot, et ses articles en une ligne. Sans base ni
 * réseau : se teste seul.
 */

export type StatutLot = 'A_PREPARER' | 'EN_PRODUCTION' | 'EXPEDIEE';

export function statutDeLaCommande(commande: { enProductionLe: Date | null; colis: number }): StatutLot {
  if (commande.colis > 0) return 'EXPEDIEE';
  return commande.enProductionLe ? 'EN_PRODUCTION' : 'A_PREPARER';
}

/** Les articles d'une commande en une ligne : « 2 × Nike Mind 001 · 45 ». */
export function resumeArticles(
  lignes: ReadonlyArray<{ titre: string; declinaison: string | null; quantite: number }>,
): string {
  return lignes
    .map(
      (ligne) =>
        `${ligne.quantite > 1 ? `${ligne.quantite} × ` : ''}${[ligne.titre, ligne.declinaison].filter(Boolean).join(' · ')}`,
    )
    .join(', ');
}
