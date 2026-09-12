import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { LANGS, STRINGS } from '../public/workspace.i18n.js';
import { atelierPour, choisirSource, type AtelierCandidat } from '../src/services/reshipment/echange.ts';
import type { PaireEnStock } from '../src/services/reshipment/rapprochement.ts';

/*
 * L'envoi de l'échange.
 *
 * CE QUE CES TESTS PROTÈGENT. Un échange promet une paire précise à un client
 * précis, et deux fautes s'y paient cher.
 *
 * La première est de promettre DEUX FOIS la même paire — à un échange et à une
 * commande, ou à deux échanges : le stock n'en a qu'une, et le second client
 * attendra une paire déjà partie sans que rien ne le signale. La réservation
 * est donc conditionnelle, et un deuxième clic ne prend rien.
 *
 * La seconde est de laisser partir le colis SANS PRÉVENIR le client. Un
 * échange n'est pas une commande Shopify : aucune expédition n'y est créée,
 * donc aucun e-mail ne part tout seul. Le message au client est le seul que
 * personne n'enverra à notre place.
 */

const lire = (chemin: string) =>
  readFileSync(fileURLToPath(new URL(`../${chemin}`, import.meta.url)), 'utf8');
const sansCommentaires = (code: string) =>
  code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/[^\n]*/gm, '');

const paire = (partie: Partial<PaireEnStock> & { id: string }): PaireEnStock => ({
  pays: 'FR',
  agenceId: 'ag-fr',
  agenceNom: 'Paris',
  sku: null,
  titre: 'Nike Mind 001 Black',
  declinaison: '42',
  depuis: new Date('2026-01-01'),
  retourDe: '#100',
  ...partie,
});

const ATELIERS: AtelierCandidat[] = [
  { id: 'a1', nom: 'Atelier Nike', skuPrefixes: ['HQ'], isDefault: false },
  { id: 'a2', nom: 'Atelier général', skuPrefixes: [], isDefault: true },
];

const VEUT = { pays: 'FR', titre: 'Nike Mind 001 Black', declinaison: '42', sku: null };

/* ---- qui envoie ---- */

test('la paire du pays du client l’emporte sur celle du pays voisin', () => {
  const choix = choisirSource(
    VEUT,
    [
      paire({ id: 'be', pays: 'BE', agenceNom: 'Bruxelles', depuis: new Date('2025-01-01') }),
      paire({ id: 'fr', pays: 'FR', depuis: new Date('2026-06-01') }),
    ],
    ATELIERS,
  );

  assert.equal(choix.source, 'STOCK');
  assert.equal(choix.source === 'STOCK' && choix.paire.id, 'fr', 'même plus récente, la paire sur place part la première');
});

test('à égalité, la paire la plus ancienne part — le stock ne vieillit pas', () => {
  const choix = choisirSource(
    VEUT,
    [
      paire({ id: 'recente', depuis: new Date('2026-06-01') }),
      paire({ id: 'ancienne', depuis: new Date('2025-02-01') }),
    ],
    ATELIERS,
  );
  assert.equal(choix.source === 'STOCK' && choix.paire.id, 'ancienne');
});

test('le pays voisin sert quand le pays du client n’a rien', () => {
  const choix = choisirSource(VEUT, [paire({ id: 'be', pays: 'BE' })], ATELIERS);
  assert.equal(choix.source === 'STOCK' && choix.paire.id, 'be');
});

test('une paire d’un pays ni identique ni voisin ne part pas : l’atelier prend le relais', () => {
  // L'Italie n'est pas voisine de l'Espagne dans la table des voisins : un
  // envoi transfrontalier de plus coûte plus cher qu'une paire fabriquée.
  const choix = choisirSource({ ...VEUT, pays: 'ES' }, [paire({ id: 'it', pays: 'IT' })], ATELIERS);
  assert.equal(choix.source, 'ATELIER');
});

test('une paire sans pays n’est jamais promise : on ne saurait pas d’où elle part', () => {
  // Ni sur place ni à côté : le pays est la seule chose qui désigne une paire.
  assert.equal(choisirSource(VEUT, [paire({ id: 'nulle-part', pays: null })], ATELIERS).source, 'ATELIER');
  // Et quand on ignore aussi le pays du CLIENT, rien ne part du stock : sans
  // destination, choisir une agence reviendrait à tirer au sort. Y compris —
  // surtout — face à une paire dont le pays est inconnu lui aussi : deux
  // inconnues ne font pas une correspondance.
  assert.equal(choisirSource({ ...VEUT, pays: null }, [paire({ id: 'fr' })], ATELIERS).source, 'ATELIER');
  assert.equal(
    choisirSource({ ...VEUT, pays: null }, [paire({ id: 'sans-pays', pays: null })], ATELIERS).source,
    'ATELIER',
  );
});

