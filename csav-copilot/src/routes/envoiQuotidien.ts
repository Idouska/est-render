import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { recordAudit } from '../lib/audit.ts';
import { prisma } from '../lib/prisma.ts';
import { requirePermission, requireSession } from '../plugins/auth.ts';
import { lotsRecents } from '../services/envoi/lots.ts';
import { envoyerAuxFournisseurs, etatDuJour } from '../services/envoi/quotidien.ts';
import { ShopifyError } from '../services/shopify/client.ts';

/**
 * L'écran « Commandes du jour » : contrôler, puis envoyer au fournisseur.
 *
 * La réservation d'une paire du stock n'a pas de route ici : c'est celle du
 * réemploi (`POST /api/returns/reemploi`), qui revérifie tout au moment du
 * clic. Une commande réservée sort d'elle-même du lot à envoyer.
 */
export async function envoiQuotidienRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireSession);

  app.get('/api/envoi-du-jour', async (request, reply) => {
    const { merchantId } = request.session;

    const [etat, envois, lots] = await Promise.all([
      etatDuJour(merchantId).catch((error: unknown) => {
        if (error instanceof ShopifyError) return null;
        throw error;
      }),
      prisma.envoiFournisseur.findMany({
        where: { merchantId },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: {
          id: true,
          mode: true,
          combien: true,
          emailedAt: true,
          erreur: true,
          simule: true,
          createdAt: true,
          supplier: { select: { name: true } },
        },
      }),
      // Ce que l'atelier a fait de chaque lot : sans lui écrire, on voit où
      // en est chaque commande.
      lotsRecents({ merchantId }),
    ]);

    if (!etat) {
      return reply.code(502).send({ error: 'Commandes Shopify indisponibles pour le moment.', envois, lots });
    }
    return reply.send({ ...etat, envois, lots });
  });

  app.post(
    '/api/envoi-du-jour/envoyer',
    { preHandler: requirePermission('escalate') },
    async (request, reply) => {
      const { merchantId, userId } = request.session;
      const resultats = await envoyerAuxFournisseurs({ merchantId, mode: 'MANUEL', userId });

      await recordAudit({
        merchantId,
        actorType: 'USER',
        actorId: userId,
        action: 'envoi_du_jour.sent',
        targetType: 'Merchant',
        targetId: merchantId,
        metadata: { resultats: resultats.map(({ fournisseur, combien, parti }) => ({ fournisseur, combien, parti })) },
        ipAddress: request.ip,
      });

      return reply.send({ resultats });
    },
  );

  app.patch(
    '/api/envoi-du-jour/reglage',
    { preHandler: requirePermission('configure') },
    async (request, reply) => {
      const parsed = z
        .object({
          mode: z.enum(['MANUEL', 'AUTO']),
          heure: z.number().int().min(0).max(23),
          // Jours laissés à l'atelier avant qu'une commande soit en retard.
          delaiJours: z.number().int().min(1).max(30).optional(),
        })
        .safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: 'Réglage invalide' });

      const { merchantId, userId } = request.session;
      await prisma.merchant.update({
        where: { id: merchantId },
        data: {
          envoiMode: parsed.data.mode,
          envoiHeure: parsed.data.heure,
          ...(parsed.data.delaiJours ? { lotDelaiJours: parsed.data.delaiJours } : {}),
        },
      });
      await recordAudit({
        merchantId,
        actorType: 'USER',
        actorId: userId,
        action: 'envoi_du_jour.setting',
        targetType: 'Merchant',
        targetId: merchantId,
        metadata: parsed.data,
        ipAddress: request.ip,
      });
      return reply.send({ ok: true });
    },
  );
}
