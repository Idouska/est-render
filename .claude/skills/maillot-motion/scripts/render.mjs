#!/usr/bin/env node
/**
 * Rend une vidéo maillot-motion à partir d'un fichier de scène (video.json).
 *
 *   node scripts/render.mjs video.json                  contrôle + planche + vidéos + son
 *   node scripts/render.mjs video.json --brouillon      aperçu rapide (demi-résolution, sans flou)
 *   node scripts/render.mjs video.json --controle       contrôle des textes seulement
 *   node scripts/render.mjs video.json --planche        planche contact (une image par temps)
 *   node scripts/render.mjs video.json --images 0,2,6.5 images fixes à ces instants
 *
 * Options : --formats 9:16,4:5,1:1,16:9  --fps 30  --flou 4  --travailleurs 3
 *           --sortie <dossier>  --sans-son  --sans-musique
 *           --son-seulement   refait le son d'un MP4 déjà rendu, sans recalculer l'image
 *
 * Chaque image est une fonction pure du temps (engine/motion.js) : la page est
 * ouverte dans Chromium, positionnée à l'instant voulu, capturée, puis les
 * images sont envoyées à ffmpeg. Le flou de mouvement mélange plusieurs
 * sous-images par image (obturateur à 180°).
 */

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, extname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SKILL = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const HOST = 'http://mm.local';
const FORMATS = {
  '9:16': [1080, 1920],
  '4:5': [1080, 1350],
  '1:1': [1080, 1080],
  '16:9': [1920, 1080],
};

/* --------------------------------------------------------------------------
 * Arguments
 * ------------------------------------------------------------------------ */

function parseArgs(argv) {
  const a = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i];
    if (!x.startsWith('--')) a._.push(x);
    else {
      const k = x.slice(2);
      const next = argv[i + 1];
      if (next != null && !next.startsWith('--') && ['formats', 'fps', 'flou', 'travailleurs', 'sortie', 'images', 'echelle'].includes(k)) {
        a[k] = next;
        i++;
      } else a[k] = true;
    }
  }
  return a;
}

const args = parseArgs(process.argv.slice(2));
if (!args._[0] || args.aide || args.help) {
  console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0].replace(/^#!.*\n\/\*\*?/, '').replace(/^ \* ?/gm, ''));
  process.exit(args._[0] ? 0 : 1);
}

const log = (...m) => console.log(...m);
const fail = (m) => {
  console.error('✗ ' + m);
  process.exit(1);
};

/* --------------------------------------------------------------------------
 * Scène
 * ------------------------------------------------------------------------ */

const specPath = resolve(args._[0]);
if (!existsSync(specPath)) fail(`Fichier de scène introuvable : ${specPath}`);
const specDir = dirname(specPath);
let spec;
try {
  spec = JSON.parse(readFileSync(specPath, 'utf8'));
} catch (e) {
  fail(`JSON invalide dans ${specPath} : ${e.message}`);
}

// « marque » peut pointer vers un fichier partagé par toutes les vidéos.
let brandDir = specDir;
if (typeof spec.marque === 'string') {
  const p = resolve(specDir, spec.marque);
  if (!existsSync(p)) fail(`Fichier de marque introuvable : ${p}`);
  brandDir = dirname(p);
  spec.marque = JSON.parse(readFileSync(p, 'utf8'));
}
spec.marque = spec.marque || {};

const modele = spec.modele || 'drop';
// Un modèle propre au projet : chemin d'un fichier .js, relatif au fichier de scène.
const customTemplate = /\.js$/.test(modele) ? resolve(specDir, modele) : null;
const templatePath = customTemplate || join(SKILL, 'templates', modele + '.js');
if (!existsSync(templatePath)) {
  const list = spawnSync('ls', [join(SKILL, 'templates')]).stdout.toString().trim().replace(/\.js/g, '').split('\n');
  fail(`Modèle « ${modele} » inconnu. Modèles disponibles : ${list.join(', ')}`);
}

