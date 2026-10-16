import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { ORDER_SEGMENTS } from '../src/routes/commerce.ts';
import { countOrders } from '../src/services/shopify/orders.ts';
import type { ShopifyClient } from '../src/services/shopify/client.ts';

/*
 * L'écran Commandes, façon Finder et Contacts.
 *
 * CE QUE CES TESTS PROTÈGENT. Douze colonnes, trois menus déroulants et une
 * fiche qui recouvrait la liste : il fallait la fermer pour passer à la
 * commande suivante. Désormais des onglets avec leur compte, six colonnes,
 * la fiche à côté — et la même fiche partout. Les onglets ne promettent que
 * ce que Shopify sait filtrer : l'expédition, pas l'état du colis.
 */

const lire = (chemin: string) =>
  readFileSync(fileURLToPath(new URL(`../${chemin}`, import.meta.url)), 'utf8');

const app = lire('public/app.js');
const css = lire('public/styles.css');
const dashboard = lire('public/dashboard.html');
const vue = dashboard.slice(dashboard.indexOf('<section class="browse cmd" id="view-orders"'), dashboard.indexOf('id="view-customers"'));

const corps = (signature: string) => {
  const debut = app.indexOf(signature);
  assert.ok(debut >= 0, `${signature} introuvable`);
  return app.slice(debut, app.indexOf('\n}\n', debut) + 2);
};

test('les onglets ne filtrent que ce que Shopify sait filtrer', () => {
  assert.deepEqual(Object.keys(ORDER_SEGMENTS), ['toutes', 'aExpedier', 'expediees', 'remboursees']);
  // Une commande expédiée en partie reste à expédier : il manque un colis.
  assert.equal(ORDER_SEGMENTS.aExpedier, '(fulfillment_status:unfulfilled OR fulfillment_status:partial)');
  assert.equal(ORDER_SEGMENTS.expediees, 'fulfillment_status:shipped');
  assert.equal(ORDER_SEGMENTS.remboursees, '(financial_status:refunded OR financial_status:partially_refunded)');
  for (const filtre of Object.values(ORDER_SEGMENTS)) {
    assert.doesNotMatch(filtre, /in_transit|delivered/, 'Shopify ne filtre pas sur l’état du colis');
  }
  assert.deepEqual(
    [...vue.matchAll(/data-vue="(\w+)"/g)].map((m) => m[1]),
    Object.keys(ORDER_SEGMENTS),
    'les onglets de l’écran sont ceux du serveur',
  );
});

test('les comptes des onglets partent en un seul appel, et disent « au moins »', async () => {
  const appels: Array<{ query: string; variables: Record<string, unknown> }> = [];
  const client = {
    shopDomain: 'test.myshopify.com',
    async request<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
      appels.push({ query, variables: variables ?? {} });
      return { toutes: { count: 10000, precision: 'AT_LEAST' }, aExpedier: { count: 37, precision: 'EXACT' } } as T;
    },
  } as ShopifyClient;

  const counts = await countOrders(client, { toutes: '', aExpedier: 'fulfillment_status:unfulfilled' });
  assert.equal(appels.length, 1);
  assert.match(appels[0]!.query, /toutes: ordersCount\(query: \$toutes\)/);
  assert.match(appels[0]!.query, /aExpedier: ordersCount\(query: \$aExpedier\)/);
  // Sans filtre : null, pas une chaîne vide.
  assert.equal(appels[0]!.variables.toutes, null);
  assert.deepEqual(counts, { toutes: { count: 10000, auMoins: true }, aExpedier: { count: 37, auMoins: false } });
  // Une clé qui ne serait pas un nom GraphQL n'entre pas dans la requête.
  assert.deepEqual(await countOrders(client, { 'a b': 'x' }), {});
});

test('le serveur sert les comptes, et les onglets survivent à un refus', () => {
  const route = lire('src/routes/commerce.ts');
  const comptes = route.slice(route.indexOf("app.get('/api/orders/counts'"), route.indexOf("'/api/orders/:id'"));
  assert.match(comptes, /countOrders\(client, queries\)/);
  assert.match(comptes, /return reply\.send\(\{ counts: null \}\);/);
  assert.match(route, /input\.vue \? ORDER_SEGMENTS\[input\.vue\] : ''/);
});

