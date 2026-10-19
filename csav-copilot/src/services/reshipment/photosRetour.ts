import { prisma } from '../../lib/prisma.ts';
import { getGmailClient } from '../gmail/client.ts';

/**
 * Les photos d'un retour : la preuve avant la décision.
 *
 * CE QUI CHANGE. Un échange se validait sur trois cases cochées, un
 * remboursement sans rien : une paire portée ou abîmée passait sur la foi
 * d'un clic. Désormais, trois photos au moins de la paire retournée — prises
 * par le client, l'agence ou le marchand — avant de valider un échange, un
 * remboursement, ou de refuser le retour. Et l'agence ne déclare une paire
 * reçue qu'après l'avoir photographiée elle-même.
 */

/** Le minimum, pour décider comme pour réceptionner. */
export const PHOTOS_MIN = 3;

export const SOURCES_PHOTO = ['CLIENT', 'AGENCE', 'MARCHAND'] as const;
export type SourcePhoto = (typeof SOURCES_PHOTO)[number];

/** Le message, le même partout : il dit quoi faire, pas seulement ce qui manque. */
export function manquePhotos(n: number): string {
  const reste = PHOTOS_MIN - n;
  return `Il manque ${reste} photo${reste > 1 ? 's' : ''} de la paire retournée : ${PHOTOS_MIN} au moins avant de décider.`;
}

/** Combien de photos a chaque dossier. */
export async function comptePhotos(merchantId: string, ids: string[]): Promise<Map<string, number>> {
  if (ids.length === 0) return new Map();
  const lignes = await prisma.returnPhoto.groupBy({
    by: ['returnCaseId'],
    where: { merchantId, returnCaseId: { in: ids } },
    _count: { _all: true },
  });
  return new Map(lignes.map((ligne) => [ligne.returnCaseId, ligne._count._all]));
}

export async function nombrePhotos(merchantId: string, id: string, source?: SourcePhoto): Promise<number> {
  return prisma.returnPhoto.count({ where: { merchantId, returnCaseId: id, ...(source ? { source } : {}) } });
}

/**
 * Ajoute une photo au dossier. La première tient aussi lieu de photo
 * « historique » du dossier : la liste, le stock et l'agence l'affichent
 * comme avant.
 */
export async function ajouterPhoto(params: {
  merchantId: string;
  returnCaseId: string;
  source: SourcePhoto;
  mime: string;
  data: Uint8Array<ArrayBuffer>;
  attachmentId?: string | null;
}): Promise<{ id: string }> {
  const photo = await prisma.returnPhoto.create({
    data: {
      merchantId: params.merchantId,
      returnCaseId: params.returnCaseId,
      source: params.source,
      mime: params.mime,
      data: params.data,
      attachmentId: params.attachmentId ?? null,
    },
    select: { id: true },
  });
  await prisma.returnCase.updateMany({
    where: { id: params.returnCaseId, merchantId: params.merchantId, photoMime: null },
    data: { photoData: params.data, photoMime: params.mime },
  });
  return photo;
}

/** Ce qu'un navigateur affiche partout : le HEIC d'un iPhone n'en fait pas partie. */
export const TYPES_PHOTO = new Set(['image/jpeg', 'image/png', 'image/webp']);

/** Les photos jointes par le client à ses mails sur cette commande : des candidates. */
export async function photosDesMailsClient(
  merchantId: string,
  dossier: { shopifyOrderId: string | null; customerEmail: string | null },
): Promise<Array<{ id: string; filename: string; recuLe: Date }>> {
  const tickets = [
    ...(dossier.shopifyOrderId ? [{ shopifyOrderId: dossier.shopifyOrderId }] : []),
    ...(dossier.customerEmail ? [{ customerEmail: { equals: dossier.customerEmail, mode: 'insensitive' as const } }] : []),
  ];
  if (tickets.length === 0) return [];
  const pieces = await prisma.attachment.findMany({
    where: {
      merchantId,
      mimeType: { in: [...TYPES_PHOTO] },
      message: { direction: 'INBOUND', ticket: { merchantId, OR: tickets } },
    },
    orderBy: { createdAt: 'desc' },
    take: 24,
    select: { id: true, filename: true, createdAt: true },
  });
  return pieces.map((piece) => ({ id: piece.id, filename: piece.filename, recuLe: piece.createdAt }));
}

/** Le contenu d'une pièce jointe : en base pour les signalements, chez Gmail pour un mail. */
export async function lirePieceJointe(
  merchantId: string,
  id: string,
): Promise<{ mime: string; data: Uint8Array<ArrayBuffer> } | null> {
  const piece = await prisma.attachment.findFirst({
    where: { id, merchantId },
    select: {
      data: true,
      mimeType: true,
      gmailAttachmentId: true,
      message: { select: { gmailMessageId: true, ticket: { select: { mailboxId: true } } } },
    },
  });
  if (!piece || !TYPES_PHOTO.has(piece.mimeType)) return null;
  if (piece.data) return { mime: piece.mimeType, data: Uint8Array.from(piece.data) };
  if (!piece.gmailAttachmentId) return null;
  const { gmail } = await getGmailClient(merchantId, piece.message.ticket.mailboxId);
  const { data } = await gmail.users.messages.attachments.get({
    userId: 'me',
    messageId: piece.message.gmailMessageId,
    id: piece.gmailAttachmentId,
  });
  if (!data.data) return null;
  return {
    mime: piece.mimeType,
    data: Uint8Array.from(Buffer.from(data.data.replace(/-/g, '+').replace(/_/g, '/'), 'base64')),
  };
}
