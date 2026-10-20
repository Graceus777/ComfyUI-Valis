// The studio's link to ComfyUI.
//
// Jobs go through the official Comfy SDK (@comfyorg/sdk, bundled in ../vendor) over Comfy API v2, which the pack
// mounts on this same ComfyUI (sdk_api.py, from Comfy-Org's comfy-api-proxy). Submitting a graph, following its
// progress, uploading clips and fetching results are all SDK calls, so the same studio code can drive Comfy Cloud or
// a Comfy API deployment by changing one base URL.
//
// Machine controls that v2 doesn't cover (free memory, stop, VRAM, the node list for the setup check, and the
// gallery of past renders) use ComfyUI's own endpoints.
import {Comfy, ComfyLow} from "../vendor/comfy-sdk.js";

// The SDK reads its base URL from COMFY_BASE_URL. A page has no environment, so give it one: this page's origin
// (a self-hosted ComfyUI needs no key). ?api=<url>&key=<key> points the studio at another v2 surface.
const q = new URLSearchParams(location.search);
export const BASE = (q.get("api") || location.origin).replace(/\/+$/, "");
globalThis.process ??= {env: {}};
globalThis.process.env ??= {};
globalThis.process.env.COMFY_BASE_URL = BASE;
const fetchFn = (...a) => globalThis.fetch(...a);      // a browser's fetch must be called on window, not as a stored method
export const sdk = new Comfy({fetch: fetchFn, ...(q.get("key") ? {apiKey: q.get("key")} : {})});
const low = new ComfyLow(BASE, q.get("key") || undefined, {fetch: fetchFn});     // the SDK's raw transport, for event streams

const listeners = new Set();
export const jobs = new Map();       // job id -> {id, label, kind, status, value, max, node, outputs, error, t0}

function emit(ev) { for (const fn of listeners) { try { fn(ev); } catch (e) { console.error(e); } } }
export function on(fn) { listeners.add(fn); return () => listeners.delete(fn); }

async function json(r) {
  const t = await r.text();
  try { return JSON.parse(t); } catch { return {error: t}; }
}

// Save nodes write into output/<subfolder>/; remember each one's subfolder so a result can be fed into the next
// graph as "<subfolder>/<file> [output]".
function subfolders(graph) {
  const subs = {};
  for (const [id, n] of Object.entries(graph)) {
    const p = n.inputs?.filename_prefix;
    if (/^Save/.test(n.class_type) && typeof p === "string") subs[id] = p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "";
  }
  return subs;
}

function why(e) {
  const d = e?.details || {};
  const ne = d.node_errors || d.errors;
  if (ne && typeof ne === "object") {
    const first = Object.values(ne)[0];
    const msg = first?.errors?.[0]?.message || first?.message;
    if (msg) return `${first.class_type || ""} ${msg}`.trim();
  }
  return e?.message || String(e);
}

export async function submit(graph, label = "job", kind = "render") {
  let j;
  try { j = await sdk.submit(sdk.workflows.fromJson(graph)); }
  catch (e) { throw new Error(`ComfyUI refused the graph: ${why(e)}`); }
  const job = {id: j.id, label, kind, status: "queued", value: 0, max: 1, frac: 0, step: null, steps: null, node: null, outputs: [], error: null,
               t0: Date.now(), sdkJob: j, subs: subfolders(graph), w: weights(graph)};
  jobs.set(job.id, job);
  emit({type: "job", job});
  follow(job);
  return job;
}

// o is a v2 Output as the job record lists it: {node_id, name, url, id, content_type}. Follow its url, don't build one.
function addOutput(job, o) {
  if (!(o.node_id in job.subs) || job.outputs.some(f => f.id === o.id)) return;     // previews and temp files are not results
  const url = o.url ? new URL(o.url, BASE).href : null;
  job.outputs.push({filename: o.name, subfolder: job.subs[o.node_id], type: "output", url, id: o.id, nodeId: o.node_id, contentType: o.content_type});
}

// Where the time goes, roughly: samplers dominate, then tracking, the Valis pass, decoding. Progress is the weight of
// the nodes finished plus the running node's share by its step count.
const HEAVY = {SamplerCustomAdvanced: 40, KSampler: 8, SAM3_VideoTrack: 6, ValisFX: 12, VAEDecode: 3, VAEDecodeTiled: 3, VAEEncode: 1,
               MiniMaxH3ReferenceToVideo: 2, MiniMaxH3ImageToVideo: 2, UNETLoader: 1, CLIPLoader: 1, UnetLoaderGGUF: 1, RTXVideoSuperResolution: 2};
function weights(graph) {
  const w = {};
  for (const [id, n] of Object.entries(graph)) w[id] = HEAVY[n.class_type] ?? 0.2;
  return w;
}

