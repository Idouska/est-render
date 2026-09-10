/**
 * La console des ruptures de stock : tout ce qui se calcule sans base ni réseau.
 *
 * Isolé pour être éprouvé seul. Ce module ne décide de rien qui touche à
 * Shopify ou à Prisma : il reçoit des dossiers déjà lus et en tire des états,
 * une priorité, des compteurs et une synthèse. C'est là que vivent les seuls
 * jugements de la page — et un jugement faux ne se voit pas, il se lit comme
 * une mesure.
 *
 * AUCUN NOUVEL ÉTAT MÉTIER. Les statuts affichés sont une TRADUCTION de
 * `EscalationStatus`, pas une seconde machine posée à côté. Inventer un
 * troisième vocabulaire ferait diverger l'écran et la base au premier
 * ajustement, et personne ne saurait lequel des deux ment.
 */

/**
 * D'où vient le dossier.
 *
 * `atelier` : le fournisseur a signalé l'article manquant depuis son espace.
 * C'est la source la plus fiable — il tient le carton — et, dans les faits,
 * la plus fréquente : le marchand n'apprend une rupture que par lui.
 *
 * `marchand` : le marchand a escaladé un ticket au fournisseur pour lui
 * demander si l'article est disponible.
 */
export type OrigineRupture = 'atelier' | 'marchand';

/** Ce que la route sait d'un dossier, une fois la base lue. */
export interface DossierRupture {
  id: string;
  ticketId: string;
  origine: OrigineRupture;
  /** Statut de l'escalade, tel qu'il est en base. */
  statut: 'DRAFTING' | 'OPEN' | 'ANSWERED' | 'RESOLVED';
  creeLe: Date;
  notifieLe: Date | null;
  resoluLe: Date | null;
  /** Dernier message reçu du fournisseur, s'il a répondu. */
  reponseFournisseurLe: Date | null;
  /** Dernière réponse partie vers le client sur ce fil. */
  reponseClientLe: Date | null;
  /** Un remboursement a été engagé sur ce ticket. */
  rembourse: boolean;
  /** SKU de l'article en rupture, quand la commande a pu être lue. */
  sku: string | null;
  /** Nom du produit : le repli quand l'atelier n'a pas donné de référence. */
  produit: string | null;
  /** Montant de la commande, pour peser l'urgence. */
  montant: number | null;
}

/**
 * Les états montrés à l'écran.
 *
 * Cinq, et pas un de plus : chacun correspond à un fait vérifiable en base.
 * Le visuel de référence en propose d'autres — « alternative proposée »,
 * « réapprovisionnement attendu » — qui ne s'appuient sur rien de stocké. Les
 * afficher demanderait de les inventer à chaque rendu, c'est-à-dire de
 * montrer une couleur qui ne veut rien dire.
 */
export type EtatRupture =
  | 'A_TRAITER'
  | 'CLIENT_A_PREVENIR'
  | 'FOURNISSEUR_EN_ATTENTE'
  | 'FOURNISSEUR_CONTACTE'
  | 'REMBOURSEMENT'
  | 'RESOLU';

export const ETAT_LIBELLES: Record<EtatRupture, string> = {
  A_TRAITER: 'À traiter',
  CLIENT_A_PREVENIR: 'Client à prévenir',
  FOURNISSEUR_EN_ATTENTE: 'Fournisseur en attente',
  FOURNISSEUR_CONTACTE: 'Fournisseur contacté',
  REMBOURSEMENT: 'Remboursement',
  RESOLU: 'Résolu',
};

/**
 * L'état d'un dossier, déduit de ce qui s'est réellement passé.
 *
 * L'ordre des tests est le raisonnement lui-même, du plus tranché au plus
 * ouvert : un dossier clos est clos ; un remboursement engagé est un dossier
 * dont l'issue est décidée ; puis vient la question qui coûte le plus cher —
 * le fournisseur a-t-il répondu sans que le client en ait été informé ?
 *
 * Cette dernière est le cœur de l'écran. C'est le moment où l'information
 * existe, où le client l'attend, et où personne ne la lui a donnée. Elle se
 * déduit sans rien inventer : la réponse du fournisseur est datée, la
 * dernière réponse au client aussi.
 */
