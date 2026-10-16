import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  consigneSurLaCommande,
  dateConsigne,
  etatConsigne,
  lireDateConsigne,
  texteConsigne,
  textesConsigne,
  TITRES_CONSIGNE,
} from '../src/services/ruptures/consigneTexte.ts';
import { ligneConsigne, recapDuJour } from '../src/services/suppliers/recapTexte.ts';

/*
 * Répondre à l'atelier sur une rupture.
 *
 * L'atelier signalait « réassort dans dix jours » et attendait : le marchand
 * n'avait que « Proposer un remplacement », et sans modèle en stock, rien à
 * lui dire. Quatre réponses désormais — attendre, remplacer, ne pas expédier,
 * écrire — posées en champs, lues par l'atelier dans sa langue, confirmées
 * d'un bouton, et inscrites sur la commande.
 */

const lire = (chemin: string) => readFileSync(fileURLToPath(new URL(`../${chemin}`, import.meta.url)), 'utf8');

const vingtSix = lireDateConsigne('2026-10-26')!;
const modeles = [
  { productTitle: 'Runner Halo · Noir', variantTitle: '39', sku: 'RH-0390', inventory: 4 },
  { productTitle: 'Runner Halo · Graphite', variantTitle: '38 2/3', sku: 'RH-0382', inventory: 2 },
];
const consigne = (choix: 'ATTENDRE' | 'REMPLACER' | 'ANNULER' | 'MESSAGE', reste: object = {}) => ({
  choix,
  expedierAvant: null,
  modeles: [],
  articlesCommande: null,
  ...reste,
});

test('attendre : la date, écrite dans la langue de l’atelier et le même jour partout', () => {
  const attendre = consigne('ATTENDRE', { expedierAvant: vingtSix });
  assert.deepEqual(texteConsigne(attendre, 'fr'), {
    titre: 'Attendez le réassort, puis expédiez',
    detail: 'Au plus tard le 26 octobre.',
    court: 'Attendre le réassort · au plus tard le 26 oct.',
  });
  assert.equal(texteConsigne(attendre, 'en').court, 'Wait for restock · by 26 Oct');
  assert.equal(texteConsigne(attendre, 'zh').titre, '等补货后再发货');
  assert.match(texteConsigne(attendre, 'zh').court, /^等补货 · 最迟 10月26日$/);
  // Midi UTC : ni Paris ni Shanghai ne la font glisser d'un jour.
  assert.equal(vingtSix.toISOString(), '2026-10-26T12:00:00.000Z');
});

test('remplacer : tous les modèles proposés, puis celui que l’atelier a choisi', () => {
  const remplacer = consigne('REMPLACER', { modeles });
  assert.equal(texteConsigne(remplacer, 'fr').court, 'Expédier RH-0390 ou RH-0382 à la place');
  assert.equal(texteConsigne(remplacer, 'fr').detail, 'Expédiez celui que vous avez parmi ces modèles.');
  assert.equal(texteConsigne(remplacer, 'zh').court, '改发 RH-0390 或 RH-0382');
  const choisi = { ...remplacer, modeleChoisi: 1 };
  assert.equal(texteConsigne(choisi, 'en').court, 'Ship RH-0382 instead');
  // Sans référence, le nom du modèle.
  assert.equal(
    texteConsigne(consigne('REMPLACER', { modeles: [{ productTitle: 'Mule Ilia', variantTitle: '40' }] }), 'fr').court,
    'Expédier Mule Ilia · 40 à la place',
  );
});

test('ne pas expédier : le reste de la commande part, ou rien ne part', () => {
  assert.equal(texteConsigne(consigne('ANNULER', { articlesCommande: 1 }), 'fr').detail, 'La commande ne partira pas : ne la préparez pas.');
  assert.equal(texteConsigne(consigne('ANNULER', { articlesCommande: 3 }), 'fr').detail, 'Expédiez le reste de la commande.');
  // Shopify n'a pas répondu : on ne promet ni l'un ni l'autre.
  assert.equal(texteConsigne(consigne('ANNULER'), 'fr').detail, 'Annulé pour la cliente.');
  assert.equal(texteConsigne(consigne('ANNULER', { articlesCommande: 1 }), 'zh').detail, '该订单不发货，请勿备货。');
});

