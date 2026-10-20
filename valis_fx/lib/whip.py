"""Whip pan from a real pan. The video model is good at a steady pan and bad at a whip (it dissolves between the two
views instead of swinging). So the camera move is generated slowly, with true parallax, and the whip is made in time:
the clip is speed-ramped (it lingers, accelerates to many times real speed, then lands) and every output frame is
exposed over the stretch of the move it covers, the way a real shutter would smear a fast pan. Only the clip's own
pixels are used.

    T = track_motion(frames)                      # per-pair 2x3 similarity, frame t -> frame t+1 (full-res pixels)
    out, info = whip(frames, T, fps=24, mode="reveal")

mode "reveal": linger on the start, whip, land on where the pan ends (a cut-free reveal).
mode "return": linger, whip out to the end of the pan, whip straight back, land on the start (the subject).
The pan's travel sets how far the whip can go: a 4-5 s pan at a steady speed gives a whip of about a frame width.
"""
import math

import cv2
import numpy as np


def _u8(f):
    return f if f.dtype == np.uint8 else (np.clip(f, 0, 1) * 255 + .5).astype(np.uint8)


def track_motion(frames, width=384):
    """The camera's frame-to-frame motion as a 2x3 similarity per pair, from LK corners over the whole frame
    (forward-backward checked, RANSAC), so people moving in the shot don't count as camera motion."""
    n, H, W = frames.shape[:3]
    sc = width / W
    w, h = width, max(2, int(round(H * sc)))
    g = [cv2.cvtColor(cv2.resize(_u8(f), (w, h), interpolation=cv2.INTER_AREA), cv2.COLOR_RGB2GRAY) for f in frames]
    S, Si = np.diag([sc, sc, 1.0]), np.diag([1 / sc, 1 / sc, 1.0])
    lk = dict(winSize=(21, 21), maxLevel=4, criteria=(cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 30, .01))
    T = []
    for t in range(n - 1):
        M = None
        p0 = cv2.goodFeaturesToTrack(g[t], 600, .003, 6)
        if p0 is not None and len(p0) >= 12:
            p1, s1, _ = cv2.calcOpticalFlowPyrLK(g[t], g[t + 1], p0, None, **lk)
            pb, s2, _ = cv2.calcOpticalFlowPyrLK(g[t + 1], g[t], p1, None, **lk)
            ok = (s1[:, 0] == 1) & (s2[:, 0] == 1) & (np.linalg.norm((pb - p0)[:, 0], axis=1) < 1.0)
            if ok.sum() >= 10:
                A, inl = cv2.estimateAffinePartial2D(p0[ok], p1[ok], method=cv2.RANSAC, ransacReprojThreshold=1.5, maxIters=3000, confidence=.995)
                if A is not None:
                    M = (Si @ np.vstack([A, [0, 0, 1]]) @ S)[:2]
        T.append(M if M is not None else (T[-1] if T else np.float64([[1, 0, 0], [0, 1, 0]])))
    return np.array(T)


def _ease(x):                                   # 0..1 -> 0..1, zero slope at both ends
    return .5 - .5 * np.cos(np.pi * np.clip(x, 0, 1))


def _travel(T):
    """Cumulative camera travel in pixels along the pan's main direction, per source frame (monotonic)."""
    d = np.array([t[:, 2] for t in T])                           # per-pair translation
    main = d.sum(0)
    main = main / (np.linalg.norm(main) + 1e-9)
    step = np.maximum(d @ main, 0.0)                             # progress along the pan; backward jitter ignored
    P = np.concatenate([[0.0], np.cumsum(step)])
    return P + np.arange(len(P)) * 1e-4                          # strictly increasing, so it can be inverted


def _bump(n, v0, v1, peak, total):
    """n per-frame velocities that start near v0, peak, end near v1, and add up to exactly `total`."""
    x = (np.arange(1, n + 1) - .5) / n
    v = v0 + (v1 - v0) * x + np.maximum(peak - (v0 + v1) / 2, 0) * np.sin(np.pi * x) ** 2
    return v * total / max(v.sum(), 1e-9)


