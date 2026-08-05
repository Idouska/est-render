import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { env } from '../config/env.ts';
import { recordAudit } from '../lib/audit.ts';
import { prisma } from '../lib/prisma.ts';
import { requirePermission, requireSession } from '../plugins/auth.ts';
import { accessibleMerchantIds, listShopsFor } from './shops.ts';
import { sendDraft, updateDraftBody } from '../services/gmail/drafts.ts';
import { sendPlainEmail } from '../services/gmail/send.ts';
import { getShopifyClient, ShopifyError } from '../services/shopify/client.ts';
import { listVariants } from '../services/shopify/catalog.ts';
import { getOrderById, quoteSearchValue, searchOrders } from '../services/shopify/orders.ts';

const TICKET_STATUSES = [
  'NEW',
  'PROCESSING',
  'DRAFT_READY',
  'NEEDS_REVIEW',
  'AWAITING_SUPPLIER',
  'AUTO_SENT',
  'CLOSED',
  'FAILED',
] as const;

const listQuery = z.object({
  status: z.enum(TICKET_STATUSES).optional(),
  /** Recherche libre sur l'objet, le client et le numéro de commande. */
  q: z.string().max(200).optional(),
  intent: z
    .enum(['WISMO', 'RETURN', 'DISPUTE', 'REFUND', 'PRODUCT_QUESTION', 'POSITIVE', 'OTHER'])
    .optional(),
  /** Identifiant d'agent, ou `none` pour les tickets que personne n'a pris. */
  assignee: z.string().max(60).optional(),
  /** Ancienneté minimale en jours — le filtre « urgents ». */
  minAgeDays: z.coerce.number().int().min(0).max(365).optional(),
  /** Tickets sans commande rattachée : l'agent doit la retrouver à la main. */
  unlinked: z.coerce.boolean().optional(),
  /** Boîte mail d'origine — utile quand `contact@` et `sav@` cohabitent. */
  mailbox: z.string().max(60).optional(),
  /** `all` élargit la file à toutes les boutiques du groupe. */
  scope: z.enum(['shop', 'all']).default('shop'),
  sort: z.enum(['oldest', 'newest', 'confidence']).default('newest'),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

/**
 * Traduit les filtres de la file en clause Prisma.
 *
 * Isolée parce que la liste et les compteurs doivent appliquer exactement les
 * mêmes règles : un compteur qui ne correspond pas à ce que la liste affiche
 * est pire que pas de compteur du tout.
 */
function buildTicketWhere(
  merchantIds: string[],
  filters: z.infer<typeof listQuery>,
  options: { withStatus: boolean },
) {
  const term = filters.q?.trim();

  return {
    // Une liste, jamais un identifiant venu du client : `merchantIds` est
    // toujours calculé serveur depuis la session.
    merchantId: merchantIds.length === 1 ? merchantIds[0] : { in: merchantIds },
    ...(options.withStatus && filters.status ? { status: filters.status } : {}),
    ...(filters.intent ? { intent: filters.intent } : {}),
    ...(filters.assignee === 'none'
      ? { assignedToId: null }
      : filters.assignee
        ? { assignedToId: filters.assignee }
        : {}),
    ...(filters.minAgeDays !== undefined
      ? {
          // L'ancienneté se compte depuis la dernière prise de parole, pas
          // depuis l'ouverture : un ticket relancé hier n'est pas en retard de
          // dix jours.
          lastMessageAt: {
            lte: new Date(Date.now() - filters.minAgeDays * 24 * 60 * 60 * 1000),
          },
        }
      : {}),
    ...(filters.unlinked ? { shopifyOrderId: null } : {}),
    ...(filters.mailbox ? { mailboxId: filters.mailbox } : {}),
    ...(term
      ? {
          OR: [
            { subject: { contains: term, mode: 'insensitive' as const } },
            { customerEmail: { contains: term, mode: 'insensitive' as const } },
            { customerName: { contains: term, mode: 'insensitive' as const } },
            { orderName: { contains: term, mode: 'insensitive' as const } },
          ],
        }
      : {}),
  };
}

export async function ticketRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireSession);

  // Identité du marchand connecté et état des deux intégrations : c'est ce que
  // le dashboard affiche en barre haute.
  app.get('/api/me', async (request, reply) => {
    const { merchantId, userId } = request.session;

    const merchant = await prisma.merchant.findUnique({
      where: { id: merchantId },
      include: {
        shopify: { select: { installedAt: true, uninstalledAt: true, scopes: true } },
        mailboxes: {
          orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
          select: { id: true, emailAddress: true, label: true, isDefault: true, watchExpiration: true },
        },
        users: { where: { id: userId }, select: { email: true, name: true, role: true } },
      },
    });

    if (!merchant) return reply.code(404).send({ error: 'Marchand introuvable' });

    return reply.send({
      merchant: {
        id: merchant.id,
        shopDomain: merchant.shopDomain,
        name: merchant.name,
        brandName: merchant.brandName,
        logoUrl: merchant.logoUrl,
        hasLogo: Boolean(merchant.logoMime),
        autoSendEnabled: merchant.autoSendEnabled,
        autoSendThreshold: merchant.autoSendThreshold,
      },
      user: merchant.users[0]
        ? { ...merchant.users[0], id: userId, role: request.session.role }
        : { id: userId, email: request.session.email, name: null, role: request.session.role },
      shopify: {
        connected: Boolean(merchant.shopify && !merchant.shopify.uninstalledAt),
        simulated: env.SHOPIFY_MOCK,
      },
      gmail: {
        connected: merchant.mailboxes.length > 0,
        // Adresse de la boîte principale, pour la barre haute.
        emailAddress: merchant.mailboxes[0]?.emailAddress ?? null,
        mailboxes: merchant.mailboxes.map((mailbox) => ({
          id: mailbox.id,
          emailAddress: mailbox.emailAddress,
          label: mailbox.label,
          isDefault: mailbox.isDefault,
          watchActive: Boolean(mailbox.watchExpiration && mailbox.watchExpiration > new Date()),
        })),
        // Une seule boîte muette suffit à faire disparaître du courrier sans
        // que rien ne le signale : l'alerte porte sur l'ensemble.
        watchActive: merchant.mailboxes.every(
          (mailbox) => mailbox.watchExpiration && mailbox.watchExpiration > new Date(),
        ),
      },
    });
  });

  // File de tickets + indicateurs du dashboard.
  app.get('/api/tickets', async (request, reply) => {
    const query = listQuery.safeParse(request.query);
    if (!query.success) {
      return reply.code(400).send({ error: 'Paramètres invalides', details: query.error.issues });
    }

    const { merchantId, email } = request.session;
    const { cursor, limit, sort } = query.data;

    const merchantIds =
      query.data.scope === 'all'
        ? await accessibleMerchantIds({ merchantId, email })
        : [merchantId];

    const orderBy =
      sort === 'oldest'
        ? ({ lastMessageAt: 'asc' } as const)
        : sort === 'confidence'
          ? ({ intentConfidence: 'asc' } as const)
          : ({ lastMessageAt: 'desc' } as const);

    const [tickets, byStatus] = await Promise.all([
      prisma.ticket.findMany({
        where: buildTicketWhere(merchantIds, query.data, { withStatus: true }),
        orderBy,
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        select: {
          id: true,
          subject: true,
          customerEmail: true,
          customerName: true,
          intent: true,
          intentConfidence: true,
          status: true,
          orderName: true,
          shopifyOrderId: true,
          lastMessageAt: true,
          createdAt: true,
          assignedToId: true,
          assignedTo: { select: { id: true, name: true, email: true } },
          mailbox: { select: { id: true, emailAddress: true, label: true } },
          merchantId: true,
        },
      }),
      // Compteurs calculés sur les mêmes filtres, statut exclu : sinon chaque
      // onglet afficherait son propre nombre et jamais celui des autres.
      prisma.ticket.groupBy({
        by: ['status'],
        where: buildTicketWhere(merchantIds, query.data, { withStatus: false }),
        _count: true,
      }),
    ]);

    const hasMore = tickets.length > limit;
    if (hasMore) tickets.pop();

    const counts = Object.fromEntries(byStatus.map((row) => [row.status, row._count]));

    return reply.send({
      tickets,
      counts: { ...counts, ALL: byStatus.reduce((sum, row) => sum + row._count, 0) },
      nextCursor: hasMore ? tickets[tickets.length - 1]?.id : null,
    });
  });

  /**
   * Assignation d'un ticket.
   *
   * `reply` et non `configure` : prendre un ticket fait partie du travail
   * quotidien d'un agent, lui demander un superviseur pour ça bloquerait la
   * file entière dès que personne n'est disponible.
   */
  app.patch<{ Params: { id: string } }>(
    '/api/tickets/:id/assign',
    { preHandler: requirePermission('reply') },
    async (request, reply) => {
      const parsed = z
        .object({ userId: z.string().min(1).nullable() })
        .safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: 'Agent invalide' });

      const { merchantId, userId: actorId } = request.session;

      const ticket = await prisma.ticket.findFirst({
        where: { id: request.params.id, merchantId },
        select: { id: true },
      });
      if (!ticket) return reply.code(404).send({ error: 'Ticket introuvable' });

      // L'agent visé doit appartenir à cette boutique et être actif : sans ce
      // contrôle, un identifiant d'un autre marchand passerait.
      if (parsed.data.userId) {
        const target = await prisma.user.findFirst({
          where: { id: parsed.data.userId, merchantId, active: true },
          select: { id: true },
        });
        if (!target) {
          return reply.code(400).send({ error: 'Cet agent n’existe pas sur cette boutique.' });
        }
      }

      const updated = await prisma.ticket.update({
        where: { id: ticket.id },
        data: { assignedToId: parsed.data.userId },
        select: { assignedTo: { select: { id: true, name: true, email: true } } },
      });

      await recordAudit({
        merchantId,
        actorType: 'USER',
        actorId,
        action: parsed.data.userId ? 'ticket.assigned' : 'ticket.unassigned',
        targetType: 'Ticket',
        targetId: ticket.id,
        metadata: { userId: parsed.data.userId },
        ipAddress: request.ip,
      });

      return reply.send({ assignedTo: updated.assignedTo });
    },
  );

  /**
   * Remplacements possibles pour la commande rattachée au ticket.
   *
   * Croisement ticket → commande → catalogue : c'est la question que l'agent
   * se pose devant une rupture, et la seule réponse utile est « quoi d'autre,
   * en stock, tout de suite ».
   */
  app.get<{ Params: { id: string } }>('/api/tickets/:id/substitutions', async (request, reply) => {
    const { merchantId } = request.session;

    const ticket = await prisma.ticket.findFirst({
      where: { id: request.params.id, merchantId },
      select: { shopifyOrderId: true },
    });

    if (!ticket) return reply.code(404).send({ error: 'Ticket introuvable' });
    if (!ticket.shopifyOrderId) {
      return reply.send({
        options: [],
        reason: 'Aucune commande rattachée : impossible de savoir quoi remplacer.',
      });
    }

    try {
      const shopify = await getShopifyClient(merchantId);
      const order = await getOrderById(shopify, ticket.shopifyOrderId);

      const titles = [...new Set(order?.lineItems.map((line) => line.title) ?? [])];
      if (titles.length === 0) {
        return reply.send({ options: [], reason: 'Cette commande ne contient aucun article.' });
      }

      // Un seul appel plutôt qu'un par article : les titres partagent le plus
      // souvent la même gamme, et Shopify limite le débit des requêtes.
      const query = titles.map((title) => `title:*${title.split(/\s+/)[0]}*`).join(' OR ');
      const options = await listVariants(shopify, { query });

      return reply.send({
        options: options.filter((option) => option.availableForSale),
        orderedTitles: titles,
      });
    } catch (error) {
      request.log.warn({ err: error }, 'Recherche de substitution en échec');
      return reply.code(502).send({
        error:
          error instanceof ShopifyError
            ? 'Catalogue indisponible : la boutique Shopify n’a pas répondu.'
            : 'Catalogue indisponible.',
      });
    }
  });

  /**
   * Vue d'ensemble du groupe : une carte par boutique.
   *
   * Ce qu'un exploitant de plusieurs boutiques regarde le matin — où ça brûle,
   * et pas seulement combien il y a de tickets. D'où « en retard » et « litiges »
   * en évidence : ce sont les deux chiffres qui coûtent de l'argent.
   */
  app.get('/api/overview', async (request, reply) => {
    const { merchantId, email } = request.session;
    const shops = await listShopsFor(merchantId, email);
    const ids = shops.length > 0 ? shops.map((shop) => shop.id) : [merchantId];

    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const lateBefore = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);

    const OPEN = ['NEW', 'PROCESSING', 'DRAFT_READY', 'NEEDS_REVIEW', 'AWAITING_SUPPLIER'] as const;

    const [open, late, disputes, closed] = await Promise.all([
      prisma.ticket.groupBy({
        by: ['merchantId'],
        where: { merchantId: { in: ids }, status: { in: [...OPEN] } },
        _count: true,
      }),
      // « En retard » se compte sur les tickets encore ouverts : un ticket clos
      // il y a un mois n'est pas en retard, il est fini.
      prisma.ticket.groupBy({
        by: ['merchantId'],
        where: {
          merchantId: { in: ids },
          status: { in: [...OPEN] },
          lastMessageAt: { lte: lateBefore },
        },
        _count: true,
      }),
      prisma.ticket.groupBy({
        by: ['merchantId'],
        where: { merchantId: { in: ids }, intent: 'DISPUTE', status: { in: [...OPEN] } },
        _count: true,
      }),
      prisma.ticket.groupBy({
        by: ['merchantId'],
        where: {
          merchantId: { in: ids },
          status: { in: ['CLOSED', 'AUTO_SENT'] },
          lastMessageAt: { gte: since },
        },
        _count: true,
      }),
    ]);

    const countOf = (rows: Array<{ merchantId: string; _count: number }>, id: string) =>
      rows.find((row) => row.merchantId === id)?._count ?? 0;

    return reply.send({
      shops: (shops.length > 0
        ? shops
        : [{ id: merchantId, label: 'Ma boutique', color: '#2f6fe4', current: true }]
      ).map((shop) => {
        const openCount = countOf(open, shop.id);
        const closedCount = countOf(closed, shop.id);
        const disputeCount = countOf(disputes, shop.id);
        const handled = openCount + closedCount;

        return {
          id: shop.id,
          label: shop.label,
          color: shop.color,
          current: shop.current,
          open: openCount,
          late: countOf(late, shop.id),
          disputes: disputeCount,
          closed30d: closedCount,
          // Part de litiges sur trente jours : au-delà de 1 %, Shopify gèle les
          // paiements d'une boutique. C'est le seul indicateur de cet écran qui
          // annonce une sanction plutôt qu'une charge de travail.
          disputeRate: handled === 0 ? 0 : Number(((disputeCount / handled) * 100).toFixed(2)),
        };
      }),
      /** Seuil Shopify, en pourcentage de commandes contestées. */
      disputeThreshold: 1,
    });
  });

  app.get('/api/metrics', async (request, reply) => {
    const { merchantId } = request.session;
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const [byStatus, sentDrafts, totalDrafts] = await Promise.all([
      prisma.ticket.groupBy({
        by: ['status'],
        where: { merchantId, lastMessageAt: { gte: since } },
        _count: true,
      }),
      prisma.draft.count({ where: { merchantId, status: 'SENT', createdAt: { gte: since } } }),
      prisma.draft.count({ where: { merchantId, createdAt: { gte: since } } }),
    ]);

    const counts = Object.fromEntries(byStatus.map((row) => [row.status, row._count]));

    return reply.send({
      window: '30j',
      tickets: counts,
      pending: (counts.NEEDS_REVIEW ?? 0) + (counts.DRAFT_READY ?? 0),
      // Taux d'automatisation = part des brouillons IA effectivement envoyés.
      automationRate: totalDrafts === 0 ? 0 : Number((sentDrafts / totalDrafts).toFixed(3)),
    });
  });

  // Écran de détail : fil + brouillon + contexte commande/client/livraison.
  app.get<{ Params: { id: string } }>('/api/tickets/:id', async (request, reply) => {
    const { merchantId, email } = request.session;

    // En mode « toutes les boutiques », la file agrège plusieurs boutiques :
    // le détail doit suivre, sinon ouvrir un ticket listé renvoie une erreur.
    // La lecture s'élargit, l'action non — c'est signalé par `readOnly`.
    const readable = await accessibleMerchantIds({ merchantId, email });

    const ticket = await prisma.ticket.findFirst({
      where: { id: request.params.id, merchantId: { in: readable } },
      include: {
        messages: { orderBy: { receivedAt: 'asc' } },
        drafts: { orderBy: { createdAt: 'desc' }, take: 5 },
      },
    });

    if (!ticket) return reply.code(404).send({ error: 'Ticket introuvable' });

    // Un ticket d'une autre boutique se consulte mais ne se traite pas : les
    // droits de l'utilisateur y sont peut-être différents, et le brouillon
    // partirait de la mauvaise boîte mail.
    const readOnly = ticket.merchantId !== merchantId;

    // Les données de commande viennent de Shopify en direct. Si la boutique
    // n'est pas connectée ou répond mal, on sert quand même le ticket : perdre
    // la sidebar est gênant, perdre le mail est inacceptable.
    let order = null;
    let orderError: string | null = null;

    if (ticket.shopifyOrderId) {
      try {
        // Client Shopify de la boutique du ticket, pas de celle de la session.
        const shopify = await getShopifyClient(ticket.merchantId);
        order = await getOrderById(shopify, ticket.shopifyOrderId);
      } catch (error) {
        orderError =
          error instanceof ShopifyError
            ? 'Détails indisponibles : boutique Shopify non connectée.'
            : 'Détails indisponibles : Shopify n’a pas répondu.';
        request.log.warn({ err: error, ticketId: ticket.id }, 'Lecture commande Shopify en échec');
      }
    }

    return reply.send({ ticket, order, orderError, readOnly });
  });

  /**
   * Commandes candidates pour un rattachement manuel : c'est la sortie de
   * secours quand l'association automatique a refusé de trancher.
   */
  app.get<{ Params: { id: string }; Querystring: { q?: string } }>(
    '/api/tickets/:id/order-candidates',
    async (request, reply) => {
      const { merchantId } = request.session;

      const ticket = await prisma.ticket.findFirst({
        where: { id: request.params.id, merchantId },
        select: { customerEmail: true, customerName: true },
      });

      if (!ticket) return reply.code(404).send({ error: 'Ticket introuvable' });

      const search = request.query.q?.trim();
      const query = search
        ? search.startsWith('#')
          ? `name:${quoteSearchValue(search)}`
          : quoteSearchValue(search)
        : `email:${quoteSearchValue(ticket.customerEmail)}`;

      try {
        const shopify = await getShopifyClient(merchantId);
        const orders = await searchOrders(shopify, query, 10);
        return reply.send({ orders });
      } catch (error) {
        request.log.warn({ err: error }, 'Recherche de commandes en échec');
        return reply.code(503).send({ error: 'Boutique Shopify indisponible' });
      }
    },
  );

  /** Rattachement manuel : l'agent tranche là où l'automatisme s'est abstenu. */
  app.post<{ Params: { id: string }; Body: { orderId?: string } }>(
    '/api/tickets/:id/order',
    { preHandler: requirePermission('reply') },
    async (request, reply) => {
      const { merchantId, userId } = request.session;
      const orderId = z.string().min(1).safeParse(request.body?.orderId);

      if (!orderId.success) return reply.code(400).send({ error: 'orderId requis' });

      const ticket = await prisma.ticket.findFirst({
        where: { id: request.params.id, merchantId },
        select: { id: true },
      });

      if (!ticket) return reply.code(404).send({ error: 'Ticket introuvable' });

      const shopify = await getShopifyClient(merchantId);
      const order = await getOrderById(shopify, orderId.data);

      if (!order) return reply.code(404).send({ error: 'Commande introuvable' });

      const updated = await prisma.ticket.update({
        where: { id: ticket.id },
        data: {
          shopifyOrderId: order.id,
          orderName: order.name,
          orderMatchMethod: 'MANUAL',
          orderMatchScore: 1,
        },
      });

      await recordAudit({
        merchantId,
        actorType: 'USER',
        actorId: userId,
        action: 'ticket.order_attached',
        targetType: 'Ticket',
        targetId: ticket.id,
        metadata: { orderName: order.name },
        ipAddress: request.ip,
      });

      return reply.send({ ticket: updated, order });
    },
  );

  /** Journal d'audit du marchand, affiché en colonne de droite. */
  app.get('/api/audit', async (request, reply) => {
    const { merchantId } = request.session;
    const entries = await prisma.auditLog.findMany({
      where: { merchantId },
      orderBy: { createdAt: 'desc' },
      take: 30,
      select: {
        id: true,
        action: true,
        actorType: true,
        targetType: true,
        targetId: true,
        metadata: true,
        createdAt: true,
      },
    });
    return reply.send({ entries });
  });

  // Édition du brouillon par l'agent avant envoi.
  app.patch<{ Params: { id: string }; Body: { body?: string } }>(
    '/api/drafts/:id',
    { preHandler: requirePermission('reply') },
    async (request, reply) => {
      const { merchantId, userId } = request.session;
      const body = z.string().min(1).safeParse(request.body?.body);

      if (!body.success) return reply.code(400).send({ error: 'Corps du brouillon requis' });

      const draft = await prisma.draft.findFirst({
        where: { id: request.params.id, merchantId },
        include: { ticket: true },
      });

      if (!draft) return reply.code(404).send({ error: 'Brouillon introuvable' });
      if (draft.status === 'SENT') {
        return reply.code(409).send({ error: 'Brouillon déjà envoyé' });
      }

      if (draft.gmailDraftId) {
        await updateDraftBody({
          merchantId,
          mailboxId: draft.ticket.mailboxId,
          draftId: draft.gmailDraftId,
          threadId: draft.ticket.gmailThreadId,
          to: draft.ticket.customerEmail,
          subject: draft.ticket.subject ?? 'Votre demande',
          body: body.data,
        });
      }

      const updated = await prisma.draft.update({
        where: { id: draft.id },
        data: { body: body.data, status: 'EDITED', createdBy: 'HUMAN' },
      });

      await recordAudit({
        merchantId,
        actorType: 'USER',
        actorId: userId,
        action: 'draft.edited',
        targetType: 'Draft',
        targetId: draft.id,
        ipAddress: request.ip,
      });

      return reply.send(updated);
    },
  );

  // Envoi — toujours déclenché par un humain en phase 1.
  app.post<{ Params: { id: string } }>(
    '/api/drafts/:id/send',
    { preHandler: requirePermission('reply') },
    async (request, reply) => {
    const { merchantId, userId } = request.session;

    const draft = await prisma.draft.findFirst({
      where: { id: request.params.id, merchantId },
      include: { ticket: true },
    });

    if (!draft) return reply.code(404).send({ error: 'Brouillon introuvable' });
    if (draft.status === 'SENT') return reply.code(409).send({ error: 'Déjà envoyé' });
    if (!draft.gmailDraftId) {
      return reply.code(409).send({ error: 'Aucun brouillon Gmail associé' });
    }

    await sendDraft(merchantId, draft.gmailDraftId, draft.ticket.mailboxId);

    await prisma.$transaction([
      prisma.draft.update({
        where: { id: draft.id },
        data: { status: 'SENT', sentAt: new Date() },
      }),
      prisma.ticket.update({ where: { id: draft.ticketId }, data: { status: 'CLOSED' } }),
    ]);

    await recordAudit({
      merchantId,
      actorType: 'USER',
      actorId: userId,
      action: 'draft.sent',
      targetType: 'Draft',
      targetId: draft.id,
      metadata: { ticketId: draft.ticketId },
      ipAddress: request.ip,
    });

    return reply.send({ ok: true });
  });

  /**
   * Message sortant à l'initiative de l'agent, hors ticket.
   *
   * Distinct d'une réponse : il n'y a pas de fil à poursuivre, pas de brouillon
   * à relire. La règle « rien ne part sans validation humaine » est respectée
   * par construction — c'est un humain qui écrit et qui clique.
   */
  app.post(
    '/api/emails',
    { preHandler: requirePermission('reply') },
    async (request, reply) => {
      const parsed = z
        .object({
          to: z.string().email(),
          subject: z.string().min(1).max(200),
          body: z.string().min(1).max(20000),
        })
        .safeParse(request.body);

      if (!parsed.success) {
        return reply.code(400).send({ error: 'Requête invalide', details: parsed.error.issues });
      }

      const { merchantId, userId } = request.session;

      try {
        await sendPlainEmail({ merchantId, ...parsed.data });
      } catch (error) {
        request.log.error({ err: error }, 'Envoi de message libre en échec');
        return reply.code(502).send({
          error:
            'Envoi impossible : vérifiez que la boîte Gmail est connectée dans les réglages.',
        });
      }

      await recordAudit({
        merchantId,
        actorType: 'USER',
        actorId: userId,
        action: 'email.sent',
        metadata: { to: parsed.data.to, subject: parsed.data.subject },
        ipAddress: request.ip,
      });

      return reply.send({ ok: true });
    },
  );
}
