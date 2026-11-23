-- Google refuse l'accès à la boîte (autorisation retirée) : noté une fois,
-- pour prévenir l'équipe une seule fois et l'afficher dans les Réglages.
ALTER TABLE "GmailConnection" ADD COLUMN "panneLe" TIMESTAMP(3);
ALTER TABLE "GmailConnection" ADD COLUMN "panneMotif" TEXT;
