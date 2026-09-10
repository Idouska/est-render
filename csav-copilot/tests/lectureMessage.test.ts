import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { NON_LU, PORTEE_NON_LU } from '../src/services/gmail/unreadScope.ts';

/*
 * Ce qui éteint le gras d'un message dans la file.
 *
 * CE QUE CES TESTS PROTÈGENT. Cliquer sur un message ne l'éteignait jamais.
 * La raison n'était pas un oubli d'affichage mais une contrainte de
 * périmètre : le gras suivait `gmailUnread`, c'est-à-dire le libellé `UNREAD`
 * du fil chez Google — et l'outil n'a que `gmail.readonly`. Il ne peut pas
 * retirer ce libellé. Le message restait donc en gras jusqu'à ce que
 * quelqu'un l'ouvre DANS Gmail, ce qui n'arrive pas quand on travaille ici.
 *
 * D'où `openedAt`, une colonne à nous. Deux pièges l'entourent :
 *
 *   1. La règle « lu » vit à quatre endroits — le gras, la pastille « Non
 *      lus », « En attente de vous », et le filtre de la file. Écrite
 *      plusieurs fois, elle diverge, et l'on voit un message en gras que la
 *      pastille ne compte pas. Cela se lit comme un compteur cassé, pas comme
 *      une règle incohérente : personne ne cherche au bon endroit.
 *
 *   2. La fiche d'un ticket est préfetchée AU SURVOL. Marquer lu depuis le
 *      GET éteindrait tout ce que le curseur effleure en descendant la liste.
 *      C'est le clic qu'on enregistre, pas le passage — d'où une route POST
 *      dédiée, que le préfetch n'appelle pas.
 */

const lire = (chemin: string) =>
  readFileSync(fileURLToPath(new URL(`../${chemin}`, import.meta.url)), 'utf8');

const app = lire('public/app.js');
const routes = lire('src/routes/tickets.ts');

test('« non lu » exige les deux conditions, pas une seule', () => {
  assert.equal(NON_LU.gmailUnread, true, 'le fil porte encore le libellé Gmail');
  assert.equal(
    NON_LU.openedAt,
    null,
    'et personne ne l’a ouvert ici — sans quoi le gras ne s’éteindrait jamais, ' +
      'l’outil n’ayant pas le droit de retirer le libellé chez Google',
  );
});

test('la portée du compteur exclut toujours l’historique et les clos', () => {
  // Ces deux conditions sont indépendantes de la lecture et ne doivent pas se
  // faire absorber : un fil importé n'est pas à traiter, et rouvrir une
  // archive jamais marquée lue la ferait remonter dans le compte pour rien.
  assert.equal(PORTEE_NON_LU.isHistorical, false);
  assert.deepEqual(PORTEE_NON_LU.status, { notIn: ['CLOSED', 'AUTO_SENT'] });
});

test('les trois compteurs du serveur partagent la même définition', () => {
  // Trois lectures : le filtre « non lus » de la file, la pastille du rail, et
  // « En attente de vous ». Aucune ne doit tester `gmailUnread` toute seule.
  const solitaires = routes.match(/gmailUnread: true/g) ?? [];

  assert.deepEqual(
    solitaires,
    [],
    'un `gmailUnread: true` isolé compterait comme non lu un message déjà ' +
      'ouvert dans l’outil : utiliser NON_LU.',
  );
  assert.ok(routes.includes('...NON_LU'), 'les compteurs doivent étaler NON_LU');
});

/* ---- côté navigateur ---- */

const estLu = new Function(`${(() => {
  const i = app.indexOf('function estLu');
  return app.slice(i, app.indexOf('\n}', i) + 2);
})()} return estLu;`)() as (ticket: { gmailUnread?: boolean; openedAt?: string | null }) => boolean;

test('un message ouvert dans l’outil est lu, même s’il reste non lu chez Gmail', () => {
  assert.equal(
    estLu({ gmailUnread: true, openedAt: '2026-09-10T09:00:00.000Z' }),
    true,
    'c’est le cas normal : l’outil ne peut pas retirer le libellé Gmail',
  );
});

test('un message lu dans Gmail est lu, même jamais ouvert ici', () => {
  assert.equal(estLu({ gmailUnread: false, openedAt: null }), true);
});

test('un message que personne n’a vu reste en gras', () => {
  assert.equal(estLu({ gmailUnread: true, openedAt: null }), false);
});

test('un champ absent ne se lit pas comme « lu »', () => {
  // Si `openedAt` manquait du `select`, il arriverait `undefined`. Le traiter
  // comme une date éteindrait le gras de toute la file d'un coup.
  assert.equal(estLu({ gmailUnread: true }), false);
  assert.equal(estLu({ gmailUnread: true, openedAt: null }), false);
});

test('le clic marque l’ouverture, le survol ne la marque pas', () => {
  // Le préfetch appelle GET /api/tickets/:id au survol. Si l'écriture vivait
  // là, descendre la liste au curseur éteindrait tout sur son passage.
  assert.ok(
    app.includes("api(`/api/tickets/${id}/ouvert`, { method: 'POST'"),
    'l’ouverture doit passer par une route POST dédiée',
  );

  // Les commentaires sont retirés avant l'examen : ce dépôt est écrit en
  // prose française dense, et « un ticket rouvert dix minutes plus tard »
  // contient le mot qu'on cherche. Une fausse alerte coûte la même attention
  // qu'une vraie.
  const prefetch = (() => {
    const i = app.indexOf('function prefetchTicket');
    return app.slice(i, app.indexOf('\n}', i) + 2);
  })().replace(/\/\/[^\n]*/g, '');

  assert.equal(
    /\/ouvert`|method: 'POST'/.test(prefetch),
    false,
    'le préfetch ne doit appeler que le GET : marquer lu depuis le survol ' +
      'éteindrait tout ce que le curseur effleure en descendant la liste',
  );
  assert.match(prefetch, /api\(`\/api\/tickets\/\$\{id\}`\)/, 'il précharge bien la fiche');
});

test('la route d’ouverture ne repousse pas la première date', () => {
  const route = routes.slice(routes.indexOf("'/api/tickets/:id/ouvert'"));
  assert.match(
    route,
    /if \(ticket\.openedAt !== null\) return reply\.send/,
    'revenir sur un message ne doit pas réécrire la date : elle dit la ' +
      'PREMIÈRE ouverture, pas la dernière visite',
  );
});

test('une consultation en lecture seule n’éteint rien', () => {
  // Le ticket d'une autre boutique se consulte mais ne se traite pas :
  // l'éteindre chez son équipe serait décider à sa place.
  const marque = (() => {
    const i = app.indexOf('async function marqueOuvert');
    return app.slice(i, app.indexOf('\n}', i) + 2);
  })();

  assert.match(marque, /if \(detail\.readOnly \|\| estLu\(detail\.ticket\)\) return;/);
});
