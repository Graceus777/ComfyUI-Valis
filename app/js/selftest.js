// End-to-end test: short, low-resolution renders through the studio's own builders (create.js, graphs.js), so a
// passing test means the button works, not a copy of it. Each combination runs its whole chain on the GPU and every
// output is checked: it exists, has the size and length asked for, isn't black or frozen, has sound when it should,
// and is black-and-white when the look is.
//
// From Renders → Setup → End-to-end test, or the console:
//   const T = await import("/valis/app/js/selftest.js"); T.run({only: ["c01", "c02"]})
// The report is saved to ComfyUI/user/default/valis/selftest/latest.json (and <run id>.json).
import * as api from "./api.js";
import * as G from "./graphs.js";
import * as P from "./presets.js";
import * as CR from "./create.js";

const SCENES = {
  street: {subject: "a man in a long dark coat and a hat standing under a streetlamp on a wet city street at night",
           action: "he turns his head slowly and looks down the street while rain falls", who: "the man"},
  market: {subject: "a woman in a red dress walking through a busy sunlit market square", action: "she walks toward the camera, smiling", who: "the woman"},
  canyon: {subject: "an astronaut in a white suit standing alone in a wide red desert canyon", action: "the astronaut raises a hand against the sun while dust blows past",
           who: "the astronaut"},
  pier: {subject: "an old fisherman mending a net on a wooden pier at dawn", action: "his hands work the net while gulls wheel behind him", who: "the fisherman"},
};
const MONO = new Set(["noir", "silver_mono", "sepia", "daguerreotype"]);
// a Create combination: the panel's choices (presets ids) and what to expect
const base = {genre: "gothic", framing: "wide", focal: "auto", light: "auto", setup: "auto", body: "auto", kit: "auto", era: "auto",
              emotion: "neutral", tempo: "single", move: "push_in", look: {id: "auto"}, aspect: "9:16", short: 384, seconds: 3.0, gradeShot: true,
              opts: {trained: true, anchor: false, trim: true}};
const c = (id, label, scene, over) => ({id, suite: "create", label, C: {...base, ...SCENES[scene], ...over, opts: {...base.opts, ...(over.opts || {})}}});
export const TESTS = [
  c("c01", "IMAX 65mm + fisheye + 1950s + Noir, push in (trained)", "street", {body: "imax", kit: "fisheye", era: "1950s", look: {id: "noir"}}),
  c("c02", "IMAX 65mm + fisheye + 1950s + Teal & orange, push in", "street", {body: "imax", kit: "fisheye", era: "1950s", look: {id: "teal_orange"}}),
  c("c03", "Super 8 + vintage + 1970s + Faded 70s, handheld", "market", {genre: "documentary", body: "super8", kit: "vintage", era: "1970s", look: {id: "faded_70s"}, move: "handheld"}),
  c("c04", "VHS + 1980s + VHS look, static, 16:9", "market", {genre: "music", body: "vhs", era: "1980s", look: {id: "vhs"}, move: "static", aspect: "16:9"}),
  c("c05", "Digital + anamorphic + Neon night, dolly zoom in (trained + Valis Dolly Zoom)", "street", {genre: "neon", body: "digital", kit: "anamorphic", era: "today", look: {id: "neon_night"}, move: "dolly_zoom_in"}),
  c("c06", "16mm + 1960s + Kodachrome, whip pan (Valis Whip Pan)", "pier", {genre: "documentary", body: "16mm", era: "1960s", look: {id: "kodachrome"}, move: "whip_pan"}),
  c("c07", "35mm + 1920s + Sepia, 360 orbit (orbit LoRA, 8.8 s)", "canyon", {genre: "fantasy", body: "35mm", era: "1920s", look: {id: "sepia"}, move: "orbit_360"}),
  c("c08", "Silent film + Daguerreotype, crash zoom in (Wan 2.2 LoRA)", "street", {genre: "noir", body: "silent", era: "1920s", look: {id: "daguerreotype"}, move: "crash_zoom_in"}),
  c("c09", "Action cam + fisheye + 2000s + DV camcorder, FPV drone (trained)", "canyon", {genre: "documentary", body: "action", kit: "fisheye", era: "2000s", look: {id: "camcorder"}, move: "fpv_drone"}),
  c("c10", "Your own colours: Teal & orange with edited swatches, 1:1, crane up (trained)", "pier", {genre: "western", look: {id: "teal_orange", hex: ["#10202c", "#2e6f73", "#e0a15a", "#f6e6c8"]}, move: "crane_up", aspect: "1:1"}),
  c("c11", "Custom palette only (3 colours), crane over the head, ends on the subject (Qwen end frame) + trim hold", "canyon", {genre: "fantasy", look: {id: "custom", hex: ["#1b0f2e", "#c2452d", "#f4d58d"]}, move: "crane_overhead", opts: {trained: false, anchor: true, trim: true}}),
  c("c12", "Loop (FastH3), Golden hour", "pier", {genre: "documentary", look: {id: "golden_hour"}, move: "static", action: "the net sways gently and the water ripples", opts: {loop: true, loopEngine: "fast"}}),
  c("c13", "Relight to contre-jour, then a light change shot", "market", {genre: "documentary", look: {id: "film_colors"}, move: "push_in", opts: {trained: false, lightChange: true}, relight: "contre_jour"}),
  c("c14", "Character from another keyframe (Krea identity edit), Kodak 2383", "street", {genre: "gothic", look: {id: "kodak_2383"}, move: "static", cast: "c03"}),
];

