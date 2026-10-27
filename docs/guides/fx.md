# FX

The FX tab puts the Valis effects library on a clip you already have. You stack effects as layers. Each layer listens
to one lane of cues (a kick, a note of a song, a line in a cue sheet), and each effect brings its own synthesized
sound on the same frame. The effects and their sounds run on the CPU with no model, at about a minute per 4 seconds
of video on the laptop in the README's [timings table](../../README.md#timings-on-an-rtx-4080-laptop-12-gb-vram-32-gb-ram).
Two optional parts load a model, SAM 3 when you name a **Subject** and YuE2 for **New song**.

![The FX tab: the 24 effects, light first, with two stacked as layers on a clip and fired by a cue sheet](../fx.jpg)

Every effect and preset is described in [Effects](../reference/effects.md). Every lane, and the full cue-sheet
grammar, is in [Lanes and cue sheets](../reference/cues.md).

## What it needs

- A clip. Anything ComfyUI's Load Video reads.
- Nothing else for the effects, a cue sheet, a song you drop, a score from the Score tab, the effect sounds or the beds.
- **Subject** needs the SAM 3.1 checkpoint and the MaskVidExperiments node pack.
- **New song** needs the YuE2 checkpoint. An instrumental (the default when the lyrics are empty) also needs the
  YuE2 instrumental LoRA and the Plenio Music Production System pack.

Files and packs are listed in [Install](../install.md). The **setup** pill in the top bar checks three FX features
against your ComfyUI: *FX · library stack*, *FX · write a song (YuE2)* and *FX · write an instrumental (YuE2)*.

## A first render

1. Open **FX** (key **4**).
2. Drop a video on **Clip**, or pick one from the bin in the list under it.
3. Leave **On cue from** on **Cues**. The box holds an example cue sheet: 4.4 seconds at 108 BPM with beats, hats,
   three kicks, one downbeat and a rising `loud` curve.
4. Click the **Flicker** card, then the **Lightning** card. Each click adds a layer under **Layers**.
5. Press **Render**.

The candle light breathes and gutters on each of the 8 beats, and at 2.2 s a strike lights the room from the left
with a thunder roll under it. The result plays in the viewer, goes into the bin, and is saved as
`ComfyUI/output/valis/fx_<id>_00001_.mp4`.

## Clip

Four ways to set it:

- Drop a video on the box (or click it to browse).
- Pick from the list under it, **…or pick a clip from the bin**, which holds the 60 most recent clips in the bin.
- Drag a clip from the bin onto the box, or click it in the bin and choose **FX**.
- In **Extras** → **Loop**, **Add effects that loop** opens the loop here with the loop box already ticked.

The whole clip is rendered, every frame, at its own size.

**Frame rate.** Every effect, cue, sound and cut in Valis counts in 24 frames a second. A clip at another rate is
retimed to 24 first by *Valis Frame Rate*. Each new frame shows the source frame at that moment, as ffmpeg's fps
filter does, so a 16 fps Wan 2.2 camera move keeps its length and a 30 fps phone clip drops frames. Played as 24
without it, Wan's 16 fps moves came out 1.5 times too fast and a third short. The studio adds the step whenever
ComfyUI has the node loaded. Only the main clip is retimed, so give **Another clip** at 24 fps.

## Another clip

Optional. The list holds the same clips from the bin; there is no drop zone. Five effects show it: Time slip (the
other era), Era cut, Tear (the scene behind the seam), Double exposure (the scene inside the silhouette) and Split
time. It is scaled to cover the frame (centre-cropped), starts with the clip, and holds its last frame if it is
shorter.

A layer that needs it reads **needs other** until you pick one. Without it, Time slip, Era cut, Split time and Double
exposure stop the render with an error, and Tear opens onto black.

## Subject

Optional. Name one thing in the clip, such as `the man`, `her face` or `the car`. SAM 3 tracks one object through
every frame, and the mask is cleaned up before the effects use it.

- Rim light, Vertigo, Gravity lens, Echo and Double exposure need it. Their layers read **needs subject** while the
  box is empty. Without it, Rim light and Echo leave the picture as it is and Gravity lens sits in the middle of the
  frame.
- Shockwave starts its rings from the subject's centre when there is one, and from the frame's centre otherwise.

