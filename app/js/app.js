import * as api from "./api.js";
import * as G from "./graphs.js";
import * as P from "./presets.js";
import {PALETTES} from "./palettes.js";
import {ScoreView} from "./score.js";
import {FxView} from "./fx.js";
import {checkSetup} from "./check.js";
import {planFilm, makeFilm} from "./film.js";
import * as R from "./refengine.js";

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const h = (tag, attrs = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") el.className = v; else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "style") el.style.cssText = v; else if (v !== false && v != null) el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of kids.flat()) if (c != null) el.append(c.nodeType ? c : document.createTextNode(c));
  return el;
};
const ASSETS = "/valis/app/assets";
const VID = /\.(mp4|webm|mov|mkv)$/i;

export function toast(msg, bad = false) {
  const t = h("div", {class: "toast" + (bad ? " bad" : "")}, msg);
  $("#toasts").append(t);
  setTimeout(() => t.remove(), bad ? 9000 : 4500);
}

// ------------------------------------------------------------------ tabs
function show(view) {
  $$(".tab").forEach(b => b.classList.toggle("on", b.dataset.view === view));
  $$(".view").forEach(v => v.classList.toggle("on", v.id === `view-${view}`));
  if (view === "renders") Renders.refresh();
  if (view === "score") Score.ensure();
  if (view === "fx") Fx.refreshClips();
  history.replaceState(null, "", `#${view}`);
}
$$(".tab").forEach(b => b.addEventListener("click", () => show(b.dataset.view)));
addEventListener("keydown", (e) => {
  if (e.target.matches("input, textarea, select")) return;
  const v = {"0": "film", "1": "create", "2": "edit", "3": "score", "4": "fx", "5": "renders", "6": "genjutsu"}[e.key];
  if (v) show(v);
});

// ------------------------------------------------------------------ widgets
function chips(el, items, onPick, initial) {
  let cur = initial ?? items[0]?.id;
  el.replaceChildren(...items.map(it => h("button", {class: "chip" + (it.id === cur ? " on" : ""), "data-id": it.id,
    onclick: () => { cur = it.id; $$(".chip", el).forEach(c => c.classList.toggle("on", c.dataset.id === cur)); onPick(it); }}, it.name)));
  onPick(items.find(i => i.id === cur));
}
function cards(el, items, onPick, initial) {
  let cur = initial;
  const thumb = (it) => it.thumb ? h("img", {src: `${ASSETS}/thumbs/${it.thumb}`, alt: "", onerror: (e) => e.target.replaceWith(ph(it))}) : ph(it);
  const ph = (it) => { const d = h("div", {class: "ph"}); const hue = [...it.id].reduce((a, c) => a + c.charCodeAt(0), 0) % 360;
    d.style.setProperty("--c1", it.c1 || `hsl(${hue} 30% 24%)`); d.style.setProperty("--c2", it.c2 || `hsl(${(hue + 40) % 360} 30% 7%)`); return d; };
  el.replaceChildren(...items.map(it => h("div", {class: "card" + (it.id === cur ? " on" : ""), "data-id": it.id,
    onclick: () => { cur = it.id; $$(".card", el).forEach(c => c.classList.toggle("on", c.dataset.id === cur)); onPick(it); }},
    thumb(it), h("div", {class: "lbl"}, it.name))));
  if (cur) onPick(items.find(i => i.id === cur));
}
function seg(el, items, onPick, initial) {
  let cur = initial ?? items[0].id;
  el.replaceChildren(...items.map(it => h("button", {class: it.id === cur ? "on" : "", "data-id": it.id,
    onclick: () => { cur = it.id; $$("button", el).forEach(b => b.classList.toggle("on", b.dataset.id === cur)); onPick(it); }}, it.name || it.id)));
  onPick(items.find(i => i.id === cur));
}
function dropzone(el, accept, onFile) {
  const input = h("input", {type: "file", accept, style: "display:none"});
  el._input = input;
  el.append(input);
  el.addEventListener("click", () => input.click());
  input.addEventListener("change", () => input.files[0] && onFile(input.files[0]));
  el.addEventListener("dragover", (e) => { e.preventDefault(); el.classList.add("over"); });
  el.addEventListener("dragleave", () => el.classList.remove("over"));
  el.addEventListener("drop", (e) => { e.preventDefault(); el.classList.remove("over"); const f = e.dataTransfer.files[0]; if (f) onFile(f); });
}
// show what was dropped, keeping the zone's file input so it can be clicked again
function fillDrop(el, ...kids) { el.replaceChildren(...kids, ...(el._input ? [el._input] : [])); }
function media(f, {controls = true, autoplay = true} = {}) {
  const url = typeof f === "string" ? f : api.viewUrl(f);
  return /\.(mp4|webm|mov)(\?|$)/i.test(typeof f === "string" ? f : f.filename)
    ? h("video", {src: url, controls, autoplay, loop: true, muted: autoplay, playsinline: true})
    : h("img", {src: url, alt: ""});
}
function progressFor(job, el) {
  const bar = h("i");
  el.replaceChildren(h("div", {class: "empty"}, h("b", {}, job.label), h("span", {class: "jobtxt"}, "queued"), h("div", {class: "prog", style: "width:260px;margin:12px auto 0"}, bar)));
  return (j) => {
    bar.style.width = `${Math.round(100 * (j.frac ?? (j.value || 0) / (j.max || 1)))}%`;
    const t = el.querySelector(".jobtxt");
    if (t) t.textContent = j.status !== "running" ? j.status : j.steps ? `rendering · step ${j.step}/${j.steps}` : `rendering · ${Math.round(100 * (j.frac || 0))}%`;
  };
}
const waiters = new Map();          // prompt_id -> callback(job) on every update
api.on((ev) => {
  if (ev.type === "job") {
    const w = waiters.get(ev.job.id);
    if (w) w(ev.job);
    Renders.onJob(ev.job);
  }
  if (ev.type === "connection") { $("#conn").classList.toggle("up", ev.up); $("#connText").textContent = ev.up ? "ComfyUI connected" : "ComfyUI offline"; }
  if (ev.type === "status") $("#queuePill").textContent = `queue ${ev.queue}`;
});
function run(graph, label, viewer, {onDone, kind} = {}) {
  return api.submit(graph, label, kind).then((job) => {
    const upd = viewer ? progressFor(job, viewer) : () => {};
    waiters.set(job.id, (j) => {
      upd(j);
      if (j.status === "done") { waiters.delete(j.id); onDone?.(j); }
      if (j.status === "error") { waiters.delete(j.id); toast(`${label} failed: ${j.error}`, true); }
    });
    toast(`${label} queued`);
    return job;
  }).catch((e) => toast(e.message, true));
}

