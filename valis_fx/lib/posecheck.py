"""Source check for Motion Transfer: is this clip's motion readable as a skeleton, second by second?

Motion Transfer gives the video model only a pose skeleton per frame. Where the skeleton is missing or ambiguous the
model has to guess the body, and that is where it warps (a long skirt hides the hips and legs; in a spin the face drops
out and nothing says which way the body faces; a dancer leaving the frame leaves no skeleton at all). This reads the
SDPose keypoints (OpenPose order, the output of SDPoseKeypointExtractor) and reports, before any expensive render:
which stretches are fine, what is wrong with the others, and the best window to use.

    report, scores = check(frames, fps=24)      # frames: the POSE_KEYPOINT list
    strip = timeline(scores, report)            # an image: one column per frame, green to red, plus issue lanes
"""
import warnings

import numpy as np

warnings.filterwarnings("ignore", message="Mean of empty slice")
warnings.filterwarnings("ignore", message="All-NaN slice encountered")

# OpenPose 18: 0 nose 1 neck 2 r-shoulder 3 r-elbow 4 r-wrist 5 l-shoulder 6 l-elbow 7 l-wrist 8 r-hip 9 r-knee
# 10 r-ankle 11 l-hip 12 l-knee 13 l-ankle 14 r-eye 15 l-eye 16 r-ear 17 l-ear
BONES = [(1, 2), (1, 5), (2, 3), (3, 4), (5, 6), (6, 7), (1, 8), (1, 11), (8, 9), (9, 10), (11, 12), (12, 13)]
ISSUES = {
    "lost": "no body found",
    "edge": "body cut off by the frame edge",
    "legs": "hips and legs hidden (long dress or coat, or out of frame)",
    "facing": "can't tell which way the body faces (back turned or mid-spin)",
    "flicker": "left and right keep swapping",
    "jump": "skeleton jumps or limbs stretch (false detection)",
}
WEIGHT = {"lost": 1.0, "edge": .35, "legs": .35, "facing": .3, "flicker": .45, "jump": .5}


def _main_person(frame, thr):
    best, best_s = None, -1.0
    for p in frame.get("people", []):
        a = np.asarray(p.get("pose_keypoints_2d") or [], np.float32).reshape(-1, 3)
        if len(a) < 18:
            continue
        s = float(a[:18, 2][a[:18, 2] >= thr].sum())
        if s > best_s:
            best, best_s = a[:18], s
    return best


