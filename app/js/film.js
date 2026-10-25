// Film: one line in, a scored and cut short film out. This is the chain the studio and the CLI both run; each hands in
// the `io` that submits a graph and reads its results (app.js over the SDK in the browser, cli/valis.mjs over the SDK
// in Node), so the same code makes the film in either place.
//
//   plan      Qwen3 (ComfyUI's text generation on Qwen Image's encoder) writes the shot list and the song brief as JSON;
//             or you write the script yourself
//   refs      a sheet for every character, every state of one, every prop (Krea 2; a state or a prop: Krea 2 identity edit)
//   sets      the set, empty, from every camera setup (Krea 2 for the first; the others turn the empty plate)
//   frames    people seated into a setup's plate from their sheets (Qwen Image 2.1), every moment fresh from the plate
//   song      YuE2 writes the sheet music and performs it; its tempo decides how long every shot is (whole bars)
//   keyframes a shot's still: its frame, or a box cut from it and re-rendered sharp (a shot with no frame: Krea 2 paints
//             it from its words, as before)
//   shots     MiniMax H3 shoots each keyframe, one job each
//   effects   SAM 3 tracks the shot's subject; the library fires the shot's effect on the song's lane; the sound design
//             is synthesized in the song's key, from where this shot sits in the song
//   cut       every shot trimmed to its bars and joined, each carrying its own slice of the song
import * as G from "./graphs.js";
import * as P from "./presets.js";

export const SHOT_SECONDS = 107 / 24;          // one H3 clip

export function parsePlan(text, shots) {
  const a = text.indexOf("{"), b = text.lastIndexOf("}");
  if (a < 0 || b < a) throw new Error("the planner wrote no JSON");
  let plan;
  try { plan = JSON.parse(text.slice(a, b + 1)); } catch (e) { throw new Error(`the planner's JSON doesn't parse: ${e.message}`); }
  if (!Array.isArray(plan.shots) || !plan.shots.length) throw new Error("the plan has no shots");
  const str = (v, d = "") => (v == null ? d : String(v)).trim() || d;
  // the cast: [{name, look}]; a plan written as one sentence becomes one unnamed member who is in every shot
  const cast = Array.isArray(plan.cast) ? plan.cast.map(c => ({name: str(c?.name), look: str(c?.look)})).filter(c => c.look) : (str(plan.cast) ? [{name: "", look: str(plan.cast)}] : []);
  const out = {
    title: str(plan.title, "Untitled"), logline: str(plan.logline), cast, place: str(plan.place),
    song: {style: str(plan.song?.style, "cinematic, instrumental"), lyrics: str(plan.song?.lyrics, "[Instrumental]")},
    shots: plan.shots.slice(0, shots).map(s => ({
      who: Array.isArray(s.who) ? s.who.map(w => str(w)).filter(Boolean) : null,
      keyframe: str(s.keyframe ?? s.frame), motion: str(s.motion, "subtle natural motion"), subject: str(s.subject, "the person"),
      effect: G.FILM_EFFECTS.includes(s.effect) ? s.effect : "none", on: G.FILM_LANES.includes(s.on) ? s.on : "beat"})),
  };
  if (!/\bBPM\b/i.test(out.song.style)) out.song.style += ", 108 BPM";
  return out;
}

// the song's bar, in seconds, from YuE2's ABC header (Q: tempo, M: meter); 108 BPM in 4/4 when it says nothing
export function barSeconds(abc) {
  const q = /^Q:\s*(?:(\d+)\/(\d+)\s*=\s*)?(\d+)/m.exec(abc || ""), m = /^M:\s*(\d+)\/(\d+)/m.exec(abc || "");
  const bpm = q ? Number(q[3]) : 108, unit = q && q[1] ? Number(q[1]) / Number(q[2]) : 0.25;
  const beats = m ? Number(m[1]) : 4, noteLen = m ? Number(m[2]) : 4;
  return {bpm, beats, seconds: beats * (1 / noteLen) / unit * 60 / bpm};
}

