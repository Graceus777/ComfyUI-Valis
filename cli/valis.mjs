#!/usr/bin/env node
// Valis from the command line (or from a coding agent): the studio's graphs, run through the Comfy SDK.
//
//   node cli/valis.mjs swap  --video take.mp4 --character vampire_sheet.png --background ballroom.png
//   node cli/valis.mjs turn  --a take_as_the_man.mp4 --b take_as_the_vampire.mp4 --at 3.8
//   node cli/valis.mjs transform --video clip.mp4 --target "his head" --look bronze
//   node cli/valis.mjs run workflows/05_transform_vampire.json --set 16.file=clip.mp4
//
// Local files are uploaded as SDK assets; a path like "valis/x.mp4" that isn't on this disk is read from ComfyUI's
// input folder as is. Results are downloaded into --out (default ./valis_out). Needs Node 18+ and nothing else:
// it uses the same bundled @comfyorg/sdk as the studio.
//
// Target: --api (or COMFY_BASE_URL), default http://127.0.0.1:8188, the ComfyUI running this pack. --key for a
// Comfy Cloud / Comfy API deployment.
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import * as G from "../app/js/graphs.js";
import * as P from "../app/js/presets.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const HELP = `valis <command> [options]

commands
  film       --idea "..." [--genre gothic --shots 6 --plan-only | --plan plan.json]                        one line (or a plan built from references: sheets, sets, frames) -> a scored, cut short film
  frame      --prompt "..." [--genre gothic --framing close --lens 85 --light candle --grade teal]   two Krea 2 keyframes
  cast       --keyframe k.png --character c.png [--prompt "..."]                                      put a character into a keyframe
  shoot      --image k.png --motion "..." [--move push --seconds 4.5]                                   H3 image-to-video
  find       --video clip.mp4 --target "her dress"                                                      SAM 3 matte + overlay
  transform  --video clip.mp4 --target "his head" [--look bronze] [--ref look.png] [--words "a stag-headed spirit of bark"]
                                                                                                    a look (57: presets.js LOOKS), your own picture and/or words, or both
  remove     --video clip.mp4 --target "the man in the mirror"
  swap       --video take.mp4 --character sheet.png [--background plate.png --person man --slow]       full character swap
  turn       --a take.mp4 --b swapped.mp4 [--at 3.8 --person man]                                       Valis turn on a word
  score      --clip shot.mp4 --score score.json --bar 52 [--layer fx.mp4 --section finale --a "the man"]
  run        workflow.json [--set node.input=value ...]                                                any API-format graph

