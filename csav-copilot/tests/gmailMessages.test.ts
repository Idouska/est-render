import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseAddress, stripQuotedText } from '../src/services/gmail/messages.ts';

test('parse une adresse avec nom affiché', () => {
  assert.deepEqual(parseAddress('Jean Dupont <jean@exemple.fr>'), {
    name: 'Jean Dupont',
    email: 'jean@exemple.fr',
  });
});

test('parse une adresse avec nom entre guillemets', () => {
  assert.deepEqual(parseAddress('"Dupont, Jean" <Jean@Exemple.FR>'), {
    name: 'Dupont, Jean',
    email: 'jean@exemple.fr',
  });
});

test('parse une adresse nue', () => {
  assert.deepEqual(parseAddress('  Jean@Exemple.fr '), {
    name: null,
    email: 'jean@exemple.fr',
  });
});

test('coupe la citation française du fil', () => {
  const body = [
    'Bonjour, toujours rien reçu.',
    '',
    'Le 12 mars 2026, Boutique a écrit :',
    '> Votre colis est parti hier.',
  ].join('\n');

  assert.equal(stripQuotedText(body), 'Bonjour, toujours rien reçu.');
});

test('coupe la citation anglaise et la signature', () => {
  const body = ['Still waiting.', '', '--', 'Sent from my phone'].join('\n');
  assert.equal(stripQuotedText(body), 'Still waiting.');
});

test('laisse un message sans citation intact', () => {
  const body = 'Bonjour,\n\nOù en est ma commande ?\n\nMerci';
  assert.equal(stripQuotedText(body), body);
});

test('retombe sur le corps complet si tout est cité', () => {
  const body = '> Uniquement de la citation';
  assert.equal(stripQuotedText(body), body);
});
