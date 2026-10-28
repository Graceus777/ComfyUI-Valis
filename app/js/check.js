// Setup check: every workflow the studio can send, diffed against this ComfyUI's /object_info.
// Missing node packs, missing model files, renamed inputs and bad links show up per feature, before anything is queued.
import * as G from "./graphs.js";
import * as P from "./presets.js";

const PACKS = [
  [/^Valis/, "ComfyUI-Valis: restart ComfyUI after installing"],
  [/^Krea2AnyPaint/, "krea2-anypaint (github.com/alexw5702-afk/krea2-anypaint)"],
  [/^Krea2/, "comfyui-krea2edit (the Krea 2 identity-edit nodes)"],
  [/^MiniMaxH3Loop/, "ComfyUI-MiniMaxH3-Loop"],
  [/^MiniMaxH3PDDAcc/, "ComfyUI-MiniMax-H3-PDD-Acc"],
  [/^H3(IdentityAnchor|MaskVideoPrepare)/, "ComfyUI-ALLinONE-MinimaxH3"],
  [/^SeedVR2/, "ComfyUI-SeedVR2_VideoUpscaler"],
  [/^Plenio/, "Plenio Music Production System"],
  [/^(MiniMaxH3|H3)/, "a newer ComfyUI (the MiniMax H3 nodes are built in)"],
  [/^SAM3_/, "a newer ComfyUI (SAM 3 is built in)"],
  [/^MVEx_/, "MaskVidExperiments (MVEx)"],
  [/^UnetLoaderGGUF/, "ComfyUI-GGUF"],
  [/^(TextEncodeQwenImage21|LTXV|CreateVideo|SaveVideo|LoadVideo|GetVideoComponents)/, "a newer ComfyUI (update)"],
];
const packFor = (c) => (PACKS.find(([re]) => re.test(c)) || [, "a custom node pack"])[1];
const USER_FILES = new Set(["LoadImage.image", "LoadVideo.file", "LoadAudio.audio", "ValisScoreLoad.score"]);
const norm = (v) => String(v).replace(/\\/g, "/");

// rows for things a film can do without: missing them doesn't count against "setup ready"
export const OPTIONAL = new Set(["Film · a shot at full quality (H3 int8, 30 steps)"]);