def _profile(P, fps, mode, peak, linger, land, end_frac=.2, land_frac=0.0):
    """Source position (fractional frame) for each output frame. The whip is planned in camera travel (pixels), not
    in source time, so a pan that eases in and out (as generated pans do) still whips evenly; the linger and the
    landing play at real time, so the scene's own motion there is untouched."""
    n = len(P)
    S = n - 1.0
    step = np.diff(P)
    ta = min(max(1, round(linger * fps)), int(S * .4))          # linger: real time from the first frame
    vmax = step.max()
    if mode == "return":
        far = float(np.interp(.92 * P[-1], P, np.arange(n)))      # whip out to where the pan has nearly stopped
        s = list(np.arange(0, ta + 1, 1.0))
        D = P[-1] * .92 - P[ta]
        nb = max(4, round(2 * D / (peak + step[ta])))
        vb = _bump(nb, step[ta], 0.0, peak, D)
        D0 = P[ta]
        for v in vb:
            D0 += v
            s.append(float(np.interp(D0, P, np.arange(n))))
        Dback = D0                                                # all the way back to the first frame
        nc = max(4, round(2 * Dback / peak))
        vc = _bump(nc, 0.0, 0.0, peak, Dback)
        for v in vc:
            D0 -= v
            s.append(float(np.interp(max(D0, 0.0), P, np.arange(n))))
        nl = max(2, round(land * fps))                            # land: the opening frames at half speed (near still)
        s += list(s[-1] + .5 * np.arange(1, nl + 1))
    else:
        # reveal: whip through the pan until it has slowed to end_frac of its top speed, then play the rest at real time
        # (a higher end_frac hands more of the pan's own deceleration to the landing)
        after = np.nonzero(step[ta:] >= end_frac * vmax)[0]
        tb = ta + (int(after[-1]) + 1 if len(after) else 1)
        if land_frac:                                         # a pan that never slows: keep its last part for the landing
            tb = int(S * (1 - land_frac))
        tb = int(np.clip(tb, ta + 2, S))
        D = P[tb] - P[ta]
        nb = max(4, round(2 * D / (peak + (step[ta] + step[min(tb, n - 2)]) / 2)))
        vb = _bump(nb, step[ta], step[min(tb, n - 2)], peak, D)
        s = list(np.arange(0, ta + 1, 1.0))
        D0 = P[ta]
        for v in vb:
            D0 += v
            s.append(float(np.interp(D0, P, np.arange(n))))
        if land_frac:                                         # land in slow motion: real time easing to a fifth of it
            R = S - tb
            nl = max(2, round(R / .6))
            x = (np.arange(1, nl + 1) - .5) / nl
            vl = 1 - .8 * _ease(x)
            vl *= R / vl.sum()
            s += list(tb + np.cumsum(vl))
        else:
            nl = int(min(round(land * fps), S - tb))
            s += list(tb + np.arange(1, nl + 1, dtype=float))
    s = np.clip(np.array(s), 0, S)
    return s, np.gradient(s), np.gradient(np.interp(s, np.arange(n), P))


def _subframe(frames, T, u):
    """The picture at fractional source time u: the nearest real frame, moved part of the way along the camera's own
    motion to where the camera was at u (a pan interpolates almost perfectly as a similarity)."""
    n = len(frames)
    i = int(np.clip(round(u), 0, n - 1))
    f = u - i
    if abs(f) < 1e-3:
        return frames[i]
    if f > 0 and i < n - 1:
        M = T[i]                                 # i -> i+1
    elif f < 0 and i > 0:
        M = cv2.invertAffineTransform(T[i - 1])  # i -> i-1
        f = -f
    else:
        return frames[i]
    A = np.float64([[1, 0, 0], [0, 1, 0]]) + f * (M - np.float64([[1, 0, 0], [0, 1, 0]]))
    H, W = frames.shape[1:3]
    return cv2.warpAffine(frames[i], A.astype(np.float32), (W, H), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT)


def whip(frames, T=None, fps=24.0, mode="reveal", speed=0.0, smear=.15, linger=.6, land=1.0, shutter=1.0, max_samples=48, end_frac=.2, land_frac=0.0):
    """Speed-ramp a real pan into a whip pan, with motion blur from the camera's own motion.
    smear: the peak camera move per output frame, as a fraction of the frame width (the whip's speed). speed, if set,
    overrides it as a multiple of the pan's own top speed. shutter: exposure as a fraction of the frame interval
    (1.0 = a 360 degree shutter, a continuous smear; 0.5 = 180 degrees, which strobes a little)."""
    frames = np.asarray(frames)
    n, H, W = frames.shape[:3]
    if T is None:
        T = track_motion(frames)
    P = _travel(T)
    top = float(np.diff(P).max())
    peak = speed * top if speed else max(smear * W, 2 * top)
    s, vel, pxv = _profile(P, fps, mode, peak, linger, land, end_frac, land_frac)
    work = frames.astype(np.float32) if frames.dtype == np.uint8 else frames
    out = np.empty((len(s),) + frames.shape[1:], np.float32)
    for k, (u, v, pv) in enumerate(zip(s, vel, pxv)):
        span = abs(v) * shutter                                          # source frames covered by this exposure
        ns = int(np.clip(math.ceil(abs(pv) * shutter / 3.0), 1, max_samples))   # a sample every ~3 px of smear
        if ns == 1 or span < .05:
            out[k] = _subframe(work, T, u)
            continue
        us = u + (np.arange(ns) + .5) / ns * span - span / 2
        acc = np.zeros(frames.shape[1:], np.float32)
        for x in us:
            acc += _subframe(work, T, float(np.clip(x, 0, n - 1)))
        out[k] = acc / ns
    if frames.dtype == np.uint8:
        out = np.clip(out + .5, 0, 255).astype(np.uint8)
    info = dict(mode=mode, frames=len(s), seconds=round(len(s) / fps, 2), pan_travel_px=round(float(P[-1])),
                pan_top_px_per_frame=round(top, 1), whip_peak_px_per_frame=round(float(np.abs(pxv).max()), 1))
    return out, info
