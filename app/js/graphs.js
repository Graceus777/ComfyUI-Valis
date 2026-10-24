// Graph builders. Every graph here is one that rendered DANSE MACABRE (see the repo's danse notes):
//   keyframe  Krea 2 turbo text-to-image (clean, cinematic; 10 steps, cfg 1)
//   shot      MiniMax H3 fl2va image-to-video, PDD 8-step acceleration
//   transform SAM 3 track -> MVEx crop -> Krea 2 identity-edit anchors (first/last) -> H3 ref2va masked re-render -> uncrop
//   remove    the same, with Qwen Image 2.1 edit anchors ("remove the man from the mirror")
//   mask      SAM 3 track -> cleanup -> mask video + an overlay preview
import {withRefEngine, FAST_REF} from "./refengine.js";   // the ref2va engine switch (base | fast)
// A model file in a subfolder is spelled here with a Windows separator (Krea2\...); ComfyUI on Linux and macOS lists it
// with "/". Before a graph goes out, a name the server only spells with the other slash takes the server's spelling.
// inputsOf(node) resolves to that node's /object_info inputs.
export async function respell(graph, inputsOf) {
  for (const n of Object.values(graph)) {
    for (const [k, v] of Object.entries(n.inputs || {})) {
      if (typeof v !== "string" || !v.includes("\\")) continue;
      const ins = await inputsOf(n.class_type);
      const def = ins.required?.[k] || ins.optional?.[k];
      const opts = Array.isArray(def?.[0]) ? def[0] : def?.[1]?.options || [];
      const unix = v.replace(/\\/g, "/");
      if (!opts.includes(v) && opts.includes(unix)) n.inputs[k] = unix;
    }
  }
  return graph;
}

export const MODELS = {
  krea: "krea2_turbo_fp8_scaled.safetensors", kreaTE: "qwen3vl_4b_fp8_scaled.safetensors", kreaVAE: "qwen_image_vae.safetensors",
  kreaLora: "Krea2\\krea2_identity_edit_v1_2_r64.safetensors",
  h3i2v: "minimax_h3_fl2va_pruned_w4a8_mixed.safetensors", h3ref: "minimax_h3_ref2va_pruned_int8_convrot.safetensors",
  h3refFast: FAST_REF,      // FastH3 OmniRef: ref2va distilled to 8 steps (refengine.js)
  h3TE: "qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors", h3VAE: "minimax_h3_video_vae_fp16.safetensors",
  h3AVAE: "minimax_h3_audio_vae_fp32.safetensors", pdd: "MiniMax-H3-FL2VA-Acc-8Step.safetensors",
  qwen: "qwen_image_2.1-Q6_K.gguf", qwenTE: "qwen3vl_8b_w4a8.safetensors", qwenVAE: "qwen_image_2.1_vae_bf16.safetensors",
  sam: "sam3.1_multiplex_fp16.safetensors",
  da3: "depth_anything_3_small.safetensors",
  llm: "qwen3vl_8b_w4a8.safetensors",                 // the film planner: ComfyUI's text generation on Qwen Image's own encoder
  funCN: "minimax_h3_fun_controlnet_union_pruned_int8_convrot.safetensors",
  funCN2: "minimax_h3_fun_controlnet_union_2.0_pruned_int8_convrot.safetensors",   // 10 control blocks; inpaint holes at mid-grey
  sdpose: "sdpose_wholebody_fp16.safetensors", detr: "rt_detr_v4-x-hgnet_fp16.safetensors",
  wanHigh: "wan2.2_i2v_high_noise_14B_fp8_scaled.safetensors", wanLow: "wan2.2_i2v_low_noise_14B_fp8_scaled.safetensors",
  wanTE: "umt5_xxl_fp8_e4m3fn_scaled.safetensors", wanVAE: "wan_2.1_vae.safetensors",
  wanFastHigh: "wan2.2_i2v_lightx2v_4steps_lora_v1_high_noise.safetensors", wanFastLow: "wan2.2_i2v_lightx2v_4steps_lora_v1_low_noise.safetensors",
};
const N = (class_type, inputs) => ({class_type, inputs});
const frames24 = (sec) => { const n = Math.round(sec * 24); return Math.max(22, Math.round((n - 5) / 17) * 17 + 5); };  // H3: 17k+5
export { frames24 };

// ---------------------------------------------------------------- keyframes
// loras: [{name, strength}] style LoRAs on Krea 2 (THE FOURTEENTH SHELL's look: Krea2\\V1 at 0.8, prompts that start
// "Graphic novel panel." and say nothing else about style)
export function keyframes({prompt, width = 768, height = 1344, seeds = [7101, 7202], prefix = "valis/key", loras = []}) {
  const g = {
    "1": N("UNETLoader", {unet_name: MODELS.krea, weight_dtype: "default"}),
    "2": N("CLIPLoader", {clip_name: MODELS.kreaTE, type: "krea2", device: "default"}),
    "3": N("VAELoader", {vae_name: MODELS.kreaVAE}),
    "4": N("EmptySD3LatentImage", {width, height, batch_size: 1}),
    "10": N("CLIPTextEncode", {text: prompt, clip: ["2", 0]}),
    "11": N("ConditioningZeroOut", {conditioning: ["10", 0]}),
  };
  loras.forEach((l, k) => { g[`lo${k}`] = N("LoraLoaderModelOnly", {model: k ? [`lo${k - 1}`, 0] : ["1", 0], lora_name: l.name, strength_model: l.strength ?? 1.0}); });
  const model = loras.length ? [`lo${loras.length - 1}`, 0] : ["1", 0];
  seeds.forEach((seed, k) => {
    const b = 100 + 10 * k, i = (j) => String(b + j);
    g[i(0)] = N("KSampler", {model, positive: ["10", 0], negative: ["11", 0], latent_image: ["4", 0], seed, steps: 10, cfg: 1.0, sampler_name: "euler", scheduler: "simple", denoise: 1.0});
    g[i(1)] = N("VAEDecode", {samples: [i(0), 0], vae: ["3", 0]});
    g[i(2)] = N("SaveImage", {images: [i(1), 0], filename_prefix: `${prefix}_${seed}`});
  });
  return g;
}

// A character reference pulled into a finished keyframe (Krea 2 identity edit, subject as the 2nd reference).
export function castCharacter({keyframe, character, prompt, refBoost = 1.0, prefix = "valis/cast"}) {
  const g = kreaLoaders();
  g["10"] = N("LoadImage", {image: keyframe});
  g["11"] = N("LoadImage", {image: character});
  Object.assign(g, kreaEdit(300, ["10", 0], prompt, 31, prefix, refBoost, ["11", 0]));
  return g;
}

