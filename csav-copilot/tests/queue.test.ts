import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { test } from 'node:test';

// La configuration est validée au chargement : on renseigne le minimum avant
// d'atteindre le module de files.
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

const { ingestJobId, ticketJobId } = await import('../src/queue/ids.ts');

/*
 * BullMQ réserve les deux-points à ses propres clés Redis et refuse tout
 * identifiant qui en contient. L'erreur ne survient qu'à la mise en file, donc
 * après la création du ticket : le mail entrait en base, l'IA n'était jamais
 * saisie, et rien à l'écran ne le signalait. Ce test est le garde-fou qui
 * manquait.
 */
test('un identifiant de job d’ingestion ne contient pas de deux-points', () => {
  const id = ingestJobId({ merchantId: 'ckm123', mailboxId: 'box42' }, 1234);
  assert.ok(!id.includes(':'), `identifiant invalide pour BullMQ : ${id}`);
});

test('un identifiant sans boîte reste valide', () => {
  const id = ingestJobId({ merchantId: 'ckm123' }, 99);
  assert.ok(!id.includes(':'));
  assert.match(id, /default/);
});

test('un identifiant de job de ticket ne contient pas de deux-points', () => {
  const id = ticketJobId({ merchantId: 'ckm123', ticketId: 'tkt789' });
  assert.ok(!id.includes(':'), `identifiant invalide pour BullMQ : ${id}`);
});

test('deux tickets distincts ne partagent pas le même identifiant', () => {
  const a = ticketJobId({ merchantId: 'm', ticketId: 'un' });
  const b = ticketJobId({ merchantId: 'm', ticketId: 'deux' });
  assert.notEqual(a, b);
});
