import type { FastifyInstance } from 'fastify';

import { prisma } from '../lib/prisma.ts';
import { requireSession } from '../plugins/auth.ts';
import { getShopifyClient, ShopifyError } from '../services/shopify/client.ts';
import { listOrders, quoteSearchValue } from '../services/shopify/orders.ts';
import {
  commandesParSku,
  compteursVues,
  etatDossier,
  kpisRuptures,
  prioriteDossier,
  syntheseDossier,
  type DossierRupture,
} from '../services/ruptures/console.ts';

/**
 * La console des ruptures de stock.
 *
 * Une rupture n'est pas une intention de mail : c'est une escalade fournisseur
 * portant `reason: OUT_OF_STOCK`. Cette route ne crée donc aucun objet — elle
 * relit ce que l'escalade, le ticket et la commande disent déjà, et les
 * présente comme un poste de travail plutôt que comme une liste de tickets.
 *
 * UN SEUL APPEL SHOPIFY POUR TOUTE LA PAGE. La tentation serait de demander
 * chaque commande à Shopify pour connaître l'article et son SKU : vingt-cinq
 * lignes, vingt-cinq allers-retours, et une page qui met huit secondes à
 * s'afficher. Les commandes sont donc cherchées d'un coup par leurs noms.
 *
 * ET SI SHOPIFY NE RÉPOND PAS, LA PAGE S'AFFICHE QUAND MÊME. Les dossiers,
 * les états, les fournisseurs et l'historique viennent de notre base : ils
 * n'ont pas à disparaître parce que le catalogue est injoignable. Ce qui
 * manque est nommé, pas masqué.
 */
