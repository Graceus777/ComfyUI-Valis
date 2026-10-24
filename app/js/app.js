import * as api from "./api.js";
import * as G from "./graphs.js";
import * as P from "./presets.js";
import * as CR from "./create.js";
import * as EST from "./estimate.js";
import {PALETTES} from "./palettes.js";
import {lookParams, gradeImageData} from "./grade.js";
import {palettePicker} from "./palettepick.js";
import {ScoreView} from "./score.js";
import {FxView} from "./fx.js";
import {checkSetup} from "./check.js";
import {planFilm, makeFilm, makeSong, frameShots, shootShots, effectShots, cutFilm} from "./film.js";
import * as R from "./refengine.js";
import {Bin} from "./bin.js";
import * as MC from "./machine.js";
import {showHelp} from "./help.js";
import {$, $$, h, esc, toast, chips, cards, seg, slider, section, dropzone, fillDrop, media, initTips, wireSections, ASSETS, VID} from "./ui.js";
export {toast};

initTips();
wireSections();

// ------------------------------------------------------------------ tabs
function show(view) {
  const id = view === "extras" ? `extras-${XMODE}` : view;
  $$(".tab").forEach(b => b.classList.toggle("on", b.dataset.view === view));
  $$(".view").forEach(v => v.classList.toggle("on", v.id === `view-${id}`));
  if (view === "extras") extrasOpen();
  if (view === "renders") Renders.refresh();
  if (view === "score") Score.ensure();
  if (view === "fx") Fx.refreshClips();
  history.replaceState(null, "", `#${view}`);
}
$$(".tab").forEach(b => b.addEventListener("click", () => show(b.dataset.view)));
addEventListener("keydown", (e) => {
  if (e.target.matches("input, textarea, select")) return;
  if (e.key === "?") return showHelp();
  if (e.key === "Escape") document.querySelector(".helpov")?.remove();
  const v = {"0": "film", "1": "create", "2": "edit", "3": "score", "4": "fx", "5": "renders", "6": "genjutsu", "7": "extras"}[e.key];
  if (v) show(v);
});

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
    if (ev.job.status === "done" && !ev.job._binned) {
      ev.job._binned = true;
      if (ev.job.ranSeconds) EST.record(ev.job.id, ev.job.graph, ev.job.ranSeconds);
      // every result goes in the bin (not the masks, overlays, anchors and control videos made along the way)
      for (const f of ev.job.outputs) if (!/matte|overlay|anchor|_end_|_mask|control|_part_|\.txt$|\.json$/i.test(f.filename)) Bin.add(f, {from: ev.job.kind, label: ev.job.label}, {soft: true});
    }
    Renders.onJob(ev.job);
  }
  if (ev.type === "connection") { $("#conn").classList.toggle("up", ev.up); $("#connText").textContent = ev.up ? "ComfyUI connected" : "ComfyUI offline"; }
  if (ev.type === "status") $("#queuePill").textContent = `queue ${ev.queue}`;
});
// the tab a job came from names it in the bin ("Edit", "Genjutsu"...)
const TABNAME = {film: "Film", create: "Create", edit: "Edit", genjutsu: "Genjutsu", score: "Score", fx: "FX", extras: "Extras", renders: "Renders"};
function run(graph, label, viewer, {onDone, kind} = {}) {
  return api.submit(graph, label, kind || TABNAME[$(".tab.on")?.dataset.view] || "render").then((job) => {
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
// The panel's state; create.js turns it into prompts and graphs (the same code the end-to-end test runs).
const C = {genre: null, framing: null, focal: null, light: null, setup: null, body: null, kit: null, era: null, emotion: null, tempo: null, move: null,
           look: {id: "auto"}, gradeShot: true, aspect: "9:16", short: CR.NATIVE_SHORT, seconds: 107 / 24, seed: 7101, shotSeed: 51101,
           opts: {trained: true, anchor: false, trim: true, lightChange: false}, character: null, picked: null, relit: null, keys: []};
const cstate = () => ({...C, subject: $("#c-subject").value, action: $("#c-action").value, who: $("#c-who").value});
const env = {hasNode: (n) => api.hasNode(n), hasLora: (n) => api.hasLora(n)};
const cs = {};                                         // the panel's sections, by key
const lab = (t, tip = null) => h("h3", {class: "lab", tip}, t);
const box = (id, cls = "chips") => h("div", {class: cls, id});
const check = (id, label, tip, on = false) => h("label", {class: "check", tip}, h("input", {type: "checkbox", id, ...(on ? {checked: true} : {})}), h("span", {}, label));
const nm = (x) => x && x.id !== "auto" ? x.name : null;
function buildCreate() {
  const sec = (key, title, tip, ...kids) => (cs[key] = section(title, {id: `c-sec-${key}`, tip}, ...kids));
  const moveTip = (m) => {
    const t = P.CAMERA_LORAS[m.id];
    return t ? (t.lora ? `A trained move: a camera LoRA learned it (${t.source}). Used when "trained moves" is on and the LoRA is installed.` : `Shot as ${t.source}.`) : "";
  };
  $("#c-sections").replaceChildren(
    sec("genre", "Genre", "A starting look. Its words fill every slot below that you leave on <b>From genre</b>.", box("c-genre", "cards")),
    sec("camera", "Camera", "Framing, focal length, camera body and lens: words in the keyframe prompt.",
      lab("Framing"), box("c-framing"), lab("Focal length"), box("c-focal"), lab("Camera body", "What the picture was shot on: grain, sharpness, colour, the era of the image itself."),
      box("c-body"), lab("Lens kit"), box("c-kit")),
    sec("move", "Camera move", "How the camera moves during the shot (the motion prompt). ✦ = a trained move: a camera LoRA does it for real instead of from words.",
      box("c-move"),
      check("c-trained", "trained moves (✦): use a camera LoRA when one is installed for this move", "A LoRA trained on one move does it properly: a full 360, a real push-in, a crash zoom. Off: H3 does every move from words.", true),
      check("c-anchor", "end on the subject: pin the last frame so the move finishes on them", "For moves that leave the subject behind (crane up, FPV, arcs): the shot's last frame is made first (a Qwen Image edit of the keyframe, seen from where the camera ends) and H3 is pinned to it."),
      check("c-trim", "trim the hold: cut the frozen end a pinned last frame leaves", "A pinned last frame makes H3 arrive early and hold still. This keeps a quarter second of the hold and cuts the rest.", true)),
    sec("light", "Light", "Light source and lighting setup go in the keyframe prompt. Relight changes the light of a finished keyframe.",
      lab("Light source"), box("c-light"), lab("Lighting setup"), box("c-setup"),
      lab("Relight a keyframe", "Qwen Image 2.1 edit: the same picture, the same people, new light."), h("div", {class: "row"}, h("select", {id: "c-relight"}),
        h("button", {class: "btn", id: "c-relight-go", disabled: true, type: "button"}, "Relight", h("span", {class: "sub", id: "c-relight-sub"}, "Qwen edit"))),
      check("c-lightchange", "light change: the shot starts in the keyframe's light and ends in the relit one", "H3 runs from the keyframe to its relit version: the light shifts during the shot.")),
    sec("look", "Era & colour", "When it's set, and its colours. The palette's words go in the keyframe; with 'grade the shot' the finished shot is graded in it too (Valis Color Palette).",
      lab("Era"), box("c-era"), h("p", {class: "hint", id: "c-era-hint"}),
      lab("Colour palette", "Hover a look to see it on your keyframe. Click a colour of the chosen look to change it."), h("div", {class: "pp", id: "c-palette"}),
      check("c-grade-shot", "grade the shot in this palette too", "The finished shot is colour-graded in the chosen look (Valis Color Palette, on the CPU, seconds). Off: only the keyframe's prompt carries the look.", true)),
    sec("perf", "Performance", "How they feel and how fast things move: words in the motion prompt.", lab("Emotion"), box("c-emotion"), lab("Tempo"), box("c-tempo")),
    sec("format", "Format", "Shape, size and length of the shot, and the seeds.",
      lab("Aspect"), h("div", {class: "seg", id: "c-aspect"}), h("div", {id: "c-res", class: "ctl"}), h("div", {id: "c-len", class: "ctl"}),
      h("p", {class: "hint", id: "c-len-hint"}),
      lab("Seeds", "Same seed + same settings = the same picture. Roll for a different one."),
      h("div", {class: "row seeds"}, h("label", {class: "mini", tip: "Keyframe seed (the second keyframe uses this + 101)"}, "keyframes", h("input", {type: "number", id: "c-seed", min: 0, value: C.seed})),
        h("button", {class: "dice", type: "button", tip: "Roll a new keyframe seed", onclick: () => { $("#c-seed").value = Math.floor(Math.random() * 1e6); $("#c-seed").dispatchEvent(new Event("input")); }}, "⚄"),
        h("label", {class: "mini", tip: "Shot seed"}, "shot", h("input", {type: "number", id: "c-shot-seed", min: 0, value: C.shotSeed})),
        h("button", {class: "dice", type: "button", tip: "Roll a new shot seed", onclick: () => { $("#c-shot-seed").value = Math.floor(Math.random() * 1e6); $("#c-shot-seed").dispatchEvent(new Event("input")); }}, "⚄"))),
    sec("char", "Character", "Optional. A face or character sheet, pulled into both keyframes with the Krea 2 identity edit (it replaces 'who the camera is about').",
      h("div", {class: "drop", id: "c-char"}, "Drop a character sheet or face", h("br"), h("span", {class: "hint"}, "it replaces the person named in 'who the camera is about'"))),
  );
  cards($("#c-genre"), P.GENRES, (g) => { C.genre = g; cchanged(); }, "gothic");
  chips($("#c-framing"), P.FRAMING, (x) => { C.framing = x; cchanged(); }, "wide");
  chips($("#c-focal"), P.LENS, (x) => { C.focal = x; cchanged(); }, "auto");
  chips($("#c-body"), P.BODIES, (x) => { C.body = x; cchanged(); }, "auto");
  chips($("#c-kit"), P.LENS_KITS, (x) => { C.kit = x; cchanged(); }, "auto");
  chips($("#c-move"), P.CAMERA_MOVES.map(m => ({...m, tip: moveTip(m)})), (x) => { C.move = x; cchanged(); }, "push_in",
        {where: "motion", grouped: true, badge: (it) => P.CAMERA_LORAS[it.id]?.lora ? h("span", {class: "tm", "data-lora": P.CAMERA_LORAS[it.id].lora}, "✦") : null});
  chips($("#c-light"), P.LIGHT, (x) => { C.light = x; cchanged(); }, "auto");
  chips($("#c-setup"), P.LIGHTING, (x) => { C.setup = x; cchanged(); }, "auto");
  chips($("#c-era"), P.ERAS, (x) => { C.era = x; eraHint(); cchanged(); }, "auto");
  chips($("#c-emotion"), P.EMOTIONS, (x) => { C.emotion = x; cchanged(); }, "neutral", {where: "motion"});
  chips($("#c-tempo"), P.TEMPO, (x) => { C.tempo = x; cchanged(); }, "single", {where: "motion"});
  CPal = palettePicker($("#c-palette"), {initial: C.look, onChange: (l) => { C.look = l; cchanged(); }, onHover: viewerGrade,
    source: () => $("#c-viewer > img") || PREF, renderWidth: () => CR.shotSize(C.aspect, C.short).w});
  seg($("#c-aspect"), Object.keys(CR.KEY_SIZES).map(id => ({id, name: id, tip: `Keyframes at ${CR.KEY_SIZES[id].w}×${CR.KEY_SIZES[id].h}`})), (a) => { C.aspect = a.id; resCtl?.set(C.short); cchanged(); });
  resCtl = slider($("#c-res"), {label: "Resolution (shot)", min: 320, max: 1024, step: 32, value: C.short,
    tip: "The shot's size; keyframes are always made at full size. Lower renders much faster (time grows faster than the pixel count). H3 was trained around 768 on the short side; above that it's untested and needs more memory. For 1080p, render at 768 and use Upscale.",
    fmt: (v) => { const s = CR.shotSize(C.aspect, v); return `${s.w}×${s.h}${v === CR.NATIVE_SHORT ? " · native" : v < 512 ? " · draft" : v > CR.NATIVE_SHORT ? " · above training" : ""}`; },
    marks: [{name: "draft", value: 384, tip: "384 px: fast tests"}, {name: "512", value: 512}, {name: "640", value: 640}, {name: "native", value: 768, tip: "768 px: what H3 was trained on"}]},
    (v) => { C.short = v; cchanged(); });
  lenCtl = slider($("#c-len"), {label: "Length", min: 2, max: 15, step: 0.1, value: C.seconds,
    tip: "Seconds of shot. H3 renders in steps of 17 frames (plus 5) at 24 fps, so the length snaps to the nearest one it can make. Time grows with length.",
    fmt: (v) => { const f = CR.frames(v); return `${(f / 24).toFixed(2)} s · ${f} frames`; },
    marks: [{name: "3 s", value: 3}, {name: "4.5 s", value: 107 / 24, tip: "107 frames: one standard H3 clip"}, {name: "5 s", value: 5.2}, {name: "10 s", value: 10}, {name: "15 s", value: 15}]},
    (v) => { C.seconds = v; const f = CR.frames(v);
      $("#c-len-hint").textContent = f < CR.TRAINED_FRAMES[0] ? `Shorter than H3's training (5.2–15 s): fine for tests and quick beats; fast moves can feel rushed.` : f > CR.TRAINED_FRAMES[1] ? "Longer than H3 was trained on: untested." : "";
      cchanged(); });
  ["c-trained", "c-anchor", "c-trim", "c-lightchange", "c-grade-shot"].forEach(id => $(`#${id}`).addEventListener("change", () => {
    C.opts = {trained: $("#c-trained").checked, anchor: $("#c-anchor").checked, trim: $("#c-trim").checked, lightChange: $("#c-lightchange").checked};
    C.gradeShot = $("#c-grade-shot").checked; cchanged(); }));
  $("#c-seed").addEventListener("input", (e) => { C.seed = Number(e.target.value) || 0; cchanged(); });
  $("#c-shot-seed").addEventListener("input", (e) => { C.shotSeed = Number(e.target.value) || 0; cchanged(); });
  ["#c-subject", "#c-action", "#c-who"].forEach(s => $(s).addEventListener("input", cchanged));
  // which trained moves are installed here: ✦ for installed, dimmed ✦ for not
  for (const t of $$("#c-move .tm")) api.hasLora(t.dataset.lora).then(ok => { t.classList.toggle("off", !ok); if (!ok) t.closest(".chip").dataset.tip += "<br><b>Its LoRA isn't installed here</b>: H3 does it from words."; });
  const RL = $("#c-relight");
  RL.replaceChildren(...P.RELIGHT.map(r => h("option", {value: r.id}, r.name)));
  $("#c-relight-go").addEventListener("click", relight);
  dropzone($("#c-char"), "image/*", async (f) => {
    const u = await api.upload(f); C.character = api.inputRef(u);
    fillDrop($("#c-char"), h("img", {src: URL.createObjectURL(f)}), h("span", {}, f.name)); toast("Character ready: it goes into the next keyframes"); cchanged();
  });
  $("#c-char")._onItem = (it) => { if (it.kind !== "still") return; C.character = api.fileRef(it.file); fillDrop($("#c-char"), h("img", {src: api.viewUrl(it.file)}), h("span", {}, it.label || it.file.filename)); cchanged(); };
  $("#c-viewer")._onItem = (it) => { if (it.kind === "still") pickKey(it.file, null); };
  // your own still as the first frame: drop it on the viewer
  dropzone($("#c-viewer"), "image/*", async (f) => {
    const u = await api.upload(f), ref = api.inputRef(u), url = URL.createObjectURL(f);
    const t = h("div", {class: "thumb"}, h("img", {src: url}), h("div", {class: "meta"}, "your still"));
    const it = {ref, url, filename: f.name};
    t.onclick = () => pickKey(it, t); $("#c-strip").prepend(t); pickKey(it, t);
  });
}
let CPal = null, resCtl = null, lenCtl = null;
// the picture looks are previewed on before there's a keyframe: a sunlit market with skin, a red dress, sky and shade
const PREF = new Image(); PREF.src = `${ASSETS}/palette_ref.jpg`; PREF.onload = () => CPal?.refresh();
function eraHint() {
  const e = C.era, look = e?.look && e.look !== "natural" ? PALETTES.find(p => p.id === e.look) : null;
  const el = $("#c-era-hint"); if (!el) return;
  el.replaceChildren(...(look && C.look.id !== look.id ? [`${e.name} pairs with `, h("button", {class: "linkbtn", type: "button", onclick: () => { CPal.set({id: look.id}); eraHint(); }}, look.name), " colour."] : []));
}
// a look on the keyframe in the viewer while you hover it (grade.js; the shot gets the same grade)
function viewerGrade(look) {
  const v = $("#c-viewer"), img = $("#c-viewer > img");
  v.querySelector(".gradeprev")?.remove();
  if (!look || !img || !img.naturalWidth) return;
  const r = img.getBoundingClientRect(), vr = v.getBoundingClientRect(), W = Math.min(Math.round(r.width), 480), H = Math.round(W * img.naturalHeight / img.naturalWidth);
  const cv = h("canvas", {class: "gradeprev", width: W, height: H, style: `left:${r.left - vr.left}px;top:${r.top - vr.top}px;width:${r.width}px;height:${r.height}px`});
  const x = cv.getContext("2d", {willReadFrequently: true});
  x.drawImage(img, 0, 0, W, H);
  if (look.id !== "auto" && look.id !== "natural") x.putImageData(gradeImageData(x.getImageData(0, 0, W, H), lookParams(look.id, look.hex), {scale: W / CR.shotSize(C.aspect, C.short).w}), 0, 0);
  v.append(cv, h("span", {class: "gradeprev tag", style: "left:12px;top:12px"}, `preview · ${PALETTES.find(p => p.id === look.id)?.name || look.id}`));
}
let ctimer = null;
function cchanged() {
  if (!cs.genre) return;
  const S = cstate(), size = CR.shotSize(C.aspect, C.short), f = CR.frames(C.seconds);
  cs.genre.setValue(C.genre?.name || "");
  cs.camera.setValue([C.framing?.name, nm(C.focal), nm(C.body), nm(C.kit)].filter(Boolean).join(" · "));
  cs.move.setValue(`${C.move?.name || ""}${P.CAMERA_LORAS[C.move?.id]?.lora && C.opts.trained ? " ✦" : ""}${C.opts.anchor ? " · ends on subject" : ""}`);
  cs.light.setValue([nm(C.light) || "from genre", C.setup?.id !== "auto" ? C.setup?.name : null, C.opts.lightChange ? "light change" : null].filter(Boolean).join(" · "));
  const lk = C.look.id === "auto" ? "genre colour" : `${C.look.id === "custom" ? "Your colours" : PALETTES.find(p => p.id === C.look.id)?.name || C.look.id}${C.look.hex && C.look.id !== "custom" ? " (edited)" : ""}`;
  cs.look.setValue([nm(C.era), lk, C.gradeShot && C.look.id !== "auto" && C.look.id !== "natural" ? "graded" : null].filter(Boolean).join(" · "));
  cs.perf.setValue([C.emotion?.id !== "neutral" ? C.emotion?.name : null, C.tempo?.name].filter(Boolean).join(" · "));
  cs.format.setValue(`${C.aspect} · ${size.w}×${size.h} · ${(f / 24).toFixed(1)} s`);
  cs.char.setValue(C.character ? "set" : "none");
  $("#c-prompts").textContent = `KEYFRAME (Krea 2)\n${CR.keyframePrompt(S)}\n\nMOTION (MiniMax H3)\n${CR.motionPrompt(S)}`;
  clearTimeout(ctimer); ctimer = setTimeout(cestimates, 250);
}
async function cestimates() {
  const S = cstate();
  const k = await EST.estimate(CR.keyframesGraph(S, {seeds: [C.seed, C.seed + 101]}));
  $("#c-frame-sub").textContent = `2 keyframes · ${EST.fmt(k)}`; $("#c-frame-sub").parentElement.dataset.tip = `Krea 2, ${CR.KEY_SIZES[C.aspect].w}×${CR.KEY_SIZES[C.aspect].h}. Time: ${k.basis}.`;
  try {
    const p = await CR.planShot({...S, image: "x.png", seed: C.shotSeed, relit: C.opts.lightChange && C.relit ? "y.png" : null}, env);
    const e = await EST.estimate(p.graph);
    $("#c-shoot-sub").textContent = `${p.kind === "wan" ? "Wan 2.2" : "H3"} · ${p.width}×${p.height} · ${p.seconds.toFixed(1)} s · ${EST.fmt(e)}`;
    $("#c-shoot").dataset.tip = `${esc(p.label)}. Time: ${e.basis}.${p.notes.length ? "<br>" + p.notes.map(esc).join("<br>") : ""}`;
  } catch (e) { $("#c-shoot-sub").textContent = e.message; }
  const rl = await EST.estimate(G.relightImage({image: "x.png", prompt: "x"}));
  $("#c-relight-sub").textContent = `Qwen edit · ${EST.fmt(rl)}`;
}
function relight() {
  if (!C.picked) return toast("Frame it first, then pick a keyframe", true);
  const RL = $("#c-relight"), r = P.RELIGHT.find(x => x.id === RL.value), orig = C.picked, tag = Date.now().toString(36);
  run(G.relightImage({image: fileRef(orig), prompt: `Relight this photo: ${r.words}.${P.RELIGHT_KEEP}`, prefix: `valis/relight_${tag}`}),
      `Relight · ${r.name}`, null, {onDone: (j) => j.outputs.filter(o => /\.(png|jpg|webp)$/i.test(o.filename)).forEach(o => {
        C.relit = {orig, relit: o, name: r.name};
        const t = h("div", {class: "thumb"}, media(o), h("div", {class: "meta"}, `relit · ${r.name}`));
        t.onclick = () => pickKey(o, t); $("#c-strip").append(t);
        Bin.add(o, {from: "Create", label: `relit · ${r.name}`});
        toast(`Relit (${r.name}). Pick it to shoot in the new light, or keep the original picked and tick "light change"`);
      })});
}
// a file the studio made ({filename, subfolder, type}) or a dropped one ({ref, url}) -> what a graph's loader takes
const fileRef = (f) => f?.ref || api.fileRef(f);
const fileUrl = (f) => f?.url && !f.subfolder ? f.url : api.viewUrl(f);
function pickKey(f, el) {
  C.picked = f;
  $("#c-relight-go").disabled = false;
  $$(".thumb", $("#c-strip")).forEach(t => t.classList.toggle("on", t === el));
  const img = h("img", {src: fileUrl(f), alt: ""});
  img.addEventListener("load", () => CPal?.refresh());
  $("#c-viewer").replaceChildren(img, ...($("#c-viewer")._input ? [$("#c-viewer")._input] : []));
  $("#c-shoot").disabled = false;
}
export function useAsFirstFrame(f) { pickKey(f, null); show("create"); }
$("#c-frame").addEventListener("click", () => {
  const S = cstate();
  if (!S.subject.trim()) return toast("Describe the shot first", true);
  const tag = Date.now().toString(36);
  run(CR.keyframesGraph(S, {seeds: [C.seed, C.seed + 101], prefix: `valis/key_${tag}`}), "Keyframes", $("#c-viewer"), {onDone: (j) => {
    const imgs = j.outputs.filter(f => /\.(png|jpg|webp)$/i.test(f.filename));
    C.keys = imgs;
    imgs.forEach(f => Bin.add(f, {from: "Create", label: "keyframe", prompt: CR.keyframePrompt(S)}));
    $("#c-strip").replaceChildren(...imgs.map(f => { const t = h("div", {class: "thumb"}, media(f), h("div", {class: "meta"}, "keyframe")); t.onclick = () => pickKey(f, t); return t; }));
    if (imgs[0]) pickKey(imgs[0], $("#c-strip .thumb"));
    const who = S.who.trim() || "the person";
    if (C.character) imgs.forEach((f, k) => run(G.castCharacter({keyframe: api.outputRef(f), character: C.character, refBoost: 0.5,
      prompt: `Turn ${who} into the character from the second image: the same face, hair, skin and outfit as the reference. Keep ${who}'s pose and position, everyone else, the framing, the room and the lighting exactly the same.`,
      prefix: `valis/cast_${tag}_${k}`}), "Cast character", null, {onDone: (jj) => jj.outputs.forEach(o => {
        Bin.add(o, {from: "Create", label: "with character"});
        const t = h("div", {class: "thumb"}, media(o), h("div", {class: "meta"}, "with character")); t.onclick = () => pickKey(o, t); $("#c-strip").append(t); })}));
  }});
});
$("#c-shoot").addEventListener("click", async () => {
  if (!C.picked) return;
  const S = cstate();
  let plan;
  try {
    plan = await CR.planShot({...S, image: fileRef(C.picked), seed: C.shotSeed, prefix: `valis/shot_${Date.now().toString(36)}`,
      relit: C.opts.lightChange && C.relit && C.relit.orig === C.picked ? api.outputRef(C.relit.relit) : null}, env);
  } catch (e) { return toast(e.message, true); }
  plan.notes.forEach(n => toast(n));
  const onDone = (j) => {
    const v = j.outputs.find(f => VID.test(f.filename));
    if (!v) return;
    Bin.add(v, {from: "Create", label: C.move?.name || "shot", prompt: CR.motionPrompt(S)});
    $("#c-viewer").replaceChildren(media(v)); finishBar($("#c-finish"), v, $("#c-viewer"), $("#c-strip"));
    const t = h("div", {class: "thumb"}, media(v, {controls: false}), h("div", {class: "meta"}, "shot"));
    t.onclick = () => { $("#c-viewer").replaceChildren(media(v)); finishBar($("#c-finish"), v, $("#c-viewer"), $("#c-strip")); };
    $("#c-strip").prepend(t);
  };
  run(plan.graph, plan.label, $("#c-viewer"), {onDone});
});

// ------------------------------------------------------------------ GENJUTSU
const GJ = {clip: null, clipUrl: null, mode: "motion", refs: [], style: null, seconds: 5, mp: 0.4, aspect: "9:16 (Portrait Widescreen)",
            window: null};   // window: {start, duration} picked from the source check
seg($("#g-mode"), [{id: "motion", name: "Motion transfer", tip: "New people (your reference images) doing exactly what the people in the clip do: the motion is read as SDPose skeletons"},
  {id: "restyle", name: "Restyle", tip: "The whole clip in a new look (clay, anime, watercolour...): the motion is read as Canny edges"},
  {id: "swap", name: "Object swap", tip: "Only the thing you name is replaced (SAM 3 finds it); everything else stays"}], (m) => {
  GJ.mode = m.id;
  $("#g-styles-wrap").style.display = m.id === "restyle" ? "" : "none";
  $("#g-target-wrap").style.display = m.id === "swap" ? "" : "none";
  gjPrompt();
});
chips($("#g-styles"), P.GENJUTSU_STYLES, (x) => { GJ.style = x; gjPrompt(); }, "clay", {where: "video"});
seg($("#g-len"), [{id: "5", name: "5 s", s: 5}, {id: "10", name: "10 s", s: 10}, {id: "15", name: "15 s", s: 15}].map(x => ({...x, tip: `${x.s} seconds of the source (from its start, or the best window the check finds)`})), (l) => { GJ.seconds = l.s; gjEst(); });
seg($("#g-size"), [{id: "480", name: "480p", mp: 0.4, tip: "0.4 megapixels: the size motion transfer holds together best"}, {id: "576", name: "576p", mp: 0.5625, tip: "0.56 megapixels: sharper; a body that's hard to read warps more"}], (x) => { GJ.mp = x.mp; gjEst(); });
seg($("#g-aspect"), [{id: "9:16 (Portrait Widescreen)", name: "9:16"}, {id: "16:9 (Widescreen)", name: "16:9"}, {id: "1:1 (Square)", name: "1:1"}], (x) => { GJ.aspect = x.id; gjEst(); });
$("#g-turbo").addEventListener("change", gjEst);
function gjRefs() {
  const slots = GJ.refs.map((r, i) => h("div", {class: "ref"}, h("img", {src: r.url, alt: ""}),
    h("select", {onchange: (e) => { r.role = e.target.value; gjPrompt(); }}, ...P.GENJUTSU_ROLES.map(x => h("option", {value: x, selected: x === r.role}, x))),
    h("button", {class: "x", onclick: () => { GJ.refs.splice(i, 1); gjRefs(); gjPrompt(); }}, "×")));
  const add = h("div", {class: "drop small"}, GJ.refs.length < 8 ? "+ image" : "8 images max");
  if (GJ.refs.length < 8) {
    dropzone(add, "image/*", async (f) => {
      const u = await api.upload(f); GJ.refs.push({ref: api.inputRef(u), url: URL.createObjectURL(f), role: GJ.refs.length ? "location" : "character"}); gjRefs(); gjPrompt();
    });
    add._onItem = (it) => { if (it.kind !== "still") return; GJ.refs.push({ref: Bin.ref(it), url: Bin.url(it), role: GJ.refs.length ? "location" : "character"}); gjRefs(); gjPrompt(); };
  }
  $("#g-refs").replaceChildren(...slots, add);
}
gjRefs();
async function gjEst() {
  $("#g-sec-len-val").textContent = `${GJ.seconds} s · ${GJ.mp > .5 ? "576p" : "480p"} · ${(GJ.aspect || "").split(" ")[0]}${$("#g-turbo")?.checked ? " · turbo" : ""}`;
  const g = G.genjutsu({video: "x.mp4", refs: ["a.png"], prompt: "x", mode: GJ.mode, seconds: GJ.seconds, megapixels: GJ.mp, aspect: GJ.aspect, turbo: $("#g-turbo")?.checked});
  const e = await EST.estimate(g), c = await EST.estimate(G.poseCheck({video: "x.mp4"}));
  $("#g-run .sub").textContent = `H3 + Fun ControlNet · ${EST.fmt(e)}`; $("#g-run").dataset.tip = `Time: ${e.basis}.`;
  $("#g-check .sub").textContent = `pose only · ${EST.fmt(c)}`;
}
function gjPrompt() {
  gjEst();
  $("#g-prompt").value = P.genjutsuPrompt({mode: GJ.mode, refs: GJ.refs, style: GJ.style, target: $("#g-target").value.trim(), text: ""});
}
$("#g-target").addEventListener("input", gjPrompt);
function gjSetClip(ref, url, label) {
  GJ.clip = ref; GJ.clipUrl = url;
  fillDrop($("#g-clip"), h("video", {src: url, muted: true, autoplay: true, loop: true, playsinline: true}), h("span", {}, label));
  $("#g-viewer").replaceChildren(h("video", {src: url, controls: true, autoplay: true, loop: true, muted: true, playsinline: true}));
  $("#g-run").disabled = false; $("#g-check").disabled = false;
  GJ.window = null; $("#g-report").replaceChildren();
}
dropzone($("#g-clip"), "video/*", async (f) => { const u = await api.upload(f); gjSetClip(api.inputRef(u), URL.createObjectURL(f), f.name); });
$("#g-clip")._onItem = (it) => it.kind === "clip" && gjSetClip(api.fileRef(it.file), api.viewUrl(it.file), it.label || it.file.filename);
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
seg($("#e-mode"), [{id: "transform", name: "Transform", tip: "The thing you named becomes something else (a look below): Krea 2 makes the first and last frames, H3 re-renders only the masked region"},
  {id: "remove", name: "Remove", tip: "The thing you named is taken out; the background carries on where it was"},
  {id: "swap", name: "Swap", tip: "The whole person replaced by your character (H3 character swap), keeping the take's voice and motion"},
  {id: "turn", name: "Turn", tip: "One take turns into another on a spoken word: the man into the vampire on 'morning'"}], (m) => {
  E.mode = m.id;
  $("#e-looks-wrap").style.display = m.id === "transform" ? "" : "none";
  $("#e-swap-wrap").style.display = m.id === "swap" ? "" : "none";
  $("#e-turn-wrap").style.display = m.id === "turn" ? "" : "none";
  $('[data-key="e-sec-ctl"]').style.display = ["swap", "turn"].includes(m.id) ? "none" : "";
  $("#e-find").style.display = m.id === "turn" ? "none" : "";
  $('[data-key="e-sec-prompt"]').style.display = m.id === "turn" ? "none" : "";
  editEst();
  if (m.id === "turn") { fillClipB(); drawWave(); }
  if (m.id === "remove") { $("#e-rb").value = 1; }
  if (m.id === "swap") { $("#e-rb").value = 0.8; }
  syncSliders(); refreshPrompt();
});
cards($("#e-looks"), P.LOOKS, (l) => { E.look = l; $("#e-rb").value = l.rb; syncSliders(); refreshPrompt(); }, "vampire");
async function editEst() {
  const graph = E.mode === "turn" ? G.turn({a: "x.mp4", b: "y.mp4"}) : E.mode === "swap" ? G.swapFull({video: "x.mp4", character: "c.png", prompt: "x", turbo: true})
    : G.edit({mode: E.mode, video: "x.mp4", target: "x", anchorPrompt: "x", desc: "x"});
  const e = await EST.estimate(graph), f = await EST.estimate(G.maskPreview({video: "x.mp4", target: "x"}));
  $("#e-render .sub").textContent = `${{transform: "H3 masked", remove: "H3 masked", swap: "H3 character swap", turn: "Valis"}[E.mode]} · ${EST.fmt(e)}`;
  $("#e-render").dataset.tip = `Time: ${e.basis}.`;
  $("#e-find .sub").textContent = `SAM 3 · ${EST.fmt(f)}`;
}
function syncSliders() {
  $("#e-rb-o").textContent = Number($("#e-rb").value).toFixed(1); $("#e-grow-o").textContent = `${$("#e-grow").value} px`;
  $("#e-sec-ctl-val").textContent = `faithfulness ${Number($("#e-rb").value).toFixed(1)} · margin ${$("#e-grow").value} px${$("#e-audio").checked ? "" : " · silent"}`;
}
$("#e-audio").addEventListener("change", () => syncSliders());
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
  await Bin.load();
  const sel = $("#e-clipb"), keep = sel.value;
  sel.replaceChildren(h("option", {value: ""}, "pick a clip from the bin…"),
    ...Bin.list("clip").slice(0, 60).map(it => h("option", {value: Bin.ref(it), "data-url": Bin.url(it)}, it.label ? `${it.label} · ${it.file.filename}` : it.file.filename)));
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
$("#e-clip")._onItem = (it) => it.kind === "clip" && setClip(api.fileRef(it.file), api.viewUrl(it.file), it.label || it.file.filename);
$("#e-char")._onItem = (it) => { if (it.kind !== "still") return; E.character = api.fileRef(it.file); fillDrop($("#e-char"), h("img", {src: api.viewUrl(it.file)}), h("span", {}, it.label || it.file.filename)); };
$("#e-bg")._onItem = (it) => { if (it.kind !== "still") return; E.bg = api.fileRef(it.file); fillDrop($("#e-bg"), h("img", {src: api.viewUrl(it.file)}), h("span", {}, it.label || it.file.filename)); };
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
const Score = new ScoreView({run, onFilm: (sv) => {
  // a film on this score's song: the Film tab gets the song and as many shots as the score has (up to 12)
  if (!sv.audioRef) return toast("This score has no song to make a film on", true);
  M.ownSong = {ref: sv.audioRef, name: sv.sc.title || "the score's song", url: sv.audioUrl};
  M.songSrc = "own"; $$("#m-song-src button").forEach(b => b.classList.toggle("on", b.dataset.id === "own")); $("#m-song-drop").style.display = "";
  fillDrop($("#m-song-drop"), h("span", {}, M.ownSong.name)); fsec.song.setValue(M.ownSong.name);
  M.shots = Math.min(12, sv.sc.shots.length); $$("#m-shots-n button").forEach(b => b.classList.toggle("on", Number(b.dataset.id) === M.shots));
  show("film"); toast("Film: the song is set. Say what the film is about and press Plan it");
}});

// ------------------------------------------------------------------ FX
let FX_SCORE = null;
const Fx = new FxView({$, h, toast, assets: ASSETS, api, G, run, VID, bin: Bin, getScore: () => FX_SCORE, estimate: () => fxEst()});
async function fxEst() {
  $("#f-sec-more-val").textContent = `${$("#f-loop").checked ? "loops" : "no loop"} · ${$("#f-sound").checked ? "sound on" : "no sound"}`;
  const F = Fx.F, secs = F.seconds || 107 / 24;
  const g = G.fx({clip: "x.mp4", layers: F.layers.length ? F.layers : [{effect: "Punch", on: "kick"}], source: F.source === "write" ? "write" : "sheet",
    songSpec: F.source === "write" ? {style: "x", lyrics: "x", seconds: Number($("#f-secs").value) || 20} : null});
  const e = await EST.estimate(g);
  $("#f-render .sub").textContent = `${F.source === "write" ? "YuE2 + " : ""}Valis · ${EST.fmt({...e, seconds: e.seconds * Math.max(.5, secs / 4.46)})}`;
}
// the FX tab's Score lanes follow whatever score is open in the Score tab
["#f-loop", "#f-sound"].forEach(sel => $(sel).addEventListener("change", fxEst));
$("#f-source").addEventListener("click", async () => { if (Fx.F.source === "score") { Score.ensure(); FX_SCORE = await Score.forFx(); if (!FX_SCORE) toast("Open the Score tab and make or open a score: FX fires on its lanes"); } });


// ------------------------------------------------------------------ EXTRAS: stereograms, loops, Stage (experimental)
const XMODES = [{id: "stereo", name: "Stereogram", tip: "Hide a moving thing in a field of dots: a magic-eye stereogram and a motion-only kinetogram"},
  {id: "loop", name: "Loop", tip: "A shot that plays forever (MiniMax H3 Loop)"}, {id: "stage", name: "Stage · experimental", tip: "One still split into depth layers, played by a live 2.5D camera"}];
let XMODE = "stereo";
try { XMODE = localStorage.getItem("valis.extras") || "stereo"; } catch { /* */ }
let StageTab = null, xready = false;
$$(".seg.xmode").forEach(el => seg(el, XMODES, (x) => { if (xready && x.id !== XMODE) { XMODE = x.id; try { localStorage.setItem("valis.extras", XMODE); } catch { /* */ } show("extras"); } }, el.dataset.x));
xready = true;
async function extrasOpen() {
  if (XMODE === "stage" && !StageTab) {
    try { const {StageView} = await import("./stageview.js"); StageTab = new StageView({$, h, toast, api, G}); window.valisStage = StageTab; }
    catch (e) { toast(`Stage didn't load: ${e.message}`, true); }
  }
}
// ---- stereogram
const X = {clip: null, url: null};
function xSetClip(ref, url, label) {
  X.clip = ref; X.url = url;
  fillDrop($("#x-clip"), h("video", {src: url, muted: true, autoplay: true, loop: true, playsinline: true}), h("span", {}, label));
  $("#x-viewer").replaceChildren(h("video", {src: url, controls: true, autoplay: true, loop: true, muted: true, playsinline: true}));
  $("#x-run").disabled = false;
}
dropzone($("#x-clip"), "video/*", async (f) => { const u = await api.upload(f); xSetClip(api.inputRef(u), URL.createObjectURL(f), f.name); });
$("#x-clip")._onItem = (it) => it.kind === "clip" && xSetClip(Bin.ref(it), Bin.url(it), it.label || it.file.filename);
const XS = {viewing: "parallel", shape: "none", look: "squares", cell: 4, noise: "white", color: "black & white", palette: "neon", charset: "minimal", refresh: 1, mbps: 4};
(function buildStereo() {
  const xs = {};
  const sec = (key, title, tip, ...kids) => (xs[key] = section(title, {id: `x-sec-${key}`, tip}, ...kids));
  $("#x-sections").replaceChildren(
    sec("view", "Viewing", "How the stereogram is free-viewed, and an optional spinning solid that joins the hidden thing.",
      lab("Free-view"), h("div", {class: "seg", id: "x-viewing"}), lab("A spinning shape too", "A solid turning in the field next to the hidden thing (Valis Depth Shape)"), h("div", {class: "chips", id: "x-shape"})),
    sec("static", "The dots", "What the field of dots is made of (Valis Static): squares, halftone or letters; the grain of the noise; its colours.",
      lab("Drawn as"), h("div", {class: "seg", id: "x-look"}), h("div", {id: "x-cell", class: "ctl"}),
      lab("Noise", "white = TV snow; pink and brown = soft clumps; blue and violet = fine even grain"), h("div", {class: "chips", id: "x-noise"}),
      lab("Colour"), h("div", {class: "chips", id: "x-color"}), h("select", {id: "x-palette", style: "margin-top:6px"}), h("select", {id: "x-charset", style: "margin-top:6px"}),
      h("div", {id: "x-refresh", class: "ctl"})),
    sec("check", "Upload check", "Valis Stereo Decode reads the depth back out of the stereogram after an H.264 round trip at this bitrate: if the decoded picture is clean, it survives an upload.",
      h("div", {id: "x-mbps", class: "ctl"})),
  );
  const upd = () => { xs.view.setValue(`${XS.viewing}${XS.shape !== "none" ? " · " + XS.shape : ""}`); xs.static.setValue(`${XS.look} · ${XS.cell}px · ${XS.noise} · ${XS.color}`); xs.check.setValue(`${XS.mbps} Mbps`); xest(); };
  seg($("#x-viewing"), [{id: "parallel", name: "Parallel", tip: "Look through the screen, as if at something far behind it"}, {id: "cross", name: "Cross-eyed", tip: "Cross your eyes slightly in front of the screen"}], (x) => { XS.viewing = x.id; upd(); });
  chips($("#x-shape"), ["none", "cube", "torus", "octahedron", "heart", "star", "blob"].map(id => ({id, name: id === "none" ? "None" : id, tip: id === "none" ? "Only the hidden thing" : `A spinning ${id} joins it`})), (x) => { XS.shape = x.id; upd(); }, "none");
  seg($("#x-look"), [{id: "squares", name: "Squares"}, {id: "halftone", name: "Halftone"}, {id: "ascii", name: "Letters"}], (x) => { XS.look = x.id; $("#x-charset").style.display = x.id === "ascii" ? "" : "none"; upd(); });
  slider($("#x-cell"), {label: "Dot size", min: 1, max: 16, step: 1, value: XS.cell, fmt: (v) => `${v} px`, tip: "Bigger dots survive upload compression better (6 at 1080p)"}, (v) => { XS.cell = v; upd(); });
  chips($("#x-noise"), ["white", "pink", "brown", "blue", "violet"].map(id => ({id, name: id})), (x) => { XS.noise = x.id; upd(); }, "white");
  chips($("#x-color"), ["black & white", "grey", "rgb", "rgb 8", "tv", "palette"].map(id => ({id, name: id})), (x) => { XS.color = x.id; $("#x-palette").style.display = x.id === "palette" ? "" : "none"; upd(); }, "black & white");
  slider($("#x-refresh"), {label: "New dots every", min: 0, max: 8, step: 1, value: 1, fmt: (v) => v === 0 ? "never (one field)" : v === 1 ? "frame (TV snow)" : `${v} frames`,
    tip: "1 = live TV snow; more = fewer bits to upload; never = the same dots throughout (cheapest, but a moving thing shows as copies)"}, (v) => { XS.refresh = v; upd(); });
  slider($("#x-mbps"), {label: "Upload bitrate", min: 1, max: 20, step: 1, value: 4, fmt: (v) => `${v} Mbps`}, (v) => { XS.mbps = v; upd(); });
  api.objectInfo("ValisStatic").then(oi => {
    const ins = oi?.ValisStatic?.input?.required || {}, opts = (k) => ins[k]?.[1]?.options || ins[k]?.[0] || [];
    $("#x-palette").replaceChildren(...opts("palette").map(p => h("option", {value: p, selected: p === XS.palette}, `palette: ${p}`)));
    $("#x-charset").replaceChildren(...opts("charset").map(p => h("option", {value: p, selected: p === XS.charset}, `letters: ${p}`)));
  }).catch(() => {});
  $("#x-palette").addEventListener("change", (e) => { XS.palette = e.target.value; upd(); });
  $("#x-charset").addEventListener("change", (e) => { XS.charset = e.target.value; upd(); });
  $("#x-palette").style.display = "none"; $("#x-charset").style.display = "none";
})();
async function xest() { const e = await EST.estimate(G.stereo({video: "x.mp4"})); $("#x-run-sub").textContent = `stereogram + kinetogram + decode check · ${EST.fmt(e)}`; }
$("#x-run").addEventListener("click", () => {
  if (!X.clip) return toast("Drop a clip first", true);
  const tag = Date.now().toString(36);
  run(G.stereo({video: X.clip, target: $("#x-target").value.trim() || "person", maxObjects: Number($("#x-max").value) || 2, ...XS, prefix: `valis/stereo_${tag}`}),
    "Stereogram", $("#x-viewer"), {onDone: (j) => {
      const vids = j.outputs.filter(f => VID.test(f.filename));
      const name = (f) => /_decoded/.test(f.filename) ? "decoded (upload check)" : /_kinetogram/.test(f.filename) ? "kinetogram" : `stereogram (${XS.viewing})`;
      const main = vids.find(f => !/_decoded|_kinetogram/.test(f.filename)) || vids[0];
      if (main) $("#x-viewer").replaceChildren(media(main));
      vids.forEach(v => Bin.add(v, {from: "Extras", label: name(v)}));
      $("#x-strip").replaceChildren(...vids.map(v => { const t = h("div", {class: "thumb wide"}, media(v, {controls: false}), h("div", {class: "meta"}, name(v))); t.onclick = () => $("#x-viewer").replaceChildren(media(v)); return t; }));
    }});
});
// ---- loop
const LP = {image: null, url: null, length: 107, engine: "fast", short: 384, look: "natural", views: 2};
function lSetImage(ref, url, label) {
  LP.image = ref; LP.url = url;
  fillDrop($("#l-image"), h("img", {src: url}), h("span", {}, label));
  $("#l-viewer").replaceChildren(h("img", {src: url, alt: ""}));
  $("#l-run").disabled = false; lest();
}
dropzone($("#l-image"), "image/*", async (f) => { const u = await api.upload(f); lSetImage(api.inputRef(u), URL.createObjectURL(f), f.name); });
$("#l-image")._onItem = (it) => it.kind === "still" && lSetImage(Bin.ref(it), Bin.url(it), it.label || it.file.filename);
Bin.action({id: "loop", label: "Extras · loop it", kinds: ["still"], run: (it) => { lSetImage(Bin.ref(it), Bin.url(it), it.label || it.file.filename); XMODE = "loop"; show("extras"); }});
Bin.action({id: "stereo", label: "Extras · hide it in noise", kinds: ["clip"], run: (it) => { xSetClip(Bin.ref(it), Bin.url(it), it.label || it.file.filename); XMODE = "stereo"; show("extras"); }});
(function buildLoop() {
  const ls = {};
  const sec = (key, title, tip, ...kids) => (ls[key] = section(title, {id: `l-sec-${key}`, tip}, ...kids));
  $("#l-sections").replaceChildren(
    sec("shape", "Length, size and engine", "How long one pass is, how big, and which H3.",
      lab("One pass"), h("div", {class: "seg", id: "l-len"}), h("div", {id: "l-res", class: "ctl"}),
      lab("Engine", "FastH3 (8 steps) for drafts; H3 ref2va (25 steps) for the final, about 3x longer"), h("div", {class: "seg", id: "l-engine"}),
      h("label", {class: "check", tip: "Also samples the loop turned half round and takes the sound near the join from it: H3 garbles the sound next to the wrap otherwise. About 1.8x the time."},
        h("input", {type: "checkbox", id: "l-views", checked: true}), h("span", {}, "clean sound across the join (1.8x time)"))),
    sec("look", "Grade", "Optional: grade the loop in a colour palette (Valis Color Palette).", h("select", {id: "l-look"})),
  );
  const upd = () => { const s = CR.shotSize("9:16", LP.short); ls.shape.setValue(`${((LP.length - 5) / 24).toFixed(2)} s · ${s.w}×${s.h} · ${LP.engine === "full" ? "H3 25 steps" : "FastH3"}`); ls.look.setValue(LP.look === "natural" ? "none" : PALETTES.find(p => p.id === LP.look)?.name || LP.look); lest(); };
  seg($("#l-len"), G.LOOP_LENGTHS.map(x => ({id: String(x.frames), name: `${x.s} s`, tip: `${x.frames} frames: a ${x.frames - 5}-frame loop`})), (x) => { LP.length = Number(x.id); upd(); }, "107");
  slider($("#l-res"), {label: "Size", min: 320, max: 768, step: 32, value: LP.short, fmt: (v) => { const s = CR.shotSize("9:16", v); return `${s.w}×${s.h}`; }, marks: [{name: "draft", value: 384}, {name: "native", value: 768}]}, (v) => { LP.short = v; upd(); });
  seg($("#l-engine"), [{id: "fast", name: "Draft · FastH3"}, {id: "full", name: "Final · H3 25 steps"}], (x) => { LP.engine = x.id; upd(); });
  $("#l-views").addEventListener("change", (e) => { LP.views = e.target.checked ? 2 : 1; upd(); });
  $("#l-look").replaceChildren(...PALETTES.map(p => h("option", {value: p.id}, p.id === "natural" ? "no grade" : p.name)));
  $("#l-look").addEventListener("change", (e) => { LP.look = e.target.value; upd(); });
  upd();
})();
function loopGraph(prefix = "valis/loop_x") {
  const s = CR.shotSize("9:16", LP.short);
  return G.loopShot({image: LP.image || "x.png", prompt: G.loopPrompt({subject: $("#l-subject").value.trim(), action: $("#l-action").value.trim()}), width: s.w, height: s.h,
    length: LP.length, engine: LP.engine, views: LP.views, look: LP.look === "natural" ? null : LP.look, prefix});
}
async function lest() { const e = await EST.estimate(loopGraph()); $("#l-run-sub").textContent = `MiniMax H3 Loop · ${EST.fmt(e)}`; $("#l-run").dataset.tip = `Time: ${e.basis}`; }
$("#l-run").addEventListener("click", async () => {
  if (!LP.image) return toast("Drop a still first", true);
  if (!(await api.hasNode("MiniMaxH3Loop"))) return toast("Loop needs the MiniMax H3 Loop pack: git clone https://github.com/pxl-pshr/ComfyUI-MiniMaxH3-Loop into custom_nodes, then restart ComfyUI", true);
  run(loopGraph(`valis/loop_${Date.now().toString(36)}`), `Loop · ${((LP.length - 5) / 24).toFixed(2)} s`, $("#l-viewer"), {onDone: (j) => {
    const v = j.outputs.find(f => /\.mp4$/i.test(f.filename)), gif = j.outputs.find(f => /\.gif$/i.test(f.filename));
    if (v) { $("#l-viewer").replaceChildren(media(v)); Bin.add(v, {from: "Extras", label: "loop"}); }
    $("#l-finish").replaceChildren(...(v ? [h("button", {class: "btn", type: "button", onclick: () => { Fx.setClip(api.fileRef(v), api.viewUrl(v), v.filename); $("#f-loop").checked = true; show("fx"); }}, "Add effects that loop", h("span", {class: "sub"}, "FX, with Loop on"))] : []),
      ...(gif ? [h("a", {class: "btn", href: api.viewUrl(gif), target: "_blank", rel: "noopener"}, "Open the GIF")] : []));
  }});
});

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
    await Bin.load();
    // renders made outside the studio's own buttons (or before the bin existed) join it from ComfyUI's history
    const hist = await api.history(120).catch(() => ({}));
    for (const e of Object.values(hist || {}).reverse()) for (const f of api.outputsOf(e))
      if ((f.type || "output") === "output" && /^valis|^danse/.test(f.subfolder || "") && /\.(mp4|webm|png|jpe?g)$/i.test(f.filename) && !/matte|overlay|anchor|_end_|_mask|control/i.test(f.filename)
          && !Bin.items.some(i => i.file.filename === f.filename && i.file.subfolder === f.subfolder)) Bin.add(f, {from: "ComfyUI", label: f.filename.replace(/_\d+_?\.\w+$/, "")});
    const items = Bin.items.filter(i => i.kind === "clip" || i.kind === "still").slice(0, 160);
    const grid = $("#r-grid");
    grid.replaceChildren(...items.map(it => {
      const url = Bin.url(it), isVid = it.kind === "clip";
      const pic = isVid ? h("video", {src: url, muted: true, preload: "metadata", playsinline: true, loop: true}) : h("img", {src: url, alt: "", loading: "lazy"});
      const t = h("div", {class: "thumb", tip: `<b>${esc(it.label || it.file.filename)}</b><br>${esc(it.from || "")} · ${esc(it.file.filename)}${it.prompt ? `<br><i>${esc(it.prompt.slice(0, 200))}</i>` : ""}`},
        pic, h("div", {class: "meta"}, it.label || it.file.filename.replace(/_\d+_\.\w+$/, "")));
      t.onclick = (e) => Bin.menu(it, e);
      t.draggable = true; t.addEventListener("dragstart", (e) => e.dataTransfer.setData("application/x-valis-item", JSON.stringify(it)));
      if (isVid) { t.onmouseenter = () => pic.play().catch(() => {}); t.onmouseleave = () => pic.pause(); }
      return t;
    }));
    if (!items.length) grid.replaceChildren(h("p", {class: "hint"}, "Nothing yet. Everything the studio makes lands here (and in the bin), saved in ComfyUI/output/valis/."));
  },
};
$("#r-free").addEventListener("click", async () => { await api.free(); toast("Models unloaded and memory freed"); });
$("#r-stop").addEventListener("click", async () => { await api.interrupt(); toast("Stopped the current job"); });

// ------------------------------------------------------------------ BIN: one strip of everything, sendable to any tab
Bin.mount($("#bin"));
Bin.load();
Bin.action({id: "create", label: "Create · first frame", kinds: ["still"], run: (it) => { useAsFirstFrame(it.file); toast("Set as the first frame"); }});
Bin.action({id: "edit", label: "Edit", kinds: ["clip"], run: (it) => { setClip(Bin.ref(it), Bin.url(it), it.label || it.file.filename); show("edit"); }});
Bin.action({id: "fx", label: "FX", kinds: ["clip"], run: (it) => { Fx.setClip(Bin.ref(it), Bin.url(it), it.label || it.file.filename); show("fx"); }});
Bin.action({id: "genjutsu", label: "Genjutsu · source", kinds: ["clip"], run: (it) => { gjSetClip(Bin.ref(it), Bin.url(it), it.label || it.file.filename); show("genjutsu"); }});
const binToggle = $("#binBtn");
const binCount = () => { binToggle.querySelector("b").textContent = Bin.items.length; };
Bin.on(binCount);
binToggle.addEventListener("click", () => { document.body.classList.toggle("binopen"); try { localStorage.setItem("valis.bin", document.body.classList.contains("binopen") ? "1" : "0"); } catch { /* */ } });
try { if (localStorage.getItem("valis.bin") === "1") document.body.classList.add("binopen"); } catch { /* storage off */ }
Bin.load().then(binCount);

// ---- the machine: what it is, what it can do, and the defaults that follow
let MACH = null;
async function machine() {
  const s = await api.systemStats().catch(() => null);
  if (!s?.devices) return;
  const d = s.devices[0];
  const free = (d.vram_free / 2 ** 30).toFixed(1), tot = (d.vram_total / 2 ** 30).toFixed(1);
  $("#vramPill").textContent = `VRAM ${free}/${tot} GB free`;
  $("#vramPill").dataset.tip = `GPU memory free right now. RAM ${(s.system.ram_free / 2 ** 30).toFixed(1)} of ${(s.system.ram_total / 2 ** 30).toFixed(1)} GB free.`;
}
async function detectMachine({apply = false} = {}) {
  const x = MACH = await MC.detect(), a = MC.advise(x);
  const row = (k, v, tip) => v == null || v === "" ? null : h("div", {class: "mrow", tip}, h("span", {}, k), h("b", {}, String(v)));
  const flags = x.flags ? Object.entries(x.flags).map(([k, v]) => v === true ? `--${k.replaceAll("_", "-")}` : `--${k.replaceAll("_", "-")} ${v}`).join(" ") : x.argv.slice(1).join(" ");
  const k = x.kernels ? Object.entries(x.kernels).filter(([, v]) => v.installed).map(([n, v]) => `${n}${v.version ? " " + v.version : ""}`).join(", ") || "none" : null;
  $("#r-machine").replaceChildren(...[
    row("GPU", x.gpu), row("memory", x.vramGB && `${x.vramGB} GB${x.vramFreeGB != null ? ` (${x.vramFreeGB} free)` : ""}`),
    row("compute", x.capability && `${x.capability}${x.fp8 ? " · fp8" : ""}${x.bf16 ? " · bf16" : ""}`),
    row("driver", x.driver && `${x.driver} · CUDA ${x.driverCuda}`), row("PyTorch", x.torch && `${x.torch}${x.cudnn ? " · cuDNN " + x.cudnn : ""}`),
    row("attention", x.attention, "Which attention kernel ComfyUI uses for every model"), row("kernels", k, "Installed attention and compile packages"),
    row("memory mode", x.vramState), row("RAM", x.ramGB && `${x.ramGB} GB${x.ramFreeGB != null ? ` (${x.ramFreeGB} free)` : ""}`),
    row("ComfyUI", x.comfy && `${x.comfy} · Python ${x.python}`), row("launch", flags || "(defaults)", "ComfyUI's command-line flags"),
    h("div", {class: "advice"}, h("div", {class: "adv ok"}, `Safe shot size: ${CR.shotSize("9:16", a.short).w}×${CR.shotSize("9:16", a.short).h} (${a.why})`),
      ...a.notes.map(n => h("div", {class: `adv ${n.level}`}, n.text)))].filter(Boolean));
  if (apply) { resCtl?.set(a.short); M.res?.set(a.short); toast(`Create's shot size set to ${a.short} px on the short side for this GPU`); }
  return a;
}
$("#r-detect").addEventListener("click", () => detectMachine({apply: true}));
// the first time the studio opens on a machine, its shot size follows the GPU
(async () => {
  let done = false; try { done = localStorage.getItem("valis.machineDefaults") === "1"; } catch { /* */ }
  const a = await detectMachine({apply: false});
  if (!done && a) { resCtl?.set(a.short); M.res?.set(a.short); try { localStorage.setItem("valis.machineDefaults", "1"); } catch { /* */ } }
})();

// ---- the end-to-end test (selftest.js), shown under Renders
async function testsUI(report) {
  report = report || await api.readUser("valis/selftest/latest.json", null);
  const T = await import("./selftest.js");
  const byId = Object.fromEntries((report?.tests || []).map(t => [t.id, t]));
  const icon = {pass: "✓", fail: "✗", error: "!", running: "…", waiting: "·"};
  $("#r-tests").replaceChildren(...T.TESTS.map(t => { const r = byId[t.id];
    return h("div", {class: `trow ${r?.status || ""}`, tip: esc(t.label)}, h("span", {class: "ti"}, icon[r?.status] || "·"), h("span", {class: "tn"}, `${t.id} ${t.label}`)); }));
  const res = (report?.tests || []).filter(t => t.status && t.status !== "waiting");
  $("#r-test-results").replaceChildren(...(res.length ? [h("h2", {class: "tr-h"}, `End-to-end test · ${report.run}${report.finished ? "" : " (running)"} · ${res.filter(t => t.status === "pass").length} of ${res.length} passed`),
    h("div", {class: "tgrid"}, ...res.map(t => h("div", {class: `tcard ${t.status}`},
      h("div", {class: "tt"}, h("b", {}, `${t.id} `), t.label, h("span", {class: "ts"}, ` ${t.status}${t.seconds ? ` · ${Math.round(t.seconds)} s` : ""}`)),
      t.strip ? h("img", {src: t.strip, alt: ""}) : t.keyframe ? h("img", {src: api.viewUrl(t.keyframe), alt: "", class: "tk"}) : null,
      h("div", {class: "tc"}, ...(t.checks || []).map(c => h("span", {class: c.pass ? "ok" : "bad", tip: esc(c.detail)}, `${c.pass ? "✓" : "✗"} ${c.name}`))),
      t.error ? h("div", {class: "terr"}, t.error) : null,
      t.prompts ? h("details", {}, h("summary", {}, "prompts"), h("pre", {}, `${t.prompts.keyframe}\n\n${t.prompts.motion}`)) : null)))] : []));
}
$("#r-test-run").addEventListener("click", async () => {
  const T = await import("./selftest.js");
  toast("End-to-end test started: the queue fills one combination at a time");
  T.run({onUpdate: (r) => testsUI(r)}).then((r) => toast(`End-to-end test: ${r.tests.filter(t => t.status === "pass").length} of ${r.tests.length} passed`));
});
$("#r-test-stop").addEventListener("click", async () => { (await import("./selftest.js")).stop(); toast("The test stops after the current combination"); });
testsUI();

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
// ------------------------------------------------------------------ FILM: one line, one film, step by step (film.js runs each step)
const M = {genre: null, shots: 6, plan: null, busy: false, short: CR.NATIVE_SHORT};
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
  ref: (f) => api.fileRef(f),
  free: () => api.free(),
  has: async (node) => !!(await api.objectInfo(node))[node],
  exists: async (f) => (await fetch(api.viewUrl(f), {method: "HEAD"})).ok,
};
const fsec = {};
function buildFilm() {
  const sec = (key, title, tip, ...kids) => (fsec[key] = section(title, {id: `m-sec-${key}`, tip}, ...kids));
  $("#m-sections").replaceChildren(
    sec("genre", "Genre", "The film's look: every keyframe starts with the genre's words.", h("div", {class: "cards", id: "m-genre"})),
    sec("shape", "Shots and size", "How many shots, and the size H3 shoots them at.",
      lab("Shots", "Each shot is one MiniMax H3 clip, cut to whole bars of the song."), h("div", {class: "seg", id: "m-shots-n"}),
      h("div", {id: "m-res", class: "ctl"})),
    sec("song", "Song", "Qwen3's song brief goes to YuE2, which writes the sheet music and plays it. Or use your own song: Valis hears its tempo and bars.",
      h("div", {class: "seg", id: "m-song-src"}),
      h("div", {class: "drop", id: "m-song-drop", style: "margin-top:8px; display:none"}, "Drop your song (wav, flac, mp3)", h("br"), h("span", {class: "hint"}, "the shots are cut on its bars, the effects fire on its beats"))),
  );
  cards($("#m-genre"), P.GENRES, (g) => { M.genre = g; fsec.genre.setValue(g.name); }, "gothic");
  seg($("#m-shots-n"), [4, 6, 8, 10, 12].map(n => ({id: String(n), name: String(n)})), (x) => { M.shots = Number(x.id); fshape(); }, "6");
  M.res = slider($("#m-res"), {label: "Shot size", min: 320, max: 1024, step: 32, value: M.short,
    tip: "The size H3 shoots every shot at (keyframes too). Smaller is much faster: try a draft at 384, then the film at native.",
    fmt: (v) => { const s = CR.shotSize("9:16", v); return `${s.w}×${s.h}${v === CR.NATIVE_SHORT ? " · native" : v < 512 ? " · draft" : ""}`; },
    marks: [{name: "draft", value: 384}, {name: "512", value: 512}, {name: "native", value: 768}]}, (v) => { M.short = v; fshape(); });
  seg($("#m-song-src"), [{id: "yue", name: "YuE2 writes it"}, {id: "own", name: "My song"}], (x) => {
    M.songSrc = x.id; $("#m-song-drop").style.display = x.id === "own" ? "" : "none"; fsec.song.setValue(x.id === "own" ? (M.ownSong ? M.ownSong.name : "your song") : "YuE2");
  }, "yue");
  dropzone($("#m-song-drop"), "audio/*", async (f) => {
    const u = await api.upload(f); M.ownSong = {ref: api.inputRef(u), name: f.name, url: URL.createObjectURL(f)};
    fillDrop($("#m-song-drop"), h("audio", {src: M.ownSong.url, controls: true, style: "width:100%"}), h("span", {}, f.name));
    fsec.song.setValue(f.name);
    if (M.plan) { M.plan.song.file = M.ownSong.ref; M.plan.song.fileName = f.name; M.plan.music = null; fsave(); fdraw(); }
  });
  $("#m-song-drop")._onItem = (it) => { if (it.kind !== "audio") return; M.ownSong = {ref: Bin.ref(it), name: it.file.filename, url: Bin.url(it)}; fsec.song.setValue(it.file.filename); };
}
function fshape() { const s = CR.shotSize("9:16", M.short); fsec.shape?.setValue(`${M.shots} shots · ${s.w}×${s.h}`); if (M.plan && !M.busy) { M.plan.size = {w: s.w, h: s.h}; fsteps(); } }
// ---- the plan, kept in ComfyUI/user/default/valis/films/<tag>.json so a reload (or another day) picks it up
let fsaveT = null;
function fsave() {
  if (!M.plan) return;
  clearTimeout(fsaveT);
  const plan = JSON.parse(JSON.stringify(M.plan, (k, v) => (v && typeof v === "object" && v.commit && !v.filename) ? undefined : v));
  fsaveT = setTimeout(() => api.writeUser(`valis/films/${M.plan.tag}.json`, {...plan, genre: M.genre?.id, saved: Date.now()}).then(frecent).catch(() => {}), 600);
}
async function frecent() {
  let list = [];
  try { list = await (await fetch(`/api/userdata?dir=${encodeURIComponent("valis/films")}&recurse=false&full_info=true`)).json(); } catch { /* none */ }
  list = (Array.isArray(list) ? list : []).filter(f => /\.json$/.test(f.path || f)).sort((a, b) => (b.modified || 0) - (a.modified || 0)).slice(0, 8);
  $("#m-recent").replaceChildren(...(list.length ? [h("span", {class: "hint"}, "Recent: "), ...list.map(f => {
    const p = f.path || f, tag = p.replace(/^.*\//, "").replace(/\.json$/, "");
    return h("button", {class: "chip" + (M.plan?.tag === tag ? " on" : ""), type: "button", onclick: () => fopen(p)}, tag);
  })] : []));
  for (const b of $$("#m-recent .chip")) {               // name them by title
    const p = `valis/films/${b.textContent}.json`;
    api.readUser(p).then(pl => { if (pl?.title) { b.textContent = pl.title; b.dataset.tip = esc(pl.logline || ""); } });
  }
}
async function fopen(path) {
  const pl = await api.readUser(path.startsWith("valis/") ? path : `valis/films/${path}`);
  if (!pl) return toast("Couldn't read that film's plan", true);
  M.plan = pl; M.genre = P.GENRES.find(g => g.id === pl.genre) || M.genre;
  // the panel follows the plan: its genre, its shot count, its size
  $$("#m-genre .card").forEach(c => c.classList.toggle("on", c.dataset.id === M.genre?.id)); fsec.genre.setValue(M.genre?.name || "");
  M.shots = pl.shots.length; $$("#m-shots-n button").forEach(b => b.classList.toggle("on", Number(b.dataset.id) === M.shots));
  if (pl.size) { const short = Math.min(pl.size.w, pl.size.h); M.short = short; M.res?.set(short); }
  $("#m-idea").value = pl.idea || "";
  fdraw(); frecent();
  if (pl.film) { $("#m-viewer").replaceChildren(media(pl.film)); finishBar($("#m-finish"), pl.film, $("#m-viewer"), null); }
}
// ---- the steps panel: what each step makes, how much is done, a button to run it alone
const STEPS = [
  {id: "song", name: "Song", tip: "YuE2 writes and plays the song (or Valis reads yours). Its bar sets every shot's length."},
  {id: "keys", name: "Keyframes", tip: "Krea 2 frames every shot. Look at them before anything is shot: re-roll one, edit its words, or open it in Create."},
  {id: "shots", name: "Shots", tip: "MiniMax H3 shoots each keyframe."},
  {id: "fx", name: "Effects", tip: "SAM 3 finds each shot's subject; its effect fires on the song's lane, with its sound, in the song's key."},
  {id: "cut", name: "Cut", tip: "Every shot trimmed to its bars and joined on the song, with a title card at the end."},
];
async function fsteps() {
  const p = M.plan, el = $("#m-steps");
  if (!p) { el.replaceChildren(h("p", {class: "hint"}, "Plan the film first: nothing renders until you press a step.")); return; }
  const n = p.shots.length, cnt = (f) => p.shots.filter(f).length;
  const state = {song: p.music?.audio ? 1 : 0, keys: cnt(s => s.key) / n, shots: cnt(s => s.clip) / n, fx: cnt(s => s.fx) / n, cut: p.film ? 1 : 0};
  const label = {song: p.music?.audio ? `${p.music.bar.bpm} BPM · ${p.music.cut.bars} bar${p.music.cut.bars > 1 ? "s" : ""} a shot` : p.song.file ? "your song" : "YuE2",
    keys: `${cnt(s => s.key)} of ${n}`, shots: `${cnt(s => s.clip)} of ${n}`, fx: `${cnt(s => s.fx)} of ${n}`, cut: p.film ? "done" : ""};
  const {w, hh = sizeOfPlan(p).h} = sizeOfPlan(p);
  const est = {
    song: await EST.estimate(p.song.file ? G.scoreMake({audio: "x"}) : G.song({style: "x", lyrics: "x", seconds: Math.min(60, Math.ceil(n * 4.46 + 2))}).graph),
    keys: await EST.estimate(G.filmKeyframes({prompts: p.shots.filter(s => !s.key).map(() => "x"), width: w, height: hh})),
    shots: await EST.estimate(G.shot({image: "x", motion: "x", width: w, height: hh, seconds: 107 / 24})),
    fx: await EST.estimate(G.fx({clip: "x", layers: [{effect: "Punch", on: "kick"}]})), cut: {seconds: 20, measured: false},
  };
  const left = {song: 1 - state.song, keys: n - cnt(s => s.key), shots: n - cnt(s => s.clip), fx: n - cnt(s => s.fx), cut: 1 - state.cut};
  const t = (id) => { const e = est[id]; if (!left[id]) return ""; const k = id === "song" || id === "cut" || id === "keys" ? 1 : left[id]; return EST.fmt({...e, seconds: e.seconds * k}); };
  el.replaceChildren(...STEPS.map(st => h("div", {class: "step" + (state[st.id] >= 1 ? " done" : state[st.id] > 0 ? " part" : ""), tip: st.tip},
    h("i", {class: "sdot"}), h("div", {class: "sn"}, h("b", {}, st.name), h("span", {}, label[st.id])),
    h("button", {class: "btn small", type: "button", disabled: M.busy, onclick: () => fstep(st.id)}, state[st.id] >= 1 ? "again" : "run", h("span", {class: "sub"}, t(st.id) || "")))));
  const total = Object.keys(left).reduce((a, k) => a + (left[k] ? est[k].seconds * (k === "shots" || k === "fx" ? left[k] : 1) : 0), 0);
  $("#m-make-sub").textContent = total ? `every step still missing · ${EST.fmt({seconds: total, measured: Object.values(est).every(e => e.measured)})}` : "all done";
  $("#m-make").disabled = M.busy;
}
const sizeOfPlan = (p) => p.size || (() => { const s = CR.shotSize("9:16", M.short); return {w: s.w, h: s.h}; })();
async function fstep(id, only = null) {
  if (!M.plan || M.busy) return;
  M.busy = true; fsteps(); fdraw();
  const p = M.plan, onStage = (stage, msg) => { $("#m-status").textContent = msg; };
  p.size = p.size || sizeOfPlan(p);
  try {
    if (id === "song") { if (!only) p.music = null; await makeSong(p, filmIO, {onStage}); }
    if (id === "keys") await frameShots(p, filmIO, {genre: M.genre, only, onStage});
    if (id === "shots") await shootShots(p, filmIO, {genre: M.genre, only, onStage});
    if (id === "fx") { if (!p.music?.audio) await makeSong(p, filmIO, {onStage}); await effectShots(p, filmIO, {only, onStage}); }
    if (id === "cut") { await cutFilm(p, filmIO, {onStage}); $("#m-viewer").replaceChildren(media(p.film)); finishBar($("#m-finish"), p.film, $("#m-viewer"), null); Bin.add(p.film, {from: "Film", label: p.title}); }
    $("#m-status").textContent = "";
  } catch (e) { toast(e.message, true); $("#m-status").textContent = e.message; }
  finally { M.busy = false; $("#m-progress").replaceChildren(); fsave(); fdraw(); fsteps(); }
}
// ---- the script and the shot cards
function fdraw() {
  const p = M.plan, box = $("#m-planbox");
  filmActions();
  if (!p) { box.replaceChildren(); $("#m-shots").replaceChildren(); fsteps(); return; }
  const field = (label, get, set, tip) => h("div", {class: "maprow", tip}, h("label", {}, label), h("input", {type: "text", value: get() || "", oninput: (e) => { set(e.target.value); fsave(); }}));
  box.replaceChildren(...[
    h("div", {class: "ptitle"}, h("input", {class: "title", type: "text", value: p.title, oninput: (e) => { p.title = e.target.value; fsave(); }}),
      h("span", {class: "hint"}, `${p.shots.length} shots · ${sizeOfPlan(p).w}×${sizeOfPlan(p).h}`)),
    h("input", {class: "logline", type: "text", value: p.logline || "", oninput: (e) => { p.logline = e.target.value; fsave(); }}),
    ...p.cast.map((c, i) => field(c.name || `cast ${i + 1}`, () => c.look, (v) => { c.look = v; }, "How this character looks: goes into every keyframe they're in, so they stay the same from shot to shot")),
    field("place", () => p.place, (v) => { p.place = v; }, "The setting: goes into every keyframe"),
    p.song.file ? h("div", {class: "maprow"}, h("label", {}, "song"), h("span", {class: "hint"}, p.song.fileName || "your song"))
      : field("song", () => p.song.style, (v) => { p.song.style = v; p.music = null; }, "YuE2's brief: genre, instruments, mood, tempo"),
    p.music?.audio ? h("audio", {src: api.viewUrl(p.music.audio), controls: true, class: "songbar"}) : null].filter(Boolean));
  const thumb = (f, label, empty) => f ? h("div", {class: "fm", tip: label, onclick: () => $("#m-viewer").replaceChildren(media(f))}, media(f, {controls: false, autoplay: false}), h("span", {}, label))
    : h("div", {class: "fm empty"}, h("span", {}, empty));
  $("#m-shots").replaceChildren(...p.shots.map((sh, k) => {
    const card = h("div", {class: "fshot"},
      h("div", {class: "fh"}, h("b", {}, String(k + 1)), h("span", {class: "who"}, (sh.who || []).join(", ") || "no one"),
        h("span", {class: "fbtns"},
          h("button", {class: "ibtn", type: "button", disabled: M.busy, tip: "A new keyframe for this shot (a new seed)", onclick: () => { sh.keySeed = (sh.keySeed ?? 7101 + k) + 101; fstep("keys", [k]); }}, "⟳ still"),
          h("button", {class: "ibtn", type: "button", disabled: M.busy || !sh.key, tip: "Shoot (or re-shoot) this shot with H3", onclick: () => { if (sh.clip) sh.shotSeed = (sh.shotSeed ?? 51101 + k) + 1; fstep("shots", [k]); }}, "▶ shoot"),
          h("button", {class: "ibtn", type: "button", tip: "Work on this shot in Create (camera, light, palette, trained moves), then send the still or the shot back here", onclick: () => toCreate(k)}, "Create ↗"))),
      h("div", {class: "fmedia"}, thumb(sh.key, "keyframe", "no still yet"), thumb(sh.clip, "shot", "not shot"), thumb(sh.fx, "with effects", "no effects")),
      h("textarea", {rows: 2, tip: "The still frame (Krea 2). The cast's looks and the place are added to it.", oninput: (e) => { sh.keyframe = e.target.value; fsave(); }}, sh.keyframe),
      h("input", {type: "text", value: sh.motion, placeholder: "what moves", tip: "What moves in the shot (H3)", oninput: (e) => { sh.motion = e.target.value; fsave(); }}),
      h("div", {class: "frow"},
        h("input", {type: "text", value: sh.subject, placeholder: "subject", tip: "What SAM 3 tracks for the effect", oninput: (e) => { sh.subject = e.target.value; fsave(); }}),
        h("select", {tip: "The effect", onchange: (e) => { sh.effect = e.target.value; sh.fx = null; fsave(); fsteps(); }}, ...G.FILM_EFFECTS.map(x => h("option", {value: x, selected: x === sh.effect}, x))),
        h("select", {tip: "The lane of the song that fires it", onchange: (e) => { sh.on = e.target.value; sh.fx = null; fsave(); fsteps(); }}, ...G.FILM_LANES.map(x => h("option", {value: x, selected: x === sh.on}, `on ${x}`)))));
    // drop a still or a clip from the bin onto a shot
    card.addEventListener("dragover", (e) => { e.preventDefault(); card.classList.add("over"); });
    card.addEventListener("dragleave", () => card.classList.remove("over"));
    card.addEventListener("drop", (e) => { e.preventDefault(); card.classList.remove("over"); const raw = e.dataTransfer.getData("application/x-valis-item"); if (raw) toShot(k, JSON.parse(raw)); });
    return card;
  }));
  fsteps();
}
function toShot(k, it) {
  const sh = M.plan?.shots[k]; if (!sh) return;
  if (it.kind === "still") { sh.key = it.file; sh.clip = null; sh.fx = null; toast(`Shot ${k + 1}: new keyframe`); }
  else if (it.kind === "clip") { sh.clip = it.file; sh.fx = null; toast(`Shot ${k + 1}: new shot`); }
  else return;
  fsave(); fdraw();
}
// Open a shot in Create: its words, its still as the first frame; Create offers to send the result back
let FILM_RETURN = null;
function toCreate(k) {
  const p = M.plan, sh = p.shots[k];
  const cast = (p.cast || []).filter(c => !sh.who || sh.who.some(w => (c.name || "").toLowerCase().includes(w.toLowerCase()) || w.toLowerCase().includes((c.name || "").toLowerCase())));
  $("#c-subject").value = [sh.keyframe, ...cast.map(c => c.look), p.place].filter(Boolean).join(" ");
  $("#c-action").value = sh.motion || ""; $("#c-who").value = sh.subject || "";
  FILM_RETURN = {tag: p.tag, k};
  if (sh.key) pickKey(sh.key, null);
  cchanged(); show("create"); filmReturnBar();
}
function filmReturnBar() {
  const bar = $("#c-film-return");
  if (!FILM_RETURN || FILM_RETURN.tag !== M.plan?.tag) { bar?.remove(); return; }
  const k = FILM_RETURN.k, el = bar || h("div", {id: "c-film-return", class: "filmret"});
  el.replaceChildren(h("span", {}, `Working on ${M.plan.title}, shot ${k + 1}`),
    h("button", {class: "btn small", type: "button", tip: "The keyframe picked here becomes the film's still for this shot", onclick: () => {
      if (!C.picked?.filename) return toast("Pick a keyframe first", true);
      toShot(k, {kind: "still", file: C.picked}); show("film"); }}, "Use the picked still"),
    h("button", {class: "btn small", type: "button", tip: "The last shot made here becomes the film's shot", onclick: () => {
      const v = Bin.items.find(i => i.kind === "clip" && i.from === "Create");
      if (!v) return toast("Shoot it here first", true);
      toShot(k, v); show("film"); }}, "Use the last shot"),
    h("button", {class: "linkbtn", type: "button", onclick: () => { FILM_RETURN = null; filmReturnBar(); }}, "done"));
  if (!bar) $("#view-create .stage").prepend(el);
}
$("#m-plan").addEventListener("click", async () => {
  const idea = $("#m-idea").value.trim();
  if (!idea) return toast("Say what the film is about first", true);
  if (M.busy) return;
  M.busy = true; $("#m-plan").disabled = true;
  try {
    $("#m-status").textContent = "Qwen3 is writing the cast, the song brief and the shot list";
    M.plan = await planFilm({idea, shots: M.shots, genre: M.genre}, filmIO);
    const s = CR.shotSize("9:16", M.short); M.plan.size = {w: s.w, h: s.h};
    if (M.songSrc === "own" && M.ownSong) { M.plan.song.file = M.ownSong.ref; M.plan.song.fileName = M.ownSong.name; }
    $("#m-progress").replaceChildren();
    $("#m-status").textContent = `Planned: ${M.plan.title}. Edit anything, then run the steps one by one, or Make the rest.`;
    fsave(); fdraw();
  } catch (e) { toast(e.message, true); $("#m-status").textContent = e.message; }
  finally { M.busy = false; $("#m-plan").disabled = false; fsteps(); }
});
$("#m-make").addEventListener("click", async () => {
  if (!M.plan || M.busy) return;
  M.busy = true; fsteps(); fdraw();
  const t0 = Date.now(), p = M.plan;
  p.size = p.size || sizeOfPlan(p);
  try {
    const r = await makeFilm(p, filmIO, {genre: M.genre, onStage: (stage, msg) => { $("#m-status").textContent = msg; }, onStep: () => { fsave(); fdraw(); }});
    $("#m-progress").replaceChildren();
    $("#m-viewer").replaceChildren(media(r.film)); finishBar($("#m-finish"), r.film, $("#m-viewer"), null);
    Bin.add(r.film, {from: "Film", label: p.title});
    $("#m-status").textContent = `${p.title}: ${r.fxed.length} shots of ${r.cut.bars} bar${r.cut.bars > 1 ? "s" : ""} at ${r.bar.bpm} BPM, ${Math.round((Date.now() - t0) / 60000)} min. Saved ${r.film.subfolder}/${r.film.filename}`;
    toast(`Film saved: ${r.film.filename}`);
  } catch (e) { toast(e.message, true); $("#m-status").textContent = e.message; }
  finally { M.busy = false; fsave(); fdraw(); }
});
buildFilm(); frecent(); fsteps();
EST.estimate(G.filmPlan({idea: "x"})).then(e => { $("#m-plan-sub").textContent = `Qwen3 · ${EST.fmt(e)}`; });
// a still or clip from the bin straight onto a shot of the open film (one menu entry per shot)
function filmActions() {
  Bin.actions = Bin.actions.filter(a => !/^film\d+$/.test(a.id));
  (M.plan?.shots || []).forEach((sh, k) => Bin.action({id: `film${k + 1}`, label: `Film · shot ${k + 1}`, kinds: ["still", "clip"], run: (it) => { toShot(k, it); show("film"); }}));
}

// ---- tooltips for the controls written in index.html
const TIPS = {
  "#queuePill": "Jobs waiting in ComfyUI's queue (from any client)", "#conn": "Whether the studio can reach this ComfyUI",
  // genjutsu
  "#g-clip": "The performance: its motion, camera, timing and sound are kept. 4 to 15 seconds; a body that stays in frame works best",
  "#g-refs": "Up to 8 pictures. Each is &lt;Picture N&gt; in the prompt, with the role you give it: who, where, what style, what outfit",
  "#g-target": "Name what to replace: SAM 3 finds it in every frame", "#g-keep": "H3 re-renders the whole frame; this pastes only the new object back onto the original frames, so faces and sky don't drift",
  "#g-edges": "On: the new object follows the old one's edges (Canny), for clothes and things. Off: it follows the body's pose (SDPose)",
  "#g-prompt": "What H3 is told. Built from your choices; edit it freely", "#g-audio": "Keep the source clip's own sound on the result",
  "#g-turbo": "8 steps instead of 20 with the turbo LoRA (or FastH3, under Renders, Engine): faster, a little rougher",
  "#g-check": "Reads the body in every frame (SDPose) and says where motion transfer will hold and where it will warp, before the long render",
  // edit
  "#e-clip": "The clip to change: a video you drop, or one from the bin", "#e-target": "Name what to change, as you'd say it: the man, his head, her dress, the car. SAM 3 follows it through every frame",
  "#e-looks": "What it becomes. The look's words go to Krea 2 (the new first and last frames) and to H3",
  "#e-char": "The character who replaces the person: an upper-body or full-body sheet works best", "#e-look": "Their hair, face and clothes in words: helps H3 keep them",
  "#e-bg": "Optional: a new place. The take is keyed onto it first, so the new scene and the new character are lit together",
  "#e-match": "After the swap, match its tone, colour and grain to the plate (no AI)", "#e-clipb": "The second take: the one it turns into",
  "#e-wave": "The first take's sound. Click the word where it turns; double-click for the automatic pick (after the longest pause)",
  "#e-voice": "The voice turns on the same word: deeper, a bigger throat, a growl", "#e-prompt": "What Krea 2 is told for the new first and last frames. Built from the look; edit freely",
  "#e-rb": "Low: the look takes over (a whole new face). High: the shape is kept and only the material changes",
  "#e-grow": "How far past the thing's edge the re-render reaches: more covers hair and loose clothes, less keeps the background untouched",
  "#e-audio": "Keep the clip's own sound", "#e-find": "Shows what SAM 3 finds for that name, as an overlay, before the long render",
  // fx
  "#f-clip": "The clip the effects go on", "#f-clip-sel": "Or one from the studio's renders", "#f-other-sel": "A second clip, for effects that show another scene (tear, shatter, time slip, double exposure, split, era cut)",
  "#f-subject": "SAM 3 follows this for effects that are about someone (echo, lens, vertigo, double exposure)",
  "#f-song": "Valis hears its beats, kick, snare and hats, and how loud and bright it is: those are the lanes effects listen to",
  "#f-style": "YuE2's brief: genre, instruments, mood, tempo", "#f-lyrics": "Lyrics with [verse] and [chorus], or [Instrumental]", "#f-secs": "How long the song is",
  "#f-cues": "No music: write the hits yourself. Seconds or bar:beat, a lane name, an optional strength; 'every' for grids, 'ramp' for held curves",
  "#f-loop": "For a loop from Extras: the effects repeat with it, played once round first so trails and frost carry across the join",
  "#f-sound": "Each effect makes its own sound on the same frame it fires, synthesised in the song's key, held under the music",
  "#f-beds": "Background sound under everything",
  // renders
  "#r-free": "Unload every model and free GPU and system memory", "#r-stop": "Stop the job that is running now",
  "#r-engine": "Which model renders Edit, Genjutsu and video relight. FastH3 is the same model distilled to 8 steps", "#r-check": "Check every workflow against this ComfyUI again (after installing something)",
  "#r-test-run": "Renders every Create combination at 384 px, about 3 s each, and checks each result: size, length, motion, colour, sound. About 2 minutes a combination",
};
for (const [sel, tip] of Object.entries(TIPS)) { const el = $(sel); if (el && !el.dataset.tip) el.dataset.tip = tip; }

$("#helpBtn").addEventListener("click", () => { const ov = showHelp(); ov.querySelectorAll(".hn").forEach(n => n.addEventListener("click", () => { const v = n.dataset.view; if (v !== "bin") { ov.remove(); show(v); } else { ov.remove(); document.body.classList.add("binopen"); } })); });
buildCreate();
show((location.hash || "#film").slice(1));
refreshPrompt();
// estimates learn from ComfyUI's history once it's read; every button's time is worked out again then
EST.learnFromHistory().then(() => { cchanged(); fsteps(); xest(); lest(); Score.estimates(); editEst(); gjEst(); fxEst(); });
