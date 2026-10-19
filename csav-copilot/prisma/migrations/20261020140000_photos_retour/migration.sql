-- Plusieurs photos par retour, et qui les a prises : trois au moins avant de
-- valider un échange ou un remboursement, ou de refuser le retour.
CREATE TABLE "ReturnPhoto" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "returnCaseId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "mime" TEXT NOT NULL,
    "attachmentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReturnPhoto_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ReturnPhoto_returnCaseId_idx" ON "ReturnPhoto"("returnCaseId");
CREATE INDEX "ReturnPhoto_merchantId_idx" ON "ReturnPhoto"("merchantId");

ALTER TABLE "ReturnPhoto" ADD CONSTRAINT "ReturnPhoto_returnCaseId_fkey" FOREIGN KEY ("returnCaseId") REFERENCES "ReturnCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ReturnCase" ADD COLUMN "refuseLe" TIMESTAMP(3),
ADD COLUMN "refusMotif" TEXT;

-- L'ancienne photo unique devient la première photo du dossier.
INSERT INTO "ReturnPhoto" ("id", "merchantId", "returnCaseId", "source", "data", "mime", "createdAt")
SELECT 'rp_' || "id", "merchantId", "id", 'MARCHAND', "photoData", "photoMime", "updatedAt"
FROM "ReturnCase"
WHERE "photoData" IS NOT NULL AND "photoMime" IS NOT NULL;
