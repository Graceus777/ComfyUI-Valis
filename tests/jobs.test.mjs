// Following a job: one ComfyUI has forgotten (it restarted, and its job list is in memory) or that has stopped answering is
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
} finally {
  console.warn = warn; srv.close();
}
console.log(`${pass} passed, ${fail} failed`);
if (fail) { console.log(fails.join("\n")); process.exit(1); }
process.exit(0);
