---
name: maillot-motion
description: Fabrique des vidéos publicitaires animées (motion design) pour des maillots de foot et produits de la boutique, en MP4 prêts pour Reels, TikTok, Stories, fil Meta, YouTube et Google (9:16, 4:5, 1:1, 16:9), avec son synchronisé sur le tempo. Quatre modèles - lancement d'un nouveau maillot (drop), promotion ou code promo (promo), personnalisation nom et numéro (flocage), collection de plusieurs maillots (collection). Utilise ce skill dès qu'on demande une vidéo produit, une pub animée, un Reel, un TikTok, une story animée ou du motion design pour un maillot, une promo, un flocage ou une collection, même sans le mot « motion ». Pas pour animer l'interface d'un site ou d'une application.
---

# maillot-motion : vidéos produit animées

Le skill transforme une photo de maillot, un prix et quelques mots en une vidéo de 10 à 13 s.
Chaque image est calculée dans Chromium à partir du temps, puis encodée par ffmpeg, avec flou
de mouvement et son calé sur le tempo. Pas d'After Effects, pas de Remotion, pas de service payant.

Tu es le **directeur** : tu choisis le modèle, écris les textes, règles le rythme et vérifies le
résultat image par image. Tu ne livres jamais une vidéo que tu n'as pas regardée.

## Ce qu'il y a dans le dossier

| Chemin | Rôle |
|---|---|
| `scripts/render.mjs` | Rendu : contrôle des textes, planche, vidéos, son, vérification du MP4 |
| `scripts/audio.py` | Bruitages synthétisés, fond rythmique de maquette, analyse de tempo d'une musique |
| `templates/*.js` | Les quatre modèles : `drop`, `promo`, `flocage`, `collection` |
| `engine/motion.js` | Moteur : ressorts, caméra, zones sûres, contrôle automatique |
| `engine/ui.js` | Composants : fond, titre, produit, point d'intérêt, prix à rouleaux, bouton, pastille, bandeau, flocage |
| `exemples/*.json` | Un fichier de scène par modèle, et `marque.json` |
| `assets/demo/` | Maillots génériques (sans club ni marque) pour essayer sans photo |
| `fonts/` | Anton et Barlow Condensed (licence OFL, incluses) |
| `reference/` | Direction artistique, formats, son, droits, création d'un modèle |

Les chemins ci-dessous sont relatifs au dossier du skill : `skills/maillot-motion/` ou `.claude/skills/maillot-motion/`, selon la copie chargée.

## Prérequis

Node ≥ 20, Playwright avec Chromium, ffmpeg, Python 3 avec numpy. Vérifie en une commande :

```bash
node scripts/render.mjs exemples/drop.json --formats 9:16 --controle
```

Si Playwright manque : `npm i -D playwright && npx playwright install chromium`.

## Déroulé

### 1. Recueillir le minimum

Demande seulement ce qui manque, en une seule question groupée, et propose une valeur par défaut :

- **Le modèle** : nouveau maillot, promo, flocage ou collection (déduis-le de la demande si possible).
- **Le produit** : photo, nom, prix (et ancien prix s'il y a une remise). Pour le flocage, une
  photo **de dos**. Pour une collection, 2 à 6 produits.
- **Les formats** : par défaut `9:16` (Reels, TikTok, Stories) ; ajoute `4:5` pour le fil Meta,
  `1:1` et `16:9` pour YouTube ou Google.
- **La musique** : un fichier dont la boutique a les droits, ou rien (voir « Son »).

Où trouver les données :

- **Connecteur Shopify** disponible : récupère nom, prix, prix barré et URL des images avec
  ses outils produit, puis télécharge l'image en local (`curl -L -o …`). Le rendu refuse les URL.
- **Photo avec fond** : le modèle la montre dans une carte arrondie. C'est propre, mais un PNG
  **détouré** (fond transparent) rend bien mieux : reflet, ombre portée, flocage. Si le
  connecteur Canva est là, son outil de suppression d'arrière-plan fait l'affaire ; sinon,
  demande un PNG détouré.
- **Marque** : un `marque.json` partagé par toutes les vidéos (nom, logo, couleurs). Crée-le une
  fois, à partir des couleurs du site si l'utilisateur ne les donne pas, et réutilise-le.

### 2. Écrire le fichier de scène

Pars de l'exemple du modèle (`exemples/<modele>.json`) et crée le fichier **dans le projet de
l'utilisateur** (par exemple `videos/<nom>/video.json`), pas dans le dossier du skill. Les chemins
d'images sont relatifs au fichier de scène. Écris les textes toi-même :

- **Accroche** : 1 à 3 lignes de 1 à 2 mots, en majuscules visuelles, qui disent l'essentiel
  (« Nouveau / maillot / 26/27 », « Offre / flash », « Ton nom. / Ton numéro. »).
- **Atouts** (drop) : 3 faits vrais et visibles sur la photo, 2 à 3 mots chacun.
- **Bouton** : un verbe d'action court (« Commander », « J'en profite », « Je personnalise »).
- **Jamais** d'affirmation que la boutique ne peut pas prouver (« officiel », « livraison 24 h »,
  « -50 % » sans ancien prix réel). Voir `reference/droits.md`.

