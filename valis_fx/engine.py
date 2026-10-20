"""DANSE MACABRE v3: the Valis pass (config-driven, 18 shots on danse_v3_score.json).
Sources per shot come from work3/cfg.json: clip, depth, masks (g: her / c: him / k: clock, faces, candles / x: guests), fx layer.
Original header:
DANSE MACABRE: the Valis pass. Every layer is driven by the score's event map (danse_score.json).

Per shot: source clip (H3), per-frame depth, SAM 3 masks (gown, coat, clock), optional H3 transformation layer.
Layers: transformation reveal (excitable medium, Valis) / grade / mist on the floor, blown back by every hit /
god rays through the windows / shockwave fronts from the clock (strokes) or the couple (kicks, impacts) /
particles (ghost sparks from the gown, embers from the coat, dust on strokes, bone sparks on the xylophone) /
beat rings on the waltz (one layer of many) / candle pulse / spectral clock-face halo at the finale /
bloom, streak, halation / camera punch, shake, refraction with chromatic split / vignette, grain / whiteout.
usage: python3 danse_fx.py s06 [s07 ...]
"""
import json, math, os
import numpy as np
import cv2

from . import forge as F
from .forge import FPS, smooth, sample_tex, T1, T2, T3, Particles, bloom, grade, halo
W = H = w4 = h4 = None
XX = YY = X4 = Y4 = None


def set_resolution(w, h):
    """Bind the frame size for this pass (forge's grids and ours)."""
    global W, H, XX, YY, X4, Y4, w4, h4
    F.set_resolution(w, h)
    W, H, XX, YY, X4, Y4, w4, h4 = F.W, F.H, F.XX, F.YY, F.X4, F.Y4, F.w4, F.h4


def god_rays(img, depth, src, src_depth, strength, tint, samples=28, decay=0.62, dot=.25):
    """forge.god_rays with a softer source dot (a hot dot at the frame edge reads as a blob)."""
    sm = cv2.resize(img, (w4, h4), interpolation=cv2.INTER_AREA)
    dm = cv2.resize(depth, (w4, h4), interpolation=cv2.INTER_AREA)
    lum = sm.max(2)
    em = np.clip((lum - .66) * 3.0, 0, 1) * (dm <= src_depth + .06)
    sx, sy = src[0] / 4, src[1] / 4
    em = (em + dot * np.exp(-((X4 - sx) ** 2 + (Y4 - sy) ** 2) / (2 * 6.0 ** 2))).astype(np.float32)
    acc = np.zeros_like(em)
    for i in range(samples):
        s = 1 - decay * i / samples
        acc += cv2.remap(em, (sx + (X4 - sx) * s).astype(np.float32), (sy + (Y4 - sy) * s).astype(np.float32),
                         cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT)
    acc = cv2.GaussianBlur(acc / samples, (0, 0), 1.2)
    up = cv2.resize(acc, (W, H), interpolation=cv2.INTER_LINEAR)[..., None]
    return img + up * np.array(tint, np.float32) * strength

SC = EV = SEC = None
BAR = BEAT = None


def configure(score, remap=None):
    """Load a Valis score (the json the score engine writes). remap = {engine_event: score_lane}: lets any lane
    drive an effect (e.g. {'musicbox': 'melody'} lights candles on the melody)."""
    global SC, EV, SEC, BAR, BEAT
    SC = score
    BAR, BEAT = SC['bar_seconds'], SC['beat_seconds']
    EV = {k: np.array(v, np.float64) for k, v in SC['events'].items()}
    for k in ['stroke', 'violin', 'violin_answer', 'heartbeat', 'oom', 'pah', 'ghost_pah', 'kick', 'clap', 'stab', 'roll', 'gap',
              'impact', 'call_left', 'response_right', 'final_hit', 'musicbox', 'glint', 'bones', 'melody']:
        EV.setdefault(k, np.zeros(0))
    for k, lane in (remap or {}).items():
        if lane in SC['events']:
            EV[k] = np.array(SC['events'][lane], np.float64)
    SEC = {s_['name']: (s_['start'], s_['end']) for s_ in SC.get('sections', [])}


def env(t, times, tau, attack=.015):
    if len(times) == 0:
        return 0.0
    dt = t - np.asarray(times)
    dt = dt[dt >= 0]
    if len(dt) == 0:
        return 0.0
    return float(((1 - np.exp(-dt / attack)) * np.exp(-dt / tau)).sum())


def read_video(path, gray=False):
    cap = cv2.VideoCapture(path)
    out = []
    while True:
        ok, f = cap.read()
        if not ok:
            break
        out.append(cv2.cvtColor(f, cv2.COLOR_BGR2GRAY) if gray else f[:, :, ::-1])
    return out


def fit(img, gray=False):
    """Bring any frame/mask to W x H."""
    if img.shape[1] != W or img.shape[0] != H:
        img = cv2.resize(img, (W, H), interpolation=cv2.INTER_AREA if not gray else cv2.INTER_LINEAR)
    return img


def first(path_glob):
    import glob
    c = sorted(glob.glob(path_glob))
    return c[-1] if c else None


