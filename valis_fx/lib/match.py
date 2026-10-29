"""Swap helpers, no AI: measure before a character swap, and match after it.

preflight(take, mask, reference)  -> report: exposure, contrast, colour temperature and tint, saturation, sharpness,
    grain, light direction, subject size and mask stability, with plain-language warnings and the fixes Valis can do
    itself (pre-grade the reference to the take, flip it so the light agrees, crop it to the subject).
pregrade(reference, take, mask)   -> the reference graded to the take's light (Lab mean/std transfer), optionally flipped.
postmatch(plate, swapped, mask)   -> the swapped clip matched back to the plate inside its region: Lab transfer smoothed
    over time (no flicker), grain added to match, softness matched, a light wrap at the edge. Toggle each part.
"""
import math

import cv2
import numpy as np


def _lab(img):
    """img float RGB 0..1 -> Lab float (L 0..100)."""
    return cv2.cvtColor(np.clip(img, 0, 1).astype(np.float32), cv2.COLOR_RGB2LAB)


def _rgb(lab):
    return np.clip(cv2.cvtColor(lab.astype(np.float32), cv2.COLOR_LAB2RGB), 0, 1)


def _hp_gain(sigma=1.2):
    """how much of white noise's σ the grey picture minus its blur keeps: sqrt(1 - 2 g0 + sum g^2) for the blur's kernel"""
    k = cv2.getGaussianKernel(9, sigma)
    k2 = k @ k.T
    return float(math.sqrt(1 - 2 * k2[4, 4] + (k2 ** 2).sum()))


_HP = _hp_gain()


def _grain(img, m):
    """The grain's σ, on a 0..255 scale, as the σ of the white noise that would make it, in the region `m` (float RGB 0..1).
    The high-pass of the grey picture (it minus its blur) where the picture itself is flat, and flat is judged on a blurred
    copy, which has no grain left to choose by (picking the flattest pixels by the noisy picture's own Laplacian kept only
    the pixels where the noise happened to be small: a measure of 0.39 of the real σ). The median absolute deviation
    leaves what texture is left out of the σ."""
    w = m > .5
    if w.sum() < 50:
        w = np.ones(m.shape, bool)
    g = cv2.cvtColor(np.clip(img, 0, 1).astype(np.float32), cv2.COLOR_RGB2GRAY) * 255
    hpf = g - cv2.GaussianBlur(g, (0, 0), 1.2)
    sm = cv2.GaussianBlur(g, (0, 0), 3)
    grad = np.hypot(cv2.Sobel(sm, cv2.CV_32F, 1, 0), cv2.Sobel(sm, cv2.CV_32F, 0, 1))
    flat = w & (grad <= np.percentile(grad[w], 40))
    if flat.sum() < 50:
        return 0.0
    v = hpf[flat]
    return float(1.4826 * np.median(np.abs(v - np.median(v))) / _HP)


def _stats(img, m):
    lab = _lab(img)
    w = m > .5
    if w.sum() < 50:
        w = np.ones(m.shape, bool)
    px = lab[w]
    L, a, b = px[:, 0], px[:, 1], px[:, 2]
    g = cv2.cvtColor((np.clip(img, 0, 1) * 255).astype(np.uint8), cv2.COLOR_RGB2GRAY).astype(np.float32)
    lap = cv2.Laplacian(g, cv2.CV_32F)
    gx = cv2.Sobel(cv2.GaussianBlur(g, (0, 0), 4), cv2.CV_32F, 1, 0); gy = cv2.Sobel(cv2.GaussianBlur(g, (0, 0), 4), cv2.CV_32F, 0, 1)
    # light direction: where the brightness rises across the subject (mean gradient, weighted by the mask)
    ww = w.astype(np.float32)
    lx, ly = float((gx * ww).sum() / (ww.sum() + 1e-6)), float((gy * ww).sum() / (ww.sum() + 1e-6))
    return {"L": float(np.median(L)), "L_std": float(L.std()), "a": float(a.mean()), "b": float(b.mean()),
            "chroma": float(np.sqrt(a * a + b * b).mean()), "sharp": float(lap[w].var()), "grain": _grain(img, m),
            "light": (lx, ly), "light_deg": float(math.degrees(math.atan2(ly, lx))) if abs(lx) + abs(ly) > 1e-3 else None,
            "lab_mean": px.mean(0).tolist(), "lab_std": px.std(0).tolist()}