test('une autre taille n’est pas la paire voulue', () => {
  const choix = choisirSource(VEUT, [paire({ id: 'p', declinaison: '44' })], ATELIERS);
  assert.equal(choix.source, 'ATELIER');
});

/* ---- l'atelier, à défaut ---- */

test('l’atelier est celui qui revendique le préfixe de référence', () => {
  const choix = choisirSource({ ...VEUT, sku: 'HQ4307-001' }, [], ATELIERS);
  assert.equal(choix.source === 'ATELIER' && choix.atelier.id, 'a1');
});

test('sans référence reconnue, l’atelier par défaut prend', () => {
  assert.equal(atelierPour('ZZ-999', ATELIERS)?.id, 'a2');
  assert.equal(atelierPour(null, ATELIERS)?.id, 'a2');
});

test('sans paire et sans atelier, l’outil le dit au lieu de choisir au hasard', () => {
  const choix = choisirSource(VEUT, [], [{ id: 'a1', nom: 'Nike', skuPrefixes: ['HQ'], isDefault: false }]);
  assert.equal(choix.source, 'AUCUNE');
});

/* ---- la réservation ---- */

const retours = sansCommentaires(lire('src/routes/returns.ts'));
const organiser = retours.slice(retours.indexOf("'/api/returns/:id/echange/organiser'"));

test('la paire est réservée par une écriture conditionnelle, et un second clic ne prend rien', () => {
  const prise = organiser.indexOf('prisma.returnCase.updateMany');
  assert.ok(prise > 0, 'la réservation doit exister');
  const corps = organiser.slice(prise, prise + 500);
  assert.match(corps, /status: 'RESTOCKED', reusedAt: null/, 'seule une paire encore en stock peut être prise');
  assert.match(organiser.slice(prise, prise + 900), /prise\.count !== 1/, 'une prise sans effet doit être refusée');
  assert.match(organiser.slice(prise, prise + 1100), /code: 'plus_disponible'/);
});

test('un dossier déjà organisé n’est pas organisé une seconde fois', () => {
  const garde = organiser.indexOf('dossier.exchangeStockCaseId || dossier.exchangeSupplierId');
  assert.ok(garde > 0, 'la vérification doit exister');
  assert.ok(garde < organiser.indexOf('prisma.returnCase.updateMany'), 'et précéder toute réservation');
  assert.match(organiser.slice(garde, garde + 300), /code: 'deja_organise'/);
});

test('un dossier sans article voulu est refusé : personne ne saurait quoi envoyer', () => {
  const garde = organiser.indexOf("dossier.resolution !== 'EXCHANGE' || !dossier.wantedTitle");
  assert.ok(garde > 0);
  assert.ok(garde < organiser.indexOf('prisma.returnCase.updateMany'));
});

test('annuler après le départ du colis est refusé, et la paire revient au stock sinon', () => {
  const annuler = retours.slice(retours.indexOf("'/api/returns/:id/echange/annuler'"));
  const garde = annuler.indexOf('dossier.exchangeShippedAt');
  const liberation = annuler.indexOf('prisma.returnCase.updateMany');
  assert.ok(garde > 0, 'la vérification doit exister');
  assert.ok(garde < liberation, 'et précéder la libération');
  assert.match(annuler.slice(garde, garde + 300), /code: 'deja_expedie'/);
  assert.match(annuler.slice(liberation, liberation + 400), /reusedAt: null, status: 'RESTOCKED'/);
});

/* ---- qui a le droit d'écrire le numéro ---- */

test('l’agence n’écrit que sur les échanges servis par une paire de SON stock', () => {
  const portail = sansCommentaires(lire('src/routes/agencyPortal.ts'));
  const route = portail.slice(portail.lastIndexOf("'/api/agence/:id/echanges',"));
  assert.match(
    route,
    /agencyId: agence\.id, reusedReturnCaseId: parsed\.data\.caseId/,
    'la paire réservée, et elle seule, donne le droit d’écrire',
  );
  assert.match(route, /code: 'introuvable'/);
});

