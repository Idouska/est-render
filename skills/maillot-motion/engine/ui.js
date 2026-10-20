/**
 * Composants réutilisables. Chacun crée son DOM à la construction, s'ajoute
 * au film (ctx.add) et expose seek(t), pur. Les textes sont marqués data-qa
 * pour le contrôle des zones sûres et du temps de lecture.
 *
 * Calques : ctx.back (fond, hors caméra), ctx.world (produit, suit la
 * caméra), ctx.hud (textes et boutons, coordonnées écran).
 */
(function () {
  'use strict';

  const { clamp, lerp, range, E, SP, stepR, Track, vis, el, put, fit } = window.MM;

  /* ------------------------------------------------------------------------
   * Icônes : un seul jeu, trait 2,4 sur une grille de 24.
   * ---------------------------------------------------------------------- */

  const ICONS = {
    fleche: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    panier: '<path d="M6 8h12l-1 12H7L6 8z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    etoile: '<path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.8z"/>',
    bouclier: '<path d="M12 3l7 3v5.5c0 4.3-3 7.6-7 9.5-4-1.9-7-5.2-7-9.5V6z"/><path d="M8.8 12.2l2.2 2.2 4.3-4.4"/>',
    camion: '<path d="M3 6h11v10H3zM14 10h4l3 3v3h-7z"/><circle cx="7" cy="17.5" r="1.8"/><circle cx="17.5" cy="17.5" r="1.8"/>',
    horloge: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    tag: '<path d="M3.5 12.5V4h8.5l8.5 8.5-8.5 8.5z"/><circle cx="8" cy="8.5" r="1.4"/>',
    retour: '<path d="M4 12a8 8 0 1 0 2.3-5.6M4 4v4h4"/>',
  };
  const icon = (name) =>
    `<svg viewBox="0 0 24 24" class="mm-ico" aria-hidden="true">${ICONS[name] || ICONS.fleche}</svg>`;

  /* ------------------------------------------------------------------------
   * Couleurs et formats
   * ---------------------------------------------------------------------- */

  function colors(ctx) {
    const c = (ctx.spec.marque && ctx.spec.marque.couleurs) || {};
    return {
      fond: c.fond || '#0b0b0d',
      fond2: c.fond2 || '#1d1f26',
      texte: c.texte || '#ffffff',
      accent: c.accent || '#d8ff3c',
      accentTexte: c.accent_texte || '#0b0b0d',
      doux: c.texte_doux || 'rgba(255,255,255,0.68)',
    };
  }

  // Recale horizontalement un élément de largeur w (centré en x) dans la zone sûre.
  function inSafeX(ctx, x, w) {
    const S = ctx.L.safe;
    if (w >= S.w) return S.cx;
    return clamp(x, S.x + w / 2, S.r - w / 2);
  }

  function fmtPrice(v, devise = '€') {
    const cents = Math.round(v * 100);
    const e = Math.floor(cents / 100);
    const c = cents % 100;
    const n = c ? `${e},${String(c).padStart(2, '0')}` : `${e}`;
    return devise === '€' ? `${n} €` : `${devise}${n}`;
  }

  /* ------------------------------------------------------------------------
   * Fond : dégradé, deux nappes de lumière, rayures fines, grain.
   * Éclairs (flash) et volets de couleur (wipe) sur les temps forts.
   * ---------------------------------------------------------------------- */

  function background(ctx, opts = {}) {
    const { L } = ctx;
    const C = colors(ctx);
    // Réglages par défaut de la marque (« fond » dans marque.json), puis ceux du modèle.
    const o = Object.assign({}, (ctx.spec.marque && ctx.spec.marque.fond) || {}, opts);
    // Tout le fond est dessiné dans un seul canvas : une image précalculée
    // (dégradé, rayures, grain), deux halos, les volets et les éclairs. Des
    // calques DOM plein cadre coûteraient ~150 ms par capture.
    const cv = el('canvas', { parent: ctx.back, style: { width: L.W + 'px', height: L.H + 'px' } });
    cv.width = L.W;
    cv.height = L.H;
    const g = cv.getContext('2d');
    const base = bakeBackdrop(ctx, C, o);
    const glow = radialSprite(o.lumiere || C.accent);
    const R = Math.max(L.W, L.H) * 0.9;
    const poolAlpha = o.halo == null ? [0.2, 0.12] : [o.halo, o.halo * 0.6];
    const wipes = [];
    const flashes = [];
    put(cv, { x: 0, y: 0, ax: 0, ay: 0 });

    const part = {
      flash(t, force = 0.32) {
        flashes.push([t, force]);
        return part;
      },
      // Volet diagonal qui recouvre le fond d'une nouvelle couleur.
      wipe(t, color, dir = 1) {
        wipes.push({ t, color, dir });
        ctx.cue(t + 0.12, 'whoosh', { gain: 0.7 });
        return part;
      },
      seek(t) {
        g.globalAlpha = 1;
        g.drawImage(base, 0, 0);
        for (const w of wipes) {
          const e = stepR(t - w.t, SP.vif);
          if (e <= 0) continue;
          g.save();
          g.fillStyle = w.color;
          g.translate(L.W / 2, L.H / 2);
          g.rotate((-12 * Math.PI) / 180);
          // Panneau de largeur 2D : hors cadre à e = 0, couvre [-D, D] à e = 1.
          const D = Math.hypot(L.W, L.H);
          const x0 = w.dir > 0 ? lerp(-3 * D, -D, e) : lerp(D, -D, e);
          g.fillRect(x0, -D, 2 * D, D * 2);
          g.restore();
        }
        [0, 1].forEach((i) => {
          const a = t * (i ? 0.21 : 0.17) + i * 2.1;
          const x = L.W * (i ? 0.78 : 0.24) + Math.cos(a) * L.W * 0.08;
          const y = L.H * (i ? 0.8 : 0.22) + Math.sin(a * 1.3) * L.H * 0.05;
          g.globalAlpha = poolAlpha[i];
          g.drawImage(glow, x - R / 2, y - R / 2, R, R);
        });
        let f = 0;
        for (const [tf, k] of flashes) if (t >= tf) f = Math.max(f, k * Math.exp(-(t - tf) / 0.11));
        if (f > 0.002) {
          g.globalAlpha = f;
          g.fillStyle = C.accent;
          g.fillRect(0, 0, L.W, L.H);
        }
        g.globalAlpha = 1;
      },
    };
    return ctx.add(part);
  }

  function bakeBackdrop(ctx, C, o) {
    const { L } = ctx;
    const c = document.createElement('canvas');
    c.width = L.W;
    c.height = L.H;
    const g = c.getContext('2d');
    const rg = g.createRadialGradient(L.W / 2, L.H * 0.3, 0, L.W / 2, L.H * 0.3, Math.max(L.W, L.H) * 0.85);
    rg.addColorStop(0, C.fond2);
    rg.addColorStop(0.82, C.fond);
    rg.addColorStop(1, C.fond);
    g.fillStyle = rg;
    g.fillRect(0, 0, L.W, L.H);
    if (o.rayures !== false) {
      g.save();
      g.translate(L.W / 2, L.H / 2);
      g.rotate((25 * Math.PI) / 180);
      g.fillStyle = 'rgba(255,255,255,0.035)';
      const D = Math.hypot(L.W, L.H);
      for (let x = -D; x < D; x += 34) g.fillRect(x, -D, 2, D * 2);
      g.restore();
    }
    g.globalAlpha = 0.06;
    g.fillStyle = g.createPattern(grainCanvas(), 'repeat');
    g.fillRect(0, 0, L.W, L.H);
    return c;
  }

  function radialSprite(color) {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d');
    const rg = g.createRadialGradient(128, 128, 0, 128, 128, 128);
    rg.addColorStop(0, color);
    rg.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = rg;
    g.fillRect(0, 0, 256, 256);
    // Le dégradé vers « transparent noir » assombrit : on repasse en alpha pur.
    const d = g.getImageData(0, 0, 256, 256);
    const tmp = document.createElement('canvas').getContext('2d');
    tmp.fillStyle = color;
    tmp.fillRect(0, 0, 1, 1);
    const [r0, g0, b0] = tmp.getImageData(0, 0, 1, 1).data;
    for (let i = 0; i < d.data.length; i += 4) {
      const dist = Math.hypot(((i / 4) % 256) - 127.5, Math.floor(i / 4 / 256) - 127.5) / 128;
      d.data[i] = r0;
      d.data[i + 1] = g0;
      d.data[i + 2] = b0;
      d.data[i + 3] = Math.round(255 * Math.max(0, 1 - dist) ** 1.6);
    }
    g.putImageData(d, 0, 0);
    return c;
  }

  function grainCanvas() {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d');
    const d = g.createImageData(256, 256);
    const r = window.MM.rng(99);
    for (let i = 0; i < d.data.length; i += 4) {
      const v = r() < 0.5 ? 0 : 255;
      d.data[i] = d.data[i + 1] = d.data[i + 2] = v;
      d.data[i + 3] = Math.floor(r() * 255);
    }
    g.putImageData(d, 0, 0);
    return c;
  }

  // Ombre portée précalculée : la silhouette floutée une seule fois.
  function bakedShadow(img, w, h, blur) {
    const pad = blur * 3;
    const k = 0.5; // demi-résolution : une ombre floue n'a pas besoin de plus
    const c = document.createElement('canvas');
    c.width = Math.ceil((w + pad * 2) * k);
    c.height = Math.ceil((h + pad * 2) * k);
    const g = c.getContext('2d');
    g.filter = `blur(${blur * k}px) brightness(0)`;
    g.drawImage(img, pad * k, pad * k, w * k, h * k);
    return { src: c.toDataURL('image/png'), pad };
  }

  // Halo de couleur : la silhouette très floutée, teintée, posée derrière le produit.
  function bakedGlow(img, w, h, blur, color) {
    const pad = blur * 3;
    const k = 0.35;
    const c = document.createElement('canvas');
    c.width = Math.ceil((w + pad * 2) * k);
    c.height = Math.ceil((h + pad * 2) * k);
    const g = c.getContext('2d');
    g.filter = `blur(${blur * k}px)`;
    g.drawImage(img, pad * k, pad * k, w * k, h * k);
    g.filter = 'none';
    g.globalCompositeOperation = 'source-in';
    g.fillStyle = color;
    g.fillRect(0, 0, c.width, c.height);
    return { src: c.toDataURL('image/png'), pad };
  }

  /* ------------------------------------------------------------------------
   * Titre : lignes empilées qui claquent une par une sur les temps.
   * justify : chaque ligne remplit la même largeur (affiche sportive).
   * ---------------------------------------------------------------------- */

  function title(ctx, lines, o) {
    const C = colors(ctx);
    const parent = o.parent || ctx.hud;
    const maxW = o.maxW;
    const nodes = lines.map((ln, i) => {
      const text = typeof ln === 'string' ? ln : ln.text;
      const accent = typeof ln === 'object' ? ln.accent : o.accentLast !== false && i === lines.length - 1 && lines.length > 1;
      const n = el('div', {
        parent,
        cls: 'mm-titre',
        text,
        qa: 'texte',
        style: { color: accent ? C.accent : o.color || C.texte },
      });
      if (accent) n.dataset.accent = '1';
      if (o.justify === false) fit(n, maxW, o.size, o.size * 0.4);
      else fit(n, maxW, Math.min(o.size * 1.7, o.maxSize || 1e9), o.size * 0.4);
      return n;
    });
    const sizes = nodes.map((n) => parseFloat(n.style.fontSize));
    const gap = o.gap == null ? o.size * 0.06 : o.gap;
    const heights = sizes.map((s) => s * 0.92);
    const total = heights.reduce((a, b) => a + b, 0) + gap * (lines.length - 1);
    let y = o.cy != null ? o.cy - total / 2 : o.y;
    const ys = heights.map((h) => {
      const c = y + h / 2;
      y += h + gap;
      return c;
    });
    const step = o.step == null ? ctx.beat : o.step;
    const tins = o.tins || lines.map((_, i) => o.t0 + i * step);
    const from = o.from == null ? 1.32 : o.from;
    tins.forEach((ti, i) => {
      if (ti > 0.05 && o.cue !== false) ctx.cue(ti + 0.03, o.cue || 'impact', { gain: 0.85 - i * 0.08 });
    });
    if (o.flash && ctx.bg) tins.forEach((ti) => ti > 0.05 && ctx.bg.flash(ti + 0.02, 0.18));

    const part = {
      nodes,
      top: ys[0] - heights[0] / 2,
      bottom: ys[ys.length - 1] + heights[heights.length - 1] / 2,
      height: total,
      seek(t) {
        nodes.forEach((n, i) => {
          const tout = o.tout == null ? null : o.tout + i * (o.outStep == null ? 0.035 : o.outStep);
          const v = vis(t, tins[i], tout, { sp: SP.claque });
          const slam = 1 + (1 - clamp(stepR(t - tins[i], SP.claque), -0.2, 1.2)) * (from - 1);
          put(n, {
            x: o.x,
            y: ys[i] - v.x * (o.outY == null ? o.size * 0.5 : o.outY),
            s: slam * (1 - v.x * 0.08),
            o: v.o,
            b: v.b,
          });
        });
      },
    };
    return ctx.add(part);
  }

  /* ------------------------------------------------------------------------
   * Texte simple, une ligne.
   * ---------------------------------------------------------------------- */

  function text(ctx, str, o) {
    const C = colors(ctx);
    const n = el('div', {
      parent: o.parent || ctx.hud,
      cls: o.titre ? 'mm-titre' : 'mm-texte',
      text: str,
      qa: o.qa || 'texte',
      style: {
        color: o.color || C.texte,
        fontWeight: String(o.weight || (o.titre ? 400 : 800)),
        textTransform: o.upper ? 'uppercase' : '',
        letterSpacing: o.tracking || '',
      },
    });
    if (o.maxW) fit(n, o.maxW, o.size, o.size * 0.55);
    else n.style.fontSize = o.size + 'px';
    const dy = o.dy == null ? o.size * 0.35 : o.dy;
    return ctx.add({
      node: n,
      seek(t) {
        const v = vis(t, o.tin, o.tout);
        const x = typeof o.x === 'function' ? o.x(t) : o.x;
        put(n, {
          x: o.ax == null ? inSafeX(ctx, x, n.offsetWidth + 4) : x,
          y: (typeof o.y === 'function' ? o.y(t) : o.y) + (1 - clamp(v.e)) * dy - v.x * dy * 0.6,
          ax: o.ax,
          ay: o.ay,
          o: v.o,
          b: v.b,
        });
      },
    });
  }

  /* ------------------------------------------------------------------------
   * Produit : la photo du maillot dans le monde (suivie par la caméra).
   * Pistes x, y, s (échelle), r (rotation), o ; reflet, flottement, ombre.
   * Les enfants (flocage) se placent en coordonnées locales de la photo.
   * ---------------------------------------------------------------------- */

  function isCutout(img) {
    try {
      const c = document.createElement('canvas');
      c.width = c.height = 32;
      const g = c.getContext('2d');
      g.drawImage(img, 0, 0, 32, 32);
      const d = g.getImageData(0, 0, 32, 32).data;
      let clear = 0;
      let total = 0;
      for (let i = 0; i < 32; i++)
        for (const [x, y] of [
          [i, 0],
          [i, 31],
          [0, i],
          [31, i],
        ]) {
          total++;
          if (d[(y * 32 + x) * 4 + 3] < 16) clear++;
        }
      return clear / total > 0.7;
    } catch (e) {
      return false;
    }
  }

  function product(ctx, img, o) {
    const { L } = ctx;
    const aspect = img.naturalWidth / img.naturalHeight;
    const h0 = o.h;
    const w0 = h0 * aspect;
    const cutout = o.detoure == null ? isCutout(img) : !!o.detoure;
    const wrap = el('div', {
      parent: o.parent || ctx.world,
      style: { width: w0 + 'px', height: h0 + 'px' },
    });
    if (cutout && o.halo) {
      const gl = bakedGlow(img, w0, h0, h0 * 0.09, o.halo);
      const glow = el('img', {
        parent: wrap,
        cls: 'mm-img',
        style: { position: 'absolute', left: -gl.pad + 'px', top: -gl.pad + 'px', width: w0 + gl.pad * 2 + 'px', height: h0 + gl.pad * 2 + 'px' },
      });
      glow.src = gl.src;
      wrap.mmGlow = glow;
    }
    if (cutout) {
      const sh = bakedShadow(img, w0, h0, h0 * 0.04);
      const shadow = el('img', {
        parent: wrap,
        cls: 'mm-img',
        style: {
          position: 'absolute',
          left: -sh.pad + 'px',
          top: -sh.pad + h0 * 0.035 + 'px',
          width: w0 + sh.pad * 2 + 'px',
          height: h0 + sh.pad * 2 + 'px',
          opacity: '0.55',
        },
      });
      shadow.src = sh.src;
    }
    const im = el('img', { parent: wrap, cls: 'mm-img', style: { position: 'relative', width: '100%', height: '100%' } });
    im.src = img.src;
    const shine = el('div', {
      parent: wrap,
      cls: cutout ? 'mm-mask' : '',
      style: {
        position: 'absolute',
        left: '0',
        top: '0',
        width: '100%',
        height: '100%',
        backgroundImage:
          'linear-gradient(105deg, transparent 38%, rgba(255,255,255,0.5) 49%, rgba(255,255,255,0.12) 53%, transparent 62%)',
        backgroundSize: '300% 100%',
        mixBlendMode: 'soft-light',
      },
    });
    if (cutout) {
      shine.style.webkitMaskImage = `url("${img.src}")`;
      shine.style.maskImage = `url("${img.src}")`;
    } else {
      wrap.style.borderRadius = h0 * 0.035 + 'px';
      wrap.style.overflow = 'hidden';
      wrap.style.boxShadow = `0 ${h0 * 0.04}px ${h0 * 0.08}px rgba(0,0,0,0.45)`;
      im.style.objectFit = 'cover';
    }
    const st = o.start || {};
    const p = {
      node: wrap,
      w0,
      h0,
      cutout,
      x: new Track(st.x ?? o.x),
      y: new Track(st.y ?? o.y),
      s: new Track(st.s ?? 1),
      r: new Track(st.r ?? 0),
      o: new Track(st.o ?? 1),
      rx: new Track(st.rx ?? 0), // inclinaison 3D
      ry: new Track(st.ry ?? 0),
      lum: new Track(st.lum ?? 1), // luminosité du maillot (0 : silhouette noire)
      halo: new Track(st.halo ?? 1), // intensité du halo de couleur
      shines: [],
      floatFrom: o.floatFrom,
      move(t, to, sp = SP.vif) {
        for (const k of ['x', 'y', 's', 'r', 'o', 'lum', 'halo', 'rx', 'ry']) if (to[k] != null) p[k].to(t, to[k], sp);
        return p;
      },
      shine(t) {
        p.shines.push(t);
        ctx.cue(t + 0.22, 'brillance', { gain: 0.55 });
        return p;
      },
      state(t) {
        let y = p.y.at(t);
        let r = p.r.at(t);
        if (p.floatFrom != null) {
          const k = range(t, p.floatFrom, p.floatFrom + 0.9);
          const a = t - p.floatFrom;
          y += Math.sin((2 * Math.PI * a) / 3.4) * h0 * 0.009 * k;
          r += Math.sin((2 * Math.PI * a) / 4.6) * 0.7 * k;
        }
        return { x: p.x.at(t), y, s: p.s.at(t), r, o: p.o.at(t) };
      },
      // Point (fx, fy) de la photo, en coordonnées monde.
      pointAt(t, fx, fy) {
        const s = p.state(t);
        const lx = (fx - 0.5) * w0 * s.s;
        const ly = (fy - 0.5) * h0 * s.s;
        const a = (s.r * Math.PI) / 180;
        return { x: s.x + lx * Math.cos(a) - ly * Math.sin(a), y: s.y + lx * Math.sin(a) + ly * Math.cos(a) };
      },
      screenAt(t, fx, fy) {
        const w = p.pointAt(t, fx, fy);
        return ctx.cam.toScreen(t, w.x, w.y);
      },
      seek(t) {
        const s = p.state(t);
        put(wrap, { x: s.x, y: s.y, s: s.s, r: s.r, rx: p.rx.at(t), ry: p.ry.at(t), o: s.o, b: (o.flouOpacite === false ? 0 : (1 - clamp(s.o)) * 14) + (p.blur ? p.blur(t) : 0) });
        const lum = p.lum.at(t);
        im.style.filter = lum < 0.995 ? `brightness(${Math.max(0, lum).toFixed(3)})` : '';
        if (wrap.mmGlow) wrap.mmGlow.style.opacity = clamp(p.halo.at(t)).toFixed(3);
        // Le reflet n'existe que pendant son passage (un masque coûte cher).
        let pos = null;
        for (const ts of p.shines) if (t >= ts && t <= ts + 0.8) pos = lerp(130, -30, E.inOutSine(range(t, ts, ts + 0.8)));
        shine.style.display = pos == null ? 'none' : '';
        if (pos != null) shine.style.backgroundPosition = `${pos}% 0`;
      },
    };
    return ctx.add(p);
  }

  /* ------------------------------------------------------------------------
   * Point d'intérêt : un point sur le maillot, un trait qui se trace, une
   * étiquette. La position suit le produit et la caméra.
   * ---------------------------------------------------------------------- */

  function callout(ctx, o) {
    const { L } = ctx;
    const C = colors(ctx);
    const u = L.u;
    const size = o.size || u * 4.4;
    const dot = el('div', {
      parent: ctx.hud,
      style: {
        width: u * 2.4 + 'px',
        height: u * 2.4 + 'px',
        borderRadius: '50%',
        background: C.accent,
        boxShadow: `0 0 0 ${u * 0.5}px rgba(0,0,0,0.25)`,
      },
    });
    const ring = el('div', {
      parent: ctx.hud,
      style: { width: u * 2.4 + 'px', height: u * 2.4 + 'px', borderRadius: '50%', border: `${u * 0.35}px solid ${C.accent}` },
    });
    const line = el('div', { parent: ctx.hud, style: { height: Math.max(2, u * 0.35) + 'px', background: C.accent } });
    const label = el('div', {
      parent: ctx.hud,
      cls: 'mm-pill',
      qa: 'texte',
      html: (o.icon ? icon(o.icon) : '') + `<span>${escapeHtml(o.label)}</span>`,
      style: {
        fontSize: size + 'px',
        padding: '0.38em 0.8em',
        background: o.fond || 'rgba(12,12,14,0.82)',
        color: C.texte,
        border: `${Math.max(2, u * 0.25)}px solid ${C.accent}`,
      },
    });
    if (o.maxW) fit(label, o.maxW, size, size * 0.6);
    const lw = label.offsetWidth;
    const side = o.side || (o.fx < 0.5 ? -1 : 1);
    const S = L.safe;
    ctx.cue(o.tin, 'pop', { gain: 0.7, pitch: o.pitch || 0 });
    ctx.cue(o.tin + 0.2, 'tic', { gain: 0.5 });

    return ctx.add({
      seek(t) {
        const d = o.product.screenAt(t, o.fx, o.fy);
        const vd = vis(t, o.tin, o.tout, { sp: SP.pop });
        const vl = vis(t, o.tin + 0.12, o.tout);
        // Points hauts (écusson, col, manches) : étiquette au-dessus ; sinon à côté.
        const off = o.dy != null ? o.dy : o.fy < 0.4 ? -u * 13 : u * 4;
        const ly = clamp(d.y + off, S.y + size, S.b - size);
        const lx = clamp(d.x + side * (o.dist || u * 22), S.x + lw / 2, S.r - lw / 2);
        const pop = clamp(stepR(t - o.tin, SP.pop), 0, 1.3);
        put(dot, { x: d.x, y: d.y, s: pop * (1 - vd.x), o: vd.o });
        const rk = range(t, o.tin, o.tin + 0.6);
        put(ring, { x: d.x, y: d.y, s: 1 + rk * 2.2, o: rk > 0 && rk < 1 ? (1 - rk) * 0.8 * vd.o : 0 });
        // Le trait va du point au bord de l'étiquette.
        const ex = lx - (side * lw) / 2;
        const dx = ex - d.x;
        const dy = ly - d.y;
        const len = Math.hypot(dx, dy);
        const k = E.outCubic(range(t, o.tin + 0.05, o.tin + 0.35)) * (1 - vl.x);
        line.style.width = len + 'px';
        put(line, { x: d.x, y: d.y, ax: 0, ay: 0.5, r: (Math.atan2(dy, dx) * 180) / Math.PI, sx: k, o: vd.o });
        put(label, { x: lx, y: ly + (1 - clamp(vl.e)) * size * 0.4, o: vl.o, b: vl.b });
      },
    });
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  }

  /* ------------------------------------------------------------------------
   * Compteur à rouleaux : chaque chiffre de `text` défile jusqu'à sa valeur ;
   * un chiffre ne bouge que lorsque celui de droite fait sa retenue.
   * ---------------------------------------------------------------------- */

  function odometer(ctx, o) {
    const C = colors(ctx);
    const size = o.size;
    const lh = size * 1.16;
    const row = el('div', {
      parent: o.parent || ctx.hud,
      cls: o.titre === false ? 'mm-texte' : 'mm-titre',
      qa: 'texte',
      style: {
        display: 'flex',
        alignItems: 'flex-start',
        fontSize: size + 'px',
        lineHeight: lh + 'px',
        height: lh + 'px',
        color: o.color || C.texte,
        whiteSpace: 'nowrap',
      },
    });
    row.dataset.qaLabel = o.text;
    const digits = o.text.replace(/\D/g, '');
    const value = parseInt(digits || '0', 10);
    const slots = [];
    let place = digits.length - 1;
    for (const ch of o.text) {
      if (/\d/.test(ch)) {
        const probe = el('span', { parent: row, text: ch });
        const w = probe.getBoundingClientRect().width;
        probe.remove();
        const slot = el('span', { parent: row, cls: 'mm-digit', style: { width: w + 'px', height: lh + 'px' } });
        const strip = el('span', { parent: slot, cls: 'mm-strip' });
        for (let d = 0; d <= 10; d++) el('span', { parent: strip, text: String(d % 10), style: { height: lh + 'px' } });
        slots.push({ strip, p: place-- });
      } else {
        el('span', { parent: row, text: ch === ' ' ? ' ' : ch, style: { fontSize: o.symbolScale ? o.symbolScale * 100 + '%' : '' } });
      }
    }
    // Les rangs « vides » (strip enfants) ne doivent pas être positionnés en absolu.
    row.querySelectorAll('span').forEach((s) => (s.style.position = s.classList.contains('mm-strip') ? 'absolute' : 'relative'));
    const roll = o.roll == null ? 0.9 : o.roll;
    const val = (t) => value * E.outQuart(range(t, o.tin, o.tin + roll));
    // Tics sonores quand le chiffre des unités change, espacés d'au moins 45 ms.
    if (o.cue !== false && value > 0) {
      const unit = Math.pow(10, Math.max(0, (o.unitPlace ?? 0)));
      let last = -1;
      let lastT = -1;
      for (let i = 0; i <= 160; i++) {
        const t = o.tin + (roll * i) / 160;
        const k = Math.floor(val(t) / unit);
        if (k !== last && t - lastT > 0.045) {
          if (last >= 0) ctx.cue(t, 'tic', { gain: 0.35, pitch: (i / 160) * 5 });
          last = k;
          lastT = t;
        }
      }
      ctx.cue(o.tin + roll * 0.8, o.endCue || 'caisse', { gain: 0.8 });
    }
    return ctx.add({
      node: row,
      seek(t) {
        const v = val(t);
        for (const s of slots) {
          const pv = Math.pow(10, s.p);
          const d = (Math.floor(v / pv) % 10) + Math.max(0, (v % pv) - (pv - 1));
          s.strip.style.transform = `translateY(${(-d * lh).toFixed(2)}px)`;
        }
        const e = vis(t, o.tin - 0.12, o.tout, { sp: SP.claque });
        const s = 1 + (1 - clamp(stepR(t - (o.tin - 0.12), SP.claque), -0.2, 1.2)) * 0.25;
        put(row, {
          x: typeof o.x === 'function' ? o.x(t) : o.x,
          y: typeof o.y === 'function' ? o.y(t) : o.y,
          ax: o.ax,
          ay: o.ay,
          s: s * (o.scale ? o.scale(t) : 1),
          o: e.o,
          b: e.b,
        });
      },
    });
  }

  /* ------------------------------------------------------------------------
   * Prix : ancien prix barré au-dessus, prix à rouleaux dessous.
   * ---------------------------------------------------------------------- */

  function price(ctx, o) {
    const C = colors(ctx);
    const devise = o.devise || '€';
    const parts = [];
    let oldNode = null;
    let bar = null;
    const yMain = o.old ? o.y + o.size * 0.38 : o.y;
    if (o.old) {
      oldNode = el('div', {
        parent: ctx.hud,
        cls: 'mm-texte',
        text: fmtPrice(o.old, devise),
        qa: 'texte',
        style: { fontSize: Math.max(o.size * 0.36, ctx.L.u * 3.4) + 'px', color: C.doux, fontWeight: '600' },
      });
      bar = el('div', { parent: ctx.hud, style: { height: Math.max(3, o.size * 0.035) + 'px', background: C.accent } });
      ctx.cue(o.tin + 0.5, 'swipe', { gain: 0.5 });
    }
    const main = odometer(ctx, {
      text: fmtPrice(o.value, devise),
      x: o.x,
      y: yMain,
      ax: o.ax,
      size: o.size,
      tin: o.tin,
      tout: o.tout,
      roll: o.roll,
      color: o.color || C.texte,
      unitPlace: 2,
      symbolScale: 0.62,
    });
    parts.push(main);
    if (oldNode) {
      const ow = oldNode.offsetWidth;
      ctx.add({
        seek(t) {
          const v = vis(t, o.tin - 0.2, o.tout);
          const oy = yMain - o.size * 0.9;
          const ox = o.ax === 0 ? o.x + ow / 2 : o.x;
          put(oldNode, { x: ox, y: oy, o: v.o * 0.9, b: v.b });
          const k = E.outCubic(range(t, o.tin + 0.42, o.tin + 0.62));
          bar.style.width = ow * 1.08 + 'px';
          put(bar, { x: ox, y: oy + o.size * 0.02, r: -8, sx: k, o: v.o });
        },
      });
    }
    return { main, top: yMain - o.size * (o.old ? 1.1 : 0.6), bottom: yMain + o.size * 0.6 };
  }

  /* ------------------------------------------------------------------------
   * Bouton d'appel à l'action, avec appui (onde) et reflet périodique.
   * ---------------------------------------------------------------------- */

  function button(ctx, o) {
    const C = colors(ctx);
    const n = el('div', {
      parent: ctx.hud,
      cls: 'mm-pill',
      qa: 'cta',
      html: `<span>${escapeHtml(o.text)}</span>` + icon(o.icon || 'fleche'),
      style: {
        fontSize: o.size + 'px',
        padding: '0.62em 1.15em 0.62em 1.3em',
        background: o.fond || C.accent,
        color: o.couleur || C.accentTexte,
        overflow: 'hidden',
        boxShadow: `0 ${o.size * 0.3}px ${o.size * 0.8}px rgba(0,0,0,0.35)`,
      },
    });
    if (o.maxW) fit(n, o.maxW, o.size, o.size * 0.6);
    n.dataset.qaLabel = o.text;
    const sheen = el('div', {
      parent: n,
      style: {
        position: 'absolute',
        left: '0',
        top: '0',
        width: '100%',
        height: '100%',
        backgroundImage: 'linear-gradient(105deg, transparent 35%, rgba(255,255,255,0.55) 50%, transparent 65%)',
        backgroundSize: '320% 100%',
      },
    });
    const ring = el('div', {
      parent: ctx.hud,
      style: {
        width: n.offsetWidth + 'px',
        height: n.offsetHeight + 'px',
        borderRadius: '999px',
        border: `${Math.max(3, o.size * 0.08)}px solid ${o.fond || C.accent}`,
      },
    });
    const press = o.press || [];
    ctx.cue(o.tin + 0.04, 'pop', { gain: 0.8, pitch: -3 });
    press.forEach((tp) => ctx.cue(tp, 'clic', { gain: 0.9 }));
    return ctx.add({
      node: n,
      seek(t) {
        const e = stepR(t - o.tin, SP.claque);
        const v = vis(t, o.tin, o.tout, { sp: SP.claque });
        let dip = 1;
        let rk = -1;
        for (const tp of press) {
          dip -= 0.075 * Math.exp(-Math.pow((t - tp) / 0.07, 2));
          if (t >= tp && t < tp + 0.5) rk = (t - tp) / 0.5;
        }
        const x = inSafeX(ctx, typeof o.x === 'function' ? o.x(t) : o.x, n.offsetWidth + 4);
        const y = typeof o.y === 'function' ? o.y(t) : o.y;
        put(n, { x, y, s: lerp(0.55, 1, clamp(e, 0, 1.15)) * dip, o: v.o, b: v.b });
        put(ring, { x, y, s: rk < 0 ? 1 : 1 + E.outCubic(rk) * 0.35, o: rk < 0 ? 0 : (1 - rk) * 0.7 });
        const period = 2.6;
        const ph = t > o.tin + 0.6 ? ((t - o.tin - 0.6) % period) / 0.9 : 2;
        sheen.style.backgroundPosition = `${ph <= 1 ? lerp(120, -20, E.inOutSine(ph)) : 120}% 0`;
      },
    });
  }

  /* ------------------------------------------------------------------------
   * Pastille : icône + texte court.
   * ---------------------------------------------------------------------- */

  function badge(ctx, o) {
    const C = colors(ctx);
    const styles = {
      accent: { background: C.accent, color: C.accentTexte, border: 'none' },
      contour: { background: 'transparent', color: C.texte, border: `${Math.max(2, o.size * 0.08)}px solid ${C.texte}` },
      sombre: { background: 'rgba(12,12,14,0.8)', color: C.texte, border: 'none' },
      clair: { background: C.texte, color: C.fond, border: 'none' },
    };
    const n = el('div', {
      parent: o.parent || ctx.hud,
      cls: o.titre ? 'mm-pill mm-titre' : 'mm-pill',
      qa: 'texte',
      html: (o.icon ? icon(o.icon) : '') + `<span>${escapeHtml(o.text)}</span>`,
      style: Object.assign({ fontSize: o.size + 'px', padding: '0.4em 0.85em' }, styles[o.style || 'sombre']),
    });
    if (o.maxW) fit(n, o.maxW, o.size, o.size * 0.6);
    n.dataset.qaLabel = o.text;
    // Largeur occupée, rotation comprise.
    const rad = ((o.r || 0) * Math.PI) / 180;
    const bw = n.offsetWidth * Math.abs(Math.cos(rad)) + n.offsetHeight * Math.abs(Math.sin(rad)) + 6;
    if (o.cue !== false) ctx.cue(o.tin, o.cue || 'pop', { gain: 0.6, pitch: o.pitch || 2 });
    return ctx.add({
      node: n,
      w: n.offsetWidth,
      h: n.offsetHeight,
      seek(t) {
        const v = vis(t, o.tin, o.tout, { sp: SP.pop });
        const s = lerp(0.6, 1, clamp(stepR(t - o.tin, SP.pop), 0, 1.2));
        const x = typeof o.x === 'function' ? o.x(t) : o.x;
        put(n, {
          x: o.ax == null ? inSafeX(ctx, x, bw) : x,
          y: typeof o.y === 'function' ? o.y(t) : o.y,
          ax: o.ax,
          ay: o.ay,
          s,
          r: o.r || 0,
          o: v.o,
          b: v.b,
        });
      },
    });
  }

  /* ------------------------------------------------------------------------
   * Logo de la boutique : image si fournie, sinon le nom en lettrage.
   * ---------------------------------------------------------------------- */

  async function logo(ctx, o) {
    const C = colors(ctx);
    const m = ctx.spec.marque || {};
    let n;
    if (m.logo) {
      const img = await ctx.image(m.logo);
      n = el('img', { parent: ctx.hud, qa: 'logo', style: { height: o.h + 'px', width: (o.h * img.naturalWidth) / img.naturalHeight + 'px' } });
      n.src = img.src;
      n.dataset.qaLabel = 'logo';
    } else {
      n = el('div', {
        parent: ctx.hud,
        cls: 'mm-titre',
        qa: 'logo',
        text: m.nom || 'Votre boutique',
        style: { fontSize: o.h + 'px', color: o.color || C.texte, letterSpacing: '0.06em' },
      });
      if (o.maxW) fit(n, o.maxW, o.h, o.h * 0.5);
    }
    return ctx.add({
      node: n,
      seek(t) {
        const v = vis(t, o.tin, o.tout);
        put(n, { x: o.x, y: o.y + (1 - clamp(v.e)) * o.h * 0.4, ax: o.ax, ay: o.ay, o: v.o, b: v.b });
      },
    });
  }

  /* ------------------------------------------------------------------------
   * Curseur de souris : se déplace sur ressort, s'enfonce et fait une onde
   * à chaque clic. points : [[t, x, y], …] dans le repère du calque choisi
   * (ctx.world par défaut : il suit la caméra, comme dans un enregistrement d'écran).
   * ---------------------------------------------------------------------- */

  function curseur(ctx, o) {
    const C = colors(ctx);
    const size = o.size || ctx.L.u * 3.2;
    const parent = o.parent || ctx.world;
    const n = el('div', {
      parent,
      html: `<svg viewBox="0 0 24 24" width="${size}" height="${size}" style="display:block;overflow:visible;filter:drop-shadow(0 ${size * 0.08}px ${size * 0.12}px rgba(0,0,0,.45))"><path d="M3 2l15.5 9.2-6.6 1.5 3.9 7.6-3 1.5-3.9-7.6L4 18.6z" fill="#fff" stroke="#111" stroke-width="1.4" stroke-linejoin="round"/></svg>`,
    });
    const ring = el('div', { parent, style: { width: size * 1.2 + 'px', height: size * 1.2 + 'px', borderRadius: '50%', border: `${Math.max(2, size * 0.09)}px solid ${o.couleur || C.accent}` } });
    const pts = o.points;
    const X = new Track(pts[0][1]);
    const Y = new Track(pts[0][2]);
    for (const [t, x, y] of pts.slice(1)) {
      X.to(t, x, o.sp || SP.vif);
      Y.to(t, y, o.sp || SP.vif);
    }
    const clicks = o.clics || [];
    clicks.forEach((tc) => ctx.cue(tc, 'clic', { gain: 0.9 }));
    return ctx.add({
      seek(t) {
        const v = vis(t, o.tin, o.tout, { sp: SP.pop });
        let dip = 1;
        let rk = -1;
        let rx = 0;
        let ry = 0;
        for (const tc of clicks) {
          dip -= 0.18 * Math.exp(-Math.pow((t - tc) / 0.06, 2));
          if (t >= tc && t < tc + 0.5) {
            rk = (t - tc) / 0.5;
            rx = X.at(tc);
            ry = Y.at(tc);
          }
        }
        const x = X.at(t);
        const y = Y.at(t);
        put(n, { x, y, ax: 0.12, ay: 0.08, s: dip * (0.6 + 0.4 * clamp(v.e)), o: v.o });
        put(ring, { x: rx, y: ry, s: rk < 0 ? 1 : 0.6 + E.outCubic(rk) * 1.6, o: rk < 0 ? 0 : (1 - rk) * 0.8 });
      },
    });
  }

  /* ------------------------------------------------------------------------
   * Bandeau défilant (décoratif) : « AUTHENTIQUE • LIVRAISON OFFERTE • ».
   * ---------------------------------------------------------------------- */

  function ticker(ctx, o) {
    const C = colors(ctx);
    const { L } = ctx;
    const band = el('div', {
      parent: o.parent || ctx.back,
      cls: 'mm-titre',
      qa: 'deco',
      style: {
        width: L.W * 2.2 + 'px',
        fontSize: o.size + 'px',
        padding: `${o.size * 0.22}px 0`,
        background: o.fond || C.accent,
        color: o.couleur || C.accentTexte,
        overflow: 'hidden',
      },
    });
    const unit = el('span', { parent: band, text: o.text + ' • ', style: { position: 'relative' } });
    const uw = unit.offsetWidth;
    // Assez large pour couvrir l'image quel que soit le décalage du défilement.
    const bw = L.W * 1.3 + uw * 2;
    band.style.width = bw + 'px';
    band.textContent = (o.text + ' • ').repeat(Math.ceil(bw / uw) + 1);
    band.style.whiteSpace = 'nowrap';
    return ctx.add({
      seek(t) {
        const e = stepR(t - o.tin, SP.vif);
        const off = ((t * (o.speed || L.u * 9)) % uw) * (o.dir || 1);
        put(band, {
          x: L.W / 2 + uw / 2 - off + (1 - e) * L.W * 1.4 * (o.dir || 1),
          y: o.y,
          r: o.r == null ? -4 : o.r,
          o: e > 0.001 ? 1 : 0,
        });
      },
    });
  }

  /* ------------------------------------------------------------------------
   * Lettres posées une à une (flocage). Placées dans le repère local du
   * produit pour suivre ses mouvements. arc > 0 : nom cintré.
   * ---------------------------------------------------------------------- */

  function letters(ctx, str, o) {
    const p = o.product;
    const size = o.size;
    const chars = [...str];
    const nodes = chars.map((ch) =>
      el('div', {
        parent: p.node,
        cls: 'mm-titre',
        text: ch,
        qa: o.qa || 'flocage',
        style: {
          position: 'absolute',
          left: '0',
          top: '0',
          fontSize: size + 'px',
          color: o.color,
          letterSpacing: '0',
          lineHeight: '1',
          textShadow: o.ombre === false ? '' : `0 ${size * 0.03}px ${size * 0.04}px rgba(0,0,0,0.25)`,
        },
      }),
    );
    const widths = nodes.map((n) => n.offsetWidth);
    const spacing = size * (o.espacement == null ? 0.04 : o.espacement);
    const total = widths.reduce((a, b) => a + b, 0) + spacing * (chars.length - 1);
    // Rétrécit si le nom dépasse la largeur disponible.
    const maxW = o.maxW || p.w0 * 0.6;
    const k = total > maxW ? maxW / total : 1;
    if (k < 1) nodes.forEach((n) => (n.style.fontSize = size * k + 'px'));
    const ws = widths.map((w) => w * k);
    const cx = o.fx * p.w0;
    const cy = o.fy * p.h0;
    let x = cx - (total * k) / 2;
    const step = o.step || ctx.beat / 2;
    const pos = ws.map((w, i) => {
      const mid = x + w / 2;
      x += w + spacing * k;
      const rel = (mid - cx) / Math.max(1, (total * k) / 2);
      const arc = o.arc || 0;
      return { x: mid, y: cy + arc * size * rel * rel, r: arc * 9 * rel, t: o.t0 + i * step };
    });
    pos.forEach((q, i) => ctx.cue(q.t + 0.02, o.cue || 'tampon', { gain: 0.75, pitch: (i % 3) - 1 }));
    return ctx.add({
      end: pos.length ? pos[pos.length - 1].t : o.t0,
      seek(t) {
        nodes.forEach((n, i) => {
          const q = pos[i];
          const e = stepR(t - q.t, SP.claque);
          const v = vis(t, q.t, o.tout, { sp: SP.claque });
          put(n, { x: q.x, y: q.y, r: q.r, s: 1 + (1 - clamp(e, -0.2, 1.2)) * 0.9, o: v.o, b: v.b });
        });
      },
    });
  }

  window.MM.ui = { colors, inSafeX, fmtPrice, curseur, icon, background, title, text, product, callout, odometer, price, button, badge, logo, ticker, letters };
})();
