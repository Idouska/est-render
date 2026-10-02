import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { calculerQualite } from '../src/services/suppliers/fiabilite.ts';
import { bornesDuMois, composerReleve, moisCourant } from '../src/services/suppliers/releve.ts';

/*
 * Le relevé mensuel et la qualité d'un atelier.
 *
 * CE QUE CES TESTS PROTÈGENT. Le relevé sert à vérifier une facture : une
 * commande n'y figure qu'au mois où son lot est parti (heure de Paris), et
 * une commande annulée mais expédiée quand même compte comme expédiée — c'est
 * ce que l'atelier facturera. La qualité, elle, ne vaut jamais « 0 % » faute
 * de commandes : sans données, elle reste vide.
 */

const lire = (chemin: string) =>
  readFileSync(fileURLToPath(new URL(`../${chemin}`, import.meta.url)), 'utf8');
const t = (iso: string) => new Date(iso);

test('un mois commence et finit à minuit, heure de Paris', () => {
  // Septembre : heure d'été, UTC+2.
  assert.deepEqual(bornesDuMois('2026-09'), { debut: t('2026-08-31T22:00:00Z'), fin: t('2026-09-30T22:00:00Z') });
  // Décembre : heure d'hiver, et l'année d'après.
  assert.deepEqual(bornesDuMois('2026-12'), { debut: t('2026-11-30T23:00:00Z'), fin: t('2026-12-31T23:00:00Z') });
  for (const faux of ['2026-13', '2026-9', 'septembre', '']) assert.equal(bornesDuMois(faux), null, faux);
  assert.equal(moisCourant(t('2026-09-30T22:30:00Z')), '2026-10', 'déjà octobre à Paris');
});

test('une ligne par commande, et des totaux qui se recomptent', () => {
  const releve = composerReleve({
    mois: '2026-09',
    commandes: [
      { shopifyOrderId: 'a', orderName: '#2', articles: 'Lampe · 45', envoyeLe: t('2026-09-02T07:00:00Z') },
      { shopifyOrderId: 'b', orderName: '#1', articles: null, envoyeLe: t('2026-09-02T07:00:00Z') },
      { shopifyOrderId: 'c', orderName: '#3', articles: null, envoyeLe: t('2026-09-01T07:00:00Z') },
      { shopifyOrderId: 'd', orderName: '#4', articles: null, envoyeLe: t('2026-09-03T07:00:00Z') },
    ],
    colis: [
      { shopifyOrderId: 'a', trackingNumber: 'LP2', createdAt: t('2026-09-05T10:00:00Z') },
      { shopifyOrderId: 'a', trackingNumber: 'LP1', createdAt: t('2026-09-04T10:00:00Z') },
      // Annulée trop tard : partie quand même.
      { shopifyOrderId: 'd', trackingNumber: 'LP9', createdAt: t('2026-09-04T10:00:00Z') },
    ],
    annulees: new Set(['c', 'd']),
    remplacements: new Map([['a', 'Lampe · 46']]),
    retours: new Map([['a', 'DEFECT']]),
  });
  assert.deepEqual(releve.lignes.map((l) => [l.commande, l.statut]), [
    ['#3', 'ANNULEE'],
    ['#1', 'NON_EXPEDIEE'],
    ['#2', 'EXPEDIEE'],
    ['#4', 'EXPEDIEE'],
  ]);
  const a = releve.lignes.find((l) => l.commande === '#2')!;
  assert.deepEqual(a.suivis, ['LP1', 'LP2']);
  assert.deepEqual(a.expedieeLe, t('2026-09-04T10:00:00Z'));
  assert.equal(a.remplacement, 'Lampe · 46');
  assert.equal(a.retour, 'Défaut');
  assert.deepEqual(releve.totaux, { envoyees: 4, expediees: 2, nonExpediees: 1, annulees: 1, remplacees: 1, retours: 1 });
});

test('la qualité : des parts, et rien plutôt que zéro', () => {
  assert.deepEqual(
    calculerQualite({ commandes: 40, retours: [{ raison: 'DEFECT' }, { raison: 'SIZE' }, { raison: 'SIZE' }], manquants: 1 }),
    { commandes: 40, retoursPct: 7.5, defautPct: 2.5, manquantsPct: 2.5 },
  );
  assert.deepEqual(calculerQualite({ commandes: 0, retours: [], manquants: 0 }), {
    commandes: 0,
    retoursPct: null,
    defautPct: null,
    manquantsPct: null,
  });
});

test('la qualité se rattache à l’atelier qui a préparé la commande', () => {
  const donnees = lire('src/services/suppliers/fiabiliteDonnees.ts');
  assert.match(donnees, /const depuis = new Date\(maintenant\.getTime\(\) - 90 \* 86_400_000\);/);
  assert.match(donnees, /if \(atelierDe\.get\(manquant\.shopifyOrderId!\) === manquant\.supplierId\)/);
  assert.match(lire('public/app.js'), /ligne\('Qualité · 90 jours', qualite\)/);
});

test('le relevé : borné à la boutique, à l’écran et en Excel', () => {
  const routes = lire('src/routes/suppliers.ts');
  const route = routes.slice(routes.indexOf("'/api/suppliers/:id/releve'"));
  assert.match(route, /where: \{ id: request\.params\.id, merchantId \}/);
  assert.match(route, /if \(!releve\) return reply\.code\(400\)/);
  assert.match(route, /format === 'xlsx'/);
  const donnees = lire('src/services/suppliers/releveDonnees.ts');
  assert.match(donnees, /envoi: \{ supplierId, emailedAt: \{ not: null, gte: bornes\.debut, lt: bornes\.fin \} \}/);
  const app = lire('public/app.js');
  assert.match(app, /data-sup-releve="\$\{esc\(supplier\.id\)\}"/);
  assert.match(app, /releve\?mois=\$\{mois\}&format=xlsx/);
  assert.match(lire('public/dashboard.html'), /id="releve-modal"/);
});
