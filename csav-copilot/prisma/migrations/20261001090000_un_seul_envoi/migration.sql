-- Un message ne part qu'une fois : l'envoi commencé est posé sur la ligne,
-- par une écriture conditionnelle, avant l'appel à Gmail. Deux colonnes
-- nullables, sans valeur par défaut : aucune réécriture de table.

-- AlterTable
ALTER TABLE "Draft" ADD COLUMN     "sendStartedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "SupplierEscalation" ADD COLUMN     "sendStartedAt" TIMESTAMP(3);
