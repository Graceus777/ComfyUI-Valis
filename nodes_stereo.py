"""Valis Stereo: pictures hidden in noise.

Two ways to hide a moving thing in a field of dots:
  - a stereogram (magic eye): the dots repeat across the frame and the repeat distance carries depth. Free-view
    it (parallel or cross-eyed) and the thing stands out of the field in 3D. Young Rival's "Black Is Good" (2014)
    did this with Kinect depth of the band in fresh TV-snow dots every frame; here the depth comes from a SAM 3
    mask, a depth model, a body mesh or a spinning solid.
  - a kinetogram: the thing is made of the same dots as the field and only its dots move, so any paused frame is
    plain noise and the thing exists only while it moves. Nobody has to learn to free-view.

Small nodes (category Valis/Stereo) so they recombine:
  Valis Mask Depth      MASK (SAM 3) -> rounded depth: the silhouette inflated like a balloon, + relief from a depth map
  Valis Depth Shape     a spinning solid (cube, torus, octahedron, heart, star, blob) -> depth + mask
  Valis Depth Place     put one depth into another: where, how big, how near, a straight move, when it enters
  Valis Stereo Pattern  the dots: random, TV snow, colour, a palette or glyphs (any IMAGE works as a pattern too)
  Valis Stereogram      depth (+ pattern) -> the hidden-picture frames
  Valis Kinetogram      mask -> the motion-only frames (chain several, each thing with its own motion)
  Valis Stereo Decode   reads the depth back out of stereogram frames, optionally after an H.264 round trip at a
                        bitrate you set: a check that the picture survives an upload

Depth everywhere is an IMAGE, white = near, black = the field (Depth Anything 3's "depth" output is the same way round).
"""
import math

import numpy as np
import torch
import torch.nn.functional as F

try:
    import comfy.model_management as _mm
    import comfy.utils as _cu
except Exception:                      # outside ComfyUI (tests)
    _mm = None
    _cu = None

CAT = "Valis/Stereo"
SHAPES = ["cube", "torus", "octahedron", "heart", "star", "blob"]
KINDS = ["dots", "snow", "color"]


# ---------------------------------------------------------------------------------------------------------- helpers

def _device():
    if _mm is not None:
        try:
            return _mm.get_torch_device()
        except Exception:
            pass
    return torch.device("cuda" if torch.cuda.is_available() else "cpu")


def _check_interrupt():
    if _mm is not None:
        _mm.throw_exception_if_processing_interrupted()


class _Progress:
    def __init__(self, total):
        self.bar = _cu.ProgressBar(total) if _cu is not None else None

    def update(self, n=1):
        if self.bar is not None:
            self.bar.update(n)


def _grey(img):
    img = img.float()
    if img.shape[-1] >= 3:
        return 0.299 * img[..., 0] + 0.587 * img[..., 1] + 0.114 * img[..., 2]
    return img[..., 0]


def _depth_tensor(x):
    """IMAGE [B,H,W,C] or MASK [B,H,W] / [H,W] -> float [B,H,W]. Depth pictures are grey, so an IMAGE's first
    channel is the depth (no copy)."""
    if x.ndim == 4:
        return x[..., 0].float()
    if x.ndim == 2:
        return x[None].float()
    return x.float()


def _mask_tensor(m):
    if m is None:
        return None
    if m.ndim == 2:
        m = m[None]
    if m.ndim == 4:
        m = _grey(m)
    return m.float()


def _to_image(z):
    """[B,H,W] -> IMAGE [B,H,W,3] on the CPU."""
    z = z.clamp(0, 1).float().cpu()
    return z[..., None].repeat(1, 1, 1, 3)


def _resize_bhw(x, h, w, mode="bilinear"):
    if x.shape[-2:] == (h, w):
        return x
    kw = {"align_corners": False} if mode == "bilinear" else {}
    return F.interpolate(x[:, None], size=(h, w), mode=mode, **kw)[:, 0]


def _parse_hex(s):
    out = []
    for part in (s or "").replace(";", ",").split(","):
        p = part.strip().lstrip("#")
        if len(p) == 3:
            p = "".join(c * 2 for c in p)
        if len(p) == 6:
            try:
                out.append([int(p[i:i + 2], 16) / 255.0 for i in (0, 2, 4)])
            except ValueError:
                pass
    return out


def _cells(kind, hc, wc, gen, density=0.5, palette=None):
    """Random dot cells [hc, wc, 3] in 0..1 (CPU)."""
    if palette:
        pal = torch.tensor(palette, dtype=torch.float32)
        idx = torch.randint(0, len(palette), (hc, wc), generator=gen)
        return pal[idx]
    if kind == "dots":
        v = (torch.rand(hc, wc, generator=gen) < density).float()
        return v[..., None].repeat(1, 1, 3)
    if kind == "snow":
        v = torch.rand(hc, wc, generator=gen)
        return v[..., None].repeat(1, 1, 3)
    return torch.rand(hc, wc, 3, generator=gen)                     # color


def _upsample_cells(cells, h, w, dot):
    """Nearest-upsample dot cells to [h, w, 3]."""
    return cells.repeat_interleave(dot, 0).repeat_interleave(dot, 1)[:h, :w]


def _auto_period(width, period):
    return int(period) if period and period > 0 else max(24, int(round(width / 9.0)))


# ---------------------------------------------------------------------------------------------------- stereogram core

def _chain(u, sep, start, T, row_start=None, lo=0):
    """Fill u[:, start:] so that u(x) = u(x - sep(x)).

    u, sep: [N, W]. Columns < start (and, per row, < row_start) already hold texture coordinates and are kept.
    Works in strips no wider than the smallest separation, so every source pixel of a strip lies left of it: one
    gather per strip for all rows and frames at once. Sources are read linearly between pixels, except across a
    jump in u (two unrelated chains side by side), where the nearer one is taken.

    Where the separation grows faster than half a pixel per pixel (just past the far side of a near thing), one eye
    cannot see the surface the link would join, and copying would smear one source across many pixels. Those pixels
    get fresh texture instead (columns T..2T of the strip): hidden-surface removal, as in Thimbleby, Inglis & Witten.
    """
    N, W = u.shape
    free = torch.zeros_like(sep, dtype=torch.bool)
    free[:, 1:] = (sep[:, 1:] - sep[:, :-1]) > 0.5
    smin = float(sep.min())
    m = max(1, int(math.floor(smin)) - 1)
    cols = torch.arange(W, device=u.device, dtype=sep.dtype)
    x = start
    while x < W:
        x1 = min(W, x + m)
        c = cols[x:x1][None, :]
        src = (c - sep[:, x:x1]).clamp(min=lo)
        i0 = src.floor().long().clamp(0, W - 1)
        i1 = (i0 + 1).clamp(max=W - 1)
        fr = src - i0.to(src.dtype)
        u0 = torch.gather(u, 1, i0)
        u1 = torch.gather(u, 1, i1)
        d = u1 - u0
        new = torch.where(d.abs() <= 1.5, u0 + fr * d, torch.where(fr < 0.5, u0, u1))
        new = torch.where(free[:, x:x1], T + torch.remainder(c, T), new)
        if row_start is not None:
            new = torch.where(c >= row_start[:, None], new, u[:, x:x1])
        u[:, x:x1] = new
        x = x1
    return u


