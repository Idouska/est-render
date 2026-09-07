-- État « non lu » du fil dans Gmail.
--
-- C'est lui qui décide du gras dans la file : un message qu'on n'a pas encore
-- ouvert s'appuie, les autres s'effacent. Distinct de l'archivage — lire n'est
-- pas ranger, et les deux états coexistent sur le même fil.
--
-- Vrai par défaut, y compris pour les fils déjà en base : un fil dont on ne
-- sait rien est réputé non lu. Se tromper dans ce sens fait voir un message de
-- trop ; l'inverse l'éteindrait avant que quiconque l'ait ouvert.

ALTER TABLE "Ticket" ADD COLUMN "gmailUnread" BOOLEAN NOT NULL DEFAULT true;

-- La pastille « SAV client » compte les non lus à chaque chargement.
CREATE INDEX "Ticket_merchantId_gmailUnread_idx" ON "Ticket"("merchantId", "gmailUnread");
