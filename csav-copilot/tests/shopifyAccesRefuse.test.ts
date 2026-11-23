import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

/*
 * Shopify refuse la clé enregistrée (401).
 *
 * CE QUE CES TESTS PROTÈGENT. Sans clé valide, chaque écran échouait de son
 * côté — initiales à la place des photos, « Boutique Shopify indisponible »,
 * messages non traités par l'IA — sans que rien ne dise quoi faire. Le refus
 * est noté une fois, un bandeau demande de reconnecter, et la reconnexion
 * l'efface.
 */

const lire = (chemin: string) => readFileSync(fileURLToPath(new URL(chemin, import.meta.url)), 'utf8');

test('un 401 de Shopify est noté sur la connexion', () => {
  const client = lire('../src/services/shopify/client.ts');
  assert.match(client, /response\.status === 401 && !connection\.accesRefuseLe/);
  // Noté par l'alerte, qui pose la marque une seule fois et prévient l'équipe.
  assert.match(client, /void signalerPanneShopify\(merchantId\)/);
  assert.match(lire('../src/services/platform/alertesConnexion.ts'), /where: \{ merchantId, accesRefuseLe: null \},\s+data: \{ accesRefuseLe: deps\.maintenant\(\) \}/);
  assert.match(lire('../prisma/schema.prisma'), /accesRefuseLe  DateTime\?/);
});

test('la reconnexion efface le refus', () => {
  assert.match(lire('../src/routes/auth.shopify.ts'), /uninstalledAt: null,\n\s+accesRefuseLe: null,/);
});

test('le tableau de bord le dit et propose de reconnecter', () => {
  assert.match(lire('../src/routes/tickets.ts'), /accesRefuse: Boolean\(merchant\.shopify\?\.accesRefuseLe/);
  const html = lire('../public/dashboard.html');
  assert.match(html, /id="shopify-refus-notice" hidden/);
  assert.match(html, /Reconnecter Shopify/);
  assert.match(lire('../public/app.js'), /refus\.hidden = demo \|\| !me\.shopify\?\.accesRefuse;/);
});
