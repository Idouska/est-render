import type { SupplierAlertKind } from '@prisma/client';
import { env } from '../../config/env.ts';
import { logger } from '../../lib/logger.ts';
import { prisma } from '../../lib/prisma.ts';
import { sendPlainEmail } from '../gmail/send.ts';
import { DELAI_URGENCE_H, KINDS_URGENTS } from './urgence.ts';
import { mailUrgencesSansReponse } from './urgencesTexte.ts';

/**
 * Les urgences restées sans réponse, signalées au marchand.
 *
 * L'atelier a reçu « Ne pas expédier » par mail, il a eu son rappel ; s'il ne
 * répond toujours pas, l'outil ne peut plus rien. Le marchand, si : il
 * décroche son téléphone. Encore faut-il qu'il le sache avant que le colis
 * parte — d'où ce mail, aux responsables de la boutique, une fois par
 * urgence. Le bandeau du tableau de bord la garde ensuite sous leurs yeux.
 *
 * Au-delà de trois jours, une urgence n'en est plus une : le colis est parti
 * ou non, et un mail de plus n'y changerait rien.
 */
export async function signalerUrgencesSansReponse(maintenant = new Date()): Promise<number> {
  const urgences = await prisma.supplierAlert.findMany({
    where: {
      status: 'PENDING',
      kind: { in: [...KINDS_URGENTS] as SupplierAlertKind[] },
      signaleLe: null,
      handledAt: null,
      createdAt: {
        lte: new Date(maintenant.getTime() - DELAI_URGENCE_H * 3_600_000),
        gte: new Date(maintenant.getTime() - 3 * 86_400_000),
      },
    },
    orderBy: { createdAt: 'asc' },
    take: 200,
    select: {
      id: true,
      merchantId: true,
      kind: true,
      orderName: true,
      beforeValue: true,
      afterValue: true,
      createdAt: true,
      supplier: { select: { name: true, phone: true } },
    },
  });

  const parBoutique = new Map<string, typeof urgences>();
  for (const urgence of urgences) {
    parBoutique.set(urgence.merchantId, [...(parBoutique.get(urgence.merchantId) ?? []), urgence]);
  }

  let mails = 0;
  for (const [merchantId, liste] of parBoutique) {
    // Les responsables : ceux qui peuvent appeler l'atelier et décider.
    const responsables = await prisma.user.findMany({
      where: { merchantId, active: true, role: { in: ['OWNER', 'SUPERVISOR'] } },
      select: { email: true },
    });
    if (responsables.length === 0) continue;

    const mail = mailUrgencesSansReponse({
      urgences: liste.map((urgence) => ({
        ...urgence,
        heures: Math.floor((maintenant.getTime() - urgence.createdAt.getTime()) / 3_600_000),
        atelier: urgence.supplier,
      })),
      lien: `${env.APP_URL}/dashboard`,
    });

    try {
      for (const { email } of responsables) {
        await sendPlainEmail({ merchantId, to: email, ...mail });
      }
      // Noté seulement s'il est parti : en échec, il repart au passage suivant.
      await prisma.supplierAlert.updateMany({
        where: { id: { in: liste.map((urgence) => urgence.id) } },
        data: { signaleLe: maintenant },
      });
      mails += 1;
    } catch (error) {
      logger.warn({ err: error, merchantId }, 'Urgences sans réponse non signalées');
    }
  }
  return mails;
}
