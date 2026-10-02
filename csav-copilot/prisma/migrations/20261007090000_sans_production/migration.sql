-- Plus d'étape « en production » : une commande de lot est à préparer, puis
-- expédiée dès qu'un colis est saisi.
ALTER TABLE "EnvoiCommande" DROP COLUMN "enProductionLe";
