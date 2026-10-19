import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

/*
 * « Actions » → « Renvoi », en fenêtre.
 *
 * CE QUE CES TESTS PROTÈGENT. Le renvoi ouvrait la page du stock retours : on
 * quittait le client pour chercher une paire, et on revenait sans savoir pour
 * quelle commande. La fenêtre s'ouvre sur le message, commande et produit
 * déjà remplis, et la paire choisie est réservée à cette commande même si
 * elle est déjà partie — c'est la raison d'un renvoi.
 */

const lire = (chemin: string) => readFileSync(fileURLToPath(new URL(`../${chemin}`, import.meta.url)), 'utf8');
const app = lire('public/app.js');
const html = lire('public/dashboard.html');
const retours = lire('src/routes/returns.ts');

test('« Renvoi » ouvre la fenêtre, plus la page du stock', () => {
  assert.match(app, /renvoi: \(\) => void ouvrirRenvoi\(ticket\),/);
  assert.doesNotMatch(app, /renvoi: \(\) => document\.querySelector\('\.nav-item\[data-view="renvoi"\]'\)/);
  assert.match(html, /<div class="backdrop" id="rv-modal" role="dialog" aria-modal="true" aria-labelledby="rv-title" hidden>/);
});

test('la commande et ses produits sont déjà remplis', () => {
  const ouverture = app.slice(app.indexOf('async function ouvrirRenvoi'), app.indexOf('function fermerRenvoi'));
  assert.match(ouverture, /\$\('rv-commande'\)\.value = order\?\.name \?\? ticket\.orderName \?\? '';/);
  assert.match(ouverture, /renderRenvoiProduits\(\);/);
});

test('les paires proposées suivent la règle du rapprochement', () => {
  const regle = app.slice(app.indexOf('function paireCorrespond'), app.indexOf('async function ouvrirRenvoi'));
  assert.match(regle, /if \(skuPaire && skuArticle\) return skuPaire === skuArticle;/);
  assert.match(app, /paire\.status === 'RESTOCKED' && !paire\.reusedAt && paireCorrespond\(paire, article\)/);
});

test('un renvoi sert une commande déjà expédiée, et le dit au serveur', () => {
  assert.match(app, /body: JSON\.stringify\(\{ orderId, orderName, returnIds: \[choisie\.id\], renvoi: true \}\),/);
  assert.match(retours, /renvoi: z\.boolean\(\)\.optional\(\),/);
  assert.match(retours, /if \(colis > 0 && !renvoi\) \{/);
});
