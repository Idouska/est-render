import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

/*
 * Le retour de Google, et un seul rond par ligne au téléphone.
 *
 * Annuler sur l'écran de consentement de Google affichait une page noire de
 * JSON brut — « {"error":"Autorisation Google refusée : access_denied"} » —
 * sans rien pour revenir. Le rappel ramène maintenant dans l'outil, sur
 * Réglages › Connexions, avec une phrase qui dit quoi faire.
 */

const lire = (chemin: string) =>
  readFileSync(fileURLToPath(new URL(`../${chemin}`, import.meta.url)), 'utf8');

const route = lire('src/routes/auth.google.ts');
const app = lire('public/app.js');
const css = lire('public/styles.css');

test('le retour de Google ne répond plus jamais par du JSON brut', () => {
  const rappel = route.slice(route.indexOf("'/auth/google/callback'"), route.indexOf("'/auth/google/disconnect'"));
  assert.doesNotMatch(rappel, /\.send\(\{ error/);
  assert.match(rappel, /if \(error\) \{\n.*\n\s+return retourGmail\(reply, 'refuse'\);/);
  assert.match(rappel, /safeEqual\(state, expectedState\)\) \{\n\s+return retourGmail\(reply, 'etat'\);/);
  assert.match(rappel, /if \(!tokens\.refresh_token\) return retourGmail\(reply, 'jeton'\);/);
  // Un code rejoué ou un Google indisponible : plus d'erreur 500 brute.
  assert.match(rappel, /\} catch \(err\) \{\n.*\n\s+return retourGmail\(reply, 'echec'\);/);
  assert.match(rappel, /return reply\.redirect\('\/dashboard\?gmail=connecte'\);/);
  assert.match(route, /reply\.redirect\(`\/dashboard\?gmail=\$\{raison\}`\);/);
  // Sans session, la connexion plutôt que « Session absente ou expirée ».
  assert.match(rappel, /\{ preHandler: sessionOuConnexion \}/);
  assert.match(route, /if \(!verifySession\(request\.cookies\[SESSION_COOKIE\]\)\) \{\n\s+await reply\.redirect\('\/login'\);/);
});

test('l’outil dit quoi faire, sur Réglages › Connexions, une seule fois', () => {
  for (const raison of ['connecte', 'refuse', 'etat', 'jeton', 'echec']) {
    assert.match(app, new RegExp(`\\n  ${raison}: \\[`), raison);
  }
  const retour = app.slice(app.indexOf('function retourGmail('), app.indexOf('\n}\n', app.indexOf('function retourGmail(')));
  // Le paramètre quitte l'adresse : recharger ne répète pas le message.
  assert.match(retour, /adresse\.searchParams\.delete\('gmail'\);\n\s+history\.replaceState\(/);
  assert.match(retour, /setView\('settings'\);\n\s+document\.querySelector\('\[data-reg="connexions"\]'\)\?\.click\(\);/);
  // Le temps de lire une phrase entière.
  assert.match(retour, /toast\(message, echec, echec \? 10_000 : 4000\);/);
  assert.match(app, /setView\('tickets'\);\n\s+retourGmail\(\);/);
});

test('au téléphone, un seul rond par ligne : la case de sélection', () => {
  assert.match(css, /@media \(max-width: 760px\) \{\n(?:\s+\/\*[^*]*(?:\*(?!\/)[^*]*)*\*\/\n)?\s+\.qread\.lu \{ display: none; \}\n\}/);
  // Le cercle creux ne s'affiche plus en permanence au doigt ; il reste au
  // survol, sur ordinateur.
  assert.doesNotMatch(css, /la pastille reste visible\.\s*\*\/\n\s+\.qread\.lu \{ opacity: 1; \}/);
});
