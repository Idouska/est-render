#!/usr/bin/env python3
"""Son de maillot-motion : bruitages synthétisés, fond rythmique, analyse de tempo.

    python3 audio.py analyse musique.mp3 [--debut 12.5]
        Mesure le tempo et le premier temps fort d'une musique. Affiche du JSON :
        {"bpm": 124.0, "start": 12.58, ...} ; « start » est le premier début de
        mesure à partir de --debut, là où la vidéo doit commencer.

    python3 audio.py mix cues.json --sortie son.wav [--fond synthe|aucun]
                     [--musique f.mp3 --debut 12.58 --gain-musique 0.8]
        Fabrique la piste son : chaque bruitage est placé pour que SON PIC tombe
        exactement sur l'instant demandé (le temps musical), puis mélangé au
        fond (musique fournie, fond synthétique de maquette, ou rien).

    python3 audio.py catalogue --sortie essai.wav
        Joue tous les bruitages à la suite, pour les écouter.

Aucun échantillon : tout est synthétisé, donc libre de droits.
Dépendances : numpy, ffmpeg (lecture des musiques).
"""

import argparse
import json
import subprocess
import sys
import wave

import numpy as np

SR = 48000


# ---------------------------------------------------------------------------
# Outils
# ---------------------------------------------------------------------------

def secs(n):
    return int(round(n * SR))


def tvec(dur):
    return np.arange(secs(dur)) / SR


def noise(dur, seed):
    return np.random.default_rng(seed).standard_normal(secs(dur))


def fft_filter(x, lo=None, hi=None):
    """Filtre passe-bande statique, dans le domaine fréquentiel (pente douce)."""
    n = len(x)
    X = np.fft.rfft(x)
    f = np.fft.rfftfreq(n, 1 / SR)
    g = np.ones_like(f)
    if lo:
        g *= 1 / (1 + (lo / np.maximum(f, 1)) ** 4)
    if hi:
        g *= 1 / (1 + (f / hi) ** 4)
    return np.fft.irfft(X * g, n)


def sweep_filter(x, centers, q=1.2):
    """Passe-bande dont la fréquence centrale suit `centers(k)` (k ∈ [0, 1])."""
    n_fft, hop = 1024, 256
    win = np.hanning(n_fft)
    pad = np.concatenate([np.zeros(n_fft), x, np.zeros(n_fft)])
    out = np.zeros_like(pad)
    norm = np.zeros_like(pad)
    f = np.fft.rfftfreq(n_fft, 1 / SR)
    frames = (len(pad) - n_fft) // hop
    for i in range(frames):
        a = i * hop
        seg = pad[a:a + n_fft] * win
        fc = centers(min(1.0, max(0.0, (a - n_fft) / max(1, len(x)))))
        bw = fc / q
        g = np.exp(-0.5 * ((f - fc) / bw) ** 2)
        out[a:a + n_fft] += np.fft.irfft(np.fft.rfft(seg) * g, n_fft) * win
        norm[a:a + n_fft] += win ** 2
    out /= np.maximum(norm, 1e-6)
    return out[n_fft:n_fft + len(x)]


def chirp(f0, f1, dur, curve=3.0):
    t = tvec(dur)
    k = t / dur
    f = f1 + (f0 - f1) * np.exp(-curve * k) if f0 > f1 else f0 + (f1 - f0) * k ** 2
    return np.sin(2 * np.pi * np.cumsum(f) / SR)


def env_exp(dur, tau, attack=0.002):
    t = tvec(dur)
    a = np.clip(t / max(attack, 1e-4), 0, 1)
    return a * np.exp(-t / tau)


def stereo(x, pan=0.0, width=0.0, seed=0):
    """pan ∈ [-1, 1] ; width ajoute un léger décalage entre les canaux."""
    l = np.cos((pan + 1) * np.pi / 4)
    r = np.sin((pan + 1) * np.pi / 4)
    if width:
        d = int(width * 0.0006 * SR)
        y = np.concatenate([np.zeros(d), x])[:len(x)]
        return np.stack([x * l, y * r], 1)
    return np.stack([x * l, x * r], 1)


