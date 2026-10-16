import { prisma } from '../../lib/prisma.ts';
import { getShopifyClient } from '../shopify/client.ts';
import { fetchCommerceStats } from '../shopify/commerceStats.ts';
import { fetchRefundDetails, type LigneRemboursee, type RemboursementDetaille } from '../shopify/refundHistory.ts';

/**
 * Les statistiques des remboursements : combien, pourquoi, sur quels produits.
 *
 * Deux sources, comme la liste : les remboursements faits depuis l'outil
 * (ils portent le motif choisi dans la fenêtre de remboursement) et ceux
 * passés dans Shopify (ils portent une note, souvent vide, mais aussi les
 * articles remboursés). Un même remboursement n'est compté qu'une fois : celui
 * de l'outil retrouve sa copie Shopify par son identifiant.
 *
 * La raison vient du motif ; quand le motif dit seulement « retour accepté »
 * ou qu'il manque, le dossier de retour de la commande la précise — taille,
 * défaut, modèle. Sans l'un ni l'autre, c'est « Sans motif » : mieux vaut
 * l'avouer que deviner.
 *
 * Un remboursement de test ou en échec ne compte pas : aucun argent n'est
 * parti.
 */

export type CleRaison = 'taille' | 'abime' | 'perdu' | 'modele' | 'preparation' | 'geste' | 'retour' | 'autre' | 'sans';

export const LIBELLES_RAISONS: Record<CleRaison, string> = {
  taille: 'Taille',
  abime: 'Article abîmé ou défectueux',
  perdu: 'Colis perdu',
  modele: 'Le modèle ne plaît pas',
  preparation: 'Erreur de préparation',
  geste: 'Geste commercial',
  retour: 'Retour accepté',
  autre: 'Autre motif',
  sans: 'Sans motif',
};

/* Les motifs de la fenêtre de remboursement, tels qu'ils partent dans la note Shopify. */
const MOTIFS: Array<[string, CleRaison]> = [
  ['Article endommagé', 'abime'],
  ['Colis perdu', 'perdu'],
  ['Erreur de préparation', 'preparation'],
  ['Geste commercial', 'geste'],
  ['Retour reçu', 'retour'],
];

const RAISONS_RETOUR: Record<string, CleRaison> = { SIZE: 'taille', DEFECT: 'abime', MODEL: 'modele', OTHER: 'retour' };

export function raisonDe(motif: string | null | undefined, raisonRetour?: string | null): CleRaison {
  const texte = motif?.trim() ?? '';
  const connu = texte ? MOTIFS.find(([debut]) => texte.toLowerCase().startsWith(debut.toLowerCase()))?.[1] : undefined;
  if (connu && connu !== 'retour') return connu;
  if (raisonRetour && RAISONS_RETOUR[raisonRetour]) return RAISONS_RETOUR[raisonRetour]!;
  if (connu) return connu;
  return texte && texte !== '—' ? 'autre' : 'sans';
}

export interface EntreesStats {
  maintenant: Date;
  jours: number;
  outil: Array<{
    id: string;
    shopifyOrderId: string;
    shopifyRefundId: string | null;
    amount: number;
    currency: string;
    reason: string;
    status: string;
    createdAt: Date;
  }>;
  /** Nul quand Shopify n'a pas répondu : on compte alors ce que l'outil sait. */
  shopify: RemboursementDetaille[] | null;
  partiel: boolean;
  retours: Array<{ shopifyOrderId: string | null; productTitle: string; variantTitle: string | null; reason: string; createdAt: Date }>;
  /** Les mails classés « remboursement » reçus dans la période. */
  demandes: Array<{ shopifyOrderId: string | null; rembourse: boolean }>;
  chiffreAffaires: number | null;
}

interface Unifie {
  orderId: string;
  date: Date;
  montant: number;
  devise: string;
  motif: string | null;
  lignes: LigneRemboursee[];
  lignesCommande: LigneRemboursee[];
  totalCommande: number | null;
}

