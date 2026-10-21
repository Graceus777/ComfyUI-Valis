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
          z_override=None, exact=True):
    """image HxWx3 float [0,1]; nearness HxW float [0,1] (bright = near); masks: list of HxW float (one per name).

    Returns (layers, info). layers: list far -> near of dicts {name, rgba HxWx4, z HxW, z_med, area, bbox}.
    The last plate, "the rest", is everything no name claimed."""
    h, w = image.shape[:2]
    if z_override is not None:                   # depth already in this stage's terms (the things of an erased set)
        z = z_override.astype(np.float32).copy()
    else:
        z = nearness_to_z(_near01(nearness, w, h), far).astype(np.float32)

    # one binary mask per name. Naive checks, so a bad name costs nothing but a note:
    #   nothing found / the whole picture ("the city" over a city) / the same thing as an earlier name
    cand, dropped, cores, grows = [], [], [], []
    lum = image[..., :3].astype(np.float32) @ np.array([0.3, 0.59, 0.11], np.float32)
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
    is_bd = {li: r == 0 or li == plate_i or allnames[li] == PLATE_FAR or bool(SKY.search(allnames[li]))
             or (owner == li).mean() >= backdrop_area for r, li in enumerate(seq)}
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
    info = {"width": w, "height": h, "far": far, "border": _border(z), "dropped": dropped}
    if exact:
        rest_exact([L["rgba"] for L in layers], image[..., :3].astype(np.float32))
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


def match_colour(painted, ref, rect):
    """an edit model drifts the colours a little: match the painted canvas to the still where both show the still"""
    x0, y0, rw, rh = rect
    m = 4
    a = painted[y0 + m:y0 + rh - m, x0 + m:x0 + rw - m].reshape(-1, 3)
    b = ref[y0 + m:y0 + rh - m, x0 + m:x0 + rw - m].reshape(-1, 3)
    out = (painted - a.mean(0)) / np.maximum(a.std(0), 1e-3) * b.std(0) + b.mean(0)
    return np.clip(out, 0, 1).astype(np.float32)


def load_layers(folder, meta):
    """a saved stage's layers as float RGBA, far to near"""
    return [cv2.cvtColor(cv2.imread(os.path.join(folder, L["image"]), cv2.IMREAD_UNCHANGED), cv2.COLOR_BGRA2RGBA).astype(np.float32) / 255
            for L in meta["layers"]]


def write_dome(folder, meta, rgba, surround=None, rect=None):
    """(re)write a stage's dome.png from its layers, with an optional painted surround; updates meta (not saved)"""
    still = composite([{"rgba": x} for x in rgba])
    tex = dome_map(still, rgba[0], **{k: DOME[k] for k in ("fov", "step", "yaw", "pitch")}, surround=surround, rect=rect)
    cv2.imwrite(os.path.join(folder, "dome.png"), cv2.cvtColor(np.clip(tex * 255 + .5, 0, 255).astype(np.uint8), cv2.COLOR_RGB2BGR))
    import time
    meta["dome"] = dict(DOME, image="dome.png", painted=surround is not None, rev=int(time.time()))   # rev: a cache-buster for viewers
    return tex


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
    cv2.imwrite(os.path.join(folder, image), cv2.cvtColor((p * 255 + .5).clip(0, 255).astype(np.uint8), cv2.COLOR_RGB2BGR))
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
        hole = cv2.imread(os.path.join(folder, L["hole"]), 0) > 127
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
        cv2.imwrite(os.path.join(folder, L["image"]), cv2.cvtColor(out, cv2.COLOR_RGBA2BGRA))
    prev = meta.get("plate") if keep_prev else None
    meta["plate"] = {"image": (prev or {}).get("image", image), **({"image_main": image} if prev else {}), "removed": sorted(set(names) | set((prev or {}).get("removed", []))),
                     "not_removed": [n for n in failed if n not in (prev or {}).get("removed", [])],
                     "painted": sorted(set(changed) | set((prev or {}).get("painted", []))),
                     "lights": sorted(set(lights) | set((prev or {}).get("lights", [])))}
    return names


# ---- erase first: the things standing in the scene are erased by an edit model (Krea 2 edit), the erased picture is
# split into scenery (nothing is hidden behind a thing any more, so nothing behind one is guessed), and the things go
# back on top as cutouts from the still, with their soft edges solved against the real paint behind them. The far dome
# is behind it all. At rest the picture is exactly the still; a move uncovers what the edit model painted.

