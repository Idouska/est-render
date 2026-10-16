-- Quand les réponses déjà envoyées depuis Gmail ont été rangées dans leur
-- conversation : une seule fois par boîte. Nul tant que ce n'est pas fait.
ALTER TABLE "GmailConnection" ADD COLUMN "envoyesRattrapesAt" TIMESTAMP(3);
