import type { gmail_v1 } from 'googleapis';

/**
 * Libellés Gmail d'un message, en clair.
 *
 * Gmail rend des identifiants (`Label_12`), pas des noms : il faut la table de
 * correspondance de la boîte, qui ne change presque jamais — d'où le cache par
 * boîte plutôt qu'un appel par message.
 *
 * Seuls les libellés créés par le marchand sont retenus. `INBOX`, `UNREAD`,
 * `IMPORTANT` et les `CATEGORY_*` décrivent l'état de lecture ou le classement
 * automatique de Google : les afficher noierait les vraies étiquettes — celles
 * qui disent « Litige », « Fournisseur », « À rembourser » — sous du bruit
 * système.
 */

/** Un libellé tel que Gmail le décrit : son nom et ses couleurs. */
export interface GmailLabel {
  name: string;
  /** Fond, en hexadécimal. Absent quand l'utilisateur n'a pas choisi de couleur. */
  background: string | null;
  text: string | null;
}

interface CacheEntry {
  names: Map<string, string>;
  labels: Map<string, GmailLabel>;
  at: number;
}

const cache = new Map<string, CacheEntry>();

/** Une heure : un libellé créé aujourd'hui apparaît au plus tard dans l'heure. */
const TTL = 60 * 60 * 1000;

export async function loadLabelNames(
  gmail: gmail_v1.Gmail,
  mailboxId: string,
): Promise<Map<string, string>> {
  const cached = cache.get(mailboxId);
  if (cached && Date.now() - cached.at < TTL) return cached.names;

  const names = new Map<string, string>();
  const labels = new Map<string, GmailLabel>();

  try {
    const { data } = await gmail.users.labels.list({ userId: 'me' });

    for (const label of data.labels ?? []) {
      // `type: 'user'` est exactement la distinction cherchée : ce que le
      // marchand a créé, par opposition à ce que Google impose.
      if (label.type !== 'user' || !label.id || !label.name) continue;
      names.set(label.id, label.name);
      labels.set(label.name, {
        name: label.name,
        // Les couleurs viennent de Gmail, pas d'une palette inventée ici :
        // un agent qui a peint « Chargeback » en rouge dans sa boîte doit
        // retrouver ce rouge, sinon il relit chaque étiquette au lieu de la
        // reconnaître.
        background: label.color?.backgroundColor ?? null,
        text: label.color?.textColor ?? null,
      });
    }
  } catch {
    // Sans la table, on n'affiche pas de libellés — mieux que d'afficher des
    // identifiants bruts, que personne ne sait lire.
    return cached?.names ?? names;
  }

  cache.set(mailboxId, { names, labels, at: Date.now() });
  return names;
}

/** Les mêmes libellés, avec leurs couleurs, indexés par nom. */
export async function loadLabelStyles(
  gmail: gmail_v1.Gmail,
  mailboxId: string,
): Promise<Map<string, GmailLabel>> {
  await loadLabelNames(gmail, mailboxId);
  return cache.get(mailboxId)?.labels ?? new Map();
}

/** Traduit les identifiants d'un message en noms lisibles. */
export function resolveLabels(labelIds: string[], names: Map<string, string>): string[] {
  return labelIds
    .map((id) => names.get(id))
    .filter((name): name is string => Boolean(name))
    .sort((a, b) => a.localeCompare(b, 'fr'));
}

/**
 * Réétiquette les tickets d'une boîte, en interrogeant Gmail par libellé.
 *
 * L'approche naïve — relire les libellés de chaque message — coûte un appel
 * par message : quinze cents messages, quinze cents allers-retours, plusieurs
 * minutes et autant de quota pour une information qui tient en quelques
 * requêtes. Ici on demande à Gmail « quels messages portent ce libellé »,
 * une fois par libellé : cinq étiquettes font cinq requêtes, quel que soit le
 * volume de la boîte.
 */
export async function syncTicketLabels(params: {
  gmail: gmail_v1.Gmail;
  mailboxId: string;
  days: number;
  /**
   * Résout des identifiants de messages Gmail en identifiants de tickets.
   * Injecté pour garder ce module libre de toute dépendance à Prisma.
   */
  ticketsFor: (messageIds: string[]) => Promise<string[]>;
  /** Écrit la liste complète des libellés d'un ticket, en une fois. */
  applyLabels: (byTicket: Map<string, string[]>) => Promise<void>;
}): Promise<number> {
  const { gmail, mailboxId, days, ticketsFor, applyLabels } = params;

  const names = await loadLabelNames(gmail, mailboxId);

  /*
   * On rassemble d'abord, on écrit ensuite.
   *
   * Un ticket porte souvent plusieurs étiquettes, et Gmail ne sait répondre
   * que libellé par libellé. Écrire au fil de l'eau imposerait d'ajouter à une
   * liste existante — une opération que l'ORM ne sait pas faire et qui obligeait
   * à du SQL brut, silencieusement cassé le jour où le type de paramètre ne
   * convient pas. Rassemblé en mémoire, chaque ticket s'écrit une fois, avec sa
   * liste complète.
   */
  const byTicket = new Map<string, string[]>();

  for (const name of names.values()) {
    const ids: string[] = [];
    let pageToken: string | undefined;

    do {
      const { data } = await gmail.users.messages.list({
        userId: 'me',
        // Le nom entre guillemets : un libellé contenant une espace — « Avant
        // vente » — serait sinon lu comme deux critères de recherche.
        q: `label:"${name}" newer_than:${days}d`,
        maxResults: 500,
        pageToken,
      });

      for (const entry of data.messages ?? []) {
        if (entry.id) ids.push(entry.id);
      }

      pageToken = data.nextPageToken ?? undefined;
      // Deux mille par libellé : au-delà, l'étiquette décrit un classement de
      // masse dont le SAV n'a rien à tirer.
    } while (pageToken && ids.length < 2000);

    if (ids.length === 0) continue;

    // Par paquets de cinq cents : une clause `IN` de deux mille éléments
    // dépasse ce que Postgres accepte confortablement.
    for (let index = 0; index < ids.length; index += 500) {
      const ticketIds = await ticketsFor(ids.slice(index, index + 500));

      for (const ticketId of ticketIds) {
        const existing = byTicket.get(ticketId);
        if (existing) existing.push(name);
        else byTicket.set(ticketId, [name]);
      }
    }
  }

  await applyLabels(byTicket);
  return byTicket.size;
}
