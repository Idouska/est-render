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

function parcelCard(order, index, total, saved) {
  return `<div class="pk" data-order="${esc(order.id)}" data-index="${index}">
    <div class="pk-head">
      Colis ${index}/${total}
      ${saved ? '<span class="pk-done">enregistré</span>' : ''}
    </div>
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
      const total = order.parcels?.[0]?.total ?? 1;

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

$('ws-reload').addEventListener('click', load);

load();
