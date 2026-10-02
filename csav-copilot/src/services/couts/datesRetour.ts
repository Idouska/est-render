/**
 * Les dates qui disent quand un retour coûte.
 *
 * Le bon se paie le jour où il est fourni, la réception le jour où la paire
 * arrive, la paire perdue le jour où on la déclare inutilisable. Une date
 * posée ne bouge plus : repasser « reçu » une deuxième fois ne refacture
 * rien. Un geste corrigé l'efface — bon décoché, statut ramené avant la
 * réception, paire remise en stock : la dépense n'a pas eu lieu.
 *
 * Sans base ni réseau : se teste seul.
 */

const RECUE: ReadonlySet<string> = new Set(['RECEIVED', 'RESTOCKED', 'UNUSABLE']);
const AVANT_RECEPTION: ReadonlySet<string> = new Set(['OPEN', 'LABEL_SENT', 'SHIPPED', 'IN_TRANSIT']);

export interface DatesRetour {
  labelSentAt: Date | null;
  receivedAt: Date | null;
  unusableAt: Date | null;
}

export function datesDuGeste(
  avant: DatesRetour,
  geste: { labelSent?: boolean; status?: string },
  maintenant: Date,
): Partial<DatesRetour> {
  const dates: Partial<DatesRetour> = {};

  if (geste.labelSent === true && !avant.labelSentAt) dates.labelSentAt = maintenant;
  if (geste.labelSent === false && avant.labelSentAt) dates.labelSentAt = null;

  // Cocher « bon fourni » ramène le dossier à LABEL_SENT (voir la route) :
  // les dates suivent le statut que le dossier aura vraiment.
  const statut = geste.status ?? (geste.labelSent === true ? 'LABEL_SENT' : undefined);
  if (!statut) return dates;

  if (RECUE.has(statut) && !avant.receivedAt) dates.receivedAt = maintenant;
  if (AVANT_RECEPTION.has(statut) && avant.receivedAt) dates.receivedAt = null;

  if (statut === 'UNUSABLE' && !avant.unusableAt) dates.unusableAt = maintenant;
  // « Clos » garde la perte : un dossier se termine aussi sur une paire perdue.
  if (statut !== 'UNUSABLE' && statut !== 'CLOSED' && avant.unusableAt) dates.unusableAt = null;

  return dates;
}