def semis(p):
    return 2 ** (p / 12)


def normalize(x, peak=0.9):
    m = np.max(np.abs(x)) or 1
    return x * (peak / m)


# ---------------------------------------------------------------------------
# Bruitages. Chacun rend un tableau stéréo ; le pic est mesuré ensuite.
# ---------------------------------------------------------------------------

def s_impact(p, seed):
    d = 0.7
    sub = chirp(70 * semis(p), 38, d, 6) * env_exp(d, 0.22, 0.003)
    body = fft_filter(noise(d, seed), 60, 2200) * env_exp(d, 0.05, 0.001) * 0.6
    click = fft_filter(noise(d, seed + 1), 2000, 9000) * env_exp(d, 0.006, 0.0005) * 0.35
    return stereo(normalize(sub * 1.0 + body + click, 0.95), 0, 0.5)


def s_boom(p, seed):
    d = 2.2
    sub = chirp(62 * semis(p), 30, d, 3.5) * env_exp(d, 0.5, 0.004)
    body = fft_filter(noise(d, seed), 40, 1800) * env_exp(d, 0.12, 0.002) * 0.7
    crash = fft_filter(noise(d, seed + 2), 3500, 14000) * env_exp(d, 0.55, 0.003) * 0.16
    x = normalize(sub + body, 0.95) + crash
    return np.stack([x, np.concatenate([np.zeros(30), x])[:len(x)]], 1)


def s_whoosh(p, seed, d=0.6):
    n = noise(d, seed)
    x = sweep_filter(n, lambda k: 350 + 3200 * k ** 1.6 * semis(p), q=1.6)
    t = tvec(d) / d
    shape = np.sin(np.pi * np.clip(t, 0, 1) ** 1.5) ** 2  # crête aux deux tiers
    x = normalize(x * shape, 0.8)
    pan = np.linspace(-0.7, 0.7, len(x))
    l = np.cos((pan + 1) * np.pi / 4)
    r = np.sin((pan + 1) * np.pi / 4)
    return np.stack([x * l, x * r], 1)


def s_swipe(p, seed):
    return s_whoosh(p + 5, seed, 0.28) * 0.8


def s_montee(p, seed, d=1.6):
    n = noise(d, seed)
    x = sweep_filter(n, lambda k: 400 + 7000 * k ** 2, q=2.5) * 0.7
    tone = chirp(180 * semis(p), 900 * semis(p), d) * 0.18
    t = tvec(d) / d
    shape = t ** 2.2
    x = (x + tone) * shape
    x[-secs(0.01):] *= np.linspace(1, 0, secs(0.01))  # coupe nette au sommet
    return stereo(normalize(x, 0.7), 0, 0.8)


def s_tic(p, seed):
    d = 0.06
    t = tvec(d)
    tone = np.sin(2 * np.pi * 2300 * semis(p) * t) * env_exp(d, 0.012, 0.0004)
    click = fft_filter(noise(d, seed), 3000, 12000) * env_exp(d, 0.002, 0.0002) * 0.5
    return stereo(normalize(tone + click, 0.55), 0.1)


def s_pop(p, seed):
    d = 0.14
    x = chirp(420 * semis(p), 1150 * semis(p), d) * env_exp(d, 0.035, 0.001)
    return stereo(normalize(x, 0.6), -0.1)


def s_clic(p, seed):
    d = 0.16
    x = np.zeros(secs(d))
    for at, k in ((0.0, 1.0), (0.065, 0.55)):
        burst = fft_filter(noise(0.03, seed + int(at * 100)), 1500, 8000) * env_exp(0.03, 0.004, 0.0003)
        thunk = np.sin(2 * np.pi * 140 * tvec(0.03)) * env_exp(0.03, 0.01, 0.0005) * 0.8
        a = secs(at)
        x[a:a + len(burst)] += (burst + thunk) * k
    return stereo(normalize(x, 0.7))


