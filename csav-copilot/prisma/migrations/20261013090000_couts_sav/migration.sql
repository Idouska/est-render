-- Ce que coûte le SAV, mois par mois : les coûts unitaires de la boutique, et
-- les deux dates qui manquaient pour dater une dépense (bon fourni, paire reçue).
ALTER TABLE "Merchant" ADD COLUMN "coutsSav" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "ReturnCase" ADD COLUMN "labelSentAt" TIMESTAMP(3);
ALTER TABLE "ReturnCase" ADD COLUMN "receivedAt" TIMESTAMP(3);

-- Bon fourni : la date du journal quand il l'a gardée, sinon l'ouverture du dossier.
UPDATE "ReturnCase" r SET "labelSentAt" = COALESCE(
  (SELECT MIN(a."createdAt") FROM "AuditLog" a
    WHERE a."merchantId" = r."merchantId" AND a."targetType" = 'return' AND a."targetId" = r."id"
      AND a."action" = 'return.updated' AND a."metadata"->>'labelSent' = 'true'),
  r."createdAt")
WHERE r."labelSent" = true;

-- Inutilisable par la fiche du dossier : aucune date n'était posée.
UPDATE "ReturnCase" r SET "unusableAt" = COALESCE(
  (SELECT MIN(a."createdAt") FROM "AuditLog" a
    WHERE a."merchantId" = r."merchantId" AND a."targetType" = 'return' AND a."targetId" = r."id"
      AND a."action" = 'return.updated' AND a."metadata"->>'status' = 'UNUSABLE'),
  r."updatedAt")
WHERE r."status" = 'UNUSABLE' AND r."unusableAt" IS NULL;

-- Paire reçue : son premier passage à « reçu », « en stock » ou « inutilisable ».
UPDATE "ReturnCase" r SET "receivedAt" = COALESCE(
  (SELECT MIN(a."createdAt") FROM "AuditLog" a
    WHERE a."merchantId" = r."merchantId" AND a."targetType" = 'return' AND a."targetId" = r."id"
      AND a."action" = 'return.updated' AND a."metadata"->>'status' IN ('RECEIVED', 'RESTOCKED', 'UNUSABLE')),
  r."restockedAt", r."unusableAt", r."updatedAt")
WHERE r."origine" = 'RETOUR'
  AND (r."status" IN ('RECEIVED', 'RESTOCKED', 'UNUSABLE') OR r."restockedAt" IS NOT NULL OR r."unusableAt" IS NOT NULL);
