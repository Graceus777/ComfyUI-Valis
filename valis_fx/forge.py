"""FORGE: a dense, event-driven VFX stack for ECHOES (prototype; to be ported as a studio layer).

Everything is driven by the score's beat map (events.json) and the still's depth. Layers, in order:
  camera (2.5D push + depth parallax + shake + zoom punch) / shockwave refraction with chromatic split /
  grade (crushed blacks, drowned teal vs. ember) / volumetric mist that tolls blow back / necrotic veins on the dead /
  god rays from bell and lantern / shockwave light fronts / ember-ash-soul particle storm / lightning /
  sacred halo at the strike / feedback echoes / bloom + anamorphic streak + halation / beat rings (one of many) /
  grain + vignette / whiteout.
"""
import math
import numpy as np
import cv2
from scipy.ndimage import gaussian_filter

W, H, FPS = 768, 1344, 24
rng = np.random.default_rng(7)
cv2.setNumThreads(1)


def smooth(x):
    x = np.clip(x, 0, 1)
    return x * x * (3 - 2 * x)


def tex(seed, n=512, scales=(4, 8, 16, 32, 64)):
    r = np.random.default_rng(seed)
    acc = np.zeros((n, n), np.float32)
    for i, s in enumerate(scales):
        z = r.standard_normal((n, n)).astype(np.float32)
        z = gaussian_filter(z, s, mode='wrap').astype(np.float32)
        acc += z / z.std() * (0.55 ** (len(scales) - 1 - i))
    acc = (acc - acc.min()) / (acc.max() - acc.min())
    return acc


def sample_tex(t, X, Y):
    n = t.shape[0]
    return cv2.remap(t, (X % n).astype(np.float32), (Y % n).astype(np.float32), cv2.INTER_LINEAR,
                     borderMode=cv2.BORDER_WRAP)


T1, T2, T3 = tex(1), tex(2), tex(3, scales=(2, 4, 8))
# curl flow field from a noise potential (for particles)
_pot = gaussian_filter(tex(4), 6, mode='wrap').astype(np.float32)
FLOW_X = np.gradient(_pot, axis=0).astype(np.float32)
FLOW_Y = -np.gradient(_pot, axis=1).astype(np.float32)
FLOW_X /= np.abs(FLOW_X).max(); FLOW_Y /= np.abs(FLOW_Y).max()

YY, XX = np.mgrid[0:H, 0:W].astype(np.float32)
h4, w4 = H // 4, W // 4
Y4, X4 = np.mgrid[0:h4, 0:w4].astype(np.float32)


def set_resolution(w, h):
    """The Valis pass works at the clip's own size (portrait or landscape)."""
    global W, H, YY, XX, h4, w4, Y4, X4
    W, H = int(w), int(h)
    YY, XX = np.mgrid[0:H, 0:W].astype(np.float32)
    h4, w4 = H // 4, W // 4
    Y4, X4 = np.mgrid[0:h4, 0:w4].astype(np.float32)


def env(t, times, tau, attack=0.015):
    v = 0.0
    for e in times:
        dt = t - e
        if dt >= 0:
            v += (1 - math.exp(-dt / attack)) * math.exp(-dt / tau)
    return v


def bloom(img, thr=0.62, strength=0.9):
    lum = img.max(axis=2)
    m = np.clip((lum - thr) / (1 - thr), 0, 1)[..., None]
    b = cv2.resize(img * m, (w4, h4), interpolation=cv2.INTER_AREA)
    acc = np.zeros_like(b)
    for s, k in ((2, .5), (6, .35), (16, .3), (36, .25)):
        acc += cv2.GaussianBlur(b, (0, 0), s) * k
    streak = cv2.GaussianBlur(b * np.clip((b.max(2, keepdims=True) - .35) * 3, 0, 1), (0, 0), sigmaX=60, sigmaY=.8)
    acc += streak * np.array([.55, .75, 1.0], np.float32) * 0.9      # anamorphic, cold
    up = cv2.resize(acc, (W, H), interpolation=cv2.INTER_LINEAR)
    # halation: red fringe around highlights
    hal = cv2.GaussianBlur(cv2.resize(m[..., 0], (w4, h4)), (0, 0), 3)
    hal = cv2.resize(hal, (W, H))[..., None] * np.array([1.0, .25, .08], np.float32) * .25
    return img + (up + hal) * strength


