#!/usr/bin/env node
// Valis from the command line (or from a coding agent): the studio's graphs, run through the Comfy SDK.
//
//   node cli/valis.mjs frame --prompt "a lighthouse keeper on the rocks at night" --body 16mm --light candle --look noir
//   node cli/valis.mjs shoot --image key.png --motion "he raises the lantern" --move crane_up --anchor
//   node cli/valis.mjs swap  --video take.mp4 --character vampire_sheet.png --background ballroom.png
//   node cli/valis.mjs turn  --a take_as_the_man.mp4 --b take_as_the_vampire.mp4 --at 3.8
//   node cli/valis.mjs transform --video clip.mp4 --target "his head" --look bronze
//   node cli/valis.mjs run workflows/05_transform_vampire.json --set 16.file=clip.mp4
//
// frame and shoot take the Create tab's choices and go through its planner (app/js/create.js), so a command makes what
// the button makes. Local files are uploaded as SDK assets; a path like "valis/x.mp4" that isn't on this disk is read
// from ComfyUI's input folder as is. Results are downloaded into --out (default ./valis_out). Needs Node 18+ and
// nothing else: it uses the same bundled @comfyorg/sdk as the studio.
//
// Target: --api (or COMFY_BASE_URL), default http://127.0.0.1:8188, the ComfyUI running this pack. --key for a
// Comfy Cloud / Comfy API deployment.
import fs from "node:fs";
import path from "node:path";
import * as G from "../app/js/graphs.js";
import * as P from "../app/js/presets.js";
import * as CR from "../app/js/create.js";
import {PALETTES} from "../app/js/palettes.js";

// ---- what the list options take: the studio's own ids (presets.js, palettes.js)
const ids = (list) => list.map(x => x.id);
// older ids, still taken: shoot's eight moves and frame's seven grades, each as the Create choice nearest it
const OLD_MOVES = {push: "push_in", pull: "pull_out", orbit: "orbit_360", crane: "crane_up", track: "dolly_right", hand: "handheld", dolly: "dolly_zoom_in"};
const OLD_GRADES = {none: "auto", teal: "teal_orange", bleach: "bleach_bypass", mono: "silver_mono", techni: "technicolor", faded: "faded_70s", steel: "chrome"};
const PANEL = {          // Create's choices: option -> [ids, default, what it is]
  genre: [ids(P.GENRES), "gothic", "genre"], framing: [ids(P.FRAMING), "wide", "framing"], lens: [ids(P.LENS), "auto", "focal length"],
  body: [ids(P.BODIES), "auto", "camera body"], kit: [ids(P.LENS_KITS), "auto", "lens kit"], light: [ids(P.LIGHT), "auto", "light source"],
  setup: [ids(P.LIGHTING), "auto", "lighting setup"], era: [ids(P.ERAS), "auto", "era"],
  look: [["auto", ...ids(PALETTES), "custom"], "auto", "colour palette: its words in the keyframe, and the shot graded in it"],
  aspect: [Object.keys(CR.KEY_SIZES), "9:16", "aspect"],
};
const MOTION = {         // shoot only
  move: [ids(P.CAMERA_MOVES), "static", "camera move"], emotion: [ids(P.EMOTIONS), "neutral", "emotion"], tempo: [ids(P.TEMPO), "single", "tempo"],
};
const LOOKS = ids(P.LOOKS);

const wrap = (text, indent, width = 118) => {
  const out = [];
  let line = "";
  for (const w of text.split(" ")) {
    if (line && indent.length + line.length + 1 + w.length > width) { out.push(indent + line); line = w; } else line = line ? `${line} ${w}` : w;
  }
  return [...out, indent + line].join("\n");
};
const listed = (opts) => Object.entries(opts).map(([k, [list, def, what]]) =>
  `  --${k.padEnd(9)}${what} (default ${def})\n${wrap(list.join(" "), "             ")}`).join("\n");

