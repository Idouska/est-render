-- Les commandes de lot en retard : le délai réglé par le marchand, et le
-- rappel unique envoyé à l'atelier.
ALTER TABLE "Merchant" ADD COLUMN "lotDelaiJours" INTEGER NOT NULL DEFAULT 2;
ALTER TABLE "EnvoiCommande" ADD COLUMN "rappeleLe" TIMESTAMP(3);
