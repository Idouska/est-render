/*
 * Portant de maillots — le hero 3D de My Footify.
 *
 * Reprend l'animation « The rail » : les maillots pendent de biais sur une
 * barre chromée, se balancent, s'écartent au survol et viennent au premier plan
 * quand on clique, où l'on peut les tourner pour voir le dos.
 *
 * Chaque maillot est reconstruit en volume à partir de ses photos produit :
 * le fond (blanc ou gris uni) est détouré, puis la silhouette est « gonflée »
 * pour donner une épaisseur de tissu. La photo de face habille l'avant, la
 * photo de dos (si elle existe) habille l'arrière.
 */
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.min.js';

const SPACING = 0.66; // écart entre deux cintres : les maillots se serrent sur la barre
const RAIL_Y = 1.5; // hauteur de la barre
const ANGLE = -1.36; // presque par la tranche, comme sur un vrai portant
const SPREAD = 1.3; // de combien les voisins s'écartent du maillot survolé
const THICK = 0.45; // épaisseur du tissu (1 = « gonflé ») : fin, pour ne pas voir une tranche de mousse de profil
const SHIRT_H = 2.62; // hauteur d'un maillot, en unités de scène
const SHIRT_MAX_W = 2.9;
const COLLAR_Y = -0.33; // le haut du col, sous la barre, là où arrive la tige du cintre
const STEP = 1 / 60; // pas d'intégration des ressorts
const BENCH_SPACING = 1.3; // écart entre deux chaussures sur le banc
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

/* ------------------------------------------------------------------------ */
/* Photos → maillot en volume                                               */
/*                                                                          */
/* Ces fonctions ne dépendent ni de la page ni de Three.js : elles tournent */
/* dans un worker (voir PIPELINE plus bas), pour que la page reste fluide   */
/* pendant qu'on détoure les photos.                                        */
/* ------------------------------------------------------------------------ */

// Un canevas de travail : un vrai <canvas> sur la page, un OffscreenCanvas dans le worker.
function makeCanvas(w, h) {
  if (typeof document === 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

async function loadBitmap(url) {
  // Le CDN Shopify renvoie du WebP/AVIF (transparence comprise) si on le demande : ~7× plus léger qu'un PNG.
  const res = await fetch(url, { mode: 'cors', credentials: 'omit', headers: { Accept: 'image/avif,image/webp,image/*;q=0.8,*/*;q=0.5' } });
  if (!res.ok) throw new Error('Image introuvable : ' + url);
  return createImageBitmap(await res.blob());
}

// Une couleur #rrggbb assombrie (f < 1) ou éclaircie.
function shade(hex, f) {
  return '#' + [1, 3, 5].map((i) => Math.min(255, Math.round(parseInt(hex.slice(i, i + 2), 16) * f)).toString(16).padStart(2, '0')).join('');
}

// Couleur du fond : médiane des pixels du bord de l'image.
function borderColor(px, w, h) {
  const r = [], g = [], b = [];
  const take = (i) => { r.push(px[i * 4]); g.push(px[i * 4 + 1]); b.push(px[i * 4 + 2]); };
  for (let x = 0; x < w; x += 2) { take(x); take((h - 1) * w + x); }
  for (let y = 0; y < h; y += 2) { take(y * w); take(y * w + w - 1); }
  const med = (a) => a.sort((p, q) => p - q)[a.length >> 1];
  return [med(r), med(g), med(b)];
}

// Ne garde que la plus grande tache (le maillot) : l'ombre au sol et les
// poussières disparaissent.
function keepLargest(fg, w, h) {
  const label = new Int32Array(w * h);
  const queue = new Int32Array(w * h);
  let best = 0, bestSize = 0, next = 0;
  for (let s = 0; s < w * h; s++) {
    if (!fg[s] || label[s]) continue;
    next++;
    let head = 0, tail = 0;
    queue[tail++] = s;
    label[s] = next;
    while (head < tail) {
      const i = queue[head++], x = i % w;
      const n = [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w];
      for (const j of n) {
        if (j >= 0 && j < w * h && fg[j] && !label[j]) { label[j] = next; queue[tail++] = j; }
      }
    }
    if (tail > bestSize) { bestSize = tail; best = next; }
  }
  for (let i = 0; i < w * h; i++) fg[i] = label[i] === best ? 1 : 0;
  return bestSize;
}

// Rogne un pixel sur le contour : c'est là que le blanc du fond déteint.
function erode(fg, w, h) {
  const src = fg.slice();
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (src[i] && (x === 0 || y === 0 || x === w - 1 || y === h - 1 ||
          !src[i - 1] || !src[i + 1] || !src[i - w] || !src[i + w])) fg[i] = 0;
    }
  }
}

// Adoucit le bruit JPEG (flou 3×3) pour que le fond se parcoure à petits pas.
function soften(px, w, h) {
  const out = new Float32Array(w * h * 3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0, g = 0, b = 0, n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= w) continue;
          const j = (yy * w + xx) * 4;
          r += px[j]; g += px[j + 1]; b += px[j + 2]; n++;
        }
      }
      const i = (y * w + x) * 3;
      out[i] = r / n; out[i + 1] = g / n; out[i + 2] = b / n;
    }
  }
  return out;
}

// Distance (chanfrein) de chaque pixel à la source la plus proche (src[i] = 1).
// Hors de l'image, rien ne compte comme source.
function chamfer(src, w, h) {
  const d = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) d[i] = src[i] ? 0 : 1e9;
  const D = Math.SQRT2;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      let v = d[i];
      if (!v) continue;
      if (x > 0) v = Math.min(v, d[i - 1] + 1);
      if (y > 0) {
        v = Math.min(v, d[i - w] + 1);
        if (x > 0) v = Math.min(v, d[i - w - 1] + D);
        if (x < w - 1) v = Math.min(v, d[i - w + 1] + D);
      }
      d[i] = v;
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      let v = d[i];
      if (!v) continue;
      if (x < w - 1) v = Math.min(v, d[i + 1] + 1);
      if (y < h - 1) {
        v = Math.min(v, d[i + w] + 1);
        if (x < w - 1) v = Math.min(v, d[i + w + 1] + D);
        if (x > 0) v = Math.min(v, d[i + w - 1] + D);
      }
      d[i] = v;
    }
  }
  return d;
}

/*
 * Le fond, remonté depuis les bords de l'image comme un pot de peinture à
 * pinceau épais. Est « fond » un pixel proche de la couleur du fond et sans
 * relief (aucun voisin ne s'en écarte de plus de `local`). La peinture ne
 * passe que là où un disque de rayon `gap` tient entièrement dans le fond :
 * sur un maillot blanc photographié sur du blanc, le contour a des trous
 * (tissu et fond valent 255 tous les deux), et c'est ce qui les colmate.
 */
export function flood(c, w, h, bgColor, global, local, gap) {
  const n = w * h;
  const [br, bg, bb] = bgColor;
  const diff = (i, j) => Math.max(Math.abs(c[i * 3] - c[j * 3]), Math.abs(c[i * 3 + 1] - c[j * 3 + 1]), Math.abs(c[i * 3 + 2] - c[j * 3 + 2]));
  const flat = new Uint8Array(n);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (Math.max(Math.abs(c[i * 3] - br), Math.abs(c[i * 3 + 1] - bg), Math.abs(c[i * 3 + 2] - bb)) > global) continue;
      if ((x > 0 && diff(i, i - 1) > local) || (x < w - 1 && diff(i, i + 1) > local) ||
          (y > 0 && diff(i, i - w) > local) || (y < h - 1 && diff(i, i + w) > local)) continue;
      flat[i] = 1;
    }
  }

  // Là où le pinceau tient : assez loin de tout pixel qui n'est pas du fond.
  const notFlat = new Uint8Array(n);
  for (let i = 0; i < n; i++) notFlat[i] = flat[i] ? 0 : 1;
  const room = chamfer(notFlat, w, h);
  const seen = new Uint8Array(n);
  const queue = new Int32Array(n);
  let head = 0, tail = 0;
  const seed = (i) => { if (!seen[i] && room[i] > gap) { seen[i] = 1; queue[tail++] = i; } };
  for (let x = 0; x < w; x++) { seed(x); seed((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { seed(y * w); seed(y * w + w - 1); }
  while (head < tail) {
    const i = queue[head++], x = i % w;
    if (x > 0) seed(i - 1);
    if (x < w - 1) seed(i + 1);
    if (i >= w) seed(i - w);
    if (i < n - w) seed(i + w);
  }

  // Le coup de pinceau recouvre aussi la bordure qu'il n'a pas pu longer.
  const reach = chamfer(seen, w, h);
  const fg = new Uint8Array(n);
  for (let i = 0; i < n; i++) fg[i] = flat[i] && reach[i] <= gap + 0.5 ? 0 : 1;
  return fg;
}

// Le grain du fond, mesuré sur les bords de l'image : le seuil de relief s'y adapte.
function grain(c, w, h) {
  const steps = [];
  const at = (x, y) => (y * w + x) * 3;
  for (let x = 1; x < w; x += 2) {
    for (const y of [1, h - 2]) {
      const i = at(x, y), j = at(x - 1, y);
      steps.push(Math.max(Math.abs(c[i] - c[j]), Math.abs(c[i + 1] - c[j + 1]), Math.abs(c[i + 2] - c[j + 2])));
    }
  }
  steps.sort((a, b) => a - b);
  return steps[Math.floor(steps.length * 0.9)];
}

/*
 * Le pot de peinture s'arrête là où le fond commence à varier : autour du
 * maillot, le dégradé du studio laisse une frange de pixels encore couleur
 * fond. On l'épluche depuis l'extérieur, quelques pixels au plus, pour ne
 * pas entamer un maillot blanc.
 */
function peel(fg, px, w, h, bgColor, tol, depth) {
  const [br, bg, bb] = bgColor;
  const n = w * h;
  const looksBg = (i) => Math.max(Math.abs(px[i * 4] - br), Math.abs(px[i * 4 + 1] - bg), Math.abs(px[i * 4 + 2] - bb)) <= tol;
  for (let pass = 0; pass < depth; pass++) {
    const strip = [];
    for (let i = 0; i < n; i++) {
      if (!fg[i] || !looksBg(i)) continue;
      const x = i % w;
      if ((x > 0 && !fg[i - 1]) || (x < w - 1 && !fg[i + 1]) || (i >= w && !fg[i - w]) || (i < n - w && !fg[i + w])) strip.push(i);
    }
    if (!strip.length) return;
    for (const i of strip) fg[i] = 0;
  }
}

/*
 * L'ombre portée sous l'ourlet (gris clair, neutre, fondu) reste collée au
 * maillot après le détourage. On la gratte depuis le fond, dans le bas de la
 * silhouette seulement, et seulement sur un maillot de couleur : sur un
 * maillot blanc ou gris, on ne distinguerait plus l'ombre du tissu.
 */
function dropShadow(fg, c, w, h) {
  const n = w * h;
  const neutral = (i) => {
    const r = c[i * 3], g = c[i * 3 + 1], b = c[i * 3 + 2];
    return Math.max(r, g, b) - Math.min(r, g, b) <= 12 && r + g + b >= 450;
  };
  let area = 0, grey = 0, top = h, bottom = 0;
  for (let i = 0; i < n; i++) {
    if (!fg[i]) continue;
    area++;
    if (neutral(i)) grey++;
    const y = (i / w) | 0;
    if (y < top) top = y;
    if (y > bottom) bottom = y;
  }
  if (!area || grey > area * 0.12) return;
  const floor = top + (bottom - top) * 0.8;
  const queue = new Int32Array(n);
  let head = 0, tail = 0;
  const take = (j, i) => {
    if (!fg[j] || j < floor * w || !neutral(j)) return;
    if (Math.max(Math.abs(c[i * 3] - c[j * 3]), Math.abs(c[i * 3 + 1] - c[j * 3 + 1]), Math.abs(c[i * 3 + 2] - c[j * 3 + 2])) > 8) return;
    fg[j] = 0;
    queue[tail++] = j;
  };
  for (let i = Math.floor(floor) * w; i < n; i++) if (!fg[i]) queue[tail++] = i;
  while (head < tail) {
    const i = queue[head++], x = i % w;
    if (x > 0) take(i - 1, i);
    if (x < w - 1) take(i + 1, i);
    if (i >= w) take(i - w, i);
    if (i < n - w) take(i + w, i);
  }
}

/*
 * Détoure le maillot. PNG transparent : l'alpha suffit. Photo sur fond uni :
 * pot de peinture depuis les bords, puis on épluche la frange de fond, on
 * gratte l'ombre portée et on ne garde que la plus grande tache. Renvoie la
 * silhouette à la résolution d'analyse, son cadre et la couleur moyenne du
 * maillot. `tune` ne sert qu'aux essais de réglages.
 */
export function cutout(img, maxSide = 1024, tune = {}) {
  const k = Math.min(1, maxSide / Math.max(img.width, img.height));
  const w = Math.max(8, Math.round(img.width * k));
  const h = Math.max(8, Math.round(img.height * k));
  const ctx = makeCanvas(w, h).getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, w, h);
  const px = ctx.getImageData(0, 0, w, h).data;
  const n = w * h;
  let fg;

  let transparentEdge = 0;
  for (let x = 0; x < w; x++) if (px[x * 4 + 3] < 250 || px[((h - 1) * w + x) * 4 + 3] < 250) transparentEdge++;
  if (transparentEdge > w * 0.5) {
    fg = new Uint8Array(n);
    for (let i = 0; i < n; i++) fg[i] = px[i * 4 + 3] >= 128 ? 1 : 0;
  } else {
    const soft = soften(px, w, h);
    const local = tune.local ?? Math.max(1.5, grain(soft, w, h) * 1.5);
    const bgColor = borderColor(px, w, h);
    fg = flood(soft, w, h, bgColor, tune.global ?? 40, local, tune.gap ?? 3);
    peel(fg, px, w, h, bgColor, 14, 6);
    dropShadow(fg, soft, w, h);
  }

  erode(fg, w, h);
  const area = keepLargest(fg, w, h);
  if (area < n * 0.03) return null;

  let x0 = w, y0 = h, x1 = 0, y1 = 0, r = 0, g = 0, b = 0, count = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!fg[i]) continue;
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
      if ((x + y) % 3 === 0) { r += px[i * 4]; g += px[i * 4 + 1]; b += px[i * 4 + 2]; count++; }
    }
  }
  const hex = (v) => Math.round(v / count).toString(16).padStart(2, '0');
  // Une marge autour du maillot, pour que le maillage déborde du contour.
  const pad = 6;
  x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad);
  x1 = Math.min(w - 1, x1 + pad); y1 = Math.min(h - 1, y1 + pad);
  return { img, w, h, fg, k, box: { x0, y0, x1, y1 }, swatch: '#' + hex(r) + hex(g) + hex(b) };
}

