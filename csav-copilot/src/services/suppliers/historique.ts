/**
 * L'historique d'une commande, vu de l'atelier : une seule chronologie.
 *
 * Pour savoir où en était une commande, l'atelier ouvrait trois onglets — le
 * lot pour savoir quand il l'avait reçue, Tickets pour les demandes, Suivi
 * pour ses colis — et recollait les morceaux. Ici, tout est à la suite, le
 * plus ancien d'abord : c'est l'ordre dans lequel les choses sont arrivées.
 *
 * Sans base ni réseau : se teste seul. Le texte se compose à l'écran, dans la
 * langue de l'atelier ; on ne renvoie que des faits.
 */

export type EvenementHistorique =
  | { type: 'LOT'; date: Date }
  | {
      type: 'DEMANDE';
      date: Date;
      kind: string;
      beforeValue: string | null;
      afterValue: string | null;
      message: string;
    }
  | { type: 'REPONSE'; date: Date; kind: string; accepte: boolean; note: string | null }
  | { type: 'REMPLACEMENT'; date: Date; combien: number }
  | { type: 'REMPLACEMENT_REPONSE'; date: Date; modele: string; accepte: boolean }
  | { type: 'SIGNALEMENT'; date: Date; sujet: string | null }
  | { type: 'COLIS'; date: Date; numero: string; index: number; total: number; transporteur: string | null };

export function chronologie(sources: {
  lots: ReadonlyArray<{ envoyeLe: Date | null }>;
  demandes: ReadonlyArray<{
    kind: string;
    beforeValue: string | null;
    afterValue: string | null;
    message: string;
    status: string;
    supplierNote: string | null;
    createdAt: Date;
    acknowledgedAt: Date | null;
  }>;
  remplacements: ReadonlyArray<{
    productTitle: string;
    variantTitle: string | null;
    accepte: boolean | null;
    createdAt: Date;
    reponduLe: Date | null;
  }>;
  signalements: ReadonlyArray<{ subject: string | null; createdAt: Date }>;
  colis: ReadonlyArray<{
    trackingNumber: string;
    index: number;
    total: number;
    carrier: string | null;
    createdAt: Date;
  }>;
}): EvenementHistorique[] {
  const evenements: EvenementHistorique[] = [];

  for (const lot of sources.lots) {
    if (lot.envoyeLe) evenements.push({ type: 'LOT', date: lot.envoyeLe });
  }

  for (const demande of sources.demandes) {
    evenements.push({
      type: 'DEMANDE',
      date: demande.createdAt,
      kind: demande.kind,
      beforeValue: demande.beforeValue,
      afterValue: demande.afterValue,
      message: demande.message,
    });
    // Sa réponse, à sa date : « confirmé » ou « impossible », avec sa raison.
    if (demande.status !== 'PENDING' && demande.acknowledgedAt) {
      evenements.push({
        type: 'REPONSE',
        date: demande.acknowledgedAt,
        kind: demande.kind,
        accepte: demande.status === 'ACKNOWLEDGED',
        note: demande.supplierNote,
      });
    }
  }

  // Les modèles proposés le même jour forment une seule proposition.
  const proposes = new Map<string, number>();
  for (const remplacement of sources.remplacements) {
    const jour = remplacement.createdAt.toISOString().slice(0, 16);
    proposes.set(jour, (proposes.get(jour) ?? 0) + 1);
    if (remplacement.reponduLe && remplacement.accepte !== null) {
      evenements.push({
        type: 'REMPLACEMENT_REPONSE',
        date: remplacement.reponduLe,
        modele: [remplacement.productTitle, remplacement.variantTitle].filter(Boolean).join(' · '),
        accepte: remplacement.accepte,
      });
    }
  }
  for (const [minute, combien] of proposes) {
    evenements.push({ type: 'REMPLACEMENT', date: new Date(`${minute}:00.000Z`), combien });
  }

  for (const signalement of sources.signalements) {
    evenements.push({ type: 'SIGNALEMENT', date: signalement.createdAt, sujet: signalement.subject });
  }

  for (const colis of sources.colis) {
    evenements.push({
      type: 'COLIS',
      date: colis.createdAt,
      numero: colis.trackingNumber,
      index: colis.index,
      total: colis.total,
      transporteur: colis.carrier,
    });
  }

  return evenements.sort((a, b) => a.date.getTime() - b.date.getTime());
}
