-- L'agence dans la boucle : la version de son lien de travail, et l'envoi
-- qu'elle fait pour une commande servie par le stock retours.
ALTER TABLE "ReturnCase" ADD COLUMN     "reshipCarrier" TEXT,
ADD COLUMN     "reshipTrackingNumber" TEXT,
ADD COLUMN     "reshippedAt" TIMESTAMP(3);

ALTER TABLE "ReturnAgency" ADD COLUMN     "portalTokenVersion" INTEGER NOT NULL DEFAULT 1;

