/**
 * L'import de numéros de suivi en masse, depuis l'atelier.
 *
 * Le geste réel d'un atelier qui expédie cinquante colis n'est pas de les
 * saisir un par un : il imprime ses étiquettes chez le transporteur, qui lui
 * rend un fichier, et il le colle. Ce module lit ce collage et décide, ligne
 * par ligne, ce qui peut être enregistré — sans base ni réseau, pour être
 * éprouvé seul.
 *
 * LA DÉCISION EST PRISE DEUX FOIS, À L'IDENTIQUE. L'aperçu la montre, la
 * validation la refait : le serveur ne croit jamais l'aperçu que le
 * navigateur lui renvoie. C'est pour ça que le TEXTE voyage, pas des lignes
 * déjà découpées — un seul lecteur, côté serveur, donc un seul résultat.
 *
 * ET ELLE A DES CONSÉQUENCES. Enregistrer le dernier colis d'une commande la
 * fait passer en « expédiée » sur Shopify, qui envoie au client un mail avec
 * son suivi. Cinquante lignes, ce sont cinquante mails. Le plan dit donc
 * combien de commandes partiront, pour que l'écran l'annonce avant.
 */

/** Une ligne du collage, telle que l'atelier l'a écrite. */
export interface LigneCollee {
  /** Numéro de la ligne dans le collage, à partir de 1 : c'est ce que l'atelier voit dans Excel. */
  rang: number;
  commande: string;
  suivi: string;
  transporteur: string | null;
}

/** Au-delà, on demande de couper : un collage de mille lignes est une erreur de sélection. */
export const LIGNES_MAX = 300;

/**
 * Le séparateur d'un collage, choisi une fois pour tout le texte.
 *
 * Excel colle des tabulations ; un CSV français sépare par `;`, un CSV
 * anglais par `,`. Découper sur les trois à la fois coupait en deux tout
 * nombre écrit à la française — « 4,20123E+21 » devenait un suivi « 4 » et
 * un transporteur « 20123E+21 », avant même que la règle qui repère les
 * numéros abîmés ait pu le voir. La tabulation l'emporte dès qu'elle
 * apparaît : c'est la marque d'un collage depuis un tableur.
 */
function separateurDe(texte: string): string {
  if (texte.includes('\t')) return '\t';
  if (texte.includes(';')) return ';';
  return ',';
}

/**
 * Ce qui ressemble à un en-tête : des lettres, et pas de numéro.
 *
 * « Commande », « Order », « 订单 » en sont ; « 13 811 » n'en est pas. Le
 * test « n'est pas un numéro de commande » aurait suffi pour les en-têtes —
 * et aurait jeté en silence une première ligne mal tapée, qu'il faut au
 * contraire montrer comme invalide.
 */
const EN_TETE = /[A-Za-z\u00C0-\u024F\u4E00-\u9FFF]/;
const NUMERO = /\d{3,}/;

/**
 * Lit un collage depuis Excel ou un fichier CSV.
 *
 * Trois colonnes, dans cet ordre : commande, numéro de suivi, transporteur —
 * la dernière facultative. Une première ligne d'en-têtes est reconnue et
 * sautée : l'atelier copie souvent la ligne « Commande | Suivi » avec le
 * reste, et la lui refuser serait le punir de bien faire.
 *
 * Les lignes vides sont ignorées sans bruit — Excel en ajoute une en fin de
 * sélection. Les espaces DANS un numéro de suivi sont retirés : les
 * transporteurs les impriment groupés par quatre (« 1Z99 9AA1 0123 »), le
 * même numéro sans espace est celui que le suivi reconnaît.
 */
