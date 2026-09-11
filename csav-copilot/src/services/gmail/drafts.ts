import { env } from '../../config/env.ts';
import { ENVOI_SIMULE, enModeTest } from '../modeTest.ts';
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

/**
 * Supprime un brouillon Gmail.
 *
 * Chaque traitement d'un ticket créait un brouillon réel dans Gmail — et rien
 * ne le supprimait jamais : retraitement, relance, clôture, tout laissait le
 * brouillon derrière lui. À 3 600 messages traités, la boîte comptait plus de
 * 2 000 brouillons orphelins. Tolérante au 404 : un brouillon déjà envoyé ou
 * supprimé à la main n'est pas une erreur, c'est l'état qu'on visait.
 */
export async function deleteReplyDraft(
  merchantId: string,
  draftId: string,
  mailboxId?: string | null,
): Promise<void> {
  if (env.GMAIL_MOCK) return;

  const { gmail } = await getGmailClient(merchantId, mailboxId);
  try {
    await gmail.users.drafts.delete({ userId: 'me', id: draftId });
  } catch (error) {
    const status =
      (error as { code?: number | string; status?: number; response?: { status?: number } }) ?? {};
    if (
      status.code === 404 ||
      status.code === '404' ||
      status.status === 404 ||
      status.response?.status === 404
    ) {
      return; // déjà disparu — c'est le résultat voulu
    }
    logger.warn({ draftId, err: error }, 'Suppression de brouillon Gmail impossible');
  }
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

/** Préfixe « Re: » une seule fois, quelle que soit la casse d'origine. */
function replySubject(subject: string): string {
  return subject.toLowerCase().startsWith('re:') ? subject : `Re: ${subject}`;
}

/**
 * Envoie la réponse directement dans le fil du client, sans passer par un
 * brouillon Gmail.
 *
 * `discardPendingDrafts` a réglé les brouillons orphelins, mais pas leur
 * cause : un brouillon était toujours écrit à chaque traitement. Deux raisons
 * de ne plus en créer du tout.
 *
 * La première est le volume : un brouillon par message reçu, dans une boîte
 * partagée qui sert aussi aux vrais brouillons de l'équipe.
 *
 * La seconde est plus sérieuse. Un brouillon posé dans Gmail est envoyable
 * depuis n'importe quel client, y compris un téléphone — donc en dehors du
 * produit, sans contrôle de rôle, sans plafond de remboursement, et sans
 * trace dans le journal d'audit. Toute la gouvernance construite dans le
 * dashboard se contourne d'un geste. La proposition reste donc en base, et
 * Gmail n'est sollicité qu'ici, sur action d'une personne autorisée.
 */
export async function sendReplyInThread(params: {
  merchantId: string;
  /** Boîte d'envoi. Nulle, on prend celle par défaut de la boutique. */
  mailboxId?: string | null;
  threadId: string;
  to: string;
  subject: string;
  body: string;
  inReplyToMessageId?: string | null;
}): Promise<{ gmailMessageId: string | null; fromEmail: string }> {
  if (env.GMAIL_MOCK) {
    logger.info({ threadId: params.threadId }, 'Gmail simulé : aucun mail envoyé');
    return { gmailMessageId: null, fromEmail: 'simulation@local' };
  }
  if (await enModeTest(params.merchantId)) {
    logger.info({ threadId: params.threadId }, 'Mode test : aucun mail envoyé');
    return { ...ENVOI_SIMULE };
  }

  const { gmail, emailAddress } = await getGmailClient(params.merchantId, params.mailboxId);

  const sent = await gmail.users.messages.send({
    userId: 'me',
    requestBody: {
      threadId: params.threadId,
      raw: buildRawEmail({
        to: params.to,
        from: emailAddress,
        subject: replySubject(params.subject),
        body: params.body,
        inReplyToMessageId: params.inReplyToMessageId,
      }),
    },
  });

  return { gmailMessageId: sent.data.id ?? null, fromEmail: emailAddress };
}

/**
 * Envoie un brouillon Gmail existant.
 *
 * Conservé pour les tickets antérieurs à `sendReplyInThread`, dont le
 * brouillon existe encore dans la boîte. Rien n'en crée de nouveau.
 */
export async function sendDraft(
  merchantId: string,
  draftId: string,
  mailboxId?: string | null,
): Promise<{ gmailMessageId: string | null; fromEmail: string }> {
  if (env.GMAIL_MOCK) {
    logger.info({ draftId }, 'Gmail simulé : aucun mail envoyé');
    return { gmailMessageId: null, fromEmail: 'simulation@local' };
  }
  if (await enModeTest(merchantId)) {
    logger.info({ draftId }, 'Mode test : aucun mail envoyé');
    return { ...ENVOI_SIMULE };
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
