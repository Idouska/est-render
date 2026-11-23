import type { TicketStatus } from '@prisma/client';
import { logger } from '../../lib/logger.ts';
import { prisma } from '../../lib/prisma.ts';
import type { TicketJob } from '../../queue/types.ts';
import { apercuDuMessage, vraiClient } from './formulaireContact.ts';

/*
 * Les formulaires de contact déjà reçus, rendus à leur vrai client.
 *
 * Avant `formulaireContact.ts`, un message laissé sur le formulaire de la
 * boutique entrait au nom de `mailer@shopify.com` : la réponse serait partie
 * vers ce robot, et la commande ne se retrouvait pas. Les nouveaux messages
 * entrent désormais sous le nom du client ; ceux-ci sont corrigés au
 * démarrage des workers, en relisant le formulaire dans le premier message.
 *
 * Sans danger à rejouer : un ticket corrigé ne porte plus l'adresse de
 * Shopify et sort de la recherche. Un formulaire illisible (pas d'adresse
 * saisie) reste tel quel — l'envoi vers un robot est de toute façon bloqué.
 *
 * Ce qui attend encore une réponse repasse par l'IA, pour retrouver la
 * commande par la bonne adresse et adresser le brouillon au bon client. Jamais
 * un ticket dont l'équipe a retouché ou envoyé le brouillon : son travail
 * passe avant.
 */

/** Ce que Shopify écrit en tête d'un formulaire, pour ne relire que ceux-là. */
const MOTS_FORMULAIRE = [
  'formulaire de contact',
  'contact form',
  'formulario de contacto',
  'kontaktformular',
  'modulo di contatto',
  'contactformulier',
];

const EN_ATTENTE: TicketStatus[] = ['NEW', 'FAILED', 'NEEDS_REVIEW', 'DRAFT_READY'];
const FENETRE_RELANCE_MS = 30 * 24 * 60 * 60 * 1000;
const RELANCES_MAX = 200;

const DEPENDANCES = {
  prisma,
  // Chargée à l'usage : importer la file ouvre une connexion Redis, ce qu'un
  // test de ce module n'a pas à faire.
  enqueueTicket: async (job: TicketJob, options: { replace?: boolean }) =>
    (await import('../../queue/index.ts')).enqueueTicket(job, options),
  maintenant: () => new Date(),
};
export type DependancesReparation = typeof DEPENDANCES;

export async function reparerFormulairesDeContact(
  deps: DependancesReparation = DEPENDANCES,
): Promise<{ repares: number; relances: number }> {
  const tickets = await deps.prisma.ticket.findMany({
    where: {
      customerEmail: { endsWith: '@shopify.com' },
      messages: {
        some: {
          direction: 'INBOUND',
          OR: MOTS_FORMULAIRE.map((mot) => ({ bodyText: { contains: mot, mode: 'insensitive' as const } })),
        },
      },
    },
    select: {
      id: true,
      merchantId: true,
      subject: true,
      status: true,
      isHistorical: true,
      notification: true,
      lastMessageAt: true,
      messages: {
        where: { direction: 'INBOUND' },
        orderBy: { receivedAt: 'asc' },
        take: 1,
        select: { id: true, fromEmail: true, toEmail: true, subject: true, bodyText: true },
      },
      drafts: { where: { status: { in: ['EDITED', 'SENT'] } }, select: { id: true }, take: 1 },
    },
    orderBy: { lastMessageAt: 'desc' },
    take: 2000,
  });

  const depuis = deps.maintenant().getTime() - FENETRE_RELANCE_MS;
  let repares = 0;
  let relances = 0;

  for (const ticket of tickets) {
    const premier = ticket.messages[0];
    if (!premier) continue;
    // Le corps seul fait foi ici : le « Répondre à » n'a pas été gardé.
    const client = vraiClient({
      fromEmail: premier.fromEmail,
      toEmail: premier.toEmail,
      subject: premier.subject ?? ticket.subject,
      bodyText: premier.bodyText,
    });
    if (!client?.formulaire) continue;

    await deps.prisma.$transaction([
      deps.prisma.ticket.update({
        where: { id: ticket.id },
        data: { customerEmail: client.email, ...(client.nom ? { customerName: client.nom } : {}) },
      }),
      ...(client.message
        ? [deps.prisma.message.update({ where: { id: premier.id }, data: { snippet: apercuDuMessage(client.message) } })]
        : []),
    ]);
    repares += 1;

    const aRelancer =
      relances < RELANCES_MAX &&
      !ticket.isHistorical &&
      !ticket.notification &&
      EN_ATTENTE.includes(ticket.status) &&
      ticket.drafts.length === 0 &&
      ticket.lastMessageAt.getTime() >= depuis;
    if (!aRelancer) continue;

    try {
      await deps.enqueueTicket({ merchantId: ticket.merchantId, ticketId: ticket.id }, { replace: true });
      relances += 1;
    } catch (error) {
      logger.warn({ err: error, ticketId: ticket.id }, 'Formulaire corrigé, nouvelle analyse non programmée');
    }
  }

  return { repares, relances };
}
