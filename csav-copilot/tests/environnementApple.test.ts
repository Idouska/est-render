import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

/*
 * L'environnement Apple, d'après la maquette du même nom.
 *
 * Le logo A dans l'onglet et sur la connexion ; la colonne d'une app du Mac,
 * le compte en pied ; une barre du haut qui ne garde que le titre, les heures,
 * la recherche et Actualiser ; des cadrans de montre ; des bulles qui
 * annoncent en fondu ce qui arrive.
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

test('le logo de l’outil dans l’onglet et sur la connexion', () => {
  assert.ok(existsSync(fileURLToPath(new URL('../public/logo.svg', import.meta.url))));
  const logo = lire('public/logo.svg');
  assert.match(logo, /<stop offset="0" stop-color="#4aa3ff"\/>/);
  assert.match(logo, /<path d="M24\.5 29\.5l5 5 10-10"/);
  for (const page of ['dashboard', 'login', 'admin', 'supplier', 'workspace']) {
    assert.match(lire(`public/${page}.html`), /<link rel="icon" type="image\/svg\+xml" href="\/static\/logo\.svg" \/>/, page);
  }
  assert.match(lire('public/login.html'), /<img class="gate-logo" src="\/static\/logo\.svg"/);
  // La boutique garde son logo en tête de colonne.
  assert.match(dashboard, /<span class="brand-mark" id="brand-mark">/);
});

test('la colonne colle au bord, le compte descend en pied', () => {
  assert.match(css, /@media \(min-width: 1081px\) \{\n  \/\*[^*]*\*\/\n  \.side \{\n    margin: calc\(-1 \* var\(--gouttiere, 8px\)\)/);
  // Le compte et son menu vivent dans la colonne, plus dans la barre du haut.
  const colonne = dashboard.slice(dashboard.indexOf('<aside class="side">'), dashboard.indexOf('</aside>'));
  for (const id of ['compte-btn', 'me-avatar', 'me-name', 'me-role', 'compte-menu', 'auto-refresh', 'logout']) {
    assert.ok(colonne.includes(`id="${id}"`), id);
  }
  const tete = dashboard.slice(dashboard.indexOf('<header class="head">'), dashboard.indexOf('</header>'));
  assert.doesNotMatch(tete, /id="logout"|id="auto-refresh"|class="me"/);
  // Le menu se ferme au clic à côté et à Échap.
  assert.match(app, /if \(\$\('compte-menu'\)\?\.hidden \|\| event\.target\.closest\('#compte'\)\) return;/);
  assert.match(app, /if \(event\.key !== 'Escape' \|\| \$\('compte-menu'\)\?\.hidden\) return;/);
});

test('la barre du haut : titre, heures, recherche, Actualiser', () => {
  const tete = dashboard.slice(dashboard.indexOf('<header class="head">'), dashboard.indexOf('</header>'));
  const rangs = ['id="view-title"', 'id="clocks"', 'id="head-search"', 'id="refresh"'].map((id) => tete.indexOf(id));
  assert.ok(rangs.every((r) => r > 0));
  assert.deepEqual([...rangs].sort((a, b) => a - b), rangs);
  // Shopify et Gmail ne parlent qu'en cas de panne.
  assert.match(app, /`<span class="conn-pill\$\{etat \? '' : ' conn-ok'\}"/);
  assert.match(css, /\.head \.conn-pill\.conn-ok \{ display: none; \}/);
  // Actualiser : une icône ; son libellé reste aux lecteurs d'écran.
  assert.match(css, /\.head \.head-tools #refresh-label \{\n  position: absolute;\n  width: 1px;/);
});

test('les heures : le sigle et l’heure, puis des cadrans de montre', () => {
  const heures = corps('function renderClocks(');
  assert.doesNotMatch(heures, /ckp-dot|<button/);
  assert.match(heures, /<span class="ckp-city">\$\{esc\(c\.short\)\}<\/span>/);
  // Une petite horloge les signale ; le plafond de 46 % de l'écran ne les
  // rogne plus ; au téléphone, elles prennent leur propre rangée.
  assert.match(heures, /\$\('clocks'\)\.innerHTML = icone \+ cityTimes\(now\)/);
  assert.match(css, /\.head \.clocks \{\n[^}]*flex: none;\n  max-width: none;/);
  assert.match(css, /\.head \.clocks \{ order: 20; flex: 1 1 100%; min-width: 0;/);
  // Les chiffres d'abord, comme la montre qui sert de modèle.
  assert.match(app, /return localStorage\.getItem\('csav\.clocks'\) === 'analog' \? 'analog' : 'digital';/);
  const panneau = corps('function renderClockPop(');
  assert.match(panneau, /<div class="montre\$\{aiguilles \? ' montre-aig' : ''\}\$\{c\.open \? '' : ' veille'\}" role="img"/);
  assert.match(corps('function cadranChiffres('), /<span class="montre-comp">\$\{ecartHoraire\(c\.offset\)\}<\/span>/);
  assert.match(corps('function cadranAiguilles('), /length: 60/);
  // Hors horaires, l'affichage s'éteint à moitié, le boîtier reste noir.
  assert.match(css, /\.montre\.veille > \* \{ opacity: 0\.6; \}/);
  assert.match(css, /font-family: "New York", ui-serif,/);
  assert.match(dashboard, /data-clockstyle="digital" aria-pressed="true">Chiffres<\/button>/);
});

test('les bulles : en fondu, cinq secondes, retenues au survol', () => {
  assert.match(app, /const BULLE_DUREE_MS = 5000;/);
  const annonce = corps('function annoncer(');
  assert.match(annonce, /requestAnimationFrame\(\(\) => bulleNotif\.classList\.add\('notif-visible'\)\);/);
  assert.match(annonce, /notifMinuteur = setTimeout\(fermerNotif, BULLE_DUREE_MS\);/);
  assert.match(corps('function fermerNotif('), /\}, 500\);/);
  assert.match(app, /bulleNotif\.addEventListener\('mouseenter', \(\) => clearTimeout\(notifMinuteur\)\);/);
  // Plusieurs nouvelles : une pile.
  assert.match(corps('function carteNotif('), /titre: messages \? `\$\{n\} nouveaux messages` : `\$\{n\} nouveautés`,/);
  // Entrée en 0,35 s, sortie en 0,5 s, sous la barre du haut.
  assert.match(css, /\.notif \{\n  position: fixed;\n  z-index: 200;\n  top: 62px;/);
  assert.match(css, /transition: opacity 0\.5s ease, transform 0\.5s ease;/);
  assert.match(css, /\.notif\.notif-visible \{\n  opacity: 1;\n  transform: none;\n  transition-duration: 0\.35s;/);
});

test('une arrivée, c’est un nouveau mail reçu — pas notre réponse, pas un filtre', () => {
  const guet = corps('function guetterArrivees(');
  // L'extrait du dernier mail REÇU : notre réponse ne le change pas.
  assert.match(guet, /const extrait = ticket\.messages\?\.\[0\]\?\.snippet \?\? '';/);
  assert.match(guet, /if \(!arriveesAmorcees \|\| !annoncerArrivees \|\| avant === extrait\) continue;/);
  assert.match(guet, /if \(estLu\(ticket\)\) continue;/);
  assert.match(guet, /> 15 \* 60_000\) continue;/);
  // Un changement de dossier ou de filtre ne s'annonce pas.
  assert.match(app, /const memeFile = !append && state\.queueSignature === signature;/);
  assert.match(app, /guetterArrivees\(data\.tickets \?\? \[\], \{ annoncerArrivees: memeFile \}\);/);
  // L'atelier : ses réponses et ses signalements, au fil des compteurs.
  assert.match(app, /guetterAtelier\(state\.supplierActivity, activity\);\n\s+state\.supplierActivity = activity;/);
  // Hors de l'écran SAV, l'annonce du serveur suffit à guetter.
  assert.match(app, /if \(state\.view !== 'tickets'\) \{\n\s+void guetterHorsFile\(\);/);
});
