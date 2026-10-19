-- Échange contre un autre modèle : les prix, l'écart et le lien de paiement.
ALTER TABLE "ReturnCase" ADD COLUMN "prixRetour" DECIMAL(12,2),
ADD COLUMN "prixVoulu" DECIMAL(12,2),
ADD COLUMN "ecartPrix" DECIMAL(12,2),
ADD COLUMN "devise" TEXT,
ADD COLUMN "ecartChoix" TEXT,
ADD COLUMN "draftOrderId" TEXT,
ADD COLUMN "lienPaiement" TEXT,
ADD COLUMN "lienEnvoyeLe" TIMESTAMP(3),
ADD COLUMN "lienErreur" TEXT,
ADD COLUMN "payeLe" TIMESTAMP(3);

-- « À rembourser » peut venir d'un dossier de retour, sans ticket.
ALTER TABLE "RemboursementAFaire" ALTER COLUMN "ticketId" DROP NOT NULL,
ADD COLUMN "returnCaseId" TEXT,
ADD COLUMN "motif" TEXT,
ADD COLUMN "clientNom" TEXT,
ADD COLUMN "clientEmail" TEXT;
