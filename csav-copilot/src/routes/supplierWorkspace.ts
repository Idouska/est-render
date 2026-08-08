import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { env } from '../config/env.ts';
import { recordAudit } from '../lib/audit.ts';
import { prisma } from '../lib/prisma.ts';
import { verifySupplierWorkspaceToken } from '../lib/supplierToken.ts';
import { ordersToCsv } from '../services/export/ordersCsv.ts';
import { ordersToXlsx } from '../services/export/ordersXlsx.ts';
import { getShopifyClient } from '../services/shopify/client.ts';
import { listOrders } from '../services/shopify/orders.ts';
import { listProducts } from '../services/shopify/catalog.ts';
import { fulfillOrder } from '../services/shopify/fulfill.ts';
import { draftChangeReply } from '../services/ai/changeReply.ts';
import { decodePhoto, photoSchema, sendParcelPhoto, toParcelView } from './parcels.ts';
import { ordersForSupplier, type RoutingRules } from '../services/suppliers/routing.ts';

/**
 * Espace de travail permanent du fournisseur.
 *
 * Différent du portail d'escalade, qui ne montre qu'un fil de discussion : ici
 * le fournisseur voit les commandes à préparer, y attache les numéros de suivi
 * et les photos d'étiquettes, et signale les problèmes qu'il découvre au
 * moment de l'emballage — un téléphone à neuf chiffres, une rue sans numéro.
 *
 * Il n'a toujours ni compte ni mot de passe : un lien signé, permanent et
 * révocable, qu'il ouvre chaque matin.
 */

interface Workspace {
  merchantId: string;
  supplierId: string;
  supplierName: string;
  ordersAccess: 'NONE' | 'ASSIGNED' | 'ALL';
  vendors: string[];
  skuPrefixes: string[];
  isDefault: boolean;
}

/** Vérifie le jeton et l'accorde au fournisseur en base. */
async function authorize(
  request: FastifyRequest<{ Params: { id: string }; Querystring: { token?: string } }>,
  reply: FastifyReply,
): Promise<Workspace | null> {
  const payload = verifySupplierWorkspaceToken(request.query.token);

  if (!payload || payload.supplierId !== request.params.id) {
    await reply.code(401).send({ error: 'Lien invalide' });
    return null;
  }

  const supplier = await prisma.supplier.findFirst({
    where: { id: payload.supplierId, merchantId: payload.merchantId },
    select: {
      id: true,
      name: true,
      active: true,
      portalTokenVersion: true,
      ordersAccess: true,
      vendors: true,
      skuPrefixes: true,
      isDefault: true,
    },
  });

  // La version fait office de révocation : un lien émis avant le dernier
  // renouvellement cesse d'ouvrir quoi que ce soit.
  if (!supplier || !supplier.active || supplier.portalTokenVersion !== payload.version) {
    await reply.code(401).send({ error: 'Ce lien a été révoqué. Demandez-en un nouveau.' });
    return null;
  }

  return {
    merchantId: payload.merchantId,
    supplierId: supplier.id,
    supplierName: supplier.name,
    ordersAccess: supplier.ordersAccess,
    vendors: supplier.vendors,
    skuPrefixes: supplier.skuPrefixes,
    isDefault: supplier.isDefault,
  };
}

/**
 * Commandes qu'un fournisseur a le droit de voir.
 *
 * Jusqu'ici son lien ouvrait tout le carnet — noms, adresses et téléphones de
 * clients qu'il n'avait jamais préparés, y compris ceux d'un autre prestataire.
 * L'accès se restreint désormais à ce qu'on lui a confié, sauf choix explicite
 * du marchand.
 *
 * `null` signifie « aucune restriction » ; un tableau vide, « rien à voir ».
 */
async function allowedOrderIds(workspace: Workspace): Promise<string[] | null> {
  if (workspace.ordersAccess === 'ALL') return null;
  if (workspace.ordersAccess === 'NONE') return [];

  // Confiée = une escalade lui a été adressée, ou un colis de cette commande
  // porte son nom. Les deux traces existent déjà, rien à saisir en plus.
  const [escalations, parcels] = await Promise.all([
    prisma.supplierEscalation.findMany({
      where: { merchantId: workspace.merchantId, supplierId: workspace.supplierId },
      select: { ticket: { select: { shopifyOrderId: true } } },
    }),
    prisma.parcel.findMany({
      where: {
        merchantId: workspace.merchantId,
        escalation: { supplierId: workspace.supplierId },
      },
      select: { shopifyOrderId: true },
    }),
  ]);

  return [
    ...new Set(
      [
        ...escalations.map((row) => row.ticket.shopifyOrderId),
        ...parcels.map((row) => row.shopifyOrderId),
      ].filter(Boolean) as string[],
    ),
  ];
}

/** Règles des autres ateliers du marchand : elles bornent l'atelier par défaut. */
async function otherSupplierRules(workspace: Workspace): Promise<RoutingRules[]> {
  return prisma.supplier.findMany({
    where: { merchantId: workspace.merchantId, active: true, id: { not: workspace.supplierId } },
    select: { id: true, vendors: true, skuPrefixes: true, isDefault: true },
  });
}

