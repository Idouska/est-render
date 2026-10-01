-- L'envoi des commandes de la veille au fournisseur : réglage manuel ou
-- automatique, et le journal qui empêche une commande de partir deux fois.

-- CreateEnum
CREATE TYPE "EnvoiMode" AS ENUM ('MANUEL', 'AUTO');

-- AlterTable
ALTER TABLE "Merchant" ADD COLUMN     "envoiDepuis" TIMESTAMP(3),
ADD COLUMN     "envoiHeure" INTEGER NOT NULL DEFAULT 9,
ADD COLUMN     "envoiMode" "EnvoiMode" NOT NULL DEFAULT 'MANUEL';

-- CreateTable
CREATE TABLE "EnvoiFournisseur" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "mode" "EnvoiMode" NOT NULL,
    "userId" TEXT,
    "combien" INTEGER NOT NULL,
    "emailedAt" TIMESTAMP(3),
    "erreur" TEXT,
    "simule" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EnvoiFournisseur_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EnvoiCommande" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "envoiId" TEXT NOT NULL,
    "shopifyOrderId" TEXT NOT NULL,
    "orderName" TEXT NOT NULL,

    CONSTRAINT "EnvoiCommande_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EnvoiFournisseur_merchantId_createdAt_idx" ON "EnvoiFournisseur"("merchantId", "createdAt");

-- CreateIndex
CREATE INDEX "EnvoiCommande_envoiId_idx" ON "EnvoiCommande"("envoiId");

-- CreateIndex
CREATE UNIQUE INDEX "EnvoiCommande_merchantId_shopifyOrderId_key" ON "EnvoiCommande"("merchantId", "shopifyOrderId");

-- AddForeignKey
ALTER TABLE "EnvoiFournisseur" ADD CONSTRAINT "EnvoiFournisseur_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnvoiFournisseur" ADD CONSTRAINT "EnvoiFournisseur_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnvoiCommande" ADD CONSTRAINT "EnvoiCommande_envoiId_fkey" FOREIGN KEY ("envoiId") REFERENCES "EnvoiFournisseur"("id") ON DELETE CASCADE ON UPDATE CASCADE;