def subject_of_reference(ref):
    """The character in a reference sheet, assuming a plain backdrop: pixels far from the border colour."""
    h, w = ref.shape[:2]
    border = np.concatenate([ref[:8].reshape(-1, 3), ref[-8:].reshape(-1, 3), ref[:, :8].reshape(-1, 3), ref[:, -8:].reshape(-1, 3)])
    bg = np.median(border, 0)
    d = np.sqrt(((ref - bg) ** 2).sum(-1))
    m = (d > max(.08, np.percentile(d, 40))).astype(np.uint8)
    m = cv2.morphologyEx(m, cv2.MORPH_OPEN, np.ones((5, 5), np.uint8))
    n, lab, st, _ = cv2.connectedComponentsWithStats(m)
    if n > 1:
        k = 1 + int(np.argmax(st[1:, cv2.CC_STAT_AREA]))
        m = (lab == k).astype(np.uint8)
    return cv2.GaussianBlur(m.astype(np.float32), (0, 0), 2)


def preflight(take_frames, mask_frames, reference, ref_mask=None, step=8):
    """take_frames / mask_frames: lists of float RGB / float masks (0..1). reference: float RGB."""
    idx = list(range(0, len(take_frames), step)) or [0]
    S = [_stats(take_frames[i], mask_frames[min(i, len(mask_frames) - 1)]) for i in idx]
    take = {k: float(np.median([s[k] for s in S])) for k in ("L", "L_std", "a", "b", "chroma", "sharp", "grain")}
    lights = np.array([s["light"] for s in S]); take["light"] = lights.mean(0).tolist()
    take["light_deg"] = float(math.degrees(math.atan2(take["light"][1], take["light"][0])))
    rm = ref_mask if ref_mask is not None else subject_of_reference(reference)
    ref = _stats(reference, rm)
    # mask: size, edges, stability
    areas = np.array([float((m > .5).mean()) for m in mask_frames])
    ious = []
    for i in range(1, len(mask_frames)):
        a, b = mask_frames[i - 1] > .5, mask_frames[i] > .5
        u = (a | b).sum()
        ious.append((a & b).sum() / u if u else 1.0)
    empties = int((areas < 1e-4).sum())
    H, W = mask_frames[0].shape
    touches = float(np.mean([(m[:, :3] > .5).any() or (m[:, -3:] > .5).any() for m in mask_frames[::step]]))
    warn, fix = [], {}
    dL = ref["L"] - take["L"]
    stops = dL / 100 * 6.6                                   # ~6.6 stops across L* 0..100: a rough, readable unit
    if abs(stops) > .5:
        warn.append(f"exposure: the reference is {abs(stops):.1f} stops {'brighter' if stops > 0 else 'darker'} than the take")
        fix["pregrade"] = True
    dT = ref["b"] - take["b"]
    if abs(dT) > 6:
        warn.append(f"colour: the reference is {'warmer' if dT > 0 else 'cooler'} than the take (b* {dT:+.0f})")
        fix["pregrade"] = True
    if abs(ref["L_std"] - take["L_std"]) > 8:
        warn.append(f"contrast: the reference is {'harder' if ref['L_std'] > take['L_std'] else 'flatter'} than the take")
        fix["pregrade"] = True
    if ref["light_deg"] is not None and take["light_deg"] is not None:
        rx, tx = ref["light"][0], take["light"][0]
        if abs(rx) > 1 and abs(tx) > 1 and np.sign(rx) != np.sign(tx):
            warn.append("light: the key light comes from the other side in the reference; flipping it will agree with the take")
            fix["flip"] = True
    ratio = ref["sharp"] / (take["sharp"] + 1e-6)
    if ratio > 3:
        warn.append("sharpness: the reference is much crisper than the take; post-match will soften the swap to sit in")
        fix["soften"] = True
    if take["grain"] > ref["grain"] * 1.5 + .5:
        warn.append(f"grain: the take is grainier (σ {take['grain']:.1f} vs {ref['grain']:.1f}); post-match will add grain")
        fix["grain"] = True
    a_med = float(np.median(areas))
    if a_med < .03:
        warn.append(f"size: the subject fills only {a_med * 100:.1f}% of the frame; swaps hold best above ~5% (closer framing)")
    if empties:
        warn.append(f"mask: SAM lost the subject in {empties} frame(s); those frames will keep the original")
    if ious and float(np.median(ious)) < .85:
        warn.append(f"mask: unstable outline (median frame-to-frame IoU {np.median(ious):.2f}); raise the mask grow or detection threshold")
    if touches > .5:
        warn.append("framing: the subject is cut by the frame edge in most frames")
    return {"take": take, "reference": {k: v for k, v in ref.items() if k not in ("lab_mean", "lab_std")}, "mask": {
        "area_median": a_med, "empty_frames": empties, "iou_median": float(np.median(ious)) if ious else 1.0, "edge_frames": touches},
        "warnings": warn, "fix": fix, "ok": not warn}


