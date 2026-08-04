-- Assignation d'un ticket à un agent.

ALTER TABLE "Ticket" ADD COLUMN "assignedToId" TEXT;

CREATE INDEX "Ticket_merchantId_assignedToId_idx" ON "Ticket"("merchantId", "assignedToId");

-- ON DELETE SET NULL : désactiver un compte se fait sans supprimer sa ligne,
-- mais si une suppression a lieu, le ticket revient au pot commun plutôt que
-- de bloquer l'opération.
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_assignedToId_fkey"
  FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