// how much of a clip plays: as many whole bars as fit in it (a clip shorter than a bar plays whole). A bar that ends
// up to HOLD past the clip still counts: the effects pass holds the clip's last frame that long (at 107 BPM two bars are
// 4.486 s and one H3 clip 4.458 s, which would otherwise throw half of every shot away)
export const HOLD = 3 / 24;
export function shotSeconds(bar, len = SHOT_SECONDS) {
  const bars = Math.max(1, Math.floor((len + HOLD) / bar + 1e-6));
  return {bars, seconds: bars * bar <= len + HOLD ? bars * bar : len};
}
// how long H3 shoots each shot (plan.shotSeconds; one clip of 4.46 s unless you say), and what of it plays on the bars
export const shotLen = (plan) => plan?.shotSeconds || SHOT_SECONDS;
export const cutOf = (plan) => shotSeconds(plan.music.bar.seconds, shotLen(plan));
// the song a film needs: every shot, plus room for the title card
export const songSeconds = (plan) => Math.min(120, Math.ceil(plan.shots.length * shotLen(plan) + 4));
// a shot made at another length than the plan's now is shot again
const stale = (plan, s) => s.clip && s.clipSeconds && Math.abs(s.clipSeconds - shotLen(plan)) > .01;

const isVideo = (o) => /\.mp4$/i.test(o.filename) && !/_part_/.test(o.filename);
const isText = (o) => /\.txt$/i.test(o.filename);

export async function planFilm({idea, shots = 6, genre = null}, io) {
  const tag = Date.now().toString(36);
  const r = await io.run(G.filmPlan({idea, shots, genre, prefix: `valis/film_${tag}_plan`}), "Film · plan");
  const txt = r.outputs.find(isText);
  if (!txt) throw new Error("the planner saved nothing");
  const plan = parsePlan(await io.text(txt), shots);
  return {...plan, tag, idea, genre: genre?.id || null};
}

