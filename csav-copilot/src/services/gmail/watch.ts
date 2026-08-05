import { logger } from '../../lib/logger.ts';
import { prisma } from '../../lib/prisma.ts';
import { requireCredential } from '../platform/credentials.ts';
import { getGmailClient } from './client.ts';

/**
 * Abonne la boîte du marchand aux notifications Pub/Sub.
 * Le watch Gmail expire après 7 jours : à ré-appeler par un cron quotidien.
 */
export async function startWatch(merchantId: string, mailboxId?: string | null): Promise<void> {
  const { gmail, mailboxId: id } = await getGmailClient(merchantId, mailboxId);

  const topicName = await requireCredential(
    'GOOGLE_PUBSUB_TOPIC',
    'Nécessaire pour abonner une boîte Gmail aux notifications.',
  );

  const response = await gmail.users.watch({
    userId: 'me',
    requestBody: {
      topicName,
      labelIds: ['INBOX'],
      labelFilterBehavior: 'include',
    },
  });

  await prisma.gmailConnection.update({
    where: { id },
    data: {
      lastHistoryId: response.data.historyId ?? undefined,
      watchExpiration: response.data.expiration
        ? new Date(Number(response.data.expiration))
        : null,
    },
  });

  logger.info({ merchantId, expiration: response.data.expiration }, 'Watch Gmail activé');
}

export async function stopWatch(merchantId: string, mailboxId?: string | null): Promise<void> {
  const { gmail, mailboxId: id } = await getGmailClient(merchantId, mailboxId);
  await gmail.users.stop({ userId: 'me' });
  await prisma.gmailConnection.update({ where: { id }, data: { watchExpiration: null } });
}

/** Renouvelle les watch qui expirent dans moins de 24 h. */
export async function renewExpiringWatches(): Promise<number> {
  const threshold = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const connections = await prisma.gmailConnection.findMany({
    where: {
      OR: [{ watchExpiration: null }, { watchExpiration: { lt: threshold } }],
      merchant: { status: 'ACTIVE' },
    },
    select: { id: true, merchantId: true, emailAddress: true },
  });

  let renewed = 0;
  // Une boîte par itération : un renouvellement en échec ne doit pas priver
  // les autres du leur.
  for (const connection of connections) {
    try {
      await startWatch(connection.merchantId, connection.id);
      renewed += 1;
    } catch (error) {
      logger.error(
        { merchantId: connection.merchantId, mailbox: connection.emailAddress, err: error },
        'Échec du renouvellement du watch Gmail',
      );
    }
  }
  return renewed;
}
