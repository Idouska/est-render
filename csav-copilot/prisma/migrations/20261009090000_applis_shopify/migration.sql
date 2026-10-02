-- Une appli Shopify par boutique (distribution personnalisée).
CREATE TABLE "ShopifyApp" (
    "id" TEXT NOT NULL,
    "shopDomain" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "clientSecretEnc" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShopifyApp_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ShopifyApp_shopDomain_key" ON "ShopifyApp"("shopDomain");
