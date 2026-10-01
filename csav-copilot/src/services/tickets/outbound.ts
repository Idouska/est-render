import { logger } from '../../lib/logger.ts';
import { prisma } from '../../lib/prisma.ts';

/**
 * Consigne une réponse partie dans le fil du ticket.
 *
 * Les messages sortants n'étaient enregistrés nulle part : l'ingestion ne
 * ramasse que la boîte de réception, et l'envoi ne laissait qu'une ligne de
 * journal. Le « fil complet » montrait donc une conversation où le client
 * parle seul, l'agent suivant croyait le message oublié et répondait deux
 * fois — et le corpus d'apprentissage de l'IA, qui cherche des paires
 * question/réponse, ne trouvait jamais une seule réponse.
 *
 * Tolérante à l'échec : le mail est déjà parti quand on arrive ici. Rater la
 * trace est regrettable, refuser l'envoi pour autant serait pire.
 */
export async function recordOutbound(params: {
  merchantId: string;
  ticketId: string;
  gmailMessageId: string | null;
  fromEmail: string;
  toEmail: string | null;
  subject: string | null;
  body: string;
}): Promise<void> {
  try {
    await prisma.message.create({
      data: {
        merchantId: params.merchantId,
        ticketId: params.ticketId,
        // Sans identifiant Gmail (simulation), une clé locale suffit : elle
        // ne sert qu'à garantir l'unicité.
        gmailMessageId: params.gmailMessageId ?? `local-${params.ticketId}-${Date.now()}`,
        direction: 'OUTBOUND',
        fromEmail: params.fromEmail,
        toEmail: params.toEmail,
        subject: params.subject,
        bodyText: params.body,
        snippet: params.body.slice(0, 200),
        receivedAt: new Date(),
      },
    });
  } catch (error) {
    logger.warn({ err: error, ticketId: params.ticketId }, 'Réponse non consignée dans le fil');
  }
}
