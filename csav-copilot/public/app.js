/**
 * Dashboard cSAV Copilot.
 *
 * Page unique servie par l'API : aucune étape de build, aucun second serveur.
 * Tout l'état vient des endpoints `/api/*` ; rien n'est stocké côté client.
 */

const $ = (id) => document.getElementById(id);

const state = {
  me: null,
  filter: '',
  tickets: [],
  currentId: null,
  detail: null,
  refund: null,
  suppliers: [],
  editingSupplier: null,
  team: { users: [], me: null },
  editingUser: null,
  settings: null,
  view: 'tickets',
  orders: { items: [], cursor: null, hasNext: false, q: '', loading: false, loaded: false, timer: null },
  customers: { items: [], cursor: null, hasNext: false, q: '', loading: false, loaded: false, timer: null },
};

/* ------------------------------------------------------------------ outils */

const euro = (amount, currency = 'EUR') =>
  Number(amount).toLocaleString('fr-FR', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
  });

function relativeTime(iso) {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return "à l'instant";
  if (minutes < 60) return `il y a ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `il y a ${hours} h`;
  const days = Math.round(hours / 24);
  return days === 1 ? 'hier' : `il y a ${days} j`;
}

function shortTime(iso) {
  return new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

function fullDate(iso) {
  return new Date(iso).toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

/** Échappe le texte avant insertion : les mails viennent de l'extérieur. */
function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function toast(message, isError = false) {
  const el = $('toast');
  el.textContent = message;
  el.classList.toggle('error', isError);
  el.classList.add('show');
  clearTimeout(el._timer);
  el._timer = setTimeout(() => el.classList.remove('show'), 4000);
}

class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: 'same-origin',
    headers: options.body ? { 'Content-Type': 'application/json' } : {},
    ...options,
  });

  if (response.status === 401) {
    showGate('Votre session a expiré ou n’a jamais été ouverte.');
    throw new ApiError('non authentifié', 401);
  }

  const payload = response.status === 204 ? null : await response.json().catch(() => null);

  if (!response.ok) {
    throw new ApiError(payload?.error ?? `Erreur ${response.status}`, response.status);
  }

  return payload;
}

async function showGate(message) {
  $('gate-text').textContent = message;
  $('gate').hidden = false;
  $('app').hidden = true;

  // En production, le raccourci de développement n'existe pas : on renvoie
  // vers l'installation Shopify plutôt que vers un lien mort.
  try {
    const config = await fetch('/api/config').then((r) => r.json());
    $('gate-dev').hidden = !config.devMode;
    $('gate-prod').hidden = config.devMode;
  } catch {
    $('gate-prod').hidden = false;
  }
}

/* ------------------------------------------------------------- barre haute */

function renderMe() {
  const me = state.me;
  $('merchant-name').textContent = me.merchant.name ?? 'cSAV Copilot';
  $('merchant-shop').textContent = me.merchant.shopDomain;

  const pills = [];

  pills.push(
    me.shopify.connected || me.shopify.simulated
      ? `<span class="conn-pill"><span class="dot${me.shopify.simulated ? ' warn' : ''}"></span> Shopify ${
          me.shopify.simulated ? 'simulé' : 'connecté'
        }</span>`
      : '<span class="conn-pill"><span class="dot off"></span> Shopify non connecté</span>',
  );

  if (me.gmail.connected) {
    // Un watch expiré veut dire que plus aucun mail n'entre : c'est l'alerte
    // la plus importante de l'écran, elle passe avant tout le reste.
    pills.push(
      `<span class="conn-pill"><span class="dot${me.gmail.watchActive ? '' : ' warn'}"></span> ${esc(
        me.gmail.emailAddress,
      )}${me.gmail.watchActive ? '' : ' — écoute inactive'}</span>`,
    );
  } else {
    pills.push(
      '<span class="conn-pill"><span class="dot off"></span> Gmail non connecté</span>',
    );
  }

  pills.push(
    `<span class="conn-pill"><span class="dot${
      me.merchant.autoSendEnabled ? '' : ' warn'
    }"></span> Envoi auto ${me.merchant.autoSendEnabled ? 'activé' : 'désactivé'}</span>`,
  );

  if (me.user) {
    pills.push(
      `<span class="conn-pill">${esc(me.user.name ?? me.user.email)} · ${esc(
        ROLE_LABELS[me.user.role] ?? me.user.role,
      )}</span>`,
    );
  }

  $('conn').innerHTML = pills.join('');
  $('mock-notice').hidden = !me.shopify.simulated;
}

/* ------------------------------------------------------------ indicateurs */

async function loadMetrics() {
  const metrics = await api('/api/metrics');
  const counts = metrics.tickets ?? {};

  $('kpi-done').textContent = String((counts.CLOSED ?? 0) + (counts.AUTO_SENT ?? 0));
  $('kpi-pending').textContent = String(metrics.pending ?? 0);
  $('kpi-pending-note').textContent = `${counts.NEEDS_REVIEW ?? 0} à valider · ${
    counts.DRAFT_READY ?? 0
  } prêts`;
  $('kpi-rate').textContent = `${Math.round((metrics.automationRate ?? 0) * 100)} %`;

  const auto = state.me.merchant.autoSendEnabled;
  $('kpi-auto').textContent = auto ? 'Actif' : 'Inactif';
  $('kpi-auto-note').textContent = auto
    ? `seuil ${state.me.merchant.autoSendThreshold}`
    : 'toute réponse passe par vous';
}

/* -------------------------------------------------------- file de tickets */

async function loadQueue() {
  const query = state.filter ? `?status=${encodeURIComponent(state.filter)}` : '';
  const data = await api(`/api/tickets${query}`);
  state.tickets = data.tickets;

  const list = $('queue');

  if (state.tickets.length === 0) {
    list.innerHTML = '<li class="empty" style="padding:16px 14px">Aucun ticket ici.</li>';
    return;
  }

  list.innerHTML = state.tickets
    .map((ticket) => {
      const label = STATUS_LABELS[ticket.status] ?? ticket.status;
      return `<li>
        <button class="queue-item" data-id="${ticket.id}" aria-current="${
          ticket.id === state.currentId
        }">
          <span class="queue-top">
            <span class="queue-who">${esc(ticket.customerName ?? ticket.customerEmail)}</span>
            <span class="queue-time">${relativeTime(ticket.lastMessageAt)}</span>
          </span>
          <div class="queue-subject">${esc(ticket.subject ?? '(sans objet)')}</div>
          <span class="queue-tags">
            ${ticket.intent ? `<span class="tag tag-intent">${ticket.intent}</span>` : ''}
            <span class="tag tag-status st-${ticket.status}">${label}</span>
            <span class="tag tag-order">${
              ticket.orderName ? esc(ticket.orderName) : 'commande ?'
            }</span>
          </span>
        </button>
      </li>`;
    })
    .join('');

  list.querySelectorAll('.queue-item').forEach((button) => {
    button.addEventListener('click', () => selectTicket(button.dataset.id));
  });
}

