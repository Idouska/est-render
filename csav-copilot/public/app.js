import { demander, informer } from './alerte.js';

/**
 * Dashboard cSAV Copilot.
 *
 * Page unique servie par l'API : aucune étape de build, aucun second serveur.
 * Tout l'état vient des endpoints `/api/*` ; rien n'est stocké côté client.
 */

const $ = (id) => document.getElementById(id);

/*
 * Les confirmations, en alerte façon Apple plutôt qu'en fenêtre du
 * navigateur. Une question écrite « Titre ?\n\nPrécision » garde sa forme :
 * la première phrase devient le titre en gras, le reste la précision.
 */
function confirmer(message, options = {}) {
  const [titre, ...reste] = String(message).split('\n\n');
  return demander({ titre, texte: reste.join('\n\n'), ...options });
}


const state = {
  me: null,
  filter: '',
  tickets: [],
  currentId: null,
  // Le message affiché a été ouvert par l'outil, au démarrage, et non choisi :
  // sa ligne reste grise tant qu'on n'a pas cliqué.
  ouvertureAuto: false,
  detail: null,
  refund: null,
  suppliers: [],
  editingSupplier: null,
  team: { users: [], me: null },
  pendingCount: 0,
  shops: [],
  allShops: false,
  navQuery: '',
  refreshing: false,
  refreshSilent: false,
  lastRefresh: null,
  queue: emptyQueueFilters(),
  /* Onglet ouvert dans la colonne centrale. Mémorisé le temps de la session :
     un agent qui suit une escalade veut rester sur Fournisseur en passant d'un
     ticket à l'autre, pas y revenir à chaque fois. */
  detailTab: 'thread',
  queueCounts: {},
  queueFolders: {},
  /* Messages cochés dans la file. Un Set et non un tableau : on teste
     l'appartenance à chaque ligne rendue, cinquante fois par rafraîchissement. */
  picked: new Set(),
  /* Tableau ou liste, mémorisé : c'est une habitude de travail, pas un
     réglage qu'on repose chaque matin. */
  queueView: localStorage.getItem('csav.queueView') === 'table' ? 'table' : 'list',
  agents: [],
  canned: [],
  /** Les libellés de la file sont-ils tous dépliés ? Choix d'affichage, pas de filtre. */
  editingCanned: null,
  catalog: { items: [], cursor: null, hasNext: false, q: '', kind: 'products', loading: false, loaded: false, timer: null },
  editingUser: null,
  refundRows: [],
  refundFilter: '',
  settings: null,
  view: 'tickets',
  /* La file a-t-elle répondu au moins une fois ?
     `tickets: []` ne le dit pas : un tableau vide, c'est aussi bien « aucun
     message » que « on n'a pas encore demandé ». Le poste de pilotage tire
     quatre de ses alertes de ce tableau ; sans ce drapeau, il annonce
     « 0 SLA dépassé » avant même d'avoir regardé. */
  queueLoaded: false,
  orders: {
    items: [], cursor: null, hasNext: false, q: '', loading: false, loaded: false, timer: null,
    // L'onglet (Toutes, À expédier…), la commande ouverte dans la fiche, et
    // les comptes des onglets — périmés dès qu'une réponse plus récente arrive.
    sort: 'recent', vue: 'toutes', choisie: null, counts: null, seqCounts: 0, seqFiche: 0,
  },
  customers: { items: [], cursor: null, hasNext: false, q: '', loading: false, loaded: false, timer: null },
};

/* ------------------------------------------------------------------ outils */

const euro = (amount, currency = 'EUR') =>
  Number(amount).toLocaleString('fr-FR', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
  });

function relativeTime(iso) {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return "à l'instant";
  if (minutes < 60) return `il y a ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `il y a ${hours} h`;
  const days = Math.round(hours / 24);
  return days === 1 ? 'hier' : `il y a ${days} j`;
}

function shortTime(iso) {
  return new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

function fullDate(iso) {
  return new Date(iso).toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

/** Date + heure : sur les commandes, l'heure sert à trancher les litiges. */
function dateTime(iso) {
  if (!iso) return '';
  return `${fullDate(iso)} à ${shortTime(iso)}`;
}

/*
 * « Aujourd'hui à 11:11 » plutôt que « 8 septembre 2026 à 11:11 ».
 *
 * Dans une liste qu'on parcourt le matin, la date du jour n'apporte rien :
 * on sait quel jour on est. Ce qu'on cherche, c'est ce qui vient d'arriver —
 * et « aujourd'hui » se repère d'un coup d'œil là où la date pleine se lit.
 * Hier reçoit le même traitement ; au-delà, la date reprend ses droits, parce
 * que « il y a 3 jours » oblige à calculer.
 */
function dayOrDateTime(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  const today = new Date();
  const sameDay = (a, b) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);

  if (sameDay(date, today)) return `Aujourd’hui à ${shortTime(iso)}`;
  if (sameDay(date, yesterday)) return `Hier à ${shortTime(iso)}`;
  return dateTime(iso);
}

/** Échappe le texte avant insertion : les mails viennent de l'extérieur. */
function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function toast(message, isError = false, duree = 4000) {
  const el = $('toast');
  el.textContent = message;
  el.classList.toggle('error', isError);
  el.classList.add('show');
  clearTimeout(el._timer);
  el._timer = setTimeout(() => el.classList.remove('show'), duree);
}

/* ------------------------------------------------------------- bulles --- */

/*
 * Les bulles de notification, comme sur un Mac.
 *
 * Un nouveau message, une réponse de l'atelier, un signalement : une petite
 * carte arrive en haut à droite, en fondu, et s'efface seule au bout de cinq
 * secondes. Le survol la retient ; une croix la ferme ; un clic ouvre ce
 * qu'elle annonce. Plusieurs nouvelles à la fois se rangent en pile, sous
 * une seule carte — dix bulles empilées ne se liraient plus.
 *
 * Le toast reste pour ce qui répond à un geste (« Réponse envoyée ») : la
 * bulle, elle, annonce ce qui arrive sans qu'on l'ait demandé.
 */
const BULLE_DUREE_MS = 5000;
const bulleNotif = document.createElement('div');
bulleNotif.className = 'notif';
bulleNotif.id = 'notif';
bulleNotif.setAttribute('role', 'status');
bulleNotif.setAttribute('aria-live', 'polite');
bulleNotif.hidden = true;
document.body.append(bulleNotif);
let notifEnCours = [];
let notifMinuteur = null;
let notifEffacement = null;

const SYMBOLE_CAMION =
  'M2.5 6h11v10h-11zM13.5 9.5h4l3 3.5V16h-7M6.5 19a2 2 0 1 0 0-4a2 2 0 1 0 0 4M17 19a2 2 0 1 0 0-4a2 2 0 1 0 0 4';

function nePasDeranger() {
  try {
    return localStorage.getItem('csav.dnd') === '1';
  } catch {
    return false;
  }
}

/**
 * Annonce une nouvelle. `annonce` : { genre ('message' | 'atelier'),
 * initiales | symbole, titre, ligne, apercu, ouvrir }.
 */
function annoncer(annonce) {
  // « Ne pas déranger », allumé depuis le Centre de contrôle : rien ne s'affiche.
  if (nePasDeranger()) return;
  notifEnCours = [...notifEnCours, annonce].slice(-20);
  dessinerNotif();
  clearTimeout(notifEffacement);
  bulleNotif.hidden = false;
  requestAnimationFrame(() => bulleNotif.classList.add('notif-visible'));
  clearTimeout(notifMinuteur);
  notifMinuteur = setTimeout(fermerNotif, BULLE_DUREE_MS);
}

function fermerNotif() {
  clearTimeout(notifMinuteur);
  bulleNotif.classList.remove('notif-visible');
  // La sortie est plus douce que l'entrée : on laisse au fondu le temps de finir.
  notifEffacement = setTimeout(() => {
    bulleNotif.hidden = true;
    notifEnCours = [];
  }, 500);
}

/** La carte affichée : la nouvelle seule, ou la pile qui les résume. */
function carteNotif() {
  if (notifEnCours.length === 1) return notifEnCours[0];
  const n = notifEnCours.length;
  const messages = notifEnCours.every((a) => a.genre === 'message');
  const noms = [...new Set(notifEnCours.map((a) => a.titre))];
  const autres = noms.length - 2;
  return {
    genre: messages ? 'message' : 'pile',
    initiales: String(n),
    titre: messages ? `${n} nouveaux messages` : `${n} nouveautés`,
    ligne: autres > 0 ? `${noms.slice(0, 2).join(', ')} et ${autres} autre${autres > 1 ? 's' : ''}` : noms.join(' et '),
    apercu: messages ? 'Ils attendent dans la Réception.' : '',
    ouvrir: messages ? () => setView('tickets') : notifEnCours[0].ouvrir,
  };
}

function dessinerNotif() {
  const a = carteNotif();
  bulleNotif.classList.toggle('notif-pile', notifEnCours.length > 1);
  bulleNotif.innerHTML = `
    <button class="notif-fermer" type="button" aria-label="Fermer la notification">
      <svg viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.8"
        stroke-linecap="round" aria-hidden="true"><path d="M2 2l6 6M8 2 2 8" /></svg>
    </button>
    <button class="notif-carte" type="button">
      <span class="notif-avatar notif-${a.genre}" aria-hidden="true">${
        a.symbole
          ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
              stroke-linecap="round" stroke-linejoin="round"><path d="${a.symbole}" /></svg>`
          : esc(a.initiales)
      }<img class="notif-app" src="/static/logo.svg" alt="" width="17" height="17" /></span>
      <span class="notif-txt">
        <span class="notif-tete"><b>${esc(a.titre)}</b><span>maintenant</span></span>
        <span class="notif-ligne">${esc(a.ligne)}</span>
        ${a.apercu ? `<span class="notif-apercu">${esc(a.apercu)}</span>` : ''}
      </span>
    </button>`;
  bulleNotif.querySelector('.notif-fermer').addEventListener('click', fermerNotif);
  bulleNotif.querySelector('.notif-carte').addEventListener('click', () => {
    fermerNotif();
    a.ouvrir?.();
  });
}

// Le survol retient la bulle ; en partant, on lui laisse deux secondes et demie.
bulleNotif.addEventListener('mouseenter', () => clearTimeout(notifMinuteur));
bulleNotif.addEventListener('mouseleave', () => {
  if (bulleNotif.hidden) return;
  clearTimeout(notifMinuteur);
  notifMinuteur = setTimeout(fermerNotif, 2500);
});

/*
 * Ce qui est nouveau, et ce qui ne l'est pas.
 *
 * On retient, pour chaque message vu, l'extrait de son dernier mail REÇU.
 * S'il change, le client a écrit : c'est une arrivée. Notre propre réponse
 * ne change pas cet extrait — on ne s'annonce pas ce qu'on vient d'envoyer.
 * Un message déjà lu, ou qui dort depuis plus d'un quart d'heure, n'est pas
 * une arrivée : il a seulement glissé dans la liste.
 *
 * Le tout premier passage ne fait que mémoriser : au chargement, rien n'est
 * « nouveau », tout était déjà là.
 */
const extraitsVus = new Map();
let arriveesAmorcees = false;
let dernierSignalementAnnonce = 0;

function guetterArrivees(tickets, { annoncerArrivees = true } = {}) {
  const nouveaux = [];
  for (const ticket of tickets) {
    const extrait = ticket.messages?.[0]?.snippet ?? '';
    const avant = extraitsVus.get(ticket.id);
    extraitsVus.set(ticket.id, extrait);
    if (!arriveesAmorcees || !annoncerArrivees || avant === extrait) continue;
    if (estLu(ticket)) continue;
    if (Date.now() - new Date(ticket.lastMessageAt).getTime() > 15 * 60_000) continue;
    nouveaux.push(ticket);
  }
  arriveesAmorcees = true;
  // Les plus anciens d'abord : la carte du dessus est la dernière arrivée.
  for (const ticket of nouveaux.slice(0, 6).reverse()) annoncer(annonceDuTicket(ticket));
}

function annonceDuTicket(ticket) {
  const nom = ticket.customerName ?? ticket.customerEmail ?? 'Client';
  const ouvrir = () => {
    setView('tickets');
    void selectTicket(ticket.id);
  };
  if (ticket.signalement) {
    dernierSignalementAnnonce = Date.now();
    return { genre: 'atelier', symbole: SYMBOLE_CAMION, titre: nom, ligne: ticketTitle(ticket), apercu: ticket.messages?.[0]?.snippet ?? '', ouvrir };
  }
  return {
    genre: 'message',
    initiales: initials(nom),
    titre: nom,
    ligne: `Nouveau message · ${ticketTitle(ticket)}`,
    apercu: ticket.messages?.[0]?.snippet ?? '',
    ouvrir,
  };
}

/** Ce que l'atelier a rendu depuis le dernier tour : réponses et signalements. */
function guetterAtelier(avant, apres) {
  if (!avant || !apres) return;
  const reponses = (apres.answered ?? 0) + (apres.changes ?? 0) - ((avant.answered ?? 0) + (avant.changes ?? 0));
  if (reponses > 0) {
    annoncer({
      genre: 'atelier',
      symbole: SYMBOLE_CAMION,
      titre: 'Atelier',
      ligne: reponses > 1 ? `${reponses} réponses de l’atelier` : 'Réponse de l’atelier',
      apercu: 'À reprendre sur la page Fournisseur.',
      ouvrir: () => setView('suppliers'),
    });
  }
  // Un signalement déjà annoncé avec son détail, par la file, ne se répète pas.
  const signalements = (apres.issues ?? 0) - (avant.issues ?? 0);
  if (signalements > 0 && Date.now() - dernierSignalementAnnonce > 120_000) {
    annoncer({
      genre: 'atelier',
      symbole: SYMBOLE_CAMION,
      titre: 'Atelier',
      ligne: signalements > 1 ? `${signalements} signalements de l’atelier` : 'Signalement de l’atelier',
      apercu: 'Un colis attend sur une table : voyez la page Fournisseur.',
      ouvrir: () => setView('suppliers'),
    });
  }
}

class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: 'same-origin',
    headers: options.body ? { 'Content-Type': 'application/json' } : {},
    ...options,
  });

  if (response.status === 401) {
    showGate('Votre session a expiré ou n’a jamais été ouverte.');
    throw new ApiError('non authentifié', 401);
  }

  const payload = response.status === 204 ? null : await response.json().catch(() => null);

  if (!response.ok) {
    throw new ApiError(payload?.error ?? `Erreur ${response.status}`, response.status);
  }

  return payload;
}

/** Domaine de la dernière boutique ouverte sur cet appareil. */
function installUrlFor(shopDomain) {
  return `/auth/shopify?shop=${encodeURIComponent(shopDomain)}`;
}

async function showGate(message) {
  $('gate-text').textContent = message;
  $('gate').hidden = false;
  $('app').hidden = true;

  // En production, le raccourci de développement n'existe pas : on renvoie
  // vers l'installation Shopify plutôt que vers un lien mort.
  let devMode = false;
  try {
    const config = await fetch('/api/config').then((r) => r.json());
    state.build = config;
    devMode = Boolean(config.devMode);
  } catch {
    devMode = false;
  }

  $('gate-dev').hidden = !devMode;
  $('gate-prod').hidden = devMode;

  // La session est un cookie propre à chaque navigateur : ouvrir le dashboard
  // sur un téléphone tombe forcément ici la première fois. Demander de
  // composer une URL à la main à ce moment-là est le pire moment pour le faire,
  // donc on retient le domaine et on propose un bouton.
  const known = localStorage.getItem('csav.shop');

  if (!devMode && known) {
    $('gate-login').href = installUrlFor(known);
    $('gate-login').textContent = `Se reconnecter à ${known.replace('.myshopify.com', '')}`;
    $('gate-login').hidden = false;
    $('gate-form').hidden = true;
  } else if (!devMode) {
    $('gate-login').hidden = true;
    $('gate-form').hidden = false;
  } else {
    $('gate-login').hidden = true;
    $('gate-form').hidden = true;
  }
}

$('gate-form').addEventListener('submit', (event) => {
  event.preventDefault();

  const raw = $('gate-shop')
    .value.trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '');
  if (!raw) return;

  location.href = installUrlFor(raw.endsWith('.myshopify.com') ? raw : `${raw}.myshopify.com`);
});

/* ------------------------------------------------------------- barre haute */

/**
 * Navigation repliée en rail d'icônes.
 *
 * Deux cent quarante-huit pixels de barre permanente, c'est une colonne de
 * tickets en moins sur un portable. Repliée, la navigation garde ses icônes et
 * rend la largeur au travail ; le choix est mémorisé, parce qu'on ne le refait
 * pas dix fois par jour.
 */
function applySideFold() {
  const folded = localStorage.getItem('csav.side') === 'folded';
  document.getElementById('app-grid')?.classList.toggle('folded', folded);
  const button = document.getElementById('side-fold');
  if (button) {
    button.setAttribute('aria-pressed', String(folded));
    // Pas de `title` : la bulle de la colonne dit déjà le nom du bouton, et
    // l'infobulle du navigateur viendrait s'y superposer une seconde après.
    button.removeAttribute('title');
    button.setAttribute('aria-label', folded ? 'Déplier la navigation' : 'Replier la navigation');
  }
}

document.getElementById('side-fold')?.addEventListener('click', () => {
  const folded = localStorage.getItem('csav.side') === 'folded';
  localStorage.setItem('csav.side', folded ? 'open' : 'folded');
  applySideFold();
  cacherBulleSide();
});

/*
 * Repliée, la navigation ne montre plus que des icônes, et une icône seule ne
 * dit pas toujours où elle mène. Au survol, chacune donne son nom dans une
 * bulle à sa droite, comme la barre latérale de Finder ou le Dock.
 *
 * Une seule bulle, posée sur `body` : la colonne repliée coupe ce qui dépasse
 * (`overflow: hidden`), une bulle dessinée dans le bouton y resterait cachée.
 * La première attend un instant — un passage de souris n'est pas une
 * question ; tant qu'une bulle est ouverte, la suivante vient sans attendre,
 * pour qu'on puisse descendre la colonne en lisant.
 */
const BULLE_SIDE_CIBLES = '.nav-item, #shop-switch, #side-fold, #compte-btn';
const bulleSide = document.createElement('div');
bulleSide.className = 'side-bulle';
bulleSide.id = 'side-bulle';
bulleSide.setAttribute('role', 'tooltip');
bulleSide.hidden = true;
document.body.append(bulleSide);
let bulleSideMinuteur = null;
let bulleSideOuverteJusqua = 0;
let bulleSideCible = null;
let bulleSideAttendue = null;

function nomDansLaBulle(cible) {
  if (cible.classList.contains('nav-item')) {
    const nom = cible.querySelector('.nav-label')?.textContent ?? '';
    const compte = cible.querySelector('.tally')?.textContent;
    return compte ? `${nom} · ${compte}` : nom;
  }
  if (cible.id === 'shop-switch') return $('merchant-name')?.textContent ?? '';
  if (cible.id === 'compte-btn') return $('me-name')?.textContent ?? '';
  return cible.getAttribute('aria-label') ?? '';
}

function montrerBulleSide(cible) {
  const texte = nomDansLaBulle(cible).trim();
  if (!texte) return;
  bulleSideCible = cible;
  bulleSide.textContent = texte;
  bulleSide.hidden = false;
  const zone = cible.getBoundingClientRect();
  bulleSide.style.top = `${Math.round(zone.top + zone.height / 2)}px`;
  bulleSide.style.left = `${Math.round(zone.right + 10)}px`;
  cible.setAttribute('aria-describedby', 'side-bulle');
  requestAnimationFrame(() => bulleSide.classList.add('side-bulle-visible'));
}

function cacherBulleSide() {
  clearTimeout(bulleSideMinuteur);
  bulleSideAttendue = null;
  if (bulleSide.hidden) return;
  bulleSideOuverteJusqua = Date.now() + 300;
  bulleSideCible?.removeAttribute('aria-describedby');
  bulleSideCible = null;
  bulleSide.classList.remove('side-bulle-visible');
  bulleSide.hidden = true;
}

function proposerBulleSide(cible, { attendre = true } = {}) {
  // Dépliée, chaque bouton porte déjà son nom : seul « Replier » reste muet.
  const repliee = $('app-grid')?.classList.contains('folded');
  if (!cible || (!repliee && cible.id !== 'side-fold')) return cacherBulleSide();
  if (cible === bulleSideCible || cible === bulleSideAttendue) return;
  const deja = !bulleSide.hidden || Date.now() < bulleSideOuverteJusqua;
  cacherBulleSide();
  if (!attendre || deja) return montrerBulleSide(cible);
  bulleSideAttendue = cible;
  bulleSideMinuteur = setTimeout(() => {
    bulleSideAttendue = null;
    montrerBulleSide(cible);
  }, 450);
}

{
  const colonne = document.querySelector('.side');
  colonne?.addEventListener('pointerover', (event) => {
    if (event.pointerType === 'touch') return;
    proposerBulleSide(event.target.closest(BULLE_SIDE_CIBLES));
  });
  colonne?.addEventListener('pointerleave', cacherBulleSide);
  colonne?.addEventListener('focusin', (event) => {
    if (event.target.matches(':focus-visible')) proposerBulleSide(event.target.closest(BULLE_SIDE_CIBLES), { attendre: false });
  });
  colonne?.addEventListener('focusout', cacherBulleSide);
  colonne?.addEventListener('pointerdown', cacherBulleSide);
  colonne?.addEventListener('scroll', cacherBulleSide, { passive: true });
}

/*
 * La recherche, au milieu de la barre du haut.
 *
 * La grille réserve à gauche la largeur de la zone de droite (les heures et
 * les boutons) : la recherche tombe pile au centre. Une grille ne sait pas
 * égaler deux colonnes de contenus différents ; on mesure donc la droite, et
 * on n'impose la symétrie que si la recherche garde au moins 220 px — sinon,
 * mieux vaut une recherche décalée qu'un champ trop étroit pour être lu.
 */
let centrageEnAttente = false;

function centrerRecherche() {
  centrageEnAttente = false;
  const tete = document.querySelector('.head');
  const droite = tete?.querySelector('.head-droite');
  if (!tete || !droite) return;
  if (innerWidth <= 1000) {
    tete.style.removeProperty('--cote');
    return;
  }
  const largeurAvant = droite.style.width;
  droite.style.width = 'max-content';
  const cote = Math.ceil(droite.getBoundingClientRect().width);
  droite.style.width = largeurAvant;
  const place = tete.clientWidth - 2 * 16 - 2 * cote;
  if (place >= 220) tete.style.setProperty('--cote', `${cote}px`);
  else tete.style.removeProperty('--cote');
}

function demanderCentrage() {
  if (centrageEnAttente) return;
  centrageEnAttente = true;
  requestAnimationFrame(centrerRecherche);
}

addEventListener('resize', demanderCentrage);
{
  const droite = document.querySelector('.head-droite');
  // Les heures, les pastilles ou la lune qui changent changent la largeur.
  if (droite) {
    new MutationObserver(demanderCentrage).observe(droite, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['hidden', 'class'],
    });
  }
  // La colonne qu'on replie ou déplie change la largeur de la barre.
  const grille = $('app-grid');
  if (grille) new MutationObserver(demanderCentrage).observe(grille, { attributes: true, attributeFilter: ['class'] });
  demanderCentrage();
}

/*
 * Le compte, en pied de colonne.
 *
 * Un clic ouvre son menu : l'actualisation automatique, les réglages, la
 * déconnexion — ce qu'on touche une fois par jour, rangé hors de la barre du
 * haut. Il se ferme au clic à côté, à Échap, et après un choix.
 */
function ouvrirCompte(ouvrir) {
  const menu = $('compte-menu');
  const bouton = $('compte-btn');
  if (!menu || !bouton) return;
  menu.hidden = !ouvrir;
  bouton.setAttribute('aria-expanded', String(ouvrir));
  if (!ouvrir) return;
  cacherBulleSide();
  // Repliée, la colonne coupe ce qui dépasse : le menu se pose à sa droite.
  const repliee = $('app-grid')?.classList.contains('folded') && innerWidth > 1080;
  const zone = bouton.getBoundingClientRect();
  menu.style.left = repliee ? `${Math.round(zone.right + 8)}px` : '';
  menu.style.bottom = repliee ? `${Math.round(innerHeight - zone.bottom)}px` : '';
}

$('compte-btn')?.addEventListener('click', (event) => {
  event.stopPropagation();
  ouvrirCompte($('compte-menu').hidden);
});

$('compte-menu')?.addEventListener('click', (event) => {
  const vue = event.target.closest('[data-compte-vue]')?.dataset.compteVue;
  if (vue) {
    ouvrirCompte(false);
    setView(vue);
  }
});

document.addEventListener('click', (event) => {
  if ($('compte-menu')?.hidden || event.target.closest('#compte')) return;
  ouvrirCompte(false);
});

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape' || $('compte-menu')?.hidden) return;
  ouvrirCompte(false);
  $('compte-btn')?.focus();
});

/*
 * Le Centre de contrôle, comme sur le Mac.
 *
 * Une icône au bout de la barre du haut ouvre des tuiles : Shopify et Gmail
 * (branché ou en panne, comme la tuile Wi-Fi), l'envoi automatique, la
 * journée en un coup d'œil, clair ou sombre, Actualiser, « Ne pas déranger »
 * (qui coupe les bulles), l'actualisation automatique, le mode test. Ces
 * réglages étaient éparpillés entre le menu du compte, les Réglages et
 * Apparence ; on les touche plusieurs fois par jour.
 *
 * Les tuiles relisent l'état à chaque ouverture : un réglage changé ailleurs
 * — dans les Réglages, par un collègue — s'y voit sans recharger.
 */
function ouvrirCentre(ouvrir) {
  const panneau = $('cc');
  if (!panneau) return;
  panneau.hidden = !ouvrir;
  $('cc-btn')?.setAttribute('aria-expanded', String(ouvrir));
  if (!ouvrir) return;
  ouvrirCompte(false);
  if ($('clockpop')) $('clockpop').hidden = true;
  rendreCentre();
}

function tuile(id, allumee, sous, { alerte = false, interdite = false } = {}) {
  const el = $(id);
  if (!el) return;
  el.classList.toggle('cc-on', allumee);
  el.classList.toggle('cc-alerte', alerte);
  if (el.hasAttribute('aria-pressed')) el.setAttribute('aria-pressed', String(allumee));
  if (interdite) el.setAttribute('aria-disabled', 'true');
  else el.removeAttribute('aria-disabled');
  const ligne = $(`${id}-sous`);
  if (ligne) ligne.textContent = sous;
}

function rendreCentre() {
  const me = state.me;
  if (!me) return;
  const reglable = canI('configure');

  // Les vrais logos de Shopify et Gmail, comme les pastilles de connexion.
  for (const [id, nom] of [['cc-shopify', 'shopify'], ['cc-gmail', 'gmail']]) {
    const rond = $(id)?.querySelector('.cc-rond');
    if (rond && !rond.firstChild) rond.innerHTML = marque(nom);
  }

  const boutique = (me.merchant?.shopDomain ?? '').replace('.myshopify.com', '');
  tuile(
    'cc-shopify',
    Boolean(me.shopify?.connected || me.shopify?.simulated),
    me.shopify?.simulated ? 'Simulé' : me.shopify?.connected ? `${boutique} · branché` : 'Non connecté',
    { alerte: !me.shopify?.connected && !me.shopify?.simulated },
  );
  tuile(
    'cc-gmail',
    Boolean(me.gmail?.connected && me.gmail?.watchActive),
    me.gmail?.connected
      ? `${me.gmail.emailAddress}${me.gmail.watchActive ? '' : ' · écoute inactive'}`
      : 'Non connecté',
    { alerte: !me.gmail?.connected || !me.gmail?.watchActive },
  );
  tuile('cc-envoi', Boolean(me.merchant?.autoSendEnabled), me.merchant?.autoSendEnabled ? 'Activé' : 'Désactivé', {
    interdite: !reglable,
  });

  const metriques = state.metrics ?? {};
  $('cc-jour-n').textContent = String(state.pendingCount ?? '—');
  $('cc-jour-n').classList.toggle('cc-jour-calme', !state.pendingCount);
  const brouillons = metriques.tickets?.DRAFT_READY ?? 0;
  $('cc-jour-brouillons').textContent = `${brouillons} brouillon${brouillons > 1 ? 's' : ''} prêt${brouillons > 1 ? 's' : ''}`;
  $('cc-jour-delai').textContent = `1re réponse · ${formatDelay(metriques.firstReplySeconds)}`;

  const sombre = document.documentElement.getAttribute('data-theme') === 'dark';
  const apparence = sombre ? 'Passer en clair' : 'Passer en sombre';
  $('cc-apparence').setAttribute('aria-label', apparence);
  $('cc-apparence').setAttribute('aria-pressed', String(sombre));
  $('cc-apparence').title = apparence;

  tuile('cc-dnd', nePasDeranger(), nePasDeranger() ? 'Oui · bulles coupées' : 'Non');
  const auto = $('auto-refresh').checked;
  $('cc-actu-sous').textContent = auto ? 'Auto · 20 s' : 'À la main';
  $('auto-refresh').closest('.cc-tuile')?.classList.toggle('cc-on', auto);
  tuile('cc-test', Boolean(me.merchant?.testMode), me.merchant?.testMode ? 'Rien ne sort' : 'Non', {
    interdite: !reglable,
  });
}

function rendreLune() {
  const lune = $('head-lune');
  if (lune) lune.hidden = !nePasDeranger();
}

/** Un réglage du marchand, basculé d'une tuile — le même chemin que les Réglages. */
async function basculerReglage(cle, actif, message) {
  if (!canI('configure')) {
    toast('Seul un propriétaire ou un administrateur peut changer ce réglage.', true);
    return false;
  }
  try {
    await api('/api/settings', { method: 'PATCH', body: JSON.stringify({ [cle]: actif }) });
    state.me.merchant[cle] = actif;
    toast(message);
    return true;
  } catch (error) {
    toast(error.message, true);
    return false;
  }
}

$('cc-btn')?.addEventListener('click', (event) => {
  event.stopPropagation();
  ouvrirCentre($('cc').hidden);
});

for (const id of ['cc-shopify', 'cc-gmail']) {
  $(id)?.addEventListener('click', () => {
    ouvrirCentre(false);
    setView('settings');
    document.querySelector('[data-reg="connexions"]')?.click();
  });
}

/*
 * Au retour de Google.
 *
 * Le serveur ramène ici avec la raison d'un refus ou d'un échec, au lieu de
 * la page noire de JSON brut qu'il affichait. Un échec ouvre Réglages ›
 * Connexions, où se trouve le bouton pour recommencer, et dit quoi faire. Le
 * paramètre quitte l'adresse aussitôt lu : recharger la page ne doit pas
 * répéter le message.
 */
const RETOURS_GMAIL = {
  connecte: ['Gmail est connecté.', false],
  /* Le bouton s'appelle « Connecter Gmail », « Ajouter une boîte » ou
     « reconnectez cette boîte » selon les boîtes déjà là : le message ne
     nomme donc pas de bouton. Une adresse Google Workspace peut aussi être
     bloquée par son administrateur, qui doit approuver l'application. */
  refuse: [
    'Google a refusé la connexion : l’autorisation a été annulée ou bloquée sur sa page. ' +
      'Recommencez et acceptez toutes les autorisations. Pour une adresse Google Workspace, ' +
      'l’administrateur du domaine doit d’abord approuver l’application.',
    true,
  ],
  etat: [
    'La page de Google est restée ouverte trop longtemps. Recommencez la connexion de la boîte.',
    true,
  ],
  jeton: [
    'Google n’a pas donné d’accès durable. Retirez l’accès de l’outil dans votre compte Google ' +
      '(Sécurité › Applications tierces), puis reconnectez Gmail.',
    true,
  ],
  echec: ['La connexion à Gmail a échoué. Réessayez dans un instant.', true],
};

function retourGmail() {
  const adresse = new URL(location.href);
  const raison = adresse.searchParams.get('gmail');
  if (!raison) return;

  adresse.searchParams.delete('gmail');
  history.replaceState(null, '', `${adresse.pathname}${adresse.search}${adresse.hash}`);

  const [message, echec] = RETOURS_GMAIL[raison] ?? RETOURS_GMAIL.echec;
  if (echec) {
    setView('settings');
    document.querySelector('[data-reg="connexions"]')?.click();
  }
  toast(message, echec, echec ? 10_000 : 4000);
}

$('cc-envoi')?.addEventListener('click', async () => {
  const actif = !state.me?.merchant?.autoSendEnabled;
  if (!(await basculerReglage('autoSendEnabled', actif, actif ? 'Envoi automatique activé.' : 'Envoi automatique coupé.'))) return;
  if ($('set-autosend')) $('set-autosend').checked = actif;
  renderMe();
  rendreCentre();
});

$('cc-jour')?.addEventListener('click', () => {
  ouvrirCentre(false);
  setView('tickets');
});

/*
 * Clair ou sombre, d'un geste.
 *
 * La tuile cliquait le bouton des Réglages — qui n'est câblé qu'une fois
 * l'écran Réglages ouvert : avant cela, rien ne se passait, et ce clic,
 * parti d'en dehors du panneau, le refermait au passage. Elle écrit
 * maintenant la préférence elle-même. On inverse ce qu'on voit : en mode
 * « Système », c'est l'apparence affichée qu'on veut changer.
 */
function basculerTheme() {
  const sombre = document.documentElement.getAttribute('data-theme') === 'dark';
  try {
    localStorage.setItem('csav.theme', sombre ? 'light' : 'dark');
  } catch {
    // Sans stockage, le choix vaut pour la page ouverte.
  }
  applyAppearance();
  if (state.view === 'settings') renderPalettes();
}

$('cc-apparence')?.addEventListener('click', () => {
  basculerTheme();
  rendreCentre();
});

$('cc-actualiser')?.addEventListener('click', async () => {
  const bouton = $('cc-actualiser');
  if (bouton.classList.contains('cc-tourne')) return;
  bouton.classList.add('cc-tourne');
  changesCountAt = 0;
  try {
    // Au moins un tour complet : une mise à jour trop rapide passait pour un
    // bouton qui ne fait rien.
    await Promise.all([refreshCurrent(), refreshChangesCount(), new Promise((fin) => setTimeout(fin, 800))]);
    toast('Tout est à jour.');
  } finally {
    bouton.classList.remove('cc-tourne');
    rendreCentre();
  }
});

$('cc-dnd')?.addEventListener('click', () => {
  const actif = !nePasDeranger();
  try {
    localStorage.setItem('csav.dnd', actif ? '1' : '0');
  } catch {
    // Sans stockage, le réglage ne survit pas au rechargement : tant pis.
  }
  if (actif) fermerNotif();
  rendreLune();
  rendreCentre();
});

$('auto-refresh')?.addEventListener('change', () => rendreCentre());

$('cc-test')?.addEventListener('click', async () => {
  const actif = !state.me?.merchant?.testMode;
  const message = actif
    ? 'Mode test activé : rien ne sortira.'
    : 'Mode test désactivé : les actions sont de nouveau réelles.';
  if (!(await basculerReglage('testMode', actif, message))) return;
  $('test-notice').hidden = !actif;
  if ($('set-testmode')) $('set-testmode').checked = actif;
  if ($('reg-test-pastille')) $('reg-test-pastille').hidden = !actif;
  rendreCentre();
});

$('cc-reglages')?.addEventListener('click', () => {
  ouvrirCentre(false);
  setView('settings');
});

document.addEventListener('click', (event) => {
  if ($('cc')?.hidden || event.target.closest('#cc, #cc-btn')) return;
  ouvrirCentre(false);
});

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape' || $('cc')?.hidden) return;
  ouvrirCentre(false);
  $('cc-btn')?.focus();
});

rendreLune();

applySideFold();

/**
 * Couleurs des libellés, telles que Gmail les connaît.
 *
 * Chargées une fois : elles ne changent qu'au rythme où l'on repeint ses
 * étiquettes, alors que la file se recharge toutes les minutes.
 */
let labelStyles = {};

async function loadLabelStyles() {
  try {
    const data = await api('/api/labels');
    labelStyles = data.labels ?? {};
    renderFiltres();
    renderJetons();
  } catch {
    // Sans couleurs, les étiquettes restent grises : lisibles, simplement
    // moins reconnaissables.
    labelStyles = {};
  }
}

/**
 * Étiquette d'un libellé, peinte comme dans Gmail.
 *
 * Un libellé imbriqué — « Administratif/Factures » — n'affiche que sa feuille :
 * le chemin complet triple la largeur de la puce pour redire un classement que
 * l'agent connaît déjà. Le chemin reste dans l'infobulle.
 */
function labelChip(name) {
  const style = labelStyles[name];
  const leaf = name.includes('/') ? name.slice(name.lastIndexOf('/') + 1) : name;

  const paint = style?.background
    ? ` style="background:${esc(style.background)};color:${esc(
        style.text ?? '#000000',
      )};box-shadow:none"`
    : '';

  return `<span class="tag tag-label" title="${esc(name)}"${paint}>${esc(leaf)}</span>`;
}

/*
 * « Classer ce message » se referme comme un menu.
 *
 * C'est un `<details>` : il ne se refermait qu'en recliquant sur son propre
 * titre. Un clic à côté, la croix ou Échap le ferment désormais, comme tous
 * les menus de l'écran.
 */
function fermerClasser(sauf = null) {
  document.querySelectorAll('details.lmore[open]').forEach((menu) => {
    if (menu !== sauf) menu.open = false;
  });
}

document.addEventListener('click', (event) => {
  if (event.target.closest('[data-lmore-fermer]')) return fermerClasser();
  fermerClasser(event.target.closest('details.lmore'));
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') fermerClasser();
});

function renderMe() {
  const me = state.me;
  const shop = me.merchant.shopDomain ?? '';

  // Déclaré plus bas dans le fichier : les fonctions sont hissées, l'appel est
  // donc sûr, et la bannière doit paraître au premier rendu — pas au premier
  // passage par les Réglages.
  renderPreviewBar();
  trimPreviewChoices();

  const brand = state.allShops
    ? 'Toutes les boutiques'
    : me.merchant.brandName || me.merchant.name || 'cSAV Copilot';

  $('merchant-name').textContent = brand;
  $('merchant-shop').textContent = state.allShops
    ? `${state.shops.length} boutiques`
    : shop.replace('.myshopify.com', '');
  $('brand-mark').textContent = brand.slice(0, 2).toUpperCase();

  // Le logo remplace les initiales quand il est renseigné, et retombe dessus
  // si l'image ne charge pas — une URL cassée ne doit pas laisser un trou.
  const logo = $('brand-logo');
  const logoSrc = brandLogoSrc(me.merchant);

  if (logoSrc) {
    logo.src = logoSrc;
    logo.hidden = false;
    $('brand-mark').hidden = true;
    logo.onerror = () => {
      logo.hidden = true;
      $('brand-mark').hidden = false;
    };
  } else {
    logo.hidden = true;
    $('brand-mark').hidden = false;
  }

  // Jamais l'identifiant technique : « owner@rjd8fe-… » n'est le nom de
  // personne. À défaut d'un prénom renseigné (écran Équipe), la boutique
  // elle-même — c'est le propriétaire, la maison parle pour lui.
  const who =
    me.user?.name ||
    (me.user?.role === 'OWNER' ? me.merchant?.brandName || me.merchant?.name : null) ||
    me.user?.email ||
    '—';
  $('me-name').textContent = who;
  // L'adresse est coupée à l'affichage : l'infobulle rend la version entière.
  $('me-name').title = who;
  $('me-role').textContent = ROLE_LABELS[me.user?.role] ?? '';
  $('me-avatar').textContent = who
    .split(/[\s.@]+/)
    .slice(0, 2)
    .map((part) => part[0] ?? '')
    .join('')
    .toUpperCase();

  const pills = [];

  /*
   * La marque porte l'identité, le point porte l'état.
   *
   * Trois pastilles grises se lisaient une par une pour savoir laquelle
   * parlait de quoi. Le logo se reconnaît sans lire ; il reste au point vert,
   * orange ou rouge de dire si ça marche.
   */
  /*
   * Le libellé vit dans son propre `span`, et le mot complet dans le `title`.
   *
   * Sous 700 px la ligne du titre se repliait en quatre rangées, dont une
   * pour ces deux pastilles seules : cent quarante-deux pixels d'en-tête sur
   * un téléphone. Le texte s'y efface, le logo et le point restent — ce sont
   * eux qui portent l'information. Le `title` garde la phrase entière.
   */
  // `conn-ok` : tout va bien. En barre haute, la pastille se tait alors — on
  // n'affiche un branchement que lorsqu'il demande un geste.
  const pastille = (nom, etat, texte) =>
    `<span class="conn-pill${etat ? '' : ' conn-ok'}" title="${esc(texte)}">${marque(nom)}<span class="dot${
      etat ? ` ${etat}` : ''
    }"></span> <span class="conn-txt">${esc(texte)}</span></span>`;

  pills.push(
    me.shopify.connected || me.shopify.simulated
      ? pastille(
          'shopify',
          me.shopify.simulated ? 'warn' : '',
          `Shopify ${me.shopify.simulated ? 'simulé' : 'connecté'}`,
        )
      : pastille('shopify', 'off', 'Shopify non connecté'),
  );

  if (me.gmail.connected) {
    // Un watch expiré veut dire que plus aucun mail n'entre : c'est l'alerte
    // la plus importante de l'écran, elle passe avant tout le reste.
    pills.push(
      pastille(
        'gmail',
        me.gmail.watchActive ? '' : 'warn',
        `${me.gmail.emailAddress}${me.gmail.watchActive ? '' : ' — écoute inactive'}`,
      ),
    );
  } else {
    pills.push(pastille('gmail', 'off', 'Gmail non connecté'));
  }

  $('conn').innerHTML = pills.join('');

  /*
   * L'envoi automatique descend d'une ligne, avec les chiffres.
   *
   * Ce n'est pas un état de connexion mais un réglage : il dit ce que l'outil
   * fait tout seul, ce qui se lit à côté de ce qu'il a fait — pas à côté de
   * ce à quoi il est branché.
   */
  const auto = $('autosend');
  if (auto) {
    auto.innerHTML = `<span class="dot${
      me.merchant.autoSendEnabled ? '' : ' warn'
    }"></span> Envoi auto ${me.merchant.autoSendEnabled ? 'activé' : 'désactivé'}`;
  }
  $('mock-notice').hidden = !me.shopify.simulated;
  $('test-notice').hidden = !me.merchant.testMode;
}

/* ------------------------------------------------------- sélecteur boutique */

async function loadShops() {
  try {
    const data = await api('/api/shops');
    state.shops = data.shops ?? [];
  } catch {
    // Le sélecteur est un confort : s'il échoue, le dashboard reste utilisable
    // sur la boutique en cours.
    state.shops = [];
  }
  renderShopMenu();
}

function renderShopMenu() {
  const canAdd = canI('configure');
  const rows = [];

  // Le mode agrégé n'a de sens qu'à partir de deux boutiques.
  if (state.shops.length > 1) {
    rows.push(`
      <button class="shop-item" type="button" data-shop-all="1" aria-current="${
        state.allShops ? 'true' : 'false'
      }">
        <span class="shop-dot"></span>
        <span style="min-width:0">
          <b>Toutes les boutiques</b>
          <small>${state.shops.length} boutiques réunies dans une seule file</small>
        </span>
      </button>`);
    rows.push('<hr />');
  }

  rows.push(...state.shops.map(
    (shop) => `
      <button class="shop-item" type="button" data-shop="${esc(shop.id)}" aria-current="${
        shop.current && !state.allShops ? 'true' : 'false'
      }">
        <span class="shop-dot" style="background:${esc(shop.color ?? '')}"></span>
        <span style="min-width:0">
          <b>${esc(shop.label)}</b>
          <small>${esc((shop.shopDomain ?? '').replace('.myshopify.com', '') || '—')}${
            // La route mono-boutique ne renvoie ni domaine ni rôle : la ligne
            // reste lisible au lieu de faire tomber tout le menu — et le boot
            // avec lui.
            shop.role ? ` · ${esc(ROLE_LABELS[shop.role] ?? shop.role)}` : ''
          }</small>
        </span>
      </button>`,
  ));

  if (canAdd) {
    rows.push('<hr />');
    rows.push(
      '<button class="shop-item shop-add" type="button" data-shop-add="1">Ajouter une boutique</button>',
    );
  }

  $('shop-menu').innerHTML = rows.join('');

  // Une seule boutique et aucun droit d'en ajouter : le menu n'aurait qu'une
  // ligne, qui ne fait rien. On masque le chevron.
  $('shop-switch').querySelector('.brand-caret').hidden = state.shops.length < 2 && !canAdd;
}

function toggleShopMenu(open) {
  const menu = $('shop-menu');
  const next = open ?? menu.hidden;
  menu.hidden = !next;
  $('shop-switch').setAttribute('aria-expanded', String(next));
}

async function switchShop(merchantId) {
  try {
    await api('/api/shops/switch', { method: 'POST', body: JSON.stringify({ merchantId }) });
    // Rechargement complet plutôt qu'un rafraîchissement d'écran : tout ce qui
    // est en mémoire (tickets, catalogue, stats) appartient à l'ancienne
    // boutique, et en garder une miette afficherait des données croisées.
    location.reload();
  } catch (error) {
    toast(error.message ?? 'Changement de boutique impossible', true);
  }
}

async function addShop() {
  const input = prompt(
    'Domaine Shopify de la boutique à ajouter\n(ex. ma-boutique.myshopify.com)',
  );
  if (!input) return;

  try {
    const { installUrl } = await api('/api/shops/connect', {
      method: 'POST',
      body: JSON.stringify({ shopDomain: input }),
    });
    location.href = installUrl;
  } catch (error) {
    toast(error.message ?? 'Ajout impossible', true);
  }
}

/* ------------------------------------------------------------ indicateurs */

/**
 * Un délai en secondes, dit comme on le dirait à voix haute.
 *
 * « 5 400 s » ne se compare à rien ; « 1 h 30 » se compare à hier. L'unité
 * suit l'ordre de grandeur, parce qu'un délai de trois minutes et un délai de
 * deux jours ne se lisent pas dans la même échelle.
 *
 * `null` — aucune réponse partie sur la fenêtre — s'affiche « — » et non
 * « 0 » : zéro se lirait comme instantané, l'inverse de « rien mesuré ».
 */
function formatDelay(seconds) {
  if (seconds == null) return '—';
  if (seconds < 60) return `${Math.round(seconds)} s`;

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;

  const hours = seconds / 3600;
  if (hours < 24) {
    const whole = Math.floor(hours);
    const rest = Math.round((hours - whole) * 60);
    return rest === 0 ? `${whole} h` : `${whole} h ${rest}`;
  }

  const days = seconds / 86400;
  return days < 10 ? `${days.toFixed(1).replace('.', ',')} j` : `${Math.round(days)} j`;
}

/*
 * Les icônes des bandes de chiffres.
 *
 * Posées ici plutôt qu'écrites dans le HTML : le jeu de glyphes vit dans
 * `ICONS`, et deux définitions du même dessin finiraient par diverger.
 * `data-ico` nomme l'icône, `ico()` la produit, une seule fois — les rendus
 * sont rappelés à chaque relève, et repeindre coûterait pour rien.
 *
 * Prend un hôte parce que deux écrans en ont désormais besoin : la bande du
 * SAV, servie par `loadMetrics`, et celle du poste de pilotage.
 */
function paintKpiIcons(hote) {
  hote.querySelectorAll('.kpi-ico[data-ico]').forEach((box) => {
    if (!box.firstChild) box.innerHTML = ico(box.dataset.ico);
  });
}

async function loadMetrics() {
  const metrics = await api('/api/metrics');
  const counts = metrics.tickets ?? {};
  state.metrics = metrics;

  paintKpiIcons(document);

  /*
   * « Traités · 30 jours » et « Traités aujourd'hui » quittent cette bande.
   *
   * Ils comptent le travail accompli ; la bande doit dire ce qui reste à
   * faire et à quelle vitesse on répond. Le premier reste servi par la route
   * — l'écran Statistiques s'en sert — il n'est simplement plus affiché ici.
   */
  $('kpi-drafts').textContent = String(counts.DRAFT_READY ?? 0);
  $('kpi-delay').textContent = formatDelay(metrics.firstReplySeconds);
  $('kpi-pending').textContent = String(metrics.pending ?? 0);
  state.pendingCount = metrics.pending ?? 0;
  renderNav();
  $('kpi-pending-note').textContent = `${counts.NEEDS_REVIEW ?? 0} à valider · ${
    counts.DRAFT_READY ?? 0
  } prêts`;

  // Aucun brouillon : « — » et non « 0 % ». Un zéro se lit comme un échec,
  // alors qu'il n'y a rien à mesurer.
  $('kpi-rate').textContent =
    metrics.automationRate === null || metrics.automationRate === undefined
      ? '—'
      : `${Math.round(metrics.automationRate * 100)} %`;

  /*
   * Quatrième indicateur : ce qui n'est pas passé.
   *
   * « Envoi automatique : Inactif » occupait la place la plus visible de
   * l'écran pour répéter un réglage qui ne change jamais, pendant que trois
   * mille cinq cents messages en échec n'apparaissaient nulle part. Un
   * indicateur doit dire ce qu'on ignore, pas ce qu'on sait déjà.
   */
  const failed = metrics.failed ?? 0;
  $('kpi-failed').textContent = String(failed);
  $('kpi-failed').classList.toggle('set-alert', failed > 0);
  $('kpi-failed-note').textContent = failed > 0 ? 'à relancer' : 'tout est passé';

  /*
   * Les chiffres quittent leur bandeau, comme dans Mail.
   *
   * Ce qui attend un geste monte sous le titre de l'écran ; la vitesse de
   * réponse et ce que l'IA n'a pas compris descendent dans la barre d'état,
   * à côté des raccourcis. Cinq cartes en tête de file occupaient une ligne
   * entière pour des nombres qu'on lit d'un coup d'œil et ne travaille pas.
   */
  const brouillons = counts.DRAFT_READY ?? 0;
  state.sousSav = `${metrics.pending ?? 0} en attente de vous · ${brouillons} brouillon${
    brouillons > 1 ? 's' : ''
  } prêt${brouillons > 1 ? 's' : ''}`;
  if (state.view === 'tickets') afficherSousSav();

  const etat = $('kb-kpis');
  if (etat) {
    etat.innerHTML = `<span>1re réponse : ${esc($('kpi-delay').textContent)}</span><span>Automatisation : ${esc(
      $('kpi-rate').textContent,
    )}</span><span${failed > 0 ? ' class="kb-alerte"' : ''}>Non compris par l'IA : ${failed}</span>`;
  }
}

/** Le sous-titre de l'écran SAV : ce qui attend, écrit sous le titre. */
function afficherSousSav() {
  const sous = $('view-sub');
  if (!sous || !state.sousSav) return;
  sous.textContent = state.sousSav;
  sous.hidden = false;
}

/**
 * Messages restés d'une boîte débranchée.
 *
 * Ils n'ont plus de carte : « Effacer ses messages » vit sur la boîte, et la
 * boîte a disparu. Sans ce bandeau, du courrier privé — banque, santé,
 * abonnements — reste dans la file sans aucun geste pour l'en sortir.
 */
async function renderOrphans() {
  const box = $('mbx-orphans');
  if (!box) return;

  let count = 0;
  try {
    count = (await api('/api/tickets/orphans')).count ?? 0;
  } catch {
    return;
  }

  box.hidden = count === 0;
  if (count === 0) return;

  box.innerHTML =
    `<b class="set-alert">${count} message${count > 1 ? 's' : ''}</b> ` +
    `${count > 1 ? 'proviennent' : 'provient'} d’une boîte débranchée. ` +
    `<button class="btn btn-small btn-danger" id="orphans-purge">Les effacer</button>`;

  $('orphans-purge').addEventListener('click', async () => {
    if (
      !await confirmer(
        `Effacer ${count} message${count > 1 ? 's' : ''} venus de boîtes débranchées ?\n\n` +
          'Les brouillons et pièces jointes partent avec eux. Irréversible.',
        { action: 'Effacer', danger: true, icone: 'corbeille' },
      )
    ) {
      return;
    }

    const button = $('orphans-purge');
    button.disabled = true;
    try {
      const result = await api('/api/tickets/orphans', { method: 'DELETE' });
      toast(`${result.removed} message${result.removed > 1 ? 's' : ''} effacé${
        result.removed > 1 ? 's' : ''
      }.`);
      box.hidden = true;
      await loadQueue();
    } catch (error) {
      toast(error.message, true);
      button.disabled = false;
    }
  });
}

/* -------------------------------------------------------- file de tickets */

/** Ancienneté en jours depuis la dernière prise de parole. */
function ageInDays(iso) {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
}

function ageChip(iso) {
  // Jamais négatif : une horloge serveur en avance de quelques minutes
  // affichait « -1 jours » sur des messages tout frais.
  const days = Math.max(0, ageInDays(iso));
  // Trois paliers seulement : au-delà, la couleur ne se lit plus comme une
  // échelle mais comme une décoration.
  const level = days >= 7 ? 'late' : days >= 3 ? 'warm' : 'fresh';
  // Les messages du jour affichent l'heure : sur une file où tout est
  // « aujourd'hui », le jour ne trie plus rien, l'heure si.
  const label =
    days === 0
      ? shortTime(iso)
      : days === 1
        ? `hier ${shortTime(iso)}`
        : `${days} jours`;
  return `<span class="age age-${level}" title="${esc(dateTime(iso))}">${label}</span>`;
}

/**
 * Teinte d'avatar, déduite du nom.
 *
 * Déterministe : la même personne garde sa couleur d'une session à l'autre et
 * d'un écran à l'autre, ce qui fait de l'avatar un repère et non une
 * décoration. Tirée au hasard, elle changerait à chaque rendu et coûterait
 * plus d'attention qu'elle n'en économise.
 *
 * Teintes pastel et texte foncé : ces pastilles apparaissent cinquante fois
 * par écran, elles doivent se laisser survoler sans retenir l'œil.
 */
function avatarTint(value) {
  const text = String(value ?? '');
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) hash = (hash * 31 + text.charCodeAt(i)) % 360;
  return `hsl(${hash} 52% 88%)`;
}

function initials(value) {
  return String(value ?? '')
    .split(/[\s.@_-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0] ?? '')
    .join('')
    .toUpperCase();
}

/*
 * Dossiers, à la manière de Gmail.
 *
 * Quatre entrées et pas une de plus : ouvrir la file, c'est vouloir savoir ce
 * qui reste à faire. La réception le dit, les trois autres servent à vérifier
 * ou à retrouver.
 *
 * « Brouillons » et « Envoyés » ne sont pas les dossiers Gmail du même nom.
 * Le produit a cessé d'écrire ses brouillons dans la boîte partagée — un
 * brouillon posé là s'envoie depuis n'importe quel téléphone, hors de l'outil,
 * sans contrôle de rôle, sans plafond de remboursement et sans journal. Ces
 * deux dossiers lisent donc ce que le produit détient en propre : ses
 * propositions en attente de relecture, et les fils où une réponse est
 * réellement partie.
 */
const FOLDERS = [
  { key: 'inbox', label: 'Réception', compte: true },
  { key: 'drafts', label: 'Brouillons', compte: true },
  { key: 'sent', label: 'Envoyés', compte: false },
  { key: 'archived', label: 'Archivés', compte: false },
];

function renderFolders() {
  const bar = $('folders');
  if (!bar) return;

  const counts = state.queueFolders ?? {};
  const current = state.queue.folder;

  bar.innerHTML = FOLDERS.map((folder) => {
    const n = counts[folder.key];
    // Seuls les dossiers qui réclament un geste portent leur nombre : ce qui
    // reste à traiter, ce qui attend d'être relu. Envoyés et Archivés servent
    // à vérifier ou à retrouver — « 353 envoyés » n'appelle rien, et ces deux
    // nombres faisaient passer « Archivés » à la ligne avec une vraie boîte
    // (5 674 en réception). Rien ne se perd : le nombre reste en infobulle, et
    // le titre de la file affiche celui du dossier ouvert.
    const titre = !folder.compte && n ? ` title="${n} message${n > 1 ? 's' : ''}"` : '';
    return `<button class="folder" data-folder="${folder.key}" aria-pressed="${
      folder.key === current
    }"${titre}>${esc(folder.label)}${
      // Un dossier vide n'affiche pas « 0 » : le nombre sert à décider d'y
      // aller, et « 0 » dit déjà tout en ne disant rien.
      folder.compte && n ? `<span class="folder-n">${n > 9999 ? '9999+' : n}</span>` : ''
    }</button>`;
  }).join('');

  bar.querySelectorAll('[data-folder]').forEach((button) =>
    button.addEventListener('click', () => {
      const next = button.dataset.folder;
      if (next === state.queue.folder) return;

      state.queue.folder = next;
      // La sélection appartenait à l'ancien dossier : cocher trente messages
      // en réception puis basculer sur Archivés laisserait agir sur des lignes
      // qu'on ne voit plus.
      state.picked.clear();
      state.queueCursor = null;
      void loadQueue();
    }),
  );
}

/**
 * Filtres de la file à l'état neuf.
 *
 * Une fabrique et non deux littéraux : l'état initial et « Tout réinitialiser »
 * décrivaient la même chose à deux endroits, et le second a pris du retard dès
 * la première clé ajoutée. `folder` manquait au réinitialisation, si bien que
 * la requête suivante partait avec `folder=undefined` — chaîne que le serveur
 * refuse, sans que rien à l'écran n'explique pourquoi la file s'était vidée.
 *
 * Retourne un objet neuf à chaque appel : `labels` est un tableau, et une
 * constante partagée finirait modifiée en place par un filtre.
 */
function emptyQueueFilters() {
  return {
    q: '',
    intent: '',
    assignee: '',
    mailbox: '',
    labels: [],
    sort: 'newest',
    urgent: false,
    unassigned: false,
    unlinked: false,
    historical: false,
    dueSoon: false,
    bigAmount: false,
    timer: null,
    /* Dossier courant, à la manière de Gmail. La réception par défaut : ce
       qu'on ouvre le matin, c'est ce qui reste à faire, pas l'archive. */
    folder: 'inbox',
    /* Croise les autres filtres au lieu de les remplacer : « non lu » se
       demande aussi bien dans la réception que dans un libellé. */
    unread: false,
  };
}

/** Paramètres d'appel dérivés de l'état des filtres. */
function queueParams() {
  const params = new URLSearchParams();
  const f = state.queue;

  if (state.filter) params.set('status', state.filter);
  if (f.q.trim()) params.set('q', f.q.trim());
  if (f.intent) params.set('intent', f.intent);
  if (f.assignee) params.set('assignee', f.assignee);
  if (f.mailbox) params.set('mailbox', f.mailbox);
  // Plusieurs libellés à la fois, séparés par des virgules : le serveur les
  // traite en « au moins l'un d'eux ». Deux catégories voisines — « Refund » et
  // « Litige » — se regardent ensemble ou ne se regardent pas.
  if (f.labels.length) params.set('label', f.labels.join(','));
  if (state.allShops) params.set('scope', 'all');
  if (f.sort !== 'newest') params.set('sort', f.sort);
  if (f.urgent) params.set('minAgeDays', '3');
  if (f.unassigned) params.set('assignee', 'none');
  if (f.unlinked) params.set('unlinked', 'true');
  if (f.historical) params.set('historical', 'true');
  // « Litiges à échéance » restreint au motif et à l'ancienneté : c'est ce que
  // recouvre l'expression — un litige qui traîne, pas un litige quelconque.
  if (f.dueSoon) {
    params.set('intent', 'DISPUTE');
    params.set('minAgeDays', '2');
  }
  if (f.bigAmount) params.set('minAmount', '100');
  // Toujours transmis, y compris `all` : le serveur a `all` pour défaut, et
  // laisser le paramètre de côté rendrait la réception silencieusement égale
  // à tout le reste.
  params.set('folder', f.folder);
  /* Posé seulement quand il est actif : `z.coerce.boolean()` ne fait qu'un
     `Boolean(valeur)`, et la chaîne « false » vaut donc vrai. Envoyer le
     paramètre en permanence rendrait le filtre impossible à désactiver. */
  if (f.unread) params.set('unread', 'true');

  return params;
}

function queueIsFiltered() {
  const f = state.queue;
  return Boolean(
    state.filter || f.q.trim() || f.intent || f.assignee || f.mailbox || f.labels.length ||
      f.urgent || f.unassigned || f.unlinked || f.historical || f.dueSoon ||
      f.bigAmount || f.unread,
  );
}

let queueObserver = null;
let queueLoadingMore = false;

async function loadQueue({ append = false } = {}) {
  const list = $('queue');

  const params = queueParams();
  if (append && state.queueCursor) params.set('cursor', state.queueCursor);
  // Cinquante par page plutôt que vingt-cinq : le défilement infini enchaîne
  // les pages, autant qu'elles soient assez grosses pour qu'il ne se déclenche
  // pas à chaque tour de molette.
  params.set('limit', '50');

  /*
   * Un changement de filtre annule la sélection.
   *
   * Cocher trente messages, changer d'onglet, puis cliquer « Marquer résolu »
   * refermerait trente messages qu'on ne voit plus. Le rafraîchissement
   * automatique, lui, ne touche à rien : la signature des filtres n'a pas
   * bougé, la sélection reste.
   */
  const signature = params.toString().replace(/&?cursor=[^&]*/, '');
  if (!append && state.queueSignature && state.queueSignature !== signature) {
    state.picked.clear();
  }
  // Même file qu'au tour précédent : ce qui y apparaît est une arrivée. Après
  // un changement de dossier ou de filtre, c'est seulement ce qu'on a demandé.
  const memeFile = !append && state.queueSignature === signature;
  state.queueSignature = signature;

  const data = await api(`/api/tickets?${params}`);
  guetterArrivees(data.tickets ?? [], { annoncerArrivees: memeFile });

  state.queueCursor = data.nextCursor ?? null;
  state.tickets = append ? [...state.tickets, ...data.tickets] : data.tickets;
  state.queueLoaded = true;
  state.queueCounts = data.counts ?? {};
  state.queueFolders = data.folders ?? {};
  state.queueLabels = data.labels ?? state.queueLabels ?? [];
  renderFolders();

  // Compteurs de la navigation, dérivés des mêmes chiffres que la file : deux
  // sources donneraient deux vérités, et c'est celle qu'on ne regarde pas qui
  // finirait par mentir.
  void checkFailures();

  state.navCounts = {
    ...state.navCounts,
    disputes: state.disputeCount ?? 0,
    changes: state.changesPending ?? 0,
    suppliers: state.supplierActivity?.total ?? state.navCounts?.suppliers ?? 0,
  };
  void refreshChangesCount();
  renderNav();
  renderQueueBar();

  if (state.tickets.length === 0) {
    // Un écran vide doit dire pourquoi il est vide : « aucun ticket » et
    // « aucun ticket qui corresponde aux filtres » appellent des gestes
    // opposés.
    list.innerHTML = queueIsFiltered()
      ? `<li class="empty" style="padding:16px 14px">
           Aucun message ne correspond à ces filtres.
           <button class="qlink" data-reset="1">Tout afficher</button>
         </li>`
      : `<li class="empty" style="padding:16px 14px">
           Rien en attente.
           ${
             state.me?.gmail?.connected
               ? `Les messages reçus sur <code>${esc(
                   state.me.gmail.emailAddress,
                 )}</code> arrivent ici automatiquement${
                   state.me.gmail.watchActive
                     ? '.'
                     : ' — mais <b class="set-alert">l’écoute est expirée</b>, reconnectez la boîte dans les Réglages.'
                 }`
               : 'Aucune boîte mail connectée : rien ne peut entrer. Connectez Gmail dans les Réglages.'
           }
         </li>`;

    list.querySelector('[data-reset]')?.addEventListener('click', resetQueueFilters);
    return;
  }

  // Le badge de boîte n'a de sens qu'à partir de deux adresses : sinon il
  // répète la même information sur chaque ligne.
  const multiMailbox = (state.me?.gmail?.mailboxes?.length ?? 0) > 1;
  const shopById = new Map(state.shops.map((shop) => [shop.id, shop]));

  list.innerHTML = state.tickets
    .map((ticket) => {
      const label = STATUS_LABELS[ticket.status] ?? ticket.status;
      const who = ticket.assignedTo;

      // La case vit hors du bouton : un contrôle imbriqué dans un bouton n'est
      // pas cliquable au clavier et avale le clic de la souris une fois sur
      // deux. Elle est en position absolue par-dessus, la ligne garde sa
      // surface cliquable pleine.
      const lu = estLu(ticket);

      return `<li class="qrow${state.picked.has(ticket.id) ? ' picked' : ''}">
        <label class="qpick" title="Sélectionner">
          <input type="checkbox" data-pick="${ticket.id}"${
            state.picked.has(ticket.id) ? ' checked' : ''
          } aria-label="Sélectionner le message de ${esc(
            ticket.customerName ?? ticket.customerEmail ?? 'ce client',
          )}" />
        </label>
        <!--
          La pastille de lecture, comme dans Gmail : elle DIT l'état et le
          change du même geste. Elle est hors du bouton de la ligne, et non
          dedans — un bouton dans un bouton n'est pas du HTML valide, et le
          clic serait avalé par l'ouverture du message.
        -->
        <button class="qread${lu ? ' lu' : ''}" type="button" data-read="${ticket.id}"
          title="${lu ? 'Marquer comme non lu' : 'Marquer comme lu'}"
          aria-label="${lu ? 'Marquer comme non lu' : 'Marquer comme lu'}"
          aria-pressed="${!lu}"></button>
        <button class="queue-item li-${ticket.intent ?? 'OTHER'}${
          // Le gras suit la lecture, pas l'archivage : ouvrir un message
          // suffit à l'éteindre, exactement comme dans Gmail. L'archivage
          // garde son rôle ailleurs — c'est lui qui remplit le dossier
          // Archivés.
          //
          // Deux façons d'avoir été lu, et il faut les deux. `gmailUnread`
          // vient du fil Gmail : il ne s'éteint que si quelqu'un ouvre le
          // message DANS Gmail, l'outil n'ayant que `gmail.readonly` et ne
          // pouvant pas retirer le libellé. `openedAt` dit qu'on l'a ouvert
          // ici. Sans le second, cliquer sur un message ne l'éteignait jamais.
          lu ? ' q-done' : ''
        }${ticket.id === state.currentId && state.ouvertureAuto ? ' q-auto' : ''}" data-id="${ticket.id}"
          aria-current="${ticket.id === state.currentId}">
          <!--
            Trois étages : qui écrit, ce qu'il demande, ce qu'il dit.

            L'objet du mail occupait la deuxième ligne et n'apprenait rien —
            « Re: », « Order #13616 Confirmed 7 Sep », « Nouveau message de
            client ». Écrits par Shopify ou tronqués par un client pressé, ils
            obligeaient à ouvrir chaque message pour savoir de quoi il parle,
            ce qu'une file est justement censée éviter. Le titre porte donc
            l'intention devinée, et les mots du client passent en troisième
            ligne : c'est le couple qui permet de trancher sans ouvrir.
          -->
          <span class="qav" aria-hidden="true"
            style="background:${avatarTint(ticket.customerName ?? ticket.customerEmail)}"
            >${esc(initials(ticket.customerName ?? ticket.customerEmail))}</span>
          <span class="qbody">
            <span class="queue-top">
              ${
                state.allShops && shopById.has(ticket.merchantId)
                  ? `<span class="shop-pip" style="background:${esc(
                      shopById.get(ticket.merchantId).color,
                    )}" title="${esc(shopById.get(ticket.merchantId).label)}"></span>`
                  : ''
              }
              <span class="queue-who">${esc(ticket.customerName ?? ticket.customerEmail)}</span>
              ${ticket.signalement ? '<span class="queue-four">Fournisseur</span>' : ''}
              ${ageChip(ticket.lastMessageAt)}
            </span>

            <span class="queue-line2">
              <span class="queue-subject">${esc(ticketTitle(ticket))}</span>
              ${
                // Le numéro n'est répété que s'il manque au titre : avec une
                // intention, `ticketTitle` l'y écrit déjà.
                ticket.orderName && !ticket.intent && !ticket.signalement
                  ? `<span class="queue-ord">${esc(ticket.orderName)}</span>`
                  : ''
              }
              <!-- L'état en mots, comme une étiquette de Mail : un point de
                   couleur ne se lisait qu'au survol, par son infobulle. -->
              <span class="qstat st-${ticket.status}">${esc(label)}</span>
              ${
                who
                  ? `<span class="who-dot" title="${esc(who.name ?? who.email)}">${initials(
                      who.name ?? who.email,
                    )}</span>`
                  : ''
              }
            </span>

            ${
              // Les premiers mots du dernier message reçu. Absent sur les fils
              // importés de l'historique, qui n'ont pas d'extrait : la ligne
              // disparaît alors plutôt que de laisser un blanc.
              ticket.messages?.[0]?.snippet
                ? `<span class="queue-prev">${esc(ticket.messages[0].snippet)}</span>`
                : ''
            }
          </span>
        </button>
      </li>`;
    })
    .join('');

  if (state.queueView === 'table') renderQueueTable(multiMailbox, shopById);

  bindPickers();
  renderBulk();

  // Sentinelle de fin de liste : quand elle entre dans le champ, la page
  // suivante se charge. Un bouton « charger la suite » sur une file de travail
  // se re-clique cinquante fois ; le défilement, lui, ne se remarque pas.
  if (state.queueCursor) {
    const sentinel = document.createElement('li');
    sentinel.className = 'queue-more';
    sentinel.textContent = 'Chargement…';
    list.append(sentinel);

    queueObserver?.disconnect();
    queueObserver = new IntersectionObserver((entries) => {
      if (!entries[0]?.isIntersecting || queueLoadingMore) return;
      queueLoadingMore = true;
      void loadQueue({ append: true }).finally(() => {
        queueLoadingMore = false;
      });
    });
    queueObserver.observe(sentinel);
  } else {
    queueObserver?.disconnect();
  }

  // Le clic n'ouvre pas le message : la pastille est POSÉE À CÔTÉ du bouton de
  // la ligne, jamais dedans. Dedans, marquer non lu aurait ouvert le fil dans
  // la foulée et l'aurait remarqué lu aussitôt — et un bouton dans un bouton
  // n'est de toute façon pas du HTML valide.
  list.querySelectorAll('[data-read]').forEach((pastille) =>
    pastille.addEventListener('click', () => void basculerLecture(pastille.dataset.read, pastille)),
  );

  list.querySelectorAll('.queue-item').forEach((button) => {
    button.addEventListener('click', () => {
      // En mode sélection, toucher la ligne la coche, comme Mail sur iPhone.
      if (enSelection()) return button.closest('.qrow')?.querySelector('[data-pick]')?.click();
      void selectTicket(button.dataset.id);
      ouvrirMessagePile();
    });
    button.addEventListener('mouseenter', () => prefetchTicket(button.dataset.id));
    // Le survol n'existe pas au doigt : sur mobile, le contact précède le clic
    // d'assez peu pour que ça compte quand même.
    button.addEventListener('touchstart', () => prefetchTicket(button.dataset.id), {
      passive: true,
    });
  });
}

/* ------------------------------------------------- lien de travail atelier */

/**
 * Émet — ou révoque — le lien permanent d'un fournisseur.
 *
 * Le lien vaut accès : on l'affiche une fois, à copier, et on rappelle que le
 * révoquer coupe tous ceux déjà transmis. Rien n'est stocké en clair côté
 * marchand, le jeton se recalcule à la demande.
 */
async function openSupplierLink(supplierId, revoke = false) {
  if (revoke && !await confirmer(
    'Révoquer le lien du fournisseur ?\n\nSon accès est coupé immédiatement, y compris le lien qu’il a déjà enregistré. Un nouveau lien sera généré.',
    { action: 'Révoquer', danger: true, icone: 'lien' },
  )) {
    return;
  }

  try {
    const { url } = await api(`/api/suppliers/${supplierId}/portal-link`, {
      method: 'POST',
      body: JSON.stringify({ revoke }),
    });

    await navigator.clipboard?.writeText(url).catch(() => {});
    toast(revoke ? 'Ancien lien révoqué, nouveau lien copié.' : 'Lien copié dans le presse-papier.');

    // Affiché en clair malgré la copie : un presse-papier peut échouer en
    // silence, et le marchand doit pouvoir le sélectionner à la main.
    prompt('Lien de travail du fournisseur — à lui transmettre :', url);
  } catch (error) {
    toast(error.message, true);
  }
}

/**
 * Le lien de travail d'une agence de retours : elle y voit les commandes à
 * expédier depuis son stock, et y saisit ses numéros de suivi. Même geste que
 * pour l'atelier — copié, affiché, et révocable.
 */
async function openAgencyLink(agencyId, revoke = false) {
  if (
    revoke &&
    !await confirmer(
      'Renouveler le lien de l’agence ?\n\nSon accès est coupé immédiatement, y compris le lien qu’elle a déjà enregistré.',
      { action: 'Renouveler', danger: true, icone: 'lien' },
    )
  ) {
    return;
  }

  try {
    const { url } = await api(`/api/return-agencies/${agencyId}/portal-link`, {
      method: 'POST',
      body: JSON.stringify({ revoke }),
    });
    await navigator.clipboard?.writeText(url).catch(() => {});
    toast(revoke ? 'Ancien lien coupé, nouveau lien copié.' : 'Lien de l’agence copié.');
    prompt('Lien de travail de l’agence — à lui transmettre :', url);
  } catch (error) {
    toast(error.message, true);
  }
}

/* ------------------------------------------------- chronologie d'un colis */

/**
 * Historique réel du colis, transporteur par transporteur.
 *
 * Shopify fige le statut à l'expédition : pour un envoi depuis la Chine, il
 * reste « expédié » trois semaines. C'est 17TRACK qui sait où en est le colis,
 * et c'est cette réponse-là qu'attend le client.
 */
async function openTracking(number, externalUrl = null) {
  $('sheet-name').textContent = 'Suivi du colis';
  $('sheet-email').textContent = number;
  $('sheet-body').innerHTML = '<p class="empty">Interrogation du transporteur…</p>';
  $('sheet-wrap').hidden = false;

  let data;
  try {
    data = await api(`/api/tracking/${encodeURIComponent(number)}`);
  } catch (error) {
    $('sheet-body').innerHTML = `<p class="empty">${esc(error.message)}</p>`;
    return;
  }

  const { parcel, track } = data;

  if (!track) {
    $('sheet-body').innerHTML = `<section class="sheet-group">
      <h3>Suivi indisponible</h3>
      <div class="sheet-row"><p>
        Aucune donnée transporteur pour ce numéro. Soit la clé 17TRACK n'est pas
        configurée dans la console d'administration, soit le transporteur n'a pas
        encore pris le colis en charge.
      </p></div>
    </section>`;
    return;
  }

  // Le site du transporteur reste accessible, mais depuis la fenêtre et en
  // choix secondaire : l'outil répond d'abord lui-même.
  const external = externalUrl
    ? `<p class="sheet-ext"><a href="${esc(externalUrl)}" target="_blank" rel="noopener">
        Ouvrir chez le transporteur</a></p>`
    : '';

  $('sheet-body').innerHTML = `
    <section class="sheet-group">
      <h3>${esc(parcel.orderName ?? 'Colis')}${
        parcel.total > 1 ? ` · ${parcel.index}/${parcel.total}` : ''
      }</h3>
      <div class="sheet-row">
        <b>${esc(TRACK_LABELS[track.status] ?? track.status ?? '—')}</b>
        ${track.carrier ? `<span class="tag tag-order">${esc(track.carrier)}</span>` : ''}
        <span class="when">${
          track.lastUpdatedAt ? relativeTime(track.lastUpdatedAt) : ''
        }</span>
      </div>
    </section>

    <section class="sheet-group">
      <h3>Chronologie</h3>
      <div class="sheet-row" style="display:block">
        ${
          track.events.length
            ? `<div class="tl">${track.events
                .map(
                  (event) => `<div class="tl-step">
                    <span class="when">${fullDate(event.at)}</span>
                    <b>${esc(event.status)}</b>
                    ${event.location ? `<span>${esc(event.location)}</span>` : ''}
                  </div>`,
                )
                .join('')}</div>`
            : '<p>Aucun événement pour le moment.</p>'
        }
      </div>
    </section>
    ${external}`;
}

/* ----------------------------------------------- vue d'ensemble du groupe */

/**
 * Une carte par boutique : ce qui attend, ce qui traîne, ce qui coûte.
 *
 * Le taux de litiges y figure parce qu'il annonce une sanction et pas une
 * charge de travail — au-delà de 1 % de commandes contestées, Shopify gèle les
 * paiements d'une boutique. Un exploitant doit le voir avant de le subir.
 */
async function renderShopCards() {
  let data;
  try {
    data = await api('/api/overview');
  } catch {
    $('ov-shops').innerHTML = '';
    return;
  }

  const shops = data.shops ?? [];
  const threshold = data.disputeThreshold ?? 1;

  // Une seule boutique : la carte répéterait les indicateurs juste en dessous.
  if (shops.length < 2) {
    $('ov-shops').innerHTML = '';
    return;
  }

  $('ov-shops').innerHTML = shops
    .map((shop) => {
      const over = shop.disputeRate > threshold;
      // Échelle à deux fois le seuil : sinon un taux de 0,3 % donne une barre
      // invisible et un taux de 1,2 % une barre pleine, tous deux illisibles.
      const width = Math.min(100, (shop.disputeRate / (threshold * 2)) * 100);

      return `<article class="shopcard">
        <div class="shopcard-head">
          <i style="background:${esc(shop.color)}"></i>
          ${esc(shop.label)}
        </div>

        <div class="shopcard-open">
          <b>${shop.open}</b><span>à traiter</span>
        </div>

        <div class="shopcard-tags">
          ${
            shop.late
              ? `<span class="tag st-FAILED">${shop.late} en retard</span>`
              : '<span class="tag st-CLOSED">rien en retard</span>'
          }
          ${shop.disputes ? `<span class="tag st-NEEDS_REVIEW">${shop.disputes} litige${
            shop.disputes > 1 ? 's' : ''
          }</span>` : ''}
        </div>

        <div class="shopcard-rate">
          <span>Litiges 30 j</span>
          <span class="dispute-bar" style="flex:1">
            <span class="dispute-fill${over ? ' over' : ''}" style="width:${width}%"></span>
            <span class="dispute-mark" style="left:50%"></span>
          </span>
          <b>${String(shop.disputeRate).replace('.', ',')} %</b>
        </div>

        ${
          over
            ? '<div class="shopcard-alert">Seuil Shopify dépassé — risque de gel des paiements</div>'
            : ''
        }

        <button class="btn btn-small" data-open-shop="${esc(shop.id)}">${
          shop.current ? 'Ouvrir la file' : 'Basculer et ouvrir'
        }</button>
      </article>`;
    })
    .join('');

  $('ov-shops')
    .querySelectorAll('[data-open-shop]')
    .forEach((button) =>
      button.addEventListener('click', async () => {
        const id = button.dataset.openShop;
        const shop = shops.find((candidate) => candidate.id === id);

        // Basculer recharge la page : rien de la boutique précédente ne doit
        // survivre en mémoire.
        if (!shop?.current) return switchShop(id);

        setView('tickets');
        await loadQueue();
      }),
    );
}

/* ----------------------------------------------------------- fiche client */

/**
 * Tout ce que la boutique sait d'un client, en un panneau.
 *
 * L'email est la clé : c'est le seul identifiant partagé entre Shopify et nos
 * tickets. Le panneau s'ouvre par-dessus l'écran courant plutôt que de le
 * remplacer — l'agent consulte sans perdre le ticket qu'il traite.
 */
async function openCustomerSheet(email, displayName) {
  if (!email) return;

  $('sheet-name').textContent = displayName || email;
  $('sheet-email').textContent = email;
  $('sheet-body').innerHTML = '<p class="empty">Chargement…</p>';
  $('sheet-wrap').hidden = false;

  let data;
  try {
    data = await api(`/api/customer-sheet?email=${encodeURIComponent(email)}`);
  } catch (error) {
    $('sheet-body').innerHTML = `<p class="empty">${esc(error.message)}</p>`;
    return;
  }

  const { totals, customer, orders, tickets, refunds, parcels, shipments, returns, shopifyError } =
    data;
  if (customer?.displayName) $('sheet-name').textContent = customer.displayName;

  const money = (value) => euro(value, totals.currency ?? 'EUR');

  const sections = [];

  sections.push(`<div class="sheet-stats">
    <div class="sheet-stat"><b>${totals.orders}</b><span>Commandes</span></div>
    <div class="sheet-stat"><b>${esc(money(totals.spent))}</b><span>Dépensé</span></div>
    <div class="sheet-stat"><b>${totals.openTickets}/${totals.tickets}</b><span>Messages ouverts</span></div>
    <div class="sheet-stat"><b>${esc(money(totals.refunded))}</b><span>Remboursé</span></div>
  </div>`);

  if (shopifyError) {
    sections.push(`<div class="notice"><span class="notice-mark">Shopify</span><div>${esc(
      shopifyError,
    )}</div></div>`);
  }

  sections.push(group(
    'Commandes',
    orders.map(
      (order) => `<div class="sheet-row">
        <b class="mono">${esc(order.name)}</b>
        ${statusTag(order.displayFulfillmentStatus, FULFILLMENT_LABELS, ['UNFULFILLED', 'ON_HOLD'])}
        ${statusTag(order.displayFinancialStatus, FINANCIAL_LABELS, [
          'PENDING',
          'PARTIALLY_PAID',
          'EXPIRED',
        ])}
        <span class="mono">${esc(euro(order.totalPrice, order.currency))}</span>
        <span class="when">${relativeTime(order.createdAt)}</span>
        <p>${esc(
          (order.lineItems ?? [])
            .map((item) => `${item.quantity} × ${item.title}`)
            .join(' · ') || 'aucun article',
        )}</p>
      </div>`,
    ),
    'Aucune commande à cette adresse.',
  ));

  /*
   * Colis de l'atelier et expéditions Shopify, dans la même section.
   *
   * Le client se fiche de savoir qui a saisi le numéro : il veut savoir où est
   * son colis. Séparer les deux sources ferait dire « aucun colis » à côté
   * d'une commande expédiée — c'est exactement ce qui se passait.
   */
  const shipmentRows = (shipments ?? []).map(
    (shipment) => `<div class="sheet-row">
      <b>${esc(SHIPMENT_LABELS[shipment.status] ?? shipment.status ?? 'Expédié')}</b>
      <button class="linklike mono" data-track="${esc(shipment.trackingNumber)}">${esc(
        shipment.trackingNumber,
      )}</button>
      ${shipment.carrier ? `<span class="tag tag-order">${esc(shipment.carrier)}</span>` : ''}
      <span class="when">${esc(shipment.orderName ?? '')}</span>
      <span class="when">${relativeTime(shipment.updatedAt)}</span>
    </div>`,
  );

  sections.push(group(
    'Colis',
    [
      ...parcels.map(
        (parcel) => `<div class="sheet-row">
          <b>${parcel.index}/${parcel.total}</b>
          <button class="linklike mono" data-track="${esc(parcel.trackingNumber)}">${esc(parcel.trackingNumber)}</button>
          ${parcel.carrier ? `<span class="tag tag-order">${esc(parcel.carrier)}</span>` : ''}
          ${
            parcel.hasPhoto
              ? `<a class="btn btn-small" href="/api/parcels/${esc(
                  parcel.id,
                )}/photo" target="_blank" rel="noopener">Photo</a>`
              : '<span class="when">sans photo</span>'
          }
          <span class="when">${esc(parcel.orderName ?? '')}</span>
        </div>`,
      ),
      ...shipmentRows,
    ],
    'Aucun colis : ni saisi par l’atelier, ni expédié depuis Shopify.',
  ));

  sections.push(group(
    'Messages',
    tickets.map(
      (ticket) => `<div class="sheet-row clickable" data-ticket="${esc(ticket.id)}">
        <b>${esc(ticket.subject ?? '(sans objet)')}</b>
        <span class="tag st-${ticket.status}">${esc(
          STATUS_LABELS[ticket.status] ?? ticket.status,
        )}</span>
        ${
          ticket.signalement
            ? `<span class="tag in-OTHER">${esc(`Signalement · ${ticket.signalement.court}`)}</span>`
            : ticket.intent
              ? `<span class="tag in-${ticket.intent}">${esc(
                  INTENT_LABELS[ticket.intent] ?? ticket.intent,
                )}</span>`
              : ''
        }
        <span class="when">${relativeTime(ticket.lastMessageAt)}</span>
      </div>`,
    ),
    'Aucun échange avec ce client.',
  ));

  // Les retours : la preuve au dossier. Raison, souhait du client, trajet du
  // colis, photo — tout ce qu'on cite dans un litige.
  if (returns?.length) {
    sections.push(group(
      'Retours',
      returns.map(
        (item) => `<div class="sheet-row">
          <b>${esc(item.productTitle)}${
            item.variantTitle ? ` · ${esc(item.variantTitle)}` : ''
          }</b>
          <span class="tag tag-order">${esc(item.orderName ?? '—')}</span>
          <span class="ret-tag dim">${esc(RETURN_REASONS[item.reason] ?? item.reason)}</span>
          <span class="ret-tag ${item.resolution === 'REFUND' ? 'warn' : 'ok'}">${esc(
            RETURN_RESOLUTIONS[item.resolution] ?? item.resolution,
          )}</span>
          <span class="ret-tag ${
            ['RESTOCKED', 'CLOSED'].includes(item.status)
              ? 'ok'
              : item.status === 'UNUSABLE'
                ? 'bad'
                : 'dim'
          }">${esc(RETURN_STATUSES[item.status] ?? item.status)}</span>
          ${
            item.trackingNumber
              ? `<a class="linklike mono" href="${esc(trackUrl(item.trackingNumber))}"
                  target="_blank" rel="noopener">${esc(item.trackingNumber)}</a>`
              : ''
          }
          ${
            item.hasPhoto
              ? `<a class="btn btn-small" href="/api/returns/${esc(
                  item.id,
                )}/photo" target="_blank" rel="noopener">Photo</a>`
              : ''
          }
          <span class="when">${relativeTime(item.createdAt)}</span>
        </div>`,
      ),
      '',
    ));
  }

  sections.push(group(
    'Remboursements',
    refunds.map(
      (refund) => `<div class="sheet-row">
        <b class="mono">${esc(euro(refund.amount, refund.currency))}</b>
        <span class="tag st-${refund.status === 'COMPLETED' ? 'CLOSED' : 'NEEDS_REVIEW'}">${esc(
          refund.status,
        )}</span>
        <span class="when">${relativeTime(refund.createdAt)}</span>
        <p>${esc(refund.reason)}</p>
      </div>`,
    ),
    'Aucun remboursement.',
  ));

  $('sheet-body').innerHTML = sections.join('');

  // Un ticket de la fiche ramène à la file, sur ce ticket : c'est le geste
  // attendu quand on découvre un échange passé qui explique la demande.
  $('sheet-body')
    .querySelectorAll('[data-ticket]')
    .forEach((row) =>
      row.addEventListener('click', async () => {
        closeCustomerSheet();
        setView('tickets');
        await selectTicket(row.dataset.ticket);
      }),
    );
}

function group(title, rows, empty) {
  return `<section class="sheet-group">
    <h3>${esc(title)}</h3>
    ${rows.length ? rows.join('') : `<div class="sheet-row"><p>${esc(empty)}</p></div>`}
  </section>`;
}

/* ---------------------------------------------- colonnes redimensionnables */

/*
 * Chaque colonne de côté se règle à la souris ou au clavier, et le poste s'en
 * souvient.
 *
 * Les largeurs sont deux variables CSS sur la grille ; les bornes vivent ici
 * et non dans la feuille, parce qu'une valeur stockée puis relue doit passer
 * par le même garde-fou qu'une valeur glissée. Persistance au poste, comme
 * les autres préférences d'affichage (`csav.*`) : une largeur de colonne est
 * une affaire d'écran, pas de compte.
 */
const WS_COLUMNS = {
  col1: { key: 'csav.queueWidth', min: 280, max: 560, base: 350 },
  col3: { key: 'csav.railWidth', min: 260, max: 520, base: 320 },
};

function wsClamp(name, value) {
  const spec = WS_COLUMNS[name];
  return Math.min(spec.max, Math.max(spec.min, Math.round(value)));
}

function wsCurrent(name) {
  const raw = getComputedStyle($('view-tickets')).getPropertyValue(`--ws-${name}`);
  const value = parseInt(raw, 10);
  return Number.isFinite(value) ? value : WS_COLUMNS[name].base;
}

function wsApply(name, value, { persist = false } = {}) {
  const width = wsClamp(name, value);
  $('view-tickets').style.setProperty(`--ws-${name}`, `${width}px`);
  const handle = document.querySelector(`.ws-handle[data-handle="${name}"]`);
  handle?.setAttribute('aria-valuenow', String(width));
  if (persist) {
    try {
      localStorage.setItem(WS_COLUMNS[name].key, String(width));
    } catch {}
  }
}

function wsReset(name) {
  $('view-tickets').style.removeProperty(`--ws-${name}`);
  try {
    localStorage.removeItem(WS_COLUMNS[name].key);
  } catch {}
  document
    .querySelector(`.ws-handle[data-handle="${name}"]`)
    ?.setAttribute('aria-valuenow', String(WS_COLUMNS[name].base));
}

for (const name of Object.keys(WS_COLUMNS)) {
  const spec = WS_COLUMNS[name];
  try {
    const saved = parseInt(localStorage.getItem(spec.key) ?? '', 10);
    if (Number.isFinite(saved)) wsApply(name, saved);
  } catch {}

  const handle = document.querySelector(`.ws-handle[data-handle="${name}"]`);
  if (!handle) continue;
  handle.setAttribute('aria-valuemin', String(spec.min));
  handle.setAttribute('aria-valuemax', String(spec.max));
  handle.setAttribute('aria-valuenow', String(wsCurrent(name)));

  // Le rail est à droite de sa poignée : tirer vers la droite le rétrécit.
  const sign = name === 'col3' ? -1 : 1;

  handle.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = wsCurrent(name);
    handle.setPointerCapture(event.pointerId);
    handle.classList.add('dragging');
    document.body.classList.add('ws-resizing');

    const move = (e) => wsApply(name, startWidth + sign * (e.clientX - startX));
    const stop = () => {
      handle.removeEventListener('pointermove', move);
      handle.classList.remove('dragging');
      document.body.classList.remove('ws-resizing');
      wsApply(name, wsCurrent(name), { persist: true });
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', stop, { once: true });
    handle.addEventListener('pointercancel', stop, { once: true });
  });

  handle.addEventListener('dblclick', () => wsReset(name));

  handle.addEventListener('keydown', (event) => {
    const step = event.shiftKey ? 48 : 16;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      const direction = event.key === 'ArrowRight' ? 1 : -1;
      wsApply(name, wsCurrent(name) + sign * direction * step, { persist: true });
    } else if (event.key === 'Home') {
      event.preventDefault();
      wsReset(name);
    }
  });
}

function closeCustomerSheet() {
  $('sheet-wrap').hidden = true;
}

$('read-only-switch').addEventListener('click', (event) => {
  const id = event.currentTarget.dataset.shop;
  if (id) void switchShop(id);
});

$('sheet-close').addEventListener('click', closeCustomerSheet);

$('sheet-wrap').addEventListener('click', (event) => {
  if (event.target === $('sheet-wrap')) closeCustomerSheet();
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !$('sheet-wrap').hidden) closeCustomerSheet();
});

/* ------------------------------------------------------------------ colis */

/**
 * Colis saisis par le fournisseur, avec la photo de chaque étiquette.
 *
 * Une commande de trois articles part souvent en trois colis : afficher le
 * rang (« 2/3 ») dit d'un coup d'œil lequel manque quand un client signale un
 * envoi incomplet — c'est la question que Shopify seul ne répond pas.
 */
async function renderParcels(ticket) {
  const panel = $('parcels-panel');

  if (!ticket?.shopifyOrderId) {
    panel.hidden = true;
    return;
  }

  let parcels = [];
  try {
    const data = await api(`/api/parcels?orderId=${encodeURIComponent(ticket.shopifyOrderId)}`);
    parcels = data.parcels ?? [];
  } catch {
    panel.hidden = true;
    return;
  }

  if (parcels.length === 0) {
    panel.hidden = true;
    return;
  }

  panel.hidden = false;

  $('c-parcels').innerHTML = parcels
    .map(
      (parcel) => `<div class="pcl">
        <div class="pcl-head">
          <b>Colis ${parcel.index}/${parcel.total}</b>
          ${
            parcel.hasPhoto
              ? ''
              : '<span class="pcl-nophoto">sans photo</span>'
          }
        </div>
        <button class="linklike mono" data-track="${esc(parcel.trackingNumber)}">${esc(parcel.trackingNumber)}</button>
        ${parcel.carrier ? `<small>${esc(parcel.carrier)}</small>` : ''}
        ${
          parcel.hasPhoto
            ? `<a href="/api/parcels/${esc(parcel.id)}/photo" target="_blank" rel="noopener">
                 <img src="/api/parcels/${esc(parcel.id)}/photo" loading="lazy"
                   alt="Étiquette du colis ${parcel.index}" />
               </a>`
            : ''
        }
      </div>`,
    )
    .join('');
}

/* -------------------------------------------------- actions contextuelles */

/*
 * Ce que l'agent peut faire dépend de ce que le client demande.
 *
 * Une barre d'actions unique et générique oblige à relire le ticket pour
 * choisir ; ici l'action la plus probable est déjà en tête, et les autres
 * restent accessibles. L'ordre compte plus que la liste.
 */
const ACTIONS_BY_INTENT = {
  WISMO: ['tracking'],
  RETURN: [],
  DISPUTE: [],
  REFUND: [],
  PRODUCT_QUESTION: ['substitute'],
  POSITIVE: [],
  OTHER: [],
};

const ACTION_META = {
  substitute: { label: 'Proposer un remplacement', note: 'Le client garde sa commande, on remplace la référence indisponible.' },
  refund: { label: 'Rembourser…', note: 'Irréversible : l’argent repart chez le client immédiatement.' },
  client: { label: 'Écrire au client', note: 'Message direct, hors brouillon proposé.' },
  supplier: {
    label: 'Contacter le fournisseur',
    note: 'Rupture, taille, adresse, article manquant… — l’atelier répond d’un bouton.',
  },
  tracking: { label: 'Voir le suivi', note: 'Position du colis d’après le transporteur.' },
};

function renderActionBar() {
  const { ticket } = state.detail;
  const keys = ACTIONS_BY_INTENT[ticket.intent] ?? ACTIONS_BY_INTENT.OTHER;

  // Un remerciement n'appelle aucune action de cette barre : depuis que
  // « Écrire au client » a rejoint l'en-tête, il ne reste rien à y montrer, et
  // un cadre vide titré ACTION se lit comme une panne.
  $('actbar').hidden = keys.length === 0;
  $('subs').hidden = true;

  if (keys.length === 0) return;

  $('actbar-row').innerHTML = keys
    .map((key, index) => {
      // Une action impossible reste visible mais désactivée, avec sa raison en
      // infobulle : la faire disparaître laisserait croire qu'elle n'existe pas.
      const blocked = actionBlockedReason(key, ticket);
      return `<button class="actbtn${index === 0 && !blocked ? ' on' : ''}" data-act="${key}"${
        blocked ? ` disabled title="${esc(blocked)}"` : ''
      }>${esc(ACTION_META[key].label)}</button>`;
    })
    .join('');

  /*
   * La note explique l'action mise en avant. Quand toutes sont bloquées, il
   * n'y en a aucune à expliquer — et un paragraphe vide sous le titre ACTION
   * se lit comme un rendu qui a échoué. On dit alors pourquoi c'est bloqué,
   * qui est l'information utile à ce moment-là.
   */
  const first = keys.find((key) => !actionBlockedReason(key, ticket));
  $('actbar-note').textContent = first
    ? ACTION_META[first].note
    : (actionBlockedReason(keys[0], ticket) ?? '');
}

/**
 * Ouvre la rédaction sous les actions, sans quitter le ticket.
 *
 * Une fenêtre modale masque exactement ce qu'on doit relire pour répondre. Ici
 * le message se compose au-dessous du fil, qui reste visible.
 */
/**
 * Objet d'une réponse : celui du fil, préfixé une seule fois.
 *
 * Gmail n'empile pas les « Re: » et nous non plus — « Re: Re: Re: Commande »
 * signale un outil, pas une personne. Le préfixe est reconnu quelle que soit
 * sa casse et quelle que soit sa langue d'origine, puisque la clientèle écrit
 * aussi en anglais et en espagnol.
 */
function replySubject(ticket) {
  const raw = (ticket.subject ?? '').trim();
  if (!raw) return 'Votre commande';

  const bare = raw.replace(/^((re|rép|rep|ref|rv|aw|antw|res)\s*(\[\d+\])?\s*:\s*)+/i, '');
  return `Re: ${bare || 'votre commande'}`;
}

function openCompose(ticket) {
  /* Un signalement fait sans adresse client connue porte l'adresse de repli
     de l'atelier, `fournisseur+…@local`. Le mail partirait vers une adresse
     qui n'existe pas, et l'agent croirait le client prévenu. */
  if (String(ticket?.customerEmail ?? '').startsWith('fournisseur+')) {
    toast('Ce signalement vient de l’atelier : écrivez au client depuis sa commande.', true);
    return;
  }

  const zone = $('compose');
  setComposeOpen(true);

  $('compose-title').textContent = 'Écrire au client';

  // Les icônes se posent ici et non au chargement : `ICONS` est un `const`
  // déclaré plus bas, hors de portée quand ce fichier s'exécute.
  const modal = zone.querySelector('.compose-modal');
  const expanded = modal.classList.contains('expanded');
  $('compose-expand').innerHTML = ico(expanded ? 'collapse' : 'expand');
  $('compose-close').innerHTML = ico('close');

  const body = $('compose-body');
  body.placeholder = 'Votre message au client…';

  /*
   * La signature entre avec le message : rien d'autre ne l'ajoute pour le
   * client. Elle vit dans le corps, donc se corrige comme le reste — le
   * curseur reste au-dessus.
   */
  const signature = currentSignature();
  body.value = signature ? `\n\n${signature}` : '';
  zone.dataset.initialBody = body.value;

  const subject = $('compose-subject');
  subject.value = replySubject(ticket);
  $('compose-to').textContent = ticket.customerEmail ?? '';
  renderComposeCanned(ticket);
  zone.dataset.initialSubject = subject.value;

  renderComposeSignatureBadge(signature);

  body.focus();
  body.setSelectionRange(0, 0);

  // Le destinataire est dans le champ « À » : le répéter ici doublonnait.
  $('compose-hint').textContent = '';
}

/*
 * Ouvrir et fermer se font en un seul endroit.
 *
 * La fenêtre est un `.backdrop` : c'est `.open` qui l'affiche, et c'est
 * `.backdrop.open` que la garde des raccourcis clavier cherche. `hidden` reste
 * posé en parallèle pour le code qui lit `$('compose').hidden`.
 */
function setComposeOpen(open) {
  const zone = $('compose');
  zone.hidden = !open;
  zone.classList.toggle('open', open);
}

/** La signature du marchand, telle qu'elle est réglée — vide si aucune. */
function currentSignature() {
  return (state.me?.merchant?.emailSignature ?? '').trim();
}

function renderComposeSignatureBadge(signature) {
  const badge = $('compose-sig');
  badge.hidden = false;

  badge.innerHTML = signature
    ? '<b aria-hidden="true">✓</b> Signature automatique activée'
    : 'Aucune signature — <button type="button" class="linkish" id="compose-sig-set">la configurer</button>';

  $('compose-sig-set')?.addEventListener('click', async () => {
    if (!(await closeCompose())) return;
    voletReglages = 'boutique';
    setView('settings');
  });
}

/** Le message a-t-il bougé depuis l'ouverture — signature comprise ? */
function composeDirty() {
  const zone = $('compose');
  return (
    $('compose-body').value !== (zone.dataset.initialBody ?? '') ||
    $('compose-subject').value !== (zone.dataset.initialSubject ?? '')
  );
}

/*
 * Fermer sans perdre en silence.
 *
 * Il n'existe ni brouillon automatique ni protection pour cette zone : ce qui
 * s'y tape ne vit qu'à l'écran. Refermer sur un texte modifié demande donc
 * confirmation. `force` sert aux fermetures qui suivent une action aboutie —
 * envoi, clôture, changement de ticket — où la question n'aurait pas de sens.
 * Rend `false` si l'utilisateur a préféré garder sa fenêtre.
 */
async function closeCompose({ force = false } = {}) {
  const zone = $('compose');
  if (zone.hidden) return true;

  if (!force && composeDirty()) {
    if (!(await confirmer('Abandonner ce message ?\n\nLe texte saisi sera perdu.', { action: 'Abandonner', danger: true, icone: 'message' }))) {
      return false;
    }
  }

  setComposeOpen(false);
  $('compose-body').value = '';
  return true;
}

/** Les réponses types, classées pour ce ticket : motif d'abord, puis usage. */
function cannedForTicket(ticket) {
  return [...state.canned].sort((a, b) => {
    const matchA = a.intent === ticket.intent ? 1 : 0;
    const matchB = b.intent === ticket.intent ? 1 : 0;
    return matchB - matchA || b.useCount - a.useCount;
  });
}

/** Variables résolues à l'insertion : un « {{prenom}} » envoyé tel quel est pire que pas de modèle. */
function fillCanned(item, ticket, order) {
  return item.body
    .replaceAll('{{prenom}}', (ticket.customerName ?? '').split(' ')[0] ?? '')
    .replaceAll('{{commande}}', ticket.orderName ?? '')
    .replaceAll('{{suivi}}', order?.fulfillments?.[0]?.trackingNumber ?? '')
    .replaceAll('{{boutique}}', state.me?.merchant?.brandName ?? state.me?.merchant?.name ?? '');
}

function renderComposeCanned(ticket) {
  const tools = $('compose-tools');
  if (!state.canned?.length) {
    tools.hidden = true;
    return;
  }

  tools.hidden = false;
  $('compose-canned').innerHTML = cannedForTicket(ticket)
    .slice(0, 6)
    .map(
      (item) => `<button type="button" class="qchip" data-compose-insert="${esc(item.id)}"${
        item.intent === ticket.intent ? ' aria-pressed="true"' : ''
      }>${esc(item.title)}</button>`,
    )
    .join('');
}

$('compose-canned')?.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-compose-insert]');
  if (!button) return;

  const item = state.canned.find((candidate) => candidate.id === button.dataset.composeInsert);
  const ticket = state.detail?.ticket;
  if (!item || !ticket) return;

  const filled = fillCanned(item, ticket, state.detail?.order);
  const body = $('compose-body');

  // À l'endroit du curseur, pas en fin de texte : la signature est en bas, et
  // le message s'écrit au-dessus d'elle.
  const at = body.selectionStart ?? 0;
  const before = body.value.slice(0, at);
  const after = body.value.slice(at);
  const glue = before.trim() && !before.endsWith('\n\n') ? '\n\n' : '';
  body.value = `${before}${glue}${filled}${after}`;
  const cursor = (before + glue + filled).length;
  body.setSelectionRange(cursor, cursor);
  body.focus();

  await api(`/api/canned-replies/${item.id}/used`, { method: 'POST' }).catch(() => {});
  toast('Réponse insérée — à relire avant envoi.');
});

$('compose-close')?.addEventListener('click', () => closeCompose());

/*
 * Agrandir / Restaurer : une classe sur la fenêtre, rien d'autre.
 *
 * Le composant n'est ni recréé ni re-rendu — le brouillon, l'objet, la
 * signature et le curseur restent exactement où ils sont. Le choix survit à
 * la fermeture : celui qui a agrandi une fois retrouve sa fenêtre grande.
 */
$('compose-expand')?.addEventListener('click', () => {
  const modal = $('compose').querySelector('.compose-modal');
  const expanded = modal.classList.toggle('expanded');
  const button = $('compose-expand');
  button.setAttribute('aria-pressed', String(expanded));
  button.title = expanded ? 'Restaurer' : 'Agrandir';
  button.setAttribute('aria-label', button.title);
  button.innerHTML = ico(expanded ? 'collapse' : 'expand');
  $('compose-body').focus();
});

// Échap ferme la fenêtre — avec la même confirmation qu'un clic sur « × » si
// le texte a bougé. Écouté à part : le gestionnaire général des raccourcis
// se tait dès que le curseur est dans un champ, ce qui est justement le cas.
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape' || $('compose').hidden) return;
  event.preventDefault();
  closeCompose();
});

$('compose-cancel')?.addEventListener('click', () => closeCompose());

/*
 * Clore sans répondre.
 *
 * Tout ne se règle pas par un mail : une notification de plateforme, un
 * doublon, un client déjà satisfait. Sans ce geste, ces tickets restent dans la
 * file et l'on finit par ne plus la croire.
 */
$('compose-resolve')?.addEventListener('click', async () => {
  const ticket = state.detail?.ticket;
  if (!ticket) return;

  try {
    const result = await api(`/api/tickets/${ticket.id}/resolve`, {
      method: 'POST',
      body: '{}',
    });

    closeCompose({ force: true });
    await loadQueue();

    // Annulable : refermer par erreur un ticket qui attendait un fournisseur
    // doit se défaire, et une confirmation préalable aurait ralenti les
    // quatre-vingt-dix-neuf fois où le geste est juste.
    toastUndo('Message clos.', async () => {
      await api(`/api/tickets/${ticket.id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status: result.previousStatus }),
      });
      await loadQueue();
    });
  } catch (error) {
    toast(error.message, true);
  }
});

$('compose-send')?.addEventListener('click', async () => {
  const text = $('compose-body').value.trim();
  const ticket = state.detail?.ticket;

  if (!text || !ticket) return;

  $('compose-send').disabled = true;
  try {
    await api('/api/emails', {
      method: 'POST',
      body: JSON.stringify({
        to: ticket.customerEmail,
        // Ce que l'agent lit dans le champ, pas ce qu'on aurait recalculé :
        // un objet corrigé puis ignoré à l'envoi serait pire que pas de
        // champ du tout.
        subject: $('compose-subject').value.trim() || replySubject(ticket),
        body: text,
        // Rattaché au fil : la réponse s'écrit dans la conversation, elle
        // ne part pas dans le vide.
        ticketId: ticket.id,
      }),
    });
    toast('Message envoyé au client — visible dans le fil.');
    closeCompose({ force: true });
    await selectTicket(ticket.id);
  } catch (error) {
    toast(error.message, true);
  } finally {
    $('compose-send').disabled = false;
  }
});

function actionBlockedReason(key, ticket) {
  if (key === 'refund') {
    if (!canI('refund')) return 'Seuls le propriétaire et les superviseurs peuvent rembourser.';
    if (!ticket.shopifyOrderId) return 'Aucune commande rattachée à ce message.';
  }
  if ((key === 'substitute' || key === 'tracking') && !ticket.shopifyOrderId) {
    return 'Aucune commande rattachée à ce message.';
  }
  if (key === 'annulation' && !shopifyOrderLink(state.detail?.order)) return 'Aucune commande Shopify rattachée.';
  if (['supplier', 'modification', 'update'].includes(key)) {
    if (!canI('escalate')) return 'Votre rôle ne permet pas d’escalader.';
    if (activeSuppliers().length === 0) return 'Aucun fournisseur actif à qui adresser la demande.';
  }
  if (key === 'client' && !canI('reply')) return 'Vous êtes en lecture seule.';
  /*
   * Le serveur n'exige aucun droit sur `/api/returns` : un rôle en lecture
   * seule peut y créer, modifier et supprimer un dossier. Le contrôle posé ici
   * ne referme pas ce trou — il est côté écran, donc contournable — mais il
   * évite d'offrir le geste à qui ne devrait pas l'avoir. Le verrou serveur
   * reste à poser.
   */
  if (key === 'reshipment' && !canI('reply')) return 'Vous êtes en lecture seule.';
  if (key === 'renvoi') {
    if (!canI('reply')) return 'Vous êtes en lecture seule.';
    if (!ticket.shopifyOrderId) return 'Aucune commande rattachée à ce message.';
  }
  return null;
}

/*
 * Navigation et menu de débordement de l'en-tête.
 *
 * Les flèches appellent `moveQueue`, la même fonction que `j` et `k` : deux
 * chemins vers un seul comportement, et non deux comportements qui se
 * ressemblent. Elles ne sont pas soumises au verrou d'une autre boutique —
 * parcourir la file d'un groupe est permis, c'est y répondre qui ne l'est pas.
 */
/* Le champ de la barre haute n'est pas une seconde recherche : il ouvre la
   palette, qui est la recherche. Deux moteurs pour une question donneraient
   deux réponses différentes le jour où l'un des deux évoluerait. */
$('head-search')?.addEventListener('click', () => openPalette());

/* Le clic s'arrête ici. Il ouvrait la fenêtre, puis remontait jusqu'au
   document, dont l'écouteur « clic dehors » la refermait aussitôt : le
   bouton semblait ne rien faire. */
$('queue-filter')?.addEventListener('click', (event) => {
  event.stopPropagation();
  ouvrirFiltres(!fenetreFiltresOuverte());
});

/*
 * Trier et présenter, depuis l'en-tête.
 *
 * Un menu du Mac : « Trier par », le choix en cours coché, puis Liste ou
 * Tableau. Le choix écrit dans `state.queue.sort`, la seule vérité du tri — le
 * `select` qui le doublait dans l'ancienne rangée de filtres a disparu avec
 * elle.
 */
const TRIS = [
  ['newest', 'Plus récent'],
  ['oldest', 'Plus ancien'],
  ['due', 'Échéance proche'],
  ['amount', 'Montant élevé'],
  ['confidence', 'Confiance basse'],
];

function renderSortMenu() {
  const liste = $('qtri-liste');
  if (!liste) return;

  liste.innerHTML = TRIS.map(
    ([cle, nom]) =>
      `<button class="qf-ligne" type="button" role="menuitemradio" data-sort="${cle}"
        aria-checked="${cle === state.queue.sort}"><span class="qf-coche" aria-hidden="true"></span><span
        class="qf-nom">${esc(nom)}</span></button>`,
  ).join('');
}

$('qtri-liste')?.addEventListener('click', (event) => {
  const choix = event.target.closest('[data-sort]');
  if (!choix) return;
  state.queue.sort = choix.dataset.sort;
  closeSortMenu();
  void loadQueue();
});

function closeSortMenu() {
  const menu = $('queue-sort-menu');
  if (!menu || menu.hidden) return;
  menu.hidden = true;
  $('queue-sort')?.setAttribute('aria-expanded', 'false');
}

$('queue-sort')?.addEventListener('click', (event) => {
  event.stopPropagation();
  const menu = $('queue-sort-menu');
  if (!menu) return;

  const open = menu.hidden;
  if (open) {
    // Un menu à la fois : la fenêtre Filtres se referme.
    ouvrirFiltres(false);
    renderSortMenu();
  }
  menu.hidden = !open;
  $('queue-sort').setAttribute('aria-expanded', String(open));
});

$('d-prev')?.addEventListener('click', () => moveQueue(-1));
$('d-next')?.addEventListener('click', () => moveQueue(1));

function closeMoreMenu() {
  const menu = $('d-more-menu');
  if (!menu || menu.hidden) return;
  menu.hidden = true;
  $('d-more')?.setAttribute('aria-expanded', 'false');
}

$('d-more')?.addEventListener('click', (event) => {
  event.stopPropagation();
  const menu = $('d-more-menu');
  if (!menu) return;

  const open = menu.hidden;
  menu.hidden = !open;
  $('d-more').setAttribute('aria-expanded', String(open));
});

/* Un clic ailleurs referme, comme le menu de mise en veille juste à côté :
   un menu qui reste ouvert après qu'on a regardé autre chose finit par
   masquer ce qu'on voulait lire. */
document.addEventListener('click', (event) => {
  if (!event.target.closest('.more-wrap')) {
    closeMoreMenu();
    closeSortMenu();
  }
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    closeMoreMenu();
    closeSortMenu();
  }
});

/**
 * Bouton d'action pour la barre de libellés, soumis aux mêmes droits que la
 * barre d'actions : un agent ne peut pas rembourser, et doit le lire plutôt
 * que de le découvrir sur un refus du serveur.
 */
function actionButton(key, label, ticket, className = 'btn btn-small') {
  const blocked = actionBlockedReason(key, ticket);

  return `<button class="${className}" type="button" data-quick="${key}"${
    blocked ? ` disabled title="${esc(blocked)}"` : ''
  }>${esc(label)}</button>`;
}

$('actbar-row').addEventListener('click', async (event) => {
  const button = event.target.closest('.actbtn');
  if (!button || button.disabled) return;

  const key = button.dataset.act;
  const { ticket } = state.detail;

  $('actbar-row')
    .querySelectorAll('.actbtn')
    .forEach((other) => other.classList.toggle('on', other === button));
  $('actbar-note').textContent = ACTION_META[key].note;
  $('subs').hidden = true;

  if (key === 'refund') return $('btn-refund').click();
  if (key === 'client') return openCompose(ticket);
  if (key === 'supplier') return openChangeRequest(ticket);
  if (key === 'tracking') return setView('tracking');
  if (key === 'substitute') return loadSubstitutions(ticket.id);
});

/**
 * Dossier de retour ouvert depuis le mail du client.
 *
 * C'est le chemin naturel : le client écrit « la 44 est trop petite », et le
 * dossier part de là — commande, nom, téléphone, article et pays déjà remplis
 * depuis la commande rattachée. Retaper tout cela dans l'écran Reshipment,
 * c'est la garantie qu'on ne le fera pas.
 *
 * Le dossier ne portera aucun lien vers ce ticket : `ReturnCase` n'a pas de
 * `ticketId`. Le seul pont est l'email du client et le numéro de commande, que
 * la fiche client exploite déjà pour rapprocher les deux. D'où l'attention
 * portée à les renseigner, même quand Shopify n'a rien rendu.
 */
async function openReshipment(ticket) {
  const order = state.detail?.order;
  const line = order?.lineItems?.[0];

  // Les agences avant l'ouverture : le champ se remplit une fois, pas après
  // que l'agent a commencé à taper.
  await ensureReturnAgencies();

  openReturnModal({
    order: order?.name ?? ticket.orderName ?? '',
    name: order?.shippingAddress?.name ?? ticket.customerName ?? '',
    phone: order?.shippingAddress?.phone ?? '',
    product: line?.title ?? '',
    variant: line?.variantTitle ?? '',
    sku: line?.sku ?? '',
    // Toute la commande, pas seulement son premier article : sur trois paires
    // renvoyées, celle que le client rend n'est pas forcément la première.
    items: order?.lineItems ?? [],
    country: order?.shippingAddress?.country ?? 'FR',
    email: ticket.customerEmail ?? order?.customer?.email ?? null,
    orderId: ticket.shopifyOrderId ?? order?.id ?? null,
  });
}

/*
 * Renvoi, depuis le message du client.
 *
 * « Je n'ai jamais reçu mes Runner Halo » : la commande et ses produits sont
 * déjà là, et dessous les paires du stock retours qui leur correspondent —
 * même référence, ou même modèle et même déclinaison, comme le rapprochement
 * du serveur. On en choisit une ; elle est réservée à la commande, et
 * l'agence qui la garde la renvoie au client.
 */
const renvoi = { order: null, ticket: null, article: 0, paire: null, paires: [] };

const sansAccents = (texte) =>
  (texte ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/** La paire convient-elle à l'article ? Même règle que `correspond` côté serveur. */
function paireCorrespond(paire, article) {
  const skuPaire = sansAccents(paire.sku);
  const skuArticle = sansAccents(article?.sku);
  if (skuPaire && skuArticle) return skuPaire === skuArticle;
  return (
    sansAccents(paire.productTitle) === sansAccents(article?.title) &&
    sansAccents(paire.variantTitle) === sansAccents(article?.variantTitle)
  );
}

async function ouvrirRenvoi(ticket) {
  const order = state.detail?.order;
  if (!order && !ticket.shopifyOrderId) return toast('Aucune commande rattachée à ce message.', true);
  Object.assign(renvoi, { order, ticket, article: 0, paire: null, paires: [] });
  const adresse = order?.shippingAddress ?? {};
  $('rv-commande').value = order?.name ?? ticket.orderName ?? '';
  // Le client de la commande : le message peut venir de l'atelier.
  const pays = adresse.countryCode ?? adresse.country;
  $('rv-client').value = [
    adresse.name ?? order?.customer?.displayName ?? ticket.customerName,
    [adresse.city, pays ? nomPays(pays) : null].filter(Boolean).join(', '),
  ]
    .filter(Boolean)
    .join(' · ');
  $('rv-paires').innerHTML = '<p class="rv-vide">Recherche dans le stock…</p>';
  // Une commande déjà remboursée : le renvoi reste possible, mais on prévient.
  const rembourse = ['REFUNDED', 'PARTIALLY_REFUNDED'].includes(order?.displayFinancialStatus);
  $('rv-alerte').hidden = !rembourse;
  $('rv-alerte').textContent = rembourse
    ? `Commande ${order.displayFinancialStatus === 'REFUNDED' ? 'remboursée' : 'remboursée en partie'} : vérifiez avant de renvoyer une paire.`
    : '';
  renderRenvoiProduits();
  $('rv-modal').hidden = false;
  $('rv-modal').classList.add('open');
  try {
    // Le stock de l'instant : une paire réservée entre-temps ne doit pas être proposée.
    const data = await api('/api/returns');
    state.returns.cases = data.cases ?? [];
  } catch (error) {
    $('rv-paires').innerHTML = `<p class="rv-vide">${esc(error.message)}</p>`;
    return;
  }
  renderRenvoiPaires();
}

function fermerRenvoi() {
  $('rv-modal').hidden = true;
  $('rv-modal').classList.remove('open');
}

function renderRenvoiProduits() {
  const articles = renvoi.order?.lineItems ?? [];
  $('rv-produits').innerHTML = articles.length
    ? articles
        .map(
          (article, i) => `<button type="button" class="rv-ligne" role="radio" data-rv-article="${i}" aria-checked="${i === renvoi.article}">
            <span class="rv-rond" aria-hidden="true"></span>
            ${article.image ? `<img src="${esc(article.image)}" alt="" loading="lazy" />` : '<i aria-hidden="true"></i>'}
            <span class="rv-txt"><b>${esc(article.title ?? '')}</b><small>${esc(
              [article.variantTitle, article.sku].filter(Boolean).join(' · '),
            )}</small></span>
          </button>`,
        )
        .join('')
    : '<p class="rv-vide">La commande ne liste aucun produit.</p>';
}

function renderRenvoiPaires() {
  const article = renvoi.order?.lineItems?.[renvoi.article];
  const adresse = renvoi.order?.shippingAddress ?? {};
  const pays = adresse.countryCode ?? adresse.country ?? null;
  const joursDepuis = (date) => Math.max(0, Math.floor((Date.now() - new Date(date).getTime()) / 86_400_000));
  const paysDe = (paire) => paire.agency?.country ?? paire.country ?? null;
  // Le même pays d'abord — livré en trois jours —, puis la plus ancienne en stock.
  renvoi.paires = article
    ? state.returns.cases
        .filter((paire) => paire.status === 'RESTOCKED' && !paire.reusedAt && paireCorrespond(paire, article))
        .sort(
          (a, b) =>
            Number(paysDe(b) === pays) - Number(paysDe(a) === pays) ||
            new Date(a.restockedAt ?? a.updatedAt) - new Date(b.restockedAt ?? b.updatedAt),
        )
    : [];
  if (!renvoi.paires.some((paire) => paire.id === renvoi.paire)) renvoi.paire = renvoi.paires[0]?.id ?? null;

  // Une paire déjà réservée à cette commande : le serveur refuserait la seconde.
  const orderId = renvoi.ticket?.shopifyOrderId ?? renvoi.order?.id;
  const reservee = state.returns.cases.find((paire) => orderId && paire.reusedShopifyOrderId === orderId);
  if (reservee) {
    renvoi.paires = [];
    renvoi.paire = null;
    $('rv-paires').innerHTML = `<p class="rv-vide">Une paire du stock est déjà réservée à ${esc(
      renvoi.order?.name ?? 'cette commande',
    )} : ${esc([reservee.productTitle, reservee.variantTitle].filter(Boolean).join(' · '))}${
      reservee.reshippedAt ? `, expédiée (${esc(reservee.reshipTrackingNumber ?? '')})` : ', pas encore expédiée'
    }.</p>`;
    $('rv-note').textContent = 'Pour la libérer, passez par la page Renvoi.';
    $('rv-send').disabled = true;
    return;
  }

  $('rv-paires').innerHTML = renvoi.paires.length
    ? renvoi.paires
        .map((paire) => {
          const ou =
            paire.origine === 'MANUEL' && !paire.agency
              ? 'Chez vous'
              : [paire.agency?.name, nomPays(paysDe(paire))].filter(Boolean).join(' · ');
          const detail = [
            paire.origine === 'MANUEL' ? `Ajout manuel${paire.note ? ` · ${paire.note}` : ''}` : `Retour ${paire.orderName ?? '—'} · contrôlée`,
            `en stock depuis ${joursDepuis(paire.restockedAt ?? paire.updatedAt)} j`,
          ].join(' · ');
          const memePays = !pays || paysDe(paire) === pays;
          return `<button type="button" class="rv-ligne" role="radio" data-rv-paire="${esc(paire.id)}" aria-checked="${paire.id === renvoi.paire}">
            <span class="rv-rond" aria-hidden="true"></span>
            <span class="rv-txt"><b>${esc(ou)}</b><small>${esc(detail)}</small></span>
            <span class="rv-tag ${memePays ? 'ok' : 'warn'}">${memePays ? 'Même pays' : 'Autre pays'}</span>
          </button>`;
        })
        .join('')
    : `<div class="rv-vide">Aucune paire « ${esc([article?.title, article?.variantTitle].filter(Boolean).join(' · ') || 'de ce produit')} » en stock.
        <button type="button" class="rv-lien" data-rv-fournisseur>Demander au fournisseur</button></div>`;

  const choisie = renvoi.paires.find((paire) => paire.id === renvoi.paire);
  $('rv-note').textContent = choisie
    ? choisie.agency
      ? `La paire est réservée à ${renvoi.order?.name ?? 'la commande'} et l’agence ${choisie.agency.name} la renvoie au client.`
      : `La paire est réservée à ${renvoi.order?.name ?? 'la commande'} : c’est à vous de l’expédier.`
    : 'Rien à renvoyer depuis le stock : la demande peut partir chez le fournisseur.';
  $('rv-send').disabled = !choisie || !canI('reply');
}

$('rv-modal')?.addEventListener('click', (event) => {
  if (event.target === event.currentTarget) return fermerRenvoi();
  const article = event.target.closest('[data-rv-article]');
  if (article) {
    renvoi.article = Number(article.dataset.rvArticle);
    renvoi.paire = null;
    renderRenvoiProduits();
    return renderRenvoiPaires();
  }
  const paire = event.target.closest('[data-rv-paire]');
  if (paire) {
    renvoi.paire = paire.dataset.rvPaire;
    return renderRenvoiPaires();
  }
  if (event.target.closest('[data-rv-fournisseur]')) {
    fermerRenvoi();
    openChangeRequest(renvoi.ticket);
  }
});
$('rv-close')?.addEventListener('click', fermerRenvoi);
$('rv-cancel')?.addEventListener('click', fermerRenvoi);
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && $('rv-modal')?.classList.contains('open')) fermerRenvoi();
});

$('rv-send')?.addEventListener('click', async () => {
  const { order, ticket } = renvoi;
  const choisie = renvoi.paires.find((paire) => paire.id === renvoi.paire);
  if (!choisie) return;
  const orderId = ticket?.shopifyOrderId ?? order?.id;
  const orderName = order?.name ?? ticket?.orderName ?? '';
  $('rv-send').disabled = true;
  try {
    const reponse = await api('/api/returns/reemploi', {
      method: 'POST',
      body: JSON.stringify({ orderId, orderName, returnIds: [choisie.id], renvoi: true }),
    });
    fermerRenvoi();
    toast(
      reponse.agence
        ? `${orderName} : l’agence ${reponse.agence.name} renvoie la paire au client.`
        : `${orderName} : la paire de votre stock lui est réservée.`,
    );
  } catch (error) {
    toast(error.message, true);
    $('rv-send').disabled = false;
  }
});

/**
 * Demande de changement adressée au fournisseur, depuis le mail du client.
 *
 * C'est le chemin naturel : le client écrit « finalement la 45 », et la
 * demande part de là — avec sa commande, son article et sa déclinaison
 * actuelle déjà remplis. Retaper tout cela dans l'écran Fournisseurs, c'est
 * la garantie qu'on ne le fera pas, ou qu'on se trompera de commande.
 */
function openChangeRequest(ticket, options = {}) {
  const order = state.detail?.order;
  $('alert-modal').dataset.motifs = (options.motifs ?? []).join(',');
  $('alert-modal').querySelector('.modal-head h2').textContent = options.titre ?? 'Contacter le fournisseur';

  $('alert-modal').dataset.supplier = '';
  $('alert-modal').dataset.ticket = ticket.id;
  $('alert-modal').dataset.order = order?.id ?? '';
  $('alert-who').textContent = order?.name
    ? `Commande ${order.name} · ${ticket.customerName ?? ticket.customerEmail}`
    : (ticket.customerName ?? ticket.customerEmail);

  state.alertCtx = alertContextFromOrder(order);
  setAlertKind(options.motifs?.[0] ?? 'SIZE');
  $('alert-order').value = order?.name ?? ticket.orderName ?? '';
  $('alert-message').value = '';

  renderAlertSuppliers();
  $('alert-modal').hidden = false;
  $('alert-modal').classList.add('open');
  $('alert-after').focus();
}

/** Le fournisseur destinataire : celui par défaut d'abord, il traite le gros. */
function renderAlertSuppliers() {
  const pick = $('alert-supplier');
  if (!pick) return;

  const usable = activeSuppliers();
  const preselect = $('alert-modal').dataset.supplier;

  pick.innerHTML = usable
    .map(
      (supplier) =>
        `<option value="${esc(supplier.id)}"${
          supplier.id === preselect || (!preselect && supplier.isDefault) ? ' selected' : ''
        }>${esc(supplier.name)}</option>`,
    )
    .join('');
}

async function loadSubstitutions(ticketId) {
  const box = $('subs');
  box.hidden = false;
  box.innerHTML = '<p class="empty">Recherche des références en stock…</p>';

  let data;
  try {
    data = await api(`/api/tickets/${ticketId}/substitutions`);
  } catch (error) {
    box.innerHTML = `<p class="empty">${esc(error.message)}</p>`;
    return;
  }

  if (!data.options?.length) {
    box.innerHTML = `<p class="empty">${esc(
      data.reason ?? 'Aucune référence équivalente en stock pour le moment.',
    )}</p>`;
    return;
  }

  box.innerHTML = data.options
    .slice(0, 6)
    .map(
      (option) => `
      <button class="sub" data-sub="${esc(option.id)}"
        data-label="${esc(
          `${option.productTitle}${option.variantTitle ? ` — ${option.variantTitle}` : ''}`,
        )}">
        ${
          option.image
            ? `<img src="${esc(option.image)}" alt="" loading="lazy" />`
            : '<span class="sub-blank"></span>'
        }
        <span style="min-width:0">
          <b>${esc(option.productTitle)}</b>
          <small>${esc(option.variantTitle ?? '—')}</small>
          <small class="sub-stock">${
            option.inventoryQuantity ?? 0
          } en stock</small>
        </span>
      </button>`,
    )
    .join('');

  box.querySelectorAll('.sub').forEach((button) => {
    button.addEventListener('click', () => {
      // On insère une phrase dans le brouillon plutôt que d'envoyer : le
      // remplacement d'un article se propose, il ne s'impose pas.
      const body = $('d-body');
      const sentence = `Nous pouvons vous proposer en remplacement : ${button.dataset.label}, disponible immédiatement. Confirmez-vous ce choix ?`;

      body.value = body.value.trim() ? `${body.value.trim()}\n\n${sentence}` : sentence;
      body.focus();
      toast('Proposition ajoutée au brouillon — à relire avant envoi.');
    });
  });
}

/* ------------------------------------------------ fenêtre Filtres de la file */

const INTENT_LABELS = {
  WISMO: 'WISMO',
  RETURN: 'Retour',
  DISPUTE: 'Litige',
  REFUND: 'Remboursement',
  PRODUCT_QUESTION: 'Question produit',
  POSITIVE: 'Message positif',
  OTHER: 'Autre',
};

/*
 * La fenêtre Filtres, comme dans Mail.
 *
 * Tout ce qui restreint la file tient dans une fenêtre qui s'ouvre sous le
 * bouton filtre de l'en-tête Conversations, au-dessus de la liste qu'elle
 * filtre. Elle remplace une rangée entière — onze libellés, un compte, quatre
 * menus — dont la fenêtre s'ouvrait à droite, par-dessus le message.
 *
 * Elle se lit comme un menu du Mac : « Afficher », un seul choix coché ;
 * « Seulement », des cases qui se croisent ; les libellés du marchand avec
 * leur couleur ; Motif, Assigné et Boîte en menus locaux. Ce qui est posé se
 * voit ensuite en jetons sous les dossiers, qu'une croix retire. Au
 * téléphone, la même fenêtre monte du bas en feuille, et ses cases
 * deviennent des interrupteurs.
 */
const FILTRE_STATUTS = [
  ['', 'Tous'],
  ['NEEDS_REVIEW', 'À valider'],
  ['DRAFT_READY', 'Brouillon prêt'],
  ['NEW', 'Nouveaux'],
  ['AWAITING_SUPPLIER', 'Chez le fournisseur'],
  ['CLOSED', 'Clos'],
];

/* Des filtres qui croisent le statut au lieu de le remplacer : WISMO est un
   motif, « Non lus » un état de lecture, le reste des raccourcis. Le
   troisième terme nomme le compteur du serveur, quand il en existe un. */
const FILTRE_SEULEMENT = [
  ['unread', 'Non lus', 'UNREAD'],
  ['wismo', 'WISMO', 'WISMO'],
  ['urgent', 'Urgents · 3 j et plus'],
  ['unassigned', 'Non assignés'],
  ['unlinked', 'Sans commande'],
  ['dueSoon', 'Litiges à échéance'],
  ['bigAmount', 'Montant > 100 €'],
  ['historical', 'Historique appris'],
];

/* La fenêtre suit la largeur : sous ce seuil, elle devient une feuille. */
const FEUILLE_FILTRES = window.matchMedia('(max-width: 760px)');

function fenetreFiltresOuverte() {
  return $('qf')?.hidden === false;
}

function seulementActif(cle) {
  return cle === 'wismo' ? state.queue.intent === 'WISMO' : Boolean(state.queue[cle]);
}

function basculerSeulement(cle) {
  const f = state.queue;

  if (cle === 'wismo') {
    f.intent = f.intent === 'WISMO' ? '' : 'WISMO';
    $('q-intent').value = f.intent;
    return;
  }

  f[cle] = !f[cle];

  // Le raccourci et le menu « Assigné » désignent la même chose : les laisser
  // diverger afficherait deux vérités contradictoires à l'écran.
  if (cle === 'unassigned') {
    f.assignee = f.unassigned ? 'none' : '';
    $('q-assignee').value = f.assignee;
  }

  // « Historique appris » n'est pas un filtre de plus, c'est un autre corpus :
  // les échanges importés et le travail en cours ne cohabitent jamais dans la
  // même liste. Les mêler donnerait des compteurs impossibles à interpréter.
  if (cle === 'historical' && f.historical) {
    state.filter = '';
    f.urgent = false;
    f.unassigned = false;
    f.unlinked = false;
    f.assignee = '';
    $('q-assignee').value = '';
  }
}

/* Les libellés que portent les tickets, plus ceux qui sont cochés : un libellé
   coché reste proposé même si le filtre vide la file, sinon la ligne qu'on
   vient de cocher disparaîtrait sous le doigt. Les étiquettes privées du
   compte Gmail — Impôts, EDF — ne filtrent rien ici et n'y figurent pas. */
function libellesProposes() {
  const noms = new Set(state.queueLabels ?? []);
  for (const nom of state.queue.labels) noms.add(nom);
  return [...noms].sort((a, b) => a.localeCompare(b, 'fr'));
}

/* Gmail range ses libellés en arborescence : « SAV/Litige » se lit
   « Litige », le chemin complet reste en infobulle. */
const feuilleDuLibelle = (nom) => (nom.includes('/') ? nom.slice(nom.lastIndexOf('/') + 1) : nom);

function pastilleDuLibelle(nom) {
  const fond = labelStyles[nom]?.background;
  return `<i class="qf-pastille" style="background:${esc(fond || 'var(--line)')}" aria-hidden="true"></i>`;
}

/* Une ligne de la fenêtre : la coche à gauche comme dans un menu du Mac, le
   nom, le compte en gris. Les cases de « Seulement » portent aussi un
   interrupteur, que seule la feuille du téléphone montre. */
function ligneFiltre({ cle, role, coche, nom, n = '', pastille = '', titre = '', interrupteur = false }) {
  return `<button type="button" class="qf-ligne" role="${role}" aria-checked="${coche}"
    data-qf="${esc(cle)}"${titre ? ` title="${esc(titre)}"` : ''}><span class="qf-coche"
    aria-hidden="true"></span>${pastille}<span class="qf-nom">${esc(nom)}</span>${
      n === '' ? '' : `<span class="qf-n">${esc(n)}</span>`
    }${interrupteur ? '<span class="qf-inter" aria-hidden="true"></span>' : ''}</button>`;
}

/*
 * Ce que contient la liste, dit comme le sous-titre d'une boîte de Mail :
 * « 5 923 messages, 52 non lus », ou « Filtrée · 12 messages ».
 *
 * Les compteurs du serveur honorent déjà le dossier et tous les filtres sauf
 * le statut ; le statut coché lit donc son propre compteur. Le nombre est
 * celui de la liste entière, pas des cinquante lignes chargées.
 */
function compteDeLaFile() {
  if (!state.queueLoaded) return '';
  const counts = state.queueCounts ?? {};
  const n = state.filter ? (counts[state.filter] ?? 0) : (counts.ALL ?? 0);
  const messages = `${n.toLocaleString('fr-FR')} message${n > 1 ? 's' : ''}`;
  if (queueIsFiltered()) return `Filtrée · ${messages}`;

  const nonLus = counts.UNREAD ?? 0;
  return nonLus > 0
    ? `${messages}, ${nonLus.toLocaleString('fr-FR')} non lu${nonLus > 1 ? 's' : ''}`
    : messages;
}

function renderFiltres() {
  const boite = $('qf-listes');
  if (!boite) return;

  const counts = state.queueCounts ?? {};
  const nombre = (cle) => (counts[cle] ?? 0).toLocaleString('fr-FR');

  const afficher = FILTRE_STATUTS.map(([statut, nom]) =>
    ligneFiltre({
      cle: `statut:${statut}`,
      role: 'radio',
      coche: state.filter === statut,
      nom,
      n: nombre(statut || 'ALL'),
    }),
  ).join('');

  const seulement = FILTRE_SEULEMENT.map(([cle, nom, compteur]) =>
    ligneFiltre({
      cle: `seul:${cle}`,
      role: 'checkbox',
      coche: seulementActif(cle),
      nom,
      n: compteur ? nombre(compteur) : '',
      interrupteur: true,
    }),
  ).join('');

  const libelles = libellesProposes()
    .map((nom) =>
      ligneFiltre({
        cle: `libelle:${nom}`,
        role: 'checkbox',
        coche: state.queue.labels.includes(nom),
        nom: feuilleDuLibelle(nom),
        titre: nom,
        pastille: pastilleDuLibelle(nom),
      }),
    )
    .join('');

  // Le rendu remplace les lignes : celle qui avait le focus le retrouve, sans
  // quoi le clavier repartirait du haut à chaque case cochée.
  const focus = document.activeElement?.closest?.('#qf [data-qf]')?.dataset.qf;

  boite.innerHTML = `<p class="qf-section">Afficher</p>
    <div class="qf-groupe" role="radiogroup" aria-label="Afficher">${afficher}</div>
    <p class="qf-section">Seulement</p>
    <div class="qf-groupe" role="group" aria-label="Seulement">${seulement}</div>${
      libelles
        ? `<p class="qf-section">Libellés</p>
    <div class="qf-groupe" role="group" aria-label="Libellés">${libelles}</div>`
        : ''
    }`;

  if (focus) {
    [...boite.querySelectorAll('[data-qf]')].find((ligne) => ligne.dataset.qf === focus)?.focus();
  }

  const filtree = queueIsFiltered();
  $('q-reset-groupe').hidden = !filtree;
  $('qf-effacer').disabled = !filtree;
  $('qf-compte').textContent = compteDeLaFile();
}

/*
 * Les filtres posés, un jeton chacun.
 *
 * Un filtre qu'on ne voit pas vide la file sans que rien ne l'explique : c'est
 * le seul défaut sérieux d'une fenêtre qui se referme. Le terme cherché depuis
 * la palette y figure aussi — le champ qui le portait a disparu.
 */
function jetonsPoses() {
  const f = state.queue;
  const jetons = [];

  const terme = f.q.trim();
  if (terme) jetons.push({ cle: 'terme', nom: `« ${terme} »` });
  if (state.filter) {
    const statut = FILTRE_STATUTS.find(([cle]) => cle === state.filter);
    jetons.push({ cle: 'statut', nom: statut?.[1] ?? STATUS_LABELS[state.filter] ?? state.filter });
  }
  for (const [cle, nom] of FILTRE_SEULEMENT) {
    if (seulementActif(cle)) jetons.push({ cle: `seul:${cle}`, nom });
  }
  for (const nom of f.labels) {
    jetons.push({ cle: `libelle:${nom}`, nom: feuilleDuLibelle(nom), titre: nom, pastille: pastilleDuLibelle(nom) });
  }
  // WISMO et « Non assignés » ont déjà leur jeton : le menu local qui les
  // double n'en ajoute pas un second.
  if (f.intent && f.intent !== 'WISMO') {
    jetons.push({ cle: 'intent', nom: `Motif : ${INTENT_LABELS[f.intent] ?? f.intent}` });
  }
  if (f.assignee && f.assignee !== 'none') {
    const agent = state.agents?.find((user) => user.id === f.assignee);
    jetons.push({ cle: 'assignee', nom: `Assigné : ${agent?.name ?? agent?.email ?? 'un agent'}` });
  }
  if (f.mailbox) {
    const boite = state.me?.gmail?.mailboxes?.find((mailbox) => mailbox.id === f.mailbox);
    jetons.push({ cle: 'mailbox', nom: `Boîte : ${boite?.label || boite?.emailAddress || 'une boîte'}` });
  }

  return jetons;
}

function renderJetons() {
  const boite = $('q-jetons');
  if (!boite) return;

  const jetons = jetonsPoses();
  boite.hidden = jetons.length === 0;
  boite.innerHTML = jetons.length
    ? `${jetons
        .map(
          ({ cle, nom, titre = '', pastille = '' }) =>
            `<button type="button" class="qjeton" data-jeton="${esc(cle)}"
              aria-label="Retirer le filtre ${esc(titre || nom)}" title="${esc(
                titre || 'Retirer ce filtre',
              )}">${pastille}<span class="qjeton-nom">${esc(nom)}</span><span class="qjeton-x"
              aria-hidden="true">${ico('close')}</span></button>`,
        )
        .join('')}<button type="button" class="qjetons-effacer" data-jeton="*">Effacer</button>`
    : '';

  // Le bouton filtre se remplit quand un filtre est posé, et le dit.
  const bouton = $('queue-filter');
  if (bouton) {
    bouton.classList.toggle('qh-filtre-actif', jetons.length > 0);
    bouton.setAttribute(
      'aria-label',
      jetons.length
        ? `Filtrer — ${jetons.length} filtre${jetons.length > 1 ? 's' : ''} posé${jetons.length > 1 ? 's' : ''}`
        : 'Filtrer',
    );
  }
}

$('q-jetons')?.addEventListener('click', (event) => {
  const jeton = event.target.closest('[data-jeton]');
  if (!jeton) return;

  const [type, ...reste] = jeton.dataset.jeton.split(':');
  // Un libellé peut lui-même contenir des deux-points.
  const valeur = reste.join(':');
  const f = state.queue;

  if (type === '*') return resetQueueFilters();
  if (type === 'terme') f.q = '';
  else if (type === 'statut') state.filter = '';
  else if (type === 'seul') basculerSeulement(valeur);
  else if (type === 'libelle') f.labels = f.labels.filter((nom) => nom !== valeur);
  else if (type === 'intent') {
    f.intent = '';
    $('q-intent').value = '';
  } else if (type === 'assignee') {
    f.assignee = '';
    f.unassigned = false;
    $('q-assignee').value = '';
  } else if (type === 'mailbox') {
    f.mailbox = '';
    $('q-mailbox').value = '';
  }

  rafraichirFiltres();
});

/* Un geste, trois rendus immédiats, puis la file : la case se coche sous le
   doigt, sans attendre la réponse du serveur. */
function rafraichirFiltres() {
  renderFiltres();
  renderJetons();
  void loadQueue();
}

$('qf')?.addEventListener('click', (event) => {
  const ligne = event.target.closest('[data-qf]');
  if (!ligne) return;

  const [type, ...reste] = ligne.dataset.qf.split(':');
  const valeur = reste.join(':');

  if (type === 'statut') state.filter = valeur;
  else if (type === 'seul') basculerSeulement(valeur);
  else if (type === 'libelle') {
    // Plusieurs à la fois : le serveur les entend en « au moins l'un d'eux ».
    // « Refund » et « Litige » se regardent ensemble.
    const choisis = state.queue.labels;
    state.queue.labels = choisis.includes(valeur)
      ? choisis.filter((nom) => nom !== valeur)
      : [...choisis, valeur];
  }

  // La fenêtre reste ouverte : on coche rarement une seule case.
  rafraichirFiltres();
});

/*
 * Sous le bouton, flèche comprise.
 *
 * La fenêtre est posée à la racine de la page et placée d'après le bouton :
 * la colonne de la file masque ce qui déborde, et la fenêtre est plus haute
 * que l'en-tête qui la porte. Son bord droit suit le bouton, elle s'étend
 * vers la gauche au-dessus de la liste, jamais hors de l'écran. Au
 * téléphone, la feuille du bas n'a rien à calculer.
 */
function placerFiltres() {
  const fenetre = $('qf');
  if (!fenetre || fenetre.hidden) return;

  if (FEUILLE_FILTRES.matches) {
    for (const prop of ['left', 'top', 'width', 'maxHeight']) fenetre.style[prop] = '';
    fenetre.style.removeProperty('--fleche');
    return;
  }

  const bouton = $('queue-filter').getBoundingClientRect();
  const largeur = Math.min(340, innerWidth - 16);
  const gauche = Math.max(8, Math.min(bouton.right + 14 - largeur, innerWidth - largeur - 8));
  const haut = bouton.bottom + 10;

  fenetre.style.width = `${largeur}px`;
  fenetre.style.left = `${gauche}px`;
  fenetre.style.top = `${haut}px`;
  fenetre.style.maxHeight = `${Math.max(240, innerHeight - haut - 12)}px`;
  fenetre.style.setProperty('--fleche', `${Math.round(bouton.left + bouton.width / 2 - gauche)}px`);
}

function ouvrirFiltres(ouvrir) {
  const fenetre = $('qf');
  if (!fenetre) return;

  fenetre.hidden = !ouvrir;
  $('qf-voile').hidden = !ouvrir || !FEUILLE_FILTRES.matches;
  $('queue-filter')?.setAttribute('aria-expanded', String(ouvrir));
  fenetre.style.removeProperty('transform');
  if (!ouvrir) return;

  closeSortMenu();
  renderFiltres();
  placerFiltres();
  // Le focus entre dans la fenêtre sans s'afficher : les flèches la
  // parcourent ensuite, Échap la referme.
  fenetre.focus({ preventScroll: true });
}

addEventListener('resize', placerFiltres);
FEUILLE_FILTRES.addEventListener('change', () => {
  if (fenetreFiltresOuverte()) ouvrirFiltres(true);
});

/* Un clic à côté referme. Le chemin de l'événement est lu tel qu'il était au
   départ : la ligne cliquée a déjà été remplacée par le rendu, et `closest`
   ne retrouverait plus la fenêtre depuis un nœud détaché. */
document.addEventListener('click', (event) => {
  if (!fenetreFiltresOuverte()) return;
  const chemin = event.composedPath();
  if (chemin.includes($('qf')) || chemin.includes($('queue-filter'))) return;
  ouvrirFiltres(false);
});

document.addEventListener('keydown', (event) => {
  if (!fenetreFiltresOuverte()) return;
  if (event.key === 'Escape') {
    ouvrirFiltres(false);
    $('queue-filter')?.focus();
    return;
  }
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
  if (event.target.closest?.('select')) return;

  // Les flèches parcourent les lignes, comme dans un menu.
  const lignes = [...$('qf').querySelectorAll('.qf-ligne')];
  if (!lignes.length) return;
  event.preventDefault();
  const rang = lignes.indexOf(document.activeElement);
  const pas = event.key === 'ArrowDown' ? 1 : -1;
  const suivant =
    rang < 0 ? (pas > 0 ? lignes[0] : lignes.at(-1)) : lignes[(rang + pas + lignes.length) % lignes.length];
  suivant.focus();
});

$('qf-voile')?.addEventListener('click', () => ouvrirFiltres(false));
$('qf-ok')?.addEventListener('click', () => ouvrirFiltres(false));
$('qf-effacer')?.addEventListener('click', () => resetQueueFilters());

/* La feuille se referme aussi d'un geste vers le bas, depuis sa poignée. */
{
  let depart = null;
  const tete = document.querySelector('#qf .qf-tete');

  tete?.addEventListener('touchstart', (event) => {
    if (!FEUILLE_FILTRES.matches) return;
    depart = event.touches[0].clientY;
  }, { passive: true });

  tete?.addEventListener('touchmove', (event) => {
    if (depart === null) return;
    const ecart = Math.max(0, event.touches[0].clientY - depart);
    $('qf').style.transform = `translateY(${ecart}px)`;
  }, { passive: true });

  tete?.addEventListener('touchend', (event) => {
    if (depart === null) return;
    const ecart = event.changedTouches[0].clientY - depart;
    depart = null;
    if (ecart > 90) ouvrirFiltres(false);
    else $('qf').style.removeProperty('transform');
  });
}

function renderQueueBar() {
  /* Le sous-titre suit le dossier ouvert et les filtres, jamais un total
     absolu : annoncer « 5 384 » au-dessus d'une liste filtrée à douze ferait
     douter du filtre plutôt que du chiffre. */
  const totalBox = $('queue-total');
  if (totalBox) {
    totalBox.textContent = compteDeLaFile();
    totalBox.classList.toggle('queue-count-filtree', queueIsFiltered());
  }

  renderJetons();
  if (fenetreFiltresOuverte()) renderFiltres();
  renderKeybarState();
}

/** Liste des agents pour le filtre et l'assignation. */
async function loadAgents() {
  try {
    const data = await api('/api/team');
    state.agents = (data.users ?? []).filter((user) => user.active);
  } catch {
    // Un agent sans droit sur l'équipe ne doit pas perdre sa file pour autant.
    state.agents = [];
  }

  const options = state.agents
    .map((user) => `<option value="${esc(user.id)}">${esc(user.name ?? user.email)}</option>`)
    .join('');

  $('q-assignee').innerHTML =
    `<option value="">Tous</option><option value="none">Non assignés</option>${options}`;

  const mailboxes = state.me?.gmail?.mailboxes ?? [];
  $('q-mailbox').innerHTML =
    '<option value="">Toutes</option>' +
    mailboxes
      .map(
        (mailbox) =>
          `<option value="${esc(mailbox.id)}">${esc(mailbox.label || mailbox.emailAddress)}</option>`,
      )
      .join('');

  // Une seule boîte : le filtre n'aurait qu'une option utile.
  $('q-mailbox').closest('label').hidden = mailboxes.length < 2;

  $('q-intent').innerHTML =
    '<option value="">Tous</option>' +
    Object.entries(INTENT_LABELS)
      .map(([key, label]) => `<option value="${key}">${esc(label)}</option>`)
      .join('');
}

/*
 * Effacer les filtres, pas l'endroit où l'on est.
 *
 * Le dossier ouvert et le tri choisi ne filtrent rien : les remettre à zéro
 * ramenait en réception et au plus récent un agent qui voulait seulement voir
 * à nouveau tout son dossier.
 */
function resetQueueFilters() {
  state.filter = '';
  state.queue = { ...emptyQueueFilters(), folder: state.queue.folder, sort: state.queue.sort };

  $('q-mailbox').value = '';
  $('q-assignee').value = '';
  $('q-intent').value = '';

  rafraichirFiltres();
}

$('q-assignee').addEventListener('change', (event) => {
  state.queue.assignee = event.target.value;
  state.queue.unassigned = event.target.value === 'none';
  rafraichirFiltres();
});

$('q-mailbox').addEventListener('change', (event) => {
  state.queue.mailbox = event.target.value;
  rafraichirFiltres();
});

$('q-intent').addEventListener('change', (event) => {
  state.queue.intent = event.target.value;
  rafraichirFiltres();
});

$('q-reset').addEventListener('click', resetQueueFilters);

const STATUS_LABELS = {
  NEW: 'Nouveau',
  PROCESSING: 'En traitement',
  DRAFT_READY: 'Brouillon prêt',
  NEEDS_REVIEW: 'À valider',
  AWAITING_SUPPLIER: 'Chez le fournisseur',
  AUTO_SENT: 'Envoyé auto',
  CLOSED: 'Clos',
  FAILED: 'Échec',
};

/* ------------------------------------------------------- détail du ticket */

/**
 * Fiches déjà chargées, mises de côté au survol.
 *
 * Entre le moment où le curseur se pose sur une ligne et celui où le doigt
 * clique, il s'écoule à peu près le temps d'un aller-retour serveur. Le
 * dépenser à l'avance rend l'ouverture instantanée sans rien changer au reste :
 * c'est le gain de vitesse ressentie le moins cher qui existe.
 */
/**
 * Un message a-t-il été lu ?
 *
 * Deux sources, et la lecture est l'une OU l'autre : le fil n'est plus marqué
 * non lu dans Gmail, ou quelqu'un de l'équipe l'a ouvert ici. Le serveur
 * applique la même règle pour ses trois compteurs ; l'écrire deux fois
 * autrement ferait voir un message en gras que la pastille ne compte pas, ce
 * qui se lit comme un compteur cassé plutôt que comme une règle incohérente.
 */
function estLu(ticket) {
  return ticket.gmailUnread === false || Boolean(ticket.openedAt);
}

/*
 * Basculer lu / non lu, comme dans Gmail.
 *
 * L'affichage change AVANT la réponse du serveur : la pastille est un confort
 * de lecture, et la faire attendre un aller-retour ferait clignoter la ligne
 * une demi-seconde après le clic — ce qui se remarque bien plus qu'un état
 * juste. En échec, elle revient à ce qu'elle était et le refus est dit.
 *
 * La file n'est PAS rechargée : sous le filtre « Non lu », le message
 * disparaîtrait sous le doigt au moment même où on le marque lu, et la ligne
 * suivante prendrait sa place — on cliquerait sur une autre sans l'avoir
 * voulu. Seul le compteur de la pastille est ajusté.
 */
async function basculerLecture(id, pastille) {
  const enFile = state.tickets.find((ticket) => ticket.id === id);
  if (!enFile) return;

  const etait = estLu(enFile);
  const versLu = !etait;

  const appliquer = (lu) => {
    // Les deux champs, parce que la règle de lecture en demande deux : sans
    // rallumer `gmailUnread`, un fil que Gmail dit lu resterait lu ici quoi
    // qu'on clique. C'est la règle du serveur, écrite à l'identique.
    enFile.openedAt = lu ? new Date().toISOString() : null;
    if (!lu) enFile.gmailUnread = true;

    const ligne = document.querySelector(`.queue-item[data-id="${CSS.escape(id)}"]`);
    ligne?.classList.toggle('q-done', lu);
    pastille.classList.toggle('lu', lu);
    pastille.setAttribute('aria-pressed', String(!lu));
    const intitule = lu ? 'Marquer comme non lu' : 'Marquer comme lu';
    pastille.title = intitule;
    pastille.setAttribute('aria-label', intitule);

    if (state.queueCounts) {
      state.queueCounts.UNREAD = Math.max(0, (state.queueCounts.UNREAD ?? 0) + (lu ? -1 : 1));
      renderQueueBar();
    }
  };

  appliquer(versLu);

  try {
    await api('/api/tickets/bulk', {
      method: 'POST',
      body: JSON.stringify({ ids: [id], action: versLu ? 'read' : 'unread' }),
    });
  } catch (error) {
    appliquer(etait);
    toast(error.message, true);
  }
}

const prefetched = new Map();

function prefetchTicket(id) {
  if (!id || prefetched.has(id)) return;

  // On mémorise la promesse, pas le résultat : deux survols rapprochés ne
  // doivent déclencher qu'une requête.
  prefetched.set(
    id,
    api(`/api/tickets/${id}`).catch(() => {
      // Un échec de préchargement ne se signale pas : l'utilisateur n'a rien
      // demandé. Le clic refera la requête et affichera l'erreur si elle
      // persiste.
      prefetched.delete(id);
      return null;
    }),
  );

  // Le cache ne vit que le temps du survol suivant : un ticket rouvert dix
  // minutes plus tard doit être relu, son statut a pu changer.
  setTimeout(() => prefetched.delete(id), 30_000);
}

async function selectTicket(id, { silent = false } = {}) {
  const autreTicket = id !== state.currentId;
  state.currentId = id;
  // Un autre message, choisi : quand la liste et le message s'empilent, il
  // prend l'écran (voir `ouvrirMessagePile`). Recharger le même, ou ouvrir le
  // premier au démarrage, ne quitte pas la liste.
  if (!silent && autreTicket) ouvrirMessagePile();

  /*
   * Ouvert par l'outil, ou choisi ?
   *
   * Au démarrage, le premier message s'ouvre seul, et sa ligne se remplissait
   * de l'accent comme si on l'avait cliquée : une discussion en couleur alors
   * qu'on n'avait rien sélectionné. Comme dans Mail, une sélection qu'on n'a
   * pas faite reste grise ; elle prend l'accent au premier clic. Recharger le
   * même message en silence, après une action, ne la fait pas repasser au gris.
   */
  state.ouvertureAuto = silent ? autreTicket || state.ouvertureAuto : false;

  // Retour visuel immédiat, avant toute requête : la ligne cliquée s'allume
  // tout de suite. Attendre le serveur pour déplacer une surbrillance donne
  // l'impression d'un clic perdu.
  document.querySelectorAll('.queue-item').forEach((item) => {
    const courant = item.dataset.id === id;
    item.setAttribute('aria-current', String(courant));
    item.classList.toggle('q-auto', courant && state.ouvertureAuto);
  });

  const detail = (await prefetched.get(id)) ?? (await api(`/api/tickets/${id}`));

  // Un ticket supprimé entre l'affichage de la file et le clic renverrait une
  // réponse sans ticket : mieux vaut un message que l'écran blanc laissé par
  // une exception au milieu du rendu.
  if (!detail?.ticket) {
    // À l'ouverture automatique du premier message, l'erreur ne se dit pas :
    // personne n'a rien demandé, un toast rouge au démarrage accuse à vide.
    if (!silent) toast('Ce message n’existe plus.', true);
    await loadQueue();
    return;
  }

  state.detail = detail;

  /*
   * Le compteur de non lus suit l'ouverture d'un ticket.
   *
   * Le badge de la navigation ne bougeait qu'au rafraîchissement suivant —
   * jusqu'à soixante secondes plus tard. On ouvrait un message manifestement
   * lu et le nombre ne bronchait pas, ce qui se lit comme un compteur cassé.
   *
   * Le serveur reste la source unique : on redemande la valeur, on ne la
   * décrémente pas ici. Un compteur tenu à deux endroits finit toujours par
   * dire deux choses.
   */
  const etaitNonLu = !estLu(detail.ticket);

  // `silent` est l'ouverture AUTOMATIQUE du premier message au chargement :
  // personne ne l'a demandée, donc elle ne doit rien marquer comme lu.
  await marqueOuvert(detail, id, { automatique: silent });

  renderDetail();

  /*
   * Un autre ticket s'ouvre en haut, sur son titre et son résumé.
   *
   * La colonne du détail défile pour son compte et gardait sa position d'un
   * ticket à l'autre : descendu jusqu'à la réponse du précédent, on ouvrait
   * le suivant au milieu de ses échanges, sans voir de qui il s'agit. Le même
   * ticket, lui, ne bouge pas — après un envoi, `selectTicket` le relit, et
   * l'écran ne doit pas sauter sous les yeux de qui vient de cliquer.
   */
  if (autreTicket) $('d-pane').scrollTop = 0;

  await Promise.all([loadQueue(), loadEscalations(id)]);

  // Seulement si l'état a pu changer : recompter à chaque ouverture ajouterait
  // une requête par clic pour un nombre identique neuf fois sur dix.
  if (etaitNonLu) void loadMetrics();
}

/*
 * Dire au serveur que ce message a été ouvert, et l'éteindre tout de suite.
 *
 * Un appel dédié, et non un effet de bord de `GET /api/tickets/:id` : cette
 * fiche est préfetchée AU SURVOL pour rendre l'ouverture instantanée. Écrire
 * depuis le GET marquerait lu tout ce que le curseur effleure en descendant
 * la liste. C'est le clic qu'on enregistre, pas le passage.
 *
 * Sans attendre la réponse. Le gras est un confort d'affichage : le faire
 * dépendre d'un aller-retour ferait clignoter la ligne une demi-seconde après
 * le clic, ce qui se remarque bien plus qu'un gras qui s'éteint tard. En
 * échec, la ligne reste en gras et le clic suivant réessaiera.
 *
 * L'objet local est modifié en même temps : `loadQueue()` va suivre, mais
 * entre les deux la file rendue porte encore l'ancienne valeur.
 */
async function marqueOuvert(detail, id, { automatique = false } = {}) {
  /*
   * Une ouverture automatique ne lit rien.
   *
   * Au chargement, la page ouvre le premier message de la file pour ne pas
   * laisser la colonne de droite vide. Elle le marquait lu au passage : chaque
   * rafraîchissement — y compris un Cmd+Maj+R — éteignait donc le gras du
   * message du haut, puis du suivant, sans que personne ne les ait lus. Au
   * bout de quelques retours sur la page, la file était « traitée » et les
   * messages passaient inaperçus.
   *
   * C'est le CLIC qui vaut lecture, jamais le chargement.
   */
  if (automatique || detail.readOnly || estLu(detail.ticket)) return;

  detail.ticket.openedAt = new Date().toISOString();
  const ligne = document.querySelector(`.queue-item[data-id="${CSS.escape(id)}"]`);
  ligne?.classList.add('q-done');

  const enFile = state.tickets.find((ticket) => ticket.id === id);
  if (enFile) enFile.openedAt = detail.ticket.openedAt;

  try {
    await api(`/api/tickets/${id}/ouvert`, { method: 'POST', body: '{}' });
  } catch {
    // Silencieux à dessein : un message d'erreur pour un gras non éteint
    // interromprait la lecture pour un détail que l'utilisateur n'a pas
    // demandé. La file le rallumera au prochain chargement.
  }
}

/**
 * Titre du ticket : ce que le client demande, pas ce que Shopify a intitulé.
 *
 * L'objet d'un mail de boutique est écrit par la plateforme — « Order #13616
 * Confirmed 7 Sep » — et ne dit rien du problème. L'intention devinée et le
 * numéro de commande le disent en trois mots.
 *
 * Le libellé vient d'`INTENT_LABELS`, partagée avec la file et les filtres :
 * une seconde table pour ce seul écran ferait diverger deux vocabulaires. Il
 * n'y a donc pas de titre plus fin que les sept intentions du modèle — pas de
 * « Annulation et remboursement » tant que le modèle ne classe pas ainsi.
 *
 * Trois cas se replient : pas encore d'intention (l'analyse tourne, et elle se
 * déclenche à l'ouverture), pas de commande rattachée, et un ticket sans objet.
 */
function ticketTitle(ticket) {
  const order = ticket.orderName ? ` · ${ticket.orderName}` : '';
  // Un atelier qui signale n'est pas un client : son motif dit ce qu'il y a à
  // faire, quand « Autre » le perdait au milieu du courrier.
  if (ticket.signalement) return `Signalement · ${ticket.signalement.court}${order}`;
  const intent = ticket.intent ? (INTENT_LABELS[ticket.intent] ?? ticket.intent) : null;

  if (intent) return `${intent}${order}`;
  // Sans intention, l'objet reste le seul repère — et dire « analyse en
  // cours » vaut mieux qu'un titre vide pendant la seconde que ça prend.
  return ticket.subject?.trim() || 'Analyse en cours…';
}

/**
 * Le client du message.
 *
 * Le nombre de commandes et le total dépensé viennent de la commande
 * rattachée, pas du ticket, et n'existent donc pas toujours. Une rangée sans
 * eux vaut mieux que deux zéros qui affirment que ce client n'a rien acheté.
 */
function renderTicketMeta(ticket, order) {
  const customer = order?.customer;

  /*
   * Le client, en une rangée groupée.
   *
   * Le nom, son adresse et ses achats se lisaient sur deux lignes décousues —
   * l'adresse en machine à écrire, deux pastilles accrochées au bout, puis
   * une ligne de faits qui mêlait l'objet du mail. La rangée dit qui écrit et
   * ce qu'il a acheté ; un clic ouvre sa fiche. L'intention devinée descend
   * dans la ligne de classement, et l'objet a sa propre ligne au-dessus.
   */
  const achats = [];
  if (customer?.numberOfOrders != null) {
    achats.push(`<b>${customer.numberOfOrders} commande${customer.numberOfOrders > 1 ? 's' : ''}</b>`);
  }
  if (customer?.amountSpent != null && order?.currency) {
    achats.push(`<small>${esc(euro(customer.amountSpent, order.currency))} dépensés</small>`);
  }

  const nom = ticket.customerName ?? ticket.customerEmail;
  $('d-meta').innerHTML = `<button class="tm-client" id="d-who" type="button" title="Voir la fiche du client">
       <span class="tm-av" aria-hidden="true" style="background:${avatarTint(nom)}">${esc(initials(nom))}</span>
       <span class="tm-id">
         <span class="tm-nom">${esc(nom)}</span>
         ${
           // L'adresse \`fournisseur+…@local\` n'existe nulle part : la montrer
           // laissait croire qu'on pouvait y répondre.
           ticket.signalement
             ? '<span class="tp tp-four">Fournisseur</span>'
             : `<span class="tm-mail">${esc(ticket.customerEmail)}</span>`
         }
       </span>
       ${achats.length ? `<span class="tm-achats">${achats.join('')}</span>` : ''}
       <svg class="tm-chev" viewBox="0 0 16 16" aria-hidden="true"><path d="m6 3 5 5-5 5" /></svg>
     </button>`;
}

/*
 * Onglets de la colonne centrale.
 *
 * Ils ne créent aucune fonctionnalité : ils rangent trois sections qui
 * existaient déjà et s'empilaient l'une sous l'autre. Le fil se consulte à
 * chaque ticket, les demandes au fournisseur et les autres fils du même client
 * une fois sur dix — et pourtant ces deux-là repoussaient la réponse hors de
 * l'écran à chaque ouverture.
 *
 * Un onglet vide ne s'affiche pas : proposer « Fournisseur » sur un ticket
 * sans demande, c'est inviter à un clic qui ne montre rien.
 */
const TABS = [
  {
    key: 'thread',
    label: 'Conversation',
    pane: 'd-fold',
    count: () => state.detail?.ticket?.messages?.length ?? 0,
  },
  {
    key: 'supplier',
    label: 'Fournisseur',
    pane: 'd-changes',
    count: () => state.detail?.changes?.length ?? 0,
  },
  {
    key: 'history',
    label: 'Historique',
    pane: 'd-sibs',
    count: () => state.detail?.siblings?.length ?? 0,
  },
];

function renderTabs() {
  const bar = $('d-tabs');
  if (!bar) return;

  /*
   * Un onglet existe si sa section a du contenu.
   *
   * `hidden` est posé par les fonctions de rendu de chaque section, qui ont
   * déjà décidé s'il y avait quelque chose à montrer. Le relire évite de
   * dupliquer leur logique — et de la voir diverger.
   */
  const available = TABS.filter((tab) => {
    const pane = $(tab.pane);
    return pane && !pane.dataset.empty;
  });

  if (available.length <= 1) {
    // Un seul onglet n'est pas une navigation, c'est une étiquette.
    bar.hidden = true;
    for (const tab of TABS) {
      const pane = $(tab.pane);
      if (pane) pane.hidden = pane.dataset.empty === '1';
    }
    return;
  }

  /*
   * L'onglet ouvert est mémorisé, mais un repli ne l'écrase pas.
   *
   * Un agent qui suit une escalade reste sur « Fournisseur » d'un ticket à
   * l'autre. Croiser un ticket sans demande fournisseur affiche la
   * conversation — sans effacer sa préférence, sinon il la perdrait pour de
   * bon au premier ticket dépourvu de cet onglet.
   */
  const current = available.some((tab) => tab.key === state.detailTab)
    ? state.detailTab
    : available[0].key;

  bar.hidden = false;
  bar.innerHTML = available
    .map(
      (tab) =>
        `<button class="tab" type="button" role="tab" data-tab="${tab.key}"
          aria-selected="${tab.key === current}">${esc(tab.label)}${
            // Un compte de 1 sur la conversation n'apprend rien ; deux
            // demandes fournisseur, si.
            tab.count() > 1 ? `<span class="tab-n">${tab.count()}</span>` : ''
          }</button>`,
    )
    .join('');

  for (const tab of TABS) {
    const pane = $(tab.pane);
    if (pane) pane.hidden = pane.dataset.empty === '1' || tab.key !== current;
  }

  bar.querySelectorAll('[data-tab]').forEach((button) =>
    button.addEventListener('click', () => {
      state.detailTab = button.dataset.tab;
      renderTabs();
    }),
  );
}

/**
 * Marque une section comme vide ou non, pour les onglets.
 *
 * Les fonctions de rendu posaient `hidden` directement. Ce n'est plus
 * suffisant : une section peut être masquée parce qu'elle est vide, ou parce
 * qu'un autre onglet est ouvert. Confondre les deux ferait disparaître un
 * onglet dès qu'on le quitte.
 */
function markPane(id, empty) {
  const pane = $(id);
  if (!pane) return;
  pane.dataset.empty = empty ? '1' : '';
  if (empty) pane.hidden = true;
}

function renderDetail() {
  const { ticket, order, orderError } = state.detail;

  // Le détail de commande appartient à la consultation hors ticket : le
  // laisser affiché sous un vrai fil ferait lire deux dossiers à la fois.

  /*
   * Le formulaire d'escalade n'a d'objet qu'avec un ticket ouvert et le droit
   * d'escalader.
   *
   * Il portait l'identifiant `new-escalation`, partagé avec le bouton de la
   * barre haute — deux éléments, un seul nom. `getElementById` rendait le
   * premier du document, donc le bouton ; retirer celui-ci aurait fait glisser
   * ces gardes sur le formulaire par accident, pas par décision. Le formulaire
   * a désormais son nom.
   */
  const escalate = $('escalation-form');
  if (escalate) escalate.hidden = !ticket || !canI('escalate');

  $('d-subject').textContent = ticketTitle(ticket);
  $('d-when').textContent = dayOrDateTime(ticket.lastMessageAt);
  // L'objet du client, entre guillemets, quand il dit autre chose que le titre.
  const objet = ticket.subject?.trim() ?? '';
  $('d-objet').hidden = !objet || objet === ticketTitle(ticket);
  $('d-objet').textContent = objet ? `« ${objet} »` : '';

  renderTicketMeta(ticket, order);
  renderTicketLabels(ticket);

  $('d-who')?.addEventListener('click', () =>
    void openCustomerSheet(ticket.customerEmail, ticket.customerName ?? ''),
  );

  renderActionBar();
  renderCannedChips();

  // Ticket d'une autre boutique en mode agrégé : consultable, pas traitable.
  // Griser les actions sans le dire donnerait l'impression d'une panne.
  const otherShop = Boolean(state.detail.readOnly);
  const shopLabel =
    state.shops.find((shop) => shop.id === ticket.merchantId)?.label ?? 'une autre boutique';

  $('read-only').hidden = !otherShop;
  if (otherShop) {
    $('read-only-text').textContent = `Ce message appartient à ${shopLabel}. Basculez sur cette boutique pour y répondre.`;
    $('read-only-switch').dataset.shop = ticket.merchantId;
  }

  for (const id of ['btn-send', 'btn-save']) {
    const el = $(id);
    if (el) el.disabled = otherShop || el.disabled;
  }

  /*
   * Le bouton « Rembourser » ne dépend que du ticket, jamais du brouillon.
   *
   * Son état se réglait dans `renderDraft`, qui sort avant d'y arriver quand
   * il n'y a pas de proposition à afficher. Le bouton gardait alors l'état du
   * ticket précédent — désactivé sur un message sans commande, il le restait
   * sur le suivant qui en avait une, et le geste de l'en-tête, qui délègue son
   * clic ici, ne faisait rien du tout. Silencieusement.
   *
   * Réglé ici, il l'est à chaque ticket affiché, et le verrou d'une autre
   * boutique s'applique dans le même mouvement au lieu d'être écrasé par le
   * rendu du brouillon.
   */
  $('btn-refund').disabled = otherShop || !ticket.shopifyOrderId || !canI('refund');
  $('btn-refund').title = otherShop
    ? 'Ce message appartient à une autre boutique.'
    : !canI('refund')
      ? 'Seuls le propriétaire et les superviseurs peuvent rembourser.'
      : ticket.shopifyOrderId
        ? 'Ouvre un aperçu chiffré avant toute écriture chez Shopify.'
        : 'Aucune commande rattachée à ce message.';

  // Les actions rapides de l'en-tête suivent le même verrou : un message d'une
  // autre boutique se lit, il ne s'y répond pas.
  if (otherShop) {
    document
      .querySelectorAll('#d-primary [data-quick], #d-more-menu [data-quick]')
      .forEach((button) => (button.disabled = true));
  }

  $('actbar').hidden = $('actbar').hidden || otherShop;

  /*
   * La rédaction se referme à chaque ticket affiché.
   *
   * Elle vivait dans `#actbar`, que ce rendu masque : elle disparaissait donc
   * par effet de bord, sans que personne n'ait eu à l'écrire. Sortie de là
   * pour ne plus être masquée à tort, elle ne l'était plus du tout — trois
   * lignes écrites à un client restaient à l'écran en ouvrant le message du
   * suivant, et « Valider et envoyer » les lui expédiait.
   *
   * Le contenu est vidé avec elle : un brouillon abandonné qui réapparaît sur
   * un autre dossier est pire qu'un champ vide.
   */
  closeCompose({ force: true });
  $('subs').hidden = true;

  // Le fil se lit d'un coup d'œil : ce qui vient de nous porte notre nom et
  // sa couleur. « sav@… » répété douze fois n'apprenait rien à personne.
  const brand = state.me?.merchant?.brandName || state.me?.merchant?.name || 'Nous';

  $('d-messages').innerHTML = ticket.messages
    .map(
      (message) => {
        /*
         * L'expéditeur porte son avatar, comme dans la file.
         *
         * Sur un fil de dix messages qui alternent, la couleur dit qui parle
         * avant qu'on ait lu le nom — et c'est la même teinte que dans la
         * liste, donc le même repère d'un écran à l'autre.
         *
         * Ce qui vient de nous prend le nom de la boutique, jamais l'adresse
         * de la boîte : « sav@… » répété douze fois n'apprend rien à personne.
         */
        const outbound = message.direction === 'OUTBOUND';
        const who = outbound ? brand : (ticket.customerName ?? message.fromEmail);

        return `<div class="msg${outbound ? ' out' : ''}">
        <div class="msg-head">
          <span class="msg-av" aria-hidden="true"
            style="background:${avatarTint(who)}">${esc(initials(who))}</span>
          <b${outbound ? '' : ` title="${esc(message.fromEmail)}"`}>${
            /* Le nom du client est déjà calculé pour l'avatar, deux lignes
               plus haut, et c'est celui-là qu'on lit dans la file. Afficher
               l'adresse brute obligeait à la déchiffrer à chaque message d'un
               fil qui n'a qu'un seul expéditeur. Elle reste en infobulle. */
            outbound
              ? `${esc(brand)} <span class="msg-tag">réponse envoyée</span>`
              : esc(who)
          }</b>
          <span>${shortTime(message.receivedAt)}</span>
        </div>
        <button class="msg-copy" type="button" data-copy="${esc(message.id)}"
          title="Copier le texte" aria-label="Copier le texte du message">···</button>
        <div class="msg-body" data-msg="${esc(message.id)}">${esc(message.bodyText)}</div>
        <div class="msg-fr" data-fr="${esc(message.id)}" hidden></div>
        ${renderAttachments(message.attachments)}
      </div>`;
      },
    )
    .join('');

  /*
   * Copier le texte d'un message.
   *
   * Le geste existe pour de vrai : on colle un extrait dans une demande au
   * fournisseur, dans une note, dans une recherche. Le faire à la souris sur
   * un bloc à `white-space: pre-wrap` attrape les lignes vides du mail.
   *
   * Délégué sur le conteneur, qui est statique : les boutons naissent d'un
   * `innerHTML` réécrit à chaque ticket, un écouteur par bouton s'empilerait.
   */
  $('d-messages').onclick = async (event) => {
    const button = event.target.closest('[data-copy]');
    if (!button) return;

    const body = document.querySelector(`.msg-body[data-msg="${CSS.escape(button.dataset.copy)}"]`);
    if (!body) return;

    try {
      await navigator.clipboard.writeText(body.textContent ?? '');
      toast('Texte copié.');
    } catch {
      // Presse-papiers refusé — page non sécurisée, permission absente. Le
      // dire plutôt que de laisser croire que la copie a eu lieu.
      toast('Copie impossible depuis ce navigateur.', true);
    }
  };

  bindTranslate(ticket);
  renderSiblings(state.detail?.siblings ?? [], ticket);
  renderChanges(state.detail?.changes ?? []);

  const draft = ticket.drafts?.[0] ?? null;
  renderDraft(draft, ticket);

  // Après les trois sections : les onglets lisent ce qu'elles ont décidé
  // d'afficher, ils ne le recalculent pas.
  renderTabs();
  renderRecommended(ticket, order);

  renderCustomer(order);
  renderOrder(ticket, order, orderError);
  renderShipping(order);
}

/*
 * Action recommandée.
 *
 * Ce que l'agent doit faire, en une phrase, avec le geste à portée. Elle se
 * déduit de l'intention devinée ET de l'état réel de la commande : recommander
 * un remboursement sur une commande impayée, ou une réexpédition sur un colis
 * déjà livré, coûterait plus cher que ne rien recommander.
 *
 * Le bouton ne fait rien par lui-même. Il délègue aux gestes existants, qui
 * portent les droits, les plafonds et le journal d'audit — un second chemin
 * vers le remboursement serait un second chemin à sécuriser.
 *
 * Ce produit ne sait pas annuler une commande Shopify : les seules écritures
 * sont le remboursement et l'expédition. La recommandation ne promet donc
 * jamais une annulation, même quand le client la demande — elle propose le
 * remboursement, qui est ce que l'outil sait faire.
 */
function recommendation(ticket, order) {
  const paid = order?.displayFinancialStatus;
  const shipped = order?.displayFulfillmentStatus;
  const unshipped = shipped === 'UNFULFILLED' || shipped === 'ON_HOLD';
  const refundable = Boolean(order && paid === 'PAID' && canI('refund'));
  const amount = order ? euro(order.totalPrice, order.currency) : null;

  if ((ticket.intent === 'REFUND' || ticket.intent === 'DISPUTE') && refundable) {
    return {
      title: `Rembourser ${amount}`,
      why: unshipped
        ? 'La commande est payée et pas encore expédiée.'
        : 'La commande est payée. Vérifiez l’état du colis avant de rembourser.',
      cta: `Rembourser ${amount}`,
      run: () => $('btn-refund').click(),
    };
  }

  if (ticket.intent === 'WISMO' && ticket.shopifyOrderId) {
    return {
      title: 'Vérifier le suivi du colis',
      why: 'La position du colis d’après le transporteur répond à la question posée.',
      cta: 'Voir le suivi',
      run: () => setView('tracking'),
    };
  }

  if (ticket.intent === 'RETURN' && ticket.shopifyOrderId) {
    return {
      title: 'Ouvrir un dossier de retour',
      why: 'L’article revient en agence, puis au stock retours pour une réexpédition.',
      cta: 'Échange ou retour',
      run: () => void openReshipment(ticket),
    };
  }

  if (!ticket.shopifyOrderId) {
    return {
      title: 'Rattacher une commande',
      why: 'Sans commande, ni le suivi ni le remboursement ne sont possibles.',
      cta: null,
      run: null,
    };
  }

  return null;
}

function renderRecommended(ticket, order) {
  const box = $('d-reco');
  if (!box) return;

  const reco = recommendation(ticket, order);

  // Rien de sûr à recommander : on se tait. Une recommandation générique se
  // fait ignorer, et entraîne à ignorer les autres.
  box.hidden = !reco;
  if (!reco) return;

  box.innerHTML =
    `<div class="reco-body">
       <span class="panel-title">Action recommandée</span>
       <b class="reco-title">${esc(reco.title)}</b>
       <p class="reco-why">${esc(reco.why)}</p>
     </div>` +
    (reco.cta
      ? `<button class="btn btn-primary reco-go" type="button">${esc(reco.cta)}</button>`
      : '');

  box.querySelector('.reco-go')?.addEventListener('click', reco.run);
}



const CHANGE_KINDS = {
  ADDRESS: 'Adresse',
  PHONE: 'Téléphone',
  PRODUCT: 'Modèle',
  SIZE: 'Taille',
  COLOR: 'Couleur',
  HOLD: 'Ne pas expédier',
  CANCEL: 'Annulation',
  MISSING_ITEM: 'Article manquant',
  DELAY: 'Retard',
  TRACKING: 'Update colis',
  OTHER: 'Autre',
};

/**
 * La valeur d'une demande à une seule valeur, en clair : l'article qui
 * manque, ou la date attendue. `null` pour un changement « avant → après ».
 */
function valeurSimple(change) {
  if (change.kind === 'MISSING_ITEM' && change.beforeValue) return `Manque : ${change.beforeValue}`;
  if (change.kind === 'TRACKING' && change.beforeValue) return `Colis : ${change.beforeValue}`;
  if (change.kind === 'DELAY' && change.afterValue) return `Expédier avant le ${dateCourteIso(change.afterValue)}`;
  return null;
}

/** « 2026-10-12 » → « 12 oct. » ; toute autre forme passe telle quelle. */
function dateCourteIso(valeur) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(valeur)) return valeur;
  return new Date(`${valeur}T12:00:00`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

const CHANGE_STATUS = {
  PENDING: { tone: 'wait', label: 'en attente du fournisseur' },
  ACKNOWLEDGED: { tone: 'ok', label: 'pris en compte' },
  REFUSED: { tone: 'bad', label: 'refusé' },
};

/**
 * Ce qu'on a demandé au fournisseur depuis ce mail, et sa réponse.
 *
 * Le statut est l'information utile : « pris en compte » autorise à répondre
 * au client, « refusé » interdit de lui annoncer quoi que ce soit. Une
 * demande sans réponse visible revient à ne pas l'avoir envoyée.
 */
function renderChanges(changes) {
  const box = $('d-changes');
  if (!box) return;

  // `markPane` plutôt que `hidden` : une section peut être masquée parce
  // qu'elle est vide, ou parce qu'un autre onglet est ouvert. Confondre les
  // deux ferait disparaître l'onglet dès qu'on le quitte.
  markPane('d-changes', changes.length === 0);
  if (changes.length === 0) return;

  box.innerHTML =
    `<div class="chg-head"><span class="panel-title">Demandé au fournisseur</span></div>` +
    changes
      .map((change) => {
        const status = CHANGE_STATUS[change.status] ?? CHANGE_STATUS.PENDING;

        return `<div class="chg-row">
          <b>${esc(CHANGE_KINDS[change.kind] ?? change.kind)}</b>
          ${
            valeurSimple(change)
              ? `<span class="chg-swap"><b>${esc(valeurSimple(change))}</b></span>`
              : change.afterValue
              ? `<span class="chg-swap">${esc(change.beforeValue ?? '—')} → <b>${esc(
                  change.afterValue,
                )}</b></span>`
              : `<span class="chg-swap">${esc(change.message)}</span>`
          }
          <span class="tag tone-${status.tone}">${esc(status.label)}</span>
          <span class="chg-who">${esc(change.supplier?.name ?? '')} · ${esc(
            dateTime(change.createdAt),
          )}</span>
          ${change.supplierNote ? `<p class="chg-note">« ${esc(change.supplierNote)} »</p>` : ''}
        </div>`;
      })
      .join('');
}

/**
 * Les autres messages en cours du même client.
 *
 * Un client qui relance ouvre un second fil plutôt que de répondre au sien :
 * deux lignes dans la file, traitées séparément, répondues deux fois. Ce bloc
 * les rassemble sous le fil qu'on lit — l'IA en tient compte de son côté dans
 * son résumé et sa proposition.
 */
function renderSiblings(siblings, ticket) {
  const box = $('d-sibs');
  if (!box) return;

  markPane('d-sibs', siblings.length === 0);
  if (siblings.length === 0) return;

  const who = ticket.customerName ?? ticket.customerEmail;

  box.innerHTML =
    `<div class="sibs-head">
       <span class="panel-title">Autres messages de ${esc(who)}</span>
       <span class="sibs-count">${siblings.length}</span>
     </div>` +
    siblings
      .map(
        (sib) => `<button class="sib" data-sib="${esc(sib.id)}">
          <span class="sib-when">${esc(dateTime(sib.lastMessageAt))}</span>
          <b>${esc(sib.subject ?? '(sans objet)')}</b>
          <span class="sib-tags">
            <span class="tag tag-status st-${esc(sib.status)}">${esc(
              STATUS_LABELS[sib.status] ?? sib.status,
            )}</span>
            ${sib.orderName ? `<span class="tag">${esc(sib.orderName)}</span>` : ''}
          </span>
        </button>`,
      )
      .join('');

  box.querySelectorAll('[data-sib]').forEach((button) =>
    button.addEventListener('click', () => void selectTicket(button.dataset.sib)),
  );
}

/**
 * Traduction du fil en français, à la demande.
 *
 * La traduction s'ajoute sous le message d'origine, elle ne le remplace pas :
 * ce que le client a écrit reste la seule version qui fait foi, et un doute
 * sur une formulation se lève en regardant deux lignes plus haut.
 */
function bindTranslate(ticket) {
  const button = $('d-translate');
  if (!button) return;

  // Le bouton disparaît sur un fil reconnu français : proposer de traduire du
  // français en français ferait douter de tout le reste. Une langue inconnue
  // le garde — un message pas encore analysé n'a pas de langue, et c'est
  // justement là qu'on a besoin de traduire.
  const label = ticket.language
    ? `Traduire en français (${ticket.language})`
    : 'Traduire en français';

  button.hidden = ticket.language === 'fr';
  if (button.hidden) return;

  button.disabled = false;
  button.textContent = label;

  button.onclick = async () => {
    // Deuxième clic : on masque, sans redemander au modèle.
    const shown = document.querySelector('#d-messages .msg-fr:not([hidden])');
    if (shown) {
      document.querySelectorAll('#d-messages .msg-fr').forEach((node) => {
        node.hidden = true;
      });
      button.textContent = label;
      return;
    }

    const already = document.querySelector('#d-messages .msg-fr[data-done]');
    if (already) {
      document.querySelectorAll('#d-messages .msg-fr[data-done]').forEach((node) => {
        node.hidden = false;
      });
      button.textContent = 'Masquer la traduction';
      return;
    }

    button.disabled = true;
    button.textContent = 'Traduction…';

    try {
      const result = await api(`/api/tickets/${ticket.id}/translate`, {
        method: 'POST',
        body: '{}',
      });

      for (const line of result.messages) {
        const node = document.querySelector(`[data-fr="${CSS.escape(line.id)}"]`);
        if (!node) continue;
        node.textContent = line.text;
        node.dataset.done = '1';
        node.hidden = false;
      }

      button.textContent = 'Masquer la traduction';
    } catch (error) {
      toast(error.message, true);
      button.textContent = label;
    } finally {
      button.disabled = false;
    }
  };
}



/* ==========================================================================
   LA FILE EN TABLEAU

   Vingt lignes lues d'un coup d'œil, contre six en cartes. Ce qu'un agent
   cherche avant d'ouvrir un message tient en cinq colonnes : qui écrit, ce
   qu'il veut, combien vaut sa commande, dans combien de temps on est en
   faute, et qui s'en occupe. Tout le reste appartient au message lui-même.

   Le tableau prend toute la largeur et masque le rail de droite : à 350 px,
   cinq colonnes ne sont plus un tableau mais une bouillie. Un clic ouvre le
   message et rend la vue partagée — parcourir et traiter sont deux gestes,
   ils méritent deux dispositions.
   ========================================================================== */

/** Temps restant avant l'échéance, en barre : la seule chose qui dise l'ordre. */
function slaCell(ticket) {
  if (!ticket.dueAt) return '<span class="sub">—</span>';

  const left = new Date(ticket.dueAt).getTime() - Date.now();
  const hours = left / 3600000;

  // Trois paliers, comme partout ailleurs : au-delà, la couleur devient une
  // décoration au lieu d'une échelle.
  const tone = left < 0 ? 'bad' : hours < 4 ? 'warn' : 'ok';
  const label =
    left < 0
      ? `en retard de ${formatSpan(-left)}`
      : `${formatSpan(left)}`;

  // La barre se vide à mesure : pleine à vingt-quatre heures, vide à
  // l'échéance. Un pourcentage exact n'apporterait rien, l'ordre de grandeur
  // suffit à décider.
  const pct = Math.max(0, Math.min(100, (hours / 24) * 100));

  return `<span class="sla sla-${tone}" title="${esc(dateTime(ticket.dueAt))}">
    <i style="width:${left < 0 ? 100 : pct}%"></i>
    <b>${esc(label)}</b>
  </span>`;
}

/** Heure pour aujourd'hui, jour + heure sinon. Sur une ligne de tableau, la
    date complète mange la colonne pour deux informations déjà connues. */
function shortMoment(iso) {
  const date = new Date(iso);
  const today = new Date().toDateString() === date.toDateString();
  const time = date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  return today
    ? time
    : `${date.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })} ${time}`;
}

function formatSpan(ms) {
  const hours = Math.round(ms / 3600000);
  if (hours < 1) return "moins d'1 h";
  if (hours < 48) return `${hours} h`;
  return `${Math.round(hours / 24)} j`;
}

function renderQueueTable(multiMailbox, shopById) {
  const box = $('queue-table');
  if (!box) return;

  // Une ligne = un ticket, 31 px, aucune cellule sur deux étages : c'est ce
  // qui fait tenir vingt-six dossiers à l'écran au lieu de dix.
  const cols = [
    { key: 'status', label: 'Statut' },
    { key: 'customer', label: 'Client' },
    { key: 'subject', label: 'Sujet' },
    { key: 'intent', label: 'Motif' },
    { key: 'order', label: 'Cmde' },
    { key: 'amount', label: 'Montant', sort: 'amount', num: true },
    { key: 'due', label: 'Échéance', sort: 'due', num: true },
    { key: 'assignee', label: '' },
  ];

  box.innerHTML = `<table class="qtable">
    <thead><tr>
      <th class="qt-pick"></th>
      ${cols
        .map(
          (col) =>
            `<th class="qt-${col.key}${col.num ? ' num' : ''}"${
              col.sort ? ` data-sort="${col.sort}"` : ''
            }>${esc(col.label)}${
              col.sort
                ? `<span class="qt-arrow${state.queue.sort === col.sort ? ' on' : ''}">${ico('bas')}</span>`
                : ''
            }</th>`,
        )
        .join('')}
    </tr></thead>
    <tbody>${state.tickets
      .map((ticket) => {
        const who = ticket.assignedTo;
        const picked = state.picked.has(ticket.id);

        return `<tr class="qt-row${picked ? ' picked' : ''}${
          ticket.id === state.currentId ? ' on' : ''
        }" data-id="${esc(ticket.id)}">
          <td class="qt-pick">
            <label class="qt-pickbox">
              <input type="checkbox" data-pick="${esc(ticket.id)}"${picked ? ' checked' : ''}
                aria-label="Sélectionner le message de ${esc(
                  ticket.customerName ?? ticket.customerEmail ?? 'ce client',
                )}" />
            </label>
          </td>

          <td class="qt-status">
            <span class="qdot st-${ticket.status}"></span>${esc(
              STATUS_LABELS[ticket.status] ?? ticket.status,
            )}
          </td>

          <td class="qt-customer" title="${esc(ticket.customerEmail ?? '')}">
            ${
              state.allShops && shopById.has(ticket.merchantId)
                ? `<span class="shop-pip" style="background:${esc(
                    shopById.get(ticket.merchantId).color,
                  )}"></span>`
                : ''
            }
            <b>${esc(ticket.customerName ?? ticket.customerEmail)}</b>
          </td>

          <td class="qt-subject">
            <b>${esc(ticket.subject ?? '(sans objet)')}</b>
            <span class="qt-when"> — ${esc(shortMoment(ticket.lastMessageAt))}${
              (ticket.threads ?? 1) > 1 ? ` · ${ticket.threads} échanges` : ''
            }</span>
          </td>

          <td class="qt-intent">
            ${
              ticket.intent
                ? `<span class="tag in-${ticket.intent}">${esc(
                    INTENT_LABELS[ticket.intent] ?? ticket.intent,
                  )}</span>`
                : '<span class="sub">—</span>'
            }
          </td>

          <td class="qt-order mono">${
            ticket.orderName ? esc(ticket.orderName) : '<span class="sub">—</span>'
          }</td>

          <td class="qt-amount num mono">${
            ticket.orderTotal != null ? esc(euro(ticket.orderTotal)) : '<span class="sub">—</span>'
          }</td>

          <td class="qt-due num">${slaCell(ticket)}</td>

          <td class="qt-assignee">
            <span class="who-dot${who ? '' : ' none'}" title="${
              who ? esc(who.name ?? who.email) : 'non assigné'
            }">${who ? esc(initials(who.name ?? who.email)) : '—'}</span>
          </td>
        </tr>`;
      })
      .join('')}</tbody>
  </table>`;

  box.querySelectorAll('.qt-row').forEach((row) =>
    row.addEventListener('click', (event) => {
      // La case à cocher ne doit pas ouvrir le message : on coche pour agir en
      // masse, précisément pour ne pas les ouvrir un par un.
      if (event.target.closest('.qt-pick')) return;
      void selectTicket(row.dataset.id);
      setQueueView('list');
    }),
  );

  box.querySelectorAll('[data-sort]').forEach((head) =>
    head.addEventListener('click', () => {
      state.queue.sort = head.dataset.sort;
      void loadQueue();
    }),
  );
}

/*
 * Sous 1100 px, le sélecteur de vue est masqué : le tableau y est illisible.
 * Mais la préférence, elle, était restaurée du poste — on se retrouvait en
 * mode tableau sans bouton pour en sortir, sans panneaux de contexte, et
 * seul un vidage du stockage y remédiait. La préférence reste ce qu'elle est ;
 * c'est la vue EFFECTIVE qui cède sous la largeur, et qui revient au-dessus.
 */
const NARROW_FOR_TABLE = window.matchMedia('(max-width: 1100px)');
NARROW_FOR_TABLE.addEventListener('change', () => setQueueView(state.queueView));

function setQueueView(view) {
  state.queueView = view;
  localStorage.setItem('csav.queueView', view);

  const effective = NARROW_FOR_TABLE.matches ? 'list' : view;

  $('queue-table').hidden = effective !== 'table';
  $('queue').hidden = effective === 'table';
  // Le tableau prend toute la largeur : à 350 px, six colonnes ne sont plus un
  // tableau mais une bouillie.
  $('view-tickets')?.classList.toggle('wide-queue', effective === 'table');

  document.querySelectorAll('#queue-view [data-qview]').forEach((button) =>
    button.setAttribute('aria-pressed', String(button.dataset.qview === view)),
  );

  if (effective === 'table' && state.tickets.length) void loadQueue();
}

/*
 * Les intitulés de colonnes recopiés sur chaque cellule.
 *
 * Sous 760 px, chaque ligne de tableau devient une fiche et la feuille de
 * style écrit l'intitulé devant la valeur avec `attr(data-label)` — un
 * attribut qu'aucune cellule ne portait : les fiches n'étaient que des piles
 * de valeurs sans nom. Plutôt que de retoucher les quinze rendus qui
 * produisent des lignes, un observateur pose l'attribut à chaque fois qu'un
 * corps de tableau change, d'après l'en-tête du tableau lui-même.
 */
function labelGridCells(table) {
  const heads = [...table.querySelectorAll('thead th')].map((th) => th.textContent.trim());
  table.querySelectorAll('tbody tr').forEach((tr) => {
    [...tr.children].forEach((td, i) => {
      if (i > 0 && heads[i] && td.colSpan === 1) td.dataset.label = heads[i];
    });
  });
}

document.querySelectorAll('table.grid').forEach((table) => {
  const body = table.tBodies[0];
  if (!body) return;
  labelGridCells(table);
  new MutationObserver(() => labelGridCells(table)).observe(body, { childList: true });
});

document.querySelectorAll('#queue-view [data-qview]').forEach((button) =>
  button.addEventListener('click', () => {
    setQueueView(button.dataset.qview);
    closeSortMenu();
  }),
);

// Le mode mémorisé s'applique dès le chargement, avant la première file :
// sinon le tableau apparaîtrait après coup, en déplaçant tout l'écran.
setQueueView(state.queueView);

/* ================================================== actions groupées ===== */

/**
 * Sélection multiple dans la file.
 *
 * Sur cinq mille messages, le traitement ligne à ligne n'est pas pénible :
 * il est impossible. Trois cents notifications de plateforme se closent d'un
 * geste, ou ne se closent jamais et la file cesse d'être crue.
 *
 * La sélection survit au rechargement de la file — elle est dans `state`, pas
 * dans le DOM — mais pas au changement de filtre : cocher trente messages puis
 * changer d'onglet et agir sur un ensemble qu'on ne voit plus est la meilleure
 * façon de clore ce qu'on ne voulait pas.
 */
function bindPickers() {
  document.querySelectorAll('[data-pick]').forEach((box) =>
    box.addEventListener('change', (event) => {
      const id = box.dataset.pick;
      if (box.checked) state.picked.add(id);
      else state.picked.delete(id);

      // Maj + clic coche toute la plage depuis la dernière case touchée :
      // c'est le geste attendu de toute liste, et sans lui on coche
      // cinquante cases une par une.
      if (event.shiftKey && state.lastPick) {
        const ids = state.tickets.map((ticket) => ticket.id);
        const from = ids.indexOf(state.lastPick);
        const to = ids.indexOf(id);
        if (from !== -1 && to !== -1) {
          for (const between of ids.slice(Math.min(from, to), Math.max(from, to) + 1)) {
            if (box.checked) state.picked.add(between);
            else state.picked.delete(between);
          }
          document.querySelectorAll('[data-pick]').forEach((other) => {
            other.checked = state.picked.has(other.dataset.pick);
            other.closest('.qrow')?.classList.toggle('picked', other.checked);
          });
        }
      }

      state.lastPick = id;
      box.closest('.qrow')?.classList.toggle('picked', box.checked);
      renderBulk();
    }),
  );
}

/*
 * Sélectionner, au téléphone, comme Mail sur iPhone.
 *
 * Une case vide sur chaque ligne, à côté du point bleu des non-lus, faisait
 * deux ronds par message pour un geste qu'on fait rarement. Les cases
 * n'apparaissent qu'après « Sélectionner » ; toucher une ligne la coche
 * alors au lieu de l'ouvrir, et « OK » referme le mode. Sur ordinateur, rien
 * ne change : la case paraît au survol.
 */
const TELEPHONE_FILE = window.matchMedia('(max-width: 760px)');

function enSelection() {
  return TELEPHONE_FILE.matches && Boolean($('view-tickets')?.classList.contains('en-selection'));
}

function modeSelection(actif) {
  $('view-tickets')?.classList.toggle('en-selection', actif);
  const bouton = $('queue-select');
  if (bouton) {
    bouton.textContent = actif ? 'OK' : 'Sélectionner';
    bouton.setAttribute('aria-pressed', String(actif));
  }
  // Sortir du mode, c'est tout décocher : des cases cochées qu'on ne voit
  // plus agiraient encore sur la barre d'actions.
  if (!actif && state.picked.size) clearPicked();
}

$('queue-select')?.addEventListener('click', () => modeSelection(!enSelection()));

/*
 * Le message ouvert prend l'écran, quand la liste et lui s'empilent.
 *
 * Au téléphone et sur une tablette en portrait (900 px et moins), le message
 * s'affichait sous toute la liste, hors de l'écran : toucher une
 * conversation semblait ne rien faire. Comme dans Mail sur iPhone, il prend
 * maintenant la place de la liste, avec « ‹ Conversations » pour revenir ; le
 * bouton Retour d'Android et le geste de retour d'iOS ramènent aussi à la
 * liste, à l'endroit où on l'avait laissée.
 */
const PILE_TICKETS = window.matchMedia('(max-width: 900px)');
let defilementListe = 0;

function ouvrirMessagePile() {
  const vue = $('view-tickets');
  if (!PILE_TICKETS.matches || !vue) return;
  if (!vue.classList.contains('pile-message')) {
    defilementListe = scrollY;
    vue.classList.add('pile-message');
    history.pushState({ csavMessage: true }, '');
  }
  requestAnimationFrame(() => $('d-pane')?.scrollIntoView({ block: 'start' }));
}

function fermerMessagePile({ parHistorique = false } = {}) {
  const vue = $('view-tickets');
  if (!vue?.classList.contains('pile-message')) return;
  vue.classList.remove('pile-message');
  // L'entrée posée à l'ouverture s'en va avec le message : sinon le prochain
  // Retour d'Android ne ferait rien.
  if (!parHistorique && history.state?.csavMessage) history.back();
  requestAnimationFrame(() => scrollTo(0, defilementListe));
}

addEventListener('popstate', () => fermerMessagePile({ parHistorique: true }));
$('d-retour')?.addEventListener('click', () => fermerMessagePile());

function clearPicked() {
  state.picked.clear();
  document.querySelectorAll('[data-pick]').forEach((box) => {
    box.checked = false;
    box.closest('.qrow')?.classList.remove('picked');
  });
  renderBulk();
}

function renderBulk() {
  const bar = $('bulk');
  if (!bar) return;

  const count = state.picked.size;
  bar.hidden = count === 0;
  if (count === 0) return;

  const labels = Object.keys(labelStyles).sort((a, b) => a.localeCompare(b, 'fr'));

  /*
   * Trois rangées, toujours les mêmes.
   *
   * Les huit commandes s'enchaînaient au fil de la largeur : dans la colonne
   * de la file, elles retombaient sur cinq lignes de longueurs inégales, et
   * « Tout décocher » finissait seul au bas. En haut, ce qu'on a coché et la
   * sortie ; au milieu, les quatre gestes de même poids, de même taille ; en
   * bas, les deux choix et la suppression, à l'écart des gestes courants.
   */
  bar.innerHTML = `
    <div class="bulk-tete">
      <b>${count} sélectionné${count > 1 ? 's' : ''}</b>
      <button class="bulk-sortie" type="button" data-bulk="clear">Tout décocher</button>
    </div>
    <div class="bulk-gestes">
      <button class="btn btn-small" data-bulk="read">Marquer lu</button>
      <button class="btn btn-small" data-bulk="unread">Marquer non lu</button>
      <button class="btn btn-small" data-bulk="close">Marquer résolu</button>
      <button class="btn btn-small" data-bulk="analyze">Relancer l’IA</button>
    </div>
    <div class="bulk-choix">
      ${
        labels.length
          ? `<select class="bulk-label" id="bulk-label" aria-label="Poser un libellé">
               <option value="">Libellé…</option>
               ${labels
                 .map((name) => `<option value="${esc(name)}">${esc(name)}</option>`)
                 .join('')}
             </select>`
          : ''
      }
      <select class="bulk-label" id="bulk-assign" aria-label="Assigner à">
        <option value="">Assigner…</option>
        <option value="none">Personne</option>
        ${state.agents
          .map((user) => `<option value="${esc(user.id)}">${esc(user.name ?? user.email)}</option>`)
          .join('')}
      </select>
      ${
        canI('configure')
          ? `<button class="btn btn-small btn-danger" data-bulk="delete">Supprimer</button>`
          : ''
      }
    </div>`;

  bar.querySelectorAll('[data-bulk]').forEach((button) =>
    button.addEventListener('click', () => {
      if (button.dataset.bulk === 'clear') return clearPicked();
      void runBulk(button.dataset.bulk, {}, button);
    }),
  );

  $('bulk-label')?.addEventListener('change', (event) => {
    if (event.target.value) void runBulk('label-add', { label: event.target.value });
  });

  $('bulk-assign')?.addEventListener('change', (event) => {
    if (!event.target.value) return;
    void runBulk('assign', {
      assignee: event.target.value === 'none' ? null : event.target.value,
    });
  });
}

/** Ce que Gmail a fait de la suppression ou des libellés, dit à l'agent. */
const MOTS_GMAIL = {
  suppression: {
    fait: 'Message supprimé, et mis à la corbeille de Gmail.',
    'sans-fil': 'Message supprimé.',
    simule: 'Message supprimé (mode test : Gmail n’a pas été touché).',
    'sans-droit': 'Message supprimé de l’outil. Il reste dans Gmail : reconnectez la boîte pour autoriser la corbeille.',
    echec: 'Message supprimé de l’outil, mais Gmail a refusé la mise à la corbeille.',
  },
  libelle: {
    simule: 'Libellé changé dans l’outil (mode test : Gmail n’a pas été touché).',
    'sans-droit': 'Libellé changé dans l’outil seulement : reconnectez la boîte pour le reporter dans Gmail.',
    echec: 'Libellé changé dans l’outil, mais Gmail a refusé de le reporter.',
  },
};

const BULK_CONFIRM = {
  delete:
    'Supprimer définitivement %n message(s) ?\n\n' +
    'Fils, brouillons et pièces jointes partent avec eux, et les conversations ' +
    'vont à la corbeille de Gmail (récupérables 30 jours depuis Gmail).',
};

async function runBulk(action, extra, button) {
  const ids = [...state.picked];
  const ask = BULK_CONFIRM[action];
  if (ask && !await confirmer(ask.replace('%n', String(ids.length)), { action: 'Supprimer', danger: true, icone: 'corbeille' })) return;

  if (button) button.disabled = true;

  try {
    const result = await api('/api/tickets/bulk', {
      method: 'POST',
      body: JSON.stringify({ ids, action, ...extra }),
    });

    const done = result.affected;
    toast(
      action === 'analyze'
        ? `${done} message${done > 1 ? 's' : ''} remis en traitement.`
        : `${done} message${done > 1 ? 's' : ''} mis à jour.`,
    );

    state.picked.clear();
    modeSelection(false);
    await loadQueue();
  } catch (error) {
    toast(error.message, true);
  } finally {
    if (button) button.disabled = false;
  }
}

/** Droits de l'utilisateur connecté, tels que renvoyés par /api/me. */
function myRole() {
  return state.me?.user?.role ?? 'VIEWER';
}

function canI(permission) {
  const table = {
    reply: ['OWNER', 'SUPERVISOR', 'AGENT'],
    escalate: ['OWNER', 'SUPERVISOR', 'AGENT'],
    refund: ['OWNER', 'SUPERVISOR'],
    configure: ['OWNER', 'SUPERVISOR'],
    manageTeam: ['OWNER'],
  };
  return (table[permission] ?? []).includes(myRole());
}

/**
 * Résumé du message client, au-dessus du fil.
 *
 * Il vient de la même génération que le brouillon : demander deux fois au
 * modèle doublerait le coût et laisserait le résumé décrire un message que la
 * réponse n'a pas traité.
 */
/**
 * Pièces jointes d'un message client.
 *
 * Les images s'affichent, le reste se télécharge. Un client qui signale une
 * semelle décollée joint une photo : la lui redemander parce que l'outil ne
 * sait pas la montrer est la faute la plus visible qu'un SAV puisse commettre.
 */
function renderAttachments(files) {
  if (!files || files.length === 0) return '';

  const items = files
    .map((file) => {
      const url = `/api/attachments/${encodeURIComponent(file.id)}`;
      const isImage = (file.mimeType ?? '').startsWith('image/');

      if (isImage) {
        return `<a class="att att-img" href="${url}" target="_blank" rel="noopener"
                   title="${esc(file.filename)}">
          <img src="${url}" alt="${esc(file.filename)}" loading="lazy" />
        </a>`;
      }

      return `<a class="att att-file" href="${url}" target="_blank" rel="noopener">
        <span class="att-name">${esc(file.filename)}</span>
        <span class="att-size">${formatBytes(file.size)}</span>
      </a>`;
    })
    .join('');

  return `<div class="atts">${items}</div>`;
}

function formatBytes(size) {
  if (!size) return '';
  if (size < 1024) return `${size} o`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} Ko`;
  return `${(size / (1024 * 1024)).toFixed(1).replace('.', ',')} Mo`;
}


/**
 * Libellés du message et suppression, dans l'en-tête du détail.
 *
 * Un libellé posé par Gmail décrit ce que le marchand a déjà décidé ; encore
 * faut-il pouvoir le corriger quand l'automatisme s'est trompé, sans rouvrir
 * Gmail. Le changement est reporté dans Gmail quand la boîte a accordé
 * l'autorisation de le faire ; sinon il reste dans le SAV, et on le dit.
 */
function renderTicketLabels(ticket) {
  const bar = $('d-labels');
  if (!bar) return;

  const mine = new Set(ticket.labels ?? []);
  const known = Object.keys(labelStyles).sort((a, b) => a.localeCompare(b, 'fr'));
  // Un libellé porté mais inconnu du catalogue reste proposé : il vient d'une
  // boîte débranchée ou d'une étiquette renommée, et le retirer de la liste
  // le rendrait impossible à décocher.
  for (const name of mine) if (!known.includes(name)) known.push(name);

  const feuille = (name) => (name.includes('/') ? name.slice(name.lastIndexOf('/') + 1) : name);

  /*
   * Le classement, sur une ligne.
   *
   * Trois choses qu'on lisait à trois endroits : l'intention devinée (une
   * pastille près du nom), sa certitude (une autre), les libellés (une rangée
   * de boutons au-dessus du mail, « Classer ce message » en pointillés). Elles
   * disent toutes la même chose — de quoi parle ce message — et se rangent
   * ensemble : l'intention et sa certitude en une pastille, puis les libellés
   * posés, chacun avec sa croix, puis « + Libellé ».
   */
  const intention = ticket.signalement
    ? `<span class="cl-intention">Signalement<span>· ${esc(ticket.signalement.court)}</span></span>`
    : ticket.intent
      ? `<span class="cl-intention" title="Intention devinée par l’IA, et sa certitude">${esc(
          INTENT_LABELS[ticket.intent] ?? ticket.intent,
        )}${
          ticket.intentConfidence != null
            ? `<span>· sûr à ${Math.round(ticket.intentConfidence * 100)} %</span>`
            : ''
        }</span>`
      : '';

  const pose = (name) => {
    const style = labelStyles[name];
    const paint = style?.background
      ? ` style="background:${esc(style.background)};color:${esc(style.text ?? '#000')}"`
      : '';
    return `<span class="cl-lib" title="${esc(name)}"${paint}>${esc(feuille(name))}<button class="cl-x" type="button"
      data-tlabel="${esc(name)}" aria-label="Retirer ${esc(feuille(name))}">×</button></span>`;
  };

  /*
   * La liste des libellés : une case par ligne, une recherche, une croix.
   *
   * Treize étiquettes en boutons qui passaient à la ligne se lisaient mal :
   * une liste se parcourt de haut en bas, et la case dit d'un coup d'œil ce
   * qui est déjà posé. Elle reste ouverte pendant qu'on coche — on classe
   * souvent sous deux libellés à la fois.
   */
  const ligne = (name) => `<button type="button" class="lmore-item" role="menuitemcheckbox"
      data-tlabel="${esc(name)}" data-nom="${esc(name.toLowerCase())}" aria-checked="${mine.has(name)}">
      <span class="lmore-case" aria-hidden="true"></span><span>${esc(feuille(name))}</span></button>`;

  bar.hidden = false;
  bar.innerHTML =
    '<span class="cl-titre">Classement</span>' +
    intention +
    known.filter((name) => mine.has(name)).map(pose).join('') +
    (known.length
      ? `<details class="lmore">
           <summary class="cl-ajout"><svg viewBox="0 0 12 12" aria-hidden="true"><path d="M6 2v8M2 6h8" /></svg>Libellé</summary>
           <div class="lmore-box" role="dialog" aria-label="Classer ce message">
             <div class="lmore-tete">
               <b>Classer ce message</b>
               <button class="lmore-x" type="button" data-lmore-fermer aria-label="Fermer">×</button>
             </div>
             <label class="lmore-cherche">
               <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="4.5" /><path d="m10.5 10.5 3 3" /></svg>
               <input type="search" data-lmore-q placeholder="Chercher un libellé" aria-label="Chercher un libellé" autocomplete="off" />
             </label>
             <div class="lmore-liste">${known.map(ligne).join('')}</div>
             <p class="lmore-vide" hidden>Aucun libellé ne correspond.</p>
           </div>
         </details>`
      : '');

  const champ = bar.querySelector('[data-lmore-q]');
  champ?.addEventListener('input', () => {
    const aiguille = champ.value.trim().toLowerCase();
    let vus = 0;
    bar.querySelectorAll('.lmore-item').forEach((item) => {
      item.hidden = Boolean(aiguille) && !item.dataset.nom.includes(aiguille);
      if (!item.hidden) vus += 1;
    });
    bar.querySelector('.lmore-vide').hidden = vus > 0;
  });
  bar.querySelector('details.lmore')?.addEventListener('toggle', (event) => {
    if (event.target.open) champ?.focus();
  });

  /*
   * Une seule action mise en avant, en haut à droite, à côté de « Actions ».
   *
   * Les quatre boutons vivaient au bas de la ligne des libellés, tous du même
   * poids : il fallait les lire tous pour en choisir un, et la rangée passait
   * à la ligne sur une colonne étroite. « Écrire au client » est le geste de
   * la journée ; les trois autres descendent dans le menu, sans rien perdre —
   * même clé `data-quick`, même écouteur, même raison de blocage en
   * infobulle quand ils sont interdits.
   */
  const principal = $('d-primary');
  if (principal) {
    principal.innerHTML = actionButton(
      'client',
      'Écrire au client',
      ticket,
      'btn btn-small btn-primary',
    );
  }

  /*
   * Les gestes rares passent sous « ··· ».
   *
   * Six boutons de même poids obligent à lire les six pour en choisir un.
   * Reshipment et Supprimer se font une fois sur vingt : ils gardent leur
   * place, pas leur rang.
   *
   * Rendus ici, dans la même fonction que la rangée principale, pour que
   * leurs écouteurs se posent au même endroit et au même moment. Les répartir
   * entre deux fonctions ferait dépendre le câblage de l'ordre d'appel.
   */
  const menu = $('d-more-menu');
  if (menu) {
    // Cinq gestes, dans l'ordre du métier. Rembourser reste dans le bloc
    // commande, à côté du montant.
    menu.innerHTML =
      actionButton('reshipment', 'Retour', ticket, 'more-item') +
      actionButton('modification', 'Modification', ticket, 'more-item') +
      actionButton('annulation', 'Annulation', ticket, 'more-item') +
      actionButton('update', 'Update', ticket, 'more-item') +
      actionButton('renvoi', 'Renvoi', ticket, 'more-item');
  }

  const quick = {
    client: () => openCompose(ticket),
    supplier: () => openChangeRequest(ticket),
    modification: () => openChangeRequest(ticket, { motifs: ['SIZE', 'PRODUCT', 'ADDRESS'], titre: 'Modification' }),
    annulation: () => ouvrirCommandeShopify(state.detail?.order),
    update: () => void ouvrirUpdate(ticket),
    // Une fenêtre sur le message, la commande déjà remplie : on ne quitte
    // pas le client pour aller chercher une paire dans une autre page.
    renvoi: () => void ouvrirRenvoi(ticket),
    reshipment: () => void openReshipment(ticket),
  };

  for (const [key, run] of Object.entries(quick)) {
    // Les gestes vivent maintenant dans deux conteneurs : la rangée et le
    // menu. Chercher dans le seul `bar` laisserait Reshipment sans écouteur,
    // et le `?.` avalerait l'oubli sans un mot.
    document
      .querySelector(
        `#d-primary [data-quick="${key}"], #d-more-menu [data-quick="${key}"]`,
      )
      ?.addEventListener('click', () => {
        closeMoreMenu();
        run();
      });
  }

  bar.querySelectorAll('[data-tlabel]').forEach((chip) =>
    chip.addEventListener('click', async () => {
      const name = chip.dataset.tlabel;
      const next = mine.has(name)
        ? [...mine].filter((label) => label !== name)
        : [...mine, name];

      try {
        const result = await api(`/api/tickets/${ticket.id}/labels`, {
          method: 'PUT',
          body: JSON.stringify({ labels: next }),
        });
        ticket.labels = result.labels;
        // La liste reste ouverte, sur la même recherche : on coche souvent
        // deux libellés d'affilée.
        const ouvert = bar.querySelector('details.lmore')?.open;
        const recherche = bar.querySelector('[data-lmore-q]')?.value ?? '';
        renderTicketLabels(ticket);
        if (ouvert) {
          bar.querySelector('details.lmore').open = true;
          const champ = bar.querySelector('[data-lmore-q]');
          if (champ && recherche) {
            champ.value = recherche;
            champ.dispatchEvent(new Event('input'));
          }
        }
        if (result.gmail && result.gmail !== 'fait' && result.gmail !== 'sans-fil') {
          toast(MOTS_GMAIL.libelle[result.gmail] ?? MOTS_GMAIL.libelle.echec, result.gmail === 'echec');
        }
        await loadQueue();
      } catch (error) {
        toast(error.message, true);
      }
    }),
  );

  $('d-delete')?.addEventListener('click', async () => {
    if (
      !await confirmer(
        `Supprimer définitivement « ${ticket.subject ?? '(sans objet)'} » ?\n\n` +
          'Le fil, les brouillons et les pièces jointes partent avec lui, et la ' +
          'conversation va à la corbeille de Gmail (récupérable 30 jours depuis Gmail).',
        { action: 'Supprimer', danger: true, icone: 'corbeille' },
      )
    ) {
      return;
    }

    try {
      const resultat = await api(`/api/tickets/${ticket.id}`, { method: 'DELETE' });
      toast(MOTS_GMAIL.suppression[resultat.gmail] ?? 'Message supprimé.', resultat.gmail === 'echec');
      state.currentId = null;
      bar.hidden = true;
      await loadQueue();
    } catch (error) {
      toast(error.message, true);
    }
  });
}

function renderBrief(draft) {
  const brief = $('d-brief');
  // Pas de fil, pas de section : le cadre vide ferait croire à une panne.
  markPane('d-fold', !state.detail?.ticket);
  const points = draft?.summary ?? [];
  const ask = draft?.ask ?? '';

  // Rien à montrer : on masque au lieu d'afficher un cadre vide, qui ferait
  // croire à une panne plutôt qu'à une absence. Le fil, lui, reste affiché —
  // il ne dépend plus du résumé, qui ne le remplaçait pas.
  if (points.length === 0 && !ask) {
    brief.hidden = true;
    return;
  }

  brief.hidden = false;

  $('d-ask').textContent = ask;
  $('d-ask').hidden = !ask;
  $('d-summary').innerHTML = points.map((line) => `<li>${esc(line)}</li>`).join('');

  renderBriefFacts();
}

/**
 * Les faits du dossier, en puces sous le résumé.
 *
 * Ils ne sont pas extraits du texte généré mais lus sur la commande Shopify :
 * un montant recopié depuis une phrase de modèle n'engage personne, et c'est
 * sur celui-là qu'un agent rembourse.
 *
 * Chaque puce n'apparaît que si sa donnée existe. Sans commande rattachée —
 * cas courant du produit — il ne reste que l'intention, et c'est honnête.
 */
function renderBriefFacts() {
  const box = $('d-facts');
  if (!box) return;

  const ticket = state.detail?.ticket;
  const order = state.detail?.order;
  if (!ticket) {
    box.hidden = true;
    return;
  }

  const facts = [];

  /*
   * L'intention n'est pas reprise ici : l'en-tête du ticket la porte déjà,
   * quarante pixels plus haut, et avec le pourcentage de confiance que le
   * résumé n'a pas. La répéter poussait la quatrième pastille sur une
   * deuxième ligne, qui coûtait vingt-neuf pixels pour redire ce mot.
   */
  if (order?.name ?? ticket.orderName) {
    facts.push(['Commande', order?.name ?? ticket.orderName, false]);
  }
  if (order) {
    facts.push(['Montant', euro(order.totalPrice, order.currency), false]);

    // Les états bruts de Shopify se lisent en anglais administratif ; les
    // tables de traduction existent déjà pour la fiche commande.
    const paid = FINANCIAL_LABELS[order.displayFinancialStatus];
    const ship = FULFILLMENT_LABELS[order.displayFulfillmentStatus];
    const etat = [paid, ship].filter(Boolean).join(' · ');
    // Orange quand quelque chose cloche du côté de l'argent ou du colis :
    // c'est ce qui décide de l'action, pas la couleur d'une pastille.
    const alerte =
      order.displayFinancialStatus !== 'PAID' ||
      order.displayFulfillmentStatus === 'UNFULFILLED' ||
      order.displayFulfillmentStatus === 'ON_HOLD';
    if (etat) facts.push(['Statut', etat, alerte]);
  }

  box.hidden = facts.length === 0;
  box.innerHTML = facts
    .map(
      ([label, value, alerte]) =>
        `<span class="bf${alerte ? ' bf-warn' : ''}">${esc(label)} <b>${esc(value)}</b></span>`,
    )
    .join('');
}


/*
 * Analyse à la demande.
 *
 * La file de fond avale des milliers de messages à cadence bridée : quand on
 * ouvre un mail précis, on n'attend pas son tour, on veut son résumé. Le
 * bouton lance le même traitement que le worker, sur ce seul message.
 *
 * Déclenché tout seul à l'ouverture quand le message n'a jamais été analysé —
 * c'est le geste qu'on ferait de toute façon, et le faire faire à la main
 * transformerait chaque lecture en corvée. Une seule tentative par message et
 * par session : un mail que l'IA refuse ne doit pas relancer un appel à chaque
 * clic.
 */
const analysed = new Set();

function analyseButton(label) {
  return `<br><button class="btn btn-small btn-primary" id="d-analyse"
    style="margin-top:9px">${label}</button>`;
}

async function runAnalyse(ticketId, button) {
  analysed.add(ticketId);

  if (button) {
    button.disabled = true;
    button.textContent = 'L’IA lit le message…';
  }

  try {
    await api(`/api/tickets/${ticketId}/analyze`, { method: 'POST', body: '{}' });
    // On recharge le détail plutôt que de recoller la réponse : le statut, le
    // libellé et la commande rattachée changent aussi. Le préchargement est
    // vidé d'abord, sinon on réafficherait la version d'avant l'analyse.
    prefetched.delete(ticketId);
    if (state.currentId === ticketId) await selectTicket(ticketId);
    await loadQueue();
  } catch (error) {
    if (button) {
      button.disabled = false;
      button.textContent = 'Réessayer';
    }
    toast(error.message, true);
  }
}

function bindAnalyse(ticket) {
  const button = $('d-analyse');
  button?.addEventListener('click', () => void runAnalyse(ticket.id, button));

  // Jamais deux fois de suite sur le même message, et jamais sur un message
  // clos : relire une archive ne doit pas coûter un appel au modèle.
  if (!analysed.has(ticket.id) && ticket.status !== 'CLOSED' && ticket.status !== 'AUTO_SENT') {
    void runAnalyse(ticket.id, button);
  }
}

function renderDraft(draft, ticket) {
  const zone = $('draft-zone');
  const none = $('no-draft');

  renderBrief(draft);

  // Un ticket en échec doit dire pourquoi, à l'endroit où l'on constate
  // l'absence de brouillon. Sans ça, « Échec » envoie lire les journaux du
  // serveur — c'est-à-dire que personne ne saura jamais.
  if (ticket.status === 'FAILED' && ticket.failureReason) {
    zone.hidden = true;
    none.hidden = false;
    $('no-draft-text').innerHTML =
      `<b class="set-alert">Le traitement a échoué.</b><br>` +
      `<span class="mono" style="font-size:12px">${esc(ticket.failureReason)}</span>` +
      analyseButton('Réessayer maintenant');
    bindAnalyse(ticket);
    return;
  }

  /*
   * Un signalement d'atelier n'appelle pas de réponse au client rédigée par
   * l'IA : il n'y a pas de client au bout du fil. On ne lance donc pas
   * l'analyse à l'ouverture — elle répondait au fournisseur comme à un client.
   */
  if (ticket.signalement) {
    zone.hidden = true;
    none.hidden = false;
    $('no-draft-text').innerHTML =
      `<b>Signalé par ${esc(ticket.signalement.fournisseur ?? 'votre atelier')} depuis son espace.</b><br>` +
      'Corrigez la commande, puis classez le signalement : l’atelier le verra repris dans son espace.' +
      `<br><span class="sig-acts">
         <button class="btn btn-small btn-primary" id="d-sig-done">Traité</button>
         <button class="btn btn-small" id="d-sig-liste">Tous les signalements</button>
       </span>`;
    $('d-sig-done').addEventListener('click', async (event) => {
      event.currentTarget.disabled = true;
      try {
        // La même porte que le raccourci E : le ticket clos passe « Clos »
        // dans l'espace de l'atelier.
        await api(`/api/tickets/${ticket.id}/resolve`, { method: 'POST', body: '{}' });
        toast('Signalement classé — l’atelier le voit comme repris.');
        await loadQueue();
        if (state.currentId === ticket.id) void selectTicket(ticket.id, { silent: true });
      } catch (error) {
        event.currentTarget.disabled = false;
        toast(error.message, true);
      }
    });
    $('d-sig-liste').addEventListener('click', () => setView('suppliers'));
    return;
  }

  if (!draft) {
    zone.hidden = true;
    none.hidden = false;
    $('no-draft-text').innerHTML =
      (ticket.intent === 'POSITIVE' || ticket.intent === 'OTHER'
        ? "Ce message n'appelle pas de réponse automatique — il a été classé sans action."
        : 'Pas encore de résumé ni de réponse pour ce message.') +
      analyseButton('Résumer et proposer une réponse');
    bindAnalyse(ticket);
    return;
  }

  zone.hidden = false;
  none.hidden = true;

  $('d-body').value = draft.body;
  $('d-reason').textContent = draft.reasoning ?? '—';

  const fill = $('d-conf-fill');
  fill.style.width = `${Math.round(draft.confidence * 100)}%`;
  fill.className =
    'conf-fill' + (draft.confidence < 0.5 ? ' bad' : draft.confidence < 0.8 ? ' low' : '');
  $('d-conf-num').textContent = draft.confidence.toFixed(2).replace('.', ',');

  const sent = draft.status === 'SENT';
  // Un rôle sans le droit voit le bouton désactivé plutôt que masqué : cacher
  // laisserait croire à une régression du produit, et le titre explique.
  const mayReply = canI('reply');

  $('btn-send').disabled = sent || !mayReply;
  $('btn-send').textContent = sent ? 'Réponse envoyée' : 'Envoyer la réponse';
  $('btn-save').disabled = sent || !mayReply;
  if (!mayReply) {
    $('btn-send').title = 'Votre rôle est en lecture seule.';
    $('btn-save').title = 'Votre rôle est en lecture seule.';
  }
}

function row(label, value, mono = false) {
  return `<div class="row"><dt>${label}</dt><dd${
    mono ? ' class="mono"' : ''
  }>${esc(value)}</dd></div>`;
}

/*
 * « Voir le profil » vit dans l'en-tête de la carte, pas dans son corps.
 *
 * Le nœud est statique et le corps se réécrit à chaque ticket : lier ici, une
 * seule fois, et lire l'état au moment du clic. Un `addEventListener` posé
 * dans la fonction de rendu empilerait un écouteur par ticket ouvert, et
 * ouvrirait N fiches au premier clic.
 */
$('c-sheet')?.addEventListener('click', () => {
  const customer = state.detail?.order?.customer;
  const email = customer?.email ?? state.detail?.ticket?.customerEmail;
  if (email) void openCustomerSheet(email, customer?.displayName ?? '');
});

function renderCustomer(order) {
  const customer = order?.customer;

  // Sans commande rattachée, l'email du ticket suffit à ouvrir la fiche : elle
  // contient justement de quoi retrouver la commande manquante.
  const ticketEmail = state.detail?.ticket?.customerEmail ?? null;
  const name = customer?.displayName ?? state.detail?.ticket?.customerName ?? ticketEmail;

  // Le lien d'en-tête n'a de sens qu'avec une adresse à ouvrir.
  const sheet = $('c-sheet');
  if (sheet) sheet.hidden = !(customer?.email ?? ticketEmail);

  if (!customer) {
    $('c-customer').innerHTML = ticketEmail
      ? '<p class="empty">Aucune commande rattachée.</p>'
      : '<p class="empty">Fiche client indisponible sans commande rattachée.</p>';
    return;
  }

  $('c-customer').innerHTML =
    /*
     * L'identité en tête, comme sur une fiche : le visage avant les chiffres.
     * L'avatar porte la teinte de la file et du fil — la même personne garde
     * sa couleur d'un bout à l'autre du produit.
     */
    `<div class="rail-id">
       <span class="rail-av" aria-hidden="true" style="background:${avatarTint(name ?? '')}"
         >${esc(initials(name ?? ''))}</span>
       <span class="rail-id-txt">
         <b>${esc(name ?? '—')}</b>
         ${customer.email ? `<code>${esc(customer.email)}</code>` : ''}
       </span>
     </div>` +
    /*
     * Un premier achat ne se traite pas comme un huitième : on est plus
     * conciliant, et on explique davantage. C'est la seule information de
     * cette carte qui change le ton d'une réponse, d'où la pastille.
     */
    (customer.numberOfOrders === 1
      ? '<p class="rail-flag"><span class="tp tp-intent">Nouveau client</span></p>'
      : '') +
    '<dl>' +
    row('Commandes', String(customer.numberOfOrders ?? 0), true) +
    (customer.amountSpent
      ? row('Total dépensé', euro(customer.amountSpent, order.currency), true)
      : '') +
    /*
     * « Client depuis » avait été retiré du rail, au motif qu'il « ne décidait
     * rien ». Il est remis à la demande explicite du marchand : l'ancienneté
     * pèse sur le ton d'une réponse autant que le nombre de commandes, et un
     * client de la première heure ne s'adresse pas comme un inscrit d'hier.
     * Consigné ici pour que ce retour soit lu comme un choix, et non comme un
     * oubli de la décision précédente.
     */
    (customer.createdAt ? row('Client depuis', fullDate(customer.createdAt)) : '') +
    phoneRow(order, name) +
    '</dl>' +
    adresseClient(order);
}

/*
 * L'adresse du client, dans la carte qui parle de lui.
 *
 * Deux adresses coexistent et ne disent pas la même chose : celle de la
 * commande dit où CE colis part, celle du compte dit où le client habite
 * aujourd'hui. Elles divergent dès qu'il a déménagé ou qu'il a fait livrer
 * chez quelqu'un d'autre — et c'est précisément ce qu'un agent doit savoir
 * avant de renvoyer un article.
 *
 * On préfère donc l'adresse du compte. Mais la majorité des commandes Shopify
 * sont passées en invité, sans compte et donc sans adresse : dans ce cas la
 * carte serait vide alors que l'information existe, à côté. On retombe sur
 * celle de la commande, en le DISANT — une adresse dont on tait la provenance
 * se lit comme l'adresse du client, ce qu'elle n'est pas forcément.
 */
function adresseClient(order) {
  const propre = order?.customer?.address;
  if (propre) {
    const bloc = blocAdresse(propre);
    if (!bloc) return '';
    return (
      `<p class="adr-title">Adresse${
        order.shippingAddress && !memeAdresse(propre, order.shippingAddress)
          ? '<span class="adr-diff">livraison différente</span>'
          : ''
      }</p>` + bloc
    );
  }

  const livraison = blocAdresse(order?.shippingAddress);
  if (!livraison) return '';
  return `<p class="adr-title">Adresse<span class="adr-src">de la commande</span></p>${livraison}`;
}

/*
 * Le téléphone du client, tel que le ticket le transporte.
 *
 * Le seul numéro qui arrive avec un ticket est celui de l'adresse de
 * livraison — Shopify ne livre pas celui du compte dans cette requête. Le
 * pays vient de la même adresse, en ISO 3166-1 alpha-2 : c'est lui, et lui
 * seul, qui permet de composer un numéro national. Sans pays connu, un
 * « 06 12 34 56 78 » reste un numéro qu'on affiche mais qu'on ne compose pas.
 */
function customerPhone(order) {
  const address = order?.shippingAddress;
  const raw = (address?.phone ?? '').trim();
  if (!raw) return null;

  const number = whatsappNumber(raw, address?.country);

  /*
   * Quand on ne peut pas composer, dire laquelle des deux raisons.
   *
   * L'écran affichait « Numéro non valide pour WhatsApp » dans tous les cas.
   * C'était faux la plupart du temps : le numéro d'une cliente américaine est
   * parfaitement valide, c'est l'application qui ignorait l'indicatif de son
   * pays. Accuser la donnée d'un défaut qui est le nôtre envoie chercher
   * l'erreur là où elle n'est pas.
   */
  const paysConnu = Boolean(DIAL_CODES[String(address?.country ?? '').toUpperCase()]);
  const raison = number
    ? null
    : paysConnu
      ? 'Ce numéro ne compose pas : il ne correspond pas au format du pays.'
      : `Indicatif inconnu pour ce pays${
          address?.country ? ` (${address.country})` : ''
        } — l'application ne sait pas composer ce numéro. Le numéro, lui, est probablement bon.`;

  return {
    raw,
    number,
    affiche: numeroAffiche(raw, number, address?.country),
    link: whatsappLink(number),
    raison,
  };
}

/*
 * Le numéro tel qu'on l'affiche : avec son indicatif.
 *
 * Shopify rend le numéro TEL QUE le client l'a saisi, le plus souvent au
 * format national — « 4783490262 », « 0612345678 ». Sans indicatif, un agent
 * ne sait pas de quel pays il s'agit, ne peut pas le composer depuis ailleurs,
 * et ne peut pas le dicter à un transporteur. Or la forme internationale est
 * DÉJÀ calculée pour WhatsApp : il suffisait de l'afficher.
 *
 * L'indicatif vient de la table, jamais d'une découpe du numéro : il fait un,
 * deux ou trois chiffres selon le pays, et prendre le premier donnait
 * « +3 36 12 34 56 78 » pour la France.
 *
 * Le reste n'est regroupé QUE pour l'Amérique du Nord, en 3-3-4 : indicatif
 * régional, central, ligne. C'est la seule zone où la découpe est la même
 * pour les vingt-cinq pays du plan et où le numéro national fait toujours dix
 * chiffres — on ne peut donc pas se tromper.
 *
 * Ailleurs, rien. Chaque pays a sa convention — la France par deux, le
 * Royaume-Uni en 4-6, l'Allemagne selon la longueur de l'indicatif régional —
 * et appliquer la mauvaise fait plus désordonné que de n'en appliquer aucune.
 * Un espace après l'indicatif suffit à dire où il s'arrête.
 *
 * Sans indicatif connu, on rend la saisie d'origine : en inventer un serait
 * pire que de n'en afficher aucun.
 */
function numeroAffiche(brut, e164, pays) {
  if (!e164) return brut;

  const dial = DIAL_CODES[String(pays ?? '').toUpperCase()]?.dial;
  if (!dial || !e164.startsWith(dial)) return `+${e164}`;

  const national = e164.slice(dial.length);

  // La longueur est vérifiée avant de découper : un numéro nord-américain
  // hors format — dix chiffres attendus — se rendrait en morceaux faux.
  if (dial === '1' && national.length === 10) {
    return `+1 ${national.slice(0, 3)} ${national.slice(3, 6)} ${national.slice(6)}`;
  }

  return `+${dial} ${national}`;
}

/*
 * Le numéro et son bouton sur la même ligne.
 *
 * Le bouton occupait une rangée entière sous le dossier, à quarante pixels du
 * numéro qu'il compose — alors que le tiroir de commande, lui, les met déjà
 * côte à côte. Deux endroits du produit proposaient le même geste de deux
 * façons différentes. L'icône seule porte la marque : dans un outil de
 * travail, un bouton vert pleine largeur crie plus qu'il n'aide.
 */
function phoneRow(order, name) {
  const phone = customerPhone(order);
  if (!phone) return '';

  const numero = phone.link
    ? `<a class="rail-phone" href="${esc(phone.link)}" target="_blank" rel="noopener noreferrer"
         title="Ouvrir dans WhatsApp — saisi : ${esc(phone.raw)}">${esc(phone.affiche)}</a>`
    : `<span class="rail-phone-off" title="${esc(phone.raison)}">${esc(phone.affiche)}</span>`;

  // Sans numéro composable, pas de bouton : une icône qui ouvrirait une URL
  // vide vaut moins que rien du tout.
  const bouton = phone.link
    ? `<a class="wa-icon" href="${esc(phone.link)}" target="_blank" rel="noopener noreferrer"
         aria-label="Ouvrir WhatsApp avec ${esc(name ?? 'le client')}"
         title="Ouvrir la conversation dans WhatsApp Web">${ico('whatsapp')}</a>`
    : '';

  return `<div class="row"><dt>Téléphone</dt><dd class="dd-wa">${numero}${bouton}</dd></div>`;
}

/**
 * Lien vers la commande dans l'admin Shopify.
 *
 * L'agent y va pour ce que le SAV ne fait pas : modifier une adresse, éditer
 * une ligne, consulter le paiement. Reconstruire l'URL de tête à chaque fois
 * coûte trente secondes et une erreur de numéro sur deux.
 *
 * L'identifiant Shopify est un GID — `gid://shopify/Order/123` — dont l'admin
 * n'attend que la partie numérique. Sans domaine de boutique ou sans
 * identifiant, on n'affiche rien : un lien mort vaut moins que pas de lien.
 */
function shopifyOrderLink(order, label = null) {
  const shop = state.me?.merchant?.shopDomain;
  const id = String(order?.id ?? '').split('/').pop();

  if (!shop || !id || !/^\d+$/.test(id)) return '';

  const href = `https://${esc(shop)}/admin/orders/${esc(id)}`;

  // Deux emplois du même lien : discret dans l'en-tête de la carte, où il
  // porte le numéro ; en bouton sous les articles, où il porte l'action.
  return label
    ? `<a class="linkish rail-more" target="_blank" rel="noopener noreferrer"
        href="${href}">${esc(label)}</a>`
    : `<a class="btn btn-small rail-link" target="_blank" rel="noopener noreferrer"
        href="${href}">Voir dans Shopify</a>`;
}

/*
 * Indicatif pays et préfixe national, par code ISO 3166-1 alpha-2.
 *
 * Shopify livre le numéro TEL QUE le client l'a saisi — le plus souvent au
 * format national — et le code pays de l'adresse de livraison. Pour composer
 * sur WhatsApp il faut du E.164 : retirer le préfixe national s'il est en
 * tête, puis préfixer par l'indicatif.
 *
 * CE QUI EST EN JEU. Un préfixe faux n'échoue pas : il produit un numéro
 * plausible. Le marchand ouvre alors une conversation avec un inconnu, depuis
 * son compte, à propos de la commande d'un client. Noté « 0 » pour un pays qui
 * n'en a pas, il mange le premier chiffre ; noté vide pour un pays qui en a
 * un, il laisse un zéro parasite.
 *
 * D'où la règle de cette table : aucune entrée n'y figure sans un exemple qui
 * l'éprouve dans tests/whatsappNumber.test.ts, et le test refuse toute ligne
 * ajoutée sans le sien. Onze pays ont été écartés parce que le couple
 * (indicatif, préfixe) ne suffit pas à décrire leur plan — l'Argentine et ses
 * mobiles en 9, la Biélorussie dont le préfixe est « 80 », la Lituanie en
 * pleine transition, le Vatican dont l'indicatif 379 n'est pas en service. Les
 * y forcer aurait produit des numéros faux et plausibles ; leur absence
 * produit un bouton absent, qui se voit.
 */
const DIAL_CODES = {

  /*
   * Le plan de numérotation nord-américain : vingt-cinq territoires, un seul
   * indicatif. Le « 1 » composé avant un appel longue distance n'est pas un
   * préfixe national — le numéro national fait dix chiffres, indicatif
   * régional compris — d'où le préfixe vide. Le cas du « 1 » saisi en tête
   * est traité dans `whatsappNumber`, pas ici.
   */
  AG: { dial: '1', trunk: '' }, // Antigua-et-Barbuda
  AI: { dial: '1', trunk: '' }, // Anguilla
  AS: { dial: '1', trunk: '' }, // Samoa américaines
  BB: { dial: '1', trunk: '' }, // Barbade
  BM: { dial: '1', trunk: '' }, // Bermudes
  BS: { dial: '1', trunk: '' }, // Bahamas
  CA: { dial: '1', trunk: '' }, // Canada
  DM: { dial: '1', trunk: '' }, // Dominique
  DO: { dial: '1', trunk: '' }, // République dominicaine
  GD: { dial: '1', trunk: '' }, // Grenade
  GU: { dial: '1', trunk: '' }, // Guam
  JM: { dial: '1', trunk: '' }, // Jamaïque
  KN: { dial: '1', trunk: '' }, // Saint-Christophe-et-Niévès
  KY: { dial: '1', trunk: '' }, // Îles Caïmans
  LC: { dial: '1', trunk: '' }, // Sainte-Lucie
  MP: { dial: '1', trunk: '' }, // Îles Mariannes du Nord
  MS: { dial: '1', trunk: '' }, // Montserrat
  PR: { dial: '1', trunk: '' }, // Porto Rico
  SX: { dial: '1', trunk: '' }, // Saint-Martin (partie néerlandaise)
  TC: { dial: '1', trunk: '' }, // Îles Turques-et-Caïques
  TT: { dial: '1', trunk: '' }, // Trinité-et-Tobago
  US: { dial: '1', trunk: '' }, // États-Unis
  VC: { dial: '1', trunk: '' }, // Saint-Vincent-et-les-Grenadines
  VG: { dial: '1', trunk: '' }, // Îles Vierges britanniques
  VI: { dial: '1', trunk: '' }, // Îles Vierges des États-Unis

  /* Le reste du monde, par ordre de code ISO. */
  AD: { dial: '376', trunk: '' }, // Andorre
  AE: { dial: '971', trunk: '0' }, // Émirats arabes unis
  AL: { dial: '355', trunk: '0' }, // Albanie
  AO: { dial: '244', trunk: '' }, // Angola
  AT: { dial: '43', trunk: '0' }, // Autriche
  AU: { dial: '61', trunk: '0' }, // Australie
  AX: { dial: '358', trunk: '0' }, // Îles Åland
  BA: { dial: '387', trunk: '0' }, // Bosnie-Herzégovine
  BD: { dial: '880', trunk: '0' }, // Bangladesh
  BE: { dial: '32', trunk: '0' }, // Belgique
  BF: { dial: '226', trunk: '' }, // Burkina Faso
  BG: { dial: '359', trunk: '0' }, // Bulgarie
  BH: { dial: '973', trunk: '' }, // Bahreïn
  BI: { dial: '257', trunk: '' }, // Burundi
  BJ: { dial: '229', trunk: '' }, // Bénin
  BO: { dial: '591', trunk: '' }, // Bolivie
  BR: { dial: '55', trunk: '0' }, // Brésil
  BW: { dial: '267', trunk: '' }, // Botswana
  BZ: { dial: '501', trunk: '' }, // Belize
  CD: { dial: '243', trunk: '0' }, // RD Congo
  CG: { dial: '242', trunk: '' }, // Congo-Brazzaville
  CH: { dial: '41', trunk: '0' }, // Suisse
  CI: { dial: '225', trunk: '' }, // Côte d'Ivoire
  CL: { dial: '56', trunk: '' }, // Chili
  CM: { dial: '237', trunk: '' }, // Cameroun
  CN: { dial: '86', trunk: '0' }, // Chine
  CO: { dial: '57', trunk: '' }, // Colombie
  CR: { dial: '506', trunk: '' }, // Costa Rica
  CV: { dial: '238', trunk: '' }, // Cap-Vert
  CY: { dial: '357', trunk: '' }, // Chypre
  CZ: { dial: '420', trunk: '' }, // Tchéquie
  DE: { dial: '49', trunk: '0' }, // Allemagne
  DJ: { dial: '253', trunk: '' }, // Djibouti
  DK: { dial: '45', trunk: '' }, // Danemark
  DZ: { dial: '213', trunk: '0' }, // Algérie
  EC: { dial: '593', trunk: '0' }, // Équateur
  EE: { dial: '372', trunk: '' }, // Estonie
  EG: { dial: '20', trunk: '0' }, // Égypte
  ER: { dial: '291', trunk: '0' }, // Érythrée
  ES: { dial: '34', trunk: '' }, // Espagne
  ET: { dial: '251', trunk: '0' }, // Éthiopie
  FI: { dial: '358', trunk: '0' }, // Finlande
  FJ: { dial: '679', trunk: '' }, // Fidji
  FO: { dial: '298', trunk: '' }, // Îles Féroé
  FR: { dial: '33', trunk: '0' }, // France
  GA: { dial: '241', trunk: '0' }, // Gabon
  GB: { dial: '44', trunk: '0' }, // Royaume-Uni
  GF: { dial: '594', trunk: '0' }, // Guyane française
  GG: { dial: '44', trunk: '0' }, // Guernesey
  GH: { dial: '233', trunk: '0' }, // Ghana
  GI: { dial: '350', trunk: '' }, // Gibraltar
  GL: { dial: '299', trunk: '' }, // Groenland
  GM: { dial: '220', trunk: '' }, // Gambie
  GN: { dial: '224', trunk: '' }, // Guinée
  GQ: { dial: '240', trunk: '' }, // Guinée équatoriale
  GR: { dial: '30', trunk: '' }, // Grèce
  GT: { dial: '502', trunk: '' }, // Guatemala
  GY: { dial: '592', trunk: '' }, // Guyana
  HK: { dial: '852', trunk: '' }, // Hong Kong
  HN: { dial: '504', trunk: '' }, // Honduras
  HR: { dial: '385', trunk: '0' }, // Croatie
  HU: { dial: '36', trunk: '06' }, // Hongrie
  ID: { dial: '62', trunk: '0' }, // Indonésie
  IE: { dial: '353', trunk: '0' }, // Irlande
  IL: { dial: '972', trunk: '0' }, // Israël
  IM: { dial: '44', trunk: '0' }, // Île de Man
  IN: { dial: '91', trunk: '0' }, // Inde
  IQ: { dial: '964', trunk: '0' }, // Irak
  IR: { dial: '98', trunk: '0' }, // Iran
  IS: { dial: '354', trunk: '' }, // Islande
  IT: { dial: '39', trunk: '' }, // Italie
  JE: { dial: '44', trunk: '0' }, // Jersey
  JO: { dial: '962', trunk: '0' }, // Jordanie
  JP: { dial: '81', trunk: '0' }, // Japon
  KE: { dial: '254', trunk: '0' }, // Kenya
  KH: { dial: '855', trunk: '0' }, // Cambodge
  KR: { dial: '82', trunk: '0' }, // Corée du Sud
  KW: { dial: '965', trunk: '' }, // Koweït
  KZ: { dial: '7', trunk: '8' }, // Kazakhstan
  LB: { dial: '961', trunk: '0' }, // Liban
  LI: { dial: '423', trunk: '' }, // Liechtenstein
  LK: { dial: '94', trunk: '0' }, // Sri Lanka
  LR: { dial: '231', trunk: '0' }, // Liberia
  LS: { dial: '266', trunk: '' }, // Lesotho
  LU: { dial: '352', trunk: '' }, // Luxembourg
  LV: { dial: '371', trunk: '' }, // Lettonie
  LY: { dial: '218', trunk: '0' }, // Libye
  MA: { dial: '212', trunk: '0' }, // Maroc
  MC: { dial: '377', trunk: '' }, // Monaco
  MD: { dial: '373', trunk: '0' }, // Moldavie
  ME: { dial: '382', trunk: '0' }, // Monténégro
  MG: { dial: '261', trunk: '0' }, // Madagascar
  MK: { dial: '389', trunk: '0' }, // Macédoine du Nord
  ML: { dial: '223', trunk: '' }, // Mali
  MR: { dial: '222', trunk: '' }, // Mauritanie
  MT: { dial: '356', trunk: '' }, // Malte
  MU: { dial: '230', trunk: '' }, // Maurice
  MW: { dial: '265', trunk: '0' }, // Malawi
  MX: { dial: '52', trunk: '' }, // Mexique
  MY: { dial: '60', trunk: '0' }, // Malaisie
  MZ: { dial: '258', trunk: '' }, // Mozambique
  NA: { dial: '264', trunk: '0' }, // Namibie
  NE: { dial: '227', trunk: '' }, // Niger
  NG: { dial: '234', trunk: '0' }, // Nigeria
  NI: { dial: '505', trunk: '' }, // Nicaragua
  NL: { dial: '31', trunk: '0' }, // Pays-Bas
  NO: { dial: '47', trunk: '' }, // Norvège
  NZ: { dial: '64', trunk: '0' }, // Nouvelle-Zélande
  OM: { dial: '968', trunk: '' }, // Oman
  PA: { dial: '507', trunk: '' }, // Panama
  PE: { dial: '51', trunk: '0' }, // Pérou
  PG: { dial: '675', trunk: '' }, // Papouasie-Nouvelle-Guinée
  PH: { dial: '63', trunk: '0' }, // Philippines
  PK: { dial: '92', trunk: '0' }, // Pakistan
  PL: { dial: '48', trunk: '' }, // Pologne
  PS: { dial: '970', trunk: '0' }, // Palestine
  PT: { dial: '351', trunk: '' }, // Portugal
  PY: { dial: '595', trunk: '0' }, // Paraguay
  QA: { dial: '974', trunk: '' }, // Qatar
  RO: { dial: '40', trunk: '0' }, // Roumanie
  RS: { dial: '381', trunk: '0' }, // Serbie
  RU: { dial: '7', trunk: '8' }, // Russie
  RW: { dial: '250', trunk: '0' }, // Rwanda
  SA: { dial: '966', trunk: '0' }, // Arabie saoudite
  SC: { dial: '248', trunk: '' }, // Seychelles
  SD: { dial: '249', trunk: '0' }, // Soudan
  SE: { dial: '46', trunk: '0' }, // Suède
  SG: { dial: '65', trunk: '' }, // Singapour
  SI: { dial: '386', trunk: '0' }, // Slovénie
  SJ: { dial: '47', trunk: '' }, // Svalbard et Jan Mayen
  SK: { dial: '421', trunk: '0' }, // Slovaquie
  SL: { dial: '232', trunk: '0' }, // Sierra Leone
  SM: { dial: '378', trunk: '' }, // Saint-Marin
  SN: { dial: '221', trunk: '' }, // Sénégal
  SR: { dial: '597', trunk: '' }, // Suriname
  SV: { dial: '503', trunk: '' }, // Salvador
  SY: { dial: '963', trunk: '0' }, // Syrie
  SZ: { dial: '268', trunk: '' }, // Eswatini
  TD: { dial: '235', trunk: '' }, // Tchad
  TG: { dial: '228', trunk: '' }, // Togo
  TH: { dial: '66', trunk: '0' }, // Thaïlande
  TN: { dial: '216', trunk: '' }, // Tunisie
  TR: { dial: '90', trunk: '0' }, // Turquie
  TW: { dial: '886', trunk: '0' }, // Taïwan
  TZ: { dial: '255', trunk: '0' }, // Tanzanie
  UA: { dial: '380', trunk: '0' }, // Ukraine
  UG: { dial: '256', trunk: '0' }, // Ouganda
  UY: { dial: '598', trunk: '0' }, // Uruguay
  UZ: { dial: '998', trunk: '0' }, // Ouzbékistan
  VE: { dial: '58', trunk: '0' }, // Venezuela
  VN: { dial: '84', trunk: '0' }, // Viêt Nam
  XK: { dial: '383', trunk: '0' }, // Kosovo
  ZA: { dial: '27', trunk: '0' }, // Afrique du Sud
  ZM: { dial: '260', trunk: '0' }, // Zambie
  ZW: { dial: '263', trunk: '0' }, // Zimbabwe
};

/**
 * Le numéro tel que WhatsApp l'attend : indicatif puis numéro, chiffres seuls.
 *
 * Déjà international (« + » ou « 00 ») : on garde les chiffres. National : on
 * compose avec l'indicatif du pays de l'adresse — jamais avec un pays
 * supposé. Rend `null` dès que le résultat n'a pas la forme d'un numéro
 * (E.164 : huit à quinze chiffres, pas de zéro de tête) : mieux vaut pas de
 * lien qu'un lien qui ouvre WhatsApp sur rien.
 */
function whatsappNumber(raw, countryCode) {
  const text = String(raw ?? '').trim();
  if (!text) return null;

  const digits = text.replace(/\D/g, '');
  const country = DIAL_CODES[String(countryCode ?? '').toUpperCase()] ?? null;
  let number;

  if (text.startsWith('+') || text.startsWith('00')) {
    number = text.startsWith('00') ? digits.slice(2) : digits;
    // « +33 (0)6 … » : le zéro entre parenthèses est le préfixe national,
    // écrit par habitude. On ne le retire que si le pays le confirme.
    if (country?.trunk && number.startsWith(country.dial + country.trunk)) {
      number = country.dial + number.slice(country.dial.length + country.trunk.length);
    }
  } else {
    if (!country) return null;

    /*
     * Amérique du Nord : le numéro national fait dix chiffres, mais beaucoup
     * de clients écrivent les onze, indicatif pays compris. Préfixer sans
     * regarder donnait « 1 » + « 14783490262 » — un numéro à douze chiffres,
     * plausible, et qui n'est celui de personne. Onze chiffres commençant par
     * un « 1 » portent donc déjà leur indicatif.
     */
    if (country.dial === '1') {
      const national = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
      return national.length === 10 && /^[2-9]/.test(national) ? '1' + national : null;
    }

    const national =
      country.trunk && digits.startsWith(country.trunk) ? digits.slice(country.trunk.length) : digits;
    number = country.dial + national;
  }

  return /^[1-9]\d{7,14}$/.test(number) ? number : null;
}

/**
 * L'URL WhatsApp Web. `text` est prévu et non branché : un message prérempli
 * viendra sans rien reconstruire, mais pour l'instant on ouvre la conversation,
 * sans rien y écrire à la place de l'agent.
 */
function whatsappLink(number, { text = null } = {}) {
  if (!number) return null;
  const params = new URLSearchParams({ phone: number });
  if (text) params.set('text', text);
  return `https://web.whatsapp.com/send?${params.toString()}`;
}

function renderOrder(ticket, order, orderError) {
  const container = $('c-order');

  /*
   * Le numéro de commande monte dans l'en-tête de la carte, en lien.
   *
   * C'est l'identité du dossier : il se lit en premier et se clique pour aller
   * voir chez Shopify ce que le SAV ne fait pas. Le laisser en première ligne
   * du tableau le noyait parmi la date et le montant.
   */
  const head = $('c-order-link');
  if (head) {
    const link = shopifyOrderLink(order, order?.name ?? ticket.orderName ?? '');
    head.innerHTML = link || (order?.name ? `<code>${esc(order.name)}</code>` : '');
  }

  if (order) {
    // Les états Shopify bruts — PAID, FULFILLED — se lisent en anglais
    // administratif ; traduits en pastilles, ils se voient sans se lire.
    container.innerHTML =
      `<div class="c-order-tags">
        ${statusTag(order.displayFinancialStatus, FINANCIAL_LABELS, ['PENDING', 'PARTIALLY_PAID', 'EXPIRED'])}
        ${statusTag(order.displayFulfillmentStatus, FULFILLMENT_LABELS, ['UNFULFILLED', 'ON_HOLD'])}
      </div>` +
      '<dl>' +
      row('Date', dateTime(order.createdAt)) +
      row('Montant', euro(order.totalPrice, order.currency), true) +
      // Le nombre d'articles : sur un retour, savoir qu'il y en a trois change
      // la question avant même de les lire.
      row('Articles', String(order.lineItems?.length ?? 0), true) +
      '</dl>' +
      '<ul class="items">' +
      order.lineItems
        .map((item) => {
          /*
           * L'API a servi `image` sous deux formes : une chaîne plate, et un
           * objet `{ url }`. Les deux ont existé, et un correctif d'août
           * documente la vignette restée grise parce que le front n'en lisait
           * qu'une. On lit les deux plutôt que de parier.
           */
          const src = typeof item.image === 'string' ? item.image : (item.image?.url ?? null);

          return `<li>${
            src
              ? `<img class="item-img" src="${esc(src)}" alt="" loading="lazy" />`
              : '<span class="item-img item-blank"></span>'
          }<span class="item-name"><b>${esc(item.title)}</b>${
            item.variantTitle ? `<br>${esc(item.variantTitle)}` : ''
          }</span><span class="item-price">${
            /*
             * Le prix de la ligne, remises comprises : c'est lui qu'on
             * rembourse sur un retour partiel. Le total de la commande ne le
             * dit plus dès qu'elle porte deux articles.
             *
             * La quantité prend le relais quand le montant manque — commande
             * ancienne, réponse tronquée. Une case vide laisserait croire à un
             * article gratuit.
             */
            item.price
              ? esc(euro(item.price, order.currency))
              : `${item.quantity} ×`
          }${
            // La quantité reste dite quand elle dépasse un, à côté du prix :
            // « 240,00 € » sur deux paires se lit autrement que sur une.
            item.price && item.quantity > 1 ? `<small>×${item.quantity}</small>` : ''
          }</span></li>`;
        })
        .join('') +
      '</ul>' +
      /*
       * L'adresse de facturation, dans la carte de la commande.
       *
       * Elle appartient au paiement, pas au colis : c'est elle qui figure sur
       * la facture qu'un client redemande, et c'est l'écart entre elle et
       * l'adresse de livraison qui signale une commande à vérifier.
       *
       * Quand les deux se confondent — le cas ordinaire — on l'écrit en une
       * ligne plutôt que de recopier six lignes déjà lues juste au-dessus :
       * c'est la DIFFÉRENCE qui porte l'information, pas la répétition.
       */
      (order.billingAddress
        ? memeAdresse(order.billingAddress, order.shippingAddress)
          ? '<p class="adr-same">Facturation : identique à la livraison.</p>'
          : `<p class="adr-title">Facturation<span class="adr-diff">différente</span></p>` +
            blocAdresse(order.billingAddress)
        : '') +
      shopifyOrderLink(order);
    return;
  }

  if (orderError) {
    container.innerHTML = `<p class="empty">${esc(orderError)}</p>`;
    return;
  }

  // Cas central du produit : l'association n'a pas été tranchée automatiquement,
  // on propose à l'agent de le faire lui-même.
  container.innerHTML = `
    <p class="empty">Aucune commande rattachée — l'association n'était pas certaine.</p>
    <div class="attach">
      <div class="attach-row">
        <input type="text" id="attach-q" placeholder="N° de commande ou nom" />
        <button class="btn" id="attach-search">Chercher</button>
      </div>
      <ul class="candidates" id="attach-results"></ul>
    </div>`;

  $('attach-search').addEventListener('click', () => searchCandidates(ticket.id));
  $('attach-q').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') searchCandidates(ticket.id);
  });

  searchCandidates(ticket.id);
}

async function searchCandidates(ticketId) {
  const list = $('attach-results');
  if (!list) return;

  const query = $('attach-q')?.value.trim() ?? '';
  list.innerHTML = '<li class="empty">Recherche…</li>';

  try {
    const data = await api(
      `/api/tickets/${ticketId}/order-candidates${query ? `?q=${encodeURIComponent(query)}` : ''}`,
    );

    // Une réponse sans liste — Shopify indisponible — affichait l'erreur
    // technique dans le rail au lieu d'un simple « rien trouvé ».
    const candidates = data.orders ?? [];

    if (candidates.length === 0) {
      list.innerHTML = '<li class="empty">Aucune commande trouvée.</li>';
      return;
    }

    list.innerHTML = candidates
      .map(
        (order) => `<li>
          <button class="candidate" data-order="${esc(order.id)}">
            <b>${esc(order.name)}</b>
            <span>${dateTime(order.createdAt)} · ${euro(order.totalPrice, order.currency)}</span>
          </button>
        </li>`,
      )
      .join('');

    list.querySelectorAll('.candidate').forEach((button) => {
      button.addEventListener('click', () => void attachOrder(ticketId, button.dataset.order, button));
    });
  } catch (error) {
    list.innerHTML = `<li class="empty">${esc(error.message)}</li>`;
  }
}

/*
 * Le rattachement fait relire le message par l'IA côté serveur : la réponse
 * proposée réclamait le plus souvent le numéro de commande qu'on vient de
 * fournir, et la garder telle quelle reviendrait à redemander au client ce
 * qu'on sait déjà. L'appel dure donc le temps d'une génération, d'où l'état
 * d'attente sur le bouton plutôt qu'une liste qui semble ne rien faire.
 */
async function attachOrder(ticketId, orderId, button) {
  const candidateLabel = button?.innerHTML;

  if (button) {
    button.disabled = true;
    button.textContent = 'Rattachement, l’IA reprend la réponse…';
  }

  prefetched.delete(ticketId);

  try {
    // `api` peut rendre `null` (204, corps illisible) : sans ce repli, le
    // rattachement réussi finirait en « Cannot read properties of null ».
    const { draft } =
      (await api(`/api/tickets/${ticketId}/order`, {
        method: 'POST',
        body: JSON.stringify({ orderId }),
      })) ?? {};

    /*
     * Le serveur ne reprend pas toujours la réponse : il s'en abstient sur un
     * ticket clos, et il peut échouer sans faire échouer le rattachement. La
     * présence d'une proposition est donc le seul signal fiable — elle dit à
     * la fois quoi annoncer à l'agent, et s'il faut empêcher l'ouverture du
     * ticket de relancer une analyse qui vient d'avoir lieu.
     */
    if (draft) analysed.add(ticketId);

    toast(draft ? 'Commande rattachée, réponse reprise.' : 'Commande rattachée.');
    await selectTicket(ticketId);
    await loadQueue();
    await loadAudit();
  } catch (error) {
    // Le rattachement a pu aboutir malgré l'échec : c'est la reprise de la
    // réponse qui est incertaine, pas lui. On rouvre le ticket pour montrer
    // l'état réel plutôt que de laisser l'agent deviner.
    if (button) {
      button.disabled = false;
      // On rend son nom de commande au bouton : « Réessayer » seul ne dirait
      // plus laquelle des quatre propositions on relance.
      button.innerHTML = candidateLabel;
    }
    await selectTicket(ticketId);
    toast(error.message, true);
  }
}


/*
 * Une adresse postale, rendue comme on l'écrit sur une enveloppe.
 *
 * Pas en lignes de définition : « Ville : Marseille » sur une carte étroite
 * coupe l'adresse en morceaux qu'il faut recomposer mentalement avant de la
 * dicter à un transporteur. Une adresse se lit d'un bloc, et se copie d'un
 * bloc.
 *
 * Les champs vides disparaissent au lieu de laisser des lignes creuses : une
 * commande sans complément d'adresse n'a pas de deuxième ligne.
 */
function blocAdresse(adr) {
  if (!adr) return '';
  const lignes = [
    adr.name,
    adr.address1,
    adr.address2,
    [adr.zip, adr.city].filter(Boolean).join(' '),
    [adr.province, adr.country].filter(Boolean).join(' · '),
  ].filter((l) => l && String(l).trim() !== '');

  if (!lignes.length) return '';
  return `<address class="adr">${lignes.map((l) => esc(l)).join('<br>')}</address>`;
}

/** Deux adresses identiques ne se lisent pas deux fois : c'est l'écart entre
    elles qui porte l'information, pas leur répétition. */
function memeAdresse(a, b) {
  if (!a || !b) return false;
  const cle = (x) =>
    [x.name, x.address1, x.address2, x.zip, x.city, x.province, x.country]
      .map((v) => String(v ?? '').trim().toLowerCase())
      .join('|');
  return cle(a) === cle(b);
}

function renderShipping(order) {
  const container = $('c-ship');
  const fulfillment = order?.fulfillments?.[0];

  void renderParcels(state.detail?.ticket);

  /*
   * L'adresse et le mode d'expédition s'affichent MÊME sans expédition créée.
   *
   * C'est le cas le plus fréquent d'un SAV — « où est ma commande » se pose
   * justement quand rien n'est encore parti — et c'est précisément là qu'on a
   * besoin de relire l'adresse : pour vérifier qu'elle est complète, la
   * corriger avant l'envoi, ou la dicter au fournisseur. La rendre
   * dépendante d'un colis existant la cachait au seul moment où elle sert.
   */
  const entete =
    (order?.shippingMethod
      ? `<dl>${row('Mode', order.shippingMethod)}</dl>`
      : '') + blocAdresse(order?.shippingAddress);

  if (!fulfillment) {
    container.innerHTML = order
      ? entete +
        `<p class="empty">${
          entete ? 'Aucune expédition enregistrée.' : 'Aucune expédition enregistrée pour cette commande.'
        }</p>`
      : '<p class="empty">—</p>';
    return;
  }

  const steps = ['Préparée', 'Expédiée', 'En transit', 'Livrée'];

  /*
   * La frise suit l'état du colis, pas celui de l'expédition.
   *
   * Elle lisait `status`, qui vaut « SUCCESS » dès qu'une expédition est
   * créée : un colis livré depuis huit jours restait affiché « Expédiée »
   * pendant que Shopify, lui, disait « Livré ». `displayStatus` est l'état que
   * le transporteur remonte — c'est celui que le client a sous les yeux.
   */
  const shipState = (fulfillment.displayStatus ?? fulfillment.status ?? '').toUpperCase();
  const reached =
    shipState === 'DELIVERED' || shipState === 'PICKED_UP'
      ? 3
      : shipState === 'OUT_FOR_DELIVERY' || shipState === 'IN_TRANSIT'
        ? 2
        : shipState.includes('DELIVER')
          ? 3
          : shipState.includes('TRANSIT')
            ? 2
            : 1;

  container.innerHTML =
    `<div class="c-order-tags">
      <span class="tag tag-status ${
        reached === 3 ? 'st-CLOSED' : 'st-NEEDS_REVIEW'
      }">${esc(SHIPMENT_LABELS[shipState] ?? 'Expédiée')}</span>
    </div>` +
    entete +
    '<dl>' +
    row('Transporteur', fulfillment.trackingCompany ?? 'non précisé') +
    (fulfillment.trackingNumber
      ? `<div class="row"><span>Suivi</span><button class="linklike mono" data-track="${esc(
          fulfillment.trackingNumber,
        )}">${esc(fulfillment.trackingNumber)}</button></div>`
      : row('Suivi', '—')) +
    // Le statut brut (« SUCCESS ») disait en anglais ce que la frise dessous
    // dit en français : une information, un seul endroit.

    (fulfillment.estimatedDeliveryAt
      ? row('Estimation', fullDate(fulfillment.estimatedDeliveryAt))
      : '') +
    '</dl>' +
    /*
     * Bouton plein format, en plus du numéro cliquable.
     *
     * « Où est mon colis » est la question la plus fréquente d'un SAV : la
     * réponse ne doit pas se mériter en repérant un numéro en petit dans une
     * liste de définitions. Le numéro reste cliquable pour qui l'a déjà sous
     * les yeux ; le bouton sert à celui qui vient de lire le mail.
     */
    (fulfillment.trackingNumber
      ? `<button class="btn btn-small btn-primary ship-go"
           data-track="${esc(fulfillment.trackingNumber)}">Suivre le colis</button>`
      : '') +
    '<div class="track">' +
    steps
      .map(
        (label, index) =>
          `<span class="track-step${index <= reached ? ' done' : ''}">
             <span class="track-bead"></span>${label}
           </span>`,
      )
      .join('') +
    '</div>';
}

/* ------------------------------------------------------------- fournisseur */

const ESCALATION_REASON_LABELS = {
  OUT_OF_STOCK: 'Rupture de stock',
  INCORRECT_ADDRESS: 'Adresse incorrecte ou incomplète',
  MISSING_ITEM: 'Article manquant',
  OTHER: 'Autre',
};

const ESCALATION_STATUS_LABELS = {
  DRAFTING: 'brouillon',
  OPEN: 'en attente du fournisseur',
  ANSWERED: 'fournisseur a répondu',
  RESOLVED: 'résolu',
};

async function loadSupplier() {
  const { suppliers } = await api('/api/suppliers');
  state.suppliers = suppliers;
  renderSupplierSummary();
}

/** Contacts joignables : un contact désactivé ne doit pas être proposé. */
function activeSuppliers() {
  return state.suppliers.filter((supplier) => supplier.active);
}

function renderSupplierSummary() {
  const summary = $('supplier-summary');
  const active = activeSuppliers();

  if (active.length === 0) {
    summary.innerHTML =
      "<p class=\"empty\">Aucun contact actif — les escalades sont indisponibles. Ajoutez-en depuis l'onglet Fournisseurs.</p>";
    return;
  }

  summary.innerHTML = active
    .map(
      (supplier) => `<div class="row">
        <dd>${esc(supplier.name)}${
          supplier.openEscalations
            ? ` <span class="tag tag-status st-NEEDS_REVIEW">${supplier.openEscalations} en cours</span>`
            : ''
        }</dd>
      </div>`,
    )
    .join('');
}

$('supplier-edit-toggle').addEventListener('click', () => setView('suppliers'));

/* --------------------------------------------------------- fournisseurs -- */

/**
 * Le poste de pilotage des ateliers.
 *
 * Une carte par fournisseur, qui répond à la question du matin sans ouvrir
 * une seule fiche : qu'a-t-il à préparer, qu'a-t-il produit, qu'est-ce qui
 * attend chez lui — et son lien atelier à portée de clic. La table qui vivait
 * ici ne montrait que l'email et le téléphone : un carnet d'adresses sur
 * l'écran d'où l'on pilote la production.
 */
/** « 6 h », « 2,5 j » : une durée en heures, lisible d'un coup d'œil. */
function dureeLisible(heures) {
  return heures < 24 ? `${heures} h` : `${(heures / 24).toFixed(1).replace('.', ',')} j`;
}

/*
 * La fiabilité d'un atelier, en lignes, comme dans Réglages.
 *
 * Quatre chiffres sur trente jours, trois sur quatre-vingt-dix, chacun avec
 * son volume. En rouge au-delà d'un seuil qui mérite un coup de fil — deux
 * jours pour répondre, un refus sur trois, une commande sur cinq en retard —
 * mais jamais sous cinq cas : « 100 % de refus » sur une seule demande
 * alarmait pour rien. En dessous, l'écran donne le compte : « 1 sur 1 ».
 */
const ECHANTILLON_MIN = 5;

function lignesAtelier(lignes) {
  return `<div class="foa-lignes">${lignes
    .map(
      ({ nom, valeur, sur = '', chaud = false }) => `<div class="foa-ligne">
        <span>${esc(nom)}</span><span class="foa-sur">${esc(sur)}</span><b${chaud ? ' class="foa-chaud"' : ''}>${esc(valeur)}</b>
      </div>`,
    )
    .join('')}</div>`;
}

function fiabiliteMarkup(f) {
  const q = f?.qualite;
  const pct = (valeur) => (valeur === null || valeur === undefined ? '—' : `${String(valeur).replace('.', ',')} %`);
  const assez = (n) => n >= ECHANTILLON_MIN;
  const repondues = f?.repondues ?? 0;
  const refus = f?.refus ?? 0;
  const retards = f?.retardPct === null || f?.retardPct === undefined ? 0 : Math.round((f.retardPct * f.commandes) / 100);

  const fiabilite =
    !f || (f.demandes === 0 && f.commandes === 0)
      ? '<p class="foa-vide">Pas encore de données sur 30 jours.</p>'
      : lignesAtelier([
          {
            nom: 'Délai de réponse',
            valeur: f.reponseMoyenneH === null ? '—' : dureeLisible(f.reponseMoyenneH),
            sur: f.demandes ? `sur ${pluriel(f.demandes, 'demande')}` : '',
            chaud: assez(repondues) && f.reponseMoyenneH > 48,
          },
          {
            nom: 'Refus',
            valeur: f.refusPct === null ? '—' : assez(repondues) ? `${f.refusPct} %` : `${refus} sur ${repondues}`,
            sur: f.refusPct !== null && assez(repondues) ? `${refus} sur ${repondues}` : '',
            chaud: assez(repondues) && f.refusPct >= 33,
          },
          {
            nom: 'Expédition d’un lot',
            valeur: f.expeditionMoyenneJ === null ? '—' : `${String(f.expeditionMoyenneJ).replace('.', ',')} j`,
          },
          {
            nom: 'Retards',
            valeur: f.retardPct === null ? '—' : assez(f.commandes) ? `${f.retardPct} %` : `${retards} sur ${f.commandes}`,
            sur: f.commandes && assez(f.commandes) ? `sur ${pluriel(f.commandes, 'commande')}` : '',
            chaud: assez(f.commandes) && f.retardPct >= 20,
          },
        ]) +
        (repondues > 0 && !assez(repondues)
          ? '<p class="foa-note">Trop peu de réponses pour en tirer une part : elle s’affichera à partir de cinq.</p>'
          : '');

  /*
   * La qualité, sur 90 jours : un retour arrive des semaines après
   * l'expédition. Le défaut est la part qui revient à l'atelier — une taille
   * qui ne va pas tient au produit, pas à lui.
   */
  const qualite = q?.commandes
    ? lignesAtelier([
        { nom: 'Retours', valeur: pct(q.retoursPct), sur: `sur ${pluriel(q.commandes, 'commande')}` },
        { nom: 'Défauts', valeur: pct(q.defautPct), chaud: assez(q.commandes) && (q.defautPct ?? 0) >= 3 },
        { nom: 'Partis incomplets', valeur: pct(q.manquantsPct), chaud: assez(q.commandes) && (q.manquantsPct ?? 0) >= 2 },
      ])
    : '<p class="foa-vide">Pas encore assez de commandes sur 90 jours.</p>';

  return `<div class="foa-bloc"><p class="foa-t">Fiabilité · 30 jours</p>${fiabilite}</div>
    <div class="foa-bloc"><p class="foa-t">Qualité · 90 jours</p>${qualite}</div>`;
}

function initialesAtelier(nom) {
  return (
    String(nom ?? '')
      .split(/[\s@.\-]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((mot) => mot.charAt(0).toUpperCase())
      .join('') || '?'
  );
}

const CHEVRON_LIGNE =
  '<svg class="fo-chevron" viewBox="0 0 8 13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1.5 1.5l5 5-5 5" /></svg>';

/**
 * Un atelier, sur toute la largeur.
 *
 * En tête : qui il est, ses règles d'attribution et ses quatre gestes. Puis
 * aujourd'hui (à préparer, colis du jour, ce qui attend et de quoi c'est
 * fait, les colis du mois), sa fiabilité et sa qualité. « En attente » se
 * clique : la liste des demandes ne garde que les siennes. Au téléphone, la
 * carte se résume à une ligne et se pousse par-dessus quand on la touche.
 */
function atelierMarkup(supplier, stats) {
  const regles = [
    ...(supplier.isDefault ? ['Atelier par défaut'] : []),
    ...(supplier.vendors ?? []),
    ...(supplier.skuPrefixes ?? []).map((prefix) => `${prefix}*`),
    ...(supplier.joursCommande === 'PAIRS' ? ['Jours pairs'] : supplier.joursCommande === 'IMPAIRS' ? ['Jours impairs'] : []),
  ];

  const demandes = stats.pendingChanges ?? 0;
  const ruptures = stats.ruptures ?? 0;
  const escalades = stats.escalades ?? Math.max(0, (stats.openEscalations ?? 0) - ruptures);
  const attente = demandes + ruptures + escalades;
  const composition = [
    demandes ? pluriel(demandes, 'demande') : '',
    ruptures ? pluriel(ruptures, 'rupture') : '',
    escalades ? pluriel(escalades, 'escalade') : '',
  ]
    .filter(Boolean)
    .join(' · ');
  const joursAttente = stats.oldestPendingAt
    ? Math.floor((Date.now() - new Date(stats.oldestPendingAt).getTime()) / 86400000)
    : 0;

  const chiffre = (valeur, nom, sous = '', classe = '') =>
    `<span class="foa-chiffre${classe}"><b>${esc(valeur)}</b><span>${esc(nom)}</span>${
      sous ? `<small>${esc(sous)}</small>` : ''
    }</span>`;
  const enAttente = `<b>${attente}</b><span>en attente</span>${
    composition ? `<small>${esc(composition)}${joursAttente >= 2 ? ` · ${joursAttente} j` : ''}</small>` : ''
  }`;

  return `<article class="foa${supplier.active ? '' : ' foa-inactif'}${
    state.demandesFiltre?.fournisseur === supplier.id ? ' foa-on' : ''
  }" data-supplier="${esc(supplier.id)}">
    <button type="button" class="foa-resume" data-sup-pousser="${esc(supplier.id)}">
      <span class="foa-avatar" aria-hidden="true">${esc(initialesAtelier(supplier.name))}</span>
      <span class="foa-resume-txt"><b>${esc(supplier.name)}</b><span>${esc(
        `${stats.toPrepare ?? '—'} à préparer · ${stats.parcelsToday ?? 0} colis`,
      )}</span></span>
      ${attente ? `<span class="foa-resume-attente">${attente} en attente</span>` : ''}
      ${CHEVRON_LIGNE}
    </button>

    <div class="foa-tete">
      <span class="foa-avatar foa-avatar-grand" aria-hidden="true">${esc(initialesAtelier(supplier.name))}</span>
      <span class="foa-id">
        <span class="foa-nom"><b>${esc(supplier.name)}</b><span class="foa-actif${supplier.active ? '' : ' foa-actif-non'}"><i></i>${
          supplier.active ? 'Actif' : 'Désactivé'
        }</span></span>
        <span class="foa-contact">${esc(supplier.contactEmail)}${supplier.phone ? ` · ${esc(supplier.phone)}` : ''}</span>
      </span>
      <span class="foa-regles">${
        regles.length
          ? regles.map((regle) => `<span class="foa-regle">${esc(regle)}</span>`).join('')
          : '<span class="foa-regle foa-regle-vide">Aucune règle : cet atelier ne reçoit rien automatiquement</span>'
      }</span>
      <div class="foa-gestes">
        <button type="button" class="fo-bouton" data-sup-open="${esc(supplier.id)}">Ouvrir l’espace</button>
        <button type="button" class="fo-bouton" data-sup-link="${esc(supplier.id)}">Copier le lien</button>
        <button type="button" class="fo-bouton" data-sup-releve="${esc(supplier.id)}">Relevé du mois</button>
        <button type="button" class="fo-bouton" data-sup-edit="${esc(supplier.id)}">Modifier</button>
      </div>
    </div>

    <div class="foa-corps">
      <div class="foa-bloc">
        <p class="foa-t">Aujourd’hui</p>
        <div class="foa-jour">
          ${chiffre(stats.toPrepare ?? '—', 'à préparer')}
          ${chiffre(stats.parcelsToday ?? 0, 'colis aujourd’hui')}
          ${
            demandes
              ? `<button type="button" class="foa-chiffre foa-chiffre-attente" data-sup-attente="${esc(
                  supplier.id,
                )}" title="Voir ses demandes en attente">${enAttente}</button>`
              : `<span class="foa-chiffre${attente ? ' foa-chiffre-attente' : ''}">${enAttente}</span>`
          }
          ${chiffre(stats.parcels30d ?? 0, 'colis sur 30 j', stats.photoRate != null ? `${stats.photoRate} % avec photo` : '')}
        </div>
        <p class="foa-note">${
          stats.lastParcelAt ? `Dernier colis saisi ${esc(relativeTime(stats.lastParcelAt))}.` : 'Aucun colis saisi encore.'
        }</p>
      </div>
      ${fiabiliteMarkup(stats.fiabilite)}
    </div>
  </article>`;
}

function renderSuppliers() {
  const rows = state.suppliers;
  const hub = state.supplierHub ?? {};

  $('suppliers-rows').innerHTML =
    rows.map((supplier) => atelierMarkup(supplier, hub[supplier.id] ?? {})).join('') ||
    '<p class="fo-vide">Aucun atelier. Ajoutez le fournisseur, le transporteur ou l’atelier que vous sollicitez le plus.</p>';

  const active = activeSuppliers().length;
  $('suppliers-count').textContent = rows.length
    ? `${active} actif${active > 1 ? 's' : ''}${rows.length > active ? ` sur ${rows.length}` : ''}`
    : '';

  // La carte poussée au téléphone survit au rafraîchissement du hub.
  if (state.foPile?.mode === 'atelier') marquerAtelierPousse(state.foPile.id);
  renderATraiter();
}

/** Chiffres du hub, chargés après la liste : l'écran paraît, puis se remplit. */
async function loadSupplierHub() {
  try {
    const data = await api('/api/suppliers/hub');
    state.supplierHub = Object.fromEntries(
      (data.suppliers ?? []).map((row) => [row.id, row]),
    );
    if (data.shopifyError) toast(data.shopifyError, true);
  } catch {
    return;
  }
  if (state.view === 'suppliers') renderSuppliers();
}

/** « Nike, Adidas ,, » → ['Nike', 'Adidas']. Les vides sont écartés. */
function splitList(value) {
  return String(value ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

/* Le lien de l'espace fournisseur, copié ou ouvert : émis à la demande, jamais stocké. */
async function lienEspaceFournisseur(button) {
  const id = button.dataset.supLink ?? button.dataset.supOpen;
  try {
    const { url } = await api(`/api/suppliers/${id}/portal-link`, { method: 'POST' });
    if (button.dataset.supOpen) {
      window.open(url, '_blank', 'noopener');
      return;
    }
    await navigator.clipboard.writeText(url);
    toast('Lien de l’espace fournisseur copié — transmettez-le au fournisseur.');
    button.textContent = 'Lien copié';
    setTimeout(() => {
      if (button.isConnected) button.textContent = 'Copier le lien';
    }, 2500);
  } catch (error) {
    toast(error.message, true);
  }
}

/**
 * Ce que les ateliers ont renvoyé : le chiffre de la pastille.
 *
 * Un chiffre dans la navigation dit qu'il y a quelque chose ; la liste « À
 * traiter » dit quoi, et chaque ligne porte son geste. Le chiffre et la liste
 * sortent des mêmes comptes : une pastille qui annonce ce que la page ne
 * montre pas devient une alarme qu'on apprend à ignorer.
 */
async function renderSupplierActivity() {
  try {
    const activity = await api('/api/supplier-activity');
    state.supplierActivity = activity;
    state.navCounts = { ...state.navCounts, suppliers: activity.total };
    renderNav();
  } catch {
    // Le reste de la page reste utilisable sans ce compte.
  }
  renderATraiter();
}

/*
 * Les signalements des ateliers : une adresse incomplète, un téléphone faux,
 * un article abîmé. Ils entraient dans SAV client titrés « Autre », au milieu
 * du courrier des clients ; ils ont leur ligne dans « À traiter », avec les
 * deux gestes : ouvrir la conversation, ou la classer — l'atelier la voit
 * alors « Clos » dans son espace.
 */
const MOTIF_ICONE = { ADDRESS: 'pin', PHONE: 'alerte', DAMAGE: 'box', STOCK: 'box', OTHER: 'alerte' };

async function renderSignalementsFournisseurs() {
  try {
    const { signalements } = await api('/api/supplier-signalements');
    state.signalementsFournisseurs = signalements;
  } catch {
    // La page reste utilisable sans ces lignes.
    return;
  }
  renderATraiter();
}

/** Une ligne de « À traiter » : son pictogramme, ce qui s'est passé, ses gestes. */
function ligneATraiter({ ton, icone, titre, sous, gestes }) {
  return `<div class="fot" role="listitem">
    <span class="fot-ico fot-${ton}" aria-hidden="true">${icone}</span>
    <span class="fot-txt"><b>${esc(titre)}</b><span>${esc(sous)}</span></span>
    <span class="fot-gestes">${gestes}</span>
  </div>`;
}

function renderATraiter() {
  const box = $('fo-traiter');
  if (!box) return;
  const lignes = [];

  // Les réponses des ateliers dont le client n'a pas encore été prévenu.
  for (const change of (state.changesRows ?? []).filter(aPrevenir)) {
    const d = lireDemande(change);
    lignes.push(
      ligneATraiter({
        ton: change.status === 'REFUSED' ? 'refusee' : 'faite',
        icone: traitDemande(change.kind),
        titre: `${d.client} : ${d.nature.toLowerCase()}${d.valeur ? ` ${d.valeur}` : ''}${
          d.avant ? ` au lieu de ${d.avant}` : ''
        }, ${change.status === 'REFUSED' ? 'refusée' : 'faite'} par l’atelier`,
        sous: [
          change.orderName,
          `${change.supplier?.name ?? 'L’atelier'}, ${quandLong(change.acknowledgedAt ?? change.createdAt)}${
            change.supplierNote ? ` : « ${change.supplierNote} »` : ''
          }`,
        ]
          .filter(Boolean)
          .join(' · '),
        gestes: `<button type="button" class="fo-bouton" data-traiter-voir="${esc(change.id)}">Voir la demande</button>
          <button type="button" class="btn btn-primary btn-small" data-dem-prevenu="${esc(change.id)}">Client prévenu</button>`,
      }),
    );
  }

  for (const sig of state.signalementsFournisseurs ?? []) {
    const jours = ageInDays(sig.createdAt);
    lignes.push(
      ligneATraiter({
        ton: 'signalement',
        icone: ico(MOTIF_ICONE[sig.motif] ?? 'alerte'),
        titre: `${sig.libelle}, signalé par ${sig.fournisseur ?? 'l’atelier'}`,
        sous: [sig.orderName, sig.note ? `« ${sig.note} »` : '', jours <= 0 ? 'aujourd’hui' : `depuis ${pluriel(jours, 'jour')}`]
          .filter(Boolean)
          .join(' · '),
        gestes: `<button type="button" class="fo-bouton" data-sig-done="${esc(sig.id)}">Classer</button>
          <button type="button" class="btn btn-primary btn-small" data-sig-open="${esc(sig.id)}">Ouvrir</button>`,
      }),
    );
  }

  const activite = state.supplierActivity;
  if (activite?.answered) {
    lignes.push(
      ligneATraiter({
        ton: 'faite',
        icone: ico('bubble'),
        titre: `${pluriel(activite.answered, 'réponse')} d’atelier à reprendre`,
        sous: 'Des escalades auxquelles l’atelier a répondu, dans SAV client',
        gestes: '<button type="button" class="btn btn-primary btn-small" data-goto="tickets">Ouvrir SAV client</button>',
      }),
    );
  }
  const aFaire = lignes.length;

  // Les ruptures : une ligne d'information. Elles ont leur écran et leur
  // pastille ; la page dit seulement où elles en sont.
  if (activite?.ruptures) {
    const parAtelier = (state.suppliers ?? [])
      .map((supplier) => [supplier.name, state.supplierHub?.[supplier.id]?.ruptures ?? 0])
      .filter(([, n]) => n > 0)
      .map(([nom, n]) => `${nom} ${n}`)
      .join(', ');
    lignes.push(
      ligneATraiter({
        ton: 'info',
        icone: ico('box'),
        titre: `${pluriel(activite.ruptures, 'rupture')} en cours`,
        sous: [parAtelier, 'les articles indisponibles se traitent dans Ruptures de stock'].filter(Boolean).join(' · '),
        gestes: '<button type="button" class="fo-bouton" data-goto="ruptures">Ruptures de stock</button>',
      }),
    );
  }

  box.hidden = lignes.length === 0;
  $('fo-traiter-n').textContent = aFaire ? String(aFaire) : '';
  $('fo-traiter-rows').innerHTML = lignes.join('');
}

async function classerSignalement(bouton) {
  bouton.disabled = true;
  try {
    await api(`/api/tickets/${bouton.dataset.sigDone}/resolve`, { method: 'POST', body: '{}' });
    toast('Signalement classé — l’atelier le voit comme repris.');
    changesCountAt = 0;
    void refreshChangesCount();
    await Promise.all([renderSignalementsFournisseurs(), renderSupplierActivity()]);
  } catch (error) {
    bouton.disabled = false;
    toast(error.message, true);
  }
}

/* ------------------------------------------- l'atelier poussé, au téléphone */

const PILE_ATELIER = window.matchMedia('(max-width: 760px)');
let defilementFournisseurs = 0;

function marquerAtelierPousse(id) {
  document.querySelectorAll('#suppliers-rows .foa').forEach((carte) => {
    carte.classList.toggle('foa-pousse', carte.dataset.supplier === id);
  });
}

/**
 * Au téléphone, un atelier ou une demande se pousse par-dessus la page, comme
 * dans Réglages : le reste se cache, « Fournisseurs » en haut à gauche ou un
 * glissé vers la droite ramène la liste, et le bouton Retour du téléphone
 * aussi.
 */
function ouvrirPileFo(mode, id) {
  const vue = $('view-suppliers');
  if (!vue) return;
  const pile = mode === 'atelier' ? PILE_ATELIER : PILE_TICKETS;
  if (!pile.matches) return;
  if (!state.foPile) {
    defilementFournisseurs = scrollY;
    history.pushState({ csavFournisseur: true }, '');
  }
  state.foPile = { mode, id };
  vue.classList.add('fo-pile');
  vue.classList.toggle('fo-pile-atelier', mode === 'atelier');
  vue.classList.toggle('fo-pile-fiche', mode === 'fiche');
  if (mode === 'atelier') marquerAtelierPousse(id);
  requestAnimationFrame(() => scrollTo(0, 0));
}

function fermerPileFo({ parHistorique = false } = {}) {
  const vue = $('view-suppliers');
  if (!state.foPile || !vue) return;
  state.foPile = null;
  vue.classList.remove('fo-pile', 'fo-pile-atelier', 'fo-pile-fiche');
  marquerAtelierPousse(null);
  if (!parHistorique && history.state?.csavFournisseur) history.back();
  requestAnimationFrame(() => scrollTo(0, defilementFournisseurs));
}

addEventListener('popstate', () => fermerPileFo({ parHistorique: true }));

/* --------------------------------------------- un seul écouteur, la page -- */

$('view-suppliers').addEventListener('click', async (event) => {
  const sur = (selecteur) => event.target.closest(selecteur);
  let cible;

  if (gererClicDemande(event, 'suppliers')) return;
  if ((cible = sur('#fo-retour'))) return fermerPileFo();
  if ((cible = sur('[data-sup-edit]'))) return openSupplierForm(cible.dataset.supEdit);
  if ((cible = sur('[data-sup-link], [data-sup-open]'))) return void lienEspaceFournisseur(cible);
  if ((cible = sur('[data-sup-releve]'))) return void ouvrirReleve(cible.dataset.supReleve);
  if ((cible = sur('[data-sup-pousser]'))) return ouvrirPileFo('atelier', cible.dataset.supPousser);

  // « En attente » d'un atelier : ses demandes, juste en dessous.
  if ((cible = sur('[data-sup-attente]'))) {
    state.demandesFiltre = { ...state.demandesFiltre, fournisseur: cible.dataset.supAttente, type: '', statut: 'PENDING' };
    state.demandeChoisie.suppliers = null;
    if (state.foPile) fermerPileFo();
    renderSuppliers();
    renderDemandesFournisseur();
    $('sup-dem-h').scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }

  // « Voir la demande » depuis « À traiter » : la demande, ouverte.
  if ((cible = sur('[data-traiter-voir]'))) {
    state.demandesFiltre = { fournisseur: null, type: '', statut: 'PREVENIR' };
    state.demandeChoisie.suppliers = cible.dataset.traiterVoir;
    renderSuppliers();
    renderDemandesFournisseur();
    if (PILE_TICKETS.matches) ouvrirPileFo('fiche', cible.dataset.traiterVoir);
    else $('sup-dem-h').scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }

  if ((cible = sur('[data-sig-open]'))) {
    setView('tickets');
    void selectTicket(cible.dataset.sigOpen);
    return;
  }
  if ((cible = sur('[data-sig-done]'))) return void classerSignalement(cible);
  if ((cible = sur('[data-goto]'))) return setView(cible.dataset.goto);

  if ((cible = sur('#sup-dem-qui'))) {
    state.demandesFiltre = { ...state.demandesFiltre, fournisseur: null };
    renderSuppliers();
    renderDemandesFournisseur();
    return;
  }
  if ((cible = sur('[data-dstatut]'))) {
    state.demandesFiltre = { ...state.demandesFiltre, statut: cible.dataset.dstatut };
    state.demandeChoisie.suppliers = null;
    renderDemandesFournisseur();
    return;
  }
  if ((cible = sur('#sup-dem-type-btn'))) {
    event.stopPropagation();
    basculerMenuTypes();
    return;
  }
  if ((cible = sur('[data-dtype]'))) {
    state.demandesFiltre = { ...state.demandesFiltre, type: cible.dataset.dtype };
    state.demandeChoisie.suppliers = null;
    basculerMenuTypes(false);
    renderDemandesFournisseur();
    $('sup-dem-type-btn').focus();
  }
});

/** `id` absent : création. Sinon édition, avec la suppression proposée. */
function openSupplierForm(id) {
  const supplier = id ? state.suppliers.find((candidate) => candidate.id === id) : null;
  state.editingSupplier = supplier?.id ?? null;

  $('supmodal-title').textContent = supplier ? supplier.name : 'Nouveau contact';
  $('sup-f-name').value = supplier?.name ?? '';
  $('sup-f-email').value = supplier?.contactEmail ?? '';
  $('sup-f-contact').value = supplier?.contactName ?? '';
  $('sup-f-phone').value = supplier?.phone ?? '';
  $('sup-f-langue').value = supplier?.langue ?? 'fr';
  $('sup-f-notes').value = supplier?.notes ?? '';
  $('sup-f-active').checked = supplier ? supplier.active : true;

  // La suppression n'a de sens que sur un contact sans historique ; le serveur
  // tranche, on se contente de ne pas la proposer à la création.
  $('sup-f-delete').hidden = !supplier;

  // Le lien n'existe que pour un fournisseur déjà enregistré : il porte son
  // identifiant.
  $('sup-f-access').value = supplier?.ordersAccess ?? 'ASSIGNED';
  $('sup-f-vendors').value = (supplier?.vendors ?? []).join(', ');
  $('sup-f-skus').value = (supplier?.skuPrefixes ?? []).join(', ');
  $('sup-f-default').checked = supplier?.isDefault ?? false;
  $('sup-f-jours').value = supplier?.joursCommande ?? 'TOUS';
  describeSupplierAccess();
  $('sup-f-link').hidden = !supplier;
  $('sup-f-link').dataset.supplier = supplier?.id ?? '';
  // Alerter un contact qui n'existe pas encore n'a pas de sens.
  $('sup-f-alert').hidden = !supplier || !supplier.active;

  $('supplier-modal').classList.add('open');
}

/* ------------------------------------------------- alerte urgente ------- */

/**
 * Alerte urgente vers un fournisseur.
 *
 * Son canal normal est l'atelier, qu'il ouvre le matin : parfait pour le
 * travail du jour, inutile pour « n'expédie pas cette commande ». L'alerte
 * part par mail — donc sur son téléphone — et reste affichée en rouge en tête
 * de son atelier tant qu'il n'a pas cliqué « J'ai vu ».
 */
function openAlertModal(id) {
  const supplier = state.suppliers.find((candidate) => candidate.id === id);
  if (!supplier) return;

  $('alert-modal').dataset.supplier = id;
  $('alert-modal').dataset.ticket = '';
  $('alert-modal').dataset.order = '';
  $('alert-who').textContent = `${supplier.name} · ${supplier.contactEmail}`;
  state.alertCtx = null;
  setAlertKind('HOLD');
  $('alert-order').value = '';
  $('alert-message').value = '';
  renderAlertSuppliers();
  $('alert-modal').hidden = false;
  $('alert-modal').classList.add('open');
  $('alert-message').focus();
}

function closeAlertModal() {
  $('alert-modal').classList.remove('open');
  $('alert-modal').hidden = true;
  // Le mode correction ne doit pas survivre à la fermeture : la prochaine
  // ouverture serait une création qui réécrirait l'ancienne demande.
  delete $('alert-modal').dataset.editing;
  delete $('alert-modal').dataset.motifs;
  $('alert-modal').querySelector('.modal-head h2').textContent = 'Contacter le fournisseur';
}


/*
 * Nature de la demande, en boutons.
 *
 * Le avant → après ne vaut que pour un changement de valeur : sur « ne pas
 * expédier » ou « annulation », il n'y a rien à écrire dedans — on le masque
 * au lieu de laisser deux champs vides interroger.
 */
const KINDS_WITH_SWAP = new Set(['SIZE', 'COLOR', 'PRODUCT', 'ADDRESS', 'PHONE']);

/**
 * Les demandes qui partent par mail sur-le-champ — copie de
 * `src/services/suppliers/urgence.ts`, comparée par les tests. Les autres
 * attendent le récapitulatif de 9 h chez l'atelier : sans mail tout de
 * suite, elles ne sont pas « en échec ».
 */
const KINDS_URGENTS = new Set(['HOLD', 'CANCEL', 'ADDRESS', 'PHONE', 'SIZE', 'COLOR', 'PRODUCT']);

/*
 * Valeurs actuelles de la commande, par nature de changement.
 *
 * Choisir « Couleur » en gardant « 47.5 » dans le champ « avant » n'a aucun
 * sens : chaque nature doit préremplir avec SA valeur actuelle. Le contexte
 * est construit à l'ouverture depuis la commande, et le changement de nature
 * rebascule les deux champs.
 *
 * La déclinaison Shopify arrive souvent en un seul libellé — « Blackened
 * Blue / 45 1/3 » : `repartirDeclinaison` sépare la pointure de la couleur.
 * Un champ prérempli faux se corrige d'un regard là où un champ vide se
 * ressaisit à chaque fois.
 */
const ALERT_HINTS = {
  SIZE: { before: '42.5', after: '45' },
  COLOR: { before: 'Blackened Blue', after: 'Black Hyper Crimson' },
  PRODUCT: { before: 'Nike Mind 001', after: 'Nike Vomero Plus' },
  ADDRESS: { before: 'Adresse actuelle', after: 'Nouvelle adresse complète' },
  PHONE: { before: '06 12 34 56 78', after: 'Nouveau numéro' },
};

state.alertCtx = null;

/*
 * Couleur et taille d'une déclinaison Shopify.
 *
 * Les options sont jointes par une barre oblique ENTOURÉE d'espaces : celle de
 * « 45 1/3 » n'en est pas une. Découper sur chaque barre donnait « Taille :
 * 45 1 » et « Couleur : 3 ». Même règle que l'atelier (workspace.js) et le
 * serveur (services/shopify/declinaison.ts) — un test les compare.
 */
function ressembleAUneTaille(valeur) {
  return /^\d{1,2}([.,]\d)?(\s+\d\/\d)?$/.test((valeur ?? '').trim());
}

function repartirDeclinaison(variante) {
  const texte = (variante ?? '').trim();
  if (!texte) return { couleur: '', taille: '' };

  const morceaux = texte.split(/\s+\/\s+/).map((morceau) => morceau.trim()).filter(Boolean);
  const taille = morceaux.find(ressembleAUneTaille);
  if (!taille) return { couleur: texte, taille: '' };

  return { couleur: morceaux.filter((morceau) => morceau !== taille).join(' / '), taille };
}

function alertContextFromOrder(order) {
  if (!order) return null;

  const item = order.lineItems?.[0];
  const address = order.shippingAddress ?? {};

  const { couleur: color, taille: size } = repartirDeclinaison(item?.variantTitle);

  return {
    SIZE: size,
    COLOR: color,
    PRODUCT: item?.title ?? '',
    ADDRESS: [
      address.address1,
      address.address2,
      `${address.zip ?? ''} ${address.city ?? ''}`.trim(),
      address.country,
    ]
      .filter(Boolean)
      .join(', '),
    PHONE: address.phone ?? '',
    MISSING_ITEM: item ? [item.title, item.variantTitle].filter(Boolean).join(' · ') : '',
  };
}

/*
 * Les motifs à une seule valeur : rien n'est « remplacé », on désigne.
 *
 * L'article manquant se range dans `beforeValue` (ce qui était attendu), la
 * date d'expédition dans `afterValue` (ce qu'on demande) : l'atelier et le
 * mail les lisent ainsi, sans champ de plus en base.
 */
const KINDS_SINGLE = {
  MISSING_ITEM: { label: 'Article manquant', champ: 'before', type: 'text', exemple: 'Chaussette Hyper Crimson · 42' },
  DELAY: { label: 'À expédier au plus tard le', champ: 'after', type: 'date', exemple: '' },
};

function setAlertKind(kind) {
  closeVariantPicker();

  // Une rupture n'est pas une demande de changement : c'est un dossier, avec
  // ses modèles de remplacement. On passe à la fenêtre qui les propose.
  if (kind === 'RUPTURE') return void ouvrirRuptureDepuisFenetre();

  $('alert-kind').value = kind;
  document.querySelectorAll('#alert-kinds [data-kind]').forEach((button) =>
    button.setAttribute('aria-pressed', String(button.dataset.kind === kind)),
  );

  // Pas de rupture sans message client, ni pendant la correction d'une
  // demande existante : elle ne changera pas de nature.
  $('alert-kind-rupture').hidden =
    !$('alert-modal').dataset.ticket || Boolean($('alert-modal').dataset.editing);

  // « Modification » : trois motifs seulement — Taille, Modèle, Coordonnées.
  const permis = ($('alert-modal').dataset.motifs ?? '').split(',').filter(Boolean);
  if (permis.length) {
    document.querySelectorAll('#alert-kinds [data-kind]').forEach((bouton) => {
      bouton.hidden = !permis.includes(bouton.dataset.kind);
      if (bouton.dataset.kind === 'ADDRESS') bouton.textContent = 'Coordonnées';
    });
  } else {
    document.querySelectorAll('#alert-kinds [data-kind]').forEach((bouton) => {
      if (bouton.id !== 'alert-kind-rupture') bouton.hidden = false;
      if (bouton.dataset.kind === 'ADDRESS') bouton.textContent = 'Adresse';
    });
  }

  // Dit avant l'envoi ce qui partira, et quand : sans ça, « pas de mail »
  // se lirait comme une panne.
  $('alert-envoi').textContent = KINDS_URGENTS.has(kind)
    ? 'Urgent : un mail court part tout de suite, et la demande s’affiche dans son espace fournisseur, rubrique Tickets, où il répond d’un bouton.'
    : 'La demande s’affiche tout de suite dans son espace fournisseur, rubrique Tickets, où il répond d’un bouton. Par mail, elle part dans son récapitulatif de 9 h (heure de Chine).';

  const single = KINDS_SINGLE[kind];
  $('alert-single-field').hidden = !single;
  if (single) {
    $('alert-single-label').textContent = single.label;
    $('alert-single').type = single.type;
    $('alert-single').placeholder = single.exemple;
    $('alert-single').value = kind === 'MISSING_ITEM' ? (state.alertCtx?.MISSING_ITEM ?? '') : '';
  }

  const swap = KINDS_WITH_SWAP.has(kind);
  $('alert-swap-field').hidden = !swap;
  if (!swap) return;

  $('alert-before').value = state.alertCtx?.[kind] ?? '';
  $('alert-after').value = '';
  $('alert-before').placeholder = ALERT_HINTS[kind]?.before ?? '';
  $('alert-after').placeholder = ALERT_HINTS[kind]?.after ?? '';

  // Une adresse ne tient pas centrée en gros caractères : les champs passent
  // en lecture longue le temps de cette nature.
  document
    .querySelector('#alert-swap-field .swap-row')
    ?.classList.toggle('swap-long', kind === 'ADDRESS');
}

document.querySelectorAll('#alert-kinds [data-kind]').forEach((button) =>
  button.addEventListener('click', () => setAlertKind(button.dataset.kind)),
);


/* ------------------------------------------- choisir plutôt que saisir ---- */

/**
 * Liste déroulante des déclinaisons du catalogue, sous un champ du
 * « avant → après ».
 *
 * Écrire « Blackened Blue » de mémoire, c'est l'écrire faux une fois sur
 * trois — et l'atelier lira ce qu'on lui a écrit. Le champ reste libre (un
 * fournisseur peut avoir une référence qu'on n'a pas), mais le catalogue est
 * à un clic, avec sa recherche et son stock.
 *
 * La liste se cherche sur le modèle de la commande quand on le connaît : la
 * question n'est pas « quelles tailles existent » mais « quelles tailles
 * existent pour CETTE paire ».
 */
let pickerTimer = null;

function closeVariantPicker() {
  document.querySelectorAll('.pickbox').forEach((box) => box.remove());
}

async function fillVariantPicker(box, input, scope) {
  const term = input.value.trim();
  const product = scope === 'PRODUCT' ? '' : (state.alertCtx?.PRODUCT ?? '');

  box.innerHTML = '<div class="pick-empty">Recherche…</div>';

  let options = [];
  try {
    const params = new URLSearchParams({ scope });
    if (term) params.set('q', term);
    if (product) params.set('product', product);
    ({ options } = await api(`/api/variant-options?${params}`));
  } catch (error) {
    box.innerHTML = `<div class="pick-empty">${esc(error.message)}</div>`;
    return;
  }

  if (options.length === 0) {
    box.innerHTML = `<div class="pick-empty">${
      scope === 'PRODUCT'
        ? 'Aucun produit trouvé.'
        : 'Aucune déclinaison trouvée pour ce modèle.'
    }</div>`;
    return;
  }

  box.innerHTML = options
    .map(
      (option) => `<button type="button" class="pick-item" data-value="${esc(option.value)}">
        ${
          option.image
            ? `<img src="${esc(option.image)}" alt="" loading="lazy" />`
            : '<span class="pick-noimg" aria-hidden="true"></span>'
        }
        <span class="pick-text">
          <b>${esc(option.value)}</b>
          ${option.detail ? `<small>${esc(option.detail)}</small>` : ''}
        </span>
        ${
          /*
           * La pastille n'apparaît que sur un stock réellement positif.
           *
           * Un `0` ne veut pas dire « épuisé » : sur une boutique qui ne suit
           * pas ses stocks — le cas du dropshipping — Shopify renvoie zéro
           * pour tout le catalogue. Afficher « épuisé » partout ferait refuser
           * des échanges parfaitement possibles, ce qui est plus grave que de
           * ne rien afficher.
           */
          option.stock > 0
            ? `<span class="pick-stock">${option.stock} en stock</span>`
            : ''
        }
      </button>`,
    )
    .join('');

  box.querySelectorAll('.pick-item').forEach((item) =>
    item.addEventListener('mousedown', (event) => {
      // `mousedown` et non `click` : le champ perd le focus avant le clic, et
      // la liste se refermerait sous le doigt.
      event.preventDefault();
      input.value = item.dataset.value;
      closeVariantPicker();
    }),
  );
}

function openVariantPicker(input) {
  const kind = $('alert-kind').value;
  const scope = kind === 'PRODUCT' ? 'PRODUCT' : kind === 'COLOR' ? 'COLOR' : 'SIZE';

  // Adresse et téléphone n'ont pas de catalogue : rien à proposer.
  if (!['SIZE', 'COLOR', 'PRODUCT'].includes(kind)) return;

  closeVariantPicker();

  const box = document.createElement('div');
  box.className = 'pickbox';
  input.parentElement.append(box);
  void fillVariantPicker(box, input, scope);
}

for (const id of ['alert-before', 'alert-after']) {
  const input = $(id);
  if (!input) continue;

  input.addEventListener('focus', () => openVariantPicker(input));

  input.addEventListener('input', () => {
    const box = input.parentElement.querySelector('.pickbox');
    if (!box) return openVariantPicker(input);

    clearTimeout(pickerTimer);
    // Une requête par lettre serait une requête Shopify par lettre : on
    // attend la pause de frappe, comme partout ailleurs.
    pickerTimer = setTimeout(() => {
      const kind = $('alert-kind').value;
      void fillVariantPicker(box, input, kind === 'PRODUCT' ? 'PRODUCT' : kind === 'COLOR' ? 'COLOR' : 'SIZE');
    }, 250);
  });

  input.addEventListener('blur', () => setTimeout(closeVariantPicker, 120));
}

$('sup-f-alert')?.addEventListener('click', () => {
  const id = $('sup-f-link').dataset.supplier;
  $('supplier-modal').classList.remove('open');
  openAlertModal(id);
});

$('alert-cancel')?.addEventListener('click', closeAlertModal);
$('alert-modal')?.addEventListener('click', (event) => {
  if (event.target === $('alert-modal')) closeAlertModal();
});

$('alert-send')?.addEventListener('click', async () => {
  const message = $('alert-message').value.trim();
  const kind = $('alert-kind').value;
  const single = KINDS_SINGLE[kind];
  const valeur = single ? $('alert-single').value.trim() : '';
  const before = single ? (single.champ === 'before' ? valeur : '') : $('alert-before').value.trim();
  const after = single ? (single.champ === 'after' ? valeur : '') : $('alert-after').value.trim();

  if (single && !valeur) {
    toast(`Indiquez : ${single.label.toLowerCase()}.`, true);
    return;
  }

  // L'un ou l'autre suffit : « ne pas expédier » n'a pas de valeur « après »,
  // et « 44 → 45 » n'a pas besoin de phrase.
  if (!single && !after && message.length < 3) {
    toast('Indiquez la nouvelle valeur, ou écrivez une précision.', true);
    return;
  }

  const supplierId = $('alert-supplier').value || $('alert-modal').dataset.supplier;
  if (!supplierId) {
    toast('Choisissez le fournisseur destinataire.', true);
    return;
  }

  const button = $('alert-send');
  button.disabled = true;

  try {
    // Le même formulaire crée et corrige : en mode correction, la demande
    // existante est réécrite sur place — l'atelier voit la version corrigée,
    // sans second mail ni carte en double.
    const editing = $('alert-modal').dataset.editing;
    const result = editing
      ? await api(`/api/changes/${editing}`, {
          method: 'PATCH',
          body: JSON.stringify({
            kind,
            message,
            beforeValue: before || null,
            afterValue: after || null,
            orderName: $('alert-order').value.trim() || null,
          }),
        })
      : await api(`/api/suppliers/${supplierId}/alert`, {
          method: 'POST',
          body: JSON.stringify({
            kind,
            message,
            beforeValue: before || null,
            afterValue: after || null,
            orderName: $('alert-order').value.trim() || null,
            shopifyOrderId: $('alert-modal').dataset.order || null,
            ticketId: $('alert-modal').dataset.ticket || null,
          }),
        });

    closeAlertModal();
    // On distingue les deux : une alerte enregistrée mais non envoyée reste
    // utile, à condition de ne pas croire que le fournisseur l'a reçue.
    toast(
      result.updated
        ? result.emailed
          ? 'Demande corrigée et devenue urgente — partie par mail.'
          : 'Demande corrigée — l’atelier voit la nouvelle version.'
        : result.emailed
          ? 'Demande envoyée par mail et affichée dans son espace fournisseur.'
          : result.differe
            ? 'Demande affichée dans son espace fournisseur — elle partira dans son récapitulatif de 9 h (heure de Chine).'
            : 'Demande affichée dans son espace fournisseur — le mail n’a pas pu partir.',
      !result.updated && !result.emailed && !result.differe,
    );

    // L'écran d'où l'on vient se rafraîchit : le mail pour montrer la
    // demande en attente, l'écran Update pour montrer la nouvelle ligne.
    if (state.view === 'changes') {
      changesCountAt = 0;
      await loadChanges();
    } else if (state.view === 'suppliers') {
      changesCountAt = 0;
      await chargerDemandesFournisseur();
    } else if (state.currentId) {
      prefetched.delete(state.currentId);
      await selectTicket(state.currentId);
    }
  } catch (error) {
    toast(error.message, true);
  } finally {
    button.disabled = false;
  }
});

$('sup-f-link').addEventListener('click', async (event) => {
  const id = event.currentTarget.dataset.supplier;
  if (!id) return;

  // Maj + clic révoque : geste volontairement peu accessible, l'opération est
  // irréversible pour les liens déjà transmis.
  await openSupplierLink(id, event.shiftKey);
});

/*
 * « Tout le carnet » communique des noms, adresses et téléphones de clients à
 * un tiers : le choix doit être éclairé au moment où on le fait, pas découvert
 * après coup.
 */
const SUPPLIER_ACCESS_HELP = {
  ASSIGNED:
    'Seules les commandes escaladées vers lui ou dont il a saisi un colis. Recommandé.',
  ALL:
    'Il verra tous vos clients — noms, adresses, téléphones — y compris ceux qu’il ne prépare pas. À réserver au prestataire qui expédie réellement tout.',
  NONE: 'Il ne peut que répondre aux escalades. Aucun accès aux commandes.',
};

function describeSupplierAccess() {
  $('sup-f-access-help').textContent = SUPPLIER_ACCESS_HELP[$('sup-f-access').value] ?? '';
  $('sup-f-access-help').classList.toggle('set-alert', $('sup-f-access').value === 'ALL');
}

$('sup-f-access').addEventListener('change', describeSupplierAccess);

$('sup-new').addEventListener('click', () => openSupplierForm(null));
$('sup-f-cancel').addEventListener('click', () => $('supplier-modal').classList.remove('open'));
$('supplier-modal').addEventListener('click', (event) => {
  if (event.target === $('supplier-modal')) $('supplier-modal').classList.remove('open');
});

$('sup-f-save').addEventListener('click', async () => {
  const payload = {
    name: $('sup-f-name').value.trim(),
    contactEmail: $('sup-f-email').value.trim(),
    ordersAccess: $('sup-f-access').value,
    contactName: $('sup-f-contact').value.trim() || null,
    phone: $('sup-f-phone').value.trim() || null,
    langue: $('sup-f-langue').value,
    notes: $('sup-f-notes').value.trim() || null,
    active: $('sup-f-active').checked,
    // Saisi en une ligne, stocké en liste : demander un champ par marque
    // ferait renoncer dès la troisième.
    vendors: splitList($('sup-f-vendors').value),
    skuPrefixes: splitList($('sup-f-skus').value),
    isDefault: $('sup-f-default').checked,
    joursCommande: $('sup-f-jours').value,
  };

  if (!payload.name || !payload.contactEmail) {
    toast("Le nom et l'email sont requis.", true);
    return;
  }

  try {
    const id = state.editingSupplier;
    await api(id ? `/api/suppliers/${id}` : '/api/suppliers', {
      method: id ? 'PATCH' : 'POST',
      body: JSON.stringify(payload),
    });

    $('supplier-modal').classList.remove('open');
    toast(id ? 'Contact mis à jour.' : 'Contact ajouté.');
    await Promise.all([loadSupplier(), loadAudit()]);
    renderSuppliers();
  } catch (error) {
    toast(error.message, true);
  }
});

$('sup-f-delete').addEventListener('click', async () => {
  const id = state.editingSupplier;
  if (!id) return;
  if (!await confirmer('Supprimer ce contact ?\n\nIl disparaît définitivement de la liste des fournisseurs.', { action: 'Supprimer', danger: true, icone: 'corbeille' })) return;

  try {
    await api(`/api/suppliers/${id}`, { method: 'DELETE' });
    $('supplier-modal').classList.remove('open');
    toast('Contact supprimé.');
    await Promise.all([loadSupplier(), loadAudit()]);
    renderSuppliers();
  } catch (error) {
    // Le refus le plus fréquent — un contact avec de l'historique — arrive ici
    // avec sa propre explication.
    toast(error.message, true);
  }
});

/* --------------------------------------------------------------- équipe -- */

const ROLE_LABELS = {
  OWNER: 'Propriétaire',
  SUPERVISOR: 'Superviseur',
  AGENT: 'Agent',
  VIEWER: 'Lecture seule',
};

/* Ce que chaque rôle peut faire, en une ligne. Affiché dans le tableau : un
   nom de rôle seul ne dit rien à qui n'a pas lu la documentation. */
const ROLE_ABILITIES = {
  OWNER: 'Tout, y compris l’équipe et les réglages',
  SUPERVISOR: 'Répond, rembourse, règle la boutique',
  AGENT: 'Répond aux clients et escalade',
  VIEWER: 'Consulte sans rien envoyer',
};

/*
 * Table des droits, telle que le serveur l'applique.
 *
 * Elle existait dans le code et nulle part à l'écran : un propriétaire qui
 * confie sa boutique devait deviner ce qu'un agent pourrait faire, ou
 * l'apprendre en le regardant faire. Recopiée ici, elle doit rester fidèle à
 * `src/plugins/auth.ts` — c'est le prix d'une explication lisible, et l'écart
 * se verrait au premier essai grâce à « Voir en tant que ».
 */
/**
 * Tableau des droits, servi par le serveur depuis la table qui les applique.
 *
 * Le recopier ici aurait été plus simple, et faux à terme : le jour où un
 * droit change de rôle, l'écran continuerait d'annoncer l'ancien — et c'est
 * l'écran qu'on croit, puisque c'est lui qu'on lit.
 */
async function renderRights() {
  const body = $('rights-rows');
  if (!body || body.dataset.loaded === '1') return;

  let data;
  try {
    data = await api('/api/rights');
  } catch {
    return;
  }

  // Une réponse sans droits — appel dégradé, proxy, version d'API décalée —
  // laissait le tableau à moitié dessiné sur une exception, et l'écran Équipe
  // vide sans un mot.
  if (!Array.isArray(data?.rights)) {
    body.innerHTML =
      '<tr><td colspan="5" class="empty">Tableau des droits indisponible.</td></tr>';
    return;
  }

  body.innerHTML = data.rights
    .map(
      (right) => `<tr>
        <td>${esc(right.label)}</td>
        ${right.allowed
          .map(
            (allowed) =>
              `<td class="rights-cell">${
                allowed
                  ? '<span class="rights-yes" title="Autorisé">✓</span>'
                  : '<span class="rights-no" title="Refusé">·</span>'
              }</td>`,
          )
          .join('')}
      </tr>`,
    )
    .join('');

  body.dataset.loaded = '1';
}

function isOwner() {
  return state.team.me?.role === 'OWNER';
}

async function loadTeam() {
  const data = await api('/api/team');
  state.team = data;
  renderTeam();
}

function renderTeam() {
  const { users } = state.team;
  const owner = isOwner();

  $('team-new').hidden = !owner;

  $('team-rows').innerHTML = users
    .map((user) => {
      const self = user.id === state.team.me?.id;
      return `<tr class="grid-row${user.active ? '' : ' muted'}" data-user="${esc(user.id)}">
        <td>
          <b>${esc(user.name ?? user.email)}</b>${self ? ' <span class="sub">(vous)</span>' : ''}
          <br /><span class="sub mono">${esc(user.email)}</span>
        </td>
        <td>${esc(ROLE_LABELS[user.role] ?? user.role)}</td>
        <td class="sub">${esc(ROLE_ABILITIES[user.role] ?? '')}</td>
        <td>${
          user.lastLoginAt
            ? relativeTime(user.lastLoginAt)
            : user.invitedAt
              ? `<span class="sub">invité ${relativeTime(user.invitedAt)}</span>`
              : '<span class="sub">jamais</span>'
        }</td>
        <td>${
          // « Actif » se lit comme « utilise l'outil » alors qu'il ne veut dire
          // que « pas désactivé ». Une invitation jamais honorée doit se voir :
          // c'est le symptôme d'un mail qui n'est pas arrivé.
          !user.active
            ? '<span class="tag tone-mute">Désactivé</span>'
            : user.lastLoginAt
              ? '<span class="tag tone-ok">Actif</span>'
              // Une invitation jamais honorée est en attente d'un tiers : c'est
              // exactement le sens de l'ambre, et le symptôme d'un mail qui
              // n'est pas arrivé.
              : '<span class="tag tone-wait">Invité</span>'
        }</td>
        <td>${owner ? '<button class="btn btn-small">Modifier</button>' : ''}</td>
      </tr>`;
    })
    .join('');

  void renderRights();

  const active = users.filter((user) => user.active).length;
  $('team-count').textContent = `${users.length} personne${users.length > 1 ? 's' : ''} · ${active} active${
    active > 1 ? 's' : ''
  }`;

  if (owner) {
    $('team-rows')
      .querySelectorAll('.grid-row')
      .forEach((row) => row.addEventListener('click', () => openTeamForm(row.dataset.user)));
  }
}

function describeRole() {
  $('team-f-perms').textContent = ROLE_ABILITIES[$('team-f-role').value] ?? '';
}

/** `id` absent : invitation. Sinon édition du rôle et de l'état. */
function openTeamForm(id) {
  const user = id ? state.team.users.find((candidate) => candidate.id === id) : null;
  state.editingUser = user?.id ?? null;
  const self = user?.id === state.team.me?.id;

  $('teammodal-title').textContent = user ? (user.name ?? user.email) : "Inviter quelqu'un";
  $('team-f-email').value = user?.email ?? '';
  // Le champ d'invitation ne sert qu'à la création ; sur un compte existant,
  // c'est le champ modifiable en dessous qui porte l'adresse.
  $('team-f-email').closest('.field').hidden = Boolean(user);
  $('team-f-email-row').hidden = !user;
  $('team-f-email-edit').value = user?.email ?? '';
  $('team-f-name').value = user?.name ?? '';
  $('team-f-role').value = user?.role ?? 'AGENT';
  $('team-f-active').checked = user ? user.active : true;

  $('team-f-active-row').hidden = !user;
  $('team-f-resend').hidden = !user;
  $('team-f-link').hidden = true;

  // Se rétrograder ou se désactiver soi-même fermerait la porte de l'intérieur.
  $('team-f-role').disabled = self;
  $('team-f-active').disabled = self;

  describeRole();
  $('team-modal').classList.add('open');
}

$('team-f-role').addEventListener('change', describeRole);
$('team-new').addEventListener('click', () => openTeamForm(null));
$('team-f-cancel').addEventListener('click', () => $('team-modal').classList.remove('open'));
$('team-modal').addEventListener('click', (event) => {
  if (event.target === $('team-modal')) $('team-modal').classList.remove('open');
});

/** Affiche le lien quand l'email n'a pas pu partir, au lieu de mentir. */
function showInviteLink(payload) {
  if (payload?.inviteUrl) {
    $('team-f-link-url').textContent = payload.inviteUrl;
    $('team-f-link').hidden = false;
    return false;
  }
  return true;
}

$('team-f-save').addEventListener('click', async () => {
  const id = state.editingUser;

  try {
    if (id) {
      const payload = {
        name: $('team-f-name').value.trim() || null,
        email: $('team-f-email-edit').value.trim(),
      };
      // Champs verrouillés sur soi-même : ne pas les envoyer évite un 409
      // inutile côté serveur.
      if (!$('team-f-role').disabled) {
        payload.role = $('team-f-role').value;
        payload.active = $('team-f-active').checked;
      }

      await api(`/api/team/${id}`, { method: 'PATCH', body: JSON.stringify(payload) });
      $('team-modal').classList.remove('open');
      toast('Membre mis à jour.');
    } else {
      const email = $('team-f-email').value.trim();
      if (!email) {
        toast('Une adresse email est requise.', true);
        return;
      }

      const result = await api('/api/team', {
        method: 'POST',
        body: JSON.stringify({
          email,
          name: $('team-f-name').value.trim() || undefined,
          role: $('team-f-role').value,
        }),
      });

      if (showInviteLink(result)) {
        $('team-modal').classList.remove('open');
        toast('Invitation envoyée.');
      }
    }

    await Promise.all([loadTeam(), loadAudit()]);
  } catch (error) {
    toast(error.message, true);
  }
});

$('team-f-resend').addEventListener('click', async () => {
  const id = state.editingUser;
  if (!id) return;

  try {
    const result = await api(`/api/team/${id}/invite`, { method: 'POST' });
    if (showInviteLink(result)) {
      toast('Invitation renvoyée.');
      $('team-modal').classList.remove('open');
    }
    await loadTeam();
  } catch (error) {
    toast(error.message, true);
  }
});

/* ---------------------------------------------------------- vue d'ensemble */

/* Résumé de ce qui appelle une action maintenant. Réutilise les données déjà
   chargées au démarrage plutôt que de rappeler l'API : cet écran doit
   s'afficher instantanément, c'est le premier ouvert de la journée. */
/*
 * Le poste de pilotage.
 *
 * Deux sources, parties ensemble et rattrapées séparément : `/api/metrics`
 * donne l'état de la file à l'instant, `/api/stats?days=7` donne la semaine.
 * Une panne de l'une ne doit pas vider l'écran de l'autre — c'est déjà la
 * règle de l'écran Statistiques, elle vaut ici pour la même raison.
 */
async function loadOverview() {
  void renderShopCards();

  const [mRes, sRes] = await Promise.allSettled([
    api('/api/metrics'),
    api('/api/stats?days=7'),
  ]);

  const metrics = mRes.status === 'fulfilled' ? mRes.value : null;
  const stats = sRes.status === 'fulfilled' ? sRes.value : null;
  const counts = metrics?.tickets ?? {};

  renderOvPanne({ metrics: metrics !== null, stats: stats !== null });

  renderOvKpis(metrics, counts);
  renderOvPriorite();
  renderOvRisques(metrics, counts);
  renderOvPerf(metrics, stats);
  renderOvIa(metrics, stats, counts);
  renderOvTendance(stats);
  renderOvIntentions(stats);
  await renderOvActions();
}

/*
 * Le bandeau qui explique les tirets.
 *
 * Les deux appels de cet écran sont indépendants et lancés ensemble : l'un
 * peut manquer sans l'autre. Nommer celui qui manque évite la lecture la plus
 * coûteuse — « l'outil est cassé » — au profit de la vraie : « ce chiffre-là
 * n'a pas pu être lu, réessayez ». C'est aussi la seule façon de savoir quels
 * tirets sont des mesures et lesquels sont des absences.
 */
function renderOvPanne({ metrics, stats }) {
  const boite = $('ov-panne');
  if (!boite) return;

  const manquants = [
    metrics ? null : 'les compteurs',
    stats ? null : 'la tendance sur sept jours',
  ].filter((nom) => nom !== null);

  boite.hidden = manquants.length === 0;
  if (manquants.length === 0) return;

  const liste = manquants.join(' et ');
  $('ov-panne-txt').innerHTML =
    `<b>Chiffres incomplets.</b> ${esc(liste[0].toUpperCase() + liste.slice(1))} ` +
    `${manquants.length > 1 ? 'n’ont' : 'n’a'} pas répondu. ` +
    'Les tirets de cet écran marquent ce qui n’a pas pu être lu — ce ne sont pas des zéros.';
}

/*
 * Les dernières actions, rendues depuis l'API.
 *
 * Cet écran recopiait le `innerHTML` du journal du rail de « SAV client ».
 * C'était deux dépendances silencieuses : l'ordre de chargement — arriver
 * directement ici laissait le bloc vide — et le gabarit d'un autre écran, qui
 * ne porte pas l'auteur. Or c'est lui qu'on vient lire : savoir qu'une réponse
 * est partie n'apprend rien, savoir qu'elle est partie SEULE, si.
 */
const ACTEURS = { AI: 'l’IA', SYSTEM: 'le système', SUPPLIER: 'un fournisseur' };

/*
 * Une icône par famille d'action, prise dans le jeu existant.
 *
 * Vingt-cinq actions, neuf familles : c'est le préfixe qui porte le sens — ce
 * qui touche à un brouillon, à un remboursement, à un fournisseur. Un
 * pictogramme par action serait vingt-cinq dessins à inventer et à retenir ;
 * un par famille se reconnaît sans être appris. Le jeu `ICONS` fournit tout
 * ce qu'il faut, rien à ajouter.
 */
const ACTION_ICONES = {
  draft: 'bolt',
  email: 'inbox',
  ticket: 'inbox',
  refund: 'euro',
  supplier: 'truck',
  shopify: 'bag',
  gmail: 'inbox',
  user: 'users',
  merchant: 'gear',
};

async function renderOvActions() {
  let entrees = [];
  try {
    entrees = (await api('/api/audit')).entries ?? [];
  } catch {
    // Le journal est un contexte, pas le sujet de l'écran : son absence ne
    // doit pas emporter les chiffres qui l'entourent.
    $('ov-audit').innerHTML = '<li class="empty" style="padding:12px 14px">Journal indisponible.</li>';
    return;
  }

  $('ov-audit').innerHTML =
    entrees
      .slice(0, 10)
      .map((entree) => {
        const meta = entree.metadata ?? {};
        const detail = [meta.orderName, meta.intent && (INTENT_LABELS[meta.intent] ?? meta.intent)]
          .filter(Boolean)
          .join(' · ');
        // « Par un agent » plutôt qu'un nom : la route ne sert pas l'identité,
        // et inventer « Par Thomas » serait plus faux qu'imprécis.
        const acteur = ACTEURS[entree.actorType] ?? 'un agent';

        const famille = String(entree.action).split('.')[0];

        return `<li>
          <time>${esc(shortTime(entree.createdAt))}</time>
          <span class="ov-ico" aria-hidden="true">${ico(ACTION_ICONES[famille] ?? 'inbox')}</span>
          <span class="ov-quoi">
            <b>${esc(AUDIT_LABELS[entree.action] ?? entree.action)}</b>${
              detail ? `<span class="sub"> · ${esc(detail)}</span>` : ''
            }
          </span>
          <span class="ov-par sub">Par ${esc(acteur)}</span>
        </li>`;
      })
      .join('') ||
    '<li class="empty" style="padding:12px 14px">Aucune action enregistrée.</li>';
}

/** Un nombre, ou un tiret : zéro et « pas mesuré » ne se lisent pas pareil. */
function ovNombre(valeur) {
  return typeof valeur === 'number' ? String(valeur) : '—';
}

/*
 * Un compte par statut, qui distingue « zéro » de « on ne sait pas ».
 *
 * `counts` vient de `metrics.tickets`, et le serveur n'y met que les statuts
 * réellement présents : une clé absente signifie donc bien zéro — mais
 * seulement si les indicateurs ont répondu. Quand ils n'ont pas répondu,
 * `counts` est un objet vide et TOUTES les clés manquent, ce qui est
 * indiscernable de « aucun ticket nulle part ».
 *
 * D'où le `metrics` en premier argument : c'est lui qui porte la différence.
 * Écrire `counts.X ?? 0` la perdait et affichait « 0 » — c'est-à-dire « tout
 * va bien » — sur le seul écran qu'on consulte pour savoir si quelque chose
 * brûle. Un tiret n'informe pas moins : il informe autre chose.
 */
function ovCompte(metrics, counts, cle) {
  return metrics ? String(counts[cle] ?? 0) : '—';
}

/*
 * L'écart d'un jour sur l'autre, et surtout : quand ne pas l'afficher.
 *
 * Le calcul est trivial, le jugement ne l'est pas. Trois cas où un
 * pourcentage ment plus qu'il n'informe :
 *
 *   1. TÔT LE MATIN. À 7 h 10, la comparaison porte sur soixante-dix minutes
 *      de chaque journée. Un ticket contre zéro donne « +100 % », deux contre
 *      un donne « +100 % » aussi, et le lendemain la même situation donnera
 *      « −50 % ». On se tait avant deux heures écoulées : il n'y a rien à
 *      décrire, seulement du bruit.
 *
 *   2. RÉFÉRENCE À ZÉRO. Passer de 0 à 3 n'est pas « +300 % », c'est « +3 ».
 *      Le pourcentage divise par zéro — au mieux il affiche l'infini, au pire
 *      un nombre inventé.
 *
 *   3. PETITS NOMBRES. De 2 à 3, « +50 % » suggère une tendance là où il n'y
 *      a qu'un ticket de plus. Sous cinq de référence, l'écart s'affiche en
 *      absolu : « +1 » se lit pour ce qu'il est.
 *
 * `sens` sépare la direction du jugement. Traiter plus est bon ; RECEVOIR
 * plus n'est ni bon ni mauvais, c'est de la demande. Peindre en rouge une
 * hausse d'arrivées reprocherait à l'équipe le succès de la boutique.
 */
function ecartJour(actuel, hier, minutesEcoulees) {
  if (typeof actuel !== 'number' || typeof hier !== 'number') return null;
  if (typeof minutesEcoulees === 'number' && minutesEcoulees < 120) return null;
  if (actuel === hier) return { texte: '=', direction: 'egal' };

  const diff = actuel - hier;
  // La flèche porte déjà le sens : un « +» devant ferait doublon.
  const fleche = diff > 0 ? '↑' : '↓';
  const texte =
    hier >= 5
      ? `${fleche} ${Math.round(Math.abs(diff / hier) * 100)} %`
      : `${fleche} ${Math.abs(diff)}`;

  return { texte, direction: diff > 0 ? 'hausse' : 'baisse' };
}

/** Le libellé complet, pour l'infobulle : un « ↑ 12 % » sans référence ne dit
    pas de quoi il parle, ni sur quelle tranche il a été mesuré. */
function ecartAide(nom, actuel, hier, minutesEcoulees) {
  if (typeof actuel !== 'number' || typeof hier !== 'number') return null;

  const tranche =
    typeof minutesEcoulees === 'number'
      ? ` sur la même tranche de journée (${duration(minutesEcoulees)} depuis minuit)`
      : '';

  if (minutesEcoulees < 120) {
    return `${nom} : comparaison en attente — trop peu de temps écoulé depuis minuit pour qu’un écart veuille dire quelque chose.`;
  }

  return `${nom} : ${actuel} aujourd’hui contre ${hier} hier${tranche}.`;
}

/* ---- les cinq chiffres du haut ---- */

function renderOvKpis(metrics, counts) {
  // Le délai est servi en secondes, `null` quand rien n'a été mesuré : zéro se
  // lirait « instantané », qui est l'inverse de « aucune réponse partie ».
  const delai =
    typeof metrics?.firstReplySeconds === 'number'
      ? duration(metrics.firstReplySeconds / 60)
      : '—';

  /*
   * Le « vs hier » ne figure que sur les deux cartes qui portent un FLUX.
   *
   * « En attente de vous », « Brouillons prêts » et « Chez le fournisseur »
   * comptent ce qui attend EN CE MOMENT. Leur valeur d'hier n'existe nulle
   * part : le produit ne garde pas l'historique des statuts, et rien ne
   * permet de reconstituer combien de brouillons étaient prêts hier à cette
   * heure. Y coller une flèche demanderait d'inventer la moitié de la
   * comparaison — et une flèche inventée se cite en réunion.
   */
  const hier = metrics?.hier ?? null;
  const ecart = (actuel, veille, nom, bon) => {
    const valeur = ecartJour(actuel, veille, hier?.minutesEcoulees);
    if (!valeur) return null;
    return {
      ...valeur,
      // `bon` dit ce qu'une hausse signifie. Traiter plus est bon ; recevoir
      // plus est de la demande, ni bon ni mauvais — le colorer reprocherait à
      // l'équipe le succès de la boutique.
      // Autant qu'hier n'est ni bien ni mal : « = » restait rouge sur
      // « Traités », comme une baisse.
      ton:
        bon === null || valeur.direction === 'egal'
          ? null
          : (valeur.direction === 'hausse') === bon
            ? 'ok'
            : 'bad',
      aide: ecartAide(nom, actuel, veille, hier?.minutesEcoulees),
    };
  };

  const cartes = [
    [
      'inbox',
      'En attente de vous',
      '',
      ovNombre(metrics?.pending),
      metrics ? `${counts.NEEDS_REVIEW ?? 0} à valider` : 'compteur indisponible',
      null,
      'bleu',
    ],
    [
      'bolt',
      'Brouillons prêts',
      '',
      ovCompte(metrics, counts, 'DRAFT_READY'),
      'relecture puis envoi',
      null,
      'violet',
    ],
    // La fenêtre est dans l'intitulé, pas dans la note : « 2 h 06 » suivi de
    // « sur 30 jours » se lisait comme un commentaire, alors que c'est ce qui
    // définit la mesure.
    // « Moyenne » passe dans la note : l'intitulé entier ne tenait plus dans
    // une case de la bande, et c'est la fenêtre qu'il coupait.
    ['clock', '1re réponse', '30 j', delai, 'en moyenne', null, 'orange'],
    [
      'truck',
      'Chez le fournisseur',
      '',
      ovCompte(metrics, counts, 'AWAITING_SUPPLIER'),
      'en attente de réponse',
      null,
      'indigo',
    ],
    [
      'inbox',
      'Reçus',
      'aujourd’hui',
      ovNombre(metrics?.recus),
      'nouveaux messages',
      // Aucun ton : plus d'arrivées, c'est de l'activité, pas une contre-performance.
      ecart(metrics?.recus, hier?.recus, 'Messages reçus', null),
      'vert',
    ],
    [
      'shield',
      'Traités',
      'aujourd’hui',
      ovNombre(metrics?.today),
      'depuis ce matin',
      ecart(metrics?.today, hier?.traites, 'Messages traités', true),
      'gris',
    ],
  ];

  $('ov-kpis').innerHTML = cartes
    .map(
      // La teinte du pictogramme, comme les catégories des Réglages : six
      // chiffres au même rang se retrouvent par leur couleur.
      ([ico, label, periode, valeur, note, delta, teinte]) => `<div class="kpi">
        <span class="kpi-ico c-${teinte}" data-ico="${esc(ico)}" aria-hidden="true"></span>
        <span class="kpi-body">
          <span class="kpi-label">${esc(label)}${
            periode ? `<span class="kpi-per"> · ${esc(periode)}</span>` : ''
          }</span>
          <span class="kpi-value">${esc(valeur)}${
            delta
              ? `<span class="kpi-delta${delta.ton ? ` kd-${delta.ton}` : ''}"${
                  delta.aide ? ` title="${esc(delta.aide)}"` : ''
                }>${esc(delta.texte)} <small>vs hier</small></span>`
              : ''
          }</span>
          ${note ? `<span class="kpi-note">${esc(note)}</span>` : ''}
        </span>
      </div>`,
    )
    .join('');

  // Les icônes sont peintes par la même fonction que la barre du SAV : deux
  // jeux de pictogrammes pour un seul produit se remarquent tout de suite.
  paintKpiIcons($('ov-kpis'));
  // Les titres de cartes portent aussi un pictogramme : même fonction, même
  // jeu de glyphes, et ils ne sont peints qu'une fois.
  document.querySelectorAll('#view-overview .panel-ico[data-ico]').forEach((box) => {
    if (!box.firstChild) box.innerHTML = ico(box.dataset.ico);
  });
}

/* ---- ce qui presse ---- */

/*
 * L'ordre est celui de l'échéance, pas celui de l'arrivée.
 *
 * Le produit a déjà une notion de retard : `merchant.slaHours` fixe le délai
 * de première réponse, l'ingestion en tire `ticket.dueAt`, et la file l'affiche
 * en trois paliers. La « priorité » du poste de pilotage n'est donc pas une
 * échelle inventée pour l'occasion — c'est cette échéance-là, lue autrement.
 * Un ticket sans échéance passe en dernier : rien ne dit qu'il est urgent.
 */
function ovEcheance(ticket) {
  if (!ticket.dueAt) return { rang: 3, ton: 'none', label: '—' };

  const reste = new Date(ticket.dueAt).getTime() - Date.now();
  if (reste < 0) return { rang: 0, ton: 'bad', label: `retard ${formatSpan(-reste)}` };
  if (reste < 4 * 3600000) return { rang: 1, ton: 'warn', label: formatSpan(reste) };
  return { rang: 2, ton: 'ok', label: formatSpan(reste) };
}

function renderOvPriorite() {
  const ouverts = state.tickets.filter(
    (t) => t.status !== 'CLOSED' && t.status !== 'AUTO_SENT',
  );

  const lignes = ouverts
    .map((t) => ({ t, e: ovEcheance(t) }))
    .sort((a, b) => a.e.rang - b.e.rang || new Date(a.t.lastMessageAt) - new Date(b.t.lastMessageAt))
    .slice(0, 9);

  // Le compteur dit combien de messages la table ordonne, pas combien sont
  // affichés — et surtout pas la même chose que « En attente de vous », qui
  // compte les non-lus de Gmail. L'infobulle lève la confusion.
  const compteur = $('ov-prio-n');
  compteur.hidden = ouverts.length === 0;
  compteur.textContent = String(ouverts.length);
  compteur.title = `${ouverts.length} message${ouverts.length > 1 ? 's' : ''} ouvert${
    ouverts.length > 1 ? 's' : ''
  }, classé${ouverts.length > 1 ? 's' : ''} par échéance. Les ${Math.min(
    ouverts.length,
    9,
  )} plus pressants sont affichés.`;

  /*
   * Des lignes à la manière de Mail, et non plus un tableau : l'avatar, le
   * nom et la commande, l'objet dessous, puis l'état, l'échéance et
   * l'ancienneté. Chaque ligne est un vrai bouton — le clavier l'ouvre sans
   * gestionnaire à part, ce que la ligne de tableau `role="button"` devait
   * réimplémenter.
   */
  $('ov-prio-rows').innerHTML = lignes.length
    ? lignes
        .map(
          ({ t, e }) => `<li><button class="ov-ligne" type="button" data-ov-id="${esc(t.id)}"
            aria-label="Ouvrir le message de ${esc(t.customerName ?? t.customerEmail)}">
            <span class="ov-av" aria-hidden="true"
              style="background:${esc(avatarTint(t.customerName ?? t.customerEmail))}">${esc(
                initials(t.customerName ?? t.customerEmail),
              )}</span>
            <span class="ov-txt">
              <span class="ov-l1">
                <span class="ov-who" title="${esc(t.customerName ?? t.customerEmail)}">${esc(
                  t.customerName ?? t.customerEmail,
                )}</span>
                ${t.orderName ? `<span class="ov-cmd">${esc(t.orderName)}</span>` : ''}
              </span>
              <span class="ov-subj" title="${esc(t.subject ?? '(sans objet)')}">${esc(
                t.subject ?? '(sans objet)',
              )}</span>
            </span>
            <span class="tag tag-status st-${esc(t.status)}">${esc(
              STATUS_LABELS[t.status] ?? t.status,
            )}</span>
            <span class="ov-quand">
              <span class="ov-age">${esc(relativeTime(t.lastMessageAt))}</span>
              ${
                // L'échéance n'est dite que si elle existe : un tiret par ligne
                // ferait une colonne de vide.
                t.dueAt ? `<span class="ovdue ovdue-${e.ton}">${esc(e.label)}</span>` : ''
              }
            </span>
            <span class="ov-go" aria-hidden="true">${ico('suiv')}</span>
          </button></li>`,
        )
        .join('')
    : `<li class="empty ov-vide">${
        state.queueLoaded
          ? 'Rien en attente.'
          : 'File non chargée : ouvrez « SAV client » ou rafraîchissez.'
      }</li>`;

  $('ov-prio-rows')
    .querySelectorAll('[data-ov-id]')
    .forEach((ligne) =>
      ligne.addEventListener('click', async () => {
        setView('tickets');
        await selectTicket(ligne.dataset.ovId);
      }),
    );
}

/* ---- ce qu'on surveille ---- */

/**
 * Une ligne de la colonne droite : un intitulé, un nombre, et un filtre.
 *
 * `filtre` est appliqué à la file avant d'y basculer. Un compteur qu'on ne
 * peut pas ouvrir ne sert qu'à inquiéter — c'est la règle de toute cette
 * colonne, et la raison pour laquelle une ligne sans destination reste un
 * simple texte, sans flèche ni curseur de lien.
 */
/**
 * Une ligne de la colonne droite.
 *
 * `periode` est collée à l'intitulé, jamais laissée implicite : « 1re réponse
 * moyenne » et « Traités aujourd'hui » dans la même carte, l'une sur trente
 * jours et l'autre depuis minuit, se lisaient comme deux mesures du même
 * moment. Le point médian est la seule ponctuation qui ne se confonde pas avec
 * une unité.
 *
 * `aide` devient une infobulle, pas une seconde ligne de texte : ce qui
 * s'explique une fois ne doit pas peser à chaque lecture.
 *
 * `filtre` est appliqué à la file avant d'y basculer. Une ligne sans
 * destination reste un simple `div`, sans curseur ni flèche — un compteur
 * qu'on ne peut pas ouvrir ne sert qu'à inquiéter.
 */
/*
 * `filtre` mène à la file filtrée, `vue` à un autre écran.
 *
 * Toutes les lignes de ce poste de pilotage ne parlent pas de tickets : les
 * demandes restées sans réponse vivent dans « Update », et y renvoyer par un
 * filtre de file donnerait une liste vide. Les deux s'excluent — `filtre`
 * l'emporte s'il est là — pour qu'un clic n'ait jamais deux destinations.
 */
function ovStatLigne({ label, valeur, ton, filtre, vue, periode, aide, ico: nomIco, teinte }) {
  const cliquable = Boolean(filtre || vue);
  const balise = cliquable ? 'button' : 'div';
  const cible = filtre
    ? ` data-ov-filtre="${esc(JSON.stringify(filtre))}"`
    : vue
      ? ` data-ov-vue="${esc(vue)}"`
      : '';
  return `<li><${balise} class="statrow${cliquable ? ' statrow-go' : ''}"${
    cliquable ? ` type="button"${cible}` : ''
  }>
    ${
      nomIco
        ? `<span class="statrow-ico${teinte ? ` c-${teinte}` : ''}" aria-hidden="true">${ico(nomIco)}</span>`
        : ''
    }
    <span class="statrow-l">${esc(label)}${
      periode ? `<span class="statrow-p"> · ${esc(periode)}</span>` : ''
    }</span>
    ${
      aide
        ? `<span class="statrow-i" tabindex="0" role="note" aria-label="${esc(aide)}"
             title="${esc(aide)}">i</span>`
        : ''
    }
    <b class="statrow-v${ton ? ` sv-${ton}` : ''}${
      // Zéro ou « non mesuré » se lisent en gris : le gras est réservé à ce
      // qui réclame un geste.
      valeur === '0' || valeur === '—' ? ' sv-nul' : ''
    }">${esc(valeur)}</b>
    ${cliquable ? `<span class="statrow-x" aria-hidden="true">${ico('suiv')}</span>` : ''}
  </${balise}></li>`;
}

function ovCablerFiltres(hote) {
  hote.querySelectorAll('[data-ov-filtre]').forEach((bouton) =>
    bouton.addEventListener('click', async () => {
      const patch = JSON.parse(bouton.dataset.ovFiltre);
      // On repart d'une file vierge : empiler le filtre du poste de pilotage
      // sur ce qui traînait donnerait un résultat que personne n'a demandé.
      state.queue = { ...emptyQueueFilters(), ...patch };
      state.filter = patch.status ?? '';
      setView('tickets');
      await loadQueue();
      renderQueueBar();
    }),
  );

  // Les lignes qui mènent ailleurs qu'à la file : l'écran se charge seul.
  hote.querySelectorAll('[data-ov-vue]').forEach((bouton) =>
    bouton.addEventListener('click', () => setView(bouton.dataset.ovVue)),
  );
}

/*
 * L'infobulle dit ce que le chiffre ne peut pas dire.
 *
 * « 6 » ne distingue pas six demandes chez un seul atelier — un coup de fil —
 * de six demandes chez six ateliers, qui est une matinée. Et l'ancienneté de
 * la plus vieille dit s'il s'agit d'hier ou de la semaine dernière.
 */
function aideRetardFournisseurs(retard) {
  if (!retard) return 'Chiffre indisponible : les indicateurs n’ont pas répondu.';
  if (retard.requests === 0) {
    return 'Aucune demande de changement sans réponse depuis plus de 24 h.';
  }

  const d = retard.requests > 1 ? 's' : '';
  const f = retard.suppliers > 1 ? 's' : '';
  return (
    `${retard.requests} demande${d} de changement sans réponse chez ` +
    `${retard.suppliers} fournisseur${f}. La plus ancienne : ${relativeTime(retard.oldestAt)}. ` +
    'L’outil relance une fois par mail au bout de douze heures ; au-delà, il n’insiste plus.'
  );
}

function renderOvRisques(metrics, counts) {
  const ouverts = state.tickets.filter(
    (t) => t.status !== 'CLOSED' && t.status !== 'AUTO_SENT',
  );
  const maintenant = Date.now();
  const plusVieuxQue = (heures) =>
    ouverts.filter((t) => maintenant - new Date(t.lastMessageAt).getTime() > heures * 3600000)
      .length;

  const horsDelai = ouverts.filter(
    (t) => t.dueAt && new Date(t.dueAt).getTime() < maintenant,
  ).length;
  const litiges = ouverts.filter((t) => t.intent === 'DISPUTE').length;
  const retard = metrics?.suppliersLate ?? null;

  /*
   * Ces quatre lignes se comptent sur la file déjà chargée, pas sur une
   * requête à elles. Tant qu'elle n'a pas répondu, `state.tickets` est vide —
   * et un tableau vide donne quatre zéros, c'est-à-dire quatre fois « rien
   * ne presse », sur le panneau dont c'est précisément le contraire du rôle.
   */
  const deLaFile = (nombre) => (state.queueLoaded ? String(nombre) : '—');
  const tonSiChargee = (nombre, ton) => (state.queueLoaded && nombre > 0 ? ton : null);

  const lignes = [
    {
      label: 'SLA dépassé',
      ico: 'clock',
      teinte: 'rouge',
      valeur: deLaFile(horsDelai),
      ton: tonSiChargee(horsDelai, 'bad'),
      filtre: { sort: 'due' },
      aide: `Messages dont l’échéance de première réponse est passée. Le délai est celui réglé pour la boutique.`,
    },
    {
      label: 'Sans réponse > 24 h',
      ico: 'clock',
      teinte: 'orange',
      valeur: deLaFile(plusVieuxQue(24)),
      ton: tonSiChargee(plusVieuxQue(24), 'warn'),
      filtre: { urgent: true },
    },
    {
      label: 'Sans réponse > 48 h',
      ico: 'clock',
      teinte: 'rouge',
      valeur: deLaFile(plusVieuxQue(48)),
      ton: tonSiChargee(plusVieuxQue(48), 'bad'),
      filtre: { urgent: true },
    },
    { label: 'Litiges ouverts', valeur: deLaFile(litiges), filtre: { intent: 'DISPUTE' }, ico: 'shield', teinte: 'rouge' },
    {
      label: 'Chez le fournisseur',
      valeur: ovCompte(metrics, counts, 'AWAITING_SUPPLIER'),
      filtre: { status: 'AWAITING_SUPPLIER' },
      ico: 'truck',
      teinte: 'indigo',
      aide: 'Messages en attente d’un atelier. Ils ne sont pas en retard pour autant : la ligne suivante dit lesquels le sont.',
    },
    {
      /*
       * La ligne précédente compte des MESSAGES qui attendent un atelier ;
       * celle-ci compte des DEMANDES qu'un atelier laisse sans réponse. Ce
       * n'est pas la même chose, et c'est la seconde qui coûte : un message
       * en attente suit son cours, une demande muette depuis un jour ne
       * bougera plus sans un coup de fil.
       */
      label: 'Fournisseurs sans réponse',
      periode: '> 24 h',
      ico: 'truck',
      teinte: 'indigo',
      // Pas de `?? 0` : quand les indicateurs n'ont pas répondu, on ne sait
      // pas, et « 0 » se lirait « tout va bien » — le contraire d'un silence.
      valeur: retard ? String(retard.requests) : '—',
      ton: retard && retard.requests > 0 ? 'bad' : null,
      vue: 'changes',
      aide: aideRetardFournisseurs(retard),
    },
    {
      label: 'Non compris par l’IA',
      // `metrics.failed` vaut toujours un nombre quand la réponse est là :
      // `ovNombre` rend donc « — » exactement quand elle manque. Le `?? 0`
      // d'avant transformait ce manque en « aucun échec ».
      valeur: ovNombre(metrics?.failed),
      ton: metrics?.failed > 0 ? 'bad' : null,
      filtre: { status: 'FAILED' },
      ico: 'bolt',
      teinte: 'violet',
      aide: 'Messages que la classification n’a pas su traiter : ils attendent une reprise à la main.',
    },
  ];

  $('ov-risk').innerHTML = lignes.map(ovStatLigne).join('');
  ovCablerFiltres($('ov-risk'));
}

/*
 * L'infobulle du délai de résolution.
 *
 * Elle porte trois choses que le chiffre seul ne peut pas dire : d'où à où
 * la mesure court, sur combien de dossiers elle repose, et ce qu'elle laisse
 * dehors. Ce dernier point n'est pas un détail de méthode — un ticket clos
 * sans réponse envoyée (indésirable, doublon, affaire réglée au téléphone)
 * ne laisse aucune trace mesurable. Taire l'écart laisserait croire que la
 * médiane décrit tous les dossiers clos.
 */
function aideResolution(resolution) {
  if (!resolution) return 'Chiffre indisponible : les statistiques n’ont pas répondu.';

  const definition =
    'Du premier message du client à la dernière réponse partie. Faute d’une date ' +
    'de clôture fiable, c’est cette dernière réponse qui borne la mesure : c’est ' +
    'le moment où le client cesse d’attendre.';

  if (resolution.measured === 0) {
    return resolution.resolved > 0
      ? `${definition} Aucun des ${resolution.resolved} tickets résolus sur la période ` +
          'n’a reçu de réponse par mail : il n’y a rien à mesurer.'
      : `${definition} Aucun ticket résolu sur la période.`;
  }

  const moyenne =
    typeof resolution.averageMinutes === 'number'
      ? ` Moyenne : ${duration(resolution.averageMinutes)}.`
      : '';
  const dehors = resolution.resolved - resolution.measured;
  const angleMort =
    dehors > 0
      ? ` ${dehors} autre${dehors > 1 ? 's ont été clos' : ' a été clos'} sans réponse ` +
        'envoyée, et n’entre' + (dehors > 1 ? 'nt' : '') + ' donc pas dans le calcul.'
      : '';

  return (
    `${definition} Mesuré sur ${resolution.measured} des ${resolution.resolved} ` +
    `tickets résolus.${moyenne}${angleMort}`
  );
}

function renderOvPerf(metrics, stats) {
  const ouverts = state.tickets.filter(
    (t) => t.status !== 'CLOSED' && t.status !== 'AUTO_SENT',
  );
  const avecEcheance = ouverts.filter((t) => t.dueAt);
  const dansLesTemps = avecEcheance.filter(
    (t) => new Date(t.dueAt).getTime() >= Date.now(),
  ).length;

  // Sans échéance mesurée, on n'affiche pas « 100 % » : un taux calculé sur
  // rien est plus trompeur qu'un tiret.
  const respect = avecEcheance.length
    ? `${Math.round((dansLesTemps / avecEcheance.length) * 100)} %`
    : '—';

  const moyenne = stats?.firstReply?.averageMinutes;
  const mediane = stats?.firstReply?.medianMinutes;
  const resolution = stats?.resolution ?? null;

  $('ov-perf').innerHTML = [
    {
      label: '1re réponse moyenne',
      periode: '7 j',
      valeur: typeof moyenne === 'number' ? duration(moyenne) : '—',
    },
    {
      label: '1re réponse médiane',
      periode: '7 j',
      valeur: typeof mediane === 'number' ? duration(mediane) : '—',
      aide: 'La médiane est moins sensible aux valeurs extrêmes que la moyenne : un seul message oublié pendant une semaine ne la déplace pas.',
    },
    {
      /*
       * La première réponse dit à quelle vitesse on décroche, celle-ci à
       * quelle vitesse on raccroche. Une équipe peut accuser réception en
       * dix minutes et laisser le dossier traîner trois semaines : aucun des
       * deux chiffres ne remplace l'autre, et c'est le second que le client
       * retient.
       *
       * La médiane et non la moyenne, parce que le délai de résolution est la
       * mesure la plus dissymétrique de cet écran — deux dossiers oubliés
       * pendant un mois déplacent une moyenne de plusieurs heures et
       * décrivent alors ces deux-là, pas le travail de la semaine. La moyenne
       * reste dans l'infobulle, pour qui veut voir la traîne.
       */
      label: 'Résolution médiane',
      periode: '7 j',
      valeur:
        typeof resolution?.medianMinutes === 'number' ? duration(resolution.medianMinutes) : '—',
      aide: aideResolution(resolution),
    },
    { label: 'Traités', periode: 'aujourd’hui', valeur: ovNombre(metrics?.today) },
    {
      label: 'SLA respecté',
      valeur: respect,
      ton: avecEcheance.length && dansLesTemps / avecEcheance.length < 0.9 ? 'warn' : null,
      aide: state.queueLoaded
        ? `Part des messages ouverts dont l’échéance n’est pas dépassée, sur les ${avecEcheance.length} qui en portent une.`
        : 'File non chargée : rien n’a encore été mesuré.',
    },
  ]
    .map(ovStatLigne)
    .join('');
}

function renderOvIa(metrics, stats, counts) {
  const taux = metrics?.automationRate;
  // La carte mêle deux fenêtres : les brouillons sur sept jours, le taux sur
  // trente. L'en-tête ne peut donc pas en annoncer une seule — chaque ligne
  // porte la sienne.
  $('ov-ia-note').textContent = '';

  $('ov-ia').innerHTML = [
    { label: 'Brouillons générés', periode: '7 j', valeur: ovNombre(stats?.drafts?.total) },
    {
      label: 'Réponses envoyées automatiquement',
      periode: '7 j',
      valeur: ovNombre(stats?.drafts?.sent),
      aide: 'Brouillons partis sans relecture. Le reste a été validé à la main avant envoi.',
    },
    {
      label: 'Taux d’automatisation',
      periode: '30 j',
      valeur: typeof taux === 'number' ? `${Math.round(taux * 100)} %` : '—',
      aide: 'Part des brouillons rédigés par l’IA qui sont réellement partis. Un brouillon jamais envoyé n’a fait gagner aucune minute.',
    },
    {
      label: 'À valider par un humain',
      valeur: ovCompte(metrics, counts, 'NEEDS_REVIEW'),
      filtre: { status: 'NEEDS_REVIEW' },
    },
    {
      label: 'Non compris par l’IA',
      // `metrics.failed` vaut toujours un nombre quand la réponse est là :
      // `ovNombre` rend donc « — » exactement quand elle manque. Le `?? 0`
      // d'avant transformait ce manque en « aucun échec ».
      valeur: ovNombre(metrics?.failed),
      ton: metrics?.failed > 0 ? 'bad' : null,
      filtre: { status: 'FAILED' },
    },
  ]
    .map(ovStatLigne)
    .join('');
  ovCablerFiltres($('ov-ia'));
}

/* ---- la semaine ---- */

function renderOvTendance(stats) {
  // « Pas encore de données » est une phrase rassurante : elle dit que
  // l'outil fonctionne et que l'histoire commence. La servir quand l'appel a
  // échoué ment sur la cause, et personne ne pense à rafraîchir.
  if (!stats) {
    $('ov-trend').innerHTML =
      '<p class="empty">Tendance indisponible : les statistiques n’ont pas répondu.</p>';
    return;
  }

  const jours = stats.tickets?.daily ?? [];
  $('ov-trend').innerHTML = jours.length
    ? tendanceHtml(jours)
    : '<p class="empty">Pas encore de données sur sept jours.</p>';
}

function renderOvIntentions(stats) {
  if (!stats) {
    $('ov-intents').innerHTML =
      '<p class="empty">Répartition indisponible : les statistiques n’ont pas répondu.</p>';
    return;
  }

  // La part se compare, le volume se vérifie : « 41 % » ne dit pas si c'est
  // sur mille demandes ou sur douze. Les deux, la part en avant.
  $('ov-intents').innerHTML = intentBars(stats.tickets?.byIntent, { part: true, volume: true });
}

/*
 * Les deux « Voir tout ».
 *
 * Câblés une fois, au chargement, et non à chaque rendu : ils vivent dans le
 * HTML statique, un écouteur par relève en empilerait un de plus à chaque
 * fois. Aucun des deux n'ouvre une page inventée — la file existe, le journal
 * complet aussi.
 */
$('ov-prio-all')?.addEventListener('click', async () => {
  // La file entière, sans filtre : « voir tout » doit rendre tout, pas le
  // même extrait avec un tri différent.
  state.queue = emptyQueueFilters();
  state.filter = '';
  setView('tickets');
  await loadQueue();
  renderQueueBar();
});

$('ov-act-all')?.addEventListener('click', () => {
  // Le journal complet vit dans le rail de « SAV client », replié dans un
  // `<details>` : y renvoyer sans l'ouvrir enverrait sur un titre fermé.
  setView('tickets');
  const bloc = document.getElementById('c-audit')?.closest('details');
  if (bloc) bloc.open = true;
  document.getElementById('c-audit')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
});

/* --------------------------------------------------------- statistiques -- */

function duration(minutes) {
  if (minutes === null || minutes === undefined) return '—';
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const hours = minutes / 60;
  if (hours < 48) return `${hours.toFixed(1)} h`;
  return `${Math.round(hours / 24)} j`;
}

function money(value, currency) {
  return new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency: currency || 'EUR',
    maximumFractionDigits: value >= 1000 ? 0 : 2,
  }).format(value);
}

/*
 * Deux séries côte à côte : reçus et traités, jour par jour.
 *
 * En HTML et non en SVG. Les autres graphes du produit sont des `<svg>` en
 * `preserveAspectRatio="none"` : la boîte s'étire à la largeur disponible, ce
 * qui va bien pour des rectangles et déforme tout texte tracé dedans. Or c'est
 * précisément ce qu'il manquait ici — la valeur au-dessus de chaque barre et
 * l'échelle à gauche. Une grille de sept colonnes rend les mêmes barres, laisse
 * le texte au navigateur, et n'ajoute aucune dépendance.
 *
 * Un seul sommet gouverne les deux séries : c'est le rapport entre elles qu'on
 * vient lire — la file se vide-t-elle au rythme où elle se remplit ?
 */

/** Un plafond rond au-dessus du pic : 68 donne 80, 124 donne 150. */
function echelleRonde(pic) {
  if (pic <= 0) return 4;
  const puissance = 10 ** Math.floor(Math.log10(pic));
  for (const pas of [1, 2, 2.5, 5, 10]) {
    const cran = pas * puissance;
    if (Math.ceil(pic / cran) * cran >= pic) return Math.ceil(pic / cran) * cran;
  }
  return pic;
}

function tendanceHtml(jours) {
  const pic = Math.max(0, ...jours.map((j) => Math.max(j.received ?? 0, j.handled ?? 0)));
  const haut = echelleRonde(pic);

  // Quatre graduations : assez pour situer une hauteur, pas assez pour rayer.
  const graduations = [haut, haut * 0.75, haut * 0.5, haut * 0.25, 0]
    .map((v) => `<span>${Math.round(v)}</span>`)
    .join('');

  const colonnes = jours
    .map((jour) => {
      const recus = jour.received ?? 0;
      const traites = jour.handled ?? 0;
      const date = new Date(jour.day + 'T00:00:00');
      const jourCourt = date.toLocaleDateString('fr-FR', { weekday: 'short' });
      const dateCourte = date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });

      // Une barre nulle garde deux pour cent de hauteur : invisible, elle se
      // confondrait avec un jour absent, et ce n'est pas la même chose.
      const h = (v) => (v > 0 ? Math.max(2, (v / haut) * 100) : 0);

      return `<div class="tr-jour" title="${esc(jourCourt)} ${esc(dateCourte)}
Reçus : ${recus}
Traités : ${traites}">
        <span class="tr-vals"><b>${recus}</b><b>${traites}</b></span>
        <span class="tr-bars">
          <i class="tr-recu" style="height:${h(recus).toFixed(1)}%"></i>
          <i class="tr-traite" style="height:${h(traites).toFixed(1)}%"></i>
        </span>
        <span class="tr-lab">${esc(jourCourt)}<b>${esc(dateCourte)}</b></span>
      </div>`;
    })
    .join('');

  return `<div class="tr" role="img"
    aria-label="Messages reçus et traités sur ${jours.length} jours">
    <div class="tr-y" aria-hidden="true">${graduations}</div>
    <div class="tr-plot">${colonnes}</div>
  </div>`;
}

/** Répartition en barres horizontales : à sept catégories, plus lisible qu'un
    camembert — les angles proches se comparent mal, les longueurs bien. */
function intentBars(byIntent, options = {}) {
  // Une réponse d'API sans la ventilation par motif emportait tout l'écran
  // Statistiques sur une exception. Un graphe manquant vaut mieux qu'une page
  // blanche : le reste des chiffres, lui, est là.
  const rows = Object.entries(byIntent ?? {}).sort((a, b) => b[1] - a[1]);
  if (rows.length === 0) return '<p class="empty">Aucune demande sur la période.</p>';

  const total = rows.reduce((sum, [, count]) => sum + count, 0);

  return rows
    .map(
      ([intent, count]) => `<div class="ibar">
        <span class="ibar-label">${esc(INTENT_LABELS[intent] ?? intent)}</span>
        <span class="ibar-track">
          <i class="ibar-fill in-${esc(intent)}" style="width:${((count / total) * 100).toFixed(1)}%"></i>
        </span>
        <span class="ibar-count mono">${
          options.part ? `${Math.round((count / total) * 100)} %` : count
        }${options.volume ? `<span class="ibar-vol"> (${count})</span>` : ''}</span>
      </div>`,
    )
    .join('');
}

/*
 * Les statistiques, façon Shopify.
 *
 * Trois réglages gouvernent tout l'écran : une période au calendrier
 * (« 30 derniers jours », « Depuis le 1er janvier », ou deux dates choisies),
 * une comparaison (la période précédente, la même l'an dernier, aucune) et un
 * regroupement (heure, jour, semaine, mois). Chaque carte s'ouvre en grand :
 * ses barres face à celles de la comparaison, et le tableau de ses valeurs.
 *
 * Les ventes viennent de Shopify, le SAV de la base : deux appels qui
 * arrivent et échouent séparément. Les réglages restent dans ce navigateur.
 */

const PERIODES_STATS = [
  { cle: 'aujourdhui', nom: 'Aujourd’hui' },
  { cle: 'hier', nom: 'Hier' },
  { cle: '7', nom: '7 derniers jours' },
  { cle: '30', nom: '30 derniers jours' },
  { cle: '90', nom: '90 derniers jours' },
  { cle: '365', nom: '12 derniers mois' },
  { cle: 'annee', nom: 'Depuis le 1er janvier' },
  { cle: 'perso', nom: 'Personnalisée' },
];
const COMPARAISONS_STATS = {
  precedente: { nom: 'période précédente', court: 'la période précédente', colonne: 'Période précédente' },
  annee: { nom: 'même période l’an dernier', court: 'l’an dernier', colonne: 'L’an dernier' },
  aucune: { nom: 'aucune', court: '', colonne: '' },
};
const GRAINS_STATS = [
  { cle: 'heure', nom: 'Heure', par: 'heure' },
  { cle: 'jour', nom: 'Jour', par: 'jour' },
  { cle: 'semaine', nom: 'Semaine', par: 'semaine' },
  { cle: 'mois', nom: 'Mois', par: 'mois' },
];
/** Un an et un jour au plus, comme côté serveur (`JOURS_MAX`). */
const JOURS_MAX_STATS = 366;

/*
 * Chaque mesure : d'où elle vient, comment elle s'écrit, et dans quel sens
 * elle s'améliore — un remboursé qui monte s'écrit en rouge, un panier qui
 * monte en vert. Une part se compare en points, pas en pour cent d'elle-même.
 */
const MESURES_STATS = {
  ca: { titre: 'Chiffre d’affaires', source: 'ventes', format: 'argent', mieux: 1, total: (t) => t.ca },
  commandes: { titre: 'Commandes', source: 'ventes', format: 'nombre', mieux: 1, total: (t) => t.commandes },
  panier: { titre: 'Panier moyen', source: 'ventes', format: 'argent', mieux: 1, total: (t) => t.panier },
  rembourse: { titre: 'Remboursé', source: 'ventes', format: 'argent', mieux: -1, total: (t) => t.rembourse },
  messages: { titre: 'Messages reçus', source: 'sav', format: 'nombre', mieux: -1, total: (t) => t.messages },
  premiereReponse: {
    titre: 'Première réponse',
    source: 'sav',
    format: 'duree',
    mieux: -1,
    total: (t) => t.premiereReponse.mediane,
  },
  brouillons: { titre: 'Brouillons utilisés', source: 'sav', format: 'part', mieux: 1, total: (t) => t.brouillons.taux },
  aClasser: { titre: 'À classer', source: 'sav', format: 'part', mieux: -1, total: (t) => t.aClasser.part },
  motifs: { titre: 'Motifs des demandes', source: 'sav', format: 'nombre', mieux: -1, total: (t) => t.messages },
};

/* Les motifs en mots de tous les jours ; les messages sans motif sont « à classer ». */
const MOTIFS_STATS = {
  WISMO: 'Où est ma commande',
  RETURN: 'Retour',
  DISPUTE: 'Litige',
  REFUND: 'Remboursement',
  PRODUCT_QUESTION: 'Question produit',
  POSITIVE: 'Message positif',
  OTHER: 'À classer',
};

/* ------------------------------------------------------------ dates ---- */

/** Une date du calendrier local, `AAAA-MM-JJ`. */
function dateLocale(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
/** À midi UTC : aucun changement d'heure ne fait glisser la date. */
function jourDe(date) {
  const [a, m, j] = date.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, j, 12));
}
function decalerDate(date, n) {
  const d = jourDe(date);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function joursDe(debut, fin) {
  return Math.round((jourDe(fin) - jourDe(debut)) / 86_400_000) + 1;
}
function anneeAvant(date) {
  const [a, m, j] = date.split('-').map(Number);
  const dernier = new Date(Date.UTC(a - 1, m, 0)).getUTCDate();
  return `${a - 1}-${String(m).padStart(2, '0')}-${String(Math.min(j, dernier)).padStart(2, '0')}`;
}

function datesDuRaccourci(cle) {
  const auj = dateLocale();
  if (cle === 'aujourdhui') return [auj, auj];
  if (cle === 'hier') return [decalerDate(auj, -1), decalerDate(auj, -1)];
  if (cle === 'annee') return [`${auj.slice(0, 4)}-01-01`, auj];
  const jours = { 7: 7, 90: 90, 365: 365 }[cle] ?? 30;
  return [decalerDate(auj, -(jours - 1)), auj];
}

function periodeComparee(debut, fin, comparer) {
  if (comparer === 'aucune') return null;
  if (comparer === 'annee') return [anneeAvant(debut), anneeAvant(fin)];
  const jours = joursDe(debut, fin);
  return [decalerDate(debut, -jours), decalerDate(debut, -1)];
}

/* Mêmes règles que le serveur (`grainParDefaut`, `grainPermis`). */
function grainEffectif(grain, jours) {
  const defaut = jours <= 1 ? 'heure' : jours <= 31 ? 'jour' : jours <= 120 ? 'semaine' : 'mois';
  const g = grain ?? defaut;
  return g === 'heure' && jours > 7 ? 'jour' : g;
}

const moisLong = (d) => d.toLocaleDateString('fr-FR', { month: 'long', timeZone: 'UTC' });
const quantieme = (d) => (d.getUTCDate() === 1 ? '1er' : String(d.getUTCDate()));

/** « du 17 septembre au 16 octobre 2026 », « le 16 octobre 2026 ». */
function plageEnLettres(debut, fin) {
  const d = jourDe(debut);
  const f = jourDe(fin);
  const an = (x) => x.getUTCFullYear();
  const finTxt = `${quantieme(f)} ${moisLong(f)} ${an(f)}`;
  if (debut === fin) return `le ${finTxt}`;
  if (an(d) !== an(f)) return `du ${quantieme(d)} ${moisLong(d)} ${an(d)} au ${finTxt}`;
  if (d.getUTCMonth() === f.getUTCMonth()) return `du ${quantieme(d)} au ${finTxt}`;
  return `du ${quantieme(d)} ${moisLong(d)} au ${finTxt}`;
}

/** « 17 sept. – 16 oct. 2026 » : le nom d'une période choisie au calendrier. */
function plageCourte(debut, fin) {
  const court = (x, an) =>
    x.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', ...(an ? { year: 'numeric' } : {}), timeZone: 'UTC' });
  if (debut === fin) return court(jourDe(fin), true);
  return `${court(jourDe(debut), debut.slice(0, 4) !== fin.slice(0, 4))} – ${court(jourDe(fin), true)}`;
}

const majuscule = (texte) => texte.charAt(0).toUpperCase() + texte.slice(1);

/** Le nom d'un point : `14 h`, `16 oct.`, `oct. 2026` ; en long pour l'infobulle et le tableau. */
function etiquettePoint(cle, grain, long = false) {
  if (grain === 'heure') {
    const heure = `${Number(cle.slice(11))} h`;
    return long ? `${jourDe(cle.slice(0, 10)).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })}, ${heure}` : heure;
  }
  if (grain === 'mois') {
    return jourDe(`${cle}-01`).toLocaleDateString('fr-FR', { month: long ? 'long' : 'short', year: 'numeric', timeZone: 'UTC' });
  }
  const d = jourDe(cle);
  if (grain === 'semaine') {
    const txt = d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', timeZone: 'UTC' });
    return long ? `Semaine du ${txt}` : txt;
  }
  return d.toLocaleDateString('fr-FR', {
    ...(long ? { weekday: 'short' } : {}),
    day: 'numeric',
    month: 'short',
    ...(long ? { year: 'numeric' } : {}),
    timeZone: 'UTC',
  });
}

/* ------------------------------------------------------------ chiffres - */

function dureeStat(minutes) {
  if (minutes <= 0) return '0 min';
  if (minutes < 1) return '< 1 min';
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const total = Math.round(minutes);
  if (total < 1440) return `${Math.floor(total / 60)} h ${String(total % 60).padStart(2, '0')}`;
  const heures = Math.round(total / 60);
  return `${Math.floor(heures / 24)} j ${heures % 24} h`;
}

function formatStat(valeur, format, devise, compact = false) {
  if (valeur === null || valeur === undefined || Number.isNaN(valeur)) return '—';
  if (format === 'argent') {
    return compact
      ? new Intl.NumberFormat('fr-FR', {
          style: 'currency',
          currency: devise || 'EUR',
          notation: 'compact',
          maximumFractionDigits: 1,
        }).format(valeur)
      : money(valeur, devise);
  }
  if (format === 'duree') return dureeStat(valeur);
  if (format === 'part') return `${Math.round(valeur * 100)} %`;
  return Math.round(valeur).toLocaleString('fr-FR');
}

const signeStat = (n) => (n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : '0');

/**
 * L'écart avec la comparaison, et sa couleur.
 *
 * Rien quand il n'y a rien à comparer : un écart avec zéro n'est pas « +∞ % ».
 * Une part s'écarte en points. Arrondi à zéro, l'écart reste gris.
 */
function ecartStat(courant, compare, mesure) {
  if (courant === null || courant === undefined || compare === null || compare === undefined) return null;
  let arrondi;
  let texte;
  if (mesure.format === 'part') {
    arrondi = Math.round((courant - compare) * 100);
    texte = `${signeStat(arrondi)} pt${Math.abs(arrondi) > 1 ? 's' : ''}`;
  } else {
    if (compare === 0) return null;
    arrondi = Math.round(((courant - compare) / Math.abs(compare)) * 100);
    texte = `${signeStat(arrondi)} %`;
  }
  const ton = arrondi === 0 ? 'neutre' : Math.sign(arrondi) === mesure.mieux ? 'bon' : 'mauvais';
  return { texte, ton };
}

function ecartMarkup(ecart, contexte) {
  if (!ecart) return '';
  return `<span class="sta-delta sta-${ecart.ton}">${esc(ecart.texte)}<span class="sr-only"> ${esc(contexte)}</span></span>`;
}

/** Un plafond rond et son pas : 4 crans de 1, 2, 2,5 ou 5 fois une puissance de dix. */
function echelleStat(max) {
  if (!(max > 0)) return { haut: 4, pas: 1 };
  const brut = max / 4;
  const puissance = 10 ** Math.floor(Math.log10(brut));
  const pas = [1, 2, 2.5, 5, 10].map((m) => m * puissance).find((p) => p >= brut) ?? brut;
  return { haut: pas * Math.ceil(max / pas), pas };
}

/** Les rangs qui portent une étiquette sur l'axe : six au plus, le dernier toujours. */
function rangsEtiquetes(cles, grain) {
  const n = cles.length;
  if (n <= 1) return [0];
  // Par heure sur plusieurs jours : une étiquette par jour, à minuit.
  if (grain === 'heure' && n > 24) {
    const pas = Math.ceil(n / 24 / 6) * 24;
    return cles.map((_, i) => i).filter((i) => i % pas === 0);
  }
  const pas = Math.max(1, Math.ceil(n / 6));
  const rangs = cles.map((_, i) => i).filter((i) => i % pas === 0);
  if (n - 1 - rangs[rangs.length - 1] >= pas / 2) rangs.push(n - 1);
  return rangs;
}

function etiquetteAxe(cle, grain, nombre) {
  return grain === 'heure' && nombre > 24 ? etiquettePoint(cle.slice(0, 10), 'jour') : etiquettePoint(cle, grain);
}

/** Un tracé fin de 200 × 40 ; un trou dans la série coupe la ligne. */
function sparkline(valeurs, n, max) {
  let d = '';
  let leve = true;
  for (let i = 0; i < n; i += 1) {
    const v = valeurs[i];
    if (v === null || v === undefined) {
      leve = true;
      continue;
    }
    const y = (38 - (max ? (v / max) * 34 : 0)).toFixed(1);
    if (n === 1) return `M90 ${y}L110 ${y}`;
    d += `${leve ? 'M' : 'L'}${((i / (n - 1)) * 200).toFixed(1)} ${y}`;
    leve = false;
  }
  return d;
}

/* ------------------------------------------------------------ état ----- */

const etatStats = (() => {
  const reglages = { raccourci: '30', debut: null, fin: null, comparer: 'precedente', grain: null };
  try {
    const garde = JSON.parse(localStorage.getItem('csav.stats') ?? 'null');
    if (garde && PERIODES_STATS.some((p) => p.cle === garde.raccourci)) reglages.raccourci = garde.raccourci;
    if (garde && garde.comparer in COMPARAISONS_STATS) reglages.comparer = garde.comparer;
    if (garde && GRAINS_STATS.some((g) => g.cle === garde.grain)) reglages.grain = garde.grain;
    const date = /^\d{4}-\d{2}-\d{2}$/;
    if (reglages.raccourci === 'perso' && date.test(garde.debut) && date.test(garde.fin)) {
      reglages.debut = garde.debut;
      reglages.fin = garde.fin > dateLocale() ? dateLocale() : garde.fin;
    }
  } catch {
    // Stockage indisponible : les réglages par défaut.
  }
  if (!reglages.debut || joursDe(reglages.debut, reglages.fin) < 1 || joursDe(reglages.debut, reglages.fin) > JOURS_MAX_STATS) {
    if (reglages.raccourci === 'perso') reglages.raccourci = '30';
    [reglages.debut, reglages.fin] = datesDuRaccourci(reglages.raccourci);
  }
  return { ...reglages, sav: null, ventes: null, attente: new Set(), seq: 0, detail: null, choix: null, moisVu: null };
})();

function garderReglagesStats() {
  const { raccourci, debut, fin, comparer, grain } = etatStats;
  try {
    localStorage.setItem('csav.stats', JSON.stringify({ raccourci, debut, fin, comparer, grain }));
  } catch {
    // Navigation privée : les réglages valent pour cette visite.
  }
}

function fuseauStats() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Paris';
  } catch {
    return 'Europe/Paris';
  }
}

/* ------------------------------------------------------------ relève --- */

async function loadStats() {
  // Une période « glissante » se recale sur aujourd'hui à chaque relève.
  if (etatStats.raccourci !== 'perso') [etatStats.debut, etatStats.fin] = datesDuRaccourci(etatStats.raccourci);
  const seq = ++etatStats.seq;
  const { debut, fin, comparer } = etatStats;
  const grain = grainEffectif(etatStats.grain, joursDe(debut, fin));
  const params = new URLSearchParams({ debut, fin, comparer, grain, tz: fuseauStats() });

  etatStats.attente = new Set(['sav', 'ventes']);
  rendreBarreStats();
  rendreStats();

  const arrivee = (cle) => (valeur) => {
    if (seq !== etatStats.seq) return;
    etatStats[cle] = valeur;
    etatStats.attente.delete(cle);
    rendreStats();
    if (etatStats.detail) rendreDetailStats();
  };
  await Promise.all([
    api(`/api/stats/periode/sav?${params}`).then(arrivee('sav'), () => arrivee('sav')(null)),
    api(`/api/stats/periode/ventes?${params}`).then(arrivee('ventes'), () => arrivee('ventes')(null)),
  ]);
}

/* ------------------------------------------------------------ barre ---- */

function grainsMarkup(jours, grain) {
  return GRAINS_STATS.map((g) => {
    const inactif = g.cle === 'heure' && jours > 7;
    return `<button type="button" data-grain="${g.cle}" aria-pressed="${g.cle === grain}"${
      inactif ? ' disabled title="Par heure : sur 7 jours au plus"' : ''
    }>${g.nom}</button>`;
  }).join('');
}

function rendreBarreStats() {
  const { raccourci, debut, fin, comparer } = etatStats;
  const jours = joursDe(debut, fin);
  const grain = grainEffectif(etatStats.grain, jours);
  $('sta-periode-nom').textContent =
    raccourci === 'perso' ? plageCourte(debut, fin) : PERIODES_STATS.find((p) => p.cle === raccourci).nom;
  $('sta-compare-nom').textContent = COMPARAISONS_STATS[comparer].nom;
  $('sta-compare').classList.toggle('sta-actif', comparer !== 'aucune');
  document.querySelectorAll('[data-grains]').forEach((zone) => {
    zone.innerHTML = grainsMarkup(jours, grain);
  });
  $('sta-menu-compare')
    .querySelectorAll('[data-compare]')
    .forEach((item) => item.setAttribute('aria-checked', String(item.dataset.compare === comparer)));

  const autre = periodeComparee(debut, fin, comparer);
  const face = autre ? plageEnLettres(...autre) : '';
  $('sta-sous').textContent =
    majuscule(plageEnLettres(debut, fin)) +
    (!autre ? '' : autre[0] === autre[1] ? ` · comparé au ${face.replace(/^le /, '')}` : ` · comparé à la période ${face}`);
}

/* ------------------------------------------------------------ cartes --- */

/** Les valeurs d'une mesure : la période, la comparaison, leurs séries et leurs points. */
function lireMesure(cle) {
  const mesure = MESURES_STATS[cle];
  const donnees = etatStats[mesure.source];
  if (!donnees) return null;
  const serie = cle === 'motifs' ? 'messages' : cle;
  return {
    mesure,
    devise: donnees.devise ?? 'EUR',
    periode: donnees.periode,
    total: mesure.total(donnees.courant.totaux),
    totalCompare: donnees.compare ? mesure.total(donnees.compare.totaux) : null,
    serie: donnees.courant.series[serie],
    serieCompare: donnees.compare?.series[serie] ?? null,
  };
}

function contexteEcart() {
  const autre = COMPARAISONS_STATS[etatStats.comparer];
  return autre.court ? `par rapport à ${autre.court}` : '';
}

function tuileMarkup(cle, sous, { courbe = false } = {}) {
  const lu = lireMesure(cle);
  const mesure = MESURES_STATS[cle];
  if (!lu) {
    return `<div class="sta-carte sta-tuile sta-tuile-vide" aria-hidden="true">
      <span class="sta-t">${esc(mesure.titre)}</span><span class="sta-v"><b>—</b></span>
      ${courbe ? '<span class="sta-spark"></span>' : ''}<span class="sta-s">&nbsp;</span>
    </div>`;
  }
  const n = lu.serie.length;
  const prec = lu.serieCompare ? lu.serieCompare.slice(0, n) : [];
  const max = Math.max(0, ...lu.serie.filter((v) => v !== null), ...prec.filter((v) => v !== null));
  return `<button type="button" class="sta-carte sta-tuile" data-ouvrir="${cle}" aria-haspopup="dialog">
    <span class="sta-t">${esc(mesure.titre)}</span>
    <span class="sta-v"><b>${esc(formatStat(lu.total, mesure.format, lu.devise))}</b>${ecartMarkup(
      ecartStat(lu.total, lu.totalCompare, mesure),
      contexteEcart(),
    )}</span>
    ${
      courbe
        ? `<svg class="sta-spark" viewBox="0 0 200 40" preserveAspectRatio="none" aria-hidden="true">
            ${prec.length ? `<path class="sta-trace-prec" d="${sparkline(prec, n, max)}" />` : ''}
            <path class="sta-trace-cour" d="${sparkline(lu.serie, n, max)}" />
          </svg>`
        : ''
    }
    <span class="sta-s">${esc(sous)}</span>
  </button>`;
}

const pluriel = (n, mot) => `${n.toLocaleString('fr-FR')} ${mot}${n > 1 ? 's' : ''}`;
function parJour(total, jours) {
  const moyenne = total / jours;
  return `${moyenne.toLocaleString('fr-FR', { maximumFractionDigits: moyenne < 10 ? 1 : 0 })} par jour en moyenne`;
}

function rendreStats() {
  const corps = $('sta-corps');
  if (!corps) return;
  const jours = joursDe(etatStats.debut, etatStats.fin);
  corps.classList.toggle('sta-attente-ventes', etatStats.attente.has('ventes') && Boolean(etatStats.ventes));
  corps.classList.toggle('sta-attente-sav', etatStats.attente.has('sav') && Boolean(etatStats.sav));

  /* Ventes */
  const ventes = etatStats.ventes;
  if (!ventes && !etatStats.attente.has('ventes')) {
    $('sta-ventes').innerHTML =
      '<p class="sta-panne">Shopify n’a pas répondu : les ventes reviendront avec lui. Le SAV, lui, est à jour.</p>';
    $('sta-ca').hidden = true;
  } else {
    const t = ventes?.courant.totaux;
    $('sta-ventes').innerHTML = [
      tuileMarkup('ca', t ? pluriel(t.commandes, 'commande') : '', { courbe: true }),
      tuileMarkup('commandes', t ? parJour(t.commandes, jours) : '', { courbe: true }),
      tuileMarkup('panier', 'par commande', { courbe: true }),
      tuileMarkup(
        'rembourse',
        t?.partRembourse != null
          ? `${(t.partRembourse * 100).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} % du chiffre d’affaires`
          : 'sur les commandes de la période',
        { courbe: true },
      ),
    ].join('');
    $('sta-ca').hidden = false;
    $('sta-ca').innerHTML = grapheCaMarkup();
  }

  /* SAV */
  const sav = etatStats.sav?.courant.totaux;
  $('sta-sav').innerHTML = [
    tuileMarkup('messages', sav ? parJour(sav.messages, jours) : ''),
    tuileMarkup(
      'premiereReponse',
      !sav
        ? ''
        : sav.premiereReponse.mesurees
          ? `médiane sur ${pluriel(sav.premiereReponse.mesurees, 'conversation')}, réponses de Gmail comprises`
          : 'aucune réponse partie sur la période',
    ),
    tuileMarkup('brouillons', sav ? `${sav.brouillons.utilises} sur ${sav.brouillons.total} suivis d’une réponse` : ''),
    tuileMarkup('aClasser', sav ? `${pluriel(sav.aClasser.n, 'message')} sans motif clair` : ''),
  ].join('');
  if (!etatStats.sav && !etatStats.attente.has('sav')) {
    $('sta-sav').insertAdjacentHTML('afterbegin', '<p class="sta-panne">Les chiffres du SAV n’ont pas pu être lus. Réessayez dans un instant.</p>');
  }
  $('sta-motifs').innerHTML = motifsMarkup();
  $('sta-equipe').innerHTML = equipeMarkup();
}

/* Le chiffre d'affaires, en ligne, face à la comparaison. */
function grapheCaMarkup() {
  const lu = lireMesure('ca');
  const grain = grainEffectif(etatStats.grain, joursDe(etatStats.debut, etatStats.fin));
  const nomGrain = GRAINS_STATS.find((g) => g.cle === (lu?.periode.grain ?? grain)).par;
  const comparer = etatStats.comparer;
  const tete = `<div class="sta-carte-tete">
      <h3 class="sta-carte-titre" id="sta-ca-titre">Chiffre d’affaires par ${nomGrain}</h3>
      <button type="button" class="sta-lien" data-ouvrir="ca" aria-haspopup="dialog">Ouvrir en grand</button>
      <span class="sta-ressort"></span>
      <span class="sta-legende">
        <span><i class="sta-l-cour"></i>${esc($('sta-periode-nom').textContent)}</span>
        ${comparer !== 'aucune' ? `<span><i class="sta-l-prec"></i>${esc(COMPARAISONS_STATS[comparer].colonne)}</span>` : ''}
      </span>
    </div>`;
  if (!lu) return `${tete}<div class="sta-trace sta-trace-vide"></div>`;

  const { cles } = lu.periode.courante;
  const n = cles.length;
  const prec = lu.serieCompare ? lu.serieCompare.slice(0, n) : null;
  const max = Math.max(0, ...lu.serie.filter((v) => v !== null), ...(prec ?? []).filter((v) => v !== null));
  const { haut, pas } = echelleStat(max);
  const x = (i) => (n === 1 ? 500 : (i / (n - 1)) * 1000);
  const y = (v) => 200 - (v / haut) * 200;
  // Un point seul — un seul jour, ou la première heure d'aujourd'hui — se
  // trace en petit trait : un « M » sans « L » ne dessinerait rien.
  const chemin = (serie) =>
    serie
      .map((v, i) => {
        if (v === null || v === undefined) return '';
        const seul = (serie[i - 1] ?? null) === null && (serie[i + 1] ?? null) === null;
        const debut = (serie[i - 1] ?? null) === null;
        if (seul) return `M${(x(i) - 6).toFixed(1)} ${y(v).toFixed(1)}L${(x(i) + 6).toFixed(1)} ${y(v).toFixed(1)}`;
        return `${debut ? 'M' : 'L'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`;
      })
      .join('');
  const presents = lu.serie.map((v, i) => [v, i]).filter(([v]) => v !== null);
  const aire = presents.length > 1
    ? `${chemin(lu.serie.slice(0, presents[presents.length - 1][1] + 1))}L${x(presents[presents.length - 1][1]).toFixed(1)} 200L${x(presents[0][1]).toFixed(1)} 200Z`
    : '';
  const graduations = Array.from({ length: Math.round(haut / pas) + 1 }, (_, i) => i * pas)
    .map((v) => `<span style="bottom:${((v / haut) * 100).toFixed(2)}%"><em>${esc(formatStat(v, 'argent', lu.devise, true))}</em></span>`)
    .join('');
  const axe = rangsEtiquetes(cles, lu.periode.grain)
    .map((i) => `<span style="left:${(x(i) / 10).toFixed(2)}%">${esc(etiquetteAxe(cles[i], lu.periode.grain, n))}</span>`)
    .join('');

  return `${tete}
    <div class="sta-trace" data-ouvrir="ca" data-n="${n}">
      <div class="sta-grille" aria-hidden="true">${graduations}</div>
      <svg viewBox="0 0 1000 200" preserveAspectRatio="none" aria-hidden="true">
        ${aire ? `<path class="sta-aire" d="${aire}" />` : ''}
        ${prec ? `<path class="sta-ligne-prec" d="${chemin(prec)}" />` : ''}
        <path class="sta-ligne" d="${chemin(lu.serie)}" />
      </svg>
      <span class="sta-repere" hidden></span>
      <div class="rmb-bulle sta-bulle" hidden></div>
    </div>
    <div class="sta-axe" aria-hidden="true">${axe}</div>
    <p class="sr-only">${esc(`Chiffre d’affaires : ${formatStat(lu.total, 'argent', lu.devise)} sur la période.`)} Ouvrez en grand pour le tableau des valeurs.</p>
    ${ventesTronquees()}`;
}

function ventesTronquees() {
  return etatStats.ventes?.tronque
    ? '<p class="sta-note">Période très chargée : seules les 3 000 premières commandes sont comptées. Raccourcissez la période pour un compte exact.</p>'
    : '';
}

const NOMBRES_EN_LETTRES = ['', '', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf', 'dix'];

/** Ce que la liste des motifs dit en une phrase. */
function constatMotifs(motifs, total) {
  if (!total) return 'Aucun message sur la période.';
  const part = (motifs.OTHER ?? 0) / total;
  if (part >= 0.5) return 'La plupart des messages n’ont pas de motif clair : ils sont « à classer ».';
  if (part >= 0.095) {
    const un = Math.round(1 / part);
    return `Un message sur ${NOMBRES_EN_LETTRES[un] ?? un} n’a pas de motif clair : ils sont « à classer ».`;
  }
  const [premier, n] = Object.entries(motifs).sort((a, b) => b[1] - a[1])[0];
  return `${MOTIFS_STATS[premier] ?? premier} en tête : ${Math.round((n / total) * 100)} % des messages.`;
}

function lignesMotifs() {
  const sav = etatStats.sav;
  if (!sav) return null;
  const motifs = sav.courant.motifs;
  const avant = sav.compare?.motifs ?? null;
  const cles = [...new Set([...Object.keys(motifs), ...Object.keys(avant ?? {})])].filter((c) => (motifs[c] ?? 0) > 0 || (avant?.[c] ?? 0) > 0);
  return cles
    .map((cle) => ({
      cle,
      nom: MOTIFS_STATS[cle] ?? INTENT_LABELS[cle] ?? cle,
      n: motifs[cle] ?? 0,
      avant: avant ? (avant[cle] ?? 0) : null,
      ecart: avant ? ecartStat(motifs[cle] ?? 0, avant[cle] ?? 0, { format: 'nombre', mieux: cle === 'POSITIVE' ? 1 : -1 }) : null,
    }))
    .sort((a, b) => b.n - a.n || (b.avant ?? 0) - (a.avant ?? 0));
}

function motifsMarkup() {
  const lignes = lignesMotifs();
  const court = COMPARAISONS_STATS[etatStats.comparer].court;
  const tete = `<div class="sta-carte-tete">
      <h3 class="sta-carte-titre" id="sta-motifs-titre">Motifs des demandes</h3>
      <button type="button" class="sta-lien" data-ouvrir="motifs" aria-haspopup="dialog">Ouvrir en grand</button>
      <span class="sta-ressort"></span>
      ${court ? `<span class="sta-aide">écart avec ${esc(court)}</span>` : ''}
    </div>`;
  if (!lignes) return `${tete}<p class="sta-constat">&nbsp;</p>`;
  const total = etatStats.sav.courant.totaux.messages;
  const plus = Math.max(1, ...lignes.map((l) => l.n));
  return `${tete}
    <p class="sta-constat">${esc(constatMotifs(etatStats.sav.courant.motifs, total))}</p>
    <div class="sta-motifs-liste" data-ouvrir="motifs">${
      lignes
        .map(
          (l) => `<div class="sta-motif${l.cle === 'OTHER' ? ' sta-motif-autre' : ''}">
            <span class="sta-motif-nom">${esc(l.nom)}</span>
            <span class="sta-piste"><i style="width:${((l.n / plus) * 100).toFixed(1)}%"></i></span>
            <b>${l.n.toLocaleString('fr-FR')}</b>
            <span class="sta-motif-ecart">${ecartMarkup(l.ecart, contexteEcart())}</span>
          </div>`,
        )
        .join('') || '<p class="sta-vide">Aucun message sur la période.</p>'
    }</div>`;
}

function equipeMarkup() {
  const equipe = etatStats.sav?.equipe;
  if (!equipe) return '';
  const actifs = equipe.filter((m) => m.active || m.replies || m.refunds || m.escalations);
  if (actifs.length === 0) return '<p class="sta-vide">Aucune activité sur la période.</p>';
  const initiales = (nom) =>
    String(nom)
      .split(/[\s@.]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((mot) => mot.charAt(0).toUpperCase())
      .join('');
  return `<div class="sta-eq sta-eq-tete"><span>Personne</span><span>Réponses</span><span title="Remboursements">Rembours.</span><span>Escalades</span></div>
    ${actifs
      .map(
        (m) => `<div class="sta-eq${m.active ? '' : ' sta-eq-inactif'}">
          <span class="sta-eq-nom"><i aria-hidden="true">${esc(initiales(m.name))}</i><span><b>${esc(m.name)}</b><small>${esc(
            ROLE_LABELS[m.role] ?? m.role,
          )}</small></span></span>
          <span>${m.replies}</span><span>${m.refunds}</span><span>${m.escalations}</span>
        </div>`,
      )
      .join('')}`;
}

/* Survol du graphique : un repère, la valeur du point et celle d'en face. */
function survolCa(event) {
  const trace = event.target.closest('.sta-trace');
  const lu = trace && lireMesure('ca');
  if (!lu || event.pointerType === 'touch') return;
  const { cles } = lu.periode.courante;
  const n = cles.length;
  const boite = trace.getBoundingClientRect();
  const i = n === 1 ? 0 : Math.max(0, Math.min(n - 1, Math.round(((event.clientX - boite.left) / boite.width) * (n - 1))));
  const gauche = n === 1 ? boite.width / 2 : (i / (n - 1)) * boite.width;
  const repere = trace.querySelector('.sta-repere');
  const bulle = trace.querySelector('.sta-bulle');
  repere.hidden = false;
  repere.style.left = `${gauche}px`;
  const comparees = lu.periode.comparee?.cles;
  const prec = lu.serieCompare?.[i];
  bulle.innerHTML = `<b>${esc(formatStat(lu.serie[i], 'argent', lu.devise))}</b><span>${esc(etiquettePoint(cles[i], lu.periode.grain, true))}</span>${
    comparees?.[i] !== undefined
      ? `<span class="sta-bulle-prec">${esc(formatStat(prec, 'argent', lu.devise))} · ${esc(etiquettePoint(comparees[i], lu.periode.grain, true))}</span>`
      : ''
  }`;
  bulle.hidden = false;
  const largeur = bulle.offsetWidth;
  bulle.style.left = `${Math.max(0, Math.min(boite.width - largeur, gauche - largeur / 2))}px`;
  bulle.style.top = '4px';
}

function finSurvolCa() {
  document.querySelectorAll('#sta-ca .sta-repere, #sta-ca .sta-bulle').forEach((el) => {
    el.hidden = true;
  });
}

/* ------------------------------------------------------------ en grand - */

let retourDetailStats = null;
let carteDetailStats = null;

function ouvrirDetailStats(cle) {
  if (!MESURES_STATS[cle]) return;
  etatStats.detail = cle;
  retourDetailStats = document.activeElement;
  carteDetailStats = cle;
  fermerChoixPeriode(false);
  fermerMenuCompare();
  $('sta-detail').hidden = false;
  document.documentElement.classList.add('sta-fige');
  rendreDetailStats();
  $('sta-detail').querySelector('.sta-detail-fenetre').focus();
}

function fermerDetailStats() {
  if ($('sta-detail').hidden) return;
  $('sta-detail').hidden = true;
  document.documentElement.classList.remove('sta-fige');
  etatStats.detail = null;
  // La carte a pu être redessinée entre-temps (autre regroupement) : on
  // rend le focus à celle qui porte la même mesure.
  const retour = retourDetailStats?.isConnected
    ? retourDetailStats
    : document.querySelector(`#view-stats [data-ouvrir="${carteDetailStats}"]`);
  retour?.focus();
  retourDetailStats = carteDetailStats = null;
}

function rendreDetailStats() {
  const cle = etatStats.detail;
  if (!cle) return;
  const mesure = MESURES_STATS[cle];
  const lu = lireMesure(cle);
  const autre = periodeComparee(etatStats.debut, etatStats.fin, etatStats.comparer);
  $('sta-detail-titre').textContent = mesure.titre;
  $('sta-detail-sous').textContent =
    majuscule(plageEnLettres(etatStats.debut, etatStats.fin)) +
    (autre ? ` · comparé à ${COMPARAISONS_STATS[etatStats.comparer].court}` : '');
  $('sta-detail').querySelector('[data-grains]').hidden = cle === 'motifs';
  const corps = $('sta-detail-corps');
  if (!lu) {
    corps.innerHTML = etatStats.attente.has(mesure.source)
      ? '<p class="sta-vide">Chargement…</p>'
      : `<p class="sta-vide">${mesure.source === 'ventes' ? 'Shopify n’a pas répondu : réessayez dans un instant.' : 'Les chiffres du SAV n’ont pas pu être lus.'}</p>`;
    return;
  }
  corps.classList.toggle('sta-charge', etatStats.attente.has(mesure.source));
  const ecart = ecartStat(lu.total, lu.totalCompare, mesure);
  const tete = `<div class="sta-detail-valeur">
      <b>${esc(formatStat(lu.total, mesure.format, lu.devise))}</b>
      ${ecart ? `<span class="sta-delta sta-${ecart.ton}">${esc(ecart.texte)} ${esc(contexteEcart())}</span>` : ''}
    </div>`;
  // Au téléphone, la valeur et le graphique forment une carte, le tableau une autre.
  const [graphe, tableau] = cle === 'motifs' ? detailMotifsMarkup() : detailSerieMarkup(lu);
  corps.innerHTML = `<div class="sta-detail-carte">${tete}${graphe}</div>${tableau}${mesure.source === 'ventes' ? ventesTronquees() : ''}`;
}

function legendeMarkup() {
  const colonne = COMPARAISONS_STATS[etatStats.comparer].colonne;
  return `<div class="sta-legende">
    <span><i class="sta-l-cour sta-l-barre"></i>${esc($('sta-periode-nom').textContent)}</span>
    ${colonne ? `<span><i class="sta-l-prec sta-l-barre"></i>${esc(colonne)}</span>` : ''}
  </div>`;
}

function detailSerieMarkup(lu) {
  const { mesure, devise } = lu;
  const { cles, grain } = { cles: lu.periode.courante.cles, grain: lu.periode.grain };
  const comparees = lu.periode.comparee?.cles ?? null;
  const n = cles.length;
  const prec = lu.serieCompare ? lu.serieCompare.slice(0, n) : null;
  const max = Math.max(0, ...lu.serie.filter((v) => v !== null), ...(prec ?? []).filter((v) => v !== null));
  const { haut } = echelleStat(mesure.format === 'part' ? Math.min(1, max) : max);
  const h = (v) => (v === null || v === undefined ? 0 : Math.max(v > 0 ? 1 : 0, (v / haut) * 100));
  const colonnes = cles
    .map((cle, i) => {
      const label = JSON.stringify([
        formatStat(lu.serie[i], mesure.format, devise),
        etiquettePoint(cle, grain, true),
        prec && comparees?.[i] ? `${formatStat(prec[i], mesure.format, devise)} · ${etiquettePoint(comparees[i], grain, true)}` : '',
      ]);
      return `<span class="sta-col" data-i="${i}" data-bulle="${esc(label)}">
        ${prec ? `<i class="sta-b-prec" style="height:${h(prec[i]).toFixed(2)}%"></i>` : ''}
        <i class="sta-b-cour" style="height:${h(lu.serie[i]).toFixed(2)}%"></i>
      </span>`;
    })
    .join('');
  const graduations = [0, 0.5, 1]
    .map((f) => `<span style="bottom:${f * 100}%"><em>${esc(formatStat(haut * f, mesure.format, devise, true))}</em></span>`)
    .join('');
  const axe = rangsEtiquetes(cles, grain)
    .map((i) => `<span style="left:${(((i + 0.5) / n) * 100).toFixed(2)}%">${esc(etiquetteAxe(cles[i], grain, n))}</span>`)
    .join('');
  const nomGrain = GRAINS_STATS.find((g) => g.cle === grain).nom;
  const colonne = COMPARAISONS_STATS[etatStats.comparer].colonne;
  const lignes = cles
    .map((cle, i) => {
      const ecart = prec ? ecartStat(lu.serie[i], prec[i], mesure) : null;
      return `<tr>
        <th scope="row">${esc(etiquettePoint(cle, grain, true))}</th>
        <td>${esc(formatStat(lu.serie[i], mesure.format, devise))}</td>
        ${colonne ? `<td class="sta-td-prec">${esc(formatStat(prec?.[i], mesure.format, devise))}</td><td>${ecart ? `<span class="sta-delta sta-${ecart.ton}">${esc(ecart.texte)}</span>` : '—'}</td>` : ''}
      </tr>`;
    })
    .reverse()
    .join('');
  return [
    `${legendeMarkup()}
    <div class="sta-barres-zone" style="--n:${n}">
      <div class="sta-grille" aria-hidden="true">${graduations}</div>
      <div class="sta-barres${n > 60 ? ' sta-barres-denses' : ''}" aria-hidden="true">${colonnes}</div>
      <div class="rmb-bulle sta-bulle" hidden></div>
    </div>
    <div class="sta-axe sta-axe-barres" aria-hidden="true">${axe}</div>`,
    `<h3 class="sta-table-titre">Par ${esc(nomGrain.toLowerCase())}</h3>
    <div class="sta-table-zone">
      <table class="sta-table">
        <thead><tr><th scope="col">${esc(nomGrain)}</th><th scope="col">${esc($('sta-periode-nom').textContent)}</th>${
          colonne ? `<th scope="col" class="sta-td-prec">${esc(colonne)}</th><th scope="col">Écart</th>` : ''
        }</tr></thead>
        <tbody>${lignes}</tbody>
      </table>
    </div>`,
  ];
}

function detailMotifsMarkup() {
  const lignes = lignesMotifs() ?? [];
  const plus = Math.max(1, ...lignes.map((l) => Math.max(l.n, l.avant ?? 0)));
  const colonne = COMPARAISONS_STATS[etatStats.comparer].colonne;
  return [
    `${legendeMarkup()}
    <div class="sta-hbarres">${lignes
      .map(
        (l) => `<div class="sta-hbarre${l.cle === 'OTHER' ? ' sta-motif-autre' : ''}">
          <span class="sta-motif-nom">${esc(l.nom)}</span>
          <span class="sta-hpistes">
            <i class="sta-b-cour" style="width:${((l.n / plus) * 100).toFixed(1)}%"></i>
            ${l.avant !== null ? `<i class="sta-b-prec" style="width:${((l.avant / plus) * 100).toFixed(1)}%"></i>` : ''}
          </span>
          <b>${l.n.toLocaleString('fr-FR')}</b>
        </div>`,
      )
      .join('')}</div>`,
    `<h3 class="sta-table-titre">Par motif</h3>
    <div class="sta-table-zone">
      <table class="sta-table">
        <thead><tr><th scope="col">Motif</th><th scope="col">${esc($('sta-periode-nom').textContent)}</th>${
          colonne ? `<th scope="col" class="sta-td-prec">${esc(colonne)}</th><th scope="col">Écart</th>` : ''
        }</tr></thead>
        <tbody>${lignes
          .map(
            (l) => `<tr><th scope="row">${esc(l.nom)}</th><td>${l.n.toLocaleString('fr-FR')}</td>${
              colonne
                ? `<td class="sta-td-prec">${(l.avant ?? 0).toLocaleString('fr-FR')}</td><td>${
                    l.ecart ? `<span class="sta-delta sta-${l.ecart.ton}">${esc(l.ecart.texte)}</span>` : '—'
                  }</td>`
                : ''
            }</tr>`,
          )
          .join('')}</tbody>
      </table>
    </div>`,
  ];
}

/* ------------------------------------------------------------ période -- */

function ouvrirChoixPeriode() {
  fermerMenuCompare();
  const { raccourci, debut, fin } = etatStats;
  etatStats.choix = { raccourci, debut, fin, ancre: null, note: '' };
  etatStats.moisVu = fin.slice(0, 7);
  // Au téléphone, la feuille monte au-dessus de tout : elle quitte la barre,
  // dont l'empilement la garderait sous le voile.
  if (STATS_PLEIN_ECRAN.matches) document.body.append($('sta-choix'));
  else document.querySelector('#view-stats .sta-barre').append($('sta-choix'));
  $('sta-choix').hidden = false;
  $('sta-voile').hidden = false;
  $('sta-periode').setAttribute('aria-expanded', 'true');
  rendreChoixPeriode();
  ($('sta-raccourcis').querySelector('[aria-pressed="true"]') ?? $('sta-raccourcis').querySelector('button'))?.focus();
}

function fermerChoixPeriode(rendreLeFocus = true) {
  if ($('sta-choix').hidden) return;
  $('sta-choix').hidden = true;
  $('sta-voile').hidden = true;
  $('sta-periode').setAttribute('aria-expanded', 'false');
  etatStats.choix = null;
  if (rendreLeFocus) $('sta-periode').focus();
}

function appliquerPeriode() {
  const choix = etatStats.choix;
  if (!choix) return;
  const change = choix.debut !== etatStats.debut || choix.fin !== etatStats.fin || choix.raccourci !== etatStats.raccourci;
  Object.assign(etatStats, { raccourci: choix.raccourci, debut: choix.debut, fin: choix.fin });
  // Une autre période, un autre regroupement par défaut : un an se lit au mois.
  if (change) etatStats.grain = null;
  garderReglagesStats();
  fermerChoixPeriode();
  if (change) loadStats();
}

const COCHE_STATS =
  '<svg class="sta-coche" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" /></svg>';

function moisDecale(mois, n) {
  const [a, m] = mois.split('-').map(Number);
  const d = new Date(Date.UTC(a, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}

function moisMarkup(mois) {
  const choix = etatStats.choix;
  const auj = dateLocale();
  const premier = jourDe(`${mois}-01`);
  const decalage = (premier.getUTCDay() + 6) % 7;
  const nbJours = new Date(Date.UTC(premier.getUTCFullYear(), premier.getUTCMonth() + 1, 0)).getUTCDate();
  const cases = Array.from({ length: decalage }, () => '<span></span>');
  for (let j = 1; j <= nbJours; j += 1) {
    const date = `${mois}-${String(j).padStart(2, '0')}`;
    const classes = [
      date === choix.debut ? 'sta-j-debut' : '',
      date === choix.fin ? 'sta-j-fin' : '',
      date > choix.debut && date < choix.fin ? 'sta-j-dans' : '',
      date === auj ? 'sta-j-auj' : '',
    ].filter(Boolean);
    cases.push(`<button type="button" class="sta-jour ${classes.join(' ')}" data-date="${date}"${date > auj ? ' disabled' : ''}
      aria-pressed="${date >= choix.debut && date <= choix.fin}" aria-label="${esc(`${quantieme(jourDe(date))} ${moisLong(jourDe(date))} ${mois.slice(0, 4)}`)}">${j}</button>`);
  }
  const nom = premier.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  return `<div class="sta-mois-un">
    <b>${esc(majuscule(nom))}</b>
    <div class="sta-semaine" aria-hidden="true"><span>L</span><span>M</span><span>M</span><span>J</span><span>V</span><span>S</span><span>D</span></div>
    <div class="sta-jours">${cases.join('')}</div>
  </div>`;
}

function rendreChoixPeriode() {
  const choix = etatStats.choix;
  if (!choix) return;
  $('sta-raccourcis').innerHTML = PERIODES_STATS.map(
    (p) => `<button type="button" data-raccourci="${p.cle}" aria-pressed="${p.cle === choix.raccourci}">
      <span>${esc(p.nom)}</span>${p.cle === choix.raccourci ? COCHE_STATS : ''}
    </button>`,
  ).join('');
  $('sta-debut').value = choix.debut;
  $('sta-fin').value = choix.fin;
  $('sta-debut').max = $('sta-fin').max = dateLocale();
  const vu = etatStats.moisVu;
  $('sta-mois').innerHTML = moisMarkup(moisDecale(vu, -1)) + moisMarkup(vu);
  $('sta-mois-suiv').disabled = vu >= dateLocale().slice(0, 7);
  $('sta-cal-note').textContent = choix.note;
  $('sta-choix').classList.toggle('sta-choix-perso', choix.raccourci === 'perso');
}

/** Deux dates dans l'ordre, un an au plus, pas après aujourd'hui. */
function poserDates(debut, fin) {
  const choix = etatStats.choix;
  const auj = dateLocale();
  let [d, f] = debut <= fin ? [debut, fin] : [fin, debut];
  if (f > auj) f = auj;
  if (d > f) d = f;
  choix.note = '';
  if (joursDe(d, f) > JOURS_MAX_STATS) {
    d = decalerDate(f, -(JOURS_MAX_STATS - 1));
    choix.note = 'Un an au plus : le début a été avancé.';
  }
  choix.debut = d;
  choix.fin = f;
  choix.raccourci = 'perso';
}

/* ------------------------------------------------------------ comparer - */

function ouvrirMenuCompare() {
  fermerChoixPeriode(false);
  $('sta-menu-compare').style.left = `${$('sta-compare').offsetLeft}px`;
  $('sta-menu-compare').hidden = false;
  $('sta-compare').setAttribute('aria-expanded', 'true');
  ($('sta-menu-compare').querySelector('[aria-checked="true"]') ?? $('sta-menu-compare').querySelector('button')).focus();
}

function fermerMenuCompare(rendreLeFocus = false) {
  if ($('sta-menu-compare').hidden) return;
  $('sta-menu-compare').hidden = true;
  $('sta-compare').setAttribute('aria-expanded', 'false');
  if (rendreLeFocus) $('sta-compare').focus();
}

/* ------------------------------------------------------------ écouteurs  */

$('sta-periode').addEventListener('click', (event) => {
  event.stopPropagation();
  if ($('sta-choix').hidden) ouvrirChoixPeriode();
  else fermerChoixPeriode();
});
$('sta-compare').addEventListener('click', (event) => {
  event.stopPropagation();
  if ($('sta-menu-compare').hidden) ouvrirMenuCompare();
  else fermerMenuCompare(true);
});
$('sta-menu-compare').addEventListener('click', (event) => {
  const item = event.target.closest('[data-compare]');
  if (!item) return;
  fermerMenuCompare(true);
  if (item.dataset.compare === etatStats.comparer) return;
  etatStats.comparer = item.dataset.compare;
  garderReglagesStats();
  loadStats();
});
$('sta-menu-compare').addEventListener('keydown', (event) => {
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
  event.preventDefault();
  const items = [...$('sta-menu-compare').querySelectorAll('button')];
  const i = items.indexOf(document.activeElement);
  items[(i + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length].focus();
});

$('sta-choix').addEventListener('click', (event) => {
  event.stopPropagation();
  const choix = etatStats.choix;
  if (!choix) return;
  const raccourci = event.target.closest('[data-raccourci]');
  if (raccourci) {
    choix.raccourci = raccourci.dataset.raccourci;
    choix.ancre = null;
    choix.note = '';
    if (choix.raccourci !== 'perso') [choix.debut, choix.fin] = datesDuRaccourci(choix.raccourci);
    etatStats.moisVu = choix.fin.slice(0, 7);
    rendreChoixPeriode();
    $('sta-raccourcis').querySelector(`[data-raccourci="${choix.raccourci}"]`)?.focus();
    return;
  }
  const jour = event.target.closest('[data-date]');
  if (jour) {
    // Premier clic : un seul jour ; second clic : la période entre les deux.
    if (choix.ancre) {
      poserDates(choix.ancre, jour.dataset.date);
      choix.ancre = null;
    } else {
      poserDates(jour.dataset.date, jour.dataset.date);
      choix.ancre = jour.dataset.date;
    }
    rendreChoixPeriode();
    $('sta-mois').querySelector(`[data-date="${jour.dataset.date}"]`)?.focus();
    return;
  }
  if (event.target.closest('#sta-mois-prec')) {
    etatStats.moisVu = moisDecale(etatStats.moisVu, -1);
    rendreChoixPeriode();
  } else if (event.target.closest('#sta-mois-suiv')) {
    etatStats.moisVu = moisDecale(etatStats.moisVu, 1);
    rendreChoixPeriode();
  } else if (event.target.closest('[data-periode-appliquer]')) appliquerPeriode();
  else if (event.target.closest('[data-periode-annuler]')) fermerChoixPeriode();
});
['sta-debut', 'sta-fin'].forEach((id) => {
  $(id).addEventListener('change', () => {
    const choix = etatStats.choix;
    if (!choix || !$('sta-debut').value || !$('sta-fin').value) return;
    poserDates($('sta-debut').value, $('sta-fin').value);
    choix.ancre = null;
    etatStats.moisVu = choix.fin.slice(0, 7);
    rendreChoixPeriode();
  });
});
$('sta-voile').addEventListener('click', () => fermerChoixPeriode(false));

// Le regroupement, depuis la barre comme depuis la carte ouverte en grand.
document.addEventListener('click', (event) => {
  const bouton = event.target.closest('[data-grains] [data-grain]');
  if (bouton && !bouton.disabled) {
    if (bouton.getAttribute('aria-pressed') === 'true') return;
    etatStats.grain = bouton.dataset.grain;
    garderReglagesStats();
    // Les boutons sont redessinés aussitôt : le focus revient sur le même.
    const zone = bouton.closest('#sta-detail') ?? $('view-stats');
    loadStats();
    zone.querySelector(`[data-grains] [data-grain="${etatStats.grain}"]`)?.focus();
    return;
  }
  // Un clic ailleurs referme la période et le menu, comme un menu du Mac.
  if (!event.target.closest('#sta-choix, #sta-periode')) fermerChoixPeriode(false);
  if (!event.target.closest('#sta-menu-compare, #sta-compare')) fermerMenuCompare();
});

$('view-stats').addEventListener('click', (event) => {
  const cible = event.target.closest('[data-ouvrir]');
  if (cible) ouvrirDetailStats(cible.dataset.ouvrir);
});
$('view-stats').addEventListener('pointermove', (event) => {
  if (event.target.closest('#sta-ca .sta-trace')) survolCa(event);
  else finSurvolCa();
});
$('view-stats').addEventListener('pointerleave', finSurvolCa);

/* Survol d'une barre ouverte en grand : sa valeur et celle d'en face. */
$('sta-detail').addEventListener('pointerover', (event) => {
  const col = event.target.closest('.sta-col');
  const zone = col?.closest('.sta-barres-zone');
  const bulle = zone?.querySelector('.sta-bulle');
  if (!col || !bulle || event.pointerType === 'touch') return;
  zone.querySelectorAll('.sta-col.on').forEach((autre) => autre.classList.remove('on'));
  col.classList.add('on');
  const [valeur, quand, face] = JSON.parse(col.dataset.bulle);
  bulle.innerHTML = `<b>${esc(valeur)}</b><span>${esc(quand)}</span>${face ? `<span class="sta-bulle-prec">${esc(face)}</span>` : ''}`;
  bulle.hidden = false;
  const boite = zone.getBoundingClientRect();
  const c = col.getBoundingClientRect();
  const centre = c.left - boite.left + c.width / 2;
  bulle.style.left = `${Math.max(0, Math.min(boite.width - bulle.offsetWidth, centre - bulle.offsetWidth / 2))}px`;
  bulle.style.top = '4px';
});
$('sta-detail').addEventListener('pointerout', (event) => {
  const zone = event.target.closest('.sta-barres-zone');
  if (!zone || zone.contains(event.relatedTarget)) return;
  zone.querySelectorAll('.sta-col.on').forEach((col) => col.classList.remove('on'));
  zone.querySelector('.sta-bulle').hidden = true;
});

$('sta-detail').addEventListener('click', (event) => {
  if (event.target.closest('[data-detail-fermer]')) fermerDetailStats();
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    if (!$('sta-detail').hidden) {
      event.preventDefault();
      fermerDetailStats();
    } else if (!$('sta-choix').hidden) {
      event.preventDefault();
      fermerChoixPeriode();
    } else if (!$('sta-menu-compare').hidden) {
      event.preventDefault();
      fermerMenuCompare(true);
    }
    return;
  }
  // La carte ouverte en grand garde le focus pour elle, comme une fenêtre.
  if (event.key === 'Tab' && !$('sta-detail').hidden) {
    const fenetre = $('sta-detail').querySelector('.sta-detail-fenetre');
    const focusables = [...fenetre.querySelectorAll('button:not([disabled]), [tabindex="0"]')].filter((el) => el.offsetParent !== null);
    if (focusables.length === 0) return;
    const premier = focusables[0];
    const dernier = focusables[focusables.length - 1];
    if (event.shiftKey && (document.activeElement === premier || document.activeElement === fenetre)) {
      event.preventDefault();
      dernier.focus();
    } else if (!event.shiftKey && document.activeElement === dernier) {
      event.preventDefault();
      premier.focus();
    }
  }
});

/* --------------------------------------------------------- coûts du SAV -- */

/*
 * Ce que coûte le SAV, mois par mois.
 *
 * Trois postes, une couleur chacun, dans un ordre fixe : la couleur suit le
 * poste, jamais son rang. Les teintes sont validées contre la surface des
 * cartes, en clair comme en sombre (voir `.cg-s1` dans la feuille). Le vert
 * d'eau des paires perdues ne tient que 2,8:1 sur le blanc : la légende,
 * l'infobulle et la vue en tableau portent chaque valeur sans lui.
 *
 * Copie de `CLES_COUTS` (src/services/couts/calcul.ts), comparée par les tests.
 */
const CLES_COUTS = ['bonRetour', 'fraisAgence', 'colisAgence', 'colisAtelier', 'prixPaire'];
const POSTES_COUTS = [
  { cle: 'retours', nom: 'Retours' },
  { cle: 'renvois', nom: 'Renvois et échanges' },
  { cle: 'perdues', nom: 'Paires perdues' },
];
/** Hauteur du tracé, en pixels : les barres se calculent au pixel près. */
const HAUTEUR_COUTS = 200;

const couts = { donnees: null, commandes: undefined, choisi: null, vue: 'graphe' };

/** Les montants arrivent en centimes. */
function euros(centimes, rond = false) {
  return new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: rond ? 0 : 2,
    maximumFractionDigits: rond ? 0 : 2,
  }).format(centimes / 100);
}

const nombreDe = (n, un, plusieurs) => `${n} ${n > 1 ? plusieurs : un}`;

/** « 2026-10 » → « octobre 2026 », « oct. » ou « O ». */
function nomDuMois(mois, forme = 'long') {
  const [annee, numero] = mois.split('-').map(Number);
  // Le 15 à midi UTC : aucun fuseau ne fait basculer le mois.
  const date = new Date(Date.UTC(annee, numero - 1, 15, 12));
  const options =
    forme === 'court' ? { month: 'short' } : forme === 'initiale' ? { month: 'narrow' } : { month: 'long', year: 'numeric' };
  return date.toLocaleDateString('fr-FR', { ...options, timeZone: 'UTC' });
}

/** Des graduations rondes au-dessus du pic : 1 240 € donne 0, 500, 1 000, 1 500. */
function graduationsCouts(pic) {
  const brut = pic / 4;
  const puissance = 10 ** Math.floor(Math.log10(brut));
  const pas = [1, 2, 2.5, 5, 10].map((p) => p * puissance).find((p) => p >= brut);
  const haut = Math.ceil(pic / pas) * pas;
  return Array.from({ length: Math.round(haut / pas) + 1 }, (_, i) => i * pas);
}

const moisAffiches = () => couts.donnees.mois.slice(1);
const moisChoisi = () => couts.donnees.mois.find((m) => m.mois === couts.choisi);

async function loadCouts() {
  const cadre = $('couts-graphe');
  // La relecture garde le graphe en place, estompé : ni squelette, ni saut.
  cadre.classList.add('cg-relit');
  try {
    couts.donnees = await api('/api/couts');
    if (!couts.donnees.mois.slice(1).some((m) => m.mois === couts.choisi)) couts.choisi = couts.donnees.courant;
    renderCouts();
  } catch (error) {
    cadre.innerHTML = `<p class="empty">${esc(error.message)}</p>`;
  } finally {
    cadre.classList.remove('cg-relit');
  }

  // Shopify à part : lent ou en panne, il ne retient pas l'écran.
  api('/api/couts/commandes')
    .then((reponse) => {
      couts.commandes = reponse.commandes;
    })
    .catch(() => {
      couts.commandes = null;
    })
    .finally(() => couts.donnees && renderCoutsTuiles());
}

function renderCouts() {
  const affiches = moisAffiches();
  const rang = affiches.findIndex((m) => m.mois === couts.choisi);
  $('couts-mois-nom').textContent = nomDuMois(couts.choisi);
  $('couts-prec').disabled = rang <= 0;
  $('couts-suiv').disabled = rang >= affiches.length - 1;
  $('couts-reglages').hidden = !canI('configure');

  const avis = $('couts-vide');
  avis.hidden = couts.donnees.renseignes;
  if (!couts.donnees.renseignes) {
    avis.innerHTML = canI('configure')
      ? `<span><b>Renseignez vos coûts unitaires.</b> L’écran compte déjà chaque geste du SAV ; il lui manque ce que chacun vous coûte pour le chiffrer.</span>
         <button class="btn btn-small" type="button" id="couts-vide-ouvrir">Renseigner</button>`
      : '<span><b>Les coûts unitaires ne sont pas encore renseignés.</b> Le propriétaire ou un superviseur peut les saisir ; d’ici là, l’écran compte les gestes sans les chiffrer.</span>';
    $('couts-vide-ouvrir')?.addEventListener('click', ouvrirCoutsUnitaires);
  }

  renderCoutsTuiles();
  renderCoutsGraphe();
  renderCoutsDetail();
  renderCoutsMotifs();
}

function renderCoutsTuiles() {
  const tous = couts.donnees.mois;
  const rang = tous.findIndex((m) => m.mois === couts.choisi);
  const { mois, montants: m, volumes: v } = tous[rang];
  const avant = rang > 0 ? tous[rang - 1] : null;
  const enCours = mois === couts.donnees.courant;

  // L'écart ne se lit qu'entre deux mois complets : comparé à un mois entier,
  // le mois en cours baisse toujours.
  let delta = null;
  if (!enCours && avant && avant.montants.total > 0) {
    const pct = Math.round(((m.total - avant.montants.total) / avant.montants.total) * 100);
    delta = {
      texte: `${pct > 0 ? '↑' : pct < 0 ? '↓' : '='} ${Math.abs(pct)} %`,
      // Un coût qui monte est une mauvaise nouvelle.
      ton: pct > 0 ? 'bad' : pct < 0 ? 'ok' : '',
      vs: nomDuMois(avant.mois, 'court'),
    };
  }

  // Sans coûts unitaires, un montant serait un zéro trompeur : un tiret, et
  // les gestes comptés dans la note.
  const argent = (centimes) => (couts.donnees.renseignes ? euros(centimes) : '—');
  const commandes = couts.commandes?.[mois];
  const parCommande =
    commandes > 0
      ? {
          valeur: argent(Math.round(m.total / commandes)),
          note: `${nombreDe(commandes, 'commande', 'commandes')} · ${String(((v.retours / commandes) * 100).toFixed(1)).replace('.', ',')} % de retours`,
        }
      : {
          valeur: '—',
          note:
            couts.commandes === undefined
              ? 'Shopify en cours de lecture…'
              : couts.commandes === null
                ? 'Shopify n’a pas répondu'
                : 'Shopify ne montre que les 60 derniers jours',
        };

  /*
   * Le mois en un coup d'œil, à la manière d'un résumé du Mac : le coût en
   * grand, sa composition en une barre, chaque poste dessous ; à côté, ce qui
   * le relativise — le net après réemploi, le coût par commande. Six cartes au
   * même rang obligeaient à lire les six pour trouver le total.
   */
  const postes = [
    {
      n: 1,
      nom: 'Retours',
      valeur: m.retours,
      note: `${nombreDe(v.bons, 'bon', 'bons')} · ${nombreDe(v.recues, 'paire reçue', 'paires reçues')}`,
    },
    {
      n: 2,
      nom: 'Renvois et échanges',
      valeur: m.renvois,
      note: `${nombreDe(v.colisAgence + v.colisAtelier, 'colis', 'colis')} · ${nombreDe(v.echangesAtelier, 'paire neuve', 'paires neuves')}`,
    },
    {
      n: 3,
      nom: 'Paires perdues',
      valeur: m.perdues,
      note: nombreDe(v.perdues, 'paire inutilisable', 'paires inutilisables'),
    },
  ];
  // La barre ne se dessine que sur un total chiffré : sans coûts unitaires,
  // trois segments à zéro ne diraient rien.
  const barre =
    couts.donnees.renseignes && m.total > 0
      ? `<div class="ch-barre" aria-hidden="true">${postes
          .map((poste) => `<i class="cg-s${poste.n}" style="width:${((poste.valeur / m.total) * 100).toFixed(1)}%"></i>`)
          .join('')}</div>`
      : '';
  const ecart = enCours
    ? '<span class="ch-ecart">Mois en cours : les chiffres bougent encore.</span>'
    : delta
      ? `<span class="ch-ecart${delta.ton ? ` kd-${delta.ton}` : ''}">${esc(delta.texte)} par rapport à ${esc(
          nomDuMois(avant.mois).split(' ')[0],
        )}</span>`
      : '';

  $('couts-tuiles').innerHTML = `<div class="ch-principal">
      <span class="ch-titre">Coût du SAV en ${esc(nomDuMois(mois))} · ${esc(
        nombreDe(v.retours, 'retour demandé', 'retours demandés'),
      )}</span>
      <div class="ch-chiffre"><span class="ch-total">${esc(argent(m.total))}</span>${ecart}</div>
      ${barre}
      <ul class="ch-postes">${postes
        .map(
          (poste) => `<li>
            <span class="ch-nom"><span class="cg-cle cg-s${poste.n}" aria-hidden="true"></span>${esc(poste.nom)}</span>
            <b>${esc(argent(poste.valeur))}</b>
            <span class="ch-note">${esc(poste.note)}</span>
          </li>`,
        )
        .join('')}</ul>
    </div>
    <div class="ch-cote">
      <div class="ch-stat">
        <span class="ch-nom">Net, après réemploi</span>
        <b>${esc(argent(m.net))}</b>
        <span class="ch-note">${
          couts.donnees.renseignes ? `${esc(euros(m.economie))} économisés · ` : ''
        }${esc(nombreDe(v.reemployees, 'paire réemployée', 'paires réemployées'))}</span>
      </div>
      <div class="ch-stat">
        <span class="ch-nom">Coût par commande</span>
        <b>${esc(parCommande.valeur)}</b>
        <span class="ch-note">${esc(parCommande.note)}</span>
      </div>
    </div>`;
}

function renderCoutsGraphe() {
  // Les colonnes vont être remplacées : une infobulle restée ouverte
  // désignerait une colonne qui n'existe plus.
  cacherBulleCouts();
  const affiches = moisAffiches();
  const cadre = $('couts-graphe');
  const total12 = affiches.reduce((somme, m) => somme + m.montants.total, 0);
  $('couts-annee').textContent = total12 > 0 ? `${euros(total12, true)} sur 12 mois` : '';

  document.querySelectorAll('#view-couts .couts-vue [data-vue]').forEach((bouton) => {
    bouton.setAttribute('aria-pressed', String(bouton.dataset.vue === couts.vue));
  });
  cadre.hidden = couts.vue !== 'graphe';
  $('couts-table').hidden = couts.vue !== 'tableau';
  $('couts-table').innerHTML = coutsTableHtml(affiches);

  if (total12 === 0) {
    cadre.innerHTML = `<p class="empty">${
      couts.donnees.renseignes
        ? 'Aucune dépense du SAV sur les douze derniers mois.'
        : 'Les montants apparaîtront ici dès que vos coûts unitaires seront renseignés.'
    }</p>`;
    return;
  }

  const graduations = graduationsCouts(Math.max(...affiches.map((m) => m.montants.total)) / 100);
  const haut = graduations.at(-1);
  const px = (centimes) => (centimes / 100 / haut) * HAUTEUR_COUTS;

  const colonnes = affiches
    .map((m) => {
      // De bas en haut, dans l'ordre de la légende. Chaque segment cède deux
      // pixels à l'écart qui le sépare du précédent : le haut de la pile reste
      // exactement à sa valeur sur l'axe.
      const segments = POSTES_COUTS.map((poste, n) => ({ n: n + 1, h: px(m.montants[poste.cle]) })).filter((s) => s.h > 0);
      let bas = 0;
      const pile = segments
        .map((segment, k) => {
          const ecart = k > 0 ? 2 : 0;
          const bloc = `<i class="cg-seg cg-s${segment.n}${k === segments.length - 1 ? ' cg-bout' : ''}" style="bottom:${(bas + ecart).toFixed(1)}px;height:${Math.max(0, segment.h - ecart).toFixed(1)}px"></i>`;
          bas += segment.h;
          return bloc;
        })
        .join('');
      const choisi = m.mois === couts.choisi;
      const resume = `${nomDuMois(m.mois)} : ${euros(m.montants.total)}, dont ${POSTES_COUTS.map(
        (poste) => `${poste.nom.toLowerCase()} ${euros(m.montants[poste.cle])}`,
      ).join(', ')}`;
      return `<button type="button" class="cg-col${choisi ? ' cg-choisi' : ''}" data-mois="${esc(m.mois)}"
          data-haut="${bas.toFixed(1)}" aria-pressed="${choisi}" aria-label="${esc(resume)}">
        <span class="cg-pile">${pile}${
          // Une seule étiquette : celle du mois choisi. Les autres valeurs
          // vivent dans l'infobulle et le tableau.
          choisi ? `<span class="cg-val" style="bottom:${(bas + 4).toFixed(1)}px">${esc(euros(m.montants.total, true))}</span>` : ''
        }</span>
        <span class="cg-x" aria-hidden="true"><span class="cg-x-long">${esc(nomDuMois(m.mois, 'court'))}</span><span class="cg-x-court">${esc(
          nomDuMois(m.mois, 'initiale'),
        )}</span></span>
      </button>`;
    })
    .join('');

  cadre.innerHTML = `<ul class="cg-legende">${POSTES_COUTS.map(
    (poste, n) => `<li><span class="cg-cle cg-s${n + 1}" aria-hidden="true"></span>${esc(poste.nom)}</li>`,
  ).join('')}</ul>
    <div class="cg" style="--cg-h:${HAUTEUR_COUTS}px">
      <div class="cg-y" aria-hidden="true">${graduations
        .map((g) => `<span style="bottom:${((g / haut) * 100).toFixed(2)}%">${esc(euros(g * 100, true))}</span>`)
        .join('')}</div>
      <div class="cg-plot">
        <div class="cg-grille" aria-hidden="true">${graduations
          .map((g) => `<i style="bottom:${((g / haut) * 100).toFixed(2)}%"></i>`)
          .join('')}</div>
        <div class="cg-cols" role="group" aria-label="Coût du SAV par mois — choisir un mois">${colonnes}</div>
      </div>
    </div>`;
}

/** La vue en tableau : les mêmes chiffres, sans dépendre de la couleur ni du survol. */
function coutsTableHtml(affiches) {
  // `data-label` : au doigt, chaque ligne devient une fiche qui recopie
  // l'intitulé de sa colonne.
  const ligne = (titre, m, classe = '') => `<tr${classe ? ` class="${classe}"` : ''}>
      <th scope="row">${esc(titre)}</th>
      <td class="num mono" data-label="Retours">${esc(euros(m.retours))}</td>
      <td class="num mono" data-label="Renvois et échanges">${esc(euros(m.renvois))}</td>
      <td class="num mono" data-label="Paires perdues">${esc(euros(m.perdues))}</td>
      <td class="num mono" data-label="Total"><b>${esc(euros(m.total))}</b></td>
      <td class="num mono" data-label="Économie">${esc(euros(m.economie))}</td>
      <td class="num mono" data-label="Net">${esc(euros(m.net))}</td>
    </tr>`;
  const somme = Object.fromEntries(
    ['retours', 'renvois', 'perdues', 'total', 'economie', 'net'].map((cle) => [
      cle,
      affiches.reduce((total, m) => total + m.montants[cle], 0),
    ]),
  );
  return `<table class="grid">
    <caption class="sr-only">Coût du SAV par mois, du plus récent au plus ancien</caption>
    <thead><tr><th>Mois</th><th class="num">Retours</th><th class="num">Renvois et échanges</th>
      <th class="num">Paires perdues</th><th class="num">Total</th><th class="num">Économie</th><th class="num">Net</th></tr></thead>
    <tbody>${affiches
      .slice()
      .reverse()
      .map((m) => ligne(nomDuMois(m.mois), m.montants, m.mois === couts.choisi ? 'cg-ligne-choisie' : ''))
      .join('')}</tbody>
    <tfoot>${ligne('12 mois', somme)}</tfoot>
  </table>`;
}

/* Une infobulle pour toute la colonne : les trois postes et le total, au
   survol comme au clavier. La valeur d'abord, le nom du poste ensuite. */
function montrerBulleCouts(colonne) {
  const m = couts.donnees.mois.find((mois) => mois.mois === colonne.dataset.mois);
  if (!m) return;
  const bulle = $('couts-tip');
  bulle.replaceChildren();

  const titre = document.createElement('div');
  titre.className = 'cg-tip-t';
  titre.textContent = nomDuMois(m.mois);
  bulle.append(titre);

  const rangee = (valeur, nom, poste) => {
    const div = document.createElement('div');
    div.className = 'cg-tip-l';
    if (poste) {
      const trait = document.createElement('i');
      trait.className = `cg-trait cg-s${poste}`;
      div.append(trait);
    }
    const fort = document.createElement('b');
    fort.textContent = valeur;
    div.append(fort, ` ${nom}`);
    bulle.append(div);
  };
  rangee(euros(m.montants.total), 'au total');
  POSTES_COUTS.slice()
    .reverse()
    .forEach((poste) => rangee(euros(m.montants[poste.cle]), poste.nom, POSTES_COUTS.indexOf(poste) + 1));

  bulle.hidden = false;
  const pile = colonne.querySelector('.cg-pile').getBoundingClientRect();
  const sommet = pile.bottom - Number(colonne.dataset.haut || 0);
  const largeur = bulle.offsetWidth;
  const hauteur = bulle.offsetHeight;
  const x = Math.min(Math.max(8, pile.left + pile.width / 2 - largeur / 2), window.innerWidth - largeur - 8);
  // Au-dessus de la pile ; à défaut de place, sous les mois.
  const y = sommet - hauteur - 12 >= 8 ? sommet - hauteur - 12 : pile.bottom + 28;
  bulle.style.left = `${x}px`;
  bulle.style.top = `${y}px`;
}

function cacherBulleCouts() {
  $('couts-tip').hidden = true;
}

function renderCoutsDetail() {
  const { mois, volumes: v, montants: m } = moisChoisi();
  const { couts: prix, renseignes } = couts.donnees;
  $('couts-detail-mois').textContent = nomDuMois(mois);

  /*
   * Le calcul en groupes de lignes, comme les Réglages : un groupe par poste,
   * son total au-dessus, chaque geste dessous avec « nombre × prix » et son
   * montant. Sans coûts unitaires, le nombre reste et le reste se tait.
   */
  const somme = (centimes) => (renseignes ? euros(centimes) : '—');
  const ligne = (libelle, nombre, euro, { moins = false } = {}) => `<div class="cd-ligne">
      <span class="cd-nom">${esc(libelle)}</span>
      <span class="cd-calc">${renseignes ? `${nombre} × ${esc(euros(Math.round(euro * 100)))}` : nombre}</span>
      <span class="cd-mt${moins && renseignes ? ' cd-moins' : ''}">${
        renseignes ? `${moins ? '− ' : ''}${esc(euros(nombre * Math.round(euro * 100)))}` : '—'
      }</span>
    </div>`;
  const poste = (n, nom, total, lignes) => `<div class="cd-groupe">
      <div class="cd-tete"><span class="cg-cle cg-s${n}" aria-hidden="true"></span><span>${esc(nom)}</span><b>${esc(
        somme(total),
      )}</b></div>
      <div class="cd-lignes">${lignes}</div>
    </div>`;

  $('couts-detail').innerHTML = `${poste(
    1,
    'Retours',
    m.retours,
    ligne('Bons de retour fournis', v.bons, prix.bonRetour) + ligne('Paires reçues en agence', v.recues, prix.fraisAgence),
  )}
    ${poste(
      2,
      'Renvois et échanges',
      m.renvois,
      ligne('Colis envoyés par une agence', v.colisAgence, prix.colisAgence) +
        ligne('Colis d’échange envoyés par l’atelier', v.colisAtelier, prix.colisAtelier) +
        ligne('Paires neuves pour un échange', v.echangesAtelier, prix.prixPaire),
    )}
    ${poste(3, 'Paires perdues', m.perdues, ligne('Paires inutilisables', v.perdues, prix.prixPaire))}
    <div class="cd-lignes cd-totaux">
      <div class="cd-ligne"><span class="cd-nom">Coût du SAV</span><b class="cd-mt">${esc(somme(m.total))}</b></div>
      ${ligne('Paires de retour réemployées', v.reemployees, prix.prixPaire, { moins: true })}
      <div class="cd-ligne cd-net"><b class="cd-nom">Coût net, après réemploi</b><b class="cd-mt">${esc(somme(m.net))}</b></div>
    </div>
    <p class="set-help cd-note">Un colis se compte une fois, même avec deux paires dedans ; un bon, une fois par commande.
      Ce mois-ci : ${nombreDe(v.renvois, 'paire du stock partie', 'paires du stock parties')} sur une commande,
      ${nombreDe(v.echangesStock, 'échange servi', 'échanges servis')} par le stock. Remboursements et temps de l’équipe non compris.</p>`;
}

function renderCoutsMotifs() {
  const { motifs, modeles } = moisChoisi();
  const total = Object.values(motifs).reduce((somme, n) => somme + n, 0);
  if (total === 0) {
    $('couts-motifs').innerHTML = '<p class="empty">Aucun retour demandé ce mois-ci.</p>';
    $('couts-modeles').innerHTML = '<p class="empty cm-vide">Aucun modèle retourné ce mois-ci.</p>';
    return;
  }

  $('couts-motifs').innerHTML = Object.entries(motifs)
    .sort((a, b) => b[1] - a[1])
    .map(
      ([motif, n]) => `<div class="ibar">
        <span class="ibar-label">${esc(RETURN_REASONS[motif] ?? motif)}</span>
        <span class="ibar-track"><i class="ibar-fill cg-s1" style="width:${((n / total) * 100).toFixed(1)}%"></i></span>
        <span class="ibar-count mono">${Math.round((n / total) * 100)} %<span class="ibar-vol"> (${n})</span></span>
      </div>`,
    )
    .join('');

  // Une liste plutôt qu'un tableau à trois colonnes : le modèle, son motif
  // principal dessous, le nombre à droite.
  $('couts-modeles').innerHTML = `<ul class="cm-liste">${modeles
    .map(
      (modele) => `<li>
        <span class="cm-txt"><b>${esc(modele.titre)}</b><span>Surtout : ${esc(
          (RETURN_REASONS[modele.motif] ?? modele.motif).toLowerCase(),
        )}</span></span>
        <span class="cm-n">${esc(nombreDe(modele.retours, 'retour', 'retours'))}</span>
      </li>`,
    )
    .join('')}</ul>`;
}

function decalerMoisCouts(pas) {
  const affiches = moisAffiches();
  const rang = affiches.findIndex((m) => m.mois === couts.choisi) + pas;
  if (rang < 0 || rang >= affiches.length) return;
  couts.choisi = affiches[rang].mois;
  renderCouts();
}

function ouvrirCoutsUnitaires() {
  const prix = couts.donnees?.couts ?? {};
  for (const cle of CLES_COUTS) {
    $(`cu-${cle}`).value = prix[cle] ? String(prix[cle]).replace('.', ',') : '';
  }
  $('cu-erreur').hidden = true;
  $('cu-modal').hidden = false;
  $('cu-modal').classList.add('open');
  $('cu-bonRetour').focus();
}

function fermerCoutsUnitaires() {
  $('cu-modal').hidden = true;
  $('cu-modal').classList.remove('open');
}

async function enregistrerCoutsUnitaires() {
  const corps = {};
  for (const cle of CLES_COUTS) {
    const champ = $(`cu-${cle}`);
    const brut = champ.value.replace(/[\s €]/g, '').replace(',', '.');
    const valeur = brut === '' ? 0 : Number(brut);
    if (!Number.isFinite(valeur) || valeur < 0 || valeur > 10000) {
      $('cu-erreur').textContent = `« ${document.querySelector(`label[for="cu-${cle}"]`).textContent} » : un montant entre 0 et 10 000 €.`;
      $('cu-erreur').hidden = false;
      champ.focus();
      return;
    }
    corps[cle] = Math.round(valeur * 100) / 100;
  }

  const bouton = $('cu-enregistrer');
  bouton.disabled = true;
  try {
    await api('/api/couts/unitaires', { method: 'PUT', body: JSON.stringify(corps) });
    fermerCoutsUnitaires();
    toast('Coûts unitaires enregistrés : les douze mois sont recalculés.');
    await loadCouts();
  } catch (error) {
    $('cu-erreur').textContent = error.message;
    $('cu-erreur').hidden = false;
  } finally {
    bouton.disabled = false;
  }
}

$('couts-prec').addEventListener('click', () => decalerMoisCouts(-1));
$('couts-suiv').addEventListener('click', () => decalerMoisCouts(1));
$('couts-reglages').addEventListener('click', ouvrirCoutsUnitaires);
$('cu-annuler').addEventListener('click', fermerCoutsUnitaires);
$('cu-enregistrer').addEventListener('click', enregistrerCoutsUnitaires);
$('cu-modal').addEventListener('keydown', (event) => {
  if (event.key === 'Escape') fermerCoutsUnitaires();
  if (event.key === 'Enter' && event.target.tagName === 'INPUT') void enregistrerCoutsUnitaires();
});
document.querySelector('#view-couts .couts-vue').addEventListener('click', (event) => {
  const bouton = event.target.closest('[data-vue]');
  if (!bouton || !couts.donnees) return;
  couts.vue = bouton.dataset.vue;
  renderCoutsGraphe();
});

{
  const graphe = $('couts-graphe');
  graphe.addEventListener('click', (event) => {
    const colonne = event.target.closest('.cg-col');
    if (!colonne) return;
    couts.choisi = colonne.dataset.mois;
    renderCouts();
    // Le graphe vient d'être redessiné : le focus revient sur le mois choisi.
    graphe.querySelector(`.cg-col[data-mois="${couts.choisi}"]`)?.focus();
  });
  graphe.addEventListener('pointerover', (event) => {
    const colonne = event.target.closest('.cg-col');
    if (colonne) montrerBulleCouts(colonne);
  });
  graphe.addEventListener('pointerleave', cacherBulleCouts);
  graphe.addEventListener('focusin', (event) => {
    const colonne = event.target.closest('.cg-col');
    if (colonne) montrerBulleCouts(colonne);
  });
  graphe.addEventListener('focusout', cacherBulleCouts);
}

/* -------------------------------------------------------------- catalogue */

const CATALOG_HEADS = {
  products:
    '<tr><th></th><th>Produit</th><th>Statut</th><th>Fournisseur</th><th class="num">Stock</th><th class="num">Variantes</th><th class="num">Prix</th></tr>',
  collections: '<tr><th></th><th>Collection</th><th class="num">Produits</th><th>Modifiée</th></tr>',
};

async function loadCatalog({ reset = false } = {}) {
  const store = state.catalog;
  if (store.loading) return;

  store.loading = true;
  $('catalog-head').innerHTML = CATALOG_HEADS[store.kind];

  if (reset) {
    store.items = [];
    store.cursor = null;
    $('catalog-rows').innerHTML = '<tr><td colspan="7" class="empty">Chargement…</td></tr>';
  }

  const params = new URLSearchParams();
  // 50 est le plafond accepté par l'API : moins d'allers-retours pour un
  // catalogue de plusieurs centaines de références.
  params.set('limit', '50');
  if (store.q) params.set('q', store.q);
  if (store.cursor) params.set('cursor', store.cursor);

  try {
    const path = store.kind === 'products' ? 'products' : 'collections';
    const page = await api(`/api/${path}?${params}`);
    // `concat(undefined)` insère littéralement `undefined` dans la liste, et
    // le rendu tombe sur `product.image` — l'écran affichait l'erreur au lieu
    // du catalogue dès que la réponse n'avait pas la forme attendue.
    store.items = store.items.concat(page[path] ?? []);
    store.cursor = page.cursor;
    store.hasNext = page.hasNextPage;
    store.loaded = true;
    renderCatalog();
  } catch (error) {
    $('catalog-rows').innerHTML = `<tr><td colspan="7" class="empty">${esc(error.message)}</td></tr>`;
    $('catalog-more').hidden = true;
  } finally {
    store.loading = false;
  }
}

const PRODUCT_STATUS = { ACTIVE: 'En ligne', DRAFT: 'Brouillon', ARCHIVED: 'Archivé' };

function renderCatalog() {
  const store = state.catalog;

  const thumb = (url) =>
    url
      ? `<img class="thumb" src="${esc(url)}" alt="" loading="lazy" />`
      : '<span class="thumb"></span>';

  const rows =
    store.kind === 'products'
      ? store.items.map(
          (product) => `<tr>
            <td>${thumb(product.image)}</td>
            <td><b>${esc(product.title)}</b></td>
            <td><span class="tag tag-status ${
              product.status === 'ACTIVE' ? 'st-CLOSED' : 'st-NEW'
            }">${esc(PRODUCT_STATUS[product.status] ?? product.status)}</span></td>
            <td>${esc(product.vendor ?? '—')}</td>
            <td class="num mono ${
              (product.totalInventory ?? 0) <= 0 ? 'set-alert' : ''
            }">${product.totalInventory ?? '—'}</td>
            <td class="num mono">${product.variantCount}</td>
            <td class="num mono">${
              product.priceMin === null
                ? '—'
                : product.priceMin === product.priceMax
                  ? euro(product.priceMin, product.currency ?? 'EUR')
                  : `${euro(product.priceMin, product.currency ?? 'EUR')} – ${euro(
                      product.priceMax,
                      product.currency ?? 'EUR',
                    )}`
            }</td>
          </tr>`,
        )
      : store.items.map(
          (collection) => `<tr>
            <td>${thumb(collection.image)}</td>
            <td><b>${esc(collection.title)}</b><br /><span class="sub mono">${esc(
              collection.handle,
            )}</span></td>
            <td class="num mono">${collection.productsCount}</td>
            <td>${fullDate(collection.updatedAt)}</td>
          </tr>`,
        );

  $('catalog-rows').innerHTML =
    rows.join('') || '<tr><td colspan="7" class="empty">Rien à afficher.</td></tr>';

  // « 25 produits » laissait croire que le catalogue en comptait 25, alors que
  // c'est le nombre de lignes déjà chargées. Shopify ne donne pas de total sans
  // parcourir toutes les pages, donc on nomme ce qu'on sait.
  $('catalog-count').textContent = store.items.length
    ? `${store.items.length} ${store.kind === 'products' ? 'produits' : 'collections'} affichés${
        store.hasNext ? ' · d’autres à charger' : ''
      }`
    : '';
  $('catalog-more').hidden = !store.hasNext;
}

$('catalog-seg')
  .querySelectorAll('button')
  .forEach((button) =>
    button.addEventListener('click', () => {
      state.catalog.kind = button.dataset.kind;
      $('catalog-seg')
        .querySelectorAll('button')
        .forEach((other) =>
          other.setAttribute('aria-pressed', String(other.dataset.kind === button.dataset.kind)),
        );
      loadCatalog({ reset: true });
    }),
  );

$('catalog-more').addEventListener('click', () => loadCatalog());

// Lien direct plutôt qu'un appel : le navigateur gère le téléchargement, et un
// fichier reçu en mémoire puis re-téléchargé ne servirait à rien de plus.
$('orders-xlsx').href = '/api/orders/export.xlsx?limit=250';
$('orders-export').href = '/api/orders/export.csv?limit=250';

// Les onglets et le tri rejouent la requête depuis le début : garder le
// curseur mélangerait deux tris dans la même liste.
$('orders-vues').addEventListener('click', (event) => {
  const onglet = event.target.closest('[data-vue]');
  if (!onglet || onglet.dataset.vue === state.orders.vue) return;
  state.orders.vue = onglet.dataset.vue;
  $('orders-vues')
    .querySelectorAll('[data-vue]')
    .forEach((autre) => autre.setAttribute('aria-selected', String(autre === onglet)));
  void loadOrders({ reset: true });
});

/*
 * Trier en cliquant l'en-tête, comme dans le Finder : Date puis Total ; un
 * second clic sur la même colonne inverse l'ordre.
 */
const TRIS_COMMANDES = {
  date: ['recent', 'oldest'],
  total: ['amountDesc', 'amountAsc'],
};

$('view-orders').querySelectorAll('.cmd-tri').forEach((entete) =>
  entete.addEventListener('click', () => {
    const [premier, second] = TRIS_COMMANDES[entete.dataset.tri];
    state.orders.sort = state.orders.sort === premier ? second : premier;
    rendreTriCommandes();
    void loadOrders({ reset: true });
  }),
);

function rendreTriCommandes() {
  $('view-orders').querySelectorAll('.cmd-tri').forEach((entete) => {
    const [premier, second] = TRIS_COMMANDES[entete.dataset.tri];
    const sens = state.orders.sort === premier ? 'descending' : state.orders.sort === second ? 'ascending' : 'none';
    entete.setAttribute('aria-sort', sens);
  });
}

/* « Exporter » : les deux fichiers dans un menu, plutôt que deux boutons. */
function fermerExportCommandes() {
  const menu = $('orders-export-menu');
  if (!menu || menu.hidden) return;
  menu.hidden = true;
  $('orders-exporter').setAttribute('aria-expanded', 'false');
}

$('orders-exporter').addEventListener('click', (event) => {
  event.stopPropagation();
  const menu = $('orders-export-menu');
  menu.hidden = !menu.hidden;
  $('orders-exporter').setAttribute('aria-expanded', String(!menu.hidden));
});
$('orders-export-menu').addEventListener('click', () => setTimeout(fermerExportCommandes));
document.addEventListener('click', (event) => {
  if (!event.target.closest?.('.cmd-exporter')) fermerExportCommandes();
});

$('catalog-q').addEventListener('input', (event) => {
  state.catalog.q = event.target.value.trim();
  clearTimeout(state.catalog.timer);
  state.catalog.timer = setTimeout(() => loadCatalog({ reset: true }), 350);
});

/* ------------------------------------------------------------ suivi colis */

async function loadTracking() {
  const body = $('tracking-rows');
  body.innerHTML = '<tr><td colspan="6" class="empty">Chargement…</td></tr>';

  try {
    const data = await api('/api/tracking?limit=50');
    const shipments = data.shipments ?? [];

    body.innerHTML =
      shipments
        .map(
          (shipment) => `<tr>
            <td class="mono"><b>${esc(shipment.orderName)}</b></td>
            <td>${esc(shipment.customer ?? '—')}</td>
            <td>${esc(shipment.carrier ?? '—')}</td>
            <td class="mono">${
              shipment.trackingNumber
                ? `<button class="linklike" data-track="${esc(shipment.trackingNumber)}"${
                    shipment.trackingUrl ? ` data-track-url="${esc(shipment.trackingUrl)}"` : ''
                  }>${esc(shipment.trackingNumber)}</button>`
                : '—'
            }</td>
            <td>${
              shipment.liveStatus
                ? `<span class="tag ${trackTone(shipment.liveStatus)}">${esc(
                    TRACK_LABELS[shipment.liveStatus] ?? shipment.liveStatus,
                  )}</span>${
                    shipment.lastEvent
                      ? `<br><span class="sub">${esc(shipment.lastEvent.status)}${
                          shipment.lastEvent.location ? ` · ${esc(shipment.lastEvent.location)}` : ''
                        }</span>`
                      : ''
                  }`
                : esc([shipment.city, shipment.country].filter(Boolean).join(', ') || '—')
            }</td>
            <td>${
              shipment.trackingNumber
                ? `<button class="btn btn-small" data-track="${esc(shipment.trackingNumber)}"${
                    shipment.trackingUrl ? ` data-track-url="${esc(shipment.trackingUrl)}"` : ''
                  }>Chronologie</button>`
                : '—'
            }</td>
          </tr>`,
        )
        .join('') ||
      '<tr><td colspan="6" class="empty">Aucun colis en cours d’acheminement.</td></tr>';

    body.querySelectorAll('[data-track]').forEach((button) =>
      button.addEventListener('click', () =>
        void openTracking(button.dataset.track, button.dataset.trackUrl ?? null),
      ),
    );

    $('tracking-count').textContent = shipments.length
      ? `${shipments.length} colis en transit`
      : '';
  } catch (error) {
    body.innerHTML = `<tr><td colspan="7" class="empty">${esc(error.message)}</td></tr>`;
  }
}

$('tracking-refresh').addEventListener('click', () => loadTracking());

/* --------------------------------------------------------- remboursements */

/*
 * Couleur d'un état de colis.
 *
 * Quatre familles, pas deux. « En transit » et « Incident de livraison »
 * portaient le même orange : l'un demande de patienter, l'autre d'agir tout de
 * suite, et l'agent devait lire chaque ligne pour faire le tri que la couleur
 * aurait dû faire pour lui.
 */
const TRACK_TONE = {
  Delivered: 'ok',
  OutForDelivery: 'go',
  AvailableForPickup: 'go',
  InTransit: 'go',
  InfoReceived: 'wait',
  NotFound: 'wait',
  Expired: 'wait',
  DeliveryFailure: 'bad',
  Exception: 'bad',
};

function trackTone(status) {
  return `tone-${TRACK_TONE[status] ?? 'wait'}`;
}

const REFUND_TONE = {
  COMPLETED: 'ok',
  PENDING: 'wait',
  FAILED: 'bad',
  CANCELLED: 'mute',
};

const REFUND_STATUS = {
  PENDING: 'En attente',
  COMPLETED: 'Effectué',
  FAILED: 'Échec',
  CANCELLED: 'Annulé',
};

const REFUND_KIND = { FULL: 'Total', PARTIAL: 'Partiel', SHIPPING: 'Frais de port' };

/** Fenêtre de l'écran Remboursements, commune au montant et au ratio. */
let refundDays = 90;

async function loadRefunds() {
  const body = $('refunds-rows');
  body.innerHTML = '<tr><td colspan="7" class="empty">Chargement…</td></tr>';

  try {
    const data = await api(`/api/refunds?days=${refundDays}`);
    // Une réponse sans totaux ne doit pas remplacer l'écran par une erreur de
    // lecture : des zéros disent la même chose, lisiblement.
    const refunds = data.refunds ?? [];
    const totals = data.totals ?? {};

    $('refunds-range')
      .querySelectorAll('button')
      .forEach((button) =>
        button.setAttribute('aria-pressed', String(Number(button.dataset.days) === refundDays)),
      );
    state.refundRows = refunds;
    $('refunds-n').textContent = refunds.length ? String(refunds.length) : '';

    const pending = totals.PENDING ?? { count: 0, amount: 0 };
    const done = totals.COMPLETED ?? { count: 0, amount: 0 };
    const failed = totals.FAILED ?? { count: 0, amount: 0 };

    $('refunds-kpis').innerHTML = [
      [
        'Part du CA remboursée',
        data.refundRate == null
          ? '—'
          : `${(data.refundRate * 100).toFixed(1).replace('.', ',')} %`,
        data.revenue == null
          ? 'chiffre d’affaires indisponible'
          : `${euro(data.refundedTotal, 'EUR')} sur ${euro(data.revenue, 'EUR')}`,
      ],
      [
        'Effectués',
        euro(totals.COMPLETED?.amount ?? 0, 'EUR'),
        `${totals.COMPLETED?.count ?? 0} remboursement${
          (totals.COMPLETED?.count ?? 0) > 1 ? 's' : ''
        }`,
      ],
      [
        'En cours',
        euro(totals.PENDING?.amount ?? 0, 'EUR'),
        `${totals.PENDING?.count ?? 0} demande${(totals.PENDING?.count ?? 0) > 1 ? 's' : ''}`,
      ],
      [
        'En échec',
        totals.FAILED?.count ?? 0,
        (totals.FAILED?.count ?? 0) > 0 ? 'à reprendre' : 'rien à reprendre',
      ],
    ]
      .map(
        ([label, value, note]) => `<div class="kpi">
          <span class="kpi-label">${esc(String(label))}</span>
          <span class="kpi-value">${esc(String(value))}</span>
          <span class="kpi-note">${esc(String(note))}</span>
        </div>`,
      )
      .join('');

    renderRefundRows();
  } catch (error) {
    body.innerHTML = `<tr><td colspan="7" class="empty">${esc(error.message)}</td></tr>`;
  }
}

function renderRefundRows() {
  const body = $('refunds-rows');
  const filter = state.refundFilter;
  const refunds = filter
    ? state.refundRows.filter((refund) => refund.status === filter)
    : state.refundRows;

  {
    body.innerHTML =
      refunds
        .map(
          (refund) => `<tr class="grid-row" data-order="${esc(refund.shopifyOrderId ?? '')}">
            <td class="mono"><b>${esc(refund.orderName ?? '—')}</b>${
              // L'origine se dit une fois, discrètement : un remboursement
              // passé dans Shopify ne porte ni auteur ni ticket, et l'agent
              // doit savoir pourquoi la ligne est plus pauvre.
              refund.external ? '<span class="origin">Shopify</span>' : ''
            }</td>
            <td>${esc(refund.customerName ?? refund.customerEmail ?? '—')}</td>
            <td>${fullDate(refund.createdAt)}</td>
            <td>${esc(refund.reason ?? '—')}</td>
            <td>${esc(REFUND_KIND[refund.kind] ?? refund.kind)}</td>
            <td><span class="tag tone-${
              REFUND_TONE[refund.status] ?? 'wait'
            }">${esc(REFUND_STATUS[refund.status] ?? refund.status)}</span></td>
            <td class="num mono">${euro(refund.amount, refund.currency ?? 'EUR')}</td>
          </tr>`,
        )
        .join('') ||
      `<tr><td colspan="7" class="empty">Aucun remboursement pour l'instant.
        Ils se créent depuis un mail client (bouton « Rembourser ») et
        s'exécutent sur Shopify après validation — chacun laissera sa ligne ici.</td></tr>`;

    // La ligne mène à la commande : c'est la question qui suit toujours un
    // montant remboursé — sur quoi, et pourquoi.
    body.querySelectorAll('[data-order]').forEach((row) =>
      row.addEventListener('click', () => {
        if (row.dataset.order) void openOrderSheet(row.dataset.order);
      }),
    );

    $('refunds-count').textContent = refunds.length
      ? `${refunds.length} remboursement${refunds.length > 1 ? 's' : ''}`
      : '';
  }
}

$('refunds-filters').addEventListener('click', (event) => {
  const chip = event.target.closest('.chip');
  if (!chip) return;

  state.refundFilter = chip.dataset.refund;
  $('refunds-filters')
    .querySelectorAll('.chip')
    .forEach((other) =>
      other.setAttribute('aria-pressed', String(other.dataset.refund === state.refundFilter)),
    );
  renderRefundRows();
});

/* ------------------------------------------------------ message sortant -- */

function openMail(to, subject = '') {
  $('mail-to').value = to ?? '';
  $('mail-subject').value = subject;
  $('mail-body').value = '';
  $('mail-modal').classList.add('open');
  $('mail-subject').focus();
}

$('mail-cancel').addEventListener('click', () => $('mail-modal').classList.remove('open'));
$('mail-modal').addEventListener('click', (event) => {
  if (event.target === $('mail-modal')) $('mail-modal').classList.remove('open');
});

$('mail-send').addEventListener('click', async () => {
  const payload = {
    to: $('mail-to').value.trim(),
    subject: $('mail-subject').value.trim(),
    body: $('mail-body').value.trim(),
  };

  if (!payload.to || !payload.subject || !payload.body) {
    toast('Destinataire, objet et message sont requis.', true);
    return;
  }

  const button = $('mail-send');
  button.disabled = true;

  try {
    await api('/api/emails', { method: 'POST', body: JSON.stringify(payload) });
    $('mail-modal').classList.remove('open');
    toast('Message envoyé.');
    await loadAudit();
  } catch (error) {
    toast(error.message, true);
  } finally {
    button.disabled = false;
  }
});

/* ----------------------------------------------------------------- litiges */

const DISPUTE_STATUS = {
  NEEDS_RESPONSE: 'Réponse attendue',
  UNDER_REVIEW: 'En cours d’examen',
  CHARGE_REFUNDED: 'Remboursé',
  ACCEPTED: 'Accepté',
  WON: 'Gagné',
  LOST: 'Perdu',
};

async function loadDisputes() {
  const body = $('disputes-rows');
  body.innerHTML = '<p class="empty">Chargement…</p>';

  let disputes;
  try {
    ({ disputes } = await api('/api/disputes'));
  } catch (error) {
    body.innerHTML = `<p class="empty">${esc(error.message)}</p>`;
    $('disputes-count').textContent = '';
    return;
  }

  if (disputes.length === 0) {
    body.innerHTML =
      '<p class="empty">Aucun litige. Si votre boutique n’utilise pas Shopify Payments, cet écran restera vide.</p>';
    $('disputes-count').textContent = '';
    return;
  }

  // Les plus urgents d'abord : un litige non contesté est débité d'office à
  // l'échéance, l'ordre de la liste est donc l'ordre de travail.
  disputes.sort((a, b) => (a.daysLeft ?? 999) - (b.daysLeft ?? 999));

  body.innerHTML = disputes
    .map((dispute) => {
      const urgent = dispute.daysLeft !== null && dispute.daysLeft <= 3;
      const deadline =
        dispute.daysLeft === null
          ? 'Aucune échéance annoncée'
          : dispute.daysLeft < 0
            ? `Échéance dépassée depuis ${-dispute.daysLeft} j — la banque a tranché`
            : `Réponse à Shopify avant le ${fullDate(dispute.evidenceDueBy)} · ${
                dispute.daysLeft
              } j restants`;

      // Preuve de livraison : ce que la banque attend, assemblé à partir des
      // colis déjà saisis plutôt que recopié à la main dans l'urgence.
      const evidence = dispute.evidence ?? [];
      const delivered = evidence.filter((item) => item.status === 'Delivered');

      // Le compte à rebours est la seule information qui décide de l'ordre de
      // travail : un litige non contesté est débité d'office. Il passe donc en
      // tête de carte, au corps d'un chiffre qu'on lit de loin.
      const countdown =
        dispute.daysLeft === null
          ? { value: '—', unit: 'sans échéance', tone: 'mute' }
          : dispute.daysLeft < 0
            ? { value: 'Perdu', unit: 'échéance dépassée', tone: 'bad' }
            : {
                value: String(dispute.daysLeft),
                unit: dispute.daysLeft > 1 ? 'jours restants' : 'jour restant',
                tone: dispute.daysLeft <= 3 ? 'bad' : dispute.daysLeft <= 7 ? 'wait' : 'go',
              };

      return `<article class="dsp${urgent ? ' urgent' : ''}">
        <div class="dsp-head">
          <span class="dsp-count tone-${countdown.tone}">
            <b>${esc(countdown.value)}</b><span>${esc(countdown.unit)}</span>
          </span>
          <div class="dsp-id">
            <b class="mono">${esc(dispute.orderName ?? 'commande inconnue')}</b>
            <span class="tag tone-${
              dispute.status === 'NEEDS_RESPONSE' ? 'bad' : 'go'
            }">${esc(DISPUTE_STATUS[dispute.status] ?? dispute.status)}</span>
          </div>
          <span class="mono dsp-amount">${esc(euro(dispute.amount, dispute.currency))}</span>
        </div>

        <div class="dsp-deadline${
          urgent || (dispute.daysLeft ?? 0) < 0 ? ' late' : ''
        }">${esc(deadline)}</div>

        <div class="dsp-reason">
          <span class="panel-title">Motif</span>
          ${esc(dispute.reason ?? '—')}${dispute.type ? ` · ${esc(dispute.type)}` : ''}
        </div>

        <section class="dsp-evidence">
          <span class="panel-title">Preuve de livraison</span>
          ${
            evidence.length
              ? evidence
                  .map(
                    (item) => `<div class="dsp-row">
                      <b>${item.index}/${item.total}</b>
                      <span class="mono">${esc(item.trackingNumber)}</span>
                      ${item.carrier ? `<span class="tag tag-order">${esc(item.carrier)}</span>` : ''}
                      <span class="tag ${
                        trackTone(item.status)
                      }">${esc(TRACK_LABELS[item.status] ?? item.status ?? 'suivi indisponible')}</span>
                      ${
                        item.hasPhoto
                          ? `<a class="btn btn-small" href="/api/parcels/${esc(
                              item.parcelId,
                            )}/photo" target="_blank" rel="noopener">Photo</a>`
                          : ''
                      }
                    </div>`,
                  )
                  .join('')
              : `<p class="empty">Aucun colis rattaché à cette commande. Sans numéro de suivi,
                 il n'y a pas de preuve de livraison à produire — c'est le litige le plus
                 difficile à gagner.</p>`
          }
        </section>

        <div class="dsp-acts">
          <button class="btn btn-primary" data-dsp-copy="${esc(dispute.id)}"${
            evidence.length ? '' : ' disabled'
          }>Copier la preuve</button>
          <a class="btn" href="https://${esc(
            state.me?.merchant?.shopDomain ?? '',
          )}/admin/payments/disputes" target="_blank" rel="noopener">Répondre sur Shopify</a>
          ${
            delivered.length === evidence.length && evidence.length
              ? '<span class="hint">Tous les colis sont marqués livrés — dossier favorable.</span>'
              : ''
          }
        </div>
      </article>`;
    })
    .join('');

  $('disputes-count').textContent = `${disputes.length} litige${
    disputes.length > 1 ? 's' : ''
  }`;

  // Le dossier se colle dans le formulaire Shopify : l'API de soumission de
  // preuves n'est pas ouverte aux applications, seule l'administration le
  // permet. Autant préparer le texte exact plutôt que de laisser recopier.
  body.querySelectorAll('[data-dsp-copy]').forEach((button) =>
    button.addEventListener('click', async () => {
      const dispute = disputes.find((candidate) => candidate.id === button.dataset.dspCopy);

      const text = [
        `Commande ${dispute.orderName ?? ''} — ${euro(dispute.amount, dispute.currency)}`,
        '',
        'Preuve de livraison :',
        ...dispute.evidence.map(
          (item) =>
            `• Colis ${item.index}/${item.total} — ${item.trackingNumber}` +
            `${item.carrier ? ` (${item.carrier})` : ''} — ${
              TRACK_LABELS[item.status] ?? item.status ?? 'statut indisponible'
            }${item.deliveredAt ? `, livré le ${fullDate(item.deliveredAt)}` : ''}`,
        ),
      ].join('\n');

      try {
        await navigator.clipboard.writeText(text);
        toast('Preuve copiée — collez-la dans le formulaire Shopify.');
      } catch {
        prompt('Preuve à coller dans Shopify :', text);
      }
    }),
  );
}

const TRACK_LABELS = {
  NotFound: 'Introuvable chez le transporteur',
  InfoReceived: 'Pris en charge',
  InTransit: 'En transit',
  Expired: 'Suivi expiré',
  AvailableForPickup: 'À retirer',
  OutForDelivery: 'En cours de livraison',
  DeliveryFailure: 'Échec de livraison',
  Delivered: 'Livré',
  Exception: 'Incident',
};

/* ------------------------------------------------------------- horloges - */

/* L'équipe travaille avec des fournisseurs en Asie et des clients en Europe :
   l'heure locale décide si un appel a une chance d'aboutir maintenant. */
// Le sigle court est ce qui s'affiche en barre haute : des cadrans sans
// aucun nom obligeaient à compter les positions pour savoir lequel est Paris.
// Quatre villes, pour tenir sur une seule rangée jusque sur un téléphone.
const CLOCKS = [
  ['Paris', 'Europe/Paris', 'fr', 'PAR'],
  ['Chine', 'Asia/Shanghai', 'cn', 'CHN'],
  ['New York', 'America/New_York', 'us', 'NYC'],
  ['Los Angeles', 'America/Los_Angeles', 'us', 'LAX'],
];

/**
 * Chiffres ou aiguilles — un goût, pas une vérité : mémorisé par navigateur.
 * Les chiffres d'abord, comme le cadran de montre qui sert de modèle ; les
 * aiguilles pour qui les a choisies.
 */
function clockStyle() {
  return localStorage.getItem('csav.clocks') === 'analog' ? 'analog' : 'digital';
}

/**
 * L'état de chaque ville, calculé une fois et servi aux deux rendus.
 *
 * La barre haute et le panneau doivent dire la même chose : deux calculs
 * séparés finiraient par diverger d'une minute, et une horloge qui se
 * contredit ne sert plus à rien.
 */
function cityTimes(now) {
  return CLOCKS.map(([city, zone, code, short]) => {
    const time = now.toLocaleTimeString('fr-FR', {
      timeZone: zone,
      hour: '2-digit',
      minute: '2-digit',
    });

    const hour = Number(
      now.toLocaleString('en-GB', { timeZone: zone, hour: '2-digit', hour12: false }),
    );

    // Décalage avec l'heure du poste : c'est la question qu'on se pose avant
    // d'appeler — « chez lui, il est quelle heure par rapport à moi ? ».
    const there = new Date(now.toLocaleString('en-US', { timeZone: zone }));
    const here = new Date(now.toLocaleString('en-US'));
    const offset = Math.round((there - here) / 3600000);

    // Heures ouvrées locales : appeler un fournisseur à 3 h du matin chez lui
    // ne sert à rien, et c'est l'erreur que ces horloges évitent.
    const open = hour >= 9 && hour < 18;

    return { city, zone, code, short, time, hour, open, offset };
  });
}

/*
 * Deux étages.
 *
 * En barre haute : le sigle et l'heure, rien d'autre — comme l'horloge de la
 * barre des menus. Une ville hors horaires s'efface à moitié ; le point vert
 * ou ambre disait la même chose une seconde fois.
 *
 * Au clic : quatre cadrans de montre, sur une seule rangée. Les chiffres
 * hauts et fins du cadran numérique, la date en haut, deux complications
 * rondes en bas — le décalage, puis un soleil (joignable) ou une lune (hors
 * horaires). Hors horaires, la montre passe en veille, comme l'écran
 * toujours allumé.
 */
/*
 * Les heures locales portent `role="button"` depuis toujours, sans jamais
 * répondre au clavier : annoncé comme un bouton, inutilisable comme tel.
 */
$('clocks')?.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  event.preventDefault();
  $('clocks').click();
});

function renderClocks() {
  const now = new Date();

  // Des `span`, pas des boutons : c'est le conteneur qui est le bouton, et un
  // bouton dans un bouton n'est pas du HTML.
  const icone = `<svg class="ckp-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
    stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></svg>`;
  $('clocks').innerHTML = icone + cityTimes(now)
    .map(
      (c) => `<span class="ckp${c.open ? '' : ' shut'}"
        title="${esc(c.city)} — ${c.open ? 'heures ouvrées' : 'hors horaires (9 h – 18 h locales)'}">
        <span class="ckp-city">${esc(c.short)}</span>
        <b class="ckp-time">${c.time}</b>
      </span>`,
    )
    .join('');

  if (!$('clockpop')?.hidden) renderClockPop();
}

const ASTRE_SOLEIL =
  'M12 16a4 4 0 1 0 0-8a4 4 0 1 0 0 8M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4';
const ASTRE_LUNE = 'M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z';

/** Le décalage avec l'heure du poste, tel que la complication l'affiche. */
function ecartHoraire(offset) {
  return offset === 0 ? '=' : `${offset > 0 ? '+' : '−'}${Math.abs(offset)} h`;
}

/** Le cadran numérique : la date, l'heure en chiffres hauts, deux complications. */
function cadranChiffres(c, now) {
  const date = now
    .toLocaleDateString('fr-FR', { timeZone: c.zone, weekday: 'short', day: 'numeric' })
    .toUpperCase();
  return `<span class="montre-haut"><span>${esc(c.short)}</span><span>${esc(date)}</span></span>
    <span class="montre-heure"><span>${c.time}</span></span>
    <span class="montre-bas">
      <span class="montre-comp">${ecartHoraire(c.offset)}</span>
      <span class="montre-comp"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
        stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${
          c.open ? ASTRE_SOLEIL : ASTRE_LUNE
        }" /></svg></span>
    </span>`;
}

/** Le cadran à aiguilles : soixante graduations, quatre chiffres, trois aiguilles. */
function cadranAiguilles(c, now) {
  const there = new Date(now.toLocaleString('en-US', { timeZone: c.zone }));
  const minute = there.getMinutes();
  const secondes = there.getSeconds() + now.getMilliseconds() / 1000;
  const graduations = Array.from(
    { length: 60 },
    (_, i) => `<i class="mg${i % 5 === 0 ? ' mg5' : ''}" style="--a: ${i * 6}deg"></i>`,
  ).join('');
  const chiffres = [
    ['12', 'mn-h'],
    ['3', 'mn-d'],
    ['6', 'mn-b'],
    ['9', 'mn-g'],
  ]
    .map(([n, place]) => `<span class="mn ${place}">${n}</span>`)
    .join('');
  return `<span class="montre-ville">${esc(c.short)}</span>
    <span class="montre-cadran">
      ${graduations}${chiffres}
      <i class="ma ma-h" style="--a: ${((c.hour % 12) + minute / 60) * 30}deg"></i>
      <i class="ma ma-m" style="--a: ${(minute + secondes / 60) * 6}deg"></i>
      <i class="ma ma-s" style="animation-delay: ${-secondes}s"></i>
      <i class="ma-c"></i>
    </span>`;
}

function renderClockPop() {
  const pop = $('clockpop');
  if (!pop) return;

  const now = new Date();
  const aiguilles = clockStyle() === 'analog';

  pop.innerHTML = cityTimes(now)
    .map(
      (c) => `<div class="ckcard${c.open ? '' : ' shut'}">
        <div class="montre${aiguilles ? ' montre-aig' : ''}${c.open ? '' : ' veille'}" role="img"
          aria-label="${esc(c.city)}, ${c.time}, ${c.open ? 'joignable' : 'hors horaires'}">
          ${aiguilles ? cadranAiguilles(c, now) : cadranChiffres(c, now)}
        </div>
        <div class="ckcard-meta">
          <b>${esc(c.city)}</b>
          <span class="ckcard-sub">${
            c.offset === 0 ? 'même heure' : `${c.offset > 0 ? '+' : '−'}${Math.abs(c.offset)} h`
          } · ${c.open ? '<i class="ok">joignable</i>' : 'hors horaires'}</span>
        </div>
      </div>`,
    )
    .join('');
}

function toggleClockPop(force) {
  const pop = $('clockpop');
  if (!pop) return;

  const show = force ?? pop.hidden;
  pop.hidden = !show;
  if (show) {
    ouvrirCentre(false);
    renderClockPop();
  }
}

$('clocks')?.addEventListener('click', () => toggleClockPop());

document.addEventListener('click', (event) => {
  const pop = $('clockpop');
  if (!pop || pop.hidden) return;
  if (event.target.closest('#clockpop') || event.target.closest('#clocks')) return;
  pop.hidden = true;
});

setInterval(renderClocks, 30000);

/* ------------------------------------------------------------ navigation */

/* Icônes en ligne : une police d'icônes ou un CDN ne passerait pas la
   politique de sécurité, et douze glyphes ne justifient pas un build. */
const ICONS = {
  /*
   * Un symbole par écran, jamais deux fois le même.
   *
   * La colonne répétait la boîte cinq fois (Catalogue, Renvoi, Retour,
   * Ruptures…), le camion, l'euro, les personnes et le plateau deux fois
   * chacun : on ne repérait plus un écran à son icône. Chacun a maintenant la
   * sienne, au trait, comme les SF Symbols.
   */
  coins:
    '<ellipse cx="8" cy="4.2" rx="5" ry="1.9"/><path d="M3 4.2v3.6c0 1 2.2 1.9 5 1.9s5-.9 5-1.9V4.2M3 7.8v3.6c0 1 2.2 1.9 5 1.9s5-.9 5-1.9V7.8"/>',
  person: '<circle cx="8" cy="8" r="6"/><circle cx="8" cy="6.6" r="2"/><path d="M4.3 12.3c.8-1.3 2.1-2 3.7-2s2.9.7 3.7 2"/>',
  tag: '<path d="M2.5 2.5h5.2l5.8 5.8-5.2 5.2-5.8-5.8z"/><circle cx="5.4" cy="5.4" r="1"/>',
  factory: '<path d="M1.8 13.8V7.2l3.4-2v2.4l3.4-2v2.4l3.4-2v7.8z"/><path d="M1.2 13.8h13.6M4.6 11.2h1M8 11.2h1M11.4 11.2h1"/>',
  pencil: '<path d="M2.6 13.4l.8-3L11 2.8l2.2 2.2-7.6 7.6z"/><path d="M9.6 4.2l2.2 2.2"/>',
  card: '<rect x="1.8" y="3.4" width="12.4" height="9.2" rx="1.6"/><path d="M1.8 6.4h12.4M4.4 10h2.6"/>',
  cycle: '<path d="M13 6.4A5.2 5.2 0 0 0 3.6 4.6L2.8 5.4M2.8 2.6v2.8h2.8M3 9.6a5.2 5.2 0 0 0 9.4 1.8l.8-.8M13.2 13.4v-2.8h-2.8"/>',
  uturn: '<path d="M6 3 3 6l3 3"/><path d="M3 6h6.6a3.6 3.6 0 0 1 0 7.2H6.8"/>',
  bubble: '<path d="M2.5 3h11v7.6H7.2l-3.2 2.6v-2.6H2.5z"/><path d="M5 5.9h6M5 8.1h4"/>',
  clock: '<circle cx="8" cy="8" r="5.6"/><path d="M8 4.8V8l2.2 1.4"/>',
  bolt: '<path d="M9 1.5 3.5 9h3.6L7 14.5 12.5 7H8.9z"/>',
  grid: '<path d="M2.5 2.5h4.5v4.5H2.5zM9 2.5h4.5v4.5H9zM2.5 9h4.5v4.5H2.5zM9 9h4.5v4.5H9z"/>',
  inbox: '<path d="M2 9.5h3l1 2h4l1-2h3"/><path d="M2.5 9.5 4 3h8l1.5 6.5v4h-11z"/>',
  chart: '<path d="M2.5 13.5V7M6.5 13.5V3M10.5 13.5v-4M14 13.5V5.5"/>',
  bag: '<path d="M3 5h10l-.8 8.5H3.8z"/><path d="M6 5V3.5a2 2 0 0 1 4 0V5"/>',
  users:
    '<circle cx="6" cy="6" r="2.4"/><path d="M2 13.2c0-2.2 1.8-3.6 4-3.6s4 1.4 4 3.6"/><path d="M10.6 4.2a2.4 2.4 0 0 1 0 4.3M11.6 9.9c1.5.4 2.6 1.6 2.6 3.3"/>',
  box: '<path d="M8 2 14 5v6l-6 3-6-3V5z"/><path d="m2 5 6 3 6-3M8 8v6"/>',
  alerte: '<path d="M8 2.2 14.3 13.3H1.7z"/><path d="M8 6.6v3M8 11.6v.1"/>',
  truck:
    '<path d="M1.5 4.5h8v6h-8z"/><path d="M9.5 7h3l2 2v1.5h-5z"/><circle cx="4.5" cy="12" r="1.4"/><circle cx="11.5" cy="12" r="1.4"/>',
  pin: '<path d="M8 14s5-4.5 5-8A5 5 0 0 0 3 6c0 3.5 5 8 5 8z"/><circle cx="8" cy="6" r="1.8"/>',
  euro: '<path d="M12 4.2A4.5 4.5 0 0 0 5 8a4.5 4.5 0 0 0 7 3.8M3 7h5M3 9.4h5"/>',
  shield: '<path d="M8 2l5 2v4.2c0 3-2.2 4.8-5 5.6-2.8-.8-5-2.6-5-5.6V4z"/>',
  swatch: '<circle cx="8" cy="8" r="5.5"/><circle cx="8" cy="5.6" r="1"/><circle cx="10.2" cy="9" r="1"/><circle cx="5.8" cy="9" r="1"/>',
  gear: '<circle cx="8" cy="8" r="2.2"/><path d="M8 1.8v1.6M8 12.6v1.6M14.2 8h-1.6M3.4 8H1.8M12.4 3.6l-1.1 1.1M4.7 11.3l-1.1 1.1M12.4 12.4l-1.1-1.1M4.7 4.7 3.6 3.6"/>',
  // La fenêtre de rédaction : agrandir, restaurer, fermer.
  expand: '<path d="M9.5 2.5h4v4M6.5 13.5h-4v-4M13.5 2.5 9 7M2.5 13.5 7 9"/>',
  collapse: '<path d="M13.5 6.5h-4v-4M2.5 9.5h4v4M13.5 2.5 9.5 6.5M2.5 13.5 6.5 9.5"/>',
  check: '<path d="M3.5 8.5l3 3 6-7"/>',
  close: '<path d="M3.5 3.5l9 9M12.5 3.5l-9 9"/>',
  // Des chevrons, pas des flèches : précédent et suivant, comme dans Mail.
  prec: '<path d="M10 3.5 5.5 8l4.5 4.5"/>',
  suiv: '<path d="M6 3.5 10.5 8 6 12.5"/>',
  bas: '<path d="M3.5 6 8 10.5 12.5 6"/>',
  // Bulle et combiné, au trait comme les autres : pas de logo, pas de vert
  // plein — c'est une icône du produit, pas une bannière de WhatsApp.
  whatsapp:
    '<path d="M2.5 13.5l1-3.2A5.6 5.6 0 1 1 5.7 12.6z"/><path d="M6.2 6.3c0 2 1.5 3.5 3.5 3.5l.9-.9-1.2-.8-.7.5c-.6-.3-1.1-.8-1.4-1.4l.5-.7-.8-1.2z"/>',
};

/*
 * Shopify et Gmail, reconnaissables d'un coup d'œil.
 *
 * Le dépôt ne contient aucun fichier image et n'a pas de bibliothèque
 * d'icônes : ces deux marques sont donc dessinées ici, simplifiées, à la
 * taille d'une lettre. Elles portent leur couleur propre — c'est ce qui les
 * rend identifiables — mais restent sous les treize pixels : on veut une
 * marque, pas une bannière.
 */
const MARQUES = {
  shopify:
    '<path fill="#95BF47" d="M11.6 3.1c-.07-.05-.2-.03-.25-.02l-.7.16-.5-.5c-.15-.16-.45-.11-.57-.08l-.27.08c-.16-.47-.45-.9-.96-.9h-.05c-.15-.19-.33-.27-.49-.27-1.22.01-1.8 1.53-1.99 2.3l-.85.26c-.26.08-.27.09-.31.34L4 12.9l4.8.9L11.9 13l-.24-9.7c0-.1-.03-.16-.06-.2Z"/><path fill="#5E8E3E" d="M11.6 3.1c-.07-.05-.2-.03-.25-.02l-.7.16-.5-.5c-.06-.06-.14-.1-.22-.11L8.8 13.8 11.9 13l-.24-9.7c0-.1-.03-.16-.06-.2Z"/><path fill="#fff" d="M9.2 5.8 8.8 7c-.24-.12-.5-.18-.77-.18-.62 0-.65.39-.65.49 0 .53 1.4.74 1.4 2 0 .99-.63 1.63-1.47 1.63-1.01 0-1.53-.63-1.53-.63l.27-.9s.53.46 .98.46c.29 0 .41-.23.41-.4 0-.7-1.15-.73-1.15-1.88 0-.97.7-1.9 2.1-1.9.54 0 .81.15.81.15Z"/>',
  gmail:
    '<path fill="#EA4335" d="M2 4.1c0-.6.5-1.1 1.1-1.1h.5L8 6.4 12.4 3h.5c.6 0 1.1.5 1.1 1.1v.6L8 9 2 4.7v-.6Z"/><path fill="#34A853" d="M2 5.6 8 10l6-4.4v6.3c0 .6-.5 1.1-1.1 1.1h-1.6V7.6L8 10.2 4.7 7.6V13H3.1c-.6 0-1.1-.5-1.1-1.1V5.6Z"/>',
};

/** Une marque, à la taille d'une lettre. Fond propre, jamais l'encre du texte. */
function marque(name) {
  return `<svg class="marque" viewBox="0 0 16 16" aria-hidden="true">${MARQUES[name] ?? ''}</svg>`;
}

function ico(name) {
  return `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"
    stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] ?? ''}</svg>`;
}

/* Une entrée par écran : icône, libellé, groupe, et le compteur affiché en
   pastille quand il y a quelque chose à traiter. */
/* ============================================================ reshipment --
   Les retours clients, et le stock des agences qu'ils deviennent.

   Le circuit : le client renvoie (taille, défaut, modèle, ou remboursement
   sec) → l'agence du pays réceptionne → la paire contrôlée est remise en
   stock de l'agence → la prochaine commande du même article part de ce stock au
   lieu de l'atelier. Rien ne se gâche, le client proche est livré en trois
   jours.

   Et le nerf du suivi : un dossier sans nouvelle depuis trois jours se
   signale tout seul, avec la relance WhatsApp pré-écrite à un tap. */

const RETURN_REASONS = {
  SIZE: 'Taille',
  DEFECT: 'Défectueux',
  MODEL: 'Ne plaît pas',
  OTHER: 'Autre',
};

const RETURN_RESOLUTIONS = {
  EXCHANGE: 'Échange',
  REFUND: 'Remboursement',
};

const RETURN_STATUSES = {
  OPEN: 'Ouvert',
  LABEL_SENT: 'Bon envoyé',
  SHIPPED: 'Expédié',
  IN_TRANSIT: 'En transit',
  RECEIVED: "Livré à l'agence",
  RESTOCKED: 'En stock',
  UNUSABLE: 'Inutilisable',
  CLOSED: 'Clos',
};

/** Suivi universel : 17track connaît les transporteurs chinois et européens. */
function trackUrl(number) {
  return `https://t.17track.net/fr#nums=${encodeURIComponent(number)}`;
}

/* La photo au dossier : compressée avant l'envoi, comme celles des colis. */
async function shrinkReturnPhoto(file) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1400 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  return canvas.toDataURL('image/jpeg', 0.72);
}

const RETURN_COUNTRIES = { FR: 'France', ES: 'Espagne', IT: 'Italie', BE: 'Belgique' };

state.returns = { cases: [], counts: {}, agencies: [], matches: [], tab: 'echanges', country: 'FR' };

async function loadReturns() {
  try {
    const [data, agencies] = await Promise.all([
      api('/api/returns'),
      api('/api/return-agencies'),
    ]);
    state.returns.cases = data.cases ?? [];
    state.returns.counts = data.counts ?? {};
    state.returns.agencies = agencies.agencies ?? [];
  } catch (error) {
    toast(error.message, true);
    return;
  }

  // Le match interroge Shopify : plus lent, il arrive après coup plutôt que
  // de retenir tout l'écran.
  renderReturns();
  void api('/api/returns/matches')
    .then((data) => {
      state.returns.matches = data.matches ?? [];
      state.returns.matchMeta = { examinees: data.examinees ?? 0, tronque: Boolean(data.tronque), error: data.error ?? null };
      renderReturns();
    })
    .catch(() => {});
}

/** Relance WhatsApp pré-écrite : le message part du contexte du dossier. */
function returnWaLink(item) {
  const digits = (item.customerPhone ?? '').replace(/[^\d+]/g, '').replace(/^\+/, '');
  if (!digits) return null;

  const brand = state.me?.merchant?.brandName || state.me?.merchant?.name || '';
  const text = item.labelSent
    ? `Bonjour${item.customerName ? ` ${item.customerName}` : ''}, avez-vous pu déposer le colis retour de votre commande ${item.orderName ?? ''} (${item.productTitle}) ? Dites-nous si quelque chose bloque. — ${brand}`
    : `Bonjour${item.customerName ? ` ${item.customerName}` : ''}, nous revenons vers vous au sujet du retour de votre commande ${item.orderName ?? ''} (${item.productTitle}). — ${brand}`;

  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

/*
 * Le message qui annonce l'échange.
 *
 * Un échange n'est pas une commande Shopify : aucune expédition n'y est créée,
 * donc AUCUN e-mail automatique ne part. Sans ce message, le client verrait
 * arriver un colis sans avoir jamais su qu'il partait — et nous écrirait
 * entre-temps pour demander où en est son échange.
 *
 * WhatsApp quand on a son numéro, l'e-mail sinon : le canal par lequel il nous
 * a déjà parlé.
 */
function echangeMessage(item) {
  const marque = state.me?.merchant?.brandName || state.me?.merchant?.name || '';
  const voulu = [item.wantedTitle, item.wantedVariantTitle].filter(Boolean).join(' · ');
  return (
    `Bonjour${item.customerName ? ` ${item.customerName}` : ''}, votre échange vient de partir : ` +
    `${voulu}${item.orderName ? ` (commande ${item.orderName})` : ''}. ` +
    `Numéro de suivi : ${item.exchangeTrackingNumber ?? ''}` +
    `${item.exchangeCarrier ? ` — ${item.exchangeCarrier}` : ''}.` +
    `${marque ? ` — ${marque}` : ''}`
  );
}

function echangeLien(item) {
  const texte = echangeMessage(item);
  const chiffres = (item.customerPhone ?? '').replace(/[^\d+]/g, '').replace(/^\+/, '');
  if (chiffres) return `https://wa.me/${chiffres}?text=${encodeURIComponent(texte)}`;
  if (item.customerEmail) {
    const sujet = `Votre échange est parti${item.orderName ? ` — commande ${item.orderName}` : ''}`;
    return `mailto:${encodeURIComponent(item.customerEmail)}?subject=${encodeURIComponent(
      sujet,
    )}&body=${encodeURIComponent(texte)}`;
  }
  return null;
}

/*
 * Où en est l'envoi de l'échange.
 *
 * Quatre états, et un seul geste proposé à chaque fois : organiser l'envoi,
 * attendre le numéro de celui qui expédie, prévenir le client, c'est fait.
 * Ce bloc n'apparaît que pour un échange dont on sait ce que le client veut —
 * sans cela, personne ne saurait quoi envoyer.
 */
function blocEchange(item) {
  if (item.resolution !== 'EXCHANGE' || !item.wantedTitle) return '';

  const qui = item.exchangeAgence
    ? `${esc(item.exchangeAgence)}${item.exchangePays ? ` (${esc(nomPays(item.exchangePays))})` : ''}`
    : item.exchangeAtelier
      ? esc(item.exchangeAtelier)
      : '';

  // L'échange ne part qu'une fois la paire retournée reçue et contrôlée.
  if (!qui) {
    return item.status === 'RECEIVED'
      ? `<div class="ret-echange">
      <button class="btn btn-small btn-primary" data-ech-controler="${esc(item.id)}">Contrôler et valider</button>
    </div>`
      : '<div class="ret-echange"><small class="ret-veut">échange : à valider à la réception de la paire</small></div>';
  }

  if (!item.exchangeShippedAt) {
    return `<div class="ret-echange">
      <small class="ret-veut">envoi : ${qui} — en attente du numéro</small>
      <button class="btn btn-small" data-ret-echange-annuler="${esc(item.id)}">Annuler</button>
    </div>`;
  }

  const suivi = `<a class="qlink mono" href="${esc(trackUrl(item.exchangeTrackingNumber ?? ''))}"
    target="_blank" rel="noopener">${esc(item.exchangeTrackingNumber ?? '')}</a>`;

  if (item.exchangeNotifiedAt) {
    return `<div class="ret-echange">
      <small class="ret-veut">parti de ${qui} · ${suivi} · client prévenu</small>
    </div>`;
  }

  return `<div class="ret-echange">
    <small class="ret-veut">parti de ${qui} · ${suivi}</small>
    <button class="btn btn-small btn-primary" data-ret-echange-prevenu="${esc(item.id)}">Prévenir le client</button>
  </div>`;
}

function renderReturns() {
  const box = $('ret-body');
  const r = state.returns;

  $('ret-n-open').textContent = String(r.counts.open ?? 0);
  $('ret-n-match').textContent = String(r.matches.length);
  $('ret-n-stock').textContent = String(r.counts.stock ?? 0);
  $('ret-n-ech').textContent = String(echangesEnCours().filter((item) => !item.exchangeStockCaseId && !item.exchangeSupplierId).length);

  document
    .querySelectorAll('#ret-tabs [data-rtab]')
    .forEach((tab) => tab.setAttribute('aria-pressed', String(tab.dataset.rtab === r.tab)));

  if (r.tab === 'echanges') return renderEchanges(box);
  if (r.tab === 'cases') return renderReturnCases(box);
  if (r.tab === 'matches') return renderReturnMatches(box);
  if (r.tab === 'stock') return renderReturnStock(box);
  renderReturnAgencies(box);
}

/* ------------------------------------------------------------ échanges -- */

/*
 * Les échanges : la paire revient, on la contrôle, on valide — l'échange part.
 *
 * Un tableau à part des retours remboursés : ce qu'on renvoie, et dans quelle
 * pointure, est la question de la journée. « Valider » n'existe qu'une fois
 * la paire reçue : envoyer une paire neuve contre un colis qui n'est peut-être
 * jamais parti, c'est en offrir une.
 */
const QUATORZE_JOURS = 14 * 86_400_000;

function echangesEnCours() {
  return (state.returns.cases ?? []).filter(
    (item) =>
      item.origine !== 'MANUEL' &&
      item.resolution === 'EXCHANGE' &&
      item.wantedTitle &&
      item.status !== 'CLOSED' &&
      (!item.exchangeShippedAt || Date.now() - new Date(item.exchangeShippedAt).getTime() < QUATORZE_JOURS),
  );
}

/** Où en est un échange : le mot, ce qui le précise, sa couleur. */
function etatEchange(item) {
  if (item.exchangeShippedAt) return ['Envoyé', `suivi ${item.exchangeTrackingNumber ?? ''}`.trim(), 'ok'];
  if (item.exchangeStockCaseId) return ['Pris dans le stock', item.exchangeAgence ? `${item.exchangeAgence} l’expédie` : 'l’agence l’expédie', 'ok'];
  if (item.exchangeSupplierId) return ['Chez l’atelier', `${item.exchangeAtelier ?? 'l’atelier'} prévenu`, 'ok'];
  if (item.status === 'RECEIVED') return ['Reçue', 'à contrôler, puis valider', 'accent'];
  if (['LABEL_SENT', 'SHIPPED', 'IN_TRANSIT'].includes(item.status) || item.labelSent) {
    return ['En route', item.trackingNumber ? 'colis retour suivi' : 'bon envoyé au client', 'warn'];
  }
  return ['Bon à envoyer', 'le client attend son bon', 'crit'];
}

const nomPaire = (titre, variante) => [titre, variante].filter(Boolean).join(' · ');

function renderEchanges(box) {
  const items = echangesEnCours();
  const ordre = (item) => (item.status === 'RECEIVED' && !item.exchangeStockCaseId && !item.exchangeSupplierId ? 0 : item.exchangeShippedAt ? 3 : item.exchangeStockCaseId || item.exchangeSupplierId ? 2 : 1);
  items.sort((a, b) => ordre(a) - ordre(b) || new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  const compte = (garde) => items.filter(garde).length;
  const chiffres = [
    ['Bon à envoyer', compte((item) => etatEchange(item)[0] === 'Bon à envoyer'), 'le client n’a pas son bon', 'crit'],
    ['En route', compte((item) => etatEchange(item)[0] === 'En route'), 'colis retour en transit', 'warn'],
    ['À contrôler et valider', compte((item) => etatEchange(item)[0] === 'Reçue'), 'paire reçue par l’agence', 'accent'],
    ['Envoyés, 14 jours', compte((item) => Boolean(item.exchangeStockCaseId || item.exchangeSupplierId)), 'stock ou atelier', 'ok'],
  ];

  box.innerHTML = `<div class="ech-chiffres">${chiffres
    .map(
      ([titre, n, sous, ton]) => `<div class="rup-chiffre rup-chiffre-fixe"><span class="rup-chiffre-t"><i class="rup-point rup-point-${ton}" aria-hidden="true"></i>${esc(titre)}</span><b>${n}</b><small>${esc(sous)}</small></div>`,
    )
    .join('')}</div>
  <section class="ech-liste">
    <div class="ech-tete"><b>Échanges en cours</b><span>La paire revient, on contrôle, on valide : l’échange part.</span></div>
    ${
      items.length
        ? `<div class="ech-ligne ech-entete" aria-hidden="true"><span>Client</span><span>Commande</span><span>Revient</span><span>À renvoyer</span><span>Bon de retour</span><span>État</span><span></span></div>
    ${items
      .map((item) => {
        const [etat, sous, ton] = etatEchange(item);
        const change = item.wantedTitle && item.wantedTitle !== item.productTitle;
        const fait = Boolean(item.exchangeStockCaseId || item.exchangeSupplierId);
        const supprimer = `<button class="ico ico-del ech-suppr" type="button" data-ech-suppr="${esc(item.id)}" title="Supprimer" aria-label="Supprimer l’échange">${ico('close')}</button>`;
        // Plus cher, lien de paiement : tant que ce n'est pas payé, l'échange attend.
        const attentePaiement = item.ecartChoix === 'LIEN' && !item.payeLe && !fait;
        const geste = fait
          ? `<span class="rmb-af-ok">${ico('check')}${esc(item.exchangeStockCaseId ? 'Pris dans le stock' : 'Atelier prévenu')}</span>`
          : attentePaiement
            ? `<span class="ech-paiement"><button class="btn btn-small" type="button" data-ech-lien="${esc(item.id)}">${
                item.lienEnvoyeLe ? 'Renvoyer le lien' : 'Envoyer le lien'
              }</button><button class="linkish" type="button" data-ech-paye="${esc(item.id)}">Marquer payé</button></span>`
            : item.status === 'RECEIVED'
            ? `<button class="btn btn-small btn-primary" type="button" data-ech-controler="${esc(item.id)}">Contrôler et valider</button>`
            : '<span class="ech-attente" title="« Valider » s’ouvre quand la paire est reçue par l’agence">Valider · à la réception</span>';
        return `<div class="ech-ligne">
          <span class="ech-cell"><b>${esc(item.customerName ?? '—')}</b><small>${ageMarkup(item.createdAt, fait)} ${esc(RETURN_COUNTRIES[item.country] ?? item.country ?? '')}</small></span>
          <b>${esc(item.orderName ?? '—')}</b>
          <span class="ech-cell"><b>${esc(nomPaire(item.productTitle, item.variantTitle))}</b><small>${esc(RETURN_REASONS[item.reason] ?? '')}</small></span>
          <span class="ech-cell"><b>${esc(nomPaire(item.wantedTitle, item.wantedVariantTitle))}</b><small class="${change ? 'ech-change' : ''}">${esc(change ? 'modèle changé' : 'même modèle, autre déclinaison')}</small>${ecartEchangeMarkup(item)}</span>
          <span class="ech-cell"><span class="mono">${esc(item.trackingNumber ?? '—')}</span><small>${esc(item.labelSent ? 'bon fourni' : 'bon à envoyer')}</small></span>
          <span class="ech-cell"><span class="rup-file rup-file-${ton}">${esc(etat)}</span><small class="rup-file-sous">${esc(sous)}</small></span>
          <span class="ech-geste">${geste}${supprimer}</span>
        </div>`;
      })
      .join('')}`
        : '<p class="rmb-vide">Aucun échange en cours. Un échange s’ouvre depuis le mail du client, ou « Nouveau retour » avec « Un échange ».</p>'
    }
  </section>
  <p class="ech-aide">« Valider » : si une paire identique dort dans le stock retours, elle part de l’agence ; sinon la notification arrive chez l’atelier, dans son tableau Échanges. La paire retournée entre d’elle-même dans Stock retours.</p>`;
}

/* L'écart de prix d'un échange, sous la paire à renvoyer : qui paie quoi, et où on en est. */
function ecartEchangeMarkup(item) {
  const ecart = Number(item.ecartPrix);
  if (item.ecartPrix === null || item.ecartPrix === undefined || !Number.isFinite(ecart) || Math.abs(ecart) < 0.005) return '';
  const montant = `${ecart > 0 ? '+' : '−'} ${euro(Math.abs(ecart), item.devise ?? 'EUR')}`;
  const [texte, ton] = {
    LIEN: item.payeLe
      ? ['différence payée', 'ok']
      : item.lienErreur
        ? [`lien non envoyé : ${item.lienErreur}`, 'crit']
        : item.lienEnvoyeLe
          ? ['lien envoyé, en attente du paiement', 'warn']
          : ['lien à envoyer', 'warn'],
    OFFERT: ['différence offerte', 'ok'],
    REMBOURSER: ['à rembourser après le contrôle', 'accent'],
    GARDER: ['rien à rembourser', 'ok'],
  }[item.ecartChoix] ?? ['', 'ok'];
  return `<small class="ech-ecart ech-ecart-${ton}"><b>${esc(montant)}</b> · ${esc(texte)}</small>`;
}

const fenEch = { dossier: null, envoi: false };

function ouvrirControleEchange(item) {
  if (!item) return;
  fenEch.dossier = item;
  fenEch.envoi = false;
  $('ech-title').textContent = `Contrôle · ${item.orderName ?? ''}`.trim();
  $('ech-sub').textContent = [item.customerName, item.agency?.name ? `reçue par ${item.agency.name}` : 'paire reçue'].filter(Boolean).join(' · ');
  $('ech-revient').innerHTML = `<b>${esc(nomPaire(item.productTitle, item.variantTitle))}</b><small>la paire qui revient${
    item.reason === 'DEFECT' ? ' · défaut : elle sortira comme inutilisable' : ' · elle entrera au stock retours'
  }</small>`;
  // Qui enverra : une paire identique en stock, sinon l'atelier.
  const voulue = (state.returns.cases ?? []).find(
    (paire) =>
      paire.id !== item.id &&
      paire.status === 'RESTOCKED' &&
      !paire.reusedAt &&
      (item.wantedSku ? paire.sku === item.wantedSku : paire.productTitle === item.wantedTitle && (paire.variantTitle ?? '') === (item.wantedVariantTitle ?? '')),
  );
  $('ech-envoyer').innerHTML = `<b>À renvoyer : ${esc(nomPaire(item.wantedTitle, item.wantedVariantTitle))}</b><small>${esc(
    voulue
      ? `Une paire identique est dans le stock retours${voulue.agency?.name ? ` (${voulue.agency.name})` : ''} : elle partira de là.`
      : 'Pas de paire identique en stock : la notification part chez l’atelier du modèle.',
  )}</small>`;
  $('ech-modal').querySelectorAll('[data-ech-critere]').forEach((caseACocher) => (caseACocher.checked = false));
  majControleEchange();
  $('ech-modal').hidden = false;
  $('ech-modal').classList.add('open');
}

function majControleEchange() {
  const tous = [...$('ech-modal').querySelectorAll('[data-ech-critere]')].every((caseACocher) => caseACocher.checked);
  $('ech-pied').textContent = tous ? 'La paire retournée entre dans Stock retours.' : 'Cochez les trois points du contrôle.';
  $('ech-pied').classList.toggle('ra-pied-manque', !tous);
  $('ech-valider').disabled = !tous || fenEch.envoi;
}

function fermerControleEchange() {
  $('ech-modal').hidden = true;
  $('ech-modal').classList.remove('open');
  fenEch.dossier = null;
}

$('ret-body')?.addEventListener('click', async (event) => {
  const lien = event.target.closest('[data-ech-lien]');
  if (lien) {
    lien.disabled = true;
    try {
      await api(`/api/returns/${lien.dataset.echLien}/lien`, { method: 'POST', body: '{}' });
      toast('Lien de paiement envoyé au client.');
    } catch (error) {
      toast(error.message, true);
    }
    await loadReturns();
    return;
  }
  const paye = event.target.closest('[data-ech-paye]');
  if (paye) {
    if (!(await confirmer('Marquer la différence comme payée ?\n\nL’échange pourra partir. À faire seulement si le client a bien réglé.', { action: 'Marquer payé', icone: 'ok' }))) return;
    try {
      await api(`/api/returns/${paye.dataset.echPaye}/paye`, { method: 'POST', body: '{}' });
      toast('Différence notée comme payée : l’échange peut partir.');
    } catch (error) {
      toast(error.message, true);
    }
    await loadReturns();
    return;
  }
  const suppr = event.target.closest('[data-ech-suppr]');
  if (suppr) {
    const item = state.returns.cases.find((dossier) => dossier.id === suppr.dataset.echSuppr);
    if (!await confirmer(`Supprimer l’échange ${item?.orderName ?? ''} ?\n\nUne paire du stock réservée pour lui y retourne.`, { action: 'Supprimer', danger: true, icone: 'corbeille' })) return;
    try {
      await api(`/api/returns/${suppr.dataset.echSuppr}`, { method: 'DELETE' });
      toast('Échange supprimé.');
      await loadReturns();
    } catch (error) {
      toast(error.message, true);
    }
    return;
  }
  const bouton = event.target.closest('[data-ech-controler]');
  if (!bouton) return;
  ouvrirControleEchange(state.returns.cases.find((item) => item.id === bouton.dataset.echControler));
});
$('ech-modal')?.addEventListener('change', majControleEchange);
$('ech-fermer')?.addEventListener('click', fermerControleEchange);
$('ech-modal')?.addEventListener('click', (event) => {
  if (event.target === event.currentTarget) fermerControleEchange();
});
$('ech-modal')?.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') fermerControleEchange();
});
$('ech-valider')?.addEventListener('click', async () => {
  const item = fenEch.dossier;
  if (!item || fenEch.envoi) return;
  fenEch.envoi = true;
  majControleEchange();
  try {
    const resultat = await api(`/api/returns/${item.id}/echange/valider`, {
      method: 'POST',
      body: JSON.stringify({ conforme: true, propre: true, complet: true }),
    });
    fermerControleEchange();
    toast(
      resultat.source === 'STOCK'
        ? `Échange validé : la paire part du stock (${resultat.agence ?? 'agence'}).`
        : `Échange validé : ${resultat.atelier ?? 'l’atelier'} est prévenu.`,
    );
    await loadReturns();
  } catch (error) {
    fenEch.envoi = false;
    majControleEchange();
    toast(error.message, true);
  }
});

/** Les statuts qui terminent un dossier : il quitte les dossiers en cours. */
const RETOURS_FINIS = ['CLOSED', 'UNUSABLE'];

function renderReturnCases(box) {
  // Une paire ajoutée à la main est du stock, pas un dossier de retour.
  const dossiers = state.returns.cases.filter((item) => item.origine !== 'MANUEL');
  /*
   * Un dossier clos ne disparaît plus.
   *
   * Passer le statut à « Clos » le faisait sortir du tableau sur-le-champ :
   * on croyait l'avoir supprimé, et on ne pouvait plus le rouvrir. Il descend
   * maintenant sous les dossiers en cours, grisé, avec son statut toujours
   * modifiable. Les dix plus récents d'abord ; le reste sur demande.
   */
  const items = dossiers.filter((item) => !RETOURS_FINIS.includes(item.status));
  const finis = dossiers.filter((item) => RETOURS_FINIS.includes(item.status));
  const finisAffiches = state.returns.voirClos ? finis : finis.slice(0, 10);
  const silentSince = Date.now() - 3 * 24 * 60 * 60 * 1000;

  if (dossiers.length === 0) {
    box.innerHTML = `<div class="empty-block">
      <b>Aucun dossier de retour en cours.</b>
      <p>Le circuit : le client renvoie → l'agence du pays réceptionne → la
      paire contrôlée entre au stock de l’agence → la prochaine commande du même
      article part de ce stock, livrée en trois jours au lieu de quinze.</p>
      <p>« Nouveau retour » ouvre le premier dossier — tapez le numéro de
      commande, le reste se remplit tout seul. Pensez d'abord à renseigner
      vos agences dans l'onglet Agences.</p>
    </div>`;
    return;
  }

  box.innerHTML = `<div class="table-wrap"><table class="grid"><thead><tr>
      <th>Commande</th><th>Client</th><th>Article</th>
      <th>Bon de retour</th><th>Colis retour</th><th>Statut</th><th></th>
    </tr></thead><tbody>
    ${items.length ? '' : '<tr class="ret-vide"><td colspan="7">Aucun dossier de retour en cours.</td></tr>'}
    ${[...items, ...finisAffiches]
      .map((item, rang) => {
        const silent =
          ['OPEN', 'LABEL_SENT'].includes(item.status) &&
          new Date(item.lastContactAt).getTime() < silentSince;
        const wa = returnWaLink(item);
        const fini = RETOURS_FINIS.includes(item.status);
        // L'intertitre, avant le premier dossier clos.
        const intertitre =
          rang === items.length
            ? `<tr class="ret-sep"><td colspan="7">Clos et inutilisables · ${finis.length}</td></tr>`
            : '';

        return `${intertitre}<tr data-ret="${esc(item.id)}"${
          silent ? ' class="ret-silent"' : fini ? ' class="ret-clos"' : ''
        }>
          <td><b>${esc(item.orderName ?? '—')}</b><br /><small>${esc(
            RETURN_COUNTRIES[item.country] ?? item.country ?? '',
          )}</small></td>
          <td>${esc(item.customerName ?? '—')}${
            silent
              ? '<br /><span class="ret-tag bad">3 j sans réponse</span>'
              : ''
          }</td>
          <td>
            <b>${esc(item.productTitle)}</b>${
              item.variantTitle ? ` <small>${esc(item.variantTitle)}</small>` : ''
            }
            ${
              // Pour un échange, ce que le client attend en retour : sans lui,
              // le dossier ne dit pas ce qu'il faut lui envoyer.
              item.resolution === 'EXCHANGE' && item.wantedTitle
                ? `<small class="ret-veut">veut : ${esc(item.wantedTitle)}${
                    item.wantedVariantTitle ? ` · ${esc(item.wantedVariantTitle)}` : ''
                  }</small>`
                : ''
            }
            ${blocEchange(item)}
            <div class="ret-tags">
              <span class="ret-tag ${item.reason === 'DEFECT' ? 'warn' : 'dim'}">${esc(
                RETURN_REASONS[item.reason] ?? item.reason,
              )}</span>
              <span class="ret-tag ${item.resolution === 'REFUND' ? 'warn' : 'ok'}">${esc(
                RETURN_RESOLUTIONS[item.resolution] ?? item.resolution,
              )}</span>
            </div>
          </td>
          <td>
            <label class="switch" style="margin:0">
              <input type="checkbox" data-ret-label="${esc(item.id)}"${
                item.labelSent ? ' checked' : ''
              } />
              <span>${item.labelSent ? 'Fourni' : 'À fournir'}</span>
            </label>
          </td>
          <td>
            <div class="ret-track">
              <input type="text" class="mono" data-ret-track="${esc(item.id)}"
                placeholder="N° de suivi" value="${esc(item.trackingNumber ?? '')}" />
              ${
                item.trackingNumber
                  ? `<a class="qlink" href="${esc(trackUrl(item.trackingNumber))}"
                      target="_blank" rel="noopener">Où est-il ?</a>`
                  : ''
              }
            </div>
          </td>
          <td>
            <select data-ret-status="${esc(item.id)}">
              ${Object.entries(RETURN_STATUSES)
                .map(
                  ([key, label]) =>
                    `<option value="${key}"${key === item.status ? ' selected' : ''}>${esc(
                      label,
                    )}</option>`,
                )
                .join('')}
            </select>
            ${
              // Le contrôle à la réception : deux gestes, pas un menu.
              item.status === 'RECEIVED'
                ? `<div class="ret-controle">
                    <button class="btn btn-small" data-ret-restock="${esc(item.id)}">En stock</button>
                    <button class="btn btn-small btn-danger" data-ret-defect="${esc(item.id)}">Défectueux</button>
                  </div>`
                : ''
            }
          </td>
          <td style="white-space:nowrap">
            ${
              wa
                ? `<button class="ret-wa" data-ret-wa="${esc(item.id)}"
                    title="Relancer ce client sur WhatsApp" aria-label="Relancer sur WhatsApp">${ico('whatsapp')}</button>`
                : ''
            }
            ${
              item.hasPhoto
                ? `<a class="ico" href="/api/returns/${esc(item.id)}/photo" target="_blank"
                    rel="noopener" title="Voir la photo de l’article" aria-label="Voir la photo">
                    <svg viewBox="0 0 20 20" aria-hidden="true">
                      <rect x="2.5" y="5.5" width="15" height="11" rx="2" />
                      <circle cx="10" cy="11" r="3.2" />
                    </svg>
                  </a>`
                : ''
            }
            <label class="ico" title="${item.hasPhoto ? 'Remplacer la photo' : 'Ajouter une photo de l’article'}">
              <svg viewBox="0 0 20 20" aria-hidden="true">
                <rect x="2.5" y="5.5" width="15" height="11" rx="2" />
                <circle cx="10" cy="11" r="3.2" />
                <path d="M7 5.5 8.2 3.5h3.6L13 5.5" />
              </svg>
              <input type="file" accept="image/*" hidden data-ret-photo="${esc(item.id)}" />
            </label>
            <button class="ico ico-del" data-ret-del="${esc(item.id)}" title="Supprimer">
              <svg viewBox="0 0 20 20" aria-hidden="true">
                <path d="M4 6h12M8.5 6V4.5h3V6M6 6l.8 10h6.4L14 6M8.4 9v4.6M11.6 9v4.6" />
              </svg>
            </button>
          </td>
        </tr>`;
      })
      .join('')}
    ${
      finis.length > finisAffiches.length
        ? `<tr class="ret-plus"><td colspan="7"><button class="btn btn-small" type="button" data-ret-clos-tous>Voir les ${
            finis.length - finisAffiches.length
          } autres dossiers clos</button></td></tr>`
        : ''
    }
    </tbody></table></div>`;
}

$('ret-body')?.addEventListener('click', (event) => {
  if (!event.target.closest('[data-ret-clos-tous]')) return;
  state.returns.voirClos = true;
  renderReturns();
});

/** Un pays, en toutes lettres. */
/* Les pays des agences d'abord ; les autres en toutes lettres, en français
   (« États-Unis », pas « US ») — un client peut commander de partout. */
const nomsDeRegions = typeof Intl.DisplayNames === 'function' ? new Intl.DisplayNames(['fr'], { type: 'region' }) : null;
const nomPays = (code) => {
  if (!code) return '—';
  if (RETURN_COUNTRIES[code]) return RETURN_COUNTRIES[code];
  try {
    return (/^[A-Z]{2}$/.test(code) && nomsDeRegions?.of(code)) || code;
  } catch {
    return code;
  }
};

/** L'adresse de livraison, telle que l'agence l'écrira sur le colis. */
function adresseTexte(adresse) {
  if (!adresse) return '';
  return [
    adresse.name,
    adresse.address1,
    adresse.address2,
    [adresse.zip, adresse.city].filter(Boolean).join(' '),
    nomPays(adresse.country),
    adresse.phone,
  ]
    .filter(Boolean)
    .join('\n');
}

/*
 * Les propositions : chaque commande en attente qu'une agence peut servir EN
 * ENTIER, même pays d'abord, pays voisin ensuite. Le compte des commandes
 * examinées est affiché : un « aucun match » doit pouvoir se lire comme
 * « rien ne correspond », pas comme « on n'a pas regardé ».
 */
function renderReturnMatches(box) {
  const { matches, matchMeta = {}, derniere } = state.returns;

  const confiee = derniere
    ? `<div class="notice ret-confie">
        <span class="notice-mark">Confiée</span>
        <div>
          <b>${esc(derniere.commande)} part du stock retours — ${esc(nomPays(derniere.paysStock))}.</b>
          Elle a disparu de la liste de l’atelier, qui ne l’expédiera pas.
          <p>À expédier par : <b>${esc(derniere.agenceContact?.name ?? derniere.agence?.nom ?? 'l’agence')}</b>${
            derniere.agenceContact?.email ? ` · ${esc(derniere.agenceContact.email)}` : ''
          }${derniere.agenceContact?.phone ? ` · ${esc(derniere.agenceContact.phone)}` : ''}</p>
          <pre class="ret-adresse">${esc(adresseTexte(derniere.adresse))}</pre>
          <div class="ret-controle">
            <button class="btn btn-small" data-ret-copier="${esc(adresseTexte(derniere.adresse))}">Copier l’adresse</button>
            <button class="btn btn-small" data-ret-fermer>Fermer</button>
          </div>
        </div>
      </div>`
    : '';

  const meta = matchMeta.error
    ? `<p class="ret-meta">${esc(matchMeta.error)}</p>`
    : `<p class="ret-meta">Commandes en attente examinées : ${matchMeta.examinees ?? 0}. Même pays d’abord,
        puis pays voisin ; les paires les plus anciennes partent en premier.${
          matchMeta.tronque ? ' <b>Seules les 1 000 plus anciennes ont été examinées.</b>' : ''
        }</p>`;

  box.innerHTML =
    confiee +
    meta +
    (matches.length
      ? `<div class="table-wrap"><table class="grid"><thead><tr>
          <th>Commande en attente</th><th>Client</th><th>Paires</th><th>Part de</th><th></th>
        </tr></thead><tbody>
        ${matches
          .map(
            (match, rang) => `<tr>
              <td><b>${esc(match.commande)}</b><br /><small>${esc(nomPays(match.pays))}</small></td>
              <td>${esc(match.client ?? '—')}</td>
              <td>${match.paires
                .map(
                  (paire) => `<div>${esc(paire.titre)}${
                    paire.declinaison ? ` <small>${esc(paire.declinaison)}</small>` : ''
                  } <small class="sub">retour ${esc(paire.retourDe ?? '—')}</small></div>`,
                )
                .join('')}</td>
              <td><span class="ret-tag ${match.voisin ? 'warn' : 'ok'}">${esc(nomPays(match.paysStock))}${
                match.agence?.nom ? ` · ${esc(match.agence.nom)}` : ''
              }</span><br /><small>${match.voisin ? 'pays voisin' : 'même pays'}</small></td>
              <td><button class="btn btn-small btn-primary" data-ret-serve="${rang}">Servir depuis le stock</button></td>
            </tr>`,
          )
          .join('')}
        </tbody></table></div>`
      : `<p class="empty" style="padding:20px">
          Aucune commande à servir pour le moment. Dès qu’une commande en attente, que
          l’atelier n’a pas commencée, porte un article présent chez une agence de son
          pays ou d’un pays voisin, elle apparaît ici.
        </p>`);
}

/*
 * Le stock retours, là où il se trouve : par pays, puis par agence. Chaque
 * paire peut sortir du stock pour défaut ; les paires déjà confiées à une
 * commande sont à part, et se libèrent — la commande revient alors à
 * l'atelier.
 */
function renderReturnStock(box) {
  const cases = state.returns.cases;
  const stock = cases.filter((item) => item.status === 'RESTOCKED' && !item.reusedAt);
  const confiees = cases.filter((item) => item.reusedShopifyOrderId);
  const joursDepuis = (date) => Math.max(0, Math.floor((Date.now() - new Date(date).getTime()) / 86_400_000));

  const parPays = new Map();
  for (const item of stock) {
    // Sans agence, une paire ajoutée à la main est chez le marchand.
    const pays = item.agency?.country ?? (item.origine === 'MANUEL' ? 'MAISON' : (item.country ?? '—'));
    const agence = item.agency?.name ?? (item.origine === 'MANUEL' ? 'Chez vous' : 'Sans agence');
    if (!parPays.has(pays)) parPays.set(pays, new Map());
    const parAgence = parPays.get(pays);
    parAgence.set(agence, [...(parAgence.get(agence) ?? []), item]);
  }

  const sections = [...parPays.entries()]
    .map(
      ([pays, parAgence]) => `<section class="ret-pays">
        <h3>${esc(pays === 'MAISON' ? 'Chez vous' : nomPays(pays))} <span class="count">${[...parAgence.values()].flat().length}</span></h3>
        ${[...parAgence.entries()]
          .map(
            ([agence, items]) => `${pays === 'MAISON' ? '' : `<h4>${esc(agence)}</h4>`}
              <div class="ret-grid">${items
                .map(
                  (item) => `<div class="ret-card">
                    <b>${esc(item.productTitle)}</b>
                    <small>${esc([item.variantTitle, item.sku].filter(Boolean).join(' · '))}</small>
                    <small>${
                      item.origine === 'MANUEL'
                        ? `ajout manuel${item.note ? ` · ${esc(item.note)}` : ''}`
                        : `retour ${esc(item.orderName ?? '—')} · ${esc(RETURN_REASONS[item.reason] ?? '')}`
                    } · en stock depuis ${joursDepuis(item.restockedAt ?? item.updatedAt)} j</small>
                    <button class="btn btn-small btn-danger" data-ret-defect="${esc(item.id)}">${
                      item.origine === 'MANUEL' ? 'Retirer du stock' : 'Défectueux — sortir du stock'
                    }</button>
                  </div>`,
                )
                .join('')}</div>`,
          )
          .join('')}
      </section>`,
    )
    .join('');

  // Les paires confiées, regroupées par commande : une commande de deux
  // paires se libère d'un seul geste.
  const parCommande = new Map();
  for (const item of confiees) {
    parCommande.set(item.reusedShopifyOrderId, [...(parCommande.get(item.reusedShopifyOrderId) ?? []), item]);
  }
  const confieesMarkup = parCommande.size
    ? `<section class="ret-pays">
        <h3>Confiées à une commande <span class="count">${parCommande.size}</span></h3>
        <div class="table-wrap"><table class="grid"><thead><tr>
          <th>Commande</th><th>Paires</th><th>Part de</th><th>Envoi de l’agence</th><th></th>
        </tr></thead><tbody>${[...parCommande.entries()]
          .map(([idCommande, items]) => {
            const premiere = items[0];
            return `<tr>
              <td><b>${esc(premiere.reusedOrderName ?? '—')}</b></td>
              <td>${items
                .map((item) => `<div>${esc(item.productTitle)}${item.variantTitle ? ` <small>${esc(item.variantTitle)}</small>` : ''}</div>`)
                .join('')}</td>
              <td>${esc(nomPays(premiere.agency?.country ?? premiere.country))}${
                premiere.agency?.name ? ` · ${esc(premiere.agency.name)}` : ''
              }</td>
              <td>${
                premiere.reshippedAt
                  ? `<span class="ret-tag ok">Expédiée</span> <span class="mono">${esc(premiere.reshipTrackingNumber ?? '')}</span>`
                  : `<span class="ret-tag warn">À expédier</span> <small>confiée il y a ${
                      premiere.reusedAt ? joursDepuis(premiere.reusedAt) : 0
                    } j</small>`
              }</td>
              <td>${
                // Une fois l'agence passée, la paire est partie : plus rien à libérer.
                premiere.reshippedAt
                  ? ''
                  : `<button class="btn btn-small" data-ret-liberer="${esc(idCommande)}"
                      data-ret-order="${esc(premiere.reusedOrderName ?? '')}">Libérer</button>`
              }</td>
            </tr>`;
          })
          .join('')}</tbody></table></div>
      </section>`
    : '';

  box.innerHTML =
    `<div class="ret-stock-barre">
      <button class="btn btn-small btn-primary" type="button" id="stk-ouvrir">Ajouter au stock</button>
      <small>Fin de série, paire d'exposition… : des paires qui ne viennent pas d'un retour.</small>
    </div>` +
    (stock.length
      ? sections
      : `<p class="empty" style="padding:20px">
          Rien en stock. Les retours contrôlés et passés « En stock » arrivent ici, rangés
          par pays et par agence, prêts au réemploi — avec les paires ajoutées à la main.
        </p>`) + confieesMarkup;
  $('stk-ouvrir')?.addEventListener('click', () => void ouvrirAjoutStock());
}

/* ==========================================================================
   AJOUTER AU STOCK, À LA MAIN

   Le modèle se choisit dans le catalogue Shopify, la déclinaison dans ses
   variantes : écrits à la main, ils ne correspondraient jamais à une
   commande, et la paire dormirait sur l'étagère.
   ========================================================================== */

const ajoutStock = { produit: null, declinaisons: [], minuteur: null };

async function ouvrirAjoutStock() {
  ajoutStock.produit = null;
  ajoutStock.declinaisons = [];
  $('stk-produit').value = '';
  $('stk-decli').innerHTML = '<option value="">Choisissez d’abord le modèle</option>';
  $('stk-decli').disabled = true;
  $('stk-qte').value = '1';
  $('stk-note').value = '';
  $('stk-save').disabled = true;
  await ensureReturnAgencies();
  $('stk-agence').innerHTML =
    '<option value="">Chez moi</option>' +
    state.returns.agencies
      .map((agence) => `<option value="${esc(agence.id)}">${esc(agence.name)} (${esc(agence.country)})</option>`)
      .join('');
  $('stk-modal').hidden = false;
  $('stk-modal').classList.add('open');
  $('stk-produit').focus();
}

function fermerAjoutStock() {
  document.querySelectorAll('#stk-modal .pickbox').forEach((boite) => boite.remove());
  $('stk-modal').hidden = true;
  $('stk-modal').classList.remove('open');
}

async function chercherModeleStock() {
  const champ = $('stk-produit');
  document.querySelectorAll('#stk-modal .pickbox').forEach((boite) => boite.remove());
  const terme = champ.value.trim();
  if (terme.length < 2) return;
  const boite = document.createElement('div');
  boite.className = 'pickbox';
  boite.innerHTML = '<div class="pick-empty">Recherche…</div>';
  champ.parentElement.append(boite);
  try {
    const { options } = await api(`/api/variant-options?${new URLSearchParams({ scope: 'PRODUCT', q: terme })}`);
    boite.innerHTML = options.length
      ? options
          .map(
            (option) => `<button type="button" class="pick-item" data-stk-produit="${esc(option.value)}">
              ${option.image ? `<img src="${esc(option.image)}" alt="" loading="lazy" />` : ''}
              <span>${esc(option.value)}</span>
            </button>`,
          )
          .join('')
      : '<div class="pick-empty">Aucun modèle trouvé dans le catalogue.</div>';
  } catch (error) {
    boite.innerHTML = `<div class="pick-empty">${esc(error.message)}</div>`;
  }
}

async function choisirModeleStock(produit) {
  ajoutStock.produit = produit;
  $('stk-produit').value = produit;
  document.querySelectorAll('#stk-modal .pickbox').forEach((boite) => boite.remove());
  const choix = $('stk-decli');
  choix.disabled = true;
  choix.innerHTML = '<option value="">Chargement…</option>';
  try {
    const { declinaisons } = await api(`/api/returns/declinaisons?${new URLSearchParams({ produit })}`);
    ajoutStock.declinaisons = declinaisons;
    choix.innerHTML = declinaisons.length
      ? declinaisons
          .map(
            (ligne, rang) =>
              `<option value="${rang}">${esc(ligne.declinaison ?? 'Modèle unique')}${ligne.sku ? ` · ${esc(ligne.sku)}` : ''}</option>`,
          )
          .join('')
      : '<option value="">Aucune déclinaison</option>';
    choix.disabled = declinaisons.length === 0;
  } catch (error) {
    choix.innerHTML = `<option value="">${esc(error.message)}</option>`;
  }
  majAjoutStock();
}

function majAjoutStock() {
  const quantite = Number($('stk-qte').value);
  $('stk-save').disabled = !(
    ajoutStock.produit &&
    ajoutStock.declinaisons.length &&
    $('stk-decli').value !== '' &&
    Number.isInteger(quantite) &&
    quantite >= 1 &&
    quantite <= 50
  );
}

$('stk-produit')?.addEventListener('input', () => {
  // Retaper le modèle annule le choix : la déclinaison doit suivre.
  ajoutStock.produit = null;
  ajoutStock.declinaisons = [];
  $('stk-decli').disabled = true;
  majAjoutStock();
  clearTimeout(ajoutStock.minuteur);
  ajoutStock.minuteur = setTimeout(() => void chercherModeleStock(), 250);
});
$('stk-modal')?.addEventListener('click', (event) => {
  const choix = event.target.closest('[data-stk-produit]');
  if (choix) return void choisirModeleStock(choix.dataset.stkProduit);
  if (event.target === event.currentTarget) fermerAjoutStock();
});
$('stk-decli')?.addEventListener('change', majAjoutStock);
$('stk-qte')?.addEventListener('input', majAjoutStock);
$('stk-cancel')?.addEventListener('click', fermerAjoutStock);
$('stk-save')?.addEventListener('click', async () => {
  const ligne = ajoutStock.declinaisons[Number($('stk-decli').value)];
  if (!ajoutStock.produit || !ligne) return;
  const bouton = $('stk-save');
  bouton.disabled = true;
  try {
    const resultat = await api('/api/returns/stock', {
      method: 'POST',
      body: JSON.stringify({
        productTitle: ajoutStock.produit,
        variantTitle: ligne.declinaison,
        sku: ligne.sku,
        quantite: Number($('stk-qte').value),
        agencyId: $('stk-agence').value || null,
        note: $('stk-note').value.trim() || null,
      }),
    });
    fermerAjoutStock();
    toast(
      `${resultat.ajoutees} paire${resultat.ajoutees > 1 ? 's' : ''} ajoutée${resultat.ajoutees > 1 ? 's' : ''} au stock${
        resultat.agence ? ` de l’agence ${resultat.agence}` : ''
      }.`,
    );
    await loadReturns();
  } catch (error) {
    bouton.disabled = false;
    toast(error.message, true);
  }
});

function renderReturnAgencies(box) {
  const country = state.returns.country;
  const agencies = state.returns.agencies.filter((agency) => agency.country === country);

  box.innerHTML = `
    <div class="ret-country-tabs chips" style="margin:0 0 12px">
      ${Object.entries(RETURN_COUNTRIES)
        .map(
          ([code, label]) =>
            `<button type="button" data-ret-country="${code}" aria-pressed="${
              code === country
            }">${esc(label)}</button>`,
        )
        .join('')}
    </div>
    ${
      agencies.length
        ? `<div class="ret-grid">${agencies
            .map(
              (agency) => `<div class="ret-card">
                <b>${esc(agency.name)}</b>
                ${agency.email ? `<small>✉ ${esc(agency.email)}</small>` : ''}
                ${agency.phone ? `<small>✆ ${esc(agency.phone)}</small>` : ''}
                ${agency.address ? `<small>${esc(agency.address)}</small>` : ''}
                ${agency.notes ? `<small>${esc(agency.notes)}</small>` : ''}
                <div class="ret-controle">
                  <button class="btn btn-small btn-primary" data-agency-link="${esc(agency.id)}">Copier le lien de l’agence</button>
                  <button class="btn btn-small" data-agency-link="${esc(agency.id)}" data-revoke="1">Renouveler le lien</button>
                </div>
                <button class="qlink" data-agency-del="${esc(agency.id)}"
                  style="align-self:flex-start;padding:2px 0">Supprimer</button>
              </div>`,
            )
            .join('')}</div>`
        : `<p class="empty" style="padding:8px 0 16px">Aucune agence en ${esc(
            RETURN_COUNTRIES[country],
          )} pour le moment.</p>`
    }
    <div class="ret-card" style="max-width:420px;margin-top:12px">
      <b>Ajouter une agence — ${esc(RETURN_COUNTRIES[country])}</b>
      <input type="text" id="agency-f-name" placeholder="Nom de l'agence" />
      <input type="email" id="agency-f-email" placeholder="Email" />
      <input type="text" id="agency-f-phone" placeholder="Téléphone" />
      <textarea id="agency-f-address" placeholder="Adresse complète"></textarea>
      <textarea id="agency-f-notes" placeholder="Notes (horaires, interlocuteur…)"></textarea>
      <button class="btn btn-primary" id="agency-f-save">Ajouter</button>
    </div>`;
}

/**
 * Version déployée et dernière relève, en bas des Réglages.
 *
 * Deux pannes signalées n'en étaient pas : le serveur avait la correction, le
 * navigateur servait l'ancien fichier. Ces deux lignes tranchent la question
 * avant qu'on cherche ailleurs — et disent, boîte par boîte, ce que le dernier
 * clic sur « Actualiser » a réellement lu.
 */
function renderBuildInfo() {
  const box = $('set-build');
  if (!box) return;

  const version = state.build?.assetVersion ?? '—';
  const started = state.build?.startedAt ? dateTime(state.build.startedAt) : '—';

  const sync = state.lastSync;
  const syncLine = !sync
    ? 'Aucune relève depuis l’ouverture de cet écran.'
    : sync.error
      ? `Dernière relève : échec — ${esc(sync.error)}`
      : (sync.details ?? [])
          .map((entry) =>
            entry.error
              ? `${esc(entry.mailbox)} : ${esc(entry.error)}`
              : `${esc(entry.mailbox)} : ${entry.incremental} nouveau(x)${
                  entry.backfill === null ? '' : `, ${entry.backfill} par rattrapage`
                }`,
          )
          .join(' · ') || 'Aucune boîte connectée.';

  box.innerHTML = `Version déployée <code>${esc(version)}</code>, serveur démarré le ${esc(
    started,
  )}.<br />${syncLine}<br /><button class="qlink" id="set-sync-now"
    style="padding:4px 0">Relever maintenant et afficher le détail</button>`;

  // Le geste de diagnostic : relever, puis réécrire ces deux lignes avec ce
  // qui vient de se passer — sans quitter l'écran où on cherche la panne.
  $('set-sync-now')?.addEventListener('click', async () => {
    const button = $('set-sync-now');
    button.disabled = true;
    button.textContent = 'Relève en cours…';
    await pullMail({ revive: true });
    await loadQueue();
    renderBuildInfo();
  });
}


$('ret-tabs').addEventListener('click', (event) => {
  const tab = event.target.closest('[data-rtab]');
  if (!tab) return;
  state.returns.tab = tab.dataset.rtab;
  renderReturns();
});

$('ret-body').addEventListener('click', async (event) => {
  const countryTab = event.target.closest('[data-ret-country]');
  if (countryTab) {
    state.returns.country = countryTab.dataset.retCountry;
    renderReturns();
    return;
  }

  const save = event.target.closest('#agency-f-save');
  if (save) {
    const name = $('agency-f-name').value.trim();
    if (!name) return toast("Le nom de l'agence est obligatoire.", true);
    try {
      await api('/api/return-agencies', {
        method: 'POST',
        body: JSON.stringify({
          country: state.returns.country,
          name,
          email: $('agency-f-email').value.trim() || null,
          phone: $('agency-f-phone').value.trim() || null,
          address: $('agency-f-address').value.trim() || null,
          notes: $('agency-f-notes').value.trim() || null,
        }),
      });
      toast('Agence ajoutée.');
      await loadReturns();
    } catch (error) {
      toast(error.message, true);
    }
    return;
  }

  const lienAgence = event.target.closest('[data-agency-link]');
  if (lienAgence) {
    void openAgencyLink(lienAgence.dataset.agencyLink, lienAgence.dataset.revoke === '1');
    return;
  }

  const delAgency = event.target.closest('[data-agency-del]');
  if (delAgency) {
    if (!await confirmer('Supprimer cette agence ?\n\nSes dossiers restent, sans agence rattachée.', { action: 'Supprimer', danger: true, icone: 'corbeille' })) return;
    try {
      await api(`/api/return-agencies/${delAgency.dataset.agencyDel}`, { method: 'DELETE' });
      await loadReturns();
    } catch (error) {
      toast(error.message, true);
    }
    return;
  }

  const wa = event.target.closest('[data-ret-wa]');
  if (wa) {
    const item = state.returns.cases.find((candidate) => candidate.id === wa.dataset.retWa);
    const link = item && returnWaLink(item);
    if (!link) return;
    window.open(link, '_blank', 'noopener');
    // Le message est parti (ou presque) : le compteur de silence repart,
    // sinon le dossier resterait rouge après la relance.
    try {
      await api(`/api/returns/${item.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ touch: true }),
      });
      await loadReturns();
    } catch {}
    return;
  }

  /* ---- l'envoi de l'échange ---- */

  // Qui envoie la paire voulue : l'agence qui l'a en stock, sinon l'atelier du
  // modèle. Le serveur tranche — l'écran ne fait que rapporter sa décision.
  const organiser = event.target.closest('[data-ret-echange]');
  if (organiser) {
    organiser.disabled = true;
    try {
      const choix = await api(`/api/returns/${organiser.dataset.retEchange}/echange/organiser`, {
        method: 'POST',
      });
      toast(
        choix.source === 'STOCK'
          ? `La paire part de ${choix.agence ?? 'l’agence'}${
              choix.voisin ? ` (${nomPays(choix.pays)}, pays voisin)` : ''
            } : elle saisira son numéro de suivi.`
          : `Aucune paire en stock : l’échange est confié à ${choix.atelier}.`,
      );
      await loadReturns();
    } catch (error) {
      organiser.disabled = false;
      toast(error.message, true);
    }
    return;
  }

  const annuler = event.target.closest('[data-ret-echange-annuler]');
  if (annuler) {
    if (!await confirmer('Annuler cet envoi ?\n\nLa paire réservée retourne au stock et pourra servir ailleurs.', { action: 'Annuler l’envoi', annuler: 'Garder', danger: true, icone: 'retour' })) return;
    annuler.disabled = true;
    try {
      await api(`/api/returns/${annuler.dataset.retEchangeAnnuler}/echange/annuler`, { method: 'POST' });
      toast('Envoi annulé.');
      await loadReturns();
    } catch (error) {
      annuler.disabled = false;
      toast(error.message, true);
    }
    return;
  }

  // Prévenir le client : c'est le seul e-mail que personne n'enverra à notre
  // place, puisqu'il n'y a pas de commande Shopify derrière cet envoi.
  const prevenir = event.target.closest('[data-ret-echange-prevenu]');
  if (prevenir) {
    const item = state.returns.cases.find((candidate) => candidate.id === prevenir.dataset.retEchangePrevenu);
    if (!item) return;
    const lien = echangeLien(item);
    if (!lien) {
      toast('Ce dossier n’a ni téléphone ni e-mail : ajoutez-en un pour prévenir le client.', true);
      return;
    }
    window.open(lien, '_blank', 'noopener');
    try {
      await api(`/api/returns/${item.id}/echange/prevenu`, { method: 'POST' });
      await loadReturns();
    } catch (error) {
      toast(error.message, true);
    }
    return;
  }

  // Servir une commande depuis le stock : elle quitte la liste de l'atelier.
  const serve = event.target.closest('[data-ret-serve]');
  if (serve) {
    const proposition = state.returns.matches[Number(serve.dataset.retServe)];
    if (!proposition) return;
    const ou = `${nomPays(proposition.paysStock)}${proposition.agence?.nom ? `, ${proposition.agence.nom}` : ''}`;
    const combien = proposition.paires.length > 1 ? `${proposition.paires.length} paires` : 'une paire';
    if (
      !await confirmer(
        `Servir ${proposition.commande} avec ${combien} du stock retours ?\n\n${ou}. La commande disparaît de la liste de l’atelier, qui ne l’expédiera pas.`,
        { action: 'Servir', icone: 'retour' },
      )
    )
      return;
    serve.disabled = true;
    try {
      const { agence } = await api('/api/returns/reemploi', {
        method: 'POST',
        body: JSON.stringify({
          orderId: proposition.commandeId,
          orderName: proposition.commande,
          returnIds: proposition.paires.map((paire) => paire.returnId),
        }),
      });
      state.returns.derniere = { ...proposition, agenceContact: agence };
      toast(`${proposition.commande} confiée au stock retours.`);
      await loadReturns();
    } catch (error) {
      serve.disabled = false;
      toast(error.message, true);
    }
    return;
  }

  const liberer = event.target.closest('[data-ret-liberer]');
  if (liberer) {
    if (
      !await confirmer(
        `Libérer ${liberer.dataset.retOrder} ?\n\nLes paires reviennent au stock, et la commande revient dans la liste de l’atelier.`,
        { action: 'Libérer', icone: 'retour' },
      )
    )
      return;
    try {
      await api('/api/returns/reemploi/liberer', {
        method: 'POST',
        body: JSON.stringify({ orderId: liberer.dataset.retLiberer }),
      });
      toast('Commande libérée : elle revient chez l’atelier.');
      await loadReturns();
    } catch (error) {
      toast(error.message, true);
    }
    return;
  }

  const defect = event.target.closest('[data-ret-defect]');
  if (defect) {
    const note = prompt('Défectueux : la paire sort du stock. Quel défaut ? (facultatif)');
    if (note === null) return;
    try {
      await api(`/api/returns/${defect.dataset.retDefect}/defectueux`, {
        method: 'POST',
        body: JSON.stringify({ note: note.trim() || null }),
      });
      toast('Paire sortie du stock : défectueuse.');
      await loadReturns();
    } catch (error) {
      toast(error.message, true);
    }
    return;
  }

  const restock = event.target.closest('[data-ret-restock]');
  if (restock) {
    try {
      await api(`/api/returns/${restock.dataset.retRestock}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'RESTOCKED' }),
      });
      toast('Paire remise en stock : elle peut servir une commande.');
      await loadReturns();
    } catch (error) {
      toast(error.message, true);
    }
    return;
  }

  const copier = event.target.closest('[data-ret-copier]');
  if (copier) {
    try {
      await navigator.clipboard.writeText(copier.dataset.retCopier);
      toast('Adresse copiée.');
    } catch {
      toast('Copie impossible : sélectionnez l’adresse à la main.', true);
    }
    return;
  }

  if (event.target.closest('[data-ret-fermer]')) {
    state.returns.derniere = null;
    renderReturns();
    return;
  }

  const del = event.target.closest('[data-ret-del]');
  if (del) {
    if (!await confirmer('Supprimer ce dossier de retour ?\n\nUne paire du stock réservée pour lui y retourne.', { action: 'Supprimer', danger: true, icone: 'corbeille' })) return;
    try {
      await api(`/api/returns/${del.dataset.retDel}`, { method: 'DELETE' });
      await loadReturns();
    } catch (error) {
      toast(error.message, true);
    }
  }
});

$('ret-body').addEventListener('change', async (event) => {
  const photoInput = event.target.closest('[data-ret-photo]');
  if (photoInput?.files?.[0]) {
    try {
      const photo = await shrinkReturnPhoto(photoInput.files[0]);
      await api(`/api/returns/${photoInput.dataset.retPhoto}`, {
        method: 'PATCH',
        body: JSON.stringify({ photo }),
      });
      toast('Photo ajoutée au dossier.');
      await loadReturns();
    } catch (error) {
      toast(error.message, true);
    }
    return;
  }

  const track = event.target.closest('[data-ret-track]');
  const label = event.target.closest('[data-ret-label]');
  const status = event.target.closest('[data-ret-status]');
  if (!track && !label && !status) return;

  const id = track?.dataset.retTrack ?? label?.dataset.retLabel ?? status?.dataset.retStatus;
  try {
    await api(`/api/returns/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(
        track
          ? // Un numéro saisi vaut colis expédié : le statut suit tout seul,
            // sauf s'il est déjà plus avancé.
            {
              trackingNumber: track.value.trim() || null,
              ...(track.value.trim() &&
              ['OPEN', 'LABEL_SENT'].includes(
                state.returns.cases.find((candidate) => candidate.id === id)?.status,
              )
                ? { status: 'SHIPPED' }
                : {}),
            }
          : label
            ? { labelSent: label.checked }
            : { status: status.value },
      ),
    });
    await loadReturns();
  } catch (error) {
    toast(error.message, true);
    await loadReturns();
  }
});

/**
 * Ouvre le formulaire de dossier retour, vierge ou pré-rempli.
 *
 * Deux entrées mènent ici : « Nouveau retour » depuis l'écran Reshipment, et
 * « Reshipment » depuis un message client. Un seul chemin pour les deux — deux
 * ouvertures recopiées divergeraient au premier champ ajouté, et c'est
 * toujours celle qu'on regarde le moins qui oublie une remise à zéro.
 *
 * Remettre à zéro *tous* les champs à chaque ouverture, y compris ceux qu'on
 * ne pré-remplit pas : le formulaire n'est pas démonté entre deux usages, et
 * un champ laissé de côté garderait la valeur du dossier précédent.
 */
function openReturnModal(prefill = {}) {
  // Remise à zéro de TOUS les champs : le formulaire n'est pas démonté entre
  // deux usages, et un champ laissé de côté garderait le dossier précédent.
  for (const id of [
    'ret-f-order',
    'ret-f-name',
    'ret-f-phone',
    'ret-f-product',
    'ret-f-variant',
    'ret-f-sku',
    'ret-f-note',
    'ret-f-want-title',
    'ret-f-want-variant',
  ]) {
    $(id).value = '';
  }

  $('ret-f-order').value = prefill.order ?? '';
  $('ret-f-name').value = prefill.name ?? '';
  $('ret-f-phone').value = prefill.phone ?? '';
  $('ret-f-product').value = prefill.product ?? '';
  $('ret-f-variant').value = prefill.variant ?? '';
  $('ret-f-sku').value = prefill.sku ?? '';
  $('ret-f-note').value = prefill.note ?? '';
  $('ret-f-bon').value = '';
  $('ret-f-reason').value = 'SIZE';
  $('ret-f-resolution').value = 'EXCHANGE';

  /* Le pays est un enum fermé — les quatre d'`RETURN_COUNTRIES`, et le serveur
     refuse le reste. Une commande livrée ailleurs laisserait le champ sur une
     valeur que le formulaire ne sait pas rendre : on retombe sur FR, que
     l'agent corrigera s'il le faut. */
  const country = prefill.country ?? 'FR';
  $('ret-f-country').value = Object.hasOwn(RETURN_COUNTRIES, country) ? country : 'FR';

  const articles = prefill.items ?? [];
  retFormulaire = {
    articles,
    // Ouvert depuis un message client, l'article est déjà connu : on le
    // retrouve dans la commande plutôt que de laisser la liste sans choix.
    choisi:
      articles.length === 1
        ? 0
        : prefill.product
          ? articles.findIndex(
              (article) =>
                article.title === prefill.product &&
                (article.variantTitle ?? '') === (prefill.variant ?? ''),
            )
          : null,
    veutType: 'SIZE',
    couleur: null,
    dispo: null,
    modele: null,
    modeles: [],
    ecartChoix: null,
  };
  retLookupEmail = prefill.email ?? null;
  retLookupOrderId = prefill.orderId ?? null;

  $('ret-f-order-etat').textContent =
    'Tapez le numéro : le client, son pays et ses articles arrivent seuls.';
  $('ret-f-veut-options').innerHTML = '';
  $('ret-f-dispo').hidden = true;
  $('ret-f-modele').hidden = true;
  $('ret-f-modele-q').value = '';
  $('ret-f-modele-q').hidden = false;
  $('ret-f-modele-liste').innerHTML = '';
  $('ret-f-modele-liste').classList.remove('ret-modele-ferme');
  $('ret-f-ecart').hidden = true;
  // La saisie libre reste ouverte tant qu'aucune commande n'a rempli la fiche.
  $('ret-f-libre').hidden = retFormulaire.articles.length > 0;

  $('ret-f-agency').innerHTML =
    '<option value="">—</option>' +
    state.returns.agencies
      .map(
        (agency) =>
          `<option value="${esc(agency.id)}">${esc(agency.name)} (${esc(agency.country)})</option>`,
      )
      .join('');

  renderReturnClient(prefill);
  renderReturnItems();
  renderReturnChoix();
  majRetourFormulaire();

  $('return-modal').classList.add('open');
  // Le curseur dans le premier champ : c'est là qu'on tape, et tant qu'il y
  // est les raccourcis de la file se taisent d'eux-mêmes.
  $('ret-f-order').focus();
}

/** L'état du formulaire de retour, le temps qu'il est ouvert. */
let retFormulaire = { articles: [], choisi: null, veutType: 'SIZE', couleur: null, dispo: null, modele: null, modeles: [], ecartChoix: null };

/**
 * La carte du client, quand la commande a été trouvée.
 *
 * Ce que la commande sait ne se ressaisit pas : on le MONTRE, et les champs
 * qui le portent restent disponibles sous « l'article n'est pas dans la
 * commande » pour les corriger si besoin.
 */
function renderReturnClient(infos) {
  const nom = infos.name ?? $('ret-f-name').value;
  const box = $('ret-f-client');

  if (!nom) {
    box.hidden = true;
    box.innerHTML = '';
    return;
  }

  const pays = RETURN_COUNTRIES[$('ret-f-country').value] ?? $('ret-f-country').value;
  const tel = $('ret-f-phone').value;
  box.hidden = false;
  box.innerHTML = `<b>${esc(nom)}</b>
    <span>${esc(pays)}${tel ? ` · ${esc(tel)}` : ''}${
      retLookupEmail ? ` · ${esc(retLookupEmail)}` : ''
    }</span>`;
}

/**
 * Les articles de la commande, à choisir au doigt.
 *
 * Avec leur photo : on reconnaît une paire bien plus vite qu'à sa référence.
 * Et surtout, le choix recopie le titre, la taille et la référence TELS QUE
 * Shopify les écrit — c'est ce qui permettra au stock retours de retrouver
 * cette paire plus tard. Tapé à la main, un accent ou un tiret de travers
 * suffit à la rendre introuvable.
 */
function renderReturnItems() {
  const { articles, choisi } = retFormulaire;

  $('ret-f-items').innerHTML = articles.length
    ? articles
        .map(
          (article, index) => `<button type="button" class="ret-article" data-ret-item="${index}"
            aria-pressed="${index === choisi}">
            ${
              article.image
                ? `<img src="${esc(article.image)}" alt="" loading="lazy" />`
                : '<span class="ret-article-vide" aria-hidden="true"></span>'
            }
            <span>
              <b>${esc(article.title)}</b>
              <small>${esc(
                [article.variantTitle, article.sku].filter(Boolean).join(' · '),
              )}${article.quantity > 1 ? ` · ×${article.quantity}` : ''}</small>
            </span>
          </button>`,
        )
        .join('')
    : '';
}

/** Les boutons de raison et de suite, réglés sur les menus cachés. */
function renderReturnChoix() {
  for (const bouton of document.querySelectorAll('#ret-f-reasons [data-reason]')) {
    bouton.setAttribute('aria-pressed', String(bouton.dataset.reason === $('ret-f-reason').value));
  }
  for (const bouton of document.querySelectorAll('#ret-f-resolutions [data-resolution]')) {
    bouton.setAttribute(
      'aria-pressed',
      String(bouton.dataset.resolution === $('ret-f-resolution').value),
    );
  }
  for (const bouton of document.querySelectorAll('#ret-f-veut-type [data-veut]')) {
    bouton.setAttribute('aria-pressed', String(bouton.dataset.veut === retFormulaire.veutType));
  }
}

/**
 * Ce que la raison entraîne, dit avant de créer le dossier.
 *
 * Le sous-titre l'annonçait sans que rien ne le montre : un défaut ne revient
 * pas au stock, une taille si. C'est la phrase qui évite de créer un dossier
 * en croyant l'inverse.
 */
function consequenceRetour() {
  const raison = $('ret-f-reason').value;
  const suite = $('ret-f-resolution').value;

  if (raison === 'DEFECT') {
    return 'Défectueux : la paire sortira du stock à la réception, elle ne repartira pas chez un autre client.';
  }
  return suite === 'EXCHANGE'
    ? 'Échange : la paire rentrera au stock de l’agence si elle revient en bon état, et pourra servir un autre client.'
    : 'Remboursement : la paire rentrera quand même au stock si elle revient en bon état.';
}

/** Le bouton suit ce qui manque, et le dit. */
function majRetourFormulaire() {
  const echange = $('ret-f-resolution').value === 'EXCHANGE';
  $('ret-f-consequence').textContent = consequenceRetour();
  $('ret-f-veut').hidden = !echange;

  const manque = !$('ret-f-product').value.trim()
    ? 'Choisissez l’article qui revient.'
    : echange && !$('ret-f-want-title').value
      ? 'Indiquez ce que le client veut à la place.'
      : '';

  $('ret-f-manque').textContent = manque;
  $('ret-f-save').disabled = Boolean(manque);
}

/**
 * Les agences ne sont chargées que par l'écran Reshipment.
 *
 * Ouvert depuis un message, le formulaire trouverait donc la liste vide et
 * proposerait « — » comme seul choix. On la charge à la demande, une fois.
 * Un échec n'empêche pas de créer le dossier : l'agence est facultative, et
 * refuser l'ouverture pour ça coûterait plus que le champ ne rapporte.
 */
async function ensureReturnAgencies() {
  if (state.returns.agencies.length > 0) return;

  try {
    const data = await api('/api/return-agencies');
    state.returns.agencies = data?.agencies ?? [];
  } catch {
    // Le champ agence restera sur « — », le reste du formulaire fonctionne.
  }
}

/*
 * Le bouton suit le droit du serveur.
 *
 * `/api/returns` exige `reply` en écriture : sans ce garde, un rôle en lecture
 * seule verrait le formulaire s'ouvrir, remplirait dix champs, et découvrirait
 * le refus au moment d'enregistrer. Ce n'est pas le verrou — celui-là est
 * serveur — c'est la politesse de ne pas proposer ce qui sera refusé.
 */
$('ret-new').addEventListener('click', () => {
  if (!canI('reply')) {
    toast('Votre rôle est en lecture seule.', true);
    return;
  }
  openReturnModal();
});

/*
 * Le numéro de commande remplit le formulaire tout seul.
 *
 * Tout ce que le dossier demande est déjà dans la commande : client,
 * téléphone, pays, articles. On tape « 11363 », le reste s'écrit — et l'écran
 * dit ce qu'il a trouvé, ou qu'il cherche encore.
 */
let retLookupEmail = null;
let retLookupOrderId = null;
let retLookupTimer = null;

$('ret-f-order').addEventListener('input', () => {
  clearTimeout(retLookupTimer);
  const name = $('ret-f-order').value.trim();
  if (name.replace(/\D/g, '').length < 3) return;

  $('ret-f-order-etat').textContent = 'Recherche de la commande…';

  retLookupTimer = setTimeout(async () => {
    let order;
    try {
      ({ order } = await api(`/api/returns/order-lookup?name=${encodeURIComponent(name)}`));
    } catch (error) {
      // Un numéro en cours de frappe n'est pas une erreur : on le dit sans
      // vider ce que l'agent a déjà saisi.
      $('ret-f-order-etat').textContent = error.message;
      $('ret-f-libre').hidden = false;
      return;
    }

    $('ret-f-order').value = order.orderName;
    $('ret-f-name').value = order.customerName ?? '';
    $('ret-f-phone').value = order.customerPhone ?? '';
    if (order.country && $('ret-f-country').querySelector(`[value="${order.country}"]`)) {
      $('ret-f-country').value = order.country;
    }
    retLookupEmail = order.customerEmail;
    retLookupOrderId = order.shopifyOrderId;

    const articles = order.lineItems ?? [];
    retFormulaire.articles = articles;
    retFormulaire.choisi = articles.length === 1 ? 0 : null;
    if (articles.length === 1) choisirArticle(0, { silencieux: true });

    // L'agence du pays, quand il n'y en a qu'une : c'est elle qui recevra.
    const duPays = state.returns.agencies.filter((agence) => agence.country === $('ret-f-country').value);
    if (duPays.length === 1) $('ret-f-agency').value = duPays[0].id;

    $('ret-f-order-etat').textContent = `Commande ${order.orderName} trouvée.`;
    $('ret-f-libre').hidden = articles.length > 0;
    renderReturnClient({ name: order.customerName });
    renderReturnItems();
    majRetourFormulaire();
  }, 450);
});

/** Choisir l'article qui revient : ses valeurs viennent de la commande. */
function choisirArticle(index, options = {}) {
  const article = retFormulaire.articles[index];
  if (!article) return;

  retFormulaire.choisi = index;
  $('ret-f-product').value = article.title;
  $('ret-f-variant').value = article.variantTitle ?? '';
  $('ret-f-sku').value = article.sku ?? '';

  // Changer d'article change ce qu'on peut vouloir à la place.
  $('ret-f-want-title').value = '';
  $('ret-f-want-variant').value = '';
  retFormulaire.couleur = null;
  $('ret-f-dispo').hidden = true;

  renderReturnItems();
  majRetourFormulaire();
  if (!options.silencieux && $('ret-f-resolution').value === 'EXCHANGE') void chargerOptionsVoulu();
}

$('ret-f-items').addEventListener('click', (event) => {
  const carte = event.target.closest('[data-ret-item]');
  if (carte) choisirArticle(Number(carte.dataset.retItem));
});

$('ret-f-manuel').addEventListener('click', () => {
  $('ret-f-libre').hidden = !$('ret-f-libre').hidden;
  if (!$('ret-f-libre').hidden) $('ret-f-product').focus();
});

for (const champ of ['ret-f-product', 'ret-f-variant', 'ret-f-sku']) {
  $(champ).addEventListener('input', majRetourFormulaire);
}
$('ret-f-country').addEventListener('change', () => renderReturnClient({}));

$('ret-f-reasons').addEventListener('click', (event) => {
  const bouton = event.target.closest('[data-reason]');
  if (!bouton) return;
  $('ret-f-reason').value = bouton.dataset.reason;

  // Un défaut se rembourse, une taille s'échange : la suite se propose, et
  // reste modifiable.
  $('ret-f-resolution').value = bouton.dataset.reason === 'DEFECT' ? 'REFUND' : 'EXCHANGE';
  renderReturnChoix();
  majRetourFormulaire();
  if ($('ret-f-resolution').value === 'EXCHANGE') void chargerOptionsVoulu();
});

$('ret-f-resolutions').addEventListener('click', (event) => {
  const bouton = event.target.closest('[data-resolution]');
  if (!bouton) return;
  $('ret-f-resolution').value = bouton.dataset.resolution;
  renderReturnChoix();
  majRetourFormulaire();
  if (bouton.dataset.resolution === 'EXCHANGE') void chargerOptionsVoulu();
});

$('ret-f-veut-type').addEventListener('click', (event) => {
  const bouton = event.target.closest('[data-veut]');
  if (!bouton) return;
  retFormulaire.veutType = bouton.dataset.veut;
  retFormulaire.couleur = null;
  retFormulaire.modele = null;
  retFormulaire.modeleOuvert = false;
  retFormulaire.ecartChoix = null;
  $('ret-f-want-title').value = '';
  $('ret-f-want-variant').value = '';
  $('ret-f-dispo').hidden = true;
  $('ret-f-ecart').hidden = true;
  renderReturnChoix();
  majRetourFormulaire();
  // Un autre modèle : on le cherche par son nom ; sinon, les déclinaisons du modèle.
  const autre = retFormulaire.veutType === 'MODELE';
  $('ret-f-modele').hidden = !autre;
  if (autre) {
    $('ret-f-veut-options').innerHTML = '';
    renderModelesRetour();
    $('ret-f-modele-q').focus();
    if ($('ret-f-modele-q').value.trim().length >= 2) void chercherModeleRetour();
    return;
  }
  void chargerOptionsVoulu();
});

/* ------------------------------------------- échange : un autre modèle -- */

/*
 * Un autre modèle, pris dans le catalogue.
 *
 * Le client renvoie des Nike Mind et veut des Pegasus : on tape le nom, le
 * catalogue propose les déclinaisons — la même pointure d'abord — avec leur
 * prix et l'écart avec la paire qui revient. L'écart affiché est indicatif :
 * le serveur relit les deux prix chez Shopify avant d'en faire quoi que ce
 * soit.
 */

/** Le prix payé pour la paire qui revient, à l'unité, ou `null`. */
function prixArticleRetour() {
  const article = retFormulaire.articles?.[retFormulaire.choisi];
  const total = Number(article?.price);
  if (!article || !article.price || !Number.isFinite(total)) return null;
  return Math.round((total / Math.max(1, article.quantity ?? 1)) * 100) / 100;
}

/** La pointure de la paire qui revient, pour proposer la même d'abord. */
function pointureRetour() {
  const variante = ($('ret-f-variant').value || '').split(/\s+\/\s+/);
  return variante.find((morceau) => /^\d{1,2}([.,]\d)?(\s+\d\/\d)?$/.test(morceau.trim()))?.trim() ?? null;
}

let minuteurModeleRetour = 0;
let tourModeleRetour = 0;
function chercherModeleRetour() {
  clearTimeout(minuteurModeleRetour);
  minuteurModeleRetour = setTimeout(async () => {
    const terme = $('ret-f-modele-q').value.trim();
    const tour = ++tourModeleRetour;
    if (terme.length < 2) {
      retFormulaire.modeles = [];
      return renderModelesRetour();
    }
    $('ret-f-modele-liste').innerHTML = '<span class="ret-attente">Lecture du catalogue…</span>';
    try {
      const { options = [] } = await api(`/api/catalogue/variantes?q=${encodeURIComponent(terme)}`);
      if (tour !== tourModeleRetour) return;
      const taille = pointureRetour();
      // La même pointure d'abord, puis ce qui est en stock.
      retFormulaire.modeles = [...options].sort(
        (a, b) =>
          Number(Boolean(taille) && (b.variantTitle ?? '').includes(taille)) -
            Number(Boolean(taille) && (a.variantTitle ?? '').includes(taille)) ||
          (b.inventoryQuantity ?? 0) - (a.inventoryQuantity ?? 0),
      );
    } catch (error) {
      if (tour !== tourModeleRetour) return;
      retFormulaire.modeles = [];
      $('ret-f-modele-liste').innerHTML = `<span class="ret-attente">${esc(error.message)}</span>`;
      return;
    }
    renderModelesRetour();
  }, 250);
}

/** L'écart d'une déclinaison avec la paire qui revient, ou `null`. */
function ecartAvec(option) {
  const retour = prixArticleRetour();
  const voulu = Number(option?.price);
  if (retour === null || !option?.price || !Number.isFinite(voulu)) return null;
  return Math.round((voulu - retour) * 100) / 100;
}

function texteEcart(ecart) {
  if (ecart === null) return '';
  if (Math.abs(ecart) < 0.005) return 'même prix';
  return `${ecart > 0 ? '+' : '−'} ${euro(Math.abs(ecart), 'EUR')}`;
}

function renderModelesRetour() {
  const liste = $('ret-f-modele-liste');
  /* Choisi, le sélecteur se referme : il ne reste que le modèle retenu, et
     « Changer » pour rouvrir la recherche. */
  const ferme = Boolean(retFormulaire.modele) && !retFormulaire.modeleOuvert;
  $('ret-f-modele-q').hidden = ferme;
  liste.classList.toggle('ret-modele-ferme', ferme);
  const modeles = ferme ? [retFormulaire.modele] : (retFormulaire.modeles ?? []).slice(0, 8);
  if (!modeles.length) {
    liste.innerHTML = $('ret-f-modele-q').value.trim().length >= 2
      ? '<span class="ret-attente">Aucun modèle trouvé : essayez un autre mot.</span>'
      : '';
    return;
  }
  liste.innerHTML = modeles
    .map((option) => {
      const ecart = ecartAvec(option);
      const ton = ecart === null ? '' : Math.abs(ecart) < 0.005 ? 'egal' : ecart > 0 ? 'plus' : 'moins';
      const on = retFormulaire.modele?.id === option.id;
      return `<button type="button" class="ret-modele-ligne" role="option" aria-selected="${on}" data-ret-modele="${esc(option.id)}">
        ${option.image ? `<img src="${esc(option.image)}" alt="" loading="lazy" />` : '<i aria-hidden="true"></i>'}
        <span class="ret-modele-txt"><b>${esc(option.productTitle)}</b><small>${esc(
          [option.variantTitle, mentionStock(option)]
            .filter(Boolean)
            .join(' · '),
        )}</small></span>
        <b class="ret-modele-prix">${option.price ? esc(euro(option.price, 'EUR')) : '—'}</b>
        <span class="ret-modele-ecart ${ton}">${esc(texteEcart(ecart))}</span>
      </button>`;
    })
    .join('') + (ferme ? '<button type="button" class="ret-modele-changer" data-ret-modele-changer>Changer</button>' : '');
}

/* Ce qu'on fait de l'écart : deux choix selon son sens, le premier d'office. */
const CHOIX_ECART_RETOUR = {
  plus: [
    ['LIEN', 'Envoyer un lien de paiement', 'Lien Shopify par mail ; l’échange part dès le paiement'],
    ['OFFERT', 'Offrir la différence', 'Geste commercial : rien à payer'],
  ],
  moins: [
    ['REMBOURSER', 'Rembourser la différence', 'Dans « À rembourser », une fois la paire retournée contrôlée'],
    ['GARDER', 'Ne rien rembourser', 'Le client l’accepte'],
  ],
};

function renderEcartRetour() {
  const boite = $('ret-f-ecart');
  const ecart = ecartAvec(retFormulaire.modele);
  if (!retFormulaire.modele || ecart === null) {
    boite.hidden = !retFormulaire.modele;
    boite.className = 'ret-ecart';
    boite.innerHTML = retFormulaire.modele
      ? '<span>Prix de la paire qui revient inconnu : l’écart sera calculé à l’enregistrement, d’après Shopify.</span>'
      : '';
    return;
  }
  boite.hidden = false;
  if (Math.abs(ecart) < 0.005) {
    retFormulaire.ecartChoix = null;
    boite.className = 'ret-ecart egal';
    boite.innerHTML = '<div class="ret-ecart-tete"><b>Même prix</b><b class="ret-ecart-montant">0,00 €</b></div><span>Rien à payer, rien à rembourser : l’échange part comme d’habitude.</span>';
    return;
  }
  const sens = ecart > 0 ? 'plus' : 'moins';
  const choix = CHOIX_ECART_RETOUR[sens];
  if (!choix.some(([cle]) => cle === retFormulaire.ecartChoix)) retFormulaire.ecartChoix = choix[0][0];
  boite.className = `ret-ecart ${sens}`;
  boite.innerHTML = `<div class="ret-ecart-tete"><b>${
    sens === 'plus' ? 'Plus cher : le client paie la différence' : 'Moins cher : on rend la différence'
  }</b><b class="ret-ecart-montant">${esc(texteEcart(ecart))}</b></div>
    <span>${sens === 'plus' ? 'La nouvelle paire ne part qu’une fois la différence réglée.' : 'Remboursée quand l’agence a contrôlé la paire retournée.'}</span>
    <div class="ret-ecart-choix" role="radiogroup">${choix
      .map(
        ([cle, nom, detail]) => `<button type="button" role="radio" aria-checked="${cle === retFormulaire.ecartChoix}" data-ret-ecart="${cle}">
          <b>${esc(nom)}</b><small>${esc(detail)}</small></button>`,
      )
      .join('')}</div>`;
}

$('ret-f-modele-q')?.addEventListener('input', () => void chercherModeleRetour());
$('ret-f-modele-liste')?.addEventListener('click', (event) => {
  if (event.target.closest('[data-ret-modele-changer]')) {
    retFormulaire.modeleOuvert = true;
    renderModelesRetour();
    $('ret-f-modele-q').focus();
    return;
  }
  const ligne = event.target.closest('[data-ret-modele]');
  if (!ligne) return;
  // Un clic sur le modèle déjà retenu, sélecteur fermé : on rouvre.
  if (!retFormulaire.modeleOuvert && retFormulaire.modele?.id === ligne.dataset.retModele) {
    retFormulaire.modeleOuvert = true;
    renderModelesRetour();
    $('ret-f-modele-q').focus();
    return;
  }
  const option = retFormulaire.modeles.find((candidat) => candidat.id === ligne.dataset.retModele);
  if (!option) return;
  retFormulaire.modele = option;
  retFormulaire.modeleOuvert = false;
  retFormulaire.ecartChoix = null;
  $('ret-f-want-title').value = option.productTitle;
  $('ret-f-want-variant').value = option.variantTitle ?? '';
  renderModelesRetour();
  renderEcartRetour();
  majRetourFormulaire();
  void verifierStockVoulu();
});
$('ret-f-ecart')?.addEventListener('click', (event) => {
  const choix = event.target.closest('[data-ret-ecart]');
  if (!choix) return;
  retFormulaire.ecartChoix = choix.dataset.retEcart;
  renderEcartRetour();
});

/*
 * Ce que le client veut à la place, pris dans le catalogue.
 *
 * Une autre taille du même modèle, une autre couleur, ou les deux — et dans ce
 * cas la couleur d'abord, puisque c'est elle qui désigne le modèle dont on
 * choisira la taille. Les mêmes listes que les demandes de changement : ce
 * sont les vraies déclinaisons de la boutique, avec leur stock.
 */
async function chargerOptionsVoulu() {
  const produit = retFormulaire.couleur ?? $('ret-f-product').value.trim();
  const box = $('ret-f-veut-options');
  if (!produit) {
    box.innerHTML = '';
    return;
  }

  const couleurDAbord = retFormulaire.veutType !== 'SIZE' && !retFormulaire.couleur;
  const scope = couleurDAbord ? 'COLOR' : 'SIZE';
  box.innerHTML = '<span class="ret-attente">Lecture du catalogue…</span>';

  let options = [];
  try {
    ({ options = [] } = await api(
      `/api/variant-options?scope=${scope}&product=${encodeURIComponent(produit)}`,
    ));
  } catch {
    box.innerHTML = '<span class="ret-attente">Catalogue indisponible : saisissez la taille à la main.</span>';
    return;
  }

  if (options.length === 0) {
    box.innerHTML = '<span class="ret-attente">Aucune déclinaison trouvée pour ce modèle.</span>';
    return;
  }

  box.innerHTML =
    (retFormulaire.couleur
      ? `<span class="ret-attente">Couleur : ${esc(retFormulaire.couleur)} — choisissez la taille.</span>`
      : '') +
    options
      .map(
        (option) => `<button type="button" class="ret-option" data-option="${esc(option.value)}"
          data-detail="${esc(option.detail ?? '')}" data-scope="${scope}"
          aria-pressed="false">
          ${option.image ? `<img src="${esc(option.image)}" alt="" loading="lazy" />` : ''}
          <span><b>${esc(option.value)}</b>${
            option.stock !== null && option.stock !== undefined
              ? `<small>${option.stock > 0 ? `${option.stock} en stock` : ''}</small>`
              : ''
          }</span>
        </button>`,
      )
      .join('');
}

$('ret-f-veut-options').addEventListener('click', (event) => {
  const bouton = event.target.closest('[data-option]');
  if (!bouton) return;

  if (bouton.dataset.scope === 'COLOR') {
    // La couleur désigne un autre modèle : c'est dans celui-là qu'on choisira
    // la taille, ou qu'on garde la taille d'origine si seule la couleur change.
    retFormulaire.couleur = bouton.dataset.detail || bouton.dataset.option;
    if (retFormulaire.veutType === 'COLOR') {
      $('ret-f-want-title').value = retFormulaire.couleur;
      $('ret-f-want-variant').value = $('ret-f-variant').value;
      majRetourFormulaire();
      void verifierStockVoulu();
      renderChoixOption(bouton);
      return;
    }
    void chargerOptionsVoulu();
    return;
  }

  $('ret-f-want-title').value = retFormulaire.couleur ?? $('ret-f-product').value.trim();
  $('ret-f-want-variant').value = bouton.dataset.option;
  renderChoixOption(bouton);
  majRetourFormulaire();
  void verifierStockVoulu();
});

function renderChoixOption(choisi) {
  for (const bouton of $('ret-f-veut-options').querySelectorAll('[data-option]')) {
    bouton.setAttribute('aria-pressed', String(bouton === choisi));
  }
}

/**
 * D'où partira la paire d'échange.
 *
 * Du stock retours si une paire identique y dort — c'est l'agence qui
 * l'expédiera — sinon de l'atelier. La réponse se lit avant de créer le
 * dossier : elle change qui travaille.
 */
async function verifierStockVoulu() {
  const titre = $('ret-f-want-title').value.trim();
  if (!titre) return;

  const params = new URLSearchParams({
    titre,
    declinaison: $('ret-f-want-variant').value.trim(),
    pays: $('ret-f-country').value,
  });

  let lieux = [];
  try {
    ({ lieux = [] } = await api(`/api/returns/stock-dispo?${params}`));
  } catch {
    return;
  }

  const box = $('ret-f-dispo');
  box.hidden = false;
  if (lieux.length === 0) {
    box.className = 'ret-dispo';
    box.textContent = 'Aucune paire en stock : l’échange partira de l’atelier.';
    return;
  }

  const premier = lieux[0];
  box.className = 'ret-dispo ret-dispo-ok';
  box.textContent = `En stock : ${premier.nombre} paire${premier.nombre > 1 ? 's' : ''} ${
    premier.agence ? `chez ${premier.agence}` : ''
  } — ${RETURN_COUNTRIES[premier.pays] ?? premier.pays}${
    premier.voisin ? ' (pays voisin)' : ''
  }. L’agence pourra expédier l’échange.`;
}

$('ret-f-cancel').addEventListener('click', () => $('return-modal').classList.remove('open'));
$('return-modal').addEventListener('click', (event) => {
  if (event.target === $('return-modal')) $('return-modal').classList.remove('open');
});

$('ret-f-save').addEventListener('click', async () => {
  const productTitle = $('ret-f-product').value.trim();
  if (!productTitle) return toast("L'article retourné est obligatoire.", true);

  const echange = $('ret-f-resolution').value === 'EXCHANGE';

  try {
    const cree = await api('/api/returns', {
      method: 'POST',
      body: JSON.stringify({
        orderName: $('ret-f-order').value.trim() || null,
        shopifyOrderId: retLookupOrderId,
        customerEmail: retLookupEmail,
        customerName: $('ret-f-name').value.trim() || null,
        customerPhone: $('ret-f-phone').value.trim() || null,
        country: $('ret-f-country').value,
        productTitle,
        variantTitle: $('ret-f-variant').value.trim() || null,
        sku: $('ret-f-sku').value.trim() || null,
        // Ce que le client veut à la place n'a de sens que pour un échange.
        wantedTitle: echange ? $('ret-f-want-title').value.trim() || null : null,
        wantedVariantTitle: echange ? $('ret-f-want-variant').value.trim() || null : null,
        // Un autre modèle : sa déclinaison, pour que le serveur relise son prix.
        ...(echange && retFormulaire.veutType === 'MODELE' && retFormulaire.modele
          ? {
              wantedSku: retFormulaire.modele.sku ?? null,
              wantedVariantId: retFormulaire.modele.id,
              ecartChoix: retFormulaire.ecartChoix,
            }
          : {}),
        reason: $('ret-f-reason').value,
        resolution: $('ret-f-resolution').value,
        agencyId: $('ret-f-agency').value || null,
        note: $('ret-f-note').value.trim() || null,
        trackingNumber: $('ret-f-bon').value.trim() || null,
      }),
    });
    $('return-modal').classList.remove('open');
    // La différence à payer : le lien est parti, ou on dit pourquoi pas.
    if (cree?.lien?.envoye) toast('Dossier créé, lien de paiement envoyé au client : l’échange partira dès le paiement.');
    else if (cree?.lien?.erreur) toast(`Dossier créé, mais le lien de paiement n’est pas parti : ${cree.lien.erreur}`, true);
    else toast('Dossier de retour créé. Prochaine étape : fournir le bon de retour au client.');
    /*
     * Recharger seulement l'écran qu'on regarde.
     *
     * Le dossier se crée aussi depuis un message client, et `loadReturns`
     * lançait alors trois requêtes pour un écran invisible, remettait l'onglet
     * de l'agent sur « Dossiers », et faisait passer une panne réseau pour un
     * échec de la création — qui, elle, avait réussi.
     */
    if (state.view === 'returns') {
      state.returns.tab = 'cases';
      await loadReturns();
    }
  } catch (error) {
    toast(error.message, true);
  }
});

const VIEW_META = {
  /* `sous` n'existe que là où le titre seul ne dit pas à quoi sert l'écran.
     Le poste de pilotage en a besoin : « Vue d'ensemble » ne promet rien. */
  overview: {
    icon: 'grid',
    label: "Vue d'ensemble",
    group: 'Pilotage',
    title: "Vue d'ensemble",
    sous: 'Votre activité SAV en un coup d’œil',
  },
  tickets: { icon: 'inbox', label: 'SAV client', group: 'Pilotage', title: 'SAV client' },
  stats: { icon: 'chart', label: "Statistiques", group: 'Pilotage', title: "Statistiques" },
  couts: {
    icon: 'coins',
    label: 'Coûts SAV',
    group: 'Pilotage',
    // Le même mot que dans le menu : « Coûts du SAV » se cassait sur deux
    // lignes dans l'en-tête, à côté de la recherche.
    title: 'Coûts SAV',
    sous: 'Ce que le SAV vous coûte, mois par mois',
  },
  orders: { icon: 'bag', label: 'Commandes', group: 'Commerce', title: 'Commandes' },
  customers: { icon: 'person', label: 'Clients', group: 'Commerce', title: 'Clients' },
  catalog: { icon: 'tag', label: 'Catalogue', group: 'Commerce', title: 'Catalogue' },
  /*
   * Fournisseur : les quatre gestes du SAV, rien d'autre.
   *
   * Renvoi et Retour sont deux portes vers le même écran (Reshipment), chacune
   * sur son onglet : `alias` dit l'écran, `onglet` l'onglet ouvert.
   */
  suppliers: {
    icon: 'factory',
    label: 'Fournisseur',
    group: 'Fournisseur',
    title: 'Fournisseurs',
  },
  changes: { icon: 'pencil', label: 'Modification', group: 'Fournisseur', title: 'Modification' },
  refunds: { icon: 'card', label: 'Annulation/\u200bRemboursement', group: 'Fournisseur', title: 'Annulations et remboursements' },
  renvoi: { icon: 'cycle', label: 'Renvoi', group: 'Fournisseur', title: 'Renvoi — stock retours', alias: 'returns', onglet: 'stock' },
  retour: { icon: 'uturn', label: 'Retour', group: 'Fournisseur', title: 'Retours clients', alias: 'returns', onglet: 'cases' },
  // Atelier : le travail avec le fournisseur au quotidien.
  envoi: {
    icon: 'truck',
    label: 'Commandes du jour',
    group: 'Atelier',
    title: 'Commandes du jour',
    sous: 'Stock retours d’abord, fournisseur ensuite',
  },
  ruptures: {
    icon: 'alerte',
    label: 'Ruptures de stock',
    group: 'Atelier',
    title: 'Ruptures de stock',
    sous: 'Commandes nécessitant une action suite à une indisponibilité produit',
  },
  tracking: { icon: 'pin', label: 'Suivi colis', group: 'Atelier', title: 'Suivi des colis' },
  // Hors navigation : on y entre par Renvoi ou Retour.
  returns: { icon: 'box', label: 'Reshipment', group: 'Fournisseur', title: 'Reshipment — retours clients', hidden: true },
  disputes: { icon: 'shield', label: 'Litiges Shopify', group: 'Finance', title: 'Litiges Shopify' },
  team: { icon: 'users', label: 'Équipe & rôles', group: 'Plateforme', title: 'Équipe & rôles' },
  canned: { icon: 'bubble', label: 'Réponses types', group: 'Plateforme', title: 'Réponses types' },
  settings: { icon: 'gear', label: 'Réglages', group: 'Plateforme', title: 'Réglages' },
};

const NAV_GROUPS = ['Pilotage', 'Commerce', 'Fournisseur', 'Atelier', 'Finance', 'Plateforme'];

const VIEWS = Object.keys(VIEW_META);

/**
 * Compte des demandes de changement en attente, pour la pastille rouge.
 *
 * Rafraîchi avec la file, mais au plus une fois par minute : la file se
 * recharge à chaque geste, et ce compte ne bouge que lorsqu'un fournisseur
 * répond.
 */
/** « Modification » : Taille, Modèle, Coordonnées — le reste vit dans Fournisseur. */
const KINDS_MODIFICATION = new Set(['SIZE', 'PRODUCT', 'ADDRESS', 'PHONE']);


/** Copie de `DELAI_URGENCE_H` (src/services/suppliers/urgence.ts), comparée par les tests. */
const DELAI_URGENCE_H = 4;

/**
 * Les urgences auxquelles l'atelier n'a pas répondu à temps. Au-delà de trois
 * jours, le colis est parti ou non : le bandeau n'y changerait plus rien.
 */
function urgencesSansReponse(demandes, maintenant = Date.now()) {
  return (demandes ?? []).filter((demande) => {
    const age = maintenant - new Date(demande.createdAt).getTime();
    return (
      demande.status === 'PENDING' &&
      KINDS_URGENTS.has(demande.kind) &&
      age > DELAI_URGENCE_H * 3_600_000 &&
      age < 3 * 86_400_000
    );
  });
}

function renderUrgencesSansReponse(demandes) {
  const bandeau = $('urg-banner');
  if (!bandeau) return;
  const liste = urgencesSansReponse(demandes);
  bandeau.hidden = liste.length === 0;
  if (liste.length === 0) return;

  const heures = (demande) => Math.floor((Date.now() - new Date(demande.createdAt).getTime()) / 3_600_000);
  bandeau.innerHTML = `<p><b>${
    liste.length > 1 ? `${liste.length} demandes urgentes` : 'Une demande urgente'
  } sans réponse de l’atelier depuis plus de ${DELAI_URGENCE_H} h.</b> Le colis peut partir tel quel : appelez l’atelier.</p>
    <ul>${liste
      .slice(0, 5)
      .map(
        (demande) => `<li><b>${esc(demande.orderName ?? 'Sans commande')}</b> · ${esc(CHANGE_KINDS[demande.kind] ?? demande.kind)}${
          demande.afterValue ? ` (${esc(demande.beforeValue ?? '?')} → ${esc(demande.afterValue)})` : ''
        } · ${esc(demande.supplier?.name ?? '—')}${
          demande.supplier?.phone
            ? ` · <a href="tel:${esc(demande.supplier.phone.replace(/[^\d+]/g, ''))}">${esc(demande.supplier.phone)}</a>`
            : ''
        } · depuis ${heures(demande)} h</li>`,
      )
      .join('')}</ul>
    <button class="btn btn-small" type="button" id="urg-voir">Voir les demandes</button>`;
  $('urg-voir').addEventListener('click', () => setView('suppliers'));
}

let changesCountAt = 0;

async function refreshChangesCount() {
  if (Date.now() - changesCountAt < 60_000) return;
  changesCountAt = Date.now();

  try {
    const [{ changes: demandes }, { counts }, activity, returns, ruptures] = await Promise.all([
      api('/api/changes'),
      // Commandes, clients, catalogue, colis : les volumes, en gris. Seuls
      // les comptes qui réclament une action sont rouges.
      api('/api/nav-counts'),
      // Ce que les ateliers ont renvoyé : réponses aux escalades, signalements
      // depuis l'atelier, demandes traitées dont il faut informer le client.
      api('/api/supplier-activity'),
      // Retours silencieux : trois jours sans nouvelle du client, la pastille
      // rouge le dit avant que la paire ne soit perdue.
      api('/api/returns').catch(() => null),
      // Les dossiers de rupture encore ouverts. Un comptage en base, sans
      // Shopify : la relève a lieu chaque minute.
      api('/api/ruptures/compte').catch(() => null),
    ]);

    // La pastille dit ce que l'écran montre d'abord : les clients à prévenir.
    const pending = modificationsAPrevenir(demandes);
    state.changesPending = pending;
    renderUrgencesSansReponse(demandes);
    guetterAtelier(state.supplierActivity, activity);
    state.supplierActivity = activity;
    state.navCounts = {
      ...state.navCounts,
      ...counts,
      changes: pending,
      /*
       * Deux compteurs, deux attentes opposées.
       *
       * « Update » compte ce que j'attends du fournisseur ; « Fournisseurs »
       * ce qu'il m'a rendu et que je n'ai pas repris. Les confondre dans un
       * seul chiffre ferait clignoter la navigation pour du travail qui n'est
       * pas le mien.
       */
      suppliers: activity.total,
      returns: returns?.counts?.silent ?? state.navCounts?.returns ?? 0,
      // En échec, la pastille garde sa valeur : un compteur qui rate un tour
      // ne doit ni s'éteindre ni retomber à zéro, ce qui dirait « plus rien ».
      ruptures: ruptures?.ouverts ?? state.navCounts?.ruptures ?? 0,
      // Les remboursements décidés sur une rupture, que l'administration doit faire.
      refunds: ruptures?.aRembourser ?? state.navCounts?.refunds ?? 0,
    };
    renderNav();
  } catch {
    // Un compteur qui manque un tour vaut mieux qu'une erreur à l'écran.
  }
}

function renderNav() {
  // Recherche : on ne masque pas les groupes vides en les laissant en place,
  // ils laisseraient des titres orphelins au-dessus de rien.
  const needle = (state.navQuery ?? '').trim().toLowerCase();
  const matches = (view) =>
    !needle ||
    `${VIEW_META[view].label} ${VIEW_META[view].group}`.toLowerCase().includes(needle);

  $('nav').innerHTML = NAV_GROUPS.map((group) => {
    const items = VIEWS.filter(
      (view) => !VIEW_META[view].hidden && VIEW_META[view].group === group && matches(view),
    );
    if (items.length === 0) return '';

    return `<div class="nav-group">
      <p class="nav-title">${esc(group)}</p>
      ${items
        .map((view) => {
          const meta = VIEW_META[view];
          // Chaque écran qui accumule du retard porte son compte. Un chiffre
          // dans la navigation évite d'ouvrir un écran pour découvrir qu'il
          // n'y avait rien — et surtout d'en ignorer un qui déborde.
          const tally =
            view === 'tickets'
              ? (state.pendingCount ?? 0)
              : view === 'retour'
                ? (state.navCounts?.returns ?? 0)
                : (state.navCounts?.[view] ?? 0);
          /*
           * Deux familles de pastilles, deux couleurs.
           *
           * Les volumes — commandes, clients, catalogue, colis — informent :
           * ils sont gris. Les comptes qui réclament un geste — SAV, Update,
           * litiges, fournisseurs en attente — restent rouges, et Update
           * passe en rouge plein : une demande sans réponse est une promesse
           * faite à un client.
           */
          /*
           * Trois écrans ne portent plus de compte : Commandes, Clients,
           * Catalogue. Leur volume ne réclame aucun geste — savoir qu'il y a
           * 4388 commandes n'apprend rien qu'on puisse faire. Une pastille
           * qui n'appelle pas d'action apprend surtout à ignorer les
           * pastilles, y compris celles qui en appellent une.
           */
          const mute = ['orders', 'customers', 'catalog'].includes(view);
          const dim = view === 'tracking';
          const hot = ['changes', 'suppliers', 'retour', 'ruptures', 'envoi', 'refunds'].includes(view) && tally > 0;
          const shown = tally > 9999 ? '9999+' : tally;
          const badge = tally && !mute;
          const courant = meta.alias
            ? state.view === meta.alias && state.returns?.tab === meta.onglet
            : view === state.view;
          return `<button class="nav-item" data-view="${view}" aria-current="${courant}">${ico(meta.icon)}<span class="nav-label">${esc(meta.label)}</span>${
            badge
              ? `<span class="tally${hot ? ' tally-hot' : dim ? ' tally-dim' : ''}">${shown}</span>`
              : ''
          }</button>`;
        })
        .join('')}
    </div>`;
  }).join('');

  if (!$('nav').innerHTML.trim()) {
    $('nav').innerHTML = '<p class="empty" style="padding: 4px 8px">Aucun écran ne correspond.</p>';
  }

  $('nav')
    .querySelectorAll('.nav-item')
    .forEach((item) =>
      item.addEventListener('click', () => {
        const meta = VIEW_META[item.dataset.view];
        if (!meta.alias) return setView(item.dataset.view);
        setView(meta.alias);
        document.querySelector(`#ret-tabs [data-rtab="${meta.onglet}"]`)?.click();
        renderNav();
        $('view-title').textContent = meta.title;
      }),
    );
}

$('nav-search').addEventListener('input', (event) => {
  state.navQuery = event.target.value;
  renderNav();
});

/**
 * Recherche globale.
 *
 * Le champ servait seulement à filtrer la navigation. Or ce qu'on cherche
 * toute la journée, c'est une commande — « #1042 » —, et accessoirement un
 * client. La destination se déduit de ce qui est tapé plutôt que d'un menu à
 * choisir avant de taper.
 */
function routeSearch(raw) {
  const term = raw.trim();
  if (!term) return;

  // Un numéro de commande, avec ou sans dièse : c'est le cas majoritaire, il
  // passe en premier.
  if (/^#?\d{2,}$/.test(term)) {
    state.orders.q = term.startsWith('#') ? term : `#${term}`;
    $('orders-q').value = state.orders.q;
    setView('orders');
    void loadOrders({ reset: true });
    return;
  }

  // Une adresse email désigne un client : sa fiche dit plus que la liste des
  // commandes du même nom.
  if (term.includes('@')) {
    state.customers.q = term;
    $('customers-q').value = term;
    setView('customers');
    void loadCustomers({ reset: true });
    return;
  }

  // Un écran porte ce nom : on y va, c'est l'ancien comportement du champ.
  const view = VIEWS.find((candidate) =>
    VIEW_META[candidate].label.toLowerCase().includes(term.toLowerCase()),
  );
  if (view) {
    setView(view);
    return;
  }

  // Sinon, du texte libre : la file de traitement le cherche dans les objets,
  // les clients et les numéros de commande.
  state.queue.q = term;
  renderJetons();
  setView('tickets');
  void loadQueue();
}

$('nav-search').addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    event.target.value = '';
    state.navQuery = '';
    renderNav();
    event.target.blur();
    return;
  }

  if (event.key !== 'Enter') return;

  routeSearch(event.target.value);

  // La navigation était filtrée pendant la frappe : la laisser ainsi vide la
  // barre latérale au moment précis où l'on arrive sur l'écran demandé.
  state.navQuery = '';
  renderNav();
  event.target.blur();
});

document.addEventListener('keydown', (event) => {
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName ?? '');
  if (event.key === '/' && !typing) {
    event.preventDefault();
    $('nav-search').focus();
  }
});

/* --------------------------------------------------- demandes de changement */

/* ==========================================================================
   DEMANDES AUX ATELIERS — écrans Modification et Fournisseur

   Une ligne par demande et la fiche à côté ; au téléphone, la fiche se
   pousse par-dessus. Chaque ligne dit, dans l'ordre où l'on décide : ce qui
   change (« 44 au lieu de 42 »), la commande et le client, ce que l'atelier
   en a fait, et ce qui reste à faire de notre côté — un client à prévenir.
   La fiche dit en plus quoi lui répondre, l'historique, et si la commande
   est déjà partie : une taille à changer sur un colis parti n'appelle plus
   la même réponse.
   ========================================================================== */

const STATUTS_DEMANDE = [
  ['PREVENIR', 'À prévenir'],
  ['PENDING', 'En attente'],
  ['ACKNOWLEDGED', 'Faites'],
  ['REFUSED', 'Refusées'],
  ['', 'Toutes'],
];
const ETATS_DEMANDE = {
  PENDING: { mot: 'En attente', ton: 'attente' },
  ACKNOWLEDGED: { mot: 'Faite', ton: 'faite' },
  REFUSED: { mot: 'Refusée', ton: 'refusee' },
};

/** Une réponse de l'atelier dont le client n'a pas encore été prévenu. */
function aPrevenir(change) {
  return change.status !== 'PENDING' && !change.handledAt;
}

function passeLeStatut(change, statut) {
  return statut === 'PREVENIR' ? aPrevenir(change) : !statut || change.status === statut;
}

const TRAITS_DEMANDE = {
  SIZE: 'M3 15.5 15.5 3l5.5 5.5L8.5 21zM7 12l2 2M10 9l2 2M13 6l2 2',
  PRODUCT: 'M3.5 7.5 12 3l8.5 4.5v9L12 21l-8.5-4.5zM3.5 7.5 12 12l8.5-4.5M12 12v9',
  COLOR: 'M12 3a9 9 0 1 0 0 18c1.1 0 1.8-.7 1.8-1.6 0-.5-.2-.9-.5-1.2a1.7 1.7 0 0 1 1.3-2.8H17a4 4 0 0 0 4-4C21 6.6 17 3 12 3zM7.5 12.5h.01M9.5 8h.01M14.5 8h.01',
  ADDRESS: 'M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21zM12 12a2.5 2.5 0 1 0 0-5a2.5 2.5 0 0 0 0 5',
  PHONE: 'M5 3.5h3.5l1.8 4.6-2.3 1.4a11 11 0 0 0 5.5 5.5l1.4-2.3 4.6 1.8V18a2.5 2.5 0 0 1-2.5 2.5A15.5 15.5 0 0 1 2.5 6 2.5 2.5 0 0 1 5 3.5',
  HOLD: 'M12 21a9 9 0 1 0 0-18a9 9 0 0 0 0 18M10 9v6M14 9v6',
  CANCEL: 'M12 21a9 9 0 1 0 0-18a9 9 0 0 0 0 18M5.6 5.6l12.8 12.8',
  MISSING_ITEM: 'M3.5 7.5 12 3l8.5 4.5v9L12 21l-8.5-4.5zM3.5 7.5 12 12l8.5-4.5M12 12v9',
  DELAY: 'M12 21a9 9 0 1 0 0-18a9 9 0 0 0 0 18M12 7v5l3 2',
  TRACKING: 'M2.5 6.5h11v10h-11zM13.5 10h4l3 3.2v3.3h-7M6.5 19a1.8 1.8 0 1 0 0-3.6a1.8 1.8 0 0 0 0 3.6M17 19a1.8 1.8 0 1 0 0-3.6a1.8 1.8 0 0 0 0 3.6',
  OTHER: 'M4 20l1.3-3.8A8 8 0 1 1 8.2 19z',
};

function traitDemande(kind) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"
    stroke-linejoin="round" aria-hidden="true"><path d="${TRAITS_DEMANDE[kind] ?? TRAITS_DEMANDE.OTHER}" /></svg>`;
}

/** Ce qu'on lit d'une demande : sa nature, la valeur voulue, l'ancienne, le client. */
function lireDemande(change) {
  const simple = valeurSimple(change);
  const message =
    String(change.message ?? '')
      .split('\n')
      .map((ligne) => ligne.trim())
      .find(Boolean) ?? '';
  return {
    nature: CHANGE_KINDS[change.kind] ?? change.kind,
    valeur: simple ?? change.afterValue ?? '',
    avant: !simple && change.afterValue ? (change.beforeValue ?? '') : '',
    message,
    client:
      change.ticket?.customerName ??
      change.ticket?.customerEmail ??
      (change.orderName ? `Commande ${change.orderName}` : 'Sans client'),
  };
}

function texteChangement(d) {
  if (d.valeur) return d.avant ? `${d.valeur} au lieu de ${d.avant}` : d.valeur;
  return d.message || d.nature;
}

/** « d’Atelier Nord », « de Test Factory » : l'élision, devant une voyelle. */
function deNom(nom) {
  return /^[aeiouyhàâäéèêëîïôöûü]/i.test(nom) ? `d’${nom}` : `de ${nom}`;
}

/** Pour une liste : l'heure aujourd'hui, « hier », le jour de la semaine, puis la date. */
function quandCourt(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  const minutes = (Date.now() - date.getTime()) / 60000;
  if (minutes < 1) return 'à l’instant';
  if (minutes < 60) return `il y a ${Math.round(minutes)} min`;
  const aujourdhui = new Date();
  const hier = new Date();
  hier.setDate(aujourdhui.getDate() - 1);
  if (date.toDateString() === aujourdhui.toDateString()) return shortTime(iso);
  if (date.toDateString() === hier.toDateString()) return 'hier';
  if (minutes < 6 * 1440) return date.toLocaleDateString('fr-FR', { weekday: 'long' });
  return date.toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'short',
    ...(date.getFullYear() !== aujourdhui.getFullYear() ? { year: 'numeric' } : {}),
  });
}

/** Pour une phrase : « aujourd’hui à 09:12 », « hier à 16:54 », « le 11 octobre 2026 à 18:02 ». */
function quandLong(iso) {
  if (!iso) return '';
  const texte = dayOrDateTime(iso);
  return /^(Aujourd|Hier)/.test(texte) ? texte.charAt(0).toLowerCase() + texte.slice(1) : `le ${texte}`;
}

/** Ce qui reste à faire de notre côté, sous l'état de la ligne. */
function suiteDemande(change) {
  if (change.status !== 'PENDING') {
    return change.handledAt ? { texte: 'client prévenu', classe: '' } : { texte: 'client à prévenir', classe: ' fod-suite-action' };
  }
  if (change.emailedAt) return { texte: 'mail parti', classe: '' };
  return KINDS_URGENTS.has(change.kind)
    ? { texte: 'mail non parti', classe: ' fod-suite-alerte' }
    : { texte: 'au récap de 9 h (Chine)', classe: '' };
}

function ligneDemande(change, choisie) {
  const d = lireDemande(change);
  const etat = ETATS_DEMANDE[change.status] ?? ETATS_DEMANDE.PENDING;
  const suite = suiteDemande(change);
  return `<div role="listitem"><button type="button" class="fod" data-dem="${esc(change.id)}" aria-current="${
    change.id === choisie
  }">
    <span class="fod-nature">${traitDemande(change.kind)}<span><b>${esc(d.nature)}<span class="fod-qui"> · ${esc(
      d.client,
    )}</span></b><span>${esc(texteChangement(d))}</span></span></span>
    <b class="fod-num">${esc(change.orderName ?? '—')}</b>
    <span class="fod-client"><span>${esc(d.client)}</span><span>${esc(change.supplier?.name ?? '—')}</span></span>
    <span class="fod-etat"><span><i class="fod-point fod-${etat.ton}" aria-hidden="true"></i>${esc(etat.mot)}</span><span class="fod-suite${
      suite.classe
    }">${esc(suite.texte)}</span></span>
    <span class="fod-date">${esc(quandCourt(change.createdAt))}</span>
  </button></div>`;
}

/**
 * La liste des demandes. `statut` est le filtre de statut de l'écran
 * appelant : il choisit le message de la liste vide. La ligne choisie se lit
 * dans `rows.dataset.choisie`.
 */
function renderDemandes(rows, compteur, shown, statut) {
  if (!rows) return;
  if (compteur) {
    compteur.textContent = shown.length ? `${shown.length} demande${shown.length > 1 ? 's' : ''}` : '';
  }
  const choisie = rows.dataset?.choisie ?? '';
  rows.innerHTML =
    shown.map((change) => ligneDemande(change, choisie)).join('') ||
    `<p class="fo-vide">${
      statut === 'PREVENIR'
        ? 'Aucun client à prévenir : tout est transmis.'
        : statut === 'PENDING'
          ? 'Aucune demande en attente — les fournisseurs sont à jour.'
          : 'Aucune demande.'
    }</p>`;
}

function segmentsDemandesMarkup(liste, actif, attribut) {
  return STATUTS_DEMANDE.map(([cle, nom]) => {
    const n = liste.filter((change) => passeLeStatut(change, cle)).length;
    return `<button type="button" data-${attribut}="${cle}" aria-pressed="${cle === actif}">${nom}<span class="fo-seg-n${
      cle === 'PREVENIR' && n ? ' fo-seg-n-action' : ''
    }">${n}</span></button>`;
  }).join('');
}

const PROPOSER_AU_CLIENT = { SIZE: 'une autre taille', COLOR: 'une autre couleur', PRODUCT: 'un autre modèle' };
const COCHE_FICHE =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>';
const PICTOS_ETAT = {
  attente: 'M7 3.5h10M7 20.5h10M8 3.5c0 5 8 5 8 8.5s-8 3.5-8 8.5M16 3.5c0 5-8 5-8 8.5',
  faite: 'M5 12.5l4.5 4.5L19 7.5',
  refusee: 'M7 7l10 10M17 7 7 17',
};

/** La fiche d'une demande : où elle en est, ce que dit l'atelier, quoi faire. */
function ficheDemandeMarkup(change) {
  if (!change) return '<p class="fo-vide fof-vide">Choisissez une demande dans la liste.</p>';
  const d = lireDemande(change);
  const etat = ETATS_DEMANDE[change.status] ?? ETATS_DEMANDE.PENDING;
  const atelier = change.supplier?.name ?? 'l’atelier';
  const repondue = change.status !== 'PENDING';
  const id = esc(change.id);

  const titreEtat =
    change.status === 'REFUSED'
      ? `Refusée par ${atelier}`
      : change.status === 'ACKNOWLEDGED'
        ? `Faite par ${atelier}`
        : `En attente ${deNom(atelier)}`;

  let conseil;
  if (change.status === 'REFUSED') {
    conseil = change.handledAt
      ? 'Le client a été prévenu du refus.'
      : `Ne confirmez rien au client : l’atelier n’a pas pu le faire.${
          PROPOSER_AU_CLIENT[change.kind] ? ` Proposez-lui ${PROPOSER_AU_CLIENT[change.kind]}, ou un remboursement.` : ''
        }`;
  } else if (change.status === 'ACKNOWLEDGED') {
    conseil = change.handledAt ? 'Le client a été prévenu.' : 'C’est fait : vous pouvez le confirmer au client.';
  } else {
    const heures = state.supplierHub?.[change.supplier?.id]?.fiabilite?.reponseMoyenneH;
    conseil = `${heures != null ? `${atelier} répond d’ordinaire en ${dureeLisible(heures)}. ` : ''}Sa réponse arrivera dans À traiter, sur la page Fournisseur.`;
    if (change.orderShipped) conseil = `La commande est déjà partie : la demande arrive peut-être trop tard. ${conseil}`;
  }

  const lienMail = (texte) =>
    change.ticket ? `<button type="button" class="fof-lien" data-dem-mail="${esc(change.ticket.id)}">${texte}</button>` : '';
  const gestes = aPrevenir(change)
    ? `<div class="fof-gestes">
        <button type="button" class="btn btn-primary" data-dem-prevenu="${id}">J’ai prévenu le client</button>
        ${change.ticket ? `<button type="button" class="fo-bouton" data-dem-mail="${esc(change.ticket.id)}">Ouvrir le mail du client</button>` : ''}
      </div>`
    : change.status === 'PENDING'
      ? `<div class="fof-gestes">
          <button type="button" class="fo-bouton" data-chg-edit="${id}">Modifier la demande</button>
          <button type="button" class="fo-bouton fo-bouton-rouge" data-chg-cancel="${id}">Annuler la demande</button>
        </div>${lienMail('Ouvrir le mail du client')}`
      : `<div class="fof-prevenu">${COCHE_FICHE}<span>Client prévenu ${esc(quandLong(change.handledAt))}</span>${lienMail('Ouvrir le mail')}</div>`;

  const histoire = [
    { quoi: change.creePar ? `Demandée par ${change.creePar}` : 'Demandée', quand: change.createdAt, ton: 'gris' },
    change.emailedAt
      ? { quoi: `Mail parti à ${atelier}`, quand: change.emailedAt, ton: 'gris' }
      : change.status === 'PENDING'
        ? KINDS_URGENTS.has(change.kind)
          ? { quoi: 'Le mail n’est pas parti', quand: null, ton: 'refusee' }
          : { quoi: 'Partira au récap de 9 h (Chine)', quand: null, ton: 'gris' }
        : null,
    repondue
      ? { quoi: change.status === 'REFUSED' ? 'Refusée par l’atelier' : 'Faite par l’atelier', quand: change.acknowledgedAt, ton: etat.ton }
      : { quoi: 'Réponse de l’atelier attendue', quand: null, ton: 'attente' },
    change.handledAt ? { quoi: 'Client prévenu', quand: change.handledAt, ton: 'bleu' } : null,
  ].filter(Boolean);

  const expedition =
    change.orderShipped === null || change.orderShipped === undefined
      ? ''
      : `<span><i class="fod-point fod-${repondue ? 'gris' : change.orderShipped ? 'refusee' : 'faite'}" aria-hidden="true"></i>${
          change.orderShipped ? 'Déjà expédiée' : 'Pas encore expédiée'
        }</span>`;

  return `<div class="fof">
    <div class="fof-tete">
      <span class="fof-sur">${esc(
        d.valeur ? [d.nature, change.orderName].filter(Boolean).join(' · ') : change.orderName ? `Commande ${change.orderName}` : 'Demande',
      )}</span>
      <h3 class="fof-titre">${esc(d.valeur || d.nature)}</h3>
      <span class="fof-sous">${esc(
        [d.avant ? `au lieu de ${d.avant}` : '', d.client, `demandée ${quandLong(change.createdAt)}`].filter(Boolean).join(' · '),
      )}</span>
    </div>

    <div class="fof-etat fof-${etat.ton}">
      <div class="fof-etat-l">
        <span class="fof-pastille" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6"
          stroke-linecap="round" stroke-linejoin="round"><path d="${PICTOS_ETAT[etat.ton]}" /></svg></span>
        <b>${esc(titreEtat)}</b>
        <span class="fof-quand">${esc(repondue ? quandLong(change.acknowledgedAt) : change.emailedAt ? 'mail parti' : '')}</span>
      </div>
      ${change.supplierNote ? `<p class="fof-note">« ${esc(change.supplierNote)} »</p>` : ''}
      <p class="fof-conseil">${esc(conseil)}</p>
    </div>

    ${gestes}

    ${
      !d.valeur && change.message
        ? `<section class="fof-section"><h4 class="fof-t">Message à l’atelier</h4><p class="fof-message">${esc(change.message)}</p></section>`
        : ''
    }

    <section class="fof-section">
      <h4 class="fof-t">Historique</h4>
      <ol class="fof-histoire">${histoire
        .map(
          (h) => `<li><i class="fod-point fod-${h.ton}" aria-hidden="true"></i><span>${esc(h.quoi)}</span><time>${esc(
            h.quand ? quandLong(h.quand) : '',
          )}</time></li>`,
        )
        .join('')}</ol>
    </section>

    ${
      change.orderName
        ? `<section class="fof-section">
            <h4 class="fof-t">Commande ${esc(change.orderName)}</h4>
            <div class="fof-commande">
              <span class="fof-commande-txt"><b>${esc(d.client)}</b>${expedition}</span>
              ${change.shopifyOrderId ? `<button type="button" class="fof-lien" data-dem-commande="${esc(change.shopifyOrderId)}">Voir la commande</button>` : ''}
            </div>
          </section>`
        : ''
    }
  </div>`;
}

/* Les gestes de la liste et de la fiche, les mêmes sur les deux écrans. */
function gererClicDemande(event, ecran) {
  const sur = (selecteur) => event.target.closest(selecteur);
  let cible;
  if ((cible = sur('[data-dem]'))) {
    choisirDemande(ecran, cible.dataset.dem);
    return true;
  }
  if ((cible = sur('[data-dem-prevenu]'))) {
    void marquerPrevenu(cible);
    return true;
  }
  if ((cible = sur('[data-dem-mail]'))) {
    setView('tickets');
    void selectTicket(cible.dataset.demMail);
    return true;
  }
  if ((cible = sur('[data-dem-commande]'))) {
    void openOrderSheet(cible.dataset.demCommande);
    return true;
  }
  if ((cible = sur('[data-chg-edit]'))) {
    modifierDemande(cible.dataset.chgEdit);
    return true;
  }
  if ((cible = sur('[data-chg-cancel]'))) {
    void annulerDemande(cible);
    return true;
  }
  return false;
}

function choisirDemande(ecran, id) {
  state.demandeChoisie[ecran] = id;
  if (ecran === 'changes') {
    renderChangesScreen();
    ouvrirPileModif();
  } else {
    renderDemandesFournisseur();
    if (PILE_TICKETS.matches) ouvrirPileFo('fiche', id);
  }
}

/* Les flèches haut et bas parcourent la liste, comme dans Mail. */
function parcourirDemandes(event, ecran) {
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
  const lignes = [...event.currentTarget.querySelectorAll('[data-dem]')];
  const i = lignes.indexOf(document.activeElement);
  if (i < 0) return;
  event.preventDefault();
  const suivante = lignes[i + (event.key === 'ArrowDown' ? 1 : -1)];
  if (!suivante) return;
  state.demandeChoisie[ecran] = suivante.dataset.dem;
  if (ecran === 'changes') renderChangesScreen();
  else renderDemandesFournisseur();
  event.currentTarget.querySelector(`[data-dem="${suivante.dataset.dem}"]`)?.focus();
}

async function rechargerDemandes() {
  changesCountAt = 0;
  try {
    const data = await api('/api/changes');
    state.changesRows = data.changes ?? [];
  } catch (error) {
    toast(error.message, true);
    return;
  }
  if (state.view === 'changes') renderChangesScreen();
  if (state.view === 'suppliers') {
    renderDemandesFournisseur();
    renderATraiter();
    void renderSupplierActivity();
  }
  void refreshChangesCount();
}

async function marquerPrevenu(bouton) {
  bouton.disabled = true;
  try {
    await api(`/api/changes/${bouton.dataset.demPrevenu}/handled`, { method: 'POST', body: '{}' });
    toast('Noté — la demande sort de vos retours fournisseur.');
    await rechargerDemandes();
  } catch (error) {
    toast(error.message, true);
    bouton.disabled = false;
  }
}

// Corriger une demande en attente : le même formulaire que la création,
// pré-rempli — l'annuler pour la refaire enverrait un second mail.
function modifierDemande(id) {
  const change = state.changesRows.find((candidate) => candidate.id === id);
  if (!change) return;

  $('alert-modal').dataset.supplier = change.supplier?.id ?? '';
  $('alert-modal').dataset.ticket = '';
  $('alert-modal').dataset.order = change.shopifyOrderId ?? '';
  $('alert-modal').dataset.editing = change.id;
  $('alert-who').textContent = change.supplier?.name ? `Demande à ${change.supplier.name}` : '';
  state.alertCtx = null;
  setAlertKind(change.kind);
  $('alert-before').value = change.beforeValue ?? '';
  $('alert-after').value = change.afterValue ?? '';
  const single = KINDS_SINGLE[change.kind];
  if (single) {
    $('alert-single').value = (single.champ === 'before' ? change.beforeValue : change.afterValue) ?? '';
  }
  $('alert-order').value = change.orderName ?? '';
  $('alert-message').value = change.message ?? '';
  renderAlertSuppliers();
  if (change.supplier?.id) $('alert-supplier').value = change.supplier.id;
  $('alert-modal').hidden = false;
  $('alert-modal').classList.add('open');
}

async function annulerDemande(bouton) {
  if (!await confirmer('Annuler cette demande ?\n\nElle disparaît aussi de l’espace du fournisseur.', { action: 'Annuler la demande', annuler: 'Garder', danger: true, icone: 'message' })) return;
  bouton.disabled = true;
  try {
    await api(`/api/changes/${bouton.dataset.chgCancel}`, { method: 'DELETE' });
    toast('Demande annulée.');
    await rechargerDemandes();
  } catch (error) {
    toast(error.message, true);
    bouton.disabled = false;
  }
}

/* ------------------------------------------------------- Modification --- */

state.changesRows = [];
// Choisi au premier affichage : « À prévenir » s'il y a quelqu'un à prévenir.
state.changesFilter = null;
state.changesQ = '';
state.demandeChoisie = { changes: null, suppliers: null };

/** La pastille de Modification : les clients à prévenir d'une modification. */
function modificationsAPrevenir(demandes) {
  return (demandes ?? []).filter((d) => KINDS_MODIFICATION.has(d.kind) && aPrevenir(d)).length;
}

async function loadChanges() {
  const rows = $('changes-rows');
  if (!state.changesRows.length) rows.innerHTML = '<p class="fo-vide">Chargement…</p>';

  let data;
  try {
    data = await api('/api/changes');
  } catch (error) {
    rows.innerHTML = `<p class="fo-vide">${esc(error.message)}</p>`;
    return;
  }

  state.changesRows = data.changes ?? [];
  state.changesPending = modificationsAPrevenir(state.changesRows);
  state.navCounts = { ...state.navCounts, changes: state.changesPending };
  renderNav();
  renderChangesScreen();
}

function renderChangesScreen() {
  const modifications = state.changesRows.filter((change) => KINDS_MODIFICATION.has(change.kind));
  if (state.changesFilter === null) {
    state.changesFilter = modifications.some(aPrevenir)
      ? 'PREVENIR'
      : modifications.some((change) => change.status === 'PENDING')
        ? 'PENDING'
        : '';
  }
  const filter = state.changesFilter;
  const q = state.changesQ.trim().toLowerCase();
  const cherche = (change) =>
    !q ||
    [change.orderName, change.supplier?.name, change.ticket?.customerName, change.ticket?.customerEmail, change.afterValue, change.beforeValue]
      .some((valeur) => String(valeur ?? '').toLowerCase().includes(q));
  const trouvees = modifications.filter(cherche);

  $('changes-filters').innerHTML = segmentsDemandesMarkup(trouvees, filter, 'chg');
  const shown = trouvees.filter((change) => passeLeStatut(change, filter));
  const choisie =
    shown.find((change) => change.id === state.demandeChoisie.changes) ??
    (PILE_TICKETS.matches ? modifications.find((change) => change.id === state.demandeChoisie.changes) : shown[0]);
  $('changes-rows').dataset.choisie = choisie?.id ?? '';
  renderDemandes($('changes-rows'), $('changes-count'), shown, filter);
  $('changes-fiche-corps').innerHTML = ficheDemandeMarkup(choisie);
}

let defilementModif = 0;

function ouvrirPileModif() {
  const vue = $('view-changes');
  if (!PILE_TICKETS.matches || !vue) return;
  if (!vue.classList.contains('pile-fiche')) {
    defilementModif = scrollY;
    vue.classList.add('pile-fiche');
    history.pushState({ csavModif: true }, '');
  }
  requestAnimationFrame(() => scrollTo(0, 0));
}

function fermerPileModif({ parHistorique = false } = {}) {
  const vue = $('view-changes');
  if (!vue?.classList.contains('pile-fiche')) return;
  vue.classList.remove('pile-fiche');
  if (!parHistorique && history.state?.csavModif) history.back();
  requestAnimationFrame(() => scrollTo(0, defilementModif));
}

addEventListener('popstate', () => fermerPileModif({ parHistorique: true }));

$('view-changes').addEventListener('click', (event) => {
  if (gererClicDemande(event, 'changes')) return;
  if (event.target.closest('#changes-retour')) return fermerPileModif();
  const segment = event.target.closest('[data-chg]');
  if (!segment) return;
  state.changesFilter = segment.dataset.chg;
  state.demandeChoisie.changes = null;
  renderChangesScreen();
});
$('changes-rows').addEventListener('keydown', (event) => parcourirDemandes(event, 'changes'));
$('changes-q').addEventListener('input', (event) => {
  state.changesQ = event.target.value;
  renderChangesScreen();
});

/*
 * Demande hors mail.
 *
 * Le bouton du mail pré-remplit depuis la commande rattachée ; ici tout part
 * de zéro — le client a appelé, ou l'erreur s'est vue dans la commande. Sans
 * ce chemin, l'écran Update savait afficher des demandes mais pas en créer.
 */
$('changes-new')?.addEventListener('click', () => {
  if (activeSuppliers().length === 0) {
    toast('Ajoutez d’abord un fournisseur dans l’écran Fournisseurs.', true);
    return;
  }

  $('alert-modal').dataset.supplier = '';
  $('alert-modal').dataset.ticket = '';
  $('alert-modal').dataset.order = '';
  $('alert-who').textContent = '';
  state.alertCtx = null;
  setAlertKind('SIZE');
  $('alert-order').value = '';
  $('alert-message').value = '';
  renderAlertSuppliers();
  $('alert-modal').hidden = false;
  $('alert-modal').classList.add('open');
  $('alert-order').focus();
});

/* --------------------------------------- écran Fournisseur : demandes ---- */

// Toutes les demandes, triées par atelier, par type et par statut. Le statut
// part de « À prévenir » s'il y a quelqu'un à prévenir.
state.demandesFiltre = { fournisseur: null, type: '', statut: null };

function renderDemandesFournisseur() {
  const filtre = state.demandesFiltre;
  const toutes = state.changesRows ?? [];
  if (filtre.statut === null) {
    filtre.statut = toutes.some(aPrevenir) ? 'PREVENIR' : toutes.some((change) => change.status === 'PENDING') ? 'PENDING' : '';
  }

  const portee = toutes.filter(
    (change) =>
      (!filtre.fournisseur || change.supplier?.id === filtre.fournisseur) &&
      (!filtre.type || change.kind === filtre.type),
  );
  $('sup-dem-statut').innerHTML = segmentsDemandesMarkup(portee, filtre.statut, 'dstatut');

  // Les types proposés sont ceux qui existent : un choix qui ne trie rien
  // n'apprend qu'à ne plus ouvrir le menu.
  const types = [...new Set(toutes.map((change) => change.kind))];
  $('sup-dem-types').innerHTML = [['', 'Tous les types'], ...types.map((kind) => [kind, CHANGE_KINDS[kind] ?? kind])]
    .map(
      ([kind, nom]) => `<button type="button" role="menuitemradio" data-dtype="${esc(kind)}" aria-checked="${
        filtre.type === kind
      }"><span>${esc(nom)}</span><span class="fo-menu-n">${
        toutes.filter((change) => !kind || change.kind === kind).length
      }</span></button>`,
    )
    .join('');
  $('sup-dem-type-nom').textContent = filtre.type ? (CHANGE_KINDS[filtre.type] ?? filtre.type) : 'Tous les types';

  const fournisseur = state.suppliers?.find((supplier) => supplier.id === filtre.fournisseur);
  const jeton = $('sup-dem-qui');
  jeton.hidden = !fournisseur;
  jeton.innerHTML = fournisseur
    ? `${esc(fournisseur.name)}<svg viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M2 2l6 6M8 2 2 8" /></svg>`
    : '';
  jeton.setAttribute('aria-label', fournisseur ? `Retirer le filtre ${fournisseur.name}` : '');
  document.querySelectorAll('#suppliers-rows .foa').forEach((carte) =>
    carte.classList.toggle('foa-on', carte.dataset.supplier === filtre.fournisseur),
  );

  const shown = portee.filter((change) => passeLeStatut(change, filtre.statut));
  const choisie =
    shown.find((change) => change.id === state.demandeChoisie.suppliers) ??
    (PILE_TICKETS.matches ? toutes.find((change) => change.id === state.demandeChoisie.suppliers) : shown[0]);
  $('sup-dem-rows').dataset.choisie = choisie?.id ?? '';
  renderDemandes($('sup-dem-rows'), $('sup-dem-count'), shown, filtre.statut);
  $('sup-dem-fiche').innerHTML = ficheDemandeMarkup(choisie);
}

async function chargerDemandesFournisseur() {
  try {
    const data = await api('/api/changes');
    state.changesRows = data.changes ?? [];
  } catch (error) {
    $('sup-dem-rows').innerHTML = `<p class="fo-vide">${esc(error.message)}</p>`;
    return;
  }
  renderDemandesFournisseur();
  renderATraiter();
}

function basculerMenuTypes(ouvrir) {
  const menu = $('sup-dem-types');
  const ouvert = ouvrir ?? menu.hidden;
  menu.hidden = !ouvert;
  $('sup-dem-type-btn').setAttribute('aria-expanded', String(ouvert));
  if (ouvert) (menu.querySelector('[aria-checked="true"]') ?? menu.querySelector('button'))?.focus();
}

$('sup-dem-rows').addEventListener('keydown', (event) => parcourirDemandes(event, 'suppliers'));
$('sup-dem-types').addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    basculerMenuTypes(false);
    $('sup-dem-type-btn').focus();
    return;
  }
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
  event.preventDefault();
  const items = [...$('sup-dem-types').querySelectorAll('button')];
  const i = items.indexOf(document.activeElement);
  items[(i + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus();
});
document.addEventListener('click', (event) => {
  if ($('sup-dem-types').hidden || event.target.closest('#sup-dem-types, #sup-dem-type-btn')) return;
  basculerMenuTypes(false);
});

/* Chaque vue charge à sa première ouverture. Interroger Shopify pour un écran
   que personne ne regarde coûte une latence pour rien. */
const VIEW_LOADERS = {
  overview: () => loadOverview(),
  orders: () => !state.orders.loaded && loadOrders({ reset: true }),
  customers: () => !state.customers.loaded && loadCustomers({ reset: true }),
  catalog: () => !state.catalog.loaded && loadCatalog({ reset: true }),
  suppliers: () => {
    renderSuppliers();
    void renderSupplierActivity();
    void renderSignalementsFournisseurs();
    void loadSupplierHub();
    void chargerDemandesFournisseur();
  },
  changes: () => loadChanges(),
  ruptures: () => loadRuptures(),
  envoi: () => loadEnvoi(),
  returns: () => loadReturns(),
  tracking: () => loadTracking(),
  refunds: () => {
    // Une pastille rouge mène à ce qu'elle compte : la liste à rembourser.
    if ((state.navCounts?.refunds ?? 0) > 0) vueRemboursements = 'afaire';
    chargerVueRemboursements();
  },
  disputes: () => loadDisputes(),
  team: () => loadTeam(),
  stats: () => loadStats(),
  couts: () => loadCouts(),
  canned: () => loadCanned(),
  settings: () => {
    // L'apparence est une catégorie des Réglages : elle se peint à l'entrée,
    // sans attendre la réponse du serveur, puisqu'elle vit dans le navigateur.
    renderPalettes();
    renderTopBg();
    montrerVoletReglages(voletReglages);
    void openSettings();
  },
};

function setView(view) {
  // La barre de raccourcis appartient à la file : ailleurs, elle mentirait.
  const keybar = $('keybar');
  if (keybar) keybar.hidden = view !== 'tickets';

  state.view = view;

  // « Nouvelle escalade » n'a d'objet que sur un ticket : affiché ailleurs — sur
  // les Réglages, par exemple — il promet une action que l'écran ne peut pas
  // rendre.
  const escalate = document.getElementById('escalation-form');
  if (escalate && view !== 'tickets') escalate.hidden = true;

  // L'alerte de traitement appartient à la file : ailleurs, elle décrirait un
  // problème sans rapport avec l'écran qu'on regarde.
  const alarm = document.getElementById('fail-alarm');
  if (alarm && view !== 'tickets') alarm.hidden = true;
  const meta = VIEW_META[view];

  for (const name of VIEWS) {
    const el = $(`view-${name}`);
    if (el) el.hidden = name !== view;
  }

  // L'animation d'entrée ne joue qu'une fois par élément : pour qu'elle
  // accompagne chaque changement d'écran, on la relance en la retirant le
  // temps d'un cadre. Sans le `void offsetWidth`, le navigateur fusionne les
  // deux écritures et rien ne bouge.
  const title = $('view-title');
  title.style.animation = 'none';
  void title.offsetWidth;
  title.style.animation = '';
  title.textContent = meta.title;

  // Le sous-titre n'existe que pour certaines vues : là où il manque, la ligne
  // se retire au lieu de laisser un vide sous le titre.
  const sous = $('view-sub');
  if (sous) {
    sous.textContent = meta.sous ?? '';
    sous.hidden = !meta.sous;
  }
  // Sur l'écran SAV, le sous-titre dit ce qui attend : voir `loadMetrics`.
  if (view === 'tickets') afficherSousSav();
  // Sur la vue d'ensemble, il commence par la date : c'est un état du jour.
  if (view === 'overview' && sous) {
    const jour = new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
    sous.textContent = `${jour.charAt(0).toUpperCase()}${jour.slice(1)} · ${meta.sous.charAt(0).toLowerCase()}${meta.sous.slice(1)}`;
  }
  $('crumb').innerHTML = `${ico(meta.icon)} ${esc(meta.group)}`;

  // Les filtres décrivent la file : les laisser ailleurs ferait croire qu'ils
  // décrivent l'écran affiché — la barre de filtres est apparue au-dessus des
  // Réglages, où elle ne veut rien dire. Le bandeau d'indicateurs, lui, ne
  // s'affiche plus nulle part : ses chiffres vivent sous le titre et dans la
  // barre d'état de la file (`loadMetrics`).

  // Défilement par colonne : la file, le détail et le rail bougent chacun de
  // leur côté, et la page ne défile plus. Réservé à cet écran — les autres se
  // lisent comme des documents, d'un seul tenant. Voir `.app-locked`.
  $('app-grid')?.classList.toggle('app-locked', view === 'tickets');
  ouvrirFiltres(false);
  modeSelection(false);
  if (view !== 'tickets') fermerMessagePile();
  if (view !== 'orders') fermerFichePile();
  if (view === 'orders') afficherSousCommandes();
  if (view === 'refunds') afficherSousRemboursements();

  renderNav();

  try {
    VIEW_LOADERS[view]?.();
  } catch (error) {
    toast(error.message, true);
  }
}

/* ------------------------------------------------------------- apparence */

/* ------------------------------------------------- fond de la zone haute --

   Une couleur choisie par la personne, pour son écran. Même raison que les
   palettes d'accent : elle vit dans le navigateur, pas en base — la stocker
   côté serveur imposerait la même teinte au portable et au poste fixe.
*/

const TOPBG_CLE = 'csav.topbg';

/** #abc et #aabbcc, avec ou sans dièse. Rien d'autre : une saisie approximative
    vaut mieux refusée qu'appliquée de travers. */
function hexValide(valeur) {
  const t = String(valeur ?? '').trim().replace(/^#/, '');
  if (!/^[0-9a-fA-F]{3}$/.test(t) && !/^[0-9a-fA-F]{6}$/.test(t)) return null;
  const plein = t.length === 3 ? t.split('').map((c) => c + c).join('') : t;
  return `#${plein.toLowerCase()}`;
}

/** Luminance relative, au sens WCAG. Sert à deux choses : décider si l'encre
    doit être claire ou sombre, et afficher le contraste obtenu. */
function luminance(hex) {
  const canal = (i) => {
    const v = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * canal(0) + 0.7152 * canal(1) + 0.0722 * canal(2);
}

function contraste(a, b) {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** Rapproche une couleur du noir ou du blanc jusqu'à ce qu'elle atteigne le
    contraste voulu sur `fond`. Renvoie l'extrême si le seuil est hors
    d'atteinte — mieux vaut le meilleur possible qu'un abandon silencieux. */
function ajuste(depart, fond, cible) {
  const versBlanc = luminance(fond) <= 0.42;
  const but = versBlanc ? 255 : 0;
  const c = [0, 1, 2].map((i) => parseInt(depart.slice(1 + i * 2, 3 + i * 2), 16));

  for (let pas = 0; pas <= 20; pas += 1) {
    const t = pas / 20;
    const m = c.map((v) => Math.round(v + (but - v) * t));
    const hex = `#${m.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
    if (contraste(hex, fond) >= cible) return hex;
  }
  return versBlanc ? '#ffffff' : '#000000';
}

/*
 * L'encre suit le fond, elle ne le subit pas.
 *
 * C'est ce qui rend un sélecteur de couleur utilisable plutôt que piégeux :
 * sur un fond sombre choisi librement, un texte pensé pour du clair
 * deviendrait illisible sans que rien ne prévienne.
 *
 * Les encres sont CALCULÉES, pas choisies dans deux jeux figés. Deux jeux
 * suffisaient pour les teintes courantes mais pas pour toutes : sur un brun
 * sombre — #7c2d12 — l'encre atténuée tombait à 4,21:1, sous le seuil, alors
 * que rien ne le signalait. Chaque encre est donc rapprochée du blanc ou du
 * noir jusqu'à franchir son seuil : 7:1 pour le texte principal, 4,5:1 pour
 * l'atténué. Une couleur quelconque reste ainsi lisible.
 */
function encresPour(fond) {
  const clair = luminance(fond) > 0.42;
  const base = clair
    ? { ink: '#101018', soft: '#3d4152', mute: '#5c6172' }
    : { ink: '#f4f6fa', soft: '#ccd2de', mute: '#a7aebe' };

  return {
    ink: ajuste(base.ink, fond, 7),
    soft: ajuste(base.soft, fond, 4.5),
    mute: ajuste(base.mute, fond, 4.5),
    line: clair ? 'rgb(16 18 40 / 11%)' : 'rgb(255 255 255 / 16%)',
  };
}

function appliqueTopBg(hex) {
  const zone = $('topzone');
  if (!zone) return;

  if (!hex) {
    zone.removeAttribute('data-teinte');
    for (const nom of ['--top-bg', '--top-ink', '--top-ink-soft', '--top-ink-mute', '--top-line']) {
      zone.style.removeProperty(nom);
    }
    return;
  }

  const e = encresPour(hex);
  zone.setAttribute('data-teinte', '');
  zone.style.setProperty('--top-bg', hex);
  zone.style.setProperty('--top-ink', e.ink);
  zone.style.setProperty('--top-ink-soft', e.soft);
  zone.style.setProperty('--top-ink-mute', e.mute);
  zone.style.setProperty('--top-line', e.line);
}

function topBgCourant() {
  return hexValide(localStorage.getItem(TOPBG_CLE));
}



/*
 * La pastille de chaque palette montre son `--accent`, exactement.
 *
 * Trois valeurs ont changé dans la feuille — cyan, émeraude et ambre étaient
 * trop claires pour porter du texte blanc — et une pastille qui montrerait
 * l'ancienne couleur ferait mentir le sélecteur.
 */
const PALETTES = [
  ['violet', 'Violet', '#6c5ce7'],
  ['indigo', 'Indigo', '#4f46e5'],
  ['bleu', 'Bleu', '#2563eb'],
  ['cyan', 'Cyan', '#07819e'],
  ['emeraude', 'Émeraude', '#04865e'],
  ['ambre', 'Ambre', '#b36205'],
  ['corail', 'Corail', '#e11d48'],
  ['graphite', 'Graphite', '#475569'],
];

/*
 * Le défaut est le bleu, pas le violet.
 *
 * Tant que les palettes étaient mortes, ce défaut n'avait aucune conséquence :
 * quoi qu'il dise, la feuille rendait le bleu de la couche densité. En les
 * rallumant, « violet » aurait basculé d'un coup tous les postes qui n'ont
 * jamais choisi — vers la couleur que cette couche avait précisément
 * abandonnée, « le bleu encre se lit comme un outil là où l'indigo se lit
 * comme une démo ». Le défaut dit maintenant ce que l'écran montrait déjà.
 */
const ACCENT_DEFAUT = 'bleu';

/* Préférence d'affichage, propre à la personne et à son écran : elle vit dans
   le navigateur, pas en base. La stocker côté serveur imposerait le même thème
   au portable et au poste fixe. */
function applyAppearance() {
  const accent = localStorage.getItem('csav.accent') ?? ACCENT_DEFAUT;
  const theme = localStorage.getItem('csav.theme') ?? 'auto';

  document.documentElement.dataset.accent = accent;
  appliqueTopBg(topBgCourant());

  const dark =
    theme === 'dark' ||
    (theme === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);

  if (dark) document.documentElement.dataset.theme = 'dark';
  else delete document.documentElement.dataset.theme;
}

/*
 * Le nuancier et le champ hexadécimal, tenus en phase.
 *
 * Deux entrées pour une seule valeur : celui qui a un code de marque le tape,
 * celui qui cherche une teinte la promène. Chacune met l'autre à jour, et
 * aucune n'enregistre une saisie invalide — un champ qui accepte « bleu » et
 * n'applique rien est pire qu'un champ qui refuse.
 *
 * Le champ texte n'écrit qu'à la validation ou à la sortie, pas à chaque
 * frappe : « #ee » est un préfixe de « #eef2ff », pas une couleur, et
 * repeindre l'écran à chaque caractère le ferait clignoter.
 */
function renderTopBg() {
  const nuancier = $('topbg-color');
  const champ = $('topbg-hex');
  const jauge = $('topbg-ratio');
  const apercu = $('topbg-apercu');
  if (!nuancier || !champ) return;

  const DEFAUT = '#eef2ff';

  const montre = (hex) => {
    const valeur = hex ?? DEFAUT;
    nuancier.value = valeur;
    champ.value = hex ?? '';
    apercu?.style.setProperty('--ap-bg', valeur);

    const e = encresPour(valeur);
    apercu?.style.setProperty('--ap-ink', e.ink);
    apercu?.style.setProperty('--ap-mute', e.mute);

    if (jauge) {
      // Le contraste du texte principal sur le fond choisi. Affiché tel quel :
      // c'est un chiffre, pas un verdict — mais le seuil AA est nommé.
      const r = contraste(valeur, e.ink);
      jauge.textContent = `${r.toFixed(1)}:1`;
      jauge.title = `Contraste du texte sur ce fond. Le seuil AA est de 4,5:1 ; ici ${r.toFixed(
        1,
      )}:1.`;
      jauge.classList.toggle('teinte-faible', r < 4.5);
    }
  };

  const pose = (hex) => {
    if (hex) localStorage.setItem(TOPBG_CLE, hex);
    else localStorage.removeItem(TOPBG_CLE);
    appliqueTopBg(hex);
    montre(hex);
  };

  montre(topBgCourant());

  nuancier.addEventListener('input', () => pose(hexValide(nuancier.value)));

  const lireChamp = () => {
    const t = champ.value.trim();
    // Vider le champ remet le défaut : c'est le geste attendu, et il évite un
    // second bouton pour dire la même chose.
    if (t === '') return pose(null);
    const hex = hexValide(t);
    if (hex) return pose(hex);
    // Saisie invalide : on ne l'applique pas et on rend la valeur en vigueur,
    // plutôt que de laisser un texte qui ne correspond à rien à l'écran.
    montre(topBgCourant());
  };

  champ.addEventListener('change', lireChamp);
  champ.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      lireChamp();
    }
  });

  $('topbg-reset')?.addEventListener('click', () => pose(null));
}

function renderPalettes() {
  const accent = localStorage.getItem('csav.accent') ?? ACCENT_DEFAUT;
  const theme = localStorage.getItem('csav.theme') ?? 'auto';

  $('palette-swatches').innerHTML = PALETTES.map(
    ([key, label, hex]) => `<button type="button" class="swatch" data-accent="${key}" aria-pressed="${
      key === accent
    }" aria-label="${esc(label)}" title="${esc(label)}"><i style="background:${hex}"></i></button>`,
  ).join('');

  $('palette-swatches')
    .querySelectorAll('.swatch')
    .forEach((button) =>
      button.addEventListener('click', () => {
        localStorage.setItem('csav.accent', button.dataset.accent);
        applyAppearance();
        renderPalettes();
        renderTopBg();
      }),
    );

  $('theme-seg')
    .querySelectorAll('button')
    .forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset.themeChoix === theme));
      button.onclick = () => {
        localStorage.setItem('csav.theme', button.dataset.themeChoix);
        applyAppearance();
        renderPalettes();
      };
    });

  $('clock-seg')
    .querySelectorAll('button')
    .forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset.clockstyle === clockStyle()));
      button.onclick = () => {
        localStorage.setItem('csav.clocks', button.dataset.clockstyle);
        renderClocks();
        renderPalettes();
      };
    });
}

// Le thème « Système » doit suivre la bascule jour/nuit de l'OS sans rechargement.
window
  .matchMedia('(prefers-color-scheme: dark)')
  .addEventListener('change', () => applyAppearance());

$('logout').addEventListener('click', async () => {
  await api('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
  window.location.href = '/login';
});

/* --------------------------------------------------------- commandes ---- */

const FINANCIAL_LABELS = {
  PAID: 'Payée',
  PARTIALLY_PAID: 'Partiellement payée',
  PENDING: 'En attente',
  REFUNDED: 'Remboursée',
  PARTIALLY_REFUNDED: 'Partiellement remboursée',
  VOIDED: 'Annulée',
  AUTHORIZED: 'Autorisée',
  EXPIRED: 'Expirée',
};

/**
 * L'état du colis chez le transporteur, tel que Shopify le connaît.
 *
 * Il vaut mieux que « SUCCESS », qui dit seulement que l'expédition a été
 * créée — ce que personne ne demande. « En transit », « Livré », c'est la
 * réponse à la question du client.
 */
const SHIPMENT_LABELS = {
  IN_TRANSIT: 'En transit',
  OUT_FOR_DELIVERY: 'En cours de livraison',
  DELIVERED: 'Livré',
  ATTEMPTED_DELIVERY: 'Livraison tentée',
  READY_FOR_PICKUP: 'À retirer',
  PICKED_UP: 'Retiré',
  LABEL_PRINTED: 'Étiquette imprimée',
  LABEL_PURCHASED: 'Étiquette achetée',
  CONFIRMED: 'Confirmé',
  FULFILLED: 'Expédié',
  SUCCESS: 'Expédié',
  NOT_DELIVERED: 'Non livré',
  FAILURE: 'Échec',
  CANCELED: 'Annulé',
  CANCELLED: 'Annulé',
};

const FULFILLMENT_LABELS = {
  FULFILLED: 'Expédiée',
  UNFULFILLED: 'Non expédiée',
  PARTIALLY_FULFILLED: 'Partiellement expédiée',
  IN_PROGRESS: 'En préparation',
  IN_TRANSIT: 'En transit',
  OUT_FOR_DELIVERY: 'En livraison',
  DELIVERED: 'Livrée',
  ON_HOLD: 'En attente',
  SCHEDULED: 'Programmée',
  RESTOCKED: 'Remise en stock',
};

/** Couleur de pastille : ce qui demande une action ressort, le reste s'efface. */
function statusTag(value, labels, alert) {
  if (!value) return '<span class="tag tag-status st-NEW">—</span>';
  const label = labels[value] ?? value;
  const cls = alert.includes(value) ? 'st-NEEDS_REVIEW' : 'st-CLOSED';
  return `<span class="tag tag-status ${cls}">${esc(label)}</span>`;
}

/*
 * La liste des commandes.
 *
 * Une réponse lente ne doit pas écraser une plus récente : changer d'onglet
 * pendant un chargement repart de zéro, et la réponse de l'onglet quitté est
 * ignorée à son arrivée. « Charger la suite », lui, attend le chargement en
 * cours — deux pages demandées au même curseur se dédoubleraient.
 */
async function loadOrders({ reset = false } = {}) {
  const store = state.orders;
  if (store.loading && !reset) return;

  const seq = (store.seqListe = (store.seqListe ?? 0) + 1);
  store.loading = true;
  const body = $('orders-rows');

  if (reset) {
    store.items = [];
    store.cursor = null;
    body.innerHTML = '<p class="cmd-etat-vide">Chargement…</p>';
    void loadOrderCounts();
  }

  const params = new URLSearchParams();
  // 50 est le plafond accepté par l'API : moins d'allers-retours pour un
  // carnet de plusieurs centaines de commandes.
  params.set('limit', '50');
  if (store.q) params.set('q', store.q);
  if (store.cursor) params.set('cursor', store.cursor);
  if (store.sort && store.sort !== 'recent') params.set('sort', store.sort);
  if (store.vue && store.vue !== 'toutes') params.set('vue', store.vue);

  try {
    const page = await api(`/api/orders?${params}`);
    if (seq !== store.seqListe) return;
    store.items = store.items.concat(page.orders);
    store.cursor = page.cursor;
    store.hasNext = page.hasNextPage;
    store.loaded = true;
    renderOrders();
  } catch (error) {
    if (seq !== store.seqListe) return;
    body.innerHTML = `<p class="cmd-etat-vide">${esc(error.message)}</p>`;
    $('orders-count').textContent = '';
    $('orders-more').hidden = true;
  } finally {
    if (seq === store.seqListe) store.loading = false;
  }
}

/**
 * Le compte de chaque onglet, comme les dossiers de Mail.
 *
 * Il suit la recherche : chercher « Morel » dit combien de ses commandes
 * restent à expédier. Un plus, pas une condition — sans réponse, les
 * onglets restent là, sans nombre.
 */
async function loadOrderCounts() {
  const store = state.orders;
  const seq = ++store.seqCounts;
  const params = new URLSearchParams();
  if (store.q) params.set('q', store.q);

  let counts = null;
  try {
    ({ counts } = await api(`/api/orders/counts?${params}`));
  } catch {
    counts = null;
  }
  if (seq !== store.seqCounts) return;

  store.counts = counts;
  document.querySelectorAll('#orders-vues [data-n]').forEach((n) => {
    const compte = counts?.[n.dataset.n];
    n.textContent = compte ? `${compte.count.toLocaleString('fr-FR')}${compte.auMoins ? '+' : ''}` : '';
  });
  if (state.view === 'orders') afficherSousCommandes();
}

/** Sous le titre : combien de commandes, et combien attendent un colis. */
function afficherSousCommandes() {
  const sous = $('view-sub');
  const counts = state.orders.counts;
  if (!sous || !counts?.toutes || state.orders.q) return;
  const nombre = (compte) => `${compte.count.toLocaleString('fr-FR')}${compte.auMoins ? '+' : ''}`;
  const toutes = counts.toutes;
  const attente = counts.aExpedier;
  sous.textContent = `${nombre(toutes)} commande${toutes.count > 1 ? 's' : ''}${
    attente ? ` · ${nombre(attente)} à expédier` : ''
  }`;
  sous.hidden = false;
}

/*
 * L'état d'une commande, en un point de couleur et un mot.
 *
 * Trois pastilles de couleur par ligne se lisaient comme une alarme. Ici,
 * comme dans les apps d'Apple, un point et un mot : vert quand c'est fait,
 * orange quand quelque chose attend, rouge quand ça a échoué, gris quand
 * c'est clos. Le troisième terme sert le résumé d'une ligne au téléphone :
 * un paiement qui attend passe avant l'expédition.
 */
const PAIEMENTS = {
  PAID: ['Payée', 'ok'],
  PARTIALLY_PAID: ['Payée en partie', 'warn', 'Payée en partie'],
  PENDING: ['En attente', 'warn', 'À payer'],
  AUTHORIZED: ['Autorisée', 'warn', 'Paiement autorisé'],
  EXPIRED: ['Expiré', 'crit', 'Paiement expiré'],
  PARTIALLY_REFUNDED: ['Remboursée en partie', 'gris'],
  REFUNDED: ['Remboursée', 'gris', 'Remboursée'],
  VOIDED: ['Annulée', 'gris', 'Annulée'],
};

function etatPaiement(order) {
  const statut = order.displayFinancialStatus;
  const [label, ton, resume = null] = PAIEMENTS[statut] ?? [FINANCIAL_LABELS[statut] ?? '—', 'gris'];
  return { label, ton, resume };
}

/**
 * Où en est l'expédition : le statut de Shopify, précisé par celui du colis
 * chez le transporteur quand il existe. `etape` place la commande sur la
 * frise de la fiche : 1 à expédier, 2 en route, 3 arrivée.
 */
function etatExpedition(order) {
  const ful = order.displayFulfillmentStatus;
  const colis = (order.fulfillments ?? []).find((f) => f.displayStatus)?.displayStatus;

  if (!ful || ful === 'UNFULFILLED') return { label: 'À expédier', ton: 'warn', etape: 1 };
  if (ful === 'ON_HOLD') return { label: 'En attente', ton: 'warn', etape: 1 };
  if (ful === 'SCHEDULED') return { label: 'Programmée', ton: 'warn', etape: 1 };
  if (ful === 'PARTIALLY_FULFILLED') return { label: 'Expédiée en partie', ton: 'warn', etape: 1 };
  if (ful === 'RESTOCKED') return { label: 'Remise en stock', ton: 'gris', etape: 1 };
  if (colis === 'DELIVERED' || ful === 'DELIVERED') return { label: 'Livrée', ton: 'ok', etape: 3 };
  if (colis === 'PICKED_UP') return { label: 'Retirée', ton: 'ok', etape: 3 };
  if (colis === 'ATTEMPTED_DELIVERY') return { label: 'Livraison tentée', ton: 'crit', etape: 2 };
  if (colis === 'NOT_DELIVERED' || colis === 'FAILURE') return { label: 'Non livrée', ton: 'crit', etape: 2 };
  if (colis === 'OUT_FOR_DELIVERY' || ful === 'OUT_FOR_DELIVERY') {
    return { label: 'En cours de livraison', ton: 'info', etape: 2 };
  }
  if (colis === 'READY_FOR_PICKUP') return { label: 'À retirer', ton: 'info', etape: 2 };
  if (colis === 'IN_TRANSIT' || ful === 'IN_TRANSIT') return { label: 'En transit', ton: 'info', etape: 2 };
  return { label: 'Expédiée', ton: 'info', etape: 2 };
}

function pastilleEtat({ label, ton }) {
  return `<i class="cmd-point ton-${ton}" aria-hidden="true"></i><span>${esc(label)}</span>`;
}

/** Le pays en toutes lettres : « Lyon, France » plutôt que « Lyon, FR ». */
const NOMS_PAYS = (() => {
  try {
    return new Intl.DisplayNames(['fr'], { type: 'region' });
  } catch {
    return null;
  }
})();

function paysEnLettres(code) {
  if (!code) return '';
  try {
    return NOMS_PAYS?.of(code) ?? code;
  } catch {
    return code;
  }
}

/** « Aujourd'hui », « Hier », « 3 févr. », puis l'année quand elle change. */
function jourCommande(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  const aujourdhui = new Date();
  const hier = new Date(aujourdhui);
  hier.setDate(aujourdhui.getDate() - 1);
  const meme = (a, b) => a.toDateString() === b.toDateString();
  if (meme(date, aujourdhui)) return `Aujourd’hui`;
  if (meme(date, hier)) return 'Hier';
  return date.toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'short',
    ...(date.getFullYear() === aujourdhui.getFullYear() ? {} : { year: 'numeric' }),
  });
}

function ligneCommande(order, index) {
  const store = state.orders;
  const on = order.id === store.choisie;
  // La ligne qu'atteint la touche Tab : la commande ouverte, sinon la première.
  const focusable = on || (index === 0 && !store.items.some((o) => o.id === store.choisie));
  const adresse = order.shippingAddress;
  const lieu = [adresse?.city, paysEnLettres(adresse?.country)].filter(Boolean).join(', ');
  const client = order.customer?.displayName ?? adresse?.name ?? order.customer?.email ?? 'Client inconnu';
  const paie = etatPaiement(order);
  const expe = etatExpedition(order);
  const resume = paie.resume ? { label: paie.resume, ton: paie.ton } : expe;

  return `<div class="cmd-ligne${on ? ' on' : ''}" role="row" tabindex="${focusable ? 0 : -1}"
      aria-selected="${on}" data-order="${esc(order.id)}">
    <b class="cmd-num" role="cell">${esc(order.name)}</b>
    <span class="cmd-client" role="cell"><span class="cmd-nom">${esc(client)}</span>${
      lieu ? `<span class="cmd-lieu">${esc(lieu)}</span>` : ''
    }</span>
    <span class="cmd-date" role="cell" title="${esc(dateTime(order.createdAt))}">${esc(jourCommande(order.createdAt))}</span>
    <span class="cmd-total" role="cell">${esc(euro(order.totalPrice, order.currency))}</span>
    <span class="cmd-etat cmd-paie" role="cell">${pastilleEtat(paie)}</span>
    <span class="cmd-etat cmd-expe" role="cell">${pastilleEtat(expe)}</span>
    <span class="cmd-etat cmd-resume" aria-hidden="true">${pastilleEtat(resume)}</span>
  </div>`;
}

function renderOrders() {
  const store = state.orders;
  const filtree = Boolean(store.q) || store.vue !== 'toutes';

  $('orders-rows').innerHTML =
    store.items.map(ligneCommande).join('') ||
    `<p class="cmd-etat-vide">${filtree ? 'Aucune commande ne correspond.' : 'Aucune commande.'}</p>`;

  $('orders-count').textContent = store.items.length
    ? `${store.items.length} commande${store.items.length > 1 ? 's' : ''}${store.hasNext ? ' affichées' : ''}`
    : '';
  $('orders-more').hidden = !store.hasNext;

  // Sur grand écran, la fiche n'est jamais vide : la première commande s'y
  // ouvre, comme le premier message dans Mail. Au téléphone, la liste d'abord.
  if (!PILE_TICKETS.matches && store.items.length && !store.items.some((o) => o.id === store.choisie)) {
    void ouvrirCommande(store.items[0].id, { pousser: false });
  }
}

/* Une seule écoute pour toutes les lignes : elles sont redessinées à chaque page. */
$('orders-rows').addEventListener('click', (event) => {
  const ligne = event.target.closest('.cmd-ligne');
  if (ligne) void ouvrirCommande(ligne.dataset.order);
});

/* Au clavier, comme une liste du Finder : les flèches passent d'une commande
   à l'autre, Entrée ouvre. */
$('orders-rows').addEventListener('keydown', (event) => {
  const ligne = event.target.closest('.cmd-ligne');
  if (!ligne) return;
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    void ouvrirCommande(ligne.dataset.order);
    return;
  }
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
  event.preventDefault();
  const voisine = event.key === 'ArrowDown' ? ligne.nextElementSibling : ligne.previousElementSibling;
  if (!voisine?.classList.contains('cmd-ligne')) return;
  voisine.focus();
  void ouvrirCommande(voisine.dataset.order, { pousser: false });
});

/** Marque la ligne ouverte, sans redessiner la liste. */
function marquerLigneCommande(id) {
  $('orders-rows')
    .querySelectorAll('.cmd-ligne')
    .forEach((ligne) => {
      const on = ligne.dataset.order === id;
      ligne.classList.toggle('on', on);
      ligne.setAttribute('aria-selected', String(on));
      ligne.tabIndex = on ? 0 : -1;
    });
}

/*
 * La fiche d'une commande.
 *
 * La même partout : à côté de la liste sur l'écran Commandes, dans la
 * feuille quand on l'ouvre d'ailleurs (un remboursement, un client). En
 * tête, le numéro et le total ; le client, qui mène à sa fiche ; quatre
 * gestes comme sous une fiche de Contacts ; où en est la commande ; puis
 * ce qu'elle contient et où elle va.
 */
function lienShopifyCommande(order) {
  const shop = state.me?.merchant?.shopDomain;
  const id = String(order?.id ?? '').split('/').pop();
  if (!shop || !id || !/^\d+$/.test(id)) return '';
  return `https://${shop}/admin/orders/${id}`;
}

/** Payée, préparée, expédiée, livrée — et une phrase qui le dit. */
function suiviCommandeMarkup(order) {
  const paie = order.displayFinancialStatus;
  const expe = etatExpedition(order);
  const payee = ['PAID', 'PARTIALLY_REFUNDED', 'REFUNDED'].includes(paie);
  // Une commande expédiée sans paiement confirmé (paiement à terme) avance
  // quand même sur la frise : c'est le colis qui compte.
  const etape = !payee && expe.etape < 2 ? 0 : expe.etape;
  const premier = (order.fulfillments ?? []).find((f) => f.trackingCompany || f.trackingNumber);
  const transporteur = premier?.trackingCompany;
  const prevue = premier?.estimatedDeliveryAt
    ? new Date(premier.estimatedDeliveryAt).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })
    : '';

  let phrase;
  if (paie === 'VOIDED') phrase = 'Commande annulée.';
  else if (etape === 0) {
    phrase =
      paie === 'EXPIRED'
        ? 'Le paiement a expiré : rien ne partira sans nouveau paiement.'
        : 'Le paiement n’est pas encore confirmé : rien ne part avant.';
  } else if (etape === 1) {
    phrase =
      order.displayFulfillmentStatus === 'PARTIALLY_FULFILLED'
        ? 'Expédiée en partie : un colis reste à partir.'
        : order.displayFulfillmentStatus === 'ON_HOLD'
          ? 'L’expédition est suspendue.'
          : 'Payée, pas encore expédiée.';
  } else if (etape === 2) {
    phrase = `${expe.label}${transporteur ? ` chez ${transporteur}` : ''}${
      prevue && expe.ton !== 'crit' ? `, livraison prévue ${prevue}` : ''
    }.`;
  } else {
    phrase = `${expe.label}${transporteur ? ` par ${transporteur}` : ''}.`;
  }
  if (paie === 'REFUNDED') phrase += ' Remboursée.';
  if (paie === 'PARTIALLY_REFUNDED') phrase += ' Remboursée en partie.';

  const teinte = expe.ton === 'crit' ? 'crit' : etape === 3 ? 'ok' : 'accent';
  const etapes = ['Payée', 'Préparée', 'Expédiée', 'Livrée']
    .map((nom, i) => {
      const fait = i < etape || etape === 3;
      const courant = i === etape && etape < 3;
      return `<li class="${fait ? 'fait' : courant ? 'courant' : ''}"${courant ? ' aria-current="step"' : ''}>
        <i aria-hidden="true"></i>${nom}</li>`;
    })
    .join('');

  return `<section class="fc-carte fc-suivi fc-${teinte}" aria-label="Où en est la commande">
    <ol class="fc-frise" style="--avance: ${etape * 25}%">${etapes}</ol>
    <p class="fc-phrase">${esc(phrase)}</p>
  </section>`;
}

function ficheCommandeMarkup({ order, tickets = [], parcels = [], changes = [], reemploi = [] }, { titre = true } = {}) {
  const client = order.customer;
  const nom = client?.displayName ?? order.shippingAddress?.name ?? client?.email ?? '';
  const commandes = client?.numberOfOrders;
  const phone = customerPhone(order);
  const shopify = lienShopifyCommande(order);

  // Le suivi de Shopify d'abord ; à défaut, le premier colis saisi par l'atelier.
  const tracking =
    (order.fulfillments ?? []).find((fulfillment) => fulfillment.trackingNumber) ??
    (parcels[0] ? { trackingNumber: parcels[0].trackingNumber, trackingUrl: null } : undefined);

  const inactif = (icone, nomGeste, raison) =>
    `<button class="fc-geste" type="button" disabled title="${esc(raison)}">${ico(icone)}<span>${nomGeste}</span></button>`;

  const gestes = [
    `<button class="fc-geste" type="button" data-fc-fournisseur>${ico('factory')}<span>Fournisseur</span></button>`,
    tracking
      ? `<button class="fc-geste" type="button" data-track="${esc(tracking.trackingNumber)}"${
          tracking.trackingUrl ? ` data-track-url="${esc(tracking.trackingUrl)}"` : ''
        }>${ico('truck')}<span>Suivre</span></button>`
      : inactif('truck', 'Suivre', 'Pas encore de numéro de suivi'),
    phone?.link
      ? `<a class="fc-geste" href="${esc(phone.link)}" target="_blank" rel="noopener noreferrer"
          aria-label="Ouvrir WhatsApp avec ${esc(nom || 'le client')}">${ico('whatsapp')}<span>WhatsApp</span></a>`
      : inactif('whatsapp', 'WhatsApp', phone ? phone.raison : 'Pas de numéro sur la commande'),
    shopify
      ? `<a class="fc-geste" href="${esc(shopify)}" target="_blank" rel="noopener noreferrer"
          aria-label="Ouvrir la commande dans Shopify">${ico('bag')}<span>Shopify</span></a>`
      : inactif('bag', 'Shopify', 'Boutique non reliée'),
  ].join('');

  // Les demandes de changement : ce qu'on a déjà promis sur cette commande.
  const demandes = changes
    .map((change) => {
      const status = CHANGE_STATUS[change.status] ?? CHANGE_STATUS.PENDING;
      const simple = valeurSimple(change);
      const valeur = simple
        ? simple
        : change.afterValue
          ? `${change.afterValue}${change.beforeValue ? `, au lieu de ${change.beforeValue}` : ''}`
          : '';
      return `<div class="fc-ligne">
        <span class="fc-ligne-txt"><b>${esc(CHANGE_KINDS[change.kind] ?? change.kind)}${
          valeur ? ` · ${esc(valeur)}` : ''
        }</b><span>${esc(change.supplier?.name ?? '')} · ${esc(dateTime(change.createdAt))}</span>${
          change.supplierNote ? `<span>« ${esc(change.supplierNote)} »</span>` : ''
        }</span>
        <span class="tag tone-${status.tone}">${esc(status.label)}</span>
      </div>`;
    })
    .join('');

  // Les mails du client sur cette commande : la fiche mène à la conversation.
  const messages = tickets
    .map(
      (ticket) => `<button class="fc-ligne fc-ligne-lien" type="button" data-ticket="${esc(ticket.id)}">
        <span class="fc-ligne-txt"><b>${esc(ticket.subject ?? '(sans objet)')}</b><span>${esc(
          dateTime(ticket.lastMessageAt),
        )}</span></span>
        <span class="tag tag-status st-${esc(ticket.status)}">${esc(STATUS_LABELS[ticket.status] ?? ticket.status)}</span>
      </button>`,
    )
    .join('');

  const balises = order.tags ?? [];
  const total = `<b class="fc-total">${esc(euro(order.totalPrice, order.currency))}</b>`;
  const quand = `<p class="fc-quand">Passée le ${esc(dateTime(order.createdAt))}${
    order.channel ? ` · ${esc(order.channel)}` : ''
  }</p>`;

  return `<div class="fc">
    <header class="fc-tete">
      ${
        // Dans la feuille, le numéro est déjà dans son en-tête : la date
        // prend sa place, à gauche du total.
        titre
          ? `<div class="fc-titre"><h2>Commande ${esc(order.name)}</h2>${total}</div>${quand}`
          : `<div class="fc-titre">${quand}${total}</div>`
      }
    </header>
    ${
      client?.email
        ? `<button class="fc-client" type="button" data-fc-client>
            <span class="fc-avatar" aria-hidden="true">${esc(initials(nom))}</span>
            <span class="fc-client-txt"><b>${esc(nom)}</b><span>${esc(client.email)}${
              commandes ? ` · ${commandes} commande${commandes > 1 ? 's' : ''}` : ''
            }</span></span>
            <span class="fc-client-lien">Fiche client</span>
          </button>`
        : ''
    }
    <div class="fc-gestes">${gestes}</div>
    ${suiviCommandeMarkup(order)}
    ${orderDetailMarkup(order, parcels, reemploi)}
    ${
      demandes
        ? `<section class="fc-groupe"><h3 class="fc-legende">Demandes au fournisseur</h3><div class="fc-carte">${demandes}</div></section>`
        : ''
    }
    ${
      messages
        ? `<section class="fc-groupe"><h3 class="fc-legende">Messages SAV</h3><div class="fc-carte">${messages}</div></section>`
        : ''
    }
    ${
      balises.length
        ? `<div class="fc-balises" aria-label="Balises">${balises.map((t) => `<span class="fc-balise">${esc(t)}</span>`).join('')}</div>`
        : ''
    }
  </div>`;
}

/**
 * Ce que contient la commande et où elle va : les articles, puis la
 * livraison et les colis côte à côte.
 */
function orderDetailMarkup(order, atelier = [], reemploi = []) {
  const items = (order.lineItems ?? [])
    .map((item) => {
      // L'API sert `image` en chaîne plate (voir services/shopify/orders.ts) ;
      // Shopify brut l'enveloppe dans `{ url }`. Lire les deux formes — ne
      // lire que l'objet laissait une vignette grise sur chaque article,
      // exactement comme trackingInfo en son temps.
      const imageUrl = typeof item.image === 'string' ? item.image : item.image?.url;
      const detail = [item.variantTitle, item.sku ? `réf. ${item.sku}` : null].filter(Boolean).map(esc).join(' · ');
      return `<div class="fc-article">
        ${imageUrl ? `<img src="${esc(imageUrl)}" alt="" loading="lazy" />` : '<span class="fc-vignette" aria-hidden="true"></span>'}
        <span class="fc-article-txt"><b>${esc(item.title)}</b>${detail ? `<span>${detail}</span>` : ''}</span>
        <span class="fc-qte">× ${item.quantity}</span>
        ${item.price != null ? `<span class="fc-prix">${esc(euro(item.price, order.currency))}</span>` : ''}
      </div>`;
    })
    .join('');

  /*
   * Les suivis de la commande.
   *
   * Ils se lisaient dans `trackingInfo`, la forme brute de Shopify — que
   * l'API n'a jamais servie : elle aplatit chaque expédition en
   * `trackingNumber` / `trackingCompany` / `trackingUrl`. La liste était donc
   * vide en toutes circonstances, et la fiche annonçait une commande sans
   * suivi pendant que Shopify en affichait un.
   */
  const expeditions = (order.fulfillments ?? []).filter((fulfillment) => fulfillment.trackingNumber);
  const parcelsShopify = expeditions
    .map(
      (fulfillment) => `<div class="fc-colis">
        <span class="fc-colis-qui"><b>${esc(fulfillment.trackingCompany ?? 'Transporteur')}</b>${
          fulfillment.displayStatus
            ? `<span class="sub">${esc(SHIPMENT_LABELS[fulfillment.displayStatus] ?? fulfillment.displayStatus)}</span>`
            : ''
        }</span>
        <button class="linklike mono" type="button" data-track="${esc(fulfillment.trackingNumber)}"${
          fulfillment.trackingUrl ? ` data-track-url="${esc(fulfillment.trackingUrl)}"` : ''
        }>${esc(fulfillment.trackingNumber)}</button>
      </div>`,
    )
    .join('');

  /*
   * Les colis saisis par l'atelier, au même endroit que ceux de Shopify.
   *
   * Ils s'affichaient tout en bas de la fiche, sous un titre à part, pendant
   * que la section « Colis » annonçait « Aucun numéro de suivi » : un numéro
   * saisi n'arrive chez Shopify qu'au dernier colis de la commande — et
   * jamais en mode test. Un numéro que Shopify connaît déjà n'est pas répété.
   */
  const normaliserSuivi = (numero) => String(numero ?? '').replace(/\s+/g, '').toUpperCase();
  const connusDeShopify = new Set(expeditions.map((fulfillment) => normaliserSuivi(fulfillment.trackingNumber)));
  const parcelsAtelier = atelier
    .filter((parcel) => !connusDeShopify.has(normaliserSuivi(parcel.trackingNumber)))
    .map(
      (parcel) => `<div class="fc-colis">
        <span class="fc-colis-qui"><b>${esc(parcel.carrier ?? 'Atelier')}${
          parcel.test ? ' <span class="tag tone-wait">test</span>' : ''
        }</b><span class="sub">colis ${parcel.index}/${parcel.total}${
          parcel.photoMime ? ' · photo de l’étiquette' : ''
        } · pas encore dans Shopify</span></span>
        <button class="linklike mono" type="button" data-track="${esc(parcel.trackingNumber)}">${esc(
          parcel.trackingNumber,
        )}</button>
      </div>`,
    )
    .join('');
  /*
   * Servie par le stock retours : l'agence expédie, pas l'atelier. La ligne
   * dit d'où part la paire — sans elle, une commande sans colis et absente
   * de chez l'atelier semblerait oubliée.
   */
  const parcelsStock = reemploi
    .map(
      (paire) => `<div class="fc-colis">
        <span class="fc-colis-qui"><b>Stock retours · ${esc(
          RETURN_COUNTRIES[paire.agency?.country] ?? paire.agency?.country ?? '',
        )}</b><span class="sub">${paire.agency?.name ? `${esc(paire.agency.name)} · ` : ''}${esc(paire.productTitle)}${
          paire.variantTitle ? ` · ${esc(paire.variantTitle)}` : ''
        }</span></span>
        ${
          paire.reshipTrackingNumber
            ? `<button class="linklike mono" type="button" data-track="${esc(paire.reshipTrackingNumber)}">${esc(
                paire.reshipTrackingNumber,
              )}</button>`
            : '<span class="sub">à expédier par l’agence</span>'
        }
      </div>`,
    )
    .join('');
  const parcels = parcelsStock + parcelsShopify + parcelsAtelier;

  const address = order.shippingAddress;
  // Le texte de Shopify quand il existe : c'est lui qui part sur l'étiquette.
  const lignesAdresse = address
    ? address.formatted?.length
      ? address.formatted
      : [
          address.name,
          address.address1,
          address.address2,
          `${address.zip ?? ''} ${address.city ?? ''}`.trim(),
          paysEnLettres(address.country),
        ].filter(Boolean)
    : [];

  /*
   * Le téléphone de livraison, composable ou non.
   *
   * Même source et mêmes règles que la fiche client du rail : le pays de
   * l'adresse décide de l'indicatif, jamais une supposition. Composable, il
   * ouvre WhatsApp ; sinon il reste lisible, et l'infobulle dit pourquoi.
   */
  const phone = customerPhone(order);
  const phoneMarkup = !phone
    ? ''
    : phone.link
      ? `<div class="fc-tel"><span class="mono" title="Saisi : ${esc(phone.raw)}">${esc(phone.affiche)}</span>
          <a class="fc-lien" href="${esc(phone.link)}" target="_blank" rel="noopener noreferrer"
            title="Ouvrir la conversation dans WhatsApp Web">WhatsApp</a></div>`
      : `<div class="fc-tel"><span class="mono rail-phone-off" title="${esc(phone.raison)}">${esc(phone.affiche)}</span></div>`;

  const quantity = order.itemsQuantity ?? (order.lineItems ?? []).reduce((n, i) => n + i.quantity, 0);
  const paie = etatPaiement(order);
  const nonExpediee = etatExpedition(order).etape === 1;

  return `<section class="fc-groupe">
      <h3 class="fc-legende">Articles · ${quantity}</h3>
      <div class="fc-carte">
        ${items || '<p class="fc-rien">Aucun article.</p>'}
        <div class="fc-somme"><span>Total</span><span class="cmd-etat">${pastilleEtat(paie)}</span><b>${esc(
          euro(order.totalPrice, order.currency),
        )}</b></div>
      </div>
    </section>
    <div class="fc-duo">
      <section class="fc-groupe">
        <h3 class="fc-legende">Livraison</h3>
        <div class="fc-carte fc-bloc">
          ${
            lignesAdresse.length
              ? `<p class="fc-adresse">${lignesAdresse.map(esc).join('<br>')}</p>`
              : '<p class="fc-rien">Aucune adresse.</p>'
          }
          ${order.shippingMethod ? `<p class="fc-mode">${esc(order.shippingMethod)}</p>` : ''}
          ${phoneMarkup}
        </div>
      </section>
      <section class="fc-groupe">
        <h3 class="fc-legende">Colis</h3>
        <div class="fc-carte fc-bloc">${
          parcels || `<p class="fc-rien">${nonExpediee ? 'Pas encore expédiée.' : 'Aucun numéro de suivi.'}</p>`
        }</div>
      </section>
    </div>`;
}

/** Les gestes de la fiche, où qu'elle soit affichée. */
function brancherFicheCommande(conteneur, { order }) {
  conteneur.querySelector('[data-fc-client]')?.addEventListener('click', () =>
    void openCustomerSheet(order.customer.email, order.customer.displayName ?? ''),
  );
  conteneur.querySelector('[data-fc-fournisseur]')?.addEventListener('click', () => contacterFournisseurCommande(order));
  conteneur.querySelectorAll('[data-ticket]').forEach((row) =>
    row.addEventListener('click', () => {
      closeCustomerSheet();
      setView('tickets');
      void selectTicket(row.dataset.ticket);
    }),
  );
}

/*
 * Demander un changement au fournisseur depuis la fiche. La demande part
 * pré-remplie : commande, article et déclinaison actuelle. Ne rester à saisir
 * que la nouvelle valeur, c'est ce qui fait qu'on le fait.
 */
function contacterFournisseurCommande(order) {
  if (activeSuppliers().length === 0) {
    toast('Ajoutez d’abord un fournisseur dans l’écran Fournisseurs.', true);
    return;
  }

  closeCustomerSheet();
  $('alert-modal').dataset.supplier = '';
  $('alert-modal').dataset.ticket = '';
  $('alert-modal').dataset.order = order.id ?? '';
  $('alert-who').textContent = `Commande ${order.name} · ${order.customer?.displayName ?? order.customer?.email ?? ''}`;
  state.alertCtx = alertContextFromOrder(order);
  setAlertKind('SIZE');
  $('alert-order').value = order.name ?? '';
  $('alert-message').value = '';
  renderAlertSuppliers();
  $('alert-modal').hidden = false;
  $('alert-modal').classList.add('open');
  $('alert-after').focus();
}

/**
 * Ouvre une commande dans la fiche de l'écran Commandes.
 *
 * La fiche garde l'ancienne commande le temps que la nouvelle arrive, à
 * demi-teinte : un panneau qui se vide à chaque clic clignote. Au téléphone,
 * elle se pousse par-dessus la liste (`pousser`), comme un message dans Mail.
 */
async function ouvrirCommande(id, { pousser = true } = {}) {
  const store = state.orders;
  store.choisie = id;
  marquerLigneCommande(id);
  if (pousser) ouvrirFichePile();

  const corps = $('orders-fiche-corps');
  const seq = ++store.seqFiche;
  if (corps.querySelector('.fc')) corps.classList.add('cmd-charge');
  else corps.innerHTML = '<p class="cmd-vide">Chargement…</p>';

  let data;
  try {
    data = await api(`/api/orders/${encodeURIComponent(id)}`);
  } catch (error) {
    if (seq !== store.seqFiche) return;
    corps.classList.remove('cmd-charge');
    corps.innerHTML = `<p class="cmd-vide">${esc(error.message)}</p>`;
    return;
  }
  if (seq !== store.seqFiche) return;
  corps.classList.remove('cmd-charge');

  if (!data?.order) {
    corps.innerHTML = '<p class="cmd-vide">Cette commande n’est plus disponible.</p>';
    return;
  }
  corps.innerHTML = ficheCommandeMarkup(data);
  $('orders-fiche').setAttribute('aria-label', `Commande ${data.order.name}`);
  brancherFicheCommande(corps, data);
  $('orders-fiche').scrollTop = 0;
}

/* --- Au téléphone, la fiche se pousse par-dessus la liste. ------------- */
let defilementCommandes = 0;

function ouvrirFichePile() {
  const vue = $('view-orders');
  if (!PILE_TICKETS.matches || !vue) return;
  if (!vue.classList.contains('pile-fiche')) {
    defilementCommandes = scrollY;
    vue.classList.add('pile-fiche');
    history.pushState({ csavCommande: true }, '');
  }
  requestAnimationFrame(() => scrollTo(0, 0));
}

function fermerFichePile({ parHistorique = false } = {}) {
  const vue = $('view-orders');
  if (!vue?.classList.contains('pile-fiche')) return;
  vue.classList.remove('pile-fiche');
  if (!parHistorique && history.state?.csavCommande) history.back();
  requestAnimationFrame(() => scrollTo(0, defilementCommandes));
}

addEventListener('popstate', () => fermerFichePile({ parHistorique: true }));
$('orders-retour').addEventListener('click', () => fermerFichePile());

/**
 * La même fiche, dans la feuille, quand on ouvre une commande d'ailleurs —
 * un remboursement, un client. Consulter une commande n'est pas quitter ce
 * qu'on faisait : la feuille se ferme et l'écran d'avant est là.
 */
async function openOrderSheet(id) {
  $('sheet-name').textContent = 'Commande';
  $('sheet-email').textContent = '';
  $('sheet-body').innerHTML = '<p class="empty">Chargement…</p>';
  $('sheet-wrap').hidden = false;

  let data;
  try {
    data = await api(`/api/orders/${encodeURIComponent(id)}`);
  } catch (error) {
    $('sheet-body').innerHTML = `<p class="empty">${esc(error.message)}</p>`;
    return;
  }

  // Une réponse sans commande — droit manquant, commande supprimée — laissait
  // l'écran à moitié dessiné sur une exception. Même famille que le menu des
  // boutiques : ce qui vient du réseau se lit avec précaution.
  if (!data?.order) {
    $('sheet-body').innerHTML = '<p class="empty">Cette commande n’est plus disponible.</p>';
    return;
  }

  $('sheet-name').textContent = `Commande ${data.order.name}`;
  // Le tiroir est partagé avec la fiche client : son intitulé accessible
  // était figé sur « Fiche client », quoi qu'il montre.
  $('sheet').setAttribute('aria-label', `Commande ${data.order.name}`);
  $('sheet-body').innerHTML = ficheCommandeMarkup(data, { titre: false });
  brancherFicheCommande($('sheet-body'), data);
}

$('orders-more').addEventListener('click', () => loadOrders());

// Les suivantes se chargent en descendant : arrivé au pied de la liste, la
// page suivante vient d'elle-même. Le bouton reste pour qui le cherche.
if ('IntersectionObserver' in window) {
  new IntersectionObserver((entrees) => {
    if (entrees.some((e) => e.isIntersecting) && !$('orders-more').hidden && state.view === 'orders') {
      void loadOrders();
    }
  }, { rootMargin: '200px' }).observe($('orders-more'));
}

$('orders-q').addEventListener('input', (event) => {
  state.orders.q = event.target.value.trim();
  clearTimeout(state.orders.timer);
  // Chaque frappe déclencherait un appel Shopify : on attend une pause.
  state.orders.timer = setTimeout(() => loadOrders({ reset: true }), 350);
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') fermerExportCommandes();
});

/* ------------------------------------------------------------- clients -- */

async function loadCustomers({ reset = false } = {}) {
  const store = state.customers;
  if (store.loading) return;

  store.loading = true;
  const body = $('customers-rows');

  if (reset) {
    store.items = [];
    store.cursor = null;
    body.innerHTML = '<tr><td colspan="7" class="empty">Chargement…</td></tr>';
  }

  const params = new URLSearchParams();
  // 50 est le plafond accepté par l'API : moins d'allers-retours pour un
  // catalogue de plusieurs centaines de références.
  params.set('limit', '50');
  if (store.q) params.set('q', store.q);
  if (store.cursor) params.set('cursor', store.cursor);

  try {
    const page = await api(`/api/customers?${params}`);
    store.items = store.items.concat(page.customers);
    store.cursor = page.cursor;
    store.hasNext = page.hasNextPage;
    store.loaded = true;
    renderCustomers();
  } catch (error) {
    body.innerHTML = `<tr><td colspan="7" class="empty">${esc(error.message)}</td></tr>`;
    $('customers-count').textContent = '';
    $('customers-more').hidden = true;
  } finally {
    store.loading = false;
  }
}

function renderCustomers() {
  const store = state.customers;

  $('customers-rows').innerHTML =
    store.items
      .map(
        (customer) => `<tr class="grid-row" data-email="${esc(customer.email ?? '')}">
          <td><b>${esc(customer.displayName ?? '—')}</b></td>
          <td class="mono">${esc(customer.email ?? '—')}</td>
          <td>${esc([customer.city, customer.country].filter(Boolean).join(', ') || '—')}</td>
          <td>${fullDate(customer.createdAt)}</td>
          <td class="num mono">${customer.numberOfOrders}</td>
          <td class="num mono">${euro(customer.amountSpent, customer.currency)}</td>
          <td>${
            customer.lastOrder
              ? `<span class="mono">${esc(customer.lastOrder.name)}</span> · ${relativeTime(
                  customer.lastOrder.createdAt,
                )}`
              : '—'
          }</td>
          <td>${
            customer.email
              ? `<button class="btn btn-small" data-mail="${esc(customer.email)}">Écrire</button>`
              : ''
          }</td>
        </tr>`,
      )
      .join('') || '<tr><td colspan="7" class="empty">Aucun client.</td></tr>';

  $('customers-count').textContent = store.items.length
    ? `${store.items.length} client${store.items.length > 1 ? 's' : ''}`
    : '';
  $('customers-more').hidden = !store.hasNext;

  // Cliquer un client ouvre sa fiche croisée : commandes, colis, tickets et
  // remboursements d'un coup. Auparavant on basculait sur ses commandes, ce
  // qui ne répondait qu'à un quart de la question.
  // Le bouton « Écrire » ne doit pas déclencher l'ouverture de la fiche.
  $('customers-rows')
    .querySelectorAll('[data-mail]')
    .forEach((button) =>
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        openMail(button.dataset.mail);
      }),
    );

  $('customers-rows')
    .querySelectorAll('.grid-row')
    .forEach((row) =>
      row.addEventListener('click', () => {
        const cell = row.querySelector('td b');
        void openCustomerSheet(row.dataset.email, cell?.textContent ?? '');
      }),
    );
}

$('customers-more').addEventListener('click', () => loadCustomers());

$('customers-q').addEventListener('input', (event) => {
  state.customers.q = event.target.value.trim();
  clearTimeout(state.customers.timer);
  state.customers.timer = setTimeout(() => loadCustomers({ reset: true }), 350);
});

/* --------------------------------------------------------------- réglages */

/**
 * Une ligne de connexion : état, détail, et le bouton qui va avec.
 *
 * Connecter Shopify ou Gmail est une navigation OAuth, pas un appel d'API —
 * d'où les liens plutôt que des `fetch`. Seule la déconnexion Gmail est un
 * POST, parce qu'elle détruit des données.
 */
/* Le pictogramme de chaque compte, dans sa tuile, comme une ligne des Réglages. */
const ICONES_CONNEXION = {
  shopify:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 8h14l-1 12H6z"></path><path d="M9 8V6a3 3 0 0 1 6 0v2"></path></svg>',
  gmail:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="6" width="17" height="12" rx="2"></rect><path d="M4 7l8 6 8-6"></path></svg>',
};

function renderConnection(el, { ico, label, connected, simulated, detail, actions, status: given }) {
  const dot = simulated ? 'warn' : connected ? '' : 'off';
  // L'état est fourni par l'appelant quand l'accord grammatical l'exige :
  // « Boîtes mail connecté » se lisait mal, et le pluriel dépend du nombre.
  const status = given ?? (simulated ? 'simulé' : connected ? 'connecté' : 'non connecté');

  // En mode simulé, aucune autorisation réelle n'est en jeu : proposer de
  // connecter ou de déconnecter promettrait un effet qui n'aura pas lieu.
  if (simulated) actions = '';

  el.innerHTML = `
    <div class="set-conn-head">
      <span class="reg-ico reg-ico-moyen c-${esc(ico)}">${ICONES_CONNEXION[ico] ?? ''}</span>
      <span class="set-conn-nom">${esc(label)}<small><span class="dot ${dot}"></span> ${esc(status)}</small></span>
      <span class="set-conn-actions">${actions}</span>
    </div>
    <div class="set-conn-detail">${detail}</div>`;
}

/*
 * Ce que dit la fenêtre avant de débrancher une boîte.
 *
 * Elle promettait « les messages déjà reçus sont conservés » alors que le
 * serveur les supprime : le marchand validait la perte de son historique en
 * lisant qu'il le gardait. La suppression est délibérée et argumentée là où
 * elle se produit — un ticket sans provenance rend la file impossible à
 * nettoyer — c'était la phrase qui était fausse.
 *
 * TROIS CAS, ET PAS DEUX. Un compte absent n'est pas un compte à zéro.
 * Écrire « aucune conversation n'est rattachée » parce que le nombre n'est
 * pas arrivé serait remplacer un mensonge par un autre, plus discret : le
 * marchand débrancherait tranquillement une boîte pleine. Quand on ne sait
 * pas, on le dit sans chiffre — la phrase reste vraie, elle est seulement
 * moins précise.
 */
function messageDebranchement(boite) {
  const nb = boite?.ticketCount;
  const adresse = boite?.emailAddress ?? 'cette boîte';

  const sort =
    typeof nb !== 'number'
      ? 'Les conversations rattachées à cette adresse seront supprimées.'
      : nb === 0
        ? 'Aucune conversation n’est rattachée à cette adresse.'
        : `${nb} conversation${nb > 1 ? 's' : ''} rattachée${nb > 1 ? 's' : ''} à cette ` +
          `adresse ${nb > 1 ? 'seront supprimées' : 'sera supprimée'}.`;

  // Le courrier lui-même ne bouge pas : c'est l'historique du SAV qui part,
  // et la distinction change la décision.
  const suite = nb === 0 ? '' : ' Le courrier reste dans votre boîte Gmail. Irréversible.';

  return (
    `Débrancher ${adresse} ?\n\n` +
    'L’autorisation Google est révoquée : l’outil perd tout accès à cette adresse.\n\n' +
    sort +
    suite
  );
}

function renderSettings() {
  const { merchant, connections } = state.settings;

  // Écart entre les autorisations demandées et celles réellement accordées :
  // c'est ce qui provoque un « accès refusé » sur le catalogue alors que la
  // boutique est bien connectée.
  const missingScopes = connections.shopify.missingScopes ?? [];

  renderConnection($('set-shopify'), {
    ico: 'shopify',
    label: 'Shopify',
    connected: connections.shopify.connected,
    simulated: connections.shopify.simulated,
    detail: connections.shopify.connected
      ? `Boutique <code>${esc(merchant.shopDomain)}</code> · autorisations : ${
          connections.shopify.scopes.map(esc).join(', ') || '—'
        }${
          missingScopes.length
            ? ` · <b class="set-alert">manquantes : ${missingScopes
                .map(esc)
                .join(', ')}</b> — réautorisez pour les obtenir.`
            : ''
        }`
      : "L'accès Shopify vient de l'installation de l'application depuis votre administration.",
    // Se déconnecter de Shopify, c'est désinstaller l'app côté Shopify : le
    // faire depuis ici laisserait les deux côtés en désaccord.
    actions: connections.shopify.connected
      ? `<a class="btn btn-small${
          missingScopes.length ? ' btn-primary' : ''
        }" href="/auth/shopify?shop=${encodeURIComponent(
          merchant.shopDomain,
        )}">Réautoriser</a>
         <a class="btn btn-small" href="https://${esc(
           merchant.shopDomain,
         )}/admin/settings/apps" target="_blank" rel="noopener">Gérer sur Shopify</a>`
      : `<a class="btn btn-small btn-primary" href="/auth/shopify?shop=${encodeURIComponent(
          merchant.shopDomain,
        )}">Connecter</a>`,
  });

  const gmail = connections.gmail;
  const boxes = gmail.mailboxes ?? [];

  // Une carte par boîte : chacune a son propre watch, et une seule expirée
  // suffit à faire disparaître une partie du courrier sans le moindre signal.
  const gmailDetail = boxes.length
    ? boxes
        .map(
          (mailbox) => `<div class="mbx">
            <div class="mbx-head">
              <code>${esc(mailbox.emailAddress)}</code>
              ${mailbox.isDefault ? '<span class="tag tag-intent">par défaut</span>' : ''}
            </div>
            <div class="mbx-state">${
              mailbox.watchActive
                ? `écoute active jusqu’au ${fullDate(mailbox.watchExpiration)}`
                : '<b class="set-alert">écoute expirée</b> — reconnectez cette boîte'
            }</div>
            <div class="mbx-state">${
              mailbox.gmailModifie
                ? 'corbeille et libellés reportés dans Gmail'
                : '<b class="set-alert">corbeille et libellés : à activer</b> — <a href="/auth/google">reconnectez cette boîte</a> et acceptez la nouvelle autorisation'
            }</div>
            <details class="reg-replie mbx-gerer">
            <summary>Gérer cette boîte</summary>
            <div class="mbx-acts">
              <input type="text" data-mbx-label="${esc(mailbox.id)}"
                placeholder="Nom d’usage (ex. SAV)" value="${esc(mailbox.label ?? '')}" />
              ${
                mailbox.isDefault
                  ? ''
                  : `<button class="btn btn-small" data-mbx-default="${esc(
                      mailbox.id,
                    )}">Par défaut</button>`
              }
              <span class="poll-wrap">
                <select class="poll-days" data-mbx-days="${esc(mailbox.id)}"
                  title="Profondeur du rattrapage">
                  <option value="7">7 jours</option>
                  <option value="30">1 mois</option>
                  <option value="90">3 mois</option>
                  <option value="180">6 mois</option>
                </select>
                <button class="btn btn-small" data-mbx-poll="${esc(
                  mailbox.id,
                )}">Relever</button>
              </span>
              <button class="btn btn-small" data-mbx-diag="${esc(
                mailbox.id,
              )}">Diagnostic</button>
              <button class="btn btn-small" data-mbx-learn="${esc(
                mailbox.id,
              )}">Apprendre de l’historique</button>
              <button class="btn btn-small btn-danger" data-mbx-purge="${esc(
                mailbox.id,
              )}">Effacer ses messages</button>
              <button class="btn btn-small btn-danger" data-mbx-off="${esc(
                mailbox.id,
              )}">Débrancher</button>
            </div>
            </details>
            <div class="mbx-learn" data-mbx-learn-state="${esc(mailbox.id)}"></div>
            <div class="mbx-diag" data-mbx-diag-state="${esc(mailbox.id)}"></div>
          </div>`,
        )
        .join('')
    : 'Aucune boîte connectée — rien n’est ingéré.';

  // Emplacement du bandeau des messages orphelins. Rempli après coup : leur
  // nombre demande un comptage que la page des connexions n'a pas à attendre.
  const gmailBlock = `${gmailDetail}<div class="mbx-orphans" id="mbx-orphans" hidden></div>
    <details class="reg-replie mbx-gerer">
    <summary>Brouillons de l’IA dans Gmail</summary>
    <div class="mbx-acts">
      <button class="btn btn-small" id="btn-drafts-cleanup">Nettoyer les brouillons (tickets clos)</button>
      <button class="btn btn-small btn-danger" id="btn-drafts-purge-all">Supprimer tous les brouillons IA</button>
      <span class="mbx-diag" id="drafts-cleanup-state"></span>
    </div>
    </details>`;

  renderConnection($('set-gmail'), {
    ico: 'gmail',
    label: boxes.length > 1 ? 'Boîtes mail' : 'Boîte mail',
    status: gmail.simulated
      ? 'simulée'
      : boxes.length === 0
        ? 'aucune'
        : `${boxes.length} connectée${boxes.length > 1 ? 's' : ''}`,
    connected: gmail.connected,
    simulated: gmail.simulated,
    detail: gmailBlock,
    // « Ajouter » et non « Reconnecter » : le même bouton sert aux deux, mais
    // c'est l'ajout qu'on cherche une fois la première boîte en place.
    actions: `<a class="btn btn-small${
      gmail.connected ? '' : ' btn-primary'
    }" href="/auth/google">${gmail.connected ? 'Ajouter une boîte' : 'Connecter Gmail'}</a>`,
  });

  // Effacement des tickets d'une boîte. Séparé du débranchement, qui conserve
  // l'historique à dessein : une boîte de travail débranchée garde son SAV, une
  // boîte branchée par erreur doit pouvoir disparaître entièrement.
  //
  // Voir aussi renderOrphans() plus bas : le courrier des boîtes débranchées
  // avant ce correctif n'a plus de carte d'où être effacé.
  $('set-gmail')
    .querySelectorAll('[data-mbx-purge]')
    .forEach((button) =>
      button.addEventListener('click', async () => {
        const address = button.closest('.mbx')?.querySelector('code')?.textContent ?? '';

        if (
          !await confirmer(
            `Effacer TOUS les messages venus de ${address} ?\n\n` +
              'Les messages, brouillons et pièces jointes partent avec eux. ' +
              'Irréversible.',
            { action: 'Effacer', danger: true, icone: 'corbeille' },
          )
        ) {
          return;
        }

        button.disabled = true;
        try {
          const result = await api(`/api/mailboxes/${button.dataset.mbxPurge}/tickets`, {
            method: 'DELETE',
          });
          toast(`${result.removed} message${result.removed > 1 ? 's' : ''} effacé${
            result.removed > 1 ? 's' : ''
          }.`);
          await loadQueue();
        } catch (error) {
          toast(error.message, true);
        } finally {
          button.disabled = false;
        }
      }),
    );

  // Purge des brouillons Gmail orphelins — ceux que l'IA a créés pour des
  // tickets aujourd'hui clos et que rien n'a jamais supprimés. Par lots de
  // 300 côté serveur : on boucle ici jusqu'à épuisement, en montrant le compte.
  const runDraftsCleanup = async (button, mode) => {
    const stateEl = $('drafts-cleanup-state');
    button.disabled = true;
    let total = 0;
    try {
      let remaining = Infinity;
      while (remaining > 0) {
        const result = await api('/api/drafts/cleanup', {
          method: 'POST',
          body: JSON.stringify({ mode }),
        });
        total += result.purged;
        remaining = result.remaining;
        if (stateEl) {
          stateEl.textContent =
            remaining > 0
              ? `${total} supprimés… environ ${remaining} restants`
              : total > 0
                ? `${total} brouillon${total > 1 ? 's' : ''} Gmail supprimé${total > 1 ? 's' : ''}.`
                : 'Aucun brouillon à supprimer.';
        }
        if (result.purged === 0) break;
      }
    } catch (error) {
      toast(error.message, true);
    } finally {
      button.disabled = false;
    }
  };

  $('btn-drafts-cleanup')?.addEventListener('click', function () {
    void runDraftsCleanup(this, 'closed');
  });

  // Le grand ménage — mais borné à ce que l'outil a écrit : seuls les
  // brouillons dont on détient l'identifiant Gmail sont touchés. Un brouillon
  // tapé à la main dans Gmail n'est jamais supprimé, l'outil ignore jusqu'à
  // son existence.
  $('btn-drafts-purge-all')?.addEventListener('click', async function () {
    const bouton = this;
    if (
      !await confirmer(
        'Supprimer tous les brouillons générés par l’IA ?\n\n' +
          'Tickets ouverts compris — l’IA les regénérera au prochain traitement. ' +
          'Vos brouillons écrits à la main dans Gmail ne sont pas touchés.',
        { action: 'Supprimer', danger: true, icone: 'corbeille' },
      )
    ) {
      return;
    }
    void runDraftsCleanup(bouton, 'all');
  });

  renderOrphans();

  // Relève manuelle : court-circuite Pub/Sub, Redis et le worker. Si elle
  // ramène du courrier que l'arrivée automatique n'avait pas vu, la panne est
  // dans cette chaîne-là, et le message le dit plutôt que de la laisser
  // chercher.
  $('set-gmail')
    .querySelectorAll('[data-mbx-poll]')
    .forEach((button) =>
      button.addEventListener('click', async () => {
        // L'état s'écrit dans la carte, pas seulement sur le bouton : un
        // libellé qui change sur une puce de douze pixels passe inaperçu, et
        // l'attente ressemble alors à un clic sans effet.
        const node = button.closest('.mbx')?.querySelector('[data-mbx-diag-state]');
        if (node) node.textContent = 'Relève en cours — cela peut prendre une minute…';

        button.disabled = true;
        const previous = button.textContent;
        button.textContent = 'Relève…';

        const id = button.dataset.mbxPoll;
        const days = Number(
          button.closest('.mbx')?.querySelector('[data-mbx-days]')?.value ?? 7,
        );

        try {
          const result = await api(`/api/mailboxes/${id}/poll`, {
            method: 'POST',
            body: JSON.stringify({ days }),
          });

          // Au-delà d'une semaine, le serveur rend la main tout de suite et
          // travaille derrière : on suit l'avancement au lieu d'attendre.
          if (result.started) {
            watchBackfill(id, node, button, previous);
            return;
          }

          const message =
            result.ingested > 0
              ? `${result.ingested} message${result.ingested > 1 ? 's' : ''} relevé${
                  result.ingested > 1 ? 's' : ''
                }, ${result.ticketIds.length} ticket${
                  result.ticketIds.length > 1 ? 's' : ''
                } dans la file.`
              : 'Rien à relever : les 7 derniers jours sont déjà dans la file. ' +
                'Le courrier plus ancien s’importe avec « Apprendre de l’historique ».';

          if (node) node.textContent = message;
          toast(message);

          if (result.ingested > 0) await loadQueue();
        } catch (error) {
          if (node) node.innerHTML = `<b class="set-alert">${esc(error.message)}</b>`;
          toast(error.message, true);
        } finally {
          button.disabled = false;
          button.textContent = previous;
        }
      }),
    );

  // Diagnostic : ce que Gmail contient, ce que la base en a. L'écart nomme
  // l'étage en panne.
  $('set-gmail')
    .querySelectorAll('[data-mbx-diag]')
    .forEach((button) =>
      button.addEventListener('click', async () => {
        // Ligne propre au diagnostic : partager celle de l'apprentissage
        // ferait effacer le rapport au prochain rafraîchissement du compteur.
        const node = button
          .closest('.mbx')
          ?.querySelector('[data-mbx-diag-state]');
        if (node) node.textContent = 'Diagnostic en cours…';

        try {
          const report = await api(`/api/mailboxes/${button.dataset.mbxDiag}/diagnose`);
          if (node) node.innerHTML = renderDiagnosis(report);
        } catch (error) {
          if (node) node.textContent = error.message;
        }
      }),
    );

  // Apprentissage : jamais déclenché tout seul, jamais sur toutes les boîtes.
  // C'est le marchand qui désigne celle dont les réponses font référence — une
  // adresse branchée pour des essais n'a rien à apprendre à l'IA.
  $('set-gmail')
    .querySelectorAll('[data-mbx-learn]')
    .forEach((button) =>
      button.addEventListener('click', async () => {
        const id = button.dataset.mbxLearn;
        const address = button.closest('.mbx')?.querySelector('code')?.textContent ?? '';

        if (
          !await confirmer(
            `Analyser les 6 derniers mois de ${address} ?\n\n` +
              'Les échanges déjà traités serviront de modèle de ton à l’IA. ' +
              'Ils restent invisibles dans la file et dans les statistiques.',
            { action: 'Analyser', icone: 'message' },
          )
        ) {
          return;
        }

        button.disabled = true;
        try {
          await api(`/api/mailboxes/${id}/learn`, { method: 'POST', body: '{}' });
          toast('Apprentissage lancé — ça tourne en arrière-plan.');
          pollLearning();
        } catch (error) {
          button.disabled = false;
          toast(error.message, true);
        }
      }),
    );

  void refreshLearning();

  $('set-gmail')
    .querySelectorAll('[data-mbx-default]')
    .forEach((button) =>
      button.addEventListener('click', () =>
        patchMailbox(button.dataset.mbxDefault, { isDefault: true }),
      ),
    );

  $('set-gmail')
    .querySelectorAll('[data-mbx-off]')
    .forEach((button) =>
      button.addEventListener('click', async () => {
        const boite = (state.settings?.connections?.gmail?.mailboxes ?? []).find(
          (m) => m.id === button.dataset.mbxOff,
        );

        if (!await confirmer(messageDebranchement(boite), { action: 'Débrancher', danger: true, icone: 'attention' })) {
          return;
        }

        try {
          await api(`/api/mailboxes/${button.dataset.mbxOff}`, { method: 'DELETE' });
          toast('Boîte débranchée.');
          await openSettings();
        } catch (error) {
          toast(error.message, true);
        }
      }),
    );

  // Le libellé s'enregistre en quittant le champ : un bouton par boîte
  // encombrerait une carte déjà chargée.
  $('set-gmail')
    .querySelectorAll('[data-mbx-label]')
    .forEach((input) =>
      input.addEventListener('change', () =>
        patchMailbox(input.dataset.mbxLabel, { label: input.value }),
      ),
    );

  $('set-brand').value = merchant.brandName ?? '';
  $('set-playbook').value = merchant.playbook ?? '';
  $('set-signature').value = merchant.emailSignature ?? '';
  $('set-sla').value = String(merchant.slaHours ?? 24);
  renderLogoPreview(merchant);
  $('set-logo').value = merchant.logoUrl ?? '';
  $('set-tracking').value = merchant.trackingUrlTemplate ?? '';
  $('set-autosend').checked = merchant.autoSendEnabled;
  $('set-testmode').checked = Boolean(merchant.testMode);
  $('reg-test-pastille').hidden = !merchant.testMode;
  $('set-threshold').value = merchant.autoSendThreshold;
  $('set-threshold-echo').textContent = `${Math.round(merchant.autoSendThreshold * 100)} %`;
  $('set-retention').value = String(merchant.retentionDays);

}

async function openSettings() {
  state.settings = await api('/api/settings');
  renderSettings();
  renderBuildInfo();
}

/*
 * Les catégories des Réglages, une seule visible à la fois.
 *
 * La page empilait treize cartes sur une colonne : on cherchait le mode test
 * entre la conservation des mails et l'identité. Une catégorie se choisit à
 * gauche, comme sur un Mac ; la recherche filtre ces catégories par les mots
 * de leurs réglages (« sombre », « gmail », « rgpd »).
 */
const VOLETS_REGLAGES = {
  boutique: ['Boutique', 'Ce que vos clients et vos ateliers voient de vous.'],
  apparence: ['Apparence', 'Couleurs et thème de votre écran.'],
  connexions: ['Connexions', 'Shopify, Gmail et l’assistant.'],
  assistant: ['Assistant', 'Ce que l’assistant peut affirmer et envoyer.'],
  test: ['Mode test', 'Essayer l’outil sans rien envoyer.'],
  acces: ['Voir en tant que', 'Vérifier ce que voit chaque rôle.'],
  donnees: ['Données et confidentialité', 'Combien de temps l’outil garde vos mails.'],
};
let voletReglages = 'boutique';

function montrerVoletReglages(nom) {
  if (!VOLETS_REGLAGES[nom]) nom = 'boutique';
  voletReglages = nom;
  document.querySelectorAll('#view-settings .reg-volet').forEach((volet) => {
    volet.hidden = volet.dataset.volet !== nom;
  });
  document.querySelectorAll('#view-settings .reg-cat').forEach((bouton) => {
    if (bouton.dataset.reg === nom) bouton.setAttribute('aria-current', 'page');
    else bouton.removeAttribute('aria-current');
  });
  // Le titre dans la barre ; la phrase d'introduction vit dans la carte de
  // chaque catégorie.
  $('reg-titre').textContent = VOLETS_REGLAGES[nom][0];
}

document.querySelectorAll('#view-settings .reg-cat').forEach((bouton) =>
  bouton.addEventListener('click', () => montrerVoletReglages(bouton.dataset.reg)),
);

$('reg-q').addEventListener('input', (event) => {
  const sansAccent = (texte) => texte.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const terme = sansAccent(event.target.value.trim());
  let premiere = null;
  document.querySelectorAll('#view-settings .reg-cat').forEach((bouton) => {
    const trouve = !terme || sansAccent(`${bouton.textContent} ${bouton.dataset.mots}`).includes(terme);
    bouton.hidden = !trouve;
    if (trouve && !premiere) premiere = bouton.dataset.reg;
  });
  $('reg-aucun').hidden = Boolean(premiere);
  // La catégorie affichée suit la recherche : taper « gmail » montre Connexions.
  if (terme && premiere) montrerVoletReglages(premiere);
});

/* Les champs enregistrés ensemble, par la sauvegarde automatique ci-dessous. */
const SETTINGS_FIELDS = [
  'set-brand',
  'set-logo',
  'set-tracking',
  'set-autosend',
  'set-threshold',
  'set-retention',
  'set-playbook',
  'set-signature',
  'set-sla',
];

/*
 * Le mode test s'enregistre dès qu'on le bascule, sans attendre
 * « Enregistrer » : c'est un interrupteur de sécurité, son effet doit être
 * immédiat et se voir — le bandeau apparaît ou disparaît aussitôt.
 */
$('set-testmode').addEventListener('change', async (event) => {
  const actif = event.target.checked;
  try {
    await api('/api/settings', { method: 'PATCH', body: JSON.stringify({ testMode: actif }) });
    $('test-notice').hidden = !actif;
    $('reg-test-pastille').hidden = !actif;
    toast(actif ? 'Mode test activé : rien ne sortira.' : 'Mode test désactivé : les actions sont de nouveau réelles.');
  } catch (error) {
    event.target.checked = !actif;
    toast(error.message, true);
  }
});

$('test-effacer').addEventListener('click', async () => {
  if (
    !await confirmer(
      'Effacer les données de test ?\n\nTout ce qui a été créé pendant le mode test : colis, remboursements, ruptures, décisions aux ateliers, mails, retours et échanges. Les données réelles ne sont pas touchées.',
      { action: 'Effacer', danger: true, icone: 'test' },
    )
  ) {
    return;
  }
  try {
    const r = await api('/api/mode-test/effacer', { method: 'POST' });
    /* Ce qui est parti, ligne à ligne ; et, s'il n'y avait rien, le dire
       sans une rangée de zéros. */
    const lignes = [
      ['Colis', r.colis],
      ['Remboursements', r.remboursements],
      ['Signalements et ruptures', r.signalements],
      ['Décisions aux ateliers', r.decisions],
      ['Mails de rupture', r.mails],
      ['Retours et échanges', r.retours],
    ].filter(([, n]) => n > 0);
    await informer(
      lignes.length
        ? { titre: 'Données de test effacées', icone: 'ok', lignes: lignes.map(([nom, n]) => [nom, String(n)]) }
        : {
            titre: 'Rien à effacer',
            icone: 'test',
            texte: 'Aucune donnée n’a été créée en mode test. Les essais faits avant son activation se suppriment un par un, depuis leur ligne.',
          },
    );
    // Les écrans déjà chargés relisent : sinon les lignes effacées resteraient affichées.
    void loadRuptures?.();
    void loadReturns?.();
  } catch (error) {
    toast(error.message, true);
  }
});

/*
 * Sauvegarde automatique, comme les Réglages d'un Mac.
 *
 * Un champ texte s'enregistre quand on s'arrête de taper ; un menu, une case
 * ou un curseur, dès qu'on le lâche. Plus de bouton « Enregistrer » : on ne
 * quitte plus l'écran en perdant sa saisie parce qu'on l'avait oublié. Les
 * envois s'enchaînent l'un après l'autre, le dernier état gagne toujours.
 */
let minuterieReglages;
let envoiReglages = Promise.resolve();

function etatReglages(texte, erreur = false) {
  const ligne = $('set-dirty');
  ligne.textContent = texte;
  ligne.classList.toggle('reg-etat-erreur', erreur);
}

function planifierReglages(delai) {
  clearTimeout(minuterieReglages);
  etatReglages('Enregistrement…');
  minuterieReglages = setTimeout(() => void enregistrerReglages(), delai);
}

function enregistrerReglages(extra = {}) {
  clearTimeout(minuterieReglages);
  envoiReglages = envoiReglages.then(async () => {
    try {
      const { merchant } = await api('/api/settings', {
        method: 'PATCH',
        body: JSON.stringify({
          brandName: $('set-brand').value.trim() || null,
          playbook: $('set-playbook').value.trim() || null,
          emailSignature: $('set-signature').value.trim() || null,
          slaHours: Number($('set-sla').value),
          logoUrl: $('set-logo').value.trim() || null,
          trackingUrlTemplate: $('set-tracking').value.trim() || null,
          autoSendEnabled: $('set-autosend').checked,
          autoSendThreshold: Number($('set-threshold').value),
          retentionDays: Number($('set-retention').value),
          ...extra,
        }),
      });

      // La barre latérale et l'indicateur « envoi automatique » affichent ces
      // valeurs : les rafraîchir évite un écran qui se contredit.
      Object.assign(state.me.merchant, merchant);
      if (state.settings) Object.assign(state.settings.merchant, merchant);
      renderMe();
      if ('logo' in extra) renderLogoPreview(merchant);
      void Promise.all([loadMetrics(), loadAudit()]).catch(() => undefined);
      etatReglages('Enregistré.');
    } catch (error) {
      etatReglages(`Non enregistré : ${error.message}`, true);
      toast(error.message, true);
    }
  });
  return envoiReglages;
}

for (const id of SETTINGS_FIELDS) {
  const champ = $(id);
  const ecrit = champ.tagName === 'TEXTAREA' || champ.type === 'text';
  // Pendant la frappe on attend une pause ; un choix fait s'enregistre aussitôt.
  // Une adresse, elle, attend qu'on quitte le champ : à moitié tapée, le
  // serveur la refuserait et l'écran crierait à l'erreur à chaque pause.
  const adresse = id === 'set-logo' || id === 'set-tracking';
  if (ecrit && !adresse) champ.addEventListener('input', () => planifierReglages(900));
  champ.addEventListener('change', () => planifierReglages(ecrit ? 0 : 150));
}

/**
 * Reprend les politiques publiques de la boutique dans le playbook.
 *
 * Les règles existent déjà, écrites et publiées : les retaper à la main
 * garantit qu'elles divergeront au premier changement de politique de retour.
 * On propose, on n'écrase pas : le playbook peut contenir des consignes que
 * Shopify ne connaît pas.
 */
$('set-policies').addEventListener('click', async () => {
  const button = $('set-policies');
  const current = $('set-playbook').value.trim();

  if (
    current &&
    !await confirmer(
      'Remplacer le contenu actuel par vos politiques Shopify ?\n\n' +
        'Ce que vous avez écrit à la main sera perdu.',
      { action: 'Remplacer', danger: true, icone: 'attention' },
    )
  ) {
    return;
  }

  button.disabled = true;
  try {
    const { playbook, sections } = await api('/api/settings/policies');

    if (!playbook) {
      toast('Aucune politique publiée sur la boutique.', true);
      return;
    }

    $('set-playbook').value = playbook;
    await enregistrerReglages();
    toast(
      `${sections} politique${sections > 1 ? 's' : ''} reprise${sections > 1 ? 's' : ''} et enregistrée${sections > 1 ? 's' : ''} — relisez-les.`,
    );
  } catch (error) {
    toast(error.message, true);
  } finally {
    button.disabled = false;
  }
});

$('set-threshold').addEventListener('input', (event) => {
  $('set-threshold-echo').textContent = `${Math.round(Number(event.target.value) * 100)} %`;
});

async function loadEscalations(ticketId) {
  const container = $('escalations');
  const data = await api(`/api/tickets/${ticketId}/escalations`);
  const escalations = data.escalations ?? [];

  const contacts = activeSuppliers();

  // Écrire au fournisseur passe par la fenêtre « Contacter le fournisseur » :
  // un motif, des champs, une réponse d'un bouton — plus de texte libre ici.
  const newForm = contacts.length
    ? `<div class="actions" style="margin-bottom:8px">
        <button class="btn" id="esc-contact" type="button">Contacter le fournisseur</button>
      </div>`
    : '';

  container.innerHTML =
    newForm +
    escalations
      .map((escalation) => {
        const messages = escalation.messages
          .map(
            (message) => `<div class="msg${message.direction === 'FROM_SUPPLIER' ? ' out' : ''}">
              <div class="msg-head">
                <b>${message.direction === 'FROM_SUPPLIER' ? 'Fournisseur' : 'Vous'}</b>
                <span>${shortTime(message.createdAt)}</span>
              </div>
              <div class="msg-body">${esc(message.body)}</div>
            </div>`,
          )
          .join('');

        // Un brouillon de l'ancien format n'est plus envoyé : il se clôt, et
        // la demande se refait par la fenêtre.
        const actions = escalation.status !== 'RESOLVED'
            ? `<div class="actions" style="margin-top:8px">
                <button class="btn esc-resolve" data-id="${escalation.id}">Marquer résolu</button>
              </div>`
            : '';

        return `<div class="escalation">
          <div class="escalation-head">
            <b>${ESCALATION_REASON_LABELS[escalation.reason] ?? escalation.reason}</b>
            <span>${ESCALATION_STATUS_LABELS[escalation.status] ?? escalation.status}</span>
          </div>
          ${messages}
          ${actions}
        </div>`;
      })
      .join('');

  $('esc-contact')?.addEventListener('click', () => {
    if (state.detail?.ticket) openChangeRequest(state.detail.ticket);
  });
  container.querySelectorAll('.esc-resolve').forEach((button) => {
    button.addEventListener('click', () => resolveEscalation(ticketId, button.dataset.id));
  });
}

async function resolveEscalation(ticketId, escalationId) {
  try {
    await api(`/api/escalations/${escalationId}/resolve`, { method: 'POST' });
    toast('Escalade clôturée.');
    await Promise.all([loadEscalations(ticketId), loadAudit()]);
  } catch (error) {
    toast(error.message, true);
  }
}

/* ------------------------------------------------------------------ audit */

const AUDIT_LABELS = {
  'shopify.connected': 'Boutique Shopify connectée',
  'shopify.uninstalled': 'Application désinstallée',
  'gmail.connected': 'Boîte Gmail connectée',
  'gmail.disconnected': 'Boîte Gmail déconnectée',
  'draft.created': 'Brouillon généré',
  'draft.edited': 'Brouillon modifié',
  'draft.sent': 'Réponse envoyée',
  'ticket.order_attached': 'Commande rattachée',
  'refund.requested': 'Remboursement demandé',
  'refund.completed': 'Remboursement effectué',
  'refund.failed': 'Remboursement en échec',
  'merchant.settings_updated': 'Réglages modifiés',
  'user.invited': 'Membre invité',
  'user.joined': 'Membre a rejoint l’équipe',
  'user.logged_in': 'Connexion',
  'user.updated': 'Membre modifié',
  'email.sent': 'Message envoyé',
  'supplier.configured': 'Fournisseur configuré',
  'supplier.created': 'Contact fournisseur ajouté',
  'supplier.updated': 'Contact fournisseur modifié',
  'supplier.deleted': 'Contact fournisseur supprimé',
  'supplier.escalation_created': 'Escalade fournisseur rédigée',
  'supplier.notified': 'Fournisseur notifié',
  'supplier.replied': 'Réponse du fournisseur',
  'supplier.escalation_resolved': 'Escalade fournisseur clôturée',
};

async function loadAudit() {
  const data = await api('/api/audit');

  $('c-audit').innerHTML =
    data.entries
      .map((entry) => {
        const meta = entry.metadata ?? {};
        const detail = [
          meta.orderName,
          meta.amount ? euro(meta.amount, meta.currency ?? 'EUR') : null,
          meta.reason,
          meta.intent,
        ]
          .filter(Boolean)
          .join(' · ');

        return `<li>
          <time>${shortTime(entry.createdAt)}</time>
          <span><b>${esc(AUDIT_LABELS[entry.action] ?? entry.action)}</b>${
            detail ? `<br>${esc(detail)}` : ''
          }</span>
        </li>`;
      })
      .join('') || '<li class="empty" style="padding:12px 14px">Aucune action enregistrée.</li>';
}

/* ------------------------------------------------------------ actions IHM */

$('btn-save').addEventListener('click', async () => {
  const draft = state.detail?.ticket.drafts?.[0];
  if (!draft) return;

  try {
    await api(`/api/drafts/${draft.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ body: $('d-body').value }),
    });
    toast('Brouillon enregistré.');
    await Promise.all([selectTicket(state.currentId), loadAudit()]);
  } catch (error) {
    toast(error.message, true);
  }
});

/*
 * Un bouton d'envoi se ferme dès le clic, et dit qu'il travaille.
 *
 * Il restait actif pendant l'appel à Gmail — une à deux secondes sans le
 * moindre signe. On recliquait pour s'assurer que le clic avait pris, on
 * répétait Cmd+Entrée, et le message partait deux fois. Fermé, il ne reçoit
 * plus rien : ni clic, ni `.click()` du raccourci clavier.
 *
 * Le serveur refuse de toute façon un second envoi (envoi/uneSeuleFois).
 * Les deux protections ne se remplacent pas : celle-ci évite la requête,
 * celle du serveur couvre deux onglets, deux agents, un écran rafraîchi.
 *
 * Rend `null` si le bouton travaille déjà — l'appelant s'arrête là.
 */
function fermerPendantLEnvoi(bouton) {
  if (!bouton) return { rendre() {}, garder() {} };
  if (bouton.disabled) return null;

  const libelle = bouton.textContent;
  bouton.disabled = true;
  bouton.setAttribute('aria-busy', 'true');
  bouton.textContent = 'Envoi…';

  return {
    // Rien n'est parti : on doit pouvoir réessayer.
    rendre() {
      bouton.disabled = false;
      bouton.textContent = libelle;
      bouton.removeAttribute('aria-busy');
    },
    // Parti : le bouton reste fermé. L'écran relu le remplace d'ordinaire ;
    // s'il n'a pas pu l'être, le libellé dit au moins ce qui s'est passé.
    garder(texte) {
      if (texte) bouton.textContent = texte;
      bouton.removeAttribute('aria-busy');
    },
  };
}

async function envoyerLaReponse() {
  const draft = state.detail?.ticket.drafts?.[0];
  if (!draft) return;

  const envoi = fermerPendantLEnvoi($('btn-send'));
  if (!envoi) return;

  const edited = $('d-body').value !== draft.body;
  let parti = false;

  try {
    // On enregistre avant d'envoyer : sinon les retouches de l'agent seraient
    // perdues et le mail partirait dans sa version générée.
    if (edited) {
      await api(`/api/drafts/${draft.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ body: $('d-body').value }),
      });
    }

    await api(`/api/drafts/${draft.id}/send`, { method: 'POST' });
    parti = true;
    toast('Réponse envoyée.');
    await Promise.all([selectTicket(state.currentId), loadMetrics(), loadAudit()]);
    envoi.garder();
  } catch (error) {
    toast(error.message, true);
    if (parti) envoi.garder('Réponse envoyée');
    else envoi.rendre();
  }
}

$('btn-send').addEventListener('click', envoyerLaReponse);

/* ---------------------------------------------------------- remboursement */

const modal = $('refund-modal');

function closeModal() {
  modal.classList.remove('open');
  state.refund = null;
}

/**
 * Ouvre la fenêtre de remboursement sur une commande.
 *
 * Deux entrées : le message client, et la ligne « À rembourser » d'une
 * rupture — qui propose le prix de l'article plutôt que la commande entière,
 * et se solde quand le remboursement part.
 */
async function ouvrirRemboursement(ticket, options = {}) {
  if (!ticket?.shopifyOrderId) return;

  try {
    // L'aperçu délivre le jeton de confirmation : sans lui, le POST est refusé.
    // C'est ce qui garantit qu'aucun remboursement ne part en un clic.
    const preview = await api(
      `/api/refunds/preview?orderId=${encodeURIComponent(ticket.shopifyOrderId)}`,
    );

    state.refund = { ticket, preview, aFaireId: options.aFaireId ?? null, apres: options.apres ?? null };

    const propose =
      typeof options.montant === 'number' && options.montant > 0
        ? Math.min(options.montant, Number(preview.refundableAmount))
        : Number(preview.refundableAmount);
    $('r-order').textContent = ticket.orderName ?? '';
    $('r-max').textContent = euro(preview.refundableAmount, preview.currency);
    $('r-amount').value = propose.toFixed(2);
    $('r-echo').textContent = euro(propose, preview.currency);
    if (options.motif) $('r-reason').value = options.motif;
    $('r-check').checked = false;
    $('r-go').disabled = true;

    modal.classList.add('open');
    $('r-amount').focus();
  } catch (error) {
    toast(error.message, true);
  }
}

$('btn-refund').addEventListener('click', () => void ouvrirRemboursement(state.detail?.ticket));

$('r-amount').addEventListener('input', () => {
  const value = Number($('r-amount').value.replace(',', '.')) || 0;
  $('r-echo').textContent = euro(value, state.refund?.preview.currency ?? 'EUR');
});

$('r-check').addEventListener('change', () => {
  $('r-go').disabled = !$('r-check').checked;
});

$('r-cancel').addEventListener('click', closeModal);

modal.addEventListener('click', (event) => {
  if (event.target === modal) closeModal();
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && modal.classList.contains('open')) closeModal();
});

$('r-go').addEventListener('click', async () => {
  if (!state.refund) return;

  const { ticket, preview, aFaireId, apres } = state.refund;
  const amount = $('r-amount').value.replace(',', '.');

  $('r-go').disabled = true;

  try {
    await api('/api/refunds', {
      method: 'POST',
      body: JSON.stringify({
        ticketId: ticket.id,
        ...(aFaireId ? { aFaireId } : {}),
        orderId: ticket.shopifyOrderId,
        amount,
        reason: $('r-reason').value,
        confirmationToken: preview.confirmationToken,
      }),
    });

    closeModal();
    toast(`Remboursement de ${euro(amount, preview.currency)} effectué.`);
    if (apres) await apres();
    await loadAudit();
  } catch (error) {
    $('r-go').disabled = false;
    toast(error.message, true);
  }
});

/**
 * État de l'apprentissage, affiché sous chaque boîte.
 *
 * L'import tourne côté serveur bien après la réponse HTTP : sans ce retour, le
 * marchand cliquerait, ne verrait rien, et recliquerait.
 */
/**
 * Traduit le bilan en phrases, pas en champs bruts.
 *
 * Un rapport technique déposé à l'écran laisse au lecteur le travail de
 * conclure. Ce qu'on veut savoir tient en une ligne : est-ce que du courrier
 * manque, et si oui à quel étage.
 */
function renderDiagnosis(report) {
  const lines = [];

  if (report.tokenValid === false) {
    lines.push(
      `<b class="set-alert">Autorisation perdue.</b> Gmail refuse l’accès à cette boîte — ` +
        `débranchez-la et reconnectez-la. (${esc(report.error ?? '')})`,
    );
    return lines.join('<br>');
  }

  lines.push(
    `Boîte lisible · ${report.totalMessages ?? '—'} messages au total, ` +
      `${report.inboxLast7Days}${report.truncated ? ' ou plus' : ''} reçus de tiers ` +
      'dans les 7 derniers jours.',
  );

  if (report.missing > 0) {
    lines.push(
      `<b class="set-alert">${report.missing} message${report.missing > 1 ? 's' : ''} ` +
        `absent${report.missing > 1 ? 's' : ''} de la file.</b> ` +
        'Cliquez « Relever » pour les faire entrer.',
    );
  } else {
    lines.push('Tout le courrier récent est bien dans la file.');
  }

  /*
   * Le verdict sur la relève par curseur.
   *
   * C'est la panne qui se voit le moins : Gmail répond, le jeton est bon, la
   * veille est active — et « Actualiser » ne ramène rien parce que le curseur
   * d'historique est passé devant les messages. Le rapport le nomme, au lieu
   * de laisser conclure que l'outil est cassé.
   */
  if (report.cursorStale) {
    lines.push(
      '<b class="set-alert">Curseur d’historique périmé.</b> Gmail ne conserve ' +
        'l’historique que quelques jours : la relève par curseur ne peut plus ' +
        'rien voir. Le rattrapage par date prend le relais à chaque clic sur ' +
        '« Actualiser ».',
    );
  } else if (report.hasCursor && report.historyAhead === 0 && report.missing > 0) {
    lines.push(
      '<b class="set-alert">Le curseur est passé devant le courrier.</b> ' +
        'L’historique n’annonce plus rien alors que des messages manquent : la ' +
        'relève incrémentale restera muette sur eux. Le rattrapage par date, ' +
        'déclenché au clic sur « Actualiser », est le chemin qui fonctionne.',
    );
  } else if (report.historyAhead > 0 && report.missing > 0) {
    lines.push(
      `${report.historyAhead} mouvement${report.historyAhead > 1 ? 's' : ''} ` +
        'dans l’historique Gmail — « Actualiser » fera entrer ce qui manque.',
    );
  } else if (report.historyAhead > 0) {
    // Le curseur bouge et rien ne manque : c'est l'état sain. L'annoncer comme
    // « en attente » laissait croire à cent messages bloqués alors qu'ils sont
    // tous déjà en base — une alarme là où il fallait un feu vert.
    lines.push(
      `Relève par curseur opérationnelle : ${report.historyAhead} mouvement${
        report.historyAhead > 1 ? 's' : ''
      } lu${report.historyAhead > 1 ? 's' : ''} dans l’historique, tous déjà en base.`,
    );
  }

  // Les libellés dits par leur nom : « je ne vois pas mes libellés » se règle
  // en regardant si Gmail en expose, plutôt qu'en cherchant un défaut qui
  // n'existe peut-être pas.
  if (Array.isArray(report.labels)) {
    lines.push(
      report.labels.length > 0
        ? `Libellés Gmail vus : ${report.labels.map(labelChip).join(' ')}`
        : '<b class="set-alert">Aucun libellé personnel dans cette boîte.</b> ' +
          'Les catégories de Google (Promotions, Réseaux sociaux…) ne comptent pas : ' +
          'seules vos propres étiquettes sont reprises.',
    );
  }

  if (!report.watchActive) {
    lines.push(
      '<b class="set-alert">Écoute inactive.</b> Le courrier n’arrivera pas tout ' +
        'seul : reconnectez cette boîte.',
    );
  }

  return lines.join('<br>');
}

/**
 * Suit un rattrapage parti en arrière-plan.
 *
 * Le compte monte pendant que le travail avance : sans ce retour, trois mois
 * de courrier ressembleraient à un bouton sans effet pendant plusieurs
 * minutes — exactement le défaut qu'on vient de corriger ailleurs.
 */
/**
 * Résultat d'un rattrapage, en phrases.
 *
 * « 0 message sur 1500 examinés » se lit comme un échec alors que c'est le
 * signe que tout était déjà là. Chaque chiffre n'apparaît que s'il dit
 * quelque chose, et le rapport se termine par la conclusion plutôt que par
 * des nombres à interpréter.
 */
function backfillSummary(progress) {
  const parts = [`${progress.scanned} messages examinés.`];

  if (progress.ingested > 0) {
    parts.push(
      `<b>${progress.ingested} message${progress.ingested > 1 ? 's' : ''} ajouté${
        progress.ingested > 1 ? 's' : ''
      }</b> à la file.`,
    );
    parts.push(
      `${progress.tickets} ticket${progress.tickets > 1 ? 's' : ''} soumis à l’IA — ` +
        'le classement et les résumés arrivent au fil du traitement.',
    );
  } else {
    parts.push('Aucun nouveau — tout ce courrier était déjà dans la file.');
  }

  if (progress.relabelled > 0) {
    parts.push(
      `${progress.relabelled} message${progress.relabelled > 1 ? 's' : ''} réétiqueté${
        progress.relabelled > 1 ? 's' : ''
      } depuis Gmail.`,
    );
  } else {
    parts.push(
      'Aucun libellé trouvé : ces messages ne portent pas d’étiquette dans Gmail.',
    );
  }

  if (progress.labelError) {
    parts.push(
      `<b class="set-alert">Libellés non posés :</b> ${esc(progress.labelError)}`,
    );
  }

  if (progress.capped) {
    parts.push(
      '<b class="set-alert">Plafond atteint</b> — il reste du courrier au-delà. ' +
        'Relancez : la reprise continue là où celle-ci s’est arrêtée.',
    );
  }

  return parts.join('<br>');
}

function watchBackfill(mailboxId, node, button, previousLabel) {
  let elapsed = 0;

  const tick = async () => {
    let progress;
    try {
      progress = await api(`/api/mailboxes/${mailboxId}/backfill`);
    } catch {
      progress = null;
    }

    if (progress) {
      node.innerHTML = progress.done
        ? backfillSummary(progress)
        : `Rattrapage… ${progress.scanned} messages examinés, ${progress.ingested} relevés.`;
    }

    elapsed += 3;

    if (progress?.done || elapsed > 900) {
      button.disabled = false;
      button.textContent = previousLabel;
      if (progress?.ingested > 0) await loadQueue();
      return;
    }

    setTimeout(tick, 3000);
  };

  setTimeout(tick, 1500);
}

async function refreshLearning() {
  let data;
  try {
    data = await api('/api/learning');
  } catch {
    return false;
  }

  const running = new Set(data.running ?? []);

  document.querySelectorAll('[data-mbx-learn-state]').forEach((node) => {
    const id = node.dataset.mbxLearnState;
    const button = document.querySelector(`[data-mbx-learn="${CSS.escape(id)}"]`);
    if (button) button.disabled = running.has(id);

    // Le compte de *cette* boîte, pas le total : afficher le même nombre sous
    // chacune ferait croire que toutes ont été analysées.
    const learned = data.byMailbox?.[id] ?? 0;

    node.textContent = running.has(id)
      ? 'Analyse en cours…'
      : learned > 0
        ? `${learned} échange${learned > 1 ? 's' : ''} appris`
        : '';
  });

  return running.size > 0;
}

/** Relance la lecture d'état tant qu'un import tourne, puis s'arrête. */
function pollLearning() {
  let elapsed = 0;

  const tick = async () => {
    const stillRunning = await refreshLearning();
    elapsed += 5;
    // Cinq minutes : au-delà, l'import a fini ou a échoué, et le journal
    // serveur le dira mieux qu'une horloge qui tourne dans le vide.
    if (stillRunning && elapsed < 300) setTimeout(tick, 5000);
  };

  setTimeout(tick, 5000);
}

async function patchMailbox(id, body) {
  try {
    await api(`/api/mailboxes/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
    toast('Boîte mise à jour.');
    await openSettings();
  } catch (error) {
    toast(error.message, true);
  }
}

/* --------------------------------------------------------- réponses types */

/**
 * Réponses types.
 *
 * Cinq questions font les deux tiers du volume : où est mon colis, mauvaise
 * taille, douane, changement d'adresse, retour. Faire rédiger l'IA à chaque
 * fois pour un texte inchangé depuis six mois coûte du temps et de l'argent —
 * et l'agent relit quand même.
 */
async function loadCanned() {
  const data = await api('/api/canned-replies');
  state.canned = data.replies ?? [];
  renderCanned();
  renderCannedChips();
}

function renderCanned() {
  $('canned-count').textContent = state.canned.length
    ? `${state.canned.length} réponse${state.canned.length > 1 ? 's' : ''} type${
        state.canned.length > 1 ? 's' : ''
      }`
    : '';

  $('canned-list').innerHTML = state.canned.length
    ? state.canned
        .map(
          (item) => `<article class="dsp" data-canned="${esc(item.id)}" style="cursor:pointer">
            <div class="dsp-head">
              <b>${esc(item.title)}</b>
              ${
                item.intent
                  ? `<span class="tag in-${item.intent}">${esc(
                      INTENT_LABELS[item.intent] ?? item.intent,
                    )}</span>`
                  : '<span class="tag tag-order">tous motifs</span>'
              }
              <span class="dsp-amount mono">${item.useCount} ×</span>
            </div>
            <div class="dsp-reason">${esc(item.body.slice(0, 220))}${
              item.body.length > 220 ? '…' : ''
            }</div>
          </article>`,
        )
        .join('')
    : `<p class="empty">
         Aucune réponse type. Commencez par les cinq questions qui reviennent :
         où est ma commande, mauvaise taille, frais de douane, changement
         d'adresse, retour.
       </p>`;

  $('canned-list')
    .querySelectorAll('[data-canned]')
    .forEach((card) =>
      card.addEventListener('click', () => openCannedForm(card.dataset.canned)),
    );
}

function openCannedForm(id) {
  const item = id ? state.canned.find((candidate) => candidate.id === id) : null;
  state.editingCanned = item?.id ?? null;

  $('canned-title').textContent = item ? item.title : 'Nouvelle réponse type';
  $('canned-f-title').value = item?.title ?? '';
  $('canned-f-body').value = item?.body ?? '';

  $('canned-f-intent').innerHTML =
    '<option value="">Tous les motifs</option>' +
    Object.entries(INTENT_LABELS)
      .map(
        ([key, label]) =>
          `<option value="${key}"${key === item?.intent ? ' selected' : ''}>${esc(label)}</option>`,
      )
      .join('');

  $('canned-f-delete').hidden = !item;
  $('canned-modal').hidden = false;
  $('canned-modal').classList.add('open');
}

$('canned-new').addEventListener('click', () => openCannedForm(null));
function closeCannedModal() {
  const modal = $('canned-modal');
  modal.classList.remove('open');
  // `hidden` en plus de la classe : c'est lui qui garantit que la fenêtre
  // reste invisible même si la règle d'affichage venait à manquer. Écrite avec
  // une classe qui n'existait pas dans la feuille de style, cette fenêtre
  // s'affichait au bas de tous les écrans.
  modal.hidden = true;
}

$('canned-f-cancel').addEventListener('click', closeCannedModal);

$('canned-modal').addEventListener('click', (event) => {
  if (event.target === $('canned-modal')) closeCannedModal();
});

$('canned-f-save').addEventListener('click', async () => {
  const payload = {
    title: $('canned-f-title').value.trim(),
    body: $('canned-f-body').value.trim(),
    intent: $('canned-f-intent').value || null,
  };

  if (!payload.title || !payload.body) {
    toast('Un titre et un message sont nécessaires.', true);
    return;
  }

  try {
    if (state.editingCanned) {
      await api(`/api/canned-replies/${state.editingCanned}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      });
    } else {
      await api('/api/canned-replies', { method: 'POST', body: JSON.stringify(payload) });
    }

    closeCannedModal();
    toast('Réponse type enregistrée.');
    await loadCanned();
  } catch (error) {
    toast(error.message, true);
  }
});

$('canned-f-delete').addEventListener('click', async () => {
  if (!state.editingCanned) return;
  if (!await confirmer('Supprimer cette réponse type ?\n\nElle ne sera plus proposée dans les brouillons.', { action: 'Supprimer', danger: true, icone: 'corbeille' })) return;

  try {
    await api(`/api/canned-replies/${state.editingCanned}`, { method: 'DELETE' });
    closeCannedModal();
    toast('Réponse type supprimée.');
    await loadCanned();
  } catch (error) {
    toast(error.message, true);
  }
});

/** Puces d'insertion au-dessus du brouillon, motif du ticket en tête. */
function renderCannedChips() {
  const ticket = state.detail?.ticket;
  const bar = $('canned-bar');

  if (!ticket || state.canned.length === 0) {
    bar.hidden = true;
    return;
  }

  const sorted = cannedForTicket(ticket);

  bar.hidden = false;
  $('canned-chips').innerHTML = sorted
    .slice(0, 6)
    .map(
      (item) => `<button class="qchip" data-insert="${esc(item.id)}"${
        item.intent === ticket.intent ? ' aria-pressed="true"' : ''
      }>${esc(item.title)}</button>`,
    )
    .join('');
}

$('canned-chips').addEventListener('click', async (event) => {
  const button = event.target.closest('[data-insert]');
  if (!button) return;

  const item = state.canned.find((candidate) => candidate.id === button.dataset.insert);
  const ticket = state.detail?.ticket;
  if (!item || !ticket) return;

  const order = state.detail?.order;

  // Variables résolues à l'insertion : un modèle qui laisse « {{prenom}} »
  // dans le texte envoyé est pire que pas de modèle du tout.
  const filled = fillCanned(item, ticket, order);

  const body = $('d-body');
  body.value = body.value.trim() ? `${body.value.trim()}\n\n${filled}` : filled;
  body.focus();

  // Le compteur classe la liste : les réponses les plus utilisées remontent
  // sans que personne n'ait à ranger.
  await api(`/api/canned-replies/${item.id}/used`, { method: 'POST' }).catch(() => {});
  toast('Réponse insérée — à relire avant envoi.');
});

/* ------------------------------------------------------ identité de marque */

/** Ce qui doit s'afficher dans la pastille : image téléversée, URL, initiales. */
function brandLogoSrc(merchant) {
  if (merchant?.hasLogo) {
    // Horodatage en suffixe : sans lui, le navigateur ressert l'ancienne image
    // après un remplacement, et on croit que l'envoi a échoué.
    return `/api/branding/logo?v=${encodeURIComponent(merchant.logoUpdatedAt ?? Date.now())}`;
  }
  return merchant?.logoUrl || null;
}

function renderLogoPreview(merchant, pending = null) {
  const src = pending ?? brandLogoSrc(merchant);
  const initiales = (merchant?.brandName || merchant?.name || 'SA').slice(0, 2).toUpperCase();

  // Le même logo à deux endroits : la carte d'introduction de la boutique et
  // sa fiche en tête de la colonne, comme le compte en haut des Réglages.
  for (const [imgId, initialesId] of [
    ['set-logo-img', 'set-logo-initials'],
    ['reg-compte-img', 'reg-compte-initiales'],
  ]) {
    const img = $(imgId);
    $(initialesId).textContent = initiales;
    if (src) {
      img.src = src;
      img.hidden = false;
      // Une URL cassée ne doit pas laisser un carré vide : on retombe sur les
      // initiales, comme dans la barre latérale.
      img.onerror = () => {
        img.hidden = true;
      };
    } else {
      img.hidden = true;
    }
  }

  renderNomBoutique(merchant);
  $('set-logo-clear').hidden = !(merchant?.hasLogo || pending);
}

/** Le nom de la boutique, tel qu'il sera affiché : l'enseigne saisie, sinon celui de Shopify. */
function renderNomBoutique(merchant) {
  const nom = $('set-brand').value.trim() || merchant?.name || merchant?.shopDomain || 'Votre boutique';
  $('reg-compte-nom').textContent = nom;
  $('reg-boutique-nom').textContent = nom;
  $('reg-boutique-domaine').textContent = merchant?.shopDomain ?? '';
}

$('set-brand').addEventListener('input', () => renderNomBoutique(state.settings?.merchant));

/** Réduit le logo avant l'envoi : 256 px suffisent partout où il s'affiche. */
async function shrinkLogo(file) {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(256, Math.max(bitmap.width, bitmap.height));

  const canvas = document.createElement('canvas');
  canvas.width = side;
  canvas.height = side;

  const context = canvas.getContext('2d');
  // Recadrage centré : un logo rectangulaire déformé est pire qu'un logo rogné.
  const crop = Math.min(bitmap.width, bitmap.height);
  context.drawImage(
    bitmap,
    (bitmap.width - crop) / 2,
    (bitmap.height - crop) / 2,
    crop,
    crop,
    0,
    0,
    side,
    side,
  );
  bitmap.close?.();

  return canvas.toDataURL('image/png');
}

let pendingLogo;

$('set-logo-file').addEventListener('change', async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;

  try {
    pendingLogo = await shrinkLogo(file);
  } catch {
    toast('Image illisible — essayez un PNG ou un JPEG.', true);
    return;
  }
  renderLogoPreview(state.settings?.merchant, pendingLogo);
  await enregistrerReglages({ logo: pendingLogo });
  pendingLogo = undefined;
  event.target.value = '';
});

$('set-logo-clear').addEventListener('click', async () => {
  $('set-logo').value = '';
  renderLogoPreview({ ...state.settings?.merchant, hasLogo: false, logoUrl: null });
  await enregistrerReglages({ logo: null });
});

/* ------------------------------------------------------- rafraîchissement */

/**
 * Recharge l'écran courant.
 *
 * Les tickets arrivent par notification Gmail, sans que la page en soit
 * informée : sans rechargement, un agent qui laisse l'onglet ouvert toute la
 * matinée regarde une file figée à son arrivée.
 */
/**
 * Relève Gmail, tolérante à l'échec.
 *
 * Elle ne doit jamais empêcher l'actualisation : une boîte débranchée ou un
 * jeton expiré rendraient la file impossible à recharger, alors que ce qui est
 * déjà en base reste parfaitement lisible. Renvoie le nombre de messages
 * entrés, ou `null` si la relève elle-même n'a pas abouti.
 */
async function pullMail({ revive = false } = {}) {
  if (!state.me?.gmail?.connected) return null;

  try {
    const result = await api('/api/mailboxes/sync', {
      method: 'POST',
      body: JSON.stringify({ revive }),
    });

    // Le détail de la dernière relève, gardé pour l'écran de diagnostic : une
    // panne qu'on ne peut pas décrire est une panne qu'on ne corrige pas.
    state.lastSync = { at: Date.now(), ...result };

    // La veille rallumée se dit : c'est elle qui fera entrer le courrier tout
    // seul ensuite, et le marchand doit savoir qu'il n'aura plus à cliquer.
    if (result.revived > 0) toast('Arrivée automatique du courrier réactivée.');

    // Une boîte en échec se nomme, avec son motif : « relève impossible » tout
    // court n'a jamais aidé personne à comprendre quoi faire.
    const broken = (result.details ?? []).filter((entry) => entry.error);
    if (broken.length > 0 && revive) {
      toast(`${broken[0].mailbox} : ${broken[0].error}`, true);
    }

    return result.ingested ?? 0;
  } catch (error) {
    /*
     * L'échec de la relève ne bloque pas l'actualisation, mais il ne doit plus
     * être muet.
     *
     * Il l'était : la file se rechargeait sans un mot, et le bouton répondait
     * « à l'instant » sur une boîte qu'on n'avait pas su lire. Sur un clic
     * délibéré, on dit ce qui a échoué.
     */
    state.lastSync = { at: Date.now(), error: error.message };
    if (revive) toast(`Relève impossible : ${error.message}`, true);
    return null;
  }
}

async function refreshCurrent({ silent = false } = {}) {
  if (state.refreshing) return;
  state.refreshing = true;
  /* L'actualisation automatique passe toutes les soixante secondes : lui
     laisser afficher « Rafraîchissement… » ferait clignoter le bouton en
     permanence pour un travail que personne n'a demandé. Seul un clic
     délibéré montre l'état d'attente. */
  state.refreshSilent = silent;

  const button = $('refresh');
  if (!silent) {
    button.classList.add('busy');
    renderRefreshLabel();
  }

  // Les chargeurs d'écran sautent le travail quand les données sont déjà là :
  // c'est ce qu'on veut en navigant, l'inverse de ce qu'on veut en actualisant.
  const store = { orders: 'orders', customers: 'customers', catalog: 'catalog' }[state.view];
  if (store) state[store].loaded = false;

  try {
    /*
     * Aller chercher le courrier avant de relire la base.
     *
     * « Actualiser » ne faisait que relire la base : quand la chaîne Pub/Sub
     * tombe — veille Gmail expirée, abonnement en panne, worker arrêté — rien
     * n'entre plus, et le bouton répond « à l'instant » sur une file qui n'a
     * pas bougé depuis la veille. Il fallait descendre dans Réglages cliquer
     * « Relever », donc connaître la panne pour la contourner.
     *
     * La relève suit le curseur d'historique : un appel par boîte, rien à
     * rattraper. Assez légère pour tourner à chaque tour, y compris
     * automatique.
     */
    // La veille ne se rallume qu'au clic : l'actualisation automatique passe
    // toutes les minutes, et réessayer aussi souvent une veille qui refuse de
    // repartir n'apporterait rien.
    const fetched = await pullMail({ revive: !silent });

    const jobs = [state.view === 'tickets' ? loadQueue() : VIEW_LOADERS[state.view]?.()];

    // Les indicateurs et le compteur de la navigation décrivent la file : ils
    // doivent suivre, quel que soit l'écran regardé.
    if (state.view === 'tickets') jobs.push(loadMetrics(), loadAudit());

    await Promise.all(jobs.filter(Boolean));
    state.lastRefresh = Date.now();

    // Le courrier ramené se dit, sinon rien ne distingue une relève qui a
    // trouvé quelque chose d'une relève qui n'a rien trouvé — et c'est
    // exactement la question qu'on se pose en cliquant.
    if (!silent && fetched !== null) {
      // Le compte des boîtes réellement interrogées : « aucun nouveau
      // message » sur zéro boîte lue n'est pas la même nouvelle que sur une
      // boîte lue jusqu'au bout.
      const read = (state.lastSync?.details ?? []).filter((entry) => !entry.error).length;

      toast(
        fetched > 0
          ? `${fetched} nouveau${fetched > 1 ? 'x' : ''} message${fetched > 1 ? 's' : ''} — en haut de la file.`
          : read > 0
            ? 'Aucun nouveau message dans la boîte.'
            : 'Aucune boîte n’a pu être relevée — voir Réglages ▸ Gmail.',
      );
    }
  } catch (error) {
    if (!silent) toast(error.message ?? 'Actualisation impossible', true);
  } finally {
    state.refreshing = false;
    button.classList.remove('busy');
    renderRefreshLabel();
  }
}

/*
 * Tirer pour actualiser, depuis la colonne de gauche.
 *
 * Le geste du téléphone, à la souris : cliquer dans le menu, tirer vers le
 * bas, relâcher. Au-delà du seuil, c'est le bouton « Rafraîchir » — relève
 * du courrier, écran rechargé — plus les compteurs du menu. En deçà, rien :
 * le menu revient à sa place.
 *
 * Seulement depuis le haut du menu : tiré au milieu d'une liste qu'on a fait
 * défiler, le geste voudrait dire « remonter », pas « actualiser ». Et le
 * clic qui suit un relâcher n'ouvre pas l'écran survolé : on voulait
 * actualiser, pas changer de page.
 */
const SEUIL_TIRAGE = 64;
const TIRAGE_MAX = 96;
let ignorerClicJusqua = 0;

/*
 * Trois façons de tirer, un seul geste.
 *
 * Le clic-glissé à la souris existait seul. Le geste qu'on fait sur un Mac est
 * pourtant celui du trackpad — deux doigts vers le bas, déjà tout en haut —,
 * et sur un téléphone celui du pouce : ni l'un ni l'autre n'actualisait, et
 * le geste semblait avoir disparu. Les trois mènent maintenant au même
 * endroit, dans la colonne de gauche comme dans la liste des conversations.
 *
 * Le trackpad a un piège : l'inertie. Une liste lancée vers le haut arrive en
 * butée avec de l'élan, et cet élan ressemble à un tirage. Seul compte donc un
 * geste COMMENCÉ tout en haut — un geste se termine quand les événements
 * s'arrêtent un quart de seconde.
 *
 * « Tout en haut » se vérifie sur toute la chaîne, pas sur la seule colonne :
 * selon la largeur, c'est la colonne qui défile, la liste dans la colonne, ou
 * la page entière. Une liste à mi-course sous une colonne immobile n'est pas
 * en haut.
 */
function enHautDuTirage(cible, colonne, avecPage) {
  for (let el = cible; el && el !== document.body; el = el.parentElement) {
    if (el.scrollTop > 0) return false;
    if (el === colonne) break;
  }
  return !avecPage || (document.scrollingElement?.scrollTop ?? 0) <= 0;
}

function installerTirage(colonne, avant = null) {
  if (!colonne) return;

  const indicateur = document.createElement('div');
  indicateur.className = 'ptr';
  indicateur.setAttribute('aria-hidden', 'true');
  indicateur.innerHTML = '<span class="ptr-fleche">↓</span><span class="ptr-texte"></span>';
  if (avant) avant.before(indicateur);
  else colonne.prepend(indicateur);
  const texte = indicateur.querySelector('.ptr-texte');

  let distance = 0;

  const afficher = () => {
    const pret = distance >= SEUIL_TIRAGE;
    indicateur.classList.toggle('ptr-visible', distance > 0);
    indicateur.classList.toggle('ptr-pret', pret);
    indicateur.style.height = `${distance}px`;
    texte.textContent = pret ? 'Relâcher pour actualiser' : 'Tirer pour actualiser';
  };

  /** Le geste est fini : au-delà du seuil, on actualise ; en deçà, rien. */
  const finir = async () => {
    if (distance < SEUIL_TIRAGE || state.refreshing) {
      distance = 0;
      afficher();
      return;
    }
    indicateur.classList.add('ptr-charge');
    indicateur.style.height = '40px';
    texte.textContent = 'Mise à jour…';
    try {
      changesCountAt = 0;
      await Promise.all([refreshCurrent(), refreshChangesCount()]);
    } finally {
      indicateur.classList.remove('ptr-charge');
      distance = 0;
      afficher();
    }
  };

  /* --- À la souris : cliquer, tirer, relâcher. --- */
  let depart = null;
  let tire = false;

  colonne.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || event.pointerType === 'touch') return;
    if (!enHautDuTirage(event.target, colonne, false) || state.refreshing) return;
    if (event.target.closest('input, textarea, select, .shop-menu, button, a, label, .queue-item')) return;
    depart = { y: event.clientY, id: event.pointerId };
    distance = 0;
    tire = false;
  });

  colonne.addEventListener('pointermove', (event) => {
    if (!depart || event.pointerId !== depart.id) return;
    const ecart = event.clientY - depart.y;
    if (!tire) {
      // Un clic qui tremble n'est pas un tirage ; un geste vers le haut non plus.
      if (ecart < -4) depart = null;
      if (ecart < 8) return;
      tire = true;
      colonne.setPointerCapture(event.pointerId);
      colonne.classList.add('ptr-actif');
    }
    event.preventDefault();
    // Une résistance, comme sur un téléphone : la moitié du mouvement.
    distance = Math.min(TIRAGE_MAX, Math.max(0, ecart * 0.5));
    afficher();
  });

  const relacher = (event) => {
    if (!depart || event.pointerId !== depart.id) return;
    depart = null;
    if (!tire) return;
    tire = false;
    colonne.classList.remove('ptr-actif');
    ignorerClicJusqua = Date.now() + 400;
    void finir();
  };
  colonne.addEventListener('pointerup', relacher);
  colonne.addEventListener('pointercancel', relacher);

  colonne.addEventListener(
    'click',
    (event) => {
      if (Date.now() < ignorerClicJusqua) {
        event.preventDefault();
        event.stopPropagation();
      }
    },
    { capture: true },
  );

  /* --- Au trackpad : deux doigts vers le bas, déjà tout en haut. --- */
  let dernierCran = 0;
  let gesteEnHaut = false;
  let cumul = 0;
  let fin = null;

  colonne.addEventListener(
    'wheel',
    (event) => {
      const maintenant = Date.now();
      // Un nouveau geste commence après un quart de seconde de calme.
      if (maintenant - dernierCran > 250) {
        gesteEnHaut = enHautDuTirage(event.target, colonne, true);
        cumul = 0;
      }
      dernierCran = maintenant;
      if (!gesteEnHaut || state.refreshing || event.deltaY >= 0 || !enHautDuTirage(event.target, colonne, true)) {
        if (event.deltaY > 0) gesteEnHaut = false;
        return;
      }
      cumul += -event.deltaY;
      distance = Math.min(TIRAGE_MAX, cumul * 0.35);
      afficher();
      clearTimeout(fin);
      fin = setTimeout(() => void finir(), 260);
    },
    { passive: true },
  );

  /* --- Au doigt : tirer la liste vers le bas, déjà tout en haut. --- */
  let departDoigt = null;

  colonne.addEventListener(
    'touchstart',
    (event) => {
      departDoigt = enHautDuTirage(event.target, colonne, true) && !state.refreshing ? event.touches[0].clientY : null;
      distance = 0;
    },
    { passive: true },
  );
  colonne.addEventListener(
    'touchmove',
    (event) => {
      if (departDoigt === null) return;
      const ecart = event.touches[0].clientY - departDoigt;
      if (ecart <= 0 || !enHautDuTirage(event.target, colonne, true)) {
        departDoigt = null;
        distance = 0;
        afficher();
        return;
      }
      // Le défilement natif s'efface : c'est le tirage qui suit le doigt.
      event.preventDefault();
      distance = Math.min(TIRAGE_MAX, ecart * 0.5);
      afficher();
    },
    { passive: false },
  );
  colonne.addEventListener('touchend', () => {
    if (departDoigt === null) return;
    departDoigt = null;
    void finir();
  });
}

installerTirage(document.querySelector('.side'));
installerTirage($('queue')?.closest('.panel'), $('queue'));

/**
 * Le bouton dit ce qu'il fait, pas depuis quand il ne l'a pas fait.
 *
 * Il affichait « à l'instant », puis « il y a 3 min ». Un bouton se lit comme
 * une action : « il y a 3 min » se lisait comme un état, et on ne savait plus
 * si cliquer allait rafraîchir ou ouvrir un journal. L'ancienneté est une
 * information de contexte, pas un intitulé de commande — elle passe en
 * infobulle, où on la cherche quand on doute de la fraîcheur des chiffres.
 *
 * Trois états, tous portés par le même bouton et le même gestionnaire : au
 * repos « Rafraîchir », pendant l'appel « Rafraîchissement… », puis retour au
 * repos. Rien d'autre ne bouge — un bouton qui change de largeur pendant qu'on
 * clique déplace ce qui est à côté.
 */
function renderRefreshLabel() {
  const label = $('refresh-label');
  const button = $('refresh');
  if (!label || !button) return;

  if (state.refreshing && !state.refreshSilent) {
    label.textContent = 'Rafraîchissement…';
    return;
  }

  label.textContent = 'Rafraîchir';

  if (!state.lastRefresh) {
    button.title = 'Rafraîchir (R)';
    return;
  }

  const seconds = Math.round((Date.now() - state.lastRefresh) / 1000);
  const depuis =
    seconds < 60 ? 'à l’instant' : `il y a ${Math.floor(seconds / 60)} min`;

  button.title = `Rafraîchir (R) — mis à jour ${depuis}`;

  // L'ancienneté sort de l'infobulle : savoir si les chiffres datent de deux
  // minutes ou d'une heure ne devrait pas demander de survoler un bouton.
  const note = $('sync-note');
  if (note) note.textContent = `Synchronisé ${depuis}`;
}

setInterval(renderRefreshLabel, 15000);

$('refresh').addEventListener('click', () => void refreshCurrent());

$('auto-refresh').addEventListener('change', (event) => {
  localStorage.setItem('csav.autoRefresh', event.target.checked ? '1' : '0');
  toast(event.target.checked ? 'Actualisation automatique activée.' : 'Actualisation automatique coupée.');
});

/*
 * Le tour automatique, et pourquoi il n'a pas la même cadence partout.
 *
 * Sur l'écran SAV, un tour ne coûte qu'un appel Gmail par boîte et quelques
 * lectures de notre base : rien chez Shopify. Soixante secondes y étaient donc
 * un plafond gratuit — un mail arrivé juste après un tour attendait une minute
 * entière avant de s'afficher, alors qu'il était déjà entré en base.
 *
 * Les autres écrans — commandes, clients, catalogue — interrogent Shopify à
 * chaque tour : ils gardent la minute, qui n'y est pas un retard mais une
 * économie.
 *
 * Et toujours seulement si l'onglet est visible : personne ne lit un écran
 * caché, et le quota dépensé pour lui est perdu.
 */
const TOUR_SAV_MS = 20000;
const TOUR_AUTRE_MS = 60000;
// Daté dès le chargement : la page vient de relever, le premier tour n'a rien
// à rattraper.
let dernierTour = Date.now();

setInterval(() => {
  if (!$('auto-refresh').checked || document.hidden || !state.me) return;
  const attendu = state.view === 'tickets' ? TOUR_SAV_MS : TOUR_AUTRE_MS;
  if (Date.now() - dernierTour < attendu) return;
  dernierTour = Date.now();
  void refreshCurrent({ silent: true });
}, 5000);

// Au retour sur l'onglet après une absence : ce qui est affiché a toutes les
// chances d'être périmé — à coup sûr si un mail est arrivé entre-temps.
document.addEventListener('visibilitychange', () => {
  if (document.hidden || !state.me || !$('auto-refresh').checked) return;
  if (!state.nouveauEnAttente && Date.now() - (state.lastRefresh ?? 0) < 30000) return;
  state.nouveauEnAttente = false;
  void refreshCurrent({ silent: true });
});

/*
 * L'arrivée d'un mail, annoncée par le serveur.
 *
 * Le worker prévient dès qu'un mail entre ou qu'un ticket est traité : la
 * file se relit dans la seconde au lieu d'attendre son tour de vingt
 * secondes, qui reste en secours si la connexion tombe. Plusieurs annonces
 * rapprochées ne font qu'une relecture. Onglet caché : on note, et on relit
 * au retour.
 */
let relectureAnnoncee = null;

/*
 * Hors de l'écran SAV, la file ne se relit pas : on regarde seulement les
 * dix derniers messages de la Réception, pour annoncer ceux qui arrivent.
 */
async function guetterHorsFile() {
  try {
    const params = new URLSearchParams({ folder: 'inbox', limit: '10' });
    if (state.allShops) params.set('scope', 'all');
    const data = await api(`/api/tickets?${params}`);
    guetterArrivees(data.tickets ?? []);
  } catch {
    // Une annonce manquée ne mérite pas d'erreur à l'écran.
  }
}

function ecouterEvenements() {
  if (!('EventSource' in window) || state.flux) return;
  state.flux = new EventSource('/api/evenements');
  state.flux.addEventListener('tickets', () => {
    clearTimeout(relectureAnnoncee);
    relectureAnnoncee = setTimeout(() => {
      if (document.hidden || !$('auto-refresh').checked) {
        state.nouveauEnAttente = true;
        return;
      }
      // Les pastilles du menu suivent, même hors de l'écran SAV.
      changesCountAt = 0;
      void refreshChangesCount();
      if (state.view !== 'tickets') {
        void guetterHorsFile();
        return;
      }
      dernierTour = Date.now();
      void refreshCurrent({ silent: true });
    }, 400);
  });
}

/*
 * Le clavier, sur la file.
 *
 * Un agent qui traite deux cents messages par jour ne peut pas payer un
 * aller-retour de souris par message : J/K parcourent, X sélectionne, E clôt,
 * / cherche, W isole les WISMO, R actualise. Les raccourcis ne s'appliquent
 * qu'à l'écran SAV et jamais pendant une saisie — un « e » tapé dans une
 * réponse ne doit pas fermer le dossier qu'on est en train de traiter.
 */
function queueMove(step) {
  const at = state.tickets.findIndex((ticket) => ticket.id === state.currentId);
  const next = state.tickets[at + step] ?? state.tickets[at === -1 ? 0 : at];
  if (next && next.id !== state.currentId) {
    void selectTicket(next.id);
    document
      .querySelector(`.queue-item[data-id="${CSS.escape(next.id)}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }
}

function renderKeybarState() {
  const box = $('kb-state');
  if (!box) return;
  const picked = state.picked.size;
  // Le statut coché lit son propre compteur, comme le sous-titre de la file :
  // les compteurs du serveur ignorent le statut, « 1 sur 2 » sous « À valider »
  // aurait compté les autres statuts.
  const counts = state.queueCounts ?? {};
  const total = (state.filter ? counts[state.filter] : counts.ALL) ?? state.tickets.length;
  box.textContent = `${picked ? `${picked} sélectionné${picked > 1 ? 's' : ''} · ` : ''}${
    state.tickets.length
  } sur ${total}`;
}

document.addEventListener('keydown', (event) => {
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName ?? '');
  if (typing || event.metaKey || event.ctrlKey || event.altKey) return;

  // Une fenêtre ouverte prend la main — la même garde que l'autre
  // gestionnaire, qui la portait seul : le curseur sur un bouton de la
  // fenêtre, « e » clôturait le ticket qu'on avait derrière.
  if (document.querySelector('.backdrop.open') || fenetreFiltresOuverte()) return;

  const key = event.key.toLowerCase();

  if (key === 'r') {
    event.preventDefault();
    void refreshCurrent();
    return;
  }

  // Le reste du clavier appartient à la file : ailleurs, il surprendrait.
  if (state.view !== 'tickets') return;

  if (key === 'j' || key === 'k') {
    event.preventDefault();
    queueMove(key === 'j' ? 1 : -1);
  } else if (key === 'x') {
    event.preventDefault();
    if (!state.currentId) return;
    if (state.picked.has(state.currentId)) state.picked.delete(state.currentId);
    else state.picked.add(state.currentId);
    // La case de la ligne se met à jour sur place : recharger la file pour
    // une coche perdrait la position de défilement.
    const box = document.querySelector(`[data-pick="${CSS.escape(state.currentId)}"]`);
    if (box) box.checked = state.picked.has(state.currentId);
    document
      .querySelector(`.qrow:has([data-pick="${CSS.escape(state.currentId)}"])`)
      ?.classList.toggle('picked', state.picked.has(state.currentId));
    renderBulk();
    renderKeybarState();
  } else if (key === 'e') {
    event.preventDefault();
    if (state.currentId) {
      void api(`/api/tickets/${state.currentId}/resolve`, { method: 'POST', body: '{}' })
        .then(async () => {
          toast('Message clos.');
          // Le curseur avance tout seul : clore puis chercher la ligne
          // suivante à la souris annulerait le gain du raccourci.
          queueMove(1);
          await loadQueue();
        })
        .catch((error) => toast(error.message, true));
    }
  } else if (key === '/') {
    event.preventDefault();
    openPalette();
  } else if (key === 'w') {
    event.preventDefault();
    state.queue.intent = state.queue.intent === 'WISMO' ? '' : 'WISMO';
    const intentSelect = $('q-intent');
    if (intentSelect) intentSelect.value = state.queue.intent;
    void loadQueue();
  }
});

/* ------------------------------------------------------ tiroir de navigation */

function toggleNav(open) {
  const grid = $('app-grid');
  const next = open ?? !grid.classList.contains('nav-open');

  grid.classList.toggle('nav-open', next);
  $('scrim').hidden = !next;
  $('navtoggle').setAttribute('aria-expanded', String(next));
}

$('navtoggle').addEventListener('click', () => toggleNav());
$('scrim').addEventListener('click', () => toggleNav(false));

// Naviguer ferme le tiroir : le laisser ouvert masquerait l'écran qu'on vient
// justement de demander.
$('nav').addEventListener('click', (event) => {
  if (event.target.closest('.nav-item')) toggleNav(false);
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') toggleNav(false);
});

/* ---------------------------------------------------------------- gestes - */

/*
 * Glisser, comme sur iPhone : le menu s'ouvre vers la droite et se referme
 * vers la gauche ; les horloges s'écartent d'un côté ou de l'autre ; un
 * message ouvert revient à la liste vers la droite. Au trackpad, deux doigts
 * font de même sur la colonne et sur les horloges.
 *
 * Un doigt qui part de travers fait défiler la page : le geste ne se décide
 * qu'au dixième pixel, et seulement s'il est franchement horizontal. Ce qui
 * défile déjà en largeur — un tableau, une rangée de pastilles — et les
 * champs de saisie gardent leur propre glissé.
 */
const SEUIL_GLISSE = 60;
const TIROIR = window.matchMedia('(max-width: 1080px)');
const SANS_GLISSE =
  'input, textarea, select, [contenteditable="true"], .backdrop, .cc, .pal, #qf, .more-menu';
const FENETRES_OUVERTES =
  '#cc:not([hidden]), #pal:not([hidden]), #qf:not([hidden]), .backdrop.open, #sta-choix:not([hidden])';
/* Au téléphone, une carte des Statistiques ouverte en grand occupe l'écran. */
const STATS_PLEIN_ECRAN = window.matchMedia('(max-width: 760px)');

function defileEnLargeur(noeud) {
  for (let n = noeud; n && n !== document.body; n = n.parentElement) {
    const { overflowX } = getComputedStyle(n);
    if ((overflowX === 'auto' || overflowX === 'scroll') && n.scrollWidth > n.clientWidth + 1) return true;
  }
  return false;
}

/** Ce que ce doigt posé là va faire, s'il glisse en largeur. */
function gesteAuDepart(cible) {
  const side = document.querySelector('.side');
  const horloges = $('clockpop');
  if (horloges && !horloges.hidden) return cible.closest('#clockpop') ? 'horloges' : null;
  // Une carte des Statistiques en plein écran : vers la droite, on revient.
  const detailStats = $('sta-detail');
  if (detailStats && !detailStats.hidden) {
    return STATS_PLEIN_ECRAN.matches && !defileEnLargeur(cible) ? 'retourStats' : null;
  }
  if (document.querySelector(FENETRES_OUVERTES)) return null;

  if (TIROIR.matches) {
    if ($('app-grid').classList.contains('nav-open')) return cible.closest('.side, #scrim') ? 'fermer' : null;
    if (cible.closest(SANS_GLISSE) || defileEnLargeur(cible)) return null;
    // Un message ou une commande ouverts en plein écran : vers la droite, on
    // revient à la liste, comme dans Mail ; un second glissé ouvre le menu.
    const vue = $('view-tickets');
    if (vue && !vue.hidden && vue.classList.contains('pile-message')) return 'retour';
    const commandes = $('view-orders');
    if (commandes && !commandes.hidden && commandes.classList.contains('pile-fiche')) return 'retourCommande';
    const fournisseurs = $('view-suppliers');
    if (fournisseurs && !fournisseurs.hidden && fournisseurs.classList.contains('fo-pile')) return 'retourFournisseur';
    const modifications = $('view-changes');
    if (modifications && !modifications.hidden && modifications.classList.contains('pile-fiche')) return 'retourModification';
    const ruptures = $('view-ruptures');
    if (ruptures && !ruptures.hidden && ruptures.classList.contains('pile-fiche')) return 'retourRupture';
    return 'ouvrir';
  }
  // Sur une tablette en paysage, la colonne est là : on la replie ou on la
  // déplie du doigt, comme avec son bouton.
  return side && cible.closest('.side') && !cible.closest(SANS_GLISSE) ? 'colonne' : null;
}

/** Le menu suit le doigt ; `null` le rend à sa feuille de style. */
function poserTiroir(decalage) {
  const side = document.querySelector('.side');
  const scrim = $('scrim');
  if (decalage === null) {
    side.style.transform = side.style.transition = '';
    scrim.style.opacity = '';
    return;
  }
  const largeur = side.offsetWidth || 280;
  const x = Math.max(-largeur, Math.min(0, decalage));
  side.style.transition = 'none';
  side.style.transform = `translateX(${x}px)`;
  scrim.hidden = false;
  scrim.style.opacity = String(1 + x / largeur);
}

function replierColonne(replier) {
  if ((localStorage.getItem('csav.side') === 'folded') === replier) return;
  localStorage.setItem('csav.side', replier ? 'folded' : 'open');
  applySideFold();
  cacherBulleSide();
}

const SANS_ANIMATION = window.matchMedia('(prefers-reduced-motion: reduce)');

/** Les horloges s'en vont du côté où on les pousse, puis se ferment. */
function ecarterHorloges(vers) {
  const pop = $('clockpop');
  if (!pop || pop.hidden) return;
  const remettre = () => {
    pop.hidden = true;
    pop.style.transform = pop.style.transition = pop.style.opacity = '';
  };
  if (SANS_ANIMATION.matches) return remettre();
  pop.style.transition = 'transform 0.22s ease-out, opacity 0.22s ease-out';
  pop.style.transform = `translateX(${vers * (innerWidth + 40)}px)`;
  pop.style.opacity = '0';
  setTimeout(remettre, 220);
}

/* Ce qu'un glissé vers la droite referme, et ce qu'il fait suivre au doigt. */
const RETOURS = {
  retour: { pane: () => $('d-pane'), fermer: () => fermerMessagePile() },
  retourCommande: { pane: () => $('orders-fiche'), fermer: () => fermerFichePile() },
  retourStats: { pane: () => document.querySelector('#sta-detail .sta-detail-fenetre'), fermer: () => fermerDetailStats() },
  retourFournisseur: {
    pane: () => (state.foPile?.mode === 'atelier' ? document.querySelector('#suppliers-rows .foa-pousse') : $('sup-dem-fiche')),
    fermer: () => fermerPileFo(),
  },
  retourModification: { pane: () => $('changes-fiche'), fermer: () => fermerPileModif() },
  retourRupture: { pane: () => $('rup-panel'), fermer: () => fermerPileRupture() },
};

function paneDuRetour(type) {
  return RETOURS[type]?.pane() ?? null;
}

function suivreGeste(geste) {
  const { type, dx } = geste;
  if (type === 'ouvrir') poserTiroir(dx - (document.querySelector('.side').offsetWidth || 280));
  else if (type === 'fermer') poserTiroir(dx);
  else if (RETOURS[type]) {
    const pane = paneDuRetour(type);
    if (pane) {
      pane.style.transition = 'none';
      pane.style.transform = `translateX(${Math.max(0, dx)}px)`;
    }
  } else if (type === 'horloges') {
    const pop = $('clockpop');
    pop.style.transition = 'none';
    pop.style.transform = `translateX(${dx}px)`;
    pop.style.opacity = String(Math.max(0.2, 1 - Math.abs(dx) / (pop.offsetWidth || innerWidth)));
  }
}

function conclureGeste({ type, dx }, annule) {
  const franchi = !annule && Math.abs(dx) > SEUIL_GLISSE;
  if (type === 'ouvrir') {
    poserTiroir(null);
    toggleNav(franchi && dx > 0);
  } else if (type === 'fermer') {
    poserTiroir(null);
    toggleNav(!(franchi && dx < 0));
  } else if (RETOURS[type]) {
    const pane = paneDuRetour(type);
    if (pane) pane.style.transform = pane.style.transition = '';
    if (franchi && dx > 0) RETOURS[type].fermer();
  } else if (type === 'horloges') {
    const pop = $('clockpop');
    if (franchi) return ecarterHorloges(Math.sign(dx));
    pop.style.transition = SANS_ANIMATION.matches ? '' : 'transform 0.2s ease, opacity 0.2s ease';
    pop.style.transform = pop.style.opacity = '';
  } else if (type === 'colonne' && franchi) {
    replierColonne(dx < 0);
  }
}

(() => {
  let geste = null;
  document.addEventListener(
    'touchstart',
    (event) => {
      geste = null;
      if (event.touches.length !== 1 || !(event.target instanceof Element)) return;
      const type = gesteAuDepart(event.target);
      const doigt = event.touches[0];
      if (type) geste = { type, x0: doigt.clientX, y0: doigt.clientY, dx: 0, horizontal: null };
    },
    { passive: true },
  );
  document.addEventListener(
    'touchmove',
    (event) => {
      if (!geste || event.touches.length !== 1) return;
      const doigt = event.touches[0];
      const dx = doigt.clientX - geste.x0;
      const dy = doigt.clientY - geste.y0;
      if (geste.horizontal === null) {
        if (Math.hypot(dx, dy) < 10) return;
        geste.horizontal = Math.abs(dx) > Math.abs(dy) * 1.5;
        if (!geste.horizontal) {
          geste = null;
          return;
        }
      }
      geste.dx = dx;
      suivreGeste(geste);
    },
    { passive: true },
  );
  const finir = (annule) => {
    if (geste?.horizontal) conclureGeste(geste, annule);
    geste = null;
  };
  document.addEventListener('touchend', () => finir(false));
  document.addEventListener('touchcancel', () => finir(true));
})();

/*
 * Au trackpad, deux doigts en largeur. Avec le défilement naturel du Mac,
 * des doigts qui vont vers la gauche donnent un `deltaX` positif. Un geste
 * finit après un tiers de seconde de calme, et ne déclenche qu'une fois :
 * l'inertie qui suit ne referme pas ce qu'on vient d'ouvrir.
 */
function glisseTrackpad(zone, action) {
  if (!zone) return;
  let cumul = 0;
  let dernier = 0;
  let fait = false;
  zone.addEventListener(
    'wheel',
    (event) => {
      const maintenant = Date.now();
      if (maintenant - dernier > 300) {
        cumul = 0;
        fait = false;
      }
      dernier = maintenant;
      if (fait || Math.abs(event.deltaX) <= Math.abs(event.deltaY)) return;
      cumul += event.deltaX;
      if (Math.abs(cumul) < 80) return;
      fait = true;
      action(cumul > 0 ? -1 : 1);
    },
    { passive: true },
  );
}

glisseTrackpad(document.querySelector('.side'), (vers) => {
  if (TIROIR.matches) {
    if (vers < 0) toggleNav(false);
  } else replierColonne(vers < 0);
});
glisseTrackpad($('clockpop'), ecarterHorloges);

/* --------------------------------------------------- événements boutiques */

$('shop-switch').addEventListener('click', (event) => {
  event.stopPropagation();
  toggleShopMenu();
});

$('shop-menu').addEventListener('click', (event) => {
  if (event.target.closest('[data-shop-all]')) {
    toggleShopMenu(false);
    setAllShops(true);
    return;
  }

  const add = event.target.closest('[data-shop-add]');
  if (add) {
    toggleShopMenu(false);
    void addShop();
    return;
  }

  const row = event.target.closest('[data-shop]');
  if (!row) return;

  toggleShopMenu(false);

  // Revenir sur la boutique déjà active depuis le mode agrégé ne demande pas
  // de changer de session, seulement de refermer la vue élargie.
  if (row.dataset.shop === state.me?.merchant?.id) {
    setAllShops(false);
    return;
  }

  void switchShop(row.dataset.shop);
});

/**
 * Mode « toutes les boutiques ».
 *
 * Lecture seule et sans rechargement : la session reste sur une boutique, seule
 * la file s'élargit. Toute action — répondre, rembourser, escalader — continue
 * de porter sur la boutique du ticket ouvert.
 */
function setAllShops(on) {
  state.allShops = on;
  localStorage.setItem('csav.allShops', on ? '1' : '0');

  renderShopMenu();
  renderMe();

  if (state.view === 'tickets') void loadQueue();
  else setView('tickets');
}

// Un menu ouvert qui reste ouvert quand on clique ailleurs recouvre la
// navigation et donne l'impression d'une interface bloquée.
document.addEventListener('click', () => toggleShopMenu(false));

/* ------------------------------------------------------------- démarrage */

async function boot() {
  applyAppearance();

  try {
    state.me = await api('/api/me');
  } catch (error) {
    if (error.status !== 401) showGate(error.message);
    return;
  }

  $('gate').hidden = true;
  $('app').hidden = false;

  // Les mails arrivés pendant qu'on regarde : annoncés par le serveur.
  ecouterEvenements();

  // Sans attendre : les couleurs enrichissent l'affichage, elles ne le
  // conditionnent pas. Un Gmail lent ne doit pas retarder l'ouverture.
  void loadLabelStyles();

  // L'empreinte du déploiement, pour les Réglages. Elle n'était lue que sur
  // l'écran de session expirée — c'est-à-dire jamais quand on en a besoin.
  void fetch('/api/config')
    .then((response) => response.json())
    .then((config) => {
      state.build = config;
    })
    .catch(() => {});

  // Mémorisé pour l'écran de session expirée, sur cet appareil uniquement.
  if (state.me.merchant.shopDomain) {
    localStorage.setItem('csav.shop', state.me.merchant.shopDomain);
  }

  state.allShops = localStorage.getItem('csav.allShops') === '1';
  $('auto-refresh').checked = localStorage.getItem('csav.autoRefresh') !== '0';
  state.lastRefresh = Date.now();
  renderRefreshLabel();

  renderMe();
  renderClocks();
  setView('tickets');
  retourGmail();

  /*
   * Relever le courrier À L'OUVERTURE, et pas seulement au premier tour.
   *
   * L'ouverture ne lisait que la base : on arrivait donc sur l'état d'avant, et
   * ce qui était arrivé entre-temps n'apparaissait qu'au bout d'une minute —
   * le temps du premier tour automatique. C'est précisément le moment où l'on
   * regarde, et le seul où ce retard se remarque.
   *
   * En parallèle du reste, et sans bloquer : la file s'affiche tout de suite
   * avec ce que la base sait déjà, puis se complète quand la relève répond.
   */
  void pullMail()
    .then((entres) => (entres ? loadQueue() : undefined))
    // Silencieux : la file s'affiche de toute façon avec ce que la base sait,
    // et une relève en échec le dit déjà au premier clic sur « Actualiser ».
    .catch(() => {});

  await Promise.all([
    loadAgents(),
    loadMetrics(),
    loadQueue(),
    loadAudit(),
    loadSupplier(),
    loadShops(),
  ]);

  if (state.tickets.length > 0) await selectTicket(state.tickets[0].id, { silent: true });
}

boot();

/* ==========================================================================
   VOIR EN TANT QUE
   ==========================================================================

   Un propriétaire doit pouvoir constater ce que voit un agent. Décrire les
   droits dans un tableau ne remplace jamais l'écran : on découvre autrement
   qu'un bouton reste visible mais désactivé, ou qu'une colonne entière
   disparaît.

   La simulation ne descend jamais qu'en dessous du rôle réel — le serveur s'en
   assure, l'interface ne fait que proposer. */

const AS_LABELS = {
  OWNER: 'Propriétaire',
  SUPERVISOR: 'Superviseur',
  AGENT: 'Agent',
  VIEWER: 'Observateur',
};

async function setPreviewRole(role) {
  try {
    await api('/api/preview-role', {
      method: 'POST',
      body: JSON.stringify({ role: role || null }),
    });
    // Rechargement complet : les droits changent côté serveur, et rejouer
    // seulement l'écran courant laisserait les autres vues dans l'état
    // d'avant, avec des boutons que le serveur refuse désormais.
    location.reload();
  } catch (error) {
    toast(error.message, true);
  }
}

function renderPreviewBar() {
  const bar = $('asbar');
  if (!bar) return;

  const previewing = Boolean(state.me?.previewing);
  bar.hidden = !previewing;

  if (previewing) {
    const shown = AS_LABELS[state.me.user.role] ?? state.me.user.role;
    const real = AS_LABELS[state.me.realRole] ?? state.me.realRole;
    $('asbar-text').textContent =
      `Vous utilisez l'outil comme un ${shown.toLowerCase()}. Votre rôle réel est ${real.toLowerCase()}.`;
  }

  document.querySelectorAll('#as-role [data-as]').forEach((button) => {
    const active = (button.dataset.as || '') === (previewing ? state.me.user.role : '');
    button.setAttribute('aria-pressed', String(active));
  });

  const note = $('as-note');
  if (note) {
    note.textContent = previewing
      ? 'La simulation s’arrête d’elle-même au bout de deux heures.'
      : `Vous êtes ${(AS_LABELS[state.me?.realRole] ?? '—').toLowerCase()}.`;
  }
}

document.querySelectorAll('#as-role [data-as]').forEach((button) =>
  button.addEventListener('click', () => {
    if (button.dataset.as === 'SUPPLIER') return;
    toggleSupplierPreview('');
    void setPreviewRole(button.dataset.as);
  }),
);

$('asbar-exit')?.addEventListener('click', () => setPreviewRole(''));

// Un rôle plus large que le sien n'est pas proposé : le serveur le refuserait
// silencieusement, et un bouton sans effet est pire qu'un bouton absent.
function trimPreviewChoices() {
  const rank = { OWNER: 3, SUPERVISOR: 2, AGENT: 1, VIEWER: 0 };
  const mine = rank[state.me?.realRole] ?? 0;
  document.querySelectorAll('#as-role [data-as]').forEach((button) => {
    const target = button.dataset.as;
    // « Fournisseur » n'est pas un rôle de l'équipe : il n'entre pas dans la
    // hiérarchie, et le comparer à la sienne le ferait disparaître pour tous.
    button.hidden =
      target !== 'SUPPLIER' && Boolean(target) && (rank[target] ?? 0) >= mine;
  });
}

/**
 * Vue fournisseur.
 *
 * Ce n'est pas un rôle : le fournisseur n'a pas de compte, il travaille sur un
 * lien signé. Sa « vue » est donc son atelier réel, ouvert avec son propre
 * jeton — pas une imitation dans le dashboard, qui divergerait de son écran
 * dès la première modification et donnerait confiance à tort.
 *
 * Le bouton menait jusqu'ici à l'écran Fournisseurs avec le conseil d'ouvrir
 * un espace de travail qui n'existait nulle part.
 */
function toggleSupplierPreview(role) {
  const box = $('as-supplier-box');
  if (!box) return;

  box.hidden = role !== 'SUPPLIER';
  if (box.hidden) return;

  const pick = $('as-supplier-pick');
  const usable = activeSuppliers();

  pick.innerHTML = usable.length
    ? usable
        .map((supplier) => `<option value="${esc(supplier.id)}">${esc(supplier.name)}</option>`)
        .join('')
    : '<option value="">Aucun fournisseur actif</option>';

  $('as-supplier').disabled = usable.length === 0;
}

document.querySelectorAll('#as-role [data-as]').forEach((button) => {
  if (button.dataset.as !== 'SUPPLIER') return;

  button.addEventListener('click', () => {
    // On ne change pas de rôle : on prépare l'ouverture de l'atelier.
    document.querySelectorAll('#as-role [data-as]').forEach((other) => {
      other.setAttribute('aria-pressed', String(other === button));
    });
    toggleSupplierPreview('SUPPLIER');
  });
});

$('as-supplier')?.addEventListener('click', async () => {
  const id = $('as-supplier-pick').value;
  if (!id) return;

  const button = $('as-supplier');
  button.disabled = true;

  try {
    // Sans révocation : ouvrir l'atelier pour le regarder ne doit pas couper
    // l'accès du fournisseur qui y travaille au même moment.
    const { url } = await api(`/api/suppliers/${id}/portal-link`, {
      method: 'POST',
      body: JSON.stringify({ revoke: false }),
    });

    window.open(url, '_blank', 'noopener');
  } catch (error) {
    toast(error.message, true);
  } finally {
    button.disabled = false;
  }
});

/* ==========================================================================
   CLAVIER
   ==========================================================================

   Ce qui distingue un outil qu'on subit d'un outil qu'on pilote. Un agent qui
   traite cent tickets fait cent allers-retours souris entre la liste et la
   réponse ; au clavier il ne quitte jamais la position de frappe.

   Le jeu de touches est celui que les outils de messagerie ont imposé — J/K
   pour parcourir, Entrée pour ouvrir, ⌘Entrée pour envoyer. Les réinventer
   n'aurait servi qu'à les faire apprendre. */

function typingSomewhere() {
  const tag = document.activeElement?.tagName ?? '';
  return /^(INPUT|TEXTAREA|SELECT)$/.test(tag) || document.activeElement?.isContentEditable;
}

/** Déplace la sélection dans la file, en la gardant à l'écran. */
function moveQueue(step) {
  const items = [...document.querySelectorAll('#queue .queue-item')];
  if (items.length === 0) return;

  const current = items.findIndex((item) => item.dataset.id === state.currentId);
  // Aucun ticket ouvert : la première frappe prend le premier de la liste
  // plutôt que le second, qui serait le voisin d'un point de départ imaginaire.
  const next = current === -1 ? 0 : Math.min(items.length - 1, Math.max(0, current + step));

  const target = items[next];
  if (!target) return;

  target.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  selectTicket(target.dataset.id);
}

document.addEventListener('keydown', (event) => {
  // ⌘K ouvre la recherche depuis n'importe où, y compris depuis un champ :
  // c'est le geste qui doit toujours répondre.
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    if ($('pal').hidden) openPalette();
    else closePalette();
    return;
  }

  // ⌘Entrée envoie la réponse depuis la zone de rédaction. Sans lui, écrire se
  // termine toujours par un aller-retour à la souris.
  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
    if (document.activeElement === $('d-body') && !$('btn-send').disabled) {
      event.preventDefault();
      $('btn-send').click();
    }
    return;
  }

  if (typingSomewhere() || event.altKey || event.metaKey || event.ctrlKey) return;
  if (state.view !== 'tickets') return;
  /*
   * Une fenêtre ouverte prend la main sur les raccourcis de la file.
   *
   * Le seul garde était l'écran courant : les fenêtres s'ouvraient depuis
   * ailleurs, donc la question ne se posait pas. Depuis qu'un dossier de
   * retour se crée depuis un message, elle s'ouvre par-dessus la file — et
   * « e » y clôturait le ticket qu'on avait derrière, sans rien pour le dire.
   */
  // `.open` et rien d'autre : une fenêtre fermée reste dans le DOM sans
  // attribut `hidden` — c'est `display: none` qui la cache — et un sélecteur
  // fondé sur `hidden` aurait éteint les raccourcis en permanence.
  if (document.querySelector('.backdrop.open') || fenetreFiltresOuverte()) return;

  switch (event.key) {
    case 'j':
    case 'ArrowDown':
      event.preventDefault();
      moveQueue(1);
      break;
    case 'k':
    case 'ArrowUp':
      event.preventDefault();
      moveQueue(-1);
      break;
    case 'r':
      // Répondre : le curseur va dans le brouillon, prêt à corriger.
      if (!$('draft-zone').hidden) {
        event.preventDefault();
        $('d-body').focus();
      }
      break;
    case '?':
      event.preventDefault();
      $('keys').hidden = !$('keys').hidden;
      break;
    case 'Escape':
      $('keys').hidden = true;
      break;
    default:
      break;
  }
});

/* ==========================================================================
   AGIR, PUIS POUVOIR REVENIR
   ==========================================================================

   Une boîte « êtes-vous sûr ? » demande de réfléchir au pire moment : avant
   d'avoir vu le résultat. Elle interrompt tout le monde à chaque fois pour
   éviter l'erreur d'une fois sur cent, et on finit par la valider sans la lire
   — ce qui la rend inutile en plus d'être pénible.

   L'inverse coûte moins et protège mieux : agir tout de suite, montrer le
   résultat, laisser six secondes pour revenir en arrière. */

/** Message avec bouton d'annulation, à la place du bandeau ordinaire. */
function toastUndo(message, undo) {
  const el = $('toast');
  el.textContent = '';
  el.classList.remove('error');

  const text = document.createElement('span');
  text.textContent = message;

  const button = document.createElement('button');
  button.className = 'toast-undo';
  button.textContent = 'Annuler';
  button.addEventListener('click', async () => {
    button.disabled = true;
    try {
      await undo();
      toast('Annulé.');
    } catch (error) {
      toast(error.message, true);
    }
  });

  el.append(text, button);
  el.classList.add('show');

  clearTimeout(el._timer);
  // Six secondes plutôt que quatre : le temps de lire, de comprendre que ce
  // n'était pas le bon ticket, et d'atteindre le bouton.
  el._timer = setTimeout(() => {
    el.classList.remove('show');
    el.textContent = '';
  }, 6000);
}

const SNOOZE_CHOICES = [
  { hours: 4, label: 'Cet après-midi' },
  { hours: 24, label: 'Demain' },
  { hours: 72, label: 'Dans 3 jours' },
  { hours: 168, label: 'La semaine prochaine' },
];

async function snoozeTicket(hours, label) {
  const id = state.currentId;
  if (!id) return;

  try {
    const result = await api(`/api/tickets/${id}/snooze`, {
      method: 'PATCH',
      body: JSON.stringify({ hours }),
    });

    // La file se recharge tout de suite : le ticket disparaît, ce qui est la
    // preuve visible que l'action a porté.
    await loadQueue();

    toastUndo(`En veille — ${label.toLowerCase()}.`, async () => {
      await api(`/api/tickets/${id}/snooze`, {
        method: 'PATCH',
        // On restitue l'état d'avant, pas « aucune veille » : un ticket déjà
        // endormi qu'on rendort par erreur doit retrouver sa date initiale.
        body: JSON.stringify({
          hours: result.previous
            ? Math.max(
                1,
                Math.round((new Date(result.previous) - Date.now()) / 3_600_000),
              )
            : null,
        }),
      });
      await loadQueue();
    });
  } catch (error) {
    toast(error.message, true);
  }
}

function renderSnoozeMenu() {
  const menu = $('snooze-menu');
  if (!menu) return;

  menu.innerHTML = SNOOZE_CHOICES.map(
    (choice) =>
      `<button type="button" data-h="${choice.hours}">${choice.label}</button>`,
  ).join('');

  menu.querySelectorAll('button').forEach((button) =>
    button.addEventListener('click', () => {
      menu.hidden = true;
      const choice = SNOOZE_CHOICES.find((c) => String(c.hours) === button.dataset.h);
      snoozeTicket(choice.hours, choice.label);
    }),
  );
}

$('btn-snooze')?.addEventListener('click', () => {
  const menu = $('snooze-menu');
  menu.hidden = !menu.hidden;
  if (!menu.hidden) renderSnoozeMenu();
});

document.addEventListener('click', (event) => {
  const menu = $('snooze-menu');
  if (!menu || menu.hidden) return;
  if (!event.target.closest('.snooze-wrap')) menu.hidden = true;
});

/* ==========================================================================
   PALETTE DE COMMANDES
   ==========================================================================

   ⌘K ne se contentait plus de placer le curseur dans la recherche : elle
   exécute. Un outil dense finit toujours par cacher ses fonctions derrière
   trois niveaux de menu ; la palette rend chacune atteignable en trois
   lettres, sans avoir à se rappeler où elle se range.

   Les commandes indisponibles ne sont pas listées : proposer « Rembourser »
   à qui n'en a pas le droit ne renseigne personne. */

function buildCommands() {
  const list = [];

  for (const [view, meta] of Object.entries(VIEW_META)) {
    list.push({
      label: `Aller à ${meta.title}`,
      hint: 'Navigation',
      run: () => setView(view),
    });
  }

  const hasTicket = Boolean(state.currentId && state.detail?.ticket);

  if (hasTicket && canI('reply')) {
    for (const choice of SNOOZE_CHOICES) {
      list.push({
        label: `Mettre en veille — ${choice.label.toLowerCase()}`,
        hint: 'Message courant',
        run: () => snoozeTicket(choice.hours, choice.label),
      });
    }
    list.push({
      label: 'Écrire la réponse',
      hint: 'Message courant',
      run: () => $('d-body').focus(),
    });
  }

  if (hasTicket && canI('refund') && state.detail.ticket.shopifyOrderId) {
    list.push({
      label: 'Rembourser cette commande',
      hint: 'Message courant',
      run: () => $('btn-refund').click(),
    });
  }

  list.push(
    { label: 'Actualiser', hint: 'Écran', run: () => refreshCurrent() },
    {
      label: 'Relever la boîte mail',
      hint: 'Gmail',
      run: () => void pullMail({ revive: true }),
    },
    {
      label: 'File en tableau',
      hint: 'SAV client',
      run: () => {
        setView('tickets');
        setQueueView('table');
      },
    },
    {
      label: 'File en liste',
      hint: 'SAV client',
      run: () => {
        setView('tickets');
        setQueueView('list');
      },
    },
    {
      label: 'Filtrer les WISMO',
      hint: 'SAV client',
      run: () => {
        setView('tickets');
        basculerSeulement('wismo');
        rafraichirFiltres();
      },
    },
    {
      label: 'Basculer clair / sombre',
      hint: 'Apparence',
      // Le même geste que la tuile du Centre de contrôle.
      run: () => basculerTheme(),
    },
    {
      label: 'Afficher les raccourcis',
      hint: 'Aide',
      run: () => { $('keys').hidden = false; },
    },
  );

  return list;
}

/*
 * La recherche, façon Spotlight.
 *
 * Une capsule et quatre boutons ronds — Messages, Commandes, Clients,
 * Actions — pour ne chercher que dans un genre. Les résultats se rangent par
 * genre, le meilleur en tête. Les messages viennent de notre base, à la
 * frappe ; les clients et les commandes se déduisent de ces messages, ou du
 * texte tapé (un numéro, une adresse) — pas d'appel à Shopify par lettre.
 * Sans rien taper : les messages récents et les écrans courants.
 */
let paletteItems = [];
let paletteIndex = 0;
let palettePortee = null;
let paletteMessages = [];
let paletteMinuteur = null;
let paletteTour = 0;

const PAL_PORTEES = { message: 'Messages', commande: 'Commandes', client: 'Clients', action: 'Actions' };
const PAL_SYMBOLES = {
  commande: 'M5 8h14l-1 12H6zM9 8V6.5a3 3 0 0 1 6 0V8',
  ecran: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  action: 'M13 3 4 14h7l-1 7 9-11h-7z',
};

function openPalette() {
  paletteItems = buildCommands();
  paletteIndex = 0;
  palettePortee = null;
  paletteMessages = [];
  ouvrirCentre(false);

  $('pal').hidden = false;
  $('pal-input').value = '';
  $('pal-input').focus();
  rendrePortee();
  renderPalette('');
}

function closePalette() {
  $('pal').hidden = true;
}

/**
 * Filtre par sous-séquence plutôt que par sous-chaîne : « alcom » trouve
 * « Aller à Commandes ». C'est ce qui permet de taper trois lettres au lieu du
 * libellé exact, et c'est tout l'intérêt d'une palette.
 */
function fuzzyMatch(needle, haystack) {
  if (!needle) return true;
  const text = haystack.toLowerCase();
  let index = 0;
  for (const char of needle.toLowerCase()) {
    index = text.indexOf(char, index);
    if (index === -1) return false;
    index += 1;
  }
  return true;
}

/** Ouvre un écran de liste, filtré sur le texte tapé. */
function chercherDans(vue, terme) {
  if (vue === 'orders') {
    state.orders.q = terme;
    $('orders-q').value = terme;
    setView('orders');
    void loadOrders({ reset: true });
  } else if (vue === 'customers') {
    state.customers.q = terme;
    $('customers-q').value = terme;
    setView('customers');
    void loadCustomers({ reset: true });
  } else {
    state.queue.q = terme;
    renderJetons();
    setView('tickets');
    void loadQueue();
  }
}

function ligneMessage(ticket) {
  const nom = ticket.customerName ?? ticket.customerEmail ?? 'Client';
  return {
    genre: 'message',
    titre: ticketTitle(ticket),
    sous: `${nom} · ${dayOrDateTime(ticket.lastMessageAt)}`,
    initiales: initials(nom),
    run: () => {
      setView('tickets');
      void selectTicket(ticket.id);
    },
  };
}

function ligneEcran(vue) {
  return { genre: 'ecran', titre: VIEW_META[vue].label, sous: 'Écran', run: () => setView(vue) };
}

/** Sans accents ni capitales : « Reglages » trouve « Réglages ». */
function plat(texte) {
  return String(texte ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f\u200b]/g, '')
    .toLowerCase();
}

/** Les sections affichées pour ce texte et ce filtre : [titre, lignes][]. */
function sectionsPalette(query) {
  const q = query.trim();
  const portee = palettePortee;
  const voir = (genre) => !portee || portee === genre;

  if (!q && !portee) {
    const recents = (state.tickets ?? []).slice(0, 3).map(ligneMessage);
    const ecrans = ['tickets', 'orders', 'customers', 'settings'].filter((v) => VIEW_META[v]).map(ligneEcran);
    return [
      ...(recents.length ? [['Récents', recents]] : []),
      ['Écrans', ecrans],
    ];
  }

  const sections = [];

  if (voir('message')) {
    const lignes = paletteMessages.slice(0, portee ? 8 : 4).map(ligneMessage);
    if (q) {
      lignes.push({
        genre: 'message',
        titre: `Chercher « ${q} » dans les messages`,
        sous: 'SAV client',
        initiales: '…',
        run: () => chercherDans('tickets', q),
      });
    }
    if (lignes.length) sections.push(['Messages', lignes]);
  }

  if (voir('commande') && q) {
    const lignes = [];
    const vues = new Set();
    if (/^#?\d{2,}$/.test(q)) {
      const numero = q.startsWith('#') ? q : `#${q}`;
      vues.add(numero);
      lignes.push({ genre: 'commande', titre: `Commande ${numero}`, sous: 'Ouvrir dans Commandes', run: () => routeSearch(numero) });
    }
    for (const ticket of paletteMessages) {
      if (!ticket.orderName || vues.has(ticket.orderName)) continue;
      vues.add(ticket.orderName);
      lignes.push({
        genre: 'commande',
        titre: `Commande ${ticket.orderName}`,
        sous: ticket.customerName ?? ticket.customerEmail ?? '',
        run: () => routeSearch(ticket.orderName),
      });
    }
    if (portee === 'commande' && !lignes.length) {
      lignes.push({ genre: 'commande', titre: `Chercher « ${q} » dans les commandes`, sous: 'Commandes', run: () => chercherDans('orders', q) });
    }
    if (lignes.length) sections.push(['Commandes', lignes.slice(0, portee ? 8 : 3)]);
  }

  if (voir('client') && q) {
    const lignes = [];
    if (q.includes('@')) {
      lignes.push({ genre: 'client', titre: q, sous: 'Ouvrir dans Clients', initiales: initials(q), run: () => chercherDans('customers', q) });
    }
    const vus = new Set();
    for (const ticket of paletteMessages) {
      const email = ticket.customerEmail;
      if (!email || vus.has(email) || email === q) continue;
      vus.add(email);
      const nom = ticket.customerName ?? email;
      lignes.push({ genre: 'client', titre: nom, sous: email, initiales: initials(nom), run: () => chercherDans('customers', email) });
    }
    if (portee === 'client' && !lignes.length) {
      lignes.push({ genre: 'client', titre: `Chercher « ${q} » dans les clients`, sous: 'Clients', initiales: '…', run: () => chercherDans('customers', q) });
    }
    if (lignes.length) sections.push(['Clients', lignes.slice(0, portee ? 8 : 3)]);
  }

  // Dans une recherche mêlée, les écrans et les actions se trouvent par des
  // mots, pas par des lettres éparses : « lam » ne doit pas proposer « Mettre
  // en veille ». Le filtre « Actions » garde la recherche souple.
  const contient = (texte) => plat(texte).includes(plat(q));
  if (!portee && q) {
    const ecrans = VIEWS.filter((v) => !VIEW_META[v].hidden && contient(VIEW_META[v].label)).map(ligneEcran);
    if (ecrans.length) sections.push(['Écrans', ecrans.slice(0, 4)]);
  }

  if (voir('action')) {
    const actions = paletteItems
      .filter((item) => item.hint !== 'Navigation' && (portee ? fuzzyMatch(q, `${item.label} ${item.hint}`) : contient(`${item.label} ${item.hint}`)))
      .map((item) => ({ genre: 'action', titre: item.label, sous: item.hint, run: item.run }));
    if (actions.length) sections.push(['Actions', actions.slice(0, portee ? 12 : 3)]);
  }

  // Le meilleur résultat en tête : le premier qui n'est pas une simple
  // relance de recherche.
  if (q && !portee) {
    const meilleur = sections.flatMap(([, lignes]) => lignes).find((l) => !l.titre.startsWith('Chercher «'));
    if (meilleur) {
      for (const section of sections) section[1] = section[1].filter((l) => l !== meilleur);
      return [['Meilleur résultat', [{ ...meilleur, meilleur: true }]], ...sections.filter(([, l]) => l.length)];
    }
  }
  if (!sections.length && q) {
    return [['Rechercher', [{ genre: 'action', titre: `Chercher « ${q} »`, sous: 'Commande, client ou texte libre', run: () => routeSearch(q) }]]];
  }
  return sections;
}

function vignettePalette(ligne) {
  if (ligne.initiales) return esc(ligne.initiales);
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
    stroke-linejoin="round" aria-hidden="true"><path d="${PAL_SYMBOLES[ligne.genre] ?? PAL_SYMBOLES.action}" /></svg>`;
}

function renderPalette(query) {
  const sections = sectionsPalette(query);
  const matches = sections.flatMap(([, lignes]) => lignes);
  paletteIndex = Math.min(paletteIndex, Math.max(0, matches.length - 1));

  let rang = -1;
  $('pal-list').innerHTML = matches.length
    ? sections
        .map(
          ([titre, lignes]) => `<li class="pal-groupe" role="presentation">${esc(titre)}</li>${lignes
            .map((ligne) => {
              rang += 1;
              return `<li><button class="pal-item${ligne.meilleur ? ' pal-meilleur' : ''}" type="button"
                data-i="${rang}" aria-selected="${rang === paletteIndex}">
                <span class="pal-vignette pal-v-${ligne.genre}" aria-hidden="true">${vignettePalette(ligne)}</span>
                <span class="pal-txt"><b>${esc(ligne.titre)}</b><small>${esc(ligne.sous)}</small></span>
                <span class="pal-meta" aria-hidden="true">↵</span>
              </button></li>`;
            })
            .join('')}`,
        )
        .join('')
    : '<li class="empty" style="padding:14px">Aucun résultat.</li>';

  $('pal-list')
    .querySelectorAll('.pal-item')
    .forEach((button) => {
      button.addEventListener('click', () => {
        closePalette();
        matches[Number(button.dataset.i)]?.run();
      });
      // Comme dans Spotlight, le survol déplace la sélection.
      button.addEventListener('mouseenter', () => {
        paletteIndex = Number(button.dataset.i);
        $('pal-list')
          .querySelectorAll('.pal-item')
          .forEach((autre) => autre.setAttribute('aria-selected', String(autre === button)));
      });
    });

  $('pal-list')._matches = matches;
}

/** Les messages qui correspondent, cherchés en base après une courte pause de frappe. */
function chercherMessagesPalette(query) {
  clearTimeout(paletteMinuteur);
  const q = query.trim();
  if (q.length < 2) {
    paletteMessages = [];
    return;
  }
  paletteMinuteur = setTimeout(async () => {
    const tour = ++paletteTour;
    try {
      const params = new URLSearchParams({ q, folder: 'all', limit: '8' });
      if (state.allShops) params.set('scope', 'all');
      const data = await api(`/api/tickets?${params}`);
      // Une frappe plus récente a déjà relancé : sa réponse fait foi.
      if (tour !== paletteTour || $('pal').hidden) return;
      paletteMessages = data.tickets ?? [];
      renderPalette($('pal-input').value);
    } catch {
      // La recherche en base est un plus : les écrans et actions restent.
    }
  }, 200);
}

function rendrePortee() {
  const jeton = $('pal-jeton');
  jeton.hidden = !palettePortee;
  jeton.innerHTML = palettePortee ? `${esc(PAL_PORTEES[palettePortee])}${ico('close')}` : '';
  document.querySelectorAll('.pal-portee').forEach((bouton) => {
    bouton.setAttribute('aria-pressed', String(bouton.dataset.portee === palettePortee));
  });
}

function choisirPortee(portee) {
  palettePortee = portee;
  paletteIndex = 0;
  rendrePortee();
  renderPalette($('pal-input').value);
  $('pal-input').focus();
}

document.querySelectorAll('.pal-portee').forEach((bouton) =>
  bouton.addEventListener('click', () =>
    choisirPortee(palettePortee === bouton.dataset.portee ? null : bouton.dataset.portee),
  ),
);
$('pal-jeton')?.addEventListener('click', () => choisirPortee(null));

$('pal-input')?.addEventListener('input', (event) => {
  paletteIndex = 0;
  chercherMessagesPalette(event.target.value);
  renderPalette(event.target.value);
});

$('pal-input')?.addEventListener('keydown', (event) => {
  const matches = $('pal-list')._matches ?? [];

  if (event.key === 'ArrowDown') {
    event.preventDefault();
    paletteIndex = Math.min(matches.length - 1, paletteIndex + 1);
    renderPalette(event.target.value);
  } else if (event.key === 'ArrowUp') {
    event.preventDefault();
    paletteIndex = Math.max(0, paletteIndex - 1);
    renderPalette(event.target.value);
  } else if (event.key === 'Enter') {
    event.preventDefault();
    closePalette();
    matches[paletteIndex]?.run();
  } else if (event.key === 'Backspace' && !event.target.value && palettePortee) {
    choisirPortee(null);
  } else if (event.key === 'Escape') {
    // Comme Spotlight : Échap efface d'abord, puis ferme.
    if (event.target.value || palettePortee) {
      event.target.value = '';
      paletteMessages = [];
      choisirPortee(null);
    } else {
      closePalette();
    }
  }
});

// Un clic hors de la capsule et des résultats referme la recherche.
$('pal')?.addEventListener('click', (event) => {
  if (!event.target.closest('.pal-tete, .pal-resultats')) closePalette();
});

/* Tout numéro de suivi de l'application ouvre la même chronologie : la
   délégation attrape ceux rendus après coup — fiche client, rail du ticket,
   panneau colis — sans qu'aucun rendu n'ait à câbler son écouteur. Les lignes
   du tableau Suivi gardent le leur, posé avant celui-ci ; le double appel est
   évité en ne traitant ici que ce qui n'est pas déjà câblé. */
document.addEventListener('click', (event) => {
  // Tout porteur de `data-track`, et non les seuls liens : le bouton « Suivre
  // le colis » n'est pas un lien, et le câbler à part le ferait diverger.
  const button = event.target.closest('[data-track]');
  if (!button || button.closest('#tracking-rows')) return;
  void openTracking(button.dataset.track, button.dataset.trackUrl ?? null);
});

/* ==========================================================================
   TABLEAUX LISIBLES AU DOIGT
   ==========================================================================

   Un tableau de sept colonnes sur un écran de 390 pixels ne se lit pas : il
   défile latéralement, on perd la colonne de gauche, et l'on ne sait plus de
   quelle ligne vient la valeur qu'on regarde. La solution connue est de le
   replier en fiches, chaque cellule précédée de son intitulé.

   Encore faut-il que la cellule connaisse son intitulé. Plutôt que de le
   réécrire dans les neuf fonctions de rendu — neuf occasions d'oublier, et
   neuf endroits à corriger le jour où une colonne bouge —, on le recopie
   depuis l'en-tête après chaque rendu. Un observateur suffit, et il vaut aussi
   pour les tableaux qui n'existent pas encore. */

function stampCellLabels(tbody) {
  const table = tbody.closest('table');
  const heads = [...(table?.querySelectorAll('thead th') ?? [])].map((th) =>
    th.textContent.trim(),
  );
  if (heads.length === 0) return;

  for (const row of tbody.rows) {
    // Les lignes de message — « aucun résultat », « chargement » — occupent
    // toute la largeur et n'ont pas d'intitulé à porter.
    if (row.cells.length !== heads.length) continue;

    for (const [index, cell] of [...row.cells].entries()) {
      const label = heads[index];
      if (label) cell.dataset.label = label;
    }
  }
}

const tableWatcher = new MutationObserver((records) => {
  for (const record of records) {
    const target = record.target;
    if (target instanceof HTMLElement && target.tagName === 'TBODY') stampCellLabels(target);
  }
});

for (const tbody of document.querySelectorAll('.grid tbody')) {
  stampCellLabels(tbody);
  tableWatcher.observe(tbody, { childList: true });
}

$('refunds-range')?.addEventListener('click', (event) => {
  const button = event.target.closest('[data-days]');
  if (!button) return;
  refundDays = Number(button.dataset.days);
  chargerVueRemboursements();
});

/* ----------------------------------------- remboursements : statistiques */

/*
 * Deux vues sur la même page : les chiffres — combien, pourquoi, sur quels
 * produits — et la liste de toujours. La période vaut pour les deux. Le
 * choix de la vue est gardé : qui vient pour les chiffres y revient.
 */
let vueRemboursements = (() => {
  try {
    const vue = localStorage.getItem('csav.remb.vue');
    return vue === 'liste' || vue === 'afaire' ? vue : 'stats';
  } catch {
    return 'stats';
  }
})();
let mesureRaisons = 'montant';
let tousLesProduits = false;
let statsRemb = null;
let seqStatsRemb = 0;

const PERIODES_REMB = { 30: '30 jours', 90: '90 jours', 180: '6 mois', 365: '12 mois' };

function chargerVueRemboursements() {
  const stats = vueRemboursements === 'stats';
  const aFaire = vueRemboursements === 'afaire';
  $('refunds-stats').hidden = !stats;
  $('refunds-liste').hidden = vueRemboursements !== 'liste';
  $('refunds-afaire').hidden = !aFaire;
  // La période ne dit rien de ce qui reste à faire : elle se retire.
  $('refunds-range').hidden = aFaire;
  $('refunds-vue')
    .querySelectorAll('[data-vue]')
    .forEach((onglet) => onglet.setAttribute('aria-selected', String(onglet.dataset.vue === vueRemboursements)));
  $('refunds-range')
    .querySelectorAll('[data-days]')
    .forEach((bouton) => bouton.setAttribute('aria-pressed', String(Number(bouton.dataset.days) === refundDays)));
  void chargerARembourser();
  if (stats) void chargerStatsRemboursements();
  else if (!aFaire) void loadRefunds();
}

/*
 * « À rembourser » : ce que l'équipe a décidé sur une rupture, et que
 * l'administration fait.
 *
 * « Rembourser » ouvre la fenêtre de toujours, avec le prix de l'article ; le
 * remboursement parti, la ligne se solde et le dossier de rupture se ferme.
 * Fait à la main dans Shopify, « Marquer fait » solde la ligne de la même façon.
 */
let aRembourser = { lignes: [], compte: 0 };

async function chargerARembourser() {
  try {
    aRembourser = await api('/api/refunds/a-faire');
  } catch (error) {
    if (vueRemboursements === 'afaire') {
      $('refunds-afaire-liste').innerHTML = `<p class="rmb-vide">${esc(error.message)}</p>`;
    }
    return;
  }
  $('refunds-n-afaire').textContent = aRembourser.compte ? String(aRembourser.compte) : '';
  state.navCounts = { ...state.navCounts, refunds: aRembourser.compte };
  renderNav();
  renderARembourser();
}

function renderARembourser() {
  const boite = $('refunds-afaire-liste');
  const lignes = aRembourser.lignes ?? [];
  if (!lignes.length) {
    boite.innerHTML = '<p class="rmb-vide">Rien à rembourser : les remboursements décidés sur une rupture arriveront ici.</p>';
    return;
  }
  const jour = (date) => new Date(date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
  boite.innerHTML = `<div class="rmb-af-tete" aria-hidden="true"><span>Client</span><span>Commande</span><span>Article et raison</span><span>Demandé par</span><span class="num">Montant</span><span></span></div>
    ${lignes
      .map(
        (ligne) => `<div class="rmb-af-ligne${ligne.faitLe ? ' rmb-af-fait' : ''}">
          <span class="rmb-af-client"><b>${esc(ligne.client?.nom ?? ligne.client?.email ?? 'Client')}</b>${
            ligne.client?.nom && ligne.client?.email ? `<small>${esc(ligne.client.email)}</small>` : ''
          }</span>
          <b class="rmb-af-cmd">${esc(ligne.orderName ?? '—')}</b>
          <span class="rmb-af-art"><b>${esc(ligne.article)}</b><small>${esc(ligne.motif ?? 'Rupture · l’atelier n’expédie pas cet article')}</small></span>
          <span class="rmb-af-par"><span class="rmb-af-qui">${esc(ligne.demandePar ?? 'L’équipe')}</span><small>${ageMarkup(ligne.demandeLe, Boolean(ligne.faitLe))} ${
            ligne.returnCaseId ? 'depuis Retour/Échange' : 'depuis Ruptures de stock'
          }</small></span>
          <b class="rmb-af-montant num">${typeof ligne.montant === 'number' ? esc(euro(ligne.montant, ligne.devise ?? 'EUR')) : '—'}</b>
          <span class="rmb-af-geste">${
            ligne.faitLe
              ? `<span class="rmb-af-ok">${ico('check')}Remboursé · ${esc(jour(ligne.faitLe))}</span>`
              : `${
                  ligne.shopifyOrderId
                    ? `<button class="btn btn-small btn-primary" type="button" data-af-rembourser="${esc(ligne.id)}">Rembourser</button>`
                    : ''
                }<button class="linkish" type="button" data-af-fait="${esc(ligne.id)}">Marquer fait</button>`
          }<button class="ico ico-del" type="button" data-af-suppr="${esc(ligne.id)}" title="Supprimer" aria-label="Supprimer la ligne">${ico('close')}</button></span>
        </div>`,
      )
      .join('')}`;
}

$('refunds-afaire-liste')?.addEventListener('click', async (event) => {
  const suppr = event.target.closest('[data-af-suppr]');
  if (suppr) {
    if (!await confirmer('Supprimer cette ligne « À rembourser » ?\n\nRien n’est remboursé ni annulé chez Shopify.', { action: 'Supprimer', danger: true, icone: 'corbeille' })) return;
    try {
      await api(`/api/refunds/a-faire/${suppr.dataset.afSuppr}`, { method: 'DELETE' });
      toast('Ligne supprimée.');
      await chargerARembourser();
    } catch (error) {
      toast(error.message, true);
    }
    return;
  }
  const rembourser = event.target.closest('[data-af-rembourser]');
  const fait = event.target.closest('[data-af-fait]');
  if (rembourser) {
    const ligne = aRembourser.lignes.find((candidat) => candidat.id === rembourser.dataset.afRembourser);
    if (!ligne) return;
    await ouvrirRemboursement(
      { id: ligne.ticketId, shopifyOrderId: ligne.shopifyOrderId, orderName: ligne.orderName },
      { montant: ligne.montant, aFaireId: ligne.id, motif: ligne.returnCaseId ? 'Différence de prix d’un échange' : 'Article en rupture de stock', apres: chargerARembourser },
    );
  } else if (fait) {
    fait.disabled = true;
    try {
      await api(`/api/refunds/a-faire/${fait.dataset.afFait}/fait`, { method: 'POST', body: '{}' });
      toast('Marqué remboursé : le dossier de rupture est clos.');
      await chargerARembourser();
    } catch (error) {
      fait.disabled = false;
      toast(error.message, true);
    }
  }
});

$('refunds-vue').addEventListener('click', (event) => {
  const onglet = event.target.closest('[data-vue]');
  if (!onglet || onglet.dataset.vue === vueRemboursements) return;
  vueRemboursements = onglet.dataset.vue;
  try {
    localStorage.setItem('csav.remb.vue', vueRemboursements);
  } catch {
    /* un navigateur sans stockage garde le choix le temps de la page */
  }
  chargerVueRemboursements();
});

/**
 * Les statistiques de la période. Celles déjà affichées restent à
 * demi-teinte pendant le calcul : un écran qui se vide à chaque clic de
 * période clignote, et le calcul sur un an prend quelques secondes.
 */
async function chargerStatsRemboursements() {
  const zone = $('refunds-stats');
  const jours = refundDays;
  const seq = ++seqStatsRemb;
  if (statsRemb?.jours === jours) renderStatsRemboursements();
  else if (statsRemb) zone.classList.add('rmb-charge');
  else zone.innerHTML = '<p class="rmb-vide">Calcul des statistiques…</p>';

  try {
    const data = await api(`/api/refunds/stats?days=${jours}`);
    if (seq !== seqStatsRemb) return;
    statsRemb = { jours, data };
    renderStatsRemboursements();
  } catch (error) {
    if (seq !== seqStatsRemb) return;
    zone.innerHTML = `<p class="rmb-vide">${esc(error.message)}</p>`;
  } finally {
    if (seq === seqStatsRemb) zone.classList.remove('rmb-charge');
  }
}

/** Sous le titre : le total, la première chose qu'on cherche. */
function afficherSousRemboursements() {
  const sous = $('view-sub');
  const d = statsRemb?.data;
  if (!sous || !d || state.view !== 'refunds') return;
  sous.textContent = `${euro(d.total.montant, d.devise)} remboursés en ${PERIODES_REMB[d.jours] ?? `${d.jours} jours`}`;
  sous.hidden = false;
}

/** Un pas d'axe rond — 1, 2, 2,5 ou 5 fois une puissance de dix. */
function pasRond(valeur) {
  if (!(valeur > 0)) return 1;
  const puissance = 10 ** Math.floor(Math.log10(valeur));
  return [1, 2, 2.5, 5, 10].map((m) => m * puissance).find((pas) => pas >= valeur);
}

/* « Un remboursement sur trois » se lit mieux que « 34 % ». */
function fractionLisible(part) {
  if (part >= 0.9) return 'presque tous les remboursements';
  if (part >= 0.6) return 'plus d’un remboursement sur deux';
  if (part >= 0.45) return 'un remboursement sur deux';
  if (part >= 0.3) return 'un remboursement sur trois';
  if (part >= 0.22) return 'un remboursement sur quatre';
  return `${Math.round(part * 100)} % des remboursements`;
}

function grapheRemboursements(d) {
  const points = d.serie.points;
  const semaine = d.serie.pas === 'semaine';
  const max = Math.max(0, ...points.map((p) => p.montant));
  const pas = pasRond(max / 4);
  const haut = Math.max(pas, pas * Math.ceil(max / pas));
  const graduations = [];
  for (let t = 0; t <= haut + 1e-9; t += pas) graduations.push(t);
  const compact = new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency: d.devise,
    notation: 'compact',
    maximumFractionDigits: 1,
  });
  const libelle = (p) =>
    new Date(p.debut).toLocaleDateString(
      'fr-FR',
      semaine ? { day: 'numeric', month: 'short', timeZone: 'UTC' } : { month: 'short', year: '2-digit', timeZone: 'UTC' },
    );
  const titre = (p) => (semaine ? `Semaine du ${libelle(p)}` : libelle(p));
  // Sept étiquettes au plus sous l'axe : au-delà, elles se chevauchent.
  const saut = Math.ceil(points.length / 7);

  return `<section class="rmb-carte rmb-serie">
    <div class="rmb-carte-tete"><h2>Montant remboursé par ${semaine ? 'semaine' : 'mois'}</h2>
      <span class="rmb-aide">Survolez ou touchez une barre pour le détail</span></div>
    <div class="rmb-graphe">
      <div class="rmb-grille" aria-hidden="true">${graduations
        .map((t) => `<span style="bottom: ${(t / haut) * 100}%"><em>${esc(compact.format(t))}</em></span>`)
        .join('')}</div>
      <div class="rmb-barres" style="--n: ${points.length}">${points
        .map(
          (p, i) => `<button type="button" class="rmb-col" data-i="${i}"
            data-titre="${esc(titre(p))}" data-detail="${esc(
              `${euro(p.montant, d.devise)} · ${p.nombre} remboursement${p.nombre > 1 ? 's' : ''}`,
            )}" aria-label="${esc(titre(p))} : ${esc(euro(p.montant, d.devise))}, ${p.nombre} remboursement${
              p.nombre > 1 ? 's' : ''
            }"><i class="rmb-barre" style="height: ${(p.montant / haut) * 100}%"></i></button>`,
        )
        .join('')}</div>
      <div class="rmb-bulle" hidden></div>
    </div>
    <div class="rmb-axe" style="--n: ${points.length}" aria-hidden="true">${points
      // Une étiquette sur deux s'efface sur petit écran (voir la feuille de style).
      .map((p, i) =>
        i % saut === 0
          ? `<span${(i / saut) % 2 ? ' class="rmb-axe-pair"' : ''}>${esc(libelle(p))}</span>`
          : '<span></span>',
      )
      .join('')}</div>
  </section>`;
}

function renderStatsRemboursements() {
  const zone = $('refunds-stats');
  const d = statsRemb?.data;
  if (!d) return;
  afficherSousRemboursements();

  const periode = PERIODES_REMB[d.jours] ?? `${d.jours} jours`;
  const rond = (n) =>
    Number(n).toLocaleString('fr-FR', { style: 'currency', currency: d.devise, maximumFractionDigits: 0 });
  const pluriel = (n, mot) => `${n.toLocaleString('fr-FR')} ${mot}${n > 1 ? 's' : ''}`;

  const evolution =
    d.evolution != null
      ? `${Math.round(Math.abs(d.evolution) * 100)} % de ${d.evolution >= 0 ? 'plus' : 'moins'} que les ${periode} précédents`
      : d.total.nombre
        ? `aucun sur les ${periode} précédents`
        : '';
  const partSous =
    d.chiffreAffaires != null
      ? `sur ${rond(d.chiffreAffaires)} de ventes`
      : d.sources.shopify
        ? 'trop de commandes pour la calculer ici'
        : 'Shopify n’a pas répondu';

  const tuiles = `<div class="rmb-tuiles">
    <div class="rmb-tuile rmb-heros">
      <span class="rmb-t">Total remboursé</span>
      <b class="rmb-v">${esc(euro(d.total.montant, d.devise))}</b>
      <span class="rmb-s">${esc(pluriel(d.total.nombre, 'remboursement'))}${evolution ? ` · ${esc(evolution)}` : ''}</span>
    </div>
    <div class="rmb-tuile">
      <span class="rmb-t">Part du chiffre d’affaires</span>
      <b class="rmb-v">${d.part == null ? '—' : esc(`${(d.part * 100).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} %`)}</b>
      <span class="rmb-s">${esc(partSous)}</span>
    </div>
    <div class="rmb-tuile">
      <span class="rmb-t">Montant moyen</span>
      <b class="rmb-v">${d.moyenne == null ? '—' : esc(euro(d.moyenne, d.devise))}</b>
      <span class="rmb-s">par remboursement</span>
    </div>
    <div class="rmb-tuile">
      <span class="rmb-t">Demandes reçues par mail</span>
      <b class="rmb-v">${d.demandes.recues.toLocaleString('fr-FR')}</b>
      <span class="rmb-s">dont ${d.demandes.remboursees.toLocaleString('fr-FR')} remboursée${d.demandes.remboursees > 1 ? 's' : ''}</span>
    </div>
  </div>`;

  const note = [
    'Comptés : les remboursements faits depuis l’outil et ceux passés dans Shopify. La raison vient du motif choisi au remboursement, ou du dossier de retour ; « Sans motif » quand Shopify n’en a pas.',
    !d.sources.shopify ? 'Shopify n’a pas répondu : seuls les remboursements faits depuis l’outil sont comptés.' : '',
    d.sources.partiel ? 'Calculé sur les remboursements les plus récents : la période en compte plus que Shopify n’en sert d’un coup.' : '',
  ]
    .filter(Boolean)
    .map((ligne) => `<p class="rmb-note">${esc(ligne)}</p>`)
    .join('');

  if (!d.total.nombre) {
    zone.innerHTML = `${tuiles}<div class="rmb-carte rmb-rien">Aucun remboursement sur les ${esc(periode)}.</div>${note}`;
    return;
  }

  // Pourquoi : barres triées, une seule teinte, la valeur au bout.
  const valeur = (r) => (mesureRaisons === 'montant' ? r.montant : r.nombre);
  const raisons = [...d.raisons].sort((a, b) => valeur(b) - valeur(a));
  const plus = valeur(raisons[0]) || 1;
  const somme = raisons.reduce((total, r) => total + valeur(r), 0) || 1;
  /*
   * Une phrase pour ce qui ressort. « Sans motif » n'est pas une raison : on
   * ne le met en avant que s'il l'emporte vraiment, pour dire qu'il manque
   * des motifs. Deux raisons à égalité sont nommées ensemble.
   */
  const sansMotif = d.raisons.find((r) => r.cle === 'sans');
  const parNombre = d.raisons.filter((r) => r.cle !== 'sans').sort((a, b) => b.nombre - a.nombre);
  const [premiere, seconde] = parNombre;
  let constat = '';
  const partSans = sansMotif ? sansMotif.nombre / d.total.nombre : 0;
  if (partSans >= 0.9) {
    constat = 'Presque aucun remboursement n’a de motif : ils ont été faits dans Shopify sans note.';
  } else if (partSans >= 0.5) {
    constat = `${fractionLisible(partSans).replace(/^./, (c) => c.toUpperCase())} n’a pas de motif : fait dans Shopify sans note.`;
  } else if (premiere && seconde && seconde.nombre === premiere.nombre) {
    constat = `« ${premiere.libelle} » et « ${seconde.libelle} » reviennent le plus : ${fractionLisible(
      premiere.nombre / d.total.nombre,
    )} chacun.`;
  } else if (premiere) {
    const produit = d.produits.find((p) => p.raison === premiere.libelle)?.titre;
    constat = `« ${premiere.libelle} » revient le plus : ${fractionLisible(premiere.nombre / d.total.nombre)}${
      produit ? `, surtout sur ${produit}` : ''
    }.`;
  }

  const blocRaisons = `<section class="rmb-carte rmb-raisons">
    <div class="rmb-carte-tete"><h2>Raisons</h2>
      <div class="rmb-onglets rmb-petit" role="tablist" aria-label="Mesure">
        <button type="button" role="tab" data-mesure="montant" aria-selected="${mesureRaisons === 'montant'}">Montant</button>
        <button type="button" role="tab" data-mesure="nombre" aria-selected="${mesureRaisons === 'nombre'}">Nombre</button>
      </div></div>
    ${constat ? `<p class="rmb-constat">${esc(constat)}</p>` : ''}
    ${raisons
      .map(
        (r) => `<div class="rmb-raison">
          <span class="rmb-raison-nom">${esc(r.libelle)}</span>
          <span class="rmb-piste" aria-hidden="true"><i style="width: ${(valeur(r) / plus) * 100}%"></i></span>
          <span class="rmb-raison-val"><b>${esc(mesureRaisons === 'montant' ? rond(r.montant) : String(r.nombre))}</b>
            <span>${Math.round((valeur(r) / somme) * 100)} %</span></span>
        </div>`,
      )
      .join('')}
  </section>`;

  // Quels produits : la raison principale dit quoi corriger.
  const visibles = tousLesProduits ? d.produits : d.produits.slice(0, 6);
  const reste = [
    !tousLesProduits && d.produitsTotal > visibles.length
      ? `Et ${pluriel(d.produitsTotal - visibles.length, 'autre produit')}.`
      : '',
    d.nonAttribues.nombre
      ? `${pluriel(d.nonAttribues.nombre, 'remboursement')} sans article précisé (${rond(d.nonAttribues.montant)}).`
      : '',
  ]
    .filter(Boolean)
    .join(' ');
  const blocProduits = `<section class="rmb-carte rmb-produits">
    <div class="rmb-carte-tete"><h2>Produits les plus remboursés</h2>${
      d.produits.length > 6
        ? `<button type="button" class="rmb-lien" data-tous>${tousLesProduits ? 'Voir moins' : 'Tout voir'}</button>`
        : ''
    }</div>
    ${
      visibles.length
        ? `<div class="rmb-prod rmb-prod-tete" aria-hidden="true"><span>Produit</span><span>Remb.</span><span>Montant</span><span>Raison principale</span></div>
          ${visibles
            .map(
              (p) => `<div class="rmb-prod">
                <span class="rmb-prod-nom">${
                  p.image ? `<img src="${esc(p.image)}" alt="" loading="lazy" />` : '<i class="rmb-vignette" aria-hidden="true"></i>'
                }<span class="rmb-prod-txt"><b>${esc(p.titre)}</b>${
                  p.variante ? `<span>Le plus touché : ${esc(p.variante)}</span>` : ''
                }</span></span>
                <span class="rmb-prod-n">${p.nombre}<span class="rmb-unite"> remb.</span></span>
                <span class="rmb-prod-m">${esc(rond(p.montant))}</span>
                <span class="rmb-prod-r">${p.raison ? `${esc(p.raison)} <span>· ${p.raisonNombre}</span>` : ''}</span>
              </div>`,
            )
            .join('')}`
        : '<p class="rmb-vide-petit">Aucun article précisé sur ces remboursements.</p>'
    }
    ${reste ? `<p class="rmb-reste">${esc(reste)}</p>` : ''}
  </section>`;

  zone.innerHTML = `${tuiles}${grapheRemboursements(d)}<div class="rmb-duo">${blocRaisons}${blocProduits}</div>${note}`;
}

/* Le détail d'une barre : au survol à la souris, au toucher, au clavier. */
function montrerBulleRemb(colonne) {
  const graphe = colonne.closest('.rmb-graphe');
  const bulle = graphe?.querySelector('.rmb-bulle');
  if (!bulle) return;
  graphe.querySelectorAll('.rmb-col.on').forEach((autre) => autre.classList.remove('on'));
  colonne.classList.add('on');
  bulle.innerHTML = `<b>${esc(colonne.dataset.titre)}</b><span>${esc(colonne.dataset.detail)}</span>`;
  bulle.hidden = false;
  const cadre = graphe.getBoundingClientRect();
  const col = colonne.getBoundingClientRect();
  const barre = colonne.querySelector('.rmb-barre').getBoundingClientRect();
  const largeur = bulle.offsetWidth;
  const centre = col.left - cadre.left + col.width / 2;
  bulle.style.left = `${Math.min(Math.max(centre - largeur / 2, 0), cadre.width - largeur)}px`;
  bulle.style.bottom = `${cadre.bottom - barre.top + 8}px`;
}

function cacherBulleRemb(graphe) {
  graphe?.querySelector('.rmb-bulle')?.setAttribute('hidden', '');
  graphe?.querySelectorAll('.rmb-col.on').forEach((col) => col.classList.remove('on'));
}

$('refunds-stats').addEventListener('pointerover', (event) => {
  const colonne = event.target.closest('.rmb-col');
  if (colonne && event.pointerType === 'mouse') montrerBulleRemb(colonne);
});
$('refunds-stats').addEventListener('pointerout', (event) => {
  const graphe = event.target.closest('.rmb-graphe');
  if (graphe && event.pointerType === 'mouse' && !graphe.contains(event.relatedTarget)) cacherBulleRemb(graphe);
});
$('refunds-stats').addEventListener('focusin', (event) => {
  const colonne = event.target.closest('.rmb-col');
  if (colonne) montrerBulleRemb(colonne);
});
$('refunds-stats').addEventListener('click', (event) => {
  const colonne = event.target.closest('.rmb-col');
  if (colonne) {
    montrerBulleRemb(colonne);
    return;
  }
  const mesure = event.target.closest('[data-mesure]');
  if (mesure) {
    mesureRaisons = mesure.dataset.mesure;
    renderStatsRemboursements();
    return;
  }
  if (event.target.closest('[data-tous]')) {
    tousLesProduits = !tousLesProduits;
    renderStatsRemboursements();
  }
});

/* Essai du fournisseur d'IA. Le seul moyen, sans accès aux journaux, de savoir
   si le modèle répond — et sinon, ce qu'il reproche exactement. */
$('ai-test')?.addEventListener('click', async () => {
  const button = $('ai-test');
  const node = $('ai-test-state');

  button.disabled = true;
  node.textContent = 'Le modèle rédige un brouillon d’essai…';

  try {
    const result = await api('/api/ai/test', { method: 'POST', body: '{}' });

    // Le résumé et le début du brouillon sont affichés : lire ce que le modèle
    // produit vraiment en dit plus long qu'un « connexion réussie », et c'est
    // exactement ce qui doit apparaître sur les tickets.
    node.innerHTML =
      `<b style="color:var(--ok)">Le modèle rédige.</b> ${result.ms} ms · confiance ${
        Math.round((result.confidence ?? 0) * 100)
      } %<br>` +
      `<b>Demande :</b> ${esc(result.ask ?? '—')}<br>` +
      `<b>Résumé :</b> ${(result.summary ?? []).map((line) => esc(line)).join(' · ') || '—'}<br>` +
      `<b>Brouillon :</b> <i>${esc(result.preview ?? '')}…</i>`;

    // Les échecs déjà en base, regroupés par motif : si l'IA rédige mais que
    // les tickets échouent, la cause est ailleurs et c'est ici qu'elle se lit.
    try {
      const failures = await api('/api/tickets/failures');
      if (failures.total > 0) {
        node.innerHTML +=
          `<br><br><b class="set-alert">${failures.total} message${
            failures.total > 1 ? 's' : ''
          } en échec.</b> Motifs :<br>` +
          failures.reasons
            .map(
              (row) =>
                `<span class="mono" style="font-size:12px">${row.count} × ${esc(
                  row.reason,
                )}</span>`,
            )
            .join('<br>');
      }
    } catch {
      // Le diagnostic principal a déjà répondu : ne pas le gâcher pour un
      // complément.
    }

    {
      // La relance est proposée là où l'on vient de constater que la cause est
      // levée : la chercher ailleurs, c'est ne pas la faire.
      const retry = document.createElement('button');
      retry.className = 'btn btn-small btn-primary';
      retry.style.marginTop = '9px';
      retry.textContent = 'Relancer les messages en échec';
      retry.addEventListener('click', async () => {
        retry.disabled = true;
        retry.textContent = 'Relance…';
        try {
          const out = await api('/api/tickets/retry-failed', { method: 'POST', body: '{}' });
          toast(
            `${out.queued} ticket${out.queued > 1 ? 's' : ''} remis en traitement${
              out.remaining ? ' — relancez pour la suite.' : '.'
            }`,
          );
        } catch (error) {
          toast(error.message, true);
        } finally {
          retry.disabled = false;
          retry.textContent = 'Relancer les messages en échec';
        }
      });
      node.append(document.createElement('br'), retry);
    }
  } catch (error) {
    // Le message du fournisseur est reproduit tel quel : « invalid x-api-key »,
    // « insufficient balance » et « model not found » appellent trois gestes
    // différents, et un « échec » commun les rendrait tous inutiles.
    node.innerHTML =
      `<b class="set-alert">L’IA ne répond pas.</b><br>` +
      `<span class="mono" style="font-size:12px">${esc(error.message)}</span><br>` +
      `<span>Réglez la clé dans la console d’administration (<code>/admin</code>).</span>`;
  } finally {
    button.disabled = false;
  }
});

/* Pose des libellés sur les tickets déjà en base. Séparé du rattrapage : les
   étiquettes n'ont aucune raison d'attendre plusieurs minutes de balayage. */
$('labels-sync')?.addEventListener('click', async () => {
  const button = $('labels-sync');
  const node = $('labels-sync-state');

  button.disabled = true;
  node.textContent = 'Lecture des libellés dans Gmail…';

  try {
    const result = await api('/api/labels/sync', { method: 'POST', body: '{}' });
    node.innerHTML =
      result.updated > 0
        ? `<b style="color:var(--ok)">${result.updated} ticket${
            result.updated > 1 ? 's' : ''
          } étiqueté${result.updated > 1 ? 's' : ''}.</b> ` +
          'Les libellés sont utilisables comme filtres sur la file.'
        : '<b class="set-alert">Aucun ticket étiqueté.</b> Vos libellés existent dans ' +
          'Gmail mais ne portent sur aucun message déjà entré dans la file.';

    await loadLabelStyles();
  } catch (error) {
    node.innerHTML = `<b class="set-alert">${esc(error.message)}</b>`;
  } finally {
    button.disabled = false;
  }
});

/* ==========================================================================
   ALERTE DE TRAITEMENT
   ==========================================================================

   Le motif d'échec vivait dans un panneau des Réglages, sous un bouton de
   test. Personne ne va dans les Réglages pour comprendre pourquoi sa file ne
   produit rien : on regarde la file, on voit « Échec », et on n'a nulle part
   où aller. L'alerte s'affiche donc là où le problème se constate. */

async function checkFailures() {
  const bar = $('fail-alarm');
  if (!bar) return;

  let data;
  try {
    data = await api('/api/tickets/failures');
  } catch {
    bar.hidden = true;
    return;
  }

  if (!data.total) {
    bar.hidden = true;
    return;
  }

  bar.hidden = false;
  $('fail-alarm-title').textContent =
    `${data.total} message${data.total > 1 ? 's' : ''} n’${
      data.total > 1 ? 'ont' : 'a'
    } pas pu être traité${data.total > 1 ? 's' : ''} par l’IA.`;

  // Le motif dominant seul : les quatre suivants sont presque toujours le même
  // à une virgule près, et les lister ferait un mur là où il faut une phrase.
  const first = data.reasons?.[0];
  $('fail-alarm-reason').textContent = first
    ? ` Cause principale : ${first.reason}`
    : '';
}

$('fail-alarm-retry')?.addEventListener('click', async () => {
  const button = $('fail-alarm-retry');
  button.disabled = true;
  button.textContent = 'Relance…';

  try {
    const out = await api('/api/tickets/retry-failed', { method: 'POST', body: '{}' });
    toast(
      `${out.queued} ticket${out.queued > 1 ? 's' : ''} remis en traitement${
        out.remaining ? ' — relancez pour la suite.' : '.'
      }`,
    );
    await loadQueue();
  } catch (error) {
    toast(error.message, true);
  } finally {
    button.disabled = false;
    button.textContent = 'Relancer';
  }
});

/* ==================================================== ruptures de stock ==
 *
 * La console des ruptures.
 *
 * Une rupture n'est pas une intention de mail : c'est une escalade
 * fournisseur portant `reason: OUT_OF_STOCK`. Cet écran ne crée donc aucun
 * objet et n'ouvre aucune machine d'état parallèle — il relit ce que
 * l'escalade, le ticket et la commande disent déjà, et les présente comme un
 * poste de travail.
 *
 * TOUT CE QU'IL MONTRE EXISTE. Pas de stock inventé, pas de fournisseur
 * deviné, pas d'alternative proposée sur une ressemblance de nom. Ce que la
 * base ne sait pas, l'écran le dit — et là où le visuel de référence promet
 * une donnée que le produit ne détient pas, la colonne a été remplacée par
 * une qui se compte vraiment.
 */

state.ruptures = {
  dossiers: [],
  kpis: null,
  compteurs: {},
  /** Les cinq chiffres du haut, calculés au serveur (`tableau.ts`). */
  chiffres: null,
  /** Les modèles en rupture sur quatre-vingt-dix jours. */
  modeles: [],
  /** Le mail au client part au clic, ou dès que l'atelier signale. */
  mailRuptureAuto: false,
  shopifyError: null,
  vue: 'tous',
  q: '',
  page: 1,
  taille: 25,
  courant: null,
  chargement: false,
  erreur: null,
  /** Alternatives du dossier ouvert : cherchées à la sélection, jamais par ligne. */
  alternatives: null,
};

/* Les trois temps, pour l'infobulle de la ligne : une couleur seule ne dit
   rien à qui ne connaît pas le code, et rien du tout à qui ne distingue pas
   le rouge du vert. */
const RUP_PHASES = {
  cree: 'Créé — le client n’a pas encore eu de réponse',
  traite: 'Traité — le client a eu une réponse',
  classe: 'Classé — dossier clos',
};

/*
 * Les chiffres du haut sont aussi les filtres de la liste.
 *
 * Un chiffre qu'on ne peut pas ouvrir oblige à chercher les dossiers qu'il
 * compte ; cliquer « 3 À traiter » doit montrer ces trois-là. Chacun lit le
 * même drapeau que le serveur a posé sur le dossier (`suivi.file`), pour que
 * le chiffre et la liste filtrée ne se contredisent jamais.
 */
const RUP_FILTRES = {
  aTraiter: { titre: 'À traiter', sous: 'sans décision envoyée', ton: 'crit', garde: (file) => file.aTraiter },
  attenteClient: { titre: 'En attente du client', sous: 'mail parti, pas de réponse', ton: 'accent', garde: (file) => file.attenteClient },
  repete: { titre: 'Ruptures répétées', sous: 'le 2e choix manque aussi', ton: 'warn', garde: (file) => file.repete },
  attenteAtelier: { titre: 'En attente de l’atelier', sous: 'pas encore de nouveau suivi', ton: 'violet', garde: (file) => file.attenteAtelier },
};

async function loadRuptures() {
  const r = state.ruptures;
  r.chargement = true;
  r.erreur = null;
  renderRuptures();

  try {
    const data = await api('/api/ruptures');
    r.dossiers = data.dossiers ?? [];
    r.kpis = data.kpis ?? null;
    r.compteurs = data.compteurs ?? {};
    r.chiffres = data.chiffres ?? null;
    r.modeles = data.modeles ?? [];
    r.mailRuptureAuto = Boolean(data.mailRuptureAuto);
    r.shopifyError = data.shopifyError ?? null;

    /* La pastille suit la page sans attendre la relève. Clôturer un dossier
       recharge la liste : sans cette ligne, le menu garderait « 12 » pendant
       une minute sous une page qui en affiche 11, et l'on croirait que la
       clôture n'a pas pris. */
    state.navCounts = { ...state.navCounts, ruptures: r.compteurs.ouverts ?? 0 };
    renderNav();

    // Une sélection qui ne désigne plus rien laisserait un panneau figé sur un
    // dossier disparu, ce qui se lit comme un écran qui ne se rafraîchit pas.
    const ids = new Set(r.dossiers.map((d) => d.id));
    if (r.courant && !ids.has(r.courant)) r.courant = null;
  } catch (error) {
    r.erreur = error.message;
  } finally {
    r.chargement = false;
    renderRuptures();
  }
}

/** La file du dossier, telle que le serveur l'a jugée ; un repli prudent sinon. */
const fileDe = (d) =>
  d.suivi?.file ?? {
    cle: d.etat === 'RESOLU' ? 'RESOLU' : 'A_TRAITER',
    libelle: d.etat === 'RESOLU' ? 'Résolu' : 'À traiter',
    sous: '',
    ton: d.etat === 'RESOLU' ? 'neutre' : 'crit',
    aTraiter: d.etat !== 'RESOLU',
    attenteClient: false,
    repete: false,
    attenteAtelier: false,
  };

/** Les dossiers du filtre courant, cherchés et triés — la liste avant pagination. */
function rupturesFiltrees() {
  const r = state.ruptures;
  const terme = r.q.trim().toLowerCase();
  const filtre = RUP_FILTRES[r.vue];

  const liste = r.dossiers.filter((d) => {
    // « Tous » garde les dossiers clos : les en retirer faisait disparaître
    // un dossier au moment où on le marquait résolu, ce qui se lit comme une
    // suppression. Il reste visible, sous le travail restant.
    if (filtre && (d.etat === 'RESOLU' || !filtre.garde(fileDe(d)))) return false;

    if (!terme) return true;
    return [
      d.client?.nom,
      d.client?.email,
      d.commande?.nom,
      d.article?.titre,
      d.article?.sku,
      d.article?.variante,
      d.fournisseur?.name,
    ]
      .filter(Boolean)
      .some((champ) => String(champ).toLowerCase().includes(terme));
  });

  /*
   * Ce qui attend une décision d'abord, puis le plus récent.
   *
   * Les dossiers clos descendent sous les autres : sinon, un dossier résolu à
   * l'instant resterait en tête, au-dessus de ceux qu'il faut encore traiter,
   * et l'œil le relirait à chaque passage.
   */
  const date = (d) => new Date(d.creeLe).getTime();
  const rang = (d) => (d.etat === 'RESOLU' ? 2 : fileDe(d).aTraiter ? 0 : 1);
  return [...liste].sort((a, b) => rang(a) - rang(b) || date(b) - date(a));
}

function renderRuptures() {
  const r = state.ruptures;
  if (!$('rup-rows')) return;

  renderRuptureChiffres();
  renderRuptureEntete();
  renderRuptureModeles();

  const boite = $('rup-shopify');
  boite.hidden = !r.shopifyError;
  if (r.shopifyError) {
    $('rup-shopify-txt').innerHTML =
      `<b>Détail produit incomplet.</b> ${esc(r.shopifyError)} Les dossiers, les ` +
      'fournisseurs et les états restent justes : ils viennent de votre base.';
  }

  const liste = rupturesFiltrees();
  const pages = Math.max(1, Math.ceil(liste.length / r.taille));
  if (r.page > pages) r.page = pages;
  const page = liste.slice((r.page - 1) * r.taille, r.page * r.taille);

  renderRuptureLignes(page, liste.length);
  renderRupturePager(liste.length, pages);
  renderRupturePanneau();
}

/*
 * L'âge d'une demande, en couleur : vert le premier jour, orange jusqu'à
 * trois jours, rouge au-delà. Un dossier clos reste gris — son âge ne
 * réclame plus rien.
 */
function ageMarkup(date, clos = false) {
  const ms = Date.now() - new Date(date).getTime();
  const ton = clos ? 'clos' : ms < 86_400_000 ? 'frais' : ms < 3 * 86_400_000 ? 'jour' : 'vieux';
  return `<span class="age age-${ton}" title="${esc(new Date(date).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' }))}">${esc(
    formatSpan(ms),
  )}</span>`;
}

/** « 3,2 j », « 18 h » : le délai moyen, à l'échelle qui se lit. */
function delaiRupture(heures) {
  if (typeof heures !== 'number') return '—';
  if (heures < 48) return `${heures} h`;
  return `${(heures / 24).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} j`;
}

function renderRuptureChiffres() {
  const r = state.ruptures;
  const c = r.chiffres;
  const n = (valeur) => (typeof valeur === 'number' ? String(valeur) : '—');
  const valeurs = {
    aTraiter: c?.aTraiter,
    attenteClient: c?.attenteClient,
    repete: c?.repetees,
    attenteAtelier: c?.attenteAtelier,
  };

  $('rup-chiffres').innerHTML =
    Object.entries(RUP_FILTRES)
      .map(
        ([cle, filtre]) => `<button class="rup-chiffre" type="button" data-rup-filtre="${esc(cle)}"
          aria-pressed="${r.vue === cle}">
          <span class="rup-chiffre-t"><i class="rup-point rup-point-${esc(filtre.ton)}" aria-hidden="true"></i>${esc(filtre.titre)}</span>
          <b>${esc(n(valeurs[cle]))}</b>
          <small>${esc(filtre.sous)}</small>
        </button>`,
      )
      .join('') +
    // Le délai n'est pas un filtre : il mesure, il ne désigne aucun dossier.
    `<div class="rup-chiffre rup-chiffre-fixe">
      <span class="rup-chiffre-t"><i class="rup-point rup-point-ok" aria-hidden="true"></i>Délai moyen</span>
      <b>${esc(delaiRupture(c?.delaiMoyenHeures))}</b>
      <small>${esc(c?.delaiMesure ? 'de la rupture au nouveau suivi' : 'aucun nouveau suivi encore')}</small>
    </div>`;
}

function renderRuptureEntete() {
  const r = state.ruptures;
  const filtre = RUP_FILTRES[r.vue];
  $('rup-liste-t').textContent = filtre ? filtre.titre : 'Toutes les ruptures';
  // Le filtre se retire là où il se lit : à côté du titre qu'il a changé.
  $('rup-filtre').hidden = !filtre;

  $('rup-mailauto').querySelectorAll('[data-auto]').forEach((bouton) => {
    bouton.setAttribute('aria-checked', String((bouton.dataset.auto === 'true') === r.mailRuptureAuto));
  });

  const ouverts = r.chiffres?.aTraiter ?? 0;
  if (state.view === 'ruptures' && $('view-sub')) {
    $('view-sub').hidden = false;
    $('view-sub').textContent = ouverts
      ? `${ouverts} dossier${ouverts > 1 ? 's attendent' : ' attend'} votre décision`
      : 'Rien n’attend votre décision';
  }
}

/* Le mail au client, sur la ligne : parti (et quand), ou le bouton pour l'envoyer. */
function mailDeLaLigne(d) {
  const le = d.suivi?.mailClientLe;
  if (le) {
    const jour = new Date(le).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
    return `<span class="rup-mail-ok">${ico('check')}${esc(d.suivi.mailAuto ? `Mail auto, ${jour}` : `Mail envoyé · ${jour}`)}</span>`;
  }
  if (d.etat === 'RESOLU') return '';
  return `<button class="btn btn-small rup-b-mail" type="button" data-rup-mail="${esc(d.id)}">Envoyer le mail</button>`;
}

/* La décision, sur la ligne : « À traiter » tant qu'il en faut une, sinon ce qui a été décidé. */
function decisionDeLaLigne(d) {
  const file = fileDe(d);
  if (d.etat === 'RESOLU') return '';
  if (file.aTraiter) {
    return `<button class="btn btn-small btn-primary rup-b-traiter" type="button" data-rup-traiter="${esc(d.id)}">${esc(
      file.libelle === 'Client à relancer' ? 'Relancer' : 'À traiter',
    )}</button>`;
  }
  const consigne = consigneCouranteDe(d);
  const texte = !consigne
    ? file.libelle
    : consigne.choix === 'ATTENDRE'
      ? `Restock · ${dateConsigneFr(consigne.relancerLe ?? consigne.expedierAvant ?? consigne.envoyeeLe)}`
      : { REMPLACER: 'Modèle modifié', ANNULER: 'Remboursement', MESSAGE: 'Message envoyé' }[consigne.choix];
  return `<button class="btn btn-small rup-b-decision" type="button" data-rup-ouvrir="${esc(d.id)}">${esc(texte)}</button>`;
}

function renderRuptureLignes(page, total) {
  const r = state.ruptures;
  const corps = $('rup-rows');

  if (r.chargement && r.dossiers.length === 0) {
    // Des lignes grises de la bonne hauteur : un tourniquet au milieu de la
    // page fait attendre sans rien dire de ce qui arrive.
    corps.innerHTML = Array.from({ length: 6 })
      .map(
        () => `<tr><td colspan="6"><span class="skel-row">
          <span class="skel"></span><span class="skel"></span>
        </span></td></tr>`,
      )
      .join('');
    return;
  }

  if (r.erreur) {
    corps.innerHTML = `<tr><td colspan="6" class="empty" style="padding:22px 14px">
      ${esc(r.erreur)}
      <button class="linkish" type="button" id="rup-retry">Réessayer</button>
    </td></tr>`;
    $('rup-retry')?.addEventListener('click', () => void loadRuptures());
    return;
  }

  if (total === 0) {
    const filtre = r.q || r.vue !== 'tous';
    corps.innerHTML = `<tr><td colspan="6" class="empty" style="padding:26px 14px">
      <b style="display:block;font-size:13.5px;color:var(--ink)">${
        filtre ? 'Aucun dossier ici.' : 'Aucune rupture de stock à traiter.'
      }</b>
      ${esc(
        filtre
          ? 'Retirez le filtre pour revoir toutes les ruptures.'
          : 'Les commandes concernées apparaîtront ici dès qu’une rupture sera signalée.',
      )}
    </td></tr>`;
    return;
  }

  corps.innerHTML = page
    .map((d) => {
      const file = fileDe(d);
      const titre = d.article?.titre ?? (d.origine === 'atelier' ? 'Article non précisé' : 'Article non lu');
      const detail = [d.article?.variante, d.article?.sku].filter(Boolean).join(' · ');
      const qui = [d.client?.nom, d.commande?.nom].filter(Boolean).join(' · ');

      return `<tr data-rup="${esc(d.id)}" data-phase="${esc(d.phase ?? 'cree')}" tabindex="0"
        aria-selected="${d.id === r.courant}"
        title="${esc(RUP_PHASES[d.phase] ?? '')}">
        <td class="rup-c-client"><span class="rup-who">
          <b>${esc(d.client?.nom ?? d.client?.email ?? 'Client inconnu')}</b>
          ${d.client?.nom && d.client?.email ? `<small>${esc(d.client.email)}</small>` : ''}
          ${d.commande?.nom ? `<small class="rup-cmd-mini">${esc(d.commande.nom)}</small>` : ''}
        </span></td>
        <td class="rup-c-cmd"><b>${esc(d.commande?.nom ?? '—')}</b></td>
        <td class="rup-c-art"><span class="rup-prod">
          ${
            d.article?.image
              ? `<img src="${esc(d.article.image)}" alt="" loading="lazy" />`
              : '<span class="rup-blank"></span>'
          }
          <span style="min-width:0">
            <b>${esc(titre)}</b>
            <small>${esc(detail || '—')}</small>
            ${qui ? `<small class="rup-qui">${esc(qui)}</small>` : ''}
            ${file.repete ? '<span class="rup-repete">2e choix, aussi en rupture</span>' : ''}
          </span>
        </span></td>
        <td class="rup-c-etat"><span class="rup-file rup-file-${esc(file.ton)}">${esc(file.libelle)}</span>${
          file.sous ? `<small class="rup-file-sous">${esc(file.sous)}</small>` : ''
        }</td>
        <td class="rup-c-depuis">${ageMarkup(d.creeLe, d.etat === 'RESOLU')}</td>
        <td class="rup-c-act"><span class="rup-gestes">${mailDeLaLigne(d)}${decisionDeLaLigne(d)}</span></td>
      </tr>`;
    })
    .join('');

  corps.querySelectorAll('[data-rup]').forEach((ligne) => {
    const ouvrir = () => ouvrirRupture(ligne.dataset.rup);
    ligne.addEventListener('click', (event) => {
      // Les boutons de la ligne font leur geste, sans ouvrir le dossier en plus.
      if (event.target.closest('button')) return;
      ouvrir();
    });
    // Une ligne cliquable qui ne répond pas au clavier exclut ceux qui n'ont
    // pas de souris : la table est le seul chemin vers le dossier.
    ligne.addEventListener('keydown', (event) => {
      if (event.target !== ligne) return;
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        ouvrir();
      }
    });
  });

  const dossier = (id) => r.dossiers.find((candidat) => candidat.id === id);
  corps.querySelectorAll('[data-rup-mail]').forEach((bouton) =>
    bouton.addEventListener('click', () => void ouvrirMailRupture(dossier(bouton.dataset.rupMail))),
  );
  corps.querySelectorAll('[data-rup-traiter]').forEach((bouton) =>
    bouton.addEventListener('click', () => ouvrirReponseAtelier(dossier(bouton.dataset.rupTraiter))),
  );
  corps.querySelectorAll('[data-rup-ouvrir]').forEach((bouton) =>
    bouton.addEventListener('click', () => ouvrirRupture(bouton.dataset.rupOuvrir)),
  );
}

/*
 * Les modèles en rupture, et combien de fois, sur quatre-vingt-dix jours.
 *
 * Le même modèle qui manque trois fois n'est plus une rupture : c'est une
 * référence à retirer, ou à commander autrement. La liste le dit avant
 * qu'un quatrième client ne le découvre.
 */
function renderRuptureModeles() {
  const modeles = state.ruptures.modeles ?? [];
  const boite = $('rup-modeles');
  boite.hidden = modeles.length === 0;
  if (!modeles.length) return (boite.innerHTML = '');

  const image = new Map(
    state.ruptures.dossiers
      .filter((d) => d.article?.image && d.article?.titre)
      .map((d) => [d.article.titre.toLowerCase(), d.article.image]),
  );
  boite.innerHTML = `<div class="rup-modeles-t"><h2>Modèles en rupture</h2><span>90 jours</span></div>
    ${modeles
      .map((modele) => {
        const depuis = formatSpan(Date.now() - new Date(modele.derniereLe).getTime());
        const detail = [
          modele.variante,
          modele.deuxiemeChoix ? `dont ${modele.deuxiemeChoix} en 2e choix` : `dernière il y a ${depuis}`,
        ]
          .filter(Boolean)
          .join(' · ');
        const vignette = image.get(modele.nom.toLowerCase());
        return `<button class="rup-modele" type="button" data-rup-modele="${esc(modele.nom)}">
          ${vignette ? `<img src="${esc(vignette)}" alt="" loading="lazy" />` : '<span class="rup-blank" aria-hidden="true"></span>'}
          <span class="rup-modele-txt"><b>${esc(modele.nom)}</b><small>${esc(detail)}</small></span>
          <span class="rup-modele-n"><b>${modele.fois}</b><small>fois</small></span>
        </button>`;
      })
      .join('')}`;
}

function renderRupturePager(total, pages) {
  const r = state.ruptures;
  const boite = $('rup-pager');
  // Une page suffit le plus souvent : la barre n'apparaît que s'il y en a plusieurs.
  boite.hidden = pages <= 1;
  if (pages <= 1) return;

  const debut = (r.page - 1) * r.taille + 1;
  const fin = Math.min(total, r.page * r.taille);

  boite.innerHTML = `
    <span>${debut}–${fin} sur ${total}</span>
    <span class="rup-pages">
      <button class="btn btn-small" type="button" id="rup-prev"${
        r.page === 1 ? ' disabled' : ''
      } aria-label="Page précédente">${ico('prec')}</button>
      <span>${r.page} / ${pages}</span>
      <button class="btn btn-small" type="button" id="rup-next"${
        r.page >= pages ? ' disabled' : ''
      } aria-label="Page suivante">${ico('suiv')}</button>
    </span>`;

  $('rup-prev').addEventListener('click', () => {
    r.page -= 1;
    renderRuptures();
  });
  $('rup-next').addEventListener('click', () => {
    r.page += 1;
    renderRuptures();
  });
}

/* ---- le panneau de droite ---- */

/* Sur téléphone, le dossier se pousse en plein écran, comme une commande. */
const PILE_RUPTURES = window.matchMedia('(max-width: 900px)');
let defilementRuptures = 0;

function ouvrirRupture(id) {
  const r = state.ruptures;
  const change = r.courant !== id;
  r.courant = id;
  // Les alternatives appartiennent au dossier ouvert : les garder d'un dossier
  // à l'autre proposerait la chaussure d'un autre client.
  if (change) r.alternatives = null;
  renderRuptures();
  ouvrirPileRupture();
}

function ouvrirPileRupture() {
  const vue = $('view-ruptures');
  if (!PILE_RUPTURES.matches || !vue) return;
  if (!vue.classList.contains('pile-fiche')) {
    defilementRuptures = scrollY;
    vue.classList.add('pile-fiche');
    history.pushState({ csavRupture: true }, '');
  }
  requestAnimationFrame(() => scrollTo(0, 0));
}

function fermerPileRupture({ parHistorique = false } = {}) {
  const vue = $('view-ruptures');
  if (!vue?.classList.contains('pile-fiche')) return;
  vue.classList.remove('pile-fiche');
  if (!parHistorique && history.state?.csavRupture) history.back();
  requestAnimationFrame(() => scrollTo(0, defilementRuptures));
}

addEventListener('popstate', () => fermerPileRupture({ parHistorique: true }));

/*
 * Ce que l'atelier a écrit, sans ce que le dossier dit déjà.
 *
 * Son message porte l'article en champs — relus et affichés en tête du
 * dossier — puis sa note libre : « réassort dans dix jours ». C'est elle qui
 * appelle une réponse ; la répéter sous les champs qu'on vient de lire
 * noierait la seule phrase qui compte.
 */
function noteDuSignalement(texte) {
  if (!texte) return null;
  const note = String(texte)
    .split('\n')
    .filter((ligne) => !/^Signalé par .+ depuis l'atelier\.$/.test(ligne.trim()))
    .filter((ligne) => !/^(Article|Couleur|Taille|Référence|Quantité) : /.test(ligne))
    .join('\n')
    .trim();
  return note || null;
}

/** « à 11:40 » aujourd'hui, « le 14 oct. à 11:40 » avant. */
function quandConsigne(iso) {
  const date = new Date(iso);
  const heure = date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  return date.toDateString() === new Date().toDateString()
    ? `à ${heure}`
    : `le ${date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })} à ${heure}`;
}

const consigneCouranteDe = (d) => {
  const derniere = d.consignes?.at(-1);
  return derniere && !derniere.remplaceeLe ? derniere : null;
};

/** La consigne en clair, côté marchand : ce qu'on a demandé, et ce qui le précise. */
function resumeConsigne(consigne) {
  const modeles = consigne.modeles ?? [];
  const nom = (modele) => [modele.productTitle, modele.variantTitle].filter(Boolean).join(' · ');
  const retenu = typeof consigne.modeleChoisi === 'number' ? modeles[consigne.modeleChoisi] : null;
  const detail = {
    ATTENDRE: consigne.expedierAvant ? `Au plus tard le ${dateConsigneFr(consigne.expedierAvant, true)}.` : '',
    REMPLACER: retenu ? `Il expédie : ${nom(retenu)}.` : modeles.map(nom).join(' ou '),
    ANNULER: consigne.textes?.fr?.detail ?? '',
    MESSAGE: '',
  }[consigne.choix];
  return { titre: CONSIGNE_NOMS[consigne.choix] ?? consigne.choix, detail };
}

/** Où en est la consigne, en une ligne de couleur. */
function suiviConsigne(consigne, atelier) {
  const qui = atelier ?? 'L’atelier';
  if (consigne.etat === 'COMPRISE') return { ton: 'ok', texte: `${qui} a confirmé ${quandConsigne(consigne.reponduLe)}` };
  if (consigne.etat === 'IMPOSSIBLE') return { ton: 'crit', texte: `${qui} ne pourra pas — répondu ${quandConsigne(consigne.reponduLe)}` };
  if (consigne.etat === 'REPONDUE') return { ton: 'ok', texte: `${qui} a répondu ${quandConsigne(consigne.reponduLe)}` };
  return { ton: 'warn', texte: `Envoyée ${quandConsigne(consigne.envoyeeLe)} · en attente de sa confirmation` };
}

/* Sa réponse écrite, en français ; l'original à côté quand il a écrit dans sa langue. */
function noteDeLAtelier(consigne) {
  if (!consigne.reponseNote) return '';
  const francais = consigne.reponseNoteFr && consigne.reponseNoteFr !== consigne.reponseNote;
  return `<p class="rup-ra-note">« ${esc(francais ? consigne.reponseNoteFr : consigne.reponseNote)} »</p>${
    francais ? `<p class="rup-ra-orig">Traduit · il a écrit : ${esc(consigne.reponseNote)}</p>` : ''
  }`;
}

/*
 * « Réponse à l'atelier » : ce qu'il attend de nous, ou ce qu'on lui a dit et
 * ce qu'il en a fait.
 */
function reponseAtelierMarkup(d) {
  const atelier = d.fournisseur?.name ?? null;
  if (!d.fournisseur) {
    return '<p class="empty">Aucun atelier n’est rattaché à ce dossier.</p>';
  }
  const consigne = consigneCouranteDe(d);
  if (!consigne) {
    if (d.etat === 'RESOLU') return '<p class="empty">Dossier clos sans réponse à l’atelier.</p>';
    return `<div class="rup-ra rup-ra-attend">
      <p>${esc(atelier)} attend votre décision pour cette commande.</p>
      <button class="btn btn-primary" type="button" data-rup-repondre="1">À traiter</button>
      <button class="linkish" type="button" data-rup-ecrire="1">Écrire à l’atelier</button>
    </div>`;
  }

  const { titre, detail } = resumeConsigne(consigne);
  const suivi = suiviConsigne(consigne, atelier);
  const relancer = consigne.etat === 'IMPOSSIBLE' || consigne.etat === 'REPONDUE';
  return `<div class="rup-ra">
    <div class="rup-ra-tete"><b>${esc(titre)}</b>${
      relancer ? '' : '<button class="linkish" type="button" data-rup-repondre="1">Modifier</button>'
    }</div>
    ${detail ? `<span class="rup-ra-detail">${esc(detail)}</span>` : ''}
    ${consigne.mot ? `<p class="rup-ra-mot">« ${esc(consigne.mot)} »</p>` : ''}
    <span class="rup-ra-suivi rup-ra-${suivi.ton}">${esc(suivi.texte)}</span>
    ${noteDeLAtelier(consigne)}
    ${
      relancer
        ? '<button class="btn btn-primary" type="button" data-rup-repondre="1">À traiter</button>'
        : ''
    }
    <button class="linkish rup-ra-ecrire" type="button" data-rup-ecrire="1">Écrire à l’atelier</button>
  </div>`;
}

/* Ce qu'on dit de la cliente : ce qu'elle sait, et ce qu'il faudrait lui proposer. */
function texteCliente(d) {
  const nom = d.client?.nom ?? 'Le client';
  const consigne = consigneCouranteDe(d);
  if (d.etat === 'RESOLU') return 'Dossier clos.';
  if (consigne?.choix === 'ATTENDRE' && consigne.expedierAvant) {
    return `Lui proposer d’attendre jusqu’au ${dateConsigneFr(consigne.expedierAvant, true)}, ou un remboursement.`;
  }
  if (consigne?.choix === 'ANNULER') return `Lui proposer un autre modèle, ou la rembourser.`;
  if (d.etat === 'CLIENT_A_PREVENIR') return `${nom} n’a pas encore reçu de réponse.`;
  if (d.etat === 'REMBOURSEMENT') return 'Un remboursement est engagé.';
  return d.synthese?.[1] ?? d.synthese?.[0] ?? '';
}

function renderRupturePanneau() {
  const r = state.ruptures;
  const panneau = $('rup-panel');
  const d = r.dossiers.find((dossier) => dossier.id === r.courant);

  panneau.hidden = !d;
  if (!d) {
    // Plus de dossier : un téléphone resté en plein écran montrerait du vide.
    fermerPileRupture();
    return (panneau.innerHTML = '');
  }

  const argent = (montant) =>
    typeof montant === 'number' ? money(montant, d.commande?.devise ?? 'EUR') : '—';
  const article = d.article;
  const note = d.origine === 'atelier' ? noteDuSignalement(d.signalement) : null;
  const sousTitre = [
    article?.variante,
    article?.sku,
    article ? `${article.quantite} article${article.quantite > 1 ? 's' : ''}` : null,
  ].filter(Boolean);

  panneau.innerHTML = `
    <div class="rup-panel-head">
      <button class="rup-retour" type="button" id="rup-retour">${ico('prec')}Ruptures</button>
      <span class="rup-file rup-file-${esc(fileDe(d).ton)}">${esc(fileDe(d).libelle)}</span>
      <button class="ico-btn rup-fermer" type="button" id="rup-close" aria-label="Fermer le panneau">${ico('close')}</button>
    </div>

    <!-- Le produit d'abord : c'est de lui qu'on parle, et c'est lui qu'on
         reconnaît d'un coup d'œil. -->
    <div class="rup-tete">
      ${
        article?.image
          ? `<img src="${esc(article.image)}" alt="" loading="lazy" />`
          : '<span class="rup-blank" aria-hidden="true"></span>'
      }
      <span class="rup-tete-txt">
        <b>${esc(article?.titre ?? (d.origine === 'atelier' ? 'Article non précisé' : 'Article non lu'))}</b>
        ${sousTitre.length ? `<span>${esc(sousTitre.join(' · '))}</span>` : ''}
        <span>${esc(
          [`Commande ${d.commande?.nom ?? '—'}`, d.client?.nom ?? d.client?.email].filter(Boolean).join(' · '),
        )}</span>
      </span>
    </div>

    ${
      note
        ? `<div class="rup-sec">
             <h3>L’atelier a écrit</h3>
             <div class="rup-carte">
               <p class="rup-dit">« ${esc(note)} »</p>
               <small>${esc(`${d.fournisseur?.name ?? 'L’atelier'} · ${quandConsigne(d.creeLe).replace(/^à /, 'aujourd’hui à ')}`)}</small>
             </div>
           </div>`
        : ''
    }

    <div class="rup-sec">
      <h3>Le dossier</h3>
      ${datesDuDossier(d)}
    </div>

    <div class="rup-sec">
      <h3>Réponse à l’atelier</h3>
      ${reponseAtelierMarkup(d)}
      <div id="rup-subs"></div>
    </div>

    <div class="rup-sec">
      <h3>Client</h3>
      <div class="rup-carte rup-client">
        <span class="rup-client-txt">
          <b>${esc(d.client?.nom ?? d.client?.email ?? 'Client inconnu')}</b>
          ${d.client?.nom && d.client?.email ? `<small>${esc(d.client.email)}</small>` : ''}
          ${d.client?.telephone ? `<small>${esc(d.client.telephone)}</small>` : ''}
          <span>${esc(texteCliente(d))}</span>
        </span>
        ${
          // Sans adresse connue, écrire mènerait à un refus au clic.
          d.origine === 'atelier' && !d.client?.email
            ? ''
            : '<button class="btn btn-small" type="button" data-rup-act="client">Écrire au client</button>'
        }
      </div>
      <div id="rup-alts"></div>
    </div>

    <div class="rup-sec">
      <h3>Commande</h3>
      <div class="rup-line"><span>Numéro</span><span>${esc(d.commande?.nom ?? '—')}</span></div>
      <div class="rup-line"><span>Montant</span><span>${esc(argent(d.commande?.total))}</span></div>
      <div class="rup-line"><span>Commandes impactées</span><span>${d.commandesImpactees}</span></div>
      ${
        d.commandesImpactees > 1 && d.article?.sku
          ? `<button class="linkish" type="button" id="rup-meme-sku">Voir les ${
              d.commandesImpactees
            } commandes concernées</button>`
          : ''
      }
      ${d.commande?.shopifyId ? shopifyOrderLink({ id: d.commande.shopifyId }, 'Voir la commande') : ''}
    </div>

    <div class="rup-sec">
      <div class="rup-actions" id="rup-actions"></div>
    </div>`;

  $('rup-close').addEventListener('click', () => {
    r.courant = null;
    renderRuptures();
  });
  $('rup-retour').addEventListener('click', () => fermerPileRupture());

  $('rup-meme-sku')?.addEventListener('click', () => {
    // Traiter la cause plutôt que huit fois le symptôme : la recherche par SKU
    // rassemble en une vue toutes les commandes que la même référence bloque.
    r.q = d.article.sku;
    r.vue = 'tous';
    r.page = 1;
    $('rup-q').value = r.q;
    fermerPileRupture();
    renderRuptures();
  });

  panneau.querySelectorAll('[data-rup-repondre]').forEach((bouton) =>
    bouton.addEventListener('click', () => ouvrirReponseAtelier(d)),
  );
  panneau.querySelectorAll('[data-rup-ecrire]').forEach((bouton) =>
    bouton.addEventListener('click', () => ouvrirReponseAtelier(d, { choix: 'MESSAGE' })),
  );
  panneau.querySelector('[data-rup-act="client"]')?.addEventListener('click', () => ecrireAuClientDepuisRupture(d));

  renderRuptureActions(d);
  renderRuptureAlternatives(d);
  void chargerSubstitutions(d);
}

/* ---- les remplacements proposés avant les consignes ---- */

/*
 * Les modèles proposés à l'atelier avec l'ancienne fenêtre, et sa réponse.
 *
 * On n'en propose plus ainsi — « Remplacer » est une des quatre réponses —
 * mais ceux déjà envoyés restent lisibles, avec ce que l'atelier en a dit.
 */
async function chargerSubstitutions(d) {
  const boite = $('rup-subs');
  if (!boite) return;

  try {
    const { propositions } = await api(`/api/ruptures/${d.ticketId}/substitutions`);
    boite.innerHTML = propositions.length
      ? `<span class="rup-subs-t">Remplacements proposés</span>` +
        propositions
          .map((proposition) => {
            const details = [proposition.variantTitle, proposition.sku].filter(Boolean).join(' · ');
            const etat =
              proposition.accepte === true
                ? '<span class="rup-sub-ok">peut l’envoyer</span>'
                : proposition.accepte === false
                  ? '<span class="rup-sub-ko">impossible</span>'
                  : '<span class="rup-sub-wait">en attente</span>';
            return `<div class="rup-line rup-sub-line">
              <span>${esc(proposition.productTitle)}${details ? ` <small>${esc(details)}</small>` : ''}</span>
              ${etat}
            </div>${
              proposition.note ? `<p class="rup-message">${esc(proposition.note)}</p>` : ''
            }`;
          })
          .join('')
      : '';
  } catch {
    boite.innerHTML = '';
  }
}

/* ---- répondre à l'atelier ---- */

/*
 * Les quatre réponses, côté marchand : ce qu'on demande, à l'infinitif.
 * L'atelier lit la même consigne à l'impératif et dans sa langue ; c'est le
 * serveur qui l'écrit (`consigneTexte.ts`).
 */
const CONSIGNE_NOMS = {
  ATTENDRE: 'Attendre le réassort, puis expédier',
  REMPLACER: 'Remplacer par un autre modèle',
  ANNULER: 'Ne pas expédier cet article',
  MESSAGE: 'Message à l’atelier',
};

/*
 * « Ce que verra l'atelier » : la consigne sur une ligne, dans sa langue.
 * Copie des lignes courtes de `consigneTexte.ts`, que les tests comparent :
 * l'aperçu doit dire exactement ce qui arrivera.
 */
const CONSIGNE_APERCU = {
  fr: {
    locale: 'fr-FR',
    ATTENDRE: (date) => `Attendre le réassort · au plus tard le ${date}`,
    REMPLACER: (ref) => `Expédier ${ref} à la place`,
    ANNULER: () => 'Ne pas expédier cet article',
    MESSAGE: () => 'Message du marchand',
    ou: ' ou ',
  },
  en: {
    locale: 'en-GB',
    ATTENDRE: (date) => `Wait for restock · by ${date}`,
    REMPLACER: (ref) => `Ship ${ref} instead`,
    ANNULER: () => 'Do not ship this item',
    MESSAGE: () => 'Message from the merchant',
    ou: ' or ',
  },
  zh: {
    locale: 'zh-CN',
    ATTENDRE: (date) => `等补货 · 最迟 ${date}`,
    REMPLACER: (ref) => `改发 ${ref}`,
    ANNULER: () => '此商品不要发货',
    MESSAGE: () => '商家留言',
    ou: ' 或 ',
  },
};
const LANGUE_ATELIER_NOM = { en: 'anglais', zh: 'chinois' };

/** Une date « 2026-10-26 » se lit le même jour partout : posée à midi UTC. */
function dateConsigneFr(valeur, longue = false, locale = 'fr-FR') {
  const jour = String(valeur).slice(0, 10);
  return new Date(`${jour}T12:00:00Z`).toLocaleDateString(locale, {
    day: 'numeric',
    month: longue ? 'long' : 'short',
    timeZone: 'UTC',
  });
}

/** « 2026-10-26 » décalé de n jours. */
function decalerJour(jour, n) {
  const date = new Date(`${jour}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + n);
  return date.toISOString().slice(0, 10);
}

const aujourdhuiIso = () => {
  const maintenant = new Date();
  return `${maintenant.getFullYear()}-${String(maintenant.getMonth() + 1).padStart(2, '0')}-${String(
    maintenant.getDate(),
  ).padStart(2, '0')}`;
};

/*
 * La date proposée : celle que l'atelier a annoncée.
 *
 * « Réassort prévu dans 10 jours » donne dix jours après son message : c'est
 * le délai qu'il s'est donné, et le seul qu'on puisse lui demander de tenir.
 * Sans délai lisible, une semaine.
 */
function delaiAnnonce(d) {
  const note = noteDuSignalement(d.signalement) ?? '';
  const jours = /(\d{1,3})\s*(?:jours?|j\b)/i.exec(note);
  const semaines = /(\d{1,2})\s*semaines?/i.exec(note);
  if (jours) return { jours: Number(jours[1]), annonce: true };
  if (semaines) return { jours: Number(semaines[1]) * 7, annonce: true };
  return { jours: 7, annonce: false };
}

const fenRa = {
  dossier: null,
  choix: 'REMPLACER',
  date: '',
  aideDate: '',
  /** Restock : relancer le client dans tant de jours. */
  relance: 10,
  /** Le modèle de remplacement : un seul, choisi au catalogue ou tapé tel quel. */
  choisis: [],
  saisie: '',
  options: null,
  optionsErreur: null,
  /** Le catalogue pour le nom tapé — ou, champ vide, pour le modèle en rupture. */
  catalogue: [],
  rechercheCatalogue: 0,
  supplierId: null,
  depuisTicket: false,
  envoi: false,
};

/* Les trois décisions, et l'écriture libre ; ce que dit le pied de la fenêtre pour chacune. */
const PIED_RA = {
  REMPLACER: 'Rien ne part au client : le mail est sur la ligne.',
  ANNULER: 'L’administration le voit dans Annulation/Remboursement.',
  ATTENDRE: 'Alerte à l’atelier et à l’équipe le jour de la relance.',
  MESSAGE: 'Rien ne part au client.',
};

/**
 * Ouvre la fenêtre « À traiter » sur un dossier.
 *
 * Elle reprend la décision en cours quand il y en a une : « Modifier » doit
 * repartir de ce qu'on a dit, pas d'une page blanche.
 */
function ouvrirReponseAtelier(d, options = {}) {
  if (!d) return;
  const courante = consigneCouranteDe(d);
  const delai = delaiAnnonce(d);
  const depart = d.creeLe ? new Date(d.creeLe) : new Date();
  const proposee = decalerJour(
    `${depart.getFullYear()}-${String(depart.getMonth() + 1).padStart(2, '0')}-${String(depart.getDate()).padStart(2, '0')}`,
    delai.jours,
  );
  /* Un modèle qui manquait aussi ne se repropose pas : la fenêtre repart vide
     sur « Modifier le modèle », pour en choisir un autre. */
  const reprendre = courante && courante.etat !== 'IMPOSSIBLE';

  Object.assign(fenRa, {
    dossier: d,
    choix: options.choix ?? (reprendre ? courante.choix : 'REMPLACER'),
    date:
      reprendre && courante.choix === 'ATTENDRE' && courante.expedierAvant
        ? String(courante.expedierAvant).slice(0, 10)
        : proposee < aujourdhuiIso()
          ? decalerJour(aujourdhuiIso(), 1)
          : proposee,
    aideDate: delai.annonce
      ? `${delai.jours} jours après son signalement, comme il l’a annoncé.`
      : 'Une semaine, faute de délai annoncé.',
    relance: 10,
    choisis:
      reprendre && courante.choix === 'REMPLACER'
        ? (courante.modeles ?? []).slice(0, 1).map((modele, rang) => ({ ...modele, cle: `courant-${rang}` }))
        : [],
    saisie: '',
    options: null,
    optionsErreur: null,
    catalogue: [],
    chercheCatalogue: false,
    supplierId: options.supplierId ?? null,
    depuisTicket: Boolean(options.depuisTicket),
    envoi: false,
  });

  const atelier = d.fournisseur?.name ?? options.atelier ?? 'l’atelier';
  const langue = d.fournisseur?.langue ?? 'fr';
  fenRa.atelier = atelier;
  const ecrire = fenRa.choix === 'MESSAGE';
  $('ra-title').textContent = ecrire
    ? `Écrire à ${atelier}`
    : `À traiter${d.commande?.nom ? ` · ${d.commande.nom}` : ''}`;
  $('ra-sub').textContent = [
    d.client?.nom,
    atelier,
    langue in LANGUE_ATELIER_NOM ? `traduit en ${LANGUE_ATELIER_NOM[langue]} pour l’atelier` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  // Écrire n'est pas une décision : les trois tuiles n'ont rien à y faire.
  $('ra-choix').closest('section').hidden = ecrire;

  const article = d.article;
  const note = noteDuSignalement(d.signalement);
  $('ra-contexte').innerHTML = `
    ${article?.image ? `<img src="${esc(article.image)}" alt="" loading="lazy" />` : '<span class="rup-blank" aria-hidden="true"></span>'}
    <span class="ra-contexte-txt">
      <b>${esc(article?.titre ?? 'Article non précisé')}</b>
      <small>${esc([article?.variante, article?.sku].filter(Boolean).join(' · ') || (d.commande?.nom ? `commande ${d.commande.nom}` : ''))}</small>
    </span>
    ${note ? `<span class="ra-contexte-dit">« ${esc(note)} »</span>` : ''}`;

  $('ra-mot').value = '';
  $('ra-nom').value = '';
  majReponseAtelier();

  $('ra-modal').hidden = false;
  $('ra-modal').classList.add('open');
  // Le choix en cours prend le focus : au clavier, les flèches changent de
  // réponse. Pas au doigt : un anneau de focus sur une feuille d'iPhone ne
  // signale rien.
  if (window.matchMedia('(hover: hover)').matches) {
    requestAnimationFrame(() =>
      (ecrire ? $('ra-mot') : $('ra-choix').querySelector('[aria-checked="true"]'))?.focus(),
    );
  }

  void chargerOptionsRemplacement(d);
  void chercherCatalogue();
}

/*
 * Le catalogue Shopify, cherché pendant qu'on tape.
 *
 * Champ vide, on cherche la gamme du modèle en rupture — « Nike Mind » pour
 * « Nike Mind 001 Blackened Blue » : la liste est pleine dès le clic, avec
 * les autres coloris et pointures. Chaque frappe relance, après un court
 * temps mort ; une réponse arrivée trop tard ne remplace pas une plus récente.
 */
let minuteurCatalogue = 0;
function chercherCatalogue({ apres = 0 } = {}) {
  clearTimeout(minuteurCatalogue);
  minuteurCatalogue = setTimeout(async () => {
    const d = fenRa.dossier;
    if (!d) return;
    const gamme = (d.article?.titre ?? '').split(/\s+/).slice(0, 2).join(' ');
    const terme = fenRa.saisie.trim() || gamme;
    const tour = ++fenRa.rechercheCatalogue;
    if (!terme) return;
    fenRa.chercheCatalogue = true;
    try {
      const { options } = await api(`/api/catalogue/variantes?q=${encodeURIComponent(terme)}`);
      if (tour !== fenRa.rechercheCatalogue || fenRa.dossier !== d) return;
      fenRa.catalogue = options ?? [];
    } catch {
      if (tour === fenRa.rechercheCatalogue) fenRa.catalogue = [];
    }
    if (tour === fenRa.rechercheCatalogue) fenRa.chercheCatalogue = false;
    majReponseAtelier();
  }, apres);
}

/* Les modèles en stock, cherchés une fois par ouverture : le même croisement
   commande → catalogue que l'écran SAV. */
async function chargerOptionsRemplacement(d) {
  try {
    const data = await api(`/api/tickets/${d.ticketId}/substitutions`);
    if (fenRa.dossier !== d) return;
    fenRa.options = data.options ?? [];
    fenRa.optionsErreur = fenRa.options.length ? null : (data.reason ?? 'Aucune référence équivalente en stock.');
  } catch (error) {
    if (fenRa.dossier !== d) return;
    fenRa.options = [];
    fenRa.optionsErreur = error.message;
  }
  majReponseAtelier();
}

/*
 * Le stock d'une déclinaison, tel qu'on peut l'affirmer.
 *
 * Un `0` ne veut pas dire « épuisé » : une boutique qui ne suit pas ses
 * stocks — le cas du dropshipping — reçoit zéro pour tout le catalogue, et
 * chaque modèle s'affichait « épuisé ». Seul Shopify dit qu'un article ne se
 * vend plus (`availableForSale`) ; un stock positif se montre, le reste se tait.
 */
function mentionStock(option) {
  if ((option?.inventoryQuantity ?? 0) > 0) return `${option.inventoryQuantity} en stock`;
  return option?.availableForSale === false ? 'épuisé' : '';
}

/** Ce qui manque pour valider, ou rien. */
function manqueReponseAtelier() {
  if (fenRa.choix === 'ATTENDRE' && (!fenRa.date || fenRa.date < aujourdhuiIso())) return 'Choisissez une date à venir.';
  if (fenRa.choix === 'REMPLACER' && fenRa.choisis.length === 0) return 'Choisissez le modèle, ou tapez son nom.';
  if (fenRa.choix === 'MESSAGE' && !$('ra-mot').value.trim()) return 'Écrivez votre message.';
  return null;
}

function apercuReponseAtelier() {
  const langue = fenRa.dossier?.fournisseur?.langue ?? 'fr';
  const mots = CONSIGNE_APERCU[langue] ?? CONSIGNE_APERCU.fr;
  if (fenRa.choix === 'ATTENDRE') return mots.ATTENDRE(dateConsigneFr(fenRa.date, false, mots.locale));
  if (fenRa.choix === 'REMPLACER') {
    const refs = fenRa.choisis.map((modele) => modele.sku || [modele.productTitle, modele.variantTitle].filter(Boolean).join(' · '));
    return refs.length ? mots.REMPLACER(refs.join(mots.ou)) : mots.REMPLACER('…');
  }
  return mots[fenRa.choix]();
}

/*
 * Les modèles proposés pour le nom tapé.
 *
 * Chaque mot tapé doit se retrouver dans le modèle, sa déclinaison ou sa
 * référence : « halo 39 » trouve « Runner Halo · Noir · 39 ». Sans saisie,
 * les premiers modèles en stock, ceux que le catalogue rapproche déjà.
 */
function suggestionsRemplacement() {
  // Champ vide : la gamme du modèle en rupture sert de filtre — la liste
  // propose ses autres coloris et pointures, pas tout le catalogue.
  const gamme = (fenRa.dossier?.article?.titre ?? '').split(/\s+/).slice(0, 2).join(' ');
  const mots = (fenRa.saisie.trim() || gamme).toLowerCase().split(/\s+/).filter(Boolean);
  // Les équivalents de la commande d'abord, puis le catalogue — sans doublon.
  const vus = new Set();
  return [...(fenRa.options ?? []), ...(fenRa.catalogue ?? [])]
    .filter((option) => {
      if (vus.has(option.id)) return false;
      vus.add(option.id);
      const texte = [option.productTitle, option.variantTitle, option.sku].filter(Boolean).join(' ').toLowerCase();
      return mots.every((mot) => texte.includes(mot));
    })
    .slice(0, 8);
}

function majReponseAtelier() {
  const d = fenRa.dossier;
  if (!d) return;

  $('ra-choix').querySelectorAll('[data-ra-choix]').forEach((tuile) => {
    const on = tuile.dataset.raChoix === fenRa.choix;
    tuile.setAttribute('aria-checked', String(on));
    tuile.tabIndex = on ? 0 : -1;
  });
  $('ra-attendre').hidden = fenRa.choix !== 'ATTENDRE';
  $('ra-remplacer').hidden = fenRa.choix !== 'REMPLACER';
  $('ra-annuler').hidden = fenRa.choix !== 'ANNULER';

  /* Restock : la date d'expédition, puis la relance du client. */
  $('ra-date').value = fenRa.date;
  $('ra-date').min = aujourdhuiIso();
  $('ra-date-aide').textContent = fenRa.aideDate;
  $('ra-relances').querySelectorAll('[data-ra-relance]').forEach((bouton) => {
    bouton.setAttribute('aria-checked', String(Number(bouton.dataset.raRelance) === fenRa.relance));
  });
  $('ra-relance-le').innerHTML = `Relance du client le <b>${esc(
    dateConsigneFr(decalerJour(aujourdhuiIso(), fenRa.relance), true),
  )}</b>.`;

  /* Modifier le modèle : le catalogue d'abord, puis le nom tapé tel quel. */
  const choisi = fenRa.choisis[0] ?? null;
  const suggestions = suggestionsRemplacement();
  const tousLesModeles = [...(fenRa.options ?? []), ...(fenRa.catalogue ?? [])];
  const saisie = fenRa.saisie.trim();
  const ligne = (option) => {
    const on = choisi?.cle === option.id;
    return `<button class="ra-sug" type="button" role="option" aria-selected="${on}" data-ra-opt="${esc(option.id)}">
      ${option.image ? `<img src="${esc(option.image)}" alt="" loading="lazy" />` : '<span class="rup-blank" aria-hidden="true"></span>'}
      <span class="ra-sug-txt">
        <b>${esc([option.productTitle, option.variantTitle].filter(Boolean).join(' · '))}</b>
        ${option.sku ? `<small>${esc(option.sku)}</small>` : ''}
      </span>
      <span class="ra-sug-stock${option.availableForSale === false ? ' ra-sug-epuise' : ''}">${esc(mentionStock(option))}</span>
      <span class="ra-sug-coche" aria-hidden="true">${on ? ico('check') : ''}</span>
    </button>`;
  };
  const horsCatalogue =
    choisi && !tousLesModeles.some((option) => option.id === choisi.cle)
      ? `<button class="ra-sug" type="button" role="option" aria-selected="true" data-ra-libre="1">
          <span class="rup-blank" aria-hidden="true"></span>
          <span class="ra-sug-txt"><b>${esc([choisi.productTitle, choisi.variantTitle].filter(Boolean).join(' · '))}</b>
            <small>${esc(choisi.sku || 'hors catalogue')}</small></span>
          <span class="ra-sug-coche" aria-hidden="true">${ico('check')}</span>
        </button>`
      : '';
  const telQuel =
    saisie && !(choisi?.libre && choisi.productTitle === saisie)
      ? `<button class="ra-sug" type="button" role="option" aria-selected="false" data-ra-tel-quel="1">
          <span class="rup-blank" aria-hidden="true"></span>
          <span class="ra-sug-txt"><b>Utiliser « ${esc(saisie)} » tel quel</b>
            <small>un modèle que l’atelier a sous la main</small></span>
        </button>`
      : '';
  const liste =
    suggestions.map(ligne).join('') ||
    (fenRa.options === null || fenRa.chercheCatalogue
      ? saisie
        ? ''
        : '<p class="empty">Recherche dans le catalogue…</p>'
      : `<p class="empty">${esc(fenRa.optionsErreur ?? 'Aucun modèle à proposer.')}</p>`);
  $('ra-options').innerHTML = horsCatalogue + liste + telQuel;

  const client = d.client?.nom ?? 'le client';
  const article = [d.article?.titre, d.article?.variante].filter(Boolean).join(' · ') || 'L’article';
  $('ra-annuler-texte').innerHTML = `<b>${esc(article)}</b>
    <ol>
      <li>${esc(fenRa.atelier ?? 'L’atelier')} est prévenu : il n’expédie pas cet article.</li>
      <li>Une ligne « À rembourser » s’ajoute dans Annulation/Remboursement, pour l’administration.</li>
      <li>Le remboursement de ${esc(client)} se fait de là, en un clic, dans Shopify.</li>
    </ol>`;

  const message = fenRa.choix === 'MESSAGE';
  $('ra-mot-t').textContent = message ? 'Votre message' : 'Un mot pour l’atelier (facultatif)';
  $('ra-mot').placeholder = message
    ? 'Par exemple : pouvez-vous vérifier le stock dans la taille au-dessus ?'
    : 'Traduit pour l’atelier.';
  $('ra-apercu').textContent = apercuReponseAtelier();

  const manque = manqueReponseAtelier();
  $('ra-pied').textContent = manque ?? PIED_RA[fenRa.choix];
  $('ra-pied').classList.toggle('ra-pied-manque', Boolean(manque));
  $('ra-envoyer').textContent = message ? 'Envoyer' : 'Valider';
  $('ra-envoyer').disabled = Boolean(manque) || fenRa.envoi;
}

function fermerReponseAtelier() {
  $('ra-modal').hidden = true;
  $('ra-modal').classList.remove('open');
  fenRa.dossier = null;
}

/**
 * « Rupture » choisi dans « Contacter le fournisseur ».
 *
 * La rupture se dit en consigne, pas en phrase : on ouvre la fenêtre des
 * quatre réponses sur « Remplacer », adressée à l'atelier choisi. L'envoi
 * ouvre le dossier côté serveur.
 */
function ouvrirRuptureDepuisFenetre() {
  const ticketId = $('alert-modal').dataset.ticket;
  const supplierId = $('alert-supplier').value || $('alert-modal').dataset.supplier;
  if (!ticketId) return;
  if (!supplierId) {
    toast('Choisissez le fournisseur destinataire.', true);
    return;
  }

  const item = state.detail?.order?.lineItems?.[0];
  const atelier = $('alert-supplier').selectedOptions?.[0]?.textContent?.trim() || null;
  closeAlertModal();
  ouvrirReponseAtelier(
    {
      ticketId,
      creeLe: new Date().toISOString(),
      commande: { nom: state.detail?.ticket?.orderName ?? null },
      client: { nom: state.detail?.ticket?.customerName ?? null },
      article: item
        ? { titre: item.title, variante: item.variantTitle, sku: item.sku, image: item.image ?? null }
        : null,
      consignes: [],
    },
    { supplierId, depuisTicket: true, choix: 'REMPLACER', atelier },
  );
}

$('ra-choix')?.addEventListener('click', (event) => {
  const tuile = event.target.closest('[data-ra-choix]');
  if (!tuile) return;
  fenRa.choix = tuile.dataset.raChoix;
  majReponseAtelier();
});

/* Un groupe de boutons radio se parcourt aux flèches, comme ceux du système. */
$('ra-choix')?.addEventListener('keydown', (event) => {
  const sens = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
  if (!sens) return;
  event.preventDefault();
  const tuiles = [...$('ra-choix').querySelectorAll('[data-ra-choix]')];
  const rang = tuiles.findIndex((tuile) => tuile.dataset.raChoix === fenRa.choix);
  const suivante = tuiles[(rang + sens + tuiles.length) % tuiles.length];
  fenRa.choix = suivante.dataset.raChoix;
  majReponseAtelier();
  suivante.focus();
});

$('ra-date')?.addEventListener('change', (event) => {
  fenRa.date = event.target.value;
  majReponseAtelier();
});
$('ra-moins')?.addEventListener('click', () => {
  const veille = decalerJour(fenRa.date || aujourdhuiIso(), -1);
  if (veille >= aujourdhuiIso()) fenRa.date = veille;
  majReponseAtelier();
});
$('ra-plus')?.addEventListener('click', () => {
  fenRa.date = decalerJour(fenRa.date || aujourdhuiIso(), 1);
  majReponseAtelier();
});
$('ra-relances')?.addEventListener('click', (event) => {
  const bouton = event.target.closest('[data-ra-relance]');
  if (!bouton) return;
  fenRa.relance = Number(bouton.dataset.raRelance);
  majReponseAtelier();
});

$('ra-nom')?.addEventListener('input', (event) => {
  fenRa.saisie = event.target.value;
  // Un nom tapé tel quel suit la saisie : il ne reste choisi que s'il est confirmé.
  if (fenRa.choisis[0]?.libre) fenRa.choisis = [];
  majReponseAtelier();
  chercherCatalogue({ apres: 250 });
});
// Au clic dans le champ, la liste est déjà là ; vide, elle se remplit.
$('ra-nom')?.addEventListener('focus', () => {
  if (!fenRa.catalogue?.length) chercherCatalogue();
});

$('ra-options')?.addEventListener('click', (event) => {
  const bouton = event.target.closest('button');
  if (!bouton) return;
  if (bouton.dataset.raTelQuel) {
    const nom = fenRa.saisie.trim();
    if (!nom) return;
    fenRa.choisis = [{ cle: `libre-${Date.now()}`, productTitle: nom, variantTitle: null, sku: null, image: null, inventory: null, libre: true }];
  } else if (bouton.dataset.raOpt) {
    const option = [...(fenRa.options ?? []), ...(fenRa.catalogue ?? [])].find((candidat) => candidat.id === bouton.dataset.raOpt);
    if (!option) return;
    fenRa.choisis = [
      {
        cle: option.id,
        productTitle: option.productTitle,
        variantTitle: option.variantTitle ?? null,
        sku: option.sku ?? null,
        image: option.image ?? null,
        inventory: option.inventoryQuantity ?? null,
        libre: false,
      },
    ];
  }
  majReponseAtelier();
});

$('ra-mot')?.addEventListener('input', () => majReponseAtelier());
$('ra-fermer')?.addEventListener('click', fermerReponseAtelier);
$('ra-modal')?.addEventListener('click', (event) => {
  if (event.target === event.currentTarget) fermerReponseAtelier();
});
$('ra-modal')?.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') fermerReponseAtelier();
});

$('ra-envoyer')?.addEventListener('click', async () => {
  const d = fenRa.dossier;
  if (!d || manqueReponseAtelier() || fenRa.envoi) return;

  fenRa.envoi = true;
  majReponseAtelier();
  try {
    const resultat = await api(`/api/ruptures/${d.ticketId}/consigne`, {
      method: 'POST',
      body: JSON.stringify({
        ...(fenRa.supplierId ? { supplierId: fenRa.supplierId } : {}),
        choix: fenRa.choix,
        expedierAvant: fenRa.choix === 'ATTENDRE' ? fenRa.date : null,
        relancerDans: fenRa.choix === 'ATTENDRE' ? fenRa.relance : null,
        modeles: fenRa.choix === 'REMPLACER' ? fenRa.choisis.map(({ cle, ...modele }) => modele) : null,
        mot: $('ra-mot').value.trim() || null,
        article: d.article
          ? { titre: d.article.titre ?? null, variante: d.article.variante ?? null, sku: d.article.sku ?? null }
          : null,
      }),
    });
    const depuisTicket = fenRa.depuisTicket;
    const choix = fenRa.choix;
    fermerReponseAtelier();
    toast(
      choix === 'ANNULER'
        ? `${resultat.atelier} n’expédiera pas l’article ; la ligne attend dans Annulation/Remboursement.`
        : resultat.parMail
          ? `Envoyé à ${resultat.atelier} : dans son espace, et par mail tout de suite.`
          : `Envoyé à ${resultat.atelier} : c’est dans son espace fournisseur.`,
    );
    if (depuisTicket) {
      prefetched.delete(d.ticketId);
      await selectTicket(d.ticketId);
    } else {
      await loadRuptures();
    }
    if (choix === 'ANNULER') state.navCounts = { ...state.navCounts, refunds: (state.navCounts?.refunds ?? 0) + 1 };
    renderNav();
  } catch (error) {
    fenRa.envoi = false;
    majReponseAtelier();
    toast(error.message, true);
  }
});

function dateCourte(iso) {
  return new Date(iso).toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/** « 22 min », « 5 h 30 », « 3 j » : le temps passé entre deux étapes. */
function ecartRupture(ms) {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const heures = Math.floor(minutes / 60);
  if (heures < 48) return minutes % 60 ? `${heures} h ${String(minutes % 60).padStart(2, '0')}` : `${heures} h`;
  return `${Math.round(heures / 24)} j`;
}

/*
 * Les dates du dossier, et le temps entre chacune.
 *
 * La première rupture, le mail au client, la décision, la réponse de
 * l'atelier, puis le nouveau suivi — le moment où le client a enfin un colis.
 * C'est l'écart entre ces dates qui dit où le dossier a traîné : chez nous,
 * chez l'atelier, ou chez le client.
 *
 * Tout vient de ce que le dossier porte déjà : pas d'appel au journal d'audit,
 * qui coûterait une requête par dossier ouvert.
 */
function datesDuDossier(d) {
  const atelier = d.fournisseur?.name ?? 'L’atelier';
  const article = [d.article?.titre, d.article?.variante].filter(Boolean).join(' ');
  const nom = (modele) => [modele?.productTitle, modele?.variantTitle].filter(Boolean).join(' ');
  const evenements = [[d.creeLe, `1re rupture${article ? ` · ${article}` : ''}`, 'gris']];

  if (d.suivi?.mailClientLe) {
    evenements.push([d.suivi.mailClientLe, d.suivi.mailAuto ? 'Mail au client, parti seul' : 'Mail au client', 'accent']);
  }
  for (const consigne of d.consignes ?? []) {
    const modele = consigne.modeles?.[0];
    evenements.push([
      consigne.envoyeeLe,
      {
        REMPLACER: `Modèle changé → ${nom(modele) || 'autre modèle'}`,
        ATTENDRE: consigne.relancerLe
          ? `Restock · relance du client le ${dateConsigneFr(consigne.relancerLe)}`
          : 'Restock',
        ANNULER: 'Remboursement décidé',
        MESSAGE: 'Message à l’atelier',
      }[consigne.choix] ?? 'Décision envoyée',
      'accent',
    ]);
    if (consigne.reponduLe) {
      evenements.push([
        consigne.reponduLe,
        consigne.reponse === 'IMPOSSIBLE'
          ? consigne.choix === 'REMPLACER'
            ? `${nom(modele) || 'Le modèle'} aussi en rupture — 2e choix`
            : `${atelier} ne pourra pas`
          : consigne.reponse === 'REPONDU'
            ? `${atelier} a répondu`
            : `Confirmé par ${atelier}`,
        consigne.reponse === 'IMPOSSIBLE' ? 'warn' : 'ok',
      ]);
    }
  }
  if (d.suivi?.nouveauSuiviLe) {
    evenements.push([
      d.suivi.nouveauSuiviLe,
      `Traité par ${atelier}${d.suivi.nouveauSuivi ? ` · suivi ${d.suivi.nouveauSuivi}` : ''}`,
      'ok',
    ]);
  }
  if (d.suivi?.remboursement?.faitLe) evenements.push([d.suivi.remboursement.faitLe, 'Remboursé', 'ok']);
  if (d.resoluLe) evenements.push([d.resoluLe, 'Dossier clos', 'gris']);

  evenements.sort((a, b) => new Date(a[0]).getTime() - new Date(b[0]).getTime());

  const quand = (date) =>
    `${new Date(date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })} à ${new Date(date).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
  const debut = new Date(d.creeLe).getTime();
  const fin = d.suivi?.nouveauSuiviLe ?? d.suivi?.remboursement?.faitLe ?? d.resoluLe ?? null;

  return `<ol class="rup-dates">${evenements
    .map(([date, texte, ton], rang) => {
      const ecart = rang ? new Date(date).getTime() - new Date(evenements[rang - 1][0]).getTime() : 0;
      return `<li class="rup-date-${ton}">
        <b>${esc(texte)}</b>
        <time datetime="${esc(date)}">${esc(quand(date))}</time>
        ${ecart > 0 ? `<span class="rup-ecart">après ${esc(ecartRupture(ecart))}</span>` : ''}
      </li>`;
    })
    .join('')}</ol>
    <div class="rup-line rup-duree"><span>${fin ? 'Traité en' : 'En cours depuis'}</span><span>${esc(
      ecartRupture((fin ? new Date(fin).getTime() : Date.now()) - debut),
    )}</span></div>`;
}

/*
 * Les gestes qui restent, sous le dossier.
 *
 * Répondre à l'atelier et écrire au client ont leur bouton dans leur section,
 * là où l'on vient de lire ce qui les appelle. Ici, ce qui sort du dossier :
 * l'ouvrir dans le SAV, chercher une alternative pour le client, le clore.
 *
 * Ne figurent ici que des gestes réellement branchés. « Annuler la commande »
 * manque parce qu'aucun handler d'annulation n'existe côté serveur : un bouton
 * qui ne fait rien coûte plus cher que son absence.
 */
function renderRuptureActions(d) {
  const boite = $('rup-actions');
  const gestes = [
    d.etat !== 'RESOLU' && {
      cle: 'alt',
      label: 'Chercher une alternative',
      faire: () => void chargerAlternatives(d),
    },
    {
      cle: 'dossier',
      label: 'Ouvrir le dossier',
      faire: () => {
        fermerPileRupture();
        setView('tickets');
        void selectTicket(d.ticketId);
      },
    },
    d.etat !== 'RESOLU' && {
      cle: 'resoudre',
      label: 'Marquer résolu',
      faire: () => void resoudreRupture(d),
    },
    {
      cle: 'supprimer',
      label: 'Supprimer',
      faire: () => void supprimerRupture(d),
    },
  ].filter(Boolean);

  boite.innerHTML = gestes
    .map(
      (geste) =>
        `<button class="btn btn-small" type="button" data-rup-act="${esc(geste.cle)}">${esc(geste.label)}</button>`,
    )
    .join('');

  boite.querySelectorAll('[data-rup-act]').forEach((bouton) => {
    const geste = gestes.find((candidat) => candidat.cle === bouton.dataset.rupAct);
    bouton.addEventListener('click', () => geste.faire(bouton));
  });
}

/*
 * Écrire au client sans quitter la console.
 *
 * La fenêtre de rédaction est globale et lit `state.detail` à l'envoi : on
 * charge donc la fiche du ticket avant de l'ouvrir. C'est exactement ce que
 * fait l'écran SAV, moins le changement de vue — la liste reste derrière, et
 * on enchaîne sur le dossier suivant.
 */
async function ecrireAuClientDepuisRupture(d, phrase = null) {
  try {
    const detail = await api(`/api/tickets/${d.ticketId}`);
    if (!detail?.ticket) return toast('Ce dossier n’a plus de message rattaché.', true);

    /* Un signalement fait sans adresse client connue porte l'adresse de
       repli de l'atelier, `fournisseur+…@local`. La fenêtre de rédaction
       l'utiliserait comme destinataire : le mail partirait vers une adresse
       qui n'existe pas, et l'agent croirait le client prévenu. */
    if (String(detail.ticket.customerEmail ?? '').startsWith('fournisseur+')) {
      return toast('Adresse du client inconnue sur ce signalement — ouvrez la commande pour la retrouver.', true);
    }

    state.detail = detail;
    openCompose(detail.ticket);

    if (phrase) {
      const corps = $('compose-body');
      corps.value = corps.value.trim() ? `${corps.value.trim()}\n\n${phrase}` : phrase;
      corps.focus();
    }
  } catch (error) {
    toast(error.message, true);
  }
}

/*
 * Clôturer, selon l'origine du dossier.
 *
 * Une escalade se résout sur sa propre route ; un signalement d'atelier est
 * un ticket, qui se clôt comme tout ticket — et c'est ce qui le fait passer à
 * « Repris par le marchand » dans l'espace du fournisseur. Appeler la route
 * des escalades avec l'identifiant d'un ticket répondrait « introuvable », et
 * le dossier resterait ouvert sans que le bouton ait l'air cassé.
 */
function cloreRupture(d) {
  return d.origine === 'atelier'
    ? api(`/api/tickets/${d.ticketId}/resolve`, { method: 'POST', body: '{}' })
    : api(`/api/escalations/${d.id}/resolve`, { method: 'POST', body: '{}' });
}

/* Supprimer un dossier : un essai, une erreur. Le mail d'un client reste dans le SAV. */
async function supprimerRupture(d) {
  const quoi =
    d.origine === 'atelier'
      ? 'Le signalement de l’atelier, ses décisions et sa ligne « À rembourser » seront effacés.'
      : 'Le dossier, ses décisions et sa ligne « À rembourser » seront effacés ; le mail du client reste dans le SAV.';
  if (!await confirmer(`Supprimer le dossier de rupture ${d.commande?.nom ?? ''} ?\n\n${quoi}`, { action: 'Supprimer', danger: true, icone: 'corbeille' })) return;
  try {
    await api(`/api/ruptures/${d.id}`, { method: 'DELETE' });
    state.ruptures.courant = null;
    toast('Dossier supprimé.');
    await loadRuptures();
  } catch (error) {
    toast(error.message, true);
  }
}

async function resoudreRupture(d) {
  try {
    await cloreRupture(d);
    toast('Dossier clôturé.');
    await loadRuptures();
  } catch (error) {
    toast(error.message, true);
  }
}

/*
 * Les alternatives, cherchées dans le vrai catalogue.
 *
 * Même route que l'écran SAV : le croisement commande → catalogue existe déjà,
 * et un second chemin vers la même question finirait par répondre autrement.
 * Choisir une référence n'envoie rien — la proposition entre dans un brouillon
 * que l'agent relit. Un remplacement se propose, il ne s'impose pas.
 */
async function chargerAlternatives(d) {
  const boite = $('rup-alts');
  if (!boite) return;

  boite.innerHTML = '<p class="empty">Recherche des références en stock…</p>';

  try {
    const data = await api(`/api/tickets/${d.ticketId}/substitutions`);
    state.ruptures.alternatives = data.options?.length ? data.options : [];
    if (!data.options?.length) {
      boite.innerHTML = `<p class="empty">${esc(
        data.reason ?? 'Aucune référence équivalente en stock pour le moment.',
      )}</p>`;
      return;
    }
  } catch (error) {
    boite.innerHTML = `<p class="empty">${esc(error.message)}</p>`;
    return;
  }

  renderRuptureAlternatives(d);
}

function renderRuptureAlternatives(d) {
  const boite = $('rup-alts');
  if (!boite) return;

  const options = state.ruptures.alternatives;
  // Rien tant qu'on n'a pas cherché : « Chercher une alternative » est sous le dossier.
  if (options === null) {
    boite.innerHTML = '';
    return;
  }

  boite.innerHTML = options
    .slice(0, 3)
    .map(
      (option) => `<div class="rup-alt">
        ${
          option.image
            ? `<img src="${esc(option.image)}" alt="" loading="lazy" />`
            : '<span class="rup-blank"></span>'
        }
        <span style="min-width:0;flex:1">
          <b>${esc(option.productTitle)}</b>
          <small>${esc(option.variantTitle ?? '—')}</small>
          <small class="rup-alt-stock">${option.inventoryQuantity ?? 0} en stock</small>
        </span>
        <button class="btn btn-small btn-primary" type="button"
          data-rup-alt="${esc(option.id)}">Proposer</button>
      </div>`,
    )
    .join('');

  boite.querySelectorAll('[data-rup-alt]').forEach((bouton) =>
    bouton.addEventListener('click', () => {
      const option = options.find((candidat) => candidat.id === bouton.dataset.rupAlt);
      const nom = `${option.productTitle}${
        option.variantTitle ? ` — ${option.variantTitle}` : ''
      }`;
      void ecrireAuClientDepuisRupture(
        d,
        `Nous pouvons vous proposer en remplacement : ${nom}, disponible immédiatement. Confirmez-vous ce choix ?`,
      );
    }),
  );
}


/* ---- le mail au client ---- */

const fenMail = { dossier: null, envoi: false };

/*
 * « Envoyer le mail » : la réponse type, remplie pour la commande, à relire.
 *
 * Le serveur la remplit — prénom, commande, article, délai annoncé par
 * l'atelier — et relit l'adresse lui-même à l'envoi : la page ne choisit
 * jamais le destinataire.
 */
async function ouvrirMailRupture(d) {
  if (!d) return;
  try {
    const mail = await api(`/api/ruptures/${d.ticketId}/mail`);
    Object.assign(fenMail, { dossier: d, envoi: false });
    $('rm-a').textContent = mail.nom ? `${mail.nom} <${mail.a}>` : mail.a;
    $('rm-sujet').value = mail.sujet;
    $('rm-texte').value = mail.corps;
    majMailRupture();
    $('rm-modal').hidden = false;
    $('rm-modal').classList.add('open');
    if (window.matchMedia('(hover: hover)').matches) requestAnimationFrame(() => $('rm-texte').focus());
  } catch (error) {
    toast(error.message, true);
  }
}

function majMailRupture() {
  const vide = !$('rm-sujet').value.trim() || $('rm-texte').value.trim().length < 10;
  $('rm-pied').textContent = vide ? 'Le mail est vide.' : 'Il part de votre boîte, et s’inscrit au dossier.';
  $('rm-pied').classList.toggle('ra-pied-manque', vide);
  $('rm-envoyer').disabled = vide || fenMail.envoi;
}

function fermerMailRupture() {
  $('rm-modal').hidden = true;
  $('rm-modal').classList.remove('open');
  fenMail.dossier = null;
}

$('rm-sujet')?.addEventListener('input', majMailRupture);
$('rm-texte')?.addEventListener('input', majMailRupture);
$('rm-fermer')?.addEventListener('click', fermerMailRupture);
$('rm-modal')?.addEventListener('click', (event) => {
  if (event.target === event.currentTarget) fermerMailRupture();
});
$('rm-modal')?.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') fermerMailRupture();
});
$('rm-envoyer')?.addEventListener('click', async () => {
  const d = fenMail.dossier;
  if (!d || fenMail.envoi) return;
  fenMail.envoi = true;
  majMailRupture();
  try {
    await api(`/api/ruptures/${d.ticketId}/mail`, {
      method: 'POST',
      body: JSON.stringify({ sujet: $('rm-sujet').value.trim(), corps: $('rm-texte').value.trim() }),
    });
    fermerMailRupture();
    toast(`Mail envoyé à ${d.client?.nom ?? 'la cliente'}.`);
    await loadRuptures();
  } catch (error) {
    fenMail.envoi = false;
    majMailRupture();
    toast(error.message, true);
  }
});

/* ---- câblage de la console des ruptures ---- */

/*
 * Posés au chargement, pas à chaque rendu : ces éléments vivent dans le HTML
 * statique, et un écouteur par rafraîchissement en empilerait un de plus à
 * chaque fois — au bout de dix relèves, un clic déclencherait dix requêtes.
 */
$('rup-chiffres')?.addEventListener('click', (event) => {
  const chiffre = event.target.closest('[data-rup-filtre]');
  if (!chiffre) return;
  const r = state.ruptures;
  // Un second clic sur le même chiffre retire le filtre, comme un bouton bascule.
  r.vue = r.vue === chiffre.dataset.rupFiltre ? 'tous' : chiffre.dataset.rupFiltre;
  r.page = 1;
  renderRuptures();
});

$('rup-filtre')?.addEventListener('click', () => {
  state.ruptures.vue = 'tous';
  state.ruptures.page = 1;
  renderRuptures();
});

$('rup-q')?.addEventListener('input', (event) => {
  state.ruptures.q = event.target.value;
  state.ruptures.page = 1;
  renderRuptures();
});

/* Un modèle de la liste : les dossiers où il manque. */
$('rup-modeles')?.addEventListener('click', (event) => {
  const modele = event.target.closest('[data-rup-modele]');
  if (!modele) return;
  const r = state.ruptures;
  Object.assign(r, { q: modele.dataset.rupModele, vue: 'tous', page: 1 });
  $('rup-q').value = r.q;
  renderRuptures();
});

/*
 * Le mail au client : au clic, ou dès que l'atelier signale.
 *
 * Le choix vaut pour toute la boutique — c'est un réglage, pas une
 * préférence d'écran : il se demande à qui peut régler, et revient en
 * arrière si le serveur refuse.
 */
$('rup-mailauto')?.addEventListener('click', async (event) => {
  const bouton = event.target.closest('[data-auto]');
  if (!bouton) return;
  const r = state.ruptures;
  const voulu = bouton.dataset.auto === 'true';
  if (voulu === r.mailRuptureAuto) return;
  r.mailRuptureAuto = voulu;
  renderRuptureEntete();
  try {
    await api('/api/ruptures/reglages', { method: 'PUT', body: JSON.stringify({ mailRuptureAuto: voulu }) });
    toast(voulu ? 'Le mail partira dès que l’atelier signale une rupture.' : 'Le mail partira quand vous cliquerez « Envoyer le mail ».');
  } catch (error) {
    r.mailRuptureAuto = !voulu;
    renderRuptureEntete();
    toast(error.message, true);
  }
});

/* ------------------------------------------------- commandes du jour ---- */

/*
 * Les commandes de la veille, avant le fournisseur.
 *
 * Trois listes, dans l'ordre du geste : ce que le stock retours peut servir
 * (à décider), ce qui partira au fournisseur, ce que le marchand expédie
 * lui-même. Une correspondance qu'on laisse n'est pas enregistrée : elle part
 * simplement avec le reste, comme en mode automatique.
 */
state.envoi = { donnees: null, laissees: new Set() };

const lignesTexte = (lignes) =>
  lignes
    .map((ligne) => `${ligne.quantite > 1 ? `${ligne.quantite} × ` : ''}${[ligne.titre, ligne.declinaison].filter(Boolean).join(' · ')}`)
    .join(', ');

// Le rouge est réservé au retard : « À préparer » est l'état normal d'une
// commande au lendemain de l'envoi, pas une alerte.
const STATUTS_LOT = {
  A_PREPARER: { label: 'À préparer', tone: 'mute' },
  EXPEDIEE: { label: 'Expédiée', tone: 'ok' },
};

/*
 * Où en est le lot chez l'atelier, sans lui écrire : une barre de ce qui est
 * parti, et le détail par commande à la demande. « Expédiée » vient de ses
 * colis saisis. Le détail s'ouvre seul quand une commande est en retard.
 */
function avancementDuLot(lot) {
  const { EXPEDIEE: expediees, RETARD: retards } = lot.compte;
  const total = lot.commandes.length;
  return `<details class="envoi-lot"${retards ? ' open' : ''}>
    <summary>
      <span class="el-barre" aria-hidden="true"><i style="width:${total ? Math.round((expediees / total) * 100) : 0}%"></i></span>
      <span class="el-resume">${esc(nombreDe(expediees, 'expédiée', 'expédiées'))} sur ${total}${
        retards ? ` <span class="tag tone-bad envoi-retard">${retards} en retard</span>` : ''
      }</span>
    </summary>
    ${lot.commandes
      .map(
        (commande) => `<div class="envoi-lot-ligne">
          <b>${esc(commande.orderName)}</b>
          <span class="ell-txt"><small>${esc(commande.articles ?? '')}</small>${
            commande.suivis.length ? `<span class="mono">${esc(commande.suivis.join(' · '))}</span>` : ''
          }</span>
          ${commande.enRetard ? `<span class="tag tone-bad envoi-retard">En retard · ${commande.joursDepuis} j</span>` : `<span class="tag tone-${STATUTS_LOT[commande.statut].tone}">${STATUTS_LOT[commande.statut].label}</span>`}
        </div>`,
      )
      .join('')}
  </details>`;
}

/** Les commandes qui partiront, rangées par atelier ; les orphelines en dernier. */
function commandesParFournisseur(commandes) {
  const groupes = new Map();
  for (const commande of commandes) {
    const cle = commande.fournisseur?.id ?? '';
    if (!groupes.has(cle)) groupes.set(cle, { fournisseur: commande.fournisseur, commandes: [] });
    groupes.get(cle).commandes.push(commande);
  }
  return [...groupes.values()].sort((a, b) => {
    if (!a.fournisseur || !b.fournisseur) return a.fournisseur ? -1 : b.fournisseur ? 1 : 0;
    return a.fournisseur.name.localeCompare(b.fournisseur.name, 'fr');
  });
}

async function loadEnvoi() {
  $('envoi-list').innerHTML = '<p class="empty">Lecture des commandes…</p>';
  try {
    state.envoi.donnees = await api('/api/envoi-du-jour');
  } catch (error) {
    state.envoi.donnees = null;
    $('envoi-list').innerHTML = `<p class="empty">${esc(error.message)}</p>`;
    return;
  }
  renderEnvoi();
}

function renderEnvoi() {
  const d = state.envoi.donnees;
  if (!d) return;

  const auto = d.reglage.mode === 'AUTO';
  const delaiJours = d.reglage.delaiJours ?? 2;
  document.querySelectorAll('[data-envoi-mode]').forEach((bouton) =>
    bouton.setAttribute('aria-pressed', String(bouton.dataset.envoiMode === d.reglage.mode)),
  );
  $('envoi-heure-wrap').hidden = !auto;
  $('envoi-manuel-note').hidden = auto;
  const heure = $('envoi-heure');
  if (!heure.options.length) {
    heure.innerHTML = Array.from({ length: 24 }, (_, h) => `<option value="${h}">${String(h).padStart(2, '0')} h</option>`).join('');
  }
  heure.value = String(d.reglage.heure);
  const delai = $('envoi-delai');
  if (!delai.options.length) {
    delai.innerHTML = [1, 2, 3, 4, 5, 7, 10, 14].map((n) => `<option value="${n}">${n} j</option>`).join('');
  }
  delai.value = String(delaiJours);

  const jour = new Date(new Date(d.jusqua).getTime() - 1).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
  const depuis = new Date(d.depuis).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
  $('envoi-periode').textContent = `Jusqu’au ${jour} · depuis le ${depuis}`;

  const parId = new Map(d.commandes.map((commande) => [commande.id, commande]));
  const aTrancher = d.correspondances.filter((c) => !state.envoi.laissees.has(c.commandeId));
  const enStock = new Set(aTrancher.map((c) => c.commandeId));
  const partiront = d.commandes;
  const groupes = commandesParFournisseur(partiront);
  const envoyables = partiront.filter((commande) => commande.fournisseur).length;
  const sans = partiront.length - envoyables;
  const retards = (d.lots ?? []).reduce((total, lot) => total + (lot.compte.RETARD ?? 0), 0);

  // La journée en quatre chiffres : zéro se lit en gris, sans gras.
  const ateliers = groupes.filter((g) => g.fournisseur).map((g) => `${g.fournisseur.name} ${g.commandes.length}`);
  $('envoi-kpis').innerHTML = [
    [
      'À trancher',
      aTrancher.length,
      aTrancher.length > 1 ? 'peuvent partir de votre stock' : aTrancher.length ? 'peut partir de votre stock' : 'aucune paire ne correspond',
      'bleu',
      'box',
    ],
    ['Au fournisseur', envoyables, ateliers.length ? ateliers.join(' · ') : 'rien à envoyer', 'indigo', 'truck'],
    ['Sans fournisseur', sans, sans ? 'ne partira pas' : 'tout est rattaché', 'orange', 'alerte'],
    ['En retard chez l’atelier', retards, `toujours à préparer après ${delaiJours} j`, 'rouge', 'clock'],
  ]
    .map(
      ([label, n, note, teinte, icone]) => `<div class="ek">
        <span class="kpi-ico c-${teinte}" aria-hidden="true">${ico(icone)}</span>
        <span class="ek-txt">
          <span class="ek-label">${esc(label)}</span>
          <b class="ek-v${n ? '' : ' ek-nul'}">${n}</b>
          <span class="ek-note">${esc(note)}</span>
        </span>
      </div>`,
    )
    .join('');

  // Les paires du stock : une carte par commande, la décision en bas.
  $('envoi-n-match').textContent = aTrancher.length ? `${aTrancher.length}` : '';
  $('envoi-matches').innerHTML = aTrancher.length
    ? aTrancher
        .map((c) => {
          const commande = parId.get(c.commandeId);
          const client = commande?.client ?? '';
          return `<article class="envoi-carte" aria-label="${esc(commande?.name ?? '')}">
            <div class="ec-cmd">
              <span class="ec-av" aria-hidden="true" style="background:${avatarTint(client || commande?.name)}">${esc(initials(client || '?'))}</span>
              <span class="ec-txt">
                <span><b>${esc(commande?.name ?? '')}</b>${client ? ` · ${esc(client)}` : ''}</span>
                <small>Commandé : ${esc(lignesTexte(commande?.lignes ?? []))}</small>
              </span>
            </div>
            <div class="ec-paire">
              <span class="ec-ico" aria-hidden="true">${ico('box')}</span>
              <span class="ec-txt">${c.paires
                .map(
                  (paire) => `<span>${esc([paire.titre, paire.declinaison].filter(Boolean).join(' · '))}</span>${
                    paire.retourDe ? `<small>Retour de ${esc(paire.retourDe)}</small>` : ''
                  }`,
                )
                .join('')}</span>
              <span class="envoi-lieu">${ico('pin')}${
                c.agence ? `${esc(c.agence.nom ?? 'Agence')}${c.agence.pays ? ` (${esc(c.agence.pays)})` : ''}` : 'Chez vous'
              }${c.voisin ? ' <span class="tag tone-mute">pays voisin</span>' : ''}</span>
            </div>
            <div class="envoi-acts">
              <button class="btn btn-small" type="button" data-envoi-laisser="${esc(c.commandeId)}">Laisser au fournisseur</button>
              <button class="btn btn-small btn-primary" type="button" data-envoi-reserver="${esc(c.commandeId)}">${
                c.agence ? 'L’agence l’expédie' : 'Je l’expédie moi-même'
              }</button>
            </div>
          </article>`;
        })
        .join('')
    : '<p class="empty">Aucune commande ne correspond à une paire de votre stock, agences comprises.</p>';

  // Ce qui partira, atelier par atelier. Une commande que le stock pourrait
  // servir le dit : non tranchée, elle part avec les autres.
  $('envoi-n-list').textContent = partiront.length ? `${partiront.length}` : '';
  $('envoi-list').innerHTML = partiront.length
    ? groupes
        .map(
          (groupe) => `<div class="envoi-groupe${groupe.fournisseur ? '' : ' envoi-sans'}">
            <div class="eg-tete">${groupe.fournisseur ? '' : ico('alerte')}<b>${esc(
              groupe.fournisseur?.name ?? 'Sans fournisseur, ne partira pas',
            )}</b><span>${esc(nombreDe(groupe.commandes.length, 'commande', 'commandes'))}</span>${
              groupe.fournisseur ? '' : '<button class="envoi-lien" type="button" data-envoi-fournisseurs>Régler dans Fournisseurs</button>'
            }</div>
            <div class="eg-lignes">${groupe.commandes
              .map(
                (commande) => `<div class="envoi-ligne">
                  <b class="el-nom">${esc(commande.name)}</b>
                  <span class="el-client">${esc(commande.client ?? '')}</span>
                  <span class="el-articles">${esc(lignesTexte(commande.lignes))}</span>
                  ${enStock.has(commande.id) ? `<span class="el-stock">${ico('box')}aussi en stock</span>` : ''}
                </div>`,
              )
              .join('')}</div>
          </div>`,
        )
        .join('')
    : '<p class="empty">Rien à envoyer : toutes les commandes de la période sont parties ou servies par votre stock.</p>';

  // Réservées au stock
  $('envoi-res-bloc').hidden = d.reservees.length === 0;
  $('envoi-n-res').textContent = d.reservees.length ? `${d.reservees.length}` : '';
  $('envoi-reservees').innerHTML = d.reservees.length
    ? `<div class="eg-lignes">${d.reservees
        .map(
          (commande) => `<div class="envoi-ligne envoi-res">
            <span class="el-txt"><b>${esc(commande.name)}</b><small>${esc(commande.paires.join(', '))}</small></span>
            <button class="btn btn-small" type="button" data-envoi-liberer="${esc(commande.id)}" data-nom="${esc(commande.name)}">Rendre au fournisseur</button>
          </div>`,
        )
        .join('')}</div>`
    : '';

  // Historique, avec ce que l'atelier a fait de chaque lot depuis.
  const lots = new Map((d.lots ?? []).map((lot) => [lot.id, lot]));
  $('envoi-hist').innerHTML = d.envois?.length
    ? `<div class="eg-lignes">${d.envois
        .map((envoi) => {
          const lot = lots.get(envoi.id);
          return `<div class="envoi-hist-row">
            <div class="eh-tete">
              <b>${esc(envoi.supplier?.name ?? '')}</b>
              <span class="tag tone-${envoi.emailedAt ? (envoi.simule ? 'mute' : 'ok') : 'bad'}">${
                envoi.emailedAt ? (envoi.simule ? 'Simulé (mode test)' : 'Envoyé') : 'Échec'
              }</span>
            </div>
            <span class="eh-detail">${esc(dateTime(envoi.createdAt))} · ${esc(nombreDe(envoi.combien, 'commande', 'commandes'))} · ${
              envoi.mode === 'AUTO' ? 'automatique' : 'manuel'
            }</span>
            ${envoi.erreur ? `<small class="envoi-err">${esc(envoi.erreur)}</small>` : ''}
            ${lot ? avancementDuLot(lot) : ''}
          </div>`;
        })
        .join('')}</div>`
    : '<p class="empty">Aucun envoi pour l’instant.</p>';
  $('envoi-pied').textContent = `« Expédiée » vient des numéros de suivi que l’atelier saisit. Une commande encore à préparer ${nombreDe(
    delaiJours,
    'jour',
    'jours',
  )} après l’envoi passe en retard, et un rappel unique lui part.`;

  $('envoi-go').disabled = envoyables === 0 || !canI('escalate');
  $('envoi-go').textContent = envoyables ? `Envoyer au fournisseur (${envoyables})` : 'Envoyer au fournisseur';

  // La pastille du menu suit l'écran tout de suite : le compte serveur est
  // mis en cache cinq minutes, et un délai qu'on vient de changer le périme.
  if ((state.navCounts?.envoi ?? 0) !== retards) {
    state.navCounts = { ...state.navCounts, envoi: retards };
    renderNav();
  }
  // Les commandes sans fournisseur ont leur groupe en rouge, et son lien :
  // le bandeau ne garde que ce qui n'a pas d'autre place.
  const notes = [
    retards
      ? `${nombreDe(retards, 'commande en retard', 'commandes en retard')} chez l’atelier : toujours à préparer ${nombreDe(
          delaiJours,
          'jour',
          'jours',
        )} après l’envoi. Le détail est sous « Derniers envois ».`
      : null,
    d.tronque ? 'Plus de mille commandes sur la période : seules les mille premières sont affichées.' : null,
    auto && aTrancher.length
      ? `Envoi automatique à ${String(d.reglage.heure).padStart(2, '0')} h : les paires en stock que vous n’avez pas tranchées d’ici là partiront au fournisseur.`
      : null,
  ].filter(Boolean);
  $('envoi-notice').hidden = notes.length === 0;
  $('envoi-notice-txt').innerHTML = notes.map((note) => `<div>${esc(note)}</div>`).join('');
}

$('view-envoi')?.addEventListener('click', async (event) => {
  const reserver = event.target.closest('[data-envoi-reserver]');
  const laisser = event.target.closest('[data-envoi-laisser]');
  const liberer = event.target.closest('[data-envoi-liberer]');
  const d = state.envoi.donnees;
  if (event.target.closest('[data-envoi-fournisseurs]')) {
    setView('suppliers');
    return;
  }
  if (!d) return;

  if (laisser) {
    state.envoi.laissees.add(laisser.dataset.envoiLaisser);
    renderEnvoi();
    return;
  }

  if (reserver) {
    const id = reserver.dataset.envoiReserver;
    const correspondance = d.correspondances.find((c) => c.commandeId === id);
    const commande = d.commandes.find((c) => c.id === id);
    if (!correspondance || !commande) return;
    reserver.disabled = true;
    try {
      const reserve = await api('/api/returns/reemploi', {
        method: 'POST',
        body: JSON.stringify({
          orderId: id,
          orderName: commande.name,
          returnIds: correspondance.paires.map((paire) => paire.returnId),
        }),
      });
      toast(
        reserve.agence
          ? `${commande.name} confiée à l’agence ${reserve.agence.name} : elle ne partira pas au fournisseur.`
          : `${commande.name} réservée à votre stock : elle ne partira pas au fournisseur.`,
      );
      await loadEnvoi();
    } catch (error) {
      reserver.disabled = false;
      toast(error.message, true);
    }
    return;
  }

  if (liberer) {
    liberer.disabled = true;
    try {
      await api('/api/returns/reemploi/liberer', {
        method: 'POST',
        body: JSON.stringify({ orderId: liberer.dataset.envoiLiberer }),
      });
      toast(`${liberer.dataset.nom} repart avec les commandes du fournisseur.`);
      await loadEnvoi();
    } catch (error) {
      liberer.disabled = false;
      toast(error.message, true);
    }
  }
});

/*
 * L'envoi demande confirmation dans une feuille : à qui part quoi, et ce que
 * le stock aurait pu servir. La boîte du navigateur ne savait dire qu'un total.
 */
function ouvrirEnvoiFournisseur() {
  const d = state.envoi.donnees;
  if (!d) return;
  const groupes = commandesParFournisseur(d.commandes.filter((commande) => commande.fournisseur));
  const envoyables = groupes.reduce((total, groupe) => total + groupe.commandes.length, 0);
  if (!envoyables) return;
  const nonTranchees = d.correspondances.filter((c) => !state.envoi.laissees.has(c.commandeId)).length;

  $('envoi-m-titre').textContent = `Envoyer ${nombreDe(envoyables, 'commande', 'commandes')} au fournisseur ?`;
  $('envoi-m-lignes').innerHTML = groupes
    .map(
      (groupe) => `<li><span>${esc(groupe.fournisseur.name)}</span><span>${esc(
        nombreDe(groupe.commandes.length, 'commande', 'commandes'),
      )}</span></li>`,
    )
    .join('');
  $('envoi-m-avert').hidden = nonTranchees === 0;
  $('envoi-m-avert').textContent =
    nonTranchees > 1
      ? `${nonTranchees} d’entre elles pourraient partir de votre stock retours : si vous envoyez maintenant, elles partiront au fournisseur.`
      : 'Une d’entre elles pourrait partir de votre stock retours : si vous envoyez maintenant, elle partira au fournisseur.';
  $('envoi-modal').hidden = false;
  $('envoi-modal').classList.add('open');
  $('envoi-m-annuler').focus();
}

function fermerEnvoiFournisseur() {
  $('envoi-modal').hidden = true;
  $('envoi-modal').classList.remove('open');
  $('envoi-go').focus();
}

async function envoyerAuFournisseur() {
  const bouton = $('envoi-m-envoyer');
  bouton.disabled = true;
  $('envoi-go').disabled = true;
  try {
    const { resultats } = await api('/api/envoi-du-jour/envoyer', { method: 'POST', body: '{}' });
    const ratees = resultats.filter((resultat) => !resultat.parti);
    toast(
      ratees.length
        ? `Échec de l’envoi à ${ratees.map((r) => r.fournisseur).join(', ')} : ${ratees[0].erreur}`
        : resultats.length
          ? resultats.map((r) => `${r.combien} commande(s) envoyée(s) à ${r.fournisseur}${r.simule ? ' (simulé)' : ''}`).join(' · ')
          : 'Rien n’était à envoyer.',
      ratees.length > 0,
    );
    state.envoi.laissees.clear();
    fermerEnvoiFournisseur();
    await loadEnvoi();
  } catch (error) {
    toast(error.message, true);
    $('envoi-go').disabled = false;
  } finally {
    bouton.disabled = false;
  }
}

$('envoi-go')?.addEventListener('click', ouvrirEnvoiFournisseur);
$('envoi-m-annuler')?.addEventListener('click', fermerEnvoiFournisseur);
$('envoi-m-envoyer')?.addEventListener('click', () => void envoyerAuFournisseur());
$('envoi-modal')?.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') fermerEnvoiFournisseur();
});

async function enregistrerReglageEnvoi(mode, heure, delaiJours = Number($('envoi-delai').value || 2)) {
  try {
    await api('/api/envoi-du-jour/reglage', { method: 'PATCH', body: JSON.stringify({ mode, heure, delaiJours }) });
    // Le retard se recalcule côté serveur : on relit l'écran plutôt que de deviner.
    if (state.envoi.donnees && state.envoi.donnees.reglage.delaiJours !== delaiJours) {
      await loadEnvoi();
      return toast(`Une commande non expédiée ${delaiJours} jour(s) après l’envoi passera en retard.`);
    }
    if (state.envoi.donnees) state.envoi.donnees.reglage = { mode, heure, delaiJours };
    renderEnvoi();
    toast(mode === 'AUTO' ? `Envoi automatique chaque jour à ${String(heure).padStart(2, '0')} h.` : 'Envoi manuel : rien ne part sans votre clic.');
  } catch (error) {
    toast(error.message, true);
  }
}

document.querySelectorAll('[data-envoi-mode]').forEach((bouton) =>
  bouton.addEventListener('click', () =>
    void enregistrerReglageEnvoi(bouton.dataset.envoiMode, Number($('envoi-heure').value || state.envoi.donnees?.reglage.heure || 9)),
  ),
);
$('envoi-heure')?.addEventListener('change', (event) =>
  void enregistrerReglageEnvoi('AUTO', Number(event.target.value)),
);
$('envoi-delai')?.addEventListener('change', () => {
  const reglage = state.envoi.donnees?.reglage ?? { mode: 'MANUEL', heure: 9 };
  void enregistrerReglageEnvoi(reglage.mode, reglage.heure, Number($('envoi-delai').value));
});


/* ----------------------------------------------- annulation, update ---- */

/** « Annulation » se fait dans Shopify : on ouvre la commande là-bas. */
function ouvrirCommandeShopify(order) {
  const shop = state.me?.merchant?.shopDomain;
  const id = String(order?.id ?? '').split('/').pop();
  if (!shop || !/^\d+$/.test(id)) return toast('Aucune commande Shopify rattachée.', true);
  window.open(`https://${shop}/admin/orders/${id}`, '_blank', 'noopener');
}

/*
 * « Update » : où en sont ces colis ?
 *
 * Les numéros viennent des deux sources de la fiche — expéditions Shopify et
 * colis saisis par l'atelier —, cochés d'office quand il n'y en a qu'un. Le
 * fournisseur pré-choisi est celui qui a déjà la commande en main.
 */
async function ouvrirUpdate(ticket) {
  const order = state.detail?.order;
  const modal = $('upd-modal');
  modal.dataset.ticket = ticket.id;
  modal.dataset.order = order?.id ?? ticket.shopifyOrderId ?? '';
  $('upd-order').value = order?.name ?? ticket.orderName ?? '';
  $('upd-message').value = '';

  const usable = activeSuppliers();
  let prefere = null;
  try {
    const { escalations } = await api(`/api/tickets/${ticket.id}/escalations`);
    prefere = escalations?.[0]?.supplierId ?? null;
  } catch {
    // Sans historique, le fournisseur par défaut.
  }
  $('upd-supplier').innerHTML = usable
    .map(
      (supplier) => `<option value="${esc(supplier.id)}"${
        supplier.id === prefere || (!prefere && supplier.isDefault) ? ' selected' : ''
      }>${esc(supplier.name)}</option>`,
    )
    .join('');

  const numeros = new Set((order?.fulfillments ?? []).map((f) => f.trackingNumber).filter(Boolean));
  if (modal.dataset.order) {
    try {
      const data = await api(`/api/parcels?orderId=${encodeURIComponent(modal.dataset.order)}`);
      for (const parcel of data.parcels ?? []) if (parcel.trackingNumber) numeros.add(parcel.trackingNumber);
    } catch {
      // Les expéditions Shopify suffisent.
    }
  }
  const liste = [...numeros];
  $('upd-tracks').innerHTML = liste.length
    ? liste
        .map(
          (numero) => `<label><input type="checkbox" value="${esc(numero)}"${liste.length === 1 ? ' checked' : ''} />
            <span class="mono">${esc(numero)}</span></label>`,
        )
        .join('')
    : '<p class="empty">Aucun numéro de suivi sur cette commande : précisez la demande ci-dessous.</p>';

  modal.hidden = false;
  modal.classList.add('open');
}

function fermerUpdate() {
  $('upd-modal').hidden = true;
  $('upd-modal').classList.remove('open');
}

$('upd-cancel')?.addEventListener('click', fermerUpdate);
$('upd-modal')?.addEventListener('click', (event) => {
  if (event.target === event.currentTarget) fermerUpdate();
});

$('upd-send')?.addEventListener('click', async () => {
  const modal = $('upd-modal');
  const coches = [...$('upd-tracks').querySelectorAll('input:checked')].map((box) => box.value);
  const message = $('upd-message').value.trim();
  const supplierId = $('upd-supplier').value;

  if (!supplierId) return toast('Choisissez le fournisseur destinataire.', true);
  if (coches.length === 0 && message.length < 3) {
    return toast('Cochez au moins un colis, ou écrivez une précision.', true);
  }

  const bouton = $('upd-send');
  bouton.disabled = true;
  try {
    const result = await api(`/api/suppliers/${supplierId}/alert`, {
      method: 'POST',
      body: JSON.stringify({
        kind: 'TRACKING',
        message,
        beforeValue: coches.join(', ') || null,
        orderName: $('upd-order').value.trim() || null,
        shopifyOrderId: modal.dataset.order || null,
        ticketId: modal.dataset.ticket || null,
      }),
    });
    fermerUpdate();
    // Un point sur un colis n'est pas urgent : il part dans le récapitulatif
    // du matin, et s'affiche dans son atelier dès maintenant.
    toast(
      result.emailed
        ? 'Demande envoyée au fournisseur.'
        : result.differe
          ? 'Demande affichée dans son espace fournisseur — elle partira dans son récapitulatif de 9 h (heure de Chine).'
          : 'Demande affichée dans son espace fournisseur — le mail n’a pas pu partir.',
      !result.emailed && !result.differe,
    );
    if (state.currentId) {
      prefetched.delete(state.currentId);
      await selectTicket(state.currentId);
    }
  } catch (error) {
    toast(error.message, true);
  } finally {
    bouton.disabled = false;
  }
});


/* ==========================================================================
   RELEVÉ MENSUEL D'UN ATELIER

   Pour vérifier sa facture : ce qu'on lui a envoyé dans le mois, ce qu'il a
   expédié, ce qui a été annulé, remplacé ou retourné. Douze mois au choix,
   le mois en cours d'abord ; le même relevé se télécharge en Excel.
   ========================================================================== */

const STATUTS_RELEVE = {
  EXPEDIEE: { label: 'Expédiée', tone: 'ok' },
  NON_EXPEDIEE: { label: 'Non expédiée', tone: 'bad' },
  ANNULEE: { label: 'Annulée', tone: 'mute' },
};

function derniersMois(n = 12) {
  const maintenant = new Date();
  return Array.from({ length: n }, (_, rang) => {
    const date = new Date(maintenant.getFullYear(), maintenant.getMonth() - rang, 1);
    return {
      valeur: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`,
      libelle: date.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' }),
    };
  });
}

async function ouvrirReleve(supplierId) {
  const modal = $('releve-modal');
  modal.dataset.supplier = supplierId;
  $('releve-who').textContent = (state.suppliers ?? []).find((s) => s.id === supplierId)?.name ?? '';
  $('releve-mois').innerHTML = derniersMois()
    .map((mois) => `<option value="${mois.valeur}">${esc(mois.libelle)}</option>`)
    .join('');
  modal.hidden = false;
  modal.classList.add('open');
  await chargerReleve();
}

async function chargerReleve() {
  const supplierId = $('releve-modal').dataset.supplier;
  const mois = $('releve-mois').value;
  $('releve-xlsx').href = `/api/suppliers/${encodeURIComponent(supplierId)}/releve?mois=${mois}&format=xlsx`;
  $('releve-totaux').innerHTML = '';
  $('releve-rows').innerHTML = '<p class="empty">Chargement…</p>';
  try {
    const releve = await api(`/api/suppliers/${encodeURIComponent(supplierId)}/releve?mois=${mois}`);
    const t = releve.totaux;
    $('releve-totaux').innerHTML = [
      [t.envoyees, 'envoyées'],
      [t.expediees, 'expédiées'],
      [t.nonExpediees, 'non expédiées', t.nonExpediees > 0],
      [t.annulees, 'annulées'],
      [t.remplacees, 'remplacées'],
      [t.retours, 'retours clients'],
    ]
      .map(([n, libelle, chaud]) => `<div class="supc-stat${chaud ? ' hot' : ''}"><b>${n}</b><span>${libelle}</span></div>`)
      .join('');
    const jour = (iso) => (iso ? new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }) : '—');
    $('releve-rows').innerHTML = releve.lignes.length
      ? `<table>
          <thead><tr><th>Commande</th><th>Articles</th><th>Envoyée</th><th>Expédiée</th><th>Suivi</th><th>Statut</th><th>Remplacement</th><th>Retour</th></tr></thead>
          <tbody>${releve.lignes
            .map(
              (ligne) => `<tr>
                <td><b>${esc(ligne.commande)}</b></td>
                <td>${esc(ligne.articles ?? '')}</td>
                <td>${jour(ligne.envoyeLe)}</td>
                <td>${jour(ligne.expedieeLe)}</td>
                <td class="mono">${esc(ligne.suivis.join(', '))}</td>
                <td><span class="tag tone-${STATUTS_RELEVE[ligne.statut].tone}">${STATUTS_RELEVE[ligne.statut].label}</span></td>
                <td>${esc(ligne.remplacement ?? '')}</td>
                <td>${esc(ligne.retour ?? '')}</td>
              </tr>`,
            )
            .join('')}</tbody>
        </table>`
      : '<p class="empty">Aucune commande envoyée à cet atelier ce mois-ci.</p>';
  } catch (error) {
    $('releve-rows').innerHTML = `<p class="empty">${esc(error.message)}</p>`;
  }
}

function fermerReleve() {
  $('releve-modal').hidden = true;
  $('releve-modal').classList.remove('open');
}

$('releve-mois')?.addEventListener('change', () => void chargerReleve());
$('releve-close')?.addEventListener('click', fermerReleve);
$('releve-modal')?.addEventListener('click', (event) => {
  if (event.target === event.currentTarget) fermerReleve();
});
