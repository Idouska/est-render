-- Étendue des commandes visibles par un fournisseur depuis son lien.

CREATE TYPE "SupplierOrderAccess" AS ENUM ('NONE', 'ASSIGNED', 'ALL');

-- Par défaut, le minimum : jusqu'ici tout fournisseur voyait l'intégralité du
-- carnet, y compris les clients d'un autre prestataire. Les liens déjà émis
-- se retrouvent donc restreints, ce qui est le comportement voulu.
ALTER TABLE "Supplier"
  ADD COLUMN "ordersAccess" "SupplierOrderAccess" NOT NULL DEFAULT 'ASSIGNED';