# ------------------------------------------------------------------ excitable reveal (Valis, from valisfx/post.py)
class Reveal:
    """Barkley medium on a tracked target at 1/4 res, carried by optical flow. stimulate() ignites at a seed."""

    def __init__(self):
        self.gw, self.gh = W // 4, H // 4
        self.u = np.zeros((self.gh, self.gw), np.float32)
        self.v = np.zeros_like(self.u)
        self.rho = np.zeros_like(self.u)
        self.a, self.b, self.eps, self.D, self.dt, self.steps = .75, .02, .02, 4.0, .02, 12
        from .post import Catch
        self.catch = Catch()

    def step(self, flow, w, seeds=(), gain=40.0, hold=1.0):
        from .post import pull, gated_laplacian, blur as pblur
        if flow is not None:
            self.u, self.v, self.rho = pull(self.u, flow), pull(self.v, flow), pull(self.rho, flow)
        cx = np.sqrt(w[:, 1:] * w[:, :-1]); cy = np.sqrt(w[1:, :] * w[:-1, :])
        drive = np.zeros_like(self.u)
        if seeds:
            yy, xx = np.mgrid[:self.gh, :self.gw].astype(np.float32)
            for sx, sy in seeds:
                drive += np.exp(-((xx - sx) ** 2 + (yy - sy) ** 2) / (2 * 3.0 ** 2))
            drive *= w
        live = smooth((w - .05) / .2)
        u, v = self.u, self.v
        for s in range(self.steps):
            th = (v + self.b) / self.a
            react = u * (1 - u) * (u - th) / self.eps
            u = u + self.dt * (react + self.D * gated_laplacian(u, cx, cy) + drive * gain * (s < 3) * (v < .12))
            u = np.clip(u * (live + (1 - live) * (1 - 4 * self.dt)), 0, 1)
            v = v + self.dt * (u - v)
        self.u, self.v = u.astype(np.float32), v.astype(np.float32)
        exc = smooth((u - .25) / .4)
        self.rho = np.maximum(self.rho * hold, exc)
        self.rho = np.maximum(self.rho, pblur(self.rho, 1.5) * .9 * (w > .3))
        self.rho *= smooth((pblur(w, 2.0) + self.rho * .5 - .02) / .18)
        lit = (self.rho > .5).sum() / max((w > .5).sum(), 1)
        self.rho = self.catch(self.rho, w, lit)
        rev = smooth((cv2.resize(self.rho, (W, H), interpolation=cv2.INTER_CUBIC) - .3) / .3)
        front = cv2.resize(exc * (1 - np.clip(v / .6, 0, 1)), (W, H), interpolation=cv2.INTER_CUBIC)
        return rev.astype(np.float32), np.clip(front, 0, 1).astype(np.float32)


def seed_points(w, kind):
    ys, xs = np.nonzero(w > .5)
    if len(ys) == 0:
        return []
    if kind == 'hem':
        i = np.argmax(ys)
    elif kind == 'top':
        i = np.argmin(ys)
    elif kind == 'eyes':          # about where the eyes are on a frontal head / upper body
        y0, y1 = np.percentile(ys, 2), np.percentile(ys, 98)
        ty, tx = y0 + .3 * (y1 - y0), np.median(xs)
        i = np.argmin((ys - ty) ** 2 + (xs - tx) ** 2)
    elif kind == 'left':
        i = np.argmin(xs)
    else:
        i = np.argmax(xs)
    return [(xs[i], ys[i])]


