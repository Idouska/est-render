import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { env } from '../config/env.ts';
import { recordAudit } from '../lib/audit.ts';
import { prisma } from '../lib/prisma.ts';
import { requirePermission, requireSession } from '../plugins/auth.ts';

/**
 * Réglages du marchand.
 *
 * Rien ici ne demande de coller une clé d'API : les accès Shopify et Gmail
 * s'obtiennent par OAuth (boutons connecter/déconnecter), et les identifiants
 * de la plateforme appartiennent à l'éditeur, pas au marchand — ils se règlent
 * dans la console d'administration (`/admin`).
 *
 * Ce que le marchand décide vraiment : le degré d'autonomie laissé à l'IA, et
 * la durée de conservation de ses données.
 */

const patchBody = z
  .object({
    name: z.string().min(1).max(200).nullable().optional(),
    autoSendEnabled: z.boolean().optional(),
    // Un seuil sous 0,5 reviendrait à envoyer des réponses que le modèle
    // lui-même juge douteuses. Le plancher est volontairement haut.
    autoSendThreshold: z.number().min(0.5).max(1).optional(),
    // 30 jours au minimum pour rester exploitable, 3 ans au maximum : au-delà,
    // la conservation devient difficile à justifier au titre du RGPD.
    retentionDays: z.number().int().min(30).max(1095).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Aucun champ à mettre à jour',
  });

export async function settingsRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireSession);

  app.get('/api/settings', async (request, reply) => {
    const { merchantId } = request.session;

    const merchant = await prisma.merchant.findUnique({
      where: { id: merchantId },
      include: {
        shopify: { select: { installedAt: true, uninstalledAt: true, scopes: true } },
        gmail: { select: { emailAddress: true, watchExpiration: true, createdAt: true } },
      },
    });

    if (!merchant) return reply.code(404).send({ error: 'Marchand introuvable' });

    return reply.send({
      merchant: {
        name: merchant.name,
        shopDomain: merchant.shopDomain,
        status: merchant.status,
        autoSendEnabled: merchant.autoSendEnabled,
        autoSendThreshold: merchant.autoSendThreshold,
        retentionDays: merchant.retentionDays,
      },
      connections: {
        shopify: {
          connected: Boolean(merchant.shopify && !merchant.shopify.uninstalledAt),
          simulated: env.SHOPIFY_MOCK,
          scopes: merchant.shopify?.scopes?.split(',').filter(Boolean) ?? [],
          installedAt: merchant.shopify?.installedAt ?? null,
        },
        gmail: {
          connected: Boolean(merchant.gmail),
          simulated: env.GMAIL_MOCK,
          emailAddress: merchant.gmail?.emailAddress ?? null,
          connectedAt: merchant.gmail?.createdAt ?? null,
          // Le watch expire au bout de 7 jours. Expiré, plus rien n'entre —
          // sans la moindre erreur visible ailleurs.
          watchExpiration: merchant.gmail?.watchExpiration ?? null,
          watchActive: Boolean(
            merchant.gmail?.watchExpiration && merchant.gmail.watchExpiration > new Date(),
          ),
        },
      },
    });
  });

  app.patch('/api/settings', { preHandler: requirePermission('configure') }, async (request, reply) => {
    const parsed = patchBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Requête invalide', details: parsed.error.issues });
    }

    const { merchantId, userId } = request.session;

    // L'envoi automatique fait partir des mails sans relecture : on refuse de
    // l'activer tant que Gmail n'est pas connecté, sinon le réglage promet un
    // comportement que rien ne peut exécuter.
    if (parsed.data.autoSendEnabled === true) {
      const gmail = await prisma.gmailConnection.findUnique({
        where: { merchantId },
        select: { id: true },
      });
      if (!gmail && !env.GMAIL_MOCK) {
        return reply.code(409).send({
          error: 'Connectez une boîte Gmail avant d’activer l’envoi automatique.',
        });
      }
    }

    const merchant = await prisma.merchant.update({
      where: { id: merchantId },
      data: parsed.data,
    });

    await recordAudit({
      merchantId,
      actorType: 'USER',
      actorId: userId,
      action: 'merchant.settings_updated',
      targetType: 'Merchant',
      targetId: merchantId,
      // On consigne les champs touchés, pas seulement le fait qu'il y a eu une
      // modification : activer l'envoi automatique doit être traçable.
      metadata: parsed.data,
      ipAddress: request.ip,
    });

    return reply.send({
      merchant: {
        name: merchant.name,
        shopDomain: merchant.shopDomain,
        status: merchant.status,
        autoSendEnabled: merchant.autoSendEnabled,
        autoSendThreshold: merchant.autoSendThreshold,
        retentionDays: merchant.retentionDays,
      },
    });
  });
}
