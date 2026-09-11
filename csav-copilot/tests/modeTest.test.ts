import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { LANGS, STRINGS } from '../public/workspace.i18n.js';

/*
 * Le mode test : l'outil fonctionne, mais rien ne sort.
 *
 * CE QUE CES TESTS PROTÈGENT. Le marchand allume le mode test pour cliquer
 * sur les derniers boutons sans conséquence — « Enregistrer et expédier »,
 * « Rembourser », « Envoyer ». Si un seul chemin échappe au blocage, un
 * client reçoit un faux numéro de suivi ou un remboursement part pour de
 * bon, alors que l'écran promettait le contraire. Le blocage vit aux points
 * de passage ; ces tests vérifient qu'il y est, AVANT l'appel réseau, et que
 * les réponses simulées sont bien comprises par le code qui les reçoit.
 *
 * Commentaires retirés avant chaque recherche dans le code : ce dépôt est
 * écrit en prose, et un test qui trouve son motif dans un commentaire passe
 * en lisant sa propre justification.
 */

// Le client Shopify tire la configuration du serveur, validée au chargement.
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

const { ActionBloqueeEnTest, ecritureSimulee } = await import('../src/services/modeTest.ts');
const { fulfillOrder } = await import('../src/services/shopify/fulfill.ts');
const { createRefund } = await import('../src/services/shopify/refunds.ts');

const lire = (chemin: string) =>
  readFileSync(fileURLToPath(new URL(`../${chemin}`, import.meta.url)), 'utf8');
const sansCommentaires = (code: string) =>
  code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/[^\n]*/gm, '').replace(/<!--[\s\S]*?-->/g, '');

/**
 * Une fonction, de sa signature à la déclaration suivante. Pas à la première
 * accolade en début de ligne : celle d'un type de paramètres en objet
 * (`params: {…}`) couperait la fonction avant son corps.
 */
const corps = (source: string, debut: string) => {
  const i = source.indexOf(debut);
  assert.ok(i >= 0, `introuvable : ${debut}`);
  const suite = source.slice(i + debut.length);
  const fin = suite.search(/\n(?:export |async function |function |const |let )/);
  return source.slice(i, i + debut.length + (fin < 0 ? suite.length : fin));
};

/* ---- les écritures Shopify ---- */

