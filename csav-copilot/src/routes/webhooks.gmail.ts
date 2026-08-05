import type { FastifyInstance } from 'fastify';
import { OAuth2Client } from 'google-auth-library';
import { env } from '../config/env.ts';
import { hmacSha256Base64, safeEqual } from '../lib/crypto.ts';
import { logger } from '../lib/logger.ts';
import { prisma } from '../lib/prisma.ts';
import { enqueueIngest } from '../queue/index.ts';
import { requireCredential } from '../services/platform/credentials.ts';

interface PubSubPushBody {
  message?: {
    data?: string;
    messageId?: string;
    publishTime?: string;
  };
  subscription?: string;
}

interface GmailNotification {
  emailAddress: string;
  historyId: number | string;
}

const verifier = new OAuth2Client();

/**
 * Vérifie le JWT OIDC posé par Pub/Sub dans l'en-tête Authorization.
 * Sans ça, l'endpoint est ouvert : n'importe qui pourrait déclencher des
 * ingestions au nom d'un marchand.
 */
async function verifyPubSubToken(authorization: string | undefined): Promise<boolean> {
  if (!authorization?.startsWith('Bearer ')) return false;

  try {
    const ticket = await verifier.verifyIdToken({
      idToken: authorization.slice('Bearer '.length),
      audience: `${env.APP_URL}/webhooks/gmail`,
    });
    const payload = ticket.getPayload();
    if (!payload) return false;

    const expected = await requireCredential(
      'GOOGLE_PUBSUB_SERVICE_ACCOUNT',
      'Nécessaire pour authentifier les notifications Gmail.',
    );

    return payload.email === expected && payload.email_verified === true;
  } catch (error) {
    logger.warn({ err: error }, 'JWT Pub/Sub invalide');
    return false;
  }
}

export async function gmailWebhookRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: PubSubPushBody }>('/webhooks/gmail', async (request, reply) => {
    if (!(await verifyPubSubToken(request.headers.authorization))) {
      return reply.code(401).send({ error: 'Notification non authentifiée' });
    }

    const data = request.body.message?.data;
    if (!data) {
      // Message mal formé : on acquitte pour éviter que Pub/Sub le rejoue en boucle.
      return reply.code(204).send();
    }

    let notification: GmailNotification;
    try {
      notification = JSON.parse(Buffer.from(data, 'base64').toString('utf8'));
    } catch {
      return reply.code(204).send();
    }

    // L'adresse notifiée désigne la boîte, et la boîte désigne le marchand :
    // avec plusieurs boîtes par boutique, c'est le seul routage fiable.
    const connection = await prisma.gmailConnection.findFirst({
      where: { emailAddress: notification.emailAddress },
      select: { id: true, merchantId: true, merchant: { select: { status: true } } },
    });

    if (!connection || connection.merchant.status !== 'ACTIVE') {
      logger.warn(
        { emailAddress: notification.emailAddress },
        'Notification Gmail pour une boîte inconnue ou inactive',
      );
      return reply.code(204).send();
    }

    // On acquitte tout de suite et on traite en asynchrone : Pub/Sub réessaie
    // si la réponse tarde, ce qui multiplierait les ingestions concurrentes.
    await enqueueIngest({
      merchantId: connection.merchantId,
      mailboxId: connection.id,
      historyId: String(notification.historyId),
    });

    return reply.code(204).send();
  });

  // Webhook Shopify de désinstallation — révoque l'accès et arrête l'ingestion.
  app.post<{ Body: unknown }>('/webhooks/shopify/app-uninstalled', async (request, reply) => {
    const signature = request.headers['x-shopify-hmac-sha256'];
    if (
      typeof signature !== 'string' ||
      !request.rawBody ||
      !safeEqual(
        signature,
        hmacSha256Base64(
          await requireCredential(
            'SHOPIFY_API_SECRET',
            'Nécessaire pour vérifier la signature des webhooks Shopify.',
          ),
          request.rawBody,
        ),
      )
    ) {
      return reply.code(401).send({ error: 'Signature Shopify invalide' });
    }

    const shop = request.headers['x-shopify-shop-domain'];
    if (typeof shop !== 'string') return reply.code(400).send();

    const merchant = await prisma.merchant.findUnique({ where: { shopDomain: shop } });
    if (!merchant) return reply.code(200).send();

    await prisma.$transaction([
      prisma.merchant.update({
        where: { id: merchant.id },
        data: { status: 'UNINSTALLED' },
      }),
      prisma.shopifyConnection.updateMany({
        where: { merchantId: merchant.id },
        data: { uninstalledAt: new Date() },
      }),
      prisma.auditLog.create({
        data: {
          merchantId: merchant.id,
          actorType: 'SYSTEM',
          action: 'shopify.uninstalled',
        },
      }),
    ]);

    return reply.code(200).send();
  });
}
