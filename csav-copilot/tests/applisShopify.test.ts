import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

/*
 * Une appli Shopify par boutique.
 *
 * CE QUE CES TESTS PROTÈGENT. Une appli en distribution personnalisée ne
 * s'installe que sur une boutique : chacune peut avoir la sienne. Tout ce qui
 * parle au nom d'une boutique — installation, signature du retour OAuth,
 * échange du jeton, webhooks — doit utiliser la MÊME appli, sinon la boutique
 * s'installe puis se fait refuser. Sans appli propre, rien ne change : celle
 * de la plateforme sert, comme avant. Et le secret ne ressort jamais.
 */

const lire = (chemin: string) =>
  readFileSync(fileURLToPath(new URL(`../${chemin}`, import.meta.url)), 'utf8');
const sansCommentaires = (code: string) =>
  code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/[^\n]*/gm, '');

const auth = sansCommentaires(lire('src/routes/auth.shopify.ts'));
const service = lire('src/services/shopify/applis.ts');

test('l’installation, la signature et le jeton passent par l’appli de la boutique', () => {
  assert.doesNotMatch(auth, /requireCredential\('SHOPIFY_API_(KEY|SECRET)'/, 'plus d’appli unique en dur');
  assert.match(auth, /\(\{ clientId \} = await appliPourBoutique\(shop\)\);/);
  // Sans aucune appli pour la boutique : un message qui dit quoi faire, pas une 500.
  assert.match(auth, /if \(!\(error instanceof MissingCredentialError\)\) throw error;/);
  assert.match(auth, /const appli = await appliPourBoutique\(shop\);\s*if \(!\(await verifyShopifyHmac\(request\.query, appli\.clientSecret\)\)\)/);
  assert.match(auth, /client_id: appli\.clientId,\s*client_secret: appli\.clientSecret,/);
});

test('sans appli propre, celle de la plateforme — comme avant', () => {
  const repli = service.slice(service.indexOf('export async function appliPourBoutique'));
  assert.match(repli, /if \(propre\) return propre;/);
  assert.match(repli, /requireCredential\('SHOPIFY_API_KEY'/);
  assert.match(repli, /source: 'plateforme'/);
});

test('un webhook est accepté s’il est signé par l’une de NOS applis, et seulement alors', () => {
  const webhook = sansCommentaires(lire('src/routes/webhooks.gmail.ts'));
  const route = webhook.slice(webhook.indexOf("'/webhooks/shopify/app-uninstalled'"));
  assert.match(route, /const secrets = await secretsPourWebhook\(/);
  assert.match(route, /!secrets\.some\(\(secret\) => safeEqual\(signature, hmacSha256Base64\(secret, request\.rawBody!\)\)\)/);
  // Aucun secret configuré : la liste est vide, et `some` refuse.
  assert.match(service, /const secrets: string\[\] = \[\];/);
});

test('la console écrit le secret chiffré et ne le relit jamais', () => {
  const admin = lire('src/routes/admin.ts');
  const liste = admin.slice(admin.indexOf("'/api/admin/applis-shopify', { preHandler"), admin.indexOf("app.put('/api/admin/applis-shopify'"));
  assert.doesNotMatch(liste, /clientSecret/);
  const ecriture = admin.slice(admin.indexOf("app.put('/api/admin/applis-shopify'"));
  assert.match(ecriture, /clientSecretEnc: encryptSecret\(parsed\.data\.clientSecret\.trim\(\)\)/);
  assert.match(ecriture, /if \(!estDomaineShopify\(shopDomain\)\)/);
  // Toutes les routes derrière la session d'administration.
  assert.equal((admin.match(/'\/api\/admin\/applis-shopify(\/:id)?',\s*\{ preHandler: requireAdmin \}/g) ?? []).length, 3);
  assert.match(lire('prisma/schema.prisma'), /model ShopifyApp \{[\s\S]*shopDomain\s+String\s+@unique[\s\S]*clientSecretEnc String/);
});

test('seuls les domaines myshopify.com sont acceptés', async () => {
  process.env.ENCRYPTION_KEY ??= Buffer.alloc(32, 1).toString('base64');
  process.env.APP_URL ??= 'https://example.test';
  process.env.DATABASE_URL ??= 'postgresql://u:p@localhost:5432/db';
  process.env.REDIS_URL ??= 'redis://localhost:6379';
  process.env.SHOPIFY_SCOPES ??= 'read_orders';
  process.env.GOOGLE_SCOPES ??= 'https://www.googleapis.com/auth/gmail.readonly';
  const { estDomaineShopify, normaliserBoutique } = await import('../src/services/shopify/applis.ts');
  assert.equal(estDomaineShopify('ma-boutique.myshopify.com'), true);
  for (const faux of ['ma-boutique.com', 'evil.com/x.myshopify.com', '-x.myshopify.com', 'x.myshopify.com.evil.com']) {
    assert.equal(estDomaineShopify(faux), false, faux);
  }
  assert.equal(normaliserBoutique('  Ma-Boutique.MyShopify.com '), 'ma-boutique.myshopify.com');
});
