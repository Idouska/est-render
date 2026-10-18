/**
 * Espace de travail du fournisseur — lien permanent, sans compte.
 *
 * Le geste du matin : ouvrir le lien, voir les commandes de la veille, saisir
 * un numéro de suivi et photographier l'étiquette pour chaque colis, signaler
 * ce qui coince. L'export Excel donne la même liste hors ligne.
 */

import { LANGS, LOCALES, pickLang, saveLang, translator } from './workspace.i18n.js';
import { verifierAdresse, verifierTelephone } from './workspace.verif.js';

const $ = (id) => document.getElementById(id);

/*
 * Des chevrons, une croix et une coche dessinés, jamais des caractères : une
 * flèche tapée au clavier n'a ni l'épaisseur ni l'alignement d'une icône, et
 * un bouton se lit à son libellé.
 */
const trait = (d) =>
  `<svg class="ws-ico" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"
    stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}" /></svg>`;
const ICO_PREC = trait('M10 3.5 5.5 8l4.5 4.5');
const ICO_SUIV = trait('M6 3.5 10.5 8 6 12.5');
const ICO_CROIX = trait('M4.5 4.5l7 7M11.5 4.5l-7 7');
const ICO_COCHE = trait('M3.5 8.5l3 3 6-7');

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
  if (!value) return;
  localStorage.setItem(CARRIER_KEY, value);
  try {
    localStorage.setItem(
      CARRIERS_KEY,
      JSON.stringify([value, ...recentCarriers().filter((nom) => nom !== value)].slice(0, 4)),
    );
  } catch {
    // Stockage plein ou refusé : la liste repart du dernier transporteur.
  }
}

/*
 * Les transporteurs de cet atelier, le dernier en tête : quatre au plus,
 * proposés en un clic sous le champ. Ce sont les siens, pas une liste
 * devinée — un atelier n'en utilise que deux ou trois.
 */