def s_tampon(p, seed):
    d = 0.3
    thud = chirp(150 * semis(p), 85, d, 8) * env_exp(d, 0.06, 0.001)
    knock = fft_filter(noise(d, seed), 120, 1600) * env_exp(d, 0.025, 0.0008) * 0.8
    cloth = fft_filter(noise(d, seed + 3), 3000, 11000) * env_exp(d, 0.012, 0.0005) * 0.25
    return stereo(normalize(thud + knock + cloth, 0.85), (seed % 5 - 2) * 0.12)


def s_caisse(p, seed):
    d = 1.3
    t = tvec(d)
    f0 = 1318.5 * semis(p)
    x = np.zeros_like(t)
    for ratio, amp, tau in ((1.0, 1.0, 0.45), (1.5, 0.6, 0.35), (2.76, 0.18, 0.12), (4.0, 0.08, 0.08)):
        x += amp * np.sin(2 * np.pi * f0 * ratio * t) * np.exp(-t / tau)
    x *= np.clip(t / 0.002, 0, 1)
    x += np.concatenate([s_tic(p + 7, seed)[:, 0], np.zeros(len(t))])[:len(t)] * 0.5
    return stereo(normalize(x, 0.55), 0, 0.6)


def s_brillance(p, seed):
    d = 0.75
    rng = np.random.default_rng(seed)
    x = np.zeros((secs(d), 2))
    notes = [0, 3, 5, 7, 10, 12, 15]
    for i in range(7):
        at = i * 0.045 + rng.uniform(0, 0.015)
        f = 2637 * semis(notes[rng.integers(len(notes))] + p)
        dd = 0.3
        tone = np.sin(2 * np.pi * f * tvec(dd)) * env_exp(dd, 0.07, 0.001) * (1 - i * 0.1)
        a = secs(at)
        x[a:a + len(tone)] += stereo(tone, rng.uniform(-0.8, 0.8))
    return normalize(x, 0.35)


# --- Sons de bande-annonce (modèle « match ») -------------------------------

def s_coeur(p, seed):
    """Battement de cœur : deux coups sourds (« boum-boum »)."""
    d = 0.7
    x = np.zeros(secs(d))
    for at, g in ((0.0, 1.0), (0.2, 0.7)):
        thump = chirp(70 * semis(p), 38, 0.25, 6) * env_exp(0.25, 0.06, 0.004)
        a = secs(at)
        x[a:a + len(thump)] += thump * g
    return stereo(normalize(fft_filter(x, None, 180), 0.95))


def s_projecteur(p, seed):
    """Projecteur de stade qui s'allume : déclic lourd, puis bourdonnement électrique."""
    d = 2.4
    t = tvec(d)
    clunk = chirp(110 * semis(p), 50, d, 12) * env_exp(d, 0.05, 0.001)
    metal = fft_filter(noise(d, seed), 1800, 9000) * env_exp(d, 0.015, 0.0005) * 0.5
    hum = sum(np.sin(2 * np.pi * 100 * k * t) / k for k in (1, 2, 3, 5)) * 0.05
    hum *= np.clip((t - 0.05) / 0.2, 0, 1) * np.exp(-t / 1.6)
    return stereo(normalize(clunk + metal, 0.9) + hum, 0, 0.6)


