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
for (const c of [-.4, 0, .4]) out["soft_palette@" + c] = Array.from(m.gradePixels(px, %d, %d, {...m.lookParams("soft_palette"), grain: 0, contrast: c}, {scale: 1}));
for (const [k, hex] of Object.entries({hex3: ["#fff", "#123", "#f80"], hex6: ["#ffffff", "#112233", "#ff8800"]}))
  out[k] = Array.from(m.gradePixels(px, %d, %d, {...m.lookParams("custom", hex), grain: 0}, {scale: 1}));
console.log(JSON.stringify(out));
""" % (W, H, W, H, W, H)
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

# contrast below 0 flattens the picture, above 0 deepens it, in both (a negative one used to deepen it, half as much)
spread = lambda a: float(np.std(np.asarray(a, np.float32).reshape(-1, 3).mean(-1)))
py_s = {c: spread(pal.grade(img, pal.Look(pal.LOOKS["soft_palette"], grain=0, contrast=c))) for c in (-.4, 0, .4)}
js_s = {c: spread(jsout[f"soft_palette@{c}"]) for c in (-.4, 0, .4)}
bad = []
for name, s_ in (("palette.py", py_s), ("grade.js", js_s)):
    print(f"{name} contrast -.4 / 0 / +.4: spread {s_[-.4]:.4f} / {s_[0]:.4f} / {s_[.4]:.4f}")
    if not s_[-.4] < s_[0] < s_[.4]:
        bad.append(name)
for c in (-.4, .4):
    d = np.abs(pal.grade(img, pal.Look(pal.LOOKS["soft_palette"], grain=0, contrast=c)) - np.asarray(jsout[f"soft_palette@{c}"], np.float32).reshape(H, W, 3)).mean() * 255
    print(f"contrast {c}: palette.py and grade.js differ by {d:.2f} levels")
    if d > 3:
        bad.append(f"palette.py and grade.js at contrast {c}")
if bad:
    print("FAIL negative contrast must flatten and positive deepen:", ", ".join(bad))

# your own colours: #rgb is #rrggbb in both (it used to be a ValueError in palette.py, and NaN in grade.js), in any separator the node
# takes, and anything that isn't a colour is an error that names it
hexbad = []
py3 = pal.grade(img, pal.hex_look(["#fff", "#123", "#f80"]))
py6 = pal.grade(img, pal.hex_look(["#ffffff", "#112233", "#ff8800"]))
if not np.array_equal(py3, py6):
    hexbad.append("palette.py: #rgb is not #rrggbb")
if not np.array_equal(np.asarray(jsout["hex3"], np.float32), np.asarray(jsout["hex6"], np.float32)) or not np.isfinite(np.asarray(jsout["hex3"])).all():
    hexbad.append("grade.js: #rgb is not #rrggbb")
d = np.abs(py3 - np.asarray(jsout["hex3"], np.float32).reshape(H, W, 3)).mean() * 255
print(f"custom colours: palette.py and grade.js differ by {d:.2f} levels")
if d > 3:
    hexbad.append("palette.py and grade.js grade custom colours differently")
if pal.split_hex("#fff, #000;#a30  #123") != ["#fff", "#000", "#a30", "#123"] or pal.split_hex("") != [] or pal.split_hex(None) != []:
    hexbad.append("split_hex")
for text in ("#ff", "red", "#12345", "#gggggg"):
    try:
        pal.hex_look(["#000000", text])
        hexbad.append(f"{text!r} was taken as a colour")
    except ValueError as e:
        if repr(text) not in str(e):
            hexbad.append(f"the error for {text!r} doesn't name it: {e}")
if hexbad:
    print("FAIL custom colours:", "; ".join(hexbad))
sys.exit(0 if worst < 3 and not bad and not hexbad else 1)
