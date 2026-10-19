import assert from 'node:assert/strict';
import test from 'node:test';

import { requeteGammes, requeteVariantes } from '../src/services/shopify/catalog.ts';

/*
 * Chercher un modèle dans le catalogue Shopify.
 *
 * CE QUE CES TESTS PROTÈGENT. « hoka » tapé dans « Nom du modèle » ne
 * trouvait rien en production : la requête cherchait dans `title`, qui est le
 * titre de la DÉCLINAISON sur `productVariants` (« 45 1/3 »), jamais le nom
 * du modèle. Le catalogue fictif ignorait le filtre, et l'erreur ne se voyait
 * que chez le marchand.
 */

test('le nom tapé se cherche dans le modèle, la déclinaison ou la référence', () => {
  assert.equal(requeteVariantes('hoka'), '(product_title:hoka* OR title:hoka* OR sku:hoka*)');
  assert.equal(
    requeteVariantes('Hoka 45'),
    '(product_title:Hoka* OR title:Hoka* OR sku:Hoka*) AND (product_title:45* OR title:45* OR sku:45*)',
  );
  // Jamais de joker en tête : Shopify ne l'accepte pas.
  assert.doesNotMatch(requeteVariantes('mafate speed'), /:\*/);
  assert.equal(requeteVariantes(' a '), '');
  assert.equal(requeteVariantes('ho"ka)'), '(product_title:hoka* OR title:hoka* OR sku:hoka*)');
});

test('les équivalents de la commande se cherchent par la gamme du modèle', () => {
  assert.equal(
    requeteGammes(['Hoka Mafate Speed X Jaune', 'Hoka Clifton 9', 'Nike Mind 001']),
    'product_title:Hoka* OR product_title:Nike*',
  );
  assert.equal(requeteGammes([]), '');
});

test('le catalogue fictif lit le filtre comme Shopify', async () => {
  const { createMockShopifyClient } = await import('../src/services/shopify/mock.ts');
  const { listVariants } = await import('../src/services/shopify/catalog.ts');
  const client = createMockShopifyClient('boutique.test');
  const tout = await listVariants(client, { query: 'product_title:a* OR product_title:b* OR product_title:c* OR product_title:l* OR product_title:r*', limit: 100 });
  assert.ok(tout.length > 0);
  const nom = tout[0]!.productTitle;
  const mot = nom.split(/\s+/)[0]!.slice(0, 3);
  const trouves = await listVariants(client, { query: requeteVariantes(mot), limit: 100 });
  assert.ok(trouves.some((option) => option.productTitle === nom), `${mot} → ${nom}`);
  // L'ancienne requête — le titre de la déclinaison — ne trouve pas le modèle.
  const anciens = await listVariants(client, { query: `title:${mot}*`, limit: 100 });
  assert.ok(!anciens.some((option) => option.productTitle === nom && !(option.variantTitle ?? '').toLowerCase().includes(mot.toLowerCase())));
});
