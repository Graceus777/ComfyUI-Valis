// The machine the studio runs on: ComfyUI's /system_stats, plus Valis's /valis/machine (driver, CUDA, cuDNN, compute
// capability, attention kernels, ComfyUI's memory mode). advise() turns that into safe defaults and plain advice.
import * as api from "./api.js";

const GB = (b) => b / 2 ** 30;
const vnum = (s) => (String(s || "").match(/\d+(\.\d+)?/) || [0])[0] * 1;

export async function detect() {
  const [s, m] = await Promise.all([api.systemStats().catch(() => null), fetch("/valis/machine").then(r => r.ok ? r.json() : null).catch(() => null)]);
  const d = s?.devices?.[0] || {};
  const name = (m?.gpu?.name || d.name || "").replace(/^cuda:\d+\s*/, "").replace(/\s*:\s*\w+$/, "");
  return {
    full: !!m,                                       // false: the Valis route isn't loaded yet (restart ComfyUI)
    gpu: name, vramGB: m?.gpu?.memory_gb ?? (d.vram_total ? +GB(d.vram_total).toFixed(1) : null), vramFreeGB: d.vram_free ? +GB(d.vram_free).toFixed(1) : null,
    capability: m?.gpu?.capability || null, fp8: m?.gpu?.fp8 ?? null, bf16: m?.gpu?.bf16 ?? null,
    driver: m?.nvidia?.gpus?.[0]?.driver || null, driverCuda: m?.nvidia?.driver_cuda || null,
    torch: m?.torch || s?.system?.pytorch_version || null, torchCuda: m?.torch_cuda || null, cudnn: m?.cudnn || null,
    kernels: m?.kernels || null, attention: m?.comfy?.attention || null, vramState: m?.comfy?.vram_state || null,
    flags: m?.comfy?.flags || null, argv: s?.system?.argv || [],
    ramGB: m?.ram?.total_gb ?? (s?.system?.ram_total ? +GB(s.system.ram_total).toFixed(1) : null), ramFreeGB: s?.system?.ram_free ? +GB(s.system.ram_free).toFixed(1) : null,
    swapGB: m?.swap_gb ?? null, comfy: s?.system?.comfyui_version || null, python: m?.python || (s?.system?.python_version || "").split(" ")[0], os: m?.os || s?.system?.os,
    temp: m?.nvidia?.gpus?.[0]?.temp_c ?? null,
  };
}

// {short: shot short side, why, notes: [{level: ok|tip|warn, text}]}
export function advise(x) {
  const notes = [], v = x.vramGB || 0;
  let short = 768, why = "";
  if (!v) { short = 512; why = "no GPU memory reported"; }
  else if (v >= 20) { short = 768; why = `${v} GB: H3's native size with room to spare (1024 works too, untested above 768)`; }
  else if (v >= 11.5) { short = 768; why = `${v} GB: H3's native size (768 px) fits; the studio's films were made at this size on 12 GB`; }
  else if (v >= 9.5) { short = 640; why = `${v} GB: 640 px keeps H3 inside memory; use Upscale for delivery`; }
  else if (v >= 7.5) { short = 512; why = `${v} GB: 512 px; larger shots will spill into system memory and crawl`; }
  else { short = 384; why = `${v} GB is below what H3 needs comfortably: 384 px drafts only`; notes.push({level: "warn", text: "Under 8 GB of GPU memory: video models will offload to system RAM and run very slowly."}); }
  if (x.fp8 === false) notes.push({level: "warn", text: `Compute capability ${x.capability}: no fp8 on this GPU, so the fp8 and w4a8 checkpoints run slower (upcast).`});
  if (x.fp8) notes.push({level: "ok", text: `fp8 supported (compute ${x.capability})`});
  if (x.kernels) {
    const sage = x.kernels.SageAttention?.installed, tri = x.kernels.Triton?.installed;
    if (x.attention === "sage") notes.push({level: "ok", text: `SageAttention ${x.kernels.SageAttention?.version || ""} is on`});
    else if (sage) notes.push({level: "tip", text: "SageAttention is installed but ComfyUI isn't using it: start ComfyUI with --use-sage-attention (faster H3 and Wan)."});
    else notes.push({level: "tip", text: `Attention: ${x.attention || "pytorch"}. SageAttention (with Triton${tri ? ", which is installed" : ""}) usually speeds up video models.`});
  }
  if (x.driverCuda && x.torchCuda && vnum(x.driverCuda) < vnum(x.torchCuda)) notes.push({level: "warn", text: `The NVIDIA driver supports CUDA ${x.driverCuda} but PyTorch is built for ${x.torchCuda}: update the driver.`});
  else if (x.driver) notes.push({level: "ok", text: `Driver ${x.driver} (CUDA ${x.driverCuda || "?"}) runs PyTorch ${x.torch} (CUDA ${x.torchCuda || "?"})`});
  if (x.ramGB && x.ramGB < 24) notes.push({level: "warn", text: `${x.ramGB} GB of RAM: switching between models (Krea, H3, Qwen) reloads them from disk; expect slow first steps.`});
  if (x.vramState && /LOW|NO/.test(x.vramState)) notes.push({level: "tip", text: `ComfyUI is in ${x.vramState} mode: models are kept off the GPU between steps (slower, saves memory).`});
  if (x.temp && x.temp > 85) notes.push({level: "warn", text: `The GPU is at ${x.temp} °C.`});
  if (!x.full) notes.push({level: "tip", text: "Driver, CUDA, cuDNN and attention details need the Valis machine route: restart ComfyUI once to load it."});
  return {short, why, notes};
}
