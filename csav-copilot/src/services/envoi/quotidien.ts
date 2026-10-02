import { logger } from '../../lib/logger.ts';
import { prisma } from '../../lib/prisma.ts';
import { ordersToXlsx } from '../export/ordersXlsx.ts';
import { resumeArticles } from './statutLot.ts';
import { sendPlainEmail } from '../gmail/send.ts';
import { langueAtelier, mailDuJour } from '../suppliers/langueAtelier.ts';
import { ENVOI_SIMULE } from '../modeTest.ts';
import {
  rapprocherStockUnique,
  type CorrespondanceStock,
  type PaireEnStock,
} from '../reshipment/rapprochement.ts';
import { getShopifyClient } from '../shopify/client.ts';
import { listOrders, type OrderSummary } from '../shopify/orders.ts';
import { ordersForSupplier, type RoutingRules } from '../suppliers/routing.ts';

/**
 * Les commandes de la veille, avant de partir chez le fournisseur.
 *
 * CE QUI CHANGE. Le fichier de commandes était téléchargé puis envoyé à la
 * main, sans regarder le stock retours : une paire retournée, contrôlée et
 * rangée chez le marchand restait sur l'étagère pendant que l'atelier en
 * fabriquait une neuve, livrée en quinze jours au lieu de deux.
 *
 * Désormais, avant l'envoi, chaque commande est rapprochée du stock. Celles
 * que le marchand décide d'expédier lui-même sont réservées — et retirées du
 * fichier. Le reste part, une seule fois : une commande transmise est notée,
 * et ne repartira jamais.
 */

/** Le marchand travaille à l'heure de Paris, quel que soit le serveur. */
const FUSEAU = 'Europe/Paris';

/** Heure (0-23) à Paris. */
export function heureParis(date: Date): number {
  return Number(
    new Intl.DateTimeFormat('en-GB', { timeZone: FUSEAU, hour: '2-digit', hour12: false })
      .format(date)
      .replace('24', '0'),
  );
}

/** Minuit à Paris, le jour de `date`, en instant UTC. */
export function minuitParis(date: Date): Date {
  const morceaux = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: FUSEAU,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    })
      .formatToParts(date)
      .map((part) => [part.type, part.value]),
  );
  const minuitUtc = Date.UTC(Number(morceaux.year), Number(morceaux.month) - 1, Number(morceaux.day));
  // Le décalage de Paris ce jour-là (heure d'été ou d'hiver) : l'écart entre
  // l'heure murale de `date` et le même instant lu en UTC.
  const murale = Date.UTC(
    Number(morceaux.year),
    Number(morceaux.month) - 1,
    Number(morceaux.day),
    Number(morceaux.hour) % 24,
    Number(morceaux.minute),
    Number(morceaux.second),
  );
  const decalage = murale - Math.floor(date.getTime() / 1000) * 1000;
  return new Date(minuitUtc - decalage);
}

export interface CommandeDuJour {
  id: string;
  name: string;
  createdAt: string;
  client: string | null;
  lignes: Array<{ titre: string; declinaison: string | null; sku: string | null; quantite: number }>;
  fournisseur: { id: string; name: string } | null;
}

export interface EtatDuJour {
  reglage: { mode: 'MANUEL' | 'AUTO'; heure: number; delaiJours: number };
  /** Commandes créées à partir de cet instant, et avant minuit ce matin. */
  depuis: string;
  jusqua: string;
  /** À envoyer : ni transmises, ni servies par le stock, ni commencées. */
  commandes: CommandeDuJour[];
  /** Celles du lot que le stock retours peut servir en entier. */
  correspondances: CorrespondanceStock[];
  /** Celles du lot déjà réservées au stock : elles ne partiront pas. */
  reservees: Array<{ id: string; name: string; paires: string[] }>;
  /** Plafond de pagination atteint : la liste n'est peut-être pas complète. */
  tronque: boolean;
}

const PAGES_MAX = 10;

/**
 * Le plancher de la fenêtre : posé à la première consultation.
 *
 * Avant ce jour, les commandes partaient à la main ; les compter « à envoyer »
 * renverrait tout l'historique au fournisseur. Le plancher est le début de la
 * veille : c'est le premier lot que l'écran prend en charge.
 */
async function plancher(merchantId: string, maintenant: Date): Promise<Date> {
  const merchant = await prisma.merchant.findUniqueOrThrow({
    where: { id: merchantId },
    select: { envoiDepuis: true },
  });
  if (merchant.envoiDepuis) return merchant.envoiDepuis;

  const hier = minuitParis(new Date(minuitParis(maintenant).getTime() - 12 * 3600 * 1000));
  await prisma.merchant.updateMany({
    where: { id: merchantId, envoiDepuis: null },
    data: { envoiDepuis: hier },
  });
  return hier;
}

