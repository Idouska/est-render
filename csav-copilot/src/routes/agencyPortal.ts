import type { FastifyBaseLogger, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { verifyAgencyToken } from '../lib/agencyToken.ts';
import { recordAudit } from '../lib/audit.ts';
import { prisma } from '../lib/prisma.ts';
import { enModeTest } from '../services/modeTest.ts';
import { getShopifyClient, type ShopifyClient } from '../services/shopify/client.ts';
import { corrigerSuivi, expeditionPortant, fulfillOrder } from '../services/shopify/fulfill.ts';
import { listOrders, quoteSearchValue, type ShippingAddress } from '../services/shopify/orders.ts';
import { abimeParExcel } from '../services/suppliers/importColis.ts';

/**
 * Le portail d'une agence de retours.
 *
 * L'agence stocke les paires retournées. Quand le marchand confie une commande
 * à une paire de son stock, c'est elle qui l'expédie : elle ouvre son lien,
 * voit l'adresse du client et la paire à envoyer, saisit son numéro de suivi —
 * et Shopify passe la commande en « expédiée » et écrit au client, comme pour
 * un colis de l'atelier. En mode test, rien ne part.
 *
 * Elle ne voit QUE les commandes confiées à des paires de son stock : ni le
 * reste des commandes du marchand, ni les autres agences.
 */

interface Agence {
  id: string;
  merchantId: string;
  name: string;
  country: string;
}

type RequeteAgence = FastifyRequest<{ Params: { id: string }; Querystring: { token?: string } }>;

async function autoriser(request: RequeteAgence, reply: FastifyReply): Promise<Agence | null> {
  const payload = verifyAgencyToken(request.query.token);
  if (!payload || payload.agencyId !== request.params.id) {
    await reply.code(401).send({ code: 'lien_invalide', error: 'Lien invalide' });
    return null;
  }

  const agence = await prisma.returnAgency.findFirst({
    where: { id: payload.agencyId, merchantId: payload.merchantId },
    select: { id: true, merchantId: true, name: true, country: true, portalTokenVersion: true },
  });

  // La version fait office de révocation : un lien émis avant le dernier
  // renouvellement n'ouvre plus rien.
  if (!agence || agence.portalTokenVersion !== payload.version) {
    await reply.code(401).send({ code: 'lien_revoque', error: 'Ce lien a été révoqué. Demandez-en un nouveau.' });
    return null;
  }

  return { id: agence.id, merchantId: agence.merchantId, name: agence.name, country: agence.country };
}

/**
 * Les adresses de livraison, lues chez Shopify au moment d'afficher — rien
 * n'est recopié en base. Cherchées par nom de commande, cinquante à la fois :
 * au-delà, la requête devient trop longue.
 *
 * Rangées sous DEUX clés, l'identifiant et le nom : les réexpéditions
 * connaissent l'identifiant de la commande servie, les échanges n'ont que le
 * nom de la commande d'origine. Les deux ne se confondent pas (« gid://… »
 * contre « #1042 »).
 */
async function adressesDe(
  client: ShopifyClient,
  noms: readonly string[],
): Promise<Map<string, ShippingAddress | null>> {
  const adresses = new Map<string, ShippingAddress | null>();
  for (let debut = 0; debut < noms.length; debut += 50) {
    const lot = noms.slice(debut, debut + 50);
    const { orders } = await listOrders(client, {
      query: lot.map((nom) => `name:${quoteSearchValue(nom)}`).join(' OR '),
      limit: lot.length,
    });
    for (const commande of orders) {
      adresses.set(commande.id, commande.shippingAddress ?? null);
      adresses.set(commande.name, commande.shippingAddress ?? null);
    }
  }
  return adresses;
}

/** Expédier chez Shopify, sans jamais laisser une panne réseau passer pour un succès. */
async function tenterExpedition(
  client: ShopifyClient,
  orderId: string,
  suivi: string,
  transporteur: string | null,
  log: FastifyBaseLogger,
): Promise<{ fulfilled: boolean; reason?: string }> {
  try {
    return await fulfillOrder(client, orderId, { numbers: [suivi], company: transporteur });
  } catch (error) {
    log.error({ err: error, orderId }, 'Expédition Shopify depuis une agence en échec');
    return { fulfilled: false, reason: 'Shopify n’a pas répondu.' };
  }
}

const ADRESSE_WEB = /:\/\/|^www\./i;
const TRENTE_JOURS = 30 * 24 * 60 * 60 * 1000;

export async function agencyPortalRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { id: string } }>('/agence/:id', async (request, reply) =>
    reply.type('text/html').sendFile('agence.html'),
  );

  /**
   * Ce que l'agence a à expédier, et ce qu'elle a expédié depuis trente jours.
   *
   * Une ligne par COMMANDE : les paires d'une même commande partent ensemble.
   */
  app.get<{ Params: { id: string }; Querystring: { token?: string } }>(
    '/api/agence/:id/expeditions',
    async (request, reply) => {
      const agence = await autoriser(request, reply);
      if (!agence) return;

      const paires = await prisma.returnCase.findMany({
        where: {
          merchantId: agence.merchantId,
          agencyId: agence.id,
          reusedShopifyOrderId: { not: null },
          OR: [{ reshippedAt: null }, { reshippedAt: { gte: new Date(Date.now() - TRENTE_JOURS) } }],
        },
        orderBy: { reusedAt: 'asc' },
        select: {
          id: true,
          productTitle: true,
          variantTitle: true,
          sku: true,
          orderName: true,
          photoMime: true,
          reusedShopifyOrderId: true,
          reusedOrderName: true,
          reusedAt: true,
          reshipTrackingNumber: true,
          reshipCarrier: true,
          reshippedAt: true,
        },
      });

      const parCommande = new Map<string, typeof paires>();
      for (const paire of paires) {
        const cle = paire.reusedShopifyOrderId!;
        parCommande.set(cle, [...(parCommande.get(cle) ?? []), paire]);
      }

      const commandes = [...parCommande.entries()].map(([orderId, lignes]) => {
        const premiere = lignes[0]!;
        return {
          orderId,
          orderName: premiere.reusedOrderName,
          confieeLe: premiere.reusedAt,
          suivi: premiere.reshipTrackingNumber,
          transporteur: premiere.reshipCarrier,
          expedieeLe: premiere.reshippedAt,
          paires: lignes.map((ligne) => ({
            id: ligne.id,
            titre: ligne.productTitle,
            declinaison: ligne.variantTitle,
            sku: ligne.sku,
            retourDe: ligne.orderName,
            aPhoto: Boolean(ligne.photoMime),
          })),
        };
      });

      const aExpedier = commandes.filter((commande) => !commande.expedieeLe);

      // Les ÉCHANGES : une paire de son stock a été promise à un client qui
      // renvoie la sienne. Il n'y a pas de commande Shopify à expédier — c'est
      // le marchand qui préviendra son client — mais l'agence a besoin de
      // l'adresse, et doit rendre un numéro de suivi.
      const pairesEchange = await prisma.returnCase.findMany({
        where: { merchantId: agence.merchantId, agencyId: agence.id, reusedReturnCaseId: { not: null } },
        select: {
          id: true,
          productTitle: true,
          variantTitle: true,
          sku: true,
          orderName: true,
          photoMime: true,
          reusedReturnCaseId: true,
        },
      });
      const dossiers = pairesEchange.length
        ? await prisma.returnCase.findMany({
            where: {
              merchantId: agence.merchantId,
              id: { in: [...new Set(pairesEchange.map((paire) => paire.reusedReturnCaseId!))] },
              OR: [
                { exchangeShippedAt: null },
                { exchangeShippedAt: { gte: new Date(Date.now() - TRENTE_JOURS) } },
              ],
            },
            select: {
              id: true,
              orderName: true,
              customerName: true,
              wantedTitle: true,
              wantedVariantTitle: true,
              wantedSku: true,
              exchangeTrackingNumber: true,
              exchangeCarrier: true,
              exchangeShippedAt: true,
            },
          })
        : [];
      const parPaire = new Map(pairesEchange.map((paire) => [paire.reusedReturnCaseId!, paire]));
      const echanges = dossiers.map((dossier) => {
        const paire = parPaire.get(dossier.id)!;
        return {
          id: dossier.id,
          commande: dossier.orderName,
          client: dossier.customerName,
          voulu: {
            titre: dossier.wantedTitle,
            declinaison: dossier.wantedVariantTitle,
            sku: dossier.wantedSku,
          },
          paire: {
            id: paire.id,
            titre: paire.productTitle,
            declinaison: paire.variantTitle,
            sku: paire.sku,
            retourDe: paire.orderName,
            aPhoto: Boolean(paire.photoMime),
          },
          suivi: dossier.exchangeTrackingNumber,
          transporteur: dossier.exchangeCarrier,
          expedieLe: dossier.exchangeShippedAt,
        };
      });
      const echangesAEnvoyer = echanges.filter((echange) => !echange.expedieLe);

      // L'adresse n'est lue que pour ce qui reste à expédier : c'est la seule
      // qui serve encore à l'agence.
      let adresses = new Map<string, ShippingAddress | null>();
      let adressesIndisponibles = false;
      const aChercher = [
        ...new Set(
          [
            ...aExpedier.map((commande) => commande.orderName),
            ...echangesAEnvoyer.map((echange) => echange.commande),
          ].filter((nom): nom is string => Boolean(nom)),
        ),
      ];
      if (aChercher.length > 0) {
        try {
          const client = await getShopifyClient(agence.merchantId);
          adresses = await adressesDe(client, aChercher);
        } catch (error) {
          request.log.warn({ err: error, agencyId: agence.id }, 'Adresses Shopify illisibles pour une agence');
          adressesIndisponibles = true;
        }
      }

      return reply.send({
        agence: { nom: agence.name, pays: agence.country },
        testMode: await enModeTest(agence.merchantId),
        adressesIndisponibles,
        aExpedier: aExpedier.map((commande) => ({ ...commande, adresse: adresses.get(commande.orderId) ?? null })),
        expediees: commandes
          .filter((commande) => commande.expedieeLe)
          .sort((a, b) => (b.expedieeLe!.getTime() - a.expedieeLe!.getTime())),
        echanges: echangesAEnvoyer.map((echange) => ({
          ...echange,
          adresse: echange.commande ? (adresses.get(echange.commande) ?? null) : null,
        })),
        echangesEnvoyes: echanges
          .filter((echange) => echange.expedieLe)
          .sort((a, b) => b.expedieLe!.getTime() - a.expedieLe!.getTime()),
      });
    },
  );

  /** La photo d'une paire de SON stock : la preuve de son état. */
  app.get<{ Params: { id: string; pairId: string }; Querystring: { token?: string } }>(
    '/api/agence/:id/paires/:pairId/photo',
    async (request, reply) => {
      const agence = await autoriser(request, reply);
      if (!agence) return;

      const paire = await prisma.returnCase.findFirst({
        where: { id: request.params.pairId, merchantId: agence.merchantId, agencyId: agence.id },
        select: { photoData: true, photoMime: true },
      });
      if (!paire?.photoData || !paire.photoMime) return reply.code(404).send({ error: 'Aucune photo' });

      return reply
        .type(paire.photoMime)
        .header('Cache-Control', 'private, max-age=300')
        .send(Buffer.from(paire.photoData));
    },
  );

  /**
   * L'agence a expédié : son numéro de suivi, et l'expédition chez Shopify.
   *
   * Le numéro est enregistré d'abord, puis Shopify est prévenu — qui passe la
   * commande en « expédiée » et écrit au client. Si Shopify ne répond pas, le
   * numéro reste, l'agence le voit, et renvoyer le même numéro retente
   * l'expédition.
   *
   * Un numéro DIFFÉRENT sur une commande déjà expédiée est une correction :
   * si le client a reçu l'ancien, elle ne part qu'avec une confirmation, et
   * Shopify lui envoie le bon — la même règle que pour l'atelier.
   */
  app.post<{ Params: { id: string }; Querystring: { token?: string } }>(
    '/api/agence/:id/expeditions',
    async (request, reply) => {
      const agence = await autoriser(request, reply);
      if (!agence) return;

      const parsed = z
        .object({
          orderId: z.string().min(1).max(120),
          trackingNumber: z.string().trim().min(3).max(80),
          carrier: z.string().max(80).nullish(),
          prevenirClient: z.boolean().optional(),
        })
        .safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ code: 'invalide', error: 'Numéro de suivi invalide.' });

      const suivi = parsed.data.trackingNumber.replace(/\s+/g, '');
      if (abimeParExcel(suivi)) {
        return reply.code(400).send({ code: 'abime_excel', error: 'Numéro abîmé par Excel : retapez-le en texte.' });
      }
      const brut = parsed.data.carrier?.trim() || null;
      const transporteur = brut && !ADRESSE_WEB.test(brut) ? brut : null;

      // Seules les commandes confiées à des paires de CETTE agence.
      const paires = await prisma.returnCase.findMany({
        where: { merchantId: agence.merchantId, agencyId: agence.id, reusedShopifyOrderId: parsed.data.orderId },
        select: { id: true, reusedOrderName: true, reshipTrackingNumber: true, reshippedAt: true },
      });
      if (paires.length === 0) {
        return reply.code(404).send({ code: 'introuvable', error: 'Cette commande n’est pas confiée à votre agence.' });
      }

      const ids = paires.map((paire) => paire.id);
      const dejaExpediee = paires.some((paire) => paire.reshippedAt);
      const ancien = paires.find((paire) => paire.reshipTrackingNumber)?.reshipTrackingNumber ?? null;
      const orderName = paires[0]!.reusedOrderName;

      let client: ShopifyClient;
      try {
        client = await getShopifyClient(agence.merchantId);
      } catch (error) {
        request.log.warn({ err: error }, 'Shopify injoignable pour une agence');
        return reply.code(502).send({ code: 'shopify', error: 'Shopify n’a pas répondu : réessayez dans un instant.' });
      }

      /* ---- correction d'un numéro déjà enregistré ---- */
      if (dejaExpediee && ancien && ancien !== suivi) {
        let expedition: Awaited<ReturnType<typeof expeditionPortant>>;
        try {
          expedition = await expeditionPortant(client, parsed.data.orderId, ancien);
        } catch (error) {
          request.log.warn({ err: error }, 'Suivi Shopify illisible avant correction par une agence');
          return reply.code(502).send({ code: 'shopify', error: 'Shopify n’a pas répondu : rien n’a été modifié.' });
        }

        if (expedition) {
          if (!parsed.data.prevenirClient) {
            return reply.code(409).send({
              code: 'client_deja_prevenu',
              ancien,
              error: 'Ce numéro a déjà été envoyé au client : confirmez pour lui envoyer le numéro corrigé.',
            });
          }
          const correction = await corrigerSuivi(client, expedition, ancien, suivi, transporteur);
          if (!correction.corrige) {
            return reply.code(502).send({
              code: 'shopify_refus',
              raison: correction.raison,
              error: `Shopify a refusé la correction : ${correction.raison} Rien n’a été modifié.`,
            });
          }
        }

        await prisma.returnCase.updateMany({
          where: { id: { in: ids } },
          data: { reshipTrackingNumber: suivi, reshipCarrier: transporteur },
        });
        await recordAudit({
          merchantId: agence.merchantId,
          actorType: 'SUPPLIER',
          actorId: `agence:${agence.id}`,
          action: 'agency.reship_corrected',
          targetType: 'order',
          targetId: parsed.data.orderId,
          metadata: { orderName, from: ancien, to: suivi, clientPrevenu: Boolean(expedition) },
          ipAddress: request.ip,
        });

        // Shopify ne connaissait pas l'ancien numéro : la commande n'était
        // sans doute pas partie chez lui — on l'expédie avec le bon.
        const shopify = expedition
          ? { fulfilled: true }
          : await tenterExpedition(client, parsed.data.orderId, suivi, transporteur, request.log);
        return reply.send({ expediee: true, corrigee: true, clientPrevenu: Boolean(expedition), shopify });
      }

      /* ---- première expédition, ou nouvel essai avec le même numéro ---- */
      if (!dejaExpediee) {
        await prisma.returnCase.updateMany({
          where: { id: { in: ids }, reshippedAt: null },
          data: { reshipTrackingNumber: suivi, reshipCarrier: transporteur, reshippedAt: new Date() },
        });
        await recordAudit({
          merchantId: agence.merchantId,
          actorType: 'SUPPLIER',
          actorId: `agence:${agence.id}`,
          action: 'agency.reshipped',
          targetType: 'order',
          targetId: parsed.data.orderId,
          metadata: { orderName, trackingNumber: suivi, carrier: transporteur },
          ipAddress: request.ip,
        });
      }

      const shopify = await tenterExpedition(client, parsed.data.orderId, suivi, transporteur, request.log);
      return reply.send({ expediee: true, shopify });
    },
  );

  /**
   * L'agence a envoyé une paire d'ÉCHANGE : son numéro de suivi.
   *
   * Rien ne part chez Shopify : un échange n'est pas une commande, il n'y a
   * aucune expédition à créer et donc aucun e-mail automatique. Le numéro
   * remonte au marchand, qui préviendra son client lui-même — c'est lui qui
   * sait par quel canal ce client-là veut être joint.
   */
  app.post<{ Params: { id: string }; Querystring: { token?: string } }>(
    '/api/agence/:id/echanges',
    async (request, reply) => {
      const agence = await autoriser(request, reply);
      if (!agence) return;

      const parsed = z
        .object({
          caseId: z.string().min(1).max(120),
          trackingNumber: z.string().trim().min(3).max(80),
          carrier: z.string().max(80).nullish(),
        })
        .safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ code: 'invalide', error: 'Numéro de suivi invalide.' });

      const suivi = parsed.data.trackingNumber.replace(/\s+/g, '');
      if (abimeParExcel(suivi)) {
        return reply.code(400).send({ code: 'abime_excel', error: 'Numéro abîmé par Excel : retapez-le en texte.' });
      }
      const brut = parsed.data.carrier?.trim() || null;
      const transporteur = brut && !ADRESSE_WEB.test(brut) ? brut : null;

      // Seuls les échanges servis par une paire de CETTE agence : c'est la
      // paire réservée, et elle seule, qui donne le droit d'écrire ici.
      const paire = await prisma.returnCase.findFirst({
        where: { merchantId: agence.merchantId, agencyId: agence.id, reusedReturnCaseId: parsed.data.caseId },
        select: { id: true },
      });
      if (!paire) {
        return reply.code(404).send({ code: 'introuvable', error: 'Cet échange n’est pas confié à votre agence.' });
      }

      // Un numéro corrigé efface la notification : le marchand doit renvoyer
      // le bon à son client, et son écran le lui redemandera.
      await prisma.returnCase.update({
        where: { id: parsed.data.caseId },
        data: {
          exchangeTrackingNumber: suivi,
          exchangeCarrier: transporteur,
          exchangeShippedAt: new Date(),
          exchangeNotifiedAt: null,
        },
      });

      await recordAudit({
        merchantId: agence.merchantId,
        actorType: 'SUPPLIER',
        actorId: `agence:${agence.id}`,
        action: 'agency.exchange_shipped',
        targetType: 'return',
        targetId: parsed.data.caseId,
        metadata: { trackingNumber: suivi, carrier: transporteur, paire: paire.id },
        ipAddress: request.ip,
      });

      return reply.send({ envoye: true });
    },
  );
}
