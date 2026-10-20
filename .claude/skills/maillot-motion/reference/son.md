# Son

`scripts/audio.py` est appelé par `render.mjs`. On peut aussi le lancer seul.

## Bruitages

Tous sont synthétisés à partir de rien (numpy) : aucun échantillon, aucun droit à
gérer. Les modèles les placent avec `ctx.cue(t, type, { gain, pitch })`, où
`pitch` est un décalage en demi-tons.

| Type | Son | Usage dans les modèles |
|---|---|---|
| `impact` | Grave court et percussif | Titre qui claque, numéro de flocage |
| `boom` | Grave long avec cymbale | Temps fort, révélation du produit |
| `montee` | Souffle qui monte jusqu'à son pic | Juste avant le temps fort (son pic est à la fin) |
| `whoosh` | Souffle qui passe de gauche à droite | Volet de couleur, changement de produit |
| `swipe` | Petit souffle aigu | Rangement du produit, prix barré |
| `pop` | Petite bulle | Pastille, point d'intérêt, bouton qui apparaît |
| `tic` | Petit clic aigu | Chiffres qui défilent, lettres du code |
| `clic` | Appui puis relâchement | Appui sur le bouton |
| `tampon` | Coup mat | Lettre de flocage posée |
| `caisse` | Cloche claire | Prix qui s'arrête |
| `brillance` | Petites notes aiguës | Reflet qui passe sur le maillot |
| `coeur` | Battement de cœur (« boum-boum ») | Acte 1 du match : la tension |
| `projecteur` | Déclic lourd et bourdonnement électrique | Projecteur de stade qui s'allume |
| `braam` | Cuivres graves de bande-annonce | Chaque maillot qui entre en scène |
| `sifflet` | Coup de sifflet d'arbitre (calé sur son attaque) | Coup d'envoi |
| `foule` | Clameur de stade qui monte et retombe (pic au sommet) | Après le coup d'envoi |
| `tambour` | Tambour grave (taiko) | La montée avant le coup d'envoi |
| `aspiration` | Souffle qui monte jusqu'à l'impact (pic à la fin) | Juste avant chaque grand impact |
| `eclat` | Crépitement | Étincelles |

**Calage** : chaque son est décalé pour que **son pic** (le maximum de son
enveloppe sur 10 ms) tombe sur l'instant demandé. Sur le MP4 final, l'écart mesuré
est de moins d'une image (33 ms).

Pour refaire seulement le son d'une vidéo déjà rendue (nouvelle musique, autre volume),
sans recalculer l'image : `node scripts/render.mjs video.json --son-seulement`.

Pour écouter tous les sons à la suite :
`python3 scripts/audio.py catalogue --sortie essai.wav`.

## Fond musical

Trois possibilités, par ordre de préférence pour publier :

1. **Une musique sous licence**, dans `"musique": { "fichier": "…", "debut": 12, "volume": 0.8 }`.
   - Le script mesure le tempo et repère les débuts de mesure, là où la grosse caisse
     frappe le plus et où les accords changent.
   - La vidéo démarre sur le premier début de mesure après `debut`, et toute la grille
     des modèles suit ce tempo.
   - Choisis `debut` juste avant une montée, pour qu'elle arrive au temps 4.
   - Tempos conseillés : de 100 à 140 BPM. Au-delà, la détection peut prendre la
     moitié ou les deux tiers du tempo réel. Force alors `"bpm"` dans le fichier de scène.
2. **Pas de musique dans le fichier** (`--sans-musique`), puis ajout dans l'outil de la
   plateforme : la bibliothèque de musiques de Meta, ou la Commercial Music Library de
   TikTok, dont les titres sont autorisés en publicité. Les bruitages restent calés.
3. **Le fond de maquette** (le comportement par défaut), de deux sortes. Le modèle
   `match` reçoit une **nappe de bande-annonce** : un accord grave qui enfle jusqu'au
   temps fort, se coupe juste avant, puis reste tenu sous l'action. Les autres modèles
   reçoivent un **fond rythmique** : grosse caisse, claps,
   charleston, basse et cymbale au temps fort, à la vitesse de la vidéo. Il sert à
   juger le rythme. Il est propre et libre de droits, mais simple : ne le présente
   pas comme une musique finie.

Une musique trouvée « libre » sur Internet n'est pas forcément autorisée en
publicité. Vérifie la licence de chaque titre : certaines bibliothèques gratuites
mélangent des titres libres et des titres restreints.

## Mixage

Le mixage suit cinq étapes :

1. Bruitages × 0,85, musique × `volume` (ou fond de maquette × 0,55).
2. Fondu de sortie de 0,6 s.
3. Limitation douce (tangente hyperbolique), crête ramenée à 0,89.
4. Normalisation par ffmpeg (`loudnorm`) à −14 LUFS intégrés, en deux passes et en mode
   linéaire : un seul gain pour tout le film, donc les contrastes restent. Le silence avant
   un impact du modèle `match` reste à environ 15 dB sous l'impact. Un limiteur garde la
   crête sous −2,5 dBFS, parce que l'encodage AAC déborde d'environ 1 dB.
5. Mesure finale, affichée dans le résumé du rendu.

## Analyse seule

```bash
python3 scripts/audio.py analyse musique.mp3 --debut 12
# {"bpm": 124.0, "start": 12.58, "premier_temps": 0.12, "duree_fichier": 182.3, "confiance": 0.41}
```

Sur des morceaux de test de 92 à 140 BPM avec changements d'accords, le tempo
trouvé est exact et le début de mesure tombe à 1 ms près.

Sur un passage de batterie seule, rien ne distingue le temps 1 du temps 3. La grille
des temps reste juste, et les bruitages tombent sur les temps, mais le début de
mesure peut être décalé d'un ou plusieurs temps. Vérifie à l'écoute que la montée
arrive bien au temps 4. Sinon, ajoute `"decalage": 1` (ou 2, ou 3) dans `musique` pour
décaler le départ d'autant de temps.