test('les trois langues ont chacune leurs quatre consignes', () => {
  for (const langue of ['fr', 'en', 'zh'] as const) {
    for (const choix of ['ATTENDRE', 'REMPLACER', 'ANNULER', 'MESSAGE'] as const) {
      const texte = texteConsigne(consigne(choix, { expedierAvant: vingtSix, modeles }), langue);
      assert.ok(texte.titre && texte.court, `${langue} ${choix}`);
    }
  }
  assert.deepEqual(Object.keys(textesConsigne(consigne('MESSAGE'))), ['fr', 'en', 'zh']);
});

test('une date qui ne se lit pas est refusée plutôt que décalée', () => {
  assert.equal(lireDateConsigne('2026-02-31'), null);
  assert.equal(lireDateConsigne('26/10/2026'), null);
  assert.equal(lireDateConsigne(null), null);
});

test('l’état d’une consigne, et ce qui s’inscrit sur la commande', () => {
  assert.equal(etatConsigne({ reponse: null, remplaceeLe: null }), 'ENVOYEE');
  assert.equal(etatConsigne({ reponse: 'COMPRIS', remplaceeLe: null }), 'COMPRISE');
  assert.equal(etatConsigne({ reponse: 'IMPOSSIBLE', remplaceeLe: null }), 'IMPOSSIBLE');
  assert.equal(etatConsigne({ reponse: null, remplaceeLe: new Date() }), 'REMPLACEE');
  assert.equal(consigneSurLaCommande({ choix: 'ATTENDRE', reponse: null, remplaceeLe: null }), true);
  assert.equal(consigneSurLaCommande({ choix: 'ATTENDRE', reponse: 'IMPOSSIBLE', remplaceeLe: null }), false);
  assert.equal(consigneSurLaCommande({ choix: 'MESSAGE', reponse: null, remplaceeLe: null }), false);
  assert.equal(consigneSurLaCommande({ choix: 'ANNULER', reponse: 'COMPRIS', remplaceeLe: new Date() }), false);
});

