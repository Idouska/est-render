/**
 * Modèle « drop » : lancement d'un nouveau maillot. 24 temps (12 s à 120 BPM).
 *
 *   0–3   accroche : 2 à 3 lignes qui claquent une par temps
 *   4     temps fort : le maillot tombe dans le cadre, éclair, reflet
 *   6–12  trois atouts pointés sur le maillot, la caméra va de l'un à l'autre
 *   14    le maillot se range, le prix défile (ancien prix barré)
 *   16–24 pastille, logo, bouton ; appui sur le bouton ; image de fin tenue
 */
(function () {
  const { SP, ui, lines, glide, lerp } = window.MM;

  MM.film({
    beats: 24,
    async build(ctx) {
      const { spec, L, B } = ctx;
      const S = L.safe;
      const P = spec.produit || {};
      const T = spec.textes || {};
      const side = !L.portrait && !(L.H / L.W > 1.1); // 1:1 et 16:9 : produit à gauche, texte à droite
      ctx.tempsFort = B(4);

      ctx.bg = ui.background(ctx);

      // ---- Accroche ---------------------------------------------------------
      const hook = lines(T.accroche, ['Nouveau', 'maillot', { text: P.saison || '26/27', accent: true }]);
      ui.title(ctx, hook, {
        x: S.cx,
        cy: side ? S.cy : S.y + S.h * 0.42,
        maxW: side ? S.w * 0.78 : S.w,
        size: side ? S.h * 0.2 : S.w * 0.22,
        maxSize: side ? S.h * 0.3 : S.h * 0.26,
        tins: hook.map((_, i) => (i === 0 ? -0.4 : B(i))),
        tout: B(3.7),
        flash: true,
      });

      // ---- Maillot ----------------------------------------------------------
      const img = await ctx.image(P.image);
      const hero = side
        ? { x: S.cx, y: S.y + S.h * 0.57, h: S.h * 0.8 }
        : { x: L.W / 2, y: L.H * 0.47, h: Math.min(L.H * 0.46, (L.W * 0.9 * img.naturalHeight) / img.naturalWidth) };
      const end = side
        ? { x: S.x + S.w * 0.25, y: S.cy, s: Math.min(1.08, (S.w * 0.46 * img.naturalHeight) / img.naturalWidth / hero.h) }
        : { x: L.W / 2, y: S.y + S.h * 0.46, s: (S.h * 0.42) / hero.h };
      const prod = ui.product(ctx, img, {
        h: hero.h,
        x: hero.x,
        y: hero.y,
        detoure: P.detoure,
        // Révélation : le maillot est déjà là, sombre et flou, derrière
        // l'accroche (l'image 0 sert de miniature), puis claque au temps fort.
        start: { s: 1.3, o: 0.22, r: -4 },
        floatFrom: B(4.6),
      });
      prod.move(0, { s: 1.22 }, SP.doux);
      prod.move(B(4) - 0.1, { s: 1, o: 1, r: 0 }, SP.claque);
      prod.shine(B(4.4)).shine(B(13.6));
      ctx.cue(B(4) - 0.03, 'montee', { gain: 0.6 }); // le pic d'une montée est sa fin
      ctx.cue(B(4), 'boom', { gain: 1 });
      ctx.bg.flash(B(4), 0.4);
      // Coup de caméra à l'impact.
      ctx.cam.frame(0, L.W / 2, L.H / 2, 1);
      ctx.cam.frame(B(4) - 0.02, L.W / 2, L.H / 2, 1.045, SP.claque).frame(B(4.3), L.W / 2, L.H / 2, 1);

      // ---- Nom du produit ----------------------------------------------------
      const nameY = side ? S.y + S.h * 0.045 : S.y + S.h * 0.075;
      const nameEndY = side ? S.y + S.h * 0.2 : S.y + S.h * 0.1;
      const colX = side ? S.x + S.w * 0.74 : S.cx;
      const colW = side ? S.w * 0.48 : S.w;
      ui.text(ctx, P.nom || 'Maillot domicile', {
        x: (t) => (t < B(13.5) ? S.cx : glide(t, B(13.5), B(14.2), S.cx, colX)),
        y: (t) => (t < B(13.5) ? nameY : glide(t, B(13.5), B(14.2), nameY, nameEndY)),
        size: side ? S.h * 0.075 : S.h * 0.062,
        maxW: side ? S.w * 0.9 : S.w,
        upper: true,
        tin: B(5),
      });
      if (P.club && !side) {
        ui.text(ctx, P.club, { x: S.cx, y: nameY - S.h * 0.058, size: S.h * 0.036, weight: 600, maxW: S.w, upper: true, color: ui.colors(ctx).accent, tin: B(5.25), tout: B(15.5) });
      }

      // ---- Atouts -----------------------------------------------------------
      const atouts = (T.atouts || ['Tissu respirant', 'Écusson brodé', 'Coupe ajustée']).slice(0, 3).map((a, i) => {
        const def = [
          [0.5, 0.56],
          [0.64, 0.27],
          [0.13, 0.25],
        ][i];
        return typeof a === 'string' ? { texte: a, x: def[0], y: def[1] } : { x: def[0], y: def[1], ...a };
      });
      atouts.forEach((a, i) => {
        const tin = B(6 + i * 2.2);
        ui.callout(ctx, {
          product: prod,
          fx: a.x,
          fy: a.y,
          label: a.texte,
          icon: a.icone,
          tin,
          tout: B(13.2),
          dist: L.u * (side ? 30 : 24),
          size: L.u * (side ? 4.2 : 4.6),
          maxW: S.w * 0.62,
          pitch: i * 2,
        });
        // La caméra glisse doucement vers chaque atout.
        const w = prod.pointAt(tin, a.x, a.y);
        ctx.cam.frame(tin - 0.1, lerp(L.W / 2, w.x, 0.35), lerp(L.H / 2, w.y, 0.35), 1.1);
      });
      ctx.cam.frame(B(13.3), L.W / 2, L.H / 2, 1);

      // ---- Image de fin -----------------------------------------------------
      prod.move(B(13.5), { x: end.x, y: end.y, s: end.s }, SP.vif);
      ctx.cue(B(13.5), 'swipe', { gain: 0.6 });

      const priceSize = side ? Math.min(S.h * 0.17, colW * 0.32) : Math.min(S.h * 0.115, S.w * 0.2);
      const priceY = side ? S.y + S.h * 0.53 : S.y + S.h * 0.745;
      if (P.prix != null) {
        ui.price(ctx, { value: P.prix, old: P.prix_barre, devise: P.devise, x: colX, y: priceY, size: priceSize, tin: B(14), roll: 1.0 });
      }

      const mention = T.mention === undefined ? 'Produit authentique' : T.mention;
      if (mention) {
        ui.badge(ctx, {
          text: mention,
          icon: 'bouclier',
          x: colX,
          y: side ? S.y + S.h * 0.31 : S.y + S.h * 0.178,
          size: side ? S.h * 0.045 : S.h * 0.036,
          maxW: colW,
          style: 'contour',
          tin: B(16),
        });
      }

      await ui.logo(ctx, {
        x: colX,
        y: side ? S.y + S.h * 0.06 : S.y + S.h * 0.025,
        h: side ? S.h * 0.065 : S.h * 0.045,
        maxW: colW * 0.7,
        tin: B(16.5),
      });

      ui.button(ctx, {
        text: T.cta || 'Commander',
        x: colX,
        y: side ? S.y + S.h * 0.8 : S.y + S.h * 0.928,
        size: side ? S.h * 0.065 : S.h * 0.054,
        maxW: colW * 0.95,
        tin: B(17),
        press: [B(19)],
        icon: 'panier',
      });

      // Bandeau décoratif dans la zone basse du 9:16, que l'interface recouvre.
      if (L.fmt === '9:16' && T.bandeau !== false) {
        const nom = (spec.marque && spec.marque.nom) || '';
        ui.ticker(ctx, { text: T.bandeau || [nom, 'Maillots authentiques'].filter(Boolean).join(' • '), y: L.H * 0.84, size: L.u * 6, tin: B(16.2) });
      }
    },
  });
})();