// Chemins de fichiers → URL servies par la route mm.local.
const warnings = [];
function asset(p, base = specDir, label = 'fichier') {
  if (!p) return p;
  if (/^https?:/.test(p)) fail(`${label} : télécharge d'abord le fichier en local (${p}).`);
  const abs = isAbsolute(p) ? p : resolve(base, p);
  if (!existsSync(abs)) fail(`${label} introuvable : ${abs}`);
  return HOST + '/fs' + encodeURI(abs);
}
const demo = (n) => join(SKILL, 'assets', 'demo', n);
const P = (spec.produit = spec.produit || {});
if (['drop', 'promo'].includes(modele) && !P.image && !(spec.produits && spec.produits.length)) {
  P.image = demo('maillot-domicile-face.svg');
  warnings.push('Pas de produit.image : maillot de démonstration utilisé.');
}

if (modele === 'flocage' && !P.image_dos) {
  P.image_dos = demo('maillot-domicile-dos.svg');
  warnings.push('Pas de produit.image_dos : dos de démonstration utilisé.');
}
// Tous les champs « image », « image_dos » et « logo… » du fichier de scène (produit,
// produits, match.domicile…) deviennent des URL servies par la route mm.local.
(function resolveImages(o, path) {
  if (Array.isArray(o)) return o.forEach((v, i) => resolveImages(v, `${path}[${i}]`));
  if (!o || typeof o !== 'object') return;
  for (const [k, v] of Object.entries(o)) {
    if (/^(image|image_dos|logo\w*)$/.test(k) && typeof v === 'string') o[k] = asset(v, specDir, `${path}.${k}`);
    else if (k !== 'marque') resolveImages(v, path ? `${path}.${k}` : k);
  }
})(spec, '');
if (spec.marque.logo) spec.marque.logo = asset(spec.marque.logo, brandDir, 'marque.logo');
const fontsOverride = spec.marque.polices || {};

const formats = String(args.formats || (spec.formats || ['9:16']).join(','))
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
for (const f of formats) if (!FORMATS[f]) fail(`Format inconnu : ${f} (formats : ${Object.keys(FORMATS).join(', ')})`);

const draft = !!args.brouillon;
const fps = +(args.fps || spec.fps || 30);
const sub = draft ? 1 : Math.max(1, +(args.flou || spec.flou || 4));
const scale = +(args.echelle || (draft ? 0.5 : 1));
const workers = Math.max(1, +(args.travailleurs || 3));
const slug = spec.nom || basename(specPath, extname(specPath));
const outDir = resolve(args.sortie || spec.sortie || join(specDir, 'sortie'));
const tmp = join(outDir, '.tmp-' + slug);
mkdirSync(tmp, { recursive: true });

/* --------------------------------------------------------------------------
 * Musique : tempo et premier temps mesurés, avant de construire les pages.
 * ------------------------------------------------------------------------ */

const PY = process.env.PYTHON || 'python3';
const audioPy = join(SKILL, 'scripts', 'audio.py');
let music = null;
if (spec.musique && spec.musique.fichier && !args['sans-musique']) {
  const f = resolve(specDir, spec.musique.fichier);
  if (!existsSync(f)) fail(`Musique introuvable : ${f}`);
  const r = spawnSync(PY, [audioPy, 'analyse', f, '--debut', String(spec.musique.debut || 0)], { encoding: 'utf8' });
  if (r.status !== 0) fail('Analyse de la musique impossible :\n' + r.stderr);
  music = { file: f, ...JSON.parse(r.stdout) };
  if (!spec.bpm) spec.bpm = music.bpm;
  // Correction manuelle si le début de mesure détecté est faux : décalage en temps.
  if (spec.musique.decalage) music.start += (spec.musique.decalage * 60) / music.bpm;
  log(`♪ ${basename(f)} : ${music.bpm.toFixed(1)} BPM, départ calé sur le temps à ${music.start.toFixed(3)} s`);
}

/* --------------------------------------------------------------------------
 * Page
 * ------------------------------------------------------------------------ */

