import { prisma } from '../../lib/prisma.ts';

/**
 * Les commandes servies par le stock retours.
 *
 * Une commande confiée à une paire retournée part de l'agence, pas de
 * l'atelier : si l'atelier l'expédiait aussi, le client recevrait deux paires
 * et le marchand paierait deux fois. Ces commandes disparaissent donc de sa
 * liste et de ses exports, et ses saisies sur elles sont refusées.
 *
 * `ids` restreint la recherche aux commandes qu'on s'apprête à montrer.
 */
export async function commandesServiesParLeStock(merchantId: string, ids?: readonly string[]): Promise<Set<string>> {
  if (ids && ids.length === 0) return new Set();

  const lignes = await prisma.returnCase.findMany({
    where: {
      merchantId,
      reusedShopifyOrderId: ids ? { in: [...ids] } : { not: null },
    },
    select: { reusedShopifyOrderId: true },
  });

  return new Set(lignes.map((ligne) => ligne.reusedShopifyOrderId).filter((id): id is string => Boolean(id)));
}
