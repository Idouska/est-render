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
  pendingCount: 0,
  shops: [],
  allShops: false,
  navQuery: '',
  refreshing: false,
  lastRefresh: null,
  queue: {
    q: '', intent: '', assignee: '', mailbox: '', sort: 'newest',
    urgent: false, unassigned: false, unlinked: false, timer: null,
  },
  queueCounts: {},
  agents: [],
  catalog: { items: [], cursor: null, hasNext: false, q: '', kind: 'products', loading: false, loaded: false, timer: null },
  editingUser: null,
  refundRows: [],
  refundFilter: '',
  settings: null,
  view: 'tickets',
  orders: {
    items: [], cursor: null, hasNext: false, q: '', loading: false, loaded: false, timer: null,
    sort: 'recent', payment: '', delivery: '',
  },
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

/** Domaine de la dernière boutique ouverte sur cet appareil. */
function installUrlFor(shopDomain) {
  return `/auth/shopify?shop=${encodeURIComponent(shopDomain)}`;
}

async function showGate(message) {
  $('gate-text').textContent = message;
  $('gate').hidden = false;
  $('app').hidden = true;

  // En production, le raccourci de développement n'existe pas : on renvoie
  // vers l'installation Shopify plutôt que vers un lien mort.
  let devMode = false;
  try {
    const config = await fetch('/api/config').then((r) => r.json());
    devMode = Boolean(config.devMode);
  } catch {
    devMode = false;
  }

  $('gate-dev').hidden = !devMode;
  $('gate-prod').hidden = devMode;

  // La session est un cookie propre à chaque navigateur : ouvrir le dashboard
  // sur un téléphone tombe forcément ici la première fois. Demander de
  // composer une URL à la main à ce moment-là est le pire moment pour le faire,
  // donc on retient le domaine et on propose un bouton.
  const known = localStorage.getItem('csav.shop');

  if (!devMode && known) {
    $('gate-login').href = installUrlFor(known);
    $('gate-login').textContent = `Se reconnecter à ${known.replace('.myshopify.com', '')}`;
    $('gate-login').hidden = false;
    $('gate-form').hidden = true;
  } else if (!devMode) {
    $('gate-login').hidden = true;
    $('gate-form').hidden = false;
  } else {
    $('gate-login').hidden = true;
    $('gate-form').hidden = true;
  }
}

$('gate-form').addEventListener('submit', (event) => {
  event.preventDefault();

  const raw = $('gate-shop')
    .value.trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '');
  if (!raw) return;

  location.href = installUrlFor(raw.endsWith('.myshopify.com') ? raw : `${raw}.myshopify.com`);
});

/* ------------------------------------------------------------- barre haute */

function renderMe() {
  const me = state.me;
  const shop = me.merchant.shopDomain ?? '';

  const brand = state.allShops
    ? 'Toutes les boutiques'
    : me.merchant.brandName || me.merchant.name || 'cSAV Copilot';

  $('merchant-name').textContent = brand;
  $('merchant-shop').textContent = state.allShops
    ? `${state.shops.length} boutiques`
    : shop.replace('.myshopify.com', '');
  $('brand-mark').textContent = brand.slice(0, 2).toUpperCase();

  // Le logo remplace les initiales quand il est renseigné, et retombe dessus
  // si l'image ne charge pas — une URL cassée ne doit pas laisser un trou.
  const logo = $('brand-logo');
  if (me.merchant.logoUrl) {
    logo.src = me.merchant.logoUrl;
    logo.hidden = false;
    $('brand-mark').hidden = true;
    logo.onerror = () => {
      logo.hidden = true;
      $('brand-mark').hidden = false;
    };
  } else {
    logo.hidden = true;
    $('brand-mark').hidden = false;
  }

  const who = me.user?.name ?? me.user?.email ?? '—';
  $('me-name').textContent = who;
  $('me-role').textContent = ROLE_LABELS[me.user?.role] ?? '';
  $('me-avatar').textContent = who
    .split(/[\s.@]+/)
    .slice(0, 2)
    .map((part) => part[0] ?? '')
    .join('')
    .toUpperCase();

  const pills = [];

  pills.push(
    me.shopify.connected || me.shopify.simulated
      ? `<span class="conn-pill"><span class="dot${
          me.shopify.simulated ? ' warn' : ''
        }"></span> Shopify ${me.shopify.simulated ? 'simulé' : 'connecté'}</span>`
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
    pills.push('<span class="conn-pill"><span class="dot off"></span> Gmail non connecté</span>');
  }

  pills.push(
    `<span class="conn-pill"><span class="dot${
      me.merchant.autoSendEnabled ? '' : ' warn'
    }"></span> Envoi auto ${me.merchant.autoSendEnabled ? 'activé' : 'désactivé'}</span>`,
  );

  $('conn').innerHTML = pills.join('');
  $('mock-notice').hidden = !me.shopify.simulated;
}

/* ------------------------------------------------------- sélecteur boutique */

async function loadShops() {
  try {
    const data = await api('/api/shops');
    state.shops = data.shops ?? [];
  } catch {
    // Le sélecteur est un confort : s'il échoue, le dashboard reste utilisable
    // sur la boutique en cours.
    state.shops = [];
  }
  renderShopMenu();
}

function renderShopMenu() {
  const canAdd = canI('configure');
  const rows = [];

  // Le mode agrégé n'a de sens qu'à partir de deux boutiques.
  if (state.shops.length > 1) {
    rows.push(`
      <button class="shop-item" type="button" data-shop-all="1" aria-current="${
        state.allShops ? 'true' : 'false'
      }">
        <span class="shop-dot"></span>
        <span style="min-width:0">
          <b>Toutes les boutiques</b>
          <small>${state.shops.length} boutiques réunies dans une seule file</small>
        </span>
      </button>`);
    rows.push('<hr />');
  }

  rows.push(...state.shops.map(
    (shop) => `
      <button class="shop-item" type="button" data-shop="${esc(shop.id)}" aria-current="${
        shop.current && !state.allShops ? 'true' : 'false'
      }">
        <span class="shop-dot" style="background:${esc(shop.color ?? '')}"></span>
        <span style="min-width:0">
          <b>${esc(shop.label)}</b>
          <small>${esc(shop.shopDomain.replace('.myshopify.com', ''))} · ${
            ROLE_LABELS[shop.role] ?? shop.role
          }</small>
        </span>
      </button>`,
  ));

  if (canAdd) {
    rows.push('<hr />');
    rows.push(
      '<button class="shop-item shop-add" type="button" data-shop-add="1">＋ Ajouter une boutique</button>',
    );
  }

  $('shop-menu').innerHTML = rows.join('');

  // Une seule boutique et aucun droit d'en ajouter : le menu n'aurait qu'une
  // ligne, qui ne fait rien. On masque le chevron.
  $('shop-switch').querySelector('.brand-caret').hidden = state.shops.length < 2 && !canAdd;
}

function toggleShopMenu(open) {
  const menu = $('shop-menu');
  const next = open ?? menu.hidden;
  menu.hidden = !next;
  $('shop-switch').setAttribute('aria-expanded', String(next));
}

async function switchShop(merchantId) {
  try {
    await api('/api/shops/switch', { method: 'POST', body: JSON.stringify({ merchantId }) });
    // Rechargement complet plutôt qu'un rafraîchissement d'écran : tout ce qui
    // est en mémoire (tickets, catalogue, stats) appartient à l'ancienne
    // boutique, et en garder une miette afficherait des données croisées.
    location.reload();
  } catch (error) {
    toast(error.message ?? 'Changement de boutique impossible', true);
  }
}

async function addShop() {
  const input = prompt(
    'Domaine Shopify de la boutique à ajouter\n(ex. ma-boutique.myshopify.com)',
  );
  if (!input) return;

  try {
    const { installUrl } = await api('/api/shops/connect', {
      method: 'POST',
      body: JSON.stringify({ shopDomain: input }),
    });
    location.href = installUrl;
  } catch (error) {
    toast(error.message ?? 'Ajout impossible', true);
  }
}

/* ------------------------------------------------------------ indicateurs */

