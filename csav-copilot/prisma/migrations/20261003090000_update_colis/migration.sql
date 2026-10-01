-- « Update » : demander au fournisseur où en sont un ou plusieurs colis.
ALTER TYPE "SupplierAlertKind" ADD VALUE IF NOT EXISTS 'TRACKING';
