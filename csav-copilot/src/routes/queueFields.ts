/**
 * Champs du ticket servis à la file.
 *
 * Isolés ici pour une raison précise : ce `select` est explicite, et un champ
 * ajouté au schéma mais oublié dans cette liste arrive `undefined` au
 * navigateur. Rien ne lève — le code qui le lit calcule simplement toujours la
 * même chose. C'est ainsi que le gras de la file est parti en production sans
 * jamais s'éteindre : la colonne existait en base, le front la lisait, et
 * personne ne les avait présentées l'une à l'autre.
 *
 * Une liste dans un fichier sans dépendance se met sous test ; la même liste
 * noyée dans une route qui tire Fastify, Prisma et la configuration ne se
 * teste qu'avec une base. D'où ce module de quinze lignes.
 */
export const QUEUE_SELECT = {
  id: true,
  subject: true,
  customerEmail: true,
  customerName: true,
  intent: true,
  intentConfidence: true,
  status: true,
  orderName: true,
  shopifyOrderId: true,
  lastMessageAt: true,
  createdAt: true,
  // Montant et échéance : déjà en base, jamais affichés. Un message à 19 € et
  // un message à 3 200 € ne se traitent pas dans le même ordre, et l'agent ne
  // pouvait pas le savoir sans ouvrir.
  orderTotal: true,
  dueAt: true,
  labels: true,
  // L'état Gmail du fil : le gras et le dossier courant en dépendent.
  gmailUnread: true,
  gmailArchived: true,
  // Et l'ouverture dans l'outil, qui éteint le gras sans que Gmail en sache
  // rien : `gmail.readonly` ne permet pas de retirer le libellé UNREAD.
  openedAt: true,
  /*
   * Les premiers mots du dernier message reçu.
   *
   * C'est ce qui permet de trancher sans ouvrir. L'objet ne suffit pas : il
   * est écrit par Shopify (« Order #13616 Confirmed 7 Sep ») ou tronqué par un
   * client pressé (« Re: »), et ne décrit pas la demande.
   *
   * Un seul message, le plus récent, et seulement l'extrait déjà calculé à
   * l'ingestion : charger les corps complets de cinquante fils coûterait la
   * page entière pour trois lignes de texte gris.
   */
  messages: {
    where: { direction: 'INBOUND' as const },
    orderBy: { receivedAt: 'desc' as const },
    take: 1,
    select: { snippet: true },
  },
  failureReason: true,
  assignedToId: true,
  assignedTo: { select: { id: true, name: true, email: true } },
  mailbox: { select: { id: true, emailAddress: true, label: true } },
  merchantId: true,
} as const;

/**
 * Ce que le dashboard lit sur chaque ligne de la file.
 *
 * Tenue à la main, et c'est voulu : la liste dit ce dont l'écran a besoin,
 * indépendamment de ce que la route sert. Les confronter est tout l'intérêt.
 */
export const QUEUE_FIELDS_USED_BY_DASHBOARD = [
  'id',
  'subject',
  'customerEmail',
  'customerName',
  'intent',
  'status',
  'orderName',
  'orderTotal',
  'lastMessageAt',
  // Lus par le poste de pilotage : l'échéance ordonne « À traiter en priorité »
  // et alimente « Hors délai » comme « Dans les temps ». Sans elle dans le
  // `select`, les deux compteraient zéro sans que rien ne le signale.
  'dueAt',
  'createdAt',
  'labels',
  'gmailUnread',
  'gmailArchived',
  'openedAt',
  'messages',
  'assignedToId',
  'merchantId',
] as const;