export async function etatDuJour(merchantId: string, maintenant = new Date()): Promise<EtatDuJour> {
  const [merchant, depuis] = await Promise.all([
    prisma.merchant.findUniqueOrThrow({
      where: { id: merchantId },
      select: { envoiMode: true, envoiHeure: true, lotDelaiJours: true },
    }),
    plancher(merchantId, maintenant),
  ]);
  const jusqua = minuitParis(maintenant);

  // Les commandes de la fenêtre, toutes pages. Le filtre de date est refait
  // ici : la recherche Shopify ne fait pas foi aux bornes, et le mode simulé
  // l'ignore.
  const client = await getShopifyClient(merchantId);
  const brutes: OrderSummary[] = [];
  let cursor: string | null = null;
  let tronque = false;
  for (let page = 0; page < PAGES_MAX; page += 1) {
    const resultat = await listOrders(client, {
      query: `created_at:>='${depuis.toISOString()}' created_at:<'${jusqua.toISOString()}' status:open`,
      limit: 100,
      cursor,
      sort: 'oldest',
    });
    brutes.push(...resultat.orders);
    cursor = resultat.hasNextPage ? resultat.cursor : null;
    if (!cursor) break;
    if (page === PAGES_MAX - 1) tronque = true;
  }

  const dansLaFenetre = brutes.filter((order) => {
    const cree = new Date(order.createdAt).getTime();
    return (
      cree >= depuis.getTime() &&
      cree < jusqua.getTime() &&
      ['UNFULFILLED', 'OPEN', null].includes(order.displayFulfillmentStatus)
    );
  });

  const ids = dansLaFenetre.map((order) => order.id);
  const [envoyees, colis, servies, enStock, suppliers] = await Promise.all([
    prisma.envoiCommande.findMany({
      where: { merchantId, shopifyOrderId: { in: ids } },
      select: { shopifyOrderId: true },
    }),
    // Un colis saisi : l'atelier l'a déjà en main, par un autre chemin.
    prisma.parcel.findMany({
      where: { merchantId, shopifyOrderId: { in: ids } },
      select: { shopifyOrderId: true },
    }),
    prisma.returnCase.findMany({
      where: { merchantId, reusedShopifyOrderId: { in: ids } },
      select: { reusedShopifyOrderId: true, productTitle: true, variantTitle: true },
    }),
    prisma.returnCase.findMany({
      where: { merchantId, status: 'RESTOCKED', reusedAt: null },
      select: {
        id: true,
        sku: true,
        productTitle: true,
        variantTitle: true,
        orderName: true,
        restockedAt: true,
        updatedAt: true,
      },
    }),
    prisma.supplier.findMany({
      where: { merchantId, active: true },
      orderBy: { createdAt: 'asc' },
      select: { id: true, name: true, vendors: true, skuPrefixes: true, isDefault: true },
    }),
  ]);

  const dejaParties = new Set(envoyees.map((ligne) => ligne.shopifyOrderId));
  const commencees = new Set(colis.map((ligne) => ligne.shopifyOrderId));
  const parStock = new Map<string, string[]>();
  for (const ligne of servies) {
    if (!ligne.reusedShopifyOrderId) continue;
    parStock.set(ligne.reusedShopifyOrderId, [
      ...(parStock.get(ligne.reusedShopifyOrderId) ?? []),
      [ligne.productTitle, ligne.variantTitle].filter(Boolean).join(' · '),
    ]);
  }

  const aEnvoyer = dansLaFenetre.filter(
    (order) => !dejaParties.has(order.id) && !commencees.has(order.id) && !parStock.has(order.id),
  );

  const destinataire = repartir(aEnvoyer, suppliers);

  const stock: PaireEnStock[] = enStock.map((paire) => ({
    id: paire.id,
    pays: null,
    agenceId: null,
    agenceNom: null,
    sku: paire.sku,
    titre: paire.productTitle,
    declinaison: paire.variantTitle,
    depuis: paire.restockedAt ?? paire.updatedAt,
    retourDe: paire.orderName,
  }));

  const enLignes = (order: OrderSummary) =>
    (order.lineItems ?? []).map((ligne) => ({
      titre: ligne.title,
      declinaison: ligne.variantTitle ?? null,
      sku: ligne.sku ?? null,
      quantite: ligne.quantity,
    }));

  const correspondances = rapprocherStockUnique(
    stock,
    aEnvoyer.map((order) => ({
      id: order.id,
      nom: order.name,
      client: order.customer?.displayName ?? null,
      pays: null,
      creeLe: order.createdAt,
      lignes: enLignes(order),
    })),
  );

  return {
    reglage: { mode: merchant.envoiMode, heure: merchant.envoiHeure, delaiJours: merchant.lotDelaiJours },
    depuis: depuis.toISOString(),
    jusqua: jusqua.toISOString(),
    commandes: aEnvoyer.map((order) => {
      const fournisseur = suppliers.find((supplier) => supplier.id === destinataire.get(order.id));
      return {
        id: order.id,
        name: order.name,
        createdAt: order.createdAt,
        client: order.customer?.displayName ?? order.shippingAddress?.name ?? null,
        lignes: enLignes(order),
        fournisseur: fournisseur ? { id: fournisseur.id, name: fournisseur.name } : null,
      };
    }),
    correspondances,
    reservees: dansLaFenetre
      .filter((order) => parStock.has(order.id))
      .map((order) => ({ id: order.id, name: order.name, paires: parStock.get(order.id) ?? [] })),
    tronque,
  };
}

