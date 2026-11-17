import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { bandeauLogistique, medianeJours } from '../src/services/shopify/delaisLogistique.ts';
import { createMockShopifyClient } from '../src/services/shopify/mock.ts';

/*
 * La Vue d'ensemble : une boutique, et la bande logistique en tête.
 * La sidebar : Admin, puis Pilotage (Boîte de réception, Modification,
 * Update, Out of stock).
 */

const lire = (chemin: string) => readFileSync(fileURLToPath(new URL(`../${chemin}`, import.meta.url)), 'utf8');
const JOUR = 86_400_000;

test('la médiane se lit en jours, au dixième', () => {
  assert.equal(medianeJours([]), null);
  assert.equal(medianeJours([2 * JOUR, 4 * JOUR, 30 * JOUR]), 4);
  assert.equal(medianeJours([2 * JOUR, 3 * JOUR]), 2.5);
  // Une durée négative (horloge, saisie) ne compte pas.
  assert.equal(medianeJours([-JOUR, 6 * JOUR]), 6);
});

test('la bande compte les non-expédiées et mesure les deux délais', async () => {
  const bande = await bandeauLogistique(createMockShopifyClient('demo.myshopify.com'));
  assert.equal(bande.retardJours, 7);
  assert.ok(bande.nonExpediees.total >= bande.nonExpediees.enRetard);
  assert.ok(bande.expedition.jours !== null && bande.expedition.jours >= 2 && bande.expedition.jours <= 7);
  assert.ok(bande.livraison.jours !== null && bande.livraison.jours > bande.expedition.jours);
  assert.ok(bande.livraison.n > 0);
});

test('la sidebar suit la nouvelle organisation', () => {
  const app = lire('public/app.js');
  assert.match(app, /const NAV_GROUPS = \['Admin', 'Pilotage'/);
  assert.match(app, /NAV_ORDRE = \['overview', 'suppliers', 'couts', 'stats', 'tickets', 'changes', 'update', 'ruptures'\]/);
  assert.match(app, /tickets: \{ icon: 'inbox', label: 'Boîte de réception', group: 'Pilotage'/);
  assert.match(app, /label: 'Update', group: 'Pilotage'/);
  assert.match(app, /label: 'Out of stock',\s*group: 'Pilotage'/);
  assert.doesNotMatch(app, /label: 'SAV client'/);
});

test('la vue d’ensemble ne montre plus une carte par boutique', () => {
  const html = lire('public/dashboard.html');
  assert.doesNotMatch(html, /id="ov-shops"/);
  assert.match(html, /id="ov-bandeau"/);
  assert.match(lire('public/app.js'), /api\('\/api\/overview\/logistique'\)/);
});