// ------------------------------------------------------------------ finish bar: Extend / Lead-in / Upscale any result
function videoMeta(url) {
  return new Promise((res, rej) => { const v = document.createElement("video"); v.preload = "metadata"; v.muted = true;
    v.onloadedmetadata = () => res({w: v.videoWidth, h: v.videoHeight, s: v.duration}); v.onerror = () => rej(new Error("can't read the video")); v.src = url; });
}
function finishBar(el, f, viewer, strip) {
  if (!f || !VID.test(f.filename)) { el.replaceChildren(); return; }
  const go = async (kind) => {
    try {
      const m = await videoMeta(api.viewUrl(f));
      const r32 = (x) => Math.max(32, Math.round(x / 32) * 32);
      const tag = Date.now().toString(36);
      const action = kind === "upscale" ? "" : (what.value.trim() || "the action continues naturally");
      const g = kind === "upscale" ? G.upscale({video: api.outputRef(f), prefix: `valis/upscale_${tag}`})
        : G.extend({video: api.outputRef(f), clipSeconds: m.s, width: r32(m.w), height: r32(m.h), action, direction: kind, prefix: `valis/extend_${tag}`});
      run(g, kind === "upscale" ? "Upscale" : kind === "forward" ? "Extend" : "Lead-in", viewer, {onDone: (j) => {
        const vids = j.outputs.filter(o => VID.test(o.filename) && !/_part_/.test(o.filename));
        if (vids[0]) { viewer.replaceChildren(media(vids[0])); finishBar(el, vids[0], viewer, strip); }
        strip?.prepend(...vids.map(v => { const t = h("div", {class: "thumb"}, media(v, {controls: false}), h("div", {class: "meta"}, kind)); t.onclick = () => { viewer.replaceChildren(media(v)); finishBar(el, v, viewer, strip); }; return t; }));
      }});
    } catch (e) { toast(e.message, true); }
  };
  const what = h("input", {type: "text", placeholder: "for Extend / Lead-in: what happens next (or just before)"});
  el.replaceChildren(what,
    h("button", {class: "btn", onclick: () => go("backward")}, "← Lead-in", h("span", {class: "sub"}, "+5 s before")),
    h("button", {class: "btn", onclick: () => go("forward")}, "Extend →", h("span", {class: "sub"}, "+5 s after")),
    h("button", {class: "btn", onclick: () => go("upscale")}, "Upscale", h("span", {class: "sub"}, "SeedVR2 · 1080p")));
}

