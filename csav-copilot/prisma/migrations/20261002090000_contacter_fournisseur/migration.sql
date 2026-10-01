-- Deux motifs de plus pour la fenêtre « Contacter le fournisseur » : toute
-- demande à l'atelier passe désormais par elle, et se répond d'un bouton.
ALTER TYPE "SupplierAlertKind" ADD VALUE IF NOT EXISTS 'MISSING_ITEM';
ALTER TYPE "SupplierAlertKind" ADD VALUE IF NOT EXISTS 'DELAY';
