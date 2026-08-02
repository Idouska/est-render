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

function showGate(message) {
  $('gate-text').textContent = message;
  $('gate').hidden = false;
  $('app').hidden = true;
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
    pills.push(`<span class="conn-pill">${esc(me.user.name ?? me.user.email)}</span>`);
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
  await loadQueue();
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
  $('btn-send').disabled = sent;
  $('btn-send').textContent = sent ? 'Réponse envoyée' : 'Envoyer la réponse';
  $('btn-save').disabled = sent;
  $('btn-refund').disabled = !ticket.shopifyOrderId;
  $('btn-refund').title = ticket.shopifyOrderId
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
  await Promise.all([loadMetrics(), loadQueue(), loadAudit()]);

  if (state.tickets.length > 0) {
    await selectTicket(state.tickets[0].id);
  }
}

boot();
