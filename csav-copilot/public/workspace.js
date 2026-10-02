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
  view: 'home',
  filter: 'left',
  /**
   * Commande ouverte en plein écran, ou `null` pour la liste.
   *
   * L'atelier traite une commande à la fois, téléphone en main : quatre-vingt-
   * dix formulaires dépliés d'un bloc, c'est chercher sa place au lieu de
   * travailler. La liste ne sert qu'à choisir ; le travail se fait au guichet,
   * une commande plein écran, et « Enregistrer » passe à la suivante.
   */
  focus: null,
  /**
   * « manuel » : la liste et le guichet. « masse » : l'import depuis Excel.
   *
   * Pas mémorisé d'une visite à l'autre : un atelier qui arrive le matin
   * veut sa liste, et retrouver l'écran d'import ouvert sur un collage de la
   * veille inviterait à le renvoyer.
   */
  mode: 'manuel',
  /** Le dernier aperçu reçu, et le texte exact qui l'a produit. */
  lot: null,
  /* Ordre de la file : par heure d'arrivée, ou par modèle — emballer quinze
     Pegasus d'affilée épargne quatorze changements de carton. Mémorisé : c'est
     une façon de travailler, pas un réglage du matin. */
  sort: localStorage.getItem(`ws.sort.${supplierId}`) ?? 'time',
  parcels: [],
  catalog: null,
  /* Fiche produit ouverte dans le catalogue, et fiches déjà chargées. */
  catalogFocus: null,
  catalogSheets: {},
  updates: [],
};

/*
 * Le transporteur, retenu d'un colis à l'autre.
 *
 * Un atelier expédie avec le même transporteur toute la journée : le
 * ressaisir quatre-vingt-treize fois est du temps volé, l'oublier laisse le
 * marchand deviner. Pré-rempli sur les nouveaux colis, modifiable d'un geste.
 */
const CARRIER_KEY = `ws.carrier.${supplierId}`;
function lastCarrier() {
  return localStorage.getItem(CARRIER_KEY) ?? '';
}
function rememberCarrier(value) {
  if (value) localStorage.setItem(CARRIER_KEY, value);
}

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
/*
 * Le script est-il entièrement chargé ?
 *
 * `applyLang` s'exécute une première fois au démarrage, avant que la table
 * des écrans soit déclarée plus bas : y changer d'écran à ce moment lèverait
 * une erreur. L'écran d'arrivée s'ouvre donc à la fin du fichier.
 */
let pret = false;

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
  if (pret && state.view !== 'orders') setView(state.view);
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
  if (!response.ok) {
    const erreur = new Error(data.error ?? t('error.generic', { status: response.status }));
    // Le code, quand le serveur en donne un, permet de traduire le refus :
    // voir `messageServeur`.
    erreur.code = data.code;
    erreur.donnees = data;
    throw erreur;
  }
  return data;
}

/**
 * Le message d'un refus du serveur, dans la langue de l'atelier.
 *
 * Le serveur ne connaît pas la langue choisie à l'écran : quand il donne un
 * code, on le traduit sous `prefixe` ; sinon — ou pour un code que la page ne
 * connaît pas — son message tel quel, plutôt que le nom d'une clé.
 */
function messageServeur(error, prefixe) {
  if (!error.code) return error.message;
  const cle = `${prefixe}.${error.code}`;
  const traduit = t(cle, error.donnees ?? {});
  return traduit === cle ? error.message : traduit;
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

/**
 * Lecture du code-barres de l'étiquette, dans le champ de suivi.
 *
 * Chaque étiquette porte son numéro en code-barres ; le taper au doigt —
 * treize chiffres, un œil sur l'étiquette, un œil sur l'écran — est à la fois
 * le geste le plus lent de la journée et la source des colis introuvables.
 * `BarcodeDetector` est natif sur Chrome Android, le téléphone des ateliers ;
 * ailleurs le bouton n'existe pas, et le clavier reste le chemin.
 */
let scanStream = null;

async function scanInto(input) {
  const modal = $('scan-modal');
  const video = $('scan-video');

  let detector;
  try {
    detector = new BarcodeDetector({
      // Les formats des transporteurs : Code 128 pour la quasi-totalité des
      // étiquettes, et les autres par prudence — détecter trop coûte moins
      // cher que rater le bon.
      formats: ['code_128', 'code_39', 'ean_13', 'itf', 'qr_code', 'data_matrix'],
    });
    scanStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment' },
    });
  } catch {
    toast(t('scan.fail'), true);
    return;
  }

  video.srcObject = scanStream;
  await video.play().catch(() => {});
  modal.classList.add('open');

  const tick = async () => {
    if (!scanStream) return;
    try {
      const codes = await detector.detect(video);
      const value = codes[0]?.rawValue?.trim();
      if (value) {
        input.value = value;
        // La vibration est l'accusé de réception : les yeux sont sur le
        // colis, pas sur l'écran.
        navigator.vibrate?.(80);
        closeScan();
        toast(t('scan.got', { code: value }));
        return;
      }
    } catch {
      // Une frame illisible n'est pas une panne : on attend la suivante.
    }
    setTimeout(tick, 180);
  };
  void tick();
}

function closeScan() {
  $('scan-modal').classList.remove('open');
  $('scan-video').srcObject = null;
  scanStream?.getTracks().forEach((track) => track.stop());
  scanStream = null;
}

$('scan-cancel')?.addEventListener('click', closeScan);
$('scan-modal')?.addEventListener('click', (event) => {
  if (event.target === $('scan-modal')) closeScan();
});

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

    <div class="pk-track">
      <input type="text" data-field="tracking" autocapitalize="characters"
        inputmode="latin" enterkeyhint="done"
        placeholder="${esc(t('parcel.tracking'))}" value="${esc(saved?.trackingNumber ?? '')}" />
      ${
        // Toutes les étiquettes portent un code-barres ; treize chiffres au
        // doigt sont la vraie perte de temps de la journée, et la vraie source
        // de colis introuvables. Le bouton n'apparaît que si le navigateur
        // sait lire les codes — un bouton qui échoue toujours est un piège.
        'BarcodeDetector' in window
          ? `<button type="button" class="pk-scan" data-scan="1"
               title="${esc(t('scan.button'))}" aria-label="${esc(t('scan.button'))}">
               <svg viewBox="0 0 20 20" aria-hidden="true">
                 <path d="M3 6V3.5h3M17 6V3.5h-3M3 14v2.5h3M17 14v2.5h-3" />
                 <path d="M5.5 7v6M8 7v6M10.5 7v6M12.5 7v6M14.5 7v6" />
               </svg>
             </button>`
          : ''
      }
    </div>
    <input type="text" data-field="carrier" list="ws-carriers" autocomplete="off"
      placeholder="${esc(t('parcel.carrier'))}" value="${esc(saved?.carrier ?? lastCarrier())}" />
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

function orderIsDone(order) {
  const total = parcelTotal(order);
  return total > 0 && orderDone(order, total) === total;
}

/**
 * La file dans l'ordre de travail.
 *
 * « Par modèle » regroupe les commandes du même article : quinze Pegasus
 * s'emballent d'affilée dans le même carton, au lieu d'en changer à chaque
 * commande. Le tri est stable — à modèle égal, l'heure d'arrivée départage.
 */
function shownOrders() {
  const kept =
    state.filter === 'left' ? state.orders.filter((order) => !orderIsDone(order)) : state.orders;

  if (state.sort !== 'model') return kept;
  return [...kept].sort((a, b) =>
    (a.lineItems?.[0]?.title ?? '').localeCompare(b.lineItems?.[0]?.title ?? '', locale),
  );
}

function renderOrders() {
  const finished = state.orders.filter(orderIsDone).length;
  const left = state.orders.length - finished;

  $('count-left').textContent = String(left);
  $('count-all').textContent = String(state.orders.length);
  $('ws-sort')?.setAttribute('aria-pressed', String(state.sort === 'model'));

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

  const shown = shownOrders();

  // Le guichet ne survit pas à un rafraîchissement qui a retiré sa commande
  // de la période : on retombe sur la liste plutôt que sur un écran vide.
  if (state.focus && !state.orders.some((order) => order.id === state.focus)) {
    state.focus = null;
  }

  // Plein écran veut dire plein écran : au guichet, la période, les chips et
  // la progression du jour disparaissent — on y revient par « Liste ».
  document.body.classList.toggle('ws-focus', Boolean(state.focus));

  if (state.focus) {
    renderFocus(shown);
    return;
  }

  if (state.orders.length === 0) {
    $('ws-orders').innerHTML = emptyState(t('orders.empty'));
    return;
  }

  if (shown.length === 0) {
    $('ws-orders').innerHTML = emptyState(t('orders.allDone'), true);
    return;
  }

  /*
   * La liste ne travaille pas, elle oriente.
   *
   * Une ligne par commande : le modèle en photo, le numéro, le client et la
   * ville, l'état. Tout le reste — adresse complète, champs de saisie, photo
   * d'étiquette — vit au guichet, une commande à la fois. Une liste de
   * quatre-vingt-treize formulaires dépliés n'est pas une liste, c'est un
   * couloir dans lequel on se perd.
   */
  $('ws-orders').innerHTML = shown
    .map((order) => {
      const address = order.shippingAddress ?? {};
      const item = order.lineItems?.[0];
      const done = orderIsDone(order);
      const total = parcelTotal(order);
      const phoneShort = (address.phone ?? '').replace(/\D/g, '').length < 9;

      return `<button type="button" class="rowo${done ? ' rowo-done' : ''}" data-open="${esc(
        order.id,
      )}">
        ${
          item?.image
            ? `<img class="rowo-photo" src="${esc(item.image)}" alt="" loading="lazy" />`
            : '<span class="rowo-photo rowo-photo-none" aria-hidden="true"></span>'
        }
        <span class="rowo-main">
          <span class="rowo-top">
            <b>${esc(order.name)}</b>
            <span>${esc(order.customer?.displayName ?? address.name ?? t('orders.customer'))}
              · ${esc(address.city ?? '')}</span>
          </span>
          <small>${esc(item?.title ?? '')}${
            item?.variantTitle ? ` · ${esc(item.variantTitle)}` : ''
          }${phoneShort ? ` <b class="rowo-warn">☎ ${esc(t('orders.phoneMissing'))}</b>` : ''}</small>
        </span>
        <span class="rowo-state${done ? ' ok' : ''}">${
          done
            ? '✓'
            : esc(t('progress.parcels', { done: orderDone(order, total), total }))
        }</span>
        <svg class="rowo-car" viewBox="0 0 20 20" aria-hidden="true"><path d="m7.5 4.5 5.5 5.5-5.5 5.5" /></svg>
      </button>`;
    })
    .join('');
}

/**
 * Le guichet : une commande plein écran, et la suivante au bout du pouce.
 *
 * La barre de tête dit où l'on en est dans la file (« 12 / 93 ») et permet de
 * naviguer sans repasser par la liste. Tout ce que la carte longue affichait
 * est là — adresse en grand, article en photo, saisie des colis — mais pour
 * une seule commande, celle qu'on tient dans les mains.
 */
