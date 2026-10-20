"""Valis FX post: blend an H3 masked re-render back onto the source and reveal it on the beat.

The generative pass (H3 inside the SAM 3 mask) is rendered once. This module decides where and
when it shows:
  * grade: contrast / saturation / highlight lift on the effect layer, inside its region only;
  * glow: bloom from the effect's bright parts, spilled onto the surroundings;
  * reveal: a Barkley excitable medium living on the tracked target (Valis `excitable.py`
    mechanics: surface-gated diffusion, carried by optical flow). Beats inject stimuli at seed
    points; each wave front ignites the effect as it passes and flares while it is excited.
    Revealed state is carried on the moving surface, so the effect stays attached to the body.

Source RGB is never warped. Outside the reveal the output is the exact source pixel.
"""
from dataclasses import dataclass
import json
import subprocess
import numpy as np
import cv2

cv2.setNumThreads(4)


def smooth(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return (t * t * (3 - 2 * t)).astype(np.float32)


def blur(x, s):
    return cv2.GaussianBlur(x, (0, 0), s, borderType=cv2.BORDER_REFLECT_101)


_K3 = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))


class Catch:
    """The last of the target catches without a pop. Past 75% lit the front keeps creeping through the target
    (the parts the flow never carried it into) a couple of grid cells a frame, about the pace it was already
    moving; whatever it can't reach (an island cut off from the rest) fades in over ~half a second once 90% is lit.
    (It used to fill everything left the moment 80% was lit, which read as a jump from 80% to 100% in one frame.)"""

    def __init__(self, creep=2, fade=14):
        self.creep, self.fade, self.late = creep, fade, 0.0

    def __call__(self, rho, w, lit):
        if lit > .75:
            tgt = (w > .3).astype(np.float32)
            for _ in range(self.creep):
                rho = np.maximum(rho, cv2.dilate(rho, _K3) * tgt)
        if lit > .9 or self.late > 0:
            self.late = min(1.0, self.late + 1.0 / self.fade)
            k = self.late * self.late * (3 - 2 * self.late)
            rho = np.maximum(rho, w * k)
        return rho.astype(np.float32)


def pull(field, flow):
    h, w = flow.shape[:2]
    yy, xx = np.mgrid[:h, :w].astype(np.float32)
    return cv2.remap(field, xx + flow[..., 0], yy + flow[..., 1], cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)


def gated_laplacian(u, cx, cy):
    out = np.zeros_like(u)
    dx = (u[:, 1:] - u[:, :-1]) * cx
    dy = (u[1:, :] - u[:-1, :]) * cy
    out[:, :-1] += dx
    out[:, 1:] -= dx
    out[:-1, :] += dy
    out[1:, :] -= dy
    return out


def read_video(path, gray=False):
    cap = cv2.VideoCapture(str(path))
    frames = []
    while True:
        ok, bgr = cap.read()
        if not ok:
            break
        frames.append(cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY) if gray else cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB))
    cap.release()
    assert frames, path
    return frames


@dataclass
class Beat:
    bpm: float = 107.66
    fps: float = 24.0
    offset: float = 0.0          # frames

    def beat_frames(self, n_frames):
        step = 60.0 / self.bpm * self.fps
        k = np.arange(0, n_frames / step + 1)
        return [int(round(self.offset + i * step)) for i in k if self.offset + i * step < n_frames]


@dataclass
class Reveal:
    grid_div: int = 4            # field lives at 1/4 resolution
    a: float = .75
    b: float = .02
    eps: float = .02
    diffusion: float = 4.0
    model_time_per_frame: float = .25
    dt: float = .02
    ignite_beat: int = 2         # first beat that ignites
    stim_radius: float = 3.0     # grid cells
    stim_gain: float = 40.0
    hold: float = 1.0            # 1 = once ignited it stays (partial alpha over a changed silhouette ghosts)
    fill: float = .9             # reveal creeps into neighbouring surface (fills newly exposed cloth)


