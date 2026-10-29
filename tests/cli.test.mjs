// The command line (cli/valis.mjs), checked without a GPU and without queuing anything. Each command builds its graph
// with --json (film: --plan-only) against a stand-in ComfyUI that answers /object_info from the node list
// (tests/fixtures/object_info.json) and refuses everything else, so nothing is uploaded or queued:
//   - frame and shoot build what Create's buttons build (create.js keyframesGraph and planShot) from the same choices,
//     and the older ids (--move push, --grade teal) still work,
//   - an unknown id, option or plan file is an error (exit 2) that says what it takes, before anything is sent,
//   - film --plan keeps the plan's own genre unless --genre is given.
//
//   node tests/cli.test.mjs                 (exit code 1 on any failure)
import fs from "node:fs";
import os from "node:os";
import http from "node:http";
import path from "node:path";
import {spawn} from "node:child_process";
import {fileURLToPath} from "node:url";
import * as P from "../app/js/presets.js";
import * as CR from "../app/js/create.js";
import {PALETTES} from "../app/js/palettes.js";

const here = path.dirname(fileURLToPath(import.meta.url)), repo = path.join(here, "..");
const OI = JSON.parse(fs.readFileSync(path.join(here, "fixtures", "object_info.json"), "utf8"));
let pass = 0, fail = 0;
const failures = [];
function ok(cond, name, detail = "") { if (cond) pass++; else { fail++; failures.push(`${name}${detail ? ": " + String(detail).slice(0, 400) : ""}`); } }

// the stand-in: /object_info/<node> from the node list; anything else is noted (it would be an upload or a job)
const asked = [];
const server = http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (req.method === "GET" && p.startsWith("/object_info/")) { const n = p.slice(13); res.writeHead(200, {"Content-Type": "application/json"}); return res.end(JSON.stringify(OI[n] ? {[n]: OI[n]} : {})); }
  asked.push(`${req.method} ${p}`);
  res.writeHead(404); res.end();
});
await new Promise(r => server.listen(0, "127.0.0.1", r));
const API = `http://127.0.0.1:${server.address().port}`;
const closed = await new Promise(r => { const s = http.createServer().listen(0, "127.0.0.1", () => { const port = s.address().port; s.close(() => r(`http://127.0.0.1:${port}`)); }); });

const cli = (args, api = API) => new Promise((res) => {
  const env = {...process.env}; delete env.COMFY_BASE_URL;
  const p = spawn(process.execPath, [path.join(repo, "cli", "valis.mjs"), ...args, ...(api ? ["--api", api] : [])], {cwd: repo, env});
  let out = "", err = "";
  p.stdout.on("data", d => out += d); p.stderr.on("data", d => err += d);
  p.on("close", (code) => { let json = null; try { json = JSON.parse(out); } catch { /* not JSON */ } res({code, out, err, json}); });
});
// the stamp in a prefix differs from run to run
const same = (a, b) => JSON.stringify(a).replace(/valis\/(key|shot|loop)_[0-9a-z]+/g, "valis/$1_X") === JSON.stringify(b).replace(/valis\/(key|shot|loop)_[0-9a-z]+/g, "valis/$1_X");
const LORAS = OI.LoraLoaderModelOnly.input.required.lora_name[0];
const envHere = {hasNode: async (n) => !!OI[n], hasLora: async (n) => LORAS.includes(n)};
const envAll = {hasNode: async () => true, hasLora: async () => true};
const CREATE = {genre: "gothic", framing: "wide", focal: "auto", body: "auto", kit: "auto", light: "auto", setup: "auto", era: "auto", look: {id: "auto"}, aspect: "9:16", gradeShot: true};

// ---- help lists the ids every list option takes
{
  const h = await cli(["help"], null);
  const words = new Set(h.out.split(/\s+/));
  const lists = {genre: P.GENRES, framing: P.FRAMING, lens: P.LENS, body: P.BODIES, kit: P.LENS_KITS, light: P.LIGHT, setup: P.LIGHTING, era: P.ERAS,
    look: PALETTES, move: P.CAMERA_MOVES, emotion: P.EMOTIONS, tempo: P.TEMPO, "transform --look": P.LOOKS};
  for (const [k, list] of Object.entries(lists)) { const miss = list.filter(x => !words.has(x.id)).map(x => x.id); ok(h.code === 0 && !miss.length, `help · every ${k} id`, miss.join(" ")); }
}

