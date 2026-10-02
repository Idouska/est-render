import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import type { OrderSummary } from '../src/services/shopify/orders.ts';
import { jourDuMoisParis, ordersForSupplier, prendCeJour } from '../src/services/suppliers/routing.ts';

/*
 * Trois demandes d'un client.
 *
 * 1. DEUX AGENTS, UN JOUR SUR DEUX. Les commandes d'un jour pair du mois
 *    (heure de Paris) vont à l'un, celles d'un jour impair à l'autre — et
 *    aucune ne tombe entre les deux.
 * 2. L'ADRESSE DU FICHIER, IDENTIQUE À SHOPIFY. Le texte de Shopify, ligne
 *    pour ligne, puis le téléphone ; plus d'e-mail.
 * 3. LES MAILS À L'ÉCRAN, TOUT DE SUITE. Le worker annonce, l'API relaie aux
 *    seuls écrans de la boutique, et l'écran relit.
 */

process.env.ENCRYPTION_KEY ??= Buffer.alloc(32, 1).toString('base64');
process.env.APP_URL ??= 'https://example.test';
process.env.DATABASE_URL ??= 'postgresql://u:p@localhost:5432/db';
process.env.REDIS_URL ??= 'redis://localhost:6379';
process.env.SHOPIFY_SCOPES ??= 'read_orders';
process.env.GOOGLE_SCOPES ??= 'https://www.googleapis.com/auth/gmail.readonly';

const { lireAnnonce } = await import('../src/lib/evenements.ts');
const { customerBlock } = await import('../src/services/export/ordersXlsx.ts');

const lire = (chemin: string) =>
  readFileSync(fileURLToPath(new URL(`../${chemin}`, import.meta.url)), 'utf8');

const commande = (id: string, createdAt: string, vendor = 'Nike'): OrderSummary =>
  ({ id, createdAt, lineItems: [{ vendor, sku: null }] }) as unknown as OrderSummary;

test('le jour se lit à Paris : 23 h 30 UTC le 1er, c’est déjà le 2', () => {
  assert.equal(jourDuMoisParis('2026-10-01T21:30:00Z'), 1);
  assert.equal(jourDuMoisParis('2026-10-01T22:30:00Z'), 2);
  assert.equal(prendCeJour({ createdAt: '2026-10-02T10:00:00Z' }, { joursCommande: 'PAIRS' }), true);
  assert.equal(prendCeJour({ createdAt: '2026-10-02T10:00:00Z' }, { joursCommande: 'IMPAIRS' }), false);
  assert.equal(prendCeJour({ createdAt: '2026-10-31T10:00:00Z' }, { joursCommande: 'IMPAIRS' }), true);
  // Sans réglage : tous les jours, comme avant.
  assert.equal(prendCeJour({ createdAt: '2026-10-02T10:00:00Z' }, { joursCommande: 'TOUS' }), true);
  assert.equal(prendCeJour({ createdAt: '2026-10-02T10:00:00Z' }, {}), true);
});

test('deux agents par défaut se partagent les commandes, sans trou ni doublon', () => {
  const pair = { id: 'pair', vendors: [], skuPrefixes: [], isDefault: true, joursCommande: 'PAIRS' };
  const impair = { id: 'impair', vendors: [], skuPrefixes: [], isDefault: true, joursCommande: 'IMPAIRS' };
  const commandes = Array.from({ length: 31 }, (_, rang) =>
    commande(`c${rang + 1}`, `2026-10-${String(rang + 1).padStart(2, '0')}T10:00:00Z`),
  );
  const auPair = ordersForSupplier(commandes, pair, [impair], []).map((c) => c.id);
  const auImpair = ordersForSupplier(commandes, impair, [pair], []).map((c) => c.id);
  assert.equal(auPair.length + auImpair.length, 31);
  assert.equal(auPair.filter((id) => auImpair.includes(id)).length, 0);
  assert.deepEqual(auPair.slice(0, 3), ['c2', 'c4', 'c6']);
  assert.deepEqual(auImpair.slice(0, 3), ['c1', 'c3', 'c5']);
});

