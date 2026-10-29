"""Valis Stage: one still -> named layers, ready for a 2.5D camera.

A still is split by words (SAM 3 masks, one per name) and ordered by monocular depth (Depth Anything 3). Every layer
is completed behind the layers in front of it, so that when the camera moves the revealed pixels are real paint, not
a hole or a rubber sheet. The result is a folder the studio's WebGL stage plays live:

    stage.json            names, depth order, depth range, the source size
    layer_XX.png          RGBA, the layer's own pixels + its completion behind nearer layers
    depth_XX.png          RGB-packed 16-bit depth for the layer (R = high byte, G = low byte), same size

Depth convention: Depth Anything's normalised render is *nearness* (bright = near). It is turned into a distance z in
[1, far] with an inverse-depth model, 1/z = n (1 - 1/far) + 1/far, so the nearest pixel sits at z = 1 and the
farthest at z = far. The browser and any exporter use the same z.

No model runs here: numpy, OpenCV and scipy only.
"""
import json
import os
import re

import cv2
import numpy as np
from scipy import ndimage as ndi

PLATE = "the rest"
PLATE_FAR = "the rest, farther back"
SKY = re.compile(r"\b(sky|skies|heaven|heavens|night sky|clouds? and sky)\b", re.I)
# a moon, a sun, a planet: depth maps read a bright disc as near, and on a move it slid across the sky like a lamp.
# Such a thing is as far as the sky (just in front of it).
CELESTIAL = re.compile(r"\b(moons?|suns?|planets?|comets?|galax(?:y|ies)|nebulae?)\b", re.I)
# soft, see-through things in front of the scenery: erased and put back as cutouts even where they leave the frame
GAS = re.compile(r"\b(smoke|steam|vapou?r|mist|fog|haze|dust|plume|exhaust|fire|flames?|embers|sparks)\b", re.I)


def _replay_dir():
    try:
        import folder_paths
        return os.path.join(folder_paths.get_output_directory(), "valis", "stage", "_replay")
    except Exception:
        return None


def dump(tag, folder=None, **kw):
    """Keep a node's inputs (8-bit images, 1-bit masks, float16 depth, JSON for the rest), so a stage can be rebuilt
    and its checks re-run offline after a stage.py change, without the GPU. Lists of masks may hold None. Returns the
    path, or None (outside ComfyUI, or on any error: a dump must never break a run)."""
    try:
        folder = folder or _replay_dir()
        if not folder:
            return None
        import time
        os.makedirs(folder, exist_ok=True)
        arr, js = {}, {}
        for k, v in kw.items():
            if isinstance(v, np.ndarray):
                arr[k] = _pack_arr(v)
            elif isinstance(v, (list, tuple)) and any(isinstance(x, np.ndarray) for x in v):
                js[k + "__n"] = len(v)
                for i, x in enumerate(v):
                    if x is not None:
                        arr[f"{k}__{i}"] = _pack_arr(np.asarray(x))
            else:
                js[k] = v
        path = os.path.join(folder, f"{tag}_{time.strftime('%Y%m%d_%H%M%S')}.npz")
        np.savez_compressed(path, __json__=np.frombuffer(json.dumps(js, default=str).encode(), np.uint8), **arr)
        if folder == _replay_dir():                    # the shared folder keeps the last few of each kind (~10-25 MB each)
            old = sorted(f for f in os.listdir(folder) if f.startswith(tag + "_2") and f.endswith(".npz"))
            for f in old[:-6]:
                try:
                    os.remove(os.path.join(folder, f))
                except OSError:
                    pass
        return path
    except Exception as e:
        print(f"[valis] could not keep the inputs for replay: {e}")
        return None


def _pack_arr(v):
    v = np.asarray(v)
    if v.dtype == bool:
        return v
    if v.ndim == 3 and v.shape[-1] in (3, 4):                  # an image in [0, 1]
        return np.clip(v * 255 + .5, 0, 255).astype(np.uint8)
    if v.ndim == 2 and v.min() >= 0 and v.max() <= 1 and np.isin(np.unique(v[::7, ::7]), (0, 1)).all():
        return v > 0.5                                         # a mask
    return v.astype(np.float16)                                # depth


def load_dump(path):
    """the inputs `dump` kept, as the node passed them (images back to float [0, 1], masks to float 0/1)"""
    z = np.load(path)
    js = json.loads(bytes(z["__json__"]).decode())
    out = {k: v for k, v in js.items() if not k.endswith("__n")}

    def un(v):
        if v.dtype == np.uint8:
            return v.astype(np.float32) / 255
        return v.astype(np.float32)
    for k in z.files:
        if k == "__json__" or "__" in k:
            continue
        out[k] = un(z[k])
    for k, n in js.items():
        if k.endswith("__n"):
            base = k[:-3]
            out[base] = [un(z[f"{base}__{i}"]) if f"{base}__{i}" in z.files else None for i in range(n)]
    return out


def nearness_to_z(n, far):
    n = np.clip(n, 0.0, 1.0)
    return 1.0 / (1.0 / far + n * (1.0 - 1.0 / far))


