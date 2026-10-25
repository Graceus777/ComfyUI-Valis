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
// Remove: the clean frame (in the source's own framing) is the guide at frame 0; the green video is a reference
{
  const g = G.edit({mode: "remove", video: "x.mp4", target: "the man", anchorPrompt: "x"});
  ok(JSON.stringify(g["7"].inputs.image) === '["cc",0]' && g["7"].inputs.frame_idx === 0, "Remove: the clean frame is the guide at frame 0");
  ok(JSON.stringify(g["6"].inputs["ref_videos.ref_video_0"]) === '["gg",0]' && !("vae" in g["6"].inputs), "Remove: the green video reaches the text encoder only");
  ok(g.gr.inputs.color === 65280, "Remove: the person is painted #00ff00");
  ok(JSON.stringify(g["6"].inputs["ref_images.ref_image_0"]) === '["cc",0]' && g.cc.inputs.destination[0] === "f0", "Remove: the clean frame keeps the source's framing");
  ok(g.lo.inputs.lora_name === G.REMOVER_LORA && g.lo.inputs.strength_model === 1, "Remove: the Person Remover LoRA at 1.0");
}
// a reference picture or video without the VAE only reaches H3's text encoder: every ref2va that has references gets the VAEs
// (except Remove, wired as the Person Remover LoRA's own workflow: its green video goes in as a guide clip instead)
for (const [name, g] of Object.entries(features())) for (const [id, n] of Object.entries(g)) {
  if (n.class_type !== "MiniMaxH3ReferenceToVideo" || n.inputs.prompt === G.REMOVER_PROMPT) continue;
  const refs = Object.keys(n.inputs).filter(k => /^ref_(images|videos)\./.test(k));
  if (refs.length) ok(Array.isArray(n.inputs.vae), `${name} node ${id}: references go in with the VAE`);
}
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
  ok(JSON.stringify(G.fx({clip: "x.mp4", layers: [{effect: "Echo", on: "beat"}]})["80"].inputs.images) === '["17",0]', "no fit: the FX tab renders the whole clip");
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
import {parsePlan, barSeconds, shotSeconds, shotLen, cutOf, songSeconds, songShort, SHOT_SECONDS, stillPrompt} from "../app/js/film.js";
{
  const goth = P.GENRES.find(g => g.id === "gothic"), pl = {place: "A parlour.", cast: [{name: "the medium", look: "grey hair"}, {name: "Eleanor", look: "soaked dress"}]};
  const sh = {who: ["Eleanor"], keyframe: "Close-up: Eleanor."};
  ok(stillPrompt(pl, sh, goth).startsWith(goth.style) && stillPrompt(pl, sh, goth).includes("soaked dress") && !stillPrompt(pl, sh, goth).includes("grey hair"), "film · a still: the genre's look, the shot, only the cast in it, the place");
  ok(stillPrompt({...pl, look: "Red lamp only."}, sh, goth).startsWith("Red lamp only.") && !stillPrompt({...pl, look: "Red lamp only."}, sh, goth).includes(goth.style), "film · the plan's own look replaces the genre's words");
  ok(!stillPrompt(pl, {who: [], keyframe: "An empty chair."}, goth).includes("soaked dress"), "film · a shot with no one in it gets no cast looks");
}

