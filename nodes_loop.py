"""Valis Loop: Valis effects over a looping clip, looping with it (GIFs, VJ loops, live backgrounds).

The loop itself comes from the video model: MiniMax H3 Loop and MiniMax H3 Loop Decode (pxl-pshr/ComfyUI-MiniMaxH3-Loop,
GPL-3.0, a separate pack) make H3 denoise the join between the clip's end and its start like any other frame. These nodes
take it from there:

  Valis Loop · Render       a Valis library stack over a loop, looping: the cues repeat, every effect's memory is warmed
                            up so frame 0 is what the second time round would show, and what still differs is sealed
  Valis Loop · Open / Close put any other frame-by-frame effect between them (Valis FX, Color Palette, another pack's
                            node) and it loops the same way; Valis Loop · Cues makes cues or a score repeat for it
  Valis Loop · Phase        a curve that repeats with the loop, as a cue lane any effect's `by` can follow
  Valis Loop · Seam Check   the wrap-around step next to the steps around it
  Valis Loop · Save         GIF (one palette for the loop, ordered dither, true frame timing), WebP, MP4: all looping

IMAGE tensors are [B, H, W, C], float32 in 0..1.
"""
import json
import os

import numpy as np

CATEGORY = "Valis/loop"


def _np(images):
    a = images.detach().cpu().numpy() if hasattr(images, "detach") else np.asarray(images)
    return np.ascontiguousarray(a[..., :3], np.float32)


def _np_mask(mask):
    if mask is None:
        return None
    a = mask.detach().cpu().numpy() if hasattr(mask, "detach") else np.asarray(mask)
    return a[None] if a.ndim == 2 else a


def _t(a):
    import torch
    return torch.from_numpy(np.ascontiguousarray(a, np.float32))


def _pbar(n):
    try:
        import comfy.utils
        p = comfy.utils.ProgressBar(n)
        return lambda i, m: p.update_absolute(i, m)
    except Exception:
        return None


class ValisLoopPhase:
    """A per-frame curve that repeats with the loop: frame N wraps exactly to frame 0. As cues it is a held lane (named
    `name`) that any library effect can follow with by=<name>; merge it into your other cues with `cues`."""

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
                    "frames": ("INT", {"default": 102, "min": 2, "max": 10000, "tooltip": "the loop's length in frames (MiniMax H3 Loop: length - 5, e.g. 102 for 107)"}),
                    "cycles": ("INT", {"default": 1, "min": 1, "max": 64}),
                    "offset": ("FLOAT", {"default": 0.0, "min": 0.0, "max": 1.0, "step": 0.01}),
                    "shape": (["sine", "triangle", "saw"],),
                    "min_value": ("FLOAT", {"default": 0.0, "min": -1e4, "max": 1e4, "step": 0.01}),
                    "max_value": ("FLOAT", {"default": 1.0, "min": -1e4, "max": 1e4, "step": 0.01}),
                },
                "optional": {
                    "name": ("STRING", {"default": "loop", "tooltip": "the lane name effects listen to (by=loop)"}),
                    "fps": ("FLOAT", {"default": 24.0, "min": 1.0, "max": 120.0, "step": 1.0}),
                    "cues": ("VALIS_CUES", {"tooltip": "other cues to add this lane to"}),
                }}

    RETURN_TYPES = ("VALIS_SCHEDULE", "FLOAT", "VALIS_CUES")
    RETURN_NAMES = ("schedule", "values", "cues")
    OUTPUT_IS_LIST = (False, True, False)
    FUNCTION = "run"
    CATEGORY = CATEGORY

    def run(self, frames, cycles, offset, shape, min_value, max_value, name="loop", fps=24.0, cues=None):
        import torch
        from .valis_fx.lib.cues import Cues
        p = (np.arange(frames, dtype=np.float64) / frames * cycles + offset) % 1.0
        if shape == "sine":
            v = .5 - .5 * np.cos(2 * np.pi * p)
        elif shape == "triangle":
            v = 1 - np.abs(2 * p - 1)
        else:
            v = p
        sched = (min_value + (max_value - min_value) * v).astype(np.float32)
        c = Cues(curves={(name or "loop").strip() or "loop": sched}, duration=frames / fps, fps=fps)
        if cues is not None:
            c = cues.merge(c)
        return (torch.from_numpy(sched), sched.tolist(), c)


