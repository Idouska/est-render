/**
 * Les deux fenêtres qu'un « vs hier » honnête doit comparer.
 *
 * LE PIÈGE, ET IL EST GROS. Comparer « aujourd'hui » à « hier » revient
 * presque toujours à comparer une journée COMMENCÉE à une journée FINIE. À
 * neuf heures du matin, six tickets traités contre trente-huit la veille
 * affichent « −84 % » — et l'écran annonce un effondrement à une équipe qui
 * démarre sa journée normalement. Le chiffre est faux sans être erroné : il
 * mesure deux choses différentes.
 *
 * La comparaison porte donc sur la même TRANCHE de journée : de minuit à
 * maintenant aujourd'hui, de minuit à la même heure hier. Deux fenêtres de
 * durée identique, la seule façon que l'écart décrive le travail plutôt que
 * l'heure qu'il est.
 *
 * CE QUI PEUT ÊTRE COMPARÉ, ET CE QUI NE LE PEUT PAS. Un FLUX — combien de
 * messages sont arrivés, combien ont été traités — se recompte pour n'importe
 * quelle fenêtre passée : la date est sur chaque ligne. Un STOCK — combien
 * attendent en ce moment, combien de brouillons sont prêts — n'existe qu'au
 * présent. Personne n'a enregistré combien il y en avait hier à cette heure,
 * et rien ne permet de le reconstituer : le produit ne garde pas l'historique
 * des statuts. Un « vs hier » sur un stock serait une invention pure.
 */

export interface FenetresJour {
  /** Minuit aujourd'hui, dans le fuseau du serveur. */
  debutAujourdhui: Date;
  /** Minuit hier. */
  debutHier: Date;
  /** Hier, à l'heure qu'il est maintenant. */
  memeHeureHier: Date;
  /** Minutes écoulées depuis minuit — sert à taire un écart calculé sur rien. */
  minutesEcoulees: number;
}

export function fenetresJour(maintenant: Date = new Date()): FenetresJour {
  const debutAujourdhui = new Date(
    maintenant.getFullYear(),
    maintenant.getMonth(),
    maintenant.getDate(),
  );

  const ecoule = maintenant.getTime() - debutAujourdhui.getTime();
  const debutHier = new Date(debutAujourdhui.getTime() - 86_400_000);

  return {
    debutAujourdhui,
    debutHier,
    memeHeureHier: new Date(debutHier.getTime() + ecoule),
    minutesEcoulees: Math.floor(ecoule / 60_000),
  };
}
