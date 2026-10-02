import type { FastifyInstance } from 'fastify';

/**
 * L'ancien portail de réponse en texte libre, retiré.
 *
 * Une escalade se répondait par une page à elle, en écrivant : il fallait
 * relire le fil pour savoir ce qui avait été dit. Tout se répond aujourd'hui
 * dans l'atelier, d'un bouton. Les liens des anciens mails mènent encore
 * ici : la page dit où aller, dans les trois langues de l'atelier.
 *
 * Elle n'ouvre pas l'atelier à la place du fournisseur. Le jeton d'une
 * escalade ne se révoque pas ; en tirer un lien d'atelier contournerait la
 * révocation que le marchand peut faire de ce lien-là.
 */
export async function supplierPortalRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { id: string } }>('/supplier/:id', async (_request, reply) =>
    reply.code(410).type('text/html').sendFile('supplier.html'),
  );
}
