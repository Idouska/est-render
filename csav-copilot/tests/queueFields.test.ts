import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  QUEUE_FIELDS_USED_BY_DASHBOARD,
  QUEUE_SELECT,
} from '../src/routes/queueFields.ts';

/*
 * Le bug que ces tests interdisent de refaire.
 *
 * La colonne `gmailUnread` a été ajoutée au schéma, écrite par l'ingestion,
 * lue par le dashboard — et oubliée dans le `select` de la file. Le navigateur
 * recevait `undefined`, la comparaison rendait toujours le même résultat, et le
 * gras de la file ne s'éteignait jamais. Aucune erreur, aucun test rouge :
 * juste un écran qui a l'air de fonctionner et qui ne trie rien.
 *
 * Un `select` explicite est un contrat entre deux fichiers que rien ne relie.
 * Ces tests sont ce lien.
 */

test('la file sert tout ce que le dashboard lit sur une ligne', () => {
  const served = new Set(Object.keys(QUEUE_SELECT));
  const missing = QUEUE_FIELDS_USED_BY_DASHBOARD.filter((field) => !served.has(field));

  assert.deepEqual(
    missing,
    [],
    `Champs lus par le dashboard mais absents du select : ${missing.join(', ')}`,
  );
});

test('l’état Gmail du fil voyage jusqu’au navigateur', () => {
  // Nommés un par un plutôt que couverts par le test précédent : ce sont ceux
  // qui ont manqué, et une liste générique ne dirait pas pourquoi ils comptent.
  assert.equal(QUEUE_SELECT.gmailUnread, true);
  assert.equal(QUEUE_SELECT.gmailArchived, true);
});

test('l’ouverture dans l’outil voyage aussi', () => {
  // `gmailUnread` ne s'éteint que si quelqu'un ouvre le message DANS Gmail :
  // l'outil n'a que `gmail.readonly` et ne peut pas retirer le libellé. C'est
  // donc `openedAt` — et lui seul — qui éteint le gras au clic. Absent du
  // `select`, il arrive `undefined`, `estLu` rend toujours faux, et cliquer
  // sur un message ne change rien. Exactement le défaut qui a valu ce fichier.
  assert.equal(QUEUE_SELECT.openedAt, true);
});

test('un champ servi sans être demandé reste possible', () => {
  // L'inverse n'est pas une erreur : la route peut servir plus que la file
  // n'affiche — le détail et les exports lisent la même réponse. Le test ne
  // doit donc pas exiger l'égalité, seulement l'inclusion.
  const served = Object.keys(QUEUE_SELECT);

  assert.ok(served.length >= QUEUE_FIELDS_USED_BY_DASHBOARD.length);
});
