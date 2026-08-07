/**
 * Espace de travail du fournisseur — lien permanent, sans compte.
 *
 * Le geste du matin : ouvrir le lien, voir les commandes de la veille, saisir
 * un numéro de suivi et photographier l'étiquette pour chaque colis, signaler
 * ce qui coince. L'export Excel donne la même liste hors ligne.
 */

import { LANGS, LOCALES, pickLang, saveLang, translator } from './workspace.i18n.js';

const $ = (id) => document.getElementById(id);

const params = new URLSearchParams(window.location.search);
const token = params.get('token');
const supplierId = window.location.pathname.split('/').pop();

const state = {
  orders: [],
  issueOrder: null,
  lang: pickLang(supplierId),
  view: 'orders',
  filter: 'left',
  parcels: [],
  catalog: null,
  updates: [],
};

/*
 * `t` est réaffecté à chaque changement de langue plutôt que d'être une
 * fonction qui relit l'état : les rendus le capturent, et une capture d'une
 * traduction périmée afficherait deux langues sur le même écran.
 */
let t = translator(state.lang);
let locale = LOCALES[state.lang];

/**
 * Applique la langue au document.
 *
 * Le HTML porte ses propres clés (`data-t`, `data-tph`) au lieu d'être
 * reconstruit en JavaScript : la page reste lisible et fonctionnelle avec sa
 * langue d'origine si le dictionnaire venait à manquer, et une chaîne se
 * retrouve dans le fichier où elle s'affiche.
 */
function applyLang(lang) {
  state.lang = lang;
  t = translator(lang);
  locale = LOCALES[lang];
  saveLang(supplierId, lang);
  document.documentElement.lang = lang;
  document.title = t('doc.title');

  for (const node of document.querySelectorAll('[data-t]')) {
    node.textContent = t(node.dataset.t);
  }
  for (const node of document.querySelectorAll('[data-tph]')) {
    node.placeholder = t(node.dataset.tph);
  }

  renderLangPicker();
  // Les écrans construits en JavaScript se refont : ils ne portent pas de
  // `data-t`, leur texte est écrit au moment du rendu.
  if (state.orders.length) renderOrders();
  if (state.catalog) renderCatalog();
  if (state.view !== 'orders') setView(state.view);
  void loadAlerts();
}

function renderLangPicker() {
  const box = $('ws-lang');
  if (!box) return;

  box.innerHTML = LANGS.map(
    (entry) => `<button type="button" data-lang="${entry.code}" title="${entry.name}"
      aria-pressed="${entry.code === state.lang}">${entry.label}</button>`,
  ).join('');

  box.querySelectorAll('[data-lang]').forEach((button) =>
    button.addEventListener('click', () => applyLang(button.dataset.lang)),
  );
}

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

function apiUrl(path) {
  const url = new URL(path, window.location.origin);
  url.searchParams.set('token', token ?? '');
  if ($('ws-since').value) url.searchParams.set('since', $('ws-since').value);
  if ($('ws-until').value) url.searchParams.set('until', $('ws-until').value);
  return url;
}

async function api(path, options) {
  const response = await fetch(apiUrl(path), {
    method: options?.method ?? 'GET',
    headers: options?.body ? { 'content-type': 'application/json' } : undefined,
    body: options?.body ? JSON.stringify(options.body) : undefined,
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error ?? t('error.generic', { status: response.status }));
  return data;
}

/* Un cliché brut de téléphone pèse plusieurs mégaoctets : inenvoyable depuis
   la connexion d'un entrepôt, et inutile — une étiquette reste lisible à
   1 400 px. */
async function shrinkPhoto(file) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1400 / Math.max(bitmap.width, bitmap.height));

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();

  return canvas.toDataURL('image/jpeg', 0.72);
}

function photoUrl(parcelId) {
  return `/api/workspace/${supplierId}/parcels/${parcelId}/photo?token=${encodeURIComponent(
    token ?? '',
  )}&v=${Date.now()}`;
}

/** Articles dépliés par quantité : un exemplaire, un colis. */
function orderUnits(order) {
  return (order.lineItems ?? []).flatMap((item) =>
    Array.from({ length: Math.max(1, item.quantity) }, () => item),
  );
}

