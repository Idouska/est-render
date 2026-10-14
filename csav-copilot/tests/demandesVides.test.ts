import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

/*
 * Une liste de demandes vide s'affiche, au lieu de planter.
 *
 * CE QUE CES TESTS PROTÈGENT. `renderDemandes` lisait une variable `filter`
 * qui n'existait plus : dès qu'aucune demande ne passait le filtre, l'écran
 * Fournisseur et l'écran Modification levaient « filter is not defined » et
 * gardaient leur liste précédente. Le message de la liste vide dépend du
 * filtre de statut de l'écran appelant, qui le passe désormais en paramètre.
 */

const app = readFileSync(fileURLToPath(new URL('../public/app.js', import.meta.url)), 'utf8');
const debut = app.indexOf('function renderDemandes(');
const source = app.slice(debut, app.indexOf('\n}\n', debut) + 2);
const renderDemandes = new Function(`${source}; return renderDemandes;`)();

function afficherVide(statut: string) {
  const rows = { innerHTML: 'ancienne liste', querySelectorAll: () => [] };
  const compteur = { textContent: '3 demandes' };
  renderDemandes(rows, compteur, [], statut);
  return { rows, compteur };
}

test('sans demande en attente, l’écran le dit', () => {
  const { rows, compteur } = afficherVide('PENDING');
  assert.match(rows.innerHTML, /Aucune demande en attente — les fournisseurs sont à jour\./);
  assert.equal(compteur.textContent, '');
});

test('sans demande du tout, l’écran le dit aussi', () => {
  assert.match(afficherVide('').rows.innerHTML, /Aucune demande\./);
  assert.doesNotMatch(afficherVide('').rows.innerHTML, /en attente/);
});

test('chaque écran passe son filtre de statut', () => {
  assert.match(app, /renderDemandes\(\$\('changes-rows'\), \$\('changes-count'\), shown, filter\);/);
  assert.match(app, /renderDemandes\(\$\('sup-dem-rows'\), \$\('sup-dem-count'\), shown, filtre\.statut\);/);
});
