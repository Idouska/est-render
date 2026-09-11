import assert from 'node:assert/strict';
import test from 'node:test';

import { randomBytes } from 'node:crypto';
import { deflateRawSync } from 'node:zlib';

import ExcelJS from 'exceljs';

import { lireCollage, planifierLot } from '../src/services/suppliers/importColis.ts';
import {
  ClasseurRefuse,
  LIGNES_FEUILLES_MAX,
  XML_MAX,
  decompresser,
  lireClasseur,
  unALaFois,
} from '../src/services/suppliers/lireClasseur.ts';

/*
 * Le classeur Excel déposé par l'atelier.
 *
 * CE QUE CES TESTS PROTÈGENT. Le parcours visé tient en trois gestes :
 * télécharger la feuille, remplir la colonne « Tracking », la redéposer. Il
 * ne marche que si la lecture comprend la feuille que l'outil a lui-même
 * écrite — d'où le premier test, qui passe par le vrai export.
 *
 * Deux dangers silencieux ensuite. Un numéro de suivi tapé en chiffres dans
 * Excel devient un nombre dont les derniers chiffres sont perdus : le
 * transmettre enverrait au client un suivi qui n'existe pas. Et un .xlsx est
 * une archive : une archive piégée peut se décompresser en gigaoctets et
 * faire tomber le serveur de tous les marchands.
 */

/*
 * L'export tire le journal du serveur, qui valide sa configuration au
 * chargement. On renseigne le minimum avant de l'importer — comme
 * `queue.test.ts` — plutôt que de réécrire un faux export qui divergerait du
 * vrai au premier changement de colonne.
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

const { ordersToXlsx } = await import('../src/services/export/ordersXlsx.ts');

/** Une image PNG d'un pixel. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

async function classeur(lignes: (string | number | null)[][]): Promise<Buffer> {
  const livre = new ExcelJS.Workbook();
  const feuille = livre.addWorksheet('Feuille');
  for (const ligne of lignes) feuille.addRow(ligne);
  return Buffer.from(await livre.xlsx.writeBuffer());
}

/* ---- le parcours réel : l'export de l'outil, rempli, redéposé ---- */

test('la feuille exportée par l’outil, remplie puis redéposée, se relit', async () => {
  const commande = (id: string, name: string, quantite = 1) => ({
    id,
    name,
    createdAt: '2026-09-10T20:00:00Z',
    displayFulfillmentStatus: 'UNFULFILLED',
    customer: { displayName: 'Mahdi Ashir', email: 'mahdi@example.com' },
    shippingAddress: { name: 'Mahdi Ashir', city: 'Surrey', country: 'CA' },
    lineItems: [
      {
        title: 'Nike Mind 001',
        quantity: quantite,
        variantTitle: '45',
        sku: 'HQ4307-001',
        image: 'https://cdn.test/nike.png',
      },
    ],
  });

  // Le vrai export, AVEC la photo du produit : c'est ce que l'atelier
  // télécharge, et les photos passent par des parties que la lecture n'extrait
  // pas. La photo vient d'un faux réseau, pour ne rien aller chercher dehors.
  const reseau = globalThis.fetch;
  globalThis.fetch = (async () => new Response(PNG)) as typeof fetch;
  let exporte: Buffer;
  try {
    exporte = await ordersToXlsx([
      { order: commande('gid://shopify/Order/1', '#13811') as never, storeUrl: 'https://x.test' },
      { order: commande('gid://shopify/Order/2', '#13812') as never, storeUrl: 'https://x.test' },
      { order: commande('gid://shopify/Order/3', '#13813') as never, storeUrl: 'https://x.test' },
    ]);
  } finally {
    globalThis.fetch = reseau;
  }
  assert.ok(exporte.includes('xl/media/'), 'l’export doit bien porter la photo');

  // L'atelier ouvre la feuille et remplit « Tracking » pour deux commandes.
  const livre = new ExcelJS.Workbook();
  await livre.xlsx.load(exporte as unknown as ArrayBuffer);
  const feuille = livre.worksheets[0]!;
  const colonneSuivi = (feuille.getRow(1).values as string[]).indexOf('Tracking');
  assert.ok(colonneSuivi > 0, 'l’export doit porter une colonne « Tracking »');
  feuille.getRow(2).getCell(colonneSuivi).value = '1Z999AA10123456784';
  feuille.getRow(4).getCell(colonneSuivi).value = 'LX123456789CN';
  const redepose = Buffer.from(await livre.xlsx.writeBuffer());

  const lu = await lireClasseur(redepose);

  assert.equal(lu.colonnes, 'titres', 'les colonnes se trouvent par leur titre');
  assert.equal(lu.lues, 2);
  assert.equal(lu.ignorees, 1, 'la commande sans numéro n’est pas une erreur, juste pas encore partie');
  assert.deepEqual(lireCollage(lu.texte).map((l) => [l.commande, l.suivi]), [
    ['#13811', '1Z999AA10123456784'],
    ['#13813', 'LX123456789CN'],
  ]);
});

