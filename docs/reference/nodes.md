# ComfyUI nodes

Valis registers 43 nodes in ComfyUI. The studio builds its graphs from them, and you can use them in your own. This page
lists every one by group, with its class name, what it does, its main inputs and outputs, and the exported workflow in
[`workflows/`](../../workflows/) that uses it. Open that workflow to see the node wired the way the studio wires it.

## How they load

`__init__.py` merges the node lists of five modules, in this order: `nodes.py`, `nodes_lib.py`, `nodes_loop.py`,
`nodes_stage.py`, `nodes_stereo.py`. Each module loads on its own, so one that fails (a missing Python package, say)
leaves the others working and prints a line such as `[valis] stage nodes not loaded: <error>` in the ComfyUI console.
A node that is missing from the menu after an update usually needs a ComfyUI restart.

In the node menu they sit under these categories:

| Category | Module | Nodes |
|---|---|---|
| `Valis` | `nodes.py` | the score and the score-driven pass |
| `Valis/library` | `nodes_lib.py` | cues, effect layers, render, sound, checks, camera moves, utilities |
| `Valis/loop` | `nodes_loop.py` | loops |
| `Valis/Stereo` | `nodes_stereo.py` | stereograms and kinetograms |
| `Valis/stage` | `nodes_stage.py` | Stage |

A few conventions hold across the pack:

- Valis counts frames at 24 fps. Retime other clips first with [Valis Frame Rate](#valis-frame-rate-retime-a-clip-to-24-fps).
- Depth is an `IMAGE`, white near and black far, the same way round as Depth Anything 3's `depth` output.
- Valis passes its own data between nodes in these types:

| Type | What it carries | Made by |
|---|---|---|
| `VALIS_SCORE` | a Valis score: tempo, bars, sections, shots and every event | Score (load), Score (from a voice), Score (make), Loop · Cues |
| `VALIS_CUES` | lanes of hits and held curves on a timeline | Cues, Loop · Cues, Loop · Phase Schedule |
| `VALIS_STACK` | a list of library effects and their settings | Layer |
| `VALIS_LOOP` | how a loop was opened (its length and warm-up) | Loop · Open |
| `VALIS_STATIC` | what the dots of a stereogram or kinetogram are made of | Static |

## Score and cues

### Valis Score (load)

`ValisScoreLoad` · `Valis`

Loads a Valis score `.json` from `ComfyUI/input` or a subfolder of it. The Score tab saves scores in this format.

- **Inputs:** `score` (a `.json` file picked from the input folder)
- **Outputs:** `score` (`VALIS_SCORE`), `beat_seconds`, `bar_seconds`
- **Workflows:** [09](../../workflows/09_valis_score_pass.json), [35](../../workflows/35_score_shot_with_the_library.json)

### Valis Score (from a voice)

`ValisScoreFromAudio` · `Valis`

Makes a score from speech. Syllable onsets become events, and one moment becomes the `impact` the turn happens on.
With `swap_at` at -1 it picks the first syllable after the longest pause.

- **Inputs:** `audio`, `swap_at` (seconds, -1 for automatic), `floor_db` (quieter than this is silence, default -42)
- **Outputs:** `score` (lanes `syllable`, `oom`, `impact` and `stab`, the syllables after the impact), `swap_at`
- **Workflows:** [08](../../workflows/08_turn_on_a_word.json), [13](../../workflows/13_turn_with_voice.json)

### Valis Score (make)

`ValisScoreMake` · `Valis/library`

Makes a score from cues: the tempo, every lane's hits, the curves, sections named by how loud they are (intro, verse,
build, chorus, drop, breakdown, outro) and shots cut on whole bars. Wire `json` into Save Text (format json) to keep it
for the Score tab and Valis Score (load).

- **Inputs:** `cues`, `title`, `shot_seconds` (a shot is as many whole bars as fit in this; default 4.46 s, one
  MiniMax H3 clip), `section_bars` (default 8); optional `bpm` and `meter` (0 takes the source's or the analysis's;
  music analysis assumes 4 beats a bar, so a waltz needs `meter` 3; a `meter` of 6 or 7 is written 6/8 or 7/8)
- **Outputs:** `score`, `json` (the score as text). The score keeps the cues' key: the sheet music's, or the one heard
  in the music.
- **Workflows:** [33](../../workflows/33_score_from_a_song.json), [34](../../workflows/34_score_written_by_yue2.json)

### Valis Cues (score / music / sheet music / voice / cue sheet)

`ValisCues` · `Valis/library`

Merges lanes from any mix of sources into one set of cues. Every library effect, every sound and the loop nodes listen
to the lanes this makes.

