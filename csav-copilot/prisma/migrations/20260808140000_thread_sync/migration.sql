-- Relecture du fil Gmail : les réponses de l'équipe n'entraient jamais en
-- base, l'ingestion ne ramassant que la boîte de réception. Ce marqueur dit
-- qu'un ticket a déjà été relu, pour ne pas rappeler Gmail à chaque ouverture.

ALTER TABLE "Ticket" ADD COLUMN "threadSyncedAt" TIMESTAMP(3);
