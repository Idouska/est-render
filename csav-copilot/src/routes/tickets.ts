import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { env } from '../config/env.ts';
import { recordAudit } from '../lib/audit.ts';
import { logger } from '../lib/logger.ts';
import { prisma } from '../lib/prisma.ts';
import { PERMISSIONS, PREVIEW_COOKIE, requirePermission, requireSession } from '../plugins/auth.ts';
import { enqueueTicket } from '../queue/index.ts';
import { accessibleMerchantIds, listShopsFor } from './shops.ts';
import { sendDraft, sendReplyInThread, updateDraftBody } from '../services/gmail/drafts.ts';
import { syncTicketThread } from '../services/gmail/thread.ts';
import { PORTEE_NON_LU } from '../services/gmail/unreadScope.ts';
import { sendPlainEmail } from '../services/gmail/send.ts';
import { getShopifyClient, ShopifyError } from '../services/shopify/client.ts';
import { listVariants } from '../services/shopify/catalog.ts';
import { getOrderById, quoteSearchValue, searchOrders } from '../services/shopify/orders.ts';
import { QUEUE_SELECT } from './queueFields.ts';
import { processTicket } from '../services/tickets/process.ts';
import { discardPendingDrafts } from '../services/tickets/discardDrafts.ts';
import { translateToFrench } from '../services/ai/translate.ts';
import { retardFournisseurs } from '../services/suppliers/retard.ts';

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
   * Ce que personne n'a encore ouvert dans Gmail.
   *
   * Croise les autres filtres au lieu de les remplacer : « non lu à valider »
   * et « non lu portant le libellé Litige » sont des questions qu'on se pose.
   * Le front ne pose ce paramètre que lorsqu'il est actif — `z.coerce.boolean`
   * ne fait qu'un `Boolean(valeur)`, et la chaîne « false » vaudrait vrai.
   */
  unread: z.coerce.boolean().optional(),
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
  /**
   * Dossier, à la manière de Gmail.
   *
   * `inbox` est ce que la file montre par défaut : ce qui reste à traiter.
   * `archived` recueille les fils sortis de la boîte de réception — le geste
   * par lequel une équipe dit « j'en ai fini ».
   *
   * `drafts` et `sent` ne viennent pas de Gmail et ne le peuvent pas : le
   * produit a cessé d'écrire des brouillons dans la boîte partagée, parce
   * qu'un brouillon posé là s'envoie depuis n'importe quel téléphone, hors de
   * l'outil, sans contrôle de rôle ni plafond ni journal. Ces deux dossiers
   * lisent donc ce que le produit détient en propre : ses propositions en
   * attente de relecture, et les fils où une réponse est réellement partie.
   *
   * `all` conserve le comportement d'avant ces dossiers, et reste le défaut
   * pour ne rien casser chez un appelant qui ne les connaît pas.
   */
  folder: z.enum(['inbox', 'archived', 'drafts', 'sent', 'all']).default('all'),
  /** `all` élargit la file à toutes les boutiques du groupe. */
  scope: z.enum(['shop', 'all']).default('shop'),
  sort: z.enum(['oldest', 'newest', 'confidence', 'amount', 'due']).default('newest'),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

/** Minuit, heure du serveur. Isolé pour se lire, et pour se corriger d'un
    seul endroit le jour où le fuseau du marchand sera connu. */
