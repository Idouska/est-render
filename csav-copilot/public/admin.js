/**
 * Console d'administration.
 *
 * Même parti pris que le dashboard : page unique servie par l'API, aucun build.
 * Un secret déjà enregistré n'est jamais renvoyé par le serveur — le champ
 * correspondant reste donc vide, et son empreinte (longueur + quatre derniers
 * caractères) sert à vérifier qu'on a bien collé la bonne clé.
 */

const $ = (id) => document.getElementById(id);

const state = { settings: [], nouveautes: [], registre: [], marchands: [] };

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
    title: 'Suivi de colis',
    help:
      "Sans clé, l'application ne connaît du colis que ce que Shopify en sait — " +
      "un statut figé au moment de l'expédition. Un fournisseur de suivi donne la " +
      'position réelle, étape par étape. Une seule clé suffit : ParcelsApp est ' +
      'utilisé en priorité, 17TRACK sinon.',
    fields: [
      { key: 'PARCELSAPP_API_KEY', label: 'Clé API ParcelsApp' },
      { key: 'TRACK17_API_KEY', label: 'Clé API 17TRACK' },
    ],
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
  void loadSupervision();
  void loadFonctionnalites();
  void loadNouveautes();
}

/* -------------------------------------------------------- fonctionnalités */

/*
 * Les interrupteurs, boutique par boutique.
 *
 * Le serveur envoie le registre avec l'état : l'écran n'affiche que ce que le
 * serveur sait appliquer. Chaque bascule part aussitôt — un interrupteur
 * qu'il faudrait « enregistrer » laisserait croire à un état qui n'est pas
 * celui de la boutique.
 */
async function loadFonctionnalites() {
  try {
    const { registre, marchands } = await api('/api/admin/marchands');
    state.registre = registre ?? [];
    state.marchands = marchands ?? [];
    renderFonctionnalites();
  } catch (error) {
    $('fonctionnalites-body').innerHTML = `<p class="empty">${esc(error.message)}</p>`;
  }
}

const interrupteur = (attributs, actif, oui, non) =>
  `<label class="fx-switch"><input type="checkbox" ${attributs} ${actif ? 'checked' : ''} /><span>${
    actif ? oui : non
  }</span></label>`;

function renderFonctionnalites() {
  const { registre, marchands } = state;
  const corps = $('fonctionnalites-body');

  if (!marchands.length) {
    corps.innerHTML = '<p class="empty">Aucune boutique installée.</p>';
    return;
  }

  corps.innerHTML = `
    <p class="set-help">Tout est allumé par défaut. Éteindre une fonctionnalité la retire
      vraiment : l'écran la masque, et le serveur la refuse. Le mode test est le même
      réglage que dans les Réglages de la boutique.</p>
    <div class="fx-wrap">
      <table class="fx">
        <thead><tr>
          <th>Boutique</th>
          <th title="Rien ne sort : ni expédition, ni remboursement, ni e-mail.">Mode test</th>
          ${registre.map((f) => `<th title="${esc(f.description)}">${esc(f.titre)}</th>`).join('')}
        </tr></thead>
        <tbody>${marchands
          .map(
            (m) => `<tr>
              <td><b>${esc(m.brandName ?? m.name ?? m.shopDomain)}</b>
                <span class="admin-print">${esc(m.shopDomain)}</span></td>
              <td>${interrupteur(`data-marchand="${esc(m.id)}" data-mode-test`, m.testMode, 'Allumé', 'Éteint')}</td>
              ${registre
                .map(
                  (f) =>
                    `<td>${interrupteur(
                      `data-marchand="${esc(m.id)}" data-cle="${esc(f.cle)}"`,
                      m.fonctionnalites?.[f.cle] !== false,
                      'Allumée',
                      'Éteinte',
                    )}</td>`,
                )
                .join('')}
            </tr>`,
          )
          .join('')}</tbody>
      </table>
    </div>
    <dl class="fx-legende">${registre
      .map((f) => `<dt>${esc(f.titre)}</dt><dd>${esc(f.description)}</dd>`)
      .join('')}</dl>`;

  corps.querySelectorAll('input[data-marchand]').forEach((caseACocher) =>
    caseACocher.addEventListener('change', () => void basculer(caseACocher)),
  );
}

async function basculer(caseACocher) {
  const actif = caseACocher.checked;
  const idMarchand = caseACocher.dataset.marchand;
  const corps = caseACocher.dataset.cle
    ? { fonctionnalite: { cle: caseACocher.dataset.cle, actif } }
    : { testMode: actif };

  caseACocher.disabled = true;
  try {
    const resultat = await api(`/api/admin/marchands/${encodeURIComponent(idMarchand)}`, {
      method: 'PATCH',
      body: JSON.stringify(corps),
    });
    const marchand = state.marchands.find((m) => m.id === idMarchand);
    if (marchand) {
      marchand.testMode = resultat.testMode;
      marchand.fonctionnalites = resultat.fonctionnalites;
    }
    toast(actif ? 'Allumé pour cette boutique.' : 'Éteint pour cette boutique.');
    renderFonctionnalites();
  } catch (error) {
    caseACocher.checked = !actif;
    caseACocher.disabled = false;
    toast(error.message, true);
  }
}

