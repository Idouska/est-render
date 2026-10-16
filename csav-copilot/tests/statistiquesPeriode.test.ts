import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

/*
 * Les statistiques façon Shopify : une période au calendrier, une
 * comparaison, un regroupement.
 *
 * CE QUE CES TESTS PROTÈGENT. Une vente de 23 h 30 à Paris tombe le bon jour,
 * changement d'heure compris ; la comparaison se lit rang pour rang, la
 * semaine d'en face face à sa semaine ; les heures pas encore commencées ne
 * sont pas des zéros ; la première réponse et les brouillons utilisés se
 * rangent par jour. Et l'écran suit la maquette : plus de « À expédier » ni
 * de « Confiance moyenne », chaque carte s'ouvre en grand.
 */

process.env.ENCRYPTION_KEY ??= Buffer.alloc(32, 1).toString('base64');
process.env.APP_URL ??= 'https://example.test';
process.env.DATABASE_URL ??= 'postgresql://u:p@localhost:5432/db';
process.env.REDIS_URL ??= 'redis://localhost:6379';
process.env.SHOPIFY_SCOPES ??= 'read_orders';
process.env.GOOGLE_SCOPES ??= 'https://www.googleapis.com/auth/gmail.readonly';

const { cadres, cleDe, grainParDefaut, lirePeriode, minuitLocal, points } = await import('../src/services/stats/periode.ts');
const { agregerSav } = await import('../src/services/stats/savPeriode.ts');
const { agregerVentes } = await import('../src/services/shopify/ventesPeriode.ts');

const lire = (chemin: string) => readFileSync(fileURLToPath(new URL(`../${chemin}`, import.meta.url)), 'utf8');
const PARIS = 'Europe/Paris';
// Le 16 octobre 2026, 16 h 43 à Paris.
const MAINTENANT = Date.UTC(2026, 9, 16, 14, 43);

function periode(requete: Record<string, string>) {
  const lu = lirePeriode({ tz: PARIS, ...requete }, MAINTENANT);
  assert.ok(lu.ok, 'période refusée');
  return lu.periode;
}

test('les jours se comptent dans le fuseau de celui qui regarde, changement d’heure compris', () => {
  assert.equal(new Date(minuitLocal('2026-10-16', PARIS)).toISOString(), '2026-10-15T22:00:00.000Z');
  // Passage à l'heure d'hiver le 25 octobre : minuit du 26 est à 23 h UTC.
  assert.equal(new Date(minuitLocal('2026-10-26', PARIS)).toISOString(), '2026-10-25T23:00:00.000Z');
  // Un fuseau à la demi-heure.
  assert.equal(new Date(minuitLocal('2026-10-16', 'Asia/Kolkata')).toISOString(), '2026-10-15T18:30:00.000Z');
  // 23 h 30 à Paris le 15 : le 15, pas le 16 comme en UTC… et l'inverse.
  assert.equal(cleDe(Date.UTC(2026, 9, 15, 21, 30), 'jour', PARIS), '2026-10-15');
  assert.equal(cleDe(Date.UTC(2026, 9, 15, 22, 30), 'jour', PARIS), '2026-10-16');
  assert.equal(cleDe(Date.UTC(2026, 9, 15, 22, 30), 'semaine', PARIS), '2026-10-12');
  assert.equal(cleDe(Date.UTC(2026, 9, 15, 22, 30), 'mois', PARIS), '2026-10');
  assert.equal(cleDe(Date.UTC(2026, 9, 15, 22, 30), 'heure', PARIS), '2026-10-16T00');
});

test('les points : tous, même vides, en semaines du lundi et en mois', () => {
  assert.deepEqual(points('2026-09-17', '2026-10-16', 'semaine'), [
    '2026-09-14',
    '2026-09-21',
    '2026-09-28',
    '2026-10-05',
    '2026-10-12',
  ]);
  assert.deepEqual(points('2026-09-17', '2026-10-16', 'mois'), ['2026-09', '2026-10']);
  assert.equal(points('2026-10-10', '2026-10-16', 'heure').length, 7 * 24);
  assert.equal(points('2026-09-17', '2026-10-16', 'jour').length, 30);
});

test('le regroupement suit la période, par heure sur une semaine au plus', () => {
  assert.equal(grainParDefaut(1), 'heure');
  assert.equal(grainParDefaut(30), 'jour');
  assert.equal(grainParDefaut(90), 'semaine');
  assert.equal(grainParDefaut(365), 'mois');
  assert.equal(periode({ debut: '2026-09-17', fin: '2026-10-16', grain: 'heure' }).grain, 'jour');
  assert.equal(periode({ debut: '2026-10-10', fin: '2026-10-16', grain: 'heure' }).grain, 'heure');
});

