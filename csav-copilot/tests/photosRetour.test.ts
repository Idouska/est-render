import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { randomBytes } from 'node:crypto';

/*
 * Les photos d'un retour, avant toute décision.
 *
 * CE QUE CES TESTS PROTÈGENT. On ne rembourse ni ne renvoie une paire sur la
 * foi d'une case cochée : trois photos au moins de la paire retournée —
 * du client, de l'agence ou du marchand — avant de valider un échange, un
 * remboursement, ou de refuser le retour. L'agence ne déclare une paire reçue
 * qu'après l'avoir photographiée elle-même. Et c'est le serveur qui l'exige,
 * pas seulement l'écran.
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

const { PHOTOS_MIN, manquePhotos } = await import('../src/services/reshipment/photosRetour.ts');

const lire = (chemin: string) => readFileSync(fileURLToPath(new URL(`../${chemin}`, import.meta.url)), 'utf8');
const retours = lire('src/routes/returns.ts');
const agence = lire('src/routes/agencyPortal.ts');
const route = (source: string, chemin: string) => {
  const debut = source.indexOf(`'${chemin}'`);
  assert.ok(debut >= 0, chemin);
  return source.slice(debut, source.indexOf('\n  );\n', debut));
};
const GARDE = /if \((photos|n) < PHOTOS_MIN\) return reply\.code\(409\)\.send\(\{ code: 'photos', (manque: PHOTOS_MIN - n, )?error: manquePhotos\((photos|n)\) \}\);/;

test('trois photos au moins, et un message qui dit combien il en manque', () => {
  assert.equal(PHOTOS_MIN, 3);
  assert.equal(manquePhotos(0), 'Il manque 3 photos de la paire retournée : 3 au moins avant de décider.');
  assert.equal(manquePhotos(2), 'Il manque 1 photo de la paire retournée : 3 au moins avant de décider.');
});

test('le serveur refuse toute décision sans les photos', () => {
  for (const chemin of [
    '/api/returns/:id/echange/valider',
    '/api/returns/:id/echange/organiser',
    '/api/returns/:id/remboursement/valider',
    '/api/returns/:id/refuser',
    '/api/returns/:id/defectueux',
  ]) {
    assert.match(route(retours, chemin), GARDE, chemin);
  }
  // « En stock » ou « Défectueux » choisis dans la liste : la même règle.
  assert.match(route(retours, '/api/returns/:id'), /if \(decide && existing\.origine === 'RETOUR' && !existing\.controleLe\) \{/);
});

test('un remboursement validé arrive dans « À rembourser », au prix relu sur la commande', () => {
  const valider = route(retours, '/api/returns/:id/remboursement/valider');
  assert.match(valider, /montant = prixPaye\(commande\.lineItems, dossier\);/);
  assert.match(valider, /prisma\.remboursementAFaire\.create\(\{/);
  assert.match(valider, /motif: 'Retour contrôlé, photos à l’appui',/);
});

test('un refus garde son motif et rend la paire promise au stock', () => {
  const refuser = route(retours, '/api/returns/:id/refuser');
  assert.match(refuser, /data: \{ refuseLe: new Date\(\), refusMotif: parsed\.data\.motif, status: 'CLOSED' \},/);
  assert.match(refuser, /where: \{ merchantId, reusedReturnCaseId: dossier\.id \},/);
});

test('l’agence ne déclare « Reçue » qu’avec trois photos prises par elle', () => {
  const recue = route(agence, '/api/agence/:id/retours/:caseId/recue');
  assert.match(recue, /const n = await nombrePhotos\(agence\.merchantId, dossier\.id, 'AGENCE'\);/);
  assert.match(recue, /if \(n < PHOTOS_MIN\) \{\n\s+return reply\.code\(409\)\.send\(\{ code: 'photos', manque: PHOTOS_MIN - n, error: manquePhotos\(n\) \}\);/);
  assert.match(route(agence, '/api/agence/:id/retours/:caseId/photos'), /source: 'AGENCE',/);
});

test('les photos jointes par le client à ses mails se versent au dossier', () => {
  const ajout = route(retours, '/api/returns/:id/photos');
  assert.match(ajout, /image = await lirePieceJointe\(merchantId, parsed\.data\.attachmentId\)/);
  assert.match(ajout, /source: parsed\.data\.attachmentId \? 'CLIENT' : \(parsed\.data\.source \?\? 'MARCHAND'\),/);
});

test('l’écran : les photos dans le contrôle, valider et refuser bloqués sans elles', () => {
  const app = lire('public/app.js');
  assert.match(app, /\$\('ech-valider'\)\.disabled = !tous \|\| !photosOk \|\| fenEch\.envoi \|\| fenEch\.refus;/);
  assert.match(app, /\$\('ech-refuser'\)\.disabled = !photosOk \|\| fenEch\.envoi;/);
  const html = lire('public/dashboard.html');
  assert.match(html, /<div class="backdrop" id="rp-modal" role="dialog" aria-modal="true" aria-labelledby="rp-title" hidden>/);
  assert.match(lire('public/agence.html'), /<section id="ag-sec-retours" hidden>/);
});
