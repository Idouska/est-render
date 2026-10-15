import { ressembleAUneTaille } from '../shopify/declinaison.ts';

/**
 * Le détail d'un article signalé en rupture par l'atelier : l'écrire, le relire.
 *
 * Le signalement ne stocke pas ces champs en colonnes : il les écrit en clair
 * dans le premier message du ticket, ligne par ligne — « Article : …»,
 * « Taille : … ». C'est ce qui permet au marchand de le lire dans SAV client
 * comme n'importe quel message. La page des ruptures, elle, a besoin de ces
 * champs séparés : la taille dans sa colonne, la référence pour regrouper les
 * commandes qu'elle bloque.
 *
 * D'où ce module, qui détient les DEUX sens. Écrit à un endroit et relu à un
 * autre, le format divergerait au premier retouche de libellé — « Taille »
 * devenu « Pointure » d'un côté, et la page cesserait silencieusement de
 * trouver la taille, sans une erreur nulle part. Un seul fichier les tient,
 * et un test vérifie que ce qui s'écrit se relit.
 *
 * Les libellés restent en français quelle que soit la langue de l'atelier :
 * c'est la trace destinée au marchand, et c'est aussi la clé de relecture. Les
 * traduire casserait la seconde pour un gain nul — le marchand lit le français.
 */

export interface ArticleSignale {
  produit: string | null;
  couleur: string | null;
  taille: string | null;
  reference: string | null;
  quantite: number | null;
}

/** L'ordre compte : c'est celui dans lequel le marchand lit, du plus au moins décisif. */
const LIBELLES: [keyof ArticleSignale, string][] = [
  ['produit', 'Article'],
  ['couleur', 'Couleur'],
  ['taille', 'Taille'],
  ['reference', 'Référence'],
  ['quantite', 'Quantité'],
];

/** Les lignes à écrire, dans l'ordre, en omettant ce que l'atelier n'a pas rempli. */
export function lignesArticle(article: Partial<ArticleSignale>): string[] {
  return LIBELLES.flatMap(([cle, libelle]) => {
    const valeur = article[cle];
    // La vérité JavaScript, et non un test de nullité : c'est la règle exacte
    // qu'appliquait l'écriture d'origine (`produit ? … : null`). Une quantité
    // de zéro ou un champ vide sont omis — et la trace reste identique au
    // caractère près pour les signalements déjà en base.
    return valeur ? [`${libelle} : ${valeur}`] : [];
  });
}

/**
 * Relit le détail depuis le texte du signalement.
 *
 * La PREMIÈRE occurrence de chaque libellé l'emporte : le bloc structuré est
 * écrit avant la note libre. Si l'atelier tape plus bas « Taille : je ne sais
 * pas » dans sa note, c'est la taille du formulaire qui reste — celle qu'il a
 * saisie dans le champ prévu.
 *
 * Un champ absent vaut `null`, jamais une chaîne vide : la page doit pouvoir
 * dire « taille non précisée » plutôt qu'afficher une case blanche qui passe
 * pour une taille.
 */
export function lireArticle(texte: string | null | undefined): ArticleSignale {
  const lu: ArticleSignale = {
    produit: null,
    couleur: null,
    taille: null,
    reference: null,
    quantite: null,
  };
  if (!texte) return lu;

  for (const ligne of texte.split('\n')) {
    for (const [cle, libelle] of LIBELLES) {
      const prefixe = `${libelle} : `;
      if (lu[cle] !== null || !ligne.startsWith(prefixe)) continue;

      const valeur = ligne.slice(prefixe.length).trim();
      if (!valeur) continue;

      if (cle === 'quantite') {
        const nombre = Number.parseInt(valeur, 10);
        // Une quantité illisible n'est pas une quantité de zéro.
        lu.quantite = Number.isFinite(nombre) && nombre > 0 ? nombre : null;
      } else {
        lu[cle] = valeur;
      }
    }
  }

  /*
   * Les signalements écrits avant la correction du pré-remplissage ont rangé
   * la pointure dans « Couleur » — « Couleur : 45 1/3 ». Relue, elle reprend
   * sa place : une couleur qui a la forme d'une pointure, sans taille à côté,
   * est une taille.
   */
  if (lu.taille === null && ressembleAUneTaille(lu.couleur)) {
    lu.taille = lu.couleur;
    lu.couleur = null;
  }

  return lu;
}

