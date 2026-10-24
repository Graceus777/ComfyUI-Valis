// Every graph the studio can send, built and checked without a GPU:
//   - every feature of the setup check (check.js) and every new one (score making, stereo, stage, loops),
//   - Create across every camera move, aspect, size and option, with the planner the Create button uses (create.js),
//   - prompts: no "undefined", no doubled words or stops, your choices before the genre's, a black-and-white look first,
//   - sizes on H3's 32 px grid, lengths on its 17k+5 frame grid,
//   - each graph validated against a ComfyUI node list (tests/fixtures/object_info.json by default, or VALIS_OBJECT_INFO):
//     every node exists, every input is real, every link points at an output of the right type. Model files and
//     uploads are only checked with VALIS_CHECK_FILES=1 (they depend on the machine).
//
//   node tests/graphs.test.mjs                 (exit code 1 on any failure)
//   VALIS_OBJECT_INFO=path/to/object_info.json node tests/graphs.test.mjs
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import * as G from "../app/js/graphs.js";
import * as P from "../app/js/presets.js";
import * as CR from "../app/js/create.js";
import {PALETTES} from "../app/js/palettes.js";
import {features, checkGraph} from "../app/js/check.js";
import {workOf} from "../app/js/work.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const infoPath = process.env.VALIS_OBJECT_INFO || path.join(here, "fixtures", "object_info.json");
const info = fs.existsSync(infoPath) ? JSON.parse(fs.readFileSync(infoPath, "utf8")) : null;
const checkFiles = process.env.VALIS_CHECK_FILES === "1";
let pass = 0, fail = 0;
const failures = [];
function ok(cond, name, detail = "") { if (cond) pass++; else { fail++; failures.push(`${name}${detail ? ": " + detail : ""}`); } }
function valid(name, g) {
  ok(g && typeof g === "object" && Object.keys(g).length, `${name} builds`);
  for (const [id, n] of Object.entries(g)) {
    ok(n && n.class_type && n.inputs, `${name} node ${id} has a class and inputs`);
    for (const [k, v] of Object.entries(n.inputs || {})) {
      ok(v !== undefined && !(typeof v === "number" && Number.isNaN(v)), `${name} ${n.class_type}.${k} is set`, String(v));
      if (Array.isArray(v) && v.length === 2 && typeof v[0] === "string" && typeof v[1] === "number") ok(v[0] in g, `${name} ${n.class_type}.${k} links to a node that exists`, v[0]);
    }
  }
  if (info) for (const issue of checkGraph(g, info)) {
    if (!checkFiles && issue.kind === "model") continue;
    ok(false, `${name}: ${issue.node}`, issue.msg);
  }
}

// ---- every feature the setup check knows, and the newer ones
for (const [name, g] of Object.entries(features())) valid(name, g);
valid("Score · make from a song", G.scoreMake({audio: "song.flac", title: "x"}));
valid("Score · make from a cue sheet", G.scoreMake({cueSheet: G.CUE_SHEET_EXAMPLE}));
valid("Score · YuE2 writes it", G.songScore({style: "x", lyrics: "[Instrumental]"}));
valid("Score · render with the library", G.fx({clip: "x.mp4", source: "score", score: "s.json", audio: "a.flac", layers: [{effect: "Punch", on: "kick"}], start: 4.4}));
{
  const g = G.fx({clip: "x.mp4", source: "score", score: "s.json", audio: "a.flac", layers: [{effect: "Punch", on: "kick"}], start: 4.4, seconds: 6.5, fit: true});
  valid("Score · a shot fitted to its bars", g);
  ok(g["18"].inputs.length === 156, "fit: the render gets exactly the shot's frames", g["18"].inputs.length);
  ok(g["18a"].inputs.batch_index === -1, "fit: a short clip holds its last frame");
  ok(JSON.stringify(g["80"].inputs.images) === '["18",0]', "fit: ValisRender reads the fitted frames");
  ok(JSON.stringify(G.fx({clip: "x.mp4", layers: []})["80"].inputs.images) === '["17",0]', "no fit: the FX tab renders the whole clip");
}
valid("Extras · stereogram", G.stereo({video: "x.mp4"}));
valid("Extras · stereogram, no shape", G.stereo({video: "x.mp4", shape: "none", look: "ascii", color: "palette"}));
valid("Extras · loop, draft", G.loopShot({image: "a.png", prompt: "x"}));
valid("Extras · loop, final graded", G.loopShot({image: "a.png", prompt: "x", engine: "full", look: "noir"}));
valid("Extras · stage", G.stage({image: "a.png", names: ["the sky", "the man"]}));
valid("Extras · stage from words, erase first", G.stage({prompt: "x", names: ["the sky", "the man"], erase: true, caps: {retry: true}}));
valid("Extras · stage, paint past the frame (Krea)", G.stagePaint({stage: "valis/stage/x", engine: "krea"}));
valid("Extras · stage, paint past the frame (Qwen)", G.stagePaint({stage: "valis/stage/x", engine: "qwen", plate: false}));

