import { equal, match, ok } from 'node:assert/strict';
import { test } from 'node:test';
import {
  escalationHtml,
  escalationSubject,
  escalationText,
} from '../src/services/suppliers/notifyEmail.ts';

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
  match(body, /— Running Upscale$/);
});

test('la version HTML porte un bouton, pas une URL nue', () => {
  const html = escalationHtml(context);
  match(html, /Voir la demande et répondre/);
  ok(html.includes(`href="${context.portalUrl}"`));
  // Le jeton ne doit jamais s'afficher en clair dans le corps visible.
  ok(!html.includes('>https://csav-api'));
});

test('le nom du fournisseur est échappé — un apostrophe ne casse pas le gabarit', () => {
  const html = escalationHtml({ ...context, supplierName: 'Atelier <b>Nord</b>' });
  ok(html.includes('Atelier &lt;b&gt;Nord&lt;/b&gt;'));
  ok(!html.includes('<b>Nord</b>'));
});

test('un motif inconnu ne laisse pas de code technique à l’écran', () => {
  equal(
    escalationSubject({ ...context, reason: 'SOMETHING_NEW' }),
    'Running Upscale — commande #11363 : demande',
  );
});
