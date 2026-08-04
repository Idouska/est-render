import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { env } from '../config/env.ts';
import { recordAudit } from '../lib/audit.ts';
import { prisma } from '../lib/prisma.ts';
import { verifySupplierWorkspaceToken } from '../lib/supplierToken.ts';
import { ordersToCsv } from '../services/export/ordersCsv.ts';
import { getShopifyClient } from '../services/shopify/client.ts';
import { listOrders } from '../services/shopify/orders.ts';
import { decodePhoto, photoSchema, sendParcelPhoto, toParcelView } from './parcels.ts';

/**
 * Espace de travail permanent du fournisseur.
 *
 * Différent du portail d'escalade, qui ne montre qu'un fil de discussion : ici
 * le fournisseur voit les commandes à préparer, y attache les numéros de suivi
 * et les photos d'étiquettes, et signale les problèmes qu'il découvre au
 * moment de l'emballage — un téléphone à neuf chiffres, une rue sans numéro.
 *
 * Il n'a toujours ni compte ni mot de passe : un lien signé, permanent et
 * révocable, qu'il ouvre chaque matin.
 */

interface Workspace {
  merchantId: string;
  supplierId: string;
  supplierName: string;
}

/** Vérifie le jeton et l'accorde au fournisseur en base. */
async function authorize(
  request: FastifyRequest<{ Params: { id: string }; Querystring: { token?: string } }>,
  reply: FastifyReply,
): Promise<Workspace | null> {
  const payload = verifySupplierWorkspaceToken(request.query.token);

  if (!payload || payload.supplierId !== request.params.id) {
    await reply.code(401).send({ error: 'Lien invalide' });
    return null;
  }

  const supplier = await prisma.supplier.findFirst({
    where: { id: payload.supplierId, merchantId: payload.merchantId },
    select: { id: true, name: true, active: true, portalTokenVersion: true },
  });

  // La version fait office de révocation : un lien émis avant le dernier
  // renouvellement cesse d'ouvrir quoi que ce soit.
  if (!supplier || !supplier.active || supplier.portalTokenVersion !== payload.version) {
    await reply.code(401).send({ error: 'Ce lien a été révoqué. Demandez-en un nouveau.' });
    return null;
  }

  return {
    merchantId: payload.merchantId,
    supplierId: supplier.id,
    supplierName: supplier.name,
  };
}

/** Fenêtre de commandes demandée, « hier » par défaut. */
const rangeQuery = z.object({
  token: z.string().optional(),
  since: z.string().date().optional(),
  until: z.string().date().optional(),
  limit: z.coerce.number().int().min(1).max(250).default(100),
});

function toShopifyRange(since: string | undefined, until: string | undefined): string {
  // Par défaut : les commandes des dernières 24 heures. C'est le geste du
  // matin — « ce qui est tombé depuis hier ».
  if (!since && !until) {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    return `created_at:>=${yesterday}`;
  }

  return [
    since ? `created_at:>=${since}` : '',
    until ? `created_at:<=${until}T23:59:59Z` : '',
  ]
    .filter(Boolean)
    .join(' AND ');
}