def strip_width(P, D):
    """T: wider than any separation, so a seed strip never repeats inside itself. Strips are 2T wide: the seed
    texture, then the fresh texture for pixels only one eye sees."""
    return int(math.ceil(P + D)) + 2


def stereo_coords(z, P, D, viewing="parallel", anchor="center"):
    """Depth z [B,H,W] (1 = near) -> texture column u [B,H,W] in [0, 2 * strip_width(P, D)).

    Separation is P for the field (z = 0). Parallel viewing: near things repeat closer (P - D z);
    cross-eyed: farther apart (P + D z). Depth is read near the midpoint of each link (x -/+ P/2), so the hidden thing
    sits where it is in the depth map. anchor=center grows the pattern both ways from a seed strip in the middle,
    which halves the texture shift a moving thing drags through the field beside it. The seed strip is exactly one
    separation wide on each row (the separation at the seam), so a thing standing on the seam keeps its depth there.
    """
    B, H, W = z.shape
    sign = 1.0 if viewing == "cross" else -1.0
    smax = P + D
    if smax + 4 > W:
        raise ValueError(f"period {P}px (+depth) is too wide for a {W}px frame")
    a = int((W - P) // 2) if anchor == "center" else 0
    h = int(P // 2)
    zz = z.reshape(B * H, W)
    zr = torch.cat([zz[:, :1].expand(-1, h), zz[:, :W - h]], 1) if h > 0 else zz   # depth at x - P/2
    zl = torch.cat([zz[:, h:], zz[:, -1:].expand(-1, h)], 1) if h > 0 else zz      # depth at x + P/2
    sep_r = P + sign * D * zr
    sep_l = P + sign * D * zl
    seam = min(W - 1, a + h)
    s_c = (P + sign * D * zz[:, seam]).round().clamp(2, W - a - 2)                  # seed width per row
    cols = torch.arange(W, device=z.device, dtype=z.dtype)
    u = (cols[None, :] - a).clamp(min=0).expand(B * H, W).clone()                   # seed: u = x - a
    row_start = a + s_c
    T = strip_width(P, D)
    u = _chain(u, sep_r, int(row_start.min()), T, row_start, lo=a)
    if a > 0:
        uf = _chain(u.flip(1).contiguous(), sep_l.flip(1).contiguous(), W - a, T)
        u = uf.flip(1)
    return u.reshape(B, H, W)


def sample_strip(strip, u):
    """strip [B,H,T,C], u [B,H,W] in [0,T) -> [B,H,W,C], linear between texels."""
    B, H, T, C = strip.shape
    f = u - u.floor()
    i0 = u.floor().long().clamp(0, T - 1)
    i1 = (i0 + 1) % T
    g0 = torch.gather(strip, 2, i0[..., None].expand(-1, -1, -1, C))
    g1 = torch.gather(strip, 2, i1[..., None].expand(-1, -1, -1, C))
    return g0 + (g1 - g0) * f[..., None]


def _strip_from_image(img, H, P):
    """A picture [Hp,Wp,C] -> a strip [H,P,3]: scaled to height H, the centre P columns (tiled when narrower)."""
    img = img[..., :3].float()
    if img.shape[-1] == 1:
        img = img.repeat(1, 1, 3)
    hp, wp = img.shape[:2]
    wn = max(1, int(round(wp * H / hp)))
    x = F.interpolate(img.permute(2, 0, 1)[None], size=(H, wn), mode="bilinear", align_corners=False)[0].permute(1, 2, 0)
    if wn < P:
        x = x.repeat(1, int(math.ceil(P / wn)), 1)
        wn = x.shape[1]
    c = (wn - P) // 2
    return x[:, c:c + P].contiguous()


def _guide_dots(frames, P, cx=None):
    """Two dots P apart near the top: free-view until they become three."""
    B, H, W, C = frames.shape
    y0 = max(8, int(round(H * 0.045)))
    r = max(3.0, P / 16.0)
    cx = W / 2.0 if cx is None else cx
    yy = torch.arange(H, device=frames.device, dtype=torch.float32)[:, None]
    xx = torch.arange(W, device=frames.device, dtype=torch.float32)[None, :]
    ring = torch.zeros(H, W, dtype=torch.bool, device=frames.device)
    dot = torch.zeros_like(ring)
    for x0 in (cx - P / 2.0, cx + P / 2.0):
        d2 = (yy - y0) ** 2 + (xx - x0) ** 2
        ring |= d2 <= (r * 1.6) ** 2
        dot |= d2 <= r ** 2
    frames[:, ring] = 1.0
    frames[:, dot] = 0.0
    return frames


# ------------------------------------------------------------------------------------------------------- depth nodes

def _profile(t, kind):
    t = np.clip(t, 0.0, 1.0)
    if kind == "dome":
        return np.sqrt(1.0 - (1.0 - t) ** 2)
    if kind == "pillow":
        return t * t * (3.0 - 2.0 * t)
    if kind == "cone":
        return t
    return (t > 0).astype(np.float32)                                # flat


class ValisMaskDepth:
    DESCRIPTION = ("A mask becomes a rounded depth: the silhouette inflated like a balloon, standing off the field. "
                   "Feed it SAM 3 (SAM3_TrackToMask). A depth map (Depth Anything 3, DA3Render 'depth') adds the "
                   "thing's own relief inside the mask.")

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
                    "mask": ("MASK",),
                    "thickness": ("FLOAT", {"default": 0.06, "min": 0.005, "max": 0.5, "step": 0.005, "tooltip": "how far in from the edge the shape reaches full height, as a share of the frame's short side (thin limbs stay thinner)"}),
                    "profile": (["dome", "pillow", "cone", "flat"], {"default": "dome"}),
                    "edge": ("FLOAT", {"default": 0.4, "min": 0.0, "max": 1.0, "step": 0.01, "tooltip": "depth at the silhouette edge: how far the whole thing stands off the field (0 = it grows out of the field)"}),
                    "near": ("FLOAT", {"default": 1.0, "min": 0.0, "max": 1.0, "step": 0.01, "tooltip": "depth at the thickest point"}),
                    "smooth": ("FLOAT", {"default": 2.0, "min": 0.0, "max": 32.0, "step": 0.5, "tooltip": "blur, px"}),
                    "temporal": ("FLOAT", {"default": 0.0, "min": 0.0, "max": 0.95, "step": 0.05, "tooltip": "carry some of the last frame's depth: steadier, but fast moves leave trails"}),
                },
                "optional": {
                    "relief": ("IMAGE", {"tooltip": "a depth map of the same clip (white = near), e.g. Depth Anything 3"}),
                    "relief_amount": ("FLOAT", {"default": 0.35, "min": 0.0, "max": 2.0, "step": 0.05}),
                    "relief_far_is_white": ("BOOLEAN", {"default": False}),
                }}

    RETURN_TYPES = ("IMAGE", "MASK")
    RETURN_NAMES = ("depth", "mask")
    FUNCTION = "run"
    CATEGORY = CAT

    def run(self, mask, thickness, profile, edge, near, smooth, temporal, relief=None, relief_amount=0.35,
            relief_far_is_white=False):
        import cv2
        m = _mask_tensor(mask).cpu().numpy()
        B, H, W = m.shape
        R = max(1.0, thickness * min(H, W))
        rel = None
        if relief is not None and relief_amount > 0:
            r = _depth_tensor(relief.cpu())
            r = _resize_bhw(r, H, W).numpy()
            rel = 1.0 - r if relief_far_is_white else r
        out = np.zeros((B, H, W), np.float32)
        prev = None
        bar = _Progress(B)
        for i in range(B):
            mi = (m[i] > 0.5).astype(np.uint8)
            z = np.zeros((H, W), np.float32)
            if mi.any():
                d = cv2.distanceTransform(mi, cv2.DIST_L2, 5)
                t = d / R
                z = np.where(mi > 0, edge + (near - edge) * _profile(t, profile), 0.0).astype(np.float32)
                if rel is not None:
                    ri = rel[i % rel.shape[0]]
                    vals = ri[mi > 0]
                    lo, hi = np.percentile(vals, 5), np.percentile(vals, 95)
                    rn = np.clip((ri - np.median(vals)) / max(hi - lo, 1e-4), -0.6, 0.6)
                    z = np.where(mi > 0, z + relief_amount * (near - edge) * rn, 0.0).astype(np.float32)
            if smooth > 0:
                z = cv2.GaussianBlur(z, (0, 0), smooth)
            if temporal > 0 and prev is not None:
                z = (1 - temporal) * z + temporal * prev
            prev = z
            out[i] = np.clip(z, 0, 1)
            bar.update()
        return (_to_image(torch.from_numpy(out)), torch.from_numpy((m > 0.5).astype(np.float32)))


