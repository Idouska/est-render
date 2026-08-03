import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { recordAudit } from '../lib/audit.ts';
import { prisma } from '../lib/prisma.ts';
import { requireSession } from '../plugins/auth.ts';
import { createEscalation, resolveEscalation, sendEscalation } from '../services/suppliers/escalate.ts';

const supplierBody = z.object({
  name: z.string().min(1).max(200),
  contactEmail: z.string().email(),
});

const escalationBody = z.object({
  reason: z.enum(['OUT_OF_STOCK', 'INCORRECT_ADDRESS', 'MISSING_ITEM', 'OTHER']),
  note: z.string().max(2000).optional(),
});

/** Routes côté marchand : configurer le fournisseur, escalader un ticket. */
export async function supplierRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireSession);

  app.get('/api/suppliers', async (request, reply) => {
    const supplier = await prisma.supplier.findUnique({
      where: { merchantId: request.session.merchantId },
    });
    return reply.send({ supplier });
  });

  // Un seul fournisseur par marchand en phase 1 : upsert, pas de création
  // multiple. Passer à plusieurs fournisseurs demanderait de savoir associer
  // un article Shopify à son fournisseur (champ "vendor"), non exploité ici.
  app.put('/api/suppliers', async (request, reply) => {
    const parsed = supplierBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Requête invalide', details: parsed.error.issues });
    }

    const { merchantId, userId } = request.session;

    const supplier = await prisma.supplier.upsert({
      where: { merchantId },
      create: { merchantId, ...parsed.data },
      update: parsed.data,
    });

    await recordAudit({
      merchantId,
      actorType: 'USER',
      actorId: userId,
      action: 'supplier.configured',
      targetType: 'Supplier',
      targetId: supplier.id,
      metadata: { name: supplier.name },
      ipAddress: request.ip,
    });

    return reply.send({ supplier });
  });

  app.get<{ Params: { id: string } }>('/api/tickets/:id/escalations', async (request, reply) => {
    const { merchantId } = request.session;

    const ticket = await prisma.ticket.findFirst({
      where: { id: request.params.id, merchantId },
      select: { id: true },
    });
    if (!ticket) return reply.code(404).send({ error: 'Ticket introuvable' });

    const escalations = await prisma.supplierEscalation.findMany({
      where: { ticketId: ticket.id, merchantId },
      orderBy: { createdAt: 'desc' },
      include: {
        supplier: { select: { name: true, contactEmail: true } },
        messages: { orderBy: { createdAt: 'asc' } },
      },
    });

    return reply.send({ escalations });
  });

  app.post<{ Params: { id: string } }>('/api/tickets/:id/escalations', async (request, reply) => {
    const parsed = escalationBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Requête invalide', details: parsed.error.issues });
    }

    const { merchantId, userId } = request.session;

    try {
      const { escalation } = await createEscalation({
        merchantId,
        ticketId: request.params.id,
        reason: parsed.data.reason,
        note: parsed.data.note,
        userId,
      });
      return reply.send({ escalation });
    } catch (error) {
      if (error instanceof Error && error.name === 'SupplierNotConfiguredError') {
        return reply.code(409).send({
          error: 'Configurez un fournisseur avant de pouvoir escalader un ticket.',
        });
      }
      throw error;
    }
  });

  // Édition du brouillon avant envoi — même geste que pour un brouillon client.
  app.patch<{ Params: { id: string }; Body: { body?: string } }>(
    '/api/escalations/:id',
    async (request, reply) => {
      const { merchantId } = request.session;
      const body = z.string().min(1).safeParse(request.body?.body);
      if (!body.success) return reply.code(400).send({ error: 'Corps du message requis' });

      const escalation = await prisma.supplierEscalation.findFirst({
        where: { id: request.params.id, merchantId },
        include: { messages: { orderBy: { createdAt: 'desc' }, take: 1 } },
      });
      if (!escalation) return reply.code(404).send({ error: 'Escalade introuvable' });
      if (escalation.status !== 'DRAFTING') {
        return reply.code(409).send({ error: 'Cette escalade a déjà été envoyée' });
      }

      const lastMessage = escalation.messages[0];
      if (!lastMessage) return reply.code(500).send({ error: 'Message introuvable' });

      const updated = await prisma.supplierMessage.update({
        where: { id: lastMessage.id },
        data: { body: body.data, authorType: 'HUMAN' },
      });

      return reply.send({ message: updated });
    },
  );

  app.post<{ Params: { id: string } }>('/api/escalations/:id/send', async (request, reply) => {
    const { merchantId, userId } = request.session;

    const escalation = await prisma.supplierEscalation.findFirst({
      where: { id: request.params.id, merchantId },
      select: { id: true, status: true },
    });
    if (!escalation) return reply.code(404).send({ error: 'Escalade introuvable' });
    if (escalation.status !== 'DRAFTING') {
      return reply.code(409).send({ error: 'Escalade déjà envoyée' });
    }

    await sendEscalation({ merchantId, escalationId: escalation.id, userId });
    return reply.send({ ok: true });
  });

  app.post<{ Params: { id: string } }>('/api/escalations/:id/resolve', async (request, reply) => {
    const { merchantId, userId } = request.session;

    const escalation = await prisma.supplierEscalation.findFirst({
      where: { id: request.params.id, merchantId },
      select: { id: true },
    });
    if (!escalation) return reply.code(404).send({ error: 'Escalade introuvable' });

    await resolveEscalation({ merchantId, escalationId: escalation.id, userId });
    return reply.send({ ok: true });
  });
}