/* ---- les autres formes de fichier ---- */

test('sans titres reconnus, les trois premières colonnes font foi', async () => {
  const lu = await lireClasseur(
    await classeur([
      ['#13811', 'ABC123456', 'UPS'],
      ['#13812', 'DEF789012', 'DHL'],
    ]),
  );
  assert.equal(lu.colonnes, 'position');
  assert.equal(lu.texte, '#13811\tABC123456\tUPS\n#13812\tDEF789012\tDHL');
});

test('les titres se reconnaissent en français et en chinois', async () => {
  const fr = await lireClasseur(
    await classeur([
      ['Transporteur', 'Numéro de suivi', 'N° de commande', 'Commande'],
      ['UPS', 'ABC123456', 'x', '#13811'],
    ]),
  );
  assert.equal(fr.texte, '#13811\tABC123456\tUPS', 'l’ordre des colonnes n’importe pas');

  const zh = await lireClasseur(
    await classeur([
      ['订单号', '运单号', '快递公司'],
      ['#13811', 'SF1234567890', '顺丰'],
    ]),
  );
  assert.equal(zh.texte, '#13811\tSF1234567890\t顺丰');
});

test('les titres d’un atelier se reconnaissent, même approximatifs', async () => {
  // Le fichier de test demandé par le marchand, tel quel. Avant, « Num de
  // commande » n'était pas reconnu : la lecture retombait sur l'ordre des
  // colonnes, et l'URL de suivi devenait le transporteur envoyé à Shopify.
  const lu = await lireClasseur(
    await classeur([
      ['Num de commande', 'tracking number', "l'url de tracking", 'autre'],
      ['#13811', 'TEST-13811', 'https://t.17track.net/fr#nums=TEST-13811', 'Carton 1/1'],
      ['#13810', 'TEST-13810', 'https://t.17track.net/fr#nums=TEST-13810', ''],
    ]),
  );
  assert.equal(lu.colonnes, 'titres');
  assert.equal(lu.lues, 2, 'la ligne de titres n’est pas un numéro');
  assert.equal(lu.texte, '#13811\tTEST-13811\t\n#13810\tTEST-13810\t', 'ni URL ni « autre » ne sont lus');
});

test('une URL de suivi n’est jamais prise pour le numéro, même placée avant lui', async () => {
  const lu = await lireClasseur(
    await classeur([
      ['Tracking URL', 'N° commande', 'Numéro de tracking', 'Transporteur'],
      ['https://t.17track.net/x', '#13811', 'LX123456789CN', 'China Post'],
    ]),
  );
  assert.equal(lu.texte, '#13811\tLX123456789CN\tChina Post');
});

test('faute de titres reconnus, une ligne de titres inconnus ne se compte pas', async () => {
  const lu = await lireClasseur(
    await classeur([
      ['N', 'Colis', 'Info'],
      ['#13811', 'ABC123456', 'UPS'],
    ]),
  );
  assert.equal(lu.colonnes, 'position');
  assert.equal(lu.lues, 1);
  assert.equal(lu.texte, '#13811\tABC123456\tUPS');
});

test('un numéro de commande stocké en nombre se relit sans virgule', async () => {
  const lu = await lireClasseur(await classeur([['Order', 'Tracking'], [13811, 'ABC123456']]));
  assert.equal(lu.texte, '13811\tABC123456\t');
});

/* ---- le numéro abîmé par Excel ---- */

test('un suivi tapé en chiffres et abîmé par Excel est refusé, pas transmis', async () => {
  // Excel ne garde que quinze chiffres d'un nombre : ces vingt-deux chiffres
  // sont déjà faux dans le fichier. Les transmettre enverrait au client un
  // numéro qui n'existe pas.
  const lu = await lireClasseur(
    await classeur([['Order', 'Tracking'], ['#13811', 9400111202555842761023]]),
  );

  const plan = planifierLot(
    lireCollage(lu.texte),
    [{ id: 'gid://shopify/Order/1', name: '#13811', client: 'Mahdi Ashir' }],
    [],
  );
  assert.equal(plan.lignes[0]!.statut, 'abime_excel');
  assert.equal(plan.prets, 0);
});

