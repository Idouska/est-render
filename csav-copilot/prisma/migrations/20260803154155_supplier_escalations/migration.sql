-- CreateEnum
CREATE TYPE "EscalationReason" AS ENUM ('OUT_OF_STOCK', 'INCORRECT_ADDRESS', 'MISSING_ITEM', 'OTHER');

-- CreateEnum
CREATE TYPE "EscalationStatus" AS ENUM ('DRAFTING', 'OPEN', 'ANSWERED', 'RESOLVED');

-- CreateEnum
CREATE TYPE "SupplierMessageDirection" AS ENUM ('TO_SUPPLIER', 'FROM_SUPPLIER');

-- CreateEnum
CREATE TYPE "SupplierMessageAuthor" AS ENUM ('AI', 'HUMAN', 'SUPPLIER');

-- AlterEnum
ALTER TYPE "ActorType" ADD VALUE 'SUPPLIER';

-- AlterEnum
ALTER TYPE "TicketStatus" ADD VALUE 'AWAITING_SUPPLIER';

-- CreateTable
CREATE TABLE "Supplier" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contactEmail" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierEscalation" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "reason" "EscalationReason" NOT NULL,
    "note" TEXT,
    "status" "EscalationStatus" NOT NULL DEFAULT 'DRAFTING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notifiedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "SupplierEscalation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierMessage" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "escalationId" TEXT NOT NULL,
    "direction" "SupplierMessageDirection" NOT NULL,
    "authorType" "SupplierMessageAuthor" NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplierMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Supplier_merchantId_key" ON "Supplier"("merchantId");

-- CreateIndex
CREATE INDEX "SupplierEscalation_merchantId_status_idx" ON "SupplierEscalation"("merchantId", "status");

-- CreateIndex
CREATE INDEX "SupplierEscalation_ticketId_idx" ON "SupplierEscalation"("ticketId");

-- CreateIndex
CREATE INDEX "SupplierMessage_escalationId_createdAt_idx" ON "SupplierMessage"("escalationId", "createdAt");

-- AddForeignKey
ALTER TABLE "Supplier" ADD CONSTRAINT "Supplier_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierEscalation" ADD CONSTRAINT "SupplierEscalation_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierEscalation" ADD CONSTRAINT "SupplierEscalation_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierEscalation" ADD CONSTRAINT "SupplierEscalation_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierMessage" ADD CONSTRAINT "SupplierMessage_escalationId_fkey" FOREIGN KEY ("escalationId") REFERENCES "SupplierEscalation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
