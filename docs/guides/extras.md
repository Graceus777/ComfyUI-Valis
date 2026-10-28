# Extras

Extras holds three tools that sit outside the film chain: **Stereogram** hides whatever moves in a clip in a field of
dots, **Loop** makes a shot that plays forever, and **Stage** (experimental) splits one still into depth layers for a
live 2.5D camera. Pick one with the switch at the top of the panel; the studio remembers the last one you used. The
tab's key is **7**.

## Stereogram

One button makes two hidden versions of a clip and a check:

- a **stereogram** (magic eye). The dots repeat across the frame and the repeat distance carries depth. Free-view it,
  parallel or cross-eyed, and the thing stands out of the dots in 3D.
- a **kinetogram**. The thing is made of the same dots as the field and only its dots move, so every paused frame is
  plain noise and the thing exists only while it moves. Nobody has to learn to free-view.
- a **decode check**. Valis reads the depth back out of the stereogram after an H.264 round trip at a bitrate you set,
  so you can see whether the picture survives an upload.

### What it needs

SAM 3 and Depth Anything 3 (see [install](../install.md)). The dots themselves are drawn by Valis nodes with no model.

### Make one

1. Drop a clip on **Clip**, or click a clip in the bin and choose **Extras · hide it in noise**.
2. Under **What to hide**, name the thing as you'd say it. The default is `the person`. **up to** sets how many of
   them SAM 3 follows (1 to 8, default 2).
3. Set the three sections below (each is described next), or leave them.
4. Press **Hide it**. Its sub-label shows the estimated time.

SAM 3 tracks the thing in every frame, Valis rounds its silhouette like a balloon and adds Depth Anything 3's relief
inside it, and the stereogram, the kinetogram and the decode check render in one job.

### The controls

**Viewing**

| Control | What it does |
|---|---|
| **Free-view** | **Parallel** (look through the screen, as if at something far behind it) or **Cross-eyed** (cross your eyes slightly in front of the screen). The stereogram is made for the one you pick. |
| **A spinning shape too** | **None**, or a cube, torus, octahedron, heart, star or blob turning in the field next to the hidden thing, in the upper left of the frame |

**The dots** (what the field is made of, set by Valis Static)

| Control | What it does |
|---|---|
| **Drawn as** | **Squares**, **Halftone** or **Letters**. Letters adds a character set menu. |
| **Dot size** | 1 to 16 px, default 4. Bigger dots survive upload compression better; the node's own advice is 6 at 1080p. |
| **Noise** | white is even TV snow; pink and brown clump into soft blobs and are harder to fuse; blue and violet are fine and even, and easiest to fuse |
| **Colour** | black & white, grey, rgb (every dot a random colour), rgb 8 (the eight corners of RGB), tv (snow with colour blotches), palette (adds a palette menu) |
| **New dots every** | 1 frame is live TV snow (default). More frames upload with fewer bits. **never** keeps one field throughout, the cheapest to upload, but then a moving thing shows as copies repeating across the frame. This sets the stereogram; the kinetogram's field is always live. |

**Upload check**

| Control | What it does |
|---|---|
| **Upload bitrate** | 1 to 20 Mbps, default 4. The decode check encodes the stereogram with H.264 capped at this rate before it reads the depth back. |

### How to see a stereogram

Make the video big, then look through the screen as if at something far behind it, until the two dots at the top
become three. The picture rises out of the dots. Cross-view versions are made for crossing your eyes instead.

The field repeats about every ninth of the frame's width. Fusing works when one repeat on the screen is narrower than the
distance between your eyes, so on a very large screen step back or play it smaller.

### What comes out

Three videos, at the clip's own frame rate, shown under the viewer and added to the bin:

| In the bin | File in `ComfyUI/output/valis/` |
|---|---|
| stereogram (parallel) or stereogram (cross) | `stereo_<stamp>_parallel_...mp4` or `..._cross_...mp4` |
| kinetogram | `stereo_<stamp>_kinetogram_...mp4` |
| decoded (upload check) | `stereo_<stamp>_decoded_...mp4` |

The decoded video is what a fusing viewer's eyes get after the upload. If it shows a clean shape, the stereogram will
survive a platform's transcode at that bitrate.

### Limits and tips

- Colour detail is the first thing a codec drops. Run the upload check at your platform's bitrate before you settle on
  a colourful field.
- A thing that stands still disappears from the kinetogram, because only motion shows it. In your own graph, give
  Valis Kinetogram a slow `drift_y` (its tooltip suggests 1.5).
- The kinetogram needs no free-viewing, so it works for anyone who can't fuse the stereogram.
- Valis Stereogram's own description records a test: 1080p, 6 px dots, H.264 capped at 3 Mb/s, and the hidden dancers
  still matched 0.87 in the decode check.