test('le même numéro abîmé, collé depuis Excel en français, est refusé aussi', () => {
  const plan = planifierLot(
    lireCollage('#13811\t9,40011E+21\tUSPS'),
    [{ id: 'gid://shopify/Order/1', name: '#13811', client: null }],
    [],
  );
  assert.equal(plan.lignes[0]!.statut, 'abime_excel');
});

test('un suivi court en chiffres, lui, reste exact', async () => {
  // Sous quinze chiffres, Excel ne perd rien : pas de raison de refuser.
  const lu = await lireClasseur(await classeur([['Order', 'Tracking'], ['#13811', 123456789012]]));
  assert.equal(lireCollage(lu.texte)[0]!.suivi, '123456789012');
});

/* ---- une vraie feuille, avec ce qu'une feuille porte ---- */

test('une photo et un lien dans la feuille ne gênent pas la lecture', async () => {
  // Les photos, les dessins et les liens pointent vers des parties que la
  // lecture n'extrait pas : la bibliothèque échouerait à les chercher si on
  // ne lui disait pas de les ignorer.
  const livre = new ExcelJS.Workbook();
  const feuille = livre.addWorksheet('Commandes');
  feuille.addRow(['Order', 'Product Link', 'Tracking']);
  feuille.addRow(['#13811', { text: 'Nike Mind 001', hyperlink: 'https://x.test/p' }, '1Z999AA10123456784']);
  feuille.addImage(livre.addImage({ buffer: PNG as never, extension: 'png' }), {
    tl: { col: 1, row: 1 },
    ext: { width: 20, height: 20 },
  });
  livre.addWorksheet('Autre').addRow(['#99999', 'ZZZ999999']);

  const lu = await lireClasseur(Buffer.from(await livre.xlsx.writeBuffer()));
  assert.equal(lu.texte, '#13811\t1Z999AA10123456784\t', 'la première feuille, dans l’ordre du classeur');
});

/* ---- l'archive piégée ---- */

/*
 * Une archive écrite à la main, pour pouvoir y mentir : chaque entrée peut
 * annoncer une taille décompressée qui n'est pas la sienne.
 */
function archive(entrees: { nom: string; contenu: Buffer; annonce?: number }[]): Buffer {
  const locaux: Buffer[] = [];
  const centraux: Buffer[] = [];
  let position = 0;

  for (const { nom, contenu, annonce } of entrees) {
    const donnees = deflateRawSync(contenu);
    const octetsNom = Buffer.from(nom);
    const taille = annonce ?? contenu.length;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(donnees.length, 18);
    local.writeUInt32LE(taille, 22);
    local.writeUInt16LE(octetsNom.length, 26);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(donnees.length, 20);
    central.writeUInt32LE(taille, 24);
    central.writeUInt16LE(octetsNom.length, 28);
    central.writeUInt32LE(position, 42);

    locaux.push(local, octetsNom, donnees);
    centraux.push(central, octetsNom);
    position += 30 + octetsNom.length + donnees.length;
  }

  const repertoire = Buffer.concat(centraux);
  const fin = Buffer.alloc(22);
  fin.writeUInt32LE(0x06054b50, 0);
  fin.writeUInt16LE(entrees.length, 8);
  fin.writeUInt16LE(entrees.length, 10);
  fin.writeUInt32LE(repertoire.length, 12);
  fin.writeUInt32LE(position, 16);
  return Buffer.concat([...locaux, repertoire, fin]);
}

const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const feuilleXml = (lignes: string) =>
  Buffer.from(
    `${XML}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${lignes}</sheetData></worksheet>`,
  );

/**
 * Le strict nécessaire d'un classeur, écrit à la main, autour d'une feuille.
 *
 * Les entrées `autres` viennent EN DERNIER et remplacent une entrée du même
 * nom : le piège est la dernière chose lue, et rien après lui ne peut faire
 * échouer la lecture pour une autre raison que la sienne.
 */