The track runs whenever the box has words in it, whether a layer uses it or not. It takes about 35 s with SAM 3
loaded and about 2.5 minutes cold, so clear the box when no layer needs it.

## On cue from

Four sources. Each one gives a set of lanes, and each layer names the lane it listens to. Only the chosen source is
used. The cue sheet, for example, is read only while **Cues** is on.

| Button | Lanes | Sound under the picture |
|---|---|---|
| **Cues** | whatever the cue sheet names | the clip's own sound |
| **Music** | kick, snare, hat, onset, beat, downbeat; curves loud, bright, low, mid, high | the song |
| **New song** | the sheet music's lanes (melody, bass, chord, bar, section...) plus everything **Music** gives | the song YuE2 played |
| **Score** | the score's lanes and curves | the score's song, or the clip's own sound if it has none |

### Cues

A cue sheet you write. No music is needed. The box starts with this example:

```
# a soundless cue sheet: seconds or bar:beat, one cue per line
bpm 108 4/4
every 1 beat from 1:1 to 3:1 beat
every 1/2 beat from 1:1 to 3:1 hat
2:1   downbeat
1:3   kick
2:1   kick 1.2
2:3   kick
ramp loud 0 0 4.4 1
```

It holds every lane the library listens to by default (`beat`, `downbeat`, `kick`, `hat` and the `loud` curve), so
any effect you add fires on it. A cue sheet has `bpm` lines, cues at seconds or bar:beat with a lane name and an
optional strength, `every` grids, `ramp` curves and `#` comments. The grammar and worked examples are in
[The cue sheet](../reference/cues.md#the-cue-sheet).

### Music

Drop a song on the box. You can also drag a song from the bin, or a clip from the bin for its sound. Valis hears its
kicks, snares, hats and onsets, tracks the beat and guesses the downbeats, and draws curves of how loud and how bright
it is and how much low, mid and high there is. The song replaces the clip's own sound. **Render** asks for it first
("Drop the music first").

The downbeat guess assumes four beats to a bar, so a waltz's `downbeat` lane falls in the wrong places. For a waltz,
make a score in **Score** with the meter set to 3/4 and use its `bar` lane through **Score**.

### New song

YuE2 writes a song's sheet music (ABC notation) from your brief, then performs it. Valis lines the sheet up with the
audio and every note it wrote becomes a hit: `melody`, `note`, `bass`, `lead`, `chord`, `bar`, `section` and more.
The song's audio is also heard as in **Music**, so `kick`, `hat`, `downbeat` and the curves are there too.

- **style**: the brief (genre, instruments, mood, tempo), as in the placeholder `southern gothic, slow slide guitar,
  54 BPM…`. Empty, it is `instrumental, cinematic`.
- **lyrics**: `[verse]` and `[chorus]` sections, or `[Instrumental]`. Empty, it is `[Instrumental]`. An instrumental
  loads the YuE2 instrumental LoRA and uses the Plenio pack's Score Tools to move the sheet music's vocal line to an
  instrument, since YuE2 sings its vocal line even when told the song is instrumental.
- **seconds**: the song's length, 4 to 240 (20 to start).

The seed is fixed at 1843, so change the style or the lyrics for a different song. A 20 to 40 second song takes
about 45 s on the README's laptop, and **Render**'s label reads *YuE2 + Valis*. The whole song is saved beside the
render (`fx_<id>_song_...`) with its sheet music as text; the clip carries only its first clip-length.

### Score

This source uses the score open in the **Score** tab, with its lanes, its curves, and its song if the Score tab has
the song as a file (a score made from a song or by YuE2). Make or open a score there, then click **Score** here. The FX tab takes the score
that is open at that moment, so click **Score** again after you change it. With no score open, **Render** says
"Make or open a score in the Score tab first: FX fires on its lanes".

A score without a song file (the bundled DANSE MACABRE example, or a `.json` opened on its own) leaves the clip its
own sound.

**Music**, **New song** and **Score** all line the clip up with the start of the song (0 s). To place a clip later in
a song, lay it on a shot in the **Score** tab, which renders each shot at its own place.

## Layers

### The library

The right side of the tab holds the library, 24 cards in four groups, **Light** first, then **Camera & lens**,
**Time** and **Break & blend**. Each card loops a preview. Hover a card for what it does, the lane it listens to, what
it needs and its presets.

- Click a card to add a layer with the effect's first preset.
- Click a preset chip on a card (**Candle**, **Strip light**, **Lighthouse**, **Whiteout**...) to add that preset.
- A card in use is marked.

The same effect can be added more than once.

### A layer

Each row under **Layers** is one effect, numbered 01, 02... in the order you added them:

- The effect's name, and a list of its presets when it has more than one. Pick another preset there to change it.
- **needs subject** or **needs other** when the layer is missing one.
- The lane box. It starts on the effect's own lane (or its preset's) and you can type any lane. It suggests the
  lanes the source usually gives, but it does not check them. A lane the source lacks fires nothing. Write several
  lanes with commas (`kick, snare`) to fire on any of them.
