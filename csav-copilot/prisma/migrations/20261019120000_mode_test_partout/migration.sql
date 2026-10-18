-- Mode test : les signalements, décisions, remboursements à faire et retours
-- créés pendant un test sont marqués, pour que « Effacer les données de test »
-- les emporte.

-- AlterTable
ALTER TABLE "Ticket" ADD COLUMN "test" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "RuptureConsigne" ADD COLUMN "test" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "RemboursementAFaire" ADD COLUMN "test" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "ReturnCase" ADD COLUMN "test" BOOLEAN NOT NULL DEFAULT false;
