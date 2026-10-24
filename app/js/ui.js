// The studio's small widget kit: elements, choice rows, collapsible sections, tooltips, drop zones, players.
import * as api from "./api.js";

export const $ = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => [...el.querySelectorAll(s)];
export const h = (tag, attrs = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === "class") el.className = v; else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "style") el.style.cssText = v; else if (k === "tip") { if (v) el.dataset.tip = v; }
    else if (v !== false && v != null) el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(c));
  return el;
};
export const ASSETS = "/valis/app/assets";
export const VID = /\.(mp4|webm|mov|mkv)$/i;
export const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;"})[c]);

export function toast(msg, bad = false) {
  const t = h("div", {class: "toast" + (bad ? " bad" : "")}, msg);
  $("#toasts").append(t);
  setTimeout(() => t.remove(), bad ? 9000 : 4500);
}

// ---------------------------------------------------------------------------------------------------------- tooltips
// Any element with data-tip shows it on hover (after a short pause) or keyboard focus. The text may hold simple HTML.
// An option's tooltip says what it does and the exact words it adds to the prompt.
export function optionTip(it, where = "keyframe") {
  const parts = [];
  if (it.tip) parts.push(esc(it.tip));
  if (it.words) parts.push(`<span class="tw">adds to the ${where} prompt:</span> <i>“${esc(it.words)}”</i>`);
  else if (!it.tip) parts.push(`<span class="tw">adds nothing to the prompt</span>`);
  return parts.join("<br>");
}
let tipEl = null, tipTimer = null, tipFor = null;
function placeTip(target) {
  const r = target.getBoundingClientRect(), t = tipEl.getBoundingClientRect();
  let x = r.left + r.width / 2 - t.width / 2, y = r.bottom + 8;
  if (y + t.height > innerHeight - 8) y = r.top - t.height - 8;
  x = Math.max(8, Math.min(innerWidth - t.width - 8, x));
  tipEl.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
}
function showTip(target) {
  tipFor = target;
  tipEl.innerHTML = target.dataset.tip;
  tipEl.classList.add("on");
  placeTip(target);
}
function hideTip() { clearTimeout(tipTimer); tipFor = null; tipEl?.classList.remove("on"); }
export function initTips() {
  tipEl = h("div", {class: "tipbox", role: "tooltip"});
  document.body.append(tipEl);
  document.addEventListener("mouseover", (e) => {
    const t = e.target.closest?.("[data-tip]");
    if (t === tipFor) return;
    hideTip();
    if (t) tipTimer = setTimeout(() => showTip(t), 380);
  });
  document.addEventListener("focusin", (e) => { const t = e.target.closest?.("[data-tip]"); if (t) showTip(t); });
  document.addEventListener("focusout", hideTip);
  document.addEventListener("mousedown", hideTip);
  addEventListener("scroll", hideTip, true);
}