// ---------------------------------------------------------------- shots
export function shot(opts) {
  const g = shotGraph(opts);
  if (g["__last"]) { g["6"].inputs.last_frame = g["__last"]; delete g["__last"]; }
  return g;
}
// A keyframe with a flaw the shot would carry (a second pair of hands, a stray figure, a palm under a hot coffee pot) is
// cleaned by a Qwen Image 2.1 edit in the shot's own job: the edit becomes the first frame, saved as `prefix` to check.
export function fixKeyframe(g, {image, prompt, seed = 808, prefix = "valis/key_fix"}) {
  const e = relightImage({image, prompt, seed, prefix});
  for (const k of Object.keys(e)) if (g[k]) throw new Error(`fixKeyframe: node id ${k} is already in the shot`);
  Object.assign(g, e);
  g["fs"].inputs.image = ["303", 0];
  return g;
}
// loras: [{name, strength}] on the H3 model (camera-move LoRAs); raw: the whole prompt as the LoRA was trained on it
// (trigger word first, no H3 section headers).
function shotGraph({image, motion, width = 768, height = 1344, seconds = 4.46, seed = 51101, prefix = "valis/shot", soundscape, look = null, end = null, last = null, trimHold = false,
                    loras = [], raw = null, dolly = null, whip = null}) {
  const head = "For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.\n\nintegrated_multimodal_description:\n[Shot 1] ";
  const sound = `\n\noverall_soundscape:\n${soundscape || "Quiet room tone, soft natural ambience."}\n\nnon_diegetic_music:\nN/A`;
  // a trained move's prompt (raw) has no sound direction, and H3 then invents a score under the shot: give it the place's sound
  const rawSound = `\n\noverall_soundscape:\n${soundscape || "Only the natural sound of the place in the picture."}\n\nnon_diegetic_music:\nN/A`;
  // post steps in order: trim the anchored hold -> dolly lock -> whip ramp -> colour palette
  const th = trimHold ? ["th", 0] : ["12", 0], dz = dolly ? ["dz", 0] : th, wp = whip ? ["wp", 0] : dz, pal = look ? ["pal", 0] : wp;
  return {
    "1": N("UNETLoader", {unet_name: MODELS.h3i2v, weight_dtype: "default"}),
    "2": N("CLIPLoader", {clip_name: MODELS.h3TE, type: "minimax", device: "default"}),
    "3": N("VAELoader", {vae_name: MODELS.h3VAE}),
    "fa": N("LoadImage", {image}),
    "fs": N("ImageScale", {image: ["fa", 0], upscale_method: "lanczos", width, height, crop: "center"}),
    "6": N("MiniMaxH3ImageToVideo", {clip: ["2", 0], vae: ["3", 0], prompt: raw ? raw + rawSound : (head + motion + " One continuous shot, no cuts, no text." + sound), width, height, length: frames24(seconds), first_frame: ["fs", 0]}),
    ...Object.fromEntries(loras.map((l, i) => [`lo${i}`, N("LoraLoaderModelOnly", {model: i ? [`lo${i - 1}`, 0] : ["1", 0], lora_name: l.name, strength_model: l.strength ?? 1.0})])),
    "16": N("MiniMaxH3SigmaShift", {model: loras.length ? [`lo${loras.length - 1}`, 0] : ["1", 0], shift_video: 12.0, shift_audio: 3.0}),
    "10": N("BasicScheduler", {model: ["16", 0], scheduler: "simple", steps: 8, denoise: 1.0}),
    "acc": N("MiniMaxH3PDDAccApply", {model: ["16", 0], pdd_file: MODELS.pdd, nfe: "8", lora_strength: 1.0, head_strength: 1.0, on_off_grid: "error", enabled: true, partition: "", partition_check: "error", bypass_sigmas: ["10", 0]}),
    "7": N("BasicGuider", {model: ["acc", 0], conditioning: ["6", 0]}),
    "8": N("RandomNoise", {noise_seed: seed}),
    "9": N("KSamplerSelect", {sampler_name: "euler"}),
    "11": N("SamplerCustomAdvanced", {noise: ["8", 0], guider: ["7", 0], sampler: ["9", 0], sigmas: ["acc", 1], latent_image: ["6", 1]}),
    "12": N("VAEDecode", {samples: ["11", 0], vae: ["3", 0]}),
    // H3 makes the sound in the same latent as the picture (voices, room, fire): decode it and keep it with the shot
    "av": N("VAELoader", {vae_name: MODELS.h3AVAE}),
    "ad": N("VAEDecodeAudio", {samples: ["11", 0], vae: ["av", 0]}),
    "13": N("CreateVideo", {images: pal, fps: 24.0, audio: ["ad", 0]}),
    "14": N("SaveVideo", {video: ["13", 0], filename_prefix: prefix, format: "auto", codec: "auto"}),
    // a pinned end makes H3 arrive early and hold that still: keep a quarter second of the hold, cut the rest
    ...(trimHold ? {"th": N("ValisTrimHold", {images: ["12", 0], keep: 6, threshold: 1.0})} : {}),
    ...(dolly ? dollyZoom(th, dolly) : {}),
    // whip pan: the shot is a steady real pan; Valis Whip Pan speed-ramps it into a whip with the camera's own motion blur
    ...(whip ? {"wp": N("ValisWhipPan", {images: dz, fps: 24.0, mode: whip.mode || "return", speed: whip.speed || 0, smear: whip.smear || 0.15, shutter: whip.shutter || 1.0})} : {}),
    ...(look ? {"pal": N("ValisColorPalette", {images: wp, look, strength: 1.0})} : {}),
    ...endAnchor({end, last, width, height, prefix}),
  };
}
// A full 360 orbit with the orbit LoRA.
// "loop" (default): one H3 shot pinned back to its own first frame, 8.8 s. At 4.5 s the LoRA swings a quarter turn out and
//   comes back the same way (BURN SEASON 3, BLUE RIBBON, OCCUPIED, Oct 22); at 8 s it went all the way round (levee, Oct 19).
// Every mode needs a figure standing clear in open space. With the subject leaning over a table (BLUE RIBBON b01) the 8.8 s
//   shot arcs a quarter turn and then fades in a second copy of her to fake the rest; a room with a couch fails the same way.
// "halves": keyframe -> the view from behind (Qwen Image 2.1 edit) -> keyframe, two shots joined. Went round on BURN SEASON
//   s09 (a figure alone in a field); a half turn has two equal ways round, so the second half can come back the way it went.
// Tried and dropped: four quarters through three Qwen side views. Qwen turns the subject round on the spot instead of moving
//   the camera (and with something between camera and subject, barely changes the picture), so H3 spun the subject.
// H3 eases into every pinned frame: an even pace through the whole turn is an edit (re-time by the measured camera motion).
const ORBIT_KEEP = " Keep every person, their pose, face, clothes and everything they hold, and every object in the scene exactly the same; change only the viewpoint.";
export const ORBIT_BEHIND = "Show this exact scene from directly behind the main subject: the camera has moved halfway round, so the subject is seen from the back, centred, with the scene beyond them." + ORBIT_KEEP;
function ns(g, p) {
  const ren = (k) => `${p}_${k}`, out = {};
  const fix = (v) => Array.isArray(v) && v.length === 2 && typeof v[0] === "string" && v[0] in g ? [ren(v[0]), v[1]] : v;
  for (const [k, n] of Object.entries(g)) out[ren(k)] = {class_type: n.class_type, inputs: Object.fromEntries(Object.entries(n.inputs).map(([a, v]) => [a, fix(v)]))};
  return out;
}
export function orbit360({image, loras, raw, width = 768, height = 1344, mode = "loop", seconds = 8.8, seed = 51101, prefix = "valis/orbit", look = null}) {
  if (mode === "loop")
    return shot({image, motion: "", width, height, seconds, seed, prefix, loras, raw, look, end: "loop", trimHold: true});
  const half = seconds / 2;
  const a = ns(shot({image, motion: "", width, height, seconds: half, seed, prefix: `${prefix}_a`, loras, raw, end: {edit: ORBIT_BEHIND}, trimHold: true}), "a");
  const b = ns(shot({image, motion: "", width, height, seconds: half, seed: seed + 1, prefix: `${prefix}_b`, loras, raw, last: image, trimHold: true}), "b");
  b["b_6"].inputs.first_frame = ["a_ls", 0];                            // the second half starts on the view from behind
  for (const n of ["fa", "fs", "13", "14", "1", "2", "3", "av"]) delete b[`b_${n}`];
  delete a["a_13"]; delete a["a_14"];
  const shared = {b_1: "a_1", b_2: "a_2", b_3: "a_3", b_av: "a_av"};   // one set of models for both halves
  for (const n of Object.values(b)) for (const [k, v] of Object.entries(n.inputs)) if (Array.isArray(v) && shared[v[0]]) n.inputs[k] = [shared[v[0]], v[1]];
  const g = {...a, ...b};
  let img = ["cat", 0];
  g["cat"] = N("ImageBatch", {image1: ["a_th", 0], image2: ["b_th", 0]});
  g["acat"] = N("AudioConcat", {audio1: ["a_ad", 0], audio2: ["b_ad", 0], direction: "after"});
  if (look) { g["pal"] = N("ValisColorPalette", {images: img, look, strength: 1.0}); img = ["pal", 0]; }
  g["out"] = N("CreateVideo", {images: img, fps: 24.0, audio: ["acat", 0]});
  g["save"] = N("SaveVideo", {video: ["out", 0], filename_prefix: prefix, format: "auto", codec: "auto"});
  return g;
}
// Dolly zoom from a real move: the shot is a push-in (or pull-back) with true parallax; SAM 3 tracks the subject and
// Valis Dolly Zoom re-frames every frame so the subject holds its size while the background's perspective keeps going.
function dollyZoom(images, {target = "person", maxZoom = 1.6, strength = 1.0} = {}) {
  return {
    "dzm": N("CheckpointLoaderSimple", {ckpt_name: MODELS.sam}),
    "dzt": N("CLIPTextEncode", {text: target, clip: ["dzm", 1]}),
    "dzk": N("SAM3_VideoTrack", {images, model: ["dzm", 0], conditioning: ["dzt", 0], detection_threshold: 0.4, max_objects: 1, detect_interval: 5}),
    "dzs": N("SAM3_TrackToMask", {track_data: ["dzk", 0], object_indices: ""}),
    "dz": N("ValisDollyZoom", {images, mask: ["dzs", 0], max_zoom: maxZoom, strength}),
  };
}
// A camera move the way Higgsfield-style presets do it: a motion LoRA trained on that one move (Remade-AI's camera
// LoRAs, Wan I2V), so the move is learned rather than described and needs no anchors or extra passes.
// Wan 2.2 I2V A14B, two experts (high noise sets the motion, low noise the detail), 4-step lightx2v on both, 16 fps.
// move: {lora, phrase} from presets.js CAMERA_LORAS; subject: words for who/what the camera moves around.
const WAN_NEG = "色调艳丽，过曝，静态，细节模糊不清，字幕，风格，作品，画作，画面，静止，整体发灰，最差质量，低质量，JPEG压缩残留，丑陋的，残缺的，多余的手指，画得不好的手部，画得不好的脸部，畸形的，毁容的，形态畸形的肢体，手指融合，静止不动的画面，杂乱的背景，三条腿，背景人很多，倒着走";
// fastHigh = false runs the high-noise (motion) stage without the 4-step distill and at real CFG: the distill flattens motion.
export function wanMove({image, move, scene = "", subject = "the subject", width = 720, height = 1280, seconds = 5, strength = 1.0,
                         highStrength = strength, lowStrength = move.highOnly ? 0 : strength, fastHigh = true, highCfg = fastHigh ? 1.0 : 3.5, steps = fastHigh ? 4 : 8,
                         split = steps / 2, seed = 51101, look = null, prefix = "valis/move"}) {
  const prompt = [scene, move.phrase.replace("{subject}", subject), "One continuous shot, no cuts."].filter(Boolean).join(" ");
  const g = {
    "wh": N("UNETLoader", {unet_name: MODELS.wanHigh, weight_dtype: "default"}),
    "wl": N("UNETLoader", {unet_name: MODELS.wanLow, weight_dtype: "default"}),
    "wc": N("CLIPLoader", {clip_name: MODELS.wanTE, type: "wan", device: "default"}),
    "wv": N("VAELoader", {vae_name: MODELS.wanVAE}),
    ...(fastHigh ? {"fh": N("LoraLoaderModelOnly", {model: ["wh", 0], lora_name: MODELS.wanFastHigh, strength_model: 1.0})} : {}),
    "fl": N("LoraLoaderModelOnly", {model: ["wl", 0], lora_name: MODELS.wanFastLow, strength_model: 1.0}),
    "mh": N("LoraLoaderModelOnly", {model: fastHigh ? ["fh", 0] : ["wh", 0], lora_name: move.lora, strength_model: highStrength}),
    ...(lowStrength ? {"ml": N("LoraLoaderModelOnly", {model: ["fl", 0], lora_name: move.lora, strength_model: lowStrength})} : {}),
    "sh": N("ModelSamplingSD3", {model: ["mh", 0], shift: 5.0}),
    "sl": N("ModelSamplingSD3", {model: lowStrength ? ["ml", 0] : ["fl", 0], shift: 5.0}),
    "pos": N("CLIPTextEncode", {text: prompt, clip: ["wc", 0]}),
    "neg": N("CLIPTextEncode", {text: WAN_NEG, clip: ["wc", 0]}),
    "fa": N("LoadImage", {image}),
    "fs": N("ImageScale", {image: ["fa", 0], upscale_method: "lanczos", width, height, crop: "center"}),
    "i2v": N("WanImageToVideo", {positive: ["pos", 0], negative: ["neg", 0], vae: ["wv", 0], width, height,
                                  length: Math.round(seconds * 16 / 4) * 4 + 1, batch_size: 1, start_image: move.mirror ? ["mf", 0] : ["fs", 0]}),
    "k1": N("KSamplerAdvanced", {model: ["sh", 0], add_noise: "enable", noise_seed: seed, steps, cfg: highCfg, sampler_name: "euler", scheduler: "simple",
                                  positive: ["i2v", 0], negative: ["i2v", 1], latent_image: ["i2v", 2], start_at_step: 0, end_at_step: split, return_with_leftover_noise: "enable"}),
    "k2": N("KSamplerAdvanced", {model: ["sl", 0], add_noise: "disable", noise_seed: seed, steps, cfg: 1.0, sampler_name: "euler", scheduler: "simple",
                                  positive: ["i2v", 0], negative: ["i2v", 1], latent_image: ["k1", 0], start_at_step: split, end_at_step: 10000, return_with_leftover_noise: "disable"}),
    "dec": N("VAEDecode", {samples: ["k2", 0], vae: ["wv", 0]}),
    "cv": N("CreateVideo", {images: look ? ["pal", 0] : move.mirror ? ["mb", 0] : ["dec", 0], fps: 16.0}),
    "save": N("SaveVideo", {video: ["cv", 0], filename_prefix: prefix, format: "auto", codec: "auto"}),
  };
  // a LoRA that only learned one direction: run it on the mirrored keyframe and mirror the shot back (arc left = arc right, flipped)
  if (move.mirror) Object.assign(g, {"mf": N("ImageFlip", {image: ["fs", 0], flip_method: "y-axis: horizontally"}),
                                     "mb": N("ImageFlip", {image: ["dec", 0], flip_method: "y-axis: horizontally"})});
  if (look) g["pal"] = N("ValisColorPalette", {images: move.mirror ? ["mb", 0] : ["dec", 0], look, strength: 1.0});
  return g;
}

// the shot's last frame, pinned: the first frame again ("loop"), your own image (`last`), or the keyframe re-seen from
// where the camera should finish (`end.edit`, Qwen Image 2.1 edit, 768 px / 14 steps). Wires itself into node "6".
function endAnchor({end, last, width, height, prefix}) {
  if (!end && !last) return {};
  const g = {};
  if (last) { g["la"] = N("LoadImage", {image: last}); g["ls"] = N("ImageScale", {image: ["la", 0], upscale_method: "lanczos", width, height, crop: "center"}); }
  else if (end === "loop") return {"__last": ["fs", 0]};
  else Object.assign(g, {
    "q1": N("UnetLoaderGGUF", {unet_name: MODELS.qwen}),
    "q2": N("CLIPLoader", {clip_name: MODELS.qwenTE, type: "qwen_image", device: "default"}),
    "q3": N("VAELoader", {vae_name: MODELS.qwenVAE}),
    "qe": N("TextEncodeQwenImage21", {clip: ["q2", 0], prompt: end.edit, negative_prompt: "", resolution: 768, vae: ["q3", 0], "images.image_1": ["fs", 0]}),
    "qs": N("KSampler", {model: ["q1", 0], positive: ["qe", 0], negative: ["qe", 1], latent_image: ["qe", 2], seed: 1924, steps: 14, cfg: 1.0, sampler_name: "euler", scheduler: "simple", denoise: 1.0}),
    "qd": N("VAEDecode", {samples: ["qs", 0], vae: ["q3", 0]}),
    "ls": N("ImageScale", {image: ["qd", 0], upscale_method: "lanczos", width, height, crop: "center"}),
    "lw": N("SaveImage", {images: ["ls", 0], filename_prefix: `${prefix}_end`}),
  });
  return {...g, "__last": ["ls", 0]};
}

