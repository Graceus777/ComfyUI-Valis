"""Valis Stereo: pictures hidden in noise.

Two ways to hide a moving thing in a field of dots:
  - a stereogram (magic eye): the dots repeat across the frame and the repeat distance carries depth. Free-view
    it (parallel or cross-eyed) and the thing stands out of the field in 3D. Young Rival's "Black Is Good" (2014)
    did this with Kinect depth of the band in fresh TV-snow dots every frame; here the depth comes from a SAM 3
    mask, a depth model, a body mesh or a spinning solid.
  - a kinetogram: the thing is made of the same dots as the field and only its dots move, so any paused frame is
    plain noise and the thing exists only while it moves. Nobody has to learn to free-view.

Small nodes (category Valis/Stereo) so they recombine:
  Valis Mask Depth      MASK (SAM 3) -> rounded depth: the silhouette inflated like a balloon, + relief from a depth map
  Valis Depth Shape     a spinning solid (cube, torus, octahedron, heart, star, blob) -> depth + mask
  Valis Depth Place     put one depth into another: where, how big, how near, a straight move, when it enters
  Valis Static          what the static is made of: squares, halftone or ASCII cells; white / pink / brown / blue /
                        violet grain; black and white, grey, RGB, colour-TV or a palette
  Valis Stereo Pattern  the dots as frames: random, TV snow, colour, a palette or glyphs (any IMAGE works too)
  Valis Stereogram      depth (+ pattern) -> the hidden-picture frames
  Valis Kinetogram      mask -> the motion-only frames (chain several, each thing with its own motion)
  Valis Stereo Decode   reads the depth back out of stereogram frames, optionally after an H.264 round trip at a
                        bitrate you set: a check that the picture survives an upload

Depth everywhere is an IMAGE, white = near, black = the field (Depth Anything 3's "depth" output is the same way round).
"""
import math

import numpy as np
import torch
import torch.nn.functional as F

try:
    import comfy.model_management as _mm
    import comfy.utils as _cu
except Exception:                      # outside ComfyUI (tests)
    _mm = None
    _cu = None

CAT = "Valis/Stereo"
SHAPES = ["cube", "torus", "octahedron", "heart", "star", "blob"]
KINDS = ["dots", "snow", "color"]


# ---------------------------------------------------------------------------------------------------------- helpers

def _device():
    if _mm is not None:
        try:
            return _mm.get_torch_device()
        except Exception:
            pass
    return torch.device("cuda" if torch.cuda.is_available() else "cpu")


def _check_interrupt():
    if _mm is not None:
        _mm.throw_exception_if_processing_interrupted()


class _Progress:
    def __init__(self, total):
        self.bar = _cu.ProgressBar(total) if _cu is not None else None

    def update(self, n=1):
        if self.bar is not None:
            self.bar.update(n)


def _grey(img):
    img = img.float()
    if img.shape[-1] >= 3:
        return 0.299 * img[..., 0] + 0.587 * img[..., 1] + 0.114 * img[..., 2]
    return img[..., 0]


def _depth_tensor(x):
    """IMAGE [B,H,W,C] or MASK [B,H,W] / [H,W] -> float [B,H,W]. Depth pictures are grey, so an IMAGE's first
    channel is the depth (no copy)."""
    if x.ndim == 4:
        return x[..., 0].float()
    if x.ndim == 2:
        return x[None].float()
    return x.float()


def _mask_tensor(m):
    if m is None:
        return None
    if m.ndim == 2:
        m = m[None]
    if m.ndim == 4:
        m = _grey(m)
    return m.float()


def _to_image(z):
    """[B,H,W] -> IMAGE [B,H,W,3] on the CPU."""
    z = z.clamp(0, 1).float().cpu()
    return z[..., None].repeat(1, 1, 1, 3)


def _resize_bhw(x, h, w, mode="bilinear"):
    if x.shape[-2:] == (h, w):
        return x
    kw = {"align_corners": False} if mode == "bilinear" else {}
    return F.interpolate(x[:, None], size=(h, w), mode=mode, **kw)[:, 0]


def _parse_hex(s):
    out = []
    for part in (s or "").replace(";", ",").split(","):
        p = part.strip().lstrip("#")
        if len(p) == 3:
            p = "".join(c * 2 for c in p)
        if len(p) == 6:
            try:
                out.append([int(p[i:i + 2], 16) / 255.0 for i in (0, 2, 4)])
            except ValueError:
                pass
    return out


def _cells(kind, hc, wc, gen, density=0.5, palette=None):
    """Random dot cells [hc, wc, 3] in 0..1 (CPU)."""
    if palette:
        pal = torch.tensor(palette, dtype=torch.float32)
        idx = torch.randint(0, len(palette), (hc, wc), generator=gen)
        return pal[idx]
    if kind == "dots":
        v = (torch.rand(hc, wc, generator=gen) < density).float()
        return v[..., None].repeat(1, 1, 3)
    if kind == "snow":
        v = torch.rand(hc, wc, generator=gen)
        return v[..., None].repeat(1, 1, 3)
    return torch.rand(hc, wc, 3, generator=gen)                     # color


def _upsample_cells(cells, h, w, dot):
    """Nearest-upsample dot cells to [h, w, 3]."""
    return cells.repeat_interleave(dot, 0).repeat_interleave(dot, 1)[:h, :w]


def _auto_period(width, period):
    return int(period) if period and period > 0 else max(24, int(round(width / 9.0)))


# ---------------------------------------------------------------------------------------------------- static kernels
#
# What the static is made of. A cell holds four numbers: a level (which halftone dot or character) and a colour
# (the dot, or the ink). Stereograms and kinetograms copy whole cells, then paint them, so a character is never cut.

SPECTRA = {"white": 0.0, "pink": -0.5, "brown": -1.0, "blue": 0.5, "violet": 1.0}   # amplitude ~ frequency ** a
LOOKS = ["squares", "halftone", "ascii"]
COLORS = ["black & white", "grey", "rgb", "rgb 8", "tv", "palette"]
CHARSETS = {                                     # light to dense; the first four are the Valis v1 ASCII sets
    "standard": " .'`^\",:;Il!i><~+_-?][}{1)(|/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$",
    "minimal": " .:-=+*#%@",
    "blocks": " ░▒▓█",
    "detailed": " .\",:;'`^i!l|I><~+_-?)(][}{1/\\tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$",
    "maze": "╱╲",
    "binary": "01",
    "hex": "0123456789ABCDEF",
    "letters": "ABCDEFGHJKLMNPQRSTUVWXYZ",
    "katakana": "ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ0123456789",
}
_HEX = {                                         # the Valis v1 ASCII Clipper palettes
    "vaporwave": "#ff71ce #01cdfe #05ffa1 #b967ff #ff97d2 #0198bb #ff3864",
    "neon": "#ff0066 #00ffff #39ff14 #ffff00 #ff00ff #00bfff #ff69b4",
    "cyberpunk": "#ff7c00 #00ffc6 #7800ff #ff006e #00c8ff #ffc800 #323250",
    "synthwave": "#ff0080 #8000ff #0080ff #ff8000 #00ff80 #ff00ff #400080",
    "terminal": "#00ff00 #00c800 #009600 #006400 #003200",
    "amber": "#ffb000 #ff8c00 #c86e00 #965000 #643200",
    "matrix": "#00ff41 #00c832 #009628 #00641e #00320f #001908",
    "sunset": "#ff5e4d #ff9a00 #ffce54 #ff3864 #8a2be2 #4b0082",
    "ocean": "#006994 #0096c7 #48cae4 #90e0ef #caf0f8 #00b4d8",
    "fire": "#ff0000 #ff4500 #ff8c00 #ffd700 #ffff00 #ffffc8",
    "grayscale": "#ffffff #c8c8c8 #969696 #646464 #323232 #000000",
    "pastel": "#ffb3ba #ffdfba #ffffba #baffc9 #bae1ff #dbbaff",
    "noir": "#ffffff #b4b4b4 #646464 #323232 #141414 #000000",
    # and the study palettes
    "pigment 12": "#191f2c #663045 #3d468e #1d7072 #b7524f #f3a731 #ea6891 #5cc19e #3d9dcf #8ca7c8 #f4e7ca #ac5bbe",
    "pigment 8": "#1c202f #3e3f81 #268eb8 #e74f70 #f5b33e #53cfb4 #a367bb #f3e6cb",
    "pearl": "#fbad49 #f78791 #b795d8 #70c9c9 #99d6ad #f9d581",
    "glow": "#ffc6a8 #ff8fb1 #c9a2ff #8fc7ff #8fe8d0 #ffe29a",
    "coral": "#ff7a59 #ffb347 #ffe08a #7fd6c2 #6f9bff #c77dff",
    "reef": "#7fe0d0 #ffb07a #ffe08a #5fc3e4 #ff8fa3 #9be7a8",
    "midnight": "#5b7cff #9a6bff #3fd0ff #ff7ad9 #7f8cff #45f0d1",
    "abyss": "#43e6ff #6f7bff #b06bff #2fffd0",
    "club blocks": "#ff2bd6 #00f0ff #7a5cff #ffe600 #00ff9c #140a3a",
    "slate": "#161b24 #2c3441 #4a5462 #6e7987 #98a2ad #c6cdd3 #eef0f1",
    "ember": "#ffe7a3 #ff8a3d #b8336a #3b2c7a",
    "gold": "#fffaf0 #ffe9a8 #f6cf6e #d9a441",
    "flare": "#ffe2b8 #ff7a2a #ff2e88 #3a2a86",
    "soft spectrum": "#fff1c4 #ffb15c #f0587a #9d4fc4 #3d6fc9 #2aa6a6",
}
PALETTES = {k: _parse_hex(v.replace(" ", ",")) for k, v in _HEX.items()}


def _font_paths(cjk=False):
    import os
    win = os.path.join(os.environ.get("WINDIR", r"C:\Windows"), "Fonts")
    if cjk:
        names = [os.path.join(win, n) for n in ("YuGothM.ttc", "YuGothR.ttc", "msgothic.ttc", "meiryo.ttc")]
        return names + ["/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
                        "/usr/share/fonts/noto-cjk/NotoSansCJK-Regular.ttc", "/System/Library/Fonts/Hiragino Sans GB.ttc"]
    names = [os.path.join(win, n) for n in ("consola.ttf", "lucon.ttf", "cour.ttf")]
    return names + ["/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf", "/usr/share/fonts/TTF/DejaVuSansMono.ttf",
                    "/System/Library/Fonts/Menlo.ttc", "/Library/Fonts/Courier New.ttf"]


