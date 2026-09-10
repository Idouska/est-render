import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { fenetresJour } from '../src/services/tickets/fenetresJour.ts';

/*
 * Le « vs hier » du poste de pilotage.
 *
 * CE QUE CES TESTS PROTÈGENT. Un écart est le chiffre le plus facile à
 * afficher et le plus facile à rendre faux, parce que rien ne le contredit à
 * l'écran. « ↓ 84 % » a exactement l'air d'une mesure — et se cite en réunion,
 * puis sert à décider.
 *
 * Trois façons de mentir, toutes silencieuses :
 *
 *   1. COMPARER DEUX DURÉES DIFFÉRENTES. Une journée commencée contre une
 *      journée finie : tous les matins, l'écran annoncerait un effondrement à
 *      une équipe qui démarre normalement.
 *
 *   2. DIVISER PAR ZÉRO. De 0 à 3 tickets, le pourcentage n'existe pas.
 *
 *   3. FAIRE PASSER DU BRUIT POUR UNE TENDANCE. De 2 à 3, « +50 % » suggère
 *      un mouvement là où il y a un ticket de plus.
 *
 * Et une façon d'accuser à tort : peindre en rouge une hausse d'ARRIVÉES,
 * qui n'est pas une contre-performance mais de la demande.
 */

/* ---- les fenêtres, côté serveur ---- */

test('les deux fenêtres couvrent la même durée', () => {
  const maintenant = new Date(2026, 8, 10, 14, 30, 0);
  const f = fenetresJour(maintenant);

  const aujourdhui = maintenant.getTime() - f.debutAujourdhui.getTime();
  const veille = f.memeHeureHier.getTime() - f.debutHier.getTime();

  assert.equal(
    aujourdhui,
    veille,
    'comparer une journée commencée à une journée finie afficherait « −84 % » tous les matins',
  );
  assert.equal(f.minutesEcoulees, 14 * 60 + 30);
});

test('hier commence exactement vingt-quatre heures avant aujourd’hui', () => {
  const f = fenetresJour(new Date(2026, 8, 10, 9, 0, 0));
  assert.equal(f.debutAujourdhui.getTime() - f.debutHier.getTime(), 86_400_000);
});

test('juste après minuit, la tranche écoulée est presque nulle', () => {
  // Le cas qui doit faire taire l'écart : il n'y a rien à décrire.
  const f = fenetresJour(new Date(2026, 8, 10, 0, 12, 0));
  assert.equal(f.minutesEcoulees, 12);
  assert.equal(f.memeHeureHier.getTime() - f.debutHier.getTime(), 12 * 60_000);
});

/* ---- la règle d'affichage, prise dans le fichier servi ---- */

const APP = fileURLToPath(new URL('../public/app.js', import.meta.url));
const source = readFileSync(APP, 'utf8');

function extraire(debut: string, fin = '\n}'): string {
  const i = source.indexOf(debut);
  assert.ok(i >= 0, `introuvable dans public/app.js : ${debut}`);
  const j = source.indexOf(fin, i);
  return source.slice(i, j + fin.length);
}

type Ecart = { texte: string; direction: string } | null;

const ecartJour = new Function(
  `${extraire('function ecartJour')} return ecartJour;`,
)() as (actuel: unknown, hier: unknown, minutes?: number) => Ecart;

const APRES_MIDI = 14 * 60;

test('un écart franc s’exprime en pourcentage', () => {
  assert.deepEqual(ecartJour(12, 8, APRES_MIDI), { texte: '↑ 50 %', direction: 'hausse' });
  assert.deepEqual(ecartJour(4, 8, APRES_MIDI), { texte: '↓ 50 %', direction: 'baisse' });
});

test('sous cinq de référence, l’écart s’affiche en absolu', () => {
  // « +50 % » sur 2 → 3 suggère une tendance là où il y a un ticket de plus.
  assert.deepEqual(ecartJour(3, 2, APRES_MIDI), { texte: '↑ 1', direction: 'hausse' });
  assert.deepEqual(ecartJour(1, 4, APRES_MIDI), { texte: '↓ 3', direction: 'baisse' });
});

test('une référence à zéro ne produit jamais de pourcentage', () => {
  const ecart = ecartJour(3, 0, APRES_MIDI);
  assert.equal(ecart?.texte, '↑ 3');
  assert.equal(/%/.test(ecart!.texte), false, 'diviser par zéro n’affiche pas un nombre, il en invente un');
});

test('avant deux heures écoulées, aucun écart n’est affiché', () => {
  // À 7 h 10, la comparaison porte sur soixante-dix minutes : un ticket contre
  // zéro donnerait « +100 % », et la même situation « −50 % » le lendemain.
  assert.equal(ecartJour(1, 0, 70), null);
  assert.equal(ecartJour(40, 12, 119), null, 'même un écart large reste du bruit à cette heure');
  assert.ok(ecartJour(40, 12, 121), 'passé le seuil, il s’affiche');
});

test('l’égalité se dit, elle ne se tait pas', () => {
  // Un espace vide laisserait croire que la comparaison a échoué.
  assert.deepEqual(ecartJour(9, 9, APRES_MIDI), { texte: '=', direction: 'egal' });
});

test('sans chiffre d’hier, rien n’est affiché', () => {
  assert.equal(ecartJour(9, null, APRES_MIDI), null);
  assert.equal(ecartJour(undefined, 4, APRES_MIDI), null);
});

/* ---- ce qui reçoit une couleur, et ce qui n'en reçoit pas ---- */

test('seuls les flux portent un « vs hier »', () => {
  /*
   * Commentaires retirés avant l'examen, et ce n'est pas une précaution
   * théorique : le commentaire qui explique cette règle nomme les trois
   * cartes-stocks, et `indexOf` tombait dessus avant d'atteindre le code. Le
   * test passait donc en lisant sa propre justification — il aurait laissé
   * passer un écart posé sur « Brouillons prêts ».
   */
  const kpis = extraire('function renderOvKpis')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');

  // Les stocks — ce qui attend en ce moment — n'ont pas de valeur d'hier :
  // le produit ne garde pas l'historique des statuts.
  for (const stock of ['En attente de vous', 'Brouillons prêts', 'Chez le fournisseur']) {
    const i = kpis.indexOf(stock);
    assert.ok(i > 0, `carte « ${stock} » introuvable`);
    const carte = kpis.slice(i, kpis.indexOf('],', i));
    assert.equal(
      /ecart\(/.test(carte),
      false,
      `« ${stock} » compte ce qui attend maintenant : son chiffre d’hier n’existe nulle part`,
    );
  }

  assert.match(kpis, /ecart\(metrics\?\.today, hier\?\.traites, 'Messages traités', true\)/);
  assert.match(kpis, /ecart\(metrics\?\.recus, hier\?\.recus, 'Messages reçus', null\)/);
});

test('une hausse d’arrivées n’est pas peinte comme une faute', () => {
  // `null` en dernier argument : la direction s'affiche, le jugement non.
  // Rougir une hausse de demande reprocherait à l'équipe le succès de la
  // boutique.
  const kpis = extraire('function renderOvKpis');
  const recus = kpis.slice(kpis.indexOf("'Messages reçus'"));
  assert.match(recus.slice(0, 40), /'Messages reçus', null/);
});
