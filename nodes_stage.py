"""Valis Stage node: one still, split by words into layers and ordered by depth, for the studio's 2.5D camera.

Wire one SAM 3 Detect per name (text "the moon:20" = up to 20 objects, individual masks on) into mask_1..mask_12 in
the same order as the names, and a Depth Anything 3 depth render into `depth`. The node completes every layer behind
the layers in front of it and writes a stage folder under output/valis/stage/ that the studio plays live.
"""
import json
import os
import re

import numpy as np

MAX_LAYERS = 12


def _np(t):
    return t.detach().cpu().numpy() if hasattr(t, "detach") else np.asarray(t)


class ValisStage:
    @classmethod
    def INPUT_TYPES(cls):
        opt = {f"mask_{i}": ("MASK", {"tooltip": f"SAM 3 masks for name {i} (individual masks: the node unions them)"}) for i in range(1, MAX_LAYERS + 1)}
        return {"required": {"image": ("IMAGE",),
                             "depth": ("IMAGE", {"tooltip": "a depth render (Depth Anything 3 'depth', bright = near)"}),
                             "names": ("STRING", {"multiline": True, "default": "the sky\nthe person",
                                                 "tooltip": "one name per line, in the same order as mask_1, mask_2, ..."}),
                             "stage_name": ("STRING", {"default": "stage"}),
                             "far": ("FLOAT", {"default": 6.0, "min": 1.5, "max": 30.0, "step": 0.5,
                                               "tooltip": "how deep the scene is: the farthest pixel sits this many times farther than the nearest"}),
                             "band": ("FLOAT", {"default": 0.025, "min": 0.0, "max": 0.2, "step": 0.005,
                                                "tooltip": "how far an object is completed behind what covers it (fraction of the width)"})},
                "optional": dict(opt, prompt=("STRING", {"forceInput": True, "tooltip": "the words the still was made from: kept in stage.json"}))}

    RETURN_TYPES = ("IMAGE", "STRING", "IMAGE", "MASK", "STRING", "IMAGE", "MASK", "STRING")
    RETURN_NAMES = ("layers", "stage", "fill_a", "fill_a_mask", "fill_a_prompt", "fill_b", "fill_b_mask", "fill_b_prompt")
    FUNCTION = "build"
    OUTPUT_NODE = True
    CATEGORY = "Valis/stage"

    def build(self, image, depth, names, stage_name, far, band, prompt=None, **masks):
        import torch
        import folder_paths
        from .valis_fx.lib import stage as S
        img = _np(image)[0, ..., :3].astype(np.float32)
        dep = _np(depth)[0].astype(np.float32)
        dep = dep[..., 0] if dep.ndim == 3 else dep
        lines = [l.strip() for l in names.replace(",", "\n").splitlines() if l.strip()]
        lines = [re.sub(r"\s*:\s*\d+\s*$", "", l) for l in lines]        # "the moon:20" -> "the moon"
        ms, ns = [], []
        for i, n in enumerate(lines[:MAX_LAYERS]):
            m = masks.get(f"mask_{i + 1}")
            if m is None:
                continue
            m = _np(m)
            m = m[None] if m.ndim == 2 else m
            u = S.union_detections(list(m))
            if u is not None:
                ms.append(u); ns.append(n)
        layers, info = S.build(img, dep, ms, ns, far=far, band=band)
        if prompt:
            info["prompt"] = prompt
        safe = re.sub(r"[^A-Za-z0-9_-]+", "_", stage_name).strip("_") or "stage"
        root = os.path.join(folder_paths.get_output_directory(), "valis", "stage")
        sub, k = safe, 1
        while os.path.exists(os.path.join(root, sub, "stage.json")):
            k += 1
            sub = f"{safe}_{k}"
        meta = S.save(os.path.join(root, sub), layers, info, source=None)
        sheet = S.contact(layers, width=480)
        subfolder = f"valis/stage/{sub}"
        # the two backdrops with the most to paint in behind: handed to an image model (Krea 2) to paint properly,
        # then Valis Stage Fill puts the paint back into the layers. An unused slot gets an empty mask.
        slots = sorted([i for i, L in enumerate(layers) if L.get("backdrop") and L["hole"].any()], key=lambda i: -layers[i]["hole"].mean())[:2]
        outs = []
        for k in range(2):
            if k < len(slots):
                L = layers[slots[k]]
                rgb = L["rgba"][..., :3]
                hole = L["hole"].astype(np.float32)
                prompt = "the empty ground and land, nothing standing on it" if L["name"] == S.PLATE else f"{L['name']}, empty, nothing in front of it"
            else:
                rgb, hole, prompt = img, np.zeros(img.shape[:2], np.float32), "an empty scene"
            outs += [torch.from_numpy(np.ascontiguousarray(rgb)[None].astype(np.float32)), torch.from_numpy(hole[None]), prompt]
        meta["fill_slots"] = slots
        import json as _j
        with open(os.path.join(root, sub, "stage.json"), "w") as f:
            _j.dump(meta, f, indent=1)
        report = {"subfolder": subfolder, "layers": [{"name": l["name"], "z": l["z_med"], "area": l["area"]} for l in meta["layers"]],
                  "dropped": info["dropped"], "checks": [{k: c.get(k) for k in ("id", "ok", "note")} for c in info.get("checks", [])]}
        return {"ui": {"valis_stage": [report]},
                "result": (torch.from_numpy(sheet[None].astype(np.float32) / 255.0), subfolder, *outs)}


