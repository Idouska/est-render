import { LOCALE_ATELIER, LANGUES_ATELIER, type LangueAtelier } from '../suppliers/langueAtelier.ts';

/**
 * Les mots d'une consigne de rupture, dans la langue de l'atelier.
 *
 * La consigne est posée en champs — attendre jusqu'à telle date, remplacer par
 * tel modèle — et non en phrase : c'est ce qui permet de la dire en chinois
 * sans passer par une traduction automatique. Seul le mot libre du marchand
 * est traduit ; la consigne elle-même s'écrit ici, une fois pour toutes.
 *
 * Sans base ni réseau : se teste seul. Le tableau de bord garde une copie des
 * titres pour l'aperçu « Ce que verra l'atelier », et les tests comparent.
 */

export const CHOIX_CONSIGNE = ['ATTENDRE', 'REMPLACER', 'ANNULER', 'MESSAGE'] as const;
export type ChoixConsigne = (typeof CHOIX_CONSIGNE)[number];

export interface ModeleConsigne {
  productTitle: string;
  variantTitle?: string | null;
  sku?: string | null;
  image?: string | null;
  inventory?: number | null;
  libre?: boolean;
}

/** Ce qu'il faut d'une consigne pour l'écrire. */
export interface ConsigneAEcrire {
  choix: ChoixConsigne;
  expedierAvant: Date | string | null;
  modeles: readonly ModeleConsigne[];
  articlesCommande: number | null;
  /** Le rang du modèle que l'atelier a choisi, s'il en a choisi un. */
  modeleChoisi?: number | null;
}

export interface TexteConsigne {
  /** La consigne en grand : « Attendez le réassort, puis expédiez ». */
  titre: string;
  /** Ce qui la précise : la date, ou ce qu'il advient du reste du colis. */
  detail: string;
  /** Sur une ligne, pour la commande et le récapitulatif : « Attendre le réassort · au plus tard le 26 oct. » */
  court: string;
}

/** Une date posée à midi UTC se lit le même jour partout. */
export function dateConsigne(date: Date | string, langue: LangueAtelier, longue = false): string {
  return new Date(date).toLocaleDateString(LOCALE_ATELIER[langue], {
    day: 'numeric',
    month: longue ? 'long' : 'short',
    timeZone: 'UTC',
  });
}

/** Un modèle en clair : sa référence quand il en a une, sinon son nom. */
export function nomModele(modele: ModeleConsigne): string {
  return [modele.productTitle, modele.variantTitle].filter(Boolean).join(' · ');
}

const reference = (modele: ModeleConsigne) => modele.sku?.trim() || nomModele(modele);

export const TITRES_CONSIGNE: Record<LangueAtelier, Record<ChoixConsigne, string>> = {
  fr: {
    ATTENDRE: 'Attendez le réassort, puis expédiez',
    REMPLACER: 'Expédiez un autre modèle à la place',
    ANNULER: 'N’expédiez pas cet article',
    MESSAGE: 'Message du marchand',
  },
  en: {
    ATTENDRE: 'Wait for the restock, then ship',
    REMPLACER: 'Ship another model instead',
    ANNULER: 'Do not ship this item',
    MESSAGE: 'Message from the merchant',
  },
  zh: {
    ATTENDRE: '等补货后再发货',
    REMPLACER: '改发其他型号',
    ANNULER: '此商品不要发货',
    MESSAGE: '商家留言',
  },
};

const MOTS = {
  fr: {
    auPlusTard: (date: string) => `Au plus tard le ${date}.`,
    attendreCourt: (date: string) => `Attendre le réassort · au plus tard le ${date}`,
    unSeul: 'Ce modèle, à la place de celui qui manque.',
    plusieurs: 'Expédiez celui que vous avez parmi ces modèles.',
    remplacerCourt: (ref: string) => `Expédier ${ref} à la place`,
    ou: ' ou ',
    rien: 'La commande ne partira pas : ne la préparez pas.',
    reste: 'Expédiez le reste de la commande.',
    annule: 'Annulé pour la cliente.',
    annulerCourt: 'Ne pas expédier cet article',
    messageCourt: 'Message du marchand',
  },
  en: {
    auPlusTard: (date: string) => `By ${date} at the latest.`,
    attendreCourt: (date: string) => `Wait for restock · by ${date}`,
    unSeul: 'This model, instead of the missing one.',
    plusieurs: 'Ship the one you have among these models.',
    remplacerCourt: (ref: string) => `Ship ${ref} instead`,
    ou: ' or ',
    rien: 'The order will not ship: do not prepare it.',
    reste: 'Ship the rest of the order.',
    annule: 'Cancelled for the customer.',
    annulerCourt: 'Do not ship this item',
    messageCourt: 'Message from the merchant',
  },
  zh: {
    auPlusTard: (date: string) => `最迟 ${date} 发货。`,
    attendreCourt: (date: string) => `等补货 · 最迟 ${date}`,
    unSeul: '用此型号代替缺货商品。',
    plusieurs: '请从以下型号中发出您有货的一款。',
    remplacerCourt: (ref: string) => `改发 ${ref}`,
    ou: ' 或 ',
    rien: '该订单不发货，请勿备货。',
    reste: '订单其余商品照常发货。',
    annule: '已为客户取消。',
    annulerCourt: '此商品不要发货',
    messageCourt: '商家留言',
  },
} satisfies Record<LangueAtelier, unknown>;

