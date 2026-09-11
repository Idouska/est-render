/**
 * Les nouveautés, telles que la console d'administration les présente.
 *
 * Écrites pour être TESTÉES, pas seulement lues : chaque entrée dit où la
 * trouver et comment l'essayer — de préférence en mode test, qui laisse
 * cliquer jusqu'au dernier bouton sans rien envoyer.
 *
 * Une entrée par mise en ligne, ajoutée avec elle, la plus récente en tête.
 * Le numéro de PR relie chaque ligne à ce qui a réellement changé dans le
 * code ; un test vérifie qu'aucun n'est répété et que l'ordre est tenu.
 */

export type Public = 'Atelier' | 'Tableau de bord' | 'Les deux' | 'Console';

export interface Nouveaute {
  pr: number;
  /** Jour de la mise en ligne, AAAA-MM-JJ. */
  date: string;
  pour: Public;
  titre: string;
  resume: string;
  ou: string;
  essayer: string[];
}

export const NOUVEAUTES: readonly Nouveaute[] = [
  {
    pr: 58,
    date: '2026-09-11',
    pour: 'Console',
    titre: 'Fonctionnalités par boutique, et cette liste de nouveautés',
    resume:
      'La console présente les nouveautés à tester, avec une case « Testé », et des interrupteurs par boutique : mode test, traitement en masse de l’atelier, page Ruptures de l’atelier. Une fonctionnalité éteinte disparaît de l’écran ET est refusée par le serveur.',
    ou: 'Console d’administration → Fonctionnalités, Nouveautés.',
    essayer: [
      'Éteindre « Traitement en masse » pour la boutique : chez l’atelier (⌘R), le choix « En masse » disparaît.',
      'Le rallumer : le choix revient.',
      'Cocher « Testé » sur une nouveauté : le compteur « À tester » baisse.',
    ],
  },
  {
    pr: 57,
    date: '2026-09-11',
    pour: 'Atelier',
    titre: 'Corriger un colis enregistré',
    resume:
      'Un crayon permet de corriger le numéro de suivi ou le transporteur d’un colis. Si le client avait déjà reçu l’ancien numéro, l’atelier confirme, et Shopify lui envoie le bon.',
    ou: 'Atelier → Suivi → le crayon, à côté de la corbeille.',
    essayer: [
      'Allumer le mode test.',
      'Cliquer sur le crayon d’un colis, changer le numéro, Enregistrer.',
      'Le message « Colis corrigé » s’affiche et la liste montre le nouveau numéro.',
    ],
  },
  {
    pr: 56,
    date: '2026-09-11',
    pour: 'Tableau de bord',
    titre: 'Le bandeau de couleur ne passe plus sous le menu',
    resume:
      'Avec une couleur de bandeau choisie, le haut de page glissait de quelques pixels sous le menu de gauche et sortait de l’écran sur téléphone. Il s’arrête désormais pile aux bords.',
    ou: 'Le haut de chaque page, quand une couleur est réglée dans Réglages → Fond de la zone haute.',
    essayer: ['Regarder le bord gauche du bandeau : il s’arrête au bord du menu, sans le chevaucher.'],
  },
  {
    pr: 55,
    date: '2026-09-11',
    pour: 'Tableau de bord',
    titre: 'Le numéro de l’atelier dans la fiche commande',
    resume:
      'La section « Colis » de la fiche montre aussi les numéros saisis par l’atelier, marqués « pas encore dans Shopify » et « test » s’il y a lieu. Le bloc d’actions ne dépasse plus à droite.',
    ou: 'Commandes → cliquer sur une commande.',
    essayer: ['Ouvrir une commande traitée par l’atelier : son numéro est dans la section « Colis ».'],
  },
  {
    pr: 54,
    date: '2026-09-11',
    pour: 'Atelier',
    titre: 'Glisser une feuille depuis « Une par une »',
    resume: 'Une feuille Excel glissée sur la liste des commandes fait basculer la page en « En masse » d’elle-même.',
    ou: 'Atelier → Commandes, en mode « Une par une ».',
    essayer: ['Glisser le fichier Excel sur la page : elle passe en « En masse » et lit le fichier.'],
  },
  {
    pr: 53,
    date: '2026-09-11',
    pour: 'Les deux',
    titre: 'Mode test',
    resume:
      'L’outil fonctionne normalement, mais rien ne sort : ni expédition, ni remboursement chez Shopify, ni e-mail aux clients ou aux fournisseurs. Un bandeau orange le rappelle sur toutes les pages.',
    ou: 'Réglages → Mode test (ou la section Fonctionnalités de cette console).',
    essayer: [
      'L’allumer : le bandeau orange apparaît, chez le marchand comme chez l’atelier.',
      'Faire un import en masse jusqu’au dernier bouton.',
      'Réglages → « Effacer les données de test », puis l’éteindre.',
    ],
  },
  {
    pr: 52,
    date: '2026-09-11',
    pour: 'Atelier',
    titre: 'Les colonnes de la feuille se reconnaissent à leur titre',
    resume:
      '« Num de commande », « tracking number », « N° commande »… sont compris. Une URL de suivi ou une colonne en plus sont ignorées, jamais prises pour le transporteur.',
    ou: 'Atelier → En masse, en déposant une feuille.',
    essayer: ['Déposer une feuille à quatre colonnes : les numéros sont lus, aucun transporteur n’est inventé.'],
  },
  {
    pr: 51,
    date: '2026-09-11',
    pour: 'Atelier',
    titre: 'Une par une ou en masse, et la feuille Excel glissée',
    resume:
      'Deux modes de traitement. En masse : coller ses colonnes ou déposer la feuille (.xlsx, .csv), relire l’aperçu ligne par ligne, puis enregistrer. Un numéro abîmé par Excel est refusé, avec l’explication.',
    ou: 'Atelier → Commandes → En masse.',
    essayer: [
      'Allumer le mode test.',
      'Déposer la feuille remplie : l’aperçu se lance tout seul.',
      'Cliquer « Enregistrer n colis (test) ».',
    ],
  },
  {
    pr: 50,
    date: '2026-09-10',
    pour: 'Tableau de bord',
    titre: 'Un dossier résolu reste visible, en vert',
    resume: 'Marquer une rupture comme résolue ne la fait plus disparaître : elle reste dans la liste, en vert.',
    ou: 'Ruptures de stock.',
    essayer: ['Marquer un dossier résolu : il reste affiché, avec la barre verte.'],
  },
  {
    pr: 49,
    date: '2026-09-10',
    pour: 'Les deux',
    titre: 'Trois couleurs au bord des ruptures',
    resume: 'Rouge : dossier créé. Orange : traité. Vert : classé. Même code des deux côtés.',
    ou: 'Ruptures de stock, chez le marchand et chez l’atelier.',
    essayer: ['Suivre un dossier du signalement au classement : la barre change de couleur.'],
  },
  {
    pr: 48,
    date: '2026-09-10',
    pour: 'Tableau de bord',
    titre: 'Les ruptures signalées par l’atelier arrivent dans la page Ruptures',
    resume: 'C’est l’atelier qui sait qu’un produit manque : son signalement apparaît directement chez le marchand.',
    ou: 'Ruptures de stock.',
    essayer: ['Signaler une rupture côté atelier : elle apparaît dans la page Ruptures du marchand.'],
  },
  {
    pr: 47,
    date: '2026-09-10',
    pour: 'Atelier',
    titre: 'La page Ruptures de stock de l’atelier',
    resume: 'L’atelier a sa propre page Ruptures, avec une pastille qui compte les dossiers ouverts, des deux côtés.',
    ou: 'Atelier → Ruptures.',
    essayer: ['Ouvrir la page Ruptures de l’atelier et vérifier la pastille dans le menu.'],
  },
  {
    pr: 46,
    date: '2026-09-10',
    pour: 'Tableau de bord',
    titre: 'Le cockpit compare à hier',
    resume: 'Chaque chiffre du jour est comparé à la même tranche horaire d’hier.',
    ou: 'Vue d’ensemble.',
    essayer: ['Lire l’écart sous chaque indicateur du jour.'],
  },
  {
    pr: 45,
    date: '2026-09-10',
    pour: 'Tableau de bord',
    titre: 'La console des ruptures de stock',
    resume: 'Les ruptures deviennent une console de travail : par produit, par phase, avec les dossiers ouverts d’abord.',
    ou: 'Ruptures de stock.',
    essayer: ['Parcourir les dossiers par phase et en classer un.'],
  },
  {
    pr: 44,
    date: '2026-09-10',
    pour: 'Tableau de bord',
    titre: 'Un message cliqué passe en lu',
    resume: 'Ouvrir un message l’éteint : il n’est plus en gras.',
    ou: 'SAV client.',
    essayer: ['Cliquer sur un message en gras : il passe en lu.'],
  },
  {
    pr: 43,
    date: '2026-09-10',
    pour: 'Tableau de bord',
    titre: 'Les délais de résolution au cockpit',
    resume: 'Le cockpit dit en combien de temps un dossier est réglé, pas seulement combien il y en a.',
    ou: 'Vue d’ensemble.',
    essayer: ['Lire l’indicateur de délai de résolution.'],
  },
  {
    pr: 42,
    date: '2026-09-10',
    pour: 'Tableau de bord',
    titre: 'Les fournisseurs en retard au cockpit',
    resume: 'Les fournisseurs qui n’ont pas répondu à temps apparaissent au cockpit ; « inconnu » ne se lit plus comme « zéro ».',
    ou: 'Vue d’ensemble.',
    essayer: ['Vérifier l’indicateur des fournisseurs en retard.'],
  },
  {
    pr: 41,
    date: '2026-09-10',
    pour: 'Tableau de bord',
    titre: 'Une seule recherche, tous les libellés visibles',
    resume: 'La zone du haut n’a plus qu’un champ de recherche, plus grand, et tous les libellés restent lisibles.',
    ou: 'SAV client, en haut de la page.',
    essayer: ['Chercher un client ou une commande depuis le champ unique.'],
  },
];