// ------------------------------------------------------------------ CREATE
const C = {genre: null, framing: null, lens: null, light: null, grade: null, move: null, body: null, kit: null, era: null, setup: null, emotion: null, tempo: null, palette: null, aspect: P.ASPECTS[0], seconds: 4.46, character: null, picked: null, keys: []};
cards($("#c-genre"), P.GENRES, (g) => { C.genre = g; promptsPreview(); }, "gothic");
chips($("#c-framing"), P.FRAMING, (x) => { C.framing = x; promptsPreview(); }, "wide");
chips($("#c-lens"), P.LENS, (x) => { C.lens = x; promptsPreview(); }, "35");
chips($("#c-light"), P.LIGHT, (x) => { C.light = x; promptsPreview(); }, "moon");
chips($("#c-grade"), P.GRADE, (x) => { C.grade = x; promptsPreview(); }, "none");
chips($("#c-move"), P.CAMERA_MOVES, (x) => { C.move = x; promptsPreview(); }, "push_in");
chips($("#c-body"), P.BODIES, (x) => { C.body = x; promptsPreview(); }, "digital");
chips($("#c-kit"), P.LENS_KITS, (x) => { C.kit = x; promptsPreview(); }, "spherical");
chips($("#c-era"), P.ERAS, (x) => { C.era = x; promptsPreview(); }, "today");
chips($("#c-setup"), P.LIGHTING, (x) => { C.setup = x; promptsPreview(); }, "auto");
chips($("#c-emotion"), P.EMOTIONS, (x) => { C.emotion = x; promptsPreview(); }, "neutral");
chips($("#c-tempo"), P.TEMPO, (x) => { C.tempo = x; promptsPreview(); }, "single");
chips($("#c-palette"), PALETTES, (x) => { C.palette = x; promptsPreview(); }, "natural");
seg($("#c-aspect"), P.ASPECTS.map(a => ({...a, name: a.id})), (a) => { C.aspect = a; });
const LENGTHS = [{id: "4bars", name: "4 bars", s: 107 / 24}, {id: "5s", name: "5 s", s: 5.0}, {id: "10s", name: "10 s", s: 10.0}];
seg($("#c-length"), LENGTHS, (l) => { C.seconds = l.s; $("#c-length-hint").textContent = l.id === "4bars" ? "4 bars of 3/4 at 161.5 BPM: one shot lands exactly on the score's bar lines." : `${G.frames24(l.s)} frames at 24 fps.`; });
dropzone($("#c-char"), "image/*", async (f) => {
  try { const u = await api.upload(f); C.character = api.inputRef(u);
    fillDrop($("#c-char"), h("img", {src: URL.createObjectURL(f)}), h("span", {}, f.name)); toast("Character ready"); }
  catch (e) { toast(e.message, true); }
});
["#c-subject", "#c-action"].forEach(s => $(s).addEventListener("input", promptsPreview));
function promptsPreview() {
  // the director's panel and the Cinema Studio controls: body, lens kit, era, lighting setup and palette go in the
  // keyframe; the move, the emotion and the tempo go in the motion prompt
  const extra = [C.body?.words, C.kit?.words, C.setup?.words, C.palette?.words].filter(Boolean).join(", ");
  const era = C.era?.words ? C.era.words[0].toUpperCase() + C.era.words.slice(1) + "." : "";
  const key = [P.keyframePrompt({...C, subject: $("#c-subject").value.trim()}), era, extra ? extra[0].toUpperCase() + extra.slice(1) + "." : ""].filter(Boolean).join(" ");
  const action = [$("#c-action").value.trim(), C.emotion?.words].filter(Boolean).join("; ");
  const mot = [P.motionPrompt({genre: C.genre, move: C.move, action}), C.tempo?.words].filter(Boolean).join(" ");
  $("#c-prompts").textContent = `KEYFRAME (Krea 2)\n${key}\n\nMOTION (MiniMax H3)\n${mot}`;
  return {key, mot};
}
// Relight a keyframe (Qwen Image edit); with "light change" the shot runs from the keyframe to its relit version.
const RL = $("#c-relight");
RL.replaceChildren(...P.RELIGHT.map(r => h("option", {value: r.id}, r.name)));
$("#c-relight-go").addEventListener("click", () => {
  if (!C.picked) return toast("Frame it first, then pick a keyframe", true);
  const r = P.RELIGHT.find(x => x.id === RL.value), orig = C.picked, tag = Date.now().toString(36);
  run(G.relightImage({image: api.outputRef(orig), prompt: `Relight this photo: ${r.words}.${P.RELIGHT_KEEP}`, prefix: `valis/relight_${tag}`}),
      `Relight · ${r.name}`, null, {onDone: (j) => j.outputs.filter(o => /\.(png|jpg|webp)$/i.test(o.filename)).forEach(o => {
        C.relit = {orig, relit: o, name: r.name};
        const t = h("div", {class: "thumb"}, media(o), h("div", {class: "meta"}, `relit · ${r.name}`));
        t.onclick = () => pickKey(o, t); $("#c-strip").append(t);
        toast(`Relit (${r.name}). Pick it to shoot in the new light, or keep the original picked and tick "light change"`);
      })});
});
function pickKey(f, el) {
  C.picked = f;
  $("#c-relight-go").disabled = false;
  $$(".thumb", $("#c-strip")).forEach(t => t.classList.toggle("on", t === el));
  $("#c-viewer").replaceChildren(media(f));
  $("#c-shoot").disabled = false;
}
$("#c-frame").addEventListener("click", () => {
  const {key} = promptsPreview();
  if (!$("#c-subject").value.trim()) return toast("Describe the shot first", true);
  const tag = Date.now().toString(36);
  run(G.keyframes({prompt: key, width: C.aspect.w, height: C.aspect.h, prefix: `valis/key_${tag}`}), "Keyframes", $("#c-viewer"), {onDone: (j) => {
    const imgs = j.outputs.filter(f => /\.(png|jpg|webp)$/i.test(f.filename));
    C.keys = imgs;
    $("#c-strip").replaceChildren(...imgs.map(f => { const t = h("div", {class: "thumb"}, media(f), h("div", {class: "meta"}, "keyframe")); t.onclick = () => pickKey(f, t); return t; }));
    if (imgs[0]) pickKey(imgs[0], $("#c-strip .thumb"));
    const who = $("#c-who").value.trim() || "the person";
    if (C.character) imgs.forEach((f, k) => run(G.castCharacter({keyframe: api.outputRef(f), character: C.character, refBoost: 0.5,
      prompt: `Turn ${who} into the character from the second image: the same face, hair, skin and outfit as the reference. Keep ${who}'s pose and position, everyone else, the framing, the room and the lighting exactly the same.`,
      prefix: `valis/cast_${tag}_${k}`}), "Cast character", null, {onDone: (jj) => jj.outputs.forEach(o => {
        const t = h("div", {class: "thumb"}, media(o), h("div", {class: "meta"}, "with character")); t.onclick = () => pickKey(o, t); $("#c-strip").append(t); })}));
  }});
});
$("#c-shoot").addEventListener("click", async () => {
  if (!C.picked) return;
  const {mot} = promptsPreview();
  const look = $("#c-grade-shot").checked && C.palette && C.palette.id !== "natural" ? C.palette.id : null;
  const prefix = `valis/shot_${Date.now().toString(36)}`;
  const image = api.outputRef(C.picked), width = C.aspect.w, height = C.aspect.h;
  const onDone = (j) => {
    const v = j.outputs.find(f => VID.test(f.filename));
    if (v) { $("#c-viewer").replaceChildren(media(v)); finishBar($("#c-finish"), v, $("#c-viewer"), $("#c-strip"));
      const t = h("div", {class: "thumb"}, media(v, {controls: false}), h("div", {class: "meta"}, "shot")); t.onclick = () => { $("#c-viewer").replaceChildren(media(v)); finishBar($("#c-finish"), v, $("#c-viewer"), $("#c-strip")); }; $("#c-strip").prepend(t); }
  };
  // a trained move (camera LoRA) when one is installed for this move; otherwise H3 from words, with an optional end anchor
  const tm = $("#c-trained").checked ? P.CAMERA_LORAS[C.move?.id] : null;
  const trained = tm && (!tm.lora || await api.hasLora(tm.lora)) ? tm : null;     // lora: null = H3 words + a post step (dolly lock, whip ramp)
  const who = $("#c-who").value.trim() || "the subject";
  const scene = [$("#c-subject").value.trim(), $("#c-action").value.trim()].filter(Boolean).join(" ");
  if (trained?.engine === "wan")
    return run(G.wanMove({image, move: trained, strength: trained.strength, subject: who, scene, width, height, look, prefix}),
               `Shot · ${C.move.name} (trained, Wan 2.2)`, $("#c-viewer"), {onDone});
  // light change: the relit version of the picked keyframe is pinned as the last frame (H3 runs between the two lights)
  const lightLast = $("#c-lightchange").checked && C.relit && C.relit.orig === C.picked ? api.outputRef(C.relit.relit) : null;
  if ($("#c-lightchange").checked && !lightLast) toast("Light change needs the picked keyframe relit first: shooting without it");
  const end = trained ? (trained.end || null) : $("#c-anchor").checked ? (P.END_ANCHORS[C.move?.id] || null) : null;
  const seconds = trained ? C.seconds : Math.max(C.seconds, P.MOVE_SECONDS[C.move?.id] || 0);
  if (seconds > C.seconds) toast(`${C.move.name} needs ${seconds} s to complete`);
  const trimHold = !!end && !trained && $("#c-trim").checked && await api.hasNode("ValisTrimHold");
  // dolly zoom: a real push or pull, then the subject is locked to one size (SAM 3 finds them by the words in "who")
  let dolly = null;
  if (trained?.dolly) {
    if (await api.hasNode("ValisDollyZoom")) dolly = {target: who.replace(/^(the|a|an)\s+/i, "").replace(/^subject$/i, "person"), ...trained.dolly};
    else toast("Valis Dolly Zoom isn't loaded yet (restart ComfyUI): shooting the plain move");
  }
  // whip pan: a steady real pan, speed-ramped into a whip afterwards (the model can't whip without dissolving)
  let whip = null;
  if (trained?.whip) {
    if (await api.hasNode("ValisWhipPan")) whip = trained.whip;
    else toast("Valis Whip Pan isn't loaded yet (restart ComfyUI): shooting the plain pan");
  }
  const motion = trained?.words && C.move?.words ? mot.replace(C.move.words, trained.words.replaceAll("{subject}", who)) : mot;
  run(G.shot({image, motion, width, height, seconds: whip ? Math.max(seconds, 5) : seconds, look, end: lightLast ? null : end, last: lightLast, trimHold: trimHold && !lightLast, dolly, whip, prefix,
              ...(trained?.lora ? {loras: [{name: trained.lora, strength: trained.strength}], raw: trained.raw({subject: who, scene})} : {})}),
      trained ? `Shot · ${C.move.name} (${trained.lora ? "trained" : whip ? "ramped" : "locked"})` : "Shot", $("#c-viewer"), {onDone});
});

// ------------------------------------------------------------------ GENJUTSU
const GJ = {clip: null, clipUrl: null, mode: "motion", refs: [], style: null, seconds: 5, mp: 0.4, aspect: "9:16 (Portrait Widescreen)",
            window: null};   // window: {start, duration} picked from the source check
