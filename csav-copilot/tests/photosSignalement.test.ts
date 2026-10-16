import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { STRINGS } from '../public/workspace.i18n.js';

/*
 * Les photos d'un article abîmé, de l'atelier jusqu'au SAV.
 *
 * Une semelle décollée se voit d'un coup d'œil sur une photo ; décrite en une
 * phrase, elle appelait un aller-retour avec l'atelier pour la demander.
 * L'atelier joint jusqu'à quatre photos, réduites dans son navigateur ; elles
 * deviennent des pièces jointes du message, que le SAV montre déjà en
 * vignettes — rangées en base, puisqu'aucun mail Gmail n'est derrière.
 */

const lire = (chemin: string) =>
  readFileSync(fileURLToPath(new URL(`../${chemin}`, import.meta.url)), 'utf8');

const schema = lire('prisma/schema.prisma');
const route = lire('src/routes/supplierWorkspace.ts');
const pieces = lire('src/routes/attachments.ts');
const js = lire('public/workspace.js');

const corps = (source: string, signature: string) => {
  const debut = source.indexOf(signature);
  assert.ok(debut >= 0, `${signature} introuvable`);
  return source.slice(debut, source.indexOf('\n}\n', debut) + 2);
};

test('une pièce jointe peut porter son contenu, sans mail Gmail derrière', () => {
  const modele = schema.slice(schema.indexOf('model Attachment {'), schema.indexOf('}', schema.indexOf('model Attachment {')));
  assert.match(modele, /gmailAttachmentId String\?/);
  assert.match(modele, /data\s+Bytes\?/);
  const migration = lire('prisma/migrations/20261016090000_photos_signalement/migration.sql');
  assert.match(migration, /ALTER TABLE "Attachment" ALTER COLUMN "gmailAttachmentId" DROP NOT NULL;/);
  assert.match(migration, /ALTER TABLE "Attachment" ADD COLUMN "data" BYTEA;/);
  // Le contenu en base passe avant Gmail ; sans l'un ni l'autre, rien.
  assert.match(pieces, /if \(attachment\.data\) return envoyer\(Buffer\.from\(attachment\.data\)\);\n\s+if \(!attachment\.gmailAttachmentId\) return reply\.code\(404\)/);
});

test('le signalement accepte quatre photos au plus, déjà réduites', () => {
  const signalement = route.slice(route.indexOf("'/api/workspace/:id/issues'"), route.indexOf('/* ------------------------------------------------------- substitutions -- */'));
  assert.match(route, /const PHOTOS_SIGNALEMENT_MAX = 4;/);
  assert.match(signalement, /photos: z\.array\(photoSchema\)\.max\(PHOTOS_SIGNALEMENT_MAX\)\.nullish\(\),/);
  assert.match(signalement, /\{ bodyLimit: PHOTOS_SIGNALEMENT_MAX \* 3 \* 1024 \* 1024 \+ 64 \* 1024 \}/);
  // Rangées sous le message, contenu compris.
  assert.match(signalement, /await prisma\.attachment\.createMany\(\{/);
  assert.match(signalement, /messageId: message\.id,/);
  assert.match(signalement, /data: photo\.data,/);
});

test('l’atelier ajoute, voit et retire ses photos, pour un article abîmé', () => {
  assert.match(js, /const PHOTOS_MAX = 4;/);
  const contexte = corps(js, 'function renderContexte(');
  assert.match(contexte, /\(kind === 'DAMAGE' \? zonePhotos\(\) : ''\)/);
  const zone = corps(js, 'function zonePhotos(');
  assert.match(zone, /<input type="file" id="issue-photos-input" accept="image\/\*" multiple hidden \/>/);
  assert.match(zone, /photos\.length < PHOTOS_MAX/);
  assert.match(zone, /data-retirer-photo="\$\{i\}"/);
  // Réduites comme les photos d'étiquettes ; un fichier illisible n'arrête pas les autres.
  const ajout = corps(js, 'async function ajouterPhotos(');
  assert.match(ajout, /await shrinkPhoto\(fichier\)/);
  assert.match(ajout, /toast\(t\('issue\.photoErr'\), true\);/);
  // Envoyées seulement pour un article abîmé.
  assert.match(js, /\.\.\.\(kind === 'DAMAGE' && state\.issuePhotos\?\.length \? \{ photos: state\.issuePhotos \} : \{\}\),/);
  // Une nouvelle fenêtre repart sans photo.
  assert.match(corps(js, 'function ouvrirSignalement('), /state\.issuePhotos = \[\];/);
});

test('les textes des photos existent dans les trois langues', () => {
  for (const lang of ['fr', 'en', 'zh'] as const) {
    const table = STRINGS[lang] as Record<string, string>;
    for (const cle of ['issue.addPhotos', 'issue.addPhoto', 'issue.photoRemove', 'issue.photosHint', 'issue.photoErr']) {
      assert.ok(table[cle], `${lang} : ${cle}`);
    }
    assert.match(table['issue.photosHint']!, /\{n\}/);
  }
});
