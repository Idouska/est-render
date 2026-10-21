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

--fermer rend au produit une grande zone blanche qui ne touche le fond que par
un passage étroit (3,5 % du petit côté par défaut), comme une bande blanche qui
longe le col. Un PNG déjà détouré peut être repris tel quel pour cette
réparation : seul son masque change, enregistré en <nom>-repare.png.

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
    return relie_au_bord(near), ref


def relie_au_bord(near):
    """Pixels de near reliés au pourtour de l'image (remplissage par 4-voisinage)."""
    h, w = near.shape
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
    return seen


def fermer(bg, px, aire=0.0015):
    """Rend au produit les poches blanches qui ne touchent le fond que par un passage
    étroit (moins de px de large) : une bande blanche qui longe le col, par exemple.

    Le vrai fond est ce qu'on atteint depuis les bords en gardant partout une
    largeur d'au moins px. Le reste du fond forme des poches : les grandes
    (plus de `aire` de l'image) sont rendues au produit ; les petites, comme la
    pointe d'une aisselle, restent du fond."""
    h, w = bg.shape
    if px is None:
        px = round(0.035 * min(h, w))  # ~24 px pour un maillot de 700 px
    if px <= 0:
        return bg
    k = px | 1
    m = Image.fromarray(np.where(bg, 255, 0).astype(np.uint8))
    coeur = relie_au_bord(np.asarray(m.filter(ImageFilter.MinFilter(k))) > 127)
    large = np.asarray(Image.fromarray((coeur * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(k))) > 127
    poches = bg & ~large
    seuil = aire * h * w
    vu = np.zeros_like(poches)
    rendre = np.zeros_like(poches)
    for y0, x0 in zip(*np.nonzero(poches)):
        if vu[y0, x0]:
            continue
        comp = [(y0, x0)]
        vu[y0, x0] = True
        q = deque(comp)
        while q:
            y, x = q.popleft()
            for ny, nx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
                if 0 <= ny < h and 0 <= nx < w and poches[ny, nx] and not vu[ny, nx]:
                    vu[ny, nx] = True
                    q.append((ny, nx))
                    comp.append((ny, nx))
        if len(comp) >= seuil:
            ys, xs = zip(*comp)
            rendre[ys, xs] = True
    return bg & ~rendre


def detourer(path, out_dir, seuil, marge, ombre=False, ferme=None):
    src = Image.open(path)
    # Travaille au plus à 1600 px : suffisant pour une vidéo, et rapide.
    src.thumbnail((1600, 1600))
    rgb = np.asarray(src.convert('RGB'))
    if src.mode == 'RGBA' and np.asarray(src.getchannel('A')).min() < 128:
        return reparer(path, src, out_dir, ferme)
    bg, ref = background_mask(rgb, seuil, ombre)
    bg = fermer(bg, ferme)
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


def reparer(path, src, out_dir, ferme):
    """PNG déjà détouré : seules les zones rendues par --fermer changent, le reste
    (contour, cadrage) est conservé tel quel."""
    a = np.asarray(src.getchannel('A')).astype(np.float32) / 255
    bg = a < 0.5
    trous = bg & ~fermer(bg, ferme)
    if not trous.any():
        print(f'✓ {path} : rien à réparer')
        return path
    rendu = np.asarray(Image.fromarray((trous * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.8))) / 255
    a = np.maximum(a, rendu)
    out = Image.fromarray(np.dstack([np.asarray(src.convert('RGB')), (a * 255).astype(np.uint8)]), 'RGBA')
    name = os.path.splitext(os.path.basename(path))[0] + '-repare.png'
    dest = os.path.join(out_dir or os.path.dirname(path) or '.', name)
    out.save(dest, optimize=True)
    print(f'✓ {dest} : {trous.sum()} px rendus au produit')
    return dest


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('images', nargs='+')
    ap.add_argument('--sortie', help='dossier de sortie (défaut : à côté de chaque image)')
    ap.add_argument('--seuil', type=int, default=22, help='écart toléré avec la couleur du fond (0-255)')
    ap.add_argument('--marge', type=float, default=0.04, help='marge autour du produit (fraction)')
    ap.add_argument('--ombre', action='store_true', help="retire aussi l'ombre portée grise (pas pour un maillot blanc)")
    ap.add_argument('--fermer', type=int, default=None, help='rend au produit les poches blanches reliées au fond par un passage plus étroit que ce nombre de px (défaut : 3,5 %% du petit côté ; 0 : non)')
    a = ap.parse_args()
    if a.sortie:
        os.makedirs(a.sortie, exist_ok=True)
    for p in a.images:
        detourer(p, a.sortie, a.seuil, a.marge, a.ombre, a.fermer)


if __name__ == '__main__':
    main()