// ---------------------------------------------------------------------------------------------------------- checks
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function inspectVideo(url, samples = 8) {
  const v = document.createElement("video");
  v.muted = true; v.preload = "auto"; v.playsInline = true; v.src = url;
  await new Promise((res, rej) => { v.onloadeddata = res; v.onerror = () => rej(new Error("the video won't load")); setTimeout(() => rej(new Error("the video took too long to load")), 30000); });
  const W = v.videoWidth, H = v.videoHeight, D = v.duration, cw = 96, ch = Math.max(1, Math.round(96 * H / W));
  const cv = document.createElement("canvas"); cv.width = cw; cv.height = ch;
  const x = cv.getContext("2d", {willReadFrequently: true});
  const strip = document.createElement("canvas"); strip.width = 4 * cw; strip.height = ch;
  const sx = strip.getContext("2d");
  const frames = [];
  for (let i = 0; i < samples; i++) {
    v.currentTime = Math.min(D - 0.05, (i + 0.5) / samples * D);
    await new Promise(r => { v.onseeked = r; setTimeout(r, 4000); });
    x.drawImage(v, 0, 0, cw, ch);
    frames.push(x.getImageData(0, 0, cw, ch).data.slice());
    if (i % 2 === 0) sx.drawImage(cv, (i / 2) * cw, 0);
  }
  // monochrome = every pixel the same hue (a grey or a tint like sepia): its colour divided by its brightness is constant
  let luma = 0, sat = 0, n = 0, rr = 0, rr2 = 0, br = 0, br2 = 0, m = 0;
  for (const f of frames) for (let p = 0; p < f.length; p += 4) {
    const r = f[p] / 255, g = f[p + 1] / 255, b = f[p + 2] / 255, L = .2126 * r + .7152 * g + .0722 * b;
    luma += L; sat += Math.max(r, g, b) - Math.min(r, g, b); n++;
    if (L > .12) { const a = r / L, c = b / L; rr += a; rr2 += a * a; br += c; br2 += c * c; m++; }
  }
  const sd = (s, s2) => m ? Math.sqrt(Math.max(0, s2 / m - (s / m) ** 2)) : 0;
  const hueSpread = Math.max(sd(rr, rr2), sd(br, br2));
  let diff = 0;
  for (let k = 1; k < frames.length; k++) { let d = 0; const a = frames[k - 1], b = frames[k]; for (let p = 0; p < a.length; p += 4) d += Math.abs(a[p] - b[p]) + Math.abs(a[p + 1] - b[p + 1]) + Math.abs(a[p + 2] - b[p + 2]); diff += d / (a.length * .75 * 255); }
  let audioDb = null;
  try {
    const buf = await (await fetch(url)).arrayBuffer();
    const ab = await new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(1, 44100, 44100).decodeAudioData(buf);
    const ch0 = ab.getChannelData(0); let s = 0; for (let i = 0; i < ch0.length; i++) s += ch0[i] * ch0[i];
    audioDb = 20 * Math.log10(Math.sqrt(s / Math.max(1, ch0.length)) + 1e-9);
  } catch { audioDb = null; }        // no audio track
  return {width: W, height: H, seconds: D, luma: luma / n, saturation: sat / n, hueSpread, motion: diff / Math.max(1, frames.length - 1), audioDb,
          strip: strip.toDataURL("image/jpeg", .7)};
}
function verdicts(m, exp) {
  const out = [];
  const ok = (name, pass, detail) => out.push({name, pass, detail});
  if (exp.width) ok("size", m.width === exp.width && m.height === exp.height, `${m.width}x${m.height} (asked ${exp.width}x${exp.height})`);
  if (exp.seconds) ok("length", Math.abs(m.seconds - exp.seconds) <= (exp.slack ?? 0.6), `${m.seconds.toFixed(2)} s (asked ${exp.seconds.toFixed(2)} s)`);
  ok("not black", m.luma > 0.03, `mean brightness ${(m.luma * 100).toFixed(1)}%`);
  ok("moves", m.motion > (exp.minMotion ?? 0.004), `frame-to-frame change ${(m.motion * 100).toFixed(2)}%`);
  if (exp.mono) ok("monochrome", m.hueSpread < 0.08, `hue spread ${m.hueSpread.toFixed(3)} (grey or one tint < 0.08), colourfulness ${(m.saturation * 100).toFixed(1)}%`);
  if (exp.audio) ok("sound", m.audioDb != null && m.audioDb > -60, m.audioDb == null ? "no audio track" : `${m.audioDb.toFixed(1)} dB`);
  return out;
}