// La silhouette rognée, avec ses distances au bord (dedans et dehors) et le point d'accroche du col.
function measure(cut) {
  const { x0, y0, x1, y1 } = cut.box;
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  const fg = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) fg[y * w + x] = cut.fg[(y + y0) * cut.w + x + x0];
  }

  // Distance au bord (chanfrein 3-4, en pixels).
  const d = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) d[i] = fg[i] ? 1e9 : 0;
  const at = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : d[y * w + x]);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (d[i]) d[i] = Math.min(d[i], at(x - 1, y) + 1, at(x, y - 1) + 1, at(x - 1, y - 1) + 1.4142, at(x + 1, y - 1) + 1.4142);
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      if (d[i]) d[i] = Math.min(d[i], at(x + 1, y) + 1, at(x, y + 1) + 1, at(x + 1, y + 1) + 1.4142, at(x - 1, y + 1) + 1.4142);
    }
  }

  // Le col : le centre des épaules (bande du haut), puis le premier pixel de tissu dessous.
  let sx = 0, sn = 0, first = 0;
  while (first < h - 1 && !fg.subarray(first * w, first * w + w).includes(1)) first++;
  const band = first + Math.max(2, Math.round(h * 0.1));
  for (let y = first; y < band && y < h; y++) for (let x = 0; x < w; x++) if (fg[y * w + x]) { sx += x; sn++; }
  const neckX = sn ? sx / sn : w / 2;
  let neckTop = h;
  const reach = Math.max(1, Math.round(w * 0.04));
  for (let x = Math.round(neckX) - reach; x <= Math.round(neckX) + reach; x++) {
    if (x < 0 || x >= w) continue;
    for (let y = 0; y < h; y++) if (fg[y * w + x]) { neckTop = Math.min(neckTop, y); break; }
  }
  if (neckTop === h) neckTop = 0;
  return { fg, dist: d, outside: chamfer(fg, w, h), w, h, neckX, neckTop };
}

/*
 * Profil du tissu selon la distance au bord (en unités de scène) : bords
 * arrondis, poitrine légèrement bombée. Hors de la silhouette (distance
 * négative) la pente se prolonge : l'avant passe derrière, l'arrière devant,
 * et les deux se croisent exactement sur le contour, sans jour entre eux.
 */
function inflate(dw) {
  const ramp = (t) => (t >= 1 ? 1 : 2 * t - t * t);
  if (dw <= 0) return THICK * Math.max(-0.04, dw * (2 * 0.05 / 0.07 + 2 * 0.075 / 0.6));
  return THICK * (0.05 * ramp(dw / 0.07) + 0.075 * ramp(dw / 0.6));
}

// Le maillage, en tableaux bruts (le worker ne connaît pas Three.js).
function buildMesh(shape) {
  const { fg, dist, outside, w, h, neckX, neckTop } = shape;
  const s = Math.min(SHIRT_H / h, SHIRT_MAX_W / w); // unités de scène par pixel
  const cols = 48, rows = Math.max(8, Math.round((cols * h) / w));
  const cw = w / cols, ch = h / rows;

  // Les cases qui touchent le maillot, élargies d'une case : le maillage
  // déborde un peu de la silhouette, que le masque découpe ensuite.
  const occ = new Uint8Array(cols * rows);
  for (let y = 0; y < h; y++) {
    const r = Math.min(rows - 1, Math.floor(y / ch));
    for (let x = 0; x < w; x++) if (fg[y * w + x]) occ[r * cols + Math.min(cols - 1, Math.floor(x / cw))] = 1;
  }
  const cells = new Uint8Array(cols * rows);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      let on = 0;
      for (let dr = -1; dr <= 1 && !on; dr++) {
        for (let dc = -1; dc <= 1 && !on; dc++) {
          const rr = r + dr, cc = c + dc;
          if (rr >= 0 && cc >= 0 && rr < rows && cc < cols && occ[rr * cols + cc]) on = 1;
        }
      }
      cells[r * cols + c] = on;
    }
  }

  // Distance signée au contour (positive dedans), lue entre les pixels : vu
  // par la tranche, le moindre décalage entre l'avant et l'arrière ferait un
  // jour. On la décale d'un demi-pixel pour que les deux faces se rejoignent
  // juste avant la découpe du masque.
  const sd = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) sd[i] = (fg[i] ? dist[i] - 0.5 : 0.5 - outside[i]) - 0.4;
  const signed = (px, py) => {
    const x = Math.min(w - 1.001, Math.max(0, px - 0.5)), y = Math.min(h - 1.001, Math.max(0, py - 0.5));
    const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi, i = yi * w + xi;
    const top = sd[i] + (sd[i + 1] - sd[i]) * fx;
    const bottom = sd[i + w] + (sd[i + w + 1] - sd[i + w]) * fx;
    return top + (bottom - top) * fy;
  };

  const vid = new Int32Array((cols + 1) * (rows + 1)).fill(-1);
  const pos = [], uv = [];
  const vertex = (c, r) => {
    const key = r * (cols + 1) + c;
    if (vid[key] >= 0) return vid[key];
    const px = c * cw, py = r * ch;
    const z = inflate(signed(px, py) * s);
    pos.push((px - neckX) * s, -(py - neckTop) * s, z);
    uv.push(px / w, py / h); // v = 0 en haut : les textures ne sont pas retournées
    return (vid[key] = pos.length / 3 - 1);
  };
  const front = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!cells[r * cols + c]) continue;
      const tl = vertex(c, r), tr = vertex(c + 1, r), bl = vertex(c, r + 1), br = vertex(c + 1, r + 1);
      front.push(tl, bl, br, tl, br, tr);
    }
  }

  // L'arrière : les mêmes points, en miroir derrière, faces retournées.
  const count = pos.length / 3;
  for (let i = 0; i < count; i++) {
    pos.push(pos[i * 3], pos[i * 3 + 1], -pos[i * 3 + 2]);
    uv.push(uv[i * 2], uv[i * 2 + 1]);
  }
  const back = [];
  for (let t = 0; t < front.length; t += 3) back.push(front[t] + count, front[t + 2] + count, front[t + 1] + count);

  // Le bras du cintre, glissé dans le maillot : il suit la ligne des épaules de
  // CETTE silhouette, un peu en dessous, et s'arrête avant l'emmanchure. Seul
  // le bois vu par l'encolure reste visible, comme sur un vrai portant.
  const topRow = (col) => {
    const c = Math.round(col);
    if (c < 0 || c >= w) return -1;
    for (let y = 0; y < h; y++) if (fg[y * w + c]) return y;
    return -1;
  };
  const chest = Math.min(h - 1, Math.round(neckTop + 0.3 / s));
  let left = -1, right = -1;
  for (let x = 0; x < w; x++) if (fg[chest * w + x]) { if (left < 0) left = x; right = x; }
  const half = left < 0 ? 0.5 : Math.min(0.66, ((right - left) / 2) * s * 0.74);
  const arm = [];
  for (let k = -4; k <= 4; k++) {
    const ax = (k / 4) * half;
    const row = topRow(neckX + ax / s);
    if (row < 0) continue;
    const t = Math.abs(k) / 4; // 0 au col, 1 au bout du bras
    // Sous le bord du col, jamais par-dessus : le bois reste dans le maillot, seul le crochet en sort.
    arm.push(ax, -(row - neckTop) * s - 0.07 - 0.13 * Math.min(1, t * 1.6));
  }

  const Index = pos.length / 3 > 65535 ? Uint32Array : Uint16Array;
  return {
    arm,
    position: new Float32Array(pos),
    uv: new Float32Array(uv),
    index: Index.from(front.concat(back)),
    split: front.length,
  };
}

// La silhouette en blanc sur transparent, à la taille voulue, éventuellement
// rentrée de `inset` pixels ; `rim` donne l'inverse : tout sauf l'intérieur.
function silhouette(shape, tw, th, inset = 0, rim = false) {
  const small = makeCanvas(shape.w, shape.h);
  const data = new ImageData(shape.w, shape.h);
  for (let i = 0; i < shape.w * shape.h; i++) {
    data.data[i * 4] = data.data[i * 4 + 1] = data.data[i * 4 + 2] = 255;
    const inside = shape.fg[i] === 1 && shape.dist[i] > inset;
    data.data[i * 4 + 3] = inside !== rim ? 255 : 0;
  }
  small.getContext('2d').putImageData(data, 0, 0);
  const big = makeCanvas(tw, th);
  const ctx = big.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(small, 0, 0, tw, th);
  return big;
}

/*
 * La photo rognée sur le maillot, rendue opaque. On n'en garde que l'intérieur
 * (le bord de la photo porte encore un halo du fond) et on prolonge ses
 * couleurs tout autour : vue de biais, la tranche du maillot étire ces
 * quelques pixels de bord et les montrerait en liseré blanc. La découpe
 * elle-même vient du masque, qui garde la silhouette entière.
 */
