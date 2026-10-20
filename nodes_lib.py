"""Valis library nodes: cues from anything, effect layers, the render, sound design, swap checks, the voice turn.

  Valis Cues          - merge cues from a Valis score, any music (beats and band hits), YuE2 sheet music (ABC),
                        a voice (syllables) and/or a soundless cue sheet (plain text)
  Valis Layer         - one library effect, listening to lanes you name; chain layers into a stack
  Valis Render        - the stack over a clip (+ another clip, masks, depth), on the cues
  Valis Sound Design  - every effect's own sound on the same cues, beds, extra hits, mixed with the music
  Valis Swap Check    - before a swap: exposure / colour / contrast / light / sharpness / grain / mask report, and
                        the reference pre-graded (and flipped if the light disagrees)
  Valis Swap Match    - after a swap: colour, grain, softness and light wrap matched back to the plate
  Valis Voice Turn    - the voice turns with the face: the take's voice until the turn, the monster after it
  Valis Color Palette - a named look or your own HEX colours graded onto every frame
  Valis Dolly Zoom    - a push-in or pull-back re-framed so the subject holds its size: the vertigo shot
"""
import json

import numpy as np

LANE_TIP = "lane name(s) to listen to, comma separated: a score event (kick, impact...), a music band (kick, snare, hat, beat, downbeat, onset), a sheet-music lane (melody, ins, note, bass, chord, bar), a syllable lane, or any name from your cue sheet"


def _np_images(images):
    a = images.detach().cpu().numpy() if hasattr(images, "detach") else np.asarray(images)
    return [np.ascontiguousarray(f[..., :3], np.float32) for f in a]


def _np_masks(mask, n=None):
    if mask is None:
        return None
    a = mask.detach().cpu().numpy() if hasattr(mask, "detach") else np.asarray(mask)
    if a.ndim == 2:
        a = a[None]
    seq = [np.ascontiguousarray(m, np.float32) for m in a]
    return [seq[min(i, len(seq) - 1)] for i in range(n or len(seq))]


def _audio_np(audio):
    wf = audio["waveform"]
    wf = wf.detach().cpu().numpy() if hasattr(wf, "detach") else np.asarray(wf)
    x = wf[0] if wf.ndim == 3 else wf             # (channels, n)
    return x.T.astype(np.float32), int(audio["sample_rate"])


def _lanes(s):
    s = (s or "").strip()
    if not s:
        return None
    parts = [p.strip() for p in s.split(",") if p.strip()]
    return parts[0] if len(parts) == 1 else parts


class ValisCues:
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
                    "cue_sheet": ("STRING", {"multiline": True, "default": "", "tooltip": "soundless cues: '1.5 shatter', '2:1 ignite 0.8', 'every 1 beat from 3:1 to 7:1 pulse', 'ramp slip 0 0 4 1', 'bpm 96 3/4'"}),
                    "duration": ("FLOAT", {"default": 0.0, "min": 0.0, "max": 3600.0, "step": .01, "tooltip": "seconds (0 = from the sources)"}),
                },
                "optional": {
                    "score": ("VALIS_SCORE", {"tooltip": "a Valis score (its events become lanes)"}),
                    "music": ("AUDIO", {"tooltip": "any music: kick / snare / hat / onset / beat / downbeat lanes and loud / bright / low / mid / high curves"}),
                    "abc": ("STRING", {"multiline": True, "default": "", "tooltip": "YuE2 sheet music (link YuE2 Generate ABC, or paste ABC); aligned to `music` if given"}),
                    "voice": ("AUDIO", {"tooltip": "speech: a 'syllable' lane"}),
                    "offset": ("FLOAT", {"default": 0.0, "min": -3600, "max": 3600, "step": .01, "tooltip": "shift every cue (s): where this shot starts in the song is -offset"}),
                    "bpm_hint": ("FLOAT", {"default": 0.0, "min": 0, "max": 300, "step": .5}),
                }}

    RETURN_TYPES = ("VALIS_CUES", "STRING")
    RETURN_NAMES = ("cues", "summary")
    FUNCTION = "build"
    CATEGORY = "Valis/library"

    def build(self, cue_sheet, duration, score=None, music=None, abc=None, voice=None, offset=0.0, bpm_hint=0.0):
        from .valis_fx.lib.cues import Cues
        c = Cues(duration=duration)
        if score is not None:
            c = c.merge(Cues.from_score(score))
        y = sr = None
        if music is not None:
            y, sr = _audio_np(music)
            c = c.merge(Cues.from_audio(y, sr, bpm_hint=bpm_hint or None))
        if abc:
            c = c.merge(Cues.from_abc(abc, y, sr), prefix="")
        if voice is not None:
            from .nodes import speech_onsets
            vy, vsr = _audio_np(voice)
            on, _ = speech_onsets(vy.mean(1), vsr)
            c = c.merge(Cues({"syllable": on}, duration=len(vy) / vsr))
        if cue_sheet.strip():
            c = c.merge(Cues.from_schedule(cue_sheet, duration or None))
        if offset:
            c = c.shifted(offset)
        if duration:
            c.duration = duration
        summ = ", ".join(f"{k}:{len(v)}" for k, v in sorted(c.lanes.items())) + (f" | curves: {', '.join(c.curves)}" if c.curves else "")
        if c.bpm:
            summ += f" | {c.bpm:.1f} BPM"
        return (c, summ)