def _rot(ax, ay, az):
    cx, sx, cy, sy, cz, sz = math.cos(ax), math.sin(ax), math.cos(ay), math.sin(ay), math.cos(az), math.sin(az)
    rx = torch.tensor([[1, 0, 0], [0, cx, -sx], [0, sx, cx]], dtype=torch.float32)
    ry = torch.tensor([[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]], dtype=torch.float32)
    rz = torch.tensor([[cz, -sz, 0], [sz, cz, 0], [0, 0, 1]], dtype=torch.float32)
    return rz @ ry @ rx


def _sd_heart(px, py):
    px = px.abs()
    a = torch.sqrt((px - 0.25) ** 2 + (py - 0.75) ** 2) - math.sqrt(2.0) / 4.0
    mm = 0.5 * (px + py).clamp_min(0)
    b = torch.sqrt(torch.minimum(px ** 2 + (py - 1.0) ** 2, (px - mm) ** 2 + (py - mm) ** 2)) * torch.sign(px - py)
    return torch.where(px + py > 1.0, a, b)


def _sd_star5(px, py, r=0.88, rf=0.45):
    k1x, k1y = 0.809016994375, -0.587785252292
    k2x, k2y = -k1x, k1y
    px = px.abs()
    d = (k1x * px + k1y * py).clamp_min(0)
    px, py = px - 2 * d * k1x, py - 2 * d * k1y
    d = (k2x * px + k2y * py).clamp_min(0)
    px, py = px - 2 * d * k2x, py - 2 * d * k2y
    px = px.abs()
    py = py - r
    bax, bay = rf * (-k1y), rf * k1x - 1.0
    h = ((px * bax + py * bay) / (bax * bax + bay * bay)).clamp(0, r)
    return torch.sqrt((px - bax * h) ** 2 + (py - bay * h) ** 2) * torch.sign(py * bax - px * bay)


def _extrude(d2, z, h, rnd):
    wx, wy = d2, z.abs() - h
    return torch.maximum(wx, wy).clamp_max(0) + torch.sqrt(wx.clamp_min(0) ** 2 + wy.clamp_min(0) ** 2) - rnd


def _sdf(shape, x, y, z):
    if shape == "cube":
        b = 0.5
        qx, qy, qz = x.abs() - b, y.abs() - b, z.abs() - b
        return (torch.sqrt(qx.clamp_min(0) ** 2 + qy.clamp_min(0) ** 2 + qz.clamp_min(0) ** 2)
                + torch.maximum(torch.maximum(qx, qy), qz).clamp_max(0) - 0.1)
    if shape == "torus":
        q = torch.sqrt(x * x + y * y) - 0.62                         # the ring faces the camera at rest
        return torch.sqrt(q * q + z * z) - 0.27
    if shape == "octahedron":
        return (x.abs() + y.abs() + z.abs() - 0.95) * 0.57735
    if shape == "heart":
        s = 1.55
        return _extrude(_sd_heart(x / s, y / s + 0.53) * s, z, 0.14, 0.14)
    if shape == "star":
        return _extrude(_sd_star5(x, y), z, 0.12, 0.08)
    # blob
    return (torch.sqrt(x * x + y * y + z * z) - 0.68
            + 0.16 * torch.sin(4.0 * x) * torch.sin(4.0 * y) * torch.sin(4.0 * z)) * 0.5


