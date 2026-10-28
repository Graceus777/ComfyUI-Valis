# Lanes and cue sheets

Every effect in Valis listens to lanes. A lane is one of two kinds:

- **Hits**: a list of times in seconds, each with a strength (1 unless the source says otherwise). Hits fire effects.
- **Curves**: one value per frame, 24 a second, mostly between 0 and 1. Curves hold an amount.

Lanes come from a song, YuE2's sheet music, a Valis score, a voice or a cue sheet, and they merge, so one set of cues
can hold a song's kicks and a hand-written cue sheet at once. Lane names are free words and case-sensitive. A lane
that no source gave fires nothing, with no error.

The FX tab picks the source under **On cue from** ([FX guide](../guides/fx.md#on-cue-from)). Each effect's default
lane is in [Effects](effects.md).

## Where lanes come from

### A song

From **Music** in the FX tab, a score made from any song in the Score tab, or the `music` input of *Valis Cues*.

| Lane | Kind | What it is |
|---|---|---|
| `kick` | hits | onsets in the low band (30 to 160 Hz), at least 0.11 s apart |
| `snare` | hits | onsets in the mid band (160 to 2,600 Hz), at least 0.09 s apart |
| `hat` | hits | onsets in the high band (5,000 to 11,000 Hz), at least 0.05 s apart |
| `onset` | hits | onsets across the whole spectrum, at least 0.06 s apart |
| `beat` | hits | the beat, tracked through the song |
| `downbeat` | hits | every fourth beat, starting on the beat that carries the most low-band weight |
| `loud` | curve | loudness: 0 at the song's quiet end (its 5th percentile), 1 at its loud end (99th) |
| `bright` | curve | the spectral centroid: 0 at 300 Hz, 1 at 4,300 Hz and above |
| `low`, `mid`, `high` | curves | energy at 30 to 160 Hz, 160 to 2,600 Hz and 2,600 to 11,000 Hz; 1 at each one's 99th percentile, up to 1.2 |

Onsets are found from the change in each band's spectrum, picked against a running median, so a quiet verse still
has hits. `snare` is the whole mid band, so voices and guitars land there too. The tempo comes from the
autocorrelation of the onsets, between 50 and 210 BPM, with a gentle preference for about 110 BPM. *Valis Cues*'
`bpm_hint` moves that preference to your tempo and folds a half-time or double-time reading back toward it.

The downbeat guess assumes four beats to a bar. For a waltz, make a score with the meter set to 3/4 and use its `bar`
lane (see [A Valis score](#a-valis-score)).

Strengths: a `kick`, `snare` or `hat` hit is its size against the lane's 90th-percentile hit (0 to 1.5); `onset` and
`beat` carry the onset strength there (0 to 1); `downbeat` hits are 1.

Valis also hears the song's key: the twelve pitch classes of the song (its chroma, from 55 Hz to 2 kHz) matched against
a major and a minor key profile on every tonic. The best match, such as `G minor`, is the key the tuned effect sounds
use, unless sheet music gives one. A song where no key fits well (a drum loop, noise) has none, and the sounds are in D
minor.

### Sheet music from YuE2

From **New song** in the FX tab, a song YuE2 writes in the Score tab, or the `abc` input of *Valis Cues* (YuE2
Generate ABC's output, or ABC notation you paste). YuE2 plans a song as ABC before it plays it, and Valis reads the
plan.

| Lane | What it is |
|---|---|
| `melody` | the vocal line (a voice whose name contains "voc"), or else the first of several voices without "ins" in its name. In an instrumental with neither, a copy of `ins` |
| `ins` | the voice whose name contains "ins" (YuE2's instrumental line) |
| any other voice | a lane named after the voice, in lower case |
| `note` | every note of every voice |
| `bass` | notes below G3 (MIDI 55) |
| `lead` | notes from G4 (MIDI 67) up |
| `long` | notes held two beats or more |
| `chord` | each change of chord symbol |
| `bar` | each bar line (the downbeats) |
| `beat` | a grid at the written tempo |
| `section` | each `%` section comment (`% verse`, `% chorus`) |

All of these are hits. When the audio is there too (**New song**, Film's YuE2 song, a score YuE2 writes), Valis lines
the sheet up with it. It searches an offset from -0.5 to 3 s and a tempo from 0.75 to 1.25 times the written one,
since YuE2 does not always play at the tempo it wrote, and it drops the notes past the end of the audio. The sheet's
`K:` line gives the key the tuned effect sounds use, over the key heard in the audio.

Strengths: a note's hit is a strength from 0.6 to 1, the higher notes of a lane a little harder (the lane's lowest note
0.6, its highest 1; a lane of one pitch is all 1), so the sound design takes the highest notes as the accents.
Each `chord` change is a hit of 1, and so is every hit of `bar`, `beat`, `long` and `section`.

With the audio there, it is also read as in [A song](#a-song), so `kick`, `hat` and the curves are there as well.
Where the sheet is exact it stands: `beat` is the sheet's own grid alone (the one heard in the audio is dropped, so each
beat fires once), `downbeat` is the sheet's bar starts, and the tempo, meter and key are the sheet's. A 3/4 song is
scored in bars of three.

### A Valis score

From **Score** in the FX tab (the score open in the Score tab), or *Valis Score (load)* into the `score` input of
*Valis Cues*. Every list of times in the score's `events` becomes a hit lane, and every curve in its `envelopes` a
curve. Hits from a score fire at strength 1. The score's `key`, when it has one (its sheet music's, or the one Valis
heard in its song), is the key the tuned effect sounds use.

A score made by *Valis Score (make)* (the Score tab's **From a song**, **YuE2 writes it** and **Cue sheet**) holds
every lane of what it was made from, plus:

- `bar`: the bar lines on the score's own grid. When you set the tempo or the meter, `bar` follows them, while
  `downbeat` stays where the analysis heard it.
- `beat`: a grid on the score's tempo, added when the source had no `beat`.
- `mix`: a curve, a copy of `loud`.

The Score tab's sections (intro, verse, build, chorus, drop, breakdown, outro, named by how loud each run of bars is)
are spans it draws, not a lane. A score made from YuE2's sheet music has the `section` lane from the sheet.

In the FX tab, **Score** adds the DANSE MACABRE example's lane names to the lane box's suggestions: `impact`,
`stroke`, `melody`, `pah`, `violin`, `heartbeat`, `musicbox` and `stab`, with `kick`.

### A voice

The `voice` input of *Valis Cues* gives a `syllable` lane: a hit where the voice's loudness (measured every 10 ms)
rises 6 dB within 40 ms above -42 dB, at least 0.14 s after the last one. The FX tab has no voice source.

*Valis Score (from a voice)*, which Edit's **Turn** uses, makes a score from a voice with `syllable`, `oom` (the same
times), `impact` (the moment of the turn: a time you give, or 70 ms before the first syllable after the longest
pause) and `stab` (the syllables after the impact).

### A cue sheet

From **Cues** in the FX tab, the Score tab's cue-sheet path, or the `cue_sheet` input of *Valis Cues*. Any lane and
curve names you write. The grammar is [below](#the-cue-sheet).

### A looping curve

*Valis Loop · Phase Schedule* makes a curve (named `loop` unless you rename it) that repeats exactly with a loop:
sine, triangle or saw, any number of cycles per loop, between two values you set. Effects follow it as a held amount.

### Merging sources

*Valis Cues* reads its inputs in this order: score, music, sheet music, voice, cue sheet. Hits of lanes with the same
name join into one lane, with one exception: when both music and sheet music are given, the sheet's `beat` replaces the
one heard in the music and its bar starts are the `downbeat`. A curve with the same name as an earlier one replaces it.
The tempo and meter are the sheet music's when it has them, else those of the first source that has one. The key is
the sheet music's when it has one, else the score's, else the one heard in the music.

`offset` moves every hit and curve by that many seconds. The Score tab and Film place a shot in a song this way: a
shot that starts 8.9 s into the song gets offset -8.9, so its own clock starts at 0. The FX tab always uses 0.

| *Valis Cues* input | What it takes |
|---|---|
| `cue_sheet` | a cue sheet |
| `duration` | seconds; 0 takes it from the sources. An `every` line with no `to` runs to it |
| `score` | a Valis score |
| `music` | any audio |
| `abc` | sheet music, aligned to `music` when both are given |
| `voice` | speech, for `syllable` |
| `offset` | seconds to move every cue by |
| `bpm_hint` | a tempo hint for the music analysis (0 for none) |

Its `summary` output lists every lane with its number of hits, then the curves and the tempo. For the FX tab's
example: `beat:8, downbeat:1, hat:16, kick:3 | curves: loud | 108.0 BPM`.

## The cue sheet

A cue sheet is plain text, one cue per line, with no song needed. Blank lines are skipped and `#` starts a comment
anywhere on a line.

| Line | What it does |
|---|---|
| `bpm 108` or `bpm 96 3/4` | sets the tempo, and the beats per bar (4 if left out) |
| `offset 0.5` | puts bar 1, beat 1 at 0.5 s for the bar:beat times after it |
| `<time> <lane> [strength]` | one hit |
| `every <step> [from <time>] [to <time>] <lane> [strength]` | a grid of hits |
| `ramp <curve> <t0> <v0> <t1> <v1>` | a curve going in a straight line from `v0` at `t0` to `v1` at `t1` |

### Times

- Seconds: `4.25` or `4.25s`.
- Bar and beat: `2:1` is bar 2, beat 1. Both count from 1, and the beat can be a fraction (`1:2.5` is halfway between
  beats 2 and 3). The time is offset + ((bar - 1) × beats per bar + (beat - 1)) × 60 / bpm. A bar:beat time needs a
  `bpm` line above it.
- Only the top number of the meter counts: `6/8` is six beats to the bar, each 60/bpm seconds long.

### Single cues

`2:1 kick 1.2` is a hit on `kick` at bar 2, beat 1, with strength 1.2. Leave the strength out for 1. A strength above
1 hits harder: effects that follow the envelope scale with it (Punch, Glitch, Glow...), Shockwave scales its ring, and
the sound design plays its strongest hits.

### Grids

`every 1/2 beat from 1:1 to 3:1 hat` puts a `hat` hit every half beat from bar 1 to bar 3.

- The step is a number or a fraction (`1/2`, `0.25`), in seconds unless a unit follows: `s`, `beat` or `beats`,
  `bar` or `bars`. Beat and bar steps need a `bpm` line.
- `from` and `to` take seconds or bar:beat, in that order. `from` defaults to 0 s. `to` defaults to 8 s after `from`,
  or to *Valis Cues*' `duration` when that is set (the FX tab leaves it at 0).
- The grid starts on `from` and stops before `to`.
- One strength, after the lane, applies to every hit of the grid.

### Ramps

`ramp loud 0 0 4.4 1` draws a curve `loud` from 0 at 0 s to 1 at 4.4 s. The times take seconds or bar:beat; the
values are any numbers. Before a curve's first ramp it is 0. After a ramp ends, the curve holds its last value until
the next ramp of the same name starts, so several ramps chain into one curve. Curves are sampled 24 times a second.

### Length and tempo

A cue sheet lasts until its last hit or ramp end, plus 1 s (or *Valis Cues*' `duration`, when set).

A second `bpm` line sets the tempo for the lines after it, but bar:beat still counts from bar 1 at the new tempo. In
practice a sheet has one tempo; write a tempo change in seconds.

### Errors

A sheet that can't be read stops the job. In the studio the message shows when the render fails.

- `cue sheet: bar:beat times need a bpm line first, e.g. 'bpm 108 4/4'`: a bar:beat time above any `bpm` line.
- `cue sheet: 'every 1 beat' needs a bpm line first, e.g. 'bpm 108 4/4'`: an `every` line stepping in beats or bars
  above any `bpm` line (the message quotes its step).
- `cue sheet: can't read '<the line>'`: an `every` line that doesn't follow the pattern.
- A hit line with a time and no lane also fails, with a less readable message.

## Worked examples

### The FX tab's example

The **Cues** box loads this:

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

At 108 BPM a beat is 0.556 s and a bar 2.222 s, so bar 3 starts at 4.444 s.

| Lane | Hits |
|---|---|
| `beat` | 8, every 0.556 s from 0 to 3.889 s |
| `hat` | 16, every 0.278 s from 0 to 4.167 s |
| `downbeat` | 1, at 2.222 s |
| `kick` | 3, at 1.111 s, 2.222 s (strength 1.2) and 3.333 s |
| `loud` (curve) | 0 at 0 s, rising to 1 at 4.4 s, then 1 |

It lasts 5.4 s. It has every lane the library listens to by default (`beat`, `downbeat`, `kick`, `hat` and the
`loud` curve), so any effect added in the FX tab fires on it: Lightning once at 2.2 s, Glitch on all 16 hats,
Vertigo's push growing as `loud` rises.

### A storm with no song

```
# a storm over the lighthouse, no song
bpm 90 4/4
every 1 bar from 1:1 to 9:1 downbeat
every 1 beat from 1:1 to 9:1 beat
3:1   strike
5:3   strike 0.6
7:1   strike 1.3
ramp wind 0 0.2 8:1 1
```

At 90 BPM a beat is 0.667 s and a bar 2.667 s.

| Lane | Hits |
|---|---|
| `downbeat` | 8, every 2.667 s from 0 to 18.667 s |
| `beat` | 32, every 0.667 s from 0 to 20.667 s |
| `strike` | 3, at 5.333 s, 12.0 s (strength 0.6) and 16.0 s (strength 1.3) |
| `wind` (curve) | 0.2 at 0 s, rising to 1 at 18.667 s (bar 8, beat 1), then 1 |

In the FX tab, add Lightning and type `strike` in its lane box, add Flicker's **Failing bulb** (it comes in on
`downbeat`), and add Slit-scan with `wind` in its box. Lightning flashes on all three strikes; it doesn't use the
strength. Its thunder does: thunder plays at most twice per render, at least 8 beats (5.3 s) apart, on the strongest
hits, so it sounds at 16.0 s and 5.3 s and the 12.0 s strike is silent. The bulb browns out every bar and its hum
plays on the first four. The slit-scan smear grows as the wind rises.

### A waltz in bar:beat

```
bpm 162 3/4
offset 0.4
every 1 bar from 1:1 to 9:1 oom
every 1 bar from 1:2 to 9:1 pah
every 1 bar from 1:3 to 9:1 pah
```

At 162 BPM in 3/4 a bar is 1.111 s, and `offset` puts bar 1 at 0.4 s. `oom` gets 8 hits on beat 1 of each bar (0.4,
1.511, 2.622 ... 8.178 s). `pah` gets 16, on beats 2 and 3 (0.770, 1.141, 1.881, 2.252 ... 8.919 s): two grids with
one lane name join into one lane. Put Punch on `oom` and Glitch on `pah`.

### Seconds only, with a held curve

```
0.0    flash
1.5    impact
4.25s  hit 0.6
every 0.25s from 10 to 12 strobe
ramp opacity 2.0 0.0 6.0 1.0
ramp opacity 8.0 1.0 9.0 0.0
```

No `bpm` line is needed when every time is in seconds. `strobe` gets 8 hits, 10.0 to 11.75 s. The `opacity` curve is
0 until 2 s, rises to 1 at 6 s, holds 1 until 8 s, falls to 0 at 9 s, and stays 0. In the FX tab, type `opacity` into
the lane box of Vertigo, Slit-scan or Tear to follow it. The sheet lasts 12.75 s.

## How effects read hits and curves

Hits reach an effect in one of four ways, depending on the effect:

- **A struck envelope.** Each hit rises in 15 ms and decays with the effect's own time (0.08 s for Glitch, 0.12 s for
  Punch, 0.6 s for Glow). Overlapping hits add up, to at most 1.5, and the hit's strength scales its pulse. Punch,
  Glitch, Glow, Light shafts, Rim light, Heat haze, Firelight, Fireplace, Gravity lens, Projector's flicker, Double
  exposure's flash and Split time's seam follow it.
- **One event per hit.** Lightning strikes, Light sweep sends a beam, Glint flashes a star, Shockwave sends a ring
  (scaled by the hit's strength), Echo sheds an afterimage, Frost starts a new front, Time slip's burn mode opens a
  hole.
- **The time since the last hit.** Datamosh's smear, Time slip's 2-frame cut, the candle's gutter, the strip light's
  stutter and the bulb's brown-out run on it.
- **The count of hits so far.** Era cut picks its clip by it, and Lightning's `every` (the Storm preset) keeps every
  fourth.

A held amount (an effect's `by`, the lane box of Vertigo, Slit-scan and Tear in the FX tab) reads a curve's value at
that frame. Given a hit lane, it reads the lane's struck envelope, so a held effect can follow the kicks. A curve's
name given as a hit lane (`on`) has no hits and fires nothing.

Each effect's sound follows its hit lane, on the strongest hits, with a minimum gap and a maximum count per render
([Sounds](effects.md#sounds)).

## Where lanes are picked

- **FX**: a lane box per layer. It suggests `beat`, `downbeat`, `kick`, `snare`, `hat`, `onset`, `loud`, `bright`
  and `low`, plus the sheet-music lanes after **New song** and the DANSE MACABRE names after **Score**. Type any
  name; commas give several (`kick, snare`).
- **Score**: each rule picks from the open score's own lanes, shown with their number of hits.
- **Film**: each shot's effect fires on one of `kick`, `snare`, `hat`, `beat`, `downbeat`, `bar`, `melody` or
  `bass`. With your own song only the first five are offered, and a shot on `bar`, `melody` or `bass` fires on
  `downbeat`, `beat` or `kick`.
- **ComfyUI**: *Valis Layer*'s `on` (hits, comma separated) and `by` (a held amount).
