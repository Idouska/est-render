import { env } from '../../config/env.ts';
import { logger } from '../../lib/logger.ts';
import { getGmailClient } from './client.ts';
import { buildRawEmail } from './drafts.ts';

/**
 * Envoi direct, sans passer par un brouillon — réservé aux notifications que
 * l'application émet elle-même (ex. alerter le fournisseur d'une nouvelle
 * escalade), jamais à une réponse client. La règle « rien ne part vers un
 * client sans validation humaine » ne s'applique qu'aux réponses client :
 * une notification interne (« vous avez un nouveau message ») ne fait aucune
 * promesse et n'a pas besoin de relecture.
 *
 * Utilise la boîte Gmail déjà connectée du marchand plutôt qu'un service
 * d'envoi tiers : aucun compte supplémentaire à créer pour cette fonctionnalité.
 */
export async function sendPlainEmail(params: {
  merchantId: string;
  to: string;
  subject: string;
  body: string;
}): Promise<void> {
  if (env.GMAIL_MOCK) {
    logger.info({ to: params.to, subject: params.subject }, 'Gmail simulé : envoi direct non effectué');
    return;
  }

  const { gmail, emailAddress } = await getGmailClient(params.merchantId);

  await gmail.users.messages.send({
    userId: 'me',
    requestBody: {
      raw: buildRawEmail({
        to: params.to,
        from: emailAddress,
        subject: params.subject,
        body: params.body,
      }),
    },
  });
}
