/** Formes des tâches, isolées des files pour rester importables sans Redis. */

export interface IngestJob {
  merchantId: string;
  /** Boîte concernée : chacune a son propre curseur d'historique Gmail. */
  mailboxId?: string;
  /** historyId annoncé par la notification Pub/Sub, à titre de trace. */
  historyId?: string;
  /**
   * Rang de la relance.
   *
   * Gmail n'envoie qu'UNE notification par message. Si, à l'instant où on la
   * reçoit, l'historique ne rend pas encore l'enregistrement correspondant —
   * il n'est pas complet dans la seconde — la relève ne trouve rien, et
   * personne ne reviendra le lui dire. Le message attendrait alors qu'un
   * autre mail arrive, ou qu'un navigateur ouvre la file.
   *
   * D'où une relance différée, bornée : voir `RELANCES_MAX` dans le worker.
   */
  relance?: number;
}

export interface TicketJob {
  merchantId: string;
  ticketId: string;
}
