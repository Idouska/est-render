-- Plusieurs boîtes mail par boutique.

DROP INDEX "GmailConnection_merchantId_key";

ALTER TABLE "GmailConnection" ADD COLUMN "label" TEXT;
ALTER TABLE "GmailConnection" ADD COLUMN "isDefault" BOOLEAN NOT NULL DEFAULT false;

-- La boîte déjà connectée devient celle par défaut : sans ça, la première
-- réponse envoyée après migration ne saurait plus de quelle adresse partir.
UPDATE "GmailConnection" SET "isDefault" = true;

CREATE UNIQUE INDEX "GmailConnection_merchantId_emailAddress_key"
  ON "GmailConnection"("merchantId", "emailAddress");
CREATE INDEX "GmailConnection_merchantId_isDefault_idx"
  ON "GmailConnection"("merchantId", "isDefault");

ALTER TABLE "Ticket" ADD COLUMN "mailboxId" TEXT;
CREATE INDEX "Ticket_merchantId_mailboxId_idx" ON "Ticket"("merchantId", "mailboxId");

-- SET NULL : débrancher une boîte ne doit pas emporter l'historique des
-- tickets qu'elle a reçus.
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_mailboxId_fkey"
  FOREIGN KEY ("mailboxId") REFERENCES "GmailConnection"("id") ON DELETE SET NULL ON UPDATE CASCADE;
