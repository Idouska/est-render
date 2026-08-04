import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { env } from '../config/env.ts';
import { prisma } from '../lib/prisma.ts';
import { ordersToCsv } from '../services/export/ordersCsv.ts';
import { requireSession } from '../plugins/auth.ts';
import { getShopifyClient, ShopifyError, ShopifyScopeError } from '../services/shopify/client.ts';
import { listCollections, listDisputes, listProducts } from '../services/shopify/catalog.ts';
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

      return reply.send({ order });
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
            city: order.shippingAddress?.city ?? null,
            country: order.shippingAddress?.country ?? null,
          })),
      );

      return { shipments, cursor: page.cursor, hasNextPage: page.hasNextPage };
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

  app.get('/api/disputes', async (request, reply) =>
    serveShopify(request, reply, 'Listing des litiges en échec', async (client) => ({
      disputes: await listDisputes(client),
    })),
  );
}
