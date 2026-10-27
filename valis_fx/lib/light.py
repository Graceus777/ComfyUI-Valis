"""Light: effects that read as the shot's own light rather than as a layer laid over it. They relight the picture (it
is multiplied by a light map, so its texture and colours stay the plate's), the light comes from a motivated place
(the brightest thing in the frame, a side of the frame, a mask), and it moves the way real light moves: a flame's
irregular breath, a strike's stutter, a beam crossing a room.

    Flicker    the scene's own light breathes like a practical: a candle, a fire, a fluorescent tube, a failing bulb
    Firelight  warm firelight from off-screen, licking up the scene and flaring on the hits
    Lightning  a strike off-screen lights the scene from one side: two or three stuttering flashes, an afterglow
    Sweep      a beam crosses the scene on each hit: headlights through a window, a lighthouse, light through blinds
    Glow       the highlights bloom and halate, breathing with the music
    Haze       heat shimmer: the air above the hot, bright things ripples
    Glint      a star glint flashes on the brightest point (a blade, an eye, a jewel) on each hit
    Rim        the subject's edge catches a back light on each hit (needs the subject mask)

Every effect here works at any frame size: lengths are fractions of the frame's diagonal."""
import math

import cv2
import numpy as np

from .core import blur, grid, lum, screen, smooth, value_noise

SIDES = {"left": (-1, 0), "right": (1, 0), "top": (0, -1), "above": (0, -1), "bottom": (0, 1), "below": (0, 1),
         "top-left": (-.71, -.71), "top-right": (.71, -.71), "bottom-left": (-.71, .71), "bottom-right": (.71, .71)}


def _tint(t):
    t = np.array(t, np.float32)
    return t / max(float(t.max()), 1e-6)


def _amount(ctx, on, by, tau):
    if by:
        return ctx.level(by, tau)
    if on:
        return ctx.env(on, tau)
    return 0.0


def _diag(ctx):
    return math.hypot(ctx.W, ctx.H)


