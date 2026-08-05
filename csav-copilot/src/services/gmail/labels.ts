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

interface CacheEntry {
  names: Map<string, string>;
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

  try {
    const { data } = await gmail.users.labels.list({ userId: 'me' });

    for (const label of data.labels ?? []) {
      // `type: 'user'` est exactement la distinction cherchée : ce que le
      // marchand a créé, par opposition à ce que Google impose.
      if (label.type !== 'user' || !label.id || !label.name) continue;
      names.set(label.id, label.name);
    }
  } catch {
    // Sans la table, on n'affiche pas de libellés — mieux que d'afficher des
    // identifiants bruts, que personne ne sait lire.
    return cached?.names ?? names;
  }

  cache.set(mailboxId, { names, at: Date.now() });
  return names;
}

/** Traduit les identifiants d'un message en noms lisibles. */
export function resolveLabels(labelIds: string[], names: Map<string, string>): string[] {
  return labelIds
    .map((id) => names.get(id))
    .filter((name): name is string => Boolean(name))
    .sort((a, b) => a.localeCompare(b, 'fr'));
}
