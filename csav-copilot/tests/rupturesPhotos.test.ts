import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

/*
 * « Mes ruptures » : la photo du modèle arrive avec la rupture.
 *
 * Elle venait des commandes du jour : une rupture sur une commande plus
 * ancienne n'affichait qu'un carré gris.
 */
const routes = readFileSync(new URL('../src/routes/supplierWorkspace.ts', import.meta.url), 'utf8');
const js = readFileSync(new URL('../public/workspace.js', import.meta.url), 'utf8');

test('le serveur joint la photo du modèle, lue dans le catalogue', () => {
  assert.match(routes, /image: photos\.get\(articles\.get\(ticket\.id\)\?\.produit \?\? ''\) \?\? null,/);
  const aide = routes.slice(routes.indexOf('async function photosDesModeles('), routes.indexOf('async function signalementsDeLAtelier('));
  assert.match(aide, /product_title:\$\{quoteSearchValue\(titre\)\}/);
  // Gardée une heure, introuvable compris ; Shopify en panne ne casse pas la liste.
  assert.match(aide, /photosModeles\.set\(`\$\{merchantId\}\|\$\{titre\}`, \{ expire: maintenant \+ 60 \* 60_000, image \}\);/);
  assert.match(aide, /\} catch \{/);
});

test('l’écran prend cette photo d’abord, celle de la commande du jour sinon', () => {
  assert.match(js, /if \(dossier\.image\) return dossier\.image;\n\s+const commande = state\.orders\.find/);
});