def _orient(nearness):
    """Depth renders are bright = near; if the bottom of the frame comes out darker than the top, flip it."""
    h = nearness.shape[0]
    k = max(1, h // 10)
    return 1.0 - nearness if nearness[-k:].mean() < nearness[:k].mean() else nearness


def _fill_colour(rgb, known, todo):
    """Fill `todo` pixels of rgb from `known` ones. Multi-scale Telea: coarse levels carry colour into big holes, the
    full-res pass keeps edges crisp."""
    out = rgb.copy()
    hole = (todo & ~known).astype(np.uint8)
    if not hole.any():
        return out
    img8 = np.clip(out * 255, 0, 255).astype(np.uint8)
    unknown = (~known).astype(np.uint8)
    # coarse: 1/4 res inpaint over everything unknown, upsampled as a base under the holes
    h, w = unknown.shape
    sc = 4
    small = cv2.resize(img8, (w // sc, h // sc), interpolation=cv2.INTER_AREA)
    um = cv2.resize(unknown, (w // sc, h // sc), interpolation=cv2.INTER_NEAREST)
    um = cv2.dilate(um, np.ones((3, 3), np.uint8))
    base = cv2.inpaint(small, um, 6, cv2.INPAINT_TELEA)
    base = cv2.resize(base, (w, h), interpolation=cv2.INTER_CUBIC)
    seeded = np.where(unknown[..., None] > 0, base, img8)
    # fine: a thin full-res band at the hole edge, so the seam matches the paint
    band = (cv2.dilate(known.astype(np.uint8), np.ones((9, 9), np.uint8)) & unknown).astype(np.uint8)
    fine = cv2.inpaint(seeded, band, 4, cv2.INPAINT_TELEA)
    res = fine.astype(np.float32) / 255.0
    # Telea carries colour but smears: put the paint's own texture back. The high-pass detail of the known pixels is
    # mirrored across the hole's edge (src = 2 * nearest_known - p) and added onto the smooth fill, fading with depth.
    src = rgb.astype(np.float32)
    hp = np.clip(src - cv2.GaussianBlur(src, (0, 0), 3.0), -0.07, 0.07)     # texture, not edges: big steps are clipped
    # the texture source stays clear of the hole's rim, where the covering object's edge has bled into the paint
    tex_known = cv2.erode(known.astype(np.uint8), np.ones((9, 9), np.uint8)).astype(bool)
    if tex_known.sum() < 64:
        tex_known = known
    d, idx = ndi.distance_transform_edt(~tex_known, return_indices=True)
    yy, xx = np.nonzero(hole)
    ny, nx = idx[0][yy, xx], idx[1][yy, xx]
    ry, rx = np.clip(2 * ny - yy, 0, h - 1), np.clip(2 * nx - xx, 0, w - 1)
    ok = tex_known[ry, rx]
    ry, rx = np.where(ok, ry, ny), np.where(ok, rx, nx)
    fade = np.clip(1.2 - d[yy, xx] / (0.06 * w), 0.35, 1.0)[:, None]
    res = cv2.GaussianBlur(res, (0, 0), 1.5)
    out[yy, xx] = np.clip(res[yy, xx] + hp[ry, rx] * fade, 0, 1)
    return out


def _fill_nearest(values, known):
    """Each unknown pixel takes the value of the nearest known pixel (for depth behind a layer)."""
    if known.all():
        return values.copy()
    idx = ndi.distance_transform_edt(~known, return_distances=False, return_indices=True)
    return values[idx[0], idx[1]]


def _pushpull(val, w, smooth=0.01):
    """Fill val where w == 0 from where w > 0: a masked image pyramid (push: weighted averages down to a few px; pull:
    each level blended over the upsampled coarser one), then a soft relaxation of the filled pixels only. Smooth and
    seam-free (unlike nearest-pixel, which leaves Voronoi facets that tear when the camera moves)."""
    w = w.astype(np.float32)
    v = (val * w).astype(np.float32)
    levels = []
    while min(v.shape) > 6:
        levels.append((v, w))
        sz = (max(1, v.shape[1] // 2), max(1, v.shape[0] // 2))
        v, w = cv2.resize(v, sz, interpolation=cv2.INTER_AREA), cv2.resize(w, sz, interpolation=cv2.INTER_AREA)
    est = v / np.maximum(w, 1e-6)
    if (w <= 1e-6).any():
        est[w <= 1e-6] = float(v.sum() / max(w.sum(), 1e-6))
    for v, w in reversed(levels):
        up = cv2.resize(est, (v.shape[1], v.shape[0]), interpolation=cv2.INTER_LINEAR)
        a = np.clip(w * 2.0, 0, 1)
        est = a * (v / np.maximum(w, 1e-6)) + (1 - a) * up
    free = levels[0][1] < 0.5 if levels else np.zeros(est.shape, bool)
    fixed = est.copy()
    s = max(1.0, smooth * est.shape[1])
    for _ in range(3):
        est = np.where(free, cv2.GaussianBlur(est, (0, 0), s), fixed)
    return est


def _fill_behind(z, zk, covered, zocc, w, zmed, reach=0.03, margin=1.08):
    """Depth of a backdrop where something nearer covers it. What is behind an object is farther than the object, so
    the fill (1) ignores the backdrop's own pixels right at the object that are no farther than the object itself
    (the floor at a man's feet, the ground under a table: interpolating from those stands a slab of near floor up
    behind him, which tears open when the camera moves), (2) interpolates smoothly in inverse depth (planes stay
    planes) from the rest, and (3) never comes nearer than the object in front."""
    hole = ~zk
    if not hole.any():
        return z.copy()
    # the occluder depth at the nearest covered pixel, for every known pixel near the covered region
    # only for objects really in front of this layer: a lantern on a wall that depth puts behind the wall (and that
    # is drawn in front only because its mask sits inside the wall's) must not dent the wall behind it
    front = covered & (zocc < zmed)
    if not front.any():
        front = np.zeros_like(covered)
    d, idx = ndi.distance_transform_edt(~front, return_indices=True)
    near_occ = zocc[idx[0], idx[1]]
    unreliable = zk & front.any() & (d <= reach * w) & (z <= near_occ * margin)
    src = zk & ~unreliable
    if src.sum() < 64:
        src = zk
    disp = _pushpull(np.where(src, 1.0 / z, 0.0), src)
    zf = 1.0 / np.maximum(disp, 1e-6)
    zf = np.where(front, np.maximum(zf, zocc * 1.05), zf)
    return np.where(zk, z, zf).astype(np.float32)


def _part_depths(zl, own, support, li, owner, z, zmed, is_bd, lum, core=None, relief=0.35, spread=0.12, min_px=64, gap=0.03, ring=0.008):
    """Depth per part of one object layer, so each part moves right when the camera does. Two naive rules:
    - One name can find several things at clearly different depths ("the lanterns": one in a hand, one on a tower).
      Each part is flattened toward its own median instead of the layer's.
    - A light (a part whose brightest tenth is near white) touching a bigger, nearer object is attached to it (a
      lantern in a hand, a torch on a wall bracket): monocular depth reads glowing things as far away, and they
      would float off what holds them on a move. Such a part takes the holder's depth (as drawn) where they touch. Only lights:
      an arch behind a man touches him too, and must stay behind.
    Returns (z, 1.0) with the flattening already done (draw with relief 1), or None when one median is fine."""
    h, w = own.shape
    r = max(1, int(round(gap * w / 2)))
    near = cv2.dilate(own.astype(np.uint8), cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r + 1, 2 * r + 1))) > 0
    lab, n = ndi.label(near)                       # parts closer than `gap` are one thing cut by something in front
    lab = np.where(own, lab, 0)
    sizes = ndi.sum(np.ones_like(zl), lab, index=np.arange(1, n + 1)) if n else []
    parts = [i + 1 for i in range(n) if sizes[i] >= min_px]
    if not parts:
        return None
    area = np.bincount(owner.ravel(), minlength=len(zmed))
    rr = max(2, int(round(ring * w)))
    kern = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * rr + 1, 2 * rr + 1))
    med, target = {}, {}
    for k in parts:
        pk = lab == k
        med[k] = target[k] = float(np.median(zl[pk]))
        pc = pk & core if core is not None and (pk & core).sum() >= 16 else pk
        if np.percentile(lum[pc], 90) < 0.9:      # judged on SAM's own pixels, not the grown halo
            continue
        rim = (cv2.dilate(pk.astype(np.uint8), kern) > 0) & ~own
        if rim.sum() < 8:
            continue
        o = owner[rim]
        best, cnt = None, 0
        for j in np.unique(o):
            if j == li or j < 0 or area[j] < 2 * pk.sum() or zmed[j] >= med[k] * 0.9:     # a wall holds its lamps too
                continue
            c = int((o == j).sum())
            if c > cnt:
                best, cnt = int(j), c
        if best is not None and cnt >= 0.15 * rim.sum():
            target[k] = float(np.median(z[rim & (owner == best)]))
    moved = any(abs(target[k] - med[k]) / med[k] > 0.05 for k in parts)
    split = len(parts) >= 2 and (max(med.values()) - min(med.values())) / min(med.values()) >= spread
    if not (moved or split):
        return None
    seeds = np.isin(lab, parts)
    idx = ndi.distance_transform_edt(~seeds, return_distances=False, return_indices=True)
    part = lab[idx[0], idx[1]]                     # every pixel of the layer joins its nearest part
    lut_m, lut_t = np.zeros(n + 1, np.float32), np.zeros(n + 1, np.float32)
    for k in parts:
        lut_m[k], lut_t[k] = med[k], target[k]
    return np.where(support, lut_t[part] + (zl - lut_m[part]) * relief, zl).astype(np.float32), 1.0


def build(image, nearness, masks, names, far=6.0, threshold=0.5, edge=1.5, min_area=0.0003, band=0.025, backdrop_area=0.35, paint_band=0.09, grow=0.003,
          z_override=None, exact=True, checks=True, never_backdrop=()):
    """image HxWx3 float [0,1]; nearness HxW float [0,1] (bright = near); masks: list of HxW float (one per name).
    never_backdrop: names that are objects whatever their depth or size (the things of an erase-first set: the farthest of
    them is the farthest layer, which would have made it a backdrop, and a backdrop there is thrown away).

    Returns (layers, info). layers: list far -> near of dicts {name, rgba HxWx4, z HxW, z_med, area, bbox}.
    The last plate, "the rest", is everything no name claimed."""
    h, w = image.shape[:2]
    if z_override is not None:                   # depth already in this stage's terms (the things of an erased set)
        z = z_override.astype(np.float32).copy()
    else:
        z = nearness_to_z(_near01(nearness, w, h), far).astype(np.float32)

    # one binary mask per name. Naive checks, so a bad name costs nothing but a note:
    #   nothing found / the whole picture ("the city" over a city) / the same thing as an earlier name
    cand, dropped, cores, grows, warnings = [], [], [], [], []
    lum = image[..., :3].astype(np.float32) @ np.array([0.3, 0.59, 0.11], np.float32)
    for name, m in zip(names, masks):
        m = cv2.resize(m.astype(np.float32), (w, h), interpolation=cv2.INTER_LINEAR) > threshold
        if m.mean() < min_area:
            dropped.append({"name": name, "why": "SAM 3 found nothing by that name"})
            continue
        if m.mean() > .85:
            dropped.append({"name": name, "why": f"matched {round(100 * float(m.mean()))}% of the picture: name one thing in it, like \"the rock in front\"",
                            "area": round(float(m.mean()), 3)})
            continue
        dup = next((c for c, cm in cand if (m & cm).sum() / max(1, (m | cm).sum()) > .8), None)
        if dup:
            dropped.append({"name": name, "why": f"found the same thing as {dup}"})
            continue
        m0 = m
        warn = broad_name(name, m, z, far)
        if warn:
            warnings.append(warn)
        # a light (its brightest tenth near white: a moon, a lantern, a fire) carries a halo well past SAM's edge; left
        # behind in the backdrop it shows as a second, ghost glow once the light moves. Lights take 4x the fringe.
        gk = grow * (4 if np.percentile(lum[m], 90) > 0.9 else 1)
        grows.append(gk)
        if gk > 0:        # SAM's edge stops short of a soft fringe (a cloud's wisp, a flame's glow): take it along,
            g = max(1, int(round(gk * w)))       # but feathered (see the alpha below), so it never reads as a cut-out ring
            m = cv2.dilate(m.astype(np.uint8), cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * g + 1, 2 * g + 1))) > 0
        cand.append((name, m))
        cores.append(m0)
    # draw order far -> near by each mask's median depth, then a mask that sits mostly inside a bigger one (the moon
    # in the sky, a lamp on the path) goes just in front of it: depth maps barely separate them
    meds = [float(np.median(z[c])) for c in cores]       # SAM's own mask: the grown fringe is the background's depth
    # monocular depth is unreliable on sky (Depth Anything often puts it mid-scene): a sky is the farthest thing
    for i, (name, m) in enumerate(cand):
        if SKY.search(name):
            # only where the sky is the sky: its grown fringe (and SAM's own edge) overlaps the things in front of it,
            # and a lighthouse's rim forced to the sky's depth came out as a ghost outline far behind it on a move
            others = np.zeros_like(m)
            for j, cj in enumerate(cores):
                if j != i and not SKY.search(cand[j][0]):
                    others |= cv2.dilate(cj.astype(np.uint8), np.ones((5, 5), np.uint8)) > 0
            z[cores[i] & ~others] = far
            meds[i] = far
        elif CELESTIAL.search(name):
            z[cores[i]] = far * 0.97
            meds[i] = far * 0.97
    def order():
        areas = [float(c.sum()) for c in cores]
        seq = sorted(range(len(cand)), key=lambda i: -meds[i])
        for _ in range(len(cand) ** 2):
            moved = False
            for a in range(len(cand)):
                for b in range(len(cand)):
                    if a == b or areas[a] >= areas[b]:
                        continue
                    inside = float((cores[a] & cand[b][1]).sum()) / max(1.0, areas[a])
                    if inside >= .6 and seq.index(a) < seq.index(b):
                        seq.remove(a)
                        seq.insert(seq.index(b) + 1, a)
                        moved = True
            if not moved:
                break
        # exclusive ownership follows the draw order: nearer layers win overlaps
        owner = np.full((h, w), -1, np.int32)
        for i in seq:
            owner[cand[i][1]] = i
        # a grown fringe is for what lies behind a thing (a cloud's wisp over the sky, a lantern's glow on a wall), not
        # for what stands in front of it: where depth says the fringe is nearer than the thing (the ridge in front of
        # the mesas' plain), it goes back to the rest. It used to fade out there, and a move showed the sky through it
        # as a pale line along the ridge.
        # Not for a sky, a moon or a light's halo: their fringe lies over the sky, where the depth map means nothing
        # (the moons' halos went to the rest and rode the ground across the sky as blue rings).
        for i in seq:
            if SKY.search(cand[i][0]) or CELESTIAL.search(cand[i][0]) or grows[i] > grow * 1.5:
                continue
            ring = (owner == i) & ~cores[i]
            if ring.any():
                owner[ring & (z < meds[i] * 0.92)] = -1
        return areas, seq, owner
    areas, seq, owner = order()
    rest = owner < 0
    farm = _rest_far(z, rest, w)
    if farm is not None:                         # the rest is two surfaces: the farther one becomes a layer of its own
        cand.append((PLATE_FAR, farm)); cores.append(farm); grows.append(0.0); meds.append(float(np.median(z[farm])))
        areas, seq, owner = order()
        rest = owner < 0
    # the rest is one more layer with per-pixel depth; it slots into the order by its median
    plate_i = len(cand)
    owner[rest] = plate_i
    owner = _despeckle(owner, max(64, int(round(0.0002 * h * w))))
    allnames = [c[0] for c in cand] + [PLATE]
    zmed = meds + [float(np.median(z[rest])) if rest.any() else far]
    pos = 0
    while pos < len(seq) and meds[seq[pos]] >= zmed[plate_i]:
        pos += 1
    seq.insert(pos, plate_i)
    rank = {li: r for r, li in enumerate(seq)}   # 0 = farthest
    rank_map = np.array([rank[i] for i in range(len(allnames))])[owner]

    # completion behind nearer layers. A backdrop (big, or the farthest) is completed everywhere it is the nearest thing
    # behind: it must never show a hole. An object (the temple, a lamp) only gets a band as wide as the camera can
    # reveal: we don't know its hidden shape, and a lamp must not grow into a blob behind the ground.
    band_px = band * w
    # a backdrop: the farthest layer, the rest, a sky, or something filling much of the frame (not a big person)
    is_bd = {li: allnames[li] not in never_backdrop and (r == 0 or li == plate_i or allnames[li] == PLATE_FAR or bool(SKY.search(allnames[li]))
                                                         or (owner == li).mean() >= backdrop_area) for r, li in enumerate(seq)}
    # the depth each pixel's owner is drawn at (objects are flattened toward their median, as the studio draws them)
    zmed_a = np.array(zmed, np.float32)[owner]
    relief_a = np.array([1.0 if is_bd[i] else 0.35 for i in range(len(allnames))], np.float32)[owner]
    z_drawn = zmed_a + (z - zmed_a) * relief_a
    layers = []
    for r, li in enumerate(seq):
        own = owner == li
        backdrop = is_bd[li]
        holes = rank_map > r                     # covered by something nearer
        if holes.any():
            idx = ndi.distance_transform_edt(holes, return_distances=False, return_indices=True)
            nearest_owner = owner[idx[0], idx[1]]
            ext = holes & (nearest_owner == li)
            if not backdrop:
                ext &= ndi.distance_transform_edt(~own) <= band_px
        else:
            ext = np.zeros_like(own)
        support = own | ext
        if not own.any():
            continue
        # colour: own pixels (eroded a hair, edge pixels are mixed with the neighbour's paint) + completion
        # a backdrop's paint next to a covering object carries that object's glow and edge: take it from a little farther out
        k = int(round((0.008 if backdrop else 0.0023) * w)) | 1     # ~11 / 3 px at 1344 wide: the bleed scales with resolution
        known = cv2.erode(own.astype(np.uint8), np.ones((k, k), np.uint8)).astype(bool)
        if known.sum() < 16:
            known = own
        rgb = _fill_colour(image.astype(np.float32), known, support)
        # depth comes from SAM's own core only: the grown fringe carries the background's depth, and a depth step
        # inside one layer is a torn edge when the camera moves
        zk = zk_in = known
        if li < len(cores) and not backdrop:
            def core_at(kz):
                c = cv2.erode(cores[li].astype(np.uint8), np.ones((kz, kz), np.uint8)).astype(bool) & known
                if not SKY.search(allnames[li]):
                    c &= z < far * 0.999               # never the sky's forced depth on a thing in front of it
                return c
            zk = core_at(5)
            if zk.sum() < 16:
                zk = known
            # the depth map is soft at a thing's outline: its outer few pixels carry the background's depth (a
            # lighthouse's rim read 1.52 against its 1.47), and on a turn that rim slid off the tower as a pale smear.
            # So a thing's depth is read well inside its outline (the bleed scales with resolution) and carried out.
            zk_in = core_at(max(5, int(round(0.006 * w)) | 1))
            if zk_in.sum() < 16:
                zk_in = zk
        relief = None
        if backdrop:
            zl = _fill_behind(z, zk, holes, z_drawn, w, zmed[li])
        else:
            zl = _fill_nearest(np.where(zk, z, 0), zk)
            if zk_in is not zk:
                zi = _fill_nearest(np.where(zk_in, z, 0), zk_in)
                # unless that is another depth entirely: a thin part (a railing, a strip of sea between rocks) has no
                # inside, and the nearest inside is somewhere else; a bleed is a few percent
                thin = np.abs(zi - zl) > 0.08 * zl
                zl = np.where(thin, zl, zi)
                zk = zk_in | (zk & thin)                   # read as is (not blurred below)
            zl = cv2.GaussianBlur(zl, (0, 0), 2.0) * (~zk) + zl * zk
            parts = _part_depths(zl, own, own | ext, li, owner, z_drawn, zmed, is_bd, lum, cores[li] if li < len(cores) else None)
            if parts is not None:
                zl, relief = parts
        # no triangle of this layer may tear at rest (see _tame_depth): the depth as the studio draws it, made gentle
        rel = 1.0 if backdrop else (relief if relief is not None else 0.35)       # 0.35: the studio's default for a thing
        if rel > 1e-3:
            zd = _tame_depth(zmed[li] + (zl - zmed[li]) * rel)
            zl = (zmed[li] + (zd - zmed[li]) / rel).astype(np.float32)
        # alpha: soft at the outer edge of the support only
        a = support.astype(np.float32)
        if edge > 0:
            a = cv2.GaussianBlur(a, (0, 0), edge)
            a = np.where(support, np.maximum(a, (cv2.erode(support.astype(np.uint8), np.ones((3, 3), np.uint8)) > 0)), a)
        if not backdrop:
            dd = ndi.distance_transform_edt(~own)
            if ext.any():
                # an object's completion behind what covers it is a guess (a smear of its own paint): it fades out over
                # the band instead of ending solid, so a big move reveals the backdrop behind it, not a pale blob
                # (solid for the first 40% of the band, where it is most likely right: the plain behind a ridge's edge)
                a[ext] *= np.clip((band_px - dd[ext]) / (0.6 * band_px), 0, 1) ** 1.5
            # the soft edge is for the object's own outline only: the blur also left a faint rim along the end of the
            # completion band, in whatever the still had there (a lighthouse's bright edge), which a big move showed as
            # a ghost outline
            a[~support & (dd > 2.5)] = 0
        if li < len(cores) and grow > 0 and not backdrop:
            # the grown fringe fades out from SAM's own edge, where it isn't covered by something nearer, and not next
            # to something nearer either: there it is an occlusion edge, not a wisp (the mesas' plain under the ridge's
            # soft edge faded to 0.89, and a move showed the sky through the gap as a pale line along the ridge)
            gpx = int(round(grows[li] * w)) + 2
            nearer = cv2.dilate((rank_map > r).astype(np.uint8), cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * gpx + 1, 2 * gpx + 1))) > 0
            ring = own & ~cores[li] & ~ext & ~nearer
            if ring.any():
                d0 = ndi.distance_transform_edt(~cores[li])
                a[ring] = np.minimum(a[ring], np.clip(1.0 - d0[ring] / (grows[li] * w + 1), 0, 1))
        ys, xs = np.nonzero(own)
        # what an image model should paint properly: the completion near the layer's own pixels (deep inside a big
        # hole, e.g. the sky far below the horizon, nothing is ever revealed)
        hole = support & ~known
        if backdrop and hole.any():
            hole &= ndi.distance_transform_edt(~own) <= paint_band * w
        layers.append({"name": allnames[li], "rgba": np.dstack([rgb, a]).astype(np.float32), "z": zl.astype(np.float32),
                       "z_med": zmed[li], "area": float(own.mean()), "backdrop": bool(backdrop), "hole": hole, "relief": relief,
                       "bbox": [int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())]})
    info = {"width": w, "height": h, "far": far, "border": _border(z), "dropped": dropped, "warnings": warnings}
    if exact:
        rest_exact([L["rgba"] for L in layers], image[..., :3].astype(np.float32))
    if checks:
        info["checks"] = scorecard(layers, image[..., :3].astype(np.float32), info)
    return layers, info