def _brightest(ctx, img, state, follow=.15, small=False):
    """The brightest spot, followed smoothly from frame to frame (a lamp, the sun, a blade)."""
    H, W = ctx.H, ctx.W
    g = cv2.resize(lum(img), (W // 4, H // 4), interpolation=cv2.INTER_AREA)
    g = cv2.GaussianBlur(g, (0, 0), 1.2 if small else 5)
    y, x = np.unravel_index(np.argmax(g), g.shape)
    p = np.array([x * 4 + 2, y * 4 + 2], np.float32)
    prev = state.get("src")
    state["src"] = p if prev is None else prev * (1 - follow) + p * follow
    return state["src"]


def _point(ctx, img, at, state):
    if isinstance(at, (tuple, list)) and len(at) == 2:
        x, y = at
        return np.array([x * ctx.W if x <= 1 else x, y * ctx.H if y <= 1 else y], np.float32)
    if at in (None, "bright"):
        return _brightest(ctx, img, state)
    c = ctx.centroid(at)
    return np.array(c if c else (ctx.W / 2, ctx.H / 2), np.float32)


def _ramp(ctx, side, reach=1.0):
    """1 at the frame edge the light comes from, falling off across the frame (reach: how far in, 1 = all the way)."""
    vx, vy = SIDES.get(side, SIDES["left"])
    xx, yy = grid(ctx.H, ctx.W)
    p = ((xx / ctx.W - .5) * vx + (yy / ctx.H - .5) * vy) / (.5 * (abs(vx) + abs(vy)))       # -1 far side .. 1 light side
    return smooth(1 - 2 * reach, 1.0, p).astype(np.float32)


def _near(ctx):
    """Near things take more light than far ones when there is depth (near = bright); without depth, everything alike."""
    if ctx.depth is None:
        return 1.0
    d = ctx.depth_at()
    lo, hi = np.percentile(d, 5), np.percentile(d, 95)
    return (.45 + .55 * np.clip((d - lo) / (hi - lo + 1e-6), 0, 1))


def _shoulder(x, knee=.8):
    """Light past white rolls off like film instead of clipping flat."""
    over = np.maximum(x - knee, 0)
    return np.where(x > knee, knee + (1 - knee) * (1 - np.exp(-over / (1 - knee))), x).astype(np.float32)


def relight(img, M, gain, tint, fill=.25, sigma=None):
    """Light added to the plate. The plate is multiplied by (1 + light), so its texture and colours stay; `fill` adds light
    in proportion to the surface under it (the plate divided by its own local brightness), so a dark room shows its
    walls and faces when a flash or a beam reaches them instead of staying black. Coloured by the light, rolled off past
    white. M: the light map (0..1); gain: how much (negative takes light away)."""
    t = _tint(tint)
    L = (M * gain)[..., None] * t
    out = img * (1 + L)
    if fill and gain > 0:
        s = sigma or .02 * math.hypot(*img.shape[:2])
        lm = blur(lum(img), s)[..., None]
        alb = np.clip(img / (lm + .05), 0, 1.6)
        out = out + L * fill * alb * .3
    return _shoulder(out) if gain > 0 else out


def _flame(n, fps, seed, speed=1.0, smooth_hz=3.0):
    """A flame's breath, one value a frame: fast flutter, a slower sway and a slow drift, in -1..1 (std about 1/3)."""
    r = np.random.default_rng(seed)
    out = np.zeros(n + 96, np.float32)
    for sig, amp in ((1.1, .5), (3.0, .38), (11.0, .22)):
        x = r.normal(0, 1, n + 96).astype(np.float32)
        x = cv2.GaussianBlur(x[None], (0, 0), sigmaX=max(.5, sig * fps / 24 / max(speed, .05)), sigmaY=.1)[0]
        out += x / (x.std() + 1e-6) * amp
    out = out[48:48 + n]
    return np.clip(out / (out.std() + 1e-6) / 3, -1, 1)


# ---------------------------------------------------------------------------------------------------------------
class Flicker:
    """The scene's own light breathes like a practical. style: candle (warm, slow and irregular; a hit makes it gutter
    and flare back), fire (warmer, faster), tube (a fluorescent tube: steady, it stutters off and on at the hits),
    bulb (a failing bulb: a steady hum that browns out on the hits). The light comes from `at` (the brightest thing in
    the frame by default, followed as it moves) and falls off over `radius` of the frame; `ambient` of it is the
    whole room breathing with it."""

    # dim: how the light is taken away when it dips (a flame shrinks, a filament browns out). The light's own tint
    # taken away would leave the room colder; a dying flame or filament goes dimmer and warmer, so blue goes first.
    # (A failing bulb turned the mask workshop grey-blue on every hit.) A tube just goes out.
    STYLES = {"candle": dict(tint=(1.0, .74, .45), dim=(.82, .92, 1.0), speed=1.0, depth=.22, hit=-.5),
              "fire": dict(tint=(1.0, .62, .32), dim=(.82, .92, 1.0), speed=1.8, depth=.3, hit=.45),
              "tube": dict(tint=(.86, .95, 1.0), dim=(1.0, 1.0, 1.0), speed=0.0, depth=.0, hit=-.9),
              "bulb": dict(tint=(1.0, .86, .66), dim=(.72, .86, 1.0), speed=.25, depth=.03, hit=-.7)}

    def __init__(self, on=None, by=None, style="candle", at="bright", amount=1.0, radius=.5, ambient=.45, tint=None, tau=.3, seed=7):
        self.__dict__.update(locals()); del self.__dict__["self"]
        st = self.STYLES.get(style, self.STYLES["candle"])
        self.tint = tuple(tint) if tint else st["tint"]; self._st = st
        self._sig = None; self._state = {}; self._M = None

    def _signal(self, ctx):
        st = self._st
        if st["speed"] > 0:
            return _flame(ctx.n, ctx.fps, self.seed, st["speed"]) * st["depth"]
        return np.zeros(ctx.n, np.float32)

    def _hit(self, ctx):
        st = self._st
        if not self.on and not self.by:
            return 0.0
        if self.style in ("tube", "bulb"):
            a, _ = ctx.since(self.on) if self.on else (9.0, 0)
            if a > .45:
                return 0.0
            r = np.random.default_rng(self.seed + int(ctx.t * 1000) // 40)
            if self.style == "tube":                # off-on-off-on in the first 0.3 s, a random stutter
                off = (a < .05) or (.09 < a < .13) or (.2 < a < .23 and r.random() < .7)
                return st["hit"] if off else st["hit"] * .15 * r.random()
            return st["hit"] * math.exp(-a / .18) * (.7 + .3 * r.random())
        e = _amount(ctx, self.on, self.by, self.tau)
        if st["hit"] < 0 and self.on:              # a candle gutters, then flares back past where it was
            a, _ = ctx.since(self.on)
            if a > 2:
                return 0.0
            return st["hit"] * math.exp(-a / .2) * (1 - math.exp(-a / .03)) + .3 * (1 - math.exp(-a / .2)) * math.exp(-a / .7)
        return st["hit"] * e

    def __call__(self, ctx, img):
        if self._sig is None:
            self._sig = self._signal(ctx)
        g = float(self._sig[min(ctx.i, len(self._sig) - 1)]) + self._hit(ctx)
        g *= self.amount
        if abs(g) < .003:
            return img
        p = _point(ctx, img, self.at, self._state)
        if self._M is None or ctx.i % 3 == 0:
            xx, yy = grid(ctx.H, ctx.W)
            r = self.radius * _diag(ctx)
            d2 = ((xx - p[0]) ** 2 + (yy - p[1]) ** 2) / (2 * r * r)
            self._M = (self.ambient + (1 - self.ambient) * np.exp(-d2)).astype(np.float32)
        return relight(img, self._M, g, self.tint if g > 0 else self._st.get("dim", self.tint), fill=.25)


# ---------------------------------------------------------------------------------------------------------------
class Firelight:
    """Warm firelight from off-screen (`at`: below, left, right...): it licks up the scene, never quite still, and flares
    on the hits. reach: how far across the frame it carries."""

    def __init__(self, on=None, by=None, at="below", amount=.7, reach=.75, tint=(1.0, .56, .24), speed=1.0, flare=.7, tau=.45, base=1.0, seed=5):
        self.__dict__.update(locals()); del self.__dict__["self"]
        self._sig = None; self._ramp = None; self._xs = None

    def __call__(self, ctx, img):
        if self._sig is None:
            self._sig = _flame(ctx.n, ctx.fps, self.seed, 2.2 * self.speed, smooth_hz=4.0)
            self._sig2 = _flame(ctx.n, ctx.fps, self.seed + 1, 1.2 * self.speed)
            self._ramp = _ramp(ctx, self.at, self.reach)
            self._lick = value_noise(ctx.H, ctx.W * 2, max(ctx.W, ctx.H) * .18, self.seed, 3)
        i = min(ctx.i, ctx.n - 1)
        e = _amount(ctx, self.on, self.by, self.tau)
        level = self.base * (1 + .3 * float(self._sig[i])) + self.flare * e
        # the light's edge moves: a noise field drifting sideways bends how far it reaches, frame to frame
        off = int((ctx.t * 40 * self.speed) % ctx.W)
        lick = self._lick[:, off:off + ctx.W]
        M = np.clip(self._ramp * (.8 + .4 * lick + .25 * float(self._sig2[i])), 0, 1) ** 1.2
        return relight(img, M * _near(ctx), self.amount * level, self.tint, fill=.3)


# ---------------------------------------------------------------------------------------------------------------
class Lightning:
    """A strike off-screen lights the scene from one side (`at`): two or three stuttering flashes in the first third of
    a second and a short afterglow. It whitens and cools what it lights and lifts the shadows; no bolt is drawn.
    every: strike on every n-th hit of the lane, counted over the whole song, so a storm over a Score's shots keeps
    its pace across the cuts (on every downbeat it struck 24 times in a minute of THE IRON SAINT)."""

    def __init__(self, on="downbeat", at="left", strength=1.0, tint=(.8, .88, 1.0), strikes=3, life=.9, fill=1.0, wash=.3, reach=1.0, every=1, seed=17):
        self.__dict__.update(locals()); del self.__dict__["self"]
        self._ramp = None

    def _flash(self, ctx, th, a):
        r = np.random.default_rng((self.seed + int(ctx.cues.key(th) * 1000)) % 2 ** 32)
        offs = [0.0, r.uniform(.05, .11), r.uniform(.15, .28), r.uniform(.3, .42)][:max(1, self.strikes)]
        amps = [1.0, r.uniform(.35, .65), r.uniform(.55, .95), r.uniform(.2, .4)]
        v = 0.0
        for o, A in zip(offs, amps):
            u = a - o
            if u >= 0:
                v = max(v, A * math.exp(-u / .045))
        return v + .12 * math.exp(-a / (self.life * .4)) * (a < self.life)

    def __call__(self, ctx, img):
        hits = ctx.cues.hits(self.on, ctx.t - self.life, ctx.t + 1e-6)
        if self.every > 1:
            hits = [th for th in hits if ctx.cues.count(self.on, th - 1e-6) % int(self.every) == 0]
        if not len(hits):
            return img
        k = max(self._flash(ctx, th, ctx.t - th) for th in hits) * self.strength
        if k < .01:
            return img
        if self._ramp is None:
            self._ramp = .3 + .7 * _ramp(ctx, self.at, self.reach)
        L = lum(img)
        take = .55 + .45 * smooth(.02, .5, blur(L, 2))               # lit surfaces take more than black voids
        M = self._ramp * take * _near(ctx)
        out = relight(img, M, 2.4 * k, self.tint, fill=self.fill)
        if self.wash:                                                  # the strike's white washes the colour out
            g = lum(out)[..., None] * _tint(self.tint)
            w = min(1.0, self.wash * k)
            out = out * (1 - w) + g * w
        hot = np.clip(out - 1, 0, None)                               # what it burns out blooms
        if hot.max() > 0:
            out = screen(np.clip(out, 0, 1), np.clip(blur(hot, .01 * _diag(ctx)) * .6, 0, 1))
        return out


# ---------------------------------------------------------------------------------------------------------------
class Sweep:
    """A beam of light crosses the scene on each hit, taking `dur` seconds: a car's headlights through a window, a
    lighthouse's beam, light through blinds (`slats`). angle: the beam's tilt in degrees; direction 1 = left to right."""

    def __init__(self, on="downbeat", width=.32, dur=1.6, angle=-10.0, direction=1, strength=.9, tint=(1.0, .93, .8), slats=0,
                 slat_width=.5, soft=.6, fill=.8, once=False, seed=3):
        self.__dict__.update(locals()); del self.__dict__["self"]
        self._P = None

    def __call__(self, ctx, img):
        hits = ctx.cues.hits(self.on, ctx.t - self.dur - .2, ctx.t + 1e-6)
        if self.once:
            first = ctx.cues.times(self.on)
            hits = hits[hits <= (first[0] if len(first) else -1) + 1e-6]
        if not len(hits):
            return img
        H, W = ctx.H, ctx.W
        if self._P is None:
            xx, yy = grid(H, W)
            a = math.radians(self.angle)
            u = (xx - W / 2) * math.cos(a) + (yy - H / 2) * math.sin(a)          # across the beam
            v = -(xx - W / 2) * math.sin(a) + (yy - H / 2) * math.cos(a)         # along it
            span = abs(W * math.cos(a)) + abs(H * math.sin(a))
            self._P = (u / span).astype(np.float32); self._V = (v / max(W, H)).astype(np.float32)
        M = np.zeros((H, W), np.float32)
        for th in hits:
            a = (ctx.t - th) / self.dur
            if a < 0 or a > 1.15:
                continue
            c = (-.5 - self.width) + (1 + 2 * self.width) * (a * a * (3 - 2 * a) * .35 + a * .65)
            c *= self.direction
            d = np.abs(self._P - c) / (self.width / 2)
            band = smooth(1.0, 1.0 - self.soft, d)
            if self.slats:
                ph = self._V * self.slats * math.pi * 2
                band = band * smooth(1 - self.slat_width - .08, 1 - self.slat_width + .08, .5 + .5 * np.cos(ph))
            M = np.maximum(M, band * smooth(1.15, .95, a) * smooth(0, .08, a))
        if M.max() < .01:
            return img
        take = .6 + .4 * smooth(.02, .45, blur(lum(img), 2))
        return relight(img, M * take * _near(ctx), 1.3 * self.strength, self.tint, fill=self.fill)


# ---------------------------------------------------------------------------------------------------------------
class Glow:
    """The highlights bloom and halate the way film does around bright lights: a soft glow and a warm red fringe.
    base: always there; amount: how much more on a hit (or held by a curve)."""

    def __init__(self, on=None, by=None, base=.35, amount=.8, threshold=.62, radius=.025, halation=.5, tint=(1.0, .93, .84), tau=.6):
        self.__dict__.update(locals()); del self.__dict__["self"]

    def __call__(self, ctx, img):
        k = self.base + self.amount * _amount(ctx, self.on, self.by, self.tau)
        if k < .01:
            return img
        D = _diag(ctx); H, W = ctx.H, ctx.W
        sm = cv2.resize(img, (W // 2, H // 2), interpolation=cv2.INTER_AREA)
        L = sm.max(2, keepdims=True)
        bright = np.clip((L - self.threshold) / (1 - self.threshold), 0, 1) ** 1.5 * sm
        r = self.radius * D / 2
        bloom = blur(bright, r * .4) * .5 + blur(bright, r) * .35 + blur(bright, r * 2.6) * .25
        hal = blur(bright.max(2), r * 1.6)[..., None] * np.array([1.0, .32, .12], np.float32) * self.halation
        light = cv2.resize(bloom * np.array(self.tint, np.float32) + hal, (W, H), interpolation=cv2.INTER_LINEAR)
        return screen(img, np.clip(light * k, 0, 1))


# ---------------------------------------------------------------------------------------------------------------
class Haze:
    """Heat shimmer: the air ripples and rises above the hot, bright things in the frame (fire, a lamp, sunlit stone),
    or (at="bottom") across the lower frame like heat off a road, or (at="all") everywhere."""

    def __init__(self, on=None, by=None, at="hot", base=.7, amount=.6, strength=1.0, scale=.03, rise=.35, tau=.6, seed=2):
        self.__dict__.update(locals()); del self.__dict__["self"]
        self._n = None; self._hot = None

    def _hotmap(self, ctx, img):
        H, W = ctx.H, ctx.W
        if self.at == "all":
            return np.ones((H, W), np.float32)
        if self.at == "bottom":
            yy = grid(H, W)[1] / H
            return smooth(.35, 1.0, yy).astype(np.float32)
        sm = cv2.resize(img, (W // 4, H // 4), interpolation=cv2.INTER_AREA)
        warm = np.clip(sm[..., 0] - sm[..., 2], 0, 1) * 2 + np.clip(lum(sm) - .7, 0, 1) * 1.5
        hot = np.clip(warm, 0, 1)
        # heat rises: carry each hot pixel's heat up the frame, fading as it goes
        acc = hot.copy()
        for y in range(acc.shape[0] - 2, -1, -1):
            acc[y] = np.maximum(acc[y], acc[y + 1] * .965)
        acc = cv2.GaussianBlur(acc, (0, 0), 3)
        return cv2.resize(np.clip(acc * 1.6, 0, 1), (W, H), interpolation=cv2.INTER_LINEAR)

    def __call__(self, ctx, img):
        k = self.base + self.amount * _amount(ctx, self.on, self.by, self.tau)
        if k < .01:
            return img
        H, W = ctx.H, ctx.W
        if self._n is None:
            s = self.scale * max(H, W)
            self._n = [value_noise(H * 2, W, s, self.seed + j, 2) - .5 for j in range(2)]
            self._xx, self._yy = grid(H, W)
        if self._hot is None or ctx.i % 6 == 0:
            new = self._hotmap(ctx, img)
            self._hot = new if self._hot is None else self._hot * .5 + new * .5
        off = int((ctx.t * self.rise * H) % H)
        nx = self._n[0][H - off:2 * H - off]; ny = self._n[1][H - off:2 * H - off]
        px = self.strength * k * .0045 * math.hypot(W, H)
        dx = nx * px * self._hot; dy = ny * px * .6 * self._hot
        out = cv2.remap(img, (self._xx + dx).astype(np.float32), (self._yy + dy).astype(np.float32), cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT_101)
        soft = blur(out, .0012 * math.hypot(W, H))
        m = (self._hot * min(1, k) * .35)[..., None]
        return out * (1 - m) + soft * m


# ---------------------------------------------------------------------------------------------------------------
class Glint:
    """A star glint on the brightest small point in the frame (a blade, an eye, a jewel, a buckle) on each hit: a hot core
    and thin rays that flare and die. at: 'bright', a mask name (the brightest point inside it), or (x, y)."""

    def __init__(self, on="beat", at="bright", size=.09, strength=1.0, rays=4, angle=18.0, life=.4, tint=(1.0, .97, .9), seed=1):
        self.__dict__.update(locals()); del self.__dict__["self"]
        self._state = {}; self._spr = {}

    def _where(self, ctx, img):
        if isinstance(self.at, (tuple, list)):
            return _point(ctx, img, self.at, self._state)
        L = lum(img)
        if self.at and self.at != "bright":
            m = ctx.mask(self.at)
            if m.max() > .5:
                L = L * (m > .5)
        g = cv2.GaussianBlur(cv2.resize(L, (ctx.W // 2, ctx.H // 2), interpolation=cv2.INTER_AREA), (0, 0), 1.0)
        g = g - .75 * blur(g, .02 * math.hypot(*g.shape))        # a small hot point, not a big bright area (a lamp, the sky)
        mg = max(2, int(.05 * min(g.shape)))
        g[:mg] = g[-mg:] = -1; g[:, :mg] = g[:, -mg:] = -1
        y, x = np.unravel_index(np.argmax(g), g.shape)
        return np.array([x * 2 + 1, y * 2 + 1], np.float32)

    def _sprite(self, R):
        R = max(8, int(R))
        if R in self._spr:
            return self._spr[R]
        yy, xx = np.mgrid[-R:R + 1, -R:R + 1].astype(np.float32)
        s = np.zeros_like(xx)
        for j in range(self.rays):
            a = math.radians(self.angle + j * 180.0 / self.rays)
            along = xx * math.cos(a) + yy * math.sin(a); across = -xx * math.sin(a) + yy * math.cos(a)
            w = .9 + R * .006
            s = np.maximum(s, np.exp(-(across / w) ** 2) * np.exp(-np.abs(along) / (R * (.32 if j % 2 == 0 else .2))))
        rr = np.sqrt(xx * xx + yy * yy)
        s = np.maximum(s, np.exp(-(rr / (R * .05)) ** 2)) + .25 * np.exp(-(rr / (R * .22)) ** 2)
        self._spr[R] = s.astype(np.float32)
        return self._spr[R]

    def __call__(self, ctx, img):
        hits = ctx.cues.hits(self.on, ctx.t - self.life, ctx.t + 1e-6)
        if not len(hits):
            return img
        a = ctx.t - hits[-1]
        e = (min(1, a / .04)) * math.exp(-max(0, a - .04) / (self.life * .35))
        if e < .01:
            return img
        if a < 1.5 / ctx.fps or "p" not in self._state:
            self._state["p"] = self._where(ctx, img)
        p = self._state["p"]
        R = self.size * _diag(ctx) * (.6 + .4 * e)
        spr = self._sprite(R) * e * self.strength
        H, W = ctx.H, ctx.W
        n = spr.shape[0] // 2
        x0, y0 = int(p[0]) - n, int(p[1]) - n
        layer = np.zeros((H, W), np.float32)
        sx0, sy0 = max(0, -x0), max(0, -y0)
        dx0, dy0 = max(0, x0), max(0, y0)
        w = min(W - dx0, spr.shape[1] - sx0); h = min(H - dy0, spr.shape[0] - sy0)
        if w <= 0 or h <= 0:
            return img
        layer[dy0:dy0 + h, dx0:dx0 + w] = spr[sy0:sy0 + h, sx0:sx0 + w]
        return screen(img, np.clip(layer[..., None] * np.array(self.tint, np.float32), 0, 1))


# ---------------------------------------------------------------------------------------------------------------
class Rim:
    """The subject's edge catches a back light on each hit (or held by a curve): a thin bright line along the side of
    the mask that faces the light. at: the side the light is on (left, right, top...) or 'bright' (the brightest
    thing in the frame)."""

    def __init__(self, on="beat", by=None, mask="subject", at="bright", strength=1.4, width=.008, tint=(.92, .96, 1.0), tau=.45, base=0.0):
        self.__dict__.update(locals()); del self.__dict__["self"]
        self._state = {}

    def __call__(self, ctx, img):
        k = self.base + _amount(ctx, self.on, self.by, self.tau)
        if k < .01 or self.mask not in ctx.masks:
            return img
        m = ctx.mask(self.mask, soft=0)
        if m.max() < .5:
            return img
        D = _diag(ctx)
        w = max(1.5, self.width * D)
        mb = blur(m, w * .6)
        gx = cv2.Sobel(mb, cv2.CV_32F, 1, 0, ksize=3); gy = cv2.Sobel(mb, cv2.CV_32F, 0, 1, ksize=3)
        nrm = np.sqrt(gx * gx + gy * gy) + 1e-6
        nx, ny = -gx / nrm, -gy / nrm                                          # the edge's outward normal
        if self.at in SIDES:
            lx, ly = SIDES[self.at]
        else:
            src = _point(ctx, img, self.at, self._state)
            c = ctx.centroid(self.mask) or (ctx.W / 2, ctx.H / 2)
            v = np.array([src[0] - c[0], src[1] - c[1]], np.float32); v /= (np.linalg.norm(v) + 1e-6)
            lx, ly = float(v[0]), float(v[1])
        facing = np.clip(nx * lx + ny * ly, 0, 1) ** .7
        band = np.clip(m - cv2.erode(m, np.ones((3, 3), np.uint8), iterations=max(1, int(w))), 0, 1)
        band = blur(band, w * .5) * facing
        out = relight(img, band * 2.5, k * self.strength, self.tint, fill=.8, sigma=w * 2)
        return screen(np.clip(out, 0, 1), np.clip(blur(band, w * 2.5)[..., None] * _tint(self.tint) * .35 * k * self.strength, 0, 1))


LIGHT = {c.__name__: c for c in (Flicker, Firelight, Lightning, Sweep, Glow, Haze, Glint, Rim)}
