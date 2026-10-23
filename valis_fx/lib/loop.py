"""Loops: the effects over a looping clip, looping with it.

The loop itself is made by the video model: MiniMax H3 Loop (pxl-pshr/ComfyUI-MiniMaxH3-Loop) samples the latent with
its end wrapped round to its start, so H3 denoises the join like any other frame. What Valis adds is everything after:

  render_loop   a Valis library stack over a loop, looping. The cues repeat every loop (a hit near the end still rings
                into the start), held curves wrap, per-frame noise and per-hit patterns repeat, and a warm-up plays the
                loop once first, so every effect with a memory (echoes, trails, the datamosh smear, frost, the slit-scan's
                past) arrives at frame 0 exactly as it would on the second time round. Whatever still differs between the
                passes (a drift that never comes back) is sealed: the last frames fade into the warm-up pass, which leads
                straight into frame 0. open_loop / close_loop do the same around any other frame-by-frame effect.
  LoopCues / loop_score   cues and Valis scores made periodic
  seam_report   the wrap-around step next to the steps around it (picture and motion)
  write_gif / write_webp / write_mp4   files that loop forever; the GIF has one palette for the whole loop, an ordered
                dither, and frame delays that add up to the loop's true length

Frames here are numpy arrays (N, H, W, 3), float32 in 0..1 (ComfyUI's IMAGE layout) unless a function says uint8.
"""
import math
import os
import shutil
import subprocess

import cv2
import numpy as np

from .cues import Cues


# ------------------------------------------------------------------------------------------------ small helpers
def ramp(k, curve="cosine"):
    """k blend weights strictly inside (0, 1), rising: no seam frame is a copy of either side."""
    t = np.arange(1, k + 1, dtype=np.float32) / (k + 1)
    if curve == "cosine":
        t = .5 - .5 * np.cos(math.pi * t)
    elif curve == "smoothstep":
        t = t * t * (3 - 2 * t)
    return t.astype(np.float32)


def thumbs(frames, w=96):
    """Small float copies for comparing frames (N, h, w, 3)."""
    n, H, W = frames.shape[:3]
    h = max(8, round(H * w / W))
    out = np.empty((n, h, w, 3), np.float32)
    for i, f in enumerate(frames):
        out[i] = cv2.resize(np.asarray(f[..., :3], np.float32), (w, h), interpolation=cv2.INTER_AREA)
    return out


def _gray_u8(f, w=None):
    f = np.asarray(f[..., :3], np.float32)
    if w and f.shape[1] != w:
        f = cv2.resize(f, (w, max(8, round(f.shape[0] * w / f.shape[1]))), interpolation=cv2.INTER_AREA)
    return cv2.cvtColor(np.clip(f * 255 + .5, 0, 255).astype(np.uint8), cv2.COLOR_RGB2GRAY)


_DIS = None


def flow(a_u8, b_u8):
    """Dense optical flow a -> b (grey uint8): a(x) ~ b(x + f(x))."""
    global _DIS
    if _DIS is None:
        _DIS = cv2.DISOpticalFlow_create(cv2.DISOPTICAL_FLOW_PRESET_MEDIUM)
    return _DIS.calc(a_u8, b_u8, None)


