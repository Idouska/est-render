import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { LANGS, STRINGS } from '../public/workspace.i18n.js';

/*
 * Le remplacement proposé à l'atelier.
 *
 * CE QUE CES TESTS PROTÈGENT. La substitution se discutait par e-mail et par
 * fil de discussion : le marchand écrivait « on peut mettre la 44 ? »,
 * l'atelier répondait en texte libre, et il fallait relire le fil pour savoir
 * ce qui avait été proposé et ce qui avait été accepté.
 *
 * Trois choses doivent tenir pour que l'échange quitte vraiment le mail.
 *
 * 1. L'AVIS NE PORTE PAS LA PROPOSITION. S'il recopiait le modèle et sa
 *    taille, l'atelier répondrait par mail — et on aurait déplacé le problème
 *    au lieu de le résoudre.
 *
 * 2. PERSONNE N'ÉCRIT CHEZ UN AUTRE. L'identifiant d'atelier arrive dans le
 *    corps de la requête ; cru sur parole, il enverrait la proposition chez
 *    n'importe quel fournisseur de la boutique. Et un atelier ne répond que
 *    sur ce qui lui est adressé.
 *
 * 3. LA RECHERCHE DE COMMANDE N'OUVRE AUCUN DROIT. Elle ignore les dates, et
 *    rien d'autre : le niveau d'accès posé par le marchand s'applique comme
 *    dans la liste.
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

const { avisSubstitution } = await import('../src/services/ruptures/substitution.ts');

const lire = (chemin: string) =>
  readFileSync(fileURLToPath(new URL(`../${chemin}`, import.meta.url)), 'utf8');
const sansCommentaires = (code: string) =>
  code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/[^\n]*/gm, '');

/* ---- 1. l'avis ---- */

