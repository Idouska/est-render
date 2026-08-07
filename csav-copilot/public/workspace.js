/**
 * Espace de travail du fournisseur — lien permanent, sans compte.
 *
 * Le geste du matin : ouvrir le lien, voir les commandes de la veille, saisir
 * un numéro de suivi et photographier l'étiquette pour chaque colis, signaler
 * ce qui coince. L'export Excel donne la même liste hors ligne.
 */

const $ = (id) => document.getElementById(id);

const params = new URLSearchParams(window.location.search);
const token = params.get('token');
const supplierId = window.location.pathname.split('/').pop();

const state = { orders: [], issueOrder: null };

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
  if (!response.ok) throw new Error(data.error ?? `Erreur (${response.status})`);
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
  const units = orderUnits(order);
  const item = units.length === total ? units[index - 1] : null;

  return `<div class="pk" data-order="${esc(order.id)}" data-index="${index}">
    <div class="pk-head">
      Colis ${index}/${total}
      ${saved ? '<span class="pk-done">enregistré</span>' : ''}
    </div>
    ${
      item
        ? `<div class="pk-item">${esc(item.title)}${
            item.variantTitle ? ` — ${esc(item.variantTitle)}` : ''
          }</div>`
        : ''
    }
    <input type="text" data-field="tracking" autocapitalize="characters"
      placeholder="Numéro de suivi" value="${esc(saved?.trackingNumber ?? '')}" />
    <input type="text" data-field="carrier" placeholder="Transporteur (facultatif)"
      value="${esc(saved?.carrier ?? '')}" />
    ${
      saved?.hasPhoto
        ? `<img class="pk-thumb" src="${photoUrl(saved.id)}" alt="Étiquette ${index}" />`
        : '<img class="pk-thumb" hidden alt="" />'
    }
    <div class="pk-row">
      <label class="btn btn-small pk-shot">
        ${saved?.hasPhoto ? 'Reprendre la photo' : 'Prendre une photo'}
        <input type="file" accept="image/*" capture="environment" data-field="photo" />
      </label>
      <button class="btn btn-small btn-primary" data-save="1">Enregistrer</button>
    </div>
  </div>`;
}

function renderOrders() {
  $('ws-count').textContent = state.orders.length
    ? `${state.orders.length} commande${state.orders.length > 1 ? 's' : ''} sur la période`
    : '';

  if (state.orders.length === 0) {
    $('ws-orders').innerHTML =
      '<p class="empty">Aucune commande sur cette période. Changez les dates ci-dessus.</p>';
    return;
  }

  $('ws-orders').innerHTML = state.orders
    .map((order) => {
      const address = order.shippingAddress ?? {};
      const phone = address.phone ?? '';
      // Un numéro trop court bloquera la livraison : autant que l'atelier le
      // voie avant d'emballer, pas le transporteur devant la porte.
      const phoneShort = phone.replace(/\D/g, '').length < 9;
      // Un colis par exemplaire commandé, la règle d'expédition de l'atelier.
      // Reste modifiable si deux paires partent finalement ensemble.
      const total = order.parcels?.[0]?.total ?? Math.max(1, orderUnits(order).length);

      return `<article class="ord">
        <div class="ord-head">
          <b>${esc(order.name)}</b>
          <span class="tag tag-order">${esc(order.displayFulfillmentStatus ?? '—')}</span>
          <span class="when">${new Date(order.createdAt).toLocaleString('fr-FR')}</span>
        </div>

        <div class="ord-who">
          <b>${esc(order.customer?.displayName ?? address.name ?? 'Client')}</b>
          <small>${esc([address.address1, address.address2].filter(Boolean).join(' '))}</small>
          <small>${esc(`${address.zip ?? ''} ${address.city ?? ''} ${address.country ?? ''}`.trim())}</small>
          <small>Téléphone :
            <span class="ord-phone${phoneShort ? ' missing' : ''}">${
              esc(phone || 'absent')
            }</span>
          </small>
        </div>

        <div class="ord-items">
          ${(order.lineItems ?? [])
            .map(
              (item) => `<div class="ord-item">
                ${item.image ? `<img src="${esc(item.image)}" alt="" loading="lazy" />` : ''}
                <span>
                  <b>${item.quantity} × ${esc(item.title)}</b>
                  <small>${esc(item.variantTitle ?? item.sku ?? '')}</small>
                </span>
              </div>`,
            )
            .join('')}
        </div>

        <label class="field">
          Nombre de colis
          <select data-total="${esc(order.id)}">
            ${[1, 2, 3, 4, 5, 6]
              .map(
                (value) =>
                  `<option value="${value}"${value === total ? ' selected' : ''}>${value} colis</option>`,
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
          <button class="btn" data-issue="${esc(order.id)}">Signaler un problème</button>
        </div>
      </article>`;
    })
    .join('');
}

