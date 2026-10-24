"""A Valis stage as 3D Gaussians: every pixel of every layer (its own paint and the completion painted behind nearer
layers) becomes one splat, placed where the original camera saw it, sized to its pixel's footprint at that depth.
No training: it is the stage's layered depth image written in the standard 3DGS .ply format, so any splat viewer or
engine (SuperSplat, Spark, Blender add-ons, game engines) can open the set Valis built.

    python splat.py STAGE_DIR OUT.(ply|splat) [--stride 1] [--backdrop-stride N] [--fov 50] [--flat]
"""
import argparse
import json
import os

import cv2
import numpy as np

C0 = 0.28209479177387814          # SH degree-0 constant


def load(folder):
    with open(os.path.join(folder, "stage.json")) as f:
        meta = json.load(f)
    return meta


def _quat(R):
    """rotation matrices (n,3,3) with the splat's local axes as columns -> unit quaternions (n,4) as w,x,y,z"""
    m = R
    t = m[:, 0, 0] + m[:, 1, 1] + m[:, 2, 2]
    q = np.zeros((len(m), 4), np.float64)
    c0 = t > 0
    s = np.sqrt(np.maximum(t[c0] + 1.0, 1e-12)) * 2
    q[c0] = np.stack([0.25 * s, (m[c0, 2, 1] - m[c0, 1, 2]) / s, (m[c0, 0, 2] - m[c0, 2, 0]) / s, (m[c0, 1, 0] - m[c0, 0, 1]) / s], 1)
    for i, (a, b, c) in enumerate(((0, 1, 2), (1, 2, 0), (2, 0, 1))):
        ci = ~c0 & (m[:, a, a] >= m[:, b, b]) & (m[:, a, a] >= m[:, c, c])
        c0 = c0 | ci
        s = np.sqrt(np.maximum(1.0 + m[ci, a, a] - m[ci, b, b] - m[ci, c, c], 1e-12)) * 2
        v = np.zeros((ci.sum(), 4))
        v[:, 0] = (m[ci, c, b] - m[ci, b, c]) / s
        v[:, 1 + a] = 0.25 * s
        v[:, 1 + b] = (m[ci, b, a] + m[ci, a, b]) / s
        v[:, 1 + c] = (m[ci, c, a] + m[ci, a, c]) / s
        q[ci] = v
    return q / np.linalg.norm(q, axis=1, keepdims=True)


