import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { articlesDe, calculerStats, raisonDe, type EntreesStats } from '../src/services/refunds/stats.ts';
import type { RemboursementDetaille } from '../src/services/shopify/refundHistory.ts';

/*
 * Les statistiques des remboursements.
 *
 * CE QUE CES TESTS PROTÈGENT. Un total qui compterait deux fois le même
 * remboursement (l'outil et sa copie Shopify), un remboursement de test ou en
 * échec compté comme de l'argent parti, une raison inventée là où il n'y en a
 * pas, un produit désigné au hasard sur un remboursement partiel.
 */

const lire = (chemin: string) =>
  readFileSync(fileURLToPath(new URL(`../${chemin}`, import.meta.url)), 'utf8');

const ligne = (title: string, amount: number | null, variantTitle: string | null = null) => ({
  title,
  variantTitle,
  quantity: 1,
  amount,
  image: null,
});

test('la raison vient du motif, précisée par le dossier de retour', () => {
  assert.equal(raisonDe('Article endommagé à la réception'), 'abime');
  assert.equal(raisonDe('Colis perdu par le transporteur'), 'perdu');
  assert.equal(raisonDe('Erreur de préparation'), 'preparation');
  assert.equal(raisonDe('Geste commercial'), 'geste');
  // « Retour accepté » ne dit pas pourquoi : le dossier de retour le dit.
  assert.equal(raisonDe('Retour reçu et accepté'), 'retour');
  assert.equal(raisonDe('Retour reçu et accepté', 'SIZE'), 'taille');
  assert.equal(raisonDe(null, 'MODEL'), 'modele');
  // Le motif choisi l'emporte sur le dossier.
  assert.equal(raisonDe('Colis perdu par le transporteur', 'SIZE'), 'perdu');
  // Sans rien : on l'avoue.
  assert.equal(raisonDe(null), 'sans');
  assert.equal(raisonDe('—'), 'sans');
  assert.equal(raisonDe('Le client a changé d’avis'), 'autre');
});

test('un produit n’est désigné que quand on le sait', () => {
  const base = { montant: 40, lignes: [], lignesCommande: [], totalCommande: null };
  // Les lignes remboursées d'abord.
  assert.deepEqual(articlesDe({ ...base, lignes: [ligne('Basket Lune', 89, '40')] }).map((a) => [a.titre, a.variante, a.montant]), [
    ['Basket Lune', '40', 89],
  ]);
  // Puis le dossier de retour.
  assert.equal(articlesDe(base, { productTitle: 'Derby Arlo', variantTitle: '42' })[0]!.titre, 'Derby Arlo');
  // Une commande d'un seul article.
  assert.equal(articlesDe({ ...base, lignesCommande: [ligne('Sneaker Vela', 79)] })[0]!.montant, 40);
  // Une commande entière remboursée : tous ses articles, au prorata.
  const entiere = articlesDe({ montant: 100, lignes: [], lignesCommande: [ligne('A', 75), ligne('B', 25)], totalCommande: 100 });
  assert.deepEqual(entiere.map((a) => [a.titre, a.montant]), [['A', 75], ['B', 25]]);
  // Le prix exact d'un article.
  assert.equal(articlesDe({ montant: 25, lignes: [], lignesCommande: [ligne('A', 75), ligne('B', 25)], totalCommande: 100 })[0]!.titre, 'B');
  // Un partiel sans indice : personne.
  assert.deepEqual(articlesDe({ montant: 30, lignes: [], lignesCommande: [ligne('A', 75), ligne('B', 25)], totalCommande: 100 }), []);
});

const maintenant = new Date('2026-10-16T12:00:00Z');
const ilYa = (jours: number) => new Date(maintenant.getTime() - jours * 86_400_000);

function shopify(id: string, jours: number, montant: number, note: string | null, lignes = [ligne('Basket Lune', montant, 'Blanc · 40')]): RemboursementDetaille {
  return {
    id,
    shopifyOrderId: `gid://shopify/Order/${id}`,
    orderName: `#${id}`,
    orderTotal: montant,
    createdAt: ilYa(jours).toISOString(),
    amount: montant,
    currency: 'EUR',
    note,
    lignes,
    lignesCommande: lignes,
  };
}

const entrees = (extra: Partial<EntreesStats> = {}): EntreesStats => ({
  maintenant,
  jours: 30,
  outil: [],
  shopify: [],
  partiel: false,
  retours: [],
  demandes: [],
  chiffreAffaires: 10_000,
  ...extra,
});