class ValisStageFill:
    """Puts properly painted completions back into a stage's backdrop layers: wire the stage from Valis Stage and the
    painted fill_a / fill_b images (e.g. Krea 2 inpainting inside fill_a_mask / fill_b_mask)."""

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"stage": ("STRING", {"forceInput": True})},
                "optional": {"fill_a": ("IMAGE",), "fill_b": ("IMAGE",)}}

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("stage",)
    FUNCTION = "fill"
    OUTPUT_NODE = True
    CATEGORY = "Valis/stage"

    def fill(self, stage, fill_a=None, fill_b=None):
        import cv2
        folder, meta = _stage_folder(stage)
        done = []
        for slot, img in zip(meta.get("fill_slots", []), (fill_a, fill_b)):
            if img is None:
                continue
            L = meta["layers"][slot]
            if not L.get("hole"):
                continue
            path = os.path.join(folder, L["image"])
            rgba = cv2.imread(path, cv2.IMREAD_UNCHANGED)
            hole = cv2.imread(os.path.join(folder, L["hole"]), 0) > 127
            new = (np.clip(_np(img)[0, ..., :3], 0, 1) * 255 + .5).astype(np.uint8)
            new = cv2.resize(new, (rgba.shape[1], rgba.shape[0]), interpolation=cv2.INTER_AREA) if new.shape[:2] != rgba.shape[:2] else new
            m = cv2.GaussianBlur(cv2.dilate(hole.astype(np.uint8) * 255, np.ones((5, 5), np.uint8)), (0, 0), 2).astype(np.float32)[..., None] / 255
            bgr = cv2.cvtColor(new, cv2.COLOR_RGB2BGR).astype(np.float32)
            rgba[..., :3] = np.clip(rgba[..., :3] * (1 - m) + bgr * m, 0, 255).astype(np.uint8)
            cv2.imwrite(path, rgba)
            L["painted"] = True
            done.append(L["name"])
        with open(os.path.join(folder, "stage.json"), "w") as f:
            json.dump(meta, f, indent=1)
        return {"ui": {"valis_stage_fill": [{"stage": stage, "painted": done}]}, "result": (stage,)}


def _soft_mattes(bg_model, img, masks, pad=0.25, min_side=256):
    """A matting model (BiRefNet) on a square crop round each thing: its soft matte, put back at full size (zero
    elsewhere). Valis Stage Erased uses it only in a thing's edge band, where its colours are the background's."""
    import torch
    h, w = img.shape[:2]
    out = {}
    for n, m in masks.items():
        b = np.asarray(m) > 0.5
        if b.shape != (h, w) or b.sum() < 64:
            continue
        ys, xs = np.nonzero(b)
        cx, cy = (xs.min() + xs.max()) / 2, (ys.min() + ys.max()) / 2
        side = int(min(max(max(xs.max() - xs.min(), ys.max() - ys.min()) * (1 + 2 * pad), min_side), max(h, w)))
        x0 = int(min(max(0, round(cx - side / 2)), max(0, w - side)))
        y0 = int(min(max(0, round(cy - side / 2)), max(0, h - side)))
        x1, y1 = min(w, x0 + side), min(h, y0 + side)
        t = torch.from_numpy(np.ascontiguousarray(img[None, y0:y1, x0:x1, :3]).astype(np.float32))
        a = bg_model.encode_image(t)
        a = a[0].float().cpu().numpy() if hasattr(a, "cpu") else np.asarray(a)[0]
        full = np.zeros((h, w), np.float32)
        full[y0:y1, x0:x1] = np.clip(a[:y1 - y0, :x1 - x0], 0, 1)
        out[n] = full
    return out


