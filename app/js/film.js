// Film: one line in, a scored and cut short film out. This is the chain the studio and the CLI both run; each hands in
// the `io` that submits a graph and reads its results (app.js over the SDK in the browser, cli/valis.mjs over the SDK
// in Node), so the same code makes the film in either place.
//
//   plan      Qwen3 (ComfyUI's text generation on Qwen Image's encoder) writes the shot list and the song brief as JSON
//   song      YuE2 writes the sheet music and performs it; its tempo decides how long every shot is (whole bars)
//   keyframes Krea 2 frames every shot in one graph
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

// how much of a clip plays: as many whole bars as fit in it (a clip shorter than a bar plays whole)
export function shotSeconds(bar, len = SHOT_SECONDS) {
  const bars = Math.max(1, Math.floor(len / bar + 1e-6));
  return {bars, seconds: Math.min(len, bars * bar)};
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
// a shot's still: the genre's look, the shot, the looks of the cast who are in it (all of them when the plan doesn't say), the place
export function stillPrompt(plan, s, genre = null) {
  const inShot = (plan.cast || []).filter(c => !s.who || !c.name || s.who.some(w => w.toLowerCase().includes(c.name.toLowerCase()) || c.name.toLowerCase().includes(w.toLowerCase())));
  return [genre?.style || "", s.keyframe, ...inShot.map(c => c.look), plan.place].filter(Boolean).join(" ");
}
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

// keyframes for the shots that have none (only: shot indexes to make again, with a new seed if asked)
export async function frameShots(plan, io, {genre = null, only = null, onStage = () => {}} = {}) {
  const want = plan.shots.map((s, k) => k).filter(k => only ? only.includes(k) : !plan.shots[k].key);
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
      G.shot({image: io.ref(s.key), motion: P.motionPrompt({genre, move: push, action: s.motion}), seconds: len, width: w, height: h, seed,
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
      G.fx({clip: io.ref(s.clip), subject, source: "song", audio: io.ref(m.audio), abc: m.abc, layers, sound: true, seconds: len,
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
  await makeSong(plan, io, {onStage}); onStep(plan);
  await frameShots(plan, io, {genre, onStage}); onStep(plan);
  await shootShots(plan, io, {genre, onStage}); onStep(plan);
  await effectShots(plan, io, {onStage}); onStep(plan);
  await cutFilm(plan, io, {onStage}); onStep(plan);
  const m = plan.music;
  return {film: plan.film, song: m.audio, abc: m.abc, bar: m.bar, cut: m.cut, keys: plan.shots.map(s => s.key), clips: plan.shots.map(s => s.clip),
          fxed: plan.shots.map(s => s.fx), tag: plan.tag};
}
