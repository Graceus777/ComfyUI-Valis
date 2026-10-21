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
                "optional": opt}

    RETURN_TYPES = ("IMAGE", "STRING", "IMAGE", "MASK", "STRING", "IMAGE", "MASK", "STRING")
    RETURN_NAMES = ("layers", "stage", "fill_a", "fill_a_mask", "fill_a_prompt", "fill_b", "fill_b_mask", "fill_b_prompt")
    FUNCTION = "build"
    OUTPUT_NODE = True
    CATEGORY = "Valis/stage"

    def build(self, image, depth, names, stage_name, far, band, **masks):
        import torch
        import folder_paths
        import importlib
        from .valis_fx.lib import stage as S
        S = importlib.reload(S)          # the layer builder is plain numpy: pick up edits without restarting ComfyUI
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
                  "dropped": info["dropped"]}
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
        import folder_paths
        folder = os.path.join(folder_paths.get_output_directory(), stage)
        with open(os.path.join(folder, "stage.json")) as f:
            meta = json.load(f)
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


def _stage_folder(stage):
    import folder_paths
    folder = os.path.join(folder_paths.get_output_directory(), stage)
    with open(os.path.join(folder, "stage.json")) as f:
        return folder, json.load(f)


class ValisStageSurround:
    """A stage's still, smaller, in the middle of a canvas twice as wide and tall with solid gray around it: what
    Qwen Image 2.1 + the outpaint LoRA paints out into the world past the frame. Valis Stage Dome takes the painting."""

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"stage": ("STRING", {"default": "valis/stage/stage", "tooltip": "the stage's subfolder under output"}),
                             "megapixels": ("FLOAT", {"default": 1.03, "min": 0.5, "max": 2.0, "step": 0.01})}}

    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("canvas",)
    FUNCTION = "canvas"
    CATEGORY = "Valis/stage"

    def canvas(self, stage, megapixels):
        import importlib
        import torch
        from .valis_fx.lib import stage as S
        S = importlib.reload(S)
        folder, meta = _stage_folder(stage)
        still = S.composite([{"rgba": x} for x in S.load_layers(folder, meta)])
        canvas, rect = S.surround_canvas(still, megapixels)
        meta["surround"] = {"rect": [int(v) for v in rect], "size": [int(canvas.shape[1]), int(canvas.shape[0])], "megapixels": megapixels}
        with open(os.path.join(folder, "stage.json"), "w") as f:
            json.dump(meta, f, indent=1)
        return (torch.from_numpy(canvas[None]),)


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
        import importlib
        import cv2
        from .valis_fx.lib import stage as S
        S = importlib.reload(S)
        folder, meta = _stage_folder(stage)
        rgba = S.load_layers(folder, meta)
        still = S.composite([{"rgba": x} for x in rgba])
        sur = meta.get("surround") or {}
        canvas, rect = S.surround_canvas(still, sur.get("megapixels", 1.03))
        img = np.clip(_np(painted)[0, ..., :3], 0, 1).astype(np.float32)
        if img.shape[:2] != canvas.shape[:2]:
            img = cv2.resize(img, (canvas.shape[1], canvas.shape[0]), interpolation=cv2.INTER_AREA)
        img = S.match_colour(img, canvas, rect)
        cv2.imwrite(os.path.join(folder, "surround.png"), cv2.cvtColor((img * 255 + .5).clip(0, 255).astype(np.uint8), cv2.COLOR_RGB2BGR))
        S.write_dome(folder, meta, rgba, surround=img, rect=rect)
        meta["surround"] = {"rect": [int(v) for v in rect], "size": [int(canvas.shape[1]), int(canvas.shape[0])], "image": "surround.png",
                            "megapixels": sur.get("megapixels", 1.03)}
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
        import importlib
        import cv2
        import torch
        from .valis_fx.lib import stage as S
        S = importlib.reload(S)
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
        import importlib
        from .valis_fx.lib import stage as S
        S = importlib.reload(S)
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
        import importlib
        from .valis_fx.lib import stage as S
        S = importlib.reload(S)
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

    RETURN_TYPES = ("IMAGE", "STRING", "STRING", "STRING")
    RETURN_NAMES = ("still", "prompt_all", "prompt_main", "plan")
    FUNCTION = "setup"
    CATEGORY = "Valis/stage"

    def setup(self, image, names, megapixels, **masks):
        import torch, cv2, importlib
        from .valis_fx.lib import stage as S
        S = importlib.reload(S)
        img = _np(image)[0, ..., :3].astype(np.float32)
        h, w = img.shape[:2]
        lines = _lines(names)
        plan = S.erase_plan(_masks(S, lines, masks), lines, w, h)
        k = (megapixels * 1e6 / (w * h)) ** 0.5
        W2, H2 = max(16, int(round(w * k / 16)) * 16), max(16, int(round(h * k / 16)) * 16)
        small = cv2.resize(img, (W2, H2), interpolation=cv2.INTER_AREA)
        return (torch.from_numpy(small[None].astype(np.float32)), plan["prompt_all"], plan["prompt_main"], json.dumps(plan))


class ValisErase:
    """The erased picture: the still with each thing's place taken from the edit model's plate (checked: the thing
    must really be gone there, and SAM 3 must not find it again close by), matched to the still in colour and light."""

    @classmethod
    def INPUT_TYPES(cls):
        opt = {"plate_main": ("IMAGE",)}
        opt.update(_mask_inputs("mask_", "(in the still)"))
        opt.update(_mask_inputs("pmask_", "(in plate_all: is the thing still there?)"))
        return {"required": {"image": ("IMAGE",), "plan": ("STRING", {"forceInput": True}), "plate_all": ("IMAGE",),
                             "names": ("STRING", {"multiline": True, "default": "the sky\nthe person"})},
                "optional": opt}

    RETURN_TYPES = ("IMAGE", "STRING")
    RETURN_NAMES = ("erased", "report")
    FUNCTION = "erase"
    CATEGORY = "Valis/stage"

    def erase(self, image, plan, plate_all, names, plate_main=None, **masks):
        import torch, importlib
        from .valis_fx.lib import stage as S
        S = importlib.reload(S)
        img = _np(image)[0, ..., :3].astype(np.float32)
        lines = _lines(names)
        out, report = S.erase_combine(img, _masks(S, lines, masks), lines, json.loads(plan), _np(plate_all)[0],
                                      None if plate_main is None else _np(plate_main)[0], _masks(S, lines, masks, "pmask_"))
        return (torch.from_numpy(out[None].astype(np.float32)), json.dumps(report))


class ValisStageErased:
    """Valis Stage, erase first: the scenery is split from the erased picture (wire SAM 3 run on it into emask_*, and
    its depth), the things go back on top as cutouts from the still (mask_*, the still's depth). Writes the stage
    folder like Valis Stage, plus erased.png."""

    @classmethod
    def INPUT_TYPES(cls):
        opt = _mask_inputs("mask_", "(in the still)")
        opt.update(_mask_inputs("emask_", "(in the erased picture)"))
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

    def build(self, image, depth, erased, erased_depth, report, names, stage_name, far, band, **masks):
        import torch, cv2, importlib
        import folder_paths
        from .valis_fx.lib import stage as S
        S = importlib.reload(S)
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
        layers, info = S.build_erased(img, d1, ms, ln, er, d2, es, rep.get("erased", []), far=far, band=band)
        info["erase"] = rep
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
               "dropped": info.get("dropped", []), "erased": rep.get("erased", []), "kept": rep.get("kept", [])}
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
