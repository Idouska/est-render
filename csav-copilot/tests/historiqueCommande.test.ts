import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
// @ts-expect-error — module navigateur sans déclaration de types.
import { LANGS, STRINGS } from '../public/workspace.i18n.js';
import { chronologie } from '../src/services/suppliers/historique.ts';

/*
 * L'historique d'une commande, vu de l'atelier.
 *
 * CE QUE CES TESTS PROTÈGENT. Une seule chronologie, dans l'ordre où les
 * choses sont arrivées ; une réponse n'apparaît qu'une fois donnée ; et
 * l'atelier ne lit que ce qui le regarde — ses commandes, ses demandes.
 */

const lire = (chemin: string) =>
  readFileSync(fileURLToPath(new URL(`../${chemin}`, import.meta.url)), 'utf8');
const t = (iso: string) => new Date(iso);

test('tout, à la suite, le plus ancien d’abord', () => {
  const evenements = chronologie({
    lots: [{ envoyeLe: t('2026-10-01T07:00:00Z') }],
    demandes: [
      {
        kind: 'SIZE',
        beforeValue: '44',
        afterValue: '45',
        message: '',
        status: 'REFUSED',
        supplierNote: 'Déjà cousue',
        createdAt: t('2026-10-01T09:00:00Z'),
        acknowledgedAt: t('2026-10-01T11:00:00Z'),
      },
      // En attente : pas de réponse inventée.
      { kind: 'TRACKING', beforeValue: 'LP1', afterValue: null, message: '', status: 'PENDING', supplierNote: null, createdAt: t('2026-10-02T09:00:00Z'), acknowledgedAt: null },
    ],
    remplacements: [
      { productTitle: 'Lampe', variantTitle: '45', accepte: true, createdAt: t('2026-10-01T12:00:10Z'), reponduLe: t('2026-10-01T13:00:00Z') },
      { productTitle: 'Lampe', variantTitle: '46', accepte: null, createdAt: t('2026-10-01T12:00:40Z'), reponduLe: null },
    ],
    signalements: [{ subject: 'Téléphone incomplet', createdAt: t('2026-10-01T08:00:00Z') }],
    colis: [{ trackingNumber: 'LP9', index: 1, total: 1, carrier: 'Colissimo', createdAt: t('2026-10-03T10:00:00Z') }],
  });
  assert.deepEqual(
    evenements.map((e) => e.type),
    ['LOT', 'SIGNALEMENT', 'DEMANDE', 'REPONSE', 'REMPLACEMENT', 'REMPLACEMENT_REPONSE', 'DEMANDE', 'COLIS'],
  );
  const reponse = evenements.find((e) => e.type === 'REPONSE');
  assert.deepEqual(reponse, { type: 'REPONSE', date: t('2026-10-01T11:00:00Z'), kind: 'SIZE', accepte: false, note: 'Déjà cousue' });
  // Deux modèles proposés d'un même geste : une seule proposition.
  assert.equal(evenements.filter((e) => e.type === 'REMPLACEMENT').length, 1);
  assert.deepEqual(evenements.find((e) => e.type === 'REMPLACEMENT'), { type: 'REMPLACEMENT', date: t('2026-10-01T12:00:00Z'), combien: 2 });
});

test('l’atelier ne lit que ce qui le regarde', () => {
  const routes = lire('src/routes/supplierWorkspace.ts');
  const route = routes.slice(routes.indexOf("'/api/workspace/:id/historique'"), routes.indexOf("'/api/workspace/:id/signalements'"));
  // Même règle d'accès que la liste des commandes.
  assert.match(route, /const autorisees = await allowedOrderIds\(workspace\);\s*if \(autorisees && !autorisees\.includes\(commande\)\)/);
  // Ses lots, ses demandes, ses remplacements, ses signalements.
  assert.match(route, /envoi: \{ supplierId: workspace\.supplierId \}/);
  assert.equal(route.split('supplierId: workspace.supplierId,').length - 1, 2);
  assert.match(route, /startsWith: `supplier:\$\{workspace\.supplierId\}:`/);
});

test('l’historique se lit dans les trois langues, ouvert à la demande', () => {
  const js = lire('public/workspace.js');
  assert.match(js, /<details class="ord-hist" data-hist="\$\{esc\(order\.id\)\}"/);
  assert.match(js, /if \(event\.currentTarget\.open\) void chargerHistorique\(event\.currentTarget\);/);
  const appelees = new Set([...js.matchAll(/\bt\('(hist\.[\w.]+)'/g)].map((m) => m[1]!));
  for (const cle of ['hist.confirmed', 'hist.refused', 'hist.substYes', 'hist.substNo', 'hist.non_confiee']) appelees.add(cle);
  assert.ok(appelees.size >= 12);
  for (const { code } of LANGS as Array<{ code: string }>) {
    const table = (STRINGS as Record<string, Record<string, string>>)[code]!;
    assert.deepEqual([...appelees].filter((cle) => typeof table[cle] !== 'string'), [], `${code} : une clé absente`);
  }
});