function renderFocus(shown) {
  const order = state.orders.find((candidate) => candidate.id === state.focus);
  // La commande peut avoir quitté la file visible (filtrée « À préparer » et
  // tout juste finie) : la position se lit alors dans la liste complète.
  const list = shown.some((candidate) => candidate.id === order.id) ? shown : state.orders;
  const at = list.findIndex((candidate) => candidate.id === order.id);

  const address = order.shippingAddress ?? {};
  const phone = address.phone ?? '';
  // Un numéro trop court bloquera la livraison : autant que l'atelier le
  // voie avant d'emballer, pas le transporteur devant la porte.
  const phoneShort = phone.replace(/\D/g, '').length < 9;
  const total = parcelTotal(order);
  const done = orderDone(order, total);

  $('ws-orders').innerHTML = `
    <div class="focus-bar">
      <button type="button" class="btn btn-small" data-back="1">← ${esc(t('focus.back'))}</button>
      <span class="focus-pos">${at + 1} / ${list.length}</span>
      <span class="focus-nav">
        <button type="button" class="btn btn-small" data-nav="prev" ${at <= 0 ? 'disabled' : ''}
          aria-label="${esc(t('focus.prev'))}">←</button>
        <button type="button" class="btn btn-small" data-nav="next"
          ${at >= list.length - 1 ? 'disabled' : ''}
          aria-label="${esc(t('focus.next'))}">→</button>
      </span>
    </div>

    <article class="ord ord-focus${done === total ? ' ord-done' : ''}">
      <div class="ord-head">
        <b class="ord-no">${esc(order.name)}</b>
        <span class="pill pill-${esc(String(order.displayFulfillmentStatus ?? '').toLowerCase())}">${esc(
          statutCommande(order.displayFulfillmentStatus),
        )}</span>
        <span class="ord-when">${esc(shortMoment(order.createdAt))}</span>
      </div>

      <div class="ord-who">
        <span class="ord-label">${esc(t('focus.customer'))}</span>
        <b>${esc(order.customer?.displayName ?? address.name ?? t('orders.customer'))}</b>
        <span>${esc([address.address1, address.address2].filter(Boolean).join(' '))}</span>
        <span>${esc(`${address.zip ?? ''} ${address.city ?? ''} ${address.country ?? ''}`.trim())}</span>
        <span class="ord-tel">
          <a href="tel:${esc(phone)}" class="ord-phone${phoneShort ? ' missing' : ''}">
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M6.5 3.5 8 7 6.5 8.2a8 8 0 0 0 5.3 5.3L13 12l3.5 1.5-.6 2.6A1.5 1.5 0 0 1 14.4 17 11.5 11.5 0 0 1 3 5.6a1.5 1.5 0 0 1 .9-1.5z" /></svg>
            ${esc(phone || t('orders.phoneMissing'))}
          </a>
        </span>
      </div>

      <div class="ord-ship">
        <span class="ord-label">${esc(t('focus.shipping'))}</span>
        <!-- Le nombre de colis, compact : c'est un réglage rare — une commande
             part presque toujours en un colis — et il occupait toute la
             largeur, au-dessus du champ qu'on remplit à chaque commande. -->
        <!-- Pas d'étiquette visible : chaque option dit déjà « 1 colis »,
             « 2 colis », et « Colis · 1 colis » se lisait en double. Le nom
             reste pour les lecteurs d'écran. -->
        <label class="ord-count">
          <select data-total="${esc(order.id)}" aria-label="${esc(t('orders.parcelCount'))}">
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
      </div>

      ${progressBar(done, total, t('progress.parcels', { done, total }))}

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

      <p class="ord-hint">${esc(t('focus.enterHint'))}</p>

      <div class="ord-foot">
        <!-- Un bouton, pas un lien pâle : c'est ici que l'atelier dit qu'un
             article manque, et une rupture non signalée est une commande qui
             part incomplète. -->
        <button class="btn ord-report" data-issue="${esc(order.id)}">
          <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 3 2.5 16.5h15z" /><path d="M10 8.5v3.5M10 14.3v.2" /></svg>
          ${esc(t('orders.report'))}
        </button>
      </div>

      <!-- Tout ce qui est arrivé à cette commande, à la suite : chargé à
           l'ouverture seulement, la plupart des commandes se préparent sans. -->
      <details class="ord-hist" data-hist="${esc(order.id)}" data-hist-no="${esc(order.name)}">
        <summary>${esc(t('hist.title'))}</summary>
        <div class="ord-hist-list"></div>
      </details>
    </article>`;

  $('ws-orders')
    .querySelector('[data-hist]')
    ?.addEventListener('toggle', (event) => {
      if (event.currentTarget.open) void chargerHistorique(event.currentTarget);
    });

  // Le guichet s'ouvre en haut de la commande, pas là où la liste en était.
  $('ws-orders').scrollIntoView({ block: 'start' });
}

/*
 * L'historique d'une commande : reçue dans un lot, demandes et réponses,
 * remplacements, signalements, colis. Le serveur ne renvoie que des faits ;
 * la phrase se compose ici, dans la langue de l'atelier.
 */
async function chargerHistorique(details) {
  if (details.dataset.charge) return;
  details.dataset.charge = '1';
  const liste = details.querySelector('.ord-hist-list');
  liste.innerHTML = `<p class="empty">${esc(t('tk.loading'))}</p>`;
  try {
    const { evenements } = await api(
      `/api/workspace/${supplierId}/historique?commande=${encodeURIComponent(details.dataset.hist)}&numero=${encodeURIComponent(details.dataset.histNo)}`,
    );
    liste.innerHTML = evenements.length
      ? `<ol>${evenements.map(ligneHistorique).join('')}</ol>`
      : `<p class="empty">${esc(t('hist.empty'))}</p>`;
  } catch (error) {
    // Un échec se réessaie en refermant puis rouvrant.
    delete details.dataset.charge;
    liste.innerHTML = `<p class="empty">${esc(error.code ? messageServeur(error, 'hist') : t('hist.error'))}</p>`;
  }
}

function ligneHistorique(evenement) {
  const changement =
    evenement.afterValue && !['DELAY', 'MISSING_ITEM', 'TRACKING'].includes(evenement.kind)
      ? ` : ${evenement.beforeValue ?? '?'} → ${evenement.afterValue}`
      : evenement.kind === 'DELAY' && evenement.afterValue
        ? ` : ${evenement.afterValue}`
        : evenement.beforeValue && ['MISSING_ITEM', 'TRACKING'].includes(evenement.kind)
          ? ` : ${evenement.beforeValue}`
          : '';
  const texte = {
    LOT: () => t('hist.lot'),
    DEMANDE: () => `${t('hist.request')} — ${kindLabel(evenement.kind)}${changement}`,
    REPONSE: () =>
      `${t(evenement.accepte ? 'hist.confirmed' : 'hist.refused', { quoi: kindLabel(evenement.kind) })}${
        evenement.note ? ` — « ${evenement.note} »` : ''
      }`,
    REMPLACEMENT: () => t('hist.subst', { n: evenement.combien }),
    REMPLACEMENT_REPONSE: () => t(evenement.accepte ? 'hist.substYes' : 'hist.substNo', { modele: evenement.modele }),
    SIGNALEMENT: () => `${t('hist.report')}${evenement.sujet ? ` — ${evenement.sujet}` : ''}`,
    COLIS: () =>
      `${t('hist.parcel', { i: evenement.index, n: evenement.total })} : ${evenement.numero}${
        evenement.transporteur ? ` (${evenement.transporteur})` : ''
      }`,
  }[evenement.type];
  const date = new Date(evenement.date);
  return `<li class="hist-${esc(evenement.type.toLowerCase())}">
    <time datetime="${esc(evenement.date)}">${esc(
      date.toLocaleDateString(locale, { day: '2-digit', month: '2-digit' }),
    )} ${esc(date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }))}</time>
    <span>${esc(texte ? texte() : evenement.type)}</span>
  </li>`;
}

/**
 * Après un « Enregistrer » qui finit la commande : la suivante, toute seule.
 *
 * C'est le geste qui fait du guichet un poste de travail — enregistrer, poser
 * le carton, attraper le suivant, et l'écran a déjà changé. La file est celle
 * des commandes restantes ; quand elle est vide, on revient à la liste, qui
 * affiche alors « tout est préparé ».
 */
function advanceFocus() {
  const remaining = shownOrders().filter((order) => !orderIsDone(order));
  const next = remaining.find((order) => order.id !== state.focus) ?? null;

  state.focus = next?.id ?? null;
  renderOrders();
  // Pas de toast ici : celui de l'enregistrement — « colis expédié, client
  // prévenu » — vient de partir, et l'écran qui change dit déjà le reste.
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
    state.testMode = Boolean(data.testMode);
    $('ws-test').hidden = !state.testMode;
    state.fonctionnalites = data.fonctionnalites ?? {};
    appliquerFonctionnalites();
    // Deux formats : la feuille Excel reprend la mise en page de l'atelier,
    // le CSV sert à qui veut retravailler les données.
    $('ws-xlsx').href = apiUrl(`/api/workspace/${supplierId}/orders.xlsx`).toString();
    $('ws-csv').href = apiUrl(`/api/workspace/${supplierId}/orders.csv`).toString();
    // L'étape 1 de l'import : la même feuille, pour la même période.
    $('bulk-xlsx').href = $('ws-xlsx').href;

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
  const open = event.target.closest('[data-open]');
  if (open) {
    state.focus = open.dataset.open;
    renderOrders();
    return;
  }

  const back = event.target.closest('[data-back]');
  if (back) {
    state.focus = null;
    renderOrders();
    return;
  }

  const nav = event.target.closest('[data-nav]');
  if (nav) {
    const shown = shownOrders();
    const list = shown.some((order) => order.id === state.focus) ? shown : state.orders;
    const at = list.findIndex((order) => order.id === state.focus);
    const target = list[at + (nav.dataset.nav === 'next' ? 1 : -1)];
    if (target) {
      state.focus = target.id;
      renderOrders();
    }
    return;
  }

  const scan = event.target.closest('[data-scan]');
  if (scan) {
    const input = scan.closest('.pk-track').querySelector('[data-field="tracking"]');
    void scanInto(input);
    return;
  }

  const del = event.target.closest('[data-del]');
  if (del) {
    await deleteParcel(del.dataset.del, del.dataset.number, del);
    return;
  }

  const issue = event.target.closest('[data-issue]');
  if (issue) {
    $('issue-find').hidden = true;
    $('issue-note').value = '';
    preparerSignalement(state.orders.find((order) => order.id === issue.dataset.issue) ?? null);
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
    const carrier = card.querySelector('[data-field="carrier"]').value.trim() || null;
    const reponse = pid
      ? await corrigerColis(pid, { trackingNumber, carrier, photo: card.dataset.photo ?? null })
      : await api(`/api/workspace/${supplierId}/parcels`, {
          method: 'POST',
          body: {
            shopifyOrderId: orderId,
            orderName: order?.name ?? null,
            trackingNumber,
            carrier,
            index: Number(card.dataset.index),
            total: Number(document.querySelector(`[data-total="${CSS.escape(orderId)}"]`).value),
            photo: card.dataset.photo ?? null,
          },
        });

    // Correction annulée à la question « le client a déjà ce numéro » : rien n'a changé.
    if (!reponse) return;
    const { parcel, shopify, clientPrevenu } = reponse;

    order.parcels = [
      ...(order.parcels ?? []).filter((existing) => existing.index !== parcel.index),
      parcel,
    ].sort((a, b) => a.index - b.index);

    rememberCarrier(parcel.carrier ?? '');

    // Le dernier colis déclenche l'expédition Shopify : le fournisseur doit
    // savoir si le client est prévenu, ou pourquoi il ne l'est pas.
    if (pid && clientPrevenu) {
      toast(t(state.testMode ? 'parcel.correctedTest' : 'parcel.correctedNotified'));
    } else if (shopify?.fulfilled && state.testMode) {
      toast(t('test.parcelSaved'));
    } else if (shopify?.fulfilled) {
      toast(t('parcel.shipped'));
    } else if (shopify?.reason) {
      toast(t('parcel.shipFail', { reason: shopify.reason }), true);
    } else {
      toast(t('parcel.savedToast', { index: parcel.index, total: parcel.total }));
    }

    // Au guichet, la commande finie appelle la suivante d'elle-même : c'est
    // tout l'intérêt d'un guichet. Tant qu'il reste un colis, on reste.
    if (state.focus === orderId && orderIsDone(order)) {
      advanceFocus();
    } else {
      renderOrders();
    }
  } catch (error) {
    toast(messageServeur(error, 'parcel.err'), true);
  } finally {
    save.disabled = false;
  }
});

