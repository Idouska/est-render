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
    q: '', intent: '', assignee: '', mailbox: '', labels: [], sort: 'newest',
    urgent: false, unassigned: false, unlinked: false, historical: false,
    dueSoon: false, bigAmount: false, timer: null,
  },
  queueCounts: {},
  /* Messages cochés dans la file. Un Set et non un tableau : on teste
     l'appartenance à chaque ligne rendue, cinquante fois par rafraîchissement. */
  picked: new Set(),
  /* Tableau ou liste, mémorisé : c'est une habitude de travail, pas un
     réglage qu'on repose chaque matin. */
  queueView: localStorage.getItem('csav.queueView') === 'table' ? 'table' : 'list',
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

/** Date + heure : sur les commandes, l'heure sert à trancher les litiges. */
function dateTime(iso) {
  if (!iso) return '';
  return `${fullDate(iso)} à ${shortTime(iso)}`;
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
    renderLabelChips();
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

/**
 * Libellés Gmail en boutons, sur la file.
 *
 * Ils vivaient dans un menu déroulant réduit à « Tous » : autant dire nulle
 * part. Ce sont pourtant les catégories que le marchand a créées lui-même —
 * « Chargeback », « Out of stock », « Wismo » — et elles disent mieux que
 * n'importe quel motif deviné ce qu'il y a à faire.
 *
 * Seuls les libellés réellement portés par un ticket sont proposés. Lister
 * tout ce que Gmail connaît remplissait la barre des étiquettes privées du
 * compte — Doctolib, Impôts, EDF — qui ne filtrent rien ici et n'ont aucune
 * raison de s'afficher dans un outil de SAV. Gmail ne fournit plus que la
 * couleur ; c'est la file qui décide de la liste.
 */
function renderLabelChips() {
  const list = $('q-labels-list');
  if (!list) return;

  const used = new Set(state.queueLabels ?? []);
  // Un libellé coché reste proposé même si le filtre en cours vide la file :
  // sinon la ligne qu'on vient de cocher disparaîtrait sous le doigt, et on ne
  // pourrait plus la décocher.
  for (const name of state.queue.labels) used.add(name);

  const names = [...used].sort((a, b) => a.localeCompare(b, 'fr'));
  $('qm-labels').hidden = names.length === 0;

  const needle = ($('q-labels-q').value ?? '').trim().toLowerCase();
  // La recherche ne masque jamais un libellé coché : le menu doit toujours
  // montrer l'intégralité de ce qui filtre la file en dessous.
  const shown = needle
    ? names.filter(
        (name) => name.toLowerCase().includes(needle) || state.queue.labels.includes(name),
      )
    : names;

  // Onze libellés tiennent dans le champ de recherche du menu ; la barre, elle,
  // n'a jamais eu la place. Le point de couleur suffit ici : les lignes sont
  // alignées et lues de haut en bas, pas reconnues de loin.
  list.innerHTML = shown.length
    ? shown
        .map((name) => {
          const style = labelStyles[name];
          const active = state.queue.labels.includes(name);
          const leaf = name.includes('/') ? name.slice(name.lastIndexOf('/') + 1) : name;
          const dot = style?.background
            ? ` style="background:${esc(style.background)}"`
            : ' style="background:var(--line)"';

          return `<button type="button" class="qpop-item" data-label="${esc(name)}"
            aria-pressed="${active}" title="${esc(name)}"><span class="qpop-box"
            aria-hidden="true"></span><span class="qpop-dot"${dot} aria-hidden="true"></span>${esc(
              leaf,
            )}</button>`;
        })
        .join('')
    : '<p class="qpop-empty">Aucun libellé ne correspond.</p>';

  const count = state.queue.labels.length;
  const badge = $('q-labels-n');
  badge.hidden = count === 0;
  badge.textContent = String(count);
  $('q-labels-btn').setAttribute('aria-pressed', String(count > 0));
}

$('q-labels-list')?.addEventListener('click', (event) => {
  const item = event.target.closest('[data-label]');
  if (!item) return;

  // Un second clic retire le libellé : c'est le geste attendu d'une case.
  const name = item.dataset.label;
  const picked = state.queue.labels;
  state.queue.labels = picked.includes(name)
    ? picked.filter((other) => other !== name)
    : [...picked, name];

  // Le menu reste ouvert : on coche rarement un seul libellé, et le refermer à
  // chaque clic obligerait à le rouvrir pour le suivant.
  void loadQueue();
});

$('q-labels-q')?.addEventListener('input', renderLabelChips);

/*
 * Les deux menus de la barre.
 *
 * Un seul ouvert à la fois, refermé au clic dehors et à Échap. Rien de plus :
 * un menu qui reste ouvert derrière un autre laisse deux listes de cases à
 * cocher à l'écran et on ne sait plus laquelle filtre quoi.
 */
const QUEUE_MENUS = [
  ['q-labels-btn', 'q-labels-pop'],
  ['q-filters-btn', 'q-filters-pop'],
];

function closeQueueMenus(except = null) {
  for (const [buttonId, popId] of QUEUE_MENUS) {
    if (popId === except) continue;
    $(popId).hidden = true;
    $(buttonId).setAttribute('aria-expanded', 'false');
  }
}

for (const [buttonId, popId] of QUEUE_MENUS) {
  $(buttonId)?.addEventListener('click', () => {
    const open = $(popId).hidden;
    closeQueueMenus(open ? popId : null);
    $(popId).hidden = !open;
    $(buttonId).setAttribute('aria-expanded', String(open));
    if (open && popId === 'q-labels-pop') $('q-labels-q').focus();
  });
}

document.addEventListener('click', (event) => {
  if (!event.target.closest('.qmenu')) closeQueueMenus();
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeQueueMenus();
});

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

  // Jamais l'identifiant technique : « owner@rjd8fe-… » n'est le nom de
  // personne. À défaut d'un prénom renseigné (écran Équipe), la boutique
  // elle-même — c'est le propriétaire, la maison parle pour lui.
  const who =
    me.user?.name ||
    (me.user?.role === 'OWNER' ? me.merchant?.brandName || me.merchant?.name : null) ||
    me.user?.email ||
    '—';
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
          <small>${esc((shop.shopDomain ?? '').replace('.myshopify.com', '') || '—')}${
            // La route mono-boutique ne renvoie ni domaine ni rôle : la ligne
            // reste lisible au lieu de faire tomber tout le menu — et le boot
            // avec lui.
            shop.role ? ` · ${esc(ROLE_LABELS[shop.role] ?? shop.role)}` : ''
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

  // Traités sur la fenêtre, d'après la date de traitement — et non celle du
  // dernier message du client, qui faisait afficher zéro à qui venait d'en
  // clore cinquante.
  $('kpi-done').textContent = String(metrics.handled ?? 0);
  $('kpi-done-note').textContent =
    metrics.sent > 0
      ? `dont ${metrics.sent} réponse${metrics.sent > 1 ? 's' : ''} envoyée${
          metrics.sent > 1 ? 's' : ''
        }`
      : 'clos ou répondus';

  $('kpi-pending').textContent = String(metrics.pending ?? 0);
  state.pendingCount = metrics.pending ?? 0;
  renderNav();
  $('kpi-pending-note').textContent = `${counts.NEEDS_REVIEW ?? 0} à valider · ${
    counts.DRAFT_READY ?? 0
  } prêts`;

  // Aucun brouillon : « — » et non « 0 % ». Un zéro se lit comme un échec,
  // alors qu'il n'y a rien à mesurer.
  $('kpi-rate').textContent =
    metrics.automationRate === null || metrics.automationRate === undefined
      ? '—'
      : `${Math.round(metrics.automationRate * 100)} %`;

  /*
   * Quatrième indicateur : ce qui n'est pas passé.
   *
   * « Envoi automatique : Inactif » occupait la place la plus visible de
   * l'écran pour répéter un réglage qui ne change jamais, pendant que trois
   * mille cinq cents messages en échec n'apparaissaient nulle part. Un
   * indicateur doit dire ce qu'on ignore, pas ce qu'on sait déjà.
   */
  const failed = metrics.failed ?? 0;
  $('kpi-failed').textContent = String(failed);
  $('kpi-failed').classList.toggle('set-alert', failed > 0);
  $('kpi-failed-note').textContent = failed > 0 ? 'à relancer' : 'tout est passé';
}

/**
 * Messages restés d'une boîte débranchée.
 *
 * Ils n'ont plus de carte : « Effacer ses messages » vit sur la boîte, et la
 * boîte a disparu. Sans ce bandeau, du courrier privé — banque, santé,
 * abonnements — reste dans la file sans aucun geste pour l'en sortir.
 */
async function renderOrphans() {
  const box = $('mbx-orphans');
  if (!box) return;

  let count = 0;
  try {
    count = (await api('/api/tickets/orphans')).count ?? 0;
  } catch {
    return;
  }

  box.hidden = count === 0;
  if (count === 0) return;

  box.innerHTML =
    `<b class="set-alert">${count} message${count > 1 ? 's' : ''}</b> ` +
    `${count > 1 ? 'proviennent' : 'provient'} d’une boîte débranchée. ` +
    `<button class="btn btn-small btn-danger" id="orphans-purge">Les effacer</button>`;

  $('orphans-purge').addEventListener('click', async () => {
    if (
      !confirm(
        `Effacer ${count} message${count > 1 ? 's' : ''} venus de boîtes débranchées ?\n\n` +
          'Les brouillons et pièces jointes partent avec eux. Irréversible.',
      )
    ) {
      return;
    }

    const button = $('orphans-purge');
    button.disabled = true;
    try {
      const result = await api('/api/tickets/orphans', { method: 'DELETE' });
      toast(`${result.removed} message${result.removed > 1 ? 's' : ''} effacé${
        result.removed > 1 ? 's' : ''
      }.`);
      box.hidden = true;
      await loadQueue();
    } catch (error) {
      toast(error.message, true);
      button.disabled = false;
    }
  });
}

/* -------------------------------------------------------- file de tickets */

/** Ancienneté en jours depuis la dernière prise de parole. */
function ageInDays(iso) {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
}

function ageChip(iso) {
  // Jamais négatif : une horloge serveur en avance de quelques minutes
  // affichait « -1 jours » sur des messages tout frais.
  const days = Math.max(0, ageInDays(iso));
  // Trois paliers seulement : au-delà, la couleur ne se lit plus comme une
  // échelle mais comme une décoration.
  const level = days >= 7 ? 'late' : days >= 3 ? 'warm' : 'fresh';
  // Les messages du jour affichent l'heure : sur une file où tout est
  // « aujourd'hui », le jour ne trie plus rien, l'heure si.
  const label =
    days === 0
      ? shortTime(iso)
      : days === 1
        ? `hier ${shortTime(iso)}`
        : `${days} jours`;
  return `<span class="age age-${level}" title="${esc(dateTime(iso))}">${label}</span>`;
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
  // Plusieurs libellés à la fois, séparés par des virgules : le serveur les
  // traite en « au moins l'un d'eux ». Deux catégories voisines — « Refund » et
  // « Litige » — se regardent ensemble ou ne se regardent pas.
  if (f.labels.length) params.set('label', f.labels.join(','));
  if (state.allShops) params.set('scope', 'all');
  if (f.sort !== 'newest') params.set('sort', f.sort);
  if (f.urgent) params.set('minAgeDays', '3');
  if (f.unassigned) params.set('assignee', 'none');
  if (f.unlinked) params.set('unlinked', 'true');
  if (f.historical) params.set('historical', 'true');
  // « Litiges à échéance » restreint au motif et à l'ancienneté : c'est ce que
  // recouvre l'expression — un litige qui traîne, pas un litige quelconque.
  if (f.dueSoon) {
    params.set('intent', 'DISPUTE');
    params.set('minAgeDays', '2');
  }
  if (f.bigAmount) params.set('minAmount', '100');

  return params;
}

function queueIsFiltered() {
  const f = state.queue;
  return Boolean(
    state.filter || f.q.trim() || f.intent || f.assignee || f.mailbox || f.labels.length ||
      f.urgent || f.unassigned || f.unlinked || f.historical || f.dueSoon || f.bigAmount,
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

  /*
   * Un changement de filtre annule la sélection.
   *
   * Cocher trente messages, changer d'onglet, puis cliquer « Marquer résolu »
   * refermerait trente messages qu'on ne voit plus. Le rafraîchissement
   * automatique, lui, ne touche à rien : la signature des filtres n'a pas
   * bougé, la sélection reste.
   */
  const signature = params.toString().replace(/&?cursor=[^&]*/, '');
  if (!append && state.queueSignature && state.queueSignature !== signature) {
    state.picked.clear();
  }
  state.queueSignature = signature;

  const data = await api(`/api/tickets?${params}`);

  state.queueCursor = data.nextCursor ?? null;
  state.tickets = append ? [...state.tickets, ...data.tickets] : data.tickets;
  state.queueCounts = data.counts ?? {};
  state.queueLabels = data.labels ?? state.queueLabels ?? [];

  // Compteurs de la navigation, dérivés des mêmes chiffres que la file : deux
  // sources donneraient deux vérités, et c'est celle qu'on ne regarde pas qui
  // finirait par mentir.
  void checkFailures();

  state.navCounts = {
    ...state.navCounts,
    disputes: state.disputeCount ?? 0,
    changes: state.changesPending ?? 0,
    suppliers: state.supplierActivity?.total ?? state.navCounts?.suppliers ?? 0,
  };
  void refreshChangesCount();
  renderNav();
  renderQueueBar();

  if (state.tickets.length === 0) {
    // Un écran vide doit dire pourquoi il est vide : « aucun ticket » et
    // « aucun ticket qui corresponde aux filtres » appellent des gestes
    // opposés.
    list.innerHTML = queueIsFiltered()
      ? `<li class="empty" style="padding:16px 14px">
           Aucun message ne correspond à ces filtres.
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

      // La case vit hors du bouton : un contrôle imbriqué dans un bouton n'est
      // pas cliquable au clavier et avale le clic de la souris une fois sur
      // deux. Elle est en position absolue par-dessus, la ligne garde sa
      // surface cliquable pleine.
      return `<li class="qrow${state.picked.has(ticket.id) ? ' picked' : ''}">
        <label class="qpick" title="Sélectionner">
          <input type="checkbox" data-pick="${ticket.id}"${
            state.picked.has(ticket.id) ? ' checked' : ''
          } />
        </label>
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

  if (state.queueView === 'table') renderQueueTable(multiMailbox, shopById);

  bindPickers();
  renderBulk();

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

  const { totals, customer, orders, tickets, refunds, parcels, returns, shopifyError } = data;
  if (customer?.displayName) $('sheet-name').textContent = customer.displayName;

  const money = (value) => euro(value, totals.currency ?? 'EUR');

  const sections = [];

  sections.push(`<div class="sheet-stats">
    <div class="sheet-stat"><b>${totals.orders}</b><span>Commandes</span></div>
    <div class="sheet-stat"><b>${esc(money(totals.spent))}</b><span>Dépensé</span></div>
    <div class="sheet-stat"><b>${totals.openTickets}/${totals.tickets}</b><span>Messages ouverts</span></div>
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
    'Messages',
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

  // Les retours : la preuve au dossier. Raison, souhait du client, trajet du
  // colis, photo — tout ce qu'on cite dans un litige.
  if (returns?.length) {
    sections.push(group(
      'Retours',
      returns.map(
        (item) => `<div class="sheet-row">
          <b>${esc(item.productTitle)}${
            item.variantTitle ? ` · ${esc(item.variantTitle)}` : ''
          }</b>
          <span class="tag tag-order">${esc(item.orderName ?? '—')}</span>
          <span class="ret-tag dim">${esc(RETURN_REASONS[item.reason] ?? item.reason)}</span>
          <span class="ret-tag ${item.resolution === 'REFUND' ? 'warn' : 'ok'}">${esc(
            RETURN_RESOLUTIONS[item.resolution] ?? item.resolution,
          )}</span>
          <span class="ret-tag ${
            ['RESTOCKED', 'CLOSED'].includes(item.status)
              ? 'ok'
              : item.status === 'UNUSABLE'
                ? 'bad'
                : 'dim'
          }">${esc(RETURN_STATUSES[item.status] ?? item.status)}</span>
          ${
            item.trackingNumber
              ? `<a class="linklike mono" href="${esc(trackUrl(item.trackingNumber))}"
                  target="_blank" rel="noopener">${esc(item.trackingNumber)}</a>`
              : ''
          }
          ${
            item.hasPhoto
              ? `<a class="btn btn-small" href="/api/returns/${esc(
                  item.id,
                )}/photo" target="_blank" rel="noopener">Photo</a>`
              : ''
          }
          <span class="when">${relativeTime(item.createdAt)}</span>
        </div>`,
      ),
      '',
    ));
  }

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
  WISMO: ['tracking', 'client', 'change', 'supplier'],
  RETURN: ['change', 'client', 'supplier', 'refund'],
  DISPUTE: ['refund', 'client', 'supplier'],
  REFUND: ['refund', 'client'],
  PRODUCT_QUESTION: ['change', 'substitute', 'client', 'supplier'],
  POSITIVE: ['client'],
  OTHER: ['client', 'change', 'supplier', 'refund'],
};

const ACTION_META = {
  substitute: { label: 'Proposer un remplacement', note: 'Le client garde sa commande, on remplace la référence indisponible.' },
  refund: { label: 'Rembourser…', note: 'Irréversible : l’argent repart chez le client immédiatement.' },
  client: { label: 'Écrire au client', note: 'Message direct, hors brouillon proposé.' },
  supplier: { label: 'Écrire au fournisseur', note: 'Ouvre une escalade suivie, avec relance automatique.' },
  tracking: { label: 'Voir le suivi', note: 'Position du colis d’après le transporteur.' },
  change: {
    label: '⚡ Demander un changement',
    note: 'Taille, couleur, modèle, adresse — le fournisseur confirme depuis son atelier.',
  },
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

/*
 * Clore sans répondre.
 *
 * Tout ne se règle pas par un mail : une notification de plateforme, un
 * doublon, un client déjà satisfait. Sans ce geste, ces tickets restent dans la
 * file et l'on finit par ne plus la croire.
 */
$('compose-resolve')?.addEventListener('click', async () => {
  const ticket = state.detail?.ticket;
  if (!ticket) return;

  try {
    const result = await api(`/api/tickets/${ticket.id}/resolve`, {
      method: 'POST',
      body: '{}',
    });

    $('compose').hidden = true;
    await loadQueue();

    // Annulable : refermer par erreur un ticket qui attendait un fournisseur
    // doit se défaire, et une confirmation préalable aurait ralenti les
    // quatre-vingt-dix-neuf fois où le geste est juste.
    toastUndo('Message clos.', async () => {
      await api(`/api/tickets/${ticket.id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status: result.previousStatus }),
      });
      await loadQueue();
    });
  } catch (error) {
    toast(error.message, true);
  }
});

/* « Nouvelle escalade » : ouvre la rédaction fournisseur sur le ticket courant.
   Le bouton ne paraît que là où il a un objet — un ticket ouvert. */
