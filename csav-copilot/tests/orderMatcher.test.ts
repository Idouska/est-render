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

/* ---- Trouver la commande à tout prix : objet, anciens messages, nom ---- */

import { extractBareNumbers, extractSignatureName, matchOrder } from '../src/services/matching/orderMatcher.ts';

const commande = (name: string, email: string, displayName: string, statut = 'FULFILLED') =>
  ({
    id: `gid://shopify/Order/${name.slice(1)}`,
    name,
    createdAt: '2026-11-01T10:00:00Z',
    displayFinancialStatus: 'PAID',
    displayFulfillmentStatus: statut,
    totalPriceSet: { shopMoney: { amount: '139.00', currencyCode: 'EUR' } },
    tags: [],
    sourceName: 'web',
    subtotalLineItemsQuantity: 1,
    shippingLine: null,
    app: null,
    customer: { id: 'c', email, displayName, numberOfOrders: 1, createdAt: null, amountSpent: null, defaultAddress: null },
    lineItems: { nodes: [] },
    fulfillments: [],
    shippingAddress: null,
    billingAddress: null,
  }) as never;

/** Un Shopify de poche : répond aux recherches `name:`, `email:` et par nom. */
const boutique = (commandes: Array<ReturnType<typeof commande>>) =>
  ({
    request: async (_q: string, { query }: { query: string }) => {
      const toutes = commandes as Array<{ name: string; customer: { email: string; displayName: string } }>;
      const parNom = /^name:"(#\d+)"$/.exec(query)?.[1];
      const parMail = /^email:"(.+)"$/.exec(query)?.[1];
      const libre = /^"(.+)" AND created_at/.exec(query)?.[1];
      const nodes = toutes.filter((c) =>
        parNom ? c.name === parNom : parMail ? c.customer.email === parMail : libre ? c.customer.displayName.includes(libre) : false,
      );
      return { orders: { nodes } };
    },
  }) as never;

test('« numéro de commande : 18327 » et « n° 18327 » sont des numéros explicites', () => {
  assert.deepEqual(extractOrderNumbers('Mon numéro de commande : 18327 merci'), ['18327']);
  assert.deepEqual(extractOrderNumbers('order number is 18266'), ['18266']);
  assert.deepEqual(extractOrderNumbers('Réf. 18221 toujours pas reçue'), ['18221']);
});

test('un nombre nu est un candidat, pas une année ni un prix', () => {
  assert.deepEqual(extractBareNumbers('18327 toujours rien depuis 2026, payé 139,00 € et 1200 g'), ['18327']);
});

test('la signature donne le nom quand l’adresse n’est pas celle de la commande', () => {
  assert.equal(extractSignatureName('Bonjour,\nOù est mon colis ?\nCordialement\nAlecia Hitchcox'), 'Alecia Hitchcox');
  assert.equal(extractSignatureName('Bonjour\nMerci Beaucoup'), null);
});

test('le numéro donné dans l’objet suffit', async () => {
  const shop = boutique([commande('#18327', 'a@x.fr', 'Alecia Hitchcox')]);
  const trouve = await matchOrder(shop, { customerEmail: 'a@x.fr', bodyText: 'Toujours rien.', subject: 'Commande 18327', receivedAt: new Date() });
  assert.equal(trouve.status, 'MATCHED');
  assert.equal(trouve.status === 'MATCHED' && trouve.order.name, '#18327');
});

test('le numéro donné dans un message précédent suffit', async () => {
  const shop = boutique([commande('#18327', 'a@x.fr', 'Alecia Hitchcox')]);
  const trouve = await matchOrder(shop, { customerEmail: 'autre@x.fr', bodyText: 'Des nouvelles ?', earlierText: 'Ma commande #18327', receivedAt: new Date() });
  assert.equal(trouve.status === 'MATCHED' && trouve.order.name, '#18327');
});

test('un nombre nu n’est retenu que si la commande est à l’expéditeur', async () => {
  const shop = boutique([commande('#18327', 'a@x.fr', 'Alecia Hitchcox')]);
  const base = { bodyText: '18327 svp', receivedAt: new Date() };
  const sienne = await matchOrder(shop, { ...base, customerEmail: 'perso@y.fr', customerName: 'Alecia Hitchcox' });
  assert.equal(sienne.status === 'MATCHED' && sienne.order.name, '#18327');
  const pasSienne = await matchOrder(shop, { ...base, customerEmail: 'z@y.fr', customerName: 'Jean Martin' });
  assert.equal(pasSienne.status, 'NOT_FOUND');
});

test('plusieurs commandes au même email : la plus récente, plutôt qu’une fiche vide', async () => {
  const shop = boutique([commande('#18400', 'a@x.fr', 'Alecia Hitchcox'), commande('#18327', 'a@x.fr', 'Alecia Hitchcox')]);
  const trouve = await matchOrder(shop, { customerEmail: 'a@x.fr', bodyText: 'Bonjour', receivedAt: new Date() });
  assert.equal(trouve.status === 'MATCHED' && trouve.order.name, '#18400');
  assert.equal(trouve.status === 'MATCHED' && trouve.score, 0.6);
});

test('autre adresse, mais le client signe de son nom', async () => {
  const shop = boutique([commande('#18327', 'a@x.fr', 'Alecia Hitchcox')]);
  const trouve = await matchOrder(shop, { customerEmail: 'travail@corp.com', customerName: 'ahitch', bodyText: 'Où est mon colis ?\nAlecia Hitchcox', receivedAt: new Date() });
  assert.equal(trouve.status === 'MATCHED' && trouve.order.name, '#18327');
});