/*
 * Corriger un colis déjà enregistré — depuis le guichet ou la liste de suivi.
 *
 * Si le client a déjà reçu l'ancien numéro, le serveur demande une
 * confirmation avant tout : la correction lui enverra un nouvel e-mail. On la
 * demande ici en nommant les deux numéros, puis on renvoie la correction
 * confirmée. Rend `null` si l'atelier renonce — rien n'a alors changé.
 */
async function corrigerColis(pid, corps) {
  const chemin = `/api/workspace/${supplierId}/parcels/${pid}`;
  try {
    return await api(chemin, { method: 'PATCH', body: corps });
  } catch (error) {
    if (error.code !== 'client_deja_prevenu') throw error;
    const question = t(state.testMode ? 'parcel.editConfirmTest' : 'parcel.editConfirm', {
      old: error.donnees?.ancien ?? '',
      number: corps.trackingNumber,
    });
    if (!confirm(question)) return null;
    return api(chemin, { method: 'PATCH', body: { ...corps, prevenirClient: true } });
  }
}

/**
 * La commande visée par le signalement, et l'article pré-rempli.
 *
 * Le premier article de la commande : dans neuf cas sur dix c'est celui qui
 * manque, et le fournisseur n'a plus qu'à corriger.
 */
function preparerSignalement(order) {
  state.issueOrder = order;
  $('issue-order').textContent = order ? t('issue.order', { name: order.name ?? '' }) : '';
  const first = order?.lineItems?.[0];
  $('issue-product').value = first?.title ?? '';
  const { couleur, taille } = repartirDeclinaison(first?.variantTitle);
  $('issue-color').value = couleur;
  $('issue-size').value = taille;
  $('issue-sku').value = first?.sku ?? '';
  $('issue-qty').value = String(first?.quantity ?? 1);
  toggleIssueItem();
}

/*
 * « Nouveau ticket », depuis la rubrique Tickets.
 *
 * Même fenêtre que depuis une ligne de commande, la commande en moins : elle
 * se retrouve par son numéro, avec la même recherche que la liste — donc le
 * même niveau d'accès.
 */
$('ws-new-ticket')?.addEventListener('click', () => {
  preparerSignalement(null);
  $('issue-find').hidden = false;
  $('issue-num').value = '';
  $('issue-find-res').textContent = '';
  $('issue-note').value = '';
  $('issue-modal').classList.add('open');
  $('issue-num').focus();
});

async function trouverCommandeDuTicket() {
  const terme = $('issue-num').value.trim();
  if (terme.length < 2) return;

  $('issue-find-res').textContent = '…';
  try {
    const data = await api(`/api/workspace/${supplierId}/orders/search?q=${encodeURIComponent(terme)}`);
    const order = data.orders?.[0] ?? null;
    preparerSignalement(order);
    $('issue-find-res').textContent = order
      ? t('ticket.found', { name: order.name ?? '' })
      : (data.reason ?? t('orders.notFound'));
  } catch (error) {
    preparerSignalement(null);
    $('issue-find-res').textContent = messageServeur(error, 'orders.err');
  }
}

$('issue-find-btn')?.addEventListener('click', () => void trouverCommandeDuTicket());
$('issue-num')?.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter') return;
  event.preventDefault();
  void trouverCommandeDuTicket();
});

$('issue-cancel').addEventListener('click', () => $('issue-modal').classList.remove('open'));

$('issue-modal').addEventListener('click', (event) => {
  if (event.target === $('issue-modal')) $('issue-modal').classList.remove('open');
});

