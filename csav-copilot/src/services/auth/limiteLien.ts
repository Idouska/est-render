import { createHash } from 'node:crypto';

/*
 * Combien de liens de connexion une adresse peut recevoir.
 *
 * `POST /api/auth/request-link` est publique par construction : c'est un lien
 * magique, on ne peut pas demander d'être connecté pour demander à se
 * connecter. Le dessin de la route est sain — elle n'envoie qu'à une adresse
 * ayant déjà un compte actif, elle envoie à cette adresse elle-même et non à
 * une adresse fournie par l'appelant, et elle répond la même chose que le
 * compte existe ou non.
 *
 * Ce qui manquait, c'est la borne. Sans elle, quiconque connaît l'adresse d'un
 * équipier peut déclencher des envois sans fin depuis la boîte Gmail du
 * MARCHAND. Deux conséquences, dans cet ordre de gravité : le quota d'envoi
 * Gmail du marchand s'épuise — deux mille messages par jour sur Workspace — et
 * plus aucune réponse client ne part ; et l'équipier est inondé.
 *
 * Deux fenêtres plutôt qu'une. La courte arrête le martèlement ; la
 * journalière borne le total, car soixante secondes de délai laissent encore
 * mille quatre cents envois par jour et par adresse.
 */

/** Un envoi par adresse et par minute. */
export const DELAI_COURT_S = 60;

/** Dix par adresse et par jour : large pour une personne, borné pour un script. */
export const PLAFOND_JOUR = 10;
export const FENETRE_JOUR_S = 24 * 60 * 60;

/**
 * Le magasin dont le limiteur a besoin, réduit à trois opérations.
 *
 * Déclaré ici plutôt qu'importé d'ioredis pour que le test n'ait pas besoin
 * d'un Redis : un limiteur qu'on ne peut éprouver qu'en production n'est pas
 * un limiteur, c'est une intention.
 */
export type Magasin = {
  set(cle: string, valeur: string, mode: 'EX', ttl: number, nx: 'NX'): Promise<string | null>;
  incr(cle: string): Promise<number>;
  expire(cle: string, ttl: number): Promise<number>;
};

/*
 * L'adresse est hachée avant de servir de clé.
 *
 * Redis garde ces clés en clair dans sa mémoire et dans ses journaux ; y
 * écrire les adresses de l'équipe reviendrait à publier l'annuaire du
 * marchand dans un service qui n'a aucune raison de le connaître. Le haché
 * suffit : on ne compare jamais que des égalités.
 */
export function cleAdresse(prefixe: string, email: string): string {
  const empreinte = createHash('sha256').update(email.trim().toLowerCase()).digest('hex');
  return `lien:${prefixe}:${empreinte.slice(0, 32)}`;
}

export type Verdict = { autorise: true } | { autorise: false; motif: 'delai' | 'plafond' };

/**
 * Peut-on envoyer un lien à cette adresse maintenant ?
 *
 * En cas de panne du magasin, on AUTORISE. Un lien de connexion est le seul
 * chemin d'entrée dans l'outil : refuser parce que Redis hoquette
 * verrouillerait dehors toute l'équipe, ce qui est pire que le risque qu'on
 * borne ici. L'appelant journalise la panne — un limiteur muet qui laisse tout
 * passer serait le pire des deux mondes.
 */
export async function lienAutorise(
  magasin: Magasin,
  email: string,
  journal?: (erreur: unknown) => void,
): Promise<Verdict> {
  try {
    const pose = await magasin.set(cleAdresse('court', email), '1', 'EX', DELAI_COURT_S, 'NX');
    if (pose !== 'OK') return { autorise: false, motif: 'delai' };

    const compte = await magasin.incr(cleAdresse('jour', email));
    // La durée de vie n'est posée qu'à la première incrémentation : la
    // reposer à chaque appel ferait glisser la fenêtre indéfiniment, et le
    // plafond journalier ne se réinitialiserait jamais pour qui insiste.
    if (compte === 1) await magasin.expire(cleAdresse('jour', email), FENETRE_JOUR_S);

    return compte > PLAFOND_JOUR ? { autorise: false, motif: 'plafond' } : { autorise: true };
  } catch (erreur) {
    journal?.(erreur);
    return { autorise: true };
  }
}
