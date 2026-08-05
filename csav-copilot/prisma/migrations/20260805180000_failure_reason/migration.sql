-- Raison de l'échec de traitement, pour que « Échec » cesse d'être muet.
ALTER TABLE "Ticket" ADD COLUMN "failureReason" TEXT;