test('le récapitulatif du matin annonce la réponse du marchand', () => {
  const ligne = { orderName: '#12890', court: 'Attendre le réassort · au plus tard le 26 oct.' };
  assert.equal(ligneConsigne(ligne, 'fr'), '- #12890 — Réponse du marchand : Attendre le réassort · au plus tard le 26 oct.');
  assert.equal(ligneConsigne({ orderName: null, court: '等补货 · 最迟 10月26日' }, 'zh'), '- 无订单 — 商家回复：等补货 · 最迟 10月26日');
  const recap = recapDuJour({
    merchantName: 'Atelier Lumen',
    nouvelles: { demandes: [], ruptures: [], consignes: [ligne] },
    enAttente: { demandes: [], ruptures: [], consignes: [{ ...ligne, orderName: '#12862', jours: 2 }] },
    lien: null,
  });
  assert.ok(recap);
  assert.match(recap.subject, /2 demandes/);
  assert.match(recap.body, /Nouvelles demandes :\n- #12890 — Réponse du marchand/);
  assert.match(recap.body, /- #12862 — Réponse du marchand : .+ \(depuis 2 j\)/);
});

test('la consigne a sa table, sa migration, et le rappel la marque', () => {
  const schema = lire('prisma/schema.prisma');
  assert.match(schema, /model RuptureConsigne \{[\s\S]*choix\s+ConsigneChoix[\s\S]*remplaceeLe DateTime\?/);
  assert.match(schema, /enum ConsigneReponse \{\s*COMPRIS[\s\S]*IMPOSSIBLE[\s\S]*REPONDU/);
  const migrations = readdirSync(fileURLToPath(new URL('../prisma/migrations', import.meta.url)));
  const dossier = migrations.find((nom) => nom.endsWith('_consigne_rupture'));
  assert.ok(dossier && existsSync(fileURLToPath(new URL(`../prisma/migrations/${dossier}/migration.sql`, import.meta.url))));
  const recap = lire('src/services/suppliers/recap.ts');
  assert.match(recap, /prisma\.ruptureConsigne\.updateMany\(\{[\s\S]*?data: \{ avisLe: maintenant \}/);
  assert.match(recap, /prisma\.ruptureConsigne\.updateMany\(\{[\s\S]*?data: \{ rappelLe: maintenant \}/);
});

test('le marchand répond depuis le dossier ; l’atelier, depuis son ticket', () => {
  const ruptures = lire('src/routes/ruptures.ts');
  assert.match(ruptures, /'\/api\/ruptures\/:ticketId\/consigne',\s*\{ preHandler: requirePermission\('reply'\) \}/);
  // L'atelier annoncé est vérifié, jamais cru.
  assert.match(ruptures, /where: \{ id: atelierId, merchantId, active: true \}/);
  // « Ne pas expédier » ne peut pas attendre le récapitulatif.
  assert.match(lire('src/services/ruptures/consigne.ts'), /if \(params\.consigne\.choix !== 'ANNULER'\) return false;/);

  const atelier = lire('src/routes/supplierWorkspace.ts');
  assert.match(atelier, /'\/api\/workspace\/:id\/consignes\/:consigneId',\s*async \(request, reply\) => \{\s*const workspace = await authorize\(request, reply\);/);
  // Chaque atelier ne lit que les consignes qui lui sont adressées.
  assert.match(atelier, /consignesDesTickets\(workspace\.merchantId, ids, workspace\.supplierId\)/);
  assert.match(atelier, /consigne: consignes\.get\(order\.id\) \?\? null,/);
  // Une seule réponse, à la consigne courante : un double clic n'écrit qu'une fois.
  assert.match(lire('src/services/ruptures/consigne.ts'), /where: \{ id: consigne\.id, reponse: null, remplaceeLe: null \}/);
});

test('l’aperçu « Ce que verra l’atelier » dit les mêmes mots que le serveur', () => {
  const app = lire('public/app.js');
  const gabarits = {
    fr: 'Attendre le réassort · au plus tard le ${date}',
    en: 'Wait for restock · by ${date}',
    zh: '等补货 · 最迟 ${date}',
  };
  for (const langue of ['fr', 'en', 'zh'] as const) {
    const attendre = texteConsigne(consigne('ATTENDRE', { expedierAvant: vingtSix }), langue).court;
    assert.equal(attendre, gabarits[langue].replace('${date}', dateConsigne(vingtSix, langue)));
    assert.ok(app.includes(`\`${gabarits[langue]}\``), `${langue} ATTENDRE`);
    assert.ok(app.includes(`'${texteConsigne(consigne('ANNULER'), langue).court}'`), `${langue} ANNULER`);
    assert.ok(app.includes(`'${texteConsigne(consigne('MESSAGE'), langue).court}'`), `${langue} MESSAGE`);
  }
  assert.ok(app.includes('`Expédier ${ref} à la place`'));
  assert.ok(app.includes('`Ship ${ref} instead`'));
  assert.ok(app.includes('`改发 ${ref}`'));
  // Les quatre tuiles de la fenêtre : une par consigne.
  const html = lire('public/dashboard.html');
  for (const choix of Object.keys(TITRES_CONSIGNE.fr)) assert.match(html, new RegExp(`data-ra-choix="${choix}"`));
  // L'ancienne fenêtre « Proposer un remplacement » a disparu : « Remplacer » en est une réponse.
  assert.doesNotMatch(html, /id="subst-modal"/);
  assert.doesNotMatch(app, /function ouvrirFenetreSubstitution/);
});

test('l’atelier : statut, boutons, et les mêmes clés dans les trois langues', () => {
  const ws = lire('public/workspace.js');
  assert.match(ws, /if \(consigne && !consigne\.reponse\) return 'A_REPONDRE';/);
  assert.match(ws, /if \(consigne\?\.reponse === 'COMPRIS'\) return 'CLOS';/);
  assert.match(ws, /api\(`\/api\/workspace\/\$\{supplierId\}\/consignes\/\$\{id\}`/);
  assert.match(ws, /cablerConsignes\(\);/);

  const i18n = lire('public/workspace.i18n.js');
  const blocs = i18n.split(/\n  (?:fr|en|zh): \{/).slice(1);
  assert.equal(blocs.length, 3);
  const cles = blocs.map((bloc) => [...bloc.matchAll(/'(csg\.[\w.]+)':/g)].map((m) => m[1]).sort());
  assert.ok(cles[0]!.length >= 20);
  assert.deepEqual(cles[1], cles[0]);
  assert.deepEqual(cles[2], cles[0]);
});
