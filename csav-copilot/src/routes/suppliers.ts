import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { env } from '../config/env.ts';
import { recordAudit } from '../lib/audit.ts';
import { signSupplierWorkspaceToken } from '../lib/supplierToken.ts';
import { prisma } from '../lib/prisma.ts';
import { requirePermission, requireSession } from '../plugins/auth.ts';
import { createEscalation, resolveEscalation, sendEscalation } from '../services/suppliers/escalate.ts';
import { sendPlainEmail } from '../services/gmail/send.ts';

const supplierBody = z.object({
  name: z.string().min(1).max(200),
  contactEmail: z.string().email(),
  ordersAccess: z.enum(['NONE', 'ASSIGNED', 'ALL']).optional(),
  contactName: z.string().max(200).nullish(),
  phone: z.string().max(40).nullish(),
  notes: z.string().max(2000).nullish(),
  active: z.boolean().default(true),
  /** Marques Shopify et préfixes de référence préparés par cet atelier. */
  vendors: z.array(z.string().min(1).max(120)).max(50).optional(),
  skuPrefixes: z.array(z.string().min(1).max(60)).max(50).optional(),
  isDefault: z.boolean().optional(),
});

const escalationBody = z.object({
  reason: z.enum(['OUT_OF_STOCK', 'INCORRECT_ADDRESS', 'MISSING_ITEM', 'OTHER']),
  note: z.string().max(2000).optional(),
  // Destinataire choisi par l'agent. Absent, le service route d'après le motif.
  supplierId: z.string().min(1).optional(),
});