// ---------------------------------------------------------------------------------------------------------- steps
// The film is made in steps, and every step can be run alone from the Film tab: the song, every shot's keyframe (review
// them, re-roll one, open one in Create and send it back), the shots, the effects, the cut. A step only makes what the
// plan doesn't have yet, so the whole film is the steps in order (makeFilm), and a stopped run picks up where it was.
// What each shot has is kept in the plan itself: shot.key (its still), shot.clip (its H3 shot), shot.fx (with effects).
// Results put there by hand (a still made in Create, a clip from the bin) are used as they are.
//
// io: {run(graph, label) -> {outputs}, text(file), ref(file), free?(), has?(node), exists?(file)}
const pre = (plan) => `${plan.dir || "valis"}/film_${plan.tag || (plan.tag = Date.now().toString(36))}`;
const base = (plan) => pre(plan).slice((plan.dir || "valis").length + 1);
async function saved(io, names, plan) {
  if (!io.exists) return null;
  const files = names.map(name => ({filename: name, subfolder: plan?.dir || "valis", type: "output"}));
  for (const f of files) if (!(await io.exists(f))) return null;
  return {outputs: files};
}
// a shot's still: the film's look (the plan's own words, else the genre's), the shot, the looks of the cast who are in it
// (all of them when the plan doesn't say), the place
export const lookOf = (plan, genre = null) => plan.look ?? genre?.style ?? "";
export function stillPrompt(plan, s, genre = null) {
  const inShot = (plan.cast || []).filter(c => !s.who || !c.name || s.who.some(w => w.toLowerCase().includes(c.name.toLowerCase()) || c.name.toLowerCase().includes(w.toLowerCase())));
  return [lookOf(plan, genre), s.keyframe, ...inShot.map(c => c.look), plan.place].filter(Boolean).join(" ");
}
// ---------------------------------------------------------------------------------------------------------- references
// A film is built from references, so what stays the same from shot to shot is the same picture, not the same words
// (words alone gave every still a new room, new faces and a new head count):
//   plan.cast    a sheet for every character (a costume-test portrait you pick); every state of one ({from: "Eleanor",
//                edit: "soaked, drowned"}: an edit of Eleanor's sheet); every prop made of them ({kind: "prop",
//                with: ["the widower", "Eleanor"], look: "their wedding photograph"}: those sheets in one picture)
//   plan.setups  the set, empty, from every camera setup. The first is painted from the film's look, its view and the
//                place; each other one turns an empty plate ({from: "master", turn: "from the opposite side"}). Turn the
//                empty plate, never a frame with people in it: they come back twice and the furniture goes
//   plan.frames  what a setup shows at one moment: people seated into its plate from their sheets as the blocking says
//                ({setup, with, seat}); a later moment names the frame it follows and what changed ({from, edit, with, gone}).
//                A seated frame seats everyone into the setup's clean plate (Qwen Image 2.1, one pass); every later
//                moment is one edit of that seated frame with every change so far in its words, never an edit of the
//                moment before (each pass repaints the whole picture: chained, they went soft and dark; seated fresh
//                again, the moment's words moved people to other chairs)
//   shot.frame   the shot's still is that frame, or a box cut from it (shot.crop, fractions of the frame) enlarged by
//                SeedVR2: a close-up with the same chair, the same neighbours, the same light, the same pose
// A shot with no frame keeps its own still painted from its words (stillPrompt), as before.
const SHEET = "Costume test photograph, shot on 35mm. Waist-up portrait, facing the camera, standing in front of a plain dark grey backdrop, soft even light from the front. Real skin texture, sharp focus, film grain.";
const PROP = "Close-up photograph on a plain dark grey backdrop, soft even light from the front. Sharp focus, film grain.";
export const byName = (list, name) => (list || []).find(x => x && x.name === name) || null;
const join = (...a) => a.filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
const and = (names) => names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
// who the second picture shows (the sheets go in side by side, left to right)
const shows = (names) => names.length === 1 ? `The second image shows ${names[0]}.` : `The second image shows, from left to right, ${and(names)}.`;
export function sheetPrompt(c) {                                       // a character or a prop, painted from its words
  return join(c.kind === "prop" ? PROP : SHEET, c.look);
}
export function refPrompt(c) {                                         // a state of another sheet, or sheets combined
  if (c.from) return join(c.edit, "Keep the face, the hair, the design of the clothes, the pose, the framing, the light and the backdrop the same.");
  const [a, ...rest] = c.with || [];
  return join(`The first image is ${a}.`, rest.length ? shows(rest) : "", c.look);
}
export function platePrompt(plan, su, genre = null) {                 // the first setup: the empty set
  return join(lookOf(plan, genre), su.view, plan.place, "No people.");
}
export function turnPrompt(plan, su) {                                 // another setup: the empty plate turned
  return join(`Show this same empty room ${su.turn || "from another side"}.`, su.view,
    "Keep every piece of furniture, the light and the film grain the same. No people.");
}
// a frame: its setup's plate with everyone in it, as its blocking says, at this moment (every change since the first
// frame of the chain, in order): one picture made fresh from the clean plate
export function frameChain(frames, f) {
  const chain = [], seen = new Set();
  for (let x = f; x; x = x.from ? byName(frames, x.from) : null) {
    if (seen.has(x)) throw new Error(`frame ${f.name} is made from itself`);
    seen.add(x); chain.unshift(x);
    if (x.from && !byName(frames, x.from)) throw new Error(`frame ${x.name} changes ${x.from}, which isn't a frame`);
  }
  const root = chain[0];
  let who = [];
  for (const x of chain) {                             // who is in it: everyone brought in so far, less anyone who has gone
    for (const n of x.with || []) if (!who.includes(n)) who.push(n);
    if (x.gone?.length) who = who.filter(n => !x.gone.includes(n));
  }
  return {root, chain, who, setup: root.setup, moment: chain.slice(1).map(x => x.edit).filter(Boolean)};
}
// a frame: its setup's empty plate with everyone in it at this moment, as the blocking says, every change so far in
// its words (Qwen numbers the pictures: the plate is Picture 1, each sheet the next)
export function framePrompt(plan, frames, f, genre = null) {
  const {root, who, moment, chain} = frameChain(frames, f);
  const gone = [];
  for (const x of chain) for (const n of x.gone || []) if (!gone.includes(n)) gone.push(n);
  return join("Picture 1 is the empty set.", who.map((n, i) => `Picture ${i + 2} is ${n}.`).join(" "),
    who.length ? "Place them into Picture 1, keeping the place, the furniture and the camera exactly as in Picture 1." : "Keep the place, the furniture and the camera exactly as in Picture 1.",
    root.seat, moment.length ? `At this moment: ${moment.join(" ")}` : "",
    gone.length ? `${and(gone)} ${gone.length > 1 ? "are" : "is"} not in the room.` : "",
    "Nobody else is in the frame.", who.length ? "Each person keeps their face, hair, clothes and accessories exactly as in their picture." : "", lookOf(plan, genre));
}
export const seatPrompt = (plan, f, genre = null) => framePrompt(plan, [f], f, genre);
// a later moment: one edit of its seated frame (never of the moment before), with every change so far in its words and
// the sheet of anyone who arrives. Seated fresh again, the moment's words moved people to other chairs.
export function momentPrompt(frames, f) {
  const {root, who, moment, chain} = frameChain(frames, f);
  const came = who.filter(n => !(root.with || []).includes(n)), gone = [];
  for (const x of chain) for (const n of x.gone || []) if (!gone.includes(n)) gone.push(n);
  // who must still be there, by name (an edit left the widower in when told he'd gone, and dropped the medium seen from
  // behind when nobody named her)
  const stay = who.filter(n => !came.includes(n));
  return join("Picture 1 is a still from this film.", came.map((n, i) => `Picture ${i + 2} is ${n}.`).join(" "),
    `At this moment: ${moment.join(" ")}`,
    gone.length ? `Remove ${and(gone)} from the picture completely: nobody sits where ${gone.length > 1 ? "they" : gone[0]} sat.` : "",
    came.length ? `${and(came)} keep${came.length > 1 ? "" : "s"} the face, hair and clothes of ${came.length > 1 ? "their pictures" : "Picture 2"}.` : "",
    `Everyone else stays exactly where and as they are${stay.length ? `: ${and(stay)}` : ""}${root.seat && /back to us/i.test(root.seat) ? ", and whoever sits with their back to us" : ""}. Keep every face, pose and piece of clothing, the furniture, the light and the framing exactly the same.`);
}
// what a reference, a setup or a frame is made from (the names of the others it needs first)
export const needs = {
  ref: (c) => c.from ? [c.from] : (c.with || []),
  setup: (su) => su.from ? [su.from] : [],
  frame: (f) => f.from ? [f.from] : [],
};
// the order to make things in: everything a thing needs comes before it (and a loop is an error)
export function inOrder(list, deps, what = "it") {
  const out = [], done = new Set(), path = new Set();
  const visit = (x) => {
    if (done.has(x)) return;
    if (path.has(x)) throw new Error(`${x.name} is made from itself`);
    path.add(x);
    for (const n of deps(x)) { const d = byName(list, n); if (d) visit(d); }
    path.delete(x); done.add(x); out.push(x);
  };
  list.forEach(visit);
  return out;
}
const slug = (s) => String(s || "x").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 24) || "x";
const png = (r) => r.outputs.find(o => /\.png$/i.test(o.filename)) || null;

