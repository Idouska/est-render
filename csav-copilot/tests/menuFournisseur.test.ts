import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

/*
 * Le menu de l'espace fournisseur parle comme celui du marchand.
 *
 * « Tickets » mêlait tout ce que le marchand demande, trié par un menu
 * « Type ». Il y a maintenant Update, Modification et Annulation, chacune
 * avec sa pastille — les mêmes mots des deux côtés.
 */
const lire = (f: string) => readFileSync(new URL(`../public/${f}`, import.meta.url), 'utf8');
const js = lire('workspace.js');
const html = lire('workspace.html');
const i18n = lire('workspace.i18n.js');

const bloc = js.slice(js.indexOf('const FAMILLES_TICKETS = {'), js.indexOf('/** La pastille de chaque famille'));
const familleDuTicket = new Function(`${bloc}; return familleDuTicket;`)() as (t: string) => string | null;

test('chaque demande tombe dans une seule famille', () => {
  for (const t of ['UPD:TRACKING', 'UPD:DELAY', 'UPD:MISSING_ITEM']) assert.equal(familleDuTicket(t), 'update');
  for (const t of ['UPD:CANCEL', 'UPD:HOLD']) assert.equal(familleDuTicket(t), 'annulation');
  for (const t of ['UPD:ADDRESS', 'UPD:PHONE', 'UPD:SIZE', 'UPD:PRODUCT', 'UPD:COLOR', 'UPD:OTHER']) assert.equal(familleDuTicket(t), 'modification');
  // Les ruptures ont leur écran : elles ne sont dans aucune des trois.
  assert.equal(familleDuTicket('RUPTURE'), null);
  assert.equal(familleDuTicket('SIGNAL'), null);
});

test('trois entrées au menu, chacune avec sa pastille, dans les trois langues', () => {
  for (const famille of ['update', 'modification', 'annulation']) {
    assert.match(html, new RegExp(`data-view="tickets" data-famille="${famille}"`));
    assert.match(html, new RegExp(`id="ws-fam-${famille}"`));
    assert.equal((i18n.match(new RegExp(`'nav\\.${famille}':`, 'g')) ?? []).length, 3, famille);
  }
  // Les mots du marchand.
  assert.match(i18n, /'nav\.orders': 'Commandes du jour',/);
  assert.match(i18n, /'nav\.ruptures': 'Out of stock',/);
  assert.match(i18n, /'nav\.echanges': 'Retour',/);
});

test('sans famille (depuis l’accueil), la liste montre tout, ruptures comprises', () => {
  assert.match(js, /const items = famille \? state\.tk\.items\.filter\(\(item\) => familleDuTicket\(item\.type\) === famille\) : state\.tk\.items;/);
  assert.match(js, /\/\/ Depuis l'accueil : tous les tickets, pas une seule famille\.\n\s+state\.tk\.famille = null;/);
});

test('les pastilles se relèvent sans toucher à l’écran ouvert', () => {
  const releve = js.slice(js.indexOf('async function releverFamilles('), js.indexOf('\n}\n', js.indexOf('async function releverFamilles(')));
  assert.match(releve, /\/updates`\)\.catch\(\(\) => null\)/);
  assert.doesNotMatch(releve, /hidden = true|innerHTML/);
});

test('les ruptures auxquelles le client a répondu s’affichent dans Commandes du jour', () => {
  assert.match(html, /<div id="ws-ruptures-rep" hidden><\/div>/);
  assert.match(js, /bandeRupturesARepondre\(mes \?\? \[\]\);\n\s+if \(state\.view !== 'rupture'\) return;/);
  assert.match(js, /if \(event\.target\.closest\('\[data-voir-ruptures\]'\)\) setView\('rupture'\);/);
  // Le bouton d'envoi dit à qui cela part : au client de l'atelier.
  assert.match(i18n, /'oos\.send': 'Envoyer au client',/);
  assert.equal((i18n.match(/'oos\.toAnswer':/g) ?? []).length, 3);
});
