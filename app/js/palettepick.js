// The colour palette picker: looks in rows by kind, each with its colours inline; hover one to see it graded on your
// keyframe (grade.js, the same grade the shot gets); the chosen look's colours are swatches you can change before you
// render (your colours are mapped through the look: its contrast, grain and glow stay).
import {h, $$, esc} from "./ui.js";
import {PALETTES, PALETTE_GROUPS} from "./palettes.js";
import {lookParams, swatches, gradeImageData} from "./grade.js";

const SPECIAL = [
  {id: "auto", name: "From genre", tip: "The genre's own colour words go in the prompt; the shot isn't graded."},
  {id: "natural", name: "Natural", tip: "No colour words and no grade: the model's own colour."},
];
const SW = new Map();                              // look id -> its swatches (computed once)
const swOf = (id) => { if (!SW.has(id)) SW.set(id, swatches(lookParams(id))); return SW.get(id); };
const strip = (cols, cls = "sw") => h("span", {class: cls}, ...cols.map(c => h("i", {style: `background:${c}`})));

// opts: {initial: {id, hex?}, onChange(look), onHover(look|null), source(): HTMLImageElement|HTMLCanvasElement|null, renderWidth(): px}
export function palettePicker(el, opts) {
  let cur = {...(opts.initial || {id: "auto"})};
  const name = (id) => (PALETTES.find(p => p.id === id) || SPECIAL.find(p => p.id === id) || {name: id === "custom" ? "Your colours" : id}).name;
  const prev = h("canvas", {class: "pp-prev", width: 1, height: 1});
  const prevLbl = h("div", {class: "pp-plbl"});
  const head = h("div", {class: "pp-head"});
  const menu = h("div", {class: "pp-menu"});
  // ---- the chosen look: name, editable swatches, reset
  function drawHead() {
    const edited = !!cur.hex, base = cur.id;
    const cols = cur.hex || (base === "auto" || base === "natural" ? null : swOf(base));
    const sw = cols ? h("span", {class: "sw edit"}, ...cols.map((c, i) => {
      const inp = h("input", {type: "color", value: c, tip: "Change this colour. Darkest on the left, lightest on the right: the shot's shadows to its highlights take these colours."});
      inp.addEventListener("input", () => { const hex = [...(cur.hex || cols)]; hex[i] = inp.value; set({id: base, hex}, {keepMenu: true}); });
      return h("label", {style: `background:${c}`}, inp);
    })) : h("span", {class: "pp-none"}, base === "auto" ? "the genre's colours" : "no grade");
    head.replaceChildren(
      h("div", {class: "pp-cur"}, h("b", {}, edited ? `${base === "custom" ? "Your colours" : name(base) + " · your colours"}` : name(base)), sw,
        edited ? h("button", {class: "linkbtn", type: "button", tip: "Back to the look's own colours", onclick: () => set({id: base === "custom" ? "natural" : base})}, "reset") : null,
        h("button", {class: "linkbtn", type: "button", tip: "Start from any colours you like: 2 to 5, darkest to lightest",
          onclick: () => set({id: "custom", hex: cur.hex || (cols && cols.length ? cols : ["#14141c", "#5a6a7a", "#d8c8a8"])})}, cur.id === "custom" ? "" : "custom")));
  }
  // ---- the menu: one row per kind, collapsed; each look with its colours
  const item = (p) => {
    const b = h("button", {class: "pp-item" + (p.id === cur.id && !cur.hex ? " on" : ""), type: "button", "data-id": p.id,
      tip: (p.tip ? esc(p.tip) + "<br>" : "") + (p.words ? `<span class="tw">adds to the keyframe prompt:</span> <i>“${esc(p.words)}”</i>` : ""),
      onclick: () => set({id: p.id}), onmouseenter: () => hover(p.id), onfocus: () => hover(p.id)},
      h("span", {class: "nm"}, p.name), p.id === "auto" || p.id === "natural" ? null : strip(swOf(p.id)));
    return b;
  };
  function drawMenu() {
    const open = new Set($$("details[open]", menu).map(d => d.dataset.g));
    const curGroup = PALETTES.find(p => p.id === cur.id)?.group;
    menu.replaceChildren(h("div", {class: "pp-row top"}, ...SPECIAL.map(item)),
      ...PALETTE_GROUPS.map(g => {
        const looks = PALETTES.filter(p => p.group === g);
        const d = h("details", {class: "pp-group", "data-g": g, ...((open.has(g) || g === curGroup) ? {open: true} : {})},
          h("summary", {}, h("span", {}, g), h("span", {class: "pp-gsw"}, ...looks.slice(0, 7).map(p => strip(swOf(p.id).slice(1, 4), "sw mini")))),
          h("div", {class: "pp-row"}, ...looks.map(item)));
        return d;
      }));
  }
  menu.addEventListener("mouseleave", () => hover(null));
  // ---- preview: the look on your keyframe (or the genre's picture)
  let raf = 0;
  function hover(id) {
    opts.onHover?.(id ? {id} : null);
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => drawPreview(id ? {id} : cur));
  }
  function drawPreview(look) {
    const src = opts.source?.();
    if (!src || !(src.naturalWidth || src.width)) { prev.width = 1; prev.height = 1; prevLbl.textContent = ""; return; }
    const sw = src.naturalWidth || src.width, sh = src.naturalHeight || src.height, W = 220, H = Math.round(W * sh / sw);
    prev.width = W; prev.height = H;
    const x = prev.getContext("2d", {willReadFrequently: true});
    x.drawImage(src, 0, 0, W, H);
    if (look.id !== "auto" && look.id !== "natural" || look.hex) {
      const img = x.getImageData(0, 0, W, H);
      x.putImageData(gradeImageData(img, lookParams(look.id, look.hex), {scale: W / (opts.renderWidth?.() || 768)}), 0, 0);
    }
    prevLbl.textContent = look === cur ? `${name(look.id)}${look.hex ? " · your colours" : ""}` : `hover: ${name(look.id)}`;
  }
  function set(look, {keepMenu = false, quiet = false} = {}) {
    cur = {...look};
    drawHead();
    if (!keepMenu) $$(".pp-item", menu).forEach(b => b.classList.toggle("on", b.dataset.id === cur.id && !cur.hex));
    drawPreview(cur);
    if (!quiet) opts.onChange?.(cur);
  }
  el.replaceChildren(head, h("div", {class: "pp-body"}, h("div", {class: "pp-pwrap"}, prev, prevLbl), menu));
  drawMenu(); set(cur, {quiet: false});
  return {set, get: () => cur, refresh: () => drawPreview(cur)};
}
