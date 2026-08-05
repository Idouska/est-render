import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { env } from '../config/env.ts';
import { recordAudit } from '../lib/audit.ts';
import { prisma } from '../lib/prisma.ts';
import { SESSION_COOKIE, signSession } from '../lib/session.ts';
import { requirePermission, requireSession } from '../plugins/auth.ts';

/**
 * Multi-boutique.
 *
 * L'isolation reste portée par `merchantId` : basculer de boutique ne mélange
 * rien, ça ré-émet simplement une session sur un autre marchand. Le droit d'y
 * basculer n'est pas déduit de l'organisation seule — il faut aussi un compte
 * actif portant le même email sur la boutique cible. Autrement, ajouter une
 * boutique au groupe donnerait rétroactivement accès à tout le monde.
 */

/** Boutiques du même groupe où l'utilisateur courant possède un compte actif. */
export async function listShopsFor(merchantId: string, email: string) {
  const current = await prisma.merchant.findUnique({
    where: { id: merchantId },
    select: { organizationId: true },
  });

  const merchants = await prisma.merchant.findMany({
    where: current?.organizationId
      ? { organizationId: current.organizationId }
      : { id: merchantId },
    select: {
      id: true,
      shopDomain: true,
      name: true,
      brandName: true,
      logoUrl: true,
      status: true,
      users: { where: { email, active: true }, select: { id: true, role: true } },
    },
    orderBy: { createdAt: 'asc' },
  });

  return merchants
    .filter((merchant) => merchant.users.length > 0)
    .map((merchant, index) => ({
      id: merchant.id,
      shopDomain: merchant.shopDomain,
      label: merchant.brandName || merchant.name || merchant.shopDomain.replace('.myshopify.com', ''),
      logoUrl: merchant.logoUrl,
      status: merchant.status,
      color: SHOP_COLORS[index % SHOP_COLORS.length],
      role: merchant.users[0]!.role,
      userId: merchant.users[0]!.id,
      current: merchant.id === merchantId,
    }));
}

/**
 * Boutiques que l'utilisateur courant a le droit de lire d'un seul tenant.
 *
 * C'est la seule dérogation à la règle « une requête, un `merchantId` », et
 * elle est volontairement étroite : la liste est recalculée à chaque appel à
 * partir des comptes actifs portant l'email de la session, jamais à partir de
 * ce que le navigateur envoie. Un identifiant de boutique reçu du client n'est
 * donc utilisable que s'il figure déjà ici.
 *
 * Réservée aux écrans de lecture. Toute écriture reste scopée au `merchantId`
 * de la session : on consulte plusieurs boutiques, on n'en modifie qu'une.
 */
export async function accessibleMerchantIds(session: {
  merchantId: string;
  email: string;
}): Promise<string[]> {
  const shops = await listShopsFor(session.merchantId, session.email);
  return shops.length > 0 ? shops.map((shop) => shop.id) : [session.merchantId];
}

/**
 * Couleur d'une boutique, stable dans le temps.
 *
 * Dérivée du rang dans le groupe plutôt que stockée : une couleur en base
 * demanderait un réglage de plus à remplir, et l'ordre de création ne change
 * jamais.
 */
export const SHOP_COLORS = [
  '#2f6fe4',
  '#e5484d',
  '#059669',
  '#d97706',
  '#6c5ce7',
  '#0891b2',
  '#be123c',
  '#475569',
] as const;

export async function shopRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireSession);

  app.get('/api/shops', async (request, reply) => {
    const { merchantId, email } = request.session;
    return reply.send({ shops: await listShopsFor(merchantId, email) });
  });

  app.post('/api/shops/switch', async (request, reply) => {
    const parsed = z.object({ merchantId: z.string().min(1) }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Boutique invalide' });

    const { merchantId, email, userId } = request.session;
    const target = (await listShopsFor(merchantId, email)).find(
      (shop) => shop.id === parsed.data.merchantId,
    );

    if (!target) {
      return reply.code(403).send({ error: 'Vous n’avez pas de compte sur cette boutique.' });
    }

    await recordAudit({
      merchantId,
      actorType: 'USER',
      actorId: userId,
      action: 'shop.switched',
      targetType: 'Merchant',
      targetId: target.id,
      ipAddress: request.ip,
    });

    reply.setCookie(SESSION_COOKIE, signSession({ merchantId: target.id, userId: target.userId }), {
      httpOnly: true,
      secure: env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
    });

    return reply.send({ shop: { id: target.id, label: target.label } });
  });

  /**
   * Prépare l'ajout d'une boutique : renvoie l'URL d'installation Shopify.
   *
   * Le rattachement au groupe se joue côté callback, à partir de la session en
   * cours — c'est pour ça que le lien s'ouvre dans le même onglet.
   */
  app.post('/api/shops/connect', { preHandler: requirePermission('configure') }, async (request, reply) => {
    const parsed = z
      .object({ shopDomain: z.string().min(3).max(120) })
      .safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Domaine invalide' });

    // On accepte « ma-boutique » comme « ma-boutique.myshopify.com » : le
    // marchand connaît rarement son domaine technique par cœur.
    const raw = parsed.data.shopDomain.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    const shop = raw.endsWith('.myshopify.com') ? raw : `${raw}.myshopify.com`;

    if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop)) {
      return reply.code(400).send({ error: 'Domaine Shopify invalide (ex. ma-boutique.myshopify.com).' });
    }

    const existing = await prisma.merchant.findUnique({
      where: { shopDomain: shop },
      select: { id: true, organizationId: true },
    });

    const current = await prisma.merchant.findUnique({
      where: { id: request.session.merchantId },
      select: { organizationId: true },
    });

    // Une boutique déjà rattachée ailleurs ne peut pas être aspirée par un autre
    // groupe : ce serait un moyen d'accéder aux données d'un tiers en devinant
    // son domaine.
    if (existing && existing.organizationId && existing.organizationId !== current?.organizationId) {
      return reply.code(409).send({
        error: 'Cette boutique est déjà rattachée à un autre compte.',
      });
    }

    return reply.send({ installUrl: `/auth/shopify?shop=${encodeURIComponent(shop)}` });
  });
}
