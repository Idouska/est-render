import { getGmailClient } from './client.ts';

function encodeHeaderValue(value: string): string {
  // RFC 2047 — nécessaire dès qu'un sujet contient des accents.
  return /^[\x20-\x7E]*$/.test(value)
    ? value
    : `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

function buildRawEmail(params: {
  to: string;
  from: string;
  subject: string;
  body: string;
  inReplyToMessageId?: string | null;
  references?: string | null;
}): string {
  const headers = [
    `From: ${params.from}`,
    `To: ${params.to}`,
    `Subject: ${encodeHeaderValue(params.subject)}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
  ];

  if (params.inReplyToMessageId) {
    headers.push(`In-Reply-To: ${params.inReplyToMessageId}`);
    headers.push(`References: ${params.references ?? params.inReplyToMessageId}`);
  }

  const mime = `${headers.join('\r\n')}\r\n\r\n${Buffer.from(params.body, 'utf8').toString(
    'base64',
  )}`;

  return Buffer.from(mime, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * Crée un brouillon de réponse dans le fil Gmail du client.
 * C'est le seul mode de sortie en phase 1 : rien ne part sans un clic humain.
 */
export async function createReplyDraft(params: {
  merchantId: string;
  threadId: string;
  to: string;
  subject: string;
  body: string;
  inReplyToMessageId?: string | null;
}): Promise<{ draftId: string }> {
  const { gmail, emailAddress } = await getGmailClient(params.merchantId);

  const subject = params.subject.toLowerCase().startsWith('re:')
    ? params.subject
    : `Re: ${params.subject}`;

  const response = await gmail.users.drafts.create({
    userId: 'me',
    requestBody: {
      message: {
        threadId: params.threadId,
        raw: buildRawEmail({
          to: params.to,
          from: emailAddress,
          subject,
          body: params.body,
          inReplyToMessageId: params.inReplyToMessageId,
        }),
      },
    },
  });

  if (!response.data.id) {
    throw new Error('Gmail n’a pas retourné d’identifiant de brouillon');
  }

  return { draftId: response.data.id };
}

export async function updateDraftBody(params: {
  merchantId: string;
  draftId: string;
  threadId: string;
  to: string;
  subject: string;
  body: string;
}): Promise<void> {
  const { gmail, emailAddress } = await getGmailClient(params.merchantId);

  await gmail.users.drafts.update({
    userId: 'me',
    id: params.draftId,
    requestBody: {
      message: {
        threadId: params.threadId,
        raw: buildRawEmail({
          to: params.to,
          from: emailAddress,
          subject: params.subject,
          body: params.body,
        }),
      },
    },
  });
}

/** Envoie un brouillon existant. Déclenché uniquement par une action humaine. */
export async function sendDraft(merchantId: string, draftId: string): Promise<void> {
  const { gmail } = await getGmailClient(merchantId);
  await gmail.users.drafts.send({ userId: 'me', requestBody: { id: draftId } });
}
