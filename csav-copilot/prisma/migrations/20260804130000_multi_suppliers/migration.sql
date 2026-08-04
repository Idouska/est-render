-- Plusieurs fournisseurs par marchand : la contrainte d'unicité sur
-- merchantId n'a plus lieu d'être, remplacée par une unicité sur l'adresse.
DROP INDEX IF EXISTS "Supplier_merchantId_key";

-- CreateEnum
CREATE TYPE "SupplierRole" AS ENUM ('SUPPLIER', 'CARRIER', 'WORKSHOP', 'WAREHOUSE');

-- AlterTable
ALTER TABLE "Supplier"
  ADD COLUMN "contactName" TEXT,
  ADD COLUMN "phone" TEXT,
  ADD COLUMN "role" "SupplierRole" NOT NULL DEFAULT 'SUPPLIER',
  ADD COLUMN "active" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "notes" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Supplier_merchantId_contactEmail_key" ON "Supplier"("merchantId", "contactEmail");
CREATE INDEX "Supplier_merchantId_active_idx" ON "Supplier"("merchantId", "active");
