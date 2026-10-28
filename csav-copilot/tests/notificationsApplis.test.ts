import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { randomBytes } from 'node:crypto';

/*
 * Les notifications d'applis, rangées hors de la file.
 *
 * CE QUE CES TESTS PROTÈGENT. Un mail de Judge.me, une infolettre, une
 * réponse automatique ne sont pas des clients : ils ne doivent ni encombrer
 * la file, ni compter dans le SAV, ni coûter un brouillon d'IA. Mais un vrai
 * client ne doit JAMAIS disparaître : le formulaire de contact (envoyé par
 * Shopify) et tout ce qui parle de litige restent dans la file, et une
 * messagerie grand public ne se range jamais en entier.
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

const { motifNotification, estWebmail } = await import('../src/services/tickets/notification.ts');
const lire = (chemin: string) => readFileSync(fileURLToPath(new URL(chemin, import.meta.url)), 'utf8');

test('les applis et les robots sont rangés à part', () => {
  assert.equal(motifNotification({ fromEmail: 'support@judge.me', subject: 'Salut MyFootify' }), 'Appli : judge.me');
  assert.ok(motifNotification({ fromEmail: 'no-reply@example.com', subject: 'Votre facture' }));
  assert.ok(motifNotification({ fromEmail: 'news@marque.fr', subject: 'Soldes', listUnsubscribe: true }));
  assert.ok(motifNotification({ fromEmail: 'jean@entreprise.fr', subject: 'Absent', autoSubmitted: 'auto-replied' }));
  assert.ok(motifNotification({ fromEmail: 'promo@boutique.fr', subject: '-50 %', labelIds: ['INBOX', 'CATEGORY_PROMOTIONS'] }));
  assert.ok(motifNotification({ fromEmail: 'list@forum.org', subject: 'Digest', precedence: 'bulk' }));
});

test('un client reste dans la file', () => {
  assert.equal(motifNotification({ fromEmail: 'lea.fontaine@gmail.com', subject: 'Où est ma commande ?' }), null);
  // Le formulaire de contact : envoyé par Shopify, écrit par un client.
  assert.equal(
    motifNotification({ fromEmail: 'mailer@shopify.com', subject: 'Nouveau message depuis le formulaire de contact' }),
    null,
  );
  assert.equal(
    motifNotification({ fromEmail: 'mailer@shopify.com', subject: 'Question', replyTo: 'client@gmail.com' }),
    null,
  );
  // Un litige ne disparaît jamais, même d'une adresse automatique.
  assert.equal(motifNotification({ fromEmail: 'noreply@paypal.fr', subject: 'Un litige a été ouvert' }), null);
  assert.equal(motifNotification({ fromEmail: 'service@paypal.fr', subject: 'Paiement reçu' }), null);
  // L'onglet « Mises à jour » de Gmail ne suffit pas : il y range aussi des clients.
  assert.equal(motifNotification({ fromEmail: 'client@orange.fr', subject: 'Re: commande', labelIds: ['CATEGORY_UPDATES'] }), null);
});

test('la main du marchand prime sur le tri automatique', () => {
  const reglages = { expediteursNotif: ['fournisseur-pub.com'], expediteursClients: ['support@judge.me'] };
  assert.equal(motifNotification({ fromEmail: 'support@judge.me', subject: 'Avis' }, reglages), null);
  assert.equal(
    motifNotification({ fromEmail: 'ventes@fournisseur-pub.com', subject: 'Offre' }, reglages),
    'Expéditeur rangé dans les notifications',
  );
});

test('une messagerie grand public ne se range jamais en entier', () => {
  for (const email of ['a@gmail.com', 'b@hotmail.fr', 'c@orange.fr', 'd@icloud.com', 'e@outlook.com']) {
    assert.equal(estWebmail(email), true, email);
  }
  assert.equal(estWebmail('support@judge.me'), false);
  assert.match(lire('../src/routes/tickets.ts'), /parsed\.data\.portee === 'domaine' && !estWebmail\(adresse\) \? 'domaine' : 'adresse'/);
});

test('une notification n’entre pas dans la file, les compteurs ni l’IA', () => {
  const tickets = lire('../src/routes/tickets.ts');
  assert.match(tickets, /filters\.folder === 'notifications' \? \{\} : \{ notification: false \}/);
  assert.match(tickets, /case 'notifications':\n\s+return \{ notification: true \};/);
  assert.match(tickets, /folders: \{ inbox, archived, drafts, sent, notifications \}/);
  assert.match(lire('../src/services/tickets/process.ts'), /if \(ticket\.notification\) \{/);
  assert.match(lire('../src/services/tickets/ingest.ts'), /notification: motif !== null,/);
  assert.match(lire('../src/services/gmail/backfill.ts'), /notification: motif !== null,/);
  // Partout où l'historique importé est écarté, les notifications le sont aussi.
  for (const fichier of ['../src/routes/stats.ts', '../src/services/stats/savPeriode.ts', '../src/services/gmail/unreadScope.ts']) {
    const texte = lire(fichier);
    assert.equal(
      (texte.match(/isHistorical: false/g) ?? []).length,
      (texte.match(/notification: false/g) ?? []).length,
      fichier,
    );
  }
});

test('l’écran signale le dossier et permet de corriger le tri', () => {
  assert.match(lire('../public/dashboard.html'), /id="notif-ligne" hidden/);
  assert.match(lire('../public/dashboard.html'), /id="d-notif-remettre"/);
  const app = lire('../public/app.js');
  assert.match(app, /data-notif-bascule/);
  assert.match(app, /\/api\/tickets\/\$\{ticket\.id\}\/notification/);
});