function fontFace(family, file, weight) {
  return `@font-face{font-family:'${family}';src:url('${file}');font-weight:${weight};font-style:normal;font-display:block}`;
}
function pageHtml(fmt) {
  const c = (spec.marque && spec.marque.couleurs) || {};
  const titre = fontsOverride.titre ? asset(fontsOverride.titre, brandDir, 'marque.polices.titre') : `${HOST}/skill/fonts/Anton-Regular.ttf`;
  const texte = fontsOverride.texte ? asset(fontsOverride.texte, brandDir, 'marque.polices.texte') : null;
  const faces = [
    fontFace('MM Titre', titre, '100 900'),
    texte
      ? fontFace('MM Texte', texte, '100 900')
      : [
          fontFace('MM Texte', `${HOST}/skill/fonts/BarlowCondensed-SemiBold.ttf`, 600),
          fontFace('MM Texte', `${HOST}/skill/fonts/BarlowCondensed-ExtraBold.ttf`, 800),
          fontFace('MM Texte', `${HOST}/skill/fonts/BarlowCondensed-Black.ttf`, 900),
        ].join(''),
  ].join('\n');
  return `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="${HOST}/skill/engine/stage.css">
<style>${faces}
#stage{--fond:${c.fond || '#0b0b0d'};--texte:${c.texte || '#fff'};--accent:${c.accent || '#d8ff3c'}}</style>
</head><body><div id="stage"></div>
<script>window.SPEC=${JSON.stringify(spec)};window.FORMAT=${JSON.stringify(fmt)};</script>
<script src="${HOST}/skill/engine/motion.js"></script>
<script src="${HOST}/skill/engine/ui.js"></script>
<script src="${HOST}/skill/engine/cinema.js"></script>
<script src="${customTemplate ? HOST + '/fs' + encodeURI(customTemplate) : `${HOST}/skill/templates/${modele}.js`}"></script>
</body></html>`;
}

async function loadPlaywright() {
  const tries = [() => import('playwright')];
  const dirs = [process.cwd(), ...(process.env.NODE_PATH || '').split(':'), '/opt/node-tools', '/usr/local/lib/node_modules_global', '/usr/lib/node_modules'];
  for (const d of dirs.filter(Boolean)) tries.push(async () => createRequire(join(d, 'noop.js'))('playwright'));
  const npmRoot = spawnSync('npm', ['root', '-g'], { encoding: 'utf8' }).stdout?.trim();
  if (npmRoot) tries.push(async () => createRequire(join(npmRoot, 'noop.js'))('playwright'));
  for (const t of tries) {
    try {
      const m = await t();
      return m.chromium ? m : m.default;
    } catch (e) {}
  }
  fail('Playwright est introuvable. Installe-le : npm i -D playwright && npx playwright install chromium');
}

const { chromium } = await loadPlaywright();
const browser = await chromium.launch({ args: ['--font-render-hinting=none', '--disable-lcd-text', '--force-color-profile=srgb'] });

async function openPage(fmt) {
  const [W, H] = FORMATS[fmt];
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  const html = pageHtml(fmt);
  await page.route(HOST + '/**', async (route) => {
    const url = new URL(route.request().url());
    const path = decodeURIComponent(url.pathname);
    if (path === '/index.html') return route.fulfill({ body: html, contentType: 'text/html; charset=utf-8' });
    let file = null;
    if (path.startsWith('/skill/')) file = join(SKILL, path.slice(7));
    else if (path.startsWith('/fs/')) file = path.slice(3);
    if (!file || !existsSync(file)) return route.fulfill({ status: 404, body: 'introuvable' });
    return route.fulfill({ path: file });
  });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(HOST + '/index.html');
  try {
    await page.waitForFunction(() => window.__mm && (window.__mm.ready || window.__mm.error), null, { timeout: 60000 });
  } catch (e) {
    fail(`La page ${fmt} ne s'est pas construite :\n${errors.join('\n')}`);
  }
  const state = await page.evaluate(() => ({ ready: window.__mm.ready, error: window.__mm.error }));
  if (!state.ready) {
    const msg = String(state.error).replace(/^Error: /, '');
    fail(`Erreur dans le modèle (${fmt}) : ${process.env.MM_DEBUG ? msg + '\n' + errors.join('\n') : msg.split('\n')[0]}`);
  }
  const cdp = await page.context().newCDPSession(page);
  return { page, cdp, W, H };
}

