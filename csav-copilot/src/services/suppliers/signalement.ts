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
