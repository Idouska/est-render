import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

/*
 * Le formulaire de contact de la boutique : le client est celui qui l'a rempli.
 *
 * CE QUE CES TESTS PROTÈGENT. Shopify envoie ces messages depuis
 * `mailer@shopify.com`, au nom de la boutique. Pris tel quel, ce robot devenait
 * le client : la réponse serait partie vers `mailer@shopify.com` — le client ne
 * l'aurait jamais reçue —, la commande ne se retrouvait pas par son adresse, et
 * tous ces messages se comptaient comme un seul client. Le vrai client se lit
 * dans « Répondre à » et dans les champs du formulaire ; une réponse vers un
 * robot est refusée ; les conversations déjà reçues sont corrigées.
 *
 * Les textes ci-dessous reprennent le gabarit de Shopify, avec des personnes
 * et des adresses inventées.
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

const { lireFormulaire, vraiClient, apercuDuMessage, destinataireRobot } = await import(
  '../src/services/tickets/formulaireContact.ts'
);
const { motifNotification } = await import('../src/services/tickets/notification.ts');
const { envoyerBrouillon } = await import('../src/services/tickets/envoyerBrouillon.ts');
const { reparerFormulairesDeContact } = await import('../src/services/tickets/reparerFormulaires.ts');

const lire = (chemin: string) => readFileSync(fileURLToPath(new URL(`../${chemin}`, import.meta.url)), 'utf8');

/** Le gabarit actuel, en français. */
const FORMULAIRE = `Vous avez reçu un nouveau message du formulaire de contact de
votre boutique en ligne.

Indicatif de pays:
FR

Nom:
Jeanne Exemple

E-mail:
jeanne.exemple@example.org

Numéro de téléphone:
0600000000

Corps:
Bonjour,

j'ai commandé une paire en 42 (commande #18489).
Voici ma demande :
pouvez-vous l'échanger en 43 ?

Merci`;

/** Un thème plus ancien : libellés en anglais, « Adresse e-mail », « message ». */
const ANCIEN = `Vous avez reçu un nouveau message du formulaire de contact de
votre boutique en ligne.

Country Code:
FR

Name:
Paul Exemple

Adresse e-mail:
paul@example.com

Phone:

message:
Bonjour. J’ai passé la commande MF2111 et je n’ai aucune
nouvelle. Merci`;

const OBJET = 'Nouveau message de client le 22 novembre 2026 à 11:57';
const BOUTIQUE = 'contact@boutique-exemple.fr';

test('les champs du formulaire se lisent, quel que soit le thème', () => {
  const actuel = lireFormulaire(FORMULAIRE);
  assert.equal(actuel?.email, 'jeanne.exemple@example.org');
  assert.equal(actuel?.nom, 'Jeanne Exemple');
  assert.equal(actuel?.telephone, '0600000000');
  assert.equal(actuel?.pays, 'FR');
  // Le message garde ses paragraphes, et « Voici ma demande : » n'y coupe rien.
  assert.match(actuel?.message ?? '', /^Bonjour,\n\nj'ai commandé une paire en 42[\s\S]*Voici ma demande :\npouvez-vous l'échanger en 43 \?\n\nMerci$/);

  const ancien = lireFormulaire(ANCIEN);
  assert.equal(ancien?.email, 'paul@example.com');
  assert.equal(ancien?.nom, 'Paul Exemple');
  assert.equal(ancien?.telephone, null);
  assert.match(ancien?.message ?? '', /^Bonjour\. J’ai passé la commande MF2111/);

  // Libellé et valeur sur la même ligne, comme dans la démonstration.
  const enLigne = lireFormulaire('Prénom : Lou\nNom : Exemple\nE-mail : lou@example.net\n\nMessage :\nOù est mon colis ?');
  assert.equal(enLigne?.nom, 'Lou Exemple');
  assert.equal(enLigne?.email, 'lou@example.net');
  assert.equal(enLigne?.message, 'Où est mon colis ?');
});