def layer_points(folder, meta, L, stride, f0, orient=True, snap=True, feather=0.0):
    rgba = cv2.cvtColor(cv2.imread(os.path.join(folder, L["image"]), cv2.IMREAD_UNCHANGED), cv2.COLOR_BGRA2RGBA)
    dp = cv2.cvtColor(cv2.imread(os.path.join(folder, L["depth"])), cv2.COLOR_BGR2RGB).astype(np.uint32)
    far = meta["far"]
    z = 1.0 + (dp[..., 0] * 256 + dp[..., 1]) / 65535.0 * (far - 1.0)
    relief = L.get("relief", 1.0 if L.get("backdrop") else 0.35)     # the same flattening the studio's camera uses
    z = (L["z_med"] + (z - L["z_med"]) * relief).astype(np.float64)
    H, W = z.shape
    if snap:
        # depth maps are soft at edges, so a jump (an arm in front of the chest, a wall behind a shoulder) becomes a ramp
        # of in-between depths: a curtain of floating splats once the camera moves. Snap every pixel on a steep ramp to
        # whichever side of the jump it is nearer, so the edge splits cleanly and nothing floats between.
        k = np.ones((7, 7), np.uint8)
        z32 = z.astype(np.float32)
        lo, hi = cv2.erode(z32, k), cv2.dilate(z32, k)
        steep = (hi - lo) > 0.12 * lo                     # a jump of 12% in depth within 7 px (a floor never does that)
        z = np.where(steep, np.where(z - lo < hi - z, lo, hi), z)
    gy, gx = np.mgrid[0:H, 0:W].astype(np.float64)
    # the 3DGS/COLMAP convention every .ply from training uses (x right, y down, the camera looking down +z): splat
    # tools expect it (SuperSplat turns PLY data 180 degrees about z to show it upright), and it is the studio's own
    P = np.stack([(gx + 0.5 - W / 2) / f0 * z, (gy + 0.5 - H / 2) / f0 * z, z], -1)
    ys, xs = np.mgrid[0:H:stride, 0:W:stride]
    a = rgba[ys, xs, 3].astype(np.float32) / 255.0
    keep = a > 0.35
    if feather > 0 and not L.get("outer"):
        # the set fades out over the last few % at the frame's edge, into the dome behind it, instead of ending on a
        # cut a moving camera would see as a hard wall edge (a layer painted past the frame carries on instead)
        e = np.minimum(np.minimum(xs + 0.5, W - 0.5 - xs), np.minimum(ys + 0.5, H - 0.5 - ys)) / (feather * W)
        e = np.clip(e, 0, 1)
        a = a * (e * e * (3 - 2 * e))
        keep &= a > 0.01
    ys, xs, a = ys[keep], xs[keep], a[keep]
    zz = z[ys, xs]
    col = rgba[ys, xs, :3].astype(np.float32) / 255.0
    pos = P[ys, xs]
    n = len(pos)
    foot = stride * zz / f0                               # the sample's footprint facing the camera
    rot = np.zeros((n, 4), np.float32); rot[:, 0] = 1.0
    S = np.stack([foot * 0.62, foot * 0.62, foot * 0.15], 1)
    if orient:
        # lay each splat along the surface the depth describes (central differences inside the layer), so a slanted
        # floor or a sleeve turning away stays closed when the camera moves instead of breaking into rows of dots
        x0, x1 = np.clip(xs - 1, 0, W - 1), np.clip(xs + 1, 0, W - 1)
        y0, y1 = np.clip(ys - 1, 0, H - 1), np.clip(ys + 1, 0, H - 1)
        al = rgba[..., 3] > 89
        ok = al[ys, x0] & al[ys, x1] & al[y0, xs] & al[y1, xs]
        du = (P[ys, x1] - P[ys, x0]) / np.maximum(1, x1 - x0)[:, None]
        dv = (P[y1, xs] - P[y0, xs]) / np.maximum(1, y1 - y0)[:, None]
        lu, lv = np.linalg.norm(du, axis=1), np.linalg.norm(dv, axis=1)
        unit = zz / f0
        ok &= (lu < 4 * unit) & (lv < 4 * unit)           # a jump inside the layer: keep that sample camera-facing
        t1 = du / np.maximum(lu, 1e-9)[:, None]
        nr = np.cross(du, dv); nl = np.linalg.norm(nr, axis=1); ok &= nl > 1e-12
        nr = nr / np.maximum(nl, 1e-12)[:, None]
        t2 = np.cross(nr, t1)
        s2 = np.abs((dv * t2).sum(1))
        R = np.stack([t1, t2, nr], 2)                      # columns: the splat's local axes in the world
        q = _quat(R[ok])
        rot[ok] = q
        S[ok, 0] = stride * lu[ok] * 0.62
        S[ok, 1] = stride * np.maximum(s2[ok], 0.25 * lv[ok]) * 0.62
        S[ok, 2] = foot[ok] * 0.08
    more = outer_points(folder, meta, L, stride, f0, rgba, z) if L.get("outer") and (meta.get("outer") or {}).get("margin") else None
    if more is not None:
        pos = np.concatenate([pos, more[0]]); col = np.concatenate([col, more[1]]); a = np.concatenate([a, more[2]])
        S = np.concatenate([S, more[3]]); rot = np.concatenate([rot, more[4]])
    return pos.astype(np.float32), col, a, S.astype(np.float32), rot


