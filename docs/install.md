# Install

Valis is a ComfyUI custom node pack with a studio served by ComfyUI itself. You install the pack, then add the node
packs and models for the features you want. The FX and Score tabs run on the CPU and need no model, so you can try
Valis before downloading anything.

## What you need

| | |
|---|---|
| ComfyUI | 0.39 or newer. Valis was built and tested on ComfyUI 0.42.0, Windows portable. The MiniMax H3, SAM 3, SDPose, Qwen Image 2.1, YuE2 and video nodes it uses are part of ComfyUI itself, so an older ComfyUI shows them as missing. |
| GPU | Everything in the README was made on an RTX 4080 Laptop with 12 GB of VRAM. **Renders → Detect hardware** sets the safe shot size for your card. |
| RAM | 32 GB was enough for every feature. Large jobs offload to system memory. |
| Node.js | 18 or newer, only for the [CLI](cli.md) and the tests. The studio needs nothing beyond ComfyUI and a browser. |

## 1. Install the pack

Windows portable build:

```bat
cd ComfyUI\custom_nodes
git clone https://github.com/Graceus777/ComfyUI-Valis
..\..\python_embeded\python -m pip install -r ComfyUI-Valis\requirements.txt
```

Any other install: clone into `ComfyUI/custom_nodes/` and install the requirements with the Python that runs ComfyUI.

```sh
cd ComfyUI/custom_nodes
git clone https://github.com/Graceus777/ComfyUI-Valis
python -m pip install -r ComfyUI-Valis/requirements.txt
```

`requirements.txt` installs numpy, opencv-python, scipy and scikit-image for the Valis engine, and Comfy-Org's
`comfy-api-proxy` (pinned to 0.1.6), which serves Comfy API v2 on ComfyUI's own port for the Comfy SDK.

Restart ComfyUI. The console prints a `[valis] ... not loaded: <reason>` line for any part of the pack that failed to
import; the studio still loads without it.

## 2. Open the studio

Open **http://127.0.0.1:8188/valis** (use your own port if ComfyUI runs on another), or click **VALIS** in the ComfyUI
menu. The studio makes no request off your machine: its fonts and the Comfy SDK are bundled in `app/vendor/`.

The top bar shows the connection, the queue, VRAM, the **setup** pill and the **bin**. Press **?** for how the tabs
work together. Number keys switch tabs: **0** Film, **1** Create, **2** Edit, **3** Score, **4** FX, **5** Renders,
**6** Genjutsu, **7** Extras.

## 3. See what's ready

