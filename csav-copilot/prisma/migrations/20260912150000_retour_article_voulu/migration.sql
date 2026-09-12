-- L'article que le client veut à la place, pour un échange.
ALTER TABLE "ReturnCase" ADD COLUMN     "wantedSku" TEXT,
ADD COLUMN     "wantedTitle" TEXT,
ADD COLUMN     "wantedVariantTitle" TEXT;

