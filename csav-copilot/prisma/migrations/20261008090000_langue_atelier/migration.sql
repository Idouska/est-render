-- Langue des mails envoyés à l'atelier.
ALTER TABLE "Supplier" ADD COLUMN "langue" TEXT NOT NULL DEFAULT 'fr';
