import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

/*
 * La version de l'API Shopify, et des requêtes qui y tiennent.
 *
 * CE QUE CES TESTS PROTÈGENT. La configuration demandait encore `2025-01`,
 * retirée par Shopify. Une version retirée n'échoue pas : Shopify répond avec
 * la plus ancienne encore en service, qui avance seule — et un champ retiré
 * casse un écran sans prévenir. C'était déjà le cas des politiques de la
 * boutique : `refundPolicy`, `shippingPolicy`… n'existent plus, la requête
 * échouait en entier.
 *
 * Toutes les requêtes du code ont été validées contre le schéma officiel
 * 2026-10 (aucune erreur, aucun champ déprécié). Ces tests gardent la version
 * et les remplacements faits pour y arriver.
 */

process.env.ENCRYPTION_KEY ??= randomBytes(32).toString('base64');
process.env.APP_URL ??= 'https://example.test';
process.env.DATABASE_URL ??= 'postgresql://u:p@localhost:5432/db';
process.env.REDIS_URL ??= 'redis://localhost:6379';
process.env.SHOPIFY_API_KEY ??= 'key';
process.env.SHOPIFY_API_SECRET ??= 'secret';
process.env.SHOPIFY_SCOPES ??= 'read_orders';
process.env.GOOGLE_CLIENT_ID ??= 'client';
process.env.GOOGLE_CLIENT_SECRET ??= 'secret';
process.env.GOOGLE_SCOPES ??= 'https://www.googleapis.com/auth/gmail.readonly';
process.env.GOOGLE_PUBSUB_TOPIC ??= 'projects/p/topics/t';
process.env.GOOGLE_PUBSUB_SERVICE_ACCOUNT ??= 'sa@p.iam.gserviceaccount.com';

const { versionShopify, VERSION_API_SHOPIFY } = await import('../src/services/shopify/client.ts');

const lire = (chemin: string) => readFileSync(fileURLToPath(new URL(`../${chemin}`, import.meta.url)), 'utf8');

test('la version validée l’emporte sur une version plus ancienne restée chez l’hébergeur', () => {
  assert.equal(VERSION_API_SHOPIFY, '2026-10');
  assert.equal(versionShopify('2025-01'), '2026-10');
  assert.equal(versionShopify(undefined), '2026-10');
  assert.equal(versionShopify(''), '2026-10');
  assert.equal(versionShopify('unstable'), '2026-10');
  // Une version plus récente est un choix délibéré : elle passe.
  assert.equal(versionShopify('2027-01'), '2027-01');

  assert.match(lire('src/services/shopify/client.ts'), /\/admin\/api\/\$\{versionShopify\(env\.SHOPIFY_API_VERSION\)\}\/graphql\.json/);
  assert.match(lire('src/config/env.ts'), /SHOPIFY_API_VERSION: z\.string\(\)\.default\('2026-10'\)/);
  const render = lire('render.yaml');
  assert.doesNotMatch(render, /2025-01/);
  assert.equal(render.split("- key: SHOPIFY_API_VERSION\n        value: '2026-10'").length - 1, 3);
});

test('les politiques de la boutique se lisent dans shopPolicies', () => {
  const politiques = lire('src/services/shopify/policies.ts');
  assert.match(politiques, /shopPolicies \{\s+type\s+title\s+body\s+\}/);
  assert.doesNotMatch(politiques, /refundPolicy \{|shippingPolicy \{|termsOfService \{|subscriptionPolicy \{/);
  assert.match(politiques, /\['Retours et remboursements', politique\('REFUND_POLICY'\)\]/);
});

test('plus de champ déprécié : photo de déclinaison et adresse du client', () => {
  const catalogue = lire('src/services/shopify/catalog.ts');
  // La photo d'une déclinaison est son premier média, pas `image`.
  assert.equal(catalogue.split('media(first: 1) {').length - 1, 2);
  assert.doesNotMatch(catalogue, /availableForSale\s+image \{/);
  assert.doesNotMatch(catalogue, /tracked\s+\}\s+image \{/);
  assert.match(catalogue, /image: photoDeDeclinaison\(variant\) \?\? variant\.product\.featuredMedia/);

  for (const fichier of ['src/services/shopify/orders.ts', 'src/services/shopify/refundHistory.ts']) {
    const source = lire(fichier);
    assert.match(source, /defaultEmailAddress \{\s+emailAddress\s+\}/, fichier);
    assert.doesNotMatch(source, /customer \{\s+(?:id\s+)?(?:displayName\s+)?email\s/, fichier);
  }

  // La démonstration répond avec les mêmes formes.
  const demo = lire('src/services/shopify/mock.ts');
  assert.match(demo, /media: \{ nodes: variante\.image \? \[\{ preview: \{ image: \{ url: variante\.image \} \} \}\] : \[\] \}/);
  assert.match(demo, /defaultEmailAddress: order\.customerEmail \? \{ emailAddress: order\.customerEmail \} : null/);
});
