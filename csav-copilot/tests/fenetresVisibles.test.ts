import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

/*
 * Une fenêtre ouverte doit se voir.
 *
 * `.backdrop` est en `display:none` tant qu'il ne porte pas `.open`. Retirer
 * `hidden` ne suffit donc pas : la fenêtre « Proposer un remplacement » est
 * sortie ainsi, le bouton ne faisait rien de visible, et aucun test ne l'a vu.
 */

const lire = (chemin: string) =>
  readFileSync(fileURLToPath(new URL(`../${chemin}`, import.meta.url)), 'utf8');

const app = lire('public/app.js');
const html = lire('public/dashboard.html');
const css = lire('public/styles.css');

const fenetres = [...html.matchAll(/<div class="backdrop[^"]*" id="([^"]+)"/g)].map((m) => m[1]);

test('le fond de fenêtre reste caché sans .open', () => {
  assert.match(css, /\.backdrop\s*\{[^}]*display:\s*none/);
  assert.match(css, /\.backdrop\.open\s*\{\s*display:\s*flex/);
});

test('toute fenêtre dont on retire hidden reçoit aussi .open', () => {
  assert.ok(fenetres.includes('subst-modal'));
  for (const id of fenetres) {
    const echappe = id.replace(/[-]/g, '\\-');
    if (!new RegExp(`\\$\\('${echappe}'\\)\\.hidden = false`).test(app)) continue;
    assert.match(
      app,
      new RegExp(`\\$\\('${echappe}'\\)\\.classList\\.add\\('open'\\)`),
      `#${id} est ouverte sans .open : elle resterait invisible`,
    );
  }
});

test('la fenêtre de remplacement se ferme en retirant .open', () => {
  assert.match(app, /function fermerFenetreSubstitution\(\)[\s\S]*?classList\.remove\('open'\)/);
  assert.doesNotMatch(app, /\$\('subst-modal'\)\.hidden = true;\s*\n\s*toast/);
});