class ValisLayer:
    @classmethod
    def INPUT_TYPES(cls):
        from .valis_fx.lib.effects import LIBRARY
        return {"required": {
                    "effect": (sorted(LIBRARY), {"default": "DoubleExposure"}),
                    "on": ("STRING", {"default": "kick", "tooltip": "hits: " + LANE_TIP}),
                    "by": ("STRING", {"default": "", "tooltip": "a held amount: a curve (loud, bright, low, or a cue-sheet ramp) or a lane's envelope"}),
                    "params": ("STRING", {"multiline": True, "default": "{}", "tooltip": "the effect's own settings as JSON, e.g. {\"mode\": \"burn\", \"era\": \"daguerreotype\"}"}),
                },
                "optional": {"stack": ("VALIS_STACK",)}}

    RETURN_TYPES = ("VALIS_STACK",)
    FUNCTION = "add"
    CATEGORY = "Valis/library"

    def add(self, effect, on, by, params, stack=None):
        try:
            p = json.loads(params or "{}")
        except Exception as e:
            raise ValueError(f"params must be JSON: {e}")
        from .valis_fx.lib.effects import LIBRARY
        import inspect
        sig = inspect.signature(LIBRARY[effect].__init__).parameters
        if "on" in sig and _lanes(on) is not None:
            p.setdefault("on", _lanes(on))
        if "by" in sig and _lanes(by) is not None:
            p.setdefault("by", _lanes(by))
        return ((list(stack or [])) + [(effect, p)],)


class ValisRender:
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"images": ("IMAGE",), "cues": ("VALIS_CUES",), "stack": ("VALIS_STACK",),
                             "fps": ("FLOAT", {"default": 24.0, "min": 1, "max": 120}),
                             "start": ("FLOAT", {"default": 0.0, "min": 0, "max": 3600, "step": .01, "tooltip": "where this clip starts on the cues (s)"})},
                "optional": {"other": ("IMAGE", {"tooltip": "clip 'b': the other era / the scene behind / the double exposure's inner scene"}),
                             "subject": ("MASK", {"tooltip": "mask 'subject'"}), "mask2": ("MASK", {"tooltip": "mask 'mask2'"}),
                             "depth": ("IMAGE", {"tooltip": "depth (near = bright)"})}}

    RETURN_TYPES = ("IMAGE",)
    FUNCTION = "render"
    CATEGORY = "Valis/library"

    def render(self, images, cues, stack, fps, start, other=None, subject=None, mask2=None, depth=None):
        import torch
        import comfy.utils
        from .valis_fx.lib.core import Ctx
        from .valis_fx.lib.effects import LIBRARY
        A = _np_images(images)
        n = len(A); H, W = A[0].shape[:2]
        cu = cues.shifted(-start) if start else cues
        ctx = Ctx(cu, (W, H), n, fps)
        u8 = lambda fr: [np.clip(f[..., ::-1] * 255 + .5, 0, 255).astype(np.uint8) for f in fr]
        ctx.add_clip("a", frames=u8(A), fps=fps)
        if other is not None:
            ctx.add_clip("b", frames=u8(_np_images(other)), fps=fps)
        for name, m in (("subject", subject), ("mask2", mask2)):
            if m is not None:
                ctx.add_mask(name, frames=[np.clip(x * 255 + .5, 0, 255).astype(np.uint8) for x in _np_masks(m, n)], fps=fps)
        if depth is not None:
            d = depth.detach().cpu().numpy()[..., 0]
            ctx.add_depth(d.astype(np.float32))
        fx = [LIBRARY[name](**p) for name, p in stack]
        out = []
        pbar = comfy.utils.ProgressBar(n)
        for i in range(n):
            ctx.begin(i)
            img = ctx.a.copy()
            for f in fx:
                img = np.clip(f(ctx, img), 0, 1).astype(np.float32)
            ctx.end(img); out.append(img)
            pbar.update_absolute(i + 1, n)
        return (torch.from_numpy(np.stack(out)),)


