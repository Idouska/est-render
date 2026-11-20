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

test('un dossier fermé reste à l’écran, replié sous son compte, et se rouvre', () => {
  const tableau = app.slice(app.indexOf('function tableauRetours('), app.indexOf('function listeRetoursMobile('));
  assert.match(app, /const RETOURS_FINIS = \['CLOSED', 'UNUSABLE'\];/);
  // Les en cours d'abord ; les fermés sous leur compte, dépliés d'un clic.
  assert.match(tableau, /data-ret-clos-bascule aria-expanded="\$\{Boolean\(r\.closOuverts\)\}"/);
  assert.match(tableau, /Fermés et non valides · \$\{finis\.length\}/);
  assert.match(tableau, /fini \? ' class="ret-clos"' : ''/);
  // Les dix plus récents, le reste sur demande.
  assert.match(tableau, /const finisAffiches = !r\.closOuverts \? \[\] : r\.voirClos \? finis : finis\.slice\(0, 10\);/);
  assert.match(app, /data-ret-clos-tous/);
  // Son statut reste un menu : on rouvre un dossier fermé par erreur.
  assert.match(app, /<select class="ret-statut ret-statut-\$\{[^}]+\}" data-ret-status=/);
  // Fermer un dossier déplie la section : il ne disparaît pas sous le repli.
  assert.match(app, /if \(status && RETOURS_FINIS\.includes\(status\.value\)\) state\.returns\.closOuverts = true;/);
  // La cellule des icônes reste une cellule de tableau.
  assert.doesNotMatch(styles, /#ret-body td:last-child \{ display: flex;/);
});

test('au téléphone : une liste compacte, et la fiche du dossier en plein écran', () => {
  const rendu = app.slice(app.indexOf('function renderReturnCases('), app.indexOf("$('ret-body')?.addEventListener('click', (event) => {\n  const ouvrir = event.target.closest('[data-retm-ouvrir]')"));
  assert.match(app, /const TEL_RETOUR = window\.matchMedia\('\(max-width: 760px\)'\);/);
  assert.match(rendu, /if \(!TEL_RETOUR\.matches\) \{\n\s+box\.innerHTML = tableauRetours\(items, finis\);/);
  assert.match(rendu, /box\.innerHTML = ficheRetourMobile\(ouvert\);/);
  assert.match(rendu, /box\.innerHTML = listeRetoursMobile\(items, finis\);/);
  // La fiche porte les mêmes attributs que le tableau : mêmes écouteurs.
  const fiche = app.slice(app.indexOf('function ficheRetourMobile('), app.indexOf('let defilementRetours'));
  for (const brique of ['retStatut(item)', 'retArticle(item)', 'retBon(item)', 'retColis(item)', 'data-ret-photos=', 'data-ret-del=']) {
    assert.ok(fiche.includes(brique), brique);
  }
  // Le Retour d'Android referme la fiche au lieu de quitter l'écran.
  assert.match(app, /history\.pushState\(\{ csavRetour: true \}, ''\);/);
  assert.match(app, /addEventListener\('popstate', \(\) => fermerFicheRetour\(\{ parHistorique: true \}\)\);/);
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
