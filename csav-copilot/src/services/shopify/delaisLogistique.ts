import { getTracking, registerTracking, type TrackInfo } from '../tracking/index.ts';
import type { ShopifyClient } from './client.ts';
import { countOrders } from './orders.ts';

/**
 * La bande du haut de la Vue d'ensemble, côté logistique.
 *
 *   - les commandes payées, non annulées, pas encore expédiées — et parmi
 *     elles celles qui attendent depuis plus de RETARD_JOURS ;
 *   - le délai d'expédition : de la commande au premier envoi (Shopify) ;
 *   - le délai de livraison : de la commande à la livraison. Shopify le sait
 *     pour certains transporteurs ; pour les autres, c'est 17TRACK qui le dit.
 *
 * Les délais sont des médianes, en jours, sur les FENETRE_JOURS derniers
 * jours, comparées aux FENETRE_JOURS d'avant : un colis bloqué deux mois ne
 * doit pas déplacer le chiffre de toute la boutique.
 */

export const RETARD_JOURS = 7;
export const FENETRE_JOURS = 30;
const JOUR = 86_400_000;
const COMMANDES_MAX = 2000;
const DELAI_MAX = 20_000;
/** Au plus autant de numéros demandés au transporteur par période : au-delà,
    la médiane ne bouge plus, et chaque numéro coûte du quota. */
const SUIVIS_MAX = 150;

const QUERY = /* GraphQL */ `
  query DelaisExpedition($query: String!, $cursor: String) {
    orders(first: 250, after: $cursor, query: $query, sortKey: CREATED_AT) {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        createdAt
        cancelledAt
        fulfillments(first: 5) {
          createdAt
          deliveredAt
          trackingInfo(first: 1) {
            number
          }
        }
      }
    }
  }
`;

interface Envoi {
  commandeLe: number;
  expedieLe: number;
  livreLe: number | null;
  numero: string | null;
}

export interface Delai {
  /** Médiane en jours, une décimale ; `null` sans aucune mesure. */
  jours: number | null;
  /** La même mesure sur la période précédente. */
  avant: number | null;
  /** Combien de commandes la mesure couvre sur la période. */
  n: number;
}

export interface BandeauLogistique {
  nonExpediees: { total: number; enRetard: number; auMoins: boolean };
  expedition: Delai;
  livraison: Delai;
  tronque: boolean;
  retardJours: number;
  fenetreJours: number;
}

const attendre = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function lireEnvois(client: ShopifyClient, depuis: Date): Promise<{ envois: Envoi[]; tronque: boolean }> {
  const query = `created_at:>='${depuis.toISOString()}' -status:cancelled`;
  const envois: Envoi[] = [];
  let cursor: string | null = null;
  let lues = 0;
  let essais = 0;
  const debut = Date.now();

  for (;;) {
    if (lues >= COMMANDES_MAX || Date.now() - debut > DELAI_MAX) return { envois, tronque: true };
    let data: {
      orders: {
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
        nodes: Array<{
          createdAt: string;
          cancelledAt: string | null;
          fulfillments: Array<{ createdAt: string; deliveredAt: string | null; trackingInfo: Array<{ number: string | null }> }>;
        }>;
      };
    };
    try {
      data = await client.request(QUERY, { query, cursor });
    } catch (error) {
      const details = (error as { details?: unknown })?.details;
      const codes = Array.isArray(details) ? details.map((e) => e?.extensions?.code ?? '').join(' ') : '';
      if (/THROTTLED|throttled/i.test(`${codes} ${(error as Error)?.message}`) && essais < 4) {
        essais += 1;
        await attendre(1500 * essais);
        continue;
      }
      throw error;
    }
    essais = 0;

    for (const commande of data.orders.nodes) {
      lues += 1;
      if (commande.cancelledAt) continue;
      // Le premier envoi fait foi : une commande expédiée en deux fois l'a
      // été, pour le client, au premier colis.
      const premier = [...(commande.fulfillments ?? [])].sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
      if (!premier) continue;
      envois.push({
        commandeLe: Date.parse(commande.createdAt),
        expedieLe: Date.parse(premier.createdAt),
        livreLe: premier.deliveredAt ? Date.parse(premier.deliveredAt) : null,
        numero: premier.trackingInfo?.[0]?.number ?? null,
      });
    }
    if (!data.orders.pageInfo.hasNextPage) return { envois, tronque: false };
    cursor = data.orders.pageInfo.endCursor;
  }
}