function classeurMinimal(feuille: string, autres: { nom: string; contenu: Buffer; annonce?: number }[] = []) {
  const xml = XML;
  const rels = 'http://schemas.openxmlformats.org/package/2006/relationships';
  const doc = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const base = [
    {
      nom: '_rels/.rels',
      contenu: Buffer.from(
        `${xml}<Relationships xmlns="${rels}"><Relationship Id="rId1" Type="${doc}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
      ),
    },
    {
      nom: 'xl/workbook.xml',
      contenu: Buffer.from(
        `${xml}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="${doc}"><sheets><sheet name="F" sheetId="1" r:id="rId1"/></sheets></workbook>`,
      ),
    },
    {
      nom: 'xl/_rels/workbook.xml.rels',
      contenu: Buffer.from(
        `${xml}<Relationships xmlns="${rels}"><Relationship Id="rId1" Type="${doc}/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
      ),
    },
    { nom: 'xl/worksheets/sheet1.xml', contenu: feuilleXml(feuille) },
  ];
  const remplacees = new Set(autres.map((entree) => entree.nom));
  return archive([...base.filter((entree) => !remplacees.has(entree.nom)), ...autres]);
}

const ligneXml = (r: number, commande: string, suivi: string) =>
  `<row r="${r}"><c r="A${r}" t="inlineStr"><is><t>${commande}</t></is></c><c r="B${r}" t="inlineStr"><is><t>${suivi}</t></is></c></row>`;

test('un classeur écrit à la main, sans rien de superflu, se lit', async () => {
  // Le témoin des tests qui suivent : sans piège, cette archive se lit.
  const lu = await lireClasseur(classeurMinimal(ligneXml(1, 'Order', 'Tracking') + ligneXml(2, '#13811', 'ABC123456')));
  assert.equal(lu.texte, '#13811\tABC123456\t');
});

test('le décompresseur s’arrête net au plafond', () => {
  // Dix mégaoctets de zéros tiennent en dix kilooctets compressés. Au-delà
  // du plafond, rien n'est produit : pas de dix mégaoctets alloués pour rien.
  const bombe = deflateRawSync(Buffer.alloc(10 * 1024 * 1024));
  assert.throws(
    () => decompresser(bombe, 8, 1024 * 1024),
    (erreur) => erreur instanceof ClasseurRefuse && erreur.code === 'volumineux',
  );
  assert.equal(decompresser(bombe, 8, 10 * 1024 * 1024).length, 10 * 1024 * 1024, 'au plafond pile, tout passe');
});

test('une feuille trop dense dans un petit fichier est refusée', async () => {
  // Le cas mesuré : une feuille qui se compresse très bien. Le fichier pèse
  // quelques kilooctets, la feuille des mégaoctets — et son analyse en
  // coûterait des centaines en mémoire.
  const lignes = Array.from({ length: Math.ceil(XML_MAX / 60) + 1000 }, (_, i) => ligneXml(i + 1, '#1', 'X'));
  const fichier = classeurMinimal(lignes.join(''));
  assert.ok(fichier.length < 1024 * 1024, 'un petit fichier');

  await assert.rejects(lireClasseur(fichier), (erreur) => {
    assert.ok(erreur instanceof ClasseurRefuse);
    assert.equal(erreur.code, 'volumineux');
    return true;
  });
});

test('une feuille de lignes minuscules est refusée sur leur nombre', async () => {
  // Sous le plafond de taille, mais faite de lignes presque vides : c'est la
  // ligne qui coûte en mémoire. Comptées avant l'analyse, elles sont refusées
  // avant d'avoir rien coûté.
  const lignes = Array.from(
    { length: LIGNES_FEUILLES_MAX + 1 },
    (_, i) => `<row r="${i + 1}"><c r="A${i + 1}"><v>1</v></c></row>`,
  ).join('');
  assert.ok(feuilleXml(lignes).length < XML_MAX, 'sous le plafond de taille');

  await assert.rejects(lireClasseur(classeurMinimal(lignes)), (erreur) => {
    assert.ok(erreur instanceof ClasseurRefuse);
    assert.equal(erreur.code, 'volumineux');
    return true;
  });
});

test('un export de quatre mille lignes, lui, se lit', async () => {
  // La limite ne doit mordre que sur un fichier fabriqué : quatre mille
  // commandes, dont cinquante remplies, passent.
  const lignes = [ligneXml(1, 'Order', 'Tracking')];
  for (let i = 2; i <= 4000; i += 1) {
    lignes.push(i <= 51 ? ligneXml(i, `#${10000 + i}`, `LX${100000000 + i}CN`) : ligneXml(i, `#${10000 + i}`, ''));
  }
  const lu = await lireClasseur(classeurMinimal(lignes.join('')));
  assert.equal(lu.lues, 50);
  assert.equal(lu.ignorees, 3949);
});

