-- Bons de retour importés, transporteur du colis retour, commentaire de fermeture.
ALTER TABLE "ReturnCase" ADD COLUMN "trackingCarrier" TEXT;
ALTER TABLE "ReturnCase" ADD COLUMN "bonData" BYTEA;
ALTER TABLE "ReturnCase" ADD COLUMN "bonMime" TEXT;
ALTER TABLE "ReturnCase" ADD COLUMN "bonNom" TEXT;
ALTER TABLE "ReturnCase" ADD COLUMN "bonImporteLe" TIMESTAMP(3);
ALTER TABLE "ReturnCase" ADD COLUMN "bonEnvoyeLe" TIMESTAMP(3);
ALTER TABLE "ReturnCase" ADD COLUMN "closeComment" TEXT;

-- Cinq statuts seulement : Ouvert, Bon envoyé, Reçu et validé, Reçu et non
-- valide, Fermé. Les dossiers « Expédié », « En transit » et « Reçu »
-- repartent en « Ouvert », à la demande du marchand.
UPDATE "ReturnCase" SET "status" = 'OPEN' WHERE "status" IN ('SHIPPED', 'IN_TRANSIT', 'RECEIVED');
