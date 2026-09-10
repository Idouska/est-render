import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  etatDossier,
  kpisRuptures,
  syntheseDossier,
  type DossierRupture,
} from '../src/services/ruptures/console.ts';
import {
  fournisseurDuFil,
  lignesArticle,
  lireArticle,
} from '../src/services/suppliers/signalement.ts';

/*
 * Les ruptures signalées par l'atelier, dans la page du marchand.
 *
 * CE QUE CES TESTS PROTÈGENT. C'est le fournisseur qui sait qu'un produit est
 * en rupture — il tient le carton. Tant que la page du marchand ne lisait que
 * ses propres escalades, elle restait vide pendant que les vrais signalements
 * s'entassaient dans SAV client parmi le courrier. Rien ne l'aurait signalé :
 * une page vide a l'air d'une bonne nouvelle.
 *
 * Trois contrats, tous silencieux quand ils rompent :
 *
 *   1. LE FORMAT. Le détail de l'article s'écrit en clair dans le message et
 *      se relit dans la page. Un libellé retouché d'un côté, et la taille
 *      cesse d'apparaître sans une erreur nulle part.
 *
 *   2. L'ÉTAT. Un signalement est une rupture confirmée : le client doit être
 *      prévenu. Le traiter comme une escalade l'enverrait « attendre le
 *      fournisseur » — celui-là même qui vient de répondre.
 *
 *   3. LE COMPTE. La pastille du menu et la page doivent dire la même chose.
 */

/* ---- 1. ce qui s'écrit se relit ---- */

test('le détail écrit par l’atelier se relit à l’identique', () => {
  const saisi = {
    produit: 'Nike Dunk Low',
    couleur: 'Panda',
    taille: '38',
    reference: 'NK-DUNK',
    quantite: 2,
  };
  const texte = [
    "Signalé par Atelier Nord depuis l'atelier.",
    '',
    lignesArticle(saisi).join('\n'),
    '',
    'Il ne reste rien en 38.',
  ].join('\n');

  assert.deepEqual(lireArticle(texte), saisi);
});

test('un champ laissé vide se relit comme absent, pas comme une chaîne vide', () => {
  const texte = lignesArticle({ produit: 'Puma Suede XL', taille: '43' }).join('\n');
  const lu = lireArticle(texte);

  assert.equal(lu.produit, 'Puma Suede XL');
  assert.equal(lu.taille, '43');
  assert.equal(lu.couleur, null, 'une case blanche passerait pour une couleur');
  assert.equal(lu.reference, null);
  assert.equal(lu.quantite, null);
});

test('la note libre ne remplace pas la taille saisie dans le champ', () => {
  // Le bloc structuré vient avant la note : la première occurrence l'emporte.
  const texte = [
    'Taille : 38',
    '',
    'Taille : je ne sais pas trop, peut-être 39 ?',
  ].join('\n');

  assert.equal(lireArticle(texte).taille, '38');
});

test('une quantité illisible n’est pas une quantité de zéro', () => {
  assert.equal(lireArticle('Quantité : deux').quantite, null);
  assert.equal(lireArticle('Quantité : 0').quantite, null);
  assert.equal(lireArticle('Quantité : 3').quantite, 3);
});

test('l’atelier se lit dans la clé du fil, malgré les deux-points du GID', () => {
  // L'identifiant de commande Shopify contient lui-même des deux-points.
  assert.equal(
    fournisseurDuFil('supplier:cks8f2a:gid://shopify/Order/9911:STOCK'),
    'cks8f2a',
  );
  assert.equal(fournisseurDuFil('thread-gmail-ordinaire'), null);
});

/* ---- 2. l'état et la synthèse ---- */

const dossier = (patch: Partial<DossierRupture> = {}): DossierRupture => ({
  id: 't1',
  ticketId: 't1',
  origine: 'atelier',
  statut: 'OPEN',
  creeLe: new Date(Date.now() - 2 * 86_400_000),
  notifieLe: null,
  resoluLe: null,
  reponseFournisseurLe: null,
  reponseClientLe: null,
  rembourse: false,
  sku: 'NK-DUNK',
  montant: 120,
  ...patch,
});

test('un signalement d’atelier est une rupture à annoncer au client', () => {
  assert.equal(
    etatDossier(dossier()),
    'CLIENT_A_PREVENIR',
    'le fournisseur a déjà parlé : le faire « attendre le fournisseur » serait absurde',
  );
});

