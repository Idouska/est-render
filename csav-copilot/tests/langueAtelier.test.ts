import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { rappelDuRetard } from '../src/services/envoi/rappel.ts';
import {
  LANGUES_ATELIER,
  MOTS,
  langueAtelier,
  mailDuJour,
  mailRappelUrgent,
  mailUrgent,
} from '../src/services/suppliers/langueAtelier.ts';
import { recapDuJour } from '../src/services/suppliers/recapTexte.ts';

/*
 * Les mails de l'atelier, dans sa langue.
 *
 * CE QUE CES TESTS PROTÈGENT. Son espace se lisait en chinois, ses mails en
 * français. Chaque mail qui lui part — urgence, rappel, récapitulatif, retard,
 * fichier du jour — doit exister dans les trois langues, pour chaque motif ;
 * et la version française ne doit pas avoir bougé.
 */

const lire = (chemin: string) =>
  readFileSync(fileURLToPath(new URL(`../${chemin}`, import.meta.url)), 'utf8');

const schema = lire('prisma/schema.prisma');
const motifs = schema
  .slice(schema.indexOf('enum SupplierAlertKind {'))
  .split('}')[0]!
  .split('\n')
  .map((ligne) => ligne.trim().split(/\s/)[0]!)
  .filter((mot) => /^[A-Z_]+$/.test(mot));

test('les trois langues ont les mêmes mots, et un titre pour chaque motif', () => {
  const cles = Object.keys(MOTS.fr).sort();
  for (const langue of LANGUES_ATELIER) {
    assert.deepEqual(Object.keys(MOTS[langue]).sort(), cles, langue);
    for (const motif of motifs) assert.ok(MOTS[langue].titres[motif], `${langue} : ${motif}`);
  }
  assert.equal(langueAtelier('zh'), 'zh');
  assert.equal(langueAtelier('de'), 'fr', 'une langue inconnue retombe sur le français');
  assert.equal(langueAtelier(null), 'fr');
});

const demande = { kind: 'SIZE', orderName: '#10428', beforeValue: '44', afterValue: '45', message: 'Le client a écrit.' };

test('en français, l’urgence se lit comme avant', () => {
  assert.deepEqual(mailUrgent(demande), {
    subject: 'URGENT — Taille à changer · #10428',
    body: '44 → 45\nCommande : #10428\nLe client a écrit.\n\nOuvrez votre espace de travail, rubrique « Tickets », pour répondre d’un bouton.',
  });
  assert.match(mailRappelUrgent(demande).subject, /^RAPPEL — demande sans réponse · #10428$/);
});

test('en chinois et en anglais, du sujet à la dernière ligne', () => {
  const zh = mailUrgent({ ...demande, kind: 'HOLD', afterValue: null }, 'zh');
  assert.equal(zh.subject, '紧急 — 暂停发货 · #10428');
  assert.match(zh.body, /订单：#10428/);
  assert.match(zh.body, /工单/);
  assert.doesNotMatch(zh.body, /Commande|Ouvrez/);

  const en = mailUrgent({ ...demande, kind: 'MISSING_ITEM', beforeValue: 'Laces', afterValue: null }, 'en');
  assert.equal(en.subject, 'URGENT — Missing item · #10428');
  assert.match(en.body, /^Missing item: Laces\nOrder: #10428/);

  const recap = recapDuJour({
    langue: 'en',
    merchantName: 'Atelier Lumen',
    nouvelles: { demandes: [{ ...demande, kind: 'DELAY', beforeValue: null, afterValue: '2026-10-12', message: '' }], ruptures: [{ orderName: null, combien: 2 }] },
    enAttente: { demandes: [], ruptures: [] },
    lien: null,
  });
  assert.equal(recap?.subject, 'Daily summary — 2 requests to handle');
  assert.match(recap!.body, /- #10428 — Requested shipping date: by 2026-10-12/);
  assert.match(recap!.body, /- No order — Out of stock: 2 replacement models to confirm/);
  assert.doesNotMatch(recap!.body, /Bonjour|Nouvelles/);

  const retard = rappelDuRetard({
    langue: 'zh',
    merchantName: 'M',
    delaiJours: 2,
    commandes: [{ orderName: '#1', articles: null, jours: 3 }],
    lien: 'https://x.test/l',
  });
  assert.equal(retard.subject, '提醒 — 1 个订单已超过 2 天未发货');
  assert.match(retard.body, /- #1（已 3 天）/);
  assert.match(retard.body, /已收批次.*：\nhttps:\/\/x\.test\/l/);

  const jour = mailDuJour({ langue: 'zh', date: new Date('2026-10-05T10:00:00Z'), fuseau: 'Europe/Paris', combien: 4, signature: 'M' });
  assert.match(jour.subject, /订单 — 4 单待备货$/);
  assert.equal(
    mailDuJour({ langue: 'fr', date: new Date('2026-10-05T10:00:00Z'), fuseau: 'Europe/Paris', combien: 4, signature: 'M' }).subject,
    'Commandes du 5 oct. — 4 à préparer',
  );
});

test('chaque envoi lit la langue sur la fiche du fournisseur', () => {
  assert.match(schema, /langue String @default\("fr"\)/);
  assert.match(lire('src/routes/suppliers.ts'), /\.\.\.texteUrgent\(alert, langueAtelier\(atelier\.langue\)\)/);
  assert.match(lire('src/routes/suppliers.ts'), /langue: z\.enum\(LANGUES_ATELIER\)\.optional\(\)/);
  assert.match(lire('src/cron.ts'), /mailRappelUrgent\(alert, langueAtelier\(alert\.supplier\.langue\)\)/);
  assert.match(lire('src/services/suppliers/recap.ts'), /langue: langueAtelier\(atelier\.langue\),/);
  assert.match(lire('src/services/envoi/relances.ts'), /langue: langueAtelier\(atelier\.langue\),/);
  assert.match(lire('src/services/envoi/quotidien.ts'), /langue: langueAtelier\(supplier\.langue\),/);
  assert.match(lire('public/dashboard.html'), /<select id="sup-f-langue">/);
  // Relue par le formulaire : sans elle, chaque enregistrement la remettrait en français.
  assert.match(lire('src/routes/suppliers.ts'), /langue: supplier\.langue,/);
  assert.match(lire('public/app.js'), /\$\('sup-f-langue'\)\.value = supplier\?\.langue \?\? 'fr';/);
  assert.match(lire('public/app.js'), /langue: \$\('sup-f-langue'\)\.value,/);
});
