"""Détoure les photos de bouteilles (fond retiré, image intacte) pour FasoGaz.

Usage : python scripts/detourer_bouteilles.py <dossier_photos> public/img/bouteilles
Le fond est retiré par remplissage depuis les bords (seules les zones de fond reliées au bord
disparaissent : un logo blanc au milieu de la bouteille reste intact). Aucune déformation :
l'image est seulement recadrée et réduite proportionnellement.
"""
import os
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

SRC, OUT = sys.argv[1], sys.argv[2]
os.makedirs(OUT, exist_ok=True)
MAGIC = (255, 0, 254)


def remove_background(im, tol, extra_top=0.0, erode=3):
    """Rend transparent le fond relié aux bords (couleur proche des coins, à « tol » près).
    extra_top : part haute de l'image où le fond clair enfermé (dans une anse) est aussi retiré."""
    im = im.convert('RGBA')
    flat = Image.new('RGB', im.size, (255, 255, 255))
    flat.paste(im, mask=im.getchannel('A'))  # le transparent existant devient blanc
    w, h = flat.size
    seeds = [(x, y) for x in range(0, w, max(1, w // 40)) for y in (0, h - 1)] + \
            [(x, y) for y in range(0, h, max(1, h // 40)) for x in (0, w - 1)]
    if extra_top:
        arr = np.asarray(flat)
        ys, xs = np.where(np.all(arr[: int(h * extra_top)] > 228, axis=-1))
        seeds += list(zip(xs[::7].tolist(), ys[::7].tolist()))
    for s in seeds:
        if flat.getpixel(s) != MAGIC:
            ImageDraw.floodfill(flat, s, MAGIC, thresh=tol)
    bg = np.all(np.asarray(flat) == MAGIC, axis=-1)
    mask = Image.fromarray(np.where(bg, 0, 255).astype('uint8'))
    # Bord net mais sans escalier : on rogne d'1 px puis on adoucit légèrement.
    mask = mask.filter(ImageFilter.MinFilter(erode)).filter(ImageFilter.GaussianBlur(0.8))
    alpha = np.minimum(np.asarray(mask), np.asarray(im.getchannel('A')))
    out = im.copy()
    out.putalpha(Image.fromarray(alpha.astype('uint8')))
    return out


def trim(im, pad=6):
    a = np.asarray(im.getchannel('A'))
    ys, xs = np.where(a > 12)
    box = (max(0, xs.min() - pad), max(0, ys.min() - pad), min(im.width, xs.max() + pad + 1), min(im.height, ys.max() + pad + 1))
    return im.crop(box)


def save(im, name, max_h=720):
    im = trim(im)
    if im.height > max_h:
        im = im.resize((round(im.width * max_h / im.height), max_h), Image.LANCZOS)
    im.save(os.path.join(OUT, f'{name}.webp'), 'WEBP', quality=88, method=6)
    im.save(os.path.join(OUT, f'{name}.png'), optimize=True)
    print(f'{name}: {im.size}')
    return im


def split_columns(im, min_gap=8):
    """Sépare des bouteilles posées côte à côte (colonnes entièrement transparentes entre elles)."""
    a = np.asarray(im.getchannel('A')) > 40
    cols = a[: int(a.shape[0] * 0.86)].any(axis=0)  # on ignore le bas (ombres au sol qui relient les bouteilles)
    parts, start, gap = [], None, 0
    for x, filled in enumerate(cols):
        if filled:
            if start is None:
                start = x
            gap = 0
        elif start is not None:
            gap += 1
            if gap >= min_gap:
                parts.append((start, x - gap + 1)); start = None; gap = 0
    if start is not None:
        parts.append((start, len(cols)))
    return [im.crop((x0, 0, x1, im.height)) for x0, x1 in parts if x1 - x0 > im.width * 0.04]


src = lambda f: Image.open(os.path.join(SRC, f))

# Sodigaz : déjà détourée.
save(trim(src('B12-277x300.png').convert('RGBA')), 'sodigaz')
# Shell : fond blanc.
save(remove_background(src('Bouteille-Shell-Gaz-B6.png'), 42, extra_top=0.3, erode=3), 'shell')
# Total : détourée, mais un voile blanc reste en haut à gauche.
save(remove_background(src('packshot-gaz.webp'), 22), 'total')
# Oryx : fond gris clair, 5 bouteilles (6, 19, 48, 9 et 3 kg de gauche à droite).
oryx = src('2-6kg19kg48kg9kg3kg.webp').convert('RGBA')
oryx = oryx.resize((1800, round(oryx.height * 1800 / oryx.width)), Image.LANCZOS)
oryx = remove_background(oryx, 20)
save(oryx, 'oryx', max_h=900)


def keep_main_part(im):
    """Ne garde que la bouteille au centre du recadrage (supprime les bouts des voisines)."""
    a = np.asarray(im.getchannel('A'))
    m = Image.fromarray(np.where(a > 30, 255, 0).astype('uint8')).copy()  # copie modifiable
    cx = im.width // 2
    ys = np.where(a[:, cx] > 30)[0]
    seed = (cx, int(ys[len(ys) // 2]))
    ImageDraw.floodfill(m, seed, 128, thresh=0)
    keep = np.asarray(m) == 128
    out = im.copy()
    out.putalpha(Image.fromarray(np.where(keep, a, 0).astype('uint8')))
    return out


# Les socles se touchent : découpe aux positions des bouteilles (largeur 1800 px).
cuts = [175, 466, 768, 1106, 1398, 1640]
for kg, x0, x1 in zip([6, 19, 48, 9, 3], cuts, cuts[1:]):
    save(keep_main_part(oryx.crop((x0, 0, x1, oryx.height))), f'oryx-{kg}kg')
