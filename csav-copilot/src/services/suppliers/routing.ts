import type { OrderSummary } from '../shopify/orders.ts';

/**
 * Affectation d'une commande à un fournisseur.
 *
 * Jusqu'ici une commande n'était « confiée » qu'après un geste humain :
 * une escalade envoyée, un colis saisi. Le fournisseur ouvrait donc son atelier
 * sur une page vide tant que personne n'avait rien fait — exactement l'inverse
 * de ce qu'on attend d'un plan de travail du matin.
 *
 * Or l'information existe déjà dans la commande. La marque de l'article dit
 * quel atelier le fabrique ; le préfixe de référence dit la même chose quand
 * plusieurs marques passent par le même. On lit donc la commande au lieu de
 * demander qu'on la saisisse.
 *
 * Trois règles, dans cet ordre :
 *   1. une marque de la commande figure dans la liste du fournisseur ;
 *   2. une référence commence par l'un de ses préfixes ;
 *   3. le fournisseur est celui « par défaut » et aucune règle d'un autre
 *      fournisseur ne réclame la commande.
 *
 * La troisième compte autant que les deux premières : sans elle, une commande
 * dont la marque n'a été déclarée nulle part n'apparaîtrait dans aucun atelier
 * et personne ne l'expédierait — la panne la plus coûteuse et la plus
 * silencieuse qui soit.
 */

export interface RoutingRules {
  id: string;
  vendors: string[];
  skuPrefixes: string[];
  isDefault: boolean;
}

function normalize(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

/** Un fournisseur sans aucune règle ne réclame rien : il ne capte pas tout. */
export function hasRules(rules: RoutingRules): boolean {
  return rules.vendors.length > 0 || rules.skuPrefixes.length > 0;
}

export function matchesSupplier(order: OrderSummary, rules: RoutingRules): boolean {
  const vendors = rules.vendors.map(normalize).filter(Boolean);
  const prefixes = rules.skuPrefixes.map(normalize).filter(Boolean);

  return order.lineItems.some((item) => {
    const vendor = normalize(item.vendor);
    const sku = normalize(item.sku);

    return (
      (vendor !== '' && vendors.includes(vendor)) ||
      (sku !== '' && prefixes.some((prefix) => sku.startsWith(prefix)))
    );
  });
}

/**
 * Les commandes visibles par un fournisseur, règles comprises.
 *
 * `explicit` sont celles qu'un humain lui a confiées (escalade ou colis) :
 * elles restent visibles quoi qu'en disent les règles, parce qu'un geste
 * délibéré doit toujours l'emporter sur un automatisme.
 */
export function ordersForSupplier(
  orders: OrderSummary[],
  supplier: RoutingRules,
  others: RoutingRules[],
  explicit: string[],
): OrderSummary[] {
  const claimed = new Set(explicit);

  return orders.filter((order) => {
    if (claimed.has(order.id)) return true;
    if (hasRules(supplier) && matchesSupplier(order, supplier)) return true;

    // Atelier par défaut : il prend ce que personne d'autre ne réclame.
    if (supplier.isDefault) {
      return !others.some((other) => hasRules(other) && matchesSupplier(order, other));
    }

    return false;
  });
}