def _stage_folder(stage):
    """a stage's folder, which must be under ComfyUI's output folder (the stage string comes from the graph)"""
    import folder_paths
    root = os.path.realpath(folder_paths.get_output_directory())
    folder = os.path.realpath(os.path.join(root, stage))
    if not folder.startswith(root + os.sep):
        raise ValueError(f"not a stage under output: {stage}")
    with open(os.path.join(folder, "stage.json")) as f:
        return folder, json.load(f)


class ValisStageSurround:
    """A stage's still, smaller, on a bigger canvas to paint out past its edges; Valis Stage Dome takes the painting.
    pad 0: the still at half size in the middle of a canvas twice as wide and tall, solid gray around it (what Qwen
    Image 2.1 + the outpaint LoRA was trained on). pad > 0: that much of the still's size added on each side (0.3 =
    30%), every size a multiple of 16, the margin filled with the still's own edge colours, blurred; `still` and the
    four margins are for Krea 2 AnyPaint Prepare, which paints the margin and keeps the still."""

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"stage": ("STRING", {"default": "valis/stage/stage", "tooltip": "the stage's subfolder under output"}),
                             "megapixels": ("FLOAT", {"default": 1.03, "min": 0.5, "max": 2.5, "step": 0.01})},
                "optional": {"pad": ("FLOAT", {"default": 0.0, "min": 0.0, "max": 0.5, "step": 0.01,
                                               "tooltip": "0 = the gray canvas twice the size (Qwen); 0.3 = 30% more on each side (Krea 2 AnyPaint)"})}}

    RETURN_TYPES = ("IMAGE", "IMAGE", "INT", "INT", "INT", "INT")
    RETURN_NAMES = ("canvas", "still", "left", "top", "right", "bottom")
    FUNCTION = "canvas"
    CATEGORY = "Valis/stage"

    def canvas(self, stage, megapixels, pad=0.0):
        import torch
        from .valis_fx.lib import stage as S
        folder, meta = _stage_folder(stage)
        still = S.composite([{"rgba": x} for x in S.load_layers(folder, meta)])
        sur = {"megapixels": megapixels, "pad": pad}
        canvas, rect = S.surround_for(still, sur)
        x0, y0, rw, rh = (int(v) for v in rect)
        Hc, Wc = canvas.shape[:2]
        meta["surround"] = dict(sur, rect=[x0, y0, rw, rh], size=[int(Wc), int(Hc)])
        with open(os.path.join(folder, "stage.json"), "w") as f:
            json.dump(meta, f, indent=1)
        small = np.ascontiguousarray(canvas[y0:y0 + rh, x0:x0 + rw])
        return (torch.from_numpy(canvas[None]), torch.from_numpy(small[None]), x0, y0, int(Wc - x0 - rw), int(Hc - y0 - rh))


class ValisStageDome:
    """Puts a painted surround (Valis Stage Surround's canvas, painted out by an outpainting model) into the stage's far
    dome: the studio and the 3D set then show the painted world past the frame edge instead of a blur."""

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"stage": ("STRING", {"default": "valis/stage/stage"}), "painted": ("IMAGE",)}}

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("stage",)
    FUNCTION = "dome"
    OUTPUT_NODE = True
    CATEGORY = "Valis/stage"

    def dome(self, stage, painted):
        import cv2
        from .valis_fx.lib import stage as S
        folder, meta = _stage_folder(stage)
        rgba = S.load_layers(folder, meta)
        still = S.composite([{"rgba": x} for x in rgba])
        sur = meta.get("surround") or {}
        canvas, rect = S.surround_for(still, sur)
        img = np.clip(_np(painted)[0, ..., :3], 0, 1).astype(np.float32)
        if img.shape[:2] != canvas.shape[:2]:
            img = cv2.resize(img, (canvas.shape[1], canvas.shape[0]), interpolation=cv2.INTER_AREA)
        img = S.match_colour(img, canvas, rect)
        cv2.imwrite(os.path.join(folder, "surround.png"), cv2.cvtColor((img * 255 + .5).clip(0, 255).astype(np.uint8), cv2.COLOR_RGB2BGR))
        S.write_dome(folder, meta, rgba, surround=img, rect=rect)
        meta["surround"] = dict(sur, rect=[int(v) for v in rect], size=[int(canvas.shape[1]), int(canvas.shape[0])], image="surround.png",
                                megapixels=sur.get("megapixels", 1.03))
        with open(os.path.join(folder, "stage.json"), "w") as f:
            json.dump(meta, f, indent=1)
        return {"ui": {"valis_stage_dome": [{"stage": stage, "painted": True}]}, "result": (stage,)}


