-- Les comptes de l'agence : un Propriétaire automatique sur chaque boutique.
CREATE TABLE "AgenceAdmin" (
  "id" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AgenceAdmin_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AgenceAdmin_email_key" ON "AgenceAdmin"("email");

ALTER TABLE "User" ADD COLUMN "agence" BOOLEAN NOT NULL DEFAULT false;