$('new-escalation')?.addEventListener('click', () => {
  const ticket = state.detail?.ticket;
  if (!ticket) return;
  $('actbar').hidden = false;
  openCompose('supplier', ticket);
  $('compose-body').scrollIntoView({ block: 'center', behavior: 'smooth' });
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
      const { escalation } = await api(`/api/tickets/${ticket.id}/escalations`, {
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

      /*
       * Créer PUIS envoyer : la création ne fait qu'un brouillon.
       *
       * Sans ce second appel, l'escalade restait en brouillon pour toujours —
       * le fournisseur ne recevait rien, le ticket ne passait pas « Chez le
       * fournisseur », l'écran Fournisseurs restait vide, et le toast
       * « envoyée » mentait. L'agent vient d'écrire son message lui-même :
       * il n'y a rien à relire, l'envoi suit immédiatement.
       */
      await api(`/api/escalations/${escalation.id}/send`, { method: 'POST', body: '{}' });
      toast('Escalade envoyée au fournisseur — le ticket passe « Chez le fournisseur ».');
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
    if (!ticket.shopifyOrderId) return 'Aucune commande rattachée à ce message.';
  }
  if ((key === 'substitute' || key === 'tracking') && !ticket.shopifyOrderId) {
    return 'Aucune commande rattachée à ce message.';
  }
  if (key === 'supplier' && !canI('escalate')) return 'Votre rôle ne permet pas d’escalader.';
  if (key === 'change') {
    if (!canI('escalate')) return 'Votre rôle ne permet pas d’escalader.';
    if (activeSuppliers().length === 0) return 'Aucun fournisseur actif à qui adresser la demande.';
  }
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
  if (key === 'change') return openChangeRequest(ticket);
});

/**
 * Demande de changement adressée au fournisseur, depuis le mail du client.
 *
 * C'est le chemin naturel : le client écrit « finalement la 45 », et la
 * demande part de là — avec sa commande, son article et sa déclinaison
 * actuelle déjà remplis. Retaper tout cela dans l'écran Fournisseurs, c'est
 * la garantie qu'on ne le fera pas, ou qu'on se trompera de commande.
 */
function openChangeRequest(ticket) {
  const order = state.detail?.order;

  $('alert-modal').dataset.supplier = '';
  $('alert-modal').dataset.ticket = ticket.id;
  $('alert-modal').dataset.order = order?.id ?? '';
  $('alert-who').textContent = order?.name
    ? `Commande ${order.name} · ${ticket.customerName ?? ticket.customerEmail}`
    : (ticket.customerName ?? ticket.customerEmail);

  state.alertCtx = alertContextFromOrder(order);
  setAlertKind('SIZE');
  $('alert-order').value = order?.name ?? ticket.orderName ?? '';
  $('alert-message').value = '';

  renderAlertSuppliers();
  $('alert-modal').hidden = false;
  $('alert-modal').classList.add('open');
  $('alert-after').focus();
}

/** Le fournisseur destinataire : celui par défaut d'abord, il traite le gros. */
function renderAlertSuppliers() {
  const pick = $('alert-supplier');
  if (!pick) return;

  const usable = activeSuppliers();
  const preselect = $('alert-modal').dataset.supplier;

  pick.innerHTML = usable
    .map(
      (supplier) =>
        `<option value="${esc(supplier.id)}"${
          supplier.id === preselect || (!preselect && supplier.isDefault) ? ' selected' : ''
        }>${esc(supplier.name)}</option>`,
    )
    .join('');
}

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
  WISMO: 'WISMO',
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
    ['dueSoon', 'dueSoon'],
    ['bigAmount', 'bigAmount'],
  ]) {
    $('queue-bar')
      .querySelector(`[data-quick="${id}"]`)
      .setAttribute('aria-pressed', String(Boolean(state.queue[key])));
  }

  // La pastille WISMO filtre par motif, pas par statut : elle s'allume et se
  // compte à part — c'est la question n°1 de la boîte, elle a droit à son
  // bouton.
  const wismo = $('chip-wismo');
  if (wismo) {
    wismo.setAttribute('aria-pressed', String(state.queue.intent === 'WISMO'));
    wismo.innerHTML = `WISMO<span class="count">${counts.WISMO ?? 0}</span>`;
  }

  renderLabelChips();

  /*
   * Le compteur du bouton « Filtres ».
   *
   * Il porte tout ce que le menu referme sur lui. Sans ce nombre, un raccourci
   * coché la veille vide la file le lendemain sans que rien ne l'explique —
   * c'est le seul défaut sérieux d'un menu, et il se corrige d'un chiffre.
   */
  const f = state.queue;
  const active =
    [f.urgent, f.unassigned, f.unlinked, f.historical, f.dueSoon, f.bigAmount].filter(Boolean)
      .length +
    [f.intent, f.assignee && f.assignee !== 'none' ? f.assignee : '', f.mailbox].filter(Boolean)
      .length;

  const badge = $('q-filters-n');
  badge.hidden = active === 0;
  badge.textContent = String(active);
  $('q-filters-btn').setAttribute('aria-pressed', String(active > 0));

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

  $('q-intent').innerHTML =
    '<option value="">Tous</option>' +
    Object.entries(INTENT_LABELS)
      .map(([key, label]) => `<option value="${key}">${esc(label)}</option>`)
      .join('');
}

function resetQueueFilters() {
  state.filter = '';
  state.queue = {
    q: '', intent: '', assignee: '', mailbox: '', labels: [], sort: 'newest',
    urgent: false, unassigned: false, unlinked: false, historical: false,
    dueSoon: false, bigAmount: false, timer: null,
  };

  $('q-labels-q').value = '';
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

/*
 * Les onglets Tout / Client / Fournisseur / Litige ont disparu.
 *
 * Ils promettaient trois populations distinctes et n'étaient que des filtres
 * déjà présents ailleurs : « Fournisseur » posait le statut AWAITING_SUPPLIER,
 * qui a sa pastille juste en dessous, et « Litige » posait le motif DISPUTE,
 * qui est dans le menu Motif. Quatre boutons de plus pour rien, et deux
 * endroits où lire la même chose — donc deux endroits où elle pouvait se
 * contredire.
 */
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

async function selectTicket(id, { silent = false } = {}) {
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
    // À l'ouverture automatique du premier message, l'erreur ne se dit pas :
    // personne n'a rien demandé, un toast rouge au démarrage accuse à vide.
    if (!silent) toast('Ce message n’existe plus.', true);
    await loadQueue();
    return;
  }

  state.detail = detail;
  renderDetail();
  await Promise.all([loadQueue(), loadEscalations(id)]);
}

function renderDetail() {
  const { ticket, order, orderError } = state.detail;

  // Le détail de commande appartient à la consultation hors ticket : le
  // laisser affiché sous un vrai fil ferait lire deux dossiers à la fois.

  // L'escalade n'a d'objet qu'avec un ticket ouvert et le droit d'escalader.
  const escalate = $('new-escalation');
  if (escalate) escalate.hidden = !ticket || !canI('escalate');

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

  renderTicketLabels(ticket);

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
      toast(userId ? 'Message assigné.' : 'Message remis au pot commun.');
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
    $('read-only-text').textContent = `Ce message appartient à ${shopLabel}. Basculez sur cette boutique pour y répondre.`;
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
        <div class="msg-body" data-msg="${esc(message.id)}">${esc(message.bodyText)}</div>
        <div class="msg-fr" data-fr="${esc(message.id)}" hidden></div>
        ${renderAttachments(message.attachments)}
      </div>`,
    )
    .join('');

  bindTranslate(ticket);
  renderSiblings(state.detail?.siblings ?? [], ticket);
  renderChanges(state.detail?.changes ?? []);

  const draft = ticket.drafts?.[0] ?? null;
  renderDraft(draft, ticket);
  renderCustomer(order);
  renderOrder(ticket, order, orderError);
  renderShipping(order);
}



const CHANGE_KINDS = {
  ADDRESS: 'Adresse',
  PHONE: 'Téléphone',
  PRODUCT: 'Modèle',
  SIZE: 'Taille',
  COLOR: 'Couleur',
  HOLD: 'Ne pas expédier',
  CANCEL: 'Annulation',
  OTHER: 'Autre',
};

const CHANGE_STATUS = {
  PENDING: { tone: 'wait', label: 'en attente du fournisseur' },
  ACKNOWLEDGED: { tone: 'ok', label: 'pris en compte' },
  REFUSED: { tone: 'bad', label: 'refusé' },
};

/**
 * Ce qu'on a demandé au fournisseur depuis ce mail, et sa réponse.
 *
 * Le statut est l'information utile : « pris en compte » autorise à répondre
 * au client, « refusé » interdit de lui annoncer quoi que ce soit. Une
 * demande sans réponse visible revient à ne pas l'avoir envoyée.
 */
function renderChanges(changes) {
  const box = $('d-changes');
  if (!box) return;

  box.hidden = changes.length === 0;
  if (changes.length === 0) return;

  box.innerHTML =
    `<div class="chg-head"><span class="panel-title">Demandé au fournisseur</span></div>` +
    changes
      .map((change) => {
        const status = CHANGE_STATUS[change.status] ?? CHANGE_STATUS.PENDING;

        return `<div class="chg-row">
          <b>${esc(CHANGE_KINDS[change.kind] ?? change.kind)}</b>
          ${
            change.afterValue
              ? `<span class="chg-swap">${esc(change.beforeValue ?? '—')} → <b>${esc(
                  change.afterValue,
                )}</b></span>`
              : `<span class="chg-swap">${esc(change.message)}</span>`
          }
          <span class="tag tone-${status.tone}">${esc(status.label)}</span>
          <span class="chg-who">${esc(change.supplier?.name ?? '')} · ${esc(
            dateTime(change.createdAt),
          )}</span>
          ${change.supplierNote ? `<p class="chg-note">« ${esc(change.supplierNote)} »</p>` : ''}
        </div>`;
      })
      .join('');
}

/**
 * Les autres messages en cours du même client.
 *
 * Un client qui relance ouvre un second fil plutôt que de répondre au sien :
 * deux lignes dans la file, traitées séparément, répondues deux fois. Ce bloc
 * les rassemble sous le fil qu'on lit — l'IA en tient compte de son côté dans
 * son résumé et sa proposition.
 */
function renderSiblings(siblings, ticket) {
  const box = $('d-sibs');
  if (!box) return;

  box.hidden = siblings.length === 0;
  if (siblings.length === 0) return;

  const who = ticket.customerName ?? ticket.customerEmail;

  box.innerHTML =
    `<div class="sibs-head">
       <span class="panel-title">Autres messages de ${esc(who)}</span>
       <span class="sibs-count">${siblings.length}</span>
     </div>` +
    siblings
      .map(
        (sib) => `<button class="sib" data-sib="${esc(sib.id)}">
          <span class="sib-when">${esc(dateTime(sib.lastMessageAt))}</span>
          <b>${esc(sib.subject ?? '(sans objet)')}</b>
          <span class="sib-tags">
            <span class="tag tag-status st-${esc(sib.status)}">${esc(
              STATUS_LABELS[sib.status] ?? sib.status,
            )}</span>
            ${sib.orderName ? `<span class="tag">${esc(sib.orderName)}</span>` : ''}
          </span>
        </button>`,
      )
      .join('');

  box.querySelectorAll('[data-sib]').forEach((button) =>
    button.addEventListener('click', () => void selectTicket(button.dataset.sib)),
  );
}

/**
 * Traduction du fil en français, à la demande.
 *
 * La traduction s'ajoute sous le message d'origine, elle ne le remplace pas :
 * ce que le client a écrit reste la seule version qui fait foi, et un doute
 * sur une formulation se lève en regardant deux lignes plus haut.
 */
function bindTranslate(ticket) {
  const button = $('d-translate');
  if (!button) return;

  // Le bouton disparaît sur un fil reconnu français : proposer de traduire du
  // français en français ferait douter de tout le reste. Une langue inconnue
  // le garde — un message pas encore analysé n'a pas de langue, et c'est
  // justement là qu'on a besoin de traduire.
  const label = ticket.language
    ? `Traduire en français (${ticket.language})`
    : 'Traduire en français';

  button.hidden = ticket.language === 'fr';
  if (button.hidden) return;

  button.disabled = false;
  button.textContent = label;

  button.onclick = async () => {
    // Deuxième clic : on masque, sans redemander au modèle.
    const shown = document.querySelector('#d-messages .msg-fr:not([hidden])');
    if (shown) {
      document.querySelectorAll('#d-messages .msg-fr').forEach((node) => {
        node.hidden = true;
      });
      button.textContent = label;
      return;
    }

    const already = document.querySelector('#d-messages .msg-fr[data-done]');
    if (already) {
      document.querySelectorAll('#d-messages .msg-fr[data-done]').forEach((node) => {
        node.hidden = false;
      });
      button.textContent = 'Masquer la traduction';
      return;
    }

    button.disabled = true;
    button.textContent = 'Traduction…';

    try {
      const result = await api(`/api/tickets/${ticket.id}/translate`, {
        method: 'POST',
        body: '{}',
      });

      for (const line of result.messages) {
        const node = document.querySelector(`[data-fr="${CSS.escape(line.id)}"]`);
        if (!node) continue;
        node.textContent = line.text;
        node.dataset.done = '1';
        node.hidden = false;
      }

      button.textContent = 'Masquer la traduction';
    } catch (error) {
      toast(error.message, true);
      button.textContent = label;
    } finally {
      button.disabled = false;
    }
  };
}



/* ==========================================================================
   LA FILE EN TABLEAU

   Vingt lignes lues d'un coup d'œil, contre six en cartes. Ce qu'un agent
   cherche avant d'ouvrir un message tient en cinq colonnes : qui écrit, ce
   qu'il veut, combien vaut sa commande, dans combien de temps on est en
   faute, et qui s'en occupe. Tout le reste appartient au message lui-même.

   Le tableau prend toute la largeur et masque le rail de droite : à 350 px,
   cinq colonnes ne sont plus un tableau mais une bouillie. Un clic ouvre le
   message et rend la vue partagée — parcourir et traiter sont deux gestes,
   ils méritent deux dispositions.
   ========================================================================== */

/** Temps restant avant l'échéance, en barre : la seule chose qui dise l'ordre. */
function slaCell(ticket) {
  if (!ticket.dueAt) return '<span class="sub">—</span>';

  const left = new Date(ticket.dueAt).getTime() - Date.now();
  const hours = left / 3600000;

  // Trois paliers, comme partout ailleurs : au-delà, la couleur devient une
  // décoration au lieu d'une échelle.
  const tone = left < 0 ? 'bad' : hours < 4 ? 'warn' : 'ok';
  const label =
    left < 0
      ? `en retard de ${formatSpan(-left)}`
      : `${formatSpan(left)}`;

  // La barre se vide à mesure : pleine à vingt-quatre heures, vide à
  // l'échéance. Un pourcentage exact n'apporterait rien, l'ordre de grandeur
  // suffit à décider.
  const pct = Math.max(0, Math.min(100, (hours / 24) * 100));

  return `<span class="sla sla-${tone}" title="${esc(dateTime(ticket.dueAt))}">
    <i style="width:${left < 0 ? 100 : pct}%"></i>
    <b>${esc(label)}</b>
  </span>`;
}

/** Heure pour aujourd'hui, jour + heure sinon. Sur une ligne de tableau, la
    date complète mange la colonne pour deux informations déjà connues. */
function shortMoment(iso) {
  const date = new Date(iso);
  const today = new Date().toDateString() === date.toDateString();
  const time = date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  return today
    ? time
    : `${date.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })} ${time}`;
}

function formatSpan(ms) {
  const hours = Math.round(ms / 3600000);
  if (hours < 1) return "moins d'1 h";
  if (hours < 48) return `${hours} h`;
  return `${Math.round(hours / 24)} j`;
}

function renderQueueTable(multiMailbox, shopById) {
  const box = $('queue-table');
  if (!box) return;

  const cols = [
    { key: 'customer', label: 'Client' },
    { key: 'subject', label: 'Message' },
    { key: 'intent', label: 'Motif' },
    { key: 'amount', label: 'Montant', sort: 'amount', num: true },
    { key: 'due', label: 'Échéance', sort: 'due' },
    { key: 'assignee', label: 'Assigné' },
  ];

  box.innerHTML = `<table class="qtable">
    <thead><tr>
      <th class="qt-pick"></th>
      ${cols
        .map(
          (col) =>
            `<th class="qt-${col.key}${col.num ? ' num' : ''}"${
              col.sort ? ` data-sort="${col.sort}"` : ''
            }>${esc(col.label)}${
              col.sort
                ? `<span class="qt-arrow${state.queue.sort === col.sort ? ' on' : ''}">↓</span>`
                : ''
            }</th>`,
        )
        .join('')}
    </tr></thead>
    <tbody>${state.tickets
      .map((ticket) => {
        const who = ticket.assignedTo;
        const picked = state.picked.has(ticket.id);

        return `<tr class="qt-row${picked ? ' picked' : ''}${
          ticket.id === state.currentId ? ' on' : ''
        }" data-id="${esc(ticket.id)}">
          <td class="qt-pick">
            <input type="checkbox" data-pick="${esc(ticket.id)}"${picked ? ' checked' : ''} />
          </td>

          <td class="qt-customer">
            ${
              state.allShops && shopById.has(ticket.merchantId)
                ? `<span class="shop-pip" style="background:${esc(
                    shopById.get(ticket.merchantId).color,
                  )}"></span>`
                : ''
            }
            <b>${esc(ticket.customerName ?? ticket.customerEmail)}</b>
            ${segmentChip(ticket)}
          </td>

          <td class="qt-subject">
            <b>${esc(ticket.subject ?? '(sans objet)')}</b>
            <span class="qt-when">${esc(shortMoment(ticket.lastMessageAt))}</span>
          </td>

          <td class="qt-intent">
            ${
              ticket.intent
                ? `<span class="tag in-${ticket.intent}">${esc(
                    INTENT_LABELS[ticket.intent] ?? ticket.intent,
                  )}</span>`
                : '<span class="sub">—</span>'
            }
            <span class="tag tag-status st-${ticket.status}">${esc(
              STATUS_LABELS[ticket.status] ?? ticket.status,
            )}</span>
          </td>

          <td class="qt-amount num mono">
            ${
              ticket.orderTotal != null
                ? esc(euro(ticket.orderTotal))
                : '<span class="sub">—</span>'
            }
            ${ticket.orderName ? `<span class="qt-order">${esc(ticket.orderName)}</span>` : ''}
          </td>

          <td class="qt-due">${slaCell(ticket)}</td>

          <td class="qt-assignee">
            <span class="who-dot${who ? '' : ' none'}" title="${
              who ? esc(who.name ?? who.email) : 'non assigné'
            }">${who ? esc(initials(who.name ?? who.email)) : '—'}</span>
          </td>
        </tr>`;
      })
      .join('')}</tbody>
  </table>`;

  box.querySelectorAll('.qt-row').forEach((row) =>
    row.addEventListener('click', (event) => {
      // La case à cocher ne doit pas ouvrir le message : on coche pour agir en
      // masse, précisément pour ne pas les ouvrir un par un.
      if (event.target.closest('.qt-pick')) return;
      void selectTicket(row.dataset.id);
      setQueueView('list');
    }),
  );

  box.querySelectorAll('[data-sort]').forEach((head) =>
    head.addEventListener('click', () => {
      state.queue.sort = head.dataset.sort;
      $('q-sort').value = head.dataset.sort;
      void loadQueue();
    }),
  );
}

/**
 * Ce que ce client représente, avant d'ouvrir son message.
 *
 * Compté sur nos échanges, pas sur ses achats — et nommé en conséquence. Un
 * huitième message ne se traite pas comme un premier : soit le client est
 * fidèle, soit son problème traîne depuis trois semaines, et dans les deux
 * cas le ton change.
 */
