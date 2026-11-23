import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

/*
 * Prévenu quand une connexion tombe ; prêt avant de passer en réel.
 *
 * CE QUE CES TESTS PROTÈGENT.
 *
 * 1. Le 22 novembre, Shopify a refusé l'accès et quinze messages sont restés
 *    en échec sans que personne ne le sache. Une panne Shopify ou Gmail est
 *    désormais notée une fois, et les propriétaires et superviseurs reçoivent
 *    UN e-mail — depuis une boîte qui marche, jamais depuis celle en panne.
 * 2. Couper le mode test laisse tout partir pour de vrai. Six points se
 *    vérifient avant, chacun avec son geste, et couper le mode test avec des
 *    points manquants demande confirmation.
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

const alertes = await import('../src/services/platform/alertesConnexion.ts');
const { etapesMiseEnService, couvre } = await import('../src/services/platform/miseEnService.ts');

const lire = (chemin: string) => readFileSync(fileURLToPath(new URL(`../${chemin}`, import.meta.url)), 'utf8');

const MAINTENANT = new Date('2026-11-23T13:05:00Z');

/** Une base en mémoire, juste ce que l'alerte lit et écrit. */
function base(options: { boites: Array<{ id: string; merchantId: string; panneLe?: Date | null }>; accesRefuseLe?: Date | null; demo?: boolean }) {
  const boites = options.boites.map((b) => ({ emailAddress: `${b.id}@boutique.test`, panneLe: null, ...b }));
  const connexion = { accesRefuseLe: options.accesRefuseLe ?? null };
  return {
    boites,
    connexion,
    prisma: {
      merchant: {
        findUnique: async () => ({ name: 'Boutique', brandName: null, shopDomain: 'boutique.myshopify.com', organizationId: 'org', demo: options.demo ?? false }),
      },
      user: {
        findMany: async () => [{ email: 'Patron@Boutique.test' }, { email: 'owner@boutique.myshopify.com' }, { email: 'chef@boutique.test' }],
      },
      gmailConnection: {
        findFirst: async ({ where }: { where: Record<string, any> }) =>
          boites.find(
            (b) =>
              (where.id === undefined || (typeof where.id === 'string' ? b.id === where.id : b.id !== where.id.not)) &&
              (where.merchantId === undefined || (typeof where.merchantId === 'string' ? b.merchantId === where.merchantId : b.merchantId !== where.merchantId.not)) &&
              (!('panneLe' in where) || b.panneLe === where.panneLe),
          ) ?? null,
        updateMany: async ({ where, data }: { where: { id: string; panneLe: null }; data: { panneLe: Date } }) => {
          const b = boites.find((x) => x.id === where.id && x.panneLe === null);
          if (!b) return { count: 0 };
          b.panneLe = data.panneLe;
          return { count: 1 };
        },
      },
      shopifyConnection: {
        updateMany: async ({ data }: { data: { accesRefuseLe: Date } }) => {
          if (connexion.accesRefuseLe) return { count: 0 };
          connexion.accesRefuseLe = data.accesRefuseLe;
          return { count: 1 };
        },
      },
    },
  };
}

test('Shopify refuse l’accès : un seul e-mail, aux propriétaires et superviseurs', async () => {
  const b = base({ boites: [{ id: 'sav', merchantId: 'm1' }] });
  const envois: Array<{ to: string; mailboxId?: string | null; subject: string; memeEnModeTest?: boolean; body: string }> = [];
  const deps = { prisma: b.prisma as never, envoyer: async (p: (typeof envois)[number]) => { envois.push(p); return { gmailMessageId: null, fromEmail: 'x' }; }, maintenant: () => MAINTENANT };

  assert.equal(await alertes.signalerPanneShopify('m1', deps as never), 'envoyee');
  assert.equal(await alertes.signalerPanneShopify('m1', deps as never), 'deja-signalee');
  // Le compte technique `owner@…myshopify.com` n'est pas une boîte qu'on lit.
  assert.deepEqual(envois.map((e) => e.to), ['patron@boutique.test', 'chef@boutique.test']);
  assert.equal(envois[0]!.subject, 'Boutique : Shopify est déconnecté du SAV');
  // Une alerte à l'équipe part même en mode test.
  assert.equal(envois[0]!.memeEnModeTest, true);
  assert.match(envois[0]!.body, /Depuis le 23 novembre à 14:05, Shopify refuse l’accès/);
  assert.match(envois[0]!.body, /\/auth\/shopify\?shop=boutique\.myshopify\.com/);
  assert.match(envois[0]!.body, /cliquez sur « Relancer »/);
});