/**
 * À quel fournisseur va chaque commande : les mêmes règles que son atelier
 * (marques, préfixes de référence, fournisseur par défaut). Un seul
 * fournisseur actif reçoit tout.
 */
function repartir(
  orders: OrderSummary[],
  suppliers: Array<RoutingRules & { name: string }>,
): Map<string, string> {
  const destinataire = new Map<string, string>();
  if (suppliers.length === 1) {
    for (const order of orders) destinataire.set(order.id, suppliers[0]!.id);
    return destinataire;
  }
  // Les fournisseurs à règles d'abord, celui par défaut ensuite : il prend
  // ce que personne n'a réclamé.
  const ordre = [...suppliers].sort((a, b) => Number(a.isDefault) - Number(b.isDefault));
  for (const supplier of ordre) {
    const autres = suppliers.filter((other) => other.id !== supplier.id);
    for (const order of ordersForSupplier(orders, supplier, autres, [])) {
      if (!destinataire.has(order.id)) destinataire.set(order.id, supplier.id);
    }
  }
  return destinataire;
}

export interface ResultatEnvoi {
  fournisseur: string;
  combien: number;
  parti: boolean;
  simule: boolean;
  erreur: string | null;
}

/** Libellé du jour pour l'objet du mail : « 1 oct. ». */

/**
 * Envoie à chaque fournisseur le fichier de ses commandes.
 *
 * Les commandes sont RÉCLAMÉES avant l'envoi, par une écriture que la base
 * refuse en double (une commande, un envoi) : deux clics, ou un clic et
 * l'envoi automatique à la même minute, ne peuvent pas transmettre la même
 * commande deux fois. Si le mail échoue, la réclamation est rendue : la
 * commande repartira au prochain envoi au lieu d'être tenue pour transmise.
 *
 * Le stock n'est jamais touché ici : réserver une paire est une décision du
 * marchand, prise sur l'écran — l'envoi automatique ne la prend pas à sa place.
 */