/**
 * Les articles d'un remboursement. Les lignes remboursées d'abord ; à défaut
 * l'article du dossier de retour ; à défaut la commande entière quand elle
 * l'est, son article unique, ou l'article dont le prix est exactement le
 * montant. Sinon, aucun : un remboursement partiel sans article précisé
 * n'est attribué à personne.
 */
export function articlesDe(
  remboursement: Pick<Unifie, 'montant' | 'lignes' | 'lignesCommande' | 'totalCommande'>,
  retour?: { productTitle: string; variantTitle: string | null } | null,
): Array<{ titre: string; variante: string | null; montant: number; image: string | null }> {
  const { montant, lignes, lignesCommande, totalCommande } = remboursement;
  const vers = (ligne: LigneRemboursee, valeur: number) => ({
    titre: ligne.title,
    variante: ligne.variantTitle,
    montant: valeur,
    image: ligne.image,
  });

  if (lignes.length) {
    const somme = lignes.reduce((total, ligne) => total + (ligne.amount ?? 0), 0);
    return lignes.map((ligne) => vers(ligne, somme > 0 ? (ligne.amount ?? 0) : montant / lignes.length));
  }
  if (retour) return [{ titre: retour.productTitle, variante: retour.variantTitle, montant, image: null }];
  if (lignesCommande.length === 1) return [vers(lignesCommande[0]!, montant)];
  if (lignesCommande.length && totalCommande && montant >= totalCommande - 0.01) {
    const somme = lignesCommande.reduce((total, ligne) => total + (ligne.amount ?? 0), 0);
    return lignesCommande.map((ligne) =>
      vers(ligne, somme > 0 ? (montant * (ligne.amount ?? 0)) / somme : montant / lignesCommande.length),
    );
  }
  const egales = lignesCommande.filter((ligne) => ligne.amount != null && Math.abs(ligne.amount - montant) < 0.01);
  if (egales.length === 1) return [vers(egales[0]!, montant)];
  return [];
}

/** Lundi 0 h (UTC) de la semaine d'une date, ou le premier du mois. */
function debutDe(date: Date, pas: 'semaine' | 'mois'): Date {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  if (pas === 'mois') return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d;
}

function suivant(date: Date, pas: 'semaine' | 'mois'): Date {
  return pas === 'mois'
    ? new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1))
    : new Date(date.getTime() + 7 * 86_400_000);
}

