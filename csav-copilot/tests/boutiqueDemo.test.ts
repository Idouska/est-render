import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { randomBytes } from 'node:crypto';

/*
 * La boutique de démonstration.
 *
 * CE QUE CES TESTS PROTÈGENT. La démo se montre à n'importe qui : rien de ce
 * qu'on y fait ne doit sortir — le mode test y est forcé, Shopify et Gmail y
 * sont simulés, et ses numéros de suivi ne partent jamais chez 17TRACK, qui
 * facture chaque numéro déclaré. Ses mails pointent vers des commandes qui
 * existent, ses colis bloqués le sont vraiment, et la boutique fictive sait
 * chercher plusieurs commandes à la fois.
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

const { commandesDemo, scenariosColis, PRODUITS, CLIENTS } = await import('../src/services/demo/catalogue.ts');
const { MAILS } = await import('../src/services/demo/mails.ts');
const { jeuDemo } = await import('../src/services/demo/boutique.ts');
const { estColisDemo, suiviColisDemo } = await import('../src/services/demo/suivi.ts');
const { createMockShopifyClient } = await import('../src/services/shopify/mock.ts');
const { lireColis, SEUIL_JOURS } = await import('../src/services/update/colis.ts');

const lire = (chemin: string) => readFileSync(fileURLToPath(new URL(chemin, import.meta.url)), 'utf8');

test('trente mails ouverts, chacun sur une commande et un client qui existent', () => {
  assert.equal(MAILS.length, 30);
  const commandes = new Set(commandesDemo().map((c) => c.name));
  const clients = new Set(CLIENTS.map((c) => c.nom));
  for (const mail of MAILS) {
    if (mail.commande) assert.ok(commandes.has(`#${mail.commande}`), `${mail.cle} : commande #${mail.commande}`);
    assert.ok(mail.email || clients.has(mail.client), `${mail.cle} : client ${mail.client}`);
    // Un brouillon prêt a son brouillon ; les autres attendent un humain.
    if (mail.statut === 'DRAFT_READY') assert.ok(mail.brouillon, `${mail.cle} : brouillon manquant`);
  }
  // Toutes les familles de demandes sont représentées.
  for (const intent of ['WISMO', 'RETURN', 'REFUND', 'DISPUTE', 'PRODUCT_QUESTION', 'POSITIVE', 'OTHER']) {
    assert.ok(MAILS.some((mail) => mail.intent === intent), intent);
  }
});

test('les dates suivent « maintenant » : une démo montrée plus tard reste fraîche', () => {
  const plusTard = Date.now() + 90 * 86_400_000;
  const recente = commandesDemo(plusTard).find((c) => c.name === '#4142')!;
  assert.ok(plusTard - Date.parse(recente.createdAt) < 86_400_000);
});

test('les colis bloqués le sont vraiment, les autres avancent', () => {
  const maintenant = Date.now();
  let bloques = 0;
  for (const [numero, scenario] of scenariosColis()) {
    const info = suiviColisDemo(numero, maintenant);
    assert.ok(info, numero);
    const colis = lireColis(numero, scenario.transporteur, new Date(maintenant), info, maintenant);
    if (scenario.etat === 'bloque') {
      assert.ok(colis.joursSansScan >= SEUIL_JOURS, `${numero} devrait être bloqué`);
      bloques += 1;
    }
    if (scenario.etat === 'transit') assert.ok(colis.joursSansScan < SEUIL_JOURS, `${numero} devrait avancer`);
    if (scenario.etat === 'livre') assert.equal(colis.livre, true);
  }
  assert.ok(bloques >= 3);
});

test('les numéros de la démo ne partent jamais chez le fournisseur de suivi', () => {
  const [numero] = scenariosColis().keys();
  assert.equal(estColisDemo(numero!), true);
  assert.equal(estColisDemo('LP00123456789CN'), false);
  const index = lire('../src/services/tracking/index.ts');
  assert.match(index, /numbers = numbers\.filter\(\(number\) => !estColisDemo\(number\)\)/);
  assert.match(index, /const reels = numbers\.filter\(\(number\) => !estColisDemo\(number\)\)/);
});

test('rien ne sort de la démo : mode test forcé, Gmail et Shopify simulés', () => {
  const modeTest = lire('../src/services/modeTest.ts');
  assert.match(modeTest, /return Boolean\(merchant\?\.testMode \|\| merchant\?\.demo\)/);
  assert.match(modeTest, /env\.GMAIL_MOCK \|\| \(await boutiqueDemo\(merchantId\)\)/);
  for (const fichier of ['../src/services/gmail/drafts.ts', '../src/services/gmail/send.ts']) {
    assert.doesNotMatch(lire(fichier), /if \(env\.GMAIL_MOCK\)/, fichier);
  }
  assert.match(lire('../src/services/shopify/client.ts'), /env\.SHOPIFY_MOCK \|\| fictive\?\.demo/);
  // Aucune vraie boîte ne se branche sur la démo.
  assert.match(lire('../src/routes/auth.google.ts'), /boutiqueDemo\(request\.session\.merchantId\)/);
});

test('la boutique fictive cherche plusieurs commandes reliées par OR', async () => {
  const client = createMockShopifyClient('kairo-demo.myshopify.com', jeuDemo());
  const { orders } = await client.request<{ orders: { nodes: Array<{ name: string }> } }>(
    'query ListOrders',
    { query: 'name:"#4136" OR name:"#4134"', limit: 10 },
  );
  assert.deepEqual(orders.nodes.map((o) => o.name).sort(), ['#4134', '#4136']);
});

test('le catalogue fictif a ses photos, et ses déclinaisons épuisées', async () => {
  const client = createMockShopifyClient('kairo-demo.myshopify.com', jeuDemo());
  const { products } = await client.request<{ products: { nodes: Array<{ title: string; featuredMedia: unknown }> } }>('query ListProducts', {});
  assert.equal(products.nodes.length, PRODUITS.length);
  assert.ok(products.nodes.every((p) => p.featuredMedia));
  const { productVariants } = await client.request<{ productVariants: { nodes: Array<{ sku: string; inventoryQuantity: number }> } }>(
    'query ListVariants',
    { query: 'sku:KR-TRA-1-43', limit: 5 },
  );
  assert.equal(productVariants.nodes[0]?.inventoryQuantity, 0);
});

test('la console admin prépare, ouvre et partage la démo', () => {
  const admin = lire('../src/routes/admin.ts');
  assert.match(admin, /app\.post\('\/api\/admin\/demo', \{ preHandler: requireAdmin \}/);
  assert.match(admin, /app\.get\('\/api\/admin\/demo\/ouvrir', \{ preHandler: requireAdmin \}/);
  assert.match(admin, /kind: 'invite'/);
  const html = lire('../public/admin.html');
  assert.match(html, /id="demo-body"/);
  // Le tableau de bord remplace les bandeaux « Mode test » et « Simulation » par le sien.
  assert.match(lire('../public/dashboard.html'), /id="demo-notice"/);
  assert.match(lire('../public/app.js'), /\$\('test-notice'\)\.hidden = demo \|\| !me\.merchant\.testMode;/);
});
