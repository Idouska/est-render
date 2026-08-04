-- Colis : un numéro de suivi et une photo par colis d'une commande.

CREATE TABLE "Parcel" (
  "id" TEXT NOT NULL,
  "merchantId" TEXT NOT NULL,
  "escalationId" TEXT,
  "shopifyOrderId" TEXT,
  "orderName" TEXT,
  "trackingNumber" TEXT NOT NULL,
  "carrier" TEXT,
  "index" INTEGER NOT NULL,
  "total" INTEGER NOT NULL,
  "photoMime" TEXT,
  "photoData" BYTEA,
  "photoTakenAt" TIMESTAMP(3),
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Parcel_pkey" PRIMARY KEY ("id")
);

-- Un numéro de suivi ne peut désigner qu'un colis chez un marchand : sans ça,
-- une double saisie créerait deux colis concurrents pour le même envoi.
CREATE UNIQUE INDEX "Parcel_merchantId_trackingNumber_key" ON "Parcel"("merchantId", "trackingNumber");
CREATE INDEX "Parcel_merchantId_shopifyOrderId_idx" ON "Parcel"("merchantId", "shopifyOrderId");
CREATE INDEX "Parcel_escalationId_idx" ON "Parcel"("escalationId");

ALTER TABLE "Parcel" ADD CONSTRAINT "Parcel_merchantId_fkey"
  FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Parcel" ADD CONSTRAINT "Parcel_escalationId_fkey"
  FOREIGN KEY ("escalationId") REFERENCES "SupplierEscalation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
