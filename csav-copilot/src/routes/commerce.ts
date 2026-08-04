import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireSession } from '../plugins/auth.ts';
import { getShopifyClient, ShopifyError } from '../services/shopify/client.ts';
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

export async function commerceRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireSession);

  app.get('/api/orders', async (request, reply) => {
    const parsed = listQuery.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Paramètres invalides', details: parsed.error.issues });
    }

    try {
      const client = await getShopifyClient(request.session.merchantId);
      const page = await listOrders(client, {
        query: toOrderQuery(parsed.data.q),
        limit: parsed.data.limit,
        cursor: parsed.data.cursor ?? null,
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
}
