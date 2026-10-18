import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { QUEUE_SELECT } from '../src/routes/queueFields.ts';
import {
  MOTIFS_SIGNALEMENT,
  lignesArticle,
  noteDuSignalement,
  signalementDuFil,
} from '../src/services/suppliers/signalement.ts';
// @ts-expect-error — module navigateur sans déclaration de types.
import { STRINGS } from '../public/workspace.i18n.js';

/*
 * Les signalements des ateliers, côté marchand.
 *
 * CE QUE CES TESTS PROTÈGENT. Un atelier qui trouvait une adresse incomplète
 * ouvrait un ticket depuis son espace ; il entrait dans SAV client titré
 * « Autre », au milieu du courrier des clients, et la page Fournisseur n'en
 * disait rien — alors que sa pastille le comptait. Le marchand ne le
 * retrouvait pas. Pire, l'ouvrir lançait l'IA, qui répondait au fournisseur
 * comme à un client.
 *
 * Trois contrats : le fil se relit en motif, la page Fournisseur liste ce que
 * sa pastille compte, et l'IA laisse ces tickets tranquilles.
 */

const lire = (chemin: string) =>
  readFileSync(fileURLToPath(new URL(`../${chemin}`, import.meta.url)), 'utf8');

const app = lire('public/app.js');
const html = lire('public/dashboard.html');
const routeFournisseurs = lire('src/routes/suppliers.ts');
const routeTickets = lire('src/routes/tickets.ts');
const traitement = lire('src/services/tickets/process.ts');
const espace = lire('src/routes/supplierWorkspace.ts');

/** Le corps d'une fonction de l'écran, de sa signature à son accolade finale. */
const corps = (source: string, signature: string) => {
  const debut = source.indexOf(signature);
  assert.ok(debut >= 0, `${signature} introuvable`);
  return source.slice(debut, source.indexOf('\n}\n', debut) + 2);
};

test('la clé du fil se relit en motif, même avec une commande en GID', () => {
  // La commande est un GID Shopify : elle contient elle-même des deux-points.
  const fil = 'supplier:cmfournisseur01:gid://shopify/Order/6123456:ADDRESS';
  assert.deepEqual(signalementDuFil(fil, 'Test Factory'), {
    motif: 'ADDRESS',
    libelle: 'Adresse incomplète ou incorrecte',
    court: 'Adresse',
    fournisseur: 'Test Factory',
  });
  // Un motif inconnu reste un signalement : « Autre problème », pas un client.
  assert.equal(signalementDuFil('supplier:x:gid://shopify/Order/1:BIZARRE')?.motif, 'OTHER');
  // Un fil Gmail n'est pas un signalement.
  assert.equal(signalementDuFil('18c2f0a9b7d1e3f4'), null);
  assert.equal(signalementDuFil(null), null);
});

test('les libellés du marchand sont ceux que l’atelier choisit', () => {
  // L'objet du ticket s'écrit avec ces libellés ; l'atelier choisit le motif
  // dans les mêmes mots. Deux vocabulaires feraient deux tickets différents.
  const fr = (STRINGS as Record<string, Record<string, string>>).fr!;
  for (const [motif, { libelle }] of Object.entries(MOTIFS_SIGNALEMENT)) {
    assert.equal(fr[`issue.kind.${motif}`], libelle, motif);
  }
  assert.match(espace, /MOTIFS_SIGNALEMENT\[donnees\.kind\]\.libelle/);
  // Et la note devient l'extrait de la file — l'article, quand elle est vide.
  assert.match(espace, /snippet: \(note \|\| detail\.join\(' · '\)\)\.replace/);
});

test('la page ne montre que les mots de l’atelier', () => {
  const texte = [
    "Signalé par Test Factory depuis l'atelier.",
    '',
    ...lignesArticle({ produit: 'Derby Arlo', taille: '42' }),
    '',
    'Le code postal manque.',
  ].join('\n');
  assert.equal(noteDuSignalement(texte), 'Le code postal manque.');
  assert.equal(noteDuSignalement("Signalé par Test Factory depuis l'atelier.\n\n"), null);
  assert.equal(noteDuSignalement(null), null);
});

