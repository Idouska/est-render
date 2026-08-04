import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { env, shopifyRedirectUri } from '../config/env.ts';
import { recordAudit } from '../lib/audit.ts';
import { encryptSecret, hmacSha256Hex, safeEqual } from '../lib/crypto.ts';
import { logger } from '../lib/logger.ts';
import { prisma } from '../lib/prisma.ts';
import { SESSION_COOKIE, signSession, verifySession } from '../lib/session.ts';
import { requireCredential } from '../services/platform/credentials.ts';

const STATE_COOKIE = 'csav_shopify_state';
const LINK_COOKIE = 'csav_shopify_link';

/**
 * Contexte de rattachement d'une nouvelle boutique, posé avant la redirection
 * vers Shopify et relu au retour.
 *
 * Il traverse un aller-retour hors de notre domaine, donc il est signé : sans
 * ça, n'importe qui pourrait forger un cookie désignant l'organisation d'un
 * autre et y greffer sa propre boutique.
 */
function signLink(payload: { organizationId: string; email: string }): string {
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return `${encoded}.${hmacSha256Hex(env.ENCRYPTION_KEY, encoded)}`;
}

function readLink(token: string | undefined): { organizationId: string; email: string } | null {
  if (!token) return null;
  const [encoded, signature] = token.split('.');
  if (!encoded || !signature) return null;
  if (!safeEqual(signature, hmacSha256Hex(env.ENCRYPTION_KEY, encoded))) return null;

  try {
    return JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

/** Seuls les domaines *.myshopify.com sont acceptés (anti-redirect arbitraire). */
function isValidShopDomain(shop: string): boolean {
  return /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(shop);
}

/**
 * Vérifie le HMAC du callback OAuth Shopify : tous les paramètres sauf `hmac`,
 * triés par clé, concaténés en query string.
 */
async function verifyShopifyHmac(query: Record<string, string>): Promise<boolean> {
  const { hmac, ...rest } = query;
  if (!hmac) return false;

  const secret = await requireCredential(
    'SHOPIFY_API_SECRET',
    'Nécessaire pour vérifier la signature des callbacks Shopify.',
  );

  const message = Object.keys(rest)
    .sort()
    .map((key) => `${key}=${rest[key]}`)
    .join('&');

  return safeEqual(hmac, hmacSha256Hex(secret, message));
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

    // Installation lancée depuis le dashboard : la nouvelle boutique rejoint le
    // groupe de celle où l'utilisateur est déjà connecté, avec son compte.
    const session = verifySession(request.cookies[SESSION_COOKIE]);
    if (session) {
      const user = await prisma.user.findFirst({
        where: { id: session.userId, merchantId: session.merchantId, active: true },
        select: { email: true, role: true, merchant: { select: { organizationId: true } } },
      });

      if (user?.role === 'OWNER' && user.merchant.organizationId) {
        reply.setCookie(
          LINK_COOKIE,
          signLink({ organizationId: user.merchant.organizationId, email: user.email }),
          {
            httpOnly: true,
            secure: env.NODE_ENV === 'production',
            sameSite: 'lax',
            path: '/',
            maxAge: 600,
          },
        );
      }
    }

    const clientId = await requireCredential(
      'SHOPIFY_API_KEY',
      'Nécessaire pour lancer l’installation d’une boutique.',
    );

    const url = new URL(`https://${shop}/admin/oauth/authorize`);
    url.searchParams.set('client_id', clientId);
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

      if (!(await verifyShopifyHmac(request.query))) {
        return reply.code(400).send({ error: 'Signature HMAC invalide' });
      }

      reply.clearCookie(STATE_COOKIE, { path: '/' });

      const tokenResponse = await fetch(`https://${shop}/admin/oauth/access_token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: await requireCredential('SHOPIFY_API_KEY', 'Nécessaire pour l’échange de token.'),
          client_secret: await requireCredential(
            'SHOPIFY_API_SECRET',
            'Nécessaire pour l’échange de token.',
          ),
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

      const link = readLink(request.cookies[LINK_COOKIE]);
      reply.clearCookie(LINK_COOKIE, { path: '/' });

      const existing = await prisma.merchant.findUnique({
        where: { shopDomain: shop },
        select: { id: true, organizationId: true },
      });

      // Une boutique déjà rattachée garde son groupe : la réinstaller ne doit
      // pas la faire changer de propriétaire.
      const organizationId =
        existing?.organizationId ??
        (link?.organizationId
          ? link.organizationId
          : (await prisma.organization.create({ data: { name: shop } })).id);

      const merchant = await prisma.merchant.upsert({
        where: { shopDomain: shop },
        create: { shopDomain: shop, status: 'ACTIVE', organizationId },
        update: { status: 'ACTIVE', organizationId },
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

      // Le propriétaire de la nouvelle boutique est celui qui a lancé
      // l'installation depuis le dashboard ; à défaut — première installation,
      // ou lancement depuis l'App Store — un compte technique lié au domaine.
      const ownerEmail = link?.email ?? `owner@${shop}`;

      const user = await prisma.user.upsert({
        where: { merchantId_email: { merchantId: merchant.id, email: ownerEmail } },
        create: { merchantId: merchant.id, email: ownerEmail, role: 'OWNER' },
        update: { active: true },
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