class ValisStageCleanPlate:
    """A stage's still with the instruction to remove the things standing in it (not the scenery cut by the frame):
    feed both to an edit model (Qwen Image 2.1 edit), then the clean plate to Valis Stage Plate."""

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"stage": ("STRING", {"default": "valis/stage/stage"}),
                             "megapixels": ("FLOAT", {"default": 1.0, "min": 0.5, "max": 2.0, "step": 0.01})}}

    RETURN_TYPES = ("IMAGE", "STRING", "STRING", "STRING", "STRING")
    RETURN_NAMES = ("still", "instruction", "removed", "instruction_main", "removed_main")
    FUNCTION = "plate"
    CATEGORY = "Valis/stage"

    def plate(self, stage, megapixels):
        import cv2
        import torch
        from .valis_fx.lib import stage as S
        folder, meta = _stage_folder(stage)
        still = S.composite([{"rgba": x} for x in S.load_layers(folder, meta)])
        h, w = still.shape[:2]
        k = (megapixels * 1e6 / (w * h)) ** 0.5
        ws, hs = max(16, int(round(w * k / 16)) * 16), max(16, int(round(h * k / 16)) * 16)
        small = cv2.resize(still, (ws, hs), interpolation=cv2.INTER_AREA)
        names = S.plate_targets(meta)
        main = S.plate_main(meta, names)
        keep = "Keep the picture exactly as it is."
        return (torch.from_numpy(small[None].astype(np.float32)), S.plate_prompt(names) or keep, json.dumps(names),
                S.plate_prompt([main]) if main else keep, json.dumps([main] if main else []))


class ValisStagePlate:
    """Puts a clean plate (the still with the standing things removed) behind the layers: every other layer's guessed
    completion is replaced by the plate where one of the removed things covered it. At rest nothing changes."""

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"stage": ("STRING", {"default": "valis/stage/stage"}), "plate": ("IMAGE",),
                             "removed": ("STRING", {"forceInput": True})},
                "optional": {"plate_main": ("IMAGE", {"lazy": True, "tooltip": "a second plate with only the biggest thing removed: made and used only when the first left it standing"}),
                             "removed_main": ("STRING", {"forceInput": True})}}

    def check_lazy_status(self, stage, plate, removed, plate_main=None, removed_main=None):
        # the second plate (the biggest thing alone) is only painted when the first left that thing standing
        if plate_main is not None or not removed_main:
            return []
        from .valis_fx.lib import stage as S
        main = json.loads(removed_main or "[]")
        if not main:
            return []
        folder, meta = _stage_folder(stage)
        rgba = S.load_layers(folder, meta)
        ok, failed = S.plate_check(meta, rgba, np.clip(_np(plate)[0, ..., :3], 0, 1).astype(np.float32), main)
        return ["plate_main"] if failed else []

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("stage",)
    FUNCTION = "apply"
    OUTPUT_NODE = True
    CATEGORY = "Valis/stage"

    def apply(self, stage, plate, removed, plate_main=None, removed_main=None):
        from .valis_fx.lib import stage as S
        folder, meta = _stage_folder(stage)
        names = json.loads(removed or "[]")
        if names:
            rgba = S.load_layers(folder, meta)
            meta.pop("plate", None)
            S.apply_plate(folder, meta, rgba, np.clip(_np(plate)[0, ..., :3], 0, 1).astype(np.float32), names)
            left = [n for n in json.loads(removed_main or "[]") if n in meta["plate"].get("not_removed", [])]
            if left and plate_main is not None:      # the first plate left it standing: its own pass
                S.apply_plate(folder, meta, rgba, np.clip(_np(plate_main)[0, ..., :3], 0, 1).astype(np.float32), left,
                              keep_prev=True, image="plate_main.png")
            with open(os.path.join(folder, "stage.json"), "w") as f:
                json.dump(meta, f, indent=1)
        info = meta.get("plate", {})
        return {"ui": {"valis_stage_plate": [{"stage": stage, "removed": info.get("removed", []), "not_removed": info.get("not_removed", [])}]},
                "result": (stage,)}


