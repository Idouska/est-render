import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { delaisResolution } from '../src/services/tickets/resolution.ts';

/*
 * Le délai de résolution : du premier message du client à la dernière réponse.
 *
 * CE QUE CES TESTS PROTÈGENT. C'est un chiffre que personne ne peut vérifier à
 * l'œil : « 4 h 12 » a exactement l'air d'une mesure, qu'elle soit juste ou
 * fausse d'un facteur trois. Un délai faux ne se signale pas — il se cite en
 * réunion, il sert à décider d'embaucher ou non.
 *
 * Trois façons de se tromper, toutes silencieuses :
 *
 *   1. Compter zéro ce qu'on n'a pas pu mesurer. Un ticket clos sans réponse
 *      envoyée n'a pas été résolu en zéro minute : il n'a pas été mesuré. Le
 *      confondre écrase la médiane vers le bas et flatte l'équipe.
 *
 *   2. Prendre l'élément du milieu pour la médiane sur un effectif pair. Sur
 *      dix minutes et quatre heures, cela annonce quatre heures — soit le pire
 *      des deux dossiers présenté comme le cas typique.
 *
 *   3. Laisser passer un écart négatif. Un fil importé dont l'ordre s'est
 *      perdu donne une « réponse » antérieure à la question ; comptée, elle
 *      tire la médiane vers le bas sans que rien ne le dise.
 */

const T0 = new Date('2026-03-01T09:00:00Z');
const apres = (minutes: number) => new Date(T0.getTime() + minutes * 60000);

const entrant = (ticketId: string) => ({ ticketId, _min: { receivedAt: T0 } });
const sortant = (ticketId: string, minutes: number) => ({
  ticketId,
  _max: { receivedAt: apres(minutes) },
});

test('la médiane est le milieu des durées, pas la dernière', () => {
  const bilan = delaisResolution(
    ['a', 'b', 'c'].map(entrant),
    [sortant('a', 30), sortant('b', 90), sortant('c', 600)],
    3,
  );

  assert.equal(bilan.medianMinutes, 90);
  assert.equal(bilan.averageMinutes, 240);
  assert.equal(bilan.measured, 3);
});

test('sur un effectif pair, la médiane est la moyenne des deux valeurs centrales', () => {
  // Prendre l'élément du milieu annoncerait 240 : le pire des deux dossiers
  // présenté comme le cas typique.
  const bilan = delaisResolution(
    ['a', 'b'].map(entrant),
    [sortant('a', 10), sortant('b', 240)],
    2,
  );

  assert.equal(bilan.medianMinutes, 125);
});

test('un ticket clos sans réponse envoyée est exclu, pas compté zéro', () => {
  // Trois tickets clos, un seul mesurable : le compter zéro donnerait une
  // médiane de zéro minute — « résolu instantanément » — au lieu de dire que
  // la mesure ne porte que sur un dossier.
  const bilan = delaisResolution(
    ['a', 'b', 'c'].map(entrant),
    [sortant('a', 120)],
    3,
  );

  assert.equal(bilan.medianMinutes, 120);
  assert.equal(bilan.measured, 1, 'un seul dossier mesuré');
  assert.equal(bilan.resolved, 3, 'sur trois réellement clos');
});

test('une réponse antérieure à la question ne compte pas', () => {
  const bilan = delaisResolution(
    ['a', 'b'].map(entrant),
    [sortant('a', -45), sortant('b', 60)],
    2,
  );

  assert.equal(bilan.measured, 1);
  assert.equal(bilan.medianMinutes, 60);
});

test('sans rien à mesurer, aucune durée n’est inventée', () => {
  const vide = delaisResolution([], [], 0);
  assert.equal(
    vide.medianMinutes,
    null,
    'zéro se lirait « résolu instantanément », l’inverse de « rien mesuré »',
  );
  assert.equal(vide.averageMinutes, null);
  assert.equal(vide.measured, 0);
});

test('une réponse sans message entrant correspondant est ignorée', () => {
  // Sans borne de départ, il n'y a pas de durée. La compter depuis une date
  // par défaut fabriquerait un délai qui n'a jamais existé.
  const bilan = delaisResolution([entrant('a')], [sortant('a', 60), sortant('orphelin', 30)], 2);
  assert.equal(bilan.measured, 1);
});

/* ---- l'infobulle, prise dans le fichier réellement servi ---- */

const APP = fileURLToPath(new URL('../public/app.js', import.meta.url));
const source = readFileSync(APP, 'utf8');

function extraire(debut: string, fin = '\n}'): string {
  const i = source.indexOf(debut);
  assert.ok(i >= 0, `introuvable dans public/app.js : ${debut}`);
  const j = source.indexOf(fin, i);
  assert.ok(j >= 0, `fin introuvable après ${debut}`);
  return source.slice(i, j + fin.length);
}

const aide = new Function(
  `${extraire('function duration')}
   ${extraire('function aideResolution')}
   return aideResolution;`,
)() as (resolution: unknown) => string;

test('l’infobulle dit d’où à où court la mesure', () => {
  const texte = aide({ medianMinutes: 90, averageMinutes: 240, measured: 3, resolved: 3 });
  assert.match(texte, /premier message du client à la dernière réponse partie/);
});

test('l’infobulle annonce l’angle mort quand il y en a un', () => {
  const texte = aide({ medianMinutes: 90, averageMinutes: 240, measured: 34, resolved: 41 });

  assert.match(texte, /34 des 41/);
  assert.match(texte, /7 autres ont été clos sans réponse envoyée/);
});

test('l’infobulle n’invente pas d’angle mort quand tout est mesuré', () => {
  const texte = aide({ medianMinutes: 90, averageMinutes: 240, measured: 12, resolved: 12 });
  assert.equal(
    /sans réponse envoyée/.test(texte),
    false,
    'annoncer un angle mort inexistant ferait douter d’un chiffre complet',
  );
});

test('l’infobulle accorde son singulier sur un seul ticket écarté', () => {
  const texte = aide({ medianMinutes: 90, averageMinutes: 90, measured: 5, resolved: 6 });
  assert.match(texte, /1 autre a été clos sans réponse envoyée/);
  assert.equal(/autres ont/.test(texte), false);
});

test('l’infobulle distingue « rien à mesurer » de « rien à résoudre »', () => {
  assert.match(
    aide({ medianMinutes: null, averageMinutes: null, measured: 0, resolved: 8 }),
    /Aucun des 8 tickets résolus/,
    'huit dossiers clos sans trace mesurable, ce n’est pas « aucun dossier »',
  );
  assert.match(
    aide({ medianMinutes: null, averageMinutes: null, measured: 0, resolved: 0 }),
    /Aucun ticket résolu sur la période/,
  );
  assert.match(aide(null), /indisponible/i);
});