// ---- frame: the keyframes Create's Frame it makes
{
  const pick = {genre: "noir", framing: "close", lens: "85", body: "16mm", kit: "anamorphic", light: "candle", setup: "window", era: "1950s", look: "teal_orange", aspect: "1:1"};
  const r = await cli(["frame", "--prompt", "a keeper on the rocks", ...Object.entries(pick).flatMap(([k, v]) => [`--${k}`, v]), "--seed", "42", "--json"]);
  const {lens, look, ...rest} = pick;
  const want = CR.keyframesGraph({...CREATE, ...rest, focal: lens, look: {id: look}, subject: "a keeper on the rocks"}, {seeds: [42, 143], prefix: "valis/key_x"});
  ok(r.code === 0 && same(r.json, want), "frame · every choice, as Create's keyframes", r.err || r.out.slice(0, 300));
  const d = await cli(["frame", "--prompt", "x", "--json"]);
  ok(d.code === 0 && same(d.json, CR.keyframesGraph({...CREATE, subject: "x"}, {seeds: [7101, 7202], prefix: "valis/key_x"})), "frame · the defaults are Create's", d.err);
  const t = await cli(["frame", "--prompt", "x", "--grade", "teal", "--json"]), l = await cli(["frame", "--prompt", "x", "--look", "teal_orange", "--json"]);
  ok(t.code === 0 && same(t.json, l.json) && /teal and orange/.test(t.json["10"].inputs.text), "frame · the older --grade teal is --look teal_orange", t.err);
  const n = await cli(["frame", "--prompt", "x", "--grade", "none", "--json"]);
  ok(n.code === 0 && same(n.json, d.json), "frame · --grade none is the genre's colour, as before", n.err);
  const c = await cli(["frame", "--prompt", "x", "--colours", "#10202c, #2e6f73 e0a15a", "--json"]);
  ok(c.code === 0 && same(c.json, CR.keyframesGraph({...CREATE, look: {id: "custom", hex: ["#10202c", "#2e6f73", "#e0a15a"]}, subject: "x"}, {seeds: [7101, 7202], prefix: "valis/key_x"})),
     "frame · your own colours", c.err);
}

