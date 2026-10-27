# The command line

`cli/valis.mjs` runs the studio's graphs from a terminal or from a coding agent. It builds each graph with the same code
the buttons use (`app/js/graphs.js`, `app/js/presets.js`, and `app/js/film.js` for whole films), sends it through the
same bundled Comfy SDK, uploads your local files and downloads the results. It needs Node 18 or later and nothing
else.

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
| `frame` | two Krea 2 keyframes | Create · **Frame it** |
| `cast` | a character put into a keyframe (Krea 2 identity edit) | Create's character drop |
| `shoot` | a MiniMax H3 image-to-video shot | Create · **Shoot it** |
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
`/object_info/<node>` (to spell a model path in a subfolder the way the server lists it, `Krea2/...` or `Krea2\...`),
and, for `film` only, `/view` and `/free`. Where `/object_info` can't be read, paths are sent as written.

The CLI always renders Edit's ref2va graphs with MiniMax H3 ref2va. The FastH3 switch under
[Renders · Engine](guides/renders.md#engine) is a setting of the studio in your browser and doesn't reach the CLI.

## Files in and out

Any option that takes a file accepts two kinds of path:

- **A file on this disk** is uploaded through the SDK before the job is queued. Each file is uploaded once per run.
- **Anything else** is passed to ComfyUI as written, so `valis/clip.mp4` reads `ComfyUI/input/valis/clip.mp4` on the
  server.

When the job finishes, the CLI downloads the outputs of the graph's Save nodes (SaveVideo, SaveImage, SaveText and so
on) into `--out`, `./valis_out` by default, created if missing. Loader previews are skipped. The server keeps its own
copies under `ComfyUI/output/valis/`, named after the command and a time stamp (`valis/shot_<stamp>`,
`valis/edit_<stamp>`, `valis/swap_<stamp>`); `run` keeps each Save node's own `filename_prefix`.

| Option | What it does |
|---|---|
| `--out DIR` | where results are written (default `./valis_out`) |
| `--json` | print the graph the command would queue, then stop. Uploaded files appear as `<asset path>`. Local files are still uploaded, because the graph refers to them. Every command but `film` takes it. |

## What it prints

Progress goes to stderr and the result goes to stdout as JSON, so you can pipe or parse stdout alone.

For every command but `film`, stderr shows the job id and the server, a progress line (`step <n>/<steps> · node <id>`,
or a percentage), each status change, and `done in <n>s`. Stdout gets:

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
| 2 | a usage error: a required option is missing (`--video is required for transform`), an unknown command (the help follows), or a `--set` names a node the workflow doesn't have |

Any other error (the server can't be reached, a film step fails) ends the process with a non-zero exit and Node's error
message.

## Options in general

Options are `--name value`. An option followed by another option, or by nothing, is a switch set to true
(`--plan-only`, `--slow`, `--json`). `--help` anywhere shows the help, as does running with no command.

Options that pick from a list (`--genre`, `--framing`, `--lens`, `--light`, `--grade`, `--move`, `--look`) take the
list's id. An id the list doesn't have falls back to the list's first entry without a warning, so check spelling
against the tables below.

## film

One line in, a scored and cut short film out, through the same chain as the Film tab (`app/js/film.js`): a plan from
Qwen3, then the song (YuE2), every shot's keyframe (Krea 2), the shots (MiniMax H3), the effects and sound (SAM 3 and
the library, on the song's lanes) and the cut on the bars. A plan built from references (character sheets, sets,
frames) makes those first.

| Option | What it does |
|---|---|
| `--idea "..."` | what the film is about. Needed unless `--plan` names a file that exists. |
| `--genre ID` | the genre's look (default `gothic`): `gothic`, `noir`, `neon`, `fairytale`, `western`, `music`, `documentary`, `fantasy`, `thriller`, `romance`, `period`, `scifi`, `horror`, `adventure`, `anime` |
| `--shots N` | how many shots (default 6) |
| `--plan-only` | write the plan to stdout as JSON and stop |
| `--plan FILE` | make the film from a plan file. If the file doesn't exist, the CLI plans from `--idea` instead. |
| `--out DIR` | where the finished film is written |

```sh
node cli/valis.mjs film --idea "a lighthouse keeper rows out into the storm to bring back the woman the sea took" --genre gothic --shots 6
```

To edit the plan before anything is rendered:

```sh
node cli/valis.mjs film --idea "a lighthouse keeper rows out into the storm" --genre gothic --plan-only > plan.json
node cli/valis.mjs film --plan plan.json --genre gothic
```

