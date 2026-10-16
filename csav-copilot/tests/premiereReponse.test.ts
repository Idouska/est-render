import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { brouillonsEnvoyes, premieresReponses } from '../src/services/tickets/premiereReponse.ts';

/*
 * Première réponse et brouillons utilisés.
 *
 * CE QUE CES TESTS PROTÈGENT. Les deux tuiles ne lisaient que les envois
 * faits depuis l'outil : une équipe qui répond depuis Gmail voyait « — » et
 * « 0 sur 275 », alors que ses réponses partaient tous les jours.
 */

const h = (heure: number) => new Date(Date.UTC(2026, 9, 16, heure));
const groupe = (ticketId: string, min: Date | null, max: Date | null = min) => ({
  ticketId,
  _min: { receivedAt: min },
  _max: { receivedAt: max },
});

test('une réponse partie de Gmail compte comme une première réponse', () => {
  const delais = premieresReponses(
    [groupe('a', h(8)), groupe('b', h(9)), groupe('c', h(10))],
    // a : répondu deux heures après, depuis Gmail. b : fil ouvert par la
    // boutique avant le client, pas de délai d'attente. c : pas de réponse.
    [groupe('a', h(10)), groupe('b', h(7))],
    [],
  );
  assert.deepEqual(delais, [120]);
});

test('un envoi depuis l’outil, plus tôt que la synchronisation, l’emporte', () => {
  const delais = premieresReponses(
    [groupe('a', h(8))],
    [groupe('a', h(12))],
    [{ ticketId: 'a', sentAt: h(9), ticketCreatedAt: h(8) }],
  );
  assert.deepEqual(delais, [60]);
});

test('un brouillon suivi d’une réponse a servi', () => {
  const brouillons = [
    { ticketId: 'a', sentAt: null, createdAt: h(8) }, // réponse à 10 h : utilisé
    { ticketId: 'b', sentAt: null, createdAt: h(11) }, // dernière réponse à 9 h : non
    { ticketId: 'c', sentAt: h(12), createdAt: h(11) }, // envoyé de l'outil
    { ticketId: 'd', sentAt: null, createdAt: h(8) }, // aucune réponse
  ];
  assert.equal(brouillonsEnvoyes(brouillons, [groupe('a', h(9), h(10)), groupe('b', h(9))]), 2);
});

test('la route s’en sert, et l’écran le dit', () => {
  const route = readFileSync(fileURLToPath(new URL('../src/routes/stats.ts', import.meta.url)), 'utf8');
  assert.match(route, /const delays = premieresReponses\(/);
  assert.match(route, /const sentDrafts = brouillonsEnvoyes\(drafts, sortiesFenetre\);/);
  const app = readFileSync(fileURLToPath(new URL('../public/app.js', import.meta.url)), 'utf8');
  assert.match(app, /'Brouillons utilisés'/);
});

test('les réponses envoyées depuis Gmail rejoignent leur conversation', () => {
  const lireSource = (chemin: string) => readFileSync(fileURLToPath(new URL(`../${chemin}`, import.meta.url)), 'utf8');
  const envoyes = lireSource('src/services/gmail/envoyes.ts');
  assert.match(envoyes, /labelIds: \['SENT'\]/);
  // Seulement une conversation que l'outil suit, seulement ce que la boîte a envoyé.
  assert.match(envoyes, /merchantId_gmailThreadId: \{ merchantId, gmailThreadId: threadId! \}/);
  assert.match(envoyes, /if \(!ticket\) continue;/);
  assert.match(envoyes, /message\.fromEmail\.toLowerCase\(\) !== emailAddress\.toLowerCase\(\)/);
  assert.match(envoyes, /direction: 'OUTBOUND'/);
  // Le premier connu arrête la descente.
  assert.match(envoyes, /if \(connu\) break;/);
  // La relève l'appelle, sans dépendre de lui pour son curseur.
  assert.match(lireSource('src/services/gmail/sync.ts'), /await releverReponsesEnvoyees\(merchantId, gmail, connection\.emailAddress\);/);
});