// JPEG 95 pour les images de la vidéo : l'encodage PNG d'une image granuleuse
// coûte trois fois plus cher, pour une différence invisible après x264.
async function capture(pg, t, sc = scale, format = 'png') {
  await pg.page.evaluate((t) => window.__mm.seek(t), t);
  const r = await pg.cdp.send('Page.captureScreenshot', {
    format,
    ...(format === 'jpeg' ? { quality: 95 } : {}),
    optimizeForSpeed: true,
    clip: { x: 0, y: 0, width: pg.W, height: pg.H, scale: sc },
  });
  return Buffer.from(r.data, 'base64');
}

/* --------------------------------------------------------------------------
 * Contrôle : zones sûres, chevauchements, taille des textes, temps de lecture
 * ------------------------------------------------------------------------ */

async function qa(pg, info, duration) {
  const dt = 0.1;
  const samples = [];
  for (let t = 0; t <= duration + 1e-6; t += dt) {
    const a = await pg.page.evaluate((t) => window.__mm.qa(t), t);
    const b = await pg.page.evaluate((t) => window.__mm.qa(t), t + 0.06);
    const bm = new Map(b.map((x) => [x.id, x]));
    samples.push({
      t,
      items: a.map((x) => {
        const y = bm.get(x.id);
        // Lisible si l'élément bouge à moins de ~50 px/s (~170 px/s pour un texte
        // de bande-annonce qui glisse ou se resserre lentement).
        const tol = x.mouvant ? 10 : 3;
        const stable = !!y && Math.abs(y.x - x.x) < tol && Math.abs(y.y - x.y) < tol && Math.abs(y.w - x.w) < tol;
        return { ...x, stable };
      }),
    });
  }
  const S = info.safe;
  const issues = new Map();
  const note = (key, t, msg) => {
    const it = issues.get(key) || { msg, t0: t, t1: t };
    it.t1 = t;
    issues.set(key, it);
  };
  const visible = new Map();
  const tol = 3;
  for (const s of samples) {
    const txt = s.items.filter((x) => x.stable && x.kind !== 'deco');
    for (const x of txt) {
      visible.set(x.id, { ...(visible.get(x.id) || { d: 0 }), label: x.label, kind: x.kind, d: (visible.get(x.id)?.d || 0) + dt });
      if (x.kind === 'flocage') continue;
      const out = [];
      if (x.x < S.x - tol) out.push(`à gauche de ${Math.round(S.x - x.x)} px`);
      if (x.x + x.w > S.r + tol) out.push(`à droite de ${Math.round(x.x + x.w - S.r)} px`);
      if (x.y < S.y - tol) out.push(`en haut de ${Math.round(S.y - x.y)} px`);
      if (x.y + x.h > S.b + tol) out.push(`en bas de ${Math.round(x.y + x.h - S.b)} px`);
      if (out.length) note(`zone:${x.id}`, s.t, `hors zone sûre : « ${x.label} » dépasse ${out.join(', ')}`);
      if (x.font < info.minFont && x.kind !== 'logo') note(`font:${x.id}`, s.t, `texte trop petit : « ${x.label} » (${Math.round(x.font)} px, minimum ${Math.round(info.minFont)} px)`);
      if (x.overflow) note(`over:${x.id}`, s.t, `texte coupé : « ${x.label} »`);
    }
    for (let i = 0; i < txt.length; i++)
      for (let j = i + 1; j < txt.length; j++) {
        const a = txt[i];
        const b = txt[j];
        if (a.kind === 'flocage' || b.kind === 'flocage') continue;
        const ix = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
        const iy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
        if (ix > 2 && iy > 2 && ix * iy > 0.04 * Math.min(a.w * a.h, b.w * b.h)) note(`ov:${a.id}:${b.id}`, s.t, `chevauchement : « ${a.label} » et « ${b.label} »`);
      }
  }
  for (const [id, v] of visible) {
    if (v.kind === 'flocage' || v.kind === 'logo') continue;
    const words = v.label.split(/\s+/).filter(Boolean).length;
    const need = Math.min(2.2, 0.3 + words * 0.2);
    if (v.d + 1e-6 < need) note(`read:${id}`, 0, `lecture trop courte : « ${v.label} » reste lisible ${v.d.toFixed(1)} s (il faut ~${need.toFixed(1)} s)`);
  }
  return [...issues.values()].map((i) => (i.t0 === 0 && i.t1 === 0 ? i.msg : `${i.msg} (${i.t0.toFixed(1)}–${i.t1.toFixed(1)} s)`));
}

