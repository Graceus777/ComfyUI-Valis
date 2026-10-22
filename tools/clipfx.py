"""clipfx: the clip-editing helpers the film cuts use (BURN SEASON 3, OCCUPIED, BLUE RIBBON). It is a library for cut
scripts and a small CLI. It is kept out of the studio's shot graphs on purpose: these are edit decisions made on a finished
clip, not settings on every shot.

    python tools/clipfx.py motion  clip.mp4 [...]           camera motion per 0.25 s and where the move gets going
    python tools/clipfx.py music   clip.mp4 [...]           notes per 0.5 s: flags a score H3 made up under a shot
    python tools/clipfx.py even    in.mp4 out.mp4 --t0 0 --t1 8.8 --seconds 3.7
    python tools/clipfx.py push    in.mp4 out.mp4 --t0 0.2 --seconds 2.4 --z 1 1.8 --at 0.5 0.4 --ease in --last 0.42 --blur
    python tools/clipfx.py fit     in.mp4 out.mp4 --mb 28   two-pass encode under a size cap

motion  Camera motion is the median horizontal optical flow over textured, unlit pixels: fire, candle flames and flat
        dark areas say nothing about where the camera is going, and with them left in, an orbit's slow-down near a
        pinned frame reads as motion. "gets going" is the first time the move reaches half its typical speed: H3 starts
        every shot from the still keyframe, so an in-point before that plays as a pause between cuts.
music   A trained camera move (FPV, dolly, crane, orbit) on H3 used to come with an invented score under it, because the
        LoRA's prompt had no sound direction (graphs.js now adds one). Notes all the way through an ambience shot are that
        score; under a shot like that, cut in the place's sound from another clip.
even    Re-times a camera move to one steady speed by its measured motion: holds and ease-ins (an orbit's joins, the
        start) are skimmed and fast parts keep every frame. Each output frame is a 180-degree shutter blend of the
        source frames it covers, so a sped-up move smears a little instead of strobing.
push    A digital push-in on a point with an ease curve, held for all but the last `last` seconds; with blur, each moving
        frame is blended with the one before. For cutting on motion into a close-up (Odile's "It lends.").
fit     Two-pass x264 sized to a cap (the device bridge takes 30 MB a file).
"""
import argparse
import os
import subprocess
import sys
import tempfile

import numpy as np

W, H, FPS = 1080, 1920, 24          # the films' frame; set clipfx.W/H/FPS before use for another size


def _vf():
    return f"scale={W}:{H}:flags=lanczos,setsar=1"


# ---------------------------------------------------------------- reading and writing frames
def frames(src, t0=0.0, dur=None):
    """RGB uint8 frames at W x H from t0, for dur seconds (all if None)."""
    cmd = ["ffmpeg", "-v", "error", "-ss", f"{t0:.4f}", "-i", src] + (["-t", f"{dur:.4f}"] if dur else []) + \
          ["-vf", _vf(), "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]
    p = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL); n = W * H * 3
    try:
        while True:
            b = p.stdout.read(n)
            if len(b) < n:
                break
            yield np.frombuffer(b, np.uint8).reshape(H, W, 3)
    finally:
        p.stdout.close(); p.kill(); p.wait()


def writer(out, extra="", crf=14):
    return subprocess.Popen(["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS),
                             "-i", "-", "-vf", "setsar=1,format=yuv420p" + extra, "-c:v", "libx264", "-crf", str(crf), "-preset", "fast", out],
                            stdin=subprocess.PIPE)


def zoom(img, z, cx=0.5, cy=0.5):
    """crop 1/z of the frame around (cx, cy) (fractions of the frame), scaled back to full size."""
    if abs(z - 1) < 1e-3:
        return img
    from PIL import Image
    w, h = W / z, H / z
    x0 = min(max(cx * W - w / 2, 0), W - w); y0 = min(max(cy * H - h / 2, 0), H - h)
    return np.asarray(Image.fromarray(img).resize((W, H), Image.BICUBIC, box=(x0, y0, x0 + w, y0 + h)))


# ---------------------------------------------------------------- measuring
def _grey(src, w=192, t0=0.0, dur=None):
    h = int(round(w * H / W))
    cmd = ["ffmpeg", "-v", "error", "-ss", f"{t0:.4f}", "-i", src] + (["-t", f"{dur:.4f}"] if dur else []) + \
          ["-vf", f"scale={w}:{h},format=gray", "-f", "rawvideo", "-"]
    return np.frombuffer(subprocess.run(cmd, capture_output=True).stdout, np.uint8).reshape(-1, h, w)


