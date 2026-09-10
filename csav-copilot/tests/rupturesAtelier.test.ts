import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { LANGS, STRINGS } from '../public/workspace.i18n.js';

/*
 * La page « Ruptures de stock » de l'atelier.
 *
 * CE QUE CES TESTS PROTÈGENT. Deux contrats que rien ne relie dans le code, et
 * dont la rupture ne lève aucune erreur :
 *
 *   1. LA CLÉ DE FIL. Un signalement d'atelier s'écrit dans un ticket dont
 *      `gmailThreadId` vaut `supplier:<fournisseur>:<commande>:<motif>`. La
 *      page les relit par ce motif. Changer la forme d'un côté rend l'autre
 *      muet : la liste s'affiche vide, « vous n'avez rien signalé », alors que
 *      le préparateur vient d'envoyer trois signalements. Aucune exception,
 *      aucun test rouge — juste un écran qui a l'air de fonctionner.
 *
 *   2. LES TROIS LANGUES. L'atelier est le seul écran qu'une personne
 *      extérieure ouvre chaque jour, et cette personne est souvent en Chine.
 *      Une clé oubliée en `zh` n'échoue pas : elle affiche son propre nom,
 *      `rup.waiting`, au milieu d'une phrase chinoise.
 */

const lire = (chemin: string) =>
  readFileSync(fileURLToPath(new URL(`../${chemin}`, import.meta.url)), 'utf8');

const routes = lire('src/routes/supplierWorkspace.ts');

test('la clé de fil s’écrit et se relit de la même façon', () => {
  // Écriture, dans la route de signalement.
  assert.match(
    routes,
    /const threadId = `supplier:\$\{workspace\.supplierId\}:\$\{parsed\.data\.shopifyOrderId\}:\$\{parsed\.data\.kind\}`/,
    'la forme de la clé a changé côté écriture',
  );

  // Lecture, dans la page des ruptures : même préfixe, motif STOCK.
  const page = routes.slice(routes.indexOf("'/api/workspace/:id/ruptures'"));
  assert.match(
    page,
    /startsWith: `supplier:\$\{workspace\.supplierId\}:`/,
    'la lecture doit filtrer sur le même préfixe que l’écriture',
  );
  assert.match(page, /endsWith: ':STOCK'/, 'et sur le motif STOCK, pas sur un autre');
});

test('un atelier ne voit que ses propres signalements', () => {
  // Le préfixe porte l'identifiant du fournisseur. Filtrer seulement sur
  // `:STOCK` montrerait à chaque atelier les ruptures de tous les autres —
  // avec les numéros de commande et les articles de ses concurrents.
  const page = routes.slice(routes.indexOf("'/api/workspace/:id/ruptures'"));
  assert.match(page, /merchantId: workspace\.merchantId/);
  assert.match(page, /supplier:\$\{workspace\.supplierId\}:/);
});

test('les escalades encore en brouillon ne sont pas montrées', () => {
  // Un brouillon n'a pas été envoyé : le fournisseur répondrait à une question
  // que le marchand n'a pas encore posée — et qu'il est peut-être en train de
  // réécrire.
  const page = routes.slice(routes.indexOf("'/api/workspace/:id/ruptures'"));
  assert.match(page, /demande\.status !== 'DRAFTING'/);
});

test('la page ne montre que les ruptures, pas toutes les escalades', () => {
  const page = routes.slice(routes.indexOf("'/api/workspace/:id/ruptures'"));
  assert.match(
    page,
    /reason: 'OUT_OF_STOCK'/,
    'sans ce filtre, l’atelier verrait aussi les adresses incorrectes et les articles abîmés',
  );
});

/* ---- les trois langues ---- */

const CLES_RUPTURES = Object.keys(STRINGS.fr).filter(
  (cle) => cle.startsWith('rup.') || cle === 'nav.ruptures',
);

test('la page existe dans les trois langues, sans trou', () => {
  assert.ok(CLES_RUPTURES.length >= 15, 'les clés de la page sont absentes du dictionnaire');

  for (const { code } of LANGS) {
    const manquantes = CLES_RUPTURES.filter(
      (cle) => typeof (STRINGS as Record<string, Record<string, string>>)[code]?.[cle] !== 'string',
    );
    assert.deepEqual(
      manquantes,
      [],
      `${code} : une clé absente s’affiche sous son propre nom, « rup.waiting », ` +
        'au milieu d’une phrase — l’atelier chinois lirait un identifiant',
    );
  }
});

test('aucune traduction ne recopie le français par paresse', () => {
  // Un « à traduire plus tard » laissé en français est pire qu'une clé
  // manquante : il a l'air fini.
  const suspectes = CLES_RUPTURES.filter((cle) => {
    const fr = STRINGS.fr[cle];
    const zh = (STRINGS as Record<string, Record<string, string>>).zh?.[cle];
    return typeof fr === 'string' && fr === zh && !/^\{|^#/.test(fr);
  });

  assert.deepEqual(suspectes, [], 'chaînes identiques entre fr et zh');
});

test('la page se recharge quand la langue change', () => {
  // Les cartes sont écrites en JavaScript : elles ne portent pas de `data-t`
  // et resteraient dans l'ancienne langue à côté d'une navigation traduite.
  const js = lire('public/workspace.js');
  assert.match(
    js,
    /if \(state\.view !== 'orders'\) setView\(state\.view\);/,
    'applyLang doit relancer la vue courante',
  );
  assert.match(js, /ruptures: loadRuptures,/, 'et la vue doit être dans la table des chargeurs');
});

test('la pastille s’éteint quand la liste échoue', () => {
  // Une pastille laissée à « 1 » pendant que l'écran dit « liste
  // indisponible » affirme le contraire de la page — et c'est le chiffre
  // qu'on croit.
  const js = lire('public/workspace.js');
  const bloc = js.slice(js.indexOf('async function loadRuptures'));
  const attrape = bloc.slice(bloc.indexOf('} catch'), bloc.indexOf('return;'));

  assert.match(attrape, /setRuptureBadge\(0\)/);
});
