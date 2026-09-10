import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { compteursVues, type DossierRupture } from '../src/services/ruptures/console.ts';

/*
 * Les deux pastilles « Ruptures » : celle du marchand, celle de l'atelier.
 *
 * CE QUE CES TESTS PROTÈGENT. Une pastille n'a qu'un travail : s'allumer quand
 * quelqu'un doit agir, et s'éteindre quand c'est fait. Elle échoue de trois
 * façons, toutes silencieuses :
 *
 *   1. NE PAS S'ALLUMER. Calculée seulement à l'ouverture de l'onglet, elle
 *      ne signale rien : on a déjà trouvé ce qu'elle devait montrer.
 *
 *   2. NE PAS DIRE LA MÊME CHOSE QUE LA PAGE. « 12 » dans le menu, 9 lignes
 *      à l'écran : c'est la page qu'on accuse.
 *
 *   3. AFFIRMER CE QU'ON NE SAIT PAS. Une valeur restée allumée sur une
 *      donnée qu'on n'a pas pu relire est un chiffre inventé.
 *
 * Les commentaires sont retirés avant chaque recherche : ce dépôt est écrit
 * en prose, et un test qui trouve son motif dans le commentaire qui
 * l'explique passe en lisant sa propre justification.
 */

const lire = (chemin: string) =>
  readFileSync(fileURLToPath(new URL(`../${chemin}`, import.meta.url)), 'utf8');

const sansCommentaires = (code: string) =>
  code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

const ruptures = sansCommentaires(lire('src/routes/ruptures.ts'));
const app = sansCommentaires(lire('public/app.js'));
const atelier = sansCommentaires(lire('public/workspace.js'));

/* ---- côté marchand ---- */

test('la pastille compte la même population que l’onglet « Tous »', () => {
  // L'onglet exclut les dossiers résolus et eux seuls. Le comptage doit faire
  // exactement pareil, sans quoi le menu et la page se contredisent.
  const route = ruptures.slice(ruptures.indexOf("'/api/ruptures/compte'"));
  const clause = route.slice(0, route.indexOf('});'));

  assert.match(clause, /reason: 'OUT_OF_STOCK'/);
  assert.match(clause, /status: \{ not: 'RESOLVED' \}/);

  // Et l'onglet, de son côté, compte bien tout ce qui n'est pas résolu.
  const d = (statut: DossierRupture['statut']): DossierRupture => ({
    id: statut,
    ticketId: 't',
    statut,
    creeLe: new Date(),
    notifieLe: null,
    resoluLe: null,
    reponseFournisseurLe: null,
    reponseClientLe: null,
    rembourse: false,
    sku: null,
    montant: null,
  });
  const vues = compteursVues([d('DRAFTING'), d('OPEN'), d('ANSWERED'), d('RESOLVED')]);
  assert.equal(vues.tous, 3, 'trois non résolus — exactement ce que compte la route');
});

test('le comptage n’appelle pas Shopify', () => {
  // La relève a lieu chaque minute : un appel au catalogue par relève, pour ne
  // garder qu'un entier, ferait payer la navigation au prix de la console.
  const route = ruptures.slice(
    ruptures.indexOf("'/api/ruptures/compte'"),
    ruptures.indexOf("'/api/ruptures',"),
  );
  assert.equal(/getShopifyClient|listOrders/.test(route), false);
});

test('la pastille est relevée avec les autres, et rouge', () => {
  assert.match(app, /api\('\/api\/ruptures\/compte'\)\.catch\(\(\) => null\)/);
  assert.match(app, /ruptures: ruptures\?\.ouverts \?\? state\.navCounts\?\.ruptures \?\? 0/);
  assert.match(
    app,
    /\['changes', 'suppliers', 'returns', 'ruptures'\]\.includes\(view\)/,
    'une pastille grise se lit comme un volume, pas comme du travail en attente',
  );
});

test('clôturer un dossier fait baisser la pastille sans attendre la relève', () => {
  // Sans resynchronisation, le menu garde « 12 » une minute sous une page qui
  // en affiche 11 — et l'on croit que la clôture n'a pas pris.
  const chargement = app.slice(app.indexOf('async function loadRuptures'));
  const corps = chargement.slice(0, chargement.indexOf('\n}'));

  assert.match(corps, /state\.navCounts = \{ \.\.\.state\.navCounts, ruptures: r\.compteurs\.tous \?\? 0 \}/);
  assert.match(corps, /renderNav\(\)/);
});

/* ---- côté atelier ---- */

test('la pastille de l’atelier s’allume dès l’arrivée, sans ouvrir l’onglet', () => {
  // Le fournisseur arrive tous les matins sur « Commandes ». Une pastille
  // calculée seulement au rendu des ruptures ne s'allumerait jamais pour lui.
  const demarrage = atelier.slice(atelier.indexOf('setInterval(loadAlerts, 120000);'));

  assert.match(demarrage.slice(0, 200), /void rafraichirPastilleRuptures\(\);/);
  assert.match(demarrage.slice(0, 200), /setInterval\(rafraichirPastilleRuptures, 120000\);/);
});

test('la pastille de l’atelier ne compte que ce qui attend SA réponse', () => {
  // Ses propres signalements en attente chez le marchand n'y figurent pas :
  // il ne peut rien faire pour les éteindre, et une pastille qu'on ne peut pas
  // éteindre cesse d'être regardée.
  const releve = atelier.slice(atelier.indexOf('async function rafraichirPastilleRuptures'));
  const corps = releve.slice(0, releve.indexOf('\n}'));

  assert.match(corps, /demande\.statut === 'OPEN'/);
  assert.equal(/signalements/.test(corps), false);
});

test('la pastille de l’atelier s’éteint quand la relève échoue', () => {
  const releve = atelier.slice(atelier.indexOf('async function rafraichirPastilleRuptures'));
  const corps = releve.slice(0, releve.indexOf('\n}'));

  assert.match(corps, /catch \{\s*setRuptureBadge\(0\);/);
});