class ValisLoopRender:
    """Valis Render for a loop: the stack's effects loop with the picture. Give it a loop (MiniMax H3 Loop Decode's
    frames), the cues and the stack as you would Valis Render; [start, start + the loop's length) of the cues repeats."""

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"images": ("IMAGE",), "cues": ("VALIS_CUES",), "stack": ("VALIS_STACK",),
                             "fps": ("FLOAT", {"default": 24.0, "min": 1, "max": 120}),
                             "start": ("FLOAT", {"default": 0.0, "min": 0, "max": 3600, "step": .01, "tooltip": "where the loop starts on the cues (s)"}),
                             "warmup": ("FLOAT", {"default": -1.0, "min": -1.0, "max": 600.0, "step": .1, "tooltip": "seconds played before frame 0 so trails, echoes and other effect memory are already there (-1 = the whole loop once: exact for anything that forgets within one loop; 0 = only the seal)"}),
                             "seal": ("INT", {"default": 12, "min": 0, "max": 240, "tooltip": "frames over which whatever still differs between the two passes (frost that only grows, a drift) is faded into the next pass"})},
                "optional": {"other": ("IMAGE", {"tooltip": "clip 'b' (looped to the same length for you)"}),
                             "subject": ("MASK", {"tooltip": "mask 'subject', tracked on the loop itself"}), "mask2": ("MASK", {"tooltip": "mask 'mask2'"}),
                             "depth": ("IMAGE", {"tooltip": "depth (near = bright), per loop frame"})}}

    RETURN_TYPES = ("IMAGE", "STRING")
    RETURN_NAMES = ("images", "report")
    FUNCTION = "render"
    CATEGORY = CATEGORY

    def render(self, images, cues, stack, fps, start, warmup, seal, other=None, subject=None, mask2=None, depth=None):
        from .valis_fx.lib import loop
        fr = _np(images)
        n = len(fr)
        warm = None if warmup < 0 else int(round(warmup * fps))
        masks = {k: _np_mask(m) for k, m in (("subject", subject), ("mask2", mask2)) if m is not None}
        dep = depth.detach().cpu().numpy()[..., 0] if depth is not None else None
        out, info = loop.render_loop(fr, cues, stack, fps=fps, start=start, other=_np(other) if other is not None else None,
                                     masks=masks, depth=dep, warm=warm, seal=seal, progress=_pbar(n + (n if warm is None else max(warm, seal))))
        rep = _render_report(info, out)
        return {"ui": {"text": [rep]}, "result": (_t(out), rep)}


def _render_report(info, out):
    from .valis_fx.lib import loop
    d = info.get("drift", 0.0) * 255
    state = ("the effects loop on their own (the two passes match)" if d < .5 else
             f"the passes differed by {d:.1f}/255 on average; sealed over the last {info['sealed']} frames")
    return f"{info['frames']} frames, {info['warm']} warm-up; {state}. " + loop.report_text(loop.seam_report(out))


