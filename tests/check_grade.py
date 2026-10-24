"""Does grade.js (the studio's live preview) grade like palette.py (what renders the shot)? Every look, on a test
picture, without grain (random in both): the mean difference per channel, in 8-bit levels.

    python tests/check_grade.py        (needs node, numpy, opencv-python)
"""
import json
import os
import subprocess
import sys

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "valis_fx", "lib"))
import palette as pal  # noqa: E402

H, W = 96, 64
yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
img = np.stack([xx / (W - 1), yy / (H - 1), 0.5 + 0.5 * np.sin(xx / 7) * np.cos(yy / 9)], -1).astype(np.float32)   # every colour, smooth and busy
img[40:60, 20:44] = [.78, .56, .45]                                                                                 # a skin patch
img[70:80, 5:20] = 0.97                                                                                             # a highlight (bloom)
js = r"""
import {createRequire} from "node:module"; const require = createRequire(import.meta.url);
const m = await import(process.argv[1]);
const px = new Float32Array(JSON.parse(require("fs").readFileSync(0, "utf8")));
const out = {};
for (const p of (await import(process.argv[2])).PALETTES) out[p.id] = Array.from(m.gradePixels(px, %d, %d, {...m.lookParams(p.id), grain: 0}, {scale: 1}));
console.log(JSON.stringify(out));
""" % (W, H)
r = subprocess.run(["node", "--input-type=module", "-e", js, "file://" + os.path.join(ROOT, "app", "js", "grade.js").replace("\\", "/"),
                    "file://" + os.path.join(ROOT, "app", "js", "palettes.js").replace("\\", "/")],
                   input=json.dumps(img.reshape(-1).tolist()), capture_output=True, text=True)
if r.returncode:
    sys.exit(r.stderr)
jsout = json.loads(r.stdout)
worst = 0
for k in pal.LOOKS:
    lk = pal.Look(pal.LOOKS[k], grain=0)
    py = pal.grade(img, lk)
    d = np.abs(py - np.asarray(jsout[k], np.float32).reshape(H, W, 3)) * 255
    worst = max(worst, d.mean())
    print(f"{k:16s} mean {d.mean():5.2f}  p99 {np.percentile(d, 99):6.2f} levels")
print("worst mean difference:", round(worst, 2), "levels")
sys.exit(0 if worst < 3 else 1)
