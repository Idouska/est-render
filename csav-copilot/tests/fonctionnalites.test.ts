import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

/*
 * La console d'administration : fonctionnalités par boutique, et nouveautés.
 *
 * CE QUE CES TESTS PROTÈGENT. Un interrupteur qui ne ferait que masquer un
 * bouton laisserait la route ouverte à qui connaît l'adresse : on croirait
 * une fonctionnalité éteinte alors qu'elle marche. Et une boutique dont
 * personne n'a touché les interrupteurs doit se comporter exactement comme
 * avant leur existence — tout allumé.
 */

process.env.ENCRYPTION_KEY ??= randomBytes(32).toString('base64');
process.env.APP_URL ??= 'https://example.test';
process.env.DATABASE_URL ??= 'postgresql://u:p@localhost:5432/db';
process.env.REDIS_URL ??= 'redis://localhost:6379';
process.env.SHOPIFY_API_KEY ??= 'key';
process.env.SHOPIFY_API_SECRET ??= 'secret';
process.env.SHOPIFY_SCOPES ??= 'read_orders';
process.env.GOOGLE_CLIENT_ID ??= 'client';
process.env.GOOGLE_CLIENT_SECRET ??= 'secret';
process.env.GOOGLE_SCOPES ??= 'https://www.googleapis.com/auth/gmail.readonly';
process.env.GOOGLE_PUBSUB_TOPIC ??= 'projects/p/topics/t';
process.env.GOOGLE_PUBSUB_SERVICE_ACCOUNT ??= 'sa@p.iam.gserviceaccount.com';

const { CLES_FONCTIONNALITES, fonctionnalitesDe } = await import('../src/services/fonctionnalites.ts');
const { NOUVEAUTES } = await import('../src/services/platform/nouveautes.ts');

const lire = (chemin: string) =>
  readFileSync(fileURLToPath(new URL(`../${chemin}`, import.meta.url)), 'utf8');
const sansCommentaires = (code: string) =>
  code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/[^\n]*/gm, '');

/* ---- l'état par défaut ---- */

test('sans réglage, tout est allumé ; une valeur abîmée ne coupe rien', () => {
  const tout = Object.fromEntries(CLES_FONCTIONNALITES.map((cle) => [cle, true]));
  assert.deepEqual(fonctionnalitesDe({}), tout);
  assert.deepEqual(fonctionnalitesDe(null), tout);
  assert.deepEqual(fonctionnalitesDe({ importEnMasse: 'non', inconnue: false }), tout);
  assert.equal(fonctionnalitesDe({ importEnMasse: false }).importEnMasse, false);
});

/* ---- le serveur refuse, pas seulement l'écran ---- */

test('une fonctionnalité éteinte est refusée par sa route, avant tout travail', () => {
  const route = sansCommentaires(lire('src/routes/supplierWorkspace.ts'));
  for (const [chemin, cle, travail] of [
    ["'/api/workspace/:id/parcels/lot',", 'importEnMasse', 'lireCollage('],
    ["'/api/workspace/:id/parcels/lot/fichier',", 'importEnMasse', 'lireClasseur('],
    ["'/api/workspace/:id/ruptures',", 'rupturesAtelier', 'prisma.supplierEscalation.findMany('],
  ] as const) {
    const debut = route.indexOf(chemin);
    assert.ok(debut > 0, `route introuvable : ${chemin}`);
    const corps = route.slice(debut, debut + 4000);
    const garde = corps.indexOf(`fonctionnaliteActive(workspace.merchantId, '${cle}')`);
    // Présent AVANT d'être comparé : absent, indexOf rend -1, qui passe pour « avant ».
    assert.ok(garde > 0, `${chemin} : garde absente`);
    assert.ok(garde < corps.indexOf(travail), `${chemin} : la garde doit précéder le travail`);
    assert.match(corps.slice(garde, garde + 200), /code\(403\)/);
  }
});

