import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.ts';
import { recordAudit } from '../lib/audit.ts';
import { requireSession } from '../plugins/auth.ts';
import { getShopifyClient } from '../services/shopify/client.ts';
import { listOrders } from '../services/shopify/orders.ts';

/**
 * Reshipment — les retours clients, et ce qu'on en refait.
 *
 * Un retour vit deux vies. D'abord un dossier à suivre : le client a-t-il son
 * bon de retour, le colis est-il arrivé chez l'agence, dans quel état. Puis,
 * s'il est remis en stock, une paire disponible en France — et c'est là que le
 * circuit se referme : la prochaine commande du même article dans un pays
 * proche se sert dans ce stock au lieu de refaire partir un colis de
 * l'atelier. Rien ne se gâche, et le client est livré en trois jours au lieu
 * de quinze.
 *
 * Les agences de traitement (une ou plusieurs par pays : FR, ES, IT, BE)
 * réceptionnent et stockent ; leurs coordonnées vivent ici, sous la main au
 * moment d'ouvrir un dossier.
 */

const COUNTRIES = ['FR', 'ES', 'IT', 'BE'] as const;

const caseBody = z.object({
  orderName: z.string().max(60).nullish(),
  shopifyOrderId: z.string().max(80).nullish(),
  customerName: z.string().max(200).nullish(),
  customerEmail: z.string().max(200).nullish(),
  customerPhone: z.string().max(40).nullish(),
  country: z.enum(COUNTRIES).nullish(),
  productTitle: z.string().min(1).max(300),
  variantTitle: z.string().max(120).nullish(),
  sku: z.string().max(120).nullish(),
  reason: z.enum(['SIZE', 'DEFECT', 'MODEL', 'OTHER']).optional(),
  resolution: z.enum(['EXCHANGE', 'REFUND']).optional(),
  agencyId: z.string().max(40).nullish(),
  note: z.string().max(4000).nullish(),
});

const casePatch = caseBody.partial().extend({
  labelSent: z.boolean().optional(),
  status: z.enum(['OPEN', 'LABEL_SENT', 'RECEIVED', 'RESTOCKED', 'UNUSABLE', 'CLOSED']).optional(),
  trackingNumber: z.string().max(120).nullish(),
  /** Marque le dossier « contacté aujourd'hui » : la relance repart de zéro. */
  touch: z.boolean().optional(),
  /** Consomme la paire remise en stock sur cette commande. */
  reusedOrderName: z.string().max(60).nullish(),
});

const agencyBody = z.object({
  country: z.enum(COUNTRIES),
  name: z.string().min(1).max(200),
  email: z.string().max(200).nullish(),
  phone: z.string().max(40).nullish(),
  address: z.string().max(2000).nullish(),
  notes: z.string().max(4000).nullish(),
});