class ValisSoundDesign:
    @classmethod
    def INPUT_TYPES(cls):
        from .valis_fx.lib.sound import DESIGNS, BEDS
        return {"required": {"cues": ("VALIS_CUES",), "duration": ("FLOAT", {"default": 4.5, "min": .1, "max": 3600, "step": .01}),
                             "beds": ("STRING", {"default": "", "tooltip": "beds and gains, e.g. 'rain:.5, wind:.3' (" + ", ".join(BEDS) + ")"}),
                             "hits": ("STRING", {"multiline": True, "default": "", "tooltip": "extra sounds, one per line: design@lane[:gain], e.g. 'thunder@strike:.9' (" + ", ".join(DESIGNS) + ")"}),
                             "music_gain": ("FLOAT", {"default": .9, "min": 0, "max": 2, "step": .05}),
                             "duck": ("FLOAT", {"default": 0.0, "min": 0, "max": 1, "step": .05, "tooltip": "how much the music dips under the effects (off: the song leads)"})},
                "optional": {"stack": ("VALIS_STACK", {"tooltip": "each effect brings its own sound on its own lanes"}), "music": ("AUDIO",),
                             "seed": ("INT", {"default": 1, "min": 0, "max": 2 ** 31}),
                             "key": ("STRING", {"default": "", "tooltip": "the song's key for tuned sounds, e.g. 'Bb', 'Dm', 'D phrygian' (blank: from the cues' ABC, else D minor)"}),
                             "space": (["hall", "room", "cathedral", "open", "water", "dry"], {"default": "hall", "tooltip": "the one room every sound sits in"})}}

    RETURN_TYPES = ("AUDIO",)
    FUNCTION = "design"
    CATEGORY = "Valis/library"

    def design(self, cues, duration, beds, hits, music_gain, duck, stack=None, music=None, seed=1, key="", space="hall"):
        import torch
        from .valis_fx.lib.sound import SoundDesign, SR
        from .valis_fx.lib.effects import LIBRARY
        sd = SoundDesign(cues, duration, seed, key=key or (cues.meta or {}).get("key"), space=space)
        if stack:
            sd.for_stack([LIBRARY[n](**p) for n, p in stack])
        for b in [x.strip() for x in beds.split(",") if x.strip()]:
            name, _, g = b.partition(":")
            sd.bed(name.strip(), float(g or .5))
        for line in [x.strip() for x in hits.splitlines() if x.strip()]:
            d, _, rest = line.partition("@")
            lane, _, g = rest.partition(":")
            sd.hits(d.strip(), lane.strip(), float(g or 1.0), limit=99)
        m = msr = None
        if music is not None:
            m, msr = _audio_np(music)
        out = sd.mix(m, msr, music_gain, duck)
        return ({"waveform": torch.from_numpy(out.T[None].copy()), "sample_rate": SR},)