export const sizeOf = (plan) => plan.size || {w: 768, h: 1344};            // the shots' size
const KEY = {w: 768, h: 1344};                                                // stills are always painted at Krea's own size
const keySeed = (s, k) => s.keySeed ?? 7101 + k;
const free = async (io) => { if (io.free) await io.free().catch(() => {}); };

// the song: YuE2 writes and plays it (or your own: plan.song.file, read for its tempo); its bar sets every shot's length
export const songShort = (plan) => !!(plan.music?.audio && !plan.music.own && plan.music.seconds && plan.music.seconds < songSeconds(plan) - .5);
export async function makeSong(plan, io, {onStage = () => {}} = {}) {
  if (plan.music?.audio && !songShort(plan)) return plan.music;
  plan.music = null;                                   // the shots got longer than the song: a longer one
  const n = plan.shots.length, b = base(plan);
  await free(io);
  if (plan.song.file) {                                // your own song: Valis hears its tempo and bars
    onStage("song", "Reading your song's tempo and bars");
    const r = await io.run(G.scoreMake({audio: plan.song.file, title: plan.title, prefix: `${pre(plan)}_score`}), "Film · read the song");
    const sc = JSON.parse(await io.text(r.outputs.find(o => /\.json$/i.test(o.filename))));
    const bar = {bpm: sc.bpm, beats: Number(String(sc.meter).split("/")[0]) || 4, seconds: sc.bar_seconds};
    return (plan.music = {audio: plan.song.file, own: true, abc: "", bar, cut: shotSeconds(bar.seconds, shotLen(plan))});
  }
  onStage("song", "YuE2 writes the sheet music and performs it");
  const sn = plan.shotSeconds ? `_song_${songSeconds(plan)}s` : "_song";      // a song per length, so a longer film finds its own
  const song = await saved(io, [`${b}${sn}_00001.flac`, `${b}${sn}_abc_00001.txt`], plan) || await io.run(
    G.song({style: plan.song.style, lyrics: plan.song.lyrics, seconds: songSeconds(plan), seed: plan.song.seed ?? 1843, prefix: `${pre(plan)}${sn}`}).graph, "Film · song");
  const audio = song.outputs.find(o => /\.(flac|wav|mp3)$/i.test(o.filename)), abcFile = song.outputs.find(isText);
  if (!audio) throw new Error("YuE2 saved no audio");
  const abc = abcFile ? await io.text(abcFile) : "";
  const bar = barSeconds(abc);
  return (plan.music = {audio, abc, bar, seconds: songSeconds(plan), cut: shotSeconds(bar.seconds, shotLen(plan))});
}