# ------------------------------------------------------------------ the shot
def hold_glitched_tail(E, k=2.5):
    """Video models sometimes break on their last frame or two (the face jumps, the collar smears). Any tail frame
    whose change from the one before is k x the layer's median change is replaced by the last good frame."""
    g = [cv2.resize(cv2.cvtColor(f, cv2.COLOR_RGB2GRAY), (max(1, f.shape[1] // 4), max(1, f.shape[0] // 4))).astype(np.float32) for f in E]
    d = np.array([np.abs(g[j] - g[j - 1]).mean() for j in range(1, len(g))])
    med = float(np.median(d)) + 1e-3
    j = len(E) - 1
    while j > len(E) - 4 and d[j - 1] > k * med and d[j - 1] > 1.5:
        j -= 1
    return E[:j + 1] + [E[j]] * (len(E) - 1 - j)


def run_shot(frames, depth=None, masks=None, fx=None, C=None, t0=0.0, k=0, progress=None):
    """frames: list of RGB uint8 arrays (the plate). depth: T x h x w float (near = 1) or None.
    masks: dict of lists of uint8 gray frames: g (her / subject A), c (him / subject B), k (clock / candles / faces),
    x (occlusion for the crowd), face. fx: list of RGB uint8 frames (the transformation layer or the crowd plate).
    C: the shot's settings (mode, reveal, seeds, mist, rays, halo, wave, candles, glint, ghostface, g_minus_face, v2).
    t0: the shot's start time in the score (seconds). Returns the finished frames (RGB uint8)."""
    C = dict(C or {})
    C.setdefault('mode', 'waltz')
    S = dict(mode=C['mode'], reveal=C.get('reveal'), seeds=C.get('seeds', 'default'), v2=C.get('v2', False))
    mode = S['mode']
    n = len(frames)
    set_resolution(frames[0].shape[1], frames[0].shape[0])
    if depth is None:
        dep = np.full((1, max(1, H // 4), max(1, W // 4)), .5, np.float32)
    else:
        dep = np.asarray(depth, np.float32)
    masks = masks or {}

    def mseq(key):
        seq = masks.get(key)
        return [fit(m, True) for m in seq] if seq is not None else None
    M_g, M_c, M_k, M_x, M_f = mseq('g'), mseq('c'), mseq('k'), mseq('x'), mseq('face')
    E = [fit(f) for f in fx] if fx is not None else None
    if E is not None and len(E) > 8:
        E = hold_glitched_tail(E)
    mist_scale = C.get('mist', 1.0)
    lit = []                 # v3 prologue: candles lit so far (wick positions), each with its ignition time
    zero = np.zeros((H, W), np.float32)

    def soft(seq, i, thr=(.3, .7)):
        if seq is None or i >= len(seq):
            return zero
        return smooth((seq[i].astype(np.float32) / 255 - thr[0]) / (thr[1] - thr[0]))

    P_ghost = Particles(7000, 300 + k)
    P_ember = Particles(5000, 400 + k)
    P_dust = Particles(5000, 500 + k)
    R_g, R_c = Reveal(), Reveal()
    dis = cv2.DISOpticalFlow_create(cv2.DISOPTICAL_FLOW_PRESET_MEDIUM)
    prev_g4 = None
    fb = None
    rr = np.random.default_rng(k)
    result = []
    dt = 1 / FPS
    # moon source: brightest high region of the first frame, in the upper half
    lum0 = cv2.GaussianBlur(frames[0].astype(np.float32).max(2), (0, 0), 25)
    lum0[H // 2:] = 0
    my_, mx_ = np.unravel_index(np.argmax(lum0), lum0.shape)
    stats = []
    for i in range(n):
        t = t0 + (i + .5) / FPS
        tt = i / max(n - 1, 1)
        o = fit(frames[i]).astype(np.float32) / 255
        d = cv2.resize(dep[min(i, len(dep) - 1)], (W, H), interpolation=cv2.INTER_LINEAR)
        mg, mc = soft(M_g, i), soft(M_c, i)
        if C.get('g_minus_face') and M_f is not None:      # her face stays her own: the transformation skips it
            mg = mg * (1 - cv2.GaussianBlur(cv2.dilate(soft(M_f, i), np.ones((7, 7), np.uint8)), (0, 0), 3))
        body = np.maximum(mg, mc)
        ys, xs = np.nonzero(body > .5)
        cxy = (float(xs.mean()), float(ys.mean())) if len(xs) > 50 else (W / 2, H * .55)
        if C.get('center') == 'eyes' and len(xs) > 50:     # talking heads: bursts, halo and waves come from the face
            ex_ = seed_points(body, 'eyes')
            if ex_:
                cxy = (float(ex_[0][0]), float(ex_[0][1]))
        g4 = cv2.resize(cv2.cvtColor(fit(frames[i]), cv2.COLOR_RGB2GRAY), (W // 4, H // 4), interpolation=cv2.INTER_AREA)
        flow = dis.calc(g4, prev_g4, None) if prev_g4 is not None else None
        prev_g4 = g4

        # ---------------------------------------------- transformation (H3 layer revealed by the excitable medium)
        img = o.copy()
        flare = np.zeros((H, W), np.float32)
        alpha = zero
        guest_glow = None
        crowd_on = False
        if E is not None and i < len(E):
            e = E[i].astype(np.float32) / 255
            wg = cv2.resize(mg, (W // 4, H // 4), interpolation=cv2.INTER_AREA)
            wc = cv2.resize(mc, (W // 4, H // 4), interpolation=cv2.INTER_AREA)
            rv = S['reveal']
            if rv == 'crowd':
                # a separately rendered ghost crowd (on black) is keyed by its own light and screened over the waltz,
                # behind the couple; the music lets it through: a flicker on every pah, holding longer as the
                # ghost orchestra joins
                lumc = (e * np.array([.3, .5, .2], np.float32)).sum(2)
                ca_ = smooth((lumc - .05) / .3)
                lv = np.clip(.18 + .3 * tt + 1.3 * env(t, EV['pah'], .13) + .9 * env(t, EV['ghost_pah'], .38), 0, 1)
                occ_src = soft(M_x, i) if M_x is not None else np.maximum(mg, mc)
                occl = 1 - .9 * cv2.GaussianBlur(cv2.dilate(occ_src, np.ones((9, 9), np.uint8)), (0, 0), 4)
                a_ = ca_ * lv * occl
                ghost = np.clip(e * np.array([.8, .95, 1.2], np.float32) * 1.45, 0, 1)
                img = 1 - (1 - o) * (1 - ghost * a_[..., None])
                guest_glow = a_ * (.25 + .8 * env(t, EV['pah'], .12))
                crowd_on = True
                ag = ac = fg = fc = zero
            elif rv == 'guests':
                mx = soft(M_x, i)
                lv = np.clip(.08 + .25 * tt + 1.3 * env(t, EV['pah'], .13) + .9 * env(t, EV['ghost_pah'], .38), 0, 1)
                ga = cv2.GaussianBlur(mx, (0, 0), 3) * lv
                img = e * (1 - ga[..., None]) + o * ga[..., None]
                guest_glow = ga * (.4 + 1.2 * env(t, EV['pah'], .12))
                ag = ac = fg = fc = zero
            elif rv == 'vanish':
                # bar 33: her call is answered by his reflection for the last time - it burns away on the three response notes.
                # bar 35: the response comes again and only the empty mirror flares.
                sc = []
                for kk, tr in enumerate(EV['response_right']):
                    if t - dt <= tr < t and tr < t0 + 2 * BAR:
                        sc = seed_points(wc, ['top', 'hem', 'left', 'right'][kk % 4]) + seed_points(wc, 'top')
                ac, fc = R_c.step(flow, wc, sc, gain=55.0)
                ag = zero
                fg = zero
                late = env(t, [x for x in EV['response_right'] if x >= t0 + 2 * BAR], .35)
                fc = np.clip(fc * 1.6 + mc * min(late, 1.2) * .8, 0, 2)
            elif rv == 'ignite':
                sg = []; sc = []
                if S['seeds'] in ('v2', 'eyes'):
                    for tk in EV['impact']:          # the finale impact: his face goes first (from the eyes), her hem and veil
                        if t - dt <= tk < t:
                            sg = seed_points(wg, 'hem') + seed_points(wg, 'top')
                            sc = seed_points(wc, 'eyes' if S['seeds'] == 'eyes' else 'top')
                for kk, tk in enumerate(EV['kick']):
                    if t - dt <= tk < t:
                        sg = sg + seed_points(wg, 'hem') + seed_points(wg, ['top', 'left', 'right'][kk % 3])
                for kk, ts in enumerate(EV['stab'][::2]):          # beat 2 of each bar: he answers
                    if t - dt <= ts < t:
                        sc = sc + seed_points(wc, ['top', 'hem', 'right', 'left'][kk % 4])
                ag, fg = R_g.step(flow, wg, sg); ac, fc = R_c.step(flow, wc, sc)
            elif rv == 'on':
                ag, ac = mg, mc
                fg = mg * min(env(t, EV['kick'], .18) * 1.2, 1.5); fc = mc * min(env(t, EV['clap'], .18) * 1.2, 1.5)
            else:   # call: her gown flares on the call, his coat on the response, both breathe back toward the plate
                cg = min(1.0, .3 + env(t, EV['call_left'], .45) * .9); ccv = min(1.0, .3 + env(t, EV['response_right'], .45) * .9)
                ag, ac = mg * cg, mc * ccv
                fg = mg * min(env(t, EV['call_left'], .2), 1.2); fc = mc * min(env(t, EV['response_right'], .2), 1.2)
            if rv in ('guests', 'crowd'):
                emit_src = None
            else:
                grow = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (21, 21))
                ag_b = cv2.GaussianBlur(cv2.dilate(ag, grow), (0, 0), 4) * cv2.GaussianBlur(cv2.dilate(mg, grow), (0, 0), 4)
                ac_b = cv2.GaussianBlur(cv2.dilate(ac, grow), (0, 0), 4) * cv2.GaussianBlur(cv2.dilate(mc, grow), (0, 0), 4)
                alpha = np.clip(np.maximum(ag_b, ac_b), 0, 1)
                # grade only the effect: tight masks, or where H3 changed and it isn't plate
                changed = smooth((cv2.GaussianBlur(np.abs(e - o).mean(2), (0, 0), 2) - .04) / .1)
                gwt = np.maximum(cv2.GaussianBlur(body, (0, 0), 3), changed * smooth((e.max(2) - .25) / .3))
                lum = (e * np.array([.2126, .7152, .0722], np.float32)).sum(2, keepdims=True)
                eg = np.clip(((e - lum) * 1.15 + lum - .5) * 1.25 + .5 + .14 * smooth((lum - .5) / .45), 0, 1)
                eg = e * (1 - gwt[..., None]) + eg * gwt[..., None]
                img = o * (1 - alpha[..., None]) + eg * alpha[..., None]
                flare = np.clip(fg * 1.0 + fc * .8, 0, 2) * alpha
                emit_src = eg * (smooth((eg.max(2) - .55) / .4) * alpha * gwt)[..., None]
            if M_f is not None and C.get('ghostface'):
                # her face stays hers; the ghost is a grade that follows the reveal: cold, bloodless, faintly luminous
                prog = float((ag * mg).sum() / max(mg.sum(), 1))
                fa = cv2.GaussianBlur(soft(M_f, i), (0, 0), 4) * min(1.0, prog * 1.4)
                lum_ = (img * np.array([.2126, .7152, .0722], np.float32)).sum(2, keepdims=True)
                ghost = np.clip((img * .25 + lum_ * .75) * np.array([.86, .97, 1.18], np.float32) * 1.12 + .05, 0, 1)
                img = img * (1 - fa[..., None]) + ghost * fa[..., None]
        else:
            emit_src = None

        # ---------------------------------------------- shockwaves
        dxs = np.zeros((H, W), np.float32); dys = np.zeros((H, W), np.float32)
        front = np.zeros((H, W), np.float32); clear = np.zeros((H, W), np.float32)
        impulses = []
        waves = []
        if mode == 'midnight':
            if M_k is not None and i < len(M_k):
                ky, kx = np.nonzero(M_k[i] > 128)
                wsrc = (float(kx.mean()), float(ky.mean())) if len(kx) > 30 else (W * .5, H * .25)
            else:
                wsrc = (W * .5, H * .25)
            waves += [(e_, 1.0 if j < 11 else 1.6, wsrc) for j, e_ in enumerate(EV['stroke']) if 0 <= t - e_ < 2.6]
        if mode in ('call',):
            waves += [(e_, .55, cxy) for e_ in EV['violin'] if 0 <= t - e_ < 2.6]
        if mode in ('drop', 'finale'):
            waves += [(e_, .5, cxy) for e_ in EV['kick'] if 0 <= t - e_ < 1.6]
            waves += [(e_, 2.2 * C.get('wave', 1.0), cxy) for e_ in EV['impact'] if 0 <= t - e_ < 2.6]
        if mode == 'breakdown':
            waves += [(e_, 1.0, cxy) for e_ in EV['impact'] if 0 <= t - e_ < 2.6]
        if mode == 'dawn':
            waves += [(e_, 2.6, cxy) for e_ in EV['final_hit'] if 0 <= t - e_ < 2.6]
        for (te, power, (ox, oy)) in waves:
            age = t - te
            src_dep = float(d[int(np.clip(oy, 0, H - 1)), int(np.clip(ox, 0, W - 1))])
            r = 40 + 1250 * age ** .8 * (1.2 if power > 1 else 1)
            wdt = 26 + 34 * age
            ddx = XX - ox; ddy = YY - oy
            d3 = np.sqrt(ddx * ddx + ddy * ddy + (700 * (d - src_dep)) ** 2) + 1e-3
            u = (d3 - r) / wdt
            gg = np.exp(-u * u)
            fall = math.exp(-age / .85)
            amp = 18 * power * fall
            dxs += ddx / d3 * (u * gg * amp); dys += ddy / d3 * (u * gg * amp)
            front += gg * fall * min(power, 1.6)
            clear += smooth((r - d3) / 260) * math.exp(-age / 2.2) * min(power, 1.4)
            impulses.append((ox, oy, max(r, 1), 1400 * power * fall))

        # ---------------------------------------------- grade
        G = dict(midnight=(.9, .35, .85, .75), call=(.95, .3, .85, .7), waltz=(.7, .55, .75, .9),
                 build=(.75, .6, .8 + .15 * tt, .9 + .2 * tt), drop=(1.0, .75, .9, 1.1), breakdown=(1.0, .25, .9, .6),
                 finale=(1.0, .8, .9, 1.15), dawn=(.15, 1.0, .35, 1.0), prologue=(.85, .45, .85, .7), reveal=(1.0, .2, .95, .5))[mode]
        img = grade(img, teal=G[0], ember=G[1], crush=G[2], sat=G[3])
        if mode == 'dawn':
            warm = smooth((t - EV['final_hit'][0]) / 2.5) if len(EV['final_hit']) else 1
            img = img * (1 + warm * np.array([.18, .06, -.10], np.float32)) + warm * .04
        if mode == 'call':
            img *= 1 - .22 * (1 - min(env(t, EV['heartbeat'], .35) * 1.5, 1)) * smooth((t - EV['heartbeat'][0]) / .5)
        if mode == 'reveal':          # the room holds its breath: the frame closes in on every heartbeat
            img *= 1 - .3 * (1 - min(env(t, EV['heartbeat'], .4) * 1.4, 1))
        if mode in ('build', 'reveal'):
            for gp in EV['gap']:
                if gp <= t < gp + .25 * BEAT + .02:
                    img *= 1 - .88 * smooth((t - gp) / .04)

        # ---------------------------------------------- mist on the floor, blown back by every hit
        hx, hy = XX[::2, ::2], YY[::2, ::2]
        m = .6 * sample_tex(T1, hx * .45 + t * 22, hy * .45 - t * 5) + .4 * sample_tex(T2, hx * .9 - t * 35, hy * .9 + t * 8)
        m = cv2.resize(m, (W, H))
        band = smooth((YY / H - .35) / .45) * (1 - .7 * body)
        mist_amt = dict(midnight=.85, call=.7, waltz=.55, build=.5, drop=.55, breakdown=.75, finale=.6, dawn=.6, prologue=.5, reveal=.7)[mode] * mist_scale
        if mode == 'dawn':
            mist_amt *= 1 - .7 * tt
        a = np.clip((m - .42) * 2.4, 0, 1) * band * mist_amt * .75 * (1 - .95 * np.clip(clear, 0, 1))
        mc_ = np.array([.09, .12, .17], np.float32) + front[..., None] * np.array([.6, .75, 1.0], np.float32) * .7
        if mode == 'dawn':
            mc_ = np.array([.32, .27, .2], np.float32) + 0 * mc_
        img = img * (1 - a[..., None]) + mc_ * a[..., None]

        # ---------------------------------------------- emissive
        em = np.zeros((H, W, 3), np.float32)
        ray_s = dict(midnight=.6, call=.5, waltz=.45, build=.5 + 1.2 * tt, drop=.7, breakdown=.4, finale=1.0, dawn=1.2, prologue=.45, reveal=.3)[mode] * C.get('rays', 1.0)
        ray_s += (1.2 * env(t, EV['stroke'], .5) + 2.5 * env(t, EV['impact'], 1.0) + .6 * env(t, EV['kick'], .25)) * C.get('rays', 1.0)
        tint = (1.0, .85, .6) if mode == 'dawn' else (.55, .72, 1.0)
        em += god_rays(img, d, (mx_, my_), float(d[my_, mx_]), ray_s, tint) - img
        # the call: a tritone arc leaps between them on every violin call, their outlines burn on the heartbeat
        if mode == 'call' and body.any():
            def anchor(mm):
                yy_, xx_ = np.nonzero(mm > .5)
                if len(xx_) < 50:
                    return None
                top = yy_ < np.percentile(yy_, 35)
                return float(xx_[top].mean()), float(yy_[top].mean())
            pa, pb = anchor(mg), anchor(mc)
            strikes = []
            if pa and pb:
                for e_ in np.concatenate([EV['violin'], EV['violin_answer']]):
                    strikes.append((e_, pa, [pb]))
                    strikes.append((e_ + .06, pb, [pa]))
            L = F.draw_lightning(t, strikes, rr) if strikes else None
            if L is not None:
                em += L * .8
            rim = np.clip(body - cv2.erode(body, np.ones((7, 7), np.uint8)), 0, 1)
            rim = cv2.GaussianBlur(rim, (0, 0), 3)
            rk = .1 + 1.6 * env(t, EV['heartbeat'], .25) + 2.2 * env(t, np.concatenate([EV['violin'], EV['violin_answer']]), .5)
            em += rim[..., None] * np.array([.45, .75, 1.0], np.float32) * rk
        # light fronts
        em += front[..., None] * np.array([.75, .88, 1.0], np.float32) * .5
        # transformation light: the ghost-fire and the embers emit; wave fronts flare
        if emit_src is not None:
            em += emit_src * (.6 + .9 * env(t, EV['kick'], .3))
            # flares light only what already glows: the gown's bright flames, the coat's red seams
            glow_g = smooth((eg.max(2) - .45) / .35) * mg
            glow_c = smooth(((eg[..., 0] - eg[..., 2]) - .08) / .2) * smooth((eg[..., 0] - .25) / .3) * mc
            if S.get('v2'):
                ys_, xs_ = np.nonzero(mc > .5)
                if len(ys_):
                    y0, y1 = np.percentile(ys_, 1), np.percentile(ys_, 99)
                    glow_c = glow_c * smooth((YY - (y0 + .2 * (y1 - y0))) / 30)
            em += (flare * glow_g)[..., None] * np.array([.55, .8, 1.0], np.float32) * 1.1
            em += (flare * glow_c)[..., None] * np.array([1.0, .45, .15], np.float32) * 1.4
        # candles: warm small highlights pulse on the oom / kick
        cand = (o[..., 0] > .82) & (o[..., 1] > .6) & (o[..., 2] < .62)
        if cand.any() and not C.get('candles'):
            cg = cv2.GaussianBlur(cand.astype(np.float32), (0, 0), 6)
            pulse = .25 + .9 * env(t, np.concatenate([EV['oom'], EV['kick'], EV['stroke'], EV['roll']]), .22)
            em += cg[..., None] * np.array([1.0, .62, .25], np.float32) * pulse
        # v3: the ghost guests glow when the music lets them through
        if guest_glow is not None:
            gk = guest_glow if crowd_on else guest_glow * smooth((o.max(2) - .35) / .3)
            em += gk[..., None] * np.array([.45, .7, 1.0], np.float32) * .9
        # v3 prologue: the candles in the plate are snuffed until the music box reaches them; each note lights the
        # next group (left to right) with an ignition flare, then the real flame from the plate flickers on.
        if C.get('candles'):
            notes = [x for x in EV['musicbox'] if t0 <= x < t0 + 4 * BAR]
            fm = ((o[..., 0] > .8) & (o[..., 1] > .55) & (o[..., 0] - o[..., 2] > .25)).astype(np.uint8)
            cnt, lab, st, cen = cv2.connectedComponentsWithStats(fm)
            comps = sorted([j for j in range(1, cnt) if 2 <= st[j, cv2.CC_STAT_AREA] < 900 and st[j, cv2.CC_STAT_HEIGHT] >= .6 * st[j, cv2.CC_STAT_WIDTH]], key=lambda j: cen[j][0])
            if comps and notes:
                groups = np.array_split(np.array(comps), min(len(notes), len(comps)))
                dark = np.zeros((H, W), np.float32)
                for q_, grp in enumerate(groups):
                    gm = np.isin(lab, grp).astype(np.float32)
                    if q_ < len(notes) and t >= notes[q_]:
                        age = t - notes[q_]
                        ign = 2.4 * math.exp(-age / .16)
                        for j in grp:
                            if st[j, cv2.CC_STAT_AREA] > 150 or st[j, cv2.CC_STAT_TOP] < 0:
                                continue
                            wx, wy = cen[j]
                            core = np.exp(-(((XX - wx) / 4.0) ** 2 + ((YY - wy) / 10.0) ** 2))
                            glow = np.exp(-(((XX - wx) ** 2 + (YY - wy) ** 2) / (2 * 34.0 ** 2)))
                            em += (core * 1.2 + glow * .35)[..., None] * np.array([1.0, .7, .35], np.float32) * ign
                    else:
                        dark = np.maximum(dark, gm)
                if dark.any():
                    halo_ = cv2.GaussianBlur(cv2.dilate(dark, np.ones((9, 9), np.uint8)), (0, 0), 9)
                    halo_ = np.clip(halo_ * 3, 0, 1)
                    lumo = (img * np.array([.3, .5, .2], np.float32)).sum(2, keepdims=True)
                    snuffed = np.minimum(img, lumo * np.array([.55, .6, .72], np.float32) * .55)
                    img = img * (1 - halo_[..., None]) + snuffed * halo_[..., None]
        # v3 portraits: the painted eyes glint
        if C.get('glint') and M_f is not None and i < len(M_f):
            gl = env(t, EV['glint'], .45) + .5 * env(t, [x for x in EV['musicbox'] if t0 <= x < t0 + 4 * BAR][-2:], .3)
            if gl > .02:
                cnt, lab, st, cen = cv2.connectedComponentsWithStats((M_f[i] > 128).astype(np.uint8))
                for j in range(1, cnt):
                    if st[j, cv2.CC_STAT_AREA] < 40:
                        continue
                    gx_ = st[j, cv2.CC_STAT_LEFT] + st[j, cv2.CC_STAT_WIDTH] * .5
                    gy_ = st[j, cv2.CC_STAT_TOP] + st[j, cv2.CC_STAT_HEIGHT] * .42
                    star = (np.exp(-((XX - gx_) / 1.6) ** 2 - ((YY - gy_) / 26) ** 2) + np.exp(-((XX - gx_) / 26) ** 2 - ((YY - gy_) / 1.6) ** 2)
                            + 2 * np.exp(-(((XX - gx_) ** 2 + (YY - gy_) ** 2) / (2 * 3.0 ** 2))))
                    em += star[..., None] * np.array([1.0, .9, .75], np.float32) * gl * 1.4
        # beat rings on the pah-pah (thin, one layer among many)
        if mode in ('waltz', 'build') and len(xs) > 50:
            # light ripples across the marble from their feet on every pah: ellipses on the floor plane,
            # hidden behind the dancers
            pal = np.array([[.55, .75, 1.0], [1.0, .85, .6], [.75, .55, 1.0]], np.float32)
            fx0, fy0 = float(xs.mean()), float(np.percentile(ys, 97))
            dd = np.sqrt((XX - fx0) ** 2 + ((YY - fy0) / .3) ** 2)
            behind = (1 - cv2.GaussianBlur(body, (0, 0), 2))
            for kk, e_ in enumerate(np.concatenate([EV['pah'], EV['roll']])):
                age = t - e_
                if 0 <= age < 1.2:
                    rad = 40 + 700 * age
                    ring = np.exp(-((dd - rad) / (3.0 + 6 * age)) ** 2) * (1 - age / 1.2) ** 1.5
                    em += (ring * behind)[..., None] * pal[kk % 3] * .45
        # halo: a spectral clock face opens around the couple at the finale impact
        if mode == 'finale':
            for e_ in EV['impact']:
                if 0 <= t - e_ < 4.5:
                    hl = halo(t, e_, cxy, 1.1)
                    if hl is not None:
                        em += hl * np.array([.7, .85, 1.0], np.float32) * .8 * C.get('halo', 1.0)
        # particles
        if mode in ('drop', 'finale', 'breakdown') and body.any():
            gy, gx = np.nonzero(cv2.morphologyEx((mg > .5).astype(np.uint8), cv2.MORPH_GRADIENT, np.ones((5, 5), np.uint8)) > 0)
            if len(gx):
                kg = int((6 if mode == 'breakdown' else 25) + 120 * env(t, np.concatenate([EV['kick'], EV['call_left']]), .25))
                P_ghost.spawn(kg, gx.astype(np.float32), gy.astype(np.float32), vy=-120, spread=70, heat=.6, life=(.6, 1.8))
            cy_, cx_ = np.nonzero(cv2.morphologyEx((mc > .5).astype(np.uint8), cv2.MORPH_GRADIENT, np.ones((5, 5), np.uint8)) > 0)
            if len(cx_):
                kc = int((5 if mode == 'breakdown' else 18) + 110 * env(t, np.concatenate([EV['clap'], EV['response_right']]), .25))
                if S.get('v2'):
                    kc = kc // 4
                if S.get('reveal') == 'vanish':     # the reflection only sheds embers when the harpsichord answers
                    kc = int(70 * env(t, EV['response_right'], .22))
                P_ember.spawn(kc, cx_.astype(np.float32), cy_.astype(np.float32), vy=-180, spread=90, heat=1.0, life=(.5, 1.5))
        if mode in ('waltz', 'build'):
            for e_ in EV['bones']:
                if t - dt <= e_ < t:
                    hy_, hx_ = np.nonzero(mg > .5)
                    if len(hx_):
                        sel = hy_ > np.percentile(hy_, 85)
                        P_dust.spawn(60, hx_[sel].astype(np.float32), hy_[sel].astype(np.float32), vy=-90, spread=140, heat=.2, life=(.4, 1.0))
        if mode == 'build':          # the room charges: dust and sparks rise off the floor faster and faster
            fy, fx_ = np.nonzero(YY > H * .7)
            P_dust.spawn(int(10 + 160 * tt ** 2), fx_[::53].astype(np.float32), fy[::53].astype(np.float32), vy=-200 - 500 * tt, spread=80, heat=.2 + .8 * tt, life=(.5, 1.4))
        for e_ in np.concatenate([EV['stroke'], EV['impact'], EV['final_hit']]):
            if t - dt <= e_ < t:
                fy, fx_ = np.nonzero(YY > H * .75)
                P_dust.spawn(900, fx_[::37].astype(np.float32), fy[::37].astype(np.float32), vy=-300, spread=200, heat=.3, life=(.8, 2.2))
                if e_ in EV['impact'] or e_ in EV['final_hit']:
                    P_ghost.spawn(2200, np.array([cxy[0]], np.float32), np.array([cxy[1]], np.float32), spread=1200, heat=1.3, life=(1.0, 3.0))
        for P in (P_ghost, P_ember, P_dust):
            P.step(dt, t, flow=80, buoy=-40, impulses=impulses)
        em += P_ghost.render(((.35, .6, 1.0), (1.2, 1.4, 1.7)), gain=.9)
        em += P_ember.render(((1.0, .35, .08), (1.6, 1.1, .6)), gain=.9)
        em += P_dust.render(((.55, .55, .6), (1.1, 1.05, 1.0)), gain=.5)
        # feedback trails on the emissive layer, rushing outward on the drops
        fbd = dict(drop=.72, finale=.78, breakdown=.45).get(mode, .5)
        if fb is not None:
            Mt = cv2.getRotationMatrix2D(cxy, .25, 1.012)
            em = np.maximum(em, cv2.warpAffine(fb, Mt, (W, H), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT) * fbd)
        fb = em
        img = img + em

        # ---------------------------------------------- camera: punch, shake, refraction with chromatic split
        punch = .02 * env(t, EV['stroke'], .12) + .045 * env(t, EV['kick'], .10) + .09 * env(t, EV['impact'], .16) \
            + .012 * env(t, EV['heartbeat'], .12) + .12 * env(t, EV['final_hit'], .2)
        shake = 7 * env(t, EV['stroke'], .14) + 9 * env(t, EV['kick'], .12) + 24 * env(t, EV['impact'], .4) + 30 * env(t, EV['final_hit'], .45)
        z = 1.0 + punch + .012       # tiny overscan so the shake never shows an edge
        shx = shake * math.sin(t * 61.0); shy = shake * math.cos(t * 47.0)
        bx = W / 2 + (XX - W / 2) / z + shx + dxs
        by = H / 2 + (YY - H / 2) / z + shy + dys
        ca = .004 + .012 * env(t, EV['kick'], .15) + .035 * env(t, EV['impact'], .5) + .01 * env(t, EV['stroke'], .2)
        chans = []
        for c, kf in enumerate((1 + ca, 1.0, 1 - ca)):
            mx = (bx + (XX - W / 2) * (kf - 1)).astype(np.float32)
            my = (by + (YY - H / 2) * (kf - 1)).astype(np.float32)
            chans.append(cv2.remap(img[..., c], mx, my, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE))
        img = np.dstack(chans)

        # ---------------------------------------------- finish
        img = bloom(img, thr=.72, strength=.5 + .5 * env(t, np.concatenate([EV['kick'], EV['stroke']]), .3))
        vig = 1 - .6 * (((XX - W / 2) / (W * .62)) ** 2 + ((YY - H / 2) / (H * .62)) ** 2)
        img *= np.clip(vig, 0, 1)[..., None]
        wo = env(t, EV['final_hit'], .45, attack=.03) + .35 * env(t, EV['impact'][:1], .2, attack=.02)
        if wo > 0:
            img = img + (1.25 - img) * min(wo, 1) * .9
        img = np.where(img < .78, img, .78 + .22 * (1 - np.exp(-(img - .78) / .22)))
        gr = (sample_tex(T3, XX + rr.integers(0, 512), YY + rr.integers(0, 512)) - .5) * .06
        img = np.clip(img + gr[..., None], 0, 1)
        u8 = (img * 255 + .5).astype(np.uint8)
        result.append(u8)
        if progress:
            progress(i + 1, n)
    return result