class ValisColorPalette:
    """Colour Palette: a named look, or your own HEX colours, graded onto every frame (Higgsfield's Color Palette)."""

    @classmethod
    def INPUT_TYPES(cls):
        from .valis_fx.lib.palette import LOOKS
        return {"required": {"images": ("IMAGE",), "look": (list(LOOKS) + ["custom"], {"default": "film_colors"}),
                             "strength": ("FLOAT", {"default": 1.0, "min": 0, "max": 1, "step": .05})},
                "optional": {"hex": ("STRING", {"default": "", "tooltip": "custom: 2-6 colours, darkest to lightest or any order, e.g. '#0b1d2a, #c8553d, #f2d0a4'"}),
                             "grain": ("FLOAT", {"default": -1.0, "min": -1, "max": 1, "step": .05, "tooltip": "-1 keeps the look's own grain"}),
                             "seed": ("INT", {"default": 0, "min": 0, "max": 2 ** 31})}}

    RETURN_TYPES = ("IMAGE",)
    FUNCTION = "apply"
    CATEGORY = "Valis/library"

    def apply(self, images, look, strength, hex="", grain=-1.0, seed=0):
        import torch
        from .valis_fx.lib.palette import LOOKS, Look, grade, hex_look
        if look == "custom":
            cols = [c for c in hex.replace(";", ",").split(",") if c.strip()]
            lk = hex_look(cols) if len(cols) >= 2 else LOOKS["natural"]
        else:
            lk = Look(LOOKS[look])
        if grain >= 0:
            lk = Look(lk, grain=grain)
        out = [grade(f, lk, strength, t=i, seed=seed) for i, f in enumerate(_np_images(images))]
        return (torch.from_numpy(np.stack(out).astype(np.float32)),)


class ValisTrimHold:
    """Cut the frozen tail (and optionally head) off a generated shot. A pinned last frame makes the model arrive early and
    then hold that exact still for a second or more; this keeps `keep` frames of the hold and drops the rest."""

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"images": ("IMAGE",),
                             "keep": ("INT", {"default": 6, "min": 0, "max": 96, "tooltip": "frames of the hold to keep (6 = a quarter second at 24 fps)"}),
                             "threshold": ("FLOAT", {"default": 1.0, "min": .1, "max": 10, "step": .1,
                                                     "tooltip": "mean difference (0-255 grey) below which a frame counts as the same still"})},
                "optional": {"head": ("BOOLEAN", {"default": False, "tooltip": "also trim a frozen start"}),
                             "min_frames": ("INT", {"default": 49, "min": 1, "max": 4096, "tooltip": "never cut the shot shorter than this"})}}

    RETURN_TYPES = ("IMAGE", "INT")
    RETURN_NAMES = ("images", "frames")
    FUNCTION = "trim"
    CATEGORY = "Valis/library"

    @staticmethod
    def held(small, ref, threshold):
        """How many frames, counted from the end of `small`, stay within `threshold` of `ref`."""
        d = np.abs(small - ref).mean(axis=(1, 2))
        n = 0
        for x in d[::-1]:
            if x > threshold:
                break
            n += 1
        return n

    def trim(self, images, keep, threshold, head=False, min_frames=49):
        N = images.shape[0]
        if N < 3:
            return (images, N)
        step = max(1, min(images.shape[1], images.shape[2]) // 96)
        small = images[:, ::step, ::step, :].float().mean(-1).cpu().numpy() * 255.0
        tail = max(0, self.held(small, small[-1], threshold) - 1 - keep)          # the last frame matches itself
        lead = max(0, self.held(small[::-1], small[0], threshold) - 1 - keep) if head else 0
        over = max(0, min_frames - (N - tail - lead))                            # hand frames back if we cut too much
        give = min(over, tail); tail -= give; over -= give
        lead -= min(over, lead)
        out = images[lead:N - tail]
        return (out, int(out.shape[0]))


class ValisDollyZoom:
    """A dolly zoom from a real camera move: give it a push-in (or pull-back) shot and the subject's mask (SAM 3 track),
    and every frame is re-framed so the subject keeps one size and place while the background's perspective keeps
    changing. Crops only (never invents an edge); max_zoom caps how far in a frame is cropped, and a move bigger than
    that is locked only partly. A push-in gives the classic vertigo (the world stretches away), a pull-back the reverse
    (it looms forward)."""

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"images": ("IMAGE",),
                             "max_zoom": ("FLOAT", {"default": 1.6, "min": 1.05, "max": 3.0, "step": .05,
                                                    "tooltip": "the most any frame is cropped in (1.6 = the tightest frame shows 62% of the picture)"}),
                             "strength": ("FLOAT", {"default": 1.0, "min": 0.0, "max": 1.0, "step": .05,
                                                    "tooltip": "1 holds the subject's size exactly; lower lets it grow or shrink a little"})},
                "optional": {"mask": ("MASK", {"tooltip": "the subject, per frame (SAM 3 track). Without it the middle of the frame is tracked."})}}

    RETURN_TYPES = ("IMAGE", "STRING")
    RETURN_NAMES = ("images", "info")
    FUNCTION = "zoom"
    CATEGORY = "Valis/library"

    def zoom(self, images, max_zoom, strength, mask=None):
        import torch
        from .valis_fx.lib.dolly import track_subject, lock
        fr = (images[..., :3].clamp(0, 1).cpu().numpy() * 255 + .5).astype(np.uint8)
        ms = _np_masks(mask, len(fr)) if mask is not None else None
        if ms is not None:
            ms = np.stack(ms)
            if ms.shape[1:] != fr.shape[1:3]:
                import cv2
                ms = np.stack([cv2.resize(m, (fr.shape[2], fr.shape[1])) for m in ms])
            if (ms > .5).sum() < 200:                          # an empty track: fall back to the middle of the frame
                ms = None
        A = track_subject(fr, ms)
        out, info = lock(fr, A, ms, max_zoom=max_zoom, strength=strength)
        info = {k: v for k, v in info.items() if k != "zoom"}
        return (torch.from_numpy(out.astype(np.float32) / 255.0), json.dumps(info))


