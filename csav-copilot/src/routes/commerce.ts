import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { env } from '../config/env.ts';
import { prisma } from '../lib/prisma.ts';
import { ordersToCsv } from '../services/export/ordersCsv.ts';
import { ordersToXlsx } from '../services/export/ordersXlsx.ts';
import {
  getTracking,
  registerTracking,
  TRACK_STATUS_LABELS,
} from '../services/tracking/index.ts';
import { requireSession } from '../plugins/auth.ts';
import { getShopifyClient, ShopifyError, ShopifyScopeError } from '../services/shopify/client.ts';
import { listCollections, listDisputes, listProducts, listVariants } from '../services/shopify/catalog.ts';
import { listCustomers } from '../services/shopify/customers.ts';
import { getOrderById, listOrders, quoteSearchValue } from '../services/shopify/orders.ts';

/**
 * Consultation du carnet de commandes et du fichier client.
 *
 * Ces données ne sont jamais copiées en base : chaque appel interroge Shopify
 * en direct. Dupliquer un catalogue de commandes obligerait à le synchroniser,
 * et un SAV qui affiche un statut périmé est pire qu'un SAV qui affiche un
 * écran vide. Le coût est une latence d'API à chaque ouverture d'écran.
 */

const listQuery = z.object({
  q: z.string().max(200).optional(),
  cursor: z.string().max(500).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(25),
});

/**
 * Filtres propres à l'écran Commandes.
 *
 * Chaque écran a les siens : trier des commandes par état de paiement n'a
 * aucun sens sur une liste de fournisseurs, et une barre unique partagée
 * afficherait partout des options mortes.
 */
const orderQuery = listQuery.extend({
  sort: z.enum(['recent', 'oldest', 'updated', 'amountDesc', 'amountAsc']).default('recent'),
  payment: z.enum(['paid', 'pending', 'refunded', 'partially_refunded', 'voided']).optional(),
  delivery: z.enum(['fulfilled', 'unfulfilled', 'partial', 'in_transit']).optional(),
});

/** Assemble la requête Shopify à partir de la recherche libre et des filtres. */
function buildOrderQuery(input: z.infer<typeof orderQuery>): string {
  return [
    toOrderQuery(input.q),
    input.payment ? `financial_status:${input.payment}` : '',
    input.delivery ? `fulfillment_status:${input.delivery}` : '',
  ]
    .filter(Boolean)
    .join(' AND ');
}

/**
 * Traduit une recherche libre en requête Shopify.
 *
 * Une chaîne qui ressemble à un email ou à un numéro de commande est envoyée
 * sur le champ correspondant ; le reste part en recherche plein texte. Sans ça,
 * chercher « #1042 » ne renverrait rien — Shopify n'indexe pas le dièse.
 */
