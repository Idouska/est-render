import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { recordAudit } from '../lib/audit.ts';
import { prisma } from '../lib/prisma.ts';
import { requirePermission, requireSession } from '../plugins/auth.ts';
import { COUT_MAX, lireCoutsUnitaires, moisJusqua, type CoutsUnitaires } from '../services/couts/calcul.ts';
import { commandesParMois, moisVisibles } from '../services/couts/commandes.ts';
import { coutsDuSav, MOIS_AFFICHES } from '../services/couts/donnees.ts';
import { getShopifyClient, ShopifyError } from '../services/shopify/client.ts';
import { moisCourant } from '../services/suppliers/releve.ts';

/**
 * Ce que coûte le SAV, mois par mois.
 *
 * Tout se calcule à la demande depuis les dossiers de retour, comme les
 * statistiques : une table d'agrégats serait une vérité de plus à tenir.
 */

const montant = z.number().min(0).max(COUT_MAX);
const unitaires = z.object({
  bonRetour: montant,
  fraisAgence: montant,
  colisAgence: montant,
  colisAtelier: montant,
  prixPaire: montant,
}) satisfies z.ZodType<CoutsUnitaires>;

export async function coutsRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireSession);

  app.get('/api/couts', async (request, reply) => reply.send(await coutsDuSav(request.session.merchantId)));

  /**
   * Les commandes de chaque mois que Shopify laisse voir.
   *
   * Route à part, comme les chiffres de la boutique dans les statistiques :
   * Shopify peut être lent ou tomber, et les coûts s'affichent sans lui.
   */
  app.get('/api/couts/commandes', async (request, reply) => {
    const { merchantId } = request.session;
    const connexion = await prisma.shopifyConnection.findUnique({ where: { merchantId }, select: { scopes: true } });
    const toutVoir = (connexion?.scopes ?? '').split(',').some((scope) => scope.trim() === 'read_all_orders');
    const mois = moisVisibles(moisJusqua(moisCourant(), MOIS_AFFICHES + 1), new Date(), toutVoir);
    try {
      const client = await getShopifyClient(merchantId);
      return reply.send({ commandes: await commandesParMois(client, mois) });
    } catch (error) {
      if (error instanceof ShopifyError) return reply.code(502).send({ error: 'Shopify n’a pas répondu.' });
      throw error;
    }
  });

  app.put('/api/couts/unitaires', { preHandler: requirePermission('configure') }, async (request, reply) => {
    const { merchantId, userId } = request.session;
    const parsed = unitaires.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: `Chaque montant doit être compris entre 0 et ${COUT_MAX} €.` });
    }

    const couts = lireCoutsUnitaires(parsed.data);
    await prisma.merchant.update({ where: { id: merchantId }, data: { coutsSav: couts } });
    await recordAudit({
      merchantId,
      actorType: 'USER',
      actorId: userId,
      action: 'couts.updated',
      targetType: 'merchant',
      targetId: merchantId,
      metadata: couts,
    });
    return reply.send({ couts });
  });
}
