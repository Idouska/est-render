-- Preuves du retour : la photo de l'article, et le trajet du colis
-- (expédié / en transit) entre le bon envoyé et la réception par l'agence.

ALTER TYPE "ReturnStatus" ADD VALUE IF NOT EXISTS 'SHIPPED';
ALTER TYPE "ReturnStatus" ADD VALUE IF NOT EXISTS 'IN_TRANSIT';

ALTER TABLE "ReturnCase" ADD COLUMN "photoData" BYTEA;
ALTER TABLE "ReturnCase" ADD COLUMN "photoMime" TEXT;