test('une période se borne : pas après aujourd’hui, un an au plus, dans l’ordre', () => {
  assert.equal(periode({ debut: '2026-10-01', fin: '2026-12-31' }).courante.fin, '2026-10-16');
  const trop = lirePeriode({ debut: '2024-01-01', fin: '2026-10-16' }, MAINTENANT);
  assert.equal(trop.ok, false);
  assert.equal(lirePeriode({ debut: '2026-10-16', fin: '2026-10-01' }, MAINTENANT).ok, false);
  assert.equal(lirePeriode({ debut: '16/10/2026', fin: '2026-10-16' }, MAINTENANT).ok, false);
  // Un fuseau inconnu ne fait pas tomber la page : Paris.
  assert.equal(periode({ debut: '2026-10-16', fin: '2026-10-16', tz: 'Mars/Olympus' }).fuseau, PARIS);
});

test('aujourd’hui : les heures à venir ne sont pas des zéros', () => {
  const p = periode({ debut: '2026-10-16', fin: '2026-10-16' });
  assert.equal(p.grain, 'heure');
  assert.ok(!p.courante.futurs.has('2026-10-16T16'));
  assert.ok(p.courante.futurs.has('2026-10-16T17'));
  // La veille, en face, est passée en entier.
  assert.equal(p.comparee?.debut, '2026-10-15');
  assert.equal(p.comparee?.futurs.size, 0);
});

test('la comparaison se lit rang pour rang : la période précédente, l’an dernier', () => {
  const precedente = periode({ debut: '2026-09-17', fin: '2026-10-16' });
  assert.equal(precedente.comparee?.debut, '2026-08-18');
  assert.equal(precedente.comparee?.fin, '2026-09-16');
  assert.equal(precedente.comparee?.cles.length, 30);

  // En semaines, l'an dernier : chaque semaine face à la même, un an plus
  // tôt — et pas la première semaine de chaque plage, qui ne commencent pas
  // le même jour de la semaine.
  const annee = periode({ debut: '2026-08-03', fin: '2026-08-20', comparer: 'annee', grain: 'semaine' });
  assert.deepEqual(annee.courante.cles, ['2026-08-03', '2026-08-10', '2026-08-17']);
  assert.deepEqual(annee.comparee?.cles, ['2025-08-03', '2025-08-10', '2025-08-17']);
  const { compare } = cadres(annee);
  // Le dimanche 3 août 2025 tombe en face du lundi 3 août 2026 ; le 20 août 2025 en face du 20 août 2026.
  assert.equal(compare!.place(Date.UTC(2025, 7, 3, 10)), 0);
  assert.equal(compare!.place(Date.UTC(2025, 7, 20, 10)), 2);
  assert.equal(compare!.place(Date.UTC(2025, 7, 21, 10)), -1);

  assert.equal(periode({ debut: '2026-10-10', fin: '2026-10-16', comparer: 'aucune' }).comparee, null);
});

test('le SAV, point par point : messages, première réponse, brouillons, à classer', () => {
  const p = periode({ debut: '2026-10-14', fin: '2026-10-16' });
  const h = (jour: number, heure: number, minute = 0) => new Date(Date.UTC(2026, 9, jour, heure - 2, minute));
  const { courant } = cadres(p);
  const chiffres = agregerSav(
    {
      tickets: [
        { id: 'a', createdAt: h(14, 9), intent: 'WISMO' },
        { id: 'b', createdAt: h(14, 11), intent: null },
        { id: 'c', createdAt: h(15, 10), intent: 'OTHER' },
        { id: 'd', createdAt: h(16, 8), intent: 'REFUND' },
      ],
      entrees: [
        { ticketId: 'a', _min: { receivedAt: h(14, 9) } },
        { ticketId: 'b', _min: { receivedAt: h(14, 11) } },
        { ticketId: 'c', _min: { receivedAt: h(15, 10) } },
      ],
      // a : deux heures après ; b : quarante minutes ; c : sans réponse.
      sorties: [
        { ticketId: 'a', _min: { receivedAt: h(14, 11) }, _max: { receivedAt: h(14, 11) } },
        { ticketId: 'b', _min: { receivedAt: h(14, 11, 40) }, _max: { receivedAt: h(14, 11, 40) } },
      ],
      brouillons: [
        { ticketId: 'a', sentAt: null, createdAt: h(14, 9, 30), ticket: { createdAt: h(14, 9) } },
        { ticketId: 'c', sentAt: null, createdAt: h(15, 10, 30), ticket: { createdAt: h(15, 10) } },
      ],
    },
    courant,
  );
  assert.equal(chiffres.totaux.messages, 4);
  assert.deepEqual(chiffres.series.messages, [2, 1, 1]);
  assert.equal(chiffres.totaux.premiereReponse.mesurees, 2);
  assert.equal(chiffres.totaux.premiereReponse.mediane, 120);
  assert.deepEqual(chiffres.series.premiereReponse, [120, null, null]);
  assert.deepEqual(chiffres.totaux.brouillons, { total: 2, utilises: 1, taux: 0.5 });
  assert.deepEqual(chiffres.series.brouillons, [1, 0, null]);
  // Sans motif ou « OTHER » : à classer, comptés ensemble.
  assert.deepEqual(chiffres.totaux.aClasser, { n: 2, part: 0.5 });
  assert.deepEqual(chiffres.motifs, { WISMO: 1, OTHER: 2, REFUND: 1 });
  assert.deepEqual(chiffres.series.aClasser, [0.5, 1, 0]);
});

