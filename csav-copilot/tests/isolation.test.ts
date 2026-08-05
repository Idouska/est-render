import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { test } from 'node:test';

// La configuration est validée au chargement des modules importés en cascade :
// on renseigne le minimum avant d'atteindre `plugins/auth.ts`.
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

const { PERMISSIONS, can } = await import('../src/plugins/auth.ts');

/**
 * Garde-fous d'isolation et de droits.
 *
 * Trois bugs sont passés en production faute de ces vérifications : un
 * fournisseur voyait tout le carnet de commandes, un ticket d'une autre
 * boutique renvoyait une erreur au clic, et un lien de connexion partait vers
 * une boutique arbitraire. Les tests ci-dessous couvrent les règles pures ;
 * les requêtes elles-mêmes demandent une base et sont testées séparément.
 */

test('un agent ne peut ni rembourser ni configurer', () => {
  assert.equal(can('AGENT', 'reply'), true);
  assert.equal(can('AGENT', 'escalate'), true);
  assert.equal(can('AGENT', 'refund'), false);
  assert.equal(can('AGENT', 'configure'), false);
  assert.equal(can('AGENT', 'manageTeam'), false);
});

test('la lecture seule ne permet aucune action', () => {
  for (const permission of Object.keys(PERMISSIONS) as Array<keyof typeof PERMISSIONS>) {
    assert.equal(can('VIEWER', permission), permission === 'read', permission);
  }
});

test('seul le propriétaire gère l’équipe', () => {
  assert.equal(can('OWNER', 'manageTeam'), true);
  assert.equal(can('SUPERVISOR', 'manageTeam'), false);
});

test('tout rôle peut lire', () => {
  for (const role of ['OWNER', 'SUPERVISOR', 'AGENT', 'VIEWER'] as const) {
    assert.equal(can(role, 'read'), true, role);
  }
});
