import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { randomBytes } from 'node:crypto';

/*
 * L'agence : un Propriétaire automatique sur chaque boutique, sans jamais
 * être invitée.
 *
 * CE QUE CES TESTS PROTÈGENT. Un email de l'agence doit recevoir un compte
 * Propriétaire ACTIF sur chaque boutique — à sa connexion, ou d'un clic sur
 * « Appliquer aux boutiques existantes » — sans qu'un marchand n'ait jamais à
 * l'inviter. Ce compte ne doit JAMAIS pouvoir être rétrogradé ni désactivé
 * depuis l'équipe d'un marchand : sinon la promesse « au-dessus du
 * propriétaire » ne tient que jusqu'au premier clic d'un client. Toutes les
 * boutiques rejoignent le même groupe, pour que « Toutes les boutiques »
 * réunisse l'agence sans rien changer pour les marchands. Et la boutique de
 * démonstration reste à l'écart : ses données sont fictives, l'agence n'a
 * rien à y faire.
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

const lire = (chemin: string) =>
  readFileSync(fileURLToPath(new URL(`../${chemin}`, import.meta.url)), 'utf8');
const sansCommentaires = (code: string) =>
  code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/[^\n]*/gm, '');

const agence = lire('src/services/agence.ts');
const authShopify = sansCommentaires(lire('src/routes/auth.shopify.ts'));
const team = sansCommentaires(lire('src/routes/team.ts'));
const admin = sansCommentaires(lire('src/routes/admin.ts'));
const appJs = lire('public/app.js');
const adminJs = lire('public/admin.js');

test('provisionner pose toujours Propriétaire + actif, même sur un compte existant plus faible', () => {
  const fn = agence.slice(agence.indexOf('export async function provisionnerComptesAgence'));
  assert.match(fn, /prisma\.agenceAdmin\.findMany/);
  assert.match(fn, /create: \{ merchantId, email, role: 'OWNER', active: true, agence: true \}/);
  // `update`, pas seulement `create` : un compte déjà là (invité par le
  // marchand à un rôle plus faible, ou désactivé) doit être remonté, pas
  // laissé tel quel.
  assert.match(fn, /update: \{ role: 'OWNER', active: true, agence: true \}/);
});

test('une boutique installée rejoint le groupe de l’agence et reçoit ses comptes', () => {
  assert.match(authShopify, /import \{ assurerOrganisationAgence, provisionnerComptesAgence \} from '\.\.\/services\/agence\.ts';/);
  assert.match(
    authShopify,
    /const organizationId =\s*existing\?\.organizationId \?\? link\?\.organizationId \?\? \(await assurerOrganisationAgence\(\)\);/,
  );
  assert.match(authShopify, /await provisionnerComptesAgence\(merchant\.id\);/);
  // Une boutique déjà groupée garde son groupe : priorité à `existing`, pas
  // à l'agence qui écraserait un rattachement déjà choisi.
  const ligne = authShopify.match(/const organizationId =[^;]+;/)![0];
  assert.ok(ligne.indexOf('existing?.organizationId') < ligne.indexOf('assurerOrganisationAgence'));
});

test('un marchand ne peut ni rétrograder ni désactiver un compte d’agence', () => {
  const fn = team.slice(
    team.indexOf("scoped.patch<{ Params: { id: string } }>(\n      '/api/team/:id',"),
  );
  const garde = fn.indexOf('if (target.agence)');
  assert.ok(garde > 0, 'le garde-fou doit exister sur la route PATCH');
  assert.ok(garde < fn.indexOf('await prisma.user.update'), 'le garde-fou doit précéder l’écriture');
  assert.match(fn, /return reply\.code\(403\)\.send\(\{ error: 'Ce compte est géré par l’agence, pas modifiable ici\.' \}\);/);
  // Le drapeau est bien lu par la liste que l'équipe affiche, pas seulement
  // par la route qui modifie.
  assert.match(team, /agence: true,\s*\n\s*\},\s*\n\s*\}\);\s*\n\s*\n\s*return reply\.send\(\{ users, me:/);
});

test('retirer un email désactive ses comptes partout, pas seulement pour demain', () => {
  const fn = admin.slice(admin.indexOf("'/api/admin/agence/:id',"));
  assert.match(fn, /await prisma\.agenceAdmin\.delete\(\{ where: \{ id: compte\.id \} \}\);/);
  assert.match(fn, /where: \{ email: compte\.email, agence: true \},\s*\n\s*data: \{ active: false \},/);
});

test('ajouter un email l’applique tout de suite aux boutiques déjà là, hors démo', () => {
  const fn = admin.slice(admin.indexOf("app.post('/api/admin/agence',"), admin.indexOf("app.delete<{ Params: { id: string } }>(\n    '/api/admin/agence/:id',"));
  assert.match(fn, /where: \{ id: \{ not: DEMO\.merchantId \} \}/);
  assert.match(fn, /for \(const merchant of merchants\) await provisionnerComptesAgence\(merchant\.id\);/);
});

test('« Appliquer aux boutiques existantes » rattache au groupe ET pose les comptes, jamais la démo', () => {
  const fn = admin.slice(admin.indexOf("app.post('/api/admin/agence/appliquer',"));
  assert.match(fn, /where: \{ id: \{ not: DEMO\.merchantId \} \}/);
  assert.match(fn, /for \(const merchant of merchants\) await rattacherBoutiqueAgence\(merchant\.id\);/);
});

test('rattacher une boutique pose le même groupe partagé que la connexion', () => {
  const fn = agence.slice(agence.indexOf('export async function rattacherBoutiqueAgence'));
  assert.match(fn, /const organizationId = await assurerOrganisationAgence\(\);/);
  assert.match(fn, /prisma\.merchant\.update\(\{ where: \{ id: merchantId \}, data: \{ organizationId \} \}\);/);
  assert.match(fn, /await provisionnerComptesAgence\(merchantId\);/);
});

test('l’écran Équipe étiquette un compte d’agence et ne l’ouvre pas en édition', () => {
  assert.match(appJs, /user\.agence \? ' <span class="tag tone-mute"/);
  assert.match(appJs, /owner && !user\.agence \? '<button class="btn btn-small">Modifier<\/button>' : ''/);
  assert.match(appJs, /querySelectorAll\('\.grid-row:not\(\.grid-row-lock\)'\)/);
});

test('la console admin a sa section Agence : ajouter, retirer, appliquer', () => {
  assert.match(lire('public/admin.html'), /id="agence-body"/);
  assert.match(adminJs, /async function ajouterAgence\(\)/);
  assert.match(adminJs, /async function retirerAgence\(id\)/);
  assert.match(adminJs, /async function appliquerAgence\(\)/);
  assert.match(adminJs, /void loadAgence\(\);/);
});
