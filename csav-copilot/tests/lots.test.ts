import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
// @ts-expect-error — module navigateur sans déclaration de types.
import { LANGS, STRINGS } from '../public/workspace.i18n.js';
import { resumeArticles, statutDeLaCommande } from '../src/services/envoi/statutLot.ts';

/*
 * Le lot du jour, suivi après l'envoi.
 *
 * CE QUE CES TESTS PROTÈGENT. « Expédiée » se lit dans les colis, jamais
 * déclaré à côté d'eux ; un atelier ne touche que SES lots ; et celui qui
 * reçoit les commandes par fichier peut les voir dans son espace, même en
 * accès « commandes confiées ».
 */

const lire = (chemin: string) =>
  readFileSync(fileURLToPath(new URL(`../${chemin}`, import.meta.url)), 'utf8');

test('le statut d’une commande : les colis d’abord, puis le geste de l’atelier', () => {
  assert.equal(statutDeLaCommande({ enProductionLe: null, colis: 0 }), 'A_PREPARER');
  assert.equal(statutDeLaCommande({ enProductionLe: new Date(), colis: 0 }), 'EN_PRODUCTION');
  // Un colis saisi l'emporte : l'atelier n'a pas à déclarer qu'il a expédié.
  assert.equal(statutDeLaCommande({ enProductionLe: null, colis: 1 }), 'EXPEDIEE');
  assert.equal(statutDeLaCommande({ enProductionLe: new Date(), colis: 2 }), 'EXPEDIEE');
});

test('les articles partent avec la commande, en une ligne', () => {
  assert.equal(
    resumeArticles([
      { titre: 'Nike Mind 001', declinaison: 'Noir / 45', quantite: 2 },
      { titre: 'Lacets', declinaison: null, quantite: 1 },
    ]),
    '2 × Nike Mind 001 · Noir / 45, Lacets',
  );
  assert.match(lire('src/services/envoi/quotidien.ts'), /articles: resumeArticles\(commande\.lignes\),/);
});

test('un atelier ne lit et ne lance que ses propres lots', () => {
  const service = lire('src/services/envoi/lots.ts');
  assert.match(service, /\.\.\.\(params\.supplierId \? \{ supplierId: params\.supplierId \} : \{\}\)/);
  assert.match(service, /envoi: \{ supplierId: params\.supplierId \},/);

  const routes = lire('src/routes/supplierWorkspace.ts');
  assert.match(routes, /lotsRecents\(\{ merchantId: workspace\.merchantId, supplierId: workspace\.supplierId \}\)/);
  assert.match(routes, /marquerEnProduction\(\{\s*merchantId: workspace\.merchantId,\s*supplierId: workspace\.supplierId,/);
});

test('en accès « confiées », les commandes reçues par fichier sont visibles', () => {
  const routes = lire('src/routes/supplierWorkspace.ts');
  const acces = routes.slice(routes.indexOf('async function allowedOrderIds'), routes.indexOf('async function otherSupplierRules'));
  assert.match(acces, /prisma\.envoiCommande\.findMany\(\{[\s\S]*?envoi: \{ supplierId: workspace\.supplierId/);
  assert.match(acces, /\.\.\.lots\.map\(\(row\) => row\.shopifyOrderId\)/);
});

test('l’atelier suit ses lots dans « Commandes », et saisit le colis au guichet habituel', () => {
  const html = lire('public/workspace.html');
  const js = lire('public/workspace.js');
  assert.match(html, /data-sous="lots"/);
  assert.match(html, /<section id="view-lots" hidden>/);
  assert.match(js, /orders: \['orders', 'tracking', 'lots'\]/);
  // Pas de second formulaire de colis : la commande s'ouvre par sa recherche.
  const saisir = js.slice(js.indexOf('function saisirColisDuLot('));
  assert.match(saisir, /void chercherCommande\(numero\);/);

  const appelees = new Set([
    ...[...js.matchAll(/\bt\('(lots\.[\w.]+)'/g)].map((m) => m[1]!),
    ...['A_PREPARER', 'EN_PRODUCTION', 'EXPEDIEE'].map((statut) => `lots.s.${statut}`),
    'sous.lots',
  ]);
  assert.ok(appelees.size >= 14);
  for (const { code } of LANGS as Array<{ code: string }>) {
    const table = (STRINGS as Record<string, Record<string, string>>)[code]!;
    assert.deepEqual([...appelees].filter((cle) => typeof table[cle] !== 'string'), [], `${code} : une clé absente`);
  }
});

test('le marchand voit l’avancement de chaque envoi', () => {
  assert.match(lire('src/routes/envoiQuotidien.ts'), /lotsRecents\(\{ merchantId \}\)/);
  const app = lire('public/app.js');
  assert.match(app, /\$\{lot \? avancementDuLot\(lot\) : ''\}/);
});