test('un remboursement compte une fois, et seulement s’il est parti', () => {
  const stats = calculerStats(
    entrees({
      outil: [
        // Fait depuis l'outil, retrouvé chez Shopify : son motif, les articles de Shopify.
        { id: 'r1', shopifyOrderId: 'gid://shopify/Order/1', shopifyRefundId: '1', amount: 50, currency: 'EUR', reason: 'Colis perdu par le transporteur', status: 'COMPLETED', createdAt: ilYa(3) },
        // En échec : aucun argent n'est parti.
        { id: 'r2', shopifyOrderId: 'gid://shopify/Order/9', shopifyRefundId: null, amount: 80, currency: 'EUR', reason: 'Geste commercial', status: 'FAILED', createdAt: ilYa(3) },
      ],
      shopify: [shopify('1', 3, 50, 'Colis perdu par le transporteur'), shopify('2', 10, 30, null)],
    }),
  );
  assert.deepEqual(stats.total, { montant: 80, nombre: 2 });
  assert.deepEqual(
    stats.raisons.map((r) => [r.cle, r.nombre, r.montant]),
    [['perdu', 1, 50], ['sans', 1, 30]],
  );
  assert.equal(stats.part, 80 / 10_000);
  assert.equal(stats.moyenne, 40);
  // Le même produit, deux remboursements.
  assert.deepEqual(stats.produits.map((p) => [p.titre, p.nombre, p.montant, p.variante]), [['Basket Lune', 2, 80, 'Blanc · 40']]);
});

test('la période précédente, les demandes et la série', () => {
  const stats = calculerStats(
    entrees({
      shopify: [shopify('1', 5, 100, 'Geste commercial'), shopify('2', 40, 50, 'Geste commercial')],
      demandes: [
        { shopifyOrderId: 'gid://shopify/Order/1', rembourse: false },
        { shopifyOrderId: null, rembourse: true },
        { shopifyOrderId: 'gid://shopify/Order/77', rembourse: false },
      ],
    }),
  );
  assert.deepEqual(stats.total, { montant: 100, nombre: 1 });
  assert.deepEqual(stats.precedent, { montant: 50, nombre: 1 });
  assert.equal(stats.evolution, 1);
  // Remboursée : liée au remboursement, ou sa commande l'a été.
  assert.deepEqual(stats.demandes, { recues: 3, remboursees: 2 });
  // Par semaine jusqu'à trois mois, par mois au-delà.
  assert.equal(stats.serie.pas, 'semaine');
  assert.equal(stats.serie.points.reduce((s, p) => s + p.montant, 0), 100);
  assert.equal(calculerStats(entrees({ jours: 365 })).serie.pas, 'mois');
  // Sans chiffre d'affaires, pas de part.
  assert.equal(calculerStats(entrees({ chiffreAffaires: null, shopify: [shopify('1', 5, 100, null)] })).part, null);
});

test('Shopify muet : on compte ce que l’outil sait, et on le dit', () => {
  const stats = calculerStats(
    entrees({
      shopify: null,
      outil: [{ id: 'r1', shopifyOrderId: 'gid://shopify/Order/1', shopifyRefundId: 's1', amount: 20, currency: 'EUR', reason: 'Geste commercial', status: 'COMPLETED', createdAt: ilYa(2) }],
    }),
  );
  assert.deepEqual(stats.total, { montant: 20, nombre: 1 });
  assert.equal(stats.sources.shopify, false);
  assert.deepEqual(stats.nonAttribues, { nombre: 1, montant: 20 });
});

test('l’écran : deux vues, quatre périodes, et le serveur ne compte ni test ni échec', () => {
  const html = lire('public/dashboard.html');
  const vue = html.slice(html.indexOf('id="view-refunds"'), html.indexOf('id="view-disputes"'));
  assert.match(vue, /data-vue="stats" aria-selected="true">Statistiques</);
  assert.match(vue, /data-vue="liste" aria-selected="false">Liste</);
  assert.deepEqual([...vue.matchAll(/data-days="(\d+)"/g)].map((m) => m[1]), ['30', '90', '180', '365']);

  const service = lire('src/services/refunds/stats.ts');
  assert.match(service, /where: \{ merchantId, test: false, createdAt: \{ gte: depuisPrecedent \} \}/);
  assert.match(service, /if \(vus\.has\(r\.id\) \|\| r\.status !== 'COMPLETED'\) continue;/);

  const route = lire('src/routes/refunds.ts');
  assert.match(route, /app\.get\('\/api\/refunds\/stats'/);
  // Un remboursement fait vide le cache : il compte tout de suite.
  assert.match(route, /oublierStatsRemboursements\(merchantId\);\n\s+return reply\.send\(\{ id: record\.id/);

  const app = lire('public/app.js');
  assert.match(app, /refunds: \(\) => chargerVueRemboursements\(\),/);
  // La phrase ne met « Sans motif » en avant que s'il l'emporte vraiment.
  assert.match(app, /if \(partSans >= 0\.9\)/);
});
