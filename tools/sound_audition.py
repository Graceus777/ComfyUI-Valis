"""An audition reel for the Valis sound designs: each design struck a few times in a row (every strike synthesised
fresh, so none is the same), in one key and one room, with a caption card and a pulse on each hit.

    python tools/sound_audition.py out.mp4 [--key "D minor"] [--space hall] [--only bell,whoosh] [--n 4]

Every strike is set to the same loudness so the sounds can be compared for character; how loud each sits in a film
is decided by the mixer (LEVEL, under the music)."""
import os
import subprocess
import sys

import numpy as np
import scipy.signal as ss
from PIL import Image, ImageDraw, ImageFont

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from valis_fx.lib import sound as S  # noqa: E402

W, H, FPS = 1280, 720, 24
REEL = [  # (design, what it is for, seconds between strikes)
    ("bell", "story bell, tuned to the key (each strike: a different clapper spot)", 3.2),
    ("swell", "reverse-reverb chord into a hit (Shockwave)", 3.0),
    ("whoosh", "air passing, peak on the cue (DoubleExposure)", 1.9),
    ("boom", "round low hit on the tonic, no grit (Shockwave, Punch)", 2.4),
    ("shimmer", "light: a high chord that blooms (Rays)", 3.0),
    ("ghost", "a far-off sung vowel on a note of the key (Echo)", 2.8),
    ("slip", "another time cuts in: film gate + tape dip (TimeSlip, Split, Eras)", 1.6),
    ("lens", "gravity: the tonic sinking an octave (Lens)", 2.4),
    ("frost", "ice: crystal grains on high notes (Frost)", 2.6),
    ("heartbeat", "story sound", 1.2),
    ("thunder", "story sound", 5.0),
    ("crackle", "fire (beds and Burn)", 2.4),
    ("shatter", "glass on high notes (cue sheets)", 3.0),
    ("tear", "tearing open (Tear)", 1.8),
    ("stutter", "codec catch (Datamosh)", 1.2),
    ("tick", "a tiny tick (Glitch)", .6),
]


def font(sz, bold=False):
    for p in (f"/usr/share/fonts/opentype/inter/Inter-{'SemiBold' if bold else 'Regular'}.otf",
              f"/usr/share/fonts/truetype/dejavu/DejaVuSans{'-Bold' if bold else ''}.ttf"):
        if os.path.exists(p):
            return ImageFont.truetype(p, sz)
    return ImageFont.load_default()


def build(out, key="D minor", space="hall", only=None, n=4, seed=3):
    rng = np.random.default_rng(seed)
    k = S.Key.parse(key)
    items = [r for r in REEL if not only or r[0] in only]
    lead, gapsec = 1.0, 1.2
    events, cards, t = [], [], .5
    for name, what, step in items:
        t0 = t
        hits = []
        for j in range(n):
            th = t + lead + j * step
            x, at = S.DESIGNS[name](rng, float(rng.uniform(.75, 1.0)), k, .5)
            events.append((th, x, at)); hits.append(th)
        t = hits[-1] + step + gapsec
        cards.append((t0, t, name, what, hits))
    dur = t + .5
    # audio: every strike at the same loudness, through one room
    n_s = S._n(dur)
    dry = np.zeros((n_s + S._n(6), 2), np.float32)
    for th, x, at in events:
        g = 10 ** ((-20 - S.hit_loudness(x)) / 20)
        i = int((th - at) * S.SR)
        j = min(len(dry), i + len(x))
        dry[i:j] += x[:j - i] * g
    sp = S.SPACES[space]
    ir = S._ir(sp["rt60"] * 1.4, sp["rt60"], sp["dark"], 3, sp["pre"], sp.get("slap"))
    wet = np.stack([ss.fftconvolve(dry[:, c], ir[:, c])[:len(dry)] for c in range(2)], 1)
    mix = S.hp(dry * .8 + wet.astype(np.float32) * .25, 35)[:n_s]
    mix = mix * 10 ** ((-18 - S.lufs(mix)) / 20)
    mix = S._limit(mix.astype(np.float32), .89)
    import soundfile as sf
    wav = out.replace(".mp4", ".wav"); sf.write(wav, mix, S.SR)
    # picture: a caption card per design and a pulse on each strike
    fT, fS, fK = font(64, True), font(28), font(22)
    p = subprocess.Popen(["ffmpeg", "-y", "-v", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
                          "-i", wav, "-c:v", "libx264", "-crf", "20", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "256k", "-shortest", out],
                         stdin=subprocess.PIPE)
    for fi in range(int(dur * FPS)):
        tt = fi / FPS
        img = Image.new("RGB", (W, H), (14, 13, 12)); d = ImageDraw.Draw(img)
        card = next((c for c in cards if c[0] <= tt < c[1]), None)
        if card:
            t0, t1, name, what, hits = card
            d.text((80, 250), name, font=fT, fill=(236, 228, 214))
            d.text((82, 340), what, font=fS, fill=(170, 162, 150))
            for j, th in enumerate(hits):
                a = max(0.0, 1 - max(0.0, tt - th) / .5) if tt >= th else 0.0
                c = int(60 + 190 * a)
                d.ellipse((82 + j * 46, 420, 82 + j * 46 + 26, 446), fill=(c, int(c * .8), int(c * .55)))
        d.text((80, H - 70), f"Valis sound  ·  key {k}  ·  room: {space}  ·  every strike is synthesised anew", font=fK, fill=(110, 104, 96))
        p.stdin.write(np.asarray(img).tobytes())
    p.stdin.close(); p.wait()
    return out, dur


if __name__ == "__main__":
    a = sys.argv
    out = a[1] if len(a) > 1 and not a[1].startswith("--") else "sound_audition.mp4"
    opt = lambda k, d=None: a[a.index(k) + 1] if k in a else d
    only = opt("--only"); only = set(only.split(",")) if only else None
    print("wrote", *build(out, opt("--key", "D minor"), opt("--space", "hall"), only, int(opt("--n", 4))))
