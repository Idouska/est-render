import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

/*
 * Un dossier marqué résolu reste visible.
 *
 * CE QUE CES TESTS PROTÈGENT. L'onglet « Tous » excluait les dossiers clos.
 * Marquer un dossier résolu le faisait donc disparaître de la liste qu'on
 * regardait, à l'instant même du clic — ce qui se lit exactement comme une
 * suppression. Rien n'était supprimé : la clôture ne fait que changer un
 * statut. Mais une donnée qui disparaît sous les yeux est une donnée qu'on
 * croit perdue, et l'on cesse de faire confiance au bouton.
 *
 * Et la couleur verte, « classé », n'apparaissait jamais là où l'on regarde.
 */

const lire = (chemin: string) =>
  readFileSync(fileURLToPath(new URL(`../${chemin}`, import.meta.url)), 'utf8');
const app = lire('public/app.js');

function extraire(debut: string): string {
  const i = app.indexOf(debut);
  assert.ok(i >= 0, `introuvable dans public/app.js : ${debut}`);
  return app.slice(i, app.indexOf('\n}', i) + 2);
}

interface Dossier {
  id: string;
  etat: string;
  priorite: string | null;
  creeLe: string;
  commandesImpactees: number;
}

function filtrer(dossiers: Dossier[], vue = 'tous', tri = 'recent'): string[] {
  const state = {
    ruptures: { dossiers, vue, tri, q: '', fournisseur: '', priorite: '' },
  };
  const fn = new Function(
    'state',
    `${extraire('function rupturesFiltrees')} return rupturesFiltrees;`,
  )(state) as () => Dossier[];
  return fn().map((dossier) => dossier.id);
}

const d = (id: string, etat: string, jours: number): Dossier => ({
  id,
  etat,
  priorite: etat === 'RESOLU' ? null : 'moyenne',
  creeLe: new Date(Date.UTC(2026, 8, 10) - jours * 86_400_000).toISOString(),
  commandesImpactees: 1,
});

test('un dossier résolu reste dans « Tous »', () => {
  const ids = filtrer([d('ouvert', 'CLIENT_A_PREVENIR', 2), d('clos', 'RESOLU', 1)]);
  assert.ok(ids.includes('clos'), 'le retirer ferait croire qu’il a été supprimé');
});

test('les dossiers clos descendent sous le travail restant, quel que soit le tri', () => {
  // Le dossier clos est le plus récent : en « plus récent », il resterait en
  // tête, au-dessus de ce qu'il faut encore traiter.
  const dossiers = [
    d('clos-recent', 'RESOLU', 0),
    d('ouvert-ancien', 'A_TRAITER', 5),
    d('ouvert-recent', 'CLIENT_A_PREVENIR', 1),
  ];

  assert.deepEqual(filtrer(dossiers, 'tous', 'recent'), [
    'ouvert-recent',
    'ouvert-ancien',
    'clos-recent',
  ]);
  assert.deepEqual(filtrer(dossiers, 'tous', 'ancien'), [
    'ouvert-ancien',
    'ouvert-recent',
    'clos-recent',
  ], 'l’ordre choisi est respecté à l’intérieur de chaque groupe');
});

test('l’onglet « Résolu » ne montre que les dossiers clos', () => {
  const ids = filtrer(
    [d('ouvert', 'CLIENT_A_PREVENIR', 1), d('clos', 'RESOLU', 2)],
    'RESOLU',
  );
  assert.deepEqual(ids, ['clos']);
});

test('un onglet d’état reste un filtre strict', () => {
  const ids = filtrer(
    [d('a', 'A_TRAITER', 1), d('b', 'CLIENT_A_PREVENIR', 1), d('c', 'RESOLU', 1)],
    'CLIENT_A_PREVENIR',
  );
  assert.deepEqual(ids, ['b']);
});

test('un dossier clos n’a pas de case à cocher', () => {
  // L'action groupée ne sait que clôturer : cocher un dossier déjà clos ne
  // ferait que gonfler le compte du message de confirmation.
  const lignes = extraire('function renderRuptureLignes');
  assert.match(lignes, /d\.etat === 'RESOLU'\s*\?\s*''/);

  const cablage = app.slice(app.indexOf("$('rup-all')?.addEventListener"));
  assert.match(cablage.slice(0, 800), /if \(dossier\.etat === 'RESOLU'\) continue;/);
});

test('la clôture ne supprime rien', () => {
  // Les deux routes que le bouton appelle ne font que changer un statut.
  const routes = lire('src/routes/tickets.ts');
  const resolve = routes.slice(routes.indexOf("'/api/tickets/:id/resolve'"));
  const corps = resolve.slice(0, resolve.indexOf('\n  );'));
  assert.match(corps, /data: \{ status: 'CLOSED'/);
  assert.equal(/\.delete\(|\.deleteMany\(/.test(corps), false);

  // Borné à l'export suivant, pas au premier « } » en début de ligne : la
  // signature déclare ses paramètres dans un bloc `{ … }` qui se referme en
  // colonne zéro, et l'on n'aurait examiné que le type, jamais le corps.
  const escalade = lire('src/services/suppliers/escalate.ts');
  const resolution = escalade.slice(escalade.indexOf('export async function resolveEscalation'));
  const suite = resolution.indexOf('\nexport ', 1);
  const corpsEsc = suite === -1 ? resolution : resolution.slice(0, suite);
  assert.match(corpsEsc, /status: 'RESOLVED'/);
  assert.equal(/\.delete\(|\.deleteMany\(/.test(corpsEsc), false);
});
