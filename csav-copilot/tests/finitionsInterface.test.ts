import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

/*
 * Finitions d'interface.
 *
 * CE QUE CES TESTS PROTÈGENT. La console admin ne repasse jamais par les
 * fenêtres du navigateur (« csav-api.onrender.com indique… ») ; la
 * suppression d'une boutique exige toujours le domaine tapé, mais dans la
 * fenêtre de l'outil. Le lien d'invitation de secours se copie, il ne
 * s'affiche pas d'office : affiché, il finissait en capture d'écran. Le
 * sélecteur de boutiques montre le nom de la boutique, pas le préfixe de son
 * domaine. Le classement produits montre une photo, ou des initiales.
 */

const lire = (chemin: string) => readFileSync(fileURLToPath(new URL(`../${chemin}`, import.meta.url)), 'utf8');
const sansCommentaires = (code: string) => code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/[^\n]*/gm, '');

const adminJs = sansCommentaires(lire('public/admin.js'));
const alerte = lire('public/alerte.js');
const appJs = lire('public/app.js');
const dashboard = lire('public/dashboard.html');

test('la console admin n’ouvre plus aucune fenêtre du navigateur', () => {
  assert.doesNotMatch(adminJs, /\bconfirm\(|\bprompt\(|\balert\(/);
  assert.match(adminJs, /import \{ demander, saisir \} from '\.\/alerte\.js';/);
});

test('l’alerte à saisir n’allume son bouton que sur le texte attendu', () => {
  assert.match(alerte, /export function saisir\(options\)/);
  assert.match(alerte, /\$\{champ\?\.attendu \? ' disabled' : ''\}/);
  assert.match(alerte, /valider\.disabled = !conforme\(\);/);
  assert.match(alerte, /if \(bouton && !bouton\.disabled\) fermer/);
});

test('le lien d’invitation de secours se copie, il ne s’affiche pas d’office', () => {
  assert.match(dashboard, /id="team-f-link-copy">Copier le lien<\/button>/);
  assert.match(dashboard, /<code id="team-f-link-url" hidden><\/code>/);
  assert.match(appJs, /await navigator\.clipboard\.writeText\(url\);/);
  // Le lien n'apparaît que si la copie échoue.
  const copie = appJs.slice(appJs.indexOf("$('team-f-link-copy').addEventListener"));
  assert.match(copie, /catch \{\s*\$\('team-f-link-url'\)\.hidden = false;/);
});

test('le nom de la boutique vient de Shopify, jamais par-dessus celui choisi par le marchand', () => {
  const service = lire('src/services/shopify/nomBoutique.ts');
  assert.match(service, /query NomBoutique \{ shop \{ name \} \}/);
  assert.match(service, /data: \{ name: nom \}/);
  const shops = lire('src/routes/shops.ts');
  assert.match(shops, /merchant\.status === 'ACTIVE' && !merchant\.brandName && !merchant\.name/);
  assert.match(lire('src/routes/auth.shopify.ts'), /if \(!merchant\.name\) await nommerBoutique\(merchant\.id\);/);
});

test('le classement produits montre une photo, ou des initiales à défaut', () => {
  assert.match(lire('src/services/shopify/produitsPeriode.ts'), /url\(transform: \{ maxWidth: 96, maxHeight: 96 \}\)/);
  const rendu = appJs.slice(appJs.indexOf('function produitsMarkup()'));
  assert.match(rendu, /const photoDe = \(l\) => l\.image \?\?/);
  assert.match(rendu, /sta-initiales/);
});
