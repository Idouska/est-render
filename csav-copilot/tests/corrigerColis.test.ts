import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { LANGS, STRINGS } from '../public/workspace.i18n.js';

/*
 * Corriger un colis déjà enregistré.
 *
 * CE QUE CES TESTS PROTÈGENT. Une faute de frappe dans un numéro de suivi
 * n'est pas qu'une ligne fausse chez nous : si la commande est partie, le
 * client a reçu ce numéro par e-mail. Corriger notre base seulement lui
 * laisserait le mauvais, et l'atelier croirait l'erreur réparée. Trois règles,
 * donc : la correction part aussi chez Shopify, jamais sans confirmation
 * (c'est un nouvel e-mail au client), et Shopify d'abord — si Shopify refuse,
 * rien ne change chez nous non plus.
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

const { corrigerSuivi, expeditionPortant } = await import('../src/services/shopify/fulfill.ts');
const { ecritureSimulee } = await import('../src/services/modeTest.ts');

const lire = (chemin: string) =>
  readFileSync(fileURLToPath(new URL(`../${chemin}`, import.meta.url)), 'utf8');
const sansCommentaires = (code: string) =>
  code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/[^\n]*/gm, '');

/** Un faux client Shopify qui garde ce qu'on lui envoie. */
function clientQuiRetient(reponse: (query: string) => unknown) {
  const envois: Array<{ query: string; variables?: Record<string, unknown> }> = [];
  return {
    envois,
    client: {
      shopDomain: 'boutique.test',
      async request<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
        envois.push({ query, variables });
        return reponse(query) as T;
      },
    },
  };
}

/* ---- chez Shopify ---- */

test('l’expédition qui porte le numéro se retrouve, écrit autrement compris', async () => {
  const { client } = clientQuiRetient(() => ({
    order: {
      fulfillments: [
        { id: 'gid://shopify/Fulfillment/1', trackingInfo: [{ number: 'AAA111', company: 'UPS' }] },
        { id: 'gid://shopify/Fulfillment/2', trackingInfo: [{ number: 'LX 123 cn', company: 'China Post' }] },
      ],
    },
  }));

  const trouvee = await expeditionPortant(client, 'gid://shopify/Order/1', 'LX123CN');
  assert.deepEqual(trouvee, { id: 'gid://shopify/Fulfillment/2', numeros: ['LX 123 cn'], transporteur: 'China Post' });
  assert.equal(await expeditionPortant(client, 'gid://shopify/Order/1', 'ZZZ999'), null);
});

test('la correction ne remplace que le numéro corrigé, et prévient le client', async () => {
  // Une commande de trois colis : les deux autres numéros restent.
  const { client, envois } = clientQuiRetient(() => ({
    fulfillmentTrackingInfoUpdate: { fulfillment: { id: 'gid://shopify/Fulfillment/9' }, userErrors: [] },
  }));
  const resultat = await corrigerSuivi(
    client,
    { id: 'gid://shopify/Fulfillment/9', numeros: ['PK1', 'PK2-FAUX', 'PK3'], transporteur: 'DHL' },
    'pk2-faux',
    'PK2',
    null,
  );

  assert.deepEqual(resultat, { corrige: true });
  assert.deepEqual(envois[0]!.variables, {
    fulfillmentId: 'gid://shopify/Fulfillment/9',
    trackingInfoInput: { numbers: ['PK1', 'PK2', 'PK3'], company: 'DHL' },
    notifyCustomer: true,
  });
});

test('un refus de Shopify est rendu, pas avalé', async () => {
  const { client } = clientQuiRetient(() => ({
    fulfillmentTrackingInfoUpdate: { fulfillment: null, userErrors: [{ message: 'Fulfillment is cancelled.' }] },
  }));
  const resultat = await corrigerSuivi(client, { id: 'f', numeros: ['A1'], transporteur: null }, 'A1', 'A2', null);
  assert.deepEqual(resultat, { corrige: false, raison: 'Fulfillment is cancelled.' });
});

test('en mode test, la correction est simulée et comprise comme réussie', async () => {
  const { client, envois } = clientQuiRetient((query) => {
    const simulee = ecritureSimulee(query);
    assert.notEqual(simulee, null, 'la correction ne doit jamais atteindre le réseau');
    return simulee;
  });
  const resultat = await corrigerSuivi(client, { id: 'f', numeros: ['A1'], transporteur: null }, 'A1', 'A2', null);
  assert.deepEqual(resultat, { corrige: true });
  assert.equal(envois.length, 1);
});

/* ---- la route ---- */

