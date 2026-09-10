import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

/*
 * La barre de filtres de la file : une seule recherche, et tous les libellés.
 *
 * CE QUE CES TESTS PROTÈGENT. Deux champs de recherche se regardaient à
 * quelques pixels l'un de l'autre — celui de l'en-tête, qui ouvre la palette,
 * et celui de la barre de filtres, qui filtrait la file. Deux portes pour la
 * même intention : on ne sait plus laquelle sert à quoi, et l'une des deux
 * dément l'autre puisqu'elles ne cherchent pas dans le même périmètre. La
 * seconde a été retirée ; le terme actif se lit désormais sur une pastille
 * qu'un clic retire.
 *
 * Les libellés, eux, étaient plafonnés à six, les autres repliés derrière un
 * « +3 » — sur onze libellés Gmail chez ce marchand, cinq filtres étaient donc
 * invisibles. Un filtre qu'on ne voit pas n'existe pas. Ils passent maintenant
 * à la ligne plutôt que d'être cachés.
 *
 * Ces deux points sont des demandes explicites, pas des préférences : une
 * régression ici est un retour en arrière fonctionnel, silencieux à l'œil de
 * qui ne connaît pas l'historique.
 */

const lire = (nom: string) => readFileSync(fileURLToPath(new URL(`../public/${nom}`, import.meta.url)), 'utf8');

const html = lire('dashboard.html');
const js = lire('app.js');
const css = lire('styles.css').replace(/\/\*[\s\S]*?\*\//g, '');

test('la barre de filtres ne porte pas de second champ de recherche', () => {
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
  // Sans champ, la pastille est le SEUL témoin qu'un filtre texte est posé.
  // Si elle disparaît, la file paraît incomplète sans que rien ne l'explique.
  assert.ok(/id="q-term"/.test(html), 'la pastille du terme actif a disparu du HTML');
  assert.ok(js.includes('function renderQueueTerm'), 'renderQueueTerm a disparu de public/app.js');
  assert.ok(
    js.includes('state.queue.q = term;\n  renderQueueTerm();'),
    "routeSearch doit rafraîchir la pastille : sinon un terme filtre la file sans qu'on le voie",
  );
});

test('tous les libellés sont montrés, sans « +N » ni repli', () => {
  assert.equal(
    /id="q-label-more"/.test(html),
    false,
    'Le « +N » est revenu : il cachait la moitié des filtres du marchand.',
  );

  const bande = css.match(/\.qbar-main \.qlabels\s*\{([^}]*)\}/);
  assert.ok(bande, 'la règle .qbar-main .qlabels est introuvable');
  assert.match(
    bande[1],
    /flex-wrap:\s*wrap/,
    'La bande de libellés doit passer à la ligne. Un défilement latéral sans ' +
      "barre visible cache les libellés derrière un geste que rien n'annonce.",
  );
  assert.equal(
    /overflow-x:\s*(auto|scroll)/.test(bande[1]),
    false,
    'La bande de libellés défile de nouveau : les libellés hors champ sont ' +
      'invisibles et rien ne signale leur existence.',
  );
});

test("un libellé très long s'abrège chez lui plutôt que de pousser la ligne", () => {
  // Un libellé Gmail n'a pas de longueur maximale : le marchand écrit ce qu'il
  // veut. Sans plafond, une seule pastille déborde la bande et déforme la
  // barre entière.
  const chip = css.match(/\.ql-chip\s*\{([^}]*)\}/);
  assert.ok(chip, 'la règle .ql-chip est introuvable');
  assert.match(chip[1], /max-width:\s*\d/, '.ql-chip doit être plafonnée en largeur');

  const nom = css.match(/\.ql-nom\s*\{([^}]*)\}/);
  assert.ok(nom, 'la règle .ql-nom est introuvable');
  assert.match(nom[1], /text-overflow:\s*ellipsis/, '.ql-nom doit s’abréger, pas se couper net');

  assert.ok(
    js.includes('<span class="ql-nom">'),
    "le gabarit de pastille doit envelopper le nom : `text-overflow` ne s'applique " +
      'pas au texte nu d’un conteneur flex',
  );

  assert.ok(
    js.includes('title="${esc(name)}"'),
    'une pastille abrégée doit porter son nom entier en infobulle',
  );
});
