# Edit

Edit changes one thing in a clip you already have. Drop a clip and name what to change, as you would say it: "his
head", "her dress", "the man in the mirror". SAM 3 follows it through every frame. Then choose how: **Transform** it
into a new look, **Remove** a person, **Swap** the whole person for a character, or **Turn** one take into another on
a spoken word. Open the tab with **Edit** in the top bar, or press **2**.

![Edit: her crimson cloak, found by SAM 3, transformed to liquid chrome, before and after](../edit.jpg)

## What it needs

| Mode | Models and packs |
|---|---|
| **Find it** | SAM 3 (built into ComfyUI), MaskVidExperiments, ComfyUI-ALLinONE-MinimaxH3 |
| **Transform** | what Find it needs, plus Krea 2 and the Krea 2 identity-edit LoRA (comfyui-krea2edit), and MiniMax H3 ref2va with its text encoder and VAEs |
| **Remove** | what Find it needs, plus the H3 Person Remover LoRA, Qwen Image 2.1 (GGUF, through ComfyUI-GGUF) and MiniMax H3 ref2va |
| **Swap** | MiniMax H3 ref2va with the character-swap LoRA and the ref2v turbo LoRA, and ComfyUI-ALLinONE-MinimaxH3; SAM 3 and MaskVidExperiments for a new background or the plate match |
| **Turn** | SAM 3, MaskVidExperiments and the Valis nodes |

Files, folders and sources are in [Install](../install.md). **Renders → Setup** can download the Person Remover LoRA
for you, and lists anything else a mode still lacks.

## Change something in a clip

1. Drop a video on **Clip**, or click a clip in the bin and choose **Edit**. Vertical or horizontal, up to 15 s.
2. Under **What to change**, name it, or click one of the examples (the man, his head, her dress, the woman, man in
   the mirror, the sky, the car).
3. Press **Find it**. The viewer shows what SAM 3 found, laid over the clip.
4. Under **How**, pick **Transform**, **Remove**, **Swap** or **Turn**, and fill in what that mode asks for.
5. Press **Render**. The result plays against the source as before and after: drag across the picture to move the
   divider. (Turn shows its result alone.)

**Render**'s sub-label names the engine for the mode (H3 masked, H3 + Person Remover, H3 character swap, Valis) and the
time it will take on this machine. On a 12 GB laptop, **Find it** takes about 35 s with SAM 3 loaded (about 2.5
minutes cold), a Transform about 12 minutes, a Swap of a 6 s take about 15 minutes, and a Turn 1 to 2 minutes.

## Find it, and naming the target

SAM 3 follows one thing per clip, found by the name you give. **Find it** runs only that step and shows the mask as an
overlay, so you see what will change before the long render. It uses the **Mask margin** below.

- Make the name pick one thing: "the man on the left", "man in the mirror".
- Name exactly the part you want changed. Transform and Remove work only inside what SAM 3 finds, plus the margin:
  "his head" gets a new head, "the man" a new figure.
- For **Swap** and **Turn**, name the person. Swap's prompt uses the name ("Replace only the man in <Video 1>…"; a bare
  "man" becomes "the man"), and SAM 3 uses it to key the person onto a new background and to match the result to the
  plate. Turn uses it to find the person in the first take, and looks for "person" if you leave it empty.

## Transform

The thing you named becomes something else. SAM 3 tracks it, and the clip is cropped around it as it moves. Krea 2's
identity edit makes new first and last frames of that crop in the look. MiniMax H3 ref2va then re-renders only the
masked region between them, hearing the clip's sound, and the result goes back into the full frame through the mask
with a feathered edge.

The look is either your own or one of 57 presets.

### Your own look

The **Your own look** box sits above the presets.

- Drop a picture of it: a creature, a costume, a material. A still from the bin can be dragged in. Krea 2 uses it to
  make the new first and last frames, and H3 sees it too, as a reference.