def camera_motion(src, t0=0.0, dur=None, w=192):
    """per frame: (mean flow magnitude, camera's horizontal flow) in px at `w` wide. Frame 0 is 0."""
    import cv2
    fr = _grey(src, w, t0, dur)
    mag, hx = [0.0], [0.0]
    for a, b in zip(fr[:-1], fr[1:]):
        fl = cv2.calcOpticalFlowFarneback(a, b, None, 0.5, 3, 15, 3, 5, 1.2, 0)
        mag.append(float(np.hypot(fl[..., 0], fl[..., 1]).mean()))
        g = cv2.Sobel(a, cv2.CV_32F, 1, 0) ** 2 + cv2.Sobel(a, cv2.CV_32F, 0, 1) ** 2
        m = (a < 140) & (b < 140) & (g > np.percentile(g, 60))
        hx.append(float(np.median(fl[..., 0][m])) if m.sum() > 50 else 0.0)
    return np.array(mag), np.array(hx)


def gets_going(mag, frac=0.5, settle=12):
    """seconds into the clip where motion first reaches `frac` of its typical speed (median after the first half second)."""
    ref = np.median(mag[settle:]) if len(mag) > settle else np.median(mag)
    sm = np.convolve(mag, np.ones(4) / 4, mode="same")
    i = next((i for i in range(1, len(sm)) if sm[i] >= frac * ref), 0)
    return i / FPS


def tonal(src, hop_s=0.5):
    """(seconds, fraction of tonal frames, dB) per hop. A frame is tonal when at least three spectral bins between 100 Hz
    and 3 kHz stand 12 dB over their neighbourhood: notes. Measured on BURN SEASON 3: the made-up scores 100%, fire,
    water, an engine and room tone 0-4%, a spoken line about half. A whole ambience shot that is tonal is a score."""
    y = np.frombuffer(subprocess.run(["ffmpeg", "-v", "error", "-i", src, "-vn", "-ac", "1", "-ar", "16000", "-f", "f32le", "-"],
                                     capture_output=True).stdout, np.float32).astype(np.float64)
    n, hop = 2048, 512
    if len(y) < n:
        return []
    m = 1 + (len(y) - n) // hop
    fr = np.lib.stride_tricks.as_strided(y, (m, n), (y.strides[0] * hop, y.strides[0])) * np.hanning(n)
    spec = np.abs(np.fft.rfft(fr, axis=1)) + 1e-9
    fq = np.fft.rfftfreq(n, 1 / 16000)
    L = 20 * np.log10(spec[:, (fq > 100) & (fq < 3000)])
    pad = np.pad(L, ((0, 0), (15, 15)), mode="edge")
    local = np.median(np.lib.stride_tricks.sliding_window_view(pad, 31, axis=1), axis=2)
    is_tonal = ((L - local) > 12).sum(1) >= 3
    db = 10 * np.log10((fr ** 2).mean(1) + 1e-12)
    per = max(1, int(round(hop_s * 16000 / hop)))
    return [(i * hop / 16000, float(is_tonal[i:i + per].mean()), float(db[i:i + per].mean())) for i in range(0, m, per)]


# ---------------------------------------------------------------- effects
def even_positions(src, t0, t1, nout, smooth=7):
    """fractional source-frame positions (from t0) for nout output frames with the camera at one steady speed."""
    _, hx = camera_motion(src, t0, t1 - t0)
    d = np.sign(hx.sum()) or 1.0
    v = np.maximum(d * hx, 0)                                   # only motion the way the camera is going counts
    v = np.convolve(v, np.ones(smooth) / smooth, mode="same")
    v = np.maximum(v, 0.02 * np.median(v)); v[0] = 0
    cum = np.cumsum(v)
    return np.interp(np.linspace(0, cum[-1], nout), cum, np.arange(len(cum))), len(cum)


def even_retime(src, t0, t1, nout, out, extra=""):
    pos, n = even_positions(src, t0, t1, nout)
    buf, w = {}, writer(out, extra)
    it = enumerate(frames(src, t0, t1 - t0)); last = -1

    def get(i):
        nonlocal last
        while last < i:
            last, f = next(it); buf[last] = f.astype(np.float32)
        return buf[i]
    prev = pos[0]
    for p in pos:
        span = max(p - prev, 1.0)                               # source frames this output frame covers
        lo, hi = max(int(np.floor(p - span / 2)), 0), min(int(np.ceil(p)), n - 1)
        hi = max(hi, lo)
        ws = [max(0.0, 1 - abs(i - p) / (span / 2 + 1)) for i in range(lo, hi + 1)]
        img = sum(get(i) * wt for i, wt in zip(range(lo, hi + 1), ws)) / max(sum(ws), 1e-6)
        w.stdin.write(np.clip(img, 0, 255).astype(np.uint8).tobytes())
        for k in [k for k in buf if k < lo - 2]:
            del buf[k]
        prev = p
    w.stdin.close(); w.wait()
    return pos