function startOfToday(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

/**
 * Clause du dossier courant.
 *
 * Chacune tient sur une clé de premier niveau, jamais sur `AND` ni `OR` : ces
 * deux-là sont déjà pris — par la veille et par la recherche libre — et deux
 * clés identiques dans le même objet s'écrasent en silence. Le filtre
 * disparaîtrait sans la moindre erreur, ce qui est déjà arrivé ici.
 */
function folderWhere(folder: 'inbox' | 'archived' | 'drafts' | 'sent' | 'all') {
  switch (folder) {
    case 'inbox':
      return { gmailArchived: false };
    case 'archived':
      return { gmailArchived: true };
    case 'drafts':
      // Une proposition qui attend une relecture, pas un brouillon Gmail.
      return { drafts: { some: { status: 'PENDING_REVIEW' as const } } };
    case 'sent':
      // Un fil où quelque chose est parti de notre côté.
      return { messages: { some: { direction: 'OUTBOUND' as const } } };
    default:
      return {};
  }
}

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
  options: { withStatus: boolean; withFolder?: boolean },
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
    // Clé de premier niveau, comme tout le reste ici : ni `AND` ni `OR`, tous
    // deux déjà pris — par la veille et par la recherche libre — et deux clés
    // identiques dans le même objet s'écrasent sans la moindre erreur.
    ...(filters.unread ? { gmailUnread: true } : {}),
    ...(options.withFolder === false ? {} : folderWhere(filters.folder)),
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
async function recordOutbound(params: {
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
        /*
         * La signature part avec l'identité : le composeur l'injecte à
         * l'ouverture, et il s'ouvre sans être passé par les Réglages, seul
         * écran qui la chargeait jusqu'ici.
         */
        emailSignature: merchant.emailSignature,
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
        select: QUEUE_SELECT,
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

    // Le motif n°1 d'une boutique de dropshipping a sa pastille dédiée dans la
    // file : le compte porte sur les WISMO encore ouverts, pas sur l'histoire.
    counts.WISMO = await prisma.ticket.count({
      where: {
        merchantId: { in: merchantIds },
        intent: 'WISMO',
        isHistorical: false,
        status: { notIn: ['CLOSED', 'AUTO_SENT'] },
      },
    });


    /*
     * Compteurs des dossiers, calculés hors dossier courant.
     *
     * Même raison que les compteurs de statut : un rail où chaque dossier
     * n'afficherait son nombre qu'une fois ouvert ne servirait à rien — c'est
     * précisément avant d'y aller qu'on veut savoir s'il y a quelque chose.
     */
    const folderBase = buildTicketWhere(merchantIds, query.data, {
      withStatus: false,
      withFolder: false,
    });

    const [inbox, archived, drafts, sent] = await Promise.all(
      (['inbox', 'archived', 'drafts', 'sent'] as const).map((name) =>
        prisma.ticket.count({ where: { ...folderBase, ...folderWhere(name) } }),
      ),
    );

    /*
     * Compteur de la pastille « Non lu ».
     *
     * Il honore le dossier, la recherche, les libellés, la boîte, l'assigné,
     * le montant et l'ancienneté — tout ce que le compteur WISMO ignore en
     * redéclarant son propre `where`, ce qui lui fait annoncer des nombres que
     * la liste ne rend pas.
     *
     * Il ignore en revanche le statut coché, délibérément et comme toutes les
     * pastilles de cette barre. Le nombre répond donc à « combien de non lus
     * dans ce que je regarde », et non à « combien de lignes après un clic ».
     *
     * Une revue a proposé l'inverse : compter statut compris, pour que le
     * nombre prédise exactement la liste. C'est défendable, mais « Non lu »
     * deviendrait la seule pastille de la barre à appliquer le statut — sa
     * voisine immédiate WISMO, qui croise elle aussi, ne le fait pas. Deux
     * pastilles croisées côte à côte comptant sur des bases différentes se
     * comparent mal, et se comparer est ce à quoi sert un rail de filtres.
     * Corriger la prédiction supposerait de changer la convention entière, pas
     * cette ligne.
     */
    counts.UNREAD = await prisma.ticket.count({
      where: {
        ...buildTicketWhere(merchantIds, query.data, { withStatus: false }),
        gmailUnread: true,
      },
    });

    return reply.send({
      tickets: tickets.map((ticket) => ({
        ...ticket,
        /** Nombre d'échanges avec ce client, celui-ci compris. */
        threads: threadsByEmail[ticket.customerEmail] ?? 1,
      })),
      folders: { inbox, archived, drafts, sent },
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
        // Les brouillons Gmail des tickets clos, en arrière-plan : sur une
        // sélection de cinq cents tickets, les appels Gmail dépasseraient le
        // délai de la requête.
        void (async () => {
          for (const id of ids) await discardPendingDrafts(merchantId, id).catch(() => {});
        })();
        break;
      }

      case 'reopen': {
        affected = (
          await prisma.ticket.updateMany({ where: scope, data: { status: 'NEEDS_REVIEW' } })
        ).count;
        break;
      }

      case 'delete': {
        // Avant l'effacement : la cascade emporte les lignes Draft, et avec
        // elles le seul lien vers les brouillons Gmail.
        for (const id of ids) await discardPendingDrafts(merchantId, id).catch(() => {});
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

      // Avant l'effacement en base : après, la ligne Draft (et son identifiant
      // Gmail) disparaît en cascade et le brouillon Gmail devient orphelin.
      await discardPendingDrafts(merchantId, ticket.id).catch(() => {});

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

      // Un ticket clos n'attend plus de réponse : son brouillon Gmail non
      // envoyé n'a plus de raison d'encombrer la boîte du marchand.
      await discardPendingDrafts(merchantId, ticket.id).catch(() => {});

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
     * Le seuil au-delà duquel une demande au fournisseur est « en retard ».
     *
     * Vingt-quatre heures, et non « le rappel est parti » — qui serait
     * pourtant le marqueur naturel : le cron relance à douze heures et ne
     * relance qu'une fois, après quoi c'est au marchand de téléphoner. Mais
     * lire `remindedAt` ferait dépendre le compteur de notre propre
     * machinerie : cron suspendu, boîte d'envoi en panne, et le chiffre
     * retombe à zéro alors que les fournisseurs se taisent toujours. Un
     * compteur d'alerte qui s'éteint quand la surveillance tombe est pire
     * que pas de compteur du tout.
     *
     * Une journée pleine sans réponse est un fait sur le fournisseur, vrai
     * que le rappel soit parti ou non.
     */
    const supplierLateBefore = new Date(Date.now() - 24 * 60 * 60 * 1000);

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
    const [byStatus, handled, today, sentDrafts, totalDrafts, unread, supplierLate] =
      await Promise.all([
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
      /*
       * Ce qui a été traité depuis ce matin.
       *
       * Trente jours disent la tendance, la journée dit l'avancement — et
       * c'est l'avancement qu'on regarde à midi pour savoir s'il faut
       * accélérer. Le seuil est minuit dans le fuseau du serveur, ce qui suffit
       * tant qu'une boutique et son équipe partagent le même : le jour
       * calendaire du marchand demanderait de stocker son fuseau, que rien ne
       * connaît aujourd'hui.
       */
      prisma.ticket.count({
        where: {
          merchantId,
          isHistorical: false,
          status: { in: ['CLOSED', 'AUTO_SENT'] },
          updatedAt: { gte: startOfToday() },
        },
      }),
      prisma.draft.count({ where: { merchantId, status: 'SENT', sentAt: { gte: since } } }),
      prisma.draft.count({ where: { merchantId, createdAt: { gte: since } } }),
      /*
       * Ce qui n'a pas encore été ouvert dans Gmail.
       *
       * Le compte se lisait auparavant des statuts de l'outil — à relire, ou
       * proposition prête. Il ne bougeait donc jamais quand l'équipe traitait
       * son courrier dans Gmail, ce qu'elle fait aussi : la pastille restait à
       * son chiffre pendant qu'on vidait la boîte, et un compteur qui ne
       * descend jamais n'est plus un compteur, c'est un décor.
       *
       * Les fils clos sont exclus : rouvrir une archive qui n'a jamais été
       * marquée lue la ferait remonter dans le compte pour rien.
       */
      prisma.ticket.count({
        where: { merchantId, gmailUnread: true, ...PORTEE_NON_LU },
      }),
      /*
       * Les demandes qu'un fournisseur laisse sans réponse depuis un jour.
       *
       * Regroupées par fournisseur plutôt que comptées : le nombre de
       * demandes dit la charge, le nombre de fournisseurs dit qui appeler.
       * Six demandes chez un seul atelier, c'est un coup de fil ; six
       * demandes chez six ateliers, c'est une matinée. Un compteur unique
       * confondrait les deux.
       */
      prisma.supplierAlert.groupBy({
        by: ['supplierId'],
        where: { merchantId, status: 'PENDING', createdAt: { lte: supplierLateBefore } },
        _count: true,
        _min: { createdAt: true },
      }),
    ]);

    const counts = Object.fromEntries(byStatus.map((row) => [row.status, row._count]));

    const enRetard = retardFournisseurs(supplierLate);

    /*
     * Délai moyen de première réponse.
     *
     * Le temps entre le premier message du client et la première réponse
     * partie. C'est l'indicateur que le client ressent : il ne sait pas
     * combien de tickets on traite, il sait combien de temps il a attendu.
     *
     * Calculé en deux regroupements plutôt qu'en SQL brut : Prisma valide les
     * noms de champs au typecheck, là où une requête brute ne les vérifie
     * qu'à l'exécution — et cette route sert toute la bande d'indicateurs.
     * Une erreur de nom la ferait tomber entière.
     *
     * Borné à la fenêtre de trente jours : la moyenne de toute l'histoire du
     * marchand décrirait l'année dernière, et pèserait le double en base.
     */
    const scope = { merchantId, ticket: { isHistorical: false, createdAt: { gte: since } } };

    const [firstIn, firstOut] = await Promise.all([
      prisma.message.groupBy({
        by: ['ticketId'],
        where: { ...scope, direction: 'INBOUND' },
        _min: { receivedAt: true },
      }),
      prisma.message.groupBy({
        by: ['ticketId'],
        where: { ...scope, direction: 'OUTBOUND' },
        _min: { receivedAt: true },
      }),
    ]);

    const askedAt = new Map(firstIn.map((row) => [row.ticketId, row._min.receivedAt]));

    const delays = firstOut
      .map((row) => {
        const asked = askedAt.get(row.ticketId);
        const answered = row._min.receivedAt;
        if (!asked || !answered) return null;

        const seconds = (answered.getTime() - asked.getTime()) / 1000;
        // Une réponse antérieure à la demande n'existe pas : c'est un fil
        // importé dont l'ordre s'est perdu, ou une horloge de travers. La
        // compter tirerait la moyenne vers le bas sans que rien ne le dise.
        return seconds > 0 ? seconds : null;
      })
      .filter((seconds): seconds is number => seconds !== null);

    const firstReplySeconds =
      delays.length === 0
        ? null
        : Math.round(delays.reduce((sum, one) => sum + one, 0) / delays.length);

    return reply.send({
      window: '30j',
      /**
       * Délai moyen de première réponse, en secondes. `null` quand aucune
       * réponse n'est partie sur la fenêtre : zéro se lirait comme
       * « instantané », ce qui est l'inverse de « rien mesuré ».
       */
      firstReplySeconds,
      tickets: counts,
      /** Traités sur la fenêtre, d'après la date de traitement. */
      handled,
      /** Traités depuis minuit : l'avancement du jour, pas la tendance. */
      today,
      /** Réponses réellement parties, sous-ensemble du précédent. */
      sent: sentDrafts,
      failed: counts.FAILED ?? 0,
      /** Non lus dans Gmail : ce qui reste à ouvrir, pastille et bandeau. */
      pending: unread,
      /** L'ancien sens, conservé pour qui voudrait les deux. */
      awaitingReview: (counts.NEEDS_REVIEW ?? 0) + (counts.DRAFT_READY ?? 0),
      // Taux d'automatisation = part des brouillons IA effectivement envoyés.
      // `null` et non zéro quand il n'y a aucun brouillon : « 0 % » se lit
      // comme un échec, alors qu'il n'y a simplement rien à mesurer.
      automationRate: totalDrafts === 0 ? null : Number((sentDrafts / totalDrafts).toFixed(3)),
      /**
       * Les fournisseurs qui ne répondent plus.
       *
       * `requests` compte les demandes, `suppliers` les ateliers concernés,
       * `oldestAt` date la plus ancienne — `null` quand il n'y en a aucune,
       * et non une date bidon : l'écran doit pouvoir dire « rien » plutôt
       * qu'afficher une ancienneté inventée.
       */
      suppliersLate: enRetard,
    });
  });

  // Écran de détail : fil + brouillon + contexte commande/client/livraison.
  app.get<{ Params: { id: string } }>('/api/tickets/:id', async (request, reply) => {
    const { merchantId, email } = request.session;

    // En mode « toutes les boutiques », la file agrège plusieurs boutiques :
    // le détail doit suivre, sinon ouvrir un ticket listé renvoie une erreur.
    // La lecture s'élargit, l'action non — c'est signalé par `readOnly`.
    const readable = await accessibleMerchantIds({ merchantId, email });

    /*
     * Relecture du fil, une fois par ticket.
     *
     * Les réponses de l'équipe n'ont jamais été enregistrées : ni celles
     * envoyées depuis l'outil avant ce correctif, ni celles tapées
     * directement dans Gmail. Le fil montrait donc un client qui parle seul.
     * On les rapatrie à la première ouverture — bloquant, parce qu'un fil
     * complété après coup n'aiderait personne, et une seule fois, parce que
     * le marqueur `threadSyncedAt` le dit.
     */
    await syncTicketThread(merchantId, request.params.id).catch(() => 0);

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
        select: { id: true, status: true },
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

      /*
       * La proposition d'avant réclamait le plus souvent le numéro de commande
       * que l'agent vient tout juste de fournir : la laisser en place, c'est
       * redemander au client ce qu'on sait déjà. On rejoue donc le traitement
       * complet, comme le fait « Analyser » — même classification, même
       * génération, et `processTicket` repart maintenant de la commande
       * rattachée au lieu de la remplacer.
       *
       * Le rattachement est déjà écrit et journalisé avant cet appel : s'il
       * échoue ici, il reste acquis. On renvoie alors le ticket sans nouvelle
       * proposition plutôt qu'une erreur, qui ferait croire à l'agent que son
       * rattachement n'a pas pris.
       *
       * Un ticket clos ou déjà répondu ne repasse pas par le modèle : y
       * rattacher une commande corrige la fiche et les statistiques, ça ne
       * rouvre pas la conversation. Le dashboard s'interdit déjà de relancer
       * l'IA sur une archive, et cette route ne doit pas y faire exception.
       */
      const archived = ticket.status === 'CLOSED' || ticket.status === 'AUTO_SENT';

      const draft = archived
        ? null
        : await processTicket(merchantId, ticket.id).then(
            () =>
              prisma.draft.findFirst({
                where: { ticketId: ticket.id },
                orderBy: { createdAt: 'desc' },
              }),
            (error: unknown) => {
              request.log.error(
                { err: error, ticketId: ticket.id },
                'Commande rattachée, régénération de la proposition en échec',
              );
              return null;
            },
          );

      const fresh = await prisma.ticket.findUnique({ where: { id: ticket.id } });

      return reply.send({ ticket: fresh ?? updated, order, draft });
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

    // Deux chemins, le temps que les anciens tickets s'écoulent : un brouillon
    // Gmail hérité s'envoie tel quel — sinon il resterait dans la boîte après
    // l'envoi. Les propositions créées depuis partent directement dans le fil.
    let sent: { gmailMessageId: string | null; fromEmail: string };

    if (draft.gmailDraftId) {
      sent = await sendDraft(merchantId, draft.gmailDraftId, draft.ticket.mailboxId);
    } else {
      const lastInbound = await prisma.message.findFirst({
        where: { ticketId: draft.ticketId, merchantId, direction: 'INBOUND' },
        orderBy: { receivedAt: 'desc' },
        select: { gmailMessageId: true },
      });

      sent = await sendReplyInThread({
        merchantId,
        mailboxId: draft.ticket.mailboxId,
        threadId: draft.ticket.gmailThreadId,
        to: draft.ticket.customerEmail,
        subject: draft.ticket.subject ?? 'Votre demande',
        body: draft.body,
        inReplyToMessageId: lastInbound?.gmailMessageId,
      });
    }

    await prisma.$transaction([
      prisma.draft.update({
        where: { id: draft.id },
        data: { status: 'SENT', sentAt: new Date() },
      }),
      prisma.ticket.update({
        where: { id: draft.ticketId },
        data: { status: 'CLOSED', lastMessageAt: new Date() },
      }),
    ]);

    await recordOutbound({
      merchantId,
      ticketId: draft.ticketId,
      gmailMessageId: sent.gmailMessageId,
      fromEmail: sent.fromEmail,
      toEmail: draft.ticket.customerEmail,
      subject: draft.ticket.subject,
      body: draft.body,
    });

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
          /**
           * Ticket auquel rattacher la réponse, quand elle en poursuit un.
           *
           * L'écran « Écrire au client » part d'un mail ouvert : la réponse
           * appartient à ce fil, et doit s'y lire. Sans ce rattachement, elle
           * partait sans laisser de trace nulle part.
           */
          ticketId: z.string().max(40).optional(),
        })
        .safeParse(request.body);

      if (!parsed.success) {
        return reply.code(400).send({ error: 'Requête invalide', details: parsed.error.issues });
      }

      const { merchantId, userId } = request.session;
      const { ticketId, ...email } = parsed.data;

      // La boîte d'envoi est celle qui a reçu le message : répondre depuis une
      // autre adresse que celle à laquelle le client a écrit le désoriente.
      const ticket = ticketId
        ? await prisma.ticket.findFirst({
            where: { id: ticketId, merchantId },
            select: { id: true, mailboxId: true, subject: true },
          })
        : null;

      let sent: { gmailMessageId: string | null; fromEmail: string };
      try {
        sent = await sendPlainEmail({ merchantId, mailboxId: ticket?.mailboxId, ...email });
      } catch (error) {
        request.log.error({ err: error }, 'Envoi de message libre en échec');
        return reply.code(502).send({
          error:
            'Envoi impossible : vérifiez que la boîte Gmail est connectée dans les réglages.',
        });
      }

      if (ticket) {
        await recordOutbound({
          merchantId,
          ticketId: ticket.id,
          gmailMessageId: sent.gmailMessageId,
          fromEmail: sent.fromEmail,
          toEmail: email.to,
          subject: email.subject,
          body: email.body,
        });

        // Le fil vient de bouger : l'ancienneté du ticket repart de cette
        // réponse, pas du dernier mot du client.
        await prisma.ticket.update({
          where: { id: ticket.id },
          data: { lastMessageAt: new Date() },
        });
      }

      await recordAudit({
        merchantId,
        actorType: 'USER',
        actorId: userId,
        action: 'email.sent',
        metadata: { to: email.to, subject: email.subject, ticketId: ticket?.id ?? null },
        ipAddress: request.ip,
      });

      return reply.send({ ok: true });
    },
  );
}