- Or type what it is in **…or say what it is**. With no picture, your words are the look.
- Or both. The picture fixes the look and a few words about it help H3 keep it.
- **Paint it** turns your words into a picture: Krea 2 paints a clean reference photograph of them, whole and in sharp
  focus on a plain grey background, and uses it as the picture. It also lands in the bin.

Dropping a picture or typing in the words box switches to your own look. Clear the words with no picture there and the
preset comes back. The × on the picture takes it away.

Click a preset while a picture is in the box and you get the preset matched to your picture. The line under the box
says so, and Krea 2 is told to match the look in the reference picture. Take the picture away to use the preset alone.

### The presets

57 presets in seven groups. The chips above the cards show one group at a time, or **All**. Each card shows the look
made on a costume-test sheet by Transform's own first step, and its tooltip describes it.

| Group | Presets |
|---|---|
| Elements | Living fire, Ghost-fire, Smoke & embers, Water, Lightning, Sand, Ash, Molten rock, Flowers, Night sky, Ink |
| Materials | Bronze statue, Marble statue, Gold, Liquid chrome, Porcelain, Glass, Ice sculpture, Carved wood, Clay, Folded paper, Crystal, Obsidian |
| Light & tech | Hologram, Bioluminescent, Glowing runes, Neon, X-ray |
| Costume | Plate armour, Space suit, Samurai, Victorian, Royal, Old diving suit, Cyberpunk |
| Age & weather | Aged, Frozen, Battle-worn, Overgrown, Caught in rain |
| Spirits | Ghost, Wraith, Drowned, Living shadow, Angel, Ghost bride |
| Creatures | Werewolf, Zombie, Demon, Orc, Elf, Grey alien, Android, Reptilian, Mummy, Skeleton, Vampire |

Living fire is picked when the tab opens.

### Faithfulness and margin

The **Controls** section holds two sliders.

- **Faithfulness to the original** (0.3 to 5): how closely Krea 2's new first and last frames keep the original. Low
  lets the look take over (a whole new face). High keeps the shape and changes the material. Each preset sets its own
  value when you pick it: creatures that replace the face start low (Grey alien 0.4, Werewolf 0.5), materials and
  costumes that keep the shape start higher (Bronze statue 1.5, Plate armour 2.5), and Living fire, Ghost-fire, Smoke &
  embers, Liquid chrome and Ghost bride start at 4.0. Your own look starts at 1.0. After that the slider is yours.
- **Mask margin** (0 to 40 px, 12 by default): how far past the thing's edge the re-render reaches. More covers hair
  and loose clothes; less keeps the background untouched.

### When to use Swap instead

Transform re-renders only inside the person's own outline, so antlers, wings or a bigger body get cut off. For a whole
new creature or character, use **Swap**, which replaces the whole person and keeps the take's motion and voice. While
there is a picture in the box, **Swap the whole person instead →** appears under it. It moves
the picture to Swap's character and your words to its description (when that is empty), and switches to Swap.

## Remove

Remove takes a person out of the clip with the H3 Person Remover LoRA, and what was behind them fills in.

1. SAM 3 tracks the person you named.
2. The clip is brought to about 0.6 megapixels in its own shape, and the person is painted solid green in every frame.
3. Qwen Image 2.1 takes them out of the first frame. Only the fill inside the person's mask is kept, so the clean first
   frame has the source's exact framing.
4. H3 ref2va with the LoRA generates the whole clip (12 steps), with the green clip and the clean first frame as
   references and the clean frame as its first frame.
5. The result is scaled back to the clip's size and laid over the source through the mask, grown 16 px and feathered.
   Outside it, every pixel is the source's own.

**Faithfulness to the original** is hidden in Remove (the LoRA has no such setting), and the **Mask margin** drops to
8 px when you switch to it. The strip under the viewer shows the **clean first frame**, **what H3 is shown** (the green
clip), **H3's own pass** before it is laid over the source, and the **result**.

The mode's tooltip records its known limits. Remove is made for people. A shadow or reflection outside the mask stays.
A person close to the camera in a crowd, or someone carrying something, can be painted back. Compare against H3's own
pass when a result looks wrong.

## Swap