test('Gmail en panne : l’alerte part d’une autre boîte, jamais de celle qui ne répond plus', async () => {
  const b = base({ boites: [{ id: 'sav', merchantId: 'm1' }, { id: 'compta', merchantId: 'm1' }] });
  const envois: Array<{ to: string; mailboxId?: string | null; subject: string }> = [];
  const deps = { prisma: b.prisma as never, envoyer: async (p: (typeof envois)[number]) => { envois.push(p); return { gmailMessageId: null, fromEmail: 'x' }; }, maintenant: () => MAINTENANT };

  assert.equal(await alertes.signalerPanneGmail('m1', 'sav', 'Google a retiré l’autorisation', deps as never), 'envoyee');
  assert.equal(await alertes.signalerPanneGmail('m1', 'sav', 'Google a retiré l’autorisation', deps as never), 'deja-signalee');
  assert.ok(envois.every((e) => e.mailboxId === 'compta'));
  assert.equal(envois[0]!.subject, 'Boutique : la boîte sav@boutique.test ne reçoit plus le SAV');

  // Seule boîte de la boutique : celle d'une autre boutique du même compte prend le relais.
  const seule = base({ boites: [{ id: 'sav', merchantId: 'm1' }, { id: 'voisine', merchantId: 'm2' }] });
  const relais: Array<{ merchantId: string; mailboxId?: string | null }> = [];
  await alertes.signalerPanneGmail('m1', 'sav', 'x', { prisma: seule.prisma as never, envoyer: async (p: (typeof relais)[number]) => { relais.push(p); return { gmailMessageId: null, fromEmail: 'x' }; }, maintenant: () => MAINTENANT } as never);
  assert.deepEqual([relais[0]!.merchantId, relais[0]!.mailboxId], ['m2', 'voisine']);

  // Aucune boîte valide nulle part : rien ne part, et le journal le dit.
  const isolee = base({ boites: [{ id: 'sav', merchantId: 'm1' }] });
  const issue = await alertes.signalerPanneGmail('m1', 'sav', 'x', { prisma: isolee.prisma as never, envoyer: async () => { throw new Error('rien ne doit partir'); }, maintenant: () => MAINTENANT } as never);
  assert.equal(issue, 'aucune-boite');
});

test('la démonstration ne prévient personne, et une alerte ratée ne casse rien', async () => {
  const demo = base({ boites: [{ id: 'sav', merchantId: 'm1' }], demo: true });
  assert.equal(await alertes.prevenirPanne('m1', { quoi: 'shopify' }, { prisma: demo.prisma as never, envoyer: async () => { throw new Error('non'); }, maintenant: () => MAINTENANT } as never), 'demo');
  const b = base({ boites: [{ id: 'sav', merchantId: 'm1' }] });
  assert.equal(await alertes.prevenirPanne('m1', { quoi: 'shopify' }, { prisma: b.prisma as never, envoyer: async () => { throw new Error('Gmail injoignable'); }, maintenant: () => MAINTENANT } as never), 'echec');
});