test('rien ne change sans confirmation, et Shopify passe avant notre base', () => {
  const route = sansCommentaires(lire('src/routes/supplierWorkspace.ts'));
  const debut = route.indexOf("app.patch<{ Params: { id: string; parcelId: string }");
  const corps = route.slice(debut, route.indexOf('app.delete<', debut));

  const confirmation = corps.indexOf("code: 'client_deja_prevenu'");
  const correction = corps.indexOf('await corrigerSuivi(');
  const enregistrement = corps.indexOf('prisma.parcel.update(');
  assert.ok(confirmation > 0 && correction > 0 && enregistrement > 0);
  // Le garde doit EXISTER avant d'être comparé : absent, `indexOf` rend -1,
  // qui passe pour « avant » — une première version de ce test s'y est laissé
  // prendre, et un garde supprimé ne rougissait rien.
  const garde = corps.indexOf('if (!parsed.data.prevenirClient)');
  assert.ok(garde > 0, 'la confirmation doit être exigée');
  assert.ok(garde < confirmation, 'la confirmation est exigée avant la réponse');
  assert.ok(confirmation < correction, 'pas de correction chez Shopify sans confirmation');
  assert.ok(correction < enregistrement, 'Shopify d’abord : un refus ne doit rien laisser changé chez nous');

  // Un refus de Shopify arrête tout, avant l'enregistrement.
  const refus = corps.indexOf("code: 'shopify_refus'");
  assert.ok(refus > correction && refus < enregistrement);
});

/* ---- la page ---- */

test('la page demande la confirmation, puis renvoie la correction confirmée', async () => {
  const js = lire('public/workspace.js');
  const source = js.slice(js.indexOf('async function corrigerColis'), js.indexOf('\n}\n', js.indexOf('async function corrigerColis')) + 2);

  const essai = async (accepte: boolean) => {
    const appels: Array<Record<string, unknown>> = [];
    const api = async (_chemin: string, options: { body: Record<string, unknown> }) => {
      appels.push(options.body);
      if (!options.body.prevenirClient) {
        throw Object.assign(new Error('déjà envoyé'), { code: 'client_deja_prevenu', donnees: { ancien: 'PK2-FAUX' } });
      }
      return { parcel: { id: 'p1' }, clientPrevenu: true };
    };
    const questions: string[] = [];
    const corriger = new Function(
      'api',
      'confirm',
      't',
      'state',
      'supplierId',
      `${source} return corrigerColis;`,
    )(
      api,
      (question: string) => {
        questions.push(question);
        return accepte;
      },
      (cle: string, v: Record<string, string>) => `${cle}:${v.old}→${v.number}`,
      { testMode: false },
      'fournisseur',
    ) as (pid: string, corps: object) => Promise<unknown>;

    const resultat = await corriger('p1', { trackingNumber: 'PK2', carrier: null });
    return { resultat, appels, questions };
  };

  const accepte = await essai(true);
  assert.deepEqual(accepte.questions, ['parcel.editConfirm:PK2-FAUX→PK2'], 'la question nomme les deux numéros');
  assert.equal(accepte.appels.length, 2);
  assert.equal(accepte.appels[1]!.prevenirClient, true);

  const refuse = await essai(false);
  assert.equal(refuse.resultat, null, 'renoncer ne change rien');
  assert.equal(refuse.appels.length, 1, 'aucune seconde demande');
});

test('la liste de suivi propose de modifier, pas seulement de supprimer', () => {
  const js = lire('public/workspace.js');
  assert.match(js, /class="ico ico-edit" data-edit="\$\{esc\(parcel\.id\)\}"/);
  assert.match(js, /ouvrirCorrection\(button\.closest\('\.trk'\), button\.dataset\.edit\)/);
});

test('chaque refus de la correction est traduit, dans les trois langues', () => {
  const route = sansCommentaires(lire('src/routes/supplierWorkspace.ts'));
  const debut = route.indexOf("app.patch<{ Params: { id: string; parcelId: string }");
  const corps = route.slice(debut, route.indexOf('app.delete<', debut));
  const codes = [...corps.matchAll(/code: '(\w+)'/g)].map((m) => m[1]!).filter((code) => code !== 'client_deja_prevenu');
  assert.ok(codes.length >= 5);

  const cles = [
    ...codes.map((code) => `parcel.err.${code}`),
    'parcel.edit',
    'parcel.editCancel',
    'parcel.editConfirm',
    'parcel.editConfirmTest',
    'parcel.corrected',
    'parcel.correctedNotified',
    'parcel.correctedTest',
  ];
  for (const { code } of LANGS) {
    const table = (STRINGS as Record<string, Record<string, string>>)[code]!;
    assert.deepEqual(cles.filter((cle) => typeof table[cle] !== 'string'), [], code);
  }
});
