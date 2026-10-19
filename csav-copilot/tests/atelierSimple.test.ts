import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { STRINGS } from '../public/workspace.i18n.js';

/*
 * L'espace fournisseur pour qui lit mal l'écran.
 *
 * CE QUE CES TESTS PROTÈGENT. Une page « 缺货 » qu'on comprend sans lire —
 * pavé, tuiles, boutons de couleur — et des commandes en cartes avec deux
 * boutons qu'on ne confond pas : vert « 发货 ✓ », orange « 有问题 ». Le
 * problème se dit en touchant une tuile, et la phrase part en français au
 * marchand, qui la lit.
 */

const lire = (chemin: string) => readFileSync(fileURLToPath(new URL(`../${chemin}`, import.meta.url)), 'utf8');
const js = lire('public/workspace.js');
const html = lire('public/workspace.html');
const table = STRINGS as Record<string, Record<string, string>>;

test('chaque mot des nouvelles pages existe dans les trois langues', () => {
  const cles = Object.keys(table.fr!).filter((cle) => /^(oos|cs|pb)\./.test(cle));
  assert.ok(cles.length > 50, `${cles.length} clés`);
  for (const langue of ['en', 'zh']) {
    assert.deepEqual(cles.filter((cle) => typeof table[langue]![cle] !== 'string'), [], langue);
  }
  assert.equal(table.zh!['cs.ship'], '发货');
  assert.equal(table.zh!['cs.problem'], '有问题');
  assert.equal(table.zh!['cs.gotIt'], '知道了');
  assert.equal(table.zh!['oos.mine'], '我的缺货');
});

test('« 缺货 » a son entrée, juste après les commandes, et son écran', () => {
  assert.ok(html.indexOf('data-view="orders"') < html.indexOf('data-view="rupture"'));
  assert.ok(html.indexOf('data-view="rupture"') < html.indexOf('data-view="catalog"'));
  assert.match(html, /<section id="view-rupture" class="oos" hidden>/);
  assert.match(js, /rupture: chargerRupture,/);
  assert.match(js, /rupture: \['rupture'\],/);
});

test('la rupture part sans rien écrire : articles touchés et délai en français', () => {
  const envoi = js.slice(js.indexOf('async function envoyerOos'), js.indexOf('async function chargerMesRuptures'));
  assert.match(envoi, /kind: 'STOCK'/);
  assert.match(envoi, /note: info \? INFOS_RUPTURE\[info\] : null/);
  // « Impossible » se dit d'un bouton : la phrase part toute faite.
  assert.match(js, /note: reponse === 'IMPOSSIBLE' \? t\('oos\.cannotNote'\) : null/);
});

test('cinq tuiles de problème, et « 缺货 » mène à sa page', () => {
  const tuiles = [...html.matchAll(/data-pb="(\w+)"/g)].map((m) => m[1]);
  assert.deepEqual(tuiles, ['ADDRESS', 'PHONE', 'DAMAGE', 'STOCK', 'OTHER']);
  assert.match(js, /if \(tuile\.dataset\.pb === 'STOCK'\) \{/);
  assert.match(js, /ouvrirRupturePour\(order\);/);
  // Seul « Autre » demande d'écrire.
  assert.match(js, /\$\('pb-envoyer'\)\.disabled = !kind \|\| \(kind === 'OTHER' && note\.length < 3\);/);
  for (const phrase of ['L’adresse de livraison semble incorrecte.', 'Le numéro de téléphone semble incorrect.']) {
    assert.ok(js.includes(phrase), phrase);
  }
});

test('la vue simple par défaut, la vue détaillée à un clic', () => {
  assert.match(js, /simple: localStorage\.getItem\(`ws\.vue\.\$\{supplierId\}`\) !== 'detail',/);
  assert.match(js, /if \(state\.simple\) \{\n\s+\$\('ws-orders'\)\.before\(\$\('cmd-outils'\)\);\n\s+return dessinerCartes\(\);/);
  for (const geste of ['import', 'tracking', 'lots', 'vue']) {
    assert.match(html, new RegExp(`data-plus="${geste}"`), geste);
  }
});

test('« 知道了 » confirme la demande du marchand sur la bande même', () => {
  assert.match(js, /void respond\(button\.dataset\.alertOk, 'ACKNOWLEDGED'\);/);
  // L'ancien bouton menait vers un écran qui n'existe plus.
  assert.doesNotMatch(js, /setView\('updates'\)/);
});

test('le transporteur tient sur une ligne, les champs ne s’ouvrent que sur « modifier »', () => {
  const carte = js.slice(js.indexOf('function carteCommande'), js.indexOf('function majBoutonCarte'));
  assert.match(carte, /transporteur && !state\.csReglages\.has\(order\.id\)/);
  // Repliée, la carte garde ses valeurs pour « 发货 ✓ ».
  assert.match(carte, /<input type="hidden" data-cs-carrier value="\$\{esc\(transporteur\)\}" \/>/);
  assert.match(carte, /<input type="hidden" data-cs-total value="\$\{total\}" \/>/);
  assert.match(js, /if \(event\.target\.closest\('\[data-cs-reglages\]'\)\) \{\n    state\.csReglages\.add\(order\.id\);/);
  assert.equal(table.zh!['cs.change'], '修改');
});

test('le code-barres ne se propose qu’au doigt, et « Par modèle » se voit en vue simple', () => {
  assert.match(js, /const scanPossible = \(\) => 'BarcodeDetector' in window && matchMedia\('\(pointer: coarse\)'\)\.matches;/);
  assert.doesNotMatch(js, /'BarcodeDetector' in window\n\s+\?/);
  const css = lire('public/workspace.css');
  assert.doesNotMatch(css, /body\.ws-simple \.wsapp #ws-filter,/);
  assert.match(css, /body\.ws-simple \.wsapp #ws-filter \.cmd-switch,/);
});

test('pas de bouton « Plus » : en vue simple, tout se voit', () => {
  assert.doesNotMatch(html, /id="ws-plus"/);
  assert.doesNotMatch(html, /role="menu"[^>]*id="ws-plus-menu"|id="ws-plus-menu"[^>]*role="menu"/);
  assert.match(html, /<div class="cs-actions" id="ws-plus-menu">/);
  assert.doesNotMatch(js, /\['ws-plus', 'ws-plus-menu'\]/);
});

test('une demande de changement montre la paire concernée, nom et photo', () => {
  const route = lire('src/routes/supplierWorkspace.ts');
  const updates = route.slice(route.indexOf("'/api/workspace/:id/updates',"), route.indexOf("'/api/workspace/:id/updates/:alertId/respond'"));
  assert.match(updates, /const order = await getOrderById\(client, id\)\.catch\(\(\) => null\);/);
  assert.match(updates, /articles: \(update\.shopifyOrderId && articles\.get\(update\.shopifyOrderId\)\) \|\| \[\],/);
  assert.match(js, /\$\{articleDeDemande\(update\)\}/);
  // Les boutons Excel, CSV… ne servent qu'aux commandes.
  assert.match(js, /for \(const id of \['cmd-tete', 'cmd-barre', 'ws-plus-menu'\]\) \{/);
});
