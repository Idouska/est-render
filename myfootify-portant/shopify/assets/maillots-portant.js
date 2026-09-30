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

const SPACING = 1.18; // écart entre deux cintres sur la barre
const RAIL_Y = 1.5; // hauteur de la barre
const ANGLE = -1.12; // les maillots se présentent de biais, comme sur un vrai portant
const SHIRT_H = 2.62; // hauteur d'un maillot, en unités de scène
const SHIRT_MAX_W = 2.9;
const COLLAR_Y = -0.33; // le haut du col, sous la barre, là où arrive la tige du cintre
const STEP = 1 / 60; // pas d'intégration des ressorts
const SIZE_SCALE = {
  XS: [0.86, 0.9], S: [0.93, 0.95], M: [1, 1], L: [1.08, 1.055],
  XL: [1.16, 1.11], XXL: [1.24, 1.16], '3XL': [1.3, 1.2],
};
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
  const res = await fetch(url, { mode: 'cors', credentials: 'omit' });
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
export function cutout(img, maxSide = 640, tune = {}) {
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
  if (dw <= 0) return Math.max(-0.04, dw * (2 * 0.05 / 0.07 + 2 * 0.075 / 0.6));
  return 0.05 * ramp(dw / 0.07) + 0.075 * ramp(dw / 0.6);
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

  const Index = pos.length / 3 > 65535 ? Uint32Array : Uint16Array;
  return {
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
    const source = `const SHIRT_H = ${SHIRT_H}, SHIRT_MAX_W = ${SHIRT_MAX_W};\n${PIPELINE.join('\n')}
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
    shader.vertexShader = 'uniform float fabricTime; uniform float fabricImpulse;\n' + shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
float rise = 1.0 - uv.y; // 1 au col, 0 à l'ourlet
float fall = pow(1.0 - rise, 2.0);
transformed.z += (sin(fabricTime * 1.35 + rise * 5.0 + uv.x * 2.0) * 0.014 + sin(rise * 3.1) * fabricImpulse) * fall;
transformed.x += sin(fabricTime * 1.1 + rise * 4.0) * 0.008 * fall;`,
    );
  };
}