function segmentChip(ticket) {
  const threads = ticket.threads ?? 1;
  if (threads <= 1) return '<span class="seg-chip seg-new">nouveau</span>';
  if (threads >= 5) return `<span class="seg-chip seg-vip">${threads} échanges</span>`;
  return `<span class="seg-chip">${threads} échanges</span>`;
}

function setQueueView(view) {
  state.queueView = view;
  localStorage.setItem('csav.queueView', view);

  $('queue-table').hidden = view !== 'table';
  $('queue').hidden = view === 'table';
  // Le tableau prend toute la largeur : à 350 px, six colonnes ne sont plus un
  // tableau mais une bouillie.
  $('view-tickets')?.classList.toggle('wide-queue', view === 'table');

  document.querySelectorAll('#queue-view [data-qview]').forEach((button) =>
    button.setAttribute('aria-pressed', String(button.dataset.qview === view)),
  );

  if (view === 'table' && state.tickets.length) void loadQueue();
}

document.querySelectorAll('#queue-view [data-qview]').forEach((button) =>
  button.addEventListener('click', () => setQueueView(button.dataset.qview)),
);

// Le mode mémorisé s'applique dès le chargement, avant la première file :
// sinon le tableau apparaîtrait après coup, en déplaçant tout l'écran.
setQueueView(state.queueView);

/* ================================================== actions groupées ===== */

/**
 * Sélection multiple dans la file.
 *
 * Sur cinq mille messages, le traitement ligne à ligne n'est pas pénible :
 * il est impossible. Trois cents notifications de plateforme se closent d'un
 * geste, ou ne se closent jamais et la file cesse d'être crue.
 *
 * La sélection survit au rechargement de la file — elle est dans `state`, pas
 * dans le DOM — mais pas au changement de filtre : cocher trente messages puis
 * changer d'onglet et agir sur un ensemble qu'on ne voit plus est la meilleure
 * façon de clore ce qu'on ne voulait pas.
 */
function bindPickers() {
  document.querySelectorAll('[data-pick]').forEach((box) =>
    box.addEventListener('change', (event) => {
      const id = box.dataset.pick;
      if (box.checked) state.picked.add(id);
      else state.picked.delete(id);

      // Maj + clic coche toute la plage depuis la dernière case touchée :
      // c'est le geste attendu de toute liste, et sans lui on coche
      // cinquante cases une par une.
      if (event.shiftKey && state.lastPick) {
        const ids = state.tickets.map((ticket) => ticket.id);
        const from = ids.indexOf(state.lastPick);
        const to = ids.indexOf(id);
        if (from !== -1 && to !== -1) {
          for (const between of ids.slice(Math.min(from, to), Math.max(from, to) + 1)) {
            if (box.checked) state.picked.add(between);
            else state.picked.delete(between);
          }
          document.querySelectorAll('[data-pick]').forEach((other) => {
            other.checked = state.picked.has(other.dataset.pick);
            other.closest('.qrow')?.classList.toggle('picked', other.checked);
          });
        }
      }

      state.lastPick = id;
      box.closest('.qrow')?.classList.toggle('picked', box.checked);
      renderBulk();
    }),
  );
}

function clearPicked() {
  state.picked.clear();
  document.querySelectorAll('[data-pick]').forEach((box) => {
    box.checked = false;
    box.closest('.qrow')?.classList.remove('picked');
  });
  renderBulk();
}

function renderBulk() {
  const bar = $('bulk');
  if (!bar) return;

  const count = state.picked.size;
  bar.hidden = count === 0;
  if (count === 0) return;

  const labels = Object.keys(labelStyles).sort((a, b) => a.localeCompare(b, 'fr'));

  bar.innerHTML = `
    <b>${count} sélectionné${count > 1 ? 's' : ''}</b>
    <button class="btn btn-small" data-bulk="close">Marquer résolu</button>
    <button class="btn btn-small" data-bulk="analyze">Relancer l’IA</button>
    ${
      labels.length
        ? `<select class="bulk-label" id="bulk-label">
             <option value="">Poser un libellé…</option>
             ${labels
               .map((name) => `<option value="${esc(name)}">${esc(name)}</option>`)
               .join('')}
           </select>`
        : ''
    }
    <select class="bulk-label" id="bulk-assign">
      <option value="">Assigner à…</option>
      <option value="none">Personne</option>
      ${state.agents
        .map((user) => `<option value="${esc(user.id)}">${esc(user.name ?? user.email)}</option>`)
        .join('')}
    </select>
    ${
      canI('configure')
        ? `<button class="btn btn-small btn-danger" data-bulk="delete">Supprimer</button>`
        : ''
    }
    <button class="btn btn-small" data-bulk="clear" style="margin-left:auto">Tout décocher</button>`;

  bar.querySelectorAll('[data-bulk]').forEach((button) =>
    button.addEventListener('click', () => {
      if (button.dataset.bulk === 'clear') return clearPicked();
      void runBulk(button.dataset.bulk, {}, button);
    }),
  );

  $('bulk-label')?.addEventListener('change', (event) => {
    if (event.target.value) void runBulk('label-add', { label: event.target.value });
  });

  $('bulk-assign')?.addEventListener('change', (event) => {
    if (!event.target.value) return;
    void runBulk('assign', {
      assignee: event.target.value === 'none' ? null : event.target.value,
    });
  });
}

const BULK_CONFIRM = {
  delete:
    'Supprimer définitivement %n message(s) ?\n\n' +
    'Fils, brouillons et pièces jointes partent avec eux. ' +
    'Les mails restent dans votre boîte Gmail. Irréversible.',
};

