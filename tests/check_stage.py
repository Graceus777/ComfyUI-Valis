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

# a second pass at the plate (the biggest thing alone, when the first plate left it standing) keeps what the first pass found:
# the other thing that plate left standing is still not removed
folder2 = os.path.join(root, "stage2")
rng2 = np.random.default_rng(5)
def _thing(y0, y1, x0, x1, z):
    a = np.zeros((H, W, 4), np.float32)
    a[y0:y1, x0:x1, :3] = rng2.uniform(.1, .9, (y1 - y0, x1 - x0, 3)); a[y0:y1, x0:x1, 3] = 1       # textured, so a plate either has it or doesn't
    return a
big, small = _thing(20, 70, 10, 60, 5.), _thing(30, 46, 90, 106, 6.)
hole2 = np.zeros((H, W), bool); hole2[20:70, 10:60] = True; hole2[30:46, 90:106] = True
layers2 = [dict(name="sky", rgba=sky, z=np.full((H, W), 50., np.float32), z_med=50., area=1., bbox=[0, 0, W - 1, H - 1], backdrop=True, hole=hole2),
           dict(name="small", rgba=small, z=np.full((H, W), 6., np.float32), z_med=6., area=.05, bbox=[90, 30, 105, 45], backdrop=False),
           dict(name="big", rgba=big, z=np.full((H, W), 5., np.float32), z_med=5., area=.3, bbox=[10, 20, 59, 69], backdrop=False)]
S.save(folder2, layers2, dict(far=100.0, width=W, height=H), source="t")
meta2 = json.load(open(os.path.join(folder2, "stage.json")))
rgba2 = S.load_layers(folder2, meta2)
still2 = S.composite([{"rgba": x} for x in rgba2])
empty = np.clip(np.full((H, W, 3), .5, np.float32) + rng2.normal(0, .02, (H, W, 3)).astype(np.float32), 0, 1)
S.apply_plate(folder2, meta2, [x.copy() for x in rgba2], still2.copy(), ["big", "small"])                    # the first plate removed nothing
ok(meta2["plate"]["removed"] == [] and sorted(meta2["plate"]["not_removed"]) == ["big", "small"], "stage: a plate that removed nothing says so", meta2.get("plate"))
S.apply_plate(folder2, meta2, [x.copy() for x in rgba2], empty, ["big"], keep_prev=True, image="plate_main.png")   # the main plate removed the big one
ok(meta2["plate"]["removed"] == ["big"], "stage: the second pass removed the biggest", meta2.get("plate"))
ok(meta2["plate"]["not_removed"] == ["small"], "stage: and the thing the first plate left standing is still not removed", meta2.get("plate"))

# erase first: a thing that was erased keeps its layer wherever it stands in the depth order and however big it is. The
# farthest of the things came out as the farthest layer, which is a backdrop, and a backdrop there was thrown away (no layer,
# so no parallax, and the checks still passed)
def _erased_set(kind):
    Hh, Ww = 144, 192
    yy, xx = np.mgrid[0:Hh, 0:Ww]
    still = np.zeros((Hh, Ww, 3), np.float32)
    still[:] = [.45, .6, .85]
    ground = yy > Hh * 0.4
    still[ground] = [.35, .25, .15]
    if kind == "far":                                   # a thin tower, farther than the sky
        thing = (np.abs(xx - Ww * .5) < 6) & (yy > Hh * .12) & (yy < Hh * .38)
        depth = 0.0
    else:                                               # a wall filling nearly half the frame, near
        thing = xx > Ww * .55
        depth = .95
    still[thing] = [.8, .8, .75]
    gone = still.copy()
    gone[thing] = [.45, .6, .85]
    gone[thing & ground] = [.35, .25, .15]

    def near(with_thing):
        n = np.full((Hh, Ww), .05, np.float32)
        n[ground] = .5 + .4 * (yy[ground] - Hh * .4) / (Hh * .6)
        if with_thing:
            n[thing] = depth
        return n
    return S.build_erased(still, near(True), [thing.astype(np.float32)], ["thing"], gone, near(False), [np.zeros((Hh, Ww), np.float32)], ["thing"], far=8.0)


