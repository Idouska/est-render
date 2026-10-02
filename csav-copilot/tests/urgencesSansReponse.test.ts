import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { DELAI_URGENCE_H } from '../src/services/suppliers/urgence.ts';
import { ligneUrgence, mailUrgencesSansReponse } from '../src/services/suppliers/urgencesTexte.ts';

/*
 * Une urgence sans réponse, signalée au marchand.
 *
 * CE QUE CES TESTS PROTÈGENT. L'atelier a eu son mail et son rappel ; s'il
 * se tait, seul le marchand peut encore agir — en appelant. Il doit le savoir
 * à temps, une fois par mail, et en permanence par le bandeau ; le mail dit
 * qui appeler, avec le numéro.
 */

const lire = (chemin: string) =>
  readFileSync(fileURLToPath(new URL(`../${chemin}`, import.meta.url)), 'utf8');

const urgence = {
  kind: 'HOLD',
  orderName: '#10428',
  beforeValue: null,
  afterValue: null,
  heures: 5,
  atelier: { name: 'Atelier Nord', phone: '+86 21 5555 0101' },
};

test('le mail dit quoi, chez qui, à quel numéro, et depuis quand', () => {
  assert.equal(ligneUrgence(urgence), '- #10428 — Ne pas expédier · Atelier Nord, +86 21 5555 0101 · depuis 5 h');
  assert.equal(
    ligneUrgence({ ...urgence, kind: 'SIZE', beforeValue: '44', afterValue: '45', atelier: { name: 'Sud', phone: null } }),
    '- #10428 — Taille à changer (44 → 45) · Sud · depuis 5 h',
  );
  const seule = mailUrgencesSansReponse({ urgences: [urgence], lien: 'https://x.test/dashboard' });
  assert.equal(seule.subject, 'Urgent sans réponse — #10428 : Ne pas expédier');
  assert.match(seule.body, /appelez l’atelier/);
  assert.match(seule.body, /https:\/\/x\.test\/dashboard$/);
  assert.equal(
    mailUrgencesSansReponse({ urgences: [urgence, urgence], lien: 'l' }).subject,
    '2 demandes urgentes sans réponse de l’atelier',
  );
});

test('une fois par urgence, noté seulement si le mail est parti', () => {
  const service = lire('src/services/suppliers/urgencesSansReponse.ts');
  assert.match(service, /signaleLe: null,/);
  assert.match(service, /lte: new Date\(maintenant\.getTime\(\) - DELAI_URGENCE_H \* 3_600_000\)/);
  assert.match(service, /kind: \{ in: \[\.\.\.KINDS_URGENTS\] as SupplierAlertKind\[\] \},/);
  assert.ok(service.indexOf('await sendPlainEmail(') < service.indexOf('data: { signaleLe: maintenant }'));
  assert.match(service, /role: \{ in: \['OWNER', 'SUPERVISOR'\] \}/);
  assert.match(lire('src/worker.ts'), /await signalerUrgencesSansReponse\(\);/);
  assert.match(lire('prisma/schema.prisma'), /signaleLe\s+DateTime\?/);
});

test('le bandeau du tableau de bord suit la même règle', () => {
  const app = lire('public/app.js');
  assert.match(app, new RegExp(`const DELAI_URGENCE_H = ${DELAI_URGENCE_H};`));
  const regle = app.slice(app.indexOf('function urgencesSansReponse('), app.indexOf('function renderUrgencesSansReponse('));
  assert.match(regle, /demande\.status === 'PENDING' &&\s*KINDS_URGENTS\.has\(demande\.kind\)/);
  assert.match(app, /renderUrgencesSansReponse\(demandes\);/);
  assert.match(app, /<a href="tel:/);
  assert.match(lire('public/dashboard.html'), /<div class="urg-banner" id="urg-banner" role="alert" hidden><\/div>/);
  // Le numéro vient avec la demande.
  assert.match(lire('src/routes/suppliers.ts'), /supplier: \{ select: \{ id: true, name: true, phone: true \} \},/);
});
