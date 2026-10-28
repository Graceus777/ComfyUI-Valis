"""The Valis effects library. Each effect is a layer: it takes the image so far and the context (cues, masks, depth,
flow, other clips) and returns the next image. Every effect names the lane(s) it listens to with `on=` (hits) and/or
`by=` (a held level: a curve, or a hit lane's envelope), so the same effect can be fired by a kick, a note of YuE2's
sheet music, a syllable, or a line in a soundless cue sheet.

    DoubleExposure  a silhouette becomes a window into another scene, screen-printed (halftone, misregistration)
    TimeSlip        another era breaks through: flicker cuts, a light-first bleed, or holes that burn open
    SlitScan        time displacement: depth / height / distance decides how far in the past each pixel is
    Lens            a gravitational lens at a tracked point: space bends, an Einstein ring, a dark core
    Datamosh        the next frame never arrives: the last picture is dragged along the new motion
    Echo            the subject sheds afterimages on each hit: they drift, grow and fade
    Frost           frost grows in from the frame's edges on the hits, dendritic, frosting the glass, and thaws
    Vertigo         a dolly zoom from a subject mask: the subject holds, the world is pushed away (real pixels only)
    Tear            reality rips open along a jagged seam; another scene burns behind it
    Projector       the image becomes a projected film: flicker, gate weave, scratches, dust, burn-in
    Glitch          block displacement and channel split on the hits
    Punch           exposure flash + zoom kick + chromatic split on the hits

The light effects (Flicker, Firelight, Lightning, Sweep, Glow, Haze, Glint, Rim) are in light.py and join the library here.
"""
import math

import cv2
import numpy as np

from .core import blur, grid, lum, screen, smooth, value_noise, warp_pull


def _hit_age(ctx, on):
    a, j = ctx.since(on)
    return a, j


def _amount(ctx, on, by, tau, default=0.0):
    if by is not None:
        return ctx.level(by, tau)
    if on is not None:
        return ctx.env(on, tau)
    return default


# ---------------------------------------------------------------------------------------------------------------
class DoubleExposure:
    """True-Detective-style double exposure, built the way the in-camera trick works: the subject is shot high-key
    against white (so its surroundings expose to paper), the second exposure (another scene) only prints where the
    subject was dark. Valis does it with the SAM mask: outside the silhouette is paper; inside, the subject's own
    light (contrast pushed, so the face's highlights stay) is screened over the other scene, which drifts on its own
    slow clock. Then it is screen-printed: halftone in the midtones, a rough inked edge, a warm plate misregistered
    a few pixels that jumps on hits, paper grain. Hits flash the inner scene, swell the window, breathe the dots.
    texture (0..1) scales all of the print (dots, misregistration, paper, torn edge): 1 is the full screen print, 0
    leaves a clean double exposure (default .08: a trace of it). grain: film grain over the result instead (fine, monochrome, new
    every frame, strongest in the midtones); 0 turns it off."""

    def __init__(self, window="subject", inner="b", on=None, by=None, amount=1.0, outside="paper", paper=(.94, .91, .84),
                 ink=(.09, .08, .08), tint=(1.0, .62, .30), face=.75, sat=.55, halftone=.45, cell=6, misreg=3, drift=(6, -3),
                 zoom=1.15, rough=.6, tau=.45, seed=7, invert=False, feather=10, texture=.08, grain=.03):
        self.__dict__.update(locals()); del self.__dict__["self"]
        self.paper, self.ink, self.tint = (np.array(x, np.float32) for x in (paper, ink, tint))
        self._tex = None

    def _static(self, ctx):
        if self._tex is None:
            H, W = ctx.H, ctx.W
            r = np.random.default_rng(self.seed)
            grain = value_noise(H, W, 3, self.seed, 3)
            fib = blur(r.random((H, W)).astype(np.float32), .6)
            self._tex = (.95 + .05 * grain) * (.975 + .025 * fib)
            self._edge = value_noise(H, W, 18, self.seed + 1, 4)
            self._blot = value_noise(H, W, 240, self.seed + 3, 2)
            xx, yy = grid(H, W)
            self._uv = ((xx + yy) / math.sqrt(2), (xx - yy) / math.sqrt(2))
        return self._tex

    def __call__(self, ctx, img):
        H, W = ctx.H, ctx.W
        tex = self._static(ctx)
        e = ctx.env(self.on, self.tau) if self.on else 0.0
        amt = self.amount * (ctx.level(self.by) if self.by else 1.0)
        if amt <= 1e-3:
            return img
        m = ctx.mask(self.window, soft=1.5)
        if self.invert:
            m = 1 - m
        # the window: swelled by hits, feathered, its edge torn by the print's roughness
        mb = blur(m, self.feather * (1 + e))
        tx = float(np.clip(self.texture, 0, 1))
        m = smooth(.5 - .1 * e - .18, .5 - .1 * e + .18, mb + (self._edge - .5) * self.rough * (.4 + .6 * tx) * .8 * (1 - np.abs(mb * 2 - 1)))
        # the other scene: its own slow drift and zoom, contrast up, colour pulled toward the warm ink
        t = ctx.t
        b = ctx.clip(self.inner)
        sc = self.zoom * (1 + .015 * t)
        M = cv2.getRotationMatrix2D((W / 2 + self.drift[0] * t, H / 2 + self.drift[1] * t), 0, sc)
        b = cv2.warpAffine(b, M, (W, H), borderMode=cv2.BORDER_REFLECT_101)
        bl = lum(b)
        bg = smooth(.04, .9, bl)[..., None]
        b = (b * self.sat + bg * (1 - self.sat)) * (self.tint * .35 + .65)
        b = np.clip(b * (1 + .5 * e), 0, 1)
        # first exposure: the subject high-key (its surroundings blown to paper), second: the scene where it was dark
        a = smooth(.08, .78, lum(img))[..., None] * self.face
        first = self.paper * (1 - m[..., None]) + (self.paper * a) * m[..., None]
        comp = screen(first, b * m[..., None])
        if self.outside == "plate":
            comp = comp * m[..., None] + (lum(img)[..., None] * .4 + self.paper * .6) * (1 - m[..., None])
        elif self.outside == "dark":
            comp = comp * m[..., None] + self.ink * (1 - m[..., None])
        comp = comp * (1 - .05 * tx * smooth(.6, 1, self._blot))[..., None]
        # screen print: halftone dots in the midtones of the ink, never on bare paper
        L = lum(comp)
        cell = self.cell * (1 + .3 * e)
        u, v = self._uv
        fu = (u / cell) % 1 - .5; fv = (v / cell) % 1 - .5
        dist = np.sqrt(fu * fu + fv * fv)
        rad = np.sqrt(np.clip(1 - L, 0, 1)) * .62
        dots = smooth(rad + .07, rad - .07, dist)
        ht = (self.halftone * tx * smooth(.92, .7, L) * smooth(.02, .25, L))[..., None]
        printed = comp * (1 - ht) + (self.paper * (1 - dots[..., None]) + self.ink * dots[..., None]) * ht
        # misregistration: the warm plate slips on each hit and settles
        a_, j = ctx.since(self.on) if self.on else (math.inf, 0)
        r = np.random.default_rng(self.seed + max(j, 0) * 13)
        ang = r.uniform(0, 2 * math.pi)
        sh = self.misreg * tx * (.4 + (1.6 * math.exp(-a_ / .3) if a_ < math.inf else 0))
        Mx = np.float32([[1, 0, sh * math.cos(ang)], [0, 1, sh * math.sin(ang)]])
        warm = cv2.warpAffine(printed, Mx, (W, H), borderMode=cv2.BORDER_REFLECT_101)
        printed = np.stack([np.minimum(warm[..., 0], printed[..., 0] + .03), printed[..., 1] * .6 + warm[..., 1] * .4, printed[..., 2]], -1)
        printed = printed * (1 - (1 - tex) * tx)[..., None]
        if self.grain > 0:
            printed = film_grain(printed, self.grain, self.seed * 7919 + ctx.i)
        return img * (1 - amt) + printed * amt


