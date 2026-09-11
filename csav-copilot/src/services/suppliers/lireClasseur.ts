import { crc32, inflateRawSync } from 'node:zlib';

import ExcelJS from 'exceljs';

import { ressembleAUnEnTete } from './importColis.ts';

/**
 * Lire un classeur Excel déposé par l'atelier, et le rendre en texte.
 *
 * Le parcours visé est le plus court qui soit : l'atelier télécharge la
 * feuille des commandes, remplit la colonne « Tracking », et la redépose TELLE
 * QUELLE. Ce module en tire le même texte qu'un collage — commande, suivi,
 * transporteur, séparés par des tabulations — et le reste de l'import ne
 * change pas : un seul lecteur de lignes, un seul plan, une seule
 * confirmation. Le texte est aussi rendu à l'écran, dans la zone de collage,
 * pour que l'atelier voie exactement ce qui a été lu.
 */

/** Taille maximale du fichier déposé, compressé. La feuille exportée porte des photos. */
export const CLASSEUR_MAX_OCTETS = 15 * 1024 * 1024;

/**
 * Ce que la lecture accepte de décompresser, toutes parties confondues.
 *
 * C'est la vraie limite, et elle est mesurée. Une feuille analysée coûte en
 * mémoire de dix à trente fois sa taille — trente pour une feuille faite de
 * lignes minuscules, le pire cas — et un fichier de 2 Mo seulement peut
 * porter 19 Mo de feuille : près de 300 Mo pour un serveur qui en a 512,
 * partagé par tous les marchands.
 *
 * Trois mégaoctets laissent passer un export d'environ 4 500 lignes (une
 * ligne réelle, adresse complète comprise, en pèse 700 octets). Avec le
 * plafond de lignes ci-dessous, le pire fichier accepté — fabriqué pour ça —
 * a été mesuré à 87 Mo.
 */
export const XML_MAX = 3 * 1024 * 1024;

/**
 * Le nombre de lignes, toutes feuilles confondues.
 *
 * Le pire cas du plafond précédent est une feuille faite de lignes
 * minuscules : c'est la LIGNE qui coûte en mémoire, bien plus que la cellule.
 * Vingt mille, c'est quatre fois ce qu'un vrai export atteint sous le
 * plafond de taille — la limite ne mord que sur un fichier fabriqué.
 */
export const LIGNES_FEUILLES_MAX = 20_000;
const ENTREES_MAX = 5000;

/**
 * Un refus, avec son CODE.
 *
 * L'atelier travaille en français, en anglais ou en chinois ; le serveur ne
 * connaît pas sa langue. Le message sert au journal et aux tests, le code
 * sert à l'écran, qui le traduit.
 */
export type CodeRefus = 'trop_lourd' | 'pas_un_classeur' | 'volumineux' | 'illisible' | 'sans_feuille';

export class ClasseurRefuse extends Error {
  readonly code: CodeRefus;

  // Pas de `constructor(readonly code …)` : les tests et le serveur de
  // développement lisent le TypeScript en retirant les types, et cette
  // écriture-là n'est pas un type qu'on retire — elle génère du code.
  constructor(code: CodeRefus, message: string) {
    super(message);
    this.code = code;
  }
}

const volumineux = () =>
  new ClasseurRefuse('volumineux', 'Classeur refusé : son contenu décompressé est anormalement volumineux.');
const illisible = () =>
  new ClasseurRefuse('illisible', 'Classeur illisible. Enregistrez-le à nouveau au format .xlsx ou .csv.');
const pasUnClasseur = () =>
  new ClasseurRefuse(
    'pas_un_classeur',
    'Ce fichier n’est pas un classeur .xlsx lisible. Enregistrez-le au format .xlsx ou .csv.',
  );

/**
 * Les seules parties d'un classeur dont la lecture a besoin.
 *
 * Les images, les dessins, les thèmes, les propriétés ne sont JAMAIS
 * décompressés : la feuille exportée porte les photos des produits, et une
 * photo n'apprend rien sur un numéro de suivi. Ce sont aussi les noms que la
 * bibliothèque de lecture reconnaît — une feuille nommée autrement, elle ne
 * la lirait pas davantage.
 */