// ---------------------------------------------------------------- loops (Create · Loop)
// A shot that plays forever, made by H3 itself: pxl-pshr's MiniMax H3 Loop (github.com/pxl-pshr/ComfyUI-MiniMaxH3-Loop,
// GPL-3.0, a separate pack) samples the latent with its end wrapped round to its start and decodes it the same way, so the
// join is denoised like any other frame. No pinned last frame, no crossfade. The keyframe goes in as a reference
// (<Picture 1>), not as a first frame: H3 reads a pinned frame as a shot start and the loop point can jump.
// Lengths are 17k+5 frames for a 17k-frame loop (107 -> 102 frames, 4.25 s).
// engine "fast": FastH3 OmniRef, 8 steps (drafts: ~85 s at 384x672 on an RTX 4080 Laptop). "full": H3 ref2va, 25 steps
// (~54 min at 768x1344 with views 2 on the same laptop). Both show H3 ref2va's own stall on moving subjects (one frame in
// four barely moves; the same prompt without the loop does it too, Oct 23). fl2va with the keyframe pinned as the first
// frame has no stall in plain shots, but with the loop its join jumped (5x an ordinary step), so loops stay on ref2va.
// views 2 also samples the loop turned half round and takes the sound near the loop point from it (H3 garbles the sound
// next to the wrap otherwise); about 1.8x the sampling time.
export const LOOP_LENGTHS = [{frames: 107, s: 4.25}, {frames: 158, s: 6.4}, {frames: 209, s: 8.5}, {frames: 260, s: 10.6}];
export const loopLength = (seconds) => LOOP_LENGTHS.reduce((a, b) => Math.abs(b.s - seconds) < Math.abs(a.s - seconds) ? b : a).frames;
// a loop is a state that keeps going: a locked-off camera, one subject doing one continuous or cyclic thing, nothing that
// starts, ends or piles up (pxl-pshr's PROMPTING.md)
export function loopPrompt({subject = "", action = "", sound = "", ref = true}) {
  const who = ref ? "The scene from <Picture 1>" : "";
  const body = [who && subject ? `${who}: ${subject.replace(/\.$/, "")}.` : (subject || who + "."), action].filter(Boolean).join(" ").trim();
  return "Locked-off static camera, no pan, no zoom. " + body + (/[.!?]$/.test(body) ? "" : ".") +
    " Continuous, smooth, unbroken motion throughout.\n\noverall_soundscape: " + (sound || "a steady, quiet ambience of the place, nothing that happens once") +
    "\n\nnon_diegetic_music: N/A";
}
export function loopShot({image = null, prompt, width = 768, height = 1344, length = 107, seed = 42, engine = "fast", views = 2, padClips = 1,
                          look = null, gifWidth = 480, prefix = "valis/loop"}) {
  const full = engine === "full";
  const g = {
    "1": N("UNETLoader", {unet_name: full ? MODELS.h3ref : MODELS.h3refFast, weight_dtype: "default"}),
    "lp": N("MiniMaxH3Loop", {model: ["1", 0], pad_clips: padClips, views}),
    "2": N("CLIPLoader", {clip_name: MODELS.h3TE, type: "minimax", device: "default"}),
    "3": N("VAELoader", {vae_name: MODELS.h3VAE}),
    "av": N("VAELoader", {vae_name: MODELS.h3AVAE}),
    ...(image ? {"fa": N("LoadImage", {image})} : {}),
    "r2v": N("MiniMaxH3ReferenceToVideo", {clip: ["2", 0], vae: ["3", 0], audio_vae: ["av", 0], prompt, width, height, length, ref_image_size: "match",
                                           ...(image ? {"ref_images.ref_image_0": ["fa", 0]} : {})}),
    "8": N("RandomNoise", {noise_seed: seed}),
    "9": N("KSamplerSelect", {sampler_name: "res_multistep"}),
    "10": N("BasicScheduler", {model: ["lp", 0], scheduler: "simple", steps: full ? 25 : 8, denoise: 1.0}),
    "7": N("BasicGuider", {model: ["lp", 0], conditioning: ["r2v", 0]}),
    "11": N("SamplerCustomAdvanced", {noise: ["8", 0], guider: ["7", 0], sampler: ["9", 0], sigmas: ["10", 0], latent_image: ["r2v", 1]}),
    "ld": N("MiniMaxH3LoopDecode", {samples: ["11", 0], vae: ["3", 0], audio_vae: ["av", 0], pad_clips: padClips}),
  };
  let img = ["ld", 0];
  if (look) { g["pal"] = N("ValisColorPalette", {images: img, look, strength: 1.0}); img = ["pal", 0]; }
  g["13"] = N("CreateVideo", {images: img, fps: 24.0, audio: ["ld", 1]});
  g["14"] = N("SaveVideo", {video: ["13", 0], filename_prefix: prefix, format: "auto", codec: "auto"});
  g["gif"] = N("ValisLoopSave", {images: img, filename_prefix: prefix, format: "gif", fps: 24.0, gif_width: gifWidth});
  return g;
}

// ---------------------------------------------------------------- masks
// audio: a file in input/ to use as the track, or null to keep the clip's own sound (a talking head keeps its voice)
function track(video, target, {audio = null, shrink = 2, grow = 10, maxObjects = 1, threshold = 0.45, maxSeconds = 15} = {}) {
  const g = {
    "16": N("LoadVideo", {file: video}),
    "17": N("GetVideoComponents", {video: ["16", 0]}),
    "18": N("H3MaskVideoPrepare", {images: ["17", 0], audio: audio ? ["90", 0] : ["17", 1], source_fps: ["17", 2], max_seconds: maxSeconds, target_fps: 24}),
    "19": N("CheckpointLoaderSimple", {ckpt_name: MODELS.sam}),
    "20": N("CLIPTextEncode", {text: target, clip: ["19", 1]}),
    "21": N("SAM3_VideoTrack", {images: ["18", 0], model: ["19", 0], conditioning: ["20", 0], detection_threshold: threshold, max_objects: maxObjects, detect_interval: 5}),
    "22": N("SAM3_TrackToMask", {track_data: ["21", 0], object_indices: ""}),
    "23": N("MVEx_MaskCleanup", {masks: ["22", 0], threshold: 0.3, method: "shrink_grow", "method.shrink": Math.max(1, shrink), "method.min_frames": 4, edge_grow: grow}),
  };
  if (audio) g["90"] = N("LoadAudio", {audio});
  return g;
}

export function maskPreview({video, target, audio, maxObjects = 1, grow = 10, prefix = "valis/mask"}) {
  const g = track(video, target, {audio, maxObjects, grow});
  Object.assign(g, {
    "40": N("MaskToImage", {mask: ["23", 0]}),
    "41": N("CreateVideo", {images: ["40", 0], fps: 24}),
    "42": N("SaveVideo", {video: ["41", 0], filename_prefix: `${prefix}_matte`, format: "auto", codec: "auto"}),
    "43": N("SolidMask", {value: 1.0, width: 64, height: 64}),
    "44": N("MaskToImage", {mask: ["43", 0]}),
    "45": N("ImageCompositeMasked", {destination: ["18", 0], source: ["44", 0], x: 0, y: 0, resize_source: true, mask: ["23", 0]}),
    "46": N("ImageBlend", {image1: ["18", 0], image2: ["45", 0], blend_factor: 0.45, blend_mode: "normal"}),
    "47": N("CreateVideo", {images: ["46", 0], fps: 24}),
    "48": N("SaveVideo", {video: ["47", 0], filename_prefix: `${prefix}_overlay`, format: "auto", codec: "auto"}),
  });
  return g;
}

// ---------------------------------------------------------------- transform / remove / swap
function kreaLoaders() {
  return {
    "200": N("UNETLoader", {unet_name: MODELS.krea, weight_dtype: "default"}),
    "201": N("CLIPLoader", {clip_name: MODELS.kreaTE, type: "krea2", device: "default"}),
    "202": N("VAELoader", {vae_name: MODELS.kreaVAE}),
    "203": N("LoraLoaderModelOnly", {model: ["200", 0], lora_name: MODELS.kreaLora, strength_model: 1.0}),
  };
}

function kreaEdit(b, img, prompt, seed, prefix, refBoost, subject = null) {
  const i = (k) => String(b + k), g = {};
  g[i(4)] = N("ImageScaleToTotalPixels", {image: img, upscale_method: "lanczos", megapixels: 1.0, resolution_steps: 16});
  g[i(5)] = N("VAEEncode", {pixels: [i(4), 0], vae: ["202", 0]});
  g[i(6)] = N("GetImageSize", {image: [i(4), 0]});
  g[i(7)] = N("EmptySD3LatentImage", {width: [i(6), 0], height: [i(6), 1], batch_size: 1});
  const patch = {model: ["203", 0], source_latent: [i(5), 0], vae: ["202", 0], source_image: [i(4), 0], target_latent: [i(7), 0], ref_boost: refBoost, ref_boost_a: 1.0, fit_mode: "fit"};
  if (subject) patch.source_image_b = subject;
  g[i(8)] = N("Krea2EditModelPatch", patch);
  g[i(9)] = N("Krea2EditGroundedEncode", {clip: ["201", 0], prompt, image: [i(4), 0], grounding_px: 768, system_prompt: ""});
  g[i(10)] = N("Krea2EditGroundedEncode", {clip: ["201", 0], prompt: "", image: [i(4), 0], grounding_px: 768, system_prompt: ""});
  g[i(11)] = N("KSampler", {model: [i(8), 0], positive: [i(9), 0], negative: [i(10), 0], latent_image: [i(7), 0], seed, steps: 10, cfg: 1.0, sampler_name: "euler", scheduler: "simple", denoise: 1.0});
  g[i(12)] = N("VAEDecode", {samples: [i(11), 0], vae: ["202", 0]});
  if (prefix) g[i(13)] = N("SaveImage", {images: [i(12), 0], filename_prefix: prefix});
  return g;
}

function qwenEdit(b, img, prompt, seed, prefix) {
  const i = (k) => String(b + k), g = {};
  g[i(0)] = N("ImageScaleToTotalPixels", {image: img, upscale_method: "lanczos", megapixels: 1.0, resolution_steps: 16});
  g[i(1)] = N("TextEncodeQwenImage21", {clip: ["251", 0], prompt, negative_prompt: "", resolution: 0, "images.image_1": [i(0), 0], vae: ["252", 0]});
  g[i(2)] = N("KSampler", {model: ["250", 0], positive: [i(1), 0], negative: [i(1), 1], latent_image: [i(1), 2], seed, steps: 25, cfg: 1, sampler_name: "euler", scheduler: "simple", denoise: 1});
  g[i(3)] = N("VAEDecode", {samples: [i(2), 0], vae: ["252", 0]});
  if (prefix) g[i(4)] = N("SaveImage", {images: [i(3), 0], filename_prefix: prefix});
  return g;
}

