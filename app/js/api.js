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
import {respell} from "./graphs.js";

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

const INPUTS = {};
const inputsOf = (node) => INPUTS[node] ??= objectInfo(node).then(i => i?.[node]?.input || {}, () => ({}));

export async function submit(graph, label = "job", kind = "render") {
  let j;
  try { j = await sdk.submit(sdk.workflows.fromJson(await respell(graph, inputsOf))); }
  catch (e) { throw new Error(`ComfyUI refused the graph: ${why(e)}`); }
  const job = {id: j.id, label, kind, status: "queued", value: 0, max: 1, frac: 0, step: null, steps: null, node: null, outputs: [], error: null,
               t0: Date.now(), sdkJob: j, subs: subfolders(graph), w: weights(graph), graph};
  jobs.set(job.id, job);
  emit({type: "job", job});
  follow(job);
  return job;
}

// A job a script built (work/<film>/build.mjs writes graphs to ComfyUI/input/valis_jobs/): queue it by file name, tracked
// like any studio job. From the browser console: (await import("/valis/app/js/api.js")).submitJob("burn3_clip_s16.json")
export async function submitJob(file, label = file.replace(/\.json$/, "")) {
  const r = await fetch(`/api/view?filename=${encodeURIComponent(file)}&type=input&subfolder=valis_jobs&t=${Date.now()}`);
  if (!r.ok) throw new Error(`no ${file} in ComfyUI/input/valis_jobs`);
  return submit(await r.json(), label);
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

// A model download (/valis/models/fetch) lives in ComfyUI's memory like a job does: after a restart the route answers
// {} for a download that was running, and a page that only waited for its entry polled for ever with the button dead.
// Follows one download by its key ("<folder>/<name>"): progress(j) on every poll while it runs, done(j) when it ends one
// way or another, lost() when the server has not had it (or has not answered) for `lostAfter` ms. Returns a stop().
export function followDownload(key, {progress = () => {}, done, lost, every = 2000, lostAfter = 45000}) {
  let seen = Date.now(), stopped = false, busy = false;
  const stop = () => { stopped = true; clearInterval(timer); };
  const timer = setInterval(async () => {
    if (busy) return; busy = true;                      // a slow answer is not asked again on top of itself
    try {
      let list = null;
      try { const r = await fetch("/valis/models/fetch"); if (r.ok) list = await r.json(); } catch { /* server away: not seen */ }
      if (stopped) return;
      const j = list && list[key];
      if (!j) { if (Date.now() - seen > lostAfter) { stop(); lost(); } return; }
      seen = Date.now();
      if (j.state === "downloading" || j.state === "verifying") progress(j);
      else { stop(); done(j); }
    } finally { busy = false; }
  }, every);
  return stop;
}

// Live progress from the job's event stream (the SDK's raw SSE layer: its high-level events() keeps progress
// monotonic, which on a self-hosted ComfyUI swallows the sampler's step frames). The job's own state is the final word.
const TERMINAL = new Set(["succeeded", "failed", "canceled", "expired"]);
// A page keeps at most ~6 connections open to one host, and an event stream holds one for as long as its job lives:
// with six jobs queued every other request (the next submit, /view, the queue pill) waited forever. A queued job is
// polled instead, and its stream opens only when it starts running (ComfyUI runs one job at a time).
// A job ComfyUI has forgotten (it restarted: the job list lives in memory) answers 404 for ever, and a server that stays
// down is no different to the page: such a job is lost, not queued. Polls that fail for a while are retried first.
export const POLL = {first: 1000, lostAfter: 45000};
const LOST = "ComfyUI no longer has this job (it was restarted, or stopped answering): run it again";
async function untilRunning(j) {
  let failing = 0;
  for (let wait = POLL.first; ; wait = Math.min(wait * 1.5, 4000)) {
    try { await j.refresh(); failing = 0; }
    catch (e) {
      if (e?.httpStatus === 404 || e?.code === "not_found") throw new Error(LOST);
      failing ||= Date.now();
      if (Date.now() - failing > POLL.lostAfter) throw new Error(LOST);
      console.warn(e);
    }
    if (j.status !== "queued" && j.status !== "pending") return;
    await new Promise(r => setTimeout(r, wait));
  }
}
async function follow(job) {
  const j = job.sdkJob;
  const done = new Set(), total = Object.values(job.w).reduce((a, b) => a + b, 0) || 1;
  try { await untilRunning(j); }
  catch (e) { job.status = "error"; job.error = e.message; emit({type: "job", job}); return; }
  if (TERMINAL.has(j.status)) { await finish(job); return; }
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
  await finish(job);
}
async function finish(job) {
  const j = job.sdkJob;
  try { await j.wait(); } catch (e) { console.warn(e); }
  if (j.status === "succeeded") {
    const rec = await low.getJob(j.id).catch(() => null);          // the raw record carries each output's link
    for (const o of rec?.outputs || []) addOutput(job, o);
    job.status = "done"; job.frac = 1;
    // how long it ran (not counting its wait in the queue), for the time estimates
    try {
      const h = (await json(await fetch(`/history/${j.id}`)))?.[j.id];
      const m = h?.status?.messages || [], a = m.find(x => x[0] === "execution_start")?.[1]?.timestamp, b = m.find(x => x[0] === "execution_success")?.[1]?.timestamp;
      if (a && b) job.ranSeconds = (b - a) / 1000;
    } catch { /* not in history */ }
  } else {
    job.status = "error";
    const er = j.error;
    job.error = er ? `${er.class_type ? er.class_type + ": " : ""}${er.message || er.code}` : TERMINAL.has(j.status) ? j.status : LOST;
  }
  emit({type: "job", job});
}

// resolves with the job once it is done or has failed
export function waitFor(job) {
  return new Promise((res) => {
    if (job.status === "done" || job.status === "error") return res(job);
    const off = on((ev) => {
      if (ev.type === "job" && ev.job.id === job.id && (ev.job.status === "done" || ev.job.status === "error")) { off(); res(ev.job); }
    });
  });
}
// ComfyUI's per-user file store (user/default/...): small JSON the studio keeps between sessions (timings, the bin, test runs)
export async function readUser(path, fallback = null) {
  try { const r = await fetch(`/api/userdata/${encodeURIComponent(path)}`); return r.ok ? await r.json() : fallback; } catch { return fallback; }
}
export async function writeUser(path, data) {
  const r = await fetch(`/api/userdata/${encodeURIComponent(path)}?overwrite=true`, {method: "POST", body: JSON.stringify(data)});
  if (!r.ok) throw new Error(`couldn't save ${path}: ${r.status}`);
}

// A file dropped into the studio is an SDK asset: a handle that lives in this page, and in the proxy's memory until
// ComfyUI restarts. A film plan that points at one (your own song) can't save the handle, so keep() copies the bytes into
// ComfyUI's user folder and remembers where; the plan saves that pointer, and revive() uploads the file again on the next open.
const KEPT = new WeakMap();
export async function keep(asset, blob, name = asset.filePath) {
  const hash = String(await asset.hash()).replace(/^.*:/, "").slice(0, 16), safe = String(name).replace(/[^\w.-]+/g, "_");
  const path = `valis/files/${hash}_${safe}`;
  const r = await fetch(`/api/userdata/${encodeURIComponent(path)}?overwrite=true`, {method: "POST", body: blob});
  if (!r.ok) throw new Error(`couldn't keep ${name}: ${r.status}`);
  KEPT.set(asset, {path, name: String(name), type: blob.type || ""});
  return asset;
}
export const kept = (asset) => KEPT.get(asset);                  // {path, name, type} once keep() has copied it, else undefined
export async function revive(k) {
  const r = await fetch(`/api/userdata/${encodeURIComponent(k.path)}`);
  if (!r.ok) throw new Error(`${k.name} isn't in ComfyUI's user folder any more`);
  const blob = await r.blob(), asset = await upload(new File([blob], k.name, {type: k.type || undefined}));
  KEPT.set(asset, k);                                            // saved again, it still points at the same bytes
  return {asset, url: URL.createObjectURL(blob)};
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
// a file of ComfyUI's ({filename, subfolder, type: output | input}) as a loader input
export const fileRef = (f) => f && typeof f === "object" && f.filename ? `${f.subfolder ? f.subfolder + "/" : ""}${f.filename} [${f.type === "input" ? "input" : "output"}]` : f;
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
// What ComfyUI has installed changes while the page is open: a LoRA put in models/loras is listed at once, a node once ComfyUI
// is restarted. A "yes" is kept for the session; a "no" is asked again after STALE.ms, and an answer ComfyUI could not give
// (it was restarting, a proxy said 502) is never kept, so "not installed" does not stay on screen until the page is reloaded.
export const STALE = {ms: 10000};
async function infoOf(node) {                           // objectInfo, but a ComfyUI that can't answer throws instead of "has nothing"
  const r = await fetch(`/object_info/${encodeURIComponent(node)}`);
  if (!r.ok) throw new Error(`ComfyUI answered ${r.status} for /object_info/${node}`);
  return json(r);
}
const choicesOf = (def) => Array.isArray(def?.[0]) ? def[0] : def?.[0] === "COMBO" && Array.isArray(def[1]?.options) ? def[1].options : [];
const HAVE = {};
async function installed(key, ask) {                    // ask() -> true | false, or throws when ComfyUI can't be read
  let e = HAVE[key];
  if (!e || (!e.yes && Date.now() - e.at >= STALE.ms)) {
    try { e = HAVE[key] = {yes: !!(await ask()), at: Date.now()}; } catch { return false; }
  }
  return e.yes;
}
const LISTS = {};
async function listed(node, input, name) {            // is this name among the choices of node.input? (one /object_info call per STALE.ms at most)
  const k = `${node}.${input}`;
  let e = LISTS[k];
  if (e?.set.has(name)) return true;
  if (!e || Date.now() - e.at >= STALE.ms) {
    try { e = LISTS[k] = {set: new Set(choicesOf((await infoOf(node))?.[node]?.input?.required?.[input])), at: Date.now()}; } catch { return false; }
  }
  return e.set.has(name);
}
// is this LoRA in models/loras?
export const hasLora = (name) => listed("LoraLoaderModelOnly", "lora_name", name);
// is this model patch (Fun ControlNet...) in models/model_patches?
export const hasModelPatch = (name) => listed("ModelPatchLoader", "name", name);
// is this file in models/diffusion_models (or unet)? (asked fresh each time: a download can add it mid-session)
export async function hasUnet(name) {
  try { return choicesOf((await infoOf("UNETLoader"))?.UNETLoader?.input?.required?.unet_name).includes(name); } catch { return false; }
}
// the same for a card that is drawn often: one /object_info call per STALE.ms at most, a "yes" kept
export const hasUnetSoon = (name) => listed("UNETLoader", "unet_name", name);
// is this node installed and loaded? (a new Valis node needs a ComfyUI restart before it shows up)
export const hasNode = (node) => installed(node, async () => !!(await infoOf(node))?.[node]);

// does this loaded node take this input? (a new input, like a new node, needs a ComfyUI restart)
export const hasInput = (node, input) => installed(`${node}.${input}`, async () => {
  const i = (await infoOf(node))?.[node]?.input || {};
  return input in (i.required || {}) || input in (i.optional || {});
});

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
