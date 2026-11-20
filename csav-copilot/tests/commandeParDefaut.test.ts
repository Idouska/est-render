import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

/*
 * La commande rattachée par défaut se signale.
 *
 * Quand un client a plusieurs commandes et n'en désigne aucune, la plus
 * récente est rattachée. Silencieux, ce choix ferait répondre sur la mauvaise
 * commande : la fiche le dit, et propose de confirmer ou de changer.
 */
const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const bloc = app.slice(app.indexOf('const COMMANDE_PAR_DEFAUT_MAX'), app.indexOf('function avisCommandeParDefaut('));
const commandeParDefaut = new Function(`${bloc}; return commandeParDefaut;`)() as (t: unknown) => boolean;

test('signalée pour un choix par défaut, pas pour une certitude ni un choix de l’agent', () => {
  const base = { shopifyOrderId: 'gid://shopify/Order/1', orderMatchMethod: 'CUSTOMER_EMAIL' };
  assert.equal(commandeParDefaut({ ...base, orderMatchScore: 0.6 }), true);
  assert.equal(commandeParDefaut({ ...base, orderMatchMethod: 'NAME_AND_RECENT_DATE', orderMatchScore: 0.4 }), true);
  assert.equal(commandeParDefaut({ ...base, orderMatchScore: 0.95 }), false);
  assert.equal(commandeParDefaut({ ...base, orderMatchMethod: 'MANUAL', orderMatchScore: 0.5 }), false);
  assert.equal(commandeParDefaut({ shopifyOrderId: null, orderMatchScore: 0.5 }), false);
  assert.equal(commandeParDefaut({ ...base, orderMatchScore: null }), false);
});

test('le score du choix par défaut est bien sous le seuil d’affichage', () => {
  const matcher = readFileSync(new URL('../src/services/matching/orderMatcher.ts', import.meta.url), 'utf8');
  assert.match(matcher, /method: 'CUSTOMER_EMAIL', score: 0\.6 \}/);
  assert.match(app, /const COMMANDE_PAR_DEFAUT_MAX = 0\.6;/);
});

test('deux gestes : confirmer, ou donner le bon numéro', () => {
  assert.match(app, /data-cmd-confirmer="\$\{esc\(ticket\.shopifyOrderId\)\}">C’est la bonne</);
  assert.match(app, /data-cmd-changer>Ce n’est pas celle-ci</);
  assert.match(app, /avisCommandeParDefaut\(ticket\) \+\n\s+`<div class="c-order-tags">/);
  // Seul un numéro exact est retenu : une recherche approchante ne rattache rien.
  assert.match(app, /String\(commande\.name\)\.replace\(\/\^#\/, ''\) === cherche/);
});