const STATUS_LABELS = {
  NEW: 'Nouveau',
  PROCESSING: 'En traitement',
  DRAFT_READY: 'Brouillon prêt',
  NEEDS_REVIEW: 'À valider',
  AWAITING_SUPPLIER: 'Chez le fournisseur',
  AUTO_SENT: 'Envoyé auto',
  CLOSED: 'Clos',
  FAILED: 'Échec',
};

/* ------------------------------------------------------- détail du ticket */

async function selectTicket(id) {
  state.currentId = id;
  const detail = await api(`/api/tickets/${id}`);
  state.detail = detail;
  renderDetail();
  await Promise.all([loadQueue(), loadEscalations(id)]);
}

function renderDetail() {
  const { ticket, order, orderError } = state.detail;

  $('d-subject').textContent = ticket.subject ?? '(sans objet)';
  $('d-meta').innerHTML =
    `${esc(ticket.customerName ?? '')} · <code>${esc(ticket.customerEmail)}</code>` +
    (ticket.intent
      ? ` · intention <b>${ticket.intent}</b>${
          ticket.intentConfidence != null
            ? ` (${ticket.intentConfidence.toFixed(2).replace('.', ',')})`
            : ''
        }`
      : '');

  $('d-messages').innerHTML = ticket.messages
    .map(
      (message) => `<div class="msg${message.direction === 'OUTBOUND' ? ' out' : ''}">
        <div class="msg-head">
          <b>${esc(message.fromEmail)}</b>
          <span>${shortTime(message.receivedAt)}</span>
        </div>
        <div class="msg-body">${esc(message.bodyText)}</div>
      </div>`,
    )
    .join('');

  const draft = ticket.drafts?.[0] ?? null;
  renderDraft(draft, ticket);
  renderCustomer(order);
  renderOrder(ticket, order, orderError);
  renderShipping(order);
}

/** Droits de l'utilisateur connecté, tels que renvoyés par /api/me. */
function myRole() {
  return state.me?.user?.role ?? 'VIEWER';
}

function canI(permission) {
  const table = {
    reply: ['OWNER', 'SUPERVISOR', 'AGENT'],
    escalate: ['OWNER', 'SUPERVISOR', 'AGENT'],
    refund: ['OWNER', 'SUPERVISOR'],
    configure: ['OWNER', 'SUPERVISOR'],
    manageTeam: ['OWNER'],
  };
  return (table[permission] ?? []).includes(myRole());
}

function renderDraft(draft, ticket) {
  const zone = $('draft-zone');
  const none = $('no-draft');

  if (!draft) {
    zone.hidden = true;
    none.hidden = false;
    $('no-draft-text').textContent =
      ticket.intent === 'POSITIVE' || ticket.intent === 'OTHER'
        ? "Ce message n'appelle pas de réponse automatique — il a été classé sans action."
        : 'Aucun brouillon n’a encore été généré pour ce ticket.';
    return;
  }

  zone.hidden = false;
  none.hidden = true;

  $('d-body').value = draft.body;
  $('d-reason').textContent = draft.reasoning ?? '—';

  const fill = $('d-conf-fill');
  fill.style.width = `${Math.round(draft.confidence * 100)}%`;
  fill.className =
    'conf-fill' + (draft.confidence < 0.5 ? ' bad' : draft.confidence < 0.8 ? ' low' : '');
  $('d-conf-num').textContent = draft.confidence.toFixed(2).replace('.', ',');

  const sent = draft.status === 'SENT';
  // Un rôle sans le droit voit le bouton désactivé plutôt que masqué : cacher
  // laisserait croire à une régression du produit, et le titre explique.
  const mayReply = canI('reply');

  $('btn-send').disabled = sent || !mayReply;
  $('btn-send').textContent = sent ? 'Réponse envoyée' : 'Envoyer la réponse';
  $('btn-save').disabled = sent || !mayReply;
  if (!mayReply) {
    $('btn-send').title = 'Votre rôle est en lecture seule.';
    $('btn-save').title = 'Votre rôle est en lecture seule.';
  }

  $('btn-refund').disabled = !ticket.shopifyOrderId || !canI('refund');
  if (!canI('refund')) {
    $('btn-refund').title = 'Seuls le propriétaire et les superviseurs peuvent rembourser.';
  }
  if (canI('refund')) $('btn-refund').title = ticket.shopifyOrderId
    ? ''
    : 'Rattachez d’abord une commande à ce ticket.';
}

function row(label, value, mono = false) {
  return `<div class="row"><dt>${label}</dt><dd${
    mono ? ' class="mono"' : ''
  }>${esc(value)}</dd></div>`;
}

function renderCustomer(order) {
  const customer = order?.customer;

  if (!customer) {
    $('c-customer').innerHTML =
      '<p class="empty">Fiche client indisponible sans commande rattachée.</p>';
    return;
  }

  $('c-customer').innerHTML =
    '<dl>' +
    row('Nom', customer.displayName ?? '—') +
    (customer.createdAt ? row('Client depuis', fullDate(customer.createdAt)) : '') +
    row('Commandes', String(customer.numberOfOrders ?? 0), true) +
    (customer.amountSpent
      ? row('Total dépensé', euro(customer.amountSpent, order.currency), true)
      : '') +
    '</dl>';
}

function renderOrder(ticket, order, orderError) {
  const container = $('c-order');

  if (order) {
    container.innerHTML =
      '<dl>' +
      row('Numéro', order.name, true) +
      row('Passée le', fullDate(order.createdAt)) +
      row('Montant', euro(order.totalPrice, order.currency), true) +
      row('Paiement', order.displayFinancialStatus ?? '—') +
      row('Préparation', order.displayFulfillmentStatus ?? '—') +
      '</dl>' +
      '<ul class="items">' +
      order.lineItems
        .map(
          (item) =>
            `<li><span>${item.quantity} ×</span><span>${esc(item.title)}${
              item.variantTitle ? ` — ${esc(item.variantTitle)}` : ''
            }</span></li>`,
        )
        .join('') +
      '</ul>';
    return;
  }

  if (orderError) {
    container.innerHTML = `<p class="empty">${esc(orderError)}</p>`;
    return;
  }

  // Cas central du produit : l'association n'a pas été tranchée automatiquement,
  // on propose à l'agent de le faire lui-même.
  container.innerHTML = `
    <p class="empty">Aucune commande rattachée — l'association n'était pas certaine.</p>
    <div class="attach">
      <div class="attach-row">
        <input type="text" id="attach-q" placeholder="N° de commande ou nom" />
        <button class="btn" id="attach-search">Chercher</button>
      </div>
      <ul class="candidates" id="attach-results"></ul>
    </div>`;

  $('attach-search').addEventListener('click', () => searchCandidates(ticket.id));
  $('attach-q').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') searchCandidates(ticket.id);
  });

  searchCandidates(ticket.id);
}