/**
 * Le fournisseur qui a signalé, lu dans la clé du fil.
 *
 * La clé vaut `supplier:<fournisseur>:<commande>:<motif>`. L'identifiant de
 * commande est un GID Shopify — `gid://shopify/Order/123` — qui contient
 * lui-même des deux-points : on ne peut donc pas découper la clé en quatre.
 * Mais le fournisseur est le deuxième segment, et un identifiant cuid n'en
 * contient jamais : c'est le seul qu'on puisse lire sans ambiguïté.
 */
export function fournisseurDuFil(fil: string): string | null {
  if (!fil.startsWith('supplier:')) return null;
  const id = fil.split(':')[1];
  return id ? id : null;
}

/**
 * Les motifs qu'un atelier peut signaler, et comment le marchand les lit.
 *
 * `libelle` est la phrase de l'objet du ticket ; `court` tient dans une ligne
 * de la file, à côté du numéro de commande.
 */
export const MOTIFS_SIGNALEMENT = {
  PHONE: { libelle: 'Numéro de téléphone incomplet ou invalide', court: 'Téléphone' },
  ADDRESS: { libelle: 'Adresse incomplète ou incorrecte', court: 'Adresse' },
  STOCK: { libelle: 'Article indisponible', court: 'Rupture' },
  DAMAGE: { libelle: 'Article abîmé', court: 'Article abîmé' },
  OTHER: { libelle: 'Autre problème', court: 'Autre problème' },
} as const;

export type MotifSignalement = keyof typeof MOTIFS_SIGNALEMENT;

/** Le préfixe des fils ouverts par un atelier, et non par un client. */
export const PREFIXE_SIGNALEMENT = 'supplier:';

/**
 * Ce qu'un fil dit de son signalement, ou `null` pour un mail de client.
 *
 * Le motif est le DERNIER segment de la clé — la commande, au milieu, est un
 * GID qui contient lui-même des deux-points. Un motif inconnu se lit « Autre
 * problème » plutôt que de faire passer le fil pour un mail de client.
 */
export function signalementDuFil(
  fil: string | null | undefined,
  fournisseur: string | null = null,
): { motif: MotifSignalement; libelle: string; court: string; fournisseur: string | null } | null {
  if (!fil?.startsWith(PREFIXE_SIGNALEMENT)) return null;
  const dernier = fil.split(':').pop() ?? '';
  const motif = (dernier in MOTIFS_SIGNALEMENT ? dernier : 'OTHER') as MotifSignalement;
  return { motif, ...MOTIFS_SIGNALEMENT[motif], fournisseur };
}

/**
 * La note de l'atelier, sans l'en-tête que la route écrit au-dessus.
 *
 * Le premier message vaut « Signalé par X depuis l'atelier. », puis le détail
 * de l'article, puis la note libre. La page Fournisseur ne montre que ce que
 * l'atelier a écrit : l'en-tête répète le nom déjà affiché, et le détail de
 * l'article a ses propres champs.
 */
export function noteDuSignalement(texte: string | null | undefined): string | null {
  if (!texte) return null;
  const libelles = LIBELLES.map(([, libelle]) => `${libelle} : `);
  const lignes = texte
    .split('\n')
    .filter((ligne, rang) => !(rang === 0 && ligne.startsWith('Signalé par ')))
    .filter((ligne) => !libelles.some((prefixe) => ligne.startsWith(prefixe)));
  const note = lignes.join('\n').trim();
  return note || null;
}
