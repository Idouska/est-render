/**
 * Un message ne part qu'une fois.
 *
 * L'envoi d'une réponse lisait le brouillon, vérifiait qu'il n'était pas
 * encore parti, appelait Gmail — une à deux secondes —, puis seulement le
 * marquait envoyé. Deux requêtes rapprochées passaient toutes les deux la
 * vérification : un double clic, un Cmd+Entrée répété, deux onglets, deux
 * agents sur le même ticket. Le client recevait la même réponse deux fois, le
 * fournisseur la même notification deux fois.
 *
 * La place se prend donc AVANT l'appel, par une écriture conditionnelle sur la
 * ligne elle-même : « pose `sendStartedAt` si personne ne l'a posé ». Postgres
 * sérialise deux écritures sur une même ligne — la seconde attend la première,
 * relit la condition, ne trouve plus rien à prendre. Elle repart sans envoyer.
 * C'est l'idiome de la réservation des paires en stock (reshipment/echange).
 *
 * Trois sorties, et aucune ne laisse la ligne bloquée :
 *   — Gmail confirme : la ligne passe à « envoyé », la place est rendue ;
 *   — Gmail refuse : la place est rendue, un nouveau clic réessaie ;
 *   — le serveur tombe entre les deux : la place expire au bout du bail.
 *
 * Ce que le verrou ne promet pas : un mail parti dont la confirmation se perd
 * (Gmail a envoyé, la réponse HTTP n'est jamais revenue) peut repartir au
 * nouvel essai. Entre « au moins une fois » et « au plus une fois », une
 * réponse de SAV choisit la première — un client sans réponse est pire qu'un
 * client qui la reçoit deux fois dans un cas rarissime.
 */

/**
 * Au-delà, un envoi commencé est tenu pour abandonné.
 *
 * Un appel à Gmail dure une à deux secondes ; deux minutes couvrent un réseau
 * lent sans laisser un brouillon bloqué plus longtemps qu'il ne faut pour s'en
 * étonner.
 */
export const BAIL_ENVOI_MS = 2 * 60_000;

/** Ce qu'il est advenu d'une demande d'envoi. */
export type IssueEnvoi = 'envoye' | 'deja-envoye' | 'en-cours';

/**
 * La condition « personne n'est en train d'envoyer ceci » : aucune place
 * posée, ou une place plus vieille que le bail.
 */
export function personneNEnvoie(maintenant: Date) {
  return {
    OR: [
      { sendStartedAt: null },
      { sendStartedAt: { lt: new Date(maintenant.getTime() - BAIL_ENVOI_MS) } },
    ],
  };
}

/** Le message dit à qui a cliqué, selon l'issue. */
export const MESSAGES_ENVOI: Record<Exclude<IssueEnvoi, 'envoye'>, string> = {
  'deja-envoye': 'Déjà envoyé',
  'en-cours': 'Envoi déjà en cours — patientez quelques secondes.',
};
