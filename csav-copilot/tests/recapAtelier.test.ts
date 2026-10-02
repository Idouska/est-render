import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { heureAtelier, jourAtelier } from '../src/services/envoi/rappel.ts';
import { ligneDemande, recapDuJour } from '../src/services/suppliers/recapTexte.ts';
import { KINDS_DU_RECAP, KINDS_URGENTS } from '../src/services/suppliers/urgence.ts';

/*
 * Le récapitulatif du matin de l'atelier.
 *
 * CE QUE CES TESTS PROTÈGENT. Un mail par demande, et l'atelier ne lisait
 * plus rien — urgents compris. Seul ce qui change le colis part sur-le-champ ;
 * le reste attend un seul mail, à 9 h chez lui. Trois choses doivent tenir :
 * aucun motif ne tombe entre les deux (ni mail tout de suite, ni récap) ;
 * aucune demande n'a deux rappels (cron + récap) ; et un récapitulatif en
 * échec repart au lieu d'être tenu pour envoyé.
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

test('chaque motif part soit tout de suite, soit au récap — jamais les deux, jamais aucun', () => {
  assert.ok(motifs.length >= 11, 'les motifs sont lus dans le schéma');
  const recap = new Set<string>(KINDS_DU_RECAP);
  for (const motif of motifs) {
    assert.ok(KINDS_URGENTS.has(motif) !== recap.has(motif), motif);
  }
  // Ce qui change le colis ne peut pas attendre demain matin.
  for (const motif of ['HOLD', 'CANCEL', 'ADDRESS', 'SIZE']) assert.ok(KINDS_URGENTS.has(motif), motif);
});

test('le tableau de bord en a la même liste', () => {
  const app = lire('public/app.js');
  const copie = app.match(/const KINDS_URGENTS = new Set\(\[([^\]]+)\]\);/)?.[1];
  assert.ok(copie);
  assert.deepEqual(
    [...copie.matchAll(/'(\w+)'/g)].map((m) => m[1]).sort(),
    [...KINDS_URGENTS].sort(),
  );
});

test('le récapitulatif : nouvelles demandes, puis ce qui attend toujours', () => {
  const recap = recapDuJour({
    merchantName: 'Atelier Lumen',
    nouvelles: {
      demandes: [
        { kind: 'MISSING_ITEM', orderName: '#10428', beforeValue: 'Lampe Rosée · Verre', afterValue: null, message: '' },
        { kind: 'TRACKING', orderName: '#10410', beforeValue: 'LP001, LP002', afterValue: null, message: '  le client\n relance ' },
      ],
      ruptures: [{ orderName: '#10433', combien: 2 }],
    },
    enAttente: {
      demandes: [{ kind: 'DELAY', orderName: '#10399', beforeValue: null, afterValue: '2026-10-12', message: '', jours: 2 }],
      ruptures: [],
    },
    lien: 'https://exemple.test/fournisseur/s1?token=x',
  });
  assert.ok(recap);
  assert.equal(recap.subject, 'Récapitulatif du jour — 4 demandes à traiter');
  const lignes = recap.body.split('\n');
  const nouvelles = lignes.indexOf('Nouvelles demandes :');
  const attente = lignes.indexOf('Toujours sans réponse :');
  assert.ok(nouvelles > 0 && attente > nouvelles);
  assert.deepEqual(lignes.slice(nouvelles + 1, nouvelles + 4), [
    '- #10428 — Article manquant : Lampe Rosée · Verre',
    '- #10410 — Point sur le colis : LP001, LP002 — « le client relance »',
    '- #10433 — Rupture : 2 modèles de remplacement à valider',
  ]);
  assert.equal(lignes[attente + 1], '- #10399 — Date d’expédition demandée : au plus tard le 2026-10-12 (depuis 2 j)');
  assert.match(recap.body, /https:\/\/exemple\.test\/fournisseur\/s1\?token=x/);
  assert.match(recap.body, /Atelier Lumen$/);
});

test('rien à dire : pas de mail', () => {
  assert.equal(
    recapDuJour({
      merchantName: 'M',
      nouvelles: { demandes: [], ruptures: [] },
      enAttente: { demandes: [], ruptures: [] },
      lien: null,
    }),
    null,
  );
});

test('une ligne reste une ligne : un long message est coupé', () => {
  const ligne = ligneDemande({ kind: 'OTHER', orderName: null, beforeValue: null, afterValue: null, message: 'x'.repeat(400) });
  assert.ok(!ligne.includes('\n'));
  assert.match(ligne, /^- Sans commande — Message — « x+… »$/);
  assert.ok(ligne.length < 200);
  // Une urgente rattrapée (son mail avait échoué) se lit comme un changement.
  assert.equal(
    ligneDemande({ kind: 'SIZE', orderName: '#1', beforeValue: '44', afterValue: '45', message: '' }),
    '- #1 — Taille à changer : 44 → 45',
  );
});

test('le jour de l’atelier change à minuit à Shanghai, pas à Paris', () => {
  assert.equal(jourAtelier(new Date('2026-10-10T15:59:00Z')), '2026-10-10');
  assert.equal(jourAtelier(new Date('2026-10-10T16:00:00Z')), '2026-10-11');
  assert.equal(heureAtelier(new Date('2026-10-10T01:00:00Z')), 9);
});

test('un récap par jour, à 9 h chez l’atelier, noté seulement s’il est parti', () => {
  const service = lire('src/services/suppliers/recap.ts');
  assert.match(service, /export const HEURE_RECAP = 9;/);
  assert.match(service, /if \(heure < HEURE_RECAP \|\| heure >= FERMETURE\) return 0;/);
  assert.match(service, /if \(atelier\.recapLe && jourAtelier\(atelier\.recapLe\) === aujourdhui\) continue;/);
  assert.ok(service.indexOf('await sendPlainEmail(') < service.indexOf('data: { recapLe: maintenant }'));
  // Rappelée une fois : seulement ce qui a déjà été annoncé, et pas encore rappelé.
  assert.match(service, /remindedAt: null,\s*emailedAt: \{ not: null, lte: annoncees \}/);
  assert.match(service, /reponduLe: null, rappelLe: null, avisLe: \{ not: null, lte: annoncees \}/);
  assert.match(lire('src/worker.ts'), /await envoyerRecapitulatifs\(\);/);
});

test('les urgentes partent tout de suite ; les autres n’ont pas de mail', () => {
  const routes = lire('src/routes/suppliers.ts');
  const creation = routes.slice(routes.indexOf("'/api/suppliers/:id/alert'"));
  assert.match(creation, /const differe = !estUrgente\(parsed\.data\.kind\);/);
  assert.match(creation, /const emailed = differe \? false : await mailUrgent\(/);
  assert.match(creation, /return reply\.send\(\{ alert, emailed, differe \}\);/);
  // Corrigée en urgente sans avoir eu de mail : elle part à la correction.
  const correction = routes.slice(routes.indexOf("'/api/changes/:id',"), routes.indexOf("'/api/suppliers/:id/alert'"));
  assert.match(correction, /!corrigee\.emailedAt && estUrgente\(corrigee\.kind\)/);
});

test('une proposition de remplacement n’envoie plus de mail à elle seule', () => {
  const service = lire('src/services/ruptures/substitution.ts');
  assert.doesNotMatch(service, /sendPlainEmail/);
  assert.match(service, /return \{ creees: params\.propositions\.length, avertiPar: 'recap' \};/);
  // Les propositions d'avant ont eu leur mail : le récap ne les annonce pas.
  const migration = lire('prisma/migrations/20261006090000_recap_atelier/migration.sql');
  assert.match(migration, /UPDATE "RuptureSubstitution" SET "avisLe" = "createdAt";/);
});

test('le cron ne rappelle plus que les urgentes : le reste l’est par le récap', () => {
  const cron = lire('src/cron.ts');
  const rappel = cron.slice(cron.indexOf('async function remindSilentSuppliers'));
  assert.match(rappel, /kind: \{ in: \[\.\.\.KINDS_URGENTS\] as SupplierAlertKind\[\] \},/);
  assert.doesNotMatch(lire('src/services/suppliers/recap.ts'), /KINDS_URGENTS/);
});
