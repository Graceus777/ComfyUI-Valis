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
  h3i2vFull: "minimax_h3_fl2va_pruned_int8_convrot.safetensors",   // full quality: int8 weights, the undistilled recipe
  h3refFast: FAST_REF,      // FastH3 OmniRef: ref2va distilled to 8 steps (refengine.js)
  h3TE: "qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors", h3VAE: "minimax_h3_video_vae_fp16.safetensors",
  h3AVAE: "minimax_h3_audio_vae_fp32.safetensors", pdd: "MiniMax-H3-FL2VA-Acc-8Step.safetensors",
  qwen: "qwen_image_2.1-Q6_K.gguf", qwenTE: "qwen3vl_8b_w4a8.safetensors", qwenVAE: "qwen_image_2.1_vae_bf16.safetensors",
  sam: "sam3.1_multiplex_fp16.safetensors",
  qwenOutpaint: "qwen-image-2.1-outpaint-v2.safetensors",              // Stage: the world past the frame
  kreaAnyPaint: "krea2_anypaint_rank32.safetensors",                   // yijunwang2/krea2-anypaint (Krea 2 Community License), with its ComfyUI nodes
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
// The colour grade on a result: a look's name, or {look, hex, strength} (a look with your own colours mapped through it,
// or look "custom" for the colours alone).
export function palNode(images, look) {
  const l = typeof look === "string" ? {look} : look;
  return N("ValisColorPalette", {images, look: l.look, strength: l.strength ?? 1.0, ...(l.hex ? {hex: l.hex} : {})});
}

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
// full: the int8 weights and the undistilled recipe (30 steps, res_multistep, no PDD), the ALLinONE pack's own i2v: ~3x
// the time of the 8-step w4a8 shot, for a shot whose motion came apart (full = 40 takes 40 steps)
function shotGraph({image, motion, width = 768, height = 1344, seconds = 4.46, seed = 51101, prefix = "valis/shot", soundscape, look = null, end = null, last = null, trimHold = false,
                    loras = [], raw = null, dolly = null, whip = null, full = false}) {
  const head = "For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.\n\nintegrated_multimodal_description:\n[Shot 1] ";
  const sound = `\n\noverall_soundscape:\n${soundscape || "Quiet room tone, soft natural ambience."}\n\nnon_diegetic_music:\nN/A`;
  // a trained move's prompt (raw) has no sound direction, and H3 then invents a score under the shot: give it the place's sound
  const rawSound = `\n\noverall_soundscape:\n${soundscape || "Only the natural sound of the place in the picture."}\n\nnon_diegetic_music:\nN/A`;
  // post steps in order: trim the anchored hold -> dolly lock -> whip ramp -> colour palette
  const th = trimHold ? ["th", 0] : ["12", 0], dz = dolly ? ["dz", 0] : th, wp = whip ? ["wp", 0] : dz, pal = look ? ["pal", 0] : wp;
  return {
    "1": N("UNETLoader", {unet_name: full ? MODELS.h3i2vFull : MODELS.h3i2v, weight_dtype: "default"}),
    "2": N("CLIPLoader", {clip_name: MODELS.h3TE, type: "minimax", device: "default"}),
    "3": N("VAELoader", {vae_name: MODELS.h3VAE}),
    "fa": N("LoadImage", {image}),
    "fs": N("ImageScale", {image: ["fa", 0], upscale_method: "lanczos", width, height, crop: "center"}),
    "6": N("MiniMaxH3ImageToVideo", {clip: ["2", 0], vae: ["3", 0], prompt: raw ? raw + rawSound : (head + motion + " One continuous shot, no cuts, no text." + sound), width, height, length: frames24(seconds), first_frame: ["fs", 0]}),
    ...Object.fromEntries(loras.map((l, i) => [`lo${i}`, N("LoraLoaderModelOnly", {model: i ? [`lo${i - 1}`, 0] : ["1", 0], lora_name: l.name, strength_model: l.strength ?? 1.0})])),
    "16": N("MiniMaxH3SigmaShift", {model: loras.length ? [`lo${loras.length - 1}`, 0] : ["1", 0], shift_video: 12.0, shift_audio: 3.0}),
    "10": N("BasicScheduler", {model: ["16", 0], scheduler: "simple", steps: full ? (full === true ? 30 : full) : 8, denoise: 1.0}),
    ...(full ? {} : {"acc": N("MiniMaxH3PDDAccApply", {model: ["16", 0], pdd_file: MODELS.pdd, nfe: "8", lora_strength: 1.0, head_strength: 1.0, on_off_grid: "error", enabled: true, partition: "", partition_check: "error", bypass_sigmas: ["10", 0]})}),
    "7": N("BasicGuider", {model: full ? ["16", 0] : ["acc", 0], conditioning: ["6", 0]}),
    "8": N("RandomNoise", {noise_seed: seed}),
    "9": N("KSamplerSelect", {sampler_name: full ? "res_multistep" : "euler"}),
    "11": N("SamplerCustomAdvanced", {noise: ["8", 0], guider: ["7", 0], sampler: ["9", 0], sigmas: full ? ["10", 0] : ["acc", 1], latent_image: ["6", 1]}),
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
    ...(look ? {"pal": palNode(wp, look)} : {}),
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
  if (look) { g["pal"] = palNode(img, look); img = ["pal", 0]; }
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
  if (look) g["pal"] = palNode(move.mirror ? ["mb", 0] : ["dec", 0], look);
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

// ---------------------------------------------------------------- loops (Extras · Loop)
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
  if (look) { g["pal"] = palNode(img, look); img = ["pal", 0]; }
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

function kreaEdit(b, img, prompt, seed, prefix, refBoost, subject = null, megapixels = 1.0, groundB = false) {
  const i = (k) => String(b + k), g = {};
  g[i(4)] = N("ImageScaleToTotalPixels", {image: img, upscale_method: "lanczos", megapixels, resolution_steps: 16});
  g[i(5)] = N("VAEEncode", {pixels: [i(4), 0], vae: ["202", 0]});
  g[i(6)] = N("GetImageSize", {image: [i(4), 0]});
  g[i(7)] = N("EmptySD3LatentImage", {width: [i(6), 0], height: [i(6), 1], batch_size: 1});
  const patch = {model: ["203", 0], source_latent: [i(5), 0], vae: ["202", 0], source_image: [i(4), 0], target_latent: [i(7), 0], ref_boost: refBoost, ref_boost_a: 1.0, fit_mode: "fit"};
  if (subject) patch.source_image_b = subject;
  g[i(8)] = N("Krea2EditModelPatch", patch);
  // groundB: the second picture (a look) is grounded in the prompt too, as the film frames do it. Cast leaves it out,
  // as it always has.
  const b2 = subject && groundB ? {image_b: subject} : {};
  g[i(9)] = N("Krea2EditGroundedEncode", {clip: ["201", 0], prompt, image: [i(4), 0], grounding_px: 768, system_prompt: "", ...b2});
  g[i(10)] = N("Krea2EditGroundedEncode", {clip: ["201", 0], prompt: "", image: [i(4), 0], grounding_px: 768, system_prompt: "", ...b2});
  g[i(11)] = N("KSampler", {model: [i(8), 0], positive: [i(9), 0], negative: [i(10), 0], latent_image: [i(7), 0], seed, steps: 10, cfg: 1.0, sampler_name: "euler", scheduler: "simple", denoise: 1.0});
  g[i(12)] = N("VAEDecode", {samples: [i(11), 0], vae: ["202", 0]});
  if (prefix) g[i(13)] = N("SaveImage", {images: [i(12), 0], filename_prefix: prefix});
  return g;
}

// One still in a look: the Transform's own first step (a Krea 2 identity edit) on a picture, with the look's reference
// picture if it has one. The look picker's thumbnails are made with it (tools/look_thumbs.mjs).
export function lookStill({image, prompt, refBoost = 1.0, lookRef = null, seed = 31, prefix = "valis/look", megapixels = 1.0}) {
  const g = {...kreaLoaders(), "40": N("LoadImage", {image})};
  let subject = null;
  if (lookRef) { g["41"] = N("LoadImage", {image: lookRef}); subject = ["41", 0]; }
  Object.assign(g, kreaEdit(300, ["40", 0], prompt, seed, prefix, refBoost, subject, megapixels, true));
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

// Remove: the masked region holds only what was behind them. (It used to share Transform's prompt, which names
// "<Subject 1> is the man ... fully preserved ... with the same motion as the source": the end-to-end test's clean
// Qwen plates came back with the man re-rendered in them.)
function h3RemovePrompt({who}) {
  return "subject_definitions:\n<Picture 1> and <Picture 2> show the scene with " + who + " taken out: only what was behind them." +
    "\n\nsummary:\n[video editing + reference generation] Inside the masked region there is no one and nothing: only the background continues, exactly as in <Picture 1> at the start and <Picture 2> at the end." +
    "\n\nretention_analysis:\nBackground: fully_preserved - the empty background inside the mask follows <Picture 1> and <Picture 2> in every frame, from the first to the last." +
    "\n\ndetailed_description:\n[Shot 1] The original camera, timing, lighting and everything outside the mask stay unchanged. Inside the mask " + who +
    " is gone: no person, no body, no face, no shadow of them; only the scene behind where they were, moving only with the camera." +
    "\n\noverall_soundscape:\nKeep the source soundtrack unchanged.\n\nnon_diegetic_music:\nN/A";
}
function h3Prompt({who, desc, keep, extra}) {
  return "subject_definitions:\n<Subject 1> is " + who + " as shown in <Picture 1> and <Picture 2>: " + desc + "." + (extra || "") +
    "\n\nsummary:\n[video editing + reference generation] Inside the masked region " + who + " is " + desc + " for the whole video, exactly as in <Picture 1>." +
    "\n\nretention_analysis:\n<Subject 1>: fully_preserved - " + keep + " follow <Picture 1> in every frame, from the first to the last." +
    "\n\ndetailed_description:\n[Shot 1] The original camera, timing, lighting and everything outside the mask stay unchanged. Inside the mask " + who + " is " + desc +
    " in every frame, with the same motion as the source; it matches <Picture 1> at the start and <Picture 2> at the end." +
    "\n\noverall_soundscape:\nKeep the source soundtrack unchanged.\n\nnon_diegetic_music:\nN/A";
}

// ---------------------------------------------------------------- Remove: the H3 Person Remover LoRA (Akatz Labs, V1)
// Painting the mask out with plain H3 ref2va (a latent noise mask over a tracked crop, Qwen plates as references) put a
// person back in every time: a new man mid-shot (x06), another woman in a floral dress (x06b), a hooded figure with box
// masks. The LoRA was trained for exactly this: the source rides in as a reference video with the person painted solid
// green, a clean first frame (Qwen edit) is the first-frame guide and a reference picture, the whole frame is generated
// (12 steps, er_sde, CFG 1), and it fills the green with what was behind them. The result is then laid back over the
// source through the grown mask, so everything outside it is the original pixels (keepRest: false shows the raw pass).
// Recipe: huggingface.co/akatz-ai/MiniMax-H3-Person-Remover-LoRA (single window here: our clips are up to 15 s).
export const REMOVER_LORA = "H3-Person-Remover-V1.safetensors";
export const REMOVER_PROMPT = "Remove the green-masked person and reconstruct the background. Preserve the rest of the video, including its camera motion and frame timing.";
export function removePerson({video, audio, target, anchorPrompt, grow = 8, megapixels = 0.6, steps = 12, seed = 904234, keepRest = true,
                              maxSeconds = 15, prefix = "valis/remove", engine}) {
  const g = track(video, target, {audio, grow, maxSeconds});
  Object.assign(g, {
    // the size H3 works at (the source's shape, a 32 px grid); the mask follows it
    "s0": N("ImageScaleToTotalPixels", {image: ["18", 0], upscale_method: "lanczos", megapixels, resolution_steps: 32}),
    "s1": N("GetImageSize", {image: ["s0", 0]}),
    "m0": N("MaskToImage", {mask: ["23", 0]}),
    "m1": N("ImageScale", {image: ["m0", 0], upscale_method: "bilinear", width: ["s1", 0], height: ["s1", 1], crop: "disabled"}),
    "m2": N("ImageToMask", {image: ["m1", 0], channel: "red"}),
    "m3": N("ThresholdMask", {mask: ["m2", 0], value: 0.5}),
    // the guide: the source with the person painted pure green (#00ff00)
    "gr": N("EmptyImage", {width: ["s1", 0], height: ["s1", 1], batch_size: 1, color: 65280}),
    "gg": N("ImageCompositeMasked", {destination: ["s0", 0], source: ["gr", 0], x: 0, y: 0, resize_source: false, mask: ["m3", 0]}),
    // the clean first frame: Qwen Image 2.1 takes them out of frame 0, sized exactly like the guide
    "250": N("UnetLoaderGGUF", {unet_name: MODELS.qwen}), "251": N("CLIPLoader", {clip_name: MODELS.qwenTE, type: "qwen_image", device: "default"}),
    "252": N("VAELoader", {vae_name: MODELS.qwenVAE}),
    "f0": N("ImageFromBatch", {image: ["s0", 0], batch_index: 0, length: 1}),
    ...qwenEdit(300, ["f0", 0], anchorPrompt || REMOVE_PROMPT_FALLBACK(target), 3, null),
    "cf": N("ImageScale", {image: ["303", 0], upscale_method: "lanczos", width: ["s1", 0], height: ["s1", 1], crop: "center"}),
    // Qwen can drift the framing (a slight zoom); the LoRA wants the source's exact framing, so the clean frame is the
    // source's own frame 0 with Qwen's fill only inside the person's grown, feathered mask
    "k0": N("ImageFromBatch", {image: ["m1", 0], batch_index: 0, length: 1}),
    "k1": N("ImageToMask", {image: ["k0", 0], channel: "red"}),
    "k2": N("GrowMask", {mask: ["k1", 0], expand: 16, tapered_corners: true}),
    "k3": N("MaskToImage", {mask: ["k2", 0]}),
    "k4": N("ImageBlur", {image: ["k3", 0], blur_radius: 6, sigma: 3.0}),
    "k5": N("ImageToMask", {image: ["k4", 0], channel: "red"}),
    "cc": N("ImageCompositeMasked", {destination: ["f0", 0], source: ["cf", 0], x: 0, y: 0, resize_source: false, mask: ["k5", 0]}),
    "cfs": N("SaveImage", {images: ["cc", 0], filename_prefix: `${prefix}_anchor_first`}),
    // H3 ref2va + the LoRA
    "1": N("CLIPLoader", {clip_name: MODELS.h3TE, type: "minimax", device: "default"}),
    "2": N("UNETLoader", {unet_name: MODELS.h3ref, weight_dtype: "default"}),
    "3": N("VAELoader", {vae_name: MODELS.h3VAE}),
    "4": N("VAELoader", {vae_name: MODELS.h3AVAE}),
    "5": N("MiniMaxH3SigmaShift", {model: ["2", 0], shift_video: 12.0, shift_audio: 3.0}),
    "lo": N("LoraLoaderModelOnly", {model: ["5", 0], lora_name: REMOVER_LORA, strength_model: 1.0}),
    // The references (the green video, the clean first frame) reach only the text encoder, as in the LoRA's own workflow
    // (no VAE on this node); the clean frame is also the guide at frame 0. Tried Oct 24 and worse: the VAE on the
    // references (the person painted back), and the green video as the guide clip (H3 painted the person magenta).
    "6": N("MiniMaxH3ReferenceToVideo", {clip: ["1", 0], prompt: REMOVER_PROMPT, width: ["s1", 0], height: ["s1", 1], length: ["18", 4], ref_image_size: "match",
                                          "ref_videos.ref_video_0": ["gg", 0], "ref_images.ref_image_0": ["cc", 0]}),
    "7": N("MiniMaxH3AddGuide", {positive: ["6", 0], latent: ["6", 1], frame_idx: 0, vae: ["3", 0], image: ["cc", 0]}),
    "8": N("CFGGuider", {model: ["lo", 0], positive: ["7", 0], negative: ["7", 0], cfg: 1.0}),
    "9": N("RandomNoise", {noise_seed: seed}),
    "10": N("KSamplerSelect", {sampler_name: "er_sde"}),
    "11": N("BasicScheduler", {model: ["lo", 0], scheduler: "simple", steps, denoise: 1.0}),
    "12": N("SamplerCustomAdvanced", {noise: ["9", 0], guider: ["8", 0], sampler: ["10", 0], sigmas: ["11", 0], latent_image: ["6", 1]}),
    "13": N("LTXVSeparateAVLatent", {av_latent: ["12", 0]}),
    "14": N("VAEDecode", {samples: ["13", 0], vae: ["3", 0]}),
    // back at the source's size; outside the grown, feathered mask the source's own pixels
    "15": N("GetImageSize", {image: ["18", 0]}),
    "16u": N("ImageScale", {image: ["14", 0], upscale_method: "lanczos", width: ["15", 0], height: ["15", 1], crop: "disabled"}),
    // the mask grown 16 px and feathered 8 (core nodes only)
    "17g": N("GrowMask", {mask: ["23", 0], expand: 16, tapered_corners: true}),
    "17i": N("MaskToImage", {mask: ["17g", 0]}),
    "17b": N("ImageBlur", {image: ["17i", 0], blur_radius: 8, sigma: 4.0}),
    "17k": N("ImageToMask", {image: ["17b", 0], channel: "red"}),
    "18k": N("ImageCompositeMasked", {destination: ["18", 0], source: ["16u", 0], x: 0, y: 0, resize_source: false, mask: ["17k", 0]}),
    "50": N("MaskToImage", {mask: ["23", 0]}),
    "51": N("CreateVideo", {images: ["50", 0], fps: 24}),
    "52": N("SaveVideo", {video: ["51", 0], filename_prefix: `${prefix}_matte`, format: "auto", codec: "auto"}),
    "53": N("CreateVideo", {images: ["gg", 0], fps: ["18", 3]}),
    "54": N("SaveVideo", {video: ["53", 0], filename_prefix: `${prefix}_guide`, format: "auto", codec: "auto"}),
    "60": N("CreateVideo", {images: keepRest ? ["18k", 0] : ["16u", 0], fps: ["18", 3], audio: ["18", 2]}),
    "61": N("SaveVideo", {video: ["60", 0], filename_prefix: prefix, format: "auto", codec: "auto"}),
    "62": N("CreateVideo", {images: keepRest ? ["16u", 0] : ["18k", 0], fps: ["18", 3], audio: ["18", 2]}),
    "63": N("SaveVideo", {video: ["62", 0], filename_prefix: `${prefix}_${keepRest ? "raw" : "kept"}`, format: "auto", codec: "auto"}),
  });
  return g;                     // always the base ref2va: the LoRA was trained on it, not on FastH3's distilled weights
}
const REMOVE_PROMPT_FALLBACK = (t) => `Remove ${t} from the picture completely: show only what is behind it, the background continuing naturally where it was. Keep everything else in the picture exactly the same.`;

// mode: "transform" (Krea anchors), "remove" (the Person Remover LoRA; plainRemove: the old Qwen plates + masked H3), "swap"
export function edit({mode, video, audio, target, anchorPrompt, desc, who = "the subject", keep = "its shape and material",
                      refBoost = 0.5, grow = 12, crop = 1.3, character = null, lookRef = null, lastFrame = -1, maxSeconds = 15, prefix = "valis/edit", engine, plainRemove = false,
                      megapixels}) {
  if (mode === "remove" && !plainRemove) return removePerson({video, audio, target, anchorPrompt, grow, maxSeconds, prefix, ...(megapixels ? {megapixels} : {})});
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
    // a transform's reference picture: what the look is (dropped, or painted from words)
    if (mode === "transform" && lookRef) { g["60"] = N("LoadImage", {image: lookRef}); subject = ["60", 0]; }
    const gb = mode === "transform" && !!lookRef;
    Object.assign(g, kreaEdit(300, ["46", 0], anchorPrompt, 31, `${prefix}_anchor_first`, refBoost, subject, 1.0, gb),
                     kreaEdit(320, ["47", 0], anchorPrompt, 31, `${prefix}_anchor_last`, refBoost, subject, 1.0, gb));
    first = ["312", 0]; last = ["332", 0];
  }
  const refs = {"ref_images.ref_image_0": first, "ref_images.ref_image_1": last, "ref_audios.ref_audio_0": ["18", 1]};
  let extra = "";
  if (mode === "swap" && character) { refs["ref_images.ref_image_2"] = ["60", 0]; extra = " <Picture 3> shows the same character up close."; }
  if (mode === "transform" && lookRef) { refs["ref_images.ref_image_2"] = ["60", 0]; extra = " <Picture 3> shows the look up close."; }
  // The One Node pack's H3IdentityAnchor sets the keyframe list to its own frame, so of two chained anchors only the one
  // applied last is kept. It used to be first-then-last: the last frame was the look and the shot started from the
  // source (a stag-headed spirit came out an ordinary man for two seconds). The first frame is applied last now, so the
  // shot starts in the look; the last frame still goes to H3 as <Picture 2>. (Core MiniMaxH3AddGuide adds instead of
  // replacing, but on this masked ref2va latent neither of its frames took.)
  const anchor = (c, which, img) => N("H3IdentityAnchor", {conditioning: c, vae: ["3", 0], latent: ["6", 1], frame_count: ["18", 4], width: ["25", 0], height: ["25", 1], anchor: which, image: img});
  Object.assign(g, {
    "1": N("CLIPLoader", {clip_name: MODELS.h3TE, type: "minimax", device: "default"}),
    "2": N("UNETLoader", {unet_name: MODELS.h3ref, weight_dtype: "default"}),
    "3": N("VAELoader", {vae_name: MODELS.h3VAE}),
    "4": N("VAELoader", {vae_name: MODELS.h3AVAE}),
    "5": N("MiniMaxH3SigmaShift", {model: ["2", 0], shift_video: 8, shift_audio: 3}),
    "6": N("MiniMaxH3ReferenceToVideo", Object.assign({clip: ["1", 0], vae: ["3", 0], audio_vae: ["4", 0], prompt: mode === "remove" ? h3RemovePrompt({who}) : h3Prompt({who, desc, keep, extra}), width: ["25", 0], height: ["25", 1], length: ["18", 4], ref_image_size: "max"}, refs)),
    "62": anchor(["6", 0], "last", last), "65": anchor(["62", 0], "first", first),
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
// action: what they do. By default whatever the take shows (it said "facing the camera and talking straight into the lens",
// made for the cold open, and a man looking down at a photograph turned to the camera)
export function swapPrompt({target = "the man", look = "", action = "doing exactly what they do in <Video 1>, with the same gaze and timing"} = {}) {
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
// The library, in groups. Light comes first: those effects relight the shot itself (a flame's breath, a strike off-screen,
// headlights passing) and read as the scene's own light. Break & blend are strong graphic moments: one or two a film.
// presets: named settings of the same effect; the first is the default. A layer, a Score rule or a Film shot names one as
// "Effect:preset" ("Effect" alone is the first). A preset may say what it needs on top of the effect (one that
// falls onto another clip).
export const FX_GROUPS = [
  {id: "light", name: "Light", tip: "They relight the scene itself"},
  {id: "lens", name: "Camera & lens", tip: "The camera reacts"},
  {id: "time", name: "Time", tip: "The picture's time comes apart"},
  {id: "break", name: "Break & blend", tip: "Strong moments: one or two a film"},
];
export const LIBRARY = [
  // light
  {id: "Flicker", group: "light", name: "Flicker", blurb: "The scene's own light breathes like a practical.", needs: [], on: "beat", params: {style: "candle"},
   presets: [{id: "candle", name: "Candle", params: {style: "candle"}, tip: "Warm and irregular; a hit makes it gutter and flare back"},
             {id: "fire", name: "Fireplace", params: {style: "fire"}, tip: "Warmer and faster, flaring on the hits"},
             {id: "tube", name: "Strip light", params: {style: "tube"}, on: "downbeat", tip: "A fluorescent tube that stutters off and on, once a bar"},
             {id: "bulb", name: "Failing bulb", params: {style: "bulb"}, on: "downbeat", tip: "A steady hum that browns out, once a bar"}]},
  {id: "Firelight", group: "light", name: "Firelight", blurb: "Warm firelight from off-screen licks up the scene and flares on the hits.", needs: [], on: "beat", params: {at: "below"},
   presets: [{id: "hearth", name: "From below", params: {at: "below"}}, {id: "torch", name: "Torch at the side", params: {at: "left", reach: .6, speed: 1.4}},
             {id: "blaze", name: "Blaze", params: {at: "below", amount: 1.0, flare: 1.2, reach: 1.0}, tip: "The whole frame in the glow of something burning"}]},
  {id: "Lightning", group: "light", name: "Lightning", blurb: "A strike off-screen lights the room from one side: stuttering flashes, an afterglow, thunder. No bolt.", needs: [], on: "downbeat", params: {at: "left"},
   presets: [{id: "strike", name: "Strike", params: {at: "left"}}, {id: "above", name: "From above", params: {at: "top"}},
             {id: "distant", name: "Distant", params: {at: "right", strength: .45, strikes: 2, fill: .6}, tip: "Far off: a softer flicker of light"},
             {id: "storm", name: "Storm", params: {every: 4}, tip: "Every fourth hit, counted over the whole song"}]},
  {id: "Sweep", group: "light", name: "Light sweep", blurb: "A beam crosses the scene on each hit: headlights through a window, a lighthouse.", needs: [], on: "downbeat", params: {},
   presets: [{id: "headlights", name: "Headlights", params: {}}, {id: "lighthouse", name: "Lighthouse", params: {width: .18, dur: 1.0, strength: 1.2, tint: [.86, .93, 1.0]}}]},
  {id: "Glow", group: "light", name: "Glow", blurb: "Bright things bloom and halate like film around a light, breathing with the music.", needs: [], on: "beat", params: {},
   presets: [{id: "halation", name: "Halation", params: {}}, {id: "dream", name: "Dream", params: {base: .6, amount: .5, threshold: .5, radius: .045, halation: .2}},
             {id: "neon", name: "Neon", params: {threshold: .55, halation: 0, tint: [.86, .9, 1.0], amount: 1.0}}]},
  {id: "Rays", group: "light", name: "Light shafts", blurb: "Light streams out of the brightest thing in the frame on each hit: shafts, bloom, a cold streak.", needs: [], on: "beat", params: {},
   presets: [{id: "sun", name: "Sun shafts", params: {}}, {id: "moon", name: "Moonbeams", params: {tint: [.75, .85, 1.0], strength: .7, streak: .2}},
             {id: "candle", name: "Candle glow", params: {tint: [1.0, .78, .5], strength: .6, samples: 20, decay: .5, streak: 0}}]},
  {id: "Glint", group: "light", name: "Glint", blurb: "A star glint flashes on the brightest small point: a blade, an eye, a jewel.", needs: [], on: "downbeat", params: {},
   presets: [{id: "star", name: "Star", params: {}}, {id: "flash", name: "Lens flash", params: {rays: 2, size: .14, angle: 0}}, {id: "sparkle", name: "Sparkle", params: {size: .05, life: .25}}]},
  {id: "Rim", group: "light", name: "Rim light", blurb: "The subject's edge catches a back light on each hit.", needs: ["subject"], on: "beat", params: {},
   presets: [{id: "back", name: "Back light", params: {}}, {id: "cold", name: "Cold edge", params: {tint: [.75, .88, 1.0]}}, {id: "warm", name: "Warm edge", params: {tint: [1.0, .8, .55]}}]},
  {id: "Haze", group: "light", name: "Heat haze", blurb: "The air shimmers and rises above the hot, bright things in the frame.", needs: [], on: "beat", params: {},
   presets: [{id: "heat", name: "Above the fire", params: {}}, {id: "road", name: "Off the ground", params: {at: "bottom"}}, {id: "air", name: "Everywhere", params: {at: "all", base: .4, strength: .6}}]},
  // camera & lens
  {id: "Punch", group: "lens", name: "Punch", blurb: "A zoom kick and a colour split on the hits.", needs: [], on: "kick", params: {},
   presets: [{id: "kick", name: "Kick", params: {flash: 0, zoom: .02, split: 2}}, {id: "flash", name: "Flash", params: {flash: .25, zoom: .025, split: 3}, tip: "With a white flash: loud"}]},
  {id: "Shockwave", group: "lens", name: "Shockwave", blurb: "A ring of bent space races out from the subject on each hit.", needs: [], on: "downbeat", params: {at: "subject"},
   presets: [{id: "ripple", name: "Ripple", params: {strength: 9, glow: .15, chroma: .15, width: 22}},
             {id: "blast", name: "Blast", params: {}, tip: "The full ring with a bright front and a colour fringe"}]},
  {id: "Vertigo", group: "lens", name: "Vertigo", blurb: "A dolly zoom: the subject holds, the world rushes away.", needs: ["subject"], on: "", by: "loud", params: {}},
  {id: "Lens", group: "lens", name: "Gravity lens", blurb: "Space bends around the subject: an Einstein ring and a dark core.", needs: ["subject"], on: "kick", params: {}},
  {id: "Projector", group: "lens", name: "Projector", blurb: "Projected film: flicker, gate weave, scratches, dust.", needs: [], on: "beat", params: {},
   presets: [{id: "light", name: "Light touch", params: {flicker: .05, weave: .8, scratches: .3, dust: .25}}, {id: "reel", name: "Old reel", params: {}}]},
  // time
  {id: "Echo", group: "time", name: "Echo", blurb: "The subject sheds afterimages on every hit.", needs: ["subject"], on: "beat", params: {}},
  {id: "SlitScan", group: "time", name: "Slit-scan", blurb: "Time smears down the frame: every row lives a moment in the past.", needs: [], by: "loud", on: "", params: {map: "y"}},
  {id: "TimeSlip", group: "time", name: "Time slip", blurb: "Another era breaks through on the music: flicker cuts, a light-first bleed, burning holes.", needs: ["other"], on: "beat", params: {mode: "flicker", era: "daguerreotype"}},
  {id: "Datamosh", group: "time", name: "Datamosh", blurb: "The next frame never arrives: the picture is dragged along the motion.", needs: [], on: "kick", params: {}},
  {id: "Eras", group: "time", name: "Era cut", blurb: "Cuts to the other clip and back on every hit, each cut bleeding into the last.", needs: ["other"], on: "beat", params: {clips: ["a", "b"]}},
  // break & blend
  {id: "Frost", group: "break", name: "Frost", blurb: "Frost creeps in from the edges of the glass on each hit and thaws.", needs: [], on: "downbeat", params: {},
   presets: [{id: "breath", name: "Breath on glass", params: {}}, {id: "creep", name: "Creeping", params: {reach: .35, thaw: 0}, tip: "It stays and grows with every hit"},
             {id: "whiteout", name: "Whiteout", params: {reach: 1, thaw: 0, opacity: 1, crystals: .3, sparkle: .4, lift: .14}, tip: "The whole pane frosts over: loud"}]},
  {id: "Glitch", group: "break", name: "Glitch", blurb: "Blocks slip and channels split on the hits.", needs: [], on: "hat", params: {},
   presets: [{id: "slip", name: "Tape slip", params: {blocks: 6, shift: 14, split: 3}}, {id: "hard", name: "Hard", params: {}}]},
  {id: "Tear", group: "break", name: "Tear", blurb: "Reality rips along a seam; another scene burns behind it.", needs: ["other"], on: "", by: "loud", params: {}},
  {id: "DoubleExposure", group: "break", name: "Double exposure", blurb: "A silhouette becomes a window into another scene, screen-printed.", needs: ["subject", "other"], on: "beat", params: {}},
  {id: "Split", group: "break", name: "Split time", blurb: "The frame splits down the middle: the other clip on one side, a glowing seam between.", needs: ["other"], on: "downbeat", params: {clips: ["a", "b"]}},
];
// "Effect:preset" (or "Effect") -> the effect, its preset, and the settings and lanes to use
export function fxPreset(key) {
  const [id, pid] = String(key || "").split(":");
  const lib = LIBRARY.find(l => l.id === id);
  if (!lib) return null;
  const ps = lib.presets || [], preset = ps.find(x => x.id === pid) || ps[0] || null;
  return {lib, preset, id: lib.id, key: preset && preset !== ps[0] ? `${lib.id}:${preset.id}` : lib.id,
    name: preset && ps.length > 1 ? `${lib.name} · ${preset.name}` : lib.name, params: {...(lib.params || {}), ...(preset?.params || {})},
    needs: [...new Set([...(lib.needs || []), ...(preset?.needs || [])])], on: preset?.on || lib.on || "", by: lib.by || ""};
}
// every effect and preset as one list (the Score rules, a Film shot), by group
export const FX_CHOICES = LIBRARY.flatMap(l => (l.presets?.length ? l.presets : [null]).map((p, k) => {
  const f = fxPreset(p && k ? `${l.id}:${p.id}` : l.id);
  return {key: f.key, name: f.name, group: l.group, blurb: p?.tip || l.blurb};
}));
// the layer the renderer takes for a key on a lane
export function fxLayer(key, on, extra = {}) {
  const f = fxPreset(key);
  return f ? {effect: f.id, on: on ?? f.on, by: f.by, params: {...f.params, ...extra}} : null;
}
export const BEDS = ["rain", "wind", "sea", "fire", "room", "neon"];
export const CUE_SHEET_EXAMPLE = `# a soundless cue sheet: seconds or bar:beat, one cue per line
bpm 108 4/4
every 1 beat from 1:1 to 3:1 beat
every 1/2 beat from 1:1 to 3:1 hat
2:1   downbeat
1:3   kick
2:1   kick 1.2
2:3   kick
ramp loud 0 0 4.4 1`;

// YuE2 writes the sheet music (ABC), then sings and plays it. Returns the graph and where its audio and ABC come out.
// An instrumental (lyrics "[Instrumental]", or instrumental: true): "[Instrumental]" alone is not enough. YuE2's own
// sheet music still has a Vocal line in every verse and chorus, and it sings it (THE MAN IN THE SUIT, Oct 23: all three
// seeds came back with a voice). So, as the Plenio pack's cover path does it: the instrumental adapter (an AR LoRA on the
// CLIP slot, ar_lora_inst_v3abc, CC BY-NC 4.0), the lyrics as the adapter was trained ("[instrumental]"), and the score's
// Vocal melody moved to the instrument voice before the music is rendered (Plenio Score Tools), so the tune is played.
export const INSTRUMENTAL_LORA = "ar_lora_inst_v3abc_comfyui.safetensors";
// abc: your own sheet music (YuE2's native two-voice ABC: the melody in Ins, the chord symbols in Vocal), played as it
// is written instead of YuE2 writing its own
export function song({style, lyrics, seconds = 30, seed = 1843, base = 500, prefix = "valis/song", instrumental = /^\s*\[instrumental\]\s*$/i.test(lyrics || ""), abc = null}) {
  const i = (k) => String(base + k);
  const clip = instrumental ? [i(9), 1] : [i(0), 1];
  const words = instrumental ? "[instrumental]" : lyrics;
  const sheet = abc || (instrumental ? [i(10), 0] : [i(1), 0]);
  const g = {
    [i(0)]: N("CheckpointLoaderSimple", {ckpt_name: "yue2_3b_bf16.safetensors"}),
    ...(abc ? {} : {[i(1)]: N("YuE2GenerateABC", {clip, style, lyrics: words, seed, mode: "full", max_abc_tokens: 8192, temperature: 0.7, top_p: 0.9, top_k: 30, repetition_penalty: 1.005, penalty_window: 100})}),
    [i(2)]: N("YuE2GenerateMusic", {clip, style, lyrics: words, abc: sheet, seed, mode: "full", max_duration: seconds, temperature: 1, top_p: 0.95, top_k: 100, repetition_penalty: 1.2, cfg_scale: 1}),
    [i(3)]: N("ConditioningZeroOut", {conditioning: [i(2), 0]}),
    [i(4)]: N("EmptyYuE2LatentAudio", {seconds: [i(2), 1], batch_size: 1}),
    [i(5)]: N("KSampler", {model: [i(0), 0], positive: [i(2), 0], negative: [i(3), 0], latent_image: [i(4), 0], seed, steps: 32, cfg: 1, sampler_name: "dpm_2", scheduler: "sgm_uniform", denoise: 1}),
    [i(6)]: N("VAEDecodeAudio", {samples: [i(5), 0], vae: [i(0), 2]}),
    [i(7)]: N("SaveAudio", {audio: [i(6), 0], filename_prefix: prefix}),
    [i(8)]: N("SaveText", {text: sheet, filename_prefix: prefix + "_abc", format: "txt"}),
    ...(instrumental ? {
      [i(9)]: N("LoraLoader", {model: [i(0), 0], clip: [i(0), 1], lora_name: INSTRUMENTAL_LORA, strength_model: 0.0, strength_clip: 1.0}),
      ...(abc ? {} : {[i(10)]: N("PlenioScoreTools", {operation: "voices", "operation.vocal": "move Vocal melody to Ins", "operation.conflict": "replace Ins", score: [i(1), 0]})}),
    } : {}),
  };
  return {graph: g, audio: [i(6), 0], abc: sheet};
}

// A Valis score made from any music (or YuE2's sheet music, or a cue sheet, or several): Valis Cues hears it, Valis
// Score (make) lays it out in bars, sections and shots, and it is saved as JSON for the Score tab and Valis Score (load).
// audio: a file to load, or music: a link to audio made in the same graph; abc: sheet music (text or a link)
export function scoreMake({audio = null, music = null, abc = "", cueSheet = "", title = "untitled", bpm = 0, meter = 0, shotSeconds = 107 / 24, sectionBars = 8,
                           prefix = "valis/scores/score"}) {
  const g = {};
  if (audio) { g["a"] = N("LoadAudio", {audio}); music = ["a", 0]; }
  g["c"] = N("ValisCues", {cue_sheet: cueSheet, duration: 0, ...(music ? {music} : {}), ...(abc ? {abc} : {})});
  // a shot is as many whole bars as fit in one clip, counting a bar that ends up to 3 frames past it (the Film tab's rule,
  // film.js shotSeconds: at 106 BPM two bars are 4.53 s and an H3 clip 4.46 s, and the score cut every clip in half)
  g["m"] = N("ValisScoreMake", {cues: ["c", 0], title, shot_seconds: shotSeconds + 3 / 24, section_bars: sectionBars, bpm, meter});
  g["s"] = N("SaveText", {text: ["m", 1], filename_prefix: prefix, format: "json"});
  return g;
}
// YuE2 writes a song and plays it, and the score is made from its own sheet music and its audio, in one job
export function songScore({style, lyrics = "[Instrumental]", seconds = 30, seed = 1843, title = "untitled", prefix = "valis/scores/song", abc = null}) {
  const s = song({style, lyrics, seconds, seed, prefix, abc});
  return {...s.graph, ...scoreMake({music: s.audio, abc: s.abc, title, prefix})};
}

// The FX tab: a clip (+ another clip, a subject), cues from a song / a written song / a cue sheet / a score, a stack of
// library layers, and every layer's own sound mixed with the music.
// hold: a picture (a film shot's keyframe) every frame's colours are matched to first (core Transfer Color, MKL in Lab,
// frame by frame): H3 drifts the light over a shot, and SÉANCE's red lamp went warm white by the last second
export function fx({clip, other = null, subject = "", source = "sheet", audio = null, abc = "", songSpec = null, cueSheet = "", score = null,
                    layers = [], beds = [], sound = true, seconds = 4.46, start = 0, prefix = "valis/fx", loop = false, fit = false, hold = null, holdStrength = 1.0,
                    retime = false, own = false}) {
  const g = {
    "16": N("LoadVideo", {file: clip}),
    "17": N("GetVideoComponents", {video: ["16", 0]}),
  };
  let frames = ["17", 0];
  // retime (the studio sets it when Valis Frame Rate is loaded): a clip at another rate is played at 24 first, since every
  // effect, cue and cut here counts in 24. Wan 2.2's 16 fps camera moves came out 1.5x fast and a third short.
  if (retime) { g["17r"] = N("ValisFrameRate", {images: ["17", 0], source_fps: ["17", 2], fps: 24}); frames = ["17r", 0]; }
  // fit: the clip fills exactly `seconds` (a score's shot): a longer clip is cut there, a shorter one holds its last frame
  // to the bar line, so the shots cut together stay on the bars
  if (fit && !loop) {
    const want = Math.min(4096, Math.max(1, Math.round(seconds * 24)));
    g["18a"] = N("ImageFromBatch", {image: frames, batch_index: -1, length: 1});
    g["18b"] = N("RepeatImageBatch", {image: ["18a", 0], amount: want});
    g["18c"] = N("ImageBatch", {image1: frames, image2: ["18b", 0]});
    g["18"] = N("ImageFromBatch", {image: ["18c", 0], batch_index: 0, length: want});
    frames = ["18", 0];
  }
  if (hold) {
    g["hk"] = N("LoadImage", {image: hold});
    g["hc"] = N("ColorTransfer", {image_target: frames, image_ref: ["hk", 0], method: "mkl_lab", source_stats: "per_frame", strength: holdStrength});
    frames = ["hc", 0];
  }
  // start: where this clip begins in the song. The cues are shifted so the clip's own clock starts at 0, and the sound
  // design gets the song from there, so a film's shots can each take their place in one song.
  const cues = {cue_sheet: source === "sheet" ? cueSheet : "", duration: 0, offset: -start, bpm_hint: 0, ...(abc ? {abc} : {})};
  let music = null;
  // a score's song: the cues come from the score, the song is only mixed under the effects' sounds
  if ((source === "song" || source === "score") && audio) { g["45"] = N("LoadAudio", {audio}); music = ["45", 0]; }
  if (source === "write" && songSpec) { const s = song({...songSpec, prefix: prefix + "_song"}); Object.assign(g, s.graph); music = s.audio; cues.abc = s.abc; }
  if (source === "score" && score) { g["70"] = N("ValisScoreLoad", {score}); cues.score = ["70", 0]; }
  if (music && source !== "score") cues.music = music;
  g["50"] = N("ValisCues", cues);
  let prev = null;
  layers.forEach((l, k) => {
    const id = String(60 + k);
    g[id] = N("ValisLayer", {effect: l.effect, on: l.on || "", by: l.by || "", params: JSON.stringify(l.params || {}), ...(prev ? {stack: [prev, 0]} : {})});
    prev = id;
  });
  const r = {images: frames, cues: ["50", 0], stack: [prev, 0], fps: 24, start: 0};
  if (other) { g["40"] = N("LoadVideo", {file: other}); g["41"] = N("GetVideoComponents", {video: ["40", 0]}); r.other = ["41", 0]; }
  if (subject) { Object.assign(g, personMatte(frames, subject, 30, 10)); r.subject = ["33", 0]; }
  // loop: the clip already loops (Extras · Loop); the stack is rendered so it loops with it (Valis Loop · Render: the cues
  // repeat, every effect is played once round first, what still differs is sealed), the clip keeps its own sound, plus a GIF
  if (loop) {
    g["80"] = N("ValisLoopRender", {...r, warmup: -1, seal: 12});
    g["81"] = N("CreateVideo", {images: ["80", 0], fps: 24, audio: ["17", 1]});
    g["82"] = N("SaveVideo", {video: ["81", 0], filename_prefix: prefix, format: "auto", codec: "auto"});
    g["83"] = N("ValisLoopSave", {images: ["80", 0], filename_prefix: prefix, format: "gif", fps: 24, gif_width: 480});
    return g;
  }
  // no effect (a quiet shot): the frames go out as they are (the render needs a stack, and an empty one isn't a link)
  if (prev) g["80"] = N("ValisRender", r);
  const vid = {images: prev ? ["80", 0] : frames, fps: 24};
  // without a song the clip keeps its own sound (its voices, its room), at its own level: the effects' sounds go under
  // it. They used to replace it, and a talking clip came out of the FX tab with a room bed and no voice. own: the
  // studio sets it when the loaded Valis Sound Design can keep a sound's level (else a quiet room would be levelled up)
  const clipSound = ["17", 1];
  if (sound || music) {
    let seg = music;
    if (music && (start || !sound)) { g["46"] = N("TrimAudioDuration", {audio: music, start_index: start, duration: seconds}); seg = ["46", 0]; }
    // no effect sounds: the song goes out as it is. The sound design evens out each shot's loudness, and a composed score's
    // quiet dawn came out 13 dB louder than it was written, with a jump in level at every cut
    if (!sound && seg) vid.audio = seg;
    else {
      g["85"] = N("ValisSoundDesign", {cues: ["50", 0], duration: seconds, beds: beds.map(b => `${b}:.45`).join(", "), hits: "", music_gain: 0.9, duck: seg ? 0.3 : 0.15, seed: 1,
        ...(sound && prev ? {stack: [prev, 0]} : {}), ...(seg ? {music: seg} : own ? {music: clipSound, own: true} : {})});
      vid.audio = ["85", 0];
    }
  } else vid.audio = clipSound;
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
// what the film planner may pick (light first); a shot card can take any effect and preset (FX_CHOICES)
export const FILM_EFFECTS = ["Flicker", "Firelight", "Lightning", "Sweep", "Glow", "Rays", "Glint", "Haze", "Shockwave", "Echo", "Punch", "Projector",
  "Frost", "Datamosh", "SlitScan", "Glitch", "Lens", "Vertigo", "none"];
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
Rules: every shot is rendered on its own from its own sentence, so a character is only in a shot if "who" names them; not every shot needs everyone; vary the framing from shot to shot; build to an impact in the last third. Effects: prefer light that belongs to the scene: Flicker on beat for candles, lamps and fires in the frame, Firelight on beat for a fire just off-screen, Lightning on downbeat for a storm, Sweep on bar for headlights or a beam passing, Glow on melody for a dream or a lit night, Rays on beat for sun or moon through a gap, Glint on downbeat for a blade or a jewel, Haze on bar for heat; then Shockwave or Punch on downbeat for an impact, Echo on beat for a moving body, Projector on bar for a memory, Frost or Datamosh on kick for dread, SlitScan on melody for time passing, Glitch on hat for machines, Lens on downbeat for the uncanny, Vertigo on bar for a realisation; "none" for a quiet shot. Most shots should be light or "none"; save the strong effects for one or two moments.`;
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

// ---------------------------------------------------------------- Film: frames built from references (continuity)
// A film's stills are not painted one by one from words (every still a new room, new faces, a new head count): they are
// built from references. Each character has a sheet (a costume-test portrait), the set an empty plate per camera setup.
// One graph serves every step after the sheets and plates: a Krea 2 identity edit (lbouaraba/comfyui-krea2edit, the
// LoRA the studio's Transform and Stage already use) with two inputs, as it was trained: the scene, and the subject.
// (Seating people into a set is filmSeat, below.)
//   turn   an empty plate is the scene: the same empty place from another side (a new camera setup)
//   sheet  a sheet is the scene: a state of that character (soaked, drowned); or two sheets, scene and subject, make a
//          prop of both (their wedding photograph)
// Two people are placed in one pass, never one at a time (the LoRA's own advice); more than one subject goes in as one
// picture, side by side. Turbo, 8 steps, CFG 1, at most 2 MP.
// refs: [scene, ...subjects] (each {image}); crop: {x, y, w, h} as fractions of the scene, which is `from` pixels;
// size: {w, h} of the picture made
export function filmFrame({refs, prompt, seeds = [8401], crop = null, from = {w: 768, h: 1344}, size = {w: 768, h: 1344}, refBoost = 1.0, grounding = 1024, steps = 8, prefix = "valis/film_frame"}) {
  if (!refs?.length) throw new Error("filmFrame: no references");
  const g = kreaLoaders();
  refs.forEach((r, k) => { g[`r${k}`] = N("LoadImage", {image: r.image}); });
  let scene = ["r0", 0];
  if (crop) {
    const px = (v, n) => Math.max(0, Math.min(n, Math.round(v * n)));
    g["cr"] = N("ImageCrop", {image: scene, width: Math.max(16, px(crop.w, from.w)), height: Math.max(16, px(crop.h, from.h)), x: px(crop.x, from.w), y: px(crop.y, from.h)});
    g["cs"] = N("ImageScale", {image: ["cr", 0], upscale_method: "lanczos", width: size.w, height: size.h, crop: "center"});
    scene = ["cs", 0];
  }
  // the subjects, side by side in one picture (one subject: as it is)
  let subject = null;
  refs.slice(1).forEach((r, k) => {
    if (!subject) { subject = [`r${k + 1}`, 0]; return; }
    g[`st${k}`] = N("ImageStitch", {image1: subject, image2: [`r${k + 1}`, 0], direction: "right", match_image_size: true, spacing_width: 0, spacing_color: "white"});
    subject = [`st${k}`, 0];
  });
  if (subject && refs.length > 2) { g["sts"] = N("ImageScaleToTotalPixels", {image: subject, upscale_method: "lanczos", megapixels: 1.0, resolution_steps: 16}); subject = ["sts", 0]; }
  g["lat"] = N("EmptySD3LatentImage", {width: size.w, height: size.h, batch_size: 1});
  const patch = {model: ["203", 0], source_latent: ["lat", 0], vae: ["202", 0], source_image: scene, target_latent: ["lat", 0], ref_boost: refBoost, ref_boost_a: 1.0, fit_mode: "fit"};
  const enc = (text) => ({clip: ["201", 0], prompt: text, image: scene, grounding_px: grounding, system_prompt: "", ...(subject ? {image_b: subject} : {})});
  if (subject) patch.source_image_b = subject;
  g["mp"] = N("Krea2EditModelPatch", patch);
  g["pos"] = N("Krea2EditGroundedEncode", enc(prompt));
  g["neg"] = N("Krea2EditGroundedEncode", enc(""));
  seeds.forEach((seed, j) => {
    g[`k${j}`] = N("KSampler", {model: ["mp", 0], positive: ["pos", 0], negative: ["neg", 0], latent_image: ["lat", 0], seed, steps, cfg: 1.0, sampler_name: "euler", scheduler: "simple", denoise: 1.0});
    g[`d${j}`] = N("VAEDecode", {samples: [`k${j}`, 0], vae: ["202", 0]});
    g[`w${j}`] = N("SaveImage", {images: [`d${j}`, 0], filename_prefix: `${prefix}_${seed}`});
  });
  return g;
}

// A close-up cut from a frame: the box, enlarged by SeedVR2 (the studio's upscaler) to the film's size. It restores, it
// doesn't repaint: Krea 2 and Qwen, asked to re-render the box sharp, invented a face at its edge and took the medium out
// of her trance; SeedVR2 kept both as the frame has them. crop: {x, y, w, h} as fractions of the frame (`from` pixels).
export function filmCrop({frame, crop, from = {w: 768, h: 1344}, size = {w: 768, h: 1344}, seed = 42, prefix = "valis/film_crop"}) {
  const px = (v, n) => Math.max(0, Math.min(n, Math.round(v * n)));
  return {
    "l": N("LoadImage", {image: frame}),
    "cr": N("ImageCrop", {image: ["l", 0], width: Math.max(16, px(crop.w, from.w)), height: Math.max(16, px(crop.h, from.h)), x: px(crop.x, from.w), y: px(crop.y, from.h)}),
    "dit": N("SeedVR2LoadDiTModel", {model: "seedvr2_ema_3b-Q8_0.gguf", device: "cuda:0", offload_device: "cpu", blocks_to_swap: 16}),
    "vae": N("SeedVR2LoadVAEModel", {model: "ema_vae_fp16.safetensors", device: "cuda:0", offload_device: "cpu", encode_tiled: true, decode_tiled: true}),
    "up": N("SeedVR2VideoUpscaler", {image: ["cr", 0], dit: ["dit", 0], vae: ["vae", 0], seed, resolution: Math.min(size.w, size.h), max_resolution: 0, batch_size: 1,
      uniform_batch_size: false, color_correction: "lab", offload_device: "cpu"}),
    "fit": N("ImageScale", {image: ["up", 0], upscale_method: "lanczos", width: size.w, height: size.h, crop: "center"}),
    "save": N("SaveImage", {images: ["fit", 0], filename_prefix: `${prefix}_${seed}`}),
  };
}

// Seating people into a setup's empty plate: Qwen Image 2.1 with every reference in one sequence, the plate first (it
// sets the frame's size and camera), then a sheet a person at about half a megapixel. One pass, about a minute.
// Measured on SÉANCE against the Krea 2 identity edit, which is trained on one scene and one subject: three sheets as
// one subject lost the faces and seated the medium twice; one person a pass put the aunt in the medium's chair (and took
// four times as long). Qwen seated all three right, looking like their sheets. Every moment is seated fresh from the
// clean plate, with the moment in its words: an edit of an edit repaints the whole picture again and goes soft and dark.
export function filmSeat({plate, people, prompt, seed = 8401, steps = 25, prefix = "valis/film_seat"}) {
  const g = {
    "250": N("UnetLoaderGGUF", {unet_name: MODELS.qwen}),
    "251": N("CLIPLoader", {clip_name: MODELS.qwenTE, type: "qwen_image", device: "default"}),
    "252": N("VAELoader", {vae_name: MODELS.qwenVAE}),
    "plate": N("LoadImage", {image: plate}),
  };
  const enc = {clip: ["251", 0], prompt, negative_prompt: "", resolution: 0, vae: ["252", 0], "images.image_1": ["plate", 0]};
  (people || []).forEach((p, k) => {
    g[`p${k}`] = N("LoadImage", {image: p.image});
    g[`p${k}s`] = N("ImageScaleToTotalPixels", {image: [`p${k}`, 0], upscale_method: "lanczos", megapixels: 0.5, resolution_steps: 32});
    enc[`images.image_${k + 2}`] = [`p${k}s`, 0];
  });
  g["enc"] = N("TextEncodeQwenImage21", enc);
  g["ks"] = N("KSampler", {model: ["250", 0], positive: ["enc", 0], negative: ["enc", 1], latent_image: ["enc", 2], seed, steps, cfg: 1, sampler_name: "euler", scheduler: "simple", denoise: 1});
  g["dec"] = N("VAEDecode", {samples: ["ks", 0], vae: ["252", 0]});
  g["save"] = N("SaveImage", {images: ["dec", 0], filename_prefix: `${prefix}_${seed}`});
  return g;
}

// the cut: every shot trimmed to its bars and joined; each shot carries its own slice of the song and its sounds
// title: {text, subtitle, song, start, seconds, width, height}: a card over black after the last shot, with the song's tail
// under it (every chunk of the cut must carry audio of the same kind)
// song: {audio, start, seconds}: one unbroken stretch of the music under the whole cut instead of each shot's own sound
// (a score played as it is, joined back together at every cut, ticked at the joins)
// a clip's last frame as a still: the next shot starts exactly where this one ends (hard continuity), where a fresh
// still would paint the place and the people again from words
export function lastFrame({clip, prefix = "valis/last"}) {
  return {
    "1": N("LoadVideo", {file: clip}),
    "2": N("GetVideoComponents", {video: ["1", 0]}),
    "3": N("ImageFromBatch", {image: ["2", 0], batch_index: -1, length: 1}),
    "4": N("SaveImage", {images: ["3", 0], filename_prefix: prefix}),
  };
}

export function filmCut({shots, title = null, prefix = "valis/film", song = null}) {
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
  if (song) {
    g["sa"] = N("LoadAudio", {audio: song.audio});
    g["st"] = N("TrimAudioDuration", {audio: ["sa", 0], start_index: song.start, duration: song.seconds});
  }
  g["cat"] = N("ConcatenateVideo", {...vids, codec: "auto", ...(song ? {complete_audio: ["st", 0]} : {})});
  g["save"] = N("SaveVideo", {video: ["cat", 0], filename_prefix: prefix, format: "auto", codec: "auto"});
  return g;
}

// ---------------------------------------------------------------- stage
// One still -> named depth layers. SAM 3 finds each name ("the lamps:20" = up to 20 of them), Depth Anything 3 Small
// orders them, Valis Stage completes each layer behind the ones in front and writes output/valis/stage/<name>/.
// The world past the frame, painted: Valis Stage Surround puts the stage's still in the middle of a canvas twice as wide
// and tall (solid gray around it), Qwen Image 2.1 + the outpaint LoRA paints the gray out as a continuation of the
// scene (its trained instruction, ~1 min on 12 GB), and Valis Stage Dome writes the painting into the stage's dome.png.
export const OUTPAINT = "Outpaint the image: replace the solid gray areas with a seamless continuation of the scene, keeping the existing picture unchanged.";
// plate: the same job also paints behind the things standing in the scene. Valis Stage Clean Plate hands Krea 2 edit
// (the identity-edit LoRA, 10 steps) the still and "Remove the man and the fire from the picture…", plus the biggest
// thing alone, and Valis Stage Plate checks what really went, then puts the clean plate under every layer where those
// things stood, so a move uncovers real paint instead of a smear. At rest nothing changes.
// engine "krea": Krea 2 turbo + the AnyPaint adapter paints the margin of a canvas 30% bigger on each side (~1.6 MP,
// the margin filled with the still's own edge colours; 8 steps), instead of Qwen on a gray canvas twice the size.
// Krea 2's licence is cleaner than Qwen Image 2.1's research licence, and Krea is already loaded for the erase.
export const KREA_SURROUND = "the scene continuing naturally past its edges: a complete coherent image, consistent lighting, perspective and detail";
export function stagePaint({stage, seed = 101, steps = 25, dome = true, plate = true, engine = "qwen", prompt = "", pad = 0.3, megapixels = 1.6}) {
  const g = {};
  if (dome && engine === "krea") {
    Object.assign(g, kreaLoaders(), {
      "204": N("LoraLoaderModelOnly", {model: ["200", 0], lora_name: MODELS.kreaAnyPaint, strength_model: 1.0}),
      "205": N("Krea2AnyPaintModelPatch", {model: ["204", 0], kv_cache: true}),
      "sur": N("ValisStageSurround", {stage, megapixels, pad}),
      "kp": N("Krea2AnyPaintPrepare", {source: ["sur", 1], left: ["sur", 2], top: ["sur", 3], right: ["sur", 4], bottom: ["sur", 5],
        reference_max_edge: 384, boundary_redraw_px: 32}),
      "ke": N("Krea2AnyPaintEncode", {clip: ["201", 0], prompt: `${prompt ? prompt.replace(/[.\s]+$/, "") + ", " : ""}${KREA_SURROUND}`, vae: ["202", 0],
        semantic_reference: ["kp", 0], known_image: ["kp", 1], keep_mask: ["kp", 3], vlm_reference: true}),
      "kn": N("CLIPTextEncode", {text: "", clip: ["201", 0]}),
      "ks": N("KSampler", {model: ["205", 0], positive: ["ke", 0], negative: ["kn", 0], latent_image: ["ke", 1], seed, steps: 8, cfg: 1.0,
        sampler_name: "euler", scheduler: "simple", denoise: 1.0}),
      "dec": N("VAEDecode", {samples: ["ks", 0], vae: ["202", 0]}),
      "dome": N("ValisStageDome", {stage, painted: ["dec", 0]}),
    });
    dome = false;
  }
  if (plate) Object.assign(g, kreaLoaders(), {
    "cp": N("ValisStageCleanPlate", {stage, megapixels: 1.0}),
    ...kreaEdit(300, ["cp", 0], ["cp", 1], seed + 1, null, 1.0),
    // the biggest thing alone too: asked for four things at once, Krea kept the lighthouse (and Qwen once kept a man)
    ...kreaEdit(320, ["cp", 0], ["cp", 3], seed + 2, null, 1.0),
    "plate": N("ValisStagePlate", {stage, plate: ["312", 0], removed: ["cp", 2], plate_main: ["332", 0], removed_main: ["cp", 4]}),
  });
  if (dome) Object.assign(g, {
    "250": N("UnetLoaderGGUF", {unet_name: MODELS.qwen}),
    "251": N("CLIPLoader", {clip_name: MODELS.qwenTE, type: "qwen_image", device: "default"}),
    "252": N("VAELoader", {vae_name: MODELS.qwenVAE}),
    "253": N("LoraLoaderModelOnly", {model: ["250", 0], lora_name: MODELS.qwenOutpaint, strength_model: 1.0}),
    "sur": N("ValisStageSurround", {stage, megapixels: 1.03}),
    "enc": N("TextEncodeQwenImage21", {clip: ["251", 0], prompt: OUTPAINT, negative_prompt: "", resolution: 0, "images.image_1": ["sur", 0], vae: ["252", 0]}),
    "ks": N("KSampler", {model: ["253", 0], positive: ["enc", 0], negative: ["enc", 1], latent_image: ["enc", 2], seed, steps, cfg: 1, sampler_name: "euler", scheduler: "simple", denoise: 1}),
    "dec": N("VAEDecode", {samples: ["ks", 0], vae: ["252", 0]}),
    "dome": N("ValisStageDome", {stage, painted: ["dec", 0]}),
  });
  return g;
}
export const stageDome = (o) => stagePaint({...o, plate: false});

// sharpen: a still smaller than the export gets SeedVR2 (3B Q8, the same settings as Upscale) to this many px on its
// short side first. SAM 3 and Depth Anything still look at the original (they work below 1008 px anyway); only the
// layers' paint comes from the sharp copy, which is also saved into the stage folder as still_*.png.
// prompt: no still yet, so Krea 2 turbo paints one first (16:9, `size`), in the same job: words in, a set out.
// caps: what the loaded Valis nodes can do (the studio reads /object_info): retry = Valis Erase's lazy retry plate and
// footprints; matte = a BiRefNet file for Valis Stage Erased's soft edges; prompt = the words kept in stage.json
export function stage({image, names, name = "stage", far = 6, band = 0.025, threshold = 0.35, perName = 20, sharpen = 0,
                       prompt = null, size = [1792, 1008], seed = 7101, erase = false, caps = {}}) {
  const g = {
    "1": prompt ? N("VAEDecode", {samples: ["k5", 0], vae: ["k3", 0]}) : N("LoadImage", {image}),
    "2": N("LoadDA3Model", {model_name: MODELS.da3, weight_dtype: "default"}),
    "3": N("DA3Inference", {da3_model: ["2", 0], image: ["1", 0], resolution: 1008, resize_method: "upper_bound_resize", mode: "mono"}),
    "4": N("DA3Render", {da3_geometry: ["3", 0], output: "depth", "output.normalization": "min_max", "output.apply_sky_clip": false}),
    "5": N("CheckpointLoaderSimple", {ckpt_name: MODELS.sam}),
  };
  const st = {image: ["1", 0], depth: ["4", 0], names: names.join("\n"), stage_name: name, far, band};
  names.slice(0, 12).forEach((n, i) => {
    const b = 100 + 10 * i, id = (j) => String(b + j);
    g[id(0)] = N("CLIPTextEncode", {text: `${n.replace(/[,:]/g, " ")}:${perName}`, clip: ["5", 1]});
    g[id(1)] = N("SAM3_Detect", {model: ["5", 0], image: ["1", 0], conditioning: [id(0), 0], threshold, refine_iterations: 2, individual_masks: true});
    st[`mask_${i + 1}`] = [id(1), 0];
  });
  if (prompt) {
    Object.assign(g, {
      "k1": N("UNETLoader", {unet_name: MODELS.krea, weight_dtype: "default"}),
      "k2": N("CLIPLoader", {clip_name: MODELS.kreaTE, type: "krea2", device: "default"}),
      "k3": N("VAELoader", {vae_name: MODELS.kreaVAE}),
      "k4": N("EmptySD3LatentImage", {width: size[0], height: size[1], batch_size: 1}),
      "k6": N("CLIPTextEncode", {text: prompt, clip: ["k2", 0]}),
      "k7": N("ConditioningZeroOut", {conditioning: ["k6", 0]}),
      "k5": N("KSampler", {model: ["k1", 0], positive: ["k6", 0], negative: ["k7", 0], latent_image: ["k4", 0], seed, steps: 10, cfg: 1.0, sampler_name: "euler", scheduler: "simple", denoise: 1.0}),
      "k8": N("SaveImage", {images: ["1", 0], filename_prefix: `valis/stage/${name}/krea`}),
    });
  }
  if (sharpen) {
    g["s1"] = N("SeedVR2LoadDiTModel", {model: "seedvr2_ema_3b-Q8_0.gguf", device: "cuda:0", offload_device: "cpu", blocks_to_swap: 16});
    g["s2"] = N("SeedVR2LoadVAEModel", {model: "ema_vae_fp16.safetensors", device: "cuda:0", offload_device: "cpu", encode_tiled: true, decode_tiled: true});
    g["s3"] = N("SeedVR2VideoUpscaler", {image: ["1", 0], dit: ["s1", 0], vae: ["s2", 0], seed: 42, resolution: sharpen, max_resolution: 0, batch_size: 1,
      uniform_batch_size: false, color_correction: "lab", offload_device: "cpu"});
    g["s4"] = N("SaveImage", {images: ["s3", 0], filename_prefix: `valis/stage/${name}/still`});
    st.image = ["s3", 0];
  }
  if (erase) {
    // erase first: Krea 2 edit erases the things standing in the still (all of them, and the biggest alone), SAM 3
    // checks the first edit for a thing it only moved, Valis Erase builds the erased picture, SAM 3 and Depth Anything 3
    // read the scenery in it, and Valis Stage Erased puts the things back on top as cutouts from the still
    const still = st.image, eNames = names.join("\n");
    const ms = {}, pms = {}, ems = {};
    Object.assign(g, kreaLoaders());
    g["e1"] = N("ValisEraseSetup", {image: still, names: eNames, megapixels: 1.0});
    Object.assign(g, kreaEdit(300, ["e1", 0], ["e1", 1], seed + 11, null, 1.0), kreaEdit(320, ["e1", 0], ["e1", 2], seed + 12, null, 1.0));
    // the others again, with a new seed: Valis Erase asks for it (and for the biggest alone) only when the first edit
    // left one of them standing, so a clean first edit costs one edit and a failed one gets one retry
    if (caps.retry) Object.assign(g, kreaEdit(340, ["e1", 0], ["e1", 4], seed + 13, null, 1.0));
    names.slice(0, 12).forEach((n, i) => {
      const b = 100 + 10 * i, id = (j) => String(b + j);
      ms[`mask_${i + 1}`] = [id(1), 0];
      g[id(2)] = N("SAM3_Detect", {model: ["5", 0], image: ["312", 0], conditioning: [id(0), 0], threshold, refine_iterations: 2, individual_masks: true});
      pms[`pmask_${i + 1}`] = [id(2), 0];
      g[id(3)] = N("SAM3_Detect", {model: ["5", 0], image: ["e2", 0], conditioning: [id(0), 0], threshold, refine_iterations: 2, individual_masks: true});
      ems[`emask_${i + 1}`] = [id(3), 0];
    });
    Object.assign(g["e1"].inputs, ms);
    g["e2"] = N("ValisErase", {image: still, plan: ["e1", 3], plate_all: ["312", 0], plate_main: ["332", 0], names: eNames, ...ms, ...pms,
      ...(caps.retry ? {plate_rest: ["352", 0]} : {})});
    g["e3"] = N("DA3Inference", {da3_model: ["2", 0], image: ["e2", 0], resolution: 1008, resize_method: "upper_bound_resize", mode: "mono"});
    g["e4"] = N("DA3Render", {da3_geometry: ["e3", 0], output: "depth", "output.normalization": "min_max", "output.apply_sky_clip": false});
    const extra = {};
    if (caps.retry) extra.footprints = ["e2", 2];
    if (caps.matte) { g["bm"] = N("LoadBackgroundRemovalModel", {bg_removal_name: caps.matte}); extra.bg_model = ["bm", 0]; }
    if (caps.prompt && prompt) extra.prompt = prompt;
    g["900"] = N("ValisStageErased", {image: still, depth: st.depth, erased: ["e2", 0], erased_depth: ["e4", 0], report: ["e2", 1],
      names: eNames, stage_name: name, far, band, ...ms, ...ems, ...extra});
    return g;
  }
  if (caps.prompt && prompt) st.prompt = prompt;
  g["900"] = N("ValisStage", st);
  return g;
}


// ---------------------------------------------------------------- stereo: pictures hidden in noise (nodes_stereo.py)
// SAM 3 finds the thing and Depth Anything 3 gives its relief; Valis Mask Depth rounds the silhouette; a spinning solid
// joins it (Valis Depth Shape / Place); Valis Stereogram hides it all in a field of dots that you free-view; Valis
// Kinetogram makes the motion-only version in live static (every dot rides the clip's own motion); Valis Stereo Decode reads the depth back after H.264 (check).
export function stereo({video, target = "person", maxObjects = 2, viewing = "parallel", shape = "torus", shapeFrames = 96,
                        look = "squares", cell = 4, noise = "white", color = "black & white", palette = "neon", charset = "minimal",
                        refresh = 1, mbps = 4, prefix = "valis/stereo"}) {
  const g = {
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
    "13": N("ValisStereogram", {depth: [shape === "none" ? "10" : "12", 0], static: ["23", 0], period: 0, strength: 0.18, viewing, anchor: "center", kind: "dots", dot_size: cell,
      refresh_every: refresh, drift: 0.0, guide_dots: true, seed: 0, width: 0, height: 0, depth_far_is_white: false}),
    "14": N("CreateVideo", {images: ["13", 0], fps: ["2", 2]}),
    "15": N("SaveVideo", {video: ["14", 0], filename_prefix: `${prefix}_${viewing}`, format: "auto", codec: "auto"}),
    "16": N("ValisStereoDecode", {frames: ["13", 0], depth: ["12", 0], period: 0, strength: 0.18, viewing, window: (3 * cell) | 1, codec: "h264", bitrate_mbps: mbps, fps: 24}),
    "17": N("CreateVideo", {images: ["16", 0], fps: ["2", 2]}),
    "18": N("SaveVideo", {video: ["17", 0], filename_prefix: `${prefix}_decoded`, format: "auto", codec: "auto"}),
    "19": N("PreviewAny", {source: ["16", 2]}),
    "20": N("ValisKinetogram", {mask: ["6", 0], images: ["2", 0], static: ["23", 0], motion: "flow", drift_x: 0.0, drift_y: 0.0, kind: "dots", dot_size: cell,
      field_drift_x: 0.0, field_drift_y: 0.0, seed: 0, field_refresh: 1, width: 0, height: 0, dot_life: 12}),
    "21": N("CreateVideo", {images: ["20", 0], fps: ["2", 2]}),
    "22": N("SaveVideo", {video: ["21", 0], filename_prefix: `${prefix}_kinetogram`, format: "auto", codec: "auto"}),
    "23": N("ValisStatic", {look, cell, noise, color, palette, charset, custom_palette: "#0b0b10, #f2efe6, #d4462f, #2f6fd4",
      custom_characters: " .oO@", paper: "#000000", cell_height: 0}),
    "24": N("PreviewImage", {images: ["23", 1]}),
  };
  if (shape === "none") { delete g["11"]; delete g["12"]; g["16"].inputs.depth = ["10", 0]; }
  return g;
}
