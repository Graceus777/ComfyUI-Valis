# Workflows

Every graph the Valis studio sends, exported in ComfyUI **API format** by `tools/export_workflows.mjs` (the studio builds
them in `app/js/graphs.js`). Drag one onto the ComfyUI canvas, point its Load nodes at your own files in
`ComfyUI/input`, and queue it. Or run them headless with the Comfy SDK: `node cli/valis.mjs`.

| File | What it does | Inputs to replace |
|---|---|---|
| `01_keyframes_krea2.json` | Create · Frame it: two Krea 2 turbo keyframes from the director's panel prompt. | none |
| `02_cast_character_krea2.json` | Create · cast a character: Krea 2 identity edit pulls a character sheet into a keyframe. | `valis/keyframe.png`, `valis/character.png` |
| `03_shot_h3_i2v.json` | Create · Shoot it: MiniMax H3 image-to-video (PDD 8-step), 4.5 s. | `valis/keyframe.png` |
| `04_find_sam3.json` | Edit · Find it: SAM 3 tracks the named target; saves the matte and an overlay preview. | `valis/clip.mp4` |
| `05_transform_vampire.json` | Edit · Transform: SAM 3 track, Krea 2 first/last anchors, MiniMax H3 ref2va masked re-render, uncrop. | `valis/clip.mp4` |
| `06_remove_qwen.json` | Edit · Remove: as Transform, with Qwen Image 2.1 clean-plate anchors. | `valis/clip.mp4` |
| `07_swap_character_h3.json` | Edit · Swap: full character swap (H3 ref2va + character-swap LoRA + turbo LoRA, 8 steps) after a SAM 3 background replacement. | `valis/take.mp4`, `valis/character_sheet.png`, `valis/new_background.png` |
| `08_turn_on_a_word.json` | Edit · Turn: Valis scores the voice track (syllable onsets) and ignites the swapped take from the eyes on the chosen word. | `valis/take.mp4`, `valis/take_swapped.mp4` |
| `09_valis_score_pass.json` | Score · Render with Valis: the score's event map drives the reveal, shockwaves, halo and light on one 4-bar shot. | `valis/shot.mp4`, `valis/shot_transformed.mp4`, `valis/danse_v3_score.json` |
| `10_fx_library_cue_sheet.json` | FX · the library on a soundless cue sheet: a SAM silhouette as a window onto another clip, a time-slip burn, projector flicker, each with its own sound. | `valis/clip.mp4`, `valis/other_clip.mp4` |
| `11_fx_new_song_yue2.json` | FX · New song: YuE2 writes the sheet music and performs it; Valis aligns the sheet to the audio and fires effects on its notes. | `valis/clip.mp4` |
| `12_swap_matched_to_plate.json` | Edit · Swap with the plate match: the take is checked against the sheet (report saved as text), the sheet is pre-graded, and the swapped person is matched back to the plate, no AI. | `valis/take.mp4`, `valis/character_sheet.png` |
| `13_turn_with_voice.json` | Edit · Turn with the voice: the face and the voice turn on the same word (Valis pitch and formant shift, sub-octave, growl). | `valis/take.mp4`, `valis/take_swapped.mp4` |
| `14_genjutsu_motion_transfer.json` | Genjutsu · Motion transfer: SDPose skeletons of the source drive H3 ref2va through the Fun ControlNet Union; the references are the new cast and place; the source audio is kept. | `valis/performance.mp4`, `valis/new_character.png`, `valis/new_place.png` |
| `15_genjutsu_restyle.json` | Genjutsu · Restyle: Canny edges keep the motion, the whole clip is re-rendered in a new look. | `valis/clip.mp4` |
| `16_genjutsu_object_swap.json` | Genjutsu · Object swap: SAM 3 finds the named object, the Fun ControlNet Union 2.0 inpaints only it, and Valis Swap Match puts it back on the untouched plate. | `valis/clip.mp4` |
| `17_cinema_trained_orbit_h3.json` | Cinema Studio · 360 orbit: H3 with a camera LoRA trained on the move, one 8.8 s shot pinned back to its own first frame (shorter, it swings out and back), the arrival hold trimmed. | `valis/keyframe.png` |
| `18_cinema_trained_crash_zoom_wan.json` | Cinema Studio · crash zoom: Wan 2.2 I2V A14B, lightx2v 4-step, the crash-zoom LoRA on the high-noise expert. | `valis/keyframe.png` |
| `19_cinema_dolly_zoom.json` | Cinema Studio · dolly zoom: a trained push-in, SAM 3 tracks the subject, Valis Dolly Zoom re-frames every frame so the subject holds its size. | `valis/keyframe.png` |
| `20_cinema_extend.json` | Cinema Studio · Extend: the clip's last frames anchor a new H3 shot (MiniMaxH3AddGuide); picture and sound are joined. | `valis/shot.mp4` |
| `21_finish_upscale.json` | Finish · Upscale: SeedVR2 3B Q8 with tiled VAE and CPU offload (fits 12 GB), keeps the sound. | `valis/shot.mp4` |
| `22_cinema_whip_pan.json` | Cinema Studio · whip pan: H3 shoots a steady real pan; Valis Whip Pan speed-ramps it into a whip with the camera's own motion blur and lands back on the subject. | `valis/keyframe.png` |
| `23_genjutsu_source_check.json` | Genjutsu · source check before Motion Transfer: SDPose keypoints only (about a minute); Valis Pose Check reports where the body can't be read and the best window to render. | `valis/performance.mp4` |
| `24_cinema_relight_keyframe.json` | Cinema Studio · Relight: Qwen Image 2.1 edit relights a keyframe (same people, pose and place; new light). Ten presets in the app. | `valis/keyframe.png` |
| `25_cinema_light_change.json` | Cinema Studio · light change: H3 first/last frame from a keyframe to its relit version, so the light shifts during the shot (BURN SEASON trailer 2: the fire reaching the town). | `valis/keyframe.png`, `valis/keyframe_relit.png` |
| `26_transform_vampire_fasth3.json` | Edit · Transform on FastH3 OmniRef (Renders · Engine): workflow 05 with the 8-step distilled ref2va (FastVideo/FastH3-Omni-Comfy), PDD block sigmas, euler, shift 12/3. | `valis/clip.mp4` |
| `27_film_plan.json` | Film · plan: ComfyUI's own text generation on the Qwen3-VL 8B encoder (the one Qwen Image uses) writes the shot list and the song brief as JSON; the Film tab and `valis film` run the rest of the chain from it. | none |
| `28_film_keyframes.json` | Film · keyframes: every shot's Krea 2 keyframe in one graph (the model loads once). | none |
| `29_film_cut.json` | Film · cut: each shot trimmed to whole bars of the song and joined, carrying its own slice of the song and its sounds. | `valis/film_fx_1.mp4`, `valis/film_fx_2.mp4` |
