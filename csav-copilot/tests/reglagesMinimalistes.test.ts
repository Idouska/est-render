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
  const categories = [...page.matchAll(/class="reg-cat[^"]*" data-reg="(\w+)"/g)].map((m) => m[1]);
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

test('façon Réglages Système : la boutique en tête, une carte d’introduction par catégorie', () => {
  // La boutique tient la place du compte, avec son logo et son nom.
  assert.match(page, /class="reg-cat reg-compte" data-reg="boutique"/);
  assert.match(page, /<img id="reg-compte-img" alt="" hidden \/><b id="reg-compte-initiales">/);
  assert.match(app, /\['reg-compte-img', 'reg-compte-initiales'\],/);
  // Chaque catégorie s'ouvre sur sa carte : la boutique avec son logo, les
  // autres avec leur icône.
  for (const nom of ['boutique', 'connexions', 'assistant', 'test', 'acces', 'donnees']) {
    const debut = page.indexOf(`data-volet="${nom}"`);
    assert.ok(page.slice(debut, debut + 400).includes('class="reg-hero"'), nom);
  }
  // L'apparence se choisit sur trois vignettes, et les comptes ont leur icône.
  assert.match(page, /<span class="reg-vignette reg-vignette-sombre" aria-hidden="true">/);
  assert.match(app, /ico: 'shopify',/);
  assert.match(app, /ico: 'gmail',/);
  assert.match(page, /Données et confidentialité/);
});
