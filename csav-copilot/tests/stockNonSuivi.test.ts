import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { stockSuivi } from '../src/services/shopify/catalog.ts';

/*
 * Un stock que Shopify ne suit pas n'est pas un stock à zéro.
 *
 * Une boutique dont le fournisseur expédie ne tient pas son stock dans
 * Shopify : chaque article y vaut « 0 ». Le catalogue affichait alors
 * « Épuisé » sur tous les modèles et toutes les tailles.
 */
test('non suivi : ni chiffre ni « épuisé » ; suivi : le chiffre, zéro compris', () => {
  assert.equal(stockSuivi(false, 0), null);
  assert.equal(stockSuivi(true, 0), 0);
  assert.equal(stockSuivi(true, 12), 12);
  // Une réponse sans l'information (ancienne boutique de démo) reste telle quelle.
  assert.equal(stockSuivi(undefined, 5), 5);
  assert.equal(stockSuivi(null, 0), 0);
});

test('la liste et la fiche demandent à Shopify si le stock est suivi', () => {
  const source = readFileSync(new URL('../src/services/shopify/catalog.ts', import.meta.url), 'utf8');
  assert.match(source, /totalInventory\n\s+tracksInventory\n/);
  assert.match(source, /inventoryItem \{\n\s+tracked\n/);
  assert.match(source, /totalInventory: stockSuivi\(product\.tracksInventory, product\.totalInventory\),/);
});

test('l’espace fournisseur ne dit « épuisé » que pour un zéro connu', () => {
  const js = readFileSync(new URL('../public/workspace.js', import.meta.url), 'utf8');
  assert.match(js, /const estEpuise = \(item\) => item\.totalInventory === 0;/);
  assert.match(js, /\$\('catalog-dispo'\)\.hidden = !stockConnu;/);
});