// ---- the references, the sets and the frames: each step makes what's missing (only: indexes to make again)
const sheetOf = (plan, name) => { const c = byName(plan.cast, name); if (!c) throw new Error(`"${name}" isn't in the cast`); if (!c.sheet) throw new Error(`${name} has no sheet yet`); return c.sheet; };
const SHEET_SIZE = {w: 832, h: 1216};                     // a sheet: a waist-up portrait
export async function makeRefs(plan, io, {only = null, onStage = () => {}} = {}) {
  const cast = plan.cast || [], want = new Set(cast.filter((c, i) => only ? only.includes(i) : !c.sheet));
  if (!want.size) return plan;
  await free(io);
  for (const c of inOrder(cast, needs.ref)) {
    if (!want.has(c)) continue;
    const k = cast.indexOf(c), seed = c.seed ?? 8301 + 10 * k, prefix = `${pre(plan)}_ref_${slug(c.name)}`;             // the graphs add the seed
    onStage("refs", `the sheet for ${c.name}`);
    const r = c.from || c.with?.length
      // a state is a strong change to a face and clothes: the encoder sees the sheet small, so the words weigh more
      ? await io.run(G.filmFrame({refs: needs.ref(c).map(n => ({image: io.ref(sheetOf(plan, n))})), prompt: refPrompt(c), from: SHEET_SIZE, size: SHEET_SIZE,
          grounding: c.from ? 512 : 1024, seeds: [seed], prefix}), `Film · ${c.name}`)
      : await io.run(G.keyframes({prompt: sheetPrompt(c), width: SHEET_SIZE.w, height: SHEET_SIZE.h, seeds: [seed], prefix}), `Film · ${c.name}`);
    c.sheet = png(r);
    if (!c.sheet) throw new Error(`no sheet for ${c.name}`);
  }
  return plan;
}
export async function makeSetups(plan, io, {genre = null, only = null, onStage = () => {}} = {}) {
  const sus = plan.setups || [], want = new Set(sus.filter((su, i) => only ? only.includes(i) : !su.plate));
  if (!want.size) return plan;
  await free(io);
  for (const su of inOrder(sus, needs.setup)) {
    if (!want.has(su)) continue;
    const k = sus.indexOf(su), seed = su.seed ?? 8601 + 10 * k, prefix = `${pre(plan)}_set_${slug(su.name)}`;
    onStage("sets", `the set from the ${su.name}`);
    let r;
    if (su.from) {
      const src = byName(sus, su.from);
      if (!src?.plate) throw new Error(`the ${su.name} turns the ${su.from}, which has no plate yet`);
      r = await io.run(G.filmFrame({refs: [{image: io.ref(src.plate)}], prompt: turnPrompt(plan, su), seeds: [seed], prefix}), `Film · set ${su.name}`);
    } else r = await io.run(G.keyframes({prompt: platePrompt(plan, su, genre), width: KEY.w, height: KEY.h, seeds: [seed], prefix}), `Film · set ${su.name}`);
    su.plate = png(r);
    if (!su.plate) throw new Error(`no plate for the ${su.name}`);
  }
  return plan;
}
export async function makeFrames(plan, io, {genre = null, only = null, onStage = () => {}} = {}) {
  const frames = plan.frames || [], want = new Set(frames.filter((f, i) => only ? only.includes(i) : !f.still));
  if (!want.size) return plan;
  await free(io);
  // seated frames first: each later moment is one edit of its seated frame
  for (const f of [...frames.filter(f => !f.from), ...frames.filter(f => f.from)]) {
    if (!want.has(f)) continue;
    const {root, who, setup} = frameChain(frames, f);
    // a moment on its seated frame's own seed starts from the very noise that frame was made from: it came back speckled
    // and over-sharpened and left out what changed (Eleanor never arrived), so every moment has a seed of its own
    const rootSeed = root.seed ?? 8401 + 10 * frames.indexOf(root);
    const seed = f.seed ?? (f.from ? rootSeed + 1000 + 37 * frames.indexOf(f) : rootSeed), prefix = `${pre(plan)}_frame_${slug(f.name)}`;
    onStage("frames", `frame ${f.name}`);
    let r;
    if (!f.from) {
      const su = byName(plan.setups, setup);
      if (!su) throw new Error(`frame ${f.name} has no setup`);
      if (!su.plate) throw new Error(`the ${su.name} has no plate yet`);
      r = await io.run(G.filmSeat({plate: io.ref(su.plate), people: who.map(n => ({image: io.ref(sheetOf(plan, n))})), prompt: framePrompt(plan, frames, f, genre), seed, prefix}), `Film · frame ${f.name}`);
    } else {
      if (!root.still) throw new Error(`frame ${f.name} is made from ${root.name}, which isn't made yet`);
      const came = who.filter(n => !(root.with || []).includes(n));
      r = await io.run(G.filmSeat({plate: io.ref(root.still), people: came.map(n => ({image: io.ref(sheetOf(plan, n))})), prompt: momentPrompt(frames, f), seed, prefix}), `Film · frame ${f.name}`);
    }
    f.still = png(r);
    if (!f.still) throw new Error(`no still for frame ${f.name}`);
  }
  return plan;
}
// what a frame-built shot needs before its still can be made
export function shotFrame(plan, s) {
  if (!s.frame) return null;
  const f = byName(plan.frames, s.frame);
  if (!f) throw new Error(`there is no frame ${s.frame}`);
  return f;
}

