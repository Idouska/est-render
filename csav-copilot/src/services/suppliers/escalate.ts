import { recordAudit } from '../../lib/audit.ts';
import { prisma } from '../../lib/prisma.ts';

/*
 * Les escalades ne s'écrivent plus en texte libre : une rupture s'ouvre par
 * une proposition de remplacement (ruptures/substitution.ts), tout autre motif
 * par une demande de la fenêtre « Contacter le fournisseur ». Reste ici la
 * clôture d'un dossier.
 */

/** Clôture manuelle par l'agent — le fournisseur a répondu, le sujet est traité. */
export async function resolveEscalation(params: {
  merchantId: string;
  escalationId: string;
  userId: string;
}): Promise<void> {
  const escalation = await prisma.supplierEscalation.findFirstOrThrow({
    where: { id: params.escalationId, merchantId: params.merchantId },
  });

  await prisma.supplierEscalation.update({
    where: { id: escalation.id },
    data: { status: 'RESOLVED', resolvedAt: new Date() },
  });

  await recordAudit({
    merchantId: params.merchantId,
    actorType: 'USER',
    actorId: params.userId,
    action: 'supplier.escalation_resolved',
    targetType: 'SupplierEscalation',
    targetId: escalation.id,
  });
}
