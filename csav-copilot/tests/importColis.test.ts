import assert from 'node:assert/strict';
import test from 'node:test';

import {
  lireCollage,
  normaliserCommande,
  planifierLot,
  type ColisExistant,
  type CommandeVisible,
} from '../src/services/suppliers/importColis.ts';

/*
 * L'import de numéros de suivi en masse.
 *
 * CE QUE CES TESTS PROTÈGENT. Chaque ligne prête devient un colis, et le
 * dernier colis d'une commande la fait expédier sur Shopify, qui écrit au
 * client. Une erreur ici ne se rattrape pas : un numéro posé sur la mauvaise
 * commande envoie à un client le suivi d'un autre, et le mail est parti.
 *
 * D'où la prudence de chaque règle : ne jamais deviner une commande, ne
 * jamais réutiliser un numéro déjà attribué, ne jamais ajouter de colis à
 * une commande déjà partie — et que réimporter le même fichier ne fasse rien.
 */

/* ---- la lecture du collage ---- */

test('un collage depuis Excel se lit en trois colonnes', () => {
  const lignes = lireCollage('#13811\t1Z999AA10123456784\tUPS\n13812\tLX123456789CN\t');

  assert.deepEqual(lignes, [
    { rang: 1, commande: '#13811', suivi: '1Z999AA10123456784', transporteur: 'UPS' },
    { rang: 2, commande: '13812', suivi: 'LX123456789CN', transporteur: null },
  ]);
});

test('un fichier CSV se lit aussi, avec ; ou ,', () => {
  assert.equal(lireCollage('13811;ABC123;DHL')[0]!.transporteur, 'DHL');
  assert.equal(lireCollage('13811,ABC123,DHL')[0]!.suivi, 'ABC123');
  assert.equal(lireCollage('"13811";"ABC123"')[0]!.suivi, 'ABC123', 'les guillemets CSV sont retirés');
});

test('la ligne d’en-têtes est sautée, en français comme ailleurs', () => {
  for (const entete of ['Commande\tSuivi\tTransporteur', 'Order;Tracking', '订单\t运单号']) {
    const lignes = lireCollage(`${entete}\n13811\tABC123`);
    assert.equal(lignes.length, 1, `« ${entete} » doit être reconnu comme en-tête`);
    assert.equal(lignes[0]!.rang, 2, 'le rang reste celui qu’on lit dans Excel');
  }
});

test('une première ligne mal tapée n’est pas prise pour un en-tête', () => {
  // « 13 811 » contient des chiffres : c'est une commande mal saisie, qu'il
  // faut MONTRER comme invalide plutôt que jeter en silence.
  const lignes = lireCollage('13 811\tABC123\n13812\tDEF456');
  assert.equal(lignes.length, 2);
  assert.equal(lignes[0]!.commande, '13 811');
});

test('un en-tête plus bas dans le collage est une ligne à signaler', () => {
  const lignes = lireCollage('13811\tABC123\nCommande\tSuivi');
  assert.equal(lignes.length, 2, 'seule la première ligne peut être un en-tête');
});

test('les espaces d’un numéro de suivi sont retirés', () => {
  // Les transporteurs impriment « 1Z99 9AA1 0123 » ; le suivi reconnaît le
  // même numéro sans espace.
  assert.equal(lireCollage('13811\t1Z99 9AA1 0123 4567')[0]!.suivi, '1Z999AA101234567');
});

test('les lignes vides sont ignorées, sans décaler les rangs', () => {
  const lignes = lireCollage('13811\tABC123\n\n   \n13812\tDEF456\n');
  assert.deepEqual(lignes.map((ligne) => ligne.rang), [1, 4]);
});

test('le numéro de commande se normalise comme Shopify le nomme', () => {
  assert.equal(normaliserCommande('13811'), '#13811');
  assert.equal(normaliserCommande('#13811'), '#13811');
  assert.equal(normaliserCommande('# 13 811'), '#13811');
  assert.equal(normaliserCommande('abc'), null);
  assert.equal(normaliserCommande('12'), null, 'trop court pour être un numéro de commande');
});

/* ---- le plan ---- */

const visibles: CommandeVisible[] = [
  { id: 'gid://shopify/Order/1', name: '#13811', client: 'Mahdi Ashir' },
  { id: 'gid://shopify/Order/2', name: '#13812', client: 'Léa Charpentier' },
  { id: 'gid://shopify/Order/3', name: '#13813', client: 'Robert Brooks' },
];

const ligne = (rang: number, commande: string, suivi: string) => ({
  rang,
  commande,
  suivi,
  transporteur: null,
});

test('une ligne complète sur une commande visible est prête, et l’expédie', () => {
  const plan = planifierLot([ligne(1, '13811', 'ABC123')], visibles, []);

  assert.equal(plan.lignes[0]!.statut, 'pret');
  assert.equal(plan.lignes[0]!.shopifyOrderId, 'gid://shopify/Order/1');
  assert.equal(plan.lignes[0]!.client, 'Mahdi Ashir');
  assert.deepEqual([plan.lignes[0]!.index, plan.lignes[0]!.total], [1, 1]);
  assert.equal(plan.expediees, 1, 'le client recevra son mail : l’écran doit l’annoncer');
});

