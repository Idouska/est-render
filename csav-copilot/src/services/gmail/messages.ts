import type { gmail_v1 } from 'googleapis';

/**
 * Pièce jointe d'un message.
 *
 * On retient l'identifiant Gmail, pas le contenu : une photo de défaut pèse
 * trois mégaoctets, et cent tickets par jour rempliraient la base en un mois.
 * Gmail conserve déjà le fichier, et le seul cas où il disparaît — le message
 * supprimé — est celui où l'on ne veut plus l'afficher de toute façon.
 */
export interface ParsedAttachment {
  gmailAttachmentId: string;
  filename: string;
  mimeType: string;
  size: number;
}

export interface ParsedMessage {
  gmailMessageId: string;
  gmailThreadId: string;
  subject: string | null;
  fromEmail: string;
  fromName: string | null;
  toEmail: string | null;
  bodyText: string;
  snippet: string | null;
  receivedAt: Date;
  labelIds: string[];
  attachments: ParsedAttachment[];
}

function header(message: gmail_v1.Schema$Message, name: string): string | null {
  const found = message.payload?.headers?.find(
    (h) => h.name?.toLowerCase() === name.toLowerCase(),
  );
  return found?.value ?? null;
}

/** `Jean Dupont <jean@exemple.fr>` → { name, email }. */
export function parseAddress(raw: string | null): { name: string | null; email: string } {
  if (!raw) return { name: null, email: '' };

  const match = raw.match(/^\s*(?:"?([^"<]*?)"?\s*)?<([^>]+)>\s*$/);
  if (match) {
    const name = match[1]?.trim();
    return { name: name && name.length > 0 ? name : null, email: match[2]!.trim().toLowerCase() };
  }
  return { name: null, email: raw.trim().toLowerCase() };
}

function decodeBase64Url(data: string): string {
  return Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

/** Extrait le texte du corps, en préférant text/plain à text/html. */
export function extractBody(payload: gmail_v1.Schema$MessagePart | undefined): string {
  if (!payload) return '';

  const parts: Array<{ mimeType: string; text: string }> = [];

  const walk = (part: gmail_v1.Schema$MessagePart): void => {
    const data = part.body?.data;
    if (data && part.mimeType) {
      parts.push({ mimeType: part.mimeType, text: decodeBase64Url(data) });
    }
    for (const child of part.parts ?? []) walk(child);
  };

  walk(payload);

  const plain = parts.find((p) => p.mimeType === 'text/plain');
  if (plain) return plain.text.trim();

  const html = parts.find((p) => p.mimeType === 'text/html');
  if (html) return stripHtml(html.text).trim();

  return '';
}

/**
 * Retire les citations du fil (« Le 12 mars, X a écrit : », lignes `>`,
 * signatures `-- `) pour ne garder que le message réellement écrit.
 * Sans ça, l'IA reclassifie l'historique à chaque tour.
 */
export function stripQuotedText(body: string): string {
  const lines = body.split('\n');
  const cut: string[] = [];

  const quoteMarkers = [
    /^\s*>/,
    /^\s*-{2,}\s*$/,
    /^\s*Le .+ a écrit\s*:/i,
    /^\s*On .+ wrote\s*:/i,
    /^\s*De\s*:\s*.+/i,
    /^\s*From\s*:\s*.+/i,
    /^\s*_{5,}\s*$/,
  ];

  for (const line of lines) {
    if (quoteMarkers.some((marker) => marker.test(line))) break;
    cut.push(line);
  }

  return cut.join('\n').trim() || body.trim();
}

/**
 * Pièces jointes réelles d'un message.
 *
 * Écarte les images intégrées au corps HTML — signatures, logos, pixels de
 * suivi : elles portent un `Content-ID` et ne sont pas des documents envoyés.
 * Sans ce filtre, chaque mail d'un client Gmail arrive avec quatre « pièces
 * jointes » qui sont son logo d'entreprise.
 */
export function extractAttachments(
  payload: gmail_v1.Schema$MessagePart | undefined,
): ParsedAttachment[] {
  if (!payload) return [];

  const found: ParsedAttachment[] = [];

  const walk = (part: gmail_v1.Schema$MessagePart): void => {
    const id = part.body?.attachmentId;
    const inline = part.headers?.some((h) => h.name?.toLowerCase() === 'content-id');

    if (id && part.filename && !inline) {
      found.push({
        gmailAttachmentId: id,
        filename: part.filename,
        mimeType: part.mimeType ?? 'application/octet-stream',
        size: part.body?.size ?? 0,
      });
    }

    for (const child of part.parts ?? []) walk(child);
  };

  walk(payload);
  return found;
}

export function parseMessage(message: gmail_v1.Schema$Message): ParsedMessage | null {
  if (!message.id || !message.threadId) return null;

  const from = parseAddress(header(message, 'From'));
  const to = parseAddress(header(message, 'To'));
  const internalDate = message.internalDate ? Number(message.internalDate) : Date.now();

  return {
    gmailMessageId: message.id,
    gmailThreadId: message.threadId,
    subject: header(message, 'Subject'),
    fromEmail: from.email,
    fromName: from.name,
    toEmail: to.email || null,
    bodyText: stripQuotedText(extractBody(message.payload ?? undefined)),
    snippet: message.snippet ?? null,
    receivedAt: new Date(internalDate),
    labelIds: message.labelIds ?? [],
    attachments: extractAttachments(message.payload ?? undefined),
  };
}