def _rest_far(z, rest, w, jump=0.08, min_part=0.02):
    """The rest is everything no name claimed, and it can be two surfaces: a ridge and the plain behind it (SAM 3 read
    "the red desert ridge" as the whole desert, in the still and in the erased picture). The studio drops a triangle
    across a depth jump inside one layer, and through that tear a move showed the sky's paint under the horizon: a pale
    line along the ridge. So the rest is cut at its biggest depth step (the jump the studio tears at, over a few px):
    returns the farther part (drawn and completed behind the nearer part, as any backdrop), or None when the rest is
    one surface."""
    if rest.mean() < 2 * min_part:
        return None
    lz = np.log(np.maximum(z, 1e-3)).astype(np.float32)
    k = max(3, int(round(0.002 * w)) | 1)
    ker = np.ones((k, k), np.uint8)
    hi = cv2.dilate(np.where(rest, lz, -10.0).astype(np.float32), ker)
    lo = cv2.erode(np.where(rest, lz, 10.0).astype(np.float32), ker)
    inner = cv2.erode(rest.astype(np.uint8), ker) > 0
    step = inner & (hi - lo > np.log1p(jump))
    if step.sum() < 0.05 * w:
        return None
    t = float(np.median(0.5 * (hi[step] + lo[step])))
    farm = rest & (lz > t)
    farm = cv2.morphologyEx(farm.astype(np.uint8), cv2.MORPH_OPEN, ker) > 0
    nearm = rest & ~farm
    if farm.mean() < min_part or nearm.mean() < min_part:
        return None
    if np.median(z[farm]) < np.median(z[nearm]) * (1 + jump):
        return None
    return farm


def _despeckle(owner, min_px):
    """A layer's pixels come from a mask (SAM's, or what no mask claimed), and a mask leaves crumbs: a few dozen pixels
    of the rest inside the farther plate, a flake of an object's edge out in the sky. Each is a card of its own at its
    own depth, so on a move it floats off the paint around it as a dash or a pale blob. An island smaller than `min_px`
    goes to the layer all round it (a layer's biggest piece always stays: a thing that is small is still a thing).
    At rest nothing changes: the paint under it is the still's, whichever layer holds it."""
    out = owner.copy()
    h, w = owner.shape
    eight = np.ones((3, 3), np.uint8)
    for li in np.unique(owner):
        lab, n = ndi.label(owner == li, structure=eight)
        if n <= 1:
            continue
        size = np.bincount(lab.ravel())[1:]
        big = int(np.argmax(size)) + 1
        for j, sl in enumerate(ndi.find_objects(lab), 1):
            if j == big or size[j - 1] >= min_px:
                continue
            y0, y1, x0, x1 = max(sl[0].start - 2, 0), min(sl[0].stop + 2, h), max(sl[1].start - 2, 0), min(sl[1].stop + 2, w)
            m = lab[y0:y1, x0:x1] == j
            ring = (cv2.dilate(m.astype(np.uint8), eight) > 0) & ~m
            around = owner[y0:y1, x0:x1][ring]
            if around.size:
                out[y0:y1, x0:x1][m] = np.bincount(around).argmax()
    return out


def _lower_envelope(f, a):
    """min over q of f(q) + a * |p - q|_1: the largest function under f that changes by at most `a` per pixel along each
    axis. The city-block metric separates, so it is two scans per axis."""
    g = np.array(f, np.float32, copy=True)
    for _ in (0, 1):
        for i in range(1, g.shape[0]):
            np.minimum(g[i], g[i - 1] + a, out=g[i])
        for i in range(g.shape[0] - 2, -1, -1):
            np.minimum(g[i], g[i + 1] + a, out=g[i])
        g = np.ascontiguousarray(g.T)
    return g


def _tame_depth(zd, out_h=720, step=4, tear=0.08, margin=0.9):
    """The studio drops a triangle where fwidth(z) / z passes `tear` (u_tear in stage3d.js), so the layer behind shows
    through it. The mesh has a vertex every `step` px, so a depth that changes by more than about tear * step * out_h / h
    between two neighbours is dropped, and that happens at rest, in the very first frame, wherever the depth map has a
    steep step inside one layer (a castle's roofline, a crease in the mist): the exported move showed it as dashes and
    hairlines the still never had. Here the depth is made to change by at most that much per vertex step, in every
    direction, and no more: the mean of the lower and the upper envelope of its log, which leaves a depth that is already
    gentle alone and turns a steep step into a ramp centred on it (a rubber sheet, as moves show it, instead of a hole).
    `zd` is the depth as drawn (z_med + (z - z_med) * relief). `out_h` is the preview's height: smaller than an
    export, so a depth tame for the preview is tame for every size.
    Returns zd, changed only where it was steeper than that."""
    h = zd.shape[0]
    lz = np.log(np.maximum(zd, 1e-3)).astype(np.float32)
    a = np.float32(tear * margin * out_h / (2.0 * h))             # per px, along each axis: step px later it is at most half a triangle's allowance
    lo = _lower_envelope(lz, a)
    hi = -_lower_envelope(-lz, a)
    return np.exp((lo + hi) * 0.5).astype(np.float32)


def _near01(nearness, w, h):
    """a depth render as nearness in [0, 1] at the still's size (bright = near), as build reads it"""
    near = _orient(cv2.resize(nearness.astype(np.float32), (w, h), interpolation=cv2.INTER_LINEAR))
    return (near - near.min()) / max(1e-6, near.max() - near.min())


