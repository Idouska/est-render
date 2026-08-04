-- Lien de travail permanent du fournisseur, révocable par incrément de version.
ALTER TABLE "Supplier" ADD COLUMN "portalTokenVersion" INTEGER NOT NULL DEFAULT 1;