### In ComfyUI

[`32_stereo_hidden_in_noise.json`](../../workflows/32_stereo_hidden_in_noise.json) is this button's graph, with the
decode check's numeric score (shape match and depth error) in Valis Stereo Decode's report. The stereo nodes are in
the [node reference](../reference/nodes.md#stereo).

## Loop

A shot that plays forever, made by MiniMax H3 itself. The [MiniMax H3 Loop](https://github.com/pxl-pshr/ComfyUI-MiniMaxH3-Loop)
pack samples the video with its end wrapped round to its start, so the join is denoised like any other frame and needs
no crossfade. The loop is saved as an MP4 and a GIF, and FX can add effects that loop with it.

### What it needs

- The ComfyUI-MiniMaxH3-Loop node pack. Without it, **Make the loop** shows the `git clone` line to install it.
- MiniMax H3's text encoder and VAEs, and one of two video checkpoints: FastH3 OmniRef for **Draft · FastH3**, MiniMax
  H3 ref2va for **Final · H3 25 steps**. Draft is the default, so download FastH3 OmniRef first (Renders · Engine has
  a button for it) or switch to Final. See [install](../install.md).

### Make a loop

1. Drop a still on **Picture**, or click a keyframe in the bin and choose **Extras · loop it**. The still is H3's
   reference picture.
2. In the first box under **What keeps going**, say what's in the picture in a few words.
3. In the second, name the one thing that never stops: the beam turns, waves break, rain falls.
4. Press **Make the loop**.

Describe a state that keeps going, such as one continuous or cyclic motion under a locked-off camera, and leave out
anything that starts, ends or piles up. The prompt Valis sends asks for a locked-off static camera with no pan or zoom,
continuous motion throughout, and a steady ambience with nothing that happens once.

### The controls

**Length, size and engine**

| Control | What it does |
|---|---|
| **One pass** | 4.25 s, 6.4 s, 8.5 s or 10.6 s (H3 renders 107, 158, 209 or 260 frames; the loop is 5 frames shorter) |
| **Size** | 320 to 768 px on the short side, portrait 9:16. The marks are draft (384, 384×672) and native (768, 768×1344). |
| **Engine** | **Draft · FastH3** (8 steps) or **Final · H3 25 steps**, which takes about 3 times as long |
| **clean sound across the join** | on by default. H3 also samples the loop turned half round and takes the sound near the join from that pass, because the sound next to the wrap comes out garbled otherwise. |

**Grade**

| Control | What it does |
|---|---|
| grade menu | **no grade**, or one of the studio's colour palettes, applied by Valis Color Palette |

### What comes out

The MP4 (with sound) plays in the viewer and goes to the bin as `loop`. Both files are in `ComfyUI/output/valis/` as
`loop_<stamp>_...`. Under the result:

- **Add effects that loop** opens FX with the loop as its clip and Loop ticked.
- **Open the GIF** opens the GIF: 480 px wide, one palette for the whole loop and an ordered dither, so nothing
  flickers at the seam.

### Effects that loop

In FX, open **Loop and sound** and tick **the clip is a loop**. The stack then renders through Valis Loop · Render:

- The cues from 0 s to the loop's length repeat on every pass.
- Every effect is played once round before frame 0, so trails, echoes and frost carry across the join.
- Whatever still differs between the two passes is faded over the last 12 frames.
- The clip keeps its own sound. The effects' own sounds and the beds aren't mixed in on a loop, so ticking the box
  turns off **every effect makes its own sound** and the beds.
- The result is saved as an MP4 and a GIF.

For cues that land on the same beat every pass, pick a tempo whose whole bars fill the loop. A 4.25 s loop is 2 bars of
4/4 at 112.94 BPM, which is what [workflow 31](../../workflows/31_fx_on_a_loop.json) uses in its cue sheet:

```text
bpm 112.94 4/4
every 1 beat from 0 to 20 kick
every 1/2 beat from 0 to 20 hat
every 1 bar from 0 to 20 downbeat
```

### In ComfyUI

[`30_loop_h3.json`](../../workflows/30_loop_h3.json) makes a loop (FastH3, 8 steps, MP4 with sound and a GIF) and
[`31_fx_on_a_loop.json`](../../workflows/31_fx_on_a_loop.json) puts a library stack on one. For effects outside the
library, the loop nodes Valis Loop · Open, Loop · Cues and Loop · Close do the same warm-up and seal around any
frame-by-frame node; see the [node reference](../reference/nodes.md#loops).

## Stage (experimental)

Name what's in a still. Valis cuts it into depth layers and paints in what each one hides, so a camera can move through
it: push in, arc, crane, dolly zoom. The split is one GPU job. After that every move plays live in the browser at the
still's own resolution, and the export draws the same frames with no new render.

Stage is marked experimental in the studio, and its panel says how to work round its known weak spots:

- Smoke and haze that aren't named sit at ground depth and can streak on a big move.
- A very broad name ("the desert") can take the whole picture.
- Big arcs can tear thin shapes.

Two more limits come from how it works. The 3D set is made from one view, so the far side of things stays empty. And a
move that crops in past the still's own pixels looks soft at 1080p.

### What it needs

- SAM 3 and Depth Anything 3 for the split.
- SeedVR2 (its node pack) to sharpen small stills.
- Krea 2 to paint a still from words, and the Krea 2 identity-edit nodes and LoRA for erase first and clean plates.
- For **Paint what the camera uncovers**, the krea2-anypaint pack and its LoRA, or Qwen Image 2.1 (GGUF) with the
  outpaint LoRA.

All of these are in [install](../install.md). Setup under Renders checks Stage's graphs (splitting a still, a set from
words, and painting past the frame with Krea 2 AnyPaint or with Qwen Image 2.1), so a missing piece shows up there
before you split or paint.

### Split a still

1. Drop a still on **Still**: a keyframe, a painting or a photo. The drop takes files only; bin items can't be dragged
   onto it.
2. Under **What's in it**, name the things that should move on their own, one per line, up to 12. SAM 3 finds every
   one of each ("the lamps" finds all the lamps, up to 20 of them). Everything else becomes *the rest*.
3. Set **depth**: how deep the scene is, as the farthest point's distance over the nearest's (1.5 to 30, default 6).
4. Leave **Sharpen small stills to 1440p** ticked. A still under 1300 px on its short side is then sharpened to 1440 px
   with SeedVR2 before the split, so 1080p exports and push-ins stay crisp.
5. Press **Split it**.

SAM 3 finds each name, Depth Anything 3 orders them, and Valis completes every layer behind the ones in front. When the
newer Valis Stage nodes are loaded, the split erases first: a Krea 2 edit removes the things standing in the still (all
at once, and the biggest one alone), SAM 3 checks they are gone (one retry when the first edit left one standing), the
scenery is split from the erased picture, and the things go back on top as cutouts. A move then uncovers real paint
instead of a smear. The stage opens and starts playing when the job is done.

Earlier stages open from the menu under the description box (**open a stage…**), which lists every stage folder with
its layer count.

### Make the set from words

Describe a scene in the box under **Still** and press **Make the set from words**. Krea 2 paints a 16:9 still
(1792×1008), SeedVR2 sharpens it when the sharpen box is ticked, and the split runs, all in one GPU job.

- The names under **What's in it** follow your description (up to 8, with `the sky` added when the words mention a sky,
  the night, the moon or similar) until you edit them by hand.
- **seed** (default 7101) decides the still: the same seed paints the same still, so you can change a name or a
  setting and make the set again to compare. ComfyUI reuses the painted still, so only the split runs again.
- **Try another seed** picks a random seed and makes the set again.

### Camera

| Control | What it does |
|---|---|
| move chips | Locked off, Push in, Pull back, Truck left, Truck right, Crane up, Crane down, Arc left, Arc right, Dolly zoom (in), Dolly zoom (out), Zoom in (lens), Drift (handheld breath), Show the layers (the set, exploded) |
| **Around** | the layer the move is built around: a dolly zoom holds it at one size, an arc circles it. Valis picks the biggest compact thing when a stage opens. |
| **Amount** | 0.2 to 2.5, default 1 |
| **Length** | 1 to 12 s, default 4. A dropped sound or a cue sheet sets it to its own length, up to 30 s. |
| easing | **Smooth**, **Ease out**, **Ease in**, **Linear** |
| edge | **Crop in** zooms in as far as needed so the still's edge never shows. **Show the dome** (default) lets the camera see past the edge, where the set fades into the far dome: less crop and wider moves. A stage without a dome always crops; split it again to get one. |
| **move starts at** | when the move begins, in seconds |
| punch menu | **no punch**, or a zoom punch on every hit of a lane (once a sound or cue sheet is loaded) |
| **+ then another move** | adds a later move with its own move, subject, start time and amount. Click a move's row, then click the sound strip to start it on a word or a hit; the click snaps to a cue within a quarter second. |

The line under the viewer says how far the move crops in and how many of the still's pixels fill the export frame. When
that is too few it warns that the export will look soft, and suggests a lower amount, 720p, or upscaling the still
first.

### Sound and direction

**Sound** is optional. Drop music or a voice line (audio or video) and choose **Music** (kick, snare, hat, onset, beat
and downbeat lanes), **Voice** (a syllable lane) or **Both**. A cue sheet in the box below works with no sound at all.
The lanes come from the same cue engine as FX, and a toast says what was heard. The sound strip under the viewer shows
the waveform, the lanes' hits and where each move starts.

**Direction** gives layers something to do. Press **+ Give a layer something to do** and pick a layer, an effect, when
(**always**, or on a lane) and an amount (0.1 to 3):

| Effect | What it does |
|---|---|
| Glow | lights up on the cue (lamps, windows, the moon) |
| Flicker | a flame's unsteady light, flaring on the cue |
| Pulse | swells on the cue, like a heartbeat |
| Appear | absent until the first cue, then fades in |
| Vanish | there until the first cue, then fades out |
| Drift | slides slowly sideways (clouds, mist) |
| Rise | floats up (smoke, steam, embers) |
| Sway | moves in the wind, anchored at its base (trees, grass, hair) |
| Shake | jolts on every cue |
| Dim | darkens on the cue, then recovers |
| Embers | throws glowing embers that rise and fade (fire, braziers, torches) |
| Sparks | a burst of sparks on every cue |
| Motes | dust or snow drifting in the light |

**Layers** lists every layer, nearest first. Untick one to see what's behind it; its slider pushes it nearer or
farther. Backdrops are marked `backdrop`, the others show their depth.

### The checks panel

When a stage opens, a line under the viewer reads **Checks: N of M pass**, followed by what to look at. It opens by
itself when a check fails. The checks are pixel tests run when the stage was split, and they say what a move will show
before you look:

| Check | Passes when |
|---|---|
| First frame is the still | at rest, 99% of pixels are within 2/255 of the still |
| No ghost outlines | hiding each thing leaves no edge along its outline on what's behind it |
| Names found one thing each | no name was dropped (SAM 3 found nothing) or read as much more than one thing |
| The things were erased | every thing to erase really went (erase-first stages only) |
| Few torn triangles | under 1% of what shows at rest sits on a depth jump the renderer tears |
| Real paint behind the things | under half of the paint a move uncovers next to the things is guessed (smeared) rather than real |

A broad name is one that took more than 35% of the frame or runs through half the scene's depth, unless it names
something big by nature (the sky, the sea, the ground, a forest, a wall, fog, smoke). The note suggests naming one
thing in it, like "the rock in front". A failed names check also shows a toast.

### Paint what the camera uncovers

**Paint what the camera uncovers** is a second GPU job that paints the world past the frame into the stage's far dome,
so wide moves and the 3D set show the room, the street or the sky going on instead of a blur. On a stage that wasn't
split erase first, the same job also paints a clean plate behind the people and things (a Krea 2 edit, checked for
what really went), so a move uncovers real paint there too.

The switch above the button picks the painter:

- **Krea 2 AnyPaint** paints a margin of 30% more on each side. It is the default when its nodes and LoRA are
  installed, and greyed out otherwise.
- **Qwen Image 2.1** outpaints the still placed on a grey canvas twice its size.

Each press paints a new take. The camera, the sequence and the layer effects stay as they were. Save the 3D set again
afterwards to take the painting along.

### Export

| Control | What it does |
|---|---|
| **720p** / **1080p** | the export height; the width follows the still |
| **Export MP4** | renders the same frames as the preview at 24 fps, with no GPU job, and ComfyUI encodes them as H.264 with the dropped sound. The file is saved in the stage's folder as `<move>_<subject>.mp4` (several moves are joined with `_then_`), and a player appears under the viewer. |
| **Save the 3D set** | downloads `<stage>_set.ply`: the stage as Gaussian splats, written in the browser. Every visible layer becomes splats where the camera saw it, including what Valis painted behind, and the far dome goes around it when the stage has one. Hidden layers are left out. Opens in SuperSplat, Blender and game engines. |
| **Save the camera move** | downloads `<stage>_<moves>_cameras.json` in the INRIA format 3DGS training writes, one key per frame at 30 fps. In SuperSplat, open the 3D set, drop this file on it and render at 30 fps to play the same move on the splats. |

Stage's exports don't go to the bin.

### Where it lands

Each split writes a folder under `ComfyUI/output/valis/stage/` (named `stage_<date and time>` from the studio) holding
`stage.json`, the layer and depth images, `erased.png` for an erase-first split, the painted and sharpened stills
when the set was made from words or sharpened, and the MP4 exports. A dropped sound is
uploaded to `ComfyUI/input/valis/stage/`.

### In ComfyUI

[`00_stage_split_a_still.json`](../../workflows/00_stage_split_a_still.json) is the plain split: SAM 3 per name, Depth
Anything 3, Valis Stage. The erase-first split and the painting jobs use the other Stage nodes, which have no exported
workflow; they are described in the [node reference](../reference/nodes.md#stage).
