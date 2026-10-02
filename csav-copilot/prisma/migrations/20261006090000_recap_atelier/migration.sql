-- Récapitulatif quotidien de l'atelier.
ALTER TABLE "Supplier" ADD COLUMN "recapLe" TIMESTAMP(3);
ALTER TABLE "RuptureSubstitution" ADD COLUMN "avisLe" TIMESTAMP(3);
ALTER TABLE "RuptureSubstitution" ADD COLUMN "rappelLe" TIMESTAMP(3);

-- Les propositions déjà faites ont eu leur avis par mail, à l'époque où il
-- partait sur-le-champ : le récapitulatif ne doit pas les annoncer une
-- seconde fois.
UPDATE "RuptureSubstitution" SET "avisLe" = "createdAt";