seg($("#g-mode"), [{id: "motion", name: "Motion transfer"}, {id: "restyle", name: "Restyle"}, {id: "swap", name: "Object swap"}], (m) => {
  GJ.mode = m.id;
  $("#g-styles-wrap").style.display = m.id === "restyle" ? "" : "none";
  $("#g-target-wrap").style.display = m.id === "swap" ? "" : "none";
  gjPrompt();
});
chips($("#g-styles"), P.GENJUTSU_STYLES, (x) => { GJ.style = x; gjPrompt(); }, "clay");
seg($("#g-len"), [{id: "5", name: "5 s", s: 5}, {id: "10", name: "10 s", s: 10}, {id: "15", name: "15 s", s: 15}], (l) => { GJ.seconds = l.s; });
seg($("#g-size"), [{id: "480", name: "480p", mp: 0.4}, {id: "576", name: "576p", mp: 0.5625}], (x) => { GJ.mp = x.mp; });
seg($("#g-aspect"), [{id: "9:16 (Portrait Widescreen)", name: "9:16"}, {id: "16:9 (Widescreen)", name: "16:9"}, {id: "1:1 (Square)", name: "1:1"}], (x) => { GJ.aspect = x.id; });
function gjRefs() {
  const slots = GJ.refs.map((r, i) => h("div", {class: "ref"}, h("img", {src: r.url, alt: ""}),
    h("select", {onchange: (e) => { r.role = e.target.value; gjPrompt(); }}, ...P.GENJUTSU_ROLES.map(x => h("option", {value: x, selected: x === r.role}, x))),
    h("button", {class: "x", onclick: () => { GJ.refs.splice(i, 1); gjRefs(); gjPrompt(); }}, "×")));
  const add = h("div", {class: "drop small"}, GJ.refs.length < 8 ? "+ image" : "8 images max");
  if (GJ.refs.length < 8) dropzone(add, "image/*", async (f) => {
    try { const u = await api.upload(f); GJ.refs.push({ref: api.inputRef(u), url: URL.createObjectURL(f), role: GJ.refs.length ? "location" : "character"}); gjRefs(); gjPrompt(); }
    catch (e) { toast(e.message, true); }
  });
  $("#g-refs").replaceChildren(...slots, add);
}
gjRefs();
function gjPrompt() {
  $("#g-prompt").value = P.genjutsuPrompt({mode: GJ.mode, refs: GJ.refs, style: GJ.style, target: $("#g-target").value.trim(), text: ""});
}
$("#g-target").addEventListener("input", gjPrompt);
dropzone($("#g-clip"), "video/*", async (f) => {
  try {
    const u = await api.upload(f); GJ.clip = api.inputRef(u); GJ.clipUrl = URL.createObjectURL(f);
    fillDrop($("#g-clip"), h("video", {src: GJ.clipUrl, muted: true, autoplay: true, loop: true, playsinline: true}), h("span", {}, f.name));
    $("#g-viewer").replaceChildren(h("video", {src: GJ.clipUrl, controls: true, autoplay: true, loop: true, muted: true, playsinline: true}));
    $("#g-run").disabled = false; $("#g-check").disabled = false;
    GJ.window = null; $("#g-report").replaceChildren();
  } catch (e) { toast(e.message, true); }
});
// Source check: only the pose step (~1 min). Motion Transfer sees nothing but this skeleton, so a clip where the body
// can't be read (hidden legs, a spin, leaving the frame) warps; find that out before a 20-minute render.
$("#g-check").addEventListener("click", async () => {
  if (!GJ.clip) return toast("Drop a video first", true);
  if (!(await api.hasNode("ValisPoseCheck"))) return toast("Valis Pose Check isn't loaded yet (restart ComfyUI)", true);
  $("#g-report").replaceChildren(h("span", {}, "Reading the body in every frame…"));
  run(G.poseCheck({video: GJ.clip, seconds: 15, prefix: `valis/posecheck_${Date.now().toString(36)}`}), "Source check", null, {onDone: async (j) => {
    const repF = j.outputs.find(o => /\.json$/i.test(o.filename)), tl = j.outputs.find(o => /_timeline/.test(o.filename)),
          sk = j.outputs.find(o => VID.test(o.filename));
    if (sk) $("#g-viewer").replaceChildren(media(sk));
    let rep = null;
    try { rep = await (await fetch(api.viewUrl(repF))).json(); } catch (e) { return toast("Couldn't read the check's report", true); }
    const cls = rep.verdict === "good" ? "good" : rep.verdict === "risky" ? "risky" : "window";
    const bw = rep.best_window || {};
    const use = h("button", {class: "btn", onclick: () => {
      GJ.window = {start: bw.start, duration: bw.duration};
      toast(`Rendering ${bw.duration.toFixed(1)} s from ${bw.start.toFixed(1)} s`);
    }}, `Use the best window`, h("span", {class: "sub"}, `${bw.start?.toFixed(1)}–${(bw.start + bw.duration).toFixed(1)} s`));
    $("#g-report").replaceChildren(
      h("div", {}, h("span", {class: `verdict ${cls}`}, rep.verdict === "good" ? "Readable" : rep.verdict === "risky" ? "Risky" : "Use a window"), rep.summary),
      tl ? h("img", {src: api.viewUrl(tl), alt: "per-frame timeline"}) : "",
      h("div", {class: "lanes"}, "top: each frame, green readable to red not · lanes: no body, cut off, legs hidden, facing unclear, left/right swaps, false limbs · white bar: best window"),
      rep.verdict !== "good" && bw.duration >= 2 ? use : "");
  }});
});
$("#g-run").addEventListener("click", async () => {
  if (!GJ.clip) return toast("Drop a video first", true);
  if (GJ.mode === "motion" && !GJ.refs.length) return toast("Add at least one reference: the new character", true);
  if (GJ.mode === "swap" && !$("#g-target").value.trim()) return toast("Name what to swap", true);
  if (GJ.mode === "swap" && !GJ.refs.length && !$("#g-prompt").value.trim()) return toast("Describe the replacement, or add an image of it", true);
  const tag = Date.now().toString(36);
  const g = G.genjutsu({video: GJ.clip, refs: GJ.refs.map(r => r.ref), prompt: $("#g-prompt").value.trim(), mode: GJ.mode,
    seconds: GJ.window ? GJ.window.duration : GJ.seconds, start: GJ.window ? GJ.window.start : 0, megapixels: GJ.mp, aspect: GJ.aspect, keepAudio: $("#g-audio").checked, turbo: $("#g-turbo").checked,
    target: $("#g-target").value.trim(), keepRest: $("#g-keep").checked, batchedCanny: await api.hasNode("ValisCanny"),
    ...(GJ.mode === "swap" ? {control: $("#g-edges").checked ? "canny" : "pose"} : {}), prefix: `valis/genjutsu_${GJ.mode}_${tag}`,
    // the swap's inpaint needs ControlNet Union 2.0 (holes at mid-grey); v1 paints the masked object black
    ...(GJ.mode === "swap" && await api.hasModelPatch(G.MODELS.funCN2) ? {cn: G.MODELS.funCN2} : {})});
  if (GJ.mode === "swap" && !(await api.hasModelPatch(G.MODELS.funCN2))) toast("Object Swap works best with Fun ControlNet Union 2.0 (models/model_patches): v1 tends to paint the object black");
  $("#g-graph").textContent = JSON.stringify(g, null, 1);
  run(g, `Genjutsu · ${GJ.mode}`, $("#g-viewer"), {onDone: (j) => {
    const vids = j.outputs.filter(f => VID.test(f.filename));
    const main = vids.find(f => !/_control_/.test(f.filename)) || vids[0];
    if (main) { $("#g-viewer").replaceChildren(media(main)); finishBar($("#g-finish"), main, $("#g-viewer"), $("#g-strip")); }
    $("#g-strip").prepend(...vids.map(v => { const t = h("div", {class: "thumb"}, media(v, {controls: false}), h("div", {class: "meta"}, /_control_/.test(v.filename) ? "control" : GJ.mode)); t.onclick = () => $("#g-viewer").replaceChildren(media(v)); return t; }));
  }});
});

