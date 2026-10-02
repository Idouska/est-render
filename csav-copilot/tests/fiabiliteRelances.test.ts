import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { heureAtelier, rappelDuRetard } from '../src/services/envoi/rappel.ts';
import { estEnRetard, joursDepuis } from '../src/services/envoi/statutLot.ts';
import { calculerFiabilite } from '../src/services/suppliers/fiabilite.ts';

/*
 * Relances de retard et fiabilité des ateliers.
 *
 * CE QUE CES TESTS PROTÈGENT. Un retard se juge sur l'expédition, pas sur
 * l'annonce d'une production ; le rappel ne part qu'une fois, et seulement
 * s'il est vraiment parti ; et un chiffre de fiabilité sans donnée reste vide
 * plutôt que de valoir zéro, qui se lirait « parfait ».
 */

const lire = (chemin: string) =>
  readFileSync(fileURLToPath(new URL(`../${chemin}`, import.meta.url)), 'utf8');
const maintenant = new Date('2026-10-10T10:00:00Z');
const ilYa = (jours: number) => new Date(maintenant.getTime() - jours * 86_400_000);

test('en retard : non expédiée au-delà du délai, même « en production »', () => {
  const base = { delaiJours: 2, maintenant };
  assert.equal(estEnRetard({ ...base, statut: 'A_PREPARER', envoyeLe: ilYa(1) }), false);
  assert.equal(estEnRetard({ ...base, statut: 'A_PREPARER', envoyeLe: ilYa(3) }), true);
  assert.equal(estEnRetard({ ...base, statut: 'EN_PRODUCTION', envoyeLe: ilYa(3) }), true);
  assert.equal(estEnRetard({ ...base, statut: 'EXPEDIEE', envoyeLe: ilYa(9) }), false);
  assert.equal(joursDepuis(ilYa(3.4), maintenant), 3);
});

test('le rappel liste les commandes et mène à l’onglet des lots', () => {
  const rappel = rappelDuRetard({
    merchantName: 'Atelier Lumen',
    delaiJours: 2,
    commandes: [
      { orderName: '#10428', articles: 'Lampe Perce-neige · Laiton', jours: 3 },
      { orderName: '#10410', articles: null, jours: 4 },
    ],
    lien: 'https://exemple.test/fournisseur/s1?token=x',
  });
  assert.equal(rappel.subject, 'Rappel — 2 commandes à expédier depuis plus de 2 jours');
  assert.match(rappel.body, /- #10428 — Lampe Perce-neige · Laiton \(depuis 3 j\)/);
  assert.match(rappel.body, /- #10410 \(depuis 4 j\)/);
  assert.match(rappel.body, /« Lots reçus »/);
  assert.match(rappel.body, /https:\/\/exemple\.test\/fournisseur\/s1\?token=x/);
});

test('le rappel part aux heures de l’atelier, une fois, et seulement s’il est parti', () => {
  assert.equal(heureAtelier(new Date('2026-10-10T01:00:00Z')), 9, 'Shanghai = UTC+8');
  const relances = lire('src/services/envoi/relances.ts');
  assert.match(relances, /if \(heure < OUVERTURE \|\| heure >= FERMETURE\) return 0;/);
  assert.match(relances, /rappeleLe: null,/);
  // Noté APRÈS l'envoi : un rappel en échec repart au passage suivant.
  assert.ok(relances.indexOf('await sendPlainEmail(') < relances.indexOf('data: { rappeleLe: maintenant }'));
  // Une commande avec un colis n'est pas en retard.
  assert.match(relances, /!expediees\.has\(commande\.shopifyOrderId\)/);
  assert.match(lire('src/worker.ts'), /await relancerLotsEnRetard\(\);/);
});

test('fiabilité : quatre chiffres, chacun avec son volume', () => {
  const f = calculerFiabilite({
    demandes: [
      { creeLe: ilYa(3), reponduLe: new Date(ilYa(3).getTime() + 4 * 3_600_000), statut: 'ACKNOWLEDGED' },
      { creeLe: ilYa(2), reponduLe: new Date(ilYa(2).getTime() + 8 * 3_600_000), statut: 'REFUSED' },
      { creeLe: ilYa(1), reponduLe: null, statut: 'PENDING' },
    ],
    commandes: [
      { envoyeLe: ilYa(10), expedieeLe: ilYa(9) }, // 1 j : à l'heure
      { envoyeLe: ilYa(10), expedieeLe: ilYa(6) }, // 4 j : en retard
      { envoyeLe: ilYa(5), expedieeLe: null }, // rien après 5 j : en retard
      { envoyeLe: ilYa(1), expedieeLe: null }, // délai pas écoulé : non jugée
    ],
    delaiJours: 2,
    maintenant,
  });
  assert.deepEqual(f, {
    demandes: 3,
    reponseMoyenneH: 6,
    refusPct: 50,
    commandes: 3,
    expeditionMoyenneJ: 2.5,
    retardPct: 67,
  });
});

test('fiabilité : sans donnée, des chiffres vides, pas des zéros', () => {
  assert.deepEqual(calculerFiabilite({ demandes: [], commandes: [], delaiJours: 2, maintenant }), {
    demandes: 0,
    reponseMoyenneH: null,
    refusPct: null,
    commandes: 0,
    expeditionMoyenneJ: null,
    retardPct: null,
  });
});

test('le marchand voit retards et fiabilité sans rien ouvrir', () => {
  assert.match(lire('src/routes/commerce.ts'), /counts\.envoi = await compterRetards\(merchantId\);/);
  assert.match(lire('src/routes/suppliers.ts'), /fiabilite: fiabilite\.get\(supplier\.id\) \?\? null,/);
  const app = lire('public/app.js');
  assert.match(app, /\$\{fiabiliteMarkup\(stats\.fiabilite\)\}/);
  assert.match(app, /commande\.enRetard \? `<span class="tag tone-bad envoi-retard">En retard · \$\{commande\.joursDepuis\} j<\/span>`/);
  assert.match(lire('src/routes/envoiQuotidien.ts'), /delaiJours: z\.number\(\)\.int\(\)\.min\(1\)\.max\(30\)\.optional\(\)/);
});
