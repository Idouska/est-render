/**
 * La première ligne du mail : la demande elle-même, lisible sur un écran
 * verrouillé. « 44 → 45 » pour un changement ; un article manquant n'a pas de
 * « à la place », et un retard n'a qu'une date.
 */
export function enTete(
  kind: string,
  beforeValue: string | null | undefined,
  afterValue: string | null | undefined,
): string | null {
  if (kind === 'MISSING_ITEM') return beforeValue ? `Article manquant : ${beforeValue}` : null;
  if (kind === 'DELAY') return afterValue ? `Expédition attendue au plus tard le ${afterValue}` : null;
  return afterValue ? `${beforeValue ?? '?'} → ${afterValue}` : null;
}
