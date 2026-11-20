import type { OrderMatchMethod } from '@prisma/client';
import { quoteSearchValue, searchOrders, type OrderSummary } from '../shopify/orders.ts';
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
    // « numéro de commande : 18327 », « commande numéro 18327 », « order number is 18327 »,
    // « n° 18327 », « ref. 18327 » : le mot qui précède dit que c'est un numéro.
    /\b(?:num[ée]ro(?:\s+de\s+(?:la\s+)?commande)?|commande\s+num[ée]ro|order\s+(?:number|no\.?|id)(?:\s+is)?|n[°º]|r[ée]f(?:[ée]rence)?\.?)\s*[:#-]?\s*#?(\d{3,10})\b/gi,
  ];

  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      if (match[1]) found.add(match[1]);
    }
  }

  return [...found];
}

const MAX_DAYS_FOR_NAME_FALLBACK = 180;

/**
 * Les nombres nus du message qui POURRAIENT être un numéro de commande
 * (4 à 7 chiffres, ni année, ni code postal collé à une ville, ni téléphone).
 * Ils ne valent rien seuls : `matchOrder` ne les retient que si la commande
 * existe ET appartient à l'expéditeur — par son email ou par son nom.
 */
export function extractBareNumbers(text: string): string[] {
  const found = new Set<string>();
  for (const match of text.matchAll(/(?<![\d.,/+-])(\d{4,7})(?![\d.,/-]|\s?(?:€|eur|\$|kg|g|cm|mm)\b)/gi)) {
    const n = match[1]!;
    if (/^(?:19|20)\d{2}$/.test(n)) continue;
    found.add(n);
  }
  return [...found].slice(0, 6);
}

const sansAccents = (texte: string) =>
  texte.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** Le nom de la commande et celui de l'expéditeur désignent-ils la même personne ? */
function memeNom(order: OrderSummary, nom: string | null | undefined): boolean {
  const mots = sansAccents(nom ?? '').split(' ').filter((m) => m.length > 1);
  if (mots.length < 2) return false;
  const client = sansAccents(
    [order.customer?.displayName, order.shippingAddress?.name].filter(Boolean).join(' '),
  ).split(' ');
  return mots.every((m) => client.includes(m));
}

/**
 * Le nom tel que le client le signe : la dernière ligne courte du message,
 * deux ou trois mots commençant par une majuscule. Sert quand il écrit depuis
 * une autre adresse que celle de sa commande.
 */