def ease_in(x): return x * x * x                   # slow start, fast finish: the push into a cut
def ease_out(x): return 1 - (1 - x) ** 3           # fast start, settling: the push after it


def push(src, t0, nframes, out, z0, z1, cx=0.5, cy=0.5, curve=ease_out, start=0, blur=False, extra=""):
    """zoom z0 -> z1 on (cx, cy): held at z0 for the first `start` frames, moving through the last frame."""
    w = writer(out, extra); last = None
    for i, f in enumerate(frames(src, t0, nframes / FPS + 0.2)):
        if i >= nframes:
            break
        x = curve(min(max((i - start) / max(nframes - 1 - start, 1), 0), 1))
        img = zoom(f, z0 + (z1 - z0) * x, cx, cy).astype(np.float32)
        if blur and last is not None and i > start:
            img = 0.55 * img + 0.45 * last
        last = img
        w.stdin.write(np.clip(img, 0, 255).astype(np.uint8).tobytes())
    w.stdin.close(); w.wait()


def fit(src, out, mb=28.0, audio_kbps=192):
    """two-pass x264 + AAC sized to about `mb` megabytes."""
    d = float(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", src]))
    vk = int(mb * 8 * 1024 / d - audio_kbps)
    src, out = os.path.abspath(src), os.path.abspath(out)
    with tempfile.TemporaryDirectory() as tmp:            # the pass log lands in the working directory
        base = ["ffmpeg", "-v", "error", "-y", "-i", src, "-c:v", "libx264", "-preset", "slow", "-b:v", f"{vk}k"]
        subprocess.run(base + ["-pass", "1", "-an", "-f", "mp4", os.devnull], cwd=tmp, check=True)
        subprocess.run(base + ["-pass", "2", "-c:a", "aac", "-b:a", f"{audio_kbps}k", "-movflags", "+faststart", out], cwd=tmp, check=True)
    return vk


# ---------------------------------------------------------------- CLI
def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("motion"); s.add_argument("clips", nargs="+")
    s = sub.add_parser("music"); s.add_argument("clips", nargs="+")
    s = sub.add_parser("even"); s.add_argument("src"); s.add_argument("out")
    s.add_argument("--t0", type=float, default=0.0); s.add_argument("--t1", type=float, required=True); s.add_argument("--seconds", type=float, required=True)
    s = sub.add_parser("push"); s.add_argument("src"); s.add_argument("out")
    s.add_argument("--t0", type=float, default=0.0); s.add_argument("--seconds", type=float, required=True)
    s.add_argument("--z", type=float, nargs=2, default=[1.0, 1.5]); s.add_argument("--at", type=float, nargs=2, default=[0.5, 0.5])
    s.add_argument("--ease", choices=["in", "out"], default="out"); s.add_argument("--last", type=float, default=0.0, help="move only in the last N s")
    s.add_argument("--blur", action="store_true")
    s = sub.add_parser("fit"); s.add_argument("src"); s.add_argument("out"); s.add_argument("--mb", type=float, default=28.0)
    a = ap.parse_args(argv)
    if a.cmd == "motion":
        for c in a.clips:
            mag, hx = camera_motion(c)
            q = lambda v: " ".join(f"{v[i:i + 6].mean():+.2f}" for i in range(0, len(v), 6))
            print(f"{os.path.basename(c)}  gets going at {gets_going(mag):.2f} s\n  flow  {q(mag)}\n  camera-x {q(hx)}")
    elif a.cmd == "music":
        for c in a.clips:
            rows = tonal(c)
            share = np.mean([v for _, v, _ in rows]) if rows else 0
            flag = "  <- tonal throughout: a made-up score" if share > 0.8 else ""
            print(f"{os.path.basename(c)}  tonal {share:.0%}{flag}\n  " + " ".join(f"{t:.1f}:{v:.0%}/{d:.0f}dB" for t, v, d in rows))
    elif a.cmd == "even":
        even_retime(a.src, a.t0, a.t1, int(round(a.seconds * FPS)), a.out)
    elif a.cmd == "push":
        n = int(round(a.seconds * FPS))
        push(a.src, a.t0, n, a.out, a.z[0], a.z[1], a.at[0], a.at[1], ease_in if a.ease == "in" else ease_out,
             start=n - int(round(a.last * FPS)) if a.last else 0, blur=a.blur)
    elif a.cmd == "fit":
        print(f"video {fit(a.src, a.out, a.mb)}k")


if __name__ == "__main__":
    main()
