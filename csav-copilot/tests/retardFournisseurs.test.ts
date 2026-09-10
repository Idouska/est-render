import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { retardFournisseurs } from '../src/services/suppliers/retard.ts';

/*
 * Le compteur « Fournisseurs sans réponse » du poste de pilotage.
 *
 * CE QUE CES TESTS PROTÈGENT. C'est un compteur d'alerte : il ne sert que
 * lorsqu'il n'est pas à zéro, et une panne le ramène silencieusement à zéro —
 * l'état qui signifie « tout va bien ». Un compteur d'alerte qui s'éteint
 * quand la surveillance tombe est pire qu'aucun compteur, parce qu'il rassure.
 *
 * D'où les trois cas qui suivent : l'absence de données ne doit pas se lire
 * comme l'absence de retard ; la plus ancienne demande doit rester la plus
 * ancienne même si une ligne n'a pas de date ; et le nombre de demandes ne
 * doit pas se confondre avec le nombre d'ateliers, qui ne mesurent pas la
 * même charge — six demandes chez un atelier sont un coup de fil, six
 * demandes chez six ateliers sont une matinée.
 */

const jours = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000);

test('sans aucune demande en retard, rien n’est inventé', () => {
  const vide = retardFournisseurs([]);
  assert.equal(vide.requests, 0);
  assert.equal(vide.suppliers, 0);
  assert.equal(
    vide.oldestAt,
    null,
    'une date par défaut se lirait comme une mesure : « il y a 0 min » ferait ' +
      'croire qu’une demande vient de partir alors qu’aucune n’attend',
  );
});

test('les demandes se somment, les ateliers se comptent', () => {
  const bilan = retardFournisseurs([
    { _count: 4, _min: { createdAt: jours(2) } },
    { _count: 2, _min: { createdAt: jours(5) } },
  ]);

  assert.equal(bilan.requests, 6, 'six demandes en souffrance');
  assert.equal(bilan.suppliers, 2, 'chez deux ateliers, donc deux coups de fil');
});

test('la plus ancienne demande est retenue, même mêlée à des lignes sans date', () => {
  const vieille = jours(9);
  const bilan = retardFournisseurs([
    { _count: 1, _min: { createdAt: jours(1) } },
    // Une ligne sans date ne peut pas être la plus ancienne. La garder
    // écraserait une vraie date par `null` et éteindrait l'infobulle.
    { _count: 1, _min: { createdAt: null } },
    { _count: 1, _min: { createdAt: vieille } },
    { _count: 1, _min: { createdAt: jours(3) } },
  ]);

  assert.equal(bilan.oldestAt?.getTime(), vieille.getTime());
  assert.equal(bilan.requests, 4, 'une ligne sans date compte quand même ses demandes');
});

/*
 * Et l'infobulle qui accompagne le chiffre, prise dans le fichier réellement
 * servi. Elle porte tout ce que « 6 » ne peut pas dire : chez combien
 * d'ateliers, et depuis quand.
 */
const APP = fileURLToPath(new URL('../public/app.js', import.meta.url));
const source = readFileSync(APP, 'utf8');

function extraire(debut: string, fin: string): string {
  const i = source.indexOf(debut);
  assert.ok(i >= 0, `introuvable dans public/app.js : ${debut}`);
  const j = source.indexOf(fin, i);
  assert.ok(j >= 0, `fin introuvable après ${debut}`);
  return source.slice(i, j + fin.length);
}

const aide = new Function(
  `${extraire('function relativeTime', '\n}')}
   ${extraire('function aideRetardFournisseurs', '\n}')}
   return aideRetardFournisseurs;`,
)() as (retard: { requests: number; suppliers: number; oldestAt: string } | null) => string;

test('l’infobulle distingue « on ne sait pas » de « il n’y a rien »', () => {
  assert.match(
    aide(null),
    /indisponible/i,
    'quand les indicateurs n’ont pas répondu, l’infobulle doit le dire — sinon ' +
      'le tiret du chiffre passe pour un zéro',
  );
  assert.match(aide({ requests: 0, suppliers: 0, oldestAt: '' }), /Aucune demande/);
});

test('l’infobulle dit chez combien d’ateliers et depuis quand', () => {
  const texte = aide({
    requests: 6,
    suppliers: 2,
    oldestAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
  });

  assert.match(texte, /6 demandes/);
  assert.match(texte, /2 fournisseurs/);
  assert.match(texte, /il y a 3 j/);
});

test('l’infobulle accorde ses pluriels sur une seule demande', () => {
  const texte = aide({
    requests: 1,
    suppliers: 1,
    oldestAt: new Date(Date.now() - 26 * 60 * 60 * 1000).toISOString(),
  });

  assert.match(texte, /1 demande de changement/);
  assert.equal(/demandes/.test(texte), false, 'pas de « s » sur une seule demande');
  assert.equal(/fournisseurs/.test(texte), false, 'pas de « s » sur un seul fournisseur');
});

/*
 * La destination du clic.
 *
 * Les lignes de ce poste de pilotage menaient toutes à la file filtrée. Celle
 * des fournisseurs mène à « Update », où vivent les demandes de changement :
 * y renvoyer par un filtre de file afficherait une liste vide, ce qui se lit
 * comme « il n'y a rien » alors que le chiffre venait d'annoncer le contraire.
 * Les deux destinations s'excluent, sans quoi un clic en aurait deux.
 */
const statLigne = new Function(
  `${extraire('function esc', '\n}')}
   const ico = () => '<svg></svg>';
   ${extraire('function ovStatLigne', '\n}')}
   return ovStatLigne;`,
)() as (ligne: Record<string, unknown>) => string;

test('une ligne « vue » mène à l’écran, pas à la file', () => {
  const html = statLigne({ label: 'Fournisseurs sans réponse', valeur: '6', vue: 'changes' });

  assert.match(html, /data-ov-vue="changes"/);
  assert.equal(/data-ov-filtre/.test(html), false);
  assert.match(html, /<button/, 'la ligne doit être un bouton pour être cliquable au clavier');
});

test('les deux destinations s’excluent : le filtre l’emporte', () => {
  const html = statLigne({ label: 'x', valeur: '1', filtre: { status: 'NEW' }, vue: 'changes' });

  assert.match(html, /data-ov-filtre/);
  assert.equal(
    /data-ov-vue/.test(html),
    false,
    'porter les deux attributs câblerait deux gestionnaires sur le même clic',
  );
});

test('une ligne sans destination n’est pas un bouton', () => {
  const html = statLigne({ label: 'Litiges', valeur: '0' });

  assert.equal(/<button/.test(html), false, 'rien à ouvrir : pas d’affordance de clic');
  assert.match(html, /<div class="statrow"/);
});