// ------------------------------------------------------------------ EDIT
const E = {clip: null, clipUrl: null, mode: "transform", look: null, character: null, matte: null, bg: null, clipB: null, clipBUrl: null, swapAt: -1, wave: null};
const EXAMPLES = ["the man", "his head", "her dress", "the woman", "man in the mirror", "the sky", "the car"];
$("#e-target-ex").replaceChildren(...EXAMPLES.map(t => h("button", {class: "chip", onclick: () => { $("#e-target").value = t; refreshPrompt(); }}, t)));
seg($("#e-mode"), [{id: "transform", name: "Transform"}, {id: "remove", name: "Remove"}, {id: "swap", name: "Swap"}, {id: "turn", name: "Turn"}], (m) => {
  E.mode = m.id;
  $("#e-looks-wrap").style.display = m.id === "transform" ? "" : "none";
  $("#e-swap-wrap").style.display = m.id === "swap" ? "" : "none";
  $("#e-turn-wrap").style.display = m.id === "turn" ? "" : "none";
  $("#e-controls").style.display = ["swap", "turn"].includes(m.id) ? "none" : "";
  $("#e-find").style.display = m.id === "turn" ? "none" : "";
  $("#e-prompt").style.display = m.id === "turn" ? "none" : "";
  $("#e-prompt").previousElementSibling.style.display = m.id === "turn" ? "none" : "";
  $("#e-render .sub").textContent = {transform: "H3 masked · ~12 min", remove: "H3 masked · ~12 min", swap: "H3 character swap, turbo · ~15 min", turn: "Valis · ~2 min"}[m.id];
  if (m.id === "turn") { fillClipB(); drawWave(); }
  if (m.id === "remove") { $("#e-rb").value = 1; }
  if (m.id === "swap") { $("#e-rb").value = 0.8; }
  syncSliders(); refreshPrompt();
});
cards($("#e-looks"), P.LOOKS, (l) => { E.look = l; $("#e-rb").value = l.rb; syncSliders(); refreshPrompt(); }, "vampire");
function syncSliders() { $("#e-rb-o").textContent = Number($("#e-rb").value).toFixed(1); $("#e-grow-o").textContent = `${$("#e-grow").value} px`; }
["#e-rb", "#e-grow"].forEach(s => $(s).addEventListener("input", syncSliders));
syncSliders();
$("#e-target").addEventListener("input", refreshPrompt);
$("#e-look").addEventListener("input", refreshPrompt);
function refreshPrompt() {
  const T = $("#e-target").value.trim() || "the subject";
  let p = "";
  if (E.mode === "transform" && E.look) p = E.look.anchor.replaceAll("{T}", T);
  if (E.mode === "remove") p = P.REMOVE_PROMPT.replaceAll("{T}", T);
  if (E.mode === "swap") p = G.swapPrompt({target: T, look: $("#e-look").value.trim()});
  $("#e-prompt").value = p;
}
export function setClip(ref, url, label = "clip") {
  E.clip = ref; E.clipUrl = url;
  fillDrop($("#e-clip"), h("video", {src: url, muted: true, autoplay: true, loop: true, playsinline: true}), h("span", {}, label));
  $("#e-viewer").replaceChildren(h("video", {src: url, controls: true, autoplay: true, loop: true, muted: true, playsinline: true}));
  $("#e-render").disabled = false;
  E.wave = null; E.swapAt = -1;
  if (E.mode === "turn") drawWave();
}
dropzone($("#e-bg"), "image/*", async (f) => {
  try { const u = await api.upload(f); E.bg = api.inputRef(u); fillDrop($("#e-bg"), h("img", {src: URL.createObjectURL(f)}), h("span", {}, f.name)); }
  catch (e) { toast(e.message, true); }
});
// ---- turn: the second take, and the word it turns on
async function fillClipB() {
  const hist = await api.history(80).catch(() => ({}));
  const vids = [];
  for (const e of Object.values(hist).reverse()) for (const f of api.outputsOf(e)) if (VID.test(f.filename) && !/matte|overlay|plate/.test(f.filename) && (f.type || "output") === "output") vids.push(f);
  const sel = $("#e-clipb"), keep = sel.value;
  sel.replaceChildren(h("option", {value: ""}, "pick a render…"), ...vids.slice(0, 40).map(f => h("option", {value: api.outputRef(f), "data-url": api.viewUrl(f)}, `${f.subfolder}/${f.filename}`)));
  if (keep) sel.value = keep;
}
$("#e-clipb").addEventListener("change", (e) => { const o = e.target.selectedOptions[0]; E.clipB = o.value || null; E.clipBUrl = o.dataset.url || null; });
dropzone($("#e-clipb-drop"), "video/*", async (f) => {
  try { const u = await api.upload(f); E.clipB = api.inputRef(u); E.clipBUrl = URL.createObjectURL(f);
    fillDrop($("#e-clipb-drop"), h("video", {src: E.clipBUrl, muted: true, autoplay: true, loop: true, playsinline: true}), h("span", {}, f.name)); }
  catch (e) { toast(e.message, true); }
});
// syllable onsets, the same rule as the ValisScoreFromAudio node (10 ms RMS, a 6 dB rise above -42 dB)
function onsets(ch, sr) {
  const hop = Math.round(sr * .01), win = Math.round(sr * .02), db = [];
  for (let i = 0; i + win < ch.length; i += hop) { let s = 0; for (let j = i; j < i + win; j++) s += ch[j] * ch[j]; db.push(20 * Math.log10(Math.sqrt(s / win) + 1e-9)); }
  const sm = db.map((_, i) => (db[Math.max(0, i - 1)] + db[i] + db[Math.min(db.length - 1, i + 1)]) / 3);
  const on = []; let last = -1e9;
  for (let i = 0; i < sm.length; i++) {
    if (sm[i] - sm[Math.max(0, i - 4)] > 6 && sm[i] > -42 && (i - last) * .01 > .14) {
      let j = i; for (let k = i; k < Math.min(i + 6, sm.length); k++) if (sm[k] > sm[j]) j = k;
      on.push(j * .01); last = i;
    }
  }
  return {on, sm};
}
async function drawWave() {
  const cv = $("#e-wave"); cv.width = cv.clientWidth * devicePixelRatio || 600; cv.height = 90 * devicePixelRatio;
  const x = cv.getContext("2d"); x.clearRect(0, 0, cv.width, cv.height);
  if (!E.clipUrl) { $("#e-wave-hint").textContent = "Drop the first take above."; return; }
  if (!E.wave) {
    try {
      const buf = await (await fetch(E.clipUrl)).arrayBuffer();
      const ab = await new (window.AudioContext || window.webkitAudioContext)().decodeAudioData(buf);
      const {on, sm} = onsets(ab.getChannelData(0), ab.sampleRate);
      let auto = ab.duration / 2, gap = -1;
      for (let k = 0; k + 1 < on.length; k++) if (on[k + 1] - on[k] > gap) { gap = on[k + 1] - on[k]; auto = on[k + 1] - .07; }
      E.wave = {sm, on, dur: ab.duration, auto};
    } catch (e) { $("#e-wave-hint").textContent = "This clip has no readable sound; the turn will happen halfway."; return; }
  }
  const {sm, on, dur, auto} = E.wave, W_ = cv.width, H_ = cv.height, at = E.swapAt >= 0 ? E.swapAt : auto;
  x.fillStyle = "rgba(156,194,255,.55)";
  sm.forEach((v, i) => { const a = Math.max(0, (v + 60) / 50); const px = i * .01 / dur * W_; x.fillRect(px, H_ / 2 - a * H_ * .42, Math.max(1, W_ / sm.length), a * H_ * .84); });
  x.fillStyle = "rgba(255,255,255,.35)"; on.forEach(t => x.fillRect(t / dur * W_, H_ - 8 * devicePixelRatio, 1.5 * devicePixelRatio, 8 * devicePixelRatio));
  x.fillStyle = "#ff8a4c"; x.fillRect(at / dur * W_ - devicePixelRatio, 0, 2.5 * devicePixelRatio, H_);
  $("#e-wave-hint").textContent = `Turns at ${at.toFixed(2)} s${E.swapAt < 0 ? " (auto: after the longest pause)" : ""}. Click to move it; double-click for auto.`;
}
$("#e-wave").addEventListener("click", (e) => {
  if (!E.wave) return;
  const r = e.target.getBoundingClientRect(), t = (e.clientX - r.left) / r.width * E.wave.dur;
  const near = E.wave.on.reduce((b, o) => Math.abs(o - t) < Math.abs(b - t) ? o : b, t);       // snap to the syllable
  E.swapAt = Math.max(0, (Math.abs(near - t) < .25 ? near : t) - .07); drawWave();
  const v = $("#e-viewer video"); if (v) { v.currentTime = Math.max(0, E.swapAt - .5); v.play(); }
});
$("#e-wave").addEventListener("dblclick", () => { E.swapAt = -1; drawWave(); });
dropzone($("#e-clip"), "video/*", async (f) => {
  try { const u = await api.upload(f); setClip(api.inputRef(u), URL.createObjectURL(f), f.name); }
  catch (e) { toast(e.message, true); }
});
dropzone($("#e-char"), "image/*", async (f) => {
  try { const u = await api.upload(f); E.character = api.inputRef(u); fillDrop($("#e-char"), h("img", {src: URL.createObjectURL(f)}), h("span", {}, f.name)); }
  catch (e) { toast(e.message, true); }
});
async function audioRef() { return $("#e-audio").checked ? null : await api.silenceRef(); }
$("#e-find").addEventListener("click", async () => {
  if (!E.clip) return toast("Drop a clip first", true);
  const target = $("#e-target").value.trim(); if (!target) return toast("Name what to change", true);
  run(G.maskPreview({video: E.clip, target, audio: await audioRef(), grow: Number($("#e-grow").value), prefix: `valis/find_${Date.now().toString(36)}`}),
      `Finding “${target}”`, $("#e-viewer"), {onDone: (j) => {
    const ov = j.outputs.find(f => /overlay/.test(f.filename) && VID.test(f.filename)) || j.outputs.find(f => VID.test(f.filename));
    if (ov) $("#e-viewer").replaceChildren(media(ov));
  }});
});
$("#e-render").addEventListener("click", async () => {
  if (!E.clip) return toast("Drop a clip first", true);
  const target = $("#e-target").value.trim();
  if (E.mode === "turn") {
    if (!E.clipB) return toast("Pick the take it turns into", true);
    const before = E.clipUrl;
    return run(G.turn({a: E.clip, b: E.clipB, swapAt: E.swapAt, person: target || "person", voice: $("#e-voice").checked, prefix: `valis/turn_${Date.now().toString(36)}`}),
      `Turn at ${E.swapAt >= 0 ? E.swapAt.toFixed(2) + " s" : "the pause"}`, $("#e-viewer"), {onDone: (j) => {
        const v = j.outputs.find(f => VID.test(f.filename));
        if (v) $("#e-viewer").replaceChildren(media(v));
      }});
  }
  if (!target) return toast("Name what to change", true);
  if (E.mode === "swap") {
    if (!E.character) return toast("Drop the character to swap in", true);
    const before = E.clipUrl;
    return run(G.swapFull({video: E.clip, character: E.character, prompt: $("#e-prompt").value, background: E.bg, person: target, turbo: true,
      match: $("#e-match").checked, prefix: `valis/swap_${Date.now().toString(36)}`}), `Swap “${target}”`, $("#e-viewer"), {onDone: (j) => {
        const v = j.outputs.find(f => VID.test(f.filename) && !/plate/.test(f.filename));
        if (v) $("#e-viewer").replaceChildren(compare(before, api.viewUrl(v)));
        $("#e-strip").replaceChildren(...j.outputs.filter(f => VID.test(f.filename)).map(f => h("div", {class: "thumb"}, media(f, {controls: false}), h("div", {class: "meta"}, /plate/.test(f.filename) ? "on the new background" : "swapped"))));
      }});
  }
  const look = E.mode === "transform" ? E.look : null;
  const desc = look ? look.desc : E.mode === "remove" ? `gone: only the background continues where ${target} was` : "the person from the reference image, with the same face and hair";
  const g = G.edit({mode: E.mode, video: E.clip, audio: await audioRef(), target, anchorPrompt: $("#e-prompt").value, desc,
    who: look?.who || target, keep: look?.keep || "the face and the details", refBoost: Number($("#e-rb").value), grow: Number($("#e-grow").value),
    character: E.character, prefix: `valis/edit_${Date.now().toString(36)}`});
  const before = E.clipUrl;
  run(g, `${E.mode[0].toUpperCase() + E.mode.slice(1)} “${target}”`, $("#e-viewer"), {onDone: (j) => {
    const v = j.outputs.find(f => VID.test(f.filename) && !/matte/.test(f.filename));
    if (v) $("#e-viewer").replaceChildren(compare(before, api.viewUrl(v)));
    const anchors = j.outputs.filter(f => /anchor/.test(f.filename));
    $("#e-strip").replaceChildren(...[...anchors, ...(v ? [v] : [])].map(f => h("div", {class: "thumb"}, media(f, {controls: false}), h("div", {class: "meta"}, /anchor_first/.test(f.filename) ? "first anchor" : /anchor_last/.test(f.filename) ? "last anchor" : "result"))));
  }});
});
function compare(a, b) {
  const wrap = h("div", {class: "compare"});
  const va = h("video", {src: a, autoplay: true, loop: true, muted: true, playsinline: true});
  const vb = h("video", {src: b, autoplay: true, loop: true, muted: true, playsinline: true, class: "after"});
  const bar = h("div", {class: "bar"});
  wrap.append(va, vb, bar, h("span", {class: "tag", style: "left:10px"}, "before"), h("span", {class: "tag", style: "right:10px"}, "after"));
  vb.addEventListener("loadedmetadata", () => wrap.style.setProperty("--ar", `${vb.videoWidth}/${vb.videoHeight}`));
  vb.addEventListener("play", () => { va.currentTime = vb.currentTime; va.play(); });
  const set = (x) => { const r = wrap.getBoundingClientRect(); wrap.style.setProperty("--cut", `${Math.max(0, Math.min(100, 100 * (x - r.left) / r.width))}%`); };
  let drag = false;
  wrap.addEventListener("pointerdown", (e) => { drag = true; set(e.clientX); });
  addEventListener("pointermove", (e) => drag && set(e.clientX));
  addEventListener("pointerup", () => drag = false);
  return wrap;
}