test('une commande qui n’est pas celle de l’atelier ne reçoit rien', () => {
  // Ne jamais deviner : un numéro posé sur la mauvaise commande envoie à un
  // client le suivi d'un autre.
  const plan = planifierLot([ligne(1, '99999', 'ABC123')], visibles, []);
  assert.equal(plan.lignes[0]!.statut, 'introuvable');
  assert.equal(plan.prets, 0);
});

test('une ligne sans numéro de suivi, ou avec un numéro absurde, est invalide', () => {
  const plan = planifierLot(
    [ligne(1, '13811', ''), ligne(2, '13811', 'AB'), ligne(3, 'abc', 'ABC123')],
    visibles,
    [],
  );
  assert.deepEqual(plan.lignes.map((l) => l.statut), ['invalide', 'invalide', 'invalide']);
});

test('un numéro collé deux fois ne crée qu’un colis', () => {
  const plan = planifierLot(
    [ligne(1, '13811', 'ABC123'), ligne(2, '13812', 'ABC123')],
    visibles,
    [],
  );
  assert.deepEqual(plan.lignes.map((l) => l.statut), ['pret', 'doublon']);
});

test('réimporter le même fichier ne crée rien la seconde fois', () => {
  const existants: ColisExistant[] = [
    { shopifyOrderId: 'gid://shopify/Order/1', trackingNumber: 'ABC123', index: 1, total: 1 },
  ];
  const plan = planifierLot([ligne(1, '13811', 'ABC123')], visibles, existants);

  assert.equal(plan.lignes[0]!.statut, 'deja_saisi');
  assert.equal(plan.prets, 0);
  assert.equal(plan.expediees, 0, 'aucun second mail au client');
});

test('un numéro déjà attribué à une AUTRE commande est refusé', () => {
  // Le coller sur une seconde commande enverrait au client le suivi d'un
  // autre colis.
  const existants: ColisExistant[] = [
    { shopifyOrderId: 'gid://shopify/Order/2', trackingNumber: 'ABC123', index: 1, total: 1 },
  ];
  const plan = planifierLot([ligne(1, '13811', 'ABC123')], visibles, existants);
  assert.equal(plan.lignes[0]!.statut, 'deja_utilise');
});

test('une commande déjà complète ne reçoit pas de colis de plus', () => {
  const existants: ColisExistant[] = [
    { shopifyOrderId: 'gid://shopify/Order/1', trackingNumber: 'OLD001', index: 1, total: 1 },
  ];
  const plan = planifierLot([ligne(1, '13811', 'NEW002')], visibles, existants);
  assert.equal(plan.lignes[0]!.statut, 'deja_expediee');
});

test('les lignes d’une même commande comblent d’abord les rangs vides', () => {
  // Trois colis annoncés, le premier déjà saisi : l'import doit prendre les
  // rangs 2 et 3, pas 2 et 3 d'un nouveau total.
  const existants: ColisExistant[] = [
    { shopifyOrderId: 'gid://shopify/Order/1', trackingNumber: 'PK1001', index: 1, total: 3 },
  ];
  const plan = planifierLot(
    [ligne(1, '13811', 'PK1002'), ligne(2, '13811', 'PK1003')],
    visibles,
    existants,
  );

  assert.deepEqual(plan.lignes.map((l) => [l.index, l.total]), [[2, 3], [3, 3]]);
  assert.equal(plan.expediees, 1, 'les trois rangs sont pris : la commande part');
});

test('une commande à moitié remplie n’est pas annoncée comme expédiée', () => {
  // Trois colis annoncés, un seul fourni : la commande ne partira pas encore,
  // aucun mail — l'écran ne doit pas l'annoncer.
  const existants: ColisExistant[] = [
    { shopifyOrderId: 'gid://shopify/Order/1', trackingNumber: 'PK1001', index: 1, total: 3 },
  ];
  const plan = planifierLot([ligne(1, '13811', 'PK1002')], visibles, existants);

  assert.equal(plan.lignes[0]!.statut, 'pret');
  assert.equal(plan.expediees, 0);
});

test('plusieurs lignes sans colis existant deviennent les colis 1 à n', () => {
  const plan = planifierLot(
    [ligne(1, '13812', 'AA2001'), ligne(2, '13812', 'AA2002'), ligne(3, '13813', 'BB3001')],
    visibles,
    [],
  );

  assert.deepEqual(plan.lignes.map((l) => [l.index, l.total]), [[1, 2], [2, 2], [1, 1]]);
  assert.equal(plan.commandes, 2);
  assert.equal(plan.expediees, 2);
  assert.equal(plan.prets, 3);
});
