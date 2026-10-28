// How long a job will take on this machine, from this machine's own past jobs.
//
// Every finished job's graph is reduced to a kind (an H3 shot, Krea keyframes, a Wan move...) and an amount of work
// (pixels x frames x steps), and its run time is kept in ComfyUI/user/default/valis/timings.json. A new job's estimate
// fits time = setup + rate x work over the past jobs of its kind. Until a kind has run here, the estimate is a guess
// scaled from a reference GPU by this GPU's speed, and says so.
import * as api from "./api.js";
import {workOf} from "./work.js";
export {workOf};

const FILE = "valis/timings.json";
let SAMPLES = null, GPU = null, SPEED = 1, GUESSED_SPEED = true;

// relative speed for first guesses (an RTX 4080 Laptop GPU = 1; rough fp16/bf16 throughput, memory permitting)
const GPUS = [[/5090/, 3.0], [/4090 laptop/i, 1.3], [/4090/, 2.3], [/5080/, 1.9], [/4080 super/i, 1.7], [/4080 laptop/i, 1.0], [/4080/, 1.6],
  [/5070 ti/i, 1.5], [/4070 ti/i, 1.25], [/4070 laptop/i, .6], [/4070/, 1.0], [/3090/, 1.1], [/3080/, .85], [/4060 ti/i, .7], [/4060/, .55],
  [/3070/, .6], [/3060/, .42], [/a100/i, 2.0], [/h100/i, 3.5], [/l40/i, 2.0], [/a6000/i, 1.3], [/l4\b/i, .7], [/t4\b/i, .25]];

// reference timings on an RTX 4080 Laptop GPU (12 GB), measured: setup seconds + seconds per unit of work
const PRIOR = {
  krea: {a: 20, b: 9.5, unit: "megapixel images"},           // 2 keyframes at 768x1344: ~40 s
  h3: {a: 30, b: 3.4, unit: "megapixel-frames x steps / 8"},   // 768x1344 x 107 frames: ~7 min; 384x672 x 73: ~70 s
  h3ref: {a: 40, b: 3.6, unit: "megapixel-frames x steps / 8"},// masked transform ~13 min; motion transfer at 480p, 5 s: ~6 min
  loop: {a: 40, b: 3.6, unit: "megapixel-frames x steps x views / 8"},
  wan: {a: 60, b: 2.6, unit: "megapixel-frames x steps / 4"},
  qwen: {a: 25, b: 30, unit: "edits"},
  seedvr2: {a: 40, b: .45, unit: "output megapixel-frames"},
  yue2: {a: 40, b: 3.2, unit: "seconds of music"},
  sam3: {a: 15, b: .25, unit: "frames"},
  valis: {a: 10, b: .8, unit: "megapixel-frames"},              // ~1 min per 4.5 s clip
  llm: {a: 60, b: 1, unit: "plans"},
  other: {a: 20, b: 0, unit: ""},
};

async function load() {
  if (SAMPLES) return SAMPLES;
  SAMPLES = (await api.readUser(FILE, null))?.samples || [];
  try {
    const s = await api.systemStats(); GPU = s?.devices?.[0]?.name || "";
    const g = GPUS.find(([re]) => re.test(GPU)); SPEED = g ? g[1] : 1; GUESSED_SPEED = !g;
  } catch { /* offline */ }
  return SAMPLES;
}
let saveTimer = null;
function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => api.writeUser(FILE, {gpu: GPU, samples: SAMPLES.slice(-400)}).catch(() => {}), 1500);
}
// a finished job: its graph and how long it ran (seconds of execution, not queue)
export async function record(id, graph, seconds) {
  await load();
  if (!seconds || seconds < 1 || SAMPLES.some(s => s.id === id)) return;
  const w = workOf(graph);
  SAMPLES.push({id, kind: w.kind, work: +w.work.toFixed(4), seconds: +seconds.toFixed(1), gpu: GPU, at: Date.now()});
  persist();
}
// learn from ComfyUI's history (jobs run before the studio was open): execution_start .. execution_success
export async function learnFromHistory() {
  await load();
  const hist = await api.history(200).catch(() => ({}));
  for (const [id, e] of Object.entries(hist || {})) {
    if (SAMPLES.some(s => s.id === id)) continue;
    const msgs = e?.status?.messages || [];
    const t0 = msgs.find(m => m[0] === "execution_start")?.[1]?.timestamp, t1 = msgs.find(m => m[0] === "execution_success")?.[1]?.timestamp;
    const graph = e?.prompt?.[2];
    if (t0 && t1 && graph) await record(id, graph, (t1 - t0) / 1000);
  }
}

// {seconds, measured: bool, basis: text}
export async function estimate(graph) {
  await load();
  const {kind, work} = workOf(graph), p = PRIOR[kind] || PRIOR.other;
  const mine = SAMPLES.filter(s => s.kind === kind && s.gpu === GPU).slice(-30);
  if (mine.length) {
    let a = p.a / SPEED, b;
    const n = mine.length, mx = mine.reduce((s, x) => s + x.work, 0) / n, my = mine.reduce((s, x) => s + x.seconds, 0) / n;
    const sxx = mine.reduce((s, x) => s + (x.work - mx) ** 2, 0);
    if (n >= 3 && sxx > 1e-6 * mx * mx) { b = mine.reduce((s, x) => s + (x.work - mx) * (x.seconds - my), 0) / sxx; a = my - b * mx; }
    if (!(b > 0) || a < 0) { a = Math.min(a, my * .3); b = Math.max(0, (my - a) / Math.max(mx, 1e-6)); }
    return {seconds: Math.max(5, a + b * work), measured: true, basis: `from ${n} ${kind} job${n > 1 ? "s" : ""} on this machine`};
  }
  return {seconds: (p.a + p.b * work) / SPEED, measured: false,
          basis: GUESSED_SPEED ? "a first guess: nothing like it has run on this machine yet"
                               : `a first guess for this GPU; it learns from your first ${kind} job`};
}
export function fmt(e) {
  if (!e) return "";
  const s = e.seconds, t = s < 50 ? `${Math.max(5, Math.round(s / 5) * 5)} s` : s < 3600 ? `${Math.round(s / 60)} min` : `${(s / 3600).toFixed(1)} h`;
  return `~${t}${e.measured ? "" : "?"}`;
}
export function gpuName() { return GPU; }
