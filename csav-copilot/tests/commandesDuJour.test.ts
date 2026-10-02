import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { buildRawEmail } from '../src/services/gmail/mime.ts';
import { rapprocherAvantEnvoi, type PaireEnStock } from '../src/services/reshipment/rapprochement.ts';

/*
 * « Commandes du jour » : le stock retours d'abord, le fournisseur ensuite.
 *
 * CE QUE CES TESTS PROTÈGENT. Une commande ne part qu'une fois, jamais deux ;
 * une paire du stock n'est réservée que par le marchand, jamais par l'envoi
 * automatique ; et la journée se découpe à l'heure de Paris, pas à celle du
 * serveur — sinon les commandes de 23 h 30 changent de lot selon la saison.
 */

const lire = (chemin: string) =>
  readFileSync(fileURLToPath(new URL(`../${chemin}`, import.meta.url)), 'utf8');

// `quotidien.ts` ouvre Prisma à l'import : on relit ses deux fonctions de
// calendrier sans charger le module.
const service = lire('src/services/envoi/quotidien.ts');
function fonction<T>(nom: string): T {
  const debut = service.indexOf(`export function ${nom}(`);
  assert.ok(debut >= 0, `introuvable : ${nom}`);
  const source = service
    .slice(debut, service.indexOf('\n}\n', debut) + 2)
    .replace('export ', '')
    .replace(/\(date: Date\): \w+/, '(date)');
  return new Function('FUSEAU', `${source}; return ${nom};`)('Europe/Paris') as T;
}
const minuitParis = fonction<(date: Date) => Date>('minuitParis');
const heureParis = fonction<(date: Date) => number>('heureParis');

test('minuit se lit à Paris, en été comme en hiver', () => {
  assert.equal(minuitParis(new Date('2026-07-15T10:00:00Z')).toISOString(), '2026-07-14T22:00:00.000Z');
  assert.equal(minuitParis(new Date('2026-01-15T10:00:00Z')).toISOString(), '2026-01-14T23:00:00.000Z');
  // 00 h 30 à Paris : c'est déjà le lendemain, même si UTC dit encore la veille.
  assert.equal(minuitParis(new Date('2026-07-14T22:30:00Z')).toISOString(), '2026-07-14T22:00:00.000Z');
  assert.equal(heureParis(new Date('2026-07-15T10:00:00Z')), 12);
  assert.equal(heureParis(new Date('2026-01-15T10:00:00Z')), 11);
});

const paire = (id: string, titre: string, declinaison: string, depuis: string): PaireEnStock => ({
  id,
  pays: null,
  agenceId: null,
  agenceNom: null,
  sku: null,
  titre,
  declinaison,
  depuis: new Date(depuis),
  retourDe: null,
});
const commande = (id: string, creeLe: string, lignes: Array<[string, string, number]>) => ({
  id,
  nom: `#${id}`,
  client: null,
  pays: null,
  creeLe,
  lignes: lignes.map(([titre, declinaison, quantite]) => ({ titre, declinaison, sku: null, quantite })),
});

test('le stock du marchand sert une commande entière, sans regarder les pays', () => {
  const stock = [paire('p1', 'Nike Mind 001', 'Noir / 45', '2026-09-01')];
  const resultat = rapprocherAvantEnvoi(stock, [commande('1', '2026-09-30', [['nike mind 001', 'noir · 45', 1]])]);
  assert.deepEqual(resultat.map((c) => [c.commandeId, c.paires.map((p) => p.returnId)]), [['1', ['p1']]]);
});

test('une commande à moitié servie reste au fournisseur', () => {
  const stock = [paire('p1', 'Nike Mind 001', '45', '2026-09-01')];
  const resultat = rapprocherAvantEnvoi(stock, [
    commande('1', '2026-09-30', [['Nike Mind 001', '45', 1], ['Nike Mind 001', '46', 1]]),
    commande('2', '2026-09-30', [['Nike Mind 001', '45', 2]]),
  ]);
  assert.deepEqual(resultat, []);
});

test('une paire ne sert qu’une commande, la plus ancienne ; la plus vieille paire part d’abord', () => {
  const stock = [paire('recente', 'Lampe', 'Laiton', '2026-09-20'), paire('ancienne', 'Lampe', 'Laiton', '2026-09-01')];
  const resultat = rapprocherAvantEnvoi(stock, [
    commande('tard', '2026-09-30T18:00:00Z', [['Lampe', 'Laiton', 1]]),
    commande('tot', '2026-09-30T08:00:00Z', [['Lampe', 'Laiton', 1]]),
    commande('trop', '2026-09-30T20:00:00Z', [['Lampe', 'Laiton', 1]]),
  ]);
  assert.deepEqual(
    resultat.map((c) => [c.commandeId, c.paires[0]!.returnId]),
    [
      ['tot', 'ancienne'],
      ['tard', 'recente'],
    ],
  );
});