async function searchCandidates(ticketId) {
  const list = $('attach-results');
  if (!list) return;

  const query = $('attach-q')?.value.trim() ?? '';
  list.innerHTML = '<li class="empty">Recherche…</li>';

  try {
    const data = await api(
      `/api/tickets/${ticketId}/order-candidates${query ? `?q=${encodeURIComponent(query)}` : ''}`,
    );

    if (data.orders.length === 0) {
      list.innerHTML = '<li class="empty">Aucune commande trouvée.</li>';
      return;
    }

    list.innerHTML = data.orders
      .map(
        (order) => `<li>
          <button class="candidate" data-order="${esc(order.id)}">
            <b>${esc(order.name)}</b>
            <span>${fullDate(order.createdAt)} · ${euro(order.totalPrice, order.currency)}</span>
          </button>
        </li>`,
      )
      .join('');

    list.querySelectorAll('.candidate').forEach((button) => {
      button.addEventListener('click', () => attachOrder(ticketId, button.dataset.order));
    });
  } catch (error) {
    list.innerHTML = `<li class="empty">${esc(error.message)}</li>`;
  }
}

async function attachOrder(ticketId, orderId) {
  try {
    await api(`/api/tickets/${ticketId}/order`, {
      method: 'POST',
      body: JSON.stringify({ orderId }),
    });
    toast('Commande rattachée.');
    await selectTicket(ticketId);
    await loadAudit();
  } catch (error) {
    toast(error.message, true);
  }
}

function renderShipping(order) {
  const container = $('c-ship');
  const fulfillment = order?.fulfillments?.[0];

  if (!fulfillment) {
    container.innerHTML = order
      ? '<p class="empty">Aucune expédition enregistrée pour cette commande.</p>'
      : '<p class="empty">—</p>';
    return;
  }

  const steps = ['Préparée', 'Expédiée', 'En transit', 'Livrée'];
  const status = (fulfillment.status ?? '').toUpperCase();
  const reached = status.includes('DELIVER') ? 3 : status.includes('TRANSIT') ? 2 : 1;

  container.innerHTML =
    '<dl>' +
    row('Transporteur', fulfillment.trackingCompany ?? 'non précisé') +
    row('Suivi', fulfillment.trackingNumber ?? '—', true) +
    row('Statut', fulfillment.status) +
    (fulfillment.estimatedDeliveryAt
      ? row('Estimation', fullDate(fulfillment.estimatedDeliveryAt))
      : '') +
    '</dl>' +
    '<div class="track">' +
    steps
      .map(
        (label, index) =>
          `<span class="track-step${index <= reached ? ' done' : ''}">
             <span class="track-bead"></span>${label}
           </span>`,
      )
      .join('') +
    '</div>';
}

/* ------------------------------------------------------------- fournisseur */

const ESCALATION_REASON_LABELS = {
  OUT_OF_STOCK: 'Rupture de stock',
  INCORRECT_ADDRESS: 'Adresse incorrecte ou incomplète',
  MISSING_ITEM: 'Article manquant',
  OTHER: 'Autre',
};

const ESCALATION_STATUS_LABELS = {
  DRAFTING: 'brouillon',
  OPEN: 'en attente du fournisseur',
  ANSWERED: 'fournisseur a répondu',
  RESOLVED: 'résolu',
};

async function loadSupplier() {
  const { suppliers } = await api('/api/suppliers');
  state.suppliers = suppliers;
  renderSupplierSummary();
}

const SUPPLIER_ROLE_LABELS = {
  SUPPLIER: 'Fournisseur',
  CARRIER: 'Transporteur',
  WORKSHOP: 'Atelier',
  WAREHOUSE: 'Entrepôt',
};

/** Contacts joignables : un contact désactivé ne doit pas être proposé. */
function activeSuppliers() {
  return state.suppliers.filter((supplier) => supplier.active);
}

function renderSupplierSummary() {
  const summary = $('supplier-summary');
  const active = activeSuppliers();

  if (active.length === 0) {
    summary.innerHTML =
      "<p class=\"empty\">Aucun contact actif — les escalades sont indisponibles. Ajoutez-en depuis l'onglet Fournisseurs.</p>";
    return;
  }

  summary.innerHTML = active
    .map(
      (supplier) => `<div class="row">
        <dt>${esc(SUPPLIER_ROLE_LABELS[supplier.role] ?? supplier.role)}</dt>
        <dd>${esc(supplier.name)}${
          supplier.openEscalations
            ? ` <span class="tag tag-status st-NEEDS_REVIEW">${supplier.openEscalations} en cours</span>`
            : ''
        }</dd>
      </div>`,
    )
    .join('');
}

$('supplier-edit-toggle').addEventListener('click', () => setView('suppliers'));

/* --------------------------------------------------------- fournisseurs -- */

function renderSuppliers() {
  const rows = state.suppliers;

  $('suppliers-rows').innerHTML =
    rows
      .map(
        (supplier) => `<tr class="grid-row${supplier.active ? '' : ' muted'}" data-supplier="${esc(supplier.id)}">
          <td><b>${esc(supplier.name)}</b>${
            supplier.contactName ? `<br><span class="sub">${esc(supplier.contactName)}</span>` : ''
          }</td>
          <td>${esc(SUPPLIER_ROLE_LABELS[supplier.role] ?? supplier.role)}</td>
          <td class="mono">${esc(supplier.contactEmail)}</td>
          <td class="mono">${esc(supplier.phone ?? '—')}</td>
          <td class="num mono">${supplier.openEscalations}</td>
          <td>${
            supplier.active
              ? '<span class="tag tag-status st-CLOSED">Actif</span>'
              : '<span class="tag tag-status st-NEW">Désactivé</span>'
          }</td>
          <td><button class="btn btn-small">Modifier</button></td>
        </tr>`,
      )
      .join('') ||
    '<tr><td colspan="7" class="empty">Aucun contact. Ajoutez le fournisseur, le transporteur ou l’atelier que vous sollicitez le plus.</td></tr>';

  const active = activeSuppliers().length;
  $('suppliers-count').textContent = rows.length
    ? `${rows.length} contact${rows.length > 1 ? 's' : ''} · ${active} actif${active > 1 ? 's' : ''}`
    : '';

  $('suppliers-rows')
    .querySelectorAll('.grid-row')
    .forEach((row) => row.addEventListener('click', () => openSupplierForm(row.dataset.supplier)));
}

/** `id` absent : création. Sinon édition, avec la suppression proposée. */
function openSupplierForm(id) {
  const supplier = id ? state.suppliers.find((candidate) => candidate.id === id) : null;
  state.editingSupplier = supplier?.id ?? null;

  $('supmodal-title').textContent = supplier ? supplier.name : 'Nouveau contact';
  $('sup-f-name').value = supplier?.name ?? '';
  $('sup-f-role').value = supplier?.role ?? 'SUPPLIER';
  $('sup-f-email').value = supplier?.contactEmail ?? '';
  $('sup-f-contact').value = supplier?.contactName ?? '';
  $('sup-f-phone').value = supplier?.phone ?? '';
  $('sup-f-notes').value = supplier?.notes ?? '';
  $('sup-f-active').checked = supplier ? supplier.active : true;

  // La suppression n'a de sens que sur un contact sans historique ; le serveur
  // tranche, on se contente de ne pas la proposer à la création.
  $('sup-f-delete').hidden = !supplier;

  $('supplier-modal').classList.add('open');
}

