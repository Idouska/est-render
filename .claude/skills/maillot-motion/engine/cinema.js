/**
 * Effets de cinéma : stade de nuit, projecteurs volumétriques dans la fumée,
 * poussière dans la lumière, étincelles, reflets anamorphiques, barres
 * cinémascope, vignettage, grain de film, aberration chromatique, et textes de
 * bande-annonce.
 *
 * Comme le reste du moteur, tout est fonction pure de t : les textures sont
 * précalculées à la construction, et chaque image est redessinée dans deux
 * canvas (un derrière le produit, un par-dessus tout).
 */
(function () {
  'use strict';

  const { clamp, lerp, range, E, SP, Track, vis, el, put, rng } = window.MM;
  const ui = window.MM.ui;

  /* ------------------------------------------------------------------------
   * Outils
   * ---------------------------------------------------------------------- */

  // Hachage déterministe d'un entier → [0, 1).
  const hash = (n) => {
    const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
    return x - Math.floor(x);
  };

  function hexRgb(c) {
    const m = /^#?([0-9a-f]{6})$/i.exec(c || '');
    if (!m) return [255, 255, 255];
    const v = parseInt(m[1], 16);
    return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
  }
  const rgba = (c, a) => {
    const [r, g, b] = hexRgb(c);
    return `rgba(${r},${g},${b},${a})`;
  };

  // Bruit fractal raccordable (texture de fumée), en alpha, teinté.
  function fogTexture(size, seed, color, floor = 0) {
    const R = rng(seed);
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d');
    const img = g.createImageData(size, size);
    const acc = new Float32Array(size * size);
    let amp = 1;
    let total = 0;
    for (let cell = 8; cell <= 128; cell *= 2) {
      const grid = Array.from({ length: cell * cell }, () => R());
      const at = (i, j) => grid[((j + cell) % cell) * cell + ((i + cell) % cell)];
      for (let y = 0; y < size; y++)
        for (let x = 0; x < size; x++) {
          const fx = (x / size) * cell;
          const fy = (y / size) * cell;
          const i = Math.floor(fx);
          const j = Math.floor(fy);
          const u = fx - i;
          const v = fy - j;
          const su = u * u * (3 - 2 * u);
          const sv = v * v * (3 - 2 * v);
          const a = lerp(at(i, j), at(i + 1, j), su);
          const b = lerp(at(i, j + 1), at(i + 1, j + 1), su);
          acc[y * size + x] += lerp(a, b, sv) * amp;
        }
      total += amp;
      amp *= 0.55;
    }
    const [r, gg, b] = hexRgb(color);
    for (let i = 0; i < acc.length; i++) {
      const n = clamp((acc[i] / total - 0.3) / 0.5);
      img.data[i * 4] = r;
      img.data[i * 4 + 1] = gg;
      img.data[i * 4 + 2] = b;
      img.data[i * 4 + 3] = Math.round(255 * (floor + (1 - floor) * n * n));
    }
    g.putImageData(img, 0, 0);
    return c;
  }

  function radial(size, color, power = 1.6) {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d');
    const d = g.createImageData(size, size);
    const [r, gg, b] = hexRgb(color);
    const h = size / 2;
    for (let i = 0; i < size * size; i++) {
      const dist = Math.hypot((i % size) - h + 0.5, Math.floor(i / size) - h + 0.5) / h;
      d.data[i * 4] = r;
      d.data[i * 4 + 1] = gg;
      d.data[i * 4 + 2] = b;
      d.data[i * 4 + 3] = Math.round(255 * Math.max(0, 1 - dist) ** power);
    }
    g.putImageData(d, 0, 0);
    return c;
  }

  // Tiled fill of a texture, shifted by (ox, oy) and scaled.
  function tile(g, tex, W, H, ox, oy, scale) {
    const tw = tex.width * scale;
    const th = tex.height * scale;
    const sx = ((ox % tw) + tw) % tw;
    const sy = ((oy % th) + th) % th;
    for (let y = -th + sy; y < H; y += th) for (let x = -tw + sx; x < W; x += tw) g.drawImage(tex, x, y, tw, th);
  }

  /* ------------------------------------------------------------------------
   * Stade : fond sombre, rampes de projecteurs, faisceaux dans la fumée,
   * poussière. Remplace ui.background pour les modèles cinéma.
   * ---------------------------------------------------------------------- */

  function stade(ctx, o = {}) {
    const { L } = ctx;
    const W = L.W;
    const H = L.H;
    const cv = el('canvas', { parent: ctx.back, style: { width: W + 'px', height: H + 'px' } });
    cv.width = W;
    cv.height = H;
    put(cv, { x: 0, y: 0, ax: 0, ay: 0 });
    const g = cv.getContext('2d');

    // Fond précalculé : nuit bleutée en haut, noir en bas, très léger grain.
    const base = document.createElement('canvas');
    base.width = W;
    base.height = H;
    const bg = base.getContext('2d');
    const lin = bg.createLinearGradient(0, 0, 0, H);
    lin.addColorStop(0, o.ciel || '#0d1220');
    lin.addColorStop(0.55, '#06070b');
    lin.addColorStop(1, '#030304');
    bg.fillStyle = lin;
    bg.fillRect(0, 0, W, H);

    const fog = fogTexture(256, 11, o.brume || '#c9d3e6');
    const fogMask = fogTexture(256, 29, '#ffffff', 0.22);
    const glow = radial(256, '#ffffff', 2.2);
    const beamsCv = document.createElement('canvas');
    beamsCv.width = W;
    beamsCv.height = H;
    const bc = beamsCv.getContext('2d');
    // Masque de fumée assemblé en entier avant d'être appliqué : en mode
    // destination-in, chaque dessin efface tout ce qui est hors de lui.
    const maskCv = document.createElement('canvas');
    maskCv.width = W;
    maskCv.height = H;
    const mc = maskCv.getContext('2d');

    const beams = [];
    const flashes = [];
    const lumiere = new Track(o.lumiere == null ? 1 : o.lumiere);
    const R = rng(77);
    const motes = Array.from({ length: o.poussiere || 140 }, () => ({
      x: R() * W,
      y: R() * H,
      vx: (R() - 0.5) * 14,
      vy: -4 - R() * 10,
      f: 0.3 + R() * 0.8,
      ph: R() * 6.28,
      r: 1 + R() * 2.2,
    }));

    // Niveau d'un faisceau : scintillement à l'allumage, puis stable.
    function level(b, t) {
      if (t < b.on) return 0;
      const k = t - b.on;
      let v;
      if (k < 0.32) v = hash(Math.floor(k * 34) + b.seed) > 0.45 ? 0.6 + 0.4 * hash(Math.floor(k * 34) + 7) : 0.05;
      else v = 0.97 + 0.03 * Math.sin(t * 13 + b.seed);
      if (b.off != null) v *= 1 - range(t, b.off, b.off + 0.25);
      return v * (b.force || 1);
    }

    function angleAt(b, t) {
      if (!b.balayage) return b.angle;
      const s = b.balayage;
      return lerp(b.angle, s.vers, E.inOutSine(range(t, s.t0, s.t1)));
    }

    const part = {
      lumiere,
      /** Ajoute un projecteur. x, y : source ; angle : direction (90 = vers le bas). */
      faisceau(b) {
        b.seed = beams.length * 13 + 3;
        beams.push(Object.assign({ spread: 16, longueur: Math.hypot(W, H) * 1.1, couleur: '#eaf1ff', force: 1 }, b));
        if (b.on > 0.02 && b.son !== false) ctx.cue(b.on, 'projecteur', { gain: b.gain || 0.7, pitch: (beams.length % 3) - 1 });
        return part;
      },
      flash(t, couleur = '#ffffff', force = 0.5) {
        flashes.push([t, couleur, force]);
        return part;
      },
      seek(t) {
        const lum = clamp(lumiere.at(t), 0, 2);
        g.globalCompositeOperation = 'source-over';
        g.globalAlpha = 1;
        g.drawImage(base, 0, 0);

        // Fumée de fond, deux couches qui dérivent.
        g.globalAlpha = 0.07 + 0.08 * lum;
        tile(g, fog, W, H, t * 18, t * -6, Math.max(W, H) / 256 * 0.9);
        g.globalAlpha = 0.05 + 0.05 * lum;
        tile(g, fog, W, H, t * -11 + 90, t * 4, Math.max(W, H) / 256 * 1.6);

        // Faisceaux dessinés à part, modulés par la fumée, puis ajoutés.
        bc.globalCompositeOperation = 'source-over';
        bc.clearRect(0, 0, W, H);
        bc.globalCompositeOperation = 'lighter';
        const live = [];
        for (const b of beams) {
          const lv = level(b, t) * lum;
          if (lv <= 0.01) continue;
          const a = (angleAt(b, t) * Math.PI) / 180;
          live.push({ b, lv, a });
          // Cinq cônes emboîtés, du plus large au plus fin : bords doux, cœur lumineux.
          for (const [k, al] of [
            [1.15, 0.1],
            [0.85, 0.14],
            [0.6, 0.18],
            [0.38, 0.22],
            [0.18, 0.28],
          ]) {
            const sp = ((b.spread * k) / 2) * (Math.PI / 180);
            const grad = bc.createRadialGradient(b.x, b.y, 0, b.x, b.y, b.longueur);
            grad.addColorStop(0, rgba(b.couleur, Math.min(1, al * lv * 1.6)));
            grad.addColorStop(0.22, rgba(b.couleur, al * lv * 0.75));
            grad.addColorStop(0.55, rgba(b.couleur, al * lv * 0.22));
            grad.addColorStop(1, rgba(b.couleur, 0));
            bc.fillStyle = grad;
            bc.beginPath();
            bc.moveTo(b.x, b.y);
            bc.lineTo(b.x + Math.cos(a - sp) * b.longueur, b.y + Math.sin(a - sp) * b.longueur);
            bc.lineTo(b.x + Math.cos(a + sp) * b.longueur, b.y + Math.sin(a + sp) * b.longueur);
            bc.closePath();
            bc.fill();
          }
        }
        if (live.length) {
          mc.clearRect(0, 0, W, H);
          tile(mc, fogMask, W, H, t * 26, t * -9, (Math.max(W, H) / 256) * 1.1);
          bc.globalCompositeOperation = 'destination-in';
          bc.drawImage(maskCv, 0, 0);
          g.globalCompositeOperation = 'lighter';
          g.globalAlpha = 1;
          g.drawImage(beamsCv, 0, 0);
        }

        // Poussière : visible surtout dans la lumière.
        g.globalCompositeOperation = 'lighter';
        for (const m of motes) {
          const x = (((m.x + m.vx * t + Math.sin(t * m.f + m.ph) * 18) % W) + W) % W;
          const y = (((m.y + m.vy * t + Math.cos(t * m.f * 0.7 + m.ph) * 12) % H) + H) % H;
          let light = 0.04 * lum;
          for (const { b, lv, a } of live) {
            const dx = x - b.x;
            const dy = y - b.y;
            const d = Math.hypot(dx, dy);
            const da = Math.abs(Math.atan2(Math.sin(Math.atan2(dy, dx) - a), Math.cos(Math.atan2(dy, dx) - a)));
            const half = ((b.spread / 2) * Math.PI) / 180;
            if (da < half && d < b.longueur) light += lv * (1 - da / half) * (1 - d / b.longueur) * 0.9;
          }
          if (light < 0.03) continue;
          g.globalAlpha = Math.min(0.85, light);
          g.fillStyle = '#ffffff';
          g.beginPath();
          g.arc(x, y, m.r, 0, Math.PI * 2);
          g.fill();
        }

        // Rampes : halo à la source et traînée anamorphique bleutée.
        for (const { b, lv } of live) {
          const s = (b.halo || L.u * 22) * (0.7 + 0.3 * lv);
          g.globalAlpha = 0.9 * lv;
          g.drawImage(glow, b.x - s / 2, b.y - s / 2, s, s);
          g.globalAlpha = 0.35 * lv;
          g.drawImage(glow, b.x - s * 2.6, b.y - s * 0.06, s * 5.2, s * 0.12);
          g.globalAlpha = lv;
          g.fillStyle = '#ffffff';
          for (let i = -2; i <= 2; i++)
            for (let j = 0; j < 2; j++) {
              g.beginPath();
              g.arc(b.x + i * L.u * 1.4, b.y + j * L.u * 1.4, L.u * 0.45, 0, Math.PI * 2);
              g.fill();
            }
        }

        let f = 0;
        let fc = '#ffffff';
        for (const [tf, c, k] of flashes)
          if (t >= tf) {
            const v = k * Math.exp(-(t - tf) / 0.14);
            if (v > f) {
              f = v;
              fc = c;
            }
          }
        if (f > 0.003) {
          g.globalAlpha = f;
          g.fillStyle = fc;
          g.fillRect(0, 0, W, H);
        }
        g.globalAlpha = 1;
        g.globalCompositeOperation = 'source-over';
      },
    };
    return ctx.add(part);
  }

  /* ------------------------------------------------------------------------
   * Écran : par-dessus tout. Barres, vignettage, grain, étincelles, reflets,
   * éclairs, fondu au noir.
   * ---------------------------------------------------------------------- */

  function ecran(ctx, o = {}) {
    const { L } = ctx;
    const W = L.W;
    const H = L.H;
    const cv = el('canvas', { parent: ctx.front, style: { width: W + 'px', height: H + 'px' } });
    cv.width = W;
    cv.height = H;
    put(cv, { x: 0, y: 0, ax: 0, ay: 0 });
    const g = cv.getContext('2d');

    const vign = document.createElement('canvas');
    vign.width = W;
    vign.height = H;
    const vg = vign.getContext('2d');
    const rad = vg.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.hypot(W, H) * 0.62);
    rad.addColorStop(0, 'rgba(0,0,0,0)');
    rad.addColorStop(1, `rgba(0,0,0,${o.vignette == null ? 0.72 : o.vignette})`);
    vg.fillStyle = rad;
    vg.fillRect(0, 0, W, H);

    const grain = document.createElement('canvas');
    grain.width = grain.height = 256;
    const gg = grain.getContext('2d');
    const gd = gg.createImageData(256, 256);
    const R = rng(5);
    for (let i = 0; i < gd.data.length; i += 4) {
      const v = R() < 0.5 ? 0 : 255;
      gd.data[i] = gd.data[i + 1] = gd.data[i + 2] = v;
      gd.data[i + 3] = Math.floor(R() * 255);
    }
    gg.putImageData(gd, 0, 0);
    const glow = radial(256, '#ffffff', 2);

    const barre = o.barres == null ? (L.wide ? H * 0.085 : L.portrait ? H * 0.05 : H * 0.06) : o.barres;
    const bars = new Track(o.barresDebut == null ? barre : o.barresDebut);
    const sparks = [];
    const flares = [];
    const flashes = [];
    const noir = new Track(o.noir == null ? 0 : o.noir); // 1 : écran noir

    const part = {
      barre,
      bars,
      noir,
      /** Gerbe d'étincelles en (x, y) à l'instant t. */
      etincelles(t, x, y, opt = {}) {
        const Rr = rng(Math.floor(t * 1000) + sparks.length * 97);
        const n = opt.nombre || 70;
        const list = [];
        for (let i = 0; i < n; i++) {
          const ang = ((opt.angle == null ? -90 : opt.angle) + (Rr() - 0.5) * (opt.ouverture || 140)) * (Math.PI / 180);
          const v = (opt.vitesse || L.u * 160) * (0.35 + Rr() * 0.9);
          list.push({ vx: Math.cos(ang) * v, vy: Math.sin(ang) * v, life: 0.45 + Rr() * 0.9, w: 1 + Rr() * 2.2, hot: Rr() });
        }
        sparks.push({ t, x, y, list, couleur: opt.couleur || '#ffb347' });
        if (opt.son !== false) ctx.cue(t + 0.02, 'eclat', { gain: 0.6 });
        return part;
      },
      /** Reflet anamorphique : longue traînée horizontale à la hauteur y. */
      reflet(t, y, couleur = '#7fb2ff', force = 1) {
        flares.push({ t, y, couleur, force });
        return part;
      },
      flash(t, force = 0.8, couleur = '#ffffff') {
        flashes.push([t, force, couleur]);
        return part;
      },
      seek(t) {
        g.clearRect(0, 0, W, H);
        g.globalCompositeOperation = 'source-over';

        // Étincelles : trajectoires balistiques, traînées courtes.
        g.globalCompositeOperation = 'lighter';
        const grav = L.u * 220;
        for (const s of sparks) {
          const k0 = t - s.t;
          if (k0 < 0 || k0 > 1.6) continue;
          for (const p of s.list) {
            if (k0 > p.life) continue;
            const pos = (k) => ({ x: s.x + p.vx * k, y: s.y + p.vy * k + 0.5 * grav * k * k });
            const a = pos(k0);
            const b = pos(Math.max(0, k0 - 0.03));
            const fade = 1 - k0 / p.life;
            g.strokeStyle = p.hot > 0.6 ? '#fff6dc' : s.couleur;
            g.globalAlpha = fade;
            g.lineWidth = p.w;
            g.beginPath();
            g.moveTo(b.x, b.y);
            g.lineTo(a.x, a.y);
            g.stroke();
          }
        }

        // Reflets anamorphiques.
        for (const f of flares) {
          const k = t - f.t;
          if (k < 0 || k > 1.2) continue;
          const v = f.force * Math.exp(-k / 0.28) * clamp(k / 0.03);
          g.globalAlpha = 0.85 * v;
          g.drawImage(glow, -W * 0.3, f.y - L.u * 1.6, W * 1.6, L.u * 3.2);
          g.globalAlpha = 0.5 * v;
          g.fillStyle = f.couleur;
          g.fillRect(0, f.y - L.u * 0.25, W, L.u * 0.5);
          g.globalAlpha = 0.9 * v;
          g.drawImage(glow, W / 2 - L.u * 30, f.y - L.u * 30, L.u * 60, L.u * 60);
        }

        g.globalCompositeOperation = 'source-over';
        // Éclairs blancs.
        let fl = 0;
        let fc = '#fff';
        for (const [tf, k, c] of flashes)
          if (t >= tf) {
            const v = k * Math.exp(-(t - tf) / 0.09);
            if (v > fl) {
              fl = v;
              fc = c;
            }
          }
        if (fl > 0.003) {
          g.globalAlpha = Math.min(1, fl);
          g.fillStyle = fc;
          g.fillRect(0, 0, W, H);
        }

        // Vignettage, grain à 24 i/s, fondu au noir, barres.
        g.globalAlpha = 1;
        g.drawImage(vign, 0, 0);
        const fr = Math.floor(t * 24);
        g.globalAlpha = o.grain == null ? 0.07 : o.grain;
        tile(g, grain, W, H, hash(fr) * 256, hash(fr + 99) * 256, 1.5);
        const nv = clamp(noir.at(t));
        if (nv > 0.002) {
          g.globalAlpha = nv;
          g.fillStyle = '#000';
          g.fillRect(0, 0, W, H);
        }
        const bh = Math.max(0, bars.at(t));
        g.globalAlpha = 1;
        g.fillStyle = '#000';
        if (bh > 0.5) {
          g.fillRect(0, 0, W, bh);
          g.fillRect(0, H - bh, W, bh);
        }
      },
    };
    return ctx.add(part);
  }

  /* ------------------------------------------------------------------------
   * Aberration chromatique : les canaux rouge et bleu se décalent aux impacts.
   * Filtre SVG sur toute la scène, actif seulement pendant les chocs.
   * ---------------------------------------------------------------------- */

  function aberration(ctx) {
    const holder = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    holder.setAttribute('width', '0');
    holder.setAttribute('height', '0');
    holder.style.position = 'absolute';
    holder.innerHTML = `<filter id="mm-ca" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">
      <feColorMatrix in="SourceGraphic" type="matrix" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" result="r"/>
      <feOffset id="mm-ca-r" in="r" dx="0" dy="0" result="r2"/>
      <feColorMatrix in="SourceGraphic" type="matrix" values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0" result="g"/>
      <feColorMatrix in="SourceGraphic" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0" result="b"/>
      <feOffset id="mm-ca-b" in="b" dx="0" dy="0" result="b2"/>
      <feBlend in="r2" in2="g" mode="screen" result="rg"/>
      <feBlend in="rg" in2="b2" mode="screen"/>
    </filter>`;
    document.body.appendChild(holder);
    const fr = holder.querySelector('#mm-ca-r');
    const fb = holder.querySelector('#mm-ca-b');
    const hits = [];
    const part = {
      choc(t, px = ctx.L.u * 1.4) {
        hits.push([t, px]);
        return part;
      },
      seek(t) {
        let a = 0;
        for (const [th, px] of hits) if (t >= th) a = Math.max(a, px * Math.exp(-(t - th) / 0.16));
        if (a < 0.4) {
          ctx.stage.style.filter = '';
          return;
        }
        fr.setAttribute('dx', a.toFixed(2));
        fb.setAttribute('dx', (-a).toFixed(2));
        ctx.stage.style.filter = 'url(#mm-ca)';
      },
    };
    return ctx.add(part);
  }

  /* ------------------------------------------------------------------------
   * Textes de bande-annonce
   * ---------------------------------------------------------------------- */

  /** Sous-titre : lettres très espacées qui se resserrent en apparaissant. */
  function sousTitre(ctx, str, o) {
    const C = ui.colors(ctx);
    const n = el('div', {
      parent: o.parent || ctx.hud,
      cls: 'mm-texte',
      text: str,
      qa: 'texte',
      style: {
        fontSize: o.size + 'px',
        fontWeight: String(o.weight || 600),
        textTransform: 'uppercase',
        color: o.color || C.texte,
        whiteSpace: 'nowrap',
        textShadow: '0 0 18px rgba(0,0,0,0.6)',
      },
    });
    n.dataset.qaMouvant = '1'; // texte en mouvement lent (resserrement, suivi caméra) : lisible
    const from = o.de == null ? 0.7 : o.de;
    const to = o.a == null ? 0.24 : o.a;
    // Largeur maximale (lettres les plus espacées) contrôlée à la construction.
    n.style.letterSpacing = from + 'em';
    if (o.maxW && n.scrollWidth > o.maxW) n.style.fontSize = (o.size * o.maxW) / n.scrollWidth + 'px';
    return ctx.add({
      node: n,
      seek(t) {
        const v = vis(t, o.tin, o.tout, { sp: SP.doux, dOut: 0.35 });
        const k = E.outCubic(range(t, o.tin, o.tin + (o.duree || 1.6)));
        n.style.letterSpacing = lerp(from, to, k).toFixed(4) + 'em';
        const S = ctx.L.safe;
        const x = ui.inSafeX(ctx, typeof o.x === 'function' ? o.x(t) : o.x, n.offsetWidth + 4);
        const y = clamp(typeof o.y === 'function' ? o.y(t) : o.y, S.y + n.offsetHeight / 2, S.b - n.offsetHeight / 2);
        put(n, { x, y, o: v.o, b: v.b * 0.6 });
      },
    });
  }

  /** Rend métallique un titre ui.title (dégradé et reflet qui passe). */
  function metal(ctx, title, o = {}) {
    const C = ui.colors(ctx);
    title.nodes.forEach((n, i) => {
      const accent = n.dataset.accent === '1';
      const base = accent ? [C.accent, '#ffe0c2', C.accent] : ['#9aa1ad', '#ffffff', '#b9bec8'];
      n.style.backgroundImage = `linear-gradient(100deg, ${base[0]} 0%, ${base[2]} 35%, ${base[1]} 48%, ${base[1]} 52%, ${base[2]} 65%, ${base[0]} 100%)`;
      n.style.backgroundSize = '300% 100%';
      n.style.webkitBackgroundClip = 'text';
      n.style.backgroundClip = 'text';
      n.style.color = 'transparent';
      n.style.filter = '';
      n.dataset.metal = String(i);
    });
    const t0 = o.t0 || 0;
    return ctx.add({
      seek(t) {
        title.nodes.forEach((n, i) => {
          const k = ((t - t0) * 0.45 + i * 0.12) % 1.6;
          n.style.backgroundPosition = `${lerp(110, -10, clamp(k))}% 0`;
        });
      },
    });
  }

  window.MM.cine = { stade, ecran, aberration, sousTitre, metal, hash };
})();