test('la page Fournisseur liste ce que sa pastille compte', () => {
  const clause = corps(routeFournisseurs, 'function signalementsOuverts(');
  // Hors ruptures, qui ont leur page et leur pastille.
  assert.match(clause, /NOT: \{ gmailThreadId: \{ endsWith: ':STOCK' \} \}/);
  // Tout statut ouvert : un ticket repris par l'IA avant ce correctif compte.
  assert.match(clause, /status: \{ notIn: \['CLOSED' as const, 'AUTO_SENT' as const\] \}/);

  // La liste et le compteur de la pastille passent par la même clause.
  assert.match(routeFournisseurs, /app\.get\('\/api\/supplier-signalements'/);
  assert.match(routeFournisseurs, /where: signalementsOuverts\(merchantId\),\n\s+orderBy: \{ createdAt: 'asc' \}/);
  assert.match(routeFournisseurs, /prisma\.ticket\.count\(\{ where: signalementsOuverts\(merchantId\) \}\)/);
  assert.doesNotMatch(routeFournisseurs, /customerEmail: \{ startsWith: 'fournisseur\+' \}/);

  // L'écran : une ligne par signalement dans « À traiter », chargée avec la
  // vue, et ses deux gestes.
  assert.match(html, /<section class="fo-bloc fo-traiter" id="fo-traiter" hidden/);
  assert.match(app, /void renderSupplierActivity\(\);\n\s+void renderSignalementsFournisseurs\(\);/);
  assert.match(corps(app, 'async function renderSignalementsFournisseurs('), /api\('\/api\/supplier-signalements'\)/);
  const rendu = corps(app, 'function renderATraiter(');
  assert.match(rendu, /for \(const sig of state\.signalementsFournisseurs \?\? \[\]\)/);
  assert.match(rendu, /data-sig-open=/);
  assert.match(rendu, /data-sig-done=/);
  // « Traité » clôt le ticket : l'atelier le voit alors « Clos ».
  assert.match(app, /api\(`\/api\/tickets\/\$\{bouton\.dataset\.sigDone\}\/resolve`/);
  // Le bandeau du haut ne renvoie plus vers toute la file SAV client.
  assert.doesNotMatch(app, /signalement d’atelier', 'tickets'\)/);
});

test('dans SAV client, un atelier ne passe plus pour un client', () => {
  // Le fil voyage jusqu'à la route, qui le remplace par un champ lisible.
  assert.equal(QUEUE_SELECT.gmailThreadId, true);
  assert.match(routeTickets, /tickets\.map\(\(\{ gmailThreadId, \.\.\.ticket \}\) => \(\{/);
  assert.match(routeTickets, /signalement: signalementDuFil\(gmailThreadId, ticket\.customerName\)/);
  assert.match(routeTickets, /ticket: \{ \.\.\.ticket, signalement: signalementDuFil\(ticket\.gmailThreadId, ticket\.customerName\) \}/);

  // Le titre dit le motif, plus « Autre ».
  assert.match(corps(app, 'function ticketTitle('), /if \(ticket\.signalement\) return `Signalement · \$\{ticket\.signalement\.court\}\$\{order\}`;/);
  assert.match(app, /\$\{ticket\.signalement \? '<span class="queue-four">Fournisseur<\/span>' : ''\}/);
  // L'adresse de repli n'est plus affichée comme une adresse.
  assert.match(corps(app, 'function renderTicketMeta('), /ticket\.signalement\s+\? '<span class="tp tp-four">Fournisseur<\/span>'/);
});

test('l’IA ne répond pas à un atelier comme à un client', () => {
  // Côté serveur : le traitement s'arrête avant de toucher au ticket.
  const garde = traitement.indexOf('if (signalementDuFil(ticket.gmailThreadId))');
  assert.ok(garde > 0, 'garde absente');
  assert.ok(garde < traitement.indexOf("status: 'PROCESSING'"), 'la garde doit précéder la prise en charge');

  // Côté écran : pas d'analyse lancée à l'ouverture d'un signalement.
  const panneau = corps(app, 'function renderDraft(');
  const signalement = panneau.indexOf('if (ticket.signalement) {');
  assert.ok(signalement > 0);
  const bloc = panneau.slice(signalement, panneau.indexOf('\n  }\n', signalement));
  assert.doesNotMatch(bloc, /bindAnalyse|runAnalyse/);
  assert.match(bloc, /return;$/);

  // Et jamais de mail vers l'adresse de repli de l'atelier.
  const rediger = corps(app, 'function openCompose(');
  assert.ok(
    rediger.indexOf("startsWith('fournisseur+')") < rediger.indexOf('setComposeOpen(true)'),
    'le refus doit précéder l’ouverture de la fenêtre',
  );
});
