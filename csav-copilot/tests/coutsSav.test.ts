import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  gestesParMois,
  lireCoutsUnitaires,
  montants,
  moisDe,
  moisJusqua,
  type LigneCout,
} from '../src/services/couts/calcul.ts';
import { filtreDuMois, moisVisibles, requeteDesComptes } from '../src/services/couts/commandes.ts';
import { datesDuGeste } from '../src/services/couts/datesRetour.ts';

/*
 * Ce que coûte le SAV, mois par mois.
 *
 * CE QUE CES TESTS PROTÈGENT. Chaque geste coûte le mois où il a lieu, à
 * Paris ; un colis se paie une fois, même quand il porte deux paires ; une
 * paire reçue chez le marchand lui-même ne paie pas d'agence ; les montants
 * tombent juste au centime ; et un taux de retour ne se calcule jamais sur un
 * compte de commandes tronqué par Shopify.
 */

const lire = (chemin: string) =>
  readFileSync(fileURLToPath(new URL(`../${chemin}`, import.meta.url)), 'utf8');

const d = (iso: string) => new Date(iso);

const ligne = (champs: Partial<LigneCout> = {}): LigneCout => ({
  id: champs.id ?? `r${Math.random()}`,
  shopifyOrderId: null,
  orderName: null,
  productTitle: 'Derby Lune',
  reason: 'SIZE',
  agencyId: null,
  createdAt: d('2026-09-10T10:00:00Z'),
  labelSentAt: null,
  receivedAt: null,
  unusableAt: null,
  reusedAt: null,
  exchangeShippedAt: null,
  exchangeSupplierId: null,
  exchangeTrackingNumber: null,
  reshippedAt: null,
  reshipTrackingNumber: null,
  reusedShopifyOrderId: null,
  reusedOrderName: null,
  ...champs,
});

const COUTS = { bonRetour: 6.5, fraisAgence: 3, colisAgence: 7.9, colisAtelier: 12, prixPaire: 24.5 };

test('les coûts saisis se relisent sans jamais casser : manquant, abîmé ou négatif vaut zéro', () => {
  assert.deepEqual(lireCoutsUnitaires({}), { bonRetour: 0, fraisAgence: 0, colisAgence: 0, colisAtelier: 0, prixPaire: 0 });
  assert.deepEqual(lireCoutsUnitaires(null), lireCoutsUnitaires([]));
  const lus = lireCoutsUnitaires({ bonRetour: '6.499', fraisAgence: -2, colisAgence: 'abc', prixPaire: 1e9 });
  assert.equal(lus.bonRetour, 6.5);
  assert.equal(lus.fraisAgence, 0);
  assert.equal(lus.colisAgence, 0);
  assert.equal(lus.prixPaire, 0);
});

test('le mois se lit à Paris, et les douze derniers se suivent sans trou', () => {
  // 22 h 30 UTC le 30 septembre : déjà le 1er octobre à Paris.
  assert.equal(moisDe(d('2026-09-30T22:30:00Z')), '2026-10');
  assert.equal(moisDe(d('2026-12-31T23:30:00Z')), '2027-01');
  assert.deepEqual(moisJusqua('2026-02', 4), ['2025-11', '2025-12', '2026-01', '2026-02']);
  const treize = moisJusqua('2026-10', 13);
  assert.equal(treize.length, 13);
  assert.equal(treize[0], '2025-10');
  assert.equal(treize.at(-1), '2026-10');
});

test('chaque geste coûte le mois où il a lieu', () => {
  const [sept, oct] = gestesParMois(
    [
      ligne({
        createdAt: d('2026-09-28T10:00:00Z'),
        labelSentAt: d('2026-09-29T10:00:00Z'),
        receivedAt: d('2026-10-06T10:00:00Z'),
        agencyId: 'paris',
      }),
    ],
    ['2026-09', '2026-10'],
  );
  assert.equal(sept!.volumes.retours, 1);
  assert.equal(sept!.volumes.bons, 1);
  assert.equal(sept!.volumes.recues, 0);
  assert.equal(oct!.volumes.recues, 1);
  assert.equal(oct!.volumes.retours, 0);
});

