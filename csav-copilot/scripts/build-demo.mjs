/**
 * Fabrique une démonstration autonome du dashboard, en un seul fichier HTML.
 *
 *   node scripts/build-demo.mjs        →  demo/csav-demo.html
 *
 * Le fichier assemble le vrai `public/dashboard.html`, le vrai `styles.css` et
 * le vrai `app.js`, sans les modifier. Seul `fetch` est remplacé par un faux
 * serveur en mémoire : tout le code d'interface exécuté est donc exactement
 * celui de l'application, et la démonstration ne peut pas diverger du produit.
 *
 * À relancer après toute modification de l'interface.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

const html = read('public/dashboard.html');
const styles = read('public/styles.css');
const app = read('public/app.js');

// Corps de la page, sans la balise <script> qui charge app.js depuis le serveur.
const body = html
  .slice(html.indexOf('<body>') + '<body>'.length, html.indexOf('</body>'))
  .replace(/<script type="module"[^>]*><\/script>/, '')
  .trim();

/* --------------------------------------------------------------------------
 * Faux serveur : mêmes routes, mêmes formes de réponse que l'API réelle.
 * ------------------------------------------------------------------------ */

const fakeServer = String.raw`
const minutesAgo = (n) => new Date(Date.now() - n * 60000).toISOString();

const ORDERS = {
  'gid://shopify/Order/10428': {
    id: 'gid://shopify/Order/10428', name: '#10428', createdAt: '2026-02-03T10:12:00Z',
    displayFinancialStatus: 'PAID', displayFulfillmentStatus: 'IN_TRANSIT',
    totalPrice: '128.40', currency: 'EUR',
    customer: { displayName: 'Léa Fontaine', email: 'lea.fontaine@gmail.com',
      numberOfOrders: 4, amountSpent: '512.60', createdAt: '2024-03-11T09:00:00Z' },
    lineItems: [
      { title: 'Lampe Perce-neige', quantity: 1, variantTitle: 'Laiton' },
      { title: 'Ampoule E27 ambrée 4 W', quantity: 2, variantTitle: null },
    ],
    fulfillments: [{ status: 'IN_TRANSIT', trackingCompany: 'Colissimo',
      trackingNumber: '6A18492037561', trackingUrl: null,
      estimatedDeliveryAt: '2026-02-12T00:00:00Z', updatedAt: '2026-02-08T16:30:00Z' }],
  },
  'gid://shopify/Order/10391': {
    id: 'gid://shopify/Order/10391', name: '#10391', createdAt: '2026-01-28T14:45:00Z',
    displayFinancialStatus: 'PAID', displayFulfillmentStatus: 'FULFILLED',
    totalPrice: '74.00', currency: 'EUR',
    customer: { displayName: 'Marc Delaunay', email: 'm.delaunay@orange.fr',
      numberOfOrders: 7, amountSpent: '931.20', createdAt: '2023-11-02T09:00:00Z' },
    lineItems: [{ title: 'Applique Halo', quantity: 1, variantTitle: 'Noir mat' }],
    fulfillments: [{ status: 'DELIVERED', trackingCompany: 'Mondial Relay',
      trackingNumber: '84921047', trackingUrl: null, estimatedDeliveryAt: null,
      updatedAt: '2026-02-09T14:02:00Z' }],
  },
  'gid://shopify/Order/10375': {
    id: 'gid://shopify/Order/10375', name: '#10375', createdAt: '2026-01-25T11:20:00Z',
    displayFinancialStatus: 'PAID', displayFulfillmentStatus: 'FULFILLED',
    totalPrice: '96.00', currency: 'EUR',
    customer: { displayName: 'Amélie Rousseau', email: 'a.rousseau@free.fr',
      numberOfOrders: 12, amountSpent: '1840.75', createdAt: '2022-06-14T09:00:00Z' },
    lineItems: [{ title: 'Lampe Rosée', quantity: 1, variantTitle: 'Verre soufflé' }],
    fulfillments: [{ status: 'DELIVERED', trackingCompany: 'Colissimo',
      trackingNumber: '6A18471120043', trackingUrl: null, estimatedDeliveryAt: null,
      updatedAt: '2026-02-08T09:15:00Z' }],
  },
  'gid://shopify/Order/10402': {
    id: 'gid://shopify/Order/10402', name: '#10402', createdAt: '2026-01-30T08:05:00Z',
    displayFinancialStatus: 'PAID', displayFulfillmentStatus: 'FULFILLED',
    totalPrice: '62.00', currency: 'EUR',
    customer: { displayName: 'Sophie Nguyen', email: 'sophie.nguyen@laposte.net',
      numberOfOrders: 2, amountSpent: '148.00', createdAt: '2025-09-19T09:00:00Z' },
    lineItems: [{ title: 'Applique Halo', quantity: 1, variantTitle: 'Laiton' }],
    fulfillments: [{ status: 'DELIVERED', trackingCompany: 'Colissimo',
      trackingNumber: '6A18468823901', trackingUrl: null, estimatedDeliveryAt: null,
      updatedAt: '2026-02-07T11:40:00Z' }],
  },
  'gid://shopify/Order/10410': {
    id: 'gid://shopify/Order/10410', name: '#10410', createdAt: '2026-02-02T17:30:00Z',
    displayFinancialStatus: 'PAID', displayFulfillmentStatus: 'IN_TRANSIT',
    totalPrice: '89.90', currency: 'EUR',
    customer: { displayName: 'Julien Meyer', email: 'julien.meyer91@gmail.com',
      numberOfOrders: 3, amountSpent: '288.40', createdAt: '2025-12-05T09:00:00Z' },
    lineItems: [{ title: 'Suspension Brume', quantity: 1, variantTitle: 'Opaline' }],
    fulfillments: [{ status: 'IN_TRANSIT', trackingCompany: 'Colissimo',
      trackingNumber: '6A18490011223', trackingUrl: null,
      estimatedDeliveryAt: '2026-02-11T00:00:00Z', updatedAt: '2026-02-09T08:00:00Z' }],
  },
  'gid://shopify/Order/10344': {
    id: 'gid://shopify/Order/10344', name: '#10344', createdAt: '2026-01-14T09:15:00Z',
    displayFinancialStatus: 'PAID', displayFulfillmentStatus: 'FULFILLED',
    totalPrice: '156.00', currency: 'EUR',
    customer: { displayName: 'Julien Meyer', email: 'julien.meyer91@gmail.com',
      numberOfOrders: 3, amountSpent: '288.40', createdAt: '2025-12-05T09:00:00Z' },
    lineItems: [{ title: 'Lampadaire Sillage', quantity: 1, variantTitle: 'Chêne' }],
    fulfillments: [{ status: 'DELIVERED', trackingCompany: 'Colissimo',
      trackingNumber: '6A18412299001', trackingUrl: null, estimatedDeliveryAt: null,
      updatedAt: '2026-01-18T13:00:00Z' }],
  },
  'gid://shopify/Order/10298': {
    id: 'gid://shopify/Order/10298', name: '#10298', createdAt: '2025-12-21T19:40:00Z',
    displayFinancialStatus: 'PAID', displayFulfillmentStatus: 'FULFILLED',
    totalPrice: '42.50', currency: 'EUR',
    customer: { displayName: 'Julien Meyer', email: 'julien.meyer91@gmail.com',
      numberOfOrders: 3, amountSpent: '288.40', createdAt: '2025-12-05T09:00:00Z' },
    lineItems: [{ title: 'Ampoule E27 ambrée 4 W', quantity: 3, variantTitle: null }],
    fulfillments: [{ status: 'DELIVERED', trackingCompany: 'Colissimo',
      trackingNumber: '6A18333044556', trackingUrl: null, estimatedDeliveryAt: null,
      updatedAt: '2025-12-24T10:00:00Z' }],
  },
};

const db = {
  tickets: [
    { id: 't1', subject: 'Toujours pas reçu ma commande', customerEmail: 'lea.fontaine@gmail.com',
      customerName: 'Léa Fontaine', intent: 'WISMO', intentConfidence: 0.93, status: 'DRAFT_READY',
      shopifyOrderId: 'gid://shopify/Order/10428', orderName: '#10428', lastMessageAt: minutesAgo(12),
      messages: [{ id: 'm1', direction: 'INBOUND', fromEmail: 'lea.fontaine@gmail.com',
        receivedAt: minutesAgo(12), bodyText:
        "Bonjour,\n\nJ'ai commandé le 3 février et je n'ai toujours rien reçu. Le suivi n'a pas bougé depuis une semaine. Pouvez-vous me dire où en est ma commande #10428 ?\n\nMerci,\nLéa" }],
      drafts: [{ id: 'd1', status: 'PENDING_REVIEW', confidence: 0.93,
        reasoning: "Commande identifiée par le numéro cité et confirmée par l'adresse de l'expéditrice. Suivi et estimation issus de Shopify.",
        body: "Bonjour Léa,\n\nVotre commande #10428 a bien été expédiée le 5 février par Colissimo, sous le numéro de suivi 6A18492037561. Le dernier passage enregistré date du 8 février au centre de tri, et la livraison est estimée au 12 février.\n\nCe type d'arrêt d'affichage est fréquent entre deux passages en centre de tri. Si rien ne bouge d'ici le 13, écrivez-nous : nous ouvrirons une enquête auprès de Colissimo et vous renverrons la commande sans frais.\n\nBien à vous,\nL'équipe Atelier Lumen" }] },

    { id: 't2', subject: "Colis annoncé livré mais je n'ai rien", customerEmail: 'm.delaunay@orange.fr',
      customerName: 'Marc Delaunay', intent: 'DISPUTE', intentConfidence: 0.88, status: 'AWAITING_SUPPLIER',
      shopifyOrderId: 'gid://shopify/Order/10391', orderName: '#10391', lastMessageAt: minutesAgo(38),
      messages: [{ id: 'm2', direction: 'INBOUND', fromEmail: 'm.delaunay@orange.fr',
        receivedAt: minutesAgo(38), bodyText:
        "Bonjour, le suivi indique « livré » depuis hier 14h mais je n'ai rien reçu, ni dans la boîte aux lettres ni chez les voisins. J'étais chez moi toute la journée. Que fait-on ?" }],
      drafts: [{ id: 'd2', status: 'PENDING_REVIEW', confidence: 0.62,
        reasoning: "Litige transporteur : la suite dépend d'une réclamation et éventuellement d'un geste commercial. Ces décisions ne s'automatisent pas.",
        body: "Bonjour Marc,\n\nJe comprends, le suivi de votre commande #10391 indique bien une livraison hier à 14 h 02 par Mondial Relay.\n\nAvant d'aller plus loin, deux vérifications utiles : le colis a-t-il pu être déposé en point relais plutôt qu'à votre adresse, et avez-vous reçu un avis de passage ? Si ce n'est pas le cas, nous ouvrons dès aujourd'hui une réclamation auprès du transporteur.\n\nDites-nous ce qu'il en est et nous enchaînons immédiatement.\n\nBien à vous,\nL'équipe Atelier Lumen" }] },

    { id: 't3', subject: 'Où en est ma commande ?', customerEmail: 'julien.meyer91@gmail.com',
      customerName: 'Julien Meyer', intent: 'WISMO', intentConfidence: 0.91, status: 'NEEDS_REVIEW',
      shopifyOrderId: null, orderName: null, lastMessageAt: minutesAgo(64),
      messages: [{ id: 'm3', direction: 'INBOUND', fromEmail: 'julien.meyer91@gmail.com',
        receivedAt: minutesAgo(64),
        bodyText: "Bonjour, je voudrais savoir où en est ma commande s'il vous plaît. Merci d'avance." }],
      drafts: [{ id: 'd3', status: 'PENDING_REVIEW', confidence: 0.42,
        reasoning: "Trois commandes correspondent à cette adresse et aucune n'est certaine. Le brouillon demande une précision plutôt que de choisir à la place du client.",
        body: "Bonjour Julien,\n\nJe retrouve trois commandes à votre nom et je préfère ne pas me tromper : pouvez-vous m'indiquer le numéro figurant dans votre e-mail de confirmation, ou l'adresse utilisée lors de l'achat ?\n\nJe vous réponds dès réception.\n\nBien à vous,\nL'équipe Atelier Lumen" }] },

    { id: 't4', subject: 'Abat-jour fêlé — remboursement', customerEmail: 'a.rousseau@free.fr',
      customerName: 'Amélie Rousseau', intent: 'REFUND', intentConfidence: 0.94, status: 'NEEDS_REVIEW',
      shopifyOrderId: 'gid://shopify/Order/10375', orderName: '#10375', lastMessageAt: minutesAgo(124),
      messages: [{ id: 'm4', direction: 'INBOUND', fromEmail: 'a.rousseau@free.fr',
        receivedAt: minutesAgo(124), bodyText:
        "Bonjour,\n\nJ'ai reçu ma lampe hier, l'abat-jour en verre est fêlé sur tout un côté. Le carton était intact. Je ne souhaite pas d'échange, je préfère être remboursée.\n\nPhotos en pièce jointe.\n\nAmélie Rousseau" }],
      drafts: [{ id: 'd4', status: 'PENDING_REVIEW', confidence: 0.71,
        reasoning: "Le remboursement paraît justifié mais il engage de l'argent : le brouillon l'annonce, c'est à vous de déclencher l'opération.",
        body: "Bonjour Amélie,\n\nMerci pour les photos, la fêlure est nette et il n'y a pas de discussion à avoir : nous vous remboursons la commande #10375, soit 96,00 €.\n\nLe remboursement part sur votre carte aujourd'hui et met deux à cinq jours ouvrés à apparaître selon votre banque. Vous n'avez pas besoin de nous renvoyer la lampe.\n\nDésolés pour ce défaut, et merci de nous l'avoir signalé si clairement.\n\nBien à vous,\nL'équipe Atelier Lumen" }] },

    { id: 't5', subject: 'Retour — mauvaise finition commandée', customerEmail: 'sophie.nguyen@laposte.net',
      customerName: 'Sophie Nguyen', intent: 'RETURN', intentConfidence: 0.9, status: 'DRAFT_READY',
      shopifyOrderId: 'gid://shopify/Order/10402', orderName: '#10402', lastMessageAt: minutesAgo(190),
      messages: [{ id: 'm5', direction: 'INBOUND', fromEmail: 'sophie.nguyen@laposte.net',
        receivedAt: minutesAgo(190), bodyText:
        "Bonjour, je me suis trompée de finition, j'ai pris le laiton alors que je voulais le noir. Comment faire pour l'échanger ? Commande 10402." }],
      drafts: [{ id: 'd5', status: 'PENDING_REVIEW', confidence: 0.88,
        reasoning: 'Commande identifiée par le numéro cité, dans les délais de retour. Réponse standard sans engagement financier.',
        body: "Bonjour Sophie,\n\nAucun problème. Votre commande #10402 a été livrée le 7 février, vous êtes donc dans les délais de retour.\n\nRenvoyez-nous l'applique dans son emballage d'origine à l'adresse indiquée sur votre bon de livraison. Dès réception, nous expédions la version noir mat ; s'il reste une différence de prix, nous l'ajustons à ce moment-là.\n\nBien à vous,\nL'équipe Atelier Lumen" }] },

    { id: 't6', subject: 'Merci pour la rapidité', customerEmail: 'thomas.girard@gmail.com',
      customerName: 'Thomas Girard', intent: 'POSITIVE', intentConfidence: 0.97, status: 'NEEDS_REVIEW',
      shopifyOrderId: null, orderName: null, lastMessageAt: minutesAgo(1080),
      messages: [{ id: 'm6', direction: 'INBOUND', fromEmail: 'thomas.girard@gmail.com',
        receivedAt: minutesAgo(1080), bodyText:
        "Juste un mot pour vous remercier, commande reçue en 48 h et l'emballage était impeccable. Bravo !" }],
      drafts: [] },
  ],

  audit: [
    { id: 'a3', action: 'draft.created', actorType: 'AI', createdAt: minutesAgo(12),
      metadata: { intent: 'WISMO', orderName: '#10428' } },
    { id: 'a2', action: 'gmail.connected', actorType: 'SYSTEM', createdAt: minutesAgo(2880), metadata: {} },
    { id: 'a1', action: 'shopify.connected', actorType: 'SYSTEM', createdAt: minutesAgo(2881), metadata: {} },
  ],

  supplier: { id: 'sup1', name: 'Atelier Nord', contactEmail: 'contact@atelier-nord.example' },

  // Escalade déjà en cours sur le ticket Marc Delaunay (#10391) : c'est la
  // commande dont l'adresse est volontairement incomplète dans cette démo.
  escalations: [
    { id: 'esc1', ticketId: 't2', reason: 'INCORRECT_ADDRESS', note:
      'Le numéro de rue manque, à confirmer avant réexpédition.', status: 'OPEN',
      createdAt: minutesAgo(25), notifiedAt: minutesAgo(20), resolvedAt: null,
      supplier: { name: 'Atelier Nord', contactEmail: 'contact@atelier-nord.example' },
      messages: [{ id: 'esm1', direction: 'TO_SUPPLIER', authorType: 'AI', createdAt: minutesAgo(25),
        body: "Bonjour,\n\nPouvez-vous confirmer le numéro de rue pour la commande #10391 (Applique Halo) avant réexpédition ? L'adresse actuelle indique « Résidence Les Tilleuls » sans numéro.\n\nMerci,\nAtelier Lumen" }] },
  ],
};

const ESCALATION_REASON_BODIES = {
  OUT_OF_STOCK: (order) =>
    'Bonjour,\n\nLa commande ' + (order ? order.name : '') +
    ' semble bloquée par une rupture de stock. Pouvez-vous confirmer une date de réassort ?\n\nMerci,\nAtelier Lumen',
  INCORRECT_ADDRESS: (order) =>
    "Bonjour,\n\nL'adresse de livraison de la commande " + (order ? order.name : '') +
    ' semble incomplète. Pouvez-vous vérifier avant réexpédition ?\n\nMerci,\nAtelier Lumen',
  MISSING_ITEM: (order) =>
    'Bonjour,\n\nUn article manque à la réception de la commande ' + (order ? order.name : '') +
    ". Pouvez-vous renvoyer l'article manquant ?\n\nMerci,\nAtelier Lumen",
  OTHER: (order) =>
    'Bonjour,\n\nUn point reste à éclaircir sur la commande ' + (order ? order.name : '') +
    ' ? Pouvez-vous nous éclairer ?\n\nMerci,\nAtelier Lumen',
};

const json = (data, status = 200) => ({
  ok: status < 400, status,
  json: async () => data,
  text: async () => JSON.stringify(data),
});

const findTicket = (id) => db.tickets.find((t) => t.id === id);
const findDraft = (id) => {
  for (const t of db.tickets) {
    const d = t.drafts.find((x) => x.id === id);
    if (d) return { ticket: t, draft: d };
  }
  return null;
};

const logAudit = (action, metadata = {}) => {
  db.audit.unshift({ id: 'a' + Date.now(), action, actorType: 'USER',
    createdAt: new Date().toISOString(), metadata });
};

// Jeton de confirmation : ici une simple valeur opaque. Dans l'application
// réelle il est signé côté serveur, ce qui rend impossible de rembourser sans
// être passé par cette modale.
let refundToken = null;

const realFetch = window.fetch.bind(window);

window.fetch = async (input, options = {}) => {
  const url = new URL(String(input), 'https://demo.local');
  const path = url.pathname;
  const method = (options.method ?? 'GET').toUpperCase();
  const payload = options.body ? JSON.parse(options.body) : {};

  // Latence légère : sans elle l'interface paraît figée plutôt que réactive.
  await new Promise((r) => setTimeout(r, 90));

  if (path === '/api/config') return json({ devMode: false });

  if (path === '/api/me')
    return json({
      merchant: { id: 'demo', shopDomain: 'atelier-lumen.myshopify.com',
        name: 'Atelier Lumen', autoSendEnabled: false, autoSendThreshold: 0.9 },
      user: { email: 'claire@atelier-lumen.fr', name: 'Claire Mercier', role: 'OWNER' },
      shopify: { connected: true, simulated: true },
      gmail: { connected: true, emailAddress: 'sav@atelier-lumen.fr', watchActive: true },
    });

  if (path === '/api/metrics') {
    const counts = {};
    for (const t of db.tickets) counts[t.status] = (counts[t.status] ?? 0) + 1;
    const drafts = db.tickets.flatMap((t) => t.drafts);
    const sent = drafts.filter((d) => d.status === 'SENT').length;
    return json({ window: '30j', tickets: counts,
      pending: (counts.NEEDS_REVIEW ?? 0) + (counts.DRAFT_READY ?? 0),
      automationRate: drafts.length ? sent / drafts.length : 0 });
  }

  if (path === '/api/tickets' && method === 'GET') {
    const status = url.searchParams.get('status');
    const tickets = db.tickets
      .filter((t) => !status || t.status === status)
      .sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt))
      .map(({ id, subject, customerEmail, customerName, intent, intentConfidence, status: s, orderName, lastMessageAt }) =>
        ({ id, subject, customerEmail, customerName, intent, intentConfidence, status: s, orderName, lastMessageAt }));
    return json({ tickets, nextCursor: null });
  }

  const candidates = path.match(/^\/api\/tickets\/([^/]+)\/order-candidates$/);
  if (candidates) {
    const ticket = findTicket(candidates[1]);
    const q = (url.searchParams.get('q') ?? '').trim().toLowerCase();
    const all = Object.values(ORDERS);
    const orders = q
      ? all.filter((o) => o.name.toLowerCase().includes(q.replace('#', '')) ||
          (o.customer?.displayName ?? '').toLowerCase().includes(q))
      : all.filter((o) => o.customer?.email === ticket?.customerEmail);
    return json({ orders: orders.sort((a, b) => b.createdAt.localeCompare(a.createdAt)) });
  }

  const attach = path.match(/^\/api\/tickets\/([^/]+)\/order$/);
  if (attach && method === 'POST') {
    const ticket = findTicket(attach[1]);
    const order = ORDERS[payload.orderId];
    if (!ticket || !order) return json({ error: 'Commande introuvable' }, 404);
    ticket.shopifyOrderId = order.id;
    ticket.orderName = order.name;
    logAudit('ticket.order_attached', { orderName: order.name });
    return json({ ticket, order });
  }

  const detail = path.match(/^\/api\/tickets\/([^/]+)$/);
  if (detail && method === 'GET') {
    const ticket = findTicket(detail[1]);
    if (!ticket) return json({ error: 'Ticket introuvable' }, 404);
    return json({ ticket, order: ticket.shopifyOrderId ? ORDERS[ticket.shopifyOrderId] : null,
      orderError: null });
  }

  const patch = path.match(/^\/api\/drafts\/([^/]+)$/);
  if (patch && method === 'PATCH') {
    const found = findDraft(patch[1]);
    if (!found) return json({ error: 'Brouillon introuvable' }, 404);
    if (found.draft.status === 'SENT') return json({ error: 'Brouillon déjà envoyé' }, 409);
    found.draft.body = payload.body;
    found.draft.status = 'EDITED';
    logAudit('draft.edited');
    return json(found.draft);
  }

  const send = path.match(/^\/api\/drafts\/([^/]+)\/send$/);
  if (send && method === 'POST') {
    const found = findDraft(send[1]);
    if (!found) return json({ error: 'Brouillon introuvable' }, 404);
    if (found.draft.status === 'SENT') return json({ error: 'Déjà envoyé' }, 409);
    found.draft.status = 'SENT';
    found.ticket.status = 'CLOSED';
    found.ticket.messages.push({ id: 'out' + Date.now(), direction: 'OUTBOUND',
      fromEmail: 'sav@atelier-lumen.fr', receivedAt: new Date().toISOString(),
      bodyText: found.draft.body });
    logAudit('draft.sent', { ticketId: found.ticket.id });
    return json({ ok: true });
  }

  if (path === '/api/refunds/preview') {
    const order = ORDERS[url.searchParams.get('orderId')];
    if (!order) return json({ error: 'Commande introuvable' }, 404);
    refundToken = 'jeton-' + Date.now();
    return json({ refundableAmount: order.totalPrice, currency: order.currency,
      transactions: [{ id: 'tx', gateway: 'bogus', maximumRefundableAmount: order.totalPrice,
        currency: order.currency }], confirmationToken: refundToken });
  }

  if (path === '/api/refunds' && method === 'POST') {
    const order = ORDERS[payload.orderId];
    if (payload.confirmationToken !== refundToken)
      return json({ error: 'Confirmation manquante ou expirée. Rouvrez la modale de remboursement.' }, 400);
    const amount = Number(payload.amount);
    if (!(amount > 0) || amount > Number(order.totalPrice))
      return json({ error: 'Montant hors limites (max ' + order.totalPrice + ' ' + order.currency + ')' }, 400);
    refundToken = null;
    logAudit('refund.requested', { orderName: order.name, amount: payload.amount,
      currency: order.currency, reason: payload.reason });
    logAudit('refund.completed', { orderName: order.name, amount: payload.amount,
      currency: order.currency });
    return json({ id: 'r1', status: 'COMPLETED' });
  }

  if (path === '/api/audit') return json({ entries: db.audit.slice(0, 30) });

  if (path === '/api/suppliers' && method === 'GET') return json({ supplier: db.supplier });

  if (path === '/api/suppliers' && method === 'PUT') {
    db.supplier = { id: db.supplier?.id ?? 'sup1', name: payload.name, contactEmail: payload.contactEmail };
    logAudit('supplier.configured', { name: db.supplier.name });
    return json({ supplier: db.supplier });
  }

  const escList = path.match(/^\/api\/tickets\/([^/]+)\/escalations$/);
  if (escList && method === 'GET') {
    return json({ escalations: db.escalations.filter((e) => e.ticketId === escList[1]) });
  }

  if (escList && method === 'POST') {
    if (!db.supplier) return json({ error: 'Configurez un fournisseur avant de pouvoir escalader un ticket.' }, 409);
    const ticket = findTicket(escList[1]);
    const order = ticket?.shopifyOrderId ? ORDERS[ticket.shopifyOrderId] : null;
    const body = (ESCALATION_REASON_BODIES[payload.reason] ?? ESCALATION_REASON_BODIES.OTHER)(order);
    const escalation = {
      id: 'esc' + Date.now(), ticketId: escList[1], reason: payload.reason,
      note: payload.note ?? null, status: 'DRAFTING', createdAt: new Date().toISOString(),
      notifiedAt: null, resolvedAt: null,
      supplier: { name: db.supplier.name, contactEmail: db.supplier.contactEmail },
      messages: [{ id: 'esm' + Date.now(), direction: 'TO_SUPPLIER', authorType: 'AI',
        createdAt: new Date().toISOString(), body }],
    };
    db.escalations.push(escalation);
    logAudit('supplier.escalation_created', { reason: payload.reason, orderName: order?.name ?? null });
    return json({ escalation });
  }

  const escPatch = path.match(/^\/api\/escalations\/([^/]+)$/);
  if (escPatch && method === 'PATCH') {
    const escalation = db.escalations.find((e) => e.id === escPatch[1]);
    if (!escalation) return json({ error: 'Escalade introuvable' }, 404);
    const last = escalation.messages[escalation.messages.length - 1];
    last.body = payload.body;
    last.authorType = 'HUMAN';
    return json({ message: last });
  }

  const escSend = path.match(/^\/api\/escalations\/([^/]+)\/send$/);
  if (escSend && method === 'POST') {
    const escalation = db.escalations.find((e) => e.id === escSend[1]);
    if (!escalation) return json({ error: 'Escalade introuvable' }, 404);
    escalation.status = 'OPEN';
    escalation.notifiedAt = new Date().toISOString();
    const ticket = findTicket(escalation.ticketId);
    if (ticket) ticket.status = 'AWAITING_SUPPLIER';
    logAudit('supplier.notified', { supplierEmail: escalation.supplier.contactEmail });
    return json({ ok: true });
  }

  const escResolve = path.match(/^\/api\/escalations\/([^/]+)\/resolve$/);
  if (escResolve && method === 'POST') {
    const escalation = db.escalations.find((e) => e.id === escResolve[1]);
    if (!escalation) return json({ error: 'Escalade introuvable' }, 404);
    escalation.status = 'RESOLVED';
    escalation.resolvedAt = new Date().toISOString();
    logAudit('supplier.escalation_resolved');
    return json({ ok: true });
  }

  if (path.startsWith('/api/')) return json({ error: 'Route inconnue en démonstration' }, 404);

  return realFetch(input, options);
};
`;