async function loadMetrics() {
  const metrics = await api('/api/metrics');
  const counts = metrics.tickets ?? {};

  $('kpi-done').textContent = String((counts.CLOSED ?? 0) + (counts.AUTO_SENT ?? 0));
  $('kpi-pending').textContent = String(metrics.pending ?? 0);
  state.pendingCount = metrics.pending ?? 0;
  renderNav();
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

/** Ancienneté en jours depuis la dernière prise de parole. */
function ageInDays(iso) {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
}

function ageChip(iso) {
  const days = ageInDays(iso);
  // Trois paliers seulement : au-delà, la couleur ne se lit plus comme une
  // échelle mais comme une décoration.
  const level = days >= 7 ? 'late' : days >= 3 ? 'warm' : 'fresh';
  const label = days === 0 ? "aujourd'hui" : days === 1 ? '1 jour' : `${days} jours`;
  return `<span class="age age-${level}">${label}</span>`;
}

function initials(value) {
  return String(value ?? '')
    .split(/[\s.@_-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0] ?? '')
    .join('')
    .toUpperCase();
}

/** Paramètres d'appel dérivés de l'état des filtres. */
function queueParams() {
  const params = new URLSearchParams();
  const f = state.queue;

  if (state.filter) params.set('status', state.filter);
  if (f.q.trim()) params.set('q', f.q.trim());
  if (f.intent) params.set('intent', f.intent);
  if (f.assignee) params.set('assignee', f.assignee);
  if (f.mailbox) params.set('mailbox', f.mailbox);
  if (state.allShops) params.set('scope', 'all');
  if (f.sort !== 'newest') params.set('sort', f.sort);
  if (f.urgent) params.set('minAgeDays', '3');
  if (f.unassigned) params.set('assignee', 'none');
  if (f.unlinked) params.set('unlinked', 'true');

  return params;
}

function queueIsFiltered() {
  const f = state.queue;
  return Boolean(
    state.filter || f.q.trim() || f.intent || f.assignee || f.mailbox || f.urgent ||
      f.unassigned || f.unlinked,
  );
}

async function loadQueue() {
  const list = $('queue');
  const data = await api(`/api/tickets?${queueParams()}`);

  state.tickets = data.tickets;
  state.queueCounts = data.counts ?? {};
  renderQueueBar();

  if (state.tickets.length === 0) {
    // Un écran vide doit dire pourquoi il est vide : « aucun ticket » et
    // « aucun ticket qui corresponde aux filtres » appellent des gestes
    // opposés.
    list.innerHTML = queueIsFiltered()
      ? `<li class="empty" style="padding:16px 14px">
           Aucun ticket ne correspond à ces filtres.
           <button class="qlink" data-reset="1">Tout afficher</button>
         </li>`
      : `<li class="empty" style="padding:16px 14px">
           Rien en attente.
           ${
             state.me?.gmail?.connected
               ? `Les messages reçus sur <code>${esc(
                   state.me.gmail.emailAddress,
                 )}</code> arrivent ici automatiquement${
                   state.me.gmail.watchActive
                     ? '.'
                     : ' — mais <b class="set-alert">l’écoute est expirée</b>, reconnectez la boîte dans les Réglages.'
                 }`
               : 'Aucune boîte mail connectée : rien ne peut entrer. Connectez Gmail dans les Réglages.'
           }
         </li>`;

    list.querySelector('[data-reset]')?.addEventListener('click', resetQueueFilters);
    return;
  }

  // Le badge de boîte n'a de sens qu'à partir de deux adresses : sinon il
  // répète la même information sur chaque ligne.
  const multiMailbox = (state.me?.gmail?.mailboxes?.length ?? 0) > 1;
  const shopById = new Map(state.shops.map((shop) => [shop.id, shop]));

  list.innerHTML = state.tickets
    .map((ticket) => {
      const label = STATUS_LABELS[ticket.status] ?? ticket.status;
      const who = ticket.assignedTo;

      return `<li>
        <button class="queue-item li-${ticket.intent ?? 'OTHER'}" data-id="${ticket.id}"
          aria-current="${ticket.id === state.currentId}">
          <span class="queue-top">
            ${
              state.allShops && shopById.has(ticket.merchantId)
                ? `<span class="shop-pip" style="background:${esc(
                    shopById.get(ticket.merchantId).color,
                  )}" title="${esc(shopById.get(ticket.merchantId).label)}"></span>`
                : ''
            }
            <span class="queue-who">${esc(ticket.customerName ?? ticket.customerEmail)}</span>
            ${ageChip(ticket.lastMessageAt)}
          </span>
          <div class="queue-subject">${esc(ticket.subject ?? '(sans objet)')}</div>
          <span class="queue-tags">
            ${
              ticket.intent
                ? `<span class="tag in-${ticket.intent}">${
                    INTENT_LABELS[ticket.intent] ?? ticket.intent
                  }</span>`
                : ''
            }
            <span class="tag tag-status st-${ticket.status}">${label}</span>
            <span class="tag tag-order">${
              ticket.orderName ? esc(ticket.orderName) : 'commande ?'
            }</span>
            ${
              multiMailbox && ticket.mailbox
                ? `<span class="tag tag-box">${esc(
                    ticket.mailbox.label || ticket.mailbox.emailAddress.split('@')[0],
                  )}</span>`
                : ''
            }
            <span class="who-dot${who ? '' : ' none'}" title="${
              who ? esc(who.name ?? who.email) : 'non assigné'
            }" style="margin-left:auto">${who ? initials(who.name ?? who.email) : '—'}</span>
          </span>
        </button>
      </li>`;
    })
    .join('');

  list.querySelectorAll('.queue-item').forEach((button) => {
    button.addEventListener('click', () => selectTicket(button.dataset.id));
  });
}

/* ------------------------------------------------- lien de travail atelier */

/**
 * Émet — ou révoque — le lien permanent d'un fournisseur.
 *
 * Le lien vaut accès : on l'affiche une fois, à copier, et on rappelle que le
 * révoquer coupe tous ceux déjà transmis. Rien n'est stocké en clair côté
 * marchand, le jeton se recalcule à la demande.
 */
async function openSupplierLink(supplierId, revoke = false) {
  if (revoke && !confirm(
    'Révoquer le lien coupe l’accès de ce fournisseur immédiatement, y compris '
      + 'celui qu’il a déjà enregistré. Un nouveau lien sera généré. Continuer ?',
  )) {
    return;
  }

  try {
    const { url } = await api(`/api/suppliers/${supplierId}/portal-link`, {
      method: 'POST',
      body: JSON.stringify({ revoke }),
    });

    await navigator.clipboard?.writeText(url).catch(() => {});
    toast(revoke ? 'Ancien lien révoqué, nouveau lien copié.' : 'Lien copié dans le presse-papier.');

    // Affiché en clair malgré la copie : un presse-papier peut échouer en
    // silence, et le marchand doit pouvoir le sélectionner à la main.
    prompt('Lien de travail du fournisseur — à lui transmettre :', url);
  } catch (error) {
    toast(error.message, true);
  }
}

/* ----------------------------------------------- vue d'ensemble du groupe */

/**
 * Une carte par boutique : ce qui attend, ce qui traîne, ce qui coûte.
 *
 * Le taux de litiges y figure parce qu'il annonce une sanction et pas une
 * charge de travail — au-delà de 1 % de commandes contestées, Shopify gèle les
 * paiements d'une boutique. Un exploitant doit le voir avant de le subir.
 */
async function renderShopCards() {
  let data;
  try {
    data = await api('/api/overview');
  } catch {
    $('ov-shops').innerHTML = '';
    return;
  }

  const shops = data.shops ?? [];
  const threshold = data.disputeThreshold ?? 1;

  // Une seule boutique : la carte répéterait les indicateurs juste en dessous.
  if (shops.length < 2) {
    $('ov-shops').innerHTML = '';
    return;
  }

  $('ov-shops').innerHTML = shops
    .map((shop) => {
      const over = shop.disputeRate > threshold;
      // Échelle à deux fois le seuil : sinon un taux de 0,3 % donne une barre
      // invisible et un taux de 1,2 % une barre pleine, tous deux illisibles.
      const width = Math.min(100, (shop.disputeRate / (threshold * 2)) * 100);

      return `<article class="shopcard">
        <div class="shopcard-head">
          <i style="background:${esc(shop.color)}"></i>
          ${esc(shop.label)}
        </div>

        <div class="shopcard-open">
          <b>${shop.open}</b><span>à traiter</span>
        </div>

        <div class="shopcard-tags">
          ${
            shop.late
              ? `<span class="tag st-FAILED">${shop.late} en retard</span>`
              : '<span class="tag st-CLOSED">rien en retard</span>'
          }
          ${shop.disputes ? `<span class="tag st-NEEDS_REVIEW">${shop.disputes} litige${
            shop.disputes > 1 ? 's' : ''
          }</span>` : ''}
        </div>

        <div class="shopcard-rate">
          <span>Litiges 30 j</span>
          <span class="dispute-bar" style="flex:1">
            <span class="dispute-fill${over ? ' over' : ''}" style="width:${width}%"></span>
            <span class="dispute-mark" style="left:50%"></span>
          </span>
          <b>${String(shop.disputeRate).replace('.', ',')} %</b>
        </div>

        ${
          over
            ? '<div class="shopcard-alert">Seuil Shopify dépassé — risque de gel des paiements</div>'
            : ''
        }

        <button class="btn btn-small" data-open-shop="${esc(shop.id)}">${
          shop.current ? 'Ouvrir la file' : 'Basculer et ouvrir'
        }</button>
      </article>`;
    })
    .join('');

  $('ov-shops')
    .querySelectorAll('[data-open-shop]')
    .forEach((button) =>
      button.addEventListener('click', async () => {
        const id = button.dataset.openShop;
        const shop = shops.find((candidate) => candidate.id === id);

        // Basculer recharge la page : rien de la boutique précédente ne doit
        // survivre en mémoire.
        if (!shop?.current) return switchShop(id);

        setView('tickets');
        await loadQueue();
      }),
    );
}

/* ----------------------------------------------------------- fiche client */

/**
 * Tout ce que la boutique sait d'un client, en un panneau.
 *
 * L'email est la clé : c'est le seul identifiant partagé entre Shopify et nos
 * tickets. Le panneau s'ouvre par-dessus l'écran courant plutôt que de le
 * remplacer — l'agent consulte sans perdre le ticket qu'il traite.
 */
async function openCustomerSheet(email, displayName) {
  if (!email) return;

  $('sheet-name').textContent = displayName || email;
  $('sheet-email').textContent = email;
  $('sheet-body').innerHTML = '<p class="empty">Chargement…</p>';
  $('sheet-wrap').hidden = false;

  let data;
  try {
    data = await api(`/api/customer-sheet?email=${encodeURIComponent(email)}`);
  } catch (error) {
    $('sheet-body').innerHTML = `<p class="empty">${esc(error.message)}</p>`;
    return;
  }

  const { totals, customer, orders, tickets, refunds, parcels, shopifyError } = data;
  if (customer?.displayName) $('sheet-name').textContent = customer.displayName;

  const money = (value) => euro(value, totals.currency ?? 'EUR');

  const sections = [];

  sections.push(`<div class="sheet-stats">
    <div class="sheet-stat"><b>${totals.orders}</b><span>Commandes</span></div>
    <div class="sheet-stat"><b>${esc(money(totals.spent))}</b><span>Dépensé</span></div>
    <div class="sheet-stat"><b>${totals.openTickets}/${totals.tickets}</b><span>Tickets ouverts</span></div>
    <div class="sheet-stat"><b>${esc(money(totals.refunded))}</b><span>Remboursé</span></div>
  </div>`);

  if (shopifyError) {
    sections.push(`<div class="notice"><span class="notice-mark">Shopify</span><div>${esc(
      shopifyError,
    )}</div></div>`);
  }

  sections.push(group(
    'Commandes',
    orders.map(
      (order) => `<div class="sheet-row">
        <b class="mono">${esc(order.name)}</b>
        <span class="tag tag-order">${esc(order.displayFulfillmentStatus ?? '—')}</span>
        <span class="tag tag-order">${esc(order.displayFinancialStatus ?? '—')}</span>
        <span class="mono">${esc(euro(order.totalPrice, order.currency))}</span>
        <span class="when">${relativeTime(order.createdAt)}</span>
        <p>${esc(
          (order.lineItems ?? [])
            .map((item) => `${item.quantity} × ${item.title}`)
            .join(' · ') || 'aucun article',
        )}</p>
      </div>`,
    ),
    'Aucune commande à cette adresse.',
  ));

  sections.push(group(
    'Colis',
    parcels.map(
      (parcel) => `<div class="sheet-row">
        <b>${parcel.index}/${parcel.total}</b>
        <span class="mono">${esc(parcel.trackingNumber)}</span>
        ${parcel.carrier ? `<span class="tag tag-order">${esc(parcel.carrier)}</span>` : ''}
        ${
          parcel.hasPhoto
            ? `<a class="btn btn-small" href="/api/parcels/${esc(
                parcel.id,
              )}/photo" target="_blank" rel="noopener">Photo</a>`
            : '<span class="when">sans photo</span>'
        }
        <span class="when">${esc(parcel.orderName ?? '')}</span>
      </div>`,
    ),
    'Aucun colis saisi pour ce client.',
  ));

  sections.push(group(
    'Tickets',
    tickets.map(
      (ticket) => `<div class="sheet-row clickable" data-ticket="${esc(ticket.id)}">
        <b>${esc(ticket.subject ?? '(sans objet)')}</b>
        <span class="tag st-${ticket.status}">${esc(
          STATUS_LABELS[ticket.status] ?? ticket.status,
        )}</span>
        ${
          ticket.intent
            ? `<span class="tag in-${ticket.intent}">${esc(
                INTENT_LABELS[ticket.intent] ?? ticket.intent,
              )}</span>`
            : ''
        }
        <span class="when">${relativeTime(ticket.lastMessageAt)}</span>
      </div>`,
    ),
    'Aucun échange avec ce client.',
  ));

  sections.push(group(
    'Remboursements',
    refunds.map(
      (refund) => `<div class="sheet-row">
        <b class="mono">${esc(euro(refund.amount, refund.currency))}</b>
        <span class="tag st-${refund.status === 'COMPLETED' ? 'CLOSED' : 'NEEDS_REVIEW'}">${esc(
          refund.status,
        )}</span>
        <span class="when">${relativeTime(refund.createdAt)}</span>
        <p>${esc(refund.reason)}</p>
      </div>`,
    ),
    'Aucun remboursement.',
  ));

  $('sheet-body').innerHTML = sections.join('');

  // Un ticket de la fiche ramène à la file, sur ce ticket : c'est le geste
  // attendu quand on découvre un échange passé qui explique la demande.
  $('sheet-body')
    .querySelectorAll('[data-ticket]')
    .forEach((row) =>
      row.addEventListener('click', async () => {
        closeCustomerSheet();
        setView('tickets');
        await selectTicket(row.dataset.ticket);
      }),
    );
}

function group(title, rows, empty) {
  return `<section class="sheet-group">
    <h3>${esc(title)}</h3>
    ${rows.length ? rows.join('') : `<div class="sheet-row"><p>${esc(empty)}</p></div>`}
  </section>`;
}

function closeCustomerSheet() {
  $('sheet-wrap').hidden = true;
}

$('sheet-close').addEventListener('click', closeCustomerSheet);

$('sheet-wrap').addEventListener('click', (event) => {
  if (event.target === $('sheet-wrap')) closeCustomerSheet();
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !$('sheet-wrap').hidden) closeCustomerSheet();
});

/* ------------------------------------------------------------------ colis */

/**
 * Colis saisis par le fournisseur, avec la photo de chaque étiquette.
 *
 * Une commande de trois articles part souvent en trois colis : afficher le
 * rang (« 2/3 ») dit d'un coup d'œil lequel manque quand un client signale un
 * envoi incomplet — c'est la question que Shopify seul ne répond pas.
 */
async function renderParcels(ticket) {
  const panel = $('parcels-panel');

  if (!ticket?.shopifyOrderId) {
    panel.hidden = true;
    return;
  }

  let parcels = [];
  try {
    const data = await api(`/api/parcels?orderId=${encodeURIComponent(ticket.shopifyOrderId)}`);
    parcels = data.parcels ?? [];
  } catch {
    panel.hidden = true;
    return;
  }

  if (parcels.length === 0) {
    panel.hidden = true;
    return;
  }

  panel.hidden = false;

  $('c-parcels').innerHTML = parcels
    .map(
      (parcel) => `<div class="pcl">
        <div class="pcl-head">
          <b>Colis ${parcel.index}/${parcel.total}</b>
          ${
            parcel.hasPhoto
              ? ''
              : '<span class="pcl-nophoto">sans photo</span>'
          }
        </div>
        <code>${esc(parcel.trackingNumber)}</code>
        ${parcel.carrier ? `<small>${esc(parcel.carrier)}</small>` : ''}
        ${
          parcel.hasPhoto
            ? `<a href="/api/parcels/${esc(parcel.id)}/photo" target="_blank" rel="noopener">
                 <img src="/api/parcels/${esc(parcel.id)}/photo" loading="lazy"
                   alt="Étiquette du colis ${parcel.index}" />
               </a>`
            : ''
        }
      </div>`,
    )
    .join('');
}

/* -------------------------------------------------- actions contextuelles */

/*
 * Ce que l'agent peut faire dépend de ce que le client demande.
 *
 * Une barre d'actions unique et générique oblige à relire le ticket pour
 * choisir ; ici l'action la plus probable est déjà en tête, et les autres
 * restent accessibles. L'ordre compte plus que la liste.
 */
const ACTIONS_BY_INTENT = {
  WISMO: ['tracking', 'client', 'supplier'],
  RETURN: ['client', 'supplier', 'refund'],
  DISPUTE: ['refund', 'client', 'supplier'],
  REFUND: ['refund', 'client'],
  PRODUCT_QUESTION: ['substitute', 'client', 'supplier'],
  POSITIVE: ['client'],
  OTHER: ['client', 'supplier', 'refund'],
};

const ACTION_META = {
  substitute: { label: 'Proposer un remplacement', note: 'Le client garde sa commande, on remplace la référence indisponible.' },
  refund: { label: 'Rembourser…', note: 'Irréversible : l’argent repart chez le client immédiatement.' },
  client: { label: 'Écrire au client', note: 'Message direct, hors brouillon proposé.' },
  supplier: { label: 'Écrire au fournisseur', note: 'Ouvre une escalade suivie, avec relance automatique.' },
  tracking: { label: 'Voir le suivi', note: 'Position du colis d’après le transporteur.' },
};

function renderActionBar() {
  const { ticket } = state.detail;
  const keys = ACTIONS_BY_INTENT[ticket.intent] ?? ACTIONS_BY_INTENT.OTHER;

  $('actbar').hidden = false;
  $('subs').hidden = true;

  $('actbar-row').innerHTML = keys
    .map((key, index) => {
      // Une action impossible reste visible mais désactivée, avec sa raison en
      // infobulle : la faire disparaître laisserait croire qu'elle n'existe pas.
      const blocked = actionBlockedReason(key, ticket);
      return `<button class="actbtn${index === 0 && !blocked ? ' on' : ''}" data-act="${key}"${
        blocked ? ` disabled title="${esc(blocked)}"` : ''
      }>${esc(ACTION_META[key].label)}</button>`;
    })
    .join('');

  const first = keys.find((key) => !actionBlockedReason(key, ticket));
  $('actbar-note').textContent = first ? ACTION_META[first].note : '';
}

function actionBlockedReason(key, ticket) {
  if (key === 'refund') {
    if (!canI('refund')) return 'Seuls le propriétaire et les superviseurs peuvent rembourser.';
    if (!ticket.shopifyOrderId) return 'Aucune commande rattachée à ce ticket.';
  }
  if ((key === 'substitute' || key === 'tracking') && !ticket.shopifyOrderId) {
    return 'Aucune commande rattachée à ce ticket.';
  }
  if (key === 'supplier' && !canI('escalate')) return 'Votre rôle ne permet pas d’escalader.';
  if (key === 'client' && !canI('reply')) return 'Vous êtes en lecture seule.';
  return null;
}

$('actbar-row').addEventListener('click', async (event) => {
  const button = event.target.closest('.actbtn');
  if (!button || button.disabled) return;

  const key = button.dataset.act;
  const { ticket } = state.detail;

  $('actbar-row')
    .querySelectorAll('.actbtn')
    .forEach((other) => other.classList.toggle('on', other === button));
  $('actbar-note').textContent = ACTION_META[key].note;
  $('subs').hidden = true;

  if (key === 'refund') return $('btn-refund').click();
  if (key === 'client') return openMail(ticket.customerEmail, `Re: ${ticket.subject ?? ''}`);
  if (key === 'supplier') return setView('suppliers');
  if (key === 'tracking') return setView('tracking');
  if (key === 'substitute') return loadSubstitutions(ticket.id);
});

async function loadSubstitutions(ticketId) {
  const box = $('subs');
  box.hidden = false;
  box.innerHTML = '<p class="empty">Recherche des références en stock…</p>';

  let data;
  try {
    data = await api(`/api/tickets/${ticketId}/substitutions`);
  } catch (error) {
    box.innerHTML = `<p class="empty">${esc(error.message)}</p>`;
    return;
  }

  if (!data.options?.length) {
    box.innerHTML = `<p class="empty">${esc(
      data.reason ?? 'Aucune référence équivalente en stock pour le moment.',
    )}</p>`;
    return;
  }

  box.innerHTML = data.options
    .slice(0, 6)
    .map(
      (option) => `
      <button class="sub" data-sub="${esc(option.id)}"
        data-label="${esc(
          `${option.productTitle}${option.variantTitle ? ` — ${option.variantTitle}` : ''}`,
        )}">
        ${
          option.image
            ? `<img src="${esc(option.image)}" alt="" loading="lazy" />`
            : '<span class="sub-blank"></span>'
        }
        <span style="min-width:0">
          <b>${esc(option.productTitle)}</b>
          <small>${esc(option.variantTitle ?? '—')}</small>
          <small class="sub-stock">${
            option.inventoryQuantity ?? 0
          } en stock</small>
        </span>
      </button>`,
    )
    .join('');

  box.querySelectorAll('.sub').forEach((button) => {
    button.addEventListener('click', () => {
      // On insère une phrase dans le brouillon plutôt que d'envoyer : le
      // remplacement d'un article se propose, il ne s'impose pas.
      const body = $('d-body');
      const sentence = `Nous pouvons vous proposer en remplacement : ${button.dataset.label}, disponible immédiatement. Confirmez-vous ce choix ?`;

      body.value = body.value.trim() ? `${body.value.trim()}\n\n${sentence}` : sentence;
      body.focus();
      toast('Proposition ajoutée au brouillon — à relire avant envoi.');
    });
  });
}

/* ------------------------------------------------- barre de filtres file */

const INTENT_LABELS = {
  WISMO: 'Où est ma commande',
  RETURN: 'Retour',
  DISPUTE: 'Litige',
  REFUND: 'Remboursement',
  PRODUCT_QUESTION: 'Question produit',
  POSITIVE: 'Message positif',
  OTHER: 'Autre',
};

function renderQueueBar() {
  const counts = state.queueCounts ?? {};

  $('filters')
    .querySelectorAll('.chip')
    .forEach((chip) => {
      const status = chip.dataset.filter;
      const count = status ? (counts[status] ?? 0) : (counts.ALL ?? 0);
      chip.setAttribute('aria-pressed', String(status === state.filter));

      const base = chip.dataset.label ?? chip.textContent.trim();
      chip.dataset.label = base;
      chip.innerHTML = `${esc(base)}<span class="count">${count}</span>`;
    });

  for (const [key, id] of [
    ['urgent', 'urgent'],
    ['unassigned', 'unassigned'],
    ['unlinked', 'unlinked'],
  ]) {
    $('queue-bar')
      .querySelector(`[data-quick="${id}"]`)
      .setAttribute('aria-pressed', String(Boolean(state.queue[key])));
  }

  $('q-reset').hidden = !queueIsFiltered();
  $('q-count').textContent = `${state.tickets.length} affiché${
    state.tickets.length > 1 ? 's' : ''
  }`;
}

/** Liste des agents pour le filtre et l'assignation. */
async function loadAgents() {
  try {
    const data = await api('/api/team');
    state.agents = (data.users ?? []).filter((user) => user.active);
  } catch {
    // Un agent sans droit sur l'équipe ne doit pas perdre sa file pour autant.
    state.agents = [];
  }

  const options = state.agents
    .map((user) => `<option value="${esc(user.id)}">${esc(user.name ?? user.email)}</option>`)
    .join('');

  $('q-assignee').innerHTML =
    `<option value="">Tous</option><option value="none">Non assignés</option>${options}`;

  const mailboxes = state.me?.gmail?.mailboxes ?? [];
  $('q-mailbox').innerHTML =
    '<option value="">Toutes</option>' +
    mailboxes
      .map(
        (mailbox) =>
          `<option value="${esc(mailbox.id)}">${esc(mailbox.label || mailbox.emailAddress)}</option>`,
      )
      .join('');

  // Une seule boîte : le filtre n'aurait qu'une option utile.
  $('q-mailbox').closest('label').hidden = mailboxes.length < 2;

  $('q-intent').innerHTML =
    '<option value="">Tous</option>' +
    Object.entries(INTENT_LABELS)
      .map(([key, label]) => `<option value="${key}">${esc(label)}</option>`)
      .join('');
}

function resetQueueFilters() {
  state.filter = '';
  state.queue = {
    q: '', intent: '', assignee: '', mailbox: '', sort: 'newest',
    urgent: false, unassigned: false, unlinked: false,
  };

  $('q-search').value = '';
  $('q-mailbox').value = '';
  $('q-sort').value = 'newest';
  $('q-assignee').value = '';
  $('q-intent').value = '';

  void loadQueue();
}

$('q-search').addEventListener('input', (event) => {
  state.queue.q = event.target.value;
  // Un appel par frappe saturerait l'API sur une file de plusieurs milliers de
  // tickets ; 250 ms est le délai en dessous duquel la frappe paraît continue.
  clearTimeout(state.queue.timer);
  state.queue.timer = setTimeout(() => void loadQueue(), 250);
});

$('q-sort').addEventListener('change', (event) => {
  state.queue.sort = event.target.value;
  void loadQueue();
});

$('q-assignee').addEventListener('change', (event) => {
  state.queue.assignee = event.target.value;
  state.queue.unassigned = event.target.value === 'none';
  void loadQueue();
});

$('q-mailbox').addEventListener('change', (event) => {
  state.queue.mailbox = event.target.value;
  void loadQueue();
});

$('q-intent').addEventListener('change', (event) => {
  state.queue.intent = event.target.value;
  void loadQueue();
});

$('q-reset').addEventListener('click', resetQueueFilters);

$('queue-bar').addEventListener('click', (event) => {
  const quick = event.target.closest('[data-quick]');
  if (!quick) return;

  const key = quick.dataset.quick;
  state.queue[key] = !state.queue[key];

  // Le raccourci et le sélecteur « Assigné » désignent la même chose : les
  // laisser diverger afficherait deux vérités contradictoires à l'écran.
  if (key === 'unassigned') {
    state.queue.assignee = state.queue.unassigned ? 'none' : '';
    $('q-assignee').value = state.queue.assignee;
  }

  void loadQueue();
});

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

  const canAssign = canI('reply');
  const assignOptions = state.agents
    .map(
      (user) =>
        `<option value="${esc(user.id)}"${
          user.id === ticket.assignedToId ? ' selected' : ''
        }>${esc(user.name ?? user.email)}</option>`,
    )
    .join('');

  $('d-meta').innerHTML =
    `<button class="linkish" id="d-who">${esc(
      ticket.customerName ?? ticket.customerEmail,
    )}</button> · <code>${esc(ticket.customerEmail)}</code>` +
    (ticket.intent
      ? ` · intention <b>${INTENT_LABELS[ticket.intent] ?? ticket.intent}</b>${
          ticket.intentConfidence != null
            ? ` (${ticket.intentConfidence.toFixed(2).replace('.', ',')})`
            : ''
        }`
      : '') +
    ` · ouvert depuis <b>${ageInDays(ticket.createdAt)} j</b>` +
    `<span class="d-assign">Assigné à
       <select id="d-assignee"${canAssign ? '' : ' disabled'}>
         <option value="">Personne</option>${assignOptions}
       </select>
     </span>`;

  $('d-who')?.addEventListener('click', () =>
    void openCustomerSheet(ticket.customerEmail, ticket.customerName ?? ''),
  );

  $('d-assignee')?.addEventListener('change', async (event) => {
    const userId = event.target.value || null;

    try {
      await api(`/api/tickets/${ticket.id}/assign`, {
        method: 'PATCH',
        body: JSON.stringify({ userId }),
      });

      ticket.assignedToId = userId;
      toast(userId ? 'Ticket assigné.' : 'Ticket remis au pot commun.');
      await loadQueue();
    } catch (error) {
      // On remet la valeur d'avant : laisser le sélecteur sur un choix qui n'a
      // pas pris ferait croire que l'assignation a eu lieu.
      event.target.value = ticket.assignedToId ?? '';
      toast(error.message, true);
    }
  });

  renderActionBar();

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

  // Sans commande rattachée, l'email du ticket suffit à ouvrir la fiche : elle
  // contient justement de quoi retrouver la commande manquante.
  const ticketEmail = state.detail?.ticket?.customerEmail ?? null;

  if (!customer) {
    $('c-customer').innerHTML = ticketEmail
      ? `<p class="empty">Aucune commande rattachée.</p>
         <button class="btn btn-small" id="c-sheet">Ouvrir la fiche client</button>`
      : '<p class="empty">Fiche client indisponible sans commande rattachée.</p>';

    $('c-sheet')?.addEventListener('click', () => void openCustomerSheet(ticketEmail));
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
    '</dl>' +
    '<button class="btn btn-small" id="c-sheet" style="margin-top:8px">Fiche complète</button>';

  $('c-sheet')?.addEventListener('click', () =>
    void openCustomerSheet(customer.email ?? ticketEmail, customer.displayName ?? ''),
  );
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

  void renderParcels(state.detail?.ticket);

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
  $('sup-f-email').value = supplier?.contactEmail ?? '';
  $('sup-f-contact').value = supplier?.contactName ?? '';
  $('sup-f-phone').value = supplier?.phone ?? '';
  $('sup-f-notes').value = supplier?.notes ?? '';
  $('sup-f-active').checked = supplier ? supplier.active : true;

  // La suppression n'a de sens que sur un contact sans historique ; le serveur
  // tranche, on se contente de ne pas la proposer à la création.
  $('sup-f-delete').hidden = !supplier;

  // Le lien n'existe que pour un fournisseur déjà enregistré : il porte son
  // identifiant.
  $('sup-f-link').hidden = !supplier;
  $('sup-f-link').dataset.supplier = supplier?.id ?? '';

  $('supplier-modal').classList.add('open');
}

$('sup-f-link').addEventListener('click', async (event) => {
  const id = event.currentTarget.dataset.supplier;
  if (!id) return;

  // Maj + clic révoque : geste volontairement peu accessible, l'opération est
  // irréversible pour les liens déjà transmis.
  await openSupplierLink(id, event.shiftKey);
});

$('sup-new').addEventListener('click', () => openSupplierForm(null));
$('sup-f-cancel').addEventListener('click', () => $('supplier-modal').classList.remove('open'));
$('supplier-modal').addEventListener('click', (event) => {
  if (event.target === $('supplier-modal')) $('supplier-modal').classList.remove('open');
});

$('sup-f-save').addEventListener('click', async () => {
  const payload = {
    name: $('sup-f-name').value.trim(),
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

/* ---------------------------------------------------------- vue d'ensemble */

/* Résumé de ce qui appelle une action maintenant. Réutilise les données déjà
   chargées au démarrage plutôt que de rappeler l'API : cet écran doit
   s'afficher instantanément, c'est le premier ouvert de la journée. */
async function loadOverview() {
  void renderShopCards();

  const metrics = await api('/api/metrics');
  const counts = metrics.tickets ?? {};

  const cards = [
    ['En attente de vous', metrics.pending ?? 0, `${counts.NEEDS_REVIEW ?? 0} à valider`],
    ['Brouillons prêts', counts.DRAFT_READY ?? 0, 'relecture puis envoi'],
    ['Chez le fournisseur', counts.AWAITING_SUPPLIER ?? 0, 'en attente de réponse'],
    ['Traités · 30 jours', (counts.CLOSED ?? 0) + (counts.AUTO_SENT ?? 0), 'réponses envoyées'],
  ];

  $('ov-kpis').innerHTML = cards
    .map(
      ([label, value, note]) => `<div class="kpi">
        <span class="kpi-label">${esc(label)}</span>
        <span class="kpi-value">${value}</span>
        <span class="kpi-note">${esc(note)}</span>
      </div>`,
    )
    .join('');

  const urgent = state.tickets
    .filter((ticket) => ticket.status !== 'CLOSED' && ticket.status !== 'AUTO_SENT')
    .slice(0, 8);

  $('ov-queue').innerHTML =
    urgent
      .map(
        (ticket) => `<li><button class="queue-item" data-id="${esc(ticket.id)}">
          <span class="queue-top">
            ${
              state.allShops && shopById.has(ticket.merchantId)
                ? `<span class="shop-pip" style="background:${esc(
                    shopById.get(ticket.merchantId).color,
                  )}" title="${esc(shopById.get(ticket.merchantId).label)}"></span>`
                : ''
            }
            <span class="queue-who">${esc(ticket.customerName ?? ticket.customerEmail)}</span>
            <span class="queue-time">${relativeTime(ticket.lastMessageAt)}</span>
          </span>
          <div class="queue-subject">${esc(ticket.subject ?? '(sans objet)')}</div>
          <span class="queue-tags">
            <span class="tag tag-status st-${ticket.status}">${esc(
              STATUS_LABELS[ticket.status] ?? ticket.status,
            )}</span>
            <span class="tag tag-order">${esc(ticket.orderName ?? 'commande ?')}</span>
          </span>
        </button></li>`,
      )
      .join('') || '<li class="empty" style="padding:16px 14px">Rien en attente.</li>';

  $('ov-queue')
    .querySelectorAll('.queue-item')
    .forEach((button) =>
      button.addEventListener('click', async () => {
        setView('tickets');
        await selectTicket(button.dataset.id);
      }),
    );

  $('ov-audit').innerHTML = $('c-audit').innerHTML;
}

/* --------------------------------------------------------- statistiques -- */

function duration(minutes) {
  if (minutes === null || minutes === undefined) return '—';
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const hours = minutes / 60;
  if (hours < 48) return `${hours.toFixed(1)} h`;
  return `${Math.round(hours / 24)} j`;
}

async function loadStats() {
  const stats = await api('/api/stats?days=30');

  $('stats-kpis').innerHTML = [
    ['Tickets reçus', stats.tickets.total, '30 derniers jours'],
    ['Première réponse', duration(stats.firstReply.medianMinutes), `médiane sur ${stats.firstReply.measured}`],
    ['Brouillons envoyés', `${Math.round(stats.drafts.sendRate * 100)} %`, `${stats.drafts.sent} sur ${stats.drafts.total}`],
    [
      'Confiance moyenne',
      stats.drafts.averageConfidence === null
        ? '—'
        : `${Math.round(stats.drafts.averageConfidence * 100)} %`,
      'sur les brouillons rédigés',
    ],
  ]
    .map(
      ([label, value, note]) => `<div class="kpi">
        <span class="kpi-label">${esc(label)}</span>
        <span class="kpi-value">${esc(String(value))}</span>
        <span class="kpi-note">${esc(note)}</span>
      </div>`,
    )
    .join('');

  /* Histogramme en CSS pur : une bibliothèque de graphiques pour douze barres
     ajouterait un build et une dépendance à surveiller. */
  const peak = Math.max(1, ...stats.tickets.daily.map((day) => day.received));

  $('stats-daily').innerHTML = `<div class="spark">${stats.tickets.daily
    .map(
      (day) => `<span class="spark-col" title="${esc(day.day)} — ${day.received} reçus, ${
        day.handled
      } traités">
        <i style="height:${Math.round((day.received / peak) * 100)}%"></i>
        <u style="height:${Math.round((day.handled / peak) * 100)}%"></u>
      </span>`,
    )
    .join('')}</div>
    <p class="set-help" style="margin-top:10px">
      Barre pleine : tickets reçus. Barre foncée : tickets traités. Quand la
      seconde reste durablement sous la première, la file grossit.
    </p>`;

  $('stats-team').innerHTML =
    stats.team
      .map(
        (member) => `<tr class="${member.active ? '' : 'muted'}">
          <td><b>${esc(member.name)}</b></td>
          <td>${esc(ROLE_LABELS[member.role] ?? member.role)}</td>
          <td class="num mono">${member.replies}</td>
          <td class="num mono">${member.refunds}</td>
          <td class="num mono">${member.escalations}</td>
        </tr>`,
      )
      .join('') || '<tr><td colspan="5" class="empty">Aucune activité sur la période.</td></tr>';
}

/* -------------------------------------------------------------- catalogue */

const CATALOG_HEADS = {
  products:
    '<tr><th></th><th>Produit</th><th>Statut</th><th>Fournisseur</th><th class="num">Stock</th><th class="num">Variantes</th><th class="num">Prix</th></tr>',
  collections: '<tr><th></th><th>Collection</th><th class="num">Produits</th><th>Modifiée</th></tr>',
};

async function loadCatalog({ reset = false } = {}) {
  const store = state.catalog;
  if (store.loading) return;

  store.loading = true;
  $('catalog-head').innerHTML = CATALOG_HEADS[store.kind];

  if (reset) {
    store.items = [];
    store.cursor = null;
    $('catalog-rows').innerHTML = '<tr><td colspan="7" class="empty">Chargement…</td></tr>';
  }

  const params = new URLSearchParams();
  // 50 est le plafond accepté par l'API : moins d'allers-retours pour un
  // catalogue de plusieurs centaines de références.
  params.set('limit', '50');
  if (store.q) params.set('q', store.q);
  if (store.cursor) params.set('cursor', store.cursor);

  try {
    const path = store.kind === 'products' ? 'products' : 'collections';
    const page = await api(`/api/${path}?${params}`);
    store.items = store.items.concat(page[path]);
    store.cursor = page.cursor;
    store.hasNext = page.hasNextPage;
    store.loaded = true;
    renderCatalog();
  } catch (error) {
    $('catalog-rows').innerHTML = `<tr><td colspan="7" class="empty">${esc(error.message)}</td></tr>`;
    $('catalog-more').hidden = true;
  } finally {
    store.loading = false;
  }
}

const PRODUCT_STATUS = { ACTIVE: 'En ligne', DRAFT: 'Brouillon', ARCHIVED: 'Archivé' };

function renderCatalog() {
  const store = state.catalog;

  const thumb = (url) =>
    url
      ? `<img class="thumb" src="${esc(url)}" alt="" loading="lazy" />`
      : '<span class="thumb"></span>';

  const rows =
    store.kind === 'products'
      ? store.items.map(
          (product) => `<tr>
            <td>${thumb(product.image)}</td>
            <td><b>${esc(product.title)}</b></td>
            <td><span class="tag tag-status ${
              product.status === 'ACTIVE' ? 'st-CLOSED' : 'st-NEW'
            }">${esc(PRODUCT_STATUS[product.status] ?? product.status)}</span></td>
            <td>${esc(product.vendor ?? '—')}</td>
            <td class="num mono ${
              (product.totalInventory ?? 0) <= 0 ? 'set-alert' : ''
            }">${product.totalInventory ?? '—'}</td>
            <td class="num mono">${product.variantCount}</td>
            <td class="num mono">${
              product.priceMin === null
                ? '—'
                : product.priceMin === product.priceMax
                  ? euro(product.priceMin, product.currency ?? 'EUR')
                  : `${euro(product.priceMin, product.currency ?? 'EUR')} – ${euro(
                      product.priceMax,
                      product.currency ?? 'EUR',
                    )}`
            }</td>
          </tr>`,
        )
      : store.items.map(
          (collection) => `<tr>
            <td>${thumb(collection.image)}</td>
            <td><b>${esc(collection.title)}</b><br /><span class="sub mono">${esc(
              collection.handle,
            )}</span></td>
            <td class="num mono">${collection.productsCount}</td>
            <td>${fullDate(collection.updatedAt)}</td>
          </tr>`,
        );

  $('catalog-rows').innerHTML =
    rows.join('') || '<tr><td colspan="7" class="empty">Rien à afficher.</td></tr>';

  // « 25 produits » laissait croire que le catalogue en comptait 25, alors que
  // c'est le nombre de lignes déjà chargées. Shopify ne donne pas de total sans
  // parcourir toutes les pages, donc on nomme ce qu'on sait.
  $('catalog-count').textContent = store.items.length
    ? `${store.items.length} ${store.kind === 'products' ? 'produits' : 'collections'} affichés${
        store.hasNext ? ' · d’autres à charger' : ''
      }`
    : '';
  $('catalog-more').hidden = !store.hasNext;
}

$('catalog-seg')
  .querySelectorAll('button')
  .forEach((button) =>
    button.addEventListener('click', () => {
      state.catalog.kind = button.dataset.kind;
      $('catalog-seg')
        .querySelectorAll('button')
        .forEach((other) =>
          other.setAttribute('aria-pressed', String(other.dataset.kind === button.dataset.kind)),
        );
      loadCatalog({ reset: true });
    }),
  );

$('catalog-more').addEventListener('click', () => loadCatalog());

// Lien direct plutôt qu'un appel : le navigateur gère le téléchargement, et un
// fichier reçu en mémoire puis re-téléchargé ne servirait à rien de plus.
$('orders-export').href = '/api/orders/export.csv?limit=250';

// Les filtres de commandes rejouent la requête depuis le début : garder le
// curseur mélangerait deux tris dans la même liste.
for (const [id, key] of [
  ['orders-sort', 'sort'],
  ['orders-payment', 'payment'],
  ['orders-delivery', 'delivery'],
]) {
  $(id).addEventListener('change', (event) => {
    state.orders[key] = event.target.value;
    void loadOrders({ reset: true });
  });
}

$('catalog-q').addEventListener('input', (event) => {
  state.catalog.q = event.target.value.trim();
  clearTimeout(state.catalog.timer);
  state.catalog.timer = setTimeout(() => loadCatalog({ reset: true }), 350);
});

/* ------------------------------------------------------------ suivi colis */

async function loadTracking() {
  const body = $('tracking-rows');
  body.innerHTML = '<tr><td colspan="6" class="empty">Chargement…</td></tr>';

  try {
    const { shipments } = await api('/api/tracking?limit=50');

    body.innerHTML =
      shipments
        .map(
          (shipment) => `<tr>
            <td class="mono"><b>${esc(shipment.orderName)}</b></td>
            <td>${esc(shipment.customer ?? '—')}</td>
            <td>${esc(shipment.carrier ?? '—')}</td>
            <td class="mono">${
              shipment.trackingUrl
                ? `<a href="${esc(shipment.trackingUrl)}" target="_blank" rel="noopener">${esc(
                    shipment.trackingNumber,
                  )}</a>`
                : esc(shipment.trackingNumber ?? '—')
            }</td>
            <td>${esc([shipment.city, shipment.country].filter(Boolean).join(', ') || '—')}</td>
            <td>${shipment.estimatedDeliveryAt ? fullDate(shipment.estimatedDeliveryAt) : '—'}</td>
          </tr>`,
        )
        .join('') ||
      '<tr><td colspan="6" class="empty">Aucun colis en cours d’acheminement.</td></tr>';

    $('tracking-count').textContent = shipments.length
      ? `${shipments.length} colis en transit`
      : '';
  } catch (error) {
    body.innerHTML = `<tr><td colspan="6" class="empty">${esc(error.message)}</td></tr>`;
  }
}

$('tracking-refresh').addEventListener('click', () => loadTracking());

/* --------------------------------------------------------- remboursements */

const REFUND_STATUS = {
  PENDING: 'En attente',
  COMPLETED: 'Effectué',
  FAILED: 'Échec',
  CANCELLED: 'Annulé',
};

const REFUND_KIND = { FULL: 'Total', PARTIAL: 'Partiel', SHIPPING: 'Frais de port' };

async function loadRefunds() {
  const body = $('refunds-rows');
  body.innerHTML = '<tr><td colspan="6" class="empty">Chargement…</td></tr>';

  try {
    const { refunds, totals } = await api('/api/refunds');
    state.refundRows = refunds;

    const pending = totals.PENDING ?? { count: 0, amount: 0 };
    const done = totals.COMPLETED ?? { count: 0, amount: 0 };
    const failed = totals.FAILED ?? { count: 0, amount: 0 };

    $('refunds-kpis').innerHTML = [
      ['En cours', euro(pending.amount), `${pending.count} demande${pending.count > 1 ? 's' : ''}`],
      ['Effectués', euro(done.amount), `${done.count} remboursement${done.count > 1 ? 's' : ''}`],
      ['En échec', String(failed.count), failed.count ? 'à reprendre à la main' : 'rien à reprendre'],
      [
        'Total rendu',
        euro(done.amount + pending.amount),
        'effectués et engagés',
      ],
    ]
      .map(
        ([label, value, note]) => `<div class="kpi">
          <span class="kpi-label">${esc(label)}</span>
          <span class="kpi-value">${esc(String(value))}</span>
          <span class="kpi-note">${esc(note)}</span>
        </div>`,
      )
      .join('');

    renderRefundRows();
  } catch (error) {
    body.innerHTML = `<tr><td colspan="6" class="empty">${esc(error.message)}</td></tr>`;
  }
}

function renderRefundRows() {
  const body = $('refunds-rows');
  const filter = state.refundFilter;
  const refunds = filter
    ? state.refundRows.filter((refund) => refund.status === filter)
    : state.refundRows;

  {
    body.innerHTML =
      refunds
        .map(
          (refund) => `<tr>
            <td class="mono"><b>${esc(refund.orderName ?? '—')}</b></td>
            <td>${fullDate(refund.createdAt)}</td>
            <td>${esc(refund.reason ?? '—')}</td>
            <td>${esc(REFUND_KIND[refund.kind] ?? refund.kind)}</td>
            <td><span class="tag tag-status ${
              refund.status === 'COMPLETED'
                ? 'st-CLOSED'
                : refund.status === 'FAILED'
                  ? 'st-FAILED'
                  : 'st-NEEDS_REVIEW'
            }">${esc(REFUND_STATUS[refund.status] ?? refund.status)}</span></td>
            <td class="num mono">${euro(refund.amount, refund.currency ?? 'EUR')}</td>
          </tr>`,
        )
        .join('') || '<tr><td colspan="6" class="empty">Aucun remboursement.</td></tr>';

    $('refunds-count').textContent = refunds.length
      ? `${refunds.length} remboursement${refunds.length > 1 ? 's' : ''}`
      : '';
  }
}

$('refunds-filters').addEventListener('click', (event) => {
  const chip = event.target.closest('.chip');
  if (!chip) return;

  state.refundFilter = chip.dataset.refund;
  $('refunds-filters')
    .querySelectorAll('.chip')
    .forEach((other) =>
      other.setAttribute('aria-pressed', String(other.dataset.refund === state.refundFilter)),
    );
  renderRefundRows();
});

/* ------------------------------------------------------ message sortant -- */

function openMail(to, subject = '') {
  $('mail-to').value = to ?? '';
  $('mail-subject').value = subject;
  $('mail-body').value = '';
  $('mail-modal').classList.add('open');
  $('mail-subject').focus();
}

$('mail-cancel').addEventListener('click', () => $('mail-modal').classList.remove('open'));
$('mail-modal').addEventListener('click', (event) => {
  if (event.target === $('mail-modal')) $('mail-modal').classList.remove('open');
});

$('mail-send').addEventListener('click', async () => {
  const payload = {
    to: $('mail-to').value.trim(),
    subject: $('mail-subject').value.trim(),
    body: $('mail-body').value.trim(),
  };

  if (!payload.to || !payload.subject || !payload.body) {
    toast('Destinataire, objet et message sont requis.', true);
    return;
  }

  const button = $('mail-send');
  button.disabled = true;

  try {
    await api('/api/emails', { method: 'POST', body: JSON.stringify(payload) });
    $('mail-modal').classList.remove('open');
    toast('Message envoyé.');
    await loadAudit();
  } catch (error) {
    toast(error.message, true);
  } finally {
    button.disabled = false;
  }
});

/* ----------------------------------------------------------------- litiges */

const DISPUTE_STATUS = {
  NEEDS_RESPONSE: 'Réponse attendue',
  UNDER_REVIEW: 'En cours d’examen',
  CHARGE_REFUNDED: 'Remboursé',
  ACCEPTED: 'Accepté',
  WON: 'Gagné',
  LOST: 'Perdu',
};

async function loadDisputes() {
  const body = $('disputes-rows');
  body.innerHTML = '<tr><td colspan="6" class="empty">Chargement…</td></tr>';

  try {
    const { disputes } = await api('/api/disputes');

    body.innerHTML =
      disputes
        .map((dispute) => {
          // L'échéance est la seule information qui commande une action datée :
          // passée la date, la banque tranche sans nous.
          const late =
            dispute.evidenceDueBy && new Date(dispute.evidenceDueBy).getTime() < Date.now();

          return `<tr>
            <td class="mono"><b>${esc(dispute.orderName ?? '—')}</b></td>
            <td>${esc(dispute.reason ?? '—')}</td>
            <td>${esc(dispute.type ?? '—')}</td>
            <td><span class="tag tag-status ${
              dispute.status === 'NEEDS_RESPONSE' ? 'st-FAILED' : 'st-NEW'
            }">${esc(DISPUTE_STATUS[dispute.status] ?? dispute.status)}</span></td>
            <td class="${late ? 'set-alert' : ''}">${
              dispute.evidenceDueBy ? fullDate(dispute.evidenceDueBy) : '—'
            }</td>
            <td class="num mono">${euro(dispute.amount, dispute.currency)}</td>
          </tr>`;
        })
        .join('') ||
      '<tr><td colspan="6" class="empty">Aucun litige. Si votre boutique n’utilise pas Shopify Payments, cet écran restera vide.</td></tr>';

    $('disputes-count').textContent = disputes.length
      ? `${disputes.length} litige${disputes.length > 1 ? 's' : ''}`
      : '';
  } catch (error) {
    body.innerHTML = `<tr><td colspan="6" class="empty">${esc(error.message)}</td></tr>`;
  }
}

/* ------------------------------------------------------------- horloges - */

/* L'équipe travaille avec des fournisseurs en Asie et des clients en Europe :
   l'heure locale décide si un appel a une chance d'aboutir maintenant. */
const CLOCKS = [
  ['Agadir', 'Africa/Casablanca', 'ma'],
  ['Paris', 'Europe/Paris', 'fr'],
  ['Chine', 'Asia/Shanghai', 'cn'],
  ['Malaisie', 'Asia/Kuala_Lumpur', 'my'],
  ['New York', 'America/New_York', 'us'],
];

function renderClocks() {
  const now = new Date();

  $('clocks').innerHTML = CLOCKS.map(([city, zone, code]) => {
    const time = now.toLocaleTimeString('fr-FR', {
      timeZone: zone,
      hour: '2-digit',
      minute: '2-digit',
    });

    // Heures ouvrées locales : appeler un fournisseur à 3 h du matin chez lui
    // ne sert à rien, et c'est l'erreur que ces horloges évitent.
    const hour = Number(
      now.toLocaleString('en-GB', { timeZone: zone, hour: '2-digit', hour12: false }),
    );
    const open = hour >= 9 && hour < 18;

    return `<div class="clock clock-${code}${open ? '' : ' shut'}" title="${esc(city)} — ${
      open ? 'heures ouvrées' : 'hors horaires (9 h – 18 h locales)'
    }">
      <div>
        <b>${esc(city)}</b>
        <span>${time}</span>
      </div>
    </div>`;
  }).join('');
}

setInterval(renderClocks, 30000);

/* ------------------------------------------------------------ navigation */

/* Icônes en ligne : une police d'icônes ou un CDN ne passerait pas la
   politique de sécurité, et douze glyphes ne justifient pas un build. */
const ICONS = {
  grid: '<path d="M2.5 2.5h4.5v4.5H2.5zM9 2.5h4.5v4.5H9zM2.5 9h4.5v4.5H2.5zM9 9h4.5v4.5H9z"/>',
  inbox: '<path d="M2 9.5h3l1 2h4l1-2h3"/><path d="M2.5 9.5 4 3h8l1.5 6.5v4h-11z"/>',
  chart: '<path d="M2.5 13.5V7M6.5 13.5V3M10.5 13.5v-4M14 13.5V5.5"/>',
  bag: '<path d="M3 5h10l-.8 8.5H3.8z"/><path d="M6 5V3.5a2 2 0 0 1 4 0V5"/>',
  users:
    '<circle cx="6" cy="6" r="2.4"/><path d="M2 13.2c0-2.2 1.8-3.6 4-3.6s4 1.4 4 3.6"/><path d="M10.6 4.2a2.4 2.4 0 0 1 0 4.3M11.6 9.9c1.5.4 2.6 1.6 2.6 3.3"/>',
  box: '<path d="M8 2 14 5v6l-6 3-6-3V5z"/><path d="m2 5 6 3 6-3M8 8v6"/>',
  truck:
    '<path d="M1.5 4.5h8v6h-8z"/><path d="M9.5 7h3l2 2v1.5h-5z"/><circle cx="4.5" cy="12" r="1.4"/><circle cx="11.5" cy="12" r="1.4"/>',
  pin: '<path d="M8 14s5-4.5 5-8A5 5 0 0 0 3 6c0 3.5 5 8 5 8z"/><circle cx="8" cy="6" r="1.8"/>',
  euro: '<path d="M12 4.2A4.5 4.5 0 0 0 5 8a4.5 4.5 0 0 0 7 3.8M3 7h5M3 9.4h5"/>',
  shield: '<path d="M8 2l5 2v4.2c0 3-2.2 4.8-5 5.6-2.8-.8-5-2.6-5-5.6V4z"/>',
  swatch: '<circle cx="8" cy="8" r="5.5"/><circle cx="8" cy="5.6" r="1"/><circle cx="10.2" cy="9" r="1"/><circle cx="5.8" cy="9" r="1"/>',
  gear: '<circle cx="8" cy="8" r="2.2"/><path d="M8 1.8v1.6M8 12.6v1.6M14.2 8h-1.6M3.4 8H1.8M12.4 3.6l-1.1 1.1M4.7 11.3l-1.1 1.1M12.4 12.4l-1.1-1.1M4.7 4.7 3.6 3.6"/>',
};

function ico(name) {
  return `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"
    stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] ?? ''}</svg>`;
}

/* Une entrée par écran : icône, libellé, groupe, et le compteur affiché en
   pastille quand il y a quelque chose à traiter. */
const VIEW_META = {
  overview: { icon: 'grid', label: "Vue d'ensemble", group: 'Pilotage', title: "Vue d'ensemble" },
  tickets: { icon: 'inbox', label: 'File de traitement', group: 'Pilotage', title: 'File de traitement' },
  stats: { icon: 'chart', label: "Statistiques", group: 'Pilotage', title: "Statistiques d'équipe" },
  orders: { icon: 'bag', label: 'Commandes', group: 'Commerce', title: 'Commandes' },
  customers: { icon: 'users', label: 'Clients', group: 'Commerce', title: 'Clients' },
  catalog: { icon: 'box', label: 'Catalogue', group: 'Commerce', title: 'Catalogue' },
  suppliers: { icon: 'truck', label: 'Fournisseurs', group: 'Fournisseur', title: 'Contacts fournisseurs' },
  tracking: { icon: 'pin', label: 'Suivi colis', group: 'Fournisseur', title: 'Suivi des colis' },
  refunds: { icon: 'euro', label: 'Remboursements', group: 'Finance', title: 'Remboursements' },
  disputes: { icon: 'shield', label: 'Litiges Shopify', group: 'Finance', title: 'Litiges Shopify' },
  team: { icon: 'users', label: 'Équipe & rôles', group: 'Plateforme', title: 'Équipe & rôles' },
  palettes: { icon: 'swatch', label: 'Palettes', group: 'Plateforme', title: 'Apparence' },
  settings: { icon: 'gear', label: 'Réglages', group: 'Plateforme', title: 'Réglages' },
};

const NAV_GROUPS = ['Pilotage', 'Commerce', 'Fournisseur', 'Finance', 'Plateforme'];

const VIEWS = Object.keys(VIEW_META);

function renderNav() {
  // Recherche : on ne masque pas les groupes vides en les laissant en place,
  // ils laisseraient des titres orphelins au-dessus de rien.
  const needle = (state.navQuery ?? '').trim().toLowerCase();
  const matches = (view) =>
    !needle ||
    `${VIEW_META[view].label} ${VIEW_META[view].group}`.toLowerCase().includes(needle);

  $('nav').innerHTML = NAV_GROUPS.map((group) => {
    const items = VIEWS.filter((view) => VIEW_META[view].group === group && matches(view));
    if (items.length === 0) return '';

    return `<div class="nav-group">
      <p class="nav-title">${esc(group)}</p>
      ${items
        .map((view) => {
          const meta = VIEW_META[view];
          const tally = view === 'tickets' ? (state.pendingCount ?? 0) : 0;
          return `<button class="nav-item" data-view="${view}" aria-current="${
            view === state.view
          }">${ico(meta.icon)}${esc(meta.label)}${
            tally ? `<span class="tally">${tally}</span>` : ''
          }</button>`;
        })
        .join('')}
    </div>`;
  }).join('');

  if (!$('nav').innerHTML.trim()) {
    $('nav').innerHTML = '<p class="empty" style="padding: 4px 8px">Aucun écran ne correspond.</p>';
  }

  $('nav')
    .querySelectorAll('.nav-item')
    .forEach((item) => item.addEventListener('click', () => setView(item.dataset.view)));
}

$('nav-search').addEventListener('input', (event) => {
  state.navQuery = event.target.value;
  renderNav();
});

/**
 * Recherche globale.
 *
 * Le champ servait seulement à filtrer la navigation. Or ce qu'on cherche
 * toute la journée, c'est une commande — « #1042 » —, et accessoirement un
 * client. La destination se déduit de ce qui est tapé plutôt que d'un menu à
 * choisir avant de taper.
 */
function routeSearch(raw) {
  const term = raw.trim();
  if (!term) return;

  // Un numéro de commande, avec ou sans dièse : c'est le cas majoritaire, il
  // passe en premier.
  if (/^#?\d{2,}$/.test(term)) {
    state.orders.q = term.startsWith('#') ? term : `#${term}`;
    $('orders-q').value = state.orders.q;
    setView('orders');
    void loadOrders({ reset: true });
    return;
  }

  // Une adresse email désigne un client : sa fiche dit plus que la liste des
  // commandes du même nom.
  if (term.includes('@')) {
    state.customers.q = term;
    $('customers-q').value = term;
    setView('customers');
    void loadCustomers({ reset: true });
    return;
  }

  // Un écran porte ce nom : on y va, c'est l'ancien comportement du champ.
  const view = VIEWS.find((candidate) =>
    VIEW_META[candidate].label.toLowerCase().includes(term.toLowerCase()),
  );
  if (view) {
    setView(view);
    return;
  }

  // Sinon, du texte libre : la file de traitement le cherche dans les objets,
  // les clients et les numéros de commande.
  state.queue.q = term;
  $('q-search').value = term;
  setView('tickets');
  void loadQueue();
}