def s_braam(p, seed):
    """Cuivres graves de bande-annonce : scies désaccordées, filtre qui s'ouvre puis se referme."""
    d = 2.6
    t = tvec(d)
    f0 = 55 * semis(p)
    x = np.zeros_like(t)
    for f, g in ((f0, 1), (f0 * 1.007, 0.9), (f0 * 0.994, 0.9), (f0 * 1.5, 0.45), (f0 * 2, 0.3)):
        ph = (f * t + np.random.default_rng(seed).uniform()) % 1
        x += g * (2 * ph - 1)
    x += np.sin(2 * np.pi * f0 / 2 * t) * 0.8
    n_fft, hop = 2048, 512
    out = np.zeros(len(x) + n_fft)
    win = np.hanning(n_fft)
    fr = np.fft.rfftfreq(n_fft, 1 / SR)
    for i in range(0, len(x) - n_fft, hop):
        k = i / len(x)
        cut = 180 + 2600 * (np.sin(np.pi * min(1, k * 2.2)) ** 2) * (1 - k) ** 0.5
        g = 1 / (1 + (fr / cut) ** 6)
        out[i:i + n_fft] += np.fft.irfft(np.fft.rfft(x[i:i + n_fft] * win) * g, n_fft) * win
    out = out[:len(x)] / 1.5
    envl = np.clip(t / 0.06, 0, 1) * np.exp(-np.maximum(0, t - 0.6) / 0.9)
    return stereo(normalize(np.tanh(out * envl * 2.2), 0.95), 0, 0.9)


def s_sifflet(p, seed):
    """Coup de sifflet d'arbitre (sifflet à bille : son aigu roulé)."""
    d = 1.0
    t = tvec(d)
    trill = 1 + 0.025 * np.sin(2 * np.pi * 28 * t)
    x = np.sin(2 * np.pi * np.cumsum(2950 * semis(p) * trill) / SR)
    x += 0.25 * np.sin(2 * np.pi * np.cumsum(5900 * semis(p) * trill) / SR)
    x += fft_filter(noise(d, seed), 2500, 6000) * 0.15
    envl = np.clip(t / 0.02, 0, 1) * np.clip((0.85 - t) / 0.12, 0, 1) * (0.8 + 0.2 * np.sin(2 * np.pi * 28 * t))
    return stereo(normalize(x * envl, 0.6))


def s_foule(p, seed, d=4.5):
    """Clameur de stade : bruit filtré en voyelles, qui monte, culmine, puis retombe."""
    t = tvec(d)
    rng = np.random.default_rng(seed)
    x = np.zeros_like(t)
    for fc, bw in ((420, 1.4), (750, 1.6), (1250, 1.8), (2500, 2.2)):
        band = sweep_filter(noise(d, int(rng.integers(1e6))), lambda k, fc=fc: fc * (1 + 0.15 * k), q=bw)
        mod = 0.7 + 0.3 * np.sin(2 * np.pi * rng.uniform(0.3, 0.9) * t + rng.uniform(0, 6))
        x += band * mod
    shape = np.clip(t / 1.6, 0, 1) ** 1.5 * np.clip((d - t) / 1.8, 0, 1)
    x = normalize(x * shape, 0.75)
    return np.stack([x, np.concatenate([np.zeros(240), x])[:len(x)]], 1)


def s_tambour(p, seed):
    """Tambour grave (taiko) : peau tendue et grosse résonance."""
    d = 0.9
    body = chirp(95 * semis(p), 48, d, 7) * env_exp(d, 0.18, 0.002)
    skin = fft_filter(noise(d, seed), 150, 2500) * env_exp(d, 0.03, 0.001) * 0.6
    return stereo(normalize(body + skin, 0.95), (seed % 3 - 1) * 0.2)


def s_aspiration(p, seed):
    """Souffle inversé qui monte jusqu'à l'impact (pic à la fin)."""
    d = 1.0
    n = fft_filter(noise(d, seed), 300, 9000)
    t = tvec(d) / d
    x = n * t ** 3
    x[-secs(0.008):] *= np.linspace(1, 0, secs(0.008))
    return stereo(normalize(x, 0.7), 0, 0.8)


