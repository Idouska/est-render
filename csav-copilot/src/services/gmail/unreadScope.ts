/**
 * La population sur laquelle « non lu » veut dire quelque chose.
 *
 * Deux endroits en dépendent et doivent dire la même chose : le compteur de la
 * barre de navigation (`GET /api/metrics`), et la reprise qui va corriger
 * l'état de lecture des fils entrés avant l'existence du champ
 * (`src/scripts/repriseGmail.ts`). Écrits deux fois, ils divergeraient au premier
 * ajustement — et la reprise réparerait consciencieusement des lignes que le
 * compteur ne regarde pas, sans que rien ne le signale.
 *
 * Les fils historiques sont hors sujet : ils sont importés, jamais à traiter.
 * Les fils clos aussi : rouvrir une archive qui n'a jamais été marquée lue la
 * ferait remonter dans le compte pour rien.
 *
 * Ce qui ne figure pas ici est aussi délibéré. Ni `merchantId` — le compteur
 * est par marchand, la reprise passe sur tous. Ni `gmailUnread` — c'est
 * précisément le champ que l'un compte et que l'autre répare : la reprise doit
 * visiter les fils quelle que soit la valeur qu'ils portent aujourd'hui,
 * puisque cette valeur est justement celle dont on se méfie.
 */
export const PORTEE_NON_LU = {
  isHistorical: false,
  status: { notIn: ['CLOSED', 'AUTO_SENT'] as ('CLOSED' | 'AUTO_SENT')[] },
};

/**
 * Ce qui, aujourd'hui, compte comme non lu.
 *
 * Deux conditions et non une : le fil porte encore le libellé `UNREAD` de
 * Gmail, ET personne de l'équipe ne l'a ouvert dans l'outil. La seconde est
 * nécessaire parce que l'outil n'a que `gmail.readonly` : ouvrir un message
 * ici ne retire pas le libellé chez Google, donc `gmailUnread` reste vrai
 * indéfiniment et le gras ne s'éteindrait jamais.
 *
 * Trois endroits en dépendent — le gras de la file, la pastille « Non lus »
 * du rail de filtres, et « En attente de vous » du poste de pilotage. Écrite
 * trois fois, la condition divergerait au premier ajustement : on verrait un
 * message en gras que la pastille ne compte pas, ce qui donne l'impression
 * que le compteur est cassé plutôt que la règle incohérente.
 *
 * DEUX SOURCES POUR `gmailUnread`. Depuis que l'équipe peut remettre un
 * message en non lu d'un clic (action groupée `unread`), ce champ ne reflète
 * plus seulement le libellé Gmail : il dit « ce fil est à lire », que ce soit
 * Gmail ou l'équipe qui l'ait décidé. Rien ne remonte chez Google — l'outil
 * n'a que `gmail.readonly` — donc lire le message DANS Gmail l'éteint ici
 * aussi, ce qui est le comportement attendu.
 *
 * Conséquence à connaître : `npm run gmail:reprise`, qui réaligne ce champ
 * sur l'état réel de la boîte, effacerait un « non lu » posé à la main. C'est
 * une reprise unique, lancée à la main ; le rappeler ici évite d'en faire une
 * surprise.
 *
 * La condition n'emploie ni `AND` ni `OR` : elle est répandue dans des
 * `where` qui utilisent déjà les deux, et deux clés identiques dans le même
 * objet s'écrasent sans la moindre erreur.
 */
export const NON_LU = { gmailUnread: true, openedAt: null } as const;
