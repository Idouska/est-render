import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

/*
 * Deux retours sur la colonne de gauche et la liste des messages.
 *
 *   1. Au démarrage, le premier message s'ouvrait seul et sa ligne se
 *      remplissait de l'accent : une discussion en couleur alors qu'on n'avait
 *      rien sélectionné. Comme dans Mail, elle reste grise jusqu'au clic.
 *   2. La navigation repliée ne montrait que des icônes, sans nom au survol.
 */

const lire = (chemin: string) =>
  readFileSync(fileURLToPath(new URL(`../${chemin}`, import.meta.url)), 'utf8');

const app = lire('public/app.js');
const css = lire('public/styles.css');
const dashboard = lire('public/dashboard.html');

const corps = (signature: string) => {
  const debut = app.indexOf(signature);
  assert.ok(debut >= 0, `${signature} introuvable`);
  return app.slice(debut, app.indexOf('\n}\n', debut) + 2);
};

test('le message ouvert au démarrage reste gris jusqu’au clic', () => {
  const choisir = corps('async function selectTicket(');
  // Ouvert en silence et nouveau : automatique. Rechargé en silence après une
  // action : il garde ce qu'il était. Cliqué : choisi.
  assert.match(choisir, /state\.ouvertureAuto = silent \? autreTicket \|\| state\.ouvertureAuto : false;/);
  assert.match(choisir, /item\.classList\.toggle\('q-auto', courant && state\.ouvertureAuto\);/);
  assert.match(app, /\$\{ticket\.id === state\.currentId && state\.ouvertureAuto \? ' q-auto' : ''\}" data-id="\$\{ticket\.id\}"/);
  // Le démarrage ouvre bien en silence.
  assert.match(app, /if \(state\.tickets\.length > 0\) await selectTicket\(state\.tickets\[0\]\.id, \{ silent: true \}\);/);
});

test('l’accent est réservé au message choisi', () => {
  const regles = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
  const fautives = regles.filter(
    ([, selecteurs, corps]) =>
      /background: var\(--accent\)|color: var\(--on-accent\)/.test(corps!) &&
      selecteurs!
        .split(',')
        .some((s) => s.includes('#view-tickets') && s.includes('.queue-item[aria-current="true"]') && !s.includes(':not(.q-auto)')),
  );
  assert.deepEqual(fautives.map(([, s]) => s!.trim()), []);
  assert.match(css, /#view-tickets \.queue-item\.q-auto\[aria-current="true"\],\n#view-tickets \.queue-item\.q-auto\[aria-current="true"\]:hover \{\n\s+background: color-mix\(in srgb, var\(--ink\) 8%, transparent\);/);
});

test('repliée, la navigation dit le nom du bouton survolé', () => {
  assert.match(app, /const BULLE_SIDE_CIBLES = '\.nav-item, #shop-switch, #side-fold, #compte-btn';/);
  // Hors de la colonne, qui coupe ce qui dépasse.
  assert.match(app, /document\.body\.append\(bulleSide\);/);
  assert.match(app, /bulleSide\.setAttribute\('role', 'tooltip'\);/);
  const nom = corps('function nomDansLaBulle(');
  assert.match(nom, /cible\.querySelector\('\.nav-label'\)\?\.textContent/);
  // Dépliée, les boutons portent déjà leur nom.
  const proposer = corps('function proposerBulleSide(');
  assert.match(proposer, /if \(!cible \|\| \(!repliee && cible\.id !== 'side-fold'\)\) return cacherBulleSide\(\);/);
  // Au clavier aussi.
  assert.match(app, /colonne\?\.addEventListener\('focusin', \(event\) => \{/);
  // Une seule infobulle : celle du navigateur ne vient plus s'y superposer.
  assert.doesNotMatch(dashboard, /id="side-fold"[^>]*title=/);
  // Elle apparaît et s'efface en fondu.
  assert.match(css, /\.side-bulle \{[\s\S]*?pointer-events: none;\n\s+opacity: 0;[\s\S]*?transition: opacity 0\.14s ease, transform 0\.14s ease;/);
  assert.match(css, /\.side-bulle\.side-bulle-visible \{ opacity: 1; transform: translate\(0, -50%\); \}/);
});