test('un bon par commande, un colis par numéro de suivi', () => {
  const [mois] = gestesParMois(
    [
      // Deux paires de la même commande : un seul colis retour, un seul bon.
      ligne({ shopifyOrderId: 'o1', labelSentAt: d('2026-09-12T10:00:00Z') }),
      ligne({ shopifyOrderId: 'o1', labelSentAt: d('2026-09-12T11:00:00Z') }),
      ligne({ shopifyOrderId: 'o2', labelSentAt: d('2026-09-13T10:00:00Z') }),
      // Deux paires du stock pour une commande : un colis.
      ligne({ reshippedAt: d('2026-09-15T10:00:00Z'), reshipTrackingNumber: '6A1' }),
      ligne({ reshippedAt: d('2026-09-15T10:00:00Z'), reshipTrackingNumber: '6A1' }),
      // Un échange du stock (son agence l'expédie) et un échange de l'atelier.
      ligne({ exchangeShippedAt: d('2026-09-20T10:00:00Z'), exchangeTrackingNumber: 'EX1' }),
      ligne({ exchangeShippedAt: d('2026-09-21T10:00:00Z'), exchangeSupplierId: 'nord' }),
    ],
    ['2026-09'],
  );
  assert.equal(mois!.volumes.bons, 2);
  assert.equal(mois!.volumes.renvois, 2);
  assert.equal(mois!.volumes.echangesStock, 1);
  assert.equal(mois!.volumes.echangesAtelier, 1);
  assert.equal(mois!.volumes.colisAgence, 2);
  assert.equal(mois!.volumes.colisAtelier, 1);
});

test('reçue chez le marchand : aucune agence ne facture', () => {
  const [mois] = gestesParMois(
    [
      ligne({ receivedAt: d('2026-09-12T10:00:00Z'), agencyId: 'paris' }),
      ligne({ receivedAt: d('2026-09-12T10:00:00Z'), agencyId: null }),
    ],
    ['2026-09'],
  );
  assert.equal(mois!.volumes.recues, 1);
});

test('perdues et réemployées ; un geste hors de la fenêtre ne compte nulle part', () => {
  const [mois] = gestesParMois(
    [
      ligne({ unusableAt: d('2026-09-12T10:00:00Z') }),
      ligne({ reusedAt: d('2026-09-14T10:00:00Z') }),
      ligne({ reusedAt: d('2026-09-15T10:00:00Z') }),
      ligne({ createdAt: d('2025-01-01T10:00:00Z'), unusableAt: d('2025-02-01T10:00:00Z') }),
    ],
    ['2026-09'],
  );
  assert.equal(mois!.volumes.perdues, 1);
  assert.equal(mois!.volumes.reemployees, 2);
  assert.equal(mois!.volumes.retours, 3);
});

test('les motifs du mois, et les modèles les plus retournés avec leur motif principal', () => {
  const [mois] = gestesParMois(
    [
      ligne({ productTitle: 'Derby Lune', reason: 'SIZE' }),
      ligne({ productTitle: 'Derby Lune', reason: 'SIZE' }),
      ligne({ productTitle: 'Derby Lune', reason: 'DEFECT' }),
      ligne({ productTitle: 'Mocassin Sable', reason: 'MODEL' }),
    ],
    ['2026-09'],
  );
  assert.deepEqual(mois!.motifs, { SIZE: 2, DEFECT: 1, MODEL: 1 });
  assert.deepEqual(mois!.modeles, [
    { titre: 'Derby Lune', retours: 3, motif: 'SIZE' },
    { titre: 'Mocassin Sable', retours: 1, motif: 'MODEL' },
  ]);
});

