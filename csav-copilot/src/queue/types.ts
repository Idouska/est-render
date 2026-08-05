/** Formes des tâches, isolées des files pour rester importables sans Redis. */

export interface IngestJob {
  merchantId: string;
  /** Boîte concernée : chacune a son propre curseur d'historique Gmail. */
  mailboxId?: string;
  /** historyId annoncé par la notification Pub/Sub, à titre de trace. */
  historyId?: string;
}

export interface TicketJob {
  merchantId: string;
  ticketId: string;
}
