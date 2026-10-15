import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

/*
 * La fenêtre Filtres, d'après la maquette du même nom.
 *
 * Avant : une rangée entière au-dessus de la file — onze libellés, « 50 sur
 * 5923 », Libellés, Filtres, Plus récent, Liste/Tableau — et une fenêtre qui
 * s'ouvrait à droite, sur le message. Après : le filtre et le tri dans
 * l'en-tête Conversations ; une fenêtre sous le bouton, flèche comprise, qui se
 * lit comme un menu du Mac ; les filtres posés en jetons ; au téléphone, une
 * feuille qui monte du bas.
 */

const lire = (chemin: string) =>
  readFileSync(fileURLToPath(new URL(`../${chemin}`, import.meta.url)), 'utf8');

const app = lire('public/app.js');
const css = lire('public/styles.css');
const dashboard = lire('public/dashboard.html');

const corps = (signature: string) => {
  const debut = app.indexOf(signature);
  assert.ok(debut >= 0, `${signature} introuvable`);
  return app.slice(debut, app.indexOf('\n}\n', debut) + 2);
};

test('la rangée de filtres a disparu, tout passe dans l’en-tête Conversations', () => {
  for (const id of ['queue-bar', 'q-label-chips', 'q-count', 'q-filters-btn', 'q-labels-btn', 'q-sort', 'queue-search']) {
    assert.doesNotMatch(dashboard, new RegExp(`id="${id}"`), id);
    assert.ok(!app.includes(`$('${id}')`), `app.js s'adresse encore à #${id}`);
  }
  // Le titre, ce que contient la liste, le filtre puis le tri.
  const tete = dashboard.slice(dashboard.indexOf('<div class="queue-head">'), dashboard.indexOf('<nav class="folders"'));
  const rangs = ['class="queue-title"', 'id="queue-total"', 'id="queue-filter"', 'id="queue-sort"'].map((m) => tete.indexOf(m));
  assert.ok(rangs.every((r) => r > 0), JSON.stringify(rangs));
  assert.deepEqual([...rangs].sort((a, b) => a - b), rangs);
  // Les jetons vivent sous les dossiers.
  assert.ok(dashboard.indexOf('id="q-jetons"') > dashboard.indexOf('id="folders"'));
});

