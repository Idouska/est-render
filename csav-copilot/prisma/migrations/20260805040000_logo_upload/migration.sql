-- Logo téléversé depuis l'application, en plus du logo par URL.
ALTER TABLE "Merchant" ADD COLUMN "logoData" BYTEA;
ALTER TABLE "Merchant" ADD COLUMN "logoMime" TEXT;
