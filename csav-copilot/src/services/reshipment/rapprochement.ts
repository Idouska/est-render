/**
 * Le rapprochement : commandes en attente × paires du stock retours.
 *
 * Une paire retournée, contrôlée et remise en stock chez une agence (FR, ES,
 * IT, BE) peut partir chez le prochain client qui commande le même article :
 * livré en deux ou trois jours au lieu de quinze, sans rien fabriquer. Ce
 * module décide QUELLE paire va à QUELLE commande — sans base ni réseau, pour
 * être éprouvé seul.
 *
 * Quatre règles, dans cet ordre :
 *
 * 1. Une commande est servie EN ENTIER par UNE agence, ou pas du tout. Deux
 *    paires d'une même commande qui partiraient de deux agences feraient deux
 *    colis ; une commande à moitié servie laisserait l'autre moitié à
 *    l'atelier, qui ne saurait plus quoi expédier.
 * 2. Même pays d'abord. Un pays voisin n'est proposé qu'ensuite, pour les
 *    commandes que rien n'a servies dans leur propre pays — sinon une paire
 *    belge partirait en France alors qu'un client belge l'attendait.
 * 3. Une paire ne va qu'à une commande, et chaque exemplaire commandé compte :
 *    deux paires commandées demandent deux paires en stock.
 * 4. Les paires les plus anciennes partent en premier, et les commandes qui
 *    attendent depuis le plus longtemps sont servies d'abord.
 */

/** Pays où des agences réceptionnent les retours. */
export const PAYS_RETOUR = ['FR', 'ES', 'IT', 'BE'] as const;

/**
 * Pays voisins : ceux qui partagent une frontière. La France touche les trois
 * autres ; l'Espagne et l'Italie, la Belgique et l'Espagne ne se touchent pas.
 */
export const VOISINS: Readonly<Record<string, readonly string[]>> = {
  FR: ['BE', 'ES', 'IT'],
  BE: ['FR'],
  ES: ['FR'],
  IT: ['FR'],
};

/** Une paire du stock retours, là où elle se trouve. */
export interface PaireEnStock {
  id: string;
  /** Pays où la paire est stockée : celui de son agence. */
  pays: string | null;
  agenceId: string | null;
  agenceNom: string | null;
  sku: string | null;
  titre: string;
  declinaison: string | null;
  /** Entrée au stock : les plus anciennes partent en premier. */
  depuis: Date;
  /** Commande d'origine du retour. */
  retourDe: string | null;
}

export interface LigneEnAttente {
  titre: string;
  declinaison: string | null;
  sku: string | null;
  quantite: number;
}

/** Une commande que l'atelier n'a pas commencée, et que le stock pourrait servir. */
export interface CommandeEnAttente {
  id: string;
  nom: string;
  client: string | null;
  pays: string | null;
  /** AAAA-MM-JJ… : les plus anciennes sont servies d'abord. */
  creeLe: string;
  lignes: LigneEnAttente[];
}

export interface Proposition {
  commandeId: string;
  commande: string;
  client: string | null;
  pays: string;
  /** Pays où se trouvent les paires. */
  paysStock: string;
  /** Vrai quand les paires partent d'un pays voisin. */
  voisin: boolean;
  agence: { id: string; nom: string | null } | null;
  paires: Array<{ returnId: string; titre: string; declinaison: string | null; sku: string | null; retourDe: string | null }>;
}

/** Un texte comparé sans casse, sans accent, sans ponctuation. */
function normaliser(texte: string | null | undefined): string {
  return (texte ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Une paire convient-elle à une ligne de commande ?
 *
 * Par référence quand les deux en ont une — c'est la seule identité sûre.
 * Sinon par modèle et déclinaison, comparés sans casse ni ponctuation : « Nike
 * Mind 001 · 45 » et « nike mind 001 / 45 » sont la même paire.
 */
export function correspond(paire: PaireEnStock, ligne: LigneEnAttente): boolean {
  const skuPaire = normaliser(paire.sku);
  const skuLigne = normaliser(ligne.sku);
  if (skuPaire && skuLigne) return skuPaire === skuLigne;
  return normaliser(paire.titre) === normaliser(ligne.titre) && normaliser(paire.declinaison) === normaliser(ligne.declinaison);
}

/** Le lieu d'une paire : son agence, ou à défaut son pays. */
const lieuDe = (paire: PaireEnStock) => paire.agenceId ?? `pays:${paire.pays ?? '?'}`;

/**
 * Les paires d'UN lieu qui couvrent TOUTE la commande, ou `null`.
 *
 * Pour chaque exemplaire commandé, la paire la plus ancienne qui convient et
 * n'est pas déjà prise — ni par une autre commande, ni par un autre
 * exemplaire de celle-ci.
 */
function couvrir(commande: CommandeEnAttente, paires: readonly PaireEnStock[], prises: ReadonlySet<string>): PaireEnStock[] | null {
  const choisies: PaireEnStock[] = [];
  const retenues = new Set<string>();

  for (const ligne of commande.lignes) {
    for (let n = 0; n < Math.max(1, ligne.quantite); n += 1) {
      const paire = paires.find((candidate) => !prises.has(candidate.id) && !retenues.has(candidate.id) && correspond(candidate, ligne));
      if (!paire) return null;
      retenues.add(paire.id);
      choisies.push(paire);
    }
  }
  return choisies;
}

export function rapprocher(stock: readonly PaireEnStock[], commandes: readonly CommandeEnAttente[]): Proposition[] {
  // Les plus anciennes d'abord, des deux côtés.
  const paires = [...stock].sort((a, b) => a.depuis.getTime() - b.depuis.getTime());
  const enAttente = [...commandes]
    .filter((commande) => commande.pays && commande.lignes.length > 0)
    .sort((a, b) => a.creeLe.localeCompare(b.creeLe));

  const prises = new Set<string>();
  const servies = new Set<string>();
  const propositions: Proposition[] = [];

  // Deux passes : tout le même-pays d'abord, les voisins ensuite.
  for (const passe of ['meme', 'voisin'] as const) {
    for (const commande of enAttente) {
      if (servies.has(commande.id)) continue;
      const pays = commande.pays!;
      const paysCandidats = passe === 'meme' ? [pays] : (VOISINS[pays] ?? []);

      // Les lieux candidats, dans l'ordre de leur paire la plus ancienne.
      const lieux = new Map<string, PaireEnStock[]>();
      for (const paire of paires) {
        if (prises.has(paire.id) || !paire.pays || !paysCandidats.includes(paire.pays)) continue;
        const cle = lieuDe(paire);
        lieux.set(cle, [...(lieux.get(cle) ?? []), paire]);
      }

      for (const pairesDuLieu of lieux.values()) {
        const choisies = couvrir(commande, pairesDuLieu, prises);
        if (!choisies) continue;

        for (const paire of choisies) prises.add(paire.id);
        servies.add(commande.id);
        const premiere = choisies[0]!;
        propositions.push({
          commandeId: commande.id,
          commande: commande.nom,
          client: commande.client,
          pays,
          paysStock: premiere.pays!,
          voisin: premiere.pays !== pays,
          agence: premiere.agenceId ? { id: premiere.agenceId, nom: premiere.agenceNom } : null,
          paires: choisies.map((paire) => ({
            returnId: paire.id,
            titre: paire.titre,
            declinaison: paire.declinaison,
            sku: paire.sku,
            retourDe: paire.retourDe,
          })),
        });
        break;
      }
    }
  }

  return propositions;
}
