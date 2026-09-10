import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  cleProduit,
  commandesParSku,
  kpisRuptures,
  phaseDossier,
  type DossierRupture,
} from '../src/services/ruptures/console.ts';

/*
 * Les trois couleurs d'un dossier de rupture : rouge, orange, vert.
 *
 * CE QUE CES TESTS PROTÈGENT. Une couleur se lit sans rien déchiffrer — c'est
 * sa force, et c'est ce qui rend une couleur fausse si coûteuse : personne ne
 * la remet en question. Un dossier resté rouge alors que le client a eu sa
 * réponse fait perdre du temps à le rouvrir ; un dossier passé vert trop tôt
 * laisse un client sans nouvelles, et plus rien ne le signale.
 *
 * Et le même dossier doit porter la même couleur chez le marchand et chez
 * l'atelier, sans quoi les deux, au téléphone, ne parlent pas du même état.
 */

const T0 = new Date('2026-09-10T09:00:00Z');
const apres = (heures: number) => new Date(T0.getTime() + heures * 3_600_000);

const dossier = (patch: Partial<DossierRupture> = {}): DossierRupture => ({
  id: 'd1',
  ticketId: 't1',
  origine: 'atelier',
  statut: 'OPEN',
  creeLe: T0,
  notifieLe: null,
  resoluLe: null,
  reponseFournisseurLe: null,
  reponseClientLe: null,
  rembourse: false,
  sku: null,
  produit: 'Nike Vomero Plus',
  montant: 160,
  ...patch,
});

/* ---- les trois temps ---- */

test('rouge : créé, personne n’a répondu au client', () => {
  assert.equal(phaseDossier(dossier()), 'cree');
});

test('orange : traité, le client a eu une réponse depuis la rupture', () => {
  assert.equal(phaseDossier(dossier({ reponseClientLe: apres(3) })), 'traite');
});

test('une réponse antérieure à la rupture ne rend pas le dossier traité', () => {
  // C'était une autre conversation : répondre à « où est mon colis » la
  // veille ne prévient pas le client que sa taille manque.
  assert.equal(phaseDossier(dossier({ reponseClientLe: apres(-24) })), 'cree');
});

test('un remboursement engagé vaut réponse', () => {
  assert.equal(phaseDossier(dossier({ rembourse: true })), 'traite');
});

test('vert : classé, dès que le dossier est clos', () => {
  assert.equal(phaseDossier(dossier({ statut: 'RESOLVED' })), 'classe');
  assert.equal(
    phaseDossier(dossier({ statut: 'RESOLVED', reponseClientLe: null })),
    'classe',
    'clos sans réponse — une affaire réglée au téléphone — reste clos',
  );
});

test('la règle vaut pour les escalades du marchand comme pour l’atelier', () => {
  const escalade = (patch: Partial<DossierRupture>) => dossier({ origine: 'marchand', ...patch });

  assert.equal(phaseDossier(escalade({ statut: 'OPEN' })), 'cree');
  assert.equal(phaseDossier(escalade({ statut: 'ANSWERED', reponseClientLe: apres(1) })), 'traite');
  assert.equal(phaseDossier(escalade({ statut: 'RESOLVED' })), 'classe');
});

/* ---- « ruptures actives » quand l'atelier n'a pas donné de référence ---- */

test('une rupture sans référence compte quand même comme rupture active', () => {
  // L'atelier a écrit le nom et la taille, pas la référence. Compter les
  // seules références affichait « 0 rupture active » au-dessus d'une rupture
  // bien réelle.
  const kpis = kpisRuptures([dossier({ sku: null, produit: 'Nike Vomero Plus' })]);
  assert.equal(kpis.rupturesActives, 1);
});

test('le même produit signalé deux fois ne compte qu’une rupture', () => {
  const kpis = kpisRuptures([
    dossier({ id: 'a', sku: null, produit: 'Nike Vomero Plus' }),
    dossier({ id: 'b', sku: null, produit: '  nike vomero plus ' }),
  ]);
  assert.equal(kpis.rupturesActives, 1, 'la casse et les espaces ne font pas deux produits');
  assert.equal(kpis.commandesImpactees, 2, 'mais deux commandes sont bloquées');
});