test('une marque réclamée un jour pair ne l’est pas le jour impair', () => {
  const nike = { id: 'nike', vendors: ['Nike'], skuPrefixes: [], isDefault: false, joursCommande: 'PAIRS' };
  const defaut = { id: 'defaut', vendors: [], skuPrefixes: [], isDefault: true };
  const jourImpair = commande('x', '2026-10-03T10:00:00Z');
  assert.deepEqual(ordersForSupplier([jourImpair], nike, [defaut], []), []);
  assert.deepEqual(ordersForSupplier([jourImpair], defaut, [nike], []).map((c) => c.id), ['x']);
});

test('le réglage se choisit sur la fiche et passe partout où l’on route', () => {
  assert.match(lire('prisma/schema.prisma'), /joursCommande String @default\("TOUS"\)/);
  assert.match(lire('src/routes/suppliers.ts'), /joursCommande: z\.enum\(\['TOUS', 'PAIRS', 'IMPAIRS'\]\)\.optional\(\)/);
  assert.match(lire('src/services/envoi/quotidien.ts'), /isDefault: true, joursCommande: true \}/);
  assert.match(lire('src/routes/supplierWorkspace.ts'), /joursCommande: supplier\.joursCommande,/);
  assert.match(lire('src/services/reshipment/echange.ts'), /prendCeJour\(\{ createdAt: maintenant\.toISOString\(\) \}, atelier\)/);
  assert.match(lire('public/dashboard.html'), /<select id="sup-f-jours">/);
});

test('l’adresse du fichier : le texte de Shopify, puis le téléphone, sans e-mail', () => {
  const order = {
    customer: { displayName: 'Léa Fontaine', email: 'lea@example.com' },
    shippingAddress: {
      name: 'Léa Fontaine',
      address1: '12 rue des Lilas',
      address2: 'Bât. B',
      city: 'Lyon',
      zip: '69003',
      province: null,
      country: 'FR',
      phone: '+33 6 12 34 56 78',
      formatted: ['Léa Fontaine', 'Atelier Lumen', '12 rue des Lilas', 'Bât. B', '69003 Lyon', 'France'],
    },
  } as unknown as OrderSummary;
  assert.equal(
    customerBlock(order),
    'Léa Fontaine\nAtelier Lumen\n12 rue des Lilas\nBât. B\n69003 Lyon\nFrance\n+33 6 12 34 56 78',
  );
  // Sans le texte de Shopify (commande ancienne) : la recomposition, toujours sans e-mail.
  const sans = { ...order, shippingAddress: { ...order.shippingAddress!, formatted: null } } as OrderSummary;
  assert.doesNotMatch(customerBlock(sans), /@/);
  assert.match(lire('src/services/shopify/orders.ts'), /formatted\(withName: true, withCompany: true\)/);
});

test('l’annonce : la boutique et le type, rien d’autre', () => {
  assert.deepEqual(lireAnnonce('{"merchantId":"m1","type":"tickets"}'), { merchantId: 'm1', type: 'tickets' });
  assert.equal(lireAnnonce('{"merchantId":"m1","type":"autre"}'), null);
  assert.equal(lireAnnonce('pas du json'), null);
});

test('le worker annonce, l’API ne relaie qu’aux écrans de la boutique, l’écran relit', () => {
  const worker = lire('src/worker.ts');
  assert.match(worker, /if \(ingested > 0\) await annoncer\(job\.data\.merchantId, 'tickets'\);/);
  assert.match(worker, /await processTicket\(job\.data\.merchantId, job\.data\.ticketId\);\s*\/\/[^\n]*\n\s*await annoncer\(job\.data\.merchantId, 'tickets'\);/);
  const route = lire('src/routes/evenements.ts');
  assert.match(route, /app\.get\('\/api\/evenements', \{ preHandler: requireSession \}/);
  assert.match(route, /for \(const ecoute of ecoutes\.get\(annonce\.merchantId\) \?\? \[\]\)/);
  assert.match(lire('src/server.ts'), /await app\.register\(evenementRoutes\);/);
  const app = lire('public/app.js');
  assert.match(app, /state\.flux = new EventSource\('\/api\/evenements'\);/);
  // Le tour de vingt secondes reste en secours.
  assert.match(app, /const TOUR_SAV_MS = 20000;/);
});
