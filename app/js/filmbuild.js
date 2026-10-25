// The Film tab's groundwork: the references (a sheet per character, per state of one, per prop), the sets (the empty set
// from every camera setup) and the frames (who is where in a setup at one moment). Each is a card you write, make,
// re-roll and look at before any shot is built from it. film.js makes them (makeRefs, makeSetups, makeFrames); this
// file only draws the cards and the close-up box a shot cuts from its frame.
import * as api from "./api.js";
import {h, media, toast} from "./ui.js";
import {byName} from "./film.js";

// a picture from disk becomes one of ComfyUI's input files, so a plan can hold it like any result
export async function uploadImage(file) {
  const fd = new FormData();
  fd.append("image", file); fd.append("type", "input"); fd.append("subfolder", "valis_refs");
  const r = await fetch("/upload/image", {method: "POST", body: fd});
  if (!r.ok) throw new Error(`upload failed: ${r.status}`);
  const j = await r.json();
  return {filename: j.name, subfolder: j.subfolder || "", type: j.type || "input"};
}

// a card's picture: click to look at it big; drop a still from the bin or a picture from disk to use it instead
function thumb(f, empty, {view, onPick}) {
  const el = f ? h("div", {class: "fm", tip: "Click to look at it. Drop a still from the bin, or a picture from disk, to use that instead", onclick: () => view(f)}, media(f, {controls: false, autoplay: false}))
    : h("div", {class: "fm empty", tip: "Make it, or drop a still from the bin or a picture from disk"}, h("span", {}, empty));
  el.addEventListener("dragover", (e) => { e.preventDefault(); el.classList.add("over"); });
  el.addEventListener("dragleave", () => el.classList.remove("over"));
  el.addEventListener("drop", async (e) => {
    e.preventDefault(); el.classList.remove("over");
    try {
      const file = e.dataTransfer.files[0];
      if (file) { if (!/^image\//.test(file.type)) return toast("Drop a picture", true); return onPick(await uploadImage(file)); }
      const raw = e.dataTransfer.getData("application/x-valis-item");
      if (raw) { const it = JSON.parse(raw); if (it.kind !== "still") return toast("Drop a still", true); onPick(it.file); }
    } catch (er) { toast(er.message, true); }
  });
  return el;
}
const nameInput = (x, list, save, redraw, what) => h("input", {class: "bname", type: "text", value: x.name || "", tip: `The ${what}'s name: the script, the frames and the shots call it by this`,
  onchange: (e) => {
    const v = e.target.value.trim(), old = x.name;
    if (!v) { e.target.value = old; return; }
    if (list.some(y => y !== x && y.name === v)) { toast(`There is already a ${what} called ${v}`, true); e.target.value = old; return; }
    x.name = v; rename(x._plan, old, v); save(); redraw();
  }});
// a name changed: everything that calls it by that name follows
function rename(p, a, b) {
  if (!p || a === b) return;
  const swap = (arr) => Array.isArray(arr) ? arr.map(n => n === a ? b : n) : arr;
  for (const c of p.cast || []) { if (c.from === a) c.from = b; c.with = swap(c.with); }
  for (const su of p.setups || []) if (su.from === a) su.from = b;
  for (const f of p.frames || []) { if (f.from === a) f.from = b; if (f.setup === a) f.setup = b; f.with = swap(f.with); }
  for (const s of p.shots || []) { if (s.frame === a) s.frame = b; s.with = swap(s.with); s.who = swap(s.who); }
}
// toggles for who is in it
export function whoChips(names, on, set, tip) {
  return h("div", {class: "bchips", tip}, ...names.map(n => h("button", {type: "button", class: "chip small" + (on.includes(n) ? " on" : ""),
    onclick: () => set(on.includes(n) ? on.filter(x => x !== n) : [...on, n])}, n)));
}
const uniq = (list, base) => { let n = base, k = 2; while (list.some(x => x.name === n)) n = `${base} ${k++}`; return n; };
const people = (p) => (p.cast || []).map(c => c.name).filter(Boolean);

// ctx: {busy, save(), redraw(), run(step, only), view(file)}
export function drawBuild(el, p, ctx) {
  const {busy, save, redraw, run, view} = ctx;
  p.cast = p.cast || []; p.setups = p.setups || []; p.frames = p.frames || [];
  for (const x of [...p.cast, ...p.setups, ...p.frames]) Object.defineProperty(x, "_plan", {value: p, enumerable: false, configurable: true});
  const sec = (title, tip, add, cards) => h("div", {class: "bsec"},
    h("div", {class: "bhead"}, h("h3", {}, title), h("span", {class: "hint"}, tip), ...add),
    h("div", {class: "shots"}, ...cards));
  const head = (x, list, what, step, i, extra = []) => h("div", {class: "fh"}, nameInput(x, list, save, redraw, what), h("span", {class: "fbtns"}, ...extra,
    h("button", {class: "ibtn", type: "button", disabled: busy, tip: x[step.file] ? "Make it again with a new seed" : "Make it", onclick: () => {
      if (x[step.file]) x.seed = (x.seed ?? step.seed + 10 * i) + 101; x[step.file] = null; run(step.id, [i]); }}, x[step.file] ? "⟳" : "make"),
    h("button", {class: "ibtn", type: "button", disabled: busy, tip: `Remove this ${what}`, onclick: () => { list.splice(i, 1); save(); redraw(); }}, "×")));
  const text = (x, key, rows, ph, tip) => h("textarea", {rows, placeholder: ph, tip, oninput: (e) => { x[key] = e.target.value; save(); }}, x[key] || "");

  // ---- references
  const refCards = p.cast.map((c, i) => {
    const others = people(p).filter(n => n !== c.name), src = c.from ? "from" : c.with?.length || c.with ? "with" : "paint";
    const card = h("div", {class: "fshot bcard"},
      head(c, p.cast, "reference", {id: "refs", file: "sheet", seed: 8301}, i),
      h("div", {class: "bmedia"}, thumb(c.sheet, "no sheet yet", {view, onPick: (f) => { c.sheet = f; save(); redraw(); }})),
      h("select", {tip: "What the sheet is made from", onchange: (e) => {
        const v = e.target.value; delete c.from; delete c.with; c.sheet = null;
        if (v === "@with") c.with = []; else if (v !== "@paint") c.from = v;
        save(); redraw(); }},
        h("option", {value: "@paint", selected: src === "paint"}, "painted from its words"),
        ...others.map(n => h("option", {value: n, selected: c.from === n}, `a change of ${n}`)),
        h("option", {value: "@with", selected: src === "with"}, "a picture of others")),
      src === "with" ? whoChips(others, c.with || [], (w) => { c.with = w; c.sheet = null; save(); redraw(); }, "Whose sheets go into this picture, in this order (Picture 1, 2…)") : null,
      src === "from" ? text(c, "edit", 3, `What is different about ${c.name} (e.g. soaked through, pondweed in her hair, clouded eyes)`, `An edit of ${c.from}'s sheet: everything you don't name stays the same`)
        : text(c, "look", 3, src === "with" ? "What the picture shows (e.g. their wedding photograph, sepia, 1920s)" : "Who they are and what they wear, exactly: age, face, hair, clothes, what they hold",
          src === "with" ? "The picture, with the sheets above in it" : "A costume-test portrait is painted from these words (Krea 2)"),
      h("label", {class: "bkind", tip: "A prop is painted as a close-up object, not a portrait"}, h("input", {type: "checkbox", checked: c.kind === "prop", onchange: (e) => { c.kind = e.target.checked ? "prop" : undefined; save(); }}), " a prop"));
    return card;
  });
  const addRef = (kind) => h("button", {class: "ibtn", type: "button", disabled: busy, onclick: () => { p.cast.push({name: uniq(p.cast, kind === "prop" ? "the prop" : "someone"), look: "", ...(kind === "prop" ? {kind} : {})}); save(); redraw(); }}, kind === "prop" ? "+ prop" : "+ character");

  // ---- sets: the empty set from every camera setup
  const setCards = p.setups.map((su, i) => {
    const others = p.setups.filter(x => x !== su).map(x => x.name);
    return h("div", {class: "fshot bcard"},
      head(su, p.setups, "setup", {id: "sets", file: "plate", seed: 8601}, i),
      h("div", {class: "bmedia"}, thumb(su.plate, "no plate yet", {view, onPick: (f) => { su.plate = f; save(); redraw(); }})),
      h("select", {tip: "A setup is painted, or another setup's empty plate turned (turn the empty plate, never a frame with people in it)", onchange: (e) => {
        const v = e.target.value; delete su.from; su.plate = null; if (v !== "@paint") su.from = v; save(); redraw(); }},
        h("option", {value: "@paint", selected: !su.from}, "painted: the film's look, the view, the place"),
        ...others.map(n => h("option", {value: n, selected: su.from === n}, `the ${n}, turned`))),
      su.from ? text(su, "turn", 2, "e.g. from the opposite side of the table, low, looking back where the camera was", "Where the camera is now, on the same empty place")
        : text(su, "view", 3, "e.g. High wide shot looking down at the empty table: four bentwood chairs, the red lamp, the photograph", "The camera and what's in the empty set. The film's look and the place are added"));
  });
  const addSet = h("button", {class: "ibtn", type: "button", disabled: busy, onclick: () => {
    const first = p.setups[0]; p.setups.push(first ? {name: uniq(p.setups, "reverse"), from: first.name, turn: ""} : {name: "master", view: ""}); save(); redraw(); }}, "+ setup");

  // ---- frames: a setup at one moment
  const frameCards = p.frames.map((f, i) => {
    const others = p.frames.filter(x => x !== f).map(x => x.name);
    return h("div", {class: "fshot bcard"},
      head(f, p.frames, "frame", {id: "frames", file: "still", seed: 8401}, i),
      h("div", {class: "bmedia"}, thumb(f.still, "not made yet", {view, onPick: (x) => { f.still = x; save(); redraw(); }})),
      h("select", {tip: "A frame seats people into a setup's empty plate, or changes the frame before it (so nothing changes that you don't change)", onchange: (e) => {
        const [k, v] = e.target.value.split(":"); delete f.from; delete f.setup; f[k] = v; f.still = null; save(); redraw(); }},
        ...p.setups.map(su => h("option", {value: `setup:${su.name}`, selected: !f.from && f.setup === su.name}, `seated in the ${su.name}`)),
        ...others.map(n => h("option", {value: `from:${n}`, selected: f.from === n}, `a change of ${n}`))),
      whoChips(people(p), f.with || [], (w) => { f.with = w; f.still = null; save(); redraw(); }, f.from ? "Who arrives at this moment (their sheets join everyone already there)" : "Who is in this frame: their sheets are seated into the plate"),
      f.from ? h("div", {class: "bgone"}, h("span", {class: "hint"}, "gone:"), whoChips(people(p), f.gone || [], (w) => { f.gone = w; f.still = null; save(); redraw(); }, "Who has left by this moment")) : null,
      f.from ? text(f, "edit", 3, "What has changed by now, e.g. the seat of the empty chair is soaking wet, water dripping onto the floor", "Painted fresh from the setup's plate: the blocking, then every change so far, in order")
        : text(f, "seat", 4, "Who sits where, facing where, doing what, e.g. the medium sits on the far chair behind the lamp, facing us…", "The blocking: say where each person is in the picture; anything you don't seat isn't there"));
  });
  const addFrame = h("button", {class: "ibtn", type: "button", disabled: busy || !p.setups.length, tip: p.setups.length ? "" : "Add a setup first", onclick: () => {
    const last = p.frames[p.frames.length - 1];
    p.frames.push(last ? {name: uniq(p.frames, "frame"), from: last.name, with: [], edit: ""} : {name: "frame 1", setup: p.setups[0].name, with: people(p), seat: ""});
    save(); redraw(); }}, "+ frame");

  el.replaceChildren(
    sec("References", "a sheet for every character, every state of one, every prop: every shot they're in is built from it", [addRef("person"), addRef("prop")], refCards),
    sec("Sets", "the set, empty, from every camera setup", [addSet], setCards),
    sec("Frames", "who is where in a setup at one moment; a change is an edit of the frame before", [addFrame], frameCards));
}

// A shot's close-up: a box on its frame (the frame and the shot have the same shape, so the box is a square in fractions
// of the frame). Drag to move it, the wheel or the slider to size it; the whole frame is no box.
export function cropEditor(f, crop, onChange) {
  let c = crop ? {...crop} : null;
  const r = h("div", {class: "croprect"}), box = h("div", {class: "cropbox", tip: "Drag to place the close-up; the wheel or the slider sizes it"}, media(f, {controls: false, autoplay: false}), r);
  const size = h("input", {type: "range", min: 20, max: 100, step: 1, value: c ? Math.round(c.w * 100) : 100});
  const place = () => { r.style.display = c ? "" : "none"; if (c) Object.assign(r.style, {left: `${c.x * 100}%`, top: `${c.y * 100}%`, width: `${c.w * 100}%`, height: `${c.h * 100}%`}); size.value = c ? Math.round(c.w * 100) : 100; };
  const clamp = () => { c.w = c.h = Math.min(1, Math.max(.2, c.w)); c.x = Math.min(1 - c.w, Math.max(0, c.x)); c.y = Math.min(1 - c.h, Math.max(0, c.y)); };
  const done = () => { if (c && c.w > .98) c = null; place(); onChange(c ? {x: +c.x.toFixed(4), y: +c.y.toFixed(4), w: +c.w.toFixed(4), h: +c.h.toFixed(4)} : null); };
  const resize = (w) => { if (!c) c = {x: .25, y: .25, w: .5, h: .5}; const cx = c.x + c.w / 2, cy = c.y + c.h / 2; c.w = c.h = w; c.x = cx - w / 2; c.y = cy - w / 2; clamp(); place(); };
  box.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    const b = box.getBoundingClientRect(), at = (ev) => ({x: (ev.clientX - b.left) / b.width, y: (ev.clientY - b.top) / b.height});
    if (!c) c = {x: 0, y: 0, w: .5, h: .5};
    const p0 = at(e), inside = p0.x >= c.x && p0.x <= c.x + c.w && p0.y >= c.y && p0.y <= c.y + c.h;
    const off = inside ? {x: p0.x - c.x, y: p0.y - c.y} : {x: c.w / 2, y: c.h / 2};
    const move = (ev) => { const q = at(ev); c.x = q.x - off.x; c.y = q.y - off.y; clamp(); place(); };
    move(e); try { box.setPointerCapture(e.pointerId); } catch { /* a pointer the browser no longer tracks */ }
    box.onpointermove = move;
    box.onpointerup = () => { box.onpointermove = null; box.onpointerup = null; done(); };
  });
  box.addEventListener("wheel", (e) => { e.preventDefault(); resize((c ? c.w : 1) * (e.deltaY > 0 ? 1.08 : 1 / 1.08)); clearTimeout(box._t); box._t = setTimeout(done, 350); }, {passive: false});
  size.addEventListener("input", () => { const v = Number(size.value) / 100; if (v > .98) { c = null; place(); } else resize(v); });
  size.addEventListener("change", done);
  place();
  return h("div", {class: "cropwrap"}, box, h("div", {class: "croprow"}, h("span", {class: "hint"}, "close-up"), size,
    h("button", {class: "ibtn", type: "button", tip: "The whole frame, no close-up", onclick: () => { c = null; done(); }}, "whole")));
}
