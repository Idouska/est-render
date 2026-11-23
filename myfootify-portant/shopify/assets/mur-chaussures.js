(() => {
  const init = (root) => {
    if (root.dataset.mfwReady) return;
    const raw = root.querySelector('[data-mfw-data]');
    const stage = root.querySelector('[data-stage]');
    if (!raw || !stage) return;
    let shoes;
    try { shoes = JSON.parse(raw.textContent); } catch (e) { return; }
    if (!shoes.length) return;
    root.dataset.mfwReady = '1';

    const q = (s) => root.querySelector(s);
    const wall = q('[data-wall]'), sizes = q('[data-sizes]'), add = q('[data-add]'), note = q('[data-note]');
    const narrow = () => stage.clientWidth < 760;
    const label = (v) => String(v).replace('.', ',');
    let current = -1, variant = null;

    const slots = shoes.map((s, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'mfw__slot' + (s.cut ? '' : ' is-raw');
      b.setAttribute('aria-label', s.title + ', ' + s.price);
      const img = new Image();
      img.alt = ''; img.decoding = 'async';
      img.src = s.thumb;
      const shelf = document.createElement('span'); shelf.className = 'mfw__shelf';
      const tag = document.createElement('span'); tag.className = 'mfw__tag'; tag.textContent = s.short;
      b.append(img, shelf, tag);
      b.addEventListener('click', () => zoom(i));
      wall.appendChild(b);
      return b;
    });

    // Emplacements : 5 colonnes sur grand écran, 2 sur téléphone.
    function place() {
      const cols = narrow() ? 2 : Math.min(5, Math.ceil(shoes.length / 2));
      const rows = Math.ceil(shoes.length / cols);
      const padX = narrow() ? 7 : 5, top = narrow() ? 13 : 20, bottom = narrow() ? 9 : 13;
      const cellW = (100 - 2 * padX) / cols, cellH = (100 - top - bottom) / rows;
      const W = stage.clientWidth, H = stage.clientHeight;
      slots.forEach((el, i) => {
        const c = i % cols, r = Math.floor(i / cols), ratio = shoes[i].ratio || 1;
        const w = cellW * (narrow() ? 0.78 : 0.9);
        const hPx = Math.min(((w / 100) * W) / ratio * 1.12, (cellH / 100) * H * 0.82);
        const wPx = Math.min((w / 100) * W, (hPx / 1.12) * ratio);
        el.style.width = wPx + 'px';
        el.style.height = hPx + 'px';
        el.style.left = ((padX + cellW * (c + 0.5)) / 100) * W - wPx / 2 + 'px';
        el.style.top = ((top + cellH * (r + 1)) / 100) * H - hPx - (cellH / 100) * H * 0.12 + 'px';
      });
      if (current >= 0) zoom(current, true);
    }

    function zoom(i, instant) {
      const el = slots[i], W = stage.clientWidth, H = stage.clientHeight;
      const w = el.offsetWidth, h = el.offsetHeight;
      const s = narrow() ? Math.min((W * 0.86) / w, (H * 0.3) / h) : Math.min((W * 0.5) / w, (H * 0.56) / h);
      const tx = W * (narrow() ? 0.5 : 0.44) - (el.offsetLeft + w / 2) * s;
      const ty = H * (narrow() ? 0.27 : 0.56) - (el.offsetTop + h / 2) * s;
      if (instant) { wall.style.transition = 'none'; requestAnimationFrame(() => { wall.style.transition = ''; }); }
      wall.style.transform = 'translate(' + tx + 'px,' + ty + 'px) scale(' + s + ')';
      slots.forEach((o, k) => o.classList.toggle('is-on', k === i));
      stage.classList.add('is-zoom');
      const img = el.querySelector('img');
      if (img.src !== shoes[i].img) { const big = new Image(); big.onload = () => { img.src = shoes[i].img; }; big.src = shoes[i].img; }
      if (current !== i) { current = i; fill(); }
    }

    function unzoom() {
      wall.style.transform = '';
      stage.classList.remove('is-zoom');
      slots.forEach((o) => o.classList.remove('is-on'));
      const back = current; current = -1;
      if (back >= 0) slots[back].focus({ preventScroll: true });
    }

    function fill() {
      const s = shoes[current];
      variant = null;
      const name = q('[data-name]'); name.textContent = '';
      const words = s.short.split(' ');
      const first = document.createElement('span'); first.textContent = words.shift();
      name.append(first, words.length ? ' ' + words.join(' ') : '');
      q('[data-kicker]').textContent = s.kicker || '';
      q('[data-price]').textContent = s.price;
      q('[data-size-label]').textContent = s.option || 'Pointure';
      q('[data-more]').href = s.url;
      note.textContent = '';
      sizes.textContent = '';
      const single = s.variants.length === 1;
      s.variants.forEach((v) => {
        const b = document.createElement('button');
        b.type = 'button'; b.textContent = label(v.label); b.disabled = !v.ok;
        b.setAttribute('aria-pressed', 'false');
        b.addEventListener('click', () => {
          variant = v;
          [...sizes.children].forEach((o) => o.setAttribute('aria-pressed', String(o === b)));
          add.disabled = false; add.textContent = 'Ajouter au panier'; note.textContent = '';
        });
        sizes.appendChild(b);
      });
      sizes.hidden = single;
      q('[data-size-label]').hidden = single;
      if (single && s.variants[0].ok) { variant = s.variants[0]; add.disabled = false; add.textContent = 'Ajouter au panier'; }
      else { add.disabled = true; add.textContent = s.variants.some((v) => v.ok) ? 'Choisis ta pointure' : 'Épuisé'; }
    }

    add.addEventListener('click', async () => {
      if (!variant) return;
      const s = shoes[current], v = variant;
      const rootUrl = (window.Shopify && window.Shopify.routes && window.Shopify.routes.root) || '/';
      add.disabled = true; add.textContent = 'Ajout…';
      try {
        const res = await fetch(rootUrl + 'cart/add.js', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ items: [{ id: v.id, quantity: 1 }] }),
        });
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).description || '');
        note.textContent = s.short + ', ' + label(v.label) + ' : ajouté. ';
        const a = document.createElement('a'); a.href = rootUrl + 'cart'; a.textContent = 'Voir le panier';
        note.appendChild(a);
        document.dispatchEvent(new CustomEvent('cart:refresh', { bubbles: true }));
      } catch (e) {
        note.textContent = e.message || 'Ajout impossible. Réessaie ou ouvre la fiche complète.';
      }
      add.disabled = false; add.textContent = 'Ajouter au panier';
    });

    q('[data-close]').addEventListener('click', unzoom);
    q('[data-prev]').addEventListener('click', () => zoom((current - 1 + shoes.length) % shoes.length));
    q('[data-next]').addEventListener('click', () => zoom((current + 1) % shoes.length));
    root.addEventListener('keydown', (e) => {
      if (current < 0) return;
      if (e.key === 'Escape') unzoom();
      if (e.key === 'ArrowLeft') q('[data-prev]').click();
      if (e.key === 'ArrowRight') q('[data-next]').click();
    });
    stage.addEventListener('click', (e) => { if (current >= 0 && (e.target === stage || e.target === wall)) unzoom(); });
    if (window.matchMedia('(hover: none)').matches) q('[data-hint]').textContent = 'Touche une paire';
    new ResizeObserver(place).observe(stage);
    place();
  };

  const boot = () => document.querySelectorAll('[data-mfw]').forEach(init);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
  document.addEventListener('shopify:section:load', boot);
})();
