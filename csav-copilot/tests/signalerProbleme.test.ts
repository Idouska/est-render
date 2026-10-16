import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { STRINGS } from '../public/workspace.i18n.js';

/*
 * « Signaler un problème », dans l'espace fournisseur, d'après la maquette.
 *
 * Avant : la commande dite trois fois (« Commande #12189 », le champ,
 * « Commande #12189 trouvée »), un bouton Chercher, cinq choix dans un menu
 * déroulant, un détail obligatoire qu'on découvrait par un message d'erreur,
 * et un bouton qui passait au violet au survol. Après : une fiche de
 * commande, la recherche pendant qu'on tape, cinq tuiles, ce que la commande
 * sait déjà selon le problème, et un bouton qui attend le détail.
 */

const lire = (chemin: string) =>
  readFileSync(fileURLToPath(new URL(`../${chemin}`, import.meta.url)), 'utf8');

const html = lire('public/workspace.html');
const js = lire('public/workspace.js');
const css = lire('public/workspace.css');

const corps = (signature: string) => {
  const debut = js.indexOf(signature);
  assert.ok(debut >= 0, `${signature} introuvable`);
  return js.slice(debut, js.indexOf('\n}\n', debut) + 2);
};

const fenetre = html.slice(html.indexOf('<div class="modal-wrap" id="issue-modal">'), html.indexOf('<!-- Lecture du code-barres'));

test('la commande se montre une fois, en fiche, et se cherche pendant qu’on tape', () => {
  // Plus de bouton « Chercher » ni de « Commande … trouvée ».
  assert.doesNotMatch(fenetre, /id="issue-find-btn"|id="issue-order"/);
  assert.match(fenetre, /<div class="sig-fiche" id="issue-fiche" hidden><\/div>/);
  assert.match(corps('function ficheCommande('), /<button type="button" class="sig-lien" data-changer>/);
  // Pas de montant : c'est le prix de vente du marchand.
  assert.doesNotMatch(corps('function ficheCommande('), /totalPrice/);
  assert.match(js, /state\.issueTimer = setTimeout\(\(\) => void trouverCommandeDuTicket\(\), 300\);/);
  // Rien n'est choisi tout seul pendant la frappe ; Entrée prend la seule réponse.
  assert.match(corps('async function trouverCommandeDuTicket('), /if \(prendreSeule && orders\.length === 1\) return preparerSignalement\(orders\[0\]\);/);
  // Une réponse en retard n'écrase pas la suivante.
  assert.match(corps('async function trouverCommandeDuTicket('), /if \(tour !== rechercheSignalement\) return;/);
});

test('le problème se choisit parmi cinq tuiles, au clic ou aux flèches', () => {
  assert.doesNotMatch(fenetre, /<select id="issue-kind">/);
  const tuiles = [...fenetre.matchAll(/role="radio" aria-checked="(?:true|false)" data-kind="(\w+)"/g)].map((m) => m[1]);
  assert.deepEqual(tuiles, ['PHONE', 'ADDRESS', 'STOCK', 'DAMAGE', 'OTHER']);
  assert.match(js, /const pas = \{ ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 \}\[event\.key\];/);
  assert.match(css, /\.sig-natures \{ display: grid; grid-template-columns: repeat\(5, minmax\(0, 1fr\)\); gap: 8px; \}/);
});

test('ce que la commande sait déjà s’affiche selon le problème', () => {
  const contexte = corps('function renderContexte(');
  // Le numéro et l'adresse, tels qu'ils sont écrits — sans jugement automatique.
  assert.match(contexte, /const tel = order\.shippingAddress\?\.phone \?\? order\.customer\?\.address\?\.phone \?\? null;/);
  assert.match(contexte, /adresse\?\.formatted\?\.length/);
  // Les articles à toucher, pour une rupture comme pour un article abîmé ;
  // la saisie à la main seulement quand la commande n'en liste aucun.
  assert.match(contexte, /const parArticle = kind === 'STOCK' \|\| kind === 'DAMAGE';/);
  assert.match(contexte, /\$\('issue-item'\)\.hidden = !\(order && parArticle && articles\.length === 0\);/);
  assert.match(js, /\.\.\.\(kind === 'STOCK' \|\| kind === 'DAMAGE'/);
  // L'article touché remplit les champs envoyés.
  assert.match(corps('function remplirArticle('), /\$\('issue-size'\)\.value = taille;/);
});

test('le détail est requis, et le bouton l’attend', () => {
  assert.match(fenetre, /<span class="sig-requis" data-t="issue\.required">· requis<\/span>/);
  assert.match(fenetre, /<button class="btn btn-primary" id="issue-send" data-t="issue\.send" disabled>/);
  assert.match(corps('function signalementPret('), /\$\('issue-note'\)\.value\.trim\(\)\.length >= 3/);
  assert.match(js, /\$\('issue-note'\)\.addEventListener\('input', majEnvoiSignalement\);/);
  // L'indice suit le problème, et survit à un changement de langue.
  assert.match(corps('function renderSignalement('), /note\.dataset\.tph = `issue\.hint\.\$\{kind\}`;/);
});

test('boutons à droite en bleu, feuille d’iOS au téléphone', () => {
  assert.match(css, /\.wsapp ~ \.modal-wrap \.btn-primary:hover \{ background: #0058b0; \}/);
  assert.match(css, /\.sig \.sig-pied \{ justify-content: flex-end;/);
  const tel = css.slice(css.indexOf('@media (max-width: 640px) {\n  .wsapp ~ #issue-modal'));
  assert.match(tel, /\.wsapp ~ #issue-modal \{ align-items: flex-end; padding: 0; \}/);
  assert.match(tel, /\.sig \.sig-tete,\n\s+\.wsapp ~ \.modal-wrap \.sig \.sig-pied \{ display: none; \}/);
  assert.match(tel, /\.n-tel \.sig-ico \{ background: #34c759; \}/);
  assert.match(fenetre, /<button class="sig-lien sig-envoyer" type="button" id="issue-send-top" data-t="issue\.sendShort" disabled>/);
});

test('chaque nouveau texte existe en français, en anglais et en chinois', () => {
  const cles = [...new Set([...fenetre.matchAll(/data-t(?:ph)?="(issue\.[\w.]+)"/g), ...js.matchAll(/t\('(issue\.[\w.]+)'/g)].map((m) => m[1]))];
  for (const kind of ['PHONE', 'ADDRESS', 'STOCK', 'DAMAGE', 'OTHER']) cles.push(`issue.hint.${kind}`, `issue.k.${kind}`);
  cles.push('issue.item', 'issue.items');
  for (const lang of ['fr', 'en', 'zh'] as const) {
    const table = STRINGS[lang] as Record<string, string>;
    for (const cle of cles) assert.ok(table[cle], `${lang} : ${cle}`);
  }
});