function paint(cut, shape, tw, th, mirror) {
  const { img, k, box } = cut;
  const sx = box.x0 / k, sy = box.y0 / k;
  const sw = (box.x1 - box.x0 + 1) / k, sh = (box.y1 - box.y0 + 1) / k;
  const photo = makeCanvas(tw, th);
  const p = photo.getContext('2d');
  p.imageSmoothingQuality = 'high';
  p.drawImage(img, sx, sy, sw, sh, 0, 0, tw, th);
  p.globalCompositeOperation = 'destination-in';
  p.drawImage(silhouette(shape, tw, th, 3), 0, 0);

  const out = makeCanvas(tw, th);
  const o = out.getContext('2d');
  if (mirror) { o.translate(tw, 0); o.scale(-1, 1); }
  o.drawImage(photo, 0, 0);
  o.globalCompositeOperation = 'destination-over';
  for (let f = 2; f <= 64; f *= 2) {
    const tiny = makeCanvas(Math.max(1, Math.ceil(tw / f)), Math.max(1, Math.ceil(th / f)));
    tiny.getContext('2d').drawImage(photo, 0, 0, tiny.width, tiny.height);
    o.drawImage(tiny, 0, 0, tw, th);
  }
  o.setTransform(1, 0, 0, 1, 0, 0);
  o.fillStyle = cut.swatch;
  o.fillRect(0, 0, tw, th);
  return out;
}

async function prepare(front, back) {
  const [frontImg, backImg] = await Promise.all([
    loadBitmap(front),
    back ? loadBitmap(back).catch(() => null) : null,
  ]);
  const cut = cutout(frontImg);
  if (!cut) throw new Error('Maillot introuvable sur la photo : ' + front);
  const shape = measure(cut);
  const scale = Math.min(1024, Math.max(shape.w, shape.h) / cut.k) / Math.max(shape.w, shape.h);
  const tw = Math.round(shape.w * scale), th = Math.round(shape.h * scale);

  const mask = makeCanvas(tw, th);
  const m = mask.getContext('2d');
  m.fillStyle = '#000';
  m.fillRect(0, 0, tw, th);
  m.drawImage(silhouette(shape, tw, th), 0, 0);

  // Le dos est recadré sur sa propre silhouette puis posé sur celle de face,
  // retourné : vu de derrière, la gauche de la photo passe à droite. Sans
  // photo de dos, il prend la couleur du maillot.
  const frontCanvas = paint(cut, shape, tw, th, false);
  const backCut = backImg && cutout(backImg);
  let backCanvas;
  if (backCut) backCanvas = paint(backCut, measure(backCut), tw, th, true);
  else {
    backCanvas = makeCanvas(tw, th);
    const plain = backCanvas.getContext('2d');
    plain.fillStyle = shade(cut.swatch, 0.92);
    plain.fillRect(0, 0, tw, th);
  }
  // Tout contre le contour, le dos reprend les couleurs de l'avant : c'est la
  // tranche du maillot, visible des deux côtés quand il est de biais.
  const rim = makeCanvas(tw, th);
  const r = rim.getContext('2d');
  r.drawImage(frontCanvas, 0, 0);
  r.globalCompositeOperation = 'destination-in';
  r.drawImage(silhouette(shape, tw, th, 4, true), 0, 0);
  const b = backCanvas.getContext('2d');
  b.setTransform(1, 0, 0, 1, 0, 0);
  b.globalCompositeOperation = 'source-over';
  b.drawImage(rim, 0, 0);

  frontImg.close?.();
  backImg?.close?.();
  const bitmap = (c) => (c.transferToImageBitmap ? c.transferToImageBitmap() : createImageBitmap(c));
  return {
    mesh: buildMesh(shape),
    front: await bitmap(frontCanvas),
    back: await bitmap(backCanvas),
    mask: await bitmap(mask),
    hasBack: Boolean(backCut),
    swatch: cut.swatch,
  };
}

// Tout ce qu'il faut au worker, recopié tel quel dans son code source.
const PIPELINE = [
  makeCanvas, loadBitmap, shade, borderColor, keepLargest, erode, soften, chamfer, flood, grain,
  peel, dropShadow, cutout, measure, inflate, buildMesh, silhouette, paint, prepare,
];

/*
 * Le worker est fabriqué à partir de ces fonctions (un Blob, pas de fichier
 * en plus à installer). S'il ne peut pas démarrer, ou si le navigateur n'a
 * pas d'OffscreenCanvas, on détoure sur la page.
 */
let worker = null;
const jobs = new Map();
let jobId = 0;

function startWorker() {
  if (worker !== null) return worker;
  try {
    const source = `const SHIRT_H = ${SHIRT_H}, SHIRT_MAX_W = ${SHIRT_MAX_W}, THICK = ${THICK};\n${PIPELINE.join('\n')}
self.onmessage = async ({ data }) => {
  try {
    const out = await prepare(data.front, data.back);
    self.postMessage({ id: data.id, out }, [out.front, out.back, out.mask, out.mesh.position.buffer, out.mesh.uv.buffer, out.mesh.index.buffer]);
  } catch (error) {
    self.postMessage({ id: data.id, error: String((error && error.message) || error) });
  }
};`;
    worker = new Worker(URL.createObjectURL(new Blob([source], { type: 'text/javascript' })));
    worker.onmessage = ({ data }) => {
      const job = jobs.get(data.id);
      jobs.delete(data.id);
      if (data.error) job?.reject(new Error(data.error));
      else job?.resolve(data.out);
    };
    worker.onerror = (e) => {
      e.preventDefault();
      stopWorker(new Error('worker'));
    };
  } catch {
    worker = false;
  }
  return worker;
}

function stopWorker(error) {
  if (worker) worker.terminate();
  worker = false;
  for (const job of jobs.values()) job.reject(error);
  jobs.clear();
}

async function prepareJersey(front, back) {
  const abs = (url) => url && new URL(url, location.href).href;
  if (startWorker()) {
    try {
      return await new Promise((resolve, reject) => {
        const id = ++jobId;
        jobs.set(id, { resolve, reject });
        worker.postMessage({ id, front: abs(front), back: abs(back) });
      });
    } catch (error) {
      if (/introuvable/.test(error.message)) throw error;
      stopWorker(error); // le worker ne sait pas faire : la suite se fera ici
    }
  }
  return prepare(abs(front), abs(back));
}

export async function buildJersey(front, back, anisotropy = 4) {
  const out = await prepareJersey(front, back);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(out.mesh.position, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(out.mesh.uv, 2));
  geometry.setIndex(new THREE.BufferAttribute(out.mesh.index, 1));
  geometry.addGroup(0, out.mesh.split, 0);
  geometry.addGroup(out.mesh.split, out.mesh.index.length - out.mesh.split, 1);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  const texture = (bitmap, color) => {
    const t = new THREE.Texture(bitmap);
    t.flipY = false; // sans effet sur un ImageBitmap : les UV partent du haut
    t.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.anisotropy = anisotropy;
    t.needsUpdate = true;
    return t;
  };
  return {
    geometry,
    frontMap: texture(out.front, true),
    backMap: texture(out.back, true),
    alphaMap: texture(out.mask, false),
    hasBack: out.hasBack,
    swatch: out.swatch,
    arm: out.mesh.arm,
  };
}

/* ------------------------------------------------------------------------ */
/* La scène : barre, cintres, maillots                                      */
/* ------------------------------------------------------------------------ */

// Le tissu ondule doucement, plus fort vers le bas du maillot, et encaisse
// les à-coups quand le cintre glisse sur la barre.
function fabric(uniforms) {
  return (shader) => {
    shader.uniforms.fabricTime = uniforms.time;
    shader.uniforms.fabricImpulse = uniforms.impulse;
    shader.uniforms.fabricSwing = uniforms.swing;
    shader.uniforms.fabricTwist = uniforms.twist;
    shader.vertexShader = 'uniform float fabricTime; uniform float fabricImpulse; uniform float fabricSwing; uniform float fabricTwist;\n' + shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
float rise = 1.0 - uv.y; // 1 au col, 0 à l'ourlet
float fall = pow(1.0 - rise, 2.0);
transformed.z += (sin(fabricTime * 1.35 + rise * 5.0 + uv.x * 2.0) * 0.014 + sin(rise * 3.1) * fabricImpulse) * fall;
transformed.x += sin(fabricTime * 1.1 + rise * 4.0) * 0.008 * fall;
// Le bas suit le haut avec retard : il traîne quand le cintre glisse et se
// vrille quand il pivote, plus fort vers l'ourlet (le col, tenu par le cintre, ne bouge pas).
float lag = pow(1.0 - rise, 1.6);
float twist = fabricTwist * lag;
float tc = cos(twist), ts = sin(twist);
transformed.xz = vec2(transformed.x * tc - transformed.z * ts, transformed.x * ts + transformed.z * tc);
transformed.x += fabricSwing * lag;
transformed.y += abs(fabricSwing) * lag * 0.18; // en balançant, l'ourlet remonte un peu, comme un pendule`,
    );
  };
}

/*
 * Bois procédural, dessiné sur un canvas : aucun fichier à charger.
 * `lines` : veinage le long de x (bras de cintre, planches horizontales) ou de y (panneaux).
 */
function woodTexture({ base, dark, light, vertical = false, size = 512, veins = 140 }) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  g.fillStyle = base;
  g.fillRect(0, 0, size, size);
  for (let k = 0; k < veins; k++) {
    const at = Math.random() * size, amp = 2 + Math.random() * 7, freq = 0.004 + Math.random() * 0.012, ph = Math.random() * 6.3;
    g.strokeStyle = Math.random() < 0.7 ? dark : light;
    g.globalAlpha = 0.05 + Math.random() * 0.16;
    g.lineWidth = 0.6 + Math.random() * 2.2;
    g.beginPath();
    for (let t = 0; t <= size; t += 8) {
      const off = at + Math.sin(t * freq + ph) * amp + Math.sin(t * freq * 3.1 + ph) * amp * 0.3;
      if (vertical) (t ? g.lineTo(off, t) : g.moveTo(off, t)); else (t ? g.lineTo(t, off) : g.moveTo(t, off));
    }
    g.stroke();
  }
  g.globalAlpha = 1;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}

