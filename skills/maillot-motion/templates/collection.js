/**
 * Modèle « collection » : 2 à 6 maillots. 14 + 2,5 × N temps (≈ 10,8 s pour 3 maillots).
 *
 *   0–3      accroche sur la grille assombrie
 *   4        temps fort : les maillots se posent en grille, un par croche
 *   6 …      la caméra zoome sur chaque maillot (« rythme » temps chacun, 2,5 par défaut) : nom, prix
 *   6 + R·N  recul sur toute la grille ; titre, bouton, logo
 */
(function () {
  const { SP, ui, lines } = window.MM;
  const CAM = { w: 11, z: 1 };

  MM.film({
    async build(ctx) {
      const { spec, L, B } = ctx;
      const S = L.safe;
      const T = spec.textes || {};
      const items = (spec.produits || []).slice(0, 6);
      if (items.length < 2) throw new Error('Le modèle « collection » demande au moins 2 produits dans « produits ».');
      const N = items.length;
      const side = !L.portrait && !(L.H / L.W > 1.1);
      const imgs = [];
      for (const it of items) imgs.push(await ctx.image(it.image));
      // Temps par maillot : assez pour lire un nom de 2 à 3 mots et son prix.
      const R = spec.rythme || 2.5;
      ctx.duration = B(14 + R * N);
      ctx.tempsFort = B(4);

      ctx.bg = ui.background(ctx);

      // ---- Grille ------------------------------------------------------------
      const cols = L.wide ? (N <= 5 ? N : 3) : side ? Math.min(N, 3) : N <= 2 ? N : N <= 4 ? 2 : 3;
      const rows = Math.ceil(N / cols);
      const area = side
        ? { x: S.x, y: S.y + S.h * 0.14, w: S.w, h: S.h * 0.66 }
        : { x: S.x, y: S.y + S.h * 0.13, w: S.w, h: S.h * 0.7 };
      const aspect = imgs[0].naturalWidth / imgs[0].naturalHeight;
      const cellW = area.w / cols;
      const cellH = area.h / rows;
      const h = Math.min(cellH * 0.9, (cellW * 0.9) / aspect);
      const cells = items.map((_, i) => {
        const r = Math.floor(i / cols);
        const inRow = Math.min(cols, N - r * cols);
        const c = i % cols;
        return {
          x: area.x + area.w / 2 + (c - (inRow - 1) / 2) * cellW,
          y: area.y + area.h / 2 + (r - (rows - 1) / 2) * cellH,
        };
      });

      const prods = items.map((it, i) => {
        const cell = cells[i];
        const tin = B(4) + i * (ctx.beat / 2);
        const p = ui.product(ctx, imgs[i], {
          h,
          x: cell.x,
          y: cell.y,
          detoure: it.detoure,
          start: { s: 1.25, o: 0.18 },
          floatFrom: tin + 0.5,
        });
        p.move(tin - 0.1, { s: 1, o: 1 }, SP.claque);
        ctx.cue(tin, i === N - 1 ? 'impact' : 'pop', { gain: 0.8, pitch: i * 2 });
        return p;
      });
      ctx.bg.flash(B(4), 0.3);
      ctx.cue(B(4) - 0.03, 'montee', { gain: 0.5 });

      // ---- Accroche ---------------------------------------------------------
      const hook = lines(T.accroche, ['La', 'collection', { text: '26/27', accent: true }]);
      ui.title(ctx, hook, {
        x: S.cx,
        cy: side ? S.cy : S.y + S.h * 0.42,
        maxW: side ? S.w * 0.7 : S.w,
        size: side ? S.h * 0.2 : S.w * 0.2,
        maxSize: side ? S.h * 0.28 : S.h * 0.22,
        tins: hook.map((_, i) => (i === 0 ? -0.4 : B(i))),
        tout: B(3.7),
        flash: true,
      });

      // ---- Zoom sur chaque maillot -------------------------------------------
      // Le maillot visé doit apparaître en (sx, sy) à l'écran avec une hauteur hz.
      const sx = S.cx;
      const sy = S.y + S.h * (side ? 0.34 : 0.4);
      const hz = S.h * (side ? 0.6 : 0.6);
      const z = hz / h;
      const nameY = S.y + S.h * (side ? 0.74 : 0.8);
      const priceY = S.y + S.h * (side ? 0.88 : 0.9);
      items.forEach((it, i) => {
        const t0 = B(6 + i * R);
        const t1 = B(6 + (i + 1) * R);
        const c = cells[i];
        // Caméra rapide et amortie : le maillot doit être cadré pendant presque tout son temps.
        ctx.cam.frame(t0 - 0.3, c.x - (sx - L.W / 2) / z, c.y - (sy - L.H / 2) / z, z, CAM);
        ctx.cue(t0 - 0.2, 'whoosh', { gain: 0.5 });
        prods.forEach((p, j) => p.o.to(t0 - 0.3, j === i ? 1 : 0.25, SP.vif));
        prods[i].shine(t0 + 0.15);
        ui.text(ctx, it.nom || `Maillot ${i + 1}`, {
          x: S.cx,
          y: nameY - (it.prix_barre ? S.h * (side ? 0.07 : 0.035) : 0),
          size: side ? S.h * 0.07 : S.h * 0.05,
          maxW: S.w,
          upper: true,
          tin: t0 - 0.02,
          tout: t1 - 0.2,
        });
        if (it.prix != null) {
          ui.price(ctx, {
            value: it.prix,
            old: it.prix_barre,
            devise: it.devise,
            x: S.cx,
            y: priceY - (it.prix_barre ? S.h * 0.02 : 0),
            size: side ? S.h * 0.1 : S.h * 0.07,
            tin: t0 + 0.1,
            tout: t1 - 0.12,
            roll: 0.55,
          });
        }
      });

      // ---- Recul sur la grille et fin ----------------------------------------
      const tb = B(6 + R * N);
      ctx.cam.frame(tb - 0.25, L.W / 2, L.H / 2, 1, CAM);
      prods.forEach((p) => p.o.to(tb - 0.2, 1, SP.vif));
      ctx.cue(tb - 0.15, 'swipe', { gain: 0.6 });
      ui.text(ctx, T.titre || 'Toute la collection', {
        x: S.cx,
        y: S.y + S.h * 0.06,
        size: side ? S.h * 0.075 : S.h * 0.052,
        maxW: S.w,
        upper: true,
        titre: true,
        tin: tb + 0.1,
      });
      await ui.logo(ctx, {
        x: side ? S.x + S.w * 0.2 : S.cx,
        y: side ? S.y + S.h * 0.93 : S.y + S.h * 0.86,
        h: side ? S.h * 0.05 : S.h * 0.036,
        maxW: S.w * 0.4,
        tin: tb + 0.5,
      });
      ui.button(ctx, {
        text: T.cta || 'Voir la collection',
        x: side ? S.x + S.w * 0.72 : S.cx,
        y: side ? S.y + S.h * 0.92 : S.y + S.h * 0.94,
        size: side ? S.h * 0.06 : S.h * 0.046,
        maxW: S.w * 0.6,
        tin: tb + 0.75,
        press: [tb + B(2)],
        icon: 'fleche',
      });
    },
  });
})();
