# Créer ou modifier un modèle

Un modèle est un fichier `templates/<nom>.js`. On le choisit avec `"modele": "<nom>"`.
Il est chargé dans une page Chromium après `engine/motion.js` et `engine/ui.js`.

## Le contrat

```js
(function () {
  const { SP, ui, lines, glide } = window.MM;

  MM.film({
    beats: 24, // durée en temps musicaux (ou ctx.duration = … dans build)
    async build(ctx) {
      // 1. Créer le DOM une seule fois, avec les composants ui.* ou MM.el.
      // 2. Programmer tous les mouvements à l'avance (pistes, caméra, sons).
      // Rien ne doit dépendre d'un état conservé entre deux images.
    },
  });
})();
```

`render.mjs` appelle ensuite `seek(t)` pour chaque sous-image, dans n'importe quel
ordre et dans plusieurs pages en parallèle. **Tout style doit donc se calculer à
partir de t seul.** Sont interdits : transitions et animations CSS, `setTimeout`,
`requestAnimationFrame`, `Math.random` (utilise `ctx.rng()`), et toute variable
modifiée pendant `seek`.

## `ctx`

| Champ | Contenu |
|---|---|
| `spec` | Le fichier de scène, avec les chemins d'images convertis en URL |
| `L` | Mise en page : `W`, `H`, `u` (1 % du petit côté), `portrait`, `wide`, `fmt`, `safe` (`x`, `y`, `w`, `h`, `cx`, `cy`, `r`, `b`) |
| `B(n)` | Instant du n-ième temps musical, en secondes |
| `beat` | Durée d'un temps (0,5 s à 120 BPM) |
| `back`, `world`, `hud` | Calques : fond (fixe), monde (suit la caméra), interface (coordonnées écran) |
| `cam` | Caméra : `frame(t, x, y, zoom, sp)`, `toScreen(t, x, y)` |
| `add(part)` | Ajoute un objet `{ seek(t) }` au film |
| `cue(t, type, { gain, pitch })` | Programme un bruitage (voir `son.md`) |
| `image(url)` | Charge une image (promesse), à utiliser avec `await` |
| `tempsFort` | À renseigner : instant de la révélation (cymbale du fond de maquette) |
| `duration` | À renseigner si la durée dépend du contenu (sinon `beats`) |
| `rng()` | Nombre pseudo-aléatoire, toujours le même d'un rendu à l'autre |

Règle de mise en page : on place les textes avec `L.safe` (zone sûre), et le produit
avec `L.W` et `L.H` (il peut déborder). On distingue trois cas :

- `L.fmt === '9:16'` : seul format à zone basse recouverte par l'interface, où l'on peut
  mettre un bandeau décoratif ;
- `side = !L.portrait && !(L.H / L.W > 1.1)` : 1:1 et 16:9, produit à gauche et texte à droite ;
- sinon (9:16 et 4:5) : produit au centre, texte au-dessus et au-dessous.

## Mouvement

- `new MM.Track(v0).to(t, v, SP.vif)` : la valeur part vers `v` à l'instant `t`, sur un
  ressort. On lit la valeur avec `.at(t)`, et on enchaîne les `to` autant qu'il faut.
- `.arrive(t, v, sp)` : la valeur atteint `v` à l'instant `t`, au lieu de partir à `t`.
- `MM.SP` : `texte` (sans dépassement), `vif`, `claque` (titres, prix), `pop` (petits
  éléments), `doux`, `camera`.
- `MM.vis(t, tin, tout)` donne `{ o, b, e, x }` : opacité, flou, progression d'entrée et
  de sortie. L'entrée suit un ressort ; la sortie est courte et précoce.
- `MM.put(node, { x, y, s, sx, sy, r, o, b, ax, ay })` : place le point d'ancrage
  (le centre par défaut) en (x, y).
- `MM.glide(t, t0, t1, a, b)` : passage doux de a à b entre deux instants.

## Composants (`MM.ui`)

| Composant | Rôle |
|---|---|
| `background(ctx, { halo, lumiere, rayures })` | Fond dessiné dans un canvas. Méthodes `.flash(t, force)` et `.wipe(t, couleur, sens)` |
| `title(ctx, lignes, { x, cy, maxW, size, tins, tout, flash })` | Lignes qui claquent ; la dernière prend la couleur d'accent |
| `text(ctx, str, { x, y, size, maxW, tin, tout, upper, titre, color })` | Une ligne ; `x` et `y` peuvent être des fonctions de t |
| `product(ctx, img, { h, x, y, start, floatFrom, detoure })` | Le maillot : pistes `x y s r o`, `.move(t, {…}, sp)`, `.shine(t)`, `.pointAt(t, fx, fy)`, `.screenAt(t, fx, fy)` |
| `callout(ctx, { product, fx, fy, label, tin, tout })` | Point, trait, étiquette |
| `price(ctx, { value, old, x, y, size, tin, roll })` | Prix à rouleaux et ancien prix barré |
| `odometer(ctx, { text, x, y, size, tin, roll, scale })` | Chiffres à rouleaux (« -20 % ») |
| `button(ctx, { text, x, y, size, tin, press: [t] })` | Bouton d'action, avec appui et onde |
| `badge(ctx, { text, icon, style, x, y, size, tin })` | Pastille (`accent`, `contour`, `sombre`, `clair`) |
| `logo(ctx, { x, y, h, tin })` | Logo de la marque, ou son nom en lettrage (à utiliser avec `await`) |
| `ticker(ctx, { text, y, size, tin })` | Bandeau défilant décoratif |
| `letters(ctx, str, { product, fx, fy, size, t0, step, arc })` | Lettres posées sur le maillot (flocage) |

Icônes disponibles : `fleche`, `panier`, `check`, `etoile`, `bouclier`, `camion`,
`horloge`, `tag`, `retour`. Toutes ont le même trait.

Les textes, pastilles, boutons et étiquettes se recalent seuls dans la zone sûre horizontale. Ils marquent leurs
textes `data-qa` pour le contrôle. Un élément créé à la main avec `MM.el` doit
recevoir `qa: 'texte'` (ou `'cta'`, `'logo'`, `'deco'`) pour être contrôlé.

## Performance

Le rendu se fait en logiciel, sans carte graphique. Ce qui coûte cher, et la parade
employée par le moteur :

- **Calques plein cadre** : dégradés, grain, filtres. Le fond est dessiné dans un seul
  canvas, à partir d'une image précalculée.
- **`filter: drop-shadow`** sur un objet qui bouge : l'ombre du produit est précalculée
  en image.
- **`mask-image`** : le reflet n'existe que pendant son passage.
- **`will-change: transform`** sur un élément que la caméra agrandit : le texte devient
  flou. Ne l'utilise jamais dans `world`.

Visé : moins de 150 ms par capture en 1080 × 1920. Pour mesurer, rends avec
`--images` et chronomètre.

## Marche à suivre

1. Copie le modèle le plus proche, puis décris son déroulé temps par temps dans le
   commentaire d'en-tête.
2. Crée `exemples/<nom>.json` avec les maillots de démonstration.
3. Itère avec `--controle`, puis `--planche`, en lisant les planches dans les quatre formats.
4. Rends un `--brouillon` pour juger le rythme à vitesse réelle, puis le rendu final.
5. Ajoute le modèle aux tableaux de `SKILL.md`.
