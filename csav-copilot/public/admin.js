/**
 * Console d'administration.
 *
 * Même parti pris que le dashboard : page unique servie par l'API, aucun build.
 * Un secret déjà enregistré n'est jamais renvoyé par le serveur — le champ
 * correspondant reste donc vide, et son empreinte (longueur + quatre derniers
 * caractères) sert à vérifier qu'on a bien collé la bonne clé.
 */

const $ = (id) => document.getElementById(id);

const state = { settings: [] };

function toast(message, isError = false) {
  const el = $('toast');
  el.textContent = message;
  el.classList.toggle('error', isError);
  el.classList.add('show');
  clearTimeout(el._timer);
  el._timer = setTimeout(() => el.classList.remove('show'), 5000);
}

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: 'same-origin',
    headers: options.body ? { 'Content-Type': 'application/json' } : {},
    ...options,
  });

  if (response.status === 401) {
    showLogin();
    throw new Error('Session administrateur expirée.');
  }

  const payload = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.error ?? `Erreur ${response.status}`);
  return payload;
}

/* ------------------------------------------------------------- description */

const GROUPS = [
  {
    id: 'ai',
    title: 'Intelligence artificielle',
    help: "Le fournisseur qui classe les mails et rédige les réponses. Un seul est actif à la fois ; l'application ignore lequel.",
    check: 'ai',
    fields: [
      {
        key: 'AI_PROVIDER',
        label: 'Fournisseur actif',
        type: 'select',
        options: [
          ['anthropic', 'Anthropic (Claude)'],
          ['deepseek', 'DeepSeek'],
        ],
      },
      { key: 'ANTHROPIC_API_KEY', label: 'Clé API Anthropic', placeholder: 'sk-ant-…' },
      { key: 'ANTHROPIC_MODEL', label: 'Modèle Anthropic' },
      { key: 'DEEPSEEK_API_KEY', label: 'Clé API DeepSeek', placeholder: 'sk-…' },
      { key: 'DEEPSEEK_MODEL', label: 'Modèle DeepSeek' },
      { key: 'DEEPSEEK_BASE_URL', label: 'URL de base DeepSeek' },
    ],
  },
  {
    id: 'shopify',
    title: 'Application Shopify',
    help: "Identifiants de votre app publique dans Shopify Partners. Ils servent à l'installation des boutiques et à vérifier la signature des webhooks.",
    check: 'shopify',
    fields: [
      { key: 'SHOPIFY_API_KEY', label: 'Clé API (client ID)' },
      { key: 'SHOPIFY_API_SECRET', label: 'Secret API' },
    ],
  },
  {
    id: 'google',
    title: 'Google / Gmail',
    help: "Identifiants OAuth du projet Google Cloud, et le compte de service autorisé à pousser les notifications Pub/Sub.",
    check: 'google',
    fields: [
      { key: 'GOOGLE_CLIENT_ID', label: 'Client ID OAuth' },
      { key: 'GOOGLE_CLIENT_SECRET', label: 'Secret client OAuth' },
      { key: 'GOOGLE_PUBSUB_TOPIC', label: 'Topic Pub/Sub', placeholder: 'projects/…/topics/…' },
      {
        key: 'GOOGLE_PUBSUB_SERVICE_ACCOUNT',
        label: 'Compte de service Pub/Sub',
        placeholder: 'gmail-push@…iam.gserviceaccount.com',
      },
    ],
  },
  {
    id: 'tracking',
    title: 'Suivi de colis (17TRACK)',
    help:
      "Sans cette clé, l'application ne connaît du colis que ce que Shopify en sait — " +
      "un statut figé au moment de l'expédition. 17TRACK donne la position réelle, " +
      'étape par étape, ce qui sert à répondre au client et à contester un litige.',
    fields: [{ key: 'TRACK17_API_KEY', label: 'Clé API 17TRACK' }],
  },
];

const SOURCE_LABELS = {
  database: 'réglé ici',
  environment: "variable d'environnement",
  default: 'valeur par défaut',
  missing: 'non réglé',
};

/* -------------------------------------------------------------- affichage */

function setting(key) {
  return state.settings.find((entry) => entry.key === key);
}

function renderField(field) {
  const entry = setting(field.key);
  if (!entry) return '';

  const badgeClass = entry.source === 'database' ? 'ok' : entry.source === 'missing' ? 'off' : 'warn';

  const status = `<span class="src src-${badgeClass}">${esc(SOURCE_LABELS[entry.source])}</span>`;

  let input;
  if (field.type === 'select') {
    const current = entry.value ?? '';
    input = `<select id="f-${field.key}">${field.options
      .map(
        ([value, label]) =>
          `<option value="${esc(value)}"${value === current ? ' selected' : ''}>${esc(label)}</option>`,
      )
      .join('')}</select>`;
  } else if (entry.secret) {
    // Champ vide et non pré-rempli : le serveur ne renvoie pas les secrets.
    input = `<input type="password" id="f-${field.key}" autocomplete="new-password" placeholder="${
      entry.configured ? 'inchangée' : esc(field.placeholder ?? '')
    }" />`;
  } else {
    input = `<input type="text" id="f-${field.key}" value="${esc(entry.value ?? '')}" placeholder="${esc(
      field.placeholder ?? '',
    )}" />`;
  }

  const note = entry.secret && entry.fingerprint ? `<small>Actuellement : ${esc(entry.fingerprint)}</small>` : '';

  const clear =
    entry.source === 'database'
      ? `<button class="btn btn-small" data-clear="${esc(field.key)}">Effacer</button>`
      : '';

  return `<div class="field admin-field">
    <label for="f-${field.key}">${esc(field.label)} ${status}</label>
    <div class="admin-input">${input}${clear}</div>
    <small class="admin-key">${esc(field.key)}</small>
    ${note}
  </div>`;
}