async function runBulk(action, extra, button) {
  const ids = [...state.picked];
  const ask = BULK_CONFIRM[action];
  if (ask && !confirm(ask.replace('%n', String(ids.length)))) return;

  if (button) button.disabled = true;

  try {
    const result = await api('/api/tickets/bulk', {
      method: 'POST',
      body: JSON.stringify({ ids, action, ...extra }),
    });

    const done = result.affected;
    toast(
      action === 'analyze'
        ? `${done} message${done > 1 ? 's' : ''} remis en traitement.`
        : `${done} message${done > 1 ? 's' : ''} mis à jour.`,
    );

    state.picked.clear();
    await loadQueue();
  } catch (error) {
    toast(error.message, true);
  } finally {
    if (button) button.disabled = false;
  }
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


/**
 * Libellés du message et suppression, dans l'en-tête du détail.
 *
 * Un libellé posé par Gmail décrit ce que le marchand a déjà décidé ; encore
 * faut-il pouvoir le corriger quand l'automatisme s'est trompé, sans rouvrir
 * Gmail. Le changement reste dans le SAV : les autorisations Google accordées
 * ne permettent pas de repeindre la boîte, et c'est délibéré.
 */
function renderTicketLabels(ticket) {
  const bar = $('d-labels');
  if (!bar) return;

  const mine = new Set(ticket.labels ?? []);
  const known = Object.keys(labelStyles).sort((a, b) => a.localeCompare(b, 'fr'));
  // Un libellé porté mais inconnu du catalogue reste proposé : il vient d'une
  // boîte débranchée ou d'une étiquette renommée, et le retirer de la liste
  // le rendrait impossible à décocher.
  for (const name of mine) if (!known.includes(name)) known.push(name);

  const chip = (name, on) => {
    const style = labelStyles[name];
    const leaf = name.includes('/') ? name.slice(name.lastIndexOf('/') + 1) : name;
    const paint =
      style?.background && on
        ? ` style="background:${esc(style.background)};color:${esc(
            style.text ?? '#000',
          )};border-color:transparent"`
        : '';
    return `<button class="lchip" data-tlabel="${esc(name)}" aria-pressed="${on}"
      title="${esc(name)}"${paint}>${esc(leaf)}</button>`;
  };

  /*
   * Les libellés posés restent visibles, les autres se déplient.
   *
   * Onze boutons affichés en permanence occupaient deux lignes au-dessus du
   * mail — plus de place que le mail lui-même sur un portable. Or on classe
   * une fois et on relit dix : c'est l'état du classement qui doit tenir à
   * l'écran, pas le catalogue des étiquettes possibles.
   */
  const posed = known.filter((name) => mine.has(name));
  const rest = known.filter((name) => !mine.has(name));

  bar.hidden = false;
  bar.innerHTML =
    posed.map((name) => chip(name, true)).join('') +
    (rest.length
      ? `<details class="lmore">
           <summary class="lchip lchip-more">${
             posed.length ? '＋ Libellé' : '＋ Classer ce message'
           }</summary>
           <div class="lmore-box">${rest.map((name) => chip(name, false)).join('')}</div>
         </details>`
      : '') +
    `<button class="btn btn-small btn-danger" id="d-delete">Supprimer</button>`;

  bar.querySelectorAll('[data-tlabel]').forEach((chip) =>
    chip.addEventListener('click', async () => {
      const name = chip.dataset.tlabel;
      const next = mine.has(name)
        ? [...mine].filter((label) => label !== name)
        : [...mine, name];

      try {
        const result = await api(`/api/tickets/${ticket.id}/labels`, {
          method: 'PUT',
          body: JSON.stringify({ labels: next }),
        });
        ticket.labels = result.labels;
        renderTicketLabels(ticket);
        await loadQueue();
      } catch (error) {
        toast(error.message, true);
      }
    }),
  );

  $('d-delete')?.addEventListener('click', async () => {
    if (
      !confirm(
        `Supprimer définitivement « ${ticket.subject ?? '(sans objet)'} » ?\n\n` +
          'Le fil, les brouillons et les pièces jointes partent avec lui. ' +
          'Le mail reste dans votre boîte Gmail. Irréversible.',
      )
    ) {
      return;
    }

    try {
      await api(`/api/tickets/${ticket.id}`, { method: 'DELETE' });
      toast('Message supprimé.');
      state.currentId = null;
      bar.hidden = true;
      await loadQueue();
    } catch (error) {
      toast(error.message, true);
    }
  });
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


/*
 * Analyse à la demande.
 *
 * La file de fond avale des milliers de messages à cadence bridée : quand on
 * ouvre un mail précis, on n'attend pas son tour, on veut son résumé. Le
 * bouton lance le même traitement que le worker, sur ce seul message.
 *
 * Déclenché tout seul à l'ouverture quand le message n'a jamais été analysé —
 * c'est le geste qu'on ferait de toute façon, et le faire faire à la main
 * transformerait chaque lecture en corvée. Une seule tentative par message et
 * par session : un mail que l'IA refuse ne doit pas relancer un appel à chaque
 * clic.
 */
const analysed = new Set();

function analyseButton(label) {
  return `<br><button class="btn btn-small btn-primary" id="d-analyse"
    style="margin-top:9px">${label}</button>`;
}

async function runAnalyse(ticketId, button) {
  analysed.add(ticketId);

  if (button) {
    button.disabled = true;
    button.textContent = 'L’IA lit le message…';
  }

  try {
    await api(`/api/tickets/${ticketId}/analyze`, { method: 'POST', body: '{}' });
    // On recharge le détail plutôt que de recoller la réponse : le statut, le
    // libellé et la commande rattachée changent aussi. Le préchargement est
    // vidé d'abord, sinon on réafficherait la version d'avant l'analyse.
    prefetched.delete(ticketId);
    if (state.currentId === ticketId) await selectTicket(ticketId);
    await loadQueue();
  } catch (error) {
    if (button) {
      button.disabled = false;
      button.textContent = 'Réessayer';
    }
    toast(error.message, true);
  }
}

function bindAnalyse(ticket) {
  const button = $('d-analyse');
  button?.addEventListener('click', () => void runAnalyse(ticket.id, button));

  // Jamais deux fois de suite sur le même message, et jamais sur un message
  // clos : relire une archive ne doit pas coûter un appel au modèle.
  if (!analysed.has(ticket.id) && ticket.status !== 'CLOSED' && ticket.status !== 'AUTO_SENT') {
    void runAnalyse(ticket.id, button);
  }
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
      `<span class="mono" style="font-size:12px">${esc(ticket.failureReason)}</span>` +
      analyseButton('Réessayer maintenant');
    bindAnalyse(ticket);
    return;
  }

  if (!draft) {
    zone.hidden = true;
    none.hidden = false;
    $('no-draft-text').innerHTML =
      (ticket.intent === 'POSITIVE' || ticket.intent === 'OTHER'
        ? "Ce message n'appelle pas de réponse automatique — il a été classé sans action."
        : 'Pas encore de résumé ni de réponse pour ce message.') +
      analyseButton('Résumer et proposer une réponse');
    bindAnalyse(ticket);
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
    : 'Rattachez d’abord une commande à ce message.';
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
    // « Client depuis » ne décidait rien : la fiche complète le garde pour qui
    // le cherche, le rail ne montre que ce qui change une réponse.
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
    // Les états Shopify bruts — PAID, FULFILLED — se lisent en anglais
    // administratif ; traduits en pastilles, ils se voient sans se lire.
    container.innerHTML =
      `<div class="c-order-tags">
        ${statusTag(order.displayFinancialStatus, FINANCIAL_LABELS, ['PENDING', 'PARTIALLY_PAID', 'EXPIRED'])}
        ${statusTag(order.displayFulfillmentStatus, FULFILLMENT_LABELS, ['UNFULFILLED', 'ON_HOLD'])}
      </div>` +
      '<dl>' +
      row('Numéro', order.name, true) +
      row('Passée le', dateTime(order.createdAt)) +
      row('Montant', euro(order.totalPrice, order.currency), true) +
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
            <span>${dateTime(order.createdAt)} · ${euro(order.totalPrice, order.currency)}</span>
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
    // Le statut brut (« SUCCESS ») disait en anglais ce que la frise dessous
    // dit en français : une information, un seul endroit.

    (fulfillment.estimatedDeliveryAt
      ? row('Estimation', fullDate(fulfillment.estimatedDeliveryAt))
      : '') +
    '</dl>' +
    /*
     * Bouton plein format, en plus du numéro cliquable.
     *
     * « Où est mon colis » est la question la plus fréquente d'un SAV : la
     * réponse ne doit pas se mériter en repérant un numéro en petit dans une
     * liste de définitions. Le numéro reste cliquable pour qui l'a déjà sous
     * les yeux ; le bouton sert à celui qui vient de lire le mail.
     */
    (fulfillment.trackingNumber
      ? `<button class="btn btn-small btn-primary ship-go"
           data-track="${esc(fulfillment.trackingNumber)}">Suivre le colis</button>`
      : '') +
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

/**
 * Le poste de pilotage des ateliers.
 *
 * Une carte par fournisseur, qui répond à la question du matin sans ouvrir
 * une seule fiche : qu'a-t-il à préparer, qu'a-t-il produit, qu'est-ce qui
 * attend chez lui — et son lien atelier à portée de clic. La table qui vivait
 * ici ne montrait que l'email et le téléphone : un carnet d'adresses sur
 * l'écran d'où l'on pilote la production.
 */
function renderSuppliers() {
  const rows = state.suppliers;
  const hub = state.supplierHub ?? {};

  $('suppliers-rows').innerHTML =
    rows
      .map((supplier) => {
        const stats = hub[supplier.id] ?? {};
        const rules = [
          ...(supplier.vendors ?? []).map((vendor) => `<span class="tag tag-order">${esc(vendor)}</span>`),
          ...(supplier.skuPrefixes ?? []).map((prefix) => `<span class="tag tag-order mono">${esc(prefix)}*</span>`),
          ...(supplier.isDefault ? ['<span class="tag tone-ok">Atelier par défaut</span>'] : []),
        ];

        const waiting = (stats.pendingChanges ?? 0) + (stats.openEscalations ?? 0);
        const oldestDays = stats.oldestPendingAt
          ? Math.floor((Date.now() - new Date(stats.oldestPendingAt).getTime()) / 86400000)
          : 0;

        return `<article class="supc${supplier.active ? '' : ' muted'}" data-supplier="${esc(supplier.id)}">
          <div class="supc-head">
            <b>${esc(supplier.name)}</b>
            ${
              supplier.active
                ? '<span class="tag tone-ok">Actif</span>'
                : '<span class="tag tone-mute">Désactivé</span>'
            }
            <button class="btn btn-small" data-sup-edit="${esc(supplier.id)}"
              style="margin-left:auto">Modifier</button>
          </div>

          <p class="supc-contact">${esc(supplier.contactEmail)}${
            supplier.phone ? ` · ${esc(supplier.phone)}` : ''
          }</p>

          <div class="supc-rules">${
            rules.length
              ? rules.join('')
              : '<span class="tag tone-wait">Aucune règle — cet atelier ne reçoit rien automatiquement</span>'
          }</div>

          <div class="supc-stats">
            <div class="supc-stat"><b>${stats.toPrepare ?? '—'}</b><span>à préparer</span></div>
            <div class="supc-stat"><b>${stats.parcelsToday ?? 0}</b><span>colis aujourd'hui</span></div>
            <div class="supc-stat${waiting > 0 ? ' hot' : ''}">
              <b>${waiting}</b><span>en attente${
                waiting > 0 && oldestDays >= 2 ? ` · ${oldestDays} j` : ''
              }</span>
            </div>
            <div class="supc-stat"><b>${stats.parcels30d ?? 0}</b><span>colis / 30 j${
              stats.photoRate != null ? ` · ${stats.photoRate}% photo` : ''
            }</span></div>
          </div>

          <p class="supc-last">${
            stats.lastParcelAt
              ? `Dernier colis ${esc(relativeTime(stats.lastParcelAt))}`
              : 'Aucun colis saisi encore'
          }</p>

          <div class="supc-acts">
            <button class="btn btn-small btn-primary" data-sup-link="${esc(supplier.id)}">
              Copier le lien atelier
            </button>
            <button class="btn btn-small" data-sup-open="${esc(supplier.id)}">Ouvrir l'atelier</button>
            ${
              waiting > 0
                ? `<button class="btn btn-small" data-sup-updates="1">Voir ce qui attend</button>`
                : ''
            }
          </div>
        </article>`;
      })
      .join('') ||
    '<p class="empty" style="padding:20px">Aucun contact. Ajoutez le fournisseur, le transporteur ou l’atelier que vous sollicitez le plus.</p>';

  const active = activeSuppliers().length;
  $('suppliers-count').textContent = rows.length
    ? `${rows.length} contact${rows.length > 1 ? 's' : ''} · ${active} actif${active > 1 ? 's' : ''}`
    : '';

  $('suppliers-rows')
    .querySelectorAll('[data-sup-edit]')
    .forEach((button) =>
      button.addEventListener('click', () => openSupplierForm(button.dataset.supEdit)),
    );

  // Le lien atelier, copié ou ouvert : émis à la demande, jamais stocké.
  $('suppliers-rows')
    .querySelectorAll('[data-sup-link], [data-sup-open]')
    .forEach((button) =>
      button.addEventListener('click', async () => {
        const id = button.dataset.supLink ?? button.dataset.supOpen;
        try {
          const { url } = await api(`/api/suppliers/${id}/portal-link`, { method: 'POST' });
          if (button.dataset.supOpen) {
            window.open(url, '_blank', 'noopener');
          } else {
            await navigator.clipboard.writeText(url);
            toast('Lien atelier copié — transmettez-le au fournisseur.');
          }
        } catch (error) {
          toast(error.message, true);
        }
      }),
    );

  $('suppliers-rows')
    .querySelectorAll('[data-sup-updates]')
    .forEach((button) => button.addEventListener('click', () => setView('changes')));
}

/** Chiffres du hub, chargés après la liste : l'écran paraît, puis se remplit. */
async function loadSupplierHub() {
  try {
    const data = await api('/api/suppliers/hub');
    state.supplierHub = Object.fromEntries(
      (data.suppliers ?? []).map((row) => [row.id, row]),
    );
    if (data.shopifyError) toast(data.shopifyError, true);
  } catch {
    return;
  }
  if (state.view === 'suppliers') renderSuppliers();
}

/** « Nike, Adidas ,, » → ['Nike', 'Adidas']. Les vides sont écartés. */
function splitList(value) {
  return String(value ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}


/**
 * Ce que les ateliers ont renvoyé, en tête de l'écran Fournisseurs.
 *
 * Un chiffre dans la navigation dit qu'il y a quelque chose ; encore faut-il
 * que l'écran dise quoi, et y mène. Trois natures, trois destinations — sans
 * ça la pastille devient une alarme qu'on apprend à ignorer.
 */
async function renderSupplierActivity() {
  const box = $('sup-activity');
  if (!box) return;

  let activity = state.supplierActivity;
  try {
    activity = await api('/api/supplier-activity');
    state.supplierActivity = activity;
    state.navCounts = { ...state.navCounts, suppliers: activity.total };
    renderNav();
  } catch {
    // Le carnet de contacts reste utilisable sans ce bandeau.
  }

  box.hidden = !activity || activity.total === 0;
  if (box.hidden) return;

  const line = (count, label, view) =>
    count > 0
      ? `<button class="sup-act" data-goto="${view}">
           <b>${count}</b><span>${esc(label)}</span>
         </button>`
      : '';

  box.innerHTML =
    `<span class="rail-title">Retours de vos ateliers</span>
     <div class="sup-act-row">
       ${line(activity.answered, activity.answered > 1 ? 'escalades répondues' : 'escalade répondue', 'tickets')}
       ${line(activity.issues, activity.issues > 1 ? 'signalements d’atelier' : 'signalement d’atelier', 'tickets')}
       ${line(activity.changes, activity.changes > 1 ? 'changements à répercuter' : 'changement à répercuter', 'changes')}
     </div>`;

  box.querySelectorAll('[data-goto]').forEach((button) =>
    button.addEventListener('click', () => setView(button.dataset.goto)),
  );
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
  $('sup-f-vendors').value = (supplier?.vendors ?? []).join(', ');
  $('sup-f-skus').value = (supplier?.skuPrefixes ?? []).join(', ');
  $('sup-f-default').checked = supplier?.isDefault ?? false;
  describeSupplierAccess();
  $('sup-f-link').hidden = !supplier;
  $('sup-f-link').dataset.supplier = supplier?.id ?? '';
  // Alerter un contact qui n'existe pas encore n'a pas de sens.
  $('sup-f-alert').hidden = !supplier || !supplier.active;

  $('supplier-modal').classList.add('open');
}

/* ------------------------------------------------- alerte urgente ------- */

/**
 * Alerte urgente vers un fournisseur.
 *
 * Son canal normal est l'atelier, qu'il ouvre le matin : parfait pour le
 * travail du jour, inutile pour « n'expédie pas cette commande ». L'alerte
 * part par mail — donc sur son téléphone — et reste affichée en rouge en tête
 * de son atelier tant qu'il n'a pas cliqué « J'ai vu ».
 */
function openAlertModal(id) {
  const supplier = state.suppliers.find((candidate) => candidate.id === id);
  if (!supplier) return;

  $('alert-modal').dataset.supplier = id;
  $('alert-modal').dataset.ticket = '';
  $('alert-modal').dataset.order = '';
  $('alert-who').textContent = `${supplier.name} · ${supplier.contactEmail}`;
  state.alertCtx = null;
  setAlertKind('HOLD');
  $('alert-order').value = '';
  $('alert-message').value = '';
  renderAlertSuppliers();
  $('alert-modal').hidden = false;
  $('alert-modal').classList.add('open');
  $('alert-message').focus();
}

function closeAlertModal() {
  $('alert-modal').classList.remove('open');
  $('alert-modal').hidden = true;
  // Le mode correction ne doit pas survivre à la fermeture : la prochaine
  // ouverture serait une création qui réécrirait l'ancienne demande.
  delete $('alert-modal').dataset.editing;
}


/*
 * Nature de la demande, en boutons.
 *
 * Le avant → après ne vaut que pour un changement de valeur : sur « ne pas
 * expédier » ou « annulation », il n'y a rien à écrire dedans — on le masque
 * au lieu de laisser deux champs vides interroger.
 */
const KINDS_WITH_SWAP = new Set(['SIZE', 'COLOR', 'PRODUCT', 'ADDRESS', 'PHONE']);

/*
 * Valeurs actuelles de la commande, par nature de changement.
 *
 * Choisir « Couleur » en gardant « 47.5 » dans le champ « avant » n'a aucun
 * sens : chaque nature doit préremplir avec SA valeur actuelle. Le contexte
 * est construit à l'ouverture depuis la commande, et le changement de nature
 * rebascule les deux champs.
 *
 * La déclinaison Shopify arrive souvent en un seul libellé — « Blackened
 * Blue / 45 » : on sépare la taille (le segment qui commence par un chiffre)
 * de la couleur (l'autre). Faillible sur un catalogue exotique, mais sur des
 * chaussures c'est la forme constante, et un champ prérempli faux se corrige
 * d'un regard là où un champ vide se ressaisit à chaque fois.
 */
const ALERT_HINTS = {
  SIZE: { before: '42.5', after: '45' },
  COLOR: { before: 'Blackened Blue', after: 'Black Hyper Crimson' },
  PRODUCT: { before: 'Nike Mind 001', after: 'Nike Vomero Plus' },
  ADDRESS: { before: 'Adresse actuelle', after: 'Nouvelle adresse complète' },
  PHONE: { before: '06 12 34 56 78', after: 'Nouveau numéro' },
};

state.alertCtx = null;

function alertContextFromOrder(order) {
  if (!order) return null;

  const item = order.lineItems?.[0];
  const address = order.shippingAddress ?? {};

  const parts = String(item?.variantTitle ?? '')
    .split('/')
    .map((part) => part.trim())
    .filter(Boolean);
  const size = parts.find((part) => /^\d/.test(part)) ?? (parts.length === 1 ? parts[0] : '');
  const color = parts.find((part) => part !== size) ?? '';

  return {
    SIZE: size,
    COLOR: color,
    PRODUCT: item?.title ?? '',
    ADDRESS: [
      address.address1,
      address.address2,
      `${address.zip ?? ''} ${address.city ?? ''}`.trim(),
      address.country,
    ]
      .filter(Boolean)
      .join(', '),
    PHONE: address.phone ?? '',
  };
}

function setAlertKind(kind) {
  closeVariantPicker();
  $('alert-kind').value = kind;
  document.querySelectorAll('#alert-kinds [data-kind]').forEach((button) =>
    button.setAttribute('aria-pressed', String(button.dataset.kind === kind)),
  );

  const swap = KINDS_WITH_SWAP.has(kind);
  $('alert-swap-field').hidden = !swap;
  if (!swap) return;

  $('alert-before').value = state.alertCtx?.[kind] ?? '';
  $('alert-after').value = '';
  $('alert-before').placeholder = ALERT_HINTS[kind]?.before ?? '';
  $('alert-after').placeholder = ALERT_HINTS[kind]?.after ?? '';

  // Une adresse ne tient pas centrée en gros caractères : les champs passent
  // en lecture longue le temps de cette nature.
  document
    .querySelector('#alert-swap-field .swap-row')
    ?.classList.toggle('swap-long', kind === 'ADDRESS');
}

document.querySelectorAll('#alert-kinds [data-kind]').forEach((button) =>
  button.addEventListener('click', () => setAlertKind(button.dataset.kind)),
);


/* ------------------------------------------- choisir plutôt que saisir ---- */

/**
 * Liste déroulante des déclinaisons du catalogue, sous un champ du
 * « avant → après ».
 *
 * Écrire « Blackened Blue » de mémoire, c'est l'écrire faux une fois sur
 * trois — et l'atelier lira ce qu'on lui a écrit. Le champ reste libre (un
 * fournisseur peut avoir une référence qu'on n'a pas), mais le catalogue est
 * à un clic, avec sa recherche et son stock.
 *
 * La liste se cherche sur le modèle de la commande quand on le connaît : la
 * question n'est pas « quelles tailles existent » mais « quelles tailles
 * existent pour CETTE paire ».
 */
let pickerTimer = null;

function closeVariantPicker() {
  document.querySelectorAll('.pickbox').forEach((box) => box.remove());
}

async function fillVariantPicker(box, input, scope) {
  const term = input.value.trim();
  const product = scope === 'PRODUCT' ? '' : (state.alertCtx?.PRODUCT ?? '');

  box.innerHTML = '<div class="pick-empty">Recherche…</div>';

  let options = [];
  try {
    const params = new URLSearchParams({ scope });
    if (term) params.set('q', term);
    if (product) params.set('product', product);
    ({ options } = await api(`/api/variant-options?${params}`));
  } catch (error) {
    box.innerHTML = `<div class="pick-empty">${esc(error.message)}</div>`;
    return;
  }

  if (options.length === 0) {
    box.innerHTML = `<div class="pick-empty">${
      scope === 'PRODUCT'
        ? 'Aucun produit trouvé.'
        : 'Aucune déclinaison trouvée pour ce modèle.'
    }</div>`;
    return;
  }

  box.innerHTML = options
    .map(
      (option) => `<button type="button" class="pick-item" data-value="${esc(option.value)}">
        ${
          option.image
            ? `<img src="${esc(option.image)}" alt="" loading="lazy" />`
            : '<span class="pick-noimg" aria-hidden="true"></span>'
        }
        <span class="pick-text">
          <b>${esc(option.value)}</b>
          ${option.detail ? `<small>${esc(option.detail)}</small>` : ''}
        </span>
        ${
          /*
           * La pastille n'apparaît que sur un stock réellement positif.
           *
           * Un `0` ne veut pas dire « épuisé » : sur une boutique qui ne suit
           * pas ses stocks — le cas du dropshipping — Shopify renvoie zéro
           * pour tout le catalogue. Afficher « épuisé » partout ferait refuser
           * des échanges parfaitement possibles, ce qui est plus grave que de
           * ne rien afficher.
           */
          option.stock > 0
            ? `<span class="pick-stock">${option.stock} en stock</span>`
            : ''
        }
      </button>`,
    )
    .join('');

  box.querySelectorAll('.pick-item').forEach((item) =>
    item.addEventListener('mousedown', (event) => {
      // `mousedown` et non `click` : le champ perd le focus avant le clic, et
      // la liste se refermerait sous le doigt.
      event.preventDefault();
      input.value = item.dataset.value;
      closeVariantPicker();
    }),
  );
}

function openVariantPicker(input) {
  const kind = $('alert-kind').value;
  const scope = kind === 'PRODUCT' ? 'PRODUCT' : kind === 'COLOR' ? 'COLOR' : 'SIZE';

  // Adresse et téléphone n'ont pas de catalogue : rien à proposer.
  if (!['SIZE', 'COLOR', 'PRODUCT'].includes(kind)) return;

  closeVariantPicker();

  const box = document.createElement('div');
  box.className = 'pickbox';
  input.parentElement.append(box);
  void fillVariantPicker(box, input, scope);
}

for (const id of ['alert-before', 'alert-after']) {
  const input = $(id);
  if (!input) continue;

  input.addEventListener('focus', () => openVariantPicker(input));

  input.addEventListener('input', () => {
    const box = input.parentElement.querySelector('.pickbox');
    if (!box) return openVariantPicker(input);

    clearTimeout(pickerTimer);
    // Une requête par lettre serait une requête Shopify par lettre : on
    // attend la pause de frappe, comme partout ailleurs.
    pickerTimer = setTimeout(() => {
      const kind = $('alert-kind').value;
      void fillVariantPicker(box, input, kind === 'PRODUCT' ? 'PRODUCT' : kind === 'COLOR' ? 'COLOR' : 'SIZE');
    }, 250);
  });

  input.addEventListener('blur', () => setTimeout(closeVariantPicker, 120));
}

$('sup-f-alert')?.addEventListener('click', () => {
  const id = $('sup-f-link').dataset.supplier;
  $('supplier-modal').classList.remove('open');
  openAlertModal(id);
});

$('alert-cancel')?.addEventListener('click', closeAlertModal);
$('alert-modal')?.addEventListener('click', (event) => {
  if (event.target === $('alert-modal')) closeAlertModal();
});

$('alert-send')?.addEventListener('click', async () => {
  const message = $('alert-message').value.trim();
  const after = $('alert-after').value.trim();

  // L'un ou l'autre suffit : « ne pas expédier » n'a pas de valeur « après »,
  // et « 44 → 45 » n'a pas besoin de phrase.
  if (!after && message.length < 3) {
    toast('Indiquez la nouvelle valeur, ou écrivez une précision.', true);
    return;
  }

  const supplierId = $('alert-supplier').value || $('alert-modal').dataset.supplier;
  if (!supplierId) {
    toast('Choisissez le fournisseur destinataire.', true);
    return;
  }

  const button = $('alert-send');
  button.disabled = true;

  try {
    // Le même formulaire crée et corrige : en mode correction, la demande
    // existante est réécrite sur place — l'atelier voit la version corrigée,
    // sans second mail ni carte en double.
    const editing = $('alert-modal').dataset.editing;
    const result = editing
      ? await api(`/api/changes/${editing}`, {
          method: 'PATCH',
          body: JSON.stringify({
            kind: $('alert-kind').value,
            message,
            beforeValue: $('alert-before').value.trim() || null,
            afterValue: after || null,
            orderName: $('alert-order').value.trim() || null,
          }),
        })
      : await api(`/api/suppliers/${supplierId}/alert`, {
          method: 'POST',
          body: JSON.stringify({
            kind: $('alert-kind').value,
            message,
            beforeValue: $('alert-before').value.trim() || null,
            afterValue: after || null,
            orderName: $('alert-order').value.trim() || null,
            shopifyOrderId: $('alert-modal').dataset.order || null,
            ticketId: $('alert-modal').dataset.ticket || null,
          }),
        });

    closeAlertModal();
    // On distingue les deux : une alerte enregistrée mais non envoyée reste
    // utile, à condition de ne pas croire que le fournisseur l'a reçue.
    toast(
      result.updated
        ? 'Demande corrigée — l’atelier voit la nouvelle version.'
        : result.emailed
          ? 'Demande envoyée par mail et affichée dans son atelier.'
          : 'Demande affichée dans son atelier — le mail n’a pas pu partir.',
      !result.updated && !result.emailed,
    );

    // L'écran d'où l'on vient se rafraîchit : le mail pour montrer la
    // demande en attente, l'écran Update pour montrer la nouvelle ligne.
    if (state.view === 'changes') {
      changesCountAt = 0;
      await loadChanges();
    } else if (state.currentId) {
      prefetched.delete(state.currentId);
      await selectTicket(state.currentId);
    }
  } catch (error) {
    toast(error.message, true);
  } finally {
    button.disabled = false;
  }
});

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
    // Saisi en une ligne, stocké en liste : demander un champ par marque
    // ferait renoncer dès la troisième.
    vendors: splitList($('sup-f-vendors').value),
    skuPrefixes: splitList($('sup-f-skus').value),
    isDefault: $('sup-f-default').checked,
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

/*
 * Table des droits, telle que le serveur l'applique.
 *
 * Elle existait dans le code et nulle part à l'écran : un propriétaire qui
 * confie sa boutique devait deviner ce qu'un agent pourrait faire, ou
 * l'apprendre en le regardant faire. Recopiée ici, elle doit rester fidèle à
 * `src/plugins/auth.ts` — c'est le prix d'une explication lisible, et l'écart
 * se verrait au premier essai grâce à « Voir en tant que ».
 */
/**
 * Tableau des droits, servi par le serveur depuis la table qui les applique.
 *
 * Le recopier ici aurait été plus simple, et faux à terme : le jour où un
 * droit change de rôle, l'écran continuerait d'annoncer l'ancien — et c'est
 * l'écran qu'on croit, puisque c'est lui qu'on lit.
 */
async function renderRights() {
  const body = $('rights-rows');
  if (!body || body.dataset.loaded === '1') return;

  let data;
  try {
    data = await api('/api/rights');
  } catch {
    return;
  }

  body.innerHTML = data.rights
    .map(
      (right) => `<tr>
        <td>${esc(right.label)}</td>
        ${right.allowed
          .map(
            (allowed) =>
              `<td class="rights-cell">${
                allowed
                  ? '<span class="rights-yes" title="Autorisé">✓</span>'
                  : '<span class="rights-no" title="Refusé">·</span>'
              }</td>`,
          )
          .join('')}
      </tr>`,
    )
    .join('');

  body.dataset.loaded = '1';
}

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
            ? '<span class="tag tone-mute">Désactivé</span>'
            : user.lastLoginAt
              ? '<span class="tag tone-ok">Actif</span>'
              // Une invitation jamais honorée est en attente d'un tiers : c'est
              // exactement le sens de l'ambre, et le symptôme d'un mail qui
              // n'est pas arrivé.
              : '<span class="tag tone-wait">Invité</span>'
        }</td>
        <td>${owner ? '<button class="btn btn-small">Modifier</button>' : ''}</td>
      </tr>`;
    })
    .join('');

  void renderRights();

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
    ['Messages reçus', stats.tickets.total, `${statsDays} derniers jours`],
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
      Barre pleine : messages reçus. Barre foncée : messages traités. Quand la
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
                ? `<span class="tag ${trackTone(shipment.liveStatus)}">${esc(
                    TRACK_LABELS[shipment.liveStatus] ?? shipment.liveStatus,
                  )}</span>${
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
    body.innerHTML = `<tr><td colspan="7" class="empty">${esc(error.message)}</td></tr>`;
  }
}

$('tracking-refresh').addEventListener('click', () => loadTracking());

/* --------------------------------------------------------- remboursements */

/*
 * Couleur d'un état de colis.
 *
 * Quatre familles, pas deux. « En transit » et « Incident de livraison »
 * portaient le même orange : l'un demande de patienter, l'autre d'agir tout de
 * suite, et l'agent devait lire chaque ligne pour faire le tri que la couleur
 * aurait dû faire pour lui.
 */
const TRACK_TONE = {
  Delivered: 'ok',
  OutForDelivery: 'go',
  AvailableForPickup: 'go',
  InTransit: 'go',
  InfoReceived: 'wait',
  NotFound: 'wait',
  Expired: 'wait',
  DeliveryFailure: 'bad',
  Exception: 'bad',
};

function trackTone(status) {
  return `tone-${TRACK_TONE[status] ?? 'wait'}`;
}

const REFUND_TONE = {
  COMPLETED: 'ok',
  PENDING: 'wait',
  FAILED: 'bad',
  CANCELLED: 'mute',
};

const REFUND_STATUS = {
  PENDING: 'En attente',
  COMPLETED: 'Effectué',
  FAILED: 'Échec',
  CANCELLED: 'Annulé',
};

const REFUND_KIND = { FULL: 'Total', PARTIAL: 'Partiel', SHIPPING: 'Frais de port' };

/** Fenêtre de l'écran Remboursements, commune au montant et au ratio. */
let refundDays = 90;

async function loadRefunds() {
  const body = $('refunds-rows');
  body.innerHTML = '<tr><td colspan="7" class="empty">Chargement…</td></tr>';

  try {
    const data = await api(`/api/refunds?days=${refundDays}`);
    const { refunds, totals } = data;

    $('refunds-range')
      .querySelectorAll('button')
      .forEach((button) =>
        button.setAttribute('aria-pressed', String(Number(button.dataset.days) === refundDays)),
      );
    state.refundRows = refunds;

    const pending = totals.PENDING ?? { count: 0, amount: 0 };
    const done = totals.COMPLETED ?? { count: 0, amount: 0 };
    const failed = totals.FAILED ?? { count: 0, amount: 0 };

    $('refunds-kpis').innerHTML = [
      [
        'Part du CA remboursée',
        data.refundRate === null
          ? '—'
          : `${(data.refundRate * 100).toFixed(1).replace('.', ',')} %`,
        data.revenue === null
          ? 'chiffre d’affaires indisponible'
          : `${euro(data.refundedTotal, 'EUR')} sur ${euro(data.revenue, 'EUR')}`,
      ],
      [
        'Effectués',
        euro(totals.COMPLETED?.amount ?? 0, 'EUR'),
        `${totals.COMPLETED?.count ?? 0} remboursement${
          (totals.COMPLETED?.count ?? 0) > 1 ? 's' : ''
        }`,
      ],
      [
        'En cours',
        euro(totals.PENDING?.amount ?? 0, 'EUR'),
        `${totals.PENDING?.count ?? 0} demande${(totals.PENDING?.count ?? 0) > 1 ? 's' : ''}`,
      ],
      [
        'En échec',
        totals.FAILED?.count ?? 0,
        (totals.FAILED?.count ?? 0) > 0 ? 'à reprendre' : 'rien à reprendre',
      ],
    ]
      .map(
        ([label, value, note]) => `<div class="kpi">
          <span class="kpi-label">${esc(String(label))}</span>
          <span class="kpi-value">${esc(String(value))}</span>
          <span class="kpi-note">${esc(String(note))}</span>
        </div>`,
      )
      .join('');

    renderRefundRows();
  } catch (error) {
    body.innerHTML = `<tr><td colspan="7" class="empty">${esc(error.message)}</td></tr>`;
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
          (refund) => `<tr class="grid-row" data-order="${esc(refund.shopifyOrderId ?? '')}">
            <td class="mono"><b>${esc(refund.orderName ?? '—')}</b>${
              // L'origine se dit une fois, discrètement : un remboursement
              // passé dans Shopify ne porte ni auteur ni ticket, et l'agent
              // doit savoir pourquoi la ligne est plus pauvre.
              refund.external ? '<span class="src">Shopify</span>' : ''
            }</td>
            <td>${esc(refund.customerName ?? refund.customerEmail ?? '—')}</td>
            <td>${fullDate(refund.createdAt)}</td>
            <td>${esc(refund.reason ?? '—')}</td>
            <td>${esc(REFUND_KIND[refund.kind] ?? refund.kind)}</td>
            <td><span class="tag tone-${
              REFUND_TONE[refund.status] ?? 'wait'
            }">${esc(REFUND_STATUS[refund.status] ?? refund.status)}</span></td>
            <td class="num mono">${euro(refund.amount, refund.currency ?? 'EUR')}</td>
          </tr>`,
        )
        .join('') ||
      `<tr><td colspan="7" class="empty">Aucun remboursement pour l'instant.
        Ils se créent depuis un mail client (bouton « Rembourser ») et
        s'exécutent sur Shopify après validation — chacun laissera sa ligne ici.</td></tr>`;

    // La ligne mène à la commande : c'est la question qui suit toujours un
    // montant remboursé — sur quoi, et pourquoi.
    body.querySelectorAll('[data-order]').forEach((row) =>
      row.addEventListener('click', () => {
        if (row.dataset.order) void openOrderSheet(row.dataset.order);
      }),
    );

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

      // Le compte à rebours est la seule information qui décide de l'ordre de
      // travail : un litige non contesté est débité d'office. Il passe donc en
      // tête de carte, au corps d'un chiffre qu'on lit de loin.
      const countdown =
        dispute.daysLeft === null
          ? { value: '—', unit: 'sans échéance', tone: 'mute' }
          : dispute.daysLeft < 0
            ? { value: 'Perdu', unit: 'échéance dépassée', tone: 'bad' }
            : {
                value: String(dispute.daysLeft),
                unit: dispute.daysLeft > 1 ? 'jours restants' : 'jour restant',
                tone: dispute.daysLeft <= 3 ? 'bad' : dispute.daysLeft <= 7 ? 'wait' : 'go',
              };

      return `<article class="dsp${urgent ? ' urgent' : ''}">
        <div class="dsp-head">
          <span class="dsp-count tone-${countdown.tone}">
            <b>${esc(countdown.value)}</b><span>${esc(countdown.unit)}</span>
          </span>
          <div class="dsp-id">
            <b class="mono">${esc(dispute.orderName ?? 'commande inconnue')}</b>
            <span class="tag tone-${
              dispute.status === 'NEEDS_RESPONSE' ? 'bad' : 'go'
            }">${esc(DISPUTE_STATUS[dispute.status] ?? dispute.status)}</span>
          </div>
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
                        trackTone(item.status)
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
// Le sigle court est ce qui s'affiche en barre haute : cinq cadrans sans
// aucun nom obligeaient à compter les positions pour savoir lequel est Paris.
const CLOCKS = [
  ['Agadir', 'Africa/Casablanca', 'ma', 'AGA'],
  ['Paris', 'Europe/Paris', 'fr', 'PAR'],
  ['Chine', 'Asia/Shanghai', 'cn', 'CHN'],
  ['New York', 'America/New_York', 'us', 'NYC'],
  ['Los Angeles', 'America/Los_Angeles', 'us', 'LAX'],
];

/** Aiguilles ou chiffres — un goût, pas une vérité : mémorisé par navigateur. */
function clockStyle() {
  return localStorage.getItem('csav.clocks') === 'digital' ? 'digital' : 'analog';
}

/**
 * L'état de chaque ville, calculé une fois et servi aux deux rendus.
 *
 * La barre haute et le panneau doivent dire la même chose : deux calculs
 * séparés finiraient par diverger d'une minute, et une horloge qui se
 * contredit ne sert plus à rien.
 */
function cityTimes(now) {
  return CLOCKS.map(([city, zone, code, short]) => {
    const time = now.toLocaleTimeString('fr-FR', {
      timeZone: zone,
      hour: '2-digit',
      minute: '2-digit',
    });

    const hour = Number(
      now.toLocaleString('en-GB', { timeZone: zone, hour: '2-digit', hour12: false }),
    );

    // Décalage avec l'heure du poste : c'est la question qu'on se pose avant
    // d'appeler — « chez lui, il est quelle heure par rapport à moi ? ».
    const there = new Date(now.toLocaleString('en-US', { timeZone: zone }));
    const here = new Date(now.toLocaleString('en-US'));
    const offset = Math.round((there - here) / 3600000);

    // Heures ouvrées locales : appeler un fournisseur à 3 h du matin chez lui
    // ne sert à rien, et c'est l'erreur que ces horloges évitent.
    const open = hour >= 9 && hour < 18;

    return { city, zone, code, short, time, hour, open, offset };
  });
}

/*
 * Deux étages.
 *
 * En barre haute : des pastilles numériques — sigle, heure en chiffres nets,
 * point vert ou ambre. C'est ce qu'une barre haute sait faire : se lire en un
 * coup d'œil, sans se déchiffrer.
 *
 * Au clic : un panneau où les cadrans de manufacture ont enfin la place
 * d'être beaux — grands, nommés, avec le décalage horaire et l'état
 * joignable. Le luxe en grand, l'utile en petit : à 36 px, une aiguille ne
 * fait pas la manufacture, elle fait du bruit.
 */
function renderClocks() {
  const now = new Date();

  $('clocks').innerHTML = cityTimes(now)
    .map(
      (c) => `<button class="ckp${c.open ? '' : ' shut'}" type="button"
        title="${esc(c.city)} — ${c.open ? 'heures ouvrées' : 'hors horaires (9 h – 18 h locales)'}">
        <span class="ckp-dot" aria-hidden="true"></span>
        <span class="ckp-city">${esc(c.short)}</span>
        <b class="ckp-time">${c.time}</b>
      </button>`,
    )
    .join('');

  if (!$('clockpop')?.hidden) renderClockPop();
}

/** Grand cadran de manufacture — le même que la barre portait, en 96 px. */
function bigDial(c, now) {
  const minute = now.getMinutes();
  const hourAngle = ((c.hour % 12) + minute / 60) * 30;
  const minuteAngle = minute * 6 + now.getSeconds() / 10;
  const secondsOffset = -(now.getSeconds() + now.getMilliseconds() / 1000);

  return `<span class="dial-zoom clock-${c.code}"><span class="dial" aria-hidden="true">
    <i class="dial-ring"></i>
    <i class="dial-face"></i>
    <i class="dial-h" style="transform: rotate(${hourAngle}deg)"></i>
    <i class="dial-m" style="transform: rotate(${minuteAngle}deg)"></i>
    <i class="dial-s" style="animation-delay: ${secondsOffset}s"></i>
    <i class="dial-cap"></i>
  </span></span>`;
}

function renderClockPop() {
  const pop = $('clockpop');
  if (!pop) return;

  const now = new Date();
  const digital = clockStyle() === 'digital';

  pop.innerHTML = cityTimes(now)
    .map(
      (c) => `<div class="ckcard${c.open ? '' : ' shut'}">
        ${
          digital
            ? `<div class="wface wface-big${c.open ? '' : ' shut'}">
                 <b>${esc(c.city)}</b>
                 <span class="wface-time">${c.time}</span>
               </div>`
            : bigDial(c, now)
        }
        <div class="ckcard-meta">
          <b>${esc(c.city)}</b>
          <span class="ckcard-time">${c.time}</span>
          <span class="ckcard-sub">${
            c.offset === 0 ? 'même heure' : `${c.offset > 0 ? '+' : '−'}${Math.abs(c.offset)} h`
          } · ${c.open ? '<i class="ok">joignable</i>' : 'hors horaires'}</span>
        </div>
      </div>`,
    )
    .join('');
}

function toggleClockPop(force) {
  const pop = $('clockpop');
  if (!pop) return;

  const show = force ?? pop.hidden;
  pop.hidden = !show;
  if (show) renderClockPop();
}

$('clocks')?.addEventListener('click', () => toggleClockPop());

document.addEventListener('click', (event) => {
  const pop = $('clockpop');
  if (!pop || pop.hidden) return;
  if (event.target.closest('#clockpop') || event.target.closest('#clocks')) return;
  pop.hidden = true;
});

setInterval(renderClocks, 30000);

/* ------------------------------------------------------------ navigation */

/* Icônes en ligne : une police d'icônes ou un CDN ne passerait pas la
   politique de sécurité, et douze glyphes ne justifient pas un build. */
const ICONS = {
  bolt: '<path d="M9 1.5 3.5 9h3.6L7 14.5 12.5 7H8.9z"/>',
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
/* ============================================================ reshipment --
   Les retours clients, et le stock France qu'ils deviennent.

   Le circuit : le client renvoie (taille, défaut, modèle, ou remboursement
   sec) → l'agence du pays réceptionne → la paire contrôlée est remise en
   stock France → la prochaine commande du même article part de ce stock au
   lieu de l'atelier. Rien ne se gâche, le client proche est livré en trois
   jours.

   Et le nerf du suivi : un dossier sans nouvelle depuis trois jours se
   signale tout seul, avec la relance WhatsApp pré-écrite à un tap. */

const RETURN_REASONS = {
  SIZE: 'Taille',
  DEFECT: 'Défectueux',
  MODEL: 'Ne plaît pas',
  OTHER: 'Autre',
};

const RETURN_RESOLUTIONS = {
  EXCHANGE: 'Échange',
  REFUND: 'Remboursement',
};

const RETURN_STATUSES = {
  OPEN: 'Ouvert',
  LABEL_SENT: 'Bon envoyé',
  SHIPPED: 'Expédié',
  IN_TRANSIT: 'En transit',
  RECEIVED: "Livré à l'agence",
  RESTOCKED: 'En stock France',
  UNUSABLE: 'Inutilisable',
  CLOSED: 'Clos',
};

/** Suivi universel : 17track connaît les transporteurs chinois et européens. */
function trackUrl(number) {
  return `https://t.17track.net/fr#nums=${encodeURIComponent(number)}`;
}

/* La photo au dossier : compressée avant l'envoi, comme celles des colis. */
async function shrinkReturnPhoto(file) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1400 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  return canvas.toDataURL('image/jpeg', 0.72);
}

const RETURN_COUNTRIES = { FR: 'France', ES: 'Espagne', IT: 'Italie', BE: 'Belgique' };

state.returns = { cases: [], counts: {}, agencies: [], matches: [], tab: 'cases', country: 'FR' };

async function loadReturns() {
  try {
    const [data, agencies] = await Promise.all([
      api('/api/returns'),
      api('/api/return-agencies'),
    ]);
    state.returns.cases = data.cases ?? [];
    state.returns.counts = data.counts ?? {};
    state.returns.agencies = agencies.agencies ?? [];
  } catch (error) {
    toast(error.message, true);
    return;
  }

  // Le match interroge Shopify : plus lent, il arrive après coup plutôt que
  // de retenir tout l'écran.
  renderReturns();
  void api('/api/returns/matches')
    .then((data) => {
      state.returns.matches = data.matches ?? [];
      renderReturns();
    })
    .catch(() => {});
}

/** Relance WhatsApp pré-écrite : le message part du contexte du dossier. */
function returnWaLink(item) {
  const digits = (item.customerPhone ?? '').replace(/[^\d+]/g, '').replace(/^\+/, '');
  if (!digits) return null;

  const brand = state.me?.merchant?.brandName || state.me?.merchant?.name || '';
  const text = item.labelSent
    ? `Bonjour${item.customerName ? ` ${item.customerName}` : ''}, avez-vous pu déposer le colis retour de votre commande ${item.orderName ?? ''} (${item.productTitle}) ? Dites-nous si quelque chose bloque. — ${brand}`
    : `Bonjour${item.customerName ? ` ${item.customerName}` : ''}, nous revenons vers vous au sujet du retour de votre commande ${item.orderName ?? ''} (${item.productTitle}). — ${brand}`;

  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

function renderReturns() {
  const box = $('ret-body');
  const r = state.returns;

  $('ret-n-open').textContent = String(r.counts.open ?? 0);
  $('ret-n-match').textContent = String(r.matches.length);
  $('ret-n-stock').textContent = String(r.counts.stock ?? 0);

  document
    .querySelectorAll('#ret-tabs [data-rtab]')
    .forEach((tab) => tab.setAttribute('aria-pressed', String(tab.dataset.rtab === r.tab)));

  if (r.tab === 'cases') return renderReturnCases(box);
  if (r.tab === 'matches') return renderReturnMatches(box);
  if (r.tab === 'stock') return renderReturnStock(box);
  renderReturnAgencies(box);
}

function renderReturnCases(box) {
  const items = state.returns.cases.filter(
    (item) => !['CLOSED', 'UNUSABLE'].includes(item.status),
  );
  const silentSince = Date.now() - 3 * 24 * 60 * 60 * 1000;

  if (items.length === 0) {
    box.innerHTML = `<div class="empty-block">
      <b>Aucun dossier de retour en cours.</b>
      <p>Le circuit : le client renvoie → l'agence du pays réceptionne → la
      paire contrôlée entre au stock France → la prochaine commande du même
      article part de ce stock, livrée en trois jours au lieu de quinze.</p>
      <p>« Nouveau retour » ouvre le premier dossier — tapez le numéro de
      commande, le reste se remplit tout seul. Pensez d'abord à renseigner
      vos agences dans l'onglet Agences.</p>
    </div>`;
    return;
  }

  box.innerHTML = `<div class="table-wrap"><table class="grid"><thead><tr>
      <th>Commande</th><th>Client</th><th>Article</th>
      <th>Bon de retour</th><th>Colis retour</th><th>Statut</th><th></th>
    </tr></thead><tbody>
    ${items
      .map((item) => {
        const silent =
          ['OPEN', 'LABEL_SENT'].includes(item.status) &&
          new Date(item.lastContactAt).getTime() < silentSince;
        const wa = returnWaLink(item);

        return `<tr data-ret="${esc(item.id)}"${silent ? ' class="ret-silent"' : ''}>
          <td><b>${esc(item.orderName ?? '—')}</b><br /><small>${esc(
            RETURN_COUNTRIES[item.country] ?? item.country ?? '',
          )}</small></td>
          <td>${esc(item.customerName ?? '—')}${
            silent
              ? '<br /><span class="ret-tag bad">3 j sans réponse</span>'
              : ''
          }</td>
          <td>
            <b>${esc(item.productTitle)}</b>${
              item.variantTitle ? ` <small>${esc(item.variantTitle)}</small>` : ''
            }
            <div class="ret-tags">
              <span class="ret-tag ${item.reason === 'DEFECT' ? 'warn' : 'dim'}">${esc(
                RETURN_REASONS[item.reason] ?? item.reason,
              )}</span>
              <span class="ret-tag ${item.resolution === 'REFUND' ? 'warn' : 'ok'}">${esc(
                RETURN_RESOLUTIONS[item.resolution] ?? item.resolution,
              )}</span>
            </div>
          </td>
          <td>
            <label class="switch" style="margin:0">
              <input type="checkbox" data-ret-label="${esc(item.id)}"${
                item.labelSent ? ' checked' : ''
              } />
              <span>${item.labelSent ? 'Fourni' : 'À fournir'}</span>
            </label>
          </td>
          <td>
            <div class="ret-track">
              <input type="text" class="mono" data-ret-track="${esc(item.id)}"
                placeholder="N° de suivi" value="${esc(item.trackingNumber ?? '')}" />
              ${
                item.trackingNumber
                  ? `<a class="qlink" href="${esc(trackUrl(item.trackingNumber))}"
                      target="_blank" rel="noopener">Où est-il ?</a>`
                  : ''
              }
            </div>
          </td>
          <td>
            <select data-ret-status="${esc(item.id)}">
              ${Object.entries(RETURN_STATUSES)
                .map(
                  ([key, label]) =>
                    `<option value="${key}"${key === item.status ? ' selected' : ''}>${esc(
                      label,
                    )}</option>`,
                )
                .join('')}
            </select>
          </td>
          <td style="white-space:nowrap">
            ${
              wa
                ? `<button class="ret-wa" data-ret-wa="${esc(item.id)}" title="Relancer sur WhatsApp">✆ WhatsApp</button>`
                : ''
            }
            ${
              item.hasPhoto
                ? `<a class="btn btn-small" href="/api/returns/${esc(
                    item.id,
                  )}/photo" target="_blank" rel="noopener">Photo</a>`
                : ''
            }
            <label class="ico" title="${item.hasPhoto ? 'Remplacer la photo' : 'Ajouter une photo de l’article'}">
              <svg viewBox="0 0 20 20" aria-hidden="true">
                <rect x="2.5" y="5.5" width="15" height="11" rx="2" />
                <circle cx="10" cy="11" r="3.2" />
                <path d="M7 5.5 8.2 3.5h3.6L13 5.5" />
              </svg>
              <input type="file" accept="image/*" hidden data-ret-photo="${esc(item.id)}" />
            </label>
            <button class="ico ico-del" data-ret-del="${esc(item.id)}" title="Supprimer">
              <svg viewBox="0 0 20 20" aria-hidden="true">
                <path d="M4 6h12M8.5 6V4.5h3V6M6 6l.8 10h6.4L14 6M8.4 9v4.6M11.6 9v4.6" />
              </svg>
            </button>
          </td>
        </tr>`;
      })
      .join('')}
    </tbody></table></div>`;
}

function renderReturnMatches(box) {
  const matches = state.returns.matches;

  box.innerHTML = matches.length
    ? `<div class="table-wrap"><table class="grid"><thead><tr>
        <th>Commande en attente</th><th>Client</th><th>Article</th>
        <th>Paire disponible</th><th></th>
      </tr></thead><tbody>
      ${matches
        .map(
          (match) => `<tr>
            <td><b>${esc(match.orderName)}</b><br /><small>${esc(
              RETURN_COUNTRIES[match.country] ?? match.country,
            )}</small></td>
            <td>${esc(match.customer ?? '—')}</td>
            <td>${esc(match.productTitle)}${
              match.variantTitle ? `<br /><small>${esc(match.variantTitle)}</small>` : ''
            }</td>
            <td><span class="ret-tag ok">retour ${esc(match.fromOrder ?? '—')}</span></td>
            <td><button class="btn btn-small btn-primary" data-ret-use="${esc(
              match.returnId,
            )}" data-ret-order="${esc(match.orderName)}">Réexpédier cette paire</button></td>
          </tr>`,
        )
        .join('')}
      </tbody></table></div>`
    : `<p class="empty" style="padding:20px">
        Aucun match pour le moment. Dès qu'une commande FR / ES / IT / BE porte
        un article présent dans le stock France, elle apparaît ici.
      </p>`;
}

