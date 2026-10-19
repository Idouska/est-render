import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { recordAudit } from '../lib/audit.ts';
import { prisma } from '../lib/prisma.ts';
import { requirePermission, requireSession } from '../plugins/auth.ts';
import { sendPlainEmail } from '../services/gmail/send.ts';
import { langueAtelier, mailUrgent as texteUrgent } from '../services/suppliers/langueAtelier.ts';
import { etatUpdate, REPORT_JOURS } from '../services/update/colis.ts';

/**
 * La page Update : les colis qui ne bougent plus, et ce qu'on en a demandé.
 *
 * Demander, annuler et « client prévenu » passent par les routes des
 * demandes à l'atelier (`/api/suppliers/:id/alert`, `/api/changes/:id`) :
 * une demande Update est une demande comme les autres, elle s'affiche aussi
 * dans l'espace de l'atelier. Ici, la lecture, la relance et « Attendre encore ».
 */
export async function updateRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireSession);

  app.get<{ Querystring: { compte?: string } }>('/api/updates', async (request, reply) => {
    const { merchantId } = request.session;
    // `?compte=1` : la pastille du menu, sans relire les commandes chez Shopify.
    const etat = await etatUpdate(merchantId, { details: request.query.compte !== '1' });
    const compte = (cle: string) => etat.lignes.filter((ligne) => ligne.etat === cle).length;
    return reply.send({
      ...etat,
      compte: {
        demander: compte('DEMANDER'),
        attente: compte('ATTENTE'),
        aRelancer: etat.lignes.filter((ligne) => ligne.aRelancer).length,
        repondues: compte('REPONDUE'),
      },
    });
  });

  /** « Attendre encore » : le colis sort de « À demander » pour quelques jours. */
  app.post('/api/updates/reporter', { preHandler: requirePermission('reply') }, async (request, reply) => {
    const parsed = z.object({ orderId: z.string().min(1).max(120) }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Commande invalide' });
    const { merchantId, userId } = request.session;
    const jusqua = new Date(Date.now() + REPORT_JOURS * 86_400_000);
    await prisma.updateReporte.upsert({
      where: { merchantId_shopifyOrderId: { merchantId, shopifyOrderId: parsed.data.orderId } },
      create: { merchantId, shopifyOrderId: parsed.data.orderId, jusqua, userId },
      update: { jusqua, userId },
    });
    return reply.send({ jusqua });
  });

  /*
   * Relancer l'atelier resté muet : le même mail, tout de suite, et la date
   * de relance notée — la ligne repasse au gris pour deux jours.
   */
  app.post<{ Params: { id: string } }>(
    '/api/updates/:id/relancer',
    { preHandler: requirePermission('escalate') },
    async (request, reply) => {
      const { merchantId, userId } = request.session;
      const demande = await prisma.supplierAlert.findFirst({
        where: { id: request.params.id, merchantId, kind: 'TRACKING', status: 'PENDING' },
        select: {
          id: true,
          merchantId: true,
          kind: true,
          orderName: true,
          beforeValue: true,
          afterValue: true,
          message: true,
          supplier: { select: { name: true, contactEmail: true, langue: true } },
        },
      });
      if (!demande) return reply.code(404).send({ error: 'Demande introuvable, ou déjà répondue.' });

      try {
        await sendPlainEmail({
          merchantId,
          to: demande.supplier.contactEmail,
          ...texteUrgent(demande, langueAtelier(demande.supplier.langue)),
        });
      } catch (error) {
        request.log.warn({ err: error, alertId: demande.id }, 'Relance Update non envoyée');
        return reply.code(502).send({ error: `Le mail de relance n’est pas parti chez ${demande.supplier.name}.` });
      }
      await prisma.supplierAlert.update({ where: { id: demande.id }, data: { remindedAt: new Date(), emailedAt: new Date() } });
      await recordAudit({
        merchantId,
        actorType: 'USER',
        actorId: userId,
        action: 'update.reminded',
        targetType: 'SupplierAlert',
        targetId: demande.id,
        ipAddress: request.ip,
      });
      return reply.send({ relance: true });
    },
  );
}