for kind in ("far", "big"):
    lay, info = _erased_set(kind)
    got = [L for L in lay if L["name"] == "thing"]
    ok(len(got) == 1 and not got[0].get("backdrop") and info.get("erased") == ["thing"], f"erase first: the {kind} erased thing keeps its layer, as an object", [(L["name"], L.get("backdrop")) for L in lay])
    ok(len(got) == 1 and float(got[0]["rgba"][..., 3].sum()) > 50, f"erase first: and it has its pixels ({kind})")

# Stage Fill: the painted completion goes where a layer is hidden, and the first frame stays the still. The hole
# includes the sky's own rim round the thing that covers it (so the painter has an edge to paint from); the paint over
# that rim used to be written into the layer as it was, and every occluder edge came back as a magenta fringe in frame 1
def _fill_stage():
    Hf, Wf = 120, 160
    g = np.random.default_rng(2)
    skyl = np.dstack([np.clip(.45 + .1 * g.random((Hf, Wf, 3)), 0, 1).astype(np.float32), np.ones((Hf, Wf), np.float32)])
    fr = np.zeros((Hf, Wf, 4), np.float32); fr[40:90, 60:110, :3] = [.8, .2, .2]; fr[40:90, 60:110, 3] = 1
    box = np.zeros((Hf, Wf), np.uint8); box[40:90, 60:110] = 1
    hl = cv2.dilate(box, np.ones((13, 13), np.uint8)) > 0                      # what's hidden, and a 6 px rim of the sky round it
    ls = [dict(name="sky", rgba=skyl, z=np.full((Hf, Wf), 50., np.float32), z_med=50., area=1., bbox=[0, 0, Wf - 1, Hf - 1], backdrop=True, hole=hl),
          dict(name="front", rgba=fr, z=np.full((Hf, Wf), 5., np.float32), z_med=5., area=.2, bbox=[60, 40, 109, 89], backdrop=False)]
    fo = os.path.join(tempfile.mkdtemp(), "stage")
    S.save(fo, ls, dict(far=100.0, width=Wf, height=Hf), source="t")
    return fo, json.load(open(os.path.join(fo, "stage.json"))), skyl


def _first_frame(fo, mt):
    return S.composite([{"rgba": x} for x in S.load_layers(fo, mt)])


magenta = np.zeros((120, 160, 3), np.float32); magenta[...] = [1, 0, 1]
fo, mt, skyl = _fill_stage()
before = _first_frame(fo, mt)
names = S.apply_fill(fo, mt, [(0, magenta)])
lay = S.load_layers(fo, mt)
change = float(np.abs(_first_frame(fo, mt) - before).max() * 255)
ok(names == ["sky"] and mt["layers"][0].get("painted"), "fill: the sky is painted", names)
ok(change < 1.0, "fill: the first frame is still the still (changed by %.2f levels)" % change, change)
ok(bool((lay[0][65, 85, :3] * 255 > [240, -1, 240]).all() and lay[0][65, 85, 1] * 255 < 15), "fill: the sky is painted where it is hidden", lay[0][65, 85] * 255)
ok(float(np.abs(lay[0][65, 56, :3] - skyl[65, 56, :3]).max() * 255) < 1.0 and float(np.abs(lay[0][20, 20, :3] - skyl[20, 20, :3]).max() * 255) < 1.0,
   "fill: and the sky that shows (its rim round the thing, and far from it) is as it was")
fo2, mt2, _ = _fill_stage()
rest = S.rest_exact
S.rest_exact = lambda *a, **k: set()                    # the control: the same fill without putting the first frame back
try:
    b2 = _first_frame(fo2, mt2)
    S.apply_fill(fo2, mt2, [(0, magenta)])
    loose = float(np.abs(_first_frame(fo2, mt2) - b2).max() * 255)
finally:
    S.rest_exact = rest
ok(loose > 20, "fill: (without it the same paint changes the first frame by %.0f levels along the thing's edge)" % loose, loose)
fo3, mt3, _ = _fill_stage()
half = cv2.resize(magenta, (80, 60), interpolation=cv2.INTER_AREA)
ok(S.apply_fill(fo3, mt3, [(0, half), (1, half)]) == ["sky"], "fill: a picture of another size is fitted, and a layer without a hole is skipped")

print(f"{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
