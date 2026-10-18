/**
 * Le tableau des ruptures, côté staff : l'état de chaque dossier, les chiffres
 * du haut, les modèles en rupture.
 *
 * Sans base ni réseau : la route lit, ce module juge, et les tests éprouvent
 * le jugement seul. Rien n'est stocké ici qui ne se relise ailleurs — l'état
 * se déduit de ce qui s'est passé : la consigne envoyée, la réponse de
 * l'atelier, le mail parti, le nouveau numéro de suivi.
 */

export interface ConsigneDuTableau {
  choix: 'ATTENDRE' | 'REMPLACER' | 'ANNULER' | 'MESSAGE';
  reponse: 'COMPRIS' | 'IMPOSSIBLE' | 'REPONDU' | null;
  remplaceeLe: Date | string | null;
  envoyeeLe: Date | string;
  reponduLe?: Date | string | null;
  relancerLe?: Date | string | null;
  modeles?: ReadonlyArray<{ productTitle: string; variantTitle?: string | null; sku?: string | null }>;
}

export interface DossierDuTableau {
  /** Clos : par le marchand, ou par la clôture du ticket. */
  resolu: boolean;
  creeLe: Date | string;
  /** Le premier mail parti au client depuis la rupture. */
  mailClientLe: Date | string | null;
  /** Le premier colis saisi pour la commande depuis la rupture. */
  nouveauSuiviLe: Date | string | null;
  /** Remboursement décidé : fait, ou pas encore. Nul s'il n'y en a pas. */
  remboursementFait: boolean | null;
  /** La note de l'atelier : « réassort dans 10 jours ». */
  joursAnnonces: number | null;
  consignes: readonly ConsigneDuTableau[];
  produit: { cle: string | null; nom: string | null; variante: string | null };
}

export type CleFile = 'A_TRAITER' | 'ATTENTE_ATELIER' | 'A_REMBOURSER' | 'EXPEDIEE' | 'REMBOURSE' | 'RESOLU';

export interface FileDossier {
  cle: CleFile;
  /** Ce que dit la colonne État : « À traiter », « Restock »… */
  libelle: string;
  /** La ligne dessous : ce qui précise. */
  sous: string;
  ton: 'crit' | 'warn' | 'accent' | 'ok' | 'neutre';
  /** Une décision est attendue de l'équipe. */
  aTraiter: boolean;
  /** Le mail est parti, aucune décision n'a été prise : le client a la parole. */
  attenteClient: boolean;
  /** Le modèle de remplacement manquait aussi : c'est le 2e choix. */
  repete: boolean;
  /** Une consigne attend l'atelier : sa confirmation, ou le nouveau colis. */
  attenteAtelier: boolean;
}

const date = (valeur: Date | string) => new Date(valeur);
const jourCourt = (valeur: Date | string) =>
  date(valeur).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', timeZone: 'Europe/Paris' });

const courante = (consignes: readonly ConsigneDuTableau[]) => {
  const derniere = consignes.at(-1);
  return derniere && !derniere.remplaceeLe ? derniere : null;
};

/** Le modèle de remplacement a manqué lui aussi : l'atelier a dit « je ne pourrai pas ». */
export const estRepete = (consignes: readonly ConsigneDuTableau[]) =>
  consignes.some((consigne) => consigne.choix === 'REMPLACER' && consigne.reponse === 'IMPOSSIBLE');

/**
 * Où en est un dossier, vu du staff.
 *
 * L'ordre des tests est le raisonnement : clos d'abord, puis expédié (le
 * nouveau colis tranche tout), puis ce que dit la consigne courante, et enfin
 * l'absence de décision — le cas qui doit ressortir.
 */
export function fileDossier(dossier: DossierDuTableau, maintenant: Date = new Date()): FileDossier {
  const repete = estRepete(dossier.consignes);
  const base = { aTraiter: false, attenteClient: false, repete, attenteAtelier: false };
  const consigne = courante(dossier.consignes);
  const expedie = dossier.nouveauSuiviLe && date(dossier.nouveauSuiviLe) > date(dossier.creeLe);

  if (dossier.resolu) {
    if (dossier.remboursementFait) return { ...base, repete: false, cle: 'REMBOURSE', libelle: 'Remboursé', sous: 'dossier clos', ton: 'neutre' };
    return expedie
      ? { ...base, repete: false, cle: 'EXPEDIEE', libelle: 'Expédiée', sous: 'dossier clos', ton: 'ok' }
      : { ...base, repete: false, cle: 'RESOLU', libelle: 'Résolu', sous: 'dossier clos', ton: 'neutre' };
  }

  if (expedie && consigne && consigne.reponse !== 'IMPOSSIBLE' && consigne.choix !== 'ANNULER') {
    return { ...base, cle: 'EXPEDIEE', libelle: 'Expédiée', sous: `nouveau suivi le ${jourCourt(dossier.nouveauSuiviLe!)}`, ton: 'ok' };
  }

  if (consigne) {
    if (consigne.reponse === 'IMPOSSIBLE') {
      return {
        ...base,
        cle: 'A_TRAITER',
        aTraiter: true,
        libelle: 'À traiter',
        sous: consigne.choix === 'REMPLACER' ? '2e choix aussi en rupture' : 'l’atelier ne pourra pas',
        ton: 'crit',
      };
    }
    if (consigne.choix === 'ANNULER') {
      return dossier.remboursementFait
        ? { ...base, cle: 'REMBOURSE', libelle: 'Remboursé', sous: 'article non expédié', ton: 'neutre' }
        : { ...base, cle: 'A_REMBOURSER', libelle: 'À rembourser', sous: 'onglet Remboursement', ton: 'crit' };
    }
    if (consigne.choix === 'ATTENDRE') {
      const relance = consigne.relancerLe ? date(consigne.relancerLe) : null;
      if (relance && relance <= maintenant) {
        return { ...base, cle: 'A_TRAITER', aTraiter: true, libelle: 'Client à relancer', sous: `restock depuis le ${jourCourt(consigne.envoyeeLe)}`, ton: 'crit' };
      }
      return {
        ...base,
        cle: 'ATTENTE_ATELIER',
        attenteAtelier: true,
        libelle: 'Restock',
        sous: relance ? `relance du client le ${jourCourt(relance)}` : 'en attente du réassort',
        ton: 'warn',
      };
    }
    if (consigne.choix === 'REMPLACER') {
      return {
        ...base,
        cle: 'ATTENTE_ATELIER',
        attenteAtelier: true,
        libelle: 'Modèle modifié',
        sous: consigne.reponse === 'COMPRIS' ? 'confirmé, en attente du colis' : 'en attente de l’atelier',
        ton: 'accent',
      };
    }
    // Un message : sa réponse appelle la suite.
    return consigne.reponse === 'REPONDU'
      ? { ...base, cle: 'A_TRAITER', aTraiter: true, libelle: 'À traiter', sous: 'l’atelier a répondu', ton: 'crit' }
      : { ...base, cle: 'ATTENTE_ATELIER', attenteAtelier: true, libelle: 'Message à l’atelier', sous: 'en attente de sa réponse', ton: 'accent' };
  }

  const mail = Boolean(dossier.mailClientLe);
  return {
    ...base,
    cle: 'A_TRAITER',
    aTraiter: true,
    attenteClient: mail,
    libelle: 'À traiter',
    sous: mail
      ? 'mail parti, pas de décision'
      : dossier.joursAnnonces
        ? `réassort dans ${dossier.joursAnnonces} j`
        : 'pas encore de décision',
    ton: 'crit',
  };
}