def _load_font(px, cjk=False):
    from PIL import ImageFont
    for p in _font_paths(cjk) + (_font_paths(False) if cjk else []):
        try:
            return ImageFont.truetype(p, px)
        except Exception:
            continue
    return ImageFont.load_default()


_BAYER4 = np.array([[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]], np.float32)


def _drawn_glyph(c, cw, ch, s=4):
    """Characters drawn exactly instead of from a font: blank, shade blocks and the maze diagonals (they must meet
    their neighbours' corners)."""
    if c == " ":
        return np.zeros((ch, cw), np.float32)
    if c == "█":
        return np.ones((ch, cw), np.float32)
    if c in "░▒▓":
        yy, xx = np.mgrid[0:ch, 0:cw]
        return ((_BAYER4[yy % 4, xx % 4] + 0.5) / 16 < {"░": 0.25, "▒": 0.5, "▓": 0.75}[c]).astype(np.float32)
    if c in "╱╲":
        yy, xx = np.mgrid[0:ch * s, 0:cw * s].astype(np.float32)
        X, Y = (xx + 0.5) / (cw * s), (yy + 0.5) / (ch * s)
        d = np.abs(X + Y - 1) if c == "╱" else np.abs(X - Y)
        d = d * cw * ch / math.hypot(cw, ch)                         # px from the diagonal
        a = (d <= max(0.75, min(cw, ch) / 7.0)).astype(np.float32)
        return a.reshape(ch, s, cw, s).mean((1, 3))
    return None


def _font_glyph(c, cw, ch, s=4):
    from PIL import Image, ImageDraw
    cjk = ord(c) > 0x2FFF
    size = max(4, int(ch * s * 0.92))
    font = _load_font(size, cjk)
    try:
        adv = font.getlength("M" if not cjk else c)
        if adv > cw * s * 1.04:
            font = _load_font(max(4, int(size * cw * s * 1.04 / adv)), cjk)
    except Exception:
        pass
    img = Image.new("L", (cw * s, ch * s), 0)
    try:
        ImageDraw.Draw(img).text((cw * s / 2.0, ch * s / 2.0), c, fill=255, font=font, anchor="mm")
    except Exception:
        ImageDraw.Draw(img).text((0, 0), c, fill=255, font=font)
    a = np.asarray(img, np.float32) / 255.0
    return a.reshape(ch, s, cw, s).mean((1, 3))


_ATLAS = {}


def _atlas(look, chars, cw, ch):
    """[n, ch, cw] coverage of each level: halftone dots growing in area, or the characters of a set."""
    key = (look, chars, cw, ch)
    if key not in _ATLAS:
        if look == "halftone":
            n = 8
            yy, xx = np.mgrid[0:ch * 4, 0:cw * 4].astype(np.float32)
            r2 = ((xx + 0.5) / 4 - cw / 2.0) ** 2 + ((yy + 0.5) / 4 - ch / 2.0) ** 2
            R = 0.58 * min(cw, ch)
            out = [((r2 <= (R * math.sqrt(k / (n - 1))) ** 2) & (k > 0)).astype(np.float32).reshape(ch, 4, cw, 4).mean((1, 3))
                   for k in range(n)]
        else:
            out = []
            for c in chars:
                g = _drawn_glyph(c, cw, ch)
                out.append(g if g is not None else _font_glyph(c, cw, ch))
        _ATLAS[key] = torch.from_numpy(np.stack(out).astype(np.float32))
    return _ATLAS[key]


def _noise_fields(n, h, w, gen, a):
    """n fields [n,h,w] of noise with power ~ frequency ** 2a, levelled to an even spread of values in 0..1 (so
    every noise colour has the same contrast). Clumps never grow past ~24 cells, whatever the field size."""
    x = torch.rand(n, h, w, generator=gen)
    if a == 0:
        return x
    X = torch.fft.rfft2(x - 0.5)
    fy = torch.fft.fftfreq(h)[:, None]
    fx = torch.fft.rfftfreq(w)[None, :]
    f = torch.sqrt(fy * fy + fx * fx).clamp_min(1.0 / 24.0)
    X = X * f.pow(a)
    X[:, 0, 0] = 0
    y = torch.fft.irfft2(X, s=(h, w))
    r = y.reshape(n, -1).argsort(1).argsort(1).float()
    return ((r + 0.5) / (h * w)).reshape(n, h, w)


def _box3(x):
    """3x3 box blur of [n,h,w], wrapping round."""
    x = torch.cat([x[:, -1:], x, x[:, :1]], 1)
    x = torch.cat([x[:, :, -1:], x, x[:, :, :1]], 2)
    return F.avg_pool2d(x[:, None], 3, stride=1)[:, 0]


