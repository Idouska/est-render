import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

/* Les vrais logos des transporteurs, là où l'on en a un fichier réutilisable. */
const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');

test('chaque logo annoncé existe, est un SVG, et sa provenance est notée', () => {
  const bloc = app.slice(app.indexOf('const LOGOS_TRANSPORTEUR = {'), app.indexOf('function logoTransporteur('));
  const fichiers = [...bloc.matchAll(/: '([a-z]+)',/g)].map((m) => m[1]!);
  assert.ok(fichiers.length >= 9);
  const sources = readFileSync(new URL('../public/transporteurs/SOURCES.md', import.meta.url), 'utf8');
  for (const f of fichiers) {
    const url = new URL(`../public/transporteurs/${f}.svg`, import.meta.url);
    assert.ok(existsSync(url), `${f}.svg manque`);
    const svg = readFileSync(url, 'utf8');
    assert.match(svg, /<svg[\s>]/);
    // Un logo ne doit rien exécuter ni aller chercher ailleurs.
    assert.doesNotMatch(svg, /<script|onload=|href="https?:/i);
    assert.ok(sources.includes(`${f}.svg`), `${f}.svg sans provenance`);
  }
});

test('sans logo, le nom reste affiché aux couleurs de la marque', () => {
  const pastille = app.slice(app.indexOf('function pastilleTransporteur('), app.indexOf('const envoiStock = '));
  assert.match(pastille, /const logo = logoTransporteur\(nom\);\n\s+if \(logo\) \{/);
  assert.match(pastille, /alt="\$\{esc\(logo\.nom\)\}"/);
  assert.match(pastille, /esc\(nom \|\| 'Transporteur \?'\)/);
});