- **Inputs:** `cue_sheet` (plain-text cues, below), `duration` (seconds; 0 takes it from the sources); optional
  `score` (its events become lanes), `music` (any audio: `kick`, `snare`, `hat`, `onset`, `beat` and `downbeat` lanes,
  and `loud`, `bright`, `low`, `mid` and `high` curves, and the key it hears), `abc` (YuE2 sheet music, aligned to
  `music` when both are given: `melody`, `ins`, `note`, `bass`, `chord`, `bar`; with both, the sheet's `beat` replaces
  the one heard in the music, its bar starts are the `downbeat`, and its tempo, meter and key win), `voice` (a `syllable` lane), `offset` (shifts every cue; a
  shot that starts 8 s into the song takes -8), `bpm_hint`
- **Outputs:** `cues` (`VALIS_CUES`), `summary` (each lane with its count, the curves, the tempo)
- **Workflows:** [10](../../workflows/10_fx_library_cue_sheet.json), [11](../../workflows/11_fx_new_song_yue2.json),
  [31](../../workflows/31_fx_on_a_loop.json), [33](../../workflows/33_score_from_a_song.json),
  [34](../../workflows/34_score_written_by_yue2.json), [35](../../workflows/35_score_shot_with_the_library.json),
  [37](../../workflows/37_fx_light.json)

A cue sheet takes one cue per line, in seconds or `bar:beat`, with the forms the node's tooltip lists:

```text
bpm 96 3/4
1.5 impact
2:1 ignite 0.8
every 1 beat from 3:1 to 7:1 pulse
ramp slip 0 0 4 1
```

### Valis FX (score-driven pass)

`ValisFX` · `Valis`

The pass DANSE MACABRE was made with. An excitable-medium reveal burns a second layer across the subject, and
shockwaves, flares, lightning, a ghost crowd, candles, glints, mist, god rays, grade and camera punch each fire on the
score's own events.

- **Inputs:** `images`, `score`, `start_bar` (the bar this shot starts on), `mode` (`auto` reads the section at
  `start_bar` from the score, or pick one of 10 looks: `prologue`, `midnight`, `call`, `waltz`, `build`, `drop`,
  `breakdown`, `reveal`, `finale`, `dawn`), `reveal` (how `fx_images` comes in: `none`, `ignite` on the kicks, `on`
  held, `call` on call and response, `vanish` burns subject B away, `crowd` a ghost crowd keyed from its own light)
- **Optional:** `fx_images` (the layer to reveal), masks `mask_a`, `mask_b`, `mask_k` (where shockwaves come from),
  `occlusion`, `face`, `depth`; switches `candles`, `glint`, `ghost_face`, `keep_face`; `seeds` (where the reveal
  starts); `mist`, `rays`, `halo`, `wave` (0 to 2); `center` (`body` or `eyes`, for talking heads); `remap` (JSON that
  drives an effect from another lane, e.g. `{"musicbox": "melody"}`)
- **Outputs:** `IMAGE`
- **Workflows:** [08](../../workflows/08_turn_on_a_word.json), [09](../../workflows/09_valis_score_pass.json),
  [13](../../workflows/13_turn_with_voice.json)

## The effects library and sound

### Valis Layer (library effect)

`ValisLayer` · `Valis/library`

One library effect, listening to the lanes you name. Chain layers through `stack` to build a stack; Valis Render and
Valis Sound Design take the result. The 24 effects and their settings are in [the effects reference](effects.md).

- **Inputs:** `effect` (one of the 24), `on` (the lane or lanes that fire it, comma separated), `by` (a held amount: a
  curve such as `loud`, a cue-sheet ramp, or a lane's envelope), `params` (the effect's own settings as JSON, e.g.
  `{"mode": "burn"}`); optional `stack` (the layers before this one). `on` and `by` reach only the effects that take
  them.
- **Outputs:** `VALIS_STACK`
- **Workflows:** [10](../../workflows/10_fx_library_cue_sheet.json), [11](../../workflows/11_fx_new_song_yue2.json),
  [31](../../workflows/31_fx_on_a_loop.json), [35](../../workflows/35_score_shot_with_the_library.json),
  [37](../../workflows/37_fx_light.json)

### Valis Render (library stack)

`ValisRender` · `Valis/library`

Renders a stack over a clip on the cues, frame by frame, on the CPU. Each frame shares one context (the clip, a second
clip, masks, depth, optical flow and the frames already made), so effects can use the real motion and the subject's
own outline.

