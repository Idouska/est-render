import type { IngestJob, TicketJob } from './types.ts';

/*
 * Identifiants de tâches, isolés du module de files.
 *
 * Séparés pour deux raisons. La première : `queue/index.ts` ouvre des
 * connexions Redis dès son chargement, ce qui rend ces quelques lignes
 * impossibles à vérifier sans infrastructure. La seconde : elles ont cassé la
 * production en silence, et ce qui casse en silence doit être testable.
 *
 * BullMQ réserve les deux-points à ses propres clés Redis et rejette tout
 * identifiant qui en contient — « Custom Id cannot contain : ». L'erreur ne
 * survient qu'à la mise en file, donc après la création du ticket : le mail
 * entrait bien en base, l'IA n'était jamais saisie, et le webhook Pub/Sub
 * échouait en boucle sans que rien ne l'indique à l'écran.
 */

export function ingestJobId(job: IngestJob, bucket: number): string {
  return `ingest-${job.merchantId}-${job.mailboxId ?? 'default'}-${bucket}`;
}

export function ticketJobId(job: TicketJob): string {
  return `ticket-${job.ticketId}`;
}