- **×** removes the layer.

Most lane boxes take a hit lane, and each hit fires the effect. Vertigo, Slit-scan and Tear take a held amount
instead, starting on `loud`. A held amount is a curve (`loud`, `bright`, `low`, `mid`, `high`, or a cue sheet's
`ramp`) or a hit lane, whose hits then rise and fall as an envelope. A curve's name in a hit box fires nothing.
Hover the box to see which kind it takes.

A preset's own lane is set when you add the preset from its card: **Strip light** and **Failing bulb** come in on
`downbeat`. Switching to one in a layer's preset list keeps the lane the layer already had.

### Order

Layers run from the top down. Each effect works on the picture the layers above it made, so a Projector at the bottom
turns the whole stack into projected film, and Frost at the bottom frosts the glass over everything. There is no
drag to reorder. To move a layer to the bottom, remove it and add it again.

## Loop and sound

This section is folded under **Loop and sound**. Its summary reads *loops* or *no loop*, then *sound on* or
*no sound*.

### The clip is a loop

Tick **the clip is a loop** for a clip that already loops, such as one made in **Extras** → **Loop**. The effects
then loop with it:

- The cues of the first loop-length repeat every loop, and a hit near the end still rings into the start.
- Held curves wrap round.
- The whole stack plays once round before frame 0, so trails, echoes, the datamosh smear and frost arrive at frame 0
  as they would the second time round.
- What still differs between the two passes (frost that only grows, a drift) is faded into the next pass over the
  last 12 frames.

A loop is saved as an MP4 and a GIF up to 480 px wide. It keeps the clip's own sound and nothing else: no effect
sounds, no beds and no song, whatever is set below.

### Each effect's own sound

**every effect makes its own sound** is ticked to start. Each layer then adds its synthesized sound on its own lane
(a thunder roll for Lightning, a boom for Punch, a far-off sung vowel for Echo, a codec stutter for Datamosh). The
[effects reference](../reference/effects.md) lists each one.

- Sounds land on the strongest hits of the lane. The same sound plays at most 2 to 6 times in a render, 1 to 8 beats
  apart, depending on the sound (thunder at most twice, 8 beats apart). A longer clip gets no more of them.
- Each hit is synthesized fresh, set a fixed number of dB under the music at that moment, and the whole effects bus
  is held at least 6 LU under the music. All of them share one hall reverb.
- The tuned sounds (the swell, boom, shimmer, ghost, frost and lens sounds, and the tape note in the slip sound) are
  in the key of YuE2's sheet music with **New song**. With any other source they are in D minor.
- Glow, Heat haze, Rim light, Vertigo and Slit-scan make no sound. Tear makes none in this tab, since its sound
  follows a hit lane and the tab gives it a held amount. Projector makes none either, since its sound follows a
  `burn` lane that the tab does not set.

### Beds

Six chips under the checkbox: **rain**, **wind**, **sea**, **fire**, **room**, **neon**. Click to switch each on or
off; **room** starts on. A bed runs under everything for the whole clip, fading in and out over a second, about 25 dB
under the music's average loudness (or the clip's own sound). Beds play only while **every effect makes its own
sound** is ticked.

### The clip's own sound or a song

| Source | Sound ticked | Sound unticked |
|---|---|---|
| **Cues**, or a **Score** with no song | the clip's own sound at its own level, effect sounds and beds under it | the clip's own sound as it is |
| **Music**, **New song**, a **Score** with a song | the song, levelled to −18 LUFS, with effect sounds and beds under it; the clip's own sound is dropped | the song alone, cut to the clip's length |
| the clip is a loop | the clip's own sound | the clip's own sound |

