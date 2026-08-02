import type { ActorType, Prisma } from '@prisma/client';
import { prisma } from './prisma.ts';

export interface AuditEntry {
  merchantId: string;
  actorType: ActorType;
  actorId?: string | null;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  metadata?: Prisma.InputJsonValue;
  ipAddress?: string | null;
}

/**
 * Journal append-only. Toute action sensible (remboursement, envoi de mail,
 * connexion/déconnexion d'un compte) doit passer par ici.
 */
export async function recordAudit(entry: AuditEntry): Promise<void> {
  await prisma.auditLog.create({
    data: {
      merchantId: entry.merchantId,
      actorType: entry.actorType,
      actorId: entry.actorId ?? null,
      action: entry.action,
      targetType: entry.targetType ?? null,
      targetId: entry.targetId ?? null,
      metadata: entry.metadata,
      ipAddress: entry.ipAddress ?? null,
    },
  });
}
