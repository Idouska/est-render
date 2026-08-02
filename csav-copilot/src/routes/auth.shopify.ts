import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { env, shopifyRedirectUri } from '../config/env.ts';
import { recordAudit } from '../lib/audit.ts';
import { encryptSecret, hmacSha256Hex, safeEqual } from '../lib/crypto.ts';
import { logger } from '../lib/logger.ts';
import { prisma } from '../lib/prisma.ts';
import { SESSION_COOKIE, signSession } from '../lib/session.ts';

const STATE_COOKIE = 'csav_shopify_state';

/** Seuls les domaines *.myshopify.com sont acceptés (anti-redirect arbitraire). */
function isValidShopDomain(shop: string): boolean {
  return /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(shop);
}

/**
 * Vérifie le HMAC du callback OAuth Shopify : tous les paramètres sauf `hmac`,
 * triés par clé, concaténés en query string.
 */
function verifyShopifyHmac(query: Record<string, string>): boolean {
  const { hmac, ...rest } = query;
  if (!hmac) return false;

  const message = Object.keys(rest)
    .sort()
    .map((key) => `${key}=${rest[key]}`)
    .join('&');

  return safeEqual(hmac, hmacSha256Hex(env.SHOPIFY_API_SECRET, message));
}

export async function shopifyAuthRoutes(app: FastifyInstance): Promise<void> {
  // Étape 1 — redirection vers l'écran d'autorisation Shopify.
  app.get<{ Querystring: { shop?: string } }>('/auth/shopify', async (request, reply) => {
    const shop = request.query.shop?.toLowerCase();

    if (!shop || !isValidShopDomain(shop)) {
      return reply.code(400).send({ error: 'Paramètre `shop` manquant ou invalide' });
    }

    const state = randomBytes(24).toString('hex');

    reply.setCookie(STATE_COOKIE, state, {
      httpOnly: true,
      secure: env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 600,
    });

    const url = new URL(`https://${shop}/admin/oauth/authorize`);
    url.searchParams.set('client_id', env.SHOPIFY_API_KEY);
    url.searchParams.set('scope', env.SHOPIFY_SCOPES.join(','));
    url.searchParams.set('redirect_uri', shopifyRedirectUri);
    url.searchParams.set('state', state);

    return reply.redirect(url.toString());
  });

  // Étape 2 — échange du code contre un access token permanent.
  app.get<{ Querystring: Record<string, string> }>(
    '/auth/shopify/callback',
    async (request, reply) => {
      const { shop, code, state } = request.query;

      if (!shop || !code || !isValidShopDomain(shop)) {
        return reply.code(400).send({ error: 'Callback Shopify invalide' });
      }

      const expectedState = request.cookies[STATE_COOKIE];
      if (!expectedState || !state || !safeEqual(state, expectedState)) {
        return reply.code(400).send({ error: 'State OAuth invalide' });
      }

      if (!verifyShopifyHmac(request.query)) {
        return reply.code(400).send({ error: 'Signature HMAC invalide' });
      }

      reply.clearCookie(STATE_COOKIE, { path: '/' });

      const tokenResponse = await fetch(`https://${shop}/admin/oauth/access_token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: env.SHOPIFY_API_KEY,
          client_secret: env.SHOPIFY_API_SECRET,
          code,
        }),
      });

      if (!tokenResponse.ok) {
        logger.error({ shop, status: tokenResponse.status }, 'Échange de token Shopify en échec');
        return reply.code(502).send({ error: 'Shopify a refusé l’échange de token' });
      }

      const { access_token: accessToken, scope } = (await tokenResponse.json()) as {
        access_token: string;
        scope: string;
      };

      const merchant = await prisma.merchant.upsert({
        where: { shopDomain: shop },
        create: { shopDomain: shop, status: 'ACTIVE' },
        update: { status: 'ACTIVE' },
      });

      await prisma.shopifyConnection.upsert({
        where: { merchantId: merchant.id },
        create: {
          merchantId: merchant.id,
          accessTokenEnc: encryptSecret(accessToken),
          scopes: scope,
        },
        update: {
          accessTokenEnc: encryptSecret(accessToken),
          scopes: scope,
          uninstalledAt: null,
        },
      });

      // Un utilisateur propriétaire par défaut : le multi-agent viendra plus tard.
      const user = await prisma.user.upsert({
        where: { merchantId_email: { merchantId: merchant.id, email: `owner@${shop}` } },
        create: { merchantId: merchant.id, email: `owner@${shop}`, role: 'OWNER' },
        update: {},
      });

      await recordAudit({
        merchantId: merchant.id,
        actorType: 'USER',
        actorId: user.id,
        action: 'shopify.connected',
        metadata: { scopes: scope },
        ipAddress: request.ip,
      });

      reply.setCookie(SESSION_COOKIE, signSession({ merchantId: merchant.id, userId: user.id }), {
        httpOnly: true,
        secure: env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
      });

      // Prochaine étape de l'onboarding : connecter la boîte Gmail.
      return reply.redirect('/auth/google');
    },
  );
}