def s_eclat(p, seed):
    """Crépitement d'étincelles."""
    d = 0.6
    rng = np.random.default_rng(seed)
    x = np.zeros(secs(d))
    for _ in range(26):
        a = int(rng.uniform(0, 0.45) * SR)
        c = fft_filter(noise(0.01, int(rng.integers(1e6))), 3000, 14000) * env_exp(0.01, 0.0015, 0.0002)
        x[a:a + len(c)] += c * rng.uniform(0.2, 1) * (1 - a / len(x))
    return stereo(normalize(x, 0.4), 0, 0.7)


SOUNDS = {
    'impact': s_impact,
    'boom': s_boom,
    'whoosh': s_whoosh,
    'swipe': s_swipe,
    'montee': s_montee,
    'tic': s_tic,
    'pop': s_pop,
    'clic': s_clic,
    'tampon': s_tampon,
    'caisse': s_caisse,
    'brillance': s_brillance,
    'coeur': s_coeur,
    'projecteur': s_projecteur,
    'braam': s_braam,
    'sifflet': s_sifflet,
    'foule': s_foule,
    'tambour': s_tambour,
    'aspiration': s_aspiration,
    'eclat': s_eclat,
}


# Sons calés sur leur attaque plutôt que sur leur maximum (son tenu).
ANCRE_DEBUT = {'sifflet'}


def onset_index(x):
    """Attaque : premier instant où l'enveloppe atteint la moitié de son maximum."""
    m = np.abs(x).max(1) if x.ndim == 2 else np.abs(x)
    w = secs(0.01)
    e = np.convolve(m ** 2, np.ones(w) / w, mode='same')
    return int(np.argmax(e >= 0.5 * e.max()))


def peak_index(x):
    """Instant perçu du son : maximum de l'enveloppe RMS sur 10 ms."""
    m = np.abs(x).max(1) if x.ndim == 2 else np.abs(x)
    w = secs(0.01)
    e = np.convolve(m ** 2, np.ones(w) / w, mode='same')
    return int(np.argmax(e))


# ---------------------------------------------------------------------------
# Fond rythmique de maquette (à remplacer par une vraie musique sous licence)
# ---------------------------------------------------------------------------