export async function supplierWorkspaceRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { id: string } }>('/fournisseur/:id', async (request, reply) =>
    reply.type('text/html').sendFile('workspace.html'),
  );

  app.get<{ Params: { id: string }; Querystring: z.infer<typeof rangeQuery> }>(
    '/api/workspace/:id/orders',
    async (request, reply) => {
      const workspace = await authorize(request, reply);
      if (!workspace) return;

      const parsed = rangeQuery.safeParse(request.query);
      if (!parsed.success) return reply.code(400).send({ error: 'Période invalide' });

      const client = await getShopifyClient(workspace.merchantId);
      const page = await listOrders(client, {
        query: toShopifyRange(parsed.data.since, parsed.data.until),
        limit: parsed.data.limit,
        cursor: null,
      });

      // Colis déjà saisis, rapprochés par identifiant de commande : le
      // fournisseur doit voir ce qu'il a fait hier sans le ressaisir.
      const parcels = await prisma.parcel.findMany({
        where: {
          merchantId: workspace.merchantId,
          shopifyOrderId: { in: page.orders.map((order) => order.id) },
        },
        orderBy: { index: 'asc' },
        select: {
          id: true,
          shopifyOrderId: true,
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

      const byOrder = new Map<string, typeof parcels>();
      for (const parcel of parcels) {
        const key = parcel.shopifyOrderId ?? '';
        byOrder.set(key, [...(byOrder.get(key) ?? []), parcel]);
      }

      return reply.send({
        supplier: { name: workspace.supplierName },
        orders: page.orders.map((order) => ({
          ...order,
          parcels: (byOrder.get(order.id) ?? []).map(toParcelView),
        })),
      });
    },
  );

  app.get<{ Params: { id: string }; Querystring: z.infer<typeof rangeQuery> }>(
    '/api/workspace/:id/orders.csv',
    async (request, reply) => {
      const workspace = await authorize(request, reply);
      if (!workspace) return;

      const parsed = rangeQuery.safeParse(request.query);
      if (!parsed.success) return reply.code(400).send({ error: 'Période invalide' });

      const client = await getShopifyClient(workspace.merchantId);
      const page = await listOrders(client, {
        query: toShopifyRange(parsed.data.since, parsed.data.until),
        limit: parsed.data.limit,
        cursor: null,
      });

      const parcels = await prisma.parcel.findMany({
        where: {
          merchantId: workspace.merchantId,
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
              photoUrl: parcel.photoMime
                ? `/api/workspace/${workspace.supplierId}/parcels/${parcel.id}/photo?token=${encodeURIComponent(
                    request.query.token ?? '',
                  )}`
                : null,
            })),
        })),
        env.APP_URL,
      );

      const stamp = new Date().toISOString().slice(0, 10);

      return reply
        .type('text/csv; charset=utf-8')
        .header('Content-Disposition', `attachment; filename="commandes-${stamp}.csv"`)
        .send(csv);
    },
  );

  app.post<{ Params: { id: string }; Querystring: { token?: string } }>(
    '/api/workspace/:id/parcels',
    { bodyLimit: 4 * 1024 * 1024 },
    async (request, reply) => {
      const workspace = await authorize(request, reply);
      if (!workspace) return;

      const parsed = z
        .object({
          shopifyOrderId: z.string().min(1).max(120),
          orderName: z.string().max(60).nullish(),
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

      const photo = parsed.data.photo ? decodePhoto(parsed.data.photo) : null;
      const photoFields = photo
        ? { photoMime: photo.mime, photoData: photo.data, photoTakenAt: new Date() }
        : {};

      const parcel = await prisma.parcel.upsert({
        where: {
          merchantId_trackingNumber: {
            merchantId: workspace.merchantId,
            trackingNumber: parsed.data.trackingNumber.trim(),
          },
        },
        create: {
          merchantId: workspace.merchantId,
          shopifyOrderId: parsed.data.shopifyOrderId,
          orderName: parsed.data.orderName ?? null,
          trackingNumber: parsed.data.trackingNumber.trim(),
          carrier: parsed.data.carrier ?? null,
          index: parsed.data.index,
          total: parsed.data.total,
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
        merchantId: workspace.merchantId,
        actorType: 'SUPPLIER',
        actorId: workspace.supplierId,
        action: 'supplier.parcel_recorded',
        targetType: 'Parcel',
        targetId: parcel.id,
        metadata: { index: parcel.index, total: parcel.total, photo: Boolean(photo) },
        ipAddress: request.ip,
      });

      return reply.send({ parcel: toParcelView(parcel) });
    },
  );

  app.get<{ Params: { id: string; parcelId: string }; Querystring: { token?: string } }>(
    '/api/workspace/:id/parcels/:parcelId/photo',
    async (request, reply) => {
      const workspace = await authorize(request, reply);
      if (!workspace) return;

      return sendParcelPhoto(reply, request.params.parcelId, workspace.merchantId);
    },
  );

  /**
   * Signalement d'un problème sur une commande.
   *
   * Crée un vrai ticket, pas une note à part : c'est au moment de l'emballage
   * qu'on découvre un téléphone incomplet, et l'agent qui le corrigera travaille
   * dans la file, pas dans une seconde boîte de réception.
   */
  app.post<{ Params: { id: string }; Querystring: { token?: string } }>(
    '/api/workspace/:id/issues',
    async (request, reply) => {
      const workspace = await authorize(request, reply);
      if (!workspace) return;

      const parsed = z
        .object({
          shopifyOrderId: z.string().min(1).max(120),
          orderName: z.string().max(60).nullish(),
          customerEmail: z.string().email().max(200).nullish(),
          kind: z.enum(['PHONE', 'ADDRESS', 'STOCK', 'DAMAGE', 'OTHER']),
          note: z.string().min(3).max(2000),
        })
        .safeParse(request.body);

      if (!parsed.success) {
        return reply.code(400).send({ error: 'Signalement incomplet' });
      }

      const KINDS = {
        PHONE: 'Numéro de téléphone incomplet ou invalide',
        ADDRESS: 'Adresse incomplète ou incorrecte',
        STOCK: 'Article indisponible',
        DAMAGE: 'Article abîmé',
        OTHER: 'Autre problème',
      } as const;

      const subject = `${KINDS[parsed.data.kind]} — ${parsed.data.orderName ?? 'commande'}`;

      // Le fil est identifié par la commande et le motif : deux signalements
      // identiques le même jour ne créent pas deux tickets concurrents.
      const threadId = `supplier:${workspace.supplierId}:${parsed.data.shopifyOrderId}:${parsed.data.kind}`;

      const ticket = await prisma.ticket.upsert({
        where: {
          merchantId_gmailThreadId: { merchantId: workspace.merchantId, gmailThreadId: threadId },
        },
        create: {
          merchantId: workspace.merchantId,
          gmailThreadId: threadId,
          subject,
          // Le fournisseur n'est pas le client : sans email client connu, on
          // note l'origine plutôt que d'inventer une adresse.
          customerEmail: parsed.data.customerEmail ?? `fournisseur+${workspace.supplierId}@local`,
          customerName: workspace.supplierName,
          status: 'NEEDS_REVIEW',
          intent: 'OTHER',
          shopifyOrderId: parsed.data.shopifyOrderId,
          orderName: parsed.data.orderName ?? null,
          lastMessageAt: new Date(),
        },
        update: { status: 'NEEDS_REVIEW', lastMessageAt: new Date() },
        select: { id: true, subject: true },
      });

      await prisma.message.create({
        data: {
          merchantId: workspace.merchantId,
          ticketId: ticket.id,
          gmailMessageId: `${threadId}:${Date.now()}`,
          direction: 'INBOUND',
          fromEmail: `fournisseur+${workspace.supplierId}@local`,
          subject,
          bodyText: `Signalé par ${workspace.supplierName} depuis l'atelier.\n\n${parsed.data.note}`,
          receivedAt: new Date(),
        },
      });

      await recordAudit({
        merchantId: workspace.merchantId,
        actorType: 'SUPPLIER',
        actorId: workspace.supplierId,
        action: 'supplier.issue_reported',
        targetType: 'Ticket',
        targetId: ticket.id,
        metadata: { kind: parsed.data.kind, orderName: parsed.data.orderName },
        ipAddress: request.ip,
      });

      return reply.send({ ticket });
    },
  );
}
