import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { env } from '../config/env.ts';
import { recordAudit } from '../lib/audit.ts';
import { prisma } from '../lib/prisma.ts';
import { PERMISSIONS, PREVIEW_COOKIE, requirePermission, requireSession } from '../plugins/auth.ts';
import { enqueueTicket } from '../queue/index.ts';
import { accessibleMerchantIds, listShopsFor } from './shops.ts';
import { sendDraft, updateDraftBody } from '../services/gmail/drafts.ts';
import { sendPlainEmail } from '../services/gmail/send.ts';
import { getShopifyClient, ShopifyError } from '../services/shopify/client.ts';
import { listVariants } from '../services/shopify/catalog.ts';
import { getOrderById, quoteSearchValue, searchOrders } from '../services/shopify/orders.ts';
import { processTicket } from '../services/tickets/process.ts';
import { translateToFrench } from '../services/ai/translate.ts';

const TICKET_STATUSES = [
  'NEW',
  'PROCESSING',
  'DRAFT_READY',
  'NEEDS_REVIEW',
  'AWAITING_SUPPLIER',
  'AUTO_SENT',
  'CLOSED',
  'FAILED',
] as const;

const listQuery = z.object({
  status: z.enum(TICKET_STATUSES).optional(),
  /** Recherche libre sur l'objet, le client et le numéro de commande. */
  q: z.string().max(200).optional(),
  intent: z
    .enum(['WISMO', 'RETURN', 'DISPUTE', 'REFUND', 'PRODUCT_QUESTION', 'POSITIVE', 'OTHER'])
    .optional(),
  /** Identifiant d'agent, ou `none` pour les tickets que personne n'a pris. */
  assignee: z.string().max(60).optional(),
  /** Ancienneté minimale en jours — le filtre « urgents ». */
  minAgeDays: z.coerce.number().int().min(0).max(365).optional(),
  /** Tickets sans commande rattachée : l'agent doit la retrouver à la main. */
  unlinked: z.coerce.boolean().optional(),
  /** Boîte mail d'origine — utile quand `contact@` et `sav@` cohabitent. */
  mailbox: z.string().max(60).optional(),
  /** Voir au contraire ce qui dort — pour vérifier qu'on n'a rien enterré. */
  snoozed: z.coerce.boolean().optional(),
  /** Consulter les échanges importés de l'historique, invisibles autrement. */
  historical: z.coerce.boolean().optional(),
  /**
   * Libellés Gmail, tels que le marchand les a créés dans sa boîte. Plusieurs
   * séparés par des virgules, entendus comme « au moins l'un d'eux » : deux
   * catégories voisines — « Refund » et « Litige » — se regardent ensemble, et
   * les croiser en « et » ne rendrait jamais rien, un mail portant rarement
   * deux libellés à la fois.
   */
  label: z.string().max(600).optional(),
  /** Montant plancher de la commande rattachée. */
  minAmount: z.coerce.number().min(0).max(100000).optional(),
  /** `all` élargit la file à toutes les boutiques du groupe. */
  scope: z.enum(['shop', 'all']).default('shop'),
  sort: z.enum(['oldest', 'newest', 'confidence', 'amount', 'due']).default('newest'),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

/**
 * Traduit les filtres de la file en clause Prisma.
 *
 * Isolée parce que la liste et les compteurs doivent appliquer exactement les
 * mêmes règles : un compteur qui ne correspond pas à ce que la liste affiche
 * est pire que pas de compteur du tout.
 */
function buildTicketWhere(
  merchantIds: string[],
  filters: z.infer<typeof listQuery>,
  options: { withStatus: boolean },
) {
  const term = filters.q?.trim();

  const labelNames = (filters.label ?? '')
    .split(',')
    .map((name) => name.trim())
    .filter((name) => name !== '');

  return {
    // Une liste, jamais un identifiant venu du client : `merchantIds` est
    // toujours calculé serveur depuis la session.
    merchantId: merchantIds.length === 1 ? merchantIds[0] : { in: merchantIds },
    // Les échanges importés servent de matière à l'IA, pas de travail à faire :
    // les afficher noierait la file sous des mois d'archives closes. Un filtre
    // explicite les montre — importer trois cents échanges et ne rien pouvoir
    // consulter donne l'impression que rien n'a eu lieu.
    isHistorical: filters.historical === true,
    ...(options.withStatus && filters.status ? { status: filters.status } : {}),
    ...(filters.intent ? { intent: filters.intent } : {}),
    ...(filters.assignee === 'none'
      ? { assignedToId: null }
      : filters.assignee
        ? { assignedToId: filters.assignee }
        : {}),
    ...(filters.minAgeDays !== undefined
      ? {
          // L'ancienneté se compte depuis la dernière prise de parole, pas
          // depuis l'ouverture : un ticket relancé hier n'est pas en retard de
          // dix jours.
          lastMessageAt: {
            lte: new Date(Date.now() - filters.minAgeDays * 24 * 60 * 60 * 1000),
          },
        }
      : {}),
    ...(filters.unlinked ? { shopifyOrderId: null } : {}),
    // Un ticket en veille sort de la file jusqu'à son réveil. C'est tout
    // l'intérêt : sans ça, le mettre en veille ne ferait que poser une
    // étiquette de plus sur une ligne toujours présente.
    //
    // Passé par `AND` et non par `OR` : la recherche libre occupe déjà la clé
    // `OR`, et deux `OR` dans le même objet s'écrasent silencieusement — le
    // filtre disparaîtrait sans la moindre erreur.
    ...(filters.snoozed
      ? { snoozedUntil: { gt: new Date() } }
      : {
          AND: [
            { OR: [{ snoozedUntil: null }, { snoozedUntil: { lte: new Date() } }] },
          ],
        }),
    ...(filters.mailbox ? { mailboxId: filters.mailbox } : {}),
    ...(labelNames.length > 0 ? { labels: { hasSome: labelNames } } : {}),
    ...(filters.minAmount !== undefined ? { orderTotal: { gte: filters.minAmount } } : {}),
    ...(term
      ? {
          OR: [
            { subject: { contains: term, mode: 'insensitive' as const } },
            { customerEmail: { contains: term, mode: 'insensitive' as const } },
            { customerName: { contains: term, mode: 'insensitive' as const } },
            { orderName: { contains: term, mode: 'insensitive' as const } },
            // Le corps des messages : chercher « semelle décollée » ne
            // trouvait rien, alors que c'est ainsi qu'on repère un défaut de
            // série.
            {
              messages: {
                some: { bodyText: { contains: term, mode: 'insensitive' as const } },
              },
            },
          ],
        }
      : {}),
  };
}

/**
 * Libellés Gmail distincts portés par les tickets d'un marchand.
 *
 * `unnest` en SQL plutôt qu'un chargement de toutes les lignes : sur quatre
 * mille tickets, rapatrier chaque tableau d'étiquettes pour les aplatir en
 * mémoire coûterait plus cher que la liste elle-même.
 */
async function listMerchantLabels(merchantIds: string[]): Promise<string[]> {
  const rows = await prisma.$queryRaw<Array<{ label: string }>>`
    SELECT DISTINCT unnest("labels") AS label
    FROM "Ticket"
    WHERE "merchantId" = ANY(${merchantIds}::text[])
    ORDER BY 1
  `;

  return rows.map((row) => row.label);
}

export async function ticketRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireSession);

  // Identité du marchand connecté et état des deux intégrations : c'est ce que
  // le dashboard affiche en barre haute.
  app.get('/api/me', async (request, reply) => {
    const { merchantId, userId } = request.session;

    const merchant = await prisma.merchant.findUnique({
      where: { id: merchantId },
      include: {
        shopify: { select: { installedAt: true, uninstalledAt: true, scopes: true } },
        mailboxes: {
          orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
          select: { id: true, emailAddress: true, label: true, isDefault: true, watchExpiration: true },
        },
        users: { where: { id: userId }, select: { email: true, name: true, role: true } },
      },
    });

    if (!merchant) return reply.code(404).send({ error: 'Marchand introuvable' });

    return reply.send({
      merchant: {
        id: merchant.id,
        shopDomain: merchant.shopDomain,
        name: merchant.name,
        brandName: merchant.brandName,
        logoUrl: merchant.logoUrl,
        hasLogo: Boolean(merchant.logoMime),
        autoSendEnabled: merchant.autoSendEnabled,
        autoSendThreshold: merchant.autoSendThreshold,
      },
      user: merchant.users[0]
        ? { ...merchant.users[0], id: userId, role: request.session.role }
        : { id: userId, email: request.session.email, name: null, role: request.session.role },
      // Le rôle réel accompagne le rôle appliqué : sans lui, l'interface ne
      // saurait pas qu'elle est en simulation et n'offrirait aucun moyen d'en
      // sortir.
      realRole: request.session.realRole,
      previewing: request.session.role !== request.session.realRole,
      shopify: {
        connected: Boolean(merchant.shopify && !merchant.shopify.uninstalledAt),
        simulated: env.SHOPIFY_MOCK,
      },
      gmail: {
        connected: merchant.mailboxes.length > 0,
        // Adresse de la boîte principale, pour la barre haute.
        emailAddress: merchant.mailboxes[0]?.emailAddress ?? null,
        mailboxes: merchant.mailboxes.map((mailbox) => ({
          id: mailbox.id,
          emailAddress: mailbox.emailAddress,
          label: mailbox.label,
          isDefault: mailbox.isDefault,
          watchActive: Boolean(mailbox.watchExpiration && mailbox.watchExpiration > new Date()),
        })),
        // Une seule boîte muette suffit à faire disparaître du courrier sans
        // que rien ne le signale : l'alerte porte sur l'ensemble.
        watchActive: merchant.mailboxes.every(
          (mailbox) => mailbox.watchExpiration && mailbox.watchExpiration > new Date(),
        ),
      },
    });
  });

  // File de tickets + indicateurs du dashboard.
  app.get('/api/tickets', async (request, reply) => {
    const query = listQuery.safeParse(request.query);
    if (!query.success) {
      return reply.code(400).send({ error: 'Paramètres invalides', details: query.error.issues });
    }

    const { merchantId, email } = request.session;
    const { cursor, limit, sort } = query.data;

    const merchantIds =
      query.data.scope === 'all'
        ? await accessibleMerchantIds({ merchantId, email })
        : [merchantId];

    /*
     * Les nuls en dernier, sur les deux nouveaux tris.
     *
     * Un message sans commande rattachée n'a pas de montant, et un message
     * jamais traité par l'IA n'a pas d'échéance : sans cette précision,
     * Postgres les remonterait en tête et le tri « les plus gros d'abord »
     * commencerait par cinquante lignes vides.
     */
    const orderBy =
      sort === 'oldest'
        ? ({ lastMessageAt: 'asc' } as const)
        : sort === 'confidence'
          ? ({ intentConfidence: 'asc' } as const)
          : sort === 'amount'
            ? ({ orderTotal: { sort: 'desc', nulls: 'last' } } as const)
            : sort === 'due'
              ? ({ dueAt: { sort: 'asc', nulls: 'last' } } as const)
              : ({ lastMessageAt: 'desc' } as const);

    const [tickets, byStatus] = await Promise.all([
      prisma.ticket.findMany({
        where: buildTicketWhere(merchantIds, query.data, { withStatus: true }),
        orderBy,
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        select: {
          id: true,
          subject: true,
          customerEmail: true,
          customerName: true,
          intent: true,
          intentConfidence: true,
          status: true,
          orderName: true,
          shopifyOrderId: true,
          lastMessageAt: true,
          createdAt: true,
          // Montant et échéance : déjà en base, jamais affichés. Un message à
          // 19 € et un message à 3 200 € ne se traitent pas dans le même
          // ordre, et l'agent ne pouvait pas le savoir sans ouvrir.
          orderTotal: true,
          dueAt: true,
          labels: true,
          failureReason: true,
          assignedToId: true,
          assignedTo: { select: { id: true, name: true, email: true } },
          mailbox: { select: { id: true, emailAddress: true, label: true } },
          merchantId: true,
        },
      }),
      // Compteurs calculés sur les mêmes filtres, statut exclu : sinon chaque
      // onglet afficherait son propre nombre et jamais celui des autres.
      prisma.ticket.groupBy({
        by: ['status'],
        where: buildTicketWhere(merchantIds, query.data, { withStatus: false }),
        _count: true,
      }),
    ]);

    const hasMore = tickets.length > limit;
    if (hasMore) tickets.pop();

    /*
     * Combien de fois ce client nous a déjà écrit.
     *
     * Un premier contact et un huitième ne se traitent pas du même ton, et
     * c'est l'information que l'agent n'a jamais sous les yeux avant d'ouvrir.
     * Comptée sur les seuls emails affichés, en une requête : la calculer sur
     * tout le carnet coûterait le prix de la page pour cinquante lignes.
     *
     * On compte nos échanges, pas ses achats. Les deux se ressemblent mais ne
     * sont pas la même chose, et l'écran le dira ainsi — annoncer « 8
     * commandes » sur la foi de huit mails serait un mensonge utile jusqu'au
     * jour où il coûte cher.
     */
    const emails = [...new Set(tickets.map((ticket) => ticket.customerEmail))];

    const history = emails.length
      ? await prisma.ticket.groupBy({
          by: ['customerEmail'],
          where: { merchantId: { in: merchantIds }, customerEmail: { in: emails } },
          _count: true,
        })
      : [];

    const threadsByEmail = Object.fromEntries(
      history.map((row) => [row.customerEmail, row._count]),
    );

    const counts = Object.fromEntries(byStatus.map((row) => [row.status, row._count]));

    return reply.send({
      tickets: tickets.map((ticket) => ({
        ...ticket,
        /** Nombre d'échanges avec ce client, celui-ci compris. */
        threads: threadsByEmail[ticket.customerEmail] ?? 1,
      })),
      counts: { ...counts, ALL: byStatus.reduce((sum, row) => sum + row._count, 0) },
      // Tous les libellés du marchand, pas seulement ceux de la page affichée.
      // Les déduire des cinquante tickets à l'écran donnait une liste qui
      // changeait à chaque tri et n'offrait jamais le filtre qu'on cherchait.
      labels: await listMerchantLabels(merchantIds),
      nextCursor: hasMore ? tickets[tickets.length - 1]?.id : null,
    });
  });

  /**
   * Assignation d'un ticket.
   *
   * `reply` et non `configure` : prendre un ticket fait partie du travail
   * quotidien d'un agent, lui demander un superviseur pour ça bloquerait la
   * file entière dès que personne n'est disponible.
   */
  /**
   * Mise en veille d'un ticket.
   *
   * Un ticket qui attend une réponse du fournisseur n'a rien à faire en haut de
   * la pile pendant trois jours : il occupe l'attention sans qu'aucune action
   * ne soit possible, et l'agent réapprend chaque matin qu'il n'y a rien à en
   * faire. Il revient de lui-même à la date dite.
   */
  /**
   * Rétablit l'état d'un ticket.
   *
   * Existe pour l'annulation d'une clôture, et rien d'autre : c'est pourquoi
   * elle n'accepte que les états qu'un ticket peut légitimement retrouver. Un
   * point d'entrée qui laisserait écrire n'importe quel statut ferait de la
   * machine à états une décoration.
   */
  app.patch<{ Params: { id: string } }>(
    '/api/tickets/:id/status',
    { preHandler: requirePermission('reply') },
    async (request, reply) => {
      const parsed = z
        .object({
          status: z.enum(['NEW', 'DRAFT_READY', 'NEEDS_REVIEW', 'AWAITING_SUPPLIER', 'CLOSED']),
        })
        .safeParse(request.body);

      if (!parsed.success) return reply.code(400).send({ error: 'État non rétablissable' });

      const { merchantId } = request.session;

      const updated = await prisma.ticket.updateMany({
        where: { id: request.params.id, merchantId },
        data: { status: parsed.data.status },
      });

      if (updated.count === 0) return reply.code(404).send({ error: 'Ticket introuvable' });

      return reply.send({ status: parsed.data.status });
    },
  );

  /**
   * Une action sur plusieurs messages à la fois.
   *
   * Sur une file de cinq mille lignes, le traitement un par un n'est pas un
   * inconfort : c'est l'abandon. Trois cents notifications de plateforme se
   * closent d'un geste ou ne se closent jamais.
   *
   * Une seule route pour toutes les actions groupées, parce que la partie
   * délicate leur est commune : n'agir que sur les messages du marchand
   * connecté, quoi qu'il arrive dans la liste d'identifiants reçue. Le filtre
   * `merchantId` est appliqué dans chaque `where`, jamais déduit du corps de
   * la requête.
   */
  app.post('/api/tickets/bulk', async (request, reply) => {
    const parsed = z
      .object({
        ids: z.array(z.string().min(1)).min(1).max(500),
        action: z.enum(['close', 'reopen', 'delete', 'label-add', 'label-remove', 'assign', 'analyze']),
        label: z.string().min(1).max(120).optional(),
        /** Identifiant d'agent, ou null pour remettre au pot commun. */
        assignee: z.string().max(60).nullable().optional(),
      })
      .safeParse(request.body);

    if (!parsed.success) return reply.code(400).send({ error: 'Requête invalide' });

    const { ids, action, label, assignee } = parsed.data;
    const { merchantId, userId, role } = request.session;

    // La suppression est irréversible : elle demande le droit de configurer,
    // pas seulement celui de répondre.
    const needed = action === 'delete' ? 'configure' : 'reply';
    if (!(PERMISSIONS[needed] as readonly string[]).includes(role)) {
      return reply.code(403).send({ error: 'Action non autorisée pour votre rôle' });
    }

    if ((action === 'label-add' || action === 'label-remove') && !label) {
      return reply.code(400).send({ error: 'Libellé manquant' });
    }

    const scope = { id: { in: ids }, merchantId };
    let affected = 0;

    switch (action) {
      case 'close': {
        affected = (
          await prisma.ticket.updateMany({
            where: scope,
            data: { status: 'CLOSED', snoozedUntil: null },
          })
        ).count;
        break;
      }

      case 'reopen': {
        affected = (
          await prisma.ticket.updateMany({ where: scope, data: { status: 'NEEDS_REVIEW' } })
        ).count;
        break;
      }

      case 'delete': {
        affected = (await prisma.ticket.deleteMany({ where: scope })).count;
        break;
      }

      case 'assign': {
        affected = (
          await prisma.ticket.updateMany({ where: scope, data: { assignedToId: assignee ?? null } })
        ).count;
        break;
      }

      case 'analyze': {
        // Remises en file, pas traitées ici : cinq cents appels de modèle dans
        // une requête HTTP dépasseraient tous les délais d'attente.
        const targets = await prisma.ticket.findMany({ where: scope, select: { id: true } });
        for (const target of targets) {
          try {
            await enqueueTicket({ merchantId, ticketId: target.id }, { replace: true });
            affected += 1;
          } catch (error) {
            request.log.error({ err: error, ticketId: target.id }, 'Mise en file en échec');
          }
        }
        break;
      }

      case 'label-add':
      case 'label-remove': {
        /*
         * Les libellés sont un tableau : `updateMany` ne sait ni y ajouter ni
         * y retirer une valeur. On relit donc chaque ligne pour recalculer son
         * tableau — cinq cents lectures et cinq cents écritures, groupées en
         * une transaction pour qu'un échec à mi-chemin ne laisse pas la moitié
         * des messages classés.
         */
        const targets = await prisma.ticket.findMany({
          where: scope,
          select: { id: true, labels: true },
        });

        await prisma.$transaction(
          targets.map((target) => {
            const labels =
              action === 'label-add'
                ? [...new Set([...target.labels, label!])]
                : target.labels.filter((name) => name !== label);

            return prisma.ticket.update({ where: { id: target.id }, data: { labels } });
          }),
        );

        affected = targets.length;
        break;
      }
    }

    await recordAudit({
      merchantId,
      actorType: 'USER',
      actorId: userId,
      action: `tickets.bulk.${action}`,
      targetType: 'Ticket',
      targetId: `${affected} message(s)`,
      metadata: { action, affected, label, assignee, requested: ids.length },
      ipAddress: request.ip,
    });

    return reply.send({ affected });
  });

  /**
   * Traduit le fil en français.
   *
   * À la demande et non d'office : la plupart des mails sont déjà lisibles, et
   * traduire systématiquement ferait payer un appel de modèle pour rien sur
   * chaque ouverture. La traduction n'est pas stockée — l'original reste la
   * seule version qui fait foi.
   */
  app.post<{ Params: { id: string } }>(
    '/api/tickets/:id/translate',
    { preHandler: requirePermission('read') },
    async (request, reply) => {
      const { merchantId, email } = request.session;
      const readable = await accessibleMerchantIds({ merchantId, email });

      const messages = await prisma.message.findMany({
        where: { ticket: { id: request.params.id, merchantId: { in: readable } } },
        orderBy: { receivedAt: 'asc' },
        select: { id: true, bodyText: true },
        take: 20,
      });

      if (messages.length === 0) {
        return reply.code(404).send({ error: 'Message introuvable' });
      }

      try {
        const { translations, model } = await translateToFrench(
          // Tronqué : un fil qui cite dix fois l'échange précédent ferait
          // exploser la facture sans rien apprendre de plus.
          messages.map((message) => message.bodyText.slice(0, 4000)),
        );

        return reply.send({
          model,
          messages: messages.map((message, index) => ({
            id: message.id,
            text: translations[index] ?? '',
          })),
        });
      } catch (error) {
        request.log.error({ err: error, ticketId: request.params.id }, 'Traduction en échec');
        return reply.code(502).send({
          error: error instanceof Error ? error.message : 'La traduction a échoué',
        });
      }
    },
  );

  /**
   * Analyse un message à la demande, tout de suite.
   *
   * La file de fond traite le courrier à trente messages par minute pour ne
   * pas saturer le fournisseur d'IA — parfait pour rattraper des milliers de
   * mails, inutilisable quand on a ce mail-ci sous les yeux et qu'on veut son
   * résumé maintenant. Cet appel court-circuite la file : un seul ticket, en
   * direct, le temps d'un café.
   *
   * Le traitement est identique à celui du worker — même classification, même
   * rattachement de commande, même brouillon — pour qu'un message analysé à la
   * main ne diffère en rien d'un message analysé tout seul.
   */
  app.post<{ Params: { id: string } }>(
    '/api/tickets/:id/analyze',
    { preHandler: requirePermission('reply') },
    async (request, reply) => {
      const { merchantId } = request.session;

      const ticket = await prisma.ticket.findFirst({
        where: { id: request.params.id, merchantId },
        select: { id: true },
      });
      if (!ticket) return reply.code(404).send({ error: 'Message introuvable' });

      try {
        await processTicket(merchantId, ticket.id);
      } catch (error) {
        request.log.error({ err: error, ticketId: ticket.id }, 'Analyse à la demande en échec');
        return reply.code(502).send({
          error: error instanceof Error ? error.message : "L'analyse a échoué",
        });
      }

      const draft = await prisma.draft.findFirst({
        where: { ticketId: ticket.id },
        orderBy: { createdAt: 'desc' },
      });

      const fresh = await prisma.ticket.findUnique({
        where: { id: ticket.id },
        select: { status: true, intent: true, failureReason: true, labels: true },
      });

      return reply.send({ ...fresh, draft });
    },
  );

  /**
   * Supprime un message pour de bon.
   *
   * Clore range, supprimer efface. Les deux sont nécessaires : un mail de
   * démarchage, une notification de plateforme ou un doublon n'ont pas à
   * rester consultables sous prétexte qu'ils sont clos — ils gonflent les
   * compteurs et polluent la recherche. Réservé à `configure` : c'est
   * irréversible, un agent n'a pas à pouvoir faire disparaître un échange.
   *
   * Rien n'est touché dans Gmail : le mail reste dans la boîte du marchand.
   * Supprimer ici veut dire « sortir du SAV », pas « détruire le courrier ».
   */
  app.delete<{ Params: { id: string } }>(
    '/api/tickets/:id',
    { preHandler: requirePermission('configure') },
    async (request, reply) => {
      const { merchantId, userId } = request.session;

      const ticket = await prisma.ticket.findFirst({
        where: { id: request.params.id, merchantId },
        select: { id: true, subject: true, customerEmail: true },
      });
      if (!ticket) return reply.code(404).send({ error: 'Message introuvable' });

      await prisma.ticket.delete({ where: { id: ticket.id } });

      await recordAudit({
        merchantId,
        actorType: 'USER',
        actorId: userId,
        action: 'ticket.deleted',
        targetType: 'Ticket',
        targetId: ticket.id,
        metadata: { subject: ticket.subject, customerEmail: ticket.customerEmail },
        ipAddress: request.ip,
      });

      return reply.send({ deleted: true });
    },
  );

  /**
   * Change les libellés d'un message.
   *
   * Les libellés viennent de Gmail, mais le classement se fait ici : les
   * autorisations Google accordées sont en lecture, composition et envoi —
   * pas en modification d'étiquettes. Reclasser depuis le dashboard ne
   * repeint donc pas la boîte du marchand, et c'est le bon compromis :
   * demander l'accès en écriture à toute la messagerie pour déplacer une
   * étiquette serait hors de proportion.
   */
  app.put<{ Params: { id: string } }>(
    '/api/tickets/:id/labels',
    { preHandler: requirePermission('reply') },
    async (request, reply) => {
      const parsed = z
        .object({ labels: z.array(z.string().min(1).max(120)).max(20) })
        .safeParse(request.body);

      if (!parsed.success) return reply.code(400).send({ error: 'Libellés invalides' });

      const { merchantId, userId } = request.session;

      // Doublons écartés : deux fois le même libellé afficherait deux boutons
      // identiques sur la ligne.
      const labels = [...new Set(parsed.data.labels)];

      const updated = await prisma.ticket.updateMany({
        where: { id: request.params.id, merchantId },
        data: { labels },
      });

      if (updated.count === 0) return reply.code(404).send({ error: 'Message introuvable' });

      await recordAudit({
        merchantId,
        actorType: 'USER',
        actorId: userId,
        action: 'ticket.labels_changed',
        targetType: 'Ticket',
        targetId: request.params.id,
        metadata: { labels },
        ipAddress: request.ip,
      });

      return reply.send({ labels });
    },
  );

  /**
   * Clôt un ticket sans envoyer de réponse.
   *
   * Tout ne se règle pas par un mail : une notification de plateforme, un
   * doublon, un client qui rappelle et raccroche satisfait. Sans ce geste,
   * ces tickets restent dans la file et l'on finit par ne plus la croire.
   */
  app.post<{ Params: { id: string } }>(
    '/api/tickets/:id/resolve',
    { preHandler: requirePermission('reply') },
    async (request, reply) => {
      const { merchantId, userId } = request.session;

      const ticket = await prisma.ticket.findFirst({
        where: { id: request.params.id, merchantId },
        select: { id: true, status: true },
      });
      if (!ticket) return reply.code(404).send({ error: 'Ticket introuvable' });

      await prisma.ticket.update({
        where: { id: ticket.id },
        data: { status: 'CLOSED', snoozedUntil: null },
      });

      await recordAudit({
        merchantId,
        actorType: 'USER',
        actorId: userId,
        action: 'ticket.resolved',
        targetType: 'Ticket',
        targetId: ticket.id,
        // L'état d'avant permet l'annulation : refermer par erreur un ticket
        // qui attendait un fournisseur doit se défaire.
        metadata: { previousStatus: ticket.status },
        ipAddress: request.ip,
      });

      return reply.send({ previousStatus: ticket.status });
    },
  );

  /**
   * Relance les tickets que l'IA n'a pas su traiter.
   *
   * Une panne d'IA ne touche jamais un ticket : elle les touche tous, et les
   * reprendre un par un n'a aucun sens. Une fois la cause levée — clé
   * corrigée, quota rechargé —, ce bouton remet la file entière en traitement.
   */
  app.post(
    '/api/tickets/retry-failed',
    { preHandler: requirePermission('reply') },
    async (request, reply) => {
      const { merchantId } = request.session;

      /*
       * Toute la file en un clic, par pages de mille.
       *
       * La version précédente s'arrêtait à mille et demandait de recliquer.
       * Le ticket ne quitte l'état FAILED qu'une fois le worker passé — bien
       * après la réponse — donc « relancer pour la suite » repropose surtout
       * les mêmes : sur trois mille échecs, le marchand cliquait sans voir la
       * file avancer. On pagine ici par identifiant croissant, ce qui garantit
       * d'avancer quel que soit l'état des tickets déjà remis en file.
       */
      const PAGE = 1000;
      const MAX = 20_000;

      let cursor: string | undefined;
      let queued = 0;
      let seen = 0;

      for (;;) {
        const page = await prisma.ticket.findMany({
          where: { merchantId, status: 'FAILED', isHistorical: false },
          select: { id: true },
          orderBy: { id: 'asc' },
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
          take: PAGE,
        });

        if (page.length === 0) break;

        for (const ticket of page) {
          try {
            // `replace` : la tâche précédente de ce ticket existe encore et
            // ferait rejeter la nouvelle en silence — c'est ce qui rendait ce
            // bouton sans effet.
            await enqueueTicket({ merchantId, ticketId: ticket.id }, { replace: true });
            queued += 1;
          } catch (error) {
            request.log.error({ err: error, ticketId: ticket.id }, 'Relance impossible');
          }
        }

        seen += page.length;
        cursor = page[page.length - 1]!.id;

        if (page.length < PAGE || seen >= MAX) break;
      }

      return reply.send({ queued, remaining: seen >= MAX });
    },
  );

  app.patch<{ Params: { id: string } }>(
    '/api/tickets/:id/snooze',
    { preHandler: requirePermission('reply') },
    async (request, reply) => {
      const parsed = z
        .object({
          /** Nombre d'heures, ou `null` pour réveiller tout de suite. */
          hours: z.number().int().min(1).max(24 * 30).nullable(),
        })
        .safeParse(request.body);

      if (!parsed.success) return reply.code(400).send({ error: 'Durée invalide' });

      const { merchantId, userId } = request.session;

      const ticket = await prisma.ticket.findFirst({
        where: { id: request.params.id, merchantId },
        select: { id: true, snoozedUntil: true },
      });
      if (!ticket) return reply.code(404).send({ error: 'Ticket introuvable' });

      const until =
        parsed.data.hours === null
          ? null
          : new Date(Date.now() + parsed.data.hours * 60 * 60 * 1000);

      await prisma.ticket.update({
        where: { id: ticket.id },
        data: { snoozedUntil: until },
      });

      await recordAudit({
        merchantId,
        actorType: 'USER',
        actorId: userId,
        action: until ? 'ticket.snoozed' : 'ticket.woken',
        targetType: 'Ticket',
        targetId: ticket.id,
        metadata: { until: until?.toISOString() ?? null },
        ipAddress: request.ip,
      });

      // L'état précédent revient dans la réponse : c'est lui qui permet à
      // l'interface de proposer une annulation sans rien deviner.
      return reply.send({
        snoozedUntil: until,
        previous: ticket.snoozedUntil,
      });
    },
  );

  app.patch<{ Params: { id: string } }>(
    '/api/tickets/:id/assign',
    { preHandler: requirePermission('reply') },
    async (request, reply) => {
      const parsed = z
        .object({ userId: z.string().min(1).nullable() })
        .safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: 'Agent invalide' });

      const { merchantId, userId: actorId } = request.session;

      const ticket = await prisma.ticket.findFirst({
        where: { id: request.params.id, merchantId },
        select: { id: true },
      });
      if (!ticket) return reply.code(404).send({ error: 'Ticket introuvable' });

      // L'agent visé doit appartenir à cette boutique et être actif : sans ce
      // contrôle, un identifiant d'un autre marchand passerait.
      if (parsed.data.userId) {
        const target = await prisma.user.findFirst({
          where: { id: parsed.data.userId, merchantId, active: true },
          select: { id: true },
        });
        if (!target) {
          return reply.code(400).send({ error: 'Cet agent n’existe pas sur cette boutique.' });
        }
      }

      const updated = await prisma.ticket.update({
        where: { id: ticket.id },
        data: { assignedToId: parsed.data.userId },
        select: { assignedTo: { select: { id: true, name: true, email: true } } },
      });

      await recordAudit({
        merchantId,
        actorType: 'USER',
        actorId,
        action: parsed.data.userId ? 'ticket.assigned' : 'ticket.unassigned',
        targetType: 'Ticket',
        targetId: ticket.id,
        metadata: { userId: parsed.data.userId },
        ipAddress: request.ip,
      });

      return reply.send({ assignedTo: updated.assignedTo });
    },
  );

  /**
   * Remplacements possibles pour la commande rattachée au ticket.
   *
   * Croisement ticket → commande → catalogue : c'est la question que l'agent
   * se pose devant une rupture, et la seule réponse utile est « quoi d'autre,
   * en stock, tout de suite ».
   */
  app.get<{ Params: { id: string } }>('/api/tickets/:id/substitutions', async (request, reply) => {
    const { merchantId } = request.session;

    const ticket = await prisma.ticket.findFirst({
      where: { id: request.params.id, merchantId },
      select: { shopifyOrderId: true },
    });

    if (!ticket) return reply.code(404).send({ error: 'Ticket introuvable' });
    if (!ticket.shopifyOrderId) {
      return reply.send({
        options: [],
        reason: 'Aucune commande rattachée : impossible de savoir quoi remplacer.',
      });
    }

    try {
      const shopify = await getShopifyClient(merchantId);
      const order = await getOrderById(shopify, ticket.shopifyOrderId);

      const titles = [...new Set(order?.lineItems.map((line) => line.title) ?? [])];
      if (titles.length === 0) {
        return reply.send({ options: [], reason: 'Cette commande ne contient aucun article.' });
      }

      // Un seul appel plutôt qu'un par article : les titres partagent le plus
      // souvent la même gamme, et Shopify limite le débit des requêtes.
      const query = titles.map((title) => `title:*${title.split(/\s+/)[0]}*`).join(' OR ');
      const options = await listVariants(shopify, { query });

      return reply.send({
        options: options.filter((option) => option.availableForSale),
        orderedTitles: titles,
      });
    } catch (error) {
      request.log.warn({ err: error }, 'Recherche de substitution en échec');
      return reply.code(502).send({
        error:
          error instanceof ShopifyError
            ? 'Catalogue indisponible : la boutique Shopify n’a pas répondu.'
            : 'Catalogue indisponible.',
      });
    }
  });

  /**
   * Vue d'ensemble du groupe : une carte par boutique.
   *
   * Ce qu'un exploitant de plusieurs boutiques regarde le matin — où ça brûle,
   * et pas seulement combien il y a de tickets. D'où « en retard » et « litiges »
   * en évidence : ce sont les deux chiffres qui coûtent de l'argent.
   */
  app.get('/api/overview', async (request, reply) => {
    const { merchantId, email } = request.session;
    const shops = await listShopsFor(merchantId, email);
    const ids = shops.length > 0 ? shops.map((shop) => shop.id) : [merchantId];

    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const lateBefore = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);

    const OPEN = ['NEW', 'PROCESSING', 'DRAFT_READY', 'NEEDS_REVIEW', 'AWAITING_SUPPLIER'] as const;

    const [open, late, disputes, closed] = await Promise.all([
      prisma.ticket.groupBy({
        by: ['merchantId'],
        where: { merchantId: { in: ids }, isHistorical: false, status: { in: [...OPEN] } },
        _count: true,
      }),
      // « En retard » se compte sur les tickets encore ouverts : un ticket clos
      // il y a un mois n'est pas en retard, il est fini.
      prisma.ticket.groupBy({
        by: ['merchantId'],
        where: {
          merchantId: { in: ids },
          isHistorical: false,
          status: { in: [...OPEN] },
          lastMessageAt: { lte: lateBefore },
        },
        _count: true,
      }),
      prisma.ticket.groupBy({
        by: ['merchantId'],
        where: { merchantId: { in: ids }, isHistorical: false, intent: 'DISPUTE', status: { in: [...OPEN] } },
        _count: true,
      }),
      prisma.ticket.groupBy({
        by: ['merchantId'],
        where: {
          merchantId: { in: ids },
          isHistorical: false,
          status: { in: ['CLOSED', 'AUTO_SENT'] },
          lastMessageAt: { gte: since },
        },
        _count: true,
      }),
    ]);

    const countOf = (rows: Array<{ merchantId: string; _count: number }>, id: string) =>
      rows.find((row) => row.merchantId === id)?._count ?? 0;

    return reply.send({
      shops: (shops.length > 0
        ? shops
        : [{ id: merchantId, label: 'Ma boutique', color: '#2f6fe4', current: true }]
      ).map((shop) => {
        const openCount = countOf(open, shop.id);
        const closedCount = countOf(closed, shop.id);
        const disputeCount = countOf(disputes, shop.id);
        const handled = openCount + closedCount;

        return {
          id: shop.id,
          label: shop.label,
          color: shop.color,
          current: shop.current,
          open: openCount,
          late: countOf(late, shop.id),
          disputes: disputeCount,
          closed30d: closedCount,
          // Part de litiges sur trente jours : au-delà de 1 %, Shopify gèle les
          // paiements d'une boutique. C'est le seul indicateur de cet écran qui
          // annonce une sanction plutôt qu'une charge de travail.
          disputeRate: handled === 0 ? 0 : Number(((disputeCount / handled) * 100).toFixed(2)),
        };
      }),
      /** Seuil Shopify, en pourcentage de commandes contestées. */
      disputeThreshold: 1,
    });
  });

  app.get('/api/metrics', async (request, reply) => {
    const { merchantId } = request.session;
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    /*
     * Deux fenêtres différentes, et c'est tout le sujet.
     *
     * L'état de la file — combien attendent, combien ont échoué — se compte
     * sur l'ensemble, sans borne de date : un mail de mars qui attend toujours
     * attend toujours, l'oublier parce qu'il est vieux serait exactement
     * l'erreur qu'un SAV ne peut pas se permettre.
     *
     * Le travail accompli, lui, se compte sur trente jours — mais d'après la
     * date où on l'a fait (`updatedAt`), pas d'après la date du dernier message
     * du client. La version précédente filtrait sur `lastMessageAt` : clore
     * aujourd'hui cinquante mails vieux de deux mois n'incrémentait rien, et le
     * compteur affichait « 0 traités » à quelqu'un qui venait d'en traiter
     * cinquante. Un chiffre faux en tête d'écran décrédibilise les vrais.
     */
    const [byStatus, handled, sentDrafts, totalDrafts] = await Promise.all([
      prisma.ticket.groupBy({
        by: ['status'],
        where: { merchantId, isHistorical: false },
        _count: true,
      }),
      prisma.ticket.count({
        where: {
          merchantId,
          isHistorical: false,
          status: { in: ['CLOSED', 'AUTO_SENT'] },
          updatedAt: { gte: since },
        },
      }),
      prisma.draft.count({ where: { merchantId, status: 'SENT', sentAt: { gte: since } } }),
      prisma.draft.count({ where: { merchantId, createdAt: { gte: since } } }),
    ]);

    const counts = Object.fromEntries(byStatus.map((row) => [row.status, row._count]));

    return reply.send({
      window: '30j',
      tickets: counts,
      /** Traités sur la fenêtre, d'après la date de traitement. */
      handled,
      /** Réponses réellement parties, sous-ensemble du précédent. */
      sent: sentDrafts,
      failed: counts.FAILED ?? 0,
      pending: (counts.NEEDS_REVIEW ?? 0) + (counts.DRAFT_READY ?? 0),
      // Taux d'automatisation = part des brouillons IA effectivement envoyés.
      // `null` et non zéro quand il n'y a aucun brouillon : « 0 % » se lit
      // comme un échec, alors qu'il n'y a simplement rien à mesurer.
      automationRate: totalDrafts === 0 ? null : Number((sentDrafts / totalDrafts).toFixed(3)),
    });
  });

  // Écran de détail : fil + brouillon + contexte commande/client/livraison.
  app.get<{ Params: { id: string } }>('/api/tickets/:id', async (request, reply) => {
    const { merchantId, email } = request.session;

    // En mode « toutes les boutiques », la file agrège plusieurs boutiques :
    // le détail doit suivre, sinon ouvrir un ticket listé renvoie une erreur.
    // La lecture s'élargit, l'action non — c'est signalé par `readOnly`.
    const readable = await accessibleMerchantIds({ merchantId, email });

    const ticket = await prisma.ticket.findFirst({
      where: { id: request.params.id, merchantId: { in: readable } },
      include: {
        messages: {
          orderBy: { receivedAt: 'asc' },
          include: {
            // Le contenu reste chez Gmail : on ne sert ici que de quoi
            // afficher une vignette et bâtir son lien.
            attachments: {
              select: { id: true, filename: true, mimeType: true, size: true },
            },
          },
        },
        drafts: { orderBy: { createdAt: 'desc' }, take: 5 },
      },
    });

    if (!ticket) return reply.code(404).send({ error: 'Ticket introuvable' });

    // Un ticket d'une autre boutique se consulte mais ne se traite pas : les
    // droits de l'utilisateur y sont peut-être différents, et le brouillon
    // partirait de la mauvaise boîte mail.
    const readOnly = ticket.merchantId !== merchantId;

    // Les données de commande viennent de Shopify en direct. Si la boutique
    // n'est pas connectée ou répond mal, on sert quand même le ticket : perdre
    // la sidebar est gênant, perdre le mail est inacceptable.
    let order = null;
    let orderError: string | null = null;

    if (ticket.shopifyOrderId) {
      try {
        // Client Shopify de la boutique du ticket, pas de celle de la session.
        const shopify = await getShopifyClient(ticket.merchantId);
        order = await getOrderById(shopify, ticket.shopifyOrderId);
      } catch (error) {
        orderError =
          error instanceof ShopifyError
            ? 'Détails indisponibles : boutique Shopify non connectée.'
            : 'Détails indisponibles : Shopify n’a pas répondu.';
        request.log.warn({ err: error, ticketId: ticket.id }, 'Lecture commande Shopify en échec');
      }
    }

    /*
     * Les autres messages du même client.
     *
     * Un client qui écrit deux fois en une semaine ouvre deux fils Gmail,
     * donc deux lignes chez nous. Répondre à l'un sans savoir que l'autre
     * existe, c'est envoyer deux réponses qui s'ignorent — au mieux le client
     * les trouve incohérentes, au pire elles se contredisent.
     *
     * Rapprochés par adresse email : c'est la seule clé fiable. Le nom
     * s'écrit de dix façons, le numéro de commande manque une fois sur deux.
     */
    const siblings = await prisma.ticket.findMany({
      where: {
        merchantId: ticket.merchantId,
        customerEmail: ticket.customerEmail,
        id: { not: ticket.id },
        isHistorical: false,
      },
      orderBy: { lastMessageAt: 'desc' },
      take: 10,
      select: {
        id: true,
        subject: true,
        status: true,
        intent: true,
        orderName: true,
        lastMessageAt: true,
      },
    });

    /*
     * Demandes de changement adressées au fournisseur depuis ce mail.
     *
     * Affichées dans le fil : sans elles, l'agent qui rouvre le message deux
     * jours plus tard ne sait pas si quelqu'un a déjà demandé la taille 45, et
     * la demande part une seconde fois — ou pire, on répond au client que
     * c'est fait alors que le fournisseur a refusé.
     */
    const changes = await prisma.supplierAlert.findMany({
      where: { ticketId: ticket.id, merchantId: ticket.merchantId },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: {
        id: true,
        kind: true,
        status: true,
        beforeValue: true,
        afterValue: true,
        message: true,
        supplierNote: true,
        createdAt: true,
        acknowledgedAt: true,
        supplier: { select: { name: true } },
      },
    });

    return reply.send({ ticket, order, orderError, readOnly, siblings, changes });
  });

  /**
   * Commandes candidates pour un rattachement manuel : c'est la sortie de
   * secours quand l'association automatique a refusé de trancher.
   */
  app.get<{ Params: { id: string }; Querystring: { q?: string } }>(
    '/api/tickets/:id/order-candidates',
    async (request, reply) => {
      const { merchantId } = request.session;

      const ticket = await prisma.ticket.findFirst({
        where: { id: request.params.id, merchantId },
        select: { customerEmail: true, customerName: true },
      });

      if (!ticket) return reply.code(404).send({ error: 'Ticket introuvable' });

      const search = request.query.q?.trim();
      const query = search
        ? search.startsWith('#')
          ? `name:${quoteSearchValue(search)}`
          : quoteSearchValue(search)
        : `email:${quoteSearchValue(ticket.customerEmail)}`;

      try {
        const shopify = await getShopifyClient(merchantId);
        const orders = await searchOrders(shopify, query, 10);
        return reply.send({ orders });
      } catch (error) {
        request.log.warn({ err: error }, 'Recherche de commandes en échec');
        return reply.code(503).send({ error: 'Boutique Shopify indisponible' });
      }
    },
  );

  /** Rattachement manuel : l'agent tranche là où l'automatisme s'est abstenu. */
  app.post<{ Params: { id: string }; Body: { orderId?: string } }>(
    '/api/tickets/:id/order',
    { preHandler: requirePermission('reply') },
    async (request, reply) => {
      const { merchantId, userId } = request.session;
      const orderId = z.string().min(1).safeParse(request.body?.orderId);

      if (!orderId.success) return reply.code(400).send({ error: 'orderId requis' });

      const ticket = await prisma.ticket.findFirst({
        where: { id: request.params.id, merchantId },
        select: { id: true },
      });

      if (!ticket) return reply.code(404).send({ error: 'Ticket introuvable' });

      const shopify = await getShopifyClient(merchantId);
      const order = await getOrderById(shopify, orderId.data);

      if (!order) return reply.code(404).send({ error: 'Commande introuvable' });

      const updated = await prisma.ticket.update({
        where: { id: ticket.id },
        data: {
          shopifyOrderId: order.id,
          orderName: order.name,
          orderMatchMethod: 'MANUAL',
          orderMatchScore: 1,
        },
      });

      await recordAudit({
        merchantId,
        actorType: 'USER',
        actorId: userId,
        action: 'ticket.order_attached',
        targetType: 'Ticket',
        targetId: ticket.id,
        metadata: { orderName: order.name },
        ipAddress: request.ip,
      });

      return reply.send({ ticket: updated, order });
    },
  );

  /** Journal d'audit du marchand, affiché en colonne de droite. */
  app.get('/api/audit', async (request, reply) => {
    const { merchantId } = request.session;
    const entries = await prisma.auditLog.findMany({
      where: { merchantId },
      orderBy: { createdAt: 'desc' },
      take: 30,
      select: {
        id: true,
        action: true,
        actorType: true,
        targetType: true,
        targetId: true,
        metadata: true,
        createdAt: true,
      },
    });
    return reply.send({ entries });
  });

  // Édition du brouillon par l'agent avant envoi.
  app.patch<{ Params: { id: string }; Body: { body?: string } }>(
    '/api/drafts/:id',
    { preHandler: requirePermission('reply') },
    async (request, reply) => {
      const { merchantId, userId } = request.session;
      const body = z.string().min(1).safeParse(request.body?.body);

      if (!body.success) return reply.code(400).send({ error: 'Corps du brouillon requis' });

      const draft = await prisma.draft.findFirst({
        where: { id: request.params.id, merchantId },
        include: { ticket: true },
      });

      if (!draft) return reply.code(404).send({ error: 'Brouillon introuvable' });
      if (draft.status === 'SENT') {
        return reply.code(409).send({ error: 'Brouillon déjà envoyé' });
      }

      if (draft.gmailDraftId) {
        await updateDraftBody({
          merchantId,
          mailboxId: draft.ticket.mailboxId,
          draftId: draft.gmailDraftId,
          threadId: draft.ticket.gmailThreadId,
          to: draft.ticket.customerEmail,
          subject: draft.ticket.subject ?? 'Votre demande',
          body: body.data,
        });
      }

      const updated = await prisma.draft.update({
        where: { id: draft.id },
        data: { body: body.data, status: 'EDITED', createdBy: 'HUMAN' },
      });

      await recordAudit({
        merchantId,
        actorType: 'USER',
        actorId: userId,
        action: 'draft.edited',
        targetType: 'Draft',
        targetId: draft.id,
        ipAddress: request.ip,
      });

      return reply.send(updated);
    },
  );

  // Envoi — toujours déclenché par un humain en phase 1.
  app.post<{ Params: { id: string } }>(
    '/api/drafts/:id/send',
    { preHandler: requirePermission('reply') },
    async (request, reply) => {
    const { merchantId, userId } = request.session;

    const draft = await prisma.draft.findFirst({
      where: { id: request.params.id, merchantId },
      include: { ticket: true },
    });

    if (!draft) return reply.code(404).send({ error: 'Brouillon introuvable' });
    if (draft.status === 'SENT') return reply.code(409).send({ error: 'Déjà envoyé' });
    if (!draft.gmailDraftId) {
      return reply.code(409).send({ error: 'Aucun brouillon Gmail associé' });
    }

    await sendDraft(merchantId, draft.gmailDraftId, draft.ticket.mailboxId);

    await prisma.$transaction([
      prisma.draft.update({
        where: { id: draft.id },
        data: { status: 'SENT', sentAt: new Date() },
      }),
      prisma.ticket.update({ where: { id: draft.ticketId }, data: { status: 'CLOSED' } }),
    ]);

    await recordAudit({
      merchantId,
      actorType: 'USER',
      actorId: userId,
      action: 'draft.sent',
      targetType: 'Draft',
      targetId: draft.id,
      metadata: { ticketId: draft.ticketId },
      ipAddress: request.ip,
    });

    return reply.send({ ok: true });
  });

  /**
   * Message sortant à l'initiative de l'agent, hors ticket.
   *
   * Distinct d'une réponse : il n'y a pas de fil à poursuivre, pas de brouillon
   * à relire. La règle « rien ne part sans validation humaine » est respectée
   * par construction — c'est un humain qui écrit et qui clique.
   */
  app.post(
    '/api/emails',
    { preHandler: requirePermission('reply') },
    async (request, reply) => {
      const parsed = z
        .object({
          to: z.string().email(),
          subject: z.string().min(1).max(200),
          body: z.string().min(1).max(20000),
        })
        .safeParse(request.body);

      if (!parsed.success) {
        return reply.code(400).send({ error: 'Requête invalide', details: parsed.error.issues });
      }

      const { merchantId, userId } = request.session;

      try {
        await sendPlainEmail({ merchantId, ...parsed.data });
      } catch (error) {
        request.log.error({ err: error }, 'Envoi de message libre en échec');
        return reply.code(502).send({
          error:
            'Envoi impossible : vérifiez que la boîte Gmail est connectée dans les réglages.',
        });
      }

      await recordAudit({
        merchantId,
        actorType: 'USER',
        actorId: userId,
        action: 'email.sent',
        metadata: { to: parsed.data.to, subject: parsed.data.subject },
        ipAddress: request.ip,
      });

      return reply.send({ ok: true });
    },
  );
}