test('la console et ses routes restent réservées à l’administrateur', () => {
  const admin = sansCommentaires(lire('src/routes/admin.ts'));
  for (const route of ["'/api/admin/nouveautes'", "'/api/admin/marchands'", "'/api/admin/marchands/:id'"]) {
    const debut = admin.indexOf(route);
    assert.ok(debut > 0, `route introuvable : ${route}`);
    assert.match(admin.slice(debut, debut + 120), /preHandler: requireAdmin/, route);
  }
  // Seules les clés du registre sont acceptées.
  assert.match(admin, /cle: z\.enum\(CLES_FONCTIONNALITES/);
});

/* ---- l'écran de l'atelier ---- */

const js = lire('public/workspace.js');

test('sans traitement en masse, le choix des modes disparaît et le mode repasse en « Une par une »', () => {
  const source = js.slice(js.indexOf('function appliquerFonctionnalites'), js.indexOf('\n}\n', js.indexOf('function appliquerFonctionnalites')) + 2);
  const elements: Record<string, { hidden: boolean }> = { 'ws-modes': { hidden: false } };
  const boutonsRuptures = [{ hidden: false }, { hidden: false }];
  const appels: string[] = [];
  const etat = { mode: 'masse', view: 'ruptures', fonctionnalites: { importEnMasse: false, rupturesAtelier: false } };

  new Function('state', '$', 'document', 'setMode', 'setView', 'setRuptureBadge', `${source} appliquerFonctionnalites();`)(
    etat,
    (id: string) => elements[id],
    { querySelectorAll: () => boutonsRuptures },
    (mode: string) => appels.push(`mode:${mode}`),
    (vue: string) => appels.push(`vue:${vue}`),
    (n: number) => appels.push(`pastille:${n}`),
  );

  assert.equal(elements['ws-modes']!.hidden, true);
  assert.deepEqual(boutonsRuptures.map((b) => b.hidden), [true, true]);
  assert.deepEqual(appels, ['mode:manuel', 'pastille:0', 'vue:orders']);
});

test('sans traitement en masse, une feuille glissée ne bascule plus rien', () => {
  const source = js.slice(js.indexOf('const porteDesFichiers'), js.indexOf('\n}\n', js.indexOf('function prendLeGlisser')) + 2);
  const bascules: string[] = [];
  const prend = new Function('state', 'setMode', `${source} return prendLeGlisser;`)(
    { mode: 'manuel', view: 'orders', focus: null, fonctionnalites: { importEnMasse: false } },
    (mode: string) => bascules.push(mode),
  ) as (event: unknown) => boolean;
  const event = {
    dataTransfer: {
      types: ['Files'],
      items: [{ kind: 'file', type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }],
    },
  };
  assert.equal(prend(event), false);
  assert.deepEqual(bascules, []);
});

test('l’atelier reçoit l’état des fonctionnalités avec ses commandes', () => {
  const route = sansCommentaires(lire('src/routes/supplierWorkspace.ts'));
  assert.equal(route.match(/fonctionnalites: await fonctionnalitesDuMarchand\(workspace\.merchantId\)/g)?.length, 2);
});

/* ---- les nouveautés ---- */

test('les nouveautés sont complètes, uniques, et la plus récente en tête', () => {
  assert.ok(NOUVEAUTES.length > 0);
  const prs = NOUVEAUTES.map((n) => n.pr);
  assert.equal(new Set(prs).size, prs.length, 'une PR n’apparaît qu’une fois');
  assert.deepEqual(prs, [...prs].sort((a, b) => b - a), 'la plus récente en tête');

  for (const n of NOUVEAUTES) {
    assert.match(n.date, /^\d{4}-\d{2}-\d{2}$/, `PR ${n.pr} : date`);
    assert.ok(['Atelier', 'Tableau de bord', 'Les deux', 'Console'].includes(n.pour), `PR ${n.pr} : public`);
    assert.ok(n.titre && n.resume && n.ou, `PR ${n.pr} : texte manquant`);
    assert.ok(n.essayer.length > 0, `PR ${n.pr} : comment l’essayer`);
  }
});
