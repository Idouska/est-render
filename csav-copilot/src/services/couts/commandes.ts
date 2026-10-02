import type { ShopifyClient } from '../shopify/client.ts';
import { bornesDuMois } from '../suppliers/releve.ts';

/**
 * Combien de commandes chaque mois : de quoi rapporter le coût du SAV à la
 * commande, et les retours au volume vendu.
 *
 * Shopify ne montre que les soixante derniers jours de commandes, sauf
 * autorisation `read_all_orders`. Un mois commencé avant n'est pas demandé :
 * son compte serait tronqué, et le taux de retour faux — faux en mieux, la
 * pire erreur pour un chiffre qu'on surveille.
 */

export const JOURS_VISIBLES = 60;

export function moisVisibles(mois: readonly string[], maintenant: Date, toutVoir: boolean): string[] {
  if (toutVoir) return [...mois];
  const limite = maintenant.getTime() - JOURS_VISIBLES * 86_400_000;
  return mois.filter((m) => (bornesDuMois(m)?.debut.getTime() ?? 0) >= limite);
}

export function filtreDuMois(mois: string): string {
  const { debut, fin } = bornesDuMois(mois)!;
  return `created_at:>='${debut.toISOString()}' created_at:<'${fin.toISOString()}'`;
}

/** Un alias par mois : une seule requête, quel que soit le nombre de mois. */
export function requeteDesComptes(nombre: number): string {
  const parametres = Array.from({ length: nombre }, (_, i) => `$q${i}: String!`).join(', ');
  const champs = Array.from({ length: nombre }, (_, i) => `  m${i}: ordersCount(query: $q${i}) { count precision }`).join('\n');
  return `query CommandesParMois(${parametres}) {\n${champs}\n}`;
}

export async function commandesParMois(client: ShopifyClient, mois: readonly string[]): Promise<Record<string, number>> {
  if (mois.length === 0) return {};
  const variables = Object.fromEntries(mois.map((m, i) => [`q${i}`, filtreDuMois(m)]));
  const data = await client.request<Record<string, { count: number; precision: string } | null>>(
    requeteDesComptes(mois.length),
    variables,
  );
  const comptes: Record<string, number> = {};
  mois.forEach((m, i) => {
    const compte = data[`m${i}`];
    // « Au moins » : Shopify a cessé de compter. Un taux calculé dessus serait faux.
    if (compte && compte.precision === 'EXACT') comptes[m] = compte.count;
  });
  return comptes;
}