$('sup-new').addEventListener('click', () => openSupplierForm(null));
$('sup-f-cancel').addEventListener('click', () => $('supplier-modal').classList.remove('open'));
$('supplier-modal').addEventListener('click', (event) => {
  if (event.target === $('supplier-modal')) $('supplier-modal').classList.remove('open');
});

$('sup-f-save').addEventListener('click', async () => {
  const payload = {
    name: $('sup-f-name').value.trim(),
    role: $('sup-f-role').value,
    contactEmail: $('sup-f-email').value.trim(),
    contactName: $('sup-f-contact').value.trim() || null,
    phone: $('sup-f-phone').value.trim() || null,
    notes: $('sup-f-notes').value.trim() || null,
    active: $('sup-f-active').checked,
  };

  if (!payload.name || !payload.contactEmail) {
    toast("Le nom et l'email sont requis.", true);
    return;
  }

  try {
    const id = state.editingSupplier;
    await api(id ? `/api/suppliers/${id}` : '/api/suppliers', {
      method: id ? 'PATCH' : 'POST',
      body: JSON.stringify(payload),
    });

    $('supplier-modal').classList.remove('open');
    toast(id ? 'Contact mis à jour.' : 'Contact ajouté.');
    await Promise.all([loadSupplier(), loadAudit()]);
    renderSuppliers();
  } catch (error) {
    toast(error.message, true);
  }
});

$('sup-f-delete').addEventListener('click', async () => {
  const id = state.editingSupplier;
  if (!id) return;
  if (!confirm('Supprimer ce contact définitivement ?')) return;

  try {
    await api(`/api/suppliers/${id}`, { method: 'DELETE' });
    $('supplier-modal').classList.remove('open');
    toast('Contact supprimé.');
    await Promise.all([loadSupplier(), loadAudit()]);
    renderSuppliers();
  } catch (error) {
    // Le refus le plus fréquent — un contact avec de l'historique — arrive ici
    // avec sa propre explication.
    toast(error.message, true);
  }
});

/* --------------------------------------------------------------- équipe -- */

const ROLE_LABELS = {
  OWNER: 'Propriétaire',
  SUPERVISOR: 'Superviseur',
  AGENT: 'Agent',
  VIEWER: 'Lecture seule',
};

/* Ce que chaque rôle peut faire, en une ligne. Affiché dans le tableau : un
   nom de rôle seul ne dit rien à qui n'a pas lu la documentation. */
const ROLE_ABILITIES = {
  OWNER: 'Tout, y compris l’équipe et les réglages',
  SUPERVISOR: 'Répond, rembourse, règle la boutique',
  AGENT: 'Répond aux clients et escalade',
  VIEWER: 'Consulte sans rien envoyer',
};

function isOwner() {
  return state.team.me?.role === 'OWNER';
}

async function loadTeam() {
  const data = await api('/api/team');
  state.team = data;
  renderTeam();
}

function renderTeam() {
  const { users } = state.team;
  const owner = isOwner();

  $('team-new').hidden = !owner;

  $('team-rows').innerHTML = users
    .map((user) => {
      const self = user.id === state.team.me?.id;
      return `<tr class="grid-row${user.active ? '' : ' muted'}" data-user="${esc(user.id)}">
        <td>
          <b>${esc(user.name ?? user.email)}</b>${self ? ' <span class="sub">(vous)</span>' : ''}
          <br /><span class="sub mono">${esc(user.email)}</span>
        </td>
        <td>${esc(ROLE_LABELS[user.role] ?? user.role)}</td>
        <td class="sub">${esc(ROLE_ABILITIES[user.role] ?? '')}</td>
        <td>${
          user.lastLoginAt
            ? relativeTime(user.lastLoginAt)
            : user.invitedAt
              ? `<span class="sub">invité ${relativeTime(user.invitedAt)}</span>`
              : '<span class="sub">jamais</span>'
        }</td>
        <td>${
          user.active
            ? '<span class="tag tag-status st-CLOSED">Actif</span>'
            : '<span class="tag tag-status st-NEW">Désactivé</span>'
        }</td>
        <td>${owner ? '<button class="btn btn-small">Modifier</button>' : ''}</td>
      </tr>`;
    })
    .join('');

  const active = users.filter((user) => user.active).length;
  $('team-count').textContent = `${users.length} personne${users.length > 1 ? 's' : ''} · ${active} active${
    active > 1 ? 's' : ''
  }`;

  if (owner) {
    $('team-rows')
      .querySelectorAll('.grid-row')
      .forEach((row) => row.addEventListener('click', () => openTeamForm(row.dataset.user)));
  }
}

function describeRole() {
  $('team-f-perms').textContent = ROLE_ABILITIES[$('team-f-role').value] ?? '';
}

/** `id` absent : invitation. Sinon édition du rôle et de l'état. */
function openTeamForm(id) {
  const user = id ? state.team.users.find((candidate) => candidate.id === id) : null;
  state.editingUser = user?.id ?? null;
  const self = user?.id === state.team.me?.id;

  $('teammodal-title').textContent = user ? (user.name ?? user.email) : "Inviter quelqu'un";
  $('team-f-email').value = user?.email ?? '';
  $('team-f-email').disabled = Boolean(user); // l'adresse identifie le compte
  $('team-f-name').value = user?.name ?? '';
  $('team-f-role').value = user?.role ?? 'AGENT';
  $('team-f-active').checked = user ? user.active : true;

  $('team-f-active-row').hidden = !user;
  $('team-f-resend').hidden = !user;
  $('team-f-link').hidden = true;

  // Se rétrograder ou se désactiver soi-même fermerait la porte de l'intérieur.
  $('team-f-role').disabled = self;
  $('team-f-active').disabled = self;

  describeRole();
  $('team-modal').classList.add('open');
}

$('team-f-role').addEventListener('change', describeRole);
$('team-new').addEventListener('click', () => openTeamForm(null));
$('team-f-cancel').addEventListener('click', () => $('team-modal').classList.remove('open'));
$('team-modal').addEventListener('click', (event) => {
  if (event.target === $('team-modal')) $('team-modal').classList.remove('open');
});

/** Affiche le lien quand l'email n'a pas pu partir, au lieu de mentir. */
function showInviteLink(payload) {
  if (payload?.inviteUrl) {
    $('team-f-link-url').textContent = payload.inviteUrl;
    $('team-f-link').hidden = false;
    return false;
  }
  return true;
}

