import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
// @ts-expect-error — module navigateur sans déclaration de types.
import { LANGS, STRINGS } from '../public/workspace.i18n.js';

/*
 * Deux refontes de disposition, d'après la maquette « En-tête du message et
 * écran Commandes ».
 *
 * SAV CLIENT. L'en-tête du message empilait quatre lignes décousues : le
 * titre ; le nom, l'adresse en machine à écrire et deux pastilles ; une ligne
 * de faits qui mêlait l'objet du mail ; « Classer ce message » en pointillés.
 * Il se lit maintenant en quatre groupes : le titre et l'heure, les mots du
 * client, le client en rangée, le classement sur une ligne.
 *
 * ESPACE FOURNISSEUR. Huit étages avant la première commande ; quatre
 * désormais, et un titre commun aux trois onglets.
 */

const lire = (chemin: string) =>
  readFileSync(fileURLToPath(new URL(`../${chemin}`, import.meta.url)), 'utf8');

const app = lire('public/app.js');
const dashboard = lire('public/dashboard.html');
const styles = lire('public/styles.css');
const espace = lire('public/workspace.html');
const espaceJs = lire('public/workspace.js');
const espaceCss = lire('public/workspace.css');

const corps = (source: string, signature: string) => {
  const debut = source.indexOf(signature);
  assert.ok(debut >= 0, `${signature} introuvable`);
  return source.slice(debut, source.indexOf('\n}\n', debut) + 2);
};

test('le message s’ouvre sur son titre, son heure et les mots du client', () => {
  assert.match(dashboard, /<div class="th-titre">\s*<h1 class="thread-subject" id="d-subject">[^<]*<\/h1>\s*<span class="th-quand" id="d-when"><\/span>/);
  assert.match(dashboard, /<p class="th-objet" id="d-objet" hidden><\/p>/);
  const detail = corps(app, 'function renderDetail(');
  assert.match(detail, /\$\('d-when'\)\.textContent = dayOrDateTime\(ticket\.lastMessageAt\);/);
  assert.match(detail, /\$\('d-objet'\)\.textContent = objet \? `« \$\{objet\} »` : '';/);
});

test('le client tient dans une rangée, qui ouvre sa fiche', () => {
  const meta = corps(app, 'function renderTicketMeta(');
  assert.match(meta, /<button class="tm-client" id="d-who" type="button"/);
  assert.match(meta, /<span class="tm-achats">/);
  // L'adresse se lit en texte, plus en machine à écrire.
  assert.doesNotMatch(meta, /<code>/);
  assert.match(meta, /<span class="tm-mail">/);
});

