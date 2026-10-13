# Fresco Marché : liens vers les rayons et les fiches

Google ne trouvait presque aucun lien vers les fiches produit et les rayons de frescomarche.fr : 682 pages restaient « Détectée, actuellement non indexée ». Ces deux sections ajoutent ces liens, sans modifier aucun fichier existant du thème.

## Avant / après

| Où | Avant | Après |
|---|---|---|
| Pied de page (toutes les pages) | Aucun lien vers les rayons | « Nos rayons » : liens vers Fruits, Légumes, Crémerie, Boucherie, Volaille, Charcuterie, Poissonnerie, Surgelés, Épicerie salée, Épicerie sucrée, Boissons, Produits du monde, Arrivages Rungis, Consommables, Hygiène |
| Fiche produit | Aucun lien vers son rayon ; les produits similaires se chargent en JavaScript, que Google ne suit pas | Fil d'Ariane « Accueil › Fruits › Banane » et 8 produits du même rayon en liens HTML, sans prix |
| Pages rayon | Déjà bonnes : 16 produits par page et pagination | Inchangées |
| Catalogue pro, accueil, menu | — | Inchangés |

Un rayon vide n'apparaît pas dans le pied de page.

## Installation (10 minutes)

1. **Copie du thème.** Admin Shopify › Boutique en ligne › Thèmes › thème en ligne › ⋯ › **Dupliquer**.
2. **Ajouter les fichiers.** Sur la copie › ⋯ › **Modifier le code** › dossier `sections` › **Ajouter une section** :
   - nom `fm-rayons-liens`, puis remplace tout le contenu par `theme/sections/fm-rayons-liens.liquid` ;
   - nom `fm-rayon-produit`, puis remplace tout le contenu par `theme/sections/fm-rayon-produit.liquid`.
3. **Placer les sections.** Sur la copie › **Personnaliser** :
   - **Pied de page** › Ajouter une section › « FM - Liens rayons » ;
   - **Produits** (modèle par défaut) › Ajouter une section › « FM - Rayon du produit », juste sous la fiche.
   - Pour avoir le fil d'Ariane en haut de la fiche : ajoute une deuxième « FM - Rayon du produit » au-dessus de la fiche, décoche « Du même rayon » dans celle du haut et « Fil d'Ariane » dans celle du bas.
   - Si le bloc « produits similaires » actuel fait doublon, il peut être masqué.
4. **Vérifier l'aperçu** sur trois fiches (un fruit, un produit de crémerie, un produit du monde) et sur mobile.
5. **Publier** la copie.

## Après la publication : Search Console

1. **Inspection de l'URL** › `https://frescomarche.fr/collections/fruits` › **Demander l'indexation**. Même chose pour `legumes`, `cremerie`, `boucherie`, `epicerie-salee`, `boissons`, `produits-du-monde`, `surgeles`, `charcuterie`, `arrivages-rungis`. Environ dix par jour (quota de Google).
2. **Vérifier que Google voit les liens** : Inspection de l'URL › `https://frescomarche.fr/products/banane-fraiche` › **Tester l'URL en direct** › Afficher la page explorée › HTML : on doit y trouver `/collections/fruits` et des liens `/products/`.
3. **Suivre** chaque semaine Pages › « Dans l'index » (doit monter) et « Détectée, actuellement non indexée » (doit baisser). Compter 2 à 6 semaines ; Google ne garantit aucun délai.

## Contrôle qualité

Les deux sections passent `theme-check` (l'outil de vérification de Shopify) sans erreur ni avertissement.