// ---- a film built from references: sheets, setups, frames, close-ups (Krea 2 identity edit: a scene and a subject)
import * as F from "../app/js/film.js";
{
  const crop = {x: .1, y: .3, w: .5, h: .5};
  const g3 = G.filmFrame({refs: [{image: "plate.png"}, {image: "a.png"}, {image: "b.png"}, {image: "c.png"}], prompt: "x", seeds: [1, 2]});
  valid("Film · a frame: the empty plate, everyone in it side by side", g3);
  ok(JSON.stringify(g3.mp.inputs.source_image) === '["r0",0]' && JSON.stringify(g3.mp.inputs.source_image_b) === '["sts",0]' && g3.st2 && JSON.stringify(g3.pos.inputs.image_b) === '["sts",0]',
    "Film · the plate is the scene, the sheets one picture as the subject (patch and encoder both)");
  ok(g3["203"].inputs.lora_name === G.MODELS.kreaLora && g3.k0.inputs.steps === 8 && g3.k0.inputs.cfg === 1 && g3.k1.inputs.seed === 2, "Film · Krea 2 identity edit, turbo 8 steps, a picture per seed");
  const g1 = G.filmFrame({refs: [{image: "sheet.png"}], prompt: "x", size: {w: 832, h: 1216}});
  valid("Film · a sheet's state (one picture)", g1);
  ok(!("source_image_b" in g1.mp.inputs) && !("image_b" in g1.pos.inputs) && g1.lat.inputs.width === 832, "Film · one picture: no subject, the sheet's size");
  const gc = G.filmFrame({refs: [{image: "frame.png"}, {image: "a.png"}], prompt: "x", crop, seeds: [3]});
  valid("Film · a close-up cut from a frame", gc);
  ok(gc.cr.inputs.width === 384 && gc.cr.inputs.height === 672 && gc.cr.inputs.x === 77 && gc.cr.inputs.y === 403 && JSON.stringify(gc.mp.inputs.source_image) === '["cs",0]' && JSON.stringify(gc.mp.inputs.source_image_b) === '["r1",0]',
    "Film · the close-up box is cut in the frame's pixels, scaled to the film's size, and is the scene", JSON.stringify(gc.cr.inputs));
  // prompts
  const plan = {look: "Still from a 1920s horror film.", place: "A dark parlour."};
  const frames = [{name: "F1", setup: "master", with: ["the medium", "Eleanor"], seat: "The medium sits on the far chair."}, {name: "F2", from: "F1", with: ["the widower"], edit: "Her eyes roll up."}, {name: "F3", from: "F2", edit: "The chair is wet."}];
  const fp = F.framePrompt(plan, frames, frames[2]);
  ok(fp.startsWith("Picture 1 is the empty set. Picture 2 is the medium. Picture 3 is Eleanor. Picture 4 is the widower.") && fp.includes("The medium sits on the far chair. At this moment: Her eyes roll up. The chair is wet.") && fp.endsWith("Still from a 1920s horror film."),
    "Film · a later moment: every sheet by its picture, the blocking, every change in order, the look", fp);
  const ch = F.frameChain(frames, frames[2]);
  ok(ch.setup === "master" && ch.who.join() === "the medium,Eleanor,the widower" && ch.root === frames[0], "Film · a moment's chain leads back to its seated frame and setup");
  ok(F.frameChain([...frames, {name: "F4", from: "F3", gone: ["the medium"]}], {name: "F4", from: "F3", gone: ["the medium"]}).who.join() === "Eleanor,the widower", "Film · someone who has gone is not in the moment");
  let threw = false; try { F.frameChain([{name: "a", from: "b"}, {name: "b", from: "a"}], {name: "a", from: "b"}); } catch { threw = true; }
  ok(threw, "Film · a frame made from itself is an error");
  ok(F.refPrompt({from: "Eleanor", edit: "Soaked."}).startsWith("Soaked. Keep the face"), "Film · a state is an edit of the sheet it comes from");
  ok(F.refPrompt({with: ["the widower", "Eleanor"], look: "Their wedding photograph."}) === "The first image is the widower. The second image shows Eleanor. Their wedding photograph.", "Film · a prop of two sheets: scene and subject");
  ok(F.turnPrompt(plan, {turn: "from the other side"}).startsWith("Show this same empty room from the other side.") && F.turnPrompt(plan, {turn: "x"}).includes("No people"), "Film · a new setup turns the empty plate");
  ok(F.platePrompt(plan, {view: "High wide shot."}) === "Still from a 1920s horror film. High wide shot. A dark parlour. No people.", "Film · the first plate: the look, the view, the place, no people");
  const gk = G.filmCrop({frame: "frame.png", crop: {x: .1, y: .3, w: .5, h: .5}});
  valid("Film · a close-up: the box enlarged by SeedVR2", gk);
  ok(gk.cr.inputs.width === 384 && gk.cr.inputs.height === 672 && gk.up.inputs.resolution === 768 && gk.fit.inputs.width === 768 && gk.fit.inputs.height === 1344,
    "Film · the box is cut in the frame's pixels and enlarged back to the film's size");
  const cast = [{name: "photo", with: ["a", "b"]}, {name: "b2", from: "b"}, {name: "a"}, {name: "b"}];
  const order = F.inOrder(cast, F.needs.ref).map(c => c.name);
  ok(order.indexOf("a") < order.indexOf("photo") && order.indexOf("b") < order.indexOf("photo") && order.indexOf("b") < order.indexOf("b2"), "Film · sheets are made before what's made from them", order.join(","));
  threw = false; try { F.inOrder([{name: "x", from: "y"}, {name: "y", from: "x"}], F.needs.ref); } catch { threw = true; }
  ok(threw, "Film · a reference made from itself is an error");
}
{ // a film shot keeps its keyframe's colours through the effects pass
  const g = G.fx({clip: "c.mp4", layers: [{effect: "Frost", on: "kick"}], hold: "key.png"});
  valid("Film · effects with the keyframe's colours held", g);
  ok(JSON.stringify(g.hc.inputs.image_target) === '["17",0]' && g.hc.inputs.method === "mkl_lab" && JSON.stringify(g["80"].inputs.images) === '["hc",0]', "Film · every frame is matched to the keyframe before the effects");
  ok(!G.fx({clip: "c.mp4", layers: []}).hc, "FX · nothing is held unless asked");
  const q = G.fx({clip: "c.mp4", layers: [], source: "song", audio: "s.flac", hold: "key.png", sound: true});
  valid("Film · a quiet shot (no effect), its colours held, with the song", q);
  ok(!q["80"] && JSON.stringify(q["81"].inputs.images) === '["hc",0]' && !("stack" in q["85"].inputs), "Film · a shot with no effect goes out as it is (an empty stack was no link and ComfyUI refused it)");
}
{ // a film shot's motion: its look said in full with the light held; a camera direction in the action wins over the move
  const push = P.MOVES.find(m => m.id === "push"), goth = P.GENRES.find(g => g.id === "gothic");
  const m1 = P.motionPrompt({genre: goth, move: push, action: "She closes her eyes. The camera holds still.", look: "Red lamp light from below."});
  ok(m1.startsWith("Red lamp light from below. The scene begins") && m1.includes("stay exactly as in the first frame") && !m1.includes(push.words) && !m1.includes(".."), "Film · a shot's motion keeps its look and its light, and its own camera", m1);
  const m2 = P.motionPrompt({genre: goth, move: push, action: "She closes her eyes"});
  ok(m2.includes(push.words) && !m2.includes("stay exactly"), "Create · the move is said when the action says nothing of the camera", m2);
}
// the steps, with a pretend io: what each makes, from what, in what order
{
  const runs = [];
  const io = {run: async (g, label) => { runs.push({g, label}); const save = Object.values(g).find(n => n.class_type === "SaveImage"); return {outputs: [{filename: `${save.inputs.filename_prefix.split("/").pop()}_00001_.png`, subfolder: "valis", type: "output"}]}; },
              ref: (f) => `${f.subfolder}/${f.filename} [output]`, text: async () => ""};
  const plan = {tag: "t", look: "L.", place: "P.", cast: [{name: "Eleanor, drowned", from: "Eleanor", edit: "Soaked."}, {name: "Eleanor", look: "a bride"}, {name: "the widower", look: "gaunt"}],
    setups: [{name: "reverse", from: "master", turn: "from the other side"}, {name: "master", view: "High wide."}],
    frames: [{name: "F2", from: "F1", with: ["Eleanor, drowned"], edit: "She sits."}, {name: "F1", setup: "reverse", with: ["the widower"], seat: "He sits right."}],
    shots: [{frame: "F1"}, {frame: "F2", crop: {x: 0, y: 0, w: .5, h: .5}, with: ["Eleanor, drowned"]}, {keyframe: "words"}]};
  await F.makeRefs(plan, io);
  ok(runs.map(r => r.label).join("|") === "Film · Eleanor|Film · Eleanor, drowned|Film · the widower", "Film · references: Eleanor's sheet before the drowned one made from it", runs.map(r => r.label).join("|"));
  ok(/ref_eleanor_\d/.test(runs[1].g.r0.inputs.image) && runs[1].g.pos.inputs.prompt.startsWith("Soaked.") && runs[1].g.lat.inputs.width === 832, "Film · the drowned sheet is an edit of Eleanor's, at a sheet's size", runs[1].g.r0.inputs.image);
  ok(runs[0].g["10"].inputs.text.includes("Costume test photograph") && runs[0].g["4"].inputs.width === 832, "Film · a character's sheet is a costume-test portrait");
  runs.length = 0; await F.makeSetups(plan, io);
  ok(runs.map(r => r.label).join("|") === "Film · set master|Film · set reverse" && runs[1].g.r0.inputs.image.includes("set_master"), "Film · the reverse turns the master's empty plate, made first");
  runs.length = 0; await F.makeFrames(plan, io);
  const fr = Object.fromEntries(runs.map(r => [r.label, r.g]));
  const f1 = fr["Film · frame F1"], f2 = fr["Film · frame F2"];
  valid("Film · a frame seated into its plate (Qwen Image 2.1, one pass)", f1);
  ok(f1.plate.inputs.image.includes("set_reverse") && f1.p0.inputs.image.includes("ref_the_widower") && JSON.stringify(f1.enc.inputs["images.image_2"]) === '["p0s",0]',
    "Film · a seated frame: the setup's plate is Picture 1, each sheet the next");
  ok(f2.plate.inputs.image.includes("frame_f1") && f2.p0.inputs.image.includes("ref_eleanor_drowned") && !f2.p1,
    "Film · a later moment is one edit of its seated frame, with the sheet of whoever arrives");
  ok(f2.enc.inputs.prompt.startsWith("Picture 1 is a still from this film. Picture 2 is Eleanor, drowned. At this moment: She sits.") && f2.ks.inputs.seed !== f1.ks.inputs.seed, "Film · a moment's words: who arrives, what changed; a seed of its own (its seated frame's noise speckled it)", f2.enc.inputs.prompt);
  ok(runs.map(r => r.label).join("|") === "Film · frame F1|Film · frame F2", "Film · seated frames before the moments made from them");
  runs.length = 0; await F.frameShots({...plan, shots: plan.shots.slice(0, 2)}, io);
  ok(plan.shots[0].key?.filename.includes("frame_f1") && runs.length === 1 && runs[0].g.cr && runs[0].g.up && runs[0].g.l.inputs.image.includes("frame_f2"), "Film · a whole-frame shot takes its frame as is; a close-up is cut from its frame and enlarged", JSON.stringify(plan.shots[0].key));
  ok(plan.shots[0].keyFrom === plan.frames.find(f => f.name === "F1").still.filename && !F.keyStale(plan, plan.shots[0]), "Film · a shot remembers the frame still it was cut from");
  plan.frames.find(f => f.name === "F1").still = {filename: "rerolled.png"};
  ok(F.keyStale(plan, plan.shots[0]), "Film · a re-rolled frame makes the shots cut from it stale");
  runs.length = 0; await F.frameShots({...plan, shots: plan.shots.slice(0, 2)}, io);
  ok(plan.shots[0].key.filename === "rerolled.png" && runs.length === 0, "Film · Keyframes again takes the new frame (a whole-frame shot needs no GPU)");
  let err = ""; try { await F.makeFrames({...plan, frames: [{name: "X", from: "nope"}]}, io); } catch (e) { err = e.message; }
  ok(/isn't a frame/.test(err), "Film · a change of a frame that doesn't exist says so", err);
  ok(F.momentPrompt([{name: "A", setup: "s", with: ["x", "y"], seat: "."}, {name: "B", from: "A", gone: ["y"], edit: "Rain."}], {name: "B", from: "A", gone: ["y"], edit: "Rain."}).includes("Remove y from the picture completely"), "Film · someone gone is taken out, by name");
  ok(F.momentPrompt([{name: "A", setup: "s", with: ["x", "y"], seat: "Z sits with her back to us."}, {name: "B", from: "A", edit: "Rain."}], {name: "B", from: "A", edit: "Rain."}).includes("Everyone else stays exactly where and as they are: x and y, and whoever sits with their back to us."), "Film · everyone who stays is named");
}

const plan = parsePlan('noise {"title":"T","cast":[{"name":"the keeper","look":"an old man"}],"place":"a rock","song":{"style":"strings"},"shots":[{"who":["the keeper"],"keyframe":"k","motion":"m","subject":"the keeper","effect":"Rays","on":"beat"},{"keyframe":"k2","effect":"Nope","on":"x"}]} tail', 6);
ok(plan.shots.length === 2 && plan.shots[1].effect === "none" && plan.shots[1].on === "beat", "film · the plan parser fills bad effects and lanes");
ok(/BPM/.test(plan.song.style), "film · the song brief gets a tempo");
const bar = barSeconds("X:1\nM:3/4\nQ:1/4=161\n"); ok(Math.abs(bar.seconds - 3 * 60 / 161) < 1e-6, "film · a 3/4 bar at 161 BPM", String(bar.seconds));
ok(shotSeconds(bar.seconds).bars === 4, "film · whole bars in a clip (4 bars of 3/4 at 161: the clip's last frame held 0.01 s)", JSON.stringify(shotSeconds(bar.seconds)));
{ // shot length: the plan's own, cut to whole bars; a song long enough for it, or a new one
  const pl = {shots: [{}, {}, {}, {}], music: {audio: {filename: "s.flac"}, bar: {seconds: 2}, seconds: songSeconds({shots: [{}, {}, {}, {}]})}};
  ok(shotLen(pl) === SHOT_SECONDS && cutOf(pl).bars === 2 && cutOf(pl).seconds === 4, "film · a shot is one clip, two 2 s bars of it play", JSON.stringify(cutOf(pl)));
  pl.shotSeconds = 9;
  ok(cutOf(pl).bars === 4 && cutOf(pl).seconds === 8, "film · a 9 s shot plays four bars", JSON.stringify(cutOf(pl)));
  ok(songShort(pl) && songSeconds(pl) === 40, "film · longer shots need a longer song", String(songSeconds(pl)));
  pl.music.own = true; ok(!songShort(pl), "film · your own song is never remade");
  ok(shotSeconds(5, 3).bars === 1 && shotSeconds(5, 3).seconds === 3, "film · a shot shorter than a bar plays whole");
  { const c = shotSeconds(60 / 107 * 4); ok(c.bars === 2 && Math.abs(c.seconds - 4.486) < .01, "film · two bars at 107 BPM fit one H3 clip (its last frame held)", JSON.stringify(c)); }
  { const c = shotSeconds(60 / 100 * 4); ok(c.bars === 1 && Math.abs(c.seconds - 2.4) < .01, "film · two bars at 100 BPM don't: one bar", JSON.stringify(c)); }
}

console.log(`${pass} passed, ${fail} failed${info ? "" : " (no node list: tests/fixtures/object_info.json missing, so graphs weren't checked against ComfyUI)"}`);
if (fail) { console.log(failures.slice(0, 60).join("\n")); if (failures.length > 60) console.log(`… and ${failures.length - 60} more`); process.exit(1); }
