import assert from 'node:assert/strict';
import { test } from 'node:test';
import { csvCell, ordersToCsv, toCsv } from '../src/services/export/ordersCsv.ts';

test('échappe les guillemets et les séparateurs', () => {
  assert.equal(csvCell('Dupont; Jean'), '"Dupont; Jean"');
  assert.equal(csvCell('Il a dit "oui"'), '"Il a dit ""oui"""');
  assert.equal(csvCell('simple'), 'simple');
});

test('neutralise les cellules qu’Excel prendrait pour des formules', () => {
  // Un nom de client commençant par « = » est un vecteur d'injection connu.
  assert.equal(csvCell('=1+1'), "'=1+1");
  assert.equal(csvCell('+33612345678'), "'+33612345678");
  assert.equal(csvCell('-5'), "'-5");
  assert.equal(csvCell('@sum'), "'@sum");
});

test('écrit un BOM et des fins de ligne Windows', () => {
  const csv = toCsv(['a', 'b'], [[1, 2]]);
  assert.ok(csv.startsWith('﻿'), 'BOM attendu pour Excel');
  assert.equal(csv, '﻿a;b\r\n1;2\r\n');
});

test('exporte une commande avec ses articles et ses colis', () => {
  const csv = ordersToCsv(
    [
      {
        order: {
          id: 'gid://shopify/Order/1',
          name: '#10428',
          createdAt: '2026-08-03T10:00:00.000Z',
          displayFinancialStatus: 'PAID',
          displayFulfillmentStatus: 'UNFULFILLED',
          totalPrice: '160.00',
          currency: 'EUR',
          customer: {
            id: 'c1',
            email: 'lea@example.fr',
            displayName: 'Léa Fontaine',
            numberOfOrders: 2,
            amountSpent: '320.00',
            createdAt: null,
          },
          lineItems: [
            { title: 'Aero Glide 2', quantity: 2, variantTitle: '42 · Noir', sku: 'AG2-42-N', image: 'https://cdn/ag2.jpg' },
          ],
          fulfillments: [],
          shippingAddress: {
            name: 'Léa Fontaine',
            address1: '12 rue des Lilas',
            address2: null,
            city: 'Lyon',
            zip: '69003',
            province: null,
            country: 'France',
            phone: '+33612345678',
          },
        },
        parcels: [
          { index: 1, total: 2, trackingNumber: 'LP001', photoUrl: '/api/parcels/p1/photo' },
          { index: 2, total: 2, trackingNumber: 'LP002', photoUrl: null },
        ],
      },
    ],
    'https://csav.example',
  );

  const [header, row] = csv.replace('﻿', '').trim().split('\r\n');

  assert.ok(header?.startsWith('Numéro de commande;Date;Client'));
  assert.ok(row?.includes('#10428'));
  assert.ok(row?.includes('2 × Aero Glide 2 (42 · Noir)'));
  assert.ok(row?.includes('https://cdn/ag2.jpg'), 'la photo produit doit être exportée');
  // Le téléphone commence par « + » : il doit être neutralisé, sinon Excel en
  // fait une formule et affiche une erreur à la place du numéro.
  assert.ok(row?.includes("'+33612345678"));
  assert.ok(row?.includes('1/2 LP001 | 2/2 LP002'));
  assert.ok(row?.includes('https://csav.example/api/parcels/p1/photo'));
});
