import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { env } from '../config/env.ts';
import { recordAudit } from '../lib/audit.ts';
import { signSupplierWorkspaceToken } from '../lib/supplierToken.ts';
import { prisma } from '../lib/prisma.ts';
import { requirePermission, requireSession } from '../plugins/auth.ts';
import { createEscalation, resolveEscalation, sendEscalation } from '../services/suppliers/escalate.ts';
import { sendPlainEmail } from '../services/gmail/send.ts';
import { getShopifyClient } from '../services/shopify/client.ts';
import { listOrders } from '../services/shopify/orders.ts';
import { ordersForSupplier } from '../services/suppliers/routing.ts';

const supplierBody = z.object({
  name: z.string().min(1).max(200),
  contactEmail: z.string().email(),
  ordersAccess: z.enum(['NONE', 'ASSIGNED', 'ALL']).optional(),
  contactName: z.string().max(200).nullish(),
  phone: z.string().max(40).nullish(),
  notes: z.string().max(2000).nullish(),
  active: z.boolean().default(true),
  /** Marques Shopify et préfixes de référence préparés par cet atelier. */
  vendors: z.array(z.string().min(1).max(120)).max(50).optional(),
  skuPrefixes: z.array(z.string().min(1).max(60)).max(50).optional(),
  isDefault: z.boolean().optional(),
});

const escalationBody = z.object({
  reason: z.enum(['OUT_OF_STOCK', 'INCORRECT_ADDRESS', 'MISSING_ITEM', 'OTHER']),
  note: z.string().max(2000).optional(),
  // Destinataire choisi par l'agent. Absent, le service route d'après le motif.
  supplierId: z.string().min(1).optional(),
});

