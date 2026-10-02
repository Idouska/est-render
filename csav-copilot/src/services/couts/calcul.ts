/**
 * Ce que coûte le SAV, mois par mois.
 *
 * Trois postes, ceux que le marchand suit :
 *  - RETOURS : le bon fourni au client, puis ce que l'agence facture pour
 *    chaque paire reçue ;
 *  - RENVOIS ET ÉCHANGES : chaque colis parti vers un client — paire du stock
 *    confiée à une commande, paire d'échange — et, quand l'échange vient de
 *    l'atelier, le prix de la paire neuve ;
 *  - PAIRES PERDUES : le prix d'achat de chaque paire déclarée inutilisable.
 * En face, l'économie : chaque paire de retour réemployée est une paire que
 * l'atelier n'a pas eu à fournir.
 *
 * Les remboursements et le temps de l'équipe n'y sont pas, par choix.
 *
 * Une dépense appartient au mois du geste, en heure de Paris : le bon le jour
 * où il est fourni, la réception le jour où la paire arrive. Les colis se
 * comptent une fois : les paires d'une même commande voyagent ensemble, sous
 * un même numéro de suivi.
 *
 * Seules les paires de RETOUR comptent — une paire ajoutée au stock à la main
 * n'est pas une dépense du SAV. Ce tri-là se fait à la lecture en base.
 *
 * Les montants sont en centimes : additionner des euros en virgule flottante
 * finit par afficher 0,30000000000000004.
 *
 * Sans base ni réseau : se teste seul.
 */

import { moisCourant } from '../suppliers/releve.ts';

/* ------------------------------------------------------ coûts unitaires -- */

export const CLES_COUTS = ['bonRetour', 'fraisAgence', 'colisAgence', 'colisAtelier', 'prixPaire'] as const;
export type CleCout = (typeof CLES_COUTS)[number];
/** En euros, tels que le marchand les saisit. */
export type CoutsUnitaires = Record<CleCout, number>;

export const COUT_MAX = 10_000;

/** Ce que la base a gardé : une clé absente ou abîmée vaut zéro, jamais une erreur. */
export function lireCoutsUnitaires(brut: unknown): CoutsUnitaires {
  const objet = brut && typeof brut === 'object' && !Array.isArray(brut) ? (brut as Record<string, unknown>) : {};
  const couts = {} as CoutsUnitaires;
  for (const cle of CLES_COUTS) {
    const valeur = Number(objet[cle]);
    couts[cle] = Number.isFinite(valeur) && valeur >= 0 && valeur <= COUT_MAX ? Math.round(valeur * 100) / 100 : 0;
  }
  return couts;
}

/** Tant que rien n'est saisi, l'écran compte les gestes et demande les prix. */
export const coutsRenseignes = (couts: CoutsUnitaires): boolean => CLES_COUTS.some((cle) => couts[cle] > 0);

/* ----------------------------------------------------------------- mois -- */

/** Le mois d'un instant, à Paris : « AAAA-MM ». */
export const moisDe = (date: Date): string => moisCourant(date);

/** Les `combien` mois qui finissent par `mois`, du plus ancien au plus récent. */
export function moisJusqua(mois: string, combien: number): string[] {
  const [annee, numero] = mois.split('-').map(Number) as [number, number];
  const rang = annee * 12 + (numero - 1);
  return Array.from({ length: combien }, (_, i) => {
    const r = rang - (combien - 1 - i);
    return `${Math.floor(r / 12)}-${String((r % 12) + 1).padStart(2, '0')}`;
  });
}

/* --------------------------------------------------------------- gestes -- */

/** Un dossier de retour, réduit à ce qui coûte. */
export interface LigneCout {
  id: string;
  shopifyOrderId: string | null;
  orderName: string | null;
  productTitle: string;
  reason: string;
  agencyId: string | null;
  createdAt: Date;
  labelSentAt: Date | null;
  receivedAt: Date | null;
  unusableAt: Date | null;
  reusedAt: Date | null;
  exchangeShippedAt: Date | null;
  exchangeSupplierId: string | null;
  exchangeTrackingNumber: string | null;
  reshippedAt: Date | null;
  reshipTrackingNumber: string | null;
  reusedShopifyOrderId: string | null;
  reusedOrderName: string | null;
}

export interface Volumes {
  /** Demandes de retour ouvertes. */
  retours: number;
  /** Bons de retour fournis — un par colis, donc un par commande. */
  bons: number;
  /** Paires reçues par une agence : c'est elles qu'elle facture. */
  recues: number;
  /** Paires d'échange neuves, envoyées par l'atelier. */
  echangesAtelier: number;
  /** Paires d'échange prises dans le stock, envoyées par leur agence. */
  echangesStock: number;
  /** Paires du stock parties sur une commande. */
  renvois: number;
  /** Colis expédiés par une agence : échanges du stock et renvois. */
  colisAgence: number;
  /** Colis d'échange expédiés par l'atelier. */
  colisAtelier: number;
  /** Paires déclarées inutilisables. */
  perdues: number;
  /** Paires de retour réemployées, pour une commande ou un échange. */
  reemployees: number;
}

