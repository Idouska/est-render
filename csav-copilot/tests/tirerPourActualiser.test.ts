import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

/*
 * Tirer pour actualiser, depuis le menu de gauche et la liste des messages.
 *
 * CE QUE CES TESTS PROTÈGENT. Le geste fait ce que fait « Rafraîchir » —
 * relève du courrier, écran rechargé — plus les compteurs du menu ; il ne
 * part qu'au-delà d'un seuil ; et le relâcher n'ouvre pas l'écran survolé.
 *
 * Il se faisait seulement à la souris, en cliquant-glissant. Au trackpad d'un
 * Mac et au doigt, rien ne bougeait : le geste semblait avoir disparu.
 */

const app = readFileSync(fileURLToPath(new URL('../public/app.js', import.meta.url)), 'utf8');
const fin = "installerTirage($('queue')?.closest('.panel'), $('queue'));";
const geste = app.slice(app.indexOf('function enHautDuTirage('), app.indexOf(fin));

test('au-delà du seuil seulement, et depuis le haut', () => {
  assert.match(app, /const SEUIL_TIRAGE = 64;/);
  assert.match(geste, /if \(distance < SEUIL_TIRAGE \|\| state\.refreshing\) \{/);
  assert.match(geste, /if \(!enHautDuTirage\(event\.target, colonne, false\) \|\| state\.refreshing\) return;/);
  // Le champ de recherche du menu garde son comportement de champ.
  assert.match(geste, /event\.target\.closest\('input, textarea, select, \.shop-menu, button, a, label, \.queue-item'\)/);
});

test('« tout en haut » se vérifie de la cible jusqu’à la colonne, et la page', () => {
  // Selon la largeur, c'est la colonne, la liste ou la page qui défile.
  assert.match(geste, /for \(let el = cible; el && el !== document\.body; el = el\.parentElement\) \{\n\s+if \(el\.scrollTop > 0\) return false;/);
  assert.match(geste, /return !avecPage \|\| \(document\.scrollingElement\?\.scrollTop \?\? 0\) <= 0;/);
});

test('au trackpad : un geste commencé tout en haut, vers le bas', () => {
  assert.match(geste, /colonne\.addEventListener\(\s*'wheel',/);
  // L'élan d'une liste lancée vers le haut ne compte pas : seul un geste
  // commencé en haut, après un quart de seconde de calme.
  assert.match(geste, /if \(maintenant - dernierCran > 250\) \{\n\s+gesteEnHaut = enHautDuTirage\(event\.target, colonne, true\);/);
  assert.match(geste, /fin = setTimeout\(\(\) => void finir\(\), 260\);/);
  assert.match(geste, /\{ passive: true \},\n\s+\);\n\n\s+\/\* --- Au doigt/);
});

test('au doigt : le tirage suit le pouce, puis actualise au relâcher', () => {
  assert.match(geste, /colonne\.addEventListener\(\s*'touchmove',[\s\S]*?event\.preventDefault\(\);[\s\S]*?\{ passive: false \},/);
  assert.match(geste, /colonne\.addEventListener\('touchend', \(\) => \{\n\s+if \(departDoigt === null\) return;\n\s+departDoigt = null;\n\s+void finir\(\);/);
});

test('actualise tout le SAV : courrier, écran et compteurs', () => {
  assert.match(geste, /changesCountAt = 0;\s*await Promise\.all\(\[refreshCurrent\(\), refreshChangesCount\(\)\]\);/);
});

test('le relâcher n’ouvre pas l’écran survolé', () => {
  assert.match(geste, /ignorerClicJusqua = Date\.now\(\) \+ 400;/);
  assert.match(geste, /if \(Date\.now\(\) < ignorerClicJusqua\) \{\s*event\.preventDefault\(\);\s*event\.stopPropagation\(\);/);
});

test('dans le menu de gauche et dans la liste des messages', () => {
  assert.match(app, /^installerTirage\(document\.querySelector\('\.side'\)\);$/m);
  assert.match(app, /^installerTirage\(\$\('queue'\)\?\.closest\('\.panel'\), \$\('queue'\)\);$/m);
});