function renderReturnStock(box) {
  const stock = state.returns.cases.filter(
    (item) => item.status === 'RESTOCKED' && !item.reusedAt,
  );

  box.innerHTML = stock.length
    ? `<div class="ret-grid">${stock
        .map(
          (item) => `<div class="ret-card">
            <b>${esc(item.productTitle)}</b>
            <small>${esc([item.variantTitle, item.sku].filter(Boolean).join(' · '))}</small>
            <small>retour ${esc(item.orderName ?? '—')} · ${esc(
              RETURN_REASONS[item.reason] ?? '',
            )}</small>
          </div>`,
        )
        .join('')}</div>`
    : `<p class="empty" style="padding:20px">
        Rien en stock France. Les retours passés « En stock France » dans les
        dossiers arrivent ici, prêts au réemploi.
      </p>`;
}

function renderReturnAgencies(box) {
  const country = state.returns.country;
  const agencies = state.returns.agencies.filter((agency) => agency.country === country);

  box.innerHTML = `
    <div class="ret-country-tabs chips" style="margin:0 0 12px">
      ${Object.entries(RETURN_COUNTRIES)
        .map(
          ([code, label]) =>
            `<button type="button" data-ret-country="${code}" aria-pressed="${
              code === country
            }">${esc(label)}</button>`,
        )
        .join('')}
    </div>
    ${
      agencies.length
        ? `<div class="ret-grid">${agencies
            .map(
              (agency) => `<div class="ret-card">
                <b>${esc(agency.name)}</b>
                ${agency.email ? `<small>✉ ${esc(agency.email)}</small>` : ''}
                ${agency.phone ? `<small>✆ ${esc(agency.phone)}</small>` : ''}
                ${agency.address ? `<small>${esc(agency.address)}</small>` : ''}
                ${agency.notes ? `<small>${esc(agency.notes)}</small>` : ''}
                <button class="qlink" data-agency-del="${esc(agency.id)}"
                  style="align-self:flex-start;padding:2px 0">Supprimer</button>
              </div>`,
            )
            .join('')}</div>`
        : `<p class="empty" style="padding:8px 0 16px">Aucune agence en ${esc(
            RETURN_COUNTRIES[country],
          )} pour le moment.</p>`
    }
    <div class="ret-card" style="max-width:420px;margin-top:12px">
      <b>Ajouter une agence — ${esc(RETURN_COUNTRIES[country])}</b>
      <input type="text" id="agency-f-name" placeholder="Nom de l'agence" />
      <input type="email" id="agency-f-email" placeholder="Email" />
      <input type="text" id="agency-f-phone" placeholder="Téléphone" />
      <textarea id="agency-f-address" placeholder="Adresse complète"></textarea>
      <textarea id="agency-f-notes" placeholder="Notes (horaires, interlocuteur…)"></textarea>
      <button class="btn btn-primary" id="agency-f-save">Ajouter</button>
    </div>`;
}

$('open-palettes')?.addEventListener('click', () => setView('palettes'));

$('ret-tabs').addEventListener('click', (event) => {
  const tab = event.target.closest('[data-rtab]');
  if (!tab) return;
  state.returns.tab = tab.dataset.rtab;
  renderReturns();
});

$('ret-body').addEventListener('click', async (event) => {
  const countryTab = event.target.closest('[data-ret-country]');
  if (countryTab) {
    state.returns.country = countryTab.dataset.retCountry;
    renderReturns();
    return;
  }

  const save = event.target.closest('#agency-f-save');
  if (save) {
    const name = $('agency-f-name').value.trim();
    if (!name) return toast("Le nom de l'agence est obligatoire.", true);
    try {
      await api('/api/return-agencies', {
        method: 'POST',
        body: JSON.stringify({
          country: state.returns.country,
          name,
          email: $('agency-f-email').value.trim() || null,
          phone: $('agency-f-phone').value.trim() || null,
          address: $('agency-f-address').value.trim() || null,
          notes: $('agency-f-notes').value.trim() || null,
        }),
      });
      toast('Agence ajoutée.');
      await loadReturns();
    } catch (error) {
      toast(error.message, true);
    }
    return;
  }

  const delAgency = event.target.closest('[data-agency-del]');
  if (delAgency) {
    if (!confirm('Supprimer cette agence ?')) return;
    try {
      await api(`/api/return-agencies/${delAgency.dataset.agencyDel}`, { method: 'DELETE' });
      await loadReturns();
    } catch (error) {
      toast(error.message, true);
    }
    return;
  }

  const wa = event.target.closest('[data-ret-wa]');
  if (wa) {
    const item = state.returns.cases.find((candidate) => candidate.id === wa.dataset.retWa);
    const link = item && returnWaLink(item);
    if (!link) return;
    window.open(link, '_blank', 'noopener');
    // Le message est parti (ou presque) : le compteur de silence repart,
    // sinon le dossier resterait rouge après la relance.
    try {
      await api(`/api/returns/${item.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ touch: true }),
      });
      await loadReturns();
    } catch {}
    return;
  }

  const use = event.target.closest('[data-ret-use]');
  if (use) {
    if (
      !confirm(
        `Confier la commande ${use.dataset.retOrder} à cette paire du stock France ? Le dossier de retour sera clos.`,
      )
    )
      return;
    try {
      await api(`/api/returns/${use.dataset.retUse}`, {
        method: 'PATCH',
        body: JSON.stringify({ reusedOrderName: use.dataset.retOrder }),
      });
      toast(`Paire réservée pour ${use.dataset.retOrder}. Pensez à prévenir l'agence.`);
      await loadReturns();
    } catch (error) {
      toast(error.message, true);
    }
    return;
  }

  const del = event.target.closest('[data-ret-del]');
  if (del) {
    if (!confirm('Supprimer ce dossier de retour ?')) return;
    try {
      await api(`/api/returns/${del.dataset.retDel}`, { method: 'DELETE' });
      await loadReturns();
    } catch (error) {
      toast(error.message, true);
    }
  }
});