const volumesVides = (): Volumes => ({
  retours: 0,
  bons: 0,
  recues: 0,
  echangesAtelier: 0,
  echangesStock: 0,
  renvois: 0,
  colisAgence: 0,
  colisAtelier: 0,
  perdues: 0,
  reemployees: 0,
});

export interface Modele {
  titre: string;
  retours: number;
  /** Le motif le plus fréquent pour ce modèle. */
  motif: string;
}

export interface Mois {
  mois: string;
  volumes: Volumes;
  /** Retours ouverts dans le mois, par motif. */
  motifs: Record<string, number>;
  /** Les modèles les plus retournés du mois. */
  modeles: Modele[];
}

/** Chaque geste dans le mois où il a eu lieu ; les colis comptés une fois. */
export function gestesParMois(lignes: readonly LigneCout[], mois: readonly string[], modelesMax = 5): Mois[] {
  const tables = new Map(
    mois.map((m) => [
      m,
      {
        volumes: volumesVides(),
        motifs: {} as Record<string, number>,
        modeles: new Map<string, Record<string, number>>(),
        bons: new Set<string>(),
        colisAgence: new Set<string>(),
        colisAtelier: new Set<string>(),
      },
    ]),
  );
  const dans = (date: Date | null) => (date ? tables.get(moisDe(date)) : undefined);

  for (const ligne of lignes) {
    const ouvert = dans(ligne.createdAt);
    if (ouvert) {
      ouvert.volumes.retours += 1;
      ouvert.motifs[ligne.reason] = (ouvert.motifs[ligne.reason] ?? 0) + 1;
      const parMotif = ouvert.modeles.get(ligne.productTitle) ?? {};
      parMotif[ligne.reason] = (parMotif[ligne.reason] ?? 0) + 1;
      ouvert.modeles.set(ligne.productTitle, parMotif);
    }

    // Deux paires d'une même commande reviennent dans un seul colis, sous un seul bon.
    dans(ligne.labelSentAt)?.bons.add(ligne.shopifyOrderId ?? ligne.orderName ?? ligne.id);

    // Reçue chez le marchand lui-même : aucune agence ne facture.
    const recue = dans(ligne.receivedAt);
    if (recue && ligne.agencyId) recue.volumes.recues += 1;

    const echange = dans(ligne.exchangeShippedAt);
    if (echange) {
      const colis = `e:${ligne.exchangeTrackingNumber ?? ligne.id}`;
      if (ligne.exchangeSupplierId) {
        echange.volumes.echangesAtelier += 1;
        echange.colisAtelier.add(colis);
      } else {
        echange.volumes.echangesStock += 1;
        echange.colisAgence.add(colis);
      }
    }

    const renvoi = dans(ligne.reshippedAt);
    if (renvoi) {
      renvoi.volumes.renvois += 1;
      renvoi.colisAgence.add(
        `r:${ligne.reshipTrackingNumber ?? ligne.reusedShopifyOrderId ?? ligne.reusedOrderName ?? ligne.id}`,
      );
    }

    const perdue = dans(ligne.unusableAt);
    if (perdue) perdue.volumes.perdues += 1;

    const reemploi = dans(ligne.reusedAt);
    if (reemploi) reemploi.volumes.reemployees += 1;
  }

  return mois.map((m) => {
    const table = tables.get(m)!;
    table.volumes.bons = table.bons.size;
    table.volumes.colisAgence = table.colisAgence.size;
    table.volumes.colisAtelier = table.colisAtelier.size;
    const modeles = [...table.modeles.entries()]
      .map(([titre, parMotif]) => ({
        titre,
        retours: Object.values(parMotif).reduce((somme, n) => somme + n, 0),
        motif: Object.entries(parMotif).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]![0],
      }))
      .sort((a, b) => b.retours - a.retours || a.titre.localeCompare(b.titre, 'fr'))
      .slice(0, modelesMax);
    return { mois: m, volumes: table.volumes, motifs: table.motifs, modeles };
  });
}

/* ------------------------------------------------------------- montants -- */

/** En centimes. */
export interface Montants {
  retours: number;
  renvois: number;
  perdues: number;
  total: number;
  economie: number;
  /** Le total moins l'économie : négatif, le réemploi rapporte plus que le SAV ne coûte. */
  net: number;
}

const centimes = (euros: number) => Math.round(euros * 100);

export function montants(volumes: Volumes, couts: CoutsUnitaires): Montants {
  const retours = volumes.bons * centimes(couts.bonRetour) + volumes.recues * centimes(couts.fraisAgence);
  const renvois =
    volumes.colisAgence * centimes(couts.colisAgence) +
    volumes.colisAtelier * centimes(couts.colisAtelier) +
    volumes.echangesAtelier * centimes(couts.prixPaire);
  const perdues = volumes.perdues * centimes(couts.prixPaire);
  const total = retours + renvois + perdues;
  const economie = volumes.reemployees * centimes(couts.prixPaire);
  return { retours, renvois, perdues, total, economie, net: total - economie };
}
