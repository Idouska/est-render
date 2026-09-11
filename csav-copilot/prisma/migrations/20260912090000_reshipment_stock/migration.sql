-- Reshipment : la commande servie par une paire du stock retours, l'entrée au
-- stock (les plus anciennes partent d'abord) et la sortie pour défaut.
ALTER TABLE "ReturnCase" ADD COLUMN     "restockedAt" TIMESTAMP(3),
ADD COLUMN     "reusedShopifyOrderId" TEXT,
ADD COLUMN     "unusableAt" TIMESTAMP(3),
ADD COLUMN     "unusableNote" TEXT;

CREATE INDEX "ReturnCase_merchantId_reusedShopifyOrderId_idx" ON "ReturnCase"("merchantId", "reusedShopifyOrderId");

