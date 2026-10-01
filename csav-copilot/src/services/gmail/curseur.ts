/**
 * Jusqu'où avancer le curseur d'historique.
 *
 * SEULEMENT jusqu'au dernier enregistrement RÉELLEMENT lu. Jamais jusqu'à
 * « maintenant ».
 *
 * `history.list` renvoie, à côté des enregistrements, l'identifiant courant de
 * la boîte. On l'écrivait comme nouveau curseur — ce qui revient à déclarer lu
 * tout ce qui s'est passé jusqu'à cet instant, y compris ce que l'appel n'a
 * pas rendu. Un message dont l'enregistrement n'était pas encore visible
 * passait donc SOUS le curseur : il ne figurait dans aucun historique suivant,
 * et la relève incrémentale ne le voyait plus jamais. Il n'entrait que par le
 * rattrapage par date, des minutes plus tard — le retard que le marchand
 * constatait.
 *
 * En n'avançant que sur ce qu'on a lu, un enregistrement en retard reste
 * devant le curseur et sera lu au passage suivant. Le pire cas est de relire
 * quelques enregistrements déjà vus, ce que le contrôle « message déjà connu »
 * rend sans effet.
 *
 * `null` veut dire : ne touche pas au curseur.
 */
export function curseurApres(
  enregistrements: readonly string[],
  tronque: boolean,
): string | null {
  // Lot incomplet : le reliquat n'a pas été traité, le curseur doit l'attendre.
  if (tronque) return null;

  let plusHaut: bigint | null = null;
  let retenu: string | null = null;

  for (const brut of enregistrements) {
    let valeur: bigint;
    try {
      valeur = BigInt(brut);
    } catch {
      continue;
    }
    if (plusHaut === null || valeur > plusHaut) {
      plusHaut = valeur;
      retenu = brut;
    }
  }

  return retenu;
}
