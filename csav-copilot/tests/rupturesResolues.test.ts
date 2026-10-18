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

function extraire(debut: string, finDeBloc = '\n}'): string {
  const i = app.indexOf(debut);
  assert.ok(i >= 0, `introuvable dans public/app.js : ${debut}`);
  return app.slice(i, app.indexOf(finDeBloc, i) + finDeBloc.length);
}

interface Dossier {
  id: string;
  etat: string;
  creeLe: string;
  suivi?: { file: { aTraiter: boolean; attenteClient: boolean; repete: boolean; attenteAtelier: boolean } };
}

function filtrer(dossiers: Dossier[], vue = 'tous'): string[] {
  const state = { ruptures: { dossiers, vue, q: '' } };
  const fn = new Function(
    'state',
    [
      extraire('const RUP_FILTRES = {', '\n};'),
      extraire('const fileDe = (d) =>', '\n  };'),
      extraire('function rupturesFiltrees'),
      'return rupturesFiltrees;',
    ].join('\n'),
  )(state) as () => Dossier[];
  return fn().map((dossier) => dossier.id);
}

const file = (patch: Partial<NonNullable<Dossier['suivi']>['file']> = {}) => ({
  file: { aTraiter: false, attenteClient: false, repete: false, attenteAtelier: false, ...patch },
});

const d = (id: string, etat: string, jours: number, suivi = file()): Dossier => ({
  id,
  etat,
  creeLe: new Date(Date.UTC(2026, 8, 10) - jours * 86_400_000).toISOString(),
  suivi,
});

test('un dossier résolu reste dans « Toutes les ruptures »', () => {
  const ids = filtrer([d('ouvert', 'CLIENT_A_PREVENIR', 2), d('clos', 'RESOLU', 1)]);
  assert.ok(ids.includes('clos'), 'le retirer ferait croire qu’il a été supprimé');
});

test('ce qui attend une décision d’abord, les dossiers clos en dernier', () => {
  // Le dossier clos est le plus récent : en tête, il passerait devant ce qu'il
  // faut encore traiter.
  const dossiers = [
    d('clos-recent', 'RESOLU', 0),
    d('attente-recent', 'FOURNISSEUR_CONTACTE', 1, file({ attenteAtelier: true })),
    d('a-traiter-ancien', 'A_TRAITER', 5, file({ aTraiter: true })),
    d('a-traiter-recent', 'A_TRAITER', 2, file({ aTraiter: true })),
  ];
  assert.deepEqual(filtrer(dossiers), ['a-traiter-recent', 'a-traiter-ancien', 'attente-recent', 'clos-recent']);
});

test('un chiffre du haut filtre sur le même drapeau que celui qu’il compte', () => {
  const dossiers = [
    d('a', 'A_TRAITER', 1, file({ aTraiter: true, repete: true })),
    d('b', 'A_TRAITER', 1, file({ aTraiter: true, attenteClient: true })),
    d('c', 'FOURNISSEUR_CONTACTE', 1, file({ attenteAtelier: true })),
  ];
  assert.deepEqual(filtrer(dossiers, 'aTraiter').sort(), ['a', 'b']);
  assert.deepEqual(filtrer(dossiers, 'attenteClient'), ['b']);
  assert.deepEqual(filtrer(dossiers, 'repete'), ['a']);
  assert.deepEqual(filtrer(dossiers, 'attenteAtelier'), ['c']);
});

test('un dossier clos ne compte dans aucun filtre', () => {
  // Le serveur ne compte que les dossiers ouverts : la liste filtrée non plus.
  const ids = filtrer([d('clos', 'RESOLU', 1, file({ aTraiter: true }))], 'aTraiter');
  assert.deepEqual(ids, []);
});

test('un dossier clos n’a ni « Envoyer le mail » ni « À traiter »', () => {
  assert.match(extraire('function mailDeLaLigne'), /if \(d\.etat === 'RESOLU'\) return '';/);
  assert.match(extraire('function decisionDeLaLigne'), /if \(d\.etat === 'RESOLU'\) return '';/);
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
