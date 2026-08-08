import { env } from '../../config/env.ts';
import { logger } from '../../lib/logger.ts';
import { getGmailClient } from './client.ts';

function encodeHeaderValue(value: string): string {
  // RFC 2047 — nécessaire dès qu'un sujet contient des accents.
  return /^[\x20-\x7E]*$/.test(value)
    ? value
    : `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
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

  if (params.html) {
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

/**
 * Crée un brouillon de réponse dans le fil Gmail du client.
 * C'est le seul mode de sortie en phase 1 : rien ne part sans un clic humain.
 */
export async function createReplyDraft(params: {
  merchantId: string;
  /** Boîte d'envoi. Nulle, on prend celle par défaut de la boutique. */
  mailboxId?: string | null;
  threadId: string;
  to: string;
  subject: string;
  body: string;
  inReplyToMessageId?: string | null;
}): Promise<{ draftId: string }> {
  if (env.GMAIL_MOCK) {
    logger.info({ threadId: params.threadId }, 'Gmail simulé : brouillon non écrit');
    return { draftId: `mock-draft-${Date.now()}` };
  }

  const { gmail, emailAddress } = await getGmailClient(params.merchantId, params.mailboxId);

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
  /** Boîte d'envoi. Nulle, on prend celle par défaut de la boutique. */
  mailboxId?: string | null;
  draftId: string;
  threadId: string;
  to: string;
  subject: string;
  body: string;
}): Promise<void> {
  if (env.GMAIL_MOCK) return;

  const { gmail, emailAddress } = await getGmailClient(params.merchantId, params.mailboxId);

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
export async function sendDraft(
  merchantId: string,
  draftId: string,
  mailboxId?: string | null,
): Promise<{ gmailMessageId: string | null; fromEmail: string }> {
  if (env.GMAIL_MOCK) {
    logger.info({ draftId }, 'Gmail simulé : aucun mail envoyé');
    return { gmailMessageId: null, fromEmail: 'simulation@local' };
  }

  // Le brouillon appartient à une boîte précise : le poster depuis une autre
  // échouerait, l'identifiant y étant inconnu.
  const { gmail, emailAddress } = await getGmailClient(merchantId, mailboxId);
  const sent = await gmail.users.drafts.send({ userId: 'me', requestBody: { id: draftId } });

  // L'identifiant du message parti : c'est lui qui permet de consigner la
  // réponse dans le fil. Sans elle, l'agent relit une conversation où le
  // client parle seul — et l'IA apprend d'un corpus sans aucune réponse.
  return { gmailMessageId: sent.data.id ?? null, fromEmail: emailAddress };
}