$('nav-search').addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    event.target.value = '';
    state.navQuery = '';
    renderNav();
    event.target.blur();
    return;
  }

  if (event.key !== 'Enter') return;

  routeSearch(event.target.value);

  // La navigation était filtrée pendant la frappe : la laisser ainsi vide la
  // barre latérale au moment précis où l'on arrive sur l'écran demandé.
  state.navQuery = '';
  renderNav();
  event.target.blur();
});

document.addEventListener('keydown', (event) => {
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName ?? '');
  if (event.key === '/' && !typing) {
    event.preventDefault();
    $('nav-search').focus();
  }
});

/* Chaque vue charge à sa première ouverture. Interroger Shopify pour un écran
   que personne ne regarde coûte une latence pour rien. */
const VIEW_LOADERS = {
  overview: () => loadOverview(),
  orders: () => !state.orders.loaded && loadOrders({ reset: true }),
  customers: () => !state.customers.loaded && loadCustomers({ reset: true }),
  catalog: () => !state.catalog.loaded && loadCatalog({ reset: true }),
  suppliers: () => renderSuppliers(),
  tracking: () => loadTracking(),
  refunds: () => loadRefunds(),
  disputes: () => loadDisputes(),
  team: () => loadTeam(),
  stats: () => loadStats(),
  palettes: () => renderPalettes(),
  settings: () => openSettings(),
};

