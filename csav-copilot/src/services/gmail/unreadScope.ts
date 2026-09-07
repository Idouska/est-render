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
