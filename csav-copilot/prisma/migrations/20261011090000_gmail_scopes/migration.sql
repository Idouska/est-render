-- Autorisations Google accordées par chaque boîte.
ALTER TABLE "GmailConnection" ADD COLUMN "scopes" TEXT;