Swap replaces the whole person with a character (the H3 character-swap LoRA) and keeps the take's motion, framing and
voice: the clip's soundtrack is anchored at the first frame, so the new face speaks the original words. The take is
brought to 0.5625 megapixels (576×1024 for a 9:16 clip) so a laptop GPU can carry it, and rendered with the turbo LoRA
in 8 steps.

- **Becomes**: drop the character. An upper-body or full-body sheet works best. Or describe them in **…or describe
  them and paint a sheet** and press **Paint**: Krea 2 paints a costume-test sheet from your words (a waist-up
  portrait on a plain dark grey backdrop) and uses it.
- **what they look like: hair, face, clothes (helps the swap)**: words that go into H3's prompt. A painted sheet fills
  this from your description when it is empty.
- **New background** (optional): drop a background plate. SAM 3 keys the person onto it first, then the swap runs, so
  the new scene and the new character are lit together. The keyed take is saved too, shown as **on the new
  background**.

### Match the plate, and the swap check

**match the plate** is on by default. It adds two steps that use no AI.

Before the swap, Valis Swap Check measures the take, inside the person's mask, against the character sheet: exposure,
contrast, warmth, saturation, sharpness, grain, which side the key light is on, how much of the frame the person fills,
and how steady the mask is. If the sheet's exposure is off by more than half a stop, or its warmth or contrast clearly
differ from the take's, the sheet is graded to the take's light (a colour transfer) before H3 sees it.

