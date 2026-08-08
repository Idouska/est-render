import { equal, match, ok } from 'node:assert/strict';
import { test } from 'node:test';
import { escalationSubject, escalationText } from '../src/services/suppliers/notifyEmail.ts';

/*
 * Le mail reçu en production portait en objet « Nouvelle demande — commande
 * cmsj3nfsu000liz01f92sk2c7 » : un identifiant interne, illisible pour le
 * destinataire, et le premier critère de mise en indésirables. Ces tests
 * verrouillent ce qui doit y figurer, et surtout ce qui ne doit plus.
 */

const context = {
  merchantName: 'Running Upscale',
  supplierName: 'Test Factory',
  orderName: '#11363',
  reason: 'OUT_OF_STOCK',
  portalUrl: 'https://csav-api.onrender.com/supplier/abc?token=eyJhbGciOi.très.long',
};

test('l’objet nomme la boutique, la commande et le motif', () => {
  equal(escalationSubject(context), 'Running Upscale — commande #11363 : rupture de stock');
});

test('sans commande rattachée, l’objet reste lisible', () => {
  equal(
    escalationSubject({ ...context, orderName: null }),
    'Running Upscale — une commande : rupture de stock',
  );
});

test('aucun identifiant interne ne fuit dans l’objet', () => {
  const subject = escalationSubject({ ...context, orderName: 'cmsj3nfsu000liz01f92sk2c7' });
  // Le champ vient de Shopify ; si un jour il porte un cuid, c'est la donnée
  // qui est en cause, pas le gabarit. Ce test garde la trace du cas d'origine.
  ok(subject.startsWith('Running Upscale — commande'));
});

test('la version texte se suffit à elle-même et porte le lien', () => {
  const body = escalationText(context);
  match(body, /Bonjour Test Factory/);
  match(body, /commande #11363/);
  match(body, /rupture de stock/);
  ok(body.includes(context.portalUrl));
  // La signature ferme le message : le nom de la boutique à défaut de réglage.
  ok(body.endsWith('Running Upscale'));
});

test('la signature du marchand ferme le message', () => {
  const body = escalationText({ ...context, signature: 'Rachid\nRunning Upscale' });
  ok(body.endsWith('Merci d’avance,\nRachid\nRunning Upscale'));
});

test('sans signature réglée, le nom de la boutique en tient lieu', () => {
  ok(escalationText(context).endsWith('Merci d’avance,\nRunning Upscale'));
});

test('la note de l’agent est reprise : c’est ce qu’on attend précisément', () => {
  const body = escalationText({ ...context, note: 'Le 44 est parti à la place du 45.' });
  match(body, /Le 44 est parti à la place du 45\./);
});

test('une note vide ne laisse pas de trou dans le message', () => {
  const body = escalationText({ ...context, note: '   ' });
  ok(!body.includes('\n\n\n'));
});

test('un motif inconnu ne laisse pas de code technique à l’écran', () => {
  equal(
    escalationSubject({ ...context, reason: 'SOMETHING_NEW' }),
    'Running Upscale — commande #11363 : demande',
  );
});