$('team-f-save').addEventListener('click', async () => {
  const id = state.editingUser;

  try {
    if (id) {
      const payload = { name: $('team-f-name').value.trim() || null };
      // Champs verrouillés sur soi-même : ne pas les envoyer évite un 409
      // inutile côté serveur.
      if (!$('team-f-role').disabled) {
        payload.role = $('team-f-role').value;
        payload.active = $('team-f-active').checked;
      }

      await api(`/api/team/${id}`, { method: 'PATCH', body: JSON.stringify(payload) });
      $('team-modal').classList.remove('open');
      toast('Membre mis à jour.');
    } else {
      const email = $('team-f-email').value.trim();
      if (!email) {
        toast('Une adresse email est requise.', true);
        return;
      }

      const result = await api('/api/team', {
        method: 'POST',
        body: JSON.stringify({
          email,
          name: $('team-f-name').value.trim() || undefined,
          role: $('team-f-role').value,
        }),
      });

      if (showInviteLink(result)) {
        $('team-modal').classList.remove('open');
        toast('Invitation envoyée.');
      }
    }

    await Promise.all([loadTeam(), loadAudit()]);
  } catch (error) {
    toast(error.message, true);
  }
});

$('team-f-resend').addEventListener('click', async () => {
  const id = state.editingUser;
  if (!id) return;

  try {
    const result = await api(`/api/team/${id}/invite`, { method: 'POST' });
    if (showInviteLink(result)) {
      toast('Invitation renvoyée.');
      $('team-modal').classList.remove('open');
    }
    await loadTeam();
  } catch (error) {
    toast(error.message, true);
  }
});

/* ------------------------------------------------------------ navigation */

/* Trois sections dans une seule page : la file de tickets, le carnet de
   commandes et le fichier client. Les deux dernières interrogent Shopify en
   direct, donc on ne les charge qu'à la première ouverture. */

const VIEWS = ['tickets', 'orders', 'customers', 'suppliers', 'team'];

function setView(view) {
  state.view = view;

  for (const name of VIEWS) $(`view-${name}`).hidden = name !== view;

  $('tabs')
    .querySelectorAll('.tab')
    .forEach((tab) => tab.setAttribute('aria-pressed', String(tab.dataset.view === view)));

  // Les indicateurs ne concernent que la file : les masquer ailleurs évite de
  // laisser croire qu'ils décrivent l'écran affiché.
  $('kpis').hidden = view !== 'tickets';

  if (view === 'orders' && !state.orders.loaded) loadOrders({ reset: true });
  if (view === 'customers' && !state.customers.loaded) loadCustomers({ reset: true });
  if (view === 'suppliers') renderSuppliers();
  if (view === 'team') loadTeam();
}

$('tabs').addEventListener('click', (event) => {
  const tab = event.target.closest('.tab');
  if (tab) setView(tab.dataset.view);
});

/* --------------------------------------------------------- commandes ---- */

const FINANCIAL_LABELS = {
  PAID: 'Payée',
  PARTIALLY_PAID: 'Partiellement payée',
  PENDING: 'En attente',
  REFUNDED: 'Remboursée',
  PARTIALLY_REFUNDED: 'Partiellement remboursée',
  VOIDED: 'Annulée',
  AUTHORIZED: 'Autorisée',
  EXPIRED: 'Expirée',
};

const FULFILLMENT_LABELS = {
  FULFILLED: 'Expédiée',
  UNFULFILLED: 'Non expédiée',
  PARTIALLY_FULFILLED: 'Partiellement expédiée',
  IN_PROGRESS: 'En préparation',
  IN_TRANSIT: 'En transit',
  OUT_FOR_DELIVERY: 'En livraison',
  DELIVERED: 'Livrée',
  ON_HOLD: 'En attente',
  SCHEDULED: 'Programmée',
  RESTOCKED: 'Remise en stock',
};

/** Couleur de pastille : ce qui demande une action ressort, le reste s'efface. */
function statusTag(value, labels, alert) {
  if (!value) return '<span class="tag tag-status st-NEW">—</span>';
  const label = labels[value] ?? value;
  const cls = alert.includes(value) ? 'st-NEEDS_REVIEW' : 'st-CLOSED';
  return `<span class="tag tag-status ${cls}">${esc(label)}</span>`;
}

async function loadOrders({ reset = false } = {}) {
  const store = state.orders;
  if (store.loading) return;

  store.loading = true;
  const body = $('orders-rows');

  if (reset) {
    store.items = [];
    store.cursor = null;
    body.innerHTML = '<tr><td colspan="6" class="empty">Chargement…</td></tr>';
  }

  const params = new URLSearchParams();
  if (store.q) params.set('q', store.q);
  if (store.cursor) params.set('cursor', store.cursor);

  try {
    const page = await api(`/api/orders?${params}`);
    store.items = store.items.concat(page.orders);
    store.cursor = page.cursor;
    store.hasNext = page.hasNextPage;
    store.loaded = true;
    renderOrders();
  } catch (error) {
    body.innerHTML = `<tr><td colspan="6" class="empty">${esc(error.message)}</td></tr>`;
    $('orders-count').textContent = '';
    $('orders-more').hidden = true;
  } finally {
    store.loading = false;
  }
}

function renderOrders() {
  const store = state.orders;

  $('orders-rows').innerHTML =
    store.items
      .map(
        (order) => `<tr class="grid-row" data-order="${esc(order.id)}">
          <td class="mono"><b>${esc(order.name)}</b></td>
          <td>${esc(order.customer?.displayName ?? order.customer?.email ?? 'Client inconnu')}</td>
          <td>${fullDate(order.createdAt)}</td>
          <td>${statusTag(order.displayFinancialStatus, FINANCIAL_LABELS, ['PENDING', 'PARTIALLY_PAID', 'EXPIRED'])}</td>
          <td>${statusTag(order.displayFulfillmentStatus, FULFILLMENT_LABELS, ['UNFULFILLED', 'ON_HOLD'])}</td>
          <td class="num mono">${euro(order.totalPrice, order.currency)}</td>
        </tr>`,
      )
      .join('') || '<tr><td colspan="6" class="empty">Aucune commande.</td></tr>';

  $('orders-count').textContent = store.items.length
    ? `${store.items.length} commande${store.items.length > 1 ? 's' : ''}${store.hasNext ? ' affichées' : ''}`
    : '';
  $('orders-more').hidden = !store.hasNext;

  // Cliquer une ligne ouvre le détail dans le panneau latéral de la file :
  // c'est là que vivent déjà l'adresse, le suivi et le remboursement.
  $('orders-rows')
    .querySelectorAll('.grid-row')
    .forEach((row) => row.addEventListener('click', () => openOrderSheet(row.dataset.order)));
}

async function openOrderSheet(id) {
  try {
    const { order } = await api(`/api/orders/${encodeURIComponent(id)}`);
    // On réutilise les panneaux de la fiche ticket : ce sont les mêmes
    // informations, et le remboursement y est déjà câblé.
    renderCustomer(order);
    renderOrder(null, order, null);
    renderShipping(order);
    setView('tickets');
    $('d-subject').textContent = `Commande ${order.name}`;
    $('d-meta').innerHTML = `${esc(order.customer?.displayName ?? '')} · <code>${esc(
      order.customer?.email ?? '—',
    )}</code>`;
    $('d-messages').innerHTML =
      '<p class="empty">Consultation depuis le carnet de commandes — aucun échange rattaché.</p>';
    $('draft-zone').hidden = true;
    $('no-draft').hidden = false;
    $('no-draft-text').textContent =
      'Ouvrez un ticket pour rédiger une réponse. Le remboursement reste accessible depuis un ticket.';
  } catch (error) {
    toast(error.message, true);
  }
}