export function features() {
  const e = {video: "x.mp4", target: "x", anchorPrompt: "x", desc: "x"};
  // as the callers send them: film.js SHEET_SIZE; stageview.js caps() on this pack and SHARP_TO
  const sheet = {w: 832, h: 1216}, names = ["the sky", "the man"], caps = {retry: true, prompt: true}, sharpen = 1440;
  return {
    "Film · plan (Qwen3 text generation)": G.filmPlan({idea: "x", shots: 2}),
    "Film · keyframes": G.filmKeyframes({prompts: ["x", "y"]}),
    "Film · cut": G.filmCut({shots: [{file: "a.mp4", seconds: 4}, {file: "b.mp4", seconds: 4}]}),
    "Film · song (YuE2)": G.song({style: "x", lyrics: "[Instrumental]", seconds: 31}).graph,
    "Film · a character's sheet": G.keyframes({prompt: "x", width: sheet.w, height: sheet.h, seeds: [8301]}),
    "Film · a sheet's state or a prop (Krea 2 identity edit)": G.filmFrame({refs: [{image: "a.png"}, {image: "b.png"}, {image: "c.png"}], prompt: "x", from: sheet, size: sheet}),
    "Film · a set from another side (Krea 2 identity edit)": G.filmFrame({refs: [{image: "plate.png"}], prompt: "x"}),
    "Film · a frame: the cast seated in the set (Qwen Image 2.1)": G.filmSeat({plate: "plate.png", people: [{image: "a.png"}, {image: "b.png"}], prompt: "x"}),
    "Film · a close-up cut from a frame (SeedVR2)": G.filmCrop({frame: "frame.png", crop: {x: .1, y: .3, w: .5, h: .5}}),
    "Film · a shot at full quality (H3 int8, 30 steps)": G.shot({image: "a.png", motion: "x", full: true}),
    "Create · Frame it": G.keyframes({prompt: "x"}),
    "Create · cast a character": G.castCharacter({keyframe: "a.png", character: "b.png", prompt: "x"}),
    "Create · Shoot it": G.shot({image: "a.png", motion: "x"}),
    "Edit · Find it": G.maskPreview({video: "x.mp4", target: "x"}),
    "Edit · Transform": G.edit({mode: "transform", ...e}),
    "Edit · Swap": G.swapFull({video: "x.mp4", character: "b.png", prompt: "x", background: "bg.png", turbo: true}),
    "Edit · Swap, matched to the plate": G.swapFull({video: "x.mp4", character: "b.png", prompt: "x", turbo: true, match: true}),
    "Edit · Turn": G.turn({a: "x.mp4", b: "y.mp4"}),
    "Edit · Remove": G.edit({mode: "remove", ...e}),
    "Edit · Turn the voice": G.turn({a: "x.mp4", b: "y.mp4", voice: true}),
    "FX · library stack": G.fx({clip: "x.mp4", other: "y.mp4", subject: "the man", source: "song", audio: "a.flac",
      layers: [{effect: "DoubleExposure", on: "beat"}, {effect: "Lightning", on: "downbeat"}], beds: ["rain"]}),
    "FX · write a song (YuE2)": G.fx({clip: "x.mp4", source: "write", songSpec: {style: "x", lyrics: "x", seconds: 20}, layers: [{effect: "Punch", on: "kick"}]}),
    "FX · write an instrumental (YuE2)": G.fx({clip: "x.mp4", source: "write", songSpec: {style: "x", lyrics: "[Instrumental]", seconds: 20}, layers: [{effect: "Punch", on: "kick"}]}),
    "Create · Shoot it, graded (Color Palette)": G.shot({image: "a.png", motion: "x", look: "film_colors"}),
    "Genjutsu · Motion transfer": G.genjutsu({video: "x.mp4", refs: ["a.png", "b.png"], prompt: "x", mode: "motion"}),
    "Genjutsu · Restyle": G.genjutsu({video: "x.mp4", prompt: "x", mode: "restyle"}),
    "Genjutsu · Object swap": G.genjutsu({video: "x.mp4", refs: ["a.png"], prompt: "x", mode: "swap", target: "her dress", cn: G.MODELS.funCN2}),
    "Create · Shoot it, ending on the subject (Qwen end anchor)": G.shot({image: "a.png", motion: "x", end: {edit: "x"}}),
    "Create · Trained move on H3 (camera LoRA, orbit)": G.orbit360({image: "a.png", loras: [{name: P.CAMERA_LORAS.orbit_360.lora, strength: 1}], raw: "x"}),
    "Create · Trained move on Wan 2.2 (camera LoRA)": G.wanMove({image: "a.png", move: P.CAMERA_LORAS.crash_zoom_in}),
    "Create · Relight a keyframe (Qwen Image edit)": G.relightImage({image: "a.png", prompt: "x"}),
    "Create · Shoot it from a cleaned keyframe (Qwen edit, same job)": G.fixKeyframe(G.shot({image: "a.png", motion: "x"}), {image: "a.png", prompt: "x"}),
    "Create · Trained move on H3, halves (orbit through the view from behind)": G.orbit360({image: "a.png", loras: [{name: P.CAMERA_LORAS.orbit_360.lora, strength: 1}], raw: "x", mode: "halves"}),
    "Create · Light change (H3 from the keyframe to its relit version)": G.shot({image: "a.png", motion: "x", last: "b.png"}),
    "Genjutsu · Source check (SDPose + Valis Pose Check)": G.poseCheck({video: "a.mp4"}),
    "Create · Whip pan (real pan + Valis Whip Pan)": G.shot({image: "a.png", motion: "x", whip: {mode: "return"}}),
    "Create · Dolly zoom (trained push + SAM 3 + Valis Dolly Zoom)": G.shot({image: "a.png", motion: "x", loras: [{name: P.CAMERA_LORAS.dolly_zoom_in.lora, strength: 1}], raw: "x", dolly: {target: "woman"}}),
    "Create · …and trim the frozen hold (Valis Trim Hold)": G.shot({image: "a.png", motion: "x", end: "loop", trimHold: true, look: "film_colors"}),
    "Create · Extend a shot": G.extend({video: "x.mp4", clipSeconds: 5, width: 768, height: 1344, action: "x"}),
    "Finish · Upscale (SeedVR2)": G.upscale({video: "x.mp4"}),
    "Score · Render with Valis": G.valisShot({clip: "x.mp4", score: "s.json", startBar: 0, section: "waltz", layer: "l.mp4",
      rules: [{event: "pah", effect: "crowd"}], targetA: "a", targetB: "b"}),
    "Score · from a song": G.scoreMake({audio: "song.flac", title: "x"}),
    "Score · YuE2 writes it (instrumental)": G.songScore({style: "x", lyrics: "[Instrumental]"}),
    "Score · YuE2 writes it (with lyrics)": G.songScore({style: "x", lyrics: "x"}),
    "Extras · Stereogram": G.stereo({video: "x.mp4"}),
    "Extras · Loop, draft (FastH3)": G.loopShot({image: "a.png", prompt: G.loopPrompt({subject: "x", action: "x"}), engine: "fast"}),
    "Extras · Loop, final (H3 25 steps)": G.loopShot({image: "a.png", prompt: G.loopPrompt({subject: "x", action: "x"}), engine: "full"}),
    "Extras · Stage: split a still": G.stage({image: "a.png", names, erase: true, caps}),
    "Extras · Stage from words (Krea 2, SeedVR2)": G.stage({prompt: "x", names, sharpen, erase: true, caps}),
    "Extras · Stage, paint past the frame (Krea 2 AnyPaint)": G.stagePaint({stage: "valis/stage/x", engine: "krea", plate: false, prompt: "x"}),
    "Extras · Stage, paint past the frame (Qwen Image 2.1)": G.stagePaint({stage: "valis/stage/x", engine: "qwen"}),
  };
}