class ValisLoopOpen:
    """Before any frame-by-frame effect: the loop with its own end played first (the warm-up), so whatever has memory
    is already running at frame 0. Masks, depth and a second clip laid out the same way. Close it with Loop Close."""

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"images": ("IMAGE",),
                             "warmup": ("INT", {"default": -1, "min": -1, "max": 10000, "tooltip": "frames played before frame 0 (-1 = the whole loop once)"})},
                "optional": {"mask": ("MASK",), "mask2": ("MASK",), "depth": ("IMAGE",), "other": ("IMAGE", {"tooltip": "a second clip, looped to the same length"})}}

    RETURN_TYPES = ("IMAGE", "VALIS_LOOP", "MASK", "MASK", "IMAGE", "IMAGE")
    RETURN_NAMES = ("images", "loop", "mask", "mask2", "depth", "other")
    FUNCTION = "run"
    CATEGORY = CATEGORY

    def run(self, images, warmup, mask=None, mask2=None, depth=None, other=None):
        from .valis_fx.lib import loop
        n = images.shape[0]
        warm = n if warmup < 0 else int(warmup)
        idx = (np.arange(-warm, n) % n)
        import torch
        ti = torch.from_numpy(idx)
        pick = lambda x: None if x is None else x[torch.clamp(ti, max=x.shape[0] - 1)]
        oth = None
        if other is not None:
            oth = _t(loop._periodic(_np(other), n, 12))[ti]
        info = {"n": int(n), "warm": int(warm)}
        return (images[ti], info, pick(mask), pick(mask2), pick(depth), oth)


class ValisLoopClose:
    """After the effects: drop the warm-up, and seal the last frames into it (it leads straight into frame 0)."""

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"images": ("IMAGE",), "loop": ("VALIS_LOOP",),
                             "seal": ("INT", {"default": 12, "min": 0, "max": 240, "tooltip": "frames to fade whatever still differs between the passes"})}}

    RETURN_TYPES = ("IMAGE", "STRING")
    RETURN_NAMES = ("images", "report")
    FUNCTION = "run"
    CATEGORY = CATEGORY

    def run(self, images, loop, seal):
        from .valis_fx.lib import loop as L
        out, info = L.close_loop(_np(images), loop, seal)
        rep = _render_report({"frames": loop["n"], "warm": loop["warm"], **info}, out)
        return {"ui": {"text": [rep]}, "result": (_t(out), rep)}


class ValisLoopCues:
    """Cues (or a Valis score) that repeat with an opened loop, for the effects between Loop Open and Loop Close:
    [start, start + the loop's length) of them plays every loop, lined up with the opened frames (warm-up first).
    Give Valis Render these cues with start 0; give Valis FX this score (its start_bar stays the same)."""

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"loop": ("VALIS_LOOP",), "fps": ("FLOAT", {"default": 24.0, "min": 1, "max": 120}),
                             "start": ("FLOAT", {"default": 0.0, "min": 0, "max": 3600, "step": .01, "tooltip": "cues: where the loop starts on them (s)"})},
                "optional": {"cues": ("VALIS_CUES",), "score": ("VALIS_SCORE",),
                             "start_bar": ("INT", {"default": 0, "min": 0, "max": 10000, "tooltip": "score: the bar the loop starts on (the same as Valis FX's start_bar)"})}}

    RETURN_TYPES = ("VALIS_CUES", "VALIS_SCORE")
    RETURN_NAMES = ("cues", "score")
    FUNCTION = "run"
    CATEGORY = CATEGORY

    def run(self, loop, fps, start, cues=None, score=None, start_bar=0):
        from .valis_fx.lib import loop as L
        n, warm = int(loop["n"]), int(loop["warm"])
        period, at = n / fps, warm / fps
        c = s = None
        if cues is not None:
            cu = cues.shifted(-start) if start else cues
            c = L.LoopCues(cu, period, fps, at=at, reach=(-30.0, at + period + 30.0))
        if score is not None:
            t0 = start_bar * float(score.get("bar_seconds", 1.5))
            s = L.loop_score(score, t0, period, at=at)
        return (c, s)


class ValisLoopSeamCheck:
    """Reports how big the wrap-around jump is compared to the frames around it (picture and motion)."""

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"images": ("IMAGE",)}}

    RETURN_TYPES = ("STRING",)
    FUNCTION = "run"
    OUTPUT_NODE = True
    CATEGORY = CATEGORY

    def run(self, images):
        from .valis_fx.lib import loop
        txt = loop.report_text(loop.seam_report(_np(images)))
        return {"ui": {"text": [txt]}, "result": (txt,)}


