# Genjutsu

Genjutsu keeps a performance's motion, camera and timing, and changes who is in it, where they are, or the whole look.
It is Higgsfield's Genjutsu rebuilt on open weights. The source clip's motion is read as a control video (pose
skeletons or edges), and MiniMax H3 ref2va renders a new clip that follows it through the H3 Fun ControlNet Union.
Open the tab with **Genjutsu** in the top bar, or press **6**.

## What it needs

| Mode | Models and packs |
|---|---|
| every mode | MiniMax H3 ref2va, its text encoder and VAEs |
| **Motion transfer** | the H3 Fun ControlNet Union; SDPose (whole body) and RT-DETR, which finds the people |
| **Restyle** | the H3 Fun ControlNet Union |
| **Object swap** | the H3 Fun ControlNet Union 2.0; SAM 3 |
| **Check source** | SDPose and RT-DETR, and the Valis nodes (Valis Pose Check) |
| **turbo** | the ref2v turbo LoRA |

SAM 3, SDPose and the H3 nodes are part of ComfyUI itself. The files and where they go are in [Install](../install.md),
and **Renders → Setup** lists anything a mode still lacks.

## Make a clip

1. Drop the performance on **Source video**: 4 to 15 s, with its sound. A clip in the bin can come in with
   **Genjutsu · source**.
2. Pick a **Mode**: **Motion transfer**, **Restyle** or **Object swap**.
3. Add what the mode needs: references with their roles, a style, or the thing to swap.
4. For Motion transfer, press **Check source** and read the report before the long render.
5. Set **Length, size and sound**.
6. Press **Cast it**. The result plays in the viewer and lands in the bin.

On a 12 GB laptop, 5 s at 480p takes about 6 minutes for Motion transfer or Restyle. The buttons show the time this
machine has measured for itself.

## Motion transfer

New people, from your reference images, doing exactly what the people in the clip do.

RT-DETR finds up to two people in each frame, and SDPose reads 133 keypoints on each (body, hands, face and feet),
drawn as a skeleton video. That skeleton is all the motion H3 gets. The Fun ControlNet Union makes H3 ref2va follow its
poses and timing, and the camera move comes with it. The references say who and where. The source's own sound is kept
unless you untick it.

**References** take up to 8 images. Drop each on **+ image**, or drag a still from the bin. Each image becomes
`<Picture N>` in the prompt, and its menu gives it a role: character, second character, location, style, object or
outfit. The first image starts as the character and the rest as locations; change them to what each one is. The ×
takes an image out. Motion transfer needs at least one reference: the new character.

The prompt it builds reads like this, for a character and a place:

```
<Picture 1> is the character. <Picture 2> is the location. The character performs the same movements as in the
control video, in the location shown. Their body follows the control video's poses and timing exactly. One
continuous shot, no cuts, no text.
```

## Restyle

The whole clip in a new look. The motion is read as Canny edges, so the people, their motion, the timing and the camera
follow the source, and everything is re-rendered in the style.

**Style** has 24 looks: Clay stop-motion (the default), Anime, Watercolour, Oil painting, Comic ink, Pixel art,
Papercraft, Felt puppets, 3D cartoon, Charcoal, Ukiyo-e, Stained glass, Origami, Neon wireframe, Living marble, Liquid
chrome, Sand, Silent film, Film noir, VHS home video, Low-poly, Pencil sketch, Living fire and Ghosts. Each chip's
tooltip shows the words it adds. References are optional here; one with the **style** role gives H3 a picture of the
look.

The core Canny node edges the whole clip on the GPU at once, which ran out of memory at 576p and 9 s. With the Valis
nodes loaded, Genjutsu uses Valis Canny instead, which does the same edges a few frames at a time.

## Object swap

Only the thing you name is replaced; everything else stays.

- **What to swap**: name it, as in Edit: "her dress", "the car", "the man on the left". SAM 3 finds it in every frame,
  and its mask, grown 16 px, goes to the ControlNet's inpaint input, so only that region is regenerated.
- Say what replaces it. Drop a picture of it as a reference, give it the **object** or **outfit** role, and the prompt
  says the object is replaced by `<Picture 1>`, keeping its shape, folds and motion and matching the scene's light.
  With no picture, open **Prompt** and write the replacement in: the built prompt says "something new" until you do.
- **keep everything else exactly: paste the new object back onto the original frames** (on by default). H3 re-renders
  the whole frame even outside the mask, so faces and sky drift. This lays only the new object back onto the source
  through the mask, with Valis Swap Match: a feathered edge, matched grain and a light wrap, and no recolouring.
- **follow the object's own shape (edges); off = follow the body (pose)** (on by default). On, the new object follows
  the old one's edges (Canny), which suits clothes and things. Off, it follows the body's pose (SDPose).

Object swap works best with the Fun ControlNet Union 2.0, which inpaints with mid-grey holes. With only version 1
installed it still runs, warns you, and tends to paint the object black.

## Check source

**Check source** (pose only) runs only the pose step and Valis Pose Check, with no video model, on up to 15 s from the
start of the clip: about 3 to 4 minutes for a 10 s clip on a 12 GB laptop, where a full render can take 20. The viewer
then plays the skeleton video, the same skeleton Motion transfer follows.

