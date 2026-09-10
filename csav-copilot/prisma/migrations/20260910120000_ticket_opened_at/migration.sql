-- Quand quelqu'un de l'équipe a ouvert ce message DANS L'OUTIL.
--
-- Distinct de `gmailUnread`, et il le faut : cette colonne-là appartient à
-- Gmail. La synchronisation la réécrit à chaque passage d'après les libellés
-- du fil, si bien qu'un « lu » posé ici serait effacé au tour suivant — le
-- gras se rallumerait tout seul, une minute après avoir été éteint.
--
-- L'outil n'a que le périmètre `gmail.readonly` : il ne peut pas retirer le
-- libellé UNREAD chez Google. Ouvrir un message ici ne le marque donc pas lu
-- dans Gmail, et c'est assumé — ce champ dit « quelqu'un de l'équipe a vu ce
-- message dans cSAV », ce qui est l'information dont la file a besoin.
--
-- Nul par défaut : aucun des fils déjà en base n'a été ouvert ici, et rien ne
-- permet de deviner lesquels l'auraient été. Se tromper dans ce sens laisse
-- un message en gras de trop ; l'inverse l'éteindrait avant que quiconque
-- l'ait vu.
ALTER TABLE "Ticket" ADD COLUMN "openedAt" TIMESTAMP(3);

-- Les trois compteurs de « non lu » filtrent désormais sur les deux colonnes
-- ensemble : le libellé Gmail ET l'absence d'ouverture dans l'outil.
CREATE INDEX "Ticket_merchantId_gmailUnread_openedAt_idx"
  ON "Ticket"("merchantId", "gmailUnread", "openedAt");
