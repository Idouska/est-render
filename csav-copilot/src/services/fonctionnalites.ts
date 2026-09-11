import { prisma } from '../lib/prisma.ts';

/**
 * Les fonctionnalités qu'on allume ou éteint boutique par boutique, depuis la
 * console d'administration.
 *
 * Toutes sont ALLUMÉES par défaut : une boutique dont personne n'a touché les
 * interrupteurs se comporte exactement comme avant leur existence. Éteindre
 * une fonctionnalité la retire vraiment — la route refuse, l'écran la masque —
 * et pas seulement de la vue : un interrupteur qui ne ferait que cacher un
 * bouton laisserait la porte ouverte à qui connaît l'adresse.
 *
 * Une fonctionnalité n'entre ici que si elle se retire proprement, sans rien
 * casser autour d'elle.
 */
export const FONCTIONNALITES = {
  importEnMasse: {
    titre: 'Traitement en masse (atelier)',
    description:
      'L’atelier colle ses numéros de suivi ou dépose sa feuille Excel, vérifie l’aperçu, puis expédie tout d’un coup.',
  },
  rupturesAtelier: {
    titre: 'Ruptures de stock (atelier)',
    description:
      'L’atelier a sa page Ruptures de stock : il y signale un produit manquant et suit les demandes du marchand.',
  },
} as const;

export type CleFonctionnalite = keyof typeof FONCTIONNALITES;

export const CLES_FONCTIONNALITES = Object.keys(FONCTIONNALITES) as CleFonctionnalite[];

/**
 * L'état de chaque fonctionnalité, tel que la boutique l'a en base.
 *
 * On ne garde que les clés connues et les vrais booléens : une clé retirée du
 * registre, ou une valeur abîmée, retombe sur « allumée » plutôt que de
 * couper une fonctionnalité par accident.
 */
export function fonctionnalitesDe(stockees: unknown): Record<CleFonctionnalite, boolean> {
  const brut = stockees && typeof stockees === 'object' ? (stockees as Record<string, unknown>) : {};
  return Object.fromEntries(
    CLES_FONCTIONNALITES.map((cle) => [cle, typeof brut[cle] === 'boolean' ? (brut[cle] as boolean) : true]),
  ) as Record<CleFonctionnalite, boolean>;
}

export async function fonctionnalitesDuMarchand(merchantId: string): Promise<Record<CleFonctionnalite, boolean>> {
  const merchant = await prisma.merchant.findUnique({
    where: { id: merchantId },
    select: { fonctionnalites: true },
  });
  return fonctionnalitesDe(merchant?.fonctionnalites);
}

export async function fonctionnaliteActive(merchantId: string, cle: CleFonctionnalite): Promise<boolean> {
  return (await fonctionnalitesDuMarchand(merchantId))[cle];
}
