"""Render the FX library's preview clips (app/assets/fx/<Effect>.webm): one effect on a short vertical clip, fired by a
small cue sheet, encoded by ffmpeg as VP9 at the size the library cards show.

    python tools/fx_previews.py <a.mp4> <b.mp4> <out_dir> [Effect ...]   (default: every effect without a preview)

a is the clip the effect plays on; b is the second scene for the effects that open onto one. Cut them short (about
three seconds) and at the card size first, e.g.
    ffmpeg -ss 28 -t 2.75 -i film.mp4 -vf "scale=240:420:force_original_aspect_ratio=increase,crop=240:420" -r 24 a.mp4
"""
import os
import subprocess
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from valis_fx.lib.core import Ctx                # noqa: E402
from valis_fx.lib.cues import Cues               # noqa: E402
from valis_fx.lib.effects import LIBRARY         # noqa: E402

W, H, FPS, SECONDS = 240, 420, 24, 2.667
SHEET = "0.33 downbeat\n0.33 beat\n1.0 beat\n1.67 downbeat\n1.67 beat\n2.33 beat\n"
PARAMS = {"Shockwave": dict(on="downbeat"), "Rays": dict(on="beat"), "Split": dict(on="downbeat", clips=("a", "b")),
          "Eras": dict(on="beat", clips=("a", "b"))}


def render(a, b, out_dir, names):
    n = int(round(SECONDS * FPS))
    cues = Cues.from_schedule(SHEET, SECONDS)
    for name in names:
        ctx = Ctx(cues, (W, H), n, FPS)
        ctx.add_clip("a", path=a, fps=FPS)
        ctx.add_clip("b", path=b, fps=FPS)
        fx = LIBRARY[name](**PARAMS.get(name, {}))
        out = os.path.join(out_dir, f"{name}.webm")
        enc = subprocess.Popen(["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
                                "-c:v", "libvpx-vp9", "-b:v", "0", "-crf", "33", "-an", out], stdin=subprocess.PIPE)
        for i in range(n):
            ctx.begin(i)
            img = np.clip(fx(ctx, ctx.a.copy()), 0, 1).astype(np.float32)
            ctx.end(img)
            enc.stdin.write((img * 255 + .5).astype(np.uint8).tobytes())
        enc.stdin.close()
        enc.wait()
        print("wrote", out)


if __name__ == "__main__":
    a, b, out_dir = sys.argv[1:4]
    names = sys.argv[4:] or [k for k in LIBRARY if not os.path.exists(os.path.join(out_dir, f"{k}.webm"))]
    render(a, b, out_dir, names)