export class Rail {
  constructor(host, count, callbacks) {
    this.host = host;
    this.count = count;
    this.callbacks = callbacks;
    this.items = [];
    this.meshes = [];
    this.moving = true;
    this.selected = -1;
    this.focus = Math.floor((count - 1) / 2);
    this.hover = -1;
    this.offset = 0;
    this.time = 0;
    this.size = 'M';
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
    canvas.setAttribute('aria-label', 'Portant de maillots : faites-le glisser ou choisissez un maillot');
    host.append(canvas);
    this.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());

    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-6, 6, 2.4, -2.4, 0.1, 80);
    this.scene.add(new THREE.AmbientLight(0xffffff, 1.7));
    const key = new THREE.DirectionalLight(0xfffcf5, 2.1);
    key.position.set(-3, 7, 6);
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

    const floor = new THREE.Mesh(new THREE.PlaneGeometry(60, 25), new THREE.ShadowMaterial({ opacity: 0.065 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -2;
    floor.receiveShadow = true;
    this.scene.add(floor);

    const chrome = new THREE.MeshStandardMaterial({ color: 0x9a9d95, metalness: 0.74, roughness: 0.26 });
    this.bar = new THREE.Mesh(new THREE.CylinderGeometry(0.031, 0.031, 1, 32), chrome);
    this.bar.rotation.z = Math.PI / 2;
    this.bar.position.y = RAIL_Y;
    this.bar.castShadow = true;
    this.scene.add(this.bar);
    this.ends = [-1, 1].map(() => {
      const end = new THREE.Mesh(new THREE.SphereGeometry(0.058, 18, 14), chrome);
      end.position.y = RAIL_Y;
      this.scene.add(end);
      return end;
    });

    // Le crochet du cintre, qui passe par-dessus la barre et descend jusqu'au col.
    const hook = [[-0.06, 0.025], [-0.08, 0.115], [0.015, 0.16], [0.105, 0.11], [0.075, 0.025], [0, -0.045], [0, COLLAR_Y - 0.03]];
    this.hookGeometry = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(hook.map(([x, y]) => new THREE.Vector3(x, y, 0))), 40, 0.012, 10, false);
    this.hookMaterial = new THREE.MeshStandardMaterial({ color: 0x696b61, metalness: 0.6, roughness: 0.35 });

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

  listen(canvas) {
    canvas.addEventListener('pointerdown', (e) => {
      if (e.button > 0) return;
      this.drag = { x: e.clientX, moved: false, target: this.pick(e), turn: this.turn };
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (this.drag) {
        const dx = e.clientX - this.drag.x;
        if (Math.abs(dx) <= 7) return;
        this.drag.moved = true;
        if (this.selected >= 0) {
          this.turn = this.drag.turn + (dx / this.host.clientWidth) * Math.PI * 2;
          this.callbacks.onRotate(Math.cos(this.turn) < 0 ? 'back' : 'front');
        } else {
          this.offset = (dx / this.host.clientWidth) * 7;
          this.setHover(-1);
        }
      } else if (this.selected < 0 && e.pointerType === 'mouse') {
        const hit = this.pick(e);
        this.setHover(hit);
        canvas.style.cursor = hit >= 0 ? 'pointer' : 'grab';
      }
    });
    canvas.addEventListener('pointerup', () => {
      if (!this.drag) return;
      const drag = this.drag;
      this.drag = null;
      if (!drag.moved && drag.target >= 0) this.callbacks.onSelect(drag.target);
      else if (drag.moved && this.selected < 0) {
        this.callbacks.onBrowse(Math.round(-this.offset / SPACING) || Math.sign(-this.offset));
      }
      this.offset = 0;
    });
    canvas.addEventListener('pointercancel', () => { this.drag = null; this.offset = 0; });
    canvas.addEventListener('pointerleave', () => { if (!this.drag && this.selected < 0) this.setHover(-1); });
  }

  add(index, jersey) {
    const uniforms = { time: { value: 0 }, impulse: { value: 0 } };
    // Un tissu mat, sans reflet ; le matériau le plus léger, ce qui compte sur mobile.
    const front = new THREE.MeshLambertMaterial({ map: jersey.frontMap, alphaMap: jersey.alphaMap, alphaTest: 0.5 });
    const back = new THREE.MeshLambertMaterial({ map: jersey.backMap, alphaMap: jersey.alphaMap, alphaTest: 0.5 });
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
    pivot.add(shirt, new THREE.Mesh(this.hookGeometry, this.hookMaterial));
    this.scene.add(pivot);
    this.items[index] = { pivot, shirt, uniforms, vx: 0, va: 0, sway: 0, vs: 0 };
  }

  targetX(index) {
    const center = this.mobile || !this.fits ? this.focus : (this.count - 1) / 2;
    return (index - center) * SPACING;
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

  setView(view) {
    this.turn = view === 'back' ? Math.PI : 0;
    this.callbacks.onRotate(view);
  }

  // « M », « M / Flocage », « 2XL »… ramenés à une taille connue ; sinon, M.
  setSize(title) {
    const size = String(title).split(/[\s/]+/)[0].toUpperCase();
    const alias = { '2XL': 'XXL', XXXL: '3XL' }[size] || size;
    this.size = SIZE_SCALE[alias] ? alias : 'M';
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
    const h = this.selected >= 0 && this.mobile ? 385 : height;
    if (this.canvasSize !== width + 'x' + h) {
      this.canvasSize = width + 'x' + h;
      this.renderer.setSize(width, h, false);
      this.renderer.domElement.style.height = h + 'px';
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
    const length = this.fits && !this.mobile ? Math.min(span + 2.7, this.camera.right * 1.9) : this.camera.right * 2.4;
    this.bar.scale.y = length;
    this.ends[0].position.x = -length / 2;
    this.ends[1].position.x = length / 2;
  }

  loop(now) {
    this.frame = requestAnimationFrame(this.loop);
    const dt = Math.min((now - this.last) / 1000, 0.1);
    this.last = now;
    if (!this.visible || document.hidden) return;
    if (this.moving) this.time += dt;

    const ease = 1 - Math.exp(-dt * 8);
    const chosen = this.selected >= 0;
    this.items.forEach((item, i) => {
      if (!item) return;
      let x = this.targetX(i) + this.offset, angle = ANGLE, z = 0, scale = 1;
      const active = chosen ? i === this.selected : i === this.hover;
      if (chosen) {
        if (active) {
          x = this.mobile ? 0 : -2.05;
          z = 0.62;
          angle = this.turn;
          scale = 1.09;
        } else {
          const far = this.camera.right + 4.5;
          x = i < this.selected ? -far - (this.selected - i) * 0.45 : far + (i - this.selected) * 0.45;
          z = -0.5;
          angle = -1.3;
          scale = 0.84;
        }
      } else if (this.hover >= 0) {
        if (active) { angle = -0.08; z = 0.7; scale = 1.025; }
        else x += i < this.hover ? -0.68 : 0.68;
      }

      const [sx, sy] = chosen && active ? SIZE_SCALE[this.size] : [1, 1];
      const snap = reducedMotion.matches ? 1 : ease;
      item.shirt.scale.x = THREE.MathUtils.lerp(item.shirt.scale.x, sx, snap);
      item.shirt.scale.y = THREE.MathUtils.lerp(item.shirt.scale.y, sy, snap);

      item.pivot.position.z = THREE.MathUtils.lerp(item.pivot.position.z, z, ease);
      item.pivot.scale.setScalar(THREE.MathUtils.lerp(item.pivot.scale.x, scale, ease));

      // Ressorts, intégrés à pas fixes pour garder la même allure quel que
      // soit le nombre d'images par seconde. Le cintre glisse sur la barre et
      // pivote avec un peu d'inertie ; le maillot se balance doucement et
      // traîne derrière quand il glisse.
      const swell = this.moving ? Math.sin(this.time * 0.85 + i * 0.87) * 0.012 : 0;
      for (let left = dt; left > 1e-6; left -= STEP) {
        const step = Math.min(left, STEP);
        item.vx += ((x - item.pivot.position.x) * 62 - item.vx * 13) * step;
        item.va += ((angle - item.pivot.rotation.y) * 58 - item.va * 12) * step;
        item.pivot.position.x += item.vx * step;
        item.pivot.rotation.y += item.va * step;
        const sway = this.moving ? swell - THREE.MathUtils.clamp(item.vx * 0.035, -0.09, 0.09) : 0;
        item.vs += ((sway - item.sway) * 35 - item.vs * 7) * step;
        item.sway += item.vs * step;
      }
      item.pivot.rotation.z = item.sway;
      item.uniforms.impulse.value = this.moving ? THREE.MathUtils.clamp(item.va * 0.022 + item.vx * 0.012, -0.085, 0.085) : 0;
      item.uniforms.time.value = this.time + i * 0.7;
    });
    this.renderer.render(this.scene, this.camera);
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
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}

/* ------------------------------------------------------------------------ */
/* L'interface autour : légende, pastilles, fiche du maillot choisi         */
/* ------------------------------------------------------------------------ */

// Les prix arrivent tels que les formate la boutique, parfois avec des entités (« 54,90 &euro; »).
const decode = (s) => {
  const t = document.createElement('textarea');
  t.innerHTML = String(s ?? '');
  return t.value;
};
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const pad = (n) => String(n).padStart(2, '0');
const withVariant = (url, id) => url + (url.includes('?') ? '&' : '?') + 'variant=' + id;

function mount(root) {
  if (root.portant) return;
  const script = root.querySelector('[data-mfp-products]');
  const products = (script ? JSON.parse(script.textContent) : []).filter((p) => p && p.front);
  for (const p of products) {
    p.price = decode(p.price);
    for (const v of p.variants || []) v.price = decode(v.price);
  }
  const body = root.querySelector('[data-mfp-body]');
  if (!products.length || !body) return;
  const cartUrl = root.dataset.cartUrl || '/cart/add';
  root.classList.remove('mfp--flat');

  body.innerHTML = `
    <div class="mfp__stage" data-stage>
      <div class="mfp__rack" data-rack></div>
      <div class="mfp__loading" data-loading>On accroche les maillots<span>…</span></div>
      <button class="mfp__return" type="button" data-return hidden>× <span>Retour au portant</span></button>
      <button class="mfp__motion" type="button" data-motion aria-pressed="true"><span data-motion-icon>Ⅱ</span><span data-motion-label>Mouvement</span></button>
      <aside class="mfp__panel" data-panel aria-label="Maillot sélectionné" hidden></aside>
    </div>
    <div class="mfp__caption">
      <div class="mfp__index"><span data-index>01</span><span class="mfp__index-line"></span><span>${pad(products.length)}</span></div>
      <div class="mfp__caption-main"><p data-name></p><span data-hint></span></div>
      <div class="mfp__arrows">
        <button type="button" data-prev aria-label="Maillot précédent">‹</button>
        <button type="button" data-next aria-label="Maillot suivant">›</button>
      </div>
    </div>
    <div class="mfp__dots" data-dots role="group" aria-label="Choisir un maillot"></div>
    <div class="mfp__sr" aria-live="polite" data-announcer></div>`;
  const $ = (s) => body.querySelector(s);
  const stage = $('[data-stage]'), panel = $('[data-panel]'), announcer = $('[data-announcer]');

  let selected = -1, focused = Math.floor((products.length - 1) / 2), hovered = -1;
  let moving = !reducedMotion.matches, loaded = 0;

  const dots = products.map((p, i) => {
    const dot = document.createElement('button');
    dot.type = 'button';
    dot.className = 'mfp__dot';
    dot.setAttribute('aria-label', 'Voir ' + p.title);
    dot.innerHTML = '<i></i>';
    dot.addEventListener('click', () => select(i));
    $('[data-dots]').append(dot);
    return dot;
  });

  let rail;
  try {
    rail = new Rail($('[data-rack]'), products.length, {
      onSelect: (i) => select(i),
      onRotate: (view) => showView(view),
      onHover: (i) => { hovered = i; caption(i); },
      onBrowse: (delta) => { focused = Math.max(0, Math.min(products.length - 1, focused + delta)); hovered = -1; sync(); caption(focused); },
    });
  } catch (error) {
    console.error(error);
    fallback();
    return;
  }
  root.portant = rail;

  // Le centre d'abord, puis vers les bords : le portant se remplit sous les yeux.
  const order = products.map((_, i) => i).sort((a, b) => Math.abs(a - focused) - Math.abs(b - focused));
  (async () => {
    for (let at = 0; at < order.length; at += 3) {
      await Promise.all(order.slice(at, at + 3).map(async (i) => {
        try {
          const jersey = await buildJersey(products[i].front, products[i].back, rail.anisotropy);
          if (!root.portant) return;
          rail.add(i, jersey);
          products[i].swatch = jersey.swatch;
          products[i].hasBack = jersey.hasBack;
          dots[i].style.setProperty('--swatch', jersey.swatch);
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
    dots.forEach((d, i) => d.classList.toggle('is-current', i === (selected >= 0 ? selected : focused)));
  }

  function caption(i) {
    const p = products[i];
    $('[data-name]').textContent = p ? p.title : 'Toute la collection';
    $('[data-hint]').textContent = p
      ? `${p.price} · ${selected >= 0 ? 'Sélectionné sur le portant' : 'Cliquez pour le voir de près'}`
      : 'Faites glisser pour parcourir. Choisissez un maillot.';
    $('[data-index]').textContent = pad((i >= 0 ? i : focused) + 1);
  }

  function select(i) {
    const p = products[i];
    selected = focused = i;
    hovered = -1;
    const variants = p.variants || [];
    const initial = variants.find((v) => v.title === 'M' && v.available) || variants.find((v) => v.available) || variants[0];
    rail.setSize(initial ? initial.title : 'M');
    rail.setView('front');
    stage.classList.add('is-selected');
    $('[data-return]').hidden = false;
    panel.hidden = false;
    panel.innerHTML = `
      ${p.type ? `<span class="mfp__kicker">${esc(p.type)}</span>` : ''}
      <h3>${esc(p.title)}</h3>
      <p class="mfp__price" data-price>${esc(initial ? initial.price : p.price)}</p>
      <div class="mfp__views" role="group" aria-label="Vue du maillot">
        <button type="button" data-view="front" aria-pressed="true">Face</button>
        <button type="button" data-view="back" aria-pressed="false">Dos</button>
        <span>Glissez le maillot pour le tourner</span>
      </div>
      <p class="mfp__back-note" hidden>Pas de photo du dos pour ce maillot · couleur indicative.</p>
      <div class="mfp__size-label"><span><i class="mfp__swatch" style="background:${esc(p.swatch || '#999')}"></i>Taille</span><span>${variants.some((v) => v.available) ? 'Choisissez votre taille' : 'Épuisé'}</span></div>
      <div class="mfp__sizes" role="group" aria-label="Taille">${variants.map((v) => `<button type="button" data-variant="${esc(v.id)}" aria-pressed="${v === initial}" class="${v === initial ? 'is-selected' : ''}"${v.available ? '' : ' disabled'}>${esc(v.title)}</button>`).join('')}</div>
      <form class="mfp__cart" method="post" action="${esc(cartUrl)}">
        <input type="hidden" name="id" value="${esc(initial ? initial.id : '')}">
        <input type="hidden" name="quantity" value="1">
        <button type="submit" class="mfp__buy"${initial && initial.available ? '' : ' disabled'}>Ajouter au panier</button>
      </form>
      <a class="mfp__more" data-more href="${esc(initial ? withVariant(p.url, initial.id) : p.url)}">Voir le maillot →</a>
      <p class="mfp__note">Aperçu visuel des tailles · proportions indicatives.</p>`;
    panel.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => rail.setView(b.dataset.view)));
    panel.querySelectorAll('[data-variant]').forEach((b) => b.addEventListener('click', () => {
      const v = variants.find((x) => String(x.id) === b.dataset.variant);
      panel.querySelectorAll('[data-variant]').forEach((o) => {
        o.classList.toggle('is-selected', o === b);
        o.setAttribute('aria-pressed', String(o === b));
      });
      rail.setSize(v.title);
      panel.querySelector('[name=id]').value = v.id;
      panel.querySelector('[data-price]').textContent = v.price;
      panel.querySelector('[data-more]').href = withVariant(p.url, v.id);
      announcer.textContent = `${p.title} : aperçu en taille ${v.title}.`;
    }));
    sync();
    caption(i);
    announcer.textContent = `${p.title} sélectionné. ${p.price}.`;
  }

  function showView(view) {
    panel.querySelectorAll('[data-view]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === view)));
    const note = panel.querySelector('.mfp__back-note');
    if (note) note.hidden = view !== 'back' || Boolean(products[selected]?.hasBack);
  }

  function release() {
    const was = selected;
    selected = hovered = -1;
    panel.hidden = true;
    stage.classList.remove('is-selected');
    $('[data-return]').hidden = true;
    sync();
    caption(-1);
    return was;
  }

  function shift(delta) {
    const i = ((selected >= 0 ? selected : focused) + delta + products.length) % products.length;
    if (selected >= 0) select(i);
    else { focused = hovered = i; sync(); caption(i); }
  }

  function setMotion(on) {
    moving = on;
    const button = $('[data-motion]');
    button.setAttribute('aria-pressed', String(on));
    button.setAttribute('aria-label', on ? 'Mettre le mouvement en pause' : 'Relancer le mouvement');
    $('[data-motion-icon]').textContent = on ? 'Ⅱ' : '▷';
    sync();
  }

  // Sans WebGL : une simple rangée de maillots.
  function fallback() {
    root.classList.add('mfp--flat');
    body.innerHTML = `<ul class="mfp__flat" data-mfp-fallback>${products.map((p) => `<li><a href="${esc(p.url)}"><img src="${esc(p.front)}" alt="${esc(p.title)}" loading="lazy"><span>${esc(p.title)}</span><small>${esc(p.price)}</small></a></li>`).join('')}</ul>`;
  }

  $('[data-prev]').addEventListener('click', () => shift(-1));
  $('[data-next]').addEventListener('click', () => shift(1));
  $('[data-return]').addEventListener('click', () => dots[release()]?.focus());
  $('[data-motion]').addEventListener('click', () => setMotion(!moving));
  root.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && selected >= 0) { dots[release()]?.focus(); return; }
    if (e.target.closest('.mfp__sizes, a, form')) return;
    if (e.key === 'ArrowRight') { e.preventDefault(); shift(1); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); shift(-1); }
  });
  root.portantDispose = () => { root.portant = null; rail.dispose(); };

  setMotion(moving);
  caption(-1);
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
