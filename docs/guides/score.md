# Score

A score is every hit in a song, lane by lane, with the song cut into sections and shots on whole bars. In the Score tab you make one, map its lanes to effects, lay a clip on each shot, and watch the cut play live on the music before anything renders. Then **Render all** renders every shot that has a clip, with its effects and sound, and **Cut it** joins them on the bars. Press **3** to open the tab.

![The Score tab: a score with one rule (beat to Light shafts) and the live preview on the music](../score.jpg)

## What it needs

Making a score from a song or a cue sheet, or opening a saved one, runs on the CPU with the Valis nodes and needs no model. **YuE2 writes it** needs YuE2, and an instrumental (`[Instrumental]`) also needs the instrumental adapter LoRA and the Plenio pack. Rendering a shot runs the Valis library on the CPU, with SAM 3.1 for effects that follow a subject. Models and packs are in [install](../install.md).

## Make a score

Pick where the score comes from under **The score**.

| Source | What you give it | What happens |
|---|---|---|
| **From a song** | a wav, flac or mp3, or a clip with sound, dropped from disk or dragged from the bin | **Make the score** (Valis · CPU). Valis hears the song and lays out its bars, sections and shots. |
| **YuE2 writes it** | a style ("southern gothic, slow slide guitar, brushed drums, 84 BPM"), lyrics or `[Instrumental]`, and a length of 8 to 120 s (30 by default) | **Write it and make the score** (YuE2 · GPU). YuE2 writes the sheet music and plays it, and the score is made from both in one job. About 45 s for a 20 to 40 s song. |
| **Cue sheet** | your hits, written as text | **Make the score** (Valis · CPU). No music needed. |
| **Open .json** | a Valis score and its song, dropped together or picked with a click | The score opens with its rules and on its engine, if it was saved here. |
| **Example** | nothing | DANSE MACABRE's score: a 3/4 waltz at 161.5 BPM, with its stills standing in for clips until you lay your own on the shots. |

When a score opens, the panel shows its title, meter, tempo, bars, length, and how many lanes, hits and shots it has. The timeline's badge shows the meter, the tempo and the key, when the score has one: the key of YuE2's sheet music, or the key Valis hears in a song.

### BPM and meter

**From a song** has two more controls:

- **BPM (auto)**: your own tempo if the analysis gets it wrong. 0 keeps what Valis hears.
- **meter**: beats per bar. Auto is 4/4, because music analysis assumes it. A waltz needs **3/4**. The other choices are 4/4, 6/8, 5/4 and 7/8, and the score writes the meter as you picked it (6/8, not 6/4).

With your own tempo or meter, the bar lines are laid again as a grid from the first downbeat.

### Cue sheets

The cue sheet box starts with a working example. One cue per line, and `#` starts a comment:

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

| Line | What it does |
|---|---|
| `bpm 96 3/4` | sets the grid, so you can write bar:beat and step in beats or bars |
| `2:1 kick 1.2` | one hit: a time (seconds, or bar:beat), a lane name, an optional strength |
| `every 1/2 beat from 1:1 to 3:1 hat` | a grid of hits, stepping in seconds (`0.25s`), beats or bars. Beats, bars and bar:beat times need a `bpm` line above them; without one the score fails with "needs a bpm line first". |
| `ramp loud 0 0 4.4 1` | a held curve: name, start time, start value, end time, end value |
| `offset 0.5` | moves every bar:beat time by that many seconds |

Lane names are free. A cue sheet has no song: **Play** asks for one, and you can drop a song under **Open .json** to hear it with the score you have open.

## Lanes

A lane is a named list of hits, each a time with a strength. Every rule listens to one lane. The timeline lists the lanes and draws every hit on its row.

