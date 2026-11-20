import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

/*
 * L'écran Stock, ligne par ligne.
 *
 * CE QUE CES TESTS PROTÈGENT.
 *  - Une paire proposée à une commande affichait « À envoyer » alors que le
 *    compteur « À expédier » et le filtre « Non envoyé » disaient zéro : ils
 *    ne comptaient que les paires déjà confiées.
 *  - Étiquettes et boutons se suivaient dans un ordre qui changeait d'une
 *    ligne à l'autre ; « Voir » n'était jamais au même endroit.
 *  - Une paire « chez vous » confiée à une commande affichait « — » à la place
 *    du pays : l'écran montrait le pays de la paire, pas celui de la commande.
 */

const lire = (chemin: string) =>
  readFileSync(fileURLToPath(new URL(`../${chemin}`, import.meta.url)), 'utf8');

const app = lire('public/app.js');
const css = lire('public/styles.css');
const routes = lire('src/routes/returns.ts');

/** Une déclaration `const nom = …;` d'une ligne, telle qu'elle est dans app.js. */
const constante = (nom: string) => {
  const debut = app.indexOf(`const ${nom} = `);
  assert.ok(debut >= 0, `${nom} introuvable`);
  return app.slice(debut, app.indexOf('\n', debut));
};
const fonction = (signature: string) => {
  const debut = app.indexOf(signature);
  assert.ok(debut >= 0, `${signature} introuvable`);
  return app.slice(debut, app.indexOf('\n}\n', debut) + 2);
};

const { stockAEnvoyer, filtrerStock, libelleDeclinaison, RANG_ETAT_STOCK } = new Function(
  `${constante('RANG_ETAT_STOCK')}\n${constante('stockAEnvoyer')}\n${constante('libelleDeclinaison')}\n${fonction('function filtrerStock(')}
   return { stockAEnvoyer, filtrerStock, libelleDeclinaison, RANG_ETAT_STOCK };`,
)() as {
  stockAEnvoyer: (l: { etat: string }) => boolean;
  filtrerStock: (lignes: Array<{ etat: string }>, filtre: string) => Array<{ etat: string }>;
  libelleDeclinaison: (v: string | null) => string | null;
  RANG_ETAT_STOCK: Record<string, number>;
};

const lignes = [{ etat: 'stock' }, { etat: 'match' }, { etat: 'aexpedier' }, { etat: 'envoye' }, { etat: 'envoye' }];

test('« À envoyer » compte la paire proposée comme la paire confiée', () => {
  assert.deepEqual(lignes.map(stockAEnvoyer), [false, true, true, false, false]);
  // Le filtre « Non envoyé » montre exactement les lignes dont le menu dit « À envoyer ».
  assert.deepEqual(filtrerStock(lignes, 'nonenvoye').map((l) => l.etat), ['match', 'aexpedier']);
  assert.deepEqual(filtrerStock(lignes, 'match').map((l) => l.etat), ['match']);
  assert.deepEqual(filtrerStock(lignes, 'envoye').map((l) => l.etat), ['envoye', 'envoye']);
  assert.equal(filtrerStock(lignes, 'tout').length, 5);
  // « En stock » : les paires encore là, proposées ou non.
  assert.deepEqual(filtrerStock(lignes, 'stock').map((l) => l.etat), ['stock', 'match']);
});

test('ce qui attend un geste est en haut, ce qui est parti en bas', () => {
  assert.equal(RANG_ETAT_STOCK.match, RANG_ETAT_STOCK.aexpedier);
  assert.ok(RANG_ETAT_STOCK.match < RANG_ETAT_STOCK.stock);
  assert.ok(RANG_ETAT_STOCK.stock < RANG_ETAT_STOCK.envoye);
  assert.match(
    fonction('function lignesStock('),
    /RANG_ETAT_STOCK\[a\.etat\] - RANG_ETAT_STOCK\[b\.etat\] \|\|\s+\(a\.etat === 'envoye' \? new Date\(b\.item\.reshippedAt\) - new Date\(a\.item\.reshippedAt\) : 0\)/,
  );
});

test('une pointure seule se lit « Taille 42.5 », une déclinaison complète reste telle quelle', () => {
  assert.equal(libelleDeclinaison('42.5'), 'Taille 42.5');
  assert.equal(libelleDeclinaison('36'), 'Taille 36');
  assert.equal(libelleDeclinaison('49,5'), 'Taille 49,5');
  assert.equal(libelleDeclinaison('Kaki / 42'), 'Kaki / 42');
  assert.equal(libelleDeclinaison('XL'), 'XL');
  assert.equal(libelleDeclinaison('2026'), '2026');
});

