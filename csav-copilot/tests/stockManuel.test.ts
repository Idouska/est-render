import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

/*
 * Ajouter des paires au stock à la main.
 *
 * CE QUE CES TESTS PROTÈGENT. Une paire ajoutée à la main sert les commandes
 * comme une paire retournée — elle naît « en stock », une ligne par paire,
 * avec le modèle et la déclinaison du catalogue. Mais ce n'est pas un retour :
 * elle n'apparaît pas dans les dossiers et n'en gonfle pas le compte. Et
 * l'agence choisie est vérifiée, jamais recopiée.
 */

const lire = (chemin: string) =>
  readFileSync(fileURLToPath(new URL(`../${chemin}`, import.meta.url)), 'utf8');
const routes = lire('src/routes/returns.ts');
const app = lire('public/app.js');

test('une paire par ligne, née en stock, marquée « ajout manuel »', () => {
  const ajout = routes.slice(routes.indexOf("app.post('/api/returns/stock'"));
  assert.match(ajout, /quantite: z\.number\(\)\.int\(\)\.min\(1\)\.max\(50\)/);
  assert.match(ajout, /Array\.from\(\{ length: parsed\.data\.quantite \}/);
  assert.match(ajout, /origine: 'MANUEL',\s*status: 'RESTOCKED' as const,\s*restockedAt: maintenant,/);
  assert.match(lire('prisma/schema.prisma'), /origine String @default\("RETOUR"\)/);
});

test('l’agence est celle de la boutique, ou rien', () => {
  const ajout = routes.slice(routes.indexOf("app.post('/api/returns/stock'"));
  assert.match(ajout, /prisma\.returnAgency\.findFirst\(\{\s*where: \{ id: parsed\.data\.agencyId, merchantId \}/);
  assert.match(ajout, /if \(parsed\.data\.agencyId && !agence\) return reply\.code\(404\)/);
});

test('le modèle et la déclinaison viennent du catalogue', () => {
  assert.match(routes, /'\/api\/returns\/declinaisons'/);
  assert.match(routes, /listVariants\(client, \{ query: `product_title:\$\{quoteSearchValue\(produit\)\}`/);
  assert.match(app, /api\(`\/api\/variant-options\?\$\{new URLSearchParams\(\{ scope: 'PRODUCT', q: terme \}\)\}`\)/);
});

test('ce n’est pas un retour : ni dans les dossiers, ni dans leur compte', () => {
  assert.match(routes, /const retours = cases\.filter\(\(item\) => item\.origine !== 'MANUEL'\);/);
  assert.match(routes, /open: retours\.filter\(/);
  assert.match(app, /item\.origine !== 'MANUEL' && !\['CLOSED', 'UNUSABLE'\]\.includes\(item\.status\)/);
  // Mais bien dans le stock, présentée comme telle.
  assert.match(app, /`ajout manuel\$\{item\.note \? ` · \$\{esc\(item\.note\)\}` : ''\}`/);
});