test('la barre : des onglets, une recherche, « Exporter » en menu — plus de menus déroulants', () => {
  assert.doesNotMatch(vue, /<select/);
  assert.match(vue, /id="orders-exporter"[^>]*aria-haspopup="menu"/);
  const menu = vue.slice(vue.indexOf('id="orders-export-menu"'));
  assert.match(menu, /id="orders-xlsx" download>Feuille Excel</);
  assert.match(menu, /id="orders-export" download>Fichier CSV</);
  // On trie sur l'en-tête, comme dans le Finder.
  assert.match(vue, /class="cmd-tri" type="button" role="columnheader" data-tri="date" aria-sort="descending"/);
  assert.match(corps('function rendreTriCommandes('), /aria-sort/);
});

test('six colonnes, et un point de couleur avec un mot', () => {
  const entetes = vue.slice(vue.indexOf('class="cmd-tete"'), vue.indexOf('id="orders-rows"'));
  assert.equal((entetes.match(/role="columnheader"/g) ?? []).length, 6);

  const etatExpedition = new Function(`${corps('function etatExpedition(')} return etatExpedition;`)();
  const expe = (ful: string | null, colis?: string) =>
    etatExpedition({ displayFulfillmentStatus: ful, fulfillments: colis ? [{ displayStatus: colis }] : [] });
  assert.deepEqual(expe('UNFULFILLED'), { label: 'À expédier', ton: 'warn', etape: 1 });
  assert.equal(expe('PARTIALLY_FULFILLED').label, 'Expédiée en partie');
  assert.deepEqual(expe('FULFILLED', 'IN_TRANSIT'), { label: 'En transit', ton: 'info', etape: 2 });
  assert.deepEqual(expe('FULFILLED', 'DELIVERED'), { label: 'Livrée', ton: 'ok', etape: 3 });
  assert.equal(expe('FULFILLED', 'FAILURE').ton, 'crit');
  // Expédiée sans état chez le transporteur : on n'invente pas « livrée ».
  assert.equal(expe('FULFILLED').label, 'Expédiée');

  // Au téléphone, un paiement qui attend passe avant l'expédition.
  assert.match(app, /PENDING: \['En attente', 'warn', 'À payer'\]/);
  assert.match(corps('function ligneCommande('), /const resume = paie\.resume \? \{ label: paie\.resume, ton: paie\.ton \} : expe;/);
});

test('la fiche s’ouvre à côté de la liste, et la même fiche sert partout', () => {
  assert.match(app, /if \(ligne\) void ouvrirCommande\(ligne\.dataset\.order\);/);
  assert.match(corps('async function ouvrirCommande('), /corps\.innerHTML = ficheCommandeMarkup\(data\);/);
  // Une réponse lente ne remplace pas la commande choisie depuis.
  assert.match(corps('async function ouvrirCommande('), /if \(seq !== store\.seqFiche\) return;/);
  assert.match(corps('async function openOrderSheet('), /ficheCommandeMarkup\(data, \{ titre: false \}\)/);

  const fiche = corps('function ficheCommandeMarkup(');
  for (const geste of ['Fournisseur', 'Suivre', 'WhatsApp', 'Shopify']) {
    assert.match(fiche, new RegExp(`<span>${geste}</span>`), geste);
  }
  assert.match(fiche, /\$\{suiviCommandeMarkup\(order\)\}/);
  assert.match(corps('function suiviCommandeMarkup('), /\['Payée', 'Préparée', 'Expédiée', 'Livrée'\]/);
});

test('au téléphone, la fiche se pousse par-dessus la liste et revient', () => {
  assert.match(corps('function ouvrirFichePile('), /history\.pushState\(\{ csavCommande: true \}, ''\);/);
  assert.match(corps('function fermerFichePile('), /if \(!parHistorique && history\.state\?\.csavCommande\) history\.back\(\);/);
  assert.match(app, /addEventListener\('popstate', \(\) => fermerFichePile\(\{ parHistorique: true \}\)\);/);
  assert.match(app, /if \(view !== 'orders'\) fermerFichePile\(\);/);
  assert.match(css, /#view-orders\.cmd:not\(\.pile-fiche\) > \.cmd-fiche \{ display: none; \}/);
  assert.match(css, /#view-orders\.cmd\.pile-fiche > \.cmd-liste \{ display: none; \}/);
  // Trop étroite pour six colonnes, la liste passe en lignes de Mail — et
  // garde de quoi trier.
  const compacte = css.slice(css.indexOf('@container cmdliste (max-width: 680px)'));
  assert.match(compacte, /\.cmd-tete::before \{ content: "Trier par";/);
});
