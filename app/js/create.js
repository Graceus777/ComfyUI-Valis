// Create, as data: the director's panel turned into the keyframe prompt, the motion prompt and the graphs that shoot it.
// The Create tab, the end-to-end test (selftest.js) and the CLI all call these, so what a test renders is exactly what
// the button renders.
import * as G from "./graphs.js";
import * as P from "./presets.js";
import {PALETTES} from "./palettes.js";

const cap = (s) => s ? s[0].toUpperCase() + s.slice(1) : "";
const sentence = (s) => { s = (s || "").trim(); return s ? cap(s).replace(/[.\s]*$/, ".") : ""; };
export const pick = (list, id) => (typeof id === "string" ? list.find(x => x.id === id) : id) || null;
const chosen = (x) => x && x.id !== "auto" ? x : null;          // a choice of the user's (not "from genre")

// ---------------------------------------------------------------------------------------------------------- sizes
// Keyframes are made at the model's own size for the aspect; the shot can be smaller (faster) or larger.
export const KEY_SIZES = {"9:16": {w: 768, h: 1344}, "16:9": {w: 1344, h: 768}, "1:1": {w: 1024, h: 1024}};
export const NATIVE_SHORT = 768;               // H3 was trained around 768 px on the short side
const r32 = (x) => Math.max(32, Math.round(x / 32) * 32);
export function shotSize(aspect = "9:16", short = NATIVE_SHORT) {
  const a = KEY_SIZES[aspect] || KEY_SIZES["9:16"];
  const s = r32(short), l = r32(s * Math.max(a.w, a.h) / Math.min(a.w, a.h));
  return a.w < a.h ? {w: s, h: l} : a.w > a.h ? {w: l, h: s} : {w: s, h: s};
}
// H3 renders 17k+5 frames at 24 fps; its training covers ~124-362 frames (5.2-15 s)
export const frames = (seconds) => G.frames24(seconds);
export const secondsOf = (n) => n / 24;
export const TRAINED_FRAMES = [124, 362];

// ---------------------------------------------------------------------------------------------------------- the look
// C.look: {id} a palette by name, or {id, hex: ["#..", ...]} that palette with your own colours (base "custom" = only them)
export function lookOf(C) {
  const l = C.look || {id: "auto"};
  const base = PALETTES.find(p => p.id === l.id) || null;
  return {id: l.id, base, hex: l.hex && l.hex.length >= 2 ? l.hex : null};
}
// words for a set of colours, by nearest name (Krea reads names, not HEX)
const NAMED = [["black", 8, 8, 10], ["charcoal", 40, 40, 44], ["midnight blue", 16, 28, 46], ["dark plum", 50, 20, 45],
  ["slate grey", 90, 98, 110], ["silver", 190, 192, 198], ["white", 245, 245, 242],
  ["cream", 242, 228, 200], ["ivory", 236, 232, 214], ["beige", 214, 196, 160], ["sand", 200, 170, 120], ["ochre", 196, 140, 50], ["mustard", 200, 160, 40],
  ["gold", 222, 178, 60], ["amber", 240, 150, 30], ["orange", 240, 120, 40], ["burnt orange", 200, 90, 30], ["rust", 160, 70, 40], ["brown", 110, 70, 40],
  ["dark brown", 60, 38, 24], ["red", 210, 40, 40], ["crimson", 160, 20, 40], ["burgundy", 100, 20, 36], ["pink", 240, 150, 180], ["hot pink", 240, 60, 150],
  ["magenta", 210, 40, 200], ["purple", 120, 50, 160], ["violet", 150, 110, 220], ["deep purple", 60, 20, 80], ["navy", 20, 30, 80], ["deep blue", 20, 40, 120],
  ["blue", 40, 90, 210], ["sky blue", 130, 190, 240], ["steel blue", 70, 110, 150], ["teal", 20, 120, 130], ["deep teal", 10, 60, 70], ["cyan", 40, 200, 220],
  ["turquoise", 60, 200, 180], ["mint", 160, 230, 190], ["green", 50, 150, 60], ["olive", 110, 110, 40], ["forest green", 30, 70, 40], ["lime", 170, 220, 50],
  ["sage", 150, 170, 130], ["peach", 250, 190, 150], ["salmon", 240, 128, 110], ["lavender", 200, 180, 230]];