export function etatDossier(dossier: DossierRupture): EtatRupture {
  if (dossier.statut === 'RESOLVED') return 'RESOLU';
  if (dossier.rembourse) return 'REMBOURSEMENT';

  /*
   * Un signalement d'atelier n'attend rien du fournisseur : c'est lui qui a
   * parlé, et il a dit que l'article manquait. La rupture est confirmée, le
   * client ne le sait pas — c'est exactement « client à prévenir », sans
   * passer par les étapes d'une escalade qui n'a jamais eu lieu.
   */
  if (dossier.origine === 'atelier') return 'CLIENT_A_PREVENIR';

  // Le brouillon d'escalade n'est pas parti : rien n'a encore été demandé.
  if (dossier.statut === 'DRAFTING') return 'A_TRAITER';

  if (dossier.statut === 'ANSWERED' && dossier.reponseFournisseurLe) {
    const informe =
      dossier.reponseClientLe !== null &&
      dossier.reponseClientLe > dossier.reponseFournisseurLe;
    return informe ? 'FOURNISSEUR_CONTACTE' : 'CLIENT_A_PREVENIR';
  }

  return 'FOURNISSEUR_EN_ATTENTE';
}

export type Priorite = 'haute' | 'moyenne' | 'basse';

/**
 * La priorité d'un dossier, sur trois faits et rien d'autre.
 *
 * Le visuel de référence affiche « Haute / Moyenne / Basse » sans dire d'où
 * elles viennent. Une priorité inventée est pire qu'aucune : elle range le
 * travail dans un ordre que personne ne peut discuter, et l'agent finit par
 * l'ignorer — ce qui vaut mieux que de la suivre.
 *
 * Trois faits, donc, tous vérifiables :
 *
 *   1. L'ANCIENNETÉ. Un dossier de rupture qui dort trois jours a déjà coûté
 *      la vente ; c'est le facteur qui pèse le plus.
 *   2. LE NOMBRE DE COMMANDES touchées par le même SKU. Une rupture qui
 *      bloque huit clients n'est pas huit fois un incident, c'en est un seul,
 *      huit fois plus urgent.
 *   3. LE MONTANT. Un panier à 300 € perdu ne se rattrape pas comme un à 30 €.
 *
 * Un dossier résolu n'a pas de priorité — la lui laisser ferait remonter du
 * travail terminé en tête de liste.
 */
export function prioriteDossier(
  dossier: DossierRupture,
  commandesImpactees: number,
  maintenant: number,
): Priorite | null {
  if (dossier.statut === 'RESOLVED') return null;

  const jours = (maintenant - dossier.creeLe.getTime()) / 86_400_000;

  let points = 0;
  if (jours >= 3) points += 2;
  else if (jours >= 1) points += 1;

  if (commandesImpactees >= 5) points += 2;
  else if (commandesImpactees >= 2) points += 1;

  if ((dossier.montant ?? 0) >= 200) points += 1;

  if (points >= 3) return 'haute';
  if (points >= 1) return 'moyenne';
  return 'basse';
}

/**
 * Ce qui identifie un produit, référence ou, à défaut, nom.
 *
 * L'atelier ne remplit pas toujours la référence : il écrit « Nike Vomero
 * Plus » et la taille, et c'est déjà beaucoup au moment d'emballer. Compter
 * les ruptures sur la seule référence faisait afficher « 0 rupture active »
 * au-dessus d'une rupture bien réelle. Le nom sert de repli, ramené en
 * minuscules pour que « Nike Vomero » et « nike vomero » ne fassent qu'un.
 */
export function cleProduit(dossier: DossierRupture): string | null {
  if (dossier.sku) return `sku:${dossier.sku}`;
  const nom = dossier.produit?.trim().toLowerCase();
  return nom ? `nom:${nom}` : null;
}

/**
 * Les trois temps d'un dossier : créé, traité, classé.
 *
 * Une lecture plus grossière que les six états, et c'est son intérêt : la
 * couleur au bord de la ligne se lit sans rien déchiffrer. Rouge, personne
 * n'a encore répondu au client ; orange, il a eu une réponse ; vert, c'est
 * clos.
 *
 * « Traité » se juge du côté du CLIENT, pas du fournisseur : dans un SAV, un
 * dossier est traité quand la personne qui attend a eu des nouvelles. Une
 * réponse partie avant la rupture ne compte pas — c'était une autre
 * conversation. Un remboursement engagé vaut réponse : l'issue est décidée.
 */