def god_rays(img, depth, src, src_depth, strength, tint, samples=28, decay=0.62):
    """Radial light shafts toward src; only things at or behind the source emit, so the foreground occludes."""
    sm = cv2.resize(img, (w4, h4), interpolation=cv2.INTER_AREA)
    dm = cv2.resize(depth, (w4, h4), interpolation=cv2.INTER_AREA)
    lum = sm.max(2)
    em = np.clip((lum - .66) * 3.0, 0, 1) * (dm <= src_depth + .06)
    sx, sy = src[0] / 4, src[1] / 4
    em = em + 1.4 * np.exp(-((X4 - sx) ** 2 + (Y4 - sy) ** 2) / (2 * 4.0 ** 2))
    em = em.astype(np.float32)
    acc = np.zeros_like(em)
    for i in range(samples):
        s = 1 - decay * i / samples
        mx = (sx + (X4 - sx) * s).astype(np.float32)
        my = (sy + (Y4 - sy) * s).astype(np.float32)
        acc += cv2.remap(em, mx, my, cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT)
    acc /= samples
    acc = cv2.GaussianBlur(acc, (0, 0), 1.2)
    up = cv2.resize(acc, (W, H), interpolation=cv2.INTER_LINEAR)[..., None]
    return img + up * np.array(tint, np.float32) * strength


def screen(a, b):
    return 1 - (1 - a) * (1 - b)


class Particles:
    def __init__(self, n, seed):
        self.r = np.random.default_rng(seed)
        self.n = n
        self.x = np.zeros(n, np.float32); self.y = np.zeros(n, np.float32)
        self.vx = np.zeros(n, np.float32); self.vy = np.zeros(n, np.float32)
        self.z = np.zeros(n, np.float32); self.life = np.zeros(n, np.float32)
        self.heat = np.zeros(n, np.float32)
        self.px = self.x.copy(); self.py = self.y.copy()

    def spawn(self, k, xs, ys, vx=0, vy=0, spread=40, heat=1.0, z=None, life=(1.5, 4.0)):
        dead = np.flatnonzero(self.life <= 0)[:k]
        k = len(dead)
        if k == 0:
            return
        i = self.r.integers(0, len(xs), k)
        self.x[dead] = xs[i] + self.r.normal(0, 2, k); self.y[dead] = ys[i] + self.r.normal(0, 2, k)
        self.px[dead] = self.x[dead]; self.py[dead] = self.y[dead]
        self.vx[dead] = vx + self.r.normal(0, spread, k); self.vy[dead] = vy + self.r.normal(0, spread, k)
        self.z[dead] = self.r.uniform(.3, 1.0, k) if z is None else z[i]
        self.life[dead] = self.r.uniform(*life, k)
        self.heat[dead] = heat * self.r.uniform(.5, 1.0, k)

    def step(self, dt, t, flow=120.0, buoy=-40.0, drag=0.9, impulses=()):
        a = self.life > 0
        n = 512
        fx = FLOW_X[(self.y / 3 + t * 9).astype(int) % n, (self.x / 3).astype(int) % n]
        fy = FLOW_Y[(self.y / 3 + t * 9).astype(int) % n, (self.x / 3).astype(int) % n]
        self.vx += (fx * flow - self.vx * (1 - drag)) * dt * 3
        self.vy += (fy * flow + buoy - self.vy * (1 - drag)) * dt * 3
        for (cx, cy, radius, power) in impulses:          # a shock front shoves what it passes
            dx = self.x - cx; dy = self.y - cy
            d = np.sqrt(dx * dx + dy * dy) + 1e-3
            g = np.exp(-((d - radius) / 60.0) ** 2) * power
            self.vx += dx / d * g; self.vy += dy / d * g
            self.heat = np.minimum(self.heat + g / 900, 1.6)
        self.px[:] = self.x; self.py[:] = self.y
        self.x += self.vx * dt; self.y += self.vy * dt
        self.life -= dt * a
        self.heat *= 0.985

    def render(self, colors, gain=1.0):
        """Additive motion-streak splats at half resolution; colors: (cold, hot) RGB."""
        hh, ww = H // 2, W // 2
        buf = np.zeros((hh * ww, 3), np.float32)
        a = np.flatnonzero(self.life > 0)
        if len(a) == 0:
            return np.zeros((H, W, 3), np.float32)
        fade = np.clip(self.life[a], 0, 1) * (0.35 + 0.65 * self.z[a])
        heat = np.clip(self.heat[a], 0, 1.6)[:, None]
        col = (np.array(colors[0], np.float32) * (1 - np.minimum(heat, 1)) + np.array(colors[1], np.float32) *
               np.minimum(heat, 1)) * (1 + .6 * np.clip(heat - 1, 0, 1))
        for k in range(5):
            f = k / 4
            xs = ((self.px[a] * (1 - f) + self.x[a] * f) / 2).astype(int)
            ys = ((self.py[a] * (1 - f) + self.y[a] * f) / 2).astype(int)
            ok = (xs >= 0) & (xs < ww) & (ys >= 0) & (ys < hh)
            idx = ys[ok] * ww + xs[ok]
            np.add.at(buf, idx, col[ok] * (fade[ok] * gain * .5)[:, None])
        buf = buf.reshape(hh, ww, 3)
        core = cv2.GaussianBlur(buf, (0, 0), .7)
        glow = cv2.GaussianBlur(buf, (0, 0), 4)
        out = core * 1.4 + glow * 3.0
        return cv2.resize(out, (W, H), interpolation=cv2.INTER_LINEAR)


