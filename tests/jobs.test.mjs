// Following a job (and a download), and asking what is installed: one ComfyUI has forgotten (it restarted, and its job list is in memory) or that has stopped answering is
// reported as lost, not polled for ever as "queued" (the Film buttons stayed disabled until a reload); a poll that fails
// for a moment is retried. api.js on a stand-in for Comfy API v2, in Node (no browser, no ComfyUI).
import http from "node:http";
import path from "node:path";
import {fileURLToPath} from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
let pass = 0, fail = 0; const fails = [];
const ok = (c, name, d = "") => { if (c) pass++; else { fail++; fails.push(`${name}${d ? ": " + d : ""}`); } };
let script = [];                                                     // what GET /api/v2/jobs/j1 answers, in turn; the last repeats
let polls = 0, nextId = 1;
const jobs = {};
const rec = (id, status, extra = {}) => ({id, status, urls: {self: `/api/v2/jobs/${id}`, events: `/api/v2/jobs/${id}/events`}, outputs: [], created_at: new Date().toISOString(), ...extra});
const srv = http.createServer((req, res) => {
  req.on("data", () => {}); req.on("end", () => {
    const send = (code, o) => { res.writeHead(code, {"Content-Type": "application/json"}); res.end(JSON.stringify(o)); };
    if (req.method === "POST" && req.url === "/api/v2/jobs") { const id = `j${nextId++}`; jobs[id] = {script: [...script], n: 0}; return send(201, rec(id, "queued")); }
    const m = /^\/api\/v2\/jobs\/(j\d+)$/.exec(req.url);
    if (m && jobs[m[1]]) {
      const J = jobs[m[1]]; polls++;
      const step = J.script[Math.min(J.n++, J.script.length - 1)];
      if (step === "404") return send(404, {error: {code: "not_found", message: `job ${m[1]} not found`}});
      if (step === "500") return send(500, {error: {code: "internal", message: "restarting"}});
      if (step === "drop") return req.socket.destroy();
      if (step === "failed") return send(200, rec(m[1], "failed", {error: {message: "out of memory", class_type: "KSampler"}}));
      return send(200, rec(m[1], step));
    }
    send(404, {error: {code: "not_found", message: "no"}});
  });
});
await new Promise(r => srv.listen(0, r));
globalThis.location = new URL(`http://localhost:${srv.address().port}/valis`);
const api = await import(path.join(here, "..", "app", "js", "api.js"));
api.POLL.first = 40; api.POLL.lostAfter = 600;                       // (a second and 45 s in the studio)
const warn = console.warn; console.warn = () => {};
const graph = {"1": {class_type: "SaveImage", inputs: {filename_prefix: "valis/x", images: ["2", 0]}}};
const settled = async (job, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms && job.status !== "error" && job.status !== "done") await new Promise(r => setTimeout(r, 25)); return job.status; };
const LOST = /no longer has this job/;
try {
  // forgotten by the server: queued, queued, then 404 for ever
  script = ["queued", "queued", "404"];
  let job = await api.submit(graph, "forgotten");
  ok(await settled(job) === "error" && LOST.test(job.error), "a job the server has forgotten is an error, not queued for ever", `${job.status} ${job.error}`);
  const after = polls; await new Promise(r => setTimeout(r, 300));
  ok(polls === after, "and it is no longer polled", `${polls - after} more polls`);
  ok(await Promise.race([api.waitFor(job).then(() => true), new Promise(r => setTimeout(() => r(false), 500))]), "so what waits on it is released");
  // a server that stays down (connection dropped) is lost after a while
  script = ["queued", "drop"];
  job = await api.submit(graph, "down");
  ok(await settled(job) === "error" && LOST.test(job.error), "a server that stops answering loses the job after a while", `${job.status} ${job.error}`);
  // a moment of trouble is retried, and the job's own end is reported as its own
  script = ["queued", "500", "drop", "500", "queued", "failed"];
  job = await api.submit(graph, "blip");
  ok(await settled(job) === "error" && job.error === "KSampler: out of memory", "a poll that fails for a moment is retried, and the job goes on", `${job.status} ${job.error}`);

  // ---- a model download: followed to its end, and let go of when ComfyUI no longer has it
  const realFetch = globalThis.fetch;
  let table = [], asked = 0, down = false;                          // what GET /valis/models/fetch answers, in turn; the last repeats
  globalThis.fetch = async (url, opts) => {
    if (String(url) !== "/valis/models/fetch") return realFetch(url, opts);
    asked++;
    if (down) throw new TypeError("fetch failed");
    const t = table[Math.min(asked - 1, table.length - 1)];
    return {ok: true, json: async () => t};
  };
  const follow = (key, o = {}) => new Promise((res) => {
    const ev = {progress: [], done: null, lost: false};
    api.followDownload(key, {every: 20, lostAfter: 300, progress: (j) => ev.progress.push(j.state), done: (j) => { ev.done = j; res(ev); }, lost: () => { ev.lost = true; res(ev); }, ...o});
    setTimeout(() => res(ev), 3000);                                // never settled: the caller sees neither
  });
  const K = "diffusion_models/m.safetensors";
  // it runs, is checked, and is done
  asked = 0; table = [{[K]: {state: "downloading", done: 1}}, {[K]: {state: "verifying"}}, {[K]: {state: "done"}}];
  let ev = await follow(K);
  ok(ev.progress.join() === "downloading,verifying" && ev.done?.state === "done" && !ev.lost, "a download is followed to its end", JSON.stringify(ev));
  const askedAtEnd = asked; await new Promise(r => setTimeout(r, 150));
  ok(asked === askedAtEnd, "and then it is no longer asked about", `${asked - askedAtEnd} more`);
  // it fails: the page hears of it as an end, with the error
  asked = 0; table = [{[K]: {state: "downloading"}}, {[K]: {state: "error", error: "disk full"}}];
  ev = await follow(K);
  ok(ev.done?.state === "error" && ev.done.error === "disk full" && !ev.lost, "a download that fails is reported with its error", JSON.stringify(ev));
  // ComfyUI restarted: the route answers {} for it, for ever
  asked = 0; table = [{[K]: {state: "downloading"}}, {}];
  ev = await follow(K);
  ok(ev.lost && !ev.done && ev.progress.length === 1, "a download ComfyUI has forgotten is lost, not waited for for ever", JSON.stringify(ev));
  asked = 0; table = [{}];
  ev = await follow(K);
  ok(ev.lost, "a download that was never there is lost too");
  const askedLost = asked; await new Promise(r => setTimeout(r, 150));
  ok(asked === askedLost, "and a lost download is no longer asked about", `${asked - askedLost} more`);
  // a server away for a moment is waited out; one away for good is lost
  asked = 0; down = false; table = [{[K]: {state: "downloading"}}];
  ev = await follow(K, {lostAfter: 300, progress: (j) => { if (!down && asked === 2) { down = true; setTimeout(() => { down = false; table = [{[K]: {state: "done"}}]; asked = 0; }, 120); } }});
  ok(ev.done?.state === "done" && !ev.lost, "a server that is away for a moment is waited out", JSON.stringify(ev));
  asked = 0; down = false; table = [{[K]: {state: "downloading"}}];
  ev = await follow(K, {progress: () => { down = true; }});
  ok(ev.lost, "a server that stays away loses the download after a while", JSON.stringify(ev));
  globalThis.fetch = realFetch; down = false;

  // ---- what is installed: "no" is asked again, "yes" is kept, and an answer ComfyUI couldn't give is not kept at all
  api.STALE.ms = 150;                                               // (10 s in the studio)
  const oi = {};                                                    // node -> its object_info entry; a node not in it answers {}
  let status = 200, calls = [];
  globalThis.fetch = async (url) => {
    const m = /^\/object_info\/(.+)$/.exec(String(url));
    if (!m) return realFetch(url);
    const node = decodeURIComponent(m[1]); calls.push(node);
    if (status === "drop") throw new TypeError("fetch failed");
    const body = status === 200 ? JSON.stringify(oi[node] ? {[node]: oi[node]} : {}) : "Bad Gateway";
    return {ok: status === 200, status, text: async () => body};
  };
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const lora = (...names) => ({input: {required: {lora_name: [names]}}});
  // a node that wasn't there is found once ComfyUI has it
  ok(await api.hasNode("ValisX") === false, "hasNode · not installed");
  oi.ValisX = {input: {required: {a: ["INT"]}}};
  calls = []; ok(await api.hasNode("ValisX") === false && !calls.length, "hasNode · the no is kept for a moment (not asked on every call)", calls.join());
  await wait(200);
  ok(await api.hasNode("ValisX") === true, "hasNode · and asked again after a while: a restarted ComfyUI has it, the page needn't be reloaded");
  delete oi.ValisX; calls = []; await wait(200);
  ok(await api.hasNode("ValisX") === true && !calls.length, "hasNode · a yes is kept for the session", calls.join());
  // an input, the same
  oi.ValisY = {input: {required: {a: ["INT"]}}};
  ok(await api.hasInput("ValisY", "b") === false, "hasInput · not there");
  oi.ValisY = {input: {required: {a: ["INT"]}, optional: {b: ["INT"]}}}; await wait(200);
  ok(await api.hasInput("ValisY", "b") === true, "hasInput · there once the node takes it");
  // a LoRA put in the folder is listed at once; the first list isn't kept for ever
  oi.LoraLoaderModelOnly = lora("a.safetensors");
  ok(await api.hasLora("a.safetensors") === true && await api.hasLora("b.safetensors") === false, "hasLora · yes and no");
  oi.LoraLoaderModelOnly = lora("a.safetensors", "b.safetensors");
  calls = []; ok(await api.hasLora("b.safetensors") === false && !calls.length, "hasLora · the no is kept for a moment", calls.join());
  await wait(200);
  ok(await api.hasLora("b.safetensors") === true, "hasLora · a LoRA added while the page is open is found");
  oi.LoraLoaderModelOnly = lora(); calls = []; await wait(200);
  ok(await api.hasLora("a.safetensors") === true && !calls.length, "hasLora · what was found is kept", calls.join());
  oi.ModelPatchLoader = {input: {required: {name: [[]]}}};
  ok(await api.hasModelPatch("fun.safetensors") === false, "hasModelPatch · not there");
  oi.ModelPatchLoader = {input: {required: {name: [["fun.safetensors"]]}}}; await wait(200);
  ok(await api.hasModelPatch("fun.safetensors") === true, "hasModelPatch · found when it is");
  // the newer combo spelling
  oi.LoraLoaderModelOnly = {input: {required: {lora_name: ["COMBO", {options: ["c.safetensors"]}]}}};
  ok(await api.hasLora("c.safetensors") === true, "hasLora · a COMBO-spelled list is read as a list", "");
  // ComfyUI that can't answer is not "nothing installed": the next ask goes to the server again at once
  delete oi.ValisZ; status = 502;
  ok(await api.hasNode("ValisZ") === false, "hasNode · a 502 is a no");
  status = 200; oi.ValisZ = {input: {}};
  ok(await api.hasNode("ValisZ") === true, "hasNode · and is not remembered as one");
  await wait(200); status = "drop"; oi.LoraLoaderModelOnly = lora("d.safetensors");
  ok(await api.hasLora("d.safetensors") === false, "hasLora · a ComfyUI that doesn't answer has no LoRAs, for now");
  status = 200;
  ok(await api.hasLora("d.safetensors") === true, "hasLora · and the list that couldn't be read isn't kept as empty");
  globalThis.fetch = realFetch;
} finally {
  console.warn = warn; srv.close();
}
console.log(`${pass} passed, ${fail} failed`);
if (fail) { console.log(fails.join("\n")); process.exit(1); }
process.exit(0);