/* --------------------------------------------------------------------------
 * Planche contact et images fixes
 * ------------------------------------------------------------------------ */

async function contactSheet(pg, info, duration, file) {
  const beat = 60 / info.bpm;
  const times = [];
  for (let t = 0; t < duration - 1e-6; t += beat) times.push(+(t + Math.min(0.12, beat * 0.25)).toFixed(3));
  times.push(+(duration - 0.02).toFixed(3));
  const thumbW = info.W > info.H ? 384 : 216;
  const sc = thumbW / info.W;
  const imgs = [];
  for (const t of times) imgs.push({ t, b64: (await capture(pg, t, sc)).toString('base64') });
  const cols = info.W > info.H ? 4 : 8;
  const sheet = await browser.newPage({ viewport: { width: cols * (thumbW + 8) + 8, height: 200 } });
  await sheet.setContent(`<body style="margin:0;padding:8px;background:#16171a;font:600 13px system-ui;color:#ccc;display:grid;grid-template-columns:repeat(${cols},${thumbW}px);gap:8px">
${imgs.map((i) => `<div><img style="display:block;width:${thumbW}px" src="data:image/png;base64,${i.b64}"><div style="padding:3px 0">${i.t.toFixed(2)} s · temps ${(i.t / beat).toFixed(1)}</div></div>`).join('')}</body>`);
  await sheet.screenshot({ path: file, fullPage: true });
  await sheet.close();
}

/* --------------------------------------------------------------------------
 * Vidéo : plusieurs pages en parallèle, chacune encode un segment.
 * ------------------------------------------------------------------------ */

function ffmpegSegment(file, W, H) {
  const vf = [];
  if (sub > 1) vf.push(`tmix=frames=${sub}:weights='${Array(sub).fill(1).join(' ')}'`, `select='eq(mod(n\\,${sub})\\,${sub - 1})'`, `setpts=N/(${fps}*TB)`);
  vf.push('scale=out_color_matrix=bt709:out_range=tv', 'format=yuv420p');
  const p = spawn(
    'ffmpeg',
    ['-loglevel', 'error', '-y', '-f', 'image2pipe', '-c:v', 'mjpeg', '-framerate', String(fps * sub), '-i', '-',
      '-vf', vf.join(','), '-r', String(fps), '-c:v', 'libx264', '-preset', draft ? 'veryfast' : 'medium', '-crf', draft ? '23' : '17',
      '-profile:v', 'high', '-maxrate', draft ? '6M' : '16M', '-bufsize', draft ? '12M' : '32M', '-pix_fmt', 'yuv420p', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv',
      '-g', String(fps * 2), file],
    { stdio: ['pipe', 'inherit', 'inherit'] },
  );
  const done = new Promise((res, rej) => p.on('close', (c) => (c === 0 ? res() : rej(new Error('ffmpeg a échoué (' + c + ')')))));
  return { stdin: p.stdin, done };
}