class ValisWhipPan:
    """A whip pan from a real pan: give it a steady pan (the video model does those cleanly) and it is speed-ramped
    into a whip: it lingers, swings at many times real speed with motion blur taken from the camera's own measured
    motion, and lands. "reveal" lands where the pan ends; "return" swings out and straight back to the start (the
    subject). Only the clip's own pixels are used. The result is shorter than the source (about 1.5-3 s from 4.5 s)."""

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"images": ("IMAGE",),
                             "fps": ("FLOAT", {"default": 24.0, "min": 1.0, "max": 120.0, "step": 1.0}),
                             "mode": (["reveal", "return"], {"default": "reveal",
                                      "tooltip": "reveal: whip to where the pan ends. return: whip out and back to the start"}),
                             "speed": ("FLOAT", {"default": 0.0, "min": 0.0, "max": 60.0, "step": .5,
                                                 "tooltip": "peak speed, x real time. 0 = automatic (fast enough for a smear of `smear` x the width)"}),
                             "smear": ("FLOAT", {"default": .15, "min": .02, "max": .5, "step": .01,
                                                 "tooltip": "with speed 0: the peak motion blur, as a fraction of the frame width"}),
                             "shutter": ("FLOAT", {"default": 1.0, "min": .1, "max": 2.0, "step": .05,
                                                   "tooltip": "exposure per frame as a fraction of the frame interval (0.5 = a 180 degree shutter)"})}}

    RETURN_TYPES = ("IMAGE", "STRING")
    RETURN_NAMES = ("images", "info")
    FUNCTION = "whip"
    CATEGORY = "Valis/library"

    def whip(self, images, fps, mode, speed, smear, shutter):
        import torch
        from .valis_fx.lib.whip import track_motion, whip
        fr = (images[..., :3].clamp(0, 1).cpu().numpy() * 255 + .5).astype(np.uint8)
        if len(fr) < 8:
            return (images, json.dumps({"skipped": "need at least 8 frames"}))
        out, info = whip(fr, track_motion(fr), fps=fps, mode=mode, speed=speed, smear=smear, shutter=shutter)
        return (torch.from_numpy(out.astype(np.float32) / 255.0), json.dumps(info))


