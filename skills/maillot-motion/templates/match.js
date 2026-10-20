/**
 * Modèle « match » : bande-annonce de choc entre deux équipes, style annonce de
 * match télévisée. 26 temps (13 s à 120 BPM).
 *
 *   Acte 1 — le silence (0–6) : stade de nuit, fumée, battements de cœur.
 *            Les deux maillots en contre-jour, les projecteurs s'allument un à un.
 *            Sous-titres espacés (« Deux villes. » / « Une rivalité. »). Noir juste avant 6.
 *   Acte 2 — le face-à-face (6–14) : cuivres graves, le maillot domicile s'allume
 *            (temps 6), puis l'extérieur (temps 8), avec le nom de leur ville.
 *            Temps 10 : « VS » claque au centre, étincelles, reflet, secousse.
 *            Les projecteurs balaient, les tambours montent.
 *   Acte 3 — le coup d'envoi (14–19) : sifflet, éclair blanc, la foule gronde,
 *            « Choisis / ton camp » en lettres métalliques.
 *   Acte 4 — la fin (19–26) : les deux maillots, leur prix, le logo, le bouton.
 */
(function () {
  const { SP, ui, cine, lines } = window.MM;

  MM.film({
    beats: 26,
    async build(ctx) {
      const { spec, L, B } = ctx;
      const W = L.W;
      const H = L.H;
      const C = ui.colors(ctx);
      const M = spec.match || {};
      const T = spec.textes || {};
      const A = M.domicile || {};
      const Z = M.exterieur || {};
      if (!A.image || !Z.image) throw new Error('Le modèle « match » demande match.domicile.image et match.exterieur.image.');
      const large = L.wide; // 16:9 : bouton au centre entre les deux maillots
      ctx.ambiance = 'cinema';
      ctx.tempsFort = B(6);

      const fx = cine.ecran(ctx, {});
      ctx.reserve(fx.barre);
      const S = L.safe;
      const st = cine.stade(ctx, {});
      const ab = cine.aberration(ctx);
      ctx.bg = { flash: (t, k) => st.flash(t, C.accent, k) };

      // ---- Projecteurs ------------------------------------------------------
      const top = fx.barre + H * 0.03;
      const aim = (sx, sy, tx, ty) => (Math.atan2(ty - sy, tx - sx) * 180) / Math.PI;
      const sources = [
        { x: W * 0.06, y: top, tx: W * 0.42, ty: H * 0.75, on: -1, force: 0.75 },
        { x: W * 0.94, y: top, tx: W * 0.58, ty: H * 0.75, on: B(2.5) },
        { x: W * 0.34, y: top - H * 0.01, tx: W * 0.2, ty: H, on: B(6), son: false, balayage: { vers: 1, t0: B(10.5), t1: B(14) } },
        { x: W * 0.66, y: top - H * 0.01, tx: W * 0.8, ty: H, on: B(6), son: false, balayage: { vers: -1, t0: B(10.5), t1: B(14) } },
      ];
      for (const s of sources) {
        const a = aim(s.x, s.y, s.tx, s.ty);
        st.faisceau({
          x: s.x,
          y: s.y,
          angle: a,
          spread: large ? 15 : 19,
          on: s.on,
          force: s.force || 1,
          son: s.son,
          balayage: s.balayage ? { vers: a + s.balayage.vers * 26, t0: s.balayage.t0, t1: s.balayage.t1 } : null,
        });
      }
      // Noir juste avant l'impact, puis pleine lumière.
      st.lumiere.to(B(5.55), 0.1, { w: 30, z: 1 }).to(B(6) - 0.02, 1.15, SP.claque).to(B(7), 1, SP.doux);

      // ---- Les deux maillots, face à face -------------------------------------
      const imgA = await ctx.image(A.image);
      const imgZ = await ctx.image(Z.image);
      const face = large
        ? { y: H * 0.5, h: H * 0.6, xa: W * 0.3, xz: W * 0.7 }
        : { y: H * 0.45, h: Math.min(H * 0.34, (W * 0.52 * imgA.naturalHeight) / imgA.naturalWidth), xa: W * 0.28, xz: W * 0.72 };
      const fin = large
        ? { y: H * 0.47, s: 0.8, xa: W * 0.27, xz: W * 0.73 }
        : { y: H * 0.38, s: 0.85, xa: W * 0.29, xz: W * 0.71 };
      const mk = (img, x, r, couleur, detoure) =>
        ui.product(ctx, img, {
          h: face.h,
          x,
          y: face.y,
          detoure,
          halo: couleur,
          start: { s: 1.05, r, lum: 0.06, halo: 0.28 },
          floatFrom: B(6),
        });
      const pa = mk(imgA, face.xa, 5, A.couleur || '#2f6bff', A.detoure);
      const pz = mk(imgZ, face.xz, -5, Z.couleur || '#33c0ff', Z.detoure);
      // Le maillot domicile s'allume au temps 6, l'extérieur au temps 8.
      pa.move(B(6) - 0.03, { lum: 1, halo: 1, s: 1 }, SP.claque);
      pz.move(B(8) - 0.03, { lum: 1, halo: 1, s: 1 }, SP.claque);
      pa.shine(B(6.3));
      pz.shine(B(8.3));

      // ---- Caméra -------------------------------------------------------------
      const cam = ctx.cam;
      cam.frame(0, W / 2, H / 2, 1).frame(0.01, W / 2, H * 0.47, 1.08, { w: 1.3, z: 1 });
      cam.frame(B(6) - 0.05, face.xa + (W / 2 - face.xa) * 0.45, face.y, 1.14, { w: 9, z: 1 });
      cam.frame(B(8) - 0.05, face.xz - (face.xz - W / 2) * 0.45, face.y, 1.14, { w: 9, z: 1 });
      cam.frame(B(10) - 0.04, W / 2, H / 2, 1, SP.claque);
      cam.frame(B(10.4), W / 2, H / 2, 1.05, { w: 1.6, z: 1 });
      cam.frame(B(19) - 0.05, W / 2, H / 2, 1, { w: 10, z: 1 });

      // ---- Acte 1 : le silence -------------------------------------------------
      const intro = lines(M.intro, ['Deux villes.', 'Une rivalité.']);
      const introY = large ? S.y + S.h * 0.08 : S.y + S.h * 0.11;
      intro.slice(0, 2).forEach((txt, i) =>
        cine.sousTitre(ctx, txt, {
          x: S.cx,
          y: introY,
          size: large ? S.h * 0.065 : S.w * 0.085,
          maxW: S.w,
          tin: i === 0 ? -1 : B(2.85),
          tout: i === 0 ? B(2.7) : B(5.5),
          duree: i === 0 ? 1.5 : 1,
        }),
      );
      // Le cœur accélère, puis un vrai silence d'un quart de seconde avant l'impact.
      [0.04, B(1.9), B(3.4), B(4.4), B(5.0)].forEach((t, i) => ctx.cue(t, 'coeur', { gain: 0.75 + i * 0.05, pitch: i * 0.5 }));

      // ---- Acte 2 : le face-à-face --------------------------------------------
      const villeY = (p) => (t) => p.screenAt(t, 0.5, 1).y + L.u * (large ? 3.5 : 5.5);
      const villeX = (p) => (t) => p.screenAt(t, 0.5, 1).x;
      const villeSize = large ? S.h * 0.065 : S.w * 0.07;
      [
        [pa, A, B(6.1), B(7.9)],
        [pz, Z, B(8.1), B(9.9)],
        [pa, A, B(10.3), B(13.6)],
        [pz, Z, B(10.4), B(13.6)],
      ].forEach(([p, eq, tin, tout]) =>
        cine.sousTitre(ctx, eq.ville || eq.nom || '', {
          x: villeX(p),
          y: villeY(p),
          size: villeSize,
          weight: 800,
          maxW: S.w * 0.46,
          tin,
          tout,
          de: 0.55,
          a: 0.16,
          duree: 1,
        }),
      );
      for (const [t, p] of [
        [B(6), 0],
        [B(8), -2],
      ]) {
        ctx.cue(t, 'braam', { gain: 0.9, pitch: p });
        ctx.cue(t, 'boom', { gain: 0.7 });
        cam.shake(t, L.u * 1.6, 0.3);
        ab.choc(t, L.u * 0.9);
        st.flash(t, '#ffffff', 0.18);
      }

      // « VS »
      const vs = ui.title(ctx, [{ text: M.vs || 'VS', accent: true }], {
        x: W / 2,
        cy: face.y,
        maxW: S.w * 0.4,
        size: large ? H * 0.26 : W * 0.3,
        maxSize: large ? H * 0.3 : W * 0.32,
        justify: false,
        tins: [B(10)],
        tout: B(13.7),
        from: 2.2,
        cue: false,
      });
      cine.metal(ctx, vs, { t0: B(10) });
      ctx.cue(B(10) - 0.02, 'aspiration', { gain: 0.5 });
      ctx.cue(B(10), 'impact', { gain: 1 });
      ctx.cue(B(10), 'boom', { gain: 0.9, pitch: 2 });
      cam.shake(B(10), L.u * 2.8, 0.38);
      ab.choc(B(10), L.u * 1.6);
      fx.flash(B(10), 0.55);
      fx.reflet(B(10), face.y, '#8fbaff', 1);
      fx.etincelles(B(10), W / 2, face.y, { nombre: 90, angle: -90, ouverture: 200, couleur: C.accent });
      [B(11), B(12), B(13), B(13.5)].forEach((t, i) => ctx.cue(t, 'tambour', { gain: 0.7 + i * 0.08, pitch: i === 3 ? 2 : 0 }));
      ctx.cue(B(14) - 0.02, 'aspiration', { gain: 0.7 });

      // ---- Acte 3 : le coup d'envoi -------------------------------------------
      ctx.cue(B(14), 'sifflet', { gain: 0.8 });
      ctx.cue(B(14), 'boom', { gain: 1 });
      ctx.cue(B(16.5), 'foule', { gain: 0.8 });
      fx.flash(B(14), 1);
      ab.choc(B(14), L.u * 1.4);
      cam.shake(B(14), L.u * 2.2, 0.35);
      for (let k = 14; k <= 18; k++) ctx.cue(B(k), 'tambour', { gain: 0.85, pitch: k === 18 ? 3 : 0 });
      // Les maillots reculent dans le flou derrière le titre.
      for (const p of [pa, pz]) {
        p.move(B(14), { lum: 0.32 }, SP.vif).move(B(19) - 0.1, { lum: 1 }, SP.claque);
        p.blur = (t) => (t < B(14) || t > B(19.3) ? 0 : 9 * Math.min(1, (t - B(14)) / 0.2) * Math.min(1, (B(19.3) - t) / 0.3));
      }
      const titre = ui.title(ctx, lines(M.titre, ['Choisis', 'ton camp']), {
        x: S.cx,
        cy: large ? H / 2 : S.y + S.h * 0.42,
        maxW: large ? S.w * 0.62 : S.w,
        size: large ? S.h * 0.26 : S.w * 0.24,
        maxSize: large ? S.h * 0.32 : S.h * 0.22,
        tins: [B(14.05), B(15)],
        tout: B(18.6),
        from: 1.6,
      });
      cine.metal(ctx, titre, { t0: B(14) });
      fx.etincelles(B(15), W * 0.25, fx.barre, { nombre: 70, angle: 80, ouverture: 70, vitesse: L.u * 40, couleur: '#ffcf8a' });
      fx.etincelles(B(15), W * 0.75, fx.barre, { nombre: 70, angle: 100, ouverture: 70, vitesse: L.u * 40, couleur: '#ffcf8a', son: false });
      fx.reflet(B(15), titre.bottom, '#ffb27a', 0.7);
      cam.shake(B(15), L.u * 1.4, 0.3);

      // ---- Acte 4 : la fin ------------------------------------------------------
      ctx.cue(B(19) - 0.05, 'whoosh', { gain: 0.6 });
      ctx.cue(B(19), 'impact', { gain: 0.8 });
      ctx.cue(B(21.5), 'foule', { gain: 0.4, pitch: -2 });
      fx.flash(B(19), 0.5);
      pa.move(B(19) - 0.15, { x: fin.xa, y: fin.y, s: fin.s, r: 4 }, SP.vif);
      pz.move(B(19) - 0.15, { x: fin.xz, y: fin.y, s: fin.s, r: -4 }, SP.vif);
      const bas = (p) => p.pointAt(B(26), 0.5, 1).y; // bas du maillot en fin de film (caméra au repos)
      [
        [pa, A, fin.xa],
        [pz, Z, fin.xz],
      ].forEach(([p, eq, x], i) => {
        const y0 = bas(p) + L.u * (large ? 3 : 4);
        ui.text(ctx, eq.nom || eq.ville || '', {
          x,
          y: y0,
          size: large ? S.h * 0.05 : S.w * 0.045,
          maxW: (large ? S.w * 0.36 : S.w * 0.46),
          upper: true,
          tin: B(19.6 + i * 0.25),
        });
        if (eq.prix != null) {
          ui.price(ctx, {
            value: eq.prix,
            old: eq.prix_barre,
            devise: eq.devise,
            x,
            y: y0 + L.u * (large ? 7 : 8),
            size: large ? S.h * 0.08 : S.w * 0.075,
            tin: B(20 + i * 0.25),
            roll: 0.7,
            color: C.accent,
          });
        }
      });
      await ui.logo(ctx, {
        x: S.cx,
        y: S.y + (large ? L.u * 3 : S.h * 0.03),
        h: large ? S.h * 0.055 : S.h * 0.04,
        maxW: S.w * 0.5,
        tin: B(20),
      });
      if (T.mention) {
        ui.badge(ctx, {
          text: T.mention,
          icon: 'etoile',
          x: S.cx,
          y: large ? S.y + L.u * 9.5 : S.y + S.h * 0.1,
          size: large ? S.h * 0.04 : Math.max(S.h * 0.032, L.u * 3.5),
          maxW: S.w * 0.7,
          style: 'contour',
          tin: B(20.5),
        });
      }
      ui.button(ctx, {
        text: T.cta || 'Commander',
        x: S.cx,
        y: large ? fin.y : S.y + S.h * 0.935,
        size: large ? S.h * 0.055 : S.h * 0.05,
        maxW: large ? S.w * 0.22 : S.w * 0.9,
        tin: B(21),
        press: [B(23)],
        icon: 'fleche',
      });
    },
  });
})();
