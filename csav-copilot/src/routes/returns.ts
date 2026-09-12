import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.ts';
import { recordAudit } from '../lib/audit.ts';
import { requirePermission, requireSession } from '../plugins/auth.ts';
import { decodePhoto, photoSchema } from './parcels.ts';
import { getShopifyClient } from '../services/shopify/client.ts';
import { listOrders, quoteSearchValue, type OrderSummary } from '../services/shopify/orders.ts';
import {
  PAYS_RETOUR,
  VOISINS,
  correspond,
  rapprocher,
  type PaireEnStock,
} from '../services/reshipment/rapprochement.ts';
import { signAgencyToken } from '../lib/agencyToken.ts';
import { env } from '../config/env.ts';

/**
 * Reshipment — les retours clients, et ce qu'on en refait.
 *
 * Un retour vit deux vies. D'abord un dossier à suivre : le client a-t-il son
 * bon de retour, le colis est-il arrivé chez l'agence, dans quel état. Puis,
 * s'il est remis en stock, une paire disponible chez l'agence de son pays — et
 * c'est là que le circuit se referme : la prochaine commande du même article
 * dans ce pays, ou dans un pays voisin, se sert dans ce stock au lieu de
 * refaire partir un colis de l'atelier. Rien ne se gâche, et le client est
 * livré en trois jours au lieu de quinze.
 *
 * Les agences de traitement (une ou plusieurs par pays : FR, ES, IT, BE)
 * réceptionnent et stockent ; leurs coordonnées vivent ici, sous la main au
 * moment d'ouvrir un dossier.
 */

const COUNTRIES = PAYS_RETOUR;

const caseBody = z.object({
  orderName: z.string().max(60).nullish(),
  shopifyOrderId: z.string().max(80).nullish(),
  customerName: z.string().max(200).nullish(),
  customerEmail: z.string().max(200).nullish(),
  customerPhone: z.string().max(40).nullish(),
  country: z.enum(COUNTRIES).nullish(),
  productTitle: z.string().min(1).max(300),
  variantTitle: z.string().max(120).nullish(),
  sku: z.string().max(120).nullish(),
  /** Pour un échange : ce que le client veut à la place. */
  wantedTitle: z.string().max(300).nullish(),
  wantedVariantTitle: z.string().max(120).nullish(),
  wantedSku: z.string().max(120).nullish(),
  reason: z.enum(['SIZE', 'DEFECT', 'MODEL', 'OTHER']).optional(),
  resolution: z.enum(['EXCHANGE', 'REFUND']).optional(),
  agencyId: z.string().max(40).nullish(),
  note: z.string().max(4000).nullish(),
});

const casePatch = caseBody.partial().extend({
  labelSent: z.boolean().optional(),
  status: z.enum(['OPEN', 'LABEL_SENT', 'SHIPPED', 'IN_TRANSIT', 'RECEIVED', 'RESTOCKED', 'UNUSABLE', 'CLOSED']).optional(),
  trackingNumber: z.string().max(120).nullish(),
  /** Photo de l'article retourné, en data URL — la preuve au dossier. */
  photo: photoSchema.nullish(),
  /** Marque le dossier « contacté aujourd'hui » : la relance repart de zéro. */
  touch: z.boolean().optional(),
  /** Consomme la paire remise en stock sur cette commande. */
  reusedOrderName: z.string().max(60).nullish(),
});

const agencyBody = z.object({
  country: z.enum(COUNTRIES),
  name: z.string().min(1).max(200),
  email: z.string().max(200).nullish(),
  phone: z.string().max(40).nullish(),
  address: z.string().max(2000).nullish(),
  notes: z.string().max(4000).nullish(),
});

/** Une paire prise entre la proposition et le clic : la réservation entière est annulée. */
class PairePlusDisponible extends Error {}