The plan has a title, a logline, the cast (a name and a one-sentence look each), the place, the song brief, and one
entry per shot: who is in it, `keyframe` (what the still shows), `motion`, `subject` (what SAM 3 tracks), `effect` and
`on` (the lane it fires on). Pass `--genre` again with `--plan`: the CLI takes the genre from the option, not from the
file.

A plan keeps its `tag`, the name its files are saved under. Run the same plan file again after a stop and the steps
already saved under that tag in `ComfyUI/output/valis/` are found and not made again; the cut always runs.

stderr shows each job (`Film · plan: job <id>`, `done in <n>s`), `plan: <title>, <n> shots`, and a line per stage
(`song: ...`, `keyframes: ...`, `shots: MiniMax H3 shoots shot 1 of 6`, `effects: ...`, `cut: ...`). Only the finished
film is downloaded. Stdout gets:

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

`plan` is the full plan with every file it made. `--json` doesn't apply to `film`.

## frame

Two Krea 2 keyframes, 768 by 1344, from a prompt built the way Create builds it.

| Option | What it does |
|---|---|
| `--prompt "..."` | what's in the frame (needed) |
| `--genre ID` | as for `film` (default `gothic`) |
| `--framing ID` | `wide` (default), `medium`, `close`, `ecu`, `ots`, `low`, `high` |
| `--lens ID` | `auto` (default, no focal length in the prompt), `18`, `35`, `50`, `85`, `135`, `macro` |
| `--light ID` | `auto` (default, from the genre), `moon`, `candle`, `golden`, `neon`, `overcast`, `back`, `fire`, `storm` |
| `--grade ID` | `none` (default), `teal`, `bleach`, `mono`, `techni`, `faded`, `steel` |

```sh
node cli/valis.mjs frame --prompt "a lighthouse keeper on a rocky shore at night, holding a lantern" --genre gothic --framing close --lens 85 --light candle
```

## cast

Puts a character from a sheet into a keyframe with a Krea 2 identity edit.

| Option | What it does |
|---|---|
| `--keyframe FILE` | the keyframe (needed) |
| `--character FILE` | the character sheet (needed) |
| `--prompt "..."` | the edit instruction. Default: `Put the character from the second image into the first image, same pose, same light.` |

## shoot

Turns a keyframe into a MiniMax H3 shot (8-step image-to-video), 768 by 1344.

| Option | What it does |
|---|---|
| `--image FILE` | the keyframe (needed) |
| `--motion "..."` | what happens in the shot (needed) |
| `--move ID` | the camera: `static` (default, locked off), `push`, `pull`, `orbit`, `crane`, `track`, `hand`, `dolly` |
| `--seconds N` | the shot's length (default 4.46, one H3 clip) |
| `--genre ID` | as for `film` (default `gothic`) |

```sh
node cli/valis.mjs shoot --image key.png --motion "he raises the lantern and turns to the sea" --move push
```

These eight moves are described to H3 in words. Create's trained camera moves (orbit LoRAs, Wan 2.2 moves, dolly zoom,
whip pan) aren't commands; run their workflows (17, 18, 19, 22) with `run`.

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
| `--at SECONDS` | where the word is. Default: the first syllable after the longest pause. |
| `--person WORD` | who SAM 3 tracks (default `person`) |

```sh
node cli/valis.mjs turn --a take_as_the_man.mp4 --b take_as_the_vampire.mp4 --at 3.8
```

The voice turn is not a CLI option; for the face and the voice turning together, run
[workflow 13](../workflows/13_turn_with_voice.json) with `run`.

## score

The score-driven Valis pass (Valis FX) on one shot, keeping the shot's own sound. It listens to the score's own
events: `impact` for the halo, `kick` for the reveal, `stroke` for shockwaves.

| Option | What it does |
|---|---|
| `--clip FILE` | the shot (needed) |
| `--score FILE` | a Valis score `.json` (needed) |
| `--bar N` | the score bar the shot starts on (needed) |
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

## For agents

The CLI was built to be driven by a coding agent as well as by hand:

- stdout carries only JSON (the job id, the time and the local output paths, or the film summary), so the agent reads
  results without scraping progress lines.
- Exit codes separate a failed job (1) from a bad command line (2).
- `--json` shows the graph a command would queue. Save it, edit it and queue it with `run`, replacing each
  `<asset ...>` entry with a `--set`.
- `run` with `--set` reaches every graph the studio sends, exported under `workflows/`, and any graph the agent writes.
- `--api` and `--key` point the same commands at Comfy Cloud or a Comfy API deployment.

A typical loop: build a frame with `frame`, read the two keyframe paths from stdout, pass one to `shoot`, pass the shot
to `transform` or `score`, and check each step's exit code before the next.