// ---------------------------------------------------------------------------------------------------------- runner
const env = {hasNode: (n) => api.hasNode(n), hasLora: (n) => api.hasLora(n)};
async function render(graph, label) {
  const job = await api.submit(graph, label, "selftest");
  const t0 = Date.now();
  const j = await api.waitFor(job);
  if (j.status !== "done") throw new Error(`${label}: ${j.error}`);
  return {job: j, outputs: j.outputs, seconds: (Date.now() - t0) / 1000};
}
const isImg = (f) => /\.(png|jpe?g|webp)$/i.test(f.filename), isVid = (f) => /\.(mp4|webm|mov)$/i.test(f.filename) && !/_part_/.test(f.filename);

async function runCreate(t, ctx, log) {
  const C = {...t.C, prefix: `valis/selftest/${ctx.run}_${t.id}_shot`};
  const key = CR.keyframePrompt(C), motion = CR.motionPrompt(C);
  log({prompts: {keyframe: key, motion}});
  const k = await render(CR.keyframesGraph(C, {seeds: [7101], prefix: `valis/selftest/${ctx.run}_${t.id}_key`}), `${t.id} keyframe`);
  let still = k.outputs.find(isImg);
  if (!still) throw new Error("the keyframe job saved no image");
  log({keyframe: still, keyframeSeconds: k.seconds});
  ctx.keys[t.id] = still;
  if (t.C.cast) {
    const ref = ctx.keys[t.C.cast];
    if (!ref) throw new Error(`needs ${t.C.cast}'s keyframe first`);
    const r = await render(G.castCharacter({keyframe: api.outputRef(still), character: api.outputRef(ref), refBoost: 0.5,
      prompt: `Turn ${C.who} into the character from the second image: the same face, hair, skin and outfit as the reference. Keep ${C.who}'s pose and position, everyone else, the framing, the room and the lighting exactly the same.`,
      prefix: `valis/selftest/${ctx.run}_${t.id}_cast`}), `${t.id} cast`);
    still = r.outputs.find(isImg) || still; log({cast: still, castSeconds: r.seconds});
  }
  let relit = null;
  if (t.C.relight) {
    const rl = P.RELIGHT.find(x => x.id === t.C.relight);
    const r = await render(G.relightImage({image: api.outputRef(still), prompt: `Relight this photo: ${rl.words}.${P.RELIGHT_KEEP}`, prefix: `valis/selftest/${ctx.run}_${t.id}_relit`}), `${t.id} relight`);
    const o = r.outputs.find(isImg); if (o) { relit = api.outputRef(o); log({relit: o, relightSeconds: r.seconds}); }
  }
  const plan = await CR.planShot({...C, image: api.outputRef(still), relit}, env);
  log({shotLabel: plan.label, notes: plan.notes, asked: {width: plan.width, height: plan.height, seconds: plan.seconds, frames: CR.frames(plan.seconds)}});
  const s = await render(plan.graph, `${t.id} ${plan.label}`);
  const vid = s.outputs.find(isVid);
  if (!vid) throw new Error("the shot saved no video");
  const m = await inspectVideo(api.viewUrl(vid));
  const fps = plan.kind === "wan" ? 16 : 24;
  const expSecs = plan.kind === "wan" ? Math.round(plan.seconds * 16 / 4) * 4 / 16 + 1 / 16 : plan.kind === "loop" ? null : CR.frames(plan.seconds) / 24;
  // a trimmed hold and a whip pan's speed ramp both make the shot shorter than asked, by design
  const shorter = Object.values(plan.graph).some(n => n.class_type === "ValisTrimHold" || n.class_type === "ValisWhipPan");
  const checks = verdicts(m, {width: plan.width, height: plan.height, seconds: shorter ? null : expSecs, mono: MONO.has(C.look?.id) && !C.look?.hex, audio: plan.kind !== "wan", slack: 0.6});
  log({shot: vid, shotSeconds: s.seconds, measured: {...m, strip: undefined, fps}, strip: m.strip, checks});
  ctx.shots[t.id] = vid;
  return checks.every(c => c.pass);
}

let ABORT = false;
export function stop() { ABORT = true; }
export async function run({only = null, onUpdate = () => {}} = {}) {
  ABORT = false;
  const tests = TESTS.filter(t => !only || only.includes(t.id) || only.includes(t.suite));
  const runId = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15);
  const report = {run: runId, started: new Date().toISOString(), tests: tests.map(t => ({id: t.id, suite: t.suite, label: t.label, status: "waiting"}))};
  const ctx = {run: runId, keys: {}, shots: {}};
  const save = async () => { onUpdate(report); try { await api.writeUser(`valis/selftest/latest.json`, report); await api.writeUser(`valis/selftest/${runId}.json`, report); } catch (e) { console.warn(e); } };
  await save();
  for (const [k, t] of tests.entries()) {
    if (ABORT) break;
    const r = report.tests[k];
    r.status = "running"; r.t0 = Date.now(); await save();
    const log = (o) => { Object.assign(r, o); save(); };
    try { r.status = (await runCreate(t, ctx, log)) ? "pass" : "fail"; }
    catch (e) { r.status = "error"; r.error = e.message; }
    r.seconds = (Date.now() - r.t0) / 1000;
    await save();
  }
  report.finished = new Date().toISOString();
  await save();
  return report;
}
