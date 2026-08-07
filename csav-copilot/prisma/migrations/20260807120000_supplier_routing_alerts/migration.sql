-- Affectation automatique des commandes : la marque et le préfixe de référence
-- disent déjà quel atelier prépare l'article.
ALTER TABLE "Supplier" ADD COLUMN "vendors" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Supplier" ADD COLUMN "skuPrefixes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Supplier" ADD COLUMN "isDefault" BOOLEAN NOT NULL DEFAULT false;

-- Alertes urgentes vers un fournisseur : envoyées par mail, conservées ici
-- pour savoir si elles ont été vues.
CREATE TYPE "SupplierAlertKind" AS ENUM ('ADDRESS', 'PHONE', 'PRODUCT', 'HOLD', 'OTHER');

CREATE TABLE "SupplierAlert" (
  "id" TEXT NOT NULL,
  "merchantId" TEXT NOT NULL,
  "supplierId" TEXT NOT NULL,
  "kind" "SupplierAlertKind" NOT NULL,
  "shopifyOrderId" TEXT,
  "orderName" TEXT,
  "message" TEXT NOT NULL,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "acknowledgedAt" TIMESTAMP(3),
  "emailedAt" TIMESTAMP(3),
  CONSTRAINT "SupplierAlert_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SupplierAlert_merchantId_supplierId_acknowledgedAt_idx"
  ON "SupplierAlert"("merchantId", "supplierId", "acknowledgedAt");

ALTER TABLE "SupplierAlert" ADD CONSTRAINT "SupplierAlert_merchantId_fkey"
  FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupplierAlert" ADD CONSTRAINT "SupplierAlert_supplierId_fkey"
  FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;