/* ------------------------------------------------------------- nouveautés */

/*
 * Les nouveautés, pour les tester.
 *
 * Les cases « Testé » vivent dans ce navigateur : elles servent de liste de
 * contrôle à la personne qui teste, pas de registre partagé. Un navigateur
 * qui refuse le stockage garde les coches le temps de la visite.
 */
const CLE_TESTEES = 'csav.admin.nouveautes.testees';

function testeesLues() {
  try {
    return new Set(JSON.parse(localStorage.getItem(CLE_TESTEES) ?? '[]'));
  } catch {
    return new Set(state.testeesDeLaVisite ?? []);
  }
}

function testeesEcrire(ensemble) {
  state.testeesDeLaVisite = [...ensemble];
  try {
    localStorage.setItem(CLE_TESTEES, JSON.stringify([...ensemble]));
  } catch {
    // Stockage refusé : les coches durent le temps de la visite.
  }
}

const dateCourte = (jour) =>
  new Date(`${jour}T12:00:00`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });

async function loadNouveautes() {
  try {
    const { nouveautes } = await api('/api/admin/nouveautes');
    state.nouveautes = nouveautes ?? [];
    renderNouveautes();
  } catch (error) {
    $('nouveautes-body').innerHTML = `<p class="empty">${esc(error.message)}</p>`;
  }
}

function renderNouveautes() {
  const testees = testeesLues();
  const reste = state.nouveautes.filter((n) => !testees.has(n.pr)).length;

  $('nouveautes-compte').textContent = reste ? `À tester : ${reste}` : 'Tout est testé';
  $('nouveautes-nav').hidden = reste === 0;
  $('nouveautes-nav').textContent = String(reste);

  $('nouveautes-body').innerHTML = state.nouveautes
    .map(
      (n) => `<details class="nv${testees.has(n.pr) ? ' nv-testee' : ''}">
        <summary>
          <span class="nv-pour">${esc(n.pour)}</span>
          <b>${esc(n.titre)}</b>
          <span class="admin-print">${esc(dateCourte(n.date))} · PR ${n.pr}</span>
        </summary>
        <p>${esc(n.resume)}</p>
        <p class="nv-ou"><b>Où :</b> ${esc(n.ou)}</p>
        <ol class="nv-essai">${n.essayer.map((etape) => `<li>${esc(etape)}</li>`).join('')}</ol>
        <label class="nv-coche">
          <input type="checkbox" data-testee="${n.pr}" ${testees.has(n.pr) ? 'checked' : ''} /> Testé
        </label>
      </details>`,
    )
    .join('');

  $('nouveautes-body')
    .querySelectorAll('[data-testee]')
    .forEach((caseACocher) =>
      caseACocher.addEventListener('change', () => {
        const ensemble = testeesLues();
        const pr = Number(caseACocher.dataset.testee);
        if (caseACocher.checked) ensemble.add(pr);
        else ensemble.delete(pr);
        testeesEcrire(ensemble);

        // L'entrée reste ouverte : on vient de la lire.
        const ouverte = caseACocher.closest('details')?.open;
        renderNouveautes();
        if (ouverte) {
          $('nouveautes-body').querySelector(`[data-testee="${pr}"]`)?.closest('details')?.setAttribute('open', '');
        }
      }),
    );
}

/* ------------------------------------------------------------ supervision */

/*
 * Trois pannes qui ne lèvent aucune erreur : le cron supprimé, l'écoute Gmail
 * expirée, le worker arrêté. Chacune se présente comme du silence, et rien ne
 * ressemble davantage au bon fonctionnement — d'où cet écran, qui donne au
 * silence une couleur.
 *
 * Le relevé est chargé après les identifiants et sans bloquer : il interroge
 * Redis et la base, et une console qui refuserait de s'ouvrir parce que la
 * file est injoignable empêcherait précisément de corriger la panne.
 */
const LEVELS = {
  ok: { label: 'OK', className: 'src-ok' },
  warn: { label: 'À surveiller', className: 'src-warn' },
  down: { label: 'En panne', className: 'src-off' },
};

async function loadSupervision() {
  const body = $('supervision-body');

  try {
    const report = await api('/api/admin/health');
    const groups = report?.groups ?? [];

    body.innerHTML = `${groups
      .map(
        (group) => `<div class="admin-field">
          <label>${esc(group.title)}</label>
          <div class="sup-rows">${(group.indicators ?? []).map(renderIndicator).join('')}</div>
        </div>`,
      )
      .join('')}
      <p class="admin-print">Relevé du ${esc(dateTime(report?.checkedAt))}.</p>`;
  } catch (error) {
    body.innerHTML = `<p class="empty">Relevé impossible : ${esc(error.message)}</p>`;
  }
}

function renderIndicator(indicator) {
  const level = LEVELS[indicator.level] ?? LEVELS.warn;

  return `<div class="sup-row">
    <span class="src ${level.className}">${level.label}</span>
    <div>
      <b>${esc(indicator.headline)}</b>
      <p class="admin-print">${esc(indicator.detail)}</p>
    </div>
  </div>`;
}

function dateTime(iso) {
  if (!iso) return '—';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('fr-FR');
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

$('supervision-refresh').addEventListener('click', () => void loadSupervision());

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
