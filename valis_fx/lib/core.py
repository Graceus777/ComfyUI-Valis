"""The Valis library's frame loop. Clips (video sources), masks and depth are loaded at the working size; every frame
the context computes the plate, its optical flow from the last frame, and keeps a short history, then each effect
in the stack takes the image so far and returns the next. Effects only ever ask the context *when* (cues) and
*where* (masks, depth, flow); what they do is theirs.

Images are float32 RGB in 0..1 throughout."""
import math
import os
import subprocess
from collections import deque

import cv2
import numpy as np

cv2.setNumThreads(4)


def smooth(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def ease(x):
    x = min(max(x, 0.0), 1.0)
    return x * x * (3 - 2 * x)


def blur(x, s):
    if s <= 0:
        return x
    return cv2.GaussianBlur(x, (0, 0), s, borderType=cv2.BORDER_REFLECT_101)


def lum(img):
    return img[..., 0] * .2126 + img[..., 1] * .7152 + img[..., 2] * .0722


def screen(a, b):
    return 1 - (1 - a) * (1 - b)


def grid(h, w):
    yy, xx = np.mgrid[:h, :w].astype(np.float32)
    return xx, yy


def warp_pull(img, flow, s=1.0):
    """out(x) = img(x + s * flow(x))"""
    h, w = flow.shape[:2]
    xx, yy = grid(h, w)
    return cv2.remap(img, (xx + s * flow[..., 0]).astype(np.float32), (yy + s * flow[..., 1]).astype(np.float32), cv2.INTER_LINEAR,
                     borderMode=cv2.BORDER_REFLECT_101)


def value_noise(h, w, scale, seed=0, octaves=4):
    """Smooth fractal noise in 0..1 (cheap: random grids upsampled with cubic interpolation)."""
    rng = np.random.default_rng(seed)
    out = np.zeros((h, w), np.float32); amp, tot = 1.0, 0.0
    for o in range(octaves):
        s = max(2, int(scale / (2 ** o)))
        g = rng.random((h // s + 3, w // s + 3)).astype(np.float32)
        out += amp * cv2.resize(g, (w + 3 * s, h + 3 * s), interpolation=cv2.INTER_CUBIC)[s:s + h, s:s + w]
        tot += amp; amp *= .5
    out /= tot
    return np.clip((out - out.mean()) / (out.std() * 3 + 1e-6) + .5, 0, 1)


class Clip:
    """A video (or still) at the working size. `start` (s) and `speed` place it on the timeline; it holds its last
    frame (or loops). Gray clips are masks: 0..1."""

    def __init__(self, path=None, frames=None, size=None, gray=False, start=0.0, speed=1.0, loop=False, fps=24.0, fit="cover", flip=False):
        self.gray, self.start, self.speed, self.loop, self.fps = gray, start, speed, loop, fps
        if frames is None:
            frames = []
            if path.lower().endswith((".png", ".jpg", ".jpeg", ".webp")):
                f = cv2.imread(path, cv2.IMREAD_GRAYSCALE if gray else cv2.IMREAD_COLOR)
                frames = [f]
            else:
                cap = cv2.VideoCapture(path)
                while True:
                    ok, f = cap.read()
                    if not ok:
                        break
                    frames.append(cv2.cvtColor(f, cv2.COLOR_BGR2GRAY) if gray else f)
            if not frames:
                raise ValueError(f"no frames in {path}")
        self.frames = [self._fit(f, size, fit) for f in frames] if size else list(frames)
        if flip:                                            # mirrored left-right (a second plate laid the other way round)
            self.frames = [np.ascontiguousarray(f[:, ::-1]) for f in self.frames]
        self.path = path

    @staticmethod
    def _fit(f, size, fit):
        w, h = size
        if f.shape[1] == w and f.shape[0] == h:
            return f
        if fit == "stretch":
            return cv2.resize(f, (w, h), interpolation=cv2.INTER_AREA)
        sc = max(w / f.shape[1], h / f.shape[0])
        r = cv2.resize(f, (math.ceil(f.shape[1] * sc), math.ceil(f.shape[0] * sc)), interpolation=cv2.INTER_AREA)
        y0, x0 = (r.shape[0] - h) // 2, (r.shape[1] - w) // 2
        return r[y0:y0 + h, x0:x0 + w]

    def __len__(self):
        return len(self.frames)

    def index(self, t):
        x = (t - self.start) * self.fps * self.speed
        n = len(self.frames)
        if self.loop:
            return int(math.floor(x)) % n
        return int(np.clip(math.floor(x), 0, n - 1))

    def at_t(self, t):
        f = self.frames[self.index(t)]
        return f.astype(np.float32) / 255 if self.gray else f[..., ::-1].astype(np.float32) / 255


class Ctx:
    def __init__(self, cues, size, n, fps=24.0, seed=0, hist=24):
        self.cues, (self.W, self.H), self.n, self.fps = cues, size, n, fps
        self.clips, self.masks = {}, {}
        self.depth = None
        self.rng = np.random.default_rng(seed)
        self.state = {}
        self.i, self.t = -1, 0.0
        self._hist = deque(maxlen=hist)          # plates, newest first (uint8)
        self._out = deque(maxlen=4)              # composites, newest first (float)
        self._dis = cv2.DISOpticalFlow_create(cv2.DISOPTICAL_FLOW_PRESET_MEDIUM)
        self._g_prev = None
        self.flow = np.zeros((self.H, self.W, 2), np.float32)

    # sources
    def add_clip(self, name, path=None, frames=None, **kw):
        self.clips[name] = Clip(path, frames, (self.W, self.H), **kw); return self

    def add_mask(self, name, path=None, frames=None, **kw):
        self.masks[name] = Clip(path, frames, (self.W, self.H), gray=True, **kw); return self

    def add_depth(self, path_or_array):
        d = np.load(path_or_array) if isinstance(path_or_array, str) else path_or_array
        d = d.astype(np.float32)
        if d.ndim == 2:
            d = d[None]
        self.depth = d; return self

    # per frame
    def begin(self, i):
        self.i, self.t = i, i / self.fps
        self.a = self.clip("a")
        g = cv2.cvtColor((self.a * 255).astype(np.uint8), cv2.COLOR_RGB2GRAY)
        if self._g_prev is not None:
            hs = cv2.resize(g, (self.W // 2, self.H // 2)); hp = cv2.resize(self._g_prev, (self.W // 2, self.H // 2))
            f = self._dis.calc(hs, hp, None)            # cur(x) ~ prev(x + f): pulls the last frame forward
            self.flow = cv2.resize(f, (self.W, self.H)) * 2
        self._g_prev = g
        self._hist.appendleft((self.a * 255).astype(np.uint8))

    def end(self, img):
        self._out.appendleft(img)

    def clip(self, name, t=None):
        return self.clips[name].at_t(self.t if t is None else t)

    def mask(self, name, t=None, soft=1.5):
        if name not in self.masks:
            return np.zeros((self.H, self.W), np.float32)
        m = self.masks[name].at_t(self.t if t is None else t)
        return blur(m, soft) if soft else m

    def depth_at(self, t=None):
        if self.depth is None:
            return np.full((self.H, self.W), .5, np.float32)
        k = int(np.clip(round((self.t if t is None else t) * self.fps), 0, len(self.depth) - 1))
        d = self.depth[k]
        return cv2.resize(d, (self.W, self.H), interpolation=cv2.INTER_LINEAR) if d.shape != (self.H, self.W) else d

    def hist(self, k):
        """The plate k frames ago (0 = now), clamped to what's kept."""
        k = int(np.clip(k, 0, len(self._hist) - 1))
        return self._hist[k].astype(np.float32) / 255

    def last_out(self):
        return self._out[0] if self._out else self.a

    def centroid(self, name, t=None, top=False):
        m = self.mask(name, t, soft=0)
        ys, xs = np.nonzero(m > .5)
        if len(xs) < 30:
            return None
        if top:          # the head end of a body mask: the centroid of the top 18% of it
            y0 = np.percentile(ys, 2); y1 = y0 + .18 * (np.percentile(ys, 98) - y0)
            k = ys <= y1; xs, ys = xs[k], ys[k]
        return float(xs.mean()), float(ys.mean())

    # cues
    def env(self, lane, tau=.3, attack=.015):
        return self.cues.env(lane, self.t, tau, attack)

    def level(self, src, tau=.3):
        return self.cues.level(src, self.t, tau) if src is not None else 0.0

    def since(self, lane):
        return self.cues.since(lane, self.t)


def render(ctx, effects, out_path, n=None, audio=None, crf=14, progress=None, every=24):
    n = n or ctx.n
    os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
    cmd = ["ffmpeg", "-y", "-v", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{ctx.W}x{ctx.H}", "-r", str(ctx.fps), "-i", "-"]
    if audio:
        cmd += ["-i", audio, "-map", "0:v", "-map", "1:a", "-c:a", "aac", "-b:a", "256k", "-shortest"]
    cmd += ["-c:v", "libx264", "-crf", str(crf), "-preset", "medium", "-pix_fmt", "yuv420p", "-movflags", "+faststart", out_path]
    p = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    for i in range(n):
        ctx.begin(i)
        img = ctx.a.copy()
        for fx in effects:
            img = fx(ctx, img)
            img = np.clip(img, 0, 1).astype(np.float32)
        ctx.end(img)
        p.stdin.write((img * 255 + .5).astype(np.uint8).tobytes())
        if progress and (i % every == 0 or i == n - 1):
            progress(i + 1, n)
    p.stdin.close(); p.wait()
    return out_path
