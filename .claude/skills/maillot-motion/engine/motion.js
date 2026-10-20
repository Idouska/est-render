/**
 * Moteur maillot-motion : chaque image est une fonction pure du temps.
 *
 * Un modèle (templates/*.js) décrit un film avec MM.film({ beats, build }).
 * `build(ctx)` crée le DOM une seule fois et enregistre des « parts » ;
 * ensuite `seek(t)` recalcule tous les styles à partir de t, sans état
 * conservé entre deux images, sans transition CSS ni minuterie. On peut donc
 * rendre n'importe quel instant, dans n'importe quel ordre, en parallèle.
 *
 * Le moteur expose à render.mjs : window.__mm = { ready, duration, cues,
 * seek(t), qa(t), info }.
 */
(function () {
  'use strict';

  const MM = (window.MM = {});

  /* ------------------------------------------------------------------------
   * Maths
   * ---------------------------------------------------------------------- */

  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const lerp = (a, b, k) => a + (b - a) * k;
  const range = (t, a, b) => (b === a ? (t >= b ? 1 : 0) : clamp((t - a) / (b - a)));

  const E = {
    lin: (x) => x,
    outCubic: (x) => 1 - Math.pow(1 - x, 3),
    inCubic: (x) => x * x * x,
    inOutCubic: (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2),
    outExpo: (x) => (x >= 1 ? 1 : 1 - Math.pow(2, -10 * x)),
    inOutSine: (x) => -(Math.cos(Math.PI * x) - 1) / 2,
    outQuart: (x) => 1 - Math.pow(1 - x, 4),
  };

  // Réponse indicielle d'un ressort amorti, forme fermée : 0 → 1.
  function stepR(tau, sp) {
    if (tau <= 0) return 0;
    const { w, z } = sp;
    if (z >= 1) {
      const x = w * tau;
      return 1 - Math.exp(-x) * (1 + x);
    }
    const wd = w * Math.sqrt(1 - z * z);
    return 1 - Math.exp(-z * w * tau) * (Math.cos(wd * tau) + ((z * w) / wd) * Math.sin(wd * tau));
  }

  // Ressorts nommés. Un dépassement minuscule au plus, jamais de rebond mou.
  const SP = {
    texte: { w: 24, z: 1 }, // apparitions de texte : net, sans dépassement
    doux: { w: 11, z: 1 }, // déplacements lents
    vif: { w: 19, z: 0.82 }, // la plupart des mouvements
    claque: { w: 30, z: 0.74 }, // titres qui claquent, prix, impacts
    camera: { w: 6.5, z: 1 }, // caméra : toujours amortie
    pop: { w: 26, z: 0.62 }, // petits éléments (points, pastilles)
  };

  // Temps pour qu'un ressort atteigne ~98 % : sert à lancer un mouvement
  // assez tôt pour qu'il « arrive » sur un temps.
  const settle = (sp) => (sp.z >= 1 ? 5.8 : 4.2 / (sp.z * 1.0)) / sp.w;

  /**
   * Valeur pilotée par ressorts. Chaque changement de cible ajoute un ressort ;
   * la valeur est la somme de tous : elle reste une fonction pure de t.
   */
  class Track {
    constructor(v0) {
      this.v0 = v0;
      this.cur = v0;
      this.ev = [];
    }
    to(t, v, sp = SP.vif) {
      if (v !== this.cur) {
        this.ev.push([t, v - this.cur, sp]);
        this.cur = v;
      }
      return this;
    }
    // Arrive (≈ 98 %) à l'instant t au lieu d'y démarrer.
    arrive(t, v, sp = SP.vif) {
      return this.to(t - settle(sp) * 0.55, v, sp);
    }
    set(t, v) {
      return this.to(t, v, null);
    }
    at(t) {
      let v = this.v0;
      for (const [ti, d, sp] of this.ev) v += sp ? d * stepR(t - ti, sp) : t >= ti ? d : 0;
      return v;
    }
  }

  // Entrée sur ressort, sortie courte et précoce, avec flou.
  function vis(t, tin, tout, opt = {}) {
    const sp = opt.sp || SP.texte;
    const dOut = opt.dOut || 0.16;
    const e = tin == null ? 1 : stepR(t - tin, sp);
    const x = tout == null ? 0 : range(t, tout, tout + dOut);
    const xo = x * x;
    return { o: clamp(e) * (1 - xo), b: (1 - clamp(e)) * 12 + xo * 10, e, x: xo, in: e, out: xo };
  }

  // Générateur pseudo-aléatoire déterministe (mulberry32).
  function rng(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let r = Math.imul(a ^ (a >>> 15), 1 | a);
      r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
      return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ------------------------------------------------------------------------
   * Formats et zones sûres
   * ---------------------------------------------------------------------- */

  // Marges sans texte, en fraction de l'image. 9:16 : interface Reels et
  // TikTok (légende et boutons en bas, rail d'icônes à droite).
  const FORMATS = {
    '9:16': { W: 1080, H: 1920, safe: { t: 0.14, b: 0.3, l: 0.06, r: 0.12 } },
    '4:5': { W: 1080, H: 1350, safe: { t: 0.06, b: 0.08, l: 0.06, r: 0.06 } },
    '1:1': { W: 1080, H: 1080, safe: { t: 0.06, b: 0.07, l: 0.06, r: 0.06 } },
    '16:9': { W: 1920, H: 1080, safe: { t: 0.07, b: 0.09, l: 0.05, r: 0.05 } },
  };

  function layout(fmt) {
    const f = FORMATS[fmt];
    if (!f) throw new Error('Format inconnu : ' + fmt);
    const { W, H } = f;
    // Le fichier de scène peut durcir une zone : "zones_sures": { "9:16": { "b": 0.35 } }.
    const over = (window.SPEC && window.SPEC.zones_sures && window.SPEC.zones_sures[fmt]) || {};
    const safe = Object.assign({}, f.safe, over);
    const x = W * safe.l;
    const y = H * safe.t;
    const w = W * (1 - safe.l - safe.r);
    const h = H * (1 - safe.t - safe.b);
    return {
      fmt,
      W,
      H,
      u: Math.min(W, H) / 100,
      portrait: H / W > 1.2,
      wide: W / H > 1.2,
      safe: { x, y, w, h, cx: x + w / 2, cy: y + h / 2, r: x + w, b: y + h },
    };
  }

  /* ------------------------------------------------------------------------
   * DOM
   * ---------------------------------------------------------------------- */

  let stage = null;

  function el(tag, opt = {}) {
    const n = document.createElement(tag);
    if (opt.cls) n.className = opt.cls;
    if (opt.text != null) n.textContent = opt.text;
    if (opt.html != null) n.innerHTML = opt.html;
    if (opt.style) Object.assign(n.style, opt.style);
    if (opt.qa) {
      n.dataset.qa = opt.qa;
      n.dataset.qaId = opt.qa + '-' + MM._qaCount++;
    }
    (opt.parent || stage).appendChild(n);
    return n;
  }

  /**
   * Place un élément : son point d'ancrage (ax, ay, centre par défaut) va en
   * (x, y). s, sx, sy : échelle ; r : rotation (degrés) ; o : opacité ;
   * b : flou (px).
   */
  function put(n, p) {
    const ax = p.ax == null ? 0.5 : p.ax;
    const ay = p.ay == null ? 0.5 : p.ay;
    const s = p.s == null ? 1 : p.s;
    const sx = (p.sx == null ? 1 : p.sx) * s;
    const sy = (p.sy == null ? 1 : p.sy) * s;
    const o = p.o == null ? 1 : clamp(p.o);
    n.style.transform =
      `translate(${(p.x || 0).toFixed(2)}px,${(p.y || 0).toFixed(2)}px) ` +
      `translate(${-ax * 100}%,${-ay * 100}%) rotate(${(p.r || 0).toFixed(3)}deg) scale(${sx.toFixed(4)},${sy.toFixed(4)})`;
    n.style.transformOrigin = `${ax * 100}% ${ay * 100}%`;
    n.style.opacity = o.toFixed(4);
    n.style.visibility = o < 0.002 ? 'hidden' : 'visible';
    const b = p.b || 0;
    n.style.filter = b > 0.05 ? `blur(${b.toFixed(2)}px)` : p.filter || '';
  }

  // Taille de police pour que `n` tienne en largeur `maxW` (une ligne).
  function fit(n, maxW, maxPx, minPx = maxPx * 0.4) {
    n.style.whiteSpace = 'nowrap';
    n.style.fontSize = maxPx + 'px';
    const w = n.scrollWidth;
    const size = w > maxW ? Math.max(minPx, (maxPx * maxW) / w) : maxPx;
    n.style.fontSize = size.toFixed(1) + 'px';
    return size;
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => img.decode().then(() => resolve(img), () => resolve(img));
      img.onerror = () => reject(new Error('Image illisible : ' + src));
      img.src = src;
    });
  }

  /* ------------------------------------------------------------------------
   * Caméra : #world est cadré par une caméra (centre, zoom logarithmique).
   * ---------------------------------------------------------------------- */

  function makeCamera(L, world) {
    const cx = new Track(L.W / 2);
    const cy = new Track(L.H / 2);
    const lz = new Track(0); // log du zoom : un zoom linéaire paraît faux
    const cam = {
      cx,
      cy,
      lz,
      // Cadre (x, y) au centre avec un zoom z.
      frame(t, x, y, z = 1, sp = SP.camera) {
        cx.to(t, x, sp);
        cy.to(t, y, sp);
        lz.to(t, Math.log(z), sp);
        return cam;
      },
      state(t) {
        return { x: cx.at(t), y: cy.at(t), z: Math.exp(lz.at(t)) };
      },
      toScreen(t, x, y) {
        const s = cam.state(t);
        return { x: (x - s.x) * s.z + L.W / 2, y: (y - s.y) * s.z + L.H / 2, z: s.z };
      },
      seek(t) {
        const s = cam.state(t);
        world.style.transform = `translate(${L.W / 2}px,${L.H / 2}px) scale(${s.z.toFixed(5)}) translate(${-s.x.toFixed(2)}px,${-s.y.toFixed(2)}px)`;
      },
    };
    return cam;
  }

  /* ------------------------------------------------------------------------
   * Film
   * ---------------------------------------------------------------------- */

  MM._qaCount = 0;
  MM.film = (def) => {
    MM._def = def;
  };

  async function boot() {
    const def = MM._def;
    if (!def) throw new Error('Aucun modèle chargé (MM.film non appelé).');
    const spec = window.SPEC;
    const L = layout(window.FORMAT);
    stage = document.getElementById('stage');
    stage.style.width = L.W + 'px';
    stage.style.height = L.H + 'px';

    await Promise.all(
      ['MM Titre', 'MM Texte'].flatMap((f) => [600, 800, 900].map((w) => document.fonts.load(`${w} 100px "${f}"`))),
    );
    await document.fonts.ready;

    const bpm = spec.bpm || 120;
    const beat = 60 / bpm;
    const back = el('div', { cls: 'mm-back' }); // fond, hors caméra
    const world = el('div', { cls: 'mm-world' });
    const hud = el('div', { cls: 'mm-hud' });
    const parts = [];
    const cues = [];
    const ctx = {
      spec,
      L,
      stage,
      back,
      world,
      hud,
      bpm,
      beat,
      B: (n) => n * beat, // temps du n-ième temps musical
      cam: makeCamera(L, world),
      add(p) {
        parts.push(p);
        return p;
      },
      cue(t, type, opt = {}) {
        cues.push({ t: +t.toFixed(4), type, gain: opt.gain ?? 1, pitch: opt.pitch ?? 0 });
      },
      image: loadImage,
      el,
      rng: rng(spec.graine || 7),
    };

    await def.build(ctx);
    const duration = ctx.duration || (def.beats ? def.beats * beat : 10);

    const seek = (t) => {
      ctx.cam.seek(t);
      for (const p of parts) p.seek(t);
    };

    window.__mm = {
      ready: true,
      duration,
      cues: cues.filter((c) => c.t >= -0.5 && c.t <= duration).sort((a, b) => a.t - b.t),
      info: { format: L.fmt, W: L.W, H: L.H, bpm, safe: L.safe, temps_fort: ctx.tempsFort ?? null, minFont: L.u * 3.1 },
      seek,
      qa(t) {
        seek(t);
        return qaSnapshot();
      },
    };
    seek(0);
  }

  // Boîtes des éléments marqués data-qa visibles à l'instant courant.
  function qaSnapshot() {
    const out = [];
    for (const n of stage.querySelectorAll('[data-qa]')) {
      let o = 1;
      for (let p = n; p && p !== stage; p = p.parentElement) {
        const cs = getComputedStyle(p);
        if (cs.visibility === 'hidden' || cs.display === 'none') o = 0;
        o *= parseFloat(cs.opacity);
      }
      if (o < 0.6) continue;
      const r = n.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      const scale = n.offsetHeight ? r.height / n.offsetHeight : 1;
      const font = parseFloat(getComputedStyle(n).fontSize) * scale;
      out.push({
        id: n.dataset.qaId,
        kind: n.dataset.qa,
        label: (n.dataset.qaLabel || n.textContent || '').trim().slice(0, 40),
        x: r.x,
        y: r.y,
        w: r.width,
        h: r.height,
        o,
        font,
        overflow: n.dataset.qaBox != null && n.scrollWidth > n.clientWidth + 2,
      });
    }
    return out;
  }

  // Texte sur plusieurs lignes : tableau, ou chaîne coupée par « \n » ou « | ».
  function lines(v, fallback) {
    if (!v) return fallback;
    if (Array.isArray(v)) return v;
    return String(v)
      .split(/\n|\|/)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  // Interpolation douce de a vers b entre t0 et t1.
  const glide = (t, t0, t1, a, b) => a + (b - a) * E.inOutCubic(range(t, t0, t1));

  Object.assign(MM, { clamp, lerp, range, E, SP, stepR, settle, Track, vis, rng, el, put, fit, layout, FORMATS, loadImage, lines, glide });

  window.addEventListener('load', () => {
    boot().catch((err) => {
      window.__mm = { ready: false, error: String((err && err.stack) || err) };
    });
  });
})();