test('l’atelier n’écrit que sur les échanges qui lui sont confiés', () => {
  const atelier = sansCommentaires(lire('src/routes/supplierWorkspace.ts'));
  const route = atelier.slice(atelier.lastIndexOf("'/api/workspace/:id/echanges',"));
  const ecriture = route.indexOf('prisma.returnCase.updateMany');
  assert.ok(ecriture > 0);
  assert.match(
    route.slice(ecriture, ecriture + 400),
    /exchangeSupplierId: workspace\.supplierId/,
    'l’écriture est bornée par la même condition que la lecture',
  );
  assert.match(route.slice(ecriture, ecriture + 900), /misAJour\.count === 0/);
});

test('un numéro corrigé redemande de prévenir le client, des deux côtés', () => {
  for (const [quoi, fichier, ancre] of [
    ['l’agence', 'src/routes/agencyPortal.ts', "'/api/agence/:id/echanges',"],
    ['l’atelier', 'src/routes/supplierWorkspace.ts', "'/api/workspace/:id/echanges',"],
  ] as const) {
    const source = sansCommentaires(lire(fichier));
    const route = source.slice(source.lastIndexOf(ancre));
    assert.match(route.slice(0, 3000), /exchangeNotifiedAt: null/, `${quoi} : le client doit être reprévenu`);
  }
});

test('la pastille de l’atelier ne consomme pas le quota Shopify du marchand', () => {
  const atelier = sansCommentaires(lire('src/routes/supplierWorkspace.ts'));
  const route = atelier.slice(atelier.indexOf("'/api/workspace/:id/echanges',"));
  const compte = route.indexOf("request.query.compte === '1'");
  const shopify = route.indexOf('getShopifyClient');
  assert.ok(compte > 0, 'le raccourci doit exister');
  assert.ok(shopify > 0, 'la route lit bien les adresses par ailleurs');
  assert.ok(compte < shopify, 'et le raccourci doit rendre la main avant');
  assert.match(lire('public/workspace.js'), /echanges\?compte=1/, 'la page doit l’emprunter');
});

/* ---- prévenir le client ---- */

test('le message au client porte le numéro de suivi, et part par le canal connu', () => {
  const app = lire('public/app.js');
  const message = app.slice(app.indexOf('function echangeMessage('), app.indexOf('function blocEchange('));
  assert.match(message, /item\.exchangeTrackingNumber/, 'sans numéro, le message ne sert à rien');
  assert.match(message, /wa\.me/, 'WhatsApp quand on a son numéro');
  assert.match(message, /mailto:/, 'l’e-mail sinon');
});

test('le geste « Prévenir le client » n’est proposé qu’une fois le colis parti', () => {
  const app = lire('public/app.js');
  const bloc = app.slice(app.indexOf('function blocEchange('), app.indexOf('function renderReturns('));
  const depart = bloc.indexOf('item.exchangeShippedAt');
  const prevenu = bloc.indexOf('data-ret-echange-prevenu');
  assert.ok(depart > 0 && prevenu > 0);
  assert.ok(depart < prevenu, 'le bouton vient après la vérification du départ');
  assert.match(bloc, /item\.exchangeNotifiedAt/, 'et disparaît une fois le client prévenu');
});

/* ---- les pages ---- */

test('l’atelier lit ses échanges dans sa langue', () => {
  const js = lire('public/workspace.js');
  const html = lire('public/workspace.html');
  const appelees = new Set([
    ...[...js.matchAll(/\bt\('(ech\.[\w.]+)'/g)].map((m) => m[1]!),
    ...[...html.matchAll(/data-t="((?:ech|nav)\.[\w.]+)"/g)].map((m) => m[1]!),
  ]);
  assert.ok(appelees.size >= 15, 'le vocabulaire des échanges manque');

  for (const { code } of LANGS) {
    const table = (STRINGS as Record<string, Record<string, string>>)[code]!;
    assert.deepEqual([...appelees].filter((cle) => typeof table[cle] !== 'string'), [], `${code} : une clé absente`);
  }
});

test('la section des échanges existe des deux côtés', () => {
  assert.match(lire('public/workspace.html'), /id="view-echanges"/);
  assert.match(lire('public/workspace.html'), /data-view="echanges"/);
  assert.match(lire('public/agence.html'), /id="ag-sec-echanges"/);
  assert.match(lire('public/agence.js'), /ag-sec-echanges'\)\.hidden = echanges\.length === 0/);
});
