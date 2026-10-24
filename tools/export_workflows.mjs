// Writes workflows/*.json: every graph the studio sends, in ComfyUI API format, with example inputs.
// Load one in ComfyUI (drag it onto the canvas), point the Load nodes at your own files, and queue it.
//   node tools/export_workflows.mjs
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import * as G from "../app/js/graphs.js";
import * as P from "../app/js/presets.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "workflows");
fs.mkdirSync(out, {recursive: true});

const vamp = P.LOOKS.find(l => l.id === "vampire");
const T = "his head";
const flows = {
  "01_keyframes_krea2": [G.keyframes({prompt: P.keyframePrompt({genre: P.GENRES[0], framing: P.FRAMING[0], lens: P.LENS[0], light: P.LIGHT[0], grade: P.GRADE[0],
    subject: "a pale woman in a white silk ballgown and a tall pale man in a black velvet tailcoat, frozen mid-waltz in an abandoned gothic ballroom at midnight"})}),
    "Create · Frame it: two Krea 2 turbo keyframes from the director's panel prompt."],
  "02_cast_character_krea2": [G.castCharacter({keyframe: "valis/keyframe.png", character: "valis/character.png",
    prompt: "Put the character from the second image into the first image in place of the man, same pose, same light."}),
    "Create · cast a character: Krea 2 identity edit pulls a character sheet into a keyframe."],
  "03_shot_h3_i2v": [G.shot({image: "valis/keyframe.png", motion: P.motionPrompt({genre: P.GENRES[0], move: P.MOVES[0], action: "they turn slowly in the waltz hold"})}),
    "Create · Shoot it: MiniMax H3 image-to-video (PDD 8-step), 4.5 s."],
  "04_find_sam3": [G.maskPreview({video: "valis/clip.mp4", target: T}),
    "Edit · Find it: SAM 3 tracks the named target; saves the matte and an overlay preview."],
  "05_transform_vampire": [G.edit({mode: "transform", video: "valis/clip.mp4", target: T, anchorPrompt: vamp.anchor.replaceAll("{T}", T), desc: vamp.desc,
    who: vamp.who, keep: vamp.keep, refBoost: vamp.rb}),
    "Edit · Transform: SAM 3 track, Krea 2 first/last anchors, MiniMax H3 ref2va masked re-render, uncrop."],
  "06_remove_qwen": [G.edit({mode: "remove", video: "valis/clip.mp4", target: "the man in the mirror", anchorPrompt: P.REMOVE_PROMPT.replaceAll("{T}", "the man in the mirror"),
    desc: "gone; only the mirror's reflection of the room remains", who: "the masked region", keep: "the room behind it"}),
    "Edit · Remove: as Transform, with Qwen Image 2.1 clean-plate anchors."],
  "07_swap_character_h3": [G.swapFull({video: "valis/take.mp4", character: "valis/character_sheet.png", prompt: G.swapPrompt({target: "the man"}),
    background: "valis/new_background.png", turbo: true}),
    "Edit · Swap: full character swap (H3 ref2va + character-swap LoRA + turbo LoRA, 8 steps) after a SAM 3 background replacement."],
  "08_turn_on_a_word": [G.turn({a: "valis/take.mp4", b: "valis/take_swapped.mp4"}),
    "Edit · Turn: Valis scores the voice track (syllable onsets) and ignites the swapped take from the eyes on the chosen word."],
  "09_valis_score_pass": [G.valisShot({clip: "valis/shot.mp4", score: "valis/danse_v3_score.json", startBar: 52, section: "finale", layer: "valis/shot_transformed.mp4",
    rules: [{event: "impact", effect: "halo"}, {event: "kick", effect: "ignite"}, {event: "stroke", effect: "shockwave"}], targetA: "the man"}),
    "Score · Render with Valis: the score's event map drives the reveal, shockwaves, halo and light on one 4-bar shot."],
  "10_fx_library_cue_sheet": [G.fx({clip: "valis/clip.mp4", other: "valis/other_clip.mp4", subject: "the woman", source: "sheet", cueSheet: G.CUE_SHEET_EXAMPLE,
    layers: [{effect: "DoubleExposure", on: "beat"}, {effect: "TimeSlip", on: "downbeat", params: {mode: "burn", era: "daguerreotype"}}, {effect: "Projector", on: "beat"}],
    beds: ["room"], sound: true, seconds: 4.46, prefix: "valis/fx"}),
    "FX · the library on a soundless cue sheet: a SAM silhouette as a window onto another clip, a time-slip burn, projector flicker, each with its own sound."],
  "11_fx_new_song_yue2": [G.fx({clip: "valis/clip.mp4", source: "write", songSpec: {style: "dark cabaret waltz, accordion, upright bass, female vocal", lyrics: "[Instrumental]", seconds: 20},
    layers: [{effect: "Punch", on: "kick"}, {effect: "Echo", on: "melody"}], subject: "the dancer", beds: [], sound: true, seconds: 4.46, prefix: "valis/fx_song"}),
    "FX · New song: YuE2 writes the sheet music and performs it; Valis aligns the sheet to the audio and fires effects on its notes."],
  "12_swap_matched_to_plate": [G.swapFull({video: "valis/take.mp4", character: "valis/character_sheet.png", prompt: G.swapPrompt({target: "the man"}), turbo: true, match: true}),
    "Edit · Swap with the plate match: the take is checked against the sheet (report saved as text), the sheet is pre-graded, and the swapped person is matched back to the plate, no AI."],
  "13_turn_with_voice": [G.turn({a: "valis/take.mp4", b: "valis/take_swapped.mp4", voice: true}),
    "Edit · Turn with the voice: the face and the voice turn on the same word (Valis pitch and formant shift, sub-octave, growl)."],
  // the Higgsfield rebuilds: Genjutsu and Cinema Studio on open weights
  "14_genjutsu_motion_transfer": [G.genjutsu({video: "valis/performance.mp4", refs: ["valis/new_character.png", "valis/new_place.png"], mode: "motion",
    prompt: P.genjutsuPrompt({mode: "motion", refs: [{role: "dancer"}, {role: "location"}], text: "she dances on a lamplit porch at night"})}),
    "Genjutsu · Motion transfer: SDPose skeletons of the source drive H3 ref2va through the Fun ControlNet Union; the references are the new cast and place; the source audio is kept."],
  "15_genjutsu_restyle": [G.genjutsu({video: "valis/clip.mp4", mode: "restyle", prompt: P.genjutsuPrompt({mode: "restyle", style: P.GENJUTSU_STYLES?.[0] || null, text: "claymation"})}),
    "Genjutsu · Restyle: Canny edges keep the motion, the whole clip is re-rendered in a new look."],
  "16_genjutsu_object_swap": [G.genjutsu({video: "valis/clip.mp4", mode: "swap", control: "pose", target: "red robe", cn: G.MODELS.funCN2,
    prompt: P.genjutsuPrompt({mode: "swap", target: "The red robe", text: "a flowing robe of liquid gold"})}),
    "Genjutsu · Object swap: SAM 3 finds the named object, the Fun ControlNet Union 2.0 inpaints only it, and Valis Swap Match puts it back on the untouched plate."],
  "17_cinema_trained_orbit_h3": [G.orbit360({image: "valis/keyframe.png", loras: [{name: P.CAMERA_LORAS.orbit_360.lora, strength: 1}], raw: P.CAMERA_LORAS.orbit_360.raw({})}),
    "Cinema Studio · 360 orbit: H3 with a camera LoRA trained on the move, one 8.8 s shot pinned back to its own first frame (shorter, it swings out and back), the arrival hold trimmed."],
  "18_cinema_trained_crash_zoom_wan": [G.wanMove({image: "valis/keyframe.png", move: P.CAMERA_LORAS.crash_zoom_in, strength: P.CAMERA_LORAS.crash_zoom_in.strength,
    subject: "the woman", scene: "Night on a misty riverbank under a full moon."}),
    "Cinema Studio · crash zoom: Wan 2.2 I2V A14B, lightx2v 4-step, the crash-zoom LoRA on the high-noise expert."],
  "19_cinema_dolly_zoom": [G.shot({image: "valis/keyframe.png", motion: "", loras: [{name: P.CAMERA_LORAS.dolly_zoom_in.lora, strength: 1}],
    raw: P.CAMERA_LORAS.dolly_zoom_in.raw({subject: "the woman"}), dolly: {target: "woman", ...P.CAMERA_LORAS.dolly_zoom_in.dolly}}),
    "Cinema Studio · dolly zoom: a trained push-in, SAM 3 tracks the subject, Valis Dolly Zoom re-frames every frame so the subject holds its size."],
  "20_cinema_extend": [G.extend({video: "valis/shot.mp4", clipSeconds: 5.17, width: 768, height: 1344, action: "she turns toward the river"}),
    "Cinema Studio · Extend: the clip's last frames anchor a new H3 shot (MiniMaxH3AddGuide); picture and sound are joined."],
  "21_finish_upscale": [G.upscale({video: "valis/shot.mp4"}),
    "Finish · Upscale: SeedVR2 3B Q8 with tiled VAE and CPU offload (fits 12 GB), keeps the sound."],
  "22_cinema_whip_pan": [G.shot({image: "valis/keyframe.png", seconds: 5, whip: P.CAMERA_LORAS.whip_pan.whip,
    motion: P.CAMERA_LORAS.whip_pan.words.replaceAll("{subject}", "the woman") + " One continuous shot, no cuts, no text."}),
    "Cinema Studio · whip pan: H3 shoots a steady real pan; Valis Whip Pan speed-ramps it into a whip with the camera's own motion blur and lands back on the subject."],
  "23_genjutsu_source_check": [G.poseCheck({video: "valis/performance.mp4"}),
    "Genjutsu · source check before Motion Transfer: SDPose keypoints only (about a minute); Valis Pose Check reports where the body can't be read and the best window to render."],
  "24_cinema_relight_keyframe": [G.relightImage({image: "valis/keyframe.png", prompt: `Relight this photo: ${P.RELIGHT[0].words}.${P.RELIGHT_KEEP}`}),
    "Cinema Studio · Relight: Qwen Image 2.1 edit relights a keyframe (same people, pose and place; new light). Ten presets in the app."],
  "25_cinema_light_change": [G.shot({image: "valis/keyframe.png", last: "valis/keyframe_relit.png",
    motion: "The scene holds still while the light slowly changes: an orange fire glow rises and floods everything. One continuous shot, no cuts, no text."}),
    "Cinema Studio · light change: H3 first/last frame from a keyframe to its relit version, so the light shifts during the shot (BURN SEASON trailer 2: the fire reaching the town)."],
  "26_transform_vampire_fasth3": [G.edit({mode: "transform", video: "valis/clip.mp4", target: T, anchorPrompt: vamp.anchor.replaceAll("{T}", T), desc: vamp.desc,
    who: vamp.who, keep: vamp.keep, refBoost: vamp.rb, engine: "fast"}),
    "Edit · Transform on FastH3 OmniRef (Renders · Engine): workflow 05 with the 8-step distilled ref2va (FastVideo/FastH3-Omni-Comfy), PDD block sigmas, euler, shift 12/3."],
  "27_film_plan": [G.filmPlan({idea: "a lighthouse keeper rows out into the storm to bring back the woman the sea took", shots: 6, genre: P.GENRES[0]}),
    "Film · plan: ComfyUI's own text generation on the Qwen3-VL 8B encoder (the one Qwen Image uses) writes the shot list and the song brief as JSON; the Film tab and `valis film` run the rest of the chain from it."],
  "28_film_keyframes": [G.filmKeyframes({prompts: ["Wide shot: a lighthouse keeper rowing out into a storm, moonlight through mist.", "Close shot: the keeper's face, candlelight in his eyes, rain."], prefix: "valis/film_key"}),
    "Film · keyframes: every shot's Krea 2 keyframe in one graph (the model loads once)."],
  "29_film_cut": [G.filmCut({shots: [{file: "valis/film_fx_1.mp4", seconds: 4.444}, {file: "valis/film_fx_2.mp4", seconds: 4.444}], prefix: "valis/film"}),
    "Film · cut: each shot trimmed to whole bars of the song and joined, carrying its own slice of the song and its sounds."],
  "30_loop_h3": [G.loopShot({image: "valis/keyframe.png", prompt: G.loopPrompt({subject: "a lighthouse keeper stands at the lamp room window at night",
    action: "The great lamp turns behind him in a slow, steady circle, its beam sweeping across the sea; rain streaks the glass evenly."})}),
    "Create · Loop: a shot that plays forever. MiniMax H3 Loop (pxl-pshr's pack) has H3 join the clip's end to its start while it samples and decodes; the keyframe is the reference. MP4 with sound, and a GIF (Valis Loop · Save)."],
  "31_fx_on_a_loop": [G.fx({clip: "valis/loop.mp4", source: "sheet", sound: false, loop: true,
    cueSheet: "bpm 112.94 4/4\nevery 1 beat from 0 to 20 kick\nevery 1/2 beat from 0 to 20 hat\nevery 1 bar from 0 to 20 downbeat",
    layers: [{effect: "Shockwave", on: "downbeat"}, {effect: "Punch", on: "kick"}, {effect: "Glitch", on: "hat"}, {effect: "Projector", on: "kick"}], prefix: "valis/fx_loop"}),
    "FX · on a loop: Valis Loop · Render plays the stack once round before the loop so every effect arrives at frame 0 as it would the second time, with the cues repeating every loop (2 bars at 112.94 BPM = one 4.25 s loop). MP4 and GIF."],
  "32_stereo_hidden_in_noise": [G.stereo({video: "valis/clip.mp4", target: "the dancers", maxObjects: 2}),
    "Stereo · hidden in noise (the Black Is Good magic-eye video, from any clip): SAM 3 + Depth Anything 3 give the dancers a rounded depth, a spinning torus joins them, Valis Stereogram hides both in TV snow you free-view (parallel); Valis Kinetogram makes the version only motion shows, in live static; Valis Stereo Decode reads the depth back after H.264 capped at 4 Mb/s and scores it."],
};

