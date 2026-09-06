import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  extractOrderNumbers,
  manuallyAttachedOrderId,
  matchColumns,
} from '../src/services/matching/orderMatcher.ts';
import type { OrderSummary } from '../src/services/shopify/orders.ts';

/** Commande réduite à ce que lisent les fonctions testées ici. */
function order(id: string, name: string): OrderSummary {
  return {
    id,
    name,
    createdAt: '2026-08-01T10:00:00Z',
    displayFinancialStatus: 'PAID',
    displayFulfillmentStatus: 'FULFILLED',
    totalPrice: '49.90',
    currency: 'EUR',
    customer: null,
    lineItems: [],
    fulfillments: [],
    shippingAddress: null,
  };
}

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

/*
 * Le cas qui a motivé le correctif : un agent rattache #6561 à la main parce
 * que le client écrit depuis une autre adresse que celle de la commande. Il
 * clique « Analyser », `processTicket` relance le matcher — qui échoue pour la
 * même raison qu'avant — et remet le rattachement à zéro. Le travail de
 * l'agent disparaissait sans un mot, et la réponse proposée redemandait au
 * client le numéro qu'on venait d'obtenir.
 */

test('un rattachement manuel est relu, jamais recalculé', () => {
  assert.equal(
    manuallyAttachedOrderId({
      orderMatchMethod: 'MANUAL',
      shopifyOrderId: 'gid://shopify/Order/6561',
    }),
    'gid://shopify/Order/6561',
  );
});

test('un rattachement automatique se rejoue à chaque passage', () => {
  assert.equal(
    manuallyAttachedOrderId({
      orderMatchMethod: 'CUSTOMER_EMAIL',
      shopifyOrderId: 'gid://shopify/Order/6561',
    }),
    null,
  );
});

test('un ticket jamais rattaché passe au matcher', () => {
  assert.equal(manuallyAttachedOrderId({ orderMatchMethod: null, shopifyOrderId: null }), null);
});

test('MANUAL sans commande ne bloque pas le matcher', () => {
  assert.equal(manuallyAttachedOrderId({ orderMatchMethod: 'MANUAL', shopifyOrderId: null }), null);
});

test('sans matcher, aucune colonne de rattachement n’est touchée', () => {
  assert.deepEqual(matchColumns(null, order('gid://shopify/Order/6561', '#6561')), {});
});

test('le matcher qui trouve écrit la commande et son score', () => {
  const found = order('gid://shopify/Order/6561', '#6561');

  assert.deepEqual(matchColumns({ status: 'MATCHED', order: found, method: 'CUSTOMER_EMAIL', score: 0.95 }, found), {
    shopifyOrderId: 'gid://shopify/Order/6561',
    orderName: '#6561',
    orderMatchMethod: 'CUSTOMER_EMAIL',
    orderMatchScore: 0.95,
  });
});

test('le matcher bredouille efface le rattachement, score compris', () => {
  assert.deepEqual(matchColumns({ status: 'NOT_FOUND' }, null), {
    shopifyOrderId: null,
    orderName: null,
    orderMatchMethod: null,
    orderMatchScore: null,
  });
});

test('une hésitation garde la méthode mais refuse de noter un choix non fait', () => {
  assert.deepEqual(
    matchColumns(
      {
        status: 'AMBIGUOUS',
        candidates: [order('gid://shopify/Order/1', '#1'), order('gid://shopify/Order/2', '#2')],
        method: 'NAME_AND_RECENT_DATE',
      },
      null,
    ),
    {
      shopifyOrderId: null,
      orderName: null,
      orderMatchMethod: 'NAME_AND_RECENT_DATE',
      orderMatchScore: null,
    },
  );
});