function setView(view) {
  state.view = view;
  const meta = VIEW_META[view];

  for (const name of VIEWS) {
    const el = $(`view-${name}`);
    if (el) el.hidden = name !== view;
  }

  $('view-title').textContent = meta.title;
  $('crumb').innerHTML = `${ico(meta.icon)} ${esc(meta.group)}`;

  // Les indicateurs et les filtres décrivent la file : les laisser ailleurs
  // ferait croire qu'ils décrivent l'écran affiché — la barre de filtres est
  // apparue au-dessus des Réglages, où elle ne veut rien dire.
  $('kpis').hidden = view !== 'tickets';
  $('queue-bar').hidden = view !== 'tickets';

  renderNav();

  try {
    VIEW_LOADERS[view]?.();
  } catch (error) {
    toast(error.message, true);
  }
}

/* ------------------------------------------------------------- apparence */

const PALETTES = [
  ['violet', 'Violet', '#6c5ce7'],
  ['indigo', 'Indigo', '#4f46e5'],
  ['bleu', 'Bleu', '#2563eb'],
  ['cyan', 'Cyan', '#0891b2'],
  ['emeraude', 'Émeraude', '#059669'],
  ['ambre', 'Ambre', '#d97706'],
  ['corail', 'Corail', '#e11d48'],
  ['graphite', 'Graphite', '#475569'],
];

