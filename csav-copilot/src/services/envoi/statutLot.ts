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

const JOUR_MS = 86_400_000;

/** Jours entiers écoulés depuis l'envoi du lot. */
export function joursDepuis(envoyeLe: Date, maintenant: Date): number {
  return Math.max(0, Math.floor((maintenant.getTime() - envoyeLe.getTime()) / JOUR_MS));
}

/**
 * Une commande est en retard quand elle n'est pas expédiée au-delà du délai
 * laissé à l'atelier. « En production » ne suffit pas : le client attend sa
 * paire, pas l'annonce qu'on la fabrique.
 */
export function estEnRetard(commande: {
  statut: StatutLot;
  envoyeLe: Date;
  delaiJours: number;
  maintenant: Date;
}): boolean {
  return (
    commande.statut !== 'EXPEDIEE' &&
    commande.maintenant.getTime() - commande.envoyeLe.getTime() > commande.delaiJours * JOUR_MS
  );
}