def render_shape(shape, frames, width, height, size, spin, tilt, edge, near, steps=72, device=None):
    """Sphere-trace a spinning solid. Returns depth [F,H,W] (field 0, edge..near on the thing) and mask [F,H,W]."""
    dev = device or _device()
    S = min(width, height) * size / 2.0
    xs = (torch.arange(width, device=dev, dtype=torch.float32) + 0.5 - width / 2.0) / S
    ys = -(torch.arange(height, device=dev, dtype=torch.float32) + 0.5 - height / 2.0) / S
    Y, X = torch.meshgrid(ys, xs, indexing="ij")
    inside = (X * X + Y * Y) < 1.25 ** 2
    X, Y = X[inside], Y[inside]
    depth = torch.zeros(frames, height, width)
    mask = torch.zeros(frames, height, width)
    tx, ty, tz = [math.radians(a) for a in tilt]
    bar = _Progress(frames)
    for f in range(frames):
        _check_interrupt()
        ph = 2 * math.pi * f / max(1, frames)
        R = _rot(tx + spin[0] * ph, ty + spin[1] * ph, tz + spin[2] * ph).to(dev)
        t = torch.zeros_like(X)
        hit = torch.zeros_like(X, dtype=torch.bool)
        alive = torch.ones_like(hit)
        z0 = -1.6
        for _ in range(steps):
            pz = z0 + t
            # object-space point: R^T p
            qx = R[0, 0] * X + R[1, 0] * Y + R[2, 0] * pz
            qy = R[0, 1] * X + R[1, 1] * Y + R[2, 1] * pz
            qz = R[0, 2] * X + R[1, 2] * Y + R[2, 2] * pz
            d = _sdf(shape, qx, qy, qz)
            newhit = alive & (d < 1e-3)
            hit |= newhit
            alive &= ~newhit
            t = torch.where(alive, t + d.clamp_min(2e-3) * 0.9, t)
            alive &= t < 3.2
            if not bool(alive.any()):
                break
        zh = z0 + t
        nearness = ((0.6 - zh) / 1.6).clamp(0, 1)                    # front (-1) -> 1, the sides (~0) -> ~0.4
        val = torch.where(hit, edge + (near - edge) * nearness, torch.zeros_like(t))
        dz = torch.zeros(height, width, device=dev)
        mz = torch.zeros(height, width, device=dev)
        dz[inside] = val
        mz[inside] = hit.float()
        depth[f] = dz.cpu()
        mask[f] = mz.cpu()
        bar.update()
    return depth, mask


class ValisDepthShape:
    DESCRIPTION = "A spinning solid as depth + mask: hide it in a stereogram or a kinetogram, or place it into a scene."

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
                    "shape": (SHAPES, {"default": "torus"}),
                    "frames": ("INT", {"default": 96, "min": 1, "max": 4096}),
                    "width": ("INT", {"default": 512, "min": 64, "max": 4096, "step": 8}),
                    "height": ("INT", {"default": 512, "min": 64, "max": 4096, "step": 8}),
                    "size": ("FLOAT", {"default": 0.85, "min": 0.05, "max": 1.5, "step": 0.01, "tooltip": "share of the short side"}),
                    "spin_x": ("FLOAT", {"default": 0.5, "min": -16.0, "max": 16.0, "step": 0.05, "tooltip": "turns over the clip"}),
                    "spin_y": ("FLOAT", {"default": 1.0, "min": -16.0, "max": 16.0, "step": 0.05}),
                    "spin_z": ("FLOAT", {"default": 0.0, "min": -16.0, "max": 16.0, "step": 0.05}),
                    "tilt_x": ("FLOAT", {"default": 20.0, "min": -180.0, "max": 180.0, "step": 1.0, "tooltip": "degrees at frame 0"}),
                    "edge": ("FLOAT", {"default": 0.35, "min": 0.0, "max": 1.0, "step": 0.01, "tooltip": "depth of the farthest visible surface"}),
                    "near": ("FLOAT", {"default": 1.0, "min": 0.0, "max": 1.0, "step": 0.01}),
                }}

    RETURN_TYPES = ("IMAGE", "MASK")
    RETURN_NAMES = ("depth", "mask")
    FUNCTION = "run"
    CATEGORY = CAT

    def run(self, shape, frames, width, height, size, spin_x, spin_y, spin_z, tilt_x, edge, near):
        with torch.no_grad():
            d, m = render_shape(shape, frames, width, height, size, (spin_x, spin_y, spin_z), (tilt_x, 0.0, 0.0),
                                edge, near)
        return (_to_image(d), m)


def _background(kind, frames, h, w, level, amount):
    yy = torch.linspace(0, 1, h)[:, None].expand(h, w)
    xx = torch.linspace(0, 1, w)[None, :].expand(h, w)
    out = torch.zeros(frames, h, w)
    for f in range(frames):
        if kind == "tilt":                                           # a floor: the bottom comes toward you
            z = level + amount * yy
        elif kind == "waves":
            ph = 2 * math.pi * f / 96.0
            z = level + amount * 0.5 * (1 + torch.sin(2 * math.pi * (xx * 2.0 + yy * 1.3) + ph)
                                        * torch.cos(2 * math.pi * yy * 1.7 - 0.7 * ph))
        else:
            z = torch.full((h, w), float(level))
        out[f] = z
    return out.clamp(0, 1)


