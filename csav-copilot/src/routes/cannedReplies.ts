import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { recordAudit } from '../lib/audit.ts';
import { prisma } from '../lib/prisma.ts';
import { requirePermission, requireSession } from '../plugins/auth.ts';

/**
 * Réponses types.
 *
 * Cinq questions font les deux tiers du volume d'un SAV : où est mon colis,
 * mauvaise taille, délai douane, changement d'adresse, retour. Faire rédiger
 * une IA à chaque fois pour un texte qui n'a pas changé depuis six mois est du
 * temps et de l'argent perdus — et l'agent relit quand même.
 */

const INTENTS = [
  'WISMO',
  'RETURN',
  'DISPUTE',
  'REFUND',
  'PRODUCT_QUESTION',
  'POSITIVE',
  'OTHER',
] as const;

const body = z.object({
  title: z.string().min(1).max(120),
  body: z.string().min(1).max(8000),
  intent: z.enum(INTENTS).nullish(),
});

export async function cannedReplyRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireSession);

  app.get('/api/canned-replies', async (request, reply) => {
    const replies = await prisma.cannedReply.findMany({
      where: { merchantId: request.session.merchantId },
      // Les plus utilisées d'abord : le classement se fait à l'usage, sans
      // demander à personne de ranger la liste.
      orderBy: [{ useCount: 'desc' }, { title: 'asc' }],
    });

    return reply.send({ replies });
  });

  app.post(
    '/api/canned-replies',
    { preHandler: requirePermission('configure') },
    async (request, reply) => {
      const parsed = body.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: 'Réponse type invalide' });

      const { merchantId, userId } = request.session;

      const existing = await prisma.cannedReply.findFirst({
        where: { merchantId, title: parsed.data.title },
        select: { id: true },
      });
      if (existing) {
        return reply.code(409).send({ error: 'Une réponse type porte déjà ce titre.' });
      }

      const created = await prisma.cannedReply.create({
        data: {
          merchantId,
          title: parsed.data.title,
          body: parsed.data.body,
          intent: parsed.data.intent ?? null,
        },
      });

      await recordAudit({
        merchantId,
        actorType: 'USER',
        actorId: userId,
        action: 'canned_reply.created',
        targetType: 'CannedReply',
        targetId: created.id,
        metadata: { title: created.title },
        ipAddress: request.ip,
      });

      return reply.send({ reply: created });
    },
  );

  app.patch<{ Params: { id: string } }>(
    '/api/canned-replies/:id',
    { preHandler: requirePermission('configure') },
    async (request, reply) => {
      const parsed = body.partial().safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: 'Réponse type invalide' });

      const { merchantId } = request.session;

      const target = await prisma.cannedReply.findFirst({
        where: { id: request.params.id, merchantId },
        select: { id: true },
      });
      if (!target) return reply.code(404).send({ error: 'Réponse type introuvable' });

      const updated = await prisma.cannedReply.update({
        where: { id: target.id },
        data: parsed.data,
      });

      return reply.send({ reply: updated });
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/api/canned-replies/:id',
    { preHandler: requirePermission('configure') },
    async (request, reply) => {
      const { merchantId } = request.session;

      const target = await prisma.cannedReply.findFirst({
        where: { id: request.params.id, merchantId },
        select: { id: true },
      });
      if (!target) return reply.code(404).send({ error: 'Réponse type introuvable' });

      await prisma.cannedReply.delete({ where: { id: target.id } });
      return reply.send({ ok: true });
    },
  );

  /** Compte une insertion : c'est ce compteur qui trie la liste. */
  app.post<{ Params: { id: string } }>(
    '/api/canned-replies/:id/used',
    { preHandler: requirePermission('reply') },
    async (request, reply) => {
      const { merchantId } = request.session;

      const target = await prisma.cannedReply.findFirst({
        where: { id: request.params.id, merchantId },
        select: { id: true },
      });
      if (!target) return reply.code(404).send({ error: 'Réponse type introuvable' });

      await prisma.cannedReply.update({
        where: { id: target.id },
        data: { useCount: { increment: 1 } },
      });

      return reply.send({ ok: true });
    },
  );
}
