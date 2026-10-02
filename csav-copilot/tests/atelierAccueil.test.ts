import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
// @ts-expect-error — module navigateur sans déclaration de types.
import { LANGS, STRINGS } from '../public/workspace.i18n.js';

/*
 * L'espace atelier : un accueil, et une seule liste de tickets.
 *
 * CE QUE CES TESTS PROTÈGENT. L'atelier arrivait sur « Commandes », ou sur un
 * onglet de tickets souvent vide pendant qu'une demande l'attendait dans
 * l'onglet d'à côté ; et ses signalements autres que les ruptures
 * disparaissaient de son écran une fois envoyés.
 */

const lire = (chemin: string) =>
  readFileSync(fileURLToPath(new URL(`../${chemin}`, import.meta.url)), 'utf8');

const js = lire('public/workspace.js');
const html = lire('public/workspace.html');
const routes = lire('src/routes/supplierWorkspace.ts');

test('l’atelier arrive sur « Aujourd’hui », une fois tout le script chargé', () => {
  assert.match(js, /view: 'home',/);
  assert.match(html, /<section id="view-home">/);
  assert.match(html, /<section id="view-orders" hidden>/);
  // La table des écrans est déclarée plus bas que le premier `applyLang` :
  // changer d'écran avant la fin du fichier lèverait une erreur.
  assert.match(js, /pret = true;\nsetView\(state\.view\);\s*$/);
});

test('chaque chiffre de l’accueil ouvre la liste déjà filtrée', () => {
  const accueil = js.slice(js.indexOf('async function loadHome'), js.indexOf('function resumeDe('));
  assert.match(accueil, /ouvrirTickets\('A_REPONDRE'\)/);
  assert.match(accueil, /ouvrirTickets\('ATTENTE'\)/);
  assert.match(accueil, /ouvrirTickets\('A_REPONDRE', 'ECHANGE'\)/);
  assert.match(accueil, /setView\('orders'\)/);
  // Les plus anciennes d'abord : c'est ce qui attend depuis le plus longtemps.
  assert.match(accueil, /\.sort\(\(a, b\) => new Date\(a\.date\)\.getTime\(\) - new Date\(b\.date\)\.getTime\(\)\)/);
});

test('« à préparer » se lit dans ses lots, et mène à l’onglet des lots', () => {
  const accueil = js.slice(js.indexOf('async function loadHome'), js.indexOf('function resumeDe('));
  assert.match(accueil, /api\(`\/api\/workspace\/\$\{supplierId\}\/lots`\)/);
  assert.match(accueil, /\.filter\(\(commande\) => commande\.statut === 'A_PREPARER'\)\.length/);
  assert.match(accueil, /if \(parLots\) state\.sous = \{ \.\.\.\(state\.sous \?\? \{\}\), orders: 'lots' \};/);
  // Sans fichier du jour, les commandes de la période, comme avant.
  assert.match(accueil, /: \(state\.orders \?\? \[\]\)\.filter\(\(order\) => !orderIsDone\(order\)\)\.length;/);
});

test('une seule liste, ouverte sur « À répondre », les plus anciennes d’abord', () => {
  assert.match(js, /state\.tk = \{ statut: 'A_REPONDRE', type: '', items: \[\], erreurs: \[\] \};/);
  assert.match(html, /data-tstatut="A_REPONDRE" aria-pressed="true"/);
  const rendu = js.slice(js.indexOf('function renderTickets('));
  assert.match(rendu, /statut === 'A_REPONDRE'\s*\?\s*new Date\(a\.date\)\.getTime\(\) - new Date\(b\.date\)\.getTime\(\)/);
  // Le compteur du filtre et la pastille du menu disent le même chiffre.
  assert.match(js, /const compteur = \$\('tk-n-rep'\);/);
});

test('ses signalements de tous motifs reviennent dans sa liste', () => {
  assert.match(routes, /'\/api\/workspace\/:id\/signalements'/);
  assert.match(routes, /signalementsDeLAtelier\(workspace, \{ seulementRuptures: false \}\)/);
  // Isolation : le préfixe du fil porte l'identifiant de CET atelier.
  const lecture = routes.slice(routes.indexOf('async function signalementsDeLAtelier('));
  assert.match(lecture, /startsWith: `supplier:\$\{workspace\.supplierId\}:`/);
  assert.match(js, /api\(`\/api\/workspace\/\$\{supplierId\}\/signalements`\)/);
});

test('une source en panne éteint sa part de la pastille, et la liste le dit', () => {
  const chargement = js.slice(js.indexOf('async function chargerTickets'), js.indexOf('async function loadTickets'));
  assert.match(chargement, /setBadge\(updates \? \(updates\.pending \?\? 0\) : 0\)/);
  assert.match(chargement, /if \(!ruptures\) setRuptureBadge\(0\);/);
  assert.match(chargement, /setEchangeBadge\(echanges \? \(echanges\.aEnvoyer \?\? \[\]\)\.length : 0\)/);
  assert.match(js, /t\('tk\.partial', \{ quoi: erreurs\.join\(', '\) \}\)/);
});

test('l’accueil et la liste se lisent dans les trois langues', () => {
  const appelees = new Set([
    ...[...js.matchAll(/\bt\('((?:tk|home)\.[\w.]+)'/g)].map((m) => m[1]!),
    ...[...html.matchAll(/data-t="((?:tk|home|nav)\.[\w.]+)"/g)].map((m) => m[1]!),
    // Les tuiles de l'accueil nomment leur clé avant de la traduire.
    ...[...js.matchAll(/cle: '(home\.[\w.]+)'/g)].map((m) => m[1]!),
    // Les messages de liste vide se composent avec le filtre.
    ...['A_REPONDRE', 'ATTENTE', 'CLOS', 'ALL'].map((statut) => `tk.empty.${statut}`),
  ]);
  assert.ok(appelees.size >= 25, 'le vocabulaire manque');
  for (const { code } of LANGS as Array<{ code: string }>) {
    const table = (STRINGS as Record<string, Record<string, string>>)[code]!;
    assert.deepEqual([...appelees].filter((cle) => typeof table[cle] !== 'string'), [], `${code} : une clé absente`);
  }
});
