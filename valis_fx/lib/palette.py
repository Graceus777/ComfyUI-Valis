"""Colour palettes for video: a named look (or your own HEX colours) graded onto every frame, the way a colourist
would: white balance, exposure, lift/gamma/gain, an S-curve, saturation and vibrance, split-toning, a channel mix,
fade, bloom and halation, grain and vignette. Deterministic per pixel (no flicker); grain is seeded per frame.

    from valis_fx.lib.palette import grade, LOOKS, hex_look
    out = grade(frame, "teal_orange", strength=1.0, t=frame_index)
    out = grade(frame, hex_look(["#0b1d2a", "#c8553d", "#f2d0a4"]), strength=.8)

Every look also carries `words`, the same look said in a prompt, so a keyframe can be generated in it and then graded
to match exactly."""
import math

import cv2
import numpy as np

_LUMA = np.array([.2126, .7152, .0722], np.float32)


def _luma(x):
    return x @ _LUMA


def _blur(x, s):
    """A wide blur done at quarter size (bloom and halation don't need the detail)."""
    if s <= 0:
        return x
    if s < 4:
        return cv2.GaussianBlur(x, (0, 0), s)
    H, W = x.shape[:2]
    sm = cv2.resize(x, (max(1, W // 4), max(1, H // 4)), interpolation=cv2.INTER_AREA)
    sm = cv2.GaussianBlur(sm, (0, 0), s / 4)
    return cv2.resize(sm, (W, H), interpolation=cv2.INTER_LINEAR).reshape(x.shape)


class Look(dict):
    """A look is a dict of grading parameters; anything left out is neutral."""

    NEUTRAL = dict(temp=0.0, tint=0.0, exposure=0.0, lift=(0, 0, 0), gamma=(1, 1, 1), gain=(1, 1, 1), contrast=0.0,
                   pivot=.45, sat=1.0, vib=0.0, shadows=(0, 0, 0), highlights=(0, 0, 0), balance=.5, mix=None, mono=0.0,
                   mono_tint=(1, 1, 1), fade=0.0, roll=0.0, palette=None, palette_amount=0.0, bloom=0.0, halation=0.0,
                   soft=0.0, grain=0.0, vignette=0.0, name="", words="")

    def __getattr__(self, k):
        return self.get(k, Look.NEUTRAL.get(k))


def _hex(c):
    c = c.strip().lstrip("#")
    return np.array([int(c[i:i + 2], 16) / 255 for i in (0, 2, 4)], np.float32)


def hex_look(colors, amount=.85, name="custom", contrast=.1):
    """Your own palette: 2-6 HEX colours. Shadows take the darkest, highlights the lightest, the rest fall between
    by brightness (a luminance-preserving gradient map), blended in at `amount`."""
    cs = sorted((_hex(c) for c in colors), key=lambda c: float(_luma(c)))
    return Look(name=name, palette=[c.tolist() for c in cs], palette_amount=amount, contrast=contrast,
                words="a colour palette of " + ", ".join(colors))


def _gradient_map(L, cols):
    cols = np.asarray(cols, np.float32)
    k = len(cols)
    pos = np.linspace(0, 1, k)
    out = np.empty(L.shape + (3,), np.float32)
    for ch in range(3):
        out[..., ch] = np.interp(L, pos, cols[:, ch])
    return out


def grade(img, look, strength=1.0, t=0, seed=0):
    """img: float32 HxWx3 in 0..1. look: a name from LOOKS or a Look. strength 0..1 blends from the original."""
    lk = LOOKS[look] if isinstance(look, str) else look
    x = np.clip(img.astype(np.float32), 0, 1)
    src = x
    # white balance and exposure
    wb = np.array([1 + .09 * lk.temp, 1 - .07 * lk.tint, 1 - .11 * lk.temp], np.float32)
    x = x * wb * (2 ** lk.exposure)
    if lk.mix is not None:                                     # a channel mixer (cross-process, infrared...)
        x = x @ np.asarray(lk.mix, np.float32).T
    # lift / gamma / gain, per channel
    lift, gam, gain = (np.asarray(v, np.float32) for v in (lk.lift, lk.gamma, lk.gain))
    x = np.clip(x, 0, None)
    if lift.any():
        x = x + lift * (1 - np.clip(x, 0, 1))
    if (gam != 1).any():
        x = np.power(x, (1 / np.maximum(gam, .05)).astype(np.float32))
    if (gain != 1).any():
        x = x * gain
    # contrast: an S-curve around the pivot
    if lk.contrast:
        c = lk.contrast; p = lk.pivot
        k = 4 + 10 * abs(c)
        s = 1 / (1 + np.exp(np.float32(-k) * (x - np.float32(p))))
        s0, s1 = 1 / (1 + math.exp(k * p)), 1 / (1 + math.exp(-k * (1 - p)))
        s = (s - s0) / (s1 - s0)
        x = x + (s - x) * c if c > 0 else x + (x - s) * c * .5
    # saturation and vibrance
    L = _luma(x)[..., None]
    x = L + (x - L) * lk.sat
    if lk.vib:
        sat = np.abs(x - L).max(-1, keepdims=True)
        x = L + (x - L) * (1 + lk.vib * (1 - np.clip(sat * 3, 0, 1)))
    # split-tone: a colour into the shadows, another into the highlights (luminance kept)
    L = np.clip(_luma(x), 0, 1)[..., None]
    sh, hi = np.asarray(lk.shadows, np.float32), np.asarray(lk.highlights, np.float32)
    if sh.any() or hi.any():
        b = lk.balance
        ws = np.clip(1 - L / max(b, 1e-3), 0, 1) ** 1.5
        wh = np.clip((L - b) / max(1 - b, 1e-3), 0, 1) ** 1.5
        x = x + ws * (sh - _luma(sh)) + wh * (hi - _luma(hi))
    # monochrome
    if lk.mono:
        m = _luma(np.clip(x, 0, 1))[..., None] * np.asarray(lk.mono_tint, np.float32)
        x = x * (1 - lk.mono) + m * lk.mono
    # palette (gradient map, luminance-preserving)
    if lk.palette is not None and lk.palette_amount:
        Lp = np.clip(_luma(np.clip(x, 0, 1)), 0, 1)
        gm = _gradient_map(Lp, lk.palette)
        gm = gm * (Lp / np.maximum(_luma(gm), 1e-3))[..., None]
        x = x * (1 - lk.palette_amount) + gm * lk.palette_amount
    # fade (lifted blacks) and highlight roll-off
    x = np.clip(x, 0, None)
    if lk.roll:
        x = x / (1 + lk.roll * x)
        x = x * (1 + lk.roll)
    if lk.fade:
        x = lk.fade + x * (1 - lk.fade * 1.3)
    x = np.clip(x, 0, 1)
    # bloom and halation
    if lk.bloom or lk.halation:
        hl = np.clip(x - .7, 0, 1) / .3
        if lk.bloom:
            x = 1 - (1 - x) * (1 - _blur(hl, 12) * lk.bloom * .6)
        if lk.halation:
            h = _blur(hl.max(-1, keepdims=True).repeat(3, -1), 6) * np.array([1.0, .35, .15], np.float32)
            x = 1 - (1 - x) * (1 - h * lk.halation * .7)
    if lk.soft:
        x = x * (1 - lk.soft) + _blur(x, 1.6) * lk.soft
    H, W = x.shape[:2]
    if lk.vignette:
        yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
        r = np.sqrt(((xx - W / 2) / (W * .7)) ** 2 + ((yy - H / 2) / (H * .7)) ** 2)
        x = x * (1 - lk.vignette * np.clip(r - .35, 0, 1) ** 1.6)[..., None]
    if lk.grain:
        rng = np.random.default_rng((seed * 1000003 + int(t)) % (2 ** 32))
        g = rng.standard_normal((H // 2 + 1, W // 2 + 1)).astype(np.float32)
        g = cv2.resize(g, (W, H), interpolation=cv2.INTER_LINEAR)
        Lg = _luma(x)[..., None]
        x = x + g[..., None] * lk.grain * .045 * (1 - np.abs(Lg * 2 - 1))
    x = np.clip(x, 0, 1)
    return src * (1 - strength) + x * strength if strength < 1 else x


def L(name, words, **kw):
    return Look(name=name, words=words, **kw)


# The library. Names describe the look; `words` say it in a prompt.
LOOKS = {
    "natural": L("Natural", "", ),
    "film_colors": L("Film colours", "shot on 35mm colour negative film, gentle contrast, rich but natural colour, fine grain",
                     contrast=.18, sat=1.06, shadows=(.02, .03, .05), highlights=(.05, .03, 0), fade=.03, halation=.25, grain=.35, roll=.15),
    "kodak_2383": L("Print film", "a Kodak 2383 print-film look, deep warm blacks, golden highlights, cyan shadows",
                    contrast=.32, sat=1.08, shadows=(0, .04, .07), highlights=(.07, .03, -.02), temp=.15, roll=.25, grain=.25, halation=.2),
    "teal_orange": L("Teal & orange", "teal and orange blockbuster colour grade, warm skin against cool shadows",
                     contrast=.25, sat=1.12, shadows=(-.05, .05, .10), highlights=(.10, .04, -.06), vib=.2),
    "bleach_bypass": L("Bleach bypass", "bleach-bypass look, desaturated, hard contrast, silvery highlights",
                       contrast=.45, sat=.45, roll=.1, grain=.3),
    "black_gloss": L("Black gloss", "glossy deep blacks, high contrast, polished specular highlights, low-key",
                     contrast=.5, pivot=.5, gamma=(.9, .9, .9), sat=1.0, bloom=.25, vignette=.25),
    "noir": L("Noir", "black-and-white film noir, hard shadows, silver highlights, grain",
              mono=1.0, contrast=.55, grain=.45, vignette=.4, halation=.1),
    "silver_mono": L("Silver mono", "soft silver black-and-white, gentle contrast, fine grain",
                     mono=1.0, mono_tint=(1.0, 1.0, 1.02), contrast=.15, fade=.03, grain=.25),
    "sepia": L("Sepia", "warm sepia-toned photograph, faded, soft",
               mono=1.0, mono_tint=(1.08, .93, .74), fade=.06, soft=.2, vignette=.35, grain=.3),
    "technicolor": L("Technicolor", "three-strip Technicolor, saturated primaries, rich reds, warm bloom",
                     sat=1.5, contrast=.2, temp=.1, bloom=.35),
    "kodachrome": L("Kodachrome", "Kodachrome slide film, saturated reds and blues, deep shadows, crisp",
                    sat=1.3, contrast=.35, shadows=(0, .02, .05), highlights=(.04, .02, -.02), roll=.15),
    "faded_70s": L("Faded 70s", "faded 1970s film stock, warm and washed, lifted blacks, soft yellows",
                   fade=.10, sat=.8, temp=.25, highlights=(.06, .05, -.04), shadows=(.02, .02, .04), grain=.4, soft=.15),
    "nostalgic_blue": L("Nostalgic blue", "nostalgic cool blue haze, faded, gentle, early-morning memory",
                        fade=.08, sat=.75, temp=-.35, shadows=(0, .03, .08), highlights=(.02, .03, .05), soft=.2),
    "soft_palette": L("Soft palette", "soft muted pastel palette, low contrast, airy",
                      contrast=-.2, sat=.7, fade=.07, highlights=(.04, .03, .03), bloom=.2),
    "pastel": L("Pastel", "pastel colours, bright and soft, candy tones, symmetrical whimsy",
                contrast=-.1, sat=.85, fade=.05, exposure=.15, highlights=(.06, .02, .05), shadows=(.02, .04, .05)),
    "candy_pink": L("Candy pink", "candy-pink glow, magenta-tinted highlights, glossy pop",
                    tint=.35, highlights=(.10, -.02, .07), sat=1.15, bloom=.3),
    "lime_jam": L("Lime jam", "acid lime greens against deep shadows, punchy, music-video colour",
                  tint=-.3, shadows=(-.02, .06, .00), highlights=(.04, .09, -.06), sat=1.25, contrast=.3),
    "crimson_vigil": L("Crimson vigil", "deep crimson red light, dark shadows, ominous",
                       shadows=(.06, -.02, -.01), highlights=(.14, -.03, -.05), sat=1.2, contrast=.35, temp=.2, vignette=.4),
    "overtime": L("Overtime", "late-night office fluorescent, sickly green-cyan cast, tired",
                  tint=-.25, temp=-.1, sat=.8, fade=.04, shadows=(-.01, .03, .03), highlights=(0, .04, .02)),
    "golden_hour": L("Golden hour", "low golden-hour sunlight, warm amber, long glowing highlights",
                     temp=.5, highlights=(.10, .05, -.06), bloom=.35, contrast=.15, sat=1.1),
    "moonlight": L("Moonlight", "cold blue moonlight, night, deep blue shadows",
                   temp=-.6, exposure=-.4, shadows=(-.02, .02, .10), sat=.75, contrast=.25, vignette=.3),
    "day_for_night": L("Day for night", "day-for-night: blue-grey night look made from daylight, dark sky, cool",
                       temp=-.7, exposure=-.9, sat=.55, contrast=.2, shadows=(0, .02, .08), vignette=.35),
    "neon_night": L("Neon night", "rain-soaked neon night, magenta and cyan, glowing highlights",
                    shadows=(-.02, .03, .10), highlights=(.10, -.02, .10), sat=1.3, contrast=.3, bloom=.45),
    "cyber": L("Cyber", "cyberpunk grade, electric cyan highlights, violet shadows",
               shadows=(.05, -.02, .10), highlights=(-.04, .08, .10), sat=1.25, contrast=.35, bloom=.3),
    "matrix": L("Code green", "green-tinted digital world, cold, desaturated except green",
                tint=-.45, sat=.7, contrast=.35, shadows=(-.02, .05, .0), highlights=(0, .06, -.02)),
    "amber_haze": L("Amber haze", "amber smoke haze, dusty orange air, hazy silhouettes, future-noir",
                    temp=.6, fade=.06, highlights=(.12, .05, -.08), sat=1.05, bloom=.4, contrast=.1),
    "desert": L("Desert", "harsh desert sun, bleached ochre, hot",
                temp=.45, exposure=.1, sat=.95, highlights=(.08, .05, -.03), roll=.3, contrast=.2),
    "arctic": L("Arctic", "icy arctic light, white-blue, clean and cold",
                temp=-.5, exposure=.15, sat=.7, highlights=(-.01, .02, .06), roll=.2),
    "vhs": L("VHS", "1980s VHS home video, soft, smeared colour, lifted blacks, tape noise",
             fade=.07, soft=.5, sat=1.1, shadows=(-.02, .03, .05), highlights=(.05, -.01, .04), grain=.5),
    "camcorder": L("DV camcorder", "early-2000s DV camcorder, sharp but flat, slightly cool, clipped highlights",
                   contrast=.1, sat=1.05, temp=-.1, roll=-.05, grain=.25),
    "cross_process": L("Cross-process", "cross-processed film, yellow-green highlights, blue shadows, high saturation",
                       mix=[[1.05, .05, -.1], [-.05, 1.1, -.05], [-.1, .1, 1.0]], shadows=(-.02, .01, .08),
                       highlights=(.06, .08, -.08), sat=1.2, contrast=.3),
    "infrared": L("Infrared", "false-colour infrared photograph, pink foliage, dark sky",
                  mix=[[.2, .9, -.1], [.1, .3, .6], [.6, .1, .3]], sat=1.1, contrast=.25),
    "duotone_ink": L("Ink duotone", "two-colour duotone print, ink blue and paper cream",
                     palette=[[.06, .09, .2], [.95, .9, .78]], palette_amount=1.0, contrast=.2, grain=.2),
    "duotone_sunset": L("Sunset duotone", "duotone, deep purple and sunset orange",
                        palette=[[.2, .05, .3], [1.0, .55, .25]], palette_amount=.9, contrast=.15),
    "ember": L("Ember", "firelit, orange embers and black, glowing",
               temp=.55, shadows=(.03, -.01, -.03), highlights=(.14, .04, -.08), sat=1.2, contrast=.35, halation=.4, vignette=.3),
    "horror_green": L("Grave green", "sickly green horror grade, desaturated skin, deep crushed blacks",
                      tint=-.35, sat=.65, contrast=.4, gamma=(.95, 1.0, .95), vignette=.45, grain=.3),
    "dream": L("Dream", "dreamy soft glow, blooming highlights, lifted pastel shadows",
               bloom=.6, soft=.35, fade=.06, sat=.9, highlights=(.05, .03, .05)),
    "chrome": L("Chrome", "cold metallic chrome, desaturated steel blues, specular highlights",
                temp=-.35, sat=.55, contrast=.4, highlights=(0, .02, .05), bloom=.2),
    "daguerreotype": L("Daguerreotype", "an 1840s daguerreotype, silver mirror, soft edges, heavy vignette",
                       mono=1.0, mono_tint=(1.02, .98, .9), contrast=.3, vignette=.7, halation=.3, soft=.35, grain=.2),
}


def look_words(name):
    return LOOKS[name].words if name in LOOKS else ""


def contact_sheet(img, names=None, cols=6, w=240):
    """Every look on one frame, labelled (for picking)."""
    names = names or list(LOOKS)
    h = int(img.shape[0] * w / img.shape[1])
    small = cv2.resize(img, (w, h), interpolation=cv2.INTER_AREA)
    tiles = []
    for n in names:
        g = (grade(small, n) * 255).astype(np.uint8)
        g = np.ascontiguousarray(g)
        cv2.putText(g, LOOKS[n].name, (6, h - 8), cv2.FONT_HERSHEY_SIMPLEX, .45, (255, 255, 255), 1, cv2.LINE_AA)
        tiles.append(g)
    while len(tiles) % cols:
        tiles.append(np.zeros_like(tiles[0]))
    rows = [np.hstack(tiles[i:i + cols]) for i in range(0, len(tiles), cols)]
    return np.vstack(rows)