@dataclass
class Look:
    region_grow: int = 28        # px around the SAM 3 mask the effect may occupy (flames, rim light)
    contrast: float = 1.25
    saturation: float = 1.3
    lift: float = .12            # highlight lift
    glow: float = .9
    glow_threshold: float = .55
    front_flare: float = .8      # extra light on the excited wave front
    beat_pulse: float = .45      # glow kick on every beat, decays over a beat


LOOKS = {
    # fire throws light: strong bloom, flaring fronts
    'fire': Look(region_grow=28, contrast=1.2, saturation=1.25, lift=.12, glow=.9, glow_threshold=.55, front_flare=.9, beat_pulse=.5),
    # metal: little bloom, hard speculars, no colour push (it would turn gold back to orange)
    'metal': Look(region_grow=14, contrast=1.35, saturation=1.0, lift=.18, glow=.35, glow_threshold=.8, front_flare=.6, beat_pulse=.35),
    # emissive cosmic cloth: medium cool glow
    'cosmic': Look(region_grow=20, contrast=1.15, saturation=1.2, lift=.08, glow=.7, glow_threshold=.45, front_flare=.8, beat_pulse=.45),
}


def seeds_for_beat(mask_grid, k, rng):
    """Seed points for beat k: hem first, then alternate extremes of the target."""
    ys, xs = np.nonzero(mask_grid > .5)
    if len(ys) == 0:
        return []
    pick = k % 4
    if pick == 0:   # lowest point (hem)
        i = np.argmax(ys)
    elif pick == 1:  # highest (shoulder / raised arm)
        i = np.argmin(ys)
    elif pick == 2:  # leftmost
        i = np.argmin(xs)
    else:            # rightmost
        i = np.argmax(xs)
    return [(xs[i], ys[i])]