test('une feuille qui MENT sur sa taille est refusée quand même', async () => {
  // Elle annonce mille octets et en décompresse le double du plafond. Un
  // garde-fou qui croirait l'annonce la laisserait passer.
  const lignes = Array.from({ length: Math.ceil((2 * XML_MAX) / 60) }, (_, i) => ligneXml(i + 1, '#1', 'X'));
  const fichier = classeurMinimal('', [
    { nom: 'xl/worksheets/sheet1.xml', contenu: feuilleXml(lignes.join('')), annonce: 1000 },
  ]);

  await assert.rejects(lireClasseur(fichier), (erreur) => {
    assert.ok(erreur instanceof ClasseurRefuse);
    assert.equal(erreur.code, 'volumineux');
    return true;
  });
});

test('le plafond est commun à toutes les feuilles', async () => {
  // Trois feuilles de 40 % du plafond chacune : aucune ne le dépasse seule,
  // toutes ensemble si. La bibliothèque analyse chaque feuille présente, même
  // celles que le classeur ne cite pas — cent feuilles juste sous le plafond
  // coûteraient cent fois la mémoire.
  const tiers = feuilleXml(
    Array.from({ length: Math.ceil((0.4 * XML_MAX) / 60) }, (_, i) => ligneXml(i + 1, '#1', 'X')).join(''),
  );
  assert.ok(tiers.length < XML_MAX && 3 * tiers.length > XML_MAX);

  const fichier = classeurMinimal(ligneXml(1, 'Order', 'Tracking'), [
    { nom: 'xl/worksheets/sheet2.xml', contenu: tiers },
    { nom: 'xl/worksheets/sheet3.xml', contenu: tiers },
    { nom: 'xl/worksheets/sheet4.xml', contenu: tiers },
  ]);

  await assert.rejects(lireClasseur(fichier), (erreur) => {
    assert.ok(erreur instanceof ClasseurRefuse);
    assert.equal(erreur.code, 'volumineux');
    return true;
  });
});

test('une photo piégée n’est jamais décompressée', async () => {
  // Une « photo » qui annonce dix octets et en décompresse vingt mégaoctets.
  // La lecture n'a pas besoin des photos : elle ne l'ouvre pas, et lit la
  // feuille normalement.
  const fichier = classeurMinimal(ligneXml(1, 'Order', 'Tracking') + ligneXml(2, '#13811', 'ABC123456'), [
    { nom: 'xl/media/image1.png', contenu: Buffer.alloc(4 * XML_MAX), annonce: 10 },
  ]);

  const lu = await lireClasseur(fichier);
  assert.equal(lu.texte, '#13811\tABC123456\t');
});

test('un fichier qui n’est pas un classeur est refusé proprement', async () => {
  await assert.rejects(
    lireClasseur(Buffer.from('#13811;ABC123\n#13812;DEF456')),
    (erreur) => erreur instanceof ClasseurRefuse && erreur.code === 'pas_un_classeur',
  );
});

test('un fichier trop lourd est refusé sur sa taille', async () => {
  await assert.rejects(
    lireClasseur(Buffer.alloc(16 * 1024 * 1024)),
    (erreur) => erreur instanceof ClasseurRefuse && erreur.code === 'trop_lourd',
  );
});

/* ---- un classeur à la fois ---- */

test('les lectures passent l’une après l’autre, même quand l’une échoue', async () => {
  let enCours = 0;
  let pic = 0;
  const ordre: number[] = [];

  const lecture = (n: number, echoue = false) =>
    unALaFois(async () => {
      enCours += 1;
      pic = Math.max(pic, enCours);
      await new Promise((fin) => setTimeout(fin, 5));
      enCours -= 1;
      ordre.push(n);
      if (echoue) throw new Error('classeur abîmé');
      return n;
    });

  const issues = await Promise.allSettled([lecture(1), lecture(2, true), lecture(3), lecture(4)]);

  assert.equal(pic, 1, 'jamais deux classeurs en mémoire à la fois');
  assert.deepEqual(ordre, [1, 2, 3, 4], 'chacun son tour, dans l’ordre d’arrivée');
  assert.deepEqual(
    issues.map((issue) => issue.status),
    ['fulfilled', 'rejected', 'fulfilled', 'fulfilled'],
    'un échec rend la main au suivant',
  );
});
