-- Le lot du jour suivi dans l'atelier : les articles de chaque commande
-- envoyée, et le moment où l'atelier la lance en production.
ALTER TABLE "EnvoiCommande" ADD COLUMN "articles" TEXT;
ALTER TABLE "EnvoiCommande" ADD COLUMN "enProductionLe" TIMESTAMP(3);