export function lireCollage(texte: string): LigneCollee[] {
  const lignes: LigneCollee[] = [];

  let premiere = true;
  const separateur = separateurDe(texte);

  texte.split(/\r?\n/).forEach((brute, position) => {
    if (!brute.trim()) return;

    const [commande = '', suivi = '', transporteur = ''] = brute
      .split(separateur)
      .map((cellule) => cellule.trim().replace(/^"(.*)"$/, '$1').trim());

    // L'en-tête n'est reconnu qu'en PREMIÈRE ligne non vide. Plus loin, la
    // même ligne est une vraie ligne invalide, et doit être signalée.
    const enTete = premiere && EN_TETE.test(commande) && !NUMERO.test(commande);
    premiere = false;
    if (enTete) return;

    lignes.push({
      rang: position + 1,
      commande,
      suivi: suivi.replace(/\s+/g, ''),
      transporteur: transporteur || null,
    });
  });

  return lignes;
}

/**
 * Un numéro de suivi qu'Excel a transformé en nombre, et donc abîmé.
 *
 * Tapé dans une cellule au format « Standard », un numéro fait uniquement de
 * chiffres devient un NOMBRE, et Excel n'en garde que quinze chiffres : un
 * suivi USPS de vingt-deux chiffres s'affiche « 4,20123E+21 », et les sept
 * derniers sont perdus pour de bon — dans la cellule comme dans le fichier.
 * L'envoyer au client serait lui donner un numéro qui n'existe pas, par un
 * mail que l'on ne peut pas rappeler. Il est donc refusé, et l'aperçu dit
 * pourquoi : la seule réparation est de le retaper en texte.
 *
 * Le motif couvre le collage (« 4,20123E+21 », virgule française comprise)
 * comme la lecture d'un classeur, qui écrit ces cellules en notation
 * exponentielle précisément pour qu'elles tombent ici.
 */
export function abimeParExcel(suivi: string): boolean {
  return /^\d+(?:[.,]\d+)?e[+-]?\d+$/i.test(suivi);
}