// ------------------------------------------------------------------ SCORE
const Score = new ScoreView({$, h, toast, assets: ASSETS, api, G, run});

// ------------------------------------------------------------------ FX
const Fx = new FxView({$, h, toast, assets: ASSETS, api, G, run, VID});


// ------------------------------------------------------------------ RENDERS
const Renders = {
  seen: new Set(),
  onJob(job) {
    const el = $(`[data-job="${job.id}"]`);
    const pct = Math.round(100 * (job.frac ?? (job.value || 0) / (job.max || 1)));
    const row = el || h("div", {class: "job", "data-job": job.id}, h("span", {class: "t"}), h("span", {class: "s"}), h("div", {class: "prog"}, h("i")));
    row.className = `job ${job.status}`;
    row.querySelector(".t").textContent = job.label;
    row.querySelector(".s").textContent = job.status === "running" ? `${pct}%` : job.status;
    row.querySelector(".prog i").style.width = job.status === "done" ? "100%" : `${pct}%`;
    if (!el) $("#r-queue").prepend(row);
    $("#r-queue-empty").style.display = "none";
    if (job.status === "done" && $("#view-renders").classList.contains("on")) this.refresh();
  },
  async refresh() {
    const hist = await api.history(80).catch(() => ({}));
    const items = [];
    for (const [id, e] of Object.entries(hist).reverse()) for (const f of api.outputsOf(e)) if ((f.type || "output") === "output" && /^valis|^danse/.test(f.subfolder || "")) items.push(f);
    const grid = $("#r-grid");
    grid.replaceChildren(...items.slice(0, 120).map(f => {
      const isVid = VID.test(f.filename);
      const t = h("div", {class: "thumb"}, media(f, {controls: false}), h("div", {class: "meta"}, f.filename.replace(/_\d+_\.\w+$/, "")));
      t.onclick = () => {
        if (isVid) { setClip(api.outputRef(f), api.viewUrl(f), f.filename); show("edit"); toast("Loaded into Edit"); }
        else { C.picked = f; $("#c-viewer").replaceChildren(media(f)); $("#c-shoot").disabled = false; show("create"); toast("Set as the first frame"); }
      };
      if (isVid) { const v = t.querySelector("video"); t.onmouseenter = () => v.play(); t.onmouseleave = () => v.pause(); v.muted = true; v.autoplay = false; }
      return t;
    }));
    if (!items.length) grid.replaceChildren(h("p", {class: "hint"}, "Nothing yet. Renders from the studio land in output/valis/."));
  },
};
$("#r-free").addEventListener("click", async () => { await api.free(); toast("Models unloaded and memory freed"); });
$("#r-stop").addEventListener("click", async () => { await api.interrupt(); toast("Stopped the current job"); });