$('issue-send').addEventListener('click', async () => {
  const note = $('issue-note').value.trim();
  if (!state.issueOrder) {
    toast(t('ticket.needOrder'), true);
    return;
  }
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
          // « Voir » et non « C'est fait » : ce bouton ouvre l'écran, il ne
          // confirme rien. Une étiquette qui promet une action que le clic ne
          // fait pas est celle qu'on presse sans lire.
          t('alert.open'),
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

/*
 * Les pastilles du menu, relevées dès l'arrivée puis au rythme des alertes.
 *
 * Toutes deux ne se calculaient qu'en ouvrant leur onglet. Une pastille qui
 * ne s'allume qu'une fois qu'on a cliqué dessus ne signale rien : on a déjà
 * trouvé ce qu'elle devait montrer. Deux minutes suffisent pour des demandes
 * qui se traitent dans la journée.
 */
function rafraichirPastilles() {
  void rafraichirPastilleUpdates();
  void rafraichirPastilleRuptures();
  void rafraichirPastilleEchanges();
}
rafraichirPastilles();
setInterval(rafraichirPastilles, 120000);


/* ==========================================================================
   NAVIGATION — quatre écrans

   Colonne à gauche sur ordinateur, barre d'onglets en bas sur téléphone. Le
   fournisseur tient son appareil d'une main pendant qu'il emballe de l'autre :
   ce que le pouce n'atteint pas n'existe pas.
   ========================================================================== */

const VIEWS = {
  home: loadHome,
  orders: () => {},
  tracking: loadParcels,
  lots: loadLots,
  catalog: loadCatalog,
  tickets: loadTickets,
};

/*
 * Trois écrans, et non six.
 *
 * « Suivi » n'était pas un écran : il reliste les colis saisis dans
 * « Commandes ». Et « Changements », « Ruptures », « Échanges » sont trois
 * boîtes de réception pour une seule question — qu'attend-on de moi ?
 * Le contenu n'a pas bougé ; c'est la navigation qui cesse de faire choisir
 * en permanence ce qui se choisit en un clic, à l'intérieur.
 */
const ECRANS = {
  home: ['home'],
  orders: ['orders', 'tracking', 'lots'],
  catalog: ['catalog'],
  tickets: ['tickets'],
};
const TOUTES = ['home', 'orders', 'tracking', 'lots', 'catalog', 'tickets'];

function setView(view) {
  state.view = view;
  const sections = ECRANS[view] ?? [view];
  const courant = sections.length > 1 ? (state.sous?.[view] ?? sections[0]) : sections[0];

  for (const section of TOUTES) {
    const bloc = $(`view-${section}`);
    if (bloc) bloc.hidden = section !== courant;
  }

  $('ws-sous-cmd').hidden = view !== 'orders';
  for (const barre of ['ws-sous-cmd']) {
    $(barre)?.querySelectorAll('[data-sous]').forEach((bouton) => {
      bouton.setAttribute('aria-pressed', String(bouton.dataset.sous === courant));
    });
  }

  document.querySelectorAll('#ws-nav [data-view]').forEach((button) => {
    button.setAttribute('aria-current', String(button.dataset.view === view));
  });


  // Chaque écran recharge à l'ouverture : le fournisseur laisse l'onglet
  // ouvert toute la journée, et des données de ce matin valent moins que rien.
  void VIEWS[courant]?.();

  // Les trois comptes du guichet se relèvent ensemble : n'en relever qu'un
  // ferait choisir un onglet sur un chiffre périmé.
  if (view === 'tickets') rafraichirPastilles();
}

document.querySelectorAll('[data-sous]').forEach((bouton) =>
  bouton.addEventListener('click', () => {
    state.sous = { ...(state.sous ?? {}), [state.view]: bouton.dataset.sous };
    setView(state.view);
  }),
);

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

$('ws-sort')?.addEventListener('click', () => {
  state.sort = state.sort === 'model' ? 'time' : 'model';
  localStorage.setItem(`ws.sort.${supplierId}`, state.sort);
  renderOrders();
});

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
          <button class="ico ico-edit" data-edit="${esc(parcel.id)}" title="${esc(t('parcel.edit'))}"
            aria-label="${esc(t('parcel.edit'))}">
            <svg viewBox="0 0 20 20" aria-hidden="true">
              <path d="M4 16h3.2l8.3-8.3-3.2-3.2L4 12.8V16zM11.3 5.5l3.2 3.2" />
            </svg>
          </button>
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
  rows.querySelectorAll('[data-edit]').forEach((button) =>
    button.addEventListener('click', () => ouvrirCorrection(button.closest('.trk'), button.dataset.edit)),
  );
}

/*
 * La correction sur place, dans la liste de suivi.
 *
 * La liste servait à relire ; on n'y pouvait que supprimer, et une faute de
 * frappe obligeait à retrouver la commande au guichet. Le numéro et le
 * transporteur se corrigent désormais là où l'erreur se voit.
 */
function ouvrirCorrection(ligne, pid) {
  const parcel = (state.parcels ?? []).find((candidate) => candidate.id === pid);
  if (!ligne || !parcel) return;

  ligne.classList.add('trk-editing');
  ligne.querySelector('.trk-main').innerHTML = `
    <form class="trk-edit">
      <input class="mono" data-field="tracking" value="${esc(parcel.trackingNumber)}"
        aria-label="${esc(t('parcel.tracking'))}" autocomplete="off" spellcheck="false" />
      <input data-field="carrier" list="ws-carriers" value="${esc(parcel.carrier ?? '')}"
        placeholder="${esc(t('parcel.carrier'))}" aria-label="${esc(t('parcel.carrier'))}" />
      <button class="btn btn-small btn-primary" type="submit">${esc(t('parcel.save'))}</button>
      <button class="btn btn-small" type="button" data-cancel>${esc(t('parcel.editCancel'))}</button>
    </form>`;

  const formulaire = ligne.querySelector('.trk-edit');
  formulaire.querySelector('[data-field="tracking"]').focus();
  formulaire.querySelector('[data-cancel]').addEventListener('click', () => void loadParcels());

  formulaire.addEventListener('submit', async (event) => {
    event.preventDefault();
    const trackingNumber = formulaire.querySelector('[data-field="tracking"]').value.trim();
    const carrier = formulaire.querySelector('[data-field="carrier"]').value.trim() || null;
    if (!trackingNumber) return toast(t('parcel.needTracking'), true);

    const bouton = formulaire.querySelector('[type="submit"]');
    bouton.disabled = true;
    try {
      const reponse = await corrigerColis(pid, { trackingNumber, carrier });
      if (!reponse) return;

      const { parcel: corrige, clientPrevenu } = reponse;
      toast(
        t(clientPrevenu ? (state.testMode ? 'parcel.correctedTest' : 'parcel.correctedNotified') : 'parcel.corrected'),
      );
      // La carte de la commande, au guichet, montre le même colis.
      for (const order of state.orders) {
        order.parcels = (order.parcels ?? []).map((existant) => (existant.id === pid ? corrige : existant));
      }
      rememberCarrier(corrige.carrier ?? '');
      await loadParcels();
    } catch (error) {
      toast(messageServeur(error, 'parcel.err'), true);
    } finally {
      bouton.disabled = false;
    }
  });
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
 * « Blackened Blue », c'est laquelle des deux bleues ? La réponse est dans la
 * photo : le catalogue est donc une grille d'images, pas une liste de lignes.
 * Et la question suivante — « la 44.5 existe-t-elle, sous quelle référence » —
 * s'ouvre au tap : la fiche du produit liste chaque déclinaison avec son SKU
 * et son stock. Chargé une seule fois : un catalogue ne bouge pas dans la
 * journée.
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

  if (state.catalogFocus) {
    renderProductSheet();
    return;
  }

  // Le champ de recherche filtre sur place : cent produits sont déjà là, une
  // requête par frappe n'apporterait que l'attente.
  const needle = ($('catalog-q')?.value ?? '').trim().toLowerCase();
  const items = (state.catalog ?? []).filter(
    (item) =>
      !needle ||
      item.title.toLowerCase().includes(needle) ||
      (item.vendor ?? '').toLowerCase().includes(needle),
  );

  $('catalog-search').hidden = (state.catalog ?? []).length === 0;

  rows.innerHTML = items.length
    ? `<div class="cat-grid">${items
        .map(
          (item) => `<button type="button" class="catc" data-product="${esc(item.id)}">
            ${
              item.image
                ? `<img class="catc-photo" src="${esc(item.image)}" alt="" loading="lazy" />`
                : '<span class="catc-photo catc-photo-none" aria-hidden="true"></span>'
            }
            <span class="catc-main">
              <b>${esc(item.title)}</b>
              <small>${esc(t('catalog.variants', { n: item.variantCount ?? 0 }))}${
                item.totalInventory != null && item.totalInventory > 0
                  ? ` · ${esc(t('catalog.stock', { n: item.totalInventory }))}`
                  : ''
              }</small>
            </span>
          </button>`,
        )
        .join('')}</div>`
    : `<p class="empty">${esc(
        error ?? (needle ? t('catalog.noMatch') : t('catalog.empty')),
      )}</p>`;
}

/**
 * La fiche d'un produit : ses déclinaisons, une par ligne.
 *
 * L'atelier vient vérifier une taille et une référence, pas contempler le
 * modèle : la liste dit pour chaque déclinaison son SKU, son stock, et
 * « épuisé » quand Shopify la déclare invendable — c'est le mot qui évite un
 * ticket de rupture découvert au moment d'emballer.
 */
async function renderProductSheet() {
  const rows = $('catalog-rows');
  $('catalog-search').hidden = true;

  const back = `<div class="focus-bar">
    <button type="button" class="btn btn-small" data-cat-back="1">← ${esc(
      t('catalog.back'),
    )}</button>
  </div>`;

  const cached = state.catalogSheets?.[state.catalogFocus];
  if (!cached) {
    rows.innerHTML = `${back}<p class="empty">…</p>`;
    try {
      const numeric = state.catalogFocus.split('/').pop();
      const { product } = await api(`/api/workspace/${supplierId}/catalog/${numeric}`);
      (state.catalogSheets ??= {})[state.catalogFocus] = product;
    } catch (error) {
      rows.innerHTML = `${back}<p class="empty">${esc(error.message)}</p>`;
      return;
    }
    // L'utilisateur a pu quitter la fiche pendant le chargement.
    if (state.catalogFocus) renderProductSheet();
    return;
  }

  const product = cached;
  rows.innerHTML = `${back}
    <div class="sheet">
      <div class="sheet-head">
        ${
          product.image
            ? `<img class="sheet-photo" src="${esc(product.image)}" alt="" />`
            : '<span class="sheet-photo catc-photo-none" aria-hidden="true"></span>'
        }
        <div>
          <h2>${esc(product.title)}</h2>
          <small>${esc(product.vendor ?? '')}</small>
        </div>
      </div>
      <div class="sheet-vars">
        ${product.variants
          .map(
            (variant) => `<div class="varr${variant.availableForSale ? '' : ' out'}">
              ${
                variant.image
                  ? `<img class="varr-photo" src="${esc(variant.image)}" alt="" loading="lazy" />`
                  : ''
              }
              <b class="varr-title">${esc(variant.title ?? '—')}</b>
              <span class="varr-sku mono">${esc(variant.sku ?? '')}</span>
              ${
                variant.availableForSale
                  ? variant.inventoryQuantity != null && variant.inventoryQuantity > 0
                    ? `<span class="varr-stock">${esc(
                        t('catalog.stock', { n: variant.inventoryQuantity }),
                      )}</span>`
                    : ''
                  : `<span class="varr-out">${esc(t('catalog.out'))}</span>`
              }
            </div>`,
          )
          .join('')}
      </div>
    </div>`;
}

$('catalog-rows').addEventListener('click', (event) => {
  const open = event.target.closest('[data-product]');
  if (open) {
    state.catalogFocus = open.dataset.product;
    renderCatalog();
    return;
  }
  if (event.target.closest('[data-cat-back]')) {
    state.catalogFocus = null;
    renderCatalog();
  }
});

$('catalog-q')?.addEventListener('input', () => renderCatalog());

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
/** La carte d'une demande de changement : ce qui est demandé, et deux boutons. */
function carteUpdate(update) {
  const STATUS = {
    PENDING: { cls: 'wait', label: t('updates.pending') },
    ACKNOWLEDGED: { cls: 'ok', label: t('updates.accepted') },
    REFUSED: { cls: 'bad', label: t('updates.refused') },
  };
    const status = STATUS[update.status] ?? STATUS.PENDING;

    return `<div class="upd upd-${status.cls}" data-upd="${esc(update.id)}">
      <div class="upd-head">
        <b>${esc(kindLabel(update.kind))}</b>
        ${update.orderName ? `<span class="tag tag-order">${esc(update.orderName)}</span>` : ''}
        <span class="tag tone-${status.cls}">${esc(status.label)}</span>
        <span class="upd-when">${new Date(update.createdAt).toLocaleDateString(locale)}</span>
      </div>

      ${
        update.kind === 'TRACKING' && update.beforeValue
          ? `<div class="upd-swap">
               <span class="upd-label">${esc(t('updates.parcels'))}</span>
               <span class="upd-after">${esc(update.beforeValue)}</span>
             </div>`
          : update.kind === 'MISSING_ITEM' && update.beforeValue
          ? `<div class="upd-swap">
               <span class="upd-label">${esc(t('updates.missing'))}</span>
               <span class="upd-after">${esc(update.beforeValue)}</span>
             </div>`
          : update.kind === 'DELAY' && update.afterValue
          ? `<div class="upd-swap">
               <span class="upd-label">${esc(t('updates.shipBy'))}</span>
               <span class="upd-after">${esc(
                 /^\d{4}-\d{2}-\d{2}$/.test(update.afterValue)
                   ? new Date(`${update.afterValue}T12:00:00`).toLocaleDateString(locale)
                   : update.afterValue,
               )}</span>
             </div>`
          : update.afterValue
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
}

/*
 * La déclinaison Shopify, rangée dans le bon champ.
 *
 * Elle allait TOUJOURS dans « Couleur ». Pour une chaussure, la déclinaison
 * est la pointure : le marchand recevait « Couleur : 45 1/3 », qui est une
 * taille — et la console des ruptures, qui relit ces champs, rangeait la
 * pointure dans la colonne couleur et laissait la taille vide.
 *
 * Shopify n'étiquette pas ses options dans ce titre : « Black / 42 »,
 * « 45 1/3 », « Rouge ». On sépare donc sur la barre oblique quand elle
 * existe, et sinon on regarde la forme — une pointure est faite de chiffres,
 * avec parfois une fraction ou une virgule. Le reste est une couleur.
 *
 * Le fournisseur corrige en un clic si l'on s'est trompé : les deux champs
 * sont côte à côte, et c'est lui qui a la chaussure en main.
 */
function repartirDeclinaison(variante) {
  const texte = (variante ?? '').trim();
  if (!texte) return { couleur: '', taille: '' };

  /*
   * Shopify joint ses options par une barre oblique ENTOURÉE d'espaces, et
   * c'est cette exigence d'espaces qui fait tout le travail : « 45 1/3 »
   * porte une barre oblique qui n'est PAS un séparateur. Découper sans
   * l'exiger donnait « Couleur : 45 1 » et « Taille : 3 », pire que l'erreur
   * d'origine.
   */
  const morceaux = texte.split(/\s+\/\s+/).map((morceau) => morceau.trim()).filter(Boolean);
  const taille = morceaux.find(ressembleAUneTaille);

  // Aucune option ne ressemble à une pointure — « Black / Rouge » : tout est
  // couleur, et l'atelier remplira la taille lui-même.
  if (!taille) return { couleur: texte, taille: '' };

  return { couleur: morceaux.filter((morceau) => morceau !== taille).join(' / '), taille };
}

/* Une pointure : des chiffres, éventuellement une décimale ou une fraction —
   « 42 », « 45 1/3 », « 38,5 », « 10.5 ». Pas « Black », pas « Lucid Red ». */
function ressembleAUneTaille(valeur) {
  return /^\d{1,2}([.,]\d)?(\s+\d\/\d)?$/.test((valeur ?? '').trim());
}

function kindLabel(kind) {
  const label = t(`kind.${kind}`);
  return label === `kind.${kind}` ? t('alert.fallback') : label;
}

/*
 * Une seule pastille, trois comptes.
 *
 * L'atelier avait trois entrées de menu et trois pastilles — Changements,
 * Ruptures, Échanges — pour une seule question : qu'attend-on de moi ? Le
 * total s'affiche maintenant sur « Tickets », et le détail par type sur les
 * onglets intérieurs, où il sert à choisir par quoi commencer.
 */
const attentes = { updates: 0, ruptures: 0, echanges: 0 };

function majPastilleTickets() {
  const total = attentes.updates + attentes.ruptures + attentes.echanges;
  const badge = $('ws-tickets-badge');
  if (badge) {
    badge.hidden = total === 0;
    badge.textContent = String(total);
  }

  // Le même total sur le filtre « À répondre » de la liste : les deux
  // chiffres disent la même chose, ils doivent être égaux.
  const compteur = $('tk-n-rep');
  if (compteur) {
    compteur.hidden = total === 0;
    compteur.textContent = String(total);
  }
}

function setBadge(count) {
  attentes.updates = count;
  majPastilleTickets();
}

/*
 * La pastille « Update », relevée sans ouvrir l'onglet.
 *
 * Même défaut que celle des ruptures, et plus ancien : elle n'était posée que
 * par `loadUpdates`, c'est-à-dire à l'ouverture de l'écran des changements.
 * Un fournisseur qui arrive sur « Commandes » ne voyait donc jamais qu'une
 * demande de changement l'attendait — la bannière d'alertes le disait, mais
 * seulement pour les demandes récentes, et elle se ferme.
 *
 * En échec elle s'éteint : elle n'a pas d'autre source que cette liste, et
 * un chiffre qu'on n'a pas pu relire est un chiffre inventé.
 */
async function rafraichirPastilleUpdates() {
  try {
    const data = await api(`/api/workspace/${supplierId}/updates`);
    setBadge(data.pending ?? 0);
  } catch {
    setBadge(0);
  }
}

async function respond(id, status, note = null) {
  try {
    await api(`/api/workspace/${supplierId}/updates/${id}/respond`, {
      method: 'POST',
      body: { status, note },
    });
    toast(t('updates.sent'));
    await Promise.all([loadTickets(), loadAlerts()]);
  } catch (error) {
    toast(error.message, true);
  }
}

$('ws-more')?.addEventListener('click', () => {
  const drawer = $('ws-drawer');
  drawer.hidden = !drawer.hidden;
  $('ws-more').setAttribute('aria-expanded', String(!drawer.hidden));
});

$('ws-reload').addEventListener('click', () => {
  state.chargementCommandes = load();
});

// L'accueil compte les commandes à préparer : il attend cette lecture-là.
state.chargementCommandes = load();


/* ------------------------------------------- chercher une commande -- */

/*
 * Retrouver n'importe quelle commande par son numéro.
 *
 * La liste est bornée par une plage de dates : un client cite une commande
 * d'il y a trois semaines, et l'atelier ne peut pas la retrouver — il n'a que
 * « Hier / Aujourd'hui / 7 jours » et un export. La recherche ignore les
 * dates ; elle n'ouvre aucun droit nouveau, le niveau d'accès posé par le
 * marchand s'applique exactement comme dans la liste.
 *
 * Le champ vidé rend la liste de la période : chercher ne doit pas obliger à
 * recharger la page pour revenir à sa journée.
 */
let chercheCommande;

async function chercherCommande(terme) {
  const propre = terme.trim();
  if (propre.length < 2) {
    await load();
    return;
  }

  try {
    const data = await api(
      `/api/workspace/${supplierId}/orders/search?q=${encodeURIComponent(propre)}`,
    );
    state.orders = data.orders ?? [];
    renderOrders();

    if (state.orders.length === 0) {
      $('ws-orders').innerHTML = `<p class="empty">${esc(data.reason ?? t('orders.notFound'))}</p>`;
    }
  } catch (error) {
    $('ws-orders').innerHTML = `<p class="empty">${esc(messageServeur(error, 'orders.err'))}</p>`;
  }
}

$('ws-cmd-q')?.addEventListener('input', (event) => {
  // Une frappe par caractère déclencherait un appel Shopify par touche.
  clearTimeout(chercheCommande);
  const terme = event.target.value;
  chercheCommande = setTimeout(() => void chercherCommande(terme), 400);
});

/* ------------------------------------------------------------ ruptures -- */

/*
 * L'écran des ruptures, côté atelier.
 *
 * Deux listes, et l'ordre compte : ce que le marchand DEMANDE avant ce que
 * l'atelier a déjà DIT. La première appelle un geste aujourd'hui ; la seconde
 * informe, et répond à une question que le préparateur se pose sans pouvoir
 * la poser — « est-ce qu'ils l'ont vu ? ». Jusqu'ici, signaler un article
 * manquant envoyait l'information dans le vide : rien ne revenait, et il
 * fallait choisir entre attendre et emballer sans savoir.
 */

/*
 * La carte d'une rupture : le modèle manquant, et ce qu'on propose à la place.
 *
 * ELLE NE RENVOIE PLUS VERS UN FIL DE DISCUSSION. L'atelier devait cliquer
 * « Répondre au marchand », quitter son outil, lire un message, écrire une
 * phrase. Entre la question et la réponse il se passait des jours, et
 * personne ne savait d'un coup d'œil ce qui avait été proposé.
 *
 * Le modèle en rupture est donc montré en champs — article, taille, référence,
 * quantité — et les remplacements proposés en face, chacun avec deux boutons.
 * Répondre ne demande plus d'écrire.
 */
function carteRupture(dossier, phase, date, estDemande) {
  const label = {
    cree: t(estDemande ? 'rup.waiting' : 'rup.todo'),
    traite: t(estDemande ? 'rup.answered' : 'rup.done'),
    classe: t('rup.closed'),
  }[phase];

  const article = dossier.article ?? {};
  const champs = [
    [t('rup.model'), article.produit],
    [t('issue.color'), article.couleur],
    [t('issue.size'), article.taille],
    [t('rup.ref'), article.reference],
    [t('issue.qty'), article.quantite],
  ].filter(([, valeur]) => valeur);

  const propositions = dossier.substitutions ?? [];

  return `<div class="upd rup-p-${esc(phase)}" data-rup-ticket="${esc(dossier.ticketId ?? dossier.id)}">
    <div class="upd-head">
      <b>${esc(
        dossier.orderName ? t('rup.order').replace('{name}', dossier.orderName) : t('rup.noOrder'),
      )}</b>
      <span class="pill">${esc(label)}</span>
      <span class="upd-when">${esc(new Date(date).toLocaleDateString(locale))}</span>
    </div>

    ${
      champs.length
        ? `<div class="rup-bloc">
             <span class="rup-bloc-t">${esc(t('rup.outOfStock'))}</span>
             <dl class="rup-champs">${champs
               .map(([nom, valeur]) => `<dt>${esc(nom)}</dt><dd>${esc(valeur)}</dd>`)
               .join('')}</dl>
           </div>`
        : dossier.message || dossier.detail
          ? `<p class="upd-msg rup-detail">${esc(dossier.message ?? dossier.detail)}</p>`
          : ''
    }
    ${dossier.note ? `<p class="upd-note">${esc(dossier.note)}</p>` : ''}

    ${
      propositions.length
        ? `<div class="rup-bloc">
             <span class="rup-bloc-t">${esc(t('rup.proposed'))}</span>
             ${propositions.map(substitutionMarkup).join('')}
           </div>`
        : ''
    }
  </div>`;
}

/* Une proposition : ce qu'on envoie à la place, et deux boutons pour le dire. */
function substitutionMarkup(proposition) {
  const details = [proposition.variantTitle, proposition.sku].filter(Boolean).join(' · ');
  const repondu = proposition.accepte !== null && proposition.accepte !== undefined;

  return `<div class="rup-sub${repondu ? (proposition.accepte ? ' rup-sub-oui' : ' rup-sub-non') : ''}"
    data-sub="${esc(proposition.id)}">
    ${
      proposition.image
        ? `<img src="${esc(proposition.image)}" alt="" loading="lazy" />`
        : '<span class="rup-sub-vide"></span>'
    }
    <div class="rup-sub-txt">
      <b>${esc(proposition.productTitle)}</b>
      ${details ? `<small>${esc(details)}</small>` : ''}
      ${
        typeof proposition.inventory === 'number'
          ? `<small class="rup-sub-stock">${esc(
              t('rup.inStock').replace('{n}', String(proposition.inventory)),
            )}</small>`
          : proposition.libre
            ? `<small class="rup-sub-stock">${esc(t('rup.offCatalog'))}</small>`
            : ''
      }
    </div>
    ${
      repondu
        ? `<span class="pill">${esc(t(proposition.accepte ? 'rup.canDo' : 'rup.cannot'))}</span>`
        : `<div class="rup-sub-acts">
             <button class="btn btn-small btn-primary" type="button" data-sub-oui="${esc(proposition.id)}">${esc(
               t('rup.yes'),
             )}</button>
             <button class="btn btn-small" type="button" data-sub-non="${esc(proposition.id)}">${esc(
               t('rup.no'),
             )}</button>
           </div>`
    }
  </div>`;
}

/* Un seul câblage pour les deux listes : les cartes sont les mêmes. */
function cablerSubstitutions() {
  for (const [attribut, accepte] of [
    ['data-sub-oui', true],
    ['data-sub-non', false],
  ]) {
    document.querySelectorAll(`#tk-rows [${attribut}]`).forEach((bouton) =>
      bouton.addEventListener('click', () => {
        const id = bouton.getAttribute(attribut);
        void repondreSubstitution(id, accepte, bouton);
      }),
    );
  }
}