function h3Prompt({who, desc, keep, extra}) {
  return "subject_definitions:\n<Subject 1> is " + who + " as shown in <Picture 1> and <Picture 2>: " + desc + "." + (extra || "") +
    "\n\nsummary:\n[video editing + reference generation] Inside the masked region " + who + " is " + desc + " for the whole video, exactly as in <Picture 1>." +
    "\n\nretention_analysis:\n<Subject 1>: fully_preserved - " + keep + " follow <Picture 1> in every frame, from the first to the last." +
    "\n\ndetailed_description:\n[Shot 1] The original camera, timing, lighting and everything outside the mask stay unchanged. Inside the mask " + who + " is " + desc +
    " in every frame, with the same motion as the source; it matches <Picture 1> at the start and <Picture 2> at the end." +
    "\n\noverall_soundscape:\nKeep the source soundtrack unchanged.\n\nnon_diegetic_music:\nN/A";
}

// mode: "transform" (Krea anchors), "remove" (Qwen anchors), "swap" (Krea anchors + a character reference)
export function edit({mode, video, audio, target, anchorPrompt, desc, who = "the subject", keep = "its shape and material",
                      refBoost = 0.5, grow = 12, crop = 1.3, character = null, lastFrame = -1, maxSeconds = 15, prefix = "valis/edit", engine}) {
  const g = track(video, target, {audio, grow, maxSeconds});
  Object.assign(g, {
    "24": N("MVEx_SubjectCrop", {original_images: ["18", 0], masks: ["23", 0], mode: "tracked", "mode.crop_scale": crop, "mode.padding": "firm", "mode.prefer": "stillness", "mode.aspect_ratio": 0, "mode.seamless_loop": false, divisible_by: 32, upscale_megapixels: -0.6, resize_method: "auto"}),
    "25": N("GetImageSize", {image: ["24", 0]}),
    "46": N("ImageFromBatch", {image: ["24", 0], batch_index: 0, length: 1}),
    "47": N("ImageFromBatch", {image: ["24", 0], batch_index: lastFrame, length: 1}),
    "50": N("MaskToImage", {mask: ["23", 0]}),
    "51": N("CreateVideo", {images: ["50", 0], fps: 24}),
    "52": N("SaveVideo", {video: ["51", 0], filename_prefix: `${prefix}_matte`, format: "auto", codec: "auto"}),
  });
  let first, last;
  if (mode === "remove") {
    Object.assign(g, {"250": N("UnetLoaderGGUF", {unet_name: MODELS.qwen}), "251": N("CLIPLoader", {clip_name: MODELS.qwenTE, type: "qwen_image", device: "default"}), "252": N("VAELoader", {vae_name: MODELS.qwenVAE})});
    Object.assign(g, qwenEdit(300, ["46", 0], anchorPrompt, 3, `${prefix}_anchor_first`), qwenEdit(320, ["47", 0], anchorPrompt, 3, `${prefix}_anchor_last`));
    first = ["303", 0]; last = ["323", 0];
  } else {
    Object.assign(g, kreaLoaders());
    let subject = null;
    if (mode === "swap" && character) { g["60"] = N("LoadImage", {image: character}); subject = ["60", 0]; }
    Object.assign(g, kreaEdit(300, ["46", 0], anchorPrompt, 31, `${prefix}_anchor_first`, refBoost, subject),
                     kreaEdit(320, ["47", 0], anchorPrompt, 31, `${prefix}_anchor_last`, refBoost, subject));
    first = ["312", 0]; last = ["332", 0];
  }
  const refs = {"ref_images.ref_image_0": first, "ref_images.ref_image_1": last, "ref_audios.ref_audio_0": ["18", 1]};
  let extra = "";
  if (mode === "swap" && character) { refs["ref_images.ref_image_2"] = ["60", 0]; extra = " <Picture 3> shows the same character up close."; }
  const anchor = (c, which, img) => N("H3IdentityAnchor", {conditioning: c, vae: ["3", 0], latent: ["6", 1], frame_count: ["18", 4], width: ["25", 0], height: ["25", 1], anchor: which, image: img});
  Object.assign(g, {
    "1": N("CLIPLoader", {clip_name: MODELS.h3TE, type: "minimax", device: "default"}),
    "2": N("UNETLoader", {unet_name: MODELS.h3ref, weight_dtype: "default"}),
    "3": N("VAELoader", {vae_name: MODELS.h3VAE}),
    "4": N("VAELoader", {vae_name: MODELS.h3AVAE}),
    "5": N("MiniMaxH3SigmaShift", {model: ["2", 0], shift_video: 8, shift_audio: 3}),
    "6": N("MiniMaxH3ReferenceToVideo", Object.assign({clip: ["1", 0], vae: ["3", 0], audio_vae: ["4", 0], prompt: h3Prompt({who, desc, keep, extra}), width: ["25", 0], height: ["25", 1], length: ["18", 4], ref_image_size: "max"}, refs)),
    "62": anchor(["6", 0], "first", first), "65": anchor(["62", 0], "last", last),
    "7": N("BasicGuider", {model: ["5", 0], conditioning: ["65", 0]}),
    "8": N("RandomNoise", {noise_seed: 31}),
    "9": N("BasicScheduler", {model: ["5", 0], scheduler: "simple", steps: 20, denoise: 1}),
    "10": N("KSamplerSelect", {sampler_name: "res_multistep"}),
    "26": N("VAEEncode", {pixels: ["24", 0], vae: ["3", 0]}),
    "27": N("MVEx_MaskToLatentSpace", {masks: ["24", 1], compression: "auto", spatial_method: "max", temporal_method: "max", grow_spatial: 16, grow_temporal: 1, grow_temp_mode: "both", vae: ["3", 0]}),
    "28": N("SetLatentNoiseMask", {samples: ["26", 0], mask: ["27", 0]}),
    "29": N("VAEEncodeAudio", {audio: ["18", 1], vae: ["4", 0]}),
    "30": N("SolidMask", {value: 0, width: 32, height: 32}),
    "31": N("SetLatentNoiseMask", {samples: ["29", 0], mask: ["30", 0]}),
    "32": N("LTXVConcatAVLatent", {video_latent: ["28", 0], audio_latent: ["31", 0]}),
    "11": N("SamplerCustomAdvanced", {noise: ["8", 0], guider: ["7", 0], sampler: ["10", 0], sigmas: ["9", 0], latent_image: ["32", 0]}),
    "12": N("VAEDecode", {samples: ["11", 0], vae: ["3", 0]}),
    "39": N("MVEx_LatentMaskToMask", {mask: ["27", 0], compression: "auto", frames: 0, vae: ["3", 0]}),
    "33": N("MVEx_SubjectUncrop", {cropped_images: ["12", 0], original_images: ["18", 0], bboxes: ["24", 2], feather: 32, cropped_masks: ["39", 0], resize_method: "auto"}),
    "14": N("CreateVideo", {images: ["33", 0], fps: ["18", 3], audio: ["18", 2]}),
    "15": N("SaveVideo", {video: ["14", 0], filename_prefix: prefix, format: "auto", codec: "auto"}),
  });
  return withRefEngine(g, engine);
}

// ---------------------------------------------------------------- full character swap (H3 ref2va + character-swap LoRA)
// The whole frame is regenerated: the clip rides in as <Video 1> (motion, framing, scene), the character sheet as
// <Picture 1>, and the clip's own soundtrack is anchored at frame 0 so the new face speaks the original words.
export const SWAP_LORA = "h3_character_swap_v1.5.safetensors";
export function swapPrompt({target = "the man", look = "", action = "facing the camera and talking straight into the lens"} = {}) {
  if (!/^(the|a|an|his|her|their|my|your|this|that)\b/i.test(target.trim())) target = `the ${target.trim()}`;   // "man" -> "the man"
  return `Replace only ${target} in <Video 1> with the character in <Picture 1>${look ? ": " + look : ""}. ` +
    "Keep the replacement character's identity, face, hair, outfit and art style from <Picture 1>. " +
    "Preserve the source video's camera, background, lighting, objects and framing. " +
    `Match ${target}'s position, scale, pose and movement: ${action}, his lips moving in sync with his voice. ` +
    "Do not show the reference sheet or its background.";
}
// background: an image in input/ to put behind the person first (SAM 3 matte), so the swap keeps the new scene.
// The clip is brought to 0.5625 "megapixels" (ComfyUI counts 1024x1024 = 1; that is exactly 576x1024 for 9:16) so a
// laptop GPU can carry the video reference.
// turbo: stack the ref2v 8-step speed LoRA after the swap LoRA and sample er_sde/beta in 8 steps (~2.5x faster).
export const TURBO_LORA = "minimax_h3_ref2v_turbo_8step_v1.0_768p_comfyui_bf16.safetensors";
export function swapFull({video, character, prompt, background = null, person = "person", megapixels = 0.5625, lora = SWAP_LORA,
                          loraStrength = 1.0, turbo = false, steps = null, seed = 31, maxSeconds = 15, match = false, prefix = "valis/swap", engine}) {
  steps = steps || (turbo ? 8 : 20);
  const g = {
    "16": N("LoadVideo", {file: video}),
    "17": N("GetVideoComponents", {video: ["16", 0]}),
    "17s": N("ImageScaleToTotalPixels", {image: ["17", 0], upscale_method: "lanczos", megapixels, resolution_steps: 32}),
    "18": N("H3MaskVideoPrepare", {images: ["17s", 0], audio: ["17", 1], source_fps: ["17", 2], max_seconds: maxSeconds, target_fps: 24}),
    "25": N("GetImageSize", {image: ["18", 0]}),
    "1": N("CLIPLoader", {clip_name: MODELS.h3TE, type: "minimax", device: "default"}),
    "2": N("UNETLoader", {unet_name: MODELS.h3ref, weight_dtype: "default"}),
    "3": N("VAELoader", {vae_name: MODELS.h3VAE}),
    "4": N("VAELoader", {vae_name: MODELS.h3AVAE}),
    "2l": N("LoraLoaderModelOnly", {model: ["2", 0], lora_name: lora, strength_model: loraStrength}),
    "5": N("MiniMaxH3SigmaShift", {model: [turbo ? "2t" : "2l", 0], shift_video: 8, shift_audio: 3}),
    "60": N("LoadImage", {image: character}),
    "6": N("MiniMaxH3ReferenceToVideo", {clip: ["1", 0], vae: ["3", 0], audio_vae: ["4", 0], prompt, width: ["25", 0], height: ["25", 1], length: ["18", 4],
      ref_image_size: "max", "ref_images.ref_image_0": ["60", 0], "ref_videos.ref_video_0": ["18", 0], "ref_video_audios.ref_video_audio_0": ["18", 1]}),
    "61": N("MiniMaxH3AddGuide", {positive: ["6", 0], latent: ["6", 1], frame_idx: 0, vae: ["3", 0], audio_vae: ["4", 0], audio: ["18", 1]}),
    "7": N("BasicGuider", {model: ["5", 0], conditioning: ["61", 0]}),
    "8": N("RandomNoise", {noise_seed: seed}),
    "9": N("BasicScheduler", {model: ["5", 0], scheduler: turbo ? "beta" : "simple", steps, denoise: 1}),
    "10": N("KSamplerSelect", {sampler_name: turbo ? "er_sde" : "res_multistep"}),
    "11": N("SamplerCustomAdvanced", {noise: ["8", 0], guider: ["7", 0], sampler: ["10", 0], sigmas: ["9", 0], latent_image: ["6", 1]}),
    "12": N("VAEDecode", {samples: ["11", 0], vae: ["3", 0]}),
    "14": N("CreateVideo", {images: ["12", 0], fps: 24, audio: ["18", 2]}),
    "15": N("SaveVideo", {video: ["14", 0], filename_prefix: prefix, format: "auto", codec: "auto"}),
  };
  if (turbo) g["2t"] = N("LoraLoaderModelOnly", {model: ["2l", 0], lora_name: TURBO_LORA, strength_model: 1.0});
  if (background) {
    Object.assign(g, personMatte(["18", 0], person, 20), {
      "70": N("LoadImage", {image: background}),
      "71": N("InvertMask", {mask: ["23", 0]}),
      "72": N("ImageCompositeMasked", {destination: ["18", 0], source: ["70", 0], x: 0, y: 0, resize_source: true, mask: ["71", 0]}),
      "73": N("CreateVideo", {images: ["72", 0], fps: 24, audio: ["18", 2]}),
      "74": N("SaveVideo", {video: ["73", 0], filename_prefix: `${prefix}_plate`, format: "auto", codec: "auto"}),
    });
    g["6"].inputs["ref_videos.ref_video_0"] = ["72", 0];
  }
  // match the plate (no AI): before, the take is measured against the sheet and the sheet is graded to the take's light;
  // after, the swapped person is matched back to the plate (tone curve, colour transfer, grain, edge wrap)
  if (match) {
    if (!background) Object.assign(g, personMatte(["18", 0], person, 20));
    const plate = background ? ["72", 0] : ["18", 0];
    g["90"] = N("ValisSwapCheck", {take: plate, mask: ["23", 0], reference: ["60", 0], pregrade: true, auto_flip: false});
    g["91"] = N("SaveText", {text: ["90", 1], filename_prefix: `${prefix}_check`, format: "txt"});
    g["6"].inputs["ref_images.ref_image_0"] = ["90", 0];
    // the new character's silhouette isn't the old one's: SAM finds it again in the swap, and only it is graded
    Object.assign(g, personMatte(["12", 0], person, 94));
    g["92"] = N("ValisSwapMatch", {plate, swapped: ["12", 0], mask: ["23", 0], swapped_mask: ["97", 0], color: 0.85, grain: true, soften: true, light_wrap: 0.25});
    g["14"].inputs.images = ["92", 0];
  }
  return withRefEngine(g, engine);
}
function personMatte(images, text, b, grow = 2) {
  const i = (k) => String(b + k);
  return {
    "19": N("CheckpointLoaderSimple", {ckpt_name: MODELS.sam}),
    [i(0)]: N("CLIPTextEncode", {text, clip: ["19", 1]}),
    [i(1)]: N("SAM3_VideoTrack", {images, model: ["19", 0], conditioning: [i(0), 0], detection_threshold: 0.45, max_objects: 1, detect_interval: 5}),
    [i(2)]: N("SAM3_TrackToMask", {track_data: [i(1), 0], object_indices: ""}),
    [i(3)]: N("MVEx_MaskCleanup", {masks: [i(2), 0], threshold: 0.3, method: "shrink_grow", "method.shrink": 1, "method.min_frames": 4, edge_grow: grow}),
  };
}