def check(frames, fps=24.0, thr=.5, min_window=2.0):
    n = len(frames)
    if not n:
        return {"verdict": "empty", "frames": 0}, np.zeros(0)
    W = float(frames[0].get("canvas_width", 1)); H = float(frames[0].get("canvas_height", 1))
    m = .015 * max(W, H)
    pts = np.full((n, 18, 2), np.nan, np.float32)
    ok = np.zeros((n, 18), bool)
    for t, f in enumerate(frames):
        a = _main_person(f, thr)
        if a is not None:
            ok[t] = a[:, 2] >= thr
            pts[t] = np.where(ok[t][:, None], a[:, :2], np.nan)
    flags = {k: np.zeros(n, bool) for k in ISSUES}
    flags["lost"] = ok.sum(1) < 5
    x, y = pts[..., 0], pts[..., 1]
    with np.errstate(invalid="ignore"):
        near = ok & ((x < m) | (x > W - m) | (y < m) | (y > H - m))
    flags["edge"] = ~flags["lost"] & near.any(1)
    flags["legs"] = ~flags["lost"] & (ok[:, [8, 9, 11, 12]].sum(1) < 3)
    # torso height: neck to hips (the scale everything else is measured against)
    hip = np.nanmean(np.stack([pts[:, 8], pts[:, 11]]), 0)
    with np.errstate(invalid="ignore"):
        torso = np.linalg.norm(pts[:, 1] - hip, axis=1)
    ts = np.nanmedian(torso) if np.isfinite(torso).any() else np.nan
    if not np.isfinite(ts):                                          # no hips anywhere: use the shoulder width x 1.6
        with np.errstate(invalid="ignore"):
            ts = 1.6 * np.nanmedian(np.abs(pts[:, 2, 0] - pts[:, 5, 0]))
    ts = ts if np.isfinite(ts) and ts > 1 else .25 * H
    face = ok[:, 0] & (ok[:, 14] | ok[:, 15])
    with np.errstate(invalid="ignore"):
        narrow = np.abs(pts[:, 2, 0] - pts[:, 5, 0]) < .3 * ts      # shoulders edge-on: side or turning
    flags["facing"] = ~flags["lost"] & ~face & (narrow | ~(ok[:, 2] & ok[:, 5]))
    # left/right swaps: the sign of (right shoulder x - left shoulder x) flipping back and forth within half a second
    side = np.sign(pts[:, 2, 0] - pts[:, 5, 0])
    flips = [t for t in range(1, n) if np.isfinite(side[t]) and np.isfinite(side[t - 1]) and side[t] != side[t - 1]]
    win = max(2, int(.5 * fps))
    for a, b in zip(flips, flips[1:]):
        if b - a <= win:
            flags["flicker"][max(0, a - 1):b + 2] = True
    # jumps: the body centre moving more than half a torso in one frame, or a bone 1.8x its usual length
    c = np.nanmean(pts[:, [1, 2, 5, 8, 11]], 1)
    with np.errstate(invalid="ignore"):
        step = np.linalg.norm(np.diff(c, axis=0), axis=1)
    flags["jump"][1:] |= np.nan_to_num(step, nan=0) > .5 * ts
    for i, j in BONES:
        with np.errstate(invalid="ignore"):
            L = np.linalg.norm(pts[:, i] - pts[:, j], axis=1)
        med = np.nanmedian(L) if np.isfinite(L).any() else np.nan
        if np.isfinite(med) and med > 1:
            flags["jump"] |= np.nan_to_num(L, nan=0) > 1.8 * med
    flags["jump"] &= ~flags["lost"]
    # score per frame, then smoothed a little (one bad frame among good ones barely matters to the model)
    bad = np.zeros(n)
    for k, f in flags.items():
        bad = np.maximum(bad, WEIGHT[k] * f) if k == "lost" else bad + WEIGHT[k] * f
    score = np.clip(1 - bad, 0, 1)
    k = max(1, int(.2 * fps)) | 1
    score = np.convolve(np.pad(score, k // 2, mode="edge"), np.ones(k) / k, mode="valid")
    good = score >= .6
    # best window: the longest stretch that is at least 85% good frames (grow from every start, keep the longest)
    best = (0, 0)
    cs = np.concatenate([[0], np.cumsum(good)])
    j = 0
    for i in range(n):
        j = max(j, i)
        while j < n and (cs[j + 1] - cs[i]) >= .85 * (j + 1 - i):
            j += 1
        if j - i > best[1] - best[0]:
            best = (i, j)
    ranges = {}
    for k, f in flags.items():
        rs, t = [], 0
        while t < n:
            if f[t]:
                u = t
                while u < n and f[u]:
                    u += 1
                if (u - t) / fps >= .25:
                    rs.append((round(t / fps, 2), round(u / fps, 2)))
                t = u
            else:
                t += 1
        if rs:
            ranges[k] = rs
    frac = float(good.mean())
    bw = (best[1] - best[0]) / fps
    verdict = "good" if frac >= .9 else "usable window" if bw >= min_window else "risky"
    report = {
        "verdict": verdict, "frames": n, "seconds": round(n / fps, 2), "good": round(frac, 2),
        "best_window": {"start": round(best[0] / fps, 2), "duration": round(bw, 2)},
        "found": {"body": round(float(1 - flags["lost"].mean()), 2), "legs": round(float(1 - flags["legs"].mean()), 2),
                  "face": round(float(face.mean()), 2), "in_frame": round(float(1 - flags["edge"].mean()), 2)},
        "issues": {k: {"what": ISSUES[k], "at": v} for k, v in ranges.items()},
        "summary": summary(verdict, frac, ranges, best, fps),
    }
    return report, score


def summary(verdict, frac, ranges, best, fps):
    lines = [f"{int(round(frac * 100))}% of the clip reads clearly as a body."]
    for k in ISSUES:
        if k in ranges:
            at = ", ".join(f"{a:.1f}-{b:.1f} s" for a, b in ranges[k][:4])
            lines.append(f"{ISSUES[k][0].upper() + ISSUES[k][1:]}: {at}.")
    if verdict == "good":
        lines.append("Good to go.")
    else:
        lines.append(f"Best window: {best[0] / fps:.1f}-{best[1] / fps:.1f} s." if best[1] > best[0] else "No clean window: try another clip.")
    return " ".join(lines)


def timeline(score, report, width=None, h=56):
    """One column per frame: the score (green good, amber unsure, red bad) on top, then a thin lane per issue."""
    n = len(score)
    if not n:
        return np.zeros((h, 8, 3), np.float32)
    w = width or max(n, 240)
    xs = np.minimum((np.arange(w) * n / w).astype(int), n - 1)
    s = score[xs]
    top = np.stack([np.clip(2 * (1 - s), 0, 1), np.clip(2 * s, 0, 1), np.full_like(s, .15)], -1) * .85
    img = np.full((h, w, 3), .08, np.float32)
    img[:24] = top[None]
    lane_h = max(2, (h - 28) // len(ISSUES))
    for li, k in enumerate(ISSUES):
        y0 = 28 + li * lane_h
        for a, b in report.get("issues", {}).get(k, {}).get("at", []):
            x0, x1 = int(a * report["frames"] / report["seconds"] * w / n), int(b * report["frames"] / report["seconds"] * w / n)
            img[y0:y0 + lane_h - 1, x0:max(x1, x0 + 1)] = (.9, .45, .2)
    bw = report.get("best_window", {})
    if bw.get("duration"):
        fps = report["frames"] / report["seconds"]
        x0 = int(bw["start"] * fps * w / n); x1 = int((bw["start"] + bw["duration"]) * fps * w / n)
        img[24:27, x0:x1] = (.95, .95, .95)
    return img
