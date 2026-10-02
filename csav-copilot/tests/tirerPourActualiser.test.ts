import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

/*
 * Tirer pour actualiser, depuis le menu de gauche.
 *
 * CE QUE CES TESTS PROTÈGENT. Le geste fait ce que fait « Rafraîchir » —
 * relève du courrier, écran rechargé — plus les compteurs du menu ; il ne
 * part qu'au-delà d'un seuil ; et le relâcher n'ouvre pas l'écran survolé.
 */

const app = readFileSync(fileURLToPath(new URL('../public/app.js', import.meta.url)), 'utf8');
const geste = app.slice(app.indexOf('function installerTirage('), app.indexOf('installerTirage();'));

test('au-delà du seuil seulement, et depuis le haut du menu', () => {
  assert.match(app, /const SEUIL_TIRAGE = 64;/);
  assert.match(geste, /if \(distance < SEUIL_TIRAGE \|\| state\.refreshing\) \{/);
  assert.match(geste, /if \(colonne\.scrollTop > 0 \|\| state\.refreshing\) return;/);
  // Le champ de recherche du menu garde son comportement de champ.
  assert.match(geste, /event\.target\.closest\('input, textarea, select, \.shop-menu'\)/);
});

test('actualise tout le SAV : courrier, écran et compteurs', () => {
  assert.match(geste, /changesCountAt = 0;\s*await Promise\.all\(\[refreshCurrent\(\), refreshChangesCount\(\)\]\);/);
});

test('le relâcher n’ouvre pas l’écran survolé', () => {
  assert.match(geste, /ignorerClicJusqua = Date\.now\(\) \+ 400;/);
  assert.match(geste, /if \(Date\.now\(\) < ignorerClicJusqua\) \{\s*event\.preventDefault\(\);\s*event\.stopPropagation\(\);/);
  assert.match(app, /^installerTirage\(\);$/m);
});
