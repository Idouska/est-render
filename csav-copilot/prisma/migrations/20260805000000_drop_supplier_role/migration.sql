-- Le rôle du fournisseur disparaît : « Fournisseur / Transporteur / Atelier /
-- Entrepôt » décrivait un métier, pas un droit, et personne ne savait quoi
-- choisir. Un contact fournisseur a désormais un seul jeu de capacités.
ALTER TABLE "Supplier" DROP COLUMN "role";
DROP TYPE "SupplierRole";