test('le classement tient sur une ligne, la liste se coche et se cherche', () => {
  const labels = corps(app, 'function renderTicketLabels(');
  assert.match(labels, /<span class="cl-titre">Classement<\/span>/);
  // L'intention et sa certitude, en une pastille.
  assert.match(labels, /<span>· sûr à \$\{Math\.round\(ticket\.intentConfidence \* 100\)\} %<\/span>/);
  // Un libellé posé se retire de sa croix.
  assert.match(labels, /<button class="cl-x" type="button"\s+data-tlabel=/);
  // La liste : une case par ligne, une recherche.
  assert.match(labels, /class="lmore-item" role="menuitemcheckbox"/);
  assert.match(labels, /<input type="search" data-lmore-q/);
  // Elle reste ouverte pendant qu'on coche.
  assert.match(app, /const ouvert = bar\.querySelector\('details\.lmore'\)\?\.open;/);
  assert.match(app, /if \(ouvert\) \{\n\s+bar\.querySelector\('details\.lmore'\)\.open = true;/);
  // Et s'ouvre sous la ligne, sans sortir de la colonne.
  assert.match(styles, /#view-tickets \.thread-labels \.lmore-box \{ top: calc\(100% \+ 6px\); left: 0; max-width: 100%;/);
});

test('les commandes de l’atelier tiennent en deux étages, sans empilement', () => {
  // 1. Le titre commun, la phrase de la journée (période puis avancement) ;
  //    Actualiser, Télécharger et Importer sur la même ligne.
  const tete = espace.slice(espace.indexOf('<header class="wshead cmd-tete"'), espace.indexOf('</header>', espace.indexOf('<header class="wshead cmd-tete"')));
  assert.match(tete, /<h1 id="ws-title" data-t="nav\.orders">Commandes<\/h1>/);
  const sous = tete.slice(tete.indexOf('<div class="cmd-sous">'));
  assert.ok(sous.indexOf('id="ws-periode"') < sous.indexOf('id="ws-progress"'), 'la période avant l’avancement');
  // La période est un menu : les trois journées et les dates précises.
  const menu = tete.slice(tete.indexOf('id="ws-periode-menu"'), tete.indexOf('<div class="ws-progress"'));
  for (const id of ['ws-quick', 'ws-more', 'ws-drawer', 'ws-since', 'ws-until']) assert.ok(menu.includes(`id="${id}"`), id);
  const gestes = tete.slice(tete.indexOf('<div class="wshead-acts">'));
  const rangsGestes = ['ws-reload', 'ws-xlsx', 'ws-import'].map((id) => gestes.indexOf(`id="${id}"`));
  assert.deepEqual([...rangsGestes].sort((a, b) => a - b), rangsGestes);
  assert.ok(rangsGestes.every((rang) => rang > 0));

  // 2. Les trois onglets, seuls sur leur ligne.
  const barre = espace.slice(espace.indexOf('<div class="cmd-barre"'), espace.indexOf('<!-- ============================================ AUJOURD'));
  assert.match(barre, /id="ws-sous-cmd"/);
  assert.doesNotMatch(barre, /ws-quick|class="seg"/);

  // En tête de la file : chercher, masquer les préparées, ranger.
  const commandes = espace.slice(espace.indexOf('<section id="view-orders"'));
  const rangs = ['id="cmd-outils"', 'id="ws-cmd-search"', 'id="ws-filter"', 'id="ws-masquer"', 'id="ws-sort"', 'id="ws-orders"'].map((id) => commandes.indexOf(id));
  assert.deepEqual([...rangs].sort((a, b) => a - b), rangs, 'ordre des outils');
  assert.ok(rangs.every((rang) => rang > 0));
  // Le doublon « À préparer / Toutes » a disparu : un interrupteur le remplace.
  assert.doesNotMatch(commandes.slice(0, commandes.indexOf('id="ws-orders"')), /data-filter=/);
  assert.match(commandes, /<button type="button" role="switch" id="ws-masquer" aria-checked="true"><\/button>/);
  // Sur grand écran, ces outils passent dans la colonne de la file, et le
  // champ garde le curseur.
  const rendu = corps(espaceJs, 'function renderOrders(');
  assert.match(rendu, /\$\('ws-orders'\)\.querySelector\('\.ws-file'\)\?\.prepend\(outils\);/);
  assert.match(rendu, /champ\.setSelectionRange\(curseur, curseur\);/);

  // Les deux autres onglets n'ont plus leur propre titre.
  assert.doesNotMatch(espace, /<h1 data-t="tracking\.title">|<h1 data-t="lots\.title">/);
});

test('l’en-tête commun suit l’onglet, sans se prendre pour un onglet', () => {
  // `[data-sous]` change d'onglet au clic : les conteneurs portent `data-onglet`.
  assert.match(espace, /<header class="wshead cmd-tete" id="cmd-tete" data-onglet="orders" hidden>/);
  assert.match(espace, /<div class="cmd-barre" id="cmd-barre" data-onglet="orders" hidden>/);
  const vue = corps(espaceJs, 'function setView(');
  assert.match(vue, /for \(const id of \['cmd-tete', 'cmd-barre'\]\) \{\n\s+\$\(id\)\.hidden = view !== 'orders';\n\s+\$\(id\)\.dataset\.onglet = courant;/);
  // Ce qui ne sert qu'à « À préparer » se retire sur les deux autres.
  assert.match(espaceCss, /\.wsapp \.cmd-tete:not\(\[data-onglet='orders'\]\) \.cmd-sous,\n\.wsapp \.cmd-tete:not\(\[data-onglet='orders'\]\) \.wshead-acts \{ display: none; \}/);
  // Le compte « À préparer » se voit sur l'onglet.
  assert.match(espaceJs, /\$\('ws-sous-n'\)\.textContent = left \? String\(left\) : '';/);
});

test('au téléphone, les mots courts existent dans les trois langues', () => {
  const table = STRINGS as Record<string, Record<string, string>>;
  for (const { code } of LANGS as Array<{ code: string }>) {
    for (const cle of ['test.short', 'sous.parcelsShort', 'sous.lotsShort', 'nav.orders', 'mode.manualHint', 'mode.bulkHint']) {
      assert.equal(typeof table[code]![cle], 'string', `${code} : ${cle}`);
    }
  }
  assert.match(espace, /<span class="ws-court" data-t="test\.short">/);
  assert.match(espaceCss, /\.wsapp \.ws-court \{ display: none; \}/);
});

test('une clé de traduction n’est écrite qu’une fois par langue', () => {
  // Dans un objet littéral, la dernière l'emporte en silence : « Dates
  // choisies » ajouté en haut était écrasé par un ancien « Dates » plus bas.
  const source = lire('public/workspace.i18n.js');
  const blocs = source.split(/\n  (?:fr|en|zh): \{/).slice(1);
  assert.equal(blocs.length, 3);
  for (const bloc of blocs) {
    const cles = [...bloc.matchAll(/^ {4}'([^']+)':/gm)].map((m) => m[1]!);
    const vues = new Set<string>();
    assert.deepEqual(cles.filter((cle) => vues.has(cle) || !vues.add(cle)), []);
  }
});

test('la période se lit dans la phrase, l’interrupteur remplace le doublon', () => {
  // Le nom de la période suit le choix ; des dates précises rechargent la file.
  assert.match(espaceJs, /nom\.textContent = cochee \? cochee\.textContent : t\('range\.custom'\);/);
  assert.match(espaceJs, /for \(const id of \['ws-since', 'ws-until'\]\) \{\n\s+\$\(id\)\?\.addEventListener\('change', \(\) => \{/);
  // L'interrupteur bascule entre « reste à préparer » et « toutes ».
  assert.match(espaceJs, /\$\('ws-masquer'\)\?\.addEventListener\('click', \(\) => \{\n\s+state\.filter = state\.filter === 'all' \? 'left' : 'all';/);
  // En masse, les outils de la file se retirent avec elle.
  assert.match(espaceJs, /for \(const id of \['ws-progress', 'cmd-outils', 'ws-orders'\]\) \{/);
});