function render() {
  $('groups').innerHTML = GROUPS.map(
    (group) => `<section class="panel admin-group">
      <div class="panel-head">
        <span class="panel-title">${esc(group.title)}</span>
        <button class="btn btn-small" data-check="${group.check}">Tester la connexion</button>
      </div>
      <div class="card-body">
        <p class="set-help">${esc(group.help)}</p>
        <div class="check-result" id="check-${group.check}" hidden></div>
        ${group.fields.map(renderField).join('')}
        <div class="actions">
          <button class="btn btn-primary" data-save="${group.id}">Enregistrer</button>
        </div>
      </div>
    </section>`,
  ).join('');

  $('groups')
    .querySelectorAll('[data-save]')
    .forEach((button) => button.addEventListener('click', () => save(button.dataset.save)));

  $('groups')
    .querySelectorAll('[data-check]')
    .forEach((button) => button.addEventListener('click', () => runCheck(button.dataset.check, button)));

  $('groups')
    .querySelectorAll('[data-clear]')
    .forEach((button) => button.addEventListener('click', () => clearKey(button.dataset.clear)));
}

/* ---------------------------------------------------------------- actions */

async function load() {
  const { settings } = await api('/api/admin/settings');
  state.settings = settings;
  render();
}

async function save(groupId) {
  const group = GROUPS.find((g) => g.id === groupId);
  const values = {};

  for (const field of group.fields) {
    const el = $(`f-${field.key}`);
    if (!el) continue;

    const entry = setting(field.key);

    // Un secret laissé vide veut dire « ne change rien » : l'envoyer effacerait
    // la clé en place, alors que l'utilisateur n'a fait que ne pas la retaper.
    if (entry.secret && el.value === '') continue;

    values[field.key] = el.value;
  }

  if (Object.keys(values).length === 0) {
    toast('Aucune modification à enregistrer.');
    return;
  }

  try {
    await api('/api/admin/settings', { method: 'PATCH', body: JSON.stringify({ values }) });
    await load();
    toast('Réglages enregistrés. Testez la connexion pour vérifier.');
  } catch (error) {
    toast(error.message, true);
  }
}

async function clearKey(key) {
  if (!confirm(`Effacer ${key} ? La variable d'environnement du même nom reprend la main.`)) return;

  try {
    await api('/api/admin/settings', {
      method: 'PATCH',
      body: JSON.stringify({ values: { [key]: null } }),
    });
    await load();
    toast(`${key} effacé.`);
  } catch (error) {
    toast(error.message, true);
  }
}

async function runCheck(name, button) {
  const box = $(`check-${name}`);
  const label = button.textContent;

  button.disabled = true;
  button.textContent = 'Test en cours…';
  box.hidden = false;
  box.className = 'check-result';
  box.textContent = 'Appel en cours…';

  try {
    const { result } = await api(`/api/admin/check/${name}`, { method: 'POST' });

    box.className = `check-result ${result.ok ? 'ok' : 'ko'}`;
    box.innerHTML = `<b>${result.ok ? '✓' : '✗'} ${esc(result.message)}</b>${
      result.hint ? `<span>${esc(result.hint)}</span>` : ''
    }${
      result.details
        ? `<span class="check-details">${esc(
            Object.entries(result.details)
              .map(([key, value]) => `${key} : ${value}`)
              .join(' · '),
          )}</span>`
        : ''
    }`;
  } catch (error) {
    box.className = 'check-result ko';
    box.textContent = error.message;
  } finally {
    button.disabled = false;
    button.textContent = label;
  }
}

/* -------------------------------------------------------------- connexion */

function showLogin() {
  $('login').hidden = false;
  $('console').hidden = true;
  $('login-password').focus();
}

async function login() {
  const password = $('login-password').value;
  if (!password) return;

  try {
    const response = await fetch('/api/admin/login', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      throw new Error(payload?.error ?? 'Connexion refusée');
    }

    $('login-password').value = '';
    await boot();
  } catch (error) {
    toast(error.message, true);
  }
}

$('login-go').addEventListener('click', login);

$('login-password').addEventListener('keydown', (event) => {
  if (event.key === 'Enter') login();
});

$('logout').addEventListener('click', async () => {
  await api('/api/admin/logout', { method: 'POST' });
  showLogin();
});

async function boot() {
  try {
    await load();
    $('login').hidden = true;
    $('console').hidden = false;
  } catch {
    // `api` a déjà basculé sur l'écran de connexion en cas de 401.
    showLogin();
  }
}

boot();