const HELP = `valis <command> [options]

commands
  film       --idea "..." [--genre gothic --shots 6 --plan-only]                one line -> a scored, cut short film
             --plan plan.json [--genre ID --plan-only]                          a plan from --plan-only, the studio or your
                                                                                hand (references too: sheets, sets, frames),
                                                                                in its own genre unless --genre is given
  frame      --prompt "..." [Create's choices]                                  two Krea 2 keyframes, as Create · Frame it
  cast       --keyframe k.png --character c.png [--prompt "..."]                put a character into a keyframe
  shoot      --image k.png --motion "..." [Create's choices, shot options]      the shot, as Create · Shoot it
  find       --video clip.mp4 --target "her dress"                              SAM 3 matte + overlay
  transform  --video clip.mp4 --target "his head" [--look bronze] [--ref look.png] [--words "a stag-headed spirit of bark"]
                                                                                a look (below), your own picture and/or words
  remove     --video clip.mp4 --target "the man in the mirror"
  swap       --video take.mp4 --character sheet.png [--background plate.png --person man --slow]   full character swap
  turn       --a take.mp4 --b swapped.mp4 [--at 3.8 --person man]               Valis turn on a word
  score      --clip shot.mp4 --score score.json --bar 52 [--layer fx.mp4 --section finale --a "the man" --b "the woman"]
  run        workflow.json [--set node.input=value ...]                         any API-format graph

Create's choices (frame and shoot; film --genre too), by id
${listed(PANEL)}
  --colours  your own colours, e.g. "#10202c #2e6f73 #e0a15a": over --look, or alone (--look custom)
  --seed N   frame: the keyframes' seeds are N and N+101 (default 7101); shoot: the shot's seed (default 51101)

shot options (shoot)
  --prompt   what the keyframe shows (H3's sound and a trained move's prompt use it)
${listed(MOTION)}
  --seconds  the shot's length, 2 to 15 (default 4.46)
  --size     the shot's short side in px, 320 to 1024 (default 768)
  --who      who the camera is about (default "the subject")
  --sound    what H3 hears (default: the scene as it happens)
  --relit    a relit version of the keyframe: the light changes to it during the shot
  --anchor   end on the subject: the last frame is pinned so the move finishes on them
  --untrained  every move from words, with no camera LoRA
  --no-trim  keep the still end that a pinned last frame leaves
  --no-grade the palette's words only: the shot isn't graded

older ids, still taken
${wrap(`--move ${Object.entries(OLD_MOVES).map(([a, b]) => `${a} (${b})`).join(", ")}`, "  ")}
${wrap(`--grade, the older --look: ${Object.entries(OLD_GRADES).map(([a, b]) => `${a} (${b})`).join(", ")}`, "  ")}

transform --look (default fire)
${wrap(LOOKS.join(" "), "  ")}

options
  --api URL   Comfy API v2 base (default $COMFY_BASE_URL or http://127.0.0.1:8188)
  --key KEY   API key for Comfy Cloud or a Comfy API deployment
  --out DIR   where results go (default ./valis_out)
  --json      print the graph instead of running it (every command but film: film --plan-only prints the plan)
`;

