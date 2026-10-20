/**
 * Présentation de cSAV Copilot — 68 temps (34 s à 120 BPM), en 16:9.
 *
 *   0–8    le problème : les mails SAV s'empilent ; « Ton SAV / déborde ? »
 *   8–14   l'outil : logo, nom, « L'IA prépare. Tu valides. »
 *   14–56  la démo, sur les vrais écrans de l'application (données fictives de la démo) :
 *          lecture et classement, commande Shopify et suivi retrouvés, réponse rédigée
 *          et expliquée, envoi au clic, cas ambigu, remboursement confirmé
 *   56–68  la fin : trois bénéfices, logo, « Essaie la démo »
 *
 * Modèle propre à ce projet : chargé par render.mjs via "modele": "presentation.js".
 */
(function () {
  const { SP, ui, el, put, vis, clamp, stepR, Track, E } = window.MM;

  MM.film({
    beats: 68,
    async build(ctx) {
      const { spec, L, B } = ctx;
      const { W, H, u } = L;
      const S = L.safe;
      const C = ui.colors(ctx);
      const T = spec.textes || {};
      ctx.tempsFort = B(8);

      // Style de l'outil : Inter, sans majuscules forcées.
      const css = document.createElement('style');
      css.textContent = `.mm-titre{text-transform:none;font-weight:800;letter-spacing:-0.035em;line-height:1.02}
        .mm-pill{text-transform:none;letter-spacing:0;font-weight:700}
        .mm-texte{letter-spacing:-0.01em}`;
      document.head.appendChild(css);

      ctx.bg = ui.background(ctx, { halo: 0.16 });

      /* ---- Acte 1 : le problème ------------------------------------------- */
      const mails = spec.mails || [];
      const cardW = W * 0.38;
      const step = H * 0.135;
      const y0 = H * 0.2;
      // Le premier mail est déjà là à l'image 0 (miniature) ; les suivants accélèrent.
      const arrivals = mails.map((_, i) => (i === 0 ? -0.25 : B(0.4 + i * (i < 3 ? 0.9 : 0.6))));
      mails.forEach((m, i) => {
        const card = el('div', {
          parent: ctx.hud,
          qa: 'deco', // l'avalanche de mails : un effet, pas un texte à lire carte par carte
          html: `<div style="width:2.2em;height:2.2em;border-radius:50%;background:${m.couleur || '#e8eefc'};color:#1d2b53;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:0.85em;flex:none">${m.initiales}</div>
            <div style="min-width:0;flex:1"><div style="display:flex;justify-content:space-between;gap:0.5em"><b style="font-size:1.1em;color:#101018">${m.nom}</b><span style="font-size:0.85em;color:#656b7e">${m.heure}</span></div>
            <div style="color:#474a5c;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${m.sujet}</div></div>`,
          style: {
            width: cardW + 'px',
            display: 'flex',
            alignItems: 'center',
            fontSize: H * 0.034 + 'px',
            gap: u * 1.6 + 'px',
            padding: `${u * 1.5}px ${u * 2}px`,
            background: 'rgba(255,255,255,0.96)',
            borderRadius: u * 2.2 + 'px',
            boxShadow: `0 ${u}px ${u * 4}px rgba(0,0,0,0.35)`,
            fontFamily: "'MM Texte', Inter, sans-serif",
          },
        });
        card.dataset.qaLabel = `${m.nom} ${m.sujet}`;
        const y = new Track(y0 - step * 0.8);
        y.to(arrivals[i] - 0.08, y0, SP.vif);
        arrivals.forEach((ta, j) => j > i && y.to(ta - 0.08, y0 + step * (j - i), SP.vif));
        const tout = B(7.4) + i * 0.03;
        ctx.cue(arrivals[i], 'pop', { gain: 0.75, pitch: i * 1.5 });
        ctx.add({
          seek(t) {
            const v = vis(t, arrivals[i] - 0.08, tout, { sp: SP.vif });
            const k = clamp(stepR(t - tout, SP.vif));
            put(card, { x: W * 0.68 + k * W * 0.5, y: y.at(t), s: 0.92 + 0.08 * clamp(v.e), o: v.o, b: v.b * 0.5 });
          },
        });
      });
      ui.title(ctx, ['Ton SAV', { text: 'déborde ?', accent: true }], {
        x: W * 0.28,
        cy: H * 0.46,
        maxW: W * 0.4,
        size: H * 0.13,
        justify: false,
        tins: [-0.4, B(2)],
        tout: B(7.3),
      });
      ctx.cue(B(7.5), 'whoosh', { gain: 0.7 });

      /* ---- Acte 2 : l'outil ------------------------------------------------ */
      const logoImg = await ctx.image(spec.logo_outil);
      const logo = el('img', { parent: ctx.hud, cls: 'mm-img', style: { width: H * 0.2 + 'px', height: H * 0.2 + 'px' } });
      logo.src = logoImg.src;
      logo.dataset.qa = 'logo';
      ctx.add({
        seek(t) {
          const v = vis(t, B(8) - 0.05, B(13.4), { sp: SP.claque });
          const s = clamp(stepR(t - B(8) + 0.05, SP.claque), 0, 1.3);
          put(logo, { x: W / 2, y: H * 0.36, s: 0.4 + 0.6 * s, r: (1 - clamp(s)) * -12, o: v.o, b: v.b });
        },
      });
      ctx.cue(B(8), 'boom', { gain: 0.9 });
      ctx.bg.flash(B(8), 0.25);
      ui.text(ctx, spec.nom_outil || 'cSAV Copilot', { x: W / 2, y: H * 0.56, size: H * 0.085, titre: true, weight: 800, tin: B(9), tout: B(13.4) });
      ui.text(ctx, T.promesse || "L'IA prépare. Tu valides.", { x: W / 2, y: H * 0.66, size: H * 0.045, weight: 600, color: C.doux, tin: B(10.5), tout: B(13.4) });

      /* ---- Acte 3 : la démo, sur les vrais écrans --------------------------- */
      const ecrans = spec.ecrans || {};
      const cx = W / 2;
      const cy = H * 0.5;
      const h0 = H * 0.84;
      const prods = {};
      for (const [nom, e] of Object.entries(ecrans)) {
        const img = await ctx.image(e.image);
        // Le premier écran entre par le bas, incliné ; les autres arrivent en fondu à sa place.
        const start = nom === 'lea-haut' ? { y: cy + H * 0.95, rx: 24, s: 0.9, o: 1 } : { o: 0 };
        prods[nom] = ui.product(ctx, img, { h: h0, x: cx, y: cy, detoure: false, flouOpacite: false, start });
        prods[nom].zones = e.zones || {};
      }
      const w0 = prods['lea-haut'].w0;
      // Zone de capture (fractions) → rectangle dans le monde.
      const zone = (nom, z) => {
        const r = typeof z === 'string' ? prods[nom].zones[z] : z;
        return { x: cx - w0 / 2 + r.x * w0, y: cy - h0 / 2 + r.y * h0, w: r.w * w0, h: r.h * h0 };
      };
      // Cadre la caméra sur un rectangle, un peu au-dessus du centre (place pour la légende).
      // Le cadre reste dans la fenêtre filmée : jamais de bande vide sur les bords.
      const cadrer = (t, r, zmax = 2.4, sp = { w: 7, z: 1 }) => {
        const z = Math.min(zmax, (W * 0.6) / r.w, (H * 0.56) / r.h);
        const hw = W / (2 * z);
        const hh = H / (2 * z);
        const x = clamp(r.x + r.w / 2, cx - w0 / 2 + hw, cx + w0 / 2 - hw);
        const y = clamp(r.y + r.h / 2 + (H * 0.07) / z, cy - h0 / 2 + hh, cy + h0 / 2 - hh);
        ctx.cam.frame(t, x, y, z, sp);
        ctx.cue(t + 0.05, 'swipe', { gain: 0.35 });
      };
      // Affiche un écran (fondu enchaîné avec le précédent).
      let actuel = null;
      const montrer = (t, nom) => {
        prods[nom].o.to(t, 1, SP.texte);
        if (actuel && actuel !== nom) prods[actuel].o.to(t + 0.12, 0, SP.texte);
        actuel = nom;
      };

      // Entrée de la fenêtre : monte du bas, inclinée, puis se redresse.
      actuel = 'lea-haut';
      prods['lea-haut'].move(B(13.6), { y: cy, rx: 0, s: 1 }, { w: 8, z: 0.9 });
      ctx.cue(B(13.7), 'whoosh', { gain: 0.6 });

      // Projecteur : tout s'assombrit sauf la zone montrée, entourée d'un trait.
      // Le voile est un tracé SVG à la taille de l'écran (grand rectangle percé d'un trou
      // arrondi, règle evenodd), dans le calque écran : agrandi par la caméra, un calque
      // plus large que ~16 000 px serait abandonné sans erreur par le compositeur.
      const NS = 'http://www.w3.org/2000/svg';
      const voile = document.createElementNS(NS, 'svg');
      voile.setAttribute('width', W);
      voile.setAttribute('height', H);
      voile.setAttribute('viewBox', `0 0 ${W} ${H}`);
      voile.innerHTML = '<path fill="rgba(4,8,20,0.58)" fill-rule="evenodd"/>';
      ctx.hud.appendChild(voile);
      const voilePath = voile.querySelector('path');
      const spot = el('div', { parent: ctx.world, style: { border: `${u * 0.35}px solid ${C.accent}`, borderRadius: u * 1.2 + 'px' } });
      const SX = new Track(cx);
      const SY = new Track(cy);
      const SW = new Track(w0);
      const SH = new Track(h0);
      const SO = new Track(0);
      const viser = (t, r, pad = u * 0.8) => {
        for (const [tr, v] of [
          [SX, r.x - pad],
          [SY, r.y - pad],
          [SW, r.w + pad * 2],
          [SH, r.h + pad * 2],
        ])
          tr.to(t, v, SP.vif);
        SO.to(t, 1, SP.texte);
        ctx.cue(t + 0.1, 'pop', { gain: 0.4, pitch: 4 });
      };
      ctx.add({
        seek(t) {
          const x = SX.at(t);
          const y = SY.at(t);
          const w = SW.at(t);
          const h = SH.at(t);
          const o = clamp(SO.at(t));
          const rr = Math.min(u * 1.2, w / 2, h / 2);
          spot.style.width = w.toFixed(1) + 'px';
          spot.style.height = h.toFixed(1) + 'px';
          put(spot, { x, y, ax: 0, ay: 0, o });
          const a = ctx.cam.toScreen(t, x, y);
          const z = a.z;
          const [X, Y, Wd, Ht, R] = [a.x, a.y, w * z, h * z, rr * z];
          voilePath.setAttribute(
            'd',
            `M0 0h${W}v${H}h${-W}z ` +
              `M${X + R} ${Y}h${Wd - 2 * R}a${R} ${R} 0 0 1 ${R} ${R}v${Ht - 2 * R}a${R} ${R} 0 0 1 ${-R} ${R}h${-(Wd - 2 * R)}a${R} ${R} 0 0 1 ${-R} ${-R}v${-(Ht - 2 * R)}a${R} ${R} 0 0 1 ${R} ${-R}z`,
          );
          put(voile, { x: 0, y: 0, ax: 0, ay: 0, o });
        },
      });

      // Légendes : carte en bas à gauche, une étape et une phrase.
      const legende = (etape, texte, tin, tout) => {
        const card = el('div', {
          parent: ctx.hud,
          style: {
            display: 'flex',
            flexDirection: 'column',
            gap: u * 0.6 + 'px',
            padding: `${u * 1.8}px ${u * 2.8}px`,
            background: 'rgba(8,12,26,0.86)',
            borderLeft: `${u * 0.6}px solid ${C.accent}`,
            borderRadius: u * 1.6 + 'px',
            boxShadow: `0 ${u}px ${u * 5}px rgba(0,0,0,0.4)`,
          },
        });
        el('div', { parent: card, cls: 'mm-texte', text: etape, qa: 'texte', style: { fontSize: H * 0.034 + 'px', color: C.accent, fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.08em' } });
        const main = el('div', { parent: card, cls: 'mm-texte', text: texte, qa: 'texte', style: { fontSize: H * 0.05 + 'px', color: '#fff', fontWeight: '700' } });
        // Une ligne : la taille s'ajuste à la largeur disponible.
        MM.fit(main, S.w * 0.62, H * 0.05, H * 0.034);
        ctx.cue(tin, 'tic', { gain: 0.45 });
        ctx.add({
          seek(t) {
            const v = vis(t, tin, tout);
            put(card, { x: S.x + (1 - clamp(v.e)) * -u * 4, y: S.b, ax: 0, ay: 1, o: v.o, b: v.b * 0.5 });
          },
        });
      };

      // a) Le mail arrive, l'IA le lit et le classe.
      cadrer(B(16), zone('lea-haut', 'mail'), 2.1);
      viser(B(16.4), zone('lea-haut', 'mail'));
      legende('1 · Le mail arrive', 'L’IA lit la demande.', B(16.5), B(19.8));
      viser(B(19.5), zone('lea-haut', 'classement'));
      legende('1 · Le mail arrive', 'Classée, sûre à 93 %.', B(20), B(22.8));

      // b) La commande Shopify et le colis, retrouvés seuls.
      cadrer(B(23), zone('lea-haut', 'commande'), 2.2);
      viser(B(23.3), zone('lea-haut', 'commande'));
      legende('2 · Shopify', 'Commande retrouvée toute seule.', B(23.5), B(26.6));
      cadrer(B(26.6), zone('lea-haut', 'livraison'), 2.2);
      viser(B(26.8), zone('lea-haut', 'livraison'));
      legende('2 · Shopify', 'Suivi du colis inclus.', B(27), B(29.8));

      // c) La réponse est rédigée, et expliquée.
      montrer(B(30), 'lea-brouillon');
      SO.to(B(29.9), 0, { w: 30, z: 1 });
      cadrer(B(30.1), zone('lea-brouillon', 'texte'), 2.1);
      viser(B(30.6), zone('lea-brouillon', 'texte'));
      legende('3 · La réponse', 'Réponse prête, infos à l’appui.', B(30.6), B(33.8));
      viser(B(33.8), zone('lea-brouillon', 'pourquoi'));
      legende('3 · La réponse', 'Et elle explique pourquoi.', B(34.2), B(36.8));

      // d) Rien ne part sans ton clic.
      const btn = zone('lea-brouillon', 'envoyer');
      const mention = zone('lea-brouillon', 'clic');
      const zoneClic = { x: Math.min(btn.x, mention.x), y: btn.y, w: Math.max(btn.x + btn.w, mention.x + mention.w) - Math.min(btn.x, mention.x), h: mention.y + mention.h - btn.y };
      cadrer(B(37), { x: zoneClic.x - zoneClic.w * 1.2, y: zoneClic.y - zoneClic.h, w: zoneClic.w * 2.4, h: zoneClic.h * 3 }, 2.6);
      viser(B(37.3), zoneClic);
      legende('4 · Toi', 'Rien ne part sans ton clic.', B(37.5), B(42.6));
      const bx = btn.x + btn.w * 0.55;
      const by = btn.y + btn.h * 0.55;
      ui.curseur(ctx, {
        points: [
          [B(37.6), bx - w0 * 0.12, by + h0 * 0.1],
          [B(38.4), bx, by],
        ],
        clics: [B(40)],
        tin: B(37.6),
        tout: B(42),
        size: u * 2.4,
      });

      // e) Envoyé.
      montrer(B(40.15), 'lea-envoye');
      SO.to(B(40.1), 0, { w: 30, z: 1 });
      ctx.cue(B(40.5), 'caisse', { gain: 0.6 });
      cadrer(B(40.8), zone('lea-envoye', 'message'), 1.9);
      viser(B(41.2), zone('lea-envoye', 'envoyee'), u * 0.6);
      legende('4 · Toi', 'Envoyé. Le ticket est clos.', B(42.8), B(45.8));

      // f) Cas ambigu : l'IA ne devine pas.
      montrer(B(46), 'julien');
      SO.to(B(45.9), 0, { w: 30, z: 1 });
      cadrer(B(46.1), zone('julien', 'candidats'), 2.1);
      viser(B(46.5), zone('julien', 'candidats'));
      legende('5 · Prudence', 'Trois commandes possibles ?', B(46.5), B(49.6));
      cadrer(B(49.6), zone('julien', 'texte_ia'), 2.1);
      viser(B(49.8), zone('julien', 'texte_ia'));
      legende('5 · Prudence', 'Elle demande, sans deviner.', B(50), B(52.8));

      // g) Remboursement : confirmation obligatoire.
      montrer(B(53), 'amelie-modale');
      SO.to(B(52.9), 0, { w: 30, z: 1 });
      cadrer(B(53.1), zone('amelie-modale', 'modale'), 1.9);
      viser(B(53.5), zone('amelie-modale', 'modale'));
      legende('6 · Remboursement', 'Confirmation obligatoire, tracée.', B(53.5), B(56.6));

      /* ---- Acte 4 : la fin ------------------------------------------------- */
      SO.to(B(56.6), 0, SP.texte);
      montrer(B(56.7), 'lea-envoye');
      ctx.cam.frame(B(56.6), W / 2, H / 2, 1, { w: 6, z: 1 });
      for (const p of Object.values(prods)) p.move(B(56.8), { x: W * 0.31, y: H * 0.52, s: 0.6, ry: 16 }, { w: 7, z: 1 });
      ctx.cue(B(56.7), 'whoosh', { gain: 0.6 });
      const colX = W * 0.74;
      const fin = el('img', { parent: ctx.hud, cls: 'mm-img', style: { width: H * 0.11 + 'px', height: H * 0.11 + 'px' } });
      fin.src = logoImg.src;
      fin.dataset.qa = 'logo';
      ctx.add({
        seek(t) {
          const v = vis(t, B(57.5), null, { sp: SP.claque });
          put(fin, { x: colX - W * 0.12, y: H * 0.2, s: 0.5 + 0.5 * clamp(stepR(t - B(57.5), SP.claque), 0, 1.2), o: v.o, b: v.b });
        },
      });
      ui.text(ctx, spec.nom_outil || 'cSAV Copilot', { x: colX - W * 0.12 + H * 0.08, y: H * 0.2, ax: 0, size: H * 0.06, titre: true, weight: 800, tin: B(57.8) });
      ui.text(ctx, T.signature || 'Le SAV de ta boutique Shopify,', { x: colX, y: H * 0.33, size: H * 0.042, weight: 600, maxW: W * 0.42, tin: B(58.3) });
      ui.text(ctx, T.signature2 || 'préparé par l’IA.', { x: colX, y: H * 0.39, size: H * 0.042, weight: 600, maxW: W * 0.42, color: C.accent, tin: B(58.6) });
      (T.benefices || []).slice(0, 3).forEach((b, i) =>
        ui.badge(ctx, { text: b.texte || b, icon: b.icone || 'check', x: colX, y: H * (0.52 + i * 0.09), size: H * 0.034, maxW: W * 0.42, style: 'sombre', tin: B(59.5 + i * 0.75) }),
      );
      ui.button(ctx, { text: T.cta || 'Essaie la démo', x: colX, y: H * 0.84, size: H * 0.045, maxW: W * 0.36, tin: B(62), press: [B(64)], icon: 'fleche' });
    },
  });
})();