async function machine() {
  const s = await api.systemStats().catch(() => null);
  if (!s?.devices) return;
  const d = s.devices[0];
  const free = (d.vram_free / 2 ** 30).toFixed(1), tot = (d.vram_total / 2 ** 30).toFixed(1);
  $("#vramPill").textContent = `VRAM ${free}/${tot} GB free`;
  $("#r-machine").innerHTML = `${d.name}<br>RAM ${(s.system.ram_free / 2 ** 30).toFixed(1)} / ${(s.system.ram_total / 2 ** 30).toFixed(1)} GB free<br>ComfyUI ${s.system.comfyui_version || ""}`;
}

async function setup() {
  const pill = $("#setupPill");
  pill.className = "pill link"; pill.textContent = "checking setup";
  let res;
  try { res = await checkSetup(); } catch (e) { pill.textContent = "setup ?"; return; }
  const names = Object.keys(res).sort((a, b) => !res[a].length - !res[b].length), bad = names.filter(n => res[n].length);
  $("#r-setup").replaceChildren(...names.map(n => {
    const issues = res[n], ok = !issues.length;
    return h("div", {class: "setrow" + (ok ? " ok" : " bad")},
      h("div", {class: "t"}, h("i", {class: "dot" + (ok ? " up" : "")}), n),
      ...issues.slice(0, 5).map(i => h("div", {class: "s"}, `${i.node}: ${i.msg}`)),
      issues.length > 5 ? h("div", {class: "s"}, `and ${issues.length - 5} more`) : null);
  }));
  pill.className = "pill link " + (bad.length ? "bad" : "ok");
  pill.textContent = bad.length ? `setup: ${bad.length} of ${names.length} need work` : "setup ready";
  if (bad.length) toast(`${bad.join(", ")}: missing pieces on this ComfyUI. See Renders, Setup.`, true);
}
$("#setupPill").addEventListener("click", () => { show("renders"); $("#r-setup").scrollIntoView({block: "start", behavior: "smooth"}); });
$("#r-check").addEventListener("click", setup);

