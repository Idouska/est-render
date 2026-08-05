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
    q: '', intent: '', assignee: '', mailbox: '', label: '', sort: 'newest',
    urgent: false, unassigned: false, unlinked: false, historical: false,
    origin: '', timer: null,
  },
  queueCounts: {},
  agents: [],
  canned: [],
  editingCanned: null,
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

/**
 * Navigation repliée en rail d'icônes.
 *
 * Deux cent quarante-huit pixels de barre permanente, c'est une colonne de
 * tickets en moins sur un portable. Repliée, la navigation garde ses icônes et
 * rend la largeur au travail ; le choix est mémorisé, parce qu'on ne le refait
 * pas dix fois par jour.
 */
function applySideFold() {
  const folded = localStorage.getItem('csav.side') === 'folded';
  document.getElementById('app-grid')?.classList.toggle('folded', folded);
  const button = document.getElementById('side-fold');
  if (button) {
    button.setAttribute('aria-pressed', String(folded));
    button.title = folded ? 'Déplier la navigation' : 'Replier la navigation';
  }
}

document.getElementById('side-fold')?.addEventListener('click', () => {
  const folded = localStorage.getItem('csav.side') === 'folded';
  localStorage.setItem('csav.side', folded ? 'open' : 'folded');
  applySideFold();
});

applySideFold();

/**
 * Couleurs des libellés, telles que Gmail les connaît.
 *
 * Chargées une fois : elles ne changent qu'au rythme où l'on repeint ses
 * étiquettes, alors que la file se recharge toutes les minutes.
 */
let labelStyles = {};

async function loadLabelStyles() {
  try {
    const data = await api('/api/labels');
    labelStyles = data.labels ?? {};
  } catch {
    // Sans couleurs, les étiquettes restent grises : lisibles, simplement
    // moins reconnaissables.
    labelStyles = {};
  }
}

/**
 * Étiquette d'un libellé, peinte comme dans Gmail.
 *
 * Un libellé imbriqué — « Administratif/Factures » — n'affiche que sa feuille :
 * le chemin complet triple la largeur de la puce pour redire un classement que
 * l'agent connaît déjà. Le chemin reste dans l'infobulle.
 */
function labelChip(name) {
  const style = labelStyles[name];
  const leaf = name.includes('/') ? name.slice(name.lastIndexOf('/') + 1) : name;

  const paint = style?.background
    ? ` style="background:${esc(style.background)};color:${esc(
        style.text ?? '#000000',
      )};box-shadow:none"`
    : '';

  return `<span class="tag tag-label" title="${esc(name)}"${paint}>${esc(leaf)}</span>`;
}

