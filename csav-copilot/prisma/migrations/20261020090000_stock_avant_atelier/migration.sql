-- « Laisser au fournisseur » gardé en base : l'envoi automatique retient les
-- commandes que le stock retours peut servir tant qu'elles ne sont pas tranchées.
CREATE TABLE "CommandeLaissee" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "shopifyOrderId" TEXT NOT NULL,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommandeLaissee_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CommandeLaissee_merchantId_shopifyOrderId_key" ON "CommandeLaissee"("merchantId", "shopifyOrderId");

ALTER TABLE "CommandeLaissee" ADD CONSTRAINT "CommandeLaissee_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Un atelier ne voit plus que les commandes qu'on lui a confiées : celles
-- d'avant le contrôle du stock retours lui restent cachées.
UPDATE "Supplier" SET "ordersAccess" = 'ASSIGNED' WHERE "ordersAccess" = 'ALL';
