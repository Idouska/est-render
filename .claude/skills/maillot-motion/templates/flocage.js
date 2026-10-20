/**
 * Modèle « flocage » : personnalisation nom + numéro. 24 temps (12 s à 120 BPM).
 *
 *   0–3    accroche (« Ton nom. / Ton numéro. ») sur le dos du maillot assombri
 *   4      temps fort : le dos du maillot claque dans le cadre
 *   5–9    la caméra s'approche ; les lettres du nom se posent une par croche
 *   10     la caméra descend ; le numéro claque
 *   12–24  recul, pastille, prix maillot + flocage, bouton
 */
(function () {
  const { SP, ui, lines } = window.MM;

  MM.film({
    beats: 24,
    async build(ctx) {
      const { spec, L, B } = ctx;
      const S = L.safe;
      const C = ui.colors(ctx);
      const P = spec.produit || {};
      const T = spec.textes || {};
      const F = spec.flocage || {};
      const side = !L.portrait && !(L.H / L.W > 1.1);
      ctx.tempsFort = B(4);

      ctx.bg = ui.background(ctx);

      // ---- Accroche ---------------------------------------------------------
      const hook = lines(T.accroche, ['Ton nom.', 'Ton numéro.']);
      ui.title(ctx, hook, {
        x: S.cx,
        cy: side ? S.cy : S.y + S.h * 0.42,
        maxW: side ? S.w * 0.8 : S.w,
        size: side ? S.h * 0.2 : S.w * 0.2,
        maxSize: side ? S.h * 0.26 : S.h * 0.2,
        tins: hook.map((_, i) => (i === 0 ? -0.4 : B(i * 1.5))),
        tout: B(3.7),
        flash: true,
      });

      // ---- Dos du maillot ----------------------------------------------------
      const img = await ctx.image(P.image_dos);
      const hero = side
        ? { x: S.cx, y: S.y + S.h * 0.52, h: S.h * 0.92 }
        : { x: L.W / 2, y: L.H * 0.46, h: Math.min(L.H * 0.48, (L.W * 0.92 * img.naturalHeight) / img.naturalWidth) };
      const end = side
        ? { x: S.x + S.w * 0.25, y: S.cy, s: Math.min(1, (S.w * 0.46 * img.naturalHeight) / img.naturalWidth / hero.h) }
        : { x: L.W / 2, y: S.y + S.h * 0.45, s: (S.h * 0.4) / hero.h };
      const prod = ui.product(ctx, img, {
        h: hero.h,
        x: hero.x,
        y: hero.y,
        detoure: P.detoure,
        start: { s: 1.3, o: 0.22, r: 4 },
        floatFrom: B(13),
      });
      prod.move(0, { s: 1.22 }, SP.doux);
      prod.move(B(4) - 0.1, { s: 1, o: 1, r: 0 }, SP.claque);
      prod.shine(B(4.4)).shine(B(12.6));
      ctx.cue(B(4) - 0.03, 'montee', { gain: 0.6 });
      ctx.cue(B(4), 'boom', { gain: 1 });
      ctx.bg.flash(B(4), 0.4);

      // ---- Nom puis numéro ---------------------------------------------------
      const zn = F.zone_nom || { x: 0.5, y: 0.2 };
      const zk = F.zone_numero || { x: 0.5, y: 0.48 };
      const color = F.couleur || '#ffffff';
      const nom = String(F.nom || 'TON NOM').toUpperCase();
      const numero = String(F.numero == null ? 10 : F.numero);
      const nameZoom = side ? 1.5 : 1.55;
      const pn = prod.pointAt(B(5), zn.x, zn.y);
      ctx.cam.frame(B(4.5), pn.x, pn.y + hero.h * 0.06, nameZoom);
      ui.letters(ctx, nom, {
        product: prod,
        fx: zn.x,
        fy: zn.y,
        size: prod.h0 * (F.taille_nom || 0.075),
        color,
        arc: F.arc == null ? 0.18 : F.arc,
        t0: B(5.5),
        step: Math.min(ctx.beat / 2, (B(9) - B(5.5)) / Math.max(1, nom.length)),
        maxW: prod.w0 * 0.5,
      });
      const pk = prod.pointAt(B(9), zk.x, zk.y);
      ctx.cam.frame(B(9) - 0.2, pk.x, pk.y, side ? 1.25 : 1.3);
      ui.letters(ctx, numero, {
        product: prod,
        fx: zk.x,
        fy: zk.y,
        size: prod.h0 * (F.taille_numero || 0.3),
        color,
        t0: B(10),
        step: 0.06,
        cue: 'impact',
        espacement: 0.02,
        maxW: prod.w0 * 0.42,
      });
      ctx.cue(B(10), 'boom', { gain: 0.7, pitch: 3 });
      ctx.bg.flash(B(10), 0.25);
      ctx.cam.frame(B(12), L.W / 2, L.H / 2, 1);

      // ---- Image de fin -----------------------------------------------------
      const colX = side ? S.x + S.w * 0.74 : S.cx;
      const colW = side ? S.w * 0.48 : S.w;
      prod.move(B(13.5), { x: end.x, y: end.y, s: end.s }, SP.vif);
      ctx.cue(B(13.5), 'swipe', { gain: 0.6 });

      ui.badge(ctx, {
        text: T.mention || 'Flocage personnalisé',
        icon: 'etoile',
        x: colX,
        y: side ? S.y + S.h * 0.22 : S.y + S.h * 0.1,
        size: side ? S.h * 0.05 : S.h * 0.04,
        maxW: colW,
        style: 'accent',
        tin: B(12.5),
      });
      ui.text(ctx, P.nom || 'Ton maillot floqué', {
        x: colX,
        y: side ? S.y + S.h * 0.36 : S.y + S.h * 0.69,
        size: side ? S.h * 0.06 : S.h * 0.045,
        maxW: colW,
        upper: true,
        tin: B(14),
      });
      const total = (P.prix || 0) + (F.prix || 0);
      if (P.prix != null) {
        ui.price(ctx, {
          value: total,
          devise: P.devise,
          x: colX,
          y: side ? S.y + S.h * 0.53 : S.y + S.h * 0.775,
          size: side ? Math.min(S.h * 0.15, colW * 0.3) : S.h * 0.08,
          tin: B(14.5),
          roll: 0.9,
        });
        if (F.prix) {
          ui.text(ctx, `maillot + flocage (${ui.fmtPrice(F.prix, P.devise)})`, {
            x: colX,
            y: side ? S.y + S.h * 0.64 : S.y + S.h * 0.842,
            size: side ? S.h * 0.04 : S.h * 0.034,
            color: C.doux,
            weight: 600,
            maxW: colW,
            tin: B(15.5),
          });
        }
      }
      await ui.logo(ctx, {
        x: colX,
        y: side ? S.y + S.h * 0.07 : S.y + S.h * 0.03,
        h: side ? S.h * 0.06 : S.h * 0.04,
        maxW: colW * 0.7,
        tin: B(16),
      });
      ui.button(ctx, {
        text: T.cta || 'Je personnalise',
        x: colX,
        y: side ? S.y + S.h * 0.82 : S.y + S.h * 0.925,
        size: side ? S.h * 0.065 : S.h * 0.048,
        maxW: colW * 0.95,
        tin: B(17),
        press: [B(19)],
        icon: 'fleche',
      });

      if (L.fmt === '9:16' && T.bandeau !== false) {
        const nomBoutique = (spec.marque && spec.marque.nom) || '';
        ui.ticker(ctx, { text: T.bandeau || [nomBoutique, 'Ton nom, ton numéro'].filter(Boolean).join(' • '), y: L.H * 0.85, size: L.u * 6, tin: B(16.2) });
      }
    },
  });
})();
