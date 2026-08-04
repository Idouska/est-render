import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { env } from '../config/env.ts';
import { recordAudit } from '../lib/audit.ts';
import { prisma } from '../lib/prisma.ts';
import { requirePermission, requireSession } from '../plugins/auth.ts';
import { sendDraft, updateDraftBody } from '../services/gmail/drafts.ts';
import { sendPlainEmail } from '../services/gmail/send.ts';
import { getShopifyClient, ShopifyError } from '../services/shopify/client.ts';
import { getOrderById, quoteSearchValue, searchOrders } from '../services/shopify/orders.ts';

const listQuery = z.object({
  status: z
    .enum(['NEW', 'PROCESSING', 'DRAFT_READY', 'NEEDS_REVIEW', 'AUTO_SENT', 'CLOSED', 'FAILED'])
    .optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

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
        gmail: { select: { emailAddress: true, watchExpiration: true } },
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
        connected: Boolean(merchant.gmail),
        emailAddress: merchant.gmail?.emailAddress ?? null,
        // Un watch expiré signifie que plus rien n'entre : c'est l'information
        // la plus utile de tout le tableau de bord.
        watchActive: Boolean(
          merchant.gmail?.watchExpiration && merchant.gmail.watchExpiration > new Date(),
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

    const { merchantId } = request.session;
    const { status, cursor, limit } = query.data;

    const tickets = await prisma.ticket.findMany({
      where: { merchantId, ...(status ? { status } : {}) },
      orderBy: { lastMessageAt: 'desc' },
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
        lastMessageAt: true,
      },
    });

    const hasMore = tickets.length > limit;
    if (hasMore) tickets.pop();

    return reply.send({
      tickets,
      nextCursor: hasMore ? tickets[tickets.length - 1]?.id : null,
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
    const { merchantId } = request.session;

    const ticket = await prisma.ticket.findFirst({
      where: { id: request.params.id, merchantId },
      include: {
        messages: { orderBy: { receivedAt: 'asc' } },
        drafts: { orderBy: { createdAt: 'desc' }, take: 5 },
      },
    });

    if (!ticket) return reply.code(404).send({ error: 'Ticket introuvable' });

    // Les données de commande viennent de Shopify en direct. Si la boutique
    // n'est pas connectée ou répond mal, on sert quand même le ticket : perdre
    // la sidebar est gênant, perdre le mail est inacceptable.
    let order = null;
    let orderError: string | null = null;

    if (ticket.shopifyOrderId) {
      try {
        const shopify = await getShopifyClient(merchantId);
        order = await getOrderById(shopify, ticket.shopifyOrderId);
      } catch (error) {
        orderError =
          error instanceof ShopifyError
            ? 'Détails indisponibles : boutique Shopify non connectée.'
            : 'Détails indisponibles : Shopify n’a pas répondu.';
        request.log.warn({ err: error, ticketId: ticket.id }, 'Lecture commande Shopify en échec');
      }
    }

    return reply.send({ ticket, order, orderError });
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

    await sendDraft(merchantId, draft.gmailDraftId);

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
