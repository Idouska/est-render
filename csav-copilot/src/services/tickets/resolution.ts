/**
 * Le délai de résolution : combien de temps un client attend, en tout.
 *
 * Le délai de PREMIÈRE réponse dit à quelle vitesse on décroche ; celui-ci dit
 * à quelle vitesse on raccroche. Les deux se déforment dans des sens
 * opposés — une équipe peut accuser réception en dix minutes et laisser le
 * dossier traîner trois semaines — et c'est pour ça qu'aucun des deux ne
 * remplace l'autre.
 *
 * CE QUI MARQUE LA FIN, ET POURQUOI CE N'EST PAS LA CLÔTURE. `Ticket` ne porte
 * pas de date de clôture : `updatedAt` est un `@updatedAt`, il bouge à la
 * moindre écriture — une synchronisation Gmail, un changement de propriétaire,
 * un marquage « lu » — bien après que l'affaire soit close. Mesurer dessus
 * gonflerait le délai d'événements qui n'ont rien à voir avec le client, sans
 * qu'aucun chiffre ne paraisse faux.
 *
 * La dernière réponse partie, elle, est un événement daté, immuable, et c'est
 * le moment où le client a cessé d'attendre. C'est donc lui qui borne la
 * mesure — au prix d'une nuance que l'infobulle doit porter, pas cacher.
 *
 * CE QUI N'EST PAS MESURÉ. Un ticket clos sans qu'aucune réponse ne parte —
 * du courrier indésirable, un doublon, une affaire réglée au téléphone — ne
 * laisse pas de trace mesurable. Il est exclu plutôt que compté zéro, et le
 * nombre de tickets réellement mesurés est renvoyé pour que l'écran puisse
 * dire sur quoi il s'appuie. Une moyenne ne vaut rien sans son effectif.
 */

/**
 * Une ligne de `groupBy({ by: ['ticketId'], _min|_max: { receivedAt } })`.
 *
 * `receivedAt` est optionnel ET nullable, comme le type que Prisma produit :
 * le champ manque quand l'agrégat ne l'a pas demandé, et vaut `null` quand le
 * groupe est vide. Les deux mènent au même endroit — on ne sait pas — mais
 * resserrer le type ici obligerait la route à mentir par une assertion.
 */
export interface GroupeMessages {
  ticketId: string;
  _min?: { receivedAt?: Date | null };
  _max?: { receivedAt?: Date | null };
}

export interface DelaisResolution {
  /**
   * Médiane et moyenne en minutes, `null` quand rien n'a pu être mesuré.
   *
   * `null` et non zéro : zéro se lirait « résolu instantanément », soit
   * l'inverse exact de « aucune résolution mesurable sur la période ».
   */
  medianMinutes: number | null;
  averageMinutes: number | null;
  /** Sur combien de tickets la mesure repose. */
  measured: number;
  /**
   * Combien de tickets résolus la fenêtre contient, mesurables ou non.
   *
   * L'écart avec `measured` est l'angle mort de l'indicateur : le taire
   * laisserait croire que la médiane décrit tous les dossiers clos.
   */
  resolved: number;
}

export function delaisResolution(
  premiersEntrants: readonly GroupeMessages[],
  derniersSortants: readonly GroupeMessages[],
  resolved: number,
): DelaisResolution {
  const debut = new Map(
    premiersEntrants.map((groupe) => [groupe.ticketId, groupe._min?.receivedAt ?? null]),
  );

  const minutes = derniersSortants
    .map((groupe) => {
      const ouvert = debut.get(groupe.ticketId);
      const clos = groupe._max?.receivedAt ?? null;
      if (!ouvert || !clos) return null;

      // Une réponse antérieure à la question n'existe pas : c'est un fil
      // importé dont l'ordre s'est perdu, ou une horloge de travers. La
      // compter tirerait la médiane vers le bas sans que rien ne le dise.
      const ecart = (clos.getTime() - ouvert.getTime()) / 60000;
      return ecart > 0 ? ecart : null;
    })
    .filter((valeur): valeur is number => valeur !== null)
    .sort((a, b) => a - b);

  return {
    medianMinutes: minutes.length ? mediane(minutes) : null,
    averageMinutes: minutes.length
      ? minutes.reduce((total, valeur) => total + valeur, 0) / minutes.length
      : null,
    measured: minutes.length,
    resolved,
  };
}

/**
 * La médiane, moyenne des deux valeurs centrales sur un effectif pair.
 *
 * Prendre simplement l'élément du milieu — ce que fait le délai de première
 * réponse ailleurs dans ce fichier — décale la mesure vers le haut d'un demi
 * rang. Sur deux tickets résolus en 10 min et 4 h, cela annonce 4 h de
 * médiane, ce qui n'est ni la médiane ni une description honnête.
 */
function mediane(triees: readonly number[]): number {
  const milieu = Math.floor(triees.length / 2);
  return triees.length % 2 === 1
    ? triees[milieu]!
    : (triees[milieu - 1]! + triees[milieu]!) / 2;
}
