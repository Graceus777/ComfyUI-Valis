// The bin: every still, clip and song the studio makes (or you drop), in one strip every tab can take from. Click an
// item to send it somewhere (Create's first frame, Edit, FX, Genjutsu, a Film shot, a Score shot, Extras), or drag it
// onto any drop zone. Kept in ComfyUI/user/default/valis/bin.json, so it survives a reload.
import * as api from "./api.js";
import {h, $, $$, esc, toast} from "./ui.js";

const FILE = "valis/bin.json", MAX = 300;
const kindOf = (name) => /\.(mp4|webm|mov|mkv|gif)$/i.test(name) ? "clip" : /\.(png|jpe?g|webp)$/i.test(name) ? "still" : /\.(wav|flac|mp3|ogg|m4a)$/i.test(name) ? "audio" : /\.json$/i.test(name) ? "score" : "file";

export const Bin = {
  items: [], removed: new Set(), actions: [], loaded: false, listeners: new Set(), el: null, filter: "all",
  async load() {
    if (this.loaded) return this;
    const saved = await api.readUser(FILE, null);
    this.items = saved?.items || [];
    this.removed = new Set(saved?.removed || []);      // what you took out stays out (ComfyUI's history would bring it back)
    this.loaded = true; this.draw();
    return this;
  },
  save() { clearTimeout(this._t); this._t = setTimeout(() => api.writeUser(FILE, {items: this.items.slice(0, MAX), removed: [...this.removed].slice(-1000)}).catch(() => {}), 800); },
  keyOf: (f) => `${f.type || "output"}:${f.subfolder || ""}/${f.filename}`,
  // f: a ComfyUI file {filename, subfolder, type}; meta: {from, label, prompt, ...}. soft: only fill what the item lacks
  // (the catch-all for every finished job must not overwrite the label a tab gave its own result)
  add(f, meta = {}, {soft = false} = {}) {
    if (!f?.filename) return null;
    const id = this.keyOf(f);
    this.removed.delete(id);                           // made again or dropped again: it's wanted
    let it = this.items.find(i => i.id === id);
    if (it) { for (const [k, v] of Object.entries(meta)) if (!soft || it[k] == null) it[k] = v; }
    else { it = {id, kind: kindOf(f.filename), file: {filename: f.filename, subfolder: f.subfolder || "", type: f.type || "output"}, at: Date.now(), ...meta}; this.items.unshift(it); }
    this.save(); this.draw(); this.listeners.forEach(fn => fn(it));
    return it;
  },
  remove(id) { this.items = this.items.filter(i => i.id !== id); this.removed.add(id); this.save(); this.draw(); },
  list(kind) { return this.items.filter(i => !kind || i.kind === kind); },
  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); },
  // tabs register what they can do with an item: {id, label, kinds: ["clip"], run(item)}
  action(a) { this.actions = this.actions.filter(x => x.id !== a.id).concat(a); },
  url: (it) => api.viewUrl(it.file),
  ref: (it) => api.fileRef(it.file),

  mount(el) { this.el = el; this.draw(); },
  draw() {
    const el = this.el; if (!el) return;
    const kinds = ["all", "still", "clip", "audio"];
    const shown = this.items.filter(i => this.filter === "all" || i.kind === this.filter).slice(0, 80);
    const tile = (it) => {
      const url = this.url(it);
      const pic = it.kind === "clip" ? h("video", {src: url, muted: true, preload: "metadata", playsinline: true, loop: true})
        : it.kind === "still" ? h("img", {src: url, alt: "", loading: "lazy"}) : h("div", {class: "ph"}, it.kind === "audio" ? "♪" : "{ }");
      const t = h("div", {class: `bitem ${it.kind}`, draggable: "true", tip: `<b>${esc(it.label || it.file.filename)}</b><br>${esc(it.from || "")} · ${esc(it.file.filename)}${it.prompt ? `<br><i>${esc(it.prompt.slice(0, 220))}</i>` : ""}`},
        pic, h("span", {class: "bl"}, it.label || it.kind));
      if (pic.tagName === "VIDEO") { t.onmouseenter = () => pic.play().catch(() => {}); t.onmouseleave = () => pic.pause(); }
      t.addEventListener("dragstart", (e) => e.dataTransfer.setData("application/x-valis-item", JSON.stringify(it)));
      t.addEventListener("click", (e) => this.menu(it, e));
      return t;
    };
    el.replaceChildren(
      h("div", {class: "bhead"}, h("b", {}, "Bin"), ...kinds.map(k => h("button", {class: "bf" + (this.filter === k ? " on" : ""), type: "button",
        onclick: () => { this.filter = k; this.draw(); }}, k)), h("span", {class: "hint"}, "click to send · drag onto a drop zone")),
      h("div", {class: "bstrip"}, ...(shown.length ? shown.map(tile) : [h("p", {class: "hint"}, "Everything you make lands here.")])));
  },
  menu(it, e) {
    $$(".bmenu").forEach(m => m.remove());
    const acts = this.actions.filter(a => a.kinds.includes(it.kind));
    const m = h("div", {class: "bmenu", style: `left:${Math.min(e.clientX, innerWidth - 230)}px;top:${Math.max(8, e.clientY - 12 - 32 * (acts.length + 2))}px`},
      h("div", {class: "bmt"}, it.label || it.file.filename),
      ...acts.map(a => h("button", {type: "button", onclick: () => { m.remove(); a.run(it); }}, a.label)),
      h("a", {href: this.url(it), target: "_blank", rel: "noopener"}, "open"),
      h("button", {type: "button", class: "rm", onclick: () => { m.remove(); this.remove(it.id); }}, "remove from bin"));
    document.body.append(m);
    setTimeout(() => addEventListener("mousedown", function off(ev) { if (!m.contains(ev.target)) { m.remove(); removeEventListener("mousedown", off); } }), 0);
  },
};
