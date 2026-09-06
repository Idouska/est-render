-- Trace des passages du cron.
--
-- Un cron mort n'échoue pas, il se tait : le code de sortie 1 ne couvre que
-- l'échec d'une exécution qui a lieu. Cette table permet de surveiller
-- l'absence de passage, seul signal disponible quand le service lui-même a
-- disparu.

CREATE TABLE "CronRun" (
    "id" TEXT NOT NULL,
    "task" TEXT NOT NULL,
    "ranAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ok" BOOLEAN NOT NULL,
    "detail" JSONB,

    CONSTRAINT "CronRun_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CronRun_task_ranAt_idx" ON "CronRun"("task", "ranAt");
