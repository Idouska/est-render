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
  assert.match(i18n, /'oos\.send': 'Envoyer \{aBoutique\}',/);
  assert.equal((i18n.match(/'oos\.toAnswer':/g) ?? []).length, 3);
});

test('les phrases nomment la boutique, et disent « votre client » tant qu’on ne la connaît pas', async () => {
  const m = await import('../public/workspace.i18n.js');
  m.setBoutique('Kairo');
  assert.equal(m.translator('fr')('oos.send'), 'Envoyer à Kairo');
  assert.equal(m.translator('fr')('oos.waiting'), 'En attente de Kairo');
  assert.equal(m.translator('en')('oos.merchantSays'), 'Kairo’s reply');
  assert.equal(m.translator('zh')('oos.send'), '发送给Kairo');
  // L'élision devant une voyelle.
  m.setBoutique('Atlasya');
  assert.equal(m.translator('fr')('oos.waiting'), 'En attente d’Atlasya');
  m.setBoutique(null);
  assert.equal(m.translator('fr')('oos.send'), 'Envoyer à votre client');
  assert.equal(m.translator('en')('oos.send'), 'Send to your client');
  // Plus aucune phrase ne dit « le marchand », dans aucune langue.
  const valeurs = i18n.split('\n').filter((l) => /^\s+'[\w.]+':/.test(l)).map((l) => l.slice(l.indexOf(':') + 1));
  assert.deepEqual(valeurs.filter((v) => /marchand|merchant|商家/i.test(v)), []);
  // Et le serveur envoie le nom avec les commandes.
  const routes = readFileSync(new URL('../src/routes/supplierWorkspace.ts', import.meta.url), 'utf8');
  assert.match(routes, /boutique: supplier\.merchant\?\.brandName\?\.trim\(\) \|\| supplier\.merchant\?\.name\?\.trim\(\) \|\| null,/);
});

test('le transporteur se reconnaît à la forme du numéro, sans deviner dans le doute', () => {
  const bloc = js.slice(js.indexOf('const FORMES_SUIVI = ['), js.indexOf('/** Pose le transporteur reconnu'));
  const deviner = new Function(`${bloc}; return devinerTransporteur;`)() as (n: string) => string | null;
  assert.equal(deviner('1Z999AA10123456784'), 'UPS');
  assert.equal(deviner('6a 12345678901'), 'Colissimo');
  assert.equal(deviner('LA123456789FR'), 'La Poste');
  assert.equal(deviner('YT2610272259305500'), 'YunExpress');
  // Douze chiffres peuvent être de trois transporteurs : on ne devine pas.
  assert.equal(deviner('123456789012'), null);
  assert.equal(deviner(''), null);
  // Après un envoi, au clavier, la commande suivante reçoit le curseur.
  assert.match(js, /if \(dernier && !auDoigt\.matches\) \{\n\s+document\.querySelector\('#ws-orders \[data-cs\]:not\(\.cs-faite\) \[data-cs-suivi\]'\)\?\.focus\(\);/);
});

test('dans une famille, une demande par bloc, ce qui attend une réponse d’abord', () => {
  assert.match(js, /const rangPile = \{ A_REPONDRE: 0, ATTENTE: 1, CLOS: 2 \};/);
  assert.match(js, /<article class="tk-detail tk-bloc">\$\{enteteDeTicket\(item\)\}\$\{item\.html\}<\/article>/);
});

test('au téléphone, « Plus » range quatre entrées et additionne leurs pastilles sans boucler', () => {
  assert.equal((html.match(/class="wsnav-second"/g) ?? []).length, 4);
  assert.match(html, /id="ws-nav-plus"/);
  assert.equal((i18n.match(/'nav\.more':/g) ?? []).length, 3);
  // La pastille est dans le menu observé : elle ne s'écrit que si elle change.
  assert.match(js, /if \(badge\.textContent !== String\(total\)\) badge\.textContent = String\(total\);/);
});

test('les demandes de la boutique sont traduites pour l’atelier, l’original restant lisible', () => {
  const suppliers = readFileSync(new URL('../src/routes/suppliers.ts', import.meta.url), 'utf8');
  // Après coup : la boutique n'attend pas la traduction, et un échec laisse l'original.
  assert.match(suppliers, /void traduireDuFrancais\(alert\.message\)\s+\.then\(\(traduit\) =>\s+prisma\.supplierAlert\.update\(\{ where: \{ id: alert\.id \}, data: \{ messageTraduit: \{ en: traduit\.en, zh: traduit\.zh \} \} \}\),/);
  assert.match(readFileSync(new URL('../prisma/schema.prisma', import.meta.url), 'utf8'), /\n  messageTraduit Json\?\n/);
  const bloc = js.slice(js.indexOf('function messageTraduitDe('), js.indexOf('async function loadAlerts('));
  assert.match(bloc, /state\.lang === 'fr' \? demande\.message : \(demande\.messageTraduit\?\.\[state\.lang\] \?\? demande\.message\)/);
  assert.match(js, /class="upd-msg-vo"/);
});

test('« Touchez » au doigt, « Cliquez » à la souris', () => {
  assert.match(js, /t\(auDoigt\.matches \? 'oos\.step2' : 'oos\.step2Mouse'\)/);
  assert.equal((i18n.match(/'oos\.step2Mouse':/g) ?? []).length, 3);
});