// Live progress from the job's event stream (the SDK's raw SSE layer: its high-level events() keeps progress
// monotonic, which on a self-hosted ComfyUI swallows the sampler's step frames). The job's own state is the final word.
const TERMINAL = new Set(["succeeded", "failed", "canceled", "expired"]);
async function follow(job) {
  const j = job.sdkJob;
  const done = new Set(), total = Object.values(job.w).reduce((a, b) => a + b, 0) || 1;
  try {
    for await (const raw of low.getJobEvents(j.urls?.events || j.id)) {
      const d = raw.data || {};
      if (raw.event === "status") {
        if (d.status === "running" || d.status === "queued") job.status = d.status;
        if (TERMINAL.has(d.status)) break;
      } else if (raw.event === "progress") {
        job.status = "running";
        const cur = d.current_node ?? null;
        if (cur && job.node && cur !== job.node) done.add(job.node);       // a new node started: the previous one finished
        if (cur) { job.node = cur; job.step = d.steps ? d.step : null; job.steps = d.steps || null; }
        let sum = 0; for (const id of done) sum += job.w[id] || 0;
        const f = (sum + (job.node ? (job.w[job.node] || 0) * (d.steps ? d.step / d.steps : 0.3) : 0)) / total;
        job.frac = Math.max(job.frac || 0, Math.min(0.99, f));
        job.value = job.steps ? job.step : Math.round(100 * job.frac); job.max = job.steps || 100;
      } else continue;
      emit({type: "job", job});
    }
  } catch (e) { console.warn(`events for ${job.label} dropped; polling`, e); }
  try { await j.wait(); } catch (e) { console.warn(e); }
  if (j.status === "succeeded") {
    const rec = await low.getJob(j.id).catch(() => null);          // the raw record carries each output's link
    for (const o of rec?.outputs || []) addOutput(job, o);
    job.status = "done"; job.frac = 1;
  } else {
    job.status = "error";
    const er = j.error;
    job.error = er ? `${er.class_type ? er.class_type + ": " : ""}${er.message || er.code}` : j.status;
  }
  emit({type: "job", job});
}

export async function cancel(id) {
  const j = jobs.get(id)?.sdkJob;
  return j ? j.cancel() : null;
}

// Files dropped into the studio become SDK assets: uploaded once (deduplicated by hash), then placed straight into
// the graph. The SDK swaps each asset for the uploaded file's name when the job is submitted.
export async function upload(file) {
  const a = sdk.assets.fromBytes(new Uint8Array(await file.arrayBuffer()), {filename: file.name, contentType: file.type || undefined});
  await a.commit();          // upload now, so a bad file fails at drop time rather than at render time
  return a;
}
export const inputRef = (asset) => asset;
export const outputRef = (f) => `${f.subfolder ? f.subfolder + "/" : ""}${f.filename} [output]`;
// On this machine, play results straight from ComfyUI's /view (range requests, no second hop); elsewhere follow the v2 link.
const LOCAL = BASE === location.origin;
export const viewUrl = (f) => (LOCAL || !f.url) ? `/view?filename=${encodeURIComponent(f.filename)}&subfolder=${encodeURIComponent(f.subfolder || "")}&type=${f.type || "output"}` : f.url;

// ---- machine controls (ComfyUI's own endpoints) -------------------------------------------------------------
export async function queue() { return json(await fetch("/queue")); }
export async function history(max = 64) { return json(await fetch(`/history?max_items=${max}`)); }
export async function free() {
  return fetch("/free", {method: "POST", headers: {"Content-Type": "application/json"},
                         body: JSON.stringify({unload_models: true, free_memory: true})});
}
export async function interrupt() { return fetch("/interrupt", {method: "POST"}); }
export async function systemStats() { return json(await fetch("/system_stats")); }
export async function objectInfo(node) { return json(await fetch(`/object_info/${encodeURIComponent(node)}`)); }
const HAVE = {};
let LORAS = null;
// is this LoRA in models/loras? (one /object_info call, cached for the session)
export async function hasLora(name) {
  if (!LORAS) { try { LORAS = new Set((await objectInfo("LoraLoaderModelOnly"))?.LoraLoaderModelOnly?.input?.required?.lora_name?.[0] || []); } catch { LORAS = new Set(); } }
  return LORAS.has(name);
}
let PATCHES = null;
// is this model patch (Fun ControlNet...) in models/model_patches? (cached for the session)
export async function hasModelPatch(name) {
  if (!PATCHES) { try { PATCHES = new Set((await objectInfo("ModelPatchLoader"))?.ModelPatchLoader?.input?.required?.name?.[0] || []); } catch { PATCHES = new Set(); } }
  return PATCHES.has(name);
}
// is this node installed and loaded? (a new Valis node needs a ComfyUI restart before it shows up)
export async function hasNode(node) {
  if (!(node in HAVE)) { try { HAVE[node] = !!(await objectInfo(node))?.[node]; } catch { return false; } }
  return HAVE[node];
}

export function outputsOf(entry) {
  const out = [];
  for (const o of Object.values(entry?.outputs || {})) {
    for (const k of ["images", "videos", "gifs", "audio"]) for (const f of (o[k] || [])) if (f.type !== "temp") out.push(f);
  }
  return out;
}

// The connection light and queue count come from ComfyUI's status broadcast.
let ws = null, wsTimer = null;
export function connect() {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  ws = new WebSocket(`${proto}://${location.host}/ws`);
  ws.onopen = () => emit({type: "connection", up: true});
  ws.onclose = () => { emit({type: "connection", up: false}); clearTimeout(wsTimer); wsTimer = setTimeout(connect, 2000); };
  ws.onmessage = (m) => {
    if (typeof m.data !== "string") return;
    let msg; try { msg = JSON.parse(m.data); } catch { return; }
    if (msg.type === "status") emit({type: "status", queue: msg.data?.status?.exec_info?.queue_remaining ?? 0});
  };
}

// The masked passes need an audio track; clips without one get this silence (uploaded once).
let silence = null;
export async function silenceRef() {
  if (silence) return silence;
  const b = await (await fetch("/valis/app/assets/silence.wav")).blob();
  silence = await upload(new File([b], "valis_silence.wav", {type: "audio/wav"}));
  return silence;
}
