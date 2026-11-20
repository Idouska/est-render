import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

/* Suivi colis : une barre qui compte et filtre, comme celle du Stock. */
const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const bloc = app.slice(app.indexOf('const GROUPES_SUIVI = ['), app.indexOf('function renderBarreSuivi('));
const groupeSuivi = new Function(`${bloc}; return groupeSuivi;`)() as (s: { liveStatus?: string | null }) => string;

test('chaque état du transporteur tombe dans une seule famille', () => {
  assert.equal(groupeSuivi({ liveStatus: 'InTransit' }), 'transit');
  assert.equal(groupeSuivi({ liveStatus: 'InfoReceived' }), 'transit');
  assert.equal(groupeSuivi({ liveStatus: 'OutForDelivery' }), 'transit');
  assert.equal(groupeSuivi({ liveStatus: 'AvailableForPickup' }), 'retirer');
  assert.equal(groupeSuivi({ liveStatus: 'Delivered' }), 'livre');
  for (const etat of ['Exception', 'DeliveryFailure', 'NotFound', 'Expired']) assert.equal(groupeSuivi({ liveStatus: etat }), 'bloque');
  assert.equal(groupeSuivi({ liveStatus: null }), 'muet');
  assert.equal(groupeSuivi({}), 'muet');
});

test('la barre filtre les lignes sans recharger', () => {
  assert.match(app, /<tr data-etat="\$\{groupeSuivi\(shipment\)\}"/);
  assert.match(app, /ligne\.hidden = filtre !== 'tout' && ligne\.dataset\.etat !== filtre;/);
  assert.match(readFileSync(new URL('../public/dashboard.html', import.meta.url), 'utf8'), /id="tracking-barre"/);
});
