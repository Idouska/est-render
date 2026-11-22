-- Shopify a répondu 401 : la clé d'accès enregistrée n'est plus acceptée.
ALTER TABLE "ShopifyConnection" ADD COLUMN "accesRefuseLe" TIMESTAMP(3);