function renderMe() {
  const me = state.me;
  const shop = me.merchant.shopDomain ?? '';

  // Déclaré plus bas dans le fichier : les fonctions sont hissées, l'appel est
  // donc sûr, et la bannière doit paraître au premier rendu — pas au premier
  // passage par les Réglages.
  renderPreviewBar();
  trimPreviewChoices();

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
  const logoSrc = brandLogoSrc(me.merchant);

  if (logoSrc) {
    logo.src = logoSrc;
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
  // L'adresse est coupée à l'affichage : l'infobulle rend la version entière.
  $('me-name').title = who;
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
  if (f.label) params.set('label', f.label);
  if (state.allShops) params.set('scope', 'all');
  if (f.sort !== 'newest') params.set('sort', f.sort);
  if (f.urgent) params.set('minAgeDays', '3');
  if (f.unassigned) params.set('assignee', 'none');
  if (f.unlinked) params.set('unlinked', 'true');
  if (f.historical) params.set('historical', 'true');

  return params;
}

function queueIsFiltered() {
  const f = state.queue;
  return Boolean(
    state.filter || f.q.trim() || f.intent || f.assignee || f.mailbox || f.label ||
      f.urgent || f.unassigned || f.unlinked || f.historical,
  );
}

let queueObserver = null;
let queueLoadingMore = false;

async function loadQueue({ append = false } = {}) {
  const list = $('queue');

  const params = queueParams();
  if (append && state.queueCursor) params.set('cursor', state.queueCursor);
  // Cinquante par page plutôt que vingt-cinq : le défilement infini enchaîne
  // les pages, autant qu'elles soient assez grosses pour qu'il ne se déclenche
  // pas à chaque tour de molette.
  params.set('limit', '50');

  const data = await api(`/api/tickets?${params}`);

  state.queueCursor = data.nextCursor ?? null;
  state.tickets = append ? [...state.tickets, ...data.tickets] : data.tickets;
  state.queueCounts = data.counts ?? {};
  state.queueLabels = data.labels ?? state.queueLabels ?? [];

  // Compteurs de la navigation, dérivés des mêmes chiffres que la file : deux
  // sources donneraient deux vérités, et c'est celle qu'on ne regarde pas qui
  // finirait par mentir.
  state.navCounts = {
    suppliers: state.queueCounts?.AWAITING_SUPPLIER ?? 0,
    disputes: state.disputeCount ?? 0,
  };
  renderNav();
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

  // Sentinelle de fin de liste : quand elle entre dans le champ, la page
  // suivante se charge. Un bouton « charger la suite » sur une file de travail
  // se re-clique cinquante fois ; le défilement, lui, ne se remarque pas.
  if (state.queueCursor) {
    const sentinel = document.createElement('li');
    sentinel.className = 'queue-more';
    sentinel.textContent = 'Chargement…';
    list.append(sentinel);

    queueObserver?.disconnect();
    queueObserver = new IntersectionObserver((entries) => {
      if (!entries[0]?.isIntersecting || queueLoadingMore) return;
      queueLoadingMore = true;
      void loadQueue({ append: true }).finally(() => {
        queueLoadingMore = false;
      });
    });
    queueObserver.observe(sentinel);
  } else {
    queueObserver?.disconnect();
  }

  list.querySelectorAll('.queue-item').forEach((button) => {
    button.addEventListener('click', () => selectTicket(button.dataset.id));
    button.addEventListener('mouseenter', () => prefetchTicket(button.dataset.id));
    // Le survol n'existe pas au doigt : sur mobile, le contact précède le clic
    // d'assez peu pour que ça compte quand même.
    button.addEventListener('touchstart', () => prefetchTicket(button.dataset.id), {
      passive: true,
    });
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

/* ------------------------------------------------- chronologie d'un colis */

/**
 * Historique réel du colis, transporteur par transporteur.
 *
 * Shopify fige le statut à l'expédition : pour un envoi depuis la Chine, il
 * reste « expédié » trois semaines. C'est 17TRACK qui sait où en est le colis,
 * et c'est cette réponse-là qu'attend le client.
 */
async function openTracking(number, externalUrl = null) {
  $('sheet-name').textContent = 'Suivi du colis';
  $('sheet-email').textContent = number;
  $('sheet-body').innerHTML = '<p class="empty">Interrogation du transporteur…</p>';
  $('sheet-wrap').hidden = false;

  let data;
  try {
    data = await api(`/api/tracking/${encodeURIComponent(number)}`);
  } catch (error) {
    $('sheet-body').innerHTML = `<p class="empty">${esc(error.message)}</p>`;
    return;
  }

  const { parcel, track } = data;

  if (!track) {
    $('sheet-body').innerHTML = `<section class="sheet-group">
      <h3>Suivi indisponible</h3>
      <div class="sheet-row"><p>
        Aucune donnée transporteur pour ce numéro. Soit la clé 17TRACK n'est pas
        configurée dans la console d'administration, soit le transporteur n'a pas
        encore pris le colis en charge.
      </p></div>
    </section>`;
    return;
  }

  // Le site du transporteur reste accessible, mais depuis la fenêtre et en
  // choix secondaire : l'outil répond d'abord lui-même.
  const external = externalUrl
    ? `<p class="sheet-ext"><a href="${esc(externalUrl)}" target="_blank" rel="noopener">
        Ouvrir chez le transporteur ↗</a></p>`
    : '';

  $('sheet-body').innerHTML = `
    <section class="sheet-group">
      <h3>${esc(parcel.orderName ?? 'Colis')}${
        parcel.total > 1 ? ` · ${parcel.index}/${parcel.total}` : ''
      }</h3>
      <div class="sheet-row">
        <b>${esc(TRACK_LABELS[track.status] ?? track.status ?? '—')}</b>
        ${track.carrier ? `<span class="tag tag-order">${esc(track.carrier)}</span>` : ''}
        <span class="when">${
          track.lastUpdatedAt ? relativeTime(track.lastUpdatedAt) : ''
        }</span>
      </div>
    </section>

    <section class="sheet-group">
      <h3>Chronologie</h3>
      <div class="sheet-row" style="display:block">
        ${
          track.events.length
            ? `<div class="tl">${track.events
                .map(
                  (event) => `<div class="tl-step">
                    <span class="when">${fullDate(event.at)}</span>
                    <b>${esc(event.status)}</b>
                    ${event.location ? `<span>${esc(event.location)}</span>` : ''}
                  </div>`,
                )
                .join('')}</div>`
            : '<p>Aucun événement pour le moment.</p>'
        }
      </div>
    </section>
    ${external}`;
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
        <button class="linklike mono" data-track="${esc(parcel.trackingNumber)}">${esc(parcel.trackingNumber)}</button>
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

$('read-only-switch').addEventListener('click', (event) => {
  const id = event.currentTarget.dataset.shop;
  if (id) void switchShop(id);
});

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
        <button class="linklike mono" data-track="${esc(parcel.trackingNumber)}">${esc(parcel.trackingNumber)}</button>
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

/**
 * Ouvre la rédaction sous les actions, sans quitter le ticket.
 *
 * Une fenêtre modale masque exactement ce qu'on doit relire pour répondre. Ici
 * le message se compose au-dessous du fil, qui reste visible.
 */
function openCompose(target, ticket) {
  const zone = $('compose');
  zone.hidden = false;
  zone.dataset.target = target;

  const body = $('compose-body');
  body.placeholder =
    target === 'client' ? 'Votre message au client…' : 'Votre message au fournisseur…';
  body.value = '';
  body.focus();

  const relay = $('compose-relay');
  const hint = $('compose-hint');

  if (target === 'supplier') {
    // L'heure locale de l'atelier décide du canal : un mail à 5 h du matin
    // attend le réveil, un message instantané aussi — mais on ne le découvre
    // qu'après avoir attendu. Le dire ici évite la relance inutile.
    const local = supplierLocalTime();
    relay.hidden = false;
    relay.textContent = 'Relancer sur WhatsApp';
    hint.textContent = local
      ? `Il est ${local.time} en Chine — ${
          local.open ? 'heures ouvrées' : 'hors horaires, réponse probable demain matin'
        }.`
      : '';
  } else {
    relay.hidden = true;
    hint.textContent = `Part vers ${ticket.customerEmail}.`;
  }
}

/** Heure de l'atelier, et si l'on peut espérer une réponse tout de suite. */
function supplierLocalTime() {
  const now = new Date();
  const time = now.toLocaleTimeString('fr-FR', {
    timeZone: 'Asia/Shanghai',
    hour: '2-digit',
    minute: '2-digit',
  });
  const hour = Number(
    now.toLocaleString('en-GB', { timeZone: 'Asia/Shanghai', hour: '2-digit', hour12: false }),
  );
  return { time, open: hour >= 9 && hour < 18 };
}

$('compose-cancel')?.addEventListener('click', () => {
  $('compose').hidden = true;
});

$('compose-relay')?.addEventListener('click', () => {
  const text = $('compose-body').value.trim();
  // WhatsApp Web plutôt qu'un envoi silencieux : le numéro du fournisseur
  // appartient à sa fiche, et l'agent doit voir partir son message.
  window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
});

$('compose-send')?.addEventListener('click', async () => {
  const zone = $('compose');
  const text = $('compose-body').value.trim();
  const ticket = state.detail?.ticket;

  if (!text || !ticket) return;

  $('compose-send').disabled = true;
  try {
    if (zone.dataset.target === 'client') {
      await api('/api/emails', {
        method: 'POST',
        body: JSON.stringify({
          to: ticket.customerEmail,
          subject: `Re: ${ticket.subject ?? 'votre commande'}`,
          body: text,
        }),
      });
      toast('Message envoyé au client.');
    } else {
      await api(`/api/tickets/${ticket.id}/escalations`, {
        method: 'POST',
        // Le motif suit l'intention détectée : une rupture escalade autrement
        // qu'une adresse incomplète, et le service route d'après lui.
        body: JSON.stringify({
          reason:
            ticket.intent === 'RETURN' || ticket.intent === 'REFUND'
              ? 'MISSING_ITEM'
              : 'OTHER',
          note: text,
        }),
      });
      toast('Escalade envoyée au fournisseur.');
    }
    zone.hidden = true;
    await selectTicket(ticket.id);
  } catch (error) {
    toast(error.message, true);
  } finally {
    $('compose-send').disabled = false;
  }
});

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
  if (key === 'client') return openCompose('client', ticket);
  if (key === 'supplier') return openCompose('supplier', ticket);
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
    ['historical', 'historical'],
  ]) {
    $('queue-bar')
      .querySelector(`[data-quick="${id}"]`)
      .setAttribute('aria-pressed', String(Boolean(state.queue[key])));
  }

  $('q-reset').hidden = !queueIsFiltered();
  // « 25 affichés » sur 556 laissait croire que le reste était perdu. Le
  // total rend le rapport lisible, et le défilement fait le reste.
  const total = state.queueCounts?.ALL ?? null;
  $('q-count').textContent =
    total !== null && total > state.tickets.length
      ? `${state.tickets.length} sur ${total}`
      : `${state.tickets.length} affiché${state.tickets.length > 1 ? 's' : ''}`;
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

  // La liste vient du serveur, qui la calcule sur l'ensemble des tickets. La
  // déduire des cinquante lignes affichées donnait un menu qui changeait à
  // chaque tri et n'offrait jamais le filtre qu'on cherchait.
  const labels = state.queueLabels ?? [];

  const labelSelect = $('q-label');
  labelSelect.innerHTML =
    '<option value="">Tous</option>' +
    labels
      .map(
        (name) =>
          `<option value="${esc(name)}">${esc(
            name.includes('/') ? name.slice(name.lastIndexOf('/') + 1) : name,
          )}</option>`,
      )
      .join('');
  labelSelect.value = state.queue.label;
  labelSelect.closest('label').hidden = labels.length === 0;

  $('q-intent').innerHTML =
    '<option value="">Tous</option>' +
    Object.entries(INTENT_LABELS)
      .map(([key, label]) => `<option value="${key}">${esc(label)}</option>`)
      .join('');
}

function resetQueueFilters() {
  state.filter = '';
  state.queue = {
    q: '', intent: '', assignee: '', mailbox: '', label: '', sort: 'newest',
    urgent: false, unassigned: false, unlinked: false, historical: false,
  };

  $('q-search').value = '';
  $('q-mailbox').value = '';
  $('q-label').value = '';
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

$('q-label').addEventListener('change', (event) => {
  state.queue.label = event.target.value;
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

/*
 * Origine du ticket.
 *
 * Trois populations qui ne se traitent pas pareil : ce qu'écrit un client, ce
 * qui remonte d'un atelier, et ce qu'une banque conteste. Traduites en filtres
 * existants plutôt qu'en colonne de base : l'origine se déduit du motif et du
 * statut, la stocker une seconde fois créerait une vérité de plus à tenir.
 */
const ORIGIN_FILTERS = {
  client: { intent: '', status: '' },
  supplier: { intent: '', status: 'AWAITING_SUPPLIER' },
  dispute: { intent: 'DISPUTE', status: '' },
};

$('queue-bar').addEventListener('click', (event) => {
  const tab = event.target.closest('[data-origin]');
  if (tab) {
    const origin = tab.dataset.origin;
    state.queue.origin = origin;

    const rule = ORIGIN_FILTERS[origin] ?? { intent: '', status: '' };
    state.queue.intent = rule.intent;
    state.filter = rule.status;
    $('q-intent').value = rule.intent;

    $('queue-bar')
      .querySelectorAll('[data-origin]')
      .forEach((other) => other.setAttribute('aria-pressed', String(other === tab)));

    void loadQueue();
    return;
  }

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

  // « Historique appris » n'est pas un filtre de plus, c'est un autre corpus :
  // les échanges importés et le travail en cours ne cohabitent jamais dans la
  // même liste. Les mêler donnerait des compteurs impossibles à interpréter.
  if (key === 'historical' && state.queue.historical) {
    state.filter = '';
    state.queue.urgent = false;
    state.queue.unassigned = false;
    state.queue.unlinked = false;
    state.queue.assignee = '';
    $('q-assignee').value = '';
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

/**
 * Fiches déjà chargées, mises de côté au survol.
 *
 * Entre le moment où le curseur se pose sur une ligne et celui où le doigt
 * clique, il s'écoule à peu près le temps d'un aller-retour serveur. Le
 * dépenser à l'avance rend l'ouverture instantanée sans rien changer au reste :
 * c'est le gain de vitesse ressentie le moins cher qui existe.
 */
const prefetched = new Map();

function prefetchTicket(id) {
  if (!id || prefetched.has(id)) return;

  // On mémorise la promesse, pas le résultat : deux survols rapprochés ne
  // doivent déclencher qu'une requête.
  prefetched.set(
    id,
    api(`/api/tickets/${id}`).catch(() => {
      // Un échec de préchargement ne se signale pas : l'utilisateur n'a rien
      // demandé. Le clic refera la requête et affichera l'erreur si elle
      // persiste.
      prefetched.delete(id);
      return null;
    }),
  );

  // Le cache ne vit que le temps du survol suivant : un ticket rouvert dix
  // minutes plus tard doit être relu, son statut a pu changer.
  setTimeout(() => prefetched.delete(id), 30_000);
}

async function selectTicket(id) {
  state.currentId = id;

  // Retour visuel immédiat, avant toute requête : la ligne cliquée s'allume
  // tout de suite. Attendre le serveur pour déplacer une surbrillance donne
  // l'impression d'un clic perdu.
  document.querySelectorAll('.queue-item').forEach((item) => {
    item.setAttribute('aria-current', String(item.dataset.id === id));
  });

  const detail = (await prefetched.get(id)) ?? (await api(`/api/tickets/${id}`));

  // Un ticket supprimé entre l'affichage de la file et le clic renverrait une
  // réponse sans ticket : mieux vaut un message que l'écran blanc laissé par
  // une exception au milieu du rendu.
  if (!detail?.ticket) {
    toast('Ce ticket n’existe plus.', true);
    await loadQueue();
    return;
  }

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
  renderCannedChips();

  // Ticket d'une autre boutique en mode agrégé : consultable, pas traitable.
  // Griser les actions sans le dire donnerait l'impression d'une panne.
  const otherShop = Boolean(state.detail.readOnly);
  const shopLabel =
    state.shops.find((shop) => shop.id === ticket.merchantId)?.label ?? 'une autre boutique';

  $('read-only').hidden = !otherShop;
  if (otherShop) {
    $('read-only-text').textContent = `Ce ticket appartient à ${shopLabel}. Basculez sur cette boutique pour y répondre.`;
    $('read-only-switch').dataset.shop = ticket.merchantId;
  }

  for (const id of ['btn-send', 'btn-save', 'btn-refund', 'd-assignee']) {
    const el = $(id);
    if (el) el.disabled = otherShop || el.disabled;
  }

  $('actbar').hidden = $('actbar').hidden || otherShop;

  $('d-messages').innerHTML = ticket.messages
    .map(
      (message) => `<div class="msg${message.direction === 'OUTBOUND' ? ' out' : ''}">
        <div class="msg-head">
          <b>${esc(message.fromEmail)}</b>
          <span>${shortTime(message.receivedAt)}</span>
        </div>
        <div class="msg-body">${esc(message.bodyText)}</div>
        ${renderAttachments(message.attachments)}
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

/**
 * Résumé du message client, au-dessus du fil.
 *
 * Il vient de la même génération que le brouillon : demander deux fois au
 * modèle doublerait le coût et laisserait le résumé décrire un message que la
 * réponse n'a pas traité.
 */
/**
 * Pièces jointes d'un message client.
 *
 * Les images s'affichent, le reste se télécharge. Un client qui signale une
 * semelle décollée joint une photo : la lui redemander parce que l'outil ne
 * sait pas la montrer est la faute la plus visible qu'un SAV puisse commettre.
 */
function renderAttachments(files) {
  if (!files || files.length === 0) return '';

  const items = files
    .map((file) => {
      const url = `/api/attachments/${encodeURIComponent(file.id)}`;
      const isImage = (file.mimeType ?? '').startsWith('image/');

      if (isImage) {
        return `<a class="att att-img" href="${url}" target="_blank" rel="noopener"
                   title="${esc(file.filename)}">
          <img src="${url}" alt="${esc(file.filename)}" loading="lazy" />
        </a>`;
      }

      return `<a class="att att-file" href="${url}" target="_blank" rel="noopener">
        <span class="att-name">${esc(file.filename)}</span>
        <span class="att-size">${formatBytes(file.size)}</span>
      </a>`;
    })
    .join('');

  return `<div class="atts">${items}</div>`;
}

function formatBytes(size) {
  if (!size) return '';
  if (size < 1024) return `${size} o`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} Ko`;
  return `${(size / (1024 * 1024)).toFixed(1).replace('.', ',')} Mo`;
}

function renderBrief(draft) {
  const brief = $('d-brief');
  // Le repli n'a de sens qu'avec un fil dedans : affiché d'emblée, il proposait
  // de déplier le néant.
  $('d-fold').hidden = !state.detail?.ticket;
  const points = draft?.summary ?? [];
  const ask = draft?.ask ?? '';

  // Rien à montrer : on masque au lieu d'afficher un cadre vide, qui ferait
  // croire à une panne plutôt qu'à une absence.
  if (points.length === 0 && !ask) {
    brief.hidden = true;
    $('d-fold').open = true;
    return;
  }

  brief.hidden = false;
  // Le fil se replie dès qu'un résumé le remplace : c'est tout l'intérêt.
  $('d-fold').open = false;

  $('d-ask').textContent = ask;
  $('d-ask').hidden = !ask;
  $('d-summary').innerHTML = points.map((line) => `<li>${esc(line)}</li>`).join('');
}

function renderDraft(draft, ticket) {
  const zone = $('draft-zone');
  const none = $('no-draft');

  renderBrief(draft);

  // Un ticket en échec doit dire pourquoi, à l'endroit où l'on constate
  // l'absence de brouillon. Sans ça, « Échec » envoie lire les journaux du
  // serveur — c'est-à-dire que personne ne saura jamais.
  if (ticket.status === 'FAILED' && ticket.failureReason) {
    zone.hidden = true;
    none.hidden = false;
    $('no-draft-text').innerHTML =
      `<b class="set-alert">Le traitement a échoué.</b><br>` +
      `<span class="mono" style="font-size:12px">${esc(ticket.failureReason)}</span>`;
    return;
  }

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
    (fulfillment.trackingNumber
      ? `<div class="row"><span>Suivi</span><button class="linklike mono" data-track="${esc(
          fulfillment.trackingNumber,
        )}">${esc(fulfillment.trackingNumber)}</button></div>`
      : row('Suivi', '—')) +
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
  $('sup-f-access').value = supplier?.ordersAccess ?? 'ASSIGNED';
  describeSupplierAccess();
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

/*
 * « Tout le carnet » communique des noms, adresses et téléphones de clients à
 * un tiers : le choix doit être éclairé au moment où on le fait, pas découvert
 * après coup.
 */
const SUPPLIER_ACCESS_HELP = {
  ASSIGNED:
    'Seules les commandes escaladées vers lui ou dont il a saisi un colis. Recommandé.',
  ALL:
    'Il verra tous vos clients — noms, adresses, téléphones — y compris ceux qu’il ne prépare pas. À réserver au prestataire qui expédie réellement tout.',
  NONE: 'Il ne peut que répondre aux escalades. Aucun accès aux commandes.',
};

function describeSupplierAccess() {
  $('sup-f-access-help').textContent = SUPPLIER_ACCESS_HELP[$('sup-f-access').value] ?? '';
  $('sup-f-access-help').classList.toggle('set-alert', $('sup-f-access').value === 'ALL');
}

$('sup-f-access').addEventListener('change', describeSupplierAccess);

$('sup-new').addEventListener('click', () => openSupplierForm(null));
$('sup-f-cancel').addEventListener('click', () => $('supplier-modal').classList.remove('open'));
$('supplier-modal').addEventListener('click', (event) => {
  if (event.target === $('supplier-modal')) $('supplier-modal').classList.remove('open');
});

$('sup-f-save').addEventListener('click', async () => {
  const payload = {
    name: $('sup-f-name').value.trim(),
    contactEmail: $('sup-f-email').value.trim(),
    ordersAccess: $('sup-f-access').value,
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
          // « Actif » se lit comme « utilise l'outil » alors qu'il ne veut dire
          // que « pas désactivé ». Une invitation jamais honorée doit se voir :
          // c'est le symptôme d'un mail qui n'est pas arrivé.
          !user.active
            ? '<span class="tag tag-status st-NEW">Désactivé</span>'
            : user.lastLoginAt
              ? '<span class="tag tag-status st-CLOSED">Actif</span>'
              : '<span class="tag tag-status st-NEEDS_REVIEW">Invité</span>'
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
  // Le champ d'invitation ne sert qu'à la création ; sur un compte existant,
  // c'est le champ modifiable en dessous qui porte l'adresse.
  $('team-f-email').closest('.field').hidden = Boolean(user);
  $('team-f-email-row').hidden = !user;
  $('team-f-email-edit').value = user?.email ?? '';
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
      const payload = {
        name: $('team-f-name').value.trim() || null,
        email: $('team-f-email-edit').value.trim(),
      };
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

/* La période choisie vaut pour tout l'écran de statistiques. */
let statsDays = 30;

function money(value, currency) {
  return new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency: currency || 'EUR',
    maximumFractionDigits: value >= 1000 ? 0 : 2,
  }).format(value);
}

/**
 * Histogramme SVG, sans bibliothèque.
 *
 * Chaque barre porte son infobulle native (`<title>`) : jour, valeur exacte.
 * Une bibliothèque de graphiques apporterait le zoom et les légendes animées ;
 * pour trente barres et une lecture de tendance, elle n'apporterait que du
 * poids et une dépendance à surveiller.
 */
function svgBars(days, pick, format, options = {}) {
  const peak = Math.max(1, ...days.map(pick));
  const width = 100 / days.length;

  const bars = days
    .map((day, index) => {
      const value = pick(day);
      const height = Math.max(value > 0 ? 2 : 0, (value / peak) * 92);
      const label = new Date(day.day + 'T00:00:00').toLocaleDateString('fr-FR', {
        day: 'numeric',
        month: 'short',
      });
      return `<g>
        <title>${esc(label)} — ${esc(format(value))}</title>
        <rect x="${(index * width + width * 0.15).toFixed(2)}" y="${(100 - height).toFixed(2)}"
          width="${(width * 0.7).toFixed(2)}" height="${height.toFixed(2)}" rx="1"
          class="bar${options.soft ? ' bar-soft' : ''}" />
      </g>`;
    })
    .join('');

  // Repères horizontaux au quart : assez pour situer, pas assez pour rayer.
  const grid = [25, 50, 75]
    .map((y) => `<line x1="0" x2="100" y1="${y}" y2="${y}" class="chart-grid" />`)
    .join('');

  return `<svg class="chart" viewBox="0 0 100 100" preserveAspectRatio="none"
    role="img">${grid}${bars}</svg>
    <div class="chart-scale"><span>${esc(format(peak))}</span><span>0</span></div>`;
}

/** Répartition en barres horizontales : à sept catégories, plus lisible qu'un
    camembert — les angles proches se comparent mal, les longueurs bien. */
function intentBars(byIntent) {
  const rows = Object.entries(byIntent).sort((a, b) => b[1] - a[1]);
  if (rows.length === 0) return '<p class="empty">Aucune demande sur la période.</p>';

  const total = rows.reduce((sum, [, count]) => sum + count, 0);

  return rows
    .map(
      ([intent, count]) => `<div class="ibar">
        <span class="ibar-label">${esc(INTENT_LABELS[intent] ?? intent)}</span>
        <span class="ibar-track">
          <i class="ibar-fill in-${esc(intent)}" style="width:${((count / total) * 100).toFixed(1)}%"></i>
        </span>
        <span class="ibar-count mono">${count}</span>
      </div>`,
    )
    .join('');
}

async function loadStats() {
  // Les deux sources partent ensemble et échouent séparément : Shopify en
  // panne ne doit pas priver l'écran des chiffres d'équipe, ni l'inverse.
  const [stats, commerce] = await Promise.all([
    api(`/api/stats?days=${statsDays}`),
    api(`/api/stats/commerce?days=${statsDays}`).catch(() => null),
  ]);

  $('stats-range')
    .querySelectorAll('button')
    .forEach((button) => {
      button.setAttribute('aria-pressed', String(Number(button.dataset.days) === statsDays));
    });

  /* ------------------------------------------------ chiffres boutique --- */

  if (commerce) {
    const t = commerce.totals;
    $('commerce-kpis').innerHTML = [
      ['Chiffre d’affaires', money(t.revenue, commerce.currency), `${t.orders} commandes`],
      ['Panier moyen', money(t.averageOrder, commerce.currency), 'par commande'],
      [
        'Remboursé',
        money(t.refunded, commerce.currency),
        `${(t.refundRate * 100).toFixed(1).replace('.', ',')} % du CA`,
      ],
      ['À expédier', t.unfulfilled, t.cancelled ? `${t.cancelled} annulées` : 'commandes en attente'],
    ]
      .map(
        ([label, value, note]) => `<div class="kpi">
          <span class="kpi-label">${esc(String(label))}</span>
          <span class="kpi-value">${esc(String(value))}</span>
          <span class="kpi-note">${esc(String(note))}</span>
        </div>`,
      )
      .join('');

    $('chart-revenue').innerHTML = svgBars(
      commerce.days,
      (day) => day.revenue,
      (value) => money(value, commerce.currency),
    );
    $('ca-note').textContent =
      commerce.refundsViaTool.count > 0
        ? `${commerce.refundsViaTool.count} remboursement${commerce.refundsViaTool.count > 1 ? 's' : ''} via l’outil`
        : '';

    $('chart-orders').innerHTML = svgBars(
      commerce.days,
      (day) => day.orders,
      (value) => `${Math.round(value)} commande${value > 1 ? 's' : ''}`,
      { soft: true },
    );
  } else {
    $('commerce-kpis').innerHTML = '';
    $('chart-revenue').innerHTML =
      '<p class="empty">Shopify n’a pas répondu — les chiffres boutique reviendront avec lui.</p>';
    $('chart-orders').innerHTML = '<p class="empty">—</p>';
    $('ca-note').textContent = '';
  }

  $('chart-intents').innerHTML = intentBars(stats.tickets.byIntent);

  /* --------------------------------------------------------- équipe --- */

  $('stats-kpis').innerHTML = [
    ['Tickets reçus', stats.tickets.total, `${statsDays} derniers jours`],
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

$('stats-range').addEventListener('click', (event) => {
  const button = event.target.closest('[data-days]');
  if (!button) return;
  statsDays = Number(button.dataset.days);
  loadStats();
});

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
$('orders-xlsx').href = '/api/orders/export.xlsx?limit=250';
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
              shipment.trackingNumber
                ? `<button class="linklike" data-track="${esc(shipment.trackingNumber)}"${
                    shipment.trackingUrl ? ` data-track-url="${esc(shipment.trackingUrl)}"` : ''
                  }>${esc(shipment.trackingNumber)}</button>`
                : '—'
            }</td>
            <td>${
              shipment.liveStatus
                ? `<span class="tag ${
                    shipment.liveStatus === 'Delivered' ? 'st-CLOSED' : 'st-NEEDS_REVIEW'
                  }">${esc(TRACK_LABELS[shipment.liveStatus] ?? shipment.liveStatus)}</span>${
                    shipment.lastEvent
                      ? `<br><span class="sub">${esc(shipment.lastEvent.status)}${
                          shipment.lastEvent.location ? ` · ${esc(shipment.lastEvent.location)}` : ''
                        }</span>`
                      : ''
                  }`
                : esc([shipment.city, shipment.country].filter(Boolean).join(', ') || '—')
            }</td>
            <td>${
              shipment.trackingNumber
                ? `<button class="btn btn-small" data-track="${esc(shipment.trackingNumber)}"${
                    shipment.trackingUrl ? ` data-track-url="${esc(shipment.trackingUrl)}"` : ''
                  }>Chronologie</button>`
                : '—'
            }</td>
          </tr>`,
        )
        .join('') ||
      '<tr><td colspan="6" class="empty">Aucun colis en cours d’acheminement.</td></tr>';

    body.querySelectorAll('[data-track]').forEach((button) =>
      button.addEventListener('click', () =>
        void openTracking(button.dataset.track, button.dataset.trackUrl ?? null),
      ),
    );

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
  body.innerHTML = '<p class="empty">Chargement…</p>';

  let disputes;
  try {
    ({ disputes } = await api('/api/disputes'));
  } catch (error) {
    body.innerHTML = `<p class="empty">${esc(error.message)}</p>`;
    $('disputes-count').textContent = '';
    return;
  }

  if (disputes.length === 0) {
    body.innerHTML =
      '<p class="empty">Aucun litige. Si votre boutique n’utilise pas Shopify Payments, cet écran restera vide.</p>';
    $('disputes-count').textContent = '';
    return;
  }

  // Les plus urgents d'abord : un litige non contesté est débité d'office à
  // l'échéance, l'ordre de la liste est donc l'ordre de travail.
  disputes.sort((a, b) => (a.daysLeft ?? 999) - (b.daysLeft ?? 999));

  body.innerHTML = disputes
    .map((dispute) => {
      const urgent = dispute.daysLeft !== null && dispute.daysLeft <= 3;
      const deadline =
        dispute.daysLeft === null
          ? 'Aucune échéance annoncée'
          : dispute.daysLeft < 0
            ? `Échéance dépassée depuis ${-dispute.daysLeft} j — la banque a tranché`
            : `Réponse à Shopify avant le ${fullDate(dispute.evidenceDueBy)} · ${
                dispute.daysLeft
              } j restants`;

      // Preuve de livraison : ce que la banque attend, assemblé à partir des
      // colis déjà saisis plutôt que recopié à la main dans l'urgence.
      const evidence = dispute.evidence ?? [];
      const delivered = evidence.filter((item) => item.status === 'Delivered');

      return `<article class="dsp${urgent ? ' urgent' : ''}">
        <div class="dsp-head">
          <b class="mono">${esc(dispute.orderName ?? 'commande inconnue')}</b>
          <span class="tag tag-status ${
            dispute.status === 'NEEDS_RESPONSE' ? 'st-FAILED' : 'st-NEW'
          }">${esc(DISPUTE_STATUS[dispute.status] ?? dispute.status)}</span>
          <span class="mono dsp-amount">${esc(euro(dispute.amount, dispute.currency))}</span>
        </div>

        <div class="dsp-deadline${
          urgent || (dispute.daysLeft ?? 0) < 0 ? ' late' : ''
        }">${esc(deadline)}</div>

        <div class="dsp-reason">
          <span class="panel-title">Motif</span>
          ${esc(dispute.reason ?? '—')}${dispute.type ? ` · ${esc(dispute.type)}` : ''}
        </div>

        <section class="dsp-evidence">
          <span class="panel-title">Preuve de livraison</span>
          ${
            evidence.length
              ? evidence
                  .map(
                    (item) => `<div class="dsp-row">
                      <b>${item.index}/${item.total}</b>
                      <span class="mono">${esc(item.trackingNumber)}</span>
                      ${item.carrier ? `<span class="tag tag-order">${esc(item.carrier)}</span>` : ''}
                      <span class="tag ${
                        item.status === 'Delivered' ? 'st-CLOSED' : 'st-NEEDS_REVIEW'
                      }">${esc(TRACK_LABELS[item.status] ?? item.status ?? 'suivi indisponible')}</span>
                      ${
                        item.hasPhoto
                          ? `<a class="btn btn-small" href="/api/parcels/${esc(
                              item.parcelId,
                            )}/photo" target="_blank" rel="noopener">Photo</a>`
                          : ''
                      }
                    </div>`,
                  )
                  .join('')
              : `<p class="empty">Aucun colis rattaché à cette commande. Sans numéro de suivi,
                 il n'y a pas de preuve de livraison à produire — c'est le litige le plus
                 difficile à gagner.</p>`
          }
        </section>

        <div class="dsp-acts">
          <button class="btn btn-primary" data-dsp-copy="${esc(dispute.id)}"${
            evidence.length ? '' : ' disabled'
          }>Copier la preuve</button>
          <a class="btn" href="https://${esc(
            state.me?.merchant?.shopDomain ?? '',
          )}/admin/payments/disputes" target="_blank" rel="noopener">Répondre sur Shopify</a>
          ${
            delivered.length === evidence.length && evidence.length
              ? '<span class="hint">Tous les colis sont marqués livrés — dossier favorable.</span>'
              : ''
          }
        </div>
      </article>`;
    })
    .join('');

  $('disputes-count').textContent = `${disputes.length} litige${
    disputes.length > 1 ? 's' : ''
  }`;

  // Le dossier se colle dans le formulaire Shopify : l'API de soumission de
  // preuves n'est pas ouverte aux applications, seule l'administration le
  // permet. Autant préparer le texte exact plutôt que de laisser recopier.
  body.querySelectorAll('[data-dsp-copy]').forEach((button) =>
    button.addEventListener('click', async () => {
      const dispute = disputes.find((candidate) => candidate.id === button.dataset.dspCopy);

      const text = [
        `Commande ${dispute.orderName ?? ''} — ${euro(dispute.amount, dispute.currency)}`,
        '',
        'Preuve de livraison :',
        ...dispute.evidence.map(
          (item) =>
            `• Colis ${item.index}/${item.total} — ${item.trackingNumber}` +
            `${item.carrier ? ` (${item.carrier})` : ''} — ${
              TRACK_LABELS[item.status] ?? item.status ?? 'statut indisponible'
            }${item.deliveredAt ? `, livré le ${fullDate(item.deliveredAt)}` : ''}`,
        ),
      ].join('\n');

      try {
        await navigator.clipboard.writeText(text);
        toast('Preuve copiée — collez-la dans le formulaire Shopify.');
      } catch {
        prompt('Preuve à coller dans Shopify :', text);
      }
    }),
  );
}

const TRACK_LABELS = {
  NotFound: 'Introuvable chez le transporteur',
  InfoReceived: 'Pris en charge',
  InTransit: 'En transit',
  Expired: 'Suivi expiré',
  AvailableForPickup: 'À retirer',
  OutForDelivery: 'En cours de livraison',
  DeliveryFailure: 'Échec de livraison',
  Delivered: 'Livré',
  Exception: 'Incident',
};

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

/** Aiguilles ou chiffres — un goût, pas une vérité : mémorisé par navigateur. */
function clockStyle() {
  return localStorage.getItem('csav.clocks') === 'digital' ? 'digital' : 'analog';
}

function renderClocks() {
  const now = new Date();
  const digital = clockStyle() === 'digital';

  $('clocks').classList.toggle('clocks-digital', digital);

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
    const minute = now.getMinutes();
    const open = hour >= 9 && hour < 18;
    const title = `${city} — ${open ? 'heures ouvrées' : 'hors horaires (9 h – 18 h locales)'}`;

    // Numérique : l'écran d'une montre connectée — fond noir, chiffres
    // lumineux. La couleur dit l'état : vert joignable, ambre nuit.
    if (digital) {
      return `<div class="wface${open ? '' : ' shut'}" title="${esc(title)}">
        <b>${esc(city)}</b>
        <span class="wface-time">${time}</span>
      </div>`;
    }

    // Aiguilles : un cadran de manufacture. L'angle des secondes cale
    // l'animation continue — l'aiguille tourne vraiment, elle n'attend pas le
    // prochain rendu.
    const hourAngle = ((hour % 12) + minute / 60) * 30;
    const minuteAngle = minute * 6 + now.getSeconds() / 10;
    const secondsOffset = -(now.getSeconds() + now.getMilliseconds() / 1000);

    return `<div class="clock clock-${code}${open ? '' : ' shut'}" title="${esc(title)}">
      <span class="dial" aria-hidden="true">
        <i class="dial-ring"></i>
        <i class="dial-face"></i>
        <i class="dial-h" style="transform: rotate(${hourAngle}deg)"></i>
        <i class="dial-m" style="transform: rotate(${minuteAngle}deg)"></i>
        <i class="dial-s" style="animation-delay: ${secondsOffset}s"></i>
        <i class="dial-cap"></i>
      </span>
      <div>
        <b>${esc(city)}</b>
        <span class="clock-time">${time}</span>
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
  canned: { icon: 'inbox', label: 'Réponses types', group: 'Plateforme', title: 'Réponses types' },
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
          // Chaque écran qui accumule du retard porte son compte. Un chiffre
          // dans la navigation évite d'ouvrir un écran pour découvrir qu'il
          // n'y avait rien — et surtout d'en ignorer un qui déborde.
          const tally =
            view === 'tickets'
              ? (state.pendingCount ?? 0)
              : (state.navCounts?.[view] ?? 0);
          return `<button class="nav-item" data-view="${view}" aria-current="${
            view === state.view
          }">${ico(meta.icon)}<span class="nav-label">${esc(meta.label)}</span>${
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
  canned: () => loadCanned(),
  settings: () => openSettings(),
};

function setView(view) {
  state.view = view;
  const meta = VIEW_META[view];

  for (const name of VIEWS) {
    const el = $(`view-${name}`);
    if (el) el.hidden = name !== view;
  }

  // L'animation d'entrée ne joue qu'une fois par élément : pour qu'elle
  // accompagne chaque changement d'écran, on la relance en la retirant le
  // temps d'un cadre. Sans le `void offsetWidth`, le navigateur fusionne les
  // deux écritures et rien ne bouge.
  const title = $('view-title');
  title.style.animation = 'none';
  void title.offsetWidth;
  title.style.animation = '';
  title.textContent = meta.title;
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

  $('clock-seg')
    .querySelectorAll('button')
    .forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset.clockstyle === clockStyle()));
      button.onclick = () => {
        localStorage.setItem('csav.clocks', button.dataset.clockstyle);
        renderClocks();
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
    renderBrief(null);
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
function renderConnection(el, { label, connected, simulated, detail, actions, status: given }) {
  const dot = simulated ? 'warn' : connected ? '' : 'off';
  // L'état est fourni par l'appelant quand l'accord grammatical l'exige :
  // « Boîtes mail connecté » se lisait mal, et le pluriel dépend du nombre.
  const status = given ?? (simulated ? 'simulé' : connected ? 'connecté' : 'non connecté');

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
              <span class="poll-wrap">
                <select class="poll-days" data-mbx-days="${esc(mailbox.id)}"
                  title="Profondeur du rattrapage">
                  <option value="7">7 jours</option>
                  <option value="30">1 mois</option>
                  <option value="90">3 mois</option>
                  <option value="180">6 mois</option>
                </select>
                <button class="btn btn-small" data-mbx-poll="${esc(
                  mailbox.id,
                )}">Relever</button>
              </span>
              <button class="btn btn-small" data-mbx-diag="${esc(
                mailbox.id,
              )}">Diagnostic</button>
              <button class="btn btn-small" data-mbx-learn="${esc(
                mailbox.id,
              )}">Apprendre de l’historique</button>
              <button class="btn btn-small btn-danger" data-mbx-off="${esc(
                mailbox.id,
              )}">Débrancher</button>
            </div>
            <div class="mbx-learn" data-mbx-learn-state="${esc(mailbox.id)}"></div>
            <div class="mbx-diag" data-mbx-diag-state="${esc(mailbox.id)}"></div>
          </div>`,
        )
        .join('')
    : 'Aucune boîte connectée — rien n’est ingéré.';

  renderConnection($('set-gmail'), {
    label: boxes.length > 1 ? 'Boîtes mail' : 'Boîte mail',
    status: gmail.simulated
      ? 'simulée'
      : boxes.length === 0
        ? 'aucune'
        : `${boxes.length} connectée${boxes.length > 1 ? 's' : ''}`,
    connected: gmail.connected,
    simulated: gmail.simulated,
    detail: gmailDetail,
    // « Ajouter » et non « Reconnecter » : le même bouton sert aux deux, mais
    // c'est l'ajout qu'on cherche une fois la première boîte en place.
    actions: `<a class="btn btn-small${
      gmail.connected ? '' : ' btn-primary'
    }" href="/auth/google">${gmail.connected ? '＋ Ajouter une boîte' : 'Connecter Gmail'}</a>`,
  });

  // Relève manuelle : court-circuite Pub/Sub, Redis et le worker. Si elle
  // ramène du courrier que l'arrivée automatique n'avait pas vu, la panne est
  // dans cette chaîne-là, et le message le dit plutôt que de la laisser
  // chercher.
  $('set-gmail')
    .querySelectorAll('[data-mbx-poll]')
    .forEach((button) =>
      button.addEventListener('click', async () => {
        // L'état s'écrit dans la carte, pas seulement sur le bouton : un
        // libellé qui change sur une puce de douze pixels passe inaperçu, et
        // l'attente ressemble alors à un clic sans effet.
        const node = button.closest('.mbx')?.querySelector('[data-mbx-diag-state]');
        if (node) node.textContent = 'Relève en cours — cela peut prendre une minute…';

        button.disabled = true;
        const previous = button.textContent;
        button.textContent = 'Relève…';

        const id = button.dataset.mbxPoll;
        const days = Number(
          button.closest('.mbx')?.querySelector('[data-mbx-days]')?.value ?? 7,
        );

        try {
          const result = await api(`/api/mailboxes/${id}/poll`, {
            method: 'POST',
            body: JSON.stringify({ days }),
          });

          // Au-delà d'une semaine, le serveur rend la main tout de suite et
          // travaille derrière : on suit l'avancement au lieu d'attendre.
          if (result.started) {
            watchBackfill(id, node, button, previous);
            return;
          }

          const message =
            result.ingested > 0
              ? `${result.ingested} message${result.ingested > 1 ? 's' : ''} relevé${
                  result.ingested > 1 ? 's' : ''
                }, ${result.ticketIds.length} ticket${
                  result.ticketIds.length > 1 ? 's' : ''
                } dans la file.`
              : 'Rien à relever : les 7 derniers jours sont déjà dans la file. ' +
                'Le courrier plus ancien s’importe avec « Apprendre de l’historique ».';

          if (node) node.textContent = message;
          toast(message);

          if (result.ingested > 0) await loadQueue();
        } catch (error) {
          if (node) node.innerHTML = `<b class="set-alert">${esc(error.message)}</b>`;
          toast(error.message, true);
        } finally {
          button.disabled = false;
          button.textContent = previous;
        }
      }),
    );

  // Diagnostic : ce que Gmail contient, ce que la base en a. L'écart nomme
  // l'étage en panne.
  $('set-gmail')
    .querySelectorAll('[data-mbx-diag]')
    .forEach((button) =>
      button.addEventListener('click', async () => {
        // Ligne propre au diagnostic : partager celle de l'apprentissage
        // ferait effacer le rapport au prochain rafraîchissement du compteur.
        const node = button
          .closest('.mbx')
          ?.querySelector('[data-mbx-diag-state]');
        if (node) node.textContent = 'Diagnostic en cours…';

        try {
          const report = await api(`/api/mailboxes/${button.dataset.mbxDiag}/diagnose`);
          if (node) node.innerHTML = renderDiagnosis(report);
        } catch (error) {
          if (node) node.textContent = error.message;
        }
      }),
    );

  // Apprentissage : jamais déclenché tout seul, jamais sur toutes les boîtes.
  // C'est le marchand qui désigne celle dont les réponses font référence — une
  // adresse branchée pour des essais n'a rien à apprendre à l'IA.
  $('set-gmail')
    .querySelectorAll('[data-mbx-learn]')
    .forEach((button) =>
      button.addEventListener('click', async () => {
        const id = button.dataset.mbxLearn;
        const address = button.closest('.mbx')?.querySelector('code')?.textContent ?? '';

        if (
          !confirm(
            `Analyser les 6 derniers mois de ${address} ?\n\n` +
              'Les échanges déjà traités serviront de modèle de ton à l’IA. ' +
              'Ils restent invisibles dans la file et dans les statistiques.',
          )
        ) {
          return;
        }

        button.disabled = true;
        try {
          await api(`/api/mailboxes/${id}/learn`, { method: 'POST', body: '{}' });
          toast('Apprentissage lancé — ça tourne en arrière-plan.');
          pollLearning();
        } catch (error) {
          button.disabled = false;
          toast(error.message, true);
        }
      }),
    );

  void refreshLearning();

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
        if (
          !confirm(
            'Débrancher cette boîte ?\n\n' +
              'L’autorisation Google est révoquée : l’outil perd tout accès à cette ' +
              'adresse. Les tickets déjà reçus sont conservés.',
          )
        ) {
          return;
        }

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
  $('set-playbook').value = merchant.playbook ?? '';
  $('set-sla').value = String(merchant.slaHours ?? 24);
  renderLogoPreview(merchant);
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

