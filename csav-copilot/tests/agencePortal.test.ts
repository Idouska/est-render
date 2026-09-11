import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { LANGS, STRINGS } from '../public/agence.i18n.js';

/*
 * Le portail des agences de retours.
 *
 * CE QUE CES TESTS PROTÈGENT. Le lien d'une agence tient lieu de compte :
 * s'il ouvrait autre chose que SON stock, une agence verrait les commandes
 * des autres. Et c'est elle qui déclenche l'expédition Shopify, donc l'e-mail
 * au client : un numéro enregistré sans expédition laisse un client sans
 * nouvelle, un numéro corrigé sans confirmation lui en envoie un second.
 */

process.env.ENCRYPTION_KEY ??= randomBytes(32).toString('base64');
process.env.APP_URL ??= 'https://example.test';
process.env.DATABASE_URL ??= 'postgresql://u:p@localhost:5432/db';
process.env.REDIS_URL ??= 'redis://localhost:6379';
process.env.SHOPIFY_API_KEY ??= 'key';
process.env.SHOPIFY_API_SECRET ??= 'secret';
process.env.SHOPIFY_SCOPES ??= 'read_orders';
process.env.GOOGLE_CLIENT_ID ??= 'client';
process.env.GOOGLE_CLIENT_SECRET ??= 'secret';
process.env.GOOGLE_SCOPES ??= 'https://www.googleapis.com/auth/gmail.readonly';
process.env.GOOGLE_PUBSUB_TOPIC ??= 'projects/p/topics/t';
process.env.GOOGLE_PUBSUB_SERVICE_ACCOUNT ??= 'sa@p.iam.gserviceaccount.com';

const { signAgencyToken, verifyAgencyToken } = await import('../src/lib/agencyToken.ts');
const { signSupplierWorkspaceToken } = await import('../src/lib/supplierToken.ts');

const lire = (chemin: string) =>
  readFileSync(fileURLToPath(new URL(`../${chemin}`, import.meta.url)), 'utf8');
const sansCommentaires = (code: string) =>
  code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/[^\n]*/gm, '');

const portail = sansCommentaires(lire('src/routes/agencyPortal.ts'));

/* ---- le lien ---- */

test('le lien d’une agence se relit, et se révoque par sa version', () => {
  const jeton = signAgencyToken({ agencyId: 'ag1', merchantId: 'm1', version: 3 });
  assert.deepEqual(verifyAgencyToken(jeton), { agencyId: 'ag1', merchantId: 'm1', version: 3 });
  assert.equal(verifyAgencyToken(`${jeton}x`), null, 'une signature retouchée ne passe pas');
  assert.equal(verifyAgencyToken(''), null);
});

test('un lien d’atelier n’ouvre pas le portail d’une agence', () => {
  // Les deux sont signés par la même clé : c'est le préfixe de signature qui
  // les sépare. Sans lui, un fournisseur pourrait lire le stock d'une agence.
  const atelier = signSupplierWorkspaceToken({ supplierId: 'ag1', merchantId: 'm1', version: 1 });
  assert.equal(verifyAgencyToken(atelier), null);
});

test('la version est comparée : un lien renouvelé coupe l’ancien', () => {
  assert.match(portail, /agence\.portalTokenVersion !== payload\.version/);
  assert.match(portail, /code: 'lien_revoque'/);
});

/* ---- l'agence ne voit que son stock ---- */

test('chaque lecture et chaque écriture est bornée à l’agence du lien', () => {
  for (const [quoi, motif] of [
    ['les commandes à expédier', /agencyId: agence\.id,\s*reusedShopifyOrderId: \{ not: null \}/],
    ['la photo d’une paire', /where: \{ id: request\.params\.pairId, merchantId: agence\.merchantId, agencyId: agence\.id \}/],
    ['l’expédition', /where: \{ merchantId: agence\.merchantId, agencyId: agence\.id, reusedShopifyOrderId: parsed\.data\.orderId \}/],
  ] as const) {
    assert.match(portail, motif, quoi);
  }
  assert.match(portail, /code: 'introuvable'/);
});

/* ---- l'expédition ---- */