// ---- the command line
const SWITCHES = new Set(["help", "json", "plan-only", "slow", "anchor", "untrained", "no-trim", "no-grade"]);
const COMMON = ["api", "key", "out", "json", "help"];
const SHOT = [...Object.keys(PANEL), "colours", "grade", "seed"];
const OPTIONS = {
  film: ["api", "key", "out", "help", "idea", "genre", "shots", "plan", "plan-only"],
  frame: [...COMMON, "prompt", ...SHOT],
  cast: [...COMMON, "keyframe", "character", "prompt"],
  shoot: [...COMMON, "image", "motion", "prompt", ...SHOT, ...Object.keys(MOTION), "seconds", "size", "who", "sound", "anchor", "untrained", "no-trim", "no-grade", "relit"],
  find: [...COMMON, "video", "target"],
  transform: [...COMMON, "video", "target", "look", "ref", "words"],
  remove: [...COMMON, "video", "target"],
  swap: [...COMMON, "video", "character", "background", "person", "prompt", "slow"],
  turn: [...COMMON, "a", "b", "at", "person"],
  score: [...COMMON, "clip", "score", "bar", "layer", "section", "a", "b"],
  run: [...COMMON, "set"],
};
function parse(argv) {
  const o = {_: [], set: []};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) { o._.push(a); continue; }
    const k = a.slice(2), v = argv[i + 1];
    if (k === "set" && (v === undefined || v.startsWith("--"))) { o.set.push(true); continue; }   // a --set with nothing after it: told when run reads them
    if (SWITCHES.has(k) || v === undefined || v.startsWith("--")) { o[k] = true; continue; }       // a switch never takes the next word
    if (k === "set") o.set.push(v); else o[k] = v;
    i++;
  }
  return o;
}
const opt = parse(process.argv.slice(2));
const cmd = opt._[0];
if (!cmd || opt.help || cmd === "help") { process.stdout.write(HELP); process.exit(0); }

const usage = (msg) => { console.error(msg); process.exit(2); };
if (!OPTIONS[cmd]) usage(`unknown command: ${cmd}\n\n${HELP}`);
for (const [k, v] of Object.entries(opt)) {
  if (k === "_" || (k === "set" && !v.length)) continue;
  if (!OPTIONS[cmd].includes(k))
    usage(`${cmd} has no option --${k}${k === "json" && cmd === "film" ? " (film --plan-only prints the plan)" : ""}. Its options: ${OPTIONS[cmd].map(x => "--" + x).join(" ")}`);
  if (v === true && !SWITCHES.has(k)) usage(`--${k} needs a value`);
}
if (cmd === "run" ? opt._.length > 2 : opt._.length > 1) usage(`unexpected ${opt._.slice(cmd === "run" ? 2 : 1).map(x => `"${x}"`).join(" ")} (every option is --name value)`);

const need = (k) => { if (!opt[k]) usage(`--${k} is required for ${cmd}`); return opt[k]; };
// an id from a list: an id the list doesn't have is an error that names the ones it has
const choice = (k, list, def) => {
  const v = opt[k] ?? def;
  if (!list.includes(v)) usage(`--${k} ${v}: no such id. Pick one of: ${list.join(" ")}`);
  return v;
};
const num = (k, def, {min = -Infinity, max = Infinity, whole = false} = {}) => {
  if (opt[k] === undefined) return def;
  const v = Number(opt[k]);
  if (opt[k] === "" || !Number.isFinite(v) || v < min || v > max || (whole && !Number.isInteger(v)))
    usage(`--${k} takes ${whole ? "a whole number" : "a number"}${max < Infinity ? ` from ${min} to ${max}` : min > -Infinity ? ` of at least ${min}` : ""}, not "${opt[k]}"`);
  return v;
};
const stamp = () => Date.now().toString(36);

