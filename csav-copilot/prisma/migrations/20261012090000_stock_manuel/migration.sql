-- Paires ajoutées au stock à la main (hors retours clients).
ALTER TABLE "ReturnCase" ADD COLUMN "origine" TEXT NOT NULL DEFAULT 'RETOUR';
