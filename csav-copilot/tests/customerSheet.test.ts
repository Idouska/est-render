import { deepEqual } from 'node:assert/strict';
import { test } from 'node:test';
import { customerOrderNames, missingOrderIds } from '../src/services/customers/sheet.ts';

/*
 * Le cas qui a motivé le correctif : le client écrit depuis ccolombo@icloud.com,
 * la commande #6561 est enregistrée chez Shopify sous une autre adresse. La
 * recherche par email ne rend rien, et la fiche affichait « Aucune commande »
 * à côté d'un message qui citait justement cette commande.
 */

test('une commande citée par un message et absente de la recherche est réclamée', () => {
  const tickets = [
    { shopifyOrderId: 'gid://shopify/Order/6561', orderName: '#6561' },
    { shopifyOrderId: null, orderName: null },
  ];

  deepEqual(missingOrderIds(tickets, []), ['gid://shopify/Order/6561']);
});

test('une commande déjà rendue par la recherche email n’est pas redemandée', () => {
  const tickets = [{ shopifyOrderId: 'gid://shopify/Order/6561', orderName: '#6561' }];

  deepEqual(missingOrderIds(tickets, ['gid://shopify/Order/6561']), []);
});

test('le même numéro cité par cinq messages ne coûte qu’un appel', () => {
  const tickets = Array.from({ length: 5 }, () => ({
    shopifyOrderId: 'gid://shopify/Order/6561',
    orderName: '#6561',
  }));

  deepEqual(missingOrderIds(tickets, []), ['gid://shopify/Order/6561']);
});

test('un client bavard ne déclenche pas trente appels pour ouvrir sa fiche', () => {
  const tickets = Array.from({ length: 30 }, (unused, index) => ({
    shopifyOrderId: `gid://shopify/Order/${index}`,
    orderName: `#${index}`,
  }));

  deepEqual(missingOrderIds(tickets, []).length, 10);
});

test('les numéros de commande viennent de Shopify et des messages, sans doublon', () => {
  const orders = [{ name: '#6561' }, { name: '#7000' }];
  const tickets = [
    { shopifyOrderId: null, orderName: '#6561' },
    { shopifyOrderId: null, orderName: '#8888' },
    { shopifyOrderId: null, orderName: null },
  ];

  deepEqual(customerOrderNames(orders, tickets), ['#6561', '#7000', '#8888']);
});

test('Shopify muet : les colis se retrouvent quand même par le numéro du message', () => {
  const tickets = [{ shopifyOrderId: null, orderName: '#6561' }];

  deepEqual(customerOrderNames([], tickets), ['#6561']);
});