const PARTIES_UTILES =
  /^(?:_rels\/\.rels|xl\/workbook\.xml|xl\/_rels\/workbook\.xml\.rels|xl\/sharedStrings\.xml|xl\/styles\.xml|xl\/worksheets\/sheet\d+\.xml)$/;

/**
 * Décompresse une partie, en s'arrêtant net au plafond.
 *
 * Le plafond est imposé au décompresseur lui-même, qui cesse de produire dès
 * qu'il l'atteint. Les tailles que l'archive annonce ne sont pas lues du
 * tout : c'est l'auteur du fichier qui les écrit, et une archive piégée
 * annonce 1 Ko pour une partie qui en décompresse un milliard.
 */
export function decompresser(donnees: Buffer, methode: number, plafond: number): Buffer {
  if (plafond < 1) throw volumineux();

  // 0 : stockée telle quelle. 8 : deflate. Un classeur n'emploie rien d'autre.
  if (methode === 0) {
    if (donnees.length > plafond) throw volumineux();
    return donnees;
  }
  if (methode !== 8) throw illisible();

  try {
    return inflateRawSync(donnees, { maxOutputLength: plafond });
  } catch (erreur) {
    // Le décompresseur signale le plafond atteint par une RangeError ; toute
    // autre erreur est une partie abîmée.
    throw erreur instanceof RangeError ? volumineux() : illisible();
  }
}

/**
 * Les lignes d'une feuille, comptées sans l'analyser : `<row …>`, avec ou sans
 * préfixe d'espace de noms. Un `<` ne peut pas apparaître tel quel dans le
 * texte d'une cellule — il y est écrit `&lt;` — donc rien d'autre ne compte.
 */
function compterLignes(feuille: Buffer): number {
  return feuille.toString('latin1').match(/<(?:[A-Za-z_][\w.-]*:)?row[\s>/]/g)?.length ?? 0;
}

/**
 * Les parties utiles du fichier déposé, décompressées sous un plafond commun.
 *
 * On lit le répertoire central — la table des matières que tout zip porte à
 * sa fin — et l'on ne décompresse que les parties nommées plus haut.
 *
 * La bibliothèque qui lit les classeurs ne voit JAMAIS le fichier déposé :
 * elle reçoit une archive reconstruite ici, faite de ces seules parties déjà
 * bornées. Un premier garde-fou, qui se contentait de vérifier les tailles
 * annoncées, laissait une brèche : la bibliothèque ne lit pas l'archive
 * comme lui — elle suit des entrées cachées au-delà du compte annoncé, recale
 * les décalages, reprend les noms ailleurs. Plutôt que d'imiter ses règles et
 * d'en oublier une, on ne lui laisse rien d'autre à lire que ce qu'on a lu.
 */
