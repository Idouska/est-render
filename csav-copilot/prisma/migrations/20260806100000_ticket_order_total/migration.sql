-- Montant de la commande rattachée, pour filtrer sans interroger Shopify.
ALTER TABLE "Ticket" ADD COLUMN "orderTotal" DECIMAL(12,2);
CREATE INDEX "Ticket_merchantId_orderTotal_idx" ON "Ticket"("merchantId", "orderTotal");
