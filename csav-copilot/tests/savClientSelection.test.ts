import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

/*
 * SAV client : la sélection, la barre d'actions groupées et les deux menus.
 *
 * CE QUE CES TESTS PROTÈGENT. Quatre défauts vus en production :
 *   1. une ligne ouverte ET cochée prenait le fond pâle de « coché » sous le
 *      texte blanc de « ouverte » — illisible ;
 *   2. les huit commandes de la barre groupée retombaient sur cinq lignes
 *      inégales dans la colonne de la file ;
 *   3. le bouton « Filtres » de l'en-tête ouvrait sa fenêtre, que le même
 *      clic refermait en remontant jusqu'au document ;
 *   4. « Classer ce message » ne se refermait qu'en recliquant sur son titre.
 */

const lire = (chemin: string) =>
  readFileSync(fileURLToPath(new URL(`../${chemin}`, import.meta.url)), 'utf8');

const app = lire('public/app.js');
const css = lire('public/styles.css');

/** Le corps d'une fonction de l'écran, de sa signature à son accolade finale. */
const corps = (signature: string) => {
  const debut = app.indexOf(signature);
  assert.ok(debut >= 0, `${signature} introuvable`);
  return app.slice(debut, app.indexOf('\n}\n', debut) + 2);
};

test('une ligne ouverte et cochée garde son accent', () => {
  // Plus spécifique que `.qrow.picked .queue-item`, et posée après lui.
  const regle = '#view-tickets .qrow.picked .queue-item[aria-current="true"]';
  const pale = css.lastIndexOf('#view-tickets .qrow.picked .queue-item {');
  const accent = css.indexOf(regle);
  assert.ok(accent > pale, 'la règle de la ligne ouverte doit suivre celle de la ligne cochée');
  assert.match(css.slice(accent, css.indexOf('}', accent)), /background: var\(--accent\)/);
});

test('la case prend la place de l’avatar, à sa taille', () => {
  assert.match(css, /#view-tickets \.qpick \{ top: 11px; left: 24px; width: 28px; height: 28px; border-radius: 50%; \}/);
  assert.match(css, /#view-tickets \.qpick input \{\s+appearance: none;/);
  // Cochée : un rond plein, et la coche dessinée par-dessus.
  assert.match(css, /#view-tickets \.qpick input:checked \{ border-color: var\(--accent\); background: var\(--accent\); \}/);
  assert.match(css, /#view-tickets \.qpick:has\(input:checked\)::after \{/);
  // Au doigt, elle reste dans sa gouttière, à 24 px (WCAG 2.5.8).
  assert.match(css, /#view-tickets \.qpick \{ top: 13px; left: 21px; width: 24px; height: 24px; \}/);
});

test('la barre groupée tient en trois rangées fixes', () => {
  const barre = corps('function renderBulk(');
  const tete = barre.indexOf('class="bulk-tete"');
  const gestes = barre.indexOf('class="bulk-gestes"');
  const choix = barre.indexOf('class="bulk-choix"');
  assert.ok(tete > 0 && tete < gestes && gestes < choix, 'tête, gestes, choix — dans cet ordre');

  // « Tout décocher » en tête, à côté du compte ; Supprimer en bas, loin
  // des gestes courants.
  assert.ok(barre.indexOf('data-bulk="clear"') < gestes);
  assert.ok(barre.indexOf('data-bulk="delete"') > choix);
  for (const geste of ['read', 'unread', 'close', 'analyze']) {
    const rang = barre.indexOf(`data-bulk="${geste}"`);
    assert.ok(rang > gestes && rang < choix, geste);
  }
  // Les quatre gestes de même taille, deux par deux.
  assert.match(css, /\.bulk-gestes \{ display: grid; grid-template-columns: repeat\(2, minmax\(0, 1fr\)\); gap: 6px; \}/);
  assert.match(css, /#view-tickets \.bulk \{ flex-direction: column;/);
});

test('le bouton Filtres de l’en-tête ouvre vraiment sa fenêtre', () => {
  const debut = app.indexOf("$('queue-filter')?.addEventListener('click'");
  const gestionnaire = app.slice(debut, app.indexOf('});', debut));
  // Le clic s'arrête avant d'ouvrir la fenêtre, sinon l'écouteur « clic
  // dehors » du document la referme aussitôt.
  assert.ok(gestionnaire.indexOf('event.stopPropagation()') > 0);
  assert.ok(gestionnaire.indexOf('event.stopPropagation()') < gestionnaire.indexOf('ouvrirFiltres(!fenetreFiltresOuverte())'));
});

test('« Classer ce message » se ferme par la croix, à côté et par Échap', () => {
  const menu = corps('function renderTicketLabels(');
  assert.match(menu, /<button class="lmore-x" type="button" data-lmore-fermer aria-label="Fermer">×<\/button>/);
  assert.match(menu, /role="dialog" aria-label="Classer ce message"/);

  const fermer = corps('function fermerClasser(');
  assert.match(fermer, /details\.lmore\[open\]/);
  // Un clic dans le menu ne le referme pas ; ailleurs, oui ; la croix aussi.
  assert.match(app, /if \(event\.target\.closest\('\[data-lmore-fermer\]'\)\) return fermerClasser\(\);\n\s+fermerClasser\(event\.target\.closest\('details\.lmore'\)\);/);
  assert.match(app, /if \(event\.key === 'Escape'\) fermerClasser\(\);/);
});
