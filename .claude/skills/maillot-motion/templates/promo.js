/**
 * Modèle « promo » : offre limitée (soldes, code promo). 22 temps (11 s à 120 BPM).
 *
 *   0–2    accroche (« Offre / flash ») sur le maillot assombri
 *   2–4    volet couleur d'accent ; « -20 % » défile en grand et claque au temps 4
 *   5.5    retour au fond ; la remise devient une étiquette collée au produit
 *   6–14   les maillots défilent un par un : nom, ancien prix barré, nouveau prix
 *   14–22  code promo tapé lettre par lettre, date de fin, bouton
 */
(function () {
  const { SP, ui, lines, glide, clamp } = window.MM;

  MM.film({
    beats: 22,
    async build(ctx) {
      const { spec, L, B } = ctx;
      const S = L.safe;
      const C = ui.colors(ctx);
      const T = spec.textes || {};
      const R = spec.promo || {};
      const side = !L.portrait && !(L.H / L.W > 1.1);
      const remise = R.remise == null ? 20 : R.remise;
      ctx.tempsFort = B(4);

      // Produits : liste « produits », sinon le produit seul.
      const items = (spec.produits && spec.produits.length ? spec.produits : [spec.produit || {}]).slice(0, 4);
      const imgs = [];
      for (const it of items) imgs.push(await ctx.image(it.image));

      ctx.bg = ui.background(ctx);

      // ---- Accroche ---------------------------------------------------------
      const hook = lines(T.accroche, ['Offre', 'flash']);
      ui.title(ctx, hook, {
        x: S.cx,
        cy: side ? S.cy : S.y + S.h * 0.4,
        maxW: side ? S.w * 0.7 : S.w,
        size: side ? S.h * 0.24 : S.w * 0.24,
        maxSize: side ? S.h * 0.32 : S.h * 0.24,
        tins: hook.map((_, i) => (i === 0 ? -0.4 : B(i * 0.5))),
        tout: B(2),
        flash: true,
      });

      // ---- La remise, en grand, sur fond d'accent ----------------------------
      ctx.bg.wipe(B(2.1) - 0.15, C.accent);
      const big = side ? S.h * 0.42 : S.w * 0.36;
      const bigY = side ? S.cy : S.y + S.h * 0.4;
      // Étiquette collée en haut du maillot (à gauche en 1:1 et 16:9, le logo est à droite).
      const tagX = side ? S.x + S.w * 0.16 : S.x + S.w * 0.8;
      const tagY = side ? S.y + S.h * 0.1 : S.y + S.h * 0.11;
      const tagScale = side ? 0.34 : 0.32;
      ui.odometer(ctx, {
        text: `-${remise} %`,
        // Rétrécit vers l'emplacement de l'étiquette, qui prend le relais.
        x: (t) => glide(t, B(5), B(6), S.cx, tagX),
        y: (t) => glide(t, B(5), B(6), bigY, tagY),
        scale: (t) => glide(t, B(5), B(6), 1, tagScale),
        size: big,
        tin: B(2.6),
        tout: B(6),
        roll: B(4) - B(2.6) - 0.06,
        color: C.accentTexte,
        endCue: 'boom',
        symbolScale: 0.7,
      });
      ctx.bg.flash(B(4), 0.35);
      ctx.cam.frame(B(4) - 0.02, L.W / 2, L.H / 2, 1.05, SP.claque).frame(B(4.3), L.W / 2, L.H / 2, 1);

      // Retour au fond sombre ; l'étiquette (pastille d'accent) remplace le chiffre.
      ctx.bg.wipe(B(6) - 0.12, C.fond, -1);
      ui.badge(ctx, {
        text: `-${remise} %`,
        style: 'accent',
        x: tagX,
        y: tagY,
        size: (side ? S.h * 0.42 : S.w * 0.36) * tagScale * 0.62,
        r: -7,
        tin: B(5.95),
        cue: false,
        titre: true,
      });

      // ---- Carrousel des maillots ------------------------------------------
      const slot = side
        ? { x: S.x + S.w * 0.28, y: S.cy + S.h * 0.04, h: S.h * 0.78 }
        : { x: S.cx, y: S.y + S.h * 0.42, h: S.h * 0.5 };
      const colX = side ? S.x + S.w * 0.75 : S.cx;
      const colW = side ? S.w * 0.5 : S.w;
      const step = items.length > 1 ? Math.min(2.5, 8 / items.length) : 8;
      const endT = B(14);
      items.forEach((it, i) => {
        const img = imgs[i];
        const h = Math.min(slot.h, ((side ? S.w * 0.5 : S.w * 0.85) * img.naturalHeight) / img.naturalWidth);
        const tin = B(6 + i * step);
        const last = i === items.length - 1;
        const tout = last ? null : B(6 + (i + 1) * step);
        // Le premier maillot, assombri, sert de fond à l'accroche (image 0 = miniature).
        const start = i === 0 ? { x: slot.x, y: slot.y, s: 1.25, o: 0.22 } : { x: slot.x + L.W, y: slot.y, r: 10, o: 1 };
        const p = ui.product(ctx, img, { h, x: slot.x, y: slot.y, detoure: it.detoure, start, floatFrom: tin + 0.6 });
        if (i === 0) p.move(B(1.8), { o: 0 }, SP.vif).move(B(6) - 0.15, { s: 1, o: 1 }, SP.claque);
        else p.move(tin - 0.25, { x: slot.x, r: 0 }, SP.vif);
        if (tout) p.move(tout - 0.25, { x: slot.x - L.W, r: -10 }, SP.vif);
        if (!last || items.length > 1) ctx.cue(tin - 0.1, 'whoosh', { gain: 0.6 });
        p.shine(tin + 0.3);
        if (last) p.move(endT, side ? { s: 0.92 } : { y: S.y + S.h * 0.32, s: 0.74 }, SP.vif);

        const nameY = side ? S.y + S.h * 0.3 : S.y + S.h * 0.73;
        const priceY = side ? S.y + S.h * 0.55 : S.y + S.h * 0.84;
        const textOut = last ? endT : tout;
        ui.text(ctx, it.nom || `Maillot ${i + 1}`, {
          x: colX,
          y: nameY,
          size: side ? S.h * 0.07 : S.h * 0.052,
          maxW: colW,
          upper: true,
          tin: tin + 0.1,
          tout: textOut - 0.05,
        });
        if (it.prix != null) {
          const promo = it.prix_promo != null ? it.prix_promo : Math.round(it.prix * (100 - remise)) / 100;
          ui.price(ctx, {
            value: promo,
            old: it.prix,
            devise: it.devise,
            x: colX,
            y: priceY,
            size: side ? Math.min(S.h * 0.15, colW * 0.3) : S.h * 0.085,
            tin: tin + 0.2,
            tout: textOut,
            roll: Math.min(0.8, step * ctx.beat * 0.6),
            color: C.accent,
          });
        }
      });

      // ---- Code promo, date de fin, bouton ----------------------------------
      const codeY = side ? S.y + S.h * 0.3 : S.y + S.h * 0.63;
      if (R.code) {
        ui.text(ctx, T.code_label || 'avec le code', {
          x: colX,
          y: codeY - (side ? S.h * 0.11 : S.h * 0.078),
          size: side ? S.h * 0.045 : S.h * 0.034,
          color: C.doux,
          weight: 600,
          upper: true,
          tin: B(14.2),
        });
        codePill(ctx, R.code, {
          x: colX,
          y: codeY,
          size: side ? S.h * 0.085 : S.h * 0.062,
          maxW: colW * 0.95,
          t0: B(14.5),
          step: ctx.beat / 4,
        });
      }
      if (R.fin) {
        ui.badge(ctx, {
          text: R.fin,
          icon: 'horloge',
          x: colX,
          y: side ? S.y + S.h * 0.5 : S.y + S.h * 0.76,
          size: side ? S.h * 0.05 : S.h * 0.036,
          maxW: colW,
          style: 'contour',
          tin: B(16),
        });
      }
      await ui.logo(ctx, {
        x: side ? colX : S.x + S.w * 0.22,
        y: side ? S.y + S.h * 0.06 : S.y + S.h * 0.11,
        h: side ? S.h * 0.06 : S.h * 0.04,
        maxW: side ? colW * 0.7 : S.w * 0.4,
        tin: B(6.5),
      });
      ui.button(ctx, {
        text: T.cta || 'J’en profite',
        x: colX,
        y: side ? S.y + S.h * 0.76 : S.y + S.h * 0.915,
        size: side ? S.h * 0.065 : S.h * 0.054,
        maxW: colW * 0.95,
        tin: B(16.5),
        press: [B(18.5)],
        icon: 'fleche',
      });

      // Bandeau décoratif dans la zone basse du 9:16, que l'interface recouvre.
      if (L.fmt === '9:16' && T.bandeau !== false) {
        const txt = T.bandeau || [`-${remise} %`, R.code ? `code ${R.code}` : null, R.fin].filter(Boolean).join(' • ');
        ui.ticker(ctx, { text: txt, y: L.H * 0.84, size: L.u * 6, tin: B(6.2) });
      }
    },
  });

  /** Pastille du code : les lettres apparaissent une à une (frappe). */
  function codePill(ctx, code, o) {
    const { el, put, vis, stepR, SP } = window.MM;
    const C = ui.colors(ctx);
    const n = el('div', {
      parent: ctx.hud,
      cls: 'mm-pill mm-titre',
      qa: 'texte',
      style: {
        fontSize: o.size + 'px',
        padding: '0.3em 0.7em',
        border: `${Math.max(3, o.size * 0.06)}px dashed ${C.accent}`,
        color: C.accent,
        background: 'rgba(12,12,14,0.6)',
        letterSpacing: '0.03em',
        gap: '0',
      },
    });
    n.dataset.qaLabel = code;
    const spans = [...code].map((ch) => el('span', { parent: n, text: ch, style: { position: 'relative' } }));
    if (o.maxW && n.offsetWidth > o.maxW) n.style.fontSize = (o.size * o.maxW) / n.offsetWidth + 'px';
    spans.forEach((_, i) => ctx.cue(o.t0 + i * o.step, 'tic', { gain: 0.5, pitch: i }));
    ctx.cue(o.t0 + spans.length * o.step, 'caisse', { gain: 0.5, pitch: 5 });
    return ctx.add({
      seek(t) {
        const v = vis(t, o.t0 - 0.15, null);
        put(n, { x: o.x, y: o.y, s: 0.8 + 0.2 * clamp(stepR(t - o.t0 + 0.15, SP.claque), 0, 1.2), o: v.o, b: v.b });
        spans.forEach((s, i) => {
          const k = clamp(stepR(t - (o.t0 + i * o.step), SP.pop), 0, 1.2);
          s.style.opacity = String(clamp(k * 1.5));
          s.style.top = ((1 - k) * o.size * 0.3).toFixed(1) + 'px';
        });
      },
    });
  }
})();
