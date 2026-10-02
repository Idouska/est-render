/**
 * La fiabilité d'un atelier, sur une période.
 *
 * Quatre chiffres, choisis parce qu'ils se vérifient dans nos propres
 * données — pas une note de satisfaction :
 *
 *   - le délai moyen de réponse aux demandes (changement, retard, colis…) ;
 *   - la part de refus parmi ces réponses ;
 *   - le délai moyen entre l'envoi d'un lot et le premier colis saisi ;
 *   - la part de commandes de lot expédiées hors délai, ou pas du tout.
 *
 * Chacun vient avec son volume : « 0 % de retard » sur une commande ne dit
 * pas la même chose que sur deux cents. Sans donnée, le chiffre est `null` —
 * jamais zéro, qui se lirait « parfait ».
 *
 * Sans base ni réseau : se teste seul.
 */

const HEURE_MS = 3_600_000;
const JOUR_MS = 86_400_000;

export interface DemandeMesuree {
  creeLe: Date;
  reponduLe: Date | null;
  statut: 'PENDING' | 'ACKNOWLEDGED' | 'REFUSED';
}

export interface CommandeMesuree {
  envoyeLe: Date;
  /** Premier colis saisi, ou `null` s'il n'y en a pas encore. */
  expedieeLe: Date | null;
}

export interface Fiabilite {
  demandes: number;
  reponseMoyenneH: number | null;
  refusPct: number | null;
  /** Commandes dont le délai est écoulé : les seules qu'on peut juger. */
  commandes: number;
  expeditionMoyenneJ: number | null;
  retardPct: number | null;
}

const moyenne = (valeurs: number[]) =>
  valeurs.length ? valeurs.reduce((total, valeur) => total + valeur, 0) / valeurs.length : null;

export function calculerFiabilite(params: {
  demandes: readonly DemandeMesuree[];
  commandes: readonly CommandeMesuree[];
  delaiJours: number;
  maintenant: Date;
}): Fiabilite {
  const repondues = params.demandes.filter(
    (demande): demande is DemandeMesuree & { reponduLe: Date } =>
      demande.statut !== 'PENDING' && demande.reponduLe !== null,
  );
  const reponse = moyenne(
    repondues.map((demande) => (demande.reponduLe.getTime() - demande.creeLe.getTime()) / HEURE_MS),
  );

  const expediees = params.commandes.filter(
    (commande): commande is CommandeMesuree & { expedieeLe: Date } => commande.expedieeLe !== null,
  );
  const expedition = moyenne(
    expediees.map((commande) => (commande.expedieeLe.getTime() - commande.envoyeLe.getTime()) / JOUR_MS),
  );

  // Une commande envoyée hier n'est pas encore « à l'heure » : on ne juge que
  // celles dont le délai est passé.
  const delaiMs = params.delaiJours * JOUR_MS;
  const jugeables = params.commandes.filter(
    (commande) => params.maintenant.getTime() - commande.envoyeLe.getTime() >= delaiMs,
  );
  const enRetard = jugeables.filter(
    (commande) =>
      commande.expedieeLe === null || commande.expedieeLe.getTime() - commande.envoyeLe.getTime() > delaiMs,
  );

  return {
    demandes: params.demandes.length,
    reponseMoyenneH: reponse === null ? null : Math.round(reponse),
    refusPct: repondues.length
      ? Math.round((repondues.filter((demande) => demande.statut === 'REFUSED').length / repondues.length) * 100)
      : null,
    commandes: jugeables.length,
    expeditionMoyenneJ: expedition === null ? null : Math.round(expedition * 10) / 10,
    retardPct: jugeables.length ? Math.round((enRetard.length / jugeables.length) * 100) : null,
  };
}

/**
 * La qualité d'un atelier, sur les commandes de ses lots.
 *
 * Mesurée sur 90 jours, pas 30 : un retour arrive deux ou trois semaines
 * après l'expédition, et un mois ne verrait que les plus rapides. Trois
 * parts, rapportées aux mêmes commandes :
 *
 *   - les retours clients, toutes raisons ;
 *   - ceux pour défaut — la part qui lui revient vraiment : une taille qui
 *     ne va pas ou un modèle qui déplaît tient au produit, pas à l'atelier ;
 *   - les colis partis incomplets (« article manquant » signalé).
 *
 * Sans commande, des chiffres vides — jamais zéro, qui se lirait « parfait ».
 */
export interface Qualite {
  commandes: number;
  retoursPct: number | null;
  defautPct: number | null;
  manquantsPct: number | null;
}

export function calculerQualite(params: {
  commandes: number;
  retours: ReadonlyArray<{ raison: string }>;
  manquants: number;
}): Qualite {
  const part = (n: number) =>
    params.commandes ? Math.round((n / params.commandes) * 1000) / 10 : null;
  return {
    commandes: params.commandes,
    retoursPct: part(params.retours.length),
    defautPct: part(params.retours.filter((retour) => retour.raison === 'DEFECT').length),
    manquantsPct: part(params.manquants),
  };
}