def erase_plan(masks, names, w, h, threshold=0.5, min_area=0.0003, backdrop_area=0.35):
    """Which names are things standing in the scene, to erase and put back as cutouts: not a sky or a moon, not filling much of
    the frame, and not running out of the frame at the left, right or top (scenery: a sea, a ridge, a table; a
    person cut off at the bottom is still a person). The biggest gets an edit of its own as well: asked for four
    things at once, Krea kept a lighthouse."""
    out, areas = [], {}
    for n, m in zip(names, masks):
        if m is None or SKY.search(n) or CELESTIAL.search(n):   # a moon is in the sky: split it as scenery, at the far wall
            continue
        b = cv2.resize(np.asarray(m, np.float32), (w, h), interpolation=cv2.INTER_LINEAR) > threshold
        a = float(b.mean())
        if a < min_area or a > backdrop_area:
            continue
        ys, xs = np.nonzero(b)
        if xs.min() <= 2 or ys.min() <= 2 or xs.max() >= w - 3:
            continue
        out.append(n); areas[n] = a
    main = max(out, key=lambda n: areas[n]) if out else ""
    keep_all = "Keep the picture exactly as it is."
    return {"erase": out, "main": main, "prompt_all": plate_prompt(out) or keep_all,
            "prompt_main": plate_prompt([main]) if main else keep_all}


