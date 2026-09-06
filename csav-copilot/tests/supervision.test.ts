import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  cronIndicator,
  queueIndicator,
  watchIndicator,
  worstLevel,
} from '../src/services/supervision/status.ts';

const NOW = new Date('2026-09-06T12:00:00Z');

function hoursAgo(hours: number): Date {
  return new Date(NOW.getTime() - hours * 60 * 60 * 1000);
}

function hoursAhead(hours: number): Date {
  return new Date(NOW.getTime() + hours * 60 * 60 * 1000);
}

/*
 * Ce que ces seuils protègent : l'écoute Gmail expire au bout de sept jours
 * sans lever la moindre erreur, et le cron qui la renouvelle peut mourir sans
 * plus de bruit. Les deux pannes se présentent comme du silence.
 *
 * Ce qu'ils doivent éviter en même temps : un rapport a déjà annoncé « 100
 * messages en attente » sur un système parfaitement sain. Un voyant rouge qui
 * se trompe finit ignoré, et une alerte ignorée ne vaut pas mieux que pas
 * d'alerte du tout.
 */

test('un cron qui vient de passer est vert', () => {
  assert.equal(cronIndicator(hoursAgo(8), NOW).level, 'ok');
});

test('un passage manqué avertit sans crier', () => {
  assert.equal(cronIndicator(hoursAgo(30), NOW).level, 'warn');
});

test('deux passages manqués : le service est arrêté', () => {
  assert.equal(cronIndicator(hoursAgo(60), NOW).level, 'down');
});

test('aucun passage enregistré est déjà une panne, pas une absence de données', () => {
  const indicator = cronIndicator(null, NOW);

  assert.equal(indicator.level, 'down');
  assert.match(indicator.detail, /sept jours/);
});

test('un léger retard ne réveille personne', () => {
  // Le cron passe à 4 h ; le relevé de 12 h voit donc 8 h au minimum et
  // jusqu'à 26 h si le passage a glissé. Cette plage doit rester verte.
  assert.equal(cronIndicator(hoursAgo(25), NOW).level, 'ok');
});

test('une écoute Gmail valide plusieurs jours est verte', () => {
  assert.equal(watchIndicator('sav@boutique.fr', hoursAhead(5 * 24), NOW).level, 'ok');
});

test('sous 24 h, le renouvellement aurait dû avoir lieu', () => {
  // 24 h est le seuil de `renewExpiringWatches` : en dessous, le cron était
  // censé renouveler et ne l'a pas fait.
  assert.equal(watchIndicator('sav@boutique.fr', hoursAhead(12), NOW).level, 'warn');
});

test('une écoute expirée rend la boîte aveugle', () => {
  const indicator = watchIndicator('sav@boutique.fr', hoursAgo(3), NOW);

  assert.equal(indicator.level, 'down');
  assert.match(indicator.headline, /sav@boutique\.fr/);
});

test('une boîte sans écoute du tout est une panne, pas un état neutre', () => {
  assert.equal(watchIndicator('sav@boutique.fr', null, NOW).level, 'down');
});

test('mille messages en attente qui avancent, c’est un rattrapage, pas une panne', () => {
  const indicator = queueIndicator('Traitement', {
    waiting: 1000,
    active: 3,
    completed: 4200,
    failed: 0,
  });

  assert.equal(indicator.level, 'ok');
});

test('des messages en attente que personne ne consomme : le worker est mort', () => {
  const indicator = queueIndicator('Traitement', {
    waiting: 12,
    active: 0,
    completed: 0,
    failed: 0,
  });

  assert.equal(indicator.level, 'down');
});

test('une file vide et immobile reste verte : il n’y a rien à faire', () => {
  const indicator = queueIndicator('Traitement', {
    waiting: 0,
    active: 0,
    completed: 0,
    failed: 0,
  });

  assert.equal(indicator.level, 'ok');
});

test('quelques échecs sur sept jours ne méritent pas d’alerte', () => {
  assert.equal(
    queueIndicator('Traitement', { waiting: 0, active: 1, completed: 900, failed: 4 }).level,
    'ok',
  );
});

test('vingt échecs accumulés méritent un coup d’œil', () => {
  assert.equal(
    queueIndicator('Traitement', { waiting: 0, active: 1, completed: 900, failed: 20 }).level,
    'warn',
  );
});

test('le bandeau prend la couleur du pire voyant', () => {
  const ok = { level: 'ok' as const, headline: '', detail: '' };
  const warn = { level: 'warn' as const, headline: '', detail: '' };
  const down = { level: 'down' as const, headline: '', detail: '' };

  assert.equal(worstLevel([ok, ok]), 'ok');
  assert.equal(worstLevel([ok, warn]), 'warn');
  assert.equal(worstLevel([ok, warn, down]), 'down');
});
