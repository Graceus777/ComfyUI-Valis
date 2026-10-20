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
SKY = re.compile(r"\b(sky|skies|heaven|heavens|night sky|clouds? and sky)\b", re.I)


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


def build(image, nearness, masks, names, far=6.0, threshold=0.5, edge=1.5, min_area=0.0003, band=0.025, backdrop_area=0.35, paint_band=0.09, grow=0.003):
    """image HxWx3 float [0,1]; nearness HxW float [0,1] (bright = near); masks: list of HxW float (one per name).

    Returns (layers, info). layers: list far -> near of dicts {name, rgba HxWx4, z HxW, z_med, area, bbox}.
    The last plate, "the rest", is everything no name claimed."""
    h, w = image.shape[:2]
    near = _orient(cv2.resize(nearness.astype(np.float32), (w, h), interpolation=cv2.INTER_LINEAR))
    near = (near - near.min()) / max(1e-6, near.max() - near.min())
    z = nearness_to_z(near, far).astype(np.float32)

    # one binary mask per name. Naive checks, so a bad name costs nothing but a note:
    #   nothing found / the whole picture ("the city" over a city) / the same thing as an earlier name
    cand, dropped, cores = [], [], []
    for name, m in zip(names, masks):
        m = cv2.resize(m.astype(np.float32), (w, h), interpolation=cv2.INTER_LINEAR) > threshold
        if m.mean() < min_area:
            dropped.append({"name": name, "why": "SAM 3 found nothing by that name"})
            continue
        if m.mean() > .85:
            dropped.append({"name": name, "why": "matched the whole picture: name something more specific"})
            continue
        dup = next((c for c, cm in cand if (m & cm).sum() / max(1, (m | cm).sum()) > .8), None)
        if dup:
            dropped.append({"name": name, "why": f"found the same thing as {dup}"})
            continue
        m0 = m
        if grow > 0:      # SAM's edge stops short of a soft fringe (a cloud's wisp, a flame's glow): take it along,
            g = max(1, int(round(grow * w)))     # but feathered (see the alpha below), so it never reads as a cut-out ring
            m = cv2.dilate(m.astype(np.uint8), cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * g + 1, 2 * g + 1))) > 0
        cand.append((name, m))
        cores.append(m0)
    # draw order far -> near by each mask's median depth, then a mask that sits mostly inside a bigger one (the moon
    # in the sky, a lamp on the path) goes just in front of it: depth maps barely separate them
    meds = [float(np.median(z[m])) for _, m in cand]
    # monocular depth is unreliable on sky (Depth Anything often puts it mid-scene): a sky is the farthest thing
    for i, (name, m) in enumerate(cand):
        if SKY.search(name):
            z[m] = far
            meds[i] = far
    areas = [float(m.sum()) for _, m in cand]
    seq = sorted(range(len(cand)), key=lambda i: -meds[i])
    for _ in range(len(cand) ** 2):
        moved = False
        for a in range(len(cand)):
            for b in range(len(cand)):
                if a == b or areas[a] >= areas[b]:
                    continue
                inside = float((cand[a][1] & cand[b][1]).sum()) / max(1.0, areas[a])
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
    rest = owner < 0
    # the rest is one more layer with per-pixel depth; it slots into the order by its median
    plate_i = len(cand)
    owner[rest] = plate_i
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
    is_bd = {li: r == 0 or li == plate_i or bool(SKY.search(allnames[li])) or (owner == li).mean() >= backdrop_area for r, li in enumerate(seq)}
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
        k = 7 if backdrop else 3
        known = cv2.erode(own.astype(np.uint8), np.ones((k, k), np.uint8)).astype(bool)
        if known.sum() < 16:
            known = own
        rgb = _fill_colour(image.astype(np.float32), known, support)
        # depth comes from SAM's own core only: the grown fringe carries the background's depth, and a depth step
        # inside one layer is a torn edge when the camera moves
        zk = known
        if li < len(cores) and not backdrop:
            zk = cv2.erode(cores[li].astype(np.uint8), np.ones((5, 5), np.uint8)).astype(bool) & known
            if zk.sum() < 16:
                zk = known
        if backdrop:
            zl = _fill_behind(z, zk, holes, z_drawn, w, zmed[li])
        else:
            zl = _fill_nearest(np.where(zk, z, 0), zk)
            zl = cv2.GaussianBlur(zl, (0, 0), 2.0) * (~zk) + zl * zk
        # alpha: soft at the outer edge of the support only
        a = support.astype(np.float32)
        if edge > 0:
            a = cv2.GaussianBlur(a, (0, 0), edge)
            a = np.where(support, np.maximum(a, (cv2.erode(support.astype(np.uint8), np.ones((3, 3), np.uint8)) > 0)), a)
        if li < len(cores) and grow > 0 and not backdrop:
            # the grown fringe fades out from SAM's own edge, where it isn't covered by something nearer
            ring = own & ~cores[li] & ~ext
            if ring.any():
                d0 = ndi.distance_transform_edt(~cores[li])
                a[ring] = np.minimum(a[ring], np.clip(1.0 - d0[ring] / (grow * w + 1), 0, 1))
        ys, xs = np.nonzero(own)
        # what an image model should paint properly: the completion near the layer's own pixels (deep inside a big
        # hole, e.g. the sky far below the horizon, nothing is ever revealed)
        hole = support & ~known
        if backdrop and hole.any():
            hole &= ndi.distance_transform_edt(~own) <= paint_band * w
        layers.append({"name": allnames[li], "rgba": np.dstack([rgb, a]).astype(np.float32), "z": zl.astype(np.float32),
                       "z_med": zmed[li], "area": float(own.mean()), "backdrop": bool(backdrop), "hole": hole,
                       "bbox": [int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())]})
    # depth along the still's border (nearest in each of 32 segments): the studio frames every camera move with it
    def seg_min(a, n=32):
        return [round(float(x.min()), 4) for x in np.array_split(a, n)]
    edge_px = max(2, w // 200)
    border = {"top": seg_min(z[:edge_px].min(0)), "bottom": seg_min(z[-edge_px:].min(0)),
              "left": seg_min(z[:, :edge_px].min(1)), "right": seg_min(z[:, -edge_px:].min(1))}
    info = {"width": w, "height": h, "far": far, "border": border, "dropped": dropped}
    return layers, info


DOME = {"yaw": 80.0, "pitch": 60.0, "step": 0.4, "fov": 50.0}


def dome_map(still, back, fov=50.0, step=0.3, yaw=80.0, pitch=60.0):
    """The world past the frame, as an angular map around the original camera (yaw x pitch, `step` degrees a texel;
    row 0 is the top). Inside the frame: the farthest backdrop (complete, nothing standing in it). Outside: the
    still mirrored across its own edge, blurred more and more with distance and fading to the rim's average colour,
    so a camera that moves past the edge sees the set's air and light go on instead of a void. A splat export puts it
    on a sphere far behind the set; naive on purpose, like a blurred letterbox fill."""
    H, W = still.shape[:2]
    f0 = (W / 2) / np.tan(np.radians(fov / 2))
    nx, ny = int(round(2 * yaw / step)), int(round(2 * pitch / step))
    ya = np.radians(np.linspace(-yaw, yaw, nx))[None, :].repeat(ny, 0)
    pa = np.radians(np.linspace(pitch, -pitch, ny))[:, None].repeat(nx, 1)
    u = (W / 2 + f0 * np.tan(ya) - 0.5).astype(np.float32)
    v = (H / 2 - f0 * np.tan(pa) / np.cos(ya) - 0.5).astype(np.float32)
    inside = (u >= 0) & (u <= W - 1) & (v >= 0) & (v <= H - 1)
    px = f0 * np.radians(step)                    # still pixels a texel spans: pre-blur so nothing aliases
    if back.shape[-1] == 4:                        # where the farthest layer has no paint, the still stands in
        back = back[..., :3] * back[..., 3:] + still * (1 - back[..., 3:])
    ins = cv2.remap(cv2.GaussianBlur(back.astype(np.float32), (0, 0), px / 2), u, v, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
    ext = cv2.remap(cv2.GaussianBlur(still.astype(np.float32), (0, 0), px / 2), u, v, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT_101)
    dist = ndi.distance_transform_edt(~inside) if (~inside).any() else np.zeros(inside.shape)
    levels = np.stack([ext] + [cv2.GaussianBlur(ext, (0, 0), sg) for sg in (2, 4, 8, 16, 32)])
    lv = np.clip(np.log2(np.maximum(dist, 1) / 1.5), 0, len(levels) - 1)
    i0 = np.floor(lv).astype(int); fr = (lv - i0)[..., None]; i1 = np.minimum(i0 + 1, len(levels) - 1)
    yy, xx = np.mgrid[0:ny, 0:nx]
    blurred = levels[i0, yy, xx] * (1 - fr) + levels[i1, yy, xx] * fr
    rim = np.concatenate([still[0], still[-1], still[:, 0], still[:, -1]])
    ambient = rim.mean(0) * 0.6
    fade = np.clip(dist / (0.35 * nx), 0, 1)[..., None] ** 1.5
    return np.clip(np.where(inside[..., None], ins, blurred * (1 - fade) + ambient * fade), 0, 1).astype(np.float32)


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
        if L.get("hole") is not None and L["hole"].any():
            hf = f"hole_{i:02d}.png"
            cv2.imwrite(os.path.join(folder, hf), (L["hole"] * 255).astype(np.uint8))
            entry["hole"] = hf
            entry["hole_area"] = round(float(L["hole"].mean()), 5)
        meta["layers"].append(entry)
    if layers:
        tex = dome_map(composite(layers), layers[0]["rgba"], **{k: DOME[k] for k in ("fov", "step", "yaw", "pitch")})
        cv2.imwrite(os.path.join(folder, "dome.png"), cv2.cvtColor(np.clip(tex * 255 + .5, 0, 255).astype(np.uint8), cv2.COLOR_RGB2BGR))
        meta["dome"] = dict(DOME, image="dome.png")
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
