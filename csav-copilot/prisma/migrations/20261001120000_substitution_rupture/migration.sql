-- Les modèles de remplacement proposés à l'atelier pour une rupture :
-- une table, et non un fil de discussion.

-- CreateTable
CREATE TABLE "RuptureSubstitution" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "productTitle" TEXT NOT NULL,
    "variantTitle" TEXT,
    "sku" TEXT,
    "image" TEXT,
    "inventory" INTEGER,
    "libre" BOOLEAN NOT NULL DEFAULT false,
    "accepte" BOOLEAN,
    "note" TEXT,
    "reponduLe" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RuptureSubstitution_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RuptureSubstitution_merchantId_ticketId_idx" ON "RuptureSubstitution"("merchantId", "ticketId");

-- CreateIndex
CREATE INDEX "RuptureSubstitution_merchantId_supplierId_accepte_idx" ON "RuptureSubstitution"("merchantId", "supplierId", "accepte");

-- AddForeignKey
ALTER TABLE "RuptureSubstitution" ADD CONSTRAINT "RuptureSubstitution_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RuptureSubstitution" ADD CONSTRAINT "RuptureSubstitution_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RuptureSubstitution" ADD CONSTRAINT "RuptureSubstitution_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;
