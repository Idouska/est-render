-- « Attendre encore » sur la page Update : le colis bloqué sort de « À demander » jusqu'à la date.
CREATE TABLE "UpdateReporte" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "shopifyOrderId" TEXT NOT NULL,
    "jusqua" TIMESTAMP(3) NOT NULL,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UpdateReporte_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UpdateReporte_merchantId_shopifyOrderId_key" ON "UpdateReporte"("merchantId", "shopifyOrderId");

ALTER TABLE "UpdateReporte" ADD CONSTRAINT "UpdateReporte_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