# ---- erase first (see stage.py): Valis Erase Setup -> two Krea 2 edits -> SAM 3 on the first -> Valis Erase ->
# SAM 3 + Depth Anything 3 on the erased picture -> Valis Stage Erased. The logic lives in stage.py, which every node
# reloads, so it can change without restarting ComfyUI; only these signatures need a restart.

def _lines(names):
    ls = [l.strip() for l in names.replace(",", "\n").splitlines() if l.strip()]
    return [re.sub(r"\s*:\s*\d+\s*$", "", l) for l in ls][:MAX_LAYERS]


def _masks(S, lines, masks, prefix="mask_"):
    """one union mask per name (None where SAM 3 gave nothing or the input isn't wired)"""
    out = []
    for i in range(len(lines)):
        m = masks.get(f"{prefix}{i + 1}")
        if m is None:
            out.append(None)
            continue
        m = _np(m)
        m = m[None] if m.ndim == 2 else m
        out.append(S.union_detections(list(m)) if len(m) else None)
    return out


def _mask_inputs(prefix, what):
    return {f"{prefix}{i}": ("MASK", {"tooltip": f"SAM 3 masks for name {i} {what}"}) for i in range(1, MAX_LAYERS + 1)}


class ValisEraseSetup:
    """What to erase from a still before it is split: the things standing in it (not the sky, not scenery running out
    of the frame), as the instructions for an edit model (Krea 2 edit), all of them and the biggest alone, and the
    still at ~1 megapixel for it."""

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"image": ("IMAGE",), "names": ("STRING", {"multiline": True, "default": "the sky\nthe person"}),
                             "megapixels": ("FLOAT", {"default": 1.0, "min": 0.3, "max": 2.0, "step": 0.05})},
                "optional": _mask_inputs("mask_", "(in the still)")}

    RETURN_TYPES = ("IMAGE", "STRING", "STRING", "STRING", "STRING")
    RETURN_NAMES = ("still", "prompt_all", "prompt_main", "plan", "prompt_rest")
    FUNCTION = "setup"
    CATEGORY = "Valis/stage"

    def setup(self, image, names, megapixels, **masks):
        import torch, cv2
        from .valis_fx.lib import stage as S
        img = _np(image)[0, ..., :3].astype(np.float32)
        h, w = img.shape[:2]
        lines = _lines(names)
        plan = S.erase_plan(_masks(S, lines, masks), lines, w, h)
        k = (megapixels * 1e6 / (w * h)) ** 0.5
        W2, H2 = max(16, int(round(w * k / 16)) * 16), max(16, int(round(h * k / 16)) * 16)
        small = cv2.resize(img, (W2, H2), interpolation=cv2.INTER_AREA)
        return (torch.from_numpy(small[None].astype(np.float32)), plan["prompt_all"], plan["prompt_main"], json.dumps(plan),
                plan.get("prompt_rest", plan["prompt_main"]))


