import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { randomBytes } from 'node:crypto';

/*
 * Classement produits : le nombre exact de ventes par produit, avec son
 * classement, par pays — et le même classement pour les retours, les
 * échanges et les commandes annulées.
 *
 * CE QUE CES TESTS PROTÈGENT. Les ventes et les annulations viennent de
 * Shopify (articles + pays de livraison) ; les retours et les échanges
 * viennent de `ReturnCase`, toujours disponibles même quand Shopify ne
 * répond pas — un marchand ne doit jamais perdre ses chiffres SAV parce que
 * Shopify est lent. Le classement par pays reste cohérent avec le filtre
 * choisi à l'écran : les unités affichées doivent changer avec le pays, pas
 * seulement leur étiquette.
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

const lire = (chemin: string) =>
  readFileSync(fileURLToPath(new URL(`../${chemin}`, import.meta.url)), 'utf8');
const sansCommentaires = (code: string) =>
  code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/[^\n]*/gm, '');

const produitsPeriode = lire('src/services/shopify/produitsPeriode.ts');
const produitsRetours = lire('src/services/stats/produitsRetours.ts');
const stats = sansCommentaires(lire('src/routes/stats.ts'));
const mock = sansCommentaires(lire('src/services/shopify/mock.ts'));
const appJs = lire('public/app.js');
const dashboard = lire('public/dashboard.html');

test('la requête Shopify lit les articles et le pays de livraison de chaque commande', () => {
  assert.match(produitsPeriode, /query ProduitsPeriode/);
  assert.match(produitsPeriode, /shippingAddress\s*\{\s*countryCodeV2/);
  assert.match(produitsPeriode, /lineItems\(first: 50\)/);
});

test('le classement sépare ventes et annulations par `cancelledAt`, jamais les deux ensemble', () => {
  const fn = produitsPeriode.slice(produitsPeriode.indexOf('function classer('));
  assert.match(fn, /if \(commande\.annulee !== annulee\) continue;/);
  const appel = produitsPeriode.slice(produitsPeriode.indexOf('export async function classementProduits'));
  assert.match(appel, /ventes: classer\(brutes\.commandes, false\)/);
  assert.match(appel, /annulations: classer\(brutes\.commandes, true\)/);
});

test('chaque ligne du classement garde ses unités par pays, pas seulement le total', () => {
  const fn = produitsPeriode.slice(produitsPeriode.indexOf('function classer('));
  assert.match(fn, /entree\.pays\[commande\.pays\] = \(entree\.pays\[commande\.pays\] \?\? 0\) \+ ligne\.quantite/);
});

test('le CA aussi se garde par pays : sinon le filtre changerait les unités sans changer le montant', () => {
  const fn = produitsPeriode.slice(produitsPeriode.indexOf('function classer('));
  assert.match(fn, /entree\.caPays\[commande\.pays\] = \(entree\.caPays\[commande\.pays\] \?\? 0\) \+ ligne\.montant/);
  assert.match(appJs, /const caDe = \(l\) => \(paysProduitsStats \? \(l\.caPays\?\.\[paysProduitsStats\] \?\? 0\) : l\.ca\);/);
});

test('retours et échanges viennent de ReturnCase, jamais des commandes de test, jamais de la démo oubliée', () => {
  assert.match(produitsRetours, /by: \['productTitle', 'variantTitle', 'sku', 'country'\]/);
  assert.match(produitsRetours, /test: false/);
  assert.match(produitsRetours, /resolution,/);
  assert.match(produitsRetours, /classerReturnCase\(merchantId, p, 'REFUND'\)/);
  assert.match(produitsRetours, /classerReturnCase\(merchantId, p, 'EXCHANGE'\)/);
});

test('la route combine les deux sources et garde retours/échanges même si Shopify tombe', () => {
  const fn = stats.slice(stats.indexOf("app.get('/api/stats/periode/produits'"));
  assert.match(fn, /classementRetoursEchanges\(merchantId, lu\.periode\.courante\)/);
  assert.match(fn, /classementProduits\(merchantId, client, lu\.periode\.courante\)/);
  // Le `catch` renvoie quand même `retours` et `echanges`, déjà en main avant
  // l'appel à Shopify — jamais un écran vide parce que Shopify a toussé.
  const attrape = fn.slice(fn.indexOf('catch (error)'));
  assert.match(attrape, /ventes: null, annulations: null, retours, echanges/);
});

test('la boutique de démonstration répond aussi à cette requête, pays et annulations compris', () => {
  assert.match(mock, /query\.includes\('query ProduitsPeriode'\)/);
  assert.match(mock, /shippingAddress: \{ countryCodeV2: pays \}/);
  assert.match(mock, /cancelledAt: \(graine \+ i\) % 29 === 0/);
});

test('l’écran Statistiques propose les quatre classements et un filtre pays', () => {
  assert.match(dashboard, /id="sta-produits"/);
  assert.match(appJs, /const TYPES_PRODUITS = \{/);
  assert.match(appJs, /ventes: \{ titre: 'Ventes'/);
  assert.match(appJs, /retours: \{ titre: 'Retours'/);
  assert.match(appJs, /echanges: \{ titre: 'Échanges'/);
  assert.match(appJs, /annulations: \{ titre: 'Annulations'/);
  assert.match(appJs, /class="sta-prod-pays"/);
});

test('changer de pays recalcule les unités affichées, pas seulement l’étiquette', () => {
  const fn = appJs.slice(appJs.indexOf('function produitsMarkup()'), appJs.indexOf('$(\'sta-produits\').addEventListener'));
  assert.match(fn, /const valeur = \(l\) => \(paysProduitsStats \? \(l\.pays\[paysProduitsStats\] \?\? 0\) : l\.unites\);/);
  // Le classement se retrie sur cette valeur, pas sur le total global : sinon
  // le premier produit resterait en tête même sans aucune vente dans ce pays.
  assert.match(fn, /\.sort\(\(a, b\) => b\.valeur - a\.valeur\)/);
});

test('un pays absent du classement en cours ne laisse pas un filtre invalide actif', () => {
  const fn = appJs.slice(appJs.indexOf('function produitsMarkup()'));
  assert.match(fn, /if \(paysProduitsStats && !pays\.includes\(paysProduitsStats\)\) paysProduitsStats = '';/);
});
