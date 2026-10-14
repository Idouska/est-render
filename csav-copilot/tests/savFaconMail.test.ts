import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

/*
 * L'écran SAV client, à la façon de Mail.
 *
 * CE QUE CES TESTS PROTÈGENT. Les chiffres de la file ont quitté leur bandeau
 * pour le sous-titre et la barre d'état ; chaque ligne écrit son statut en
 * mots ; la file, le message et la fiche tiennent dans une seule fenêtre —
 * sans casser le mode tableau, qui réduit cette fenêtre à une colonne.
 */

const lire = (chemin: string) =>
  readFileSync(fileURLToPath(new URL(`../${chemin}`, import.meta.url)), 'utf8');

const html = lire('public/dashboard.html');
const app = lire('public/app.js');
const css = lire('public/styles.css').replace(/\/\*[\s\S]*?\*\//g, '');

/** Le contenu du premier bloc `@media (min-width: 1201px)` qui contient `motif`. */
function bloc1201(motif: string): string {
  for (const m of css.matchAll(/@media\s*\(min-width:\s*1201px\)\s*\{/g)) {
    let profondeur = 1;
    let i = m.index + m[0].length;
    const debut = i;
    while (profondeur > 0 && i < css.length) {
      if (css[i] === '{') profondeur += 1;
      if (css[i] === '}') profondeur -= 1;
      i += 1;
    }
    const bloc = css.slice(debut, i - 1);
    if (bloc.includes(motif)) return bloc;
  }
  assert.fail(`aucun bloc @media (min-width: 1201px) ne contient « ${motif} »`);
}

test('les chiffres de la file vivent sous le titre et dans la barre d’état', () => {
  // Le bandeau reste dans le document, masqué : `loadMetrics` le remplit
  // d'abord et la barre d'état y lit ses valeurs.
  assert.match(html, /<section class="kpis" id="kpis" hidden/);
  assert.match(html, /<span class="kb-kpis" id="kb-kpis"><\/span>\s*<span class="kb-right" id="kb-state">/);
  assert.match(app, /state\.sousSav = `\$\{metrics\.pending \?\? 0\} en attente de vous/);
  assert.match(app, /if \(view === 'tickets'\) afficherSousSav\(\);/);
  // `setView` ne doit plus rouvrir le bandeau sur l'écran SAV.
  assert.doesNotMatch(app, /\$\('kpis'\)\.hidden = view !== 'tickets'/);
});

test('chaque ligne de la file écrit son statut en mots', () => {
  const ligne = app.slice(app.indexOf('<span class="queue-line2">'), app.indexOf('<span class="queue-prev">'));
  assert.match(ligne, /<span class="qstat st-\$\{ticket\.status\}">\$\{esc\(label\)\}<\/span>/);
  // Le point seul ne se lisait qu'au survol : il ne reste qu'en tableau.
  assert.doesNotMatch(ligne, /class="qdot/);
  // Le numéro de commande n'est pas répété quand le titre le porte déjà.
  assert.match(ligne, /ticket\.orderName && !ticket\.intent/);
});

test('l’en-tête du message montre le client avec son avatar', () => {
  assert.match(app, /<span class="tm-av" aria-hidden="true" style="background:\$\{avatarTint\(nom\)\}">/);
});

test('une seule fenêtre en colonnes, et le mode tableau la réduit à une colonne', () => {
  const bloc = bloc1201('#view-tickets.workspace');
  const fenetre = bloc.indexOf('#view-tickets.workspace {');
  const tableau = bloc.indexOf('#view-tickets.workspace.wide-queue');
  assert.ok(fenetre >= 0, 'la règle de la fenêtre a disparu');
  // Sans cette règle, `#view-tickets.workspace` (1-1-0) l'emporte sur
  // `.workspace.wide-queue` (0-2-0) : le tableau tiendrait dans la colonne
  // de la file, à côté de deux volets masqués.
  assert.ok(tableau > fenetre, 'le mode tableau doit être redéclaré après la fenêtre');
  assert.match(bloc.slice(tableau), /grid-template-columns:\s*minmax\(0,\s*1fr\)/);
});

test('les boutons de la réponse : l’envoi en haut à droite, les gestes engageants dessous', () => {
  const ordre = (sel: string) =>
    Number(css.match(new RegExp(`#draft-zone ${sel.replace(/[.#]/g, '\\$&')}\\s*\\{[^}]*order:\\s*(\\d+)`))?.[1]);
  const saut = Number(css.match(/#draft-zone \.actions::after\s*\{[^}]*order:\s*(\d+)/)?.[1]);
  assert.ok(ordre('#btn-save') < ordre('#btn-send'), 'Enregistrer précède Envoyer');
  assert.ok(ordre('#btn-send') < saut, "l'envoi reste sur la première rangée");
  assert.ok(saut < ordre('#btn-refund'), 'Rembourser passe sous la rangée de l’envoi');
});

test('un titre qui ne se coupe pas garde sa place dans l’en-tête', () => {
  // Vu sur « Modification — demandes au fournisseur » : le titre, interdit de
  // passer à la ligne, débordait de son bloc et glissait sous la recherche.
  const bloc = css.match(/@media \(min-width: 761px\) \{\s*\.head h1 \{ flex: none; white-space: nowrap; \}([\s\S]*?)\n\}/)?.[1] ?? '';
  // En grille, le plancher ne compte que le titre : le sous-titre s'abrège.
  assert.match(bloc, /\.head \.head-main \{[^}]*grid-template-columns: auto minmax\(0, 1fr\);[^}]*min-width: min-content;/);
  assert.match(bloc, /\.head \.head-main > h1 \{ min-width: max-content; \}/);
  assert.match(bloc, /\.head \.head-conn \{ overflow: hidden; \}/);
});

test('les dossiers tiennent sur une rangée, même avec une vraie boîte', () => {
  // Vu en production : « Réception 5885 · Brouillons 495 » repoussait
  // « Archivés » seul sur une seconde ligne, sous le contrôle segmenté.
  const piste = css.match(/#view-tickets \.folders\s*\{([^}]*)\}/)?.[1] ?? '';
  assert.match(piste, /flex-wrap:\s*nowrap/);
  const segment = css.match(/#view-tickets \.folder\s*\{([^}]*)\}/)?.[1] ?? '';
  assert.match(segment, /min-width:\s*0/);
  assert.match(segment, /text-overflow:\s*ellipsis/);
});