def run(src_path, fx_path, mask_path, out_path, beat=Beat(), rv=Reveal(), look=Look(), audio_path=None, report=None):
    O = read_video(src_path)
    E = read_video(fx_path)
    M = read_video(mask_path, gray=True)
    n = min(len(O), len(E), len(M))
    H, W = O[0].shape[:2]
    gw, gh = W // rv.grid_div, H // rv.grid_div
    beats = set(beat.beat_frames(n))
    beat_list = sorted(beats)
    dis = cv2.DISOpticalFlow_create(cv2.DISOPTICAL_FLOW_PRESET_MEDIUM)
    u = np.zeros((gh, gw), np.float32)
    v = np.zeros_like(u)
    rho = np.zeros_like(u)
    catch = Catch()
    prev_gray = None
    rng = np.random.default_rng(3)
    kgrow = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * look.region_grow + 1,) * 2)
    steps = int(round(rv.model_time_per_frame / rv.dt))
    proc = subprocess.Popen(['ffmpeg', '-y', '-hide_banner', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgb24',
                             '-s', f'{W}x{H}', '-r', str(beat.fps), '-i', 'pipe:0'] +
                            (['-i', str(audio_path), '-map', '0:v', '-map', '1:a', '-c:a', 'aac', '-b:a', '192k', '-shortest'] if audio_path else []) +
                            ['-c:v', 'libx264', '-crf', '15', '-preset', 'medium', '-pix_fmt', 'yuv420p', str(out_path)], stdin=subprocess.PIPE)
    stats = []
    last_beat = -999
    for t in range(n):
        o = O[t].astype(np.float32) / 255
        e = E[t].astype(np.float32) / 255
        m = (M[t].astype(np.float32) / 255)
        m = smooth(.3, .7, m)
        # --- field on the grid
        g = cv2.resize(cv2.cvtColor(O[t], cv2.COLOR_RGB2GRAY), (gw, gh), interpolation=cv2.INTER_AREA)
        w_grid = cv2.resize(m, (gw, gh), interpolation=cv2.INTER_AREA)
        w_grid = smooth(.2, .6, w_grid)
        if prev_gray is not None:
            flow = dis.calc(g, prev_gray, None)   # current -> previous: backward flow for pull()
            u, v, rho = pull(u, flow), pull(v, flow), pull(rho, flow)
        prev_gray = g
        cx = np.sqrt(w_grid[:, 1:] * w_grid[:, :-1])
        cy = np.sqrt(w_grid[1:, :] * w_grid[:-1, :])
        drive = np.zeros_like(u)
        if t in beats:
            last_beat = t
            k = beat_list.index(t)
            if k >= rv.ignite_beat:
                yy, xx = np.mgrid[:gh, :gw].astype(np.float32)
                for (sx, sy) in seeds_for_beat(w_grid, k - rv.ignite_beat, rng):
                    drive += np.exp(-((xx - sx) ** 2 + (yy - sy) ** 2) / (2 * rv.stim_radius ** 2))
                drive *= w_grid
        live = smooth(.05, .25, w_grid)
        for s in range(steps):
            th = (v + rv.b) / rv.a
            react = u * (1 - u) * (u - th) / rv.eps
            lap = gated_laplacian(u, cx, cy)
            stim = drive * rv.stim_gain * (s < 3) * (v < .12)
            u = u + rv.dt * (react + rv.diffusion * lap + stim)
            u = np.clip(u * (live + (1 - live) * (1 - 4 * rv.dt)), 0, 1)
            v = v + rv.dt * (u - v)
        excited = smooth(.25, .65, u)
        # revealed = has been ignited; carried on the surface, creeps into newly exposed cloth
        rho = np.maximum(rho * rv.hold, excited)
        rho = np.maximum(rho, blur(rho, 1.5) * rv.fill * (w_grid > .3))
        rho *= smooth(.02, .2, blur(w_grid, 2.0) + rho * .5)   # off the target it fades
        # once most of the target is lit, the rest catches (swinging hems the flow never carried into)
        lit = (rho > .5).sum() / max((w_grid > .5).sum(), 1)
        rho = catch(rho, w_grid, lit)
        # --- full-res masks
        rev = cv2.resize(rho, (W, H), interpolation=cv2.INTER_CUBIC)
        front = cv2.resize(excited * (1 - np.clip(v / .6, 0, 1)), (W, H), interpolation=cv2.INTER_CUBIC)
        region = blur(cv2.dilate(m, kgrow), look.region_grow / 3)
        rev = smooth(.3, .6, rev)        # crisp: a half-revealed cloth shows both silhouettes
        rev_big = blur(cv2.dilate(np.clip(rev, 0, 1), kgrow), look.region_grow / 4)
        alpha = np.clip(rev_big * region, 0, 1)
        # --- grade the effect layer
        lum = e @ np.array([.2126, .7152, .0722], np.float32)
        gl = lum[..., None]
        eg = (e - gl) * look.saturation + gl
        eg = (eg - .5) * look.contrast + .5
        eg = eg + look.lift * smooth(.5, .95, lum)[..., None]
        eg = np.clip(eg, 0, 1)
        # grade only where the effect actually is (tight mask, or where H3 changed the pixels):
        # grading the untouched wall in the grown band would draw a pale halo around the body
        changed = smooth(.04, .14, blur(np.abs(e - o).mean(-1), 2.0))
        # ...and where H3 drew a narrower silhouette it painted plate (wall/floor) over the old cloth:
        # that is not effect, so neutral, unsaturated pixels are left ungraded and throw no light
        sat = e.max(-1) - e.min(-1)
        gw_ = (np.maximum(blur(m, 3.0), changed) * smooth(.06, .2, blur(sat, 1.5)))[..., None]
        eg = e * (1 - gw_) + eg * gw_
        # --- glow from the effect's bright parts, plus the wave front and beat kick
        since = t - last_beat
        kick = look.beat_pulse * np.exp(-since / 6.0) if t >= beat_list[min(rv.ignite_beat, len(beat_list) - 1)] else 0.0
        bright = smooth(look.glow_threshold, 1.0, cv2.cvtColor(eg, cv2.COLOR_RGB2GRAY))
        # light only comes from the effect itself, never from bright background inside the grown band
        src_light = eg * (bright * alpha * gw_[..., 0])[..., None] + eg * (front * m * alpha * look.front_flare)[..., None]
        bloom = sum(blur(src_light, s) * wgt for s, wgt in ((4, .5), (14, .35), (40, .25)))
        out = o * (1 - alpha[..., None]) + eg * alpha[..., None]
        out = 1 - (1 - out) * (1 - np.clip(bloom * (look.glow + kick), 0, 1))       # screen
        out = np.clip(out, 0, 1)
        exact = alpha + bloom.max(-1) < 1e-3
        frame = (out * 255 + .5).astype(np.uint8)
        frame[exact] = O[t][exact]
        proc.stdin.write(frame.tobytes())
        stats.append(dict(t=t, beat=t in beats, revealed=float((rho > .5).sum() / max((w_grid > .5).sum(), 1)),
                          excited=float((u > .5).sum() / max((w_grid > .5).sum(), 1))))
    proc.stdin.close()
    assert proc.wait() == 0
    if report:
        json.dump(dict(beats=beat_list, frames=stats), open(report, 'w'), indent=1)
    return stats