function inputDefs(info) {
  const all = {...(info.input?.required || {}), ...(info.input?.optional || {})};
  return {all, required: Object.keys(info.input?.required || {})};
}
function options(def) {
  if (!def) return null;
  if (Array.isArray(def[0])) return def[0];
  if (def[0] === "COMBO" && Array.isArray(def[1]?.options)) return def[1].options;
  return null;
}
const typeOf = (def) => (Array.isArray(def?.[0]) || def?.[0] === "COMBO") ? "COMBO" : def?.[0];
const generic = (t) => /^COMFY_(MATCHTYPE|AUTOGROW|DYNAMICCOMBO)/.test(String(t));      // V3 template types take anything
const compatible = (a, b) => !a || !b || a === "*" || b === "*" || generic(a) || generic(b) || a === b || String(b).split(",").includes(a) || String(a).split(",").includes(b);

// graph -> [{kind, node, msg}]
export function checkGraph(graph, info) {
  const out = [];
  const seen = new Set();
  const add = (kind, node, msg) => { const k = kind + node + msg; if (!seen.has(k)) { seen.add(k); out.push({kind, node, msg}); } };
  for (const [id, n] of Object.entries(graph)) {
    const ni = info[n.class_type];
    if (!ni) { add("node", n.class_type, `needs ${packFor(n.class_type)}`); continue; }
    const {all, required} = inputDefs(ni);
    const given = Object.keys(n.inputs);
    for (const r of required) if (!given.some(g => g === r || g.startsWith(r + "."))) add("input", n.class_type, `required input "${r}" is not set`);
    for (const [k, v] of Object.entries(n.inputs)) {
      const root = k.split(".")[0];
      const def = all[k] || all[root];
      if (!def) { add("input", n.class_type, `has no input "${k}"`); continue; }
      if (Array.isArray(v)) {
        const src = graph[v[0]], si = src && info[src.class_type];
        if (!src) add("link", n.class_type, `"${k}" links to missing node ${v[0]}`);
        else if (si) {
          const outs = si.output || [];
          if (v[1] >= outs.length) add("link", n.class_type, `"${k}" uses output ${v[1]} of ${src.class_type}, which has ${outs.length}`);
          else if (k === root && !compatible(outs[v[1]], typeOf(def))) add("link", n.class_type, `"${k}" wants ${typeOf(def)}, gets ${outs[v[1]]} from ${src.class_type}`);
        }
        continue;
      }
      const opts = k === root ? options(def) : null;
      if (opts && !USER_FILES.has(`${n.class_type}.${k}`) && !opts.map(norm).includes(norm(v))) {
        const isFile = /\.(safetensors|gguf|ckpt|pt|pth|bin|sft)$/i.test(String(v));
        add(isFile ? "model" : "input", n.class_type, isFile ? `model file not found: ${v}` : `"${k}" has no option "${v}"`);
      }
    }
  }
  return out;
}

export async function checkSetup() {
  const info = await fetch("/object_info").then(r => r.json());
  const res = {};
  // every job runs through the Comfy SDK, which needs Comfy API v2 on this server (mounted by the pack)
  const v2 = await fetch("/api/v2/health").then(r => r.ok).catch(() => false);
  res["Comfy SDK · job API"] = v2 ? [] : [{kind: "node", node: "comfy-api-proxy",
    msg: "not installed: run  python -m pip install comfy-api-proxy  in ComfyUI's Python, then restart ComfyUI"}];
  for (const [name, g] of Object.entries(features())) res[name] = checkGraph(g, info);
  return res;
}