export async function ruptureRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireSession);

  /**
   * Le chiffre de la pastille, et rien d'autre.
   *
   * La navigation le relève toutes les minutes : passer par `/api/ruptures`
   * appellerait Shopify à chaque relève, pour ne garder qu'un entier. Un
   * comptage en base suffit, et il compte la même chose que l'onglet
   * « Tous » — les dossiers non résolus. Si les deux divergeaient, la pastille
   * annoncerait « 12 » et la page en montrerait 9, et c'est la page qu'on
   * accuserait.
   */
  app.get('/api/ruptures/compte', async (request, reply) => {
    const { merchantId } = request.session;

    const ouverts = await prisma.supplierEscalation.count({
      where: { merchantId, reason: 'OUT_OF_STOCK', status: { not: 'RESOLVED' } },
    });

    return reply.send({ ouverts });
  });

  app.get('/api/ruptures', async (request, reply) => {
    const { merchantId } = request.session;

    const escalations = await prisma.supplierEscalation.findMany({
      where: { merchantId, reason: 'OUT_OF_STOCK' },
      orderBy: { createdAt: 'desc' },
      // Assez pour couvrir la console sans rapatrier l'historique entier d'un
      // marchand actif. La pagination se fait dans la page, sur ce lot.
      take: 200,
      select: {
        id: true,
        ticketId: true,
        status: true,
        note: true,
        createdAt: true,
        notifiedAt: true,
        resolvedAt: true,
        supplier: { select: { id: true, name: true, contactEmail: true, phone: true } },
        /*
         * Seulement les dates : le corps des messages fournisseur ne sert pas
         * à la liste, et vingt-cinq fils entiers pèseraient la page.
         *
         * `FROM_SUPPLIER`, et non `INBOUND` : un fil fournisseur n'a pas les
         * mêmes sens de circulation qu'un fil client. Se tromper d'énumération
         * ici ne lève pas une erreur lisible — Prisma retombe sur le type par
         * défaut et ce sont les RELATIONS qui paraissent disparaître, sept
         * lignes plus bas.
         */
        messages: {
          where: { direction: 'FROM_SUPPLIER' },
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { createdAt: true },
        },
        ticket: {
          select: {
            id: true,
            customerName: true,
            customerEmail: true,
            orderName: true,
            shopifyOrderId: true,
            orderTotal: true,
            status: true,
            lastMessageAt: true,
          },
        },
      },
    });

    if (escalations.length === 0) {
      return reply.send({
        dossiers: [],
        kpis: kpisRuptures([]),
        compteurs: compteursVues([]),
        shopifyError: null,
      });
    }

    const ticketIds = escalations.map((escalade) => escalade.ticketId);

    /*
     * Deux lectures pour deux questions que la liste doit trancher.
     *
     * La dernière réponse partie vers le client décide de l'état le plus
     * important de l'écran — « Client à prévenir » — et un remboursement déjà
     * engagé change l'issue du dossier. Regroupées, pas lues fil par fil.
     */
    const [dernieresReponses, remboursements] = await Promise.all([
      prisma.message.groupBy({
        by: ['ticketId'],
        where: { merchantId, ticketId: { in: ticketIds }, direction: 'OUTBOUND' },
        _max: { receivedAt: true },
      }),
      prisma.refund.groupBy({
        by: ['ticketId'],
        where: { merchantId, ticketId: { in: ticketIds }, status: { not: 'FAILED' } },
        _count: true,
      }),
    ]);

    const reponduLe = new Map(
      dernieresReponses.map((ligne) => [ligne.ticketId, ligne._max.receivedAt ?? null]),
    );
    const rembourses = new Set(
      remboursements
        .map((ligne) => ligne.ticketId)
        .filter((id): id is string => typeof id === 'string'),
    );

    /*
     * Les commandes, en une requête.
     *
     * Shopify accepte `name:"#12207" OR name:"#12686"`. Le lot est borné à
     * cinquante noms : au-delà, la requête devient assez longue pour que
     * l'API la refuse, et les dossiers suivants s'afficheront simplement sans
     * détail produit — ce que l'écran sait dire.
     */
    const noms = [
      ...new Set(
        escalations
          .map((escalade) => escalade.ticket.orderName)
          .filter((nom): nom is string => Boolean(nom)),
      ),
    ].slice(0, 50);

    let commandes = new Map<string, Awaited<ReturnType<typeof listOrders>>['orders'][number]>();
    let shopifyError: string | null = null;

    if (noms.length > 0) {
      try {
        const client = await getShopifyClient(merchantId);
        const { orders } = await listOrders(client, {
          query: noms.map((nom) => `name:${quoteSearchValue(nom)}`).join(' OR '),
          limit: noms.length,
        });
        commandes = new Map(orders.map((order) => [order.name, order]));
      } catch (error) {
        shopifyError =
          error instanceof ShopifyError
            ? 'Détail produit indisponible : la boutique Shopify n’a pas répondu.'
            : 'Détail produit indisponible.';
        request.log.warn({ err: error, merchantId }, 'Commandes des ruptures non lues');
      }
    }

    /*
     * L'article en rupture, choisi dans la commande.
     *
     * Une commande porte plusieurs lignes et rien n'indique laquelle a
     * déclenché l'escalade : le modèle ne stocke pas ce lien. La ligne la plus
     * chère est retenue, parce que c'est celle qui décide de la commande — et
     * l'écran ne prétend pas qu'elle est certaine : le panneau montre la
     * commande entière, où l'agent voit les autres articles.
     */
    const articleDe = (nom: string | null) => {
      const commande = nom ? commandes.get(nom) : null;
      if (!commande?.lineItems?.length) return null;

      return [...commande.lineItems].sort(
        (a, b) => Number(b.price ?? 0) - Number(a.price ?? 0),
      )[0]!;
    };

    const bruts: DossierRupture[] = escalations.map((escalade) => ({
      id: escalade.id,
      ticketId: escalade.ticketId,
      statut: escalade.status,
      creeLe: escalade.createdAt,
      notifieLe: escalade.notifiedAt,
      resoluLe: escalade.resolvedAt,
      reponseFournisseurLe: escalade.messages[0]?.createdAt ?? null,
      reponseClientLe: reponduLe.get(escalade.ticketId) ?? null,
      rembourse: rembourses.has(escalade.ticketId),
      sku: articleDe(escalade.ticket.orderName)?.sku ?? null,
      // `orderTotal` est un Decimal Prisma : le comparer à 200 sans conversion
      // compare un objet à un nombre, ce que JavaScript accepte en silence.
      montant: escalade.ticket.orderTotal === null ? null : Number(escalade.ticket.orderTotal),
    }));

    const parSku = commandesParSku(bruts);
    const maintenant = Date.now();

    const dossiers = escalations.map((escalade, rang) => {
      const brut = bruts[rang]!;
      const article = articleDe(escalade.ticket.orderName);
      const commande = escalade.ticket.orderName
        ? (commandes.get(escalade.ticket.orderName) ?? null)
        : null;
      const impactees = brut.sku ? (parSku.get(brut.sku) ?? 1) : 1;

      return {
        id: escalade.id,
        ticketId: escalade.ticketId,
        etat: etatDossier(brut),
        priorite: prioriteDossier(brut, impactees, maintenant),
        creeLe: escalade.createdAt,
        notifieLe: escalade.notifiedAt,
        resoluLe: escalade.resolvedAt,
        reponseFournisseurLe: brut.reponseFournisseurLe,
        note: escalade.note,
        client: {
          nom: escalade.ticket.customerName,
          email: escalade.ticket.customerEmail,
          telephone: commande?.shippingAddress?.phone ?? null,
        },
        commande: {
          nom: escalade.ticket.orderName,
          shopifyId: escalade.ticket.shopifyOrderId,
          total: escalade.ticket.orderTotal === null ? null : Number(escalade.ticket.orderTotal),
          devise: commande?.currency ?? null,
          creeLe: commande?.createdAt ?? null,
        },
        article: article
          ? {
              titre: article.title,
              sku: article.sku,
              variante: article.variantTitle,
              quantite: article.quantity,
              image: article.image,
            }
          : null,
        commandesImpactees: impactees,
        fournisseur: escalade.supplier,
        synthese: syntheseDossier({
          dossier: brut,
          produit: article?.title ?? null,
          fournisseur: escalade.supplier?.name ?? null,
          commandesImpactees: impactees,
          maintenant,
        }),
      };
    });

    return reply.send({
      dossiers,
      kpis: kpisRuptures(bruts),
      compteurs: compteursVues(bruts),
      /** Nommé plutôt que masqué : l'écran affiche ce qui manque, et pourquoi. */
      shopifyError,
    });
  });
}