def synth_bed(duration, bpm, temps_fort=None):
    beat = 60 / bpm
    n = secs(duration + 1.5)
    out = np.zeros((n, 2))
    bass = np.zeros((n, 2))
    sc = np.ones(n)  # compression de la basse, déclenchée par la grosse caisse
    drop = temps_fort if temps_fort is not None else 0.0

    def add(x, at, g=1.0, bus=None):
        bus = out if bus is None else bus
        a = secs(at)
        if a >= n:
            return
        b = min(n, a + len(x))
        if x.ndim == 1:
            x = stereo(x)
        bus[a:b] += x[:b - a] * g

    kick_d = 0.35
    kick = chirp(150, 45, kick_d, 9) * env_exp(kick_d, 0.11, 0.001)
    kick += fft_filter(noise(kick_d, 1), 1500, 6000) * env_exp(kick_d, 0.004, 0.0003) * 0.3
    kick = normalize(kick, 0.9)
    clap = fft_filter(noise(0.25, 2), 900, 6000)
    clap *= sum(env_exp(0.25, 0.012 if i < 2 else 0.07, 0.0005) * (np.arange(secs(0.25)) >= secs(i * 0.011)) for i in range(3))
    clap = normalize(clap, 0.5)
    hat = normalize(fft_filter(noise(0.08, 3), 7000, 16000) * env_exp(0.08, 0.018, 0.0003), 0.22)
    ohat = normalize(fft_filter(noise(0.4, 4), 6000, 16000) * env_exp(0.4, 0.12, 0.001), 0.16)
    crash = normalize(fft_filter(noise(2.0, 5), 3000, 15000) * env_exp(2.0, 0.6, 0.002), 0.3)

    roots = [55.0, 43.65, 65.41, 49.0]  # la, fa, do, sol (grave)
    k = 0
    t = 0.0
    while t < duration + 0.01:
        after = t >= drop - 1e-6
        bar_pos = k % 4
        if after or bar_pos in (0,):
            add(kick, t)
            a = secs(t)
            dk = secs(0.22)
            sc[a:a + dk] = np.minimum(sc[a:a + dk], 0.35 + 0.65 * np.linspace(0, 1, len(sc[a:a + dk])) ** 0.6)
        if after and bar_pos in (1, 3):
            add(clap, t)
        for h in (0, 0.5):
            add(hat, t + h * beat, 0.6 if h == 0 else 1.0)
        if after:
            add(ohat, t + 0.5 * beat)
            root = roots[(k // 4) % 4]
            if bar_pos in (0, 2):
                bd = beat * 1.9
                tone = np.sin(2 * np.pi * root * tvec(bd)) + 0.3 * np.sin(2 * np.pi * root * 2 * tvec(bd))
                tone *= np.clip(tvec(bd) / 0.02, 0, 1) * np.exp(-tvec(bd) / 0.9)
                add(tone * 0.5, t, bus=bass)
        k += 1
        t = k * beat
    if temps_fort is not None and temps_fort > 0:
        add(crash, temps_fort)
    return out + bass * sc[:, None]


def synth_cinema(duration, bpm, temps_fort=None):
    """Nappe de bande-annonce : accord grave (la-mi) qui enfle jusqu'au temps
    fort, un silence juste avant, puis tenu sous l'action. Les tambours, cuivres
    et impacts sont des bruitages placés par le modèle."""
    n = secs(duration + 1.5)
    t = np.arange(n) / SR
    rng = np.random.default_rng(5)
    x = np.zeros(n)
    for f, g in ((55, 1.0), (55.3, 0.8), (82.4, 0.6), (110, 0.35), (164.8, 0.2)):
        ph = (f * t + rng.uniform()) % 1
        x += g * (2 * ph - 1)
    x = fft_filter(x, 30, 700)
    x *= 0.85 + 0.15 * np.sin(2 * np.pi * 0.23 * t)
    tf = temps_fort if temps_fort else duration * 0.3
    env = np.clip(t / max(0.5, tf - 0.35), 0, 1) ** 1.6
    env = np.where(t > tf - 0.35, 0.04, env)  # le silence avant l'impact
    env = np.where(t >= tf, 0.55 + 0.1 * np.clip((t - tf) / 4, 0, 1), env)
    env *= np.clip((duration - t) / 1.2, 0, 1)
    smooth = secs(0.03)
    env = np.convolve(env, np.ones(smooth) / smooth, mode='same')
    y = normalize(x * env, 0.6)
    return np.stack([y, np.concatenate([np.zeros(180), y])[:n]], 1)


# ---------------------------------------------------------------------------
# Lecture et écriture
# ---------------------------------------------------------------------------

def read_audio(path, start=0.0, dur=None, sr=SR, mono=False):
    cmd = ['ffmpeg', '-v', 'error', '-ss', f'{max(0, start):.4f}', '-i', path]
    if dur:
        cmd += ['-t', f'{dur:.4f}']
    cmd += ['-f', 'f32le', '-ac', '1' if mono else '2', '-ar', str(sr), '-']
    raw = subprocess.run(cmd, capture_output=True, check=True).stdout
    x = np.frombuffer(raw, dtype=np.float32).astype(np.float64)
    return x if mono else x.reshape(-1, 2)


def write_wav(path, x):
    x = np.clip(x, -1, 1)
    pcm = (x * 32767).astype('<i2')
    with wave.open(path, 'wb') as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())


# ---------------------------------------------------------------------------
# Analyse du tempo
# ---------------------------------------------------------------------------

def analyse(path, debut=0.0):
    sr = 22050
    y = read_audio(path, 0, None, sr, mono=True)
    if len(y) < sr * 4:
        raise SystemExit('Musique trop courte pour être analysée.')
    n_fft, hop = 1024, 256
    fps = sr / hop
    lat = n_fft / 2 / sr + 0.012  # pic du flux spectral vs début réel de l'attaque (mesuré)
    win = np.hanning(n_fft)
    frames = 1 + (len(y) - n_fft) // hop
    idx = np.arange(n_fft)[None, :] + hop * np.arange(frames)[:, None]
    L = np.log1p(100 * np.abs(np.fft.rfft(y[idx] * win, axis=1)))
    d = np.maximum(0, np.diff(L, axis=0))
    f = np.fft.rfftfreq(n_fft, 1 / sr)
    g = np.exp(-0.5 * (np.arange(-4, 5) / 1.2) ** 2)

    def onset(x):
        x = np.concatenate([[0], x])
        x = np.maximum(x - np.convolve(x, np.ones(32) / 32, mode='same'), 0)
        x = np.convolve(x, g / g.sum(), mode='same')
        return x / (x.max() or 1)

    low = onset(d[:, f < 150].sum(1))
    # Les graves comptent plus : les charlestons à contretemps ne doivent pas
    # tirer la grille d'un demi-temps.
    env = onset(d.sum(1)) + 1.5 * low
    n = len(env)

    # Tempo : autocorrélation lue aux multiples de la période, pondérée
    # autour de 120 BPM pour trancher entre tempo, double et moitié.
    F = np.fft.rfft(env - env.mean(), 2 * n)
    ac = np.fft.irfft(F * np.conj(F))[:n]
    ac /= ac[0] or 1
    at = lambda lag: np.interp(lag, np.arange(n), ac)
    cands = np.arange(70, 180.01, 0.05)
    lags = 60 * fps / cands
    score = sum(at(k * lags) / k for k in (1, 2, 3, 4))
    prior = np.exp(-0.5 * (np.log2(cands / 120) / 0.6) ** 2)
    bpm = float(cands[int(np.argmax(score * prior))])
    period = 60 * fps / bpm

    def grid_score(ph, per):
        pos = np.arange(ph, n - 1, per)
        return np.interp(pos, np.arange(n), env).sum()

    phase = max(np.arange(0, period, 0.2), key=lambda ph: grid_score(ph, period))
    # Temps ou contretemps ? La grosse caisse tombe sur le temps.
    lows = lambda ph: np.interp(np.arange(ph, n - 1, period), np.arange(n), low).sum()
    if lows((phase + period / 2) % period) > 1.15 * lows(phase):
        phase = (phase + period / 2) % period

    # Affinage : attaque la plus forte près de chaque temps, puis droite des
    # moindres carrés (corrige la petite dérive du tempo).
    w = max(2, int(0.05 * fps))
    ks, ts = [], []
    for k, gpos in enumerate(np.arange(phase, n - 1, period)):
        a, b = int(round(gpos)) - w, int(round(gpos)) + w + 1
        if a < 0 or b > n:
            continue
        seg = env[a:b]
        if seg.max() > 0.3 * env.max():
            ks.append(k)
            ts.append(a + int(np.argmax(seg)))
    if len(ks) > 8:
        p, ph = np.polyfit(ks, ts, 1)
        if abs(p - period) / period < 0.02:
            period, phase = p, ph % p
            bpm = 60 * fps / period

    # Début de mesure : parmi les 4 temps, celui où les graves frappent le plus
    # et où l'harmonie change le plus (les accords changent en début de mesure).
    beats = np.arange(phase, n - 1, period)
    bi = beats.astype(int)
    H = L[:, f < 2000]
    change = np.zeros(len(bi))
    for i in range(1, len(bi) - 1):
        a, b = H[bi[i - 1]:bi[i]].mean(0), H[bi[i]:bi[i + 1]].mean(0)
        change[i] = 1 - np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b) + 1e-9)
    lowb = np.interp(beats, np.arange(n), low)
    norm = lambda v: v / (v.mean() or 1)
    bar_scores = [norm(lowb)[k::4].sum() + norm(change)[k::4].sum() for k in range(4)]
    down = int(np.argmax(bar_scores))
    bars = beats[down::4] / fps + lat
    after = bars[bars >= debut - 1e-3]
    start = float(after[0]) if len(after) else float(bars[-1])
    return {
        'bpm': round(float(bpm), 2),
        'start': round(start, 4),
        'premier_temps': round(float(beats[0] / fps + lat), 4),
        'duree_fichier': round(len(y) / sr, 2),
        'confiance': round(float(np.max(score * prior) / 4), 3),
    }