test('chaque ligne a ses quatre cases dans le même ordre : paire, commande, envoi, Voir', () => {
  const rendu = fonction('function renderReturnStock(');
  const ordre = ['<div class="stk-paire">', '<div class="stk-cmd">', '<div class="stk-envoi-col">', 'class="btn btn-small stk-voir"'].map((morceau) => {
    const ou = rendu.indexOf(morceau);
    assert.ok(ou >= 0, `${morceau} introuvable`);
    return ou;
  });
  assert.deepEqual(ordre, [...ordre].sort((a, b) => a - b));
  assert.match(rendu, /<div class="stk-entete" aria-hidden="true"><span>Paire<\/span><span>Commande<\/span><span>Envoi<\/span><span><\/span><\/div>/);
  // Un seul état par ligne : le menu si la paire a une commande, « En stock » sinon.
  assert.match(rendu, /: '<span class="stk-etat">En stock<\/span>'/);
  assert.doesNotMatch(rendu, /ret-tag \$\{ton\}/);
  // L'en-tête et les lignes partagent les mêmes colonnes : c'est ce qui aligne.
  assert.match(css, /\.stk-entete, \.stk-ligne \{\s+display: grid; align-items: center; column-gap: 20px;\s+grid-template-columns: minmax\(0, 2\.3fr\) minmax\(0, 1\.1fr\) minmax\(0, 1\.5fr\) 72px;/);
});

test('la ligne entière déplie le détail, sans voler le clic des menus ni du détail', () => {
  assert.match(fonction('function renderReturnStock('), /data-stk-ligne="\$\{esc\(item\.id\)\}"/);
  assert.match(
    app,
    /const ligneStock = voir \? null : event\.target\.closest\('\[data-stk-ligne\]'\);\n\s+if \(ligneStock && event\.target\.closest\('button, select, a, input, label, \.stk-detail'\)\) return;/,
  );
});

test('au téléphone : la paire et « Voir », puis la commande et son envoi', () => {
  const tel = css.slice(css.indexOf('TÉLÉPHONE — Retour, Stock, Commandes du jour'));
  assert.match(tel, /\.stk-entete \{ display: none; \}/);
  // Trois colonnes : un envoi large (menu + transporteur) ne rétrécit pas le nom de la paire.
  assert.match(tel, /grid-template-columns: minmax\(0, 1fr\) auto auto; gap: 10px 12px; padding: 12px 14px;\s+grid-template-areas: "paire paire voir" "cmd envoi envoi";/);
});

test('le pays affiché est celui où part la commande, noté quand la paire est confiée', () => {
  assert.match(fonction('function lignesStock('), /pays: item\.reusedCountry \?\? null,/);
  assert.match(lire('prisma/schema.prisma'), /\n  reusedCountry String\?\n/);
  assert.match(
    lire('prisma/migrations/20261120090000_pays_commande_servie/migration.sql'),
    /ALTER TABLE "ReturnCase" ADD COLUMN "reusedCountry" TEXT;/,
  );
  // Noté à la réservation ; si Shopify ne répond pas, la paire reste confiée.
  const reemploi = routes.slice(routes.indexOf("'/api/returns/reemploi',"), routes.indexOf("'/api/returns/reemploi/expedier'"));
  assert.match(reemploi, /await noterPaysServies\(merchantId, \[orderId\]\)\.catch\(\(\) => \{\}\);/);
  // Rendue au stock, la paire n'a plus de commande : plus de pays non plus.
  assert.equal((routes.match(/reusedShopifyOrderId: null, reusedCountry: null, reusedAt: null/g) ?? []).length, 2);
});

test('les paires confiées avant : leur pays se lit une fois dans Shopify, puis reste', () => {
  const route = routes.slice(routes.indexOf("app.get('/api/returns/stock/pays'"), routes.indexOf("app.get('/api/returns/matches'"));
  assert.match(route, /where: \{ merchantId, reusedShopifyOrderId: \{ not: null \}, reusedCountry: null \}/);
  const aide = routes.slice(routes.indexOf('async function noterPaysServies('), routes.indexOf('\n}\n', routes.indexOf('async function noterPaysServies(')));
  assert.match(aide, /data: \{ reusedCountry: pays \}/);
  // Une commande que Shopify ne connaît plus n'est pas redemandée à chaque visite.
  assert.match(aide, /paysIntrouvable\.set\(`\$\{merchantId\}\|\$\{orderId\}`, maintenant \+ 30 \* 60_000\);/);
  // L'écran ne l'appelle que s'il voit une paire sans pays, et une seule fois pour le même lot.
  assert.match(
    fonction('function renderReturnStock('),
    /const sansPays = confiees\.filter\(\(l\) => !l\.item\.reusedCountry\)[\s\S]{0,80}\n\s+if \(sansPays && r\.stockPaysCle !== sansPays\) \{\n\s+r\.stockPaysCle = sansPays;\n\s+void api\('\/api\/returns\/stock\/pays'\)/,
  );
});
