import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

/*
 * Le fournisseur déclare une taille indisponible chez lui.
 *
 * CE QUE CES TESTS PROTÈGENT. C'est une information pour la boutique, rien de
 * plus : la déclaration est rangée chez nous, montrée en rouge dans le
 * Catalogue et sur les commandes concernées, et Shopify n'est jamais modifié —
 * la taille reste en vente tant que le marchand n'a pas décidé lui-même.
 */

const lire = (chemin: string) => readFileSync(fileURLToPath(new URL(chemin, import.meta.url)), 'utf8');
const atelier = lire('../src/routes/supplierWorkspace.ts');
const boutique = lire('../src/routes/suppliers.ts');
const app = lire('../public/app.js');
const espace = lire('../public/workspace.js');
const textes = lire('../public/workspace.i18n.js');

const routesAtelier = atelier.slice(
  atelier.indexOf('Ce que l\'atelier déclare indisponible'),
  atelier.indexOf("La fiche d'un produit : ses déclinaisons"),
);

test('la déclaration a sa table, une ligne par déclinaison et par atelier', () => {
  const schema = lire('../prisma/schema.prisma');
  const modele = schema.slice(schema.indexOf('model SupplierIndisponible {'));
  assert.match(modele, /@@unique\(\[merchantId, supplierId, variantId\]\)/);
  const dossiers = readdirSync(fileURLToPath(new URL('../prisma/migrations', import.meta.url)));
  const migration = dossiers.find((nom) => nom.endsWith('_indisponibles_atelier'));
  assert.ok(migration);
  assert.match(lire(`../prisma/migrations/${migration}/migration.sql`), /CREATE TABLE "SupplierIndisponible"/);
});

test("l'atelier lit et déclare sous son jeton, dans son seul périmètre", () => {
  assert.equal(routesAtelier.split("'/api/workspace/:id/indisponibles'").length - 1, 2);
  assert.equal(routesAtelier.split('await authorize(request, reply)').length - 1, 2);
  assert.match(routesAtelier, /merchantId: workspace\.merchantId, supplierId: workspace\.supplierId/);
  assert.match(routesAtelier, /ordersAccess === 'NONE'\) return reply\.code\(403\)/);
  assert.match(routesAtelier, /supplierIndisponible\.upsert/);
  assert.match(routesAtelier, /supplierIndisponible\.deleteMany/);
});

test('rien ne part vers Shopify : ni client, ni mutation', () => {
  // Le commentaire, lui, a le droit de nommer Shopify pour dire qu'on n'y touche pas.
  const code = routesAtelier.replace(/^\s*\*.*$/gm, '');
  assert.doesNotMatch(code, /shopify|graphql|inventory/i);
  const lecture = boutique.slice(boutique.indexOf("app.get('/api/indisponibles'"), boutique.indexOf("app.get('/api/suppliers'"));
  assert.match(lecture, /where: \{ merchantId \}/);
  assert.doesNotMatch(lecture, /shopify|graphql|\.(create|update|upsert|delete)(Many)?\(/i);
  assert.match(boutique.slice(0, boutique.indexOf("app.get('/api/indisponibles'")), /Shopify n'est pas modifié/);
});

test('la boutique le voit dans son Catalogue et sur les commandes du jour', () => {
  assert.match(app, /fetchJson\('\/api\/indisponibles'\)|\/api\/indisponibles/);
  assert.match(app, /function renderIndisponibles\(\)/);
  assert.match(lire('../public/dashboard.html'), /id="catalog-indispo"/);
  assert.match(app, /el-indispo/);
  assert.match(app, /Rien n’est modifié dans Shopify/);
});

test('une ligne de commande se reconnaît à sa référence ou à son modèle et sa taille', () => {
  const source = app.slice(app.indexOf('function ligneIndisponible('), app.indexOf('function renderIndisponibles('));
  const sansAccents = (texte: string) => texte.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  const ligneIndisponible = new Function('sansAccents', 'state', `${source}; return ligneIndisponible;`)(sansAccents, {});
  const declares = [{ productTitle: 'Kairo Runner 01', variantTitle: 'Blanc / Gris / 38', sku: 'KR-RUN-1-38' }];
  assert.equal(ligneIndisponible({ sku: 'KR-RUN-1-38', titre: 'Autre libellé', declinaison: 'Blanc / Gris / 38' }, declares), true);
  assert.equal(ligneIndisponible({ titre: 'Kairo Runner 01', declinaison: 'blanc / gris / 38' }, declares), true);
  assert.equal(ligneIndisponible({ titre: 'Kairo Runner 01', declinaison: 'Blanc / Gris / 39' }, declares), false);
  assert.equal(ligneIndisponible({ titre: 'Kairo Trail X', declinaison: 'Blanc / Gris / 38' }, declares), false);
});

test("l'atelier a son bouton, dans les trois langues", () => {
  assert.match(espace, /data-cat-indispo/);
  assert.match(espace, /fiche-indispo/);
  for (const cle of ['catalog.unavailable', 'catalog.markOut', 'catalog.markIn', 'catalog.markHint', 'catalog.markedOut', 'catalog.markedIn']) {
    assert.equal(textes.split(`'${cle}'`).length - 1, 3, cle);
  }
});
