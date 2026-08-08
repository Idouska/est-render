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

  const connection = await prisma.gmailConnection.findUniqueOrThrow({
    where: { id },
    select: { lastHistoryId: true },
  });

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

  /*
   * Le curseur d'historique appartient à l'ingestion, pas à la veille.
   *
   * `watch` renvoie l'historyId de l'instant, et on l'écrivait à chaque appel.
   * Or le cron renouvelle la veille tous les jours : le curseur sautait donc
   * quotidiennement à « maintenant », et tout ce qui était arrivé depuis la
   * dernière ingestion réussie devenait invisible à la relève incrémentale —
   * définitivement, ces messages n'étant plus dans aucun historique à lire.
   *
   * D'où le symptôme : « Actualiser » ne ramenait rien, alors que « Relever »,
   * qui cherche par date et ignore le curseur, ramenait tout.
   *
   * On ne pose donc l'historyId qu'à la première activation, quand il n'y en a
   * aucun. Ensuite, seule l'ingestion l'avance, et seulement sur ce qu'elle a
   * réellement traité.
   */
  await prisma.gmailConnection.update({
    where: { id },
    data: {
      ...(connection.lastHistoryId
        ? {}
        : { lastHistoryId: response.data.historyId ?? undefined }),
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