async function load() {
  if (!token) {
    $('gate').hidden = false;
    $('gate-error').textContent = 'Aucun jeton dans le lien.';
    return;
  }

  try {
    const data = await api(`/api/workspace/${supplierId}/orders`);
    state.orders = data.orders ?? [];

    $('app').hidden = false;
    $('ws-supplier').textContent = data.supplier?.name
      ? `Atelier ${data.supplier.name}`
      : '';
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
    toast('Photo illisible — reprenez-la.', true);
  }
});

$('ws-orders').addEventListener('click', async (event) => {
  const issue = event.target.closest('[data-issue]');
  if (issue) {
    state.issueOrder = state.orders.find((order) => order.id === issue.dataset.issue);
    $('issue-order').textContent = `Commande ${state.issueOrder?.name ?? ''}`;
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
    toast('Le numéro de suivi est obligatoire.', true);
    return;
  }

  save.disabled = true;

  try {
    const { parcel } = await api(`/api/workspace/${supplierId}/parcels`, {
      method: 'POST',
      body: {
        shopifyOrderId: orderId,
        orderName: order?.name ?? null,
        trackingNumber,
        carrier: card.querySelector('[data-field="carrier"]').value.trim() || null,
        index: Number(card.dataset.index),
        total: Number(document.querySelector(`[data-total="${CSS.escape(orderId)}"]`).value),
        photo: card.dataset.photo ?? null,
      },
    });

    order.parcels = [
      ...(order.parcels ?? []).filter((existing) => existing.index !== parcel.index),
      parcel,
    ].sort((a, b) => a.index - b.index);

    toast(`Colis ${parcel.index}/${parcel.total} enregistré.`);
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
    toast('Décrivez le problème en une phrase.', true);
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
    toast('Signalement envoyé au marchand.');
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
const ALERT_TITLES = {
  ADDRESS: 'Adresse à corriger',
  PHONE: 'Téléphone à corriger',
  PRODUCT: 'Article à changer',
  HOLD: 'Ne pas expédier',
  OTHER: 'Message urgent',
};

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
        <b>${ALERT_TITLES[alert.kind] ?? 'Urgent'}${
          alert.orderName ? ` · ${alert.orderName}` : ''
        }</b>
        <p>${escapeHtml(alert.message)}</p>
        <button class="btn btn-small" data-ack="${alert.id}">J'ai vu</button>
      </div>`,
    )
    .join('');

  // Une notification système quand le navigateur l'autorise : le fournisseur
  // travaille dans son atelier, pas devant l'onglet.
  if (alerts.length && 'Notification' in window && Notification.permission === 'granted') {
    for (const alert of alerts.slice(0, 3)) {
      new Notification(ALERT_TITLES[alert.kind] ?? 'Urgent', { body: alert.message });
    }
  }

  box.querySelectorAll('[data-ack]').forEach((button) =>
    button.addEventListener('click', async () => {
      button.disabled = true;
      try {
        await api(`/api/workspace/${supplierId}/alerts/${button.dataset.ack}/ack`, {
          method: 'POST',
          body: {},
        });
        button.closest('[data-alert]').remove();
      } catch (error) {
        toast(error.message, true);
        button.disabled = false;
      }
    }),
  );
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

void loadAlerts();
setInterval(loadAlerts, 120000);

$('ws-reload').addEventListener('click', load);

load();