export async function returnRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireSession);

  app.get('/api/returns', async (request, reply) => {
    const { merchantId } = request.session;

    const cases = await prisma.returnCase.findMany({
      where: { merchantId },
      orderBy: { createdAt: 'desc' },
      take: 300,
      include: { agency: { select: { id: true, name: true, country: true } } },
    });

    // Les dossiers silencieux : ouverts, et sans contact depuis trois jours.
    // C'est le compte qui doit faire mal — un retour qu'on laisse mourir est
    // un remboursement qu'on fera quand même, mais sans récupérer la paire.
    const silentSince = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    const silent = cases.filter(
      (item) =>
        ['OPEN', 'LABEL_SENT'].includes(item.status) && item.lastContactAt < silentSince,
    ).length;

    // Le stock France : remis en rayon et pas encore réutilisés.
    const stock = cases.filter((item) => item.status === 'RESTOCKED' && !item.reusedAt);

    return reply.send({
      cases,
      counts: {
        open: cases.filter((item) => !['CLOSED', 'UNUSABLE'].includes(item.status)).length,
        silent,
        stock: stock.length,
      },
    });
  });

  app.post('/api/returns', async (request, reply) => {
    const { merchantId, userId } = request.session;
    const parsed = caseBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Champs invalides' });

    const created = await prisma.returnCase.create({
      data: { merchantId, ...parsed.data },
    });

    await recordAudit({
      merchantId,
      actorType: 'USER',
      actorId: userId,
      action: 'return.created',
      targetType: 'return',
      targetId: created.id,
      metadata: { orderName: created.orderName, product: created.productTitle },
    });

    return reply.send({ case: created });
  });

  app.patch<{ Params: { id: string } }>('/api/returns/:id', async (request, reply) => {
    const { merchantId, userId } = request.session;
    const parsed = casePatch.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Champs invalides' });

    const existing = await prisma.returnCase.findFirst({
      where: { id: request.params.id, merchantId },
      select: { id: true },
    });
    if (!existing) return reply.code(404).send({ error: 'Dossier introuvable' });

    const { touch, reusedOrderName, ...fields } = parsed.data;

    const updated = await prisma.returnCase.update({
      where: { id: existing.id },
      data: {
        ...fields,
        // Fournir le bon fait avancer le statut tout seul : deux gestes pour
        // dire la même chose finiraient par se contredire.
        ...(fields.labelSent === true ? { status: fields.status ?? 'LABEL_SENT' } : {}),
        ...(touch ? { lastContactAt: new Date() } : {}),
        ...(reusedOrderName !== undefined
          ? reusedOrderName
            ? { reusedOrderName, reusedAt: new Date(), status: 'CLOSED' }
            : { reusedOrderName: null, reusedAt: null }
          : {}),
      },
    });

    await recordAudit({
      merchantId,
      actorType: 'USER',
      actorId: userId,
      action: 'return.updated',
      targetType: 'return',
      targetId: updated.id,
      metadata: parsed.data,
    });

    return reply.send({ case: updated });
  });

  app.delete<{ Params: { id: string } }>('/api/returns/:id', async (request, reply) => {
    const { merchantId, userId } = request.session;

    const deleted = await prisma.returnCase.deleteMany({
      where: { id: request.params.id, merchantId },
    });
    if (deleted.count === 0) return reply.code(404).send({ error: 'Dossier introuvable' });

    await recordAudit({
      merchantId,
      actorType: 'USER',
      actorId: userId,
      action: 'return.deleted',
      targetType: 'return',
      targetId: request.params.id,
    });

    return reply.send({ deleted: true });
  });

  /* ------------------------------------------------------------ agences -- */

  app.get('/api/return-agencies', async (request, reply) => {
    const { merchantId } = request.session;
    const agencies = await prisma.returnAgency.findMany({
      where: { merchantId },
      orderBy: [{ country: 'asc' }, { name: 'asc' }],
    });
    return reply.send({ agencies });
  });

  app.post('/api/return-agencies', async (request, reply) => {
    const { merchantId } = request.session;
    const parsed = agencyBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Champs invalides' });

    const agency = await prisma.returnAgency.create({
      data: { merchantId, ...parsed.data },
    });
    return reply.send({ agency });
  });

  app.patch<{ Params: { id: string } }>('/api/return-agencies/:id', async (request, reply) => {
    const { merchantId } = request.session;
    const parsed = agencyBody.partial().safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Champs invalides' });

    const updated = await prisma.returnAgency.updateMany({
      where: { id: request.params.id, merchantId },
      data: parsed.data,
    });
    if (updated.count === 0) return reply.code(404).send({ error: 'Agence introuvable' });

    return reply.send({ updated: true });
  });

  app.delete<{ Params: { id: string } }>('/api/return-agencies/:id', async (request, reply) => {
    const { merchantId } = request.session;
    const deleted = await prisma.returnAgency.deleteMany({
      where: { id: request.params.id, merchantId },
    });
    if (deleted.count === 0) return reply.code(404).send({ error: 'Agence introuvable' });
    return reply.send({ deleted: true });
  });

  /* -------------------------------------------------------------- match -- */

  /**
   * Le match : commandes en attente × stock France.
   *
   * Pour chaque commande non expédiée d'un client FR/ES/IT/BE, on cherche une
   * paire remise en stock du même article — par SKU quand les deux en ont un,
   * sinon par modèle + déclinaison. Le rapprochement se fait ici et pas dans
   * le navigateur : c'est le serveur qui voit les deux listes en entier.
   *
   * Rien ne s'engage tout seul : le match propose, le marchand confie la
   * réexpédition d'un clic — c'est lui qui sait si la commande peut attendre
   * le réemploi ou pas.
   */
  app.get('/api/returns/matches', async (request, reply) => {
    const { merchantId } = request.session;

    const stock = await prisma.returnCase.findMany({
      where: { merchantId, status: 'RESTOCKED', reusedAt: null },
    });
    if (stock.length === 0) return reply.send({ matches: [] });

    let orders;
    try {
      const client = await getShopifyClient(merchantId);
      ({ orders } = await listOrders(client, {
        query: 'fulfillment_status:unfulfilled',
        limit: 100,
      }));
    } catch {
      return reply.send({ matches: [], error: 'Commandes Shopify indisponibles.' });
    }

    const matches = [];
    for (const order of orders) {
      const country = order.shippingAddress?.country ?? null;
      if (!country || !COUNTRIES.includes(country as (typeof COUNTRIES)[number])) continue;

      for (const item of order.lineItems ?? []) {
        const found = stock.find((unit) =>
          unit.sku && item.sku
            ? unit.sku === item.sku
            : unit.productTitle === item.title &&
              (unit.variantTitle ?? '') === (item.variantTitle ?? ''),
        );
        if (!found) continue;

        matches.push({
          returnId: found.id,
          orderName: order.name,
          customer: order.customer?.displayName ?? order.shippingAddress?.name ?? null,
          country,
          productTitle: item.title,
          variantTitle: item.variantTitle ?? null,
          sku: item.sku ?? null,
          fromOrder: found.orderName,
        });
      }
    }

    return reply.send({ matches });
  });
}