async function renderVideo(fmt, duration, file) {
  const frames = Math.round(duration * fps);
  const n = Math.min(workers, Math.max(1, Math.floor(frames / 30)));
  const per = Math.ceil(frames / n);
  const t0 = Date.now();
  let doneFrames = 0;
  const segs = [];
  await Promise.all(
    Array.from({ length: n }, async (_, w) => {
      const a = w * per;
      const b = Math.min(frames, a + per);
      if (a >= b) return;
      const seg = join(tmp, `${fmt.replace(':', 'x')}-seg${w}.mp4`);
      segs[w] = seg;
      const pg = await openPage(fmt);
      const ff = ffmpegSegment(seg, pg.W * scale, pg.H * scale);
      for (let f = a; f < b; f++) {
        for (let k = 0; k < sub; k++) {
          // Obturateur à 180° : les sous-images couvrent la moitié de l'intervalle.
          const t = f / fps + (sub > 1 ? ((k + 0.5) / sub - 0.5) * (0.5 / fps) : 0);
          const buf = await capture(pg, Math.max(0, t), scale, 'jpeg');
          if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
        }
        doneFrames++;
        if (doneFrames % 15 === 0) process.stdout.write(`\r  ${fmt} : ${Math.round((doneFrames / frames) * 100)} %   `);
      }
      ff.stdin.end();
      await ff.done;
      await pg.page.close();
    }),
  );
  const list = join(tmp, `${fmt.replace(':', 'x')}-list.txt`);
  writeFileSync(list, segs.filter(Boolean).map((s) => `file '${s}'`).join('\n'));
  const r = spawnSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', file]);
  if (r.status !== 0) fail('Assemblage des segments impossible :\n' + r.stderr);
  process.stdout.write(`\r  ${fmt} : images rendues en ${((Date.now() - t0) / 1000).toFixed(0)} s\n`);
}

/* --------------------------------------------------------------------------
 * Son
 * ------------------------------------------------------------------------ */

function renderAudio(info, duration, cues, file) {
  const cueFile = join(tmp, 'cues.json');
  writeFileSync(cueFile, JSON.stringify({ duree: duration, bpm: info.bpm, temps_fort: info.temps_fort, cues }, null, 1));
  const a = [audioPy, 'mix', cueFile, '--sortie', file];
  if (music) a.push('--musique', music.file, '--debut', String(music.start), '--gain-musique', String(spec.musique.volume ?? 0.8));
  else if (args['sans-musique'] || spec.musique === false || (spec.musique && spec.musique.fond === 'aucun')) a.push('--fond', 'aucun');
  else a.push('--fond', info.ambiance === 'cinema' ? 'cinema' : 'synthe');
  const r = spawnSync(PY, a, { encoding: 'utf8' });
  if (r.status !== 0) fail('Création du son impossible :\n' + r.stderr);
}

// Normalisation en deux passes, linéaire : un seul gain pour tout le film,
// qui garde les contrastes (le silence avant un impact reste un silence).
function loudnormFilter(audio) {
  const target = 'I=-14:TP=-1.5:LRA=20';
  const r = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', audio, '-af', `loudnorm=${target}:print_format=json`, '-f', 'null', '-'], { encoding: 'utf8' });
  const m = /\{[\s\S]*\}/.exec(r.stderr || '');
  // Limiteur de sécurité ensuite : crête ≤ −2,5 dBFS avant l'encodage AAC, qui déborde d'environ 1 dB.
  if (!m) return `loudnorm=${target},alimiter=limit=0.75:level=false`;
  const j = JSON.parse(m[0]);
  return `loudnorm=${target}:measured_I=${j.input_i}:measured_TP=${j.input_tp}:measured_LRA=${j.input_lra}:measured_thresh=${j.input_thresh}:offset=${j.target_offset}:linear=true,alimiter=limit=0.75:level=false`;
}

function mux(video, audio, file) {
  const a = ['-loglevel', 'error', '-y', '-i', video];
  if (audio) a.push('-i', audio, '-map', '0:v', '-map', '1:a', '-af', loudnormFilter(audio), '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-shortest');
  a.push('-c:v', 'copy', '-movflags', '+faststart', file);
  const r = spawnSync('ffmpeg', a, { encoding: 'utf8' });
  if (r.status !== 0) fail('Assemblage image et son impossible :\n' + r.stderr);
}

function probe(file) {
  const r = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration,size:stream=codec_type,codec_name,width,height,r_frame_rate', '-of', 'json', file], { encoding: 'utf8' });
  const j = JSON.parse(r.stdout);
  const v = j.streams.find((s) => s.codec_type === 'video');
  const au = j.streams.find((s) => s.codec_type === 'audio');
  let lufs = null;
  if (au) {
    const e = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-af', 'ebur128', '-f', 'null', '-'], { encoding: 'utf8' });
    const m = /I:\s+(-?[\d.]+) LUFS/.exec(e.stderr.split('Summary:').pop() || '');
    lufs = m ? +m[1] : null;
  }
  return { w: v.width, h: v.height, fps: v.r_frame_rate, dur: +(+j.format.duration).toFixed(2), mo: (+j.format.size / 1e6).toFixed(1), audio: !!au, lufs };
}