test('l’avis renvoie à l’atelier, et ne recopie pas la proposition', () => {
  const avis = avisSubstitution({
    merchantName: 'Running Upscale',
    orderName: '#14674',
    combien: 2,
    lien: 'https://example.test/fournisseur/a1?token=xyz',
    signature: null,
  });

  assert.match(avis.subject, /#14674/, 'le numéro de commande, pas un identifiant interne');
  assert.match(avis.subject, /2 modèles/);
  assert.match(avis.body, /https:\/\/example\.test\/fournisseur\/a1\?token=xyz/, 'le lien vers son atelier');
  assert.match(avis.body, /Running Upscale/, 'signé, sinon le mail part en indésirables');

  // Rien du détail : le recopier inviterait à répondre par mail, ce qu'on
  // vient précisément de quitter.
  for (const fuite of [/taille/i, /référence/i, /\bsku\b/i]) {
    assert.ok(!fuite.test(avis.body), `le détail ne doit pas figurer dans l’avis : ${fuite}`);
  }
});

test('un seul modèle se dit au singulier', () => {
  const avis = avisSubstitution({ merchantName: 'M', orderName: null, combien: 1, lien: 'https://x' });
  assert.match(avis.subject, /un modèle de remplacement/);
});

/* ---- 2. qui peut écrire, et chez qui ---- */

const ruptures = sansCommentaires(lire('src/routes/ruptures.ts'));
const envoi = ruptures.slice(ruptures.indexOf("app.post<{ Params: { ticketId: string } }>"));

test('l’atelier annoncé par le client est vérifié, jamais cru', () => {
  const verif = envoi.indexOf('prisma.supplier.findFirst');
  const appel = envoi.indexOf('proposerSubstitutions(');
  assert.ok(verif > 0, 'la vérification doit exister');
  assert.ok(appel > 0);
  assert.ok(verif < appel, 'et précéder l’envoi');
  assert.match(
    envoi.slice(verif, verif + 200),
    /merchantId/,
    'bornée au marchand : sans cela, un identifiant choisi atteindrait l’atelier d’une autre boutique',
  );
});

test('le ticket aussi est vérifié : on ne propose pas sur le dossier d’un autre', () => {
  const ticket = envoi.indexOf('prisma.ticket.findFirst');
  assert.ok(ticket > 0 && ticket < envoi.indexOf('proposerSubstitutions('));
  assert.match(envoi.slice(ticket, ticket + 160), /merchantId/);
});

test('l’atelier ne répond que sur ce qui lui est adressé', () => {
  const atelier = sansCommentaires(lire('src/routes/supplierWorkspace.ts'));
  const route = atelier.slice(atelier.indexOf("'/api/workspace/:id/substitutions/:subId'"));
  const ecriture = route.indexOf('prisma.ruptureSubstitution.updateMany');
  assert.ok(ecriture > 0);
  assert.match(
    route.slice(ecriture, ecriture + 350),
    /supplierId: workspace\.supplierId/,
    'la proposition d’un autre fournisseur ne se répond pas d’ici',
  );
  assert.match(route.slice(ecriture, ecriture + 800), /misAJour\.count === 0/);
});

test('l’atelier ne voit que les propositions qui lui sont faites', () => {
  const atelier = sansCommentaires(lire('src/routes/supplierWorkspace.ts'));
  const lecture = atelier.slice(atelier.indexOf('prisma.ruptureSubstitution.findMany'));
  assert.match(lecture.slice(0, 300), /supplierId: workspace\.supplierId/);
});

/* ---- 3. la recherche de commande ---- */

const atelier = sansCommentaires(lire('src/routes/supplierWorkspace.ts'));
const recherche = atelier.slice(atelier.indexOf("'/api/workspace/:id/orders/search'"));

test('la recherche ignore les dates, et rien d’autre', () => {
  const borne = recherche.indexOf('allowedOrderIds(workspace)');
  const routage = recherche.indexOf('ordersForSupplier(');
  assert.ok(borne > 0, 'le niveau d’accès s’applique');
  assert.ok(routage > 0, 'et les règles de routage aussi');
  assert.match(recherche.slice(0, 900), /ordersAccess === 'NONE'/, 'un compte fermé ne trouve rien');
  assert.ok(!recherche.slice(0, 2000).includes('toShopifyRange'), 'aucune borne de date');
});

test('une commande trouvée mais non confiée se dit, au lieu de passer pour inexistante', () => {
  assert.match(recherche, /Cette commande ne vous est pas confiée/);
});

test('le numéro se cherche avec et sans dièse', () => {
  // L'atelier recopie ce qu'il a sous les yeux : « 14674 » ou « #14674 ».
  assert.match(recherche, /replace\(\/\^#\/, ''\)/);
  assert.match(recherche, /name:\$\{quoteSearchValue\(`#\$\{numero\}`\)\} OR name:\$\{quoteSearchValue\(numero\)\}/);
});

/* ---- la déclinaison rangée dans le bon champ ---- */

const workspace = lire('public/workspace.js');
const repartir = (() => {
  const debut = workspace.indexOf('function repartirDeclinaison(');
  const fin = workspace.indexOf('function kindLabel(');
  return new Function(`${workspace.slice(debut, fin)} return repartirDeclinaison;`)() as (
    v: string | null | undefined,
  ) => { couleur: string; taille: string };
})();

test('une pointure ne va plus dans « Couleur »', () => {
  // Le défaut signalé : la carte affichait « Couleur : 45 1/3 ».
  assert.deepEqual(repartir('45 1/3'), { couleur: '', taille: '45 1/3' });
  assert.deepEqual(repartir('38,5'), { couleur: '', taille: '38,5' });
});

test('la barre oblique d’une fraction n’est pas un séparateur d’options', () => {
  // Découper « 45 1/3 » dessus donnait « Couleur : 45 1 » et « Taille : 3 »,
  // ce qui est pire que l'erreur d'origine.
  assert.equal(repartir('45 1/3').taille, '45 1/3');
  assert.deepEqual(repartir('Lucid Red / 45 1/3'), { couleur: 'Lucid Red', taille: '45 1/3' });
});

test('deux options sans pointure restent une couleur', () => {
  assert.deepEqual(repartir('Black / Rouge'), { couleur: 'Black / Rouge', taille: '' });
  assert.deepEqual(repartir('Lucid Red Core Black'), { couleur: 'Lucid Red Core Black', taille: '' });
});

test('l’ordre des options n’a pas d’importance', () => {
  assert.deepEqual(repartir('Black / 42'), { couleur: 'Black', taille: '42' });
  assert.deepEqual(repartir('42 / Black'), { couleur: 'Black', taille: '42' });
});

test('le formulaire s’en sert', () => {
  assert.match(workspace, /const \{ couleur, taille \} = repartirDeclinaison\(first\?\.variantTitle\)/);
  assert.match(workspace, /\$\('issue-size'\)\.value = taille/);
});

/* ---- la navigation de l'atelier ---- */

const html = lire('public/workspace.html');

test('quatre entrées de menu, et l’accueil d’abord', () => {
  const entrees = [...html.matchAll(/data-view="(\w+)"/g)].map((m) => m[1]!);
  assert.deepEqual(entrees, ['home', 'orders', 'catalog', 'tickets']);
  assert.match(workspace, /view: 'home',/);
});

test('le contenu n’a pas disparu : il a changé de place', () => {
  for (const section of ['home', 'orders', 'tracking', 'catalog', 'tickets']) {
    assert.match(html, new RegExp(`id="view-${section}"`), `l’écran ${section} existe`);
  }
  assert.match(workspace, /orders: \['orders', 'tracking'\]/);
  assert.match(workspace, /tickets: \['tickets'\]/);
  // Changements, ruptures, signalements et échanges : tous dans la liste unique.
  const chargement = workspace.slice(workspace.indexOf('async function chargerTickets'));
  for (const carte of ['carteUpdate(update)', 'carteRupture(demande', 'carteRupture(signalement', 'echangeMarkup(echange']) {
    assert.ok(chargement.includes(carte), carte);
  }
});

test('une seule pastille, alimentée par les trois comptes', () => {
  assert.match(workspace, /const attentes = \{ updates: 0, ruptures: 0, echanges: 0 \}/);
  for (const poseur of ['setBadge', 'setRuptureBadge', 'setEchangeBadge']) {
    const debut = workspace.indexOf(`function ${poseur}(`);
    assert.ok(debut > 0, poseur);
    assert.match(
      workspace.slice(debut, workspace.indexOf('\n}', debut)),
      /majPastilleTickets\(\)/,
      `${poseur} doit nourrir la pastille commune`,
    );
  }
});

/* ---- la carte de l'atelier ---- */

test('la carte montre le modèle en rupture, et ne renvoie plus vers un fil', () => {
  const carte = workspace.slice(
    workspace.indexOf('function carteRupture('),
    workspace.indexOf('function substitutionMarkup('),
  );
  assert.match(carte, /rup\.outOfStock/, 'le modèle manquant est annoncé');
  assert.match(carte, /rup\.proposed/, 'et les remplacements proposés');
  assert.ok(!carte.includes('demande.lien'), 'plus de lien vers le fil de discussion');
  assert.ok(!workspace.includes("t('rup.answer')"), 'plus de bouton « Répondre au marchand »');
});

test('répondre est un bouton, pas une phrase', () => {
  const ligne = workspace.slice(
    workspace.indexOf('function substitutionMarkup('),
    workspace.indexOf('function cablerSubstitutions('),
  );
  assert.match(ligne, /data-sub-oui=/);
  assert.match(ligne, /data-sub-non=/);
  // Une proposition déjà répondue ne se repropose pas : elle affiche son état.
  assert.match(ligne, /repondu\s*\n?\s*\?/);
});

/* ---- les langues ---- */

test('l’atelier lit tout cela dans sa langue', () => {
  const appelees = new Set([
    ...[...workspace.matchAll(/\bt\('((?:rup|orders|nav|sous)\.[\w.]+)'/g)].map((m) => m[1]!),
    ...[...html.matchAll(/data-t="((?:rup|orders|nav|sous)\.[\w.]+)"/g)].map((m) => m[1]!),
    ...[...html.matchAll(/data-tph="((?:rup|orders|nav|sous)\.[\w.]+)"/g)].map((m) => m[1]!),
  ]);
  assert.ok(appelees.size >= 20, 'le vocabulaire manque');

  for (const { code } of LANGS) {
    const table = (STRINGS as Record<string, Record<string, string>>)[code]!;
    assert.deepEqual([...appelees].filter((cle) => typeof table[cle] !== 'string'), [], `${code} : clé absente`);
  }
});
