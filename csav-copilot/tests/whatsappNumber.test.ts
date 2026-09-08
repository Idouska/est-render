import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

/*
 * La composition d'un numéro WhatsApp, éprouvée sur des exemples réels.
 *
 * `public/app.js` est un module de navigateur : il touche au DOM dès son
 * chargement et ne s'importe pas dans Node. On en extrait donc les deux
 * morceaux qui nous intéressent — la table des indicatifs et la fonction qui
 * s'en sert — et on les évalue seuls. Le test porte ainsi sur le code
 * réellement servi, pas sur une copie qui divergerait au premier correctif.
 *
 * CE QUE CE TEST PROTÈGE. Un indicatif faux ne casse rien : il produit un
 * numéro plausible. Le marchand ouvre alors une conversation WhatsApp avec un
 * inconnu, depuis son compte, à propos de la commande d'un client. Le préfixe
 * national est le champ le plus exposé : noté « 0 » pour un pays qui n'en a
 * pas, il mange le premier chiffre ; noté vide pour un pays qui en a un, il
 * laisse un zéro parasite. Chaque pays de la table doit donc passer son propre
 * exemple.
 */

const APP = fileURLToPath(new URL('../public/app.js', import.meta.url));

function extraire(source: string, debut: string, fin: string): string {
  const i = source.indexOf(debut);
  assert.ok(i >= 0, `introuvable dans public/app.js : ${debut}`);
  const j = source.indexOf(fin, i);
  assert.ok(j >= 0, `fin introuvable après ${debut}`);
  return source.slice(i, j + fin.length);
}

type Table = Record<string, { dial: string; trunk: string }>;
type Composer = (raw: string, pays: string | null | undefined) => string | null;

const source = readFileSync(APP, 'utf8');
const { DIAL_CODES, whatsappNumber } = new Function(
  `${extraire(source, 'const DIAL_CODES', '\n};')}
   ${extraire(source, 'function whatsappNumber', '\n}')}
   return { DIAL_CODES, whatsappNumber };`,
)() as { DIAL_CODES: Table; whatsappNumber: Composer };

/*
 * Un numéro national, et le même en E.164 sans le « + ».
 *
 * Les numéros sont pris dans les plages que les régulateurs réservent à la
 * fiction quand ils en publient une — 07700 900xxx pour l'Ofcom britannique,
 * 555-01xx pour l'Amérique du Nord — sinon dans une plage mobile valide, sous
 * une forme qui n'est attribuée à personne.
 */
const EXEMPLES: Array<[iso: string, national: string, e164: string, quoi: string]> = [
  ['FR', '0612345678', '33612345678', 'mobile français, préfixe national 0 retiré'],
  ['GB', '07700900123', '447700900123', 'plage de fiction de l’Ofcom'],
  ['ES', '612345678', '34612345678', 'l’Espagne n’a pas de préfixe national'],
  ['PT', '912345678', '351912345678', 'le Portugal non plus'],
  ['IT', '3331234567', '393331234567', 'l’Italie garde ses zéros, mobiles sans zéro'],
  ['DE', '015112345678', '4915112345678', 'préfixe national 0 retiré'],
  ['BE', '0470123456', '32470123456', 'préfixe national 0 retiré'],
  ['CH', '0791234567', '41791234567', 'préfixe national 0 retiré'],
  ['MA', '0612345678', '212612345678', 'préfixe national 0 retiré'],
  ['NL', '0612345678', '31612345678', 'préfixe national 0 retiré'],
  ['AT', '06641234567', '436641234567', 'préfixe national 0 retiré'],
  ['IE', '0851234567', '353851234567', 'préfixe national 0 retiré'],
  /*
   * Le Luxembourg n'a pas de préfixe national, et ses numéros ne commencent
   * pas par zéro : aucun exemple ne peut donc distinguer un `trunk: ''` juste
   * d'un `trunk: '0'` faux. L'exemple couvre l'indicatif, pas le préfixe.
   */
  ['LU', '621123456', '352621123456', 'pas de préfixe national, indicatif à trois chiffres'],
  /*
   * Monaco : huit chiffres, mobiles commençant par 6, et « Long-distance:
   * none » — aucun préfixe national. Vérifié en ligne, parce que c'était la
   * seule entrée de la table que personne n'avait jamais éprouvée.
   * https://en.wikipedia.org/wiki/Telephone_numbers_in_Monaco
   */
  ['MC', '61234567', '37761234567', 'huit chiffres, pas de préfixe national'],
  /*
   * Amérique du Nord. Les numéros sont pris dans la plage 555-01xx, que le
   * plan de numérotation nord-américain réserve à la fiction : ils ne sont
   * attribués à personne.
   */
  ['US', '2015550123', '12015550123', 'dix chiffres, indicatif 1, aucun préfixe à retirer'],
  ['CA', '4165550123', '14165550123', 'même plan que les États-Unis'],
];

