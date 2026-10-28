# The command line

`cli/valis.mjs` runs the studio's graphs from a terminal or from a coding agent. It builds each graph with the same code
the buttons use (`app/js/graphs.js`, `app/js/presets.js`, Create's planner `app/js/create.js` for `frame` and `shoot`,
and `app/js/film.js` for whole films), sends it through the same bundled Comfy SDK, uploads your local files and
downloads the results. It needs Node 18 or later and nothing else.

```sh
cd ComfyUI/custom_nodes/ComfyUI-Valis
node cli/valis.mjs help
```

Run it from the pack's folder or give its full path; it loads the studio's modules from `app/` next to `cli/`. The
models and node packs a command needs are the same as its studio button's, listed in [install.md](install.md).

## Commands at a glance

| Command | What it makes | Studio equivalent |
|---|---|---|
| `film` | a scored, cut short film from one line, or from a plan file | Film |
| `frame` | two Krea 2 keyframes from Create's choices | Create · **Frame it** |
| `cast` | a character put into a keyframe (Krea 2 identity edit) | Create's character drop |
| `shoot` | the shot Create would shoot: MiniMax H3, a trained move, a dolly zoom or a whip pan | Create · **Shoot it** |
| `find` | a SAM 3 matte and an overlay preview | Edit · **Find it** |
| `transform` | a tracked region re-rendered in a new look | Edit · Transform |
| `remove` | a person taken out of a clip | Edit · Remove |
| `swap` | a whole-person character swap | Edit · Swap |
| `turn` | one take turning into another on a word | Edit · Turn |
| `score` | the score-driven Valis pass on one shot | Score, with the **Classic** engine |
| `run` | any API-format workflow, with inputs replaced | any file in `workflows/` |
| `help` | the help text | |

## Connecting

The CLI talks to Comfy API v2. On your own machine that is the ComfyUI running Valis, because the pack mounts Comfy API
v2 on ComfyUI's own server (`sdk_api.py`).

| Option | What it does |
|---|---|
| `--api URL` | the Comfy API v2 base. Default: the `COMFY_BASE_URL` environment variable, else `http://127.0.0.1:8188`. A trailing `/` is dropped. |
| `--key KEY` | an API key, for Comfy Cloud or a Comfy API deployment |

```sh
node cli/valis.mjs frame --prompt "a lighthouse on a rock in a storm" --api http://127.0.0.1:8188
COMFY_BASE_URL=http://127.0.0.1:8188 node cli/valis.mjs find --video clip.mp4 --target "the man"
```

Jobs, progress and results go through the SDK. A few calls go to ComfyUI's own endpoints on the same base:
`/object_info/<node>` (to spell a model path in a subfolder the way the server lists it, `Krea2/...` or `Krea2\...`,
and, for `shoot` and `film`, to see which Valis nodes and camera LoRAs this ComfyUI has), and, for `film` only,
`/view` and `/free`. Where `/object_info` can't be read, paths are sent as written, and `shoot` builds the shot as if
every node and camera LoRA were installed and says so on stderr.

The CLI always renders Edit's ref2va graphs with MiniMax H3 ref2va. The FastH3 switch under
[Renders · Engine](guides/renders.md#engine) is a setting of the studio in your browser and doesn't reach the CLI.

## Files in and out

Any option that takes a file accepts two kinds of path:

- **A file on this disk** is uploaded through the SDK before the job is queued. Each file is uploaded once per run.
- **Anything else** is passed to ComfyUI as written, so `valis/clip.mp4` reads `ComfyUI/input/valis/clip.mp4` on the
  server.

When the job finishes, the CLI downloads the outputs of the graph's Save nodes (SaveVideo, SaveImage, SaveText and so
on) into `--out`, `./valis_out` by default, created if missing. Loader previews are skipped. The server keeps its own
copies under `ComfyUI/output/valis/`, named after the command and a time stamp (`valis/key_<stamp>`,
`valis/shot_<stamp>`, `valis/edit_<stamp>`, `valis/swap_<stamp>`); `run` keeps each Save node's own `filename_prefix`.

| Option | What it does |
|---|---|
| `--out DIR` | where results are written (default `./valis_out`) |
| `--json` | print the graph the command would queue, then stop. Uploaded files appear as `<asset path>`. Local files are still uploaded, because the graph refers to them. Every command but `film` takes it; on `film` it is an error, and `--plan-only` prints the plan instead. |

## What it prints

Progress goes to stderr and the result goes to stdout as JSON, so you can pipe or parse stdout alone.

