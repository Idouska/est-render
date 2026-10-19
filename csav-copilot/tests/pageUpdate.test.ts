import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { randomBytes } from 'node:crypto';

/*
 * La page Update : les colis qui ne bougent plus.
 *
 * CE QUE CES TESTS PROTÈGENT. Un colis est « bloqué » après trois jours sans
 * scan du transporteur — un colis livré ne l'est jamais. Le message à
 * l'atelier est déjà écrit, avec le numéro et le dernier scan. Une demande
 * restée deux jours sans réponse se relance. Et la page a sa place dans le
 * menu, sous Modification, avec sa pastille rouge.
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

const { lireColis, messageAtelier, joursDepuis, SEUIL_JOURS, RELANCE_JOURS } = await import('../src/services/update/colis.ts');

const lire = (chemin: string) => readFileSync(fileURLToPath(new URL(`../${chemin}`, import.meta.url)), 'utf8');
const JOUR = 86_400_000;
const maintenant = Date.parse('2026-10-20T12:00:00Z');

test('un colis est bloqué au troisième jour sans scan, jamais une fois livré', () => {
  assert.equal(SEUIL_JOURS, 3);
  assert.equal(RELANCE_JOURS, 2);
  const info = (status: string, joursAvant: number) => ({
    trackingNumber: 'X',
    carrier: 'Colissimo',
    status,
    substatus: null,
    deliveredAt: null,
    lastUpdatedAt: null,
    events: [{ at: new Date(maintenant - joursAvant * JOUR).toISOString(), status: 'Centre de tri', location: 'Roissy' }],
  });
  const bloque = lireColis('X', null, new Date(maintenant - 12 * JOUR), info('InTransit', 6), maintenant);
  assert.equal(bloque.joursSansScan, 6);
  assert.equal(bloque.transporteur, 'Colissimo');
  assert.deepEqual(bloque.dernierScan, { at: new Date(maintenant - 6 * JOUR).toISOString(), quoi: 'Centre de tri', lieu: 'Roissy' });
  assert.equal(lireColis('X', null, new Date(maintenant - 12 * JOUR), info('Delivered', 6), maintenant).joursSansScan, 0);
  // Sans suivi : la saisie du numéro tient lieu de dernier signe.
  assert.equal(lireColis('X', 'YunExpress', new Date(maintenant - 4 * JOUR), undefined, maintenant).joursSansScan, 4);
  assert.equal(joursDepuis(new Date(maintenant - 1.5 * JOUR), maintenant), 1);
});

test('le message à l’atelier est déjà écrit : numéro, durée, dernier scan', () => {
  const colis = lireColis('6A21458795412', 'Colissimo', new Date(maintenant - 12 * JOUR), {
    trackingNumber: '6A21458795412', carrier: null, status: 'InTransit', substatus: null, deliveredAt: null, lastUpdatedAt: null,
    events: [{ at: new Date(maintenant - 6 * JOUR).toISOString(), status: 'Centre de tri', location: 'Roissy' }],
  }, maintenant);
  assert.equal(
    messageAtelier({ colis: [colis], joursSansScan: 6 }),
    'Bonjour, le suivi 6A21458795412 ne bouge plus depuis 6 jours (dernier scan : Centre de tri, Roissy). Pouvez-vous vérifier où en est le colis ?',
  );
});

test('les routes : lire, relancer, attendre encore ; demander passe par les demandes à l’atelier', () => {
  const routes = lire('src/routes/updates.ts');
  assert.match(routes, /app\.get<\{ Querystring: \{ compte\?: string \} \}>\('\/api\/updates'/);
  assert.match(routes, /'\/api\/updates\/:id\/relancer',/);
  assert.match(routes, /where: \{ id: request\.params\.id, merchantId, kind: 'TRACKING', status: 'PENDING' \},/);
  assert.match(routes, /app\.post\('\/api\/updates\/reporter'/);
  assert.match(lire('src/server.ts'), /await app\.register\(updateRoutes\);/);
  // Un numéro jamais déclaré à 17TRACK n'a pas de suivi : on le déclare avant de le lire.
  const service = lire('src/services/update/colis.ts');
  assert.ok(service.indexOf('await registerTracking(aLire)') < service.indexOf('await getTracking(aLire)'));
  const app = lire('public/app.js');
  assert.match(app, /kind: 'TRACKING',\n\s+message,\n\s+beforeValue: \(numeros\.length/);
});

test('la page a son entrée sous Modification, sa pastille rouge et sa fiche au téléphone', () => {
  const app = lire('public/app.js');
  assert.ok(app.indexOf("  update: { icon: 'suivi', label: 'Update'") > app.indexOf("  changes: { icon: 'pencil', label: 'Modification'"));
  assert.match(app, /const hot = \['changes', 'update', /);
  assert.match(app, /  update: \(\) => loadUpdate\(\),/);
  const html = lire('public/dashboard.html');
  assert.match(html, /<section class="browse mod upd-page" id="view-update" hidden aria-label="Update">/);
  assert.match(lire('public/styles.css'), /#view-update\.pile-fiche > \.mod-liste,/);
});

test('un mail sans commande : les commandes de l’adresse se proposent, et un numéro tapé charge ses colis', () => {
  const app = lire('public/app.js');
  assert.match(app, /const \{ orders \} = await api\(`\/api\/tickets\/\$\{ticket\.id\}\/order-candidates`\);/);
  assert.match(app, /await api\(`\/api\/tickets\/\$\{modal\.dataset\.ticket\}\/order-candidates\?q=\$\{encodeURIComponent\(nom\)\}`\);/);
  // Le mail est rattaché à la commande choisie à l'envoi.
  assert.match(app, /await api\(`\/api\/tickets\/\$\{modal\.dataset\.ticket\}\/order`, \{/);
  assert.match(lire('public/dashboard.html'), /<div class="upd-candidats" id="upd-candidats" hidden><\/div>/);
});