export function calculerStats(entrees: EntreesStats) {
  const { maintenant, jours } = entrees;
  const depuis = new Date(maintenant.getTime() - jours * 86_400_000);
  const depuisPrecedent = new Date(maintenant.getTime() - 2 * jours * 86_400_000);

  // Un seul exemplaire par remboursement : celui de l'outil retrouve sa copie
  // Shopify, dont il garde le motif et prend les articles.
  const parShopify = new Map(entrees.outil.filter((r) => r.shopifyRefundId).map((r) => [r.shopifyRefundId!, r]));
  const vus = new Set<string>();
  const tous: Unifie[] = [];
  for (const s of entrees.shopify ?? []) {
    const outil = parShopify.get(s.id);
    if (outil) vus.add(outil.id);
    tous.push({
      orderId: s.shopifyOrderId,
      date: new Date(s.createdAt),
      montant: s.amount,
      devise: s.currency,
      motif: outil?.reason ?? s.note,
      lignes: s.lignes,
      lignesCommande: s.lignesCommande,
      totalCommande: s.orderTotal,
    });
  }
  for (const r of entrees.outil) {
    if (vus.has(r.id) || r.status !== 'COMPLETED') continue;
    tous.push({
      orderId: r.shopifyOrderId,
      date: r.createdAt,
      montant: r.amount,
      devise: r.currency,
      motif: r.reason,
      lignes: [],
      lignesCommande: [],
      totalCommande: null,
    });
  }

  const courants = tous.filter((r) => r.date >= depuis && r.date <= maintenant);
  const precedents = tous.filter((r) => r.date >= depuisPrecedent && r.date < depuis);
  const somme = (liste: Unifie[]) => liste.reduce((total, r) => total + r.montant, 0);
  const total = { montant: somme(courants), nombre: courants.length };
  const precedent = { montant: somme(precedents), nombre: precedents.length };

  const devises = new Map<string, number>();
  for (const r of courants) devises.set(r.devise, (devises.get(r.devise) ?? 0) + 1);
  const devise = [...devises.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'EUR';

  // Le dossier de retour de la commande, ouvert avant le remboursement.
  const retourDe = (r: Unifie) =>
    entrees.retours
      .filter((retour) => retour.shopifyOrderId === r.orderId && retour.createdAt.getTime() <= r.date.getTime() + 86_400_000)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0] ?? null;

  const raisons = new Map<CleRaison, { nombre: number; montant: number }>();
  const produits = new Map<
    string,
    {
      titre: string;
      nombre: number;
      montant: number;
      image: string | null;
      variantes: Map<string, number>;
      raisons: Map<CleRaison, number>;
    }
  >();
  const nonAttribues = { nombre: 0, montant: 0 };

  for (const r of courants) {
    const retour = retourDe(r);
    const cle = raisonDe(r.motif, retour?.reason);
    const raison = raisons.get(cle) ?? { nombre: 0, montant: 0 };
    raison.nombre += 1;
    raison.montant += r.montant;
    raisons.set(cle, raison);

    const articles = articlesDe(r, retour);
    if (articles.length === 0) {
      nonAttribues.nombre += 1;
      nonAttribues.montant += r.montant;
    }
    const comptes = new Set<string>();
    for (const article of articles) {
      const produit = produits.get(article.titre) ?? {
        titre: article.titre,
        nombre: 0,
        montant: 0,
        image: article.image,
        variantes: new Map(),
        raisons: new Map(),
      };
      // Un remboursement compte une fois par produit, même sur deux tailles.
      if (!comptes.has(article.titre)) {
        produit.nombre += 1;
        produit.raisons.set(cle, (produit.raisons.get(cle) ?? 0) + 1);
        comptes.add(article.titre);
      }
      produit.montant += article.montant;
      produit.image ??= article.image;
      if (article.variante) produit.variantes.set(article.variante, (produit.variantes.get(article.variante) ?? 0) + 1);
      produits.set(article.titre, produit);
    }
  }

  // Par semaine jusqu'à trois mois, par mois au-delà : 13 barres plutôt que 52.
  const pas = jours <= 92 ? 'semaine' : 'mois';
  const points: Array<{ debut: string; montant: number; nombre: number }> = [];
  for (let debut = debutDe(depuis, pas); debut <= maintenant; debut = suivant(debut, pas)) {
    const fin = suivant(debut, pas);
    const dedans = courants.filter((r) => r.date >= debut && r.date < fin);
    points.push({ debut: debut.toISOString().slice(0, 10), montant: somme(dedans), nombre: dedans.length });
  }

  const ordresRembourses = new Set(tous.map((r) => r.orderId));
  const plusFrequent = <K>(carte: Map<K, number>): [K, number] | null =>
    [...carte.entries()].sort((a, b) => b[1] - a[1])[0] ?? null;

  return {
    jours,
    devise,
    total,
    precedent,
    evolution: precedent.montant > 0 ? (total.montant - precedent.montant) / precedent.montant : null,
    moyenne: total.nombre ? total.montant / total.nombre : null,
    chiffreAffaires: entrees.chiffreAffaires,
    part: entrees.chiffreAffaires && entrees.chiffreAffaires > 0 ? total.montant / entrees.chiffreAffaires : null,
    demandes: {
      recues: entrees.demandes.length,
      remboursees: entrees.demandes.filter(
        (d) => d.rembourse || (d.shopifyOrderId !== null && ordresRembourses.has(d.shopifyOrderId)),
      ).length,
    },
    serie: { pas, points },
    raisons: [...raisons.entries()]
      .map(([cle, { nombre, montant }]) => ({ cle, libelle: LIBELLES_RAISONS[cle], nombre, montant }))
      .sort((a, b) => b.montant - a.montant || b.nombre - a.nombre),
    produits: [...produits.values()]
      .sort((a, b) => b.montant - a.montant || b.nombre - a.nombre)
      .slice(0, 50)
      .map((p) => {
        const raison = plusFrequent(p.raisons);
        const variante = plusFrequent(p.variantes);
        return {
          titre: p.titre,
          variante: variante?.[0] ?? null,
          nombre: p.nombre,
          montant: p.montant,
          image: p.image,
          raison: raison ? LIBELLES_RAISONS[raison[0]] : null,
          raisonNombre: raison?.[1] ?? 0,
        };
      }),
    produitsTotal: produits.size,
    nonAttribues,
    sources: { shopify: entrees.shopify !== null, partiel: entrees.partiel },
  };
}