export function extractSignatureName(text: string): string | null {
  const lignes = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(-6).reverse();
  for (const ligne of lignes) {
    if (/^(?:\p{Lu}[\p{L}'’-]+)(?:\s+\p{Lu}[\p{L}'’-]+){1,2}$/u.test(ligne) && !/^(?:Bonjour|Bonsoir|Cordialement|Merci|Bien|Hello|Best|Kind|Regards|Sent|Envoy)/i.test(ligne)) {
      return ligne;
    }
  }
  return null;
}

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
    /** L'objet du mail : le numéro y est souvent, et nulle part ailleurs. */
    subject?: string | null;
    /** Les messages précédents du client dans la même conversation. */
    earlierText?: string | null;
  },
): Promise<OrderMatch> {
  // Tout ce que le client a écrit : l'objet, ce message, puis les précédents.
  const texte = [input.subject, input.bodyText, input.earlierText].filter(Boolean).join('\n');
  const signature = extractSignatureName(input.bodyText);
  const noms = [...new Set([input.customerName, signature].flatMap((n) => (n && n.trim().length >= 3 ? [n.trim()] : [])))];

  // 1. Numéro de commande cité explicitement, recoupé avec l'email expéditeur.
  const numbers = extractOrderNumbers(texte);

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

  // 1 bis. Un nombre nu (« ma commande 18327 est… » écrit autrement, ou le
  //        numéro seul dans l'objet) : retenu seulement si la commande existe
  //        et qu'elle est bien à l'expéditeur, par son email ou par son nom.
  for (const number of extractBareNumbers(texte).filter((n) => !numbers.includes(n))) {
    const orders = await searchOrders(client, `name:${quoteSearchValue(`#${number}`)}`, 5);
    const siennes = orders.filter(
      (order) =>
        order.name.replace(/^#/, '') === number &&
        (order.customer?.email?.toLowerCase() === input.customerEmail.toLowerCase() || noms.some((nom) => memeNom(order, nom))),
    );
    if (siennes.length === 1) {
      return { status: 'MATCHED', order: siennes[0]!, method: 'ORDER_NUMBER_IN_BODY', score: 0.9 };
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

    // Plusieurs commandes, aucune désignée : la plus récente (elles arrivent
    // triées), avec un score bas qui dit que c'est un choix par défaut.
    // L'agent voit ainsi la fiche et les autres commandes du client, au lieu
    // d'une colonne vide ; il change de commande d'un clic si ce n'est pas elle.
    return { status: 'MATCHED', order: (open[0] ?? byEmail[0])!, method: 'CUSTOMER_EMAIL', score: 0.6 };
  }

  // 3. Repli sur nom + fenêtre temporelle récente. Score volontairement bas :
  //    ce chemin ne doit jamais autoriser un envoi automatique.
  //    Le nom de l'expéditeur, puis celui qu'il signe : un client écrit
  //    souvent depuis une autre adresse que celle de sa commande.
  const since = new Date(input.receivedAt.getTime() - MAX_DAYS_FOR_NAME_FALLBACK * 24 * 60 * 60 * 1000);
  for (const nom of noms) {
    const query = `${quoteSearchValue(nom)} AND created_at:>${since.toISOString().slice(0, 10)}`;
    const byName = (await searchOrders(client, query, 5)).filter((order) => memeNom(order, nom));

    if (byName.length === 1) {
      return { status: 'MATCHED', order: byName[0]!, method: 'NAME_AND_RECENT_DATE', score: 0.5 };
    }
    if (byName.length > 1) {
      // Même personne, plusieurs commandes : la plus récente par défaut.
      const memeClient = new Set(byName.map((order) => order.customer?.email?.toLowerCase() ?? order.id)).size === 1;
      if (memeClient) return { status: 'MATCHED', order: byName[0]!, method: 'NAME_AND_RECENT_DATE', score: 0.4 };
      return { status: 'AMBIGUOUS', candidates: byName, method: 'NAME_AND_RECENT_DATE' };
    }
  }

  return { status: 'NOT_FOUND' };
}

/**
 * Commande à relire avant de relancer le matcher, s'il y en a une.
 *
 * Le matcher est rejouable, le jugement d'un agent ne l'est pas : quand
 * quelqu'un a rattaché une commande à la main, c'est qu'il est allé chercher
 * ce que le matcher n'avait pas su trouver. Le relancer par-dessus
 * remplacerait ce renseignement par l'échec qui l'avait rendu nécessaire.
 *
 * Renvoyer l'identifiant plutôt qu'un booléen laisse l'appelant vérifier que
 * la commande existe encore : une commande supprimée chez Shopify rend
 * légitimement la main au matcher.
 */
export function manuallyAttachedOrderId(ticket: {
  orderMatchMethod: OrderMatchMethod | null;
  shopifyOrderId: string | null;
}): string | null {
  return ticket.orderMatchMethod === 'MANUAL' ? ticket.shopifyOrderId : null;
}

/**
 * Colonnes de rattachement à écrire au terme d'un passage.
 *
 * `match` vaut `null` quand le matcher n'a pas tourné, faute d'avoir eu son
 * mot à dire : on n'écrit alors aucune de ces colonnes, pour ne pas écraser
 * d'un `null` calculé le choix d'un agent. Écrire « rien » et écrire
 * « aucune commande » sont deux choses différentes, et les confondre est
 * exactement ce qui effaçait les rattachements manuels.
 */
export function matchColumns(
  match: OrderMatch | null,
  order: OrderSummary | null,
): {
  shopifyOrderId?: string | null;
  orderName?: string | null;
  orderMatchMethod?: OrderMatchMethod | null;
  orderMatchScore?: number | null;
} {
  if (!match) return {};

  return {
    shopifyOrderId: order?.id ?? null,
    orderName: order?.name ?? null,
    orderMatchMethod: match.status === 'NOT_FOUND' ? null : match.method,
    orderMatchScore: match.status === 'MATCHED' ? match.score : null,
  };
}
