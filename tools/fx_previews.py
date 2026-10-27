"""Render the FX library's preview clips (app/assets/fx/<Effect>.webm): one effect on a short vertical clip, fired by a
small cue sheet, encoded by ffmpeg as VP9 at the size the library cards show.

    node tools/fx_preview_spec.mjs > spec.json      (each effect's default preset, from graphs.js)
    python tools/fx_previews.py spec.json plan.json <out_dir> [Effect ...]   (default: every effect in the plan)

plan.json says which clip each preview plays on: {"Effect": {"a": "clip.mp4", "b": "other.mp4", "mask": "matte.mp4"}, ...}
("b" for the effects that open onto a second scene, "mask" for the ones that need the subject: a SAM 3 matte of a, e.g.
the Edit tab's Find). Cut the clips short (about three seconds) first, e.g.
    ffmpeg -ss 28 -t 3 -i film.mp4 -vf "scale=432:768:force_original_aspect_ratio=increase,crop=432:768" -r 24 a.mp4
"""
import json
import os
import subprocess
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from valis_fx.lib.core import Ctx                # noqa: E402
from valis_fx.lib.cues import Cues               # noqa: E402
from valis_fx.lib.effects import LIBRARY         # noqa: E402

W, H, FPS, SECONDS = 240, 420, 24, 2.667
SHEET = "0.33 downbeat\n0.33 beat\n0.33 kick\n1.0 beat\n1.0 hat\n1.67 downbeat\n1.67 beat\n1.67 kick\n2.33 beat\n2.33 hat\n"


def render(spec, plan, out_dir, names):
    n = int(round(SECONDS * FPS))
    cues = Cues.from_schedule(SHEET, SECONDS)
    for name in names:
        p, sp = plan[name], spec[name]
        ctx = Ctx(cues, (W, H), n, FPS)
        ctx.add_clip("a", path=p["a"], fps=FPS)
        if p.get("b"):
            ctx.add_clip("b", path=p["b"], fps=FPS)
        if p.get("mask"):
            ctx.add_mask("subject", path=p["mask"], fps=FPS)
        params = dict(sp.get("params") or {})
        # a held effect (by a curve) is held by the beat's envelope here: the sheet has no curves
        if sp.get("by"):
            params.setdefault("by", "beat")
        elif sp.get("on"):
            params.setdefault("on", sp["on"])
        fx = LIBRARY[name](**params)
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
    spec, plan = json.load(open(sys.argv[1])), json.load(open(sys.argv[2]))
    out_dir = sys.argv[3]
    names = sys.argv[4:] or [k for k in plan if k in LIBRARY]
    render(spec, plan, out_dir, names)