/** Médiane en jours, arrondie au dixième. */
export function medianeJours(durees: number[]): number | null {
  const valides = durees.filter((d) => Number.isFinite(d) && d >= 0).sort((a, b) => a - b);
  if (valides.length === 0) return null;
  const milieu = Math.floor(valides.length / 2);
  const ms = valides.length % 2 ? valides[milieu]! : (valides[milieu - 1]! + valides[milieu]!) / 2;
  return Math.round((ms / JOUR) * 10) / 10;
}

/**
 * Complète la date de livraison par le transporteur, quand Shopify ne l'a
 * pas. Seuls les envois partis depuis plus d'un jour : un colis de la veille
 * n'est pas livré, inutile de le demander.
 */
async function completerLivraisons(envois: Envoi[], maintenant: number): Promise<void> {
  const aLire = envois
    .filter((e) => e.livreLe === null && e.numero && maintenant - e.expedieLe > JOUR)
    .sort((a, b) => b.commandeLe - a.commandeLe)
    .slice(0, SUIVIS_MAX * 2);
  const numeros = [...new Set(aLire.map((e) => e.numero!))];
  if (numeros.length === 0) return;

  let infos = new Map<string, TrackInfo>();
  try {
    // 17TRACK ne répond que sur les numéros déclarés ; l'écran Suivi colis
    // les déclare déjà, le faire ici ne coûte rien de plus pour ceux-là.
    await registerTracking(numeros).catch(() => {});
    infos = await getTracking(numeros);
  } catch {
    return;
  }
  for (const envoi of aLire) {
    const livre = infos.get(envoi.numero!)?.deliveredAt;
    if (livre) envoi.livreLe = Date.parse(livre);
  }
}

function mesurer(envois: Envoi[], depuis: number, avant: number, duree: (e: Envoi) => number | null): number[] {
  return envois
    .filter((e) => e.commandeLe >= depuis && e.commandeLe < avant)
    .map(duree)
    .filter((d): d is number => d !== null);
}

export async function bandeauLogistique(client: ShopifyClient, maintenant = Date.now()): Promise<BandeauLogistique> {
  const limite = new Date(maintenant - RETARD_JOURS * JOUR).toISOString();
  const base = 'fulfillment_status:unfulfilled financial_status:paid status:open';
  const debutAvant = maintenant - 2 * FENETRE_JOURS * JOUR;
  const debutCourant = maintenant - FENETRE_JOURS * JOUR;

  const [comptes, { envois, tronque }] = await Promise.all([
    countOrders(client, { total: base, enRetard: `${base} created_at:<'${limite}'` }),
    lireEnvois(client, new Date(debutAvant)),
  ]);

  await completerLivraisons(envois, maintenant);

  const expedition = (e: Envoi) => e.expedieLe - e.commandeLe;
  const livraison = (e: Envoi) => (e.livreLe === null ? null : e.livreLe - e.commandeLe);

  const expCourant = mesurer(envois, debutCourant, maintenant, expedition);
  const livCourant = mesurer(envois, debutCourant, maintenant, livraison);

  return {
    nonExpediees: {
      total: comptes.total?.count ?? 0,
      enRetard: comptes.enRetard?.count ?? 0,
      auMoins: Boolean(comptes.total?.auMoins),
    },
    expedition: {
      jours: medianeJours(expCourant),
      avant: medianeJours(mesurer(envois, debutAvant, debutCourant, expedition)),
      n: expCourant.length,
    },
    livraison: {
      jours: medianeJours(livCourant),
      avant: medianeJours(mesurer(envois, debutAvant, debutCourant, livraison)),
      n: livCourant.length,
    },
    tronque,
    retardJours: RETARD_JOURS,
    fenetreJours: FENETRE_JOURS,
  };
}

/* ------------------------------------------------------------ cache ---- */

const DUREE_CACHE = 15 * 60_000;
const cache = new Map<string, { expire: number; valeur: Promise<BandeauLogistique> }>();

export function bandeauEnCache(merchantId: string, client: ShopifyClient): Promise<BandeauLogistique> {
  const connu = cache.get(merchantId);
  if (connu && connu.expire > Date.now()) return connu.valeur;
  const valeur = bandeauLogistique(client);
  cache.set(merchantId, { expire: Date.now() + DUREE_CACHE, valeur });
  valeur.catch(() => cache.delete(merchantId));
  if (cache.size > 200) cache.delete(cache.keys().next().value!);
  return valeur;
}