const CARRIERS_KEY = `ws.carriers.${supplierId}`;
function recentCarriers() {
  let liste = [];
  try {
    const lue = JSON.parse(localStorage.getItem(CARRIERS_KEY) ?? '[]');
    if (Array.isArray(lue)) liste = lue.filter((nom) => typeof nom === 'string' && nom);
  } catch {
    liste = [];
  }
  return [...new Set([lastCarrier(), ...liste].filter(Boolean))].slice(0, 4);
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
  // L'infobulle et le nom lu d'un bouton sans texte, ou au texte abrégé.
  for (const node of document.querySelectorAll('[data-ttl]')) {
    node.title = t(node.dataset.ttl);
    node.setAttribute('aria-label', node.title);
  }
  // Une infobulle qui complète un texte visible, sans le remplacer.
  for (const node of document.querySelectorAll('[data-tip]')) {
    node.title = t(node.dataset.tip);
  }
  majPeriode();

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
    ${carrierChips(saved?.carrier ?? lastCarrier())}
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

/** Les transporteurs récents, en un clic : le champ reste pour les autres. */
function carrierChips(choisi) {
  const recents = recentCarriers();
  if (recents.length === 0) return '';
  return `<div class="pk-carriers" role="group" aria-label="${esc(t('parcel.recentCarriers'))}">${recents
    .map(
      (nom) =>
        `<button type="button" class="pk-carrier" data-carrier="${esc(nom)}" aria-pressed="${String(nom === choisi)}">${esc(nom)}</button>`,
    )
    .join('')}</div>`;
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

/*
 * Sur un grand écran, la file et la commande choisie tiennent côte à côte,
 * comme dans Mail : on voit où l'on en est sans quitter la commande qu'on
 * tient. En dessous, le guichet reste plein écran, une commande à la fois.
 */
const enColonnes = window.matchMedia('(min-width: 1180px)');
enColonnes.addEventListener('change', () => {
  if (state.view === 'orders' && state.mode !== 'masse') renderOrders();
  if (state.view === 'tickets') renderTickets();
  if (state.view === 'catalog' && state.catalog) renderCatalog();
});

/** Le chiffre de la colonne : ce qu'il reste à préparer, comme l'accueil. */
function majCompteCommandes(n) {
  const pastille = $('ws-orders-count');
  if (!pastille) return;
  pastille.hidden = !n;
  pastille.textContent = String(n);
}

/*
 * Les outils de la file — recherche, interrupteur, tri — vivent en tête de la
 * colonne de la file sur grand écran, comme dans Mail. Le rendu remplace
 * `#ws-orders` en entier : ils en sont retirés avant, reposés après, et le
 * champ de recherche garde le curseur si on était en train de taper.
 */
function renderOrders() {
  const outils = $('cmd-outils');
  const champ = $('ws-cmd-q');
  const tapait = document.activeElement === champ;
  const curseur = tapait ? champ.selectionStart : null;

  $('ws-orders').before(outils);
  dessinerCommandes();
  $('ws-orders').querySelector('.ws-file')?.prepend(outils);

  if (tapait && document.activeElement !== champ) {
    champ.focus();
    champ.setSelectionRange(curseur, curseur);
  }
}

function dessinerCommandes() {
  const finished = state.orders.filter(orderIsDone).length;
  const left = state.orders.length - finished;

  $('ws-compte').textContent = t(state.filter === 'all' ? 'filter.countAll' : 'filter.countLeft', {
    n: state.filter === 'all' ? state.orders.length : left,
  });
  $('ws-masquer')?.setAttribute('aria-checked', String(state.filter !== 'all'));
  // Le même chiffre sur l'onglet : il se voit depuis les deux autres.
  $('ws-sous-n').textContent = left ? String(left) : '';
  $('ws-sort')?.setAttribute('aria-pressed', String(state.sort === 'model'));
  // Sans fichier du jour, la colonne compte les commandes de la période ;
  // avec, c'est l'accueil qui pose le chiffre de ses lots.
  if (!state.lots?.length) majCompteCommandes(left);

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
  const colonnes = enColonnes.matches;

  // Le guichet ne survit pas à un rafraîchissement qui a retiré sa commande
  // de la période : on retombe sur la liste plutôt que sur un écran vide.
  if (state.focus && !state.orders.some((order) => order.id === state.focus)) {
    state.focus = null;
  }

  // En colonnes, une commande est toujours ouverte : la première qui reste.
  if (colonnes && !state.focus && shown.length) {
    state.focus = (shown.find((order) => !orderIsDone(order)) ?? shown[0]).id;
  }

  // Plein écran veut dire plein écran : au guichet, la période, les chips et
  // la progression du jour disparaissent — on y revient par « Liste ». En
  // colonnes, tout reste : la file est là, à gauche.
  document.body.classList.toggle('ws-focus', Boolean(state.focus) && !colonnes);
  document.body.classList.toggle('ws-colonnes', colonnes);

  if (state.focus && !colonnes) {
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
  const liste = shown
    .map((order) => {
      const address = order.shippingAddress ?? {};
      const item = order.lineItems?.[0];
      const done = orderIsDone(order);
      const total = parcelTotal(order);
      const phoneShort = (address.phone ?? '').replace(/\D/g, '').length < 9;
      const choisie = colonnes && order.id === state.focus;

      return `<button type="button" class="rowo${done ? ' rowo-done' : ''}${choisie ? ' rowo-on' : ''}" data-open="${esc(
        order.id,
      )}"${choisie ? ' aria-current="true"' : ''}>
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
          }${phoneShort ? ` <b class="rowo-warn">${esc(t('orders.phoneMissing'))}</b>` : ''}</small>
          ${consigneDeCommandeMarkup(order)}
        </span>
        <span class="rowo-state${done ? ' ok' : ''}">${
          done
            ? ICO_COCHE
            : esc(t('progress.parcels', { done: orderDone(order, total), total }))
        }</span>
        <svg class="rowo-car" viewBox="0 0 20 20" aria-hidden="true"><path d="m7.5 4.5 5.5 5.5-5.5 5.5" /></svg>
      </button>`;
    })
    .join('');

  if (!colonnes) {
    $('ws-orders').innerHTML = liste;
    return;
  }

  $('ws-orders').innerHTML = `<div class="ws-split">
    <div class="ws-file">${liste}</div>
    <div class="ws-guichet">${focusMarkup(shown)}</div>
  </div>`;
  cablerFocus();
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
  $('ws-orders').innerHTML = focusMarkup(shown);
  cablerFocus();

  // Le guichet s'ouvre en haut de la commande, pas là où la liste en était.
  $('ws-orders').scrollIntoView({ block: 'start' });
}

/** L'historique se charge à l'ouverture seulement. */
function cablerFocus() {
  $('ws-orders')
    .querySelector('[data-hist]')
    ?.addEventListener('toggle', (event) => {
      if (event.currentTarget.open) void chargerHistorique(event.currentTarget);
    });
}

/*
 * La consigne du marchand, sur la commande : « Attendre le réassort · au plus
 * tard le 26 oct. » se lit au moment d'emballer, pas seulement dans un ticket
 * qu'on a lu la veille.
 */
function consigneDeCommandeMarkup(order, grande = false) {
  const consigne = order.consigne;
  const texte = consigne?.textes?.[state.lang] ?? consigne?.textes?.fr;
  if (!texte) return '';
  return grande
    ? `<div class="ord-consigne ord-consigne-${esc(consigne.choix)}">
         <span class="ord-label">${esc(t('csg.onOrder'))}</span>
         <b>${esc(texte)}</b>
       </div>`
    : `<span class="rowo-consigne rowo-consigne-${esc(consigne.choix)}">${esc(texte)}</span>`;
}

function focusMarkup(shown) {
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

  return `
    <div class="focus-bar">
      <button type="button" class="btn btn-small" data-back="1">${ICO_PREC}${esc(t('focus.back'))}</button>
      <span class="focus-pos">${at + 1} / ${list.length}</span>
      <span class="focus-nav">
        <button type="button" class="btn btn-small" data-nav="prev" ${at <= 0 ? 'disabled' : ''}
          aria-label="${esc(t('focus.prev'))}">${ICO_PREC}</button>
        <button type="button" class="btn btn-small" data-nav="next"
          ${at >= list.length - 1 ? 'disabled' : ''}
          aria-label="${esc(t('focus.next'))}">${ICO_SUIV}</button>
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

      ${consigneDeCommandeMarkup(order, true)}

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
    $('ws-dl-xlsx').href = $('ws-xlsx').href;

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

  const carrier = event.target.closest('[data-carrier]');
  if (carrier) {
    const card = carrier.closest('.pk');
    card.querySelector('[data-field="carrier"]').value = carrier.dataset.carrier;
    card.querySelectorAll('[data-carrier]').forEach((bouton) =>
      bouton.setAttribute('aria-pressed', String(bouton === carrier)),
    );
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
    ouvrirSignalement(state.orders.find((order) => order.id === issue.dataset.issue) ?? null);
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

/*
 * Signaler un problème.
 *
 * La commande se montre une fois, en fiche qu'on reconnaît — numéro, client,
 * date, articles en vignettes — au lieu d'être dite trois fois sans preuve
 * que c'est la bonne. Le problème se choisit d'un geste parmi cinq tuiles ;
 * ce que la commande sait déjà s'affiche selon le problème : le numéro, tel
 * qu'il est écrit, l'adresse, ou les articles à toucher plutôt qu'à retaper.
 * Le détail est requis, et le bouton l'attend au lieu de le reprocher après
 * coup.
 */
function ouvrirSignalement(order) {
  state.issueKind = 'PHONE';
  state.issueArticle = 0;
  state.issuePhotos = [];
  state.issueInfo = null;
  $('issue-note').value = '';
  $('issue-num').value = '';
  $('issue-find-res').innerHTML = '';
  preparerSignalement(order);
  $('issue-modal').classList.add('open');
  // Sans commande, on commence par la chercher ; avec, par dire le problème.
  (order ? $('issue-kinds').querySelector('[aria-checked="true"]') : $('issue-num'))?.focus();
}

function fermerSignalement() {
  $('issue-modal').classList.remove('open');
}

/**
 * La commande visée par le signalement, et l'article pré-rempli.
 *
 * Le premier article de la commande : dans neuf cas sur dix c'est celui qui
 * manque, et le fournisseur n'a plus qu'à corriger.
 */
function preparerSignalement(order) {
  state.issueOrder = order;
  state.issueArticle = 0;
  // Une rupture peut toucher plusieurs articles : le premier est coché d'office.
  state.issueCoches = new Set(order?.lineItems?.length ? [0] : []);
  $('issue-fiche').hidden = !order;
  $('issue-find').hidden = Boolean(order);
  $('issue-fiche').innerHTML = order ? ficheCommande(order) : '';
  remplirArticle(order?.lineItems?.[0]);
  renderSignalement();
}

/* Les champs d'article envoyés au marchand : remplis d'après l'article
   touché, ou à la main quand la commande n'en liste aucun. */
function remplirArticle(article) {
  $('issue-product').value = article?.title ?? '';
  const { couleur, taille } = repartirDeclinaison(article?.variantTitle);
  $('issue-color').value = couleur;
  $('issue-size').value = taille;
  $('issue-sku').value = article?.sku ?? '';
  $('issue-qty').value = String(article?.quantity ?? 1);
}

const clientDeLaCommande = (order) =>
  order?.shippingAddress?.name ?? order?.customer?.displayName ?? '';

const jourDeLaCommande = (order) =>
  order?.createdAt
    ? new Date(order.createdAt).toLocaleDateString(locale, { day: 'numeric', month: 'short' })
    : '';

function vignette(article) {
  return article?.image
    ? `<img src="${esc(article.image)}" alt="" loading="lazy" />`
    : '<i aria-hidden="true"></i>';
}

/* La fiche : de quoi reconnaître la commande d'un coup d'œil. Pas de
   montant — c'est le prix de vente du marchand, pas l'affaire de l'atelier. */
function ficheCommande(order) {
  const articles = order.lineItems ?? [];
  const n = order.itemsQuantity ?? articles.reduce((total, item) => total + (item.quantity ?? 1), 0);
  const ville = order.shippingAddress?.city ?? '';
  return `<span class="sig-vignettes" aria-hidden="true">${articles.slice(0, 2).map(vignette).join('')}</span>
    <span class="sig-fiche-txt">
      <span class="sig-fiche-l1"><b>${esc(order.name ?? '')}</b><span>${esc(
        [clientDeLaCommande(order), ville].filter(Boolean).join(' · '),
      )}</span></span>
      <span class="sig-fiche-l2">${esc([jourDeLaCommande(order), t(n > 1 ? 'issue.items' : 'issue.item', { n })].filter(Boolean).join(' · '))}</span>
    </span>
    <button type="button" class="sig-lien" data-changer>${esc(t('issue.change'))}</button>`;
}

/* La tuile choisie, le contexte qui va avec, l'indice du détail, le bouton. */
function renderSignalement() {
  const kind = state.issueKind;
  for (const tuile of $('issue-kinds').querySelectorAll('[data-kind]')) {
    const choisie = tuile.dataset.kind === kind;
    tuile.setAttribute('aria-checked', String(choisie));
    tuile.tabIndex = choisie ? 0 : -1;
  }
  // `data-tph` suit le problème : un changement de langue garde le bon indice.
  const note = $('issue-note');
  note.dataset.tph = `issue.hint.${kind}`;
  /* Une rupture se dit en cochant les articles : la note n'est plus qu'une
     précision, et le délai se donne d'une puce. */
  const rupture = kind === 'STOCK';
  if (rupture) note.dataset.tph = 'issue.hint.STOCKopt';
  note.placeholder = t(note.dataset.tph);
  $('issue-infos').hidden = !rupture;
  document.querySelector('#issue-modal .sig-requis[data-t="issue.required"]').hidden = rupture;
  $('issue-facultatif').hidden = !rupture;
  for (const puce of $('issue-infos').querySelectorAll('[data-info]')) {
    puce.setAttribute('aria-checked', String(puce.dataset.info === state.issueInfo));
  }
  renderContexte();
  majEnvoiSignalement();
}

/*
 * Ce que la commande sait déjà, selon le problème.
 *
 * Le numéro et l'adresse s'affichent tels qu'ils sont écrits, sans jugement :
 * l'atelier voit ce qui cloche. Pour un article manquant ou abîmé, on touche
 * la ligne de la commande — modèle, couleur, taille et référence suivent ; la
 * saisie à la main ne reste que si la commande ne liste aucun article.
 */
function renderContexte() {
  const boite = $('issue-contexte');
  const order = state.issueOrder;
  const kind = state.issueKind;
  const articles = order?.lineItems ?? [];
  const parArticle = kind === 'STOCK' || kind === 'DAMAGE';

  $('issue-item').hidden = !(order && parArticle && articles.length === 0);
  if (!order) return (boite.innerHTML = '');

  if (kind === 'PHONE') {
    const tel = order.shippingAddress?.phone ?? order.customer?.address?.phone ?? null;
    boite.innerHTML = `<div class="sig-encart"><span class="sig-encart-titre">${esc(t('issue.phoneOnOrder'))}</span>${
      tel ? `<b class="sig-tel">${esc(tel)}</b>` : `<span class="sig-vide">${esc(t('issue.noPhone'))}</span>`
    }${pastillesAvertissement(verifierTelephone(tel, order.shippingAddress?.country))}</div>`;
    return;
  }

  if (kind === 'ADDRESS') {
    const adresse = order.shippingAddress;
    const lignes = adresse?.formatted?.length
      ? adresse.formatted
      : [
          adresse?.name,
          [adresse?.address1, adresse?.address2].filter(Boolean).join(' '),
          [adresse?.zip, adresse?.city].filter(Boolean).join(' '),
          adresse?.country,
        ].filter(Boolean);
    boite.innerHTML = `<div class="sig-encart"><span class="sig-encart-titre">${esc(t('issue.addressOnOrder'))}</span>${
      lignes.length
        ? `<span class="sig-adresse">${lignes.map((ligne) => `<span>${esc(ligne)}</span>`).join('')}</span>`
        : `<span class="sig-vide">${esc(t('issue.noAddress'))}</span>`
    }${adresse ? pastillesAvertissement(verifierAdresse(adresse)) : ''}</div>`;
    return;
  }

  if (parArticle) {
    boite.innerHTML = (articles.length ? listeArticles(articles, kind) : '') + (kind === 'DAMAGE' ? zonePhotos() : '');
    return;
  }

  boite.innerHTML = '';
}

/* Les articles de la commande, à toucher plutôt qu'à retaper. */
function listeArticles(articles, kind) {
  /* Une rupture : plusieurs articles peuvent manquer, chacun aura son dossier. */
  if (kind === 'STOCK') {
    const coches = state.issueCoches ?? new Set();
    return `<p class="sig-titre" id="issue-article-titre">${esc(t('issue.whichMissingMany'))} <span class="sig-requis">· ${esc(
      t('issue.nOf', { n: coches.size, total: articles.length }),
    )}</span></p>
    <div class="sig-articles" role="group" aria-labelledby="issue-article-titre">${articles
      .map(
        (article, i) => `<button type="button" class="sig-article sig-coche" role="checkbox" data-article="${i}"
          aria-checked="${coches.has(i)}"><span class="sig-rond" aria-hidden="true"></span>${vignette(
            article,
          )}<span class="sig-article-txt"><b>${esc(article.title)}</b><span>${esc(
            [article.variantTitle, article.sku].filter(Boolean).join(' · '),
          )}</span></span><span class="sig-qte">× ${esc(article.quantity)}</span></button>`,
      )
      .join('')}</div>`;
  }
  const choisi = articles[state.issueArticle] ?? articles[0];
  return `<p class="sig-titre" id="issue-article-titre">${esc(
    t(kind === 'STOCK' ? 'issue.whichMissing' : 'issue.whichDamaged'),
  )}</p>
    <div class="sig-articles" role="radiogroup" aria-labelledby="issue-article-titre">${articles
      .map(
        (article, i) => `<button type="button" class="sig-article" role="radio" data-article="${i}"
          aria-checked="${i === state.issueArticle}"><span class="sig-rond" aria-hidden="true"></span>${vignette(
            article,
          )}<span class="sig-article-txt"><b>${esc(article.title)}</b><span>${esc(
            [article.variantTitle, article.sku].filter(Boolean).join(' · '),
          )}</span></span><span class="sig-qte">× ${esc(article.quantity)}</span></button>`,
      )
      .join('')}</div>${
      kind === 'STOCK'
        ? `<label class="sig-manque"><span>${esc(t('issue.qtyMissing'))}</span><input type="number"
            id="issue-qty-manque" min="1" max="${esc(Math.max(1, choisi.quantity ?? 1))}"
            value="${esc($('issue-qty').value)}" /></label>`
        : ''
    }`;
}

/*
 * Les photos d'un article abîmé.
 *
 * Une semelle décollée se voit d'un coup d'œil ; décrite en une phrase, elle
 * appelle un aller-retour avec l'atelier pour demander la photo. Quatre au
 * plus — la limite du serveur — réduites dans le navigateur comme les photos
 * d'étiquettes : quelques centaines de kilooctets, pas les mégaoctets bruts
 * d'un téléphone. Au téléphone, le sélecteur propose l'appareil photo.
 */
const PHOTOS_MAX = 4;

function zonePhotos() {
  const photos = state.issuePhotos ?? [];
  const vignettes = photos
    .map(
      (photo, i) => `<span class="sig-photo"><img src="${photo}" alt="" /><button type="button"
        class="sig-photo-x" data-retirer-photo="${i}" aria-label="${esc(t('issue.photoRemove'))}"
        title="${esc(t('issue.photoRemove'))}">${ICO_CROIX}</button></span>`,
    )
    .join('');
  const ajout =
    photos.length < PHOTOS_MAX
      ? `<label class="sig-ajout"><input type="file" id="issue-photos-input" accept="image/*" multiple hidden /><svg
          viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h3l1.5-2h7L17 8h3v11H4zM12 16.5a3.5 3.5 0 1 0 0-7a3.5 3.5 0 0 0 0 7z" /></svg><span>${esc(
            t(photos.length ? 'issue.addPhoto' : 'issue.addPhotos'),
          )}</span></label>`
      : '';
  return `<div class="sig-photos">${vignettes}${ajout}</div>
    <p class="sig-photos-note">${esc(t('issue.photosHint', { n: PHOTOS_MAX }))}</p>`;
}

async function ajouterPhotos(fichiers) {
  const place = PHOTOS_MAX - (state.issuePhotos?.length ?? 0);
  for (const fichier of [...fichiers].slice(0, Math.max(0, place))) {
    try {
      state.issuePhotos = [...(state.issuePhotos ?? []), await shrinkPhoto(fichier)];
    } catch {
      // Un format que le navigateur ne sait pas lire (HEIC sur un ordinateur,
      // fichier abîmé) : on le dit, les autres photos passent.
      toast(t('issue.photoErr'), true);
    }
  }
  renderContexte();
}

/*
 * Les repères orange : ce qui cloche probablement, d'après des règles
 * prudentes (voir `workspace.verif.js`). Un repère, pas un verdict — l'atelier
 * voit le numéro et l'adresse juste au-dessus, et en juge.
 */
function pastillesAvertissement(avertissements) {
  if (!avertissements.length) return '';
  return `<span class="sig-avert" title="${esc(t('issue.warn.hint'))}">${avertissements
    .map(({ cle, valeurs }) => `<span class="sig-pastille">${esc(t(cle, valeurs))}</span>`)
    .join('')}</span>`;
}

function signalementPret() {
  // Trois caractères : le minimum que le serveur accepte pour une note.
  return Boolean(state.issueOrder) && ($('issue-note').value.trim().length >= 3 || rupturePrete());
}

/* Une rupture se suffit d'un article coché — ou, sans articles à toucher, d'un modèle saisi. */
function rupturePrete() {
  if (state.issueKind !== 'STOCK') return false;
  return state.issueOrder?.lineItems?.length
    ? (state.issueCoches?.size ?? 0) > 0
    : Boolean($('issue-product').value.trim() || $('issue-sku').value.trim());
}

/* Les puces sont envoyées en français : c'est le marchand qui les lit, et
   l'outil en tire le délai annoncé (« sous 10 jours »). */
const INFOS_RUPTURE = {
  j10: 'Réassort sous 10 jours.',
  m1: 'Réassort sous 1 mois.',
  fin: 'Plus fabriqué.',
  inconnue: 'Date de réassort inconnue.',
};

function majEnvoiSignalement() {
  const pret = signalementPret();
  $('issue-send').disabled = !pret;
  $('issue-send-top').disabled = !pret;
}

/*
 * « Nouveau ticket », depuis la rubrique Tickets.
 *
 * Même fenêtre que depuis une ligne de commande, la commande en moins : elle
 * se retrouve par son numéro, avec la même recherche que la liste — donc le
 * même niveau d'accès.
 */
$('ws-new-ticket')?.addEventListener('click', () => ouvrirSignalement(null));

/*
 * La recherche part pendant qu'on tape.
 *
 * Plus de bouton « Chercher » : les commandes qui correspondent s'affichent
 * en liste, et on choisit la bonne d'un clic. Rien n'est choisi tout seul —
 * « 1218 » trouverait la commande #1218 avant qu'on ait fini d'écrire
 * « 12189 ». Entrée prend la seule réponse quand il n'y en a qu'une.
 */
let rechercheSignalement = 0;

async function trouverCommandeDuTicket({ prendreSeule = false } = {}) {
  const terme = $('issue-num').value.trim();
  const tour = ++rechercheSignalement;
  const res = $('issue-find-res');
  state.issueResults = [];
  if (terme.replace(/^#/, '').length < 2) return (res.innerHTML = '');

  res.innerHTML = '<p class="sig-note">…</p>';
  try {
    const data = await api(`/api/workspace/${supplierId}/orders/search?q=${encodeURIComponent(terme)}`);
    if (tour !== rechercheSignalement) return;
    const orders = data.orders ?? [];
    state.issueResults = orders;
    if (prendreSeule && orders.length === 1) return preparerSignalement(orders[0]);
    res.innerHTML = orders.length
      ? orders
          .map(
            (order, i) => `<button type="button" class="sig-res-ligne" data-pick="${i}"><b>${esc(
              order.name ?? '',
            )}</b><span>${esc(clientDeLaCommande(order))}</span><span class="sig-gris">${esc(
              jourDeLaCommande(order),
            )}</span></button>`,
          )
          .join('')
      : `<p class="sig-note">${esc(data.reason ?? t('orders.notFound'))}</p>`;
  } catch (error) {
    if (tour === rechercheSignalement) res.innerHTML = `<p class="sig-note">${esc(messageServeur(error, 'orders.err'))}</p>`;
  }
}

$('issue-num')?.addEventListener('input', () => {
  clearTimeout(state.issueTimer);
  state.issueTimer = setTimeout(() => void trouverCommandeDuTicket(), 300);
});
$('issue-num')?.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter') return;
  event.preventDefault();
  clearTimeout(state.issueTimer);
  void trouverCommandeDuTicket({ prendreSeule: true });
});

$('issue-find-res')?.addEventListener('click', (event) => {
  const ligne = event.target.closest('[data-pick]');
  if (!ligne) return;
  preparerSignalement(state.issueResults?.[Number(ligne.dataset.pick)] ?? null);
  $('issue-kinds').querySelector('[aria-checked="true"]')?.focus();
});

/* « Changer » : la recherche revient, la commande s'efface. */
$('issue-fiche')?.addEventListener('click', (event) => {
  if (!event.target.closest('[data-changer]')) return;
  preparerSignalement(null);
  $('issue-num').value = '';
  $('issue-find-res').innerHTML = '';
  $('issue-num').focus();
});

/* Les tuiles : un clic, ou les flèches comme dans un groupe de boutons radio. */
$('issue-kinds')?.addEventListener('click', (event) => {
  const tuile = event.target.closest('[data-kind]');
  if (!tuile) return;
  state.issueKind = tuile.dataset.kind;
  renderSignalement();
});
$('issue-kinds')?.addEventListener('keydown', (event) => {
  const pas = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
  if (!pas) return;
  event.preventDefault();
  const tuiles = [...$('issue-kinds').querySelectorAll('[data-kind]')];
  const rang = tuiles.findIndex((tuile) => tuile.dataset.kind === state.issueKind);
  const suivante = tuiles[(rang + pas + tuiles.length) % tuiles.length];
  state.issueKind = suivante.dataset.kind;
  renderSignalement();
  suivante.focus();
});

$('issue-contexte')?.addEventListener('click', (event) => {
  const retirer = event.target.closest('[data-retirer-photo]');
  if (retirer) {
    state.issuePhotos = state.issuePhotos.filter((_, i) => i !== Number(retirer.dataset.retirerPhoto));
    renderContexte();
    return;
  }
  const ligne = event.target.closest('[data-article]');
  if (!ligne) return;
  if (state.issueKind === 'STOCK') {
    const rang = Number(ligne.dataset.article);
    const coches = state.issueCoches ?? new Set();
    if (coches.has(rang)) coches.delete(rang);
    else coches.add(rang);
    state.issueCoches = coches;
    renderContexte();
    majEnvoiSignalement();
    $('issue-contexte').querySelector(`[data-article="${rang}"]`)?.focus();
    return;
  }
  state.issueArticle = Number(ligne.dataset.article);
  remplirArticle(state.issueOrder?.lineItems?.[state.issueArticle]);
  renderContexte();
  $('issue-contexte').querySelector(`[data-article="${state.issueArticle}"]`)?.focus();
});
$('issue-contexte')?.addEventListener('input', (event) => {
  if (event.target.id === 'issue-qty-manque') $('issue-qty').value = event.target.value;
});
$('issue-contexte')?.addEventListener('change', (event) => {
  if (event.target.id === 'issue-photos-input' && event.target.files?.length) {
    void ajouterPhotos(event.target.files);
  }
});

$('issue-note').addEventListener('input', majEnvoiSignalement);
$('issue-product')?.addEventListener('input', majEnvoiSignalement);
$('issue-sku')?.addEventListener('input', majEnvoiSignalement);

/* Une puce à la fois ; la retoucher la retire. */
$('issue-infos')?.addEventListener('click', (event) => {
  const puce = event.target.closest('[data-info]');
  if (!puce) return;
  state.issueInfo = state.issueInfo === puce.dataset.info ? null : puce.dataset.info;
  renderSignalement();
});

$('issue-cancel').addEventListener('click', fermerSignalement);
$('issue-cancel-top')?.addEventListener('click', fermerSignalement);
$('issue-send-top')?.addEventListener('click', () => $('issue-send').click());

$('issue-modal').addEventListener('click', (event) => {
  if (event.target === $('issue-modal')) fermerSignalement();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && $('issue-modal').classList.contains('open')) fermerSignalement();
});

$('issue-send').addEventListener('click', async () => {
  const kind = state.issueKind;
  const rupture = kind === 'STOCK';
  // La puce d'abord, puis la précision : « Réassort sous 10 jours. Taille 38 seulement. »
  const note = [rupture && state.issueInfo ? INFOS_RUPTURE[state.issueInfo] : null, $('issue-note').value.trim()]
    .filter(Boolean)
    .join(' ');
  if (!state.issueOrder) {
    toast(t('ticket.needOrder'), true);
    return;
  }
  if (rupture ? !rupturePrete() : note.length < 3) {
    toast(t(rupture ? 'issue.needItem' : 'issue.needNote'), true);
    return;
  }

  /* Les articles cochés, un dossier chacun : le marchand décidera pour chacun. */
  const lignes = state.issueOrder.lineItems ?? [];
  const articles =
    rupture && lignes.length
      ? [...(state.issueCoches ?? [])]
          .sort((a, b) => a - b)
          .map((rang) => lignes[rang])
          .filter(Boolean)
          .map((article) => {
            const { couleur, taille } = repartirDeclinaison(article.variantTitle);
            return {
              product: article.title ?? null,
              color: couleur || null,
              size: taille || null,
              sku: article.sku ?? null,
              quantity: article.quantity ?? null,
            };
          })
      : null;

  $('issue-send').disabled = true;
  $('issue-send-top').disabled = true;

  try {
    await api(`/api/workspace/${supplierId}/issues`, {
      method: 'POST',
      body: {
        shopifyOrderId: state.issueOrder.id,
        orderName: state.issueOrder.name,
        customerEmail: state.issueOrder.customer?.email ?? null,
        kind,
        note: note || null,
        ...(articles?.length ? { articles } : {}),
        // Champs d'article : envoyés pour une rupture ou un article abîmé —
        // l'agent sait alors lequel sans rouvrir la commande — et seulement
        // s'ils sont remplis : un champ vide n'apprend rien au marchand.
        ...(kind === 'STOCK' || kind === 'DAMAGE'
          ? {
              product: $('issue-product').value.trim() || null,
              color: $('issue-color').value.trim() || null,
              size: $('issue-size').value.trim() || null,
              sku: $('issue-sku').value.trim() || null,
              quantity: kind === 'STOCK' ? Number($('issue-qty').value) || null : null,
            }
          : {}),
        ...(kind === 'DAMAGE' && state.issuePhotos?.length ? { photos: state.issuePhotos } : {}),
      },
    });

    fermerSignalement();
    toast(articles && articles.length > 1 ? t('issue.sentMany', { n: articles.length }) : t('issue.sent'));
  } catch (error) {
    toast(error.message, true);
  } finally {
    majEnvoiSignalement();
  }
});

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
  // Toucher l'onglet ramène à sa liste, comme sur iPhone.
  if (view === 'tickets' && state.tk) state.tk.ouvert = null;
  if (view === 'catalog' && !enColonnes.matches) state.catalogFocus = null;
  const sections = ECRANS[view] ?? [view];
  const courant = sections.length > 1 ? (state.sous?.[view] ?? sections[0]) : sections[0];

  for (const section of TOUTES) {
    const bloc = $(`view-${section}`);
    if (bloc) bloc.hidden = section !== courant;
  }

  // L'en-tête des commandes est commun à leurs trois onglets ; ce qui ne
  // sert qu'à « À préparer » se retire sur les deux autres (CSS, `data-onglet`).
  for (const id of ['cmd-tete', 'cmd-barre']) {
    $(id).hidden = view !== 'orders';
    $(id).dataset.onglet = courant;
  }
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

// « Masquer les préparées » : allumé, la file ne montre que ce qui reste.
$('ws-masquer')?.addEventListener('click', () => {
  state.filter = state.filter === 'all' ? 'left' : 'all';
  renderOrders();
});

document.querySelectorAll('#ws-quick [data-range]').forEach((button) =>
  button.addEventListener('click', () => {
    const [since, until] = rangeDates(button.dataset.range);
    $('ws-since').value = since;
    $('ws-until').value = until;

    document.querySelectorAll('#ws-quick [data-range]').forEach((other) =>
      other.setAttribute('aria-pressed', String(other === button)),
    );

    fermerMenusCommandes();
    majPeriode();
    void load();
  }),
);

/** Le nom de la période dans le sous-titre : celle cochée, ou « Dates choisies ». */
function majPeriode() {
  const nom = $('ws-periode-nom');
  if (!nom) return;
  const cochee = document.querySelector('#ws-quick [data-range][aria-pressed="true"]');
  nom.textContent = cochee ? cochee.textContent : t('range.custom');
}

/*
 * Des dates précises rechargent la file.
 *
 * Elles ne servaient qu'aux exports : choisir le 12 octobre laissait la
 * liste sur hier, et le fichier téléchargé ne disait pas la même chose que
 * l'écran. Elles décochent les trois périodes nommées.
 */
for (const id of ['ws-since', 'ws-until']) {
  $(id)?.addEventListener('change', () => {
    if (!$('ws-since').value || !$('ws-until').value) return;
    document.querySelectorAll('#ws-quick [data-range]').forEach((other) => other.setAttribute('aria-pressed', 'false'));
    majPeriode();
    void load();
  });
}

/* Les deux menus de l'en-tête : la période, et les formats de téléchargement. */
const MENUS_COMMANDES = [
  ['ws-periode', 'ws-periode-menu'],
  ['ws-dl-plus', 'ws-dl-menu'],
];

function fermerMenusCommandes(sauf = null) {
  for (const [bouton, menu] of MENUS_COMMANDES) {
    if (menu === sauf || !$(menu)) continue;
    $(menu).hidden = true;
    $(bouton).setAttribute('aria-expanded', 'false');
  }
}

for (const [bouton, menu] of MENUS_COMMANDES) {
  $(bouton)?.addEventListener('click', (event) => {
    event.stopPropagation();
    const ouvrir = $(menu).hidden;
    fermerMenusCommandes(ouvrir ? menu : null);
    $(menu).hidden = !ouvrir;
    $(bouton).setAttribute('aria-expanded', String(ouvrir));
  });
}

document.addEventListener('click', (event) => {
  // Les dates se saisissent dans le menu : y cliquer ne le referme pas.
  if (event.target.closest('#ws-periode-menu')) return;
  fermerMenusCommandes();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') fermerMenusCommandes();
});
$('ws-dl-menu')?.addEventListener('click', (event) => {
  if (event.target.closest('a')) fermerMenusCommandes();
});

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

/** Épuisé : vendu à zéro. Un stock non suivi (`null`) n'est pas un stock vide. */
const estEpuise = (item) => item.totalInventory === 0;

function renderCatalog(error) {
  const rows = $('catalog-rows');
  const tout = state.catalog ?? [];
  const colonnes = enColonnes.matches;

  if (state.catalogFocus && !colonnes) {
    renderProductSheet();
    return;
  }
  $('view-catalog').classList.remove('cat-plein');

  // Le résumé, les filtres et la recherche n'ont de sens qu'avec des modèles.
  const paires = tout.reduce((somme, item) => somme + Math.max(0, item.totalInventory ?? 0), 0);
  $('catalog-resume').textContent = tout.length ? t('catalog.summary', { n: tout.length, p: paires }) : '';
  $('catalog-search').hidden = tout.length === 0;
  $('catalog-outils').hidden = tout.length === 0;

  const epuises = tout.filter(estEpuise).length;
  const dispo = state.catalogDispo ?? 'tous';
  $('catalog-dispo').setAttribute('aria-label', t('catalog.availability'));
  $('catalog-dispo')
    .querySelectorAll('[data-dispo]')
    .forEach((bouton) => {
      const n = { tous: tout.length, stock: tout.length - epuises, epuise: epuises }[bouton.dataset.dispo];
      bouton.textContent = `${t(`catalog.dispo.${bouton.dataset.dispo}`)} ${n}`;
      bouton.setAttribute('aria-pressed', String(bouton.dataset.dispo === dispo));
    });

  const marques = [...new Set(tout.map((item) => item.vendor).filter(Boolean))].sort((a, b) => a.localeCompare(b, locale));
  const marque = marques.includes(state.catalogMarque) ? state.catalogMarque : '';
  $('catalog-marque-choix').hidden = marques.length < 2;
  $('catalog-marque').innerHTML = [
    `<option value="">${esc(t('catalog.allBrands'))}</option>`,
    ...marques.map((nom) => `<option value="${esc(nom)}"${nom === marque ? ' selected' : ''}>${esc(nom)}</option>`),
  ].join('');

  // Le champ de recherche filtre sur place : cent produits sont déjà là, une
  // requête par frappe n'apporterait que l'attente.
  const needle = ($('catalog-q')?.value ?? '').trim().toLowerCase();
  const items = tout.filter(
    (item) =>
      (!needle || item.title.toLowerCase().includes(needle) || (item.vendor ?? '').toLowerCase().includes(needle)) &&
      (!marque || item.vendor === marque) &&
      (dispo === 'tous' || (dispo === 'epuise' ? estEpuise(item) : !estEpuise(item))),
  );

  if (items.length === 0) {
    rows.innerHTML = `<p class="empty">${esc(error ?? (tout.length ? t('catalog.noMatch') : t('catalog.empty')))}</p>`;
    return;
  }

  // En colonnes, un modèle est toujours ouvert à droite : le premier, d'abord.
  if (colonnes && !items.some((item) => item.id === state.catalogFocus)) {
    state.catalogFocus = items[0].id;
    state.catalogCouleur = null;
    state.catalogTaille = null;
  }

  const grille = `<div class="cat-grid">${items
    .map(
      (item) => `<button type="button" class="catc${estEpuise(item) ? ' catc-epuise' : ''}" data-product="${esc(item.id)}"${
        colonnes && item.id === state.catalogFocus ? ' aria-current="true"' : ''
      }>
        ${
          item.image
            ? `<img class="catc-photo" src="${esc(item.image)}" alt="" loading="lazy" />`
            : '<span class="catc-photo catc-photo-none" aria-hidden="true"></span>'
        }
        <span class="catc-main">
          <b>${esc(item.title)}</b>
          <small>${esc([item.vendor, t('catalog.variants', { n: item.variantCount ?? 0 })].filter(Boolean).join(' · '))}</small>
          ${
            estEpuise(item)
              ? `<span class="pill catc-out">${esc(t('catalog.soldOutTag'))}</span>`
              : item.totalInventory > 0
                ? `<small class="catc-stock">${esc(t('catalog.stock', { n: item.totalInventory }))}</small>`
                : ''
          }
        </span>
      </button>`,
    )
    .join('')}</div>`;

  if (!colonnes) {
    rows.innerHTML = grille;
    return;
  }

  rows.innerHTML = `<div class="cat-split">${grille}<aside class="cat-fiche" aria-live="polite">${ficheDuModele()}</aside></div>`;
}

/** La fiche du modèle ouvert, ou son chargement. */
function ficheDuModele() {
  const product = state.catalogSheets?.[state.catalogFocus];
  if (product) return ficheMarkup(product);
  void chargerFiche(state.catalogFocus);
  return `<p class="empty">${esc(t('tk.loading'))}</p>`;
}

async function chargerFiche(id) {
  if (!id || state.catalogChargement === id) return;
  state.catalogChargement = id;
  try {
    const numeric = id.split('/').pop();
    const { product } = await api(`/api/workspace/${supplierId}/catalog/${numeric}`);
    (state.catalogSheets ??= {})[id] = product;
  } catch (error) {
    if (state.catalogFocus === id) {
      const zone = document.querySelector('.cat-fiche') ?? $('catalog-rows');
      zone.innerHTML = `<p class="empty">${esc(error.message)}</p>`;
    }
    return;
  } finally {
    state.catalogChargement = null;
  }
  // L'atelier a pu changer de modèle pendant le chargement.
  if (state.catalogFocus === id) renderCatalog();
}

/*
 * La fiche d'un modèle : la couleur, puis la taille.
 *
 * La question de l'atelier est « la 44 existe-t-elle, sous quelle référence,
 * avec quel stock » : les tailles d'une couleur tiennent sur une grille, chacune
 * avec son stock, et la taille choisie donne sa référence. Quand Shopify ne
 * nomme pas ses déclinaisons « Couleur / Taille », la fiche retombe sur la
 * liste simple.
 */
function ficheMarkup(product) {
  const variantes = product.variants.map((variant) => ({ ...variant, ...repartirDeclinaison(variant.title) }));
  const parTaille = variantes.every((variant) => variant.taille);
  const stockDe = (variant) => (variant.availableForSale ? variant.inventoryQuantity : 0);
  const total = variantes.reduce((somme, variant) => somme + Math.max(0, stockDe(variant) ?? 0), 0);

  const tete = (image, resume) => `
    ${
      image
        ? `<img class="sheet-photo" src="${esc(image)}" alt="" />`
        : '<span class="sheet-photo catc-photo-none" aria-hidden="true"></span>'
    }
    <div class="fiche-titre">
      <h2>${esc(product.title)}</h2>
      <small>${esc([product.vendor, resume].filter(Boolean).join(' · '))}</small>
    </div>`;

  if (!parTaille) {
    return `<div class="sheet">
      <div class="sheet-head">${tete(product.image, t('catalog.stock', { n: total }))}</div>
      <div class="sheet-vars">
        ${variantes
          .map(
            (variant) => `<div class="varr${variant.availableForSale ? '' : ' out'}">
              ${variant.image ? `<img class="varr-photo" src="${esc(variant.image)}" alt="" loading="lazy" />` : ''}
              <b class="varr-title">${esc(variant.title ?? '—')}</b>
              <span class="varr-sku mono">${esc(variant.sku ?? '')}</span>
              ${
                variant.availableForSale
                  ? variant.inventoryQuantity != null && variant.inventoryQuantity > 0
                    ? `<span class="varr-stock">${esc(t('catalog.stock', { n: variant.inventoryQuantity }))}</span>`
                    : ''
                  : `<span class="varr-out">${esc(t('catalog.out'))}</span>`
              }
            </div>`,
          )
          .join('')}
      </div>
    </div>`;
  }

  const couleurs = [...new Set(variantes.map((variant) => variant.couleur || '—'))];
  const couleur = couleurs.includes(state.catalogCouleur) ? state.catalogCouleur : couleurs[0];
  const deLaCouleur = variantes.filter((variant) => (variant.couleur || '—') === couleur);
  const choisie =
    deLaCouleur.find((variant) => variant.taille === state.catalogTaille) ??
    deLaCouleur.find((variant) => (stockDe(variant) ?? 1) > 0) ??
    deLaCouleur[0];
  const tailles = variantes.map((variant) => parseFloat(variant.taille.replace(',', '.'))).filter(Number.isFinite);
  const etendue = tailles.length ? `${Math.min(...tailles)}–${Math.max(...tailles)}` : '';
  const stockTexte = (stock) =>
    stock === null || stock === undefined
      ? ''
      : stock <= 0
        ? t('catalog.out')
        : stock <= 2
          ? t(stock > 1 ? 'catalog.left' : 'catalog.leftOne', { n: stock })
          : t('catalog.stock', { n: stock });

  return `<div class="sheet fiche">
    <div class="sheet-head">${tete(
      deLaCouleur.find((variant) => variant.image)?.image ?? product.image,
      [t(couleurs.length > 1 ? 'catalog.colors' : 'catalog.colorsOne', { n: couleurs.length }), etendue, t('catalog.stock', { n: total })]
        .filter(Boolean)
        .join(' · '),
    )}</div>
    ${
      couleurs.length > 1
        ? `<div class="fiche-bloc">
            <span class="fiche-t">${esc(t('catalog.color'))}</span>
            <div class="seg fiche-couleurs" role="group" aria-label="${esc(t('catalog.color'))}">${couleurs
              .map(
                (nom) =>
                  `<button type="button" data-cat-couleur="${esc(nom)}" aria-pressed="${String(nom === couleur)}">${esc(nom)}</button>`,
              )
              .join('')}</div>
          </div>`
        : ''
    }
    <div class="fiche-bloc">
      <span class="fiche-t">${esc(t('catalog.sizes'))}</span>
      <div class="fiche-tailles" role="group" aria-label="${esc(t('catalog.sizes'))}">${deLaCouleur
        .map((variant) => {
          const stock = stockDe(variant);
          const etat = stock === 0 ? ' fiche-vide' : stock !== null && stock <= 2 ? ' fiche-peu' : '';
          return `<button type="button" class="fiche-taille${etat}" data-cat-taille="${esc(variant.taille)}" aria-pressed="${String(
            variant === choisie,
          )}"><b>${esc(variant.taille)}</b><span>${esc(stockTexte(stock))}</span></button>`;
        })
        .join('')}</div>
    </div>
    <dl class="fiche-ref">
      <div><dt>${esc(t('catalog.ref'))}</dt><dd class="mono">${esc(choisie.sku || '—')}</dd></div>
      <div><dt>${esc(t('catalog.stockLabel'))}</dt><dd class="${stockDe(choisie) === 0 ? 'fiche-ref-vide' : ''}">${esc(
        stockTexte(stockDe(choisie)) || '—',
      )}</dd></div>
    </dl>
  </div>`;
}

/** Sur téléphone : la fiche plein écran, et « Catalogue » pour revenir. */
async function renderProductSheet() {
  const rows = $('catalog-rows');
  $('view-catalog').classList.add('cat-plein');

  const back = `<div class="focus-bar">
    <button type="button" class="tk-retour" data-cat-back="1">${picto('retour')}${esc(t('catalog.back'))}</button>
  </div>`;

  const cached = state.catalogSheets?.[state.catalogFocus];
  if (!cached) {
    rows.innerHTML = `${back}<p class="empty">…</p>`;
    await chargerFiche(state.catalogFocus);
    return;
  }
  rows.innerHTML = `${back}${ficheMarkup(cached)}`;
}

$('catalog-rows').addEventListener('click', (event) => {
  const open = event.target.closest('[data-product]');
  if (open) {
    if (open.dataset.product !== state.catalogFocus) {
      state.catalogCouleur = null;
      state.catalogTaille = null;
    }
    state.catalogFocus = open.dataset.product;
    renderCatalog();
    return;
  }
  const couleur = event.target.closest('[data-cat-couleur]');
  if (couleur) {
    state.catalogCouleur = couleur.dataset.catCouleur;
    state.catalogTaille = null;
    renderCatalog();
    return;
  }
  const taille = event.target.closest('[data-cat-taille]');
  if (taille) {
    state.catalogTaille = taille.dataset.catTaille;
    renderCatalog();
    return;
  }
  if (event.target.closest('[data-cat-back]')) {
    state.catalogFocus = null;
    renderCatalog();
  }
});

$('catalog-q')?.addEventListener('input', () => renderCatalog());
$('catalog-dispo')?.addEventListener('click', (event) => {
  const bouton = event.target.closest('[data-dispo]');
  if (!bouton) return;
  state.catalogDispo = bouton.dataset.dispo;
  renderCatalog();
});
$('catalog-marque')?.addEventListener('change', (event) => {
  state.catalogMarque = event.target.value;
  renderCatalog();
});

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
    ${consignesMarkup(dossier)}
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

/* ------------------------------------------------------------ consignes -- */

/*
 * La réponse du marchand, dans le ticket même.
 *
 * L'atelier signalait « réassort dans dix jours » et n'entendait plus rien :
 * le ticket restait « en attente du marchand », la commande dormait sur
 * l'étagère. La réponse arrive maintenant sous son signalement — une
 * consigne, pas une conversation : attendre, remplacer, ne pas expédier, ou
 * un message. Elle est écrite dans sa langue par le serveur ; seul le mot du
 * marchand est traduit, et l'original reste à un clic.
 */
const PICTOS_CONSIGNE = {
  ATTENDRE: '<path d="M12 21a9 9 0 1 0 0-18a9 9 0 0 0 0 18M12 7v5l3 2" />',
  REMPLACER: '<path d="M4 8h13l-3-3M20 16H7l3 3" />',
  ANNULER: '<path d="M12 21a9 9 0 1 0 0-18a9 9 0 0 0 0 18M5.6 5.6l12.8 12.8" />',
  MESSAGE: '<path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-4.5 3.5V17A2.5 2.5 0 0 1 4 14.5z" />',
};

/** La consigne qui vaut encore : la dernière, si elle n'a pas été remplacée. */
function consigneCourante(dossier) {
  const derniere = (dossier.consignes ?? []).at(-1);
  return derniere && !derniere.remplaceeLe ? derniere : null;
}

/* Les guillemets de chaque langue : « » en chinois se lisent comme une faute. */
const GUILLEMETS = { fr: ['« ', ' »'], en: ['“', '”'], zh: ['「', '」'] };
const cite = (texte) => {
  const [ouvre, ferme] = GUILLEMETS[state.lang] ?? GUILLEMETS.fr;
  return `${ouvre}${texte}${ferme}`;
};

const texteDe = (consigne) => consigne.textes?.[state.lang] ?? consigne.textes?.fr ?? { titre: '', detail: '', court: '' };
const motDe = (consigne) =>
  state.lang === 'fr' ? consigne.mot : (consigne.motTraduit?.[state.lang] ?? consigne.mot);

function modelesConsigneMarkup(consigne, active) {
  const modeles = consigne.modeles ?? [];
  if (consigne.choix !== 'REMPLACER' || !modeles.length) return '';
  // Une fois qu'il a dit lequel il expédie, seul celui-là reste.
  const retenus =
    typeof consigne.modeleChoisi === 'number'
      ? modeles.map((modele, rang) => [modele, rang]).filter(([, rang]) => rang === consigne.modeleChoisi)
      : modeles.map((modele, rang) => [modele, rang]);
  const aChoisir = active && modeles.length > 1;
  return `<div class="csg-modeles">${retenus
    .map(([modele, rang]) => {
      const details = [modele.variantTitle, modele.sku].filter(Boolean).join(' · ');
      const stock =
        typeof modele.inventory === 'number'
          ? t('rup.inStock').replace('{n}', String(modele.inventory))
          : modele.libre
            ? t('rup.offCatalog')
            : '';
      const corps = `${
        modele.image
          ? `<img src="${esc(modele.image)}" alt="" loading="lazy" />`
          : '<span class="csg-vide" aria-hidden="true"></span>'
      }
        <span class="csg-modele-txt"><b>${esc(modele.productTitle)}</b>${
          [details, stock].filter(Boolean).length
            ? `<small>${esc([details, stock].filter(Boolean).join(' · '))}</small>`
            : ''
        }</span>`;
      return aChoisir
        ? `<label class="csg-modele csg-modele-choix"><input type="radio" name="csg-modele-${esc(consigne.id)}" value="${rang}" />${corps}</label>`
        : `<div class="csg-modele">${corps}</div>`;
    })
    .join('')}</div>`;
}

function consigneMarkup(consigne, dossier) {
  const texte = texteDe(consigne);
  const mot = motDe(consigne);
  const active = !consigne.remplaceeLe && !consigne.reponse;
  const traduit = state.lang !== 'fr' && consigne.mot && consigne.motTraduit?.[state.lang];

  const reponse = (() => {
    if (consigne.reponse === 'COMPRIS') {
      const heure = new Date(consigne.reponduLe).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
      return `<p class="csg-ok">${picto('coche')}${esc(t('csg.confirmed', { heure }))}</p>${
        consigne.choix !== 'MESSAGE' && !consigne.remplaceeLe
          ? `<div class="csg-cmd">
               <b>${esc(dossier.orderName ? t('rup.order').replace('{name}', dossier.orderName) : t('rup.noOrder'))}</b>
               <span class="csg-chip csg-chip-${esc(consigne.choix)}">${esc(texte.court)}</span>
             </div>`
          : ''
      }`;
    }
    if (consigne.reponse === 'IMPOSSIBLE' || consigne.reponse === 'REPONDU') {
      return `<div class="csg-moi">
        <b>${esc(t(consigne.reponse === 'IMPOSSIBLE' ? 'csg.cannotBtn' : 'csg.yourReply'))}</b>
        <span>${esc(consigne.reponseNote ?? '')}</span>
        <small>${esc(`${shortMoment(consigne.reponduLe)} · ${t('csg.forMerchant')}`)}</small>
      </div>`;
    }
    return '';
  })();

  return `<article class="csg${active ? ' csg-active' : ''}${consigne.remplaceeLe ? ' csg-remplacee' : ''}" data-csg="${esc(consigne.id)}">
      <div class="csg-qui">
        <span class="csg-av" aria-hidden="true"><svg viewBox="0 0 20 20"><path d="M3.5 8.5V16.5h13V8.5M2.5 8.5l1.6-5h11.8l1.6 5zM8 16.5v-4h4v4" /></svg></span>
        <b>${esc(t('csg.merchant'))}</b>
        <span>${esc(shortMoment(consigne.envoyeeLe))}</span>
        ${consigne.remplaceeLe ? `<span class="pill">${esc(t('csg.replaced'))}</span>` : ''}
      </div>
      <div class="csg-corps">
        <span class="csg-ico csg-ico-${esc(consigne.choix)}" aria-hidden="true"><svg viewBox="0 0 24 24">${
          PICTOS_CONSIGNE[consigne.choix] ?? ''
        }</svg></span>
        <span class="csg-txt">
          <b class="csg-titre">${esc(texte.titre)}</b>
          ${texte.detail ? `<span class="csg-detail">${esc(texte.detail)}</span>` : ''}
        </span>
      </div>
      ${modelesConsigneMarkup(consigne, active)}
      ${mot ? `<p class="csg-mot">${esc(cite(mot))}</p>` : ''}
      ${
        traduit
          ? `<p class="csg-trad">${esc(t('csg.translated'))} · <button type="button" class="csg-lien" data-csg-orig="${esc(
              consigne.id,
            )}" aria-expanded="false">${esc(t('csg.seeOriginal'))}</button></p>
             <div class="csg-orig" lang="fr" hidden>${esc(consigne.mot)}</div>`
          : ''
      }
    </article>
    ${reponse}
    ${
      active
        ? `<div class="csg-acts" data-csg-acts="${esc(consigne.id)}">
             <p>${esc(t(consigne.choix === 'MESSAGE' ? 'csg.waitReply' : 'csg.waitConfirm'))}</p>
             <div class="csg-boutons">${
               consigne.choix === 'MESSAGE'
                 ? `<button class="btn btn-primary" type="button" data-csg-ecrire="REPONDU" data-csg-id="${esc(consigne.id)}">${esc(t('csg.reply'))}</button>`
                 : `<button class="btn" type="button" data-csg-ecrire="IMPOSSIBLE" data-csg-id="${esc(consigne.id)}">${esc(t('csg.cannotBtn'))}</button>
                    <button class="btn btn-primary" type="button" data-csg-ok="${esc(consigne.id)}">${esc(t('csg.ok'))}</button>`
             }</div>
           </div>`
        : ''
    }`;
}

function consignesMarkup(dossier) {
  const consignes = dossier.consignes ?? [];
  if (!consignes.length) return '';
  return `<div class="csg-fil">${consignes.map((consigne) => consigneMarkup(consigne, dossier)).join('')}</div>`;
}

/** Sous la ligne de la liste : ce que le marchand a fait depuis. */
function etatConsigneDe(dossier) {
  const courante = consigneCourante(dossier);
  if (!courante) return '';
  if (!courante.reponse) return t('csg.replied');
  return texteDe(courante).court;
}

async function repondreConsigne(id, reponse, note, bouton) {
  const carte = $('tk-rows').querySelector(`[data-csg-acts="${CSS.escape(id)}"]`);
  let modele = null;
  if (reponse === 'COMPRIS') {
    const choix = $('tk-rows').querySelectorAll(`input[name="csg-modele-${CSS.escape(id)}"]`);
    if (choix.length) {
      const coche = [...choix].find((radio) => radio.checked);
      if (!coche) return toast(t('csg.chooseModel'), true);
      modele = Number(coche.value);
    }
  }
  carte?.querySelectorAll('button').forEach((autre) => {
    autre.disabled = true;
  });
  try {
    await api(`/api/workspace/${supplierId}/consignes/${id}`, {
      method: 'POST',
      body: { reponse, note: note ?? null, modele, langue: state.lang },
    });
    toast(t(reponse === 'COMPRIS' ? 'csg.sentOk' : 'csg.sentNo'));
    await loadTickets();
  } catch (error) {
    carte?.querySelectorAll('button').forEach((autre) => {
      autre.disabled = false;
    });
    toast(messageServeur(error, 'csg.err'), true);
    // La consigne a changé entre-temps : la page relue montre la nouvelle.
    if (error.code === 'deja') await loadTickets();
  }
  bouton?.focus?.();
}

/* La raison d'un refus, ou la réponse à un message : écrite sur place, sous la
   consigne, comme le motif d'un refus de demande. */
function ouvrirRedactionConsigne(bouton) {
  const actes = bouton.closest('.csg-acts');
  const ouvert = actes.querySelector('.upd-raison');
  if (ouvert) {
    ouvert.remove();
    bouton.setAttribute('aria-expanded', 'false');
    return;
  }
  const reponse = bouton.dataset.csgEcrire;
  bouton.setAttribute('aria-expanded', 'true');
  actes.insertAdjacentHTML(
    'beforeend',
    `<form class="upd-raison">
      <label><span>${esc(t(reponse === 'IMPOSSIBLE' ? 'csg.why' : 'csg.yourReply'))}</span>
        <textarea rows="3" maxlength="1000" placeholder="${esc(
          t(reponse === 'IMPOSSIBLE' ? 'csg.whyHint' : 'csg.replyHint'),
        )}"></textarea></label>
      <small class="csg-pour">${esc(t('csg.forMerchant'))}</small>
      <div class="upd-raison-acts">
        <button type="button" class="btn btn-small" data-raison-annuler="1">${esc(t('issue.cancel'))}</button>
        <button type="submit" class="btn btn-small btn-primary">${esc(t('issue.send'))}</button>
      </div>
    </form>`,
  );
  const formulaire = actes.querySelector('.upd-raison');
  const champ = formulaire.querySelector('textarea');
  champ.focus();
  formulaire.querySelector('[data-raison-annuler]').addEventListener('click', () => {
    formulaire.remove();
    bouton.setAttribute('aria-expanded', 'false');
    bouton.focus();
  });
  formulaire.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!champ.value.trim()) {
      toast(t('csg.needText'), true);
      champ.focus();
      return;
    }
    void repondreConsigne(bouton.dataset.csgId, reponse, champ.value.trim(), bouton);
  });
}

function cablerConsignes() {
  const racine = $('tk-rows');
  racine.querySelectorAll('[data-csg-ok]').forEach((bouton) =>
    bouton.addEventListener('click', () => void repondreConsigne(bouton.dataset.csgOk, 'COMPRIS', null, bouton)),
  );
  racine.querySelectorAll('[data-csg-ecrire]').forEach((bouton) =>
    bouton.addEventListener('click', () => ouvrirRedactionConsigne(bouton)),
  );
  racine.querySelectorAll('[data-csg-orig]').forEach((bouton) =>
    bouton.addEventListener('click', () => {
      const original = bouton.closest('.csg').querySelector('.csg-orig');
      original.hidden = !original.hidden;
      bouton.setAttribute('aria-expanded', String(!original.hidden));
      bouton.textContent = t(original.hidden ? 'csg.seeOriginal' : 'csg.hideOriginal');
    }),
  );
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
    bouton.setAttribute('aria-pressed', String(bouton.dataset.mode === state.mode));
  });

  // En masse, la progression, les filtres et la liste s'effacent : ils
  // décrivent la file du guichet, pas l'import.
  for (const id of ['ws-progress', 'cmd-outils', 'ws-orders']) {
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

// « Importer un fichier » ouvre l'import à la place de la file ; un second clic,
// ou la croix de l'import, y ramène.
document.querySelectorAll('#ws-modes [data-mode]').forEach((bouton) =>
  bouton.addEventListener('click', () => setMode(state.mode === 'masse' ? 'manuel' : 'masse')),
);
$('bulk-fermer')?.addEventListener('click', () => setMode('manuel'));

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
  // La consigne courante : la dernière, si elle n'a pas été remplacée.
  const derniere = (dossier.consignes ?? []).at(-1);
  const consigne = derniere && !derniere.remplaceeLe ? derniere : null;
  // La réponse du marchand, pas encore confirmée : c'est à l'atelier.
  if (consigne && !consigne.reponse) return 'A_REPONDRE';
  const propositions = dossier.substitutions ?? [];
  // Un remplacement proposé sans réponse : c'est à l'atelier.
  if (propositions.some((proposition) => !proposition.reponduLe)) return 'A_REPONDRE';
  // Compris : il n'y a plus rien à dire, la consigne est sur la commande.
  if (consigne?.reponse === 'COMPRIS') return 'CLOS';
  // Il ne pourra pas, ou il a répondu : la suite appartient au marchand.
  if (consigne || propositions.length) return 'ATTENTE';
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
      id: `upd:${update.id}`,
      type: `UPD:${update.kind}`,
      libelle: kindLabel(update.kind),
      statut: update.status === 'PENDING' ? 'A_REPONDRE' : 'CLOS',
      date: update.createdAt,
      html: carteUpdate(update),
    });
  }
  for (const demande of ruptures?.demandes ?? []) {
    items.push({
      id: `rup:${demande.id}`,
      type: 'RUPTURE',
      libelle: t('tk.type.rupture'),
      statut: statutRupture(demande, true),
      etat: etatConsigneDe(demande),
      date: demande.envoyeLe,
      html: carteRupture(demande, demande.phase ?? 'cree', demande.envoyeLe, true),
    });
  }
  for (const signalement of signalements?.signalements ?? []) {
    // Ruptures éteintes : leurs signalements aussi.
    if (!avecRuptures && signalement.motif === 'STOCK') continue;
    items.push({
      id: `sig:${signalement.id}`,
      type: 'SIGNAL',
      libelle: `${t('tk.type.signal')} · ${t(`issue.kind.${signalement.motif}`)}`,
      statut: statutRupture(signalement, false),
      etat: etatConsigneDe(signalement),
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
        id: `ech:${echange.id}`,
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
  $('tk-types').innerHTML = `<label class="tk-type-choix">${esc(t('tk.typeLabel'))}
    <select data-ttype-select>${[
      `<option value=""${type ? '' : ' selected'}>${esc(t('tk.allTypes'))}</option>`,
      ...[...types].map(
        ([cle, libelle]) => `<option value="${esc(cle)}"${type === cle ? ' selected' : ''}>${esc(libelle)}</option>`,
      ),
    ].join('')}</select>
  </label>`;

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

  // Sur téléphone, un ticket ouvert prend tout l'écran ; s'il a quitté la
  // liste — on vient d'y répondre —, on revient à la liste.
  const ouvert = enColonnes.matches ? null : visibles.find((item) => item.id === state.tk.ouvert);
  if (!ouvert) state.tk.ouvert = null;
  $('view-tickets').classList.toggle('tk-plein', Boolean(ouvert));

  if (ouvert) {
    $('tk-rows').innerHTML = `<div class="focus-bar">
        <button type="button" class="tk-retour" data-tk-retour="1">${picto('retour')}${esc(t('tk.title'))}</button>
      </div>
      <div class="tk-detail">${enteteDeTicket(ouvert)}${ouvert.html}</div>`;
  } else if (enColonnes.matches && visibles.length) {
    // Le ticket ouvert reste ouvert ; s'il a quitté la liste — on vient d'y
    // répondre —, le suivant prend sa place, comme dans Mail.
    const choisi = visibles.find((item) => item.id === state.tk.choisi) ?? visibles[0];
    state.tk.choisi = choisi.id;
    $('tk-rows').innerHTML = `${alerte}<div class="tk-split">
      <div class="tk-file">${visibles.map((item) => ligneDeTicket(item, item.id === choisi.id)).join('')}</div>
      <div class="tk-detail">${enteteDeTicket(choisi)}${choisi.html}</div>
    </div>`;
  } else {
    // En dessous : la liste seule, et le ticket s'ouvre au toucher.
    $('tk-rows').innerHTML =
      alerte +
      (visibles.length
        ? `<div class="tk-file">${visibles.map((item) => ligneDeTicket(item, false)).join('')}</div>`
        : `<p class="empty">${esc(t(`tk.empty.${statut || 'ALL'}`))}</p>`);
  }

  cablerTickets();
}

/** Une ligne de la liste : le type en couleur, la commande, l'âge. */
function ligneDeTicket(item, courant) {
  const { texte, vieux } = age(item.date);
  const [teinte, nom] = allureDuTicket(item.type);
  return `<button type="button" class="tk-ligne" data-tk="${esc(item.id)}"${courant ? ' aria-current="true"' : ''}>
    <span class="home-ico ${teinte}" aria-hidden="true">${picto(nom)}</span>
    <span class="tk-ligne-txt">
      <span class="tk-ligne-l"><b>${esc(item.libelle)}</b><span class="tk-age${
        vieux && item.statut === 'A_REPONDRE' ? ' tk-vieux' : ''
      }">${esc(texte)}</span></span>
      <span class="tk-ligne-quoi">${esc(resumeDe(item.html))}</span>
      ${item.etat ? `<span class="tk-ligne-etat${item.statut === 'A_REPONDRE' ? ' tk-ligne-etat-neuf' : ''}">${esc(item.etat)}</span>` : ''}
    </span>
  </button>`;
}

/** L'en-tête du ticket ouvert : son type, sa commande, son statut. */
function enteteDeTicket(item) {
  const [teinte, nom] = allureDuTicket(item.type);
  const STATUTS = { A_REPONDRE: 'tk.toAnswer', ATTENTE: 'tk.waiting', CLOS: 'tk.closed' };
  return `<div class="tk-entete">
    <span class="home-ico ${teinte}" aria-hidden="true">${picto(nom)}</span>
    <span class="tk-entete-txt">
      <b>${esc(item.libelle)}</b>
      <span>${esc([resumeDe(item.html), age(item.date).texte].filter(Boolean).join(' · '))}</span>
    </span>
    <span class="tk-statut tk-s-${esc(item.statut)}">${esc(t(STATUTS[item.statut] ?? 'tk.all'))}</span>
  </div>`;
}

/** Les boutons des cartes : mêmes gestes qu'avant, dans la liste unique. */
function cablerTickets() {
  const racine = $('tk-rows');

  racine.querySelectorAll('[data-accept]').forEach((button) =>
    button.addEventListener('click', () => respond(button.dataset.accept, 'ACKNOWLEDGED')),
  );
  racine.querySelectorAll('[data-refuse]').forEach((button) =>
    button.addEventListener('click', () => {
      const carte = button.closest('.upd');
      const ouvert = carte.querySelector('.upd-raison');
      if (ouvert) {
        ouvert.remove();
        button.setAttribute('aria-expanded', 'false');
        return;
      }
      // Le motif s'écrit sur place, sous les boutons : la boîte du navigateur
      // coupait la carte qu'on était en train de lire.
      button.setAttribute('aria-expanded', 'true');
      button.closest('.upd-acts').insertAdjacentHTML(
        'afterend',
        `<form class="upd-raison">
          <label><span>${esc(t('updates.whyLabel'))}</span>
            <textarea rows="3" placeholder="${esc(t('updates.why'))}"></textarea></label>
          <div class="upd-raison-acts">
            <button type="button" class="btn btn-small" data-raison-annuler="1">${esc(t('issue.cancel'))}</button>
            <button type="submit" class="btn btn-small btn-primary">${esc(t('issue.send'))}</button>
          </div>
        </form>`,
      );
      const formulaire = carte.querySelector('.upd-raison');
      const champ = formulaire.querySelector('textarea');
      champ.focus();
      formulaire.querySelector('[data-raison-annuler]').addEventListener('click', () => {
        formulaire.remove();
        button.setAttribute('aria-expanded', 'false');
        button.focus();
      });
      formulaire.addEventListener('submit', (event) => {
        event.preventDefault();
        // Un refus sans motif oblige le marchand à redemander : on exige le mot
        // qui manque, ici et pas dans un second aller-retour.
        if (!champ.value.trim()) {
          toast(t('updates.needWhy'), true);
          champ.focus();
          return;
        }
        void respond(button.dataset.refuse, 'REFUSED', champ.value.trim());
      });
    }),
  );

  cablerSubstitutions();
  cablerConsignes();

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

$('tk-types')?.addEventListener('change', (event) => {
  const menu = event.target.closest('[data-ttype-select]');
  if (!menu) return;
  state.tk.type = menu.value;
  renderTickets();
});

$('tk-rows')?.addEventListener('click', (event) => {
  if (event.target.closest('[data-tk-retour]')) {
    state.tk.ouvert = null;
    renderTickets();
    return;
  }
  const ligne = event.target.closest('[data-tk]');
  if (!ligne) return;
  state.tk.choisi = ligne.dataset.tk;
  if (!enColonnes.matches) {
    state.tk.ouvert = ligne.dataset.tk;
    window.scrollTo(0, 0);
  }
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

/*
 * Les pictogrammes de l'accueil, au trait, en blanc sur leur pastille de
 * couleur : la teinte dit la nature de la demande avant qu'on lise.
 */
const PICTOS = {
  bulle: '<path d="M3.5 4.5h13v9h-8l-5 3.5z" />',
  alerte: '<path d="M10 3 17.5 16.5h-15z" /><path d="M10 8.5v3.5M10 14.3v.2" />',
  echange: '<path d="M5 6.5h11l-2.5-2.5M15 13.5H4l2.5 2.5" />',
  horloge: '<circle cx="10" cy="10" r="6.8" /><path d="M10 6.2V10l2.6 1.7" />',
  modif: '<path d="M4 16l1-3.6L13.2 4.2a1.6 1.6 0 0 1 2.3 0l.3.3a1.6 1.6 0 0 1 0 2.3L7.6 15z" />',
  drapeau: '<path d="M5 17V3.5M5 4h9l-2 3.5 2 3.5H5" />',
  colis: '<path d="M10 2.5 16.5 6v8L10 17.5 3.5 14V6z" /><path d="M3.5 6 10 9.5 16.5 6M10 9.5v8" />',
  fleche: '<path d="m7.5 4.5 5.5 5.5-5.5 5.5" />',
  depot: '<path d="M10 13V3.5M6 7.5l4-4 4 4M3.5 16.5h13" />',
  coche: '<path d="m4.5 10.5 3.5 3.5 7.5-8" />',
  retour: '<path d="m12.5 4 -6 6 6 6" />',
};
const picto = (nom) => `<svg viewBox="0 0 20 20" aria-hidden="true">${PICTOS[nom] ?? ''}</svg>`;

/** La teinte et le pictogramme d'un ticket, d'après son type. */
function allureDuTicket(type) {
  if (type === 'RUPTURE') return ['t-orange', 'alerte'];
  if (type === 'ECHANGE') return ['t-vert', 'echange'];
  if (type === 'SIGNAL') return ['t-violet', 'drapeau'];
  return ['t-bleu', 'modif'];
}

/** « Aujourd'hui », « Hier », sinon le jour en clair. */
function jourDuLot(iso) {
  const date = new Date(iso);
  const hier = new Date();
  hier.setDate(hier.getDate() - 1);
  if (date.toDateString() === new Date().toDateString()) return t('home.today');
  if (date.toDateString() === hier.toDateString()) return t('home.yesterday');
  return date.toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short' });
}

const premiereMajuscule = (texte) => texte.charAt(0).toLocaleUpperCase(locale) + texte.slice(1);

async function loadHome() {
  $('home-date').textContent = premiereMajuscule(
    new Date().toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' }),
  );
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
  const total = parLots ? commandesDesLots.length : (state.orders ?? []).length;
  const expediees = total - aPreparer;
  const enRetard = commandesDesLots.filter((commande) => commande.enRetard).length;
  majCompteCommandes(aPreparer);

  // Les commandes en retard, avant tout le reste.
  $('home-retard').hidden = enRetard === 0;
  $('home-retard').innerHTML = enRetard
    ? `<span class="home-ico t-rouge" aria-hidden="true">${picto('horloge')}</span>
       <span class="home-retard-txt">${esc(t(enRetard > 1 ? 'home.late' : 'home.lateOne', { n: enRetard }))}</span>
       <button type="button" class="home-lien" id="home-retard-voir">${esc(t('home.seeLate'))}</button>`
    : '';
  $('home-retard-voir')?.addEventListener('click', () => {
    if (parLots) state.sous = { ...(state.sous ?? {}), orders: 'lots' };
    setView('orders');
  });

  /*
   * Le travail du jour, en grand : ce qu'il reste, ce qui est parti, et par
   * où commencer. À côté, les modèles à emballer : quinze paires du même
   * article se préparent d'affilée.
   */
  const parModele = new Map();
  for (const order of (state.orders ?? []).filter((candidate) => !orderIsDone(candidate))) {
    const article = order.lineItems?.[0];
    if (!article?.title) continue;
    const deja = parModele.get(article.title) ?? { titre: article.title, image: article.image ?? null, n: 0 };
    deja.n += 1;
    parModele.set(article.title, deja);
  }
  const modeles = [...parModele.values()].sort((a, b) => b.n - a.n).slice(0, 4);
  const plusGros = modeles[0]?.n ?? 1;
  const pct = total ? Math.round((expediees / total) * 100) : 0;

  $('home-hero').innerHTML = `
    <div class="hero-main">
      <span class="hero-titre" id="home-hero-t"><span class="home-ico t-orange" aria-hidden="true">${picto('colis')}</span>${esc(
        t('home.toPrepareTitle'),
      )}</span>
      ${
        aPreparer > 0
          ? `<span class="hero-chiffre"><b>${aPreparer}</b> ${esc(t(aPreparer > 1 ? 'home.orders' : 'home.order'))}</span>`
          : `<span class="hero-fini"><span class="hero-coche" aria-hidden="true">${picto('coche')}</span>${esc(t('home.allShipped'))}</span>`
      }
      ${
        total
          ? `<div class="hero-avance">
              <span class="hero-barre" aria-hidden="true"><i style="width:${pct}%"></i></span>
              <span class="hero-legende"><b>${esc(t('home.progress', { done: expediees, total }))}</b>${
                parLots ? ` · ${esc(t('home.lastLot', { heure: shortMoment(lots[0].envoyeLe) }))}` : ''
              }</span>
            </div>`
          : ''
      }
      <div class="hero-gestes">
        <button type="button" class="btn btn-primary hero-go" id="home-go">${esc(t(aPreparer ? 'home.start' : 'home.seeOrders'))}${picto('fleche')}</button>
        <button type="button" class="btn hero-fichier" id="home-fichier">${picto('depot')}${esc(t('home.bulk'))}</button>
      </div>
    </div>
    ${
      modeles.length
        ? `<div class="hero-modeles">
            <span class="hero-sous">${esc(t('home.models'))}</span>
            ${modeles
              .map(
                (modele) => `<div class="hero-modele">
                  ${
                    modele.image
                      ? `<img class="hero-photo" src="${esc(modele.image)}" alt="" loading="lazy" />`
                      : '<span class="hero-photo" aria-hidden="true"></span>'
                  }
                  <span class="hero-modele-txt">
                    <span class="hero-modele-l"><span>${esc(modele.titre)}</span><b>${modele.n}</b></span>
                    <span class="hero-modele-barre" aria-hidden="true"><i style="width:${Math.round((modele.n / plusGros) * 100)}%"></i></span>
                  </span>
                </div>`,
              )
              .join('')}
          </div>`
        : ''
    }`;
  $('home-go').addEventListener('click', () => {
    state.sous = { ...(state.sous ?? {}), orders: 'orders' };
    setView('orders');
  });
  $('home-fichier').addEventListener('click', () => {
    state.sous = { ...(state.sous ?? {}), orders: 'orders' };
    setView('orders');
    setMode('masse');
  });

  // Ce que le marchand attend, en quatre chiffres : chacun ouvre la liste
  // déjà filtrée. Zéro se lit en gris, sans gras.
  const tuiles = [
    { n: aRepondre, cle: 'home.toAnswer', teinte: 't-rouge', picto: 'bulle', aller: () => ouvrirTickets('A_REPONDRE') },
    {
      n: compte((item) => item.type === 'RUPTURE' && item.statut !== 'CLOS'),
      cle: 'home.ruptures',
      teinte: 't-orange',
      picto: 'alerte',
      aller: () => ouvrirTickets('', 'RUPTURE'),
    },
    {
      n: compte((item) => item.type === 'ECHANGE' && item.statut === 'A_REPONDRE'),
      cle: 'home.exchanges',
      teinte: 't-vert',
      picto: 'echange',
      aller: () => ouvrirTickets('A_REPONDRE', 'ECHANGE'),
    },
    {
      n: compte((item) => item.statut === 'ATTENTE'),
      cle: 'home.waiting',
      teinte: 't-gris',
      picto: 'horloge',
      aller: () => ouvrirTickets('ATTENTE'),
    },
  ];

  $('home-tuiles').innerHTML = tuiles
    .map(
      (tuile, rang) => `<button type="button" class="home-tuile${tuile.n === 0 ? ' home-nul' : ''}" data-tuile="${rang}">
        <span class="home-tuile-haut"><span class="home-ico ${tuile.teinte}" aria-hidden="true">${picto(tuile.picto)}</span><b>${tuile.n}</b></span>
        <span>${esc(t(tuile.cle))}</span>
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
    ? `<div class="home-groupe">${anciennes
        .map((item) => {
          const { texte, vieux } = age(item.date);
          const [teinte, nom] = allureDuTicket(item.type);
          return `<button type="button" class="home-ligne" data-home-type="${esc(item.type)}">
            <span class="home-ico ${teinte}" aria-hidden="true">${picto(nom)}</span>
            <span class="home-ligne-txt">
              <span class="tk-type">${esc(item.libelle)}</span>
              <span class="home-quoi">${esc(resumeDe(item.html))}</span>
            </span>
            <span class="tk-age${vieux ? ' tk-vieux' : ''}">${esc(texte)}</span>
            <span class="home-chevron" aria-hidden="true">${picto('fleche')}</span>
          </button>`;
        })
        .join('')}</div>`
    : `<div class="home-groupe home-rien">
        <span class="hero-coche" aria-hidden="true">${picto('coche')}</span>
        <p>${esc(t('home.allClear'))}</p>
      </div>`;
  $('home-liste')
    .querySelectorAll('[data-home-type]')
    .forEach((ligne) => ligne.addEventListener('click', () => ouvrirTickets('A_REPONDRE', ligne.dataset.homeType)));
  $('home-tous').onclick = () => ouvrirTickets('A_REPONDRE');

  // Les fichiers du marchand, trois au plus : où en est chacun.
  $('home-col-lots').hidden = !parLots;
  $('home-lots').innerHTML = parLots
    ? `<div class="home-groupe">${lots
        .slice(0, 3)
        .map((lot) => {
          const totalLot = lot.commandes.length;
          const fini = lot.compte.A_PREPARER === 0;
          return `<button type="button" class="home-lot" data-home-lot="1">
            <span class="home-lot-l">
              <b>${esc(jourDuLot(lot.envoyeLe))}</b>
              <span class="home-lot-heure">${esc(
                new Date(lot.envoyeLe).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }),
              )}</span>
              ${
                lot.compte.RETARD
                  ? `<span class="pill lot-retard">${esc(t('home.lotLate', { n: lot.compte.RETARD }))}</span>`
                  : fini
                    ? `<span class="pill home-lot-fini">${esc(t('home.lotDone'))}</span>`
                    : ''
              }
            </span>
            <span class="hero-barre" aria-hidden="true"><i style="width:${
              totalLot ? Math.round((lot.compte.EXPEDIEE / totalLot) * 100) : 0
            }%"></i></span>
            <span class="home-lot-resume">${esc(t('lots.summary', { a: lot.compte.A_PREPARER, e: lot.compte.EXPEDIEE }))}</span>
          </button>`;
        })
        .join('')}</div>`
    : '';
  $('home-lots')
    .querySelectorAll('[data-home-lot]')
    .forEach((bouton) =>
      bouton.addEventListener('click', () => {
        state.sous = { ...(state.sous ?? {}), orders: 'lots' };
        setView('orders');
      }),
    );
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
