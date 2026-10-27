import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

/*
 * Le bouton Retour du navigateur.
 *
 * CE QUE CES TESTS PROTÈGENT. Par réflexe, on revient en arrière avec le
 * Retour du navigateur ou le geste du téléphone : il doit ramener à l'écran
 * précédent de l'outil, pas le quitter. Chaque écran a son entrée
 * d'historique et son adresse (`#update`), un rechargement rouvre le même,
 * et la flèche ‹ de la barre du haut fait la même chose au clic.
 */

const lire = (chemin: string) => readFileSync(fileURLToPath(new URL(chemin, import.meta.url)), 'utf8');
const app = lire('../public/app.js');

test('chaque écran pose son entrée d’historique, avant de fermer les fiches', () => {
  const corps = app.slice(app.indexOf('function setView(view, { depuisHistorique = false } = {})'));
  assert.ok(corps.length > 0, 'setView accepte depuisHistorique');
  const memo = corps.indexOf('if (!depuisHistorique) memoriserVue(view);');
  assert.ok(memo > 0 && memo < corps.indexOf('fermerMessagePile()'), 'l’entrée se pose avant la fermeture des fiches');
  assert.match(app, /history\.pushState\(\{ csavVue: view, rang: rangVue \}, '', adresse\)/);
  // Une fiche ouverte par-dessus : son entrée est remplacée, pas empilée.
  assert.match(app, /history\.replaceState\(\{ csavVue: view, rang: rangVue \}, '', adresse\)/);
});

test('Retour et Suivant changent d’écran sans recréer d’entrée', () => {
  assert.match(app, /addEventListener\('popstate', \(event\) => \{\n  const vue = event\.state\?\.csavVue;/);
  assert.match(app, /setView\(vue, \{ depuisHistorique: true \}\)/);
});

test('un rechargement rouvre l’écran de l’adresse, s’il est permis', () => {
  assert.match(app, /setView\(vueDeLAdresse\(\)\);/);
  assert.match(app, /return VIEW_META\[vue\] && !VIEW_META\[vue\]\.hidden \? vue : 'tickets';/);
  // Le retour de Google garde l'entrée de l'écran au lieu de l'effacer.
  assert.match(app, /history\.replaceState\(history\.state, ''/);
});

test('la flèche ‹ existe, absente sur le premier écran', () => {
  assert.match(lire('../public/dashboard.html'), /<button class="nav-retour" id="nav-retour" type="button" aria-label="Écran précédent"[\s\S]*?hidden>/);
  assert.match(app, /retour\.hidden = rangVue === 0;/);
  assert.match(app, /\$\('nav-retour'\)\?\.addEventListener\('click', \(\) => history\.back\(\)\);/);
  assert.match(lire('../public/styles.css'), /\.nav-retour\[hidden\] \{ display: none; \}/);
});
