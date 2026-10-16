-- La réponse du marchand à l'atelier sur une rupture : une consigne en
-- champs (attendre, remplacer, ne pas expédier, message), que l'atelier
-- confirme d'un bouton.

-- CreateEnum
CREATE TYPE "ConsigneChoix" AS ENUM ('ATTENDRE', 'REMPLACER', 'ANNULER', 'MESSAGE');

-- CreateEnum
CREATE TYPE "ConsigneReponse" AS ENUM ('COMPRIS', 'IMPOSSIBLE', 'REPONDU');

-- CreateTable
CREATE TABLE "RuptureConsigne" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "choix" "ConsigneChoix" NOT NULL,
    "expedierAvant" TIMESTAMP(3),
    "modeles" JSONB,
    "articlesCommande" INTEGER,
    "mot" TEXT,
    "motTraduit" JSONB,
    "reponse" "ConsigneReponse",
    "modeleChoisi" INTEGER,
    "reponseNote" TEXT,
    "reponseNoteFr" TEXT,
    "reponduLe" TIMESTAMP(3),
    "remplaceeLe" TIMESTAMP(3),
    "avisLe" TIMESTAMP(3),
    "rappelLe" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RuptureConsigne_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RuptureConsigne_merchantId_ticketId_idx" ON "RuptureConsigne"("merchantId", "ticketId");

-- CreateIndex
CREATE INDEX "RuptureConsigne_merchantId_supplierId_reponse_idx" ON "RuptureConsigne"("merchantId", "supplierId", "reponse");

-- AddForeignKey
ALTER TABLE "RuptureConsigne" ADD CONSTRAINT "RuptureConsigne_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RuptureConsigne" ADD CONSTRAINT "RuptureConsigne_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RuptureConsigne" ADD CONSTRAINT "RuptureConsigne_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;
