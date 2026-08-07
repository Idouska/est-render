-- Prise en compte par le marchand de la réponse du fournisseur : sans elle,
-- une demande confirmée resterait comptée à traiter pour toujours.
ALTER TABLE "SupplierAlert" ADD COLUMN "handledAt" TIMESTAMP(3);

-- Les demandes déjà répondues avant cette migration sont considérées traitées :
-- les faire ressurgir en rouge présenterait du travail ancien comme du neuf.
UPDATE "SupplierAlert" SET "handledAt" = "acknowledgedAt"
WHERE "status" <> 'PENDING' AND "acknowledgedAt" IS NOT NULL;
