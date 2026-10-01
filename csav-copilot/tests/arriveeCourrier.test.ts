import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { curseurApres } from '../src/services/gmail/curseur.ts';
import { ingestJobId } from '../src/queue/ids.ts';

/*
 * Le délai entre l'arrivée d'un mail dans Gmail et son apparition dans l'outil.
 *
 * CE QUE CES TESTS PROTÈGENT. Trois pièges, et chacun coûte des minutes au
 * marchand — ou un message perdu pour toujours.
 *
 * 1. LE CURSEUR QUI SAUTE. `history.list` rend, à côté des enregistrements,
 *    l'identifiant courant de la boîte. L'écrire comme nouveau curseur revient
 *    à déclarer lu tout ce qui s'est passé jusque-là, y compris ce que l'appel
 *    n'a pas rendu — l'historique Gmail n'étant pas instantanément complet. Le
 *    message passe alors SOUS le curseur et ne figure dans aucun historique
 *    suivant : la relève incrémentale ne le voit plus jamais.
 *
 * 2. L'INDEX DE RECHERCHE. Le rattrapage cherchait avec `q: newer_than:2d`.
 *    Une requête de recherche passe par l'index, qui met un moment à voir un
 *    message tout neuf : c'est ce qui faisait répondre « aucun nouveau
 *    message » à un clic donné dix secondes après l'arrivée du mail.
 *
 * 3. L'ÉCRAN QUI ATTEND. L'ouverture de l'outil ne relevait aucun courrier, et
 *    le tour automatique passait toutes les soixante secondes.
 */

const lire = (chemin: string) =>
  readFileSync(fileURLToPath(new URL(`../${chemin}`, import.meta.url)), 'utf8');
const sansCommentaires = (code: string) =>
  code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/[^\n]*/gm, '');

/* ---- 1. le curseur ---- */

test('le curseur ne va que jusqu’au dernier enregistrement lu', () => {
  assert.equal(curseurApres(['101', '104', '109'], false), '109');
});

test('rien lu, rien avancé — ce qui tarde sera lu au passage suivant', () => {
  // Le cas qui perdait des messages : l'historique ne rend encore rien, et on
  // posait quand même le curseur à « maintenant ».
  assert.equal(curseurApres([], false), null);
});

test('un lot tronqué laisse le curseur où il est', () => {
  // Le reliquat n'a pas été traité : l'avancer le ferait disparaître.
  assert.equal(curseurApres(['101', '104'], true), null);
});

test('le plus grand gagne, quel que soit l’ordre rendu', () => {
  assert.equal(curseurApres(['109', '101', '104'], false), '109');
});

test('les identifiants dépassent ce qu’un nombre ordinaire sait compter', () => {
  // Gmail rend des entiers de plus de quinze chiffres : comparés en `number`,
  // deux voisins deviennent égaux et le curseur recule d'un cran — donc
  // rejoue, indéfiniment, le même enregistrement.
  // Les deux retombent sur le MÊME `number` : 9007199254740992. Comparés
  // ainsi, le second n'est pas « plus grand », et le curseur reste sur le
  // premier — donc rejoue indéfiniment le même enregistrement.
  const bas = '9007199254740992';
  const haut = '9007199254740993';
  assert.equal(curseurApres([bas, haut], false), haut);
  assert.equal(curseurApres([haut, bas], false), haut);
});

test('un identifiant illisible est ignoré, il n’efface pas les autres', () => {
  assert.equal(curseurApres(['abc', '104'], false), '104');
  assert.equal(curseurApres(['abc'], false), null);
});

/* ---- le code qui s'en sert ---- */

const sync = sansCommentaires(lire('src/services/gmail/sync.ts'));

