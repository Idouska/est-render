import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { recordAudit } from '../lib/audit.ts';
import { prisma } from '../lib/prisma.ts';
import { requireSession } from '../plugins/auth.ts';
import { sendDraft, updateDraftBody } from '../services/gmail/drafts.ts';
import { getShopifyClient } from '../services/shopify/client.ts';
import { getOrderById } from '../services/shopify/orders.ts';

const listQuery = z.object({
  status: z
    .enum(['NEW', 'PROCESSING', 'DRAFT_READY', 'NEEDS_REVIEW', 'AUTO_SENT', 'CLOSED', 'FAILED'])
    .optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export async function ticketRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireSession);

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

    let order = null;
    if (ticket.shopifyOrderId) {
      const shopify = await getShopifyClient(merchantId);
      order = await getOrderById(shopify, ticket.shopifyOrderId);
    }

    return reply.send({ ticket, order });
  });

  // Édition du brouillon par l'agent avant envoi.
  app.patch<{ Params: { id: string }; Body: { body?: string } }>(
    '/api/drafts/:id',
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
  app.post<{ Params: { id: string } }>('/api/drafts/:id/send', async (request, reply) => {
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
}
