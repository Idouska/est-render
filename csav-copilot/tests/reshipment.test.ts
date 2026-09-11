import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { LANGS, STRINGS } from '../public/workspace.i18n.js';
import {
  correspond,
  rapprocher,
  type CommandeEnAttente,
  type PaireEnStock,
} from '../src/services/reshipment/rapprochement.ts';
import { planifierLot } from '../src/services/suppliers/importColis.ts';

/*
 * Reshipment : les paires retournées servent les commandes suivantes.
 *
 * CE QUE CES TESTS PROTÈGENT. Une paire du stock retours part de l'agence au
 * lieu de l'atelier : livrée en trois jours, sans rien fabriquer. Mais chaque
 * erreur coûte une paire ou un client — une même paire promise à deux
 * commandes, une commande servie à moitié, une paire belge partie en France
 * pendant qu'un client belge l'attendait, et surtout une commande expédiée
 * DEUX fois, par l'agence et par l'atelier.
 */

const lire = (chemin: string) =>
  readFileSync(fileURLToPath(new URL(`../${chemin}`, import.meta.url)), 'utf8');
const sansCommentaires = (code: string) =>
  code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/[^\n]*/gm, '');

let compteur = 0;
const paire = (pays: string, sku: string, options: Partial<PaireEnStock> = {}): PaireEnStock => ({
  id: `p${++compteur}`,
  pays,
  agenceId: `agence-${pays}`,
  agenceNom: `Agence ${pays}`,
  sku,
  titre: 'Nike Mind 001',
  declinaison: '45',
  depuis: new Date('2026-09-01'),
  retourDe: '#13000',
  ...options,
});
const commande = (id: string, pays: string, lignes: Array<[string, number]>, creeLe = '2026-09-10T10:00:00Z'): CommandeEnAttente => ({
  id,
  nom: `#${id}`,
  client: 'Client',
  pays,
  creeLe,
  lignes: lignes.map(([sku, quantite]) => ({ titre: 'Nike Mind 001', declinaison: '45', sku, quantite })),
});

/* ---- le rapprochement ---- */

test('même pays d’abord, même si une paire voisine est plus ancienne', () => {
  const locale = paire('FR', 'HQ1', { depuis: new Date('2026-09-05') });
  const voisine = paire('BE', 'HQ1', { depuis: new Date('2026-08-01') });
  const [proposition] = rapprocher([voisine, locale], [commande('1', 'FR', [['HQ1', 1]])]);

  assert.equal(proposition!.paires[0]!.returnId, locale.id);
  assert.equal(proposition!.voisin, false);
});

test('un pays voisin sert quand rien n’est disponible sur place — et le dit', () => {
  const belge = paire('BE', 'HQ1');
  const [proposition] = rapprocher([belge], [commande('1', 'FR', [['HQ1', 1]])]);
  assert.equal(proposition!.paysStock, 'BE');
  assert.equal(proposition!.voisin, true);
});

test('un pays sans frontière commune ne sert pas', () => {
  // L'Espagne et l'Italie ne se touchent pas.
  assert.deepEqual(rapprocher([paire('IT', 'HQ1')], [commande('1', 'ES', [['HQ1', 1]])]), []);
});

test('le client du pays passe avant le client voisin, même s’il a commandé après', () => {
  // Une seule paire en Belgique. Le client français a commandé en premier,
  // mais c'est le client belge qui l'attend chez lui : elle ne doit pas
  // partir en France.
  const belge = paire('BE', 'HQ1');
  const propositions = rapprocher(
    [belge],
    [commande('fr', 'FR', [['HQ1', 1]], '2026-09-01T10:00:00Z'), commande('be', 'BE', [['HQ1', 1]], '2026-09-05T10:00:00Z')],
  );
  assert.deepEqual(propositions.map((p) => p.commande), ['#be']);
});

test('une paire ne va qu’à une commande : la plus ancienne', () => {
  const propositions = rapprocher(
    [paire('FR', 'HQ1')],
    [commande('recente', 'FR', [['HQ1', 1]], '2026-09-10T10:00:00Z'), commande('ancienne', 'FR', [['HQ1', 1]], '2026-09-02T10:00:00Z')],
  );
  assert.deepEqual(propositions.map((p) => p.commande), ['#ancienne']);
});