test('les montants tombent au centime, poste par poste', () => {
  const volumes = {
    retours: 10,
    bons: 3,
    recues: 4,
    echangesAtelier: 1,
    echangesStock: 1,
    renvois: 2,
    colisAgence: 2,
    colisAtelier: 1,
    perdues: 1,
    reemployees: 3,
  };
  const m = montants(volumes, COUTS);
  assert.equal(m.retours, 3 * 650 + 4 * 300);
  assert.equal(m.renvois, 2 * 790 + 1 * 1200 + 1 * 2450);
  assert.equal(m.perdues, 2450);
  assert.equal(m.total, m.retours + m.renvois + m.perdues);
  assert.equal(m.economie, 3 * 2450);
  assert.equal(m.net, m.total - m.economie);
  // 0,10 € trois fois : 30 centimes, pas 30,000000000000004.
  assert.equal(montants({ ...volumes, bons: 3, recues: 0 }, { ...COUTS, bonRetour: 0.1 }).retours, 30);
});

test('les dates d’un retour : posées une fois, effacées quand le geste est défait', () => {
  const vide = { labelSentAt: null, receivedAt: null, unusableAt: null };
  const maintenant = d('2026-10-02T10:00:00Z');
  const hier = d('2026-10-01T10:00:00Z');

  assert.deepEqual(datesDuGeste(vide, { labelSent: true }, maintenant), { labelSentAt: maintenant });
  assert.deepEqual(datesDuGeste({ ...vide, labelSentAt: hier }, { labelSent: true }, maintenant), {});
  assert.deepEqual(datesDuGeste({ ...vide, labelSentAt: hier }, { labelSent: false }, maintenant), { labelSentAt: null });

  assert.deepEqual(datesDuGeste(vide, { status: 'RECEIVED' }, maintenant), { receivedAt: maintenant });
  // Remis en stock après réception : la réception garde son jour.
  assert.deepEqual(datesDuGeste({ ...vide, receivedAt: hier }, { status: 'RESTOCKED' }, maintenant), {});
  // « Reçu » par erreur, ramené à « en transit » : l'agence n'a rien reçu.
  assert.deepEqual(datesDuGeste({ ...vide, receivedAt: hier }, { status: 'IN_TRANSIT' }, maintenant), { receivedAt: null });

  assert.deepEqual(datesDuGeste(vide, { status: 'UNUSABLE' }, maintenant), { receivedAt: maintenant, unusableAt: maintenant });
  const perdue = { ...vide, receivedAt: hier, unusableAt: hier };
  assert.deepEqual(datesDuGeste(perdue, { status: 'CLOSED' }, maintenant), {});
  assert.deepEqual(datesDuGeste(perdue, { status: 'RESTOCKED' }, maintenant), { unusableAt: null });
});

test('Shopify : seuls les mois qu’il montre en entier, en une requête', () => {
  const maintenant = d('2026-10-02T10:00:00Z');
  const mois = moisJusqua('2026-10', 13);
  assert.deepEqual(moisVisibles(mois, maintenant, false), ['2026-09', '2026-10']);
  assert.equal(moisVisibles(mois, maintenant, true).length, 13);
  // Les bornes de Paris, en instants UTC.
  assert.equal(filtreDuMois('2026-10'), "created_at:>='2026-09-30T22:00:00.000Z' created_at:<'2026-10-31T23:00:00.000Z'");
  assert.match(requeteDesComptes(2), /query CommandesParMois\(\$q0: String!, \$q1: String!\)/);
  assert.match(requeteDesComptes(2), /m1: ordersCount\(query: \$q1\) \{ count precision \}/);
  // Un compte « au moins » ne sert pas de diviseur.
  assert.match(lire('src/services/couts/commandes.ts'), /if \(compte && compte\.precision === 'EXACT'\) comptes\[m\] = compte\.count;/);
});

