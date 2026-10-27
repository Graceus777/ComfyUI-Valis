# Troubleshooting

Start with the **setup** pill in the top bar. It checks every graph the studio sends against your ComfyUI and lists,
per feature, the node pack, model file or input that's missing. Most problems show up there before anything is queued.

## The studio

**/valis shows nothing, or "connecting" never turns green.** ComfyUI isn't running on that address, or the pack
didn't load. Check the ComfyUI console for `[valis]` lines: each part of the pack that fails to import prints
`[valis] ... not loaded: <reason>` and the rest keeps working. The studio is served at `/valis` on ComfyUI's own port.

**A feature says it needs a node pack.** Install the pack Setup names (the list is in [Install](install.md#4-add-the-node-packs-you-need))
and restart ComfyUI. "A newer ComfyUI" means the node is part of ComfyUI itself: MiniMax H3, SAM 3, SDPose, Qwen Image
2.1, YuE2 and the video nodes all are. Update ComfyUI.

**A feature says a model file is missing.** The file names must match the ones in [Install](install.md#5-add-the-models-you-need),
in the folder named there. If yours has another name, rename it or change the name in `app/js/graphs.js` (`MODELS`).
On Linux and macOS the Krea 2 identity-edit LoRA goes in `loras/Krea2/`.

**"Valis Pose Check isn't loaded yet (restart ComfyUI)", or a new Valis node is missing.** The studio was updated but
ComfyUI still runs the old Python side. Restart ComfyUI. A change to `app/` only needs a reload of the tab.

**Buttons show a time with a `?`.** The studio learns how long each kind of job takes on your machine. A `?` means that
kind of job hasn't run here yet; the estimate is a guess until it has.

**A tooltip or the prompt panel doesn't show what you expect.** Hover any choice: its tooltip shows the words it adds.
**Prompts** (Create) and **Prompt** (Edit, Genjutsu) show what is sent.

## Memory and speed

**Out of memory, or a job far slower than the README's timings.** Press **Renders → Free memory** between big jobs on
a 12 to 16 GB card. MiniMax H3 image-to-video and H3 ref2va don't fit side by side, and neither fits next to Wan 2.2.
Then press **Detect hardware**: it reads your GPU, driver, CUDA, cuDNN, attention kernels and ComfyUI's launch flags
and sets the safe shot size. A smaller shot size (Film's **Shot size**, Create's **Format**) is the quickest way to
make a test fit; 384 px drafts render in a fraction of the time.

**Stopping a job.** **Renders → Stop current** interrupts the running job. In Film, a running step stops after its
current job when you reload the tab; the plan keeps every shot and effect made so far, so **Make the rest** picks up
where it stopped.

**The first SAM 3 job takes minutes.** Loading SAM 3 the first time takes about 2.5 minutes on the 12 GB laptop; after
that a track takes about 35 seconds.

## Pictures and sound

**A shot's light drifts during the shot.** MiniMax H3 tends to relight a scene when the prompt says nothing about the
light. Film shots carry the plan's look and a line that the light and its colour stay, and the effects pass matches
every frame's colour to the keyframe; untick **keep the keyframe's colours** on a shot card to turn that off. In
Create, name the light in the shot's words.

**People change, or a person appears twice, between shots of a film.** Build the film from references
([Film](guides/film.md#build-it-from-references)): one sheet per character, an empty plate per camera setup, and every
later moment made from the seated frame. Turning a set that has people in it brings them back twice.

**A Wan 2.2 camera move plays fast and short.** Wan 2.2 shoots 16 fps. FX, Score and Film retime any clip to 24 fps
first when the **Valis Frame Rate** node is loaded; restart ComfyUI if it isn't.

**An effect didn't fire.** Each layer listens to one lane. A lane with no hits in the clip's span (no hats in a slow
intro, no `bar` lane from a dropped song) fires nothing. Check the lane names in [Lanes and cue sheets](reference/cues.md)
and pick another lane on the layer.

**Effects that show another scene fail.** Time slip, Era cut, Split time, Tear and Double exposure need **Another clip**
in the FX tab. Pick one before you render.

**Remove leaves something behind.** Remove takes out the person you name; what they hold or wear can stay. Run Remove
again on the result, naming what's left ("the sword"). The [Edit guide](guides/edit.md) has the details.

## Downloads

**A model download from Setup fails.** Setup downloads only from Hugging Face, checks the size and the sha256, and
keeps a file that fails the hash as `<name>.valis-bad`. If your machine can't reach huggingface.co, download the file
yourself from the source in [Install](install.md#every-file) and put it in the folder named there.

## Workflows

**A workflow from `workflows/` won't queue.** They are in API format. Point every Load node at a file in
`ComfyUI/input` (the table in [workflows/README.md](../workflows/README.md) lists what each needs). Workflows 02, 05 and
26 name the Krea 2 identity-edit LoRA the Windows way, `Krea2\...`; pick `Krea2/...` in the LoRA loader on Linux and macOS.

## Still stuck

Run **Renders → End-to-end test** for the feature that fails: each test renders a short, low-resolution version through
the studio's own code and says what it checked. Open an issue at https://github.com/Graceus777/ComfyUI-Valis/issues
with the Setup list for that feature, the ComfyUI console output and your **Detect hardware** report.
