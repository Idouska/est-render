import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
// @ts-expect-error — module navigateur sans déclaration de types.
import { LANGS, STRINGS } from '../public/workspace.i18n.js';

/*
 * Trois défauts vus en production.
 *
 *   1. Un dossier de retour passé à « Clos » disparaissait du tableau : on le
 *      croyait supprimé, et on ne pouvait plus le rouvrir.
 *   2. Le toast « Mode test activé » s'écrivait blanc sur blanc : une règle
 *      des surfaces flottantes lui donnait un fond clair sans toucher à son
 *      texte clair.
 *   3. Le téléchargement des commandes de l'atelier dormait derrière « ··· ».
 */

const lire = (chemin: string) =>
  readFileSync(fileURLToPath(new URL(`../${chemin}`, import.meta.url)), 'utf8');

const app = lire('public/app.js');
const styles = lire('public/styles.css');
const espace = lire('public/workspace.html');
const espaceJs = lire('public/workspace.js');

test('un dossier clos reste au tableau, sous son intertitre', () => {
  const debut = app.indexOf('function renderReturnCases(');
  const rendu = app.slice(debut, app.indexOf('\n}\n', debut));
  assert.match(app, /const RETOURS_FINIS = \['CLOSED', 'UNUSABLE'\];/);
  // Les en cours d'abord, puis les clos — jamais écartés.
  assert.match(rendu, /\$\{\[\.\.\.items, \.\.\.finisAffiches\]/);
  assert.match(rendu, /<tr class="ret-sep"><td colspan="7">Clos et inutilisables · \$\{finis\.length\}<\/td><\/tr>/);
  assert.match(rendu, /fini \? ' class="ret-clos"' : ''/);
  // Son statut reste un menu : on rouvre un dossier clos par erreur.
  assert.match(rendu, /<select data-ret-status=/);
  // Les dix plus récents, le reste sur demande.
  assert.match(rendu, /state\.returns\.voirClos \? finis : finis\.slice\(0, 10\)/);
  assert.match(app, /data-ret-clos-tous/);
  // La cellule des icônes reste une cellule de tableau.
  assert.doesNotMatch(styles, /#ret-body td:last-child \{ display: flex;/);
});

test('le toast garde son fond sombre', () => {
  // Aucune règle ne donne au toast le fond clair des surfaces flottantes.
  const regles = [...styles.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
  const fautives = regles.filter(
    ([, selecteurs, corps]) =>
      selecteurs!.split(',').some((s) => s.trim() === '.toast') && /background: var\(--grad-raised\)/.test(corps!),
  );
  assert.deepEqual(fautives.map(([, s]) => s!.trim()), []);
  assert.match(styles, /\.toast \{\n  position: fixed;[\s\S]*?background: var\(--ink\);\n  color: var\(--ground\);/);
});

test('l’atelier voit le bouton Télécharger sans ouvrir de menu', () => {
  const entete = espace.slice(espace.indexOf('<div class="wshead-acts">'), espace.indexOf('</header>', espace.indexOf('<div class="wshead-acts">')));
  assert.match(entete, /<a class="btn ws-dl" id="ws-xlsx" download/);
  assert.match(entete, /<span data-t="head.download">Télécharger<\/span>/);
  // Le CSV passe sous la petite flèche de Télécharger ; les dates, dans le
  // menu de la période. Plus de « ··· ».
  assert.match(entete, /id="ws-dl-plus" aria-haspopup="menu"/);
  assert.match(entete, /<a class="cmd-item" id="ws-csv" download/);
  assert.match(espace, /id="ws-more" aria-expanded="false" data-t="head\.dates"/);
  assert.match(espaceJs, /for \(const node of document\.querySelectorAll\('\[data-ttl\]'\)\) \{/);
  const table = STRINGS as Record<string, Record<string, string>>;
  for (const { code } of LANGS as Array<{ code: string }>) {
    for (const cle of ['head.download', 'head.dates', 'head.xlsx']) {
      assert.equal(typeof table[code]![cle], 'string', `${code} : ${cle}`);
    }
  }
});
