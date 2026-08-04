import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.ts';
import { requireSession } from '../plugins/auth.ts';

/**
 * Colis d'une commande.
 *
 * Une commande de trois articles part souvent en trois colis avec trois
 * numéros de suivi. Le fournisseur saisit chacun depuis son téléphone et
 * photographie l'étiquette : la photo est la preuve que le colis existe et
 * porte bien ce numéro, ce qu'aucun champ texte ne garantit.
 */

/** Data URL produite par le navigateur après compression. */
const PHOTO_LIMIT_BYTES = 2 * 1024 * 1024;

export const photoSchema = z
  .string()
  .regex(/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/, 'Image invalide')
  .refine((value) => value.length <= PHOTO_LIMIT_BYTES * 1.4, {
    message: 'Photo trop lourde : reprenez-la, elle doit être compressée avant l’envoi.',
  });

export function decodePhoto(dataUrl: string): { mime: string; data: Uint8Array<ArrayBuffer> } {
  // Le format a déjà été validé par `photoSchema` : l'en-tête et la charge
  // utile existent forcément, mais TypeScript ne peut pas le déduire.
  const comma = dataUrl.indexOf(',');
  const header = dataUrl.slice(0, comma);
  const payload = dataUrl.slice(comma + 1);

  return {
    mime: header.slice(5, header.indexOf(';')),
    // Prisma attend précisément un `Uint8Array<ArrayBuffer>` : un `Buffer` peut
    // reposer sur un `SharedArrayBuffer`, que la signature refuse. La recopie
    // garantit un tampon simple.
    data: Uint8Array.from(Buffer.from(payload, 'base64')),
  };
}

/** Vue publique d'un colis : jamais les octets, seulement leur présence. */
export function toParcelView(parcel: {
  id: string;
  trackingNumber: string;
  carrier: string | null;
  index: number;
  total: number;
  orderName: string | null;
  photoMime: string | null;
  photoTakenAt: Date | null;
  updatedAt: Date;
}) {
  return {
    id: parcel.id,
    trackingNumber: parcel.trackingNumber,
    carrier: parcel.carrier,
    index: parcel.index,
    total: parcel.total,
    orderName: parcel.orderName,
    hasPhoto: Boolean(parcel.photoMime),
    photoTakenAt: parcel.photoTakenAt,
    updatedAt: parcel.updatedAt,
  };
}

/** Sert les octets d'une photo, ou 404 si le colis n'en a pas encore. */
export async function sendParcelPhoto(reply: FastifyReply, parcelId: string, merchantId: string) {
  const parcel = await prisma.parcel.findFirst({
    where: { id: parcelId, merchantId },
    select: { photoMime: true, photoData: true },
  });

  if (!parcel?.photoData || !parcel.photoMime) {
    return reply.code(404).send({ error: 'Aucune photo pour ce colis' });
  }

  return reply
    .type(parcel.photoMime)
    // Privée : la photo porte une adresse de livraison lisible sur l'étiquette.
    .header('Cache-Control', 'private, max-age=86400')
    .send(Buffer.from(parcel.photoData));
}

const parcelBody = z.object({
  trackingNumber: z.string().min(3).max(80),
  carrier: z.string().max(80).nullish(),
  index: z.number().int().min(1).max(20),
  total: z.number().int().min(1).max(20),
  orderName: z.string().max(60).nullish(),
  shopifyOrderId: z.string().max(120).nullish(),
  photo: photoSchema.nullish(),
});

export async function parcelRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireSession);

  app.get<{ Querystring: { orderId?: string; orderName?: string } }>(
    '/api/parcels',
    async (request, reply) => {
      const { merchantId } = request.session;
      const { orderId, orderName } = request.query;

      const parcels = await prisma.parcel.findMany({
        where: {
          merchantId,
          ...(orderId ? { shopifyOrderId: orderId } : {}),
          ...(orderName ? { orderName } : {}),
        },
        orderBy: [{ orderName: 'asc' }, { index: 'asc' }],
        select: {
          id: true,
          trackingNumber: true,
          carrier: true,
          index: true,
          total: true,
          orderName: true,
          photoMime: true,
          photoTakenAt: true,
          updatedAt: true,
        },
      });

      return reply.send({ parcels: parcels.map(toParcelView) });
    },
  );

  app.get<{ Params: { id: string } }>('/api/parcels/:id/photo', async (request, reply) =>
    sendParcelPhoto(reply, request.params.id, request.session.merchantId),
  );

  // Saisie côté marchand : un agent au téléphone avec le fournisseur doit
  // pouvoir enregistrer un numéro sans attendre que celui-ci ouvre son lien.
  app.post(
    '/api/parcels',
    { bodyLimit: 4 * 1024 * 1024 },
    async (request, reply) => {
      const parsed = parcelBody.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Colis invalide' });
      }

      const { merchantId, userId } = request.session;
      const photo = parsed.data.photo ? decodePhoto(parsed.data.photo) : null;

      // Champs photo montés à part : avec `exactOptionalPropertyTypes`, un
      // spread conditionnel produit `string | undefined` là où Prisma attend
      // soit la clé absente, soit une valeur.
      const photoFields = photo
        ? { photoMime: photo.mime, photoData: photo.data, photoTakenAt: new Date() }
        : {};

      const parcel = await prisma.parcel.upsert({
        where: {
          merchantId_trackingNumber: {
            merchantId,
            trackingNumber: parsed.data.trackingNumber.trim(),
          },
        },
        create: {
          merchantId,
          trackingNumber: parsed.data.trackingNumber.trim(),
          carrier: parsed.data.carrier ?? null,
          index: parsed.data.index,
          total: parsed.data.total,
          orderName: parsed.data.orderName ?? null,
          shopifyOrderId: parsed.data.shopifyOrderId ?? null,
          createdById: userId,
          ...photoFields,
        },
        update: {
          carrier: parsed.data.carrier ?? null,
          index: parsed.data.index,
          total: parsed.data.total,
          // Une photo absente du corps ne signifie pas « supprimer la photo » :
          // le formulaire renvoie souvent le colis sans la reprendre.
          ...photoFields,
        },
        select: {
          id: true,
          trackingNumber: true,
          carrier: true,
          index: true,
          total: true,
          orderName: true,
          photoMime: true,
          photoTakenAt: true,
          updatedAt: true,
        },
      });

      return reply.send({ parcel: toParcelView(parcel) });
    },
  );
}