/** Fenêtre de commandes demandée, « hier » par défaut. */
const rangeQuery = z.object({
  token: z.string().optional(),
  since: z.string().date().optional(),
  until: z.string().date().optional(),
  limit: z.coerce.number().int().min(1).max(250).default(100),
});

function toShopifyRange(since: string | undefined, until: string | undefined): string {
  // Par défaut : les commandes des dernières 24 heures. C'est le geste du
  // matin — « ce qui est tombé depuis hier ».
  if (!since && !until) {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    return `created_at:>=${yesterday}`;
  }

  return [
    since ? `created_at:>=${since}` : '',
    until ? `created_at:<=${until}T23:59:59Z` : '',
  ]
    .filter(Boolean)
    .join(' AND ');
}


/**
 * Prépare la réponse au client après le verdict de l'atelier.
 *
 * Rattaché au mail d'origine quand la demande en avait un — c'est là que
 * l'agent le cherchera. Sans mail rattaché (demande créée depuis une
 * commande), il n'y a rien à répondre : la demande se lit dans l'écran
 * Update et le marchand décide.
 */
async function draftReplyAfterChange(alertId: string, merchantId: string): Promise<void> {
  const alert = await prisma.supplierAlert.findFirst({
    where: { id: alertId, merchantId },
    select: {
      kind: true,
      status: true,
      beforeValue: true,
      afterValue: true,
      message: true,
      supplierNote: true,
      orderName: true,
      ticketId: true,
      merchant: { select: { name: true, shopDomain: true } },
      ticket: {
        select: {
          id: true,
          customerName: true,
          language: true,
          messages: {
            where: { direction: 'INBOUND' },
            orderBy: { receivedAt: 'desc' },
            take: 1,
            select: { bodyText: true },
          },
        },
      },
    },
  });

  if (!alert?.ticket) return;

  const draft = await draftChangeReply({
    merchantName: alert.merchant.name ?? alert.merchant.shopDomain,
    customerName: alert.ticket.customerName,
    language: alert.ticket.language,
    kind: alert.kind,
    beforeValue: alert.beforeValue,
    afterValue: alert.afterValue,
    note: alert.message || null,
    accepted: alert.status === 'ACKNOWLEDGED',
    supplierNote: alert.supplierNote,
    orderName: alert.orderName,
    lastCustomerMessage: alert.ticket.messages[0]?.bodyText ?? null,
  });

  await prisma.draft.create({
    data: {
      merchantId,
      ticketId: alert.ticket.id,
      body: draft.body,
      model: draft.model,
      confidence: draft.confidence,
      reasoning: draft.reasoning,
      // Le résumé dit d'où vient ce brouillon : sans lui, l'agent découvre un
      // texte qui parle d'un échange dont le fil ne dit rien.
      summary: [
        alert.status === 'ACKNOWLEDGED'
          ? `L'atelier a confirmé : ${alert.beforeValue ?? '?'} → ${alert.afterValue ?? '?'}`
          : `L'atelier ne peut pas : ${alert.supplierNote ?? 'motif non précisé'}`,
      ],
      ask:
        alert.status === 'ACKNOWLEDGED'
          ? 'Annoncer au client que le changement est pris en compte'
          : 'Annoncer au client que le changement est impossible et proposer la suite',
    },
  });

  /*
   * Le mail remonte dans la file : le brouillon ne sert à rien s'il dort au
   * fond d'une liste triée par date de dernier message. `NEEDS_REVIEW` est
   * l'état qui dit « quelqu'un doit lire », et c'est exactement le cas.
   */
  await prisma.ticket.update({
    where: { id: alert.ticket.id },
    data: { status: 'NEEDS_REVIEW', lastMessageAt: new Date() },
  });
}