def erase_combine(still, masks, names, plan, plate_all, plate_main=None, plate_masks=None, ring=0.004):
    """The erased picture: the still, with each erased thing's place (a hair past its outline) taken from the edit
    model's plate, the plate matched to the still in colour and in light (an edit model takes a thing's light with
    it). Naive checks per thing: the plate must no longer look like the still in the thing's own place, and SAM must
    not find the thing again close by (Krea "removed" a crashed lander by painting a smaller one beside it). A thing
    neither plate erased stays in the picture, and is split as scenery like before. Returns (picture, report)."""
    H, W = still.shape[:2]
    still = still.astype(np.float32)
    idx = {n: i for i, n in enumerate(names)}
    rs = lambda im: np.clip(cv2.resize(np.asarray(im, np.float32)[..., :3], (W, H), interpolation=cv2.INTER_CUBIC), 0, 1)
    P = {"all": rs(plate_all), "main": rs(plate_main) if plate_main is not None else None}
    core = {}
    for n in plan.get("erase", []):
        if n in idx and masks[idx[n]] is not None:
            c = cv2.resize(np.asarray(masks[idx[n]], np.float32), (W, H), interpolation=cv2.INTER_LINEAR) > 0.5
            if c.sum() >= 64:
                core[n] = c
    r = max(3, int(round(ring * W)))
    disk = lambda k: cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * k + 1, 2 * k + 1))
    region = np.zeros((H, W), bool)
    for c in core.values():
        region |= cv2.dilate(c.astype(np.uint8), disk(3 * r)) > 0
    keep = ~region
    g_s = cv2.cvtColor(still, cv2.COLOR_RGB2GRAY)

    def gone(p, part):
        c = cv2.erode(part.astype(np.uint8), np.ones((5, 5), np.uint8)) > 0
        c = c if c.sum() >= 64 else part
        g1, g2 = cv2.cvtColor(p, cv2.COLOR_RGB2GRAY)[c], g_s[c]
        g1 = g1 - g1.mean() + g2.mean()
        corr = float(np.corrcoef(g1, g2)[0, 1]) if g1.std() > 1e-4 and g2.std() > 1e-4 else 0.0
        return not (corr > 0.6 and np.abs(g1 - g2).mean() < 0.12)

    def found_again(n):
        if plate_masks is None or idx[n] >= len(plate_masks) or plate_masks[idx[n]] is None:
            return False
        pm = cv2.resize(np.asarray(plate_masks[idx[n]], np.float32), (W, H), interpolation=cv2.INTER_LINEAR) > 0.5
        around = cv2.dilate(core[n].astype(np.uint8), disk(max(4, int(0.06 * W)))) > 0
        return (pm & around).sum() > 0.2 * core[n].sum()

    # part by part: one name can be two things ("the glowing lantern": one on the lighthouse, one in a hand), and an
    # edit can take one and leave the other. A thing is erased only if every part of it went, in one plate or the other.
    src, parts = {}, {}
    for n in core:
        g = max(1, int(0.01 * W))
        lab, k = ndi.label(cv2.dilate(core[n].astype(np.uint8), disk(g)) > 0)
        lab = np.where(core[n], lab, 0)
        ps = [lab == j for j in range(1, k + 1) if (lab == j).sum() >= 64] or [core[n]]
        again = found_again(n)
        pick = []
        for pt in ps:
            if gone(P["all"], pt) and not again:
                pick.append("all")
            elif P["main"] is not None and gone(P["main"], pt):
                pick.append("main")
            else:
                pick.append(None)
        if None in pick:
            src[n] = None
        else:
            src[n] = "+".join(sorted(set(pick)))
            parts[n] = list(zip(ps, pick))
    for k, p in P.items():
        if p is None or keep.sum() < 1000:
            continue
        a, b = p[keep], still[keep]
        p = np.clip((p - a.mean(0)) / np.maximum(a.std(0), 1e-3) * b.std(0) + b.mean(0), 0, 1)
        small = (max(8, W // 4), max(8, H // 4))
        kp = cv2.resize(keep.astype(np.float32), small, interpolation=cv2.INTER_AREA) > 0.99
        diff = cv2.resize(still - p, small, interpolation=cv2.INTER_AREA)
        corr = np.stack([_pushpull(np.where(kp, diff[..., c], 0), kp, smooth=0.003) for c in range(3)], -1)
        P[k] = np.clip(p + cv2.resize(corr, (W, H), interpolation=cv2.INTER_CUBIC), 0, 1)
    out = still.copy()
    for n, ps in parts.items():
        for pt, k in ps:
            m = (cv2.dilate(pt.astype(np.uint8), disk(r)) > 0).astype(np.float32)
            m = np.maximum(cv2.GaussianBlur(m, (0, 0), r / 2), pt)[..., None]
            out = out * (1 - m) + P[k] * m
    report = {"erased": [n for n, k in src.items() if k], "kept": [n for n, k in src.items() if not k],
              "source": src, "main": plan.get("main", "")}
    return out.astype(np.float32), report


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
                 ring=0.004, **kw):
    """The set, erase first. Scenery: the erased picture split by every name that wasn't erased (SAM looked for them in
    the erased picture, so a sky goes on behind where a lander stood). Things: cutouts from the still, each drawn
    right after the last scenery layer it stood in front of, their depth from the still's depth map fitted to the
    erased picture's. Returns (layers, info) as build does."""
    h, w = still.shape[:2]
    still = still[..., :3].astype(np.float32)
    erased = [n for n in erased if n in names]
    sn = [n for n in names if n not in erased]
    layers_bg, info = build(erased_img, near_erased, _scenery_masks(masks, masks_erased, names, sn, erased, w, h, **kw),
                            sn, far=far, band=band, **kw)
    if not erased:
        rest_exact([L["rgba"] for L in layers_bg], still)
        return layers_bg, dict(info, erased=[])
    disk = lambda k: cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * k + 1, 2 * k + 1))
    cores = {n: cv2.resize(np.asarray(masks[names.index(n)], np.float32), (w, h), interpolation=cv2.INTER_LINEAR) > 0.5 for n in erased}
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
    lo, _ = build(still, None, [masks[names.index(n)] for n in erased], erased, far=far, band=band, z_override=z_things,
                  exact=False, **kw)
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
        inner = inner if inner.sum() >= 16 else c
        F = np.stack([_fill_nearest(np.where(inner, still[..., i], 0), inner) for i in range(3)], -1)
        F = np.where(inner[..., None], L["rgba"][..., :3], cv2.GaussianBlur(F, (0, 0), 1.0))
        band_px = (cv2.dilate(c.astype(np.uint8), disk(2 * r)) > 0) & ~inner
        d = F - below
        den = (d * d).sum(-1)
        a_new = np.clip(((still - below) * d).sum(-1) / np.maximum(den, 1e-6), 0, 1)
        solve = band_px & (den > 0.05 ** 2)
        al = L["rgba"][..., 3]
        al[solve] = a_new[solve]
        al[band_px & ~solve & ~c] = np.minimum(al[band_px & ~solve & ~c], 0.0)
        L["rgba"][..., :3] = np.where(band_px[..., None], F, L["rgba"][..., :3])
    # each thing owns the ring it was erased from: what the still shows there beyond the plate is the thing's glow
    rest_exact([L["rgba"] for L in layers], still, own=[reach.get(L["name"]) for L in layers])
    zc = info["border"]
    z_all = np.where(things, z_things, np.inf)
    info = dict(info, erased=erased)
    info["border"] = {s: [min(a1, b1) for a1, b1 in zip(zc[s], _border(np.where(np.isfinite(z_all), z_all, far))[s])] for s in zc}
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
