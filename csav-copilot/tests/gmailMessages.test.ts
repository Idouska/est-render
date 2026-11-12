import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extractAttachments, parseAddress, stripQuotedText } from '../src/services/gmail/messages.ts';

/*
 * Pièces jointes : une signature et une photo collée dans le corps portent
 * toutes les deux un `Content-ID` — seule la taille les distingue. Ces tests
 * protègent les deux sens de l'erreur : garder le logo d'entreprise, perdre
 * la photo du défaut que le client a collée dans sa réponse Gmail.
 */
const piece = (over: Partial<{ filename: string; mimeType: string; size: number; attachmentId: string; contentId: boolean }> = {}) => ({
  filename: over.filename ?? 'photo.jpg',
  mimeType: over.mimeType ?? 'image/jpeg',
  body: { attachmentId: over.attachmentId ?? 'att1', size: over.size ?? 500_000 },
  headers: over.contentId ? [{ name: 'Content-ID', value: '<logo>' }] : [],
});

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

test('une pièce jointe classique (sans Content-ID) est toujours retenue', () => {
  const trouvees = extractAttachments(piece({ filename: 'defaut.jpg' }));
  assert.equal(trouvees.length, 1);
  assert.equal(trouvees[0]!.filename, 'defaut.jpg');
});

test('un petit visuel intégré (Content-ID, sous le seuil) est écarté : une signature', () => {
  const trouvees = extractAttachments(piece({ contentId: true, size: 4_000 }));
  assert.equal(trouvees.length, 0);
});

test('une grande photo collée dans le corps (Content-ID, au-delà du seuil) est retenue', () => {
  const trouvees = extractAttachments(piece({ contentId: true, size: 500_000, filename: 'IMG_2048.jpg' }));
  assert.equal(trouvees.length, 1);
  assert.equal(trouvees[0]!.filename, 'IMG_2048.jpg');
});

test('une pièce sans identifiant Gmail ne peut pas être récupérée plus tard : elle est écartée', () => {
  const sansId = { filename: 'photo.jpg', mimeType: 'image/jpeg', body: { size: 500_000 }, headers: [] };
  assert.equal(extractAttachments(sansId).length, 0);
});

test('les pièces jointes se retrouvent à travers plusieurs niveaux de parties MIME', () => {
  const message = {
    mimeType: 'multipart/mixed',
    parts: [
      { mimeType: 'multipart/alternative', parts: [{ mimeType: 'text/plain', body: {} }] },
      piece({ filename: 'retour.png', contentId: true, size: 800_000 }),
    ],
  };
  const trouvees = extractAttachments(message);
  assert.equal(trouvees.length, 1);
  assert.equal(trouvees[0]!.filename, 'retour.png');
});
