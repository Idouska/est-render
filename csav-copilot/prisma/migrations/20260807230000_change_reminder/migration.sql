-- Rappel unique au fournisseur resté muet sur une demande de changement.
ALTER TABLE "SupplierAlert" ADD COLUMN "remindedAt" TIMESTAMP(3);
