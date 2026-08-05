-- Résumé du message client, pour décider sans lire le fil.
ALTER TABLE "Draft" ADD COLUMN "summary" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Draft" ADD COLUMN "ask" TEXT;
