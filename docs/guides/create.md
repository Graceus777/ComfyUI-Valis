# Create

Create is Valis's Cinema Studio, for directing one shot from a panel. Describe the shot, pick a look, and press
**Frame it**. Krea 2 paints two keyframes. Pick one and press **Shoot it**, and MiniMax H3 turns it into a shot with
its own sound. Every choice on the panel becomes words in a prompt, and every option's tooltip shows the exact words
it adds. Open the tab with **Create** in the top bar, or press **1**.

![Create: shot 1 of THE IRON SAINT opened from its card, with the camera moves and its keyframe](../create.jpg)

## What it needs

| Step | Models and packs |
|---|---|
| **Frame it** | Krea 2 (turbo, its text encoder and VAE) |
| **Shoot it** | MiniMax H3 image-to-video, its text encoder and VAEs, and the ComfyUI-MiniMax-H3-PDD-Acc pack with its 8-step file |
| **Character** | the comfyui-krea2edit pack and the Krea 2 identity-edit LoRA |
| **Relight**, and **end on the subject** for moves that need a new last frame | Qwen Image 2.1 (GGUF, through ComfyUI-GGUF), its text encoder and VAE |
| Trained moves (✦) | the camera LoRA for that move; the crash zoom and arcs also need the Wan 2.2 image-to-video set |
| Dolly zoom | SAM 3 |
| **Upscale** | the ComfyUI-SeedVR2_VideoUpscaler pack (it downloads its own models on first use) |

The files, folders and sources are in [Install](../install.md). **Renders → Setup** checks every graph Create can send
against your ComfyUI and lists what each feature still lacks.

## Make a shot

1. Write **who, what, where** in the first box. This is the still frame.
2. Write **what happens** in the second box. This is what H3 animates.
3. Open the panel sections you care about and pick. Anything you leave on **From genre** is filled by the genre.
4. Press **Frame it**. Two keyframes land in the strip under the viewer; the first is picked.
5. Click the keyframe you want. Hover the colour palettes to see each one graded on it, and relight it if you like.
6. Press **Shoot it**. The shot plays in the viewer and lands in the bin.
7. Under the shot, **Extend →**, **← Lead-in** or **Upscale** it.

