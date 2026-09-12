import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

/*
 * La fenêtre « Nouveau retour ».
 *
 * CE QUE CES TESTS PROTÈGENT. Deux choses s'y jouent, et elles se voient
 * seulement plus tard.
 *
 * L'article qui revient doit être COPIÉ de la commande, pas retapé : le stock
 * retours le retrouve par sa référence, ou par son modèle et sa taille. Un
 * accent ou un tiret de travers, et la paire ne correspondra plus jamais à une
 * commande — elle dormira jusqu'à la fin.
 *
 * Et pour un échange, ce que le client veut à la place doit être noté : sans
 * lui, personne ne sait quoi lui envoyer, et l'outil ne peut pas dire si la
 * paire voulue est déjà dans une agence.
 */

const lire = (chemin: string) =>
  readFileSync(fileURLToPath(new URL(`../${chemin}`, import.meta.url)), 'utf8');
const sansCommentaires = (code: string) =>
  code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/[^\n]*/gm, '');

const app = lire('public/app.js');
const html = lire('public/dashboard.html');

/** Une fonction de l'écran, extraite et exécutée avec de faux champs. */
function fonction(nom: string, champs: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  const debut = app.indexOf(`function ${nom}(`);
  assert.ok(debut > 0, `introuvable : ${nom}`);
  const source = app.slice(debut, app.indexOf('\n}\n', debut) + 2);
  const noms = Object.keys(extra);
  return new Function('$', ...noms, `${source} return ${nom};`)(
    (id: string) => champs[id],
    ...noms.map((cle) => extra[cle]),
  ) as (...args: unknown[]) => unknown;
}

/* ---- ce que la raison entraîne ---- */

test('la conséquence de la raison est dite avant de créer le dossier', () => {
  const champs = { 'ret-f-reason': { value: 'DEFECT' }, 'ret-f-resolution': { value: 'REFUND' } };
  const consequence = fonction('consequenceRetour', champs) as () => string;

  assert.match(consequence(), /ne repartira pas chez un autre client/);

  champs['ret-f-reason'].value = 'SIZE';
  champs['ret-f-resolution'].value = 'EXCHANGE';
  assert.match(consequence(), /rentrera au stock/);

  champs['ret-f-resolution'].value = 'REFUND';
  assert.match(consequence(), /rentrera quand même au stock/);
});

/* ---- le bouton dit ce qui manque ---- */

test('le bouton reste gris tant qu’il manque l’article, ou l’article voulu', () => {
  const champs: Record<string, { value?: string; textContent?: string; disabled?: boolean; hidden?: boolean }> = {
    'ret-f-resolution': { value: 'EXCHANGE' },
    'ret-f-product': { value: '' },
    'ret-f-want-title': { value: '' },
    'ret-f-consequence': { textContent: '' },
    'ret-f-veut': { hidden: false },
    'ret-f-manque': { textContent: '' },
    'ret-f-save': { disabled: false },
    'ret-f-reason': { value: 'SIZE' },
  };
  // La conséquence est éprouvée par son propre test : ici, un texte suffit.
  const maj = fonction('majRetourFormulaire', champs, {
    consequenceRetour: () => 'conséquence',
  }) as () => void;

  maj();
  assert.match(champs['ret-f-manque']!.textContent!, /l’article qui revient/);
  assert.equal(champs['ret-f-save']!.disabled, true);

  champs['ret-f-product']!.value = 'Nike Mind 001';
  maj();
  assert.match(champs['ret-f-manque']!.textContent!, /ce que le client veut/);
  assert.equal(champs['ret-f-save']!.disabled, true);

  champs['ret-f-want-title']!.value = 'Nike Mind 001 Black';
  maj();
  assert.equal(champs['ret-f-manque']!.textContent, '');
  assert.equal(champs['ret-f-save']!.disabled, false);

  // Un remboursement n'attend aucun article voulu.
  champs['ret-f-resolution']!.value = 'REFUND';
  champs['ret-f-want-title']!.value = '';
  maj();
  assert.equal(champs['ret-f-save']!.disabled, false);
  assert.equal(champs['ret-f-veut']!.hidden, true, 'le bloc « ce qu’il veut » disparaît');
});

/* ---- l'article vient de la commande ---- */

