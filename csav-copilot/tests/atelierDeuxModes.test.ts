import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { LANGS, STRINGS } from '../public/workspace.i18n.js';

/*
 * L'atelier : deux modes de traitement, et un guichet lisible.
 *
 * CE QUE CES TESTS PROTÈGENT. Le traitement en masse n'existait pas, et le
 * traitement une par une ne se présentait pas comme un choix. Mais le vrai
 * danger est ailleurs : l'import en masse EXPÉDIE des commandes, et Shopify
 * écrit alors à chaque client. Les garde-fous qui l'entourent ne se voient
 * pas quand ils manquent — un aperçu périmé qu'on peut confirmer, un
 * enregistrement qui croit ce que le navigateur lui renvoie — et chacun
 * coûte un mail parti vers un client.
 *
 * Commentaires retirés avant chaque recherche : ce dépôt est écrit en prose,
 * et un test qui trouve son motif dans le commentaire qui l'explique passe
 * en lisant sa propre justification.
 */

const lire = (chemin: string) =>
  readFileSync(fileURLToPath(new URL(`../${chemin}`, import.meta.url)), 'utf8');
const sansCommentaires = (code: string) =>
  code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '').replace(/<!--[\s\S]*?-->/g, '');

const js = sansCommentaires(lire('public/workspace.js'));
const html = sansCommentaires(lire('public/workspace.html'));
const route = sansCommentaires(lire('src/routes/supplierWorkspace.ts'));

const bloc = (source: string, debut: string) => {
  const i = source.indexOf(debut);
  assert.ok(i >= 0, `introuvable : ${debut}`);
  return source.slice(i, source.indexOf('\n}', i) + 2);
};

/* ---- les deux modes se voient ---- */

test('les deux modes sont proposés, le guichet par défaut', () => {
  assert.match(html, /data-mode="manuel" aria-selected="true"/);
  assert.match(html, /data-mode="masse" aria-selected="false"/);
  assert.match(js, /mode: 'manuel',/);
});

test('l’import propose la même feuille que l’export, pour la même période', () => {
  assert.match(js, /\$\('bulk-xlsx'\)\.href = \$\('ws-xlsx'\)\.href;/);
});

/* ---- les garde-fous de l'import ---- */

test('modifier le collage efface l’aperçu', () => {
  /*
   * Sinon on confirmerait un aperçu qui ne correspond plus au texte affiché.
   *
   * Le gestionnaire est EXÉCUTÉ, pas seulement lu : une première version de
   * ce test vérifiait que le code contenait l'effacement, et une mutation l'a
   * enfermé dans un `if (false)` sans que rien ne rougisse. Présent n'est pas
   * atteint.
   */
  const debut = "$('bulk-texte')?.addEventListener('input', ";
  const i = js.indexOf(debut);
  assert.ok(i >= 0, 'écoute de la zone de collage introuvable');
  const fleche = js.slice(i + debut.length, js.indexOf('\n});', i) + 2);

  const zone = { innerHTML: '<table>aperçu</table>' };
  const state = { lot: { texte: 'ancien', plan: {} } };
  let note: string | null = '« commandes.xlsx » lu';
  new Function('state', '$', 'noteLot', `(${fleche})();`)(state, () => zone, (texte: string) => {
    note = texte;
  });

  assert.equal(state.lot, null, 'l’aperçu périmé doit être oublié');
  assert.equal(zone.innerHTML, '', 'et retiré de l’écran, bouton compris');
  assert.equal(note, '', 'la note du fichier précédent ne décrit plus le texte affiché');
});

test('l’enregistrement renvoie le TEXTE, jamais l’aperçu', () => {
  // Le serveur refait le calcul : il ne doit pas croire le navigateur.
  const enregistrer = bloc(js, 'async function enregistrerLot');
  assert.match(enregistrer, /body: \{ texte: state\.lot\.texte, apercu: false \}/);
  assert.equal(/plan\s*[,}]/.test(enregistrer.slice(enregistrer.indexOf('body:'), enregistrer.indexOf('body:') + 80)), false);
});

test('le serveur recalcule le plan à l’enregistrement', () => {
  const lot = route.slice(route.indexOf("'/api/workspace/:id/parcels/lot'"));
  const corps = lot.slice(0, lot.indexOf("'/api/workspace/:id/alerts'"));

  // Un seul calcul, avant la bifurcation aperçu / enregistrement.
  assert.ok(
    corps.indexOf('planifierLot(') < corps.indexOf('if (parsed.data.apercu) return reply.send(plan);'),
    'le plan doit être calculé avant de répondre à l’aperçu comme à l’enregistrement',
  );
  assert.match(corps, /if \(ligne\.statut !== 'pret'\) continue;/);
});

