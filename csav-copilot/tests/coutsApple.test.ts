import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

/*
 * Coûts SAV, à la façon des Réglages.
 *
 * CE QUE CES TESTS PROTÈGENT. Le mois choisi se lit d'abord en grand avec sa
 * composition ; le détail du calcul est fait de groupes de lignes, plus d'un
 * tableau à quatre colonnes ; et la page, réécrite de bout en bout, garde
 * chaque identifiant que le JavaScript remplit — la réécriture avait d'abord
 * perdu `decalerMoisCouts`, et les flèches du mois ne répondaient plus.
 */

const lire = (chemin: string) =>
  readFileSync(fileURLToPath(new URL(`../${chemin}`, import.meta.url)), 'utf8');

const html = lire('public/dashboard.html');
const app = lire('public/app.js');
const css = lire('public/styles.css').replace(/\/\*[\s\S]*?\*\//g, '');

const corps = (nom: string) => {
  const debut = app.indexOf(`function ${nom}(`);
  assert.ok(debut >= 0, `${nom} a disparu`);
  return app.slice(debut, app.indexOf('\n}\n', debut));
};

test('chaque élément que le JavaScript remplit existe dans la page', () => {
  const crees = new Set([...app.matchAll(/id="(couts-[a-z0-9-]+)"/g)].map((m) => m[1]));
  const lus = new Set([...app.matchAll(/\$\('(couts-[a-z0-9-]+)'\)/g)].map((m) => m[1]));
  for (const id of lus) {
    if (crees.has(id)) continue;
    assert.match(html, new RegExp(`id="${id}"`), id);
  }
  // Les flèches du mois appellent une fonction qui doit exister.
  assert.match(app, /\$\('couts-prec'\)\.addEventListener\('click', \(\) => decalerMoisCouts\(-1\)\)/);
  assert.match(app, /\nfunction decalerMoisCouts\(pas\) \{/);
});

test('le mois choisi se lit en grand, avec sa composition', () => {
  assert.match(html, /<section class="couts-hero" id="couts-tuiles" aria-label="Le mois en un coup d’œil">/);
  const tuiles = corps('renderCoutsTuiles');
  for (const classe of ['ch-principal', 'ch-total', 'ch-postes', 'ch-cote']) {
    assert.match(tuiles, new RegExp(`class="${classe}`), classe);
  }
});

test('le détail du calcul est fait de groupes de lignes', () => {
  const detail = corps('renderCoutsDetail');
  assert.doesNotMatch(detail, /<table/);
  assert.match(detail, /<div class="cd-groupe">/);
  // Sans coûts unitaires, un total ne vaut pas « 0,00 € » : il n'est pas connu.
  assert.match(detail, /const somme = \(centimes\) => \(renseignes \? euros\(centimes\) : '—'\);/);
  // Au téléphone, un libellé sur deux lignes ne colle pas au filet.
  const ligne = css.match(/#view-couts \.cd-ligne\s*\{([^}]*)\}/)?.[1] ?? '';
  assert.match(ligne, /padding:\s*[1-9]\d*px 14px/);
});

test('les modèles les plus retournés forment une liste', () => {
  const motifs = corps('renderCoutsMotifs');
  assert.match(motifs, /<ul class="cm-liste">/);
  assert.doesNotMatch(motifs, /<table/);
});
