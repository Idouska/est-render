/**
 * Ce qui compose la fiche d'un client, au-delà de son adresse email.
 *
 * La fiche partait d'une seule question posée à Shopify — « quelles commandes
 * portent cette adresse ? » — et s'effondrait quand la réponse était vide.
 * Or elle l'est souvent : le client écrit depuis un relais iCloud, depuis
 * l'adresse de son compte PayPal, ou depuis une seconde boîte. On voyait
 * alors « Aucune commande à cette adresse » sur une fiche dont le message
 * d'à côté citait la commande, ni colis, ni suivi, ni montant dépensé.
 *
 * Les tickets, eux, portent déjà le rattachement — fait par l'outil ou
 * confirmé par un agent. C'est une seconde source, plus fiable que la
 * recherche par email, et c'est celle qu'on croise ici.
 */

interface TicketRef {
  shopifyOrderId: string | null;
  orderName: string | null;
}

/**
 * Commandes citées par les messages du client et absentes de la recherche par
 * email — à récupérer une par une chez Shopify.
 *
 * Bornée : un client bavard sur trente commandes ne doit pas déclencher
 * trente appels pour ouvrir une fiche. Les plus récentes suffisent, ce sont
 * celles dont on parle.
 */
export function missingOrderIds(
  tickets: TicketRef[],
  knownOrderIds: string[],
  limit = 10,
): string[] {
  const known = new Set(knownOrderIds);

  return [
    ...new Set(
      tickets
        .map((ticket) => ticket.shopifyOrderId)
        .filter((id): id is string => Boolean(id) && !known.has(id as string)),
    ),
  ].slice(0, limit);
}

/**
 * Tous les numéros de commande rattachés à ce client, quelle qu'en soit la
 * source : ceux que Shopify a rendus, et ceux que portent ses messages.
 *
 * Sert à retrouver colis et retours, que le fournisseur et l'agence
 * n'identifient que par ce numéro — jamais par un identifiant Shopify.
 */
export function customerOrderNames(
  orders: Array<{ name: string }>,
  tickets: TicketRef[],
): string[] {
  return [
    ...new Set(
      [...orders.map((order) => order.name), ...tickets.map((ticket) => ticket.orderName)].filter(
        (name): name is string => Boolean(name),
      ),
    ),
  ];
}
