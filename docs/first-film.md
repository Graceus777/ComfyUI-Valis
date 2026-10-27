# Your first film

This takes one line to a scored, cut short film in the Film tab, then puts new effects on it in the Score tab. It uses the line THE IRON SAINT was made from. Six shots take about an hour on a 12 GB laptop, and most of that is MiniMax H3 shooting, about 7 minutes a shot. The times below come from the README's [timings table](../README.md#timings-on-an-rtx-4080-laptop-12-gb-vram-32-gb-ram).

![THE IRON SAINT in the Film tab: its plan, its cast and place, and the shot cards](film.jpg)

## Before you start

Open **http://127.0.0.1:8188/valis** and click the **setup** pill in the top bar to see what each feature still needs. A film from one line needs the Qwen3-VL 8B encoder (the plan), YuE2 with the instrumental adapter and the Plenio pack (the song), Krea 2 (the stills), MiniMax H3 with the PDD-Acc pack (the shots) and SAM 3.1 (effects that follow someone). They are all in [install](install.md).

## 1. Say what the film is about

Press **0** for Film. Under **The film**, type:

> A black-armoured saint with a burning sword holds a broken bridge against an ash-wraith horde and a horned giant.

Then set the panel:

- **Genre**: Epic fantasy.
- **Shots, length and size**: 6 shots, **one clip**, native size (768×1344). THE IRON SAINT has 12 shots. A draft at 384 shoots much faster if you want a first look.
- **Song**: **YuE2 writes it**.

## 2. Plan it (about 2 minutes)

Press **Plan it**. Qwen3 writes a title, a logline, the cast, the place, a song brief and a line per shot: what the still shows, what moves, what to track, which effect fires on which lane. Read all of it now. Changing a word here costs nothing; changing it after the shots costs 7 minutes a shot.

THE IRON SAINT's plan shows what to aim for:

- The cast is named the way the shots name them: the knight, the wraiths, the giant. A look goes, with its name, into the still of every shot that names it.
- Each look is one exact sentence: "a tall woman knight in her thirties in battered black plate armour and a long tattered crimson cloak, close-cropped silver-white hair, a pale scar across her left cheek, one long straight longsword in her hands and nothing at her belt".
- A look line of its own replaces the genre's words: "Painted dark-fantasy illustration in the tradition of classic 1980s fantasy book covers: oil on canvas, rich impasto brushwork...". With a look line, every shot is also told to hold its light, unless its motion changes the light.
- The song brief ends with its tempo: "epic dark orchestral battle music, pounding war drums and taiko, low brass, wordless male choir, driving, 108 BPM".

Edit anything. Every field saves as you type.

## 3. The song (about 45 seconds)

Under **Steps**, press **run** on **Song**. YuE2 writes the sheet music and plays it, a little longer than the film. Listen to it with the player under the plan. The step then shows the tempo YuE2 played and how many bars each shot gets. THE IRON SAINT asked for 108 BPM and YuE2's sheet music came back at 106, so every shot is two bars, 4.53 s. For a different song, change the song brief and run **Song** again.

## 4. The stills

Run **Keyframes**. Krea 2 paints every shot's still in one job (Create's **Frame it** makes two in about 40 s). Look at every still before you shoot anything. Check each one for:

- the right people, and nobody in it twice
- the cast looking like their lines
- the framing the shot needs

For a still you don't want, press **⟳ still** on its card for a new seed, or edit its words first. A still that needs a lens, a light or a palette goes to Create with **Create ↗**; make it there and send it back with **Use the picked still**.

## 5. The shots (about 7 minutes each)

Press **▶ shoot** on shot 1 and watch it before you shoot the rest. It tells you whether the motion lines work. Then run **Shots** for the others, about 35 minutes for five. Look at every shot. For one whose motion came apart, press **▶ shoot** again for a new take, or tick **full quality (int8, 30 steps)** and shoot it again (about 20 minutes).

## 6. The effects (about a minute a shot)

Each card has a **subject**, an effect and a lane. Qwen3 picked them; change any. The planner's own guide is a good start: Firelight on beat for a fire off-screen, Glint on downbeat for a blade, Shockwave or Punch on downbeat for an impact, and no effect for a quiet shot. Untick **keep the keyframe's colours** on a shot whose light should change. In THE IRON SAINT's shot 2, fire races up the blade and lights her face.

Run **Effects**. The library runs on the CPU at about a minute per 4 s of video, and SAM 3 adds about 35 s when an effect follows the subject (2.5 minutes the first time, while it loads). Look at each "with effects" picture.

## 7. The cut

Run **Cut**. Every shot is trimmed to its bars and joined on the song, and a title card closes it. The film plays in the viewer, goes into the bin, and is saved in `ComfyUI/output/valis/` as `film_<tag>_film_00001_.mp4`. **Upscale** under it makes a 1080p copy with SeedVR2, about 7 minutes per 5 s.

Once the stills are right, **Make the rest** runs the shots, the effects and the cut in one go. The plan is saved as you work, and a reload keeps everything already made. The film is under **Recent** when you come back.

## 8. Score it again (optional)

The Score tab puts a new set of effects on the same song and plays them live before anything renders.

1. Press **3** for Score. Under **From a song**, drag the film's song from the bin (it is labelled Film · song) onto the drop zone, and press **Make the score**.
2. Under **Start from**, pick **Fire**: firelight on the beat, heat haze on the bar, a glint on the downbeats.
3. In **Shots**, pick each shot's clip from its select: Film · shot 1, Film · shot 2, and so on. Pick these raw shots; the Film · effects passes already carry the Film tab's effects.
4. Press **▶ Play**. The preview plays your shots on the song with every effect sketched as it fires. Change the rules until it reads right.
5. Press **Render all** (about a minute a shot), type the title in **End card title (optional)**, and press **Cut it**.

The song runs a few seconds past the film, so the score may have one shot more than the film. Leave it empty, and the end card plays over the rest of the song. The Score tab finds the bars by listening to the song, so its shots may not start on exactly the same frames as the Film tab's cut.

## Next

- [Film](guides/film.md): every control, building a film from references so the same people stay in the same places, and where everything is kept.
- [Score](guides/score.md): lanes, rule sets, cue sheets and the classic engine.
