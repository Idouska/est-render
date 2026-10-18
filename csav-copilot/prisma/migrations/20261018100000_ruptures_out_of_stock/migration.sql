-- La note « Out of stock » : le mail au client automatique (au choix), la
-- relance d'un restock, et les remboursements décidés dans Ruptures de stock.

-- AlterTable
ALTER TABLE "Merchant" ADD COLUMN "mailRuptureAuto" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "RuptureConsigne" ADD COLUMN "relancerLe" TIMESTAMP(3),
ADD COLUMN "relanceFaiteLe" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "RemboursementAFaire" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "consigneId" TEXT,
    "orderName" TEXT,
    "shopifyOrderId" TEXT,
    "article" TEXT NOT NULL,
    "montant" DECIMAL(12,2),
    "devise" TEXT,
    "demandeParId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "faitLe" TIMESTAMP(3),
    "refundId" TEXT,

    CONSTRAINT "RemboursementAFaire_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RemboursementAFaire_merchantId_faitLe_idx" ON "RemboursementAFaire"("merchantId", "faitLe");

-- CreateIndex
CREATE INDEX "RemboursementAFaire_ticketId_idx" ON "RemboursementAFaire"("ticketId");

-- AddForeignKey
ALTER TABLE "RemboursementAFaire" ADD CONSTRAINT "RemboursementAFaire_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RemboursementAFaire" ADD CONSTRAINT "RemboursementAFaire_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;