export function extraireParties(octets: Buffer): Map<string, Buffer> {
  // La fin du répertoire central : 22 octets, suivis d'un commentaire de
  // 65 535 octets au plus. On la cherche en partant de la fin.
  const plancher = Math.max(0, octets.length - 22 - 0xffff);
  let fin = -1;
  for (let i = octets.length - 22; i >= plancher; i -= 1) {
    if (octets.readUInt32LE(i) === 0x06054b50) {
      fin = i;
      break;
    }
  }
  if (fin < 0) throw pasUnClasseur();

  const nombre = octets.readUInt16LE(fin + 10);
  if (nombre === 0xffff) throw pasUnClasseur(); // zip64 : aucun classeur de cette taille n'en a besoin
  if (nombre > ENTREES_MAX) throw volumineux();

  const parties = new Map<string, Buffer>();
  let restant = XML_MAX;
  let lignes = 0;
  let curseur = octets.readUInt32LE(fin + 16);

  for (let n = 0; n < nombre; n += 1) {
    if (curseur + 46 > octets.length || octets.readUInt32LE(curseur) !== 0x02014b50) throw illisible();

    const methode = octets.readUInt16LE(curseur + 10);
    const compresse = octets.readUInt32LE(curseur + 20);
    const longueurNom = octets.readUInt16LE(curseur + 28);
    const local = octets.readUInt32LE(curseur + 42);
    const nom = octets.toString('utf8', curseur + 46, curseur + 46 + longueurNom).replace(/^\//, '');
    curseur += 46 + longueurNom + octets.readUInt16LE(curseur + 30) + octets.readUInt16LE(curseur + 32);

    if (!PARTIES_UTILES.test(nom)) continue;

    // Les données suivent l'en-tête local, dont le nom et les extras ont
    // leur propre longueur.
    if (local + 30 > octets.length || octets.readUInt32LE(local) !== 0x04034b50) throw illisible();
    const debut = local + 30 + octets.readUInt16LE(local + 26) + octets.readUInt16LE(local + 28);
    if (debut + compresse > octets.length) throw illisible();

    const contenu = decompresser(octets.subarray(debut, debut + compresse), methode, restant);
    restant -= contenu.length;

    if (nom.startsWith('xl/worksheets/')) {
      lignes += compterLignes(contenu);
      if (lignes > LIGNES_FEUILLES_MAX) throw volumineux();
    }
    parties.set(nom, contenu);
  }

  if (!parties.has('xl/workbook.xml')) throw pasUnClasseur();
  return parties;
}

/**
 * Une archive sans compression, écrite ici même.
 *
 * Son contenu est déjà décompressé et borné : la stocker telle quelle ne
 * coûte rien, et sa structure est honnête par construction — c'est nous qui
 * l'écrivons.
 */
function archiver(parties: Map<string, Buffer>): Buffer {
  const locaux: Buffer[] = [];
  const centraux: Buffer[] = [];
  let position = 0;

  for (const [nom, contenu] of parties) {
    const octetsNom = Buffer.from(nom, 'utf8');
    const somme = crc32(contenu);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version requise
    local.writeUInt16LE(0x0800, 6); // noms en UTF-8
    local.writeUInt32LE(somme, 14);
    local.writeUInt32LE(contenu.length, 18);
    local.writeUInt32LE(contenu.length, 22);
    local.writeUInt16LE(octetsNom.length, 26);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt32LE(somme, 16);
    central.writeUInt32LE(contenu.length, 20);
    central.writeUInt32LE(contenu.length, 24);
    central.writeUInt16LE(octetsNom.length, 28);
    central.writeUInt32LE(position, 42);

    locaux.push(local, octetsNom, contenu);
    centraux.push(central, octetsNom);
    position += 30 + octetsNom.length + contenu.length;
  }

  const repertoire = Buffer.concat(centraux);
  const fin = Buffer.alloc(22);
  fin.writeUInt32LE(0x06054b50, 0);
  fin.writeUInt16LE(parties.size, 8);
  fin.writeUInt16LE(parties.size, 10);
  fin.writeUInt32LE(repertoire.length, 12);
  fin.writeUInt32LE(position, 16);

  return Buffer.concat([...locaux, repertoire, fin]);
}

/**
 * Ce que la lecture ignore dans une feuille.
 *
 * Les quatre premiers pointent vers des parties qu'on n'a pas extraites —
 * liens, dessins, image de fond, tableaux — et la bibliothèque échouerait à
 * les chercher. Les autres ne disent rien d'un numéro de suivi, et coûtent
 * de la mémoire.
 */
const NOEUDS_IGNORES = [
  'hyperlinks',
  'drawing',
  'picture',
  'tableParts',
  'conditionalFormatting',
  'dataValidations',
  'extLst',
];

/**
 * Un classeur à la fois.
 *
 * Même borné, un classeur analysé occupe quelques dizaines de mégaoctets le
 * temps de sa lecture. Deux ateliers qui déposent en même temps attendent
 * leur tour — quelques centaines de millisecondes au pire — plutôt que
 * d'additionner leurs pics sur un serveur partagé.
 */
let occupe = false;
const enAttente: (() => void)[] = [];

export async function unALaFois<T>(travail: () => Promise<T>): Promise<T> {
  if (occupe) await new Promise<void>((tour) => enAttente.push(tour));
  occupe = true;
  try {
    return await travail();
  } finally {
    // Le tour passe directement au suivant : `occupe` reste vrai, et aucun
    // nouveau venu ne peut se glisser entre les deux.
    const suivant = enAttente.shift();
    if (suivant) suivant();
    else occupe = false;
  }
}

/** Un titre de colonne, sans casse, sans accent, sans ponctuation. */
function normaliser(titre: string): string {
  return titre
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, ' ')
    .trim();
}