test('le fichier part en pièce jointe, intact', () => {
  const contenu = Buffer.from('PK\u0003\u0004 classeur factice '.repeat(40));
  const brut = buildRawEmail({
    to: 'atelier@example.com',
    from: 'sav@example.com',
    subject: 'Commandes du 1 oct.',
    body: 'Bonjour',
    attachments: [{ filename: 'commandes-2026-10-01.xlsx', mimeType: 'application/vnd.ms-excel', content: contenu }],
  });
  const mime = Buffer.from(brut.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');

  assert.match(mime, /Content-Type: multipart\/mixed; boundary="([^"]+)"/);
  assert.match(mime, /Content-Disposition: attachment; filename="commandes-2026-10-01\.xlsx"/);
  const partie = mime.split('filename="commandes-2026-10-01.xlsx"')[1]!;
  const base64 = partie.split('\r\n\r\n')[1]!.split('\r\n--')[0]!;
  assert.ok(base64.split('\r\n').every((ligne) => ligne.length <= 76), 'lignes de 76 caractères au plus');
  assert.deepEqual(Buffer.from(base64.replace(/\r\n/g, ''), 'base64'), contenu);
});

test('une commande ne part qu’une fois, et revient si le mail échoue', () => {
  const schema = lire('prisma/schema.prisma');
  assert.match(schema, /model EnvoiCommande \{[\s\S]*?@@unique\(\[merchantId, shopifyOrderId\]\)/);
  // Réclamées avant l'envoi, en écriture que la base refuse en double…
  assert.ok(service.indexOf('skipDuplicates: true') < service.indexOf('await sendPlainEmail('));
  // …et rendues si le mail ne part pas.
  assert.match(service, /catch \(error\) \{[\s\S]*?envoiCommande\.deleteMany\(\{ where: \{ envoiId: envoi\.id \} \}\)/);
});

test('l’envoi, automatique ou non, ne réserve jamais une paire du stock', () => {
  assert.doesNotMatch(service, /returnCase\.(update|updateMany|create)/);
  assert.doesNotMatch(service, /reemploi/);
});

test('l’envoi automatique passe toutes les quinze minutes, une fois l’heure venue', () => {
  assert.match(lire('src/queue/index.ts'), /upsertJobScheduler\(\s*'envoi-du-jour-passage',\s*\{ every: 15 \* 60 \* 1000 \}/);
  assert.match(lire('src/worker.ts'), /await passageAutomatique\(\);/);
  assert.match(service, /where: \{ envoiMode: 'AUTO', envoiHeure: \{ lte: heure \} \}/);
});

/* ---- les agences, avant l'envoi ---- */

const enAgence = (id: string, agence: string | null, pays: string | null, depuis = '2026-09-01'): PaireEnStock => ({
  ...paire(id, 'Nike Mind 001', '45', depuis),
  agenceId: agence,
  agenceNom: agence ? `Agence ${agence}` : null,
  pays,
});
const chez = (id: string, pays: string | null) => ({ ...commande(id, '2026-09-30', [['Nike Mind 001', '45', 1]]), pays });

test('l’agence du pays du client d’abord, même si une autre paire est plus ancienne', () => {
  const stock = [enAgence('belge', 'bxl', 'BE', '2026-08-01'), enAgence('francaise', 'paris', 'FR', '2026-09-10'), enAgence('maison', null, null, '2026-07-01')];
  const [servie] = rapprocherAvantEnvoi(stock, [chez('1', 'FR')]);
  assert.equal(servie!.paires[0]!.returnId, 'francaise');
  assert.deepEqual(servie!.agence, { id: 'paris', nom: 'Agence paris', pays: 'FR' });
  assert.equal(servie!.voisin, false);
});

test('à défaut, un pays voisin — signalé ; puis le stock du marchand', () => {
  const voisine = rapprocherAvantEnvoi([enAgence('belge', 'bxl', 'BE')], [chez('1', 'FR')]);
  assert.equal(voisine[0]!.voisin, true);
  const maison = rapprocherAvantEnvoi([enAgence('maison', null, null)], [chez('1', 'FR')]);
  assert.equal(maison[0]!.agence, null);
});

test('une agence ni du pays ni voisine n’est pas proposée ; sans pays, seul le stock du marchand', () => {
  // L'Espagne et la Belgique ne se touchent pas.
  assert.deepEqual(rapprocherAvantEnvoi([enAgence('esp', 'mad', 'ES')], [chez('1', 'BE')]), []);
  assert.deepEqual(rapprocherAvantEnvoi([enAgence('fr', 'paris', 'FR')], [chez('1', null)]), []);
  assert.equal(rapprocherAvantEnvoi([enAgence('maison', null, null)], [chez('1', null)]).length, 1);
});

test('l’écran dit où est la paire et qui l’expédie', () => {
  const service = readFileSync(fileURLToPath(new URL('../src/services/envoi/quotidien.ts', import.meta.url)), 'utf8');
  assert.match(service, /pays: paire\.agency\?\.country \?\? null,/);
  assert.match(service, /pays: order\.shippingAddress\?\.country \?\? null,/);
  const app = readFileSync(fileURLToPath(new URL('../public/app.js', import.meta.url)), 'utf8');
  assert.match(app, /c\.agence \? 'L’agence l’expédie' : 'Je l’expédie moi-même'/);
  assert.match(app, /'📍 Chez vous'/);
});
