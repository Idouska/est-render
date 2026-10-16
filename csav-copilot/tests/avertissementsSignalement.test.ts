import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { verifierAdresse, verifierTelephone } from '../public/workspace.verif.js';
import { STRINGS } from '../public/workspace.i18n.js';

/*
 * Les repères orange de « Signaler un problème » : ce qui cloche
 * probablement dans le numéro ou l'adresse de la commande.
 *
 * CE QUE CES TESTS PROTÈGENT. D'abord qu'un numéro ou une adresse juste ne
 * déclenche rien, y compris à l'étranger : un faux avertissement ferait
 * signaler une commande correcte. Ensuite que les cas évidents — un chiffre
 * en moins, pas de numéro de rue — soient bien vus.
 */

const cles = (avertissements: Array<{ cle: string }>) => avertissements.map((a) => a.cle);

test('un numéro juste ne déclenche rien, en France comme ailleurs', () => {
  for (const [numero, pays] of [
    ['+33 6 12 34 56 78', 'France'],
    ['+33 (0)6 12 34 56 78', 'France'],
    ['06 12 34 56 78', 'France'],
    ['0033 6 12 34 56 78', 'France'],
    ['+32 471 23 45 67', 'Belgium'],
    ['0471 23 45 67', 'Belgium'],
    ['+41 79 123 45 67', 'Switzerland'],
    ['+44 20 7946 0958', 'United Kingdom'],
    ['+1 415 555 0132', 'United States'],
    ['+86 138 0013 8000', 'China'],
    ['+351 912 345 678', 'Portugal'],
    // Longueur variable : on n'en dit rien.
    ['+49 30 1234567', 'Germany'],
    ['+39 06 1234 5678', 'Italy'],
  ]) {
    assert.deepEqual(verifierTelephone(numero, pays), [], `${numero} (${pays})`);
  }
  assert.deepEqual(verifierTelephone('', 'France'), []);
  assert.deepEqual(verifierTelephone(null, null), []);
});

test('un chiffre en moins ou en trop se voit, avec la longueur attendue', () => {
  assert.deepEqual(verifierTelephone('+33 6 12 34 56 7', 'France'), [
    { cle: 'issue.warn.phoneLen', valeurs: { n: 8, attendu: 9 } },
  ]);
  assert.deepEqual(verifierTelephone('06 12 34 56 7', 'France'), [
    { cle: 'issue.warn.phoneLen', valeurs: { n: 8, attendu: 9 } },
  ]);
  assert.deepEqual(verifierTelephone('+1 415 555 013', 'United States'), [
    { cle: 'issue.warn.phoneLen', valeurs: { n: 9, attendu: 10 } },
  ]);
  // Une plage quand le pays en admet deux.
  assert.deepEqual(verifierTelephone('+44 20 794', 'United Kingdom'), [
    { cle: 'issue.warn.phoneLen', valeurs: { n: 5, attendu: '9–10' } },
  ]);
  // Sans règle de pays : seulement l'évidence.
  assert.deepEqual(cles(verifierTelephone('12345', null)), ['issue.warn.phoneShort']);
  assert.deepEqual(cles(verifierTelephone('1234567890123456', null)), ['issue.warn.phoneLong']);
});

test('une adresse complète ne déclenche rien, en France comme ailleurs', () => {
  for (const adresse of [
    { address1: '12 rue des Lilas', zip: '69003', city: 'Lyon', country: 'France' },
    { address1: 'Résidence Les Tilleuls', address2: 'Bât. B, 4 allée des Pins', zip: '69 003', city: 'Lyon', country: 'France' },
    { address1: '221B Baker Street', zip: 'NW1 6XE', city: 'London', country: 'United Kingdom' },
    { address1: 'Rua Augusta 100', zip: '1100-053', city: 'Lisboa', country: 'Portugal' },
    // L'Irlande n'impose pas de code postal.
    { address1: '4 Main Street', zip: '', city: 'Dublin', country: 'Ireland' },
  ]) {
    assert.deepEqual(verifierAdresse(adresse), [], adresse.address1);
  }
  assert.deepEqual(verifierAdresse(null), []);
});

test('ce qui manque à une adresse se voit', () => {
  assert.deepEqual(
    cles(verifierAdresse({ address1: 'Résidence Les Tilleuls', zip: '69003', city: 'Lyon', country: 'France' })),
    ['issue.warn.noNumber'],
  );
  assert.deepEqual(
    cles(verifierAdresse({ address1: '12 rue des Lilas', zip: '6903', city: 'Lyon', country: 'France' })),
    ['issue.warn.zip'],
  );
  assert.deepEqual(
    cles(verifierAdresse({ address1: '', zip: '', city: '', country: 'France' })),
    ['issue.warn.noStreet', 'issue.warn.noZip', 'issue.warn.noCity'],
  );
});

test('les repères s’affichent sous le numéro et l’adresse, dans les trois langues', () => {
  const js = readFileSync(fileURLToPath(new URL('../public/workspace.js', import.meta.url)), 'utf8');
  assert.match(js, /import \{ verifierAdresse, verifierTelephone \} from '\.\/workspace\.verif\.js';/);
  assert.match(js, /\$\{pastillesAvertissement\(verifierTelephone\(tel, order\.shippingAddress\?\.country\)\)\}/);
  assert.match(js, /\$\{adresse \? pastillesAvertissement\(verifierAdresse\(adresse\)\) : ''\}/);
  for (const lang of ['fr', 'en', 'zh'] as const) {
    const table = STRINGS[lang] as Record<string, string>;
    for (const cle of ['phoneLen', 'phoneShort', 'phoneLong', 'noStreet', 'noNumber', 'noZip', 'zip', 'noCity', 'hint']) {
      assert.ok(table[`issue.warn.${cle}`], `${lang} : issue.warn.${cle}`);
    }
    assert.match(table['issue.warn.phoneLen']!, /\{n\}.*\{attendu\}/);
  }
});