- **Inputs:** `images`, `cues`, `stack`, `fps` (default 24), `start` (where this clip starts on the cues, in seconds);
  optional `other` (clip `b`: the other era, the scene behind, the double exposure's inner scene), `subject` and
  `mask2` (masks), `depth`
- **Outputs:** `IMAGE`
- **Workflows:** [10](../../workflows/10_fx_library_cue_sheet.json), [11](../../workflows/11_fx_new_song_yue2.json),
  [35](../../workflows/35_score_shot_with_the_library.json), [37](../../workflows/37_fx_light.json)

### Valis Sound Design

`ValisSoundDesign` · `Valis/library`

Synthesizes every effect's own sound on the same cues, adds beds and extra hits, and mixes them with the music.

- **Inputs:** `cues`, `duration`, `beds` (e.g. `rain:.5, wind:.3`; from wind, rain, sea, fire, room, neon), `hits`
  (extra sounds, one per line as `design@lane[:gain]`, e.g. `thunder@strike:.9`; the tooltip lists the designs),
  `music_gain` (default 0.9), `duck` (how far the music dips under the effects; 0 lets the song lead)
- **Optional:** `stack` (each effect brings its own sound on its own lanes), `music`, `seed`, `key` (for tuned sounds,
  e.g. `Bb`, `Dm`, `D phrygian`; blank takes the cues' key: the sheet music's, else the one a score stores, else the
  one Valis heard in the music, else D minor), `space` (the room every sound sits in: `hall`, `room`, `cathedral`,
  `open`, `water`, `dry`), `own` (`music` is the clip's own sound: it keeps its level and the effects go under it)
- **Outputs:** `AUDIO`
- **Workflows:** [10](../../workflows/10_fx_library_cue_sheet.json), [11](../../workflows/11_fx_new_song_yue2.json),
  [35](../../workflows/35_score_shot_with_the_library.json), [37](../../workflows/37_fx_light.json)

### Valis Voice Turn

`ValisVoiceTurn` · `Valis/library`

Turns a voice on a moment: the take's own voice until `turn_at`, then pitch and formant shifted with a sub-octave and a
growl. No model.

- **Inputs:** `audio`, `turn_at` (seconds; -1 takes the score's impact), `pitch` (default 0.74), `formant` (0.86),
  `sub` (0.5), `growl` (0.12); optional `score`
- **Outputs:** `AUDIO`
- **Workflows:** [13](../../workflows/13_turn_with_voice.json)

## Checks and matching

### Valis Swap Check (pre)

`ValisSwapCheck` · `Valis/library`

Measures the take against the character sheet before a swap (exposure, colour, contrast, light, sharpness, grain, the
mask) and pre-grades the sheet to the take's light.

- **Inputs:** `take`, `mask`, `reference` (the sheet), `pregrade` (a Lab colour transfer to the take's light),
  `auto_flip` (flip the sheet when its key light is on the other side)
- **Outputs:** `reference` (graded, flipped if needed), `report` (text)
- **Workflows:** [12](../../workflows/12_swap_matched_to_plate.json)

### Valis Swap Match (post)

`ValisSwapMatch` · `Valis/library`

Matches a swapped or inpainted result back to the plate: tone and colour, grain, softness and light wrap. No model.

- **Inputs:** `plate`, `swapped`, `mask`, `color` (default 0.85), `grain`, `soften`, `light_wrap` (default 0.25);
  optional `swapped_mask` (the subject in the swapped frames: only it is graded and the swapped background is kept,
  for whole-person swaps)
- **Outputs:** `IMAGE`
- **Workflows:** [12](../../workflows/12_swap_matched_to_plate.json), [16](../../workflows/16_genjutsu_object_swap.json)

### Valis Pose Check (is this clip readable for Motion Transfer?)

`ValisPoseCheck` · `Valis/library`

Reads SDPose keypoints and says, second by second, where the body reads clearly and where the video model will have to
guess: no body, legs hidden, facing unclear, left and right swapping, cut off by the frame, false limbs. Run it before a
long Motion Transfer render.

- **Inputs:** `keypoints` (`POSE_KEYPOINT`), `fps`, `score_threshold` (the same threshold the skeleton is drawn with)
- **Outputs:** `report` (JSON text), `timeline` (a strip, green good and red bad, one lane per issue), `start` and
  `duration` (the best window to render)
- **Workflows:** [23](../../workflows/23_genjutsu_source_check.json)

## Camera moves

### Valis Dolly Zoom (lock the subject through a push or pull)

`ValisDollyZoom` · `Valis/library`

Re-frames a real push-in or pull-back so the subject keeps one size and place while the background's perspective keeps
changing. A push-in gives the classic vertigo; a pull-back the reverse. It only crops, so it never invents an edge.

- **Inputs:** `images`, `max_zoom` (the most any frame is cropped in; 1.6 means the tightest frame shows 62% of the
  picture, so a bigger move is locked only partly), `strength` (1 holds the size exactly); optional `mask` (the
  subject per frame from a SAM 3 track; without it the middle of the frame is tracked)
- **Outputs:** `images`, `info` (JSON)
- **Workflows:** [19](../../workflows/19_cinema_dolly_zoom.json)

### Valis Whip Pan (speed-ramp a real pan into a whip)

`ValisWhipPan` · `Valis/library`

Turns a steady pan into a whip pan. It lingers, swings at many times real speed with motion blur taken from the
camera's own measured motion, and lands. Only the clip's own pixels are used, and the result is shorter than the
source (about 1.5 to 3 s from 4.5 s). Clips under 8 frames pass through unchanged.

- **Inputs:** `images`, `fps`, `mode` (`reveal` lands where the pan ends; `return` swings out and back to the start),
  `speed` (peak speed as a multiple of real time; 0 picks it from `smear`), `smear` (peak blur as a share of the frame
  width), `shutter` (exposure per frame; 0.5 is a 180 degree shutter)
- **Outputs:** `images`, `info` (JSON)
- **Workflows:** [22](../../workflows/22_cinema_whip_pan.json)

### Valis Trim Hold (cut a frozen end)

`ValisTrimHold` · `Valis/library`

A shot with a pinned last frame often arrives early and holds that still for a second or more. This keeps `keep`
frames of the hold and drops the rest.

- **Inputs:** `images`, `keep` (frames of the hold to keep; 6 is a quarter second), `threshold` (mean difference on a
  0 to 255 grey scale below which a frame counts as the same still); optional `head` (trim a frozen start too),
  `min_frames` (never cut shorter than this, default 49)
- **Outputs:** `images`, `frames`
- **Workflows:** [17](../../workflows/17_cinema_trained_orbit_h3.json)

## Loops

These take a clip that already loops (MiniMax H3 Loop Decode's frames, from the
[ComfyUI-MiniMaxH3-Loop](https://github.com/pxl-pshr/ComfyUI-MiniMaxH3-Loop) pack) and make effects loop with it. The
[Extras guide](../guides/extras.md#loop) shows the studio side.

### Valis Loop · Render (library stack, looping)

`ValisLoopRender` · `Valis/loop`

Valis Render for a loop. The cues from `start` to `start` plus the loop's length repeat every pass, every effect is
played once round first so trails and echoes are already there at frame 0, and whatever still differs between the two
passes is faded over the last frames.

- **Inputs:** `images`, `cues`, `stack`, `fps`, `start`, `warmup` (seconds played before frame 0; -1 plays the whole
  loop once, 0 only seals), `seal` (frames to fade over, default 12); optional `other` (looped to the same length for
  you), `subject`, `mask2`, `depth`
- **Outputs:** `images`, `report` (how far the two passes differed, and the seam check)
- **Workflows:** [31](../../workflows/31_fx_on_a_loop.json)

### Valis Loop · Open (before any effect)

`ValisLoopOpen` · `Valis/loop`

For effects that aren't library effects (Valis FX, Valis Color Palette, another pack's node). It plays the loop's own
end first as a warm-up, so anything with memory is already running at frame 0. Masks, depth and a second clip come out
laid out the same way. Close it with Loop · Close.

- **Inputs:** `images`, `warmup` (frames; -1 is the whole loop); optional `mask`, `mask2`, `depth`, `other`
- **Outputs:** `images`, `loop` (`VALIS_LOOP`), `mask`, `mask2`, `depth`, `other`
- **Workflows:** none exported

### Valis Loop · Close (after it)

`ValisLoopClose` · `Valis/loop`

Drops the warm-up and seals the last frames into the first, so the clip leads straight back into frame 0.

- **Inputs:** `images`, `loop` (from Loop · Open), `seal` (frames, default 12)
- **Outputs:** `images`, `report`
- **Workflows:** none exported

### Valis Loop · Cues (repeat with an opened loop)

`ValisLoopCues` · `Valis/loop`

Makes cues or a score repeat with an opened loop, lined up with the warm-up. Give Valis Render these cues with `start`
0; give Valis FX this score with its usual `start_bar`.

- **Inputs:** `loop`, `fps`, `start` (where the loop starts on the cues); optional `cues`, `score`, `start_bar`
- **Outputs:** `cues`, `score`
- **Workflows:** none exported

### Valis Loop · Phase Schedule

`ValisLoopPhase` · `Valis/loop`

A per-frame curve that repeats with the loop, frame N wrapping exactly to frame 0. As cues it is a held lane any library
effect can follow with `by`.

- **Inputs:** `frames` (the loop's length; MiniMax H3 Loop gives its length minus 5, so 102 for 107), `cycles`,
  `offset`, `shape` (`sine`, `triangle`, `saw`), `min_value`, `max_value`; optional `name` (the lane name, default
  `loop`), `fps`, `cues` (other cues to add the lane to)
- **Outputs:** `schedule` (`VALIS_SCHEDULE`; no Valis node reads it), `values` (a list of floats), `cues`
- **Workflows:** none exported

### Valis Loop · Seam Check

`ValisLoopSeamCheck` · `Valis/loop`

Reports how big the wrap-around step is next to the steps around it, in picture and in motion.

- **Inputs:** `images`
- **Outputs:** text report
- **Workflows:** none exported (Loop · Render and Loop · Close include the same check in their reports)

### Valis Loop · Save (GIF / WebP / MP4)

`ValisLoopSave` · `Valis/loop`

Saves files that loop forever. The GIF uses one palette for the whole loop and an ordered dither, so nothing flickers
at the seam, and its frame delays add up to the true length.

- **Inputs:** `images`, `filename_prefix` (default `valis/loop`), `format` (`gif`, `webp`, `mp4`, `gif + mp4`, `all`),
  `fps`, `gif_width` (GIF and WebP width, default 480, 0 for full size; the MP4 is always full size); optional `colors`,
  `dither` (`bayer` holds still from frame to frame; error diffusion crawls), `mp4_repeats` (for players that don't loop)
- **Outputs:** `files` (the saved paths as JSON)
- **Workflows:** [30](../../workflows/30_loop_h3.json), [31](../../workflows/31_fx_on_a_loop.json)

## Stereo

Small nodes that recombine. Depth goes in from a SAM 3 mask, a depth model or a spinning solid, and comes out as a
stereogram (free-view it and the thing stands out of the dots) or a kinetogram (only its dots move, so a paused frame
is noise). [Workflow 32](../../workflows/32_stereo_hidden_in_noise.json) uses all but one of them, and the
[Extras guide](../guides/extras.md#stereogram) covers viewing.

### Valis Mask Depth

`ValisMaskDepth` · `Valis/Stereo`

Turns a mask into a rounded depth: the silhouette inflated like a balloon, standing off the field. A depth map of the
same clip adds the thing's own relief inside the mask.

- **Inputs:** `mask` (e.g. SAM3_TrackToMask), `thickness` (how far in from the edge it reaches full height, as a share
  of the short side), `profile` (`dome`, `pillow`, `cone`, `flat`), `edge` (depth at the outline), `near` (depth at
  the thickest point), `smooth`, `temporal` (carries some of the last frame's depth; steadier, but fast moves trail);
  optional `relief` (e.g. Depth Anything 3), `relief_amount`, `relief_far_is_white`
- **Outputs:** `depth`, `mask`
- **Workflows:** [32](../../workflows/32_stereo_hidden_in_noise.json)

### Valis Depth Shape

`ValisDepthShape` · `Valis/Stereo`

A spinning solid as depth and mask: `cube`, `torus`, `octahedron`, `heart`, `star` or `blob`.

- **Inputs:** `shape`, `frames`, `width`, `height`, `size` (share of the short side), `spin_x`, `spin_y`, `spin_z`
  (turns over the clip), `tilt_x` (degrees at frame 0), `edge`, `near`
- **Outputs:** `depth`, `mask`
- **Workflows:** [32](../../workflows/32_stereo_hidden_in_noise.json)

### Valis Depth Place

`ValisDepthPlace` · `Valis/Stereo`

Puts one depth into another: where, how big, how near, a straight move across the clip and the frame it enters on. The
nearest depth wins. Chain one per thing; without a `scene` it starts from a field (flat, a tilted floor or slow waves).

- **Inputs:** `depth`, `x`, `y`, `scale`, `x_end`, `y_end`, `scale_end` (where it ends up; -9 and 0 keep it put),
  `depth_gain`, `depth_offset`, `start_frame`, `when_shorter` (`loop`, `hold`, `leave`), `field`, `field_depth`,
  `field_amount`, `width` and `height` (the canvas without a scene); optional `mask`, `scene`
- **Outputs:** `depth`, `mask`
- **Workflows:** [32](../../workflows/32_stereo_hidden_in_noise.json)

### Valis Static

`ValisStatic` · `Valis/Stereo`

What the dots are made of, for Valis Stereogram and Valis Kinetogram. Cells are copied whole, so a character is never
cut.

- **Inputs:** `look` (`squares`, `halftone`, `ascii`), `cell` (px across one dot or character), `noise` (`white` is
  even TV snow; `pink` and `brown` clump into soft blobs and are harder to fuse; `blue` and `violet` are fine and even
  and easiest to fuse), `color` (`black & white`, `grey`, `rgb`, `rgb 8`, `tv`, `palette`), `palette` (27 named
  palettes or `custom`), `charset` (9 sets, from `minimal` and `blocks` to `maze` and `katakana`, or `custom`);
  optional `custom_palette`, `custom_characters`, `paper` (behind halftone dots and characters), `cell_height`
- **Outputs:** `static` (`VALIS_STATIC`), `preview`
- **Workflows:** [32](../../workflows/32_stereo_hidden_in_noise.json)

### Valis Stereo Pattern

`ValisStereoPattern` · `Valis/Stereo`

The dots as frames you can grade, blur or swap for any picture. Stereograms use a strip one period wide from the middle.

- **Inputs:** `kind` (`dots`, `snow`, `color`, `palette`, `glyphs`), `width`, `height`, `frames` (1 holds one
  pattern), `dot_size`, `density`, `palette` (HEX colours; for glyphs the first is the paper), `seed`
- **Outputs:** `pattern`
- **Workflows:** none exported

### Valis Stereogram

`ValisStereogram` · `Valis/Stereo`

Hides a depth in a field of dots as repeat distances. Fresh dots every frame (the default) look like TV snow. Dots are
drawn on their own grid, so the hidden thing never cuts or stretches one and a still frame shows nothing to someone not
fusing. The node records a test: at 1080p with 6 px dots and H.264 capped at 3 Mb/s, the hidden dancers still matched
0.87 in Valis Stereo Decode.

- **Inputs:** `depth`, `period` (repeat distance in px; 0 is the width divided by 9; keep it under your eye spacing on
  the screen it plays on), `strength` (the deepest depth as a share of the period; more is deeper but harder to fuse),
  `viewing` (`parallel` or `cross`), `anchor`, `kind`, `dot_size` (6 at 1080p survives uploads), `refresh_every`
  (1 is TV snow; 0 holds the same dots, and a moving thing then shows as copies across the frame), `drift`,
  `guide_dots`, `seed`, `width`, `height`, `depth_far_is_white`
- **Optional:** `static` (replaces `kind` and `dot_size`), `pattern` (any picture or clip as the dots),
  `frame_offset` (for a long video rendered in pieces: the dots carry on across the cut)
- **Outputs:** `frames`
- **Workflows:** [32](../../workflows/32_stereo_hidden_in_noise.json)

### Valis Kinetogram

`ValisKinetogram` · `Valis/Stereo`

The thing is made of the same dots as the field, and you see it only because its dots move together while the field is
live static. Pause on any frame and it is gone. Chain kinetograms (the last one as the next one's `field`) to give each
thing its own motion.

- **Inputs:** `mask`, `motion` (`flow` moves every dot with the footage's own motion; `follow` slides one rigid texture
  with the mask; `drift only`), `drift_x`, `drift_y` (a thing that stands still is invisible, so give it a slow drift
  such as 1.5), `kind`, `dot_size`, `field_drift_x`, `field_drift_y`, `seed`
- **Optional:** `images` (the clip, for `flow`), `field`, `field_refresh` (1 is live static; 0 a still field),
  `static` (chained kinetograms should share one), `width`, `height`, `dot_life` (frames a dot rides the motion before
  it is reborn, so dots don't bunch into streaks)
- **Outputs:** `frames`
- **Workflows:** [32](../../workflows/32_stereo_hidden_in_noise.json)

### Valis Stereo Decode

`ValisStereoDecode` · `Valis/Stereo`

Reads the hidden depth back out of stereogram frames, which is what a fusing viewer's eyes get. With `codec` on, the
frames go through an H.264 encode at the bitrate you set first, so you see what survives an upload. Connect the depth
you hid to get a score.

- **Inputs:** `frames`, `period` (0 reads it from the frames), `strength`, `viewing`, `window` (about three times the
  dot size), `codec` (`h264` or `none`), `bitrate_mbps` (a hard cap, as a platform's transcode has; default 4), `fps`;
  optional `depth`
- **Outputs:** `decoded_depth`, `frames_after_codec`, `report` (the bitrate made and, with `depth`, the shape match as
  IoU and the depth error)
- **Workflows:** [32](../../workflows/32_stereo_hidden_in_noise.json)

## Stage

Stage is experimental. These nodes split one still into depth layers and write a stage folder under
`ComfyUI/output/valis/stage/<name>/` (`stage.json` with the layers and their depths) that the studio's Stage view plays
with a live camera. The [Extras guide](../guides/extras.md#stage-experimental) covers the studio side.

### Valis Stage (a still, split by words into depth layers)

`ValisStage` · `Valis/stage`

Takes one SAM 3 Detect result per name and a depth render, orders the layers by depth and completes each layer behind
the ones in front of it.

- **Inputs:** `image`, `depth` (Depth Anything 3 `depth`, bright near), `names` (one per line, in the same order as
  `mask_1`, `mask_2` and so on; `the lamps:20` reads as `the lamps`), `stage_name` (a folder that exists gets `_2`,
  `_3`), `far` (how deep the scene is: the farthest pixel sits this many times farther than the nearest; default 6),
  `band` (how far an object is completed behind what covers it, as a share of the width); optional `mask_1` to
  `mask_12` (SAM 3 with individual masks on; the node unions them), `prompt` (kept in `stage.json`)
- **Outputs:** `layers` (a contact sheet), `stage` (the subfolder), then `fill_a`, `fill_a_mask`, `fill_a_prompt`,
  `fill_b`, `fill_b_mask`, `fill_b_prompt` (the two backdrops with the most to paint behind, for an inpainting model and
  Valis Stage Fill)
- **Workflows:** [00](../../workflows/00_stage_split_a_still.json)

A name SAM 3 finds nothing for drops out. Up to 12 names are used.

### Valis Stage Fill (paint behind the layers)

`ValisStageFill` · `Valis/stage`

Puts painted completions back into a stage's backdrop layers: wire the stage and the painted `fill_a` and `fill_b`
images (for example Krea 2 inpainting inside `fill_a_mask` and `fill_b_mask`).

- **Inputs:** `stage`; optional `fill_a`, `fill_b`
- **Outputs:** `stage`
- **Workflows:** none exported

### Valis Stage Surround (the still on a canvas to paint out)

`ValisStageSurround` · `Valis/stage`

The stage's still on a bigger canvas, for an outpainting model to paint the world past its edges. With `pad` 0 the
still sits at half size in the middle of a grey canvas twice as wide and tall, the layout Qwen Image 2.1 with the
outpaint LoRA was trained on. With `pad` above 0 that share of the still is added on each side, filled with the still's
own edge colours blurred, and the `still` and four margins go to Krea 2 AnyPaint Prepare.

- **Inputs:** `stage` (the subfolder under output), `megapixels`; optional `pad` (0 for Qwen, 0.3 for Krea 2 AnyPaint)
- **Outputs:** `canvas`, `still`, `left`, `top`, `right`, `bottom`
- **Workflows:** none exported; the studio's **Paint what the camera uncovers** uses it

### Valis Stage Dome (the painted world past the frame)

`ValisStageDome` · `Valis/stage`

Puts a painted surround into the stage's far dome, so wide moves and the 3D set show the painted world past the frame
edge instead of a blur.

- **Inputs:** `stage`, `painted` (the outpainted canvas)
- **Outputs:** `stage`
- **Workflows:** none exported; used by **Paint what the camera uncovers**

### Valis Stage Clean Plate (the still + what to remove)

`ValisStageCleanPlate` · `Valis/stage`

The stage's still and the instruction to remove the things standing in it (not scenery cut by the frame), for an edit
model. A second instruction removes only the biggest thing.

- **Inputs:** `stage`, `megapixels`
- **Outputs:** `still`, `instruction`, `removed`, `instruction_main`, `removed_main`
- **Workflows:** none exported; used by **Paint what the camera uncovers** on a stage that wasn't made erase first

### Valis Stage Plate (the clean plate behind the layers)

`ValisStagePlate` · `Valis/stage`

Puts a clean plate behind the layers: where a removed thing stood, each layer's guessed completion is replaced by the
plate. At rest nothing changes. The second plate (the biggest thing alone) is made only when the first left that thing
standing.

- **Inputs:** `stage`, `plate`, `removed`; optional `plate_main` (lazy), `removed_main`
- **Outputs:** `stage`
- **Workflows:** none exported; used by **Paint what the camera uncovers**

### Valis Erase Setup (what to erase before splitting)

`ValisEraseSetup` · `Valis/stage`

The first step of an erase-first split. It decides which named things stand in the still (not the sky, not scenery
running out of the frame) and writes the instructions for an edit model: all of them, and the biggest alone.

- **Inputs:** `image`, `names`, `megapixels` (the still is scaled to about this for the edit); optional `mask_1` to
  `mask_12`
- **Outputs:** `still`, `prompt_all`, `prompt_main`, `plan`, `prompt_rest`
- **Workflows:** none exported; the Stage view's **Split it** and **Make the set from words** use it when these
  nodes are loaded

### Valis Erase (the still with the things erased)

`ValisErase` · `Valis/stage`

Builds the erased picture: each thing's place taken from the edit model's plate, checked (the thing must be gone there,
and SAM 3 must not find it again close by), and matched to the still in colour and light. `plate_main` and `plate_rest`
are lazy, so a clean first edit costs one edit and a failed one gets at most one retry.

- **Inputs:** `image`, `plan` (from Erase Setup), `plate_all`, `names`; optional `plate_main`, `plate_rest`,
  `mask_1` to `mask_12` (in the still), `pmask_1` to `pmask_12` (SAM 3 run on `plate_all`)
- **Outputs:** `erased`, `report`, `footprints` (one mask per name: what the edit took away of each thing)
- **Workflows:** none exported; used by **Split it** and **Make the set from words**

### Valis Stage Erased (scenery from the erased picture, things on top)

`ValisStageErased` · `Valis/stage`

Valis Stage, erase first. The scenery is split from the erased picture and the things go back on top as cutouts from
the still, so a move uncovers real paint. Writes the stage folder like Valis Stage, plus `erased.png`.

- **Inputs:** `image`, `depth`, `erased`, `erased_depth`, `report` (from Valis Erase), `names`, `stage_name`, `far`,
  `band`; optional `mask_*` (in the still), `emask_*` (in the erased picture), `footprints`, `bg_model` (a BiRefNet
  matting model, for soft edges where a thing's colours match the background), `prompt`
- **Outputs:** `layers`, `stage`
- **Workflows:** none exported; used by **Split it** and **Make the set from words**

## Utilities

### Valis Color Palette (looks / HEX)

`ValisColorPalette` · `Valis/library`

Grades every frame with a named look or your own colours. Create's shots and the Loop use it for their colour grade.

- **Inputs:** `images`, `look` (39 looks, default `film_colors`, or `custom`), `strength`; optional `hex` (2 to 6
  colours, e.g. `#0b1d2a, #c8553d, #f2d0a4`; with `custom` only these colours, with a named look these colours mapped
  through it with its contrast, glow and grain kept), `grain` (-1 keeps the look's own), `seed`
- **Outputs:** `IMAGE`
- **Workflows:** none exported

### Valis Frame Rate (retime a clip to 24 fps)

`ValisFrameRate` · `Valis/library`

Retimes a clip from its own frame rate to `fps`. Wan 2.2 makes 16 fps clips and phones shoot 30; played as 24 they run
fast and short. Each output frame is the source frame showing at that moment, as ffmpeg's fps filter does. The FX
tab (on the clip and on **Another clip**), Score's **Library** engine and the Film tab add it when it is installed.

- **Inputs:** `images`, `source_fps` (Get Video Components' fps), `fps` (default 24)
- **Outputs:** `IMAGE`
- **Workflows:** [10](../../workflows/10_fx_library_cue_sheet.json), [11](../../workflows/11_fx_new_song_yue2.json),
  [31](../../workflows/31_fx_on_a_loop.json), [35](../../workflows/35_score_shot_with_the_library.json),
  [37](../../workflows/37_fx_light.json)

### Valis Canny (batched: long clips without running out of VRAM)

`ValisCanny` · `Valis/library`

ComfyUI's Canny a few frames at a time, with the same kornia call and thresholds, so the edges are identical. The core
node runs the whole clip on the GPU at once and can run out of memory next to a loaded video model; this one falls back
to the CPU when a batch still doesn't fit. Genjutsu uses it for its Canny edges when it is installed.

- **Inputs:** `image`, `low_threshold`, `high_threshold`, `batch` (default 8)
- **Outputs:** `IMAGE`
- **Workflows:** none exported

### Valis Title Card (a title over black, fading)

`ValisTitleCard` · `Valis/library`

A title and a line under it over black, fading in and out, as frames for CreateVideo. Set in Cormorant Garamond, the
studio's serif. The Film tab's cut ends on one when the node is installed.

- **Inputs:** `title` (set in capitals), `subtitle` (default `a Valis film`), `width`, `height` (default 768 by 1344),
  `seconds` (default 3), `fps`, `fade` (seconds in and out, default 0.8)
- **Outputs:** `IMAGE`
- **Workflows:** none exported