test('choisir un article recopie ce que Shopify écrit, et repart de zéro pour l’échange', () => {
  const champs: Record<string, { value?: string; hidden?: boolean; textContent?: string; disabled?: boolean; innerHTML?: string }> = {
    'ret-f-product': { value: '' },
    'ret-f-variant': { value: '' },
    'ret-f-sku': { value: '' },
    'ret-f-want-title': { value: 'ancien choix' },
    'ret-f-want-variant': { value: '42' },
    'ret-f-dispo': { hidden: false },
    'ret-f-resolution': { value: 'REFUND' },
    'ret-f-consequence': { textContent: '' },
    'ret-f-veut': { hidden: false },
    'ret-f-manque': { textContent: '' },
    'ret-f-save': { disabled: true },
    'ret-f-reason': { value: 'SIZE' },
    'ret-f-items': { innerHTML: '' },
  };
  const etat = {
    articles: [{ title: 'Nike Mind 001 Black', variantTitle: '45', sku: 'HQ4307-001', quantity: 1 }],
    choisi: null,
    veutType: 'SIZE',
    couleur: 'une couleur',
    dispo: null,
  };
  const choisir = fonction('choisirArticle', champs, {
    retFormulaire: etat,
    renderReturnItems: () => {},
    majRetourFormulaire: () => {},
    esc: (v: unknown) => String(v ?? ''),
  }) as (index: number, options?: object) => void;

  choisir(0, { silencieux: true });

  assert.equal(champs['ret-f-product']!.value, 'Nike Mind 001 Black');
  assert.equal(champs['ret-f-variant']!.value, '45');
  assert.equal(champs['ret-f-sku']!.value, 'HQ4307-001');
  assert.equal(champs['ret-f-want-title']!.value, '', 'changer d’article oublie l’article voulu');
  assert.equal(etat.couleur, null);
  assert.equal(champs['ret-f-dispo']!.hidden, true);
});

/* ---- ce qui part au serveur ---- */

test('l’article voulu n’est envoyé que pour un échange', () => {
  const sauvegarde = app.slice(app.indexOf("$('ret-f-save').addEventListener"));
  assert.match(sauvegarde, /wantedTitle: echange \? \$\('ret-f-want-title'\)\.value\.trim\(\) \|\| null : null/);
  assert.match(sauvegarde, /wantedVariantTitle: echange \?/);
});

test('la fenêtre est faite de trois temps, et le bouton part désactivé', () => {
  assert.equal((html.match(/class="ret-etape"/g) ?? []).length, 3);
  assert.match(html, /id="ret-f-save" disabled/);
  assert.match(html, /data-veut="SIZE"[\s\S]{0,400}data-veut="COLOR"[\s\S]{0,400}data-veut="BOTH"/);
});

/* ---- le serveur ---- */

const retours = sansCommentaires(lire('src/routes/returns.ts'));

test('la commande rend aussi la photo et la quantité de chaque article', () => {
  const lookup = retours.slice(retours.indexOf("'/api/returns/order-lookup'"));
  assert.match(lookup, /image: item\.image \?\? null/);
  assert.match(lookup, /quantity: item\.quantity/);
});

test('la disponibilité se cherche dans le pays du client, puis chez ses voisins', () => {
  const route = retours.slice(retours.indexOf("'/api/returns/stock-dispo'"), retours.indexOf("'/api/returns/matches'"));
  assert.match(route, /status: 'RESTOCKED', reusedAt: null/, 'seules les paires encore en stock');
  assert.match(route, /correspond\(paireEnStock, ligne\)/, 'la même comparaison que le rapprochement');
  const filtre = route.indexOf('!voisins.includes(paireEnStock.pays)');
  assert.ok(filtre > 0, 'hors du pays et de ses voisins, la paire ne sert pas');
  assert.match(route, /sort\(\(a, b\) => Number\(a\.voisin\) - Number\(b\.voisin\)\)/, 'le même pays d’abord');
});

test('l’article voulu est accepté par le serveur, et gardé au dossier', () => {
  assert.match(retours, /wantedTitle: z\.string\(\)\.max\(300\)\.nullish\(\)/);
  assert.match(retours, /wantedVariantTitle: z\.string\(\)\.max\(120\)\.nullish\(\)/);
  assert.match(lire('prisma/schema.prisma'), /wantedTitle\s+String\?/);
});
