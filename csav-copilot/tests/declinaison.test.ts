import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { repartirDeclinaison } from '../src/services/shopify/declinaison.ts';
import { lireArticle } from '../src/services/suppliers/signalement.ts';

/*
 * « Couleur : 45 1/3 » — partout, pas seulement chez l'atelier.
 *
 * La première correction n'avait touché que le formulaire de l'atelier. La
 * fenêtre « Contacter le fournisseur » et la liste des tailles du catalogue
 * découpaient encore sur chaque barre oblique, et les signalements déjà
 * enregistrés gardaient leur pointure dans « Couleur ». Les trois découpages
 * — serveur, dashboard, atelier — doivent répondre pareil.
 */

const lire = (chemin: string) =>
  readFileSync(fileURLToPath(new URL(`../${chemin}`, import.meta.url)), 'utf8');

type Repartir = (v: string | null | undefined) => { couleur: string; taille: string };

/** Les deux fonctions de l'écran, extraites du fichier et exécutées seules. */
function depuisEcran(fichier: string): Repartir {
  const code = lire(fichier);
  const source = ['function ressembleAUneTaille(', 'function repartirDeclinaison(']
    .map((signature) => {
      const debut = code.indexOf(signature);
      assert.ok(debut >= 0, `${fichier} : ${signature} introuvable`);
      return code.slice(debut, code.indexOf('\n}\n', debut) + 2);
    })
    .join('\n');
  return new Function(`${source}\nreturn repartirDeclinaison;`)() as Repartir;
}

const CAS: Array<[string, { couleur: string; taille: string }]> = [
  ['45 1/3', { couleur: '', taille: '45 1/3' }],
  ['Lucid Red / 45 1/3', { couleur: 'Lucid Red', taille: '45 1/3' }],
  ['42 / Black', { couleur: 'Black', taille: '42' }],
  ['38,5', { couleur: '', taille: '38,5' }],
  ['Black / Rouge', { couleur: 'Black / Rouge', taille: '' }],
  ['Verre soufflé', { couleur: 'Verre soufflé', taille: '' }],
  ['', { couleur: '', taille: '' }],
];

test('serveur, dashboard et atelier rangent la pointure au même endroit', () => {
  const versions = {
    serveur: repartirDeclinaison,
    dashboard: depuisEcran('public/app.js'),
    atelier: depuisEcran('public/workspace.js'),
  };
  for (const [variante, attendu] of CAS) {
    for (const [ou, repartir] of Object.entries(versions)) {
      assert.deepEqual(repartir(variante), attendu, `${ou} : « ${variante} »`);
    }
  }
});

test('la fenêtre « Contacter le fournisseur » ne découpe plus sur chaque barre', () => {
  const app = lire('public/app.js');
  assert.match(app, /const \{ couleur: color, taille: size \} = repartirDeclinaison\(item\?\.variantTitle\);/);
  assert.doesNotMatch(app, /variantTitle \?\? ''\)\s*\.split\('\/'\)/);
});

test('la liste des tailles du catalogue propose « 45 1/3 », pas « 45 1 »', () => {
  const commerce = lire('src/routes/commerce.ts');
  assert.match(commerce, /const \{ taille \} = repartirDeclinaison\(raw\);/);
  assert.doesNotMatch(commerce, /raw\.split\('\/'\)/);
});

test('un ancien signalement relu remet la pointure dans « Taille »', () => {
  const ancien = 'Article : Adidas Adizero Adios Pro 4\nCouleur : 45 1/3\nRéférence : JR6368\nQuantité : 1';
  const lu = lireArticle(ancien);
  assert.equal(lu.taille, '45 1/3');
  assert.equal(lu.couleur, null);

  // Une vraie couleur reste une couleur, et une taille déjà là n'est pas écrasée.
  assert.equal(lireArticle('Couleur : Lucid Red').couleur, 'Lucid Red');
  const deux = lireArticle('Couleur : 44\nTaille : 45');
  assert.deepEqual([deux.couleur, deux.taille], ['44', '45']);
});
