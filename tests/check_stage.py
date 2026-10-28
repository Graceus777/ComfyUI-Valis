"""A stage folder can come from anywhere: the files stage.json names must be inside that folder (python3 tests/check_stage.py)."""
import json
import os
import sys
import tempfile

import cv2
import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from valis_fx.lib import splat, stage as S  # noqa: E402

passed = failed = 0


def ok(cond, name, detail=""):
    global passed, failed
    if cond:
        passed += 1
    else:
        failed += 1
        print(f"FAIL {name}{': ' + str(detail) if detail not in (None, '') else ''}")


def raises(fn, *a):
    try:
        fn(*a)
    except ValueError as e:
        return "outside the stage's folder" in str(e)
    except Exception as e:  # noqa: BLE001
        return f"wrong error: {e!r}"
    return False


root = tempfile.mkdtemp()
folder = os.path.join(root, "stage")
H, W = 96, 128
rng = np.random.default_rng(1)
sky = np.dstack([np.full((H, W, 3), .5, np.float32) + rng.normal(0, .01, (H, W, 3)).astype(np.float32), np.ones((H, W), np.float32)])
front = np.zeros((H, W, 4), np.float32); front[30:70, 40:90, :3] = [.8, .2, .2]; front[30:70, 40:90, 3] = 1
hole = np.zeros((H, W), bool); hole[30:70, 40:90] = True
layers = [dict(name="sky", rgba=sky, z=np.full((H, W), 50., np.float32), z_med=50., area=1., bbox=[0, 0, W - 1, H - 1], backdrop=True, hole=hole),
          dict(name="front", rgba=front, z=np.full((H, W), 5., np.float32), z_med=5., area=.4, bbox=[40, 30, 89, 69], backdrop=False)]
S.save(folder, layers, dict(far=100.0, width=W, height=H), source="t")
cv2.imwrite(os.path.join(root, "victim.png"), np.full((H, W, 4), 77, np.uint8))     # a picture outside the stage
victim = open(os.path.join(root, "victim.png"), "rb").read()
meta = json.load(open(os.path.join(folder, "stage.json")))

# the names a stage writes itself are fine
for n in ("layer_00.png", "depth_01.png", "hole_00.png", "dome.png", "sub/x.png"):
    ok(os.path.dirname(S.stage_file(folder, n)).startswith(os.path.realpath(folder)), f"stage_file: '{n}' is in the folder")
# and nothing that leaves it
outside = os.path.join(root, "victim.png")
for n in ("../victim.png", "layer_00.png/../../victim.png", "sub/../../victim.png", outside, "", ".", "..", None, 5):
    r = raises(S.stage_file, folder, n)
    ok(r is True, f"stage_file: {n!r} is refused", r)
if os.name == "nt":
    ok(raises(S.stage_file, folder, "C:\\Windows\\win.ini") is True, "stage_file: a drive path is refused")
try:                                                    # a link inside the folder that leads out
    os.symlink(outside, os.path.join(folder, "link.png"))
    ok(raises(S.stage_file, folder, "link.png") is True, "stage_file: a link out of the folder is refused")
except (OSError, NotImplementedError):
    pass

# reading: a crafted stage.json reads nothing outside
bad = json.loads(json.dumps(meta))
bad["layers"][0]["image"] = "../victim.png"
ok(raises(S.load_layers, folder, bad) is True, "stage: load_layers will not read a layer named ../victim.png")
ok(len(S.load_layers(folder, meta)) == 2, "stage: a stage's own layers still load")
ok(raises(splat.layer_points, folder, bad, bad["layers"][0], 1, 100.0) is True, "splat: a layer image outside the folder is refused")
bad2 = json.loads(json.dumps(meta))
bad2["layers"][0]["depth"] = "../victim.png"
ok(raises(splat.layer_points, folder, bad2, bad2["layers"][0], 1, 100.0) is True, "splat: a depth image outside the folder is refused")
bad3 = json.loads(json.dumps(meta))
bad3["layers"][0]["outer"] = "../victim.png"
ok(raises(splat.outer_points, folder, bad3, bad3["layers"][0], 1, 100.0, S.load_layers(folder, meta)[0], np.ones((H, W))) is True, "splat: an outer painting outside the folder is refused")
bad4 = json.loads(json.dumps(meta))
bad4["dome"]["image"] = "../victim.png"
ok(raises(splat.dome_texture, folder, bad4) is True, "splat: a dome image outside the folder is refused")
ok(splat.dome_texture(folder, meta)[0].shape[2] == 3, "splat: the stage's own dome still loads")

# writing: the plate, and the layer pictures it repaints, stay in the folder, and nothing is written when one name is out
plate = np.full((H, W, 3), .5, np.float32)
rgba = S.load_layers(folder, meta)
for key, label in (("image", "a layer image"), ("hole", "a hole image")):
    m = json.loads(json.dumps(meta)); m["layers"][0][key] = "../victim.png"
    before = {f: os.path.getmtime(os.path.join(folder, f)) for f in os.listdir(folder)}
    r = raises(S.apply_plate, folder, m, [x.copy() for x in rgba], plate, ["front"])
    ok(r is True, f"stage: apply_plate refuses {label} outside the folder", r)
    ok(open(os.path.join(root, "victim.png"), "rb").read() == victim, f"stage: apply_plate left the picture outside alone ({label})")
    ok(not os.path.exists(os.path.join(folder, "plate.png")) and before == {f: os.path.getmtime(os.path.join(folder, f)) for f in os.listdir(folder)},
       f"stage: and wrote nothing in the stage ({label})")
ok(raises(S.apply_plate, folder, json.loads(json.dumps(meta)), [x.copy() for x in rgba], plate, ["front"], 0.015, False, "../victim.png") is True, "stage: apply_plate refuses a plate name outside the folder")
names = S.apply_plate(folder, meta, [x.copy() for x in rgba], plate, ["front"])
ok(names == ["front"] and os.path.exists(os.path.join(folder, "plate.png")) and meta["plate"]["painted"] == ["sky"], "stage: apply_plate still paints a stage's own layers", (names, meta.get("plate")))

print(f"{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
