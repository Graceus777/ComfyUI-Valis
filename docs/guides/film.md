# Film

The Film tab makes a short film in steps you can see and stop: the plan, the song, a still for every shot, the shots, their effects and the cut. Type one line and a local Qwen3 drafts the plan, or write the script yourself. Each step runs on its own, and **Make the rest** runs every step that is still missing. Press **0** to open the tab.

![The Film tab: THE IRON SAINT's plan, its cast and place, and the shot cards with each keyframe and its MiniMax H3 shot](../film.jpg)

For a first run from start to finish, follow [Your first film](../first-film.md).

## What it needs

| Step | Model or node pack |
|---|---|
| Plan it | the Qwen3-VL 8B text encoder Qwen Image 2.1 uses (`qwen3vl_8b_w4a8.safetensors`), through ComfyUI's own text generation |
| Song | YuE2. The planner always writes `[Instrumental]` as the lyrics, and an instrumental also needs the instrumental adapter LoRA and the Plenio pack |
| References, Sets | Krea 2. A state, a prop or a turned set also needs the Krea 2 identity-edit LoRA and the comfyui-krea2edit pack |
| Frames | Qwen Image 2.1 (the GGUF, through ComfyUI-GGUF) |
| Keyframes | Krea 2. A close-up cut from a frame needs the SeedVR2 pack |
| Shots | MiniMax H3 and the MiniMax-H3-PDD-Acc pack |
| Effects | the Valis library (CPU), and SAM 3.1 when an effect follows a subject |
| Cut | ComfyUI's video nodes and Valis Title Card |

The files and packs are in [install](../install.md). A film from words alone needs only the first two rows and the last four.

## The panel

### The line

Type the whole film in one line under **The film**. Qwen3 turns it into a cast, a place, a song brief and a shot list you can edit before anything renders.

**or start from a blank script** opens an empty plan instead: one camera setup called master, one shot, and an instrumental song brief at 108 BPM. Use it for a film you write yourself.

### Genre

Fifteen looks, from Gothic horror to Anime. The genre's words start every keyframe until the plan has a look line of its own, and their first phrase opens every shot's motion prompt.

### Shots, length and size

| Control | What it does |
|---|---|
| **Shots** | 4, 6, 8, 10 or 12. Used by the next **Plan it**. |
| **Shot length** | 2 to 15 s in half seconds. **one clip** is 4.46 s (107 frames at 24 fps). This is how long H3 shoots each shot. The cut plays as many whole bars of the song as fit in it, so the film comes out a little shorter than shots × length. |
| **Shot size** | 320 to 1024 px on the short side, in steps of 32, always portrait 9:16. 384 is marked draft and 768 native (768×1344). Smaller shoots much faster. |

The hint under the length gives the film's length before the title card. It also notes when a shot is shorter than H3's training (5.2 to 15 s). That works, though fast moves can feel rushed. One clip is under 5.2 s, so the note shows at the default.

The first time the studio opens on a machine, the size follows the GPU. **Renders → Detect hardware** sets it again.

On a plan that already has shots, a new length means those shots are shot again when you run **Shots**, and if the song is now shorter than the film, **Song** writes a longer one. A new size applies to shots made after the change. Shots already made keep theirs.

### Song

**YuE2 writes it** sends the plan's song brief to YuE2, which writes the sheet music and plays it. **My song** opens a drop zone for a wav, flac or mp3. Valis reads its tempo and bars, the shots are cut on its bars and the effects fire on its beats. A song dropped from disk while a plan is open goes into that plan.

## Plan it

Press **Plan it**. Qwen3 runs through ComfyUI's text generation and takes about 2 minutes with the model load. It is asked for a film with no dialogue:

- a title of two or three words, a logline, and a place with its light
- at most three cast members, each with a short name and a one-sentence look
- a song brief that ends with its tempo (108 BPM)
- for each shot: who is in it, a keyframe sentence with its framing and light, a motion sentence, a subject for the tracker, an effect and a lane

The planner picks effects from a light-first list (Flicker, Firelight, Lightning, Light sweep, Glow, Light shafts, Glint, Heat haze, then Shockwave, Echo, Punch, Projector, Frost, Datamosh, Slit-scan, Glitch, Gravity lens, Vertigo) and is told to keep most shots on light or no effect.

Press **Plan it** again for a new plan. The old one stays under **Recent**.

## The plan

The plan sits at the top of the tab. Every field saves as you type.

| Field | What it does |
|---|---|
| title | The film's name. The cut ends on a card with it. |
| logline | One sentence. It is the tooltip on the plan's **Recent** chip. |
| script | Your script: scenes and beats, in order. No model reads it. It is where you work out what the references, sets, frames and shots should be. |
| look | Every keyframe starts with these words. It shows the genre's words until you change it; clear it to go back to them. |
| one row per cast member | How they look. It goes into every keyframe they're in. These rows move to the reference cards once the film is built from references. |
| place | The setting. It goes into every keyframe. |
| song | YuE2's brief: genre, instruments, mood, tempo. Changing it drops the song made so far. With your own song the row shows its file name. |

Once the song is made, a player sits under the fields.

Two rules in how the words are joined explain what you see:

- Each cast look goes into a still with its name, as "The knight: a tall woman knight in black armour...". Said bare, a look read as one more person, and THE IRON SAINT's wide shots showed the knight twice and put her crimson cloak on the giant. A shot's still gets the looks of the cast members its header names.
- With a look line of its own, a shot is told that the light, its colour and the shadows stay as in the first frame. Without it, H3 lit SÉANCE's red-lamp parlour like a showroom within a second. A motion that changes the light (a sword catches fire, a lamp goes out, the sun comes up) isn't told that. With a look line, a motion that mentions the camera ("the camera holds still") also replaces the default slow push-in.

## Recent

**Recent** lists the eight newest plans by title. Click one to open it. The genre, shot count, size and length follow the plan, its line comes back into the box, and a finished film plays in the viewer.

## Steps

Nothing renders until you press a step. Each row shows what is done ("3 of 12", or "106 BPM · 2 bars a shot" for the song) and a button with the time Valis expects, learned from this machine's past jobs. A **?** means it hasn't run that kind of job here yet. **References**, **Sets** and **Frames** appear once the plan has a cast, setups or frames.

| Step | What it makes | With |
|---|---|---|
| **References** | a sheet for every character, every state of one, every prop | Krea 2; a state or a prop is a Krea 2 identity edit |
| **Sets** | the set, empty, from every camera setup | Krea 2; a turned set is a Krea 2 identity edit |
| **Frames** | who is where in a setup at one moment | Qwen Image 2.1 |
| **Song** | the song, or the tempo and bars of yours | YuE2, or Valis Score (make) |
| **Keyframes** | every shot's still | Krea 2, or SeedVR2 for a close-up cut from a frame |
| **Shots** | every shot | MiniMax H3 |
| **Effects** | every shot's effect and its sound, on the song | the Valis library, SAM 3 |
| **Cut** | the film | ComfyUI's video nodes |

A step makes only what the plan doesn't have yet. To make one thing again, use its card: **⟳** on a sheet, set or frame, **⟳ still** or **▶ shoot** on a shot. On **Song**, **again** runs YuE2 again with the same seed, so change the song brief for a different song. On **Cut**, **again** cuts the film again into a new file.

**Make the rest** runs the steps in order and makes everything still missing. Its line shows the total time. A stopped run picks up where it was. Before the song, the pictures, the shots and the effects, the tab frees GPU memory. Six shots of one clip each is about 25 seconds of film and about an hour on a 12 GB card.

### Song

YuE2 writes a song as long as the film plus 4 seconds, up to 120 s. The tempo comes from the sheet music it wrote (its `Q:` and `M:` lines), or 108 BPM in 4/4 when they say nothing. A take fails when its sheet music comes out broken, and the next run of **Song** then uses the next seed.

Each shot plays as many whole bars as fit in its length. A bar that ends up to 3 frames (0.125 s) past the clip still counts, and the effects pass holds the clip's last frame that long. At 107 BPM two bars are 4.486 s and one clip 4.458 s, so without that allowance half of every shot would be thrown away. A clip shorter than one bar plays whole.

### Keyframes

Krea 2 paints every still at 768×1344, whatever the shot size; H3 scales it. When every shot needs a still, all of them are painted in one job so Krea 2 loads once. A still is the plan's look, the shot's keyframe sentence, the look of each cast member in the shot, and the place. A shot built from a frame takes the frame or a close-up cut from it (see [A shot from a frame](#a-shot-from-a-frame)).

Look at every still before you shoot. A still takes seconds (Create's **Frame it** makes two in about 40 s). A shot takes about 7 minutes.

### Shots

H3 shoots each keyframe at the plan's size and length: 8 steps with the PDD acceleration, about 7 minutes for a 4.5 s shot on a 12 GB card. Its prompt is the look (or the genre's first phrase), "The scene begins exactly as shown in the first frame and comes alive:", the shot's motion, and "The camera pushes in slowly." H3 is also told the scene's sound, written from the keyframe and the motion.

### Effects

For each shot, the library fires the shot's effect on its lane at the shot's own place in the song, and synthesizes the effect's sound in the song's key under the song's slice. SAM 3 tracks the subject when the effect follows one. Every frame's colours are matched to the keyframe unless the card says otherwise. A clip at another frame rate is retimed to 24 fps first. The library runs on the CPU, about a minute per 4 s of video, plus the SAM 3 track (about 35 s warm, 2.5 min cold). A shot with no effect still gets its slice of the song and its colours held. If there is no song yet, **Effects** makes it first.

### Cut

Every shot's effects pass is trimmed to its bars and joined, each carrying its own slice of the song. A 3-second card follows: the title over black, "a Valis film" under it, fading in and out over the next 3 seconds of the song. The film plays in the viewer with **← Lead-in**, **Extend →** and **Upscale** under it, and goes into the bin.

## Shot cards

One card per shot, in order. The header has the shot's number, who is in it, and five buttons.

| Button | What it does |
|---|---|
| **⟳ still** | A new keyframe for this shot, on a new seed. The shot and its effects pass are cleared. |
| **⇠ chain** | From shot 2 on, once the shot before is shot. This shot's still becomes the last frame of the shot before, so the place and the people carry straight on. A fresh still would paint them again from words. Then press **▶ shoot**. |
| **▶ shoot** | Shoots this shot with H3. With a shot already there, a new take on the next seed. |
| **Create ↗** | Opens the shot in Create (see [Create and back](#sending-a-shot-to-create-and-back)). |
| **×** | Removes the shot. The first click turns it into **remove?**; click again within 3 seconds. There is no undo. |

Under the header are three pictures: the keyframe, the shot and the shot with effects. Click one to see it big in the viewer. A shot made at another length than the plan's reads "shot at 4.5 s: shoot again".

| Control | What it does |
|---|---|
| the still's words | The keyframe sentence for Krea 2. The look, the cast's looks and the place are added. Edit it, then press **⟳ still**. |
| **what moves** | What happens during the shot, for H3. |
| **full quality (30 steps)** | Shoots on the int8 weights with the full 30-step recipe instead of the 8-step one. About three times as long (~20 min), for a shot whose motion came apart. It loads `minimax_h3_fl2va_pruned_int8_convrot.safetensors` from `diffusion_models`. |
| **keep the keyframe's colours** | On by default. The effects pass matches every frame's colours to the keyframe, because H3 drifts the light over a shot (SÉANCE's red lamp went warm white by the last second). Untick it for a shot whose light is meant to change, like a lamp going out, or THE IRON SAINT's shot 2, where fire races up the blade and lights her face. |
| **subject** | What SAM 3 tracks. Only effects that follow someone use it: Rim light, Shockwave (it starts from the subject), Echo, Gravity lens, Vertigo, Double exposure. |
| effect | **no effect**, or any effect and preset in the library, in the FX tab's four groups. |
| lane | The lane of the song that fires it: **on kick**, **on snare**, **on hat**, **on beat**, **on downbeat**, **on bar**, **on melody**, **on bass**. |

Changing the effect, the lane or the colour box clears that shot's effects pass, so **Effects** makes it again.

Drag a still from the bin onto a card to make it the shot's keyframe (the shot and its effects are cleared), or a clip to make it the shot. The bin's menu has **Film · shot 1**, **Film · shot 2** and so on for the same thing. **+ shot** at the end of the cards adds a shot.

## Build it from references

Painted one by one from words, every still is a new room, new faces and a new head count. A film built from references keeps what stays the same as the same picture. Each character has a sheet, the set has an empty plate from every camera setup, a frame seats the sheets into a plate, and a shot is a frame or a close-up cut from one.

Press **Build it from references** under the plan (a blank script starts this way). The cast becomes reference cards, a first setup appears ("master": a wide shot of the whole place), and three sections open: **References**, **Sets** and **Frames**. Every card has:

- a name; the frames and shots call it by this, and renaming it carries through
- a picture; click it to look at it, or drop a still from the bin or a picture from disk to use that instead
- **make** (**⟳** once made, for a new seed) and **×** to remove it

Make and look at the references, then the sets, then the frames, before any shot is built from them.

### References

**+ character** and **+ prop** add a card. Its select says what the sheet is made from.

| Made from | What happens |
|---|---|
| painted from its words | Krea 2 paints a costume-test portrait at 832×1216: waist-up, facing the camera, a plain dark grey backdrop, soft even light from the front, 35 mm grain. Write who they are and what they wear: age, face, hair, clothes, what they hold. Tick **a prop** for a close-up object on the same backdrop. |
| a change of (a name) | A state of another sheet: soaked through, drowned. A Krea 2 identity edit of that sheet, told to keep the face, the hair, the design of the clothes, the pose, the framing, the light and the backdrop. Name only what is different. The sheet goes in small so the words weigh more, since a state is a strong change. |
| a picture of others | A prop made of other sheets, such as their wedding photograph. Pick whose sheets go in, in order; write what the picture shows. |

### Sets

A set is the place, empty, from one camera setup, painted at 768×1344 with "No people." in its words.

| Made from | What happens |
|---|---|
| painted | Krea 2 paints the film's look, the view and the place. Write where the camera is and what is in the empty set. |
| the (setup), turned | A Krea 2 identity edit of that setup's empty plate: the same empty room from where you say ("from the opposite side of the table, low, looking back where the camera was"), keeping every piece of furniture, the light and the grain. |

Turn the empty plate, never a frame with people in it. Turned, the people come back twice and the furniture goes. **+ setup** adds one; after the first, a new setup starts as a turn of the first.

### Frames

A frame is what a setup shows at one moment. **+ frame** adds one once there is a setup. The first is seated in the first setup with everyone; each later one starts as a change of the frame before.

| Kind | What you set | What happens |
|---|---|---|
| seated in the (setup) | who is in it, and the blocking: who sits where, facing where, doing what | Qwen Image 2.1 seats every sheet into the setup's clean plate in one pass. The plate is Picture 1 and each sheet the next, at about half a megapixel. About a minute. Anyone you don't seat isn't there. |
| a change of (a frame) | what has changed by now, who arrives, who is **gone** | One Qwen Image 2.1 edit of the seated frame the chain starts from, with every change so far in its words and the sheet of anyone who arrives. |

Each of these rules came from a take that went wrong:

- Seating is Qwen Image 2.1 with every sheet at once. Measured on SÉANCE, the Krea 2 identity edit, trained on one scene and one subject, lost the faces and seated the medium twice when given three sheets as one subject. Seating one person a pass put the aunt in the medium's chair and took four times as long.
- A later moment is an edit of its seated frame, never of the moment before. Each pass repaints the whole picture, and chained edits went soft and dark. Seated fresh from the plate again, the moment's words moved people to other chairs.
- Everyone who stays is named in the edit, and anyone gone is removed with nobody left in their seat. An edit left the widower in when told he'd gone, and dropped the medium seen from behind when nobody named her.
- Every moment has a seed of its own. On its seated frame's seed it started from the same noise, came back speckled and over-sharpened, and left out what changed (Eleanor never arrived).

### A shot from a frame

In a film with frames, each shot card has a select: **painted from its words**, or a frame. A shot on a frame uses the whole frame as its keyframe, or a close-up box on it:

1. Drag on the frame to place the box.
2. Size it with the wheel or the slider, from 20% of the frame up to the whole frame. The box keeps the frame's shape.
3. Press **whole** to go back to the whole frame.

SeedVR2 enlarges the box to a full 768×1344 still and keeps the pose and the faces the frame has. Krea 2 and Qwen, asked to re-render the box sharp, invented a face at its edge and took the medium out of her trance. A close-up cut this way has the same chair, the same neighbours and the same light as its frame.

When a frame is made again, every shot cut from it needs its still again, and **Keyframes** counts them as missing. **⟳ still** on a shot that uses a whole frame gives the same frame back; make the frame again on its card instead. **+ shot** in a film with frames uses the last shot's frame.

## Sending a shot to Create and back

**Create ↗** opens Create for the camera, lens, light, palette and trained moves the Film tab doesn't have. Create gets the shot's keyframe sentence with the looks of who is in it and the place, its motion, its subject as who the camera is about, its keyframe as the first frame, and the film's genre.

A bar at the top of Create reads "Working on (title), shot (n)":

| Button | What it does |
|---|---|
| **Use the picked still** | The keyframe picked in Create becomes the shot's still. |
| **Use the last shot** | The last shot made in Create becomes the film's shot. |
| **done** | Closes the bar. |

Either button brings you back to Film. A still sent back clears the shot; a shot sent back clears its effects pass.

## Where things are kept

Plans are saved as you edit, in `ComfyUI/user/default/valis/films/<tag>.json`, where the tag is a short time-based id. A reload in the middle of a step keeps what is made.

Renders land in `ComfyUI/output/valis/`, named after the plan's tag, and every still, shot and song also goes into the bin:

| Files | What they are |
|---|---|
| `film_<tag>_plan_*.txt` | what Qwen3 wrote |
| `film_<tag>_ref_<name>_*.png` | a sheet |
| `film_<tag>_set_<name>_*.png` | a set's empty plate |
| `film_<tag>_frame_<name>_*.png` | a frame |
| `film_<tag>_song*` | YuE2's song, and its sheet music (`_abc`) |
| `film_<tag>_score*.json` | your own song's tempo and bars |
| `film_<tag>_key_<n>_*.png` | shot n's still |
| `film_<tag>_shot_<n>_*.mp4` | shot n |
| `film_<tag>_fx_<n>_*.mp4` | shot n with its effect and sound |
| `film_<tag>_film*.mp4` | the cut |

## Workflows and the CLI

| Workflow | Step |
|---|---|
| [`27_film_plan.json`](../../workflows/27_film_plan.json) | the plan |
| [`28_film_keyframes.json`](../../workflows/28_film_keyframes.json) | every shot's keyframe in one graph |
| [`03_shot_h3_i2v.json`](../../workflows/03_shot_h3_i2v.json) | one shot |
| [`29_film_cut.json`](../../workflows/29_film_cut.json) | the cut |

The whole chain runs headless through the same code:

```sh
node cli/valis.mjs film --idea "a lighthouse keeper rows out into the storm to bring back the woman the sea took" --genre gothic --shots 6
node cli/valis.mjs film --idea "..." --plan-only > plan.json
node cli/valis.mjs film --plan plan.json
```

`--plan-only` prints the plan as JSON so you can edit it; `--plan` makes the film from a plan, including one built from references. The genre is gothic unless you name another, and the film is saved to `./valis_out` (`--out` for another folder).

## Limits and tips

- Look at every still before you shoot. Re-roll it, edit its words, or take it to Create. A still takes seconds and a shot about 7 minutes.
- The planner writes no dialogue, and the cut doesn't keep the sound H3 made with a shot. The effects pass puts the song and the effects' sounds under every shot, so a line spoken in a shot doesn't reach the film.
- Your own song has no sheet music, so only **kick**, **snare**, **hat**, **beat** and **downbeat** have hits. A shot **on bar**, **on melody** or **on bass** has nothing to fire on.
- Time slip, Era cut, Tear, Double exposure and Split time open onto a second clip, and the Film tab doesn't give them one. Use them in the FX tab.
- To make a draft and then the film, shoot at 384, then set the size to native and shoot each shot again with **▶ shoot**. Shots already made keep their size.
- YuE2 writes at most 120 s, so very long films need your own song.
- Timings for every step on a 12 GB laptop are in the README's [timings table](../../README.md#timings-on-an-rtx-4080-laptop-12-gb-vram-32-gb-ram).
