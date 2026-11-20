import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

/*
 * Les listes compactes du téléphone : Clients, Catalogue, Suivi colis, Équipe.
 *
 * CE QUE CES TESTS PROTÈGENT. Au téléphone, ces quatre tableaux devenaient une
 * fiche de 200 à 300 px par ligne : chaque case sous son intitulé, même celles
 * qu'on ne lit jamais — trois clients par écran. Chaque ligne tient maintenant
 * en deux ou trois lignes de texte, et l'appui ouvre le détail. Le tableau
 * d'ordinateur, lui, ne doit pas bouger.
 */

const lire = (chemin: string) =>
  readFileSync(fileURLToPath(new URL(`../${chemin}`, import.meta.url)), 'utf8');

const app = lire('public/app.js');
const css = lire('public/styles.css');
const dashboard = lire('public/dashboard.html');

const debutBloc = css.indexOf('TÉLÉPHONE — les listes compactes');
assert.ok(debutBloc >= 0, 'le bloc des listes compactes a disparu');
const bloc = css.slice(debutBloc);
const tel = bloc.slice(bloc.indexOf('@media (max-width: 760px) {'));

const corps = (signature: string) => {
  const debut = app.indexOf(signature);
  assert.ok(debut >= 0, `${signature} introuvable`);
  return app.slice(debut, app.indexOf('\n}\n', debut) + 2);
};

test('les quatre tableaux portent la classe de la liste compacte', () => {
  for (const [corpsId, classe] of [
    ['customers-rows', 'lt-clients'],
    ['team-rows', 'lt-equipe'],
    ['catalog-rows', 'lt-catalogue'],
    ['tracking-rows', 'lt-suivi'],
  ] as const) {
    const ou = dashboard.indexOf(`id="${corpsId}"`);
    const table = dashboard.lastIndexOf('<table', ou);
    assert.match(
      dashboard.slice(table, ou),
      new RegExp(`^<table class="grid liste-tel ${classe}">`),
      `${corpsId} n'est pas dans une table .liste-tel.${classe}`,
    );
  }
});

test('la liste compacte n’existe qu’au téléphone', () => {
  // Hors du téléphone, une seule règle : les unités (« commandes », « en
  // stock ») restent cachées, le tableau garde ses colonnes de chiffres nus.
  const avantTel = bloc.slice(0, bloc.indexOf('@media (max-width: 760px) {'));
  assert.match(avantTel, /\.lt-unite \{ display: none; \}/);
  assert.doesNotMatch(avantTel, /\.liste-tel/);
  // Au téléphone : plus d'intitulé devant chaque case, une ligne par dossier.
  assert.match(tel, /\.grid\.liste-tel td::before \{ display: none; \}/);
  assert.match(tel, /\.grid\.liste-tel td\.lt-cache \{ display: none; \}/);
  assert.match(tel, /\.lt-unite \{ display: inline;/);
  // Le chevron ne s'affiche que sur les lignes qui ouvrent quelque chose.
  assert.match(tel, /\.grid\.liste-tel tr\.lt-clic::after \{/);
});

test('Clients : la ligne ouvre la fiche, et la fiche permet d’écrire', () => {
  const rendu = corps('function renderCustomers(');
  assert.match(rendu, /<tr class="grid-row lt-clic" data-email=/);
  assert.match(rendu, /class="num mono lt-total">\$\{euro\(customer\.amountSpent, customer\.currency\)\}/);
  // « Écrire » quitte la ligne au téléphone : il doit exister dans la fiche.
  assert.match(rendu, /<td class="lt-cache">\$\{\s+customer\.email\s+\? `<button class="btn btn-small" data-mail=/);
  assert.match(corps('async function openCustomerSheet('), /data-sheet-mail="\$\{esc\(\s*email,?\s*\)\}">Écrire à ce client<\/button>/);
  assert.match(
    app,
    /\$\('sheet-body'\)\?\.addEventListener\('click', \(event\) => \{\n\s+const ecrire = event\.target\.closest\('\[data-sheet-mail\]'\);\n\s+if \(!ecrire\) return;\n\s+closeCustomerSheet\(\);\n\s+openMail\(ecrire\.dataset\.sheetMail\);/,
  );
});

test('Suivi colis : au téléphone la ligne entière ouvre le suivi, pas sur ordinateur', () => {
  const rendu = corps('async function loadTracking(');
  assert.match(rendu, /shipment\.trackingNumber \? ` class="lt-clic" data-suivi="\$\{esc\(shipment\.trackingNumber\)\}"` : ''/);
  assert.match(
    rendu,
    /if \(!TEL_RETOUR\.matches \|\| event\.target\.closest\('\[data-track\]'\)\) return;\n\s+openTracking\(ligne\.dataset\.suivi\);/,
  );
  // Le bouton dit ce qu'il fait : il ouvre le suivi du transporteur, plus
  // une « chronologie » interne qui n'existe plus.
  assert.match(rendu, />Suivre<\/button>/);
  assert.doesNotMatch(app, />Chronologie<\/button>/);
  // Trois lignes qui ne partagent pas leurs colonnes : la ligne se replie.
  assert.match(tel, /\.grid\.liste-tel\.lt-suivi tr \{ display: flex; flex-wrap: wrap;/);
  assert.match(tel, /\.grid\.lt-suivi \.lt-etat \{ order: 3; flex: 0 0 100%;/);
});

test('Catalogue : stock, variantes et marque sur une ligne, la marque cède la première', () => {
  const rendu = corps('function renderCatalog(');
  assert.match(rendu, /class="num mono lt-stock \$\{/);
  assert.match(rendu, /<span class="lt-unite"> en stock<\/span>/);
  assert.match(rendu, /<tr class="lt-collection">/);
  assert.match(tel, /grid-template-areas: "img titre titre titre prix" "img stock var vend statut";/);
  assert.match(tel, /grid-template-columns: 44px auto auto minmax\(0, 1fr\) auto;/);
  // Une rupture se voit sans lire le chiffre.
  assert.match(tel, /\.grid\.lt-catalogue \.lt-stock\.set-alert \{ color: var\(--crit-ink\);/);
});

test('Équipe : seul le propriétaire a des lignes qui s’ouvrent', () => {
  const rendu = corps('function renderTeam(');
  assert.match(rendu, /owner && !user\.agence \? ' lt-clic' : ''/);
  assert.match(rendu, /<td class="lt-etat">/);
  // « (vous) » reste à côté du nom : seule l'adresse passe à la ligne.
  assert.match(tel, /\.grid\.lt-equipe \.lt-qui \.sub\.mono \{ display: block;/);
});
