# Formats et livraison

## Les quatre formats

| Format | Taille | Zones sûres (haut, bas, gauche, droite) | Pour |
|---|---|---|---|
| `9:16` | 1080 × 1920 | 14 %, 30 %, 6 %, 12 % | Reels, Stories, TikTok, YouTube Shorts |
| `4:5` | 1080 × 1350 | 6 %, 8 %, 6 %, 6 % | Fil Instagram et Facebook |
| `1:1` | 1080 × 1080 | 6 %, 7 %, 6 %, 6 % | Fil, carrousels, Google |
| `16:9` | 1920 × 1080 | 7 %, 9 %, 5 %, 5 % | YouTube, Google (Demand Gen, Performance Max) |

Les zones sûres sont définies dans `engine/motion.js` (`FORMATS`). Elles ne
concernent que les éléments marqués `data-qa` : textes, prix, boutons, logo. Le
produit et le fond peuvent les déborder.

Les plateformes changent régulièrement leur interface. Ces valeurs sont des repères
courants, pas des spécifications officielles. Meta recommande parfois de laisser
35 % libres en bas des Reels : pour appliquer cette marge, ajoute au fichier de scène
`"zones_sures": { "9:16": { "b": 0.35 } }` et relance `--controle`.

## Fichier produit

| Paramètre | Valeur | Pourquoi |
|---|---|---|
| Conteneur | MP4, `+faststart` | La lecture démarre avant la fin du téléchargement |
| Vidéo | H.264 High, yuv420p, BT.709, CRF 17 | Accepté partout, sans dérive de couleur |
| Cadence | 30 i/s (`--fps` pour changer) | Le standard des réseaux sociaux |
| Flou de mouvement | 4 sous-images, obturateur à 180° | Mouvement naturel (`--flou`) |
| Son | AAC 192 kb/s, 48 kHz, −14 LUFS, crête ≤ −1,5 dBTP | Niveau habituel des plateformes, sans écrêtage |
| Taille | 8 à 20 Mo pour 12 s en 9:16 | Bien sous les limites des plateformes |

## Quel format pour quelle campagne

- **Meta (Instagram, Facebook)** : fournis `9:16` et `4:5`, puis laisse le
  placement automatique choisir. Le `1:1` sert de secours.
- **TikTok** : `9:16` uniquement.
- **Google** (Demand Gen, Performance Max, YouTube) : `16:9`, `1:1` et `9:16`.
  Performance Max fabrique ses propres vidéos si tu n'en fournis pas, et elles
  sont moins bonnes que les tiennes.
- **Shopify** (fiche produit, page d'accueil) : `1:1` ou `4:5`, sans son
  (`--sans-son`). La vidéo se lit en boucle et muette.

## Durées

| Modèle | 120 BPM | 128 BPM |
|---|---|---|
| drop | 12 s | 11,25 s |
| promo | 11 s | 10,3 s |
| flocage | 12 s | 11,25 s |
| collection (3 maillots) | 10 s | 9,4 s |

Plus le tempo est rapide, plus la vidéo est courte. Il vaut mieux accélérer le
tempo que retirer des temps.
