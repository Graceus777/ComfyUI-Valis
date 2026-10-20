"""Motion check for a generated camera move: does the camera keep going one way, and is it one continuous shot?

    python tools/motion_check.py clip.mp4 [more.mp4 ...]

Per frame pair it measures dense optical flow (Farneback) on a small grey copy:
  pan   - the median horizontal flow (px per frame at 256 px wide): the direction the scene slides, so its sign is the
          direction of an orbit, arc, pan or track.
  break - how badly the next frame is explained by warping this one along the flow, relative to the clip's own median.
          A cut is a one-frame spike; a dissolve (two images blended to get to a pinned frame) is a run of raised
          values while the flow stays small.
It reports REVERSAL when the pan direction holds for a while and then holds the other way, DISSOLVE / CUT for breaks,
and FREEZE for a held still at the end. Net zoom is the whole frame's scale change (a push-in > 1; a locked dolly
zoom shows the background's). Contact sheets miss all three; this was written after they did."""
import math
import subprocess
import sys

import cv2
import numpy as np


def frames(path, w=256):
    probe = subprocess.check_output(["ffprobe", "-v", "error", "-select_streams", "v", "-show_entries", "stream=width,height,r_frame_rate",
                                     "-of", "csv=p=0", path]).decode().strip().split(",")
    W, H = int(probe[0]), int(probe[1])
    num, den = map(float, probe[2].split("/"))
    h = round(H * w / W / 2) * 2
    raw = subprocess.check_output(["ffmpeg", "-v", "error", "-i", path, "-vf", f"scale={w}:{h},format=gray", "-f", "rawvideo", "-"])
    return np.frombuffer(raw, np.uint8).reshape(-1, h, w), num / den


def measure(g):
    pan, mag, brk, zoom = [], [], [], []
    hh, ww = g.shape[1:]
    grid = np.dstack(np.meshgrid(np.arange(ww), np.arange(hh))).astype(np.float32)
    pts = grid[8:-8:8, 8:-8:8].reshape(-1, 2)
    for a, b in zip(g[:-1], g[1:]):
        f = cv2.calcOpticalFlowFarneback(a, b, None, .5, 3, 21, 3, 5, 1.1, 0)
        pan.append(float(np.median(f[..., 0])))
        mag.append(float(np.median(np.hypot(f[..., 0], f[..., 1]))))
        # the frame's overall scale change (a similarity fitted to the flow): a locked dolly zoom has almost no median
        # flow but a steady zoom of the background
        M, _ = cv2.estimateAffinePartial2D(pts, pts + f[8:-8:8, 8:-8:8].reshape(-1, 2), method=cv2.RANSAC, ransacReprojThreshold=1.0)
        zoom.append(float(np.hypot(M[0, 0], M[0, 1])) if M is not None else 1.0)
        # backward-warp b onto a along the flow; what's left is what motion can't explain
        warped = cv2.remap(b, grid + f, None, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
        m = 12  # ignore the borders, where new content enters
        brk.append(float(np.abs(warped[m:-m, m:-m].astype(np.float32) - a[m:-m, m:-m]).mean()))
    return np.array(pan), np.array(mag), np.array(brk), np.array(zoom)


def runs(mask, min_len):
    out, s = [], None
    for i, v in enumerate(list(mask) + [False]):
        if v and s is None:
            s = i
        elif not v and s is not None:
            if i - s >= min_len:
                out.append((s, i - 1))
            s = None
    return out


def check(path):
    g, fps = frames(path)
    pan, mag, brk, zoom = measure(g)
    n = len(g)
    base = np.median(brk) + 1e-6
    unexplained = brk / (mag + .5)                 # change that motion doesn't account for; fast moves and blur score low
    rel = unexplained / (np.median(unexplained) + 1e-6)
    sm = np.convolve(pan, np.ones(5) / 5, mode="same")
    moving = np.abs(sm) > .35                      # sliding at least ~1.4 % of the width per second at 24 fps
    sign = np.sign(sm) * moving
    issues = []
    # reversal: a run one way (>= 0.4 s) followed later by a run the other way (>= 0.4 s)
    k = max(4, int(.4 * fps))
    pos, neg = runs(sign > 0, k), runs(sign < 0, k)
    for a in pos:
        for b in neg:
            first, second = (a, b) if a[0] < b[0] else (b, a)
            if second[0] > first[1]:
                issues.append(("REVERSAL", first[1] + 1, second[0] + 1,
                               f"slides {'left' if sm[first[0]] < 0 else 'right'} f{first[0]+1}-{first[1]+1}, then the other way f{second[0]+1}-{second[1]+1}"))
    for s, e in runs(rel > 2.5, 1):
        kind = "CUT" if e - s < 2 and rel[s:e + 1].max() > 5 else "DISSOLVE"
        if kind == "DISSOLVE" and e - s < 3:
            continue
        issues.append((kind, s + 1, e + 1, f"motion can't explain the change (x{rel[s:e+1].max():.1f} the clip's median)"))
    still = np.abs(g.astype(np.int16) - g[-1]).mean(axis=(1, 2)) < 1.0
    hold = 0
    for v in still[::-1]:
        if not v:
            break
        hold += 1
    if hold - 1 > .5 * fps:
        issues.append(("FREEZE", n - hold + 1, n, f"the last {(hold-1)/fps:.1f} s is one still frame"))
    travel = float(np.sum(pan)) / g.shape[2]
    net_zoom = float(np.prod(zoom))
    if np.percentile(mag, 75) < .25 and abs(travel) < .1 and abs(math.log(net_zoom)) < .05:
        issues.append(("STATIC", 1, n, f"the camera hardly moves (75th-percentile flow {np.percentile(mag, 75):.2f} px/frame)"))
    print(f"{path}\n  {n} frames @ {fps:g} fps; net slide {travel:+.2f} widths; net zoom x{net_zoom:.2f}; median break {base:.2f}")
    for kind, s, e, why in sorted(issues, key=lambda x: x[1]):
        print(f"  {kind:9s} f{s}-{e} ({s/fps:.2f}-{e/fps:.2f} s): {why}")
    if not issues:
        print("  ok: one direction, one continuous shot")
    return issues, pan, rel


if __name__ == "__main__":
    for p in sys.argv[1:]:
        check(p)