/* Préférence d'affichage, propre à la personne et à son écran : elle vit dans
   le navigateur, pas en base. La stocker côté serveur imposerait le même thème
   au portable et au poste fixe. */
function applyAppearance() {
  const accent = localStorage.getItem('csav.accent') ?? 'violet';
  const theme = localStorage.getItem('csav.theme') ?? 'auto';

  document.documentElement.dataset.accent = accent;

  const dark =
    theme === 'dark' ||
    (theme === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);

  if (dark) document.documentElement.dataset.theme = 'dark';
  else delete document.documentElement.dataset.theme;
}

function renderPalettes() {
  const accent = localStorage.getItem('csav.accent') ?? 'violet';
  const theme = localStorage.getItem('csav.theme') ?? 'auto';

  $('palette-swatches').innerHTML = PALETTES.map(
    ([key, label, hex]) => `<button class="swatch" data-accent="${key}" aria-pressed="${
      key === accent
    }"><i style="background:${hex}"></i>${esc(label)}</button>`,
  ).join('');

  $('palette-swatches')
    .querySelectorAll('.swatch')
    .forEach((button) =>
      button.addEventListener('click', () => {
        localStorage.setItem('csav.accent', button.dataset.accent);
        applyAppearance();
        renderPalettes();
      }),
    );

  $('theme-seg')
    .querySelectorAll('button')
    .forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset.theme === theme));
      button.onclick = () => {
        localStorage.setItem('csav.theme', button.dataset.theme);
        applyAppearance();
        renderPalettes();
      };
    });
}