/* Repère de modification : sans lui, on ne sait pas si l'on a déjà enregistré,
   et l'on quitte l'écran en perdant sa saisie. */
const SETTINGS_FIELDS = [
  'set-brand',
  'set-logo',
  'set-tracking',
  'set-autosend',
  'set-threshold',
  'set-retention',
  'set-playbook',
  'set-sla',
];

function markSettingsDirty() {
  $('set-dirty').textContent = 'Modifications non enregistrées.';
  $('set-dirty').classList.add('dirty');
}

for (const id of SETTINGS_FIELDS) {
  $(id).addEventListener('input', markSettingsDirty);
  $(id).addEventListener('change', markSettingsDirty);
}

/**
 * Reprend les politiques publiques de la boutique dans le playbook.
 *
 * Les règles existent déjà, écrites et publiées : les retaper à la main
 * garantit qu'elles divergeront au premier changement de politique de retour.
 * On propose, on n'écrase pas : le playbook peut contenir des consignes que
 * Shopify ne connaît pas.
 */
$('set-policies').addEventListener('click', async () => {
  const button = $('set-policies');
  const current = $('set-playbook').value.trim();

  if (
    current &&
    !confirm(
      'Remplacer le contenu actuel par vos politiques Shopify ?\n\n' +
        'Ce que vous avez écrit à la main sera perdu.',
    )
  ) {
    return;
  }

  button.disabled = true;
  try {
    const { playbook, sections } = await api('/api/settings/policies');

    if (!playbook) {
      toast('Aucune politique publiée sur la boutique.', true);
      return;
    }

    $('set-playbook').value = playbook;
    markSettingsDirty();
    toast(
      `${sections} politique${sections > 1 ? 's' : ''} reprise${sections > 1 ? 's' : ''} — relisez, puis enregistrez.`,
    );
  } catch (error) {
    toast(error.message, true);
  } finally {
    button.disabled = false;
  }
});