class ValisDepthPlace:
    DESCRIPTION = ("Put a depth (and its mask) into a scene depth: where, how big, how near, a straight move across "
                   "the clip, the frame it enters on. Nearest wins. Chain one per thing; without a scene it starts "
                   "from a field (flat, a tilted floor, or slow waves).")

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
                    "depth": ("IMAGE",),
                    "width": ("INT", {"default": 0, "min": 0, "max": 8192, "step": 8, "tooltip": "canvas without a scene (0 = the depth's size)"}),
                    "height": ("INT", {"default": 0, "min": 0, "max": 8192, "step": 8}),
                    "x": ("FLOAT", {"default": 0.5, "min": -1.0, "max": 2.0, "step": 0.01, "tooltip": "centre, share of the width"}),
                    "y": ("FLOAT", {"default": 0.5, "min": -1.0, "max": 2.0, "step": 0.01}),
                    "scale": ("FLOAT", {"default": 1.0, "min": 0.01, "max": 8.0, "step": 0.01, "tooltip": "height as a share of the canvas height"}),
                    "x_end": ("FLOAT", {"default": -9.0, "min": -9.0, "max": 2.0, "step": 0.01, "tooltip": "where it ends up (-9 = stays put)"}),
                    "y_end": ("FLOAT", {"default": -9.0, "min": -9.0, "max": 2.0, "step": 0.01}),
                    "scale_end": ("FLOAT", {"default": 0.0, "min": 0.0, "max": 8.0, "step": 0.01, "tooltip": "0 = keeps its size"}),
                    "depth_gain": ("FLOAT", {"default": 1.0, "min": 0.0, "max": 4.0, "step": 0.01}),
                    "depth_offset": ("FLOAT", {"default": 0.0, "min": -1.0, "max": 1.0, "step": 0.01}),
                    "start_frame": ("INT", {"default": 0, "min": 0, "max": 100000}),
                    "when_shorter": (["loop", "hold", "leave"], {"default": "loop", "tooltip": "when the scene runs longer than the thing"}),
                    "field": (["flat", "tilt", "waves"], {"default": "flat"}),
                    "field_depth": ("FLOAT", {"default": 0.0, "min": 0.0, "max": 1.0, "step": 0.01}),
                    "field_amount": ("FLOAT", {"default": 0.15, "min": 0.0, "max": 1.0, "step": 0.01}),
                },
                "optional": {"mask": ("MASK",), "scene": ("IMAGE",)}}

    RETURN_TYPES = ("IMAGE", "MASK")
    RETURN_NAMES = ("depth", "mask")
    FUNCTION = "run"
    CATEGORY = CAT

    def run(self, depth, width, height, x, y, scale, x_end, y_end, scale_end, depth_gain, depth_offset, start_frame,
            when_shorter, field, field_depth, field_amount, mask=None, scene=None):
        obj = _depth_tensor(depth.cpu())
        Bo, ho, wo = obj.shape
        om = _mask_tensor(mask.cpu()) if mask is not None else (obj > 1e-3).float()
        if om.shape[-2:] != (ho, wo):
            om = _resize_bhw(om, ho, wo)
        if scene is not None:
            sc = _depth_tensor(scene.cpu()).clone()
            B, H, W = sc.shape
        else:
            H = height or ho
            W = width or wo
            B = start_frame + Bo
            sc = _background(field, B, H, W, field_depth, field_amount)
        out = sc.clone()
        placed = torch.zeros(B, H, W)
        x1 = x if x_end < -8 else x_end
        y1 = y if y_end < -8 else y_end
        s1 = scale if scale_end <= 0 else scale_end
        yy = torch.arange(H, dtype=torch.float32)[:, None].expand(H, W) + 0.5
        xx = torch.arange(W, dtype=torch.float32)[None, :].expand(H, W) + 0.5
        shown = min(Bo, B - start_frame) if when_shorter == "leave" else B - start_frame
        for t in range(B):
            k = t - start_frame
            if k < 0:
                continue
            if k >= Bo:
                if when_shorter == "leave":
                    continue
                k = k % Bo if when_shorter == "loop" else Bo - 1
            a = (t - start_frame) / max(1, shown - 1)               # the move runs over the frames it is on screen
            cx, cy, s = (x + (x1 - x) * a) * W, (y + (y1 - y) * a) * H, scale + (s1 - scale) * a
            oh = s * H
            ow = oh * wo / ho
            grid = torch.stack([(xx - cx) / (ow / 2.0), (yy - cy) / (oh / 2.0)], -1)[None]
            dz = F.grid_sample(obj[k][None, None], grid, mode="bilinear", align_corners=False, padding_mode="zeros")[0, 0]
            mz = F.grid_sample(om[k][None, None], grid, mode="bilinear", align_corners=False, padding_mode="zeros")[0, 0]
            m = mz > 0.5
            dz = (dz / mz.clamp_min(1e-3)) * depth_gain + depth_offset    # undo the edge darkening of the resample
            out[t] = torch.where(m, torch.maximum(out[t], dz.clamp(0, 1)), out[t])
            placed[t] = m.float()
        return (_to_image(out), placed)


# ----------------------------------------------------------------------------------------------------- pattern node

_GLYPHS = "ABCDEFGHJKLMNPQRSTUVWXYZ0123456789#$%&*+=?@<>/\\|"