test('la référence l’emporte sur le nom quand elle existe', () => {
  // Deux noms différents, une même référence : c'est un seul produit, écrit
  // de deux façons.
  const a = dossier({ id: 'a', sku: 'NK-VOM', produit: 'Nike Vomero Plus' });
  const b = dossier({ id: 'b', sku: 'NK-VOM', produit: 'Vomero Plus blanc' });

  assert.equal(cleProduit(a), cleProduit(b));
  assert.equal(commandesParSku([a, b]).get(cleProduit(a)!), 2);
});

test('une référence et un nom ne se confondent jamais', () => {
  /*
   * Un produit dont le NOM serait « nk-vom » ne doit pas fusionner avec la
   * RÉFÉRENCE nk-vom : les clés sont préfixées.
   *
   * La référence est choisie en minuscules à dessein. Avec « NK-VOM », le nom
   * est mis en minuscules et diffère de toute façon de la référence — le test
   * passait alors même SANS préfixe, et ne prouvait rien. Une mutation l'a
   * montré : la collision n'existe que sur une référence déjà en minuscules.
   */
  assert.notEqual(
    cleProduit(dossier({ sku: 'nk-vom', produit: null })),
    cleProduit(dossier({ sku: null, produit: 'NK-VOM' })),
  );
});

test('sans référence ni nom, pas de clé — et pas de rupture inventée', () => {
  assert.equal(cleProduit(dossier({ sku: null, produit: null })), null);
  assert.equal(kpisRuptures([dossier({ sku: null, produit: null })]).rupturesActives, 0);
});

/* ---- les deux écrans parlent le même code couleur ---- */

const lire = (chemin: string) =>
  readFileSync(fileURLToPath(new URL(`../${chemin}`, import.meta.url)), 'utf8');
const sansCommentaires = (code: string) =>
  code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

test('la page du marchand marque chaque ligne de sa phase', () => {
  const app = sansCommentaires(lire('public/app.js'));
  assert.match(app, /data-phase="\$\{esc\(d\.phase \?\? 'cree'\)\}"/);

  const css = sansCommentaires(lire('public/styles.css'));
  assert.match(css, /tr\[data-phase='cree'\] \{ --rup-phase: var\(--crit\); \}/);
  assert.match(css, /tr\[data-phase='traite'\] \{ --rup-phase: var\(--warn\); \}/);
  assert.match(css, /tr\[data-phase='classe'\] \{ --rup-phase: var\(--ok\); \}/);
});

test('l’atelier applique la même règle au même dossier', () => {
  // Le serveur de l'atelier ne peut pas appeler `phaseDossier` — il ne
  // construit pas de dossier — mais il doit en appliquer la règle : clos →
  // classé, réponse au client postérieure au signalement → traité.
  const route = sansCommentaires(lire('src/routes/supplierWorkspace.ts'));
  const page = route.slice(route.indexOf("'/api/workspace/:id/ruptures'"));

  assert.match(page, /ticket\.status === 'CLOSED' \|\| ticket\.status === 'AUTO_SENT'\s*\?\s*'classe'/);
  assert.match(page, /reponduLe\.get\(ticket\.id\)! > ticket\.createdAt/);
  assert.match(page, /direction: 'OUTBOUND'/);

  const css = sansCommentaires(lire('public/workspace.css'));
  assert.match(css, /\.upd\.rup-p-cree \{ border-left-color: var\(--bad\); \}/);
  assert.match(css, /\.upd\.rup-p-traite \{ border-left-color: var\(--warn\); \}/);
  assert.match(css, /\.upd\.rup-p-classe \{ border-left-color: var\(--ok\); \}/);
});

test('la barre épaisse n’est posée que sur les dossiers', () => {
  // L'état vide et le squelette sont aussi des lignes : une barre grise sur
  // eux ne dirait rien, sinon qu'une couleur manque.
  const css = sansCommentaires(lire('public/styles.css'));
  assert.match(css, /\.rup-grid tbody tr\[data-phase\] td:first-child \{ border-left: 5px solid var\(--rup-phase\); \}/);
});
