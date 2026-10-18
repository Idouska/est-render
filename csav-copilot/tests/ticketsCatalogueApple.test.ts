import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
// @ts-expect-error — module navigateur sans déclaration de types.
import { LANGS, STRINGS } from '../public/workspace.i18n.js';

/*
 * Tickets et Catalogue de l'espace fournisseur, façon Apple.
 *
 * CE QUE CES TESTS PROTÈGENT. Sur grand écran, la liste des tickets et le
 * ticket ouvert tiennent côte à côte ; sur téléphone, la liste s'ouvre sur un
 * ticket plein écran. Un refus s'écrit sur place, jamais dans la boîte du
 * navigateur. Le catalogue se lit en grille, et la fiche d'un modèle se choisit
 * par couleur puis par taille — avec un repli sur la liste simple quand
 * Shopify ne nomme pas ses déclinaisons ainsi.
 */

const lire = (chemin: string) =>
  readFileSync(fileURLToPath(new URL(`../${chemin}`, import.meta.url)), 'utf8');

const js = lire('public/workspace.js');
const html = lire('public/workspace.html');
const css = lire('public/workspace.css');
const table = STRINGS as Record<string, Record<string, string>>;

/** Le corps d'une fonction de l'écran, de sa signature à son accolade finale. */
const corps = (signature: string) => {
  const debut = js.indexOf(signature);
  assert.ok(debut >= 0, `${signature} introuvable`);
  return js.slice(debut, js.indexOf('\n}\n', debut) + 2);
};

type Variante = { title: string; sku: string; availableForSale: boolean; inventoryQuantity: number | null };
type Fiche = (product: { title: string; vendor: string; image: null; variants: Variante[] }) => string;

/** La fiche, exécutée seule : textes en français, état de l'écran simulé. */
function fiche(etat: Record<string, unknown> = {}): Fiche {
  const source = ['function esc(', 'function ressembleAUneTaille(', 'function repartirDeclinaison(', 'function ficheMarkup(']
    .map(corps)
    .join('\n');
  const t = (cle: string, vars: Record<string, unknown> = {}) =>
    (table.fr![cle] ?? cle).replace(/\{(\w+)\}/g, (_, nom: string) => String(vars[nom] ?? ''));
  return new Function('t', 'state', `${source}\nreturn ficheMarkup;`)(t, etat) as Fiche;
}

const variante = (title: string, stock: number): Variante => ({
  title,
  sku: `REF-${title.replace(/\W+/g, '-')}`,
  availableForSale: stock > 0,
  inventoryQuantity: stock,
});

test('sur grand écran, la liste des tickets et le ticket ouvert tiennent côte à côte', () => {
  const rendu = corps('function renderTickets(');
  assert.match(rendu, /enColonnes\.matches && visibles\.length/);
  assert.match(rendu, /class="tk-split"/);
  assert.match(rendu, /class="tk-file"/);
  assert.match(rendu, /class="tk-detail">\$\{enteteDeTicket\(choisi\)\}\$\{choisi\.html\}/);
  // Le ticket qui quitte la liste cède sa place au suivant.
  assert.match(rendu, /visibles\.find\(\(item\) => item\.id === state\.tk\.choisi\) \?\? visibles\[0\]/);
  // Chaque ticket a un identifiant stable, par source.
  for (const prefixe of ['upd:', 'rup:', 'sig:']) assert.match(js, new RegExp(`id: \`${prefixe}\\$\\{`), prefixe);
});

test('sur téléphone, la liste s’ouvre sur un ticket plein écran, et revient', () => {
  const rendu = corps('function renderTickets(');
  assert.match(rendu, /const ouvert = enColonnes\.matches \? null : visibles\.find\(\(item\) => item\.id === state\.tk\.ouvert\)/);
  assert.match(rendu, /classList\.toggle\('tk-plein', Boolean\(ouvert\)\)/);
  assert.match(rendu, /data-tk-retour="1"/);
  // Plus de cartes empilées : la liste seule.
  assert.doesNotMatch(rendu, /tk-item/);
  // Toucher l'onglet ramène à la liste.
  assert.match(corps('function setView('), /if \(view === 'tickets' && state\.tk\) state\.tk\.ouvert = null;/);
  assert.match(css, /\.wsapp \.tk-plein > \.wshead,/);
});

