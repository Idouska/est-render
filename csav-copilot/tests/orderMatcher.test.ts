import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extractOrderNumbers } from '../src/services/matching/orderMatcher.ts';

test('repère un numéro préfixé par #', () => {
  assert.deepEqual(extractOrderNumbers('Bonjour, ma commande #1042 est en retard'), ['1042']);
});

test('repère les formulations françaises courantes', () => {
  assert.deepEqual(extractOrderNumbers('commande n° 20351 jamais reçue'), ['20351']);
  assert.deepEqual(extractOrderNumbers('Ma cmd 998877 svp'), ['998877']);
});

test('repère les formulations anglaises', () => {
  assert.deepEqual(extractOrderNumbers('my order number 4455 is late'), ['4455']);
});

test('déduplique les occurrences multiples', () => {
  assert.deepEqual(extractOrderNumbers('commande #1042, je répète : #1042'), ['1042']);
});

test('ignore les nombres isolés — mieux vaut rien que se tromper', () => {
  assert.deepEqual(extractOrderNumbers('J’ai attendu 15 jours pour 2 articles à 129 euros'), []);
});

test('ignore les nombres trop courts pour être un numéro de commande', () => {
  assert.deepEqual(extractOrderNumbers('commande 12'), []);
});

test('extrait plusieurs numéros distincts', () => {
  const found = extractOrderNumbers('Les commandes #1042 et #1043 posent problème');
  assert.deepEqual(found.sort(), ['1042', '1043']);
});