$('set-threshold').addEventListener('input', (event) => {
  $('set-threshold-echo').textContent = `${Math.round(Number(event.target.value) * 100)} %`;
});

$('set-save').addEventListener('click', async () => {
  try {
    const { merchant } = await api('/api/settings', {
      method: 'PATCH',
      body: JSON.stringify({
        brandName: $('set-brand').value.trim() || null,
        playbook: $('set-playbook').value.trim() || null,
        slaHours: Number($('set-sla').value),
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

    $('set-dirty').textContent = 'Réglages enregistrés.';
    $('set-dirty').classList.remove('dirty');
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

/**
 * État de l'apprentissage, affiché sous chaque boîte.
 *
 * L'import tourne côté serveur bien après la réponse HTTP : sans ce retour, le
 * marchand cliquerait, ne verrait rien, et recliquerait.
 */
/**
 * Traduit le bilan en phrases, pas en champs bruts.
 *
 * Un rapport technique déposé à l'écran laisse au lecteur le travail de
 * conclure. Ce qu'on veut savoir tient en une ligne : est-ce que du courrier
 * manque, et si oui à quel étage.
 */
function renderDiagnosis(report) {
  const lines = [];

  if (report.tokenValid === false) {
    lines.push(
      `<b class="set-alert">Autorisation perdue.</b> Gmail refuse l’accès à cette boîte — ` +
        `débranchez-la et reconnectez-la. (${esc(report.error ?? '')})`,
    );
    return lines.join('<br>');
  }

  lines.push(
    `Boîte lisible · ${report.totalMessages ?? '—'} messages au total, ` +
      `${report.inboxLast7Days}${report.truncated ? ' ou plus' : ''} reçus de tiers ` +
      'dans les 7 derniers jours.',
  );

  if (report.missing > 0) {
    lines.push(
      `<b class="set-alert">${report.missing} message${report.missing > 1 ? 's' : ''} ` +
        `absent${report.missing > 1 ? 's' : ''} de la file.</b> ` +
        'Cliquez « Relever maintenant » pour les faire entrer.',
    );
  } else {
    lines.push('Tout le courrier récent est bien dans la file.');
  }

  // Les libellés dits par leur nom : « je ne vois pas mes libellés » se règle
  // en regardant si Gmail en expose, plutôt qu'en cherchant un défaut qui
  // n'existe peut-être pas.
  if (Array.isArray(report.labels)) {
    lines.push(
      report.labels.length > 0
        ? `Libellés Gmail vus : ${report.labels.map(labelChip).join(' ')}`
        : '<b class="set-alert">Aucun libellé personnel dans cette boîte.</b> ' +
          'Les catégories de Google (Promotions, Réseaux sociaux…) ne comptent pas : ' +
          'seules vos propres étiquettes sont reprises.',
    );
  }

  if (!report.watchActive) {
    lines.push(
      '<b class="set-alert">Écoute inactive.</b> Le courrier n’arrivera pas tout ' +
        'seul : reconnectez cette boîte.',
    );
  }

  return lines.join('<br>');
}

/**
 * Suit un rattrapage parti en arrière-plan.
 *
 * Le compte monte pendant que le travail avance : sans ce retour, trois mois
 * de courrier ressembleraient à un bouton sans effet pendant plusieurs
 * minutes — exactement le défaut qu'on vient de corriger ailleurs.
 */
/**
 * Résultat d'un rattrapage, en phrases.
 *
 * « 0 message sur 1500 examinés » se lit comme un échec alors que c'est le
 * signe que tout était déjà là. Chaque chiffre n'apparaît que s'il dit
 * quelque chose, et le rapport se termine par la conclusion plutôt que par
 * des nombres à interpréter.
 */
function backfillSummary(progress) {
  const parts = [`${progress.scanned} messages examinés.`];

  if (progress.ingested > 0) {
    parts.push(
      `<b>${progress.ingested} message${progress.ingested > 1 ? 's' : ''} ajouté${
        progress.ingested > 1 ? 's' : ''
      }</b> à la file.`,
    );
    parts.push(
      `${progress.tickets} ticket${progress.tickets > 1 ? 's' : ''} soumis à l’IA — ` +
        'le classement et les résumés arrivent au fil du traitement.',
    );
  } else {
    parts.push('Aucun nouveau — tout ce courrier était déjà dans la file.');
  }

  if (progress.relabelled > 0) {
    parts.push(
      `${progress.relabelled} ticket${progress.relabelled > 1 ? 's' : ''} réétiqueté${
        progress.relabelled > 1 ? 's' : ''
      } depuis Gmail.`,
    );
  } else {
    parts.push(
      'Aucun libellé trouvé : ces messages ne portent pas d’étiquette dans Gmail.',
    );
  }

  if (progress.labelError) {
    parts.push(
      `<b class="set-alert">Libellés non posés :</b> ${esc(progress.labelError)}`,
    );
  }

  if (progress.capped) {
    parts.push(
      '<b class="set-alert">Plafond atteint</b> — il reste du courrier au-delà. ' +
        'Relancez : la reprise continue là où celle-ci s’est arrêtée.',
    );
  }

  return parts.join('<br>');
}

function watchBackfill(mailboxId, node, button, previousLabel) {
  let elapsed = 0;

  const tick = async () => {
    let progress;
    try {
      progress = await api(`/api/mailboxes/${mailboxId}/backfill`);
    } catch {
      progress = null;
    }

    if (progress) {
      node.innerHTML = progress.done
        ? backfillSummary(progress)
        : `Rattrapage… ${progress.scanned} messages examinés, ${progress.ingested} relevés.`;
    }

    elapsed += 3;

    if (progress?.done || elapsed > 900) {
      button.disabled = false;
      button.textContent = previousLabel;
      if (progress?.ingested > 0) await loadQueue();
      return;
    }

    setTimeout(tick, 3000);
  };

  setTimeout(tick, 1500);
}

async function refreshLearning() {
  let data;
  try {
    data = await api('/api/learning');
  } catch {
    return false;
  }

  const running = new Set(data.running ?? []);

  document.querySelectorAll('[data-mbx-learn-state]').forEach((node) => {
    const id = node.dataset.mbxLearnState;
    const button = document.querySelector(`[data-mbx-learn="${CSS.escape(id)}"]`);
    if (button) button.disabled = running.has(id);

    // Le compte de *cette* boîte, pas le total : afficher le même nombre sous
    // chacune ferait croire que toutes ont été analysées.
    const learned = data.byMailbox?.[id] ?? 0;

    node.textContent = running.has(id)
      ? 'Analyse en cours…'
      : learned > 0
        ? `${learned} échange${learned > 1 ? 's' : ''} appris`
        : '';
  });

  return running.size > 0;
}

/** Relance la lecture d'état tant qu'un import tourne, puis s'arrête. */
function pollLearning() {
  let elapsed = 0;

  const tick = async () => {
    const stillRunning = await refreshLearning();
    elapsed += 5;
    // Cinq minutes : au-delà, l'import a fini ou a échoué, et le journal
    // serveur le dira mieux qu'une horloge qui tourne dans le vide.
    if (stillRunning && elapsed < 300) setTimeout(tick, 5000);
  };

  setTimeout(tick, 5000);
}

async function patchMailbox(id, body) {
  try {
    await api(`/api/mailboxes/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
    toast('Boîte mise à jour.');
    await openSettings();
  } catch (error) {
    toast(error.message, true);
  }
}

/* --------------------------------------------------------- réponses types */

/**
 * Réponses types.
 *
 * Cinq questions font les deux tiers du volume : où est mon colis, mauvaise
 * taille, douane, changement d'adresse, retour. Faire rédiger l'IA à chaque
 * fois pour un texte inchangé depuis six mois coûte du temps et de l'argent —
 * et l'agent relit quand même.
 */
async function loadCanned() {
  const data = await api('/api/canned-replies');
  state.canned = data.replies ?? [];
  renderCanned();
  renderCannedChips();
}

function renderCanned() {
  $('canned-count').textContent = state.canned.length
    ? `${state.canned.length} réponse${state.canned.length > 1 ? 's' : ''} type${
        state.canned.length > 1 ? 's' : ''
      }`
    : '';

  $('canned-list').innerHTML = state.canned.length
    ? state.canned
        .map(
          (item) => `<article class="dsp" data-canned="${esc(item.id)}" style="cursor:pointer">
            <div class="dsp-head">
              <b>${esc(item.title)}</b>
              ${
                item.intent
                  ? `<span class="tag in-${item.intent}">${esc(
                      INTENT_LABELS[item.intent] ?? item.intent,
                    )}</span>`
                  : '<span class="tag tag-order">tous motifs</span>'
              }
              <span class="dsp-amount mono">${item.useCount} ×</span>
            </div>
            <div class="dsp-reason">${esc(item.body.slice(0, 220))}${
              item.body.length > 220 ? '…' : ''
            }</div>
          </article>`,
        )
        .join('')
    : `<p class="empty">
         Aucune réponse type. Commencez par les cinq questions qui reviennent :
         où est ma commande, mauvaise taille, frais de douane, changement
         d'adresse, retour.
       </p>`;

  $('canned-list')
    .querySelectorAll('[data-canned]')
    .forEach((card) =>
      card.addEventListener('click', () => openCannedForm(card.dataset.canned)),
    );
}

function openCannedForm(id) {
  const item = id ? state.canned.find((candidate) => candidate.id === id) : null;
  state.editingCanned = item?.id ?? null;

  $('canned-title').textContent = item ? item.title : 'Nouvelle réponse type';
  $('canned-f-title').value = item?.title ?? '';
  $('canned-f-body').value = item?.body ?? '';

  $('canned-f-intent').innerHTML =
    '<option value="">Tous les motifs</option>' +
    Object.entries(INTENT_LABELS)
      .map(
        ([key, label]) =>
          `<option value="${key}"${key === item?.intent ? ' selected' : ''}>${esc(label)}</option>`,
      )
      .join('');

  $('canned-f-delete').hidden = !item;
  $('canned-modal').hidden = false;
  $('canned-modal').classList.add('open');
}

$('canned-new').addEventListener('click', () => openCannedForm(null));
function closeCannedModal() {
  const modal = $('canned-modal');
  modal.classList.remove('open');
  // `hidden` en plus de la classe : c'est lui qui garantit que la fenêtre
  // reste invisible même si la règle d'affichage venait à manquer. Écrite avec
  // une classe qui n'existait pas dans la feuille de style, cette fenêtre
  // s'affichait au bas de tous les écrans.
  modal.hidden = true;
}

$('canned-f-cancel').addEventListener('click', closeCannedModal);

$('canned-modal').addEventListener('click', (event) => {
  if (event.target === $('canned-modal')) closeCannedModal();
});

$('canned-f-save').addEventListener('click', async () => {
  const payload = {
    title: $('canned-f-title').value.trim(),
    body: $('canned-f-body').value.trim(),
    intent: $('canned-f-intent').value || null,
  };

  if (!payload.title || !payload.body) {
    toast('Un titre et un message sont nécessaires.', true);
    return;
  }

  try {
    if (state.editingCanned) {
      await api(`/api/canned-replies/${state.editingCanned}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      });
    } else {
      await api('/api/canned-replies', { method: 'POST', body: JSON.stringify(payload) });
    }

    closeCannedModal();
    toast('Réponse type enregistrée.');
    await loadCanned();
  } catch (error) {
    toast(error.message, true);
  }
});

$('canned-f-delete').addEventListener('click', async () => {
  if (!state.editingCanned) return;
  if (!confirm('Supprimer cette réponse type ?')) return;

  try {
    await api(`/api/canned-replies/${state.editingCanned}`, { method: 'DELETE' });
    closeCannedModal();
    toast('Réponse type supprimée.');
    await loadCanned();
  } catch (error) {
    toast(error.message, true);
  }
});

/** Puces d'insertion au-dessus du brouillon, motif du ticket en tête. */
function renderCannedChips() {
  const ticket = state.detail?.ticket;
  const bar = $('canned-bar');

  if (!ticket || state.canned.length === 0) {
    bar.hidden = true;
    return;
  }

  const sorted = [...state.canned].sort((a, b) => {
    const matchA = a.intent === ticket.intent ? 1 : 0;
    const matchB = b.intent === ticket.intent ? 1 : 0;
    return matchB - matchA || b.useCount - a.useCount;
  });

  bar.hidden = false;
  $('canned-chips').innerHTML = sorted
    .slice(0, 6)
    .map(
      (item) => `<button class="qchip" data-insert="${esc(item.id)}"${
        item.intent === ticket.intent ? ' aria-pressed="true"' : ''
      }>${esc(item.title)}</button>`,
    )
    .join('');
}

$('canned-chips').addEventListener('click', async (event) => {
  const button = event.target.closest('[data-insert]');
  if (!button) return;

  const item = state.canned.find((candidate) => candidate.id === button.dataset.insert);
  const ticket = state.detail?.ticket;
  if (!item || !ticket) return;

  const order = state.detail?.order;

  // Variables résolues à l'insertion : un modèle qui laisse « {{prenom}} »
  // dans le texte envoyé est pire que pas de modèle du tout.
  const filled = item.body
    .replaceAll('{{prenom}}', (ticket.customerName ?? '').split(' ')[0] ?? '')
    .replaceAll('{{commande}}', ticket.orderName ?? '')
    .replaceAll('{{suivi}}', order?.fulfillments?.[0]?.trackingNumber ?? '')
    .replaceAll('{{boutique}}', state.me?.merchant?.brandName ?? state.me?.merchant?.name ?? '');

  const body = $('d-body');
  body.value = body.value.trim() ? `${body.value.trim()}\n\n${filled}` : filled;
  body.focus();

  // Le compteur classe la liste : les réponses les plus utilisées remontent
  // sans que personne n'ait à ranger.
  await api(`/api/canned-replies/${item.id}/used`, { method: 'POST' }).catch(() => {});
  toast('Réponse insérée — à relire avant envoi.');
});

/* ------------------------------------------------------ identité de marque */

/** Ce qui doit s'afficher dans la pastille : image téléversée, URL, initiales. */
function brandLogoSrc(merchant) {
  if (merchant?.hasLogo) {
    // Horodatage en suffixe : sans lui, le navigateur ressert l'ancienne image
    // après un remplacement, et on croit que l'envoi a échoué.
    return `/api/branding/logo?v=${encodeURIComponent(merchant.logoUpdatedAt ?? Date.now())}`;
  }
  return merchant?.logoUrl || null;
}

function renderLogoPreview(merchant, pending = null) {
  const src = pending ?? brandLogoSrc(merchant);
  const img = $('set-logo-img');

  $('set-logo-initials').textContent = (merchant?.brandName || merchant?.name || 'SA')
    .slice(0, 2)
    .toUpperCase();

  if (src) {
    img.src = src;
    img.hidden = false;
    // Une URL cassée ne doit pas laisser un carré vide : on retombe sur les
    // initiales, comme dans la barre latérale.
    img.onerror = () => {
      img.hidden = true;
    };
  } else {
    img.hidden = true;
  }

  $('set-logo-clear').hidden = !(merchant?.hasLogo || pending);
}

/** Réduit le logo avant l'envoi : 256 px suffisent partout où il s'affiche. */
async function shrinkLogo(file) {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(256, Math.max(bitmap.width, bitmap.height));

  const canvas = document.createElement('canvas');
  canvas.width = side;
  canvas.height = side;

  const context = canvas.getContext('2d');
  // Recadrage centré : un logo rectangulaire déformé est pire qu'un logo rogné.
  const crop = Math.min(bitmap.width, bitmap.height);
  context.drawImage(
    bitmap,
    (bitmap.width - crop) / 2,
    (bitmap.height - crop) / 2,
    crop,
    crop,
    0,
    0,
    side,
    side,
  );
  bitmap.close?.();

  return canvas.toDataURL('image/png');
}

let pendingLogo;

$('set-logo-file').addEventListener('change', async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;

  try {
    pendingLogo = await shrinkLogo(file);
    renderLogoPreview(state.settings?.merchant, pendingLogo);
    $('set-brand-note').textContent = 'Image prête — cliquez sur Appliquer.';
  } catch {
    toast('Image illisible — essayez un PNG ou un JPEG.', true);
  }
});

$('set-logo-clear').addEventListener('click', () => {
  pendingLogo = null;
  renderLogoPreview({ ...state.settings?.merchant, hasLogo: false, logoUrl: null });
  $('set-brand-note').textContent = 'Logo retiré — cliquez sur Appliquer.';
});

/**
 * Enregistre l'identité seule.
 *
 * Séparé du bouton général : changer un logo est un geste isolé, avec un
 * résultat qu'on veut voir tout de suite en haut de la barre latérale.
 */
$('set-brand-apply').addEventListener('click', async () => {
  $('set-brand-apply').disabled = true;

  try {
    const body = {
      brandName: $('set-brand').value.trim() || null,
      logoUrl: $('set-logo').value.trim() || null,
    };

    if (pendingLogo !== undefined) body.logo = pendingLogo;

    const { merchant } = await api('/api/settings', {
      method: 'PATCH',
      body: JSON.stringify(body),
    });

    pendingLogo = undefined;
    state.me.merchant = { ...state.me.merchant, ...merchant };
    renderMe();
    renderLogoPreview(merchant);

    $('set-brand-note').textContent = 'Identité mise à jour.';
    toast('Identité mise à jour.');
    await openSettings();
  } catch (error) {
    toast(error.message, true);
  } finally {
    $('set-brand-apply').disabled = false;
  }
});

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

  // Sans attendre : les couleurs enrichissent l'affichage, elles ne le
  // conditionnent pas. Un Gmail lent ne doit pas retarder l'ouverture.
  void loadLabelStyles();

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

/* ==========================================================================
   VOIR EN TANT QUE
   ==========================================================================

   Un propriétaire doit pouvoir constater ce que voit un agent. Décrire les
   droits dans un tableau ne remplace jamais l'écran : on découvre autrement
   qu'un bouton reste visible mais désactivé, ou qu'une colonne entière
   disparaît.

   La simulation ne descend jamais qu'en dessous du rôle réel — le serveur s'en
   assure, l'interface ne fait que proposer. */

const AS_LABELS = {
  OWNER: 'Propriétaire',
  SUPERVISOR: 'Superviseur',
  AGENT: 'Agent',
  VIEWER: 'Observateur',
};

async function setPreviewRole(role) {
  try {
    await api('/api/preview-role', {
      method: 'POST',
      body: JSON.stringify({ role: role || null }),
    });
    // Rechargement complet : les droits changent côté serveur, et rejouer
    // seulement l'écran courant laisserait les autres vues dans l'état
    // d'avant, avec des boutons que le serveur refuse désormais.
    location.reload();
  } catch (error) {
    toast(error.message, true);
  }
}

function renderPreviewBar() {
  const bar = $('asbar');
  if (!bar) return;

  const previewing = Boolean(state.me?.previewing);
  bar.hidden = !previewing;

  if (previewing) {
    const shown = AS_LABELS[state.me.user.role] ?? state.me.user.role;
    const real = AS_LABELS[state.me.realRole] ?? state.me.realRole;
    $('asbar-text').textContent =
      `Vous utilisez l'outil comme un ${shown.toLowerCase()}. Votre rôle réel est ${real.toLowerCase()}.`;
  }

  document.querySelectorAll('#as-role [data-as]').forEach((button) => {
    const active = (button.dataset.as || '') === (previewing ? state.me.user.role : '');
    button.setAttribute('aria-pressed', String(active));
  });

  const note = $('as-note');
  if (note) {
    note.textContent = previewing
      ? 'La simulation s’arrête d’elle-même au bout de deux heures.'
      : `Vous êtes ${(AS_LABELS[state.me?.realRole] ?? '—').toLowerCase()}.`;
  }
}

document.querySelectorAll('#as-role [data-as]').forEach((button) =>
  button.addEventListener('click', () => setPreviewRole(button.dataset.as)),
);

$('asbar-exit')?.addEventListener('click', () => setPreviewRole(''));

// Un rôle plus large que le sien n'est pas proposé : le serveur le refuserait
// silencieusement, et un bouton sans effet est pire qu'un bouton absent.
function trimPreviewChoices() {
  const rank = { OWNER: 3, SUPERVISOR: 2, AGENT: 1, VIEWER: 0 };
  const mine = rank[state.me?.realRole] ?? 0;
  document.querySelectorAll('#as-role [data-as]').forEach((button) => {
    const target = button.dataset.as;
    button.hidden = Boolean(target) && (rank[target] ?? 0) >= mine;
  });
}

$('as-supplier')?.addEventListener('click', () => {
  setView('suppliers');
  toast('Ouvrez « Espace de travail » sur un contact pour voir son écran.');
});

/* ==========================================================================
   CLAVIER
   ==========================================================================

   Ce qui distingue un outil qu'on subit d'un outil qu'on pilote. Un agent qui
   traite cent tickets fait cent allers-retours souris entre la liste et la
   réponse ; au clavier il ne quitte jamais la position de frappe.

   Le jeu de touches est celui que les outils de messagerie ont imposé — J/K
   pour parcourir, Entrée pour ouvrir, ⌘Entrée pour envoyer. Les réinventer
   n'aurait servi qu'à les faire apprendre. */

function typingSomewhere() {
  const tag = document.activeElement?.tagName ?? '';
  return /^(INPUT|TEXTAREA|SELECT)$/.test(tag) || document.activeElement?.isContentEditable;
}

/** Déplace la sélection dans la file, en la gardant à l'écran. */
function moveQueue(step) {
  const items = [...document.querySelectorAll('#queue .queue-item')];
  if (items.length === 0) return;

  const current = items.findIndex((item) => item.dataset.id === state.currentId);
  // Aucun ticket ouvert : la première frappe prend le premier de la liste
  // plutôt que le second, qui serait le voisin d'un point de départ imaginaire.
  const next = current === -1 ? 0 : Math.min(items.length - 1, Math.max(0, current + step));

  const target = items[next];
  if (!target) return;

  target.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  selectTicket(target.dataset.id);
}

document.addEventListener('keydown', (event) => {
  // ⌘K ouvre la recherche depuis n'importe où, y compris depuis un champ :
  // c'est le geste qui doit toujours répondre.
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    if ($('pal').hidden) openPalette();
    else closePalette();
    return;
  }

  // ⌘Entrée envoie la réponse depuis la zone de rédaction. Sans lui, écrire se
  // termine toujours par un aller-retour à la souris.
  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
    if (document.activeElement === $('d-body') && !$('btn-send').disabled) {
      event.preventDefault();
      $('btn-send').click();
    }
    return;
  }

  if (typingSomewhere() || event.altKey || event.metaKey || event.ctrlKey) return;
  if (state.view !== 'tickets') return;

  switch (event.key) {
    case 'j':
    case 'ArrowDown':
      event.preventDefault();
      moveQueue(1);
      break;
    case 'k':
    case 'ArrowUp':
      event.preventDefault();
      moveQueue(-1);
      break;
    case 'r':
      // Répondre : le curseur va dans le brouillon, prêt à corriger.
      if (!$('draft-zone').hidden) {
        event.preventDefault();
        $('d-body').focus();
      }
      break;
    case 'e':
      // Déplier ou replier le fil, quand le résumé ne suffit pas.
      event.preventDefault();
      $('d-fold').open = !$('d-fold').open;
      break;
    case '?':
      event.preventDefault();
      $('keys').hidden = !$('keys').hidden;
      break;
    case 'Escape':
      $('keys').hidden = true;
      break;
    default:
      break;
  }
});

/* ==========================================================================
   AGIR, PUIS POUVOIR REVENIR
   ==========================================================================

   Une boîte « êtes-vous sûr ? » demande de réfléchir au pire moment : avant
   d'avoir vu le résultat. Elle interrompt tout le monde à chaque fois pour
   éviter l'erreur d'une fois sur cent, et on finit par la valider sans la lire
   — ce qui la rend inutile en plus d'être pénible.

   L'inverse coûte moins et protège mieux : agir tout de suite, montrer le
   résultat, laisser six secondes pour revenir en arrière. */

/** Message avec bouton d'annulation, à la place du bandeau ordinaire. */
function toastUndo(message, undo) {
  const el = $('toast');
  el.textContent = '';
  el.classList.remove('error');

  const text = document.createElement('span');
  text.textContent = message;

  const button = document.createElement('button');
  button.className = 'toast-undo';
  button.textContent = 'Annuler';
  button.addEventListener('click', async () => {
    button.disabled = true;
    try {
      await undo();
      toast('Annulé.');
    } catch (error) {
      toast(error.message, true);
    }
  });

  el.append(text, button);
  el.classList.add('show');

  clearTimeout(el._timer);
  // Six secondes plutôt que quatre : le temps de lire, de comprendre que ce
  // n'était pas le bon ticket, et d'atteindre le bouton.
  el._timer = setTimeout(() => {
    el.classList.remove('show');
    el.textContent = '';
  }, 6000);
}

const SNOOZE_CHOICES = [
  { hours: 4, label: 'Cet après-midi' },
  { hours: 24, label: 'Demain' },
  { hours: 72, label: 'Dans 3 jours' },
  { hours: 168, label: 'La semaine prochaine' },
];

async function snoozeTicket(hours, label) {
  const id = state.currentId;
  if (!id) return;

  try {
    const result = await api(`/api/tickets/${id}/snooze`, {
      method: 'PATCH',
      body: JSON.stringify({ hours }),
    });

    // La file se recharge tout de suite : le ticket disparaît, ce qui est la
    // preuve visible que l'action a porté.
    await loadQueue();

    toastUndo(`En veille — ${label.toLowerCase()}.`, async () => {
      await api(`/api/tickets/${id}/snooze`, {
        method: 'PATCH',
        // On restitue l'état d'avant, pas « aucune veille » : un ticket déjà
        // endormi qu'on rendort par erreur doit retrouver sa date initiale.
        body: JSON.stringify({
          hours: result.previous
            ? Math.max(
                1,
                Math.round((new Date(result.previous) - Date.now()) / 3_600_000),
              )
            : null,
        }),
      });
      await loadQueue();
    });
  } catch (error) {
    toast(error.message, true);
  }
}

function renderSnoozeMenu() {
  const menu = $('snooze-menu');
  if (!menu) return;

  menu.innerHTML = SNOOZE_CHOICES.map(
    (choice) =>
      `<button type="button" data-h="${choice.hours}">${choice.label}</button>`,
  ).join('');

  menu.querySelectorAll('button').forEach((button) =>
    button.addEventListener('click', () => {
      menu.hidden = true;
      const choice = SNOOZE_CHOICES.find((c) => String(c.hours) === button.dataset.h);
      snoozeTicket(choice.hours, choice.label);
    }),
  );
}

$('btn-snooze')?.addEventListener('click', () => {
  const menu = $('snooze-menu');
  menu.hidden = !menu.hidden;
  if (!menu.hidden) renderSnoozeMenu();
});

document.addEventListener('click', (event) => {
  const menu = $('snooze-menu');
  if (!menu || menu.hidden) return;
  if (!event.target.closest('.snooze-wrap')) menu.hidden = true;
});

/* ==========================================================================
   PALETTE DE COMMANDES
   ==========================================================================

   ⌘K ne se contentait plus de placer le curseur dans la recherche : elle
   exécute. Un outil dense finit toujours par cacher ses fonctions derrière
   trois niveaux de menu ; la palette rend chacune atteignable en trois
   lettres, sans avoir à se rappeler où elle se range.

   Les commandes indisponibles ne sont pas listées : proposer « Rembourser »
   à qui n'en a pas le droit ne renseigne personne. */

function buildCommands() {
  const list = [];

  for (const [view, meta] of Object.entries(VIEW_META)) {
    list.push({
      label: `Aller à ${meta.title}`,
      hint: 'Navigation',
      run: () => setView(view),
    });
  }

  const hasTicket = Boolean(state.currentId && state.detail?.ticket);

  if (hasTicket && canI('reply')) {
    for (const choice of SNOOZE_CHOICES) {
      list.push({
        label: `Mettre en veille — ${choice.label.toLowerCase()}`,
        hint: 'Ticket courant',
        run: () => snoozeTicket(choice.hours, choice.label),
      });
    }
    list.push({
      label: 'Écrire la réponse',
      hint: 'Ticket courant',
      run: () => $('d-body').focus(),
    });
  }

  if (hasTicket && canI('refund') && state.detail.ticket.shopifyOrderId) {
    list.push({
      label: 'Rembourser cette commande',
      hint: 'Ticket courant',
      run: () => $('btn-refund').click(),
    });
  }

  list.push(
    { label: 'Actualiser', hint: 'Écran', run: () => refreshCurrent() },
    {
      label: 'Basculer clair / sombre',
      hint: 'Apparence',
      run: () => {
        // On lit le thème appliqué plutôt que la préférence enregistrée :
        // en mode « Système », c'est ce qu'on voit qu'on veut inverser.
        const dark = document.documentElement.getAttribute('data-theme') === 'dark';
        $('theme-seg')
          ?.querySelector(`[data-theme="${dark ? 'light' : 'dark'}"]`)
          ?.click();
      },
    },
    {
      label: 'Afficher les raccourcis',
      hint: 'Aide',
      run: () => { $('keys').hidden = false; },
    },
  );

  return list;
}

let paletteItems = [];
let paletteIndex = 0;

function openPalette() {
  paletteItems = buildCommands();
  paletteIndex = 0;

  $('pal').hidden = false;
  $('pal-input').value = '';
  $('pal-input').focus();
  renderPalette('');
}

function closePalette() {
  $('pal').hidden = true;
}

/**
 * Filtre par sous-séquence plutôt que par sous-chaîne : « alcom » trouve
 * « Aller à Commandes ». C'est ce qui permet de taper trois lettres au lieu du
 * libellé exact, et c'est tout l'intérêt d'une palette.
 */
function fuzzyMatch(needle, haystack) {
  if (!needle) return true;
  const text = haystack.toLowerCase();
  let index = 0;
  for (const char of needle.toLowerCase()) {
    index = text.indexOf(char, index);
    if (index === -1) return false;
    index += 1;
  }
  return true;
}

function renderPalette(query) {
  const matches = paletteItems.filter((item) => fuzzyMatch(query, item.label));
  paletteIndex = Math.min(paletteIndex, Math.max(0, matches.length - 1));

  $('pal-list').innerHTML = matches.length
    ? matches
        .map(
          (item, index) => `<li>
            <button class="pal-item" data-i="${index}" aria-selected="${index === paletteIndex}">
              <span>${esc(item.label)}</span>
              <small>${esc(item.hint)}</small>
            </button>
          </li>`,
        )
        .join('')
    : '<li class="empty" style="padding:14px">Aucune commande.</li>';

  $('pal-list')
    .querySelectorAll('.pal-item')
    .forEach((button) =>
      button.addEventListener('click', () => {
        closePalette();
        matches[Number(button.dataset.i)]?.run();
      }),
    );

  $('pal-list')._matches = matches;
}

$('pal-input')?.addEventListener('input', (event) => {
  paletteIndex = 0;
  renderPalette(event.target.value.trim());
});

$('pal-input')?.addEventListener('keydown', (event) => {
  const matches = $('pal-list')._matches ?? [];

  if (event.key === 'ArrowDown') {
    event.preventDefault();
    paletteIndex = Math.min(matches.length - 1, paletteIndex + 1);
    renderPalette(event.target.value.trim());
  } else if (event.key === 'ArrowUp') {
    event.preventDefault();
    paletteIndex = Math.max(0, paletteIndex - 1);
    renderPalette(event.target.value.trim());
  } else if (event.key === 'Enter') {
    event.preventDefault();
    closePalette();
    matches[paletteIndex]?.run();
  } else if (event.key === 'Escape') {
    closePalette();
  }
});

$('pal')?.addEventListener('click', (event) => {
  if (event.target === $('pal')) closePalette();
});

/* Tout numéro de suivi de l'application ouvre la même chronologie : la
   délégation attrape ceux rendus après coup — fiche client, rail du ticket,
   panneau colis — sans qu'aucun rendu n'ait à câbler son écouteur. Les lignes
   du tableau Suivi gardent le leur, posé avant celui-ci ; le double appel est
   évité en ne traitant ici que ce qui n'est pas déjà câblé. */
document.addEventListener('click', (event) => {
  const button = event.target.closest('.linklike[data-track]');
  if (!button || button.closest('#tracking-rows')) return;
  void openTracking(button.dataset.track, button.dataset.trackUrl ?? null);
});