// ---------------------------------------------------------------------------------------------------------- choices
// items: [{id, name, tip?, words?, group?}]. onPick(item) runs now and on every change. Returns {set(id), get()}.
export function chips(el, items, onPick, initial, {where = "keyframe", grouped = false, badge = null} = {}) {
  let cur = initial ?? items[0]?.id;
  const chip = (it) => h("button", {class: "chip" + (it.id === cur ? " on" : ""), "data-id": it.id, tip: optionTip(it, where), type: "button",
    onclick: () => set(it.id)}, it.name, badge?.(it) || null);
  if (grouped) {
    const groups = [...new Set(items.map(i => i.group || ""))];
    el.replaceChildren(...groups.map(g => h("div", {class: "chipgroup"}, g ? h("span", {class: "glabel"}, g) : null, ...items.filter(i => (i.group || "") === g).map(chip))));
  } else el.replaceChildren(...items.map(chip));
  function set(id, quiet = false) {
    cur = id; $$(".chip", el).forEach(c => c.classList.toggle("on", c.dataset.id === cur));
    if (!quiet) onPick(items.find(i => i.id === cur));
  }
  onPick(items.find(i => i.id === cur));
  return {set, get: () => items.find(i => i.id === cur), el};
}
export function cards(el, items, onPick, initial) {
  let cur = initial;
  const thumb = (it) => it.thumb ? h("img", {src: `${ASSETS}/thumbs/${it.thumb}`, alt: "", loading: "lazy", onerror: (e) => e.target.replaceWith(ph(it))}) : ph(it);
  const ph = (it) => { const d = h("div", {class: "ph"}); const hue = [...it.id].reduce((a, c) => a + c.charCodeAt(0), 0) % 360;
    d.style.setProperty("--c1", it.c1 || `hsl(${hue} 30% 24%)`); d.style.setProperty("--c2", it.c2 || `hsl(${(hue + 40) % 360} 30% 7%)`); return d; };
  el.replaceChildren(...items.map(it => h("div", {class: "card" + (it.id === cur ? " on" : ""), "data-id": it.id, tabindex: 0, tip: it.tip || (it.style ? esc(it.style) : null),
    onclick: () => set(it.id), onkeydown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); set(it.id); } }},
    thumb(it), h("div", {class: "lbl"}, it.name))));
  function set(id) { cur = id; $$(".card", el).forEach(c => c.classList.toggle("on", c.dataset.id === cur)); onPick(items.find(i => i.id === cur)); }
  if (cur) onPick(items.find(i => i.id === cur));
  return {set, get: () => items.find(i => i.id === cur)};
}
export function seg(el, items, onPick, initial) {
  let cur = initial ?? items[0].id;
  el.replaceChildren(...items.map(it => h("button", {class: it.id === cur ? "on" : "", "data-id": it.id, type: "button", tip: it.tip || null,
    onclick: () => set(it.id)}, it.name || it.id)));
  function set(id, quiet = false) { cur = id; $$("button", el).forEach(b => b.classList.toggle("on", b.dataset.id === cur)); if (!quiet) onPick(items.find(i => i.id === cur)); }
  onPick(items.find(i => i.id === cur));
  return {set, get: () => items.find(i => i.id === cur)};
}
// a labelled range: {label, min, max, step, value, fmt(v) -> text, tip}. onInput(v) on every move.
export function slider(el, {label, min, max, step, value, fmt = (v) => v, tip = null, marks = null}, onInput) {
  const out = h("output"), inp = h("input", {type: "range", min, max, step, value});
  const dl = marks ? h("div", {class: "marks"}, ...marks.map(m => h("button", {type: "button", class: "mark", tip: m.tip || null,
    onclick: () => { inp.value = m.value; upd(); }}, m.name))) : null;
  const upd = () => { const v = Number(inp.value); out.textContent = fmt(v); onInput(v); };
  inp.addEventListener("input", upd);
  el.replaceChildren(h("div", {class: "slider", tip}, h("label", {}, label), out, inp), dl);
  upd();
  return {set: (v) => { inp.value = v; upd(); }, get: () => Number(inp.value), input: inp, out};
}
// a collapsible section; the summary line shows what is chosen inside, so a closed section still reads at a glance
export function section(title, {open = false, id = null, tip = null} = {}, ...kids) {
  const val = h("span", {class: "val"});
  const d = h("details", {class: "sec", ...(open ? {open: true} : {}), ...(id ? {id} : {})},
    h("summary", {tip}, h("span", {class: "st"}, title), val), h("div", {class: "body"}, ...kids));
  d.setValue = (t) => { val.textContent = t; };
  // remember open/closed per browser
  const key = id && `valis.sec.${id}`;
  if (key) { try { const s = localStorage.getItem(key); if (s != null) d.open = s === "1"; } catch { /* storage off */ } }
  d.addEventListener("toggle", () => { if (key) try { localStorage.setItem(key, d.open ? "1" : "0"); } catch { /* storage off */ } });
  return d;
}

// ---------------------------------------------------------------------------------------------------------- files
export function dropzone(el, accept, onFile) {
  const input = h("input", {type: "file", accept, style: "display:none"});
  el._input = input;
  el.append(input);
  el.addEventListener("click", (e) => { if (!/^(AUDIO|VIDEO|BUTTON|SELECT)$/.test(e.target.tagName)) input.click(); });
  input.addEventListener("change", () => input.files[0] && Promise.resolve(onFile(input.files[0])).catch(er => toast(er.message, true)));
  el.addEventListener("dragover", (e) => { e.preventDefault(); el.classList.add("over"); });
  el.addEventListener("dragleave", () => el.classList.remove("over"));
  el.addEventListener("drop", (e) => {
    e.preventDefault(); el.classList.remove("over");
    const f = e.dataTransfer.files[0];
    if (f) return Promise.resolve(onFile(f)).catch(er => toast(er.message, true));
    const item = e.dataTransfer.getData("application/x-valis-item");       // a bin item dragged from the strip
    if (item && el._onItem) el._onItem(JSON.parse(item));
  });
}
// show what was dropped, keeping the zone's file input so it can be clicked again
export function fillDrop(el, ...kids) { el.replaceChildren(...kids, ...(el._input ? [el._input] : [])); }
export function media(f, {controls = true, autoplay = true} = {}) {
  const url = typeof f === "string" ? f : api.viewUrl(f);
  return /\.(mp4|webm|mov)(\?|$)/i.test(typeof f === "string" ? f : f.filename)
    ? h("video", {src: url, controls, autoplay, loop: true, muted: autoplay, playsinline: true})
    : h("img", {src: url, alt: ""});
}
