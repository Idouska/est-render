import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

/*
 * Deux pièges de la cascade, posés en garde-fou.
 *
 * CE QUE CES TESTS PROTÈGENT. Une déclaration CSS dont la valeur est invalide
 * n'échoue pas : elle est jetée, en silence. Rien dans la console, rien dans
 * les tests, et l'inspecteur affiche la règle barrée — encore faut-il aller la
 * regarder. L'élément garde alors ce qu'il avait avant, ou rien. C'est la
 * famille de défauts qui a coûté le plus cher sur cet écran, deux fois :
 *
 *   1. `background-image` exige un <image>. La couche « densité » redéfinit
 *      `--grad-surface` et `--grad-raised` en COULEURS plates. Toute règle
 *      écrite `background-image: var(--grad-raised)` est donc devenue
 *      invalide, et les cases de choix de palette se sont affichées
 *      transparentes : huit rectangles vides dans Réglages, sans un message
 *      d'erreur nulle part.
 *
 *   2. Une liste d'ombres ne tolère pas `none` parmi ses termes. Les règles
 *      écrites `box-shadow: var(--e4), var(--edge)` ont perdu leur ombre
 *      ENTIÈRE le jour où `--edge` est passé à `none` — les menus et modales
 *      se sont mis à flotter sans relief au-dessus du contenu, en clair
 *      seulement, ce que personne ne remarque en développant en sombre.
 *
 * Les deux tests lisent la feuille réellement servie et repartent des
 * définitions de jetons : ils restent justes si un thème en ajoute un.
 */

const CSS = fileURLToPath(new URL('../public/styles.css', import.meta.url));
const source = readFileSync(CSS, 'utf8');

// Les commentaires contiennent des exemples de code : les garder ferait
// signaler des règles qui n'existent pas.
const feuille = source.replace(/\/\*[\s\S]*?\*\//g, '');

/** Toutes les valeurs qu'un jeton prend, tous thèmes et toutes couches. */
const valeurs = new Map<string, Set<string>>();
for (const [, nom, valeur] of feuille.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
  const vues = valeurs.get(nom) ?? new Set<string>();
  vues.add(valeur.trim());
  valeurs.set(nom, vues);
}

const estImage = (valeur: string) =>
  valeur.includes('gradient(') || valeur.startsWith('url(') || valeur.startsWith('image(');

/** Découpe une valeur en termes, sans se laisser piéger par `rgb(0, 0, 0)`. */
const termes = (valeur: string) =>
  valeur
    .replace(/var\(\s*(--[a-z0-9-]+)[^)]*\)/g, '§$1')
    .replace(/\([^()]*\)/g, '()')
    .split(',')
    .map((terme) => terme.trim());

test('aucun `background-image` ne reçoit un jeton qui vaut une couleur', () => {
  const fautifs: string[] = [];

  for (const [, nom] of feuille.matchAll(/background-image\s*:\s*var\(\s*(--[a-z0-9-]+)/g)) {
    const couleurs = [...(valeurs.get(nom) ?? [])].filter((valeur) => !estImage(valeur));
    if (couleurs.length > 0) {
      fautifs.push(`${nom} vaut « ${couleurs[0]} » quelque part`);
    }
  }

  assert.deepEqual(
    fautifs,
    [],
    "`background-image` exige un <image> : un jeton qui porte une couleur rend " +
      'la déclaration invalide et le fond disparaît. Écrire `background: ' +
      'var(--…)`, qui accepte les deux.',
  );
});

test("aucune liste d'ombres ne mêle une ombre réelle à un jeton pouvant valoir `none`", () => {
  const peutEtreNone = (nom: string) => (valeurs.get(nom) ?? new Set()).has('none');
  const fautifs: string[] = [];

  for (const [, valeur] of feuille.matchAll(/box-shadow\s*:\s*([^;{}]+)/g)) {
    const parts = termes(valeur);
    // Une ombre seule a le droit de valoir `none` : c'est ainsi qu'on aplatit.
    if (parts.length < 2) continue;

    const jetons = parts.filter((terme) => terme.startsWith('§')).map((terme) => terme.slice(1));
    const reelles = jetons.filter((nom) => !peutEtreNone(nom));
    const fragiles = jetons.filter(peutEtreNone);

    if (reelles.length > 0 && fragiles.length > 0) {
      fautifs.push(`${valeur.trim().slice(0, 60)} — ${fragiles[0]} peut valoir none`);
    }
  }

  assert.deepEqual(
    fautifs,
    [],
    "`none` n'est pas une ombre : posé dans une liste, il invalide la " +
      "déclaration entière et l'élément perd TOUTES ses ombres, pas seulement " +
      'celle-là. Séparer les deux termes, ou renoncer au second.',
  );
});