// Le thème « Système » doit suivre la bascule jour/nuit de l'OS sans rechargement.
window
  .matchMedia('(prefers-color-scheme: dark)')
  .addEventListener('change', () => applyAppearance());

$('logout').addEventListener('click', async () => {
  await api('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
  window.location.href = '/login';
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
  // 50 est le plafond accepté par l'API : moins d'allers-retours pour un
  // carnet de plusieurs centaines de commandes.
  params.set('limit', '50');
  if (store.q) params.set('q', store.q);
  if (store.cursor) params.set('cursor', store.cursor);
  if (store.sort && store.sort !== 'recent') params.set('sort', store.sort);
  if (store.payment) params.set('payment', store.payment);
  if (store.delivery) params.set('delivery', store.delivery);

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
    $('actbar').hidden = true;
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
  // 50 est le plafond accepté par l'API : moins d'allers-retours pour un
  // catalogue de plusieurs centaines de références.
  params.set('limit', '50');
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
          <td>${
            customer.email
              ? `<button class="btn btn-small" data-mail="${esc(customer.email)}">Écrire</button>`
              : ''
          }</td>
        </tr>`,
      )
      .join('') || '<tr><td colspan="7" class="empty">Aucun client.</td></tr>';

  $('customers-count').textContent = store.items.length
    ? `${store.items.length} client${store.items.length > 1 ? 's' : ''}`
    : '';
  $('customers-more').hidden = !store.hasNext;

  // Cliquer un client ouvre sa fiche croisée : commandes, colis, tickets et
  // remboursements d'un coup. Auparavant on basculait sur ses commandes, ce
  // qui ne répondait qu'à un quart de la question.
  // Le bouton « Écrire » ne doit pas déclencher l'ouverture de la fiche.
  $('customers-rows')
    .querySelectorAll('[data-mail]')
    .forEach((button) =>
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        openMail(button.dataset.mail);
      }),
    );

  $('customers-rows')
    .querySelectorAll('.grid-row')
    .forEach((row) =>
      row.addEventListener('click', () => {
        const cell = row.querySelector('td b');
        void openCustomerSheet(row.dataset.email, cell?.textContent ?? '');
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

  // Écart entre les autorisations demandées et celles réellement accordées :
  // c'est ce qui provoque un « accès refusé » sur le catalogue alors que la
  // boutique est bien connectée.
  const missingScopes = connections.shopify.missingScopes ?? [];

  renderConnection($('set-shopify'), {
    label: 'Shopify',
    connected: connections.shopify.connected,
    simulated: connections.shopify.simulated,
    detail: connections.shopify.connected
      ? `Boutique <code>${esc(merchant.shopDomain)}</code> · autorisations : ${
          connections.shopify.scopes.map(esc).join(', ') || '—'
        }${
          missingScopes.length
            ? ` · <b class="set-alert">manquantes : ${missingScopes
                .map(esc)
                .join(', ')}</b> — réautorisez pour les obtenir.`
            : ''
        }`
      : "L'accès Shopify vient de l'installation de l'application depuis votre administration.",
    // Se déconnecter de Shopify, c'est désinstaller l'app côté Shopify : le
    // faire depuis ici laisserait les deux côtés en désaccord.
    actions: connections.shopify.connected
      ? `<a class="btn btn-small${
          missingScopes.length ? ' btn-primary' : ''
        }" href="/auth/shopify?shop=${encodeURIComponent(
          merchant.shopDomain,
        )}">Réautoriser</a>
         <a class="btn btn-small" href="https://${esc(
           merchant.shopDomain,
         )}/admin/settings/apps" target="_blank" rel="noopener">Gérer sur Shopify</a>`
      : `<a class="btn btn-small btn-primary" href="/auth/shopify?shop=${encodeURIComponent(
          merchant.shopDomain,
        )}">Connecter</a>`,
  });

  const gmail = connections.gmail;
  const boxes = gmail.mailboxes ?? [];

  // Une carte par boîte : chacune a son propre watch, et une seule expirée
  // suffit à faire disparaître une partie du courrier sans le moindre signal.
  const gmailDetail = boxes.length
    ? boxes
        .map(
          (mailbox) => `<div class="mbx">
            <div class="mbx-head">
              <code>${esc(mailbox.emailAddress)}</code>
              ${mailbox.isDefault ? '<span class="tag tag-intent">par défaut</span>' : ''}
            </div>
            <div class="mbx-state">${
              mailbox.watchActive
                ? `écoute active jusqu’au ${fullDate(mailbox.watchExpiration)}`
                : '<b class="set-alert">écoute expirée</b> — reconnectez cette boîte'
            }</div>
            <div class="mbx-acts">
              <input type="text" data-mbx-label="${esc(mailbox.id)}"
                placeholder="Nom d’usage (ex. SAV)" value="${esc(mailbox.label ?? '')}" />
              ${
                mailbox.isDefault
                  ? ''
                  : `<button class="btn btn-small" data-mbx-default="${esc(
                      mailbox.id,
                    )}">Par défaut</button>`
              }
              <button class="btn btn-small btn-danger" data-mbx-off="${esc(
                mailbox.id,
              )}">Débrancher</button>
            </div>
          </div>`,
        )
        .join('')
    : 'Aucune boîte connectée — rien n’est ingéré.';

  renderConnection($('set-gmail'), {
    label: 'Boîtes mail',
    connected: gmail.connected,
    simulated: gmail.simulated,
    detail: gmailDetail,
    // « Ajouter » et non « Reconnecter » : le même bouton sert aux deux, mais
    // c'est l'ajout qu'on cherche une fois la première boîte en place.
    actions: `<a class="btn btn-small${
      gmail.connected ? '' : ' btn-primary'
    }" href="/auth/google">${gmail.connected ? '＋ Ajouter une boîte' : 'Connecter Gmail'}</a>`,
  });

  $('set-gmail')
    .querySelectorAll('[data-mbx-default]')
    .forEach((button) =>
      button.addEventListener('click', () =>
        patchMailbox(button.dataset.mbxDefault, { isDefault: true }),
      ),
    );

  $('set-gmail')
    .querySelectorAll('[data-mbx-off]')
    .forEach((button) =>
      button.addEventListener('click', async () => {
        if (!confirm('Débrancher cette boîte ? Les tickets déjà reçus sont conservés.')) return;

        try {
          await api(`/api/mailboxes/${button.dataset.mbxOff}`, { method: 'DELETE' });
          toast('Boîte débranchée.');
          await openSettings();
        } catch (error) {
          toast(error.message, true);
        }
      }),
    );

  // Le libellé s'enregistre en quittant le champ : un bouton par boîte
  // encombrerait une carte déjà chargée.
  $('set-gmail')
    .querySelectorAll('[data-mbx-label]')
    .forEach((input) =>
      input.addEventListener('change', () =>
        patchMailbox(input.dataset.mbxLabel, { label: input.value }),
      ),
    );

  $('set-brand').value = merchant.brandName ?? '';
  $('set-logo').value = merchant.logoUrl ?? '';
  $('set-tracking').value = merchant.trackingUrlTemplate ?? '';
  $('set-autosend').checked = merchant.autoSendEnabled;
  $('set-threshold').value = merchant.autoSendThreshold;
  $('set-threshold-echo').textContent = `${Math.round(merchant.autoSendThreshold * 100)} %`;
  $('set-retention').value = String(merchant.retentionDays);

}