| Score from | Lanes |
|---|---|
| a song | **kick** (30 to 160 Hz), **snare** (160 to 2600 Hz), **hat** (5 to 11 kHz), **onset** (any hit), **beat**, **downbeat**, and **bar** (the score's bar lines) |
| YuE2 | the song's lanes, and from its sheet music: **melody**, **ins**, **note** (every note), **bass** (below G3), **lead** (G4 and up), **long** (notes held two beats or more), **chord** (each change), **section**. Its **beat** is the sheet music's own grid and its **downbeat** the sheet's bar starts, in place of the ones heard; the score takes the sheet's tempo, meter and key. |
| a cue sheet | the lanes you wrote, plus **bar**, and **beat** if you didn't write one |

A song also gives held curves (how loud and how bright it is, and the low, mid and high bands). The loudness draws as a wave along the top of the timeline. Rules here fire on hit lanes.

## Sections and shots

Sections are phrases of 8 bars, named by how loud each is against the whole song: intro, verse, build, chorus, drop, breakdown, outro. A song too short for that shape gets a verse, then a chorus if the second phrase is louder. They draw as coloured bands behind the lanes.

Shots are as many whole bars as fit in one MiniMax H3 clip (4.46 s), counting a bar that ends up to 3 frames past it. At 106 BPM in 4/4 that is 2 bars, 4.53 s. A bar longer than a clip is one shot. Shots are named s01, s02 and on, and draw along the bottom of the timeline.

## Effects on the music

Each rule is a lane, an arrow and an effect: every hit on the lane fires the effect. The section's line shows how many rules there are.

### Library and Classic

| Engine | What it is |
|---|---|
| **Library** | The FX tab's effects and presets, in its four groups (**Light**, **Camera & lens**, **Time**, **Break & blend**), except the five that need a second clip (Tear, Time slip, Era cut, Double exposure, Split time). Any lane, any score. |
| **Classic** | ValisFX, the engine DANSE MACABRE was made with: Candles light, Shockwave, Lightning arc, Rim pulse, Ghost crowd, Floor ripple, Reveal (ignite), Flare, Vanish (burn away), Halo, Whiteout, Glint, Camera punch. Most of them listen to one of DANSE MACABRE's own lanes (Candles light to musicbox, Halo to impact), and a rule on another lane drives them from that lane instead. |

A score made here opens on **Library**, and a `.json` saved here opens on the engine it was saved with. **Example**, and any other score that Valis Score (make) didn't write, opens on **Classic** with DANSE MACABRE's map for the lanes it has (musicbox to Candles light, stroke to Shockwave, violin to Lightning arc, kick to Reveal (ignite), impact to Halo, and so on). Switching engines starts its rules again.

A new score made here starts with up to three rules, the first three of these whose lanes it has: beat to Flicker, downbeat to Light shafts, melody to Glow, bar to Light sweep, kick to Punch.

### Start from

Six sets of library rules, by mood. Click one to replace the rules (it switches to **Library**).

| Set | Rules |
|---|---|
| **Candlelit** | beat → Flicker · Candle, melody → Glow · Dream, downbeat → Glint · Star |
| **Storm** | downbeat → Lightning · Storm (every fourth hit, so every fourth bar), bar → Flicker · Failing bulb, section → Light shafts · Moonbeams |
| **Fire** | beat → Firelight · From below, bar → Heat haze · Above the fire, downbeat → Glint · Star |
| **Night drive** | bar → Light sweep · Headlights, beat → Glow · Neon, kick → Punch · Kick |
| **Memory** | bar → Projector · Light touch, melody → Glow · Dream, downbeat → Light shafts · Moonbeams |
| **Impact** | downbeat → Shockwave · Ripple, kick → Punch · Kick, snare → Glitch · Tape slip |

Each set names the lanes it would like. A lane the score doesn't have is replaced by the nearest one it has, in this order: beat, downbeat, kick, bar, melody, onset, snare, hat. No lane is used twice in a set. A score from a song has no melody or section lane, so those rules land on another lane.

### Rules by hand

**+ Add a rule** adds a row (the first lane, to Light shafts; to Flare on **Classic**). In each row:

- the lane select shows every lane with its number of hits
- the effect select shows the effect's description as its tooltip (on **Library**)
- **×** removes the rule

Lanes with a rule are coloured on the timeline in their effect's colour.

### Effect sounds and the subject

**the effects make sounds** is on by default: each effect plays a sound of its own on its hits, synthesized in the song's key and mixed under the music. The key is the score's: the one in YuE2's sheet music, or the one Valis heard in the song when it made the score. With neither (a cue sheet, or a song with no clear key), the sounds are in D minor. Untick it to keep the song alone, as it is, for a score you composed. The sound design evens out each shot's loudness, and a composed score's quiet dawn came out 13 dB louder than it was written. The **Classic** engine makes no effect sounds.

**Subject** has two fields, A ("the woman") and B ("the man"). SAM 3 follows A in every shot for the library effects that follow someone: Rim light, Shockwave, Echo, Gravity lens, Vertigo. Rim light, Echo, Gravity lens and Vertigo need it, and **Render** says so when A is empty. The classic engine takes both.

## Shots

The **Shots** section lists every shot with its bars, its section and its length (s03, bars 5 to 6, verse, 4.5 s). Click a shot's name to jump there.

Give each shot a clip:

- pick it from the shot's select, which lists the 60 newest clips in the bin
- drag a clip from the bin onto the shot
- or press **Fill from the bin**, which fills the shots that have no clip. When the newest clip in the bin is a film's shot (Film · shot 3), that film's shots go first, in shot order, the newest take of each. The shots left over take the newest other clips, in the order they were made.

**Render** renders that one shot; once rendered it reads **again**. The line at the top of the section counts the shots, the shots with clips and the shots rendered.

The effects fire on the lanes from the shot's own place in the song. With **Library**, a shot is rendered at its length in bars: a longer clip is cut at the bar line, and a shorter one holds its last frame until it, so the cut stays on the beat. A clip at another frame rate is retimed to 24 fps first, and the shot carries its slice of the song and the effects' sounds. **Classic** renders the whole clip with its slice of the song under it. With a song, neither engine keeps the clip's own sound: by design, the score's song carries the cut, as in Film. A score with no song (a cue sheet) leaves a shot its own sound on both engines, with the effects' sounds under it on **Library** when **the effects make sounds** is on.

## The live preview and the timeline

Press **▶ Play**. The preview plays the clip of the shot under the playhead in step with the song, with every rule's effect sketched as it fires (a flash and a kick for Punch, a ring for Shockwave, slipping slices for Glitch), and a badge for each rule that fires ("beat → Rays"). A rendered shot plays as it was rendered. A shot with no clip shows the example's still, or asks for a clip. The sketches are quick stand-ins; **Render** makes the real effect.

The timeline under it shows, from top to bottom:

- the sections as coloured bands, with their names
- the song's loudness
- a faint line every 4 bars
- every lane and its hits; a lane with a rule in its effect's colour, its hits flashing as the playhead passes
- the shots: grey with no clip, blue with a clip, green when rendered
- the playhead, in orange

Click anywhere on the timeline to jump there. The readout next to **Play** gives the time, the section, the bar and the shot.

## Render all and Cut it

**Render all** queues every shot that has a clip and isn't rendered yet. Its line shows how many and how long. The library runs on the CPU at about a minute per 4 s of video, so about a minute a shot, plus the SAM 3 track when an effect follows a subject. Each rendered shot goes into the bin as "(title) s01" and so on.

**Cut it** joins the rendered shots in order, each trimmed to its bars. If only some are rendered, it cuts those and says how many. The cut plays in the viewer and goes into the bin as "(title) · cut".

- **End card title (optional)**: the cut ends on a title card over the rest of the song, up to 8 s, with "a Valis film" under the title, instead of stopping mid-bar. It needs a score with a song and more than a second of song after the last rendered shot.
- When the rendered shots are one after another, the song runs unbroken under the whole cut on **Classic**, which makes no effect sounds, and on **Library** with **the effects make sounds** off. Otherwise each shot carries its own slice.

## Make a film on it

**Make a film on it** sends the score's song to the Film tab as **My song**, sets the shot count to the score's shots (up to 12), and opens Film. Write the line and press **Plan it**; the Film tab reads the song's tempo and bars again and cuts its shots on them. It needs the score's song: one you gave the Score tab, one YuE2 wrote, or the Example's. See [Film](film.md).

## Save .json

**Save .json** downloads the score as `(title).valis.json`, with its rules. Open it again here with **Open .json**, dropped together with its song, or load it in any ComfyUI with **Valis Score (load)**.

## FX and the score

The FX tab's **On cue from** has a **Score** choice: its effects fire on the lanes of the score open here, with its song.

## Where things are kept

| Files in `ComfyUI/output/valis/` | What they are |
|---|---|
| `scores/(song name)_*.json` | a score made from a song |
| `scores/yue_*` | a score YuE2 wrote, with its song and sheet music |
| `scores/cues_*.json` | a score made from a cue sheet |
| `score_s01_*.mp4` and on | a rendered shot |
| `score_cut_*.mp4` | a cut |

The score you render with is uploaded to `ComfyUI/input`. Every score made here also goes into the bin.

## Workflows and the CLI

| Workflow | What it does |
|---|---|
| [`33_score_from_a_song.json`](../../workflows/33_score_from_a_song.json) | a score from any song (set `bpm` and `meter` on the make node if the analysis gets them wrong) |
| [`34_score_written_by_yue2.json`](../../workflows/34_score_written_by_yue2.json) | YuE2 writes and plays a song, and the score is made from both |
| [`35_score_shot_with_the_library.json`](../../workflows/35_score_shot_with_the_library.json) | one shot of a score rendered with the library |
| [`09_valis_score_pass.json`](../../workflows/09_valis_score_pass.json) | one shot rendered with the classic engine, with a transformed layer for the reveal and the song's slice under it (inputs: the shot, the transformed shot, the song `valis/danse_v3.mp3` and the score) |
| [`29_film_cut.json`](../../workflows/29_film_cut.json) | shots joined on the bars |

```sh
node cli/valis.mjs run workflows/33_score_from_a_song.json --set a.audio=song.flac --set m.meter=3
node cli/valis.mjs score --clip shot.mp4 --score score.json --bar 52 --layer fx.mp4 --section finale --a "the man"
```

`run` uploads the song and makes the score. `score` renders one shot with the classic engine at the score's bar given by `--bar`, with impact firing Halo, kick firing Reveal (ignite) and stroke firing Shockwave, and `--layer` as the transformed clip the reveal burns in. It keeps the shot's own sound; workflow 09 puts the song's slice under it, as the tab does.

## Limits and tips

- Music analysis assumes 4/4. Set the meter for anything else before you make the score; the shots are laid on the bars it finds.
- The classic engine's reveals (Reveal (ignite), Vanish (burn away), Ghost crowd) bring in a second clip: the transformed shot, or the crowd's own plate. With **Classic** and a rule on one of them, each shot row gets a second select (**— no reveal —** until you pick) for the take the reveal burns in, such as an Edit render of the same shot. A shot left on **— no reveal —** renders without it.
- Time slip, Era cut, Tear, Double exposure and Split time open onto a second clip, which only the FX tab takes, so the **Library** rules don't offer them. A saved score with a rule on one stops at **Render** with a message that names it. Use them in the FX tab.
- The Example's song ships with the pack and is uploaded to ComfyUI the first time a job needs it, so its renders, its cut, the end card and **Make a film on it** all have the song.
- **Fill from the bin** follows the film of the newest clip. To lay an older film's shots when the bin has newer clips, pick each from its select by its label (Film · shot 1, Film · shot 2, ...).
- The live preview is a sketch. Render a shot or two before **Render all**.