class Static:
    """A static kernel (the VALIS_STATIC type): what each cell looks like and how cells are drawn."""

    def __init__(self, look="squares", noise="white", color="black & white", palette=None, chars=None, cell=4,
                 cell_height=0, paper=(0.0, 0.0, 0.0)):
        self.look = look if look in LOOKS else "squares"
        self.noise = noise if noise in SPECTRA else "white"
        self.color = color if color in COLORS else "black & white"
        self.palette = palette or PALETTES["neon"]
        self.chars = chars or CHARSETS["minimal"]
        self.cw = max(1, int(cell))
        auto = self.cw if (self.look != "ascii" or set(self.chars) <= set("╱╲█ ")) else max(self.cw + 1, int(round(self.cw * 1.6)))
        self.ch = max(1, int(cell_height)) if cell_height else auto
        self.paper = [float(v) for v in paper][:3]
        # rows of the static are unrelated only for white noise cells: then a stereogram may round each row's
        # separation its own way (rows dither the depth between cell steps). Clumped grain, TV colour blotches and
        # maze lines run across rows, and rows rounded differently would tear them and show the hidden thing.
        self.row_dither = (self.noise == "white" and self.color != "tv"
                           and not (self.look == "ascii" and any(c in "╱╲" for c in self.chars)))

    @classmethod
    def from_kind(cls, kind, dot_size):
        """The plain kinds of Valis Stereogram / Kinetogram as kernels."""
        return cls("squares", "white", {"dots": "black & white", "snow": "grey"}.get(kind, "rgb"), cell=dot_size)

    def cells(self, hc, wc, gen, period=0):
        """[hc, wc, 4] (level, r, g, b) in 0..1. period: make the noise repeat every `period` cells across (the
        field of a stereogram then has no seam where the pattern repeats)."""
        w = int(period) if period and 0 < period < wc else wc
        f = _noise_fields(4, hc, w, gen, SPECTRA[self.noise])
        if w < wc:
            f = f.repeat(1, 1, -(-wc // w))[:, :, :wc]
        glyph = self.look != "squares"
        src = f[1:4] if glyph else f[0:3]                     # squares take their colour from the first fields
        c = self.color
        if c == "black & white":
            rgb = torch.ones(3, hc, wc) if glyph else (f[0] > 0.5).float()[None].expand(3, -1, -1)
        elif c == "grey":
            rgb = (0.35 + 0.65 * src[0] if glyph else src[0])[None].expand(3, -1, -1)
        elif c == "rgb":
            rgb = src
        elif c == "rgb 8":
            rgb = (src > 0.5).float()
            if glyph:                                          # no black ink on black paper: those become white
                rgb = torch.where((rgb.sum(0) == 0)[None], torch.ones_like(rgb), rgb)
        elif c == "tv":                                        # colour-TV static: snow with soft colour blotches
            y = torch.full_like(src[0], 0.85) if glyph else src[0]
            cu, cv = _box3((src[1:3] - 0.5) * 0.7)
            rgb = torch.stack([y + 1.14 * cv, y - 0.395 * cu - 0.581 * cv, y + 2.032 * cu])
        else:
            pal = torch.tensor(self.palette, dtype=torch.float32)
            idx = (src[0] * len(pal)).long().clamp(0, len(pal) - 1)
            rgb = pal[idx].permute(2, 0, 1)
        return torch.cat([f[:1], rgb.clamp(0, 1)], 0).permute(1, 2, 0).contiguous()

    def paint(self, vals):
        """cells [B, hc, wc, 4] -> pixels [B, hc * ch, wc * cw, 3]."""
        B, hc, wc, _ = vals.shape
        rgb = vals[..., 1:4]
        if self.look == "squares":
            return rgb.repeat_interleave(self.ch, 1).repeat_interleave(self.cw, 2)
        at = _atlas(self.look, self.chars, self.cw, self.ch).to(vals.device)
        n = at.shape[0]
        lvl = (vals[..., 0] * n).long().clamp(0, n - 1)
        a = at[lvl][..., None]                                 # [B, hc, wc, ch, cw, 1]
        paper = torch.tensor(self.paper, dtype=vals.dtype, device=vals.device)
        px = paper + (rgb[:, :, :, None, None, :] - paper) * a
        return px.permute(0, 1, 3, 2, 4, 5).reshape(B, hc * self.ch, wc * self.cw, 3)

    def frame(self, h, w, gen):
        """One frame of static [h, w, 3]."""
        return self.paint(self.cells(-(-h // self.ch), -(-w // self.cw), gen)[None])[0, :h, :w]


# ---------------------------------------------------------------------------------------------------- stereogram core

def _chain(u, sep, start, T, row_start=None, lo=0):
    """Fill u[:, start:] so that u(x) = u(x - sep(x)).

    u, sep: [N, W]. Columns < start (and, per row, < row_start) already hold texture coordinates and are kept.
    Works in strips no wider than the smallest separation, so every source pixel of a strip lies left of it: one
    gather per strip for all rows and frames at once. Sources are read linearly between pixels, except across a
    jump in u (two unrelated chains side by side), where the nearer one is taken.

    Where the separation grows faster than half a pixel per pixel (just past the far side of a near thing), one eye
    cannot see the surface the link would join, and copying would smear one source across many pixels. Those pixels
    get fresh texture instead (columns T..2T of the strip): hidden-surface removal, as in Thimbleby, Inglis & Witten.
    """
    N, W = u.shape
    free = torch.zeros_like(sep, dtype=torch.bool)
    free[:, 1:] = (sep[:, 1:] - sep[:, :-1]) > 0.5
    smin = float(sep.min())
    m = max(1, int(math.floor(smin)) - 1)
    cols = torch.arange(W, device=u.device, dtype=sep.dtype)
    x = start
    while x < W:
        x1 = min(W, x + m)
        c = cols[x:x1][None, :]
        src = (c - sep[:, x:x1]).clamp(min=lo)
        i0 = src.floor().long().clamp(0, W - 1)
        i1 = (i0 + 1).clamp(max=W - 1)
        fr = src - i0.to(src.dtype)
        u0 = torch.gather(u, 1, i0)
        u1 = torch.gather(u, 1, i1)
        d = u1 - u0
        new = torch.where(d.abs() <= 1.5, u0 + fr * d, torch.where(fr < 0.5, u0, u1))
        new = torch.where(free[:, x:x1], T + torch.remainder(c, T), new)
        if row_start is not None:
            new = torch.where(c >= row_start[:, None], new, u[:, x:x1])
        u[:, x:x1] = new
        x = x1
    return u


def _chain_cells(u, sepq, start, T, row_start=None, lo=0):
    """_chain on the dot grid: whole-cell separations, exact copies. Wherever the separation grows, the source would
    repeat (a stretched dot, which traces the hidden thing); that pixel takes a fresh texel instead, and every copy
    of it one period over inherits it exactly."""
    N, W = u.shape
    free = torch.zeros_like(sepq, dtype=torch.bool)
    free[:, 1:] = sepq[:, 1:] > sepq[:, :-1]
    m = max(1, int(sepq.min()))
    cols = torch.arange(W, device=u.device)
    x = start
    while x < W:
        x1 = min(W, x + m)
        c = cols[x:x1][None, :]
        src = (c - sepq[:, x:x1]).clamp(min=lo, max=W - 1)
        new = torch.gather(u, 1, src)
        new = torch.where(free[:, x:x1], (T + torch.remainder(c, T)).to(u.dtype), new)
        if row_start is not None:
            new = torch.where(c >= row_start[:, None], new, u[:, x:x1])
        u[:, x:x1] = new
        x = x1
    return u


def strip_width(P, D):
    """T: wider than any separation, so a seed strip never repeats inside itself. Strips are 2T wide: the seed
    texture, then the fresh texture for pixels only one eye sees."""
    return int(math.ceil(P + D)) + 2


def stereo_coords(z, P, D, viewing="parallel", anchor="center", cells=False, dither=True):
    """Depth z [B,H,W] (1 = near) -> texture column u [B,H,W] in [0, 2 * strip_width(P, D)).

    Separation is P for the field (z = 0). Parallel viewing: near things repeat closer (P - D z);
    cross-eyed: farther apart (P + D z). Depth is read near the midpoint of each link (x -/+ P/2), so the hidden thing
    sits where it is in the depth map. anchor=center grows the pattern both ways from a seed strip in the middle,
    which halves the texture shift a moving thing drags through the field beside it. The seed strip is exactly one
    separation wide on each row (the separation at the seam), so a thing standing on the seam keeps its depth there.
    """
    B, H, W = z.shape
    sign = 1.0 if viewing == "cross" else -1.0
    smax = P + D
    if smax + 4 > W:
        raise ValueError(f"period {P}px (+depth) is too wide for a {W}px frame")
    a = int((W - P) // 2) if anchor == "center" else 0
    h = int(P // 2)
    zz = z.reshape(B * H, W)
    zr = torch.cat([zz[:, :1].expand(-1, h), zz[:, :W - h]], 1) if h > 0 else zz   # depth at x - P/2
    zl = torch.cat([zz[:, h:], zz[:, -1:].expand(-1, h)], 1) if h > 0 else zz      # depth at x + P/2
    sep_r = P + sign * D * zr
    sep_l = P + sign * D * zl
    seam = min(W - 1, a + h)
    s_c = (P + sign * D * zz[:, seam]).round().clamp(2, W - a - 2)                  # seed width per row
    cols = torch.arange(W, device=z.device, dtype=z.dtype)
    u = (cols[None, :] - a).clamp(min=0).expand(B * H, W).clone()                   # seed: u = x - a
    row_start = a + s_c
    T = strip_width(P, D)
    if cells:
        # whole-cell separations; each row rounds at its own random threshold, so rows dither the depth between
        # cell steps (the eye averages them) while along a row the separation only steps where the depth does.
        # Without dither every row rounds the same way: whole-cell depth steps, but rows stay aligned.
        rows = torch.arange(B * H, device=z.device, dtype=z.dtype) % H
        th = torch.frac(torch.sin(rows * 78.233 + 1.0) * 43758.5453).abs()[:, None] if dither else 0.5
        sq_r = torch.floor(sep_r + th).long()
        sq_l = torch.floor(sep_l + th).long()
        ul = u.long()
        ul = _chain_cells(ul, sq_r, int(row_start.min()), T, row_start.long(), lo=a)
        if a > 0:
            ul = _chain_cells(ul.flip(1).contiguous(), sq_l.flip(1).contiguous(), W - a, T).flip(1)
        return ul.to(z.dtype).reshape(B, H, W)
    u = _chain(u, sep_r, int(row_start.min()), T, row_start, lo=a)
    if a > 0:
        uf = _chain(u.flip(1).contiguous(), sep_l.flip(1).contiguous(), W - a, T)
        u = uf.flip(1)
    return u.reshape(B, H, W)


def sample_strip(strip, u):
    """strip [B,H,T,C], u [B,H,W] in [0,T) -> [B,H,W,C], linear between texels."""
    B, H, T, C = strip.shape
    f = u - u.floor()
    i0 = u.floor().long().clamp(0, T - 1)
    i1 = (i0 + 1) % T
    g0 = torch.gather(strip, 2, i0[..., None].expand(-1, -1, -1, C))
    g1 = torch.gather(strip, 2, i1[..., None].expand(-1, -1, -1, C))
    return g0 + (g1 - g0) * f[..., None]


def _strip_from_image(img, H, P):
    """A picture [Hp,Wp,C] -> a strip [H,P,3]: scaled to height H, the centre P columns (tiled when narrower)."""
    img = img[..., :3].float()
    if img.shape[-1] == 1:
        img = img.repeat(1, 1, 3)
    hp, wp = img.shape[:2]
    wn = max(1, int(round(wp * H / hp)))
    x = F.interpolate(img.permute(2, 0, 1)[None], size=(H, wn), mode="bilinear", align_corners=False)[0].permute(1, 2, 0)
    if wn < P:
        x = x.repeat(1, int(math.ceil(P / wn)), 1)
        wn = x.shape[1]
    c = (wn - P) // 2
    return x[:, c:c + P].contiguous()


def _guide_dots(frames, P, cx=None):
    """Two dots P apart near the top: free-view until they become three."""
    B, H, W, C = frames.shape
    y0 = max(8, int(round(H * 0.045)))
    r = max(3.0, P / 16.0)
    cx = W / 2.0 if cx is None else cx
    yy = torch.arange(H, device=frames.device, dtype=torch.float32)[:, None]
    xx = torch.arange(W, device=frames.device, dtype=torch.float32)[None, :]
    ring = torch.zeros(H, W, dtype=torch.bool, device=frames.device)
    dot = torch.zeros_like(ring)
    for x0 in (cx - P / 2.0, cx + P / 2.0):
        d2 = (yy - y0) ** 2 + (xx - x0) ** 2
        ring |= d2 <= (r * 1.6) ** 2
        dot |= d2 <= r ** 2
    frames[:, ring] = 1.0
    frames[:, dot] = 0.0
    return frames


# ------------------------------------------------------------------------------------------------------- depth nodes

def _profile(t, kind):
    t = np.clip(t, 0.0, 1.0)
    if kind == "dome":
        return np.sqrt(1.0 - (1.0 - t) ** 2)
    if kind == "pillow":
        return t * t * (3.0 - 2.0 * t)
    if kind == "cone":
        return t
    return (t > 0).astype(np.float32)                                # flat


class ValisMaskDepth:
    DESCRIPTION = ("A mask becomes a rounded depth: the silhouette inflated like a balloon, standing off the field. "
                   "Feed it SAM 3 (SAM3_TrackToMask). A depth map (Depth Anything 3, DA3Render 'depth') adds the "
                   "thing's own relief inside the mask.")

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
                    "mask": ("MASK",),
                    "thickness": ("FLOAT", {"default": 0.06, "min": 0.005, "max": 0.5, "step": 0.005, "tooltip": "how far in from the edge the shape reaches full height, as a share of the frame's short side (thin limbs stay thinner)"}),
                    "profile": (["dome", "pillow", "cone", "flat"], {"default": "dome"}),
                    "edge": ("FLOAT", {"default": 0.4, "min": 0.0, "max": 1.0, "step": 0.01, "tooltip": "depth at the silhouette edge: how far the whole thing stands off the field (0 = it grows out of the field)"}),
                    "near": ("FLOAT", {"default": 1.0, "min": 0.0, "max": 1.0, "step": 0.01, "tooltip": "depth at the thickest point"}),
                    "smooth": ("FLOAT", {"default": 2.0, "min": 0.0, "max": 32.0, "step": 0.5, "tooltip": "blur, px"}),
                    "temporal": ("FLOAT", {"default": 0.0, "min": 0.0, "max": 0.95, "step": 0.05, "tooltip": "carry some of the last frame's depth: steadier, but fast moves leave trails"}),
                },
                "optional": {
                    "relief": ("IMAGE", {"tooltip": "a depth map of the same clip (white = near), e.g. Depth Anything 3"}),
                    "relief_amount": ("FLOAT", {"default": 0.35, "min": 0.0, "max": 2.0, "step": 0.05}),
                    "relief_far_is_white": ("BOOLEAN", {"default": False}),
                }}

    RETURN_TYPES = ("IMAGE", "MASK")
    RETURN_NAMES = ("depth", "mask")
    FUNCTION = "run"
    CATEGORY = CAT

    def run(self, mask, thickness, profile, edge, near, smooth, temporal, relief=None, relief_amount=0.35,
            relief_far_is_white=False):
        import cv2
        m = _mask_tensor(mask).cpu().numpy()
        B, H, W = m.shape
        R = max(1.0, thickness * min(H, W))
        rel = None
        if relief is not None and relief_amount > 0:
            r = _depth_tensor(relief.cpu())
            r = _resize_bhw(r, H, W).numpy()
            rel = 1.0 - r if relief_far_is_white else r
        out = np.zeros((B, H, W), np.float32)
        prev = None
        bar = _Progress(B)
        for i in range(B):
            mi = (m[i] > 0.5).astype(np.uint8)
            z = np.zeros((H, W), np.float32)
            if mi.any():
                d = cv2.distanceTransform(mi, cv2.DIST_L2, 5)
                t = d / R
                z = np.where(mi > 0, edge + (near - edge) * _profile(t, profile), 0.0).astype(np.float32)
                if rel is not None:
                    ri = rel[i % rel.shape[0]]
                    vals = ri[mi > 0]
                    lo, hi = np.percentile(vals, 5), np.percentile(vals, 95)
                    rn = np.clip((ri - np.median(vals)) / max(hi - lo, 1e-4), -0.6, 0.6)
                    z = np.where(mi > 0, z + relief_amount * (near - edge) * rn, 0.0).astype(np.float32)
            if smooth > 0:
                z = cv2.GaussianBlur(z, (0, 0), smooth)
            if temporal > 0 and prev is not None:
                z = (1 - temporal) * z + temporal * prev
            prev = z
            out[i] = np.clip(z, 0, 1)
            bar.update()
        return (_to_image(torch.from_numpy(out)), torch.from_numpy((m > 0.5).astype(np.float32)))


def _rot(ax, ay, az):
    cx, sx, cy, sy, cz, sz = math.cos(ax), math.sin(ax), math.cos(ay), math.sin(ay), math.cos(az), math.sin(az)
    rx = torch.tensor([[1, 0, 0], [0, cx, -sx], [0, sx, cx]], dtype=torch.float32)
    ry = torch.tensor([[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]], dtype=torch.float32)
    rz = torch.tensor([[cz, -sz, 0], [sz, cz, 0], [0, 0, 1]], dtype=torch.float32)
    return rz @ ry @ rx


def _sd_heart(px, py):
    px = px.abs()
    a = torch.sqrt((px - 0.25) ** 2 + (py - 0.75) ** 2) - math.sqrt(2.0) / 4.0
    mm = 0.5 * (px + py).clamp_min(0)
    b = torch.sqrt(torch.minimum(px ** 2 + (py - 1.0) ** 2, (px - mm) ** 2 + (py - mm) ** 2)) * torch.sign(px - py)
    return torch.where(px + py > 1.0, a, b)


def _sd_star5(px, py, r=0.88, rf=0.45):
    k1x, k1y = 0.809016994375, -0.587785252292
    k2x, k2y = -k1x, k1y
    px = px.abs()
    d = (k1x * px + k1y * py).clamp_min(0)
    px, py = px - 2 * d * k1x, py - 2 * d * k1y
    d = (k2x * px + k2y * py).clamp_min(0)
    px, py = px - 2 * d * k2x, py - 2 * d * k2y
    px = px.abs()
    py = py - r
    bax, bay = rf * (-k1y), rf * k1x - 1.0
    h = ((px * bax + py * bay) / (bax * bax + bay * bay)).clamp(0, r)
    return torch.sqrt((px - bax * h) ** 2 + (py - bay * h) ** 2) * torch.sign(py * bax - px * bay)


def _extrude(d2, z, h, rnd):
    wx, wy = d2, z.abs() - h
    return torch.maximum(wx, wy).clamp_max(0) + torch.sqrt(wx.clamp_min(0) ** 2 + wy.clamp_min(0) ** 2) - rnd


def _sdf(shape, x, y, z):
    if shape == "cube":
        b = 0.5
        qx, qy, qz = x.abs() - b, y.abs() - b, z.abs() - b
        return (torch.sqrt(qx.clamp_min(0) ** 2 + qy.clamp_min(0) ** 2 + qz.clamp_min(0) ** 2)
                + torch.maximum(torch.maximum(qx, qy), qz).clamp_max(0) - 0.1)
    if shape == "torus":
        q = torch.sqrt(x * x + y * y) - 0.62                         # the ring faces the camera at rest
        return torch.sqrt(q * q + z * z) - 0.27
    if shape == "octahedron":
        return (x.abs() + y.abs() + z.abs() - 0.95) * 0.57735
    if shape == "heart":
        s = 1.55
        return _extrude(_sd_heart(x / s, y / s + 0.53) * s, z, 0.14, 0.14)
    if shape == "star":
        return _extrude(_sd_star5(x, y), z, 0.12, 0.08)
    # blob
    return (torch.sqrt(x * x + y * y + z * z) - 0.68
            + 0.16 * torch.sin(4.0 * x) * torch.sin(4.0 * y) * torch.sin(4.0 * z)) * 0.5


def render_shape(shape, frames, width, height, size, spin, tilt, edge, near, steps=72, device=None):
    """Sphere-trace a spinning solid. Returns depth [F,H,W] (field 0, edge..near on the thing) and mask [F,H,W]."""
    dev = device or _device()
    S = min(width, height) * size / 2.0
    xs = (torch.arange(width, device=dev, dtype=torch.float32) + 0.5 - width / 2.0) / S
    ys = -(torch.arange(height, device=dev, dtype=torch.float32) + 0.5 - height / 2.0) / S
    Y, X = torch.meshgrid(ys, xs, indexing="ij")
    inside = (X * X + Y * Y) < 1.25 ** 2
    X, Y = X[inside], Y[inside]
    depth = torch.zeros(frames, height, width)
    mask = torch.zeros(frames, height, width)
    tx, ty, tz = [math.radians(a) for a in tilt]
    bar = _Progress(frames)
    for f in range(frames):
        _check_interrupt()
        ph = 2 * math.pi * f / max(1, frames)
        R = _rot(tx + spin[0] * ph, ty + spin[1] * ph, tz + spin[2] * ph).to(dev)
        t = torch.zeros_like(X)
        hit = torch.zeros_like(X, dtype=torch.bool)
        alive = torch.ones_like(hit)
        z0 = -1.6
        for _ in range(steps):
            pz = z0 + t
            # object-space point: R^T p
            qx = R[0, 0] * X + R[1, 0] * Y + R[2, 0] * pz
            qy = R[0, 1] * X + R[1, 1] * Y + R[2, 1] * pz
            qz = R[0, 2] * X + R[1, 2] * Y + R[2, 2] * pz
            d = _sdf(shape, qx, qy, qz)
            newhit = alive & (d < 1e-3)
            hit |= newhit
            alive &= ~newhit
            t = torch.where(alive, t + d.clamp_min(2e-3) * 0.9, t)
            alive &= t < 3.2
            if not bool(alive.any()):
                break
        zh = z0 + t
        nearness = ((0.6 - zh) / 1.6).clamp(0, 1)                    # front (-1) -> 1, the sides (~0) -> ~0.4
        val = torch.where(hit, edge + (near - edge) * nearness, torch.zeros_like(t))
        dz = torch.zeros(height, width, device=dev)
        mz = torch.zeros(height, width, device=dev)
        dz[inside] = val
        mz[inside] = hit.float()
        depth[f] = dz.cpu()
        mask[f] = mz.cpu()
        bar.update()
    return depth, mask


class ValisDepthShape:
    DESCRIPTION = "A spinning solid as depth + mask: hide it in a stereogram or a kinetogram, or place it into a scene."

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
                    "shape": (SHAPES, {"default": "torus"}),
                    "frames": ("INT", {"default": 96, "min": 1, "max": 4096}),
                    "width": ("INT", {"default": 512, "min": 64, "max": 4096, "step": 8}),
                    "height": ("INT", {"default": 512, "min": 64, "max": 4096, "step": 8}),
                    "size": ("FLOAT", {"default": 0.85, "min": 0.05, "max": 1.5, "step": 0.01, "tooltip": "share of the short side"}),
                    "spin_x": ("FLOAT", {"default": 0.5, "min": -16.0, "max": 16.0, "step": 0.05, "tooltip": "turns over the clip"}),
                    "spin_y": ("FLOAT", {"default": 1.0, "min": -16.0, "max": 16.0, "step": 0.05}),
                    "spin_z": ("FLOAT", {"default": 0.0, "min": -16.0, "max": 16.0, "step": 0.05}),
                    "tilt_x": ("FLOAT", {"default": 20.0, "min": -180.0, "max": 180.0, "step": 1.0, "tooltip": "degrees at frame 0"}),
                    "edge": ("FLOAT", {"default": 0.35, "min": 0.0, "max": 1.0, "step": 0.01, "tooltip": "depth of the farthest visible surface"}),
                    "near": ("FLOAT", {"default": 1.0, "min": 0.0, "max": 1.0, "step": 0.01}),
                }}

    RETURN_TYPES = ("IMAGE", "MASK")
    RETURN_NAMES = ("depth", "mask")
    FUNCTION = "run"
    CATEGORY = CAT

    def run(self, shape, frames, width, height, size, spin_x, spin_y, spin_z, tilt_x, edge, near):
        with torch.no_grad():
            d, m = render_shape(shape, frames, width, height, size, (spin_x, spin_y, spin_z), (tilt_x, 0.0, 0.0),
                                edge, near)
        return (_to_image(d), m)


def _background(kind, frames, h, w, level, amount):
    yy = torch.linspace(0, 1, h)[:, None].expand(h, w)
    xx = torch.linspace(0, 1, w)[None, :].expand(h, w)
    out = torch.zeros(frames, h, w)
    for f in range(frames):
        if kind == "tilt":                                           # a floor: the bottom comes toward you
            z = level + amount * yy
        elif kind == "waves":
            ph = 2 * math.pi * f / 96.0
            z = level + amount * 0.5 * (1 + torch.sin(2 * math.pi * (xx * 2.0 + yy * 1.3) + ph)
                                        * torch.cos(2 * math.pi * yy * 1.7 - 0.7 * ph))
        else:
            z = torch.full((h, w), float(level))
        out[f] = z
    return out.clamp(0, 1)


class ValisDepthPlace:
    DESCRIPTION = ("Put a depth (and its mask) into a scene depth: where, how big, how near, a straight move across "
                   "the clip, the frame it enters on. Nearest wins. Chain one per thing; without a scene it starts "
                   "from a field (flat, a tilted floor, or slow waves).")

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
                    "depth": ("IMAGE",),
                    "width": ("INT", {"default": 0, "min": 0, "max": 8192, "step": 8, "tooltip": "canvas without a scene (0 = the depth's size)"}),
                    "height": ("INT", {"default": 0, "min": 0, "max": 8192, "step": 8}),
                    "x": ("FLOAT", {"default": 0.5, "min": -1.0, "max": 2.0, "step": 0.01, "tooltip": "centre, share of the width"}),
                    "y": ("FLOAT", {"default": 0.5, "min": -1.0, "max": 2.0, "step": 0.01}),
                    "scale": ("FLOAT", {"default": 1.0, "min": 0.01, "max": 8.0, "step": 0.01, "tooltip": "height as a share of the canvas height"}),
                    "x_end": ("FLOAT", {"default": -9.0, "min": -9.0, "max": 2.0, "step": 0.01, "tooltip": "where it ends up (-9 = stays put)"}),
                    "y_end": ("FLOAT", {"default": -9.0, "min": -9.0, "max": 2.0, "step": 0.01}),
                    "scale_end": ("FLOAT", {"default": 0.0, "min": 0.0, "max": 8.0, "step": 0.01, "tooltip": "0 = keeps its size"}),
                    "depth_gain": ("FLOAT", {"default": 1.0, "min": 0.0, "max": 4.0, "step": 0.01}),
                    "depth_offset": ("FLOAT", {"default": 0.0, "min": -1.0, "max": 1.0, "step": 0.01}),
                    "start_frame": ("INT", {"default": 0, "min": 0, "max": 100000}),
                    "when_shorter": (["loop", "hold", "leave"], {"default": "loop", "tooltip": "when the scene runs longer than the thing"}),
                    "field": (["flat", "tilt", "waves"], {"default": "flat"}),
                    "field_depth": ("FLOAT", {"default": 0.0, "min": 0.0, "max": 1.0, "step": 0.01}),
                    "field_amount": ("FLOAT", {"default": 0.15, "min": 0.0, "max": 1.0, "step": 0.01}),
                },
                "optional": {"mask": ("MASK",), "scene": ("IMAGE",)}}

    RETURN_TYPES = ("IMAGE", "MASK")
    RETURN_NAMES = ("depth", "mask")
    FUNCTION = "run"
    CATEGORY = CAT

    def run(self, depth, width, height, x, y, scale, x_end, y_end, scale_end, depth_gain, depth_offset, start_frame,
            when_shorter, field, field_depth, field_amount, mask=None, scene=None):
        obj = _depth_tensor(depth.cpu())
        Bo, ho, wo = obj.shape
        om = _mask_tensor(mask.cpu()) if mask is not None else (obj > 1e-3).float()
        if om.shape[-2:] != (ho, wo):
            om = _resize_bhw(om, ho, wo)
        if scene is not None:
            out = _depth_tensor(scene.cpu()).clone()
            B, H, W = out.shape
        else:
            H = height or ho
            W = width or wo
            B = start_frame + Bo
            out = _background(field, B, H, W, field_depth, field_amount)
        placed = torch.zeros(B, H, W)
        x1 = x if x_end < -8 else x_end
        y1 = y if y_end < -8 else y_end
        s1 = scale if scale_end <= 0 else scale_end
        yy = torch.arange(H, dtype=torch.float32)[:, None].expand(H, W) + 0.5
        xx = torch.arange(W, dtype=torch.float32)[None, :].expand(H, W) + 0.5
        shown = min(Bo, B - start_frame) if when_shorter == "leave" else B - start_frame
        for t in range(B):
            k = t - start_frame
            if k < 0:
                continue
            if k >= Bo:
                if when_shorter == "leave":
                    continue
                k = k % Bo if when_shorter == "loop" else Bo - 1
            a = (t - start_frame) / max(1, shown - 1)               # the move runs over the frames it is on screen
            cx, cy, s = (x + (x1 - x) * a) * W, (y + (y1 - y) * a) * H, scale + (s1 - scale) * a
            oh = s * H
            ow = oh * wo / ho
            grid = torch.stack([(xx - cx) / (ow / 2.0), (yy - cy) / (oh / 2.0)], -1)[None]
            dz = F.grid_sample(obj[k][None, None], grid, mode="bilinear", align_corners=False, padding_mode="zeros")[0, 0]
            mz = F.grid_sample(om[k][None, None], grid, mode="bilinear", align_corners=False, padding_mode="zeros")[0, 0]
            m = mz > 0.5
            dz = (dz / mz.clamp_min(1e-3)) * depth_gain + depth_offset    # undo the edge darkening of the resample
            out[t] = torch.where(m, torch.maximum(out[t], dz.clamp(0, 1)), out[t])
            placed[t] = m.float()
        return (_to_image(out), placed)


# ----------------------------------------------------------------------------------------------------- pattern node

_GLYPHS = "ABCDEFGHJKLMNPQRSTUVWXYZ0123456789#$%&*+=?@<>/\\|"


class ValisStereoPattern:
    DESCRIPTION = ("The dots a stereogram or kinetogram is made of, as frames you can grade, blur or swap for any "
                   "picture (a Valis render, glyphs, film). Stereograms use a strip one period wide from the middle.")

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
                    "kind": (["dots", "snow", "color", "palette", "glyphs"], {"default": "snow"}),
                    "width": ("INT", {"default": 256, "min": 16, "max": 8192, "step": 8}),
                    "height": ("INT", {"default": 1080, "min": 16, "max": 8192, "step": 8}),
                    "frames": ("INT", {"default": 1, "min": 1, "max": 4096, "tooltip": "1 = one pattern held"}),
                    "dot_size": ("INT", {"default": 3, "min": 1, "max": 64}),
                    "density": ("FLOAT", {"default": 0.5, "min": 0.01, "max": 0.99, "step": 0.01, "tooltip": "dots: share of light dots"}),
                    "palette": ("STRING", {"default": "#0b0b10, #f2efe6, #d4462f, #2f6fd4", "tooltip": "palette / glyph colours, HEX, comma separated (glyphs: first = paper)"}),
                    "seed": ("INT", {"default": 0, "min": 0, "max": 0xFFFFFFFF}),
                }}

    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("pattern",)
    FUNCTION = "run"
    CATEGORY = CAT

    def run(self, kind, width, height, frames, dot_size, density, palette, seed):
        out = torch.zeros(frames, height, width, 3)
        pal = _parse_hex(palette)
        for f in range(frames):
            gen = torch.Generator().manual_seed(int(seed) + 7919 * f)
            if kind == "glyphs":
                out[f] = torch.from_numpy(_glyph_frame(width, height, max(6, dot_size * 4), pal, gen))
                continue
            hc, wc = -(-height // dot_size), -(-width // dot_size)
            k = "color" if kind == "color" else ("dots" if kind == "dots" else "snow")
            cells = _cells(k, hc, wc, gen, density, pal if kind == "palette" and pal else None)
            out[f] = _upsample_cells(cells, height, width, dot_size)
        return (out,)


def _glyph_frame(w, h, cell, pal, gen):
    """Random characters on paper (first palette colour), inked in the others: drawn by the Valis Static painter."""
    paper = pal[0] if pal else [0.0, 0.0, 0.0]
    inks = pal[1:] if len(pal) > 1 else None
    k = Static("ascii", "white", "palette" if inks else "black & white", inks, _GLYPHS, cell, cell, paper)
    return k.frame(h, w, gen).clamp(0, 1).numpy()


# ------------------------------------------------------------------------------------------------ stereogram node

def render_stereogram(z, P, D, viewing="parallel", anchor="center", kind="snow", dot_size=3, refresh_every=1,
                      drift=0.0, guide=True, seed=0, pattern=None, chunk=8, device=None, frame_offset=0, grid=True,
                      static=None):
    """z [B,H,W] (CPU, 0..1, 1 = near) -> frames [B,H,W,3] (CPU). frame_offset: where this batch sits in a longer
    video, so refresh and drift carry on across pieces rendered separately.

    grid: generated static (kind / dot_size, or a Static kernel) is drawn on its own cell grid (one cell = one dot or
    character) and then painted, so a depth edge falls between whole cells instead of slicing them into slivers;
    sliced and stretched dots repeat once per period and show the hidden thing's outline to anyone not fusing. P
    must then be a multiple of the cell width (Valis Stereogram rounds it)."""
    dev = device or _device()
    B, H, W = z.shape
    k = static if static is not None else Static.from_kind(kind, dot_size)
    cells = grid and pattern is None                 # drawn cell by cell (any generated static)
    gx, gy = (k.cw, k.ch) if cells else (1, 1)
    if gx > 1 and P % gx:
        P = max(8 * gx, int(round(P / gx)) * gx)
        D = min(D, P - 6)
    Hl, Wl = -(-H // gy), -(-W // gx)
    Pl, Dl = P / gx, D / gx
    out = torch.empty(B, H, W, 3)
    T = strip_width(Pl, Dl)
    strips = {}

    def strip_for(t):
        if pattern is not None:
            key = ("p", t % pattern.shape[0])
            if key not in strips:
                strips[key] = _strip_from_image(pattern[key[1]], H, 2 * T)
            s = strips[key]
        else:
            r = 0 if refresh_every <= 0 else t // refresh_every
            key = ("r", r)
            if key not in strips:
                if len(strips) > 64:
                    strips.clear()
                gen = torch.Generator().manual_seed(int(seed) * 1000003 + r)
                if cells:                            # seed half repeats every period (no seam), then fresh cells
                    strips[key] = torch.cat([k.cells(Hl, T, gen, period=int(round(Pl))), k.cells(Hl, T, gen)], 1)
                else:
                    strips[key] = k.frame(H, 2 * T, gen)
            s = strips[key]
        if drift:
            s = torch.roll(s, shifts=int(math.floor(drift * t / gy)) % s.shape[0], dims=0)
        return s

    bar = _Progress(B)
    for b0 in range(0, B, chunk):
        _check_interrupt()
        b1 = min(B, b0 + chunk)
        zc = z[b0:b1].to(dev).float().clamp(0, 1)
        if cells and (Hl, Wl) != (H, W):
            zc = F.interpolate(zc[:, None], size=(Hl, Wl), mode="area")[:, 0]
        u = stereo_coords(zc, Pl, Dl, viewing, anchor, cells=cells, dither=k.row_dither)
        st = torch.stack([strip_for(frame_offset + t) for t in range(b0, b1)]).to(dev)
        if cells:
            i = u.long() % st.shape[2]
            vals = torch.gather(st, 2, i[..., None].expand(-1, -1, -1, st.shape[3]))
            fr = k.paint(vals)[:, :H, :W]
            del vals
        else:
            fr = sample_strip(st, u)
        fr = fr.clamp(0, 1).contiguous()
        if guide:
            fr = _guide_dots(fr, P)
        out[b0:b1] = fr.cpu()
        bar.update(b1 - b0)
    return out


class ValisStereogram:
    DESCRIPTION = ("The hidden picture: the depth becomes repeat distances in a field of dots. Free-view it "
                   "(relax your eyes through the screen for parallel, cross them for cross) until the two guide dots "
                   "become three, and the thing stands out of the field. Fresh dots every frame (the default) look "
                   "like TV snow, as in Black Is Good. Generated dots are drawn on their own grid, so no dot is cut "
                   "or stretched by the hidden thing: a still frame shows nothing to anyone not fusing, and the "
                   "picture survives uploads (1080p, 6 px dots, H.264 capped at 3 Mb/s: the hidden dancers still "
                   "matched 0.87 in Valis Stereo Decode). Held dots (refresh 0) show a moving thing as copies "
                   "repeating across the frame.")

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
                    "depth": ("IMAGE", {"tooltip": "white = near; a MASK-made depth, Depth Anything 3, a body mesh render..."}),
                    "period": ("INT", {"default": 0, "min": 0, "max": 2048, "tooltip": "repeat distance of the field, px (0 = width / 9). Keep it under your eye spacing on the screen it plays on"}),
                    "strength": ("FLOAT", {"default": 0.18, "min": 0.02, "max": 0.4, "step": 0.01, "tooltip": "the deepest depth, as a share of the period (more = deeper but harder to fuse)"}),
                    "viewing": (["parallel", "cross"], {"default": "parallel"}),
                    "anchor": (["center", "left"], {"default": "center"}),
                    "kind": (KINDS, {"default": "dots", "tooltip": "the dots when no pattern is connected: black and white, grey TV snow, or colour (colour detail is the first thing a codec drops)"}),
                    "dot_size": ("INT", {"default": 6, "min": 1, "max": 32, "tooltip": "px; bigger dots survive upload compression better (6 at 1080p)"}),
                    "refresh_every": ("INT", {"default": 1, "min": 0, "max": 10000, "tooltip": "new dots every N frames: 1 = TV snow, 2 = half the bits, 0 = the same dots throughout (cheapest to upload, but a moving thing shows as copies across the frame)"}),
                    "drift": ("FLOAT", {"default": 0.0, "min": -64.0, "max": 64.0, "step": 0.25, "tooltip": "slide the dots down (px per frame); keeps the depth, adds flow"}),
                    "guide_dots": ("BOOLEAN", {"default": True}),
                    "seed": ("INT", {"default": 0, "min": 0, "max": 0xFFFFFFFF}),
                    "width": ("INT", {"default": 0, "min": 0, "max": 8192, "step": 2, "tooltip": "output size (0 = the depth's)"}),
                    "height": ("INT", {"default": 0, "min": 0, "max": 8192, "step": 2}),
                    "depth_far_is_white": ("BOOLEAN", {"default": False}),
                },
                "optional": {"static": ("VALIS_STATIC", {"tooltip": "what the dots are (Valis Static: halftone, ASCII, noise colours, RGB, palettes); replaces kind and dot_size"}),
                             "pattern": ("IMAGE", {"tooltip": "any picture or clip as the dots (Valis Stereo Pattern, a render)"}),
                             "frame_offset": ("INT", {"default": 0, "min": 0, "max": 10000000, "tooltip": "the first frame's place in a longer video rendered in pieces: the dots carry on across the cut"})}}

    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("frames",)
    FUNCTION = "run"
    CATEGORY = CAT

    def run(self, depth, period, strength, viewing, anchor, kind, dot_size, refresh_every, drift, guide_dots, seed,
            width, height, depth_far_is_white, static=None, pattern=None, frame_offset=0):
        z = _depth_tensor(depth.cpu())
        if depth_far_is_white:
            z = 1.0 - z
        H = height or z.shape[1]
        W = width or z.shape[2]
        z = _resize_bhw(z, H, W)
        P = _auto_period(W, period)
        cw = static.cw if static is not None else dot_size
        if cw > 1 and pattern is None:                           # drawn on the cell grid: whole cells per period
            P = max(8 * cw, int(round(P / cw)) * cw)
        D = min(strength * P, P - 6)
        with torch.no_grad():
            fr = render_stereogram(z, P, D, viewing, anchor, kind, dot_size, refresh_every, drift, guide_dots, seed,
                                   pattern.cpu() if pattern is not None else None, frame_offset=frame_offset,
                                   static=static)
        return (fr,)


