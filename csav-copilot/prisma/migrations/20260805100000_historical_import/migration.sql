-- Tickets importés de l'historique Gmail : matière d'apprentissage, hors statistiques.
ALTER TABLE "Ticket" ADD COLUMN "isHistorical" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "Ticket_merchantId_isHistorical_idx" ON "Ticket"("merchantId", "isHistorical");