const index = [];
for (const [name, [graph, what]] of Object.entries(flows)) {
  fs.writeFileSync(path.join(out, `${name}.json`), JSON.stringify(graph, null, 2) + "\n");
  const loads = Object.values(graph).filter(n => /^Load(Image|Video|Audio)$|^ValisScoreLoad$/.test(n.class_type))
    .map(n => n.inputs.image || n.inputs.file || n.inputs.audio || n.inputs.score);
  index.push(`| \`${name}.json\` | ${what} | ${[...new Set(loads)].map(f => "`" + f + "`").join(", ") || "none"} |`);
}
fs.writeFileSync(path.join(out, "README.md"), `# Workflows

Every graph the Valis studio sends, exported in ComfyUI **API format** by \`tools/export_workflows.mjs\` (the studio builds
them in \`app/js/graphs.js\`). Drag one onto the ComfyUI canvas, point its Load nodes at your own files in
\`ComfyUI/input\`, and queue it. Or run them headless with the Comfy SDK: \`node cli/valis.mjs\`.

02, 05 and 26 name the Krea 2 identity-edit LoRA the way Windows lists it, \`Krea2\\krea2_identity_edit_v1_2_r64.safetensors\`;
on Linux and macOS pick \`Krea2/...\` in its LoRA loader. The studio and the CLI do this for you.

| File | What it does | Inputs to replace |
|---|---|---|
${index.join("\n")}
`);
console.log(`wrote ${index.length} workflows to ${out}`);