/** La consigne, écrite dans une langue. */
export function texteConsigne(consigne: ConsigneAEcrire, langue: LangueAtelier = 'fr'): TexteConsigne {
  const mots = MOTS[langue];
  const titre = TITRES_CONSIGNE[langue][consigne.choix];

  if (consigne.choix === 'ATTENDRE') {
    const date = consigne.expedierAvant;
    return {
      titre,
      detail: date ? mots.auPlusTard(dateConsigne(date, langue, true)) : '',
      court: date ? mots.attendreCourt(dateConsigne(date, langue)) : titre,
    };
  }

  if (consigne.choix === 'REMPLACER') {
    const choisi =
      typeof consigne.modeleChoisi === 'number' ? consigne.modeles[consigne.modeleChoisi] : undefined;
    // Le modèle retenu par l'atelier, une fois qu'il l'a dit ; avant, tous.
    const retenus = choisi ? [choisi] : consigne.modeles;
    return {
      titre,
      detail: consigne.modeles.length > 1 && !choisi ? mots.plusieurs : mots.unSeul,
      court: retenus.length ? mots.remplacerCourt(retenus.map(reference).join(mots.ou)) : titre,
    };
  }

  if (consigne.choix === 'ANNULER') {
    return {
      titre,
      // Le seul article de la commande : rien ne part. Sinon, le reste part.
      // Shopify n'a pas répondu : on ne promet ni l'un ni l'autre.
      detail:
        consigne.articlesCommande === 1
          ? mots.rien
          : typeof consigne.articlesCommande === 'number' && consigne.articlesCommande > 1
            ? mots.reste
            : mots.annule,
      court: mots.annulerCourt,
    };
  }

  return { titre, detail: '', court: mots.messageCourt };
}

/** La consigne dans les trois langues : l'atelier choisit la sienne dans son espace. */
export function textesConsigne(consigne: ConsigneAEcrire): Record<LangueAtelier, TexteConsigne> {
  return Object.fromEntries(LANGUES_ATELIER.map((langue) => [langue, texteConsigne(consigne, langue)])) as Record<
    LangueAtelier,
    TexteConsigne
  >;
}

/** Ce que la consigne attend encore, vu des deux côtés. */
export type EtatConsigne = 'ENVOYEE' | 'COMPRISE' | 'IMPOSSIBLE' | 'REPONDUE' | 'REMPLACEE';

export function etatConsigne(consigne: {
  reponse: string | null;
  remplaceeLe: Date | string | null;
}): EtatConsigne {
  if (consigne.remplaceeLe) return 'REMPLACEE';
  if (consigne.reponse === 'COMPRIS') return 'COMPRISE';
  if (consigne.reponse === 'IMPOSSIBLE') return 'IMPOSSIBLE';
  if (consigne.reponse === 'REPONDU') return 'REPONDUE';
  return 'ENVOYEE';
}

/**
 * Ce qu'une consigne inscrit sur la commande de l'atelier.
 *
 * Seules celles qui changent le colis, et tant qu'elles valent : un message
 * n'a rien à faire sur l'étiquette, et une consigne refusée ou remplacée ne
 * dit plus ce qu'il faut faire.
 */
export function consigneSurLaCommande(consigne: { choix: ChoixConsigne; reponse: string | null; remplaceeLe: Date | string | null }): boolean {
  return consigne.choix !== 'MESSAGE' && !consigne.remplaceeLe && consigne.reponse !== 'IMPOSSIBLE';
}

/** « 2026-10-26 » → midi UTC ce jour-là. Nul si la date ne se lit pas. */
export function lireDateConsigne(valeur: string | null | undefined): Date | null {
  const morceaux = /^(\d{4})-(\d{2})-(\d{2})$/.exec(valeur ?? '');
  if (!morceaux) return null;
  const date = new Date(Date.UTC(Number(morceaux[1]), Number(morceaux[2]) - 1, Number(morceaux[3]), 12));
  // 2026-02-31 deviendrait le 3 mars : on refuse plutôt que de décaler.
  return date.getUTCDate() === Number(morceaux[3]) ? date : null;
}