/**
 * Les titres reconnus pour chaque colonne, dans les trois langues de
 * l'atelier. La feuille exportée dit « Order » et « Tracking » ; un atelier
 * qui prépare son propre fichier écrira « Commande », « Suivi », « 运单号 ».
 */
const TITRES = {
  commande: ['order', 'commande', 'order number', 'numero de commande', '订单', '订单号'],
  suivi: ['tracking', 'suivi', 'tracking number', 'numero de suivi', '运单号', '快递单号', '追踪号'],
  transporteur: ['carrier', 'transporteur', '承运商', '快递公司', '物流公司'],
};

type Colonne = keyof typeof TITRES;

/**
 * Les mots qui désignent une colonne quand son titre n'est pas exactement
 * l'un des précédents : « Num de commande », « N° commande », « Numéro de
 * tracking ». Un atelier nomme ses colonnes comme il veut. Exiger le titre
 * exact faisait retomber la lecture sur l'ordre des colonnes — et une URL de
 * suivi posée en troisième colonne devenait le transporteur.
 *
 * Le suivi est cherché en premier : « Suivi de commande » est un numéro de
 * suivi, pas un numéro de commande.
 */
const MOTS: [Colonne, RegExp][] = [
  ['suivi', /\b(?:tracking|suivi|awb)|运单|快递单号|追踪号|物流单号/],
  ['commande', /\b(?:commande|order|cmd)|订单/],
  ['transporteur', /\b(?:carrier|transporteur|courier)|承运商|快递公司|物流公司/],
];

/**
 * Ce qui n'est jamais le numéro lui-même : un lien, une date, un statut.
 * « URL de suivi », « Tracking URL », « Date de commande », « Statut du
 * suivi » portent les bons mots et désignent pourtant autre chose.
 */
const JAMAIS = /\b(?:url|urls|lien|liens|link|links|https?|www|date|heure|time|statut|status)\b/;

/**
 * Le rôle d'un titre de colonne, et la précision de la reconnaissance : un
 * titre exact (0) l'emporte sur un mot reconnu dans un titre plus long (1).
 * « Commande » bat « N° de commande client » ; faute de titre exact, « Num
 * de commande » suffit.
 */
function colonneDe(titre: string): { role: Colonne; precision: 0 | 1 } | null {
  const t = normaliser(titre);
  if (!t || JAMAIS.test(t)) return null;

  for (const role of Object.keys(TITRES) as Colonne[]) {
    if (TITRES[role].includes(t)) return { role, precision: 0 };
  }
  for (const [role, mots] of MOTS) {
    if (mots.test(t)) return { role, precision: 1 };
  }
  return null;
}

/**
 * Le texte d'une cellule, tel que l'atelier l'a voulu.
 *
 * Un NOMBRE d'au moins seize chiffres a déjà perdu ses derniers chiffres
 * dans Excel, qui n'en garde que quinze. On l'écrit alors en notation
 * exponentielle : le plan le reconnaît et le refuse, avec l'explication. Le
 * récrire en entier inventerait des chiffres qui ne sont plus nulle part.
 */
function texteDe(cellule: ExcelJS.Cell): string {
  let valeur = cellule.value as unknown;

  // Une formule vaut par son résultat.
  if (valeur && typeof valeur === 'object' && 'result' in (valeur as object)) {
    valeur = (valeur as { result: unknown }).result;
  }

  if (valeur === null || valeur === undefined) return '';
  if (typeof valeur === 'number') {
    if (Math.abs(valeur) >= 1e15) return valeur.toExponential();
    return String(valeur);
  }
  if (valeur instanceof Date) return valeur.toISOString().slice(0, 10);

  // Texte riche, lien, texte simple : `text` rend ce qu'Excel affiche.
  return (cellule.text ?? '').replace(/\s+/g, ' ').trim();
}