After the swap, SAM 3 finds the new character in the result (the silhouette is not the old one's), and Valis Swap
Match grades only them toward the plate: colour and tone matched and smoothed over time so they don't flicker, grain
added to match the plate, softened if they are crisper than it, and a light wrap at the edge. Both nodes are described
in [ComfyUI nodes](../reference/nodes.md#checks-and-matching).

The check writes a short report as text next to the swap (`swap_…_check`). It lists the take's and the sheet's
numbers, then either "looks good" or warnings like these:

- exposure, colour or contrast differ (the sheet is pre-graded for these)
- the key light comes from the other side in the sheet
- the sheet is much crisper than the take, or the take is grainier (the match softens the swap or adds grain)
- the person fills under 3% of the frame (swaps hold best above about 5%, so frame closer)
- SAM 3 lost the person in some frames, or the outline is unstable
- the person is cut by the frame edge in most frames

The studio doesn't flip the sheet. If the report says the key light is on the other side, mirror the sheet yourself
and swap again.

## Turn

Turn makes one take become another on a spoken word: the man turns into the vampire on "morning". The two clips are
two renders of the same take (the take and a Swap of it, or two Swaps), so they line up frame for frame.

- **Turns into**: pick the second take from the bin's clips, or drop it.
- **On the word**: the first take's sound, drawn as a waveform with a tick at every syllable. Click the word where it
  turns. A click near a syllable snaps to it, and the clip plays from half a second before. Double-click for the
  automatic pick, the first syllable after the longest pause. A clip with no readable sound turns halfway.
- **the voice turns too**: on by default. The voice turns on the same word: pitched down, with lower formants (a
  bigger throat), a sub-octave under it, a slow growl and a dark room, crossfaded over 40 ms. No model.

The voice becomes the score: every syllable is an event and the chosen word is the impact. On it, the second take
burns in from the eyes of the person you named (SAM 3 finds them in the first take), and every later syllable feeds
it. **Find it**, the prompt and the controls are hidden in Turn. Apart from SAM 3, it runs on the CPU, in a minute or
two.

## The prompt and the sound

**Prompt** shows what the mode will send, built from your choices. You can edit it. Any change to the target, the look
or the mode rebuilds it, so make your edits last.

- Transform: what Krea 2 is told for the new first and last frames.
- Remove: what Qwen Image 2.1 is told for the clean first frame.
- Swap: what H3 is told.

**keep the clip's own sound** (in **Controls**, on by default) feeds the clip's sound to Find it, Transform and Remove,
and keeps it on the result. These passes need a sound track, so untick it for a clip that has none; Valis uses
silence in its place. Swap and Turn always use the take's own sound.

## The engine: FastH3

**Renders → Engine** picks the model that renders Transform and Swap: **H3 ref2va** (20 steps, or the turbo LoRA) or
**FastH3 OmniRef**, the same model distilled to 8 steps. FastH3 is a 22.2 GB download (the button is under the
selector), and the choice is remembered in this browser. With FastH3, Swap's turbo LoRA is skipped. FastH3 is a
preview release, so compare against H3 ref2va if a render looks off.

Remove always renders on H3 ref2va, because the Person Remover LoRA was trained on it. Turn uses no video model.

## Limits and tips

- Run **Find it** before every long render, and again after you change the name or the margin.
- One clip, up to 15 s. Run **Free memory** (Renders) between big jobs on a 12 to 16 GB card.
- Transform stays inside the outline. A new silhouette is a Swap.
- For Swap, frame the person large: the check warns under 3% of the frame, and swaps hold best above about 5%.
- For Turn, render both takes from the same source clip so they line up.

## Where results land

Everything goes to `ComfyUI/output/valis/`, and the results go into the bin. **Find it** saves `find_…_matte` and
`find_…_overlay`. Transform and Remove save `edit_…`, with the mask as `edit_…_matte`; Transform also saves its new
first and last frames as `edit_…_anchor_first` and `edit_…_anchor_last`, and Remove saves its clean first frame as
`edit_…_anchor_first`, the green clip as `edit_…_guide` and H3's own pass as `edit_…_raw`. Swap saves `swap_…`, the
keyed take as `swap_…_plate` and the check as `swap_…_check`. Turn saves `turn_…`. A painted look is `look_ref_…` and a
painted sheet `swap_sheet_…`.

## Workflows and the CLI

| Workflow | What it is |
|---|---|
| [`04_find_sam3.json`](../../workflows/04_find_sam3.json) | Find it |
| [`05_transform_vampire.json`](../../workflows/05_transform_vampire.json) | Transform with a preset |
| [`36_transform_your_own_look.json`](../../workflows/36_transform_your_own_look.json) | Transform into your own look |
| [`26_transform_vampire_fasth3.json`](../../workflows/26_transform_vampire_fasth3.json) | Transform on FastH3 OmniRef |
| [`06_remove_person.json`](../../workflows/06_remove_person.json) | Remove |
| [`07_swap_character_h3.json`](../../workflows/07_swap_character_h3.json) | Swap onto a new background |
| [`12_swap_matched_to_plate.json`](../../workflows/12_swap_matched_to_plate.json) | Swap, matched to the plate |
| [`08_turn_on_a_word.json`](../../workflows/08_turn_on_a_word.json) | Turn |
| [`13_turn_with_voice.json`](../../workflows/13_turn_with_voice.json) | Turn, with the voice |

```sh
node cli/valis.mjs find --video clip.mp4 --target "her dress"
node cli/valis.mjs transform --video clip.mp4 --target "his head" --look bronze
node cli/valis.mjs transform --video clip.mp4 --target "the man" --ref stag_spirit.png --words "a stag-headed spirit of bark and moss"
node cli/valis.mjs remove --video clip.mp4 --target "the man in the mirror"
node cli/valis.mjs swap --video take.mp4 --character vampire_sheet.png --background ballroom.png --person man
node cli/valis.mjs turn --a take_as_the_man.mp4 --b take_as_the_vampire.mp4 --at 3.8
```

`--look` takes a preset's id (`bronze`, `vampire`, `fire`…); `--at` is the turn in seconds. `swap --slow` renders 20
steps without the turbo LoRA. The CLI's `swap` has no plate match and its `turn` has no voice turn; for those, run
workflows 12 and 13:

```sh
node cli/valis.mjs run workflows/12_swap_matched_to_plate.json --set 16.file=take.mp4 --set 60.image=sheet.png
node cli/valis.mjs run workflows/13_turn_with_voice.json --set 16.file=take.mp4 --set 40.file=take_swapped.mp4
```

[The command line](../cli.md) has every command and option.
