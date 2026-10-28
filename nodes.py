"""Valis nodes: the score drives the picture.

  Valis Score (load)  - a Valis score .json (the event map the Valis score engine writes: bars, beats, every event)
  Valis FX            - the Valis pass from DANSE MACABRE: an excitable-medium reveal of a transformation layer,
                        shockwaves, flares, lightning, ghost crowd, candles, glints, mist, god rays, particles,
                        grade, camera punch and refraction, each fired by the score's events
"""
import json
import os

import numpy as np

import folder_paths

MODES = ["prologue", "midnight", "call", "waltz", "build", "drop", "breakdown", "reveal", "finale", "dawn"]
REVEALS = ["none", "ignite", "on", "call", "vanish", "crowd"]
SECTION_MODE = {"intro": "prologue", "verse": "waltz", "prechorus": "build", "pre-chorus": "build", "chorus": "drop",
                "bridge": "breakdown", "outro": "dawn", "theme": "waltz"}


def _jsons():
    root = folder_paths.get_input_directory()
    out = []
    for dirpath, dirs, files in os.walk(root):
        if dirpath.count(os.sep) - root.count(os.sep) > 2:
            continue
        for f in files:
            if f.endswith(".json"):
                out.append(os.path.relpath(os.path.join(dirpath, f), root).replace(os.sep, "/"))
    return sorted(out)


class ValisScoreLoad:
    """Load a Valis score (.json event map) from ComfyUI/input (subfolders included)."""

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"score": (_jsons() or ["none"],)}}

    RETURN_TYPES = ("VALIS_SCORE", "FLOAT", "FLOAT")
    RETURN_NAMES = ("score", "beat_seconds", "bar_seconds")
    FUNCTION = "load"
    CATEGORY = "Valis"

    def load(self, score):
        with open(os.path.join(folder_paths.get_input_directory(), score)) as f:
            sc = json.load(f)
        return (sc, float(sc.get("beat_seconds", 0.5)), float(sc.get("bar_seconds", 1.5)))


def _u8(images):
    a = images.detach().cpu().numpy() if hasattr(images, "detach") else np.asarray(images)
    return [np.clip(f * 255 + .5, 0, 255).astype(np.uint8)[..., :3] for f in a]


def _mask_u8(mask, n):
    if mask is None:
        return None
    a = mask.detach().cpu().numpy() if hasattr(mask, "detach") else np.asarray(mask)
    if a.ndim == 2:
        a = a[None]
    seq = [np.clip(m * 255 + .5, 0, 255).astype(np.uint8) for m in a]
    return [seq[min(i, len(seq) - 1)] for i in range(n)]