Under a song, the song dips by up to 3 dB where the effect sounds are loudest, and the finished mix is brought to
−16 LUFS with a peak limiter. The clip's own sound is never levelled; it is only limited. A silent clip gets the
effect sounds and beds on their own.

## Render

**Render** is enabled once there is a clip. Its label shows an estimate learned from this machine's past FX jobs.
It refuses to start without a clip ("Pick a clip first"), without a layer ("Add at least one effect from the
library"), on **Music** without a song, or on **Score** without a score.

The job's progress shows in the viewer. **Renders** has the queue and **Stop**. When it finishes:

- The clip plays in the viewer, with its sound.
- It goes into the bin, labelled with the layers (for example *FX · Flicker · Candle + Lightning · Strike*).
- It is saved as `ComfyUI/output/valis/fx_<id>_00001_.mp4`, where `<id>` is a short time stamp. A loop adds
  `fx_<id>_00001_.gif`. **New song** adds the song and its sheet music.

Time is about a minute per 4 seconds of video on the README's laptop, plus the SAM 3 track when there is a subject
and the song when YuE2 writes one. A cue sheet that can't be read stops the job with a message such as
`bar:beat cues need a bpm line`.

## Limits and tips

- In a 120 BPM song `beat` fires every 0.5 s, so Light shafts and Glow on `beat` pulse twice a second. Put them on
  `downbeat` for a calmer frame.
- Some effects are on all the time and hits push them further: Glow, Heat haze, Firelight, Projector, Double
  exposure and Split time. Flicker's candle and fireplace breathe between hits, and Era cut stays on the clip it last
  cut to. The rest show around their hits, or (Vertigo, Slit-scan, Tear) as the held amount rises.
- Vertigo frames the whole shot tighter by its biggest push (up to 1.28 times on a curve that reaches 1), so the push
  only ever shows real pixels.
- Break & blend effects are strong, graphic moments. The library's own advice is one or two in a film.
- Name the cue sheet's lanes after the lanes your layers listen to, or type the sheet's names into the lane boxes.
  Lane names are case-sensitive.
- A cue's strength scales its hit, so `2:1 kick 1.2` hits harder than a plain `2:1 kick`.

## Workflows and the CLI

The studio's FX graphs are exported in [`workflows/`](../../workflows/README.md):

| File | What it shows |
|---|---|
| [`10_fx_library_cue_sheet.json`](../../workflows/10_fx_library_cue_sheet.json) | A cue sheet; Double exposure on `beat` (SAM 3 on "the woman", another clip), a Time slip burn on `downbeat`, Projector on `beat`, each with its sound and the room bed |
| [`11_fx_new_song_yue2.json`](../../workflows/11_fx_new_song_yue2.json) | YuE2 writes and plays a 20 s instrumental; Punch on `kick`, Echo on `melody` (SAM 3 on "the dancer") |
| [`31_fx_on_a_loop.json`](../../workflows/31_fx_on_a_loop.json) | A loop: Shockwave, Punch, Glitch and Projector looping with it, MP4 and GIF |
| [`35_score_shot_with_the_library.json`](../../workflows/35_score_shot_with_the_library.json) | One shot of a score from 8.9 s on: Punch on `kick`, Shockwave on `downbeat`, mixed with the song's own slice |
| [`37_fx_light.json`](../../workflows/37_fx_light.json) | Lightning from the left on `downbeat` and a candle Flicker on `beat` |

The exported files have no Valis Frame Rate step, so give them 24 fps clips. In 10 and 37 the clip's own sound is not
mixed in.

There is no `fx` command in the CLI. Run a workflow file with your own files instead:

```sh
node cli/valis.mjs run workflows/37_fx_light.json --set 16.file=my_clip.mp4
node cli/valis.mjs run workflows/10_fx_library_cue_sheet.json --set 16.file=clip.mp4 --set 40.file=other.mp4 --set "30.text=the dancer"
```

In ComfyUI the same chain is *Valis Cues* → one *Valis Layer* per effect, chained by `stack` → *Valis Render* →
*Valis Sound Design*. [Effects](../reference/effects.md) gives each effect's node name and settings, and
[Lanes and cue sheets](../reference/cues.md) gives the inputs of *Valis Cues*.