$('ret-body').addEventListener('change', async (event) => {
  const photoInput = event.target.closest('[data-ret-photo]');
  if (photoInput?.files?.[0]) {
    try {
      const photo = await shrinkReturnPhoto(photoInput.files[0]);
      await api(`/api/returns/${photoInput.dataset.retPhoto}`, {
        method: 'PATCH',
        body: JSON.stringify({ photo }),
      });
      toast('Photo ajoutée au dossier.');
      await loadReturns();
    } catch (error) {
      toast(error.message, true);
    }
    return;
  }

  const track = event.target.closest('[data-ret-track]');
  const label = event.target.closest('[data-ret-label]');
  const status = event.target.closest('[data-ret-status]');
  if (!track && !label && !status) return;

  const id = track?.dataset.retTrack ?? label?.dataset.retLabel ?? status?.dataset.retStatus;
  try {
    await api(`/api/returns/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(
        track
          ? // Un numéro saisi vaut colis expédié : le statut suit tout seul,
            // sauf s'il est déjà plus avancé.
            {
              trackingNumber: track.value.trim() || null,
              ...(track.value.trim() &&
              ['OPEN', 'LABEL_SENT'].includes(
                state.returns.cases.find((candidate) => candidate.id === id)?.status,
              )
                ? { status: 'SHIPPED' }
                : {}),
            }
          : label
            ? { labelSent: label.checked }
            : { status: status.value },
      ),
    });
    await loadReturns();
  } catch (error) {
    toast(error.message, true);
    await loadReturns();
  }
});

$('ret-new').addEventListener('click', () => {
  for (const id of ['ret-f-order', 'ret-f-name', 'ret-f-phone', 'ret-f-product', 'ret-f-variant', 'ret-f-sku', 'ret-f-note']) {
    $(id).value = '';
  }
  $('ret-f-reason').value = 'SIZE';
  $('ret-f-resolution').value = 'EXCHANGE';
  $('ret-f-country').value = 'FR';
  $('ret-f-items').innerHTML = '';
  retLookupEmail = null;
  retLookupOrderId = null;
  $('ret-f-agency').innerHTML =
    '<option value="">—</option>' +
    state.returns.agencies
      .map(
        (agency) =>
          `<option value="${esc(agency.id)}">${esc(agency.name)} (${esc(agency.country)})</option>`,
      )
      .join('');
  $('return-modal').classList.add('open');
});

/*
 * Le numéro de commande remplit le formulaire tout seul.
 *
 * Tout ce que le dossier demande est déjà dans la commande : client,
 * téléphone, pays, article. On tape « 11363 », le reste s'écrit — et quand la
 * commande porte plusieurs articles, chacun se choisit d'un clic.
 */
let retLookupEmail = null;
let retLookupOrderId = null;
let retLookupTimer = null;

$('ret-f-order').addEventListener('input', () => {
  clearTimeout(retLookupTimer);
  const name = $('ret-f-order').value.trim();
  if (name.replace(/\D/g, '').length < 3) return;

  retLookupTimer = setTimeout(async () => {
    let order;
    try {
      ({ order } = await api(`/api/returns/order-lookup?name=${encodeURIComponent(name)}`));
    } catch {
      return; // Un numéro en cours de frappe n'est pas une erreur.
    }

    $('ret-f-order').value = order.orderName;
    $('ret-f-name').value = order.customerName ?? '';
    $('ret-f-phone').value = order.customerPhone ?? '';
    if (order.country && $('ret-f-country').querySelector(`[value="${order.country}"]`)) {
      $('ret-f-country').value = order.country;
    }
    retLookupEmail = order.customerEmail;
    retLookupOrderId = order.shopifyOrderId;

    const items = order.lineItems ?? [];
    if (items[0]) {
      $('ret-f-product').value = items[0].title;
      $('ret-f-variant').value = items[0].variantTitle ?? '';
      $('ret-f-sku').value = items[0].sku ?? '';
    }

    // Plusieurs articles : des puces sous le champ, l'article se choisit au
    // doigt au lieu de se recopier.
    $('ret-f-items').innerHTML =
      items.length > 1
        ? items
            .map(
              (item, index) =>
                `<button type="button" class="qchip" data-ret-item="${index}"
                  aria-pressed="${index === 0}">${esc(item.title)}${
                    item.variantTitle ? ` · ${esc(item.variantTitle)}` : ''
                  }</button>`,
            )
            .join('')
        : '';
    $('ret-f-items').dataset.items = JSON.stringify(items);

    toast(`Commande ${order.orderName} : champs remplis.`);
  }, 450);
});

$('ret-f-items').addEventListener('click', (event) => {
  const chip = event.target.closest('[data-ret-item]');
  if (!chip) return;
  const items = JSON.parse($('ret-f-items').dataset.items ?? '[]');
  const item = items[Number(chip.dataset.retItem)];
  if (!item) return;

  $('ret-f-product').value = item.title;
  $('ret-f-variant').value = item.variantTitle ?? '';
  $('ret-f-sku').value = item.sku ?? '';
  $('ret-f-items')
    .querySelectorAll('[data-ret-item]')
    .forEach((other) => other.setAttribute('aria-pressed', String(other === chip)));
});

$('ret-f-cancel').addEventListener('click', () => $('return-modal').classList.remove('open'));
$('return-modal').addEventListener('click', (event) => {
  if (event.target === $('return-modal')) $('return-modal').classList.remove('open');
});

$('ret-f-save').addEventListener('click', async () => {
  const productTitle = $('ret-f-product').value.trim();
  if (!productTitle) return toast("L'article retourné est obligatoire.", true);

  try {
    await api('/api/returns', {
      method: 'POST',
      body: JSON.stringify({
        orderName: $('ret-f-order').value.trim() || null,
        shopifyOrderId: retLookupOrderId,
        customerEmail: retLookupEmail,
        customerName: $('ret-f-name').value.trim() || null,
        customerPhone: $('ret-f-phone').value.trim() || null,
        country: $('ret-f-country').value,
        productTitle,
        variantTitle: $('ret-f-variant').value.trim() || null,
        sku: $('ret-f-sku').value.trim() || null,
        reason: $('ret-f-reason').value,
        resolution: $('ret-f-resolution').value,
        agencyId: $('ret-f-agency').value || null,
        note: $('ret-f-note').value.trim() || null,
      }),
    });
    $('return-modal').classList.remove('open');
    toast('Dossier de retour créé.');
    state.returns.tab = 'cases';
    await loadReturns();
  } catch (error) {
    toast(error.message, true);
  }
});

const VIEW_META = {
  overview: { icon: 'grid', label: "Vue d'ensemble", group: 'Pilotage', title: "Vue d'ensemble" },
  tickets: { icon: 'inbox', label: 'SAV client', group: 'Pilotage', title: 'SAV client' },
  stats: { icon: 'chart', label: "Statistiques", group: 'Pilotage', title: "Statistiques d'équipe" },
  orders: { icon: 'bag', label: 'Commandes', group: 'Commerce', title: 'Commandes' },
  customers: { icon: 'users', label: 'Clients', group: 'Commerce', title: 'Clients' },
  catalog: { icon: 'box', label: 'Catalogue', group: 'Commerce', title: 'Catalogue' },
  suppliers: { icon: 'truck', label: 'Fournisseurs', group: 'Fournisseur', title: 'Contacts fournisseurs' },
  returns: { icon: 'box', label: 'Reshipment', group: 'Fournisseur', title: 'Reshipment — retours clients' },
  changes: { icon: 'bolt', label: 'Update', group: 'Fournisseur', title: 'Update — demandes de changement' },
  tracking: { icon: 'pin', label: 'Suivi colis', group: 'Fournisseur', title: 'Suivi des colis' },
  refunds: { icon: 'euro', label: 'Remboursements', group: 'Finance', title: 'Remboursements' },
  disputes: { icon: 'shield', label: 'Litiges Shopify', group: 'Finance', title: 'Litiges Shopify' },
  team: { icon: 'users', label: 'Équipe & rôles', group: 'Plateforme', title: 'Équipe & rôles' },
  canned: { icon: 'inbox', label: 'Réponses types', group: 'Plateforme', title: 'Réponses types' },
  // Absent de la navigation : l'apparence est un réglage, pas un écran de
  // travail — on y accède depuis Réglages.
  palettes: { icon: 'swatch', label: 'Palettes', group: 'Plateforme', title: 'Apparence', hidden: true },
  settings: { icon: 'gear', label: 'Réglages', group: 'Plateforme', title: 'Réglages' },
};

const NAV_GROUPS = ['Pilotage', 'Commerce', 'Fournisseur', 'Finance', 'Plateforme'];

const VIEWS = Object.keys(VIEW_META);

/**
 * Compte des demandes de changement en attente, pour la pastille rouge.
 *
 * Rafraîchi avec la file, mais au plus une fois par minute : la file se
 * recharge à chaque geste, et ce compte ne bouge que lorsqu'un fournisseur
 * répond.
 */
let changesCountAt = 0;

async function refreshChangesCount() {
  if (Date.now() - changesCountAt < 60_000) return;
  changesCountAt = Date.now();

  try {
    const [{ pending }, { counts }, activity, returns] = await Promise.all([
      api('/api/changes'),
      // Commandes, clients, catalogue, colis : les volumes, en gris. Seuls
      // les comptes qui réclament une action sont rouges.
      api('/api/nav-counts'),
      // Ce que les ateliers ont renvoyé : réponses aux escalades, signalements
      // depuis l'atelier, demandes traitées dont il faut informer le client.
      api('/api/supplier-activity'),
      // Retours silencieux : trois jours sans nouvelle du client, la pastille
      // rouge le dit avant que la paire ne soit perdue.
      api('/api/returns').catch(() => null),
    ]);

    state.changesPending = pending;
    state.supplierActivity = activity;
    state.navCounts = {
      ...state.navCounts,
      ...counts,
      changes: pending,
      /*
       * Deux compteurs, deux attentes opposées.
       *
       * « Update » compte ce que j'attends du fournisseur ; « Fournisseurs »
       * ce qu'il m'a rendu et que je n'ai pas repris. Les confondre dans un
       * seul chiffre ferait clignoter la navigation pour du travail qui n'est
       * pas le mien.
       */
      suppliers: activity.total,
      returns: returns?.counts?.silent ?? state.navCounts?.returns ?? 0,
    };
    renderNav();
  } catch {
    // Un compteur qui manque un tour vaut mieux qu'une erreur à l'écran.
  }
}

function renderNav() {
  // Recherche : on ne masque pas les groupes vides en les laissant en place,
  // ils laisseraient des titres orphelins au-dessus de rien.
  const needle = (state.navQuery ?? '').trim().toLowerCase();
  const matches = (view) =>
    !needle ||
    `${VIEW_META[view].label} ${VIEW_META[view].group}`.toLowerCase().includes(needle);

  $('nav').innerHTML = NAV_GROUPS.map((group) => {
    const items = VIEWS.filter(
      (view) => !VIEW_META[view].hidden && VIEW_META[view].group === group && matches(view),
    );
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
          /*
           * Deux familles de pastilles, deux couleurs.
           *
           * Les volumes — commandes, clients, catalogue, colis — informent :
           * ils sont gris. Les comptes qui réclament un geste — SAV, Update,
           * litiges, fournisseurs en attente — restent rouges, et Update
           * passe en rouge plein : une demande sans réponse est une promesse
           * faite à un client.
           */
          const dim = ['orders', 'customers', 'catalog', 'tracking'].includes(view);
          const hot = ['changes', 'suppliers', 'returns'].includes(view) && tally > 0;
          const shown = tally > 9999 ? '9999+' : tally;
          return `<button class="nav-item" data-view="${view}" aria-current="${
            view === state.view
          }">${ico(meta.icon)}<span class="nav-label">${esc(meta.label)}</span>${
            tally
              ? `<span class="tally${hot ? ' tally-hot' : dim ? ' tally-dim' : ''}">${shown}</span>`
              : ''
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

/* --------------------------------------------------- demandes de changement */

/**
 * L'écran « Changements » : toutes les demandes envoyées aux fournisseurs.
 *
 * Trié par le serveur, en attente d'abord. Chaque carte dit trois choses dans
 * l'ordre où l'on décide : ce qui change (44 → 45), ce que le fournisseur en
 * a fait, et si la commande était déjà expédiée — une taille à changer sur un
 * colis parti n'appelle plus la même réponse au client.
 */
state.changesRows = [];
state.changesFilter = 'PENDING';

async function loadChanges() {
  const rows = $('changes-rows');
  rows.innerHTML = '<p class="empty" style="padding:14px">Chargement…</p>';

  let data;
  try {
    data = await api('/api/changes');
  } catch (error) {
    rows.innerHTML = `<p class="empty" style="padding:14px">${esc(error.message)}</p>`;
    return;
  }

  state.changesRows = data.changes ?? [];
  state.changesPending = data.pending ?? 0;
  state.navCounts = { ...state.navCounts, changes: state.changesPending };
  renderNav();
  renderChangesScreen();
}

function renderChangesScreen() {
  const rows = $('changes-rows');
  const filter = state.changesFilter;
  const shown = filter
    ? state.changesRows.filter((change) => change.status === filter)
    : state.changesRows;

  $('changes-count').textContent = shown.length
    ? `${shown.length} demande${shown.length > 1 ? 's' : ''}`
    : '';

  rows.innerHTML =
    shown
      .map((change) => {
        const status = CHANGE_STATUS[change.status] ?? CHANGE_STATUS.PENDING;

        return `<div class="chgc chgc-${status.tone}" data-chg-ticket="${esc(
          change.ticket?.id ?? '',
        )}">
          <div class="chgc-head">
            <b>${esc(CHANGE_KINDS[change.kind] ?? change.kind)}</b>
            ${change.orderName ? `<span class="tag tag-order">${esc(change.orderName)}</span>` : ''}
            <span class="tag tone-${status.tone}">${esc(status.label)}</span>
            ${
              change.orderShipped === null
                ? ''
                : change.orderShipped
                  ? '<span class="tag tone-bad">déjà expédiée</span>'
                  : '<span class="tag tone-ok">pas encore expédiée</span>'
            }
            <span class="chgc-when">${esc(dateTime(change.createdAt))}</span>
          </div>

          ${
            change.afterValue
              ? `<div class="chgc-swap">
                   <s>${esc(change.beforeValue ?? '—')}</s>
                   <span aria-hidden="true">→</span>
                   <b>${esc(change.afterValue)}</b>
                 </div>`
              : change.message
                ? `<p class="chgc-msg">${esc(change.message)}</p>`
                : ''
          }

          <div class="chgc-meta">
            ${
              // Le brouillon n'existe que sur une demande née d'un mail et
              // déjà répondue : le dire ici évite d'ouvrir pour vérifier.
              change.status !== 'PENDING' && change.ticket && !change.handledAt
                ? '<span class="chgc-draft">✉︎ réponse au client prête</span>'
                : ''
            }
            <span>${esc(change.supplier?.name ?? '—')}</span>
            ${
              change.ticket
                ? `<span>· ${esc(
                    change.ticket.customerName ?? change.ticket.customerEmail ?? '',
                  )}</span>`
                : ''
            }
            ${change.emailedAt ? '' : '<span class="set-alert">· mail non parti</span>'}
          </div>
          ${
            change.supplierNote
              ? `<p class="chgc-note">« ${esc(change.supplierNote)} »</p>`
              : ''
          }
          ${
            change.status === 'PENDING'
              ? `<button class="chgc-edit" data-chg-edit="${esc(
                  change.id,
                )}">Modifier</button>
                 <button class="chgc-cancel" data-chg-cancel="${esc(
                  change.id,
                )}">Annuler la demande</button>`
              : change.handledAt
                ? '<span class="chgc-done">✓ répercuté au client</span>'
                : `<button class="chgc-handled" data-chg-handled="${esc(
                    change.id,
                  )}">J’ai prévenu le client</button>`
          }
        </div>`;
      })
      .join('') ||
    `<p class="empty" style="padding:14px">${
      filter === 'PENDING'
        ? 'Aucune demande en attente — les fournisseurs sont à jour.'
        : 'Aucune demande.'
    }</p>`;

  // La carte ouvre le mail d'origine : c'est là qu'on répond au client une
  // fois le changement confirmé ou refusé.
  rows.querySelectorAll('[data-chg-ticket]').forEach((card) =>
    card.addEventListener('click', () => {
      const ticketId = card.dataset.chgTicket;
      if (!ticketId) return;
      setView('tickets');
      void selectTicket(ticketId);
    }),
  );

  rows.querySelectorAll('[data-chg-handled]').forEach((button) =>
    button.addEventListener('click', async (event) => {
      event.stopPropagation();
      button.disabled = true;
      try {
        await api(`/api/changes/${button.dataset.chgHandled}/handled`, {
          method: 'POST',
          body: '{}',
        });
        toast('Noté — la demande sort de vos retours fournisseur.');
        changesCountAt = 0;
        await loadChanges();
      } catch (error) {
        toast(error.message, true);
        button.disabled = false;
      }
    }),
  );

  // Corriger une demande en attente : le même formulaire que la création,
  // pré-rempli — l'annuler pour la refaire enverrait un second mail.
  rows.querySelectorAll('[data-chg-edit]').forEach((button) =>
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      const change = state.changesRows.find(
        (candidate) => candidate.id === button.dataset.chgEdit,
      );
      if (!change) return;

      $('alert-modal').dataset.supplier = change.supplier?.id ?? '';
      $('alert-modal').dataset.ticket = '';
      $('alert-modal').dataset.order = change.shopifyOrderId ?? '';
      $('alert-modal').dataset.editing = change.id;
      $('alert-who').textContent = change.supplier?.name
        ? `Demande à ${change.supplier.name}`
        : '';
      state.alertCtx = null;
      setAlertKind(change.kind);
      $('alert-before').value = change.beforeValue ?? '';
      $('alert-after').value = change.afterValue ?? '';
      $('alert-order').value = change.orderName ?? '';
      $('alert-message').value = change.message ?? '';
      renderAlertSuppliers();
      if (change.supplier?.id) $('alert-supplier').value = change.supplier.id;
      $('alert-modal').hidden = false;
      $('alert-modal').classList.add('open');
    }),
  );

  rows.querySelectorAll('[data-chg-cancel]').forEach((button) =>
    button.addEventListener('click', async (event) => {
      // Le clic sur « Annuler » ne doit pas aussi ouvrir le mail : la carte
      // entière est cliquable, et les deux gestes n'ont rien à voir.
      event.stopPropagation();

      if (!confirm('Annuler cette demande ? Elle disparaît aussi de l’atelier du fournisseur.')) {
        return;
      }

      button.disabled = true;
      try {
        await api(`/api/changes/${button.dataset.chgCancel}`, { method: 'DELETE' });
        toast('Demande annulée.');
        changesCountAt = 0;
        await loadChanges();
      } catch (error) {
        toast(error.message, true);
        button.disabled = false;
      }
    }),
  );
}

/*
 * Demande hors mail.
 *
 * Le bouton du mail pré-remplit depuis la commande rattachée ; ici tout part
 * de zéro — le client a appelé, ou l'erreur s'est vue dans la commande. Sans
 * ce chemin, l'écran Update savait afficher des demandes mais pas en créer.
 */
$('changes-new')?.addEventListener('click', () => {
  if (activeSuppliers().length === 0) {
    toast('Ajoutez d’abord un fournisseur dans l’écran Fournisseurs.', true);
    return;
  }

  $('alert-modal').dataset.supplier = '';
  $('alert-modal').dataset.ticket = '';
  $('alert-modal').dataset.order = '';
  $('alert-who').textContent = '';
  state.alertCtx = null;
  setAlertKind('SIZE');
  $('alert-order').value = '';
  $('alert-message').value = '';
  renderAlertSuppliers();
  $('alert-modal').hidden = false;
  $('alert-modal').classList.add('open');
  $('alert-order').focus();
});

$('changes-filters')?.addEventListener('click', (event) => {
  const chip = event.target.closest('[data-chg]');
  if (!chip) return;

  state.changesFilter = chip.dataset.chg;
  $('changes-filters')
    .querySelectorAll('.chip')
    .forEach((other) =>
      other.setAttribute('aria-pressed', String(other.dataset.chg === state.changesFilter)),
    );
  renderChangesScreen();
});

/* Chaque vue charge à sa première ouverture. Interroger Shopify pour un écran
   que personne ne regarde coûte une latence pour rien. */
const VIEW_LOADERS = {
  overview: () => loadOverview(),
  orders: () => !state.orders.loaded && loadOrders({ reset: true }),
  customers: () => !state.customers.loaded && loadCustomers({ reset: true }),
  catalog: () => !state.catalog.loaded && loadCatalog({ reset: true }),
  suppliers: () => {
    renderSuppliers();
    void renderSupplierActivity();
    void loadSupplierHub();
  },
  changes: () => loadChanges(),
  returns: () => loadReturns(),
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

  // « Nouvelle escalade » n'a d'objet que sur un ticket : affiché ailleurs — sur
  // les Réglages, par exemple — il promet une action que l'écran ne peut pas
  // rendre.
  const escalate = document.getElementById('new-escalation');
  if (escalate && view !== 'tickets') escalate.hidden = true;

  // L'alerte de traitement appartient à la file : ailleurs, elle décrirait un
  // problème sans rapport avec l'écran qu'on regarde.
  const alarm = document.getElementById('fail-alarm');
  if (alarm && view !== 'tickets') alarm.hidden = true;
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
  // Bandeau mince sur l'écran SAV : quatre cartes hautes repoussaient la file
  // sous la ligne de flottaison, alors que ces chiffres se consultent d'un
  // coup d'œil et ne se travaillent pas.
  $('kpis').classList.toggle('kpis-slim', view === 'tickets');
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
    body.innerHTML = `<tr><td colspan="7" class="empty">${esc(error.message)}</td></tr>`;
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
          <td>${dateTime(order.createdAt)}</td>
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

const FIN_LABELS = {
  PAID: 'Payée',
  PENDING: 'Paiement en attente',
  REFUNDED: 'Remboursée',
  PARTIALLY_REFUNDED: 'Partiellement remboursée',
  VOIDED: 'Annulée',
  AUTHORIZED: 'Autorisée',
};

const FUL_LABELS = {
  FULFILLED: 'Expédiée',
  UNFULFILLED: 'À expédier',
  PARTIALLY_FULFILLED: 'Partiellement expédiée',
  IN_TRANSIT: 'En transit',
  DELIVERED: 'Livrée',
  RESTOCKED: 'Remise en stock',
};

/**
 * Une commande, dans le panneau central.
 *
 * Elle vivait dans le rail latéral, en trois lignes de texte sous un fil de
 * discussion vide : un agent qui cherche ce qui a été acheté devait faire
 * défiler la page entière pour lire à la loupe ce que Shopify affiche en grand.
 * Ici elle occupe la place qui lui revient — articles avec leurs vignettes,
 * montants, statuts, adresse, colis.
 */
function orderDetailMarkup(order) {
  const fin = order.displayFinancialStatus;
  const ful = order.displayFulfillmentStatus;

  const items = (order.lineItems ?? [])
    .map(
      (item) => `<div class="ordv-item">
        ${
          item.image?.url
            ? `<img src="${esc(item.image.url)}" alt="" loading="lazy" />`
            : '<span class="ordv-noimg"></span>'
        }
        <div>
          <b>${esc(item.title)}</b>
          <span>${[item.variantTitle, item.sku ? `réf. ${item.sku}` : null]
            .filter(Boolean)
            .map(esc)
            .join(' · ')}</span>
        </div>
        <span class="ordv-qty mono">× ${item.quantity}</span>
      </div>`,
    )
    .join('');

  const parcels = (order.fulfillments ?? [])
    .flatMap((fulfillment) => fulfillment.trackingInfo ?? [])
    .filter((info) => info.number)
    .map(
      (info) => `<div class="ordv-row">
        <span>${esc(info.company ?? 'Transporteur')}</span>
        <button class="linklike mono" data-track="${esc(info.number)}"${
          info.url ? ` data-track-url="${esc(info.url)}"` : ''
        }>${esc(info.number)}</button>
      </div>`,
    )
    .join('');

  const address = order.shippingAddress;

  return `
    <div class="ordv-head">
      <div class="ordv-badges">
        <span class="tag ${fin === 'PAID' ? 'st-CLOSED' : 'st-NEEDS_REVIEW'}">${esc(
          FIN_LABELS[fin] ?? fin ?? '—',
        )}</span>
        <span class="tag ${
          ful === 'FULFILLED' || ful === 'DELIVERED' ? 'st-CLOSED' : 'st-NEW'
        }">${esc(FUL_LABELS[ful] ?? ful ?? '—')}</span>
        <span class="ordv-when">${dateTime(order.createdAt)}</span>
      </div>
      <b class="ordv-total mono">${esc(euro(order.totalPrice, order.currency))}</b>
    </div>

    <div class="ordv-items">${items || '<p class="empty">Aucun article.</p>'}</div>

    <div class="ordv-cols">
      <section>
        <span class="rail-title">Livraison</span>
        ${
          address
            ? `<p class="ordv-addr">${[
                address.name,
                address.address1,
                address.address2,
                `${address.zip ?? ''} ${address.city ?? ''}`.trim(),
                address.country,
              ]
                .filter(Boolean)
                .map(esc)
                .join('<br>')}</p>
               ${address.phone ? `<p class="ordv-addr mono">${esc(address.phone)}</p>` : ''}`
            : '<p class="empty">Aucune adresse.</p>'
        }
      </section>
      <section>
        <span class="rail-title">Colis</span>
        ${parcels || '<p class="empty">Aucun numéro de suivi.</p>'}
      </section>
    </div>`;
}

/**
 * Fiche complète d'une commande, par-dessus l'écran courant.
 *
 * Elle basculait sur l'écran SAV et se servait des panneaux du ticket : on
 * cliquait sur une commande et on se retrouvait dans les mails, la liste des
 * commandes perdue et rien à quoi revenir. Or consulter une commande n'est
 * pas traiter un mail — c'est une lecture, et une lecture se fait sans quitter
 * ce qu'on faisait.
 *
 * Le panneau réutilise la feuille latérale déjà employée pour la fiche client :
 * même geste pour fermer, même comportement au clavier, rien de nouveau à
 * apprendre.
 */
/**
 * Fiche complète d'une commande, par-dessus l'écran courant.
 *
 * Une fiche où l'on ne peut rien décider est une impasse : celle-ci porte les
 * trois fils que l'outil connaît — les mails du client sur cette commande, les
 * colis saisis par l'atelier, les demandes de changement en cours — et le
 * geste qui manquait : demander un changement au fournisseur depuis ici.
 */
async function openOrderSheet(id) {
  $('sheet-name').textContent = 'Commande';
  $('sheet-email').textContent = '';
  $('sheet-body').innerHTML = '<p class="empty">Chargement…</p>';
  $('sheet-wrap').hidden = false;

  let data;
  try {
    data = await api(`/api/orders/${encodeURIComponent(id)}`);
  } catch (error) {
    $('sheet-body').innerHTML = `<p class="empty">${esc(error.message)}</p>`;
    return;
  }

  const { order, tickets = [], parcels = [], changes = [] } = data;

  $('sheet-name').textContent = `Commande ${order.name}`;
  $('sheet-email').textContent = order.customer?.email ?? '';

  const tracking = (order.fulfillments ?? [])
    .flatMap((fulfillment) => fulfillment.trackingInfo ?? [])
    .find((info) => info.number);

  const section = (title, body) =>
    `<section class="sheet-group"><span class="rail-title">${title}</span>${body}</section>`;

  $('sheet-body').innerHTML =
    `<section class="sheet-group">${orderDetailMarkup(order)}</section>` +
    // Les gestes d'abord : c'est pour eux qu'on a ouvert la fiche.
    `<section class="sheet-group sheet-acts">
       <button class="btn btn-small btn-primary" id="ordv-change">⚡ Demander un changement</button>
       ${
         tracking
           ? `<button class="btn btn-small" data-track="${esc(tracking.number)}"${
               tracking.url ? ` data-track-url="${esc(tracking.url)}"` : ''
             }>Suivre le colis</button>`
           : ''
       }
       ${
         order.customer?.email
           ? `<button class="btn btn-small" id="ordv-customer">Fiche client</button>`
           : ''
       }
       <a class="btn btn-small" target="_blank" rel="noopener"
         href="https://${esc(state.me?.merchant?.shopDomain ?? '')}/admin/orders/${esc(
           String(order.id ?? '').split('/').pop() ?? '',
         )}">Ouvrir dans Shopify</a>
     </section>` +
    // Les demandes de changement : ce qu'on a déjà promis sur cette commande.
    (changes.length
      ? section(
          'Demandes au fournisseur',
          changes
            .map((change) => {
              const status = CHANGE_STATUS[change.status] ?? CHANGE_STATUS.PENDING;
              return `<div class="sheet-row" style="display:block">
                <b>${esc(CHANGE_KINDS[change.kind] ?? change.kind)}</b>
                ${
                  change.afterValue
                    ? ` <span class="mono">${esc(change.beforeValue ?? '—')} → ${esc(
                        change.afterValue,
                      )}</span>`
                    : ''
                }
                <span class="tag tone-${status.tone}">${esc(status.label)}</span>
                <span class="sub"> ${esc(change.supplier?.name ?? '')} · ${esc(
                  dateTime(change.createdAt),
                )}</span>
                ${
                  change.supplierNote
                    ? `<br><span class="sub">« ${esc(change.supplierNote)} »</span>`
                    : ''
                }
              </div>`;
            })
            .join(''),
        )
      : '') +
    // Les mails du client sur cette commande : la fiche mène à la conversation.
    (tickets.length
      ? section(
          'Messages SAV liés',
          tickets
            .map(
              (ticket) => `<div class="sheet-row clickable" data-ticket="${esc(ticket.id)}">
                <b>${esc(ticket.subject ?? '(sans objet)')}</b>
                <span class="tag tag-status st-${esc(ticket.status)}">${esc(
                  STATUS_LABELS[ticket.status] ?? ticket.status,
                )}</span>
                <span class="when">${esc(dateTime(ticket.lastMessageAt))}</span>
              </div>`,
            )
            .join(''),
        )
      : '') +
    // Les colis de l'atelier : ce que le fournisseur a réellement saisi,
    // photos d'étiquettes comprises — la version Shopify n'en sait rien.
    (parcels.length
      ? section(
          "Colis saisis par l'atelier",
          parcels
            .map(
              (parcel) => `<div class="sheet-row">
                <button class="linklike mono" data-track="${esc(
                  parcel.trackingNumber,
                )}">${esc(parcel.trackingNumber)}</button>
                <span class="sub">colis ${parcel.index}/${parcel.total}${
                  parcel.carrier ? ` · ${esc(parcel.carrier)}` : ''
                }${parcel.photoMime ? ' · 📷 étiquette' : ''}</span>
              </div>`,
            )
            .join(''),
        )
      : '');

  $('ordv-customer')?.addEventListener('click', () =>
    void openCustomerSheet(order.customer.email, order.customer.displayName ?? ''),
  );

  // La demande part pré-remplie : commande, article et déclinaison actuelle.
  // Ne rester à saisir que la nouvelle valeur, c'est ce qui fait qu'on le fait.
  $('ordv-change')?.addEventListener('click', () => {
    if (activeSuppliers().length === 0) {
      toast('Ajoutez d’abord un fournisseur dans l’écran Fournisseurs.', true);
      return;
    }

    closeCustomerSheet();
    $('alert-modal').dataset.supplier = '';
    $('alert-modal').dataset.ticket = '';
    $('alert-modal').dataset.order = order.id ?? '';
    $('alert-who').textContent = `Commande ${order.name} · ${
      order.customer?.displayName ?? order.customer?.email ?? ''
    }`;
    state.alertCtx = alertContextFromOrder(order);
    setAlertKind('SIZE');
    $('alert-order').value = order.name ?? '';
    $('alert-message').value = '';
    renderAlertSuppliers();
    $('alert-modal').hidden = false;
    $('alert-modal').classList.add('open');
    $('alert-after').focus();
  });

  $('sheet-body')
    .querySelectorAll('[data-ticket]')
    .forEach((row) =>
      row.addEventListener('click', () => {
        closeCustomerSheet();
        setView('tickets');
        void selectTicket(row.dataset.ticket);
      }),
    );
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
              <button class="btn btn-small btn-danger" data-mbx-purge="${esc(
                mailbox.id,
              )}">Effacer ses messages</button>
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

  // Emplacement du bandeau des messages orphelins. Rempli après coup : leur
  // nombre demande un comptage que la page des connexions n'a pas à attendre.
  const gmailBlock = `${gmailDetail}<div class="mbx-orphans" id="mbx-orphans" hidden></div>`;

  renderConnection($('set-gmail'), {
    label: boxes.length > 1 ? 'Boîtes mail' : 'Boîte mail',
    status: gmail.simulated
      ? 'simulée'
      : boxes.length === 0
        ? 'aucune'
        : `${boxes.length} connectée${boxes.length > 1 ? 's' : ''}`,
    connected: gmail.connected,
    simulated: gmail.simulated,
    detail: gmailBlock,
    // « Ajouter » et non « Reconnecter » : le même bouton sert aux deux, mais
    // c'est l'ajout qu'on cherche une fois la première boîte en place.
    actions: `<a class="btn btn-small${
      gmail.connected ? '' : ' btn-primary'
    }" href="/auth/google">${gmail.connected ? '＋ Ajouter une boîte' : 'Connecter Gmail'}</a>`,
  });

  // Effacement des tickets d'une boîte. Séparé du débranchement, qui conserve
  // l'historique à dessein : une boîte de travail débranchée garde son SAV, une
  // boîte branchée par erreur doit pouvoir disparaître entièrement.
  //
  // Voir aussi renderOrphans() plus bas : le courrier des boîtes débranchées
  // avant ce correctif n'a plus de carte d'où être effacé.
  $('set-gmail')
    .querySelectorAll('[data-mbx-purge]')
    .forEach((button) =>
      button.addEventListener('click', async () => {
        const address = button.closest('.mbx')?.querySelector('code')?.textContent ?? '';

        if (
          !confirm(
            `Effacer TOUS les messages venus de ${address} ?\n\n` +
              'Les messages, brouillons et pièces jointes partent avec eux. ' +
              'Irréversible.',
          )
        ) {
          return;
        }

        button.disabled = true;
        try {
          const result = await api(`/api/mailboxes/${button.dataset.mbxPurge}/tickets`, {
            method: 'DELETE',
          });
          toast(`${result.removed} message${result.removed > 1 ? 's' : ''} effacé${
            result.removed > 1 ? 's' : ''
          }.`);
          await loadQueue();
        } catch (error) {
          toast(error.message, true);
        } finally {
          button.disabled = false;
        }
      }),
    );

  renderOrphans();

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
              'adresse. Les messages déjà reçus sont conservés.',
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

  // WISMO croise les statuts au lieu de les remplacer : « WISMO à valider »
  // est une combinaison qui a du sens, un statut de plus n'en aurait pas.
  if (chip.id === 'chip-wismo') {
    state.queue.intent = state.queue.intent === 'WISMO' ? '' : 'WISMO';
    $('q-intent').value = state.queue.intent;
    await loadQueue();
    return;
  }

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
      `${progress.relabelled} message${progress.relabelled > 1 ? 's' : ''} réétiqueté${
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
/**
 * Relève Gmail, tolérante à l'échec.
 *
 * Elle ne doit jamais empêcher l'actualisation : une boîte débranchée ou un
 * jeton expiré rendraient la file impossible à recharger, alors que ce qui est
 * déjà en base reste parfaitement lisible. Renvoie le nombre de messages
 * entrés, ou `null` si la relève elle-même n'a pas abouti.
 */
async function pullMail({ revive = false } = {}) {
  if (!state.me?.gmail?.connected) return null;

  try {
    const result = await api('/api/mailboxes/sync', {
      method: 'POST',
      body: JSON.stringify({ revive }),
    });

    // La veille rallumée se dit : c'est elle qui fera entrer le courrier tout
    // seul ensuite, et le marchand doit savoir qu'il n'aura plus à cliquer.
    if (result.revived > 0) toast('Arrivée automatique du courrier réactivée.');

    // Une boîte muette parmi d'autres passerait inaperçue derrière un total
    // qui monte : elle se nomme, une fois, au moment où on la découvre.
    if (result.failed?.length) {
      toast(`Relève impossible sur ${result.failed.join(', ')}.`, true);
    }

    return result.ingested ?? 0;
  } catch {
    return null;
  }
}

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
    /*
     * Aller chercher le courrier avant de relire la base.
     *
     * « Actualiser » ne faisait que relire la base : quand la chaîne Pub/Sub
     * tombe — veille Gmail expirée, abonnement en panne, worker arrêté — rien
     * n'entre plus, et le bouton répond « à l'instant » sur une file qui n'a
     * pas bougé depuis la veille. Il fallait descendre dans Réglages cliquer
     * « Relever », donc connaître la panne pour la contourner.
     *
     * La relève suit le curseur d'historique : un appel par boîte, rien à
     * rattraper. Assez légère pour tourner à chaque tour, y compris
     * automatique.
     */
    // La veille ne se rallume qu'au clic : l'actualisation automatique passe
    // toutes les minutes, et réessayer aussi souvent une veille qui refuse de
    // repartir n'apporterait rien.
    const fetched = await pullMail({ revive: !silent });

    const jobs = [state.view === 'tickets' ? loadQueue() : VIEW_LOADERS[state.view]?.()];

    // Les indicateurs et le compteur de la navigation décrivent la file : ils
    // doivent suivre, quel que soit l'écran regardé.
    if (state.view === 'tickets') jobs.push(loadMetrics(), loadAudit());

    await Promise.all(jobs.filter(Boolean));
    state.lastRefresh = Date.now();

    // Le courrier ramené se dit, sinon rien ne distingue une relève qui a
    // trouvé quelque chose d'une relève qui n'a rien trouvé — et c'est
    // exactement la question qu'on se pose en cliquant.
    if (!silent && fetched !== null) {
      toast(
        fetched > 0
          ? `${fetched} nouveau${fetched > 1 ? 'x' : ''} message${fetched > 1 ? 's' : ''}.`
          : 'Aucun nouveau message.',
      );
    }
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

  if (state.tickets.length > 0) await selectTicket(state.tickets[0].id, { silent: true });
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
  button.addEventListener('click', () => {
    if (button.dataset.as === 'SUPPLIER') return;
    toggleSupplierPreview('');
    void setPreviewRole(button.dataset.as);
  }),
);

$('asbar-exit')?.addEventListener('click', () => setPreviewRole(''));

// Un rôle plus large que le sien n'est pas proposé : le serveur le refuserait
// silencieusement, et un bouton sans effet est pire qu'un bouton absent.
function trimPreviewChoices() {
  const rank = { OWNER: 3, SUPERVISOR: 2, AGENT: 1, VIEWER: 0 };
  const mine = rank[state.me?.realRole] ?? 0;
  document.querySelectorAll('#as-role [data-as]').forEach((button) => {
    const target = button.dataset.as;
    // « Fournisseur » n'est pas un rôle de l'équipe : il n'entre pas dans la
    // hiérarchie, et le comparer à la sienne le ferait disparaître pour tous.
    button.hidden =
      target !== 'SUPPLIER' && Boolean(target) && (rank[target] ?? 0) >= mine;
  });
}

/**
 * Vue fournisseur.
 *
 * Ce n'est pas un rôle : le fournisseur n'a pas de compte, il travaille sur un
 * lien signé. Sa « vue » est donc son atelier réel, ouvert avec son propre
 * jeton — pas une imitation dans le dashboard, qui divergerait de son écran
 * dès la première modification et donnerait confiance à tort.
 *
 * Le bouton menait jusqu'ici à l'écran Fournisseurs avec le conseil d'ouvrir
 * un espace de travail qui n'existait nulle part.
 */
function toggleSupplierPreview(role) {
  const box = $('as-supplier-box');
  if (!box) return;

  box.hidden = role !== 'SUPPLIER';
  if (box.hidden) return;

  const pick = $('as-supplier-pick');
  const usable = activeSuppliers();

  pick.innerHTML = usable.length
    ? usable
        .map((supplier) => `<option value="${esc(supplier.id)}">${esc(supplier.name)}</option>`)
        .join('')
    : '<option value="">Aucun fournisseur actif</option>';

  $('as-supplier').disabled = usable.length === 0;
}

document.querySelectorAll('#as-role [data-as]').forEach((button) => {
  if (button.dataset.as !== 'SUPPLIER') return;

  button.addEventListener('click', () => {
    // On ne change pas de rôle : on prépare l'ouverture de l'atelier.
    document.querySelectorAll('#as-role [data-as]').forEach((other) => {
      other.setAttribute('aria-pressed', String(other === button));
    });
    toggleSupplierPreview('SUPPLIER');
  });
});

$('as-supplier')?.addEventListener('click', async () => {
  const id = $('as-supplier-pick').value;
  if (!id) return;

  const button = $('as-supplier');
  button.disabled = true;

  try {
    // Sans révocation : ouvrir l'atelier pour le regarder ne doit pas couper
    // l'accès du fournisseur qui y travaille au même moment.
    const { url } = await api(`/api/suppliers/${id}/portal-link`, {
      method: 'POST',
      body: JSON.stringify({ revoke: false }),
    });

    window.open(url, '_blank', 'noopener');
  } catch (error) {
    toast(error.message, true);
  } finally {
    button.disabled = false;
  }
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
        hint: 'Message courant',
        run: () => snoozeTicket(choice.hours, choice.label),
      });
    }
    list.push({
      label: 'Écrire la réponse',
      hint: 'Message courant',
      run: () => $('d-body').focus(),
    });
  }

  if (hasTicket && canI('refund') && state.detail.ticket.shopifyOrderId) {
    list.push({
      label: 'Rembourser cette commande',
      hint: 'Message courant',
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
  // Tout porteur de `data-track`, et non les seuls liens : le bouton « Suivre
  // le colis » n'est pas un lien, et le câbler à part le ferait diverger.
  const button = event.target.closest('[data-track]');
  if (!button || button.closest('#tracking-rows')) return;
  void openTracking(button.dataset.track, button.dataset.trackUrl ?? null);
});

/* ==========================================================================
   TABLEAUX LISIBLES AU DOIGT
   ==========================================================================

   Un tableau de sept colonnes sur un écran de 390 pixels ne se lit pas : il
   défile latéralement, on perd la colonne de gauche, et l'on ne sait plus de
   quelle ligne vient la valeur qu'on regarde. La solution connue est de le
   replier en fiches, chaque cellule précédée de son intitulé.

   Encore faut-il que la cellule connaisse son intitulé. Plutôt que de le
   réécrire dans les neuf fonctions de rendu — neuf occasions d'oublier, et
   neuf endroits à corriger le jour où une colonne bouge —, on le recopie
   depuis l'en-tête après chaque rendu. Un observateur suffit, et il vaut aussi
   pour les tableaux qui n'existent pas encore. */

function stampCellLabels(tbody) {
  const table = tbody.closest('table');
  const heads = [...(table?.querySelectorAll('thead th') ?? [])].map((th) =>
    th.textContent.trim(),
  );
  if (heads.length === 0) return;

  for (const row of tbody.rows) {
    // Les lignes de message — « aucun résultat », « chargement » — occupent
    // toute la largeur et n'ont pas d'intitulé à porter.
    if (row.cells.length !== heads.length) continue;

    for (const [index, cell] of [...row.cells].entries()) {
      const label = heads[index];
      if (label) cell.dataset.label = label;
    }
  }
}

const tableWatcher = new MutationObserver((records) => {
  for (const record of records) {
    const target = record.target;
    if (target instanceof HTMLElement && target.tagName === 'TBODY') stampCellLabels(target);
  }
});

for (const tbody of document.querySelectorAll('.grid tbody')) {
  stampCellLabels(tbody);
  tableWatcher.observe(tbody, { childList: true });
}

$('refunds-range')?.addEventListener('click', (event) => {
  const button = event.target.closest('[data-days]');
  if (!button) return;
  refundDays = Number(button.dataset.days);
  void loadRefunds();
});

/* Essai du fournisseur d'IA. Le seul moyen, sans accès aux journaux, de savoir
   si le modèle répond — et sinon, ce qu'il reproche exactement. */
$('ai-test')?.addEventListener('click', async () => {
  const button = $('ai-test');
  const node = $('ai-test-state');

  button.disabled = true;
  node.textContent = 'Le modèle rédige un brouillon d’essai…';

  try {
    const result = await api('/api/ai/test', { method: 'POST', body: '{}' });

    // Le résumé et le début du brouillon sont affichés : lire ce que le modèle
    // produit vraiment en dit plus long qu'un « connexion réussie », et c'est
    // exactement ce qui doit apparaître sur les tickets.
    node.innerHTML =
      `<b style="color:var(--ok)">Le modèle rédige.</b> ${result.ms} ms · confiance ${
        Math.round((result.confidence ?? 0) * 100)
      } %<br>` +
      `<b>Demande :</b> ${esc(result.ask ?? '—')}<br>` +
      `<b>Résumé :</b> ${(result.summary ?? []).map((line) => esc(line)).join(' · ') || '—'}<br>` +
      `<b>Brouillon :</b> <i>${esc(result.preview ?? '')}…</i>`;

    // Les échecs déjà en base, regroupés par motif : si l'IA rédige mais que
    // les tickets échouent, la cause est ailleurs et c'est ici qu'elle se lit.
    try {
      const failures = await api('/api/tickets/failures');
      if (failures.total > 0) {
        node.innerHTML +=
          `<br><br><b class="set-alert">${failures.total} message${
            failures.total > 1 ? 's' : ''
          } en échec.</b> Motifs :<br>` +
          failures.reasons
            .map(
              (row) =>
                `<span class="mono" style="font-size:12px">${row.count} × ${esc(
                  row.reason,
                )}</span>`,
            )
            .join('<br>');
      }
    } catch {
      // Le diagnostic principal a déjà répondu : ne pas le gâcher pour un
      // complément.
    }

    {
      // La relance est proposée là où l'on vient de constater que la cause est
      // levée : la chercher ailleurs, c'est ne pas la faire.
      const retry = document.createElement('button');
      retry.className = 'btn btn-small btn-primary';
      retry.style.marginTop = '9px';
      retry.textContent = 'Relancer les messages en échec';
      retry.addEventListener('click', async () => {
        retry.disabled = true;
        retry.textContent = 'Relance…';
        try {
          const out = await api('/api/tickets/retry-failed', { method: 'POST', body: '{}' });
          toast(
            `${out.queued} ticket${out.queued > 1 ? 's' : ''} remis en traitement${
              out.remaining ? ' — relancez pour la suite.' : '.'
            }`,
          );
        } catch (error) {
          toast(error.message, true);
        } finally {
          retry.disabled = false;
          retry.textContent = 'Relancer les messages en échec';
        }
      });
      node.append(document.createElement('br'), retry);
    }
  } catch (error) {
    // Le message du fournisseur est reproduit tel quel : « invalid x-api-key »,
    // « insufficient balance » et « model not found » appellent trois gestes
    // différents, et un « échec » commun les rendrait tous inutiles.
    node.innerHTML =
      `<b class="set-alert">L’IA ne répond pas.</b><br>` +
      `<span class="mono" style="font-size:12px">${esc(error.message)}</span><br>` +
      `<span>Réglez la clé dans la console d’administration (<code>/admin</code>).</span>`;
  } finally {
    button.disabled = false;
  }
});

/* Pose des libellés sur les tickets déjà en base. Séparé du rattrapage : les
   étiquettes n'ont aucune raison d'attendre plusieurs minutes de balayage. */
$('labels-sync')?.addEventListener('click', async () => {
  const button = $('labels-sync');
  const node = $('labels-sync-state');

  button.disabled = true;
  node.textContent = 'Lecture des libellés dans Gmail…';

  try {
    const result = await api('/api/labels/sync', { method: 'POST', body: '{}' });
    node.innerHTML =
      result.updated > 0
        ? `<b style="color:var(--ok)">${result.updated} ticket${
            result.updated > 1 ? 's' : ''
          } étiqueté${result.updated > 1 ? 's' : ''}.</b> ` +
          'Les libellés sont utilisables comme filtres sur la file.'
        : '<b class="set-alert">Aucun ticket étiqueté.</b> Vos libellés existent dans ' +
          'Gmail mais ne portent sur aucun message déjà entré dans la file.';

    await loadLabelStyles();
  } catch (error) {
    node.innerHTML = `<b class="set-alert">${esc(error.message)}</b>`;
  } finally {
    button.disabled = false;
  }
});

/* ==========================================================================
   ALERTE DE TRAITEMENT
   ==========================================================================

   Le motif d'échec vivait dans un panneau des Réglages, sous un bouton de
   test. Personne ne va dans les Réglages pour comprendre pourquoi sa file ne
   produit rien : on regarde la file, on voit « Échec », et on n'a nulle part
   où aller. L'alerte s'affiche donc là où le problème se constate. */

async function checkFailures() {
  const bar = $('fail-alarm');
  if (!bar) return;

  let data;
  try {
    data = await api('/api/tickets/failures');
  } catch {
    bar.hidden = true;
    return;
  }

  if (!data.total) {
    bar.hidden = true;
    return;
  }

  bar.hidden = false;
  $('fail-alarm-title').textContent =
    `${data.total} message${data.total > 1 ? 's' : ''} n’${
      data.total > 1 ? 'ont' : 'a'
    } pas pu être traité${data.total > 1 ? 's' : ''} par l’IA.`;

  // Le motif dominant seul : les quatre suivants sont presque toujours le même
  // à une virgule près, et les lister ferait un mur là où il faut une phrase.
  const first = data.reasons?.[0];
  $('fail-alarm-reason').textContent = first
    ? ` Cause principale : ${first.reason}`
    : '';
}

$('fail-alarm-retry')?.addEventListener('click', async () => {
  const button = $('fail-alarm-retry');
  button.disabled = true;
  button.textContent = 'Relance…';

  try {
    const out = await api('/api/tickets/retry-failed', { method: 'POST', body: '{}' });
    toast(
      `${out.queued} ticket${out.queued > 1 ? 's' : ''} remis en traitement${
        out.remaining ? ' — relancez pour la suite.' : '.'
      }`,
    );
    await loadQueue();
  } catch (error) {
    toast(error.message, true);
  } finally {
    button.disabled = false;
    button.textContent = 'Relancer';
  }
});