function parcelCard(order, index, total, saved) {
  // Un produit = un colis : la liste est dépliée par quantité, deux paires du
  // même modèle faisant deux cartons. « Colis 2/3 » seul ne dirait pas quoi
  // mettre dedans.
  /*
   * L'article de ce colis.
   *
   * La règle stricte « autant d'exemplaires que de colis » ne montrait rien
   * dès qu'on passait une commande d'un article à trois colis — c'est-à-dire
   * dans le cas où l'on a le plus besoin de savoir quoi mettre dedans. On
   * prend donc l'exemplaire de rang correspondant, et à défaut le premier
   * article de la commande : mieux vaut une photo approximative sur un colis
   * groupé que pas de photo du tout.
   */
  const units = orderUnits(order);
  const item = units[index - 1] ?? units[0] ?? null;

  /*
   * La photo du produit dans la carte du colis, pas sous l'adresse.
   *
   * Elle y figurait trois fois — sous le téléphone, dans le titre du colis, et
   * dans le champ à remplir. Or elle ne sert qu'à un moment : celui où l'on
   * attrape la paire avant de la mettre dans le carton. C'est donc là qu'elle
   * doit être, et nulle part ailleurs.
   */
  return `<div class="pk${saved ? ' done' : ''}" data-order="${esc(order.id)}" data-index="${index}"${
    saved ? ` data-pid="${esc(saved.id)}"` : ''
  }>
    <div class="pk-head">
      <span>${esc(t('parcel.head', { index, total }))}</span>
      ${
        saved?.trackingNumber
          ? `<span class="pk-done">✓ ${esc(t('parcel.saved'))}</span>`
          : ''
      }
    </div>

    ${
      item
        ? `<div class="pk-item">
             ${
               item.image
                 ? `<img class="pk-photo" src="${esc(item.image)}" alt="" loading="lazy" />`
                 : '<span class="pk-photo pk-photo-none" aria-hidden="true"></span>'
             }
             <span class="pk-item-text">
               <b>${esc(item.title)}</b>
               <small>${esc(
                 [item.variantTitle, item.sku].filter(Boolean).join(' · '),
               )}</small>
             </span>
           </div>`
        : ''
    }

    <input type="text" data-field="tracking" autocapitalize="characters"
      inputmode="latin" enterkeyhint="done"
      placeholder="${esc(t('parcel.tracking'))}" value="${esc(saved?.trackingNumber ?? '')}" />
    <input type="text" data-field="carrier" placeholder="${esc(t('parcel.carrier'))}"
      value="${esc(saved?.carrier ?? '')}" />
    ${
      saved?.hasPhoto
        ? `<img class="pk-thumb" src="${photoUrl(saved.id)}" alt="${esc(
            t('parcel.label', { index }),
          )}" />`
        : '<img class="pk-thumb" hidden alt="" />'
    }
    <div class="pk-row">
      <label class="btn btn-small pk-shot">
        ${esc(saved?.hasPhoto ? t('parcel.reshoot') : t('parcel.shoot'))}
        <input type="file" accept="image/*" capture="environment" data-field="photo" />
      </label>
      <button class="btn btn-small btn-primary" data-save="1">${esc(t('parcel.save'))}</button>
    </div>
    ${
      saved
        ? `<button class="pk-del" data-del="${esc(saved.id)}"
             data-number="${esc(saved.trackingNumber)}">${esc(t('parcel.delete'))}</button>`
        : ''
    }
  </div>`;
}

/** Barre de progression : part remplie, et le compte en toutes lettres. */
function progressBar(done, total, label) {
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);
  // Le libellé avant la barre : placé après, il poussait la barre hors de
  // l'écran sur un téléphone, faute de pouvoir se replier.
  return `<div class="ws-progress${done === total ? ' full' : ''}">
    <span>${esc(label)}</span>
    <div class="ws-progress-bar"><i style="width:${pct}%"></i></div>
  </div>`;
}

/** Colis enregistrés sur une commande : ce qui fait avancer sa barre. */
function orderDone(order, total) {
  return (order.parcels ?? []).filter(
    (parcel) => parcel.index <= total && parcel.trackingNumber,
  ).length;
}

function renderOrders() {
  const totals = new Map(state.orders.map((order) => [order.id, parcelTotal(order)]));
  const isDone = (order) => {
    const total = totals.get(order.id) ?? 1;
    return total > 0 && orderDone(order, total) === total;
  };

  const finished = state.orders.filter(isDone).length;
  const left = state.orders.length - finished;

  $('count-left').textContent = String(left);
  $('count-all').textContent = String(state.orders.length);

  // Avancement de la journée, en tête : entre deux colis on ne se demande pas
  // combien il y en a, on se demande où l'on en est.
  const box = $('ws-progress');
  box.hidden = state.orders.length === 0;
  if (!box.hidden) {
    const pct = Math.round((finished / state.orders.length) * 100);
    $('ws-progress-fill').style.width = `${pct}%`;
    box.classList.toggle('full', finished === state.orders.length);
    $('ws-progress-text').textContent = t('progress.orders', {
      done: finished,
      total: state.orders.length,
    });
  }

  /*
   * Par défaut, on ne montre que ce qu'il reste à faire.
   *
   * Quatre-vingt-six commandes affichées d'un bloc, dont la moitié déjà
   * emballées, c'est une liste qu'on ne parcourt plus : on cherche sa place au
   * lieu de travailler. « Toutes » reste à un clic pour vérifier ce qu'on a
   * fait.
   */
  const shown =
    state.filter === 'left' ? state.orders.filter((order) => !isDone(order)) : state.orders;

  if (state.orders.length === 0) {
    $('ws-orders').innerHTML = emptyState(t('orders.empty'));
    return;
  }

  if (shown.length === 0) {
    $('ws-orders').innerHTML = emptyState(t('orders.allDone'), true);
    return;
  }

  $('ws-orders').innerHTML = shown
    .map((order) => {
      const address = order.shippingAddress ?? {};
      const phone = address.phone ?? '';
      // Un numéro trop court bloquera la livraison : autant que l'atelier le
      // voie avant d'emballer, pas le transporteur devant la porte.
      const phoneShort = phone.replace(/\D/g, '').length < 9;
      const total = totals.get(order.id) ?? 1;
      const done = orderDone(order, total);

      return `<article class="ord${done === total ? ' ord-done' : ''}">
        <div class="ord-head">
          <b class="ord-no">${esc(order.name)}</b>
          <span class="pill">${esc(order.displayFulfillmentStatus ?? '—')}</span>
          <span class="ord-when">${esc(shortMoment(order.createdAt))}</span>
        </div>

        <div class="ord-who">
          <b>${esc(order.customer?.displayName ?? address.name ?? t('orders.customer'))}</b>
          <span>${esc([address.address1, address.address2].filter(Boolean).join(' '))}</span>
          <span>${esc(`${address.zip ?? ''} ${address.city ?? ''} ${address.country ?? ''}`.trim())}</span>
          <span class="ord-tel">
            <a href="tel:${esc(phone)}" class="ord-phone${phoneShort ? ' missing' : ''}">${
              esc(phone || t('orders.phoneMissing'))
            }</a>
          </span>
        </div>

        ${progressBar(done, total, t('progress.parcels', { done, total }))}

        <label class="field field-inline">
          <span>${esc(t('orders.parcelCount'))}</span>
          <select data-total="${esc(order.id)}">
            ${[1, 2, 3, 4, 5, 6]
              .map(
                (value) =>
                  `<option value="${value}"${value === total ? ' selected' : ''}>${esc(
                    t('orders.parcelOption', { n: value }),
                  )}</option>`,
              )
              .join('')}
          </select>
        </label>

        <div class="pk-list" data-parcels="${esc(order.id)}">
          ${Array.from({ length: total }, (unused, position) =>
            parcelCard(
              order,
              position + 1,
              total,
              order.parcels?.find((parcel) => parcel.index === position + 1),
            ),
          ).join('')}
        </div>

        <div class="ord-foot">
          <button class="btn btn-ghost" data-issue="${esc(order.id)}">${esc(
            t('orders.report'),
          )}</button>
        </div>
      </article>`;
    })
    .join('');
}

/** Écran vide illustré : un message seul ressemble à une page qui n'a pas fini. */
function emptyState(message, good = false) {
  return `<div class="empty${good ? ' empty-good' : ''}">
    <span class="empty-mark" aria-hidden="true">${good ? '✓' : '—'}</span>
    <p>${esc(message)}</p>
  </div>`;
}

/**
 * Moment court : l'heure seule pour aujourd'hui, jour + heure sinon.
 *
 * `06/08/2026 23:56:20` occupait la moitié de l'en-tête pour trois
 * informations dont deux sont déjà données par le filtre de période, et des
 * secondes que personne ne lit.
 */
function shortMoment(iso) {
  const date = new Date(iso);
  const today = new Date().toDateString() === date.toDateString();
  const time = date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });

  return today
    ? time
    : `${date.toLocaleDateString(locale, { day: '2-digit', month: '2-digit' })} ${time}`;
}

/* Un colis par exemplaire commandé, la règle d'expédition de l'atelier ; le
   choix déjà enregistré l'emporte si deux paires sont finalement parties
   ensemble. */
function parcelTotal(order) {
  return order.parcels?.[0]?.total ?? Math.max(1, orderUnits(order).length);
}

async function load() {
  if (!token) {
    $('gate').hidden = false;
    $('gate-error').textContent = t('gate.noToken');
    return;
  }

  try {
    const data = await api(`/api/workspace/${supplierId}/orders`);
    state.orders = data.orders ?? [];

    $('app').hidden = false;
    $('ws-supplier').textContent = data.supplier?.name ?? '';
    // Deux formats : la feuille Excel reprend la mise en page de l'atelier,
    // le CSV sert à qui veut retravailler les données.
    $('ws-xlsx').href = apiUrl(`/api/workspace/${supplierId}/orders.xlsx`).toString();
    $('ws-csv').href = apiUrl(`/api/workspace/${supplierId}/orders.csv`).toString();

    renderOrders();
  } catch (error) {
    $('gate').hidden = false;
    $('gate-error').textContent = error.message;
  }
}

/* --------------------------------------------------------------- actions */

$('ws-orders').addEventListener('change', async (event) => {
  const totalSelect = event.target.closest('[data-total]');
  if (totalSelect) {
    const order = state.orders.find((candidate) => candidate.id === totalSelect.dataset.total);
    const total = Number(totalSelect.value);

    document.querySelector(`[data-parcels="${CSS.escape(order.id)}"]`).innerHTML = Array.from(
      { length: total },
      (unused, position) =>
        parcelCard(
          order,
          position + 1,
          total,
          order.parcels?.find((parcel) => parcel.index === position + 1),
        ),
    ).join('');
    return;
  }

  const photoInput = event.target.closest('[data-field="photo"]');
  if (!photoInput?.files?.[0]) return;

  const card = photoInput.closest('.pk');
  try {
    card.dataset.photo = await shrinkPhoto(photoInput.files[0]);
    const thumb = card.querySelector('.pk-thumb');
    thumb.src = card.dataset.photo;
    thumb.hidden = false;
  } catch {
    toast(t('parcel.badPhoto'), true);
  }
});

$('ws-orders').addEventListener('click', async (event) => {
  const del = event.target.closest('[data-del]');
  if (del) {
    await deleteParcel(del.dataset.del, del.dataset.number, del);
    return;
  }

  const issue = event.target.closest('[data-issue]');
  if (issue) {
    state.issueOrder = state.orders.find((order) => order.id === issue.dataset.issue);
    $('issue-order').textContent = t('issue.order', { name: state.issueOrder?.name ?? '' });
    $('issue-note').value = '';
    // Pré-rempli avec le premier article de la commande : dans neuf cas sur
    // dix c'est celui qui manque, et le fournisseur n'a plus qu'à corriger.
    const first = state.issueOrder?.lineItems?.[0];
    $('issue-product').value = first?.title ?? '';
    $('issue-color').value = first?.variantTitle ?? '';
    $('issue-size').value = '';
    $('issue-sku').value = first?.sku ?? '';
    $('issue-qty').value = String(first?.quantity ?? 1);
    toggleIssueItem();
    $('issue-modal').classList.add('open');
    return;
  }

  const save = event.target.closest('[data-save]');
  if (!save) return;

  const card = save.closest('.pk');
  const orderId = card.dataset.order;
  const order = state.orders.find((candidate) => candidate.id === orderId);
  const trackingNumber = card.querySelector('[data-field="tracking"]').value.trim();

  if (!trackingNumber) {
    toast(t('parcel.needTracking'), true);
    return;
  }

  save.disabled = true;

  try {
    /*
     * Colis déjà enregistré : on corrige la ligne, on n'en crée pas une autre.
     *
     * La création est indexée par le numéro de suivi ; ressaisir un numéro
     * corrigé fabriquait donc un doublon et laissait l'ancien numéro — le
     * faux — dans la liste du marchand, qui suivait un colis fantôme.
     */
    const pid = card.dataset.pid;
    const { parcel } = await api(
      pid
        ? `/api/workspace/${supplierId}/parcels/${pid}`
        : `/api/workspace/${supplierId}/parcels`,
      {
        method: pid ? 'PATCH' : 'POST',
        body: pid
          ? {
              trackingNumber,
              carrier: card.querySelector('[data-field="carrier"]').value.trim() || null,
              photo: card.dataset.photo ?? null,
            }
          : {
              shopifyOrderId: orderId,
              orderName: order?.name ?? null,
              trackingNumber,
              carrier: card.querySelector('[data-field="carrier"]').value.trim() || null,
              index: Number(card.dataset.index),
              total: Number(document.querySelector(`[data-total="${CSS.escape(orderId)}"]`).value),
              photo: card.dataset.photo ?? null,
            },
      },
    );

    order.parcels = [
      ...(order.parcels ?? []).filter((existing) => existing.index !== parcel.index),
      parcel,
    ].sort((a, b) => a.index - b.index);

    toast(t('parcel.savedToast', { index: parcel.index, total: parcel.total }));
    renderOrders();
  } catch (error) {
    toast(error.message, true);
  } finally {
    save.disabled = false;
  }
});

$('issue-cancel').addEventListener('click', () => $('issue-modal').classList.remove('open'));

$('issue-modal').addEventListener('click', (event) => {
  if (event.target === $('issue-modal')) $('issue-modal').classList.remove('open');
});

$('issue-send').addEventListener('click', async () => {
  const note = $('issue-note').value.trim();
  if (!note) {
    toast(t('issue.needNote'), true);
    return;
  }

  $('issue-send').disabled = true;

  try {
    await api(`/api/workspace/${supplierId}/issues`, {
      method: 'POST',
      body: {
        shopifyOrderId: state.issueOrder.id,
        orderName: state.issueOrder.name,
        customerEmail: state.issueOrder.customer?.email ?? null,
        kind: $('issue-kind').value,
        note,
        // Champs d'article : envoyés seulement pour une rupture, et seulement
        // s'ils sont remplis — un champ vide n'apprend rien au marchand.
        ...($('issue-kind').value === 'STOCK'
          ? {
              product: $('issue-product').value.trim() || null,
              color: $('issue-color').value.trim() || null,
              size: $('issue-size').value.trim() || null,
              sku: $('issue-sku').value.trim() || null,
              quantity: Number($('issue-qty').value) || null,
            }
          : {}),
      },
    });

    $('issue-modal').classList.remove('open');
    toast(t('issue.sent'));
  } catch (error) {
    toast(error.message, true);
  } finally {
    $('issue-send').disabled = false;
  }
});

/* Les champs d'article ne concernent que la rupture. */
function toggleIssueItem() {
  $('issue-item').hidden = $('issue-kind').value !== 'STOCK';
}

$('issue-kind').addEventListener('change', toggleIssueItem);

/**
 * Alertes urgentes du marchand, en tête de l'atelier.
 *
 * Relues toutes les deux minutes : le fournisseur laisse la page ouverte
 * pendant qu'il emballe, et une alerte reçue à ce moment-là doit apparaître
 * sans qu'il ait à recharger — c'est tout l'objet d'une urgence.
 */
/* Le libellé de l'alerte suit la langue de l'atelier : « Ne pas expédier »
   doit être compris en une seconde, c'est tout son intérêt. */
function alertTitle(kind) {
  return kindLabel(kind);
}

async function loadAlerts() {
  let alerts = [];
  try {
    ({ alerts } = await api(`/api/workspace/${supplierId}/alerts`));
  } catch {
    return;
  }

  const box = $('ws-alerts');
  box.innerHTML = alerts
    .map(
      (alert) => `<div class="alert" data-alert="${alert.id}">
        <b>${escapeHtml(alertTitle(alert.kind))}${
          alert.orderName ? ` · ${escapeHtml(alert.orderName)}` : ''
        }</b>
        ${
          alert.afterValue
            ? `<p class="alert-swap">${escapeHtml(alert.beforeValue ?? '—')} → <b>${escapeHtml(
                alert.afterValue,
              )}</b></p>`
            : ''
        }
        ${alert.message ? `<p>${escapeHtml(alert.message)}</p>` : ''}
        <button class="btn btn-small" data-open-updates="1">${escapeHtml(
          t('updates.accept'),
        )}</button>
      </div>`,
    )
    .join('');

  // Une notification système quand le navigateur l'autorise : le fournisseur
  // travaille dans son atelier, pas devant l'onglet.
  if (alerts.length && 'Notification' in window && Notification.permission === 'granted') {
    for (const alert of alerts.slice(0, 3)) {
      new Notification(alertTitle(alert.kind), { body: alert.message });
    }
  }

  // La bannière ne confirme plus elle-même : elle emmène sur l'écran où la
  // demande se lit en entier. Valider « pris en compte » sans avoir vu ce qui
  // change n'engage personne.
  box.querySelectorAll('[data-open-updates]').forEach((button) =>
    button.addEventListener('click', () => setView('updates')),
  );

  setBadge(alerts.length);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

if ('Notification' in window && Notification.permission === 'default') {
  // Demandée au premier clic et non au chargement : un navigateur refuse la
  // demande qui n'a pas été provoquée par un geste.
  document.addEventListener('click', () => Notification.requestPermission(), { once: true });
}

// Hier par défaut : c'est la période qu'on regarde en ouvrant le matin, et
// laisser les champs vides obligeait à saisir deux dates avant de travailler.
{
  const [since, until] = rangeDates('yesterday');
  $('ws-since').value = since;
  $('ws-until').value = until;
  document
    .querySelector('#ws-quick [data-range="yesterday"]')
    ?.setAttribute('aria-pressed', 'true');
}

// `applyLang` déclenche déjà la première lecture des alertes : les appeler
// deux fois afficherait brièvement la liste en double.
applyLang(state.lang);
setInterval(loadAlerts, 120000);


/* ==========================================================================
   NAVIGATION — quatre écrans

   Colonne à gauche sur ordinateur, barre d'onglets en bas sur téléphone. Le
   fournisseur tient son appareil d'une main pendant qu'il emballe de l'autre :
   ce que le pouce n'atteint pas n'existe pas.
   ========================================================================== */

const VIEWS = {
  orders: () => {},
  tracking: loadParcels,
  catalog: loadCatalog,
  updates: loadUpdates,
};

function setView(view) {
  state.view = view;

  for (const section of ['orders', 'tracking', 'catalog', 'updates']) {
    $(`view-${section}`).hidden = section !== view;
  }

  document.querySelectorAll('#ws-nav [data-view]').forEach((button) => {
    button.setAttribute('aria-current', String(button.dataset.view === view));
  });


  // Chaque écran recharge à l'ouverture : le fournisseur laisse l'onglet
  // ouvert toute la journée, et des données de ce matin valent moins que rien.
  void VIEWS[view]?.();
}

document.querySelectorAll('#ws-nav [data-view]').forEach((button) =>
  button.addEventListener('click', () => setView(button.dataset.view)),
);

/* -------------------------------------------------------------- période -- */

/** Bornes d'une période nommée, au format attendu par les champs date. */
function rangeDates(name) {
  const day = 86400000;
  const iso = (date) => new Date(date).toISOString().slice(0, 10);
  const now = Date.now();

  if (name === 'today') return [iso(now), iso(now)];
  if (name === 'week') return [iso(now - 6 * day), iso(now)];
  return [iso(now - day), iso(now - day)];
}

document.querySelectorAll('#ws-filter [data-filter]').forEach((button) =>
  button.addEventListener('click', () => {
    state.filter = button.dataset.filter;
    document.querySelectorAll('#ws-filter [data-filter]').forEach((other) =>
      other.setAttribute('aria-pressed', String(other === button)),
    );
    renderOrders();
  }),
);

document.querySelectorAll('#ws-quick [data-range]').forEach((button) =>
  button.addEventListener('click', () => {
    const [since, until] = rangeDates(button.dataset.range);
    $('ws-since').value = since;
    $('ws-until').value = until;

    document.querySelectorAll('#ws-quick [data-range]').forEach((other) =>
      other.setAttribute('aria-pressed', String(other === button)),
    );

    void load();
  }),
);

/* ------------------------------------------------------------- suivi ----- */

/**
 * Les colis déjà saisis.
 *
 * Soixante numéros tapés au doigt sur un téléphone : il y en a un de travers,
 * et sans écran pour les relire il ne le découvre qu'au retour du colis. Cette
 * liste sert à vérifier, pas à ressaisir.
 */
async function loadParcels() {
  const rows = $('track-rows');
  rows.innerHTML = '<p class="empty">…</p>';

  let parcels = [];
  try {
    const term = $('track-q').value.trim();
    ({ parcels } = await api(
      `/api/workspace/${supplierId}/parcels${term ? `?q=${encodeURIComponent(term)}` : ''}`,
    ));
  } catch (error) {
    rows.innerHTML = `<p class="empty">${esc(error.message)}</p>`;
    return;
  }

  state.parcels = parcels;

  rows.innerHTML =
    parcels
      .map(
        (parcel) => `<div class="trk">
          ${
            parcel.hasPhoto
              ? `<img class="trk-photo" src="${photoUrl(parcel.id)}" alt="${esc(
                  t('tracking.photo'),
                )}" loading="lazy" />`
              : '<span class="trk-photo trk-photo-none" aria-hidden="true"></span>'
          }
          <div class="trk-main">
            <b class="mono">${esc(parcel.trackingNumber)}</b>
            <small>${esc(parcel.orderName ?? '—')} · ${esc(
              t('parcel.head', { index: parcel.index, total: parcel.total }),
            )}${parcel.carrier ? ` · ${esc(parcel.carrier)}` : ''}</small>
          </div>
          <span class="trk-when">${new Date(parcel.updatedAt).toLocaleDateString(locale)}</span>
          <button class="ico ico-del" data-del="${esc(parcel.id)}"
            data-number="${esc(parcel.trackingNumber)}" title="${esc(t('parcel.delete'))}"
            aria-label="${esc(t('parcel.delete'))}">
            <svg viewBox="0 0 20 20" aria-hidden="true">
              <path d="M4 6h12M8.5 6V4.5h3V6M6 6l.8 10h6.4L14 6M8.4 9v4.6M11.6 9v4.6" />
            </svg>
          </button>
        </div>`,
      )
      .join('') || `<p class="empty">${esc(t('tracking.empty'))}</p>`;

  rows.querySelectorAll('[data-del]').forEach((button) =>
    button.addEventListener('click', () =>
      deleteParcel(button.dataset.del, button.dataset.number, button),
    ),
  );
}

/** Suppression d'un colis, avec confirmation nommant le numéro. */
async function deleteParcel(parcelId, number, button) {
  if (!confirm(t('parcel.deleteAsk', { number }))) return;

  if (button) button.disabled = true;
  try {
    await api(`/api/workspace/${supplierId}/parcels/${parcelId}`, { method: 'DELETE' });
    toast(t('parcel.deleted'));

    // Les deux écrans qui montrent ce colis se rafraîchissent : la commande
    // reprend sa carte vide, la liste de suivi perd sa ligne.
    for (const order of state.orders) {
      order.parcels = (order.parcels ?? []).filter((parcel) => parcel.id !== parcelId);
    }
    renderOrders();
    if (state.view === 'tracking') await loadParcels();
  } catch (error) {
    toast(error.message, true);
    if (button) button.disabled = false;
  }
}

let trackTimer = null;
$('track-q').addEventListener('input', () => {
  clearTimeout(trackTimer);
  // Une frappe = une requête serait une requête par lettre : on attend la
  // pause, comme partout ailleurs dans l'outil.
  trackTimer = setTimeout(loadParcels, 300);
});

/* ---------------------------------------------------------- catalogue ---- */

/**
 * Les articles que cet atelier prépare.
 *
 * Sa fiche de référence, pour lever l'ambiguïté d'un libellé de commande —
 * « Blackened Blue », c'est laquelle des deux bleues ? Chargé une seule fois :
 * un catalogue ne bouge pas dans la journée.
 */
async function loadCatalog() {
  const rows = $('catalog-rows');
  if (state.catalog) return renderCatalog();

  rows.innerHTML = '<p class="empty">…</p>';

  try {
    const data = await api(`/api/workspace/${supplierId}/catalog`);
    state.catalog = data.items ?? [];
    renderCatalog(data.error);
  } catch (error) {
    rows.innerHTML = `<p class="empty">${esc(error.message)}</p>`;
  }
}

function renderCatalog(error) {
  const rows = $('catalog-rows');

  rows.innerHTML =
    (state.catalog ?? [])
      .map(
        (item) => `<div class="cat">
          ${
            item.image
              ? `<img class="cat-photo" src="${esc(item.image)}" alt="" loading="lazy" />`
              : '<span class="cat-photo cat-photo-none" aria-hidden="true"></span>'
          }
          <div class="cat-main">
            <b>${esc(item.title)}</b>
            <small>${esc(item.vendor ?? '')} · ${esc(
              t('catalog.variants', { n: item.variantCount ?? 0 }),
            )}${
              item.totalInventory != null
                ? ` · ${esc(t('catalog.stock', { n: item.totalInventory }))}`
                : ''
            }</small>
          </div>
        </div>`,
      )
      .join('') || `<p class="empty">${esc(error ?? t('catalog.empty'))}</p>`;
}

/* ------------------------------------------------------- changements ----- */

/**
 * Demandes de changement venues du marchand.
 *
 * Le cœur de l'écran est la paire « avant → après » en gros caractères : une
 * taille à changer se lit en une seconde ou ne se lit pas. Le message libre
 * vient après, pour ceux qui veulent le détail.
 *
 * Deux réponses possibles, et le refus compte autant que l'accord : si le
 * colis est déjà parti, le dire évite au marchand d'annoncer au client un
 * changement qui n'aura pas lieu.
 */
async function loadUpdates() {
  const rows = $('updates-rows');

  let data;
  try {
    data = await api(`/api/workspace/${supplierId}/updates`);
  } catch (error) {
    rows.innerHTML = `<p class="empty">${esc(error.message)}</p>`;
    return;
  }

  state.updates = data.updates ?? [];
  setBadge(data.pending ?? 0);

  const STATUS = {
    PENDING: { cls: 'wait', label: t('updates.pending') },
    ACKNOWLEDGED: { cls: 'ok', label: t('updates.accepted') },
    REFUSED: { cls: 'bad', label: t('updates.refused') },
  };

  rows.innerHTML =
    state.updates
      .map((update) => {
        const status = STATUS[update.status] ?? STATUS.PENDING;

        return `<div class="upd upd-${status.cls}" data-upd="${esc(update.id)}">
          <div class="upd-head">
            <b>${esc(kindLabel(update.kind))}</b>
            ${update.orderName ? `<span class="tag tag-order">${esc(update.orderName)}</span>` : ''}
            <span class="tag tone-${status.cls}">${esc(status.label)}</span>
            <span class="upd-when">${new Date(update.createdAt).toLocaleDateString(locale)}</span>
          </div>

          ${
            update.afterValue
              ? `<div class="upd-swap">
                   <span class="upd-before">${esc(update.beforeValue ?? '—')}</span>
                   <span class="upd-arrow" aria-hidden="true">→</span>
                   <span class="upd-after">${esc(update.afterValue)}</span>
                 </div>`
              : ''
          }

          ${update.message ? `<p class="upd-msg">${esc(update.message)}</p>` : ''}
          ${update.supplierNote ? `<p class="upd-note">« ${esc(update.supplierNote)} »</p>` : ''}

          ${
            update.status === 'PENDING'
              ? `<div class="upd-acts">
                   <button class="btn btn-small btn-primary" data-accept="${esc(update.id)}">
                     ${esc(t('updates.accept'))}
                   </button>
                   <button class="btn btn-small" data-refuse="${esc(update.id)}">
                     ${esc(t('updates.refuse'))}
                   </button>
                 </div>`
              : ''
          }
        </div>`;
      })
      .join('') || `<p class="empty">${esc(t('updates.empty'))}</p>`;

  rows.querySelectorAll('[data-accept]').forEach((button) =>
    button.addEventListener('click', () => respond(button.dataset.accept, 'ACKNOWLEDGED')),
  );

  rows.querySelectorAll('[data-refuse]').forEach((button) =>
    button.addEventListener('click', () => {
      // Un refus sans motif oblige le marchand à redemander : on exige le mot
      // qui manque, ici et pas dans un second aller-retour.
      const note = prompt(t('updates.why'));
      if (note === null) return;
      if (!note.trim()) return toast(t('updates.needWhy'), true);
      respond(button.dataset.refuse, 'REFUSED', note.trim());
    }),
  );
}

function kindLabel(kind) {
  const label = t(`kind.${kind}`);
  return label === `kind.${kind}` ? t('alert.fallback') : label;
}

function setBadge(count) {
  const badge = $('ws-badge');
  badge.hidden = count === 0;
  badge.textContent = String(count);
}

async function respond(id, status, note = null) {
  try {
    await api(`/api/workspace/${supplierId}/updates/${id}/respond`, {
      method: 'POST',
      body: { status, note },
    });
    toast(t('updates.sent'));
    await Promise.all([loadUpdates(), loadAlerts()]);
  } catch (error) {
    toast(error.message, true);
  }
}

$('ws-more')?.addEventListener('click', () => {
  const drawer = $('ws-drawer');
  drawer.hidden = !drawer.hidden;
  $('ws-more').setAttribute('aria-expanded', String(!drawer.hidden));
});

$('ws-reload').addEventListener('click', load);

load();