options
  --api URL   Comfy API v2 base (default $COMFY_BASE_URL or http://127.0.0.1:8188)
  --key KEY   API key for Comfy Cloud or a Comfy API deployment
  --out DIR   where results go (default ./valis_out)
  --json      print the graph instead of running it
`;

function parse(argv) {
  const o = {_: [], set: []};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) { o._.push(a); continue; }
    const k = a.slice(2), v = argv[i + 1];
    if (v === undefined || v.startsWith("--")) { o[k] = true; continue; }
    if (k === "set") o.set.push(v); else o[k] = v;
    i++;
  }
  return o;
}
const opt = parse(process.argv.slice(2));
const cmd = opt._[0];
if (!cmd || opt.help || cmd === "help") { process.stdout.write(HELP); process.exit(0); }

process.env.COMFY_BASE_URL = (opt.api || process.env.COMFY_BASE_URL || "http://127.0.0.1:8188").replace(/\/+$/, "");
const {Comfy} = await import("../app/vendor/comfy-sdk.js");
const sdk = new Comfy({fetch: (...a) => globalThis.fetch(...a), ...(opt.key ? {apiKey: opt.key} : {})});
const INPUTS = {};
const inputsOf = (node) => INPUTS[node] ??= fetch(`${process.env.COMFY_BASE_URL}/object_info/${encodeURIComponent(node)}`)
  .then(r => r.json()).then(i => i?.[node]?.input || {}, () => ({}));

const MIME = {".mp4": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime", ".png": "image/png", ".jpg": "image/jpeg",
              ".jpeg": "image/jpeg", ".webp": "image/webp", ".wav": "audio/wav", ".flac": "audio/flac", ".mp3": "audio/mpeg", ".json": "application/json"};
const uploads = new Map();
async function file(p) {                   // local file -> SDK asset (uploaded once); anything else -> a ComfyUI input path
  if (p == null || p === true) return null;
  if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) return p;
  if (!uploads.has(p)) {
    const a = sdk.assets.fromBytes(new Uint8Array(fs.readFileSync(p)), {filename: path.basename(p), contentType: MIME[path.extname(p).toLowerCase()]});
    await a.commit();
    uploads.set(p, a);
  }
  return uploads.get(p);
}
const need = (k) => { if (!opt[k]) { console.error(`--${k} is required for ${cmd}`); process.exit(2); } return opt[k]; };
const pick = (list, id) => list.find(x => x.id === String(id)) || list[0];
const stamp = () => Date.now().toString(36);

async function build() {
  switch (cmd) {
    case "frame": return G.keyframes({prompt: P.keyframePrompt({genre: pick(P.GENRES, opt.genre), framing: pick(P.FRAMING, opt.framing), lens: pick(P.LENS, opt.lens),
      light: pick(P.LIGHT, opt.light), grade: pick(P.GRADE, opt.grade || "none"), subject: need("prompt")}), prefix: `valis/key_${stamp()}`});
    case "cast": return G.castCharacter({keyframe: await file(need("keyframe")), character: await file(need("character")),
      prompt: opt.prompt || "Put the character from the second image into the first image, same pose, same light.", prefix: `valis/cast_${stamp()}`});
    case "shoot": return G.shot({image: await file(need("image")), motion: P.motionPrompt({genre: pick(P.GENRES, opt.genre), move: pick(P.MOVES, opt.move || "static"), action: need("motion")}),
      seconds: Number(opt.seconds || 4.46), prefix: `valis/shot_${stamp()}`});
    case "find": return G.maskPreview({video: await file(need("video")), target: need("target"), prefix: `valis/find_${stamp()}`});
    case "transform": case "remove": {
      const T = need("target");
      if (cmd === "remove") return G.edit({mode: "remove", video: await file(need("video")), target: T, anchorPrompt: P.REMOVE_PROMPT.replaceAll("{T}", T),
        desc: "gone; only what was behind it remains", who: "the masked region", keep: "everything around it", prefix: `valis/edit_${stamp()}`});
      // your own look (a reference picture and/or words), a preset, or a preset matched to your picture
      const ref = opt.ref ? await file(opt.ref) : null, words = opt.words || "";
      const look = words || (ref && !opt.look) ? P.ownLook({words, ref: !!ref}) : pick(P.LOOKS, opt.look || "fire");
      let anchor = look.anchor.replaceAll("{T}", T);
      if (ref && look.id !== "own") anchor = anchor.replace(/\s*Keep /, " Match the look in the reference picture. Keep ");
      return G.edit({mode: "transform", video: await file(need("video")), target: T, anchorPrompt: anchor, desc: look.desc,
        who: T || look.who, keep: look.keep, refBoost: look.rb, lookRef: ref, prefix: `valis/edit_${stamp()}`});
    }
    case "swap": return G.swapFull({video: await file(need("video")), character: await file(need("character")), background: await file(opt.background),
      person: opt.person || "person", prompt: opt.prompt || G.swapPrompt({target: `the ${opt.person || "person"}`}), turbo: !opt.slow, prefix: `valis/swap_${stamp()}`});
    case "turn": return G.turn({a: await file(need("a")), b: await file(need("b")), swapAt: opt.at ? Number(opt.at) : -1, person: opt.person || "person",
      prefix: `valis/turn_${stamp()}`});
    case "score": return G.valisShot({clip: await file(need("clip")), score: await file(need("score")), startBar: Number(need("bar")), section: opt.section || "",
      layer: await file(opt.layer), targetA: opt.a || "", targetB: opt.b || "", prefix: `valis/valis_${stamp()}`,
      rules: [{event: "impact", effect: "halo"}, {event: "kick", effect: "ignite"}, {event: "stroke", effect: "shockwave"}]});
    case "run": {
      const g = JSON.parse(fs.readFileSync(need("_1") , "utf8"));
      for (const s of opt.set) {
        const [lhs, ...rest] = s.split("="), v = rest.join("="), dot = lhs.indexOf(".");
        const id = lhs.slice(0, dot), key = lhs.slice(dot + 1);
        if (!g[id]) { console.error(`no node ${id} in the workflow`); process.exit(2); }
        g[id].inputs[key] = /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : await file(v);
      }
      return g;
    }
  }
  console.error(`unknown command: ${cmd}\n\n${HELP}`); process.exit(2);
}
if (cmd === "run") opt._1 = opt._[1];

if (cmd === "film") {
  // the whole film through the same SDK: film.js runs the chain, this is its view of the client
  const {planFilm, makeFilm} = await import("../app/js/film.js");
  const genre = P.GENRES.find(g => g.id === (opt.genre || "gothic")) || P.GENRES[0];
  const saves = (graph) => new Set(Object.entries(graph).filter(([, n]) => /^Save/.test(n.class_type)).map(([id]) => id));
  const view = (f) => `${process.env.COMFY_BASE_URL}/view?filename=${encodeURIComponent(f.filename)}&subfolder=${encodeURIComponent(f.subfolder || "")}&type=${f.type || "output"}`;
  const io = {
    run: async (graph, label) => {
      const t = Date.now(), job = await sdk.submit(sdk.workflows.fromJson(await G.respell(graph, inputsOf)));
      console.error(`${label}: job ${job.id}`);
      await job.wait();
      if (job.status !== "succeeded") { const e = job.error; throw new Error(`${label} failed: ${e ? `${e.class_type || ""} ${e.message || e.code}` : job.status}`); }
      console.error(`${label}: done in ${((Date.now() - t) / 1000).toFixed(0)}s`);
      const ok = saves(graph);
      return {outputs: job.outputs.filter(o => !o.nodeId || ok.has(o.nodeId)).map(o => ({filename: o.name, subfolder: "valis", type: "output", nodeId: o.nodeId, _o: o}))};
    },
    text: async (f) => f._o ? Buffer.from(await f._o.toBytes()).toString("utf8") : await fetch(view(f)).then(r => r.text()),
    ref: (f) => `${f.subfolder}/${f.filename} [output]`,
    exists: async (f) => (await fetch(view(f), {method: "HEAD"})).ok,
    free: () => fetch(`${process.env.COMFY_BASE_URL}/free`, {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({unload_models: true, free_memory: true})}),
    has: async (node) => !!(await fetch(`${process.env.COMFY_BASE_URL}/object_info/${node}`).then(r => r.json()).catch(() => ({})))[node],
  };
  let plan;
  if (opt.plan && fs.existsSync(opt.plan)) plan = JSON.parse(fs.readFileSync(opt.plan, "utf8"));       // a plan edited by hand
  else {
    plan = await planFilm({idea: need("idea"), shots: Number(opt.shots || 6), genre}, io);
    if (opt["plan-only"]) { console.log(JSON.stringify(plan, null, 2)); process.exit(0); }
  }
  console.error(`plan: ${plan.title}, ${plan.shots.length} shots`);
  const r = await makeFilm(plan, io, {genre, onStage: (stage, msg) => console.error(`${stage}: ${msg}`)});
  const out = opt.out || "valis_out";
  fs.mkdirSync(out, {recursive: true});
  const dest = path.join(out, r.film.filename);
  fs.writeFileSync(dest, r.film._o ? await r.film._o.toBytes() : Buffer.from(await fetch(view(r.film)).then(x => x.arrayBuffer())));
  console.log(JSON.stringify({plan, film: dest, song: r.song.filename, bpm: r.bar.bpm, bars_per_shot: r.cut.bars, shots: r.fxed.map(v => v.filename)}, null, 2));
  process.exit(0);
}

const graph = await build();
if (opt.json) { console.log(JSON.stringify(graph, (k, v) => (v && v.filePath !== undefined && v.commit ? `<asset ${v.filePath}>` : v), 2)); process.exit(0); }

const t0 = Date.now();
const job = await sdk.submit(sdk.workflows.fromJson(await G.respell(graph, inputsOf)));
console.error(`job ${job.id} queued on ${process.env.COMFY_BASE_URL}`);
let last = "";
for await (const ev of job.events()) {
  if (ev.kind === "progress") {
    const s = ev.steps ? `step ${ev.step}/${ev.steps}` : `${Math.round(ev.value * 100)}%`;
    if (s !== last) { process.stderr.write(`\r${s} ${ev.currentNode ? "· node " + ev.currentNode : ""}      `); last = s; }
  } else if (ev.kind === "statusChange") process.stderr.write(`\r${ev.status}                    \n`);
}
await job.wait();
const secs = ((Date.now() - t0) / 1000).toFixed(0);
if (job.status !== "succeeded") {
  const e = job.error;
  console.error(`failed after ${secs}s: ${e ? `${e.class_type || ""} ${e.message || e.code}` : job.status}`);
  process.exit(1);
}
const out = opt.out || "valis_out";
fs.mkdirSync(out, {recursive: true});
const saved = [];
const saves = new Set(Object.entries(graph).filter(([, n]) => /^Save/.test(n.class_type)).map(([id]) => id));   // results, not the loaders' previews
for (const o of job.outputs) {
  if (o.nodeId && !saves.has(o.nodeId)) continue;
  const dest = path.join(out, o.name);
  fs.writeFileSync(dest, await o.toBytes());
  saved.push(dest);
}
console.error(`done in ${secs}s`);
console.log(JSON.stringify({job: job.id, seconds: Number(secs), outputs: saved}, null, 2));