test('le type se choisit dans un menu, pas dans une rangée de boutons', () => {
  assert.match(corps('function renderTickets('), /<select data-ttype-select>/);
  assert.match(js, /\$\('tk-types'\)\?\.addEventListener\('change'/);
  // Le statut court sur téléphone, le long ailleurs.
  assert.match(html, /<span class="tk-long" data-t="tk\.waiting">/);
  assert.match(html, /<span class="tk-court" data-t="tk\.waitingShort">/);
});

test('un refus s’écrit sur place, et jamais sans motif', () => {
  const cablage = corps('function cablerTickets(');
  assert.doesNotMatch(cablage, /prompt\(/);
  assert.match(cablage, /<form class="upd-raison">/);
  assert.match(cablage, /toast\(t\('updates\.needWhy'\), true\)/);
  assert.match(cablage, /respond\(button\.dataset\.refuse, 'REFUSED', champ\.value\.trim\(\)\)/);
});

test('le catalogue a son résumé, son filtre de disponibilité et son choix de marque', () => {
  for (const id of ['catalog-resume', 'catalog-outils', 'catalog-dispo', 'catalog-marque']) {
    assert.match(html, new RegExp(`id="${id}"`), id);
  }
  for (const dispo of ['tous', 'stock', 'epuise']) assert.match(html, new RegExp(`data-dispo="${dispo}"`), dispo);
  const rendu = corps('function renderCatalog(');
  // Un stock non suivi n'est pas un stock vide.
  assert.match(js, /const estEpuise = \(item\) => item\.totalInventory === 0;/);
  // Une seule marque : pas de menu.
  assert.match(rendu, /\$\('catalog-marque-choix'\)\.hidden = marques\.length < 2;/);
  assert.match(rendu, /class="cat-split">\$\{grille\}<aside class="cat-fiche"/);
});

test('la fiche se lit par couleur, puis par taille, avec la référence de la taille choisie', () => {
  const rendu = fiche()({
    title: 'Derby Arlo',
    vendor: 'Atelier Sud',
    image: null,
    variants: [variante('Noir / 42', 0), variante('Noir / 43', 2), variante('Noir / 44', 6), variante('Cognac / 42', 3)],
  });
  // Deux couleurs, la première ouverte.
  assert.match(rendu, /data-cat-couleur="Noir" aria-pressed="true"/);
  assert.match(rendu, /data-cat-couleur="Cognac" aria-pressed="false"/);
  // Les tailles de la couleur, chacune avec son stock.
  assert.match(rendu, /class="fiche-taille fiche-vide" data-cat-taille="42"/);
  assert.match(rendu, /class="fiche-taille fiche-peu" data-cat-taille="43" aria-pressed="true"><b>43<\/b><span>2 restantes<\/span>/);
  assert.match(rendu, /data-cat-taille="44" aria-pressed="false"><b>44<\/b><span>6 en stock<\/span>/);
  // Les tailles de l'autre couleur attendent qu'on la choisisse.
  assert.equal(rendu.match(/data-cat-taille=/g)?.length, 3);
  // La première taille en stock donne sa référence.
  assert.match(rendu, /<dd class="mono">REF-Noir-43<\/dd>/);
  assert.match(rendu, /2 couleurs · 42–44 · 11 en stock/);
});

test('la taille choisie reste choisie, et une taille épuisée le dit', () => {
  const rendu = fiche({ catalogCouleur: 'Noir', catalogTaille: '42' })({
    title: 'Derby Arlo',
    vendor: 'Atelier Sud',
    image: null,
    variants: [variante('Noir / 42', 0), variante('Noir / 43', 2)],
  });
  assert.match(rendu, /data-cat-taille="42" aria-pressed="true"/);
  assert.match(rendu, /<dd class="fiche-ref-vide">épuisé<\/dd>/);
});

test('sans tailles nommées, la fiche retombe sur la liste simple', () => {
  const rendu = fiche()({
    title: 'Cirage',
    vendor: 'Atelier Sud',
    image: null,
    variants: [variante('Incolore', 4), variante('Noir', 0)],
  });
  assert.doesNotMatch(rendu, /fiche-tailles/);
  assert.match(rendu, /class="varr"/);
  assert.match(rendu, /class="varr out"/);
});

test('chaque texte des Tickets et du Catalogue existe dans les trois langues', () => {
  const cles = [
    'tk.typeLabel',
    'tk.waitingShort',
    'updates.whyLabel',
    'catalog.summary',
    'catalog.availability',
    'catalog.dispo.tous',
    'catalog.dispo.stock',
    'catalog.dispo.epuise',
    'catalog.brand',
    'catalog.allBrands',
    'catalog.soldOutTag',
    'catalog.colors',
    'catalog.colorsOne',
    'catalog.color',
    'catalog.sizes',
    'catalog.left',
    'catalog.leftOne',
    'catalog.ref',
    'catalog.stockLabel',
  ];
  // Les trois disponibilités passent par un gabarit : `catalog.dispo.${…}`.
  assert.match(js, /t\(`catalog\.dispo\.\$\{bouton\.dataset\.dispo\}`\)/);
  for (const cle of cles.filter((cle) => !cle.startsWith('catalog.dispo.'))) {
    assert.ok(js.includes(`'${cle}'`) || html.includes(`"${cle}"`), `${cle} n’est plus appelée`);
  }
  for (const { code } of LANGS as Array<{ code: string }>) {
    assert.deepEqual(cles.filter((cle) => typeof table[code]![cle] !== 'string'), [], `${code} : une clé absente`);
  }
});