// ---------------------------------------------------------------- turn: one take becomes another on a word
// a and b are two renders of the same take (e.g. two character swaps). The voice is the score: the impact sits on the
// chosen word (swapAt in seconds; -1 = the first syllable after the longest pause), the reveal ignites from the eyes
// and every later syllable feeds it. The settings are DANSE s14's (halo .25, wave .5, rays .35).
export function turn({a, b, swapAt = -1, person = "person", voice = false, prefix = "valis/turn"}) {
  const g = {
    "16": N("LoadVideo", {file: a}),
    "17": N("GetVideoComponents", {video: ["16", 0]}),
    "40": N("LoadVideo", {file: b}),
    "41": N("GetVideoComponents", {video: ["40", 0]}),
    "70": N("ValisScoreFromAudio", {audio: ["17", 1], swap_at: swapAt, floor_db: -42}),
  };
  Object.assign(g, personMatte(["17", 0], person, 30, 14));
  g["80"] = N("ValisFX", {images: ["17", 0], score: ["70", 0], start_bar: 0, mode: "finale", reveal: "ignite", fx_images: ["41", 0],
    mask_b: ["33", 0], seeds: "eyes", center: "eyes", candles: false, glint: false, mist: 0.6, rays: 0.35, halo: 0.25, wave: 0.5, remap: "{}"});
  // the voice turns with the face: the take's voice until the word, the monster after it
  if (voice) g["75"] = N("ValisVoiceTurn", {audio: ["17", 1], turn_at: -1, pitch: 0.74, formant: 0.86, sub: 0.5, growl: 0.12, score: ["70", 0]});
  g["81"] = N("CreateVideo", {images: ["80", 0], fps: ["17", 2], audio: voice ? ["75", 0] : ["17", 1]});
  g["82"] = N("SaveVideo", {video: ["81", 0], filename_prefix: prefix, format: "auto", codec: "auto"});
  return g;
}

// ---------------------------------------------------------------- the Valis pass on one shot (ComfyUI-Valis nodes)
// rules: [{event, effect}] from the Score tab. Each effect the engine knows listens to one engine event; a rule on
// another lane remaps it, so "melody -> candles" lights a candle on every melody note.
const ENGINE_EVENT = {candles: "musicbox", crowd: "pah", ignite: "kick", vanish: "response_right", shockwave: "stroke",
  lightning: "violin", rim: "heartbeat", flare: "stab", halo: "impact", whiteout: "final_hit", glint: "glint"};
export function valisShot({clip, score, startBar, mode = "auto", section = "", layer = null, rules = [], targetA = "", targetB = "", prefix = "valis/valis"}) {
  const has = (fx) => rules.some(r => r.effect === fx);
  const remap = {};
  for (const r of rules) { const k = ENGINE_EVENT[r.effect]; if (k && r.event !== k) remap[k] = r.event; }
  const sec = (section || "").toLowerCase();
  let reveal = "none";
  if (layer) {
    if (has("crowd") && /waltz|verse|theme/.test(sec)) reveal = "crowd";
    else if (has("vanish") && /breakdown|bridge/.test(sec)) reveal = "vanish";
    else if (has("ignite") && /drop|finale|chorus/.test(sec)) reveal = "ignite";
    else reveal = "on";
  }
  const g = {
    "16": N("LoadVideo", {file: clip}),
    "17": N("GetVideoComponents", {video: ["16", 0]}),
    "70": N("ValisScoreLoad", {score}),
  };
  const fx = {images: ["17", 0], score: ["70", 0], start_bar: startBar, mode, reveal,
    candles: has("candles") && /prologue|intro/.test(sec), glint: false, mist: 1.0, rays: 1.0, halo: has("halo") ? 1.0 : 0.0,
    wave: has("shockwave") || has("halo") ? 1.0 : 0.3, seeds: "default", remap: JSON.stringify(remap)};
  const targets = [["a", targetA, 20], ["b", targetB, 30]].filter(([, t]) => t);
  if (targets.length) g["19"] = N("CheckpointLoaderSimple", {ckpt_name: MODELS.sam});
  for (const [key, text, b] of targets) {
    const i = (k) => String(b + k);
    g[i(0)] = N("CLIPTextEncode", {text, clip: ["19", 1]});
    g[i(1)] = N("SAM3_VideoTrack", {images: ["17", 0], model: ["19", 0], conditioning: [i(0), 0], detection_threshold: 0.45, max_objects: 1, detect_interval: 5});
    g[i(2)] = N("SAM3_TrackToMask", {track_data: [i(1), 0], object_indices: ""});
    g[i(3)] = N("MVEx_MaskCleanup", {masks: [i(2), 0], threshold: 0.3, method: "shrink_grow", "method.shrink": 2, "method.min_frames": 4, edge_grow: 8});
    fx[key === "a" ? "mask_a" : "mask_b"] = [i(3), 0];
  }
  if (reveal === "crowd" && targets.length) {
    if (targets.length === 2) { g["39"] = N("MaskComposite", {destination: ["23", 0], source: ["33", 0], x: 0, y: 0, operation: "or"}); fx.occlusion = ["39", 0]; }
    else fx.occlusion = [String(targets[0][2] + 3), 0];
  }
  if (layer) { g["40"] = N("LoadVideo", {file: layer}); g["41"] = N("GetVideoComponents", {video: ["40", 0]}); fx.fx_images = ["41", 0]; }
  g["80"] = N("ValisFX", fx);
  g["81"] = N("CreateVideo", {images: ["80", 0], fps: 24, audio: ["17", 1]});     // the pass keeps the shot's own sound
  g["82"] = N("SaveVideo", {video: ["81", 0], filename_prefix: prefix, format: "auto", codec: "auto"});
  return g;
}

// ---------------------------------------------------------------- the Valis library (nodes_lib.py)
// Effects for the FX tab: what each needs, the lane it listens to by default, and its settings.
export const LIBRARY = [
  {id: "DoubleExposure", name: "Double exposure", blurb: "A silhouette becomes a window into another scene, screen-printed.", needs: ["subject", "other"], on: "beat", params: {}},
  {id: "TimeSlip", name: "Time slip", blurb: "Another era breaks through on the music: flicker cuts, a light-first bleed, burning holes.", needs: ["other"], on: "beat", params: {mode: "flicker", era: "daguerreotype"}},
  {id: "Shatter", name: "Shatter", blurb: "The frame cracks like glass and falls away onto another scene.", needs: [], on: "downbeat", params: {}},
  {id: "Lens", name: "Gravity lens", blurb: "Space bends around the subject: an Einstein ring and a dark core.", needs: ["subject"], on: "kick", params: {}},
  {id: "SlitScan", name: "Slit-scan", blurb: "Time smears down the frame: every row lives a moment in the past.", needs: [], by: "loud", on: "", params: {map: "y"}},
  {id: "Datamosh", name: "Datamosh", blurb: "The next frame never arrives: the picture is dragged along the motion.", needs: [], on: "kick", params: {}},
  {id: "Echo", name: "Echo", blurb: "The subject sheds afterimages on every hit.", needs: ["subject"], on: "beat", params: {}},
  {id: "Tear", name: "Tear", blurb: "Reality rips along a seam; another scene burns behind it.", needs: ["other"], on: "", by: "loud", params: {}},
  {id: "Frost", name: "Frost", blurb: "Frost grows across the frame from each hit.", needs: [], on: "downbeat", params: {}},
  {id: "Vertigo", name: "Vertigo", blurb: "A dolly zoom: the subject holds, the world rushes away.", needs: ["subject"], on: "", by: "loud", params: {}},
  {id: "Projector", name: "Projector", blurb: "Projected film: flicker, gate weave, scratches, dust.", needs: [], on: "beat", params: {}},
  {id: "Glitch", name: "Glitch", blurb: "Blocks slip and channels split on the hits.", needs: [], on: "hat", params: {}},
  {id: "Punch", name: "Punch", blurb: "A flash, a zoom kick and a colour split on the hits.", needs: [], on: "kick", params: {}},
  {id: "Shockwave", name: "Shockwave", blurb: "A ring of bent space races out from the subject on each hit, with a colour fringe.", needs: [], on: "downbeat", params: {at: "subject"}},
  {id: "Rays", name: "Light shafts", blurb: "Light streams out of the brightest thing in the frame on each hit: shafts, bloom, a cold streak.", needs: [], on: "beat", params: {}},
  {id: "Split", name: "Split time", blurb: "The frame splits down the middle: the other clip on one side, a glowing seam between.", needs: ["other"], on: "downbeat", params: {clips: ["a", "b"]}},
  {id: "Eras", name: "Era cut", blurb: "Cuts to the other clip and back on every hit, each cut bleeding into the last.", needs: ["other"], on: "beat", params: {clips: ["a", "b"]}},
];
export const BEDS = ["rain", "wind", "sea", "fire", "room", "neon"];
export const CUE_SHEET_EXAMPLE = `# a soundless cue sheet: seconds or bar:beat, one cue per line
bpm 108 4/4
1:1   beat
every 1 beat from 1:1 to 3:1 beat
2:1   downbeat
3:1   kick 1.2
ramp loud 0 0 4.4 1`;