test('un signalement clos est résolu, remboursé ou non', () => {
  assert.equal(etatDossier(dossier({ statut: 'RESOLVED' })), 'RESOLU');
  assert.equal(etatDossier(dossier({ statut: 'RESOLVED', rembourse: true })), 'RESOLU');
  assert.equal(etatDossier(dossier({ rembourse: true })), 'REMBOURSEMENT');
});

test('une escalade du marchand garde son propre parcours', () => {
  // L'origine ne doit rien changer aux escalades : un brouillon reste à
  // traiter, une demande envoyée attend toujours le fournisseur.
  const escalade = (statut: DossierRupture['statut']) =>
    dossier({ origine: 'marchand', statut });

  assert.equal(etatDossier(escalade('DRAFTING')), 'A_TRAITER');
  assert.equal(etatDossier(escalade('OPEN')), 'FOURNISSEUR_EN_ATTENTE');
});

test('les signalements comptent parmi les clients à prévenir', () => {
  const kpis = kpisRuptures([
    dossier({ id: 'a' }),
    dossier({ id: 'b', sku: 'AD-SAMBA' }),
    dossier({ id: 'c', origine: 'marchand', statut: 'OPEN' }),
  ]);

  assert.equal(kpis.clientsAPrevenir, 2, 'les deux signalements d’atelier');
  assert.equal(kpis.enAttenteFournisseur, 1, 'la seule escalade envoyée');
});

test('la synthèse dit que c’est l’atelier qui a signalé', () => {
  const phrases = syntheseDossier({
    dossier: dossier(),
    produit: 'Nike Dunk Low',
    fournisseur: 'Atelier Nord',
    commandesImpactees: 1,
    maintenant: Date.now(),
  });

  assert.match(phrases[0]!, /Atelier Nord a signalé Nike Dunk Low en rupture/);
  assert.match(phrases.at(-1)!, /prévenez-le/);
});

/* ---- 3. la route, la pastille et l'écran ---- */

const lire = (chemin: string) =>
  readFileSync(fileURLToPath(new URL(`../${chemin}`, import.meta.url)), 'utf8');
const sansCommentaires = (code: string) =>
  code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

const route = sansCommentaires(lire('src/routes/ruptures.ts'));
const app = sansCommentaires(lire('public/app.js'));

test('la page lit les signalements de l’atelier', () => {
  const page = route.slice(route.indexOf("app.get('/api/ruptures',"));
  assert.match(page, /gmailThreadId: \{ startsWith: 'supplier:', endsWith: ':STOCK' \}/);
});

test('la pastille compte les signalements comme la page', () => {
  // « 2 » dans le menu au-dessus d'une page qui en montre 9 : c'est la page
  // qu'on accuserait.
  const compte = route.slice(
    route.indexOf("'/api/ruptures/compte'"),
    route.indexOf("app.get('/api/ruptures',"),
  );
  assert.match(compte, /prisma\.supplierEscalation\.count/);
  assert.match(compte, /prisma\.ticket\.count/);
  assert.match(compte, /endsWith: ':STOCK'/);
  assert.match(compte, /ouverts: escalades \+ signalements/);
});

test('la page n’écrase pas la taille déclarée par une ligne devinée', () => {
  // La photo ne vient que de la ligne dont la référence correspond : celle de
  // la ligne la plus chère pourrait montrer une autre chaussure.
  const page = route.slice(route.indexOf('const articleSignale'));
  assert.match(page, /item\.sku === declare\.reference/);
  assert.match(page, /image: ligne\?\.image \?\? null/);
});

test('clôturer un signalement passe par la route des tickets', () => {
  const clore = app.slice(app.indexOf('function cloreRupture'));
  const corps = clore.slice(0, clore.indexOf('\n}'));

  assert.match(corps, /\/api\/tickets\/\$\{d\.ticketId\}\/resolve/);
  assert.match(corps, /\/api\/escalations\/\$\{d\.id\}\/resolve/);

  // Et la clôture groupée emprunte la même porte.
  const groupe = app.slice(app.indexOf("$('rup-bulk')?.addEventListener"));
  assert.match(groupe.slice(0, 1400), /await cloreRupture\(dossier\)/);
});

test('on n’écrit jamais au client via l’adresse de repli de l’atelier', () => {
  const ecrire = app.slice(app.indexOf('async function ecrireAuClientDepuisRupture'));
  const corps = ecrire.slice(0, ecrire.indexOf('\n}'));

  assert.match(corps, /startsWith\('fournisseur\+'\)/);
  // Le refus doit précéder l'ouverture de la fenêtre de rédaction.
  assert.ok(corps.indexOf("startsWith('fournisseur+')") < corps.indexOf('openCompose('));
});
