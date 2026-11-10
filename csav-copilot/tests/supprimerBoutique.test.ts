import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

/*
 * Retirer une boîte mail ou une boutique, depuis la console admin.
 *
 * CE QUE CES TESTS PROTÈGENT. Débrancher une boîte doit couper l'accès chez
 * Google (watch, jeton) AVANT d'effacer quoi que ce soit chez nous, qu'on
 * parte des Réglages du marchand ou de la console admin — les deux passent
 * par le même service, pour ne jamais diverger. Supprimer une boutique est
 * irréversible : la confirmation ne doit pas tenir qu'à un clic de
 * `confirm()` côté écran, le serveur revérifie le domaine saisi. Et la
 * boutique de démonstration garde son propre circuit (créer/réinitialiser),
 * jamais ce bouton-ci.
 */

const lire = (chemin: string) =>
  readFileSync(fileURLToPath(new URL(`../${chemin}`, import.meta.url)), 'utf8');
const sansCommentaires = (code: string) =>
  code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/[^\n]*/gm, '');

const disconnect = lire('src/services/gmail/disconnect.ts');
const supprimer = lire('src/services/merchant/supprimer.ts');
const admin = sansCommentaires(lire('src/routes/admin.ts'));
const settings = sansCommentaires(lire('src/routes/settings.ts'));
const adminJs = lire('public/admin.js');

test('couper l’accès Google est tenté en entier, jamais bloquant', () => {
  const fn = disconnect.slice(disconnect.indexOf('export async function couperAccesGoogle'));
  assert.match(fn, /await stopWatch\(merchantId, mailbox\.id\);/);
  assert.match(fn, /auth\.revokeToken\(decryptSecret\(mailbox\.refreshTokenEnc\)\);/);
  // Deux `try` séparés : un watch qui refuse de s'arrêter ne doit pas empêcher
  // la révocation du jeton, et réciproquement.
  assert.equal((fn.match(/\btry\s*\{/g) ?? []).length, 2);
});

test('débrancher une boîte efface son courrier et réassigne la boîte par défaut', () => {
  const fn = disconnect.slice(disconnect.indexOf('export async function debrancherBoite'));
  assert.match(fn, /if \(!mailbox\) return null;/);
  assert.match(fn, /await couperAccesGoogle\(merchantId, mailbox\);/);
  assert.match(fn, /prisma\.ticket\.deleteMany\(\{ where: \{ merchantId, mailboxId: mailbox\.id \} \}\)/);
  assert.match(fn, /prisma\.gmailConnection\.delete\(\{ where: \{ id: mailbox\.id \} \}\)/);
  assert.match(fn, /isDefault: true/);
  assert.match(fn, /autoSendEnabled: false/);
});

test('les Réglages du marchand et la console admin débranchent par le même service', () => {
  assert.match(settings, /import \{ debrancherBoite \} from "\.\.\/services\/gmail\/disconnect\.ts";/);
  assert.match(settings, /const resultat = await debrancherBoite\(merchantId, request\.params\.id\);/);
  assert.doesNotMatch(settings, /await stopWatch\(/, 'plus de logique dupliquée dans les Réglages');

  assert.match(admin, /import \{ debrancherBoite \} from '\.\.\/services\/gmail\/disconnect\.ts';/);
  assert.match(
    admin,
    /app\.delete<\{ Params: \{ id: string; mailboxId: string \} \}>\(\s*'\/api\/admin\/marchands\/:id\/mailboxes\/:mailboxId',\s*\{ preHandler: requireAdmin \}/,
  );
  assert.match(admin, /const resultat = await debrancherBoite\(request\.params\.id, request\.params\.mailboxId\);/);
});

test('supprimer une boutique coupe Google avant d’effacer, et journalise hors base', () => {
  const fn = supprimer.slice(supprimer.indexOf('export async function supprimerMarchand'));
  assert.match(fn, /if \(!merchant\) return null;/);
  assert.match(fn, /for \(const mailbox of merchant\.mailboxes\) \{\s*await couperAccesGoogle\(merchantId, mailbox\);/);
  // Google coupé avant la suppression, pas après : un ordre inversé laisserait
  // un jeton vivant que plus rien dans l'outil ne sait couper.
  assert.ok(fn.indexOf('couperAccesGoogle') < fn.indexOf('prisma.merchant.delete'));
  assert.match(fn, /prisma\.merchant\.delete\(\{ where: \{ id: merchantId \} \}\)/);
  assert.match(fn, /logger\.warn\(/);
});

test('la route de suppression revérifie le domaine côté serveur', () => {
  const fn = admin.slice(
    admin.indexOf("app.delete<{ Params: { id: string } }>(\n    '/api/admin/marchands/:id',"),
  );
  assert.match(fn, /z\.object\(\{ shopDomain: z\.string\(\)\.min\(1\) \}\)/);
  assert.match(fn, /parsed\.data\.shopDomain\.trim\(\)\.toLowerCase\(\) !== marchand\.shopDomain\.toLowerCase\(\)/);
  assert.match(fn, /return reply\.code\(400\)\.send\(\{ error: 'Le domaine saisi ne correspond pas à cette boutique' \}\);/);
  assert.match(fn, /await supprimerMarchand\(request\.params\.id\);/);
});

test('la liste des boutiques porte le drapeau démo et les boîtes mail', () => {
  const fn = admin.slice(admin.indexOf("app.get('/api/admin/marchands'"), admin.indexOf("app.patch<{ Params: { id: string } }>"));
  assert.match(fn, /demo: true,/);
  assert.match(fn, /mailboxes: \{/);
});

test('l’écran demande de taper le domaine pour supprimer, et débranche d’un clic', () => {
  assert.match(adminJs, /async function supprimerMarchand\(idMarchand\)/);
  assert.match(adminJs, /const saisie = prompt\(/);
  assert.match(adminJs, /if \(saisie\.trim\(\)\.toLowerCase\(\) !== marchand\.shopDomain\.toLowerCase\(\)\)/);
  assert.match(adminJs, /method: 'DELETE',\s*body: JSON\.stringify\(\{ shopDomain: saisie\.trim\(\) \}\)/);

  assert.match(adminJs, /async function retirerBoiteMarchand\(idMarchand, idBoite\)/);
  assert.match(adminJs, /\/api\/admin\/marchands\/\$\{encodeURIComponent\(idMarchand\)\}\/mailboxes\/\$\{encodeURIComponent\(idBoite\)\}/);
});

test('la boutique de démo n’a pas de bouton Supprimer dans ce tableau', () => {
  const rendu = adminJs.slice(adminJs.indexOf('function renderFonctionnalites'));
  assert.match(rendu, /m\.demo\s*\n\s*\?\s*''/);
  assert.match(rendu, /data-marchand-suppr="\$\{esc\(m\.id\)\}"/);
});