// YuE2 writes the sheet music (ABC), then sings and plays it. Returns the graph and where its audio and ABC come out.
// An instrumental (lyrics "[Instrumental]", or instrumental: true): "[Instrumental]" alone is not enough. YuE2's own
// sheet music still has a Vocal line in every verse and chorus, and it sings it (THE MAN IN THE SUIT, Oct 23: all three
// seeds came back with a voice). So, as the Plenio pack's cover path does it: the instrumental adapter (an AR LoRA on the
// CLIP slot, ar_lora_inst_v3abc, CC BY-NC 4.0), the lyrics as the adapter was trained ("[instrumental]"), and the score's
// Vocal melody moved to the instrument voice before the music is rendered (Plenio Score Tools), so the tune is played.
export const INSTRUMENTAL_LORA = "ar_lora_inst_v3abc_comfyui.safetensors";
export function song({style, lyrics, seconds = 30, seed = 1843, base = 500, prefix = "valis/song", instrumental = /^\s*\[instrumental\]\s*$/i.test(lyrics || "")}) {
  const i = (k) => String(base + k);
  const clip = instrumental ? [i(9), 1] : [i(0), 1];
  const words = instrumental ? "[instrumental]" : lyrics;
  const g = {
    [i(0)]: N("CheckpointLoaderSimple", {ckpt_name: "yue2_3b_bf16.safetensors"}),
    [i(1)]: N("YuE2GenerateABC", {clip, style, lyrics: words, seed, mode: "full", max_abc_tokens: 8192, temperature: 0.7, top_p: 0.9, top_k: 30, repetition_penalty: 1.005, penalty_window: 100}),
    [i(2)]: N("YuE2GenerateMusic", {clip, style, lyrics: words, abc: instrumental ? [i(10), 0] : [i(1), 0], seed, mode: "full", max_duration: seconds, temperature: 1, top_p: 0.95, top_k: 100, repetition_penalty: 1.2, cfg_scale: 1}),
    [i(3)]: N("ConditioningZeroOut", {conditioning: [i(2), 0]}),
    [i(4)]: N("EmptyYuE2LatentAudio", {seconds: [i(2), 1], batch_size: 1}),
    [i(5)]: N("KSampler", {model: [i(0), 0], positive: [i(2), 0], negative: [i(3), 0], latent_image: [i(4), 0], seed, steps: 32, cfg: 1, sampler_name: "dpm_2", scheduler: "sgm_uniform", denoise: 1}),
    [i(6)]: N("VAEDecodeAudio", {samples: [i(5), 0], vae: [i(0), 2]}),
    [i(7)]: N("SaveAudio", {audio: [i(6), 0], filename_prefix: prefix}),
    [i(8)]: N("SaveText", {text: instrumental ? [i(10), 0] : [i(1), 0], filename_prefix: prefix + "_abc", format: "txt"}),
    ...(instrumental ? {
      [i(9)]: N("LoraLoader", {model: [i(0), 0], clip: [i(0), 1], lora_name: INSTRUMENTAL_LORA, strength_model: 0.0, strength_clip: 1.0}),
      [i(10)]: N("PlenioScoreTools", {operation: "voices", "operation.vocal": "move Vocal melody to Ins", "operation.conflict": "replace Ins", score: [i(1), 0]}),
    } : {}),
  };
  return {graph: g, audio: [i(6), 0], abc: instrumental ? [i(10), 0] : [i(1), 0]};
}

// The FX tab: a clip (+ another clip, a subject), cues from a song / a written song / a cue sheet / a score, a stack of
// library layers, and every layer's own sound mixed with the music.
export function fx({clip, other = null, subject = "", source = "sheet", audio = null, abc = "", songSpec = null, cueSheet = "", score = null,
                    layers = [], beds = [], sound = true, seconds = 4.46, start = 0, prefix = "valis/fx", loop = false}) {
  const g = {
    "16": N("LoadVideo", {file: clip}),
    "17": N("GetVideoComponents", {video: ["16", 0]}),
  };
  // start: where this clip begins in the song. The cues are shifted so the clip's own clock starts at 0, and the sound
  // design gets the song from there, so a film's shots can each take their place in one song.
  const cues = {cue_sheet: source === "sheet" ? cueSheet : "", duration: 0, offset: -start, bpm_hint: 0, ...(abc ? {abc} : {})};
  let music = null;
  if (source === "song" && audio) { g["45"] = N("LoadAudio", {audio}); music = ["45", 0]; }
  if (source === "write" && songSpec) { const s = song({...songSpec, prefix: prefix + "_song"}); Object.assign(g, s.graph); music = s.audio; cues.abc = s.abc; }
  if (source === "score" && score) { g["70"] = N("ValisScoreLoad", {score}); cues.score = ["70", 0]; }
  if (music) cues.music = music;
  g["50"] = N("ValisCues", cues);
  let prev = null;
  layers.forEach((l, k) => {
    const id = String(60 + k);
    g[id] = N("ValisLayer", {effect: l.effect, on: l.on || "", by: l.by || "", params: JSON.stringify(l.params || {}), ...(prev ? {stack: [prev, 0]} : {})});
    prev = id;
  });
  const r = {images: ["17", 0], cues: ["50", 0], stack: [prev, 0], fps: 24, start: 0};
  if (other) { g["40"] = N("LoadVideo", {file: other}); g["41"] = N("GetVideoComponents", {video: ["40", 0]}); r.other = ["41", 0]; }
  if (subject) { Object.assign(g, personMatte(["17", 0], subject, 30, 10)); r.subject = ["33", 0]; }
  // loop: the clip already loops (Create · Loop); the stack is rendered so it loops with it (Valis Loop · Render: the cues
  // repeat, every effect is played once round first, what still differs is sealed), the clip keeps its own sound, plus a GIF
  if (loop) {
    g["80"] = N("ValisLoopRender", {...r, warmup: -1, seal: 12});
    g["81"] = N("CreateVideo", {images: ["80", 0], fps: 24, audio: ["17", 1]});
    g["82"] = N("SaveVideo", {video: ["81", 0], filename_prefix: prefix, format: "auto", codec: "auto"});
    g["83"] = N("ValisLoopSave", {images: ["80", 0], filename_prefix: prefix, format: "gif", fps: 24, gif_width: 480});
    return g;
  }
  g["80"] = N("ValisRender", r);
  const vid = {images: ["80", 0], fps: 24};
  if (sound || music) {
    let seg = music;
    if (music && start) { g["46"] = N("TrimAudioDuration", {audio: music, start_index: start, duration: seconds}); seg = ["46", 0]; }
    g["85"] = N("ValisSoundDesign", {cues: ["50", 0], duration: seconds, beds: beds.map(b => `${b}:.45`).join(", "), hits: "", music_gain: 0.9, duck: 0.3, seed: 1,
      ...(sound ? {stack: [prev, 0]} : {}), ...(seg ? {music: seg} : {})});
    vid.audio = ["85", 0];
  }
  g["81"] = N("CreateVideo", vid);
  g["82"] = N("SaveVideo", {video: ["81", 0], filename_prefix: prefix, format: "auto", codec: "auto"});
  return g;
}

// ---------------------------------------------------------------- Genjutsu: video-to-video (Higgsfield's Genjutsu, open weights)
// The source clip's motion goes in as a control video (SDPose skeletons for new characters, Canny edges for a restyle)
// through the MiniMax H3 Fun ControlNet Union patched onto H3 ref2va; reference images (<Picture 1>, <Picture 2>...) set
// who and where; the clip's own sound is kept. mode: "motion" | "restyle" | "swap" (only `target` is regenerated: its
// SAM 3 mask goes to the ControlNet's inpaint input, the rest of the frame stays).
// keepRest (swap): H3 re-renders the whole frame even outside the mask (the face and sky drift), so the new object is
// composited back onto the untouched source through the mask (Valis Swap Match: feathered edge, grain, light wrap, no recolour).
export function genjutsu({video, refs = [], prompt, mode = "motion", control = mode === "motion" ? "pose" : "canny", seconds = 5,
                          start = 0, megapixels = 0.4, aspect = "9:16 (Portrait Widescreen)", strength = 1.0, steps = 20, turbo = false,
                          keepAudio = true, target = "", keepRest = true, cn = MODELS.funCN, canny = {low: 0.25, high: 0.6}, batchedCanny = false,
                          seed = 1086, prefix = "valis/genjutsu", engine}) {
  const g = {
    "v": N("LoadVideo", {file: video}),
    "vs": N("Video Slice", {video: ["v", 0], start_time: start, duration: seconds, strict_duration: false}),
    "vc": N("GetVideoComponents", {video: ["vs", 0]}),
    "res": N("ResolutionSelector", {aspect_ratio: aspect, megapixels, multiple: 32}),
    "sc": N("ImageScale", {image: ["vc", 0], upscale_method: "lanczos", width: ["res", 0], height: ["res", 1], crop: "center"}),
    "clip": N("CLIPLoader", {clip_name: MODELS.h3TE, type: "minimax", device: "default"}),
    "unet": N("UNETLoader", {unet_name: MODELS.h3ref, weight_dtype: "default"}),
    "vae": N("VAELoader", {vae_name: MODELS.h3VAE}),
    "avae": N("VAELoader", {vae_name: MODELS.h3AVAE}),
    "cn": N("ModelPatchLoader", {name: cn}),
  };
  if (control === "pose") Object.assign(g, poseNodes(["vc", 0]));
  // the core Canny node runs the whole clip on the GPU at once (out of memory at 576p x 9 s); Valis Canny batches it
  else g["ctl"] = batchedCanny ? N("ValisCanny", {image: ["sc", 0], low_threshold: canny.low, high_threshold: canny.high, batch: 8})
                               : N("Canny", {image: ["sc", 0], low_threshold: canny.low, high_threshold: canny.high});
  let model = ["unet", 0];
  if (turbo) { g["lt"] = N("LoraLoaderModelOnly", {model, lora_name: TURBO_LORA, strength_model: 1.0}); model = ["lt", 0]; }
  const apply = {model, model_patch: ["cn", 0], vae: ["vae", 0], control_video: ["ctl", 0], strength, start_percent: 0, end_percent: 1};
  if (mode === "swap") {
    Object.assign(g, {
      "sm": N("CheckpointLoaderSimple", {ckpt_name: MODELS.sam}),
      "st": N("CLIPTextEncode", {text: target, clip: ["sm", 1]}),
      "trk": N("SAM3_VideoTrack", {images: ["sc", 0], model: ["sm", 0], conditioning: ["st", 0], detection_threshold: 0.45, max_objects: 1, detect_interval: 5}),
      "tm": N("SAM3_TrackToMask", {track_data: ["trk", 0], object_indices: ""}),
      "mk": N("GrowMask", {mask: ["tm", 0], expand: 16, tapered_corners: true}),
    });
    Object.assign(apply, {mask: ["mk", 0], source_video: ["sc", 0]});
  }
  g["ap"] = N("MiniMaxH3FunControlNetApply", apply);
  const r2v = {clip: ["clip", 0], vae: ["vae", 0], audio_vae: ["avae", 0], prompt, width: ["res", 0], height: ["res", 1],
               length: frames24(seconds), ref_image_size: "match"};
  refs.forEach((ref, i) => { g[`ref${i}`] = N("LoadImage", {image: ref}); r2v[`ref_images.ref_image_${i}`] = [`ref${i}`, 0]; });
  g["r2v"] = N("MiniMaxH3ReferenceToVideo", r2v);
  Object.assign(g, {
    "sched": N("BasicScheduler", {model: ["ap", 0], scheduler: turbo ? "beta" : "simple", steps: turbo ? 8 : steps, denoise: 1.0}),
    "guide": N("BasicGuider", {model: ["ap", 0], conditioning: ["r2v", 0]}),
    "noise": N("RandomNoise", {noise_seed: seed}),
    "samp": N("KSamplerSelect", {sampler_name: turbo ? "er_sde" : "res_multistep"}),
    "run": N("SamplerCustomAdvanced", {noise: ["noise", 0], guider: ["guide", 0], sampler: ["samp", 0], sigmas: ["sched", 0], latent_image: ["r2v", 1]}),
    "dec": N("VAEDecode", {samples: ["run", 0], vae: ["vae", 0]}),
    "adec": N("VAEDecodeAudio", {samples: ["run", 0], vae: ["avae", 0]}),
    "out": N("CreateVideo", {images: mode === "swap" && keepRest ? ["keep", 0] : ["dec", 0], fps: 24.0, audio: keepAudio ? ["vc", 1] : ["adec", 0]}),
    "save": N("SaveVideo", {video: ["out", 0], filename_prefix: prefix, format: "auto", codec: "auto"}),
    "cvs": N("ImageScale", {image: ["ctl", 0], upscale_method: "lanczos", width: ["res", 0], height: ["res", 1], crop: "center"}),
    "cv": N("CreateVideo", {images: ["cvs", 0], fps: 24.0}),
    "csave": N("SaveVideo", {video: ["cv", 0], filename_prefix: `${prefix}_control`, format: "auto", codec: "auto"}),
  });
  if (mode === "swap" && keepRest)
    g["keep"] = N("ValisSwapMatch", {plate: ["sc", 0], swapped: ["dec", 0], mask: ["mk", 0], color: 0.0, grain: true, soften: true, light_wrap: 0.15});
  return withRefEngine(g, engine);
}

