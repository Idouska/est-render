import type { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma.ts';
import { requireSession } from '../plugins/auth.ts';
import { getGmailClient } from '../services/gmail/client.ts';

/**
 * Pièces jointes reçues des clients.
 *
 * Le fichier n'est pas en base : seules ses métadonnées le sont, et le contenu
 * se récupère chez Gmail à l'affichage. Une photo de défaut pèse quelques
 * mégaoctets ; cent tickets par jour rempliraient la base en un mois, pour
 * dupliquer ce que Gmail conserve déjà.
 *
 * Le coût est un aller-retour supplémentaire à l'ouverture. Il est payé par le
 * navigateur, en parallèle du reste de l'écran, et la vignette porte sa propre
 * mise en cache.
 */

/** Types affichables directement. Le reste se télécharge. */
const VIEWABLE = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/heic',
  'application/pdf',
]);

export async function attachmentRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireSession);

  app.get<{ Params: { id: string } }>('/api/attachments/:id', async (request, reply) => {
    const { merchantId } = request.session;

    // Le `merchantId` vient de la session, jamais de l'URL : un identifiant de
    // pièce jointe deviné ne doit rien ouvrir chez un autre marchand.
    const attachment = await prisma.attachment.findFirst({
      where: { id: request.params.id, merchantId },
      include: {
        message: {
          select: {
            gmailMessageId: true,
            ticket: { select: { mailboxId: true } },
          },
        },
      },
    });

    if (!attachment) return reply.code(404).send({ error: 'Pièce jointe introuvable' });

    try {
      const { gmail } = await getGmailClient(merchantId, attachment.message.ticket.mailboxId);

      const { data } = await gmail.users.messages.attachments.get({
        userId: 'me',
        messageId: attachment.message.gmailMessageId,
        id: attachment.gmailAttachmentId,
      });

      if (!data.data) return reply.code(404).send({ error: 'Contenu indisponible' });

      const buffer = Buffer.from(data.data.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

      // `inline` seulement pour ce qu'un navigateur sait rendre. Un fichier
      // inconnu affiché en ligne, c'est une page de caractères illisibles.
      const disposition = VIEWABLE.has(attachment.mimeType) ? 'inline' : 'attachment';

      return reply
        .type(attachment.mimeType)
        .header(
          'Content-Disposition',
          `${disposition}; filename="${encodeURIComponent(attachment.filename)}"`,
        )
        // Privé : la réponse traverse peut-être un cache partagé, et une photo
        // de client n'a rien à y faire.
        .header('Cache-Control', 'private, max-age=3600')
        .send(buffer);
    } catch (error) {
      request.log.error({ err: error, id: attachment.id }, 'Pièce jointe illisible');
      return reply.code(502).send({
        error: 'Gmail n’a pas rendu ce fichier. Il a pu être supprimé de la boîte.',
      });
    }
  });
}
