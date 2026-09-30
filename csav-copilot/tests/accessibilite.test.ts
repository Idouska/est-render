import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

/*
 * Lisible et cliquable — le plancher WCAG AA, tenu par la feuille elle-même.
 *
 * CE QUE CES TESTS PROTÈGENT. Trois défauts mesurés dans le navigateur le
 * 30 septembre, tous invisibles en développant :
 *
 *   1. Les encres de texte (`--ok-ink`, `--warn-ink`, `--crit-ink`) existaient,
 *      mais quarante-trois règles peignaient encore leur texte avec l'aplat :
 *      « Payée » à 3,35:1, « En transit » à 2,85:1, « Rembourser… » à 3,91:1.
 *      L'atelier, qui a sa propre feuille, n'avait même pas d'encre, et son
 *      gris atténué tombait à 3,02:1 sur son fond.
 *
 *   2. `.me span` pesait plus que `.avatar` : les initiales de l'utilisateur,
 *      grises sur l'accent, à 1,03:1 — un rond bleu vide, à toutes les
 *      largeurs.
 *
 *   3. Des cibles sous 24 px (WCAG 2.5.8), et des cases de sélection sans nom :
 *      un lecteur d'écran annonçait « case à cocher », sans dire laquelle.
 *
 * Les contrastes se calculent à partir des jetons réellement déclarés, thème
 * par thème, en rejouant la cascade : ils restent justes si une valeur change.
 */

const lire = (chemin: string) =>
  readFileSync(fileURLToPath(new URL(`../${chemin}`, import.meta.url)), 'utf8');

// Les commentaires citent le code qu'ils expliquent — `color: var(--ok)` y
// figure en toutes lettres. Les garder ferait signaler des règles fantômes.
const sansCommentaires = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');

const STYLES = sansCommentaires(lire('public/styles.css'));
const ATELIER = sansCommentaires(lire('public/workspace.css'));
const APP = lire('public/app.js')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/^\s*\/\/[^\n]*/gm, '');

interface Regle {
  selecteurs: string[];
  corps: string;
  ordre: number;
}

/** Les règles à plat, celles des @media comprises (le bloc le plus intérieur). */
function regles(css: string): Regle[] {
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m, ordre) => ({
    selecteurs: m[1].split(',').map((s) => s.trim().replace(/\s+/g, ' ')),
    corps: m[2],
    ordre,
  }));
}

const declarations = (corps: string) =>
  [...corps.matchAll(/(--[\w-]+|[a-z-]+)\s*:\s*([^;]+)/g)].map(([, nom, valeur]) => ({
    nom,
    valeur: valeur.trim(),
  }));

/* ------------------------------------------------ contraste, à la WCAG --- */

