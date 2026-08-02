import type { OrderMatchMethod } from '@prisma/client';
import { getOrderById, quoteSearchValue, searchOrders, type OrderSummary } from '../shopify/orders.ts';
import type { ShopifyClient } from '../shopify/client.ts';

export type OrderMatch =
  | {
      status: 'MATCHED';
      order: OrderSummary;
      method: OrderMatchMethod;
      score: number;
    }
  | {
      status: 'AMBIGUOUS';
      candidates: OrderSummary[];
      method: OrderMatchMethod;
    }
  | { status: 'NOT_FOUND' };

/**
 * Repère les numéros de commande cités dans le mail.
 *
 * Volontairement conservateur : on ne retient que les formes explicites
 * (`#1042`, `commande 1042`, `order #1042`). Un nombre isolé dans une phrase
 * n'est pas un numéro de commande — mieux vaut ne rien trouver que se tromper.
 */
export function extractOrderNumbers(text: string): string[] {
  const found = new Set<string>();

  const patterns = [
    /#\s?(\d{3,10})\b/g,
    /\b(?:commande|cmd|order|bestellung|pedido)\s*(?:n[°ºo]?\s*|number\s*|no\.?\s*|#\s*)?(\d{3,10})\b/gi,
  ];

  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      if (match[1]) found.add(match[1]);
    }
  }

  return [...found];
}

const MAX_DAYS_FOR_NAME_FALLBACK = 60;

/**
 * Associe un mail à une commande Shopify.
 *
 * Trois stratégies, de la plus fiable à la moins fiable. On ne renvoie
 * `MATCHED` que lorsque le rattachement est unique et vérifiable ; sinon
 * `AMBIGUOUS` (le dashboard demandera à l'agent de trancher, ou le brouillon
 * demandera une précision au client) ou `NOT_FOUND`. Aucun choix implicite
 * entre plusieurs candidats plausibles.
 */
export async function matchOrder(
  client: ShopifyClient,
  input: {
    customerEmail: string;
    customerName?: string | null;
    bodyText: string;
    receivedAt: Date;
  },
): Promise<OrderMatch> {
  // 1. Numéro de commande cité explicitement, recoupé avec l'email expéditeur.
  const numbers = extractOrderNumbers(input.bodyText);

  for (const number of numbers) {
    const orders = await searchOrders(client, `name:${quoteSearchValue(`#${number}`)}`, 5);
    const exact = orders.filter((order) => order.name.replace(/^#/, '') === number);

    if (exact.length === 1) {
      const order = exact[0]!;
      const emailMatches =
        order.customer?.email?.toLowerCase() === input.customerEmail.toLowerCase();
      return {
        status: 'MATCHED',
        order,
        method: 'ORDER_NUMBER_IN_BODY',
        // Numéro cité + email correspondant = quasi-certitude ; numéro seul,
        // c'est déclaratif (le client peut se tromper de commande).
        score: emailMatches ? 0.99 : 0.8,
      };
    }

    if (exact.length > 1) {
      return { status: 'AMBIGUOUS', candidates: exact, method: 'ORDER_NUMBER_IN_BODY' };
    }
  }

  // 2. Email de l'expéditeur.
  const byEmail = await searchOrders(
    client,
    `email:${quoteSearchValue(input.customerEmail)}`,
    10,
  );

  if (byEmail.length === 1) {
    return { status: 'MATCHED', order: byEmail[0]!, method: 'CUSTOMER_EMAIL', score: 0.95 };
  }

  if (byEmail.length > 1) {
    const open = byEmail.filter(
      (order) => (order.displayFulfillmentStatus ?? '').toUpperCase() !== 'FULFILLED',
    );

    // Une seule commande encore en cours parmi plusieurs : c'est presque
    // certainement celle dont le client parle.
    if (open.length === 1) {
      return { status: 'MATCHED', order: open[0]!, method: 'CUSTOMER_EMAIL', score: 0.85 };
    }

    return { status: 'AMBIGUOUS', candidates: byEmail.slice(0, 5), method: 'CUSTOMER_EMAIL' };
  }

  // 3. Repli sur nom + fenêtre temporelle récente. Score volontairement bas :
  //    ce chemin ne doit jamais autoriser un envoi automatique.
  if (input.customerName && input.customerName.trim().length >= 3) {
    const since = new Date(
      input.receivedAt.getTime() - MAX_DAYS_FOR_NAME_FALLBACK * 24 * 60 * 60 * 1000,
    );
    const query = `${quoteSearchValue(input.customerName)} AND created_at:>${since
      .toISOString()
      .slice(0, 10)}`;
    const byName = await searchOrders(client, query, 5);

    if (byName.length === 1) {
      return {
        status: 'MATCHED',
        order: byName[0]!,
        method: 'NAME_AND_RECENT_DATE',
        score: 0.5,
      };
    }
    if (byName.length > 1) {
      return { status: 'AMBIGUOUS', candidates: byName, method: 'NAME_AND_RECENT_DATE' };
    }
  }

  return { status: 'NOT_FOUND' };
}

/** Rattachement manuel depuis le dashboard (l'agent a tranché lui-même). */
export async function attachOrderManually(
  client: ShopifyClient,
  orderId: string,
): Promise<OrderSummary | null> {
  return getOrderById(client, orderId);
}