async function repondreSubstitution(id, accepte, bouton) {
  const ligne = bouton.closest('.rup-sub');
  ligne?.querySelectorAll('button').forEach((autre) => {
    autre.disabled = true;
  });

  try {
    await api(`/api/workspace/${supplierId}/substitutions/${id}`, {
      method: 'POST',
      body: { accepte },
    });
    toast(t(accepte ? 'rup.sentYes' : 'rup.sentNo'));
    await loadTickets();
  } catch (error) {
    ligne?.querySelectorAll('button').forEach((autre) => {
      autre.disabled = false;
    });
    toast(messageServeur(error, 'rup.err'), true);
  }
}

/*
 * La pastille, relevée sans ouvrir l'onglet.
 *
 * Elle n'était calculée qu'au rendu de la page — donc jamais pour un
 * fournisseur qui arrive, comme tous les matins, sur « Commandes ». Une
 * pastille qui ne s'allume qu'une fois qu'on a cliqué dessus ne signale rien :
 * on a déjà trouvé ce qu'elle devait montrer.
 *
 * En cas d'échec elle s'éteint, pour la même raison que dans la page : on ne
 * sait plus, donc on n'affirme rien. Un « 1 » resté allumé sur une donnée
 * qu'on n'a pas pu relire est un chiffre inventé.
 */
async function rafraichirPastilleRuptures() {
  // Page éteinte depuis la console : pas de pastille, et pas d'appel refusé.
  if (state.fonctionnalites?.rupturesAtelier === false) return setRuptureBadge(0);
  try {
    const data = await api(`/api/workspace/${supplierId}/ruptures`);
    // Même règle que la liste des tickets : la pastille et le filtre
    // « À répondre » doivent toujours dire le même chiffre.
    setRuptureBadge(
      [
        ...(data.demandes ?? []).map((demande) => statutRupture(demande, true)),
        ...(data.signalements ?? []).map((signalement) => statutRupture(signalement, false)),
      ].filter((statut) => statut === 'A_REPONDRE').length,
    );
  } catch {
    setRuptureBadge(0);
  }
}

/* La pastille ne compte que ce qui attend une réponse de l'atelier : un
   signalement n'y entre que si le marchand y a proposé un remplacement. */
function setRuptureBadge(nombre) {
  attentes.ruptures = nombre;
  majPastilleTickets();
}


/* ------------------------------------------------------------ échanges -- */

/*
 * Les échanges confiés à l'atelier.
 *
 * Un client renvoie une paire et en veut une autre. Quand aucune agence n'a la
 * paire voulue en stock, c'est l'atelier qui l'envoie — à l'adresse du client,
 * et non à l'entrepôt.
 *
 * Deux articles s'y croisent, et les confondre coûte un second retour : celui
 * que le client RENVOIE, et celui qu'il VEUT. La carte les montre donc comme
 * un changement de taille — l'ancien barré, le nouveau en couleur — parce que
 * c'est exactement ce que c'est, et que l'atelier connaît déjà cette forme.
 */
function echangeMarkup(echange, faite) {
  const voulu = [echange.voulu?.titre, echange.voulu?.declinaison].filter(Boolean).join(' · ');
  const renvoye = [echange.renvoye?.titre, echange.renvoye?.declinaison].filter(Boolean).join(' · ');
  const adresse = adresseTexte(echange.adresse);

  return `<article class="upd ech${faite ? ' ech-faite' : ''}" data-echange="${esc(echange.id)}">
    <div class="upd-head">
      <b>${esc(t('ech.for', { commande: echange.commande ?? '—' }))}</b>
      <span class="upd-when">${
        faite && echange.expedieLe
          ? esc(t('ech.sentOn', { date: new Date(echange.expedieLe).toLocaleDateString(locale) }))
          : esc(echange.client ?? '')
      }</span>
    </div>

    <div class="upd-swap">
      <span class="upd-before">${esc(renvoye)}</span>
      <span class="upd-arrow" aria-hidden="true">→</span>
      <span class="upd-after">${esc(voulu)}</span>
    </div>
    ${echange.voulu?.sku ? `<p class="upd-note">${esc(echange.voulu.sku)}</p>` : ''}

    ${
      faite
        ? ''
        : `<p class="upd-msg"><b>${esc(t('ech.address'))}</b></p>
           <pre class="ech-adresse">${esc(adresse)}</pre>
           ${adresse ? `<p class="ech-copier"><button class="btn btn-small" type="button" data-copier="${esc(adresse)}">${esc(t('ech.copy'))}</button></p>` : ''}`
    }

    <form class="ech-form">
      <input class="mono" data-champ="suivi" value="${esc(echange.suivi ?? '')}"
        placeholder="${esc(t('parcel.tracking'))}" aria-label="${esc(t('parcel.tracking'))}"
        autocomplete="off" spellcheck="false" />
      <input data-champ="transporteur" list="ws-carriers" value="${esc(echange.transporteur ?? '')}"
        placeholder="${esc(t('parcel.carrier'))}" aria-label="${esc(t('parcel.carrier'))}" />
      <button class="btn ${faite ? '' : 'btn-primary'}" type="submit">${esc(t(faite ? 'ech.correct' : 'ech.save'))}</button>
    </form>
  </article>`;
}

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


/*
 * Le numéro d'un échange.
 *
 * Rien ne part chez Shopify — un échange n'est pas une commande — donc aucune
 * confirmation à demander : le client n'a encore rien reçu de notre part. Le
 * numéro remonte au marchand, à qui son écran proposera le message à envoyer.
 */
async function envoyerEchange(formulaire) {
  const carte = formulaire.closest('[data-echange]');
  const caseId = carte.dataset.echange;
  const suivi = formulaire.querySelector('[data-champ="suivi"]').value.trim();
  const transporteur = formulaire.querySelector('[data-champ="transporteur"]').value.trim() || null;

  if (!suivi) return toast(t('ech.needTracking'), true);

  const bouton = formulaire.querySelector('[type="submit"]');
  const libelle = bouton.textContent;
  bouton.disabled = true;
  bouton.textContent = t('ech.saving');

  try {
    await api(`/api/workspace/${supplierId}/echanges`, {
      method: 'POST',
      body: { caseId, trackingNumber: suivi, carrier: transporteur },
    });
    toast(t('ech.saved'));
    await loadTickets();
  } catch (erreur) {
    toast(messageServeur(erreur, 'ech.err'), true);
  } finally {
    bouton.disabled = false;
    bouton.textContent = libelle;
  }
}

