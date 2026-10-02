import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

/*
 * Supprimer et classer dans l'outil, c'est aussi le faire dans Gmail.
 *
 * CE QUE CES TESTS PROTÈGENT. Un message supprimé ici part à la CORBEILLE de
 * Gmail (récupérable trente jours), jamais effacé pour de bon ; un libellé
 * changé ici l'est là-bas. Sans l'autorisation `gmail.modify`, rien n'est
 * tenté et l'écran le dit ; un Gmail en panne n'empêche pas de ranger l'outil.
 */

process.env.ENCRYPTION_KEY ??= Buffer.alloc(32, 1).toString('base64');
process.env.APP_URL ??= 'https://example.test';
process.env.DATABASE_URL ??= 'postgresql://u:p@localhost:5432/db';
process.env.REDIS_URL ??= 'redis://localhost:6379';
process.env.SHOPIFY_SCOPES ??= 'read_orders';
process.env.GOOGLE_SCOPES ??= 'https://www.googleapis.com/auth/gmail.readonly';

const { peutModifier, SCOPE_MODIFY } = await import('../src/services/gmail/modifier.ts');

const lire = (chemin: string) =>
  readFileSync(fileURLToPath(new URL(`../${chemin}`, import.meta.url)), 'utf8');

const service = lire('src/services/gmail/modifier.ts');
const routes = lire('src/routes/tickets.ts');

test('l’autorisation se lit dans ce que Google a accordé', () => {
  assert.equal(peutModifier(`https://www.googleapis.com/auth/gmail.readonly ${SCOPE_MODIFY}`), true);
  assert.equal(peutModifier('https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send'), false);
  // Boîte connectée avant ce changement : rien de stocké, rien de tenté.
  assert.equal(peutModifier(null), false);
  assert.match(lire('src/routes/auth.google.ts'), /scopes: tokens\.scope \?\? null,/);
  assert.match(lire('render.yaml'), /gmail\.send,https:\/\/www\.googleapis\.com\/auth\/gmail\.modify/);
});

test('la corbeille, jamais l’effacement définitif', () => {
  assert.match(service, /gmail\.users\.threads\.trash\(/);
  assert.doesNotMatch(service, /threads\.delete\(|messages\.delete\(|batchDelete/);
  // Ni en mode test, ni sans l'autorisation, ni pour un fil interne.
  assert.match(service, /if \(env\.GMAIL_MOCK \|\| \(await enModeTest\(merchantId\)\)\) return \{ issue: 'simule' as const \};/);
  assert.match(service, /if \(!peutModifier\(boite\.scopes\)\) return \{ issue: 'sans-droit' as const \};/);
  assert.match(service, /const estUnFilGmail = \(threadId: string\) => \/\^\[0-9a-f\]\+\$\/i\.test\(threadId\);/);
});

test('supprimer ici met le fil à la corbeille de Gmail, un ou plusieurs', () => {
  const unique = routes.slice(routes.indexOf("'/api/tickets/:id',\n    { preHandler: requirePermission('configure') }"));
  assert.ok(unique.indexOf('await mettreALaCorbeille(merchantId, ticket)') < unique.indexOf('prisma.ticket.delete('));
  assert.match(unique, /return reply\.send\(\{ deleted: true, gmail \}\);/);
  const masse = routes.slice(routes.indexOf("case 'delete': {"));
  // Les fils sont relus AVANT l'effacement : après, plus rien ne les désigne.
  assert.ok(masse.indexOf('select: { gmailThreadId: true, mailboxId: true }') < masse.indexOf('prisma.ticket.deleteMany'));
  assert.match(masse, /for \(const fil of fils\) await mettreALaCorbeille\(merchantId, fil\);/);
});

test('un libellé changé ici l’est dans Gmail, créé s’il n’existe pas', () => {
  assert.match(service, /gmail\.users\.labels\.create\(/);
  assert.match(service, /gmail\.users\.threads\.modify\(/);
  assert.match(routes, /const gmail = await reporterLibelles\(merchantId, avant, avant\.labels, labels\);/);
  assert.match(routes, /await reporterLibelles\(merchantId, target, target\.labels, nouveaux\.get\(target\.id\)!\);/);
});

test('l’écran dit ce que Gmail a fait, et comment l’activer', () => {
  const app = lire('public/app.js');
  assert.match(app, /'sans-droit': 'Message supprimé de l’outil\. Il reste dans Gmail/);
  assert.match(app, /corbeille et libellés : à activer/);
  assert.doesNotMatch(app, /Le mail reste dans votre boîte Gmail\. Irréversible\./);
  assert.match(lire('src/routes/settings.ts'), /gmailModifie: peutModifier\(mailbox\.scopes\),/);
});
