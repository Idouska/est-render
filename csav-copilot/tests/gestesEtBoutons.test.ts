import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { STRINGS } from '../public/workspace.i18n.js';

/*
 * Les gestes du doigt et du trackpad, les horloges, et des boutons qui se
 * lisent à leur libellé.
 *
 * CE QUE CES TESTS PROTÈGENT. Le menu ne s'ouvrait et ne se fermait qu'au
 * bouton ; la fenêtre des horloges ne se refermait qu'en touchant à côté ;
 * cinq cadrans passaient sur deux lignes ; et des « ＋ », « ⚡ », « → » ou
 * « ↗ » tapés dans les libellés faisaient des boutons de site web, pas
 * d'Apple.
 */

const lire = (chemin: string) =>
  readFileSync(fileURLToPath(new URL(`../${chemin}`, import.meta.url)), 'utf8');

const app = lire('public/app.js');
const dashboard = lire('public/dashboard.html');
const espace = lire('public/workspace.js');
const espaceHtml = lire('public/workspace.html');

const corps = (signature: string) => {
  const debut = app.indexOf(signature);
  assert.ok(debut >= 0, `${signature} introuvable`);
  return app.slice(debut, app.indexOf('\n}\n', debut) + 2);
};

test('quatre horloges, sans Agadir', () => {
  const horloges = app.slice(app.indexOf('const CLOCKS = ['), app.indexOf('];', app.indexOf('const CLOCKS = [')));
  assert.doesNotMatch(horloges, /Agadir|Casablanca/);
  assert.deepEqual(
    [...horloges.matchAll(/\['([^']+)'/g)].map((m) => m[1]),
    ['Paris', 'Chine', 'New York', 'Los Angeles'],
  );
});

test('un glissé ne se décide qu’au dixième pixel, et franchement horizontal', () => {
  assert.match(app, /if \(Math\.hypot\(dx, dy\) < 10\) return;/);
  assert.match(app, /geste\.horizontal = Math\.abs\(dx\) > Math\.abs\(dy\) \* 1\.5;/);
  // Ce qui défile déjà en largeur garde son glissé.
  assert.match(corps('function defileEnLargeur('), /n\.scrollWidth > n\.clientWidth \+ 1/);
});

test('le menu s’ouvre vers la droite, se ferme vers la gauche', () => {
  const depart = corps('function gesteAuDepart(');
  assert.match(depart, /return cible\.closest\('\.side, #scrim'\) \? 'fermer' : null;/);
  assert.match(depart, /if \(cible\.closest\(SANS_GLISSE\) \|\| defileEnLargeur\(cible\)\) return null;/);
  // Un message ou une commande ouverts en plein écran : vers la droite,
  // retour à la liste.
  assert.match(depart, /classList\.contains\('pile-message'\)\) return 'retour';/);
  assert.match(depart, /classList\.contains\('pile-fiche'\)\) return 'retourCommande';/);
  const conclure = corps('function conclureGeste(');
  assert.match(conclure, /toggleNav\(franchi && dx > 0\);/);
  assert.match(conclure, /toggleNav\(!\(franchi && dx < 0\)\);/);
  assert.match(conclure, /if \(franchi && dx > 0\) \(type === 'retour' \? fermerMessagePile : fermerFichePile\)\(\);/);
  // Le menu suit le doigt.
  assert.match(corps('function poserTiroir('), /side\.style\.transform = `translateX\(\$\{x\}px\)`;/);
});

test('les horloges s’écartent à gauche ou à droite, au doigt et au trackpad', () => {
  assert.match(corps('function gesteAuDepart('), /return cible\.closest\('#clockpop'\) \? 'horloges' : null;/);
  assert.match(corps('function conclureGeste('), /if \(franchi\) return ecarterHorloges\(Math\.sign\(dx\)\);/);
  assert.match(corps('function ecarterHorloges('), /translateX\(\$\{vers \* \(innerWidth \+ 40\)\}px\)/);
  assert.match(app, /glisseTrackpad\(\$\('clockpop'\), ecarterHorloges\);/);
  // Au trackpad, la colonne se replie et se déplie aussi.
  assert.match(app, /\} else replierColonne\(vers < 0\);/);
});

test('aucun émoji ni flèche tapée dans un bouton', () => {
  const interdits = /[＋⚡↗→←‹›✕✆☎📷]/u;
  const boutons = (source: string) =>
    [...source.matchAll(/<(button|a)\b[^>]*>([\s\S]*?)<\/\1>/g)]
      .map((m) => m[2])
      .filter((contenu) => interdits.test(contenu));
  assert.deepEqual(boutons(dashboard), []);
  assert.deepEqual(boutons(espaceHtml), []);
  assert.deepEqual(boutons(app), []);
  assert.deepEqual(boutons(espace), []);
  for (const lang of ['fr', 'en', 'zh'] as const) {
    assert.doesNotMatch((STRINGS[lang] as Record<string, string>)['ticket.new']!, /＋|\+/);
  }
  // Précédent et suivant restent, dessinés au trait.
  assert.match(app, /prec: '<path d="M10 3\.5 5\.5 8l4\.5 4\.5"\/>'/);
  assert.match(espace, /aria-label="\$\{esc\(t\('focus\.prev'\)\)\}">\$\{ICO_PREC\}<\/button>/);
});