# ---------------------------------------------------------------------------------------------------- kinetogram

def _centroids(m):
    B = m.shape[0]
    H, W = m.shape[1:]
    yy = torch.arange(H, dtype=torch.float32)[:, None]
    xx = torch.arange(W, dtype=torch.float32)[None, :]
    out = []
    last = (W / 2.0, H / 2.0)
    for i in range(B):
        s = float(m[i].sum())
        if s > 4:
            last = (float((m[i] * xx).sum()) / s, float((m[i] * yy).sum()) / s)
        out.append(last)
    return out


def _flow_fields(images, H, W, cw=1, ch=1):
    """Forward optical flow of the clip (Farneback, on a small copy), frame t-1 -> t, at the cell grid and in
    cells. [B, ceil(H/ch), ceil(W/cw), 2] float32 (frame 0 is zero)."""
    import cv2
    g = _grey(images.cpu()).numpy()
    B = g.shape[0]
    hc, wc = -(-H // ch), -(-W // cw)
    sw = min(W, 480)
    sh = max(8, int(round(H * sw / W)))
    small = [cv2.resize((np.clip(g[i], 0, 1) * 255).astype(np.uint8), (sw, sh), interpolation=cv2.INTER_AREA)
             for i in range(B)]
    out = np.zeros((B, hc, wc, 2), np.float32)
    for t in range(1, B):
        fl = cv2.calcOpticalFlowFarneback(small[t - 1], small[t], None, 0.5, 3, 21, 3, 5, 1.1, 0)
        fl = cv2.resize(fl, (wc, hc), interpolation=cv2.INTER_AREA) * (W / sw)
        out[t] = fl / np.array([cw, ch], np.float32)
    return out


class _Thing:
    """One thing of a kinetogram on the cell grid: which of its own dots sits in which cell, frame by frame.

    follow / drift only: the thing's dots are one texture slid along with the mask (and the drift): a rigid move,
    so every cell takes a different dot and the dots stay put relative to each other.
    flow: every dot rides the clip's optical flow on its own, for a limited life (a limited-lifetime random-dot
    kinematogram). Where dots bunch up, one stays; where they spread, new dots are born; every dot is reborn
    somewhere after about `life` frames. Without that, flow drags the dots into streaks and smears (one dot
    copied across many cells), which a paused frame shows."""

    def __init__(self, k, mask, motion, dx, dy, seed, H, W, images=None, life=24):
        self.k, self.m, self.motion = k, mask, motion
        self.H, self.W = H, W
        self.cw, self.ch = k.cw, k.ch
        self.hc, self.wc = -(-H // k.ch), -(-W // k.cw)
        self.dx, self.dy = dx, dy
        self.seed = int(seed)
        self.life = max(2, int(life))
        H0, W0 = mask.shape[1:]
        self.sx, self.sy = W / float(W0), H / float(H0)
        self.tex = k.cells(self.hc, self.wc, torch.Generator().manual_seed(self.seed * 1000003 + 999331))
        self.cents = _centroids((mask > 0.5).float()) if motion == "follow" else None
        self.flow = None
        if motion == "flow":
            if images is None:
                raise ValueError("motion = flow needs the clip connected to images")
            self.flow = torch.from_numpy(_flow_fields(images, H, W, self.cw, self.ch))
        self.jx = (torch.arange(self.wc, dtype=torch.float32) + 0.5)[None, :].expand(self.hc, self.wc) * self.cw
        self.iy = (torch.arange(self.hc, dtype=torch.float32) + 0.5)[:, None].expand(self.hc, self.wc) * self.ch
        self.p = None                                       # flow dots: position (cells), value, age, life

    def mask_cells(self, t):
        m = self.m[min(t, self.m.shape[0] - 1)].float()
        return F.interpolate(m[None, None], size=(self.hc, self.wc), mode="area")[0, 0] > 0.5

    def step(self, t):
        """Frame t (call t = 0, 1, 2... in order) -> (cells the thing covers [hc,wc] bool, its dots [hc,wc,4])."""
        mt = self.mask_cells(t)
        if self.flow is None:
            dx, dy = self.dx * t, self.dy * t
            if self.cents is not None:
                c = self.cents
                dx += (c[min(t, len(c) - 1)][0] - c[0][0]) * self.sx
                dy += (c[min(t, len(c) - 1)][1] - c[0][1]) * self.sy
            ix = torch.remainder(torch.floor((self.jx - dx) / self.cw).long(), self.wc)
            iy = torch.remainder(torch.floor((self.iy - dy) / self.ch).long(), self.hc)
            return mt, self.tex[iy, ix]
        hc, wc = self.hc, self.wc
        gen = torch.Generator().manual_seed(self.seed * 1000003 + 555557 + t)
        if self.p is None:
            pos = torch.zeros(0, 2)
            val = torch.zeros(0, 4)
            age = torch.zeros(0, dtype=torch.long)
            life = torch.zeros(0, dtype=torch.long)
        else:
            pos, val, age, life = self.p
            fl = self.flow[min(t, self.flow.shape[0] - 1)]
            ri = pos[:, 1].round().long().clamp(0, hc - 1)
            rj = pos[:, 0].round().long().clamp(0, wc - 1)
            pos = pos + fl[ri, rj] + torch.tensor([self.dx / self.cw, self.dy / self.ch])
            age = age + 1
        ri, rj = pos[:, 1].round().long(), pos[:, 0].round().long()
        inside = (ri >= 0) & (ri < hc) & (rj >= 0) & (rj < wc)
        ok = inside & (age <= life)
        ok[ok.clone()] = mt[ri[ok], rj[ok]]                 # dots that left the thing die
        lin = torch.where(ok, ri.clamp(0, hc - 1) * wc + rj.clamp(0, wc - 1), torch.full_like(ri, -1))
        occ = torch.full((hc * wc,), -1, dtype=torch.long)
        ids = torch.arange(pos.shape[0])
        if ok.any():
            occ.scatter_reduce_(0, lin[ok], ids[ok], reduce="amax")     # bunched-up dots: one stays
            keep = ok.clone()
            keep[ok] = occ[lin[ok]] == ids[ok]
        else:
            keep = ok
        pos, val, age, life = pos[keep], val[keep], age[keep], life[keep]
        occ = torch.full((hc * wc,), -1, dtype=torch.long)
        if pos.shape[0]:
            occ[(pos[:, 1].round().long() * wc + pos[:, 0].round().long())] = torch.arange(pos.shape[0])
        born = (occ.view(hc, wc) < 0) & mt                  # empty cells of the thing: new dots
        bi, bj = born.nonzero(as_tuple=True)
        if t == 0:
            bval = self.tex[bi, bj]
            blife = torch.randint(self.life // 2, self.life * 3 // 2 + 1, (bi.shape[0],), generator=gen)
            bage = torch.randint(0, self.life, (bi.shape[0],), generator=gen).clamp(max=blife - 1)   # staggered
        else:
            bval = self.k.cells(hc, wc, gen)[bi, bj]
            blife = torch.randint(self.life // 2, self.life * 3 // 2 + 1, (bi.shape[0],), generator=gen)
            bage = torch.zeros(bi.shape[0], dtype=torch.long)
        jit = torch.rand(bi.shape[0], 2, generator=gen) * 0.98 - 0.49   # each dot its own place inside its cell, so
        pos = torch.cat([pos, torch.stack([bj.float(), bi.float()], 1) + jit])   # a slow, even flow steps them one by one
        val = torch.cat([val, bval])
        age = torch.cat([age, bage])
        life = torch.cat([life, blife])
        self.p = (pos, val, age, life)
        ob = torch.zeros(hc, wc, 4)
        ob[pos[:, 1].round().long(), pos[:, 0].round().long()] = val
        return mt, ob


class ValisKinetogram:
    DESCRIPTION = ("The thing is made of the same dots as the field, and you see it only because its dots move "
                   "together while the field is live TV static (fresh dots every frame). Pause on any frame and it "
                   "is gone. 'follow' moves its dots with the mask, 'flow' with the footage's own motion (connect "
                   "the clip), and drift keeps a still thing visible. Chain: connect the last kinetogram as the field "
                   "to give each thing its own motion.")

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
                    "mask": ("MASK",),
                    "motion": (["follow", "flow", "drift only"], {"default": "follow"}),
                    "drift_x": ("FLOAT", {"default": 0.0, "min": -64.0, "max": 64.0, "step": 0.25, "tooltip": "the thing's dots slide this much per frame on top of its motion"}),
                    "drift_y": ("FLOAT", {"default": 1.5, "min": -64.0, "max": 64.0, "step": 0.25}),
                    "kind": (KINDS, {"default": "dots"}),
                    "dot_size": ("INT", {"default": 4, "min": 1, "max": 32}),
                    "field_drift_x": ("FLOAT", {"default": 0.0, "min": -64.0, "max": 64.0, "step": 0.25}),
                    "field_drift_y": ("FLOAT", {"default": 0.0, "min": -64.0, "max": 64.0, "step": 0.25}),
                    "seed": ("INT", {"default": 0, "min": 0, "max": 0xFFFFFFFF}),
                },
                "optional": {
                    "images": ("IMAGE", {"tooltip": "the clip, for motion = flow"}),
                    "field": ("IMAGE", {"tooltip": "frames to use as the field (e.g. another kinetogram)"}),
                    "field_refresh": ("INT", {"default": 1, "min": 0, "max": 10000, "tooltip": "new field dots every N frames: 1 = live TV static, 0 = a still field (then the thing shows as the only moving part)"}),
                    "static": ("VALIS_STATIC", {"tooltip": "what the dots are (Valis Static); replaces kind and dot_size. Chained kinetograms should share one"}),
                    "width": ("INT", {"default": 0, "min": 0, "max": 8192, "step": 2, "tooltip": "output size (0 = the mask's)"}),
                    "height": ("INT", {"default": 0, "min": 0, "max": 8192, "step": 2}),
                    "dot_life": ("INT", {"default": 24, "min": 2, "max": 1000, "tooltip": "motion = flow: frames a dot rides the motion before it is reborn somewhere new (so dots never bunch into streaks)"}),
                }}

    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("frames",)
    FUNCTION = "run"
    CATEGORY = CAT

    def run(self, mask, motion, drift_x, drift_y, kind, dot_size, field_drift_x, field_drift_y, seed, images=None,
            field=None, field_refresh=1, static=None, width=0, height=0, dot_life=24):
        """Drawn on the cell grid: the thing's outline falls between whole cells and its cells step a whole cell at
        a time, so a paused frame has one unbroken grid of dots (or characters) and nothing to see."""
        k = static if static is not None else Static.from_kind(kind, dot_size)
        m = _mask_tensor(mask.cpu())
        H0, W0 = m.shape[1:]
        H, W = height or H0, width or W0
        B = m.shape[0]
        fl = None
        if field is not None:
            fl = field.cpu()[..., :3].float()
            B = max(B, fl.shape[0])
            if fl.shape[1:3] != (H, W):
                fl = F.interpolate(fl.permute(0, 3, 1, 2), size=(H, W), mode="nearest").permute(0, 2, 3, 1)
        cw, ch = k.cw, k.ch
        hc, wc = -(-H // ch), -(-W // cw)
        thing = _Thing(k, m, motion, drift_x, drift_y, seed, H, W, images, dot_life)
        held = None
        out = torch.empty(B, H, W, 3)
        bar = _Progress(B)
        for t in range(B):
            _check_interrupt()
            mt, ob = thing.step(t)
            if fl is None:
                r = t // field_refresh if field_refresh > 0 else 0       # live static: fresh field dots
                if held is None or held[0] != r:
                    held = (r, k.cells(hc, wc, torch.Generator().manual_seed(int(seed) * 1000003 + 17 + r)))
                bg = held[1]
                if field_drift_x or field_drift_y:
                    bg = torch.roll(bg, (int(math.floor(field_drift_y * t / ch)), int(math.floor(field_drift_x * t / cw))), (0, 1))
                out[t] = k.paint(torch.where(mt[..., None], ob, bg)[None])[0, :H, :W]
            else:
                px = k.paint(ob[None])[0, :H, :W]
                mp = mt.repeat_interleave(ch, 0).repeat_interleave(cw, 1)[:H, :W]
                out[t] = torch.where(mp[..., None], px, fl[t % fl.shape[0]])
            bar.update()
        return (out,)


# -------------------------------------------------------------------------------------------------------- decode

def h264_roundtrip(frames, fps=24, mbps=8.0, preset="medium"):
    """IMAGE frames [B,H,W,3] (float 0..1) -> uint8 frames [B,H,W,3] after an H.264 (yuv420p) encode at about
    mbps, and the bitrate it really made. Converts one frame at a time to keep memory down."""
    import io
    import av
    B, H, W = frames.shape[:3]
    He, We = H - H % 2, W - W % 2
    buf = io.BytesIO()
    out = av.open(buf, mode="w", format="mp4")
    st = out.add_stream("h264", rate=int(fps))
    st.width, st.height, st.pix_fmt = We, He, "yuv420p"
    st.bit_rate = int(mbps * 1e6)
    try:                                         # a hard cap, as a platform's transcode has (x264 alone overshoots)
        st.options = {"preset": preset, "maxrate": str(int(mbps * 1e6)), "bufsize": str(int(2 * mbps * 1e6))}
    except Exception:
        pass
    for i in range(B):
        f = (frames[i, :He, :We, :3].clamp(0, 1) * 255 + 0.5).byte().numpy()
        for p in st.encode(av.VideoFrame.from_ndarray(np.ascontiguousarray(f), format="rgb24")):
            out.mux(p)
    for p in st.encode():
        out.mux(p)
    out.close()
    nbytes = buf.tell()
    buf.seek(0)
    dec = np.zeros((B, H, W, 3), np.uint8)
    with av.open(buf, mode="r") as inp:
        for i, fr in enumerate(inp.decode(video=0)):
            if i >= B:
                break
            dec[i, :He, :We] = fr.to_ndarray(format="rgb24")
    return dec, nbytes * 8 / (B / float(fps)) / 1e6


def estimate_period(frames, device=None):
    """The field's repeat distance, read from the picture: the shift where the frame best matches itself (the
    smallest one, so not a multiple of it)."""
    dev = device or _device()
    x = frames[: min(4, frames.shape[0])].to(dev)
    g = _grey(x.float() / 255.0 if x.dtype == torch.uint8 else x)[:, ::4]
    W = g.shape[-1]
    ss = list(range(max(8, W // 24), max(9, W // 4)))
    c = torch.stack([(g[:, :, s:] - g[:, :, :-s]).abs().mean() for s in ss])
    lo = float(c.min())
    ok = (c <= lo + 0.08 * (float(c.median()) - lo)).nonzero()
    return ss[int(ok[0])]


def decode_stereogram(frames, P, D, viewing="parallel", window=9, chunk=2, device=None):
    """frames [B,H,W,3] -> depth [B,H,W] read back from the repeats (block matching on the grey picture)."""
    dev = device or _device()
    B, H, W, C = frames.shape
    window = int(window) | 1                                       # odd, so the matching window has a centre
    cross = viewing == "cross"
    s_lo = int(math.floor(P - (0 if cross else D))) - 1
    s_hi = int(math.ceil(P + (D if cross else 0))) + 1
    shifts = list(range(max(2, s_lo), min(W - 1, s_hi) + 1))
    h = int(P // 2)
    out = torch.zeros(B, H, W)
    for b0 in range(0, B, chunk):
        _check_interrupt()
        x = frames[b0:b0 + chunk].to(dev)
        x = x.float() / 255.0 if x.dtype == torch.uint8 else x.float()
        g = x[..., :3].mean(-1) if C >= 3 else x[..., 0]
        rgb = x[..., :3].permute(0, 3, 1, 2) if C >= 3 else None    # colour static matches on all three channels
        n = g.shape[0]
        costs = []
        for s in shifts:
            c = torch.full_like(g, 4.0)
            if rgb is not None:
                c[:, :, s:] = (rgb[:, :, :, s:] - rgb[:, :, :, :-s]).abs().mean(1)
            else:
                c[:, :, s:] = (g[:, :, s:] - g[:, :, :-s]).abs()
            c = F.avg_pool2d(c[:, None], (1, window), stride=1, padding=(0, window // 2), count_include_pad=False)
            c = F.avg_pool2d(c, (window, 1), stride=1, padding=(window // 2, 0), count_include_pad=False)[:, 0]
            costs.append(c)                                          # (a box window, as two 1-D passes)
        cv = torch.stack(costs, 0)                                 # [S, n, H, W]
        k = cv.argmin(0)
        S = len(shifts)
        km, kp = (k - 1).clamp(0, S - 1), (k + 1).clamp(0, S - 1)
        c0 = cv.gather(0, k[None])[0]
        cm = cv.gather(0, km[None])[0]
        cp = cv.gather(0, kp[None])[0]
        den = (cm - 2 * c0 + cp)
        off = torch.where(den.abs() > 1e-6, 0.5 * (cm - cp) / den, torch.zeros_like(den)).clamp(-0.5, 0.5)
        s = torch.tensor(shifts, device=dev, dtype=torch.float32)[k] + off
        z = ((s - P) / D) if cross else ((P - s) / D)
        z = z.clamp(0, 1)
        z[:, :, :s_hi + window // 2] = 0
        zz = torch.zeros_like(z)                                    # the link from x - s to x reports depth at x - s/2
        zz[:, :, :W - h] = z[:, :, h:]
        out[b0:b0 + n] = zz.cpu()
    return out


class ValisStereoDecode:
    DESCRIPTION = ("Reads the hidden depth back out of stereogram frames: what a fusing viewer's eyes get. With "
                   "codec on, the frames go through an H.264 encode at the bitrate you set first, so you see what "
                   "survives an upload. Connect the depth you hid to get a score.")

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
                    "frames": ("IMAGE",),
                    "period": ("INT", {"default": 0, "min": 0, "max": 2048, "tooltip": "the stereogram's period, px (0 = read it from the frames)"}),
                    "strength": ("FLOAT", {"default": 0.18, "min": 0.02, "max": 0.4, "step": 0.01}),
                    "viewing": (["parallel", "cross"], {"default": "parallel"}),
                    "window": ("INT", {"default": 19, "min": 3, "max": 61, "step": 2, "tooltip": "matching window, px: about three times the dot size"}),
                    "codec": (["none", "h264"], {"default": "h264"}),
                    "bitrate_mbps": ("FLOAT", {"default": 4.0, "min": 0.2, "max": 200.0, "step": 0.1, "tooltip": "a hard cap, as a platform's transcode has"}),
                    "fps": ("INT", {"default": 24, "min": 1, "max": 120}),
                },
                "optional": {"depth": ("IMAGE", {"tooltip": "the depth that was hidden, for the score"})}}

    RETURN_TYPES = ("IMAGE", "IMAGE", "STRING")
    RETURN_NAMES = ("decoded_depth", "frames_after_codec", "report")
    FUNCTION = "run"
    CATEGORY = CAT

    def run(self, frames, period, strength, viewing, window, codec, bitrate_mbps, fps, depth=None):
        fr = frames.cpu()
        B, H, W = fr.shape[:3]
        P = int(period) if period and period > 0 else estimate_period(fr)
        D = min(strength * P, P - 6)
        lines = [f"{B} frames {W}x{H}, period {P}px{'' if period else ' (read from the frames)'}, depth {D:.1f}px, {viewing}"]
        if codec == "h264":
            dec, real = h264_roundtrip(fr, fps, bitrate_mbps)
            fr = torch.from_numpy(dec)                               # uint8 until it leaves the node
            lines.append(f"H.264 at {bitrate_mbps:g} Mb/s asked, {real:.2f} Mb/s made")
        with torch.no_grad():
            z = decode_stereogram(fr, P, D, viewing, window)
        if fr.dtype == torch.uint8:
            fr = fr.float() / 255.0
        if depth is not None:
            ref = _resize_bhw(_depth_tensor(depth.cpu()), H, W)
            n = min(ref.shape[0], B)
            lines.append(score_text(z[:n], ref[:n], P))
        return (_to_image(z), fr, "\n".join(lines))


def score(z, ref, P, thr=0.2):
    """IoU of the near region and mean depth error, leaving out the strip with no repeats on the left."""
    x0 = int(P * 1.5)
    a, b = z[:, :, x0:], ref[:, :, x0:]
    ma, mb = a > thr, b > thr
    inter = (ma & mb).float().sum()
    union = (ma | mb).float().sum().clamp_min(1)
    err = (a - b).abs()
    inside = err[mb].mean() if mb.any() else torch.tensor(0.0)
    return float(inter / union), float(err.mean()), float(inside)


def score_text(z, ref, P):
    iou, mae, inside = score(z, ref, P)
    return f"shape match (IoU) {iou:.3f}; depth error {mae:.3f} overall, {inside:.3f} on the thing"


class ValisStatic:
    DESCRIPTION = ("What the static is made of, for Valis Stereogram and Valis Kinetogram. look: square dots, "
                   "halftone dots or characters (the Valis v1 ASCII sets, a 10 PRINT maze, katakana...). noise: the "
                   "grain, named like the colours of noise in sound: white is even TV snow, pink and brown clump "
                   "into soft blobs (harder to fuse), blue and violet are fine and even with no clumps (easiest to "
                   "fuse). color: black and white, grey, random RGB, 8-colour RGB, colour-TV static or a palette "
                   "(the v1 palettes). Cells are copied whole, so a character is never cut.")

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
                    "look": (LOOKS, {"default": "squares"}),
                    "cell": ("INT", {"default": 4, "min": 1, "max": 32, "tooltip": "px across one dot or character (ASCII cells are 1.6x as tall unless cell_height is set)"}),
                    "noise": (list(SPECTRA), {"default": "white", "tooltip": "white = TV snow; pink, brown = soft clumps; blue, violet = fine even grain"}),
                    "color": (COLORS, {"default": "black & white", "tooltip": "rgb = every dot a random colour; rgb 8 = the eight corners of RGB; tv = snow with colour blotches; palette = the palette below"}),
                    "palette": (list(PALETTES) + ["custom"], {"default": "neon"}),
                    "charset": (list(CHARSETS) + ["custom"], {"default": "minimal", "tooltip": "for look = ascii; light to dense, chosen by the noise"}),
                },
                "optional": {
                    "custom_palette": ("STRING", {"default": "#0b0b10, #f2efe6, #d4462f, #2f6fd4", "tooltip": "HEX, comma separated (palette = custom)"}),
                    "custom_characters": ("STRING", {"default": " .oO@", "tooltip": "light to dense (charset = custom)"}),
                    "paper": ("STRING", {"default": "#000000", "tooltip": "behind halftone dots and characters"}),
                    "cell_height": ("INT", {"default": 0, "min": 0, "max": 64, "tooltip": "px (0 = automatic)"}),
                }}

    RETURN_TYPES = ("VALIS_STATIC", "IMAGE")
    RETURN_NAMES = ("static", "preview")
    FUNCTION = "run"
    CATEGORY = CAT

    def run(self, look, cell, noise, color, palette, charset, custom_palette="", custom_characters=" .oO@",
            paper="#000000", cell_height=0):
        pal = _parse_hex(custom_palette) if palette == "custom" else PALETTES.get(palette)
        chars = (custom_characters or " .oO@") if charset == "custom" else CHARSETS.get(charset)
        pp = _parse_hex(paper)
        k = Static(look, noise, color, pal or PALETTES["neon"], chars, cell, cell_height, pp[0] if pp else (0, 0, 0))
        prev = k.frame(288, 512, torch.Generator().manual_seed(0))[None]
        return (k, prev.clamp(0, 1))


NODE_CLASS_MAPPINGS = {
    "ValisMaskDepth": ValisMaskDepth,
    "ValisDepthShape": ValisDepthShape,
    "ValisDepthPlace": ValisDepthPlace,
    "ValisStatic": ValisStatic,
    "ValisStereoPattern": ValisStereoPattern,
    "ValisStereogram": ValisStereogram,
    "ValisKinetogram": ValisKinetogram,
    "ValisStereoDecode": ValisStereoDecode,
}
NODE_DISPLAY_NAME_MAPPINGS = {
    "ValisMaskDepth": "Valis Mask Depth",
    "ValisDepthShape": "Valis Depth Shape",
    "ValisDepthPlace": "Valis Depth Place",
    "ValisStatic": "Valis Static",
    "ValisStereoPattern": "Valis Stereo Pattern",
    "ValisStereogram": "Valis Stereogram",
    "ValisKinetogram": "Valis Kinetogram",
    "ValisStereoDecode": "Valis Stereo Decode",
}
