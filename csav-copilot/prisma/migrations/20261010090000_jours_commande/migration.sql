-- Fournisseurs qui ne prennent que les commandes des jours pairs ou impairs.
ALTER TABLE "Supplier" ADD COLUMN "joursCommande" TEXT NOT NULL DEFAULT 'TOUS';
