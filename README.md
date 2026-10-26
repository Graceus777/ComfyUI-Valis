# Valis

**One line in, a scored and cut short film out, on a 12 GB laptop.** Valis is an open studio for ComfyUI. Say what the
film is about: a local Qwen3 writes the shot list and the song brief, YuE2 writes and performs the song, Krea 2 frames
every shot, MiniMax H3 shoots it, SAM 3 tracks the subject, a library of effects fires on the song's own lanes with sound
synthesized in its key, and the cut lands on the bars. Around it: Higgsfield's Cinema Studio and Genjutsu rebuilt on open
weights, a name-it-and-change-it editor, and the cue engine that drives all of it from any song, voice line or sheet music.

![Five shots of DANSE MACABRE, made with Valis on one laptop: every reveal, shockwave and halo fired by the score](docs/hero.jpg)

**[Demo video](#)** · [Workflows](workflows/) · [CLI](#headless-the-cli-and-agents) · built for #OpenSourceHiggsfield ·
open weights only · MiniMax H3 is the video model

## One line, one film

Type what the film is about and press **Plan it**. A local Qwen3 (ComfyUI's own text generation, on the Qwen Image
encoder already on disk) writes the plan as something you can edit: title, cast, place, a song brief, and a line per
shot with its framing, its motion, what to track and which effect fires on which lane. Press **Make the film**: YuE2
writes the sheet music and performs it; Krea 2 frames every shot in one pass; MiniMax H3 shoots each one; SAM 3 tracks
the shot's subject; the library fires the shot's effect on the song's lane and synthesizes its sound in the song's key,
each shot at its own place in the song; and the cut lands every shot on the bars. Six shots is about 25 seconds of film
and about an hour on a 12 GB card. Nothing is prompted by hand and nothing leaves the machine.

A story with the same people across many cuts needs more than words: painted one by one, every still is a new room,
new faces and a new head count. **Build it from references** instead. Each character gets a sheet: a costume-test
portrait (Krea 2); a state of one, like a drowned bride, is a Krea 2 identity edit of her sheet; a prop, like their
wedding photograph, is made from both sheets. The set gets an empty plate per camera setup (a reverse angle turns the
empty plate; turning a frame with people in it brings them back twice). A frame seats the sheets into a setup's plate
as the blocking says (Qwen Image 2.1, every reference in one pass), and every later moment (a trance, a wet chair,
someone arriving, someone gone) is one edit of that seated frame, never of the moment before, so nothing changes that
the script doesn't change. A shot is a frame, or a close-up box dragged on one and enlarged by SeedVR2, which keeps
the pose and the faces the frame has.

The same chain runs headless, for people and for agents:

```sh
node cli/valis.mjs film --idea "a lighthouse keeper rows out into the storm to bring back the woman the sea took" --genre gothic --shots 6
```

## Try it in five minutes, no model needed

Install (below), open **http://127.0.0.1:8188/valis**, click **FX**. Drop any clip, drop any song, stack three effects,
press **Render**. The cue engine reads the kicks, snares, hats and beats of the song and every effect fires on the lane
you name. Nothing in that path touches a diffusion model: it runs on the CPU in about a minute per four seconds of video,
and the sound design is synthesized in the song's key. **Score** has the DANSE MACABRE score and shots bundled, so the
score-driven pass can be played without generating anything.

## What's in it

| Tab | What it does |
|---|---|
| **Film** | A film in steps you can see and stop. Write the script yourself (or let Qwen3 draft one from a line). **Build it from references** so the same people stay in the same places: a sheet for every character, every state of one and every prop; the set, empty, from every camera setup; frames that seat the sheets into a setup and then change one thing at a time; and each shot is a frame or a close-up box cut from one. Then the song (YuE2, or **your own song**, read for its tempo and bars), every shot's keyframe (Krea 2) to look at before anything is shot (re-roll one, edit its words, or **open it in Create** and send the still or shot back), the shots (MiniMax H3), the effects and sound (SAM 3 and the Valis library, on the song's lanes), the cut (on the bars). Each step runs alone or *Make the rest* runs what's missing; the shot count, each shot's length and the size are yours, and a draft size makes a whole film fast. Plans are kept and reopen from *Recent*. |
| **Create** (Cinema Studio) | A director's panel in sections: genre, framing, focal length, camera body, lens kit, era, light source and setup, emotion, tempo, a **colour palette** (39 looks in rows, previewed live on your keyframe as you hover; the chosen look's colours are swatches you can change before you render) and one of 44 camera moves. Every option's tooltip shows the exact words it adds; your choices lead the prompt and the genre fills only what you leave on *From genre*. A **resolution** slider (draft 384 px to 1024, keyframes always full size) and a free **length** (snapped to H3's frame grid). *Frame it* makes two Krea 2 keyframes (or drop your own still); drop a character sheet to cast it in. *Shoot it* turns the keyframe into a MiniMax H3 shot. **Trained moves** (✦): with a camera LoRA installed, the move is learned, not described (360 orbit, bullet time, push-in, crane up, FPV on H3; crash zoom and arcs on Wan 2.2). **Dolly zoom** is a real trained push re-framed by *Valis Dolly Zoom*; **whip pan** is a steady pan speed-ramped by *Valis Whip Pan*. **Relight** and **light change**. Under every result: **Extend**, **Lead-in**, **Upscale** (SeedVR2). |
| **Genjutsu** | Drop a video. **Motion transfer**: up to 8 reference images become the new cast and place; SDPose skeletons carry the motion, camera and timing (H3 Fun ControlNet Union); the source audio is kept. **Restyle**: 24 looks over Canny edges. **Object swap**: name one thing, describe its replacement; SAM 3 finds it, the ControlNet inpaints only that, and the result is composited back onto the untouched plate. **Check source** runs only the pose step and *Valis Pose Check* marks where the body can't be read before a 20-minute render. |
| **Edit** | Drop a clip and name what to change ("his head", "her dress"). SAM 3 tracks it. **Transform** re-renders only the masked region in a new look: **your own** (drop a picture of it, or say what it is and *Paint it* with Krea 2; Krea 2 and H3 both see the picture), or one of 57 presets in seven groups (elements, materials, light and tech, costume, age and weather, spirits, creatures), each shown on the same costume-test sheets, and any preset can be matched to your picture. **Remove** takes a person out with the H3 Person Remover LoRA: what was behind them fills in, and everything outside the mask stays the source's own pixels. **Swap** replaces the whole person with a character sheet (dropped, or painted from words); *Match the plate* checks the take first and matches brightness, contrast, colour and grain back to the plate with no AI. **Turn** makes one take become another on a chosen word, and can turn the voice on the same word. |
| **FX** | The library: 25 effects in four groups, **light first** (flicker, firelight, lightning, a light sweep, glow, light shafts, glint, rim light, heat haze: they relight the shot itself, so they read as the scene's own light), then camera and lens, time, and break and blend; most come with presets (a candle or a strip light, headlights or a lighthouse, a breath of frost or a whiteout). Pick a clip (and another for the effects that open onto a second scene), optionally name a subject, stack effects. Each layer listens to one lane: from a soundless cue sheet, from any song (beats, kick/snare/hat, loudness, brightness), from YuE2 writing and performing a new song (every note becomes a cue), or from a Valis score. Every effect brings its own sound; add beds (rain, wind, sea, fire, room, neon). On a looping clip the effects loop with it: the cues repeat and every effect is played once round first, so trails, echoes and frost carry across the join (MP4 and GIF). |
| **Score** | Make a score in Valis: from **any song** (Valis hears its beats, bars, kick, snare and hats, how loud and bright it is, and lays out sections and shots on whole bars), from a song **YuE2 writes** (every note of its sheet music becomes a lane), or from a **cue sheet**; save it as `.json` and open it again (DANSE MACABRE is the example). Map lanes to library effects, lay clips from the bin on its shots, and the **live preview** plays your clips on the music with every effect sketched as it fires. *Render all*, then *Cut it* on the bars, or *Make a film on it*. |
| **Extras** | **Stereogram**: hide whatever moves in a clip in a field of dots, as a magic-eye stereogram (parallel or cross-eyed) and a kinetogram (it exists only while it moves), drawn in squares, halftone or letters, with a check that the depth survives an upload. **Loop**: a shot that plays forever, H3 joining its end to its start ([MiniMax H3 Loop](https://github.com/pxl-pshr/ComfyUI-MiniMaxH3-Loop)), then effects that loop with it. **Stage** (experimental): one still split into depth layers and played by a live 2.5D camera. |
| **Renders** | The queue, *Free memory*, *Stop*, everything made (the bin, kept between sessions) to send to any tab, and **Setup**: every workflow checked against this ComfyUI, with missing node packs and model files listed per feature. **Detect hardware** reads the GPU, driver, CUDA, cuDNN, attention kernels and ComfyUI's flags, and sets the safe shot size for this GPU. The **end-to-end test** renders every Create combination and every chain after it at low resolution and checks each result. |

| Score | Edit · Turn |
|---|---|
| ![The Score tab: event lanes, rules and a shot rendered with Valis](docs/score.jpg) | ![Turn: the take turns into the swap on a chosen word](docs/edit_turn.jpg) |
| **Create** | **Renders and Setup** |
| ![Create: the director's panel, Krea 2 keyframes and a MiniMax H3 shot](docs/create.jpg) | ![Renders: everything made so far, and the setup check](docs/renders_setup.jpg) |

![The FX tab: effects previewed live, stacked as layers on a clip and fired by a cue sheet, a song or YuE2's own sheet music](docs/fx.jpg)

## What's new here

- **One line, one film.** The planner is open weights on disk (ComfyUI's `TextGenerate` on the Qwen3-VL 8B encoder
  that Qwen Image uses), so a film is written, scored, shot, effected and cut without a prompt typed by hand and
  without a request leaving the machine. Every shot is as long as you set it (one 4.5 s H3 clip unless you say, 2 to
  15 s) and cut to whole bars of the tempo YuE2 actually played, so the picture changes on the music's own grid.
- **The score is the director.** `ValisCues` merges lanes from a Valis score, any music (a beat tracker, band onsets,
  loudness and brightness curves), a voice (syllable onsets), YuE2's ABC notation aligned to its own performance, or a
  plain-text cue sheet (`1.5 shatter`, `every 1/2 beat from 3:1 to 7:1 pulse`, `ramp slip 0 0 4 1`). Every effect,
  every camera punch and every sound in Valis listens to a lane.
- **Effects as layers with a shared context** (`ValisLayer`, `ValisRender`): one context per frame holds the clip, a
  second clip, SAM masks, depth, optical flow and the frames already made, so a datamosh drags the picture along the
  real motion and an echo sheds the subject's own silhouette. Light that relights the plate rather than lying on it
  (the picture is multiplied by a light map, and light reaching a dark corner shows the surfaces there): flicker,
  firelight, lightning, light sweep, glow, light shafts, glint, rim light, heat haze. Double exposure, time slip,
  slit-scan, gravity lens (the real lens equation), datamosh, echo, shatter, frost, vertigo, shockwave, split time,
  era cut, tear, projector, glitch, punch.
- **Sound design that is synthesized, not sampled** (`ValisSoundDesign`): bells, swells, booms, shimmer and hums tuned
  to the song's key, every hit measured (K-weighted) and set a fixed number of dB under the music, the effect bus held
  under the song, dense lanes sounding only on their accents.
- **The Valis pass** (`ValisFX`, from DANSE MACABRE): an excitable-medium reveal (a Barkley model on the SAM mask,
  carried by optical flow) that burns a transformation across a body on the beat; shockwaves, rays, mist, candles,
  glints, halo, bloom and camera punch on their own lanes.
- **Turn on a word** (`ValisScoreFromAudio`, `ValisVoiceTurn`): the voice is the score. Syllable onsets become events,
  one word becomes the impact, the face turns from the eyes on it, and the voice turns on the same word (pitch and
  formant shift, a sub-octave, a growl; no model).
- **Swap checks with no AI** (`ValisSwapCheck`, `ValisSwapMatch`): the take is measured against the character sheet
  before a swap (exposure, contrast, colour cast, noise, face size, key-light side) and the swap is matched back to
  the plate after it (tone curve, colour transfer, grain, light wrap).
- **Real camera moves from real motion** (`ValisDollyZoom`, `ValisWhipPan`, `ValisTrimHold`, `ValisPoseCheck`,
  `ValisCanny`): the vertigo shot and the whip pan are made from footage the video model shoots well, not from prompts
  it shoots badly.
- **Built on the Comfy SDK.** Every job (submit, live progress, uploads, results) goes through the official
  [`@comfyorg/sdk`](https://docs.comfy.org/development/api-development/sdks) over Comfy API v2. The pack mounts
  Comfy-Org's [`comfy-api-proxy`](https://docs.comfy.org/development/comfyui-server/api-proxy) on ComfyUI's own server
  (`sdk_api.py`): same origin, no second server, no CORS. The studio, the CLI and any agent run the same graphs through
  the same client; point it at Comfy Cloud or a Comfy API deployment and the same code runs there.

## Films made with Valis

Every one of these was made on the same 12 GB laptop with the tools above: Krea 2 keyframes, MiniMax H3 shots, SAM 3.1
masks, a Valis score or a YuE2 song written from Valis's own sheet music, then a short spec per film that says which
library effects each shot gets and which lane fires them. Valis cuts on the music's bars, renders every shot's stack and
builds one sound design over the whole film. They are in `ComfyUI/output/finished` on the author's machine and in the demo.

| Film | What drives it |
|---|---|
| **THE MAN IN THE SUIT** (2:05) | A straight-faced featurette about the people who say they were inside the 1966 rehearsal suit. Every person in it is invented and speaks in their own MiniMax H3 voice; the library's Projector turns the reel into worn 16 mm (flicker, gate weave, scratches, dust). A YuE2 instrumental score. |
| **BLUE RIBBON** (53 s) | A 1960s Technicolor caper about a county-fair pie. Every line is spoken by H3 in the shot; trained moves, a dolly zoom, a Wan crash zoom, and a keyframe relit from the daytime fair to the barn at night. A YuE2 score with no lyrics. |
| **OCCUPIED** (61 s) | An animated comedy short: Krea 2 keyframes in a 3D-feature look, MiniMax H3 shots with their own voices, a YuE2 score with no lyrics. |
| **DANSE MACABRE** (83 s) | A Valis score. The reveal burns across the dancers on the kicks; version 4 adds the ballroom of 1843, bleeding through on the strings and cutting in on every *oom* of the waltz. |
| **BURN SEASON: trailer** (71 s) | Cinema Studio end to end: every trained move (crane, push-in, FPV, crash zoom, arc, bullet time), dolly zoom, whip pan, relight, object swap and extend, on Krea 2, MiniMax H3, Wan 2.2 and Qwen Image, to a YuE2 song from Valis's sheet music. |
| **BURN SEASON** (44 s) | The film: double exposures of the two leads over the burning cane and the swamp, a photograph that burns through on the hits. |
| **BLACK SUN** (43 s) | An eclipse over a desert procession: the gravity lens on the sun, shockwaves on the drops, the boy's eyes on the ring. YuE2 from Valis's sheet music. |
| **THE UNDROWNED** (47 s) | *Wade in the Water* performed by YuE2: an underwater church, a ghost procession in the river, double exposures over the old photograph. |
| **GLASS** (44 s) | YuE2 at 108 BPM. Glitch on the hats, datamosh on the kick, split time down the platform, and the station shatters on one cue. |
| **LAST LIGHT OF ENROTH** (49 s) | A painted fantasy: light shafts, lightning and lantern glows fired by the track, a lich king and a bone dragon in oils. |
| **SILENT** (44 s) | No music at all: a cue sheet is the score and every sound is synthesized by Valis. The keeper's logbook burns open onto 1843 and reality tears down the middle of the sea. |
| **SILKSCREEN** (38 s) | A song YuE2 performed from Valis's own sheet music. Double exposures, burns and echoes fire on its melody and bass notes. |

## Install

Valis needs a recent ComfyUI (0.39+). These steps are for the Windows portable build. Elsewhere, use your own `python -m pip`.

```bat
cd ComfyUI\custom_nodes
git clone https://github.com/Graceus777/ComfyUI-Valis
..\..\python_embeded\python -m pip install -r ComfyUI-Valis\requirements.txt
```

Restart ComfyUI and open **http://127.0.0.1:8188/valis**, or click **VALIS** in the ComfyUI menu. The **setup** pill
in the top bar says which features are ready; click it to see exactly what each one still needs. The FX and Score tabs
need no model at all.

`requirements.txt` installs `comfy-api-proxy` (the Comfy API v2 the SDK talks to) plus numpy, opencv-python, scipy and
scikit-image for the Valis engine. The studio makes no request off this machine: its fonts and the SDK are bundled.

### Custom node packs

| Pack | Used for |
|---|---|
| [MaskVidExperiments](https://github.com/drozbay/MaskVidExperiments) | mask cleanup, tracked crop/uncrop, latent masks (Transform, Remove, Score targets) |
| [ComfyUI-ALLinONE-MinimaxH3](https://github.com/LeonQ8/ComfyUI-ALLinONE-MinimaxH3) | `H3MaskVideoPrepare`, `H3IdentityAnchor` |
| [comfyui-krea2edit](https://github.com/lbouaraba/comfyui-krea2edit) | Krea 2 identity edit (anchors, cast a character) |
| [ComfyUI-MiniMax-H3-PDD-Acc](https://github.com/Jalen-Brunson/ComfyUI-MiniMax-H3-PDD-Acc) | 8-step H3 image-to-video (Shoot it) |
| [ComfyUI-GGUF](https://github.com/city96/ComfyUI-GGUF) | Qwen Image 2.1 GGUF (Remove) |
| [ComfyUI-SeedVR2_VideoUpscaler](https://github.com/numz/ComfyUI-SeedVR2_VideoUpscaler) | Upscale |
| [ComfyUI-MiniMaxH3-Loop](https://github.com/pxl-pshr/ComfyUI-MiniMaxH3-Loop) | Create · Loop: H3 shots that play forever |
| [krea2-anypaint](https://github.com/alexw5702-afk/krea2-anypaint) | Stage: Krea 2 paints the world past the frame (the default dome) |
| [Plenio Music Production System](https://github.com/jplenio/Plenio-Music-Production-System) | Score Tools: instrumental YuE2 songs (the sheet music's vocal line moves to an instrument) |

SAM 3, MiniMax H3 (and its Fun ControlNet), Wan 2.2, SDPose, Qwen Image 2.1, YuE2 and the video nodes are part of ComfyUI itself.

### Models

All are open weights. File names must match: they're listed in `app/js/graphs.js` (`MODELS`, `SWAP_LORA`, `TURBO_LORA`), so edit them there if yours differ.

| File | Folder | Source |
|---|---|---|
| `krea2_turbo_fp8_scaled.safetensors` | `diffusion_models` | [Comfy-Org/Krea-2](https://huggingface.co/Comfy-Org/Krea-2) |
| `qwen3vl_4b_fp8_scaled.safetensors` | `text_encoders` | [Comfy-Org/Krea-2](https://huggingface.co/Comfy-Org/Krea-2) |
| `qwen_image_vae.safetensors` | `vae` | [Comfy-Org/Krea-2](https://huggingface.co/Comfy-Org/Krea-2) |
| `Krea2/krea2_identity_edit_v1_2_r64.safetensors` | `loras` | [conradlocke/krea2-identity-edit](https://huggingface.co/conradlocke/krea2-identity-edit) |
| `minimax_h3_fl2va_pruned_w4a8_mixed.safetensors` | `diffusion_models` | [Kijai/MiniMax-H3-experimental](https://huggingface.co/Kijai/MiniMax-H3-experimental) |
| `minimax_h3_ref2va_pruned_int8_convrot.safetensors` | `diffusion_models` | [Comfy-Org/MiniMax-H3](https://huggingface.co/Comfy-Org/MiniMax-H3) |
| `qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors` | `text_encoders` | [Comfy-Org/MiniMax-H3](https://huggingface.co/Comfy-Org/MiniMax-H3) |
| `minimax_h3_video_vae_fp16.safetensors`, `minimax_h3_audio_vae_fp32.safetensors` | `vae` | [Comfy-Org/MiniMax-H3](https://huggingface.co/Comfy-Org/MiniMax-H3) |
| `MiniMax-H3-FL2VA-Acc-8Step.safetensors` | `pdd_acc` | [alibaba-pai/MiniMax-H3-Acc-LoRAs](https://huggingface.co/alibaba-pai/MiniMax-H3-Acc-LoRAs) |
| `h3_character_swap_v1.5.safetensors` | `loras` | [akatz-ai/MiniMax-H3-Character-Swap-LoRA](https://huggingface.co/akatz-ai/MiniMax-H3-Character-Swap-LoRA) |
| `H3-Person-Remover-V1.safetensors` | `loras` | [akatz-ai/MiniMax-H3-Person-Remover-LoRA](https://huggingface.co/akatz-ai/MiniMax-H3-Person-Remover-LoRA) (Remove; Setup can download it) |
| `minimax_h3_ref2v_turbo_8step_v1.0_768p_comfyui_bf16.safetensors` | `loras` | [RunningHubAI/rh-minimax-h3-ref2v-turbo-8step-v1.0-768p-lora](https://huggingface.co/RunningHubAI/rh-minimax-h3-ref2v-turbo-8step-v1.0-768p-lora) (save under this name) |
| `fasth3_omniref_8step_pruned_int8_convrot.safetensors` | `diffusion_models` | [FastVideo/FastH3-Omni-Comfy](https://huggingface.co/FastVideo/FastH3-Omni-Comfy) (optional: Renders · Engine, an 8-step ref2va for Transform, Swap and Genjutsu; Setup can download it) |
| `sam3.1_multiplex_fp16.safetensors` | `checkpoints` | [Comfy-Org/sam3.1](https://huggingface.co/Comfy-Org/sam3.1) |
| `depth_anything_3_small.safetensors` | `geometry_estimation` | [Comfy-Org/Depth-Anything-3](https://huggingface.co/Comfy-Org/Depth-Anything-3), Apache-2.0 (Stage depth, the stereogram) |
| `krea2_anypaint_rank32.safetensors` | `loras` | [yijunwang2/krea2-anypaint](https://huggingface.co/yijunwang2/krea2-anypaint), Krea 2 Community License (Stage: the world past the frame) |
| `qwen-image-2.1-outpaint-v2.safetensors` | `loras` | [ausboss/Qwen-Image-2.1-Outpaint-LoRA](https://huggingface.co/ausboss/Qwen-Image-2.1-Outpaint-LoRA), Qwen Research License (Stage: the Qwen dome) |
| `qwen_image_2.1-Q6_K.gguf` | `unet` | any Q6_K GGUF of Qwen Image 2.1, e.g. [unsloth/Qwen-Image-2.1-GGUF](https://huggingface.co/unsloth/Qwen-Image-2.1-GGUF) (Remove) |
| `qwen3vl_8b_w4a8.safetensors`, `qwen_image_2.1_vae_bf16.safetensors` | `text_encoders`, `vae` | [Comfy-Org/Qwen-Image-2.1](https://huggingface.co/Comfy-Org/Qwen-Image-2.1) (Remove, Relight) |
| `yue2_3b_bf16.safetensors` | `checkpoints` | the YuE2 checkpoint for ComfyUI's native YuE2 nodes (FX · *New song* only) |
| `ar_lora_inst_v3abc_comfyui.safetensors` | `loras` | [Mothersuperior/YuE2-instrumental-cot-full-loras](https://huggingface.co/Mothersuperior/YuE2-instrumental-cot-full-loras), CC BY-NC 4.0 (instrumental songs: with the [Plenio](https://github.com/jplenio/Plenio-Music-Production-System) node pack's Score Tools, which moves the sheet music's vocal line to an instrument) |
| `minimax_h3_fun_controlnet_union_pruned_int8_convrot.safetensors` | `model_patches` | [Comfy-Org/MiniMax-H3](https://huggingface.co/Comfy-Org/MiniMax-H3) (Genjutsu: motion transfer, restyle) |
| `minimax_h3_fun_controlnet_union_2.0_pruned_int8_convrot.safetensors` | `model_patches` | [Comfy-Org/MiniMax-H3](https://huggingface.co/Comfy-Org/MiniMax-H3) (Genjutsu object swap: 2.0 inpaints with mid-grey holes) |
| `sdpose_wholebody_fp16.safetensors` | `checkpoints` | [Comfy-Org/SDPose](https://huggingface.co/Comfy-Org/SDPose) (Genjutsu pose) |
| `rt_detr_v4-x-hgnet_fp16.safetensors` | `diffusion_models` | [Comfy-Org/SDPose](https://huggingface.co/Comfy-Org/SDPose) (Genjutsu pose: finds the people) |
| `seedvr2_ema_3b-Q8_0.gguf`, `ema_vae_fp16.safetensors` | `SEEDVR2` | [AInVFX/SeedVR2_comfyUI](https://huggingface.co/AInVFX/SeedVR2_comfyUI), [numz/SeedVR2_comfyUI](https://huggingface.co/numz/SeedVR2_comfyUI) (Upscale; the SeedVR2 node pack downloads them itself on first use) |

**Camera moves (optional).** Each one is used only if its file is in `loras`; without it the move falls back to H3 from words.

| File | Moves | Source and licence |
|---|---|---|
| `minimax_h3_flf2v_orbit360_lora_v1.safetensors` | 360 orbit, bullet time | [pablodawson/MiniMax-H3-360-Orbit-LoRA](https://huggingface.co/pablodawson/MiniMax-H3-360-Orbit-LoRA), MiniMax H3 community licence (save under this name) |
| `camera_motion_h3_lora_v1_3000_pruned.safetensors` | push-in, super dolly in, crane up, FPV drone, dolly zoom in | [Jojocodex/minimax-h3-Camera-Motion-lora](https://huggingface.co/Jojocodex/minimax-h3-Camera-Motion-lora), Apache-2.0 |
| `wan22_crashzoom_high.safetensors` | crash zoom in | GhostInShell's Wan 2.2 CrashZoom (high noise), mirrored at [UnifiedHorusRA/CrashZoom-Wan2.2_2.1-I2V-A14B](https://huggingface.co/UnifiedHorusRA/CrashZoom-Wan2.2_2.1-I2V-A14B); non-commercial (save under this name) |
| `wan22_arcshot_high.safetensors` | arc right, arc left (mirrored) | GhostInShell's Wan 2.2 ArcShot (high noise), [UnifiedHorusRA/ArcShot-Wan2.2_2.1-I2V-A14B](https://huggingface.co/UnifiedHorusRA/ArcShot-Wan2.2_2.1-I2V-A14B); non-commercial (save under this name) |
| `wan2.2_i2v_high_noise_14B_fp8_scaled.safetensors`, `wan2.2_i2v_low_noise_14B_fp8_scaled.safetensors`, `umt5_xxl_fp8_e4m3fn_scaled.safetensors`, `wan_2.1_vae.safetensors`, `wan2.2_i2v_lightx2v_4steps_lora_v1_high_noise.safetensors`, `…_low_noise.safetensors` | the Wan 2.2 moves | [Comfy-Org/Wan_2.2_ComfyUI_Repackaged](https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged) |

The rest of the library (effects, cues, sound, colour palettes, the swap checks and the voice turn) runs on the CPU with no model.

## Use it

**In the studio:** open `/valis`. Hover anything for what it does; press **?** for how the tabs work together. Everything
you make lands in the **bin** (bottom right): click an item to send it to another tab, or drag it onto a drop zone or a
Film shot. Every button's time is learned from this machine's own past jobs (a `?` means it hasn't run that kind of job
here yet). Renders land in `ComfyUI/output/valis/`.

**As workflows:** [`workflows/`](workflows/) has every graph the studio sends, in API format. Drag one onto the
ComfyUI canvas, point its Load nodes at your files, and queue it. `node tools/export_workflows.mjs` regenerates them.

### Headless: the CLI and agents

`cli/valis.mjs` runs the same graphs through the same Comfy SDK, uploading local files and downloading the results.
It needs Node 18+ and nothing else.

```sh
node cli/valis.mjs film --idea "a lighthouse keeper rows out into the storm to bring back the woman the sea took" --genre gothic --shots 6
node cli/valis.mjs film --idea "..." --plan-only > plan.json      # edit it, then: valis film --plan plan.json
node cli/valis.mjs frame --prompt "a lighthouse keeper on a rocky shore at night, holding a lantern" --genre gothic
node cli/valis.mjs shoot --image key.png --motion "he raises the lantern and turns to the sea" --move push
node cli/valis.mjs swap --video take.mp4 --character vampire_sheet.png --background ballroom.png --person man
node cli/valis.mjs turn --a take_as_the_man.mp4 --b take_as_the_vampire.mp4 --at 3.8
node cli/valis.mjs transform --video clip.mp4 --target "his head" --look bronze
node cli/valis.mjs transform --video clip.mp4 --target "the man" --ref stag_spirit.png --words "a stag-headed spirit of bark and moss"
node cli/valis.mjs run workflows/14_genjutsu_motion_transfer.json --set v.file=dance.mp4 --set ref0.image=cast.png
node cli/valis.mjs help
```

It prints a JSON summary (job id, seconds, output files), so a coding agent can drive Valis directly. That's how
*DANSE MACABRE* and the demo's cold open were produced: by describing the shot to an agent that built and queued
these graphs. `--api` / `--key` point the CLI at Comfy Cloud or a Comfy API deployment.

## How it's built

- **The pack:** `__init__.py` serves the studio at `/valis` and mounts Comfy API v2 (`sdk_api.py`). `nodes.py` holds
  `Valis Score (load)`, `Valis Score (from a voice)` and `Valis FX (score-driven pass)`; `nodes_lib.py` exposes the
  library (cues, layers, render, sound design, swap check and match, voice turn, colour palette, trim hold, dolly zoom,
  whip pan, batched Canny, pose check). `nodes_stereo.py` hides pictures in noise: SAM 3 masks, Depth Anything 3 or
  spinning solids become a magic-eye stereogram or a kinetogram (motion-only), drawn in a static you choose (squares,
  halftone or the v1 ASCII sets; noise colours; RGB, colour-TV or the v1 palettes), with a decoder that checks the depth
  survives H.264 (`workflows/32`). `model_routes.py` fetches a missing model file from Hugging Face when you ask.
- **The studio:** plain ES modules under `app/`, with no build step. `api.js` is the SDK client. `film.js` is the film
  chain, run by the Film tab and by `valis film` through the same SDK. `graphs.js` has every workflow as an API-format
  builder. `presets.js` holds the director's panel and the looks. `score.js` is the timeline.
  `fx.js` is the library tab. `check.js` is the setup check. `create.js` turns the director's panel into prompts and
  graphs (the Create button, the end-to-end test and the CLI share it). `grade.js` is `palette.py`'s grade in the browser
  (the live palette preview); `livefx.js` sketches the library's effects live for the Score preview. `estimate.js` and
  `work.js` learn job times from this machine; `bin.js` is the bin; `machine.js` reads the hardware (with
  `machine_routes.py`); `selftest.js` is the end-to-end test. Stage is `stageview.js`, `stage3d.js`, `nodes_stage.py`
  and `stage_routes.py`. `app/vendor/comfy-sdk.js` is `@comfyorg/sdk` bundled for
  the browser by `tools/build-sdk/`.
- **The engine:** `valis_fx/` (numpy and OpenCV, CPU). `engine.py` is the score-driven pass, `forge.py` the shared
  light, particle and grade tools, `post.py` the excitable reveal. `valis_fx/lib/` is the library: `cues.py`, `audio.py`
  and `abc.py` (cues from scores, songs, sheet music and voices), `core.py` (clips, masks, flow, the render loop),
  `effects.py`, `light.py`, `sound.py`, `match.py`, `voice.py`, `dolly.py`, `whip.py`, `posecheck.py`, `palette.py`.
- **Machine controls:** free memory, stop, VRAM, the node list and the render gallery use ComfyUI's own endpoints,
  because Comfy API v2 doesn't cover them.

## Testing

- `node tests/graphs.test.mjs`: every graph the studio can send, and Create across every camera move, aspect, size and
  option, built with the same planner the buttons use and checked against a ComfyUI node list (34,000+ checks, no GPU).
- `python tests/check_grade.py`: the browser's live colour grade against `palette.py`'s (within 0.2 levels on every look).
- `node tests/ui/run.mjs`: the studio clicked through in a headless browser against a stand-in ComfyUI
  (`tests/ui/mock_server.mjs`), with a screenshot of every screen.
- **Renders → End-to-end test** (or `(await import("/valis/app/js/selftest.js")).run()` in the browser console): short,
  low-resolution renders on the GPU through the studio's own code. 15 Create combinations (IMAX 65mm + fisheye + 1950s
  + noir, Super 8, VHS, trained moves, Wan, custom palettes, an end frame, a loop, relight, a cast character), then the
  chains after them: extend, lead-in, upscale, find, transform, remove, swap, turn, Genjutsu's three modes and source
  check, FX on a cue sheet, a song, a YuE2 song and a loop, the stereogram, a score made from a song and cut on its bars,
  a film from one line, and Stage. Every output is checked for size, length, motion, monochrome and sound.

## Timings on an RTX 4080 Laptop (12 GB VRAM, 32 GB RAM)

| Step | Time |
|---|---|
| Film · plan (Qwen3, with the model load) | ~2 min |
| Film · 6 shots, start to finish | ~1 h |
| Frame it (2 Krea 2 keyframes) | ~40 s |
| Cast a character (Krea 2 identity edit) | ~80 s |
| Shoot it (4.5 s H3 shot, 8 steps) | ~7 min |
| Find it (SAM 3 track) | ~35 s warm, ~2.5 min cold |
| Transform (masked H3 re-render) | ~12 min |
| Swap (6 s take, turbo, 8 steps) | ~15 min |
| Turn / Valis pass | 1–2 min (CPU) |
| FX library stack | ~1 min per 4 s of video (CPU) |
| New song (YuE2, 20–40 s) | ~45 s |
| Trained camera move, H3 (4.5 s) / Wan 2.2 (5 s, 720p) | ~7 min / ~9 min |
| Dolly zoom (trained push + SAM 3 + re-frame) | ~8 min |
| Genjutsu, 5 s at 480p (motion transfer, restyle) | ~6 min |
| Genjutsu source check (SDPose + Valis Pose Check, 10 s clip) | ~3–4 min |
| Extend (5 s more) / Upscale to 1080p (5 s) | ~2.5 min / ~7 min |

Run **Free memory** between big jobs on a 12–16 GB card: H3 image-to-video and H3 ref2va don't fit side by side.
*Keep the clip's own sound* (Edit) feeds the clip's audio to H3. Untick it for silent clips.

## Licenses

Valis is GPL-3.0 (see `LICENSE`). `app/vendor/comfy-sdk.js` bundles `@comfyorg/sdk` (MIT) with zod, hash-wasm and
eventsource-parser (MIT); `app/vendor/fonts/` bundles Inter and Cormorant Garamond (SIL Open Font License). Models and
node packs keep their own licenses. The DANSE MACABRE score, pictures and cold open were made for this project.
