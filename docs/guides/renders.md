# Renders

Renders is the studio's back room. It shows the jobs running now, everything made so far, what this machine is and what
shot size it handles, whether every feature has the node packs and model files it needs, which engine renders Edit and
Genjutsu, and the end-to-end test that runs the whole studio at low resolution. The tab's key is **5**.

![Renders: the machine, the end-to-end test and everything made so far](../renders_setup.jpg)

## The queue

**Queue** lists the jobs the studio has queued since the page opened, newest first, each with its label, its status
(queued, a percentage while running, done or error) and a progress bar. When a job fails, a toast names the node that
failed and its message.

| Control | What it does |
|---|---|
| **Free memory** | unloads every model and frees GPU and system memory (ComfyUI's `/free`) |
| **Stop current** | stops the job running now (ComfyUI's `/interrupt`). Jobs waiting behind it stay in the queue. |

Two pills in the top bar follow the machine from any tab. **queue** counts the jobs waiting in ComfyUI's queue from any
client, the ComfyUI canvas and the CLI included. **VRAM** shows free and total GPU memory, refreshed every 8 seconds;
hover it for system RAM.

Press **Free memory** between big jobs on a 12 to 16 GB card. The [README's timings](../../README.md#timings-on-an-rtx-4080-laptop-12-gb-vram-32-gb-ram)
explain why: H3 image-to-video and H3 ref2va don't fit side by side.

## Everything you've made

The grid to the right of the panel holds the bin's stills and clips, newest first, up to 160 of them. Hover a clip to
play it. Click any item to send it to a tab, or drag it onto a drop zone, exactly as in the bin.

Opening Renders also reads the last 120 entries of ComfyUI's history, so renders made outside the studio's buttons join
the bin too (labelled as coming from ComfyUI). Only videos and images saved under an output subfolder whose name starts
with `valis` or `danse` are taken, and side files (mattes, overlays, anchors, masks, control and guide videos) and the
end-to-end test's renders are left out.

## The bin

The bin is one strip of everything the studio makes, at the bottom right. Open and close it with the **bin** button in
the top bar, which also shows how many items it holds; it stays open across reloads if you leave it open.

Every finished job adds its results, labelled with the tab and the job. The masks, overlays, anchors and control videos
a job makes along the way stay out, and so do the end-to-end test's renders. The bin keeps up to 300 items in
`ComfyUI/user/default/valis/bin.json`, so it survives a reload, and shows the 80 newest of the current filter.

| Control | What it does |
|---|---|
| **all**, **still**, **clip**, **audio** | filter the strip by kind |
| click an item | opens a menu: the tabs that take this kind, **open** (the file in a new browser tab) and **remove from bin** |
| drag an item | drop it on any drop zone that takes its kind, on a Film shot card or on a Score shot |

The send menu offers:

| Kind | Sends to |
|---|---|
| still | **Create · first frame**, **Extras · loop it**, **Film · shot N** |
| clip | **Edit**, **FX**, **Genjutsu · source**, **Extras · hide it in noise**, **Film · shot N** |

**Film · shot N** entries appear while a film plan is open, one per shot. Songs have no menu entries; drag one onto the
song drop in FX, Score or Film. Stage's still drop takes files only.

**remove from bin** takes the item off the list and leaves the file in `ComfyUI/output`. A removed item stays out even
though ComfyUI's history still lists it; making the same file again brings it back.

## Machine

**Machine** shows what this computer is. **Detect hardware** reads it again and applies the result.

It reads ComfyUI's `/system_stats` and the pack's own `/valis/machine` route, which asks `nvidia-smi`, PyTorch and
ComfyUI for what `/system_stats` doesn't say. Nothing leaves the machine.

| Row | What it shows |
|---|---|
| GPU | the card's name |
| memory | GPU memory, and how much is free |
| compute | the compute capability, and whether the card does fp8 (8.9 and up) and bf16 |
| driver | the NVIDIA driver and the CUDA version it supports |
| PyTorch | PyTorch's version and its cuDNN |
| attention | the attention kernel ComfyUI uses for every model |
| kernels | which of SageAttention, FlashAttention, xformers, Triton and comfy-kitchen are installed |
| memory mode | ComfyUI's VRAM mode |
| RAM | system memory, and how much is free |
| ComfyUI | ComfyUI's version and Python's |
| launch | ComfyUI's command-line flags |

Rows with nothing to show are hidden. If the `/valis/machine` route isn't loaded yet, only the basics appear, with a
note to restart ComfyUI once.

### The safe shot size

Under the rows, Valis turns the GPU's memory into a safe shot size for MiniMax H3 (shown for 9:16) and the reason:

| GPU memory | Safe shot size |
|---|---|
| 11.5 GB or more | 768×1344, H3's native size (the studio's films were made at this size on 12 GB) |
| 9.5 to 11.5 GB | 640×1120; use Upscale for delivery |
| 7.5 to 9.5 GB | 512×896; larger shots spill into system memory and crawl |
| under 7.5 GB | 384×672, drafts only |
| none reported | 512×896 |

Notes follow when they apply:

- whether fp8 is supported (without it, the fp8 and w4a8 checkpoints run slower)
- whether SageAttention is on; installed but unused (start ComfyUI with `--use-sage-attention`); or worth installing
  for video models
- a driver too old for the CUDA PyTorch was built for
- under 24 GB of RAM: switching between Krea, H3 and Qwen reloads them from disk
- ComfyUI in a low or no VRAM mode
- a GPU above 85 °C
- under 7.5 GB of GPU memory: video models offload to system RAM and run very slowly

Pressing **Detect hardware** sets Create's shot size and the Film tab's size to the safe short side, and a toast says
so. The first time the studio opens on a machine it does this once by itself.

## Setup

The **setup** pill in the top bar says whether the studio can run here: `setup ready`, or `setup: N to fix` with a
toast naming the features that miss something. Click it to jump to **Setup** in this tab.

Setup builds the studio's graphs with the same code the buttons use and checks each against this ComfyUI's node list
(`/object_info`), before anything is queued. It covers 51 features plus one more row, **Comfy SDK · job API**, which
checks that Comfy API v2 answers on this server:

| Tab | Features |
|---|---|
| Film | the plan, the song (YuE2), a character's sheet, a sheet's state or a prop, a set from another side, a frame (the cast seated in the set), a close-up cut from a frame, the keyframes, a shot at full quality, the cut |
| Create | Frame it, cast a character, Shoot it (plain, graded, ending on the subject, from a cleaned keyframe), the trained moves on H3 and Wan 2.2, the orbit in halves, relight, light change, whip pan, dolly zoom, trimming the hold, Extend |
| Edit | Find it, Transform, Swap, Swap matched to the plate, Turn, Turn the voice, Remove |
| FX | the library stack, a song YuE2 writes, an instrumental YuE2 writes |
| Genjutsu | Motion transfer, Restyle, Object swap, the source check |
| Score | the Classic render, a score from a song, a score YuE2 writes (instrumental and with lyrics) |
| Extras | Stereogram, Loop (draft and final), Stage (split a still, a set from words, and painting past the frame with Krea 2 AnyPaint or with Qwen Image 2.1) |
| Finish | Upscale |

**Film · a shot at full quality (H3 int8, 30 steps)** is optional. A film is shot without it, so when its model file
is missing the row reads *optional* with a grey dot, is listed last, and doesn't count against `setup ready`.

Each feature lists what's wrong with it:

| Problem | How it reads |
|---|---|
| a node pack is missing | `<node>: needs <pack>`, e.g. `MVEx_SubjectCrop: needs MaskVidExperiments (MVEx)`, or `SAM3_VideoTrack: needs a newer ComfyUI (SAM 3 is built in)` for a core node |
| a model file is missing | `<node>: model file not found: <file>` |
| an input doesn't match | a required input not set, an input the node no longer has, a menu value that isn't an option, or a link to the wrong type |
| the job API is missing | `comfy-api-proxy: not installed: run python -m pip install comfy-api-proxy in ComfyUI's Python, then restart ComfyUI` |

Features with problems come first, with up to five issues each. The ready ones fold into one line (`N more ready`, or
`All N workflows ready`), and an optional one that misses something comes last. Press **Check again** after installing
something. Install steps for every pack and model are in [install](../install.md).

A few steps the studio adds on top of these graphs aren't checked on their own: FX on a looping clip, the retime to
24 fps, the cut's title card and Film's colour hold. They use Valis's own nodes and ComfyUI's core nodes.

### Downloading a model

Two missing files get a **Download** button with their size, because the studio knows where they live:

| File | Folder | Size |
|---|---|---|
| `fasth3_omniref_8step_pruned_int8_convrot.safetensors` (FastH3 OmniRef) | `diffusion_models` | 22.2 GB |
| `H3-Person-Remover-V1.safetensors` (Edit · Remove) | `loras` | 155 MB |

The button's tooltip names the Hugging Face repo and the folder; for the Person Remover it also asks you to read its
licence first. While it runs, the button shows how much has arrived, then `checking sha256`, and Setup checks again when
the file is in place.

The download goes through the pack's own route, `/valis/models/fetch`:

- `POST /valis/models/fetch` with `{repo, path, folder, name?, size?, sha256?, revision?}` starts or resumes a
  download. `GET` returns every download's state (`downloading`, `verifying`, `done`, `error`, `cancelled`), and
  `POST /valis/models/fetch/cancel` with `{name}` stops one.
- It only fetches from `huggingface.co`, only into one of ComfyUI's model folders, and only model file types
  (`.safetensors`, `.gguf`, `.sft`, `.pt`, `.pth`, `.bin`, `.ckpt`, `.onnx`).
- The file is written as `<name>.valis-part` and resumed with HTTP ranges after a network error (up to 30 retries).
- It is checked against the expected size and sha256. A file that fails the hash is kept as `<name>.valis-bad`. Only a
  file that passes is renamed to its real name, so ComfyUI never lists a half-written model.
- A file that already exists is never overwritten.

## Engine

**Engine** picks the model that renders with MiniMax H3 ref2va: Edit's Transform and Swap, and Genjutsu. Edit's Remove
always renders on H3 ref2va, because the Person Remover LoRA was trained on it.

| Option | What it is |
|---|---|
| H3 ref2va (20 steps, or the turbo LoRA) | the default: MiniMax H3 ref2va, 20 steps, or 8 with the turbo LoRA where a feature asks for it |
| FastH3 OmniRef (8 steps, distilled) | the same model distilled to 8 steps ([FastVideo/FastH3-Omni-Comfy](https://huggingface.co/FastVideo/FastH3-Omni-Comfy)) |

With FastH3 chosen, the ref2va checkpoint is swapped for FastH3 OmniRef, the turbo LoRA is dropped, and sampling runs 8
steps on the model's trained schedule with euler, guidance 1 and shift 12/3. The note under the menu calls it a preview
release: compare against H3 ref2va if a render looks off.

If the file isn't on this machine, the option reads `(not downloaded)` and can't be picked, and
**Download FastH3 OmniRef (22.2 GB)** appears below it. Progress shows under the menu (gigabytes done and the rate),
then the sha256 check.

The choice is remembered per browser, and switching back restores the graphs exactly. Changing it runs Setup again.
Two things ignore it: the [CLI](../cli.md) always renders with H3 ref2va, and Extras · Loop picks its own model with
its **Engine** switch. [Workflow 26](../../workflows/26_transform_vampire_fasth3.json) is Transform on FastH3.

## End-to-end test

The end-to-end test renders short, low-resolution versions of the studio's features on your GPU, through the same
builders the buttons use, so a pass means the button works. Each output is checked for size, length, motion, colour and
sound.

### What it runs

First 15 Create combinations, each a Krea 2 keyframe and a shot at 384 px on the short side, about 3 s long:

| Test | Combination |
|---|---|
| c01, c02 | IMAX 65mm, fisheye, 1950s, push in (trained), in Noir and in Teal & orange |
| c03 | Super 8, vintage, 1970s, Faded 70s, handheld |
| c04 | VHS, 1980s, VHS look, static, 16:9 |
| c05 | Digital, anamorphic, Neon night, dolly zoom in (trained + Valis Dolly Zoom) |
| c06 | 16mm, 1960s, Kodachrome, whip pan (Valis Whip Pan) |
| c07 | 35mm, 1920s, Sepia, 360 orbit (orbit LoRA, 8.8 s) |
| c08 | Silent film, Daguerreotype, crash zoom in (Wan 2.2 LoRA) |
| c09 | Action cam, fisheye, 2000s, DV camcorder, FPV drone (trained) |
| c10 | your own colours (Teal & orange with edited swatches), 1:1, crane up (trained) |
| c11 | a custom 3-colour palette, crane over the head, ending on the subject (Qwen end frame) with the hold trimmed |
| c12 | a loop (FastH3), Golden hour |
| c13 | relight to contre-jour, then a light change shot |
| c14 | a character from another keyframe (Krea identity edit), Kodak 2383 |
| c15 | the light change again on another seed |

Then 21 chains, fed with what those made:

| Test | What it does | Fed by |
|---|---|---|
| x01 | Extend: 5 s more after the market shot | c03 |
| x02 | Lead-in: 5 s before the street shot | c01 |
| x03 | Upscale the market shot (SeedVR2, to 720) | c03 |
| x04 | Edit · Find it: the woman (SAM 3) | c03 |
| x05 | Edit · Transform her dress into liquid chrome | c03 |
| x06, x06b | Edit · Remove a man walking at the camera, and a woman walking through the market (Person Remover LoRA) | c01, c03 |
| x07 | Edit · Swap the woman for the street's man (character swap, turbo) | c03, c01's keyframe |
| x08 | Edit · Turn: the market take turns into the relit take, voice too | c03, c13 |
| x09 | Genjutsu · motion transfer: the astronaut walks like the woman | c03, c09's keyframe |
| x10 | Genjutsu · restyle the street shot as clay | c01 |
| x11 | Genjutsu · object swap: her dress becomes the sepia canyon | c03, c07's keyframe |
| x12 | Genjutsu · source check (SDPose + Valis Pose Check) | c03 |
| x13 | FX · Punch, Glitch and Shockwave on a cue sheet | c01 |
| x14 | FX · Echo on the woman and Rays, on a song | c03, the song |
| x15 | FX · a 10 s song YuE2 writes, with Frost on its notes | c06 |
| x16 | FX · Datamosh on the loop, looping with it | c12 |
| x17 | Extras · stereogram, kinetogram and decode check on the market shot | c03 |
| x18 | Score · made from a song, two shots with library effects, cut on the bars | c03, c01, the song |
| x19 | Film · one line to a two-shot film at 384 px (Qwen3, YuE2, Krea, H3, effects, cut) | nothing |
| x20 | Extras · Stage: split the market still into layers | c03's keyframe |

A chain takes its sources from this run, else from the newest earlier run that made them. One whose sources never ran
stops with an error such as `needs c03 first (run the Create combinations once)`.

x14 and x18 play the DANSE MACABRE score's song, which the pack ships for Score's **Example**
(`app/assets/demo/danse_v3.mp3`; x18 makes its score at 161.5 BPM in 3/4). The test uploads it to ComfyUI's input
folder the first time one of them needs it, so nothing has to be put there first.

### The checks

| Check | Passes when |
|---|---|
| size | the video is the width and height asked for |
| length | it is within 0.6 s of the length asked for (not checked where a trimmed hold or a whip pan shortens the shot on purpose, or for a loop) |
| not black | mean brightness is above 3% |
| moves | the frames change from one to the next |
| monochrome | for the Noir, Sepia and Daguerreotype looks (with no custom colours): every pixel has the same hue, grey or one tint |
| sound | the audio is louder than -60 dB (not asked of Wan moves, which have none) |
| longer | Extend and Lead-in come out at 6 s or more |
| upscaled | the upscale's short side is at least 700 px |
| report | the pose check's report names a verdict |
| gone | for Remove: SAM 3 looks for the person in the source and again in the result, and someone stands in under 25% of the place they stood |
| made something | Stage: the split job finished |

Chains are checked on their main video, with a lower bar for motion than the Create shots.

### Run it

Press **Run the test**. The queue fills one combination at a time, the list in the panel marks each test as it goes
(✓ pass, ✗ fail, ! error, … running, · waiting), and a toast gives the count of passes at the end. **Stop after this
one** ends the run when the current test finishes.

Above the grid, **End-to-end test · N of M passed · K not run yet** heads a card per test: its status and time, when it
ran (if the results come from more than one run), a strip of four frames, each check with its measured value on hover,
the error if there was one, and the prompts it used. Each test's latest result is kept, so a run of a few tests leaves
the others as they were.

To run part of it, use the browser console on the studio's page:

```js
const T = await import("/valis/app/js/selftest.js");
await T.run({only: ["c01", "c02"]});    // test ids, or "create" / "chain" for a whole suite
T.stop();                               // stop after the current test
```

`(await import("/valis/app/js/selftest.js")).run()` runs everything. A run from the console writes the same report;
the Renders panel draws it the next time the studio loads.

Reports are saved in `ComfyUI/user/default/valis/selftest/` (`latest.json` and one file per run), and the renders in
`ComfyUI/output/valis/selftest/`. The test's renders stay out of the bin.

## Job times

Most buttons that queue a job show how long it should take in their sub-label, and the time is learned from this
machine.

Every finished job's graph is reduced to a kind, decided by the heaviest model in it (an H3 shot, an H3 ref2va render, a
loop, a Wan move, SeedVR2, YuE2, the film planner, Krea keyframes, a Qwen edit, a SAM 3 track, the Valis library), and
an amount of work (pixels × frames × steps). Its run time, from ComfyUI's start of execution to its end without the wait
in the queue, is kept in `ComfyUI/user/default/valis/timings.json` (the last 400 jobs, with the GPU's name).

- **A kind that has run on this GPU** is estimated from its last 30 jobs here: a straight line of setup time plus a
  rate times the work, fitted once there are three jobs of different sizes, and scaled from their average before that.
- **A kind that hasn't run here yet** gets a first guess: the setup and rate measured on an RTX 4080 Laptop GPU
  (12 GB), scaled by a speed table of common GPUs. These times end in a `?`, as in `~7 min?`. A GPU that isn't in the
  table is taken at the reference speed, and the tooltip says so.

When the studio opens it reads the last 200 jobs in ComfyUI's history, so jobs queued from the ComfyUI canvas or the
[CLI](../cli.md) count too. Times under 50 s are rounded to 5 s, times under an hour are shown in minutes, and longer
ones in hours. Several buttons' tooltips say what the time is based on, such as `from <n> h3 jobs on this machine`.

## Where things are kept

| What | Where |
|---|---|
| everything the studio renders | `ComfyUI/output/valis/` |
| the bin | `ComfyUI/user/default/valis/bin.json` |
| learned job times | `ComfyUI/user/default/valis/timings.json` |
| end-to-end test reports | `ComfyUI/user/default/valis/selftest/` |
| end-to-end test renders | `ComfyUI/output/valis/selftest/` |
| downloaded models | the model folder each one belongs in (`diffusion_models`, `loras`) |
