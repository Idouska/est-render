-- Deux niveaux intermédiaires entre le propriétaire et l'agent.
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'SUPERVISOR';
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'VIEWER';

-- AlterTable
ALTER TABLE "User"
  ADD COLUMN "active" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "invitedAt" TIMESTAMP(3),
  ADD COLUMN "lastLoginAt" TIMESTAMP(3);

-- CreateIndex
DROP INDEX IF EXISTS "User_merchantId_idx";
CREATE INDEX "User_merchantId_active_idx" ON "User"("merchantId", "active");
