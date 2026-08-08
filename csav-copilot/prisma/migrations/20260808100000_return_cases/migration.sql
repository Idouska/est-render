-- Reshipment : dossiers de retour client et agences de traitement par pays.
-- Un retour remis en stock devient une paire disponible en France, proposée
-- au réemploi sur la prochaine commande du même article.

CREATE TYPE "ReturnReason" AS ENUM ('SIZE', 'DEFECT', 'MODEL', 'OTHER');
CREATE TYPE "ReturnResolution" AS ENUM ('EXCHANGE', 'REFUND');
CREATE TYPE "ReturnStatus" AS ENUM ('OPEN', 'LABEL_SENT', 'RECEIVED', 'RESTOCKED', 'UNUSABLE', 'CLOSED');

CREATE TABLE "ReturnAgency" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ReturnAgency_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ReturnAgency_merchantId_country_idx" ON "ReturnAgency"("merchantId", "country");

ALTER TABLE "ReturnAgency" ADD CONSTRAINT "ReturnAgency_merchantId_fkey"
    FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ReturnCase" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "orderName" TEXT,
    "shopifyOrderId" TEXT,
    "customerName" TEXT,
    "customerEmail" TEXT,
    "customerPhone" TEXT,
    "country" TEXT,
    "productTitle" TEXT NOT NULL,
    "variantTitle" TEXT,
    "sku" TEXT,
    "reason" "ReturnReason" NOT NULL DEFAULT 'OTHER',
    "resolution" "ReturnResolution" NOT NULL DEFAULT 'EXCHANGE',
    "labelSent" BOOLEAN NOT NULL DEFAULT false,
    "status" "ReturnStatus" NOT NULL DEFAULT 'OPEN',
    "trackingNumber" TEXT,
    "agencyId" TEXT,
    "reusedOrderName" TEXT,
    "reusedAt" TIMESTAMP(3),
    "note" TEXT,
    "lastContactAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ReturnCase_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ReturnCase_merchantId_status_idx" ON "ReturnCase"("merchantId", "status");
CREATE INDEX "ReturnCase_merchantId_sku_idx" ON "ReturnCase"("merchantId", "sku");

ALTER TABLE "ReturnCase" ADD CONSTRAINT "ReturnCase_merchantId_fkey"
    FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReturnCase" ADD CONSTRAINT "ReturnCase_agencyId_fkey"
    FOREIGN KEY ("agencyId") REFERENCES "ReturnAgency"("id") ON DELETE SET NULL ON UPDATE CASCADE;
