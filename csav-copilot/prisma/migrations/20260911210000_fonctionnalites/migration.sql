-- Interrupteurs par boutique, réglés depuis la console d'administration.
-- Vide : tout est allumé, comme avant.
ALTER TABLE "Merchant" ADD COLUMN "fonctionnalites" JSONB NOT NULL DEFAULT '{}';
