# Décors photo générés par IA

Un décor remplace le fond dessiné par une photo : un tunnel de stade, un vestiaire, un
terrain de quartier. Le maillot reste **la photo produit d'origine**, posée par-dessus.

## La règle : l'IA ne touche jamais le maillot

Un générateur d'images redessine les écussons, les sponsors et les logos, et il le fait
mal. Un maillot généré a l'air d'une contrefaçon, ne correspond plus au produit vendu et
fait refuser l'annonce. Le skill sépare donc les deux rôles :

- **Le générateur ne reçoit que du texte.** Aucune photo de maillot ne lui est envoyée. Il
  produit un décor vide, sans produit.
- **Le moteur pose la photo détourée par-dessus**, sans la modifier : mêmes pixels, même
  écusson, mêmes sponsors.
- **Chaque décor a une fiche** (`<image>.json`) qui dit d'où il vient. Le rendu écrit
  `sortie/<nom>-provenance.json` : l'empreinte SHA-256 de chaque photo produit et de chaque
  décor, avec sa fiche. Il prévient si un décor n'a pas de fiche, ou s'il a été généré à
  partir d'images (`entrees`).

Ne jamais utiliser l'IA pour : générer ou retoucher le maillot, faire porter le maillot à
un mannequin généré (essayage virtuel), ou produire un plan où l'écusson est redessiné.

## Dans le fichier de scène

```jsonc
"decor": "decors/tunnel.jpg"          // une image pour tous les formats
// ou
"decor": {
  "9:16": "decors/tunnel-9x16.jpg",   // une image par format (4:5 peut reprendre la 9:16)
  "4:5": "decors/tunnel-9x16.jpg",
  "16:9": "decors/tunnel-16x9.jpg",
  "flou": 3,            // flou de profondeur, en px pour 1080 (défaut 2) : le maillot ressort
  "assombrir": 0.18,    // voile noir (défaut 0,35)
  "teinte": 0.12,       // voile de la couleur de fond de la marque (défaut 0,2)
  "saturation": 0.85,   // défaut 0,85
  "centre": [0.5, 0.42],// point de l'image gardé au centre (fractions)
  "mouvement": 0.06,    // lente avancée de caméra sur la durée (défaut 0,06)
  "parallaxe": 0.15,    // part des mouvements de caméra que suit le décor (défaut 0,15)
  "masques": [[0.36, 0.38, 0.68, 0.40]]  // zones à flouter fort (fractions de l'image)
}
```

Le décor remplace le fond de `drop`, `promo`, `flocage` et `collection`. Le modèle `match`
garde son stade dessiné. Le moteur ajoute par-dessus un vignettage et des bandes sombres
derrière les textes, puis le grain : le contrôle de lisibilité reste valable.

Définition : il faut au moins 1134 × 2016 px pour du 9:16 et 2016 × 1134 px pour du 16:9.
Le rendu prévient si l'image doit être agrandie plus de 1,5 fois.

## La fiche du décor

À côté de `tunnel-9x16.jpg`, écris `tunnel-9x16.json` :

```json
{
  "generateur": "Figma Weave",
  "modele": "Flux 3, 2K",
  "date": "2026-10-21",
  "entrees": [],
  "prompt": "Photorealistic empty stadium players' tunnel at night, …",
  "masques": [[0.36, 0.375, 0.68, 0.405]],
  "remarques": "Panneaux du fond avec faux logos : floutés."
}
```

`entrees` liste les images données au générateur : elle doit rester vide. Les `masques` de
la fiche suivent l'image : ils s'appliquent dans toutes les vidéos qui l'utilisent.

## Écrire le prompt

Toujours en anglais, avec ces exigences :

- **Lieu vide** : « empty », « no people ».
- **Rien d'écrit, aucune marque** : « no text, no letters, no numbers, no logos, no signs, no
  flags, no football shirts, no clothing, no brand marks ».
- **Un centre libre** : « the center of the frame is open, empty negative space ». Le maillot
  s'y pose.
- **Une lumière qui va avec la marque** : pour MyFootify, « warm orange light ».
- **Un rendu de cinéma** : « cinematic, shallow depth of field, moody, 35mm film look ».
- **Le format** : génère une image verticale et une horizontale plutôt que de recadrer.

Décors qui marchent pour des maillots : tunnel des joueurs de nuit, vestiaire en béton, terrain
de quartier sous la pluie, studio en béton avec une lumière rasante, tribune vide dans la brume.
Évite les vrais stades reconnaissables et les foules.

## Vérifier chaque décor avant usage

Les générateurs écrivent souvent un pseudo-texte ou de faux logos, même quand on le leur
interdit : sur les panneaux publicitaires, les enseignes, les maillots au loin. Ouvre l'image
en grand et inspecte les détails (`PIL` : `im.crop(...)`). Pour chaque zone suspecte, ajoute un
masque dans la fiche, ou régénère. Vérifie aussi :

- aucune personne, aucun visage ;
- aucun maillot, écusson ou drapeau ;
- pas de stade réel identifiable (architecture célèbre) ;
- une zone centrale assez calme pour le maillot.

## Générateurs disponibles

Le skill ne dépend d'aucun service : toute image JPG ou PNG convient. Dans une session Claude :

- **Figma Weave** (`weave_find_model` puis `weave_run_model`, modèle Flux 3 en `2k`) : renvoie
  une URL de l'image en pleine définition. Payant en crédits Weave : demande l'accord de
  l'utilisateur avec le coût avant chaque génération.
- **Canva** (`generate-image`) : la génération fonctionne, mais l'outil ne renvoie qu'une
  miniature. L'utilisateur doit télécharger l'image lui-même depuis Canva.
- **Une API comme muapi.ai, fal.ai ou Replicate**, avec la clé de l'utilisateur.

## Annonces : déclarer l'IA

Meta et TikTok peuvent afficher une mention « Info IA » sur les contenus photoréalistes générés
par IA, et la détectent parfois seuls à partir des métadonnées. Pour une boutique, ce n'est pas
un problème tant que le produit montré est réel. Garde le fichier de provenance : il prouve que
seul le décor est généré et que le maillot est la photo du produit vendu.