const JOUR = 86_400_000;

/**
 * Les cinq chiffres du haut.
 *
 * Le délai moyen va de la rupture au nouveau numéro de suivi — le moment où
 * le client a enfin un colis — sur les quatre-vingt-dix derniers jours. Sans
 * colis saisi, aucun délai n'est inventé.
 */
export function chiffresRuptures(dossiers: readonly DossierDuTableau[], maintenant: Date = new Date()) {
  const ouverts = dossiers.filter((dossier) => !dossier.resolu);
  const files = ouverts.map((dossier) => fileDossier(dossier, maintenant));
  const delais = dossiers
    .filter((dossier) => maintenant.getTime() - date(dossier.creeLe).getTime() <= 90 * JOUR)
    .map((dossier) =>
      dossier.nouveauSuiviLe ? date(dossier.nouveauSuiviLe).getTime() - date(dossier.creeLe).getTime() : null,
    )
    .filter((delai): delai is number => delai !== null && delai > 0);

  return {
    aTraiter: files.filter((file) => file.aTraiter).length,
    attenteClient: files.filter((file) => file.attenteClient).length,
    repetees: files.filter((file) => file.repete).length,
    attenteAtelier: files.filter((file) => file.attenteAtelier).length,
    delaiMoyenHeures: delais.length ? Math.round(delais.reduce((somme, delai) => somme + delai, 0) / delais.length / 3_600_000) : null,
    delaiMesure: delais.length,
  };
}

export interface ModeleEnRupture {
  cle: string;
  nom: string;
  variante: string | null;
  fois: number;
  /** Dont les fois où il manquait en 2e choix, proposé en remplacement. */
  deuxiemeChoix: number;
  derniereLe: string;
}

/**
 * Les modèles en rupture sur quatre-vingt-dix jours, et combien de fois.
 *
 * Un modèle compte à chaque dossier où il manque — et aussi quand, proposé en
 * remplacement, il manquait lui aussi : c'est la même référence vide, vue
 * depuis un autre dossier.
 */
export function modelesEnRupture(dossiers: readonly DossierDuTableau[], maintenant: Date = new Date()): ModeleEnRupture[] {
  const parCle = new Map<string, ModeleEnRupture>();
  const compter = (cle: string | null, nom: string | null, variante: string | null, le: Date | string, deuxieme: boolean) => {
    if (!cle || !nom) return;
    if (maintenant.getTime() - date(le).getTime() > 90 * JOUR) return;
    const existant = parCle.get(cle);
    const iso = date(le).toISOString();
    if (existant) {
      existant.fois += 1;
      if (deuxieme) existant.deuxiemeChoix += 1;
      if (iso > existant.derniereLe) existant.derniereLe = iso;
    } else {
      parCle.set(cle, { cle, nom, variante, fois: 1, deuxiemeChoix: deuxieme ? 1 : 0, derniereLe: iso });
    }
  };

  for (const dossier of dossiers) {
    compter(dossier.produit.cle, dossier.produit.nom, dossier.produit.variante, dossier.creeLe, false);
    for (const consigne of dossier.consignes) {
      if (consigne.choix !== 'REMPLACER' || consigne.reponse !== 'IMPOSSIBLE') continue;
      const modele = consigne.modeles?.[0];
      if (!modele) continue;
      compter(
        modele.sku?.trim() ? `sku:${modele.sku.trim().toLowerCase()}` : `nom:${modele.productTitle.trim().toLowerCase()}`,
        modele.productTitle,
        modele.variantTitle ?? null,
        consigne.reponduLe ?? consigne.envoyeeLe,
        true,
      );
    }
  }

  return [...parCle.values()].sort((a, b) => b.fois - a.fois || b.derniereLe.localeCompare(a.derniereLe)).slice(0, 8);
}