def film_grain(img, amount=.03, seed=0, size=1.3):
    """Photographic grain: monochrome, a little clumped (noise at a coarser scale, softened), riding the midtones the
    way silver grain does, different every frame."""
    H, W = img.shape[:2]
    r = np.random.default_rng(seed)
    h2, w2 = max(1, int(H / size)), max(1, int(W / size))
    n = cv2.resize(r.standard_normal((h2, w2)).astype(np.float32), (W, H), interpolation=cv2.INTER_CUBIC)
    n = cv2.GaussianBlur(n, (0, 0), .45)
    L = lum(img)
    w = (.35 + 2.6 * L * (1 - L))[..., None]          # most in the midtones, least in paper white and deep black
    return np.clip(img + n[..., None] * amount * w, 0, 1)


# ---------------------------------------------------------------------------------------------------------------
def era_grade(img, era, t, seed=0):
    """How another time looks: 'daguerreotype' (silver and sepia, soft edges, halation, heavy vignette),
    'film' (1920s: warm-gray, grain, weave left to Projector), 'none'."""
    if era in (None, "none"):
        return img
    H, W = img.shape[:2]
    L = lum(img)
    xx, yy = grid(H, W)
    rr = np.sqrt(((xx - W / 2) / (W * .62)) ** 2 + ((yy - H / 2) / (H * .62)) ** 2)
    vig = np.clip(1 - .85 * smooth(.45, 1.1, rr), 0, 1)
    if era == "daguerreotype":
        L2 = smooth(.02, .92, L) ** .9
        silver = np.stack([L2 * 1.02 + .02, L2 * .96 + .015, L2 * .84], -1)
        soft = blur(silver, 2.2)
        e = smooth(.35, 1.0, rr)[..., None]
        out = silver * (1 - e) + soft * e
        out = screen(out, blur(np.clip(out - .7, 0, 1), 9) * .8)            # halation
        return out * vig[..., None]
    if era == "film":
        L2 = smooth(.03, .95, L)
        out = np.stack([L2 * 1.03, L2 * .98, L2 * .9], -1)
        return out * (.35 + .65 * vig[..., None])
    if era == "sepia":           # a 1920s print: warm monochrome, lifted blacks, soft
        L2 = smooth(.0, 1.0, L) * .9 + .05
        out = np.stack([L2 * 1.05, L2 * .93, L2 * .76], -1)
        return blur(out, .6) * (.55 + .45 * vig[..., None])
    if era == "technicolor":     # the 1950s: saturated three-strip colour, rich reds, a warm bloom
        g = img.mean(-1, keepdims=True)
        out = np.clip(g + (img - g) * 1.55, 0, 1)
        out = np.clip(out * np.array([1.06, 1.0, .9], np.float32) + .02, 0, 1)
        return screen(out, blur(np.clip(out - .75, 0, 1), 6) * .5)
    if era == "vhs":             # the 1980s: teal shadows, magenta highlights, soft and smeared, chroma bleed
        sm = cv2.GaussianBlur(img, (0, 0), sigmaX=2.2, sigmaY=.6)
        chroma = sm - sm.mean(-1, keepdims=True)
        out = sm.mean(-1, keepdims=True) + np.roll(chroma, 3, axis=1) * 1.2
        out = out + (1 - L[..., None]) * np.array([-.02, .03, .05], np.float32) + L[..., None] * np.array([.05, -.01, .04], np.float32)
        return np.clip(out, 0, 1)
    return img