// keyframes for the shots that have none (only: shot indexes to make again, with a new seed if asked)
// a shot built from a frame whose still has changed since (a re-rolled moment) needs its still again
export function keyStale(plan, s) {
  if (!s.frame || !s.key) return false;
  const f = byName(plan.frames, s.frame);
  return !!(f?.still && s.keyFrom && s.keyFrom !== f.still.filename);
}
export async function frameShots(plan, io, {genre = null, only = null, onStage = () => {}} = {}) {
  let want = plan.shots.map((s, k) => k).filter(k => only ? only.includes(k) : !plan.shots[k].key || keyStale(plan, plan.shots[k]));
  if (!want.length) return plan;
  // shots built from a frame: the frame itself, or a box cut from it and made sharp with the sheets of who is in it
  const built = want.filter(k => plan.shots[k].frame);
  if (built.length) await free(io);
  for (const k of built) {
    const s = plan.shots[k], f = shotFrame(plan, s);
    if (!f.still) throw new Error(`shot ${k + 1}'s frame ${f.name} isn't made yet`);
    if (!s.crop) { if (s.key?.filename !== f.still.filename) { s.clip = null; s.fx = null; } s.key = f.still; s.keyFrom = f.still.filename; continue; }
    const seed = keySeed(s, k);
    onStage("keyframes", `shot ${k + 1}: a close-up cut from frame ${f.name}`);
    const r = await io.run(G.filmCrop({frame: io.ref(f.still), crop: s.crop, from: KEY, size: KEY, seed, prefix: `${pre(plan)}_key_${k + 1}_${slug(f.name)}`}), `Film · keyframe ${k + 1}`);
    s.key = png(r); s.keyFrom = f.still.filename; s.clip = null; s.fx = null;
    if (!s.key) throw new Error(`no keyframe for shot ${k + 1}`);
  }
  want = want.filter(k => !plan.shots[k].frame);
  if (!want.length) return plan;
  const {w, h} = KEY, b = base(plan);
  await free(io);
  onStage("keyframes", `Krea 2 frames ${want.length} shot${want.length > 1 ? "s" : ""}`);
  if (!only && want.length === plan.shots.length && !plan.shots.some(s => s.keySeed != null)) {
    // the whole film in one graph (Krea loads once), named so a stopped run finds them again
    const keys = await saved(io, plan.shots.map((_, k) => `${b}_key_${k + 1}_00001_.png`), plan) || await io.run(
      G.filmKeyframes({prompts: plan.shots.map(s => stillPrompt(plan, s, genre)), seed: 7101, width: w, height: h, prefix: `${pre(plan)}_key`}), "Film · keyframes");
    want.forEach(k => { plan.shots[k].key = keys.outputs.find(o => new RegExp(`_key_${k + 1}_\\d+_\\.png$`).test(o.filename)) || null; });
  } else {
    for (const k of want) {
      const s = plan.shots[k];
      const r = await io.run(G.keyframes({prompt: stillPrompt(plan, s, genre), width: w, height: h, seeds: [keySeed(s, k)], prefix: `${pre(plan)}_key_${k + 1}_s${keySeed(s, k)}`}), `Film · keyframe ${k + 1}`);
      s.key = r.outputs.find(o => /\.png$/i.test(o.filename)) || null;
      s.clip = null; s.fx = null;                      // a new still means the shot is made again
    }
  }
  const miss = want.filter(k => !plan.shots[k].key);
  if (miss.length) throw new Error(`no keyframe for shot ${miss.map(k => k + 1).join(", ")}`);
  return plan;
}

