import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

/*
 * Téléphone et tablette.
 *
 * CE QUE CES TESTS PROTÈGENT. L'outil se servait au doigt comme un site
 * d'ordinateur rétréci : un message touché s'ouvrait sous toute la liste,
 * hors de l'écran ; le menu dépassait de l'écran et c'était la page derrière
 * qui défilait ; les horloges couvraient tout ; l'en-tête prenait la moitié
 * de l'écran ; le titre disparaissait sur un iPad en paysage ; les boutons
 * faisaient vingt pixels de haut.
 */

const lire = (chemin: string) =>
  readFileSync(fileURLToPath(new URL(`../${chemin}`, import.meta.url)), 'utf8');

const app = lire('public/app.js');
const css = lire('public/styles.css');
const dashboard = lire('public/dashboard.html');
const telTab = css.slice(css.indexOf('   TÉLÉPHONE ET TABLETTE\n'));

const corps = (signature: string) => {
  const debut = app.indexOf(signature);
  assert.ok(debut >= 0, `${signature} introuvable`);
  return app.slice(debut, app.indexOf('\n}\n', debut) + 2);
};

test('un message touché prend l’écran quand liste et message s’empilent', () => {
  assert.match(app, /const PILE_TICKETS = window\.matchMedia\('\(max-width: 900px\)'\);/);
  // Une ligne touchée, ou un autre message ouvert depuis ailleurs.
  assert.match(app, /void selectTicket\(button\.dataset\.id\);\n\s+ouvrirMessagePile\(\);/);
  assert.match(corps('async function selectTicket('), /if \(!silent && autreTicket\) ouvrirMessagePile\(\);/);
  // La liste disparaît, le message et sa fiche restent.
  assert.match(telTab, /#view-tickets:not\(\.pile-message\) > #d-pane,\n\s+#view-tickets:not\(\.pile-message\) > \.context,/);
  assert.match(telTab, /#view-tickets\.pile-message > \.panel:first-child \{ display: none; \}/);
});

test('« ‹ Conversations », Retour d’Android et le geste d’iOS ramènent à la liste', () => {
  assert.match(dashboard, /<button class="th-retour" id="d-retour" type="button" aria-label="Retour aux conversations">/);
  const ouvrir = corps('function ouvrirMessagePile(');
  assert.match(ouvrir, /defilementListe = scrollY;/);
  assert.match(ouvrir, /history\.pushState\(\{ csavMessage: true \}, ''\);/);
  const fermer = corps('function fermerMessagePile(');
  assert.match(fermer, /if \(!parHistorique && history\.state\?\.csavMessage\) history\.back\(\);/);
  assert.match(fermer, /scrollTo\(0, defilementListe\)/);
  assert.match(app, /addEventListener\('popstate', \(\) => fermerMessagePile\(\{ parHistorique: true \}\)\);/);
  // Changer d'écran referme le message ouvert.
  assert.match(app, /if \(view !== 'tickets'\) fermerMessagePile\(\);/);
});

test('le menu fait la hauteur de l’écran, défile seul, et la page attend', () => {
  assert.match(telTab, /\.side \{\n\s+align-self: stretch;\n\s+height: auto;\n\s+overscroll-behavior: contain;/);
  assert.match(telTab, /html:has\(#app-grid\.nav-open\),/);
  assert.match(telTab, /html:has\(\.backdrop\.open\) \{ overflow: hidden; \}/);
});

test('les horloges, au téléphone : une feuille compacte qui monte du bas', () => {
  const feuille = telTab.slice(telTab.indexOf('  .clockpop {'), telTab.indexOf('.clockpop::before'));
  assert.match(feuille, /position: fixed;/);
  assert.match(feuille, /bottom: calc\(8px \+ env\(safe-area-inset-bottom\)\);/);
  assert.match(feuille, /max-height: 75dvh;/);
  assert.match(feuille, /grid-template-columns: repeat\(3, minmax\(0, 1fr\)\);/);
  assert.match(telTab, /\.clockpop \.montre \{ zoom: 0\.78; \}/);
});

test('l’en-tête du téléphone tient sur une ligne, puis la recherche', () => {
  assert.match(telTab, /\.head \.clocks \.ckp \{ display: none; \}/);
  assert.match(telTab, /\.head \.head-gauche \{ flex: 1 1 0; min-width: 0; \}/);
  // Sur iPad en paysage et petit portable, le titre ne tombe plus à zéro.
  assert.match(css, /grid-template-columns: minmax\(var\(--cote, 9rem\), 1fr\) minmax\(220px, 480px\) minmax\(auto, 1fr\);/);
});

test('au doigt : des cibles touchables et des champs à 16 px', () => {
  const doigt = telTab.slice(telTab.indexOf('@media (pointer: coarse) {'));
  assert.match(doigt, /\.seg button,\n\s+\.seg2 button,/);
  assert.match(doigt, /#view-tickets \.folder,[\s\S]*\{ min-height: 36px; \}/);
  assert.match(doigt, /select,\n\s+textarea \{ font-size: max\(16px, 1em\); \}/);
  assert.match(css, /\.head \.head-search kbd,\n\s+\.side-search kbd \{ display: none; \}/);
  // La fenêtre de rédaction ne déborde plus du plus petit iPhone.
  assert.match(css, /\.compose-fields \{ grid-template-columns: minmax\(0, 1fr\); \}/);
});
