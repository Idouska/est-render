-- Retour/Échange : la paire retournée reçue et contrôlée, avant de valider l'échange.

-- AlterTable
ALTER TABLE "ReturnCase" ADD COLUMN "controleLe" TIMESTAMP(3);