# ---------------------------------------------------------------------------
# Mixage
# ---------------------------------------------------------------------------

def mix(cue_file, out, fond='synthe', musique=None, debut=0.0, gain_musique=0.8):
    with open(cue_file) as fh:
        spec = json.load(fh)
    duration = float(spec['duree'])
    bpm = float(spec.get('bpm') or 120)
    n = secs(duration)
    sfx = np.zeros((n + secs(2), 2))
    for i, c in enumerate(spec['cues']):
        make = SOUNDS.get(c['type'])
        if not make:
            print(f"bruitage inconnu ignoré : {c['type']}", file=sys.stderr)
            continue
        x = make(float(c.get('pitch', 0)), 11 + i)
        a = secs(float(c['t'])) - (onset_index(x) if c['type'] in ANCRE_DEBUT else peak_index(x))
        if a < 0:
            x, a = x[-a:], 0
        b = min(len(sfx), a + len(x))
        sfx[a:b] += x[:b - a] * float(c.get('gain', 1))

    bed = None
    if musique:
        bed = read_audio(musique, debut, duration + 0.1)
        bed = bed * gain_musique
    elif fond == 'synthe':
        bed = synth_bed(duration, bpm, spec.get('temps_fort')) * 0.55
    elif fond == 'cinema':
        bed = synth_cinema(duration, bpm, spec.get('temps_fort')) * 0.7
    mixd = sfx[:n] * 0.85
    if bed is not None:
        m = np.zeros((n, 2))
        m[:min(n, len(bed))] = bed[:n]
        mixd = mixd + m
    # Fondu de sortie court, puis limitation douce.
    fade = secs(0.6)
    mixd[-fade:] *= np.linspace(1, 0, fade)[:, None] ** 1.5
    mixd[:secs(0.004)] *= np.linspace(0, 1, secs(0.004))[:, None]
    mixd = np.tanh(mixd * 1.1) / np.tanh(1.1)
    write_wav(out, normalize(mixd, 0.89))


def catalogue(out):
    parts = []
    for name, make in SOUNDS.items():
        parts.append(make(0, 3))
        parts.append(np.zeros((secs(0.35), 2)))
    write_wav(out, normalize(np.concatenate(parts), 0.9))
    print(', '.join(SOUNDS))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sp = ap.add_subparsers(dest='cmd', required=True)
    a = sp.add_parser('analyse')
    a.add_argument('musique')
    a.add_argument('--debut', type=float, default=0.0)
    m = sp.add_parser('mix')
    m.add_argument('cues')
    m.add_argument('--sortie', required=True)
    m.add_argument('--fond', default='synthe', choices=['synthe', 'cinema', 'aucun'])
    m.add_argument('--musique')
    m.add_argument('--debut', type=float, default=0.0)
    m.add_argument('--gain-musique', type=float, default=0.8)
    c = sp.add_parser('catalogue')
    c.add_argument('--sortie', required=True)
    args = ap.parse_args()
    if args.cmd == 'analyse':
        print(json.dumps(analyse(args.musique, args.debut)))
    elif args.cmd == 'mix':
        mix(args.cues, args.sortie, args.fond, args.musique, args.debut, args.gain_musique)
    else:
        catalogue(args.sortie)


if __name__ == '__main__':
    main()