export async function returnRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireSession);

  app.get('/api/returns', async (request, reply) => {
    const { merchantId } = request.session;

    const cases = (
      await prisma.returnCase.findMany({
        where: { merchantId },
        orderBy: { createdAt: 'desc' },
        take: 300,
        // Les octets de la photo restent en base : la liste n'a besoin que de
        // savoir qu'elle existe, l'image se sert par sa propre route.
        omit: { photoData: true },
        include: { agency: { select: { id: true, name: true, country: true } } },
      })
    ).map(({ photoMime, ...item }) => ({ ...item, hasPhoto: Boolean(photoMime) }));

    // Les dossiers silencieux : ouverts, et sans contact depuis trois jours.
    // C'est le compte qui doit faire mal — un retour qu'on laisse mourir est
    // un remboursement qu'on fera quand même, mais sans récupérer la paire.
    const silentSince = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    const silent = cases.filter(
      (item) =>
        ['OPEN', 'LABEL_SENT'].includes(item.status) && item.lastContactAt < silentSince,
    ).length;

    // Le stock retours : remis en rayon chez une agence, pas encore réemployé.
    const stock = cases.filter((item) => item.status === 'RESTOCKED' && !item.reusedAt);

    return reply.send({
      cases,
      counts: {
        open: cases.filter((item) => !['CLOSED', 'UNUSABLE'].includes(item.status)).length,
        silent,
        stock: stock.length,
        reserved: cases.filter((item) => item.reusedShopifyOrderId).length,
      },
    });
  });

  app.post('/api/returns', { preHandler: requirePermission('reply') }, async (request, reply) => {
    const { merchantId, userId } = request.session;
    const parsed = caseBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Champs invalides' });

    const created = await prisma.returnCase.create({
      data: { merchantId, ...parsed.data },
    });

    await recordAudit({
      merchantId,
      actorType: 'USER',
      actorId: userId,
      action: 'return.created',
      targetType: 'return',
      targetId: created.id,
      metadata: { orderName: created.orderName, product: created.productTitle },
    });

    return reply.send({ case: created });
  });

  app.patch<{ Params: { id: string } }>(
    '/api/returns/:id',
    { preHandler: requirePermission('reply') },
    async (request, reply) => {
      const { merchantId, userId } = request.session;
      const parsed = casePatch.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: 'Champs invalides' });

      const existing = await prisma.returnCase.findFirst({
        where: { id: request.params.id, merchantId },
        select: { id: true },
      });
      if (!existing) return reply.code(404).send({ error: 'Dossier introuvable' });

      const { touch, reusedOrderName, photo, ...fields } = parsed.data;

      // `photo: null` retire la photo ; absente, elle ne bouge pas.
      const photoFields =
        photo === undefined
          ? {}
          : photo === null
            ? { photoData: null, photoMime: null }
            : (() => {
                const decoded = decodePhoto(photo);
                return { photoData: decoded.data, photoMime: decoded.mime };
              })();

      const updated = await prisma.returnCase.update({
        where: { id: existing.id },
        data: {
          ...fields,
          ...photoFields,
          // Fournir le bon fait avancer le statut tout seul : deux gestes pour
          // dire la même chose finiraient par se contredire.
          ...(fields.labelSent === true ? { status: fields.status ?? 'LABEL_SENT' } : {}),
          // Entrée au stock datée : les paires les plus anciennes partent en premier.
          ...(fields.status === 'RESTOCKED' ? { restockedAt: new Date() } : {}),
          ...(touch ? { lastContactAt: new Date() } : {}),
          ...(reusedOrderName !== undefined
            ? reusedOrderName
              ? { reusedOrderName, reusedAt: new Date(), status: 'CLOSED' }
              : // Annuler un réemploi rend la paire au STOCK : elle restait
                // « close », donc perdue pour les commandes suivantes.
                { reusedOrderName: null, reusedShopifyOrderId: null, reusedAt: null, status: 'RESTOCKED' }
            : {}),
        },
      });

      await recordAudit({
        merchantId,
        actorType: 'USER',
        actorId: userId,
        action: 'return.updated',
        targetType: 'return',
        targetId: updated.id,
        metadata: { ...fields, photo: photo === undefined ? undefined : Boolean(photo) },
      });

      return reply.send({ case: updated });
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/api/returns/:id',
    // Comme la suppression d'un ticket : effacer un enregistrement n'est pas
    // du travail courant.
    { preHandler: requirePermission('configure') },
    async (request, reply) => {
      const { merchantId, userId } = request.session;

      const deleted = await prisma.returnCase.deleteMany({
        where: { id: request.params.id, merchantId },
      });
      if (deleted.count === 0) return reply.code(404).send({ error: 'Dossier introuvable' });

      await recordAudit({
        merchantId,
        actorType: 'USER',
        actorId: userId,
        action: 'return.deleted',
        targetType: 'return',
        targetId: request.params.id,
      });

      return reply.send({ deleted: true });
    },
  );

  /** La photo de l'article retourné — la preuve, en pleine taille. */
  app.get<{ Params: { id: string } }>('/api/returns/:id/photo', async (request, reply) => {
    const { merchantId } = request.session;

    const item = await prisma.returnCase.findFirst({
      where: { id: request.params.id, merchantId },
      select: { photoData: true, photoMime: true },
    });
    if (!item?.photoData || !item.photoMime) {
      return reply.code(404).send({ error: 'Aucune photo' });
    }

    return reply
      .type(item.photoMime)
      .header('Cache-Control', 'private, max-age=300')
      .send(Buffer.from(item.photoData));
  });

  /**
   * Pré-remplissage du dossier depuis le numéro de commande.
   *
   * Tout ce que le formulaire demande est déjà dans la commande : le client,
   * son téléphone, son pays, l'article. Le ressaisir est du temps volé et des
   * fautes de frappe — le numéro suffit, le reste se remplit tout seul.
   */
  app.get<{ Querystring: { name?: string } }>('/api/returns/order-lookup', async (request, reply) => {
    const { merchantId } = request.session;
    const raw = (request.query.name ?? '').trim();
    if (!raw) return reply.code(400).send({ error: 'Numéro de commande requis' });

    // « 11363 » et « #11363 » désignent la même commande : on cherche le nom
    // exact tel que Shopify le connaît, dièse compris.
    const name = raw.startsWith('#') ? raw : `#${raw}`;

    try {
      const client = await getShopifyClient(merchantId);
      const { orders } = await listOrders(client, {
        query: `name:${quoteSearchValue(name)}`,
        limit: 1,
      });

      const order = orders[0];
      if (!order) return reply.code(404).send({ error: `Commande ${name} introuvable.` });

      const address = order.shippingAddress;
      return reply.send({
        order: {
          orderName: order.name,
          shopifyOrderId: order.id,
          customerName: order.customer?.displayName ?? address?.name ?? null,
          customerEmail: order.customer?.email ?? null,
          customerPhone: address?.phone ?? null,
          country: address?.country ?? null,
          lineItems: (order.lineItems ?? []).map((item) => ({
            title: item.title,
            variantTitle: item.variantTitle ?? null,
            sku: item.sku ?? null,
            // La photo : on reconnaît l'article renvoyé d'un coup d'œil, bien
            // plus vite qu'à sa référence.
            image: item.image ?? null,
            quantity: item.quantity,
          })),
        },
      });
    } catch (error) {
      request.log.warn({ err: error }, 'Lookup commande retour en échec');
      return reply.code(502).send({ error: 'Commande injoignable pour le moment.' });
    }
  });

  /* ------------------------------------------------------------ agences -- */

  app.get('/api/return-agencies', async (request, reply) => {
    const { merchantId } = request.session;
    const agencies = await prisma.returnAgency.findMany({
      where: { merchantId },
      orderBy: [{ country: 'asc' }, { name: 'asc' }],
    });
    return reply.send({ agencies });
  });

  app.post(
    '/api/return-agencies',
    // Les agences sont des partenaires du marchand, comme les fournisseurs.
    { preHandler: requirePermission('configure') },
    async (request, reply) => {
      const { merchantId } = request.session;
      const parsed = agencyBody.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: 'Champs invalides' });

      const agency = await prisma.returnAgency.create({
        data: { merchantId, ...parsed.data },
      });
      return reply.send({ agency });
    },
  );

  app.patch<{ Params: { id: string } }>(
    '/api/return-agencies/:id',
    { preHandler: requirePermission('configure') },
    async (request, reply) => {
      const { merchantId } = request.session;
      const parsed = agencyBody.partial().safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: 'Champs invalides' });

      const updated = await prisma.returnAgency.updateMany({
        where: { id: request.params.id, merchantId },
        data: parsed.data,
      });
      if (updated.count === 0) return reply.code(404).send({ error: 'Agence introuvable' });

      return reply.send({ updated: true });
    },
  );

  /**
   * Le lien de travail d'une agence : elle y voit les commandes à expédier
   * depuis son stock et y saisit ses numéros de suivi.
   *
   * Émis à la demande, rien de secret en base : le jeton se recalcule à partir
   * du numéro de version. « Renouveler » l'incrémente et coupe tous les liens
   * déjà transmis — la parade en cas de fuite.
   */
  app.post<{ Params: { id: string }; Body: { revoke?: boolean } }>(
    '/api/return-agencies/:id/portal-link',
    { preHandler: requirePermission('configure') },
    async (request, reply) => {
      const { merchantId, userId } = request.session;
      const agence = await prisma.returnAgency.findFirst({
        where: { id: request.params.id, merchantId },
        select: { id: true, portalTokenVersion: true },
      });
      if (!agence) return reply.code(404).send({ error: 'Agence introuvable' });

      const version = request.body?.revoke
        ? (
            await prisma.returnAgency.update({
              where: { id: agence.id },
              data: { portalTokenVersion: { increment: 1 } },
              select: { portalTokenVersion: true },
            })
          ).portalTokenVersion
        : agence.portalTokenVersion;

      const token = signAgencyToken({ merchantId, agencyId: agence.id, version });

      await recordAudit({
        merchantId,
        actorType: 'USER',
        actorId: userId,
        action: request.body?.revoke ? 'agency.link_revoked' : 'agency.link_issued',
        targetType: 'ReturnAgency',
        targetId: agence.id,
      });

      return reply.send({
        url: `${env.APP_URL}/agence/${agence.id}?token=${encodeURIComponent(token)}`,
        revoked: Boolean(request.body?.revoke),
      });
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/api/return-agencies/:id',
    { preHandler: requirePermission('configure') },
    async (request, reply) => {
      const { merchantId } = request.session;
      const deleted = await prisma.returnAgency.deleteMany({
        where: { id: request.params.id, merchantId },
      });
      if (deleted.count === 0) return reply.code(404).send({ error: 'Agence introuvable' });
      return reply.send({ deleted: true });
    },
  );

  /**
   * Cet article est-il dans le stock retours, et où ?
   *
   * Posée au moment où l'on note ce que le client veut à la place : la réponse
   * décide qui enverra la paire d'échange — l'agence si elle l'a, l'atelier
   * sinon. Mêmes règles que le rapprochement des commandes : même pays
   * d'abord, puis pays voisin.
   */
  app.get<{ Querystring: { titre?: string; declinaison?: string; sku?: string; pays?: string } }>(
    '/api/returns/stock-dispo',
    async (request, reply) => {
      const { merchantId } = request.session;
      const titre = (request.query.titre ?? '').trim();
      if (!titre) return reply.send({ lieux: [] });

      const ligne = {
        titre,
        declinaison: (request.query.declinaison ?? '').trim() || null,
        sku: (request.query.sku ?? '').trim() || null,
        quantite: 1,
      };
      const pays = (request.query.pays ?? '').trim().toUpperCase();

      const enStock = await prisma.returnCase.findMany({
        where: { merchantId, status: 'RESTOCKED', reusedAt: null },
        select: {
          id: true,
          country: true,
          sku: true,
          productTitle: true,
          variantTitle: true,
          orderName: true,
          restockedAt: true,
          updatedAt: true,
          agency: { select: { id: true, name: true, country: true } },
        },
      });

      const voisins = VOISINS[pays] ?? [];
      const lieux = new Map<string, { pays: string; agence: string | null; voisin: boolean; nombre: number }>();

      for (const paire of enStock) {
        const paireEnStock: PaireEnStock = {
          id: paire.id,
          pays: paire.agency?.country ?? paire.country ?? null,
          agenceId: paire.agency?.id ?? null,
          agenceNom: paire.agency?.name ?? null,
          sku: paire.sku,
          titre: paire.productTitle,
          declinaison: paire.variantTitle,
          depuis: paire.restockedAt ?? paire.updatedAt,
          retourDe: paire.orderName,
        };
        if (!correspond(paireEnStock, ligne) || !paireEnStock.pays) continue;
        // Hors du pays du client et de ses voisins, la paire ne sert pas.
        if (pays && paireEnStock.pays !== pays && !voisins.includes(paireEnStock.pays)) continue;

        const cle = `${paireEnStock.pays}|${paireEnStock.agenceNom ?? ''}`;
        const deja = lieux.get(cle);
        if (deja) deja.nombre += 1;
        else {
          lieux.set(cle, {
            pays: paireEnStock.pays,
            agence: paireEnStock.agenceNom,
            voisin: Boolean(pays) && paireEnStock.pays !== pays,
            nombre: 1,
          });
        }
      }

      // Le même pays d'abord : c'est de là que la paire partira.
      return reply.send({
        lieux: [...lieux.values()].sort((a, b) => Number(a.voisin) - Number(b.voisin)),
      });
    },
  );

  /* -------------------------------------------------------------- match -- */

  /**
   * Le match : commandes en attente × stock retours.
   *
   * Toutes les commandes non expédiées sont examinées, par pages, les plus
   * anciennes d'abord — pas seulement les cent dernières. En sont retirées
   * celles que l'atelier a déjà commencées (un colis saisi : la paire est
   * partie de Chine, en proposer une autre ferait deux envois) et celles
   * qu'une paire sert déjà. Le rapprochement lui-même vit dans
   * `services/reshipment/rapprochement.ts` : même pays d'abord, puis pays
   * voisin, une commande entière par une seule agence, les paires les plus
   * anciennes d'abord.
   *
   * Rien ne s'engage tout seul : le match propose, le marchand confie la
   * commande d'un clic.
   */
  app.get('/api/returns/matches', async (request, reply) => {
    const { merchantId } = request.session;

    const enStock = await prisma.returnCase.findMany({
      where: { merchantId, status: 'RESTOCKED', reusedAt: null },
      select: {
        id: true,
        country: true,
        sku: true,
        productTitle: true,
        variantTitle: true,
        orderName: true,
        restockedAt: true,
        updatedAt: true,
        agency: { select: { id: true, name: true, country: true } },
      },
    });
    if (enStock.length === 0) return reply.send({ matches: [], examinees: 0, tronque: false });

    // Où se trouve la paire : chez son agence. Sans agence, dans le pays du
    // client qui l'a renvoyée — c'est celui qui décide de l'agence.
    const stock: PaireEnStock[] = enStock.map((paire) => ({
      id: paire.id,
      pays: paire.agency?.country ?? paire.country ?? null,
      agenceId: paire.agency?.id ?? null,
      agenceNom: paire.agency?.name ?? null,
      sku: paire.sku,
      titre: paire.productTitle,
      declinaison: paire.variantTitle,
      depuis: paire.restockedAt ?? paire.updatedAt,
      retourDe: paire.orderName,
    }));

    // Toutes les commandes en attente, par pages de cent. Au-delà de dix
    // pages, on s'arrête — et on le DIT : un plafond silencieux se lirait
    // « aucune autre commande ne correspond ».
    const PAGES_MAX = 10;
    const commandes: OrderSummary[] = [];
    let tronque = false;
    try {
      const client = await getShopifyClient(merchantId);
      let cursor: string | null = null;
      for (let page = 0; page < PAGES_MAX; page += 1) {
        const resultat = await listOrders(client, {
          query: 'fulfillment_status:unfulfilled status:open',
          limit: 100,
          cursor,
          sort: 'oldest',
        });
        commandes.push(...resultat.orders);
        cursor = resultat.hasNextPage ? resultat.cursor : null;
        if (!cursor) break;
      }
      tronque = Boolean(cursor);
    } catch {
      return reply.send({ matches: [], examinees: 0, tronque: false, error: 'Commandes Shopify indisponibles.' });
    }

    const ids = commandes.map((commande) => commande.id);
    const [colis, dejaServies] = await Promise.all([
      prisma.parcel.findMany({
        where: { merchantId, shopifyOrderId: { in: ids } },
        select: { shopifyOrderId: true },
      }),
      prisma.returnCase.findMany({
        where: { merchantId, reusedShopifyOrderId: { in: ids } },
        select: { reusedShopifyOrderId: true },
      }),
    ]);
    const commencees = new Set(colis.map((ligne) => ligne.shopifyOrderId));
    const servies = new Set(dejaServies.map((ligne) => ligne.reusedShopifyOrderId));

    const enAttente = commandes.filter(
      (commande) =>
        ['UNFULFILLED', 'OPEN'].includes(commande.displayFulfillmentStatus ?? '') &&
        !commencees.has(commande.id) &&
        !servies.has(commande.id) &&
        commande.shippingAddress?.country &&
        VOISINS[commande.shippingAddress.country],
    );

    const parId = new Map(enAttente.map((commande) => [commande.id, commande]));
    const propositions = rapprocher(
      stock,
      enAttente.map((commande) => ({
        id: commande.id,
        nom: commande.name,
        client: commande.customer?.displayName ?? commande.shippingAddress?.name ?? null,
        pays: commande.shippingAddress?.country ?? null,
        creeLe: commande.createdAt,
        lignes: (commande.lineItems ?? []).map((ligne) => ({
          titre: ligne.title,
          declinaison: ligne.variantTitle ?? null,
          sku: ligne.sku ?? null,
          quantite: ligne.quantity,
        })),
      })),
    );

    return reply.send({
      // L'adresse de livraison part avec la proposition : c'est ce que
      // l'agence devra écrire sur le colis.
      matches: propositions.map((proposition) => ({
        ...proposition,
        adresse: parId.get(proposition.commandeId)?.shippingAddress ?? null,
      })),
      examinees: commandes.length,
      tronque,
    });
  });

  /**
   * Confier une commande au stock retours.
   *
   * Le serveur revérifie tout au moment du clic, parce que la liste affichée
   * peut avoir vieilli : les paires sont-elles toujours en stock, l'atelier
   * n'a-t-il pas commencé la commande entre-temps, une autre paire ne la
   * sert-elle pas déjà ? La réservation se fait en une écriture qui exige
   * que TOUTES les paires soient encore libres : deux clics simultanés ne
   * peuvent pas confier la même paire à deux commandes.
   *
   * Dès cet instant, la commande disparaît de la liste de l'atelier.
   */
  app.post(
    '/api/returns/reemploi',
    { preHandler: requirePermission('reply') },
    async (request, reply) => {
      const { merchantId, userId } = request.session;
      const parsed = z
        .object({
          orderId: z.string().min(1).max(120),
          orderName: z.string().min(1).max(60),
          returnIds: z.array(z.string().min(1).max(40)).min(1).max(20),
        })
        .safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: 'Réemploi invalide' });
      const { orderId, orderName, returnIds } = parsed.data;

      const [colis, dejaServie] = await Promise.all([
        prisma.parcel.count({ where: { merchantId, shopifyOrderId: orderId } }),
        prisma.returnCase.count({ where: { merchantId, reusedShopifyOrderId: orderId } }),
      ]);
      if (colis > 0) {
        return reply.code(409).send({
          code: 'commencee',
          error: `L’atelier a déjà saisi un colis pour ${orderName} : la paire est partie de chez lui.`,
        });
      }
      if (dejaServie > 0) {
        return reply.code(409).send({ code: 'deja_servie', error: `${orderName} est déjà servie par le stock retours.` });
      }

      /*
       * Toutes les paires ou aucune, dans UNE transaction : une paire prise
       * entre-temps annule la réservation entière plutôt que de servir une
       * commande à moitié. Chaque paire n'est prise que si elle est ENCORE
       * libre au moment de l'écriture — la base attend qu'une écriture
       * concurrente finisse, puis revérifie. Une première version annulait à
       * la main en « libérant la commande » : sur un double-clic, le second
       * clic, en échouant, libérait la réservation du premier.
       */
      const reservee = await prisma
        .$transaction(async (tx) => {
          for (const id of returnIds) {
            const prise = await tx.returnCase.updateMany({
              where: { id, merchantId, status: 'RESTOCKED', reusedAt: null },
              data: { reusedOrderName: orderName, reusedShopifyOrderId: orderId, reusedAt: new Date(), status: 'CLOSED' },
            });
            if (prise.count !== 1) throw new PairePlusDisponible();
          }
          // Une seule réservation par commande, même si deux ont couru ensemble.
          const pourCetteCommande = await tx.returnCase.count({ where: { merchantId, reusedShopifyOrderId: orderId } });
          if (pourCetteCommande !== returnIds.length) throw new PairePlusDisponible();
          return true;
        })
        .catch((erreur: unknown) => {
          if (erreur instanceof PairePlusDisponible) return false;
          throw erreur;
        });

      if (!reservee) {
        return reply.code(409).send({
          code: 'plus_disponible',
          error: 'Une des paires n’est plus disponible, ou la commande vient d’être servie : rechargez les propositions.',
        });
      }

      await recordAudit({
        merchantId,
        actorType: 'USER',
        actorId: userId,
        action: 'return.reused',
        targetType: 'order',
        targetId: orderId,
        metadata: { orderName, returnIds },
      });

      const agence = await prisma.returnCase.findFirst({
        where: { id: returnIds[0], merchantId },
        select: { agency: { select: { name: true, email: true, phone: true, address: true, country: true } } },
      });
      return reply.send({ reserve: true, agence: agence?.agency ?? null });
    },
  );

  /** Annuler : les paires reviennent au stock, la commande revient à l'atelier. */
  app.post(
    '/api/returns/reemploi/liberer',
    { preHandler: requirePermission('reply') },
    async (request, reply) => {
      const { merchantId, userId } = request.session;
      const parsed = z.object({ orderId: z.string().min(1).max(120) }).safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: 'Commande invalide' });

      // L'agence a déjà expédié : la paire est partie, la commande ne peut
      // plus revenir à l'atelier — il l'expédierait une seconde fois.
      const expediees = await prisma.returnCase.count({
        where: { merchantId, reusedShopifyOrderId: parsed.data.orderId, reshippedAt: { not: null } },
      });
      if (expediees > 0) {
        return reply.code(409).send({
          code: 'deja_expediee',
          error: 'L’agence a déjà expédié cette commande : elle ne peut plus revenir à l’atelier.',
        });
      }

      const liberees = await prisma.returnCase.updateMany({
        where: { merchantId, reusedShopifyOrderId: parsed.data.orderId },
        data: { reusedOrderName: null, reusedShopifyOrderId: null, reusedAt: null, status: 'RESTOCKED' },
      });
      if (liberees.count === 0) return reply.code(404).send({ error: 'Aucune paire ne sert cette commande.' });

      await recordAudit({
        merchantId,
        actorType: 'USER',
        actorId: userId,
        action: 'return.reuse_released',
        targetType: 'order',
        targetId: parsed.data.orderId,
        metadata: { paires: liberees.count },
      });
      return reply.send({ liberees: liberees.count });
    },
  );

  /**
   * « Défectueux » : la paire sort du stock.
   *
   * Depuis la réception (le contrôle de l'agence) comme depuis le stock. Une
   * paire déjà confiée à une commande ne sort pas sans qu'on libère d'abord
   * la commande : sinon l'agence expédierait une paire que l'outil dit
   * défectueuse, ou la commande resterait promise à une paire qui n'existe
   * plus.
   */
  app.post<{ Params: { id: string } }>(
    '/api/returns/:id/defectueux',
    { preHandler: requirePermission('reply') },
    async (request, reply) => {
      const { merchantId, userId } = request.session;
      const parsed = z.object({ note: z.string().max(2000).nullish() }).safeParse(request.body ?? {});
      if (!parsed.success) return reply.code(400).send({ error: 'Note invalide' });

      const paire = await prisma.returnCase.findFirst({
        where: { id: request.params.id, merchantId },
        select: { id: true, status: true, reusedOrderName: true, reusedShopifyOrderId: true },
      });
      if (!paire) return reply.code(404).send({ error: 'Dossier introuvable' });
      if (paire.reusedShopifyOrderId) {
        return reply.code(409).send({
          code: 'reservee',
          error: `Cette paire est confiée à ${paire.reusedOrderName ?? 'une commande'} : libérez d’abord la commande.`,
        });
      }

      const sortie = await prisma.returnCase.update({
        where: { id: paire.id },
        data: { status: 'UNUSABLE', unusableAt: new Date(), unusableNote: parsed.data.note?.trim() || null },
      });

      await recordAudit({
        merchantId,
        actorType: 'USER',
        actorId: userId,
        action: 'return.unusable',
        targetType: 'return',
        targetId: paire.id,
        metadata: { from: paire.status, note: sortie.unusableNote },
      });
      return reply.send({ case: sortie });
    },
  );
}