def _border(z):
    """depth along the still's border (nearest in each of 32 segments): the studio frames every camera move with it"""
    h, w = z.shape
    def seg_min(a, n=32):
        return [round(float(x.min()), 4) for x in np.array_split(a, n)]
    edge_px = max(2, w // 200)
    return {"top": seg_min(z[:edge_px].min(0)), "bottom": seg_min(z[-edge_px:].min(0)),
            "left": seg_min(z[:, :edge_px].min(1)), "right": seg_min(z[:, -edge_px:].min(1))}


DOME = {"yaw": 80.0, "pitch": 60.0, "step": 0.4, "fov": 50.0}
DOME_PAINTED_STEP = 0.2          # degrees a texel when the world past the frame is painted (800 x 600)


def dome_map(still, back, fov=50.0, step=0.3, yaw=80.0, pitch=60.0, surround=None, rect=None):
    """The world past the frame, as an angular map around the original camera (yaw x pitch, `step` degrees a texel;
    row 0 is the top). Inside the frame: the still. Outside: by default
    the still mirrored across its own edge, blurred more and more with distance and fading to the rim's average
    colour, so a camera that moves past the edge sees the set's air and light go on instead of a void (naive, like a
    blurred letterbox fill). With `surround` (the still painted out past its edges, e.g. by an outpainting model, with
    the still sitting at `rect` = x, y, w, h inside it), the painted world is used out to the canvas edge, and only
    past that does the blur take over."""
    H, W = still.shape[:2]
    f0 = (W / 2) / np.tan(np.radians(fov / 2))
    nx, ny = int(round(2 * yaw / step)), int(round(2 * pitch / step))
    ya = np.radians(np.linspace(-yaw, yaw, nx))[None, :].repeat(ny, 0)
    pa = np.radians(np.linspace(pitch, -pitch, ny))[:, None].repeat(nx, 1)
    tx, ty = np.tan(ya), np.tan(pa) / np.cos(ya)          # pinhole coordinates of each texel's ray
    u = (W / 2 + f0 * tx - 0.5).astype(np.float32)
    v = (H / 2 - f0 * ty - 0.5).astype(np.float32)
    inside = (u >= 0) & (u <= W - 1) & (v >= 0) & (v <= H - 1)
    # inside the frame the dome is the still itself (blurred to the texel size): a set fading out at its edge then
    # fades into the same colours, and the dome runs on seamlessly past the edge. (The farthest backdrop alone, e.g.
    # the sky, put a band of sky colour along the bottom of a shot when its rocks faded into it.)
    px = f0 * np.radians(step)                    # still pixels a texel spans: pre-blur so nothing aliases
    ins = cv2.remap(cv2.GaussianBlur(still.astype(np.float32), (0, 0), px / 2), u, v, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
    if surround is not None:
        Hc, Wc = surround.shape[:2]
        x0, y0, rw, rh = rect
        sc = rw / W                                # canvas px per still px
        src = surround.astype(np.float32)
        su = (x0 + rw / 2 + f0 * sc * tx - 0.5).astype(np.float32)
        sv = (y0 + rh / 2 - f0 * sc * ty - 0.5).astype(np.float32)
        region = (su >= 0) & (su <= Wc - 1) & (sv >= 0) & (sv <= Hc - 1) & (np.abs(ya) < np.radians(85))
        spx = px * sc
    else:
        src, su, sv, region, spx = still.astype(np.float32), u, v, inside, px
    ext = cv2.remap(cv2.GaussianBlur(src, (0, 0), max(0.5, spx / 2)), su, sv, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT_101)
    dist = ndi.distance_transform_edt(~region) if (~region).any() else np.zeros(region.shape)
    levels = np.stack([ext] + [cv2.GaussianBlur(ext, (0, 0), sg) for sg in (2, 4, 8, 16, 32)])
    lv = np.clip(np.log2(np.maximum(dist, 1) / 1.5), 0, len(levels) - 1)
    lv[dist == 0] = 0
    i0 = np.floor(lv).astype(int); fr = (lv - i0)[..., None]; i1 = np.minimum(i0 + 1, len(levels) - 1)
    yy, xx = np.mgrid[0:ny, 0:nx]
    blurred = levels[i0, yy, xx] * (1 - fr) + levels[i1, yy, xx] * fr
    rim = np.concatenate([src[0], src[-1], src[:, 0], src[:, -1]])
    ambient = rim.mean(0) * 0.6
    fade = np.clip(dist / (0.35 * nx), 0, 1)[..., None] ** 1.5
    return np.clip(np.where(inside[..., None], ins, blurred * (1 - fade) + ambient * fade), 0, 1).astype(np.float32)


def surround_canvas(still, megapixels=1.03, k=2.0, gray=0.5):
    """The still, smaller, in the middle of a canvas k times as wide and tall, the rest solid gray: what an outpainting
    model (Qwen Image 2.1 + the outpaint LoRA) paints out. Returns the canvas and the still's rect (x, y, w, h)."""
    H, W = still.shape[:2]
    a = W / H
    Wc = int(round(np.sqrt(megapixels * 1e6 * a) / 32)) * 32
    Hc = int(round(Wc / a / 32)) * 32
    rw = int(round(Wc / k / 2)) * 2
    rh = int(round(rw / a / 2)) * 2
    if rh > Hc / k:
        rh = int(round(Hc / k / 2)) * 2; rw = int(round(rh * a / 2)) * 2
    x0, y0 = (Wc - rw) // 2, (Hc - rh) // 2
    canvas = np.full((Hc, Wc, 3), gray, np.float32)
    canvas[y0:y0 + rh, x0:x0 + rw] = cv2.resize(still.astype(np.float32), (rw, rh), interpolation=cv2.INTER_AREA)
    return canvas, (x0, y0, rw, rh)


def pad_canvas(still, megapixels=1.6, pad=0.3):
    """The still, smaller, with `pad` of its own size added on every side (0.3 = 30%): the canvas is `megapixels` in
    all, every size a multiple of 16 (Krea 2's latent grid, so no edge is added on one side only). The margin holds
    the still's own edge colours, clamped outward and blurred more with distance: a model that reads the margin sees
    the scene's colours going on, not a gray frame (gray left a gray crease along the old edge on dark stills).
    Krea 2 AnyPaint paints the margin and keeps the still; extending more than ~40% a side tends to paint the subject
    twice, and a canvas much past ~1.6 MP creases. Returns the canvas and the still's rect (x, y, w, h)."""
    H, W = still.shape[:2]
    a = W / H
    k = 1 + 2 * pad
    wc = np.sqrt(megapixels * 1e6 * a)
    rw = max(64, int(round(wc / k / 16)) * 16)
    rh = max(64, int(round(rw / a / 16)) * 16)
    px, py = int(round(rw * pad / 16)) * 16, int(round(rh * pad / 16)) * 16
    small = cv2.resize(still.astype(np.float32), (rw, rh), interpolation=cv2.INTER_AREA)
    canvas = cv2.copyMakeBorder(small, py, py, px, px, cv2.BORDER_REPLICATE)
    if px or py:
        Hc, Wc = canvas.shape[:2]
        yy, xx = np.mgrid[0:Hc, 0:Wc]
        dist = np.maximum(np.maximum(px - xx, xx - (px + rw - 1)), np.maximum(py - yy, yy - (py + rh - 1)))
        dist = np.maximum(dist, 0).astype(np.float32)
        levels = [canvas] + [cv2.GaussianBlur(canvas, (0, 0), sg) for sg in (4, 12, 32)]
        lv = np.clip(np.log2(np.maximum(dist, 1) / 4.0), 0, len(levels) - 1)
        i0 = np.floor(lv).astype(int); fr = (lv - i0)[..., None]; i1 = np.minimum(i0 + 1, len(levels) - 1)
        st = np.stack(levels)
        out = st[i0, yy, xx] * (1 - fr) + st[i1, yy, xx] * fr
        out[py:py + rh, px:px + rw] = small
        canvas = out
    return np.clip(canvas, 0, 1).astype(np.float32), (px, py, rw, rh)


def surround_for(still, sur):
    """the canvas a stage's surround is painted on, from its settings in stage.json (pad > 0: pad_canvas; else the
    gray canvas twice the size): the same canvas when it is made and when the painting comes back"""
    sur = sur or {}
    if float(sur.get("pad") or 0) > 0:
        return pad_canvas(still, float(sur.get("megapixels", 1.6)), float(sur["pad"]))
    return surround_canvas(still, float(sur.get("megapixels", 1.03)))


def match_colour(painted, ref, rect, reach=0.12):
    """An outpainting model drifts the colours a little, and it redraws a band just inside the old edge (Krea 2
    AnyPaint: 32 px, its sky there darker than the still's), so the dome, which shows the still itself inside the frame
    and the painting outside, had a step all round the frame: a lighter box in the sky on a wide move. So: match the
    painting to the still globally where both show the still, then carry the smooth difference at the edge (the still
    minus the painting, just inside the frame) out into the painted margin, fading over `reach` of the canvas width,
    and put the still itself back inside the frame."""
    x0, y0, rw, rh = rect
    m = 4
    a = painted[y0 + m:y0 + rh - m, x0 + m:x0 + rw - m].reshape(-1, 3)
    b = ref[y0 + m:y0 + rh - m, x0 + m:x0 + rw - m].reshape(-1, 3)
    out = (painted - a.mean(0)) / np.maximum(a.std(0), 1e-3) * b.std(0) + b.mean(0)
    out = np.clip(out, 0, 1).astype(np.float32)
    Hc, Wc = out.shape[:2]
    inside = np.zeros((Hc, Wc), bool)
    inside[y0:y0 + rh, x0:x0 + rw] = True
    if inside.all() or not inside.any():
        return out
    sc = 4
    small = (max(8, Wc // sc), max(8, Hc // sc))
    # the edge band only (a few % of the frame), where the step is: the difference deep inside is the still's detail
    band = inside & ~(_edt(inside) > max(6, int(0.04 * rw)))
    kb = cv2.resize(band.astype(np.float32), small, interpolation=cv2.INTER_AREA) > 0.5
    diff = cv2.resize(cv2.GaussianBlur(ref - out, (0, 0), 3), small, interpolation=cv2.INTER_AREA)
    if kb.sum() < 8:
        return out
    corr = np.stack([_pushpull(np.where(kb, diff[..., c], 0), kb, smooth=0.01) for c in range(3)], -1)
    corr = cv2.resize(corr, (Wc, Hc), interpolation=cv2.INTER_CUBIC)
    fade = np.exp(-_edt(~inside) / max(1.0, reach * Wc))[..., None]
    out = np.where(inside[..., None], ref, np.clip(out + corr * fade, 0, 1))
    return out.astype(np.float32)


def stage_file(folder, name):
    """the path of a file that stage.json names (a layer's image, depth, hole or outer painting, the dome, the plate): it
    must be a file inside the stage's own folder. A stage folder can come from anywhere (one shared by someone else), and
    a name like "../../x.png" or "C:/x.png" would read any image the server can reach, and the plate and Stage Fill would
    write over it."""
    base = os.path.realpath(folder)
    path = os.path.realpath(os.path.join(base, name)) if isinstance(name, str) and name else ""
    try:
        inside = bool(path) and path != base and os.path.commonpath([os.path.normcase(base), os.path.normcase(path)]) == os.path.normcase(base)
    except ValueError:                                   # another drive
        inside = False
    if not inside:
        raise ValueError(f"stage.json names a file outside the stage's folder: {name!r}")
    return path


def load_layers(folder, meta):
    """a saved stage's layers as float RGBA, far to near"""
    return [cv2.cvtColor(cv2.imread(stage_file(folder, L["image"]), cv2.IMREAD_UNCHANGED), cv2.COLOR_BGRA2RGBA).astype(np.float32) / 255
            for L in meta["layers"]]


def write_dome(folder, meta, rgba, surround=None, rect=None):
    """(re)write a stage's dome.png from its layers, with an optional painted surround; updates meta (not saved)"""
    still = composite([{"rgba": x} for x in rgba])
    # a painted world past the frame is worth more texels: at 0.4 deg a texel is ~15 px of a 1080p frame, and a painted
    # butte past the edge came out as a blurry block on a wide arc. The blur fallback doesn't need them.
    d = dict(DOME, step=DOME_PAINTED_STEP if surround is not None else DOME["step"])
    tex = dome_map(still, rgba[0], **{k: d[k] for k in ("fov", "step", "yaw", "pitch")}, surround=surround, rect=rect)
    cv2.imwrite(os.path.join(folder, "dome.png"), cv2.cvtColor(np.clip(tex * 255 + .5, 0, 255).astype(np.uint8), cv2.COLOR_RGB2BGR))
    import time
    meta["dome"] = dict(d, image="dome.png", painted=surround is not None, rev=int(time.time()))   # rev: a cache-buster for viewers
    if surround is not None and rect is not None:
        write_outer(folder, meta, rgba, surround, rect)
    return tex


OUTER_MARGIN = 0.12               # how far past the frame a backdrop's mesh reaches (the studio's grid margin)


def _reaches_out(L, W, H):
    """a layer the studio draws past the frame edge: a backdrop, or anything cut by the frame (a cliff, a table)"""
    b = L.get("bbox") or [0, 0, W - 1, H - 1]
    return bool(L.get("backdrop")) or b[0] <= 2 or b[1] <= 2 or b[2] >= W - 3 or b[3] >= H - 3


def write_outer(folder, meta, rgba, surround, rect, margin=OUTER_MARGIN):
    """The set going on past the frame, in real paint. Past the frame edge the studio draws a backdrop (or a layer cut
    by the frame) with its edge texels stretched outward (streaks), fading into the far dome, and on a wide arc the
    painted world showed there as a soft block at the dome's distance with a hard edge where the layer faded. With a
    painted surround (Valis Stage Dome), each such layer gets outer_XX.png: the painting itself, for the margin the
    mesh reaches past the frame (`margin` of the frame on each side), at the layer's own (edge) depth. Its alpha says
    where to use it: where this layer, or one behind it, is what the camera sees at the nearest frame-edge pixel. Behind
    the layer the camera sees, a layer keeps its stretched completion (hidden; the painting there is the other's).
    Inside the frame nothing changes: at rest the picture is still the still. Updates meta (not saved)."""
    H, W = rgba[0].shape[:2]
    x0, y0, rw, rh = (float(v) for v in rect)
    k = 1 + 2 * margin
    ow, oh = int(round(rw * k)), int(round(rh * k))
    u = (-margin + (np.arange(ow) + 0.5) / ow * k).astype(np.float32)
    v = (-margin + (np.arange(oh) + 0.5) / oh * k).astype(np.float32)
    cu, cv_ = np.meshgrid(x0 + u * rw - 0.5, y0 + v * rh - 0.5)
    paint = cv2.remap(surround.astype(np.float32), cu.astype(np.float32), cv_.astype(np.float32), cv2.INTER_LINEAR,
                      borderMode=cv2.BORDER_REFLECT_101)
    # seamless at the frame edge: the painting continues the model's own version of the still, not the still (the
    # surround has the still pasted back inside the frame), and a faint step showed along the edge (the lighthouse's
    # sky). At each edge pixel, the still (a little blurred) minus the painting just outside it (2-6 px out) is added
    # to the painting past it, fading out over ~2% of the frame.
    iw, ih = int(round(rw)), int(round(rh))
    still_s = cv2.GaussianBlur(cv2.resize(composite([{"rgba": x} for x in rgba]), (iw, ih), interpolation=cv2.INTER_AREA), (0, 0), 1.5)
    sur_b = cv2.GaussianBlur(surround.astype(np.float32), (0, 0), 1.0)
    bx = np.clip(np.floor(u * iw).astype(int), 0, iw - 1)
    by = np.clip(np.floor(v * ih).astype(int), 0, ih - 1)
    sx = np.where(u < 0, -1, np.where(u > 1, 1, 0))
    sy = np.where(v < 0, -1, np.where(v > 1, 1, 0))
    Hc, Wc = surround.shape[:2]
    acc = np.zeros((oh, ow, 3), np.float32)
    for o in (2, 4, 6):
        X = np.clip(x0 + bx[None, :] + sx[None, :] * o + 0 * by[:, None], 0, Wc - 1).astype(int)
        Y = np.clip(y0 + by[:, None] + sy[:, None] * o + 0 * bx[None, :], 0, Hc - 1).astype(int)
        acc += sur_b[Y, X]
    D = still_s[by[:, None], bx[None, :]] - acc / 3
    D = cv2.GaussianBlur(D, (0, 0), 2.0)
    dist = np.maximum(np.maximum(-u, u - 1)[None, :] * iw, np.maximum(-v, v - 1)[:, None] * ih)
    fade = np.exp(-np.maximum(dist, 0) / max(1.0, 0.02 * iw))[..., None]
    paint = np.clip(paint + D * fade, 0, 1)
    # the still's frame-edge pixel nearest to each margin pixel (the studio clamps there too)
    ex = np.clip((u * W).astype(int), 0, W - 1)
    ey = np.clip((v * H).astype(int), 0, H - 1)
    outside = (u[None, :] < 0) | (u[None, :] > 1) | (v[:, None] < 0) | (v[:, None] > 1)
    # which layer the camera sees most of at each pixel, at rest (a smoke trail half over the sky: whichever shows more)
    trans = np.ones((H, W), np.float32)
    best, owner = np.zeros((H, W), np.float32), np.full((H, W), -1, np.int32)
    for i in range(len(rgba) - 1, -1, -1):
        a = rgba[i][..., 3]
        vi = trans * a
        owner[vi > best] = i
        best = np.maximum(best, vi)
        trans = trans * (1 - a)
    sig = max(1.0, 0.004 * ow)
    done = []
    for i, L in enumerate(meta["layers"]):
        if not _reaches_out(L, W, H):
            L.pop("outer", None)
            continue
        # the painting for the layer the camera sees there and for anything drawn nearer (a smoke trail half over the
        # sky: stretched, its edge drew streaks over the painted sky); a layer behind it keeps its stretched
        # completion, which only a move's parallax uncovers
        own = ((owner <= i) & (owner >= 0)).astype(np.float32)
        a = own[ey[:, None], ex[None, :]] * outside
        a = np.clip(cv2.GaussianBlur(a.astype(np.float32), (0, 0), sig) * outside, 0, 1)
        if a.max() < 0.05:
            L.pop("outer", None)
            continue
        out = np.dstack([paint, a]).astype(np.float32)
        img = np.clip(out * 255 + .5, 0, 255).astype(np.uint8)
        f = f"outer_{i:02d}.png"
        cv2.imwrite(os.path.join(folder, f), cv2.cvtColor(img, cv2.COLOR_RGBA2BGRA))
        L["outer"] = f
        done.append(L["name"])
    meta["outer"] = {"margin": margin, "layers": done}
    return done


def plate_targets(meta):
    """The things a clean plate removes: objects that stand in the scene (not cut by the frame, so not scenery like
    a sea, a shore, a table running out of shot). What is behind them is what a moving camera uncovers."""
    W, H = meta["width"], meta["height"]
    out = []
    for L in meta["layers"]:
        if L.get("backdrop"):
            continue
        b = L.get("bbox") or [0, 0, W - 1, H - 1]
        if b[0] <= 2 or b[1] <= 2 or b[2] >= W - 3 or b[3] >= H - 3:
            continue
        out.append(L["name"])
    return out


def plate_prompt(names):
    """the edit instruction for a clean plate (Qwen Image 2.1 edit, as Remove uses)"""
    if not names:
        return ""
    if len(names) == 1:     # one thing alone: an edit model removes a central person far more reliably this way
        return (f"Remove {names[0]} from the picture. The empty place behind is now visible: continue what is around it "
                "naturally where it stood. Keep everything else exactly as it is.")
    lst = ", ".join(names[:-1]) + " and " + names[-1]
    return (f"Remove {lst} from the picture. Where they were, show what is behind them, continuing the scene naturally. "
            "Keep everything else exactly as it is.")


def plate_main(meta, names):
    """the biggest of the things to remove: it gets a pass of its own (asked together, Qwen kept a central man)"""
    area = {L["name"]: L.get("area", 0) for L in meta["layers"]}
    return max(names, key=lambda n: area.get(n, 0)) if names else None


def plate_check(meta, rgba, plate, names, still=None):
    """Which of `names` the plate really removed: inside a thing's own core the plate must no longer look like the
    still. (An edit model sometimes leaves one standing.) Returns (removed, not_removed)."""
    H, W = rgba[0].shape[:2]
    if still is None:
        still = composite([{"rgba": x} for x in rgba])
    p = plate if plate.shape[:2] == (H, W) else cv2.resize(plate.astype(np.float32), (W, H), interpolation=cv2.INTER_CUBIC)
    idx = {L["name"]: i for i, L in enumerate(meta["layers"])}
    g_p = cv2.cvtColor(p.astype(np.float32), cv2.COLOR_RGB2GRAY)
    g_s = cv2.cvtColor(still.astype(np.float32), cv2.COLOR_RGB2GRAY)
    ok, failed = [], []
    for n in names:
        if n not in idx:
            continue
        core = cv2.erode((rgba[idx[n]][..., 3] > 0.9).astype(np.uint8), np.ones((5, 5), np.uint8)) > 0
        if core.sum() < 64:
            continue
        g1, g2 = g_p[core], g_s[core]
        g1 = g1 - g1.mean() + g2.mean()             # judge the shapes, not an overall shift in light
        corr = float(np.corrcoef(g1, g2)[0, 1]) if g1.std() > 1e-4 and g2.std() > 1e-4 else 0.0
        (failed if corr > 0.6 and np.abs(g1 - g2).mean() < 0.12 else ok).append(n)
    return ok, failed


def apply_plate(folder, meta, rgba, plate, names, reach=0.015, keep_prev=False, image="plate.png"):
    """Paint behind the layers properly: a clean plate (the still with `names` removed by an edit model) replaces the
    guessed completion (Telea + mirrored texture) of every other layer where one of the removed things covered it.
    Only hidden pixels change, so at rest the picture is exactly the still; a move uncovers the plate. Writes the
    layer PNGs and plate.png, and notes the plate in meta (not saved)."""
    for L in meta["layers"]:                             # every file it will read or write is in the stage's folder, before any is written
        stage_file(folder, L["image"])
        if L.get("hole"):
            stage_file(folder, L["hole"])
    stage_file(folder, image)
    H, W = rgba[0].shape[:2]
    still = composite([{"rgba": x} for x in rgba])
    p = cv2.resize(plate.astype(np.float32), (W, H), interpolation=cv2.INTER_CUBIC)
    idx = {L["name"]: i for i, L in enumerate(meta["layers"])}
    # a naive check per thing: an edit model sometimes leaves one standing (Qwen kept a central man and removed only
    # the fire). Where the plate still looks like the still inside a thing's own core, that thing wasn't removed, and
    # the plate must not go behind it (it would paint the thing again behind itself).
    ok, failed = plate_check(meta, rgba, p, names, still)
    names = ok
    gone = np.zeros((H, W), bool)
    lit = np.zeros((H, W), np.uint8)
    lum = cv2.cvtColor(still.astype(np.float32), cv2.COLOR_RGB2GRAY)
    lights = []
    for n in names:
        core = rgba[idx[n]][..., 3] > 0.9                  # the thing itself, not its faded completion band
        gone |= core
        # a light (the same test as a light's wider grow in build): an edit model takes its light with it (a moon
        # became a dark disk in its own glow, a lighthouse lamp a dark box between its beams). Behind a light is its
        # glow, which the layer's own completion already carries on from the still (a beam goes on through its lamp):
        # the plate stays out of there.
        if core.sum() >= 64 and np.percentile(lum[core], 90) > 0.9:
            lit |= core.astype(np.uint8)
            lights.append(n)
    r = max(2, int(round(reach * W)))
    disk = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r + 1, 2 * r + 1))
    near = cv2.dilate(gone.astype(np.uint8), disk) > 0
    lit_m = cv2.GaussianBlur(cv2.dilate(lit, disk).astype(np.float32), (0, 0), r / 2) if lights else np.zeros((H, W), np.float32)
    keep = ~near                                     # where the plate should show the still: match its colours there
    if keep.sum() > 1000:
        a, b = p[keep], still[keep]
        p = np.clip((p - a.mean(0)) / np.maximum(a.std(0), 1e-3) * b.std(0) + b.mean(0), 0, 1)
        # and locally: an edit model relights what it removes with the thing (a lighthouse's beam goes with the
        # lighthouse, leaving a dark tower-shaped patch in a lit sky). The smooth difference between the still and the
        # plate around the removed things is carried in under them, so the plate keeps its shapes but takes the
        # light the still has there.
        # (at 1/4 size with little relaxation: coarser and smoother, it left a dark column shaped like the lighthouse)
        small = (max(8, W // 4), max(8, H // 4))
        kp = cv2.resize(keep.astype(np.float32), small, interpolation=cv2.INTER_AREA) > 0.99
        diff = cv2.resize(still.astype(np.float32) - p, small, interpolation=cv2.INTER_AREA)
        corr = np.stack([_pushpull(np.where(kp, diff[..., c], 0), kp, smooth=0.003) for c in range(3)], -1)
        p = np.clip(p + cv2.resize(corr, (W, H), interpolation=cv2.INTER_CUBIC), 0, 1)
    cv2.imwrite(stage_file(folder, image), cv2.cvtColor((p * 255 + .5).clip(0, 255).astype(np.uint8), cv2.COLOR_RGB2BGR))
    # how much of each layer shows at rest (what the nearer layers let through): the plate only goes where a layer is
    # hidden, fading in as it gets hidden, so the still at rest stays the still (a moon's glow fringe keeps its glow)
    trans = [None] * len(rgba)
    t = np.ones((H, W), np.float32)
    for i in range(len(rgba) - 1, -1, -1):
        trans[i] = t.copy()
        t = t * (1 - rgba[i][..., 3])
    changed = []
    for i, L in enumerate(meta["layers"]):
        if L["name"] in names or not L.get("hole"):
            continue
        hole = cv2.imread(stage_file(folder, L["hole"]), 0) > 127
        # not where a kept, nearer layer stands: the plate shows that layer there (a house beside a removed
        # lighthouse), and it would come back as a ghost house in the sky
        kept = np.zeros((H, W), bool)
        for j in range(i + 1, len(rgba)):
            if meta["layers"][j]["name"] not in names:
                kept |= rgba[j][..., 3] > 0.5
        reg = hole & near & ~kept & (rgba[i][..., 3] > 0)
        if reg.sum() < 64:
            continue
        hidden = np.clip((0.25 - trans[i]) / 0.25, 0, 1)
        m = (cv2.GaussianBlur(reg.astype(np.float32), (0, 0), 2.0) * hidden)[..., None] * (rgba[i][..., 3:] > 0)
        m = m * (1 - lit_m)[..., None]
        # each layer takes from the plate only what looks like itself. Krea "removed" a crashed lander by painting a
        # smaller one beside it (its own place now empty, so the check above passed it), and the sky behind took the
        # new lander: a second lander in the sky on a move. Naive test: the plate must look like the layer's own
        # visible paint carried in smoothly, within a few times that paint's own spread; elsewhere the layer keeps
        # its own completion.
        vis = trans[i] * rgba[i][..., 3] > 0.5
        if vis.sum() > 500:
            small = (max(8, W // 4), max(8, H // 4))
            kv = cv2.resize(vis.astype(np.float32), small, interpolation=cv2.INTER_AREA) > 0.99
            if kv.sum() >= 16:
                st_s = cv2.resize(still.astype(np.float32), small, interpolation=cv2.INTER_AREA)
                est_s = np.stack([_pushpull(np.where(kv, st_s[..., c], 0), kv, smooth=0.02) for c in range(3)], -1)
                # the spread is local: a sky's clouds may vary a lot, its plain stretch beside a lighthouse doesn't
                ad = np.abs(st_s - est_s).max(-1)
                sd = 1.25 * _pushpull(np.where(kv, ad, 0), kv, smooth=0.03)
                est = cv2.resize(est_s, (W, H), interpolation=cv2.INTER_LINEAR)
                sd = np.maximum(cv2.resize(sd, (W, H), interpolation=cv2.INTER_LINEAR), 0.015)
                dev = np.abs(p - est).max(-1) / sd
                like = cv2.GaussianBlur(np.clip(1.0 - (dev - 3.0) / 2.0, 0, 1).astype(np.float32), (0, 0), 1.5)
                m = m * like[..., None]
        rgba[i][..., :3] = rgba[i][..., :3] * (1 - m) + p * m
        changed.append(L["name"])
    touched = rest_exact(rgba, still)                   # the plate goes where a layer is (nearly) hidden: exactly hidden
    for i, L in enumerate(meta["layers"]):
        if L["name"] not in changed and i not in touched:
            continue
        out = np.clip(rgba[i] * 255 + .5, 0, 255).astype(np.uint8)
        out[out[..., 3] == 0, :3] = 0
        cv2.imwrite(stage_file(folder, L["image"]), cv2.cvtColor(out, cv2.COLOR_RGBA2BGRA))
    prev = meta.get("plate") if keep_prev else None
    removed = sorted(set(names) | set((prev or {}).get("removed", [])))
    # what an earlier pass found standing stays standing unless this pass took it out (a second pass only looks at the biggest thing)
    standing = [n for n in dict.fromkeys([*(prev or {}).get("not_removed", []), *failed]) if n not in removed]
    meta["plate"] = {"image": (prev or {}).get("image", image), **({"image_main": image} if prev else {}), "removed": removed,
                     "not_removed": standing,
                     "painted": sorted(set(changed) | set((prev or {}).get("painted", []))),
                     "lights": sorted(set(lights) | set((prev or {}).get("lights", [])))}
    return names


# ---- erase first: the things standing in the scene are erased by an edit model (Krea 2 edit), the erased picture is
# split into scenery (nothing is hidden behind a thing any more, so nothing behind one is guessed), and the things go
# back on top as cutouts from the still, with their soft edges solved against the real paint behind them. The far dome
# is behind it all. At rest the picture is exactly the still; a move uncovers what the edit model painted.

def apply_fill(folder, meta, fills):
    """Painted completions put back into a stage's layers (Valis Stage Fill). `fills`: [(slot, picture)], each picture RGB
    floats 0..1 of any size, which replaces the layer's colour inside its hole (and a few feathered pixels round it).
    The hole takes in the layer's own rim along the edge of whatever covers it, so the painter has the edge to paint
    from, and the paint is clean there. What shows at rest must still be the still: the first frame, as it was before
    the paint, is put back exactly by rest_exact (the covering thing's soft edge takes the difference, as it does for every
    edge of the stage), so only paint that is hidden at rest changes what the picture looks like. Writes the layers it
    changed and marks the painted ones in meta (not saved); returns the names it painted."""
    rgba = load_layers(folder, meta)
    still = composite([{"rgba": x} for x in rgba])                 # the first frame, as it is now
    painted = []
    for slot, pic in fills:
        L = meta["layers"][slot]
        if not L.get("hole"):
            continue
        H, W = rgba[slot].shape[:2]
        hole = cv2.imread(stage_file(folder, L["hole"]), 0) > 127
        new = (np.clip(np.asarray(pic, np.float32)[..., :3], 0, 1) * 255 + .5).astype(np.uint8)
        if new.shape[:2] != (H, W):
            new = cv2.resize(new, (W, H), interpolation=cv2.INTER_AREA)
        m = cv2.GaussianBlur(cv2.dilate(hole.astype(np.uint8) * 255, np.ones((5, 5), np.uint8)), (0, 0), 2).astype(np.float32)[..., None] / 255
        rgba[slot][..., :3] = np.clip(rgba[slot][..., :3] * (1 - m) + new.astype(np.float32) / 255 * m, 0, 1)
        painted.append(slot)
    touched = rest_exact(rgba, still) if painted else set()
    for i in sorted(set(painted) | set(touched)):
        out = np.clip(rgba[i] * 255 + .5, 0, 255).astype(np.uint8)
        out[out[..., 3] == 0, :3] = 0
        cv2.imwrite(stage_file(folder, meta["layers"][i]["image"]), cv2.cvtColor(out, cv2.COLOR_RGBA2BGRA))
    for i in painted:
        meta["layers"][i]["painted"] = True
    return [meta["layers"][i]["name"] for i in painted]


def erase_plan(masks, names, w, h, threshold=0.5, min_area=0.0003, backdrop_area=0.35):
    """Which names are things standing in the scene, to erase and put back as cutouts: not a sky or a moon, not filling much of
    the frame, and not running out of the frame at the left, right or top (scenery: a sea, a ridge, a table; a
    person cut off at the bottom is still a person). The biggest gets an edit of its own as well: asked for four
    things at once, Krea kept a lighthouse. The others together get one more ("rest"), made only when the first edit
    left one of them standing (one retry, never more)."""
    out, areas = [], {}
    for n, m in zip(names, masks):
        if m is None or SKY.search(n) or CELESTIAL.search(n):   # a moon is in the sky: split it as scenery, at the far wall
            continue
        b = cv2.resize(np.asarray(m, np.float32), (w, h), interpolation=cv2.INTER_LINEAR) > threshold
        a = float(b.mean())
        if a < min_area or a > backdrop_area:
            continue
        ys, xs = np.nonzero(b)
        # smoke, steam, dust, flames: in front of the scenery even when they drift out of the frame. Left in the
        # scenery, a smoke trail sat at the ground's depth and slid like ground, uncovering guessed sky as streaks;
        # erased and put back, it is a see-through cutout whose edge is solved against the clean plate.
        if not GAS.search(n) and (xs.min() <= 2 or ys.min() <= 2 or xs.max() >= w - 3):
            continue
        out.append(n); areas[n] = a
    # the biggest solid thing gets the edit of its own (a smoke trail is easy to remove with the rest)
    solid = [n for n in out if not GAS.search(n)] or out
    main = max(solid, key=lambda n: areas[n]) if solid else ""
    rest = [n for n in out if n != main]
    keep_all = "Keep the picture exactly as it is."
    return {"erase": out, "main": main, "rest": rest, "prompt_all": plate_prompt(out) or keep_all,
            "prompt_main": plate_prompt([main]) if main else keep_all,
            "prompt_rest": plate_prompt(rest) if rest else keep_all}


def _align_to(p, still, keep, max_shift=0.01):
    """An edit model may shift its whole picture by a pixel or two, and every edge then differs from the still by that
    much (a false "changed" rim round everything). Translate the plate onto the still, judged only where nothing was
    erased (ECC, at ~640 px wide, sub-pixel). Returns (aligned plate, (dx, dy) in still px)."""
    H, W = still.shape[:2]
    s = max(1, int(round(W / 640)))
    sz = (max(16, W // s), max(16, H // s))
    g1 = cv2.resize(cv2.cvtColor(still.astype(np.float32), cv2.COLOR_RGB2GRAY), sz, interpolation=cv2.INTER_AREA)
    g2 = cv2.resize(cv2.cvtColor(p.astype(np.float32), cv2.COLOR_RGB2GRAY), sz, interpolation=cv2.INTER_AREA)
    m = (cv2.resize(keep.astype(np.uint8), sz, interpolation=cv2.INTER_NEAREST) > 0).astype(np.uint8)
    if m.sum() < 500:
        return p, (0.0, 0.0)
    warp = np.eye(2, 3, dtype=np.float32)
    try:
        _, warp = cv2.findTransformECC(g1, g2, warp, cv2.MOTION_TRANSLATION,
                                       (cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 80, 1e-6), m, 5)
    except cv2.error:
        return p, (0.0, 0.0)
    dx, dy = float(warp[0, 2]) * W / sz[0], float(warp[1, 2]) * H / sz[1]
    if max(abs(dx), abs(dy)) > max_shift * W or max(abs(dx), abs(dy)) < 0.1:
        return p, (round(dx, 3), round(dy, 3))
    M = np.float32([[1, 0, dx], [0, 1, dy]])
    out = cv2.warpAffine(p.astype(np.float32), M, (W, H), flags=cv2.INTER_CUBIC | cv2.WARP_INVERSE_MAP, borderMode=cv2.BORDER_REFLECT)
    return np.clip(out, 0, 1), (round(dx, 3), round(dy, 3))


def _match_plate(p, still, keep):
    """the plate matched to the still in colour (globally) and in light (locally, carried in under the erased things)"""
    H, W = still.shape[:2]
    if keep.sum() < 1000:
        return p
    a, b = p[keep], still[keep]
    p = np.clip((p - a.mean(0)) / np.maximum(a.std(0), 1e-3) * b.std(0) + b.mean(0), 0, 1)
    small = (max(8, W // 4), max(8, H // 4))
    kp = cv2.resize(keep.astype(np.float32), small, interpolation=cv2.INTER_AREA) > 0.99
    diff = cv2.resize(still - p, small, interpolation=cv2.INTER_AREA)
    corr = np.stack([_pushpull(np.where(kp, diff[..., c], 0), kp, smooth=0.003) for c in range(3)], -1)
    return np.clip(p + cv2.resize(corr, (W, H), interpolation=cv2.INTER_CUBIC), 0, 1).astype(np.float32)


def _disk(k):
    k = max(0, int(k))
    return cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * k + 1, 2 * k + 1))


def _grow(m, k):
    """m dilated by a disk of radius k (an exact distance transform: a 150 px elliptic dilate took seconds)"""
    m = np.asarray(m, bool)
    if k <= 0 or not m.any():
        return m.copy()
    return cv2.distanceTransform((~m).astype(np.uint8), cv2.DIST_L2, cv2.DIST_MASK_PRECISE) <= k


def _colour_model(still, fg, bg, bins=16):
    """P(thing | colour) from two 3D colour histograms (the thing's own pixels, what is around it), smoothed"""
    q = np.clip((still * bins).astype(np.int32), 0, bins - 1)
    code = (q[..., 0] * bins + q[..., 1]) * bins + q[..., 2]
    hf = np.bincount(code[fg].ravel(), minlength=bins ** 3).astype(np.float32).reshape(bins, bins, bins)
    hb = np.bincount(code[bg].ravel(), minlength=bins ** 3).astype(np.float32).reshape(bins, bins, bins)
    hf = ndi.gaussian_filter(hf / max(1.0, hf.sum()), 0.8)
    hb = ndi.gaussian_filter(hb / max(1.0, hb.sum()), 0.8)
    pf = (hf / np.maximum(hf + hb, 1e-9)).ravel()
    return pf[code]


class _EraseJob:
    """What erase_combine and the lazy check share: the things' masks (part by part), the plates aligned and matched
    to the still, and which plate erased which part."""

    def __init__(self, still, masks, names, plan, plates, plate_masks=None, ring=0.004):
        H, W = still.shape[:2]
        self.H, self.W = H, W
        self.still = still = still[..., :3].astype(np.float32)
        self.names, self.plan = list(names), plan
        self.idx = idx = {n: i for i, n in enumerate(names)}
        rs = lambda im: np.clip(cv2.resize(np.asarray(im, np.float32)[..., :3], (W, H), interpolation=cv2.INTER_CUBIC), 0, 1)
        self.core = core = {}
        for n in plan.get("erase", []):
            if n in idx and idx[n] < len(masks) and masks[idx[n]] is not None:
                c = cv2.resize(np.asarray(masks[idx[n]], np.float32), (W, H), interpolation=cv2.INTER_LINEAR) > 0.5
                if c.sum() >= 64:
                    core[n] = c
        self.r = r = max(3, int(round(ring * W)))
        region = np.zeros((H, W), bool)
        for c in core.values():
            region |= _grow(c, 3 * r)
        self.keep = keep = ~region
        self.plate_masks = plate_masks
        self.P, self.shift, self.floor = {}, {}, {}
        for k, p in plates.items():
            if p is None:
                continue
            p, sh = _align_to(rs(p), still, keep)
            self.P[k] = _match_plate(p, still, keep)
            self.shift[k] = sh
            d = np.abs(self.P[k] - still).max(-1)
            # how much the plate differs from the still where nothing was erased: the edit model's own drift, under
            # which a difference means nothing
            self.floor[k] = float(np.clip(np.percentile(d[keep], 95), 0.03, 0.15)) if keep.any() else 0.06
        self.g_s = cv2.cvtColor(still, cv2.COLOR_RGB2GRAY)
        self.parts = {}
        for n in core:
            g = max(1, int(0.01 * W))
            lab, k = ndi.label(cv2.dilate(core[n].astype(np.uint8), _disk(g)) > 0)
            lab = np.where(core[n], lab, 0)
            self.parts[n] = [lab == j for j in range(1, k + 1) if (lab == j).sum() >= 64] or [core[n]]

    def gone(self, k, part):
        """the plate no longer looks like the still inside this part (shapes judged, not an overall shift in light)"""
        p = self.P.get(k)
        if p is None:
            return False
        c = cv2.erode(part.astype(np.uint8), np.ones((5, 5), np.uint8)) > 0
        c = c if c.sum() >= 64 else part
        g1, g2 = cv2.cvtColor(p, cv2.COLOR_RGB2GRAY)[c], self.g_s[c]
        g1 = g1 - g1.mean() + g2.mean()
        corr = float(np.corrcoef(g1, g2)[0, 1]) if g1.std() > 1e-4 and g2.std() > 1e-4 else 0.0
        return not (corr > 0.6 and np.abs(g1 - g2).mean() < 0.12)

    def found_again(self, n):
        """SAM 3 finds the thing again close by in the first plate (Krea "removed" a lander by painting a smaller one
        beside it)"""
        pm_all = self.plate_masks
        i = self.idx[n]
        if pm_all is None or i >= len(pm_all) or pm_all[i] is None:
            return False
        pm = cv2.resize(np.asarray(pm_all[i], np.float32), (self.W, self.H), interpolation=cv2.INTER_LINEAR) > 0.5
        around = _grow(self.core[n], max(4, int(0.06 * self.W)))
        return (pm & around).sum() > 0.2 * self.core[n].sum()

    def pick(self):
        """per thing, per part: the first plate that erased it (all, then the biggest alone, then the others again).
        A thing is erased only if every part of it went. Returns (source by name, [(part, plate)] by name)."""
        src, parts = {}, {}
        main, rest = self.plan.get("main", ""), set(self.plan.get("rest", []))
        for n, ps in self.parts.items():
            again = self.found_again(n)
            pick = []
            for pt in ps:
                if "all" in self.P and not again and self.gone("all", pt):
                    pick.append("all")
                elif n == main and self.gone("main", pt):
                    pick.append("main")
                elif n in rest and self.gone("rest", pt):
                    pick.append("rest")
                else:
                    pick.append(None)
            if None in pick:
                src[n] = None
            else:
                src[n] = "+".join(sorted(set(pick)))
                parts[n] = list(zip(ps, pick))
        return src, parts

    def needs(self):
        """the lazy plates still worth making: the biggest thing alone when the first plate left it standing, the
        others together when the first plate left one of them standing (each at most once)"""
        src, _ = self.pick()
        main, rest = self.plan.get("main", ""), set(self.plan.get("rest", []))
        want = []
        if "main" not in self.P and main and src.get(main) is None:
            want.append("plate_main")
        if "rest" not in self.P and any(src.get(n) is None for n in rest):
            want.append("plate_rest")
        return want

    def footprint(self, n, pt, k, reach=0.006, follow=0.04):
        """Where the edit really took the thing away, beyond SAM's mask: the plate differs from the still (by more than
        the plate's own drift) next to the part, either within `reach` of it or along something connected to it up to
        `follow` away. SAM misses the thinnest bits (a lander's strut tips), and they stayed in the erased picture as
        specks, and behind on a move. Not a shadow (the still darker than the plate, same hue): a shadow stays on the
        ground. Returns (what to erase, what belongs to the thing): the second keeps only what looks like the thing in
        colour (its own palette against what is around it), so the edit model's repainted rocks nearby don't ride
        along with it."""
        p, s = self.P[k], self.still
        W = self.W
        rr, rf = max(3, int(round(reach * W))), max(6, int(round(follow * W)))
        zone = _grow(pt, rf) & ~pt
        # differs from the plate even allowing the plate a few px of local slack: an edit model warps edges a little
        # (a mesa's outline moved 2 px), and that is not something it took away
        t = max(2, int(round(0.0012 * W)))
        ker = np.ones((2 * t + 1, 2 * t + 1), np.uint8)
        d = np.maximum(np.maximum(s - cv2.dilate(p, ker), cv2.erode(p, ker) - s), 0).max(-1)
        lum = lambda x: x @ np.array([0.3, 0.59, 0.11], np.float32)
        cos = (s * p).sum(-1) / np.maximum(np.linalg.norm(s, axis=-1) * np.linalg.norm(p, axis=-1), 1e-6)
        shadow = (lum(s) < lum(p) * 0.92) & (cos > 0.995)
        cand = zone & (d > max(1.5 * self.floor[k], 0.06)) & ~shadow
        if not cand.any():
            return pt.copy(), pt.copy()
        dist = ndi.distance_transform_edt(~pt)
        lab, _ = ndi.label(cand | (cv2.dilate(pt.astype(np.uint8), _disk(2)) > 0))
        touch = np.unique(lab[pt])
        conn = np.isin(lab, touch[touch > 0]) & cand
        close = cand & (dist <= rr)
        # a piece the edit took whole (a lander's foot pad) differs from the plate at its outline more than inside it:
        # close it and fill it, so it goes whole, not as a faint half-erased ghost
        k3 = max(2, int(round(0.0015 * W)))
        erase = cv2.morphologyEx((pt | conn | close).astype(np.uint8), cv2.MORPH_CLOSE, _disk(k3)) > 0
        erase = ndi.binary_fill_holes(erase) & (zone | pt)
        erase |= pt
        # the thing's own colours: its outer band (where its edge colours are), against the ring past the zone
        band = pt & ~(cv2.erode(pt.astype(np.uint8), _disk(max(2, int(0.006 * W)))) > 0)
        outer = _grow(pt, 2 * rf) & ~zone & ~pt
        if band.sum() < 32 or outer.sum() < 32:
            return erase, pt.copy()
        like = _colour_model(s, band, outer) > 0.5
        mine = (conn | close) & like
        # what belongs to the thing must still touch it, through its own colours
        lab2, _ = ndi.label(mine | (cv2.dilate(pt.astype(np.uint8), _disk(2)) > 0))
        t2 = np.unique(lab2[pt])
        mine = np.isin(lab2, t2[t2 > 0]) & mine
        return erase, pt | mine


def erase_needs(still, masks, names, plan, plate_all, plate_main=None, plate_rest=None, plate_masks=None):
    """for Valis Erase's lazy check: which of plate_main / plate_rest to make before combining"""
    job = _EraseJob(still, masks, names, plan, {"all": plate_all, "main": plate_main, "rest": plate_rest}, plate_masks)
    return job.needs()


def erase_combine(still, masks, names, plan, plate_all, plate_main=None, plate_masks=None, ring=0.004, plate_rest=None,
                  footprints=False):
    """The erased picture: the still, with each erased thing's place (a hair past its outline, and wherever the edit
    took more of it than SAM's mask holds) taken from the edit model's plate, the plate first moved onto the still
    (sub-pixel) and matched to it in colour and in light (an edit model takes a thing's light with it). Naive checks
    per thing: the plate must no longer look like the still in the thing's own place, and SAM must not find the
    thing again close by (Krea "removed" a crashed lander by painting a smaller one beside it). A thing no plate erased
    stays in the picture, and is split as scenery like before. Returns (picture, report), plus each name's footprint
    (what is the thing's, for its cutout; None for a name not erased) with footprints=True."""
    dump("erase", still=still, masks=list(masks), names=list(names), plan=plan, plate_all=np.asarray(plate_all)[..., :3],
         plate_main=None if plate_main is None else np.asarray(plate_main)[..., :3],
         plate_rest=None if plate_rest is None else np.asarray(plate_rest)[..., :3],
         plate_masks=None if plate_masks is None else list(plate_masks))
    job = _EraseJob(still, masks, names, plan, {"all": plate_all, "main": plate_main, "rest": plate_rest}, plate_masks, ring)
    src, parts = job.pick()
    H, W, r = job.H, job.W, job.r
    out = job.still.copy()
    fps = [None] * len(names)
    extra = {}
    for n, ps in parts.items():
        fp = np.zeros((H, W), bool)
        for pt, k in ps:
            er, mine = job.footprint(n, pt, k)
            fp |= mine
            extra[n] = extra.get(n, 0) + int((mine & ~pt).sum())
            m = _grow(er, r).astype(np.float32)
            m = np.maximum(cv2.GaussianBlur(m, (0, 0), r / 2), er)[..., None]
            out = out * (1 - m) + job.P[k] * m
        fps[job.idx[n]] = fp.astype(np.float32)
    report = {"erased": [n for n, k in src.items() if k], "kept": [n for n, k in src.items() if not k],
              "source": src, "main": plan.get("main", ""), "plates": sorted(job.P), "shift": job.shift,
              "drift": {k: round(v, 4) for k, v in job.floor.items()}, "footprint_px": extra}
    out = out.astype(np.float32)
    return (out, report, fps) if footprints else (out, report)


def _scenery_masks(masks, masks_erased, names, sn, erased, w, h, threshold=0.5, min_area=0.0003, **_):
    """SAM's masks for the scenery, read in the erased picture. A name SAM can no longer tell apart there (nothing, or
    the whole picture: "the red desert ridge" once the lander was gone took the plain and the mesas with it) keeps the
    still's mask, where it was found, and takes the places of the erased things it borders that no other scenery name
    claims (the ridge goes on under where the astronaut stood). Without it the ridge fell into the rest with the plain
    behind it, and a move tore the rest along the ridge's edge, showing the sky's paint through it as a pale line."""
    rs = lambda m: cv2.resize(np.asarray(m, np.float32), (w, h), interpolation=cv2.INTER_LINEAR) > threshold
    usable = lambda b: b is not None and min_area <= float(b.mean()) <= .85
    es = {n: rs(masks_erased[names.index(n)]) if masks_erased[names.index(n)] is not None else None for n in sn}
    ss = {n: rs(masks[names.index(n)]) if masks[names.index(n)] is not None else None for n in sn}
    back = [n for n in sn if not usable(es[n]) and usable(ss[n])]
    if not back:
        return [masks_erased[names.index(n)] for n in sn]
    gone = np.zeros((h, w), bool)
    for n in erased:
        if masks[names.index(n)] is not None:
            gone |= rs(masks[names.index(n)])
    gone = cv2.dilate(gone.astype(np.uint8), np.ones((9, 9), np.uint8)) > 0
    lab = np.zeros((h, w), np.int16)                    # the scenery the still shows, by name (1-based)
    for k, n in enumerate(sn, 1):
        if ss[n] is not None:
            lab[ss[n] & ~gone & (lab == 0)] = k
    idx = ndi.distance_transform_edt(lab == 0, return_distances=False, return_indices=True)
    near_lab = lab[idx[0], idx[1]]
    claimed = np.zeros((h, w), bool)
    for n in sn:
        if n not in back and usable(es[n]):
            claimed |= es[n]
    out = []
    for k, n in enumerate(sn, 1):
        if n in back:
            out.append((ss[n] | (gone & (near_lab == k) & ~claimed)).astype(np.float32))
        else:
            out.append(masks_erased[names.index(n)])
    return out


def build_erased(still, near_still, masks, names, erased_img, near_erased, masks_erased, erased, far=6.0, band=0.025,
                 ring=0.004, footprints=None, soft=None, report=None, **kw):
    """The set, erase first. Scenery: the erased picture split by every name that wasn't erased (SAM looked for them in
    the erased picture, so a sky goes on behind where a lander stood). Things: cutouts from the still, each drawn
    right after the last scenery layer it stood in front of, their depth from the still's depth map fitted to the
    erased picture's. A thing's cutout is its footprint when Valis Erase gave one (SAM's mask plus what the edit took
    past it: a lander's strut tips), else SAM's mask. `soft`: name -> a soft matte of the thing (BiRefNet), used in
    its edge band only where the difference matte can't tell the thing from what is behind (same colours).
    Returns (layers, info) as build does."""
    dump("build_erased", still=still[..., :3], near_still=near_still, masks=list(masks), names=list(names), erased_img=erased_img[..., :3],
         near_erased=near_erased, masks_erased=list(masks_erased), erased=list(erased), far=far, band=band,
         footprints=None if footprints is None else list(footprints), report=report,
         soft_names=sorted(soft) if soft else [], soft=[soft[n] for n in sorted(soft)] if soft else None)
    h, w = still.shape[:2]
    still = still[..., :3].astype(np.float32)
    erased = [n for n in erased if n in names]
    sn = [n for n in names if n not in erased]
    layers_bg, info = build(erased_img, near_erased, _scenery_masks(masks, masks_erased, names, sn, erased, w, h, **kw),
                            sn, far=far, band=band, checks=False, **kw)
    if report:
        info["erase"] = report
    if not erased:
        rest_exact([L["rgba"] for L in layers_bg], still)
        info = dict(info, erased=[])
        info["checks"] = scorecard(layers_bg, still, info)
        return layers_bg, info
    disk = lambda k: cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * k + 1, 2 * k + 1))
    rs = lambda m: cv2.resize(np.asarray(m, np.float32), (w, h), interpolation=cv2.INTER_LINEAR) > 0.5
    sam = {n: rs(masks[names.index(n)]) for n in erased}
    fpl = {}
    if footprints is not None:
        for n in erased:
            i = names.index(n)
            f = footprints[i] if i < len(footprints) else None
            if f is not None and np.any(np.asarray(f) > 0.5):
                fpl[n] = rs(f) | sam[n]
    cores = {n: fpl.get(n, sam[n]) for n in erased}
    things = np.zeros((h, w), bool)
    for c in cores.values():
        things |= c
    # the still's depth in the erased picture's terms: a straight fit where both show the same scenery
    nb = _orient(cv2.resize(near_erased.astype(np.float32), (w, h), interpolation=cv2.INTER_LINEAR))
    ns = _orient(cv2.resize(near_still.astype(np.float32), (w, h), interpolation=cv2.INTER_LINEAR))
    bg = ~(cv2.dilate(things.astype(np.uint8), disk(max(4, int(0.02 * w)))) > 0)
    x, y = ns[bg][::7], nb[bg][::7]
    a, b = 1.0, 0.0
    for _ in range(3):
        if len(x) < 100 or x.std() < 1e-4:
            break
        a, b = np.polyfit(x, y, 1)
        e = np.abs(y - (a * x + b))
        sel = e <= max(2.5 * np.median(e), 1e-4)
        x, y = x[sel], y[sel]
    q = ((a * ns + b) - nb.min()) / max(1e-6, nb.max() - nb.min())
    z_things = nearness_to_z(q, far).astype(np.float32)
    lo, _ = build(still, None, [cores[n].astype(np.float32) for n in erased], erased, far=far, band=band, z_override=z_things,
                  exact=False, checks=False, never_backdrop=erased, **kw)
    objs = [L for L in lo if L["name"] in erased and not L.get("backdrop")]
    # a thing keeps its own pixels, its soft edge, and its completion only behind another thing in front of it
    # (a lander behind an astronaut); behind the scenery it is erased from, the scenery is real paint
    r = max(3, int(round(ring * w)))
    reach = {L["name"]: cv2.dilate(cores[L["name"]].astype(np.uint8), disk(2 * r)) > 0 for L in objs}
    for k, L in enumerate(objs):
        mine = reach[L["name"]].copy()
        for M in objs[k + 1:]:
            mine |= reach[M["name"]]
        L["rgba"][..., 3] *= mine
        L["hole"] = None
    # draw order: right after the last scenery layer that shows where the thing stood (it stood in front of that), so
    # the scenery it hides never draws over it; things in one slot far to near
    trans = np.ones((h, w), np.float32)
    shown = [None] * len(layers_bg)
    for i in range(len(layers_bg) - 1, -1, -1):
        shown[i] = trans * layers_bg[i]["rgba"][..., 3] > 0.5
        trans = trans * (1 - layers_bg[i]["rgba"][..., 3])
    slot = {}
    for L in objs:
        c = cores[L["name"]]
        hits = [i for i in range(len(layers_bg)) if (shown[i] & c).sum() > 0.02 * c.sum()]
        slot[L["name"]] = max(hits) if hits else len(layers_bg) - 1
    layers = []
    for i, L in enumerate(layers_bg):
        layers.append(L)
        layers += sorted([o for o in objs if slot[o["name"]] == i], key=lambda o: -o["z_med"])
    # the soft edge, solved: within a few px of its outline each still pixel lies between the thing's own colour
    # (carried out from inside) and what is behind it (real paint now), and how far along is the thing's coverage
    for k, L in enumerate(layers):
        if L["name"] not in cores:
            continue
        below = composite([{"rgba": M["rgba"]} for M in layers[:k]]) if k else np.zeros_like(still)
        c = cores[L["name"]]
        inner = cv2.erode(c.astype(np.uint8), np.ones((5, 5), np.uint8)) > 0
        # what the edit took past SAM's mask is the thing, whole (a strut tip is too thin to have an inside)
        inner |= c & ~(cv2.dilate(sam[L["name"]].astype(np.uint8), np.ones((3, 3), np.uint8)) > 0)
        inner = inner if inner.sum() >= 16 else c
        F = np.stack([_fill_nearest(np.where(inner, still[..., i], 0), inner) for i in range(3)], -1)
        F = np.where(inner[..., None], still, cv2.GaussianBlur(F, (0, 0), 1.0))
        band_px = (cv2.dilate(c.astype(np.uint8), disk(2 * r)) > 0) & ~inner
        d = F - below
        den = (d * d).sum(-1)
        a_new = np.clip(((still - below) * d).sum(-1) / np.maximum(den, 1e-6), 0, 1)
        solve = band_px & (den > 0.05 ** 2)
        al = L["rgba"][..., 3]
        al[inner] = 1.0
        al[solve] = a_new[solve]
        un = band_px & ~solve & ~c
        sm = soft.get(L["name"]) if soft else None
        if sm is not None:
            # the thing's colours are the background's here: the difference matte can't tell, a matting model can
            sm = cv2.resize(np.asarray(sm, np.float32), (w, h), interpolation=cv2.INTER_LINEAR) if sm.shape != (h, w) else sm
            al[un] = np.clip(sm[un], 0, 1)
            unc = band_px & ~solve & c
            al[unc] = np.maximum(np.minimum(al[unc], 1.0), np.clip(sm[unc], 0, 1))
        else:
            al[un] = np.minimum(al[un], 0.0)
        L["rgba"][..., :3] = np.where((band_px | inner)[..., None], F, L["rgba"][..., :3])
    # each thing owns the ring it was erased from: what the still shows there beyond the plate is the thing's glow
    rest_exact([L["rgba"] for L in layers], still, own=[reach.get(L["name"]) for L in layers])
    zc = info["border"]
    z_all = np.where(things, z_things, np.inf)
    info = dict(info, erased=erased)
    info["border"] = {s: [min(a1, b1) for a1, b1 in zip(zc[s], _border(np.where(np.isfinite(z_all), z_all, far))[s])] for s in zc}
    info["footprint"] = {n: int((cores[n] & ~sam[n]).sum()) for n in fpl}
    if soft:
        info["matte"] = sorted(n for n in soft if n in cores)
    info["checks"] = scorecard(layers, still, info)
    return layers, info


def rest_exact(rgba, still, min_w=0.3, own=None, reach=0.003):
    """At rest the layers must composite back to the still exactly. They didn't: every layer's edge is repainted from a
    little inside (so a background never carries the glow and edge of what covers it), and an object's soft fringe lies
    over that repaint, so every outline came back as a pale rim in the very first frame. The leftover (still minus the
    composite) belongs to the edge it lies on: the nearest layer there (where it shows, or a hair past its outline, or
    in `own`) takes it, in colour where it shows enough and otherwise as a faint fringe of its own, matted over what is
    behind it (a difference matte: the layers behind stay as they were). Before, a fringe too faint to take it handed it
    to the layer behind, so the still's glow and sharpening halo were painted on the sky, and a move left them there as
    a pale ghost of the outline (the thin outline round the astronaut, the mesas, the ridge). What nothing stands in
    front of goes to the floor. Hidden paint is untouched, so a move still uncovers the completion. Changes rgba in
    place; returns the indices of the layers it changed."""
    n = len(rgba)
    if not n:
        return set()
    H, W = still.shape[:2]
    k = max(2, int(round(reach * W)))
    disk = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * k + 1, 2 * k + 1))
    top = np.zeros((H, W), np.int16)
    for i in range(1, n):
        m = cv2.dilate((rgba[i][..., 3] > 1e-3).astype(np.uint8), disk) > 0
        if own is not None and i < len(own) and own[i] is not None:
            m |= own[i]
        top[m] = i
    touched = set()
    below = rgba[0][..., :3].copy()
    for i in range(1, n):
        L = rgba[i]
        m = top == i
        if m.any():
            A, F, B, S = L[..., 3][m], L[..., :3][m], below[m], still[m]
            need = np.abs(S - (A[:, None] * F + (1 - A[:, None]) * B)).max(-1) > 0.5 / 255
            if need.any():
                A, B, S = A[need], B[need], S[need]
                d = S - B
                amin = np.where(d > 0, d / np.maximum(1 - B, 1e-4), -d / np.maximum(B, 1e-4)).max(-1)
                A2 = np.clip(np.maximum(A, amin), 0, 1)
                F2 = np.clip(B + d / np.maximum(A2[:, None], 1e-4), 0, 1)
                mm = m.copy()
                mm[m] = need
                L[..., :3][mm] = F2
                L[..., 3][mm] = A2
                touched.add(i)
        a = L[..., 3:]
        below = below * (1 - a) + L[..., :3] * a
    # what is left (the floor where nothing stands in front of it, and rounding): nearest that shows enough first
    alpha = [x[..., 3] for x in rgba]
    w, t = [None] * n, np.ones((H, W), np.float32)
    for i in range(n - 1, 0, -1):                       # the farthest layer is the floor, as composite() draws it
        w[i] = alpha[i] * t
        t = t * (1 - alpha[i])
    w[0] = t
    res = still - below
    for floor in (min_w, 1e-3):
        for i in range(n - 1, -1, -1):
            m = (w[i] >= floor) & (np.abs(res).max(-1) > 0.5 / 255)
            if not m.any():
                continue
            c = rgba[i][..., :3]
            old = c[m]
            new = np.clip(old + res[m] / w[i][m, None], 0, 1)
            c[m] = new
            res[m] -= (new - old) * w[i][m, None]
            touched.add(i)
    return touched


# ---- checks: naive pixel tests that say what a set will do on a move before anyone looks (and before a GPU retry)

# a name for something big by nature: taking much of the frame is what it should do
BROAD_OK = re.compile(r"\b(sky|skies|clouds?|sea|ocean|water|waves|lake|river|ground|floor|desert|dunes?|field|plains?|sand|"
                      r"grass|land|landscape|terrain|meadow|snow|ice|road|street|city|forest|jungle|wall|walls|room|"
                      r"background|horizon|mountains|hills|valley|fog|mist|smoke|rest)\b", re.I)


def broad_name(name, m, z, far, area=0.35, spread=0.5):
    """A name SAM read as much more than one thing ("the red desert ridge" became the whole desert): it took over a
    third of the frame, or runs through half the scene's depth, and it isn't a name for something big by nature.
    Returns a warning (dict) or None."""
    words = re.findall(r"[a-z]+", name.lower())
    head = words[-1] if words else ""                         # "the red desert ridge" is a ridge, not a desert
    if SKY.search(name) or CELESTIAL.search(name) or BROAD_OK.fullmatch(head):
        return None
    a = float(m.mean())
    zz = z[m]
    if zz.size < 64:
        return None
    n = (1.0 / zz - 1.0 / far) / (1.0 - 1.0 / far)              # nearness again, 0 = farthest, 1 = nearest
    sp = float(np.percentile(n, 95) - np.percentile(n, 5))
    if a <= area and sp <= spread:
        return None
    why = f"took {round(100 * a)}% of the frame" if a > area else f"runs through {round(100 * sp)}% of the scene's depth"
    return {"name": name, "area": round(a, 3), "depth_spread": round(sp, 3),
            "why": f"{why}: SAM may have read it as more than one thing. Name one thing in it, like \"the rock in front\"."}


def _edt(m):
    """distance of every pixel of m to the nearest pixel outside it (0 outside): scipy's edt, faster"""
    return cv2.distanceTransform(np.asarray(m, bool).astype(np.uint8), cv2.DIST_L2, cv2.DIST_MASK_PRECISE)


def _over_suffix(rgba):
    """premultiplied composites of layers i.. (near ones over far ones), for every i: (colour, alpha)"""
    n = len(rgba)
    H, W = rgba[0].shape[:2]
    C = [None] * (n + 1)
    A = [None] * (n + 1)
    C[n], A[n] = np.zeros((H, W, 3), np.float32), np.zeros((H, W), np.float32)
    for i in range(n - 1, -1, -1):
        a = rgba[i][..., 3]
        C[i] = C[i + 1] + (1 - A[i + 1])[..., None] * rgba[i][..., :3] * a[..., None]
        A[i] = A[i + 1] + (1 - A[i + 1]) * a
    return C, A


def scorecard(layers, still, info, step=4, out_h=1080, tear=0.08):
    """Six naive checks on a finished set (all pixels, no model). Each: {id, name, ok, value, note, ...}.
    1 first_frame: at rest the set composites back to the still.
    2 ghost: hide each thing; its outline must not be left painted on what is behind it (the ghost astronaut).
    3 names: a name that matched much more than one thing (a broad name), or nothing.
    4 erase: each erased thing really went (from the erase report), and how much the edit took past SAM's mask.
    5 tears: how much of what shows at rest sits on a depth jump the studio's renderer tears (fwidth(z)/z > 0.08 at
      1080p), where the layer behind shows through.
    6 guessed: of the paint a move can uncover next to the things (not a sky behind the ground), how much is a guess
      (smeared from around it) rather than real paint (the erased picture, a clean plate)."""
    rgba = [L["rgba"] for L in layers]
    H, W = still.shape[:2]
    out = []
    try:
        comp = composite(layers)
        err = np.abs(comp - still).max(-1)
        p99, mx = float(np.percentile(err, 99)) * 255, float(err.max()) * 255
        out.append({"id": "first_frame", "name": "First frame is the still", "ok": p99 < 2.0, "value": round(p99, 2),
                    "note": f"99% of pixels within {p99:.1f}/255 of the still (worst {mx:.0f})"})
    except Exception as e:
        out.append({"id": "first_frame", "name": "First frame is the still", "ok": None, "note": f"not checked: {e}"})
    # 2 ghost energy along each thing's outline, in the picture with that thing hidden
    try:
        C, A = _over_suffix(rgba)
        below = rgba[0][..., :3].copy()
        ghosts, worst = [], 0.0
        for k in range(1, len(rgba)):
            L = layers[k]
            a = rgba[k][..., 3]
            if not L.get("backdrop") and (a > 0.5).sum() >= 64:
                wo = C[k + 1] + (1 - A[k + 1])[..., None] * below          # every layer but this one
                sil = a > 0.5
                sdf = _edt(~sil) - _edt(sil)
                gy, gx = np.gradient(cv2.GaussianBlur(sdf.astype(np.float32), (0, 0), 1.5))
                nrm = np.maximum(np.hypot(gx, gy), 1e-6)
                g = cv2.GaussianBlur(cv2.cvtColor(wo.astype(np.float32), cv2.COLOR_RGB2GRAY), (0, 0), 1.0)
                iy, ix = np.gradient(g)
                e = np.abs(ix * gx / nrm + iy * gy / nrm)                    # edge across the outline's normal
                # not where a nearer layer stands at the outline: that edge is real
                front = cv2.dilate((A[k + 1] > 0.1).astype(np.uint8), np.ones((9, 9), np.uint8)) > 0
                ring = (np.abs(sdf) <= 1.5) & ~front
                ctrl = (((sdf >= -12) & (sdf <= -7)) | ((sdf >= 7) & (sdf <= 12))) & ~front
                if ring.sum() >= 40 and ctrl.sum() >= 40:
                    ratio = float(e[ring].mean() / max(e[ctrl].mean(), 2e-3))
                    ghosts.append({"layer": L["name"], "ratio": round(ratio, 2)})
                    worst = max(worst, ratio)
            ak = rgba[k][..., 3:]
            below = below * (1 - ak) + rgba[k][..., :3] * ak
        bad = [g["layer"] for g in ghosts if g["ratio"] > 1.6]
        out.append({"id": "ghost", "name": "No ghost outlines", "ok": not bad, "value": round(worst, 2), "layers": ghosts,
                    "note": ("edges along the hidden outline of " + ", ".join(bad) + " (an outline left behind, or the scenery cut off where it stood)") if bad else
                            (f"edge energy along hidden outlines at most {worst:.2f}x the surroundings" if ghosts else "no things to hide")})
    except Exception as e:
        out.append({"id": "ghost", "name": "No ghost outlines", "ok": None, "note": f"not checked: {e}"})
    # 3 names
    warns, dropped = info.get("warnings", []), info.get("dropped", [])
    out.append({"id": "names", "name": "Names found one thing each", "ok": not warns and not dropped,
                "value": len(warns) + len(dropped), "warnings": warns, "dropped": dropped,
                "note": "; ".join([f"\"{w['name']}\" {w['why']}" for w in warns] + [f"\"{d['name']}\" dropped: {d['why']}" for d in dropped]) or "every name found its own thing"})
    # 4 erase (only for a set made erase first)
    rep = info.get("erase")
    if rep:
        kept = rep.get("kept", [])
        fp = rep.get("footprint_px", {})
        extra = ", ".join(f"{n} +{v} px" for n, v in fp.items() if v)
        out.append({"id": "erase", "name": "The things were erased", "ok": not kept, "value": len(kept),
                    "kept": kept, "source": rep.get("source", {}), "plates": rep.get("plates", []),
                    "note": (f"left standing (split as scenery): {', '.join(kept)}" if kept else
                             f"erased: {', '.join(rep.get('erased', [])) or 'nothing to erase'}") +
                            (f" · the edit took more than SAM's mask: {extra}" if extra else "")})
    # 5 tears at rest
    try:
        cell = step * out_h / H                                   # one mesh cell in output px at rest
        trans = np.ones((H, W), np.float32)
        torn_px, shown_px, per = 0.0, 0.0, []
        for i in range(len(layers) - 1, -1, -1):
            L = layers[i]
            a = rgba[i][..., 3]
            vis = trans * a
            trans = trans * (1 - a)
            z = L["z"]
            zm = float(L.get("z_med", np.median(z)))
            rel = L.get("relief") if L.get("relief") is not None else (1.0 if L.get("backdrop") else 0.35)
            zd = zm + (z - zm) * rel
            g = zd[::step, ::step]
            dx = np.abs(np.diff(g, axis=1))[:-1, :]
            dy = np.abs(np.diff(g, axis=0))[:, :-1]
            t = ((dx + dy) / cell / np.maximum(g[:-1, :-1], 1e-3)) > tear
            tm = cv2.resize(t.astype(np.uint8), (W, H), interpolation=cv2.INTER_NEAREST)[:H, :W] > 0
            v = vis > 0.5
            tp, sp = float((tm & v).sum()), float(v.sum())
            torn_px += tp
            shown_px += sp
            if sp > 0 and tp / sp > 0.01:
                per.append({"layer": L["name"], "share": round(tp / sp, 3)})
        share = torn_px / max(1.0, shown_px)
        out.append({"id": "tears", "name": "Few torn triangles", "ok": share < 0.002, "value": round(share, 4), "layers": per,
                    "note": f"{100 * share:.2f}% of what shows at rest sits on a depth jump the renderer tears" +
                            (" (" + ", ".join(f"{p['layer']} {100 * p['share']:.1f}%" for p in per) + ")" if per else "")})
    except Exception as e:
        out.append({"id": "tears", "name": "Few torn triangles", "ok": None, "note": f"not checked: {e}"})
    # 6 guessed paint near the edges a move uncovers
    try:
        reach = max(4, int(0.03 * W))
        trans = np.ones((H, W), np.float32)
        tobj = np.ones((H, W), np.float32)                        # what only the things (not backdrops) let through
        things = set(info.get("erased") or [])                   # erase first: the cutouts; else every non-backdrop
        hidden_px, guess_px = 0.0, 0.0
        for i in range(len(layers) - 1, -1, -1):
            L = layers[i]
            a = rgba[i][..., 3]
            hidden = (a > 0.5) & (trans < 0.5) & (tobj < 0.5)
            if hidden.any():
                seen = trans >= 0.5
                close = _edt(~seen) <= reach    # within a move's reach of where it shows
                h_ = hidden & close
                hidden_px += float(h_.sum())
                hole = L.get("hole")
                if hole is not None and np.any(hole):
                    guess_px += float((h_ & hole).sum())
            trans = trans * (1 - a)
            if (L["name"] in things) if things else not L.get("backdrop"):
                tobj = tobj * (1 - a)
        ratio = guess_px / max(1.0, hidden_px)
        out.append({"id": "guessed", "name": "Real paint behind the things", "ok": ratio < 0.5, "value": round(ratio, 3),
                    "note": (f"{100 * ratio:.0f}% of the paint a move uncovers next to the things is guessed (smeared), the rest is real"
                             if hidden_px else "nothing hidden behind a thing")})
    except Exception as e:
        out.append({"id": "guessed", "name": "Real paint behind the things", "ok": None, "note": f"not checked: {e}"})
    return out


def composite(layers):
    """the still as the original camera saw it: every layer over the farthest"""
    out = layers[0]["rgba"][..., :3].copy()
    for L in layers[1:]:
        a = L["rgba"][..., 3:]
        out = out * (1 - a) + L["rgba"][..., :3] * a
    return out


def _pack16(z, far):
    """z in [1, far] -> 16-bit code in R (high) and G (low)."""
    q = np.clip((z - 1.0) / (far - 1.0), 0, 1)
    v = np.round(q * 65535).astype(np.uint32)
    out = np.zeros(z.shape + (3,), np.uint8)
    out[..., 0] = (v >> 8).astype(np.uint8)
    out[..., 1] = (v & 255).astype(np.uint8)
    return out


def save(folder, layers, info, source=None):
    os.makedirs(folder, exist_ok=True)
    meta = dict(info)
    meta["source"] = source
    meta["layers"] = []
    for i, L in enumerate(layers):
        lf, df = f"layer_{i:02d}.png", f"depth_{i:02d}.png"
        rgba = np.clip(L["rgba"] * 255 + .5, 0, 255).astype(np.uint8)
        rgba[rgba[..., 3] == 0, :3] = 0          # nothing hidden under zero alpha: smaller files, faster loads
        cv2.imwrite(os.path.join(folder, lf), cv2.cvtColor(rgba, cv2.COLOR_RGBA2BGRA))
        cv2.imwrite(os.path.join(folder, df), cv2.cvtColor(_pack16(L["z"], info["far"]), cv2.COLOR_RGB2BGR))
        entry = {"name": L["name"], "image": lf, "depth": df, "z_med": round(L["z_med"], 4),
                 "area": round(L["area"], 5), "bbox": L["bbox"], "backdrop": L.get("backdrop", False)}
        if L.get("relief") is not None:
            entry["relief"] = L["relief"]                 # already flattened part by part (see _flatten_parts)
        if L.get("hole") is not None and L["hole"].any():
            hf = f"hole_{i:02d}.png"
            cv2.imwrite(os.path.join(folder, hf), (L["hole"] * 255).astype(np.uint8))
            entry["hole"] = hf
            entry["hole_area"] = round(float(L["hole"].mean()), 5)
        meta["layers"].append(entry)
    if layers:
        write_dome(folder, meta, [L["rgba"] for L in layers])
    with open(os.path.join(folder, "stage.json"), "w") as f:
        json.dump(meta, f, indent=1)
    return meta


def contact(layers, width=448):
    """A review sheet: each layer over a checkerboard, far to near, with its name."""
    tiles = []
    for L in layers:
        h, w = L["rgba"].shape[:2]
        s = width / w
        t = cv2.resize(L["rgba"], (width, int(h * s)), interpolation=cv2.INTER_AREA)
        yy, xx = np.mgrid[:t.shape[0], :t.shape[1]]
        chk = np.where(((yy // 12 + xx // 12) % 2)[..., None] > 0, .35, .22).astype(np.float32)
        o = t[..., :3] * t[..., 3:] + chk * (1 - t[..., 3:])
        o = (np.clip(o, 0, 1) * 255).astype(np.uint8).copy()
        cv2.putText(o, f'{L["name"]}  z={L["z_med"]:.2f}', (8, 22), 0, .6, (255, 255, 0), 2)
        tiles.append(o)
    cols = 4
    while len(tiles) % cols:
        tiles.append(np.zeros_like(tiles[0]))
    return np.vstack([np.hstack(tiles[i:i + cols]) for i in range(0, len(tiles), cols)])


def union_detections(batch, min_px=24):
    """SAM 3 with up to N detections per name returns one mask per object. Union them, but drop a 'container'
    detection: one far bigger than the rest that swallows them (asking for "the clouds" can also return the whole sky)."""
    ms = [m > .5 for m in batch if (m > .5).sum() >= min_px]
    if not ms:
        return np.zeros_like(batch[0], np.float32) if len(batch) else None
    if len(ms) > 2:
        areas = np.array([m.sum() for m in ms], np.float64)
        keep = []
        for i, m in enumerate(ms):
            others = [o for j, o in enumerate(ms) if j != i]
            med = np.median(areas[[j for j in range(len(ms)) if j != i]])
            u = np.logical_or.reduce(others)
            swallows = (m & u).sum() / max(1, u.sum())
            # only a frame-filling detection is a container ("the clouds" -> the whole sky); a person found whole
            # along with their face and hands is not
            keep.append(not (areas[i] > 4 * med and swallows > .6 and areas[i] > .2 * m.size))
        ms = [m for m, k in zip(ms, keep) if k] or ms
    return np.logical_or.reduce(ms).astype(np.float32)
