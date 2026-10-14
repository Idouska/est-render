import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

/*
 * La vue d'ensemble, façon Apple.
 *
 * CE QUE CES TESTS PROTÈGENT. Trois rangées alignées au lieu de deux colonnes
 * qui dérivaient ; des lignes de priorité qui sont de vrais boutons ; un gras
 * réservé à ce qui réclame un geste ; et les deux couleurs de la tendance,
 * choisies parce qu'elles se distinguent pour un daltonien ET se voient sur le
 * fond — un orange plus clair (#e8860c) tombait à 2,6:1 sur le blanc.
 */

const lire = (chemin: string) =>
  readFileSync(fileURLToPath(new URL(`../${chemin}`, import.meta.url)), 'utf8');

const html = lire('public/dashboard.html');
const app = lire('public/app.js');
const css = lire('public/styles.css').replace(/\/\*[\s\S]*?\*\//g, '');

const vue = html.slice(html.indexOf('id="view-overview"'), html.indexOf('</section>\n', html.indexOf('id="ov-ia"')));

function luminance(hex: string): number {
  const canal = (i: number) => {
    const v = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * canal(0) + 0.7152 * canal(1) + 0.0722 * canal(2);
}
const ratio = (a: string, b: string) => {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
};

test('trois rangées, chacune un bloc large et un bloc étroit', () => {
  assert.equal((vue.match(/<div class="ov-rangee">/g) ?? []).length, 3);
  assert.equal((vue.match(/class="panel ov-large"/g) ?? []).length, 3);
  assert.doesNotMatch(vue, /class="cockpit/);
  // Tous les blocs gardent l'identifiant que le JavaScript remplit.
  for (const id of ['ov-prio-rows', 'ov-risk', 'ov-trend', 'ov-intents', 'ov-audit', 'ov-perf', 'ov-ia']) {
    assert.match(vue, new RegExp(`id="${id}"`), id);
  }
});

test('les priorités sont des lignes-boutons, plus un tableau', () => {
  assert.match(vue, /<ul class="ov-prio-liste" id="ov-prio-rows"><\/ul>/);
  assert.match(app, /<li><button class="ov-ligne" type="button" data-ov-id=/);
  assert.doesNotMatch(app, /<tr tabindex="0" role="button" data-ov-id/);
});

test('le gras est réservé à ce qui réclame un geste', () => {
  assert.match(app, /valeur === '0' \|\| valeur === '—' \? ' sv-nul' : ''/);
  assert.match(css, /#view-overview \.statrow-v\.sv-nul\s*\{[^}]*font-weight:\s*400/);
  // « Autant qu'hier » n'est ni bien ni mal.
  assert.match(app, /bon === null \|\| valeur\.direction === 'egal'/);
});

test('les deux séries de la tendance se voient sur leur fond', () => {
  const clair = css.match(/#view-overview\s*\{[^}]*--serie-recu:\s*(#[0-9a-f]{6});[^}]*--serie-traite:\s*(#[0-9a-f]{6})/i);
  const sombre = css.match(/\[data-theme="dark"\] #view-overview\s*\{[^}]*--serie-recu:\s*(#[0-9a-f]{6});[^}]*--serie-traite:\s*(#[0-9a-f]{6})/i);
  assert.ok(clair && sombre, 'les jetons des séries ont disparu');
  for (const couleur of [clair[1], clair[2]]) assert.ok(ratio(couleur, '#ffffff') >= 3, `${couleur} sur blanc`);
  for (const couleur of [sombre[1], sombre[2]]) assert.ok(ratio(couleur, '#191c23') >= 3, `${couleur} sur la surface sombre`);
  assert.match(css, /#view-overview \.tr-recu,\s*#view-overview \.ov-key-recu::before\s*\{\s*background:\s*var\(--serie-recu\)/);
});