// ---- Create: every move, every aspect, sizes and options, through the planner the button uses
const env = {hasNode: async () => true, hasLora: async () => true};
const envBare = {hasNode: async () => false, hasLora: async () => false};
const base = {genre: "gothic", framing: "wide", focal: "auto", light: "auto", setup: "auto", body: "auto", kit: "auto", era: "auto", emotion: "neutral",
  tempo: "single", look: {id: "auto"}, subject: "a woman in a red coat on a pier", action: "she turns to the sea", who: "the woman", gradeShot: true,
  opts: {trained: true, anchor: false, trim: true}, image: "k.png [output]"};
let n = 0;
for (const move of P.CAMERA_MOVES) for (const aspect of Object.keys(CR.KEY_SIZES)) for (const [short, seconds] of [[384, 3], [768, 107 / 24], [640, 10]]) {
  for (const [label, e, opts] of [["trained", env, {trained: true, anchor: false, trim: true}], ["words, anchored", env, {trained: false, anchor: true, trim: true}], ["nothing installed", envBare, {trained: true, anchor: true, trim: true}]]) {
    const C = {...base, move: move.id, aspect, short, seconds, opts, look: {id: PALETTES[n % PALETTES.length].id}};
    n++;
    const p = await CR.planShot(C, e);
    const name = `Create · ${move.name} · ${aspect} · ${short}px · ${seconds.toFixed(1)}s · ${label}`;
    ok(p.width % 32 === 0 && p.height % 32 === 0, `${name}: size on the 32 px grid`, `${p.width}x${p.height}`);
    const i2v = Object.values(p.graph).find(x => x.class_type === "MiniMaxH3ImageToVideo");
    if (i2v) ok((i2v.inputs.length - 5) % 17 === 0, `${name}: length on the 17k+5 grid`, String(i2v.inputs.length));
    if (n % 7 === 0) valid(name, p.graph);           // the full node check on a sample (they share their builders)
    ok(workOf(p.graph).kind !== "other", `${name}: the estimator knows what it is`);
  }
}
// loops through the planner
valid("Create · loop", (await CR.planShot({...base, move: "static", seconds: 6.4, opts: {loop: true, loopEngine: "full"}}, env)).graph);
// the sound H3 is told: the scene as sound (a pinned last frame with "quiet room tone" came out silent), or yours
{
  const lc = await CR.planShot({...base, move: "push_in", opts: {trained: false, lightChange: true}, relit: "r.png [output]"}, env);
  const i2v = Object.values(lc.graph).find(x => x.class_type === "MiniMaxH3ImageToVideo");
  ok(i2v && /overall_soundscape:\nThe sound of the scene as it happens, a woman in a red coat on a pier; she turns to the sea\./.test(i2v.inputs.prompt) && i2v.inputs.last_frame,
     "Create · a light change hears its scene", i2v?.inputs.prompt.slice(-260));
  const own = await CR.planShot({...base, move: "static", sound: "rain on a tin roof", opts: {trained: false}}, env);
  ok(/overall_soundscape:\nrain on a tin roof\n/.test(Object.values(own.graph).find(x => x.class_type === "MiniMaxH3ImageToVideo").inputs.prompt), "Create · your own sound");
}

