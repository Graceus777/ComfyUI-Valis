// The ref2va engine: a reversible switch between MiniMax H3 ref2va and FastH3 OmniRef for every graph that renders with
// ref2va (Edit · Transform / Remove / Swap, Genjutsu, video relight). Kept out of graphs.js so that file stays as it was.
//   "base": H3 ref2va int8 as before: 20 steps res_multistep, or the 8-step turbo LoRA where a feature asks for it.
//   "fast": FastH3 OmniRef (FastVideo/FastH3-Omni-Comfy): ref2va distilled to 8 steps, with its 32 PDD heads inside the
//           checkpoint (ComfyUI reads them from the file's pdd_steps metadata). Card recipe: 8 steps, guidance 1, shift
//           12/3. The steps sit on the trained PDD block boundaries (MiniMaxH3PDDAccScheduler, nfe 8) and run with
//           euler, since each step's head is the mean velocity over its whole block. No speed LoRA on top.
// The switch rewrites a finished graph, so "base" graphs are byte-for-byte what they were before it existed.
export const BASE_REF = "minimax_h3_ref2va_pruned_int8_convrot.safetensors";
export const FAST_REF = "fasth3_omniref_8step_pruned_int8_convrot.safetensors";
const TURBO = "minimax_h3_ref2v_turbo_8step_v1.0_768p_comfyui_bf16.safetensors";

// where a model the studio can download lives (Renders -> Setup offers it; /valis/models/fetch checks size and sha256)
export const MODEL_SOURCES = {
  [FAST_REF]: {repo: "FastVideo/FastH3-Omni-Comfy", path: `diffusion_models/${FAST_REF}`, folder: "diffusion_models",
    size: 22213723064, sha256: "851b2dc9670ed864b7f1e951ac9da047d83b1c04ded9bfcc1a9e5bba0ee33f80"},
  // Edit · Remove (Akatz Labs, MiniMax H3 community license: read its terms for your region)
  "H3-Person-Remover-V1.safetensors": {repo: "akatz-ai/MiniMax-H3-Person-Remover-LoRA", path: "H3-Person-Remover-V1.safetensors", folder: "loras",
    size: 155110584, sha256: "b01dc9fe888c2f4e455a8eb3b4878dfd4038ee0e2320a7b186c7935e65c93ba5",
    license: "https://huggingface.co/akatz-ai/MiniMax-H3-Person-Remover-LoRA"},
};

export const REF_ENGINES = {base: "H3 ref2va (20 steps, or the turbo LoRA)", fast: "FastH3 OmniRef (8 steps, distilled)"};
let ENGINE = "base";
export const refEngine = () => ENGINE;
export function setRefEngine(e) { ENGINE = e === "fast" ? "fast" : "base"; return ENGINE; }

const N = (class_type, inputs) => ({class_type, inputs});
export function withRefEngine(g, engine = ENGINE) {
  if (engine !== "fast") return g;
  const loaders = Object.values(g).filter(n => n.class_type === "UNETLoader" && n.inputs.unet_name === BASE_REF);
  if (!loaders.length) return g;
  loaders.forEach(n => { n.inputs.unet_name = FAST_REF; });
  const relink = (from, to) => { for (const n of Object.values(g)) for (const [k, v] of Object.entries(n.inputs)) if (Array.isArray(v) && v[0] === from) n.inputs[k] = to; };
  for (const [id, n] of Object.entries(g))
    if (n.class_type === "LoraLoaderModelOnly" && n.inputs.lora_name === TURBO) { delete g[id]; relink(id, n.inputs.model); }
  for (const [id, n] of Object.entries(g)) {
    if (n.class_type !== "SamplerCustomAdvanced") continue;
    const guider = g[n.inputs.guider[0]], m = guider.inputs.model;
    if (g[m[0]]?.class_type === "MiniMaxH3SigmaShift") Object.assign(g[m[0]].inputs, {shift_video: 12.0, shift_audio: 3.0});
    else { g[`${id}_shift`] = N("MiniMaxH3SigmaShift", {model: m, shift_video: 12.0, shift_audio: 3.0}); guider.inputs.model = [`${id}_shift`, 0]; }
    g[n.inputs.sigmas[0]] = N("MiniMaxH3PDDAccScheduler", {nfe: "8", denoise: 1.0});
    const samp = g[n.inputs.sampler[0]];
    if (samp?.class_type === "KSamplerSelect") samp.inputs.sampler_name = "euler";
  }
  return g;
}
