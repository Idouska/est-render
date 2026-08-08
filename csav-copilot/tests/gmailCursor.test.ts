import { equal } from 'node:assert/strict';
import { test } from 'node:test';
import { isUnknownCursor } from '../src/services/gmail/errors.ts';

/*
 * Le curseur d'historique refusé par Gmail arrive sous plusieurs formes selon
 * la version de googleapis et la nature de la panne. Une seule non reconnue,
 * et toute la relève tombe : c'est ce qui affichait « Requested entity was not
 * found » sur l'écran des réglages, sans que le rattrapage par date — qui
 * aurait fonctionné — ne soit jamais tenté.
 */

test('code numérique 404', () => {
  equal(isUnknownCursor({ code: 404 }), true);
});

test('code textuel « 404 »', () => {
  equal(isUnknownCursor({ code: '404' }), true);
});

test('statut porté par la réponse', () => {
  equal(isUnknownCursor({ response: { status: 404 } }), true);
});

test('statut à la racine', () => {
  equal(isUnknownCursor({ status: 404 }), true);
});

test('le message seul suffit — le cas rencontré en production', () => {
  equal(isUnknownCursor(new Error('Requested entity was not found.')), true);
});

test('une panne réseau n’est pas un curseur périmé et doit remonter', () => {
  equal(isUnknownCursor({ code: 'ECONNRESET', message: 'socket hang up' }), false);
});

test('un refus d’autorisation n’est pas un curseur périmé', () => {
  equal(isUnknownCursor({ code: 403, message: 'Insufficient Permission' }), false);
});