// The pose skeleton Motion Transfer is driven by: RT-DETR finds the person, SDPose reads 133 keypoints, drawn OpenPose-style.
function poseNodes(images) {
  return {
    "pr": N("ResizeImageMaskNode", {input: images, resize_type: "scale longer dimension", "resize_type.longer_size": 1024, scale_method: "lanczos"}),
    "pm": N("CheckpointLoaderSimple", {ckpt_name: MODELS.sdpose}),
    "dm": N("UNETLoader", {unet_name: MODELS.detr, weight_dtype: "default"}),
    "det": N("RTDETR_detect", {model: ["dm", 0], image: ["pr", 0], threshold: 0.5, class_name: "person", max_detections: 2}),
    "kp": N("SDPoseKeypointExtractor", {model: ["pm", 0], vae: ["pm", 2], image: ["pr", 0], bboxes: ["det", 0], batch_size: 16}),
    "ctl": N("SDPoseDrawKeypoints", {keypoints: ["kp", 0], draw_body: true, draw_hands: true, draw_face: true, draw_feet: true,
                                     stick_width: 4, face_point_size: 2, score_threshold: 0.5, draw_head: true}),
  };
}
// Source check for Motion Transfer: only the pose step (about a minute, no video model). Valis Pose Check scores every
// frame and finds the best window; the report (json), a timeline strip and the skeleton video are saved.
export function poseCheck({video, start = 0, seconds = 15, prefix = "valis/posecheck"}) {
  return {
    "v": N("LoadVideo", {file: video}),
    "vs": N("Video Slice", {video: ["v", 0], start_time: start, duration: seconds, strict_duration: false}),
    "vc": N("GetVideoComponents", {video: ["vs", 0]}),
    ...poseNodes(["vc", 0]),
    "chk": N("ValisPoseCheck", {keypoints: ["kp", 0], fps: ["vc", 2], score_threshold: 0.5}),
    "rep": N("SaveText", {text: ["chk", 0], filename_prefix: `${prefix}_report`, format: "json"}),
    "tl": N("SaveImage", {images: ["chk", 1], filename_prefix: `${prefix}_timeline`}),
    // the skeleton frames keep the clip's aspect at 1024 on the long side, which can be an odd width: h264 needs even sizes
    "cte": N("ResizeImageMaskNode", {input: ["ctl", 0], resize_type: "scale to multiple", "resize_type.multiple": 2, scale_method: "lanczos"}),
    "cv": N("CreateVideo", {images: ["cte", 0], fps: ["vc", 2]}),
    "save": N("SaveVideo", {video: ["cv", 0], filename_prefix: `${prefix}_skeleton`, format: "auto", codec: "auto"}),
  };
}

// ---------------------------------------------------------------- Relight
// A still: Qwen Image 2.1 edit relights it (the open stand-in for Higgsfield Relight; Bria/Magnific relight nodes are
// partner APIs). A video: its first frame is relit that way, then the clip is re-rendered from its own edges (Canny,
// raised thresholds so the old shadows count less) with the relit frame as <Picture 1>: same people, place and motion,
// new light. The source's sound is kept.
export function relightImage({image, prompt, seed = 4242, prefix = "valis/relight"}) {
  return {"250": N("UnetLoaderGGUF", {unet_name: MODELS.qwen}), "251": N("CLIPLoader", {clip_name: MODELS.qwenTE, type: "qwen_image", device: "default"}),
          "252": N("VAELoader", {vae_name: MODELS.qwenVAE}), "img": N("LoadImage", {image}), ...qwenEdit(300, ["img", 0], prompt, seed, prefix)};
}
export function relightVideo({video, ref, light, seconds = 5, start = 0, megapixels = 0.4, cn = MODELS.funCN, strength = 0.85, seed = 1086, prefix = "valis/relight"}) {
  const prompt = `<Picture 1> is the first frame of this shot, relit: ${light}. The whole video is lit exactly like <Picture 1>, with the same people, ` +
    "clothes, place, camera and motion as the control video; only the light changes, and it stays the same from start to end. One continuous shot, no cuts, no text.";
  return genjutsu({video, refs: [ref], prompt, mode: "restyle", control: "canny", canny: {low: 0.35, high: 0.75}, seconds, start, megapixels, cn, strength, seed, prefix});
}

// ---------------------------------------------------------------- Extend (Cinema Studio) and Upscale (finish)
// Extend: continue a clip (forward) or lead into it (backward). The clip's last (or first) `overlap` frames are
// anchored in the new video with MiniMaxH3AddGuide so motion carries across the join; the joined clip and the new part
// are both saved. clipSeconds, width and height are the source's (the studio reads them from the video).
// Sound: H3 makes sound with the picture, so the new part's own audio (past the overlap) is joined onto the clip's.
export function extend({video, clipSeconds, width, height, action, seconds = 5, direction = "forward", overlap = 17, seed = 51101,
                        soundscape = "", prefix = "valis/extend"}) {
  const length = frames24(seconds), ov = overlap / 24;
  const g = {
    "v": N("LoadVideo", {file: video}),
    "vc": N("GetVideoComponents", {video: ["v", 0]}),
    "vsc": N("ImageScale", {image: ["vc", 0], upscale_method: "lanczos", width, height, crop: "center"}),
    "edge": N("Video Slice", {video: ["v", 0], start_time: direction === "forward" ? Math.max(0, clipSeconds - ov) : 0, duration: ov, strict_duration: false}),
    "ec": N("GetVideoComponents", {video: ["edge", 0]}),
    "es": N("ImageScale", {image: ["ec", 0], upscale_method: "lanczos", width, height, crop: "center"}),
    "1": N("UNETLoader", {unet_name: MODELS.h3i2v, weight_dtype: "default"}),
    "2": N("CLIPLoader", {clip_name: MODELS.h3TE, type: "minimax", device: "default"}),
    "3": N("VAELoader", {vae_name: MODELS.h3VAE}),
    "i2v": N("MiniMaxH3ImageToVideo", {clip: ["2", 0], vae: ["3", 0], width, height, length,
      prompt: "integrated_multimodal_description:\n[Shot 1] " + (direction === "forward" ? "The video continues seamlessly from its opening frames: " : "The video leads seamlessly into its closing frames: ")
        + action + " Same people, same place, same light, same camera style. One continuous shot, no cuts, no text.\n\noverall_soundscape:\n"
        + (soundscape || (direction === "forward" ? "The same sounds carry on without a break." : "The same sounds, already under way.")) + "\n\nnon_diegetic_music:\nN/A"}),
    "gd": N("MiniMaxH3AddGuide", {positive: ["i2v", 0], latent: ["i2v", 1], frame_idx: direction === "forward" ? 0 : length - overlap, vae: ["3", 0], image: ["es", 0]}),
    "16": N("MiniMaxH3SigmaShift", {model: ["1", 0], shift_video: 12.0, shift_audio: 3.0}),
    "10": N("BasicScheduler", {model: ["16", 0], scheduler: "simple", steps: 8, denoise: 1.0}),
    "acc": N("MiniMaxH3PDDAccApply", {model: ["16", 0], pdd_file: MODELS.pdd, nfe: "8", lora_strength: 1.0, head_strength: 1.0, on_off_grid: "error", enabled: true, partition: "", partition_check: "error", bypass_sigmas: ["10", 0]}),
    "7": N("BasicGuider", {model: ["acc", 0], conditioning: ["gd", 0]}),
    "8": N("RandomNoise", {noise_seed: seed}),
    "9": N("KSamplerSelect", {sampler_name: "euler"}),
    "11": N("SamplerCustomAdvanced", {noise: ["8", 0], guider: ["7", 0], sampler: ["9", 0], sigmas: ["acc", 1], latent_image: ["i2v", 1]}),
    "12": N("VAEDecode", {samples: ["11", 0], vae: ["3", 0]}),
    "avae": N("VAELoader", {vae_name: MODELS.h3AVAE}),
    "adec": N("VAEDecodeAudio", {samples: ["11", 0], vae: ["avae", 0]}),
    "ext": N("CreateVideo", {images: ["12", 0], fps: 24.0, audio: ["adec", 0]}),
    "extsave": N("SaveVideo", {video: ["ext", 0], filename_prefix: `${prefix}_part`, format: "auto", codec: "auto"}),
  };
  if (direction === "forward") Object.assign(g, {
    "new": N("ImageFromBatch", {image: ["12", 0], batch_index: overlap, length: 4096}),
    "join": N("ImageBatch", {image1: ["vsc", 0], image2: ["new", 0]}),
    "anew": N("TrimAudioDuration", {audio: ["adec", 0], start_index: ov, duration: 60}),
    "aj": N("AudioConcat", {audio1: ["vc", 1], audio2: ["anew", 0], direction: "after"}),
    "out": N("CreateVideo", {images: ["join", 0], fps: 24.0, audio: ["aj", 0]}),
  });
  else Object.assign(g, {
    "new": N("ImageFromBatch", {image: ["12", 0], batch_index: 0, length: length - overlap}),
    "join": N("ImageBatch", {image1: ["new", 0], image2: ["vsc", 0]}),
    "anew": N("TrimAudioDuration", {audio: ["adec", 0], start_index: 0, duration: (length - overlap) / 24}),
    "aj": N("AudioConcat", {audio1: ["vc", 1], audio2: ["anew", 0], direction: "before"}),
    "out": N("CreateVideo", {images: ["join", 0], fps: 24.0, audio: ["aj", 0]}),
  });
  g["save"] = N("SaveVideo", {video: ["out", 0], filename_prefix: prefix, format: "auto", codec: "auto"});
  return g;
}

