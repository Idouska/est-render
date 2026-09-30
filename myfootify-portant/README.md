# Portant de maillots — le hero 3D de My Footify

La même animation que le hero de [bolapsd « The rail »](https://bolapsd-the-rail.web.app/),
avec les maillots de la boutique :

- les maillots pendent **de biais sur une barre chromée**, chacun sur son cintre,
  et se balancent doucement ; le tissu ondule, plus fort vers l'ourlet ;
- au **survol**, le maillot se tourne vers vous et les voisins s'écartent ;
- en **faisant glisser** le portant, les cintres glissent sur la barre avec de
  l'inertie (sur mobile, le portant défile) ;
- au **clic**, le maillot vient au premier plan avec sa fiche : prix, **Face / Dos**
  (on peut aussi le tourner au doigt), **tailles** (aperçu visuel de la taille),
  **Ajouter au panier** et **Voir le maillot** ;
- flèches, pastilles de couleur, clavier (← →, Échap), bouton pour couper le
  mouvement, et respect du réglage « réduire les animations » du téléphone.

## Comment les maillots deviennent des objets 3D

Rien à préparer à la main : chaque maillot est reconstruit **à partir de ses
photos produit**, dans le navigateur.

1. La photo de face est **détourée** : le fond blanc (ou gris uni) est retiré,
   y compris sur les maillots blancs (OM, Real Madrid), puis l'ombre portée
   sous l'ourlet.
2. La silhouette est **« gonflée »** pour donner au maillot une épaisseur de
   tissu, bords arrondis et poitrine légèrement bombée.
3. La photo de face habille l'avant, la **photo de dos** habille l'arrière.
   Sans photo de dos, l'arrière prend la couleur du maillot.

Ce travail tourne dans un *Web Worker* : la page reste fluide pendant le
chargement. Le portant se remplit par le centre.

## Installer dans Shopify

Trois fichiers à copier dans le thème, rien d'autre à installer :

| Fichier du dépôt | Où le mettre dans le thème |
| --- | --- |
| `shopify/assets/maillots-portant.js` | dossier **assets** |
| `shopify/assets/maillots-portant.css` | dossier **assets** |
| `shopify/sections/maillots-portant.liquid` | dossier **sections** |

1. **Boutique en ligne → Thèmes →** `…` à côté du thème → **Modifier le code**.
   (Faites-le d'abord sur une copie du thème : `…` → **Dupliquer**.)
2. Dans **assets**, *Ajouter un nouveau fichier* : `maillots-portant.js`, puis
   `maillots-portant.css`, et collez-y le contenu des fichiers du dépôt.
3. Dans **sections**, *Ajouter une nouvelle section* : `maillots-portant`, et
   remplacez son contenu par celui de `maillots-portant.liquid`.
4. **Personnaliser** → page d'accueil → **Ajouter une section → Portant de
   maillots**, remontez-la tout en haut, et choisissez la **collection**
   (ou les maillots un par un).

## Les photos

- **Face** : la photo principale du produit, comme aujourd'hui (maillot seul,
  à plat ou de trois quarts, sur fond blanc ou uni). Un PNG détouré marche
  aussi, et c'est le plus sûr pour un maillot blanc.
- **Dos** : la section prend la première photo dont le **texte alternatif**
  contient « vue de dos », « dos du maillot » ou « vue arrière ». C'est déjà le
  cas de la plupart des fiches (« Dos du maillot PSG 2026/27 domicile… »,
  « Maillot Real Madrid 2026/27 domicile — vue de dos »…).
- **Pour forcer une photo** (par exemple quand la photo principale est une photo
  portée) : créez deux métachamps produit dans **Paramètres → Données
  personnalisées → Produits**, de type *Fichier (image)* :
  `custom.portant_face` et `custom.portant_dos`. Remplis, ils passent avant le
  choix automatique.

## Réglages de la section

| Réglage | Rôle |
| --- | --- |
| Sur-titre, Titre, Mentions à droite | Les textes autour du portant (« La collection. », « Le portant », « Saison 2026/27 »). |
| Collection / Les maillots un par un | Ce qui est accroché. La liste, si elle est remplie, passe avant la collection. |
| Nombre de maillots | De 3 à 12 (9 par défaut). Au-delà de ce que l'écran peut montrer, le portant défile. |
| Couleurs | Fond, texte, accent (focus clavier). |

La section prend la police du thème.

## Voir la démo sans Shopify

`demo/index.html` accroche neuf maillots de la boutique (vraies photos, vrais
prix). Il faut la servir en HTTP, pas l'ouvrir en double-cliquant :

```bash
npx serve myfootify-portant
# puis http://localhost:3000/demo/
```

## Bon à savoir

- **Three.js** (0.170) est chargé depuis jsDelivr, uniquement par cette section.
- L'animation **se met en pause** quand le portant sort de l'écran ou que
  l'onglet est caché.
- **Sans WebGL**, ou si le script ne se charge pas au bout de 8 secondes, la
  section affiche une simple rangée de maillots cliquables.
- **Ajouter au panier** envoie le formulaire Shopify standard (`/cart/add`) et
  mène au panier. Si les maillots se personnalisent (flocage) sur la fiche
  produit, c'est **Voir le maillot** qu'il faut mettre en avant : il ouvre la
  fiche avec la taille déjà choisie.
- L'aperçu des tailles (S → XXL) agrandit le maillot à l'écran ; ce n'est pas un
  guide des tailles.
