/**
 * Le relevé mensuel d'un atelier : ce qu'on lui a envoyé, ce qu'il en a fait.
 *
 * L'atelier facture au mois. Pour vérifier sa facture, le marchand recomptait
 * à la main dans ses mails : combien de commandes parties chez lui, combien
 * expédiées, lesquelles annulées en route, remplacées, revenues. Le relevé
 * met tout sur une ligne par commande, avec les totaux en tête.
 *
 * Une commande appartient au mois où son lot est parti, en heure de Paris :
 * c'est la date que porte le fichier reçu par l'atelier.
 *
 * Sans base ni réseau : se teste seul.
 */

export type StatutReleve = 'EXPEDIEE' | 'NON_EXPEDIEE' | 'ANNULEE';

export interface LigneReleve {
  commande: string;
  articles: string | null;
  envoyeLe: Date;
  expedieeLe: Date | null;
  suivis: string[];
  statut: StatutReleve;
  remplacement: string | null;
  retour: string | null;
}

export interface Releve {
  mois: string;
  lignes: LigneReleve[];
  totaux: {
    envoyees: number;
    expediees: number;
    nonExpediees: number;
    annulees: number;
    remplacees: number;
    retours: number;
  };
}

const FUSEAU = 'Europe/Paris';

/** Décalage de Paris par rapport à UTC à cet instant, en minutes. */
function decalageParis(date: Date): number {
  const nom = new Intl.DateTimeFormat('en-US', { timeZone: FUSEAU, timeZoneName: 'shortOffset' })
    .formatToParts(date)
    .find((morceau) => morceau.type === 'timeZoneName')?.value;
  const [, signe, heures, minutes] = /GMT([+-])(\d+)(?::(\d+))?/.exec(nom ?? '') ?? [];
  if (!signe) return 0;
  return (signe === '-' ? -1 : 1) * (Number(heures) * 60 + Number(minutes ?? 0));
}

/** Le 1er du mois à minuit, heure de Paris, en instant UTC. */
function debutDuMois(annee: number, mois: number): Date {
  const approx = new Date(Date.UTC(annee, mois - 1, 1));
  return new Date(approx.getTime() - decalageParis(approx) * 60_000);
}

/** « 2026-09 » → ses bornes, début inclus, fin exclue. Refuse ce qui n'est pas un mois. */
export function bornesDuMois(mois: string): { debut: Date; fin: Date } | null {
  const trouve = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(mois);
  if (!trouve) return null;
  const annee = Number(trouve[1]);
  const numero = Number(trouve[2]);
  return {
    debut: debutDuMois(annee, numero),
    fin: numero === 12 ? debutDuMois(annee + 1, 1) : debutDuMois(annee, numero + 1),
  };
}

/** Le mois en cours à Paris, « AAAA-MM ». */
export function moisCourant(maintenant = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: FUSEAU, year: 'numeric', month: '2-digit' }).format(maintenant);
}

export const RAISONS_RETOUR: Record<string, string> = {
  SIZE: 'Taille',
  DEFECT: 'Défaut',
  MODEL: 'Ne plaît pas',
  OTHER: 'Autre',
};

export function composerReleve(params: {
  mois: string;
  commandes: ReadonlyArray<{ shopifyOrderId: string; orderName: string; articles: string | null; envoyeLe: Date }>;
  colis: ReadonlyArray<{ shopifyOrderId: string; trackingNumber: string; createdAt: Date }>;
  /** Commandes que le marchand a annulées auprès de l'atelier. */
  annulees: ReadonlySet<string>;
  /** Le remplacement accepté par l'atelier, par commande. */
  remplacements: ReadonlyMap<string, string>;
  /** La raison du retour client, par commande. */
  retours: ReadonlyMap<string, string>;
}): Releve {
  const colisDe = new Map<string, { trackingNumber: string; createdAt: Date }[]>();
  for (const colis of params.colis) {
    colisDe.set(colis.shopifyOrderId, [...(colisDe.get(colis.shopifyOrderId) ?? []), colis]);
  }

  const lignes = [...params.commandes]
    .sort((a, b) => a.envoyeLe.getTime() - b.envoyeLe.getTime() || a.orderName.localeCompare(b.orderName))
    .map((commande): LigneReleve => {
      const siens = (colisDe.get(commande.shopifyOrderId) ?? []).sort(
        (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
      );
      // Un colis l'emporte : annulée trop tard, elle est partie quand même,
      // et c'est ce que l'atelier facturera.
      const statut: StatutReleve = siens.length
        ? 'EXPEDIEE'
        : params.annulees.has(commande.shopifyOrderId)
          ? 'ANNULEE'
          : 'NON_EXPEDIEE';
      const raison = params.retours.get(commande.shopifyOrderId);
      return {
        commande: commande.orderName,
        articles: commande.articles,
        envoyeLe: commande.envoyeLe,
        expedieeLe: siens[0]?.createdAt ?? null,
        suivis: siens.map((colis) => colis.trackingNumber),
        statut,
        remplacement: params.remplacements.get(commande.shopifyOrderId) ?? null,
        retour: raison ? (RAISONS_RETOUR[raison] ?? raison) : null,
      };
    });

  return {
    mois: params.mois,
    lignes,
    totaux: {
      envoyees: lignes.length,
      expediees: lignes.filter((ligne) => ligne.statut === 'EXPEDIEE').length,
      nonExpediees: lignes.filter((ligne) => ligne.statut === 'NON_EXPEDIEE').length,
      annulees: lignes.filter((ligne) => ligne.statut === 'ANNULEE').length,
      remplacees: lignes.filter((ligne) => ligne.remplacement).length,
      retours: lignes.filter((ligne) => ligne.retour).length,
    },
  };
}
