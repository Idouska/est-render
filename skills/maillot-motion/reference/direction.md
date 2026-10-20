# Direction artistique

Ces règles viennent des meilleures pratiques du motion design publicitaire et des
défauts réellement corrigés en construisant les modèles. Elles s'appliquent aux
textes que tu écris comme aux modèles que tu modifies.

## La structure d'une pub produit

Toutes les vidéos suivent le même arc, en 10 à 13 secondes :

| Moment | Rôle | Durée |
|---|---|---|
| Accroche | Dire en 1 à 3 mots pourquoi regarder | 0 à 2 s |
| Révélation | Le produit claque au temps fort | au temps 4 (2 s à 120 BPM) |
| Preuve | Ce qui le rend désirable : atouts, flocage, choix | 3 à 5 s |
| Offre | Prix, remise, code | 1 à 2 s |
| Action | Bouton, logo, image de fin tenue | au moins 2 s |

Moins de 6 s : on ne comprend pas l'offre. Plus de 15 s : on perd la moitié des gens
avant le prix.

## L'image 0 est la miniature

Sur Reels, TikTok et dans le fil, la première image s'affiche avant toute lecture.
Elle doit déjà montrer le produit et la première ligne d'accroche. Dans les modèles,
le produit est présent dès l'image 0, assombri et flou derrière l'accroche, puis il
claque au temps fort. Ne jamais commencer sur un écran vide ni sur un fondu au noir.

## Rythme

- **Tout est calé sur la grille des temps** (`ctx.B(n)`) : à 120 BPM, un temps dure
  0,5 s. Les titres claquent un par temps, les lettres du flocage une par croche,
  le code promo une lettre par double croche.
- **Quelque chose bouge sur chaque temps**, mais une seule idée principale à la
  fois. Le mouvement secondaire (flottement du maillot, halos, bandeau) garde
  l'image vivante pendant que le texte se lit.
- **Le temps fort** (temps 4) porte la révélation : éclair, coup de caméra, boom.
  Avec une vraie musique, choisis `musique.debut` pour que la montée y arrive.

## Mouvement

- **Ressorts, avec un dépassement minuscule au plus.** Les courbes molles et les rebonds
  font bas de gamme. Les ressorts nommés de `MM.SP` couvrent tous les cas : `texte`,
  `vif`, `claque`, `pop`, `doux`, `camera`.
- **Les entrées prennent leur temps, les sorties sont courtes et précoces**
  (0,16 s, avec flou). Deux textes ne doivent jamais se croiser à l'écran.
- **Flou de mouvement** : le rendu mélange 4 sous-images par image (obturateur à
  180°). Ne simule pas de flou à la main sur un objet qui bouge.
- **La caméra cadre l'information** : elle s'approche d'un atout ou du flocage,
  puis recule pour révéler l'ensemble. Le zoom est logarithmique et toujours amorti.
- **Continuité** : un objet qui change de rôle se transforme au lieu de disparaître.
  Exemple : le « -20 % » géant rétrécit et devient l'étiquette collée au maillot.

## Texte

- **Lisible sans le son et sur un téléphone** : 33 px au minimum sur une image de
  1080 de large (le contrôle le vérifie), et des titres bien plus grands.
- **Temps de lecture** : environ 0,3 s plus 0,2 s par mot, sans dépasser 2,2 s. Le
  contrôle signale tout texte qui reste stable moins longtemps.
- **Accroche** : 1 à 2 mots par ligne, jamais plus de 3 lignes. La dernière ligne
  prend la couleur d'accent.
- **Bouton** : un verbe court. Un seul bouton par vidéo.
- **Zones sûres** : en 9:16, ni texte ni logo dans les 14 % du haut ni dans les 30 %
  du bas (légende et boutons de l'application), ni dans les 12 % de droite (rail
  d'icônes). Le produit et les décors peuvent y déborder.

## Couleur et matière

- **Une seule couleur d'accent**, celle de la marque. Le reste en neutres sombres
  ou clairs.
- Fond : dégradé sombre, rayures fines, grain léger, deux halos de la couleur
  d'accent qui dérivent lentement. Cela donne de la profondeur sans distraire.
- Le maillot reste la seule grande zone de couleur saturée de l'image.

## Son

- **Chaque bruitage est placé par son pic**, pas par son début : le boom, le clic
  et le « caisse » du prix tombent exactement sur l'image.
- Un bruitage par événement visible, jamais plus. Pas de son sans mouvement.
- Mixage : la musique domine, les bruitages ponctuent. Volume final −14 LUFS.

## Ce qui est interdit

- Rebonds élastiques, explosions de particules, lueurs néon, dégradés arc-en-ciel.
- Plus d'une police de titre. Anton pour les titres, Barlow Condensed pour le texte.
- Du texte qui apparaît et disparaît avant d'avoir pu être lu.
- Des temps morts : plus d'un temps sans aucun mouvement avant l'image de fin.
- Des chiffres inventés présentés comme vrais : ventes, avis, stocks.
