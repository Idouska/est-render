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
  assert.match(rappel, /\} catch \(err\) \{\n\s+const \{ raison, detail \} = raisonEchecGoogle\(err\);\n.*\n\s+return retourGmail\(reply, raison, detail\);/);
  assert.match(rappel, /return retourGmail\(reply, 'connecte'\);/);
  assert.match(route, /reply\.redirect\(adresseRetourGmail\(raison, detail\)\)/);
  // Sans session, la connexion plutôt que « Session absente ou expirée ».
  // Sauf pour « Se connecter avec Google », qui arrive par définition sans session.
  assert.match(rappel, /if \(!estConnexion\(request\)\) await sessionOuConnexion\(request, reply\);/);
  assert.match(route, /if \(!verifySession\(request\.cookies\[SESSION_COOKIE\]\)\) \{\n\s+await reply\.redirect\('\/login'\);/);
});

test('l’outil dit quoi faire, sur Réglages › Connexions, une seule fois', () => {
  for (const raison of ['connecte', 'refuse', 'etat', 'jeton', 'acces', 'code', 'echec']) {
    assert.match(app, new RegExp(`\\n  ${raison}: \\[`), raison);
  }
  const retour = app.slice(app.indexOf('function retourGmail('), app.indexOf('\n}\n', app.indexOf('function retourGmail(')));
  // Le paramètre quitte l'adresse : recharger ne répète pas le message.
  assert.match(retour, /for \(const cle of \['gmail', 't', 'detail'\]\) adresse\.searchParams\.delete\(cle\);\n\s+history\.replaceState\(/);
  // Une adresse gardée (raccourci, favori) ne rejoue pas un vieux message.
  assert.match(retour, /if \(!quand \|\| Math\.abs\(Date\.now\(\) - quand\) > RETOUR_GMAIL_FRAIS_MS\) return;/);
  assert.match(retour, /setView\('settings'\);\n\s+document\.querySelector\('\[data-reg="connexions"\]'\)\?\.click\(\);/);
  // Le temps de lire une phrase entière.
  assert.match(retour, /toast\(echec && detail \? `\$\{message\} \(\$\{detail\}\)` : message, echec, echec \? 10_000 : 4000\);/);
  assert.match(app, /setView\(vueDeLAdresse\(\)\);\n\s+retourGmail\(\);/);
});

test('au téléphone, un seul rond par ligne : la case de sélection', () => {
  assert.match(css, /@media \(max-width: 760px\) \{\n(?:\s+\/\*[^*]*(?:\*(?!\/)[^*]*)*\*\/\n)?\s+\.qread\.lu \{ display: none; \}\n\}/);
  // Le cercle creux ne s'affiche plus en permanence au doigt ; il reste au
  // survol, sur ordinateur.
  assert.doesNotMatch(css, /la pastille reste visible\.\s*\*\/\n\s+\.qread\.lu \{ opacity: 1; \}/);
});

test('un échec Google dit sa cause : code rejoué, cases non cochées, ou code court', async () => {
  const { adresseRetourGmail, lectureAccordee, raisonEchecGoogle } = await import('../src/routes/auth.google.ts');
  assert.equal(adresseRetourGmail('echec', 'HTTP 500', 1_700_000_000_000), '/dashboard?gmail=echec&t=1700000000000&detail=HTTP+500');
  // Le détail ne transporte rien d'autre qu'un code lisible.
  assert.equal(adresseRetourGmail('echec', '<script>', 1), '/dashboard?gmail=echec&t=1&detail=script');
  assert.equal(adresseRetourGmail('connecte', null, 1), '/dashboard?gmail=connecte&t=1');

  assert.deepEqual(raisonEchecGoogle({ response: { status: 400, data: { error: 'invalid_grant' } } }), { raison: 'code', detail: 'invalid_grant' });
  assert.deepEqual(raisonEchecGoogle({ code: 403, message: 'Request had insufficient authentication scopes.' }), { raison: 'acces', detail: 'HTTP 403' });
  assert.deepEqual(raisonEchecGoogle({ response: { status: 500, data: {} } }), { raison: 'echec', detail: 'HTTP 500' });
  assert.deepEqual(raisonEchecGoogle(new Error('socket hang up')), { raison: 'echec', detail: null });

  assert.equal(lectureAccordee('openid https://www.googleapis.com/auth/gmail.modify'), true);
  assert.equal(lectureAccordee('https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send'), true);
  // Seul l'envoi coché : la boîte ne pourrait rien lire.
  assert.equal(lectureAccordee('https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.compose'), false);
});
