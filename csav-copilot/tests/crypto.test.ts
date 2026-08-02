import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { test } from 'node:test';

// La config est validée au chargement du module : on renseigne le minimum
// avant l'import dynamique de crypto.ts.
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
process.env.ANTHROPIC_API_KEY ??= 'sk-test';

const { decryptSecret, encryptSecret, safeEqual } = await import('../src/lib/crypto.ts');

test('chiffre puis déchiffre un token', () => {
  const secret = 'shpat_' + randomBytes(16).toString('hex');
  assert.equal(decryptSecret(encryptSecret(secret)), secret);
});

test('produit un chiffré différent à chaque appel (IV aléatoire)', () => {
  assert.notEqual(encryptSecret('même-valeur'), encryptSecret('même-valeur'));
});

test('rejette un chiffré altéré (authentification GCM)', () => {
  const payload = encryptSecret('secret');
  const parts = payload.split(':');
  const data = Buffer.from(parts[3]!, 'base64');
  data[0] ^= 0xff;
  parts[3] = data.toString('base64');

  assert.throws(() => decryptSecret(parts.join(':')));
});

test('rejette une version inconnue', () => {
  assert.throws(() => decryptSecret('v9:a:b:c'));
});

test('safeEqual compare correctement', () => {
  assert.equal(safeEqual('abc', 'abc'), true);
  assert.equal(safeEqual('abc', 'abd'), false);
  assert.equal(safeEqual('abc', 'abcd'), false);
});
