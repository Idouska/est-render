import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { randomBytes } from 'node:crypto';

/*
 * Échange contre un autre modèle, et la différence de prix.
 *
 * CE QUE CES TESTS PROTÈGENT. Un montant demandé au client ne vient jamais
 * de l'écran : les deux prix sont relus chez Shopify. Plus cher, la nouvelle
 * paire ne part qu'une fois la différence payée (ou offerte) ; moins cher, la
 * différence n'arrive dans « À rembourser » qu'une fois la paire retournée
 * contrôlée — on ne rend pas d'argent sur une paire qui n'est pas revenue.
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

const { choixPourEcart, prixPaye } = await import('../src/services/reshipment/difference.ts');
const { ecritureSimulee } = await import('../src/services/modeTest.ts');

const lire = (chemin: string) => readFileSync(fileURLToPath(new URL(`../${chemin}`, import.meta.url)), 'utf8');

test('le choix suit le sens de l’écart', () => {
  assert.equal(choixPourEcart(20, 'LIEN'), 'LIEN');
  assert.equal(choixPourEcart(20, 'OFFERT'), 'OFFERT');
  // Un choix qui ne va pas avec le sens est remplacé par le premier qui va.
  assert.equal(choixPourEcart(20, 'REMBOURSER'), 'LIEN');
  assert.equal(choixPourEcart(-15, 'LIEN'), 'REMBOURSER');
  assert.equal(choixPourEcart(-15, 'GARDER'), 'GARDER');
  // Même prix, ou prix inconnu : rien à décider.
  assert.equal(choixPourEcart(0, 'LIEN'), null);
  assert.equal(choixPourEcart(null, 'LIEN'), null);
});

test('le prix payé se lit à l’unité, sur la bonne ligne de la commande', () => {
  const lignes = [
    { title: 'Nike Mind 001 Blackened Blue', variantTitle: '38.5', sku: 'HQ4307-400', quantity: 1, price: '120.00' },
    { title: 'Chaussettes', variantTitle: null, sku: null, quantity: 2, price: '20.00' },
  ];
  assert.equal(prixPaye(lignes, { sku: 'hq4307-400', productTitle: 'autre' }), 120);
  assert.equal(prixPaye(lignes, { productTitle: 'Chaussettes' }), 10);
  assert.equal(prixPaye(lignes, { productTitle: 'Inconnu' }), null);
  assert.equal(prixPaye([{ ...lignes[0]!, price: null }], { productTitle: 'Nike Mind 001 Blackened Blue' }), null);
});

test('les prix sont relus chez Shopify, jamais pris à l’écran', () => {
  const retours = lire('src/routes/returns.ts');
  // L'écran envoie la déclinaison voulue, pas un montant.
  assert.doesNotMatch(retours, /prixVoulu: z\./);
  assert.match(retours, /await calculerEcart\(merchantId, \{/);
  const difference = lire('src/services/reshipment/difference.ts');
  assert.match(difference, /prixDeclinaison\(client, params\.wantedVariantId\)/);
  assert.match(difference, /getOrderById\(client, params\.shopifyOrderId\)/);
});

test('plus cher : l’échange attend le paiement de la différence', () => {
  const retours = lire('src/routes/returns.ts');
  const organiser = retours.slice(retours.indexOf('async function organiserEchange'), retours.indexOf('choisirSource('));
  assert.match(organiser, /if \(!\(await differenceReglee\(merchantId, dossier\.id\)\)\) \{/);
  assert.match(organiser, /code: 'attente_paiement'/);
});

test('moins cher : la différence n’arrive dans « À rembourser » qu’après le contrôle', () => {
  const retours = lire('src/routes/returns.ts');
  const valider = retours.slice(retours.indexOf("'/api/returns/:id/echange/valider'"));
  assert.match(valider.slice(0, 3000), /await differenceARembourser\(merchantId, userId, dossier\.id\);/);
  const creation = retours.slice(retours.indexOf('async function differenceARembourser'), retours.indexOf("'/api/returns/:id/lien'"));
  assert.match(creation, /dossier\.ecartChoix !== 'REMBOURSER'/);
  // Une seule ligne par dossier, même si l'on valide deux fois.
  assert.match(creation, /const deja = await prisma\.remboursementAFaire\.count\(\{ where: \{ merchantId, returnCaseId: id \} \}\);/);
});

test('en mode test, le lien de paiement est simulé : rien ne part chez le client', () => {
  const cree = ecritureSimulee('mutation CreerLienDifference($input: DraftOrderInput!) { x }') as {
    draftOrderCreate: { draftOrder: { id: string } };
  };
  assert.match(cree.draftOrderCreate.draftOrder.id, /^gid:\/\/csav\/ModeTest/);
  assert.doesNotThrow(() => ecritureSimulee('mutation EnvoyerLienDifference($id: ID!) { x }'));
});

test('l’écran propose « Un autre modèle », et l’outil demande l’autorisation des liens de paiement', () => {
  const html = lire('public/dashboard.html');
  assert.match(html, /<button type="button" data-veut="MODELE" aria-pressed="false">Un autre modèle<\/button>/);
  const app = lire('public/app.js');
  assert.match(app, /wantedVariantId: retFormulaire\.modele\.id,/);
  for (const fichier of ['render.yaml', '.env.example']) {
    assert.match(lire(fichier), /write_draft_orders/, fichier);
  }
});