test('une lecture Shopify part, une écriture connue est simulée, une inconnue est refusée', () => {
  assert.equal(ecritureSimulee('query Orders { orders(first: 5) { nodes { id } } }'), null);

  const expedition = ecritureSimulee('\n  mutation CreateFulfillment($f: FulfillmentInput!) { x }') as {
    fulfillmentCreate: { fulfillment: { id: string }; userErrors: unknown[] };
  };
  assert.match(expedition.fulfillmentCreate.fulfillment.id, /^gid:\/\/csav\/ModeTest\//);
  assert.deepEqual(expedition.fulfillmentCreate.userErrors, []);

  // Mieux vaut un test qui échoue qu'une action réelle qu'on n'a pas prévu
  // de simuler.
  assert.throws(() => ecritureSimulee('mutation OrderCancel($id: ID!) { x }'), ActionBloqueeEnTest);
  assert.throws(() => ecritureSimulee('mutation { orderClose(input: {}) { x } }'), ActionBloqueeEnTest);
});

test('le client Shopify applique le mode test AVANT tout appel réseau', () => {
  const client = sansCommentaires(lire('src/services/shopify/client.ts'));
  const requete = client.slice(client.indexOf('async request<T>('));
  const garde = requete.indexOf('if (modeTest)');
  assert.ok(garde >= 0, 'la requête doit consulter le mode test');
  assert.ok(requete.indexOf('ecritureSimulee(query)') > garde);
  assert.ok(garde < requete.indexOf('await fetch(endpoint'), 'le blocage doit précéder le réseau');
  assert.match(client, /select: \{ shopDomain: true, testMode: true \}/);
});

test('une expédition simulée est comprise comme réussie, sans que Shopify reçoive l’écriture', async () => {
  // Un faux client qui fait comme le vrai en mode test : les lectures
  // « partent » (ici, une réponse fixe), les écritures sont simulées.
  const parties: string[] = [];
  const client = {
    shopDomain: 'boutique.test',
    async request<T>(query: string): Promise<T> {
      const simulee = ecritureSimulee(query);
      if (simulee !== null) return simulee as T;
      parties.push(query.match(/^\s*query\s+(\w+)/)![1]!);
      return { order: { fulfillmentOrders: { nodes: [{ id: 'gid://shopify/FulfillmentOrder/1', status: 'OPEN' }] } } } as T;
    },
  };

  const resultat = await fulfillOrder(client, 'gid://shopify/Order/1', { numbers: ['TEST-13811'], company: null });
  assert.deepEqual(resultat, { fulfilled: true });
  assert.deepEqual(parties, ['FulfillmentOrders'], 'seule la lecture est partie');
});

test('un remboursement simulé rend un identifiant de test, et aucun argent ne bouge', async () => {
  const client = {
    shopDomain: 'boutique.test',
    async request<T>(query: string): Promise<T> {
      const simulee = ecritureSimulee(query);
      assert.notEqual(simulee, null, 'le remboursement ne doit jamais atteindre le réseau');
      return simulee as T;
    },
  };
  const { refundId } = await createRefund(client, {
    orderId: 'gid://shopify/Order/1',
    amount: '10.00',
    currency: 'EUR',
    parentTransactionId: 'gid://shopify/OrderTransaction/1',
    gateway: 'shopify_payments',
    reason: 'test',
  } as never);
  assert.match(refundId, /^gid:\/\/csav\/ModeTest\/Refund\//);
});

test('toute écriture Shopify du code est connue de la simulation', () => {
  // Une écriture ajoutée demain serait BLOQUÉE en mode test — sûr, mais
  // peut-être pas voulu. Ce test oblige à trancher en l'ajoutant.
  const dossier = fileURLToPath(new URL('../src/', import.meta.url));
  const trouvees = new Set<string>();
  const parcourir = (chemin: string) => {
    for (const entree of readdirSync(chemin, { withFileTypes: true })) {
      const complet = `${chemin}/${entree.name}`;
      if (entree.isDirectory()) parcourir(complet);
      else if (entree.name.endsWith('.ts') && entree.name !== 'mock.ts') {
        for (const m of readFileSync(complet, 'utf8').matchAll(/\bmutation\s+(\w+)\s*[({]/g)) trouvees.add(m[1]!);
      }
    }
  };
  parcourir(dossier.replace(/\/$/, ''));

  assert.deepEqual([...trouvees].sort(), ['CreateFulfillment', 'CreateRefund']);
  for (const nom of trouvees) {
    assert.doesNotThrow(() => ecritureSimulee(`mutation ${nom}($x: X) { x }`), `${nom} doit être simulée`);
  }
});

/* ---- les e-mails ---- */

test('les trois envois Gmail consultent le mode test avant d’écrire', () => {
  const envoi = sansCommentaires(lire('src/services/gmail/send.ts'));
  const brouillons = sansCommentaires(lire('src/services/gmail/drafts.ts'));

  for (const [source, fonction, garde] of [
    [envoi, 'export async function sendPlainEmail', '!params.memeEnModeTest && (await enModeTest(params.merchantId))'],
    [brouillons, 'export async function sendReplyInThread', 'await enModeTest(params.merchantId)'],
    [brouillons, 'export async function sendDraft', 'await enModeTest(merchantId)'],
  ] as const) {
    const code = corps(source, fonction);
    const i = code.indexOf(garde);
    assert.ok(i >= 0, `${fonction} : pas de garde du mode test`);
    assert.ok(i < code.indexOf('getGmailClient('), `${fonction} : la garde doit précéder Gmail`);
  }
});

test('seuls les liens de connexion et invitations passent outre le mode test', () => {
  // Les bloquer empêcherait l'équipe de se connecter. Tout autre usage de
  // l'exception serait une fuite.
  const dossier = fileURLToPath(new URL('../src/', import.meta.url)).replace(/\/$/, '');
  const utilisateurs: string[] = [];
  const parcourir = (chemin: string) => {
    for (const entree of readdirSync(chemin, { withFileTypes: true })) {
      const complet = `${chemin}/${entree.name}`;
      if (entree.isDirectory()) parcourir(complet);
      else if (entree.name.endsWith('.ts') && /memeEnModeTest: true/.test(sansCommentaires(readFileSync(complet, 'utf8')))) {
        utilisateurs.push(complet.slice(dossier.length + 1));
      }
    }
  };
  parcourir(dossier);
  assert.deepEqual(utilisateurs, ['routes/team.ts']);
  assert.match(corps(sansCommentaires(lire('src/routes/team.ts')), 'async function deliverLink'), /memeEnModeTest: true/);
});

/* ---- les données de test ---- */

test('un colis est marqué « test » à sa création, jamais à sa mise à jour', () => {
  // Un colis réel ressaisi pendant un test doit rester réel : sinon
  // l'effacement des données de test l'emporterait.
  const route = sansCommentaires(lire('src/routes/supplierWorkspace.ts'));
  const upsert = corps(route, 'async function enregistrerColis').match(/prisma\.parcel\.upsert\(\{[\s\S]*?\n {2}\}\);/)![0];
  const creation = upsert.slice(upsert.indexOf('create:'), upsert.indexOf('update:'));
  const miseAJour = upsert.slice(upsert.indexOf('update:'));
  assert.match(creation, /test: await enModeTest\(workspace\.merchantId\)/);
  assert.equal(/\btest:/.test(miseAJour), false);
});

test('un remboursement demandé en mode test est marqué « test »', () => {
  const route = sansCommentaires(lire('src/routes/refunds.ts'));
  const creation = route.slice(route.indexOf('prisma.refund.create({'));
  assert.match(creation.slice(0, creation.indexOf('});')), /test: await enModeTest\(merchantId\)/);
});

test('l’effacement ne touche que les données de test, du seul marchand connecté', () => {
  const reglages = sansCommentaires(lire('src/routes/settings.ts'));
  const route = reglages.slice(reglages.indexOf('"/api/mode-test/effacer"'));
  const effacement = route.slice(0, route.indexOf('app.patch('));
  assert.match(effacement, /requirePermission\("configure"\)/);
  const suppressions = [...effacement.matchAll(/deleteMany\(\{ where: ([^}]*\}) \}\)/g)].map((m) => m[1]);
  assert.deepEqual(suppressions, ['{ merchantId, test: true }', '{ merchantId, test: true }']);
});

/* ---- ce que voient le marchand et l'atelier ---- */

test('le bandeau du mode test existe des deux côtés', () => {
  assert.match(lire('public/dashboard.html'), /id="test-notice" hidden/);
  assert.match(lire('public/app.js'), /\$\('test-notice'\)\.hidden = !me\.merchant\.testMode;/);
  assert.match(lire('public/workspace.html'), /id="ws-test" hidden/);
  assert.match(lire('public/workspace.js'), /\$\('ws-test'\)\.hidden = !state\.testMode;/);
});

test('les textes du mode test existent dans les trois langues', () => {
  const cles = ['test.title', 'test.banner', 'test.parcelSaved', 'bulk.consequenceTest', 'bulk.saveTest', 'bulk.doneTest'];
  for (const { code } of LANGS) {
    const table = (STRINGS as Record<string, Record<string, string>>)[code]!;
    assert.deepEqual(cles.filter((cle) => typeof table[cle] !== 'string'), [], code);
  }
});