test('le client est celui qui a rempli le formulaire, pas mailer@shopify.com', () => {
  const sansRepondreA = vraiClient({ fromEmail: 'mailer@shopify.com', toEmail: BOUTIQUE, subject: OBJET, bodyText: FORMULAIRE });
  assert.deepEqual(
    { email: sansRepondreA?.email, nom: sansRepondreA?.nom, formulaire: sansRepondreA?.formulaire },
    { email: 'jeanne.exemple@example.org', nom: 'Jeanne Exemple', formulaire: true },
  );

  // « Répondre à » d'abord : c'est là que Gmail lui-même répondrait.
  const avecRepondreA = vraiClient({
    fromEmail: 'mailer@shopify.com',
    toEmail: BOUTIQUE,
    replyTo: 'jeanne@autre-exemple.org',
    subject: OBJET,
    bodyText: FORMULAIRE,
  });
  assert.equal(avecRepondreA?.email, 'jeanne@autre-exemple.org');
  assert.equal(avecRepondreA?.nom, 'Jeanne Exemple');
});

test('rien ne change pour un client qui écrit lui-même, ni pour une notification', () => {
  assert.equal(vraiClient({ fromEmail: 'client@example.com', replyTo: 'autre@example.org', subject: 'Ma commande', bodyText: 'Nom: X\nE-mail: y@example.org' }), null);
  // Une notification Shopify qui cite une adresse n'est pas un formulaire.
  assert.equal(vraiClient({ fromEmail: 'mailer@shopify.com', toEmail: BOUTIQUE, subject: 'Virement effectué', bodyText: 'Email: compta@example.org' }), null);
  // L'adresse de la boutique n'est jamais le client : répondre à soi-même ne prévient personne.
  assert.equal(vraiClient({ fromEmail: 'mailer@shopify.com', toEmail: BOUTIQUE, replyTo: BOUTIQUE, subject: 'Commande #1 passée', bodyText: 'Commande passée' }), null);
});

