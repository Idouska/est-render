-- Pièces jointes des messages clients : métadonnées seules, le fichier reste chez Gmail.
CREATE TABLE "Attachment" (
  "id" TEXT NOT NULL,
  "merchantId" TEXT NOT NULL,
  "messageId" TEXT NOT NULL,
  "gmailAttachmentId" TEXT NOT NULL,
  "filename" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "size" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Attachment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Attachment_messageId_idx" ON "Attachment"("messageId");
CREATE INDEX "Attachment_merchantId_idx" ON "Attachment"("merchantId");

ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_messageId_fkey"
  FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;