class ValisLoopSave:
    """Save the loop as files that loop forever: GIF (one palette for the whole loop and an ordered dither, so nothing
    flickers at the seam; frame delays that add up to the true length), animated WebP, MP4 (H.264)."""

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"images": ("IMAGE",),
                             "filename_prefix": ("STRING", {"default": "valis/loop"}),
                             "format": (["gif", "webp", "mp4", "gif + mp4", "all"], {"default": "gif + mp4"}),
                             "fps": ("FLOAT", {"default": 24.0, "min": 1.0, "max": 120.0, "step": 1.0}),
                             "gif_width": ("INT", {"default": 480, "min": 0, "max": 4096, "step": 8, "tooltip": "GIF and WebP width in px, never wider than the clip (0 = full size); the MP4 is always full size"})},
                "optional": {"colors": ("INT", {"default": 256, "min": 8, "max": 256}),
                             "dither": (["bayer", "none", "floyd", "sierra"], {"default": "bayer", "tooltip": "bayer: an ordered pattern that holds still from frame to frame (error diffusion crawls)"}),
                             "mp4_repeats": ("INT", {"default": 1, "min": 1, "max": 100, "tooltip": "write the loop this many times into the MP4 (for players and feeds that don't loop)"})}}

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("files",)
    FUNCTION = "save"
    OUTPUT_NODE = True
    CATEGORY = CATEGORY

    def save(self, images, filename_prefix, format, fps, gif_width, colors=256, dither="bayer", mp4_repeats=1):
        import folder_paths
        from .valis_fx.lib import loop
        fr = _np(images)
        H, W = fr.shape[1:3]
        out_dir = folder_paths.get_output_directory()
        folder, name, counter, subfolder, _ = folder_paths.get_save_image_path(filename_prefix, out_dir, W, H)
        os.makedirs(folder, exist_ok=True)
        want = {"gif": ["gif"], "webp": ["webp"], "mp4": ["mp4"], "gif + mp4": ["gif", "mp4"], "all": ["gif", "webp", "mp4"]}[format]
        files, ui = [], []
        for ext in want:
            fn = f"{name}_{counter:05}_.{ext}"
            path = os.path.join(folder, fn)
            if ext == "gif":
                loop.write_gif(fr, path, fps, gif_width, colors, dither)
            elif ext == "webp":
                loop.write_webp(fr, path, fps, gif_width)
            else:
                loop.write_mp4(fr, path, fps, 0, mp4_repeats)
            files.append(os.path.join(subfolder, fn).replace("\\", "/"))
            ui.append({"filename": fn, "subfolder": subfolder, "type": "output"})
        txt = json.dumps(files)
        return {"ui": {"images": ui, "animated": (True,), "text": [txt]}, "result": (txt,)}


NODE_CLASS_MAPPINGS = {
    "ValisLoopPhase": ValisLoopPhase,
    "ValisLoopRender": ValisLoopRender,
    "ValisLoopOpen": ValisLoopOpen,
    "ValisLoopClose": ValisLoopClose,
    "ValisLoopCues": ValisLoopCues,
    "ValisLoopSeamCheck": ValisLoopSeamCheck,
    "ValisLoopSave": ValisLoopSave,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "ValisLoopPhase": "Valis Loop · Phase Schedule",
    "ValisLoopRender": "Valis Loop · Render (library stack, looping)",
    "ValisLoopOpen": "Valis Loop · Open (before any effect)",
    "ValisLoopClose": "Valis Loop · Close (after it)",
    "ValisLoopCues": "Valis Loop · Cues (repeat with an opened loop)",
    "ValisLoopSeamCheck": "Valis Loop · Seam Check",
    "ValisLoopSave": "Valis Loop · Save (GIF / WebP / MP4)",
}