class ValisErase:
    """The erased picture: the still with each thing's place taken from the edit model's plate (checked: the thing
    must really be gone there, and SAM 3 must not find it again close by), moved onto the still and matched to it in
    colour and light. plate_main (the biggest thing alone) and plate_rest (the others again) are lazy: their edits run
    only when the first plate left one of those things standing, so a clean first edit costs one edit, and a failed one
    gets at most one retry. footprints: one mask per name (in `names` order), what the edit took away of each erased
    thing, SAM's mask plus the thin bits it missed; wire into Valis Stage Erased."""

    @classmethod
    def INPUT_TYPES(cls):
        opt = {"plate_main": ("IMAGE", {"lazy": True, "tooltip": "the biggest thing alone: made only when plate_all left it standing"}),
               "plate_rest": ("IMAGE", {"lazy": True, "tooltip": "the other things again: made only when plate_all left one of them standing"})}
        opt.update(_mask_inputs("mask_", "(in the still)"))
        opt.update(_mask_inputs("pmask_", "(in plate_all: is the thing still there?)"))
        return {"required": {"image": ("IMAGE",), "plan": ("STRING", {"forceInput": True}), "plate_all": ("IMAGE",),
                             "names": ("STRING", {"multiline": True, "default": "the sky\nthe person"})},
                "optional": opt}

    RETURN_TYPES = ("IMAGE", "STRING", "MASK")
    RETURN_NAMES = ("erased", "report", "footprints")
    FUNCTION = "erase"
    CATEGORY = "Valis/stage"

    def check_lazy_status(self, image, plan, plate_all, names, plate_main=None, plate_rest=None, **masks):
        from .valis_fx.lib import stage as S
        lines = _lines(names)
        try:
            return S.erase_needs(_np(image)[0, ..., :3].astype(np.float32), _masks(S, lines, masks), lines, json.loads(plan),
                                 _np(plate_all)[0], None if plate_main is None else _np(plate_main)[0],
                                 None if plate_rest is None else _np(plate_rest)[0], _masks(S, lines, masks, "pmask_"))
        except Exception as e:                   # a broken check must not cost the run: make both, as before
            print(f"[valis] erase check failed ({e}): making every plate")
            return [k for k, v in (("plate_main", plate_main), ("plate_rest", plate_rest)) if v is None]

    def erase(self, image, plan, plate_all, names, plate_main=None, plate_rest=None, **masks):
        import torch
        from .valis_fx.lib import stage as S
        img = _np(image)[0, ..., :3].astype(np.float32)
        lines = _lines(names)
        out, report, fps = S.erase_combine(img, _masks(S, lines, masks), lines, json.loads(plan), _np(plate_all)[0],
                                           None if plate_main is None else _np(plate_main)[0], _masks(S, lines, masks, "pmask_"),
                                           plate_rest=None if plate_rest is None else _np(plate_rest)[0], footprints=True)
        h, w = img.shape[:2]
        fp = np.stack([f if f is not None else np.zeros((h, w), np.float32) for f in fps] or [np.zeros((h, w), np.float32)]).astype(np.float32)
        return (torch.from_numpy(out[None].astype(np.float32)), json.dumps(report), torch.from_numpy(fp))