$('orders-more').addEventListener('click', () => loadOrders());

$('orders-q').addEventListener('input', (event) => {
  state.orders.q = event.target.value.trim();
  clearTimeout(state.orders.timer);
  // Chaque frappe déclencherait un appel Shopify : on attend une pause.
  state.orders.timer = setTimeout(() => loadOrders({ reset: true }), 350);
});

/* ------------------------------------------------------------- clients -- */

async function loadCustomers({ reset = false } = {}) {
  const store = state.customers;
  if (store.loading) return;

  store.loading = true;
  const body = $('customers-rows');

  if (reset) {
    store.items = [];
    store.cursor = null;
    body.innerHTML = '<tr><td colspan="7" class="empty">Chargement…</td></tr>';
  }

  const params = new URLSearchParams();
  if (store.q) params.set('q', store.q);
  if (store.cursor) params.set('cursor', store.cursor);

  try {
    const page = await api(`/api/customers?${params}`);
    store.items = store.items.concat(page.customers);
    store.cursor = page.cursor;
    store.hasNext = page.hasNextPage;
    store.loaded = true;
    renderCustomers();
  } catch (error) {
    body.innerHTML = `<tr><td colspan="7" class="empty">${esc(error.message)}</td></tr>`;
    $('customers-count').textContent = '';
    $('customers-more').hidden = true;
  } finally {
    store.loading = false;
  }
}

function renderCustomers() {
  const store = state.customers;

  $('customers-rows').innerHTML =
    store.items
      .map(
        (customer) => `<tr class="grid-row" data-email="${esc(customer.email ?? '')}">
          <td><b>${esc(customer.displayName ?? '—')}</b></td>
          <td class="mono">${esc(customer.email ?? '—')}</td>
          <td>${esc([customer.city, customer.country].filter(Boolean).join(', ') || '—')}</td>
          <td>${fullDate(customer.createdAt)}</td>
          <td class="num mono">${customer.numberOfOrders}</td>
          <td class="num mono">${euro(customer.amountSpent, customer.currency)}</td>
          <td>${
            customer.lastOrder
              ? `<span class="mono">${esc(customer.lastOrder.name)}</span> · ${relativeTime(
                  customer.lastOrder.createdAt,
                )}`
              : '—'
          }</td>
        </tr>`,
      )
      .join('') || '<tr><td colspan="7" class="empty">Aucun client.</td></tr>';

  $('customers-count').textContent = store.items.length
    ? `${store.items.length} client${store.items.length > 1 ? 's' : ''}`
    : '';
  $('customers-more').hidden = !store.hasNext;

  // Cliquer un client bascule sur ses commandes : c'est la question suivante
  // qu'on se pose toujours.
  $('customers-rows')
    .querySelectorAll('.grid-row')
    .forEach((row) =>
      row.addEventListener('click', () => {
        if (!row.dataset.email) return;
        state.orders.q = row.dataset.email;
        $('orders-q').value = row.dataset.email;
        setView('orders');
        loadOrders({ reset: true });
      }),
    );
}

$('customers-more').addEventListener('click', () => loadCustomers());

$('customers-q').addEventListener('input', (event) => {
  state.customers.q = event.target.value.trim();
  clearTimeout(state.customers.timer);
  state.customers.timer = setTimeout(() => loadCustomers({ reset: true }), 350);
});

/* --------------------------------------------------------------- réglages */

/**
 * Une ligne de connexion : état, détail, et le bouton qui va avec.
 *
 * Connecter Shopify ou Gmail est une navigation OAuth, pas un appel d'API —
 * d'où les liens plutôt que des `fetch`. Seule la déconnexion Gmail est un
 * POST, parce qu'elle détruit des données.
 */
function renderConnection(el, { label, connected, simulated, detail, actions }) {
  const dot = simulated ? 'warn' : connected ? '' : 'off';
  const status = simulated ? 'simulé' : connected ? 'connecté' : 'non connecté';

  // En mode simulé, aucune autorisation réelle n'est en jeu : proposer de
  // connecter ou de déconnecter promettrait un effet qui n'aura pas lieu.
  if (simulated) actions = '';

  el.innerHTML = `
    <div class="set-conn-head">
      <span class="conn-pill"><span class="dot ${dot}"></span> ${esc(label)} ${esc(status)}</span>
      <span class="set-conn-actions">${actions}</span>
    </div>
    <p class="set-conn-detail">${detail}</p>`;
}

function renderSettings() {
  const { merchant, connections } = state.settings;

  renderConnection($('set-shopify'), {
    label: 'Shopify',
    connected: connections.shopify.connected,
    simulated: connections.shopify.simulated,
    detail: connections.shopify.connected
      ? `Boutique <code>${esc(merchant.shopDomain)}</code> · autorisations : ${
          connections.shopify.scopes.map(esc).join(', ') || '—'
        }`
      : "L'accès Shopify vient de l'installation de l'application depuis votre administration.",
    // Se déconnecter de Shopify, c'est désinstaller l'app côté Shopify : le
    // faire depuis ici laisserait les deux côtés en désaccord.
    actions: connections.shopify.connected
      ? `<a class="btn btn-small" href="https://${esc(
          merchant.shopDomain,
        )}/admin/settings/apps" target="_blank" rel="noopener">Gérer sur Shopify</a>`
      : `<a class="btn btn-small btn-primary" href="/auth/shopify?shop=${encodeURIComponent(
          merchant.shopDomain,
        )}">Connecter</a>`,
  });

  const gmail = connections.gmail;
  let gmailDetail;
  if (!gmail.connected) {
    gmailDetail = 'Aucune boîte connectée — rien n’est ingéré.';
  } else if (gmail.watchActive) {
    gmailDetail = `<code>${esc(gmail.emailAddress)}</code> · écoute active jusqu’au ${fullDate(
      gmail.watchExpiration,
    )}`;
  } else {
    // Le watch Gmail expire au bout de 7 jours et rien ne le signale ailleurs :
    // c'est la panne silencieuse la plus probable du produit.
    gmailDetail = `<code>${esc(
      gmail.emailAddress,
    )}</code> · <b class="set-alert">écoute expirée</b> — reconnectez la boîte pour relancer l’ingestion.`;
  }

  renderConnection($('set-gmail'), {
    label: 'Gmail',
    connected: gmail.connected,
    simulated: gmail.simulated,
    detail: gmailDetail,
    actions: gmail.connected
      ? `<a class="btn btn-small" href="/auth/google">Reconnecter</a>
         <button class="btn btn-small btn-danger" id="set-gmail-off">Déconnecter</button>`
      : '<a class="btn btn-small btn-primary" href="/auth/google">Connecter</a>',
  });

  $('set-autosend').checked = merchant.autoSendEnabled;
  $('set-threshold').value = merchant.autoSendThreshold;
  $('set-threshold-echo').textContent = `${Math.round(merchant.autoSendThreshold * 100)} %`;
  $('set-retention').value = String(merchant.retentionDays);

  const off = $('set-gmail-off');
  if (off) {
    off.addEventListener('click', async () => {
      if (!confirm('Déconnecter la boîte Gmail ? L’ingestion des nouveaux mails s’arrête.')) return;
      try {
        await api('/auth/google/disconnect', { method: 'POST' });
        toast('Boîte Gmail déconnectée.');
        await Promise.all([openSettings(), loadAudit()]);
      } catch (error) {
        toast(error.message, true);
      }
    });
  }
}

