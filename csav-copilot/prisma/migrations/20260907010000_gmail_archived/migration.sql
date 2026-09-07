-- État « archivé dans Gmail » du fil.
--
-- Archiver est le geste par lequel une équipe dit « j'en ai fini ». La file
-- s'en sert pour n'appuyer en gras que ce qui reste à traiter, et pour ranger
-- le reste dans un dossier Archivés plutôt que de le laisser dans la
-- réception.
--
-- Faux par défaut, y compris pour les milliers de fils déjà en base : un fil
-- dont on ne sait rien est réputé à traiter. Se tromper dans ce sens fait voir
-- un message de trop ; l'inverse le ferait disparaître sans que personne ne
-- s'en aperçoive.

ALTER TABLE "Ticket" ADD COLUMN "gmailArchived" BOOLEAN NOT NULL DEFAULT false;

-- La file filtre sur ce champ à chaque affichage, marchand par marchand.
CREATE INDEX "Ticket_merchantId_gmailArchived_idx" ON "Ticket"("merchantId", "gmailArchived");