It matters for Motion transfer, and for Object swap with edges off, since both follow the skeleton. Where the skeleton
is missing or ambiguous, H3 has to guess the body, and that is where it warps. Valis Pose Check is described in
[ComfyUI nodes](../reference/nodes.md#checks-and-matching).

### Reading the report

The report opens with a verdict:

| Verdict | Means |
|---|---|
| **Readable** | At least 90% of the frames read clearly as a body. Good to go. |
| **Use a window** | Under 90%, but there is a stretch of at least 2 s where at least 85% of the frames read clearly. |
| **Risky** | No stretch like that. Try another clip. |

Then a summary: what share of the clip reads clearly as a body, each problem with the seconds where it happens, and
either "Good to go." or the best window. A problem is listed when it lasts at least a quarter second.

Under the summary is the timeline. Along the top runs one column per frame, green where the body reads clearly through
to red where it doesn't. Under it, a white bar marks the best window (the longest stretch that is at least 85%
readable), and then comes one lane per problem, in this order:

| Lane | What it means |
|---|---|
| no body found | Too few keypoints in the frame to make a body. |
| body cut off by the frame edge | Keypoints sit on the edge of the frame. |
| hips and legs hidden | A long dress or coat, or the legs out of frame. |
| can't tell which way the body faces | No face, and the shoulders edge-on or missing: a back turned, or mid-spin. |
| left and right keep swapping | The left and right sides flip back and forth within half a second. |
| skeleton jumps or limbs stretch | The body's centre moves more than half a torso in one frame, or a bone is 1.8 times its usual length: a false detection. |

When the verdict is **Use a window**, a **Use the best window** button shows its range. Press it, and **Cast it**
renders that stretch (its start and its length) in place of the **Length** setting. It stays in effect until you drop
another clip.

## Length, size and sound

- **Length** (2 to 15 s, 5 by default): how much of the source to use, from its start or from the best window. H3 was
  trained on 5 to 15 s. The length snaps to H3's frame grid (17 frames, plus 5, at 24 fps).
- **480p** (0.4 megapixels, the default): the size Motion transfer holds together best.
- **576p** (0.56 megapixels): sharper, but a body that is hard to read warps more.
- **9:16**, **16:9** or **1:1**: the shape of the result. The source is scaled and cropped from its centre to fit.
- **keep the source's sound** (on by default): the source clip's own sound on the result. Off, the result carries the
  sound H3 makes.
- **turbo (8 steps, faster, a little rougher)**: 8 steps with the turbo LoRA in place of 20.

With **FastH3 OmniRef** chosen under **Renders → Engine**, every Genjutsu render runs in 8 steps on FastH3 and the turbo
LoRA is skipped, so the **turbo** box changes nothing.

## The prompt and the graph

**Prompt** (folded shut) shows what H3 is told, built from the mode, the references and their roles, the style and the
object's name. Edit it freely, as the last step, since any change to those rebuilds it.

**Graph**, under the viewer, shows the exact graph sent for the last **Cast it**, in ComfyUI API format.

The result plays in the viewer with a finish bar under it (**Extend →**, **← Lead-in**, **Upscale**), the same as
Create's. The strip keeps each result and its control video (the skeleton or the edges), labelled **control**.

## Limits

- Motion transfer sees nothing but the skeleton. A long skirt hides the hips and legs; in a spin the face drops out
  and nothing says which way the body faces; a dancer leaving the frame leaves no skeleton at all. A body that stays in
  frame works best. Check the source first.
- The pose step finds at most two people.
- 576p is sharper and less forgiving: a hard-to-read body warps more than at 480p.
- Object swap follows one object, the one SAM 3 finds for the name.
- Run **Free memory** (Renders) between big jobs on a 12 to 16 GB card.

## Where results land

Everything goes to `ComfyUI/output/valis/`. A render is `genjutsu_motion_…`, `genjutsu_restyle_…` or `genjutsu_swap_…`,
with its control video as `…_control`. A source check saves `posecheck_…_report` (JSON), `posecheck_…_timeline` (the
strip, as an image) and `posecheck_…_skeleton` (the skeleton video).

## Workflows and the CLI

| Workflow | What it is |
|---|---|
| [`14_genjutsu_motion_transfer.json`](../../workflows/14_genjutsu_motion_transfer.json) | Motion transfer with a new character and a new place |
| [`15_genjutsu_restyle.json`](../../workflows/15_genjutsu_restyle.json) | Restyle (clay) |
| [`16_genjutsu_object_swap.json`](../../workflows/16_genjutsu_object_swap.json) | Object swap, pasted back onto the plate |
| [`23_genjutsu_source_check.json`](../../workflows/23_genjutsu_source_check.json) | Check source |

The CLI has no Genjutsu command of its own; run the workflows. The source clip is node `v` in all four, and the
references in workflow 14 are `ref0` and `ref1`:

```sh
node cli/valis.mjs run workflows/14_genjutsu_motion_transfer.json --set v.file=dance.mp4 --set ref0.image=cast.png --set ref1.image=porch.png
node cli/valis.mjs run workflows/23_genjutsu_source_check.json --set v.file=dance.mp4
```

In workflow 16, the object's name is node `st` (`text`) and the swap's prompt is node `r2v` (`prompt`).
[The command line](../cli.md#run) explains `--set`.
