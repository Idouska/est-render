import { changementDemande } from './langueAtelier.ts';

/**
 * La première ligne du mail : la demande elle-même, lisible sur un écran
 * verrouillé. « 44 → 45 » pour un changement ; un article manquant n'a pas de
 * « à la place », et un retard n'a qu'une date. En français : c'est la
 * version que lit le marchand.
 */
export function enTete(
  kind: string,
  beforeValue: string | null | undefined,
  afterValue: string | null | undefined,
): string | null {
  return changementDemande(kind, beforeValue, afterValue, 'fr');
}
