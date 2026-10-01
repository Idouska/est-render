import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { enTete } from '../src/services/suppliers/demande.ts';

/*
 * « Contacter le fournisseur » : une fenêtre pour tout motif.
 *
 * CE QUE CES TESTS PROTÈGENT. Plus rien ne part à l'atelier en texte libre :
 * chaque demande a un motif, des champs, et se répond d'un bouton. Un chemin
 * « Écrire au fournisseur » revenu par mégarde rouvrirait l'échange par mail
 * que cette fenêtre ferme.
 */

const lire = (chemin: string) =>
  readFileSync(fileURLToPath(new URL(`../${chemin}`, import.meta.url)), 'utf8');
const sansCommentaires = (code: string) =>
  code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/[^\n]*/gm, '');

const app = sansCommentaires(lire('public/app.js'));
const html = lire('public/dashboard.html');
const routes = lire('src/routes/suppliers.ts');
const schema = lire('prisma/schema.prisma');
const atelier = sansCommentaires(lire('public/workspace.js'));
const i18n = lire('public/workspace.i18n.js');

test('la première ligne du mail dit la demande, selon son motif', () => {
  assert.equal(enTete('SIZE', '44', '45'), '44 → 45');
  assert.equal(enTete('SIZE', null, '45'), '? → 45');
  assert.equal(enTete('HOLD', null, null), null);
  assert.equal(enTete('MISSING_ITEM', 'Lampe Rosée · Verre', null), 'Article manquant : Lampe Rosée · Verre');
  assert.equal(enTete('MISSING_ITEM', null, null), null);
  assert.equal(enTete('DELAY', null, '2026-10-12'), 'Expédition attendue au plus tard le 2026-10-12');
});

test('les deux nouveaux motifs existent en base, au serveur et dans la fenêtre', () => {
  for (const motif of ['MISSING_ITEM', 'DELAY']) {
    assert.match(schema, new RegExp(`enum SupplierAlertKind \\{[^}]*${motif}`));
    assert.match(routes, new RegExp(`'${motif}'`));
    assert.match(html, new RegExp(`data-kind="${motif}"`));
    assert.match(i18n, new RegExp(`'kind\\.${motif}'`));
  }
  // Un article manquant n'a que son `beforeValue` : le serveur doit l'accepter.
  assert.match(routes, /value\.afterValue \|\| value\.beforeValue/);
});

test('la fenêtre s’appelle « Contacter le fournisseur » et propose la rupture', () => {
  assert.match(html, /<h2>Contacter le fournisseur<\/h2>/);
  assert.match(html, /data-kind="RUPTURE" id="alert-kind-rupture"/);
  assert.match(app, /if \(kind === 'RUPTURE'\) return void ouvrirRuptureDepuisFenetre\(\)/);
});

test('plus aucun chemin n’écrit au fournisseur en texte libre', () => {
  assert.doesNotMatch(app, /openCompose\('supplier'/);
  assert.doesNotMatch(app, /Écrire au fournisseur/);
  assert.doesNotMatch(app, /id="esc-create"|esc-reason|esc-note/);
  assert.doesNotMatch(app, /\/api\/tickets\/\$\{[^}]+\}\/escalations`, \{\s*method: 'POST'/);
  assert.match(app, /supplier: \(\) => openChangeRequest\(ticket\)/);
});

test('une proposition de remplacement ouvre le dossier de rupture qui manque', () => {
  const route = lire('src/routes/ruptures.ts');
  assert.ok(
    route.indexOf('await ouvrirDossierRupture(') < route.indexOf('await proposerSubstitutions('),
    'le dossier doit exister avant que l’atelier soit prévenu',
  );
  const service = lire('src/services/ruptures/substitution.ts');
  // Un signalement de l'atelier a déjà son dossier : son ticket.
  assert.match(service, /if \(!ticket \|\| fournisseurDuFil\(ticket\.gmailThreadId\)\) return;/);
});

test('l’atelier ouvre un ticket depuis Tickets, commande retrouvée par son numéro', () => {
  assert.match(lire('public/workspace.html'), /id="ws-new-ticket"/);
  assert.match(atelier, /orders\/search\?q=\$\{encodeURIComponent\(terme\)\}/);
  // Sans commande, pas d'envoi : la route exige l'identifiant Shopify.
  assert.match(atelier, /if \(!state\.issueOrder\) \{\s*toast\(t\('ticket\.needOrder'\), true\);/);
  for (const cle of ['ticket.new', 'ticket.needOrder', 'updates.missing', 'updates.shipBy']) {
    assert.equal(i18n.split(`'${cle}'`).length - 1, 3, `${cle} dans les trois langues`);
  }
});
