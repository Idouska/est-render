-- L'envoi de l'échange : par l'agence si la paire est en stock, sinon par
-- l'atelier du modèle.
ALTER TABLE "ReturnCase" ADD COLUMN     "exchangeCarrier" TEXT,
ADD COLUMN     "exchangeNotifiedAt" TIMESTAMP(3),
ADD COLUMN     "exchangeShippedAt" TIMESTAMP(3),
ADD COLUMN     "exchangeStockCaseId" TEXT,
ADD COLUMN     "exchangeSupplierId" TEXT,
ADD COLUMN     "exchangeTrackingNumber" TEXT,
ADD COLUMN     "reusedReturnCaseId" TEXT;

CREATE INDEX "ReturnCase_merchantId_exchangeSupplierId_idx" ON "ReturnCase"("merchantId", "exchangeSupplierId");

CREATE INDEX "ReturnCase_merchantId_exchangeStockCaseId_idx" ON "ReturnCase"("merchantId", "exchangeStockCaseId");