export async function shootShots(plan, io, {genre = null, only = null, onStage = () => {}} = {}) {
  const want = plan.shots.map((s, k) => k).filter(k => only ? only.includes(k) : !plan.shots[k].clip || stale(plan, plan.shots[k]));
  const {w, h} = sizeOf(plan), b = base(plan), push = P.MOVES.find(m => m.id === "push"), len = shotLen(plan);
  if (want.length) await free(io);
  for (const k of want) {
    const s = plan.shots[k];
    if (!s.key) throw new Error(`shot ${k + 1} has no keyframe yet`);
    onStage("shots", `MiniMax H3 shoots shot ${k + 1} of ${plan.shots.length}`, k);
    const seed = s.shotSeed ?? 51101 + k, fresh = only || s.shotSeed != null || plan.size || plan.shotSeconds;
    const r = (!fresh && await saved(io, [`${b}_shot_${k + 1}_00001_.mp4`], plan)) || await io.run(
      G.shot({image: io.ref(s.key), motion: P.motionPrompt({genre, move: push, action: s.motion, look: plan.look || null}), seconds: len, width: w, height: h, seed,
              soundscape: P.soundPrompt({subject: s.keyframe || "", action: s.motion || ""}) || undefined,
              prefix: `${pre(plan)}_shot_${k + 1}${fresh ? `_s${seed}` : ""}`}), `Film · shot ${k + 1}`);
    s.clip = r.outputs.find(isVideo) || null; s.fx = null; s.clipSeconds = len;
    if (!s.clip) throw new Error(`shot ${k + 1} saved no video`);
  }
  return plan;
}