test('l’import applique la visibilité de l’atelier', () => {
  // Un numéro ne se pose que sur une commande que l'atelier voit dans sa liste.
  const lot = route.slice(route.indexOf("'/api/workspace/:id/parcels/lot'"));
  assert.match(lot, /await allowedOrderIds\(workspace\)/);
  assert.match(lot, /ordersForSupplier\(/);
});

test('l’import passe par le même chemin que la saisie une par une', () => {
  // C'est ce chemin qui expédie la commande au dernier colis : deux copies
  // finiraient par diverger.
  const unParUn = route.slice(route.indexOf("'/api/workspace/:id/parcels',"));
  assert.match(unParUn.slice(0, 2000), /await enregistrerColis\(/);

  const lot = route.slice(route.indexOf("'/api/workspace/:id/parcels/lot'"));
  assert.match(lot, /await enregistrerColis\(/);

  const partage = route.slice(route.indexOf('async function enregistrerColis'));
  assert.match(partage, /fulfillOrder\(/, 'le chemin partagé porte l’expédition Shopify');
});

test('la conséquence est annoncée avant le bouton, et dans son libellé', () => {
  const apercu = bloc(js, 'function renderApercu');
  assert.match(apercu, /t\('bulk\.consequence'/);
  assert.match(apercu, /t\('bulk\.saveShip'/);
  assert.ok(
    apercu.indexOf("t('bulk.consequence'") < apercu.indexOf('id="bulk-save"'),
    'la phrase qui annonce les mails doit précéder le bouton',
  );
});

/* ---- le fichier déposé ---- */

test('un fichier déposé ou choisi suit le même chemin, .xlsx compris', () => {
  assert.match(html, /id="bulk-file"\s+accept="\.xlsx,/);
  assert.match(js, /\$\('bulk-file'\)\?\.addEventListener\('change'[\s\S]{0,200}lireFichier\(fichier\)/);

  const depot = js.slice(js.indexOf("document.addEventListener('drop'"));
  assert.match(depot.slice(0, depot.indexOf('\n});')), /void lireFichier\(fichier\)/);
});

test('le glisser-déposer n’intercepte rien en mode « Une par une »', () => {
  // Hors du mode « En masse », la page se comporte comme avant.
  for (const evenement of ['dragenter', 'dragover', 'dragleave', 'drop']) {
    const debut = js.indexOf(`document.addEventListener('${evenement}'`);
    assert.ok(debut >= 0, `écoute ${evenement} introuvable`);
    assert.match(
      js.slice(debut, debut + 200),
      /if \(state\.mode !== 'masse' \|\| !porteDesFichiers\(event\)\) return;/,
      `${evenement} doit laisser passer hors du mode « En masse »`,
    );
  }
});

test('un .xlsx est lu par le serveur, puis vérifié comme un collage', () => {
  const lecture = js.slice(js.indexOf('async function lireFichier'), js.indexOf('let profondeurDepot'));
  assert.match(lecture, /parcels\/lot\/fichier/);
  assert.match(lecture, /messageServeur\(error, 'bulk\.refus'\)/);
  assert.ok(
    lecture.lastIndexOf("$('bulk-texte').value = data.texte;") < lecture.lastIndexOf('return verifierLot();'),
    'le texte lu s’affiche, puis part à la vérification ordinaire',
  );
});

test('chaque refus du serveur a sa traduction', () => {
  // Les codes rendus par le lecteur de classeurs et par l'import : une clé
  // manquante afficherait le message français à un atelier qui lit le chinois.
  const lecteur = lire('src/services/suppliers/lireClasseur.ts');
  const codesClasseur = [...lecteur.match(/export type CodeRefus =([^;]+);/)![1]!.matchAll(/'(\w+)'/g)].map((m) => m[1]!);
  const lot = route.slice(route.indexOf("'/api/workspace/:id/parcels/lot'"));
  const codesLot = [...lot.slice(0, lot.indexOf("'/api/workspace/:id/alerts'")).matchAll(/code: '(\w+)'/g)].map((m) => m[1]!);

  assert.ok(codesClasseur.length >= 5 && codesLot.length >= 4);
  for (const { code } of LANGS) {
    const table = (STRINGS as Record<string, Record<string, string>>)[code]!;
    const manquantes = [
      ...codesClasseur.map((c) => `bulk.refus.${c}`),
      ...codesLot.map((c) => `bulk.err.${c}`),
    ].filter((cle) => typeof table[cle] !== 'string');
    assert.deepEqual(manquantes, [], code);
  }
});

test('un refus codé se traduit, un code inconnu garde le message du serveur', () => {
  const messageServeur = new Function(
    't',
    `${bloc(js, 'function messageServeur')} return messageServeur;`,
  )((cle: string, v: Record<string, unknown>) =>
    cle === 'bulk.err.trop' ? `Trop : ${v.lignes}/${v.max}` : cle,
  ) as (erreur: Error & { code?: string; donnees?: object }, prefixe: string) => string;

  const refus = (code: string | undefined, donnees = {}) =>
    Object.assign(new Error('message du serveur'), { code, donnees });

  assert.equal(messageServeur(refus('trop', { lignes: 412, max: 300 }), 'bulk.err'), 'Trop : 412/300');
  assert.equal(messageServeur(refus('FST_ERR_CTP_BODY_TOO_LARGE'), 'bulk.err'), 'message du serveur');
  assert.equal(messageServeur(refus(undefined), 'bulk.err'), 'message du serveur');
});

test('un numéro abîmé par Excel est à corriger, avec l’explication', () => {
  assert.match(js, /abime_excel: 'bad',/);
  assert.match(bloc(js, 'function renderApercu'), /ligne\.statut === 'abime_excel'[\s\S]{0,120}t\('bulk\.abimeHelp'\)/);
});

/* ---- le guichet ---- */

test('Entrée enregistre le colis, sauf pendant une saisie en chinois', () => {
  const clavier = js.slice(js.indexOf("$('ws-orders').addEventListener('keydown'"));
  const corps = clavier.slice(0, clavier.indexOf('\n});'));

  assert.match(corps, /event\.key !== 'Enter' \|\| event\.isComposing/);
  assert.match(corps, /bouton\.click\(\)/);
});

test('le statut Shopify est traduit, et un statut inconnu reste lisible', () => {
  const statut = new Function(
    't',
    `${bloc(js, 'function statutCommande')} return statutCommande;`,
  )((cle: string) => (cle === 'order.status.UNFULFILLED' ? 'À expédier' : cle)) as (
    brut: string | null,
  ) => string;

  assert.equal(statut('UNFULFILLED'), 'À expédier');
  assert.equal(statut('SCHEDULED_SOMEDAY'), 'SCHEDULED_SOMEDAY', 'jamais le nom de la clé');
  assert.equal(statut(null), '—');
});

test('le transporteur est proposé, jamais imposé', () => {
  assert.match(js, /data-field="carrier" list="ws-carriers"/);
  assert.match(html, /<datalist id="ws-carriers">/);
  // Un champ texte libre, pas un <select> : un transporteur absent d'une
  // liste fermée bloquerait l'atelier.
  assert.equal(/<select[^>]*data-field="carrier"/.test(js), false);
});

test('« Signaler un problème » est un vrai bouton, plus un lien pâle', () => {
  assert.match(js, /class="btn ord-report" data-issue=/);
  assert.equal(/class="btn btn-ghost" data-issue=/.test(js), false);
});

/* ---- les trois langues ---- */

test('tout le vocabulaire nouveau existe dans les trois langues', () => {
  const cles = Object.keys(STRINGS.fr).filter(
    (cle) =>
      cle.startsWith('bulk.') ||
      cle.startsWith('mode.') ||
      cle.startsWith('order.status.') ||
      ['focus.customer', 'focus.shipping', 'focus.enterHint'].includes(cle),
  );
  assert.ok(cles.length >= 50, 'le vocabulaire de l’import manque au dictionnaire');

  for (const { code } of LANGS) {
    const table = (STRINGS as Record<string, Record<string, string>>)[code]!;
    const manquantes = cles.filter((cle) => typeof table[cle] !== 'string');
    assert.deepEqual(manquantes, [], `${code} : une clé absente s’affiche sous son propre nom`);
  }
});

test('chaque clé appelée par le code existe', () => {
  const brut = lire('public/workspace.js');
  const appelees = new Set([
    ...[...brut.matchAll(/\bt\('((?:bulk|mode|focus|order)\.[\w.]+)'/g)].map((m) => m[1]!),
    ...[...lire('public/workspace.html').matchAll(/data-t(?:ph)?="((?:bulk|mode)\.[\w.]+)"/g)].map(
      (m) => m[1]!,
    ),
  ]);
  const manquantes = [...appelees].filter((cle) => !STRINGS.fr[cle]);
  assert.deepEqual(manquantes, []);
});