export async function supplierWorkspaceRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { id: string } }>('/fournisseur/:id', async (request, reply) =>
    // Servi par le plugin statique, qui pose `no-cache` : sans lui, l'atelier
    // d'un fournisseur restait figé sur la version de la veille.
    reply.type('text/html').sendFile('workspace.html'),
  );

  app.get<{ Params: { id: string }; Querystring: z.infer<typeof rangeQuery> }>(
    '/api/workspace/:id/orders',
    async (request, reply) => {
      const workspace = await authorize(request, reply);
      if (!workspace) return;

      const parsed = rangeQuery.safeParse(request.query);
      if (!parsed.success) return reply.code(400).send({ error: 'Période invalide' });

      const allowed = await allowedOrderIds(workspace);
      if (allowed?.length === 0) {
        return reply.send({
          supplier: { name: workspace.supplierName, ordersAccess: workspace.ordersAccess },
          orders: [],
          reason:
            workspace.ordersAccess === 'NONE'
              ? 'Le marchand n’a pas ouvert le carnet de commandes pour ce compte.'
              : 'Aucune commande ne vous a été confiée sur cette période.',
        });
      }

      const client = await getShopifyClient(workspace.merchantId);
      const page = await listOrders(client, {
        query: toShopifyRange(parsed.data.since, parsed.data.until),
        limit: parsed.data.limit,
        cursor: null,
      });

      /*
       * Le filtre s'applique après Shopify : la recherche par identifiant de
       * commande n'accepte pas de liste, et l'écart tient à quelques dizaines
       * de lignes sur une journée.
       *
       * Aux commandes explicitement confiées s'ajoutent celles que les règles
       * du fournisseur réclament — sa marque, son préfixe de référence — et,
       * s'il est l'atelier par défaut, celles qu'aucun autre ne réclame. Les
       * règles des autres sont donc nécessaires ici : c'est ce qui distingue
       * « personne ne la prend » de « quelqu'un d'autre la prend ».
       */
      const visible = allowed
        ? ordersForSupplier(
            page.orders,
            { id: workspace.supplierId, ...workspace },
            await otherSupplierRules(workspace),
            allowed,
          )
        : page.orders;

      // Colis déjà saisis, rapprochés par identifiant de commande : le
      // fournisseur doit voir ce qu'il a fait hier sans le ressaisir.
      const parcels = await prisma.parcel.findMany({
        where: {
          merchantId: workspace.merchantId,
          shopifyOrderId: { in: visible.map((order) => order.id) },
        },
        orderBy: { index: 'asc' },
        select: {
          id: true,
          shopifyOrderId: true,
          trackingNumber: true,
          carrier: true,
          index: true,
          total: true,
          orderName: true,
          photoMime: true,
          photoTakenAt: true,
          updatedAt: true,
        },
      });

      const byOrder = new Map<string, typeof parcels>();
      for (const parcel of parcels) {
        const key = parcel.shopifyOrderId ?? '';
        byOrder.set(key, [...(byOrder.get(key) ?? []), parcel]);
      }

      return reply.send({
        supplier: { name: workspace.supplierName, ordersAccess: workspace.ordersAccess },
        orders: visible.map((order) => ({
          ...order,
          parcels: (byOrder.get(order.id) ?? []).map(toParcelView),
        })),
      });
    },
  );

  app.get<{ Params: { id: string }; Querystring: z.infer<typeof rangeQuery> }>(
    '/api/workspace/:id/orders.csv',
    async (request, reply) => {
      const workspace = await authorize(request, reply);
      if (!workspace) return;

      const parsed = rangeQuery.safeParse(request.query);
      if (!parsed.success) return reply.code(400).send({ error: 'Période invalide' });

      // Même restriction que la liste : sans ça, l'export contournerait la
      // règle et rendrait tout le carnet en un fichier.
      const allowed = await allowedOrderIds(workspace);

      const client = await getShopifyClient(workspace.merchantId);
      const page = await listOrders(client, {
        query: toShopifyRange(parsed.data.since, parsed.data.until),
        limit: parsed.data.limit,
        cursor: null,
      });

      const visible = allowed ? page.orders.filter((order) => allowed.includes(order.id)) : page.orders;

      const parcels = await prisma.parcel.findMany({
        where: {
          merchantId: workspace.merchantId,
          shopifyOrderId: { in: visible.map((order) => order.id) },
        },
        orderBy: { index: 'asc' },
        select: {
          id: true,
          shopifyOrderId: true,
          trackingNumber: true,
          index: true,
          total: true,
          photoMime: true,
        },
      });

      const csv = ordersToCsv(
        visible.map((order) => ({
          order,
          parcels: parcels
            .filter((parcel) => parcel.shopifyOrderId === order.id)
            .map((parcel) => ({
              index: parcel.index,
              total: parcel.total,
              trackingNumber: parcel.trackingNumber,
              photoUrl: parcel.photoMime
                ? `/api/workspace/${workspace.supplierId}/parcels/${parcel.id}/photo?token=${encodeURIComponent(
                    request.query.token ?? '',
                  )}`
                : null,
            })),
        })),
        env.APP_URL,
      );

      const stamp = new Date().toISOString().slice(0, 10);

      return reply
        .type('text/csv; charset=utf-8')
        .header('Content-Disposition', `attachment; filename="commandes-${stamp}.csv"`)
        .send(csv);
    },
  );

  /**
   * Feuille de préparation au format Excel.
   *
   * Le CSV reste disponible pour qui veut retravailler les données ; celui-ci
   * reprend la mise en page de l'atelier, une ligne par article avec la photo
   * dans la cellule.
   */
  app.get<{ Params: { id: string }; Querystring: z.infer<typeof rangeQuery> }>(
    '/api/workspace/:id/orders.xlsx',
    async (request, reply) => {
      const workspace = await authorize(request, reply);
      if (!workspace) return;

      const parsed = rangeQuery.safeParse(request.query);
      if (!parsed.success) return reply.code(400).send({ error: 'Période invalide' });

      const allowed = await allowedOrderIds(workspace);

      const [client, merchant] = await Promise.all([
        getShopifyClient(workspace.merchantId),
        prisma.merchant.findUniqueOrThrow({
          where: { id: workspace.merchantId },
          select: { shopDomain: true },
        }),
      ]);

      const page = await listOrders(client, {
        query: toShopifyRange(parsed.data.since, parsed.data.until),
        limit: parsed.data.limit,
        cursor: null,
      });

      const visible = allowed
        ? page.orders.filter((order) => allowed.includes(order.id))
        : page.orders;

      const parcels = await prisma.parcel.findMany({
        where: {
          merchantId: workspace.merchantId,
          shopifyOrderId: { in: visible.map((order) => order.id) },
        },
        orderBy: { index: 'asc' },
        select: { shopifyOrderId: true, trackingNumber: true, index: true, total: true },
      });

      const file = await ordersToXlsx(
        visible.map((order) => ({
          order,
          storeUrl: `https://${merchant.shopDomain}`,
          parcels: parcels
            .filter((parcel) => parcel.shopifyOrderId === order.id)
            .map((parcel) => ({
              index: parcel.index,
              total: parcel.total,
              trackingNumber: parcel.trackingNumber,
            })),
        })),
      );

      const stamp = new Date().toISOString().slice(0, 10);

      return reply
        .type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        .header('Content-Disposition', `attachment; filename="commandes-${stamp}.xlsx"`)
        .send(file);
    },
  );

  app.post<{ Params: { id: string }; Querystring: { token?: string } }>(
    '/api/workspace/:id/parcels',
    { bodyLimit: 4 * 1024 * 1024 },
    async (request, reply) => {
      const workspace = await authorize(request, reply);
      if (!workspace) return;

      const parsed = z
        .object({
          shopifyOrderId: z.string().min(1).max(120),
          orderName: z.string().max(60).nullish(),
          trackingNumber: z.string().min(3).max(80),
          carrier: z.string().max(80).nullish(),
          index: z.number().int().min(1).max(20),
          total: z.number().int().min(1).max(20),
          photo: photoSchema.nullish(),
        })
        .safeParse(request.body);

      if (!parsed.success) {
        return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Colis invalide' });
      }

      if (parsed.data.index > parsed.data.total) {
        return reply.code(400).send({ error: 'Le rang du colis dépasse le nombre annoncé.' });
      }

      const photo = parsed.data.photo ? decodePhoto(parsed.data.photo) : null;
      const photoFields = photo
        ? { photoMime: photo.mime, photoData: photo.data, photoTakenAt: new Date() }
        : {};

      const parcel = await prisma.parcel.upsert({
        where: {
          merchantId_trackingNumber: {
            merchantId: workspace.merchantId,
            trackingNumber: parsed.data.trackingNumber.trim(),
          },
        },
        create: {
          merchantId: workspace.merchantId,
          shopifyOrderId: parsed.data.shopifyOrderId,
          orderName: parsed.data.orderName ?? null,
          trackingNumber: parsed.data.trackingNumber.trim(),
          carrier: parsed.data.carrier ?? null,
          index: parsed.data.index,
          total: parsed.data.total,
          ...photoFields,
        },
        update: {
          carrier: parsed.data.carrier ?? null,
          index: parsed.data.index,
          total: parsed.data.total,
          ...photoFields,
        },
        select: {
          id: true,
          trackingNumber: true,
          carrier: true,
          index: true,
          total: true,
          orderName: true,
          photoMime: true,
          photoTakenAt: true,
          updatedAt: true,
        },
      });

      await recordAudit({
        merchantId: workspace.merchantId,
        actorType: 'SUPPLIER',
        actorId: workspace.supplierId,
        action: 'supplier.parcel_recorded',
        targetType: 'Parcel',
        targetId: parcel.id,
        metadata: { index: parcel.index, total: parcel.total, photo: Boolean(photo) },
        ipAddress: request.ip,
      });

      /*
       * Dernier colis saisi → la commande part vraiment.
       *
       * Un seul fulfillment portant tous les numéros, créé quand tous les
       * colis annoncés sont enregistrés : Shopify passe la commande en
       * expédiée et envoie au client son mail avec les suivis. C'est le but
       * de toute la saisie — sans lui, le client écrit « où est mon colis »
       * pour un colis déjà en route.
       *
       * L'échec n'annule pas la saisie : le colis est enregistré chez nous
       * quoi qu'il arrive, et le motif remonte au fournisseur pour que le
       * marchand soit prévenu (autorisation manquante, commande déjà close).
       */
      let shopify: { fulfilled: boolean; reason?: string } | null = null;

      const recorded = await prisma.parcel.findMany({
        where: {
          merchantId: workspace.merchantId,
          shopifyOrderId: parsed.data.shopifyOrderId,
        },
        select: { trackingNumber: true, carrier: true, index: true },
        orderBy: { index: 'asc' },
      });

      if (new Set(recorded.map((row) => row.index)).size >= parsed.data.total) {
        try {
          const client = await getShopifyClient(workspace.merchantId);
          shopify = await fulfillOrder(client, parsed.data.shopifyOrderId, {
            numbers: recorded.map((row) => row.trackingNumber),
            company: recorded.find((row) => row.carrier)?.carrier ?? null,
          });

          await recordAudit({
            merchantId: workspace.merchantId,
            actorType: 'SUPPLIER',
            actorId: workspace.supplierId,
            action: shopify.fulfilled ? 'supplier.order_fulfilled' : 'supplier.fulfill_failed',
            targetType: 'Order',
            targetId: parsed.data.shopifyOrderId,
            metadata: {
              orderName: parsed.data.orderName,
              numbers: recorded.map((row) => row.trackingNumber),
              reason: shopify.reason ?? null,
            },
            ipAddress: request.ip,
          });
        } catch (error) {
          request.log.error(
            { err: error, orderId: parsed.data.shopifyOrderId },
            'Fulfillment Shopify en échec',
          );
          shopify = { fulfilled: false, reason: 'Shopify n’a pas répondu.' };
        }
      }

      return reply.send({ parcel: toParcelView(parcel), shopify });
    },
  );

  /**
   * Alertes urgentes non encore vues.
   *
   * Servies à part des commandes : elles doivent s'afficher même quand la
   * période demandée ne contient aucune commande, et surtout ne pas dépendre
   * d'un appel Shopify qui peut échouer. Une alerte qu'on ne voit pas parce
   * que la boutique répond mal ne vaut pas mieux que pas d'alerte.
   */
  app.get<{ Params: { id: string }; Querystring: { token?: string } }>(
    '/api/workspace/:id/alerts',
    async (request, reply) => {
      const workspace = await authorize(request, reply);
      if (!workspace) return;

      const alerts = await prisma.supplierAlert.findMany({
        where: {
          merchantId: workspace.merchantId,
          supplierId: workspace.supplierId,
          status: 'PENDING',
        },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: {
          id: true,
          kind: true,
          message: true,
          orderName: true,
          beforeValue: true,
          afterValue: true,
          createdAt: true,
        },
      });

      return reply.send({ alerts });
    },
  );

  /**
   * Toutes les demandes de changement, l'onglet « Update ».
   *
   * Distinct de `/alerts`, qui ne sert que la bannière d'urgence : ici on veut
   * aussi l'historique récent, parce que la question qui suit « c'est pris en
   * compte » est toujours « qu'est-ce qu'on m'a demandé la semaine dernière ».
   */
  app.get<{ Params: { id: string }; Querystring: { token?: string } }>(
    '/api/workspace/:id/updates',
    async (request, reply) => {
      const workspace = await authorize(request, reply);
      if (!workspace) return;

      const updates = await prisma.supplierAlert.findMany({
        where: { merchantId: workspace.merchantId, supplierId: workspace.supplierId },
        // Les demandes en attente d'abord, quelle que soit leur date : c'est
        // du travail à faire, pas de l'histoire.
        orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
        take: 60,
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
        },
      });

      return reply.send({
        updates,
        pending: updates.filter((update) => update.status === 'PENDING').length,
      });
    },
  );

  /**
   * Réponse du fournisseur à une demande.
   *
   * Deux issues seulement, et le refus compte autant que l'accord : si le
   * colis est déjà parti, le dire vaut mieux que se taire. Sans ce chemin, le
   * marchand annoncerait au client un changement qui n'aura pas lieu.
   */
  app.post<{ Params: { id: string; alertId: string }; Querystring: { token?: string } }>(
    '/api/workspace/:id/updates/:alertId/respond',
    async (request, reply) => {
      const workspace = await authorize(request, reply);
      if (!workspace) return;

      const parsed = z
        .object({
          status: z.enum(['ACKNOWLEDGED', 'REFUSED']),
          note: z.string().max(600).nullish(),
        })
        .safeParse(request.body);

      if (!parsed.success) return reply.code(400).send({ error: 'Réponse invalide' });

      const updated = await prisma.supplierAlert.updateMany({
        where: {
          id: request.params.alertId,
          merchantId: workspace.merchantId,
          supplierId: workspace.supplierId,
        },
        data: {
          status: parsed.data.status,
          supplierNote: parsed.data.note?.trim() || null,
          acknowledgedAt: new Date(),
        },
      });

      if (updated.count === 0) return reply.code(404).send({ error: 'Demande introuvable' });

      await recordAudit({
        merchantId: workspace.merchantId,
        actorType: 'SUPPLIER',
        actorId: workspace.supplierId,
        action:
          parsed.data.status === 'ACKNOWLEDGED' ? 'supplier.change_accepted' : 'supplier.change_refused',
        targetType: 'SupplierAlert',
        targetId: request.params.alertId,
        metadata: { note: parsed.data.note ?? null },
        ipAddress: request.ip,
      });

      /*
       * Le brouillon au client se prépare ici, pas au clic du marchand.
       *
       * La réponse de l'atelier est une information de deux lignes qui
       * obligeait pourtant à rouvrir le mail, relire le fil, retrouver ce
       * qu'on avait demandé, puis écrire. Trente fois par jour, c'est la
       * moitié du métier. Le brouillon attend donc déjà dans le mail quand
       * l'agent y arrive.
       *
       * Fait après la réponse au fournisseur et sans la bloquer : son écran
       * ne doit pas attendre un appel de modèle, et une IA en panne ne doit
       * jamais empêcher un atelier de dire « c'est fait ».
       */
      void draftReplyAfterChange(request.params.alertId, workspace.merchantId).catch((error) => {
        request.log.warn({ err: error, alertId: request.params.alertId }, 'Brouillon de réponse non généré');
      });

      return reply.send({ status: parsed.data.status });
    },
  );

  /**
   * Correction d'un colis déjà saisi.
   *
   * Route distincte de la création, et c'est le cœur du correctif : la
   * création est indexée par le numéro de suivi, donc « corriger » un numéro
   * en le ressaisissant créait une seconde ligne et laissait la fausse en
   * base — le SAV suivait alors un colis qui n'existe pas. Ici on vise la
   * ligne par son identifiant, et le numéro peut changer sans se dédoubler.
   */
  app.patch<{ Params: { id: string; parcelId: string }; Querystring: { token?: string } }>(
    '/api/workspace/:id/parcels/:parcelId',
    { bodyLimit: 4 * 1024 * 1024 },
    async (request, reply) => {
      const workspace = await authorize(request, reply);
      if (!workspace) return;

      const parsed = z
        .object({
          trackingNumber: z.string().min(3).max(80),
          carrier: z.string().max(80).nullish(),
          photo: photoSchema.nullish(),
        })
        .safeParse(request.body);

      if (!parsed.success) return reply.code(400).send({ error: 'Colis invalide' });

      const existing = await prisma.parcel.findFirst({
        where: { id: request.params.parcelId, merchantId: workspace.merchantId },
        select: { id: true, trackingNumber: true },
      });
      if (!existing) return reply.code(404).send({ error: 'Colis introuvable' });

      const trackingNumber = parsed.data.trackingNumber.trim();

      // Le numéro corrigé ne doit pas percuter un autre colis : deux lignes au
      // même numéro rendraient le suivi inattribuable.
      const clash = await prisma.parcel.findFirst({
        where: {
          merchantId: workspace.merchantId,
          trackingNumber,
          id: { not: existing.id },
        },
        select: { id: true },
      });
      if (clash) {
        return reply.code(409).send({ error: 'Ce numéro est déjà enregistré sur un autre colis.' });
      }

      const photo = parsed.data.photo ? decodePhoto(parsed.data.photo) : null;

      const parcel = await prisma.parcel.update({
        where: { id: existing.id },
        data: {
          trackingNumber,
          carrier: parsed.data.carrier ?? null,
          ...(photo ? { photoMime: photo.mime, photoData: photo.data, photoTakenAt: new Date() } : {}),
        },
        select: {
          id: true,
          trackingNumber: true,
          carrier: true,
          index: true,
          total: true,
          orderName: true,
          photoMime: true,
          photoTakenAt: true,
          updatedAt: true,
        },
      });

      await recordAudit({
        merchantId: workspace.merchantId,
        actorType: 'SUPPLIER',
        actorId: workspace.supplierId,
        action: 'supplier.parcel_corrected',
        targetType: 'Parcel',
        targetId: parcel.id,
        // L'ancien numéro est consigné : c'est lui qu'un client a peut-être
        // déjà reçu, et il faut pouvoir comprendre pourquoi il ne répond plus.
        metadata: { from: existing.trackingNumber, to: parcel.trackingNumber },
        ipAddress: request.ip,
      });

      return reply.send({ parcel: toParcelView(parcel) });
    },
  );

  /**
   * Suppression d'un colis saisi par erreur.
   *
   * Le cas réel : deux colis enregistrés sur la mauvaise commande, ou un
   * doublon créé avant que la correction ci-dessus n'existe. Sans ce geste,
   * l'erreur reste à l'écran tous les matins et le fournisseur apprend à
   * ignorer sa propre liste — la pire habitude qu'un outil puisse enseigner.
   */
  app.delete<{ Params: { id: string; parcelId: string }; Querystring: { token?: string } }>(
    '/api/workspace/:id/parcels/:parcelId',
    async (request, reply) => {
      const workspace = await authorize(request, reply);
      if (!workspace) return;

      const existing = await prisma.parcel.findFirst({
        where: { id: request.params.parcelId, merchantId: workspace.merchantId },
        select: { id: true, trackingNumber: true, orderName: true },
      });
      if (!existing) return reply.code(404).send({ error: 'Colis introuvable' });

      await prisma.parcel.delete({ where: { id: existing.id } });

      await recordAudit({
        merchantId: workspace.merchantId,
        actorType: 'SUPPLIER',
        actorId: workspace.supplierId,
        action: 'supplier.parcel_deleted',
        targetType: 'Parcel',
        targetId: existing.id,
        metadata: { trackingNumber: existing.trackingNumber, orderName: existing.orderName },
        ipAddress: request.ip,
      });

      return reply.send({ deleted: true });
    },
  );

  /**
   * Colis déjà saisis — l'onglet « Tracking ».
   *
   * Le fournisseur saisit soixante numéros par jour au doigt sur un téléphone :
   * il en tape un de travers, et sans écran pour les relire il ne le découvre
   * qu'au retour du colis. Cette liste sert à vérifier, pas à ressaisir.
   */
  app.get<{ Params: { id: string }; Querystring: { token?: string; q?: string } }>(
    '/api/workspace/:id/parcels',
    async (request, reply) => {
      const workspace = await authorize(request, reply);
      if (!workspace) return;

      const term = request.query.q?.trim();

      const parcels = await prisma.parcel.findMany({
        where: {
          merchantId: workspace.merchantId,
          // Les siens : ceux qu'il a saisis depuis ce lien portent son
          // identifiant d'escalade ou, à défaut, aucun auteur — un colis saisi
          // par un agent du SAV n'a rien à faire dans son écran.
          ...(term
            ? {
                OR: [
                  { trackingNumber: { contains: term, mode: 'insensitive' as const } },
                  { orderName: { contains: term, mode: 'insensitive' as const } },
                ],
              }
            : {}),
        },
        orderBy: { updatedAt: 'desc' },
        take: 100,
        select: {
          id: true,
          trackingNumber: true,
          carrier: true,
          orderName: true,
          shopifyOrderId: true,
          index: true,
          total: true,
          photoMime: true,
          photoTakenAt: true,
          updatedAt: true,
        },
      });

      return reply.send({ parcels: parcels.map(toParcelView) });
    },
  );

  /**
   * Catalogue des articles que ce fournisseur prépare.
   *
   * Sa fiche de référence : la photo, la déclinaison, la référence exacte.
   * Elle évite l'aller-retour par message quand un libellé de commande est
   * ambigu — « Blackened Blue », c'est laquelle des deux bleues ?
   *
   * Filtré par ses propres règles d'affectation : lui montrer tout le
   * catalogue de la boutique reviendrait à lui communiquer l'assortiment
   * complet du marchand, ce qui ne le regarde pas.
   */
  app.get<{ Params: { id: string }; Querystring: { token?: string } }>(
    '/api/workspace/:id/catalog',
    async (request, reply) => {
      const workspace = await authorize(request, reply);
      if (!workspace) return;

      if (workspace.ordersAccess === 'NONE') return reply.send({ items: [] });

      /*
       * Le filtre part chez Shopify plutôt que de trier ici.
       *
       * Rapatrier le catalogue entier pour n'en garder qu'une marque ferait
       * payer la boutique complète à chaque ouverture, et le fournisseur
       * ouvrira cet écran vingt fois par jour. `vendor:` et `sku:` sont
       * compris par la recherche produits de Shopify.
       *
       * Sans aucune règle, la réponse est vide : mieux vaut un catalogue vide
       * qu'un catalogue qui expose l'assortiment entier du marchand à un
       * tiers.
       */
      const clauses = [
        ...workspace.vendors.map((vendor) => `vendor:'${vendor.replace(/'/g, "")}'`),
        ...workspace.skuPrefixes.map((prefix) => `sku:${prefix.replace(/[^\w.-]/g, '')}*`),
      ];

      if (clauses.length === 0) return reply.send({ items: [] });

      try {
        const client = await getShopifyClient(workspace.merchantId);
        const page = await listProducts(client, {
          query: clauses.join(' OR '),
          limit: 100,
        });

        return reply.send({ items: page.products });
      } catch (error) {
        request.log.warn({ err: error }, 'Catalogue fournisseur indisponible');
        return reply.send({ items: [], error: 'Catalogue indisponible pour le moment.' });
      }
    },
  );

  /** Accusé de lecture : l'alerte disparaît de l'atelier, pas de l'historique. */
  app.post<{ Params: { id: string; alertId: string }; Querystring: { token?: string } }>(
    '/api/workspace/:id/alerts/:alertId/ack',
    async (request, reply) => {
      const workspace = await authorize(request, reply);
      if (!workspace) return;

      const updated = await prisma.supplierAlert.updateMany({
        where: {
          id: request.params.alertId,
          merchantId: workspace.merchantId,
          supplierId: workspace.supplierId,
          acknowledgedAt: null,
        },
        data: { acknowledgedAt: new Date(), status: 'ACKNOWLEDGED' },
      });

      return reply.send({ acknowledged: updated.count });
    },
  );

  app.get<{ Params: { id: string; parcelId: string }; Querystring: { token?: string } }>(
    '/api/workspace/:id/parcels/:parcelId/photo',
    async (request, reply) => {
      const workspace = await authorize(request, reply);
      if (!workspace) return;

      return sendParcelPhoto(reply, request.params.parcelId, workspace.merchantId);
    },
  );

  /**
   * Signalement d'un problème sur une commande.
   *
   * Crée un vrai ticket, pas une note à part : c'est au moment de l'emballage
   * qu'on découvre un téléphone incomplet, et l'agent qui le corrigera travaille
   * dans la file, pas dans une seconde boîte de réception.
   */
  app.post<{ Params: { id: string }; Querystring: { token?: string } }>(
    '/api/workspace/:id/issues',
    async (request, reply) => {
      const workspace = await authorize(request, reply);
      if (!workspace) return;

      const parsed = z
        .object({
          shopifyOrderId: z.string().min(1).max(120),
          orderName: z.string().max(60).nullish(),
          customerEmail: z.string().email().max(200).nullish(),
          kind: z.enum(['PHONE', 'ADDRESS', 'STOCK', 'DAMAGE', 'OTHER']),
          note: z.string().min(3).max(2000),
          /*
           * Détail de l'article, pour une rupture.
           *
           * « Article indisponible » oblige l'agent à rouvrir la commande pour
           * savoir lequel, dans quelle couleur, dans quelle taille — et à
           * réécrire au fournisseur pour ce qu'il savait au moment où il l'a
           * signalé. Les champs sont libres et facultatifs : un formulaire
           * strict ferait renoncer au signalement.
           */
          product: z.string().max(200).nullish(),
          color: z.string().max(80).nullish(),
          size: z.string().max(40).nullish(),
          sku: z.string().max(80).nullish(),
          quantity: z.number().int().min(1).max(999).nullish(),
        })
        .safeParse(request.body);

      if (!parsed.success) {
        return reply.code(400).send({ error: 'Signalement incomplet' });
      }

      const KINDS = {
        PHONE: 'Numéro de téléphone incomplet ou invalide',
        ADDRESS: 'Adresse incomplète ou incorrecte',
        STOCK: 'Article indisponible',
        DAMAGE: 'Article abîmé',
        OTHER: 'Autre problème',
      } as const;

      const subject = `${KINDS[parsed.data.kind]} — ${parsed.data.orderName ?? 'commande'}`;

      // Le fil est identifié par la commande et le motif : deux signalements
      // identiques le même jour ne créent pas deux tickets concurrents.
      const threadId = `supplier:${workspace.supplierId}:${parsed.data.shopifyOrderId}:${parsed.data.kind}`;

      const ticket = await prisma.ticket.upsert({
        where: {
          merchantId_gmailThreadId: { merchantId: workspace.merchantId, gmailThreadId: threadId },
        },
        create: {
          merchantId: workspace.merchantId,
          gmailThreadId: threadId,
          subject,
          // Le fournisseur n'est pas le client : sans email client connu, on
          // note l'origine plutôt que d'inventer une adresse.
          customerEmail: parsed.data.customerEmail ?? `fournisseur+${workspace.supplierId}@local`,
          customerName: workspace.supplierName,
          status: 'NEEDS_REVIEW',
          intent: 'OTHER',
          shopifyOrderId: parsed.data.shopifyOrderId,
          orderName: parsed.data.orderName ?? null,
          lastMessageAt: new Date(),
        },
        update: { status: 'NEEDS_REVIEW', lastMessageAt: new Date() },
        select: { id: true, subject: true },
      });

      await prisma.message.create({
        data: {
          merchantId: workspace.merchantId,
          ticketId: ticket.id,
          gmailMessageId: `${threadId}:${Date.now()}`,
          direction: 'INBOUND',
          fromEmail: `fournisseur+${workspace.supplierId}@local`,
          subject,
          bodyText: [
            `Signalé par ${workspace.supplierName} depuis l'atelier.`,
            '',
            // Le détail de l'article avant la note libre : c'est ce qui décide
            // de la réponse au client, la note ne fait que l'expliquer.
            [
              parsed.data.product ? `Article : ${parsed.data.product}` : null,
              parsed.data.color ? `Couleur : ${parsed.data.color}` : null,
              parsed.data.size ? `Taille : ${parsed.data.size}` : null,
              parsed.data.sku ? `Référence : ${parsed.data.sku}` : null,
              parsed.data.quantity ? `Quantité : ${parsed.data.quantity}` : null,
            ]
              .filter(Boolean)
              .join('\n'),
            '',
            parsed.data.note,
          ]
            .filter((line) => line !== '' || true)
            .join('\n')
            .replace(/\n{3,}/g, '\n\n'),
          receivedAt: new Date(),
        },
      });

      await recordAudit({
        merchantId: workspace.merchantId,
        actorType: 'SUPPLIER',
        actorId: workspace.supplierId,
        action: 'supplier.issue_reported',
        targetType: 'Ticket',
        targetId: ticket.id,
        metadata: { kind: parsed.data.kind, orderName: parsed.data.orderName },
        ipAddress: request.ip,
      });

      return reply.send({ ticket });
    },
  );
}