class ValisCanny:
    """ComfyUI's Canny, a few frames at a time. The core node runs the whole clip on the GPU at once, which runs out of
    memory on a long, larger clip while a video model is still loaded (226 frames at 576x1024 asked for 4 GB). Same
    kornia call and thresholds, so the edges are identical."""

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"image": ("IMAGE",),
                             "low_threshold": ("FLOAT", {"default": 0.4, "min": 0.01, "max": 0.99, "step": 0.01}),
                             "high_threshold": ("FLOAT", {"default": 0.8, "min": 0.01, "max": 0.99, "step": 0.01}),
                             "batch": ("INT", {"default": 8, "min": 1, "max": 256})}}

    RETURN_TYPES = ("IMAGE",)
    FUNCTION = "edges"
    CATEGORY = "Valis/library"

    def edges(self, image, low_threshold, high_threshold, batch):
        import torch
        from kornia.filters import canny
        import comfy.model_management as mm
        dev = mm.get_torch_device()
        outs = []
        for i in range(0, image.shape[0], batch):
            x = image[i:i + batch, ..., :3].to(device=dev, dtype=torch.float32).movedim(-1, 1)
            try:
                e = canny(x, low_threshold, high_threshold)[1]
            except torch.OutOfMemoryError:                     # still too big next to a loaded model: do it on the CPU
                e = canny(x.cpu(), low_threshold, high_threshold)[1]
            outs.append(e.to(device=mm.intermediate_device(), dtype=mm.intermediate_dtype()).repeat(1, 3, 1, 1).movedim(1, -1))
            del x, e
        return (torch.cat(outs, 0),)


class ValisPoseCheck:
    """Source check for Motion Transfer, before the expensive render: reads the SDPose keypoints of the clip and says,
    second by second, where the body reads clearly and where the video model will have to guess (no body, legs hidden,
    can't tell which way it faces, left/right swapping, cut off by the frame, false limbs). Returns the report, a
    timeline strip (green good, red bad, one lane per issue) and the best window to render."""

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"keypoints": ("POSE_KEYPOINT",),
                             "fps": ("FLOAT", {"default": 24.0, "min": 1.0, "max": 120.0, "step": 1.0}),
                             "score_threshold": ("FLOAT", {"default": .5, "min": .05, "max": .95, "step": .05,
                                                           "tooltip": "the same threshold the skeleton is drawn with"})}}

    RETURN_TYPES = ("STRING", "IMAGE", "FLOAT", "FLOAT")
    RETURN_NAMES = ("report", "timeline", "start", "duration")
    FUNCTION = "check"
    OUTPUT_NODE = True
    CATEGORY = "Valis/library"

    def check(self, keypoints, fps, score_threshold):
        import torch
        from .valis_fx.lib.posecheck import check, timeline
        rep, score = check(keypoints or [], fps=fps, thr=score_threshold)
        strip = timeline(score, rep, width=720)
        bw = rep.get("best_window", {})
        txt = json.dumps(rep)
        return {"ui": {"text": [txt]},
                "result": (txt, torch.from_numpy(strip[None].astype(np.float32)), float(bw.get("start", 0.0)), float(bw.get("duration", 0.0)))}


class ValisSwapCheck:
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"take": ("IMAGE",), "mask": ("MASK",), "reference": ("IMAGE",),
                             "pregrade": ("BOOLEAN", {"default": True, "tooltip": "grade the reference to the take's light (Lab transfer)"}),
                             "auto_flip": ("BOOLEAN", {"default": True, "tooltip": "flip the reference if its key light is on the other side"})}}

    RETURN_TYPES = ("IMAGE", "STRING")
    RETURN_NAMES = ("reference", "report")
    FUNCTION = "check"
    CATEGORY = "Valis/library"

    def check(self, take, mask, reference, pregrade, auto_flip):
        import torch
        from .valis_fx.lib import match
        T = _np_images(take); M = _np_masks(mask, len(T)); R = _np_images(reference)[0]
        r = match.preflight(T, M, R)
        out = R
        if pregrade and (r["fix"].get("pregrade") or (auto_flip and r["fix"].get("flip"))):
            mid = len(T) // 2
            out = match.pregrade(R, T[mid], M[mid], flip=auto_flip and bool(r["fix"].get("flip")),
                                 strength=.85 if r["fix"].get("pregrade") else 0.0)
        return (torch.from_numpy(out[None].astype(np.float32)), match.report_text(r))