Click the **setup** pill (or open **Renders → Setup**). Valis builds the graph of every feature the studio has and
checks it against this ComfyUI's node list: a missing node pack, a missing model file or a renamed input is listed
under the feature that needs it, before anything is queued. A feature with nothing listed is ready. Film's full-quality
shot is an extra: Setup doesn't list it until its model file is installed, and doesn't count it against `setup ready`. Setup can download some optional files for
you; see [Renders and Setup](guides/renders.md#setup).

Then press **Renders → Detect hardware**. It reads the GPU, driver, CUDA, cuDNN, attention kernels and ComfyUI's
launch flags and sets the safe shot size for your card.

## 4. Add the node packs you need

Install these into `ComfyUI/custom_nodes` the way you install any pack (git clone, or ComfyUI-Manager), then restart
ComfyUI. Setup names the pack when one is missing.

| Pack | Used for |
|---|---|
| [MaskVidExperiments](https://github.com/drozbay/MaskVidExperiments) | mask cleanup, tracked crop and uncrop, latent masks (Edit · Transform and Remove, Score targets) |
| [ComfyUI-ALLinONE-MinimaxH3](https://github.com/LeonQ8/ComfyUI-ALLinONE-MinimaxH3) | `H3MaskVideoPrepare`, `H3IdentityAnchor` (Edit · Transform) |
| [comfyui-krea2edit](https://github.com/lbouaraba/comfyui-krea2edit) | Krea 2 identity edit (Film references, Create · cast a character, Edit · Transform anchors) |
| [ComfyUI-MiniMax-H3-PDD-Acc](https://github.com/Jalen-Brunson/ComfyUI-MiniMax-H3-PDD-Acc) | 8-step H3 image-to-video (every shot from a keyframe) and the FastH3 engine |
| [ComfyUI-GGUF](https://github.com/city96/ComfyUI-GGUF) | Qwen Image 2.1 GGUF (Film frames, Edit · Remove, Create · Relight) |
| [ComfyUI-SeedVR2_VideoUpscaler](https://github.com/numz/ComfyUI-SeedVR2_VideoUpscaler) | Upscale, Film close-ups |
| [ComfyUI-MiniMaxH3-Loop](https://github.com/pxl-pshr/ComfyUI-MiniMaxH3-Loop) | Extras · Loop |
| [krea2-anypaint](https://github.com/alexw5702-afk/krea2-anypaint) | Extras · Stage: Krea 2 paints the world past the frame (the default dome) |
| [Plenio Music Production System](https://github.com/jplenio/Plenio-Music-Production-System) | instrumental YuE2 songs (its Score Tools move the sheet music's vocal line to an instrument) |

## 5. Add the models you need

All models are open weights. Put each file in the folder named, under `ComfyUI/models/`. The file names must match:
the studio names them in `app/js/graphs.js` (`MODELS`, plus `SWAP_LORA` and `TURBO_LORA`), so edit them there if
yours differ. On Linux and macOS the Krea 2 identity-edit LoRA lives at `loras/Krea2/krea2_identity_edit_v1_2_r64.safetensors`.

### By feature

Start with the row for the tab you want; Setup lists anything still missing.

| Feature | Models |
|---|---|
| FX, Score (Library), Edit · Turn, the Valis pass | none (CPU). SAM 3.1 when you name a subject or a target. |
| Create · Frame it, Film · keyframes | Krea 2: `krea2_turbo_fp8_scaled`, `qwen3vl_4b_fp8_scaled`, `qwen_image_vae` |
| Create · Shoot it, Film · shots | MiniMax H3 image-to-video: `minimax_h3_fl2va_pruned_w4a8_mixed`, `qwen3vl_32b_minimax_h3_nvfp4_awq`, `minimax_h3_video_vae_fp16`, `minimax_h3_audio_vae_fp32`, `MiniMax-H3-FL2VA-Acc-8Step` (in `pdd_acc`) |
| Film · plan | `qwen3vl_8b_w4a8` (ComfyUI's own text generation on Qwen Image 2.1's encoder) |
| Film · song, FX · New song | `yue2_3b_bf16`; for instrumentals, `ar_lora_inst_v3abc_comfyui` and the Plenio pack |
| Film · references, Create · cast a character | Krea 2 plus `krea2_identity_edit_v1_2_r64` |
| Film · frames, Create · Relight and end on the subject, Edit · Remove | Qwen Image 2.1: `qwen_image_2.1-Q6_K.gguf`, `qwen3vl_8b_w4a8`, `qwen_image_2.1_vae_bf16` |
| Edit · Find it, Film · effects with a subject | `sam3.1_multiplex_fp16` |
| Edit · Transform | SAM 3.1, Krea 2 with the identity-edit LoRA, MiniMax H3 ref2va: `minimax_h3_ref2va_pruned_int8_convrot` plus H3's text encoder and VAEs |
| Edit · Swap | SAM 3.1, H3 ref2va, `h3_character_swap_v1.5`, `minimax_h3_ref2v_turbo_8step_v1.0_768p_comfyui_bf16` |
| Edit · Remove | SAM 3.1, H3 ref2va, Qwen Image 2.1, `H3-Person-Remover-V1` (Setup can download it) |
| Genjutsu | H3 ref2va, `minimax_h3_fun_controlnet_union_pruned_int8_convrot`; motion transfer adds `sdpose_wholebody_fp16` and `rt_detr_v4-x-hgnet_fp16`; object swap uses `minimax_h3_fun_controlnet_union_2.0_pruned_int8_convrot` and SAM 3.1 |
| Upscale, Film close-ups | SeedVR2 3B (the SeedVR2 pack downloads its own files on first use) |
| Extras · Stereogram | SAM 3.1, `depth_anything_3_small` |
| Extras · Loop | the MiniMax H3 Loop pack. Its default engine, **Draft · FastH3**, uses `fasth3_omniref_8step_pruned_int8_convrot` (22.2 GB; **Renders → Engine** can download it); **Final · H3 25 steps** uses `minimax_h3_ref2va_pruned_int8_convrot` with H3's text encoder and VAEs |
| Extras · Stage | SAM 3.1, Depth Anything 3, Krea 2 with `krea2_anypaint_rank32` (or Qwen Image 2.1 with `qwen-image-2.1-outpaint-v2`) |
| Shoot at full quality (the shot card's **full quality (30 steps)** box, greyed until the file is installed; Setup lists it once it is) | `minimax_h3_fl2va_pruned_int8_convrot` |

### Every file

| File | Folder | Source |
|---|---|---|
| `krea2_turbo_fp8_scaled.safetensors` | `diffusion_models` | [Comfy-Org/Krea-2](https://huggingface.co/Comfy-Org/Krea-2) |
| `qwen3vl_4b_fp8_scaled.safetensors` | `text_encoders` | [Comfy-Org/Krea-2](https://huggingface.co/Comfy-Org/Krea-2) |
| `qwen_image_vae.safetensors` | `vae` | [Comfy-Org/Krea-2](https://huggingface.co/Comfy-Org/Krea-2) |
| `Krea2/krea2_identity_edit_v1_2_r64.safetensors` | `loras` | [conradlocke/krea2-identity-edit](https://huggingface.co/conradlocke/krea2-identity-edit) |
| `minimax_h3_fl2va_pruned_w4a8_mixed.safetensors` | `diffusion_models` | [Kijai/MiniMax-H3-experimental](https://huggingface.co/Kijai/MiniMax-H3-experimental) |
| `minimax_h3_fl2va_pruned_int8_convrot.safetensors` | `diffusion_models` | [Comfy-Org/MiniMax-H3](https://huggingface.co/Comfy-Org/MiniMax-H3) (optional: full-quality shots) |
| `minimax_h3_ref2va_pruned_int8_convrot.safetensors` | `diffusion_models` | [Comfy-Org/MiniMax-H3](https://huggingface.co/Comfy-Org/MiniMax-H3) |
| `qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors` | `text_encoders` | [Comfy-Org/MiniMax-H3](https://huggingface.co/Comfy-Org/MiniMax-H3) |
| `minimax_h3_video_vae_fp16.safetensors`, `minimax_h3_audio_vae_fp32.safetensors` | `vae` | [Comfy-Org/MiniMax-H3](https://huggingface.co/Comfy-Org/MiniMax-H3) |
| `MiniMax-H3-FL2VA-Acc-8Step.safetensors` | `pdd_acc` | [alibaba-pai/MiniMax-H3-Acc-LoRAs](https://huggingface.co/alibaba-pai/MiniMax-H3-Acc-LoRAs) |
| `h3_character_swap_v1.5.safetensors` | `loras` | [akatz-ai/MiniMax-H3-Character-Swap-LoRA](https://huggingface.co/akatz-ai/MiniMax-H3-Character-Swap-LoRA) |
| `H3-Person-Remover-V1.safetensors` | `loras` | [akatz-ai/MiniMax-H3-Person-Remover-LoRA](https://huggingface.co/akatz-ai/MiniMax-H3-Person-Remover-LoRA) (Setup can download it) |
| `minimax_h3_ref2v_turbo_8step_v1.0_768p_comfyui_bf16.safetensors` | `loras` | [RunningHubAI/rh-minimax-h3-ref2v-turbo-8step-v1.0-768p-lora](https://huggingface.co/RunningHubAI/rh-minimax-h3-ref2v-turbo-8step-v1.0-768p-lora) (save under this name) |
| `fasth3_omniref_8step_pruned_int8_convrot.safetensors` | `diffusion_models` | [FastVideo/FastH3-Omni-Comfy](https://huggingface.co/FastVideo/FastH3-Omni-Comfy) (optional: **Renders → Engine** and Extras · Loop's draft engine; Setup can download it) |
| `sam3.1_multiplex_fp16.safetensors` | `checkpoints` | [Comfy-Org/sam3.1](https://huggingface.co/Comfy-Org/sam3.1) |
| `depth_anything_3_small.safetensors` | `geometry_estimation` | [Comfy-Org/Depth-Anything-3](https://huggingface.co/Comfy-Org/Depth-Anything-3) |
| `krea2_anypaint_rank32.safetensors` | `loras` | [yijunwang2/krea2-anypaint](https://huggingface.co/yijunwang2/krea2-anypaint) (Stage) |
| `qwen-image-2.1-outpaint-v2.safetensors` | `loras` | [ausboss/Qwen-Image-2.1-Outpaint-LoRA](https://huggingface.co/ausboss/Qwen-Image-2.1-Outpaint-LoRA) (Stage: the Qwen dome) |
| `qwen_image_2.1-Q6_K.gguf` | `unet` | any Q6_K GGUF of Qwen Image 2.1, for example [unsloth/Qwen-Image-2.1-GGUF](https://huggingface.co/unsloth/Qwen-Image-2.1-GGUF) |
| `qwen3vl_8b_w4a8.safetensors`, `qwen_image_2.1_vae_bf16.safetensors` | `text_encoders`, `vae` | [Comfy-Org/Qwen-Image-2.1](https://huggingface.co/Comfy-Org/Qwen-Image-2.1) |
| `yue2_3b_bf16.safetensors` | `checkpoints` | the YuE2 checkpoint for ComfyUI's native YuE2 nodes |
| `ar_lora_inst_v3abc_comfyui.safetensors` | `loras` | [Mothersuperior/YuE2-instrumental-cot-full-loras](https://huggingface.co/Mothersuperior/YuE2-instrumental-cot-full-loras) (instrumental songs) |
| `minimax_h3_fun_controlnet_union_pruned_int8_convrot.safetensors` | `model_patches` | [Comfy-Org/MiniMax-H3](https://huggingface.co/Comfy-Org/MiniMax-H3) (Genjutsu motion transfer and restyle) |
| `minimax_h3_fun_controlnet_union_2.0_pruned_int8_convrot.safetensors` | `model_patches` | [Comfy-Org/MiniMax-H3](https://huggingface.co/Comfy-Org/MiniMax-H3) (Genjutsu object swap) |
| `sdpose_wholebody_fp16.safetensors` | `checkpoints` | [Comfy-Org/SDPose](https://huggingface.co/Comfy-Org/SDPose) |
| `rt_detr_v4-x-hgnet_fp16.safetensors` | `diffusion_models` | [Comfy-Org/SDPose](https://huggingface.co/Comfy-Org/SDPose) |
| `seedvr2_ema_3b-Q8_0.gguf`, `ema_vae_fp16.safetensors` | `SEEDVR2` | [AInVFX/SeedVR2_comfyUI](https://huggingface.co/AInVFX/SeedVR2_comfyUI), [numz/SeedVR2_comfyUI](https://huggingface.co/numz/SeedVR2_comfyUI) (downloaded by the SeedVR2 pack on first use) |

### Camera moves (optional)

Each trained move is used only when its file is in `loras`; without it, the move falls back to MiniMax H3 shooting it
from words. Create marks every trained move with **✦**; the mark is dimmed, and the move's tooltip says so, when its
LoRA isn't installed.

| File | Moves | Source |
|---|---|---|
| `minimax_h3_flf2v_orbit360_lora_v1.safetensors` | 360 orbit, bullet time | [pablodawson/MiniMax-H3-360-Orbit-LoRA](https://huggingface.co/pablodawson/MiniMax-H3-360-Orbit-LoRA) (save under this name) |
| `camera_motion_h3_lora_v1_3000_pruned.safetensors` | push-in, super dolly in, crane up, FPV drone, dolly zoom in | [Jojocodex/minimax-h3-Camera-Motion-lora](https://huggingface.co/Jojocodex/minimax-h3-Camera-Motion-lora) |
| `wan22_crashzoom_high.safetensors` | crash zoom in | GhostInShell's Wan 2.2 CrashZoom (high noise), mirrored at [UnifiedHorusRA/CrashZoom-Wan2.2_2.1-I2V-A14B](https://huggingface.co/UnifiedHorusRA/CrashZoom-Wan2.2_2.1-I2V-A14B) (save under this name) |
| `wan22_arcshot_high.safetensors` | arc right, arc left | GhostInShell's Wan 2.2 ArcShot (high noise), [UnifiedHorusRA/ArcShot-Wan2.2_2.1-I2V-A14B](https://huggingface.co/UnifiedHorusRA/ArcShot-Wan2.2_2.1-I2V-A14B) (save under this name) |
| `wan2.2_i2v_high_noise_14B_fp8_scaled.safetensors`, `wan2.2_i2v_low_noise_14B_fp8_scaled.safetensors`, `umt5_xxl_fp8_e4m3fn_scaled.safetensors`, `wan_2.1_vae.safetensors`, `wan2.2_i2v_lightx2v_4steps_lora_v1_high_noise.safetensors`, `wan2.2_i2v_lightx2v_4steps_lora_v1_low_noise.safetensors` | the Wan 2.2 moves | [Comfy-Org/Wan_2.2_ComfyUI_Repackaged](https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged) |

### Model licences

Every model and LoRA keeps its own licence. Read each model card before you use its output, in particular for
commercial work and for where you live: several of these (the MiniMax H3 family and LoRAs built on it, Krea 2 and
its LoRAs, Qwen Image's research licence, SAM 3.1 under Meta's SAM License, the Wan 2.2 camera LoRAs and the YuE2 instrumental LoRA) carry their own
terms, and some are non-commercial. Valis's own code is GPL-3.0.

## 6. Check it works

- **No GPU needed:** open **FX**, drop any clip, keep the example cue sheet, click two effect cards and press **Render**.
  About a minute later the result plays in the viewer and lands in the bin. **Score → Example** opens the bundled
  DANSE MACABRE score with its shots, so the preview plays without generating anything.
- **On the GPU:** **Renders → End-to-end test** renders every Create combination and every chain after it at low
  resolution and checks each output for size, length, motion, colour and sound. See
  [Renders and Setup](guides/renders.md#end-to-end-test) for what it needs and how long it takes.
- **For developers:** `node tests/graphs.test.mjs` checks every graph the studio can send against a ComfyUI node list
  (no GPU, no server). `node tests/ui/run.mjs` clicks through the studio in a headless browser against a stand-in
  ComfyUI (it needs Playwright: `npm i -D playwright && npx playwright install chromium`).

## Updating

`git pull` in `ComfyUI/custom_nodes/ComfyUI-Valis`, then reinstall the requirements if they changed. A change to the
Python side (nodes, the engine, the server routes) needs a ComfyUI restart. A change to the studio itself (`app/`)
needs only a reload of the `/valis` tab.

## Uninstall

Delete `ComfyUI/custom_nodes/ComfyUI-Valis` and restart ComfyUI. Your renders stay in `ComfyUI/output/valis/`, and
the studio's plans, bin and job times stay in `ComfyUI/user/default/valis/`.

Next: [Your first film](first-film.md) · [Troubleshooting](troubleshooting.md) · [All the docs](README.md)