/* --------------------------------------------------------------------------
 * Déroulé
 * ------------------------------------------------------------------------ */

warnings.forEach((w) => log('ℹ ' + w));
const results = [];
let failedQa = 0;
for (const fmt of formats) {
  const tag = fmt.replace(':', 'x');
  const pg = await openPage(fmt);
  const { duration, cues, info } = await pg.page.evaluate(() => ({ duration: window.__mm.duration, cues: window.__mm.cues, info: window.__mm.info }));
  log(`\n▶ ${modele} · ${fmt} · ${duration.toFixed(2)} s · ${info.bpm.toFixed(1)} BPM`);

  const issues = await qa(pg, info, duration);
  if (issues.length) {
    failedQa += issues.length;
    log(`  ⚠ contrôle : ${issues.length} problème(s)`);
    issues.forEach((i) => log('    - ' + i));
  } else log('  ✓ contrôle : textes dans les zones sûres, lisibles, sans chevauchement');
  if (args.controle) {
    await pg.page.close();
    continue;
  }

  if (args.images) {
    for (const t of String(args.images).split(',').map(Number)) {
      const f = join(outDir, `${slug}-${tag}-${t.toFixed(2)}s.png`);
      writeFileSync(f, await capture(pg, t, 1));
      log('  image : ' + f);
    }
    await pg.page.close();
    continue;
  }

  const sheet = join(outDir, `${slug}-${tag}-planche.png`);
  await contactSheet(pg, info, duration, sheet);
  log('  planche : ' + sheet);
  await pg.page.close();
  if (args.planche) continue;

  const final = join(outDir, `${slug}-${tag}${draft ? '-brouillon' : ''}.mp4`);
  const silent = join(tmp, `${tag}-image.mp4`);
  if (args['son-seulement']) {
    // Refait seulement le son : l'image est reprise telle quelle du MP4 existant.
    if (!existsSync(final)) fail(`--son-seulement : ${final} n'existe pas encore, fais d'abord le rendu complet.`);
    spawnSync('ffmpeg', ['-loglevel', 'error', '-y', '-i', final, '-map', '0:v', '-c', 'copy', silent]);
  } else await renderVideo(fmt, duration, silent);
  let audio = null;
  if (!args['sans-son']) {
    audio = join(tmp, 'audio.wav');
    if (!existsSync(audio) || results.length === 0) renderAudio(info, duration, cues, audio);
  }
  mux(silent, audio, final);
  const p = probe(final);
  // Planche tirée du MP4 final (deux images par seconde) : vérifie le fichier réellement encodé.
  const board = join(outDir, `${slug}-${tag}${draft ? '-brouillon' : ''}-video.png`);
  const portrait = p.h > p.w;
  const cols = portrait ? 8 : 4;
  const rows = Math.ceil((p.dur * 2) / cols);
  spawnSync('ffmpeg', ['-loglevel', 'error', '-y', '-i', final, '-vf', `fps=2,scale=${portrait ? 216 : 384}:-2,tile=${cols}x${rows}:padding=6:color=0x16171a`, '-frames:v', '1', board]);
  results.push({ fmt, file: final, board, ...p });
  log(`  ✓ ${final}`);
  log(`    planche de la vidéo : ${board}`);
  log(`    ${p.w}×${p.h} · ${p.fps.replace('/1', '')} i/s · ${p.dur} s · ${p.mo} Mo${p.audio ? ` · son ${p.lufs} LUFS` : ' · sans son'}`);
}

await browser.close();
if (!args.garder) rmSync(tmp, { recursive: true, force: true });
if (results.length) {
  log('\nRésumé');
  for (const r of results) log(`  ${r.fmt.padEnd(5)} ${r.file}  (${r.dur} s, ${r.mo} Mo${r.lufs != null ? ', ' + r.lufs + ' LUFS' : ''})`);
}
if (failedQa) log(`\n⚠ ${failedQa} point(s) de contrôle à corriger avant publication.`);
