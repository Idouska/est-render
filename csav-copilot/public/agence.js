import { LANGS, LOCALES, pickLang, saveLang, translator } from './agence.i18n.js';

/**
 * Le portail d'une agence de retours.
 *
 * Une seule chose à y faire : voir les commandes que le marchand a confiées au
 * stock de l'agence, et saisir le numéro de suivi quand le colis part. Le
 * numéro enregistré fait passer la commande en « expédiée » chez Shopify, qui
 * écrit au client — sauf en mode test, où rien ne sort.
 *
 * Même parti pris que l'atelier : aucune étape de construction, le fichier
 * écrit est le fichier servi, et le lien signé tient lieu de compte.
 */

const $ = (id) => document.getElementById(id);
const agencyId = window.location.pathname.split('/').pop();
const token = new URLSearchParams(window.location.search).get('token');

const state = { lang: pickLang(), testMode: false, aExpedier: [], expediees: [] };
let t = translator(state.lang);
let locale = LOCALES[state.lang] ?? 'fr-FR';

function esc(valeur) {
  return String(valeur ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function toast(message, erreur = false) {
  const el = $('toast');
  el.textContent = message;
  el.classList.toggle('error', erreur);
  el.classList.add('show');
  clearTimeout(el._timer);
  el._timer = setTimeout(() => el.classList.remove('show'), 4500);
}

/** Le message d'un refus, dans la langue de l'agence quand le serveur donne un code. */
function messageServeur(erreur) {
  if (!erreur.code) return erreur.message;
  const cle = `ag.err.${erreur.code}`;
  const traduit = t(cle, erreur.donnees ?? {});
  return traduit === cle ? erreur.message : traduit;
}

async function api(chemin, options = {}) {
  const url = new URL(chemin, window.location.origin);
  url.searchParams.set('token', token ?? '');

  const reponse = await fetch(url, {
    method: options.method ?? 'GET',
    headers: options.body ? { 'content-type': 'application/json' } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const data = await reponse.json().catch(() => ({}));
  if (!reponse.ok) {
    const erreur = new Error(data.error ?? `Erreur ${reponse.status}`);
    erreur.code = data.code;
    erreur.donnees = data;
    throw erreur;
  }
  return data;
}

/* ----------------------------------------------------------------- langue */

function appliquerLangue(lang) {
  state.lang = lang;
  saveLang(lang);
  t = translator(lang);
  locale = LOCALES[lang] ?? 'fr-FR';
  document.documentElement.lang = lang;

  for (const noeud of document.querySelectorAll('[data-t]')) noeud.textContent = t(noeud.dataset.t);
  renderLangues();
  render();
}

function renderLangues() {
  const box = $('ag-langs');
  box.innerHTML = LANGS.map(
    (entree) => `<button type="button" data-lang="${entree.code}" title="${esc(entree.name)}"
      aria-pressed="${entree.code === state.lang}">${esc(entree.label)}</button>`,
  ).join('');
  box.querySelectorAll('[data-lang]').forEach((bouton) =>
    bouton.addEventListener('click', () => appliquerLangue(bouton.dataset.lang)),
  );
}

/* ---------------------------------------------------------------- lecture */

async function charger() {
  try {
    const data = await api(`/api/agence/${agencyId}/expeditions`);
    state.testMode = Boolean(data.testMode);
    state.aExpedier = data.aExpedier ?? [];
    state.expediees = data.expediees ?? [];

    $('ag-nom').textContent = data.agence?.nom ?? '';
    $('ag-pays').textContent = data.agence?.pays ?? '';
    $('ag-test').hidden = !state.testMode;
    $('ag-adresses').hidden = !data.adressesIndisponibles;
    $('ag-app').hidden = false;
    $('ag-gate').hidden = true;
    render();
  } catch (erreur) {
    // Lien invalide ou révoqué : une phrase, et rien d'autre.
    $('ag-app').hidden = true;
    $('ag-gate').hidden = false;
    $('ag-gate-msg').textContent = messageServeur(erreur);
  }
}

const jours = (date) => Math.max(0, Math.floor((Date.now() - new Date(date).getTime()) / 86_400_000));

/** L'adresse, telle qu'elle doit être écrite sur le colis. */
function adresseTexte(adresse) {
  if (!adresse) return '';
  return [
    adresse.name,
    adresse.address1,
    adresse.address2,
    [adresse.zip, adresse.city].filter(Boolean).join(' '),
    adresse.country,
    adresse.phone,
  ]
    .filter(Boolean)
    .join('\n');
}

function paireMarkup(paire) {
  return `<div class="ag-paire">
    ${
      paire.aPhoto
        ? `<a class="ag-photo" href="/api/agence/${esc(agencyId)}/paires/${esc(paire.id)}/photo?token=${encodeURIComponent(
            token ?? '',
          )}" target="_blank" rel="noopener">${esc(t('ag.photo'))}</a>`
        : ''
    }
    <div>
      <b>${esc(paire.titre)}</b>
      <small>${esc([paire.declinaison, paire.sku].filter(Boolean).join(' · '))}</small>
      <small class="ag-sub">${esc(t('ag.fromReturn', { commande: paire.retourDe ?? '—' }))}</small>
    </div>
  </div>`;
}

function render() {
  $('ag-a-expedier').innerHTML = state.aExpedier.length
    ? state.aExpedier
        .map(
          (commande) => `<article class="ag-cmd" data-cmd="${esc(commande.orderId)}">
            <header>
              <b>${esc(commande.orderName ?? '')}</b>
              <small>${esc(t('ag.entrusted', { jours: commande.confieeLe ? jours(commande.confieeLe) : 0 }))}</small>
            </header>

            <div class="ag-bloc">
              <span class="ag-titre">${esc(t('ag.address'))}</span>
              <pre class="ag-adresse">${esc(adresseTexte(commande.adresse))}</pre>
              <button class="btn btn-small" data-copier="${esc(adresseTexte(commande.adresse))}">${esc(t('ag.copy'))}</button>
            </div>

            <div class="ag-bloc">
              <span class="ag-titre">${esc(t('ag.toSend'))}</span>
              ${commande.paires.map(paireMarkup).join('')}
            </div>

            <form class="ag-envoi">
              <input class="mono" data-champ="suivi" value="${esc(commande.suivi ?? '')}"
                placeholder="${esc(t('ag.tracking'))}" aria-label="${esc(t('ag.tracking'))}"
                autocomplete="off" spellcheck="false" />
              <input data-champ="transporteur" list="ag-carriers" value="${esc(commande.transporteur ?? '')}"
                placeholder="${esc(t('ag.carrier'))}" aria-label="${esc(t('ag.carrier'))}" />
              <button class="btn btn-primary" type="submit">${esc(t('ag.ship'))}</button>
            </form>
          </article>`,
        )
        .join('')
    : `<p class="ag-vide">${esc(t('ag.none'))}</p>`;

  $('ag-expediees').innerHTML = state.expediees.length
    ? state.expediees
        .map(
          (commande) => `<article class="ag-cmd ag-faite" data-cmd="${esc(commande.orderId)}">
            <header>
              <b>${esc(commande.orderName ?? '')}</b>
              <small>${commande.expedieeLe ? esc(new Date(commande.expedieeLe).toLocaleDateString(locale)) : ''}</small>
            </header>
            <div class="ag-bloc">
              ${commande.paires.map(paireMarkup).join('')}
            </div>
            <form class="ag-envoi">
              <input class="mono" data-champ="suivi" value="${esc(commande.suivi ?? '')}"
                aria-label="${esc(t('ag.tracking'))}" autocomplete="off" spellcheck="false" />
              <input data-champ="transporteur" list="ag-carriers" value="${esc(commande.transporteur ?? '')}"
                placeholder="${esc(t('ag.carrier'))}" aria-label="${esc(t('ag.carrier'))}" />
              <button class="btn" type="submit">${esc(t('ag.correct'))}</button>
            </form>
          </article>`,
        )
        .join('')
    : `<p class="ag-vide">${esc(t('ag.noneShipped'))}</p>`;

  for (const formulaire of document.querySelectorAll('.ag-envoi')) {
    formulaire.addEventListener('submit', (event) => {
      event.preventDefault();
      void expedier(formulaire);
    });
  }

  for (const bouton of document.querySelectorAll('[data-copier]')) {
    bouton.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(bouton.dataset.copier);
        toast(t('ag.copied'));
      } catch {
        toast(t('ag.copyFail'), true);
      }
    });
  }
}

/* --------------------------------------------------------------- l'envoi */

/*
 * Enregistrer le numéro, et expédier.
 *
 * Un numéro DIFFÉRENT sur une commande déjà expédiée est une correction : si
 * le client a déjà reçu l'ancien, le serveur demande confirmation avant de
 * lui en envoyer un autre. La question nomme les deux numéros.
 */
async function expedier(formulaire) {
  const carte = formulaire.closest('.ag-cmd');
  const orderId = carte.dataset.cmd;
  const suivi = formulaire.querySelector('[data-champ="suivi"]').value.trim();
  const transporteur = formulaire.querySelector('[data-champ="transporteur"]').value.trim() || null;

  if (!suivi) return toast(t('ag.needTracking'), true);

  const bouton = formulaire.querySelector('[type="submit"]');
  const libelle = bouton.textContent;
  bouton.disabled = true;
  bouton.textContent = t('ag.saving');

  const envoyer = (corps) => api(`/api/agence/${agencyId}/expeditions`, { method: 'POST', body: corps });

  try {
    let resultat;
    try {
      resultat = await envoyer({ orderId, trackingNumber: suivi, carrier: transporteur });
    } catch (erreur) {
      if (erreur.code !== 'client_deja_prevenu') throw erreur;
      const question = t(state.testMode ? 'ag.correctConfirmTest' : 'ag.correctConfirm', {
        ancien: erreur.donnees?.ancien ?? '',
        numero: suivi,
      });
      if (!confirm(question)) return;
      resultat = await envoyer({ orderId, trackingNumber: suivi, carrier: transporteur, prevenirClient: true });
    }

    if (resultat.corrigee) {
      toast(t(resultat.clientPrevenu && !state.testMode ? 'ag.correctedNotified' : 'ag.corrected'));
    } else if (state.testMode) {
      toast(t('ag.shippedTest'));
    } else if (resultat.shopify?.fulfilled) {
      toast(t('ag.shippedOk'));
    } else {
      toast(t('ag.shippedFail', { raison: resultat.shopify?.reason ?? '' }), true);
    }

    await charger();
  } catch (erreur) {
    toast(messageServeur(erreur), true);
  } finally {
    bouton.disabled = false;
    bouton.textContent = libelle;
  }
}

$('ag-refresh').addEventListener('click', () => void charger());

appliquerLangue(state.lang);
void charger();