For every command but `film`, stderr shows the job id and the server, a progress line (`step <n>/<steps> · node <id>`,
or a percentage), each status change, and `done in <n>s`. `shoot` first prints how it will shoot (`Shot`, or
`Shot · Push in (trained)`) and anything it had to change, as Create's notes do. Stdout gets:

```json
{
  "job": "<job id>",
  "seconds": 0,
  "outputs": ["valis_out/<file>"]
}
```

`seconds` is the wall time from queuing to the end, so it includes time spent waiting in the queue. `outputs` lists the
files written to `--out`.

| Exit code | When |
|---|---|
| 0 | the job succeeded, or `help` was shown |
| 1 | the job failed: stderr says `failed after <n>s:` and the failing node's class and message |
| 2 | a bad command line, caught before anything is uploaded or queued: an unknown command (the help follows), a required option missing (`--video is required for transform`), an option the command doesn't take, an option with no value, a stray word, an id a list doesn't have, a number that isn't one or is out of range, a plan file or workflow that can't be read, or a `--set` that isn't `node.input=value` or names a node the workflow doesn't have |

Any other error (the server can't be reached, a film step fails) ends the process with a non-zero exit and Node's error
message.

## Options in general

Options are `--name value`. The switches (`--json`, `--plan-only`, `--slow`, `--anchor`, `--untrained`, `--no-trim`,
`--no-grade`, `--help`) take no value and never take the word after them. Every other option needs a value, so an
option followed by another option, or by nothing, is an error (`--prompt needs a value`). `--help` anywhere shows the
help, as do `help` and running with no command. There is no help per command: `help` prints everything.

Each command checks its whole command line before it uploads or queues anything, and exits with code 2 and a message
that says what it takes:

- An option the command doesn't take lists the ones it does (`frame has no option --genere. Its options: ...`).
- A word that isn't an option's value is refused (`unexpected "a lighthouse" (every option is --name value)`). Only
  `run` takes one, the workflow file.
- Options that pick from a list (`--genre`, `--framing`, `--lens`, `--body`, `--kit`, `--light`, `--setup`, `--era`,
  `--look`, `--aspect`, `--move`, `--emotion`, `--tempo`, `--grade`, and `transform --look`) take the list's id. An id
  the list doesn't have names the ones it has (`--genre gothik: no such id. Pick one of: gothic noir ...`).
- Numbers are checked for kind and range (`--seconds takes a number from 2 to 15, not "4,5"`).

`node cli/valis.mjs help` lists every id of every list.

## film

One line in, a scored and cut short film out, through the same chain as the Film tab (`app/js/film.js`): a plan from
Qwen3, then the song (YuE2), every shot's keyframe (Krea 2), the shots (MiniMax H3), the effects and sound (SAM 3 and
the library, on the song's lanes) and the cut on the bars. A plan built from references (character sheets, sets,
frames) makes those first.

| Option | What it does |
|---|---|
| `--idea "..."` | what the film is about. Needed unless you give `--plan`. |
| `--genre ID` | the genre's look: `gothic`, `noir`, `neon`, `fairytale`, `western`, `music`, `documentary`, `fantasy`, `thriller`, `romance`, `period`, `scifi`, `horror`, `adventure`, `anime`. Default `gothic`, or with `--plan` the plan's own genre. |
| `--shots N` | how many shots, a whole number of at least 1 (default 6) |
| `--plan-only` | write the plan to stdout as JSON and stop. With `--plan`, it prints that plan, with the genre it would be made in. |
| `--plan FILE` | make the film from a plan file: one from `--plan-only`, a plan the studio saved (`ComfyUI/user/default/valis/films/<tag>.json`), or one you wrote. A file that can't be read, isn't JSON or has no shots is an error. `--idea` and `--shots` can't be given with it. |
| `--out DIR` | where the finished film is written |

```sh
node cli/valis.mjs film --idea "a lighthouse keeper rows out into the storm to bring back the woman the sea took" --genre gothic --shots 6
```

To edit the plan before anything is rendered:

```sh
node cli/valis.mjs film --idea "a lighthouse keeper rows out into the storm" --genre gothic --plan-only > plan.json
node cli/valis.mjs film --plan plan.json
```

The plan has a title, a logline, the cast (a name and a one-sentence look each), the place, the song brief, and one
entry per shot: who is in it, `keyframe` (what the still shows), `motion`, `subject` (what SAM 3 tracks), `effect` and
`on` (the lane it fires on). It also keeps its `genre`, and `--plan` makes the film in that genre unless you give
`--genre`, which then replaces it. A plan with no genre is made in `gothic`; a genre the list doesn't have is an
error.

