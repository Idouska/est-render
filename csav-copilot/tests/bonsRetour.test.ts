import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { devinerDepuisNom, rattacherBon } from '../src/services/reshipment/lireBon.ts';

/*
 * Retour : bons importés, cinq statuts, « non valide » qui bloque.
 */

const lire = (chemin: string) => readFileSync(fileURLToPath(new URL(`../${chemin}`, import.meta.url)), 'utf8');

test('le nom du fichier donne un numéro quand l’IA ne lit rien', () => {
  assert.deepEqual(devinerDepuisNom('6A12345678901.pdf').numero, '6A12345678901');
  assert.equal(devinerDepuisNom('6A12345678901.pdf').transporteur, 'Colissimo');
  assert.equal(devinerDepuisNom('etiquette-retour.pdf').numero, null);
});

test('un bon se rattache par la commande, sinon par le nom, et jamais au hasard', () => {
  const dossiers = [
    { id: 'a', orderName: '#1042', customerName: 'Marie Dupont' },
    { id: 'b', orderName: '#1043', customerName: 'Jean Martin' },
    { id: 'c', orderName: '#1044', customerName: 'Jean Martin' },
  ];
  assert.equal(rattacherBon({ reference: 'CMD 1042', expediteur: null }, dossiers), 'a');
  assert.equal(rattacherBon({ reference: null, expediteur: 'Mme DUPONT Marie' }, dossiers), 'a');
  // Deux Jean Martin : l'agent tranche.
  assert.equal(rattacherBon({ reference: null, expediteur: 'Jean Martin' }, dossiers), null);
  assert.equal(rattacherBon({ reference: null, expediteur: null }, dossiers), null);
});

test('cinq statuts, et les anciens repassent en Ouvert', () => {
  const routes = lire('src/routes/returns.ts');
  assert.match(routes, /STATUTS_RETOUR = \['OPEN', 'LABEL_SENT', 'RESTOCKED', 'UNUSABLE', 'CLOSED'\] as const/);
  const migration = lire('prisma/migrations/20261118090000_retours_bons/migration.sql');
  assert.match(migration, /SET "status" = 'OPEN' WHERE "status" IN \('SHIPPED', 'IN_TRANSIT', 'RECEIVED'\)/);
  const app = lire('public/app.js');
  assert.match(app, /RESTOCKED: 'Reçu et validé',\s*UNUSABLE: 'Reçu et non valide',\s*CLOSED: 'Fermé',/);
});

test('« Reçu et non valide » bloque échange, lien de paiement et remboursement', () => {
  const routes = lire('src/routes/returns.ts');
  // remboursement/valider et echange/valider, puis lien et echange/organiser.
  assert.equal((routes.match(/if \(retourNonValide\(dossier\)\) return reply\.code\(409\)\.send\(NON_VALIDE\);/g) ?? []).length, 2);
  assert.equal((routes.match(/if \(await bloqueParNonValide\(merchantId, request\.params\.id\)\) return reply\.code\(409\)\.send\(NON_VALIDE\);/g) ?? []).length, 2);
});

test('« Renvoi » devient « Stock », dans Pilotage', () => {
  assert.match(lire('public/app.js'), /renvoi: \{ icon: 'cycle', label: 'Stock', group: 'Pilotage'/);
});

test('Stock : une rangée de compteurs qui filtrent, sans la barre de Retour', () => {
  const app = lire('public/app.js');
  assert.match(app, /compteur\('stock', dispo\.length, 'En stock'\)/);
  assert.match(app, /compteur\('match', nMatch, 'Matching', 'ok'\)/);
  assert.match(app, /compteur\('nonenvoye', nAExpedier, 'À expédier'/);
  assert.match(app, /compteur\('envoye', nEnvoye, 'Envoyé'\)/);
  assert.match(app, /<option value="imprimer">Imprimer la liste<\/option>/);
  assert.match(app, /<option value="partager">Partager la liste<\/option>/);
  assert.match(app, /data-stk-voir=/);
  assert.match(app, /\$\('ret-barre'\)\.hidden = r\.tab === 'stock';/);
  const html = lire('public/dashboard.html');
  assert.match(html, /data-rtab="matches" aria-pressed="false" hidden/);
  assert.match(html, /data-rtab="stock" aria-pressed="false" hidden/);
  assert.match(lire('src/routes/returns.ts'), /app\.get\('\/api\/returns\/stock\/images'/);
});
