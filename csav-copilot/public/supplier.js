/**
 * Portail fournisseur — page publique accessible par lien signé (jeton dans
 * l'URL), sans compte ni session. Un seul écran : lire l'échange, répondre.
 */

const $ = (id) => document.getElementById(id);

const params = new URLSearchParams(window.location.search);
const token = params.get('token');
const escalationId = window.location.pathname.split('/').pop();

const REASON_LABELS = {
  OUT_OF_STOCK: 'Rupture de stock',
  INCORRECT_ADDRESS: 'Adresse incorrecte ou incomplète',
  MISSING_ITEM: 'Article manquant',
  OTHER: 'Autre',
};

const STATUS_LABELS = {
  OPEN: 'en attente de votre réponse',
  ANSWERED: 'répondu, en attente du marchand',
  RESOLVED: 'clôturé',
};

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

async function api(path, options) {
  const url = new URL(path, window.location.origin);
  url.searchParams.set('token', token ?? '');
  const res = await fetch(url, {
    method: options?.method ?? 'GET',
    headers: options?.body ? { 'content-type': 'application/json' } : undefined,
    body: options?.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Erreur (${res.status})`);
  return data;
}

function renderMessages(messages) {
  $('p-messages').innerHTML = messages
    .map(
      (message) => `<div class="msg${message.direction === 'FROM_SUPPLIER' ? ' out' : ''}">
        <div class="msg-head">
          <b>${message.direction === 'FROM_SUPPLIER' ? 'Vous' : 'Marchand'}</b>
          <span>${new Date(message.createdAt).toLocaleString('fr-FR')}</span>
        </div>
        <div class="msg-body">${esc(message.body)}</div>
      </div>`,
    )
    .join('');
}

/* ------------------------------------------------------------------ colis */

/**
 * Réduit une photo avant l'envoi.
 *
 * Un appareil photo de téléphone produit 4 à 8 Mo par cliché : envoyés bruts,
 * ils saturent la connexion d'un entrepôt et la base du marchand pour une
 * étiquette qui reste lisible à 1 400 px de large.
 */
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

const parcels = new Map();

function parcelPhotoUrl(id) {
  return `/api/supplier-portal/${escalationId}/parcels/${id}/photo?token=${encodeURIComponent(
    token ?? '',
  )}&v=${Date.now()}`;
}

function renderParcels() {
  const total = Number($('pk-total').value);

  $('pk-list').innerHTML = Array.from({ length: total }, (unused, position) => {
    const index = position + 1;
    const saved = parcels.get(index);

    return `<div class="pk" data-index="${index}">
      <div class="pk-head">
        Colis ${index}/${total}
        ${saved ? '<span class="pk-done">enregistré</span>' : ''}
      </div>
      <input type="text" data-field="tracking" inputmode="latin" autocapitalize="characters"
        placeholder="Numéro de suivi" value="${esc(saved?.trackingNumber ?? '')}" />
      <input type="text" data-field="carrier" placeholder="Transporteur (facultatif)"
        value="${esc(saved?.carrier ?? '')}" />
      ${
        saved?.hasPhoto
          ? `<img class="pk-thumb" src="${parcelPhotoUrl(saved.id)}" alt="Étiquette du colis ${index}" />`
          : '<img class="pk-thumb" hidden alt="" />'
      }
      <div class="pk-row">
        <label class="btn btn-small pk-shot">
          ${saved?.hasPhoto ? 'Reprendre la photo' : 'Prendre une photo'}
          <input type="file" accept="image/*" capture="environment" data-field="photo" />
        </label>
        <button class="btn btn-small btn-primary" data-save="${index}">Enregistrer</button>
      </div>
    </div>`;
  }).join('');
}

// `capture="environment"` ouvre directement l'appareil photo arrière sur
// téléphone, et retombe sur le sélecteur de fichiers sur ordinateur.
$('pk-list').addEventListener('change', async (event) => {
  const input = event.target.closest('[data-field="photo"]');
  if (!input?.files?.[0]) return;

  const card = input.closest('.pk');
  const thumb = card.querySelector('.pk-thumb');

  try {
    card.dataset.photo = await shrinkPhoto(input.files[0]);
    thumb.src = card.dataset.photo;
    thumb.hidden = false;
  } catch {
    toast('Photo illisible — reprenez-la.', true);
  }
});

$('pk-list').addEventListener('click', async (event) => {
  const button = event.target.closest('[data-save]');
  if (!button) return;

  const card = button.closest('.pk');
  const index = Number(card.dataset.index);
  const trackingNumber = card.querySelector('[data-field="tracking"]').value.trim();

  if (!trackingNumber) {
    toast('Le numéro de suivi est obligatoire.', true);
    return;
  }

  button.disabled = true;

  try {
    const { parcel } = await api(`/api/supplier-portal/${escalationId}/parcels`, {
      method: 'POST',
      body: {
        trackingNumber,
        carrier: card.querySelector('[data-field="carrier"]').value.trim() || null,
        index,
        total: Number($('pk-total').value),
        photo: card.dataset.photo ?? null,
      },
    });

    parcels.set(index, parcel);
    toast(`Colis ${index}/${parcel.total} enregistré.`);
    renderParcels();
  } catch (error) {
    toast(error.message, true);
  } finally {
    button.disabled = false;
  }
});

$('pk-total').addEventListener('change', renderParcels);

async function load() {
  if (!token) {
    $('gate').hidden = false;
    return;
  }

  try {
    const { escalation, parcels: saved } = await api(`/api/supplier-portal/${escalationId}`);

    $('app').hidden = false;
    $('p-subject').textContent = REASON_LABELS[escalation.reason] ?? escalation.reason;
    $('p-order').textContent = escalation.ticket.orderName ?? '—';
    $('p-status').textContent = STATUS_LABELS[escalation.status] ?? escalation.status;
    renderMessages(escalation.messages);

    const canReply = escalation.status === 'OPEN' || escalation.status === 'ANSWERED';
    $('reply-box').hidden = !canReply;
    $('resolved-note').hidden = canReply;

    parcels.clear();
    for (const parcel of saved ?? []) parcels.set(parcel.index, parcel);

    // Le nombre annoncé vient de ce qui a déjà été saisi : rouvrir le lien ne
    // doit pas faire disparaître les colis enregistrés la veille.
    $('pk-total').value = String(
      Math.max(1, ...(saved ?? []).map((parcel) => parcel.total)),
    );
    $('parcel-panel').hidden = !canReply;
    renderParcels();
  } catch (error) {
    $('gate').hidden = false;
    $('gate-error').textContent = error.message;
  }
}

$('p-send').addEventListener('click', async () => {
  const body = $('p-reply').value.trim();
  if (!body) return;

  $('p-send').disabled = true;
  try {
    await api(`/api/supplier-portal/${escalationId}/reply`, { method: 'POST', body: { body } });
    $('p-reply').value = '';
    toast('Réponse envoyée.');
    await load();
  } catch (error) {
    toast(error.message, true);
  } finally {
    $('p-send').disabled = false;
  }
});

load();