test('le numéro est enregistré, puis Shopify est prévenu', () => {
  const envoi = portail.slice(portail.indexOf('if (!dejaExpediee) {'));
  const enregistrement = envoi.indexOf('reshippedAt: new Date()');
  const expedition = envoi.indexOf('tenterExpedition(');
  assert.ok(enregistrement > 0 && expedition > 0);
  assert.ok(enregistrement < expedition, 'une panne Shopify ne doit pas perdre le numéro saisi');
});

test('un numéro abîmé par Excel est refusé avant tout enregistrement', () => {
  // Cadré sur la route d'expédition : la lecture des commandes, plus haut
  // dans le fichier, a sa propre recherche en base.
  const envoi = portail.slice(portail.lastIndexOf("'/api/agence/:id/expeditions',"));
  const refus = envoi.indexOf("code: 'abime_excel'");
  assert.ok(refus > 0, 'le refus doit exister');
  assert.ok(refus < envoi.indexOf('prisma.returnCase.findMany'), 'et précéder toute lecture ou écriture');
});

test('corriger un numéro déjà envoyé au client demande une confirmation', () => {
  const correction = portail.slice(portail.indexOf('if (dejaExpediee && ancien && ancien !== suivi)'));
  const garde = correction.indexOf('if (!parsed.data.prevenirClient) {');
  const envoiCorrige = correction.indexOf('corrigerSuivi(');
  const enregistrement = correction.indexOf('prisma.returnCase.updateMany');
  assert.ok(garde > 0, 'la confirmation doit être exigée');
  assert.ok(garde < envoiCorrige, 'rien ne part chez le client sans confirmation');
  assert.ok(envoiCorrige < enregistrement, 'Shopify d’abord : un refus ne laisse rien de changé');
});

test('une commande déjà expédiée par l’agence ne revient pas à l’atelier', () => {
  const retours = sansCommentaires(lire('src/routes/returns.ts'));
  const liberer = retours.slice(retours.indexOf("'/api/returns/reemploi/liberer',"));
  const garde = liberer.indexOf('reshippedAt: { not: null }');
  const liberation = liberer.indexOf('prisma.returnCase.updateMany');
  assert.ok(garde > 0, 'la vérification doit exister');
  assert.ok(garde < liberation, 'et précéder la libération');
  assert.match(liberer.slice(garde, garde + 400), /code: 'deja_expediee'/);
});

/* ---- la page ---- */

test('le portail parle les quatre langues des agences', () => {
  assert.deepEqual(LANGS.map((langue) => langue.code), ['fr', 'en', 'es', 'it']);

  const cles = Object.keys(STRINGS.fr);
  assert.ok(cles.length >= 30, 'le vocabulaire du portail manque');
  for (const { code } of LANGS) {
    const table = (STRINGS as Record<string, Record<string, string>>)[code]!;
    const manquantes = cles.filter((cle) => typeof table[cle] !== 'string');
    assert.deepEqual(manquantes, [], `${code} : une clé absente s’afficherait en français`);
  }
});

test('chaque clé appelée par la page existe', () => {
  const js = lire('public/agence.js');
  const html = lire('public/agence.html');
  const appelees = new Set([
    ...[...js.matchAll(/\bt\('((?:ag|test)\.[\w.]+)'/g)].map((m) => m[1]!),
    ...[...html.matchAll(/data-t="((?:ag|test)\.[\w.]+)"/g)].map((m) => m[1]!),
  ]);
  assert.ok(appelees.size >= 15);
  assert.deepEqual([...appelees].filter((cle) => !STRINGS.fr[cle]), []);
});

test('le lien de l’agence se copie et se renouvelle depuis l’écran du marchand', () => {
  const app = lire('public/app.js');
  assert.match(app, /data-agency-link=/);
  assert.match(app, /\/api\/return-agencies\/\$\{agencyId\}\/portal-link/);
  const retours = sansCommentaires(lire('src/routes/returns.ts'));
  const route = retours.slice(retours.indexOf("'/api/return-agencies/:id/portal-link'"));
  assert.match(route.slice(0, 200), /requirePermission\('configure'\)/);
  assert.match(route, /portalTokenVersion: \{ increment: 1 \}/);
});