/** Routes côté marchand : configurer le fournisseur, escalader un ticket. */
export async function supplierRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireSession);

  app.get('/api/suppliers', async (request, reply) => {
    const suppliers = await prisma.supplier.findMany({
      where: { merchantId: request.session.merchantId },
      orderBy: [{ active: 'desc' }, { name: 'asc' }],
      include: {
        // Le nombre d'escalades en cours dit lequel de vos contacts vous fait
        // attendre — c'est la seule métrique qui déclenche une action.
        _count: { select: { escalations: { where: { status: { in: ['OPEN', 'ANSWERED'] } } } } },
      },
    });

    return reply.send({
      suppliers: suppliers.map((supplier) => ({
        id: supplier.id,
        name: supplier.name,
        contactEmail: supplier.contactEmail,
        contactName: supplier.contactName,
        phone: supplier.phone,
        active: supplier.active,
        ordersAccess: supplier.ordersAccess,
        notes: supplier.notes,
        createdAt: supplier.createdAt,
        openEscalations: supplier._count.escalations,
      })),
    });
  });

  app.post('/api/suppliers', { preHandler: requirePermission('configure') }, async (request, reply) => {
    const parsed = supplierBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Requête invalide', details: parsed.error.issues });
    }

    const { merchantId, userId } = request.session;

    try {
      const supplier = await prisma.supplier.create({
        data: { merchantId, ...parsed.data },
      });

      await recordAudit({
        merchantId,
        actorType: 'USER',
        actorId: userId,
        action: 'supplier.created',
        targetType: 'Supplier',
        targetId: supplier.id,
        metadata: { name: supplier.name },
        ipAddress: request.ip,
      });

      return reply.send({ supplier });
    } catch (error) {
      // Collision sur (merchantId, contactEmail) : deux fiches pour la même
      // adresse rendraient les réponses du fournisseur inattribuables.
      if (
        typeof error === 'object' &&
        error !== null &&
        (error as { code?: string }).code === 'P2002'
      ) {
        return reply.code(409).send({
          error: 'Un contact utilise déjà cette adresse email.',
        });
      }
      throw error;
    }
  });

  app.patch<{ Params: { id: string } }>(
    '/api/suppliers/:id',
    { preHandler: requirePermission('configure') },
    async (request, reply) => {
    const parsed = supplierBody.partial().safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Requête invalide', details: parsed.error.issues });
    }

    const { merchantId, userId } = request.session;

    const existing = await prisma.supplier.findFirst({
      where: { id: request.params.id, merchantId },
      select: { id: true },
    });
    if (!existing) return reply.code(404).send({ error: 'Contact introuvable' });

    const supplier = await prisma.supplier.update({
      where: { id: existing.id },
      data: parsed.data,
    });

    await recordAudit({
      merchantId,
      actorType: 'USER',
      actorId: userId,
      action: 'supplier.updated',
      targetType: 'Supplier',
      targetId: supplier.id,
      metadata: parsed.data,
      ipAddress: request.ip,
    });

    return reply.send({ supplier });
  });

  /**
   * Suppression définitive, refusée dès qu'un échange existe.
   *
   * Supprimer un contact effacerait ses escalades en cascade, donc des
   * messages déjà envoyés et consignés. On désactive à la place — le
   * fournisseur ne reçoit plus rien mais l'historique reste lisible.
   */
  app.delete<{ Params: { id: string } }>(
    '/api/suppliers/:id',
    { preHandler: requirePermission('configure') },
    async (request, reply) => {
    const { merchantId, userId } = request.session;

    const supplier = await prisma.supplier.findFirst({
      where: { id: request.params.id, merchantId },
      include: { _count: { select: { escalations: true } } },
    });
    if (!supplier) return reply.code(404).send({ error: 'Contact introuvable' });

    if (supplier._count.escalations > 0) {
      return reply.code(409).send({
        error: `Ce contact a ${supplier._count.escalations} escalade(s) dans l'historique. Désactivez-le plutôt que de le supprimer.`,
      });
    }

    await prisma.supplier.delete({ where: { id: supplier.id } });

    await recordAudit({
      merchantId,
      actorType: 'USER',
      actorId: userId,
      action: 'supplier.deleted',
      targetType: 'Supplier',
      targetId: supplier.id,
      metadata: { name: supplier.name },
      ipAddress: request.ip,
    });

    return reply.send({ ok: true });
  });

  /**
   * Lien de travail permanent d'un fournisseur.
   *
   * Émis à la demande plutôt que stocké : le jeton se recalcule à partir du
   * numéro de version, donc rien de secret ne dort en base. « Révoquer »
   * incrémente ce numéro et invalide d'un coup tous les liens transmis.
   */
  app.post<{ Params: { id: string }; Body: { revoke?: boolean } }>(
    '/api/suppliers/:id/portal-link',
    { preHandler: requirePermission('configure') },
    async (request, reply) => {
      const { merchantId, userId } = request.session;

      const supplier = await prisma.supplier.findFirst({
        where: { id: request.params.id, merchantId },
        select: { id: true, name: true, portalTokenVersion: true },
      });
      if (!supplier) return reply.code(404).send({ error: 'Fournisseur introuvable' });

      const version = request.body?.revoke
        ? (
            await prisma.supplier.update({
              where: { id: supplier.id },
              data: { portalTokenVersion: { increment: 1 } },
              select: { portalTokenVersion: true },
            })
          ).portalTokenVersion
        : supplier.portalTokenVersion;

      const token = signSupplierWorkspaceToken({ merchantId, supplierId: supplier.id, version });

      await recordAudit({
        merchantId,
        actorType: 'USER',
        actorId: userId,
        action: request.body?.revoke ? 'supplier.link_revoked' : 'supplier.link_issued',
        targetType: 'Supplier',
        targetId: supplier.id,
        ipAddress: request.ip,
      });

      return reply.send({
        url: `${env.APP_URL}/fournisseur/${supplier.id}?token=${encodeURIComponent(token)}`,
        revoked: Boolean(request.body?.revoke),
      });
    },
  );

  /**
   * Alerte urgente vers un fournisseur.
   *
   * L'atelier est le canal du quotidien : il l'ouvre le matin, il y trouve ses
   * commandes. Mais « cette adresse est fausse, n'expédie pas » ne peut pas
   * attendre demain matin — le colis sera parti. L'alerte part donc par mail,
   * qui arrive sur son téléphone, et s'affiche en tête de son atelier jusqu'à
   * ce qu'il l'ouvre.
   *
   * Elle est consignée en base et non seulement envoyée : un mail tombé dans
   * les indésirables ne laisse aucune trace, et personne ne pourrait dire si
   * le fournisseur a été prévenu — exactement la question qu'on se pose quand
   * le colis part quand même.
   */
  app.post<{ Params: { id: string } }>(
    '/api/suppliers/:id/alert',
    { preHandler: requirePermission('escalate') },
    async (request, reply) => {
      const parsed = z
        .object({
          kind: z.enum(['ADDRESS', 'PHONE', 'PRODUCT', 'HOLD', 'OTHER']),
          message: z.string().min(3).max(1000),
          shopifyOrderId: z.string().max(120).nullish(),
          orderName: z.string().max(60).nullish(),
        })
        .safeParse(request.body);

      if (!parsed.success) return reply.code(400).send({ error: 'Alerte incomplète' });

      const { merchantId, userId } = request.session;

      const supplier = await prisma.supplier.findFirst({
        where: { id: request.params.id, merchantId, active: true },
        select: { id: true, name: true, contactEmail: true },
      });
      if (!supplier) return reply.code(404).send({ error: 'Fournisseur introuvable' });

      const alert = await prisma.supplierAlert.create({
        data: {
          merchantId,
          supplierId: supplier.id,
          kind: parsed.data.kind,
          message: parsed.data.message,
          shopifyOrderId: parsed.data.shopifyOrderId ?? null,
          orderName: parsed.data.orderName ?? null,
          createdById: userId,
        },
      });

      const titles = {
        ADDRESS: 'Adresse à corriger',
        PHONE: 'Téléphone à corriger',
        PRODUCT: 'Article à changer',
        HOLD: 'Ne pas expédier',
        OTHER: 'Message urgent',
      } as const;

      const subject = `URGENT — ${titles[parsed.data.kind]}${
        parsed.data.orderName ? ` · ${parsed.data.orderName}` : ''
      }`;

      /*
       * L'envoi ne bloque pas l'alerte.
       *
       * Si la boîte Gmail refuse, l'alerte existe quand même et s'affichera
       * dans l'atelier : perdre le mail est ennuyeux, perdre l'alerte
       * laisserait partir le colis.
       */
      let emailed = false;
      try {
        await sendPlainEmail({
          merchantId,
          to: supplier.contactEmail,
          subject,
          body:
            `${parsed.data.message}\n\n` +
            `${parsed.data.orderName ? `Commande : ${parsed.data.orderName}\n` : ''}` +
            `Ce message est également affiché en tête de votre espace de travail.`,
        });
        emailed = true;
        await prisma.supplierAlert.update({
          where: { id: alert.id },
          data: { emailedAt: new Date() },
        });
      } catch (error) {
        request.log.error({ err: error, supplierId: supplier.id }, 'Alerte fournisseur non envoyée');
      }

      await recordAudit({
        merchantId,
        actorType: 'USER',
        actorId: userId,
        action: 'supplier.alerted',
        targetType: 'Supplier',
        targetId: supplier.id,
        metadata: { kind: parsed.data.kind, orderName: parsed.data.orderName, emailed },
        ipAddress: request.ip,
      });

      return reply.send({ alert, emailed });
    },
  );

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

  app.post<{ Params: { id: string } }>(
    '/api/tickets/:id/escalations',
    { preHandler: requirePermission('escalate') },
    async (request, reply) => {
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
        supplierId: parsed.data.supplierId ?? null,
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

  app.post<{ Params: { id: string } }>(
    '/api/escalations/:id/send',
    { preHandler: requirePermission('escalate') },
    async (request, reply) => {
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

  app.post<{ Params: { id: string } }>(
    '/api/escalations/:id/resolve',
    { preHandler: requirePermission('escalate') },
    async (request, reply) => {
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