/* ------------------------------------------------------------------------ */
/* Le son de la penderie                                                    */
/*                                                                          */
/* Tout est synthétisé (Web Audio) : pas de fichier, pas de droits. Les     */
/* navigateurs n'autorisent le son qu'après un geste (clic, toucher,        */
/* touche) : avant, tout reste muet, et le survol seul n'en déclenche jamais. */
/* ------------------------------------------------------------------------ */
const SOUND_KEY = 'mfp-son';
class PenderieSound {
  constructor() {
    let saved = null;
    try { saved = localStorage.getItem(SOUND_KEY); } catch {}
    this.enabled = saved === 'on'; // coupé tant que le visiteur ne l'a pas activé
    this.ctx = null;
    this.lastTick = 0;
    document.addEventListener('visibilitychange', () => {
      if (!this.ctx) return;
      if (document.hidden) this.ctx.suspend(); else if (this.enabled) this.ctx.resume();
    });
  }
  get ready() { return this.enabled && this.ctx && this.ctx.state === 'running'; }
  // Appelé sur un geste du visiteur : c'est là seulement que le son peut démarrer.
  unlock() {
    if (!this.enabled) return;
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      try { this.ctx = new AC(); } catch { return; }
      this.build();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }
  setEnabled(on) {
    this.enabled = on;
    try { localStorage.setItem(SOUND_KEY, on ? 'on' : 'off'); } catch {}
    if (!on && this.ctx) this.ctx.suspend();
    if (on) this.unlock();
  }
  build() {
    const c = this.ctx;
    this.out = c.createGain();
    this.out.gain.value = 0.5;
    this.out.connect(c.destination);
    // Une petite pièce en bois : courte réverbération (bruit qui s'éteint).
    const len = Math.round(c.sampleRate * 0.4);
    const ir = c.createBuffer(2, len, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.4);
    }
    const verb = c.createConvolver();
    verb.buffer = ir;
    const wet = c.createGain();
    wet.gain.value = 0.16;
    this.out.connect(verb).connect(wet).connect(c.destination);
    // Le frottement des crochets sur la barre : un bruit filtré dont le volume suit la vitesse.
    const noise = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.noise = noise;
    const src = c.createBufferSource();
    src.buffer = noise;
    src.loop = true;
    const hp = c.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 900;
    this.band = c.createBiquadFilter();
    this.band.type = 'bandpass';
    this.band.frequency.value = 3200;
    this.band.Q.value = 2.4;
    this.scrape = c.createGain();
    this.scrape.gain.value = 0;
    src.connect(hp).connect(this.band).connect(this.scrape).connect(this.out);
    src.start();
  }
  // À chaque image : `speed` = somme des vitesses des cintres (unités de scène par seconde).
  frame(speed) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const level = Math.min(0.2, Math.max(0, speed - 0.3) * 0.03) * (0.7 + Math.random() * 0.6); // grain irrégulier
    this.scrape.gain.setTargetAtTime(level, t, 0.035);
    this.band.frequency.setTargetAtTime(2700 + Math.min(speed, 12) * 150, t, 0.08);
  }
  // Un crochet qui accroche la barre : trois partiels inharmoniques de métal, très courts.
  tick(strength = 0.5, delay = 0) {
    if (!this.ready) return;
    const c = this.ctx, t = c.currentTime + delay;
    if (!delay && t - this.lastTick < 0.03) return;
    if (!delay) this.lastTick = t;
    const f = 2200 + Math.random() * 1600;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.015 + 0.075 * strength, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    g.connect(this.out);
    for (const [r, a] of [[1, 1], [2.76, 0.45], [5.4, 0.2]]) {
      const o = c.createOscillator();
      o.frequency.value = Math.min(f * r, 18000);
      const og = c.createGain();
      og.gain.value = a;
      o.connect(og).connect(g);
      o.start(t);
      o.stop(t + 0.17);
    }
  }
  // Le bois du cintre qui cogne : un « toc » grave et bref.
  knock(strength = 0.6, delay = 0) {
    if (!this.ready) return;
    const c = this.ctx, t = c.currentTime + delay;
    const o = c.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(210, t);
    o.frequency.exponentialRampToValueAtTime(120, t + 0.08);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.16 * strength, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.11);
    o.connect(g).connect(this.out);
    o.start(t);
    o.stop(t + 0.12);
    const n = c.createBufferSource();
    n.buffer = this.noise;
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1800;
    const ng = c.createGain();
    ng.gain.setValueAtTime(0.09 * strength, t);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.035);
    n.connect(lp).connect(ng).connect(this.out);
    n.start(t, Math.random());
    n.stop(t + 0.04);
  }
  lift() { this.knock(0.55); this.tick(0.9, 0.03); this.tick(0.45, 0.085); } // on décroche le cintre
  drop() { this.tick(0.8); this.knock(0.45, 0.05); } // on le raccroche
}

