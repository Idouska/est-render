-- Les déclinaisons que l'atelier déclare indisponibles chez lui.
CREATE TABLE "SupplierIndisponible" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "productTitle" TEXT NOT NULL,
    "variantTitle" TEXT,
    "sku" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SupplierIndisponible_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SupplierIndisponible_merchantId_supplierId_variantId_key" ON "SupplierIndisponible"("merchantId", "supplierId", "variantId");
CREATE INDEX "SupplierIndisponible_merchantId_idx" ON "SupplierIndisponible"("merchantId");
