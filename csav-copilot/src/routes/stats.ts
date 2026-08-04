import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.ts';
import { requireSession } from '../plugins/auth.ts';

/**
 * Statistiques d'équipe.
 *
 * Tout se calcule depuis la base à la demande : le volume d'un SAV de PME se
 * compte en milliers de lignes, pas en millions, et une table d'agrégats
 * préchauffée serait une source de vérité de plus à tenir en cohérence.
 *
 * Ce qui est mesuré répond à trois questions d'exploitation : est-ce que la
 * file se vide, qui porte la charge, et l'IA fait-elle gagner du temps.
 */

const query = z.object({
  days: z.coerce.number().int().min(7).max(180).default(30),
});

export async function statsRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireSession);

  app.get('/api/stats', async (request, reply) => {
    const parsed = query.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: 'Paramètres invalides' });

    const { merchantId } = request.session;
    const since = new Date(Date.now() - parsed.data.days * 24 * 60 * 60 * 1000);

    const [byStatus, byIntent, drafts, tickets, users, audits] = await Promise.all([
      prisma.ticket.groupBy({
        by: ['status'],
        where: { merchantId, createdAt: { gte: since } },
        _count: { _all: true },
      }),
      prisma.ticket.groupBy({
        by: ['intent'],
        where: { merchantId, createdAt: { gte: since }, intent: { not: null } },
        _count: { _all: true },
      }),
      prisma.draft.findMany({
        where: { merchantId, createdAt: { gte: since } },
        select: {
          status: true,
          confidence: true,
          createdAt: true,
          sentAt: true,
          ticketId: true,
          // Le ticket porte l'heure d'arrivée du mail : c'est d'elle que se
          // mesure le délai ressenti par le client, pas de la création du
          // brouillon.
          ticket: { select: { createdAt: true } },
        },
      }),
      prisma.ticket.findMany({
        where: { merchantId, createdAt: { gte: since } },
        select: { createdAt: true, status: true },
      }),
      prisma.user.findMany({
        where: { merchantId },
        select: { id: true, name: true, email: true, role: true, active: true },
      }),
      // Qui a envoyé quoi : le journal est la seule source qui attribue une
      // action à une personne, les brouillons ne portent que « AI » ou
      // « HUMAN ».
      prisma.auditLog.groupBy({
        by: ['actorId', 'action'],
        where: {
          merchantId,
          createdAt: { gte: since },
          action: { in: ['draft.sent', 'refund.completed', 'supplier.notified'] },
        },
        _count: { _all: true },
      }),
    ]);

    /* Volume par jour : le graphe le plus lu, parce qu'il montre si la file se
       vide au même rythme qu'elle se remplit. */
    const daily = new Map<string, { received: number; handled: number }>();
    // Construit à rebours depuis aujourd'hui : partir de `since` laisserait le
    // jour courant hors de la fenêtre, et c'est celui qu'on regarde.
    for (let back = parsed.data.days - 1; back >= 0; back -= 1) {
      const day = new Date(Date.now() - back * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      daily.set(day, { received: 0, handled: 0 });
    }

    for (const ticket of tickets) {
      const day = ticket.createdAt.toISOString().slice(0, 10);
      const bucket = daily.get(day);
      if (!bucket) continue;
      bucket.received += 1;
      if (ticket.status === 'CLOSED' || ticket.status === 'AUTO_SENT') bucket.handled += 1;
    }

    /* Délai de première réponse : la métrique que le client ressent. La moyenne
       seule masque les tickets oubliés, on renvoie aussi la médiane.
       Une seule mesure par ticket — la première réponse partie. */
    const firstSent = new Map<string, number>();
    for (const draft of drafts) {
      if (!draft.sentAt) continue;
      const minutes = (draft.sentAt.getTime() - draft.ticket.createdAt.getTime()) / 60000;
      const known = firstSent.get(draft.ticketId);
      if (known === undefined || minutes < known) firstSent.set(draft.ticketId, minutes);
    }

    const delays = [...firstSent.values()].sort((a, b) => a - b);

    const median = delays.length ? delays[Math.floor(delays.length / 2)]! : null;
    const average = delays.length
      ? delays.reduce((total, value) => total + value, 0) / delays.length
      : null;

    const sentDrafts = drafts.filter((draft) => draft.sentAt);
    const confidences = drafts
      .map((draft) => draft.confidence)
      .filter((value): value is number => typeof value === 'number');

    const perUser = users.map((user) => {
      const rows = audits.filter((row) => row.actorId === user.id);
      const count = (action: string) =>
        rows.find((row) => row.action === action)?._count._all ?? 0;

      return {
        id: user.id,
        name: user.name ?? user.email,
        role: user.role,
        active: user.active,
        replies: count('draft.sent'),
        refunds: count('refund.completed'),
        escalations: count('supplier.notified'),
      };
    });

    return reply.send({
      days: parsed.data.days,
      tickets: {
        total: tickets.length,
        byStatus: Object.fromEntries(byStatus.map((row) => [row.status, row._count._all])),
        byIntent: Object.fromEntries(byIntent.map((row) => [row.intent, row._count._all])),
        daily: [...daily.entries()].map(([day, counts]) => ({ day, ...counts })),
      },
      firstReply: { medianMinutes: median, averageMinutes: average, measured: delays.length },
      drafts: {
        total: drafts.length,
        sent: sentDrafts.length,
        // Ce que l'IA a réellement fait gagner : un brouillon rédigé mais jamais
        // envoyé n'a fait économiser aucune minute.
        sendRate: drafts.length ? sentDrafts.length / drafts.length : 0,
        averageConfidence: confidences.length
          ? confidences.reduce((total, value) => total + value, 0) / confidences.length
          : null,
      },
      team: perUser.sort((a, b) => b.replies - a.replies),
    });
  });
}
