-- Une alerte fournisseur devient une demande de changement : valeur actuelle,
-- valeur demandée, mail client d'origine, et une réponse du fournisseur.

ALTER TYPE "SupplierAlertKind" ADD VALUE IF NOT EXISTS 'SIZE';
ALTER TYPE "SupplierAlertKind" ADD VALUE IF NOT EXISTS 'COLOR';
ALTER TYPE "SupplierAlertKind" ADD VALUE IF NOT EXISTS 'CANCEL';

CREATE TYPE "SupplierAlertStatus" AS ENUM ('PENDING', 'ACKNOWLEDGED', 'REFUSED');

ALTER TABLE "SupplierAlert" ADD COLUMN "beforeValue" TEXT;
ALTER TABLE "SupplierAlert" ADD COLUMN "afterValue" TEXT;
ALTER TABLE "SupplierAlert" ADD COLUMN "ticketId" TEXT;
ALTER TABLE "SupplierAlert" ADD COLUMN "supplierNote" TEXT;
ALTER TABLE "SupplierAlert"
  ADD COLUMN "status" "SupplierAlertStatus" NOT NULL DEFAULT 'PENDING';

-- Les alertes déjà lues avant cette migration valent un accord : elles ont été
-- vues et traitées, les repasser « en attente » ferait réapparaître du travail
-- terminé en tête de l'atelier.
UPDATE "SupplierAlert" SET "status" = 'ACKNOWLEDGED' WHERE "acknowledgedAt" IS NOT NULL;

CREATE INDEX "SupplierAlert_merchantId_supplierId_status_idx"
  ON "SupplierAlert"("merchantId", "supplierId", "status");
CREATE INDEX "SupplierAlert_ticketId_idx" ON "SupplierAlert"("ticketId");

ALTER TABLE "SupplierAlert" ADD CONSTRAINT "SupplierAlert_ticketId_fkey"
  FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE SET NULL ON UPDATE CASCADE;