// Create's panel from the options, as create.js reads it (ids)
function panel() {
  const C = Object.fromEntries(Object.entries(PANEL).map(([k, [list, def]]) => [k, choice(k, list, def)]));
  if (opt.grade !== undefined) {
    if (opt.look !== undefined) usage("--grade is the older name for --look: give one of them");
    C.look = OLD_GRADES[choice("grade", Object.keys(OLD_GRADES))];
  }
  let hex = null;
  if (opt.colours !== undefined) {
    hex = opt.colours.split(/[\s,]+/).filter(Boolean).map(c => c.replace(/^#?/, "#").toLowerCase());
    const bad = hex.filter(c => !/^#[0-9a-f]{6}$/.test(c));
    if (bad.length || hex.length < 2) usage(`--colours takes two or more colours as #rrggbb${bad.length ? `, not ${bad.join(" ")}` : ""}`);
    if (opt.look === undefined && opt.grade === undefined) C.look = "custom";
  } else if (C.look === "custom") usage("--look custom is your own colours: give them with --colours");
  // the panel's names: lens is the focal length
  const {lens, look, ...rest} = C;
  return {...rest, focal: lens, look: hex ? {id: look, hex} : {id: look}, gradeShot: !opt["no-grade"]};
}
function shotPanel() {
  const move = Object.hasOwn(OLD_MOVES, opt.move ?? "") ? OLD_MOVES[opt.move] : choice("move", ...MOTION.move);
  return {move, emotion: choice("emotion", ...MOTION.emotion), tempo: choice("tempo", ...MOTION.tempo),
    seconds: num("seconds", 107 / 24, {min: 2, max: 15}), short: num("size", CR.NATIVE_SHORT, {min: 320, max: 1024}),
    seed: num("seed", 51101, {min: 0, whole: true}), who: opt.who || "", sound: opt.sound || "", subject: opt.prompt || "",
    opts: {trained: !opt.untrained, anchor: !!opt.anchor, trim: !opt["no-trim"], lightChange: !!opt.relit}};
}

// nothing above needs a server, and build() reads the whole command line before it uploads anything: a bad one fails
// before anything is sent
process.env.COMFY_BASE_URL = (opt.api || process.env.COMFY_BASE_URL || "http://127.0.0.1:8188").replace(/\/+$/, "");
const BASE = process.env.COMFY_BASE_URL;
const {Comfy} = await import("../app/vendor/comfy-sdk.js");
// ComfyUI turning a graph down (a model file that isn't there, a node it hasn't loaded) arrives as an SDK error whose message is
// only "Prompt outputs failed validation"; which node and input it was is in its details. Say that, in lines, not a stack trace
function explain(e) {
  const ne = e?.details?.node_errors || e?.details?.errors, lines = [];
  if (ne && typeof ne === "object") for (const [id, n] of Object.entries(ne))
    for (const x of n?.errors || []) lines.push(`  node ${id} (${n.class_type || "?"}): ${[x.message, x.details].filter(Boolean).join(": ")}`.slice(0, 300));
  const head = e?.message || String(e);
  return lines.length ? `${head}\n${lines.slice(0, 6).join("\n")}${lines.length > 6 ? `\n  and ${lines.length - 6} more` : ""}` : head;
}
const guarded = async (what, fn) => { try { return await fn(); } catch (e) { console.error(`${what}: ${explain(e)}`); process.exit(1); } };
const sdk = new Comfy({fetch: (...a) => globalThis.fetch(...a), ...(opt.key ? {apiKey: opt.key} : {})});
// a node's /object_info: its entry, null when this ComfyUI hasn't loaded it, undefined when the server can't be read
const INFO = {};
const nodeInfo = (node) => INFO[node] ??= fetch(`${BASE}/object_info/${encodeURIComponent(node)}`)
  .then(r => r.ok ? r.json() : Promise.reject(new Error(r.status))).then(i => i?.[node] || null, () => undefined);
const inputsOf = async (node) => (await nodeInfo(node))?.input || {};
// what Create's planner asks of this ComfyUI (api.js hasNode, hasLora); a server that can't be read is taken to have
// everything, so --json still prints the graph the button would send
let unread = false;
const known = (i, yes) => { if (i === undefined) { unread = true; return true; } return !!i && yes(i); };
const env = {
  hasNode: async (node) => known(await nodeInfo(node), () => true),
  hasLora: async (name) => known(await nodeInfo("LoraLoaderModelOnly"), (i) => (i.input?.required?.lora_name?.[0] || []).includes(name)),
};

const MIME = {".mp4": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime", ".png": "image/png", ".jpg": "image/jpeg",
              ".jpeg": "image/jpeg", ".webp": "image/webp", ".wav": "audio/wav", ".flac": "audio/flac", ".mp3": "audio/mpeg", ".json": "application/json"};
const uploads = new Map();
async function file(p) {                   // local file -> SDK asset (uploaded once); anything else -> a ComfyUI input path
  if (p == null || p === true) return null;
  if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) return p;
  if (opt.json) return `<asset ${p}>`;     // --json prints the graph and sends nothing, so nothing goes up either
  if (!uploads.has(p)) {
    const a = sdk.assets.fromBytes(new Uint8Array(fs.readFileSync(p)), {filename: path.basename(p), contentType: MIME[path.extname(p).toLowerCase()]});
    await guarded(`can't send ${p} to ${BASE}`, () => a.commit());
    uploads.set(p, a);
  }
  return uploads.get(p);
}

// A --set value takes the type its input declares on this ComfyUI (a text "false" is true to ComfyUI, a number in a text input
// is not a number, and a choice is spelled as its list spells it). Where that can't be read (no server, a node it doesn't have,
// a template type) it is guessed from the text: true/false, a number, else a picture, video or sound of yours, else the text.
const YES = ["true", "yes", "on", "1"], NO = ["false", "no", "off", "0"];
async function typed(cls, id, key, v) {
  const info = await inputsOf(cls), def = info.required?.[key] ?? info.optional?.[key], t = def?.[0], at = `--set ${id}.${key}=${v}`;
  const l = v.trim().toLowerCase();
  if (t === "BOOLEAN") { if (!YES.includes(l) && !NO.includes(l)) usage(`${at}: ${key} is true or false`); return YES.includes(l); }
  if (t === "INT" || t === "FLOAT") {
    const n = l === "" ? NaN : Number(l);
    if (!Number.isFinite(n) || (t === "INT" && !Number.isInteger(n))) usage(`${at}: ${key} takes ${t === "INT" ? "a whole number" : "a number"}`);
    return n;
  }
  if (t === "STRING") return v;
  const choices = Array.isArray(t) ? t : t === "COMBO" && Array.isArray(def[1]?.options) ? def[1].options : null;
  if (choices) { const c = choices.find(x => String(x) === v); return c !== undefined ? c : await file(v); }   // a choice, or a file of yours to send
  if (l === "true" || l === "false") return l === "true";
  return /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : await file(v);
}

const REQUIRED = {frame: ["prompt"], cast: ["keyframe", "character"], shoot: ["image", "motion"], find: ["video", "target"], transform: ["video", "target"],
  remove: ["video", "target"], swap: ["video", "character"], turn: ["a", "b"], score: ["clip", "score", "bar"]};
async function build() {
  for (const k of REQUIRED[cmd] || []) need(k);          // before anything is uploaded
  switch (cmd) {
    case "frame": {
      const C = {...panel(), subject: need("prompt")}, seed = num("seed", 7101, {min: 0, whole: true});
      return CR.keyframesGraph(C, {seeds: [seed, seed + 101], prefix: `valis/key_${stamp()}`});
    }
    case "cast": return G.castCharacter({keyframe: await file(need("keyframe")), character: await file(need("character")),
      prompt: opt.prompt || "Put the character from the second image into the first image, same pose, same light.", prefix: `valis/cast_${stamp()}`});
    case "shoot": {
      const C = {...panel(), ...shotPanel(), action: opt.motion, prefix: `valis/shot_${stamp()}`};
      C.image = await file(opt.image);
      C.relit = await file(opt.relit);
      const plan = await CR.planShot(C, env);
      if (unread) console.error(`${BASE}/object_info can't be read: built as if every node and camera LoRA were installed`);
      console.error(plan.label);
      plan.notes.forEach(n => console.error(n));
      return plan.graph;
    }
    case "find": return G.maskPreview({video: await file(need("video")), target: need("target"), prefix: `valis/find_${stamp()}`});
    case "transform": case "remove": {
      const T = need("target");
      if (cmd === "remove") return G.edit({mode: "remove", video: await file(need("video")), target: T, anchorPrompt: P.REMOVE_PROMPT.replaceAll("{T}", T),
        desc: "gone; only what was behind it remains", who: "the masked region", keep: "everything around it", prefix: `valis/edit_${stamp()}`});
      // your own look (a reference picture and/or words), a preset, or a preset matched to your picture
      const preset = P.LOOKS.find(l => l.id === choice("look", LOOKS, "fire"));
      const ref = opt.ref ? await file(opt.ref) : null, words = opt.words || "";
      const look = words || (ref && !opt.look) ? P.ownLook({words, ref: !!ref}) : preset;
      let anchor = look.anchor.replaceAll("{T}", T);
      if (ref && look.id !== "own") anchor = anchor.replace(/\s*Keep /, " Match the look in the reference picture. Keep ");
      return G.edit({mode: "transform", video: await file(opt.video), target: T, anchorPrompt: anchor, desc: look.desc,
        who: look.who || T, keep: look.keep, refBoost: look.rb, lookRef: ref, prefix: `valis/edit_${stamp()}`});
    }
    case "swap": return G.swapFull({video: await file(need("video")), character: await file(need("character")), background: await file(opt.background),
      person: opt.person || "person", prompt: opt.prompt || G.swapPrompt({target: `the ${opt.person || "person"}`}), turbo: !opt.slow, prefix: `valis/swap_${stamp()}`});
    case "turn": {
      const swapAt = num("at", -1, {min: 0});
      return G.turn({a: await file(need("a")), b: await file(need("b")), swapAt, person: opt.person || "person", prefix: `valis/turn_${stamp()}`});
    }
    case "score": {
      const startBar = num("bar", 0, {min: 0, whole: true});
      return G.valisShot({clip: await file(need("clip")), score: await file(need("score")), startBar, section: opt.section || "",
        layer: await file(opt.layer), targetA: opt.a || "", targetB: opt.b || "", prefix: `valis/valis_${stamp()}`,
        rules: [{event: "impact", effect: "halo"}, {event: "kick", effect: "ignite"}, {event: "stroke", effect: "shockwave"}]});
    }
    case "run": {
      const wf = opt._[1];
      if (!wf) usage("run needs a workflow file: node cli/valis.mjs run workflow.json [--set node.input=value ...]");
      let g;
      try { g = JSON.parse(fs.readFileSync(wf, "utf8")); } catch (e) { usage(`can't read the workflow ${path.resolve(wf)}: ${e.code === "ENOENT" ? "no such file" : e.message}`); }
      const sets = opt.set.map(s => {
        if (s === true) usage("--set needs a value: write it as node.input=value");
        const eq = s.indexOf("="), lhs = eq < 0 ? s : s.slice(0, eq), dot = lhs.indexOf(".");
        if (eq < 0 || dot <= 0 || dot === lhs.length - 1) usage(`--set ${s}: write it as node.input=value`);
        const id = lhs.slice(0, dot), key = lhs.slice(dot + 1);
        if (!g[id]?.inputs) usage(`no node ${id} in the workflow`);
        return [id, key, s.slice(eq + 1)];
      });
      for (const [id, key, v] of sets) g[id].inputs[key] = await typed(g[id].class_type, id, key, v);
      return g;
    }
  }
}

if (cmd === "film") {
  // the whole film through the same SDK: film.js runs the chain, this is its view of the client
  const {planFilm, makeFilm} = await import("../app/js/film.js");
  let plan = null;
  if (opt.plan !== undefined) {                   // a plan edited by hand, or saved from --plan-only or the studio
    if (opt.idea !== undefined || opt.shots !== undefined) usage("--plan makes the film the plan file describes: --idea and --shots are for planning a new one");
    let text;
    try { text = fs.readFileSync(opt.plan, "utf8"); } catch (e) { usage(`can't read the plan file ${path.resolve(opt.plan)}: ${e.code === "ENOENT" ? "no such file" : e.message}`); }
    try { plan = JSON.parse(text); } catch (e) { usage(`the plan file ${path.resolve(opt.plan)} isn't JSON: ${e.message}`); }
    if (!Array.isArray(plan?.shots) || !plan.shots.length) usage(`the plan file ${path.resolve(opt.plan)} has no shots`);
  }
  // the genre: --genre, else the plan's own (the studio and --plan-only save it), else gothic
  const gid = opt.genre !== undefined ? choice("genre", PANEL.genre[0]) : plan?.genre || "gothic";
  const genre = P.GENRES.find(g => g.id === gid);
  if (!genre) usage(`the plan's genre ${gid}: no such id. Pick one with --genre: ${PANEL.genre[0].join(" ")}`);
  const shots = plan ? plan.shots.length : num("shots", 6, {min: 1, whole: true});
  if (!plan) need("idea");
  const saves = (graph) => Object.fromEntries(Object.entries(graph).filter(([, n]) => /^Save/.test(n.class_type))   // each Save node's subfolder
    .map(([id, n]) => { const p = String(n.inputs?.filename_prefix || ""); return [id, p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : ""]; }));
  const view = (f) => `${BASE}/view?filename=${encodeURIComponent(f.filename)}&subfolder=${encodeURIComponent(f.subfolder || "")}&type=${f.type || "output"}`;
  const io = {
    run: async (graph, label) => {
      const t = Date.now(), job = await sdk.submit(sdk.workflows.fromJson(await G.respell(graph, inputsOf))).catch(e => { throw new Error(`${label}: ComfyUI refused the graph: ${explain(e)}`); });
      console.error(`${label}: job ${job.id}`);
      await job.wait();
      if (job.status !== "succeeded") { const e = job.error; throw new Error(`${label} failed: ${e ? `${e.class_type || ""} ${e.message || e.code}` : job.status}`); }
      console.error(`${label}: done in ${((Date.now() - t) / 1000).toFixed(0)}s`);
      const subs = saves(graph);
      return {outputs: job.outputs.filter(o => !o.nodeId || o.nodeId in subs)
        .map(o => ({filename: o.name, subfolder: subs[o.nodeId] ?? "valis", type: "output", nodeId: o.nodeId, _o: o}))};
    },
    text: async (f) => f._o ? Buffer.from(await f._o.toBytes()).toString("utf8") : await fetch(view(f)).then(r => r.text()),
    ref: (f) => `${f.subfolder ? f.subfolder + "/" : ""}${f.filename} [${f.type === "input" ? "input" : "output"}]`,   // a reference dropped into ComfyUI's input folder is not an output
    exists: async (f) => (await fetch(view(f), {method: "HEAD"})).ok,
    free: () => fetch(`${BASE}/free`, {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({unload_models: true, free_memory: true})}),
    has: async (node) => !!(await nodeInfo(node)),
  };
  if (plan) plan.genre = genre.id;
  else plan = await guarded("the plan failed", () => planFilm({idea: opt.idea, shots, genre}, io));
  if (opt["plan-only"]) { console.log(JSON.stringify(plan, null, 2)); process.exit(0); }
  console.error(`plan: ${plan.title}, ${plan.shots.length} shot${plan.shots.length > 1 ? "s" : ""}, ${genre.name}`);
  const r = await guarded("the film failed", () => makeFilm(plan, io, {genre, onStage: (stage, msg) => console.error(`${stage}: ${msg}`)}));
  const out = opt.out || "valis_out";
  fs.mkdirSync(out, {recursive: true});
  const dest = path.join(out, r.film.filename);
  fs.writeFileSync(dest, r.film._o ? await r.film._o.toBytes() : Buffer.from(await fetch(view(r.film)).then(x => x.arrayBuffer())));
  console.log(JSON.stringify({plan, film: dest, song: r.song.filename, bpm: r.bar.bpm, bars_per_shot: r.cut.bars, shots: r.fxed.map(v => v.filename)}, null, 2));
  process.exit(0);
}

const graph = await build();
if (opt.json) { console.log(JSON.stringify(graph, null, 2)); process.exit(0); }

const t0 = Date.now();
const job = await guarded("ComfyUI refused the graph", async () => sdk.submit(sdk.workflows.fromJson(await G.respell(graph, inputsOf))));
console.error(`job ${job.id} queued on ${BASE}`);
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