test('chaque exemplaire commandé demande sa paire', () => {
  assert.deepEqual(rapprocher([paire('FR', 'HQ1')], [commande('1', 'FR', [['HQ1', 2]])]), []);
  const [servie] = rapprocher([paire('FR', 'HQ1'), paire('FR', 'HQ1')], [commande('1', 'FR', [['HQ1', 2]])]);
  assert.equal(servie!.paires.length, 2);
});

test('une commande est servie en entier par une seule agence, ou pas du tout', () => {
  // Deux articles, chacun dans une agence différente du même pays : deux
  // colis, et une commande à cheval — refusé.
  const a = paire('FR', 'HQ1', { agenceId: 'paris', agenceNom: 'Paris' });
  const b = paire('FR', 'HQ2', { agenceId: 'lyon', agenceNom: 'Lyon' });
  assert.deepEqual(rapprocher([a, b], [commande('1', 'FR', [['HQ1', 1], ['HQ2', 1]])]), []);

  // Les deux à Paris : servie.
  const c = paire('FR', 'HQ2', { agenceId: 'paris', agenceNom: 'Paris' });
  const [servie] = rapprocher([a, c], [commande('1', 'FR', [['HQ1', 1], ['HQ2', 1]])]);
  assert.equal(servie!.agence!.nom, 'Paris');
  assert.equal(servie!.paires.length, 2);
});

test('les paires les plus anciennes partent en premier', () => {
  const recente = paire('FR', 'HQ1', { depuis: new Date('2026-09-08') });
  const ancienne = paire('FR', 'HQ1', { depuis: new Date('2026-07-01') });
  const [proposition] = rapprocher([recente, ancienne], [commande('1', 'FR', [['HQ1', 1]])]);
  assert.equal(proposition!.paires[0]!.returnId, ancienne.id);
});

test('la référence fait foi ; sans elle, modèle et taille comparés sans casse ni accent', () => {
  const ligne = { titre: 'Nike Mind 001', declinaison: '45', sku: null, quantite: 1 };
  assert.equal(correspond(paire('FR', ' hq1 '), { ...ligne, sku: 'HQ1' }), true);
  assert.equal(correspond(paire('FR', 'HQ1'), { ...ligne, sku: 'HQ2' }), false, 'deux références différentes ne se confondent pas');
  assert.equal(
    correspond(paire('FR', '', { sku: null, titre: 'Adizero Évo', declinaison: '42 2/3' }), { titre: 'adizero evo', declinaison: '42-2/3', sku: null, quantite: 1 }),
    true,
  );
});

/* ---- la route des propositions ---- */

const retours = sansCommentaires(lire('src/routes/returns.ts'));
const corpsRoute = (debut: string, fin: string) => {
  const i = retours.indexOf(debut);
  assert.ok(i > 0, `introuvable : ${debut}`);
  return retours.slice(i, retours.indexOf(fin, i));
};

test('les propositions écartent les commandes commencées par l’atelier ou déjà servies', () => {
  const route = corpsRoute("app.get('/api/returns/matches'", '/api/returns/reemploi');
  assert.match(route, /!commencees\.has\(commande\.id\)/);
  assert.match(route, /!servies\.has\(commande\.id\)/);
  // Toutes les commandes, par pages, et un plafond qui se dit.
  assert.match(route, /sort: 'oldest'/);
  assert.match(route, /tronque = Boolean\(cursor\)/);
});

test('confier une commande : tout revérifié, toutes les paires ou aucune', () => {
  const route = corpsRoute("'/api/returns/reemploi',", "'/api/returns/reemploi/liberer'");
  assert.match(route, /requirePermission\('reply'\)/);

  const commencee = route.indexOf("code: 'commencee'");
  const transaction = route.indexOf('prisma\n        .$transaction');
  const reservation = route.indexOf("where: { id, merchantId, status: 'RESTOCKED', reusedAt: null }");
  assert.ok(commencee > 0 && transaction > 0 && reservation > 0);
  assert.ok(commencee < transaction, 'l’atelier est revérifié avant de réserver');
  assert.ok(reservation > transaction, 'chaque paire est prise DANS la transaction');
  assert.match(route, /if \(prise\.count !== 1\) throw new PairePlusDisponible\(\)/);
});