def _transfer(src, src_m, dst_stats, strength=1.0):
    lab = _lab(src)
    w = src_m > .5
    if w.sum() < 50:
        return src
    mu, sd = lab[w].mean(0), lab[w].std(0) + 1e-3
    tm, ts = np.array(dst_stats["lab_mean"]), np.array(dst_stats["lab_std"]) + 1e-3
    out = (lab - mu) / sd * (sd + (ts - sd) * strength) + (mu + (tm - mu) * strength)
    return _rgb(out)


def pregrade(reference, take_frame, take_mask, ref_mask=None, flip=False, strength=.85):
    rm = ref_mask if ref_mask is not None else subject_of_reference(reference)
    st = _stats(take_frame, take_mask)
    out = _transfer(reference, rm, st, strength)
    # keep the backdrop as it was (only the character is graded)
    out = reference * (1 - rm[..., None]) + out * rm[..., None]
    return out[:, ::-1].copy() if flip else out


def postmatch(plate, swapped, mask, color=1.0, grain=True, soften=True, wrap=.25, tc=.85, seed=0, smask=None):
    """plate / swapped: lists of float RGB frames; mask: list of float masks (the subject in the plate).
    The swapped subject's Lab mean/std is pulled toward the plate's subject (exponentially smoothed over time).
    smask: the subject in the swapped frames. Given (a whole-person swap, where the new silhouette differs), only that
    region is graded and the swapped frame stays the base. Without it (an in-place swap), the region is composited
    back onto the plate through `mask`."""
    rng = np.random.default_rng(seed)
    out, ema = [], None
    pg = None
    for i, (p, s) in enumerate(zip(plate, swapped)):
        m = mask[min(i, len(mask) - 1)]
        ms = m if smask is None else smask[min(i, len(smask) - 1)]
        base = p if smask is None else s
        sp, ss = _stats(p, m), _stats(s, ms)
        tgt = np.array(sp["lab_mean"] + sp["lab_std"])
        ema = tgt if ema is None else ema * tc + tgt * (1 - tc)
        res = s
        if color > 0:
            res = _transfer(s, ms, {"lab_mean": ema[:3].tolist(), "lab_std": ema[3:].tolist()}, color)
        if soften and ss["sharp"] > sp["sharp"] * 1.6:
            sg = min(2.0, .5 * math.log(ss["sharp"] / (sp["sharp"] + 1e-6)))
            res = cv2.GaussianBlur(res, (0, 0), sg)
        if grain:
            pg = sp["grain"] if pg is None else pg * .9 + sp["grain"] * .1
            # grains add as noise does, in quadrature (the plate's σ² less what the swap has, after the softening above took
            # some out), not as a difference of σ
            add = math.sqrt(max(0.0, pg * pg - _grain(res, ms) ** 2)) / 255
            if add > 0:
                res = res + rng.standard_normal(res.shape[:2]).astype(np.float32)[..., None] * add
        mm = cv2.GaussianBlur(ms.astype(np.float32), (0, 0), 1.5)[..., None]
        comp = base * (1 - mm) + res * mm
        if wrap:
            edge = np.clip(cv2.GaussianBlur(ms.astype(np.float32), (0, 0), 6) - cv2.erode(ms.astype(np.float32), np.ones((9, 9), np.uint8)), 0, 1)
            bgl = cv2.GaussianBlur(base * (1 - ms[..., None]), (0, 0), 12)
            comp = comp + bgl * edge[..., None] * wrap
        out.append(np.clip(comp, 0, 1))
    return out


def report_text(r):
    lines = ["Valis swap check"]
    t, f = r["take"], r["reference"]
    lines.append(f"  take: L* {t['L']:.0f}, contrast {t['L_std']:.0f}, warmth b* {t['b']:+.0f}, light {t['light_deg']:+.0f}°, grain σ {t['grain']:.1f}")
    lines.append(f"  reference: L* {f['L']:.0f}, contrast {f['L_std']:.0f}, warmth b* {f['b']:+.0f}, light {f['light_deg'] if f['light_deg'] is None else round(f['light_deg'])}°, grain σ {f['grain']:.1f}")
    lines.append(f"  subject: {r['mask']['area_median'] * 100:.1f}% of frame, mask IoU {r['mask']['iou_median']:.2f}, lost in {r['mask']['empty_frames']} frame(s)")
    lines += ["  ✓ looks good"] if r["ok"] else [f"  ! {w}" for w in r["warnings"]]
    if r["fix"]:
        lines.append("  Valis will: " + ", ".join({"pregrade": "pre-grade the reference", "flip": "flip the reference",
                                                    "soften": "soften the swap", "grain": "add grain"}[k] for k in r["fix"]))
    return "\n".join(lines)