// Upscale: SeedVR2 3B (Q8 GGUF), tiled VAE and CPU offload so it fits a 12 GB card; keeps the clip's sound.
export function upscale({video, resolution = 1080, batch = 9, seed = 42, prefix = "valis/upscale"}) {
  return {
    "v": N("LoadVideo", {file: video}),
    "vc": N("GetVideoComponents", {video: ["v", 0]}),
    "dit": N("SeedVR2LoadDiTModel", {model: "seedvr2_ema_3b-Q8_0.gguf", device: "cuda:0", offload_device: "cpu", blocks_to_swap: 16}),
    "vae": N("SeedVR2LoadVAEModel", {model: "ema_vae_fp16.safetensors", device: "cuda:0", offload_device: "cpu", encode_tiled: true, decode_tiled: true}),
    "up": N("SeedVR2VideoUpscaler", {image: ["vc", 0], dit: ["dit", 0], vae: ["vae", 0], seed, resolution, max_resolution: 0, batch_size: batch,
      uniform_batch_size: false, color_correction: "lab", offload_device: "cpu"}),
    "out": N("CreateVideo", {images: ["up", 0], fps: ["vc", 2], audio: ["vc", 1]}),
    "save": N("SaveVideo", {video: ["out", 0], filename_prefix: prefix, format: "auto", codec: "auto"}),
  };
}

// ---------------------------------------------------------------- Film: one line in, a scored and cut short film out
// The planner is ComfyUI's own text generation on the Qwen3-VL 8B encoder Qwen Image already uses (open weights, on
// disk): it writes the shot list and the song brief as JSON. film.js runs the rest: YuE2 writes and performs the song,
// Krea 2 frames every shot, H3 shoots it, SAM 3 tracks the subject, the library fires one effect per shot on the song's
// lanes, the sound design is synthesized in its key, and the cut lands every shot on the song's bar lines.
export const FILM_EFFECTS = ["Shockwave", "Rays", "Echo", "Glitch", "Punch", "Frost", "Datamosh", "SlitScan", "Projector", "Lens", "Vertigo", "none"];
export const FILM_LANES = ["kick", "snare", "hat", "beat", "downbeat", "bar", "melody", "bass"];

export function filmPlanPrompt({idea, shots = 6, genre = null}) {
  return `You are the writer and director of a ${Math.round(shots * 4.5)}-second film with no dialogue. Idea: "${idea}".` +
    (genre ? ` Genre look: ${genre.name}. ${genre.style}` : "") + `
Write the plan as one JSON object and nothing else: no prose before or after it, no code fences.
{"title": "two or three words",
 "logline": "one sentence",
 "cast": [one object per character, at most three: {"name": "a short name used in the shots, e.g. the keeper", "look": "one sentence: age, hair, clothes, anything that must stay the same from shot to shot"}],
 "place": "one sentence describing the setting and its light",
 "song": {"style": "the music in at most twelve words: genre, instruments, mood, ending with the tempo, 108 BPM", "lyrics": "[Instrumental]"},
 "shots": [exactly ${shots} objects in story order, each
   {"who": [the names from the cast who are in this frame; an empty list for an empty scene],
    "keyframe": "one sentence: what the still frame shows, who and where, the framing (wide, medium or close) and the light",
    "motion": "one sentence: what moves during these four seconds",
    "subject": "two or three words naming the main thing in frame, for a tracker, e.g. the woman, the lantern",
    "effect": one of ${JSON.stringify(FILM_EFFECTS)},
    "on": one of ${JSON.stringify(FILM_LANES)}}]}
Rules: every shot is rendered on its own from its own sentence, so a character is only in a shot if "who" names them; not every shot needs everyone; vary the framing from shot to shot; build to an impact in the last third. Effects: Shockwave or Punch on downbeat for an impact, Rays on beat for a light source, Echo on beat for a moving body, Frost or Datamosh on kick for dread, Projector on bar for a memory, Lens on downbeat for the uncanny, Glitch on hat for machines, Vertigo on bar for a realisation, SlitScan on melody for time passing; "none" for a quiet shot.`;
}

export function filmPlan({idea, shots = 6, genre = null, prefix = "valis/film_plan"}) {
  return {
    "1": N("CLIPLoader", {clip_name: MODELS.llm, type: "qwen_image", device: "default"}),
    "2": N("TextGenerate", {clip: ["1", 0], prompt: filmPlanPrompt({idea, shots, genre}), max_length: 2200, sampling_mode: "off", thinking: false, use_default_template: true}),
    "3": N("SaveText", {text: ["2", 0], filename_prefix: prefix, format: "txt"}),
  };
}

// every shot's keyframe in one graph: Krea 2 loads once
export function filmKeyframes({prompts, seed = 7101, width = 768, height = 1344, prefix = "valis/film_key"}) {
  const g = {
    "1": N("UNETLoader", {unet_name: MODELS.krea, weight_dtype: "default"}),
    "2": N("CLIPLoader", {clip_name: MODELS.kreaTE, type: "krea2", device: "default"}),
    "3": N("VAELoader", {vae_name: MODELS.kreaVAE}),
    "4": N("EmptySD3LatentImage", {width, height, batch_size: 1}),
  };
  prompts.forEach((prompt, k) => {
    const b = 100 + 10 * k, i = (j) => String(b + j);
    g[i(0)] = N("CLIPTextEncode", {text: prompt, clip: ["2", 0]});
    g[i(1)] = N("ConditioningZeroOut", {conditioning: [i(0), 0]});
    g[i(2)] = N("KSampler", {model: ["1", 0], positive: [i(0), 0], negative: [i(1), 0], latent_image: ["4", 0], seed: seed + k, steps: 10, cfg: 1.0, sampler_name: "euler", scheduler: "simple", denoise: 1.0});
    g[i(3)] = N("VAEDecode", {samples: [i(2), 0], vae: ["3", 0]});
    g[i(4)] = N("SaveImage", {images: [i(3), 0], filename_prefix: `${prefix}_${k + 1}`});
  });
  return g;
}

// the cut: every shot trimmed to its bars and joined; each shot carries its own slice of the song and its sounds
// title: {text, subtitle, song, start, seconds, width, height}: a card over black after the last shot, with the song's tail
// under it (every chunk of the cut must carry audio of the same kind)
export function filmCut({shots, title = null, prefix = "valis/film"}) {
  const g = {}, vids = {};
  shots.forEach((s, k) => {
    g[`v${k}`] = N("LoadVideo", {file: s.file});
    g[`s${k}`] = N("Video Slice", {video: [`v${k}`, 0], start_time: 0, duration: s.seconds, strict_duration: false});
    vids[`videos.video${k}`] = [`s${k}`, 0];
  });
  if (title) {
    g["tc"] = N("ValisTitleCard", {title: title.text, subtitle: title.subtitle ?? "a Valis film", width: title.width, height: title.height, seconds: title.seconds, fps: 24.0, fade: 0.8});
    g["ta"] = N("LoadAudio", {audio: title.song});
    g["tt"] = N("TrimAudioDuration", {audio: ["ta", 0], start_index: title.start, duration: title.seconds});
    g["tv"] = N("CreateVideo", {images: ["tc", 0], fps: 24.0, audio: ["tt", 0]});
    vids[`videos.video${shots.length}`] = ["tv", 0];
  }
  g["cat"] = N("ConcatenateVideo", {...vids, codec: "auto"});
  g["save"] = N("SaveVideo", {video: ["cat", 0], filename_prefix: prefix, format: "auto", codec: "auto"});
  return g;
}

// ---------------------------------------------------------------- stereo: pictures hidden in noise (nodes_stereo.py)
// SAM 3 finds the thing and Depth Anything 3 gives its relief; Valis Mask Depth rounds the silhouette; a spinning solid
// joins it (Valis Depth Shape / Place); Valis Stereogram hides it all in a field of dots that you free-view; Valis
// Kinetogram makes the motion-only version in live static; Valis Stereo Decode reads the depth back after H.264 (check).
export function stereo({video, target = "person", maxObjects = 2, viewing = "parallel", shape = "torus", shapeFrames = 96,
                        kind = "dots", dotSize = 6, refresh = 1, mbps = 4, prefix = "valis/stereo"}) {
  return {
    "1": N("LoadVideo", {file: video}),
    "2": N("GetVideoComponents", {video: ["1", 0]}),
    "3": N("CheckpointLoaderSimple", {ckpt_name: MODELS.sam}),
    "4": N("CLIPTextEncode", {text: target, clip: ["3", 1]}),
    "5": N("SAM3_VideoTrack", {images: ["2", 0], model: ["3", 0], conditioning: ["4", 0], detection_threshold: 0.45, max_objects: maxObjects, detect_interval: 5}),
    "6": N("SAM3_TrackToMask", {track_data: ["5", 0], object_indices: ""}),
    "7": N("LoadDA3Model", {model_name: MODELS.da3, weight_dtype: "default"}),
    "8": N("DA3Inference", {da3_model: ["7", 0], image: ["2", 0], resolution: 504, resize_method: "upper_bound_resize", mode: "mono"}),
    "9": N("DA3Render", {da3_geometry: ["8", 0], output: "depth", "output.normalization": "min_max", "output.apply_sky_clip": false}),
    "10": N("ValisMaskDepth", {mask: ["6", 0], relief: ["9", 0], thickness: 0.06, profile: "dome", edge: 0.4, near: 1.0, smooth: 2.0, temporal: 0.0,
      relief_amount: 0.35, relief_far_is_white: false}),
    "11": N("ValisDepthShape", {shape, frames: shapeFrames, width: 512, height: 512, size: 0.85, spin_x: 0.5, spin_y: 1.0, spin_z: 0.0, tilt_x: 20, edge: 0.35, near: 0.9}),
    "12": N("ValisDepthPlace", {depth: ["11", 0], mask: ["11", 1], scene: ["10", 0], width: 0, height: 0, x: 0.2, y: 0.32, scale: 0.42, x_end: 0.32, y_end: 0.28,
      scale_end: 0, depth_gain: 1.0, depth_offset: 0.0, start_frame: 0, when_shorter: "loop", field: "flat", field_depth: 0.0, field_amount: 0.15}),
    "13": N("ValisStereogram", {depth: ["12", 0], period: 0, strength: 0.18, viewing, anchor: "center", kind, dot_size: dotSize, refresh_every: refresh, drift: 0.0,
      guide_dots: true, seed: 0, width: 0, height: 0, depth_far_is_white: false}),
    "14": N("CreateVideo", {images: ["13", 0], fps: ["2", 2]}),
    "15": N("SaveVideo", {video: ["14", 0], filename_prefix: `${prefix}_${viewing}`, format: "auto", codec: "auto"}),
    "16": N("ValisStereoDecode", {frames: ["13", 0], depth: ["12", 0], period: 0, strength: 0.18, viewing, window: 3 * dotSize + 1, codec: "h264", bitrate_mbps: mbps, fps: 24}),
    "17": N("CreateVideo", {images: ["16", 0], fps: ["2", 2]}),
    "18": N("SaveVideo", {video: ["17", 0], filename_prefix: `${prefix}_decoded`, format: "auto", codec: "auto"}),
    "19": N("PreviewAny", {source: ["16", 2]}),
    "20": N("ValisKinetogram", {mask: ["6", 0], motion: "follow", drift_x: 0.0, drift_y: 1.5, kind: "dots", dot_size: 4, field_drift_x: 0.0, field_drift_y: 0.0, seed: 0,
      field_refresh: 1}),
    "21": N("CreateVideo", {images: ["20", 0], fps: ["2", 2]}),
    "22": N("SaveVideo", {video: ["21", 0], filename_prefix: `${prefix}_kinetogram`, format: "auto", codec: "auto"}),
  };
}
