import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

/*
 * Une colonne, un défilement.
 *
 * CE QUE CES TESTS PROTÈGENT. Au-delà de 1 200 px, chaque colonne de l'écran
 * SAV défile pour son compte. La file avait perdu son ancien plafond de
 * hauteur en passant à ce régime ; le fil des échanges avait gardé le sien —
 * `.messages { max-height: 42vh; overflow-y: auto }` —, et la colonne du
 * détail montrait deux barres côte à côte : la molette faisait défiler le fil
 * ou la colonne selon l'endroit survolé, et huit messages se lisaient dans
 * une fente d'un message et demi. Vu en production le 30 septembre.
 *
 * Et une colonne qui défile garde sa position : sans remise en haut, le
 * ticket suivant s'ouvrait au milieu de ses échanges, sans son titre.
 */

const lire = (chemin: string) =>
  readFileSync(fileURLToPath(new URL(`../${chemin}`, import.meta.url)), 'utf8');

const STYLES = lire('public/styles.css').replace(/\/\*[\s\S]*?\*\//g, '');
const APP = lire('public/app.js');

/** Le contenu du bloc `@media (min-width: 1201px)` qui verrouille les colonnes. */
function blocVerrouille(): string {
  for (const m of STYLES.matchAll(/@media\s*\(min-width:\s*1201px\)\s*\{/g)) {
    let profondeur = 1;
    let i = m.index + m[0].length;
    const debut = i;
    while (profondeur > 0 && i < STYLES.length) {
      if (STYLES[i] === '{') profondeur += 1;
      if (STYLES[i] === '}') profondeur -= 1;
      i += 1;
    }
    const bloc = STYLES.slice(debut, i - 1);
    if (bloc.includes('.app-locked .workspace > *')) return bloc;
  }
  assert.fail('le bloc @media (min-width: 1201px) des colonnes a disparu');
}

/** Les déclarations de la règle au sélecteur exact, dans ce bloc. */
function regle(bloc: string, selecteur: string): Record<string, string> {
  for (const m of bloc.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selecteurs = m[1].split(',').map((s) => s.trim().replace(/\s+/g, ' '));
    if (!selecteurs.includes(selecteur)) continue;
    return Object.fromEntries(
      [...m[2].matchAll(/([a-z-]+)\s*:\s*([^;]+)/g)].map(([, nom, valeur]) => [nom, valeur.trim()]),
    );
  }
  assert.fail(`aucune règle « ${selecteur} » dans le bloc des colonnes`);
}

test('en colonnes, ni la file ni le fil ne défilent à l’intérieur de leur colonne', () => {
  const bloc = blocVerrouille();

  // La prémisse : c'est la colonne qui défile. Si elle cessait de le faire,
  // lever les plafonds rendrait le fil interminable — revoir ce test.
  assert.equal(regle(bloc, '.app-locked .workspace > *')['overflow-y'], 'auto');

  for (const plafonne of ['.app-locked .queue-list', '.app-locked .messages']) {
    const d = regle(bloc, plafonne);
    assert.equal(d['max-height'], 'none', `${plafonne} : max-height`);
    assert.equal(d['overflow-y'], 'visible', `${plafonne} : overflow-y`);
  }
});

test('un autre ticket s’ouvre en haut ; le même ne bouge pas', async () => {
  // Exécutée, pas lue : la vraie `selectTicket`, entourée de doublures.
  const debut = APP.indexOf('async function selectTicket(');
  const fin = APP.indexOf('\n}\n', debut);
  assert.ok(debut > 0 && fin > debut, 'selectTicket introuvable');
  const source = APP.slice(debut, fin + 2);

  const ouvrir = async (courant: string | null, id: string) => {
    const journal: string[] = [];
    let haut = 800;
    const colonne = {
      get scrollTop() {
        return haut;
      },
      set scrollTop(valeur: number) {
        journal.push(`défilement → ${valeur}`);
        haut = valeur;
      },
    };
    const doublures = {
      state: { currentId: courant },
      document: { querySelectorAll: () => [] },
      prefetched: new Map(),
      api: async () => ({ ticket: { id } }),
      toast: () => {},
      loadQueue: async () => {},
      estLu: () => true,
      marqueOuvert: async () => {},
      renderDetail: () => journal.push('rendu'),
      $: (cle: string) => (cle === 'd-pane' ? colonne : null),
      loadEscalations: async () => {},
      loadMetrics: async () => {},
    };
    const selectTicket = new Function(...Object.keys(doublures), `${source}\nreturn selectTicket;`)(
      ...Object.values(doublures),
    );
    await selectTicket(id);
    return { journal, haut };
  };

  // Un autre ticket : rendu d'abord, remise en haut ensuite — dans l'autre
  // ordre, la colonne remonterait sur l'ancien contenu puis changerait.
  assert.deepEqual(await ouvrir('t1', 't2'), { journal: ['rendu', 'défilement → 0'], haut: 0 });

  // Rien d'ouvert (la sélection vient d'être vidée) : le premier ticket aussi.
  assert.deepEqual(await ouvrir(null, 't1'), { journal: ['rendu', 'défilement → 0'], haut: 0 });

  // Le même ticket, relu après un envoi ou un remboursement : on ne bouge pas.
  assert.deepEqual(await ouvrir('t1', 't1'), { journal: ['rendu'], haut: 800 });
});

test('la colonne du détail porte l’identifiant que `selectTicket` remet en haut', () => {
  const html = lire('public/dashboard.html');
  assert.match(html, /<section class="panel" id="d-pane" aria-label="Détail du message">/);
  assert.equal(html.match(/id="d-pane"/g)?.length, 1, 'un seul d-pane');
});