/** Routes côté marchand : configurer le fournisseur, escalader un ticket. */
export async function supplierRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireSession);

  app.get('/api/suppliers', async (request, reply) => {
    const suppliers = await prisma.supplier.findMany({
      where: { merchantId: request.session.merchantId },
      orderBy: [{ active: 'desc' }, { name: 'asc' }],
      include: {
        // Le nombre d'escalades en cours dit lequel de vos contacts vous fait
        // attendre — c'est la seule métrique qui déclenche une action.
        _count: { select: { escalations: { where: { status: { in: ['OPEN', 'ANSWERED'] } } } } },
      },
    });

    return reply.send({
      suppliers: suppliers.map((supplier) => ({
        id: supplier.id,
        name: supplier.name,
        contactEmail: supplier.contactEmail,
        contactName: supplier.contactName,
        phone: supplier.phone,
        active: supplier.active,
        ordersAccess: supplier.ordersAccess,
        vendors: supplier.vendors,
        skuPrefixes: supplier.skuPrefixes,
        isDefault: supplier.isDefault,
        notes: supplier.notes,
        createdAt: supplier.createdAt,
        openEscalations: supplier._count.escalations,
      })),
    });
  });

  /**
   * Le poste de pilotage des ateliers — tout ce que la table ne disait pas.
   *
   * Par fournisseur : ce qu'il a à préparer maintenant (les commandes non
   * expédiées que ses règles lui affectent), ce qu'il a produit (colis du
   * jour, des 30 jours, part avec photo), et ce qui attend chez lui
   * (escalades, demandes de changement, avec l'âge de la plus ancienne).
   * L'écran doit répondre à la question du matin : « est-ce que mes ateliers
   * travaillent, et sur quoi ? » — sans ouvrir chaque fiche.
   */
  app.get('/api/suppliers/hub', async (request, reply) => {
    const { merchantId } = request.session;

    const suppliers = await prisma.supplier.findMany({
      where: { merchantId },
      orderBy: [{ active: 'desc' }, { name: 'asc' }],
      select: {
        id: true,
        name: true,
        active: true,
        vendors: true,
        skuPrefixes: true,
        isDefault: true,
      },
    });
    if (suppliers.length === 0) return reply.send({ suppliers: [] });

    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const monthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    // Les commandes à préparer, réparties par les mêmes règles que l'atelier :
    // le chiffre affiché ici et la liste que voit le fournisseur ne peuvent
    // pas diverger, ils sortent du même calcul.
    let unfulfilled: Awaited<ReturnType<typeof listOrders>>['orders'] = [];
    let shopifyError: string | null = null;
    try {
      const client = await getShopifyClient(merchantId);
      ({ orders: unfulfilled } = await listOrders(client, {
        query: 'fulfillment_status:unfulfilled',
        limit: 100,
      }));
    } catch {
      shopifyError = 'Commandes Shopify injoignables — les « à préparer » manquent.';
    }

    const [alerts, escalations, parcels] = await Promise.all([
      prisma.supplierAlert.findMany({
        where: { merchantId, status: 'PENDING' },
        select: { supplierId: true, createdAt: true },
      }),
      prisma.supplierEscalation.groupBy({
        by: ['supplierId'],
        where: { merchantId, status: { in: ['OPEN', 'ANSWERED'] } },
        _count: true,
      }),
      prisma.parcel.findMany({
        where: { merchantId, createdAt: { gte: monthAgo } },
        select: {
          createdAt: true,
          photoMime: true,
          escalation: { select: { supplierId: true } },
        },
      }),
    ]);

    const escalationCounts = new Map(
      escalations.map((row) => [row.supplierId, row._count]),
    );

    const defaultId = suppliers.find((supplier) => supplier.isDefault)?.id ?? null;

    return reply.send({
      shopifyError,
      suppliers: suppliers.map((supplier) => {
        const others = suppliers.filter((other) => other.id !== supplier.id && other.active);
        const toPrepare = supplier.active
          ? ordersForSupplier(unfulfilled, supplier, others, []).length
          : 0;

        // Les colis d'un atelier : ceux de ses escalades, et — pour l'atelier
        // par défaut — ceux saisis depuis un lien atelier sans escalade, qui
        // sont les siens dans l'immense majorité des boutiques à un atelier.
        const mine = parcels.filter((parcel) =>
          parcel.escalation?.supplierId
            ? parcel.escalation.supplierId === supplier.id
            : supplier.id === defaultId,
        );

        const pending = alerts.filter((alert) => alert.supplierId === supplier.id);
        const oldest = pending.reduce(
          (worst, alert) => (worst && worst < alert.createdAt ? worst : alert.createdAt),
          null as Date | null,
        );

        return {
          id: supplier.id,
          toPrepare,
          parcelsToday: mine.filter((parcel) => parcel.createdAt >= dayAgo).length,
          parcels30d: mine.length,
          photoRate: mine.length
            ? Math.round(
                (mine.filter((parcel) => parcel.photoMime).length / mine.length) * 100,
              )
            : null,
          lastParcelAt: mine.reduce(
            (last, parcel) => (last && last > parcel.createdAt ? last : parcel.createdAt),
            null as Date | null,
          ),
          pendingChanges: pending.length,
          oldestPendingAt: oldest,
          openEscalations: escalationCounts.get(supplier.id) ?? 0,
        };
      }),
    });
  });

  app.post('/api/suppliers', { preHandler: requirePermission('configure') }, async (request, reply) => {
    const parsed = supplierBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Requête invalide', details: parsed.error.issues });
    }

    const { merchantId, userId } = request.session;

    try {
      const supplier = await prisma.supplier.create({
        data: { merchantId, ...parsed.data },
      });

      await recordAudit({
        merchantId,
        actorType: 'USER',
        actorId: userId,
        action: 'supplier.created',
        targetType: 'Supplier',
        targetId: supplier.id,
        metadata: { name: supplier.name },
        ipAddress: request.ip,
      });

      return reply.send({ supplier });
    } catch (error) {
      // Collision sur (merchantId, contactEmail) : deux fiches pour la même
      // adresse rendraient les réponses du fournisseur inattribuables.
      if (
        typeof error === 'object' &&
        error !== null &&
        (error as { code?: string }).code === 'P2002'
      ) {
        return reply.code(409).send({
          error: 'Un contact utilise déjà cette adresse email.',
        });
      }
      throw error;
    }
  });

  app.patch<{ Params: { id: string } }>(
    '/api/suppliers/:id',
    { preHandler: requirePermission('configure') },
    async (request, reply) => {
    const parsed = supplierBody.partial().safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Requête invalide', details: parsed.error.issues });
    }

    const { merchantId, userId } = request.session;

    const existing = await prisma.supplier.findFirst({
      where: { id: request.params.id, merchantId },
      select: { id: true },
    });
    if (!existing) return reply.code(404).send({ error: 'Contact introuvable' });

    const supplier = await prisma.supplier.update({
      where: { id: existing.id },
      data: parsed.data,
    });

    await recordAudit({
      merchantId,
      actorType: 'USER',
      actorId: userId,
      action: 'supplier.updated',
      targetType: 'Supplier',
      targetId: supplier.id,
      metadata: parsed.data,
      ipAddress: request.ip,
    });

    return reply.send({ supplier });
  });

  /**
   * Suppression définitive, refusée dès qu'un échange existe.
   *
   * Supprimer un contact effacerait ses escalades en cascade, donc des
   * messages déjà envoyés et consignés. On désactive à la place — le
   * fournisseur ne reçoit plus rien mais l'historique reste lisible.
   */
  app.delete<{ Params: { id: string } }>(
    '/api/suppliers/:id',
    { preHandler: requirePermission('configure') },
    async (request, reply) => {
    const { merchantId, userId } = request.session;

    const supplier = await prisma.supplier.findFirst({
      where: { id: request.params.id, merchantId },
      include: { _count: { select: { escalations: true } } },
    });
    if (!supplier) return reply.code(404).send({ error: 'Contact introuvable' });

    if (supplier._count.escalations > 0) {
      return reply.code(409).send({
        error: `Ce contact a ${supplier._count.escalations} escalade(s) dans l'historique. Désactivez-le plutôt que de le supprimer.`,
      });
    }

    await prisma.supplier.delete({ where: { id: supplier.id } });

    await recordAudit({
      merchantId,
      actorType: 'USER',
      actorId: userId,
      action: 'supplier.deleted',
      targetType: 'Supplier',
      targetId: supplier.id,
      metadata: { name: supplier.name },
      ipAddress: request.ip,
    });

    return reply.send({ ok: true });
  });

  /**
   * Lien de travail permanent d'un fournisseur.
   *
   * Émis à la demande plutôt que stocké : le jeton se recalcule à partir du
   * numéro de version, donc rien de secret ne dort en base. « Révoquer »
   * incrémente ce numéro et invalide d'un coup tous les liens transmis.
   */
  app.post<{ Params: { id: string }; Body: { revoke?: boolean } }>(
    '/api/suppliers/:id/portal-link',
    { preHandler: requirePermission('configure') },
    async (request, reply) => {
      const { merchantId, userId } = request.session;

      const supplier = await prisma.supplier.findFirst({
        where: { id: request.params.id, merchantId },
        select: { id: true, name: true, portalTokenVersion: true },
      });
      if (!supplier) return reply.code(404).send({ error: 'Fournisseur introuvable' });

      const version = request.body?.revoke
        ? (
            await prisma.supplier.update({
              where: { id: supplier.id },
              data: { portalTokenVersion: { increment: 1 } },
              select: { portalTokenVersion: true },
            })
          ).portalTokenVersion
        : supplier.portalTokenVersion;

      const token = signSupplierWorkspaceToken({ merchantId, supplierId: supplier.id, version });

      await recordAudit({
        merchantId,
        actorType: 'USER',
        actorId: userId,
        action: request.body?.revoke ? 'supplier.link_revoked' : 'supplier.link_issued',
        targetType: 'Supplier',
        targetId: supplier.id,
        ipAddress: request.ip,
      });

      return reply.send({
        url: `${env.APP_URL}/fournisseur/${supplier.id}?token=${encodeURIComponent(token)}`,
        revoked: Boolean(request.body?.revoke),
      });
    },
  );

  /**
   * Toutes les demandes de changement du marchand — l'écran « Changements ».
   *
   * La boucle se fermait à moitié : le fournisseur répondait dans son atelier,
   * et le marchand ne l'apprenait qu'en rouvrant le mail concerné. Ici tout
   * est au même endroit, les demandes sans réponse d'abord, avec pour chacune
   * l'état d'expédition de la commande au moment où l'on regarde — une taille
   * à changer sur une commande déjà partie n'a plus la même urgence.
   */
  app.get('/api/changes', async (request, reply) => {
    const { merchantId } = request.session;

    const changes = await prisma.supplierAlert.findMany({
      where: { merchantId },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      take: 100,
      select: {
        id: true,
        kind: true,
        status: true,
        message: true,
        beforeValue: true,
        afterValue: true,
        orderName: true,
        shopifyOrderId: true,
        supplierNote: true,
        createdAt: true,
        acknowledgedAt: true,
        emailedAt: true,
        handledAt: true,
        supplier: { select: { id: true, name: true } },
        ticket: { select: { id: true, subject: true, customerName: true, customerEmail: true } },
      },
    });

    /*
     * Expédiée ou non : lu dans nos colis plutôt que demandé à Shopify.
     *
     * Cent demandes feraient cent appels API pour une information que la
     * saisie du fournisseur nous a déjà donnée — et qui déclenche désormais le
     * fulfillment, donc les deux sources se confondent.
     */
    const orderIds = [
      ...new Set(changes.map((change) => change.shopifyOrderId).filter(Boolean)),
    ] as string[];

    const shipped = new Set(
      (
        await prisma.parcel.findMany({
          where: { merchantId, shopifyOrderId: { in: orderIds } },
          select: { shopifyOrderId: true },
        })
      ).map((parcel) => parcel.shopifyOrderId),
    );

    return reply.send({
      pending: changes.filter((change) => change.status === 'PENDING').length,
      changes: changes.map((change) => ({
        ...change,
        orderShipped: change.shopifyOrderId ? shipped.has(change.shopifyOrderId) : null,
      })),
    });
  });

  /**
   * Ce que les fournisseurs ont renvoyé et qui attend le marchand.
   *
   * Symétrique du compteur « Update » : celui-ci compte ce que j'attends
   * d'eux, celui-là ce qu'ils m'ont rendu et que je n'ai pas traité. Trois
   * sources, un seul chiffre — l'agent n'a pas à savoir laquelle a bougé pour
   * savoir qu'il doit ouvrir l'écran.
   */
  app.get('/api/supplier-activity', async (request, reply) => {
    const { merchantId } = request.session;

    const [answered, issues, changes] = await Promise.all([
      // Escalades auxquelles le fournisseur a répondu, pas encore reprises.
      prisma.supplierEscalation.count({ where: { merchantId, status: 'ANSWERED' } }),
      /*
       * Signalements venus de l'atelier : téléphone incomplet, rupture,
       * article abîmé. Ils entrent dans la file comme des messages, avec une
       * adresse d'origine reconnaissable — c'est ce qui permet de les compter
       * ici sans les confondre avec du courrier client.
       */
      prisma.ticket.count({
        where: {
          merchantId,
          status: { in: ['NEW', 'NEEDS_REVIEW'] },
          customerEmail: { startsWith: 'fournisseur+' },
        },
      }),
      // Demandes auxquelles il a répondu — accord ou refus — et dont je n'ai
      // pas encore pris acte auprès du client.
      prisma.supplierAlert.count({
        where: { merchantId, status: { not: 'PENDING' }, handledAt: null },
      }),
    ]);

    return reply.send({
      total: answered + issues + changes,
      answered,
      issues,
      changes,
    });
  });

  /**
   * « J'ai traité » : le marchand a répondu au client, la demande sort du
   * compteur. Elle reste dans l'historique — c'est un accusé, pas un effacement.
   */
  app.post<{ Params: { id: string } }>(
    '/api/changes/:id/handled',
    { preHandler: requirePermission('reply') },
    async (request, reply) => {
      const { merchantId, userId } = request.session;

      const updated = await prisma.supplierAlert.updateMany({
        where: { id: request.params.id, merchantId, status: { not: 'PENDING' } },
        data: { handledAt: new Date() },
      });

      if (updated.count === 0) {
        return reply.code(404).send({ error: 'Demande introuvable, ou toujours en attente.' });
      }

      await recordAudit({
        merchantId,
        actorType: 'USER',
        actorId: userId,
        action: 'supplier.change_handled',
        targetType: 'SupplierAlert',
        targetId: request.params.id,
        ipAddress: request.ip,
      });

      return reply.send({ handled: true });
    },
  );

  /**
   * Annulation d'une demande de changement.
   *
   * Une demande envoyée sur la mauvaise commande restait plantée « en
   * attente » pour toujours : le fournisseur la voyait chaque matin, le
   * marchand ne pouvait pas la reprendre. Seules les demandes encore sans
   * réponse s'annulent — une demande traitée est un fait, pas un brouillon.
   */
  app.delete<{ Params: { id: string } }>(
    '/api/changes/:id',
    { preHandler: requirePermission('escalate') },
    async (request, reply) => {
      const { merchantId, userId } = request.session;

      const removed = await prisma.supplierAlert.deleteMany({
        where: { id: request.params.id, merchantId, status: 'PENDING' },
      });

      if (removed.count === 0) {
        return reply.code(409).send({
          error: 'Introuvable, ou le fournisseur a déjà répondu — une demande traitée ne s’annule plus.',
        });
      }

      await recordAudit({
        merchantId,
        actorType: 'USER',
        actorId: userId,
        action: 'supplier.change_cancelled',
        targetType: 'SupplierAlert',
        targetId: request.params.id,
        ipAddress: request.ip,
      });

      return reply.send({ cancelled: true });
    },
  );

  /**
   * Correction d'une demande encore en attente.
   *
   * Une faute de frappe dans la nouvelle taille, la mauvaise commande citée :
   * tant que le fournisseur n'a pas répondu, la demande se corrige sur place —
   * l'annuler pour la recréer enverrait un second mail et laisserait deux
   * cartes dans l'atelier. Après réponse, plus rien ne bouge : le fournisseur
   * a validé un contenu précis, le réécrire ferait mentir sa réponse.
   */
  app.patch<{ Params: { id: string } }>(
    '/api/changes/:id',
    { preHandler: requirePermission('escalate') },
    async (request, reply) => {
      const { merchantId, userId } = request.session;

      const parsed = z
        .object({
          kind: z.enum(['ADDRESS', 'PHONE', 'PRODUCT', 'SIZE', 'COLOR', 'HOLD', 'CANCEL', 'OTHER']).optional(),
          beforeValue: z.string().max(500).nullish(),
          afterValue: z.string().max(500).nullish(),
          message: z.string().max(4000).optional(),
          orderName: z.string().max(60).nullish(),
        })
        .safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: 'Champs invalides' });

      const updated = await prisma.supplierAlert.updateMany({
        where: { id: request.params.id, merchantId, status: 'PENDING' },
        data: parsed.data,
      });

      if (updated.count === 0) {
        return reply.code(409).send({
          error: 'Introuvable, ou le fournisseur a déjà répondu — une demande traitée ne se modifie plus.',
        });
      }

      await recordAudit({
        merchantId,
        actorType: 'USER',
        actorId: userId,
        action: 'supplier.change_edited',
        targetType: 'SupplierAlert',
        targetId: request.params.id,
        metadata: parsed.data,
        ipAddress: request.ip,
      });

      return reply.send({ updated: true });
    },
  );

  /**
   * Alerte urgente vers un fournisseur.
   *
   * L'atelier est le canal du quotidien : il l'ouvre le matin, il y trouve ses
   * commandes. Mais « cette adresse est fausse, n'expédie pas » ne peut pas
   * attendre demain matin — le colis sera parti. L'alerte part donc par mail,
   * qui arrive sur son téléphone, et s'affiche en tête de son atelier jusqu'à
   * ce qu'il l'ouvre.
   *
   * Elle est consignée en base et non seulement envoyée : un mail tombé dans
   * les indésirables ne laisse aucune trace, et personne ne pourrait dire si
   * le fournisseur a été prévenu — exactement la question qu'on se pose quand
   * le colis part quand même.
   */
  app.post<{ Params: { id: string } }>(
    '/api/suppliers/:id/alert',
    { preHandler: requirePermission('escalate') },
    async (request, reply) => {
      const parsed = z
        .object({
          kind: z.enum(['ADDRESS', 'PHONE', 'PRODUCT', 'SIZE', 'COLOR', 'HOLD', 'CANCEL', 'OTHER']),
          message: z.string().max(1000).default(''),
          shopifyOrderId: z.string().max(120).nullish(),
          orderName: z.string().max(60).nullish(),
          // Valeur actuelle et valeur demandée : « 44 → 45 » se lit d'un coup
          // d'œil là où la même chose noyée dans une phrase se relit trois fois.
          beforeValue: z.string().max(200).nullish(),
          afterValue: z.string().max(200).nullish(),
          /** Mail client à l'origine de la demande. */
          ticketId: z.string().max(60).nullish(),
        })
        // Une demande sans rien à changer ni rien à dire n'apprend rien au
        // fournisseur : on refuse plutôt que d'envoyer une alerte vide.
        .refine((value) => value.message.trim() !== '' || value.afterValue, {
          message: 'Précisez le changement demandé',
        })
        .safeParse(request.body);

      if (!parsed.success) return reply.code(400).send({ error: 'Alerte incomplète' });

      const { merchantId, userId } = request.session;

      const supplier = await prisma.supplier.findFirst({
        where: { id: request.params.id, merchantId, active: true },
        select: { id: true, name: true, contactEmail: true },
      });
      if (!supplier) return reply.code(404).send({ error: 'Fournisseur introuvable' });

      // Le ticket est vérifié plutôt que recopié tel quel : un identifiant
      // venu du client ne doit jamais rattacher une alerte au mail d'un autre
      // marchand.
      const ticketId = parsed.data.ticketId
        ? (
            await prisma.ticket.findFirst({
              where: { id: parsed.data.ticketId, merchantId },
              select: { id: true },
            })
          )?.id ?? null
        : null;

      const alert = await prisma.supplierAlert.create({
        data: {
          merchantId,
          supplierId: supplier.id,
          kind: parsed.data.kind,
          message: parsed.data.message.trim(),
          shopifyOrderId: parsed.data.shopifyOrderId ?? null,
          orderName: parsed.data.orderName ?? null,
          beforeValue: parsed.data.beforeValue ?? null,
          afterValue: parsed.data.afterValue ?? null,
          ticketId,
          createdById: userId,
        },
      });

      const titles = {
        ADDRESS: 'Adresse à corriger',
        PHONE: 'Téléphone à corriger',
        PRODUCT: 'Modèle à changer',
        SIZE: 'Taille à changer',
        COLOR: 'Couleur à changer',
        HOLD: 'Ne pas expédier',
        CANCEL: 'Commande annulée',
        OTHER: 'Message urgent',
      } as const;

      const subject = `URGENT — ${titles[parsed.data.kind]}${
        parsed.data.orderName ? ` · ${parsed.data.orderName}` : ''
      }`;

      /*
       * L'envoi ne bloque pas l'alerte.
       *
       * Si la boîte Gmail refuse, l'alerte existe quand même et s'affichera
       * dans l'atelier : perdre le mail est ennuyeux, perdre l'alerte
       * laisserait partir le colis.
       */
      let emailed = false;
      try {
        await sendPlainEmail({
          merchantId,
          to: supplier.contactEmail,
          subject,
          body: [
            // Le changement en premier, avant toute phrase : c'est ce qu'on
            // lit sur l'écran verrouillé d'un téléphone.
            parsed.data.afterValue
              ? `${parsed.data.beforeValue ?? '?'} → ${parsed.data.afterValue}`
              : null,
            parsed.data.orderName ? `Commande : ${parsed.data.orderName}` : null,
            parsed.data.message.trim() || null,
            '',
            'Ouvrez votre espace de travail, onglet « Update », pour confirmer ' +
              'que vous en tenez compte.',
          ]
            .filter((line) => line !== null)
            .join('\n'),
        });
        emailed = true;
        await prisma.supplierAlert.update({
          where: { id: alert.id },
          data: { emailedAt: new Date() },
        });
      } catch (error) {
        request.log.error({ err: error, supplierId: supplier.id }, 'Alerte fournisseur non envoyée');
      }

      await recordAudit({
        merchantId,
        actorType: 'USER',
        actorId: userId,
        action: 'supplier.alerted',
        targetType: 'Supplier',
        targetId: supplier.id,
        metadata: { kind: parsed.data.kind, orderName: parsed.data.orderName, emailed },
        ipAddress: request.ip,
      });

      return reply.send({ alert, emailed });
    },
  );

  app.get<{ Params: { id: string } }>('/api/tickets/:id/escalations', async (request, reply) => {
    const { merchantId } = request.session;

    const ticket = await prisma.ticket.findFirst({
      where: { id: request.params.id, merchantId },
      select: { id: true },
    });
    if (!ticket) return reply.code(404).send({ error: 'Ticket introuvable' });

    const escalations = await prisma.supplierEscalation.findMany({
      where: { ticketId: ticket.id, merchantId },
      orderBy: { createdAt: 'desc' },
      include: {
        supplier: { select: { name: true, contactEmail: true } },
        messages: { orderBy: { createdAt: 'asc' } },
      },
    });

    return reply.send({ escalations });
  });

  app.post<{ Params: { id: string } }>(
    '/api/tickets/:id/escalations',
    { preHandler: requirePermission('escalate') },
    async (request, reply) => {
    const parsed = escalationBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Requête invalide', details: parsed.error.issues });
    }

    const { merchantId, userId } = request.session;

    try {
      const { escalation } = await createEscalation({
        merchantId,
        ticketId: request.params.id,
        reason: parsed.data.reason,
        note: parsed.data.note,
        supplierId: parsed.data.supplierId ?? null,
        userId,
      });
      return reply.send({ escalation });
    } catch (error) {
      if (error instanceof Error && error.name === 'SupplierNotConfiguredError') {
        return reply.code(409).send({
          error: 'Configurez un fournisseur avant de pouvoir escalader un ticket.',
        });
      }
      throw error;
    }
  });

  // Édition du brouillon avant envoi — même geste que pour un brouillon client.
  app.patch<{ Params: { id: string }; Body: { body?: string } }>(
    '/api/escalations/:id',
    async (request, reply) => {
      const { merchantId } = request.session;
      const body = z.string().min(1).safeParse(request.body?.body);
      if (!body.success) return reply.code(400).send({ error: 'Corps du message requis' });

      const escalation = await prisma.supplierEscalation.findFirst({
        where: { id: request.params.id, merchantId },
        include: { messages: { orderBy: { createdAt: 'desc' }, take: 1 } },
      });
      if (!escalation) return reply.code(404).send({ error: 'Escalade introuvable' });
      if (escalation.status !== 'DRAFTING') {
        return reply.code(409).send({ error: 'Cette escalade a déjà été envoyée' });
      }

      const lastMessage = escalation.messages[0];
      if (!lastMessage) return reply.code(500).send({ error: 'Message introuvable' });

      const updated = await prisma.supplierMessage.update({
        where: { id: lastMessage.id },
        data: { body: body.data, authorType: 'HUMAN' },
      });

      return reply.send({ message: updated });
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/escalations/:id/send',
    { preHandler: requirePermission('escalate') },
    async (request, reply) => {
    const { merchantId, userId } = request.session;

    const escalation = await prisma.supplierEscalation.findFirst({
      where: { id: request.params.id, merchantId },
      select: { id: true, status: true },
    });
    if (!escalation) return reply.code(404).send({ error: 'Escalade introuvable' });
    if (escalation.status !== 'DRAFTING') {
      return reply.code(409).send({ error: 'Escalade déjà envoyée' });
    }

    await sendEscalation({ merchantId, escalationId: escalation.id, userId });
    return reply.send({ ok: true });
  });

  app.post<{ Params: { id: string } }>(
    '/api/escalations/:id/resolve',
    { preHandler: requirePermission('escalate') },
    async (request, reply) => {
    const { merchantId, userId } = request.session;

    const escalation = await prisma.supplierEscalation.findFirst({
      where: { id: request.params.id, merchantId },
      select: { id: true },
    });
    if (!escalation) return reply.code(404).send({ error: 'Escalade introuvable' });

    await resolveEscalation({ merchantId, escalationId: escalation.id, userId });
    return reply.send({ ok: true });
  });
}
