import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { env } from '../config/env.ts';
import { recordAudit } from '../lib/audit.ts';
import { hmacSha256Hex, safeEqual } from '../lib/crypto.ts';
import { logger } from '../lib/logger.ts';
import { prisma } from '../lib/prisma.ts';
import { requirePermission, requireSession } from '../plugins/auth.ts';
import { getShopifyClient } from '../services/shopify/client.ts';
import { createRefund, getRefundableTransactions } from '../services/shopify/refunds.ts';

const refundBody = z.object({
  ticketId: z.string().optional(),
  orderId: z.string().min(1),
  amount: z.string().regex(/^\d+(\.\d{1,2})?$/, 'Montant attendu au format 12.34'),
  reason: z.string().min(3).max(500),
  /**
   * Jeton renvoyé par GET /api/refunds/preview. Sa présence prouve que
   * l'utilisateur est passé par la modale de confirmation : pas de
   * remboursement en un clic depuis la file de tickets.
   */
  confirmationToken: z.string().min(1),
});

export async function refundRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireSession);

  /**
   * Étape 1 — aperçu. Renvoie le montant remboursable et un jeton de
   * confirmation à re-présenter au POST. Aucune écriture côté Shopify.
   */
  app.get<{ Querystring: { orderId?: string } }>(
    '/api/refunds/preview',
    async (request, reply) => {
      const { merchantId } = request.session;
      const orderId = request.query.orderId;

      if (!orderId) return reply.code(400).send({ error: 'orderId requis' });

      const shopify = await getShopifyClient(merchantId);
      const refundable = await getRefundableTransactions(shopify, orderId);

      if (refundable.transactions.length === 0) {
        return reply.code(409).send({
          error: 'Aucune transaction remboursable sur cette commande',
        });
      }

      return reply.send({
        ...refundable,
        confirmationToken: buildConfirmationToken(merchantId, orderId),
      });
    },
  );

  /**
   * Étape 2 — exécution. Action financière irréversible : on trace avant
   * l'appel Shopify (pour ne rien perdre en cas de crash), puis on complète.
   */
  app.post('/api/refunds', { preHandler: requirePermission('refund') }, async (request, reply) => {
    const parsed = refundBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Requête invalide', details: parsed.error.issues });
    }

    const { merchantId, userId } = request.session;
    const { orderId, amount, reason, ticketId, confirmationToken } = parsed.data;

    if (!isValidConfirmationToken(confirmationToken, merchantId, orderId)) {
      return reply.code(400).send({
        error: 'Confirmation manquante ou expirée. Rouvrez la modale de remboursement.',
      });
    }

    if (ticketId) {
      const ticket = await prisma.ticket.findFirst({
        where: { id: ticketId, merchantId },
        select: { id: true },
      });
      if (!ticket) return reply.code(404).send({ error: 'Ticket introuvable' });
    }

    const shopify = await getShopifyClient(merchantId);
    const refundable = await getRefundableTransactions(shopify, orderId);
    const transaction = refundable.transactions[0];

    if (!transaction) {
      return reply.code(409).send({ error: 'Aucune transaction remboursable' });
    }

    if (Number(amount) <= 0 || Number(amount) > Number(refundable.refundableAmount)) {
      return reply.code(400).send({
        error: `Montant hors limites (max ${refundable.refundableAmount} ${refundable.currency})`,
      });
    }

    const kind = Number(amount) === Number(refundable.refundableAmount) ? 'FULL' : 'PARTIAL';

    const record = await prisma.refund.create({
      data: {
        merchantId,
        ticketId: ticketId ?? null,
        shopifyOrderId: orderId,
        amount,
        currency: refundable.currency,
        reason,
        kind,
        status: 'PENDING',
        requestedByUserId: userId,
      },
    });

    await recordAudit({
      merchantId,
      actorType: 'USER',
      actorId: userId,
      action: 'refund.requested',
      targetType: 'Refund',
      targetId: record.id,
      metadata: { orderId, amount, currency: refundable.currency, reason, kind },
      ipAddress: request.ip,
    });

    try {
      const { refundId } = await createRefund(shopify, {
        orderId,
        amount,
        currency: refundable.currency,
        gateway: transaction.gateway,
        parentTransactionId: transaction.id,
        reason,
      });

      await prisma.refund.update({
        where: { id: record.id },
        data: { status: 'COMPLETED', shopifyRefundId: refundId, completedAt: new Date() },
      });

      await recordAudit({
        merchantId,
        actorType: 'USER',
        actorId: userId,
        action: 'refund.completed',
        targetType: 'Refund',
        targetId: record.id,
        metadata: { shopifyRefundId: refundId },
        ipAddress: request.ip,
      });

      return reply.send({ id: record.id, shopifyRefundId: refundId, status: 'COMPLETED' });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erreur inconnue';
      logger.error({ merchantId, refundId: record.id, err: error }, 'Remboursement en échec');

      await prisma.refund.update({
        where: { id: record.id },
        data: { status: 'FAILED', errorMessage: message },
      });

      await recordAudit({
        merchantId,
        actorType: 'USER',
        actorId: userId,
        action: 'refund.failed',
        targetType: 'Refund',
        targetId: record.id,
        metadata: { error: message },
        ipAddress: request.ip,
      });

      return reply.code(502).send({ error: `Shopify a refusé le remboursement : ${message}` });
    }
  });

  app.get('/api/refunds', async (request, reply) => {
    const { merchantId } = request.session;
    const refunds = await prisma.refund.findMany({
      where: { merchantId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return reply.send({ refunds });
  });
}

const CONFIRMATION_WINDOW_MS = 15 * 60 * 1000;

/**
 * Jeton de confirmation signé, lié au marchand, à la commande et à une fenêtre
 * de 15 minutes. Il n'est délivré que par l'endpoint d'aperçu : impossible à
 * fabriquer côté client, donc impossible de rembourser sans passer par la modale.
 */
function buildConfirmationToken(merchantId: string, orderId: string, bucket?: number): string {
  const slot = bucket ?? Math.floor(Date.now() / CONFIRMATION_WINDOW_MS);
  return hmacSha256Hex(env.ENCRYPTION_KEY, `refund:${merchantId}:${orderId}:${slot}`);
}

/** Accepte la fenêtre courante et la précédente, pour ne pas invalider une
 *  confirmation ouverte juste avant un changement de fenêtre. */
function isValidConfirmationToken(
  token: string,
  merchantId: string,
  orderId: string,
): boolean {
  const current = Math.floor(Date.now() / CONFIRMATION_WINDOW_MS);
  return (
    safeEqual(token, buildConfirmationToken(merchantId, orderId, current)) ||
    safeEqual(token, buildConfirmationToken(merchantId, orderId, current - 1))
  );
}