async function openSettings() {
  state.settings = await api('/api/settings');
  renderSettings();
  $('settings-modal').classList.add('open');
}

$('settings-open').addEventListener('click', async () => {
  try {
    await openSettings();
  } catch (error) {
    toast(error.message, true);
  }
});

$('set-cancel').addEventListener('click', () => $('settings-modal').classList.remove('open'));

$('settings-modal').addEventListener('click', (event) => {
  if (event.target === $('settings-modal')) $('settings-modal').classList.remove('open');
});

$('set-threshold').addEventListener('input', (event) => {
  $('set-threshold-echo').textContent = `${Math.round(Number(event.target.value) * 100)} %`;
});

$('set-save').addEventListener('click', async () => {
  try {
    const { merchant } = await api('/api/settings', {
      method: 'PATCH',
      body: JSON.stringify({
        autoSendEnabled: $('set-autosend').checked,
        autoSendThreshold: Number($('set-threshold').value),
        retentionDays: Number($('set-retention').value),
      }),
    });

    // La barre haute et l'indicateur « envoi automatique » affichent ces
    // valeurs : les rafraîchir évite un écran qui se contredit.
    state.me.merchant.autoSendEnabled = merchant.autoSendEnabled;
    state.me.merchant.autoSendThreshold = merchant.autoSendThreshold;
    renderMe();
    await Promise.all([loadMetrics(), loadAudit()]);

    toast('Réglages enregistrés.');
    $('settings-modal').classList.remove('open');
  } catch (error) {
    toast(error.message, true);
  }
});

async function loadEscalations(ticketId) {
  const container = $('escalations');
  const data = await api(`/api/tickets/${ticketId}/escalations`);
  const escalations = data.escalations ?? [];

  const contacts = activeSuppliers();

  const newForm = contacts.length
    ? `<div class="escalation" id="new-escalation">
        <div class="field">
          <label for="esc-supplier">Destinataire</label>
          <select id="esc-supplier">
            <option value="">Choisir d'après le motif</option>
            ${contacts
              .map(
                (supplier) =>
                  `<option value="${esc(supplier.id)}">${esc(supplier.name)} — ${esc(
                    SUPPLIER_ROLE_LABELS[supplier.role] ?? supplier.role,
                  )}</option>`,
              )
              .join('')}
          </select>
        </div>
        <div class="field" style="margin-top:8px">
          <label for="esc-reason">Motif</label>
          <select id="esc-reason">
            <option value="OUT_OF_STOCK">Rupture de stock</option>
            <option value="INCORRECT_ADDRESS">Adresse incorrecte ou incomplète</option>
            <option value="MISSING_ITEM">Article manquant</option>
            <option value="OTHER">Autre</option>
          </select>
        </div>
        <div class="field" style="margin-top:8px">
          <label for="esc-note">Note pour l'IA (facultatif)</label>
          <textarea id="esc-note" placeholder="Contexte à transmettre au fournisseur…"></textarea>
        </div>
        <div class="actions" style="margin-top:8px">
          <button class="btn" id="esc-create">Rédiger un message fournisseur</button>
        </div>
      </div>`
    : '';

  container.innerHTML =
    newForm +
    escalations
      .map((escalation) => {
        const draft = escalation.status === 'DRAFTING';
        const messages = escalation.messages
          .map(
            (message) => `<div class="msg${message.direction === 'FROM_SUPPLIER' ? ' out' : ''}">
              <div class="msg-head">
                <b>${message.direction === 'FROM_SUPPLIER' ? 'Fournisseur' : 'Vous'}</b>
                <span>${shortTime(message.createdAt)}</span>
              </div>
              ${
                draft && message === escalation.messages[escalation.messages.length - 1]
                  ? `<textarea class="esc-body" data-id="${escalation.id}">${esc(message.body)}</textarea>`
                  : `<div class="msg-body">${esc(message.body)}</div>`
              }
            </div>`,
          )
          .join('');

        const actions = draft
          ? `<div class="actions" style="margin-top:8px">
              <button class="btn btn-primary esc-send" data-id="${escalation.id}">Envoyer au fournisseur</button>
            </div>`
          : escalation.status !== 'RESOLVED'
            ? `<div class="actions" style="margin-top:8px">
                <button class="btn esc-resolve" data-id="${escalation.id}">Marquer résolu</button>
              </div>`
            : '';

        return `<div class="escalation">
          <div class="escalation-head">
            <b>${ESCALATION_REASON_LABELS[escalation.reason] ?? escalation.reason}</b>
            <span>${ESCALATION_STATUS_LABELS[escalation.status] ?? escalation.status}</span>
          </div>
          ${messages}
          ${actions}
        </div>`;
      })
      .join('');

  $('esc-create')?.addEventListener('click', () => createEscalation(ticketId));
  container.querySelectorAll('.esc-send').forEach((button) => {
    button.addEventListener('click', () => sendEscalation(ticketId, button.dataset.id));
  });
  container.querySelectorAll('.esc-resolve').forEach((button) => {
    button.addEventListener('click', () => resolveEscalation(ticketId, button.dataset.id));
  });
}

async function createEscalation(ticketId) {
  try {
    await api(`/api/tickets/${ticketId}/escalations`, {
      method: 'POST',
      body: JSON.stringify({
        reason: $('esc-reason').value,
        note: $('esc-note').value.trim() || undefined,
        supplierId: $('esc-supplier').value || undefined,
      }),
    });
    toast('Brouillon fournisseur rédigé.');
    await loadEscalations(ticketId);
  } catch (error) {
    toast(error.message, true);
  }
}

async function sendEscalation(ticketId, escalationId) {
  const textarea = document.querySelector(`.esc-body[data-id="${escalationId}"]`);
  try {
    if (textarea) {
      await api(`/api/escalations/${escalationId}`, {
        method: 'PATCH',
        body: JSON.stringify({ body: textarea.value }),
      });
    }
    await api(`/api/escalations/${escalationId}/send`, { method: 'POST' });
    toast('Fournisseur notifié.');
    await Promise.all([loadAudit(), selectTicket(ticketId)]);
  } catch (error) {
    toast(error.message, true);
  }
}

