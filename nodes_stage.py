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


NODE_CLASS_MAPPINGS = {"ValisStage": ValisStage, "ValisStageFill": ValisStageFill}
NODE_DISPLAY_NAME_MAPPINGS = {"ValisStage": "Valis Stage (a still, split by words into depth layers)",
                              "ValisStageFill": "Valis Stage Fill (paint behind the layers)"}
