/*
 * Les alertes de l'outil, façon macOS et iOS.
 *
 * La fenêtre du navigateur — « csav-api.onrender.com indique » — parlait au
 * nom d'une adresse technique, en gris, avec « OK » pour seul verbe. Une
 * alerte Apple dit la même chose autrement : une icône qui dit de quoi il
 * s'agit, une question courte en gras, une phrase qui précise, et un bouton
 * qui porte le verbe — « Effacer », « Supprimer » — en rouge quand on ne
 * revient pas en arrière.
 *
 * Sur ordinateur, l'alerte de macOS : étroite, centrée, deux boutons pleins.
 * Sur téléphone, celle d'iOS : boutons en texte, séparés d'un filet.
 *
 * Un seul fichier, partagé par l'outil, l'espace atelier et celui des
 * agences : le style vient avec, pour qu'aucune page n'en ait une copie.
 */

const ICONES = {
  corbeille: ['#ff453a', '#d70015', 'M5 7h14M10 4h4M7 7l1 12h8l1-12M10.5 10.5v6M13.5 10.5v6'],
  test: ['#ff9f0a', '#c25400', 'M9.5 3h5M10 3v6l-5 9.5A1.2 1.2 0 0 0 6 20h12a1.2 1.2 0 0 0 1-1.5L14 9V3'],
  attention: ['#ffd60a', '#ff9f0a', 'M12 4.5 21 19.5H3zM12 10.5v4M12 17h.01'],
  lien: ['#0a84ff', '#0040dd', 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1'],
  message: ['#30d158', '#248a3d', 'M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-4.5 3.5V17A2.5 2.5 0 0 1 4 14.5z'],
  retour: ['#64d2ff', '#0a84ff', 'M4 8h11l-3-3M20 16H9l3 3'],
  ok: ['#30d158', '#248a3d', 'M6 12.5l4 4 8-9'],
  info: ['#0a84ff', '#0040dd', 'M12 21a9 9 0 1 0 0-18a9 9 0 0 0 0 18M12 11v5.5M12 7.8h.01'],
};

const STYLE = `
.al-fond { position: fixed; inset: 0; z-index: 2147483000; display: flex; align-items: center; justify-content: center; padding: 16px;
  background: rgb(0 0 0 / 22%); -webkit-backdrop-filter: blur(2px); backdrop-filter: blur(2px); animation: al-fondu .16s ease-out; }
.al { width: 260px; box-sizing: border-box; padding: 20px 16px 16px; border-radius: 14px; text-align: center;
  background: rgb(246 246 246 / 92%); -webkit-backdrop-filter: saturate(180%) blur(30px); backdrop-filter: saturate(180%) blur(30px);
  box-shadow: 0 0 0 0.5px rgb(0 0 0 / 18%), 0 22px 60px -10px rgb(0 0 0 / 45%);
  color: #1d1d1f; font: 13px/1.35 -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue', system-ui, sans-serif;
  -webkit-font-smoothing: antialiased; animation: al-entree .22s cubic-bezier(.2,.9,.3,1.2); }
.al-ico { width: 64px; height: 64px; margin: 0 auto 12px; border-radius: 15px; display: flex; align-items: center; justify-content: center;
  box-shadow: inset 0 0 0 0.5px rgb(0 0 0 / 12%), 0 1px 2px rgb(0 0 0 / 15%); }
.al-ico svg { width: 36px; height: 36px; fill: none; stroke: #fff; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
.al-titre { margin: 0; font-size: 13px; font-weight: 700; }
.al-texte { margin: 6px 0 0; font-size: 11.5px; color: #3c3c43; white-space: pre-line; }
.al-lignes { margin: 10px 0 0; padding: 8px 10px; border-radius: 8px; background: rgb(0 0 0 / 5%); list-style: none; text-align: left; font-size: 11.5px; }
.al-lignes li { display: flex; gap: 8px; padding: 2px 0; }
.al-lignes li span:first-child { flex: 1; color: #3c3c43; }
.al-lignes li b { font-variant-numeric: tabular-nums; }
.al-boutons { display: flex; gap: 8px; margin-top: 16px; }
.al-boutons button { flex: 1; min-width: 0; height: 28px; padding: 0 8px; border: 0; border-radius: 7px; font: inherit; font-size: 13px; cursor: pointer;
  background: rgb(0 0 0 / 7%); color: #1d1d1f; box-shadow: 0 0.5px 1px rgb(0 0 0 / 15%); }
@media (hover: hover) { .al-boutons button:hover { background: rgb(0 0 0 / 10%); } }
.al-boutons .al-action { background: #0a84ff; color: #fff; font-weight: 600; }
@media (hover: hover) { .al-boutons .al-action:hover { background: #0071e3; } }
.al-boutons .al-danger { background: #ff3b30; color: #fff; font-weight: 600; }
@media (hover: hover) { .al-boutons .al-danger:hover { background: #e0352b; } }
.al-boutons button:focus { outline: none; }
.al-boutons button:focus-visible { outline: 3px solid rgb(10 132 255 / 50%); outline-offset: 1px; }
@keyframes al-fondu { from { opacity: 0; } }
@keyframes al-entree { from { opacity: 0; transform: scale(1.08); } }
@media (prefers-color-scheme: dark) {
  .al { background: rgb(40 40 42 / 92%); color: #f5f5f7; box-shadow: 0 0 0 0.5px rgb(255 255 255 / 14%), 0 22px 60px -10px rgb(0 0 0 / 70%); }
  .al-texte, .al-lignes li span:first-child { color: #c7c7cc; }
  .al-lignes { background: rgb(255 255 255 / 7%); }
  .al-boutons button { background: rgb(255 255 255 / 14%); color: #f5f5f7; }
}
:root[data-theme='dark'] .al { background: rgb(40 40 42 / 92%); color: #f5f5f7; }
:root[data-theme='dark'] .al-texte { color: #c7c7cc; }
:root[data-theme='dark'] .al-boutons button { background: rgb(255 255 255 / 14%); color: #f5f5f7; }
:root[data-theme='light'] .al { background: rgb(246 246 246 / 92%); color: #1d1d1f; }
:root[data-theme='light'] .al-texte { color: #3c3c43; }
:root[data-theme='light'] .al-boutons button { background: rgb(0 0 0 / 7%); color: #1d1d1f; }
@media (max-width: 700px) {
  .al { width: 270px; padding: 20px 0 0; border-radius: 14px; }
  .al-ico { width: 48px; height: 48px; border-radius: 11px; margin-bottom: 10px; }
  .al-ico svg { width: 27px; height: 27px; }
  .al-titre { padding: 0 16px; font-size: 17px; font-weight: 600; }
  .al-texte { padding: 0 16px; font-size: 13px; }
  .al-lignes { margin: 10px 16px 0; font-size: 13px; }
  .al-boutons { gap: 0; margin-top: 18px; border-top: 0.5px solid rgb(60 60 67 / 29%); }
  .al-fond .al-boutons button, .al-fond .al-boutons button:hover, .al-fond .al-boutons button:active, .al-fond .al-boutons .al-action, .al-fond .al-boutons .al-danger {
    height: 44px; background-image: none; border-radius: 0; background: transparent; box-shadow: none; color: #0a84ff; font-size: 17px; font-weight: 400; }
  .al-boutons button + button { border-left: 0.5px solid rgb(60 60 67 / 29%); }
  .al-fond .al-boutons .al-action { font-weight: 600; }
  .al-fond .al-boutons .al-danger { color: #ff3b30; font-weight: 600; }
  .al-fond .al-boutons button:active { background: rgb(0 0 0 / 6%); }
}
`;

function installerStyle() {
  if (document.getElementById('al-style')) return;
  const style = document.createElement('style');
  style.id = 'al-style';
  style.textContent = STYLE;
  document.head.append(style);
}

const echapper = (texte) =>
  String(texte ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function icone(nom) {
  const [haut, bas, chemin] = ICONES[nom] ?? ICONES.info;
  return `<div class="al-ico" style="background: linear-gradient(180deg, ${haut}, ${bas})" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="${chemin}" /></svg></div>`;
}

/**
 * Ouvre une alerte et rend la réponse.
 *
 * `danger` met le verbe en rouge et donne le focus à « Annuler » : Entrée ne
 * doit jamais effacer par mégarde. Échap annule toujours ; un clic à côté
 * aussi.
 */
function ouvrir({ titre, texte = '', lignes = null, icone: nom = 'info', action = 'OK', annuler = 'Annuler', danger = false, seul = false }) {
  installerStyle();
  const precedent = document.activeElement;
  const fond = document.createElement('div');
  fond.className = 'al-fond';
  const id = `al-${Date.now()}`;
  fond.innerHTML = `<div class="al" role="alertdialog" aria-modal="true" aria-labelledby="${id}-t" aria-describedby="${id}-d">
    ${icone(nom)}
    <p class="al-titre" id="${id}-t">${echapper(titre)}</p>
    ${texte ? `<p class="al-texte" id="${id}-d">${echapper(texte)}</p>` : ''}
    ${
      lignes?.length
        ? `<ul class="al-lignes">${lignes.map(([libelle, valeur]) => `<li><span>${echapper(libelle)}</span><b>${echapper(valeur)}</b></li>`).join('')}</ul>`
        : ''
    }
    <div class="al-boutons">
      ${seul ? '' : `<button type="button" data-al="non">${echapper(annuler)}</button>`}
      <button type="button" data-al="oui" class="${danger ? 'al-danger' : 'al-action'}">${echapper(action)}</button>
    </div>
  </div>`;

  return new Promise((resolve) => {
    const fermer = (reponse) => {
      document.removeEventListener('keydown', clavier, true);
      fond.remove();
      if (precedent instanceof HTMLElement) precedent.focus?.();
      resolve(reponse);
    };
    const clavier = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        fermer(seul);
      } else if (event.key === 'Tab') {
        // Le focus reste dans l'alerte, comme sur macOS.
        const boutons = [...fond.querySelectorAll('button')];
        const rang = boutons.indexOf(document.activeElement);
        event.preventDefault();
        boutons[(rang + (event.shiftKey ? -1 : 1) + boutons.length) % boutons.length]?.focus();
      }
    };
    fond.addEventListener('click', (event) => {
      const bouton = event.target.closest('[data-al]');
      if (bouton) fermer(bouton.dataset.al === 'oui');
      else if (event.target === fond) fermer(seul);
    });
    document.addEventListener('keydown', clavier, true);
    document.body.append(fond);
    // Entrée valide le bouton qui a le focus : le verbe, sauf quand il détruit.
    // Au doigt, pas de focus : un anneau sur une alerte d'iPhone ne dit rien.
    if (window.matchMedia('(hover: hover)').matches) {
      fond.querySelector(danger && !seul ? '[data-al="non"]' : '[data-al="oui"]')?.focus({ focusVisible: true });
    }
  });
}

/** Une question : rend `true` si l'on confirme. */
export function demander(options) {
  return ouvrir(options);
}

/**
 * Une question déjà écrite d'un bloc — « Le numéro a déjà été envoyé. Le
 * remplacer par 12 ? Shopify enverra un e-mail. » — devient une alerte : ce
 * qui précède le premier « ? » fait le titre, le reste la précision.
 */
export function confirmer(message, options = {}) {
  const texte = String(message);
  const coupe = texte.includes('\n\n') ? texte.indexOf('\n\n') : texte.search(/[?？]\s/);
  const titre = coupe > 0 ? texte.slice(0, coupe + (texte.includes('\n\n') ? 0 : 1)).trim() : texte;
  const reste = coupe > 0 ? texte.slice(coupe + 1).trim() : '';
  return demander({ titre, texte: reste, ...options });
}

/** Une information, un seul bouton : « OK ». */
export function informer(options) {
  return ouvrir({ action: 'OK', ...options, seul: true }).then(() => undefined);
}