function toOrderQuery(raw: string | undefined): string {
  const term = raw?.trim();
  if (!term) return '';

  if (term.includes('@')) return `email:${quoteSearchValue(term)}`;
  if (/^#?\d+$/.test(term)) return `name:${quoteSearchValue(term.startsWith('#') ? term : `#${term}`)}`;

  return quoteSearchValue(term);
}

function toCustomerQuery(raw: string | undefined): string {
  const term = raw?.trim();
  if (!term) return '';
  if (term.includes('@')) return `email:${quoteSearchValue(term)}`;
  return quoteSearchValue(term);
}

/** Message lisible pour une boutique déconnectée ou une erreur Shopify. */
function describeShopifyError(error: unknown): { status: number; message: string } {
  if (error instanceof ShopifyScopeError) {
    const needed = error.requiredAccess ? `« ${error.requiredAccess} »` : 'une autorisation absente';
    return {
      status: 409,
      message:
        `L’installation Shopify actuelle n’accorde pas ${needed}. Élargir la liste des ` +
        `autorisations ne suffit pas : le jeton d’accès garde celles obtenues le jour de ` +
        `l’installation. Réinstallez l’application depuis les Réglages pour les reprendre. ` +
        `Autorisations actuellement accordées : ${error.grantedScopes.join(', ') || 'aucune'}.`,
    };
  }

  if (error instanceof ShopifyError) {
    if (!error.status) {
      return {
        status: 409,
        message: 'Aucune boutique Shopify connectée. Réinstallez l’application depuis votre administration.',
      };
    }
    if (error.status === 401 || error.status === 403) {
      return {
        status: 409,
        message: 'L’autorisation Shopify n’est plus valide. Réinstallez l’application.',
      };
    }
    return { status: 502, message: `Shopify a répondu ${error.status} : ${error.message}` };
  }

  return { status: 502, message: error instanceof Error ? error.message : String(error) };
}

/** Encapsule un appel Shopify avec la traduction d'erreur commune. */
async function serveShopify<T>(
  request: FastifyRequest,
  reply: FastifyReply,
  label: string,
  run: (client: Awaited<ReturnType<typeof getShopifyClient>>) => Promise<T>,
) {
  try {
    const client = await getShopifyClient(request.session.merchantId);
    return await reply.send(await run(client));
  } catch (error) {
    const { status, message } = describeShopifyError(error);
    request.log.error({ err: error }, label);
    return reply.code(status).send({ error: message });
  }
}

export async function commerceRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireSession);

  /*
   * Comptes pour les pastilles de la navigation.
   *
   * Trois nombres que Shopify sait donner sans paginer (`ordersCount`,
   * `customersCount`, `productsCount`), plus les colis de notre base. Mis en
   * cache cinq minutes par marchand : la navigation se repeint à chaque
   * geste, et un carnet de commandes ne bouge pas à la seconde. Une pastille
   * en retard de cinq minutes informe ; trois appels Shopify par clic
   * factureraient.
   */
  const navCountsCache = new Map<string, { at: number; counts: Record<string, number> }>();

  app.get('/api/nav-counts', async (request, reply) => {
    const { merchantId } = request.session;

    const cached = navCountsCache.get(merchantId);
    if (cached && Date.now() - cached.at < 5 * 60_000) {
      return reply.send({ counts: cached.counts });
    }

    const counts: Record<string, number> = {};

    counts.tracking = await prisma.parcel.count({ where: { merchantId } });

    try {
      const client = await getShopifyClient(merchantId);
      const data = await client.request<{
        ordersCount: { count: number } | null;
        customersCount: { count: number } | null;
        productsCount: { count: number } | null;
      }>(/* GraphQL */ `
        query NavCounts {
          ordersCount(limit: 10000) {
            count
          }
          customersCount(limit: 10000) {
            count
          }
          productsCount(limit: 10000) {
            count
          }
        }
      `);

      counts.orders = data.ordersCount?.count ?? 0;
      counts.customers = data.customersCount?.count ?? 0;
      counts.catalog = data.productsCount?.count ?? 0;
    } catch (error) {
      // Boutique muette : les pastilles Shopify manquent, celles de la base
      // restent. Une navigation sans chiffre vaut mieux qu'une erreur.
      request.log.warn({ err: error }, 'Comptes de navigation indisponibles');
    }

    navCountsCache.set(merchantId, { at: Date.now(), counts });
    return reply.send({ counts });
  });

  /**
   * Déclinaisons du catalogue, pour choisir au lieu de saisir.
   *
   * Une demande de changement se jouait à la frappe : « 45 », « Blackened
   * Blue », « Nike Vomero Plus » — écrits de mémoire, donc parfois faux, et
   * envoyés tels quels à un atelier qui les lira à la lettre. Une couleur mal
   * orthographiée, c'est une paire qui part de travers.
   *
   * `scope` dit ce qu'on cherche : une taille et une couleur se cherchent
   * dans les déclinaisons d'un même modèle, un modèle se cherche dans tout le
   * catalogue. Les valeurs sont dédupliquées — proposer douze fois « 45 »
   * parce que douze modèles la portent n'aide personne.
   */
  app.get<{ Querystring: { q?: string; scope?: string; product?: string } }>(
    '/api/variant-options',
    async (request, reply) => {
      const scope = request.query.scope === 'PRODUCT' ? 'PRODUCT' : request.query.scope === 'COLOR' ? 'COLOR' : 'SIZE';
      const term = (request.query.q ?? '').trim();
      const product = (request.query.product ?? '').trim();

      try {
        const client = await getShopifyClient(request.session.merchantId);

        if (scope === 'PRODUCT') {
          const page = await listProducts(client, { query: term, limit: 30 });
          return reply.send({
            options: page.products.map((item) => ({
              value: item.title,
              detail: item.vendor ?? '',
              image: item.image,
              stock: item.totalInventory,
            })),
          });
        }

        /*
         * La couleur vit dans le titre du produit, pas dans la déclinaison.
         *
         * Sur ce catalogue — et c'est la règle chez les revendeurs de
         * sneakers — un coloris est un produit à part entière : « Nike Mind
         * 001 Blackened Blue » et « Nike Mind 001 Black Hyper Crimson » sont
         * deux fiches, dont les déclinaisons ne portent que la pointure. La
         * chercher dans `variantTitle` ne trouvait donc jamais rien.
         *
         * On repart du modèle en retirant son coloris : les trois premiers
         * mots du titre suffisent à retrouver la famille (« Nike Mind 001 »),
         * et chaque produit frère donne son coloris — ce que son titre porte
         * au-delà du préfixe commun.
         */
        if (scope === 'COLOR') {
          const family = product.split(/\s+/).slice(0, 3).join(' ');
          const page = await listProducts(client, {
            query: family ? `title:${quoteSearchValue(family)}*` : term,
            limit: 60,
          });

          const seen = new Map<string, { value: string; detail: string; image: string | null; stock: number | null }>();

          for (const item of page.products) {
            // Le coloris est ce qui reste une fois le modèle retiré. Si le
            // titre ne commence pas par la famille attendue, on garde le titre
            // entier : mieux vaut une entrée trop longue qu'une entrée fausse.
            const color = item.title.toLowerCase().startsWith(family.toLowerCase())
              ? item.title.slice(family.length).trim()
              : item.title;

            if (!color) continue;
            if (term && !color.toLowerCase().includes(term.toLowerCase())) continue;
            if (seen.has(color)) continue;

            seen.set(color, {
              value: color,
              detail: item.vendor ?? '',
              image: item.image,
              stock: item.totalInventory,
            });
          }

          return reply.send({ options: [...seen.values()] });
        }

        /*
         * Taille : là, ce sont bien les déclinaisons du produit. On part du
         * modèle de la commande quand on le connaît, sinon de la recherche
         * libre — sans aucun des deux il n'y a rien à proposer, et mieux vaut
         * une liste vide qu'un échantillon arbitraire du catalogue.
         */
        const query = product
          ? `product_title:${quoteSearchValue(product)}`
          : term
            ? quoteSearchValue(term)
            : '';

        if (!query) return reply.send({ options: [] });

        const variants = await listVariants(client, { query, limit: 100 });

        const seen = new Map<string, { value: string; detail: string; image: string | null; stock: number | null }>();

        for (const variant of variants) {
          // « Default Title » est la déclinaison fantôme d'un produit qui n'en
          // a pas : la proposer ferait choisir une taille qui n'existe pas.
          const raw = String(variant.variantTitle ?? '').trim();
          if (!raw || raw === 'Default Title') continue;

          // Une déclinaison composée — « Blackened Blue / 45 » — garde son
          // segment numérique ; sinon le libellé entier est la pointure.
          const parts = raw.split('/').map((part) => part.trim()).filter(Boolean);
          const value = parts.find((part) => /^\d/.test(part)) ?? parts[0] ?? '';

          if (!value) continue;
          if (term && !value.toLowerCase().includes(term.toLowerCase())) continue;

          const existing = seen.get(value);
          if (existing) {
            // Le stock s'additionne : la même taille peut exister sur
            // plusieurs fiches, et c'est le total qui dit si l'échange tient.
            existing.stock = (existing.stock ?? 0) + (variant.inventoryQuantity ?? 0);
            continue;
          }

          seen.set(value, {
            value,
            detail: variant.productTitle,
            image: variant.image,
            stock: variant.inventoryQuantity,
          });
        }

        return reply.send({
          options: [...seen.values()].sort((a, b) =>
            a.value.localeCompare(b.value, 'fr', { numeric: true }),
          ),
        });
      } catch (error) {
        request.log.warn({ err: error }, 'Déclinaisons indisponibles');
        return reply.send({ options: [], error: 'Catalogue indisponible.' });
      }
    },
  );

  app.get('/api/orders', async (request, reply) => {
    const parsed = orderQuery.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Paramètres invalides', details: parsed.error.issues });
    }

    try {
      const client = await getShopifyClient(request.session.merchantId);
      const page = await listOrders(client, {
        query: buildOrderQuery(parsed.data),
        limit: parsed.data.limit,
        cursor: parsed.data.cursor ?? null,
        sort: parsed.data.sort,
      });
      return reply.send(page);
    } catch (error) {
      const { status, message } = describeShopifyError(error);
      request.log.error({ err: error }, 'Listing des commandes en échec');
      return reply.code(status).send({ error: message });
    }
  });

  app.get<{ Params: { id: string } }>('/api/orders/:id', async (request, reply) => {
    try {
      const client = await getShopifyClient(request.session.merchantId);
      // L'identifiant circule sous sa forme courte dans l'URL ; Shopify attend
      // un GID complet.
      const gid = request.params.id.startsWith('gid://')
        ? request.params.id
        : `gid://shopify/Order/${request.params.id}`;

      const order = await getOrderById(client, gid);
      if (!order) return reply.code(404).send({ error: 'Commande introuvable' });

      /*
       * Ce que l'outil sait de cette commande, au-delà de Shopify.
       *
       * La fiche affichait la commande nue : impossible d'y voir les mails du
       * client à son sujet, les colis saisis par l'atelier, ou les demandes de
       * changement en cours — donc impossible d'y décider quoi que ce soit.
       * Trois lectures de base, servies avec la commande.
       */
      const { merchantId } = request.session;

      const [tickets, parcels, changes] = await Promise.all([
        prisma.ticket.findMany({
          where: { merchantId, shopifyOrderId: gid, isHistorical: false },
          orderBy: { lastMessageAt: 'desc' },
          take: 5,
          select: {
            id: true,
            subject: true,
            status: true,
            intent: true,
            lastMessageAt: true,
          },
        }),
        prisma.parcel.findMany({
          where: { merchantId, shopifyOrderId: gid },
          orderBy: { index: 'asc' },
          select: {
            id: true,
            trackingNumber: true,
            carrier: true,
            index: true,
            total: true,
            photoMime: true,
          },
        }),
        prisma.supplierAlert.findMany({
          where: { merchantId, shopifyOrderId: gid },
          orderBy: { createdAt: 'desc' },
          take: 5,
          select: {
            id: true,
            kind: true,
            status: true,
            beforeValue: true,
            afterValue: true,
            message: true,
            supplierNote: true,
            createdAt: true,
            supplier: { select: { name: true } },
          },
        }),
      ]);

      return reply.send({ order, tickets, parcels, changes });
    } catch (error) {
      const { status, message } = describeShopifyError(error);
      request.log.error({ err: error }, 'Lecture de commande en échec');
      return reply.code(status).send({ error: message });
    }
  });

  app.get('/api/customers', async (request, reply) => {
    const parsed = listQuery.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Paramètres invalides', details: parsed.error.issues });
    }

    try {
      const client = await getShopifyClient(request.session.merchantId);
      const page = await listCustomers(client, {
        query: toCustomerQuery(parsed.data.q),
        limit: parsed.data.limit,
        cursor: parsed.data.cursor ?? null,
      });
      return reply.send(page);
    } catch (error) {
      const { status, message } = describeShopifyError(error);
      request.log.error({ err: error }, 'Listing des clients en échec');
      return reply.code(status).send({ error: message });
    }
  });

  /**
   * Fiche client complète.
   *
   * Le seul écran qui croise les quatre sources : commandes Shopify, tickets
   * SAV, remboursements et colis. Sans lui, répondre à « ma commande n'est
   * jamais arrivée » demande d'ouvrir cinq écrans et de noter les résultats
   * sur un papier — c'est ce que l'administration Shopify ne fait pas et qui
   * justifie cet outil.
   *
   * La clé est l'email : c'est le seul identifiant présent des deux côtés, un
   * ticket n'ayant pas d'identifiant client Shopify.
   */
  app.get<{ Querystring: { email?: string } }>('/api/customer-sheet', async (request, reply) => {
    const parsed = z.object({ email: z.string().email().max(200) }).safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: 'Adresse email requise' });

    const { merchantId } = request.session;
    const email = parsed.data.email.toLowerCase();

    // Les données internes d'abord : elles répondent même si Shopify est
    // injoignable, et c'est déjà la moitié de la fiche.
    const [tickets, refunds] = await Promise.all([
      prisma.ticket.findMany({
        where: { merchantId, customerEmail: email },
        orderBy: { lastMessageAt: 'desc' },
        take: 25,
        select: {
          id: true,
          subject: true,
          status: true,
          intent: true,
          orderName: true,
          lastMessageAt: true,
          createdAt: true,
          assignedTo: { select: { name: true, email: true } },
        },
      }),
      prisma.refund.findMany({
        where: { merchantId, ticket: { customerEmail: email } },
        orderBy: { createdAt: 'desc' },
        take: 25,
        select: {
          id: true,
          amount: true,
          currency: true,
          reason: true,
          kind: true,
          status: true,
          shopifyOrderId: true,
          createdAt: true,
        },
      }),
    ]);

    let customer = null;
    let orders: Awaited<ReturnType<typeof listOrders>>['orders'] = [];
    let shopifyError: string | null = null;

    try {
      const client = await getShopifyClient(merchantId);
      const page = await listOrders(client, {
        query: `email:${quoteSearchValue(email)}`,
        limit: 25,
        sort: 'recent',
      });

      orders = page.orders;
      // L'identité vient de la commande la plus récente : chercher le client
      // séparément coûterait un appel de plus pour la même information.
      customer = page.orders[0]?.customer ?? null;
    } catch (error) {
      shopifyError = describeShopifyError(error).message;
      request.log.warn({ err: error }, 'Fiche client : lecture Shopify en échec');
    }

    const parcels = orders.length
      ? await prisma.parcel.findMany({
          where: { merchantId, shopifyOrderId: { in: orders.map((order) => order.id) } },
          orderBy: [{ orderName: 'asc' }, { index: 'asc' }],
          select: {
            id: true,
            shopifyOrderId: true,
            orderName: true,
            trackingNumber: true,
            carrier: true,
            index: true,
            total: true,
            photoMime: true,
            photoTakenAt: true,
            updatedAt: true,
          },
        })
      : [];

    // Les retours du client : la preuve au dossier. Par adresse email, et à
    // défaut par numéro de commande — un dossier ouvert sans email doit
    // quand même apparaître sur la fiche.
    const returns = await prisma.returnCase.findMany({
      where: {
        merchantId,
        OR: [
          { customerEmail: email },
          ...(orders.length ? [{ orderName: { in: orders.map((order) => order.name) } }] : []),
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: 25,
      omit: { photoData: true },
    });

    const spent = orders.reduce((sum, order) => sum + Number(order.totalPrice ?? 0), 0);

    return reply.send({
      email,
      customer,
      shopifyError,
      orders,
      tickets,
      refunds: refunds.map((refund) => ({ ...refund, amount: refund.amount.toString() })),
      parcels: parcels.map((parcel) => ({
        ...parcel,
        hasPhoto: Boolean(parcel.photoMime),
        photoMime: undefined,
      })),
      returns: returns.map(({ photoMime, ...item }) => ({
        ...item,
        hasPhoto: Boolean(photoMime),
      })),
      // Repères calculés ici plutôt qu'à l'écran : ce sont des chiffres, pas
      // de la mise en forme, et l'agent les cite au client.
      totals: {
        orders: orders.length,
        spent: spent.toFixed(2),
        currency: orders[0]?.currency ?? null,
        tickets: tickets.length,
        openTickets: tickets.filter(
          (ticket) => ticket.status !== 'CLOSED' && ticket.status !== 'AUTO_SENT',
        ).length,
        refunded: refunds
          .filter((refund) => refund.status === 'COMPLETED')
          .reduce((sum, refund) => sum + Number(refund.amount), 0)
          .toFixed(2),
      },
    });
  });

  app.get('/api/products', async (request, reply) => {
    const parsed = listQuery.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: 'Paramètres invalides' });

    return serveShopify(request, reply, 'Listing des produits en échec', (client) =>
      listProducts(client, {
        query: parsed.data.q?.trim() ?? '',
        limit: parsed.data.limit,
        cursor: parsed.data.cursor ?? null,
      }),
    );
  });

  app.get('/api/collections', async (request, reply) => {
    const parsed = listQuery.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: 'Paramètres invalides' });

    return serveShopify(request, reply, 'Listing des collections en échec', (client) =>
      listCollections(client, {
        query: parsed.data.q?.trim() ?? '',
        limit: parsed.data.limit,
        cursor: parsed.data.cursor ?? null,
      }),
    );
  });

  /**
   * Colis en cours d'acheminement.
   *
   * Construit à partir des commandes plutôt que d'un service de suivi : ce sont
   * les données que Shopify détient déjà, et le SAV a besoin du couple
   * commande + client, pas d'un numéro isolé.
   */
  app.get('/api/tracking', async (request, reply) => {
    const parsed = listQuery.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: 'Paramètres invalides' });

    // Gabarit de lien choisi par le marchand : certains transporteurs ne
    // renvoient pas d'URL à Shopify, et un numéro sans lien oblige l'agent à
    // aller le coller à la main sur le site du transporteur.
    const merchant = await prisma.merchant.findUnique({
      where: { id: request.session.merchantId },
      select: { trackingUrlTemplate: true },
    });

    const template = merchant?.trackingUrlTemplate?.trim() || null;

    return serveShopify(request, reply, 'Listing du suivi en échec', async (client) => {
      const page = await listOrders(client, {
        // Une commande livrée n'appelle plus d'action ; une non expédiée n'a pas
        // encore de numéro de suivi à afficher.
        query: 'fulfillment_status:shipped OR fulfillment_status:partial',
        limit: parsed.data.limit,
        cursor: parsed.data.cursor ?? null,
      });

      // Les numéros connus de 17TRACK viennent aussi des colis saisis par le
      // fournisseur, que Shopify ignore.
      const numbers = page.orders
        .flatMap((order) => order.fulfillments.map((f) => f.trackingNumber))
        .filter(Boolean) as string[];

      await registerTracking(numbers);
      const tracking = await getTracking(numbers);

      const shipments = page.orders.flatMap((order) =>
        order.fulfillments
          .filter((fulfillment) => fulfillment.trackingNumber)
          .map((fulfillment) => ({
            orderId: order.id,
            orderName: order.name,
            customer: order.customer?.displayName ?? order.customer?.email ?? null,
            status: fulfillment.status,
            carrier: fulfillment.trackingCompany,
            trackingNumber: fulfillment.trackingNumber,
            trackingUrl:
              template && fulfillment.trackingNumber
                ? template.replace('{tracking}', encodeURIComponent(fulfillment.trackingNumber))
                : fulfillment.trackingUrl,
            estimatedDeliveryAt: fulfillment.estimatedDeliveryAt,
            updatedAt: fulfillment.updatedAt,
            // État réel du transporteur quand 17TRACK est configuré : celui de
            // Shopify reste figé à l'expédition pendant tout l'acheminement.
            liveStatus: fulfillment.trackingNumber
              ? (tracking.get(fulfillment.trackingNumber)?.status ?? null)
              : null,
            lastEvent: fulfillment.trackingNumber
              ? (tracking.get(fulfillment.trackingNumber)?.events?.[0] ?? null)
              : null,
            city: order.shippingAddress?.city ?? null,
            country: order.shippingAddress?.country ?? null,
          })),
      );

      return {
        shipments,
        labels: TRACK_STATUS_LABELS,
        cursor: page.cursor,
        hasNextPage: page.hasNextPage,
      };
    });
  });

  /**
   * Export du carnet de commandes pour Excel.
   *
   * Même fichier que celui du fournisseur, servi ici à l'agent : une seule
   * définition de colonnes, donc les deux ne divergent jamais.
   */
  app.get<{ Querystring: { since?: string; until?: string; limit?: string } }>(
    '/api/orders/export.csv',
    async (request, reply) => {
      const parsed = z
        .object({
          since: z.string().date().optional(),
          until: z.string().date().optional(),
          limit: z.coerce.number().int().min(1).max(250).default(100),
        })
        .safeParse(request.query);

      if (!parsed.success) return reply.code(400).send({ error: 'Période invalide' });

      try {
        const client = await getShopifyClient(request.session.merchantId);

        // Sans période : les dernières 24 heures, le geste du matin.
        const query =
          !parsed.data.since && !parsed.data.until
            ? `created_at:>=${new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()}`
            : [
                parsed.data.since ? `created_at:>=${parsed.data.since}` : '',
                parsed.data.until ? `created_at:<=${parsed.data.until}T23:59:59Z` : '',
              ]
                .filter(Boolean)
                .join(' AND ');

        const page = await listOrders(client, { query, limit: parsed.data.limit, cursor: null });

        const parcels = await prisma.parcel.findMany({
          where: {
            merchantId: request.session.merchantId,
            shopifyOrderId: { in: page.orders.map((order) => order.id) },
          },
          orderBy: { index: 'asc' },
          select: {
            id: true,
            shopifyOrderId: true,
            trackingNumber: true,
            index: true,
            total: true,
            photoMime: true,
          },
        });

        const csv = ordersToCsv(
          page.orders.map((order) => ({
            order,
            parcels: parcels
              .filter((parcel) => parcel.shopifyOrderId === order.id)
              .map((parcel) => ({
                index: parcel.index,
                total: parcel.total,
                trackingNumber: parcel.trackingNumber,
                photoUrl: parcel.photoMime ? `/api/parcels/${parcel.id}/photo` : null,
              })),
          })),
          env.APP_URL,
        );

        const stamp = new Date().toISOString().slice(0, 10);

        return reply
          .type('text/csv; charset=utf-8')
          .header('Content-Disposition', `attachment; filename="commandes-${stamp}.csv"`)
          .send(csv);
      } catch (error) {
        const { status, message } = describeShopifyError(error);
        request.log.error({ err: error }, 'Export des commandes en échec');
        return reply.code(status).send({ error: message });
      }
    },
  );

  /**
   * Litiges Shopify, avec de quoi y répondre.
   *
   * Un litige non contesté est débité automatiquement à l'échéance. Ce que la
   * banque attend, c'est une preuve de livraison : numéro de suivi, statut du
   * colis et adresse. Ces trois éléments existent déjà dans l'application —
   * les rassembler ici évite de les recopier à la main sous la pression du
   * délai.
   */
  /** Même feuille de préparation, côté agent. */
  app.get<{ Querystring: { since?: string; until?: string; limit?: string } }>(
    '/api/orders/export.xlsx',
    async (request, reply) => {
      const parsed = z
        .object({
          since: z.string().date().optional(),
          until: z.string().date().optional(),
          limit: z.coerce.number().int().min(1).max(250).default(100),
        })
        .safeParse(request.query);

      if (!parsed.success) return reply.code(400).send({ error: 'Période invalide' });

      try {
        const [client, merchant] = await Promise.all([
          getShopifyClient(request.session.merchantId),
          prisma.merchant.findUniqueOrThrow({
            where: { id: request.session.merchantId },
            select: { shopDomain: true },
          }),
        ]);

        const query =
          !parsed.data.since && !parsed.data.until
            ? `created_at:>=${new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()}`
            : [
                parsed.data.since ? `created_at:>=${parsed.data.since}` : '',
                parsed.data.until ? `created_at:<=${parsed.data.until}T23:59:59Z` : '',
              ]
                .filter(Boolean)
                .join(' AND ');

        const page = await listOrders(client, { query, limit: parsed.data.limit, cursor: null });

        const parcels = await prisma.parcel.findMany({
          where: {
            merchantId: request.session.merchantId,
            shopifyOrderId: { in: page.orders.map((order) => order.id) },
          },
          orderBy: { index: 'asc' },
          select: { shopifyOrderId: true, trackingNumber: true, index: true, total: true },
        });

        const file = await ordersToXlsx(
          page.orders.map((order) => ({
            order,
            storeUrl: `https://${merchant.shopDomain}`,
            parcels: parcels
              .filter((parcel) => parcel.shopifyOrderId === order.id)
              .map((parcel) => ({
                index: parcel.index,
                total: parcel.total,
                trackingNumber: parcel.trackingNumber,
              })),
          })),
        );

        const stamp = new Date().toISOString().slice(0, 10);

        return reply
          .type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
          .header('Content-Disposition', `attachment; filename="commandes-${stamp}.xlsx"`)
          .send(file);
      } catch (error) {
        const { status, message } = describeShopifyError(error);
        request.log.error({ err: error }, 'Export Excel des commandes en échec');
        return reply.code(status).send({ error: message });
      }
    },
  );

  app.get('/api/disputes', async (request, reply) =>
    serveShopify(request, reply, 'Listing des litiges en échec', async (client) => {
      const disputes = await listDisputes(client);

      // Rapprochement par numéro de commande : c'est la seule clé commune
      // entre un litige Shopify Payments et nos colis.
      const orderNames = disputes.map((dispute) => dispute.orderName).filter(Boolean) as string[];

      const parcels = orderNames.length
        ? await prisma.parcel.findMany({
            where: { merchantId: request.session.merchantId, orderName: { in: orderNames } },
            orderBy: { index: 'asc' },
            select: {
              id: true,
              orderName: true,
              trackingNumber: true,
              carrier: true,
              index: true,
              total: true,
              photoMime: true,
            },
          })
        : [];

      const tracking = await getTracking(parcels.map((parcel) => parcel.trackingNumber));

      return {
        disputes: disputes.map((dispute) => {
          const own = parcels.filter((parcel) => parcel.orderName === dispute.orderName);

          return {
            ...dispute,
            // Jours restants : l'information qui décide de l'ordre de travail
            // de la journée. Négatif = échéance dépassée.
            daysLeft: dispute.evidenceDueBy
              ? Math.ceil(
                  (new Date(dispute.evidenceDueBy).getTime() - Date.now()) / (24 * 60 * 60 * 1000),
                )
              : null,
            evidence: own.map((parcel) => {
              const track = tracking.get(parcel.trackingNumber);
              return {
                parcelId: parcel.id,
                index: parcel.index,
                total: parcel.total,
                trackingNumber: parcel.trackingNumber,
                carrier: track?.carrier ?? parcel.carrier,
                status: track?.status ?? null,
                deliveredAt: track?.deliveredAt ?? null,
                hasPhoto: Boolean(parcel.photoMime),
              };
            }),
          };
        }),
      };
    }),
  );

  /**
   * Suivi détaillé d'un colis.
   *
   * Séparé de la liste : la chronologie complète ne sert qu'à l'écran ouvert,
   * et 17TRACK facture à l'appel.
   */
  app.get<{ Params: { number: string } }>('/api/tracking/:number', async (request, reply) => {
    const number = request.params.number.trim();

    // Le numéro doit appartenir au marchand : sans ce contrôle, l'application
    // deviendrait un service de suivi ouvert à tous. Deux sources légitimes —
    // les colis saisis par le fournisseur, et les expéditions Shopify. Ne
    // vérifier que la première renvoyait « Colis inconnu » pour tout numéro
    // venu de Shopify, c'est-à-dire pour presque tous.
    const parcel = await prisma.parcel.findFirst({
      where: { merchantId: request.session.merchantId, trackingNumber: number },
      select: { id: true, orderName: true, carrier: true, index: true, total: true },
    });

    let owned = parcel !== null;
    let orderName = parcel?.orderName ?? null;

    if (!owned) {
      try {
        const client = await getShopifyClient(request.session.merchantId);
        // Shopify ne cherche pas par numéro de suivi : on relit les commandes
        // expédiées récentes et on y cherche le numéro. Cinquante commandes
        // couvrent la fenêtre où un suivi se consulte réellement.
        const page = await listOrders(client, {
          query: 'fulfillment_status:shipped OR fulfillment_status:partial',
          limit: 50,
          cursor: null,
        });

        for (const order of page.orders) {
          if (order.fulfillments.some((f) => f.trackingNumber === number)) {
            owned = true;
            orderName = order.name;
            break;
          }
        }
      } catch {
        // Shopify muet : on refuse plutôt que d'ouvrir le suivi sans preuve
        // d'appartenance.
      }
    }

    if (!owned) return reply.code(404).send({ error: 'Colis inconnu' });

    await registerTracking([number]);
    const track = (await getTracking([number])).get(number) ?? null;

    return reply.send({
      parcel: parcel ?? { orderName, carrier: null, index: 1, total: 1 },
      track,
      labels: TRACK_STATUS_LABELS,
    });
  });
}
