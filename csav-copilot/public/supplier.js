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

async function load() {
  if (!token) {
    $('gate').hidden = false;
    return;
  }

  try {
    const { escalation } = await api(`/api/supplier-portal/${escalationId}`);

    $('app').hidden = false;
    $('p-subject').textContent = REASON_LABELS[escalation.reason] ?? escalation.reason;
    $('p-order').textContent = escalation.ticket.orderName ?? '—';
    $('p-status').textContent = STATUS_LABELS[escalation.status] ?? escalation.status;
    renderMessages(escalation.messages);

    const canReply = escalation.status === 'OPEN' || escalation.status === 'ANSWERED';
    $('reply-box').hidden = !canReply;
    $('resolved-note').hidden = canReply;
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