test('libérer rend les paires au stock, et la commande à l’atelier', () => {
  const route = corpsRoute("'/api/returns/reemploi/liberer',", "'/api/returns/:id/defectueux'");
  assert.match(route, /reusedShopifyOrderId: null, reusedAt: null, status: 'RESTOCKED'/);
});

test('une paire confiée à une commande ne sort pas du stock sans qu’on la libère', () => {
  const route = retours.slice(retours.indexOf("'/api/returns/:id/defectueux'"));
  const refus = route.indexOf("code: 'reservee'");
  const sortie = route.indexOf("status: 'UNUSABLE'");
  assert.ok(refus > 0 && sortie > 0 && refus < sortie);
  // Présent n'est pas atteint : le refus doit dépendre de la réservation.
  // Une première version de ce test restait verte quand la condition
  // devenait `if (false)`.
  assert.match(route, /if \(paire\.reusedShopifyOrderId\) \{\s*return reply\s*\.code\(409\)/);
});

test('l’entrée au stock est datée, et annuler un réemploi rend vraiment la paire', () => {
  assert.match(retours, /fields\.status === 'RESTOCKED' \? \{ restockedAt: new Date\(\) \}/);
  assert.match(retours, /\{ reusedOrderName: null, reusedShopifyOrderId: null, reusedAt: null, status: 'RESTOCKED' \}/);
});

/* ---- l'atelier n'expédie pas ce que le stock sert ---- */

test('une commande servie par le stock disparaît de la liste et des exports de l’atelier', () => {
  const atelier = sansCommentaires(lire('src/routes/supplierWorkspace.ts'));
  for (const route of ["'/api/workspace/:id/orders',", "'/api/workspace/:id/orders.csv',", "'/api/workspace/:id/orders.xlsx',"]) {
    const debut = atelier.indexOf(route);
    assert.ok(debut > 0, route);
    const corps = atelier.slice(debut, debut + 3000);
    assert.match(corps, /commandesServiesParLeStock\(workspace\.merchantId/, route);
    assert.match(corps, /\.filter\(\(order\) => !servies\.has\(order\.id\)\)/, route);
  }
});

test('la saisie d’un colis sur une commande servie par le stock est refusée', () => {
  const atelier = sansCommentaires(lire('src/routes/supplierWorkspace.ts'));
  const debut = atelier.indexOf("'/api/workspace/:id/parcels',");
  const corps = atelier.slice(debut, atelier.indexOf('enregistrerColis(', debut));
  assert.match(corps, /code: 'stock_retour'/, 'le refus doit précéder l’enregistrement');
});

test('dans l’import en masse, la ligne est refusée et dit pourquoi', () => {
  const plan = planifierLot(
    [{ rang: 1, commande: '#13811', suivi: 'LX123456789CN', transporteur: null }],
    [{ id: 'gid://shopify/Order/1', name: '#13811', client: 'Mahdi Ashir' }],
    [],
    new Set(['gid://shopify/Order/1']),
  );
  assert.equal(plan.lignes[0]!.statut, 'stock_retour');
  assert.equal(plan.prets, 0);
  assert.equal(plan.expediees, 0, 'aucun mail au client pour une commande que l’agence expédie');
});

test('le refus de l’atelier est traduit dans ses trois langues', () => {
  for (const { code } of LANGS) {
    const table = (STRINGS as Record<string, Record<string, string>>)[code]!;
    for (const cle of ['bulk.status.stock_retour', 'parcel.err.stock_retour']) {
      assert.equal(typeof table[cle], 'string', `${code} : ${cle}`);
    }
  }
});

/* ---- l'écran du marchand ---- */

test('l’écran confie la commande entière, et la fiche commande le dit', () => {
  const app = lire('public/app.js');
  assert.match(app, /returnIds: proposition\.paires\.map\(\(paire\) => paire\.returnId\)/);
  assert.match(app, /data-ret-defect=/);
  assert.match(app, /data-ret-liberer=/);
  assert.match(app, /orderDetailMarkup\(order, parcels, reemploi\)/);
  assert.equal(/Stock France/.test(app), false, 'le stock n’est pas qu’en France');
});