def outer_points(folder, meta, L, stride, f0, rgba, z):
    """a backdrop's painted margin past the frame (outer_XX.png) as splats, as splat.js writes them: at the layer's
    depth at the nearest frame-edge pixel, only where this layer (or one nearer) is what the camera sees there, fading
    out over the margin's last stretch into the dome"""
    path = os.path.join(folder, L["outer"])
    if not os.path.exists(path):
        return None
    op = cv2.cvtColor(cv2.imread(path, cv2.IMREAD_UNCHANGED), cv2.COLOR_BGRA2RGBA)
    H, W = z.shape
    M = float(meta["outer"]["margin"]); k = 1 + 2 * M
    oh, ow = op.shape[:2]
    os_ = max(2, int(round(stride * ow / (W * k))))
    jj, ii = np.mgrid[0:oh:os_, 0:ow:os_]
    u = -M + (ii + 0.5) / ow * k
    v = -M + (jj + 0.5) / oh * k
    out = (u < 0) | (u > 1) | (v < 0) | (v > 1)
    keep = out & (op[jj, ii, 3] >= 128)
    d = np.maximum.reduce([-u, u - 1, -v, v - 1, np.zeros_like(u)])
    e = 1 - np.clip((d - (M - 0.04)) / 0.04, 0, 1)
    a = (e * e * (3 - 2 * e)).astype(np.float32)
    keep &= a > 0.01
    ex = np.clip(np.floor(u * W).astype(int), 0, W - 1)
    ey = np.clip(np.floor(v * H).astype(int), 0, H - 1)
    keep &= rgba[ey, ex, 3] > 89
    u, v, a, ex, ey, jj, ii = u[keep], v[keep], a[keep], ex[keep], ey[keep], jj[keep], ii[keep]
    zz = z[ey, ex]
    X, Y = u * W, v * H
    P = np.stack([(X - W / 2) / f0 * zz, (Y - H / 2) / f0 * zz, zz], 1).astype(np.float32)
    C = op[jj, ii, :3].astype(np.float32) / 255.0
    foot = os_ * (W * k / ow) * zz / f0
    S = np.stack([foot * 0.62, foot * 0.62, foot * 0.15], 1).astype(np.float32)
    Q = np.zeros((len(P), 4), np.float32); Q[:, 0] = 1.0
    return P, C, a, S, Q


def dome_texture(folder, meta):
    """the stage's dome map (dome.png, written when the still was split), or made now for an older stage"""
    d = meta.get("dome")
    if d and os.path.exists(os.path.join(folder, d["image"])):
        tex = cv2.cvtColor(cv2.imread(os.path.join(folder, d["image"])), cv2.COLOR_BGR2RGB).astype(np.float32) / 255
        return tex, d
    try:
        import stage as ST
    except ImportError:
        from . import stage as ST
    rgba = [cv2.cvtColor(cv2.imread(os.path.join(folder, L["image"]), cv2.IMREAD_UNCHANGED), cv2.COLOR_BGRA2RGBA).astype(np.float32) / 255 for L in meta["layers"]]
    d = dict(ST.DOME)
    return ST.dome_map(ST.composite([{"rgba": x} for x in rgba]), rgba[0], **{k: d[k] for k in ("fov", "step", "yaw", "pitch")}), d