class ValisStereoPattern:
    DESCRIPTION = ("The dots a stereogram or kinetogram is made of, as frames you can grade, blur or swap for any "
                   "picture (a Valis render, glyphs, film). Stereograms use a strip one period wide from the middle.")

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
                    "kind": (["dots", "snow", "color", "palette", "glyphs"], {"default": "snow"}),
                    "width": ("INT", {"default": 256, "min": 16, "max": 8192, "step": 8}),
                    "height": ("INT", {"default": 1080, "min": 16, "max": 8192, "step": 8}),
                    "frames": ("INT", {"default": 1, "min": 1, "max": 4096, "tooltip": "1 = one pattern held"}),
                    "dot_size": ("INT", {"default": 3, "min": 1, "max": 64}),
                    "density": ("FLOAT", {"default": 0.5, "min": 0.01, "max": 0.99, "step": 0.01, "tooltip": "dots: share of light dots"}),
                    "palette": ("STRING", {"default": "#0b0b10, #f2efe6, #d4462f, #2f6fd4", "tooltip": "palette / glyph colours, HEX, comma separated (glyphs: first = paper)"}),
                    "seed": ("INT", {"default": 0, "min": 0, "max": 0xFFFFFFFF}),
                }}

    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("pattern",)
    FUNCTION = "run"
    CATEGORY = CAT

    def run(self, kind, width, height, frames, dot_size, density, palette, seed):
        out = torch.zeros(frames, height, width, 3)
        pal = _parse_hex(palette)
        for f in range(frames):
            gen = torch.Generator().manual_seed(int(seed) + 7919 * f)
            if kind == "glyphs":
                out[f] = torch.from_numpy(_glyph_frame(width, height, max(6, dot_size * 4), pal, gen))
                continue
            hc, wc = -(-height // dot_size), -(-width // dot_size)
            k = "color" if kind == "color" else ("dots" if kind == "dots" else "snow")
            cells = _cells(k, hc, wc, gen, density, pal if kind == "palette" and pal else None)
            out[f] = _upsample_cells(cells, height, width, dot_size)
        return (out,)


def _glyph_frame(w, h, cell, pal, gen):
    import cv2
    paper = pal[0] if pal else [0.0, 0.0, 0.0]
    inks = pal[1:] if len(pal) > 1 else [[1.0, 1.0, 1.0]]
    img = np.zeros((h, w, 3), np.float32)
    img[:] = paper
    rows, cols = -(-h // cell), -(-w // cell)
    ch = torch.randint(0, len(_GLYPHS), (rows, cols), generator=gen).numpy()
    ink = torch.randint(0, len(inks), (rows, cols), generator=gen).numpy()
    scale = cell / 22.0
    for r in range(rows):
        for c in range(cols):
            cv2.putText(img, _GLYPHS[ch[r, c]], (c * cell + int(cell * 0.12), r * cell + int(cell * 0.85)),
                        cv2.FONT_HERSHEY_SIMPLEX, scale, inks[ink[r, c]], max(1, int(round(scale * 2))), cv2.LINE_AA)
    return np.clip(img, 0, 1)


# ------------------------------------------------------------------------------------------------ stereogram node

def render_stereogram(z, P, D, viewing="parallel", anchor="center", kind="snow", dot_size=3, refresh_every=1,
                      drift=0.0, guide=True, seed=0, pattern=None, chunk=8, device=None):
    """z [B,H,W] (CPU, 0..1, 1 = near) -> frames [B,H,W,3] (CPU)."""
    dev = device or _device()
    B, H, W = z.shape
    out = torch.empty(B, H, W, 3)
    T = strip_width(P, D)
    strips = {}

    def strip_for(t):
        if pattern is not None:
            key = ("p", t % pattern.shape[0])
            if key not in strips:
                strips[key] = _strip_from_image(pattern[key[1]], H, 2 * T)
            s = strips[key]
        else:
            r = 0 if refresh_every <= 0 else t // refresh_every
            key = ("r", r)
            if key not in strips:
                if len(strips) > 64:
                    strips.clear()
                gen = torch.Generator().manual_seed(int(seed) * 1000003 + r)
                cells = _cells(kind, -(-H // dot_size), -(-2 * T // dot_size), gen)
                strips[key] = _upsample_cells(cells, H, 2 * T, dot_size)
            s = strips[key]
        if drift:
            s = torch.roll(s, shifts=int(math.floor(drift * t)) % H, dims=0)
        return s

    bar = _Progress(B)
    for b0 in range(0, B, chunk):
        _check_interrupt()
        b1 = min(B, b0 + chunk)
        zc = z[b0:b1].to(dev).float().clamp(0, 1)
        u = stereo_coords(zc, P, D, viewing, anchor)
        st = torch.stack([strip_for(t) for t in range(b0, b1)]).to(dev)
        fr = sample_strip(st, u).clamp(0, 1)
        if guide:
            fr = _guide_dots(fr, P)
        out[b0:b1] = fr.cpu()
        bar.update(b1 - b0)
    return out


class ValisStereogram:
    DESCRIPTION = ("The hidden picture: the depth becomes repeat distances in a field of dots. Free-view it "
                   "(relax your eyes through the screen for parallel, cross them for cross) until the two guide dots "
                   "become three, and the thing stands out of the field. Held dots (refresh 0) survive upload "
                   "compression: after H.264 at about 2.5 Mb/s on a 1216x704 clip the hidden shape still matched "
                   "0.91 (Valis Stereo Decode), new dots every 3 frames 0.86, and fresh TV snow every frame "
                   "(Black Is Good) only 0.23. Held dots show a moving thing as a ripple to anyone not fusing.")

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
                    "depth": ("IMAGE", {"tooltip": "white = near; a MASK-made depth, Depth Anything 3, a body mesh render..."}),
                    "period": ("INT", {"default": 0, "min": 0, "max": 2048, "tooltip": "repeat distance of the field, px (0 = width / 9). Keep it under your eye spacing on the screen it plays on"}),
                    "strength": ("FLOAT", {"default": 0.18, "min": 0.02, "max": 0.4, "step": 0.01, "tooltip": "the deepest depth, as a share of the period (more = deeper but harder to fuse)"}),
                    "viewing": (["parallel", "cross"], {"default": "parallel"}),
                    "anchor": (["center", "left"], {"default": "center"}),
                    "kind": (KINDS, {"default": "dots", "tooltip": "the dots when no pattern is connected: black and white, grey TV snow, or colour (colour detail is the first thing a codec drops)"}),
                    "dot_size": ("INT", {"default": 4, "min": 1, "max": 32, "tooltip": "px; 3-4 or more survives upload compression"}),
                    "refresh_every": ("INT", {"default": 0, "min": 0, "max": 10000, "tooltip": "new dots every N frames: 0 = the same dots throughout (survives compression best), 1 = TV snow, 3 = a boil"}),
                    "drift": ("FLOAT", {"default": 0.0, "min": -64.0, "max": 64.0, "step": 0.25, "tooltip": "slide the dots down (px per frame); keeps the depth, adds flow"}),
                    "guide_dots": ("BOOLEAN", {"default": True}),
                    "seed": ("INT", {"default": 0, "min": 0, "max": 0xFFFFFFFF}),
                    "width": ("INT", {"default": 0, "min": 0, "max": 8192, "step": 2, "tooltip": "output size (0 = the depth's)"}),
                    "height": ("INT", {"default": 0, "min": 0, "max": 8192, "step": 2}),
                    "depth_far_is_white": ("BOOLEAN", {"default": False}),
                },
                "optional": {"pattern": ("IMAGE", {"tooltip": "any picture or clip as the dots (Valis Stereo Pattern, a render, glyphs)"})}}

    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("frames",)
    FUNCTION = "run"
    CATEGORY = CAT

    def run(self, depth, period, strength, viewing, anchor, kind, dot_size, refresh_every, drift, guide_dots, seed,
            width, height, depth_far_is_white, pattern=None):
        z = _depth_tensor(depth.cpu())
        if depth_far_is_white:
            z = 1.0 - z
        H = height or z.shape[1]
        W = width or z.shape[2]
        z = _resize_bhw(z, H, W)
        P = _auto_period(W, period)
        D = min(strength * P, P - 6)
        with torch.no_grad():
            fr = render_stereogram(z, P, D, viewing, anchor, kind, dot_size, refresh_every, drift, guide_dots, seed,
                                   pattern.cpu() if pattern is not None else None)
        return (fr,)


# ---------------------------------------------------------------------------------------------------- kinetogram

def _centroids(m):
    B = m.shape[0]
    H, W = m.shape[1:]
    yy = torch.arange(H, dtype=torch.float32)[:, None]
    xx = torch.arange(W, dtype=torch.float32)[None, :]
    out = []
    last = (W / 2.0, H / 2.0)
    for i in range(B):
        s = float(m[i].sum())
        if s > 4:
            last = (float((m[i] * xx).sum()) / s, float((m[i] * yy).sum()) / s)
        out.append(last)
    return out


def _flow_coords(images, H, W, drift):
    """Texture coordinates carried along by optical flow (Farneback, on a small copy). [B,H,W,2] float32."""
    import cv2
    g = _grey(images.cpu()).numpy()
    B = g.shape[0]
    sw = min(W, 480)
    sh = max(8, int(round(H * sw / W)))
    small = [cv2.resize((np.clip(g[i % g.shape[0]], 0, 1) * 255).astype(np.uint8), (sw, sh), interpolation=cv2.INTER_AREA)
             for i in range(B)]
    gx, gy = np.meshgrid(np.arange(W, dtype=np.float32), np.arange(H, dtype=np.float32))
    C = np.stack([gx, gy], -1)
    out = np.empty((B, H, W, 2), np.float32)
    out[0] = C
    for t in range(1, B):
        fl = cv2.calcOpticalFlowFarneback(small[t], small[t - 1], None, 0.5, 3, 21, 3, 5, 1.1, 0)
        fl = cv2.resize(fl, (W, H), interpolation=cv2.INTER_LINEAR) * (W / sw)
        C = cv2.remap(C, gx + fl[..., 0], gy + fl[..., 1], cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT)
        C = C - np.array(drift, np.float32)[None, None]
        out[t] = C
    return out


class ValisKinetogram:
    DESCRIPTION = ("The thing is made of the same dots as the field; only its dots move. Pause on any frame and it "
                   "is gone. 'follow' moves its dots with the mask, 'flow' with the footage's own motion (connect "
                   "the clip), and drift keeps a still thing visible. Chain: connect the last kinetogram as the field "
                   "to give each thing its own motion.")

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
                    "mask": ("MASK",),
                    "motion": (["follow", "flow", "drift only"], {"default": "follow"}),
                    "drift_x": ("FLOAT", {"default": 0.0, "min": -64.0, "max": 64.0, "step": 0.25, "tooltip": "the thing's dots slide this much per frame on top of its motion"}),
                    "drift_y": ("FLOAT", {"default": 1.5, "min": -64.0, "max": 64.0, "step": 0.25}),
                    "kind": (KINDS, {"default": "dots"}),
                    "dot_size": ("INT", {"default": 4, "min": 1, "max": 32}),
                    "field_drift_x": ("FLOAT", {"default": 0.0, "min": -64.0, "max": 64.0, "step": 0.25}),
                    "field_drift_y": ("FLOAT", {"default": 0.0, "min": -64.0, "max": 64.0, "step": 0.25}),
                    "seed": ("INT", {"default": 0, "min": 0, "max": 0xFFFFFFFF}),
                },
                "optional": {
                    "images": ("IMAGE", {"tooltip": "the clip, for motion = flow"}),
                    "field": ("IMAGE", {"tooltip": "frames to use as the field (e.g. another kinetogram)"}),
                }}

    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("frames",)
    FUNCTION = "run"
    CATEGORY = CAT

    def run(self, mask, motion, drift_x, drift_y, kind, dot_size, field_drift_x, field_drift_y, seed, images=None,
            field=None):
        m = _mask_tensor(mask.cpu())
        B, H, W = m.shape
        if field is not None:
            fl = field.cpu()[..., :3].float()
            B = max(B, fl.shape[0])
            if fl.shape[1:3] != (H, W):
                fl = F.interpolate(fl.permute(0, 3, 1, 2), size=(H, W), mode="bilinear", align_corners=False).permute(0, 2, 3, 1)
        gen = torch.Generator().manual_seed(int(seed))
        hc, wc = -(-H // dot_size) + 1, -(-W // dot_size) + 1
        bg_cells = _cells(kind, hc, wc, gen)
        ob_cells = _cells(kind, hc, wc, gen)
        coords = None
        if motion == "flow":
            if images is None:
                raise ValueError("motion = flow needs the clip connected to images")
            coords = _flow_coords(images, H, W, (drift_x, drift_y))
        cents = _centroids((m > 0.5).float()) if motion == "follow" else None
        gx = torch.arange(W, dtype=torch.float32)[None, :].expand(H, W)
        gy = torch.arange(H, dtype=torch.float32)[:, None].expand(H, W)
        out = torch.empty(B, H, W, 3)

        def look(cells, cx, cy):
            ix = torch.remainder(torch.floor(cx / dot_size).long(), cells.shape[1])
            iy = torch.remainder(torch.floor(cy / dot_size).long(), cells.shape[0])
            return cells[iy, ix]

        bar = _Progress(B)
        for t in range(B):
            mt = m[min(t, m.shape[0] - 1)] > 0.5
            bg = fl[t % fl.shape[0]] if field is not None else look(bg_cells, gx - field_drift_x * t, gy - field_drift_y * t)
            if coords is not None:
                c = torch.from_numpy(coords[min(t, coords.shape[0] - 1)])
                ox, oy = c[..., 0], c[..., 1]
            else:
                dx, dy = drift_x * t, drift_y * t
                if cents is not None:
                    dx += cents[min(t, len(cents) - 1)][0] - cents[0][0]
                    dy += cents[min(t, len(cents) - 1)][1] - cents[0][1]
                ox, oy = gx - dx, gy - dy
            ob = look(ob_cells, ox, oy)
            out[t] = torch.where(mt[..., None], ob, bg)
            bar.update()
        return (out,)


# -------------------------------------------------------------------------------------------------------- decode

def h264_roundtrip(frames, fps=24, mbps=8.0, preset="medium"):
    """IMAGE frames [B,H,W,3] (float 0..1) -> uint8 frames [B,H,W,3] after an H.264 (yuv420p) encode at about
    mbps, and the bitrate it really made. Converts one frame at a time to keep memory down."""
    import io
    import av
    B, H, W = frames.shape[:3]
    He, We = H - H % 2, W - W % 2
    buf = io.BytesIO()
    out = av.open(buf, mode="w", format="mp4")
    st = out.add_stream("h264", rate=int(fps))
    st.width, st.height, st.pix_fmt = We, He, "yuv420p"
    st.bit_rate = int(mbps * 1e6)
    try:
        st.options = {"preset": preset}
    except Exception:
        pass
    for i in range(B):
        f = (frames[i, :He, :We, :3].clamp(0, 1) * 255 + 0.5).byte().numpy()
        for p in st.encode(av.VideoFrame.from_ndarray(np.ascontiguousarray(f), format="rgb24")):
            out.mux(p)
    for p in st.encode():
        out.mux(p)
    out.close()
    nbytes = buf.tell()
    buf.seek(0)
    dec = np.zeros((B, H, W, 3), np.uint8)
    with av.open(buf, mode="r") as inp:
        for i, fr in enumerate(inp.decode(video=0)):
            if i >= B:
                break
            dec[i, :He, :We] = fr.to_ndarray(format="rgb24")
    return dec, nbytes * 8 / (B / float(fps)) / 1e6


def decode_stereogram(frames, P, D, viewing="parallel", window=9, chunk=2, device=None):
    """frames [B,H,W,3] -> depth [B,H,W] read back from the repeats (block matching on the grey picture)."""
    dev = device or _device()
    B, H, W, _ = frames.shape
    cross = viewing == "cross"
    s_lo = int(math.floor(P - (0 if cross else D))) - 1
    s_hi = int(math.ceil(P + (D if cross else 0))) + 1
    shifts = list(range(max(2, s_lo), min(W - 1, s_hi) + 1))
    h = int(P // 2)
    out = torch.zeros(B, H, W)
    for b0 in range(0, B, chunk):
        _check_interrupt()
        x = frames[b0:b0 + chunk].to(dev)
        g = _grey(x.float() / 255.0 if x.dtype == torch.uint8 else x)
        n = g.shape[0]
        costs = []
        for s in shifts:
            c = torch.full_like(g, 4.0)
            c[:, :, s:] = (g[:, :, s:] - g[:, :, :-s]).abs()
            c = F.avg_pool2d(c[:, None], window, stride=1, padding=window // 2, count_include_pad=False)[:, 0]
            costs.append(c)
        cv = torch.stack(costs, 0)                                 # [S, n, H, W]
        k = cv.argmin(0)
        S = len(shifts)
        km, kp = (k - 1).clamp(0, S - 1), (k + 1).clamp(0, S - 1)
        c0 = cv.gather(0, k[None])[0]
        cm = cv.gather(0, km[None])[0]
        cp = cv.gather(0, kp[None])[0]
        den = (cm - 2 * c0 + cp)
        off = torch.where(den.abs() > 1e-6, 0.5 * (cm - cp) / den, torch.zeros_like(den)).clamp(-0.5, 0.5)
        s = torch.tensor(shifts, device=dev, dtype=torch.float32)[k] + off
        z = ((s - P) / D) if cross else ((P - s) / D)
        z = z.clamp(0, 1)
        z[:, :, :s_hi + window // 2] = 0
        zz = torch.zeros_like(z)                                    # the link from x - s to x reports depth at x - s/2
        zz[:, :, :W - h] = z[:, :, h:]
        out[b0:b0 + n] = zz.cpu()
    return out


class ValisStereoDecode:
    DESCRIPTION = ("Reads the hidden depth back out of stereogram frames: what a fusing viewer's eyes get. With "
                   "codec on, the frames go through an H.264 encode at the bitrate you set first, so you see what "
                   "survives an upload. Connect the depth you hid to get a score.")

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
                    "frames": ("IMAGE",),
                    "period": ("INT", {"default": 0, "min": 0, "max": 2048, "tooltip": "the stereogram's period (0 = width / 9)"}),
                    "strength": ("FLOAT", {"default": 0.18, "min": 0.02, "max": 0.4, "step": 0.01}),
                    "viewing": (["parallel", "cross"], {"default": "parallel"}),
                    "window": ("INT", {"default": 9, "min": 3, "max": 41, "step": 2}),
                    "codec": (["none", "h264"], {"default": "h264"}),
                    "bitrate_mbps": ("FLOAT", {"default": 8.0, "min": 0.2, "max": 200.0, "step": 0.1}),
                    "fps": ("INT", {"default": 24, "min": 1, "max": 120}),
                },
                "optional": {"depth": ("IMAGE", {"tooltip": "the depth that was hidden, for the score"})}}

    RETURN_TYPES = ("IMAGE", "IMAGE", "STRING")
    RETURN_NAMES = ("decoded_depth", "frames_after_codec", "report")
    FUNCTION = "run"
    CATEGORY = CAT

    def run(self, frames, period, strength, viewing, window, codec, bitrate_mbps, fps, depth=None):
        fr = frames.cpu()
        B, H, W = fr.shape[:3]
        P = _auto_period(W, period)
        D = min(strength * P, P - 6)
        lines = [f"{B} frames {W}x{H}, period {P}px, depth {D:.1f}px, {viewing}"]
        if codec == "h264":
            dec, real = h264_roundtrip(fr, fps, bitrate_mbps)
            fr = torch.from_numpy(dec)                               # uint8 until it leaves the node
            lines.append(f"H.264 at {bitrate_mbps:g} Mb/s asked, {real:.2f} Mb/s made")
        with torch.no_grad():
            z = decode_stereogram(fr, P, D, viewing, window)
        if fr.dtype == torch.uint8:
            fr = fr.float() / 255.0
        if depth is not None:
            ref = _resize_bhw(_depth_tensor(depth.cpu()), H, W)
            n = min(ref.shape[0], B)
            lines.append(score_text(z[:n], ref[:n], P))
        return (_to_image(z), fr, "\n".join(lines))


def score(z, ref, P, thr=0.2):
    """IoU of the near region and mean depth error, leaving out the strip with no repeats on the left."""
    x0 = int(P * 1.5)
    a, b = z[:, :, x0:], ref[:, :, x0:]
    ma, mb = a > thr, b > thr
    inter = (ma & mb).float().sum()
    union = (ma | mb).float().sum().clamp_min(1)
    err = (a - b).abs()
    inside = err[mb].mean() if mb.any() else torch.tensor(0.0)
    return float(inter / union), float(err.mean()), float(inside)


def score_text(z, ref, P):
    iou, mae, inside = score(z, ref, P)
    return f"shape match (IoU) {iou:.3f}; depth error {mae:.3f} overall, {inside:.3f} on the thing"


NODE_CLASS_MAPPINGS = {
    "ValisMaskDepth": ValisMaskDepth,
    "ValisDepthShape": ValisDepthShape,
    "ValisDepthPlace": ValisDepthPlace,
    "ValisStereoPattern": ValisStereoPattern,
    "ValisStereogram": ValisStereogram,
    "ValisKinetogram": ValisKinetogram,
    "ValisStereoDecode": ValisStereoDecode,
}
NODE_DISPLAY_NAME_MAPPINGS = {
    "ValisMaskDepth": "Valis Mask Depth",
    "ValisDepthShape": "Valis Depth Shape",
    "ValisDepthPlace": "Valis Depth Place",
    "ValisStereoPattern": "Valis Stereo Pattern",
    "ValisStereogram": "Valis Stereogram",
    "ValisKinetogram": "Valis Kinetogram",
    "ValisStereoDecode": "Valis Stereo Decode",
}