// ---------------------------------------------------------------- ref2va engine (Renders -> Engine)
// Remembered per browser; H3 ref2va unless FastH3 is chosen. Switching back is the same select: nothing else changes.
const ENGINE_KEY = "valis.refEngine";
try { R.setRefEngine(localStorage.getItem(ENGINE_KEY) || "base"); } catch { /* storage off: default engine */ }
const GB = (b) => (b / 1e9).toFixed(1);
async function engineUI() {
  const sel = $("#r-engine"), note = $("#r-engine-note"), get = $("#r-engine-get");
  const have = await api.hasUnet(R.FAST_REF);
  if (!have && R.refEngine() === "fast") R.setRefEngine("base");
  sel.replaceChildren(...Object.entries(R.REF_ENGINES).map(([k, v]) => {
    const o = h("option", {value: k}, k === "fast" && !have ? `${v} (not downloaded)` : v);
    o.disabled = k === "fast" && !have;
    return o;
  }));
  sel.value = R.refEngine();
  get.hidden = have;
  note.textContent = R.refEngine() === "fast"
    ? "FastH3: 8 steps on the trained PDD grid, guidance 1, shift 12/3; the turbo LoRA is skipped. A preview release: compare against H3 ref2va if a render looks off."
    : have ? "" : "FastH3 isn't on this machine yet.";
}
$("#r-engine").addEventListener("change", (e) => {
  R.setRefEngine(e.target.value);
  try { localStorage.setItem(ENGINE_KEY, R.refEngine()); } catch { /* not remembered */ }
  toast(`Ref engine: ${R.REF_ENGINES[R.refEngine()]}`);
  engineUI(); setup();
});
$("#r-engine-get").addEventListener("click", async () => {
  const src = R.MODEL_SOURCES[R.FAST_REF], get = $("#r-engine-get"), note = $("#r-engine-note");
  get.disabled = true;
  const r = await fetch("/valis/models/fetch", {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(src)});
  if (!r.ok) { toast(`Download refused: ${await r.text()}`, true); get.disabled = false; return; }
  const name = R.FAST_REF;
  const poll = setInterval(async () => {
    const j = (await fetch("/valis/models/fetch").then(x => x.json()).catch(() => ({})))[name];
    if (!j) return;
    if (j.state === "downloading") note.textContent = `Downloading ${GB(j.done)} of ${GB(j.size || src.size)} GB` + (j.rate ? ` at ${(j.rate / 1e6).toFixed(0)} MB/s` : "");
    else if (j.state === "verifying") note.textContent = `Checking the file (sha256): ${GB(j.verified)} of ${GB(j.size)} GB`;
    else {
      clearInterval(poll); get.disabled = false;
      if (j.state === "done") { toast("FastH3 OmniRef downloaded and verified"); engineUI(); }
      else { note.textContent = `Download ${j.state}: ${j.error || ""}`; toast(`FastH3 download ${j.state}`, true); }
    }
  }, 3000);
});
engineUI();

api.connect();
// ------------------------------------------------------------------ FILM: one line, one film (film.js runs the chain)
const M = {genre: null, shots: 6, plan: null, busy: false};
cards($("#m-genre"), P.GENRES, (g) => { M.genre = g; }, "gothic");
seg($("#m-shots"), [{id: "4", name: "4 shots"}, {id: "6", name: "6 shots"}, {id: "8", name: "8 shots"}], (x) => { M.shots = Number(x.id); }, "6");
// the chain's view of the studio: submit a graph and wait for its results, read a saved text, name a result for a loader
const filmIO = {
  run: (graph, label) => new Promise((res, rej) => {
    api.submit(graph, label, "film").then((job) => {
      const upd = progressFor(job, $("#m-progress"));
      waiters.set(job.id, (j) => {
        upd(j);
        if (j.status === "done") { waiters.delete(j.id); res({outputs: j.outputs}); }
        if (j.status === "error") { waiters.delete(j.id); rej(new Error(`${label} failed: ${j.error}`)); }
      });
    }).catch(rej);
  }),
  text: async (f) => (await fetch(api.viewUrl(f))).text(),
  ref: (f) => api.outputRef(f),
  free: () => api.free(),
  has: async (node) => !!(await api.objectInfo(node))[node],
  exists: async (f) => (await fetch(api.viewUrl(f), {method: "HEAD"})).ok,
};
function drawPlan() {
  const p = M.plan, box = $("#m-planbox");
  if (!p) { box.replaceChildren(); return; }
  const field = (label, get, set) => h("div", {class: "maprow"}, h("label", {}, label), h("input", {type: "text", value: get(), oninput: (e) => set(e.target.value)}));
  box.replaceChildren(h("h2", {}, p.title), h("p", {class: "hint"}, p.logline),
    ...p.cast.map(c => field(c.name || "cast", () => c.look, (v) => { c.look = v; })), field("place", () => p.place, (v) => { p.place = v; }), field("song", () => p.song.style, (v) => { p.song.style = v; }),
    ...p.shots.map((sh, k) => h("div", {class: "shot"}, h("b", {}, String(k + 1)),
      h("textarea", {rows: 2, title: sh.who ? `the still frame · in it: ${sh.who.join(", ") || "no one"}` : "the still frame", oninput: (e) => { sh.keyframe = e.target.value; }}, sh.keyframe),
      h("input", {type: "text", value: sh.motion, placeholder: "what moves", title: "what moves in the shot", oninput: (e) => { sh.motion = e.target.value; }}),
      h("input", {type: "text", value: sh.subject, placeholder: "subject", title: "what SAM 3 tracks", oninput: (e) => { sh.subject = e.target.value; }}),
      h("select", {title: "the effect", onchange: (e) => { sh.effect = e.target.value; }}, ...G.FILM_EFFECTS.map(x => h("option", {value: x, selected: x === sh.effect}, x))),
      h("select", {title: "the lane that fires it", onchange: (e) => { sh.on = e.target.value; }}, ...G.FILM_LANES.map(x => h("option", {value: x, selected: x === sh.on}, `on ${x}`))))));
}
$("#m-plan").addEventListener("click", async () => {
  const idea = $("#m-idea").value.trim();
  if (!idea) return toast("Say what the film is about first", true);
  if (M.busy) return;
  M.busy = true; $("#m-plan").disabled = true;
  try {
    $("#m-status").textContent = "Qwen3 is writing the shot list and the song brief (about two minutes with the model load)";
    M.plan = await planFilm({idea, shots: M.shots, genre: M.genre}, filmIO);
    drawPlan(); $("#m-make").disabled = false; $("#m-progress").replaceChildren();
    $("#m-status").textContent = `Planned: ${M.plan.title}. Edit anything above, then make the film.`;
  } catch (e) { toast(e.message, true); $("#m-status").textContent = e.message; }
  finally { M.busy = false; $("#m-plan").disabled = false; }
});
$("#m-make").addEventListener("click", async () => {
  if (!M.plan || M.busy) return;
  M.busy = true; $("#m-make").disabled = true; $("#m-plan").disabled = true;
  const t0 = Date.now();
  try {
    const r = await makeFilm(M.plan, filmIO, {genre: M.genre, onStage: (stage, msg) => { $("#m-status").textContent = msg; }});
    $("#m-progress").replaceChildren();
    $("#m-viewer").replaceChildren(media(r.film)); finishBar($("#m-finish"), r.film, $("#m-viewer"), $("#m-strip"));
    $("#m-strip").replaceChildren(...r.fxed.map((v, k) => { const t = h("div", {class: "thumb"}, media(v, {controls: false}), h("div", {class: "meta"}, `shot ${k + 1}`)); t.onclick = () => $("#m-viewer").replaceChildren(media(v)); return t; }));
    $("#m-status").textContent = `${M.plan.title}: ${r.fxed.length} shots of ${r.cut.bars} bar${r.cut.bars > 1 ? "s" : ""} at ${r.bar.bpm} BPM, ${Math.round((Date.now() - t0) / 60000)} min. Saved ${r.film.subfolder}/${r.film.filename}`;
    toast(`Film saved: ${r.film.filename}`);
  } catch (e) { toast(e.message, true); $("#m-status").textContent = e.message; }
  finally { M.busy = false; $("#m-make").disabled = false; $("#m-plan").disabled = false; }
});

machine(); setInterval(machine, 8000);
setup();
show((location.hash || "#film").slice(1));
promptsPreview();
refreshPrompt();
