import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

/*
 * La barre du haut en trois zones, une icône par écran, et l'outil d'un
 * téléphone à un écran de 32 pouces.
 */

const lire = (chemin: string) =>
  readFileSync(fileURLToPath(new URL(`../${chemin}`, import.meta.url)), 'utf8');

const app = lire('public/app.js');
const css = lire('public/styles.css');
const dashboard = lire('public/dashboard.html');

test('trois zones : le titre, la recherche au centre, les heures et les boutons à droite', () => {
  const tete = dashboard.slice(dashboard.indexOf('<header class="head">'), dashboard.indexOf('</header>'));
  const gauche = tete.slice(tete.indexOf('<div class="head-gauche">'), tete.indexOf('id="head-search"'));
  assert.match(gauche, /id="navtoggle"/);
  assert.match(gauche, /id="view-title"/);
  const droite = tete.slice(tete.indexOf('<div class="head-droite">'));
  for (const id of ['clocks', 'conn', 'refresh', 'head-lune', 'cc-btn']) assert.ok(droite.includes(`id="${id}"`), id);
  // La grille réserve à gauche la largeur de la droite : la recherche au milieu.
  assert.match(css, /grid-template-columns: minmax\(var\(--cote, 0px\), 1fr\) minmax\(220px, 480px\) minmax\(auto, 1fr\);/);
  assert.match(app, /if \(place >= 220\) tete\.style\.setProperty\('--cote', `\$\{cote\}px`\);/);
  // La droite ne se comprime jamais (sinon les heures passaient sous la recherche).
  assert.match(css, /\.head-droite \{ display: flex; align-items: center; justify-content: flex-end; gap: 4px; \}/);
  // Tablette et téléphone : la recherche puis les heures, chacune sur sa ligne.
  assert.match(css, /\.head-droite \{ display: contents; \}/);
  assert.match(css, /\.head \.head-search \{ order: 2; flex: 1 1 100%; \}/);
});

test('une icône par écran, jamais deux fois la même', () => {
  const debut = app.indexOf('const VIEW_META = {');
  const meta = app.slice(debut, app.indexOf('\n};\n', debut));
  const entrees = [...meta.matchAll(/^ {2}([a-z]+): \{(?:[^}]*?)icon: '([a-z]+)'/gms)]
    .filter(([bloc]) => !/hidden: true/.test(bloc))
    .map(([, vue, icone]) => [vue, icone]);
  const vues = new Map<string, string>();
  for (const [vue, icone] of entrees) {
    assert.ok(!vues.has(icone!), `${vue} reprend l'icône de ${vues.get(icone!)}`);
    vues.set(icone!, vue!);
  }
  assert.ok(entrees.length >= 18);
  // Un libellé par ligne, coupé proprement s'il est trop long.
  assert.match(css, /\.nav-item \.nav-label \{\n  flex: 1;\n  min-width: 0;\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;/);
});

test('les grands écrans : des colonnes plus larges, une largeur de lecture', () => {
  assert.match(css, /@media \(min-width: 1800px\) \{\n  \.workspace \{ --ws-col1: 390px; --ws-col3: 350px; \}/);
  assert.match(css, /#view-tickets #d-pane \{ padding-inline: max\(0px, calc\(\(100% - 1040px\) \/ 2\)\); \}/);
  // Réglages : côte à côte dès la tablette.
  assert.match(css, /@media \(min-width: 761px\) \{\n  \.reg-main \{ flex-basis: 420px; \}/);
});
