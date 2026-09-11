import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

/*
 * La fiche commande, côté marchand.
 *
 * CE QUE CES TESTS PROTÈGENT. Un numéro de suivi saisi par l'atelier
 * n'arrive chez Shopify qu'au dernier colis de la commande — et jamais en
 * mode test. La section « Colis » de la fiche, qui ne lisait que Shopify,
 * annonçait alors « Aucun numéro de suivi » pendant que le numéro traînait
 * tout en bas, sous un autre titre. Un marchand qui répond à un client
 * « où est mon colis ? » lit la section Colis, pas le bas de la fiche.
 */

const lire = (chemin: string) =>
  readFileSync(fileURLToPath(new URL(`../${chemin}`, import.meta.url)), 'utf8');
const app = lire('public/app.js');

/** Le calcul des lignes « Colis », exécuté pour de vrai sur des données de test. */
function lignesColis(order: object, atelier: object[]): string {
  const debut = app.indexOf('  const expeditions = (order.fulfillments');
  const fin = app.indexOf('  const parcels = parcelsShopify + parcelsAtelier;');
  assert.ok(debut > 0 && fin > debut, 'calcul des colis introuvable');
  return new Function(
    'order',
    'atelier',
    'esc',
    'SHIPMENT_LABELS',
    `${app.slice(debut, fin)} return parcelsShopify + parcelsAtelier;`,
  )(order, atelier, (texte: unknown) => String(texte ?? ''), {}) as string;
}

const colisAtelier = { trackingNumber: 'TEST-13811', carrier: null, index: 1, total: 1, photoMime: null, test: true };

test('un colis saisi par l’atelier apparaît dans la section Colis', () => {
  const lignes = lignesColis({ fulfillments: [] }, [colisAtelier]);
  assert.match(lignes, /data-track="TEST-13811"/);
  assert.match(lignes, /pas encore dans Shopify/);
});

test('un colis saisi en mode test porte l’étiquette « test »', () => {
  assert.match(lignesColis({ fulfillments: [] }, [colisAtelier]), /tone-wait">test</);
  assert.equal(
    /tone-wait">test</.test(lignesColis({ fulfillments: [] }, [{ ...colisAtelier, test: false }])),
    false,
  );
});

test('un numéro que Shopify connaît déjà n’est pas répété', () => {
  // Même numéro, écrit autrement : espaces et minuscules ne font pas un
  // second colis.
  const lignes = lignesColis(
    { fulfillments: [{ trackingNumber: 'test 13811', trackingCompany: 'UPS', displayStatus: null }] },
    [{ ...colisAtelier, trackingNumber: 'TEST13811' }],
  );
  assert.equal(lignes.match(/data-track=/g)?.length, 1);
  assert.equal(/pas encore dans Shopify/.test(lignes), false);
});

test('la fiche passe les colis de l’atelier à la section Colis, et n’a plus de section à part', () => {
  assert.match(app, /orderDetailMarkup\(order, parcels\)/);
  assert.equal(app.includes('"Colis saisis par l\'atelier"'), false);
});

test('le serveur dit quels colis viennent du mode test', () => {
  const route = lire('src/routes/commerce.ts');
  const colis = route.slice(route.indexOf('prisma.parcel.findMany({', route.indexOf("'/api/orders/:id'")));
  assert.match(colis.slice(0, colis.indexOf('}),')), /test: true/);
});

test('le bloc d’actions de la fiche s’aligne sur les autres cartes', () => {
  // Il dépassait de 14 px de chaque côté et se faisait couper au bord droit.
  const css = lire('public/styles.css');
  // Ancré sur ce qui précède un sélecteur — fin de règle ou de commentaire —
  // pour ne pas lire un sélecteur plus long qui le contiendrait.
  const regle = css.match(/(?:^|\}|\*\/)\s*\.sheet-group\.sheet-acts\s*\{([^}]*)\}/);
  assert.ok(regle, 'règle d’alignement absente');
  assert.match(regle[1]!, /margin: 0;/);
});