export async function effectShots(plan, io, {only = null, onStage = () => {}} = {}) {
  const m = plan.music; if (!m?.audio) throw new Error("make the song first");
  const cut = (m.cut = cutOf(plan)), len = shotLen(plan);
  const want = plan.shots.map((s, k) => k).filter(k => only ? only.includes(k) : !plan.shots[k].fx);
  const b = base(plan);
  if (want.length) await free(io);
  for (const k of want) {
    const s = plan.shots[k], lib = G.LIBRARY.find(l => l.id === s.effect);
    if (!s.clip || stale(plan, s)) throw new Error(`shot ${k + 1} isn't shot${s.clip ? " at this length" : ""} yet`);
    onStage("effects", `effects and sound on shot ${k + 1} of ${plan.shots.length}`, k);
    const layers = lib ? [{effect: lib.id, on: s.on, params: lib.params || {}}] : [];
    const subject = lib && ((lib.needs || []).includes("subject") || lib.params?.at === "subject") ? s.subject : "";
    const r = (!only && !s._custom && !plan.shotSeconds && await saved(io, [`${b}_fx_${k + 1}_00001_.mp4`], plan)) || await io.run(
      // the shot keeps its keyframe's colours (a shot whose light is meant to change says holdColour: false)
      G.fx({clip: io.ref(s.clip), subject, source: "song", audio: io.ref(m.audio), abc: m.abc, layers, sound: true,
            hold: s.key && s.holdColour !== false ? io.ref(s.key) : null,
            seconds: Math.max(len, cut.seconds), fit: cut.seconds > len,
            start: k * cut.seconds, prefix: `${pre(plan)}_fx_${k + 1}${only ? "_" + Date.now().toString(36) : ""}`}), `Film · effects ${k + 1}`);
    s.fx = r.outputs.find(isVideo) || null;
    if (!s.fx) throw new Error(`effects on shot ${k + 1} saved no video`);
  }
  return plan;
}

export async function cutFilm(plan, io, {onStage = () => {}} = {}) {
  const m = plan.music, n = plan.shots.length;
  m.cut = cutOf(plan);
  const miss = plan.shots.map((s, k) => s.fx && !stale(plan, s) ? null : k + 1).filter(Boolean);
  if (miss.length) throw new Error(`shot ${miss.join(", ")} has no effects pass yet`);
  onStage("cut", `cutting ${n} shots on the bars (${m.cut.bars} bar${m.cut.bars > 1 ? "s" : ""} each at ${m.bar.bpm} BPM)`);
  const {w, h} = sizeOf(plan);
  const card = io.has && await io.has("ValisTitleCard") ? {text: plan.title, song: io.ref(m.audio), start: n * m.cut.seconds, seconds: 3, width: w, height: h} : null;
  const r = await io.run(G.filmCut({shots: plan.shots.map(s => ({file: io.ref(s.fx), seconds: m.cut.seconds})), title: card, prefix: `${pre(plan)}_film${plan.cuts ? "_" + plan.cuts : ""}`}), "Film · cut");
  plan.cuts = (plan.cuts || 0) + 1;
  plan.film = r.outputs.find(isVideo) || null;
  if (!plan.film) throw new Error("the cut saved no video");
  return plan;
}

// the whole film: every step in order, each making only what is still missing
export async function makeFilm(plan, io, {genre = null, onStage = () => {}, onStep = () => {}} = {}) {
  plan.tag = plan.tag || Date.now().toString(36);
  if (plan.cast?.some(c => c.sheet || c.from || c.with) || plan.setups?.length || plan.frames?.length) {   // a film built from references
    await makeRefs(plan, io, {onStage}); onStep(plan);
    await makeSetups(plan, io, {genre, onStage}); onStep(plan);
    await makeFrames(plan, io, {genre, onStage}); onStep(plan);
  }
  await makeSong(plan, io, {onStage}); onStep(plan);
  await frameShots(plan, io, {genre, onStage}); onStep(plan);
  await shootShots(plan, io, {genre, onStage}); onStep(plan);
  await effectShots(plan, io, {onStage}); onStep(plan);
  await cutFilm(plan, io, {onStage}); onStep(plan);
  const m = plan.music;
  return {film: plan.film, song: m.audio, abc: m.abc, bar: m.bar, cut: m.cut, keys: plan.shots.map(s => s.key), clips: plan.shots.map(s => s.clip),
          fxed: plan.shots.map(s => s.fx), tag: plan.tag};
}
