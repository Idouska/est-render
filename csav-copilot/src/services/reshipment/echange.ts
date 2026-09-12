import { VOISINS, correspond, type PaireEnStock } from './rapprochement.ts';

/**
 * Qui envoie la paire d'échange.
 *
 * Le client renvoie une paire et en veut une autre — même modèle en autre
 * taille, autre couleur, ou les deux. Deux sources possibles, dans cet ordre :
 *
 * 1. Le STOCK RETOURS, si une paire identique dort déjà dans une agence : elle
 *    part en deux ou trois jours, et ne coûte rien à fabriquer. Même pays
 *    d'abord, puis pays voisin — les mêmes règles que pour les commandes.
 * 2. L'ATELIER du modèle sinon, désigné par le préfixe de référence qu'il
 *    revendique, ou l'atelier par défaut.
 *
 * Sans base ni réseau : la décision se relit et s'éprouve seule.
 */

export interface DemandeEchange {
  /** Pays du client : c'est là qu'il faut livrer. */
  pays: string | null;
  titre: string;
  declinaison: string | null;
  sku: string | null;
}

export interface AtelierCandidat {
  id: string;
  nom: string;
  skuPrefixes: string[];
  isDefault: boolean;
}

export type SourceEchange =
  | { source: 'STOCK'; paire: PaireEnStock }
  | { source: 'ATELIER'; atelier: AtelierCandidat }
  | { source: 'AUCUNE' };

const normaliser = (texte: string | null | undefined) => (texte ?? '').trim().toUpperCase();

/**
 * L'atelier qui prépare ce modèle.
 *
 * Par le préfixe de référence, comme la répartition des commandes. À défaut,
 * l'atelier par défaut : c'est lui qui prend ce que personne ne réclame.
 */
export function atelierPour(sku: string | null, ateliers: readonly AtelierCandidat[]): AtelierCandidat | null {
  const reference = normaliser(sku);

  if (reference) {
    const revendique = ateliers.find((atelier) =>
      atelier.skuPrefixes.map(normaliser).filter(Boolean).some((prefixe) => reference.startsWith(prefixe)),
    );
    if (revendique) return revendique;
  }

  return ateliers.find((atelier) => atelier.isDefault) ?? null;
}

export function choisirSource(
  demande: DemandeEchange,
  stock: readonly PaireEnStock[],
  ateliers: readonly AtelierCandidat[],
): SourceEchange {
  const ligne = { titre: demande.titre, declinaison: demande.declinaison, sku: demande.sku, quantite: 1 };
  const voisins = demande.pays ? (VOISINS[demande.pays] ?? []) : [];

  // Les paires qui conviennent, les plus anciennes d'abord : le stock ne doit
  // pas vieillir pendant qu'on pioche dedans.
  const candidates = [...stock]
    .filter((paire) => correspond(paire, ligne))
    .sort((a, b) => a.depuis.getTime() - b.depuis.getTime());

  // Le pays décide, et lui seul : même pays, puis pays voisin. Une paire dont
  // on ignore le pays n'est donc jamais promise — elle n'est ni ici ni à
  // côté, et personne ne saurait d'où la faire partir.
  const surPlace = demande.pays ? candidates.find((paire) => paire.pays === demande.pays) : undefined;
  const chezLeVoisin = candidates.find((paire) => paire.pays !== null && voisins.includes(paire.pays));
  const paire = surPlace ?? chezLeVoisin;
  if (paire) return { source: 'STOCK', paire };

  const atelier = atelierPour(demande.sku, ateliers);
  return atelier ? { source: 'ATELIER', atelier } : { source: 'AUCUNE' };
}