export class Rail {
  constructor(host, count, callbacks, options = {}) {
    this.host = host;
    this.penderie = options.ambiance === 'penderie';
    this.galerie = options.ambiance === 'galerie';
    this.vestiaire = options.ambiance === 'vestiaire';
    this.photo = !!options.photo; // fond photoréaliste : boiseries plus sombres pour se fondre dans l'image
    this.dark = this.penderie || this.galerie || this.vestiaire; // pièce sombre : mêmes lumières, mêmes reflets
    this.sound = options.sound || null;
    this.total = count;
    // Les premiers produits pendent sur la barre ; les suivants (chaussures) vivent sur le banc.
    this.count = Number.isInteger(options.jerseys) ? options.jerseys : count;
    this.callbacks = callbacks;
    this.items = [];
    this.meshes = [];
    this.moving = true;
    this.selected = -1;
    this.focus = Math.floor((this.count - 1) / 2);
    // L'ordre sur la barre, de gauche à droite (indices des produits). Le client peut le changer.
    this.order = Array.isArray(options.order) && options.order.length === this.count ? options.order.slice() : [...Array(this.count).keys()];
    // L'ordre sur le banc, même principe.
    this.benchOrder = [];
    for (let i = this.count; i < this.total; i++) this.benchOrder.push(i);
    const saved = options.benchOrder;
    if (Array.isArray(saved) && saved.length === this.benchOrder.length && saved.every((v) => v >= this.count && v < this.total)) this.benchOrder = saved.slice();
    this.benchSpan = this.benchOrder.length ? (this.benchOrder.length - 1) * BENCH_SPACING + 1.2 : 0;
    this.carry = null; // le maillot qu'on tient en main pendant un déplacement
    this.hover = -1;
    this.offset = 0;
    this.time = 0;
    this.turn = 0;
    this.visible = true;
    this.fits = true;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    const canvas = this.renderer.domElement;
    canvas.className = 'mfp__canvas';
    canvas.tabIndex = 0;
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', 'Portant de maillots. Flèches : parcourir ; Entrée : voir de près ; Maj + flèches : changer un maillot de place');
    host.append(canvas);
    this.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());

    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-6, 6, 2.4, -2.4, 0.1, 80);
    // En galerie, le fond noir ne renvoie rien : les maillots ont besoin de plus de lumière pour rester
    // fidèles (un maillot blanc doit rester blanc, pas gris).
    this.ambient = new THREE.AmbientLight(this.dark ? 0xfff6ee : 0xffffff, this.galerie || this.vestiaire ? 1.45 : this.dark ? 0.85 : 1.7);
    this.scene.add(this.ambient);
    const key = new THREE.DirectionalLight(0xfffcf5, this.dark ? 0.7 : 2.1);
    if (this.dark) key.position.set(0, 7, 5); // d'en haut : les ombres tombent sur le fond de la penderie
    else key.position.set(-3, 7, 6);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    Object.assign(key.shadow.camera, { left: -9, right: 9, top: 7, bottom: -7 });
    key.shadow.normalBias = 0.03;
    key.shadow.radius = 5;
    key.shadow.bias = -3e-4;
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0xdde5ef, 0.8);
    fill.position.set(5, 1, -2);
    this.scene.add(fill);
    if (this.dark) {
      fill.intensity = 0.3;
      // Un peu de lumière neutre de face : les couleurs des maillots restent fidèles.
      const front = new THREE.DirectionalLight(0xf6f4f1, this.galerie || this.vestiaire ? 1.15 : 0.8);
      this.frontLight = front;
      front.position.set(0, 0.6, 8);
      this.scene.add(front);
    }

    const floor = new THREE.Mesh(new THREE.PlaneGeometry(60, 25), new THREE.ShadowMaterial({ opacity: 0.065 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -2;
    floor.receiveShadow = true;
    floor.visible = !this.dark; // dans la penderie, c'est le socle en bois qui reçoit les ombres
    this.scene.add(floor);

    // Un chrome n'a de couleur que ce qu'il reflète : on lui donne une pièce
    // (plafond clair, néons, sol sombre) à refléter, sinon il paraît gris mat.
    const room = document.createElement('canvas');
    room.width = 256; room.height = 128;
    const g = room.getContext('2d');
    const grad = g.createLinearGradient(0, 0, 0, 128);
    grad.addColorStop(0, '#ffffff'); grad.addColorStop(0.42, '#e4e6e8'); grad.addColorStop(0.5, '#8d9196');
    grad.addColorStop(0.62, '#3b3e42'); grad.addColorStop(1, '#1d1f22');
    g.fillStyle = grad; g.fillRect(0, 0, 256, 128);
    g.fillStyle = '#ffffff';
    for (const x of [30, 110, 190]) g.fillRect(x, 18, 46, 6); // néons du vestiaire
    if (this.dark) {
      // Intérieur de penderie : bois sombre, et la réglette LED comme seule lumière vive.
      const inside = g.createLinearGradient(0, 0, 0, 128);
      inside.addColorStop(0, '#2b2019'); inside.addColorStop(0.45, '#3d2c20'); inside.addColorStop(0.55, '#20170f'); inside.addColorStop(1, '#0c0907');
      g.fillStyle = inside; g.fillRect(0, 0, 256, 128);
      g.fillStyle = '#fff0dc'; g.fillRect(0, 34, 256, 5);
      g.fillStyle = 'rgba(255,225,190,0.35)'; g.fillRect(0, 30, 256, 14);
    }
    const roomTex = new THREE.CanvasTexture(room);
    roomTex.mapping = THREE.EquirectangularReflectionMapping;
    roomTex.colorSpace = THREE.SRGBColorSpace;
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromEquirectangular(roomTex).texture; // seuls les métaux et le bois en tiennent compte
    roomTex.dispose(); pmrem.dispose();

    // Sous les LED, un chrome poli renverrait un trait blanc : dans la penderie, il est satiné et plus sombre.
    const chrome = this.galerie
      ? new THREE.MeshStandardMaterial({ color: 0x55585d, metalness: 1, roughness: 0.32 }) // métal noir satiné
      : this.dark
      ? new THREE.MeshStandardMaterial({ color: 0x9ba1a8, metalness: 1, roughness: 0.3 })
      : new THREE.MeshStandardMaterial({ color: 0xe9ebed, metalness: 1, roughness: 0.14 });
    this.bar = new THREE.Mesh(new THREE.CylinderGeometry(this.galerie ? 0.03 : 0.042, this.galerie ? 0.03 : 0.042, 1, 40), chrome);
    this.bar.rotation.z = Math.PI / 2;
    this.bar.position.y = RAIL_Y;
    this.bar.castShadow = true;
    // Vestiaire : une tringle en chêne clair à la place du métal.
    if (this.vestiaire) this.bar.material = new THREE.MeshStandardMaterial({ map: woodTexture(this.photo ? { base: '#4a3420', dark: '#2a1c10', light: '#6b4e2d', vertical: false, veins: 120 } : { base: '#9a7a52', dark: '#6b4e2d', light: '#c4a478', vertical: false, veins: 120 }), roughness: 0.7, metalness: 0 });
    this.scene.add(this.bar);
    // Fixations murales, comme dans un vestiaire : une platine vissée au mur et
    // un bras qui vient tenir la barre.
    const plateGeo = new THREE.CylinderGeometry(0.1, 0.1, 0.035, 32);
    const armGeo = new THREE.CylinderGeometry(0.05, 0.05, 0.42, 24);
    const screwGeo = new THREE.CylinderGeometry(0.018, 0.018, 0.012, 12);
    const screwMat = new THREE.MeshStandardMaterial({ color: 0x9da1a6, metalness: 1, roughness: 0.3 });
    const brushed = new THREE.MeshStandardMaterial({ color: 0xf1f2f3, metalness: 0.85, roughness: 0.38 });
    this.ends = [-1, 1].map(() => {
      const end = new THREE.Group();
      end.position.y = RAIL_Y;
      const plate = new THREE.Mesh(plateGeo, brushed);
      plate.rotation.x = Math.PI / 2;
      plate.position.z = -0.42;
      const arm = new THREE.Mesh(armGeo, chrome);
      arm.rotation.x = Math.PI / 2;
      arm.position.z = -0.21;
      for (const x of [-0.055, 0.055]) {
        const screw = new THREE.Mesh(screwGeo, screwMat);
        screw.position.set(x, 0.02, -0.035); // sur la face avant de la rosace (repère tourné)
        plate.add(screw);
      }
      plate.castShadow = arm.castShadow = true;
      if (this.galerie || this.vestiaire) {
        // Galerie et vestiaire : la barre est suspendue au plafond par une tige fine, et finie par un embout.
        const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 4, 12), chrome);
        rod.position.set(0, 2, 0);
        const cap = new THREE.Mesh(new THREE.SphereGeometry(0.036, 20, 14), chrome);
        end.add(rod, cap);
      } else if (this.penderie) {
        // Dans la penderie, la barre est tenue par les côtés : une douille chromée à chaque bout.
        const socket = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.05, 28), chrome);
        socket.rotation.z = Math.PI / 2;
        end.add(socket);
      } else end.add(plate, arm);
      this.scene.add(end);
      return end;
    });

    if (this.penderie) this.buildPenderie();
    if (this.vestiaire) this.buildBench();
    if (this.galerie || this.vestiaire) {
      // Une lumière douce qui tombe d'en haut, hors champ : le haut des maillots est plus lumineux.
      this.leds = [0, 1, 2, 3].map(() => {
        const l = new THREE.PointLight(0xfff1e2, 1.35, 0, 0.7);
        l.position.set(0, RAIL_Y + 1.1, 1.0);
        this.scene.add(l);
        return l;
      });
    }

    // Le crochet du cintre, qui passe par-dessus la barre et descend jusqu'au col.
    const hook = [[-0.06, 0.025], [-0.08, 0.115], [0.015, 0.16], [0.105, 0.11], [0.075, 0.025], [0, -0.045], [0, COLLAR_Y - 0.06]];
    this.hookGeometry = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(hook.map(([x, y]) => new THREE.Vector3(x, y, 0))), 40, 0.013, 10, false);
    // Cintre de costume : crochet noir, bois d'acajou verni et veiné (le vernis
    // accroche la lumière grâce à l'environnement ; le veinage suit le bras).
    this.hookMaterial = new THREE.MeshStandardMaterial({ color: this.galerie ? 0x6a6d72 : 0x1c1c1e, metalness: 0.95, roughness: 0.28 });
    this.hangerMaterial = new THREE.MeshStandardMaterial({
      map: woodTexture({ base: '#7a3a22', dark: '#4a1f10', light: '#9a5436', veins: 90 }),
      roughness: 0.34,
      metalness: 0,
    });
    // La pièce du col, là où le crochet entre dans le bois : c'est elle qu'on voit dépasser.
    this.bossGeometry = new THREE.CapsuleGeometry(0.037, 0.12, 6, 14);


    // Quand un maillot est choisi, le reste du portant passe flou derrière lui :
    // on le rend dans une petite texture, qu'on étale à l'écran en la floutant.
    this.blur = 0;
    this.backdrop = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
    this.veil = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
      uniforms: { map: { value: this.backdrop.texture }, texel: { value: new THREE.Vector2() }, amount: { value: 0 } },
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: `uniform sampler2D map; uniform vec2 texel; uniform float amount; varying vec2 vUv;
void main() {
  vec4 sum = vec4(0.0); float total = 0.0;
  for (int x = -3; x <= 3; x++) for (int y = -3; y <= 3; y++) {
    float w = exp(-float(x * x + y * y) / 8.0);
    sum += texture2D(map, vUv + vec2(float(x), float(y)) * texel * 2.2 * amount) * w; total += w;
  }
  sum /= total;
  gl_FragColor = vec4(sum.rgb / max(sum.a, 1e-4), sum.a * (1.0 - 0.8 * amount));
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      toneMapped: true,
    }));
    this.veil.frustumCulled = false;
    this.veilScene = new THREE.Scene();
    this.veilScene.add(this.veil);
    this.veilCamera = new THREE.Camera();

    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.drag = null;
    this.listen(canvas);

    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(host);
    this.seen = new IntersectionObserver(([entry]) => { this.visible = entry.isIntersecting; });
    this.seen.observe(host);
    this.resize();
    this.last = performance.now();
    this.loop = this.loop.bind(this);
    this.frame = requestAnimationFrame(this.loop);
  }

  // Position x (unités de scène) sous le pointeur : caméra orthographique centrée en x = 0.
  worldX(clientX) {
    const r = this.renderer.domElement.getBoundingClientRect();
    return this.camera.left + ((clientX - r.left) / r.width) * (this.camera.right - this.camera.left);
  }

  slotOf(index) {
    return index >= this.count ? this.benchOrder.indexOf(index) : this.order.indexOf(index);
  }

  // Le décalage du banc : il suit le défilement de la barre, pour que tout le vestiaire bouge ensemble.
  benchShift() {
    const c0 = (this.count - 1) / 2;
    const c = this.carry && !this.carry.bench ? this.carry.center : this.mobile || !this.fits ? this.slotOf(this.focus) : c0;
    return (c0 - c) * SPACING;
  }

  /*
   * Gestes :
   * - souris : clic sur un maillot = le voir de près ; on le fait glisser = on le déplace ;
   *   glisser à côté des maillots = faire défiler le portant ;
   * - doigt : toucher = voir de près ; appui long (0,3 s) = décrocher le maillot et le déplacer ;
   *   glissement rapide = faire défiler (ainsi les deux gestes ne se confondent jamais) ;
   * - maillot choisi : glisser = le tourner.
   */
  listen(canvas) {
    const LONG_PRESS = 300;
    canvas.addEventListener('pointerdown', (e) => {
      if (e.button > 0) return;
      const target = this.pick(e);
      this.drag = { x: e.clientX, y: e.clientY, moved: false, target, turn: this.turn, mode: null, touch: e.pointerType !== 'mouse', t0: e.timeStamp, carried: false };
      try { canvas.setPointerCapture(e.pointerId); } catch {} // rare : pointeur déjà relâché
      if (this.drag.touch && target >= 0 && this.selected < 0) {
        const drag = this.drag;
        drag.timer = setTimeout(() => {
          if (this.drag !== drag || drag.mode) return;
          drag.mode = 'carry';
          drag.moved = true;
          this.pickUp(target, e.clientX);
          navigator.vibrate?.(12);
        }, LONG_PRESS);
      }
    });
    canvas.addEventListener('pointermove', (e) => {
      const drag = this.drag;
      if (drag) {
        const dx = e.clientX - drag.x;
        if (drag.mode === 'carry') { if (Math.abs(dx) > 7) drag.carried = true; this.moveCarry(e.clientX); return; }
        if (Math.abs(dx) <= 7 && Math.abs(e.clientY - drag.y) <= 7) return;
        clearTimeout(drag.timer);
        drag.moved = true;
        if (!drag.mode) {
          if (this.selected >= 0) drag.mode = 'turn';
          else if (!drag.touch && drag.target >= 0) { drag.mode = 'carry'; this.pickUp(drag.target, drag.x); this.moveCarry(e.clientX); return; }
          else drag.mode = 'scroll';
        }
        if (drag.mode === 'turn') {
          this.turn = drag.turn + (dx / this.host.clientWidth) * Math.PI * 2;
          this.callbacks.onTurn?.(this.turn);
        } else {
          this.offset = (dx / this.host.clientWidth) * 7;
          this.setHover(-1);
        }
      } else if (this.selected < 0 && e.pointerType === 'mouse') {
        const hit = this.pick(e);
        this.setHover(hit);
        canvas.style.cursor = hit >= 0 ? 'grab' : 'default';
      }
    });
    const end = (cancel, e) => {
      const drag = this.drag;
      if (!drag) return;
      clearTimeout(drag.timer);
      this.drag = null;
      // Un toucher bref resté sur place reste un toucher, même si la page, occupée, a laissé
      // passer le délai de l'appui long avant de traiter le relâché : on se fie à l'horodatage réel.
      const quickTap = drag.touch && !drag.carried && e && e.timeStamp - drag.t0 < LONG_PRESS;
      if (drag.mode === 'carry') {
        this.putDown();
        if (quickTap && !cancel && drag.target >= 0) this.callbacks.onSelect(drag.target);
      }
      else if (!cancel && !drag.moved && drag.target >= 0) this.callbacks.onSelect(drag.target);
      else if (!cancel && drag.mode === 'scroll' && this.selected < 0) {
        this.callbacks.onBrowse(Math.round(-this.offset / SPACING) || Math.sign(-this.offset));
      }
      this.offset = 0;
    };
    canvas.addEventListener('pointerup', (e) => end(false, e));
    canvas.addEventListener('pointercancel', (e) => end(true, e));
    canvas.addEventListener('pointerleave', () => { if (!this.drag && this.selected < 0) this.setHover(-1); });
  }

  // Décrocher : le maillot suit la main, en gardant le point où on l'a saisi.
  pickUp(index, clientX) {
    const item = this.items[index];
    if (!item) return;
    // Le portant est figé pendant qu'on tient un maillot : il ne défile que si la main approche d'un bord.
    const center = this.mobile || !this.fits ? this.slotOf(this.focus) : (this.count - 1) / 2;
    this.carry = { index, bench: !!item.bench, grab: this.worldX(clientX) - item.pivot.position.x, x: item.pivot.position.x, edgeAt: 0, center };
    this.setHover(-1);
    this.renderer.domElement.style.cursor = 'grabbing';
    this.host.classList.add('is-carrying');
    this.callbacks.onCarry?.(index, true);
  }

  moveCarry(clientX) {
    const c = this.carry;
    if (!c) return;
    if (c.bench) {
      // Une chaussure glisse le long du banc ; ses voisines se réordonnent.
      const bHalf = ((this.benchSlab ? this.benchSlab.scale.x : 6) / 2) - 0.45;
      c.x = THREE.MathUtils.clamp(this.worldX(clientX) - c.grab, -bHalf, bHalf);
      const n = this.benchOrder.length;
      const slot = THREE.MathUtils.clamp(Math.round((c.x - this.benchShift()) / BENCH_SPACING + (n - 1) / 2), 0, n - 1);
      const from = this.benchOrder.indexOf(c.index);
      if (slot !== from) {
        this.benchOrder.splice(from, 1);
        this.benchOrder.splice(slot, 0, c.index);
        this.sound?.tick(0.6);
      }
      return;
    }
    const half = (this.bar.scale.y || 6) / 2 - 0.3;
    c.x = THREE.MathUtils.clamp(this.worldX(clientX) - c.grab, -half, half);
    // Portant plus large que l'écran (mobile) : près d'un bord, il défile sous la main.
    const r = this.renderer.domElement.getBoundingClientRect();
    const edge = (clientX - r.left) / r.width;
    const now = performance.now();
    if ((this.mobile || !this.fits) && (edge < 0.12 || edge > 0.88) && now - c.edgeAt > 380) {
      c.edgeAt = now;
      c.center = THREE.MathUtils.clamp(c.center + (edge < 0.12 ? -1 : 1), 0, this.count - 1);
    }
    // La place visée : la plus proche de la main ; les autres maillots s'écartent.
    const slot = THREE.MathUtils.clamp(Math.round(c.x / SPACING + c.center), 0, this.count - 1);
    const from = this.slotOf(c.index);
    if (slot !== from) {
      this.order.splice(from, 1);
      this.order.splice(slot, 0, c.index);
      this.sound?.tick(0.6);
    }
  }

  // Raccrocher : le maillot rejoint sa nouvelle place sur la barre.
  putDown() {
    const c = this.carry;
    if (!c) return;
    this.carry = null;
    // La vue reste où elle était : le maillot central est celui qui occupe maintenant la place du centre.
    if (!c.bench && (this.mobile || !this.fits)) this.focus = this.order[Math.round(c.center)];
    this.renderer.domElement.style.cursor = 'grab';
    this.host.classList.remove('is-carrying');
    this.callbacks.onCarry?.(c.index, false);
    this.callbacks.onReorder?.(c.bench ? this.benchOrder.slice() : this.order.slice(), c.index);
  }

  // Clavier : décaler un maillot d'une place (Maj + flèche).
  nudge(index, delta) {
    if (index >= this.count) return false;
    const from = this.slotOf(index), to = from + delta;
    if (from < 0 || to < 0 || to >= this.count) return false;
    this.order.splice(from, 1);
    this.order.splice(to, 0, index);
    this.callbacks.onReorder?.(this.order.slice(), index);
    return true;
  }

  add(index, jersey) {
    const uniforms = { time: { value: 0 }, impulse: { value: 0 }, swing: { value: 0 }, twist: { value: 0 } };
    // Un tissu mat, sans reflet ; le matériau le plus léger, ce qui compte sur mobile.
    // alphaToCoverage : le bord du masque est anticrénelé (MSAA) au lieu d'être coupé net en escalier.
    const front = new THREE.MeshLambertMaterial({ map: jersey.frontMap, alphaMap: jersey.alphaMap, alphaTest: 0.5, alphaToCoverage: true });
    const back = new THREE.MeshLambertMaterial({ map: jersey.backMap, alphaMap: jersey.alphaMap, alphaTest: 0.5, alphaToCoverage: true });
    if (this.dark) {
      // Dans la pénombre, un léger éclairage propre au tissu (et à lui seul) garde des blancs
      // blancs et des couleurs fidèles, sans éclaircir le bois de la penderie.
      for (const [m, map] of [[front, jersey.frontMap], [back, jersey.backMap]]) {
        m.emissive = new THREE.Color(0x3a3a3a);
        m.emissiveMap = map;
      }
    }
    front.onBeforeCompile = back.onBeforeCompile = fabric(uniforms);

    const mesh = new THREE.Mesh(jersey.geometry, [front, back]);
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.userData.index = index;
    this.meshes.push(mesh);

    const shirt = new THREE.Group();
    shirt.position.y = COLLAR_Y;
    shirt.add(mesh);
    const pivot = new THREE.Group();
    pivot.position.set(this.targetX(index), RAIL_Y, 0);
    pivot.rotation.y = ANGLE;
    const pts = [];
    for (let k = 0; k + 1 < (jersey.arm || []).length; k += 2) pts.push(new THREE.Vector3(jersey.arm[k], jersey.arm[k + 1], 0));
    if (pts.length >= 3) {
      const armMesh = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 36, 0.03, 10, false), this.hangerMaterial);
      armMesh.scale.z = 0.75; // un bras de cintre est plat, pas rond
      armMesh.castShadow = true;
      shirt.add(armMesh);
      const center = pts.reduce((a, b) => (Math.abs(b.x) < Math.abs(a.x) ? b : a));
      const boss = new THREE.Mesh(this.bossGeometry, this.hangerMaterial);
      boss.rotation.z = Math.PI / 2;
      boss.scale.z = 0.75;
      boss.position.set(0, center.y + 0.012, 0);
      boss.castShadow = true;
      shirt.add(boss);
    }
    pivot.add(shirt, new THREE.Mesh(this.hookGeometry, this.hookMaterial));
    this.scene.add(pivot);
    this.items[index] = { pivot, shirt, uniforms, vx: 0, va: 0, sway: 0, vs: 0, lag: 0, vl: 0, tw: 0, vt: 0, odo: 0 };
  }

  // Une chaussure : posée sur le banc, sans cintre, mise à l'échelle de l'assise.
  addShoe(index, jersey) {
    const front = new THREE.MeshLambertMaterial({ map: jersey.frontMap, alphaMap: jersey.alphaMap, alphaTest: 0.5, alphaToCoverage: true });
    const back = new THREE.MeshLambertMaterial({ map: jersey.backMap, alphaMap: jersey.alphaMap, alphaTest: 0.5, alphaToCoverage: true });
    if (this.dark) {
      for (const [m, map] of [[front, jersey.frontMap], [back, jersey.backMap]]) {
        m.emissive = new THREE.Color(0x3a3a3a);
        m.emissiveMap = map;
      }
    }
    const mesh = new THREE.Mesh(jersey.geometry, [front, back]);
    mesh.castShadow = true;
    mesh.userData.index = index;
    this.meshes.push(mesh);
    mesh.geometry.computeBoundingBox();
    const bb = mesh.geometry.boundingBox;
    const scale = Math.min(1.15 / (bb.max.x - bb.min.x), 0.72 / (bb.max.y - bb.min.y));
    const shirt = new THREE.Group(); // même nom que pour un maillot : le reste du code n'y voit que du feu
    shirt.add(mesh);
    mesh.position.set(-(bb.min.x + bb.max.x) / 2, -bb.min.y, 0); // centrée, la semelle à l'origine
    shirt.scale.setScalar(scale);
    const pivot = new THREE.Group();
    pivot.add(shirt);
    const baseY = (this.benchTop ?? -1.56) + 0.005;
    pivot.position.set(this.targetX(index), baseY, 1.07);
    pivot.rotation.y = 0.12;
    this.scene.add(pivot);
    this.items[index] = { pivot, shirt, bench: true, baseY, vx: 0, vy: 0, va: 0 };
  }

  /*
   * La vie d'une chaussure sur le banc : posée, elle se soulève avec un petit
   * rebond au survol, suit la main quand on la déplace (les voisines
   * s'écartent), et vient au premier plan quand elle est choisie.
   */
  stepShoe(item, i, dt, ease, chosen) {
    const active = chosen ? i === this.selected : i === this.hover;
    const carried = this.carry && this.carry.bench && this.carry.index === i;
    let x = this.targetX(i) + (this.selected < 0 ? this.offset : 0);
    let y = item.baseY, z = 1.07, yaw = 0.12, scale = 1;
    if (chosen) {
      if (active) {
        y = -0.35; z = 1.5; yaw = this.turn; scale = 2.1;
        const roomX = Math.max(0, this.camera.right - 1.5);
        x = THREE.MathUtils.clamp(0, -roomX, roomX);
      } else z = 0.95; // les autres restent sur le banc, dans le fond flou
    } else if (carried) {
      y = item.baseY + 0.18; z = 1.25; yaw = 0.32; scale = 1.06;
    } else if (this.hover === i) {
      y = item.baseY + 0.12; z = 1.2; yaw = 0.4; scale = 1.14;
    } else if (this.hover >= 0 && this.items[this.hover]?.bench) {
      x += this.slotOf(i) < this.slotOf(this.hover) ? -0.3 : 0.3;
    }
    if (carried && dt > 0) {
      item.vx += (THREE.MathUtils.clamp((this.carry.x - item.pivot.position.x) / dt, -14, 14) - item.vx) * 0.5;
      item.pivot.position.x = this.carry.x;
    }
    for (let left = dt; left > 1e-6; left -= STEP) {
      const step = Math.min(left, STEP);
      if (!carried) {
        item.vx += ((x - item.pivot.position.x) * 56 - item.vx * 11) * step;
        item.pivot.position.x += item.vx * step;
      }
      // raideur forte, amortissement doux : le petit rebond quand elle se pose ou se soulève
      item.vy += ((y - item.pivot.position.y) * 70 - item.vy * 9) * step;
      item.pivot.position.y += item.vy * step;
      item.va += ((yaw - item.pivot.rotation.y) * 58 - item.va * 12) * step;
      item.pivot.rotation.y += item.va * step;
    }
    // elle penche dans le sens de sa course, comme ramassée à la main
    item.pivot.rotation.z = THREE.MathUtils.clamp(-item.vx * 0.03, -0.12, 0.12);
    item.pivot.position.z = THREE.MathUtils.lerp(item.pivot.position.z, z, ease);
    item.pivot.scale.setScalar(THREE.MathUtils.lerp(item.pivot.scale.x, scale, ease));
  }

  targetX(index) {
    if (index >= this.count) {
      const n = Math.max(1, this.benchOrder.length);
      return (this.slotOf(index) - (n - 1) / 2) * BENCH_SPACING + this.benchShift();
    }
    const center = this.carry && !this.carry.bench ? this.carry.center : this.mobile || !this.fits ? this.slotOf(this.focus) : (this.count - 1) / 2;
    return (this.slotOf(index) - center) * SPACING;
  }

  pick(e) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, (-(e.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    for (const hit of this.raycaster.intersectObjects(this.meshes)) {
      if (this.selected < 0 || hit.object.userData.index === this.selected) return hit.object.userData.index;
    }
    return -1;
  }

  // De face, pour chaque nouveau maillot choisi.
  resetTurn() {
    this.turn = 0;
    this.callbacks.onTurn?.(0);
  }

  // Face (0) ou dos (π), par le chemin le plus court depuis l'angle actuel.
  turnTo(side) {
    const target = side === 'dos' ? Math.PI : 0;
    this.turn = target + Math.round((this.turn - target) / (Math.PI * 2)) * Math.PI * 2;
    this.callbacks.onTurn?.(this.turn);
  }

  /*
   * Vestiaire épuré : pas de meuble, juste un banc en chêne clair qui flotte
   * devant les maillots, sur deux pieds fins en métal noir, assorti à la
   * tringle. Les chaussures s'y posent.
   */
  buildBench() {
    const oak = new THREE.MeshStandardMaterial({
      map: woodTexture(this.photo ? { base: '#4a3420', dark: '#2a1c10', light: '#6b4e2d', vertical: false, veins: 110 } : { base: '#9a7a52', dark: '#6b4e2d', light: '#c4a478', vertical: false, veins: 110 }),
      roughness: 0.55,
      metalness: 0,
    });
    const BT = -1.56; // hauteur d'assise
    this.benchTop = BT;
    const bench = new THREE.Group();
    this.benchSlab = new THREE.Mesh(new THREE.BoxGeometry(1, 0.07, 0.52), oak);
    this.benchSlab.position.y = BT - 0.035;
    this.benchSlab.castShadow = this.benchSlab.receiveShadow = true;
    bench.add(this.benchSlab);
    const steel = new THREE.MeshStandardMaterial({ color: 0x232426, metalness: 0.85, roughness: 0.4 });
    this.benchLegs = [-1, 1].map(() => {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, BT - 0.07 + 2.0, 14), steel);
      leg.position.y = (BT - 0.07 - 2.0) / 2;
      leg.castShadow = true;
      bench.add(leg);
      return leg;
    });
    bench.position.z = 1.05;
    this.scene.add(bench);
  }

  /*
   * La penderie : un caisson en noyer (fond, étagère, côtés, socle), une
   * réglette LED sous l'étagère et une rangée de petites sources chaudes qui
   * éclairent les maillots par le haut. Tout est à l'échelle 1 et étiré par
   * resize() selon la longueur de la barre.
   */
  buildPenderie() {
    const walnut = (vertical) => new THREE.MeshStandardMaterial({
      map: woodTexture({ base: '#3a2517', dark: '#1d110a', light: '#5b3a24', vertical, veins: 170 }),
      roughness: 0.62,
      metalness: 0,
    });
    const panel = walnut(true), board = walnut(false);
    const TOP = RAIL_Y + 0.62, BASE = -2.0, DEPTH = 1.1;
    this.cab = { TOP, BASE, parts: {} };
    const P = this.cab.parts;
    P.back = new THREE.Mesh(new THREE.PlaneGeometry(1, TOP - BASE), panel);
    P.back.position.set(0, (TOP + BASE) / 2, -0.5);
    P.back.receiveShadow = true;
    P.shelf = new THREE.Mesh(new THREE.BoxGeometry(1, 0.1, DEPTH), board);
    P.shelf.position.set(0, TOP + 0.05, 0.05);
    P.base = new THREE.Mesh(new THREE.BoxGeometry(1, 0.12, DEPTH), board);
    P.base.position.set(0, BASE - 0.06, 0.05);
    P.base.receiveShadow = true;
    P.sides = [-1, 1].map(() => {
      const side = new THREE.Mesh(new THREE.BoxGeometry(0.1, TOP - BASE + 0.22, DEPTH), panel);
      side.position.set(0, (TOP + BASE) / 2, 0.05);
      side.receiveShadow = true;
      return side;
    });
    // La réglette : une ligne de lumière franche sous l'étagère (non soumise au tone mapping)...
    P.led = new THREE.Mesh(new THREE.BoxGeometry(1, 0.016, 0.03), new THREE.MeshBasicMaterial({ color: 0xfff1dc, toneMapped: false }));
    P.led.position.set(0, TOP - 0.012, 0.42);
    // ... et son halo sur le haut du fond, en fondu vers le bas.
    const glowCanvas = document.createElement('canvas');
    glowCanvas.width = 8; glowCanvas.height = 256;
    const gg = glowCanvas.getContext('2d');
    const grad = gg.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, 'rgba(255,228,190,0.55)');
    grad.addColorStop(0.25, 'rgba(255,220,180,0.18)');
    grad.addColorStop(1, 'rgba(255,220,180,0)');
    gg.fillStyle = grad;
    gg.fillRect(0, 0, 8, 256);
    const glowTex = new THREE.CanvasTexture(glowCanvas);
    glowTex.colorSpace = THREE.SRGBColorSpace;
    P.glow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1.6), new THREE.MeshBasicMaterial({ map: glowTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
    P.glow.position.set(0, TOP - 0.8, -0.49);
    this.scene.add(P.back, P.shelf, P.base, ...P.sides, P.led, P.glow);
    // Les LED : quelques sources chaudes le long de la réglette. Peu d'atténuation
    // (decay < 1) : le haut des maillots et du fond est plus lumineux que le bas.
    this.leds = [0, 1, 2, 3].map(() => {
      const l = new THREE.PointLight(0xffe9cf, 1.5, 0, 0.7);
      l.position.set(0, TOP - 0.1, 0.5);
      this.scene.add(l);
      return l;
    });
  }

  layoutPenderie(length) {
    if (this.benchSlab) {
      this.benchSlab.scale.x = length - 0.7;
      this.benchLegs[0].position.x = -(length - 0.7) * 0.38;
      this.benchLegs[1].position.x = (length - 0.7) * 0.38;
    }
    if (this.galerie || this.vestiaire) {
      this.leds.forEach((l, k) => { l.position.x = (k / (this.leds.length - 1) - 0.5) * (length - 1.2); });
      for (const end of this.ends) end.position.x = Math.sign(end.position.x) * (length / 2 - 0.25); // tiges un peu rentrées
      return;
    }
    if (!this.cab) return;
    const P = this.cab.parts, W = length;
    P.back.scale.x = W;
    P.back.material.map.repeat.set(W / 2.2, 1);
    P.shelf.scale.x = P.base.scale.x = W + 0.2;
    P.led.scale.x = W - 0.2;
    P.glow.scale.x = W;
    P.sides[0].position.x = -W / 2 - 0.05;
    P.sides[1].position.x = W / 2 + 0.05;
    this.leds.forEach((l, k) => { l.position.x = (k / (this.leds.length - 1) - 0.5) * (W - 1.2); });
  }

  // « Éclairage » : la pièce s'éclaire un peu plus, en douceur (brief : 300-500 ms).
  setLight(on) {
    this.lightOn = !!on;
  }

  setHover(index) {
    if (this.hover === index) return;
    this.hover = index;
    this.callbacks.onHover(index);
  }

  setState({ selected, focused, hovered, moving }) {
    if (selected !== undefined) this.selected = selected;
    if (focused !== undefined) this.focus = focused;
    if (hovered !== undefined) this.hover = hovered;
    if (moving !== undefined) this.moving = moving;
    this.resize();
  }

  resize() {
    const width = this.host.clientWidth, height = this.host.clientHeight;
    if (!width || !height) return;
    this.mobile = width < 720;
    const h = height;
    if (this.canvasSize !== width + 'x' + h) {
      this.canvasSize = width + 'x' + h;
      this.renderer.setSize(width, h, false);
      this.renderer.domElement.style.height = h + 'px';
      const ratio = this.renderer.getPixelRatio();
      this.backdrop.setSize(Math.ceil((width * ratio) / 3), Math.ceil((h * ratio) / 3));
      this.veil.material.uniforms.texel.value.set(3 / (width * ratio), 3 / (h * ratio));
    }
    const half = this.mobile ? 2.5 : 2.35;
    Object.assign(this.camera, { left: (-half * width) / h, right: (half * width) / h, top: half, bottom: -half });
    this.camera.position.set(0, 0.2, 12);
    this.camera.lookAt(0, -0.1, 0);
    this.camera.updateProjectionMatrix();

    // Tant que tout le portant tient à l'écran il reste centré ; sinon il
    // défile, et la barre file hors champ des deux côtés.
    const span = (this.count - 1) * SPACING;
    this.fits = span + 2.4 <= this.camera.right * 2;
    // Dans la penderie, le caisson laisse la place aux voisins qui s'écartent au survol.
    const room = this.vestiaire ? Math.max(span + 1.4, this.benchSpan + 1.6) : this.dark ? span + 2 * SPREAD + 1.3 : span + 2.7;
    const length = this.fits && !this.mobile ? Math.min(room, this.camera.right * 1.9) : this.camera.right * 2.4;
    this.bar.scale.y = length;
    this.ends[0].position.x = -length / 2;
    this.ends[1].position.x = length / 2;
    this.layoutPenderie(length);
  }

  loop(now) {
    this.frame = requestAnimationFrame(this.loop);
    const dt = Math.min((now - this.last) / 1000, 0.1);
    this.last = now;
    if (!this.visible || document.hidden) return;
    if (this.moving) this.time += dt;

    const ease = 1 - Math.exp(-dt * 8);
    const chosen = this.selected >= 0;
    if (this.vestiaire) {
      if (!this.lightBase) this.lightBase = { amb: this.ambient.intensity, front: this.frontLight?.intensity || 0, led: this.leds?.[0]?.intensity || 0 };
      this.lightBoost = THREE.MathUtils.lerp(this.lightBoost || 0, this.lightOn ? 1 : 0, reducedMotion.matches ? 1 : 1 - Math.exp(-dt * 7));
      const b = this.lightBoost;
      this.ambient.intensity = this.lightBase.amb * (1 + 0.28 * b);
      if (this.frontLight) this.frontLight.intensity = this.lightBase.front * (1 + 0.45 * b);
      if (this.leds) for (const l of this.leds) l.intensity = this.lightBase.led * (1 + 0.6 * b);
    }
    let speed = 0, ticks = 0;
    this.items.forEach((item, i) => {
      if (!item) return;
      if (item.bench) return this.stepShoe(item, i, dt, ease, chosen);
      let x = this.targetX(i) + this.offset, angle = ANGLE, z = 0, scale = 1;
      const active = chosen ? i === this.selected : i === this.hover;
      const carried = !chosen && this.carry && this.carry.index === i;
      // En main : il avance un peu et se tourne à peine, sans passer de face — de face il
      // serait trois fois plus large et recouvrirait ses voisins.
      if (carried) { angle = ANGLE + 0.3; z = 0.5; scale = 1.03; }
      if (chosen) {
        // Le maillot choisi vient au centre, en grand ; le portant reste derrière, flou.
        if (active) {
          x = 0;
          z = 1.2;
          angle = this.turn;
          scale = 1.32;
        } else {
          z = -0.4;
        }
      } else if (this.carry && !carried) {
        // Les voisins s'écartent autour de la place visée.
        const at = this.slotOf(this.carry.index);
        if (Math.abs(this.slotOf(i) - at) === 1) x += this.slotOf(i) < at ? -SPREAD * 0.4 : SPREAD * 0.4;
      } else if (this.hover >= 0 && !this.items[this.hover]?.bench) {
        // Les maillots ne s'écartent qu'entre eux : survoler une chaussure ne bouge pas la barre.
        if (active) { angle = 0; z = 0.9; scale = 1.22; }
        else x += this.slotOf(i) < this.slotOf(this.hover) ? -SPREAD : SPREAD;
      }

      // Un maillot mis en avant (survolé ou choisi) reste entier dans le cadre :
      // de face et agrandi, il est bien plus large que de profil.
      if (active) {
        const room = this.camera.right - (SHIRT_MAX_W * scale) / 2 - 0.1;
        x = THREE.MathUtils.clamp(x, -Math.max(0, room), Math.max(0, room));
      }

      item.pivot.position.z = THREE.MathUtils.lerp(item.pivot.position.z, z, ease);
      item.pivot.scale.setScalar(THREE.MathUtils.lerp(item.pivot.scale.x, scale, ease));

      // Ressorts, intégrés à pas fixes pour garder la même allure quel que
      // soit le nombre d'images par seconde. Le cintre glisse sur la barre et
      // pivote avec un peu d'inertie ; le maillot se balance doucement et
      // traîne derrière quand il glisse.
      const swell = this.moving ? Math.sin(this.time * 0.85 + i * 0.87) * 0.012 : 0;
      if (carried && dt > 0) {
        // Suivi direct de la main ; la vitesse mesurée nourrit le balancement et le tissu.
        const v = (this.carry.x - item.pivot.position.x) / dt;
        item.vx += (THREE.MathUtils.clamp(v, -14, 14) - item.vx) * 0.5;
        item.pivot.position.x = this.carry.x;
      }
      for (let left = dt; left > 1e-6; left -= STEP) {
        const step = Math.min(left, STEP);
        if (!carried) {
          item.vx += ((x - item.pivot.position.x) * 62 - item.vx * 13) * step;
          item.pivot.position.x += item.vx * step;
        }
        item.va += ((angle - item.pivot.rotation.y) * 58 - item.va * 12) * step;
        item.pivot.rotation.y += item.va * step;
        const sway = this.moving ? swell - THREE.MathUtils.clamp(item.vx * 0.05, -0.14, 0.14) : 0;
        item.vs += ((sway - item.sway) * 35 - item.vs * 7) * step;
        item.sway += item.vs * step;
        if (carried) item.vx *= Math.exp(-step * 6); // main immobile : le balancement s'apaise
        // Ressorts du tissu, plus mous et moins amortis que ceux du cintre :
        // l'ourlet part en retard, dépasse un peu, puis se pose.
        const lagTarget = this.moving ? THREE.MathUtils.clamp(-item.vx * 0.075, -0.32, 0.32) : 0;
        item.vl += ((lagTarget - item.lag) * 26 - item.vl * 4.2) * step;
        item.lag += item.vl * step;
        const twistTarget = this.moving ? THREE.MathUtils.clamp(-item.va * 0.11, -0.55, 0.55) : 0;
        item.vt += ((twistTarget - item.tw) * 22 - item.vt * 3.8) * step;
        item.tw += item.vt * step;
      }
      item.pivot.rotation.z = item.sway;
      // Le son suit le mouvement réel des cintres sur la barre.
      if (!(chosen && i === this.selected)) {
        const v = Math.abs(item.vx);
        speed += v;
        item.odo += v * dt;
        if (item.odo > 0.24) { item.odo = 0; if (ticks++ < 2) this.sound?.tick(Math.min(1, v / 4)); }
      }
      item.uniforms.impulse.value = this.moving ? THREE.MathUtils.clamp(item.va * 0.022 + item.vx * 0.012, -0.085, 0.085) : 0;
      item.uniforms.time.value = this.time + i * 0.7;
      item.uniforms.swing.value = item.lag;
      item.uniforms.twist.value = item.tw;
    });
    this.sound?.frame(speed);
    this.blur += ((chosen ? 1 : 0) - this.blur) * (reducedMotion.matches ? 1 : ease);
    this.draw();
  }

  draw() {
    const active = this.items[this.selected];
    if (this.blur < 0.01 || !active) {
      this.renderer.render(this.scene, this.camera);
      return;
    }
    // 1. le portant sans le maillot choisi, dans la petite texture ;
    active.pivot.visible = false;
    this.renderer.setRenderTarget(this.backdrop);
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);
    this.renderer.setRenderTarget(null);
    active.pivot.visible = true;
    // 2. étalé et flouté à l'écran ;
    this.veil.material.uniforms.amount.value = this.blur;
    this.renderer.render(this.veilScene, this.veilCamera);
    // 3. puis le maillot choisi, net, par-dessus.
    const hidden = [];
    for (const child of this.scene.children) {
      if (child !== active.pivot && !child.isLight && child.visible) { child.visible = false; hidden.push(child); }
    }
    this.renderer.autoClear = false;
    this.renderer.clearDepth();
    this.renderer.render(this.scene, this.camera);
    this.renderer.autoClear = true;
    for (const child of hidden) child.visible = true;
  }

  dispose() {
    cancelAnimationFrame(this.frame);
    this.observer.disconnect();
    this.seen.disconnect();
    this.scene.traverse((o) => {
      if (!o.isMesh) return;
      o.geometry.dispose();
      for (const m of [].concat(o.material)) {
        for (const t of [m.map, m.alphaMap]) {
          if (!t) continue;
          t.image?.close?.();
          t.dispose();
        }
        m.dispose();
      }
    });
    this.backdrop.dispose();
    this.veil.geometry.dispose();
    this.veil.material.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}

/* ------------------------------------------------------------------------ */
/* L'interface autour : le nom du maillot, les flèches, la fermeture        */
/* ------------------------------------------------------------------------ */

// Les prix arrivent tels que les formate la boutique, parfois avec des entités (« 54,90 &euro; »).
const decode = (s) => {
  const t = document.createElement('textarea');
  t.innerHTML = String(s ?? '');
  return t.value;
};
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const ARROW = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
// Tant qu'aucun maillot n'est survolé : dire qu'on peut jouer avec le portant.
const HINT = matchMedia('(hover: hover)').matches
  ? 'Fais glisser pour explorer les maillots'
  : 'Glisse pour explorer';
const BULB = '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path d="M9.5 18h5M10 21h4M12 3a6 6 0 0 0-3.4 10.9c.7.5 1.1 1.3 1.2 2.1h4.4c.1-.8.5-1.6 1.2-2.1A6 6 0 0 0 12 3z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const pad = (n) => String(n).padStart(2, '0');
const SPEAKER = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path class="mfp__waves" d="M15.5 9a4.5 4.5 0 0 1 0 6M18 6.5a8 8 0 0 1 0 11" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path class="mfp__mute" d="M16 9.5l5 5M21 9.5l-5 5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
function mount(root) {
  if (root.portant) return;
  const script = root.querySelector('[data-mfp-products]');
  const products = (script ? JSON.parse(script.textContent) : []).filter((p) => p && p.front);
  for (const p of products) p.price = decode(p.price);
  // Les maillots d'abord (la barre), les chaussures ensuite (le banc).
  products.sort((a, b) => (a.kind === 'chaussure' ? 1 : 0) - (b.kind === 'chaussure' ? 1 : 0));
  const jerseysCount = products.filter((p) => p.kind !== 'chaussure').length || products.length;
  const body = root.querySelector('[data-mfp-body]');
  if (!products.length || !body) return;
  root.classList.remove('mfp--flat');

  body.innerHTML = `
    <div class="mfp__stage" data-stage>
      <div class="mfp__rack" data-rack></div>
      <div class="mfp__loading" data-loading>On accroche les maillots<span>…</span></div>
      <button class="mfp__close" type="button" data-close aria-label="Retour au portant" hidden>Fermer</button>
      <button class="mfp__lightbtn" type="button" data-light aria-pressed="false" hidden>${BULB}<span>Éclairage</span></button>
      <button class="mfp__side mfp__side--prev" type="button" data-prev aria-label="Maillot précédent" hidden>${ARROW}</button>
      <button class="mfp__side mfp__side--next" type="button" data-next aria-label="Maillot suivant" hidden>${ARROW}</button>
      <div class="mfp__view" data-faces hidden>
        <div class="mfp__faces" role="group" aria-label="Vue du maillot">
          <button type="button" data-face="face" aria-pressed="true">Face</button>
          <button type="button" data-face="dos" aria-pressed="false">Dos</button>
        </div>
        <span class="mfp__turn">Ou glisse pour tourner</span>
      </div>
    </div>
    <div class="mfp__caption">
      <p data-name aria-live="polite"></p>
      <p class="mfp__price" data-price hidden></p>
      <a class="mfp__more" data-more href="#" hidden>Voir le maillot</a>
    </div>`;
  const $ = (s) => body.querySelector(s);
  const stage = $('[data-stage]');
  // Pas de son : sur une boutique, le silence fait partie de l'élégance. Un vrai enregistrement
  // pourrait être branché plus tard sur `sound` (lift / drop / frame).
  const sound = { lift() {}, drop() {}, frame() {}, tick() {} };

  // L'ordre choisi par le client est gardé pendant sa visite (même liste de maillots seulement).
  const ORDER_KEY = 'mfp-ordre-' + (root.id || '') + '-' + products.map((p) => p.url).join('|').length;
  let savedOrder = null;
  try {
    const raw = JSON.parse(sessionStorage.getItem(ORDER_KEY) || 'null');
    const fine = (arr, lo, hi) => Array.isArray(arr) && arr.length === hi - lo && [...arr].sort((a, b) => a - b).every((v, k) => v === lo + k);
    if (raw && fine(raw.barre, 0, jerseysCount) && fine(raw.banc, jerseysCount, products.length)) savedOrder = raw;
  } catch {}
  const announce = document.createElement('p');
  announce.className = 'mfp__sr';
  announce.setAttribute('aria-live', 'polite');
  root.append(announce);

  let selected = -1, focused = (savedOrder?.barre || [...Array(jerseysCount).keys()])[Math.floor((jerseysCount - 1) / 2)] ?? 0, hovered = -1, loaded = 0;
  const moving = !reducedMotion.matches;

  let rail;
  try {
    rail = new Rail($('[data-rack]'), products.length, {
      onSelect: (i) => select(i),
      onHover: (i) => { hovered = i; caption(); },
      onBrowse: (delta) => { focused = Math.max(0, Math.min(jerseysCount - 1, focused + delta)); hovered = -1; sync(); caption(); },
      onTurn: (turn) => faces(turn),
      onReorder: (order, moved) => {
        focused = rail.focus;
        try { sessionStorage.setItem(ORDER_KEY, JSON.stringify({ barre: rail.order, banc: rail.benchOrder })); } catch {}
        announce.textContent = products[moved].title + ' : place ' + (order.indexOf(moved) + 1) + ' sur ' + order.length;
        caption();
      },
      onCarry: (i, on) => { $('[data-name]').textContent = on ? products[i].title : ''; if (!on) caption(); },
    }, { ambiance: root.dataset.ambiance, photo: root.classList.contains('mfp--photo'), order: savedOrder?.barre, benchOrder: savedOrder?.banc, jerseys: jerseysCount });
  } catch (error) {
    console.error(error);
    fallback();
    return;
  }
  root.portant = rail;
  if (rail.vestiaire) {
    const lightBtn = $('[data-light]');
    lightBtn.hidden = false;
    lightBtn.addEventListener('click', () => {
      const on = lightBtn.getAttribute('aria-pressed') !== 'true';
      lightBtn.setAttribute('aria-pressed', String(on));
      rail.setLight(on);
    });
  }

  // Le centre d'abord, puis vers les bords : le portant se remplit sous les yeux.
  const order = products.map((_, i) => i).sort((a, b) => Math.abs(rail.slotOf(a) - rail.slotOf(focused)) - Math.abs(rail.slotOf(b) - rail.slotOf(focused)));
  (async () => {
    for (let at = 0; at < order.length; at += 3) {
      await Promise.all(order.slice(at, at + 3).map(async (i) => {
        try {
          const jersey = await buildJersey(products[i].front, products[i].back, rail.anisotropy);
          if (!root.portant) return;
          if (products[i].kind === 'chaussure') rail.addShoe(i, jersey);
          else rail.add(i, jersey);
          loaded++;
          $('[data-loading]').hidden = true;
        } catch (error) {
          console.error(error);
          if (!loaded) $('[data-loading]').textContent = 'Le portant n’a pas pu se charger. Rechargez la page.';
        }
      }));
      await new Promise((r) => requestAnimationFrame(r));
    }
  })();

  function sync() {
    rail.setState({ selected, focused, hovered, moving });
  }

  // Sous le portant : le nom du maillot survolé (ou choisi), et le lien vers sa fiche.
  function caption() {
    const i = selected >= 0 ? selected : hovered;
    const p = products[i];
    const name = $('[data-name]'), price = $('[data-price]');
    name.textContent = p ? p.title : HINT;
    name.classList.toggle('is-hint', !p);
    price.hidden = !(p && p.price);
    if (p) price.textContent = p.price || '';
    const more = $('[data-more]');
    more.hidden = selected < 0;
    if (p) {
      more.href = p.url;
      more.textContent = p.kind === 'chaussure' ? 'Voir le modèle' : 'Voir le maillot';
    }
    // Pas de photo du dos pour une chaussure : les boutons Face / Dos n'ont pas de sens.
    $('[data-faces]').hidden = selected < 0 || products[selected]?.kind === 'chaussure';
  }

  // Face / Dos : le bouton actif suit l'angle réel (aussi quand on tourne au doigt).
  function faces(turn) {
    const dos = Math.cos(turn) < 0;
    for (const b of body.querySelectorAll('[data-face]')) b.setAttribute('aria-pressed', String((b.dataset.face === 'dos') === dos));
  }

  function select(i) {
    sound.lift();
    selected = focused = i;
    hovered = -1;
    rail.resetTurn();
    stage.classList.add('is-selected');
    for (const b of body.querySelectorAll('[data-close], [data-prev], [data-next]')) b.hidden = false;
    sync();
    caption();
  }

  function release() {
    sound.drop();
    const was = selected;
    selected = hovered = -1;
    stage.classList.remove('is-selected');
    for (const b of body.querySelectorAll('[data-close], [data-prev], [data-next]')) b.hidden = true;
    sync();
    caption();
    rail.renderer.domElement.focus();
    return was;
  }

  // Précédent / suivant : l'ordre visuel du vestiaire (la barre puis le banc), tel que le client l'a peut-être changé.
  function shift(delta) {
    const visual = rail.order.concat(rail.benchOrder);
    const at = visual.indexOf(selected >= 0 ? selected : focused);
    const i = visual[(at + delta + visual.length) % visual.length];
    if (selected >= 0) select(i);
    else if (i < jerseysCount) { focused = hovered = i; sync(); caption(); }
    else { hovered = i; sync(); caption(); }
  }

  // Sans WebGL : une simple rangée de maillots.
  function fallback() {
    root.classList.add('mfp--flat');
    body.innerHTML = `<ul class="mfp__flat" data-mfp-fallback>${products.map((p) => `<li><a href="${esc(p.url)}"><img src="${esc(p.front)}" alt="${esc(p.title)}" loading="lazy"><span>${esc(p.title)}</span></a></li>`).join('')}</ul>`;
  }

  $('[data-prev]').addEventListener('click', () => shift(-1));
  $('[data-next]').addEventListener('click', () => shift(1));
  $('[data-close]').addEventListener('click', release);
  for (const b of body.querySelectorAll('[data-face]')) b.addEventListener('click', () => rail.turnTo(b.dataset.face));
  root.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && selected >= 0) { release(); return; }
    if (e.target.closest('a')) return;
    // Maj + flèche : déplacer le maillot mis en avant d'une place.
    if (e.shiftKey && selected < 0 && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
      e.preventDefault();
      const who = hovered >= 0 ? hovered : focused;
      if (rail.nudge(who, e.key === 'ArrowRight' ? 1 : -1)) { focused = hovered = who; sync(); }
      return;
    }
    if (e.key === 'ArrowRight') { e.preventDefault(); shift(1); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); shift(-1); }
    if (e.key === 'Enter' && e.target === rail.renderer.domElement && selected < 0) select(hovered >= 0 ? hovered : focused);
  });
  root.portantDispose = () => { root.portant = null; rail.dispose(); };

  sync();
  caption();
}

function mountAll(scope = document) {
  scope.querySelectorAll('[data-mfp]').forEach(mount);
}

mountAll();
// Éditeur de thème Shopify : la section est rechargée à chaque réglage.
document.addEventListener('shopify:section:load', (e) => mountAll(e.target));
document.addEventListener('shopify:section:unload', (e) => {
  e.target.querySelectorAll('[data-mfp]').forEach((root) => root.portantDispose?.());
});
