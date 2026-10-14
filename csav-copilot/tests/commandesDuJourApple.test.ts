import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

/*
 * Commandes du jour, façon Apple.
 *
 * CE QUE CES TESTS PROTÈGENT. Ce qui part est rangé par atelier, les commandes
 * sans fournisseur en dernier ; l'envoi se confirme dans une feuille qui dit
 * à qui part quoi, plus dans la boîte du navigateur ; le rouge est réservé au
 * retard ; et la page réécrite garde chaque identifiant que le JavaScript lit.
 */

const lire = (chemin: string) =>
  readFileSync(fileURLToPath(new URL(`../${chemin}`, import.meta.url)), 'utf8');

const html = lire('public/dashboard.html');
const app = lire('public/app.js');
const css = lire('public/styles.css').replace(/\/\*[\s\S]*?\*\//g, '');

const corps = (nom: string) => {
  const debut = app.indexOf(`function ${nom}(`);
  assert.ok(debut >= 0, `${nom} a disparu`);
  return app.slice(debut, app.indexOf('\n}\n', debut) + 2);
};

test('chaque élément que le JavaScript lit existe dans la page', () => {
  const lus = new Set([...app.matchAll(/\$\('(envoi-[a-z0-9-]+)'\)/g)].map((m) => m[1]));
  assert.ok(lus.size >= 20, `seulement ${lus.size} identifiants lus`);
  for (const id of lus) assert.match(html, new RegExp(`id="${id}"`), id);
});

test('ce qui part est rangé par atelier, les commandes orphelines en dernier', () => {
  const ranger = new Function(`${corps('commandesParFournisseur')}; return commandesParFournisseur;`)();
  const rossi = { id: 'r', name: 'Atelier Rossi' };
  const duval = { id: 'd', name: 'Manufacture Duval' };
  const groupes = ranger([
    { id: '1', fournisseur: null },
    { id: '2', fournisseur: duval },
    { id: '3', fournisseur: rossi },
    { id: '4', fournisseur: duval },
  ]);
  assert.deepEqual(
    groupes.map((g: { fournisseur: { name: string } | null; commandes: { id: string }[] }) => [
      g.fournisseur?.name ?? null,
      g.commandes.map((c) => c.id),
    ]),
    [
      ['Atelier Rossi', ['3']],
      ['Manufacture Duval', ['2', '4']],
      [null, ['1']],
    ],
  );
  assert.match(corps('renderEnvoi'), /const groupes = commandesParFournisseur\(partiront\);/);
});

test('l’envoi se confirme dans une feuille, plus dans la boîte du navigateur', () => {
  assert.match(html, /<div class="backdrop" id="envoi-modal" role="dialog" aria-modal="true" aria-labelledby="envoi-m-titre" hidden>/);
  assert.match(app, /\$\('envoi-go'\)\?\.addEventListener\('click', ouvrirEnvoiFournisseur\);/);
  for (const nom of ['ouvrirEnvoiFournisseur', 'envoyerAuFournisseur']) {
    assert.doesNotMatch(corps(nom), /confirm\(/, nom);
  }
  // Annuler a le focus : Entrée ne part pas par mégarde chez l'atelier.
  assert.match(corps('ouvrirEnvoiFournisseur'), /\$\('envoi-m-annuler'\)\.focus\(\);/);
});

test('le rouge est réservé au retard', () => {
  assert.match(app, /A_PREPARER: \{ label: 'À préparer', tone: 'mute' \}/);
  // `.envoi-sans` teignait toute la ligne : seul le titre du groupe rougit.
  assert.match(css, /#view-envoi \.envoi-groupe\.envoi-sans\s*\{\s*color:\s*inherit;/);
});

test('la journée en quatre chiffres, zéro en gris', () => {
  assert.match(html, /<section class="envoi-kpis" id="envoi-kpis"/);
  assert.match(corps('renderEnvoi'), /<b class="ek-v\$\{n \? '' : ' ek-nul'\}">\$\{n\}<\/b>/);
  assert.match(css, /#view-envoi \.ek-v\.ek-nul\s*\{[^}]*font-weight:\s*400/);
});