// ---- prompts
const words = (s) => s.toLowerCase().match(/[a-z0-9-]+/g) || [];
for (const g of P.GENRES) for (const body of P.BODIES) for (const era of P.ERAS) {
  const C = {...base, genre: g.id, body: body.id, era: era.id, kit: "fisheye", look: {id: "teal_orange"}, move: "push_in"};
  const k = CR.keyframePrompt(C), m = CR.motionPrompt(C);
  const name = `prompt · ${g.name} · ${body.name} · ${era.name}`;
  ok(!/undefined|null|\[object/.test(k + m), `${name}: no undefined`, k);
  ok(!/\.\s*\./.test(k) && !/ {2}/.test(k) && !/,\s*[,.]/.test(k), `${name}: no doubled stops or spaces`, k);
  if (body.id !== "auto") { const at = k.toLowerCase().indexOf(body.words.slice(0, 20).toLowerCase()); ok(at >= 0 && at < 5, `${name}: the camera body leads the prompt`, k.slice(0, 80)); }
  if (body.id !== "auto") ok(!k.includes(P.GENRE_SLOTS[g.id]?.medium || "\u0000"), `${name}: the genre's medium gives way to the body`, k.slice(0, 120));
  ok(k.toLowerCase().includes("fisheye"), `${name}: the lens kit is in it`);
  ok(new Set(words(k)).size > 8, `${name}: says something`);
}
for (const look of PALETTES) {
  const C = {...base, look: {id: look.id}, light: "candle"};
  const k = CR.keyframePrompt(C);
  if (CR.isMono(C)) ok(k.startsWith(look.words.slice(0, 15)) || k.toLowerCase().startsWith(look.words.slice(0, 15).toLowerCase()), `prompt · ${look.name} (black and white) leads`, k.slice(0, 80));
  else if (look.words) ok(k.includes(look.words.slice(0, 20)), `prompt · ${look.name} is in it`, k.slice(-160));
  const gr = CR.gradeOf(C);
  ok(look.id === "natural" ? gr === null : gr === look.id, `grade · ${look.name}`, JSON.stringify(gr));
}
// your own colours
const own = {...base, look: {id: "teal_orange", hex: ["#10202c", "#2e6f73", "#e0a15a", "#f6e6c8"]}};
ok(/colour palette of/.test(CR.keyframePrompt(own)), "prompt · your own colours are named in it", CR.keyframePrompt(own).slice(-120));
ok(JSON.stringify(CR.gradeOf(own)) === JSON.stringify({look: "teal_orange", hex: "#10202c, #2e6f73, #e0a15a, #f6e6c8"}), "grade · your colours over a look");
ok(CR.gradeOf({...own, look: {id: "custom", hex: ["#000000", "#ffffff"]}}).look === "custom", "grade · your colours alone");

// ---- the film plan parser
import {parsePlan, barSeconds, shotSeconds, shotLen, cutOf, songSeconds, songShort, SHOT_SECONDS} from "../app/js/film.js";
const plan = parsePlan('noise {"title":"T","cast":[{"name":"the keeper","look":"an old man"}],"place":"a rock","song":{"style":"strings"},"shots":[{"who":["the keeper"],"keyframe":"k","motion":"m","subject":"the keeper","effect":"Rays","on":"beat"},{"keyframe":"k2","effect":"Nope","on":"x"}]} tail', 6);
ok(plan.shots.length === 2 && plan.shots[1].effect === "none" && plan.shots[1].on === "beat", "film · the plan parser fills bad effects and lanes");
ok(/BPM/.test(plan.song.style), "film · the song brief gets a tempo");
const bar = barSeconds("X:1\nM:3/4\nQ:1/4=161\n"); ok(Math.abs(bar.seconds - 3 * 60 / 161) < 1e-6, "film · a 3/4 bar at 161 BPM", String(bar.seconds));
ok(shotSeconds(bar.seconds).bars === 3, "film · whole bars in a clip", JSON.stringify(shotSeconds(bar.seconds)));
{ // shot length: the plan's own, cut to whole bars; a song long enough for it, or a new one
  const pl = {shots: [{}, {}, {}, {}], music: {audio: {filename: "s.flac"}, bar: {seconds: 2}, seconds: songSeconds({shots: [{}, {}, {}, {}]})}};
  ok(shotLen(pl) === SHOT_SECONDS && cutOf(pl).bars === 2 && cutOf(pl).seconds === 4, "film · a shot is one clip, two 2 s bars of it play", JSON.stringify(cutOf(pl)));
  pl.shotSeconds = 9;
  ok(cutOf(pl).bars === 4 && cutOf(pl).seconds === 8, "film · a 9 s shot plays four bars", JSON.stringify(cutOf(pl)));
  ok(songShort(pl) && songSeconds(pl) === 40, "film · longer shots need a longer song", String(songSeconds(pl)));
  pl.music.own = true; ok(!songShort(pl), "film · your own song is never remade");
  ok(shotSeconds(5, 3).bars === 1 && shotSeconds(5, 3).seconds === 3, "film · a shot shorter than a bar plays whole");
}

console.log(`${pass} passed, ${fail} failed${info ? "" : " (no node list: tests/fixtures/object_info.json missing, so graphs weren't checked against ComfyUI)"}`);
if (fail) { console.log(failures.slice(0, 60).join("\n")); if (failures.length > 60) console.log(`… and ${failures.length - 60} more`); process.exit(1); }