def bolt(p0, p1, rough, depth=7, r=None):
    pts = [np.array(p0, float), np.array(p1, float)]
    for _ in range(depth):
        new = [pts[0]]
        for a, b in zip(pts[:-1], pts[1:]):
            m = (a + b) / 2
            d = b - a
            nrm = np.array([-d[1], d[0]]) / (np.linalg.norm(d) + 1e-6)
            m = m + nrm * r.normal(0, rough * np.linalg.norm(d) * .5)
            new += [m, b]
        pts = new
    return np.array(pts)


def draw_lightning(t, strikes, rr):
    """strikes: list of (time, p0, [targets]). Returns additive light."""
    canvas = np.zeros((H, W), np.float32)
    for (te, p0, targets) in strikes:
        age = t - te
        if age < 0 or age > .32:
            continue
        flick = [1.0, .3, .9, .15, .6, .1, .35, .05][min(int(age * FPS), 7)]
        r = np.random.default_rng(int(te * 1000) + int(age * FPS) // 3)
        for tg in targets:
            pts = bolt(p0, tg, .28, 7, r)
            cv2.polylines(canvas, [pts.astype(np.int32)], False, flick, 3, cv2.LINE_AA)
            for _ in range(3):                                             # forks
                j = r.integers(len(pts) // 4, len(pts) - 2)
                end = pts[j] + r.normal(0, 140, 2)
                fp = bolt(pts[j], end, .3, 5, r)
                cv2.polylines(canvas, [fp.astype(np.int32)], False, flick * .6, 1, cv2.LINE_AA)
    if canvas.max() == 0:
        return None
    glow = cv2.GaussianBlur(canvas, (0, 0), 5) * 4 + cv2.GaussianBlur(canvas, (0, 0), 30) * 7
    return (canvas[..., None] * np.array([1.0, 1.0, 1.0], np.float32) * 1.6 +
            glow[..., None] * np.array([.55, .7, 1.0], np.float32))


def halo(t, te, c, scale, rot_speed=.35):
    """Sacred halo at the strike: concentric bands + radiating spokes + a glyph ring, gold-white."""
    age = t - te
    if age < 0 or age > 4.5:
        return None
    a = math.exp(-age / 1.6) * smooth(age / .08)
    cx, cy = c
    dx, dy = XX - cx, YY - cy
    d = np.sqrt(dx * dx + dy * dy)
    th = np.arctan2(dy, dx)
    R = (180 + 420 * (1 - math.exp(-age / .7))) * scale
    bands = np.zeros_like(d)
    for k, (rr, w) in enumerate(((1.0, 3), (.82, 2), (.64, 5), (1.22, 2), (1.45, 1.5))):
        bands += np.exp(-((d - R * rr) / w) ** 2) * (1 - .12 * k)
    spokes = np.clip(np.cos(th * 72 + age * rot_speed * 6) * 6 - 5, 0, 1) * smooth((d - R * .64) / 40) * \
        np.exp(-np.maximum(d - R * 1.22, 0) / 90)
    glyph = (np.cos(th * 24 - age * rot_speed * 9) > .6) * np.exp(-((d - R * .9) / 9) ** 2)
    field = bands * 1.2 + spokes * .55 + glyph * .9
    field = field.astype(np.float32)
    g = cv2.GaussianBlur(field, (0, 0), 5) * 1.5
    out = (field[..., None] * np.array([1.0, .93, .78], np.float32) + g[..., None] * np.array([1.0, .7, .3], np.float32))
    return out * a


def grade(img, teal=0.5, ember=0.5, crush=0.5, sat=1.0):
    lum = (img * np.array([.299, .587, .114], np.float32)).sum(2, keepdims=True)
    img = lum + (img - lum) * sat
    img = np.clip(img, 0, None)
    # crushed blacks + S-curve
    img = np.clip((img - .04 * crush) / (1 - .04 * crush), 0, None)
    img = img ** (1 + .35 * crush)
    sh = (1 - smooth(lum / .45))
    hi = smooth((lum - .45) / .5)
    img = img + sh * np.array([-.03, .015, .05], np.float32) * teal * 1.6
    img = img + hi * np.array([.08, .02, -.06], np.float32) * ember * 1.6
    return np.clip(img, 0, None)