test('la fenêtre se lit comme un menu du Mac', () => {
  const rendu = corps('function renderFiltres(');
  // « Afficher » : un seul choix ; « Seulement » et les libellés : des cases.
  assert.match(rendu, /role: 'radio',\n\s+coche: state\.filter === statut,/);
  assert.match(rendu, /<p class="qf-section">Afficher<\/p>/);
  assert.match(rendu, /<p class="qf-section">Seulement<\/p>/);
  assert.match(rendu, /<p class="qf-section">Libellés<\/p>/);
  assert.match(app, /\['NEEDS_REVIEW', 'À valider'\],\n\s+\['DRAFT_READY', 'Brouillon prêt'\],/);
  assert.match(app, /\['unread', 'Non lus', 'UNREAD'\],\n\s+\['wismo', 'WISMO', 'WISMO'\],/);
  // Motif, Assigné et Boîte restent des menus locaux, dans la fenêtre.
  const fenetre = dashboard.slice(dashboard.indexOf('<div class="qf" id="qf"'), dashboard.indexOf('<!-- Mode test'));
  for (const id of ['q-intent', 'q-assignee', 'q-mailbox', 'q-reset']) assert.ok(fenetre.includes(`id="${id}"`), id);
  // La coche à gauche, la ligne entière à l'accent au survol.
  assert.match(css, /\.qf-ligne\[aria-checked="true"\] \.qf-coche::before \{ content: "✓"; \}/);
  assert.match(css, /\.qf-ligne:hover, \.qf-ligne:focus-visible \{\n  outline: none;\n  background: var\(--accent\);/);
});

test('la fenêtre s’ouvre sous son bouton, flèche comprise, jamais hors de l’écran', () => {
  const placer = corps('function placerFiltres(');
  assert.match(placer, /const gauche = Math\.max\(8, Math\.min\(bouton\.right \+ 14 - largeur, innerWidth - largeur - 8\)\);/);
  assert.match(placer, /fenetre\.style\.setProperty\('--fleche', `\$\{Math\.round\(bouton\.left \+ bouton\.width \/ 2 - gauche\)\}px`\);/);
  assert.match(css, /left: calc\(var\(--fleche, 50%\) - 7px\);/);
  // Posée à la racine de la page : la colonne de la file ne la rogne pas.
  assert.ok(dashboard.indexOf('<div class="qf" id="qf"') < dashboard.indexOf('<main class="workspace" id="view-tickets">'));
});

test('cocher ne referme pas la fenêtre ; un clic à côté, Échap et Terminé, si', () => {
  // La ligne cliquée est remplacée par le rendu : le chemin de l'événement
  // est lu tel qu'il était au départ.
  assert.match(app, /const chemin = event\.composedPath\(\);\n\s+if \(chemin\.includes\(\$\('qf'\)\) \|\| chemin\.includes\(\$\('queue-filter'\)\)\) return;/);
  assert.match(app, /\/\/ La fenêtre reste ouverte : on coche rarement une seule case\.\n\s+rafraichirFiltres\(\);/);
  assert.match(app, /if \(event\.key === 'Escape'\) \{\n\s+ouvrirFiltres\(false\);/);
  assert.match(app, /\$\('qf-ok'\)\?\.addEventListener\('click', \(\) => ouvrirFiltres\(false\)\);/);
  // Fenêtre ouverte, les raccourcis de la file se taisent : « e » ne clôt pas
  // le ticket de derrière.
  assert.equal(app.split("if (document.querySelector('.backdrop.open') || fenetreFiltresOuverte()) return;").length - 1, 2);
});

test('les filtres posés se voient en jetons, le bouton se remplit', () => {
  const poses = corps('function jetonsPoses(');
  for (const cle of ["'terme'", "'statut'", '`seul:${cle}`', '`libelle:${nom}`', "'intent'", "'assignee'", "'mailbox'"]) {
    assert.ok(poses.includes(`cle: ${cle}`), cle);
  }
  assert.match(corps('function renderJetons('), /bouton\.classList\.toggle\('qh-filtre-actif', jetons\.length > 0\);/);
  assert.match(css, /\.qh-filtre\.qh-filtre-actif \.qh-filtre-rond \{ fill: currentColor; \}/);
  // Le compte dit ce que contient la liste, en bleu quand elle est filtrée.
  assert.match(corps('function compteDeLaFile('), /if \(queueIsFiltered\(\)\) return `Filtrée · \$\{messages\}`;/);
  assert.match(css, /#view-tickets \.queue-count\.queue-count-filtree \{ color: var\(--accent-ink\); \}/);
});

test('effacer les filtres garde le dossier ouvert et le tri choisi', () => {
  assert.match(
    corps('function resetQueueFilters('),
    /state\.queue = \{ \.\.\.emptyQueueFilters\(\), folder: state\.queue\.folder, sort: state\.queue\.sort \};/,
  );
});

test('trier et présenter : un menu, sans le select qui le doublait', () => {
  assert.match(app, /const TRIS = \[\n\s+\['newest', 'Plus récent'\],/);
  const menu = dashboard.slice(dashboard.indexOf('id="queue-sort-menu"'), dashboard.indexOf('</span>', dashboard.indexOf('id="queue-sort-menu"')));
  assert.ok(menu.includes('id="qtri-liste"') && menu.includes('id="queue-view"'));
  assert.match(css, /@media \(max-width: 1100px\) \{\n[^}]*\.qtri-vue \{ display: none; \}/);
});

test('au téléphone, une feuille qui monte du bas, avec des interrupteurs', () => {
  assert.match(app, /const FEUILLE_FILTRES = window\.matchMedia\('\(max-width: 760px\)'\);/);
  const tel = css.slice(css.lastIndexOf('@media (max-width: 760px) {\n  .qf-voile {'));
  assert.match(tel, /\.qf \{\n\s+--qf-fond: #f2f2f7;\n\s+top: auto;\n\s+left: 0;\n\s+right: 0;\n\s+bottom: 0;/);
  assert.match(tel, /border-radius: 24px 24px 0 0;/);
  assert.match(tel, /\.qf-ligne\[aria-checked="true"\] \.qf-inter \{ background: #34c759; \}/);
  assert.match(tel, /animation: qf-monte 0\.34s/);
  // Effacer et Terminé dans l'en-tête de la feuille ; un geste vers le bas la referme.
  assert.match(dashboard, /<button type="button" class="qf-effacer" id="qf-effacer">Effacer<\/button>/);
  assert.match(dashboard, /<button type="button" class="qf-ok" id="qf-ok">Terminé<\/button>/);
  assert.match(app, /if \(ecart > 90\) ouvrirFiltres\(false\);/);
});
