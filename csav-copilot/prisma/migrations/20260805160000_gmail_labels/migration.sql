-- Libellés Gmail du fil, pour retrouver dans l'outil le classement de la boîte.
ALTER TABLE "Ticket" ADD COLUMN "labels" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
