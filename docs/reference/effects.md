# Effects

The Valis library has 24 effects in four groups, in the order the FX tab shows them: **Light**, **Camera & lens**,
**Time** and **Break & blend**. Each effect is a layer. It takes the picture so far and returns the next one, and it
listens to a lane of cues: hits fire it, or a held amount (a curve, or a lane's envelope) sets how much of it there
is. Lanes are described in [Lanes and cue sheets](cues.md); the tab itself in the [FX guide](../guides/fx.md).

For each effect below:

- **Lane** is the lane a new layer listens to in the FX tab. *Held* means the lane box takes a held amount.
- **Needs** is a subject mask (SAM 3, from the tab's **Subject**) or another clip (**Another clip**).
- **Key** names an effect or a preset in a layer, a Score rule or a Film shot: `Effect` alone is the first preset,
  `Effect:preset` another one (`Lightning:storm`). The effect part is also the `effect` value of a *Valis Layer* node.
- **Settings** are the effect's own parameters, for the `params` JSON of a *Valis Layer* node, with their defaults.
  A preset is a set of these.
- **Sound** is what the effect adds when **every effect makes its own sound** is ticked. [Sounds](#sounds) has
  how often each one plays.

## At a glance

| Effect | Key | Lane | Needs | Presets | Sound |
|---|---|---|---|---|---|
| Flicker | `Flicker` | `beat` (`downbeat` for two presets) | | Candle, Fireplace, Strip light, Failing bulb | candle, buzz, hum |
| Firelight | `Firelight` | `beat` | | From below, Torch at the side, Blaze | crackle |
| Lightning | `Lightning` | `downbeat` | | Strike, From above, Distant, Storm | thunder |
| Light sweep | `Sweep` | `downbeat` | | Headlights, Lighthouse | whoosh |
| Glow | `Glow` | `beat` | | Halation, Dream, Neon | none |
| Light shafts | `Rays` | `beat` | | Sun shafts, Moonbeams, Candle glow | shimmer |
| Glint | `Glint` | `downbeat` | | Star, Lens flash, Sparkle | shimmer |
| Rim light | `Rim` | `beat` | subject | Back light, Cold edge, Warm edge | none |
| Heat haze | `Haze` | `beat` | | Above the fire, Off the ground, Everywhere | none |
| Punch | `Punch` | `kick` | | Kick, Flash | boom |
| Shockwave | `Shockwave` | `downbeat` | | Ripple, Blast | swell, boom |
| Vertigo | `Vertigo` | held, `loud` | subject | | none |
| Gravity lens | `Lens` | `kick` | subject | | lens |
| Projector | `Projector` | `beat` | | Light touch, Old reel | none in the FX tab |
| Echo | `Echo` | `beat` | subject | | ghost |
| Slit-scan | `SlitScan` | held, `loud` | | | none |
| Time slip | `TimeSlip` | `beat` | other | | slip |
| Datamosh | `Datamosh` | `kick` | | | stutter |
| Era cut | `Eras` | `beat` | other | | slip |
| Frost | `Frost` | `downbeat` | | Breath on glass, Creeping, Whiteout | frost |
| Glitch | `Glitch` | `hat` | | Tape slip, Hard | tick |
| Tear | `Tear` | held, `loud` | other | | none in the FX tab |
| Double exposure | `DoubleExposure` | `beat` | subject, other | | whoosh |
| Split time | `Split` | `downbeat` | other | | slip |

Without its subject, Rim light and Echo leave the picture as it is and Gravity lens sits in the middle of the frame.
Without another clip, Time slip, Era cut, Split time and Double exposure stop the render with an error, and Tear opens
onto black.

## How the light effects differ

The light effects make the change look like the scene's own light. Five of them relight the plate: Flicker,
Firelight, Lightning, Light sweep and Rim light. The picture is multiplied by a light map, so its texture and colours
stay the plate's. Light reaching a dark corner also lifts the surfaces there in proportion to what is there, so walls
and faces appear when a flash or a beam reaches them. Light past white rolls off the way film does. When light dips
(a candle guttering, a bulb browning out) blue goes first, so the room goes dimmer and warmer.

The light comes from a motivated place: the brightest thing in the frame, followed as it moves (Flicker), a side of
the frame (Firelight, Lightning), a beam crossing the frame (Light sweep), or the side of the subject that faces the
light (Rim light). When *Valis Render* has a depth map on its `depth` input, Firelight, Lightning and Light sweep give
near things more light than far ones. The FX tab sends no depth, so everything is lit alike.

The other four work from the light the plate already has. Glow blooms and halates the highlights, Light shafts
streams the bright parts away from the brightest spot, and Glint puts a star on the brightest small point. Heat haze
bends the air above hot, bright things. Except for Light shafts, the light effects size themselves to the frame, so
they look the same at any resolution.

Sides, for the `at` setting of Firelight, Lightning and Rim light: `left`, `right`, `top` (or `above`), `bottom` (or
`below`), `top-left`, `top-right`, `bottom-left`, `bottom-right`.

## Light

Light that reads as the scene's own.

### Flicker

The scene's own light breathes like a practical, such as a candle, a fire, a strip light or a failing bulb. The light
comes from
the brightest thing in the frame, followed as it moves, and falls off over half the frame's diagonal; 45% of it is the
whole room breathing with it. Candle and Fireplace breathe all the time and hits make them gutter or flare. Strip
light and Failing bulb hold steady and break on the hits.

**Lane** `beat` · **Needs** nothing · **Sound** a soft pop and flutter (`candle`, at 60%); Strip light a mains buzz
with the same stutter (`buzz`); Failing bulb a low hum that sags (`hum`)

| Preset | Key | What it does |
|---|---|---|
| Candle | `Flicker` | Warm and irregular; a hit makes it gutter and flare back |
| Fireplace | `Flicker:fire` | Warmer and faster, flaring on the hits |
| Strip light | `Flicker:tube` | A fluorescent tube that stutters off and on, once a bar. Lane `downbeat` |
| Failing bulb | `Flicker:bulb` | A steady hum that browns out, once a bar. Lane `downbeat` |

**Settings** `style` (`candle`, `fire`, `tube`, `bulb`), `at` `"bright"` (or a mask name, or `[x, y]` as fractions of
the frame or pixels), `amount` 1.0, `radius` 0.5, `ambient` 0.45, `tint` (the style's), `tau` 0.3

### Firelight

Warm firelight from off-screen licks up the scene from one side and flares on the hits. It is never quite still: its
edge moves from frame to frame, and it is lit between hits too.

**Lane** `beat` · **Needs** nothing · **Sound** sparse crackles over a soft roar (`crackle`, at 70%)

| Preset | Key | What it does |
|---|---|---|
| From below | `Firelight` | A hearth below the frame |
| Torch at the side | `Firelight:torch` | From the left, reaching 0.6 of the way across, flickering 1.4 times faster |
| Blaze | `Firelight:blaze` | The whole frame in the glow of something burning (full reach, brighter, bigger flares) |

**Settings** `at` `"below"` (a side), `amount` 0.7, `reach` 0.75, `flare` 0.7, `base` 1.0, `speed` 1.0, `tint`
(warm orange), `tau` 0.45

### Lightning

A strike off-screen lights the room from one side with three stuttering flashes in the first 0.3 s and a short
afterglow. It whitens and cools what it lights and lifts the shadows. No bolt is drawn.

**Lane** `downbeat` · **Needs** nothing · **Sound** a far crack rolling into thunder (`thunder`)

| Preset | Key | What it does |
|---|---|---|
| Strike | `Lightning` | From the left |
| From above | `Lightning:above` | From the top |
| Distant | `Lightning:distant` | Far off, a softer flicker of light: from the right, at 45%, two flashes |
| Storm | `Lightning:storm` | Every fourth hit, counted over the whole song, so a storm keeps its pace across a film's cuts. The thunder keeps the same pace |

**Settings** `at` `"left"` (a side), `strength` 1.0, `strikes` 3 (up to 4), `life` 0.9, `fill` 1.0, `wash` 0.3,
`reach` 1.0, `every` 1, `tint` (cold white)

### Light sweep

A beam crosses the scene on each hit and takes 1.6 s to cross, like headlights through a window or a lighthouse's
beam.

**Lane** `downbeat` · **Needs** nothing · **Sound** air passing, panned across (`whoosh`, at 50%, at most 4 per
render)

| Preset | Key | What it does |
|---|---|---|
| Headlights | `Sweep` | A warm beam about a third of the frame wide, tilted 10°, left to right |
| Lighthouse | `Sweep:lighthouse` | Narrower (0.18), faster (1.0 s), brighter and cold white |

**Settings** `width` 0.32, `dur` 1.6, `angle` -10, `direction` 1 (-1 for right to left), `strength` 0.9, `fill` 0.8,
`soft` 0.6, `tint` (warm), `once` false (true: only the lane's first hit)

### Glow

Bright things bloom and halate like film around a light, with a warm red fringe. Some glow is always there; each hit
adds more and it falls away over about 0.6 s.

**Lane** `beat` · **Needs** nothing · **Sound** none

| Preset | Key | What it does |
|---|---|---|
| Halation | `Glow` | Soft bloom with a red fringe |
| Dream | `Glow:dream` | Wider and from lower highlights, more of it all the time, less fringe |
| Neon | `Glow:neon` | A cold glow with no red fringe, stronger on the hits |

**Settings** `base` 0.35, `amount` 0.8, `threshold` 0.62, `radius` 0.025, `halation` 0.5, `tint` (warm), `tau` 0.6

### Light shafts

On each hit, light streams out of the brightest thing in the frame (followed as it moves) in radial shafts, with a
soft bloom and a cold horizontal streak.

**Lane** `beat` · **Needs** nothing · **Sound** a high, quiet chord in the key that blooms and hangs (`shimmer`)

| Preset | Key | What it does |
|---|---|---|
| Sun shafts | `Rays` | Warm shafts with a cold streak |
| Moonbeams | `Rays:moon` | Cold, at 70%, a faint streak |
| Candle glow | `Rays:candle` | Amber, at 60%, shorter shafts, no streak |

**Settings** `at` `"bright"` (or a mask name), `strength` 1.0, `threshold` 0.6, `samples` 26, `decay` 0.7, `streak`
0.6, `base` 0, `tint` (warm), `tau` 0.5

### Glint

A star glint flashes on the brightest small point in the frame (a blade, an eye, a jewel) on each hit, a hot core with
thin rays that flare and die within 0.4 s. It looks for a small hot point, so a lamp or the sky doesn't take it,
and it keeps clear of the frame's edges.

**Lane** `downbeat` · **Needs** nothing · **Sound** the shimmer chord (`shimmer`, at 60%)

| Preset | Key | What it does |
|---|---|---|
| Star | `Glint` | Four lines through the core, tilted 18° |
| Lens flash | `Glint:flash` | A larger cross, its horizontal arm the longer |
| Sparkle | `Glint:sparkle` | Small and quick (0.25 s) |

**Settings** `at` `"bright"` (or a mask name, for the brightest point inside it, or `[x, y]`), `size` 0.09, `rays`
4 (lines through the core), `angle` 18, `life` 0.4, `strength` 1.0, `tint`

### Rim light

On each hit the subject's edge catches a back light, a thin bright line along the side of its mask that faces the
light (the brightest thing in the frame, unless you name a side), with a soft glow around it.

**Lane** `beat` · **Needs** subject · **Sound** none

| Preset | Key | What it does |
|---|---|---|
| Back light | `Rim` | Near-white, slightly cool |
| Cold edge | `Rim:cold` | Blue |
| Warm edge | `Rim:warm` | Amber |

**Settings** `at` `"bright"` (or a side), `strength` 1.4, `width` 0.008, `base` 0, `tint`, `tau` 0.45, `mask`
`"subject"`

### Heat haze

The air shimmers and rises above the hot, bright things in the frame (warm or bright areas, their heat carried up the
frame). It is always on; hits add more.

**Lane** `beat` · **Needs** nothing · **Sound** none

| Preset | Key | What it does |
|---|---|---|
| Above the fire | `Haze` | Above the hot things |
| Off the ground | `Haze:road` | Across the lower frame, like heat off a road |
| Everywhere | `Haze:air` | The whole frame, gentler, with less of it between hits |

**Settings** `at` `"hot"` (`"bottom"`, `"all"`), `base` 0.7, `amount` 0.6, `strength` 1.0, `scale` 0.03, `rise` 0.35,
`tau` 0.6

## Camera & lens

The camera reacts with a kick, a ripple, a dolly zoom, a lens bending space or a film projector.

### Punch

A zoom kick and a colour split on the hits, gone in about a tenth of a second.

**Lane** `kick` · **Needs** nothing · **Sound** a deep, round hit on the key's tonic (`boom`, at 70%)

| Preset | Key | What it does |
|---|---|---|
| Kick | `Punch` | A 2% zoom kick and a 2 px colour split, no flash |
| Flash | `Punch:flash` | With a white flash, a 2.5% kick and a 3 px split. Loud |

**Settings** `zoom` 0.025, `split` 3, `flash` 0.25, `tau` 0.12

### Shockwave

A ring of bent space races out on each hit, from the subject's centre when there is a subject and from the frame's
centre otherwise. The picture refracts across its front with a colour fringe, a bright edge rides it, and it settles
over 1.6 s. A stronger hit makes a stronger ring.

**Lane** `downbeat` · **Needs** nothing (uses the subject if there is one) · **Sound** a reverse-reverb swell of a
chord in the key rising into the hit (`swell`, at 80%), and a `boom`

| Preset | Key | What it does |
|---|---|---|
| Ripple | `Shockwave` | Half the strength, a narrower front, little glow or fringe |
| Blast | `Shockwave:blast` | The full ring with a bright front and a colour fringe |

**Settings** `at` (a mask name; none for the frame's centre; the FX tab sets `"subject"`), `strength` 18, `width` 30,
`speed` 1250, `life` 1.6, `glow` 0.5, `chroma` 0.35, `tint`. Sizes are pixels at 768 px wide and scale with the frame.

### Vertigo

A dolly zoom from the subject mask. The subject holds its size and place while the world behind it is pushed away as
the held amount rises. It only ever shows real pixels. The whole shot is framed tighter by its biggest push (up to
1.28 times on a curve that reaches 1), and the push hands that margin back to the background. The ground the subject
hides is painted in, and a fast change in the push adds a rush blur.

**Lane** held, `loud` · **Needs** subject · **Sound** none · no presets

**Settings** `amount` 0.28, `tau` 1.2, `blur_rush` 6, `reflection` false (true keeps a reflection on a wet floor
attached to the subject), `edge` 1.2

### Gravity lens

Space bends around the head end of the subject as round an invisible mass, by the real lens equation. The picture
wraps into an Einstein ring, a dark core opens at the centre, and each colour bends a little differently. Its
strength follows the lane's hits and fades between them. With no subject it sits in the middle of the frame.

**Lane** `kick` · **Needs** subject · **Sound** a low tone on the tonic sinking an octave, with air drawn past
(`lens`) · no presets

**Settings** `strength` 1.0, `radius` 0.16 (of the frame's short side), `core` 0.22, `chroma` 0.04, `ring` 0.8,
`head` true (false: the mask's centre), `tau` 0.5

### Projector

On every frame the picture becomes projected film, with exposure flicker, gate weave, vertical scratches and dust.
Hits on its lane make the flicker jump.

**Lane** `beat` · **Needs** nothing · **Sound** none in the FX tab. Its sound (the `slip` film-gate sound) follows a
`burn` lane, which only a *Valis Layer* node sets.

| Preset | Key | What it does |
|---|---|---|
| Light touch | `Projector` | Flicker 0.05, weave 0.8, fewer scratches (0.3) and less dust (0.25) |
| Old reel | `Projector:reel` | The full wear: flicker 0.08, weave 1.5, scratches 0.6, dust 0.5 |

**Settings** `flicker` 0.08, `weave` 1.5, `scratches` 0.6, `dust` 0.5, `amount` 1.0, `burn` (a lane whose hits burn a
hot spot into the film)

## Time

The picture's time comes apart in afterimages, slit-scan, another era and frames that never arrive.

### Echo

On each hit the subject's silhouette and its light are lifted off and left behind. Each afterimage drifts up and to
one side (alternating), grows by about a fifth, takes a cold tint and fades over 1.4 s, the newest brightest. Up to
six at a time.

**Lane** `beat` · **Needs** subject · **Sound** a breathy, far-off sung vowel on a note of the key (`ghost`) · no
presets

**Settings** `life` 1.4, `keep` 6, `grow` 0.22, `rise` -0.06, `side` 0.03, `glow` 0.8, `gain` 1.5, `tint` (cold),
`trail` 0 (frames of a short continuous smear behind the subject)

### Slit-scan

Time smears down the frame. Each row shows a moment in the past, the lower the row the older, up to 19 frames (0.8 s)
back when the held amount is full.

**Lane** held, `loud` · **Needs** nothing · **Sound** none · no presets

**Settings** `map` (`"y"` in the FX tab; `"x"`, `"radial"`, `"mask"` (only the mask lags), or `"depth"` (the far
lags), which needs a depth input), `frames` 20, `amount` 1.0, `invert` false, `mask`, `tau` 0.6. The render keeps the
last 24 frames, so `frames` above 24 adds nothing.

### Time slip

Another era breaks through on the music. In the FX tab each hit cuts to the other clip for 2 frames, graded as a
daguerreotype (silver and sepia, soft edges, halation, a heavy vignette), with a projector-light flash.

**Lane** `beat` · **Needs** other · **Sound** a film gate catching, a reel flapping, a faint tape-slowed note of the key
(`slip`) · no presets

**Settings**

- `mode`: `"flicker"` (the cut above), `"bleed"` (a held amount fades the other era in, its brightest parts first),
  or `"burn"` (each hit burns a hole that opens, then heals over `life`, its rim glowing)
- `era`: `"daguerreotype"`, `"film"` (1920s warm grey), `"sepia"` (a 1920s print), `"technicolor"` (1950s
  saturated colour, a warm bloom), `"vhs"` (1980s teal shadows and magenta highlights, smeared), `"none"`
- `hold` 2, `gain` 1.0, `flash` 0.6, `life` 1.4, `region` (a mask name to keep the slip inside it)

### Datamosh

The next frame never arrives. On each hit the picture you had is dragged along the clip's real motion (its optical
flow, pushed 1.6 times), and 24 px blocks of the true frame leak back as the hit decays, over about 2.4 s.

**Lane** `kick` · **Needs** nothing · **Sound** a codec catching, one grain of air repeated, each fainter and lower
(`stutter`) · no presets

**Settings** `tau` 0.6, `push` 1.6, `block` 24

### Era cut

Cuts from the clip to the other clip and back on every hit, each cut bleeding the last picture into the new one for
2 frames. Between hits it stays on the clip it last cut to.

**Lane** `beat` · **Needs** other · **Sound** the `slip` sound, at 70% · no presets

**Settings** `clips` `["a", "b"]` (the FX tab's; `"a"` is the clip, `"b"` the other clip), `order` `"cycle"` (or
`"random"`), `bleed` 2, `grades` (an era per clip, as in Time slip). Given a held amount (`by`), it crossfades between
the clips instead.

## Break & blend

Strong, graphic moments. The library's advice is one or two in a film.

### Frost

Frost on the glass in front of the lens. Each hit seeds it at two points on the frame's edges and it grows inward
along branching paths. What it covers goes soft, pale and cold like frosted glass, and the growing front glitters.
The ice catches the light there is, so it shows less in a dark scene.

**Lane** `downbeat` · **Needs** nothing · **Sound** crystalline grains on high notes of the key over a breath of hiss
(`frost`)

| Preset | Key | What it does |
|---|---|---|
| Breath on glass | `Frost` | Grows 0.18 of the frame in from the edges, holds 0.6 s after a hit, thaws over 2.5 s |
| Creeping | `Frost:creep` | It stays and grows with every hit (reach 0.35, no thaw) |
| Whiteout | `Frost:whiteout` | The whole pane frosts over and stays. Loud |

**Settings** `reach` 0.18 (1 = the whole frame), `thaw` 2.5 (0: it stays and each hit adds to it), `opacity` 0.75,
`crystals` 0.35, `sparkle` 0.5, `speed` 0.55, `hold` 0.6, `lift` 0.04, `at` (a mask name: it grows from the mask's
edge)

### Glitch

Bands of the picture slip sideways and the red and blue channels split on the hits, gone in under a tenth of a second.

**Lane** `hat` · **Needs** nothing · **Sound** a short tick (`tick`)

| Preset | Key | What it does |
|---|---|---|
| Tape slip | `Glitch` | 6 bands, small slips (14 px spread), a 3 px split |
| Hard | `Glitch:hard` | 14 bands, wide slips (40 px spread), an 8 px split |

**Settings** `blocks` 14, `shift` 40, `split` 8, `tau` 0.08

### Tear

Reality rips along a jagged seam through the middle of the frame, tilted 8°. The two halves are pushed apart by the
held amount, up to a third of the frame's width when it is full, and in the gap the other clip shows behind a
burning magenta rim with sparks. The seam flutters.

**Lane** held, `loud` · **Needs** other · **Sound** none in the FX tab. Its tearing sound follows a hit lane, which a
*Valis Layer* node can give it as `on`. · no presets

**Settings** `width` 0.35, `angle` 8, `at` (a mask name for the seam to pass through; the middle otherwise),
`flutter` 6, `rim` (the rim colour), `tau` 0.8

### Double exposure

The subject's silhouette becomes a window onto the other clip, built the way the in-camera trick works. Outside the
silhouette is paper. Inside it, the subject's own light is screened over the other scene, which drifts and zooms on
its own slow clock. A trace of screen print sits on top (halftone dots in the midtones, a rough edge, a warm plate
slipped a few pixels, paper grain) with fine film grain. Hits flash the inner scene, swell the window and jog the
warm plate.

**Lane** `beat` · **Needs** subject and other · **Sound** air passing (`whoosh`, at most twice per render) · no
presets

**Settings** `texture` 0.08 (1: the full screen print; 0: a clean double exposure), `grain` 0.03, `outside`
`"paper"` (or `"plate"`, `"dark"`), `invert` false (true: the window is outside the silhouette), `zoom` 1.15, `drift`
`[6, -3]`, `face` 0.75, `sat` 0.55, `amount` 1.0, `tint`, `paper`, `ink`

### Split time

The frame splits down the middle, the clip on the left and the other clip on the right, with a thin glowing seam
between them that flares on each hit.

**Lane** `downbeat` · **Needs** other · **Sound** the `slip` sound, at 80% · no presets

**Settings** `at` `[0.5]` (where the bands meet, across the frame), `angle` 0 (tilts the seams), `clips` `["a", "b"]`,
`hold` 0 (frames the bands swap on a hit), `grades` (an era per band, as in Time slip), `glow` 0.8, `width` 1.5,
`seam` (the seam colour)

## Sounds

Each effect's sound is synthesized fresh for every hit (no samples) and placed on the same lane as the picture. Valis
plays it on the strongest hits, the top half of the lane by strength (any hit for thunder, the top 70% for crackle). The
same sound keeps a minimum number of beats from itself and plays a maximum number of times per render, so a longer
clip gets no more of them. A beat is the cues' tempo (from a song, a sheet or a cue sheet's `bpm`), or 0.5 s when
there is none.

| Sound | Effects | Beats apart, at least | Per render, at most |
|---|---|---|---|
| `candle` | Flicker (Candle, Fireplace) | 2 | 4 |
| `buzz` | Flicker (Strip light) | 2 | 4 |
| `hum` | Flicker (Failing bulb) | 2 | 4 |
| `crackle` | Firelight | 2 | 4 |
| `thunder` | Lightning | 8 | 2 |
| `whoosh` | Light sweep, Double exposure | 2 | 4 (Light sweep), 2 (Double exposure) |
| `shimmer` | Light shafts, Glint | 4 | 2 |
| `boom` | Punch, Shockwave | 4 | 2 |
| `swell` | Shockwave | 4 | 2 |
| `lens` | Gravity lens | 4 | 2 |
| `ghost` | Echo | 4 | 2 |
| `slip` | Time slip, Era cut, Split time | 2 | 3 |
| `stutter` | Datamosh | 2 | 3 |
| `frost` | Frost | 4 | 2 |
| `tick` | Glitch | 1 | 6 |

Every sound is set a fixed number of dB under the music at its moment (thunder 6 dB under, a tick 20 dB under), the
whole effects bus is held at least 6 LU under the music, and all of them share one reverb. Tuned sounds take the key
of YuE2's sheet music when there is one and D minor otherwise. Two effects asking for the same sound within 0.25 s
get one. The [FX guide](../guides/fx.md#loop-and-sound) has how the sounds, beds, the song and the clip's own sound
are mixed.

## In ComfyUI

*Valis Layer (library effect)* holds one effect: `effect` (the key's effect part), `on` (hit lanes, comma
separated), `by` (a held amount) and `params` (the settings as JSON, such as `{"style": "tube"}` for Strip light).
Chain layers through `stack`; *Valis Render (library stack)* runs them top to bottom over the clip, with `other` as
the second clip and `subject` as the mask.

A few defaults differ between the node and the FX tab, which adds the library's own settings to every layer:

- `on` defaults to `kick` in the node. Set the lane you want.
- Shockwave starts from the frame's centre unless `params` has `"at": "subject"`.
- Slit-scan maps by depth unless `params` has `"map": "y"`. Without a depth input, every pixel lags the same amount.
- Era cut cycles through three clips (`a`, `b`, `c`) unless `params` has `"clips": ["a", "b"]`. *Valis Render* has no
  third clip, so set it.

Effects that take a held amount in the node (`by`) as well as hits: Flicker, Firelight, Glow, Light shafts, Rim
light, Heat haze, Vertigo, Gravity lens, Slit-scan, Time slip, Era cut, Tear and Double exposure. The FX tab gives a
held amount only to Vertigo, Slit-scan and Tear.