test('un formulaire de contact n’est jamais rangé dans les notifications', () => {
  // L'objet actuel de Shopify, « message de client », est protégé comme l'ancien.
  assert.equal(motifNotification({ fromEmail: 'mailer@shopify.com', subject: OBJET }), null);
  assert.equal(motifNotification({ fromEmail: 'mailer@shopify.com', subject: 'Nouveau message client du 23 janvier 2024 à 10:22' }), null);
  // Et même si le marchand a rangé l'expéditeur de Shopify dans les notifications.
  const ingest = lire('src/services/tickets/ingest.ts');
  assert.match(ingest, /const client = vraiClient\(\{ \.\.\.message, \.\.\.message\.entetes \}\);/);
  assert.match(ingest, /const motif = client\?\.formulaire \? null : motifNotification\(/);
});

test('à l’arrivée, le ticket prend le nom et l’adresse du client, et l’aperçu ses mots', () => {
  for (const fichier of ['src/services/tickets/ingest.ts', 'src/services/gmail/backfill.ts']) {
    const source = lire(fichier);
    assert.match(source, /customerEmail: client\?\.email \?\? message\.fromEmail,/, fichier);
    assert.match(source, /customerName: client\?\.nom \?\? message\.fromName,/, fichier);
    assert.match(source, /snippet: client\?\.message \? apercuDuMessage\(client\.message\) : message\.snippet/, fichier);
  }
  const historique = lire('src/services/gmail/importHistory.ts');
  assert.match(historique, /customerEmail: client\?\.email \?\? firstInbound\.message\.fromEmail,/);
  assert.match(historique, /if \(!client && isAutomated\(firstInbound\.message\.fromEmail\)\)/);
  assert.match(lire('src/services/gmail/messages.ts'), /replyToName: repondreA\.name,/);

  assert.equal(
    apercuDuMessage(lireFormulaire(FORMULAIRE)!.message!),
    "Bonjour, j'ai commandé une paire en 42 (commande #18489). Voici ma demande : pouvez-vous l'échanger en 43 ? Merci",
  );
});

test('une réponse vers un robot ne part pas', async () => {
  assert.equal(destinataireRobot('mailer@shopify.com'), true);
  assert.equal(destinataireRobot('no-reply@example.com'), true);
  assert.equal(destinataireRobot('jeanne.exemple@example.org'), false);

  const interdit = () => {
    throw new Error('rien ne doit partir');
  };
  const issue = await envoyerBrouillon(
    { draftId: 'd1', merchantId: 'm1', userId: 'u1' },
    {
      prisma: {
        draft: {
          findFirst: async () => ({ id: 'd1', status: 'PENDING_REVIEW', ticket: { customerEmail: 'mailer@shopify.com' } }),
          updateMany: interdit,
        },
      },
      sendDraft: interdit,
      sendReplyInThread: interdit,
      recordOutbound: interdit,
      recordAudit: interdit,
    } as never,
  );
  assert.equal(issue, 'destinataire-robot');

  const routes = lire('src/routes/tickets.ts');
  assert.match(routes, /if \(issue === 'destinataire-robot'\) return reply\.code\(422\)/);
  // « Écrire au client » a la même garde.
  assert.match(routes, /if \(destinataireRobot\(email\.to\)\) \{\n\s+return reply\.code\(422\)/);
});

test('les conversations déjà reçues sont rendues à leur client, et réanalysées si elles attendent', async () => {
  const maintenant = new Date('2026-11-23T10:00:00Z');
  const recent = new Date('2026-11-22T11:57:00Z');
  const message = { id: 'msg', fromEmail: 'mailer@shopify.com', toEmail: BOUTIQUE, subject: OBJET, bodyText: FORMULAIRE };
  const tickets = [
    // En attente, rien de retouché : corrigé et réanalysé.
    { id: 't1', merchantId: 'm1', subject: OBJET, status: 'FAILED', isHistorical: false, notification: false, lastMessageAt: recent, messages: [message], drafts: [] },
    // Brouillon retouché par l'équipe : corrigé, mais son travail n'est pas écrasé.
    { id: 't2', merchantId: 'm1', subject: OBJET, status: 'DRAFT_READY', isHistorical: false, notification: false, lastMessageAt: recent, messages: [message], drafts: [{ id: 'd' }] },
    // Déjà traité : corrigé seulement.
    { id: 't3', merchantId: 'm1', subject: OBJET, status: 'CLOSED', isHistorical: false, notification: false, lastMessageAt: recent, messages: [message], drafts: [] },
    // Sans adresse lisible : laissé tel quel.
    { id: 't4', merchantId: 'm1', subject: OBJET, status: 'NEW', isHistorical: false, notification: false, lastMessageAt: recent, messages: [{ ...message, bodyText: 'Vous avez reçu un nouveau message du formulaire de contact.\n\nCorps:\nBonjour' }], drafts: [] },
  ];

  const ecritures: unknown[] = [];
  const relances: string[] = [];
  let filtre: unknown;
  const bilan = await reparerFormulairesDeContact({
    prisma: {
      ticket: {
        findMany: async (requete: { where: unknown }) => {
          filtre = requete.where;
          return tickets;
        },
        update: (requete: unknown) => ({ ticket: requete }),
      },
      message: { update: (requete: unknown) => ({ message: requete }) },
      $transaction: async (operations: unknown[]) => {
        ecritures.push(...operations);
        return operations;
      },
    } as never,
    enqueueTicket: async (job: { ticketId: string }) => {
      relances.push(job.ticketId);
    },
    maintenant: () => maintenant,
  });

  assert.deepEqual(bilan, { repares: 3, relances: 1 });
  assert.deepEqual(relances, ['t1']);
  assert.match(JSON.stringify(filtre), /"customerEmail":\{"endsWith":"@shopify.com"\}/);
  assert.deepEqual(ecritures[0], {
    ticket: { where: { id: 't1' }, data: { customerEmail: 'jeanne.exemple@example.org', customerName: 'Jeanne Exemple' } },
  });
  assert.match(JSON.stringify(ecritures[1]), /"snippet":"Bonjour, j'ai commandé une paire en 42/);

  // Au démarrage des workers, sans bloquer leur lancement.
  assert.match(lire('src/worker.ts'), /void reparerFormulairesDeContact\(\)/);
});

test('l’objet daté de Shopify s’affiche « Formulaire de contact »', () => {
  const app = lire('public/app.js');
  const source = app.slice(app.indexOf('const OBJET_FORMULAIRE ='), app.indexOf('function ticketTitle('));
  const { objetLisible } = new Function(`${source}; return { objetLisible };`)();
  assert.equal(objetLisible(OBJET), 'Formulaire de contact');
  assert.equal(objetLisible('Nouveau message client du 23 janvier 2024 à 10:22'), 'Formulaire de contact');
  assert.equal(objetLisible('Where is my order #4127?'), 'Where is my order #4127?');
  assert.equal(objetLisible(null), '');
  assert.match(app, /return objetLisible\(ticket\.subject\) \|\| 'Analyse en cours…';/);
  // L'objet réel reste celui de la réponse : le changer sortirait la réponse du fil Gmail.
  assert.match(app, /function replySubject\(ticket\) \{\n\s+const raw = \(ticket\.subject \?\? ''\)\.trim\(\);/);
});