// ---- shoot: the graph Create's Shoot it sends, with what this ComfyUI has (the node list) deciding the trained moves
{
  const cases = [
    [["--move", "static"], {move: "static"}],
    [[], {move: "static"}],                                                     // shoot's default stays a locked-off camera
    [["--move", "push"], {move: "push_in"}],                                    // an older id
    [["--move", "push_in", "--untrained"], {move: "push_in", opts: {trained: false}}],
    [["--move", "orbit_360"], {move: "orbit_360"}],
    [["--move", "crash_zoom_in", "--seconds", "5"], {move: "crash_zoom_in", seconds: 5}],
    [["--move", "whip_pan", "--who", "the keeper"], {move: "whip_pan", who: "the keeper"}],
    [["--move", "dolly_zoom_in", "--look", "noir", "--no-grade"], {move: "dolly_zoom_in", look: {id: "noir"}, gradeShot: false}],
    [["--move", "crane_overhead", "--untrained", "--anchor", "--no-trim"], {move: "crane_overhead", opts: {trained: false, anchor: true, trim: false}}],
    [["--move", "fpv_drone", "--aspect", "16:9", "--size", "384", "--seed", "9", "--emotion", "fear", "--tempo", "energetic", "--genre", "western", "--body", "vhs", "--look", "vhs"],
     {move: "fpv_drone", aspect: "16:9", short: 384, seed: 9, emotion: "fear", tempo: "energetic", genre: "western", body: "vhs", look: {id: "vhs"}}],
    [["--move", "push_in", "--untrained", "--relit", "valis/r.png", "--sound", "rain on a tin roof"], {move: "push_in", opts: {trained: false, lightChange: true}, relit: "valis/r.png", sound: "rain on a tin roof"}],
  ];
  const runs = await Promise.all(cases.map(([args]) => cli(["shoot", "--image", "valis/k.png", "--motion", "he raises the lantern", "--prompt", "a keeper on the rocks", ...args, "--json"])));
  for (const [k, [args, over]] of cases.entries()) {
    const C = {...CREATE, emotion: "neutral", tempo: "single", seconds: 107 / 24, short: 768, seed: 51101, who: "", sound: "", subject: "a keeper on the rocks", action: "he raises the lantern",
      image: "valis/k.png", relit: null, prefix: "valis/shot_x", ...over, opts: {trained: true, anchor: false, trim: true, lightChange: false, ...over.opts}};
    const plan = await CR.planShot(C, envHere), r = runs[k];
    ok(r.code === 0 && same(r.json, plan.graph) && r.err.includes(plan.label), `shoot ${args.join(" ") || "(defaults)"} · as Create's ${plan.label}`, r.err || r.out.slice(0, 300));
  }
  // no server to ask: built as if everything were installed, and said so
  const r = await cli(["shoot", "--image", "valis/k.png", "--motion", "x", "--move", "push_in", "--json"], closed);
  const plan = await CR.planShot({...CREATE, move: "push_in", emotion: "neutral", tempo: "single", seconds: 107 / 24, short: 768, seed: 51101, action: "x", image: "valis/k.png",
    prefix: "valis/shot_x", opts: {trained: true, anchor: false, trim: true, lightChange: false}}, envAll);
  ok(r.code === 0 && same(r.json, plan.graph) && /can't be read/.test(r.err), "shoot · with no server, --json prints the trained shot and says what it assumed", r.err);
}

// ---- an unknown id, option, value or file: exit 2 and what it takes, before anything is sent
{
  const bad = [
    [["frame", "--prompt", "x", "--genre", "gothik"], /--genre gothik: no such id\. Pick one of: gothic noir/],
    [["frame", "--prompt", "x", "--framing", "closeup"], /Pick one of: wide medium close/],
    [["frame", "--prompt", "x", "--look", "teal"], /--look teal: no such id.*teal_orange/],
    [["frame", "--prompt", "x", "--grade", "sepia"], /--grade sepia: no such id\. Pick one of: none teal/],
    [["frame", "--prompt", "x", "--grade", "teal", "--look", "noir"], /give one of them/],
    [["frame", "--prompt", "x", "--colours", "#12"], /two or more colours/],
    [["frame", "--prompt", "x", "--look", "custom"], /--colours/],
    [["frame", "--prompt", "x", "--genere", "noir"], /frame has no option --genere\. Its options: .*--genre/],
    [["frame", "--prompt"], /--prompt needs a value/],
    [["frame", "a lighthouse"], /unexpected "a lighthouse"/],
    [["shoot", "--image", "valis/k.png", "--motion", "x", "--move", "pushin"], /--move pushin: no such id\. Pick one of: static push_in/],
    [["shoot", "--image", "valis/k.png", "--motion", "x", "--emotion", "rage"], /Pick one of: neutral joy/],
    [["shoot", "--image", "valis/k.png", "--motion", "x", "--seconds", "4,5"], /--seconds takes a number from 2 to 15/],
    [["shoot", "--image", "valis/k.png", "--motion", "x", "--size", "2000"], /--size takes a number from 320 to 1024/],
    [["shoot", "--image", "valis/k.png"], /--motion is required for shoot/],
    [["transform", "--video", "valis/v.mp4", "--target", "x", "--look", "bronz"], /--look bronz: no such id\. Pick one of: werewolf .* bronze/],
    [["score", "--clip", "valis/c.mp4", "--score", "valis/s.json", "--bar", "five"], /--bar takes a whole number/],
    [["film", "--idea", "x", "--genre", "goth"], /--genre goth: no such id/],
    [["film", "--idea", "x", "--json"], /film has no option --json \(film --plan-only prints the plan\)/],
    [["film", "--plan", "plann.json"], new RegExp(`can't read the plan file ${path.join(repo, "plann.json").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}: no such file`)],
    [["film"], /--idea is required for film/],
    [["run", "--json", "workflows/nope.json"], /can't read the workflow .*nope\.json: no such file/],
    [["run", "workflows/03_shot_h3_i2v.json", "--set", "fa=valis/k.png", "--json"], /--set fa=valis\/k\.png: write it as node\.input=value/],
    [["run", "workflows/03_shot_h3_i2v.json", "--set", "zz.image=valis/k.png", "--json"], /no node zz in the workflow/],
    [["nope"], /unknown command: nope/],
  ];
  const runs = await Promise.all(bad.map(([args]) => cli(args)));
  for (const [k, [args, re]] of bad.entries()) ok(runs[k].code === 2 && re.test(runs[k].err), `error · ${args.join(" ")}`, `exit ${runs[k].code}: ${runs[k].err}`);
}

// ---- film --plan: the plan's own genre unless --genre is given; --plan-only prints it without making anything
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "valis-cli-"));
  const write = (name, o) => { const f = path.join(dir, name); fs.writeFileSync(f, typeof o === "string" ? o : JSON.stringify(o)); return f; };
  const plan = {title: "T", tag: "t1", genre: "noir", cast: [], place: "a pier", song: {style: "x", lyrics: "[Instrumental]"}, shots: [{keyframe: "k", motion: "m", subject: "s", effect: "none", on: "beat"}]};
  const own = await cli(["film", "--plan", write("p.json", plan), "--plan-only"]);
  ok(own.code === 0 && own.json?.genre === "noir" && own.json?.tag === "t1", "film --plan · the plan's own genre", own.err || own.out.slice(0, 200));
  const over = await cli(["film", "--plan", write("p.json", plan), "--genre", "western", "--plan-only"]);
  ok(over.code === 0 && over.json?.genre === "western", "film --plan · --genre wins over the plan's", over.err);
  const none = await cli(["film", "--plan", write("q.json", {...plan, genre: undefined}), "--plan-only"]);
  ok(none.code === 0 && none.json?.genre === "gothic", "film --plan · a plan with no genre is gothic", none.err);
  const bad = await cli(["film", "--plan", write("r.json", {...plan, genre: "gothik"}), "--plan-only"]);
  ok(bad.code === 2 && /the plan's genre gothik: no such id\. Pick one with --genre: gothic/.test(bad.err), "film --plan · a plan's unknown genre is an error", bad.err);
  const broken = await cli(["film", "--plan", write("s.json", "{\"shots\": ["), "--plan-only"]);
  ok(broken.code === 2 && /s\.json isn't JSON/.test(broken.err), "film --plan · a plan that isn't JSON says so", broken.err);
  const both = await cli(["film", "--plan", write("p.json", plan), "--idea", "x"]);
  ok(both.code === 2 && /--idea and --shots are for planning a new one/.test(both.err), "film --plan · --idea alongside a plan is an error, not ignored", both.err);
  fs.rmSync(dir, {recursive: true, force: true});
}

// ---- film --plan: a picture in ComfyUI's input folder (a reference you dropped in) is passed on as an input file.
// A stand-in of its own, so it can keep what the film command submits (it refuses it, which ends the run)
{
  const sent = [];
  const rec = http.createServer((req, res) => {
    const p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (req.method === "GET" && p.startsWith("/object_info/")) { const n = p.slice(13); res.writeHead(200, {"Content-Type": "application/json"}); return res.end(JSON.stringify(OI[n] ? {[n]: OI[n]} : {})); }
    const chunks = []; req.on("data", c => chunks.push(c));
    req.on("end", () => { sent.push(`${req.method} ${p} ${Buffer.concat(chunks).toString("utf8")}`); res.writeHead(404); res.end(); });
  });
  await new Promise(r => rec.listen(0, "127.0.0.1", r));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "valis-cli-"));
  const planWith = (key) => ({title: "T", tag: "t2", genre: "noir", cast: [], place: "a pier", song: {style: "x", lyrics: "[Instrumental]"},
    music: {audio: {filename: "song.flac", subfolder: "valis", type: "output"}, own: true, abc: "", bar: {bpm: 108, beats: 4, seconds: 2.2}, cut: {seconds: 2.2, bars: 1}},
    shots: [{keyframe: "k", motion: "m", subject: "s", effect: "none", on: "beat", key}]});
  const shoot = async (name, key) => {
    const f = path.join(dir, name); fs.writeFileSync(f, JSON.stringify(planWith(key))); sent.length = 0;
    const r = await cli(["film", "--plan", f], `http://127.0.0.1:${rec.address().port}`);
    return {...r, sent: sent.join("\n")};
  };
  const inp = await shoot("in.json", {filename: "pic.png", subfolder: "valis_refs", type: "input"});
  ok(/valis_refs\/pic\.png \[input\]/.test(inp.sent) && !/pic\.png \[output\]/.test(inp.sent), "film --plan · a still in the input folder is sent as an input file", inp.sent.slice(0, 300) || inp.err);
  const out = await shoot("out.json", {filename: "k_00001_.png", subfolder: "valis", type: "output"});
  ok(/valis\/k_00001_\.png \[output\]/.test(out.sent), "film --plan · a still ComfyUI made is sent as an output file", out.sent.slice(0, 300) || out.err);
  fs.rmSync(dir, {recursive: true, force: true}); rec.close();
}

// ---- run: a switch never swallows the workflow's name
{
  const r = await cli(["run", "--json", "workflows/03_shot_h3_i2v.json", "--set", "fa.image=valis/k.png", "--set", "8.noise_seed=7"]);
  const wf = JSON.parse(fs.readFileSync(path.join(repo, "workflows", "03_shot_h3_i2v.json"), "utf8"));
  ok(r.code === 0 && r.json?.fa?.inputs.image === "valis/k.png" && r.json?.["8"]?.inputs.noise_seed === 7 && Object.keys(r.json).length === Object.keys(wf).length, "run --json workflow.json --set", r.err);
}

ok(!asked.length, "nothing was uploaded or queued", asked.join(", "));
server.close();
console.log(`${pass} passed, ${fail} failed`);
if (fail) { console.log(failures.join("\n")); process.exit(1); }