Both buttons show how long the job will take on this machine, learned from its own past jobs (a `?` means that kind of
job hasn't run here yet). Hover **Shoot it** to see how it will be shot: the plain H3 shot, a trained move, or Wan 2.2.

## The shot fields

The four fields at the top of the panel, under **The shot**:

| Field | What it does |
|---|---|
| **Who, what, where** | The keyframe. Who is in it, what they look like, where they are. Krea 2 paints from this and your choices below. |
| **What happens** | The motion. H3 animates the keyframe from it. A line in quotes is spoken in the shot, with the voice and lips; the placeholder shows the form (*she looks past the camera and says, "I was the skinny one." She speaks with an American accent.*). |
| **who the camera is about** | Who the camera moves around or follows. Trained moves aim at them, the dolly zoom locks their size, and a character you drop under **Character** replaces them. |
| **what you hear** | What H3 plays under the shot: rain on a tin roof, a crowd far off, a church bell. Left empty, H3 is told the scene and the action as sound. |

Leave **what you hear** empty unless you want something specific. A shot told only "quiet room tone" came out silent
whenever its last frame was pinned (a light change measured -91 dB on three seeds); told the scene as sound, it played
on every seed.

## The panel

Each section folds shut and shows what is chosen in it on its title line, so a closed panel still reads at a glance.
Sections remember whether you left them open.

### Genre

Fifteen genres, as cards: Gothic horror (the default), Film noir, Neon sci-fi, Dark fairy tale, Western, Music video,
Documentary, Epic fantasy, Thriller, Romance, Period drama, Sci-fi epic, Modern horror, Adventure and Anime. A genre is
a starting look in parts: its medium, mood, era, light, camera body, lens and colour. The mood always goes in. Each
other part fills in only where you haven't chosen, so the genre's "shot on 35mm" gives way to the IMAX body you pick,
its moonlight to your firelight, and its colour words to your palette. The genre's first clause also opens the motion
prompt.

### Camera

Words in the keyframe prompt.

- **Framing**: Wide (the default), Medium, Close-up, Extreme close-up, Over the shoulder, Low angle, High angle.
- **Focal length**: Any (no focal length in the prompt), 18mm, 35mm, 50mm, 85mm, 135mm, Macro.
- **Camera body**: what the picture was shot on, which sets the grain, sharpness, colour and the era of the image
  itself. Digital cinema, 35mm film, 16mm film, Super 8, IMAX 65mm, DV camcorder, VHS camcorder, Phone, Action cam,
  Security cam, Silent film.
- **Lens kit**: Clean primes, Anamorphic, Vintage, Macro, Fisheye.

### Camera move

44 moves in five groups (Basic, Dolly, Crane, Orbit, Dynamic). Push in is the default. A move is words in the motion
prompt, phrased the way H3 follows them best, unless it is a trained move.

**trained moves (✦)** is on by default. A move marked ✦ has a
LoRA trained on that one move, which does it properly: a full 360, a real push-in, a crash zoom. The ✦ is dimmed when
the LoRA isn't installed, and the move's tooltip says so; H3 then does the move from words. Turn the box off and H3
does every move from words.

| Move | How it is shot | Needs |
|---|---|---|
| 360 orbit ✦ | The 360 Orbit LoRA on H3: one 209-frame shot (about 8.7 s) whose last frame is pinned to its first, with the arrival hold trimmed. Time is frozen; only the camera moves. | the 360 Orbit LoRA |
| Bullet time ✦ | The same LoRA and the same 209-frame shot. | the 360 Orbit LoRA |
| Push in ✦, Super dolly in ✦ | The camera-motion LoRA on H3: a slow push to a tight close-up on the face of who the camera is about. | the H3 camera-motion LoRA |
| Crane up ✦ | The same LoRA: it rises high above them, tilting down to keep them in the centre. | the H3 camera-motion LoRA |
| FPV drone ✦ | The same LoRA: one fast, low fly-past that ends past them. | the H3 camera-motion LoRA |
| Dolly zoom in ✦ | The same LoRA pushes in from a full shot to a medium shot; Valis Dolly Zoom then locks the subject's size. | the H3 camera-motion LoRA, SAM 3 |
| Dolly zoom out | H3 from words: a small, gentle pull-back; Valis Dolly Zoom then locks the subject's size. | SAM 3 |
| Whip pan | H3 from words: a steady pan to the right; Valis Whip Pan then speed-ramps it into a whip. | nothing extra |
| Crash zoom in ✦ | Wan 2.2 with the CrashZoom LoRA on its high-noise expert. | the CrashZoom LoRA, Wan 2.2 |
| Arc right ✦ | Wan 2.2 with the ArcShot LoRA. | the ArcShot LoRA, Wan 2.2 |
| Arc left ✦ | The ArcShot LoRA only learned left to right, so arc left is arc right run on the mirrored keyframe and mirrored back. | the ArcShot LoRA, Wan 2.2 |

Dolly zoom out and whip pan carry no ✦ because no LoRA is involved, but they use their Valis step only while **trained
moves** is on. The LoRAs, their sources and their licences (the Wan 2.2 move LoRAs are non-commercial) are listed in
[Install](../install.md).

Things to know about trained moves:

- A trained move is prompted the way its LoRA was trained, from your scene, your action and the move's own phrase.
  The genre's opening words, **Emotion** and **Tempo** are not used.
- 360 orbit and bullet time freeze one instant, so **What happens** and **what you hear** are not used; the sound is
  the place's own.
- A full 360 needs a figure standing clear in open space. With the subject leaning over a table, the shot arcs a
  quarter turn and then fades in a second copy of them to fake the rest. A room with a couch fails the same way.
- Wan 2.2 shots are silent and run at 16 fps. Its move LoRAs were trained near 720p. The [FX](fx.md) tab retimes
  16 fps clips to 24 before it adds effects.

#### Dolly zoom and whip pan, built from footage

Asked in words for a vertigo shot, H3 makes a plain push-in; asked for a whip pan, it dissolves between two views.
Valis builds both from a move H3 does shoot well, with a Valis step after it. Both steps are described in
[ComfyUI nodes](../reference/nodes.md#camera-moves).

**Dolly zoom.** H3 shoots a real push-in (dolly zoom in) or pull-back (dolly zoom out), with true parallax. SAM 3
tracks who the camera is about through it (leave the field empty and it looks for "person"). Valis Dolly Zoom then
re-frames every frame so the subject keeps one size and one place while the background's perspective keeps changing.
A push-in gives the classic vertigo (the world stretches away behind them); a pull-back gives the reverse (it looms
forward). It only crops, so it never has to invent an edge. The frame where the subject is largest is shown whole, and
the others are cropped in, at most 1.6 times (the tightest frame shows 62% of the picture), with a little sharpening to
give back what the crop softened. If the move changes the subject's size by more than that, the lock is partial and the
subject still grows or shrinks a little.

**Whip pan.** H3 shoots a steady pan, at least 5 s long. Valis Whip Pan measures the camera's own motion in it, then
speed-ramps it: it lingers on the start, swings out at many times real speed, whips straight back and lands on the
start, where the subject is. Each fast frame is exposed over the stretch of the move it covers, with motion blur taken
from the camera's measured motion. Only the clip's own pixels are used. The whip is shorter than the shot it was made
from (about 1.5 to 3 s from a 4.5 s pan), and how far it swings depends on how far the pan travelled.

If either Valis node isn't loaded yet, Create shoots the plain move and tells you to restart ComfyUI.

#### Ending on the subject

**end on the subject** is for moves done from words that would leave
the subject behind. It pins the shot's last frame:

- 360 orbit, whip pan and turntable end on their own first frame.
- Crane over the head, top-down, crane up, helicopter, FPV drone, arc left and arc right end on a frame made first by a
  Qwen Image 2.1 edit of the keyframe, seen from where the camera should finish (saved as `…_end`).

Other moves have no pinned end. A trained move ignores this box, and so does the whip pan while **trained moves** is
on, since the whip already lands back on the subject.

**trim the hold** is on by default. H3 tends to reach a pinned frame
early and hold it still, for up to 1.4 s. Valis Trim Hold keeps a quarter second of the hold (6 frames) and cuts the
rest, and never cuts the shot below 49 frames.

Done from words, 360 orbit, earth zoom out and hyperlapse need 8 s and bullet time 6 s; Create lengthens the shot to
that and tells you.

### Light

- **Light source**: From genre, Moonlight, Candlelight, Golden hour, Neon, Overcast, Backlit, Firelight, Lightning.
- **Lighting setup**: None, Silhouette, Practicals, Window, Overhead fall, Contre-jour, Soft cross.

Both are words in the keyframe prompt. **Relight a keyframe** and **light change** work on a finished keyframe; see
[Relight and light change](#relight-and-light-change).

### Era & colour

**Era** sets when the shot is: From genre, 1920s, 1940s, 1950s, 1960s, 1970s, 1980s, 1990s, 2000s, 2010s, Today. Each
era pairs with a colour look (the 1920s with Sepia, the 1940s with Noir, the 1980s with VHS, and so on). Pick an era
and a line under it offers that look with one click.

**Colour palette** holds 39 looks. **Natural** sits at the top with **From genre**, and the other 38 are in six rows
that fold open: Film stock, Black & white, Blockbuster, Light & weather, Mood, and Video & print. Each look shows its
colours inline.

- **From genre**: the genre's colour words go in the prompt and the shot isn't graded.
- **Natural**: no colour words and no grade; the model's own colour.
- Any other look: its words go in the keyframe prompt.

Hover a look to see it graded on the keyframe in the viewer, and in the picker's own preview. Before there is a
keyframe, the picker previews it on a reference picture. The preview is the same grade the shot gets, run in the
browser.

The chosen look's colours appear as five swatches, darkest on the left to lightest on the right: the shot's shadows to
its highlights take these colours. Click a swatch to change that colour. Your colours are mapped through the look, so
its contrast, grain and glow stay. **reset** goes back to the look's own colours. **custom** drops the look and keeps
only colours, starting from the ones shown (or three of its own when none are), for you to change. Krea 2 reads colour
names, so your colours go into the prompt as the nearest named colours ("a colour palette of navy, rust and cream").

**grade the shot in this palette too** is on by default. The finished shot is graded in the chosen look by Valis Color
Palette, on the CPU, in seconds. Off, only the keyframe's prompt carries the look.

A black-and-white look (Noir, Silver mono, Sepia, Daguerreotype) leads the keyframe prompt and drops the genre's
coloured light. Krea 2 follows colour words that come earlier over a "black-and-white" at the end.

### Performance

Words in the motion prompt.

- **Emotion**: Neutral (the default, adds nothing), Joy, Sadness, Fear, Anger, Awe, Tension, Love, Mystery.
- **Tempo**: Single shot (the default: "One continuous take, no cuts."), Calm, Measured, Energetic, Chaotic.

### Format

- **Aspect**: 9:16, 16:9 or 1:1. Keyframes are made at 768×1344, 1344×768 or 1024×1024.
- **Resolution (shot)**: the shot's short side, 320 to 1024 px in steps of 32. Keyframes are always made at full size.
  Lower renders much faster (time grows faster than the pixel count). H3 was trained around 768 (**native**); above
  that it is untested and needs more memory. For 1080p, render at 768 and use **Upscale**. The first time the studio
  opens on a machine it sets this to the safe size for the GPU; **Renders → Detect hardware** sets it again.
- **Length**: 2 to 15 s. H3 renders in steps of 17 frames (plus 5) at 24 fps, so the length snaps to the nearest one
  it can make, and the readout shows seconds and frames. The default is 107 frames (4.46 s), one standard H3 clip.
  H3 was trained on 5.2 to 15 s: shorter is fine for tests and quick beats, though fast moves can feel rushed.
- **Seeds**: **keyframes** (the second keyframe uses this plus 101) and **shot**. The same seed with the same settings
  gives the same picture. The dice rolls a new one.

### Character

Drop a character sheet or a face, or drag a still from the bin. After **Frame it**, each keyframe is cast with it: a
Krea 2 identity edit turns the person named in **who the camera is about** into the character, keeping their pose,
position, everyone else, the framing, the room and the light. The cast stills join the strip as **with character**
(about 80 s each). A character dropped after framing goes into the next keyframes, so press **Frame it** again.

## Frame it

**Frame it** makes two Krea 2 keyframes (10 steps) at the aspect's full size, from the keyframe prompt the panel
builds. It needs the **who, what, where** field. Click a keyframe in the strip to pick it.

To start from your own still, drop it on the viewer (or click the viewer to browse). It joins the strip as **your
still** and is picked. A still in the bin can come in with **Create · first frame**, or by dragging it onto the viewer.
The shot is cut from the centre of the picture at the aspect you chose, so set **Aspect** to match the still.

## Shoot it

**Shoot it** turns the picked keyframe into a shot. The plain shot is MiniMax H3 image-to-video at 8 steps (PDD
acceleration), about 7 minutes for 4.5 s on a 12 GB laptop. H3 makes the sound in the same pass as the picture:
voices, the room, the fire. Then the post steps that apply run in this order: the hold trim, the dolly zoom lock, the
whip ramp, and the colour grade.

The button's sub-label shows the engine (H3 or Wan 2.2), the size, the length and the time. Anything Create had to
change is shown as a note when you press it: a move whose LoRA isn't installed, a move that needs more seconds, a
light change with no relit keyframe.

## Relight and light change

**Relight a keyframe** gives the picked keyframe new light with a Qwen Image 2.1 edit: the same picture, the same
people, new light. Pick one of ten setups (Contre-jour, Lantern / practical only, Overhead fall, Golden hour, Window,
Firelight, Moonlight, Neon, Noir blinds, Lightning) and press **Relight**. The relit still joins the strip as **relit ·
…** and the bin. Then either:

- pick the relit still and **Shoot it** in the new light, or
- keep the original picked, tick **light change**,
  and **Shoot it**. H3 runs from the keyframe to its relit version, so the light shifts during the shot.

A light change pins the last frame to the relit still, which replaces any **end on the subject** pin. It uses the most
recent relight, and only if that relight was made from the keyframe you have picked; otherwise Create shoots without
it and says so. 360 orbit, bullet time and the Wan 2.2 moves don't take a light change.

## Under a result

Under every shot sits a finish bar, with a text field for what happens next (or, for a lead-in, what happens before).

- **Extend →** (+5 s after): a new H3 shot that starts from the clip's last 17 frames, so the motion carries across
  the join. Picture and sound are joined onto the clip. With the field empty, H3 is told "the action continues
  naturally". About 2.5 minutes for 5 s.
- **← Lead-in** (+5 s before): the same, leading into the clip's first 17 frames.
- **Upscale** (SeedVR2 · 1080p): SeedVR2 3B with a tiled VAE and CPU offload, so it fits a 12 GB card. Keeps the
  sound. About 7 minutes for 5 s.

Each result plays in the viewer, gets its own finish bar, and joins the strip, so you can extend an extension or
upscale it.

## Prompts

**Prompts**, under the strip, shows what the panel builds as you change it: the **KEYFRAME** prompt for Krea 2, the
**MOTION** prompt for H3 and the **SOUND** H3 is told. Krea 2 weighs the start of a prompt most, so the keyframe prompt
leads with what you chose (the camera body and lens kit, then the era), then the genre's medium and mood, then the
framing and your subject, and the light and colour last. A black-and-white look leads everything.

The motion prompt is the genre's opening words, "The scene begins exactly as shown in the first frame and comes
alive:", your action and emotion, the move, and the tempo. A trained H3 move sends its own prompt instead (see
[Camera move](#camera-move)), so for those the **MOTION** text here is not what H3 receives.

## Working on a Film shot

On a Film shot card, **Create ↗** opens that shot here. The shot's words fill the fields (its still description with
the cast's looks and the place, its motion, its subject), its keyframe is picked, and the film's genre is selected. A
bar at the top reads **Working on *title*, shot *N***:

- **Use the picked still**: the keyframe picked here becomes the film's still for this shot.
- **Use the last shot**: the last clip made in Create becomes the film's shot.
- **done** closes the bar.

Both buttons take you back to Film. Any still or clip in the bin can also go to a shot with **Film · shot N**. The
[Film guide](film.md) covers the rest of the film.

## Loops

Loops live under **Extras → Loop**, not in Create. Drop a still there, or pick **Extras · loop it** on a keyframe in
the bin, and MiniMax H3 Loop makes a shot that plays forever. See [Extras](extras.md#loop).

## Limits and tips

- Run **Free memory** (Renders) between big jobs on a 12 to 16 GB card. H3 image-to-video and H3 ref2va don't fit
  side by side.
- Draft at 384 px (**draft** on the resolution slider) to try moves and looks fast, then shoot at **native**.
- The genre fills every slot you leave on **From genre**. If a choice seems ignored, check **Prompts**: an earlier
  word may be winning.
- Done from words, crane up, FPV drone and the arcs leave the subject behind. Tick **end on the subject** to finish on
  them. The trained FPV drone also ends past them.
- A 360 orbit needs open space around one standing figure.
- Each move and option has a tooltip with the words it adds. The camera move's tooltip also says whether its LoRA is
  installed here.

## Where results land

Everything goes to `ComfyUI/output/valis/` and into the bin: keyframes as `key_…`, cast stills as `cast_…`, shots as
`shot_…` (a pinned end frame made by Qwen as `shot_…_end`), relit stills as `relight_…`, extensions as `extend_…` (the
new part alone as `extend_…_part`), and upscales as `upscale_…`.

## Workflows and the CLI

The graphs Create sends, in ComfyUI API format:

| Workflow | What it is |
|---|---|
| [`01_keyframes_krea2.json`](../../workflows/01_keyframes_krea2.json) | Frame it |
| [`02_cast_character_krea2.json`](../../workflows/02_cast_character_krea2.json) | cast a character into a keyframe |
| [`03_shot_h3_i2v.json`](../../workflows/03_shot_h3_i2v.json) | Shoot it, 4.5 s |
| [`17_cinema_trained_orbit_h3.json`](../../workflows/17_cinema_trained_orbit_h3.json) | 360 orbit, trained |
| [`18_cinema_trained_crash_zoom_wan.json`](../../workflows/18_cinema_trained_crash_zoom_wan.json) | crash zoom on Wan 2.2 |
| [`19_cinema_dolly_zoom.json`](../../workflows/19_cinema_dolly_zoom.json) | dolly zoom |
| [`22_cinema_whip_pan.json`](../../workflows/22_cinema_whip_pan.json) | whip pan |
| [`24_cinema_relight_keyframe.json`](../../workflows/24_cinema_relight_keyframe.json) | Relight |
| [`25_cinema_light_change.json`](../../workflows/25_cinema_light_change.json) | light change |
| [`20_cinema_extend.json`](../../workflows/20_cinema_extend.json) | Extend |
| [`21_finish_upscale.json`](../../workflows/21_finish_upscale.json) | Upscale |

The CLI frames, casts and shoots with a shorter set of choices than the panel:

```sh
node cli/valis.mjs frame --prompt "a lighthouse keeper on a rocky shore at night, holding a lantern" --genre gothic
node cli/valis.mjs cast --keyframe key.png --character sheet.png
node cli/valis.mjs shoot --image key.png --motion "he raises the lantern and turns to the sea" --move push
```

`frame` takes `--genre`, `--framing`, `--lens`, `--light` and `--grade` (`none`, `teal`, `bleach`, `mono`, `techni`,
`faded`, `steel`). `shoot` takes `--move` from `static`, `push`, `pull`, `orbit`, `crane`, `track`, `hand` and
`dolly`, all done from words, and `--seconds`. For trained moves, the dolly zoom, the whip pan or a relight, run the
workflow and point its keyframe loader at your still: node `fa` in 17, 18, 19, 22 and 25, node `img` in 24.

```sh
node cli/valis.mjs run workflows/19_cinema_dolly_zoom.json --set fa.image=key.png
```

[The command line](../cli.md) has every command and option.
