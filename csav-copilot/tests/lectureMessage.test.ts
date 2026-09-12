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
  //
  // Une ÉCRITURE est un autre sujet : remettre un message en non lu doit
  // justement poser ce champ. On ne regarde donc que les `gmailUnread: true`
  // qui ne sont pas dans un `data: { … }`.
  const solitaires = [...routes.matchAll(/gmailUnread: true/g)]
    .filter((occurrence) => !routes.slice(Math.max(0, occurrence.index - 80), occurrence.index).includes('data: {'))
    .map((occurrence) => routes.slice(occurrence.index - 30, occurrence.index + 20).trim());

  assert.deepEqual(
    solitaires,
    [],
    'un `gmailUnread: true` isolé compterait comme non lu un message déjà ' +
      'ouvert dans l’outil : utiliser NON_LU.',
  );
  assert.ok(routes.includes('...NON_LU'), 'les compteurs doivent étaler NON_LU');
});

/* ---- remettre en non lu ---- */

test('« non lu » repose les DEUX conditions, sinon rien ne change à l’écran', () => {
  // `NON_LU` demande les deux : effacer la seule date d'ouverture laisserait
  // lu un fil que Gmail dit lu, et le clic n'aurait aucun effet visible.
  const action = routes.slice(routes.indexOf("case 'unread':"));
  const ecriture = action.indexOf('data: {');
  assert.ok(ecriture > 0, 'l’écriture doit exister');
  assert.match(action.slice(ecriture, ecriture + 120), /openedAt: null/);
  assert.match(action.slice(ecriture, ecriture + 120), /gmailUnread: true/);
});

test('lire ou dé-lire ne laisse pas de trace au journal', () => {
  // Même raison que l'ouverture d'un message : ce n'est pas une action sur le
  // dossier, et une ligne par clic noierait les remboursements et les envois
  // sous des milliers d'entrées sans objet.
  const bulk = routes.slice(routes.indexOf("app.post('/api/tickets/bulk'"));
  const garde = bulk.indexOf("action !== 'read' && action !== 'unread'");
  const journal = bulk.indexOf('recordAudit');
  assert.ok(garde > 0, 'la garde doit exister');
  assert.ok(journal > 0, 'le journal existe bien pour les autres actions');
  assert.ok(garde < journal, 'et la garde doit le précéder');
});

test('« lu » ne réécrit pas la date de première ouverture', () => {
  // `openedAt` répond à « quand l'a-t-on vu pour la première fois ». L'écraser
  // à chaque clic lui ferait dire « la dernière fois », ce que personne ne
  // demande et qui se remarquerait trop tard.
  const action = routes.slice(routes.indexOf("case 'read':"), routes.indexOf("case 'unread':"));
  assert.match(action, /where: \{ \.\.\.scope, openedAt: null \}/, 'seuls les fils jamais ouverts sont datés');
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

/* ---- la pastille de la file ---- */

const bascule = app.slice(app.indexOf('async function basculerLecture('), app.indexOf('const prefetched = new Map()'));

test('la pastille est posée à côté du bouton de la ligne, jamais dedans', () => {
  // Dedans, le clic serait avalé par l'ouverture du message — qui le
  // marquerait lu dans la foulée, annulant ce qu'on vient de demander. Et un
  // bouton dans un bouton n'est pas du HTML valide.
  //
  // Le gabarit de la ligne va de `<li class="qrow` au contenu du bouton : la
  // pastille doit s'y trouver AVANT l'ouverture de `.queue-item`, donc en
  // dehors de lui.
  const ligne = app.slice(app.indexOf('<li class="qrow'), app.indexOf('<span class="qav"'));
  const pastille = ligne.indexOf('data-read=');
  const bouton = ligne.indexOf('class="queue-item');
  assert.ok(pastille > 0, 'la pastille doit exister');
  assert.ok(bouton > 0, 'le bouton de la ligne aussi');
  assert.ok(pastille < bouton, 'la pastille précède le bouton, elle n’est donc pas dedans');
  assert.match(app, /basculerLecture\(pastille\.dataset\.read, pastille\)/);
});

test('le clic bascule dans les deux sens', () => {
  assert.match(bascule, /versLu \? 'read' : 'unread'/);
  assert.match(bascule, /action: versLu/);
});

test('l’écran suit la même règle que le serveur : la date ET le libellé', () => {
  assert.match(bascule, /enFile\.openedAt = lu \? new Date\(\)\.toISOString\(\) : null/);
  assert.match(bascule, /if \(!lu\) enFile\.gmailUnread = true/);
});

test('un refus du serveur remet la pastille comme elle était', () => {
  const rattrapage = bascule.slice(bascule.indexOf('catch'));
  assert.match(rattrapage, /appliquer\(etait\)/, 'sans quoi l’écran mentirait sur l’état réel');
  assert.match(rattrapage, /toast\(/);
});

test('la file n’est pas rechargée : le message ne doit pas fuir sous le doigt', () => {
  // Sous le filtre « Non lu », recharger ferait disparaître la ligne au moment
  // même où on la marque lue, et la suivante prendrait sa place sous le
  // curseur — on ouvrirait une autre sans l'avoir voulu.
  assert.ok(!bascule.includes('loadQueue('), 'seul le compteur est ajusté');
  assert.match(bascule, /state\.queueCounts\.UNREAD/);
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
