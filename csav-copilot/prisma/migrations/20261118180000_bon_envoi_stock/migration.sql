-- Le bon d'expédition d'une paire servie depuis le stock.
ALTER TABLE "ReturnCase" ADD COLUMN "reshipBonData" BYTEA;
ALTER TABLE "ReturnCase" ADD COLUMN "reshipBonMime" TEXT;
ALTER TABLE "ReturnCase" ADD COLUMN "reshipBonNom" TEXT;
