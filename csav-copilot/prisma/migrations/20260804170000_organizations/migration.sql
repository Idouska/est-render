-- Regroupement multi-boutiques.

CREATE TABLE "Organization" (
  "id" TEXT NOT NULL,
  "name" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Merchant" ADD COLUMN "organizationId" TEXT;

-- Chaque boutique existante reçoit sa propre organisation : sans ça, la liste
-- des boutiques d'un utilisateur serait vide et le sélecteur n'afficherait même
-- pas la boutique en cours.
INSERT INTO "Organization" ("id", "name")
SELECT 'org_' || "id", COALESCE("brandName", "name", "shopDomain") FROM "Merchant";

UPDATE "Merchant" SET "organizationId" = 'org_' || "id";

CREATE INDEX "Merchant_organizationId_idx" ON "Merchant"("organizationId");

ALTER TABLE "Merchant" ADD CONSTRAINT "Merchant_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;
