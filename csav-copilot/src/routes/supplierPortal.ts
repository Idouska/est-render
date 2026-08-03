import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { recordAudit } from '../lib/audit.ts';
import { prisma } from '../lib/prisma.ts';
import { verifySupplierToken } from '../lib/supplierToken.ts';

/**
 * Portail fournisseur : accès public par lien signé, pas de session ni de
 * compte. Le jeton (voir lib/supplierToken.ts) scope l'accès à une seule
 * escalade — jamais au reste des données du marchand.
 */
export async function supplierPortalRoutes(app: FastifyInstance): Promise<void> {
  // Page unique, servie par l'API comme le dashboard : le jeton est lu côté
  // client dans l'URL, jamais journalisé côté serveur au-delà de la requête.
  app.get<{ Params: { id: string } }>('/supplier/:id', async (request, reply) =>
    reply.type('text/html').sendFile('supplier.html'),
  );

  app.get<{ Params: { id: string }; Querystring: { token?: string } }>(
    '/api/supplier-portal/:id',
    async (request, reply) => {
      const payload = verifySupplierToken(request.query.token);
      if (!payload || payload.escalationId !== request.params.id) {
        return reply.code(401).send({ error: 'Lien invalide ou expiré' });
      }

      const escalation = await prisma.supplierEscalation.findFirst({
        where: { id: payload.escalationId, merchantId: payload.merchantId },
        include: {
          supplier: { select: { name: true } },
          ticket: { select: { orderName: true, subject: true } },
          messages: { orderBy: { createdAt: 'asc' } },
        },
      });

      if (!escalation) return reply.code(404).send({ error: 'Demande introuvable' });

      return reply.send({ escalation });
    },
  );

  app.post<{ Params: { id: string }; Querystring: { token?: string }; Body: { body?: string } }>(
    '/api/supplier-portal/:id/reply',
    async (request, reply) => {
      const payload = verifySupplierToken(request.query.token);
      if (!payload || payload.escalationId !== request.params.id) {
        return reply.code(401).send({ error: 'Lien invalide ou expiré' });
      }

      const body = z.string().min(1).max(5000).safeParse(request.body?.body);
      if (!body.success) return reply.code(400).send({ error: 'Message requis' });

      const escalation = await prisma.supplierEscalation.findFirst({
        where: { id: payload.escalationId, merchantId: payload.merchantId },
      });
      if (!escalation) return reply.code(404).send({ error: 'Demande introuvable' });
      if (escalation.status === 'RESOLVED') {
        return reply.code(409).send({ error: 'Cette demande est déjà clôturée' });
      }

      const message = await prisma.supplierMessage.create({
        data: {
          merchantId: escalation.merchantId,
          escalationId: escalation.id,
          direction: 'FROM_SUPPLIER',
          authorType: 'SUPPLIER',
          body: body.data,
        },
      });

      await prisma.supplierEscalation.update({
        where: { id: escalation.id },
        data: { status: 'ANSWERED' },
      });

      await recordAudit({
        merchantId: escalation.merchantId,
        actorType: 'SUPPLIER',
        action: 'supplier.replied',
        targetType: 'SupplierEscalation',
        targetId: escalation.id,
        ipAddress: request.ip,
      });

      return reply.send({ message });
    },
  );
}
