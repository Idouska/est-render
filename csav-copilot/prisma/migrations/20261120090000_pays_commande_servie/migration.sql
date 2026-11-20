-- Le pays de destination de la commande servie par une paire du stock.
-- L'écran Stock affichait le pays de la paire, donc « — » pour une paire
-- « chez vous » ; il affiche maintenant celui de la commande.
ALTER TABLE "ReturnCase" ADD COLUMN "reusedCountry" TEXT;