/* --------------------------------------------------------------------------
 * Assemblage
 * ------------------------------------------------------------------------ */

const banner = `
  <div class="shell" style="padding-bottom:0">
    <div class="notice" style="margin-top:16px">
      <span class="notice-mark">Démo</span>
      <div>
        <b>Voici l'interface réelle de cSAV Copilot, avec des données fictives.</b>
        Le code affiché ici est exactement celui de l'application ; seul le serveur
        est remplacé par une version en mémoire, le temps de cette page. Aucun mail
        n'est lu ni envoyé, aucun euro ne bouge.
        <br /><br />
        À essayer : <b>Julien Meyer</b> — trois commandes correspondent à son
        adresse, l'IA refuse de choisir et demande une précision.
        <b>Amélie Rousseau</b> — le bouton rembourser, et sa confirmation obligatoire.
        <b>Marc Delaunay</b> — une escalade fournisseur déjà en cours dans le
        panneau « Fournisseur », pour l'adresse de livraison incomplète.
        Modifiez un brouillon, envoyez-le, regardez le journal d'audit à droite.
      </div>
    </div>
  </div>
`;

const themeOverrides = `
/* La page de démonstration suit le thème du lecteur, y compris son bouton. */
:root[data-theme='light'] { color-scheme: light; }
:root[data-theme='dark'] {
  --ground: #0e1315; --surface: #161c1f; --surface-sunk: #11171a;
  --ink: #e6edeb; --ink-soft: #afbdbc; --ink-mute: #7e8d8e;
  --line: #26302f; --line-soft: #1e2629;
  --accent: #5bc3d0; --accent-soft: #143036; --accent-ink: #06272c;
  --ok: #6dc59a; --ok-soft: #142c22; --warn: #d9a648; --warn-soft: #2e2413;
  --crit: #e58579; --crit-soft: #33201d;
  --shadow: 0 1px 2px rgba(0,0,0,.5), 0 10px 28px -14px rgba(0,0,0,.8);
  color-scheme: dark;
}
`;

const output = `<title>cSAV Copilot — l'application en démonstration</title>

<style>
${styles}
${themeOverrides}
</style>

${banner}
${body}

<script>
${fakeServer}
</script>

<script type="module">
${app}
</script>
`;

mkdirSync(join(root, 'demo'), { recursive: true });
writeFileSync(join(root, 'demo/csav-demo.html'), output, 'utf8');

console.log('demo/csav-demo.html écrit —', (output.length / 1024).toFixed(0), 'Ko');
console.log('Fichier autonome : ouvrable dans un navigateur, envoyable par mail.');
