import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { recordAudit } from '../lib/audit.ts';
import { prisma } from '../lib/prisma.ts';
import { verifySupplierToken } from '../lib/supplierToken.ts';
import { decodePhoto, photoSchema, sendParcelPhoto, toParcelView } from './parcels.ts';

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

      const parcels = await prisma.parcel.findMany({
        where: { merchantId: payload.merchantId, escalationId: escalation.id },
        orderBy: { index: 'asc' },
        select: {
          id: true,
          trackingNumber: true,
          carrier: true,
          index: true,
          total: true,
          orderName: true,
          photoMime: true,
          photoTakenAt: true,
          updatedAt: true,
        },
      });

      return reply.send({ escalation, parcels: parcels.map(toParcelView) });
    },
  );

  /**
   * Enregistrement d'un colis par le fournisseur.
   *
   * Le jeton scope l'écriture à une escalade : le fournisseur ne peut attacher
   * un colis qu'à la commande pour laquelle on l'a sollicité, et le
   * `merchantId` vient du jeton, jamais du corps de la requête.
   */
  app.post<{ Params: { id: string }; Querystring: { token?: string } }>(
    '/api/supplier-portal/:id/parcels',
    { bodyLimit: 4 * 1024 * 1024 },
    async (request, reply) => {
      const payload = verifySupplierToken(request.query.token);
      if (!payload || payload.escalationId !== request.params.id) {
        return reply.code(401).send({ error: 'Lien invalide ou expiré' });
      }

      const parsed = z
        .object({
          trackingNumber: z.string().min(3).max(80),
          carrier: z.string().max(80).nullish(),
          index: z.number().int().min(1).max(20),
          total: z.number().int().min(1).max(20),
          photo: photoSchema.nullish(),
        })
        .safeParse(request.body);

      if (!parsed.success) {
        return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Colis invalide' });
      }

      if (parsed.data.index > parsed.data.total) {
        return reply.code(400).send({ error: 'Le rang du colis dépasse le nombre annoncé.' });
      }

      const escalation = await prisma.supplierEscalation.findFirst({
        where: { id: payload.escalationId, merchantId: payload.merchantId },
        include: { ticket: { select: { orderName: true, shopifyOrderId: true } } },
      });
      if (!escalation) return reply.code(404).send({ error: 'Demande introuvable' });
      if (escalation.status === 'RESOLVED') {
        return reply.code(409).send({ error: 'Cette demande est déjà clôturée' });
      }

      const photo = parsed.data.photo ? decodePhoto(parsed.data.photo) : null;
      const photoFields = photo
        ? { photoMime: photo.mime, photoData: photo.data, photoTakenAt: new Date() }
        : {};

      const parcel = await prisma.parcel.upsert({
        where: {
          merchantId_trackingNumber: {
            merchantId: escalation.merchantId,
            trackingNumber: parsed.data.trackingNumber.trim(),
          },
        },
        create: {
          merchantId: escalation.merchantId,
          escalationId: escalation.id,
          trackingNumber: parsed.data.trackingNumber.trim(),
          carrier: parsed.data.carrier ?? null,
          index: parsed.data.index,
          total: parsed.data.total,
          orderName: escalation.ticket.orderName,
          shopifyOrderId: escalation.ticket.shopifyOrderId,
          ...photoFields,
        },
        update: {
          carrier: parsed.data.carrier ?? null,
          index: parsed.data.index,
          total: parsed.data.total,
          ...photoFields,
        },
        select: {
          id: true,
          trackingNumber: true,
          carrier: true,
          index: true,
          total: true,
          orderName: true,
          photoMime: true,
          photoTakenAt: true,
          updatedAt: true,
        },
      });

      await recordAudit({
        merchantId: escalation.merchantId,
        actorType: 'SUPPLIER',
        action: 'supplier.parcel_recorded',
        targetType: 'Parcel',
        targetId: parcel.id,
        metadata: { index: parcel.index, total: parcel.total, photo: Boolean(photo) },
        ipAddress: request.ip,
      });

      return reply.send({ parcel: toParcelView(parcel) });
    },
  );

  // Relecture de sa propre photo : le fournisseur doit pouvoir vérifier
  // qu'elle est lisible avant de quitter la page.
  app.get<{ Params: { id: string; parcelId: string }; Querystring: { token?: string } }>(
    '/api/supplier-portal/:id/parcels/:parcelId/photo',
    async (request, reply) => {
      const payload = verifySupplierToken(request.query.token);
      if (!payload || payload.escalationId !== request.params.id) {
        return reply.code(401).send({ error: 'Lien invalide ou expiré' });
      }

      const parcel = await prisma.parcel.findFirst({
        where: {
          id: request.params.parcelId,
          merchantId: payload.merchantId,
          escalationId: payload.escalationId,
        },
        select: { id: true },
      });
      if (!parcel) return reply.code(404).send({ error: 'Colis introuvable' });

      return sendParcelPhoto(reply, parcel.id, payload.merchantId);
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