test('les ventes, point par point : chiffre d’affaires, commandes, panier, remboursé', () => {
  const p = periode({ debut: '2026-10-15', fin: '2026-10-16' });
  const { courant } = cadres(p);
  const chiffres = agregerVentes(
    {
      devise: 'EUR',
      tronque: false,
      commandes: [
        { instant: Date.UTC(2026, 9, 14, 22, 30), montant: 100, rembourse: 0 }, // le 15 à 0 h 30 à Paris
        { instant: Date.UTC(2026, 9, 15, 9), montant: 50, rembourse: 50 },
        { instant: Date.UTC(2026, 9, 16, 9), montant: 90, rembourse: 0 },
        { instant: Date.UTC(2026, 9, 13, 9), montant: 999, rembourse: 0 }, // hors période
      ],
    },
    courant,
  );
  assert.deepEqual(chiffres.series.ca, [150, 90]);
  assert.deepEqual(chiffres.series.commandes, [2, 1]);
  assert.deepEqual(chiffres.series.panier, [75, 90]);
  assert.equal(chiffres.totaux.ca, 240);
  assert.equal(chiffres.totaux.panier, 80);
  assert.equal(chiffres.totaux.partRembourse, 50 / 240);
});

test('deux routes, la période en paramètres ; Shopify en panne ne prive pas du SAV', () => {
  const routes = lire('src/routes/stats.ts');
  assert.match(routes, /app\.get\('\/api\/stats\/periode\/sav'/);
  assert.match(routes, /app\.get\('\/api\/stats\/periode\/ventes'/);
  assert.match(routes, /return reply\.code\(502\)\.send\(\{ error: 'Shopify n’a pas répondu\.' \}\);/);
  const ventes = lire('src/services/shopify/ventesPeriode.ts');
  assert.match(ventes, /created_at:>='\$\{depuis\.toISOString\(\)\}' created_at:<'\$\{avant\.toISOString\(\)\}'/);
  assert.match(ventes, /const COMMANDES_MAX = 3000;/);
  assert.match(lire('src/services/shopify/mock.ts'), /query\.includes\('query VentesPeriode'\)/);
});

test('l’écran suit la maquette', () => {
  const html = lire('public/dashboard.html');
  const vue = html.slice(html.indexOf('id="view-stats"'), html.indexOf('id="view-couts"'));
  for (const id of ['sta-periode', 'sta-compare', 'sta-choix', 'sta-menu-compare', 'sta-ventes', 'sta-ca', 'sta-sav', 'sta-motifs', 'sta-equipe']) {
    assert.ok(vue.includes(`id="${id}"`), id);
  }
  assert.match(html, /<div class="sta-detail" id="sta-detail" hidden>/);
  const app = lire('public/app.js');
  const stats = app.slice(app.indexOf('const PERIODES_STATS'), app.indexOf('/* --------------------------------------------------------- coûts du SAV -- */'));
  for (const nom of ['Aujourd’hui', 'Hier', '7 derniers jours', '30 derniers jours', '90 derniers jours', '12 derniers mois', 'Depuis le 1er janvier', 'Personnalisée']) {
    assert.ok(stats.includes(`nom: '${nom}'`), nom);
  }
  // Ce que la maquette a retiré.
  assert.doesNotMatch(stats, /À expédier|Confiance moyenne/);
  // Les cartes, le graphique et les motifs s'ouvrent en grand.
  for (const cle of ['ca', 'commandes', 'panier', 'rembourse', 'messages', 'premiereReponse', 'brouillons', 'aClasser']) {
    assert.match(stats, new RegExp(`tuileMarkup\\(\\s*'${cle}'`), cle);
  }
  assert.match(stats, /<div class="sta-trace" data-ouvrir="ca"/);
  assert.match(stats, /data-ouvrir="motifs"/);
  // Au téléphone : retour « Statistiques » d'un glissé vers la droite.
  assert.match(app, /return STATS_PLEIN_ECRAN\.matches && !defileEnLargeur\(cible\) \? 'retourStats' : null;/);
  assert.match(html, /stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7" \/><\/svg>Statistiques/);
});

test('la couleur dit le sens : vert quand ça va mieux, rouge sinon, en encre lisible', () => {
  const css = lire('public/styles.css');
  assert.match(css, /\.sta-bon \{ color: var\(--ok-ink\); \}/);
  assert.match(css, /\.sta-mauvais \{ color: var\(--crit-ink\); \}/);
  const app = lire('public/app.js');
  assert.match(app, /rembourse: \{ titre: 'Remboursé', source: 'ventes', format: 'argent', mieux: -1/);
  assert.match(app, /const ton = arrondi === 0 \? 'neutre' : Math\.sign\(arrondi\) === mesure\.mieux \? 'bon' : 'mauvais';/);
});