def dome_points(folder, meta, radius=None):
    """The dome as splats on a sphere around the original camera, three times as far as the set's farthest point:
    a camera moving through the set barely moves against it, the way a sky or a painted cyclorama behaves."""
    tex, d = dome_texture(folder, meta)
    d = dict(d)
    k = int(np.ceil(np.sqrt(tex.shape[0] * tex.shape[1] / 150000)))     # a painted dome has 4x the texels: keep ~120-150k splats
    if k > 1:
        tex = cv2.resize(tex, (tex.shape[1] // k, tex.shape[0] // k), interpolation=cv2.INTER_AREA)
        d["step"] = d["step"] * k
    ny, nx = tex.shape[:2]
    ya = np.radians(np.linspace(-d["yaw"], d["yaw"], nx))[None, :].repeat(ny, 0)
    pa = np.radians(np.linspace(d["pitch"], -d["pitch"], ny))[:, None].repeat(nx, 1)
    R = radius or 3.0 * meta["far"]
    n_ = np.stack([np.sin(ya) * np.cos(pa), -np.sin(pa), np.cos(ya) * np.cos(pa)], -1).reshape(-1, 3)   # y down, +z ahead
    pos = (n_ * R).astype(np.float32)
    col = tex.reshape(-1, 3)
    n = len(pos)
    a = np.full(n, 0.98, np.float32)
    # discs tangent to the sphere (thin along the ray from the camera), a texel wide
    t1 = np.cross(np.array([0.0, -1.0, 0.0]), n_); t1 /= np.maximum(np.linalg.norm(t1, axis=1, keepdims=True), 1e-9)
    t2 = np.cross(n_, t1)
    rot = _quat(np.stack([t1, t2, n_], 2)).astype(np.float32)
    w = R * np.radians(d["step"])
    S = np.stack([w * 0.75 * np.cos(pa).reshape(-1).clip(0.2, 1), np.full(n, w * 0.75), np.full(n, w * 0.05)], 1).astype(np.float32)
    return pos, col, a, S, rot


def write_ply(path, P, C, A, S, Q, label=None):
    n = len(P)
    a = np.clip(A, 1e-4, 1 - 1e-4)
    opacity = np.log(a / (1 - a))
    dc = (C - 0.5) / C0
    logs = np.log(np.maximum(S, 1e-7))
    rot = Q
    nrm = np.zeros((n, 3), np.float32)
    cols = [P, nrm, dc, opacity[:, None], logs, rot]
    data = np.concatenate([c.astype(np.float32) for c in cols], 1)
    names = ["x", "y", "z", "nx", "ny", "nz", "f_dc_0", "f_dc_1", "f_dc_2", "opacity",
             "scale_0", "scale_1", "scale_2", "rot_0", "rot_1", "rot_2", "rot_3"]
    note = "".join(f"comment {x}\n" for x in (label or "").splitlines() if x.strip())     # the file says what it is
    head = "ply\nformat binary_little_endian 1.0\n" + note + "element vertex %d\n" % n + "".join(f"property float {k}\n" for k in names) + "end_header\n"
    with open(path, "wb") as f:
        f.write(head.encode())
        f.write(data.tobytes())


def write_splat(path, P, C, A, S, Q):
    """antimatter15 .splat (32 bytes a splat: position, scale, RGBA, rotation), half the size of .ply; most viewers open it."""
    n = len(P)
    rec = np.zeros(n, dtype=[("p", "<f4", 3), ("s", "<f4", 3), ("c", "u1", 4), ("q", "u1", 4)])
    rec["p"] = P; rec["s"] = S
    rec["c"][:, :3] = np.clip(C * 255 + .5, 0, 255).astype(np.uint8); rec["c"][:, 3] = np.clip(A * 255 + .5, 0, 255).astype(np.uint8)
    rec["q"] = np.clip(Q * 128 + 128, 0, 255).astype(np.uint8)    # w,x,y,z as (q * 128 + 128)
    order = np.argsort(-(S.prod(1) * A))                          # biggest, most opaque first (what viewers expect)
    with open(path, "wb") as f:
        f.write(rec[order].tobytes())


def stage_to_ply(folder, out, stride=1, fov=50.0, backdrop_stride=None, orient=True, dome=True, feather=0.03):
    meta = load(folder)
    W = meta["width"]
    f0 = (W / 2) / np.tan(np.radians(fov / 2))
    Ps, Cs, As, Ss, Qs = [], [], [], [], []
    n = len(meta["layers"])
    for r, L in enumerate(meta["layers"]):
        st = (backdrop_stride or stride) if L.get("backdrop") else stride
        P, C, A, S, Q = layer_points(folder, meta, L, st, f0, orient, feather=feather)
        Ps.append(P); Cs.append(C); As.append(A); Ss.append(S); Qs.append(Q)
    if dome:
        P, C, A, S, Q = dome_points(folder, meta)
        Ps.append(P); Cs.append(C); As.append(A); Ss.append(S); Qs.append(Q)
    P, C, A, S, Q = (np.concatenate(x) for x in (Ps, Cs, As, Ss, Qs))
    if out.endswith(".splat"):
        write_splat(out, P, C, A, S, Q)
    else:
        name = os.path.basename(os.path.normpath(folder))
        write_ply(out, P, C, A, S, Q, label=f"VALIS 3D set: {name} ({len(P)} splats, dome {'on' if dome else 'off'})\n"
                  "axes: x right, y down, +z ahead (COLMAP); the original camera sits at 0,0,0 looking down +z\n"
                  "open in SuperSplat; a camera move from Valis Studio (Save the camera move) drops onto it")
    return len(P)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("stage"); ap.add_argument("out")
    ap.add_argument("--stride", type=int, default=1); ap.add_argument("--backdrop-stride", type=int, default=None)
    ap.add_argument("--fov", type=float, default=50.0); ap.add_argument("--flat", action="store_true", help="camera-facing splats (no surface orientation)")
    ap.add_argument("--no-dome", action="store_true", help="leave out the far dome (the world past the frame)")
    ap.add_argument("--feather", type=float, default=0.03, help="fade the set out over this fraction of the width at the frame edge (0: a hard cut)")
    a = ap.parse_args()
    n = stage_to_ply(a.stage, a.out, a.stride, a.fov, a.backdrop_stride, not a.flat, not a.no_dome, a.feather)
    print(f"wrote {n} splats to {a.out} ({os.path.getsize(a.out) / 1e6:.1f} MB)")