class TimeSlip:
    """Another time breaks into this one, on the music. `other` is a clip of the same place in another era (or any
    other scene). Modes:
        flicker  each hit cuts to the other time for `hold` frames, with a projector-light flash
        bleed    `by` (a curve or envelope) is an opacity slider: the other time arrives light-first
        burn     each hit burns a hole that opens and heals; its rim glows
    `region` keeps the slip inside a mask (e.g. only the couple flicker back to 1843)."""

    def __init__(self, other="b", on=None, by=None, mode="flicker", era="daguerreotype", hold=2, gain=1.0, region=None,
                 tau=.35, life=1.4, seed=3, flash=.6):
        self.__dict__.update(locals()); del self.__dict__["self"]
        self._holes = []

    def __call__(self, ctx, img):
        b = era_grade(ctx.clip(self.other), self.era, ctx.t, self.seed)
        H, W = ctx.H, ctx.W
        reg = ctx.mask(self.region, soft=4) if self.region else np.ones((H, W), np.float32)
        if self.mode == "flicker":
            a_, j = ctx.since(self.on)
            show = a_ * ctx.fps < self.hold
            lvl = ctx.level(self.by) * self.gain if self.by else 0.0
            if show:
                k = 1.0
            else:
                k = min(1.0, lvl) * .5
            out = img * (1 - k * reg[..., None]) + b * (k * reg[..., None])
            if a_ < .25:
                out = out * (1 + self.flash * math.exp(-a_ / .06))
            return out
        if self.mode == "bleed":
            o = np.clip(ctx.level(self.by, self.tau) * self.gain if self.by else ctx.env(self.on, self.tau) * self.gain, 0, 1)
            lb = lum(b)
            # light-first: the other time's brightest parts cross first
            k = smooth(1 - o - .25, 1 - o + .25, lb * .8 + .2 * value_noise(H, W, 60, int(ctx.t * 6) + self.seed, 2)) * reg
            k = k * smooth(0, .15, o)
            return img * (1 - k[..., None]) + b * k[..., None]
        if self.mode == "burn":
            for th in ctx.cues.hits(self.on, ctx.t - 1 / ctx.fps + 1e-6, ctx.t + 1e-6):
                r = np.random.default_rng((int(ctx.cues.key(th) * 1000) + self.seed) % 2 ** 32)
                c = ctx.centroid(self.region) if self.region else None
                cx, cy = (c if c else (W * r.uniform(.25, .75), H * r.uniform(.25, .75)))
                cx += r.normal(0, W * .08); cy += r.normal(0, H * .06)
                self._holes.append((th, cx, cy, r.uniform(.6, 1.0) * max(W, H) * .45, int(r.integers(1e6))))
            self._holes = [h for h in self._holes if ctx.t - h[0] < self.life]
            if not self._holes:
                return img
            xx, yy = grid(H, W)
            K = np.zeros((H, W), np.float32); rim = np.zeros((H, W), np.float32)
            for (th, cx, cy, R, sd) in self._holes:
                age = max((ctx.t - th) / self.life, 0.0)                # (a hit just after this frame has a tiny negative age; a power of it is NaN)
                rad = R * math.sin(math.pi * min(1, age) ** .7)         # opens fast, heals slower
                n = value_noise(H // 4, W // 4, 10, sd, 3)
                n = cv2.resize(n, (W, H))
                d = np.sqrt((xx - cx) ** 2 + (yy - cy) ** 2) + (n - .5) * R * .55
                K = np.maximum(K, smooth(rad + 8, rad - 8, d))
                rim = np.maximum(rim, np.exp(-((d - rad) / 7) ** 2) * (rad > 2))
            K *= reg
            out = img * (1 - K[..., None]) + b * K[..., None]
            glow = blur(rim, 3)[..., None] * np.array([1.0, .62, .25], np.float32) * 1.4
            return screen(out, np.clip(glow * reg[..., None], 0, 1))
        return img


# ---------------------------------------------------------------------------------------------------------------
class SlitScan:
    """Time displacement. Each pixel is shown `delay` frames in the past, delay = depth * map * amount: with
    map='depth' the far room lags behind the near subject; 'y' smears time down the frame; 'radial' outward from a
    point; 'mask' only the subject lags. The amount comes from the music (`by`) or the hits (`on`)."""

    def __init__(self, map="depth", frames=20, on=None, by=None, amount=1.0, invert=False, mask=None, tau=.6, center=None):
        self.__dict__.update(locals()); del self.__dict__["self"]

    def __call__(self, ctx, img):
        a = np.clip(_amount(ctx, self.on, self.by, self.tau, 1.0) * self.amount, 0, 1)
        if a < .02:
            return img
        H, W = ctx.H, ctx.W
        if self.map == "depth":
            m = 1 - ctx.depth_at()          # bright = near in Valis depth: the far lags
        elif self.map == "y":
            m = np.linspace(0, 1, H, dtype=np.float32)[:, None].repeat(W, 1)
        elif self.map == "x":
            m = np.linspace(0, 1, W, dtype=np.float32)[None, :].repeat(H, 0)
        elif self.map == "radial":
            xx, yy = grid(H, W)
            c = self.center or (ctx.centroid(self.mask) if self.mask else None) or (W / 2, H / 2)
            m = np.sqrt((xx - c[0]) ** 2 + (yy - c[1]) ** 2) / math.hypot(W, H) * 1.6
        else:
            m = ctx.mask(self.mask, soft=6)
        if self.invert:
            m = 1 - m
        d = np.clip(m, 0, 1) * a * (self.frames - 1)
        k0 = np.floor(d).astype(np.int32); f = (d - k0)[..., None]
        out = np.zeros_like(img)
        for k in range(int(k0.max()) + 1):
            sel = k0 == k
            if not sel.any():
                continue
            h0 = img if k == 0 else ctx.hist(k)
            h1 = ctx.hist(k + 1)
            out[sel] = (h0[sel] * (1 - f[sel]) + h1[sel] * f[sel])
        return out


# ---------------------------------------------------------------------------------------------------------------
class Lens:
    """A gravitational lens at a tracked point (a mask's centroid, its head end, or a fixed point): light bends
    around an invisible mass whose strength follows the music. The image wraps into an Einstein ring, a dark core
    opens at the centre, and each colour bends a little differently."""

    def __init__(self, at="subject", head=True, on=None, by=None, strength=1.0, radius=.16, core=.22, chroma=.04,
                 ring=.8, tau=.5, point=None):
        self.__dict__.update(locals()); del self.__dict__["self"]
        self._c = None

    def __call__(self, ctx, img):
        s = np.clip(_amount(ctx, self.on, self.by, self.tau, 1.0) * self.strength, 0, 2.5)
        if s < .01:
            return img
        H, W = ctx.H, ctx.W
        c = self.point or ctx.centroid(self.at, top=self.head) or (W / 2, H / 2)
        self._c = c if self._c is None else (self._c[0] * .7 + c[0] * .3, self._c[1] * .7 + c[1] * .3)
        cx, cy = self._c
        Re = self.radius * min(W, H) * math.sqrt(s)
        xx, yy = grid(H, W)
        dx, dy = xx - cx, yy - cy
        r = np.sqrt(dx * dx + dy * dy) + 1e-3
        out = np.empty_like(img)
        for ch, k in enumerate((1 - self.chroma, 1.0, 1 + self.chroma)):
            rs = r - (Re * k) ** 2 / r                    # the lens equation: the source sits nearer the axis
            sc = rs / r
            out[..., ch] = cv2.remap(img[..., ch], (cx + dx * sc).astype(np.float32), (cy + dy * sc).astype(np.float32),
                                     cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT_101)
        core = smooth(Re * self.core * 1.15, Re * self.core * .85, r)
        ringg = np.exp(-((r - Re) / (Re * .06 + 1)) ** 2) * self.ring * min(1, s)
        out = screen(out, ringg[..., None] * np.array([.75, .85, 1.0], np.float32) * .6)
        return out * (1 - core[..., None])


# ---------------------------------------------------------------------------------------------------------------
class Datamosh:
    """Each hit drops the next keyframe: the picture you had is dragged along the new motion (the flow, pushed a
    little harder), blocks of the true frame leaking back in as the hit decays."""

    def __init__(self, on="kick", tau=.6, push=1.6, block=24, seed=5):
        self.__dict__.update(locals()); del self.__dict__["self"]
        self._m = None

    def __call__(self, ctx, img):
        a_, j = ctx.since(self.on)
        if a_ == math.inf or a_ > self.tau * 4:
            self._m = None
            return img
        if self._m is None or a_ < .5 / ctx.fps:
            self._m = ctx.last_out().copy()
        self._m = warp_pull(self._m, ctx.flow, self.push)
        strength = math.exp(-a_ / self.tau)
        H, W = ctx.H, ctx.W
        r = np.random.default_rng((self.seed + j * 31 + ctx.i) % 2 ** 32)
        gb = r.random((H // self.block + 1, W // self.block + 1)).astype(np.float32)
        keep = cv2.resize((gb < strength * .95).astype(np.float32), (W, H), interpolation=cv2.INTER_NEAREST)[:H, :W]
        out = img * (1 - keep[..., None]) + self._m * keep[..., None]
        self._m = out.copy()
        return out


# ---------------------------------------------------------------------------------------------------------------
class Echo:
    """The subject sheds afterimages: on each hit its silhouette (and light) is lifted off and left behind,
    drifting up and out, growing, tinted cold, fading over `life`; the newest is brightest. `trail` adds a short
    continuous smear of the last frames."""

    def __init__(self, mask="subject", on="beat", life=1.4, tint=(.55, .8, 1.0), grow=.22, rise=-.06, side=.03, trail=0,
                 keep=6, glow=.8, gain=1.5):
        self.__dict__.update(locals()); del self.__dict__["self"]
        self.tint = np.array(tint, np.float32); self._e = []

    def __call__(self, ctx, img):
        H, W = ctx.H, ctx.W
        for th in ctx.cues.hits(self.on, ctx.t - 1 / ctx.fps + 1e-6, ctx.t + 1e-6):
            m = ctx.mask(self.mask, soft=2)
            c = ctx.centroid(self.mask) or (W / 2, H / 2)
            k = len(self._e)
            self._e.append((th, (img * m[..., None]).astype(np.float16), m.astype(np.float16), c, (-1) ** k))
            self._e = self._e[-self.keep:]
        self._e = [e for e in self._e if ctx.t - e[0] < self.life]
        out = img
        here = ctx.mask(self.mask, soft=4)[..., None]
        for (th, cut, m, c, sgn) in self._e:
            age = (ctx.t - th) / self.life
            a = (1 - age) ** 1.3 * self.gain
            M = cv2.getRotationMatrix2D(c, 0, 1 + self.grow * max(age, 0.0) ** .7)
            M[0, 2] += sgn * self.side * W * age; M[1, 2] += self.rise * H * age
            cw = cv2.warpAffine(cut.astype(np.float32), M, (W, H))
            ghost = (lum(cw)[..., None] * self.tint * 1.2 + cw * .35) * a
            ghost = ghost + blur(ghost, 10) * self.glow
            out = screen(out, np.clip(ghost * (1 - here * .5), 0, 1))
        if self.trail:
            for k in range(2, self.trail + 1, 2):
                hk = ctx.hist(k)
                out = np.maximum(out, hk * here * (1 - k / (self.trail + 2)) * .6)
        return out


# ---------------------------------------------------------------------------------------------------------------
# ---------------------------------------------------------------------------------------------------------------
class Frost:
    """Frost on the glass in front of the lens: it grows in from the frame's edges where the hits land (or from mask
    edges, or points), dendritic, taking the cheap paths of a noise field first. What it covers is frosted glass: the
    picture behind goes soft, pale and cold, and the front glitters as it grows.
    reach: how far in from the edges it can grow (a fraction of the frame; 1 = across the whole frame).
    thaw: seconds the frost takes to melt after a hit (0: it stays and each hit adds to it).
    opacity: how frosted it gets at its thickest; crystals: how much the ice's own texture shows."""

    def __init__(self, on="hit", at=None, speed=.55, cover=1.0, tint=(.82, .92, 1.0), seed=9, sparkle=.5, reach=.18, thaw=2.5,
                 opacity=.75, crystals=.35, hold=.6, lift=.04):
        self.__dict__.update(locals()); del self.__dict__["self"]
        self._T = None; self._seeds = []; self._tex = None; self._last = None; self._level = 0.0; self._ti = None

    def _arrival(self, ctx):
        from skimage.graph import MCP_Geometric
        H, W = ctx.H, ctx.W
        h, w = H // 4, W // 4
        n = value_noise(h, w, 6, self.seed, 4)
        cost = .25 + 3.5 * smooth(.35, .75, n) ** 2
        T = np.full((h, w), np.inf, np.float32)
        # each seed's front starts at its own hit time: min over seeds of (t_hit + cost)
        for (th, x, y) in self._seeds:
            c1, _ = MCP_Geometric(cost).find_costs([(int(np.clip(y / 4, 0, h - 1)), int(np.clip(x / 4, 0, w - 1)))])
            T = np.minimum(T, th + c1.astype(np.float32) / (self.speed * max(h, w)))
        self._T = cv2.resize(T.astype(np.float32), (W, H), interpolation=cv2.INTER_LINEAR)

    def __call__(self, ctx, img):
        H, W = ctx.H, ctx.W
        new = ctx.cues.hits(self.on, ctx.t - 1 / ctx.fps + 1e-6, ctx.t + 1e-6)
        for th in new:
            r = np.random.default_rng((self.seed + int(ctx.cues.key(th) * 1000)) % 2 ** 32)
            if self.thaw and self._level < .3:  # what was there has melted: this hit grows a new frost
                self._seeds = []
            if isinstance(self.at, tuple):
                pts = [self.at]
            elif self.at:
                m = ctx.mask(self.at, soft=0)
                e = (m > .5).astype(np.uint8); e = e - cv2.erode(e, np.ones((5, 5), np.uint8))
                ys, xs = np.nonzero(e)
                pts = [(xs[k], ys[k]) for k in r.integers(len(xs), size=1)] if len(xs) else [(W * r.random(), H * r.random())]
            else:                               # two corners' worth of edge: frost forms where the glass is coldest
                pts = []
                for side in r.choice(4, 2, replace=False):
                    pts.append([(0, H * r.random()), (W - 1, H * r.random()), (W * r.random(), 0), (W * r.random(), H - 1)][side])
            for (x, y) in pts:
                self._seeds.append((th, x, y))
            self._last = th
        if new.size:
            self._arrival(ctx)
        if self._T is None:
            return img
        if self._tex is None:
            r = np.random.default_rng(self.seed)
            S = max(H, W) / 1344
            # ice veins: ridged fractal noise (fern-like ridges at three scales) with a fine glittering dust on top
            tex = np.zeros((H, W), np.float32)
            for k, (sc, amp) in enumerate(((90, .5), (38, .35), (15, .25))):
                n = value_noise(H, W, sc * S, self.seed + 11 + k, 2)
                tex += amp * (1 - np.abs(2 * n - 1)) ** 6
            dust = (r.random((H, W)) > .985).astype(np.float32) * r.uniform(.3, 1, (H, W)).astype(np.float32)
            tex = np.clip(tex * 1.3 + blur(dust, .6) * 1.2, 0, 1)
            self._tex = (blur(tex, .6) * .8 + tex * .2).astype(np.float32)
            dens = value_noise(H, W, 160 * S, self.seed + 4, 3)
            xx, yy = grid(H, W)
            edge = np.minimum(np.minimum(xx, W - 1 - xx) / W, np.minimum(yy, H - 1 - yy) / H)       # 0 at the frame's edge
            if self.reach >= 1:                 # the old whole-frame frost
                self._dens = (smooth(.25, .75, dens) * .5 + smooth(.32, .02, edge) * .7).clip(0, 1).astype(np.float32)
            else:                               # it thins out toward `reach` from the edges, ragged
                rag = self.reach * (.65 + .7 * dens)
                self._dens = (smooth(rag, rag * .2, edge) * (.6 + .4 * smooth(.3, .7, dens))).clip(0, 1).astype(np.float32)
            gx = cv2.Sobel(blur(self._tex, 2), cv2.CV_32F, 1, 0, ksize=3); gy = cv2.Sobel(blur(self._tex, 2), cv2.CV_32F, 0, 1, ksize=3)
            self._ref = np.stack([gx, gy], -1) * 3 * S
            self._S = S
        age = ctx.t - self._T
        melt = 1.0
        if self.thaw and self._last is not None:
            # the frost's strength: it firms up after a hit and holds, then melts away over `thaw` seconds
            dt = 1 / ctx.fps if self._ti is None else max(0.0, ctx.t - self._ti)
            self._ti = ctx.t
            if ctx.t - self._last < self.hold:
                self._level = self._level + (1 - self._level) * min(1.0, dt / .25)
            else:
                self._level *= math.exp(-dt / (self.thaw * .45))
            melt = self._level if ctx.t - self._last >= .05 else max(self._level, 1.0 if self._level > .3 else 0.0)
        F = smooth(0, .3, age) * self.cover * self._dens ** 1.3 * melt * self.opacity
        if F.max() <= 0.002:
            return img
        S = self._S
        refr = warp_pull(img, self._ref * F[..., None])
        frosted = blur(refr, 3.5 * S)                       # frosted glass: what's behind goes soft
        L = lum(frosted)
        cold = frosted * .5 + L[..., None] * np.array(self.tint, np.float32) * .5
        cold = screen(cold, np.full_like(img, self.lift) * np.array(self.tint, np.float32))
        # the ice catches the light there is: it glitters in a bright scene and barely shows in a dark one
        catch = .15 + .85 * smooth(0, .45, blur(lum(img), .04 * math.hypot(H, W)))
        crystals = (self._tex * smooth(0, .6, age) * self._dens ** 2 * melt * catch)[..., None] * self.crystals
        cold = screen(cold, crystals * np.array([.85, .93, 1.0], np.float32))
        out = img * (1 - F[..., None]) + cold * F[..., None]
        front = np.exp(-(age / .05) ** 2) * (age > -0.02) * self._dens
        r = np.random.default_rng(ctx.i)
        sp = (r.random((H, W)) > .985).astype(np.float32) * front * self.sparkle
        glit = blur(front * .35 + sp * 3, 1.5) * melt * catch
        return screen(out, np.clip(glit, 0, 1)[..., None] * np.array([.85, .93, 1.0], np.float32))


# ---------------------------------------------------------------------------------------------------------------
class Vertigo:
    """A dolly zoom made from a subject mask: the subject holds still while the world behind it is pushed away. Only real
    pixels are ever shown: the whole shot is framed tighter by the clip's peak push (headroom) around the subject, and
    the push hands that margin back to the background, so at the peak the background is the full, untouched frame and
    the subject is still its framed size. (The first version refilled the frame's edges from the unpushed picture,
    which put a shrunk copy of the room inside the room.) The ground the subject hides is painted in, and it shrinks
    toward the subject, so it stays hidden behind it. reflection=True keeps the subject's reflection (a wet floor)
    attached to it instead of sliding off with the floor. headroom=None reads the peak from the cues."""

    def __init__(self, subject="subject", on=None, by=None, amount=.28, tau=1.2, blur_rush=6, reflection=False, edge=1.2, headroom=None):
        self.__dict__.update(locals()); del self.__dict__["self"]
        self._prev = 0.0
        self._track = None

    def _push(self, ctx, t):
        v = ctx.cues.level(self.by, t, self.tau) if self.by else ctx.cues.env(self.on, t, self.tau) if self.on else 0.0
        return float(np.clip(v, 0, 1.5)) * max(self.amount, 0.0)

    def _prepare(self, ctx):
        """The clip's peak push (how much tighter to frame it) and a smoothed track of the subject's centre."""
        n = max(int(ctx.n), 1)
        ts = np.arange(n) / ctx.fps
        peak = self.headroom if self.headroom is not None else max((self._push(ctx, t) for t in ts), default=0.0)
        cs = [ctx.centroid(self.subject, t) for t in ts]
        known = [c for c in cs if c is not None]
        if known:
            last = known[0]
            for i, c in enumerate(cs):        # hold the last known centre through frames where the mask drops out
                cs[i] = last = c if c is not None else last
            xy = np.array(cs, np.float32)
            k = max(1, int(round(.5 * ctx.fps)) | 1)
            pad = np.pad(xy, ((k // 2, k // 2), (0, 0)), mode="edge")
            xy = np.stack([np.convolve(pad[:, j], np.ones(k) / k, mode="valid") for j in range(2)], 1)
        else:
            xy = np.tile(np.float32([ctx.W / 2, ctx.H / 2]), (n, 1))
        self._track = (float(peak), xy)

    def _mask(self, ctx):
        m = ctx.mask(self.subject, soft=0)
        if self.reflection:
            ys = np.nonzero(m.max(1) > .5)[0]
            if len(ys) > 10:
                y0, y1 = ys[0], ys[-1]
                n = min(int((y1 - y0) * .6), ctx.H - 1 - y1)
                if n > 4:
                    fade = np.linspace(1, 0, n, dtype=np.float32)[:, None]
                    m = m.copy()
                    m[y1 + 1:y1 + 1 + n] = np.maximum(m[y1 + 1:y1 + 1 + n], m[y1 - np.arange(n)] * fade)
        return m

    def __call__(self, ctx, img):
        if self._track is None:
            self._prepare(ctx)
        peak, xy = self._track
        if peak < .003:
            return img
        H, W = ctx.H, ctx.W
        a = min(self._push(ctx, ctx.t), peak)
        c = tuple(float(v) for v in xy[int(np.clip(ctx.i, 0, len(xy) - 1))])
        Z = 1 + peak                                   # framed tighter by the peak push, so the push only ever reveals real frame
        m = self._mask(ctx)
        # the ground behind the subject, painted in at quarter size (it shrinks toward the subject, so it stays behind it)
        small = cv2.resize((img * 255).astype(np.uint8), (W // 4, H // 4), interpolation=cv2.INTER_AREA)
        hole = cv2.dilate((cv2.resize(m, (W // 4, H // 4)) > .2).astype(np.uint8), np.ones((5, 5), np.uint8))
        fill = cv2.resize(cv2.inpaint(small, hole, 6, cv2.INPAINT_TELEA), (W, H), interpolation=cv2.INTER_CUBIC).astype(np.float32) / 255
        md = blur(cv2.dilate(m, np.ones((15, 15), np.uint8)), 6)[..., None]
        bg = img * (1 - md) + fill * md
        # zooming about a point inside the frame by >= 1 only ever samples inside the frame: no edges to refill
        Mb = cv2.getRotationMatrix2D(c, 0, Z / (1 + a))
        bgw = cv2.warpAffine(bg, Mb, (W, H), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REFLECT)
        # rush blur from how fast the push is changing (read from the cues, so a draft still matches the final)
        rush = abs(a - min(self._push(ctx, ctx.t - 1 / ctx.fps), peak)) * 60
        if self.blur_rush and rush > .02:
            acc = bgw.copy()
            r = min(rush, 3.0) * .006 * self.blur_rush / 6
            for k in range(1, 5):
                Mk = cv2.getRotationMatrix2D(c, 0, 1 + k * r)
                acc += cv2.warpAffine(bgw, Mk, (W, H), borderMode=cv2.BORDER_REFLECT)
            bgw = acc / 5
        self._prev = a
        # the subject on top at the framed size, a hair inside its matte so none of its old surroundings come along
        Ms = cv2.getRotationMatrix2D(c, 0, Z)
        sub = cv2.warpAffine(img, Ms, (W, H), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REFLECT)
        ms = cv2.warpAffine(blur(cv2.erode(m, np.ones((3, 3), np.uint8)), self.edge), Ms, (W, H), borderMode=cv2.BORDER_CONSTANT)[..., None]
        return np.clip(bgw * (1 - ms) + sub * ms, 0, 1)


# ---------------------------------------------------------------------------------------------------------------
class Split:
    """One frame, several times: the picture is cut into bands along lines, each band showing another clip (the same shot
    in another era, say), with a thin glowing seam where they meet. at: band edges as fractions across the frame (a
    single .5 = halves); angle tilts the seams (degrees); on= makes the seams flare and the bands flicker into each
    other for `hold` frames on the hits."""

    def __init__(self, clips=("a", "b"), at=(.5,), angle=0.0, seam=(1.0, .82, .45), width=1.5, glow=.8, on=None, tau=.35, hold=0,
                 soft=1.2, grades=None):
        self.__dict__.update(locals()); del self.__dict__["self"]

    def __call__(self, ctx, img):
        H, W = ctx.H, ctx.W
        xx, yy = grid(H, W)
        u = (xx - (yy - H / 2) * math.tan(math.radians(self.angle))) / W        # position across the frame, along the tilt
        frames = [img if c == "a" else ctx.clip(c) for c in self.clips]
        if self.grades:
            frames = [era_grade(f, g, ctx.t) if g else f for f, g in zip(frames, self.grades)]
        e = ctx.env(self.on, self.tau) if self.on else 0.0
        a_, j = ctx.since(self.on) if self.on else (math.inf, -1)
        flick = self.hold and a_ < self.hold / ctx.fps
        edges = [-1e9] + list(self.at) + [1e9]
        out = np.zeros_like(img); seams = np.zeros((H, W), np.float32)
        for k, f in enumerate(frames):
            lo, hi = edges[k], edges[k + 1]
            w = smooth(lo - self.soft / W, lo + self.soft / W, u) * (1 - smooth(hi - self.soft / W, hi + self.soft / W, u))
            if flick:                                          # on a hit the bands swap for a frame or two
                w = smooth(lo - self.soft / W, lo + self.soft / W, 1 - u) * (1 - smooth(hi - self.soft / W, hi + self.soft / W, 1 - u))
            out += f * w[..., None]
        for x in self.at:
            d = np.abs(u - x) * W
            seams += np.exp(-(d / self.width) ** 2) + .35 * np.exp(-(d / (self.width * 8)) ** 2)
        light = seams[..., None] * np.array(self.seam, np.float32) * self.glow * (1 + 1.5 * e)
        return screen(out, np.clip(light, 0, 1))


class Eras:
    """The same shot in several eras (clips), cutting from one to the next on every hit, each cut bleeding light-first
    into the last for a couple of frames. by= instead holds a crossfade position (0 = the first clip, 1 = the last)."""

    def __init__(self, clips=("a", "b", "c"), on="beat", by=None, bleed=2, grades=None, order="cycle", seed=3):
        self.__dict__.update(locals()); del self.__dict__["self"]

    def _frame(self, ctx, k, img):
        c = self.clips[k % len(self.clips)]
        f = img if c == "a" else ctx.clip(c)
        g = self.grades[k % len(self.grades)] if self.grades else None
        return era_grade(f, g, ctx.t) if g else f

    def __call__(self, ctx, img):
        if self.by:
            x = np.clip(ctx.level(self.by), 0, 1) * (len(self.clips) - 1)
            k = int(math.floor(x)); f = x - k
            a = self._frame(ctx, k, img)
            return a if f < 1e-3 or k + 1 >= len(self.clips) else a * (1 - f) + self._frame(ctx, k + 1, img) * f
        n = ctx.cues.count(self.on, ctx.t)
        if self.order == "random":
            r = np.random.default_rng(self.seed + n); k = int(r.integers(len(self.clips)))
        else:
            k = n
        cur = self._frame(ctx, k, img)
        a_, _ = ctx.since(self.on)
        if a_ < self.bleed / ctx.fps and n > 0:
            prev = self._frame(ctx, k - 1, img)
            mix = 1 - a_ * ctx.fps / max(self.bleed, 1)
            cur = screen(cur, prev * .55 * mix)
        return cur


class Shockwave:
    """A ring of displaced space expands from a point on each hit: the picture refracts across the front (with a
    chromatic split), a bright edge rides it, and the space it has passed through settles. at: (x, y), a mask name
    (its centroid), or None for the centre."""

    def __init__(self, on="impact", at=None, speed=1250, width=30, strength=18, life=1.6, tint=(.85, .92, 1.0), glow=.5, chroma=.35):
        self.__dict__.update(locals()); del self.__dict__["self"]

    def __call__(self, ctx, img):
        hits = ctx.cues.hits(self.on, ctx.t - self.life, ctx.t + 1e-6)
        if not len(hits):
            return img
        H, W = ctx.H, ctx.W
        XX, YY = grid(H, W)
        dx = np.zeros((H, W), np.float32); dy = np.zeros((H, W), np.float32); front = np.zeros((H, W), np.float32)
        c = self.at if isinstance(self.at, tuple) else (ctx.centroid(self.at) if self.at else None) or (W / 2, H / 2)
        vel = ctx.cues.vel(self.on); ts = ctx.cues.times(self.on)
        for te in hits:
            v = float(vel[np.argmin(np.abs(ts - te))]) if len(ts) else 1.0
            age = max(ctx.t - te, 0.0)                    # (a hit up to 1e-6 s after the frame is taken: its age can be -4e-16, and a power of that is NaN)
            r = 30 + self.speed * age ** .8 * (W / 768)
            wd = (self.width + 34 * age) * (W / 768)
            ddx, ddy = XX - c[0], YY - c[1]
            d = np.sqrt(ddx * ddx + ddy * ddy) + 1e-3
            u = (d - r) / wd
            g = np.exp(-u * u)
            fall = math.exp(-age / (self.life * .5))
            amp = self.strength * v * fall * (W / 768)
            dx += ddx / d * (u * g * amp); dy += ddy / d * (u * g * amp)
            front += g * fall * min(v, 1.6)
        k = self.chroma
        out = np.stack([cv2.remap(img[..., ch], (XX - dx * (1 + k * (1 - ch))).astype(np.float32), (YY - dy * (1 + k * (1 - ch))).astype(np.float32),
                                  cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT_101) for ch in range(3)], -1)
        glow = blur(front, 2.0)[..., None] * np.array(self.tint, np.float32) * self.glow
        return screen(out, np.clip(glow, 0, 1))


class Rays:
    """Light shafts from a source on each hit (or held by a curve): the bright parts of the picture are smeared
    radially away from the source, plus a soft bloom and a cold anamorphic streak. at: (x, y), 'bright' (the
    brightest spot, followed frame to frame), or a mask name."""

    def __init__(self, on=None, by=None, at="bright", strength=1.0, tau=.5, tint=(1.0, .9, .72), samples=26, decay=.7,
                 threshold=.6, streak=.6, base=.0):
        self.__dict__.update(locals()); del self.__dict__["self"]
        self._src = None

    def _source(self, ctx, img):
        H, W = ctx.H, ctx.W
        if isinstance(self.at, tuple):
            return self.at
        if self.at == "bright":
            g = cv2.GaussianBlur(cv2.resize(lum(img), (W // 4, H // 4)), (0, 0), 6)
            y, x = np.unravel_index(np.argmax(g), g.shape)
            p = np.array([x * 4 + 2, y * 4 + 2], np.float32)
            self._src = p if self._src is None else self._src * .8 + p * .2       # follow it, smoothly
            return tuple(self._src)
        return ctx.centroid(self.at) or (W / 2, H / 2)

    def __call__(self, ctx, img):
        e = self.base + _amount(ctx, self.on, self.by, self.tau, 0.0)
        src = self._source(ctx, img)
        if e < .01:
            return img
        H, W = ctx.H, ctx.W
        h4, w4 = H // 4, W // 4
        sm = cv2.resize(img, (w4, h4), interpolation=cv2.INTER_AREA)
        em = np.clip((sm.max(2) - self.threshold) / (1 - self.threshold), 0, 1)[..., None] * sm
        sx, sy = src[0] / 4, src[1] / 4
        X4, Y4 = grid(h4, w4)
        acc = np.zeros_like(em)
        for i in range(self.samples):
            s = 1 - self.decay * i / self.samples
            acc += cv2.remap(em, (sx + (X4 - sx) * s).astype(np.float32), (sy + (Y4 - sy) * s).astype(np.float32), cv2.INTER_LINEAR,
                             borderMode=cv2.BORDER_CONSTANT) * (1 - i / self.samples) ** .5
        acc = cv2.GaussianBlur(acc / self.samples * 2.2, (0, 0), 1.2)
        bl = sum(cv2.GaussianBlur(em, (0, 0), r) * k for r, k in ((3, .5), (10, .35), (28, .25)))
        st = cv2.GaussianBlur(em * np.clip((em.max(2, keepdims=True) - .3) * 3, 0, 1), (0, 0), sigmaX=50, sigmaY=.8) * np.array([.55, .75, 1.0], np.float32) * self.streak
        light = cv2.resize(acc * np.array(self.tint, np.float32) + bl * .6 + st, (W, H), interpolation=cv2.INTER_LINEAR)
        return screen(img, np.clip(light * self.strength * min(e, 1.5), 0, 1))


# ---------------------------------------------------------------------------------------------------------------
class Tear:
    """Reality rips along a jagged seam through a point (a mask's centroid, or the frame's middle). The halves of the
    picture are pushed apart by the music; in the gap, another scene, behind a burning rim."""

    def __init__(self, on=None, by=None, behind="b", at=None, angle=8.0, width=.35, tau=.8, rim=(1.0, .55, .95), seed=21, flutter=6):
        self.__dict__.update(locals()); del self.__dict__["self"]
        self._path = None

    def __call__(self, ctx, img):
        w = np.clip(_amount(ctx, self.on, self.by, self.tau, 0.0), 0, 1.2)
        if w < .005:
            return img
        H, W = ctx.H, ctx.W
        if self._path is None:
            r = np.random.default_rng(self.seed)
            n = 2 ** 7 + 1
            p = np.zeros(n, np.float32)
            step, amp = n - 1, W * .12
            while step > 1:
                for i in range(step // 2, n - 1, step):
                    p[i] = (p[i - step // 2] + p[i + step // 2]) / 2 + r.normal(0, amp)
                step //= 2; amp *= .55
            self._path = cv2.resize(p[None], (H, 1), interpolation=cv2.INTER_LINEAR)[0]
        c = self.at if isinstance(self.at, tuple) else (ctx.centroid(self.at) if self.at else None) or (W / 2, H / 2)
        xx, yy = grid(H, W)
        tilt = math.tan(math.radians(self.angle)) * (yy - c[1])
        fl = self.flutter * np.sin(yy / 23 + ctx.t * 9)[..., :1] * w
        d = xx - (c[0] + tilt + self._path[:, None] + fl)               # signed distance-ish across the seam
        gap = w * self.width * W
        side = np.sign(d)
        # push the two halves apart
        push = side * gap / 2 * smooth(W * .7, 0, np.abs(d))
        pushed = cv2.remap(img, (xx - push).astype(np.float32), yy.astype(np.float32), cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT_101)
        inside = smooth(gap / 2 + 2, gap / 2 - 2, np.abs(d))
        beh = ctx.clip(self.behind) if self.behind in ctx.clips else np.zeros_like(img)
        rimc = np.array(self.rim, np.float32)
        # light pours out of the other side: brightest at the torn edges, the scene behind lit by it
        depth_in = np.clip((gap / 2 - np.abs(d)) / (gap / 2 + 1e-3), 0, 1)
        spill = np.exp(-depth_in * 3.0)[..., None]
        beh = screen(beh * (1.15 + .5 * w), spill * rimc * .8)
        # the torn edges of this world darken and lift (shadow just outside the seam)
        lift = np.exp(-((np.abs(d) - gap / 2 - 10) / 14) ** 2) * (np.abs(d) > gap / 2)
        pushed = pushed * (1 - .45 * lift[..., None])
        out = pushed * (1 - inside[..., None]) + beh * inside[..., None]
        core = np.exp(-((np.abs(d) - gap / 2) / (1.5 + 2 * w)) ** 2)
        halo = np.exp(-((np.abs(d) - gap / 2) / (10 + 20 * w)) ** 2)
        r = np.random.default_rng(ctx.i + self.seed)
        sparks = (r.random(d.shape) > .996) * (np.abs(np.abs(d) - gap / 2) < 18)
        glow = core[..., None] * (rimc * .4 + .75) + halo[..., None] * rimc * .55 + blur(sparks.astype(np.float32), 1.2)[..., None] * 3
        return screen(out, np.clip(glow, 0, 1))


# ---------------------------------------------------------------------------------------------------------------
class Projector:
    """The picture as projected film: exposure flicker (stronger on hits), gate weave, vertical scratches, dust,
    and a hot-spot burn-in when `burn` hits land."""

    def __init__(self, on=None, flicker=.08, weave=1.5, scratches=.6, dust=.5, burn=None, seed=4, amount=1.0):
        self.__dict__.update(locals()); del self.__dict__["self"]

    def __call__(self, ctx, img):
        H, W = ctx.H, ctx.W
        r = np.random.default_rng(self.seed + ctx.i)
        e = ctx.env(self.on, .12) if self.on else 0.0
        f = 1 + self.flicker * (r.normal(0, 1) * .5 + e * 2.5)
        dx, dy = r.normal(0, self.weave * .3), r.normal(0, self.weave)
        M = np.float32([[1, 0, dx], [0, 1, dy]])
        out = cv2.warpAffine(img, M, (W, H), borderMode=cv2.BORDER_REFLECT_101) * f
        if self.scratches:
            for k in range(r.poisson(self.scratches * 2)):
                x = int(r.uniform(0, W)); a = r.uniform(.1, .4)
                out[:, max(0, x - 1):x + 1] = out[:, max(0, x - 1):x + 1] * (1 - a) + a * .9
        if self.dust:
            for k in range(r.poisson(self.dust * 6)):
                x, y, s = int(r.uniform(0, W)), int(r.uniform(0, H)), r.uniform(1, 4)
                cv2.circle(out, (x, y), int(s), (0.05, 0.05, 0.05) if r.random() < .6 else (.95, .95, .9), -1)
        if self.burn:
            a_, _ = ctx.since(self.burn)
            if a_ < .6:
                xx, yy = grid(H, W)
                rr = np.sqrt(((xx - W * .5) / W) ** 2 + ((yy - H * .45) / H) ** 2)
                g = np.exp(-a_ / .18) * smooth(.45, 0, rr) * 2
                out = screen(out, (g[..., None] * np.array([1.0, .8, .45], np.float32)).clip(0, 1))
        return img * (1 - self.amount) + out * self.amount


class Glitch:
    """Block displacement and RGB channel split on the hits."""

    def __init__(self, on="hat", tau=.08, blocks=14, shift=40, split=8, seed=13):
        self.__dict__.update(locals()); del self.__dict__["self"]

    def __call__(self, ctx, img):
        e = ctx.env(self.on, self.tau)
        if e < .05:
            return img
        H = ctx.H
        r = np.random.default_rng(self.seed + ctx.i)
        out = img.copy()
        for k in range(int(self.blocks * min(1, e))):
            y0 = int(r.uniform(0, H)); h = int(r.uniform(4, H * .06)); sx = int(r.normal(0, self.shift * e))
            out[y0:y0 + h] = np.roll(out[y0:y0 + h], sx, axis=1)
        s = int(self.split * e)
        if s:
            out[..., 0] = np.roll(out[..., 0], s, axis=1); out[..., 2] = np.roll(out[..., 2], -s, axis=1)
        return out


class Punch:
    """Exposure flash, a zoom kick and a chromatic split on the hits."""

    def __init__(self, on="kick", tau=.12, flash=.25, zoom=.025, split=3):
        self.__dict__.update(locals()); del self.__dict__["self"]

    def __call__(self, ctx, img):
        e = ctx.env(self.on, self.tau)
        if e < .01:
            return img
        H, W = ctx.H, ctx.W
        z = 1 + self.zoom * e
        M = cv2.getRotationMatrix2D((W / 2, H / 2), 0, z)
        out = cv2.warpAffine(img, M, (W, H), borderMode=cv2.BORDER_REFLECT_101)
        s = int(round(self.split * e))
        if s:
            out[..., 0] = np.roll(out[..., 0], s, axis=1); out[..., 2] = np.roll(out[..., 2], -s, axis=1)
        return screen(out, np.full_like(out, self.flash * min(e, 1)))


LIBRARY = {c.__name__: c for c in (DoubleExposure, TimeSlip, SlitScan, Lens, Datamosh, Echo, Frost, Vertigo, Shockwave, Rays, Split, Eras,
                                    Tear, Projector, Glitch, Punch)}
from .light import LIGHT          # noqa: E402  (light.py needs only core)
LIBRARY.update(LIGHT)