def click_track(path, n_frames, beat=Beat(), sr=48000):
    """A plain kick + hat on the beat so the sync is audible in the test."""
    dur = n_frames / beat.fps
    t = np.arange(int(dur * sr)) / sr
    y = np.zeros_like(t)
    for f in beat.beat_frames(n_frames):
        t0 = f / beat.fps
        i0 = int(t0 * sr)
        tt = t[i0:i0 + int(.35 * sr)] - t0
        freq = 48 + 90 * np.exp(-tt * 28)
        y[i0:i0 + len(tt)] += .9 * np.sin(2 * np.pi * np.cumsum(freq) / sr) * np.exp(-tt * 9)
        h0 = int((t0 + 60 / beat.bpm / 2) * sr)
        if h0 < len(y):
            nh = min(int(.05 * sr), len(y) - h0)
            y[h0:h0 + nh] += .15 * np.random.default_rng(f).standard_normal(nh) * np.exp(-np.arange(nh) / sr * 90)
    y = np.tanh(y * 1.2) * .8
    pcm = (np.stack([y, y], 1) * 32767).astype(np.int16)
    import wave
    with wave.open(str(path), 'wb') as wv:
        wv.setnchannels(2); wv.setsampwidth(2); wv.setframerate(sr); wv.writeframes(pcm.tobytes())


def layer_onto(base_path, fx_path, mask_path, out_path, grow=14, fps=24, exclude_path=None):
    """Second target on top of a finished pass: the new effect inside its (grown, soft) mask,
    the base pass everywhere else. Feed the result to run() with base_path as the source."""
    B = read_video(base_path)
    E = read_video(fx_path)
    M = read_video(mask_path, gray=True)
    X = read_video(exclude_path, gray=True) if exclude_path else None   # the first target keeps its pass
    n = min(len(B), len(E), len(M))
    H, W = B[0].shape[:2]
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * grow + 1,) * 2)
    p = subprocess.Popen(['ffmpeg', '-y', '-hide_banner', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgb24',
                          '-s', f'{W}x{H}', '-r', str(fps), '-i', 'pipe:0', '-c:v', 'libx264', '-crf', '12',
                          '-pix_fmt', 'yuv420p', str(out_path)], stdin=subprocess.PIPE)
    for t in range(n):
        m = smooth(.3, .7, M[t].astype(np.float32) / 255)
        a = blur(cv2.dilate(m, k), grow / 3)
        if X is not None:
            a = a * (1 - blur(cv2.dilate(smooth(.3, .7, X[t].astype(np.float32) / 255), np.ones((5, 5), np.uint8)), 2.0)) + m * 0
            a = np.maximum(a, m)
        a = a[..., None]
        f = B[t].astype(np.float32) * (1 - a) + E[t].astype(np.float32) * a
        p.stdin.write((f + .5).astype(np.uint8).tobytes())
    p.stdin.close()
    assert p.wait() == 0