test('une autorisation Google retirée se reconnaît, et la panne se repère là où elle arrive', () => {
  assert.equal(alertes.autorisationGoogleRetiree({ message: 'invalid_grant', response: { data: { error: 'invalid_grant' } } }), true);
  assert.equal(alertes.autorisationGoogleRetiree(new Error('Token has been expired or revoked. invalid_grant')), true);
  assert.equal(alertes.autorisationGoogleRetiree(new Error('Quota exceeded')), false);

  assert.match(lire('src/services/shopify/client.ts'), /if \(response\.status === 401 && !connection\.accesRefuseLe\) \{\s+void signalerPanneShopify\(merchantId\)/);
  // La relève de chaque mail, et le renouvellement quotidien de l'écoute.
  assert.match(lire('src/worker.ts'), /if \(autorisationGoogleRetiree\(error\)\) \{\s+await signalerPanneGmail\(job\.data\.merchantId, job\.data\.mailboxId/);
  const veille = lire('src/services/gmail/watch.ts');
  assert.match(veille, /if \(autorisationGoogleRetiree\(error\)\) \{\s+await signalerPanneGmail\(connection\.merchantId, connection\.id/);
  // La boîte qui répond de nouveau, ou reconnectée, efface la panne.
  assert.match(veille, /panneLe: null,\s+panneMotif: null,/);
  assert.match(lire('src/routes/auth.google.ts'), /update: \{\s+scopes: tokens\.scope \?\? null,\s+\/\/ Reconnectée : la panne signalée est terminée\.\s+panneLe: null,/);
  assert.match(lire('prisma/schema.prisma'), /panneLe    DateTime\?\n  panneMotif String\?/);
  // Et l'écran des connexions le montre, avec le bouton qui répare.
  assert.match(lire('public/app.js'), /Google refuse l’accès depuis le \$\{esc\(\s+fullDate\(mailbox\.panneLe\),\s+\)\}<\/b> — <a class="btn btn-small btn-primary" href="\/auth\/google">Reconnecter<\/a>/);
});

/** L'état d'une boutique, tel que la liste le lit. */
function boutique(sur: Partial<Record<string, unknown>> = {}) {
  return {
    demo: false,
    testMode: true,
    shopDomain: 'boutique.myshopify.com',
    emailSignature: 'L’équipe Boutique',
    playbook: 'Livraison : 3 jours.\nRetours : 30 jours.',
    shopify: { uninstalledAt: null, scopes: 'write_orders', accesRefuseLe: null },
    mailboxes: [{ emailAddress: 'sav@boutique.test', watchExpiration: new Date('2026-11-28T00:00:00Z'), panneLe: null }],
    ...sur,
  };
}

const depsListe = (marchand: unknown, reponses: number, legal: Record<string, string | undefined>) => ({
  prisma: { merchant: { findUnique: async () => marchand }, cannedReply: { count: async () => reponses } } as never,
  getCredentials: async () => legal as never,
  maintenant: () => MAINTENANT,
});
const LEGAL = { LEGAL_COMPANY: 'Société', LEGAL_ADDRESS: '1 rue Exemple', LEGAL_EMAIL: 'legal@example.org' };

test('prêt à passer en réel : six points, calculés sur l’état réel', async () => {
  const pret = await etapesMiseEnService('m1', depsListe(boutique(), 12, LEGAL));
  assert.deepEqual(pret.etapes.map((e) => [e.cle, e.ok]), [
    ['shopify', true], ['gmail', true], ['signature', true], ['regles', true], ['reponses', true], ['legal', true],
  ]);
  // `write_orders` couvre `read_orders` : pas d'autorisation réclamée pour rien.
  assert.equal(couvre(['write_orders'], 'read_orders'), true);

  const rien = await etapesMiseEnService(
    'm1',
    depsListe(
      boutique({
        emailSignature: '',
        playbook: null,
        shopify: { uninstalledAt: null, scopes: 'write_orders', accesRefuseLe: new Date() },
        mailboxes: [{ emailAddress: 'sav@boutique.test', watchExpiration: new Date('2026-11-28T00:00:00Z'), panneLe: new Date() }],
      }),
      0,
      { LEGAL_COMPANY: 'Société' },
    ),
  );
  const parCle = Object.fromEntries(rien.etapes.map((e) => [e.cle, e]));
  assert.ok(rien.etapes.every((e) => !e.ok));
  assert.equal(parCle.shopify.detail, 'Shopify refuse l’accès de l’outil.');
  assert.deepEqual(parCle.shopify.geste?.vers, { lien: '/auth/shopify?shop=boutique.myshopify.com' });
  assert.equal(parCle.gmail.detail, 'Google refuse l’accès à sav@boutique.test.');
  assert.deepEqual(parCle.signature.geste?.vers, { volet: 'boutique' });
  assert.deepEqual(parCle.regles.geste?.vers, { volet: 'assistant' });
  assert.deepEqual(parCle.reponses.geste?.vers, { vue: 'canned' });
  assert.equal(parCle.legal.detail, 'À compléter : adresse, e-mail de contact.');

  // Écoute expirée : les messages arrivent en retard.
  const sourde = await etapesMiseEnService('m1', depsListe(boutique({ mailboxes: [{ emailAddress: 'sav@boutique.test', watchExpiration: new Date('2026-11-20T00:00:00Z'), panneLe: null }] }), 1, LEGAL));
  assert.match(sourde.etapes[1]!.detail, /^Écoute expirée sur sav@boutique\.test/);

  // La démonstration n'a rien à brancher.
  assert.deepEqual(await etapesMiseEnService('m1', depsListe(boutique({ demo: true }), 0, {})), { demo: true, testMode: true, etapes: [] });
});

test('la liste s’affiche au-dessus du mode test, et couper le mode test avec des manques demande confirmation', () => {
  const html = lire('public/dashboard.html');
  const volet = html.slice(html.indexOf('data-volet="test"'), html.indexOf('id="set-testmode"'));
  assert.match(volet, /<section id="mes-section" hidden>/);
  assert.match(lire('src/routes/settings.ts'), /app\.get\("\/api\/mise-en-service"/);

  const app = lire('public/app.js');
  assert.match(app, /void chargerMiseEnService\(\);/);
  assert.match(app, /if \(vers\.volet\) montrerVoletReglages\(vers\.volet\);\s+else if \(vers\.vue\) setView\(vers\.vue\);/);
  assert.match(app, /if \(!actif && manquent\.length > 0\) \{/);
  assert.match(app, /\{ action: 'Passer en réel', danger: true, icone: 'test' \}/);
  assert.match(app, /if \(!ok\) \{\s+event\.target\.checked = true;\s+return;\s+\}/);
});
