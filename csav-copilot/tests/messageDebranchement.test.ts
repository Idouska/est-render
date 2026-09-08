import { equal, match, doesNotMatch } from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

/*
 * La fenêtre affichée avant de débrancher une boîte Gmail.
 *
 * Débrancher SUPPRIME les conversations apportées par l'adresse — c'est un
 * choix assumé côté serveur, pas une conséquence du schéma, qui les
 * laisserait orphelines. La fenêtre promettait pourtant l'inverse : « les
 * messages déjà reçus sont conservés ». Le marchand validait la perte de son
 * historique en lisant qu'il le gardait.
 *
 * Ce test tient les trois cas, et surtout le troisième : quand le nombre n'est
 * pas connu, la phrase doit rester vraie plutôt que de tomber sur « aucune
 * conversation », qui remplacerait un mensonge par un autre — le marchand
 * débrancherait tranquillement une boîte pleine.
 *
 * `public/app.js` est un module de navigateur et ne s'importe pas dans Node :
 * la fonction est extraite du fichier réellement servi, comme pour la table
 * des indicatifs.
 */

const APP = fileURLToPath(new URL('../public/app.js', import.meta.url));
const source = readFileSync(APP, 'utf8');
const debut = source.indexOf('function messageDebranchement(');
const fin = source.indexOf('\n}', debut) + 2;

const messageDebranchement = new Function(
  `${source.slice(debut, fin)}\n return messageDebranchement;`,
)() as (boite?: { emailAddress?: string; ticketCount?: number }) => string;

test('le nombre est annoncé quand il est connu', () => {
  const m = messageDebranchement({ emailAddress: 'sav@boutique.fr', ticketCount: 5260 });
  match(m, /Débrancher sav@boutique\.fr \?/);
  match(m, /5260 conversations rattachées à cette adresse seront supprimées\./);
  match(m, /Le courrier reste dans votre boîte Gmail\. Irréversible\./);
});

test('le singulier se lit comme du français', () => {
  const m = messageDebranchement({ emailAddress: 'sav@boutique.fr', ticketCount: 1 });
  match(m, /1 conversation rattachée à cette adresse sera supprimée\./);
  doesNotMatch(m, /conversations/);
});

test('une boîte vide le dit, sans menace inutile', () => {
  const m = messageDebranchement({ emailAddress: 'sav@boutique.fr', ticketCount: 0 });
  match(m, /Aucune conversation n’est rattachée à cette adresse\./);
  doesNotMatch(m, /Irréversible/);
});

test('un compte absent n’est PAS un compte à zéro', () => {
  // Le cœur du test. Si le serveur ne renvoie pas le nombre — page en cache,
  // champ retiré, panne — la fenêtre ne doit jamais affirmer que la boîte est
  // vide : le marchand débrancherait une boîte pleine en toute confiance.
  for (const boite of [
    { emailAddress: 'sav@boutique.fr' },
    { emailAddress: 'sav@boutique.fr', ticketCount: undefined },
    undefined,
  ]) {
    const m = messageDebranchement(boite);
    doesNotMatch(m, /Aucune conversation/, `cas ${JSON.stringify(boite)}`);
    match(m, /Les conversations rattachées à cette adresse seront supprimées\./);
    match(m, /Irréversible/);
  }
});

test('sans adresse, la fenêtre reste lisible', () => {
  match(messageDebranchement(undefined), /Débrancher cette boîte \?/);
});

test('la révocation Google est annoncée dans tous les cas', () => {
  for (const nb of [undefined, 0, 1, 5260]) {
    const m = messageDebranchement({ emailAddress: 'sav@boutique.fr', ticketCount: nb });
    match(m, /L’autorisation Google est révoquée/, `nb=${nb}`);
  }
});

test('la phrase mensongère d’origine a bien disparu du fichier servi', () => {
  // Elle ne doit plus exister nulle part, pas même dans un chemin oublié.
  equal(source.includes('Les messages déjà reçus sont conservés'), false);
});
