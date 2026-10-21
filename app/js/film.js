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
export function shotSeconds(bar) {
  const bars = Math.max(1, Math.floor(SHOT_SECONDS / bar + 1e-6));
  return {bars, seconds: Math.min(SHOT_SECONDS, bars * bar)};
}

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

// A run stopped halfway resumes: a stage whose files are already in ComfyUI's output (same plan, same tag) is not run
// again. io.exists says whether a saved file is there; without it every stage runs.
export async function makeFilm(plan, io, {genre = null, onStage = () => {}} = {}) {
  const tag = plan.tag || Date.now().toString(36), n = plan.shots.length, pre = `valis/film_${tag}`;
  const saved = async (names) => {
    if (!io.exists) return null;
    const files = names.map(name => ({filename: name, subfolder: "valis", type: "output"}));
    for (const f of files) if (!(await io.exists(f))) return null;
    return {outputs: files};
  };
  const stage = async (names, label, graph) => (await saved(names)) || await io.run(graph(), label);
  // a shot's still: the genre's look, the shot, the looks of the cast who are in it (all of them when the plan doesn't say), the place
  const inShot = (s) => (plan.cast || []).filter(c => !s.who || !c.name || s.who.some(w => w.toLowerCase().includes(c.name.toLowerCase()) || c.name.toLowerCase().includes(w.toLowerCase())));
  const still = (s) => [genre?.style || "", s.keyframe, ...inShot(s).map(c => c.look), plan.place].filter(Boolean).join(" ");
  const push = P.MOVES.find(m => m.id === "push");
  const free = async () => { if (io.free) await io.free().catch(() => {}); };
  await free();
  onStage("song", "YuE2 writes the sheet music and performs it");
  const base = pre.slice("valis/".length);
  const song = await stage([`${base}_song_00001.flac`, `${base}_song_abc_00001.txt`], "Film · song",
    () => G.song({style: plan.song.style, lyrics: plan.song.lyrics, seconds: Math.min(60, Math.ceil(n * SHOT_SECONDS + 2)), seed: 1843, prefix: `${pre}_song`}).graph);
  const audio = song.outputs.find(o => /\.(flac|wav|mp3)$/i.test(o.filename)), abcFile = song.outputs.find(isText);
  if (!audio) throw new Error("YuE2 saved no audio");
  const abc = abcFile ? await io.text(abcFile) : "";
  const bar = barSeconds(abc), cut = shotSeconds(bar.seconds);
  await free();
  onStage("keyframes", `Krea 2 frames ${n} shots`);
  const keys = await stage(plan.shots.map((_, k) => `${base}_key_${k + 1}_00001_.png`), "Film · keyframes",
    () => G.filmKeyframes({prompts: plan.shots.map(still), seed: 7101, prefix: `${pre}_key`}));
  const keyOf = (k) => keys.outputs.find(o => new RegExp(`_key_${k + 1}_\\d+_\\.png$`).test(o.filename));
  const clips = [];
  for (let k = 0; k < n; k++) {
    if (k === 0) await free();
    onStage("shots", `MiniMax H3 shoots shot ${k + 1} of ${n}`, k);
    const key = keyOf(k);
    if (!key) throw new Error(`no keyframe for shot ${k + 1}`);
    const r = await stage([`${base}_shot_${k + 1}_00001_.mp4`], `Film · shot ${k + 1}`,
      () => G.shot({image: io.ref(key), motion: P.motionPrompt({genre, move: push, action: plan.shots[k].motion}), seconds: SHOT_SECONDS, seed: 51101 + k, prefix: `${pre}_shot_${k + 1}`}));
    const v = r.outputs.find(isVideo);
    if (!v) throw new Error(`shot ${k + 1} saved no video`);
    clips.push(v);
  }
  const fxed = [];
  for (let k = 0; k < n; k++) {
    const s = plan.shots[k], lib = G.LIBRARY.find(l => l.id === s.effect);
    if (k === 0) await free();
    onStage("effects", `effects and sound on shot ${k + 1} of ${n}`, k);
    const layers = lib ? [{effect: lib.id, on: s.on, params: lib.params || {}}] : [];
    const subject = lib && ((lib.needs || []).includes("subject") || lib.params?.at === "subject") ? s.subject : "";
    const r = await stage([`${base}_fx_${k + 1}_00001_.mp4`], `Film · effects ${k + 1}`,
      () => G.fx({clip: io.ref(clips[k]), subject, source: "song", audio: io.ref(audio), abc, layers, sound: true, seconds: SHOT_SECONDS,
                  start: k * cut.seconds, prefix: `${pre}_fx_${k + 1}`}));
    const v = r.outputs.find(isVideo);
    if (!v) throw new Error(`effects on shot ${k + 1} saved no video`);
    fxed.push(v);
  }
  onStage("cut", `cutting ${n} shots on the bars (${cut.bars} bar${cut.bars > 1 ? "s" : ""} each at ${bar.bpm} BPM)`);
  // the title card at the end needs the Valis Title Card node (a pack loaded before it existed has no such node until a restart)
  const card = io.has && await io.has("ValisTitleCard") ? {text: plan.title, song: io.ref(audio), start: n * cut.seconds, seconds: 3, width: 768, height: 1344} : null;
  const r = await io.run(G.filmCut({shots: fxed.map(v => ({file: io.ref(v), seconds: cut.seconds})), title: card, prefix: `${pre}_film`}), "Film · cut");
  const film = r.outputs.find(isVideo);
  if (!film) throw new Error("the cut saved no video");
  return {film, song: audio, abc, bar, cut, keys: keys.outputs.filter(o => /\.png$/i.test(o.filename)), clips, fxed, tag};
}
