# Fresco Marché : liens vers les rayons et les fiches

Google ne trouvait presque aucun lien vers les fiches produit et les rayons de frescomarche.fr : 682 pages restaient « Détectée, actuellement non indexée » (Search Console, 09/10/2026).

## Ce qui est installé (13/10/2026)

Sur une **copie** du thème en ligne, non publiée : **« FM.V1 + liens SEO (13/10) »** (id `208548069701`), créée avec le CLI Shopify à partir de « FM.V1 - 09/26 + recherche mobile ». Le thème en ligne n'a pas été modifié.

| Fichier | Rôle |
|---|---|
| `sections/fm-rayons-liens.liquid` | « Nos rayons » au-dessus du pied de page : liens vers les rayons principaux, rayons vides masqués |
| `sections/fm-meme-rayon.liquid` + `snippets/fm-meme-rayon-carte.liquid` | Sur chaque fiche : « Dans le rayon … », 8 fiches du même rayon en liens HTML, sans prix. Section écrite le 23/09/2026 (thème « TEST SEO même rayon »), reprise telle quelle |
| `templates/product.json` | Ajoute la section « même rayon » sous la fiche |
| `sections/footer-group.json` | Ajoute « Nos rayons » avant le pied de page |

Rien d'autre n'a changé : le catalogue pro, l'accueil, le menu et le pied de page existant sont identiques.

## Avant / après (mesuré sur l'aperçu, comme Googlebot)

| Page | Avant | Après |
|---|---|---|
| Accueil | 0 lien vers un rayon | 13 liens vers les rayons |
| Fiche produit (banane, kiwi, oignon rouge, crémerie, épicerie…) | 0 à 2 liens vers d'autres fiches | 9 liens vers d'autres fiches du même rayon |
| Pages rayon | 16 produits par page et pagination | Inchangées, et maintenant reliées depuis toutes les pages |

Captures mobiles dans `captures/`. Les deux sections passent `theme-check` (l'outil de vérification de Shopify) sans erreur, et aucune erreur Liquid n'apparaît sur l'aperçu.

Incident corrigé pendant l'installation : après la duplication, le fichier `config/settings_schema.json` de la copie était vide. Il a été restauré à l'identique depuis le thème en ligne, et vérifié.

## Publier

1. Aperçu : https://frescomarche.fr/?preview_theme_id=208548069701 (vérifier une fiche et le bas de l'accueil).
2. Admin Shopify › Boutique en ligne › Thèmes › « FM.V1 + liens SEO (13/10) » › **Publier**.
3. Si le thème en ligne a été modifié entre-temps, ces changements ne sont pas dans la copie : il faut les refaire, ou recréer la copie.

## Après la publication : Search Console

1. **Inspection de l'URL** › `https://frescomarche.fr/collections/fruits` › **Demander l'indexation**. Même chose pour `legumes`, `cremerie`, `boucherie`, `epicerie-salee`, `epicerie-sucree`, `boissons`, `produits-du-monde`, `surgeles`, `charcuterie`. Environ dix par jour (quota de Google).
2. **Vérifier que Google voit les liens** : Inspection de l'URL › `https://frescomarche.fr/products/banane-fraiche` › **Tester l'URL en direct** › Afficher la page explorée › HTML : on doit y trouver `fm-meme-rayon` et `/collections/fruits`.
3. **Suivre** chaque semaine Pages › « Dans l'index » (doit monter) et « Détectée, actuellement non indexée » (doit baisser). Compter 2 à 6 semaines ; Google ne garantit aucun délai.