export type StatsRemboursements = ReturnType<typeof calculerStats>;

/* Shopify est lent sur une année : le calcul est gardé dix minutes. */
const CACHE = new Map<string, { a: number; valeur: StatsRemboursements }>();
const DUREE_CACHE = 10 * 60 * 1000;

export function oublierStatsRemboursements(merchantId: string): void {
  for (const cle of CACHE.keys()) if (cle.startsWith(`${merchantId}:`)) CACHE.delete(cle);
}

export async function statsRemboursements(
  merchantId: string,
  jours: number,
  { journal }: { journal?: { warn: (objet: unknown, message: string) => void } } = {},
): Promise<StatsRemboursements> {
  const cle = `${merchantId}:${jours}`;
  const garde = CACHE.get(cle);
  if (garde && Date.now() - garde.a < DUREE_CACHE) return garde.valeur;

  const maintenant = new Date();
  const depuis = new Date(maintenant.getTime() - jours * 86_400_000);
  const depuisPrecedent = new Date(maintenant.getTime() - 2 * jours * 86_400_000);

  const [outil, retours, tickets] = await Promise.all([
    prisma.refund.findMany({
      where: { merchantId, test: false, createdAt: { gte: depuisPrecedent } },
      select: {
        id: true,
        shopifyOrderId: true,
        shopifyRefundId: true,
        amount: true,
        currency: true,
        reason: true,
        status: true,
        createdAt: true,
      },
    }),
    prisma.returnCase.findMany({
      where: {
        merchantId,
        shopifyOrderId: { not: null },
        createdAt: { gte: new Date(depuisPrecedent.getTime() - 120 * 86_400_000) },
      },
      select: { shopifyOrderId: true, productTitle: true, variantTitle: true, reason: true, createdAt: true },
    }),
    prisma.ticket.findMany({
      where: { merchantId, intent: 'REFUND', isHistorical: false, createdAt: { gte: depuis } },
      select: {
        shopifyOrderId: true,
        refunds: { where: { status: 'COMPLETED', test: false }, select: { id: true }, take: 1 },
      },
    }),
  ]);

  let shopify: RemboursementDetaille[] | null = null;
  let partiel = false;
  let chiffreAffaires: number | null = null;
  try {
    const client = await getShopifyClient(merchantId);
    const [details, commerce] = await Promise.all([
      fetchRefundDetails(client, depuisPrecedent),
      fetchCommerceStats(client, jours),
    ]);
    shopify = details.remboursements;
    partiel = details.partiel;
    // Au-delà de 2 000 commandes, le chiffre d'affaires est tronqué : une
    // part calculée dessus serait fausse, on n'en donne pas.
    const tronque = commerce.totals.orders + commerce.totals.cancelled >= 2000;
    chiffreAffaires = tronque ? null : commerce.totals.revenue;
  } catch (error) {
    journal?.warn({ err: error, merchantId }, 'Statistiques de remboursement : Shopify indisponible');
  }

  const valeur = calculerStats({
    maintenant,
    jours,
    outil: outil.map((r) => ({ ...r, amount: Number(r.amount) })),
    shopify,
    partiel,
    retours,
    demandes: tickets.map((t) => ({ shopifyOrderId: t.shopifyOrderId, rembourse: t.refunds.length > 0 })),
    chiffreAffaires,
  });
  // Un calcul sans Shopify n'est pas gardé : la prochaine ouverture réessaie.
  if (shopify !== null) CACHE.set(cle, { a: Date.now(), valeur });
  return valeur;
}
