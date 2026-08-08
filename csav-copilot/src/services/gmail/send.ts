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
  /** Boîte d'envoi. Nulle, on prend celle par défaut de la boutique. */
  mailboxId?: string | null;
  to: string;
  subject: string;
  body: string;
  /** Nom affiché de l'expéditeur — la boutique, pas l'adresse technique. */
  fromName?: string | null;
  /** Version HTML, pour les messages qui portent un lien ou une mise en forme. */
  html?: string | null;
}): Promise<{ gmailMessageId: string | null; fromEmail: string }> {
  if (env.GMAIL_MOCK) {
    logger.info({ to: params.to, subject: params.subject }, 'Gmail simulé : envoi direct non effectué');
    return { gmailMessageId: null, fromEmail: 'simulation@local' };
  }

  const { gmail, emailAddress } = await getGmailClient(params.merchantId, params.mailboxId);

  const sent = await gmail.users.messages.send({
    userId: 'me',
    requestBody: {
      raw: buildRawEmail({
        to: params.to,
        from: emailAddress,
        fromName: params.fromName,
        subject: params.subject,
        body: params.body,
        html: params.html,
      }),
    },
  });

  // Rendu pour être consigné dans le fil du ticket : une réponse envoyée et
  // nulle part écrite est une réponse que l'agent suivant croira oubliée.
  return { gmailMessageId: sent.data.id ?? null, fromEmail: emailAddress };
}