export interface ClasseurLu {
  /** Le même texte qu'un collage : une ligne par numéro de suivi trouvé. */
  texte: string;
  /** Lignes portant un numéro de suivi. */
  lues: number;
  /** Lignes sans numéro — des commandes pas encore expédiées, ignorées sans bruit. */
  ignorees: number;
  /** Comment les colonnes ont été trouvées. */
  colonnes: 'titres' | 'position';
}

/**
 * Lit un classeur déposé : ses parties utiles, extraites et bornées ici, puis
 * sa première feuille. Un classeur à la fois.
 */
export async function lireClasseur(octets: Buffer): Promise<ClasseurLu> {
  if (octets.length > CLASSEUR_MAX_OCTETS) {
    throw new ClasseurRefuse('trop_lourd', 'Fichier trop lourd : 15 Mo au plus.');
  }

  return unALaFois(async () => {
    const propre = archiver(extraireParties(octets));

    const classeur = new ExcelJS.Workbook();
    try {
      await classeur.xlsx.load(propre as unknown as ArrayBuffer, { ignoreNodes: NOEUDS_IGNORES });
    } catch {
      throw illisible();
    }

    return lirePremiereFeuille(classeur);
  });
}

/**
 * La première feuille, rendue en texte de collage.
 *
 * Les colonnes sont cherchées par leur TITRE dans les cinq premières lignes :
 * la feuille exportée en compte neuf, et le suivi est la neuvième. À défaut
 * de titres reconnus, les trois premières colonnes, dans l'ordre du collage.
 *
 * Une ligne sans numéro de suivi n'est pas une erreur : c'est une commande
 * que l'atelier n'a pas encore expédiée. Elle est comptée et ignorée — la
 * signaler ferait crier « ligne incomplète » quarante fois sur une feuille
 * où l'on n'a rempli que les colis du jour.
 */
function lirePremiereFeuille(classeur: ExcelJS.Workbook): ClasseurLu {
  const feuille = classeur.worksheets[0];
  if (!feuille) throw new ClasseurRefuse('sans_feuille', 'Ce classeur ne contient aucune feuille.');

  // Les titres : la première ligne, parmi les cinq premières, qui nomme au
  // moins la commande et le suivi. Pour chaque rôle, le titre le plus précis
  // l'emporte ; à précision égale, le plus à gauche.
  let ligneTitres = 0;
  let positions: Partial<Record<Colonne, number>> = {};
  for (let r = 1; r <= Math.min(5, feuille.rowCount); r += 1) {
    const trouve: Partial<Record<Colonne, { colonne: number; precision: number }>> = {};
    feuille.getRow(r).eachCell((cellule, colonne) => {
      const titre = colonneDe(texteDe(cellule));
      if (!titre) return;
      const deja = trouve[titre.role];
      if (!deja || titre.precision < deja.precision) trouve[titre.role] = { colonne, precision: titre.precision };
    });
    if (trouve.commande && trouve.suivi) {
      ligneTitres = r;
      positions = {
        commande: trouve.commande.colonne,
        suivi: trouve.suivi.colonne,
        transporteur: trouve.transporteur?.colonne,
      };
      break;
    }
  }

  const parTitres = ligneTitres > 0;
  const col = parTitres ? positions : { commande: 1, suivi: 2, transporteur: 3 };

  const lignes: string[] = [];
  let ignorees = 0;
  let premiere = !parTitres;

  for (let r = ligneTitres + 1; r <= feuille.rowCount; r += 1) {
    const rang = feuille.getRow(r);
    const commande = texteDe(rang.getCell(col.commande!));
    const suivi = texteDe(rang.getCell(col.suivi!));
    const transporteur = col.transporteur ? texteDe(rang.getCell(col.transporteur)) : '';

    if (!commande && !suivi) continue;

    // Sans titres reconnus, une première ligne de titres inconnus n'est pas
    // une commande : elle ne se compte pas parmi les numéros lus. Même règle
    // que pour un collage.
    if (premiere) {
      premiere = false;
      if (ressembleAUnEnTete(commande)) continue;
    }

    if (!suivi) {
      ignorees += 1;
      continue;
    }
    lignes.push([commande, suivi, transporteur].join('\t'));
  }

  return {
    texte: lignes.join('\n'),
    lues: lignes.length,
    ignorees,
    colonnes: parTitres ? 'titres' : 'position',
  };
}