export type PhaseDossier = 'cree' | 'traite' | 'classe';

export function phaseDossier(dossier: DossierRupture): PhaseDossier {
  if (dossier.statut === 'RESOLVED') return 'classe';
  if (dossier.rembourse) return 'traite';

  const repondu =
    dossier.reponseClientLe !== null && dossier.reponseClientLe > dossier.creeLe;
  return repondu ? 'traite' : 'cree';
}

/**
 * Combien de dossiers ouverts partagent chaque produit.
 *
 * C'est ce qui transforme une liste de tickets en console : huit lignes qui
 * disent la même rupture sont un seul problème à traiter à la source. Les
 * dossiers clos sont exclus du compte — les inclure ferait dire « 8 commandes
 * impactées » là où sept sont déjà réglées.
 */
export function commandesParSku(dossiers: readonly DossierRupture[]): Map<string, number> {
  const parSku = new Map<string, number>();

  for (const dossier of dossiers) {
    const cle = cleProduit(dossier);
    if (cle === null || dossier.statut === 'RESOLVED') continue;
    parSku.set(cle, (parSku.get(cle) ?? 0) + 1);
  }

  return parSku;
}

export interface KpisRuptures {
  /** Références distinctes encore bloquées. */
  rupturesActives: number;
  /** Dossiers ouverts, une commande chacun. */
  commandesImpactees: number;
  /** Clients à qui l'information existe mais n'a pas été transmise. */
  clientsAPrevenir: number;
  /** Dossiers dont le fournisseur n'a pas encore répondu. */
  enAttenteFournisseur: number;
  /**
   * Délai moyen entre l'ouverture et la clôture, en minutes.
   *
   * `null` quand rien n'a été résolu sur la période : zéro se lirait
   * « réglé sur-le-champ », l'inverse de « aucune mesure ».
   */
  resolutionMinutes: number | null;
  /** Sur combien de dossiers clos ce délai repose. */
  resolutionMesuree: number;
}

export function kpisRuptures(dossiers: readonly DossierRupture[]): KpisRuptures {
  const ouverts = dossiers.filter((dossier) => dossier.statut !== 'RESOLVED');

  const references = new Set(
    ouverts.map(cleProduit).filter((cle): cle is string => cle !== null),
  );

  const delais = dossiers
    .map((dossier) =>
      dossier.resoluLe === null
        ? null
        : (dossier.resoluLe.getTime() - dossier.creeLe.getTime()) / 60_000,
    )
    // Un dossier clos avant d'être ouvert n'existe pas : c'est une horloge de
    // travers, et le compter tirerait la moyenne vers le bas sans rien dire.
    .filter((minutes): minutes is number => minutes !== null && minutes > 0);

  return {
    rupturesActives: references.size,
    commandesImpactees: ouverts.length,
    clientsAPrevenir: ouverts.filter((dossier) => etatDossier(dossier) === 'CLIENT_A_PREVENIR')
      .length,
    enAttenteFournisseur: ouverts.filter(
      (dossier) => etatDossier(dossier) === 'FOURNISSEUR_EN_ATTENTE',
    ).length,
    resolutionMinutes: delais.length
      ? delais.reduce((total, valeur) => total + valeur, 0) / delais.length
      : null,
    resolutionMesuree: delais.length,
  };
}

/**
 * Combien de dossiers chaque vue contient.
 *
 * Calculé sur l'ensemble, pas sur la page affichée : un compteur d'onglet qui
 * ne compte que les vingt-cinq lignes visibles ferait dire « À traiter 3 »
 * alors qu'il y en a quarante — et l'onglet servirait alors à cacher le
 * travail plutôt qu'à le trouver.
 */
