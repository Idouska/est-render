-- Mode test : l'outil fonctionne, mais rien ne sort (ni Shopify, ni e-mail).
ALTER TABLE "Merchant" ADD COLUMN "testMode" BOOLEAN NOT NULL DEFAULT false;

-- Ce qui a été créé pendant le mode test, pour pouvoir l'effacer ensuite.
ALTER TABLE "Parcel" ADD COLUMN "test" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Refund" ADD COLUMN "test" BOOLEAN NOT NULL DEFAULT false;
