/**
 * État de santé de la plomberie, pour la console d'exploitation.
 *
 * Les trois pannes couvertes ici ont un point commun : elles ne produisent
 * aucune erreur. Le cron supprimé ne râle pas, l'écoute Gmail expirée ne râle
 * pas, un worker mort ne râle pas. Chacune se présente comme du silence, et le
 * silence est indiscernable du bon fonctionnement — c'est très exactement ce
 * qui les rend dangereuses.
 *
 * Un précédent commande la forme de ce module : un rapport annonçait « 100
 * messages en attente » sur un système parfaitement sain, parce qu'il seuillait
 * un compteur isolé. Un voyant rouge doit correspondre à quelque chose de
 * réellement cassé, sans quoi il finit ignoré et ne sert plus à rien. D'où deux
 * règles suivies partout ici : croiser deux chiffres plutôt qu'en seuiller un,
 * et faire dire à chaque voyant *pourquoi* il est vert, pas seulement qu'il
 * l'est.
 *
 * Les seuils sont des fonctions pures : c'est la seule façon de les mettre sous
 * test sans base, sans Redis et sans attendre sept jours qu'une écoute expire.
 */

/** Vert : rien à faire. Orange : ça tiendra encore un passage. Rouge : c'est cassé. */
export type HealthLevel = 'ok' | 'warn' | 'down';

export interface Indicator {
  level: HealthLevel;
  /** Ce qu'il faut lire en premier, en français, sans jargon de file. */
  headline: string;
  /** Le chiffre ou la date qui fonde le verdict. */
  detail: string;
}

const HOUR = 60 * 60 * 1000;

/** Ancienneté en heures, arrondie, pour l'affichage comme pour les seuils. */
function hoursSince(date: Date, now: Date): number {
  return (now.getTime() - date.getTime()) / HOUR;
}

/**
 * Le cron a-t-il tourné ?
 *
 * Il passe une fois par jour (`0 4 * * *`). On tolère un passage manqué —
 * un déploiement en cours, un redémarrage de l'hébergeur — mais pas deux :
 * l'écoute Gmail se renouvelle quand il lui reste moins de 24 h, donc deux
 * passages sautés commencent à mordre sur la marge de sécurité.
 */
export function cronIndicator(lastSuccess: Date | null, now: Date): Indicator {
  if (!lastSuccess) {
    return {
      level: 'down',
      headline: 'Le cron n’a jamais tourné',
      detail:
        'Aucun passage enregistré. L’écoute Gmail expirera d’elle-même sous sept jours.',
    };
  }

  const age = hoursSince(lastSuccess, now);
  const when = `Dernier passage réussi il y a ${Math.round(age)} h.`;

  if (age > 50) {
    return {
      level: 'down',
      headline: 'Le cron ne tourne plus',
      detail: `${when} Deux passages consécutifs manquent : le service est probablement arrêté.`,
    };
  }

  if (age > 26) {
    return {
      level: 'warn',
      headline: 'Le cron a sauté un passage',
      detail: `${when} Un passage manque. Encore sain, mais le prochain compte.`,
    };
  }

  return { level: 'ok', headline: 'Le cron tourne', detail: when };
}

/**
 * L'écoute Gmail d'une boîte est-elle vivante ?
 *
 * Elle expire au bout de sept jours et le cron la renouvelle dès qu'il lui
 * reste moins de 24 h. Un délai inférieur à ce seuil signifie donc que le
 * renouvellement aurait dû avoir lieu et n'a pas eu lieu — le seuil n'est pas
 * choisi ici, il est lu dans `renewExpiringWatches`.
 */
export function watchIndicator(
  mailbox: string,
  expiration: Date | null,
  now: Date,
): Indicator {
  if (!expiration) {
    return {
      level: 'down',
      headline: `${mailbox} : aucune écoute active`,
      detail: 'Les nouveaux mails n’arriveront que par relève manuelle.',
    };
  }

  const remaining = -hoursSince(expiration, now);

  if (remaining <= 0) {
    return {
      level: 'down',
      headline: `${mailbox} : écoute expirée`,
      detail: `Expirée depuis ${Math.round(-remaining)} h. Cette boîte est aveugle.`,
    };
  }

  if (remaining < 24) {
    return {
      level: 'warn',
      headline: `${mailbox} : écoute bientôt expirée`,
      detail: `Encore ${Math.round(remaining)} h. Le cron aurait dû la renouveler.`,
    };
  }

  return {
    level: 'ok',
    headline: `${mailbox} : écoute active`,
    detail: `Valide encore ${Math.round(remaining / 24)} j.`,
  };
}

export interface QueueCounts {
  waiting: number;
  active: number;
  completed: number;
  failed: number;
}

/**
 * La file avance-t-elle ?
 *
 * Le nombre en attente ne dit rien à lui seul : rattraper un an d'archives en
 * empile des milliers, et c'est le fonctionnement normal. Ce qui distingue un
 * embouteillage sain d'un worker mort, c'est le mouvement — des tâches en
 * attente, aucune en cours, et aucune terminée sur la fenêtre que BullMQ
 * conserve (24 h). Trois chiffres à zéro autour d'un quatrième qui monte : là,
 * personne ne consomme.
 *
 * Les échecs sont comptés sur sept jours, la durée de rétention de BullMQ.
 * Quelques-uns sont normaux — une coupure du fournisseur d'IA, cinq tentatives
 * épuisées. Une vingtaine ne l'est plus, et le dashboard sait les relancer.
 */
export function queueIndicator(name: string, counts: QueueCounts): Indicator {
  const { waiting, active, completed, failed } = counts;

  if (waiting > 0 && active === 0 && completed === 0) {
    return {
      level: 'down',
      headline: `${name} : personne ne consomme`,
      detail: `${waiting} en attente, aucune en cours, aucune terminée depuis 24 h. Le worker est probablement arrêté.`,
    };
  }

  if (failed >= 20) {
    return {
      level: 'warn',
      headline: `${name} : les échecs s’accumulent`,
      detail: `${failed} tâches en échec sur sept jours, ${waiting} en attente. Relançables depuis le dashboard.`,
    };
  }

  return {
    level: 'ok',
    headline: `${name} : la file avance`,
    detail: `${waiting} en attente, ${active} en cours, ${completed} terminées depuis 24 h.`,
  };
}

/** Le pire des voyants : c'est lui qui décide de la couleur du bandeau. */
export function worstLevel(indicators: Indicator[]): HealthLevel {
  if (indicators.some((one) => one.level === 'down')) return 'down';
  if (indicators.some((one) => one.level === 'warn')) return 'warn';
  return 'ok';
}
