import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

/*
 * Les filtres de la file : une seule recherche, et tous les libellés.
 *
 * CE QUE CES TESTS PROTÈGENT. Deux champs de recherche se regardaient à
 * quelques pixels l'un de l'autre — celui de l'en-tête, qui ouvre la palette,
 * et celui de la barre de filtres, qui filtrait la file. Le second a été
 * retiré ; le terme actif se lit désormais sur un jeton qu'une croix retire.
 *
 * Les libellés, eux, étaient plafonnés à six, les autres repliés derrière un
 * « +3 » — sur onze libellés Gmail chez ce marchand, cinq filtres étaient donc
 * invisibles. Un filtre qu'on ne voit pas n'existe pas. Ils sont tous dans la
 * fenêtre Filtres, et chacun de ceux qui filtrent a son jeton.
 *
 * Ces points sont des demandes explicites, pas des préférences : une
 * régression ici est un retour en arrière fonctionnel, silencieux à l'œil de
 * qui ne connaît pas l'historique.
 */

const lire = (nom: string) => readFileSync(fileURLToPath(new URL(`../public/${nom}`, import.meta.url)), 'utf8');

const html = lire('dashboard.html');
const js = lire('app.js');
const css = lire('styles.css').replace(/\/\*[\s\S]*?\*\//g, '');

const corps = (signature: string) => {
  const debut = js.indexOf(signature);
  assert.ok(debut >= 0, `${signature} introuvable`);
  return js.slice(debut, js.indexOf('\n}\n', debut) + 2);
};

test('les filtres ne portent pas de second champ de recherche', () => {
  assert.equal(
    /id="q-search"/.test(html),
    false,
    'Le champ de recherche de la barre de filtres est revenu : il double celui ' +
      "de l'en-tête, qui ouvre la palette.",
  );
  assert.equal(
    js.includes("$('q-search')"),
    false,
    "public/app.js s'adresse encore à #q-search, qui n'existe plus dans le HTML.",
  );
});

test('le terme de recherche actif reste visible et retirable', () => {
  // Sans champ, le jeton est le SEUL témoin qu'un filtre texte est posé.
  // S'il disparaît, la file paraît incomplète sans que rien ne l'explique.
  assert.ok(/id="q-jetons"/.test(html), 'la rangée des jetons a disparu du HTML');
  assert.match(corps('function jetonsPoses('), /if \(terme\) jetons\.push\(\{ cle: 'terme', nom: `« \$\{terme\} »` \}\);/);
  assert.match(js, /if \(type === 'terme'\) f\.q = '';/);
  assert.ok(
    js.includes('state.queue.q = term;\n  renderJetons();'),
    "routeSearch doit rafraîchir les jetons : sinon un terme filtre la file sans qu'on le voie",
  );
});

test('tous les libellés sont proposés, sans « +N » ni repli', () => {
  assert.equal(
    /id="q-label-more"/.test(html),
    false,
    'Le « +N » est revenu : il cachait la moitié des filtres du marchand.',
  );
  // Aucun plafond : la liste entière, triée, plus ceux qui sont cochés.
  const proposes = corps('function libellesProposes(');
  assert.doesNotMatch(proposes, /slice\(/);
  assert.match(proposes, /for \(const nom of state\.queue\.labels\) noms\.add\(nom\);/);
  assert.match(corps('function renderFiltres('), /const libelles = libellesProposes\(\)/);
  // La fenêtre défile plutôt que de couper.
  assert.match(css, /\.qf-corps \{[^}]*overflow-y: auto;/);
});

test("un libellé très long s'abrège chez lui plutôt que de pousser la ligne", () => {
  // Un libellé Gmail n'a pas de longueur maximale : le marchand écrit ce qu'il
  // veut. Sans plafond, un seul jeton déforme la rangée entière.
  const jeton = css.match(/\.qjeton-nom\s*\{([^}]*)\}/);
  assert.ok(jeton, 'la règle .qjeton-nom est introuvable');
  assert.match(jeton[1], /max-width:\s*\d/, '.qjeton-nom doit être plafonné en largeur');
  assert.match(jeton[1], /text-overflow:\s*ellipsis/, '.qjeton-nom doit s’abréger, pas se couper net');

  const ligne = css.match(/\.qf-nom\s*\{([^}]*)\}/);
  assert.ok(ligne, 'la règle .qf-nom est introuvable');
  assert.match(ligne[1], /text-overflow:\s*ellipsis/);

  // Le nom entier reste en infobulle, sur la ligne comme sur le jeton.
  assert.match(corps('function renderFiltres('), /titre: nom,/);
  assert.match(corps('function jetonsPoses('), /titre: nom, pastille: pastilleDuLibelle\(nom\)/);
});