test('seul le premier branchement a le droit de regarder l’heure de la boîte', () => {
  const avance = sync.slice(sync.indexOf('const avance ='), sync.indexOf('const avance =') + 400);
  assert.match(avance, /suivaitLHistorique\s*\n?\s*\?\s*curseurApres\(/, 'en suivi, le curseur vient de ce qui a été lu');
  assert.match(avance, /getProfile/, 'et seulement sinon, de l’identifiant courant');
});

test('le curseur se nourrit des enregistrements, pas de l’identifiant courant', () => {
  assert.ok(
    !sync.includes('newHistoryId'),
    'l’ancien raccourci « identifiant courant = curseur » ne doit plus exister',
  );
  assert.match(sync, /if \(entry\.id\) lus\.push\(entry\.id\)/, 'chaque enregistrement lu est noté');
});

/* ---- 2. le filet ---- */

test('le filet lit la boîte par libellé, jamais par une requête de recherche', () => {
  const filet = sync.slice(sync.indexOf('async function listerInbox'));
  assert.match(filet.slice(0, 400), /labelIds: \['INBOX'\]/);
  assert.ok(
    !/async function listerInbox[\s\S]{0,400}q:/.test(filet),
    'une requête `q:` passerait par l’index de recherche, qui voit un message neuf trop tard',
  );
});

test('le filet tourne à chaque relève, et s’arrête au premier message déjà connu', () => {
  const corps = sync.slice(sync.indexOf('const dejaVus = new Set(messageIds)'));
  assert.match(corps.slice(0, 700), /listerInbox\(gmail, FILET_INBOX\)/);
  assert.match(corps.slice(0, 900), /if \(connu\) break/, 'au-dessus du premier connu se trouve ce qui est nouveau');
});

test('une panne du filet ne fait pas tomber la relève', () => {
  const corps = sync.slice(sync.indexOf('const dejaVus = new Set(messageIds)'));
  const garde = corps.indexOf('} catch (error) {');
  assert.ok(garde > 0 && garde < corps.indexOf('const truncated'), 'le filet est entouré d’un filet');
});

/* ---- la relance : Gmail ne prévient qu'une fois ---- */

test('une relance ne se confond pas avec la notification qu’elle rattrape', () => {
  // Même fenêtre de cinq secondes : sans le rang, la relance porterait le même
  // identifiant et BullMQ la jetterait comme doublon — précisément dans le cas
  // où elle est la seule chance de rattraper le message.
  const base = { merchantId: 'm1', mailboxId: 'b1' };
  assert.notEqual(ingestJobId(base, 7), ingestJobId({ ...base, relance: 1 }, 7));
  assert.notEqual(ingestJobId({ ...base, relance: 1 }, 7), ingestJobId({ ...base, relance: 2 }, 7));
  assert.equal(ingestJobId(base, 7), ingestJobId({ ...base, relance: 0 }, 7), 'rang nul = pas de relance');
});

test('la relance ne part que bredouille, et pas indéfiniment', () => {
  const worker = sansCommentaires(lire('src/worker.ts'));
  const bloc = worker.slice(worker.indexOf('QUEUE_INGEST'), worker.indexOf('const ticketWorker'));
  assert.match(bloc, /ingested === 0 && rang < RELANCES_MAX/, 'une relève qui a trouvé ne se relance pas');
  assert.match(bloc, /relance: rang \+ 1/, 'et le rang monte, sinon la borne ne sert à rien');
  assert.match(bloc, /delay: RELANCE_APRES_MS/, 'différée : relancer tout de suite relirait le même vide');
  assert.match(worker, /const RELANCES_MAX = 2;/);
});

/* ---- 3. l'écran ---- */

const app = lire('public/app.js');

test('ouvrir l’outil relève le courrier', () => {
  // Sans cela, on ouvre l'outil sur l'état d'avant et il faut attendre le
  // premier tour automatique pour voir ce qui est arrivé entre-temps.
  const boot = app.slice(app.indexOf('async function boot('), app.indexOf('boot();'));
  assert.match(boot, /pullMail\(/, 'la relève doit partir à l’ouverture');
});
