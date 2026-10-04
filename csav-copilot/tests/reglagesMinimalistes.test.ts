import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

/*
 * Les Réglages, à la manière d'un Mac.
 *
 * CE QUE CES TESTS PROTÈGENT. Une catégorie à la fois, choisie à gauche ;
 * l'Apparence en fait partie (plus d'écran « Palettes » à part) ; et plus de
 * bouton « Enregistrer » : chaque changement part tout seul.
 */

const lire = (chemin: string) =>
  readFileSync(fileURLToPath(new URL(`../${chemin}`, import.meta.url)), 'utf8');

const page = lire('public/dashboard.html');
const app = lire('public/app.js');

test('sept catégories, chacune avec son volet', () => {
  const categories = [...page.matchAll(/class="reg-cat" data-reg="(\w+)"/g)].map((m) => m[1]);
  assert.deepEqual(categories, ['boutique', 'apparence', 'connexions', 'assistant', 'test', 'acces', 'donnees']);
  for (const nom of categories) {
    assert.match(page, new RegExp(`class="reg-volet" data-volet="${nom}"`));
    assert.match(app, new RegExp(`\\n  ${nom}: \\['`));
  }
});

test('l’apparence vit dans les Réglages, plus dans un écran à part', () => {
  assert.doesNotMatch(page, /id="view-palettes"/);
  assert.doesNotMatch(app, /palettes: \{ icon:/);
  const volet = page.slice(page.indexOf('data-volet="apparence"'), page.indexOf('data-volet="connexions"'));
  for (const id of ['theme-seg', 'palette-swatches', 'clock-seg', 'topbg-color']) assert.match(volet, new RegExp(`id="${id}"`));
  // Un bouton marqué data-theme="dark" recevait les couleurs du thème sombre.
  assert.doesNotMatch(volet, /<button[^>]* data-theme=/);
});

test('plus de bouton Enregistrer : la saisie part toute seule', () => {
  assert.doesNotMatch(page, /id="set-save"|id="set-brand-apply"/);
  assert.match(app, /if \(ecrit && !adresse\) champ\.addEventListener\('input', \(\) => planifierReglages\(900\)\);/);
  assert.match(app, /champ\.addEventListener\('change', \(\) => planifierReglages\(ecrit \? 0 : 150\)\);/);
  // Le logo s'enregistre dès qu'il est choisi ou retiré.
  assert.match(app, /await enregistrerReglages\(\{ logo: pendingLogo \}\);/);
  assert.match(app, /await enregistrerReglages\(\{ logo: null \}\);/);
});
