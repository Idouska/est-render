/**
 * Ce qui part tout de suite, et ce qui attend le récapitulatif du matin.
 *
 * Un mail par demande, c'était dix mails par jour chez l'atelier — et au
 * dixième, il ne les lit plus, urgents compris. Seules partent sur-le-champ
 * les demandes qui changent le colis avant qu'il parte : celles-là ne peuvent
 * pas attendre demain matin. Le reste — un point sur un colis, un article
 * manquant, une date — se lit très bien dans un seul mail, à son heure.
 *
 * Sans base ni réseau : se teste seul, et le tableau de bord en garde une
 * copie que les tests comparent. Les titres des motifs, dans chaque langue,
 * sont dans `langueAtelier.ts`.
 */

export const KINDS_URGENTS: ReadonlySet<string> = new Set([
  'HOLD',
  'CANCEL',
  'ADDRESS',
  'PHONE',
  'SIZE',
  'COLOR',
  'PRODUCT',
]);

/** Les autres : ils attendent le récapitulatif du matin. */
export const KINDS_DU_RECAP = ['MISSING_ITEM', 'DELAY', 'TRACKING', 'OTHER'] as const;

export const estUrgente = (kind: string): boolean => KINDS_URGENTS.has(kind);

/**
 * Au-delà, une urgence sans réponse est signalée au marchand : le colis
 * risque de partir, et c'est le moment de décrocher le téléphone.
 */
export const DELAI_URGENCE_H = 4;
