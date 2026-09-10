/**
 * Les demandes qu'un fournisseur laisse sans réponse.
 *
 * Le regroupement vient de la base ; ce module ne fait que le résumer. Il est
 * séparé pour être éprouvé seul : importer la route entière traînerait Prisma,
 * Shopify et la configuration derrière lui, et ce petit calcul ne serait
 * jamais testé — or c'est lui qui décide si un compteur d'alerte s'allume.
 */

/** Une ligne de `groupBy({ by: ['supplierId'], _count, _min: { createdAt } })`. */
export interface GroupeAlertes {
  _count: number;
  _min: { createdAt: Date | null };
}

export interface RetardFournisseurs {
  /** Nombre de demandes en souffrance : la charge. */
  requests: number;
  /** Nombre d'ateliers concernés : le nombre de coups de fil. */
  suppliers: number;
  /**
   * Date de la plus ancienne, ou `null` quand il n'y en a aucune.
   *
   * `null` et non la date du jour : une ancienneté inventée se lirait comme
   * une mesure, et « il y a 0 min » ferait croire qu'une demande vient de
   * partir alors qu'aucune n'attend.
   */
  oldestAt: Date | null;
}

export function retardFournisseurs(groupes: readonly GroupeAlertes[]): RetardFournisseurs {
  return {
    requests: groupes.reduce((total, groupe) => total + groupe._count, 0),
    suppliers: groupes.length,
    oldestAt: groupes.reduce<Date | null>((plusVieille, groupe) => {
      const date = groupe._min.createdAt;
      // Une ligne sans date ne peut pas être la plus ancienne : la garder
      // écraserait une vraie date par `null` et éteindrait l'infobulle.
      if (date === null) return plusVieille;
      return plusVieille !== null && plusVieille < date ? plusVieille : date;
    }, null),
  };
}