class ValisSwapMatch:
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"plate": ("IMAGE",), "swapped": ("IMAGE",), "mask": ("MASK",),
                             "color": ("FLOAT", {"default": .85, "min": 0, "max": 1, "step": .05}),
                             "grain": ("BOOLEAN", {"default": True}), "soften": ("BOOLEAN", {"default": True}),
                             "light_wrap": ("FLOAT", {"default": .25, "min": 0, "max": 1, "step": .05})},
                "optional": {"swapped_mask": ("MASK", {"tooltip": "the subject in the swapped frames: grade only that and keep the swapped background (whole-person swaps)"})}}

    RETURN_TYPES = ("IMAGE",)
    FUNCTION = "match_"
    CATEGORY = "Valis/library"

    def match_(self, plate, swapped, mask, color, grain, soften, light_wrap, swapped_mask=None):
        import torch
        from .valis_fx.lib import match
        P = _np_images(plate); S = _np_images(swapped); n = min(len(P), len(S)); M = _np_masks(mask, n)
        SM = _np_masks(swapped_mask, n) if swapped_mask is not None else None
        out = match.postmatch(P[:n], S[:n], M, color, grain, soften, light_wrap, smask=SM)
        return (torch.from_numpy(np.stack(out).astype(np.float32)),)


class ValisVoiceTurn:
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"audio": ("AUDIO", {"tooltip": "the take's voice (or a ChatterboxVC conversion of it)"}),
                             "turn_at": ("FLOAT", {"default": -1.0, "min": -1, "max": 3600, "step": .01, "tooltip": "seconds; -1 = the score's impact"}),
                             "pitch": ("FLOAT", {"default": .74, "min": .3, "max": 2, "step": .01}),
                             "formant": ("FLOAT", {"default": .86, "min": .4, "max": 1.6, "step": .01}),
                             "sub": ("FLOAT", {"default": .5, "min": 0, "max": 1.5, "step": .05}),
                             "growl": ("FLOAT", {"default": .12, "min": 0, "max": 1, "step": .01})},
                "optional": {"score": ("VALIS_SCORE",)}}

    RETURN_TYPES = ("AUDIO",)
    FUNCTION = "turn"
    CATEGORY = "Valis/library"

    def turn(self, audio, turn_at, pitch, formant, sub, growl, score=None):
        import torch
        from .valis_fx.lib import voice
        x, sr = _audio_np(audio)
        if turn_at < 0:
            turn_at = float((score or {}).get("events", {}).get("impact", [0.0])[0]) if score else 0.0
        out = np.stack([voice.turn(x[:, c], sr, turn_at, pitch=pitch, formant=formant, sub=sub, growl=growl) for c in range(x.shape[1])], 0)
        return ({"waveform": torch.from_numpy(out[None].astype(np.float32)), "sample_rate": sr},)


NODE_CLASS_MAPPINGS = {"ValisCues": ValisCues, "ValisLayer": ValisLayer, "ValisRender": ValisRender, "ValisSoundDesign": ValisSoundDesign,
                       "ValisSwapCheck": ValisSwapCheck, "ValisSwapMatch": ValisSwapMatch, "ValisVoiceTurn": ValisVoiceTurn,
                       "ValisColorPalette": ValisColorPalette, "ValisTrimHold": ValisTrimHold, "ValisDollyZoom": ValisDollyZoom, "ValisWhipPan": ValisWhipPan, "ValisCanny": ValisCanny, "ValisPoseCheck": ValisPoseCheck}
NODE_DISPLAY_NAME_MAPPINGS = {"ValisCues": "Valis Cues (score / music / sheet music / voice / cue sheet)", "ValisLayer": "Valis Layer (library effect)",
                              "ValisRender": "Valis Render (library stack)", "ValisSoundDesign": "Valis Sound Design",
                              "ValisSwapCheck": "Valis Swap Check (pre)", "ValisSwapMatch": "Valis Swap Match (post)",
                              "ValisVoiceTurn": "Valis Voice Turn", "ValisColorPalette": "Valis Color Palette (looks / HEX)",
                              "ValisTrimHold": "Valis Trim Hold (cut a frozen end)",
                              "ValisDollyZoom": "Valis Dolly Zoom (lock the subject through a push or pull)",
                              "ValisWhipPan": "Valis Whip Pan (speed-ramp a real pan into a whip)",
                              "ValisCanny": "Valis Canny (batched: long clips without running out of VRAM)",
                              "ValisPoseCheck": "Valis Pose Check (is this clip readable for Motion Transfer?)"}