async function openSettings() {
  state.settings = await api('/api/settings');
  renderSettings();
}

$('set-threshold').addEventListener('input', (event) => {
  $('set-threshold-echo').textContent = `${Math.round(Number(event.target.value) * 100)} %`;
});

$('set-save').addEventListener('click', async () => {
  try {
    const { merchant } = await api('/api/settings', {
      method: 'PATCH',
      body: JSON.stringify({
        brandName: $('set-brand').value.trim() || null,
        logoUrl: $('set-logo').value.trim() || null,
        trackingUrlTemplate: $('set-tracking').value.trim() || null,
        autoSendEnabled: $('set-autosend').checked,
        autoSendThreshold: Number($('set-threshold').value),
        retentionDays: Number($('set-retention').value),
      }),
    });

    // La barre haute et l'indicateur « envoi automatique » affichent ces
    // valeurs : les rafraîchir évite un écran qui se contredit.
    Object.assign(state.me.merchant, merchant);
    renderMe();
    await Promise.all([loadMetrics(), loadAudit()]);

    toast('Réglages enregistrés.');
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
            <option value="">Premier contact actif</option>
            ${contacts
              .map(
                (supplier) => `<option value="${esc(supplier.id)}">${esc(supplier.name)}</option>`,
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
  'email.sent': 'Message envoyé',
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

async function patchMailbox(id, body) {
  try {
    await api(`/api/mailboxes/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
    toast('Boîte mise à jour.');
    await openSettings();
  } catch (error) {
    toast(error.message, true);
  }
}

/* ------------------------------------------------------- rafraîchissement */

/**
 * Recharge l'écran courant.
 *
 * Les tickets arrivent par notification Gmail, sans que la page en soit
 * informée : sans rechargement, un agent qui laisse l'onglet ouvert toute la
 * matinée regarde une file figée à son arrivée.
 */
async function refreshCurrent({ silent = false } = {}) {
  if (state.refreshing) return;
  state.refreshing = true;

  const button = $('refresh');
  if (!silent) button.classList.add('busy');

  // Les chargeurs d'écran sautent le travail quand les données sont déjà là :
  // c'est ce qu'on veut en navigant, l'inverse de ce qu'on veut en actualisant.
  const store = { orders: 'orders', customers: 'customers', catalog: 'catalog' }[state.view];
  if (store) state[store].loaded = false;

  try {
    const jobs = [state.view === 'tickets' ? loadQueue() : VIEW_LOADERS[state.view]?.()];

    // Les indicateurs et le compteur de la navigation décrivent la file : ils
    // doivent suivre, quel que soit l'écran regardé.
    if (state.view === 'tickets') jobs.push(loadMetrics(), loadAudit());

    await Promise.all(jobs.filter(Boolean));
    state.lastRefresh = Date.now();
  } catch (error) {
    if (!silent) toast(error.message ?? 'Actualisation impossible', true);
  } finally {
    state.refreshing = false;
    button.classList.remove('busy');
    renderRefreshLabel();
  }
}

function renderRefreshLabel() {
  if (!state.lastRefresh) return;

  const seconds = Math.round((Date.now() - state.lastRefresh) / 1000);
  const label =
    seconds < 60
      ? 'à l’instant'
      : `il y a ${Math.floor(seconds / 60)} min`;

  $('refresh-label').textContent = label;
  $('refresh').title = 'Actualiser (R)';
}

setInterval(renderRefreshLabel, 15000);

$('refresh').addEventListener('click', () => void refreshCurrent());

$('auto-refresh').addEventListener('change', (event) => {
  localStorage.setItem('csav.autoRefresh', event.target.checked ? '1' : '0');
  toast(event.target.checked ? 'Actualisation automatique activée.' : 'Actualisation automatique coupée.');
});

// Toutes les 60 secondes, et seulement si l'onglet est visible : recharger en
// arrière-plan consommerait l'API Shopify pour un écran que personne ne
// regarde.
setInterval(() => {
  if (!$('auto-refresh').checked || document.hidden || !state.me) return;
  void refreshCurrent({ silent: true });
}, 60000);

// Au retour sur l'onglet après une absence : ce qui est affiché a toutes les
// chances d'être périmé.
document.addEventListener('visibilitychange', () => {
  if (document.hidden || !state.me || !$('auto-refresh').checked) return;
  if (Date.now() - (state.lastRefresh ?? 0) < 30000) return;
  void refreshCurrent({ silent: true });
});

document.addEventListener('keydown', (event) => {
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName ?? '');
  if (!typing && (event.key === 'r' || event.key === 'R')) {
    event.preventDefault();
    void refreshCurrent();
  }
});

/* ------------------------------------------------------ tiroir de navigation */

function toggleNav(open) {
  const grid = $('app-grid');
  const next = open ?? !grid.classList.contains('nav-open');

  grid.classList.toggle('nav-open', next);
  $('scrim').hidden = !next;
  $('navtoggle').setAttribute('aria-expanded', String(next));
}

$('navtoggle').addEventListener('click', () => toggleNav());
$('scrim').addEventListener('click', () => toggleNav(false));

// Naviguer ferme le tiroir : le laisser ouvert masquerait l'écran qu'on vient
// justement de demander.
$('nav').addEventListener('click', (event) => {
  if (event.target.closest('.nav-item')) toggleNav(false);
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') toggleNav(false);
});

/* --------------------------------------------------- événements boutiques */

$('shop-switch').addEventListener('click', (event) => {
  event.stopPropagation();
  toggleShopMenu();
});

$('shop-menu').addEventListener('click', (event) => {
  if (event.target.closest('[data-shop-all]')) {
    toggleShopMenu(false);
    setAllShops(true);
    return;
  }

  const add = event.target.closest('[data-shop-add]');
  if (add) {
    toggleShopMenu(false);
    void addShop();
    return;
  }

  const row = event.target.closest('[data-shop]');
  if (!row) return;

  toggleShopMenu(false);

  // Revenir sur la boutique déjà active depuis le mode agrégé ne demande pas
  // de changer de session, seulement de refermer la vue élargie.
  if (row.dataset.shop === state.me?.merchant?.id) {
    setAllShops(false);
    return;
  }

  void switchShop(row.dataset.shop);
});

/**
 * Mode « toutes les boutiques ».
 *
 * Lecture seule et sans rechargement : la session reste sur une boutique, seule
 * la file s'élargit. Toute action — répondre, rembourser, escalader — continue
 * de porter sur la boutique du ticket ouvert.
 */
function setAllShops(on) {
  state.allShops = on;
  localStorage.setItem('csav.allShops', on ? '1' : '0');

  renderShopMenu();
  renderMe();

  if (state.view === 'tickets') void loadQueue();
  else setView('tickets');
}

// Un menu ouvert qui reste ouvert quand on clique ailleurs recouvre la
// navigation et donne l'impression d'une interface bloquée.
document.addEventListener('click', () => toggleShopMenu(false));

/* ------------------------------------------------------------- démarrage */

async function boot() {
  applyAppearance();

  try {
    state.me = await api('/api/me');
  } catch (error) {
    if (error.status !== 401) showGate(error.message);
    return;
  }

  $('gate').hidden = true;
  $('app').hidden = false;

  // Mémorisé pour l'écran de session expirée, sur cet appareil uniquement.
  if (state.me.merchant.shopDomain) {
    localStorage.setItem('csav.shop', state.me.merchant.shopDomain);
  }

  state.allShops = localStorage.getItem('csav.allShops') === '1';
  $('auto-refresh').checked = localStorage.getItem('csav.autoRefresh') !== '0';
  state.lastRefresh = Date.now();
  renderRefreshLabel();

  renderMe();
  renderClocks();
  setView('tickets');

  await Promise.all([
    loadAgents(),
    loadMetrics(),
    loadQueue(),
    loadAudit(),
    loadSupplier(),
    loadShops(),
  ]);

  if (state.tickets.length > 0) await selectTicket(state.tickets[0].id);
}

boot();