def _periodic(frames, n, seal=8):
    """A second clip as an n-frame loop (what shows through a tear or a double exposure has to loop too): extended
    by playing it back and forth if it is short, then dissolved shut at length n."""
    m = len(frames)
    s = max(1, min(seal, n // 3))
    ext = frames
    while len(ext) < n + s:
        ext = np.concatenate([ext, ext[::-1][1:]], 0) if len(ext) > 1 else np.repeat(ext, n + s, 0)
    ext = ext[:n + s]
    w = ramp(s)[:, None, None, None]
    seam = ext[n:] * (1 - w) + ext[:s] * w
    return np.concatenate([ext[s:n], seam.astype(np.float32)], 0)


# ------------------------------------------------------------------------------------------------ periodic cues
class LoopCues(Cues):
    """Cues made periodic. What happens in [0, period) of `cues` happens again every period, before and after, placed
    so the loop's frame 0 sits at time `at` (an opened loop's warm-up comes first). Envelopes, `since` and hit ages
    run straight across the seam; hit counters and hit indices count within the loop (so a 'random clip per hit'
    or a per-hit pattern repeats). Held curves wrap; a curve that ends away from where it starts is eased onto its
    start over the last `seal` frames, so it never jumps at the seam."""

    def __init__(self, cues, period, fps=24.0, at=0.0, reach=(-60.0, 60.0), seal=12):
        period = float(period)
        if period <= 0:
            raise ValueError("loop period must be > 0")
        base_l, base_v = {}, {}
        for name, ts in cues.lanes.items():
            ts = np.asarray(ts, np.float64)
            v = cues.vel(name)
            keep = (ts >= -1e-9) & (ts < period - 1e-9)
            base_l[name], base_v[name] = ts[keep], v[keep]
        self._base = Cues(base_l, base_v, None, period, fps)
        lo, hi = reach
        m0, m1 = int(math.floor((lo - at) / period)) - 1, int(math.ceil((hi - at) / period)) + 1
        lanes, vals, self._keys = {}, {}, {}
        for name, ts in base_l.items():
            reps = [ts + at + q * period for q in range(m0, m1 + 1)]
            lanes[name] = np.concatenate(reps) if reps else ts
            vals[name] = np.tile(base_v[name], m1 - m0 + 1)
            for r in reps:
                self._keys.update(zip(np.round(r, 6).tolist(), ts.tolist()))
        n = max(1, int(round(period * fps)))
        curves = {}
        for name in cues.curves:
            c = np.array([cues.curve(name, i / fps) for i in range(n + 1)], np.float32)
            nxt, c = c[n], c[:n]
            s = min(int(seal), n // 2)
            if s > 0 and n > 2:                         # land the curve on its own start: no jump at the seam
                jump = c[0] - (nxt if cues.curves[name].shape[0] > n else c[-1] + (c[-1] - c[-2]))
                c[n - s:] += jump * ramp(s, "smoothstep")
            curves[name] = c
        super().__init__(lanes, vals, curves, duration=period, fps=fps, bpm=cues.bpm, meter=cues.meter, offset=0.0,
                         meta={**cues.meta, "loop": {"period": period, "at": at}})
        self.period, self.at, self._n = period, float(at), n

    def key(self, t):
        """A hit's place in the loop (the same on every pass), for effects that seed a pattern from it."""
        return self._keys.get(round(float(t), 6), (float(t) - self.at) % self.period)

    def _k(self, lane):
        return max(len(self._base.times(lane)), 1)

    def curve(self, name, t):
        c = self.curves.get(name)
        if c is None or len(c) == 0:
            return 0.0
        x = ((t - self.at) * self.fps) % self._n
        i = int(math.floor(x)) % self._n
        j = (i + 1) % self._n
        return float(c[i] + (c[j] - c[i]) * (x - math.floor(x)))

    def since(self, lane, t):
        a, j = super().since(lane, t)
        return (a, j % self._k(lane)) if j >= 0 else (a, j)

    def count(self, lane, t):
        c = super().count(lane, t)                     # 1..K once anything has hit: the same at the loop's end and start
        return (c - 1) % self._k(lane) + 1 if c > 0 else 0


def loop_score(score, t0, period, at=0.0, reach=60.0):
    """A Valis score (the dict the score engine writes) made periodic for one loop: the events in [t0, t0 + period) are
    repeated every period, the loop's frame 0 placed at t0 + at (Valis FX reads time as t0 + frame / fps)."""
    out = dict(score)
    ev = {}
    for k, v in (score.get("events") or {}).items():
        if not (isinstance(v, list) and (not v or isinstance(v[0], (int, float)))):
            ev[k] = v
            continue
        a = np.asarray(v, np.float64)
        tau = a[(a >= t0 - 1e-9) & (a < t0 + period - 1e-9)] - t0
        q0, q1 = int(math.floor(-reach / period)) - 1, int(math.ceil(reach / period)) + 1
        ev[k] = sorted(float(t0 + at + x + q * period) for q in range(q0, q1 + 1) for x in tau)
    out["events"] = ev
    out["loop"] = {"t0": t0, "period": period, "at": at}
    return out


# ------------------------------------------------------------------------------------------------ effects that loop
def _seal(out_tail, warm_tail, curve="cosine"):
    """The last frames of this pass fade into the warm-up pass's last frames (which lead into frame 0)."""
    s = len(out_tail)
    w = ramp(s, curve)[:, None, None, None]
    return (out_tail * (1 - w) + warm_tail * w).astype(np.float32)


def _diff(a, b):
    return float(np.mean(np.abs(np.asarray(a, np.float32) - np.asarray(b, np.float32))))


def open_loop(frames, warm, extra=()):
    """The batch to render: the loop's last `warm` frames (wrapping round as many times as needed), then the loop.
    `extra`: other per-frame sequences (masks, depth) laid out the same way. Returns (frames, extras, info)."""
    n = len(frames)
    warm = max(int(warm), 0)
    idx = np.arange(-warm, n) % n
    ext = [None if x is None else x[np.minimum(idx, len(x) - 1)] for x in extra]
    return frames[idx], ext, {"n": n, "warm": warm}


def close_loop(frames, info, seal=12, curve="cosine"):
    """The rendered batch back to the loop: the warm-up dropped, the last `seal` frames sealed into it. Returns the loop
    and how different the two passes were (0 = the effects loop on their own)."""
    n, warm = int(info["n"]), int(info["warm"])
    if len(frames) != n + warm:
        raise ValueError(f"Loop Close expected {n + warm} frames ({warm} warm-up + {n}), got {len(frames)}: the effects "
                         "between Open and Close must keep every frame")
    s = max(0, min(int(seal), warm, n // 2))
    out = np.array(frames[warm:], np.float32)
    drift = 0.0
    if s:
        a, b = out[n - s:], frames[warm - s:warm]
        drift = _diff(a, b)
        out[n - s:] = _seal(a, np.asarray(b, np.float32), curve)
    return out, {"sealed": s, "drift": drift}


def render_loop(frames, cues, stack, fps=24.0, start=0.0, other=None, masks=None, depth=None, warm=None, seal=12,
                progress=None):
    """A Valis library stack over a loop, looping. frames: the loop (a MiniMax H3 Loop render, or any clip that already loops).
    cues: as for Valis Render (`start` = where the loop begins on them); [start, start + loop) repeats. warm: frames
    played before frame 0 so the effects' memory is right (None = one whole loop). Returns (loop, info)."""
    from .core import Ctx
    from .effects import LIBRARY

    n = len(frames)
    H, W = frames.shape[1:3]
    period = n / fps
    seal = max(0, min(int(seal), n // 2))
    warm = n if warm is None or warm < 0 else int(warm)
    warm = max(warm, seal)
    cu = cues.shifted(-start) if start else cues
    lc = LoopCues(cu, period, fps, at=0.0, reach=(-warm / fps - 30.0, period + 30.0), seal=seal)
    u8 = lambda fr: [np.clip(np.asarray(f[..., :3], np.float32)[..., ::-1] * 255 + .5, 0, 255).astype(np.uint8) for f in fr]

    class LoopCtx(Ctx):
        """Frame i of the render is loop frame i mod n (pictures, masks, depth, per-frame noise); time runs on."""

        def begin(self, i):
            self.k = i % n
            Ctx.begin(self, i)
            self.i = self.k

        def clip(self, name, t=None):
            c = self.clips[name]
            if t is None:
                f = c.frames[self.k % len(c.frames)]
                return f.astype(np.float32) / 255 if c.gray else f[..., ::-1].astype(np.float32) / 255
            return c.at_t(t % period)

        def mask(self, name, t=None, soft=1.5):
            if name not in self.masks:
                return np.zeros((self.H, self.W), np.float32)
            c = self.masks[name]
            m = c.frames[self.k % len(c.frames)].astype(np.float32) / 255 if t is None else c.at_t(t % period)
            from .core import blur
            return blur(m, soft) if soft else m

        def depth_at(self, t=None):
            if self.depth is None:
                return np.full((self.H, self.W), .5, np.float32)
            k = self.k if t is None else int(round((t % period) * self.fps))
            d = self.depth[k % len(self.depth)]
            return cv2.resize(d, (self.W, self.H), interpolation=cv2.INTER_LINEAR) if d.shape != (self.H, self.W) else d

    ctx = LoopCtx(lc, (W, H), n, fps)
    ctx.add_clip("a", frames=u8(frames), fps=fps, loop=True)
    if other is not None:
        ctx.add_clip("b", frames=u8(_periodic(np.asarray(other, np.float32), n, seal)), fps=fps, loop=True)
    for name, m in (masks or {}).items():
        if m is not None:
            seq = [np.clip(np.asarray(x, np.float32) * 255 + .5, 0, 255).astype(np.uint8) for x in m]
            seq = [seq[min(i, len(seq) - 1)] for i in range(n)]
            ctx.add_mask(name, frames=seq, fps=fps, loop=True)
    if depth is not None:
        ctx.add_depth(np.asarray(depth, np.float32))
    fx = [LIBRARY[name](**p) for name, p in stack]
    for f in fx:
        if hasattr(f, "once"):                          # Shatter: "once" means once per loop here
            f.once = False
    total = warm + n
    out = np.empty((n, H, W, 3), np.float32)
    warm_tail = np.empty((seal, H, W, 3), np.float32) if seal else None
    for j in range(-warm, n):
        ctx.begin(j)
        img = ctx.a.copy()
        for f in fx:
            img = np.clip(f(ctx, img), 0, 1).astype(np.float32)
        ctx.end(img)
        if j >= 0:
            out[j] = img
        elif seal and j >= -seal:
            warm_tail[j + seal] = img
        if progress:
            progress(j + warm + 1, total)
    drift = 0.0
    if seal:
        drift = _diff(out[n - seal:], warm_tail)
        out[n - seal:] = _seal(out[n - seal:], warm_tail)
    return out, {"frames": n, "seconds": round(period, 3), "warm": warm, "sealed": seal, "drift": drift}


# ------------------------------------------------------------------------------------------------ the check
def seam_report(frames, w=192):
    """How the wrap-around (last frame -> first) compares with the frames around it, cyclically:
      picture: the change last -> first over the median change of the steps on either side of it (1 = ordinary)
      motion:  how much the optical flow changes across the wrap (a stall, a reversal, a jump) over how much it changes
               from frame to frame around it
      busiest: the stretch of the loop where the picture changes fastest, against the loop's median (a blend that has
               to cover a big difference shows up here)
    seamless when the wrap is ordinary on both counts (picture and motion <= 2)."""
    n = len(frames)
    if n < 6:
        return {"frames": n, "verdict": "need at least 6 frames"}
    th = thumbs(frames, w)
    d = np.sqrt(((np.roll(th, -1, 0) - th) ** 2).mean(axis=(1, 2, 3)))     # d[i]: step i -> i+1; d[n-1] is the wrap
    r = max(2, min(8, n // 4))
    near = np.array([d[(n - 1 + j) % n] for j in range(-r, r + 1) if j])
    pic = float(d[n - 1]) / max(float(np.median(near)), 1e-5)
    g = [_gray_u8(f) for f in th]
    fl = [flow(g[i], g[(i + 1) % n]) for i in range(n)]                    # fl[i]: i -> i+1; fl[n-1] across the wrap
    jerk = np.array([float(np.sqrt(((fl[i] - fl[i - 1]) ** 2).sum(-1)).mean()) for i in range(n)])
    # jerk[i]: the change in motion at frame i. jerk[n-1] (into the wrap) and jerk[0] (out of it) both involve it
    near_j = np.array([jerk[j % n] for j in range(-r - 1, r + 1) if j not in (-1, 0)])
    mot = max(jerk[0], jerk[n - 1]) / max(float(np.median(near_j)), 1e-3)
    m = min(6, n // 3)
    win = np.convolve(np.concatenate([d, d[:m - 1]]), np.ones(m) / m, "valid")[:n]
    j = int(np.argmax(win))
    busiest = (j, (j + m) % n, round(float(win[j]) / max(float(np.median(d)), 1e-5), 2))
    ok = pic <= 2.0 and mot <= 2.0
    return {"frames": n, "picture": round(pic, 2), "motion": round(float(mot), 2), "busiest": busiest,
            "verdict": "seamless" if ok else "visible seam"}


def report_text(r):
    if "picture" not in r:
        return r.get("verdict", "")
    a, b, x = r["busiest"]
    return (f"{r['verdict']}: at the wrap the picture changes {r['picture']:.2f}x and the motion {r['motion']:.2f}x as much "
            f"as around it (1 = an ordinary frame). Busiest stretch: frames {a}-{b}, {x:.2f}x the loop's median. "
            f"{r['frames']} frames.")


# ------------------------------------------------------------------------------------------------ files that loop
def ffmpeg_exe():
    exe = shutil.which("ffmpeg")
    if exe:
        return exe
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        return None


def _u8(frames, width=0):
    out = []
    for f in frames:
        f = np.asarray(f[..., :3], np.float32)
        if width and width < f.shape[1]:                # smaller only: a GIF never gains pixels the clip doesn't have
            h = max(2, int(round(f.shape[0] * width / f.shape[1] / 2)) * 2)
            f = cv2.resize(f, (int(width), h), interpolation=cv2.INTER_AREA)
        out.append(np.clip(f * 255 + .5, 0, 255).astype(np.uint8))
    return out


def gif_delays(n, fps):
    """GIF frame delays in centiseconds that add up to the loop's true length (24 fps: 4, 4, 5, 4, 4, 4, ...)."""
    edges = np.round(np.arange(n + 1) * 100.0 / fps).astype(int)
    return np.maximum(np.diff(edges), 2).tolist()


def _set_gif_delays(path, delays):
    """Rewrite each frame's delay (its Graphic Control Extension) in place; the image data is untouched."""
    b = bytearray(open(path, "rb").read())
    if b[:3] != b"GIF" or len(b) < 13:
        return False
    p = 13 + (3 * 2 ** ((b[10] & 7) + 1) if b[10] & 0x80 else 0)
    k = 0
    try:
        while p < len(b) and b[p] != 0x3B:
            if b[p] == 0x21:
                if b[p + 1] == 0xF9 and b[p + 2] == 4:
                    if k < len(delays):
                        b[p + 4:p + 6] = int(delays[k]).to_bytes(2, "little")
                    k += 1
                p += 2
            elif b[p] == 0x2C:
                fl = b[p + 9]
                p += 10 + (3 * 2 ** ((fl & 7) + 1) if fl & 0x80 else 0) + 1
            else:
                return False
            while b[p] != 0:                            # data sub-blocks
                p += b[p] + 1
            p += 1
    except IndexError:
        return False
    if k != len(delays):
        return False
    open(path, "wb").write(bytes(b))
    return True


def write_gif(frames, path, fps=24.0, width=480, colors=256, dither="bayer"):
    """A GIF that loops forever. One palette for the whole loop (built from every frame), so colours never jump at the
    seam; bayer (ordered) dither stays still from frame to frame where error diffusion would crawl. ffmpeg if found,
    else Pillow."""
    from PIL import Image
    fr = _u8(frames, width)
    h, w = fr[0].shape[:2]
    delays = gif_delays(len(fr), fps)
    exe = ffmpeg_exe()
    if exe:
        d = {"bayer": "bayer:bayer_scale=3", "none": "none", "floyd": "floyd_steinberg", "sierra": "sierra2_4a"}.get(dither, "bayer:bayer_scale=3")
        vf = (f"split[a][b];[a]palettegen=max_colors={int(colors)}:stats_mode=full:reserve_transparent=0[p];"
              f"[b][p]paletteuse=dither={d}:diff_mode=rectangle")
        tmp = path + ".tmp.gif"
        cmd = [exe, "-y", "-v", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{w}x{h}", "-r", f"{fps}", "-i", "-",
               "-lavfi", vf, "-loop", "0", tmp]
        p = subprocess.run(cmd, input=b"".join(f.tobytes() for f in fr), capture_output=True)
        if p.returncode == 0 and os.path.isfile(tmp):
            _set_gif_delays(tmp, delays)               # ffmpeg rounds every delay alike (24 fps would play at 25)
            os.replace(tmp, path)
            return path
    # Pillow: one adaptive palette from a montage of the loop
    step = max(1, len(fr) // 24)
    sample = np.concatenate([f[::4, ::4] for f in fr[::step]], 0)
    pal = Image.fromarray(sample).quantize(colors=int(colors), method=Image.Quantize.MEDIANCUT)
    dz = Image.Dither.NONE if dither in ("none", "bayer") else Image.Dither.FLOYDSTEINBERG
    ims = [Image.fromarray(f).quantize(palette=pal, dither=dz) for f in fr]
    ims[0].save(path, save_all=True, append_images=ims[1:], loop=0, duration=[x * 10 for x in delays], disposal=1, optimize=False)
    return path


def write_webp(frames, path, fps=24.0, width=0, quality=90):
    from PIL import Image
    fr = _u8(frames, width)
    ims = [Image.fromarray(f) for f in fr]
    edges = np.round(np.arange(len(fr) + 1) * 1000.0 / fps).astype(int)
    ims[0].save(path, save_all=True, append_images=ims[1:], loop=0, duration=np.diff(edges).tolist(), quality=int(quality), method=4)
    return path


def write_mp4(frames, path, fps=24.0, width=0, repeats=1, crf=16):
    """H.264 (yuv420p, even size). repeats > 1 writes the loop several times over (for players and feeds that don't loop)."""
    import av
    from fractions import Fraction
    fr = _u8(frames, width)
    h, w = fr[0].shape[:2]
    h2, w2 = h - h % 2, w - w % 2
    rate = Fraction(fps).limit_denominator(1001)
    with av.open(path, mode="w", options={"movflags": "+faststart"}) as c:
        s = c.add_stream("libx264", rate=rate)
        s.width, s.height, s.pix_fmt = w2, h2, "yuv420p"
        s.options = {"crf": str(int(crf)), "preset": "medium"}
        for _ in range(max(1, int(repeats))):
            for f in fr:
                for pkt in s.encode(av.VideoFrame.from_ndarray(np.ascontiguousarray(f[:h2, :w2]), format="rgb24")):
                    c.mux(pkt)
        for pkt in s.encode():
            c.mux(pkt)
    return path