async function resolveEscalation(ticketId, escalationId) {
  try {
    await api(`/api/escalations/${escalationId}/resolve`, { method: 'POST' });
    toast('Escalade clôturée.');
    await Promise.all([loadEscalations(ticketId), loadAudit()]);
  } catch (error) {
    toast(error.message, true);
  }
}

/* ------------------------------------------------------------------ audit */

const AUDIT_LABELS = {
  'shopify.connected': 'Boutique Shopify connectée',
  'shopify.uninstalled': 'Application désinstallée',
  'gmail.connected': 'Boîte Gmail connectée',
  'gmail.disconnected': 'Boîte Gmail déconnectée',
  'draft.created': 'Brouillon généré',
  'draft.edited': 'Brouillon modifié',
  'draft.sent': 'Réponse envoyée',
  'ticket.order_attached': 'Commande rattachée',
  'refund.requested': 'Remboursement demandé',
  'refund.completed': 'Remboursement effectué',
  'refund.failed': 'Remboursement en échec',
  'merchant.settings_updated': 'Réglages modifiés',
  'user.invited': 'Membre invité',
  'user.joined': 'Membre a rejoint l’équipe',
  'user.logged_in': 'Connexion',
  'user.updated': 'Membre modifié',
  'supplier.configured': 'Fournisseur configuré',
  'supplier.created': 'Contact fournisseur ajouté',
  'supplier.updated': 'Contact fournisseur modifié',
  'supplier.deleted': 'Contact fournisseur supprimé',
  'supplier.escalation_created': 'Escalade fournisseur rédigée',
  'supplier.notified': 'Fournisseur notifié',
  'supplier.replied': 'Réponse du fournisseur',
  'supplier.escalation_resolved': 'Escalade fournisseur clôturée',
};

async function loadAudit() {
  const data = await api('/api/audit');

  $('c-audit').innerHTML =
    data.entries
      .map((entry) => {
        const meta = entry.metadata ?? {};
        const detail = [
          meta.orderName,
          meta.amount ? euro(meta.amount, meta.currency ?? 'EUR') : null,
          meta.reason,
          meta.intent,
        ]
          .filter(Boolean)
          .join(' · ');

        return `<li>
          <time>${shortTime(entry.createdAt)}</time>
          <span><b>${esc(AUDIT_LABELS[entry.action] ?? entry.action)}</b>${
            detail ? `<br>${esc(detail)}` : ''
          }</span>
        </li>`;
      })
      .join('') || '<li class="empty" style="padding:12px 14px">Aucune action enregistrée.</li>';
}

/* ------------------------------------------------------------ actions IHM */

$('filters').addEventListener('click', async (event) => {
  const chip = event.target.closest('.chip');
  if (!chip) return;

  state.filter = chip.dataset.filter;
  $('filters')
    .querySelectorAll('.chip')
    .forEach((other) => other.setAttribute('aria-pressed', String(other === chip)));

  await loadQueue();
});

$('btn-save').addEventListener('click', async () => {
  const draft = state.detail?.ticket.drafts?.[0];
  if (!draft) return;

  try {
    await api(`/api/drafts/${draft.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ body: $('d-body').value }),
    });
    toast('Brouillon enregistré.');
    await Promise.all([selectTicket(state.currentId), loadAudit()]);
  } catch (error) {
    toast(error.message, true);
  }
});

$('btn-send').addEventListener('click', async () => {
  const draft = state.detail?.ticket.drafts?.[0];
  if (!draft) return;

  const edited = $('d-body').value !== draft.body;

  try {
    // On enregistre avant d'envoyer : sinon les retouches de l'agent seraient
    // perdues et le mail partirait dans sa version générée.
    if (edited) {
      await api(`/api/drafts/${draft.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ body: $('d-body').value }),
      });
    }

    await api(`/api/drafts/${draft.id}/send`, { method: 'POST' });
    toast('Réponse envoyée.');
    await Promise.all([selectTicket(state.currentId), loadMetrics(), loadAudit()]);
  } catch (error) {
    toast(error.message, true);
  }
});

/* ---------------------------------------------------------- remboursement */

const modal = $('refund-modal');

function closeModal() {
  modal.classList.remove('open');
  state.refund = null;
}

$('btn-refund').addEventListener('click', async () => {
  const ticket = state.detail?.ticket;
  if (!ticket?.shopifyOrderId) return;

  try {
    // L'aperçu délivre le jeton de confirmation : sans lui, le POST est refusé.
    // C'est ce qui garantit qu'aucun remboursement ne part en un clic.
    const preview = await api(
      `/api/refunds/preview?orderId=${encodeURIComponent(ticket.shopifyOrderId)}`,
    );

    state.refund = { ticket, preview };

    $('r-order').textContent = ticket.orderName ?? '';
    $('r-max').textContent = euro(preview.refundableAmount, preview.currency);
    $('r-amount').value = Number(preview.refundableAmount).toFixed(2);
    $('r-echo').textContent = euro(preview.refundableAmount, preview.currency);
    $('r-check').checked = false;
    $('r-go').disabled = true;

    modal.classList.add('open');
    $('r-amount').focus();
  } catch (error) {
    toast(error.message, true);
  }
});

$('r-amount').addEventListener('input', () => {
  const value = Number($('r-amount').value.replace(',', '.')) || 0;
  $('r-echo').textContent = euro(value, state.refund?.preview.currency ?? 'EUR');
});

$('r-check').addEventListener('change', () => {
  $('r-go').disabled = !$('r-check').checked;
});

$('r-cancel').addEventListener('click', closeModal);

modal.addEventListener('click', (event) => {
  if (event.target === modal) closeModal();
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && modal.classList.contains('open')) closeModal();
});

$('r-go').addEventListener('click', async () => {
  if (!state.refund) return;

  const { ticket, preview } = state.refund;
  const amount = $('r-amount').value.replace(',', '.');

  $('r-go').disabled = true;

  try {
    await api('/api/refunds', {
      method: 'POST',
      body: JSON.stringify({
        ticketId: ticket.id,
        orderId: ticket.shopifyOrderId,
        amount,
        reason: $('r-reason').value,
        confirmationToken: preview.confirmationToken,
      }),
    });

    closeModal();
    toast(`Remboursement de ${euro(amount, preview.currency)} effectué.`);
    await loadAudit();
  } catch (error) {
    $('r-go').disabled = false;
    toast(error.message, true);
  }
});

/* ------------------------------------------------------------- démarrage */

async function boot() {
  try {
    state.me = await api('/api/me');
  } catch (error) {
    if (error.status !== 401) {
      showGate(error.message);
    }
    return;
  }

  $('gate').hidden = true;
  $('app').hidden = false;

  renderMe();
  await Promise.all([loadMetrics(), loadQueue(), loadAudit(), loadSupplier()]);

  if (state.tickets.length > 0) {
    await selectTicket(state.tickets[0].id);
  }
}

boot();
