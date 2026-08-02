-- CreateEnum
CREATE TYPE "MerchantStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'UNINSTALLED');

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('OWNER', 'AGENT');

-- CreateEnum
CREATE TYPE "Intent" AS ENUM ('WISMO', 'RETURN', 'DISPUTE', 'REFUND', 'PRODUCT_QUESTION', 'POSITIVE', 'OTHER');

-- CreateEnum
CREATE TYPE "TicketStatus" AS ENUM ('NEW', 'PROCESSING', 'DRAFT_READY', 'NEEDS_REVIEW', 'AUTO_SENT', 'CLOSED', 'FAILED');

-- CreateEnum
CREATE TYPE "OrderMatchMethod" AS ENUM ('ORDER_NUMBER_IN_BODY', 'CUSTOMER_EMAIL', 'NAME_AND_RECENT_DATE', 'MANUAL');

-- CreateEnum
CREATE TYPE "MessageDirection" AS ENUM ('INBOUND', 'OUTBOUND');

-- CreateEnum
CREATE TYPE "DraftStatus" AS ENUM ('PENDING_REVIEW', 'EDITED', 'SENT', 'DISCARDED');

-- CreateEnum
CREATE TYPE "DraftAuthor" AS ENUM ('AI', 'HUMAN');

-- CreateEnum
CREATE TYPE "RefundKind" AS ENUM ('FULL', 'PARTIAL');

-- CreateEnum
CREATE TYPE "RefundStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "ActorType" AS ENUM ('USER', 'SYSTEM', 'AI');

-- CreateTable
CREATE TABLE "Merchant" (
    "id" TEXT NOT NULL,
    "shopDomain" TEXT NOT NULL,
    "name" TEXT,
    "status" "MerchantStatus" NOT NULL DEFAULT 'ACTIVE',
    "autoSendEnabled" BOOLEAN NOT NULL DEFAULT false,
    "autoSendThreshold" DOUBLE PRECISION NOT NULL DEFAULT 0.9,
    "retentionDays" INTEGER NOT NULL DEFAULT 365,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Merchant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "role" "UserRole" NOT NULL DEFAULT 'AGENT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShopifyConnection" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "accessTokenEnc" TEXT NOT NULL,
    "scopes" TEXT NOT NULL,
    "installedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uninstalledAt" TIMESTAMP(3),

    CONSTRAINT "ShopifyConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GmailConnection" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "emailAddress" TEXT NOT NULL,
    "refreshTokenEnc" TEXT NOT NULL,
    "accessTokenEnc" TEXT,
    "accessTokenExpiresAt" TIMESTAMP(3),
    "lastHistoryId" TEXT,
    "watchExpiration" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GmailConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Ticket" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "gmailThreadId" TEXT NOT NULL,
    "subject" TEXT,
    "customerEmail" TEXT NOT NULL,
    "customerName" TEXT,
    "intent" "Intent",
    "intentConfidence" DOUBLE PRECISION,
    "status" "TicketStatus" NOT NULL DEFAULT 'NEW',
    "shopifyOrderId" TEXT,
    "orderName" TEXT,
    "orderMatchMethod" "OrderMatchMethod",
    "orderMatchScore" DOUBLE PRECISION,
    "lastMessageAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Ticket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "gmailMessageId" TEXT NOT NULL,
    "direction" "MessageDirection" NOT NULL,
    "fromEmail" TEXT NOT NULL,
    "toEmail" TEXT,
    "subject" TEXT,
    "bodyText" TEXT NOT NULL,
    "snippet" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Draft" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "gmailDraftId" TEXT,
    "body" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "reasoning" TEXT,
    "status" "DraftStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "createdBy" "DraftAuthor" NOT NULL DEFAULT 'AI',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),

    CONSTRAINT "Draft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Refund" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "ticketId" TEXT,
    "shopifyOrderId" TEXT NOT NULL,
    "shopifyRefundId" TEXT,
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "kind" "RefundKind" NOT NULL,
    "status" "RefundStatus" NOT NULL DEFAULT 'PENDING',
    "errorMessage" TEXT,
    "requestedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "Refund_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "actorType" "ActorType" NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "targetType" TEXT,
    "targetId" TEXT,
    "metadata" JSONB,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Merchant_shopDomain_key" ON "Merchant"("shopDomain");

-- CreateIndex
CREATE INDEX "User_merchantId_idx" ON "User"("merchantId");

-- CreateIndex
CREATE UNIQUE INDEX "User_merchantId_email_key" ON "User"("merchantId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "ShopifyConnection_merchantId_key" ON "ShopifyConnection"("merchantId");

-- CreateIndex
CREATE UNIQUE INDEX "GmailConnection_merchantId_key" ON "GmailConnection"("merchantId");

-- CreateIndex
CREATE INDEX "Ticket_merchantId_status_idx" ON "Ticket"("merchantId", "status");

-- CreateIndex
CREATE INDEX "Ticket_merchantId_lastMessageAt_idx" ON "Ticket"("merchantId", "lastMessageAt");

-- CreateIndex
CREATE UNIQUE INDEX "Ticket_merchantId_gmailThreadId_key" ON "Ticket"("merchantId", "gmailThreadId");

-- CreateIndex
CREATE INDEX "Message_ticketId_receivedAt_idx" ON "Message"("ticketId", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Message_merchantId_gmailMessageId_key" ON "Message"("merchantId", "gmailMessageId");

-- CreateIndex
CREATE INDEX "Draft_merchantId_status_idx" ON "Draft"("merchantId", "status");

-- CreateIndex
CREATE INDEX "Draft_ticketId_idx" ON "Draft"("ticketId");

-- CreateIndex
CREATE INDEX "Refund_merchantId_createdAt_idx" ON "Refund"("merchantId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_merchantId_createdAt_idx" ON "AuditLog"("merchantId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_merchantId_action_idx" ON "AuditLog"("merchantId", "action");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShopifyConnection" ADD CONSTRAINT "ShopifyConnection_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GmailConnection" ADD CONSTRAINT "GmailConnection_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Draft" ADD CONSTRAINT "Draft_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
