/**
 * L'encodage MIME d'un mail : sans réseau ni configuration, pour se tester
 * seul.
 */

export function encodeHeaderValue(value: string): string {
  // RFC 2047 — nécessaire dès qu'un sujet contient des accents.
  return /^[\x20-\x7E]*$/.test(value)
    ? value
    : `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

export interface PieceJointe {
  filename: string;
  mimeType: string;
  content: Buffer;
}

/** Exporté pour services/gmail/send.ts — même encodage MIME, pas de brouillon. */
export function buildRawEmail(params: {
  to: string;
  from: string;
  /** Nom affiché à côté de l'adresse : « Running Upscale » plutôt que l'adresse nue. */
  fromName?: string | null;
  subject: string;
  body: string;
  /**
   * Version HTML, envoyée en alternative au texte.
   *
   * Un mail tout en texte brut contenant une URL de trois cents caractères
   * ressemble à un hameçonnage — c'est ainsi que la notification d'escalade
   * finissait en indésirables. Avec une part HTML, le lien devient un bouton
   * et le pavé de jeton disparaît de la vue.
   */
  html?: string | null;
  inReplyToMessageId?: string | null;
  references?: string | null;
  /** Pièces jointes : le fichier de commandes envoyé au fournisseur. */
  attachments?: readonly PieceJointe[];
}): string {
  const from = params.fromName
    ? `${encodeHeaderValue(params.fromName)} <${params.from}>`
    : params.from;

  const headers = [`From: ${from}`, `To: ${params.to}`, `Subject: ${encodeHeaderValue(params.subject)}`, 'MIME-Version: 1.0'];

  if (params.inReplyToMessageId) {
    headers.push(`In-Reply-To: ${params.inReplyToMessageId}`);
    headers.push(`References: ${params.references ?? params.inReplyToMessageId}`);
  }

  const encode = (content: string) => Buffer.from(content, 'utf8').toString('base64');

  let mime: string;
  const pieces = params.attachments ?? [];

  if (pieces.length > 0) {
    /*
     * `multipart/mixed` : le texte, puis les fichiers.
     *
     * Le base64 d'une pièce jointe est coupé à 76 caractères par ligne : une
     * ligne de plusieurs centaines de kilo-octets dépasse ce qu'acceptent
     * certains serveurs de messagerie, qui tronquent alors le fichier.
     */
    const boundary = `csav-mix-${Date.now().toString(36)}`;
    headers.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);
    const lignes = (base64: string) => base64.match(/.{1,76}/g)?.join('\r\n') ?? '';

    mime = [
      headers.join('\r\n'),
      '',
      `--${boundary}`,
      'Content-Type: text/plain; charset="UTF-8"',
      'Content-Transfer-Encoding: base64',
      '',
      lignes(encode(params.body)),
      ...pieces.flatMap((piece) => [
        `--${boundary}`,
        `Content-Type: ${piece.mimeType}; name="${encodeHeaderValue(piece.filename)}"`,
        `Content-Disposition: attachment; filename="${encodeHeaderValue(piece.filename)}"`,
        'Content-Transfer-Encoding: base64',
        '',
        lignes(piece.content.toString('base64')),
      ]),
      `--${boundary}--`,
    ].join('\r\n');
  } else if (params.html) {
    /*
     * `multipart/alternative` : le même message en deux habits.
     *
     * Le client de messagerie choisit ce qu'il sait afficher. Les deux parts
     * doivent dire la même chose — un texte de remplacement qui diffère du
     * HTML est un signal de courrier indésirable, pas une commodité.
     */
    const boundary = `csav-${Date.now().toString(36)}`;
    headers.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);

    mime = [
      headers.join('\r\n'),
      '',
      `--${boundary}`,
      'Content-Type: text/plain; charset="UTF-8"',
      'Content-Transfer-Encoding: base64',
      '',
      encode(params.body),
      `--${boundary}`,
      'Content-Type: text/html; charset="UTF-8"',
      'Content-Transfer-Encoding: base64',
      '',
      encode(params.html),
      `--${boundary}--`,
    ].join('\r\n');
  } else {
    headers.push('Content-Type: text/plain; charset="UTF-8"', 'Content-Transfer-Encoding: base64');
    mime = `${headers.join('\r\n')}\r\n\r\n${encode(params.body)}`;
  }

  return Buffer.from(mime, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}