class ValisFX:
    """The Valis pass: every layer fired by the score. Feed it the plate, the score and where the shot starts."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "images": ("IMAGE",),
                "score": ("VALIS_SCORE",),
                "start_bar": ("INT", {"default": 0, "min": 0, "max": 10000, "tooltip": "the score bar this shot starts on"}),
                "mode": (["auto"] + MODES, {"default": "auto", "tooltip": "the look of this section; auto reads it from the score"}),
                "reveal": (REVEALS, {"default": "none", "tooltip": "how the layer (fx_images) comes in: ignite = an excitable medium seeded on the kicks; on = held; call = flares on call and response; vanish = burns subject B away on the response; crowd = a ghost crowd keyed from its own light"}),
            },
            "optional": {
                "fx_images": ("IMAGE", {"tooltip": "the transformation layer (an Edit render) or a crowd plate on black"}),
                "mask_a": ("MASK", {"tooltip": "subject A (her / the main subject)"}),
                "mask_b": ("MASK", {"tooltip": "subject B (him / the second subject)"}),
                "mask_k": ("MASK", {"tooltip": "the clock, or anything shockwaves should come from"}),
                "occlusion": ("MASK", {"tooltip": "what the ghost crowd passes behind"}),
                "face": ("MASK", {"tooltip": "a face to keep (with keep_face) or to grade (with ghost_face)"}),
                "depth": ("IMAGE", {"tooltip": "a depth map sequence (near = bright); flat if missing"}),
                "candles": ("BOOLEAN", {"default": False, "tooltip": "snuff the candles in the plate and light them one per music-box note"}),
                "glint": ("BOOLEAN", {"default": False, "tooltip": "glints in the face mask's eyes on the glint events"}),
                "ghost_face": ("BOOLEAN", {"default": False}),
                "keep_face": ("BOOLEAN", {"default": False, "tooltip": "the transformation skips the face mask"}),
                "seeds": (["default", "eyes", "v2"], {"default": "default", "tooltip": "where the reveal starts on the impact"}),
                "mist": ("FLOAT", {"default": 1.0, "min": 0, "max": 2, "step": .05}),
                "rays": ("FLOAT", {"default": 1.0, "min": 0, "max": 2, "step": .05}),
                "halo": ("FLOAT", {"default": 1.0, "min": 0, "max": 2, "step": .05}),
                "wave": ("FLOAT", {"default": 1.0, "min": 0, "max": 2, "step": .05}),
                "center": (["body", "eyes"], {"default": "body", "tooltip": "where bursts, the halo and shockwaves come from: the subject's middle, or its face (talking heads)"}),
                "remap": ("STRING", {"default": "{}", "multiline": False, "tooltip": "drive an effect from another lane, e.g. {\"musicbox\": \"melody\", \"pah\": \"hat\"}"}),
            },
        }

    RETURN_TYPES = ("IMAGE",)
    FUNCTION = "run"
    CATEGORY = "Valis"

    def run(self, images, score, start_bar, mode, reveal, fx_images=None, mask_a=None, mask_b=None, mask_k=None, occlusion=None,
            face=None, depth=None, candles=False, glint=False, ghost_face=False, keep_face=False, seeds="default",
            mist=1.0, rays=1.0, halo=1.0, wave=1.0, center="body", remap="{}"):
        import torch
        import comfy.utils
        from .valis_fx import engine

        try:
            remap = json.loads(remap or "{}")
        except Exception:
            remap = {}
        engine.configure(score, remap)
        from .valis_fx.lib.score_make import bar_start
        t0 = bar_start(score, start_bar)             # the score's own bar line: bar 0 is the first downbeat, not t = 0
        if mode == "auto":
            sec = next((s for s in score.get("sections", []) if s["start"] <= t0 + 1e-6 < s["end"]), None)
            name = (sec or {}).get("name", "waltz").lower()
            mode = name if name in MODES else SECTION_MODE.get(name, "waltz")
        frames = _u8(images)
        n = len(frames)
        masks = {k: _mask_u8(m, n) for k, m in (("g", mask_a), ("c", mask_b), ("k", mask_k), ("x", occlusion), ("face", face)) if m is not None}
        fx = _u8(fx_images) if fx_images is not None else None
        dep = None
        if depth is not None:
            d = depth.detach().cpu().numpy()[..., 0]
            h, w = frames[0].shape[:2]
            import cv2
            dep = np.stack([cv2.resize(x, (max(1, w // 4), max(1, h // 4)), interpolation=cv2.INTER_AREA) for x in d]).astype(np.float32)
        C = dict(mode=mode, reveal=None if reveal == "none" else reveal, seeds=seeds, candles=candles, glint=glint, ghostface=ghost_face,
                 g_minus_face=keep_face, mist=mist, rays=rays, halo=halo, wave=wave, center=center, v2=seeds in ("eyes", "v2"))
        pbar = comfy.utils.ProgressBar(n)
        out = engine.run_shot(frames, dep, masks, fx, C, t0=t0, k=int(start_bar // 4), progress=lambda i, m: pbar.update_absolute(i, m))
        return (torch.from_numpy(np.stack(out).astype(np.float32) / 255.0),)


def speech_onsets(wave, sr, floor_db=-42.0, rise_db=6.0, min_gap=.14):
    """Syllable onsets (seconds) from a mono waveform: 10 ms RMS, a 6 dB rise over 40 ms above the floor, landed on the peak."""
    hop, win = int(sr * .01), int(sr * .02)
    if len(wave) < win * 2:
        return [], np.zeros(0)
    rms = np.sqrt(np.convolve(wave.astype(np.float64) ** 2, np.ones(win) / win, "valid")[::hop])
    db = 20 * np.log10(rms + 1e-9)
    sm = np.convolve(db, np.ones(3) / 3, "same")
    rise = sm - np.concatenate([np.full(4, sm[0]), sm[:-4]])
    on, last = [], -10 ** 9
    for i in range(len(sm)):
        if rise[i] > rise_db and sm[i] > floor_db and (i - last) * .01 > min_gap:
            j = i + int(np.argmax(sm[i:i + 6]))
            on.append(round(j * .01, 3)); last = i
    return on, sm


class ValisScoreFromAudio:
    """The voice is the score: syllable onsets become events, and one moment (a word) becomes the impact.
    swap_at < 0 picks the first syllable after the longest pause."""

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "audio": ("AUDIO",),
            "swap_at": ("FLOAT", {"default": -1.0, "min": -1.0, "max": 3600.0, "step": .01, "tooltip": "seconds; the impact (where the turn happens). -1 = after the longest pause"}),
            "floor_db": ("FLOAT", {"default": -42.0, "min": -80.0, "max": 0.0, "step": 1.0, "tooltip": "quieter than this is silence"}),
        }}

    RETURN_TYPES = ("VALIS_SCORE", "FLOAT")
    RETURN_NAMES = ("score", "swap_at")
    FUNCTION = "build"
    CATEGORY = "Valis"

    def build(self, audio, swap_at, floor_db):
        wf = audio["waveform"]
        wf = wf.detach().cpu().numpy() if hasattr(wf, "detach") else np.asarray(wf)
        mono = wf[0].mean(0) if wf.ndim == 3 else wf.mean(0)
        sr = int(audio["sample_rate"])
        on, sm = speech_onsets(mono, sr, floor_db)
        dur = len(mono) / sr
        if swap_at < 0:
            gaps = [(on[k + 1] - on[k], on[k + 1]) for k in range(len(on) - 1)]
            swap_at = max(gaps)[1] - .07 if gaps else dur / 2
        post = [t for t in on if t > swap_at + .05]
        score = {"bpm": 120, "beat_seconds": .5, "bar_seconds": 1.5, "duration": dur,
                 "sections": [{"name": "finale", "start": 0, "end": dur}],
                 "events": {"impact": [float(swap_at)], "stab": [t for t in post for _ in (0, 1)], "oom": on, "syllable": on}}
        return (score, float(swap_at))


NODE_CLASS_MAPPINGS = {"ValisScoreLoad": ValisScoreLoad, "ValisFX": ValisFX, "ValisScoreFromAudio": ValisScoreFromAudio}
NODE_DISPLAY_NAME_MAPPINGS = {"ValisScoreLoad": "Valis Score (load)", "ValisFX": "Valis FX (score-driven pass)", "ValisScoreFromAudio": "Valis Score (from a voice)"}