test('chaque pays de la table compose son propre exemple', () => {
  for (const [iso, national, attendu, quoi] of EXEMPLES) {
    assert.ok(DIAL_CODES[iso], `${iso} absent de DIAL_CODES`);
    assert.equal(whatsappNumber(national, iso), attendu, `${iso} — ${quoi}`);
  }
});

test('chaque entrée de la table a un exemple qui la couvre', () => {
  const couverts = new Set(EXEMPLES.map(([iso]) => iso));
  const orphelins = Object.keys(DIAL_CODES).filter((iso) => !couverts.has(iso));
  assert.deepEqual(
    orphelins,
    [],
    `pays sans exemple : ${orphelins.join(', ')} — une entrée non éprouvée est une entrée non vérifiée`,
  );
});

test('en Amérique du Nord, le 1 en tête ne se double pas', () => {
  // Les clients écrivent leur numéro des deux façons. Préfixer sans regarder
  // donnait un numéro à douze chiffres, plausible, et qui n'est celui de
  // personne — le pire cas : pas une erreur, un inconnu.
  assert.equal(whatsappNumber('4783490262', 'US'), '14783490262');
  assert.equal(whatsappNumber('1 478 349 0262', 'US'), '14783490262');
  assert.equal(whatsappNumber('(478) 349-0262', 'US'), '14783490262');
  assert.equal(whatsappNumber('+1 478 349 0262', 'US'), '14783490262');

  // Un indicatif régional ne commence jamais par 0 ni par 1 : ce qui n'a pas
  // la bonne forme est refusé plutôt que complété.
  assert.equal(whatsappNumber('0783490262', 'US'), null);
  assert.equal(whatsappNumber('478349026', 'US'), null);
  assert.equal(whatsappNumber('147834902621', 'US'), null);
});

test('un numéro déjà international passe sans connaître le pays', () => {
  // C'est le seul chemin qui fonctionne aujourd'hui hors des pays connus, et
  // il explique pourquoi le même client est joignable ou non selon la façon
  // dont son numéro a été saisi dans Shopify.
  assert.equal(whatsappNumber('+1 478 349 0262', 'US'), '14783490262');
  assert.equal(whatsappNumber('001 478 349 0262', 'US'), '14783490262');
});

test('un pays inconnu refuse de composer plutôt que de deviner', () => {
  // Refuser est le bon réflexe : préfixer au hasard ouvrirait une conversation
  // avec un inconnu. C'est le message affiché qui doit dire la vérité, pas la
  // prudence qui doit céder.
  assert.equal(whatsappNumber('4783490262', 'ZZ'), null);
  assert.equal(whatsappNumber('0612345678', null), null);
});

test('ce qui n’est pas un numéro ne devient pas un numéro', () => {
  assert.equal(whatsappNumber('', 'FR'), null);
  assert.equal(whatsappNumber('   ', 'FR'), null);
  assert.equal(whatsappNumber('12', 'FR'), null);
  assert.equal(whatsappNumber('abc', 'FR'), null);
});
