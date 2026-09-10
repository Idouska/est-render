import type { FastifyInstance } from 'fastify';

import { prisma } from '../lib/prisma.ts';
import { requireSession } from '../plugins/auth.ts';
import { getShopifyClient, ShopifyError } from '../services/shopify/client.ts';
import { listOrders, quoteSearchValue } from '../services/shopify/orders.ts';
import { fournisseurDuFil, lireArticle } from '../services/suppliers/signalement.ts';
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

    /* Les deux sources, comme la page : les escalades non résolues, et les
       signalements d'atelier dont le ticket n'est pas clos. Ne compter que les
       premières ferait afficher « 2 » dans le menu au-dessus d'une page qui en
       montre 9 — les sept signalés par l'atelier. */
    const [escalades, signalements] = await Promise.all([
      prisma.supplierEscalation.count({
        where: { merchantId, reason: 'OUT_OF_STOCK', status: { not: 'RESOLVED' } },
      }),
      prisma.ticket.count({
        where: {
          merchantId,
          gmailThreadId: { startsWith: 'supplier:', endsWith: ':STOCK' },
          status: { notIn: ['CLOSED', 'AUTO_SENT'] },
        },
      }),
    ]);

    return reply.send({ ouverts: escalades + signalements });
  });

  app.get('/api/ruptures', async (request, reply) => {
    const { merchantId } = request.session;

    /*
     * DEUX SOURCES, UNE SEULE LISTE.
     *
     * Les signalements de l'atelier d'abord, parce que c'est lui qui sait :
     * c'est le préparateur qui voit, carton en main, que la taille 38 n'y est
     * pas. Le marchand n'apprend une rupture que par lui. Une console qui ne
     * lirait que les escalades du marchand resterait vide pendant que les
     * vrais signalements s'entassent dans SAV client parmi le courrier.
     *
     * Les escalades ensuite : les cas où le marchand a demandé au fournisseur
     * si un article était disponible.
     */
    const [signalements, escalations] = await Promise.all([
      prisma.ticket.findMany({
        where: {
          merchantId,
          // `supplier:<fournisseur>:<commande>:STOCK` — la clé que pose la
          // route de signalement. Préfixe ET suffixe : le motif isole les
          // ruptures des adresses fausses et des articles abîmés.
          gmailThreadId: { startsWith: 'supplier:', endsWith: ':STOCK' },
        },
        orderBy: { createdAt: 'desc' },
        take: 200,
        select: {
          id: true,
          gmailThreadId: true,
          orderName: true,
          shopifyOrderId: true,
          orderTotal: true,
          customerEmail: true,
          status: true,
          createdAt: true,
          messages: {
            where: { direction: 'INBOUND' },
            orderBy: { receivedAt: 'asc' },
            take: 1,
            select: { bodyText: true },
          },
        },
      }),
      prisma.supplierEscalation.findMany({
        where: { merchantId, reason: 'OUT_OF_STOCK' },
        orderBy: { createdAt: 'desc' },
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
           * `FROM_SUPPLIER`, et non `INBOUND` : un fil fournisseur n'a pas les
           * mêmes sens de circulation qu'un fil client. Se tromper
           * d'énumération ici fait retomber Prisma sur le type par défaut, et
           * ce sont les RELATIONS qui paraissent disparaître, plus bas.
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
            },
          },
        },
      }),
    ]);

    if (signalements.length === 0 && escalations.length === 0) {
      return reply.send({
        dossiers: [],
        kpis: kpisRuptures([]),
        compteurs: compteursVues([]),
        shopifyError: null,
      });
    }

    /* Le nom de l'atelier qui a signalé : il n'est pas sur le ticket, dont le
       champ « client » porte d'ailleurs le nom de l'atelier lui-même. */
    const idsAteliers = [
      ...new Set(
        signalements
          .map((ticket) => fournisseurDuFil(ticket.gmailThreadId))
          .filter((id): id is string => id !== null),
      ),
    ];
    const ateliers = new Map(
      (idsAteliers.length
        ? await prisma.supplier.findMany({
            where: { merchantId, id: { in: idsAteliers } },
            select: { id: true, name: true, contactEmail: true, phone: true },
          })
        : []
      ).map((atelier) => [atelier.id, atelier]),
    );

    const ticketIds = [
      ...signalements.map((ticket) => ticket.id),
      ...escalations.map((escalade) => escalade.ticketId),
    ];

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
     * Les commandes, en une requête pour les deux sources.
     *
     * Shopify accepte `name:"#12207" OR name:"#12686"`. Borné à cinquante
     * noms : au-delà, la requête devient assez longue pour être refusée, et
     * les dossiers suivants s'affichent sans détail produit — ce que l'écran
     * sait dire.
     */
    const noms = [
      ...new Set(
        [
          ...signalements.map((ticket) => ticket.orderName),
          ...escalations.map((escalade) => escalade.ticket.orderName),
        ].filter((nom): nom is string => Boolean(nom)),
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

    const commandeDe = (nom: string | null) => (nom ? (commandes.get(nom) ?? null) : null);

    /*
     * Pour une escalade, l'article est deviné : le modèle ne stocke pas quelle
     * ligne de la commande l'a déclenchée, et la plus chère est retenue.
     */
    const lignePlusChere = (nom: string | null) => {
      const commande = commandeDe(nom);
      if (!commande?.lineItems?.length) return null;
      return [...commande.lineItems].sort(
        (a, b) => Number(b.price ?? 0) - Number(a.price ?? 0),
      )[0]!;
    };

    /*
     * Pour un signalement, l'article n'est PAS deviné : l'atelier a écrit
     * lequel. On le relit, et l'on ne retrouve la ligne de commande — donc sa
     * photo — que si la référence déclarée y figure. Afficher la photo de la
     * ligne la plus chère à côté de la taille déclarée pourrait montrer une
     * autre chaussure que celle qui manque : mieux vaut pas de photo.
     */
    const articleSignale = (ticket: (typeof signalements)[number]) => {
      const declare = lireArticle(ticket.messages[0]?.bodyText);
      const commande = commandeDe(ticket.orderName);
      const ligne =
        declare.reference && commande?.lineItems
          ? (commande.lineItems.find((item) => item.sku === declare.reference) ?? null)
          : null;

      const titre = declare.produit ?? ligne?.title ?? null;
      if (!titre && !declare.reference && !declare.taille) return { declare, article: null };

      return {
        declare,
        article: {
          titre: titre ?? 'Article non précisé',
          sku: declare.reference ?? ligne?.sku ?? null,
          variante:
            [declare.couleur, declare.taille].filter(Boolean).join(' · ') ||
            ligne?.variantTitle ||
            null,
          quantite: declare.quantite ?? ligne?.quantity ?? 1,
          image: ligne?.image ?? null,
        },
      };
    };

    const montant = (valeur: unknown) => (valeur === null || valeur === undefined ? null : Number(valeur));

    // Les dossiers bruts, pour les jugements — états, priorité, compteurs.
    const lusSignalements = signalements.map((ticket) => ({ ticket, ...articleSignale(ticket) }));

    const bruts: DossierRupture[] = [
      ...lusSignalements.map(({ ticket, article }) => ({
        id: ticket.id,
        ticketId: ticket.id,
        origine: 'atelier' as const,
        // Un signalement n'a pas de statut d'escalade : il est ouvert tant que
        // le ticket n'est pas clos, résolu ensuite.
        statut: (ticket.status === 'CLOSED' || ticket.status === 'AUTO_SENT'
          ? 'RESOLVED'
          : 'OPEN') as DossierRupture['statut'],
        creeLe: ticket.createdAt,
        notifieLe: null,
        // Aucune date de clôture fiable sur un ticket : `updatedAt` bouge à la
        // moindre écriture. Le délai de résolution ne compte donc que les
        // escalades, qui en ont une — plutôt qu'un délai faux.
        resoluLe: null,
        reponseFournisseurLe: null,
        reponseClientLe: reponduLe.get(ticket.id) ?? null,
        rembourse: rembourses.has(ticket.id),
        sku: article?.sku ?? null,
        montant: montant(ticket.orderTotal),
      })),
      ...escalations.map((escalade) => ({
        id: escalade.id,
        ticketId: escalade.ticketId,
        origine: 'marchand' as const,
        statut: escalade.status,
        creeLe: escalade.createdAt,
        notifieLe: escalade.notifiedAt,
        resoluLe: escalade.resolvedAt,
        reponseFournisseurLe: escalade.messages[0]?.createdAt ?? null,
        reponseClientLe: reponduLe.get(escalade.ticketId) ?? null,
        rembourse: rembourses.has(escalade.ticketId),
        sku: lignePlusChere(escalade.ticket.orderName)?.sku ?? null,
        // `orderTotal` est un Decimal Prisma : le comparer à 200 sans conversion
        // compare un objet à un nombre, ce que JavaScript accepte en silence.
        montant: montant(escalade.ticket.orderTotal),
      })),
    ];

    const parSku = commandesParSku(bruts);
    const maintenant = Date.now();
    const impact = (brut: DossierRupture) => (brut.sku ? (parSku.get(brut.sku) ?? 1) : 1);

    const dossiers = [
      ...lusSignalements.map(({ ticket, article, declare }, rang) => {
        const brut = bruts[rang]!;
        const commande = commandeDe(ticket.orderName);
        const atelier = ateliers.get(fournisseurDuFil(ticket.gmailThreadId) ?? '') ?? null;
        // Le champ « client » du ticket porte le nom de l'atelier : le vrai
        // client se lit sur la commande Shopify.
        const emailClient = ticket.customerEmail.startsWith('fournisseur+')
          ? null
          : ticket.customerEmail;

        return {
          id: ticket.id,
          ticketId: ticket.id,
          origine: 'atelier' as const,
          etat: etatDossier(brut),
          priorite: prioriteDossier(brut, impact(brut), maintenant),
          creeLe: ticket.createdAt,
          notifieLe: null,
          resoluLe: null,
          reponseFournisseurLe: null,
          // Pas de note d'escalade : la parole de l'atelier est dans `signalement`.
          note: null,
          client: {
            nom: commande?.customer?.displayName ?? null,
            email: emailClient ?? commande?.customer?.email ?? null,
            telephone: commande?.shippingAddress?.phone ?? null,
          },
          commande: {
            nom: ticket.orderName,
            shopifyId: ticket.shopifyOrderId,
            total: montant(ticket.orderTotal),
            devise: commande?.currency ?? null,
            creeLe: commande?.createdAt ?? null,
          },
          article,
          declare,
          signalement: ticket.messages[0]?.bodyText ?? null,
          commandesImpactees: impact(brut),
          fournisseur: atelier,
          synthese: syntheseDossier({
            dossier: brut,
            produit: article?.titre ?? null,
            fournisseur: atelier?.name ?? null,
            commandesImpactees: impact(brut),
            maintenant,
          }),
        };
      }),
      ...escalations.map((escalade, rang) => {
        const brut = bruts[lusSignalements.length + rang]!;
        const ligne = lignePlusChere(escalade.ticket.orderName);
        const commande = commandeDe(escalade.ticket.orderName);

        return {
          id: escalade.id,
          ticketId: escalade.ticketId,
          origine: 'marchand' as const,
          etat: etatDossier(brut),
          priorite: prioriteDossier(brut, impact(brut), maintenant),
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
            total: montant(escalade.ticket.orderTotal),
            devise: commande?.currency ?? null,
            creeLe: commande?.createdAt ?? null,
          },
          article: ligne
            ? {
                titre: ligne.title,
                sku: ligne.sku,
                variante: ligne.variantTitle,
                quantite: ligne.quantity,
                image: ligne.image,
              }
            : null,
          declare: null,
          signalement: null,
          commandesImpactees: impact(brut),
          fournisseur: escalade.supplier,
          synthese: syntheseDossier({
            dossier: brut,
            produit: ligne?.title ?? null,
            fournisseur: escalade.supplier?.name ?? null,
            commandesImpactees: impact(brut),
            maintenant,
          }),
        };
      }),
    ];

    return reply.send({
      dossiers,
      kpis: kpisRuptures(bruts),
      compteurs: compteursVues(bruts),
      /** Nommé plutôt que masqué : l'écran affiche ce qui manque, et pourquoi. */
      shopifyError,
    });
  });
}