/** « 13811 », « #13811 » et « # 13811 » désignent la même commande, écrite comme Shopify la nomme. */
export function normaliserCommande(saisie: string): string | null {
  const chiffres = saisie.replace(/\s+/g, '').replace(/^#/, '');
  return /^\d{3,}$/.test(chiffres) ? `#${chiffres}` : null;
}

export type StatutLigne =
  | 'pret'
  | 'abime_excel'
  | 'invalide'
  | 'introuvable'
  | 'doublon'
  | 'deja_saisi'
  | 'deja_utilise'
  | 'deja_expediee';

/** Une commande que l'atelier a le droit de voir, réduite à ce que le plan consulte. */
export interface CommandeVisible {
  id: string;
  name: string;
  client: string | null;
}

/** Un colis déjà enregistré, sur une commande visible ou ailleurs. */
export interface ColisExistant {
  shopifyOrderId: string;
  trackingNumber: string;
  index: number;
  total: number;
}

export interface LignePlanifiee extends LigneCollee {
  statut: StatutLigne;
  /** Le nom normalisé, quand il est lisible. */
  nom: string | null;
  shopifyOrderId: string | null;
  client: string | null;
  /** Rang et nombre de colis attribués, pour les lignes prêtes. */
  index: number | null;
  total: number | null;
}

export interface PlanLot {
  lignes: LignePlanifiee[];
  /** Colis qui seront enregistrés. */
  prets: number;
  /** Commandes distinctes touchées. */
  commandes: number;
  /**
   * Commandes qui seront COMPLÈTES après l'import : Shopify les passera en
   * expédiées et enverra un mail à chaque client. C'est le chiffre à
   * annoncer avant le clic.
   */
  expediees: number;
}

/**
 * Décide du sort de chaque ligne.
 *
 * L'ordre des tests est celui des causes, de la plus certaine à la plus
 * contextuelle : une ligne illisible l'est quoi qu'il arrive ; une commande
 * absente des commandes de l'atelier ne peut rien recevoir ; un numéro déjà
 * vu plus haut dans le collage est un doublon ; un numéro déjà en base est
 * soit une ligne déjà importée (même commande), soit une erreur de collage
 * (autre commande) ; une commande dont tous les colis sont saisis est déjà
 * partie.
 *
 * Réimporter deux fois le même fichier ne crée donc rien la seconde fois :
 * chaque ligne ressort « déjà saisie ».
 */
export function planifierLot(
  lignes: readonly LigneCollee[],
  visibles: readonly CommandeVisible[],
  existants: readonly ColisExistant[],
): PlanLot {
  const parNom = new Map(visibles.map((commande) => [commande.name, commande]));
  const suiviEnBase = new Map(existants.map((colis) => [colis.trackingNumber, colis]));
  const vusDansLeCollage = new Set<string>();

  // Première passe : le statut de chaque ligne, indépendamment des autres
  // lignes de la même commande.
  const planifiees: LignePlanifiee[] = lignes.map((ligne) => {
    const nom = normaliserCommande(ligne.commande);
    const base = {
      ...ligne,
      nom,
      shopifyOrderId: null as string | null,
      client: null as string | null,
      index: null,
      total: null,
    };

    // Avant la longueur : « 4,20123E+21 » a une longueur tout à fait plausible.
    if (abimeParExcel(ligne.suivi)) return { ...base, statut: 'abime_excel' as const };

    if (!nom || ligne.suivi.length < 3 || ligne.suivi.length > 80) {
      return { ...base, statut: 'invalide' as const };
    }

    const commande = parNom.get(nom);
    if (!commande) return { ...base, statut: 'introuvable' as const };

    const reperee = { ...base, shopifyOrderId: commande.id, client: commande.client };

    if (vusDansLeCollage.has(ligne.suivi)) return { ...reperee, statut: 'doublon' as const };
    vusDansLeCollage.add(ligne.suivi);

    const enBase = suiviEnBase.get(ligne.suivi);
    if (enBase) {
      return {
        ...reperee,
        statut: enBase.shopifyOrderId === commande.id ? ('deja_saisi' as const) : ('deja_utilise' as const),
      };
    }

    return { ...reperee, statut: 'pret' as const };
  });

  /*
   * Seconde passe, par commande : les rangs de colis.
   *
   * Les lignes d'une même commande deviennent ses colis. Elles comblent
   * d'abord les rangs annoncés et encore vides — une commande de trois
   * colis dont le premier est saisi reçoit les rangs 2 et 3 — puis
   * s'ajoutent au-delà. Une commande déjà complète ne reçoit rien : elle est
   * partie, un colis de plus serait une erreur de collage.
   */
  let expediees = 0;
  const commandesTouchees = new Set<string>();

  const parCommande = new Map<string, LignePlanifiee[]>();
  for (const ligne of planifiees) {
    if (ligne.statut !== 'pret' || !ligne.shopifyOrderId) continue;
    const liste = parCommande.get(ligne.shopifyOrderId) ?? [];
    liste.push(ligne);
    parCommande.set(ligne.shopifyOrderId, liste);
  }

  for (const [commande, nouvelles] of parCommande) {
    const deja = existants.filter((colis) => colis.shopifyOrderId === commande);
    const rangsPris = new Set(deja.map((colis) => colis.index));
    const annonce = deja.reduce((plus, colis) => Math.max(plus, colis.total), 0);

    if (annonce > 0 && rangsPris.size >= annonce) {
      for (const ligne of nouvelles) ligne.statut = 'deja_expediee';
      continue;
    }

    const libres = Array.from({ length: annonce }, (_, i) => i + 1).filter((rang) => !rangsPris.has(rang));
    const total = Math.max(annonce, rangsPris.size + nouvelles.length);
    let suivant = annonce;

    for (const ligne of nouvelles) {
      ligne.index = libres.shift() ?? ++suivant;
      ligne.total = total;
    }

    commandesTouchees.add(commande);
    // Complète après l'import : tous les rangs de 1 à `total` seront pris.
    if (rangsPris.size + nouvelles.length >= total) expediees += 1;
  }

  return {
    lignes: planifiees,
    prets: planifiees.filter((ligne) => ligne.statut === 'pret').length,
    commandes: commandesTouchees.size,
    expediees,
  };
}