export async function envoyerAuxFournisseurs(params: {
  merchantId: string;
  mode: 'MANUEL' | 'AUTO';
  userId?: string | null;
  maintenant?: Date;
}): Promise<ResultatEnvoi[]> {
  const { merchantId, mode } = params;
  const maintenant = params.maintenant ?? new Date();
  const etat = await etatDuJour(merchantId, maintenant);

  const parFournisseur = new Map<string, CommandeDuJour[]>();
  for (const commande of etat.commandes) {
    if (!commande.fournisseur) continue;
    parFournisseur.set(commande.fournisseur.id, [...(parFournisseur.get(commande.fournisseur.id) ?? []), commande]);
  }
  if (parFournisseur.size === 0) return [];

  const merchant = await prisma.merchant.findUniqueOrThrow({
    where: { id: merchantId },
    select: { name: true, brandName: true, shopDomain: true, emailSignature: true },
  });
  const nom = merchant.brandName || merchant.name || merchant.shopDomain;
  const client = await getShopifyClient(merchantId);
  const resultats: ResultatEnvoi[] = [];

  for (const [supplierId, commandes] of parFournisseur) {
    const supplier = await prisma.supplier.findUniqueOrThrow({
      where: { id: supplierId },
      select: { name: true, contactEmail: true, langue: true },
    });

    const envoi = await prisma.envoiFournisseur.create({
      data: { merchantId, supplierId, mode, userId: params.userId ?? null, combien: 0 },
    });
    const reclamees = await prisma.envoiCommande.createMany({
      data: commandes.map((commande) => ({
        merchantId,
        envoiId: envoi.id,
        shopifyOrderId: commande.id,
        orderName: commande.name,
        articles: resumeArticles(commande.lignes),
      })),
      skipDuplicates: true,
    });
    const miennes = await prisma.envoiCommande.findMany({
      where: { envoiId: envoi.id },
      select: { shopifyOrderId: true },
    });
    const ids = new Set(miennes.map((ligne) => ligne.shopifyOrderId));

    // Tout réclamé par un envoi concurrent : rien à faire, et pas de trace vide.
    if (reclamees.count === 0) {
      await prisma.envoiFournisseur.delete({ where: { id: envoi.id } });
      continue;
    }

    try {
      // Les commandes relues en entier pour le fichier : la photo et l'adresse
      // ne sont pas dans le résumé de l'écran.
      const completes: OrderSummary[] = [];
      for (const commande of commandes.filter((ligne) => ids.has(ligne.id))) {
        const page = await listOrders(client, { query: `name:"${commande.name}"`, limit: 5 });
        const trouvee = page.orders.find((order) => order.id === commande.id);
        if (trouvee) completes.push(trouvee);
      }

      const fichier = await ordersToXlsx(
        completes.map((order) => ({ order, storeUrl: `https://${merchant.shopDomain}` })),
      );
      const envoye = await sendPlainEmail({
        merchantId,
        to: supplier.contactEmail,
        fromName: nom,
        // Dans la langue de l'atelier ; le jour des commandes est la veille
        // de la borne de minuit.
        ...mailDuJour({
          langue: langueAtelier(supplier.langue),
          date: new Date(new Date(etat.jusqua).getTime() - 1),
          fuseau: FUSEAU,
          combien: ids.size,
          signature: merchant.emailSignature?.trim() || nom,
        }),
        attachments: [
          {
            filename: `commandes-${new Date(etat.jusqua).toISOString().slice(0, 10)}.xlsx`,
            mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            content: fichier,
          },
        ],
      });
      const simule = envoye.fromEmail === ENVOI_SIMULE.fromEmail || envoye.fromEmail === 'simulation@local';

      await prisma.envoiFournisseur.update({
        where: { id: envoi.id },
        data: { combien: ids.size, emailedAt: new Date(), simule },
      });
      resultats.push({ fournisseur: supplier.name, combien: ids.size, parti: true, simule, erreur: null });
    } catch (error) {
      const erreur = (error instanceof Error ? error.message : String(error)).slice(0, 300);
      logger.warn({ err: error, merchantId, supplierId }, 'Envoi des commandes du jour en échec');
      // Rendues : elles repartiront au prochain envoi.
      await prisma.envoiCommande.deleteMany({ where: { envoiId: envoi.id } });
      await prisma.envoiFournisseur.update({
        where: { id: envoi.id },
        data: { combien: ids.size, erreur },
      });
      resultats.push({ fournisseur: supplier.name, combien: ids.size, parti: false, simule: false, erreur });
    }
  }

  return resultats;
}

/** Une heure entre deux tentatives après un échec : pas de mail en rafale. */
const REPRISE_APRES_ECHEC_MS = 60 * 60 * 1000;

/**
 * Le passage de l'envoi automatique, toutes les quinze minutes.
 *
 * Pour chaque boutique en mode AUTO dont l'heure est passée : ce qui n'est
 * pas parti part. Un envoi manuel dans la journée ne laisse rien à envoyer,
 * donc rien ne repart. Un échec récent fait attendre une heure.
 */
export async function passageAutomatique(maintenant = new Date()): Promise<number> {
  const heure = heureParis(maintenant);
  const boutiques = await prisma.merchant.findMany({
    where: { envoiMode: 'AUTO', envoiHeure: { lte: heure } },
    select: { id: true },
  });

  let envoyes = 0;
  for (const boutique of boutiques) {
    // Déjà parti aujourd'hui, à la main ou non : le lot du jour est traité.
    const dejaParti = await prisma.envoiFournisseur.count({
      where: { merchantId: boutique.id, emailedAt: { gte: minuitParis(maintenant) } },
    });
    if (dejaParti > 0) continue;

    const echecRecent = await prisma.envoiFournisseur.count({
      where: {
        merchantId: boutique.id,
        emailedAt: null,
        createdAt: { gte: new Date(maintenant.getTime() - REPRISE_APRES_ECHEC_MS) },
      },
    });
    if (echecRecent > 0) continue;

    try {
      const resultats = await envoyerAuxFournisseurs({ merchantId: boutique.id, mode: 'AUTO', maintenant });
      envoyes += resultats.filter((resultat) => resultat.parti).length;
    } catch (error) {
      logger.error({ err: error, merchantId: boutique.id }, 'Envoi automatique impossible');
    }
  }
  return envoyes;
}