class ValisStageErased:
    """Valis Stage, erase first: the scenery is split from the erased picture (wire SAM 3 run on it into emask_*, and
    its depth), the things go back on top as cutouts from the still (mask_*, the still's depth). Writes the stage
    folder like Valis Stage, plus erased.png."""

    @classmethod
    def INPUT_TYPES(cls):
        opt = _mask_inputs("mask_", "(in the still)")
        opt.update(_mask_inputs("emask_", "(in the erased picture)"))
        opt.update({"footprints": ("MASK", {"tooltip": "Valis Erase's footprints: each erased thing's cutout (SAM's mask + the thin bits it missed)"}),
                    "bg_model": ("BACKGROUND_REMOVAL", {"tooltip": "a matting model (BiRefNet, Load Background Removal Model): soft edges where the thing's colours are the background's"}),
                    "prompt": ("STRING", {"forceInput": True, "tooltip": "the words the still was made from: kept in stage.json for painting past the frame"})})
        return {"required": {"image": ("IMAGE",), "depth": ("IMAGE",), "erased": ("IMAGE",), "erased_depth": ("IMAGE",),
                             "report": ("STRING", {"forceInput": True}),
                             "names": ("STRING", {"multiline": True, "default": "the sky\nthe person"}),
                             "stage_name": ("STRING", {"default": "stage"}),
                             "far": ("FLOAT", {"default": 6.0, "min": 1.5, "max": 30.0, "step": 0.5}),
                             "band": ("FLOAT", {"default": 0.025, "min": 0.0, "max": 0.2, "step": 0.005})},
                "optional": opt}

    RETURN_TYPES = ("IMAGE", "STRING")
    RETURN_NAMES = ("layers", "stage")
    FUNCTION = "build"
    OUTPUT_NODE = True
    CATEGORY = "Valis/stage"

    def build(self, image, depth, erased, erased_depth, report, names, stage_name, far, band, footprints=None, bg_model=None, prompt=None, **masks):
        import torch, cv2
        import folder_paths
        from .valis_fx.lib import stage as S
        img = _np(image)[0, ..., :3].astype(np.float32)
        er = _np(erased)[0, ..., :3].astype(np.float32)
        er = cv2.resize(er, (img.shape[1], img.shape[0]), interpolation=cv2.INTER_AREA) if er.shape[:2] != img.shape[:2] else er
        d1, d2 = _np(depth)[0].astype(np.float32), _np(erased_depth)[0].astype(np.float32)
        d1, d2 = (d[..., 0] if d.ndim == 3 else d for d in (d1, d2))
        lines = _lines(names)
        ms, es = _masks(S, lines, masks), _masks(S, lines, masks, "emask_")
        rep = json.loads(report) if report else {}
        # a name SAM 3 found nothing for drops out, as in Valis Stage
        keep = [i for i, n in enumerate(lines) if (es[i] is not None and es[i].any()) or (ms[i] is not None and ms[i].any() and n in rep.get("erased", []))]
        ln = [lines[i] for i in keep]
        zero = np.zeros(img.shape[:2], np.float32)
        ms = [ms[i] if ms[i] is not None else zero for i in keep]
        es = [es[i] if es[i] is not None else zero for i in keep]
        fps = None
        if footprints is not None:
            fa = _np(footprints)
            fa = fa[None] if fa.ndim == 2 else fa
            fps = [fa[i] if i < len(fa) else None for i in keep]
        soft = None
        if bg_model is not None and rep.get("erased"):
            try:
                soft = _soft_mattes(bg_model, img, {n: (fps[k] if fps is not None and fps[k] is not None and fps[k].any() else ms[k])
                                                    for k, n in enumerate(ln) if n in rep.get("erased", [])})
            except Exception as e:
                print(f"[valis] matting skipped: {e}")
        layers, info = S.build_erased(img, d1, ms, ln, er, d2, es, rep.get("erased", []), far=far, band=band,
                                      footprints=fps, soft=soft, report=rep)
        info["erase"] = rep
        if prompt:
            info["prompt"] = prompt
        safe = re.sub(r"[^A-Za-z0-9_-]+", "_", stage_name).strip("_") or "stage"
        root = os.path.join(folder_paths.get_output_directory(), "valis", "stage")
        sub, k = safe, 1
        while os.path.exists(os.path.join(root, sub, "stage.json")):
            k += 1
            sub = f"{safe}_{k}"
        meta = S.save(os.path.join(root, sub), layers, info, source=None)
        cv2.imwrite(os.path.join(root, sub, "erased.png"), cv2.cvtColor((er * 255 + .5).clip(0, 255).astype(np.uint8), cv2.COLOR_RGB2BGR))
        sheet = S.contact(layers, width=480)
        subfolder = f"valis/stage/{sub}"
        rpt = {"subfolder": subfolder, "layers": [{"name": l["name"], "z": l["z_med"], "area": l["area"]} for l in meta["layers"]],
               "dropped": info.get("dropped", []), "erased": rep.get("erased", []), "kept": rep.get("kept", []),
               "checks": [{k: c.get(k) for k in ("id", "ok", "note")} for c in info.get("checks", [])]}
        return {"ui": {"valis_stage": [rpt]}, "result": (torch.from_numpy(sheet[None].astype(np.float32) / 255.0), subfolder)}


NODE_CLASS_MAPPINGS = {"ValisStage": ValisStage, "ValisStageFill": ValisStageFill, "ValisStageSurround": ValisStageSurround, "ValisStageDome": ValisStageDome,
                       "ValisStageCleanPlate": ValisStageCleanPlate, "ValisStagePlate": ValisStagePlate,
                       "ValisEraseSetup": ValisEraseSetup, "ValisErase": ValisErase, "ValisStageErased": ValisStageErased}
NODE_DISPLAY_NAME_MAPPINGS = {"ValisStage": "Valis Stage (a still, split by words into depth layers)",
                              "ValisStageFill": "Valis Stage Fill (paint behind the layers)",
                              "ValisStageSurround": "Valis Stage Surround (the still on a canvas to paint out)",
                              "ValisStageDome": "Valis Stage Dome (the painted world past the frame)",
                              "ValisStageCleanPlate": "Valis Stage Clean Plate (the still + what to remove)",
                              "ValisStagePlate": "Valis Stage Plate (the clean plate behind the layers)",
                              "ValisEraseSetup": "Valis Erase Setup (what to erase before splitting)",
                              "ValisErase": "Valis Erase (the still with the things erased)",
                              "ValisStageErased": "Valis Stage Erased (scenery from the erased picture, things on top)"}