export function compteursVues(dossiers: readonly DossierRupture[]): Record<string, number> {
  const compteurs: Record<string, number> = { tous: 0, ouverts: 0 };

  for (const etat of Object.keys(ETAT_LIBELLES) as EtatRupture[]) compteurs[etat] = 0;

  /*
   * « Tous » veut dire tous, dossiers clos compris.
   *
   * Il excluait les résolus, avec une bonne raison sur le papier — la vue de
   * travail, c'est le travail restant. À l'usage, c'était l'inverse d'une
   * bonne raison : marquer un dossier résolu le faisait DISPARAÎTRE de la
   * liste qu'on regardait, ce qui se lit comme une suppression. Et la couleur
   * verte, « classé », n'apparaissait jamais là où l'on regarde. Un dossier
   * clos reste donc visible, en vert, rangé après ceux qui restent à faire.
   *
   * `ouverts` porte ce que `tous` portait avant : le travail restant. C'est
   * lui que compte la pastille du menu — une pastille qui compterait aussi le
   * travail fini ne redescendrait jamais.
   */
  let tous = 0;
  let ouverts = 0;
  for (const dossier of dossiers) {
    const etat = etatDossier(dossier);
    compteurs[etat] = (compteurs[etat] ?? 0) + 1;
    tous += 1;
    if (etat !== 'RESOLU') ouverts += 1;
  }

  compteurs.tous = tous;
  compteurs.ouverts = ouverts;
  return compteurs;
}

/**
 * La synthèse d'un dossier, en trois phrases au plus.
 *
 * Elle répond aux trois questions qu'on se pose devant une rupture : quel est
 * le problème, qui cela touche, et que faire maintenant. Composée à partir
 * des faits du dossier, jamais rédigée par un modèle — d'où son titre,
 * « Synthèse » et non « Résumé IA ». Appeler « IA » une phrase assemblée par
 * un `if` serait mentir sur le fonctionnement du produit à quelqu'un qui le
 * revend, et le marchand le répéterait de bonne foi à ses propres clients.
 */
export function syntheseDossier(params: {
  dossier: DossierRupture;
  produit: string | null;
  fournisseur: string | null;
  commandesImpactees: number;
  maintenant: number;
}): string[] {
  const { dossier, produit, fournisseur, commandesImpactees, maintenant } = params;
  const phrases: string[] = [];

  const jours = Math.floor((maintenant - dossier.creeLe.getTime()) / 86_400_000);
  const depuis = jours >= 1 ? ` depuis ${jours} jour${jours > 1 ? 's' : ''}` : " aujourd'hui";

  if (dossier.origine === 'atelier') {
    // Dire QUI a signalé : un fait rapporté par l'atelier ne se traite pas
    // comme un doute que le marchand soumet au fournisseur.
    phrases.push(
      `${fournisseur ?? 'L’atelier'} a signalé ${produit ?? 'cet article'} en rupture${depuis}.`,
    );
  } else {
    phrases.push(
      produit
        ? `${produit} est en rupture${fournisseur ? ` chez ${fournisseur}` : ''}${depuis}.`
        : `Rupture signalée${fournisseur ? ` chez ${fournisseur}` : ''}${depuis}.`,
    );
  }

  if (commandesImpactees > 1) {
    phrases.push(`${commandesImpactees} commandes sont bloquées par cette même référence.`);
  }

  phrases.push(recommandation(etatDossier(dossier), dossier.origine));

  return phrases;
}

function recommandation(etat: EtatRupture, origine: OrigineRupture): string {
  if (etat === 'CLIENT_A_PREVENIR' && origine === 'atelier') {
    return 'Le client ne le sait pas encore : prévenez-le, en proposant une alternative si une référence équivalente est en stock.';
  }

  switch (etat) {
    case 'A_TRAITER':
      return 'Le fournisseur n’a pas encore été sollicité : commencez par lui.';
    case 'FOURNISSEUR_EN_ATTENTE':
      return 'La demande est partie et attend une réponse. Cherchez une alternative en parallèle plutôt que d’attendre.';
    case 'CLIENT_A_PREVENIR':
      return 'Le fournisseur a répondu et le client ne le sait pas encore : c’est le seul geste qui manque.';
    case 'FOURNISSEUR_CONTACTE':
      return 'Client et fournisseur sont informés. Clôturez le dossier une fois la commande repartie.';
    case 'REMBOURSEMENT':
      return 'Un remboursement est engagé : vérifiez qu’il est bien passé avant de clôturer.';
    case 'RESOLU':
      return 'Dossier clos.';
  }
}
