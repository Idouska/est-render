import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

/*
 * Sélectionner, au téléphone, comme Mail sur iPhone.
 *
 * Une case vide sur chaque ligne, à côté du point bleu des non-lus, faisait
 * deux ronds par message pour un geste qu'on fait rarement. Les cases
 * n'apparaissent qu'après « Sélectionner » ; toucher une ligne la coche alors
 * au lieu de l'ouvrir ; « OK » referme le mode et décoche tout.
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

test('un bouton « Sélectionner » dans l’en-tête, au téléphone seulement', () => {
  const tete = dashboard.slice(dashboard.indexOf('<div class="queue-head">'), dashboard.indexOf('<nav class="folders"'));
  assert.ok(tete.indexOf('id="queue-select"') < tete.indexOf('id="queue-filter"'));
  assert.match(css, /\.qh-texte \{ display: none; \}\n@media \(max-width: 760px\) \{\n  #view-tickets \.queue-head \.qh-texte \{\n    display: inline-flex;/);
});

test('pas de cases tant qu’on n’a pas demandé à sélectionner', () => {
  assert.match(css, /#view-tickets:not\(\.en-selection\) \.qpick \{ display: none; \}/);
  assert.match(css, /#view-tickets:not\(\.en-selection\) \.qrow \.queue-item \{ padding-left: 26px; \}/);
  assert.match(app, /const TELEPHONE_FILE = window\.matchMedia\('\(max-width: 760px\)'\);/);
});

test('en mode sélection, toucher une ligne la coche ; « OK » décoche tout', () => {
  assert.match(app, /if \(enSelection\(\)\) return button\.closest\('\.qrow'\)\?\.querySelector\('\[data-pick\]'\)\?\.click\(\);\n\s+void selectTicket\(button\.dataset\.id\);/);
  const mode = corps('function modeSelection(');
  assert.match(mode, /bouton\.textContent = actif \? 'OK' : 'Sélectionner';/);
  assert.match(mode, /if \(!actif && state\.picked\.size\) clearPicked\(\);/);
  // Une action groupée terminée et un changement d'écran referment le mode.
  assert.match(app, /state\.picked\.clear\(\);\n\s+modeSelection\(false\);\n\s+await loadQueue\(\);/);
  assert.match(app, /ouvrirFiltres\(false\);\n\s+modeSelection\(false\);/);
});
