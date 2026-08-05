-- Qualité des réponses : règles de la boutique, langue, échéances, réponses types.

ALTER TABLE "Merchant" ADD COLUMN "playbook" TEXT;
ALTER TABLE "Merchant" ADD COLUMN "slaHours" INTEGER NOT NULL DEFAULT 24;

ALTER TABLE "Ticket" ADD COLUMN "language" TEXT;
ALTER TABLE "Ticket" ADD COLUMN "dueAt" TIMESTAMP(3);
ALTER TABLE "Ticket" ADD COLUMN "snoozedUntil" TIMESTAMP(3);

CREATE INDEX "Ticket_merchantId_dueAt_idx" ON "Ticket"("merchantId", "dueAt");

CREATE TABLE "CannedReply" (
  "id" TEXT NOT NULL,
  "merchantId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "intent" "Intent",
  "useCount" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CannedReply_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CannedReply_merchantId_title_key" ON "CannedReply"("merchantId", "title");
CREATE INDEX "CannedReply_merchantId_intent_idx" ON "CannedReply"("merchantId", "intent");

ALTER TABLE "CannedReply" ADD CONSTRAINT "CannedReply_merchantId_fkey"
  FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