export function colourName(hex) {
  const c = hex.replace("#", ""), r = parseInt(c.slice(0, 2), 16), g = parseInt(c.slice(2, 4), 16), b = parseInt(c.slice(4, 6), 16);
  let best = NAMED[0], d = 1e9;
  for (const n of NAMED) { const e = 2 * (n[1] - r) ** 2 + 4 * (n[2] - g) ** 2 + 3 * (n[3] - b) ** 2; if (e < d) { d = e; best = n; } }
  return best[0];
}
export function lookWords(C) {
  const {base, hex, id} = lookOf(C);
  if (hex) {
    const names = [...new Set(hex.map(colourName))];
    const own = `a colour palette of ${names.slice(0, -1).join(", ")}${names.length > 1 ? " and " : ""}${names[names.length - 1]}`;
    return base && base.words && id !== "custom" ? `${base.words}, ${own}` : own;
  }
  return base?.words || "";
}
// what grades the finished shot (ValisColorPalette): null, a look's name, or {look, hex}
export function gradeOf(C) {
  if (!C.gradeShot) return null;
  const {id, base, hex} = lookOf(C);
  if (hex) return {look: base && id !== "custom" && id !== "natural" && id !== "auto" ? id : "custom", hex: hex.join(", ")};
  return base && id !== "natural" ? id : null;
}

// ---------------------------------------------------------------------------------------------------------- prompts
// C: {genre, framing, focal, light, setup, body, kit, era, emotion, tempo, move, look, subject, action}; the list
// entries are presets.js objects (or their ids).
export function normalize(C) {
  return {...C, genre: pick(P.GENRES, C.genre), framing: pick(P.FRAMING, C.framing), focal: pick(P.LENS, C.focal), light: pick(P.LIGHT, C.light),
    setup: pick(P.LIGHTING, C.setup), body: pick(P.BODIES, C.body), kit: pick(P.LENS_KITS, C.kit), era: pick(P.ERAS, C.era),
    emotion: pick(P.EMOTIONS, C.emotion), tempo: pick(P.TEMPO, C.tempo), move: pick(P.CAMERA_MOVES, C.move)};
}
// a black-and-white look (noir, silver, sepia, daguerreotype): Krea follows colour words in the genre's light over a
// "black-and-white" at the end of the prompt (the end-to-end test's IMAX + noir keyframe came out blue), so the look leads
// the prompt and the genre's coloured light is left out
export const isMono = (C) => { const {base, hex} = lookOf(C); return !hex && (base?.grade?.mono || 0) >= .5; };
// Order matters to Krea: what comes first wins. The end-to-end test showed choices at the end of the prompt being
// dropped (a VHS camcorder + 1980s keyframe came out as a 1950s film still behind the music-video genre's words), so the
// prompt leads with what you chose (the camera body and lens, then the era), then the genre, the shot, and the light
// and colour last. A black-and-white look leads everything.
export function keyframePrompt(C0) {
  const C = normalize(C0), s = P.GENRE_SLOTS[C.genre?.id] || {}, lookIsAuto = (C.look?.id || "auto") === "auto", mono = isMono(C);
  const tinted = (lookOf(C).base?.grade?.mono_tint || [1, 1, 1]).some(v => Math.abs(v - 1) > .03);
  const lead = mono ? `${lookWords(C)}, ${tinted ? "a monochrome photograph" : "a black-and-white photograph with no colour"}` : "";
  const medium = [chosen(C.body)?.words, chosen(C.kit)?.words].filter(Boolean).join(", ");
  const era = chosen(C.era) ? C.era.words : s.era || "";
  // the genre's own medium ("film still", "music video still") only when you haven't said what it was shot on
  const first = [chosen(C.body) ? "" : s.medium || (C.genre ? "" : "Cinematic film still"), s.mood].filter(Boolean).join(", ");
  const shot = `${C.framing?.words || ""} ${(C.subject || "").trim()}`.trim();
  const look = [chosen(C.light)?.words ?? (mono ? "" : s.light), C.setup?.words, C.focal?.words, chosen(C.body) ? "" : s.body, chosen(C.kit) ? "" : s.kit,
                lookIsAuto ? s.grade : mono ? "" : lookWords(C)].filter(Boolean).join(", ");
  return [lead, medium, era, first, shot, look].map(sentence).filter(Boolean).join(" ");
}
export function motionPrompt(C0) {
  const C = normalize(C0);
  const action = [(C.action || "").trim(), C.emotion?.words].filter(Boolean).join("; ");
  return [P.motionPrompt({genre: C.genre, move: C.move, action}), C.tempo?.words].filter(Boolean).join(" ");
}

// ---------------------------------------------------------------------------------------------------------- graphs
export function keyframesGraph(C, {seeds = [7101, 7202], prefix = `valis/key_${Date.now().toString(36)}`} = {}) {
  const k = KEY_SIZES[C.aspect] || KEY_SIZES["9:16"];
  return G.keyframes({prompt: keyframePrompt(C), width: k.w, height: k.h, seeds, prefix});
}