/** La pastille compte ce qui n'est pas encore parti : un client attend. */
async function rafraichirPastilleEchanges() {
  try {
    const data = await api(`/api/workspace/${supplierId}/echanges?compte=1`);
    setEchangeBadge(data.compte ?? 0);
  } catch {
    setEchangeBadge(0);
  }
}

function setEchangeBadge(nombre) {
  attentes.echanges = nombre;
  majPastilleTickets();
}

/* ------------------------------------------------------------ en masse -- */

/*
 * Les deux modes de traitement.
 *
 * Le guichet — une commande à la fois — reste le mode par défaut : c'est
 * celui du préparateur, téléphone en main. L'import sert le jour où le
 * transporteur rend un fichier de cinquante numéros. Basculer ne perd rien :
 * la liste et le collage gardent chacun leur état.
 */
function setMode(mode) {
  state.mode = mode === 'masse' ? 'masse' : 'manuel';
  const masse = state.mode === 'masse';

  document.querySelectorAll('#ws-modes [data-mode]').forEach((bouton) => {
    bouton.setAttribute('aria-selected', String(bouton.dataset.mode === state.mode));
  });

  // En masse, la progression, les filtres et la liste s'effacent : ils
  // décrivent la file du guichet, pas l'import.
  for (const id of ['ws-progress', 'ws-filter', 'ws-orders']) {
    const bloc = $(id);
    if (bloc) bloc.classList.toggle('hors-mode', masse);
  }
  $('ws-bulk').hidden = !masse;

  if (masse) {
    state.focus = null;
    document.body.classList.remove('ws-focus');
    $('bulk-texte').focus();
  } else {
    renderOrders();
  }
}

document.querySelectorAll('#ws-modes [data-mode]').forEach((bouton) =>
  bouton.addEventListener('click', () => setMode(bouton.dataset.mode)),
);

/* Les couleurs et les mots des statuts de ligne. `pret` est la seule qui
   sera écrite ; toutes les autres expliquent pourquoi une ligne ne l'est pas. */
const STATUTS_LOT = {
  pret: 'ok',
  abime_excel: 'bad',
  stock_retour: 'warn',
  deja_saisi: 'neutre',
  invalide: 'bad',
  introuvable: 'bad',
  doublon: 'warn',
  deja_utilise: 'bad',
  deja_expediee: 'neutre',
};

/*
 * Ce que la console d'administration a éteint pour cette boutique.
 *
 * Masqué ici, et REFUSÉ par le serveur : l'écran qui se tait n'est que la
 * moitié du travail. Sans le traitement en masse, le choix des modes n'a plus
 * qu'une option — il disparaît avec elle.
 */
function appliquerFonctionnalites() {
  const masse = state.fonctionnalites?.importEnMasse !== false;
  const ruptures = state.fonctionnalites?.rupturesAtelier !== false;

  $('ws-modes').hidden = !masse;
  if (!masse && state.mode === 'masse') setMode('manuel');

  // Les ruptures éteintes ne sont plus demandées : la liste des tickets et
  // l'accueil les omettent, et leur part de la pastille tombe à zéro.
  if (!ruptures) setRuptureBadge(0);
}

/** Un fichier choisi suit la même lecture qu'un fichier déposé. */
$('bulk-file')?.addEventListener('change', (event) => {
  const fichier = event.target.files?.[0];
  event.target.value = '';
  if (fichier) void lireFichier(fichier);
});

/** Le message sous la zone de collage : ce qui a été lu, ou pourquoi rien ne l'a été. */
function noteLot(texte, ton = '') {
  const note = $('bulk-note');
  note.hidden = !texte;
  note.textContent = texte ?? '';
  note.className = `bulk-note${ton ? ` bulk-note-${ton}` : ''}`;
}

/** Un fichier en base 64, par le lecteur du navigateur : pas de pile qui déborde sur 15 Mo. */
function enBase64(fichier) {
  return new Promise((resoudre, rejeter) => {
    const lecteur = new FileReader();
    lecteur.onload = () => resoudre(String(lecteur.result).split(',')[1] ?? '');
    lecteur.onerror = () => rejeter(lecteur.error);
    lecteur.readAsDataURL(fichier);
  });
}

/*
 * Lire un fichier déposé ou choisi, et le poser dans la zone de collage.
 *
 * Un CSV se lit ici même, c'est du texte. Un .xlsx est une archive : il part
 * au serveur, qui le lit avec la bibliothèque qui écrit déjà l'export, et
 * rend le même texte qu'un collage. Dans les deux cas le texte s'affiche —
 * l'atelier voit exactement ce qui a été lu — puis la vérification part
 * d'elle-même : on ne dépose pas un fichier pour s'arrêter en chemin.
 *
 * L'ancien format .xls est refusé avec la manière d'en sortir, plutôt que
 * lu de travers : aucune bibliothèque sûre ne le lit sans surprise.
 */
async function lireFichier(fichier) {
  const nom = fichier.name || 'fichier';
  const extension = nom.toLowerCase().split('.').pop();

  if (fichier.size > 15 * 1024 * 1024) return noteLot(t('bulk.tooBig'), 'bad');
  if (extension === 'xls') return noteLot(t('bulk.oldXls'), 'bad');

  state.lot = null;
  $('bulk-apercu').innerHTML = '';

  if (['csv', 'tsv', 'txt'].includes(extension)) {
    $('bulk-texte').value = await fichier.text();
    noteLot(t('bulk.readText', { nom }), 'ok');
    return verifierLot();
  }

  if (extension !== 'xlsx') return noteLot(t('bulk.badFormat'), 'bad');

  noteLot(t('bulk.reading', { nom }));
  let data;
  try {
    data = await api(`/api/workspace/${supplierId}/parcels/lot/fichier`, {
      method: 'POST',
      body: { fichier: await enBase64(fichier), nom },
    });
  } catch (error) {
    // Le serveur ne parle pas la langue de l'atelier : il rend un code, que
    // `messageServeur` traduit.
    return noteLot(messageServeur(error, 'bulk.refus'), 'bad');
  }

  if (!data.lues) {
    $('bulk-texte').value = '';
    return noteLot(t('bulk.noTracking', { nom, ignorees: data.ignorees ?? 0 }), 'warn');
  }

  $('bulk-texte').value = data.texte;
  noteLot(t('bulk.readResult', { nom, lues: data.lues, ignorees: data.ignorees ?? 0 }), 'ok');
  return verifierLot();
}

/*
 * Le glisser-déposer, sur toute la liste des commandes en mode « En masse ».
 *
 * Toute la page, et pas seulement la zone : un fichier lâché à côté serait
 * OUVERT par le navigateur à la place de l'atelier, et le travail en cours
 * serait perdu.
 *
 * Une feuille glissée depuis « Une par une » fait basculer la page en
 * « En masse » d'elle-même. Pendant le glisser, le navigateur ne laisse lire
 * que le TYPE du fichier, pas son contenu : on ne bascule que pour un type de
 * tableur (.xlsx, .csv, texte). Une photo n'est jamais prise — au guichet,
 * elle va au champ photo comme avant — et rien ne bascule hors de la liste
 * des commandes, ni pendant la saisie d'une commande au guichet.
 *
 * Le compteur de profondeur évite le clignotement du voile : chaque élément
 * survolé à l'intérieur de la page émet sa propre paire entrée/sortie.
 */
let profondeurDepot = 0;
const porteDesFichiers = (event) => [...(event.dataTransfer?.types ?? [])].includes('Files');
const TYPES_TABLEUR = /spreadsheet|excel|csv|tab-separated|text\/plain/i;
const porteUnTableur = (event) =>
  [...(event.dataTransfer?.items ?? [])].some((item) => item.kind === 'file' && TYPES_TABLEUR.test(item.type));
const glisserActif = (event) => state.mode === 'masse' && state.view === 'orders' && porteDesFichiers(event);

/** Le glisser qui commence : pris en « En masse », ou pris en y basculant pour une feuille. */
function prendLeGlisser(event) {
  if (state.fonctionnalites?.importEnMasse === false) return false;
  if (!porteDesFichiers(event) || state.view !== 'orders') return false;
  if (state.mode === 'masse') return true;
  if (state.focus || !porteUnTableur(event)) return false;
  setMode('masse');
  return true;
}

document.addEventListener('dragenter', (event) => {
  if (!prendLeGlisser(event)) return;
  event.preventDefault();
  profondeurDepot += 1;
  $('ws-bulk').classList.add('bulk-depot');
});

document.addEventListener('dragover', (event) => {
  if (!glisserActif(event)) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = 'copy';
});

document.addEventListener('dragleave', (event) => {
  if (!glisserActif(event)) return;
  profondeurDepot = Math.max(0, profondeurDepot - 1);
  if (profondeurDepot === 0) $('ws-bulk').classList.remove('bulk-depot');
});

document.addEventListener('drop', (event) => {
  if (!glisserActif(event)) return;
  event.preventDefault();
  profondeurDepot = 0;
  $('ws-bulk').classList.remove('bulk-depot');
  const fichier = event.dataTransfer.files?.[0];
  if (fichier) void lireFichier(fichier);
});

$('bulk-check')?.addEventListener('click', () => void verifierLot());

/* Modifier le collage invalide l'aperçu : on ne doit jamais pouvoir
   confirmer un aperçu qui ne correspond plus au texte affiché. */
$('bulk-texte')?.addEventListener('input', () => {
  noteLot('');
  if (state.lot) {
    state.lot = null;
    $('bulk-apercu').innerHTML = '';
  }
});

async function verifierLot() {
  const texte = $('bulk-texte').value;
  const zone = $('bulk-apercu');

  if (!texte.trim()) {
    zone.innerHTML = `<p class="bulk-msg bulk-msg-bad">${esc(t('bulk.empty'))}</p>`;
    return;
  }

  $('bulk-check').disabled = true;
  zone.innerHTML = `<p class="bulk-msg">${esc(t('bulk.checking'))}</p>`;

  try {
    const plan = await api(`/api/workspace/${supplierId}/parcels/lot`, {
      method: 'POST',
      body: { texte, apercu: true },
    });
    state.lot = { texte, plan };
    renderApercu();
  } catch (error) {
    state.lot = null;
    zone.innerHTML = `<p class="bulk-msg bulk-msg-bad">${esc(messageServeur(error, 'bulk.err'))}</p>`;
  } finally {
    $('bulk-check').disabled = false;
  }
}

/*
 * L'aperçu : ce qui arrivera, avant que ça arrive.
 *
 * La phrase au-dessus du bouton n'est pas une précaution de style. Chaque
 * commande complétée par l'import passe en « expédiée » sur Shopify, qui
 * envoie au client un mail avec son suivi — irréversible, et multiplié par
 * le nombre de lignes. Le bouton le répète dans son libellé : on ne clique
 * pas « Enregistrer », on clique « Enregistrer et expédier 12 commandes ».
 */