A plan keeps its `tag`, the name its files are saved under. Run the same plan file again after a stop and the steps
already saved under that tag in `ComfyUI/output/valis/` are found and not made again; the cut always runs.

stderr shows each job (`Film · plan: job <id>`, `done in <n>s`), `plan: <title>, <n> shots, <genre>`, and a line per
stage (`song: ...`, `keyframes: ...`, `shots: MiniMax H3 shoots shot 1 of 6`, `effects: ...`, `cut: ...`). Each step
finds its results in the output folder its Save node wrote them to. Only the finished film is downloaded. Stdout gets:

```json
{
  "plan": {},
  "film": "valis_out/<film>.mp4",
  "song": "<the song's file name on the server>",
  "bpm": 0,
  "bars_per_shot": 0,
  "shots": ["<each shot's effects pass, on the server>"]
}
```

`plan` is the full plan with every file it made. `film --json` is an error; use `--plan-only` to see the plan.

## frame

Two Krea 2 keyframes, as Create's **Frame it** makes them: the same keyframe prompt from the same choices (Create's
planner, `app/js/create.js`), at the aspect's full size (768×1344, 1344×768 or 1024×1024). These choices are
Create's panel by id; `shoot` takes them too.

| Option | What it does |
|---|---|
| `--prompt "..."` | what's in the frame, Create's **who, what, where** (needed) |
| `--genre ID` | as for `film` (default `gothic`) |
| `--framing ID` | `wide` (default), `medium`, `close`, `ecu`, `ots`, `low`, `high` |
| `--lens ID` | focal length: `auto` (default, no focal length in the prompt), `18`, `35`, `50`, `85`, `135`, `macro` |
| `--body ID` | camera body: `auto` (default, from the genre), `digital`, `35mm`, `16mm`, `super8`, `imax`, `dv`, `vhs`, `phone`, `action`, `cctv`, `silent` |
| `--kit ID` | lens kit: `auto` (default, from the genre), `spherical`, `anamorphic`, `vintage`, `macro`, `fisheye` |
| `--light ID` | light source: `auto` (default, from the genre), `moon`, `candle`, `golden`, `neon`, `overcast`, `back`, `fire`, `storm` |
| `--setup ID` | lighting setup: `auto` (default, none), `silhouette`, `practicals`, `window`, `overhead`, `contre_jour`, `soft_cross` |
| `--era ID` | `auto` (default, from the genre), `1920s`, `1940s`, `1950s`, `1960s`, `1970s`, `1980s`, `1990s`, `2000s`, `2010s`, `today` |
| `--look ID` | the colour palette: its words go in the keyframe (and `shoot` grades the shot in it). `auto` (default, the genre's colour), `natural`, any of Create's 38 other looks (`teal_orange`, `noir`, `kodachrome`, `daguerreotype`...; `help` lists them all), or `custom` |
| `--colours "..."` | your own colours, two or more as `#rrggbb`, separated by spaces or commas: mapped through `--look`, or alone (the look becomes `custom`). `--look custom` needs them. |
| `--aspect ID` | `9:16` (default), `16:9`, `1:1` |
| `--seed N` | the keyframes' seeds are N and N+101 (default 7101) |

Older ids are still taken, each as the Create choice nearest it: `--grade` is the older name for `--look` (`none` is
`auto`, `teal` is `teal_orange`, `bleach` is `bleach_bypass`, `mono` is `silver_mono`, `techni` is `technicolor`,
`faded` is `faded_70s`, `steel` is `chrome`). Give `--grade` or `--look`, not both.

```sh
node cli/valis.mjs frame --prompt "a lighthouse keeper on a rocky shore at night, holding a lantern" --genre gothic --framing close --lens 85 --light candle
node cli/valis.mjs frame --prompt "a lighthouse keeper on the rocks at night" --body 16mm --era 1970s --look noir --aspect 16:9
```

## cast

Puts a character from a sheet into a keyframe with a Krea 2 identity edit.

| Option | What it does |
|---|---|
| `--keyframe FILE` | the keyframe (needed) |
| `--character FILE` | the character sheet (needed) |
| `--prompt "..."` | the edit instruction. Default: `Put the character from the second image into the first image, same pose, same light.` |

## shoot

Turns a keyframe into the shot Create's **Shoot it** would make from the same choices, through Create's own planner:
MiniMax H3 image-to-video at 8 steps for a move done from words, or a trained move (an H3 camera LoRA, or Wan 2.2 for
the crash zoom and the arcs) when its LoRA is installed, with the dolly zoom lock, the whip-pan ramp, the hold trim and
the colour grade where they apply. The default is 768×1344, 4.46 s, with a locked-off camera. It takes every option of
[`frame`](#frame) (the look grades the shot as well as giving its words), plus these:

| Option | What it does |
|---|---|
| `--image FILE` | the keyframe (needed) |
| `--motion "..."` | what happens in the shot, Create's **What happens** (needed) |
| `--prompt "..."` | what the keyframe shows, Create's **who, what, where**. H3's sound and a trained move's prompt use it. |
| `--move ID` | the camera move, any of Create's 44 (default `static`): `push_in`, `crane_up`, `orbit_360`, `dolly_zoom_in`, `whip_pan`, `crash_zoom_in`...; `help` lists them all |
| `--emotion ID` | `neutral` (default), `joy`, `sadness`, `fear`, `anger`, `awe`, `tension`, `love`, `mystery` |
| `--tempo ID` | `single` (default), `calm`, `measured`, `energetic`, `chaotic` |
| `--seconds N` | the shot's length, 2 to 15 (default 4.46, one H3 clip). A move that needs longer lengthens it, as in Create. |
| `--size N` | the shot's short side in px, 320 to 1024 (default 768) |
| `--who "..."` | who the camera is about (default `the subject`) |
| `--sound "..."` | what H3 hears (default: the scene as it happens) |
| `--relit FILE` | a relit version of the keyframe: the light changes to it during the shot (Create's **light change**) |
| `--anchor` | end on the subject: the last frame is pinned so the move finishes on them |
| `--untrained` | every move from words, with no camera LoRA (Create's **trained moves (✦)** off) |
| `--no-trim` | keep the still end that a pinned last frame leaves (Create's **trim the hold** off) |
| `--no-grade` | the palette's words only: the shot isn't graded |
| `--seed N` | the shot's seed (default 51101) |

The older move ids are still taken, each as the Create move nearest it: `push` (`push_in`), `pull` (`pull_out`),
`orbit` (`orbit_360`), `crane` (`crane_up`), `track` (`dolly_right`), `hand` (`handheld`), `dolly` (`dolly_zoom_in`).

```sh
node cli/valis.mjs shoot --image key.png --motion "he raises the lantern and turns to the sea" --move push_in
node cli/valis.mjs shoot --image key.png --motion "he raises the lantern" --move crane_up --untrained --anchor
```

A relight itself has no command: run [workflow 24](../workflows/24_cinema_relight_keyframe.json) with `run` (its
keyframe loader is node `img`), then give the relit still to `--relit`.

## find

SAM 3 tracks a named thing and saves two videos: the matte (`_matte`) and an overlay preview (`_overlay`).

| Option | What it does |
|---|---|
| `--video FILE` | the clip (needed) |
| `--target "..."` | what to find, as you'd say it: `her dress`, `the man` (needed) |

## transform

SAM 3 tracks the target and MiniMax H3 re-renders only that region in a new look, between new first and last frames
made by Krea 2. Up to 15 s of the clip is used.

| Option | What it does |
|---|---|
| `--video FILE` | the clip (needed) |
| `--target "..."` | what to change (needed) |
| `--look ID` | one of the 57 presets in `presets.js` `LOOKS` (default `fire`), e.g. `bronze`, `chrome`, `vampire`, `ghost`, `ice`, `smoke` |
| `--ref FILE` | a picture of the look |
| `--words "..."` | the look in your own words |

How they combine:

- `--words` (with or without `--ref`) makes your own look from the words; `--look` is ignored.
- `--ref` alone makes your own look from the picture.
- `--ref` with `--look` uses the preset, matched to the picture.
- Neither uses the preset (`fire` if `--look` is left out).

```sh
node cli/valis.mjs transform --video clip.mp4 --target "his head" --look bronze
node cli/valis.mjs transform --video clip.mp4 --target "the man" --ref stag_spirit.png --words "a stag-headed spirit of bark and moss"
```

## remove

Takes a person out of a clip with the H3 Person Remover LoRA. What was behind them fills in, and everything outside the
mask keeps the source's own pixels.

| Option | What it does |
|---|---|
| `--video FILE` | the clip (needed) |
| `--target "..."` | who to remove (needed), e.g. `the man in the mirror` |

## swap

Replaces a whole person with the character on a sheet (H3 ref2va with the character-swap LoRA), keeping the take's
motion and voice. Up to 15 s of the take is used.

| Option | What it does |
|---|---|
| `--video FILE` | the take (needed) |
| `--character FILE` | the character sheet (needed) |
| `--background FILE` | a new place: SAM 3 keys the person onto it first, and the keyed take is saved too (`_plate`) |
| `--person WORD` | who SAM 3 looks for and the prompt replaces (default `person`, read as `the person`) |
| `--prompt "..."` | your own swap prompt instead of the built one |
| `--slow` | 20 steps without the turbo LoRA, instead of the default 8 turbo steps |

```sh
node cli/valis.mjs swap --video take.mp4 --character vampire_sheet.png --background ballroom.png --person man
```

## turn

One take becomes another on a word: the voice is the score, the impact sits on the word, and the reveal burns in from
the eyes (Valis Score from a voice and Valis FX). Both takes should be renders of the same performance, such as two
swaps.

| Option | What it does |
|---|---|
| `--a FILE` | the first take, whose sound is kept (needed) |
| `--b FILE` | the take it turns into (needed) |
| `--at SECONDS` | where the word is, a number of at least 0. Default: the first syllable after the longest pause. |
| `--person WORD` | who SAM 3 tracks (default `person`) |

```sh
node cli/valis.mjs turn --a take_as_the_man.mp4 --b take_as_the_vampire.mp4 --at 3.8
```

The voice turn is not a CLI option; for the face and the voice turning together, run
[workflow 13](../workflows/13_turn_with_voice.json) with `run`.

## score

The score-driven Valis pass (Valis FX) on one shot, keeping the shot's own sound. It listens to the score's own
events: `impact` for the halo, `kick` for the reveal, `stroke` for shockwaves. The Score tab's **Classic** renders
put the song's slice under the shot instead; [workflow 09](../workflows/09_valis_score_pass.json) does the same with
`run`.

| Option | What it does |
|---|---|
| `--clip FILE` | the shot (needed) |
| `--score FILE` | a Valis score `.json` (needed) |
| `--bar N` | the score bar the shot starts on, a whole number from 0 (needed) |
| `--layer FILE` | a second clip to reveal over the shot (an Edit render, say) |
| `--section NAME` | with `--layer`: in a section named `drop`, `finale` or `chorus` the layer burns in on the kicks; in any other it is held on |
| `--a "..."` | subject A for SAM 3 to track |
| `--b "..."` | subject B for SAM 3 to track |

```sh
node cli/valis.mjs score --clip shot.mp4 --score score.json --bar 52 --layer fx.mp4 --section finale --a "the man"
```

The pass's look follows the section the score has at that bar.

## run

Runs any API-format workflow, such as the files in [`workflows/`](../workflows/), with inputs replaced.

```sh
node cli/valis.mjs run workflows/14_genjutsu_motion_transfer.json --set v.file=dance.mp4 --set ref0.image=cast.png
node cli/valis.mjs run workflows/05_transform_vampire.json --set 16.file=clip.mp4
```

`--set node.input=value` can repeat. `node` is the node's id in the file (`16`, `v`, `ref0`); everything after the
first dot is the input name, so dotted input names work. A value that is a number is sent as a number. Any other value
is treated as a file path: a file on this disk is uploaded, and anything else is sent as text, such as a path in
`ComfyUI/input` or a prompt. [The workflows README](../workflows/README.md) lists each file's inputs to replace.

A workflow file that can't be read or isn't JSON, a `--set` that isn't written as `node.input=value`, and a node id the
workflow doesn't have are errors, found before anything is uploaded.

## For agents

The CLI was built to be driven by a coding agent as well as by hand:

- stdout carries only JSON (the job id, the time and the local output paths, or the film summary), so the agent reads
  results without scraping progress lines.
- Exit codes separate a failed job (1) from a bad command line (2). A bad command line is caught before anything is
  uploaded or queued, and its message lists the options or ids that are valid, so the agent can correct the call.
- `--json` shows the graph a command would queue. Save it, edit it and queue it with `run`, replacing each
  `<asset ...>` entry with a `--set`.
- `run` with `--set` reaches every graph the studio sends, exported under `workflows/`, and any graph the agent writes.
- `--api` and `--key` point the same commands at Comfy Cloud or a Comfy API deployment.

A typical loop: build a frame with `frame`, read the two keyframe paths from stdout, pass one to `shoot`, pass the shot
to `transform` or `score`, and check each step's exit code before the next.
