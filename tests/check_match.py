"""Valis Swap Check / Swap Match's measures and matches (python3 tests/check_match.py): the grain it reads is the grain
there is, and a swap given the plate's grain ends with the plate's grain (no ComfyUI, no GPU)."""
import os
import sys

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from valis_fx.lib import match as M  # noqa: E402

passed = failed = 0


def ok(cond, name, detail=""):
    global passed, failed
    if cond:
        passed += 1
    else:
        failed += 1
        print(f"FAIL {name}{': ' + str(detail) if detail not in (None, '') else ''}")


H, W = 180, 240
rng = np.random.default_rng(0)
ONE = np.ones((H, W), np.float32)


def noisy(sig, base=.5, texture=0.0):
    """a grey picture with white grain of σ `sig` (on 0..255), and optionally a texture of stripes under it"""
    x = np.linspace(0, 2 * np.pi * 6, W, dtype=np.float32)[None, :, None] * np.ones((H, 1, 1), np.float32)
    img = base + texture / 255 * np.sin(x) + rng.standard_normal((H, W, 1)).astype(np.float32) * sig / 255
    return np.clip(img * np.ones((1, 1, 3), np.float32), 0, 1)


def real_sigma(img, base=.5):
    return float((img - base).std() * 255)


for sig in (2, 4, 8, 16):
    g = M._stats(noisy(sig), ONE)["grain"]
    ok(abs(g / sig - 1) < .08, f"grain: white grain of σ {sig} reads as {g:.2f}", g)
g = M._stats(noisy(6, texture=30), ONE)["grain"]
ok(abs(g / 6 - 1) < .15, f"grain: σ 6 under a strong texture reads as {g:.2f}", g)
ok(M._stats(np.full((H, W, 3), .5, np.float32), ONE)["grain"] < .3, "grain: a clean picture has none")

# a swap with no grain of its own, given the plate's
plate = [noisy(7.96)]
flat = [np.full((H, W, 3), .5, np.float32)]
res = M.postmatch(plate, flat, [ONE], color=0.0, grain=True, soften=False, wrap=0)[0]
ok(abs(real_sigma(res) / 7.96 - 1) < .08, "swap match: a clean swap ends with the plate's grain (σ %.2f of 7.96)" % real_sigma(res), real_sigma(res))
# one with grain of its own: the grains add in quadrature
own = [noisy(4)]
res = M.postmatch(plate, own, [ONE], color=0.0, grain=True, soften=False, wrap=0)[0]
ok(abs(real_sigma(res) / 7.96 - 1) < .08, "swap match: a swap with grain of its own ends with the plate's (σ %.2f of 7.96)" % real_sigma(res), real_sigma(res))
# one grainier than the plate: nothing is added
grainy = [noisy(12)]
res = M.postmatch([noisy(6)], grainy, [ONE], color=0.0, grain=True, soften=False, wrap=0)[0]
ok(abs(real_sigma(res) / real_sigma(grainy[0]) - 1) < .05, "swap match: a grainier swap is left alone (σ %.2f of %.2f)" % (real_sigma(res), real_sigma(grainy[0])))
# softened first (a swap much sharper than the plate is blurred to sit in): the grain the blur took out is put back
res = M.postmatch([noisy(3)], [noisy(8)], [ONE], color=0.0, grain=True, soften=True, wrap=0)[0]
gr = M._stats(res, ONE)["grain"]                                  # (the grain read as above: the blur leaves a slow ripple of the swap's own noise that is not grain)
ok(abs(gr / 3 - 1) < .12, "swap match: a swap softened to sit in still ends with the plate's grain (reads %.2f of 3)" % gr, gr)
res = M.postmatch([noisy(5)], [noisy(5)], [ONE], color=0.0, grain=False, soften=False, wrap=0)[0]
ok(abs(real_sigma(res) / 5 - 1) < .08, "swap match: with grain off the swap is left as it is")

# the check before a swap reads the same grain
take = [noisy(8)] * 3
ref = noisy(2)
r = M.preflight(take, [ONE] * 3, ref)
ok(abs(r["take"]["grain"] / 8 - 1) < .08 and abs(r["reference"]["grain"] / 2 - 1) < .15 and any(w.startswith("grain") for w in r["warnings"]),
   "swap check: a grainy take against a clean reference is reported, with the grains as they are", (r["take"]["grain"], r["reference"]["grain"]))
r = M.preflight(take, [ONE] * 3, noisy(8))
ok(not any(w.startswith("grain") for w in r["warnings"]), "swap check: the same grain on both is not a warning", r["warnings"])

print(f"{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