### 3. Contrôler avant de rendre

```bash
node scripts/render.mjs videos/maillot/video.json --controle
```

Le contrôle échantillonne la vidéo tous les 0,1 s et signale, pour chaque format :

- un texte hors **zone sûre** (sous l'interface Reels ou TikTok) ;
- deux textes qui se **chevauchent** ;
- un texte **trop petit** pour un téléphone ;
- un texte coupé ;
- un texte qui ne reste pas assez longtemps pour être **lu**.

Corrige chaque point avant d'aller plus loin. Le plus souvent, il suffit de raccourcir un texte.

### 4. Regarder la planche

```bash
node scripts/render.mjs videos/maillot/video.json --planche
```

Une image par temps musical, dans `sortie/<nom>-<format>-planche.png`. **Ouvre-la avec Read et
regarde-la vraiment** : image 0 (c'est la miniature), lisibilité, rien de vide ou d'écrasé,
l'enchaînement raconte bien « accroche → produit → preuve → prix → action ». Pour un instant
précis en pleine résolution : `--images 0,2.1,6.5`.

### 5. Brouillon, puis rendu final

```bash
node scripts/render.mjs videos/maillot/video.json --brouillon   # demi-résolution, ~20 s
node scripts/render.mjs videos/maillot/video.json               # final, ~1 min 30 par format
```

Le rendu final produit pour chaque format `sortie/<nom>-<format>.mp4` : H.264, 30 i/s, son AAC
normalisé à −14 LUFS, flou de mouvement. Il produit aussi `-video.png`, une planche tirée du MP4
lui-même. Regarde cette planche : c'est la preuve que le fichier encodé est bon.

Options utiles :

- `--formats 9:16,4:5` : choisir les formats.
- `--sans-musique` : bruitages seuls.
- `--sans-son` : vidéo muette.
- `--flou 2` : rendu plus rapide, flou de mouvement plus léger.
- `--sortie <dossier>` : dossier de sortie.
- `--travailleurs 4` : nombre de captures en parallèle.

### 6. Livrer

Donne les chemins des MP4 et de leurs planches, puis un compte rendu court :

- le modèle et les textes choisis ;
- les **choix de direction** que tu as faits seul, à valider (une ligne chacun) ;
- ce qui est **réel ou provisoire** : photo de démonstration, prix à confirmer ;
- l'**état du son** : musique sous licence, fond de maquette ou bruitages seuls. Précise que tu as
  mesuré le son mais que tu ne l'as pas écouté ;
- les **points de droits** à vérifier : logos, noms de joueurs, musique.

Sur claude.ai, envoie les fichiers à l'utilisateur. N'ajoute jamais les MP4 au dépôt git : ils
vont dans `sortie/`. Ajoute `sortie/` au `.gitignore` du projet s'il n'y est pas.

## Le fichier de scène

Champs communs :

```jsonc
{
  "modele": "drop",                 // drop | promo | flocage | collection
  "marque": "../marque.json",       // ou l'objet directement (voir plus bas)
  "formats": ["9:16", "4:5"],       // 9:16, 4:5, 1:1, 16:9
  "nom": "maillot-domicile",        // préfixe des fichiers produits (défaut : nom du fichier)
  "bpm": 120,                       // tempo de la grille ; pris sur la musique si elle est fournie
  "musique": { "fichier": "son.mp3", "debut": 12, "volume": 0.8, "decalage": 0 },  // ou false : aucun fond
  "zones_sures": { "9:16": { "b": 0.35 } },   // durcir une zone (fractions de l'image)
  "textes": { "accroche": ["Nouveau", "maillot", "26/27"], "cta": "Commander", "bandeau": false }
}
```

`marque.json` :

```json
{ "nom": "Ma Boutique", "logo": "logo.png",
  "couleurs": { "fond": "#0b0b0d", "fond2": "#1d2130", "texte": "#ffffff", "accent": "#d8ff3c", "accent_texte": "#0b0b0d" },
  "polices": { "titre": "MaPolice.ttf", "texte": "MaPoliceTexte.ttf" } }
```

Le logo est facultatif : sans logo, le nom est écrit en lettrage. Les polices sont facultatives.
Utilise une seule couleur d'accent, celle de la marque.

| Modèle | Champs propres | Durée à 120 BPM |
|---|---|---|
| `drop` | `produit` : `nom`, `club`, `saison`, `image`, `prix`, `prix_barre`, `detoure`.<br>`textes` : `atouts` (3 au plus ; texte simple, ou `{ "texte", "x", "y" }` pour placer le point sur la photo, en fractions de 0 à 1), `mention` (défaut « Produit authentique », ou `false`) | 12 s |
| `promo` | `promo` : `remise` (en %), `code`, `fin`.<br>`produits` : 1 à 4 objets `{ nom, image, prix, prix_promo }` (le prix remisé est calculé si `prix_promo` est absent).<br>`textes` : `code_label` | 11 s |
| `flocage` | `produit` : `nom`, `image_dos`, `prix`.<br>`flocage` : `nom`, `numero`, `couleur`, `prix`, `zone_nom` et `zone_numero` (`{x, y}` en fractions de la photo), `arc`, `taille_nom`, `taille_numero` | 12 s |
| `collection` | `produits` : 2 à 6 objets `{ nom, image, prix, prix_barre }`.<br>`textes` : `titre` | 7 s + 1 s par maillot |

À un autre tempo, toutes les durées suivent : à 128 BPM, le drop dure 11,25 s.

## Son

Sans musique fournie, la vidéo reçoit les bruitages et un **fond rythmique de maquette**
synthétisé. Le fond sert à juger le rythme, pas à publier. Pour publier :

- **Une musique sous licence** dans `musique.fichier`. Le script mesure son tempo, cale la
  vidéo sur un début de mesure à partir de `musique.debut` et place chaque bruitage sur la grille
  de la musique. Choisis le passage avec une montée qui arrive au temps 4, le temps fort.
- **Ou `--sans-musique`**, puis ajout de la musique dans l'outil de la plateforme : la
  bibliothèque de musiques de Meta, ou la Commercial Music Library de TikTok, autorisées en
  publicité.

Tous les bruitages sont synthétisés à partir de rien, donc libres de droits. Détails, liste des
sons et réglages : `reference/son.md`.

## Règles qui font la qualité

Résumé de `reference/direction.md`, à appliquer quand tu écris des textes ou modifies un modèle :

1. **L'image 0 est la miniature** : elle montre déjà le produit (assombri) et la première ligne.
2. **Une idée par temps**, et quelque chose bouge sur chaque temps. Le temps fort (temps 4)
   porte la révélation du produit.
3. **Ressorts, jamais de rebond mou** ; les sorties sont courtes et précoces, avec un flou.
4. **Chaque texte reste assez longtemps** pour être lu : le contrôle le vérifie.
5. **La vidéo se comprend sans le son** : la majorité des vidéos sont regardées muettes.
6. **Image de fin tenue au moins 2 s** : produit, prix, bouton, logo.
7. **Une seule couleur d'accent**, celle de la marque, et le reste en neutres.

## Droits : à respecter

Lis `reference/droits.md` avant de publier. L'essentiel :

- **Photos** : uniquement les tiennes ou celles fournies par la marque pour la revente. Pas de
  photos de joueurs ni d'images de matchs.
- **Logos Nike et écussons** : ils peuvent apparaître sur le produit authentique montré. Ils ne
  servent jamais de logo à la boutique, et la vidéo ne suggère aucun partenariat ni caractère
  « officiel ».
- **Flocage** : pas de nom de joueur réel dans une publicité sans droits. Utilise un prénom
  générique ou « TON NOM ».
- **Musique** : seulement avec une licence qui couvre la publicité.

## Créer ou modifier un modèle

`reference/nouveau-modele.md` décrit l'API du moteur (`MM.film`, `ctx`, `Track`, ressorts, caméra,
composants `ui.*`, sons, marquage `data-qa`) et la marche à suivre : copier le modèle le plus
proche, le régler avec `--planche` et `--controle`, puis rendre.

## Dépannage

| Symptôme | Cause probable | Solution |
|---|---|---|
| `Playwright est introuvable` | Pas installé dans ce projet | `npm i -D playwright && npx playwright install chromium` |
| `télécharge d'abord le fichier en local` | URL dans le fichier de scène | Télécharge l'image, mets le chemin local |
| Photo dans une carte arrondie | Photo non détourée | Fournis un PNG à fond transparent, ou force `"detoure": true` |
| Le flocage tombe à côté | Zones prévues pour un dos centré | Règle `flocage.zone_nom` et `zone_numero` (fractions de la photo), vérifie avec `--images` |
| Point d'atout mal placé | Positions par défaut | Donne `x` et `y` pour chaque atout dans `textes.atouts` |
| Tempo de la musique faux (moitié, double) | Morceau ambigu | Force `"bpm"` dans le fichier de scène |
| Rendu lent | 4 sous-images par image | `--flou 2`, ou `--brouillon` pour régler |