function luminance(hex: string): number {
  const h = hex.replace('#', '');
  assert.match(h, /^[0-9a-f]{6}$/i, `« ${hex} » n'est pas un hexadécimal à six chiffres`);
  const canal = (i: number) => {
    const v = parseInt(h.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * canal(0) + 0.7152 * canal(2) + 0.0722 * canal(4);
}

function ratio(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/**
 * La valeur d'un jeton pour un thème : parmi les blocs qui s'appliquent, la
 * spécificité la plus forte l'emporte, puis le dernier écrit. `:root` et
 * `[data-theme="dark"]` pèsent autant (0-1-0) — c'est l'ordre du fichier qui
 * tranche entre eux, et `:root[data-theme="dark"]` (0-2-0) passe devant.
 */
function jetons(css: string, blocs: Record<string, number>): Map<string, string> {
  const gagnants = new Map<string, { valeur: string; poids: number; ordre: number }>();
  for (const regle of regles(css)) {
    if (regle.selecteurs.length !== 1 || !(regle.selecteurs[0] in blocs)) continue;
    const poids = blocs[regle.selecteurs[0]];
    for (const { nom, valeur } of declarations(regle.corps)) {
      if (!nom.startsWith('--')) continue;
      const actuel = gagnants.get(nom);
      if (!actuel || poids > actuel.poids || (poids === actuel.poids && regle.ordre > actuel.ordre)) {
        gagnants.set(nom, { valeur, poids, ordre: regle.ordre });
      }
    }
  }
  return new Map([...gagnants].map(([nom, { valeur }]) => [nom, valeur]));
}

function verifiePaires(
  theme: Map<string, string>,
  encres: Record<string, string[]>,
  fonds: string[],
): string[] {
  const fautifs: string[] = [];
  for (const [encre, siens] of Object.entries(encres)) {
    for (const fond of [...fonds, ...siens]) {
      const [e, f] = [theme.get(encre), theme.get(fond)];
      assert.ok(e && f, `${encre} ou ${fond} n'est pas déclaré`);
      const r = ratio(e, f);
      if (r < 4.5) fautifs.push(`${encre} (${e}) sur ${fond} (${f}) : ${r.toFixed(2)}:1`);
    }
  }
  return fautifs;
}

/* ---------------------------------------------------------- les tests --- */

test("aucun texte n'est peint avec une couleur d'aplat", () => {
  // Un pictogramme se mesure à 3:1, pas à 4,5:1 : les deux icônes WhatsApp
  // gardent l'aplat, qu'elles tiennent. Rien d'autre.
  const PICTOGRAMMES = new Set(['.wa-icon', '.wa-btn svg']);
  const feuilles: [string, string, string[]][] = [
    ['styles.css', STYLES, ['ok', 'warn', 'crit']],
    ['workspace.css', ATELIER, ['ok', 'warn']],
  ];

  const fautifs: string[] = [];
  let couleurs = 0;
  for (const [nom, css, aplats] of feuilles) {
    const motif = new RegExp(`(?<![-\\w])color\\s*:\\s*var\\(\\s*--(${aplats.join('|')})\\s*\\)`);
    for (const regle of regles(css)) {
      couleurs += (regle.corps.match(/(?<![-\w])color\s*:/g) ?? []).length;
      if (!motif.test(regle.corps)) continue;
      const hors = regle.selecteurs.filter((s) => !PICTOGRAMMES.has(s));
      if (hors.length > 0) fautifs.push(`${nom} — ${hors.join(', ')}`);
    }
  }

  // Le lecteur de règles doit en avoir vu : zéro fautif sur zéro règle lue
  // ne prouverait rien.
  assert.ok(couleurs > 300, `seulement ${couleurs} déclarations « color » lues`);
  for (const icone of PICTOGRAMMES) {
    assert.ok(
      regles(STYLES).some((r) => r.selecteurs.includes(icone)),
      `l'exception « ${icone} » ne correspond plus à aucune règle : la retirer`,
    );
  }
  assert.deepEqual(
    fautifs,
    [],
    'Texte peint avec --ok, --warn ou --crit : prendre --ok-ink, --warn-ink ou --crit-ink.',
  );
});

test('les encres du tableau de bord tiennent 4,5:1, en clair comme en sombre', () => {
  const clair = jetons(STYLES, { ':root': 10 });
  const sombre = jetons(STYLES, { ':root': 10, '[data-theme="dark"]': 10, ':root[data-theme="dark"]': 20 });
  const encres = {
    '--ok-ink': ['--ok-soft'],
    '--warn-ink': ['--warn-soft'],
    '--crit-ink': ['--crit-soft'],
  };
  const fonds = ['--surface', '--sunk', '--inset', '--ground'];

  // Le sombre doit vraiment différer du clair : sans quoi le résolveur n'a lu
  // qu'un bloc, et le test vérifierait deux fois le même thème.
  assert.notEqual(sombre.get('--surface'), clair.get('--surface'));
  assert.notEqual(sombre.get('--ok-ink'), clair.get('--ok-ink'));

  assert.deepEqual(verifiePaires(clair, encres, fonds), [], 'thème clair');
  assert.deepEqual(verifiePaires(sombre, encres, fonds), [], 'thème sombre');
});

test('le blanc ne se pose que sur un aplat qui le porte, dans les deux thèmes', () => {
  // L'inverse du défaut précédent : du texte blanc SUR --crit donnait 3,91:1
  // — les pastilles rouges du menu, le message d'erreur.
  const blanc = /(?<![-\w])color\s*:\s*(#fff\b|#ffffff\b|white\b)/;
  const aplat = /background(?:-color)?\s*:\s*var\(\s*(--(?:ok|warn|crit|bad)[\w-]*)\s*\)/;
  const sombre = { ':root': 10, '[data-theme="dark"]': 10, ':root[data-theme="dark"]': 20 };
  const themes: [string, string, Map<string, string>][] = [
    ['styles.css, clair', STYLES, jetons(STYLES, { ':root': 10 })],
    ['styles.css, sombre', STYLES, jetons(STYLES, sombre)],
    ['workspace.css', ATELIER, jetons(ATELIER, { ':root': 10 })],
  ];

  const fautifs: string[] = [];
  let vus = 0;
  for (const [nom, css, theme] of themes) {
    for (const regle of regles(css)) {
      const fond = regle.corps.match(aplat)?.[1];
      if (!fond || !blanc.test(regle.corps)) continue;
      vus += 1;
      const valeur = theme.get(fond);
      assert.ok(valeur, `${fond} n'est pas déclaré (${nom})`);
      const r = ratio('#ffffff', valeur);
      if (r < 4.5) {
        fautifs.push(`${nom} — ${regle.selecteurs.join(', ')} : blanc sur ${fond} (${valeur}), ${r.toFixed(2)}:1`);
      }
    }
  }

  // Pastilles et erreur du tableau de bord, dans chaque thème, et la pastille
  // de l'atelier : cinq rencontres au moins, sans quoi le test ne lit rien.
  assert.ok(vus >= 5, `seulement ${vus} règles « blanc sur aplat » lues`);
  assert.deepEqual(fautifs, [], 'poser le blanc sur --crit-strong, pas sur --crit');
});

test("les encres de l'atelier tiennent 4,5:1 sur tous ses fonds", () => {
  const atelier = jetons(ATELIER, { ':root': 10 });
  const fonds = ['--card', '--paper', '--line-soft'];
  // Chaque encre sur les fonds où elle écrit. Le gris atténué se pose aussi
  // sur --brand-soft (le mode choisi) ; le rouge jamais — il y tomberait à
  // 4,49:1, et le jour où une règle l'y mettrait, c'est ici qu'il faudra
  // l'ajouter.
  const encres = {
    '--ink-mute': ['--brand-soft'],
    '--ok-ink': ['--ok-soft'],
    '--warn-ink': ['--warn-soft'],
    '--bad': ['--bad-soft'],
  };
  assert.deepEqual(verifiePaires(atelier, encres, fonds), []);
});

test("aucune règle n'atteint l'avatar par un `span` nu sous `.me`", () => {
  // L'avatar est un <span> de `.me` : `.me span` (0-1-1) l'emporte sur
  // `.avatar` (0-1-0), et lui impose son display et sa couleur.
  const fautifs = regles(STYLES)
    .flatMap((r) => r.selecteurs)
    .filter((s) => /(^|[\s>])\.me[\s>]+span$/.test(s));
  assert.deepEqual(fautifs, [], 'viser `.me-txt span`, qui ne contient que le rôle');

  const avatar = regles(STYLES).find((r) => r.selecteurs.includes('.avatar'));
  assert.ok(avatar, 'la règle `.avatar` a disparu');
  assert.match(avatar.corps, /display\s*:\s*inline-flex/);
  assert.match(avatar.corps, /(?<![-\w])color\s*:\s*var\(--on-accent\)/);
});

test('les cases de sélection de la file disent quel message elles cochent', () => {
  const cases = [...APP.matchAll(/<input type="checkbox" data-pick=[\s\S]*?\/>/g)].map((m) => m[0]);
  assert.equal(cases.length, 2, 'une case en liste, une en tableau');
  for (const html of cases) {
    assert.match(html, /aria-label="Sélectionner le message de \$\{esc\(/);
  }
  // En tableau, la case est enveloppée d'un label qui porte la cible.
  assert.match(APP, /<label class="qt-pickbox">\s*<input type="checkbox" data-pick=/);
});

test('les petites cibles de la file tiennent 24 px (WCAG 2.5.8)', () => {
  const toutes = regles(STYLES);
  const px = (valeur: string) => Number(valeur.match(/^(\d+(?:\.\d+)?)px$/)?.[1] ?? NaN);

  /** Toutes les dimensions données au sélecteur exact, @media comprises. */
  const dimensions = (selecteur: string, proprietes: string[]) =>
    toutes
      .filter((r) => r.selecteurs.includes(selecteur))
      .flatMap((r) => declarations(r.corps))
      .filter((d) => proprietes.includes(d.nom))
      .map((d) => ({ ...d, px: px(d.valeur) }));

  const exigences: [string, string[]][] = [
    ['.qpick', ['width', 'height']],
    ['.qread', ['width', 'height']],
    ['.side-fold', ['width', 'height']],
    ['.qt-pickbox', ['min-width', 'min-height']],
    ['.auto-toggle', ['min-height']],
  ];

  const fautifs: string[] = [];
  for (const [selecteur, proprietes] of exigences) {
    const vues = dimensions(selecteur, proprietes);
    for (const propriete of proprietes) {
      if (!vues.some((d) => d.nom === propriete)) fautifs.push(`${selecteur} : ${propriete} absent`);
    }
    for (const d of vues) {
      if (!(d.px >= 24)) fautifs.push(`${selecteur} : ${d.nom} ${d.valeur}`);
    }
  }
  assert.deepEqual(fautifs, []);
});

test('seuls les dossiers qui réclament un geste portent leur nombre', () => {
  // Exécutée, pas lue : la vraie `renderFolders`, avec une vraie boîte.
  const source = lire('public/app.js');
  const debut = source.indexOf('const FOLDERS = [');
  const corps = source.indexOf('function renderFolders(');
  const fin = source.indexOf('\n}\n', corps);
  assert.ok(debut > 0 && corps > debut && fin > corps, 'FOLDERS ou renderFolders introuvable');

  const rendre = (compteurs: Record<string, number>, courant = 'inbox') => {
    const barre = { innerHTML: '', querySelectorAll: () => [] };
    const state = { queueFolders: compteurs, queue: { folder: courant } };
    const esc = (s: unknown) => String(s);
    new Function('$', 'state', 'esc', `${source.slice(debut, fin + 2)}\nrenderFolders();`)(
      () => barre,
      state,
      esc,
    );
    return Object.fromEntries(
      [...barre.innerHTML.matchAll(/<button class="folder" data-folder="(\w+)"[^>]*?(?: title="([^"]*)")?>(.*?)<\/button>/g)].map(
        ([, cle, titre, contenu]) => [cle, { nombre: contenu.match(/folder-n">([^<]*)</)?.[1] ?? null, titre: titre ?? null }],
      ),
    );
  };

  const boite = rendre({ inbox: 5674, drafts: 367, sent: 353, archived: 18 });
  assert.deepEqual(boite, {
    inbox: { nombre: '5674', titre: null },
    drafts: { nombre: '367', titre: null },
    sent: { nombre: null, titre: '353 messages' },
    archived: { nombre: null, titre: '18 messages' },
  });

  // Le nombre reste consultable quand ce dossier est ouvert, et « 1 » ne
  // prend pas de s ; un dossier vide n'a ni nombre ni infobulle.
  const petite = rendre({ inbox: 0, drafts: 12000, sent: 1, archived: 0 }, 'sent');
  assert.equal(petite.drafts.nombre, '9999+');
  assert.equal(petite.sent.titre, '1 message');
  assert.deepEqual(petite.inbox, { nombre: null, titre: null });
  assert.deepEqual(petite.archived, { nombre: null, titre: null });
});

test('le tri se clique sur toute sa hauteur, et montre son focus', () => {
  const toutes = regles(STYLES);
  const corps = (selecteur: string) =>
    toutes.filter((r) => r.selecteurs.includes(selecteur)).map((r) => r.corps).join(';');

  assert.match(corps('.qsort select'), /align-self\s*:\s*stretch/);
  // `.qsort select:focus` retire l'outline : il faut que la pastille, elle,
  // se voie — sinon le clavier ne sait plus où il est.
  assert.match(corps('.qsort:has(select:focus-visible)'), /border-color\s*:\s*var\(--accent\)/);
});
