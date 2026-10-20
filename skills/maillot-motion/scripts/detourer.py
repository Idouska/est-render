#!/usr/bin/env python3
"""Détoure une photo produit prise sur fond blanc (ou uni clair) : PNG à fond transparent.

    python3 detourer.py photo.jpg [photo2.jpg …] [--sortie dossier] [--seuil 22] [--marge 0.04] [--ombre]

Le fond est la zone presque blanche reliée aux bords de l'image (remplissage
depuis le pourtour). Un blanc à l'intérieur du produit, comme une bande, un
logo ou un col, n'est donc pas touché tant qu'il ne communique pas avec le
fond. Le contour est adouci sur 1 à 2 px, puis l'image est recadrée au plus près
du produit, avec une petite marge.

--ombre retire aussi l'ombre portée grise sous le produit : les gris neutres et
clairs reliés au fond. Les couleurs, même pâles comme un liseré crème, sont
conservées. Ne l'utilise pas sur un maillot blanc ou gris.

Limite : un maillot blanc dont le bord se confond avec le fond peut perdre une
partie de son contour. Regarde toujours le résultat, avec le modèle --images ou
en ouvrant le PNG, avant de l'utiliser.
Dépendances : numpy, Pillow.
"""

import argparse
import os
import sys
from collections import deque

import numpy as np
from PIL import Image, ImageFilter


def background_mask(rgb, seuil, ombre=False):
    """Masque du fond : pixels proches de la couleur des bords, reliés au pourtour."""
    h, w, _ = rgb.shape
    border = np.concatenate([rgb[0], rgb[-1], rgb[:, 0], rgb[:, -1]]).astype(np.int32)
    ref = np.median(border, axis=0)
    dist = np.abs(rgb.astype(np.int32) - ref).max(axis=2)
    near = dist <= seuil
    if ombre:
        c = rgb.astype(np.int32)
        chroma = c.max(axis=2) - c.min(axis=2)
        near |= (chroma <= 10) & (c.mean(axis=2) >= 140)
    seen = np.zeros((h, w), dtype=bool)
    q = deque()
    for x in range(w):
        for y in (0, h - 1):
            if near[y, x] and not seen[y, x]:
                seen[y, x] = True
                q.append((y, x))
    for y in range(h):
        for x in (0, w - 1):
            if near[y, x] and not seen[y, x]:
                seen[y, x] = True
                q.append((y, x))
    while q:
        y, x = q.popleft()
        for ny, nx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
            if 0 <= ny < h and 0 <= nx < w and near[ny, nx] and not seen[ny, nx]:
                seen[ny, nx] = True
                q.append((ny, nx))
    return seen, ref


def detourer(path, out_dir, seuil, marge, ombre=False):
    im = Image.open(path).convert('RGB')
    # Travaille au plus à 1600 px : suffisant pour une vidéo, et rapide.
    im.thumbnail((1600, 1600))
    rgb = np.asarray(im)
    bg, ref = background_mask(rgb, seuil, ombre)
    if bg.mean() < 0.05:
        print(f'⚠ {path} : presque aucun fond uni détecté, image laissée telle quelle', file=sys.stderr)
    alpha = Image.fromarray(np.where(bg, 0, 255).astype(np.uint8))
    # Bord adouci : léger rétrécissement, puis flou.
    alpha = alpha.filter(ImageFilter.MinFilter(3)).filter(ImageFilter.GaussianBlur(1.1))
    # Décontamination : retire le reflet blanc du fond sur le contour.
    a = np.asarray(alpha).astype(np.float32) / 255
    c = rgb.astype(np.float32)
    edge = (a > 0.02) & (a < 0.98)
    c[edge] = np.clip((c[edge] - ref * (1 - a[edge, None])) / np.maximum(a[edge, None], 0.05), 0, 255)
    out = Image.fromarray(np.dstack([c.astype(np.uint8), (a * 255).astype(np.uint8)]), 'RGBA')
    box = out.getchannel('A').point(lambda v: 255 if v > 8 else 0).getbbox()
    if box:
        m = int(max(box[2] - box[0], box[3] - box[1]) * marge)
        box = (max(0, box[0] - m), max(0, box[1] - m), min(out.width, box[2] + m), min(out.height, box[3] + m))
        out = out.crop(box)
    name = os.path.splitext(os.path.basename(path))[0] + '-detoure.png'
    dest = os.path.join(out_dir or os.path.dirname(path) or '.', name)
    out.save(dest, optimize=True)
    print(f'✓ {dest} ({out.width}×{out.height}, fond retiré : {bg.mean() * 100:.0f} %)')
    return dest


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('images', nargs='+')
    ap.add_argument('--sortie', help='dossier de sortie (défaut : à côté de chaque image)')
    ap.add_argument('--seuil', type=int, default=22, help='écart toléré avec la couleur du fond (0-255)')
    ap.add_argument('--marge', type=float, default=0.04, help='marge autour du produit (fraction)')
    ap.add_argument('--ombre', action='store_true', help="retire aussi l'ombre portée grise (pas pour un maillot blanc)")
    a = ap.parse_args()
    if a.sortie:
        os.makedirs(a.sortie, exist_ok=True)
    for p in a.images:
        detourer(p, a.sortie, a.seuil, a.marge, a.ombre)


if __name__ == '__main__':
    main()
