import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
// @ts-expect-error — module navigateur sans déclaration de types.
import { LANGS, STRINGS } from '../public/workspace.i18n.js';

/*
 * L'espace fournisseur, façon Apple.
 *
 * CE QUE CES TESTS PROTÈGENT. L'« Atelier » s'appelle désormais « Espace
 * fournisseur », dans ses trois langues et sur les boutons du marchand qui
 * l'ouvrent. Sur grand écran, la file des commandes et la commande choisie
 * tiennent côte à côte. Les transporteurs de l'atelier se choisissent d'un
 * clic. Et le nouveau style reste chez lui : le portail des agences partage
 * la même feuille.
 */

const lire = (chemin: string) =>
  readFileSync(fileURLToPath(new URL(`../${chemin}`, import.meta.url)), 'utf8');

const js = lire('public/workspace.js');
const html = lire('public/workspace.html');
const app = lire('public/app.js');
const css = lire('public/workspace.css');
const table = STRINGS as Record<string, Record<string, string>>;

/** La couche de la refonte, depuis son commentaire de tête, sans commentaires. */
const couche = css
  .slice(css.lastIndexOf('/*', css.indexOf('ESPACE FOURNISSEUR, FAÇON APPLE')))
  .replace(/\/\*[\s\S]*?\*\//g, '');

test('l’espace porte son nouveau nom, dans les trois langues', () => {
  assert.equal(table.fr!['head.crumb'], 'Espace fournisseur');
  assert.equal(table.en!['head.crumb'], 'Supplier space');
  assert.equal(table.zh!['head.crumb'], '供应商空间');
  assert.match(html, /<title>Espace fournisseur — commandes à préparer<\/title>/);
  // Les boutons du marchand qui ouvrent ou copient le lien suivent.
  assert.match(app, />Ouvrir l’espace fournisseur<\/button>/);
  assert.match(app, /Copier le lien de l’espace\n/);
  assert.doesNotMatch(app, /Copier le lien atelier|>Ouvrir l'atelier</);
});

test('chaque texte de l’accueil existe dans les trois langues', () => {
  // `parcel.err` n'est pas une clé : c'est le préfixe des messages d'erreur.
  const cles = new Set([...js.matchAll(/'(home\.[\w.]+|parcel\.recentCarriers)'/g)].map((m) => m[1]!));
  for (const cle of ['home.late', 'home.lateOne', 'home.order', 'home.orders', 'home.start', 'parcel.recentCarriers']) {
    assert.ok(cles.has(cle), `${cle} n’est plus appelée`);
  }
  for (const { code } of LANGS as Array<{ code: string }>) {
    assert.deepEqual([...cles].filter((cle) => typeof table[code]![cle] !== 'string'), [], `${code} : une clé absente`);
  }
});

test('l’accueil met le travail du jour en grand et les lots à côté', () => {
  for (const id of ['home-date', 'home-retard', 'home-hero', 'home-tuiles', 'home-liste', 'home-lots', 'home-col-lots']) {
    assert.match(html, new RegExp(`id="${id}"`), id);
  }
  const accueil = js.slice(js.indexOf('async function loadHome'), js.indexOf('function resumeDe('));
  // Zéro se lit en gris, sans gras.
  assert.match(accueil, /tuile\.n === 0 \? ' home-nul' : ''/);
  assert.match(css, /\.wsapp \.home-tuile\.home-nul b \{[^}]*font-weight: 400/);
  // La colonne des lots ne s'affiche que pour l'atelier qui en reçoit.
  assert.match(accueil, /\$\('home-col-lots'\)\.hidden = !parLots;/);
});

test('sur grand écran, la file et la commande choisie tiennent côte à côte', () => {
  assert.match(js, /const enColonnes = window\.matchMedia\('\(min-width: 1180px\)'\);/);
  const rendu = js.slice(js.indexOf('function renderOrders('), js.indexOf('function renderFocus('));
  assert.match(rendu, /<div class="ws-file">\$\{liste\}<\/div>\s*<div class="ws-guichet">\$\{focusMarkup\(shown\)\}<\/div>/);
  // En colonnes, une commande est toujours ouverte, et le plein écran ne
  // s'applique qu'en dessous.
  assert.match(rendu, /if \(colonnes && !state\.focus && shown\.length\)/);
  assert.match(rendu, /document\.body\.classList\.toggle\('ws-focus', Boolean\(state\.focus\) && !colonnes\);/);
  // « Liste » ne sert à rien quand la liste est déjà là.
  assert.match(css, /\.ws-colonnes \.wsapp \[data-back\] \{ display: none; \}/);
});

test('les transporteurs de l’atelier se choisissent d’un clic', () => {
  assert.match(js, /const CARRIERS_KEY = `ws\.carriers\.\$\{supplierId\}`;/);
  const recents = js.slice(js.indexOf('function recentCarriers('), js.indexOf('function recentCarriers(') + 500);
  assert.match(recents, /\.slice\(0, 4\)/);
  assert.match(js, /\$\{carrierChips\(saved\?\.carrier \?\? lastCarrier\(\)\)\}/);
  assert.match(js, /card\.querySelector\('\[data-field="carrier"\]'\)\.value = carrier\.dataset\.carrier;/);
});

test('le nouveau style reste chez l’espace fournisseur', () => {
  const selecteurs = [...couche.replace(/@media[^{]*\{/g, '').matchAll(/([^{}]+)\{[^{}]*\}/g)]
    .flatMap((m) => m[1]!.split(','))
    .map((s) => s.trim())
    .filter(Boolean);
  assert.ok(selecteurs.length > 100, `seulement ${selecteurs.length} sélecteurs lus`);
  // Le portail des agences charge la même feuille : rien ne doit l'atteindre.
  assert.deepEqual(selecteurs.filter((s) => !s.includes('.wsapp')), []);
});

test('au téléphone, la langue reste en haut, hors de la barre d’onglets', () => {
  // Un flou d'arrière-plan sur la barre en ferait le repère du choix de
  // langue, fixé en haut de l'écran : il tombait dans les onglets.
  assert.ok(couche.includes('.wsapp .wsnav'), 'la couche de la refonte est introuvable');
  assert.doesNotMatch(couche, /backdrop-filter/);
});
