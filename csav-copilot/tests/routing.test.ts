import assert from 'node:assert/strict';
import test from 'node:test';
import { ordersForSupplier } from '../src/services/suppliers/routing.ts';

/*
 * L'affectation décide quel atelier voit quelle commande. Une erreur ici ne
 * lève aucune exception : elle fait disparaître une commande de tous les
 * ateliers, et personne ne l'expédie.
 */

function order(id: string, items: Array<{ vendor?: string; sku?: string }>) {
  return {
    id,
    lineItems: items.map((item) => ({
      title: 'article',
      quantity: 1,
      variantTitle: null,
      sku: item.sku ?? null,
      vendor: item.vendor ?? null,
      image: null,
    })),
  } as never;
}

const NIKE = { id: 'a', vendors: ['Nike'], skuPrefixes: [], isDefault: false };
const SKU = { id: 'b', vendors: [], skuPrefixes: ['AD-'], isDefault: false };
const CATCHALL = { id: 'c', vendors: [], skuPrefixes: [], isDefault: true };

test('la marque affecte la commande, quelle que soit la casse', () => {
  const orders = [order('1', [{ vendor: 'nike' }]), order('2', [{ vendor: 'Puma' }])];
  const kept = ordersForSupplier(orders, NIKE, [], []);
  assert.deepEqual(kept.map((o) => o.id), ['1']);
});

test('le préfixe de référence affecte la commande', () => {
  const orders = [order('1', [{ sku: 'AD-991' }]), order('2', [{ sku: 'NIK-1' }])];
  const kept = ordersForSupplier(orders, SKU, [], []);
  assert.deepEqual(kept.map((o) => o.id), ['1']);
});

test("l'atelier par défaut ne prend que ce qu'aucune règle ne réclame", () => {
  const orders = [order('1', [{ vendor: 'Nike' }]), order('2', [{ vendor: 'Inconnu' }])];
  const kept = ordersForSupplier(orders, CATCHALL, [NIKE, SKU], []);
  assert.deepEqual(kept.map((o) => o.id), ['2']);
});

test('une commande confiée à la main reste visible malgré les règles', () => {
  const orders = [order('1', [{ vendor: 'Puma' }])];
  const kept = ordersForSupplier(orders, NIKE, [], ['1']);
  assert.deepEqual(kept.map((o) => o.id), ['1']);
});

test('un fournisseur sans règle ni commande confiée ne voit rien', () => {
  const orders = [order('1', [{ vendor: 'Nike' }])];
  const kept = ordersForSupplier(orders, { id: 'z', vendors: [], skuPrefixes: [], isDefault: false }, [], []);
  assert.deepEqual(kept, []);
});