function renderApercu() {
  const { plan } = state.lot;
  const aCorriger = plan.lignes.filter((ligne) => STATUTS_LOT[ligne.statut] === 'bad').length;

  $('bulk-apercu').innerHTML = `
    <div class="bulk-bilan">
      <!-- Étiquette puis nombre : « Prêtes 10 » se lit dans toutes les
           langues sans accorder un pluriel que le traducteur ne gère pas. -->
      <span>${esc(t('bulk.lines'))} <b>${plan.lignes.length}</b></span>
      <span class="bulk-ok">${esc(t('bulk.ready'))} <b>${plan.prets}</b></span>
      ${aCorriger ? `<span class="bulk-bad">${esc(t('bulk.toFix'))} <b>${aCorriger}</b></span>` : ''}
    </div>

    <div class="bulk-table-wrap">
      <table class="bulk-table">
        <thead><tr>
          <th>${esc(t('bulk.col.line'))}</th>
          <th>${esc(t('bulk.col.order'))}</th>
          <th>${esc(t('bulk.col.customer'))}</th>
          <th>${esc(t('bulk.col.tracking'))}</th>
          <th>${esc(t('bulk.col.carrier'))}</th>
          <th>${esc(t('bulk.col.status'))}</th>
        </tr></thead>
        <tbody>${plan.lignes
          .map(
            (ligne) => `<tr class="bulk-l-${esc(STATUTS_LOT[ligne.statut] ?? 'neutre')}">
              <td class="bulk-rang">${ligne.rang}</td>
              <td><b>${esc(ligne.nom ?? ligne.commande ?? '—')}</b></td>
              <td>${esc(ligne.client ?? '—')}</td>
              <td class="bulk-suivi">${esc(ligne.suivi || '—')}</td>
              <td>${esc(ligne.transporteur ?? '—')}</td>
              <td><span class="bulk-statut">${esc(t(`bulk.status.${ligne.statut}`))}${
                ligne.statut === 'pret' && ligne.total > 1
                  ? ` <small>${esc(t('bulk.parcelOf', { n: ligne.index, total: ligne.total }))}</small>`
                  : ''
              }</span></td>
            </tr>`,
          )
          .join('')}</tbody>
      </table>
    </div>

    ${
      plan.lignes.some((ligne) => ligne.statut === 'abime_excel')
        ? `<p class="bulk-msg bulk-msg-warn">${esc(t('bulk.abimeHelp'))}</p>`
        : ''
    }

    ${
      plan.prets > 0
        ? `<div class="bulk-confirm">
            <p class="bulk-consequence">${esc(
              state.testMode
                ? t('bulk.consequenceTest', { n: plan.prets })
                : plan.expediees > 0
                  ? t('bulk.consequence', { n: plan.prets, orders: plan.expediees })
                  : t('bulk.consequencePartial', { n: plan.prets }),
            )}</p>
            <div class="bulk-acts">
              <button class="btn" type="button" id="bulk-edit">${esc(t('bulk.edit'))}</button>
              <button class="btn btn-primary" type="button" id="bulk-save">${esc(
                state.testMode
                  ? t('bulk.saveTest', { n: plan.prets })
                  : plan.expediees > 0
                  ? t('bulk.saveShip', { n: plan.prets, orders: plan.expediees })
                  : t('bulk.save', { n: plan.prets }),
              )}</button>
            </div>
          </div>`
        : `<p class="bulk-msg bulk-msg-bad">${esc(t('bulk.nothingReady'))}</p>`
    }`;

  $('bulk-edit')?.addEventListener('click', () => $('bulk-texte').focus());
  $('bulk-save')?.addEventListener('click', () => void enregistrerLot());
}

async function enregistrerLot() {
  if (!state.lot) return;
  const bouton = $('bulk-save');
  bouton.disabled = true;
  bouton.textContent = t('bulk.saving');

  try {
    // Le TEXTE repart, pas l'aperçu : le serveur refait le calcul et ne
    // croit jamais ce que le navigateur lui renvoie.
    const bilan = await api(`/api/workspace/${supplierId}/parcels/lot`, {
      method: 'POST',
      body: { texte: state.lot.texte, apercu: false },
    });

    const echecs = (bilan.resultats ?? []).filter((resultat) => !resultat.ok);
    const nonExpediees = (bilan.resultats ?? []).filter(
      (resultat) => resultat.ok && resultat.raison,
    );

    $('bulk-apercu').innerHTML = `
      <div class="bulk-fin">
        <p class="bulk-fin-titre">✓ ${esc(
          state.testMode
            ? t('bulk.doneTest', { n: bilan.enregistres })
            : t('bulk.done', { n: bilan.enregistres, orders: bilan.expedieesReelles }),
        )}</p>
        ${
          echecs.length
            ? `<p class="bulk-msg bulk-msg-bad">${esc(
                t('bulk.failed', { n: echecs.length, lines: echecs.map((e) => e.rang).join(', ') }),
              )}</p>`
            : ''
        }
        ${
          nonExpediees.length
            ? `<p class="bulk-msg bulk-msg-warn">${esc(
                t('bulk.notShipped', { n: nonExpediees.length }),
              )} ${esc(nonExpediees[0].raison)}</p>`
            : ''
        }
        <div class="bulk-acts">
          <button class="btn" type="button" id="bulk-again">${esc(t('bulk.again'))}</button>
          <button class="btn btn-primary" type="button" id="bulk-list">${esc(t('bulk.toList'))}</button>
        </div>
      </div>`;

    state.lot = null;
    $('bulk-texte').value = '';
    noteLot('');
    $('bulk-again')?.addEventListener('click', () => {
      $('bulk-apercu').innerHTML = '';
      $('bulk-texte').focus();
    });
    $('bulk-list')?.addEventListener('click', () => setMode('manuel'));

    // La liste du guichet reflète tout de suite les colis importés.
    void load();
  } catch (error) {
    bouton.disabled = false;
    bouton.textContent = t('bulk.retry');
    toast(messageServeur(error, 'bulk.err'), true);
  }
}


/* ---------------------------------------------------------- guichet -- */

/**
 * Le statut d'expédition Shopify, dans la langue de l'atelier.
 *
 * Il s'affichait tel que l'API le renvoie : « UNFULFILLED », en anglais et en
 * capitales, y compris pour un atelier qui travaille en chinois. Un statut
 * inconnu retombe sur sa valeur brute plutôt que sur le nom de la clé de
 * traduction : mieux vaut « SCHEDULED » que « order.status.SCHEDULED ».
 */
function statutCommande(brut) {
  if (!brut) return '—';
  const cle = `order.status.${brut}`;
  const traduit = t(cle);
  return traduit === cle ? brut : traduit;
}

/*
 * Entrée enregistre le colis.
 *
 * Une douchette de code-barres tape le numéro puis Entrée : avec ce geste
 * branché, scanner l'étiquette suffit à enregistrer le colis, et le guichet
 * passe tout seul à la commande suivante. Sans lui, Entrée ne faisait rien
 * — et le préparateur devait lâcher le carton pour attraper la souris.
 */
$('ws-orders').addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' || event.isComposing) return;
  const champ = event.target.closest?.('[data-field="tracking"], [data-field="carrier"]');
  if (!champ) return;

  const bouton = champ.closest('.pk')?.querySelector('[data-save]');
  if (!bouton || bouton.disabled) return;

  event.preventDefault();
  bouton.click();
});


/* ==========================================================================
   TICKETS — une seule liste

   Tout ce qui passe entre l'atelier et le marchand, dans une liste : les
   demandes de changement, les ruptures, les échanges à expédier, et ce que
   l'atelier a lui-même signalé. Elle s'ouvre sur « À répondre », les plus
   anciennes d'abord : c'est la question du matin.
   ========================================================================== */

/** Une rupture vue depuis l'atelier : à lui de répondre, au marchand, ou close. */
function statutRupture(dossier, estDemande) {
  if (dossier.phase === 'classe') return 'CLOS';
  const propositions = dossier.substitutions ?? [];
  // Un remplacement proposé sans réponse : c'est à l'atelier.
  if (propositions.some((proposition) => !proposition.reponduLe)) return 'A_REPONDRE';
  // Tout est répondu : la suite appartient au marchand.
  if (propositions.length) return 'ATTENTE';
  if (estDemande) return dossier.phase === 'cree' ? 'A_REPONDRE' : 'ATTENTE';
  return dossier.phase === 'traite' ? 'CLOS' : 'ATTENTE';
}

state.tk = { statut: 'A_REPONDRE', type: '', items: [], erreurs: [] };

/** Âge lisible : « aujourd'hui », « 3 j ». Rouge au-delà de deux jours. */
function age(date) {
  const jours = Math.floor((Date.now() - new Date(date).getTime()) / 86_400_000);
  return { texte: jours <= 0 ? t('tk.today') : t('tk.days', { n: jours }), vieux: jours >= 2 };
}

async function chargerTickets() {
  // Les réglages de la boutique arrivent avec la liste des commandes.
  await state.chargementCommandes?.catch?.(() => {});
  const avecRuptures = state.fonctionnalites?.rupturesAtelier !== false;

  const [updates, ruptures, signalements, echanges] = await Promise.all([
    api(`/api/workspace/${supplierId}/updates`).catch(() => null),
    avecRuptures ? api(`/api/workspace/${supplierId}/ruptures`).catch(() => null) : { demandes: [] },
    api(`/api/workspace/${supplierId}/signalements`).catch(() => null),
    api(`/api/workspace/${supplierId}/echanges`).catch(() => null),
  ]);

  const items = [];
  for (const update of updates?.updates ?? []) {
    items.push({
      type: `UPD:${update.kind}`,
      libelle: kindLabel(update.kind),
      statut: update.status === 'PENDING' ? 'A_REPONDRE' : 'CLOS',
      date: update.createdAt,
      html: carteUpdate(update),
    });
  }
  for (const demande of ruptures?.demandes ?? []) {
    items.push({
      type: 'RUPTURE',
      libelle: t('tk.type.rupture'),
      statut: statutRupture(demande, true),
      date: demande.envoyeLe,
      html: carteRupture(demande, demande.phase ?? 'cree', demande.envoyeLe, true),
    });
  }
  for (const signalement of signalements?.signalements ?? []) {
    // Ruptures éteintes : leurs signalements aussi.
    if (!avecRuptures && signalement.motif === 'STOCK') continue;
    items.push({
      type: 'SIGNAL',
      libelle: `${t('tk.type.signal')} · ${t(`issue.kind.${signalement.motif}`)}`,
      statut: statutRupture(signalement, false),
      date: signalement.signaleLe,
      html: carteRupture(signalement, signalement.phase ?? 'cree', signalement.signaleLe, false),
    });
  }
  for (const [liste, faite] of [
    [echanges?.aEnvoyer ?? [], false],
    [echanges?.envoyes ?? [], true],
  ]) {
    for (const echange of liste) {
      items.push({
        type: 'ECHANGE',
        libelle: t('tk.type.echange'),
        statut: faite ? 'CLOS' : 'A_REPONDRE',
        date: echange.expedieLe ?? echange.depuis,
        html: echangeMarkup(echange, faite),
      });
    }
  }

  /* Chaque source qui n'a pas répondu éteint sa part de la pastille : un
     chiffre qu'on n'a pas pu relire est un chiffre inventé. */
  setBadge(updates ? (updates.pending ?? 0) : 0);
  if (!ruptures) setRuptureBadge(0);
  else
    setRuptureBadge(
      items.filter((item) => ['RUPTURE', 'SIGNAL'].includes(item.type) && item.statut === 'A_REPONDRE').length,
    );
  setEchangeBadge(echanges ? (echanges.aEnvoyer ?? []).length : 0);

  state.tk.items = items;
  state.tk.erreurs = [
    [updates, 'tk.src.updates'],
    [ruptures, 'tk.src.ruptures'],
    [signalements, 'tk.src.signal'],
    [echanges, 'tk.src.echanges'],
  ]
    .filter(([donnees]) => !donnees)
    .map(([, cle]) => t(cle));
  $('ws-ech-adresses').hidden = !echanges?.adressesIndisponibles;
  return items;
}

async function loadTickets() {
  $('tk-rows').innerHTML = `<p class="empty">${esc(t('tk.loading'))}</p>`;
  await chargerTickets();
  renderTickets();
}