test('les dates se posent là où les gestes se font, et seuls les retours comptent', () => {
  const retours = lire('src/routes/returns.ts');
  assert.match(retours, /const dates = datesDuGeste\(existing, fields, new Date\(\)\);/);
  assert.match(retours, /\.\.\.\(paire\.receivedAt \? \{\} : \{ receivedAt: new Date\(\) \}\),/);
  assert.match(lire('src/services/couts/donnees.ts'), /origine: 'RETOUR',/);
  const migration = lire('prisma/migrations/20261013090000_couts_sav/migration.sql');
  assert.match(migration, /ADD COLUMN "labelSentAt" TIMESTAMP\(3\);/);
  assert.match(migration, /ADD COLUMN "receivedAt" TIMESTAMP\(3\);/);
  assert.match(migration, /ADD COLUMN "coutsSav" JSONB NOT NULL DEFAULT '\{\}';/);
});

test('l’API : tout le monde lit, seuls propriétaire et superviseurs règlent les prix', () => {
  const routes = lire('src/routes/couts.ts');
  assert.match(routes, /app\.addHook\('preHandler', requireSession\);/);
  assert.match(routes, /app\.put\('\/api\/couts\/unitaires', \{ preHandler: requirePermission\('configure'\) \}/);
  assert.match(lire('src/server.ts'), /await app\.register\(coutsRoutes\);/);
});

test('l’écran : dans Pilotage, ses coûts unitaires, et les mêmes clés que le serveur', () => {
  const app = lire('public/app.js');
  const page = lire('public/dashboard.html');
  assert.match(app, /couts: \{\s*icon: 'euro',\s*label: 'Coûts SAV',\s*group: 'Pilotage',/);
  assert.match(app, /couts: \(\) => loadCouts\(\),/);
  assert.match(page, /<section class="browse couts" id="view-couts" hidden aria-label="Coûts du SAV">/);
  // La copie de l'écran suit la liste du serveur, et chaque clé a son champ.
  const copie = /const CLES_COUTS = \[([^\]]+)\];/.exec(app)?.[1];
  const serveur = /export const CLES_COUTS = \[([^\]]+)\] as const;/.exec(lire('src/services/couts/calcul.ts'))?.[1];
  assert.ok(copie && serveur);
  assert.equal(copie, serveur);
  for (const cle of copie.match(/'(\w+)'/g)!.map((c) => c.slice(1, -1))) {
    assert.match(page, new RegExp(`<input id="cu-${cle}" type="text" inputmode="decimal"`));
  }
  // Seuls ceux qui règlent la boutique voient le bouton.
  assert.match(app, /\$\('couts-reglages'\)\.hidden = !canI\('configure'\);/);
});

test('le graphe : couleurs validées dans les deux thèmes, tableau jumeau, infobulle au clavier', () => {
  const css = lire('public/styles.css');
  const app = lire('public/app.js');
  for (const [classe, clair, sombre] of [
    ['cg-s1', '#2a78d6', '#3987e5'],
    ['cg-s2', '#eb6834', '#d95926'],
    ['cg-s3', '#1baf7a', '#199e70'],
  ]) {
    assert.match(css, new RegExp(`\\n\\.${classe} \\{ background: ${clair}; \\}`));
    assert.match(css, new RegExp(`\\[data-theme="dark"\\] \\.${classe} \\{ background: ${sombre}; \\}`));
  }
  // Barres d'au plus 24 px, bout arrondi, base carrée.
  assert.match(css, /\.cg-pile \{ position: relative; width: min\(24px, 64%\); height: var\(--cg-h\); \}/);
  assert.match(css, /\.cg-seg\.cg-bout \{ border-radius: 4px 4px 0 0; \}/);
  // Le tableau existe à côté du graphe, et l'infobulle vient au survol comme au focus.
  assert.match(app, /\$\('couts-table'\)\.innerHTML = coutsTableHtml\(affiches\);/);
  assert.match(app, /graphe\.addEventListener\('pointerover',/);
  assert.match(app, /graphe\.addEventListener\('focusin',/);
  // Les noms entrent dans l'infobulle comme du texte, jamais comme du HTML.
  const bulle = app.slice(app.indexOf('function montrerBulleCouts'), app.indexOf('function cacherBulleCouts'));
  assert.doesNotMatch(bulle, /innerHTML/);
});