// The shot, as the Shoot button decides it. env: {hasNode(name), hasLora(name)} (installed checks, async).
// C also carries: image (the picked keyframe, an input/output ref), who, opts {trained, anchor, trim, loop, loopEngine,
// lightChange}, relit (ref of the picked keyframe relit, or null), short (shot short side), seconds, seed.
// Returns {graph, label, notes: [things to tell the user], kind, seconds, width, height}.
export async function planShot(C0, env) {
  const C = normalize(C0), o = C.opts || {}, notes = [];
  const {w: width, h: height} = shotSize(C.aspect, C.short || NATIVE_SHORT);
  const image = C.image, look = gradeOf(C), seed = C.seed ?? 51101;
  const prefix = C.prefix || `valis/shot_${Date.now().toString(36)}`;
  const base = {width, height, kind: "h3"};
  if (!image) throw new Error("pick a keyframe first");
  // Loop: H3 renders a shot that plays forever (MiniMax H3 Loop). No camera move; the keyframe is the reference.
  if (o.loop) {
    if (!(await env.hasNode("MiniMaxH3Loop")))
      throw new Error("Loop needs the MiniMax H3 Loop pack: git clone https://github.com/pxl-pshr/ComfyUI-MiniMaxH3-Loop into custom_nodes, then restart ComfyUI");
    const length = G.loopLength(C.seconds || 4.25), engine = o.loopEngine || "fast";
    const prompt = G.loopPrompt({subject: (C.subject || "").trim(), action: (C.action || "").trim()});
    return {...base, kind: "loop", seconds: (length - 5) / 24, notes,
      graph: G.loopShot({image, prompt, width, height, length, engine, look, prefix: prefix.replace("/shot_", "/loop_")}),
      label: `Loop · ${((length - 5) / 24).toFixed(2)} s (${engine === "full" ? "25 steps" : "FastH3"})`};
  }
  const tm = o.trained !== false ? P.CAMERA_LORAS[C.move?.id] : null;
  const trained = tm && (!tm.lora || await env.hasLora(tm.lora)) ? tm : null;      // lora null = H3 words + a post step
  if (tm && !trained) notes.push(`${C.move.name}: its camera LoRA isn't installed (${tm.lora}), so H3 does the move from words`);
  const who = (C.who || "").trim() || "the subject";
  const scene = [(C.subject || "").trim(), (C.action || "").trim()].filter(Boolean).join(" ");
  const mot = motionPrompt(C);
  if (trained?.orbit && trained.lora)
    return {...base, seconds: 8.8, notes, label: `Shot · ${C.move.name} (trained, full turn)`,
      graph: G.orbit360({image, loras: [{name: trained.lora, strength: trained.strength}], raw: trained.raw({subject: who, scene}), width, height, look, seed, prefix})};
  if (trained?.engine === "wan") {
    // Wan 2.2 works on a 16 px grid at 16 fps; its LoRAs were trained near 720p
    return {...base, kind: "wan", seconds: C.seconds || 5, notes, label: `Shot · ${C.move.name} (trained, Wan 2.2)`,
      graph: G.wanMove({image, move: trained, strength: trained.strength, subject: who, scene, width, height, seconds: C.seconds || 5, look, seed, prefix})};
  }
  const lightLast = o.lightChange && C.relit ? C.relit : null;
  if (o.lightChange && !lightLast) notes.push("Light change needs the picked keyframe relit first: shooting without it");
  const end = trained ? (trained.end || null) : o.anchor ? (P.END_ANCHORS[C.move?.id] || null) : null;
  const seconds = trained ? C.seconds : Math.max(C.seconds, P.MOVE_SECONDS[C.move?.id] || 0);
  if (seconds > C.seconds) notes.push(`${C.move.name} needs ${seconds} s to complete`);
  const trimHold = !!end && !trained && o.trim !== false && await env.hasNode("ValisTrimHold");
  let dolly = null;
  if (trained?.dolly) {
    if (await env.hasNode("ValisDollyZoom")) dolly = {target: who.replace(/^(the|a|an)\s+/i, "").replace(/^subject$/i, "person"), ...trained.dolly};
    else notes.push("Valis Dolly Zoom isn't loaded yet (restart ComfyUI): shooting the plain move");
  }
  let whip = null;
  if (trained?.whip) {
    if (await env.hasNode("ValisWhipPan")) whip = trained.whip;
    else notes.push("Valis Whip Pan isn't loaded yet (restart ComfyUI): shooting the plain pan");
  }
  const motion = trained?.words && C.move?.words ? mot.replace(C.move.words, trained.words.replaceAll("{subject}", who)) : mot;
  const secs = whip ? Math.max(seconds, 5) : seconds;
  return {...base, seconds: secs, notes,
    label: trained ? `Shot · ${C.move.name} (${trained.lora ? "trained" : whip ? "ramped" : "locked"})` : "Shot",
    graph: G.shot({image, motion, width, height, seconds: secs, seed, look, end: lightLast ? null : end, last: lightLast, trimHold: trimHold && !lightLast, dolly, whip, prefix,
                   ...(trained?.lora ? {loras: [{name: trained.lora, strength: trained.strength}], raw: trained.raw({subject: who, scene})} : {})})};
}