function renderTickets() {
  const { statut, type, items, erreurs } = state.tk;

  document.querySelectorAll('#tk-statuts [data-tstatut]').forEach((bouton) =>
    bouton.setAttribute('aria-pressed', String(bouton.dataset.tstatut === statut)),
  );
  const enAttente = items.filter((item) => item.statut === 'ATTENTE').length;
  $('tk-n-att').hidden = enAttente === 0;
  $('tk-n-att').textContent = String(enAttente);

  // Les types proposés sont ceux qui existent : un bouton qui ne trie rien
  // n'apprend qu'à ne plus cliquer.
  const types = new Map(items.map((item) => [item.type, item.type === 'SIGNAL' ? t('tk.type.signal') : item.libelle]));
  $('tk-types').innerHTML = [
    `<button type="button" data-ttype="" aria-pressed="${!type}">${esc(t('tk.allTypes'))}</button>`,
    ...[...types].map(
      ([cle, libelle]) =>
        `<button type="button" data-ttype="${esc(cle)}" aria-pressed="${type === cle}">${esc(libelle)}</button>`,
    ),
  ].join('');

  const visibles = items
    .filter((item) => (!statut || item.statut === statut) && (!type || item.type === type))
    // Ce qui attend une réponse : le plus ancien d'abord. Le reste : le plus récent.
    .sort((a, b) =>
      statut === 'A_REPONDRE'
        ? new Date(a.date).getTime() - new Date(b.date).getTime()
        : new Date(b.date).getTime() - new Date(a.date).getTime(),
    );

  const alerte = erreurs.length
    ? `<p class="ws-note">${esc(t('tk.partial', { quoi: erreurs.join(', ') }))}</p>`
    : '';

  $('tk-rows').innerHTML =
    alerte +
    (visibles
      .map((item) => {
        const { texte, vieux } = age(item.date);
        return `<div class="tk-item">
          <div class="tk-meta">
            ${
              // Une demande de changement porte déjà son type en titre de carte.
              item.type.startsWith('UPD:') ? '' : `<span class="tk-type">${esc(item.libelle)}</span>`
            }
            <span class="tk-age${vieux && item.statut === 'A_REPONDRE' ? ' tk-vieux' : ''}">${esc(texte)}</span>
          </div>
          ${item.html}
        </div>`;
      })
      .join('') || `<p class="empty">${esc(t(`tk.empty.${statut || 'ALL'}`))}</p>`);

  cablerTickets();
}

/** Les boutons des cartes : mêmes gestes qu'avant, dans la liste unique. */
function cablerTickets() {
  const racine = $('tk-rows');

  racine.querySelectorAll('[data-accept]').forEach((button) =>
    button.addEventListener('click', () => respond(button.dataset.accept, 'ACKNOWLEDGED')),
  );
  racine.querySelectorAll('[data-refuse]').forEach((button) =>
    button.addEventListener('click', () => {
      // Un refus sans motif oblige le marchand à redemander : on exige le mot
      // qui manque, ici et pas dans un second aller-retour.
      const note = prompt(t('updates.why'));
      if (note === null) return;
      if (!note.trim()) return toast(t('updates.needWhy'), true);
      respond(button.dataset.refuse, 'REFUSED', note.trim());
    }),
  );

  cablerSubstitutions();

  for (const formulaire of racine.querySelectorAll('.ech-form')) {
    formulaire.addEventListener('submit', (event) => {
      event.preventDefault();
      void envoyerEchange(formulaire);
    });
  }
  for (const bouton of racine.querySelectorAll('[data-copier]')) {
    bouton.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(bouton.dataset.copier);
        toast(t('ech.copied'));
      } catch {
        toast(t('ech.copyFail'), true);
      }
    });
  }
}

$('tk-statuts')?.addEventListener('click', (event) => {
  const bouton = event.target.closest('[data-tstatut]');
  if (!bouton) return;
  state.tk.statut = bouton.dataset.tstatut;
  renderTickets();
});

$('tk-types')?.addEventListener('click', (event) => {
  const bouton = event.target.closest('[data-ttype]');
  if (!bouton) return;
  state.tk.type = bouton.dataset.ttype;
  renderTickets();
});

/** Ouvrir la liste sur un filtre : depuis l'accueil, un chiffre mène à ses lignes. */
function ouvrirTickets(statut, type = '') {
  state.tk.statut = statut;
  state.tk.type = type;
  setView('tickets');
}

/* ==========================================================================
   AUJOURD'HUI — l'écran d'arrivée

   Ce que le marchand attend de l'atelier, en chiffres qui mènent aux lignes.
   Il arrivait sur « Commandes », ou sur un onglet de tickets souvent vide
   pendant qu'une demande l'attendait dans l'onglet d'à côté.
   ========================================================================== */

async function loadHome() {
  $('home-tuiles').innerHTML = `<p class="empty">${esc(t('tk.loading'))}</p>`;
  await state.chargementCommandes?.catch?.(() => {});
  const [items, lots] = await Promise.all([
    chargerTickets(),
    api(`/api/workspace/${supplierId}/lots`)
      .then((data) => data.lots ?? [])
      .catch(() => []),
  ]);

  const compte = (filtre) => items.filter(filtre).length;
  const aRepondre = compte((item) => item.statut === 'A_REPONDRE');

  /*
   * « À préparer » se lit dans ses lots : c'est la liste exacte de ce qu'on
   * lui a envoyé, et le même chiffre que l'onglet « Lots reçus ». Les
   * commandes de la période ne servent qu'à l'atelier qui ne reçoit pas de
   * fichier — elles comptaient aussi ce qu'il avait déjà lancé.
   */
  const commandesDesLots = lots.flatMap((lot) => lot.commandes);
  const parLots = commandesDesLots.length > 0;
  if (parLots) state.lots = lots;
  const aPreparer = parLots
    ? commandesDesLots.filter((commande) => commande.statut === 'A_PREPARER').length
    : (state.orders ?? []).filter((order) => !orderIsDone(order)).length;
  const tuiles = [
    { n: aRepondre, cle: 'home.toAnswer', chaud: true, aller: () => ouvrirTickets('A_REPONDRE') },
    {
      n: aPreparer,
      cle: 'home.toPrepare',
      // Une commande en retard, et la tuile le dit avant qu'on l'ouvre.
      chaud: commandesDesLots.some((commande) => commande.enRetard),
      aller: () => {
        if (parLots) state.sous = { ...(state.sous ?? {}), orders: 'lots' };
        setView('orders');
      },
    },
    {
      n: compte((item) => item.type === 'RUPTURE' && item.statut !== 'CLOS'),
      cle: 'home.ruptures',
      chaud: false,
      aller: () => ouvrirTickets('', 'RUPTURE'),
    },
    {
      n: compte((item) => item.type === 'ECHANGE' && item.statut === 'A_REPONDRE'),
      cle: 'home.exchanges',
      chaud: true,
      aller: () => ouvrirTickets('A_REPONDRE', 'ECHANGE'),
    },
    { n: compte((item) => item.statut === 'ATTENTE'), cle: 'home.waiting', chaud: false, aller: () => ouvrirTickets('ATTENTE') },
  ];

  $('home-tuiles').innerHTML = tuiles
    .map(
      (tuile, rang) => `<button type="button" class="home-tuile${tuile.chaud && tuile.n > 0 ? ' home-chaud' : ''}" data-tuile="${rang}">
        <b>${tuile.n}</b><span>${esc(t(tuile.cle))}</span>
      </button>`,
    )
    .join('');
  $('home-tuiles')
    .querySelectorAll('[data-tuile]')
    .forEach((bouton) => bouton.addEventListener('click', () => tuiles[Number(bouton.dataset.tuile)].aller()));

  const anciennes = items
    .filter((item) => item.statut === 'A_REPONDRE')
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
    .slice(0, 5);

  $('home-liste').innerHTML = anciennes.length
    ? anciennes
        .map((item) => {
          const { texte, vieux } = age(item.date);
          return `<button type="button" class="home-ligne" data-home-type="${esc(item.type)}">
            <span class="tk-type">${esc(item.libelle)}</span>
            <span class="home-quoi">${esc(resumeDe(item.html))}</span>
            <span class="tk-age${vieux ? ' tk-vieux' : ''}">${esc(texte)}</span>
          </button>`;
        })
        .join('')
    : `<p class="empty home-rien">${esc(t('home.allClear'))}</p>`;
  $('home-liste')
    .querySelectorAll('[data-home-type]')
    .forEach((ligne) => ligne.addEventListener('click', () => ouvrirTickets('A_REPONDRE', ligne.dataset.homeType)));
}

/**
 * La commande d'une carte, pour une ligne de l'accueil. Le type est déjà
 * écrit à côté : le répéter (« Article manquant · Article manquant ») ne dit
 * pas de quelle commande il s'agit.
 */
function resumeDe(html) {
  const boite = document.createElement('div');
  boite.innerHTML = html;
  const commande = boite.querySelector('.upd-head .tag-order')?.textContent?.trim();
  if (commande) return t('rup.order').replace('{name}', commande);
  return boite.querySelector('.upd-head b')?.textContent?.trim() ?? '';
}

/* ==========================================================================
   LOTS REÇUS — le fichier du jour, suivi commande par commande

   Le marchand envoie chaque matin ses commandes en fichier. L'atelier les
   retrouve ici, avec deux états : à préparer, puis expédiée — qui vient
   d'elle-même dès qu'un colis est saisi, comme d'habitude.
   ========================================================================== */

async function loadLots() {
  const rows = $('lots-rows');
  rows.innerHTML = `<p class="empty">${esc(t('tk.loading'))}</p>`;
  try {
    const data = await api(`/api/workspace/${supplierId}/lots`);
    state.lots = data.lots ?? [];
  } catch {
    rows.innerHTML = `<p class="empty">${esc(t('lots.error'))}</p>`;
    return;
  }
  renderLots();
}

function renderLots() {
  const rows = $('lots-rows');
  const lots = state.lots ?? [];
  if (lots.length === 0) {
    rows.innerHTML = emptyState(t('lots.empty'));
    return;
  }

  rows.innerHTML = lots
    .map((lot, rang) => {
      const total = lot.commandes.length;
      const jour = new Date(lot.envoyeLe).toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' });
      // Le lot le plus récent s'ouvre seul : c'est celui du jour.
      return `<details class="lot"${rang === 0 ? ' open' : ''}>
        <summary class="lot-head">
          <b>${esc(t('lots.of', { date: jour }))}</b>
          <span class="lot-compte">${esc(
            t('lots.summary', { a: lot.compte.A_PREPARER, e: lot.compte.EXPEDIEE }),
          )}</span>
          ${progressBar(lot.compte.EXPEDIEE, total, t('lots.shipped', { n: lot.compte.EXPEDIEE, total }))}
        </summary>
        ${lot.commandes.map(ligneDuLot).join('')}
      </details>`;
    })
    .join('');

  rows.querySelectorAll('[data-lot-colis]').forEach((bouton) =>
    bouton.addEventListener('click', () => saisirColisDuLot(bouton.dataset.lotColis)),
  );
}

/** Une commande du lot : ce qui part, où elle en est, et le geste suivant. */
function ligneDuLot(commande) {
  return `<div class="lot-ligne lot-s-${esc(commande.statut)}">
    <div class="lot-quoi">
      <b>${esc(commande.orderName)}</b>
      <small>${esc(commande.articles ?? '')}</small>
      ${
        commande.suivis.length
          ? `<small class="mono">${esc(commande.suivis.join(' · '))}</small>`
          : ''
      }
    </div>
    <span class="pill lot-pill">${esc(t(`lots.s.${commande.statut}`))}</span>
    ${commande.enRetard ? `<span class="pill lot-retard">${esc(t('lots.late', { n: commande.joursDepuis }))}</span>` : ''}
    <div class="lot-gestes">
      ${
        commande.statut === 'EXPEDIEE'
          ? ''
          : `<button class="btn btn-small btn-primary" type="button" data-lot-colis="${esc(commande.orderName)}">${esc(
              t('lots.parcel'),
            )}</button>`
      }
    </div>
  </div>`;
}

/*
 * Saisir le colis d'une commande du lot.
 *
 * Pas de second formulaire de colis : la commande s'ouvre dans « À préparer »,
 * retrouvée par son numéro, avec la saisie habituelle — photo, transporteur,
 * plusieurs colis. Le statut passe à « expédiée » de lui-même.
 */
function saisirColisDuLot(numero) {
  state.sous = { ...(state.sous ?? {}), orders: 'orders' };
  setView('orders');
  $('ws-cmd-q').value = numero;
  void chercherCommande(numero);
}

// Tout est déclaré : l'atelier arrive sur « Aujourd'hui ».
pret = true;
setView(state.view);
