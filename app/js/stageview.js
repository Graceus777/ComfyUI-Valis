// The Stage tab: one still -> named depth layers -> a live 2.5D camera. Splitting a still is one short GPU job (SAM 3
// finds each name, Depth Anything 3 orders them, Valis completes every layer behind the ones in front); after that
// every camera move, amount, subject and duration plays live in the browser with no new diffusion job. Export renders
// the same frames the preview draws and ComfyUI's own encoder writes the MP4.
import {Stage, MOVES, fitSeq, camSeq} from "./stage3d.js";
import {EFFECTS, directAt, punchAt} from "./direct.js";
import {stageToSplat} from "./splat.js";
import {suggestNames} from "./names.js";
import * as EST from "./estimate.js";

const EASES = [{id: "inout", name: "Smooth"}, {id: "out", name: "Ease out"}, {id: "in", name: "Ease in"}, {id: "linear", name: "Linear"}];
const SIZES = [{id: "720", name: "720p", h: 720}, {id: "1080", name: "1080p", h: 1080}];
// a still whose short side is under this is sharpened (SeedVR2) to SHARP_TO before it is split: a 1080p export of a
// push-in reads ~1.4x past the still's own pixels, so a 768 px keyframe turns to mush and a 1440 px one stays crisp
const SHARP_BELOW = 1300, SHARP_TO = 1440;

export class StageView {
  constructor({$, h, toast, api, G}) {
    Object.assign(this, {$, h, toast, api, G});
    this.S = {image: null, imageUrl: null, meta: null, sub: null, move: "push_in", amount: 1, sec: 4, easing: "inout", focus: null,
              t: 0, playing: false, size: "1080", fit: null,
              audio: null, audioUrl: null, akind: "music", cues: null, wave: null, camStart: 0, punch: "none", rules: [],
              then: [], active: 0, wide: true};   // then: later camera moves [{move, amount, focus, start}]; active: which move the strip sets; wide: the camera may see past the frame edge, into the dome (when the stage has one)
    this.stage = null;
    this.init();
  }

  init() {
    const {$, h} = this;
    $("#sg-names").value = "the sky\nthe moon\nthe temple\nthe rocks\nthe path\nthe lamps";
    this.dropzone($("#sg-still"), "image/*", async (f) => {
      const u = await this.api.upload(f);
      this.S.image = this.api.inputRef(u); this.S.imageUrl = URL.createObjectURL(f);
      const im = new Image(); im.src = this.S.imageUrl; await im.decode().catch(() => {});
      this.S.imgW = im.naturalWidth; this.S.imgH = im.naturalHeight;
      const small = Math.min(this.S.imgW, this.S.imgH) < SHARP_BELOW;
      $("#sg-still").replaceChildren(h("img", {src: this.S.imageUrl, style: "width:100%;border-radius:8px;display:block"}),
        h("span", {class: "hint"}, `${f.name} · ${this.S.imgW}×${this.S.imgH}${small ? " · small: sharpened to 1440p when split" : ""}`));
      $("#sg-split").disabled = false;
    });
    $("#sg-split").addEventListener("click", () => this.split().catch(e => this.toast(e.message, true)));
    $("#sg-names").addEventListener("input", () => { this.S.namesTouched = true; });
    $("#sg-prompt").addEventListener("input", (e) => {          // names follow the description until they're edited by hand
      if (!this.S.namesTouched) { const n = suggestNames(e.target.value); if (n.length) $("#sg-names").value = n.join("\n"); }
    });
    $("#sg-make").addEventListener("click", () => this.make().catch(e => this.toast(e.message, true)));
    $("#st-reseed")?.addEventListener("click", () => {          // the same seed paints the same still; this one doesn't
      $("#st-seed").value = 1 + Math.floor(Math.random() * 999998);
      this.make().catch(e => this.toast(e.message, true));
    });
    this.S.domeEngine = "qwen";
    this.caps().then(c => this.drawDomeEngine(c)).catch(() => {});
    $("#sg-open").addEventListener("change", (e) => e.target.value && this.open(e.target.value).catch(er => this.toast(er.message, true)));
    $("#sg-moves").replaceChildren(...Object.entries(MOVES).map(([id, name]) => h("button", {class: "chip" + (id === this.S.move ? " on" : ""), "data-id": id,
      onclick: () => { this.S.move = id; [...$("#sg-moves").children].forEach(c => c.classList.toggle("on", c.dataset.id === id)); this.refit(); this.play(); }}, name)));
    $("#sg-ease").replaceChildren(...EASES.map(e => h("button", {class: e.id === this.S.easing ? "on" : "", "data-id": e.id,
      onclick: () => { this.S.easing = e.id; [...$("#sg-ease").children].forEach(b => b.classList.toggle("on", b.dataset.id === e.id)); this.refit(); }}, e.name)));
    $("#sg-size").replaceChildren(...SIZES.map(e => h("button", {class: e.id === this.S.size ? "on" : "", "data-id": e.id,
      onclick: () => { this.S.size = e.id; [...$("#sg-size").children].forEach(b => b.classList.toggle("on", b.dataset.id === e.id)); this.refit(); }}, e.name)));
    $("#sg-edge").replaceChildren(...[[false, "Crop in"], [true, "Show the dome"]].map(([id, n]) => h("button", {class: id === this.S.wide ? "on" : "", "data-id": String(id),
      title: id ? "the camera may see past the still's edge: the set fades into the far dome (less crop, wider moves)" : "zoom in just enough that the still's edge never shows",
      onclick: () => { this.S.wide = id; [...$("#sg-edge").children].forEach(b => b.classList.toggle("on", b.dataset.id === String(id))); this.refit(); }}, n)));
    $("#sg-amount").addEventListener("input", (e) => { this.S.amount = +e.target.value; $("#sg-amount-v").textContent = (+e.target.value).toFixed(2); this.refit(); });
    $("#sg-sec").addEventListener("input", (e) => { this.S.sec = +e.target.value; $("#sg-sec-v").textContent = `${(+e.target.value).toFixed(1)} s`; this.refit(); });
    $("#sg-focus").addEventListener("change", (e) => { this.S.focus = e.target.value; this.refit(); this.play(); });
    $("#sg-scrub").addEventListener("input", (e) => { this.S.playing = false; this.player?.pause(); this.S.T = +e.target.value * this.S.sec; this.draw(); this.playBtn(); });
    $("#st-play").addEventListener("click", () => this.S.playing ? (this.S.playing = false, this.playBtn()) : this.play());
    $("#st-export").addEventListener("click", () => this.export().catch(e => this.toast(e.message, true)));
    $("#st-splat").addEventListener("click", () => this.saveSplat().catch(e => this.toast(e.message, true)));
    $("#sg-paintdome").addEventListener("click", () => this.paintDome().catch(e => this.toast(e.message, true)));
    $("#st-cams").addEventListener("click", () => this.saveCameras().catch(e => this.toast(e.message, true)));
    $("#sg-akind").replaceChildren(...[["music", "Music"], ["voice", "Voice"], ["both", "Both"]].map(([id, n]) => h("button", {class: id === this.S.akind ? "on" : "", "data-id": id,
      onclick: () => { this.S.akind = id; [...$("#sg-akind").children].forEach(b => b.classList.toggle("on", b.dataset.id === id)); this.S.audio && this.loadCues().catch(e => this.toast(e.message, true)); }}, n)));
    this.dropzone($("#st-audio"), "audio/*,video/*", async (f) => {
      // straight into ComfyUI's input folder: the cue engine and the encoder read it there
      const fd = new FormData(); fd.append("image", f, f.name); fd.append("subfolder", "valis/stage"); fd.append("type", "input");
      const up = await fetch("/upload/image", {method: "POST", body: fd}).then(r => r.json());
      if (!up.name) throw new Error("upload failed");
      this.S.audio = true; this.S.audioName = `${up.subfolder ? up.subfolder + "/" : ""}${up.name}`; this.S.audioUrl = URL.createObjectURL(f);
      $("#st-audio").replaceChildren(h("span", {}, f.name));
      this.player = new Audio(this.S.audioUrl);
      await this.loadCues();
    });
    $("#sg-sheet").addEventListener("change", () => this.loadCues().catch(e => this.toast(e.message, true)));
    $("#sg-camstart").addEventListener("input", (e) => { this.S.camStart = Math.max(0, +e.target.value || 0); this.refit(); });
    $("#sg-camstart").addEventListener("focus", () => { this.S.active = 0; this.drawThen(); });
    $("#sg-addthen").addEventListener("click", () => {
      const last = this.shots().slice(-1)[0];
      const start = Math.min(this.S.sec - 0.5, Math.max((last?.start ?? 0) + 1, this.S.T ?? 0));
      this.S.then.push({move: "dolly_zoom_in", amount: 0.6, focus: this.S.focus, start});
      this.S.active = this.S.then.length; this.drawThen(); this.refit();
      this.toast("Click the sound strip to start this move on a word or a hit");
    });
    $("#sg-punch").addEventListener("change", (e) => { this.S.punch = e.target.value; });
    $("#sg-addrule").addEventListener("click", () => { this.S.rules.push({layer: this.stage?.layers.find(l => !l.backdrop)?.name || "", effect: "glow", on: this.lanes()[0] || "always", amount: 1}); this.drawRules(); });
    $("#sg-wave").addEventListener("click", (e) => {
      const r = e.target.getBoundingClientRect(), T = (e.clientX - r.left) / r.width * this.S.sec;
      // snap to the nearest syllable/hit when one is close: "start the move on that word"
      let best = T, bd = 0.25;
      for (const ts of Object.values(this.S.cues?.lanes || {})) for (const x of ts) if (Math.abs(x - T) < bd) { bd = Math.abs(x - T); best = x; }
      const at = Math.max(0, Math.min(this.S.sec - 0.2, best));
      if (this.S.active > 0 && this.S.then[this.S.active - 1]) { this.S.then[this.S.active - 1].start = at; this.drawThen(); }
      else { this.S.camStart = at; $("#sg-camstart").value = at.toFixed(2); }
      this.refit(); this.S.T = at; this.draw();
    });
    this.listStages();
  }

  dropzone(el, accept, onFile) {
    const input = this.h("input", {type: "file", accept, style: "display:none"});
    el.append(input);
    el.addEventListener("click", () => input.click());
    input.addEventListener("change", () => input.files[0] && onFile(input.files[0]).catch(e => this.toast(e.message, true)));
    el.addEventListener("dragover", (e) => { e.preventDefault(); el.classList.add("over"); });
    el.addEventListener("dragleave", () => el.classList.remove("over"));
    el.addEventListener("drop", (e) => { e.preventDefault(); el.classList.remove("over"); const f = e.dataTransfer.files[0]; if (f) onFile(f).catch(er => this.toast(er.message, true)); });
  }

  async listStages(select = null) {
    const r = await fetch("/valis/stage/list").then(r => r.json()).catch(() => ({stages: []}));
    const {h, $} = this;
    $("#sg-open").replaceChildren(h("option", {value: ""}, r.stages.length ? "open a stage…" : "no stages yet"),
      ...r.stages.map(s => h("option", {value: s.subfolder, selected: s.subfolder === select}, `${s.name} · ${s.layers} layers`)));
  }

  lanes() { return Object.keys(this.S.cues?.lanes || {}).filter(k => (this.S.cues.lanes[k] || []).length); }

  async loadCues() {
    const body = {audio: this.S.audio ? (this.S.audioName) : null, kind: this.S.akind, sheet: this.$("#sg-sheet").value, duration: this.S.sec};
    if (!body.audio && !body.sheet.trim()) { this.S.cues = null; this.drawRules(); this.drawWave(); return; }
    const r = await fetch("/valis/stage/cues", {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(body)}).then(r => r.json());
    if (r.error) throw new Error(r.error);
    this.S.cues = r; this.S.wave = r.wave;
    if (r.duration) { this.S.sec = Math.min(30, Math.max(1, r.duration)); this.$("#sg-sec").max = Math.max(12, Math.ceil(this.S.sec)); this.$("#sg-sec").value = this.S.sec; this.$("#sg-sec-v").textContent = `${this.S.sec.toFixed(1)} s`; }
    const ls = this.lanes();
    this.toast(ls.length ? `Heard: ${ls.map(k => `${k} ×${r.lanes[k].length}`).join(", ")}` : "No cues found");
    this.$("#sg-punch").replaceChildren(...["none", ...ls].map(k => this.h("option", {value: k, selected: k === this.S.punch}, k === "none" ? "no punch" : `punch on ${k}`)));
    this.drawRules(); this.drawWave();
  }

  drawWave() {
    const cv = this.$("#sg-wave"); if (!cv) return;
    const W = cv.width = cv.clientWidth * devicePixelRatio || 600, H = cv.height = 64 * devicePixelRatio;
    const x = cv.getContext("2d"); x.clearRect(0, 0, W, H);
    const sec = this.S.sec, wave = this.S.wave || [];
    x.fillStyle = "#2a2a36";
    for (let i = 0; i < wave.length; i++) { const px = i / 50 / sec * W; if (px > W) break; const a = wave[i] * H * 0.45; x.fillRect(px, H / 2 - a, Math.max(1, W / sec / 50), 2 * a); }
    const colors = ["#ff8a4c", "#9cc2ff", "#6fe3a1", "#e7a6ff", "#ffd36b", "#ff6b9a"];
    this.lanes().forEach((k, j) => {
      x.fillStyle = colors[j % colors.length];
      for (const t of this.S.cues.lanes[k]) { if (t > sec) break; x.fillRect(t / sec * W, H - 6 - 5 * (j % 6), 2, 4); }
    });
    x.font = `${11 * devicePixelRatio}px sans-serif`;
    [{start: this.S.camStart, move: this.S.move}, ...this.S.then].forEach((sh, i) => {
      x.fillStyle = i === this.S.active ? "#ffffff" : "#8d8d9b";
      x.fillRect(sh.start / sec * W, 0, 2, H);
      x.fillText(`${i + 1} ${MOVES[sh.move] || sh.move}`, sh.start / sec * W + 4, 12 * devicePixelRatio);
    });
    const T = this.S.T ?? 0; x.fillStyle = "rgba(255,255,255,.5)"; x.fillRect(T / sec * W, 0, 1, H);
  }

  drawRules() {
    const {h, $} = this;
    const layers = this.stage ? this.stage.layers.map(l => l.name) : [];
    const lanes = ["always", ...this.lanes()];
    $("#sg-rules").replaceChildren(...this.S.rules.map((r, i) => h("div", {class: "maprow rule"},
      h("select", {onchange: (e) => { r.layer = e.target.value; this.draw(); }}, ...layers.map(n => h("option", {value: n, selected: n === r.layer}, n))),
      h("select", {onchange: (e) => { r.effect = e.target.value; this.draw(); }}, ...Object.entries(EFFECTS).map(([k, v]) => h("option", {value: k, selected: k === r.effect, title: v.hint}, v.name))),
      h("select", {onchange: (e) => { r.on = e.target.value; this.draw(); }}, ...lanes.map(n => h("option", {value: n, selected: n === r.on}, n === "always" ? "always" : `on ${n}`))),
      h("input", {type: "range", min: 0.1, max: 3, step: 0.05, value: r.amount, title: "amount", oninput: (e) => { r.amount = +e.target.value; this.draw(); }}),
      h("button", {class: "chip", title: "remove", onclick: () => { this.S.rules.splice(i, 1); this.drawRules(); this.draw(); }}, "×"))));
  }

  names() {
    return this.$("#sg-names").value.split(/\n|,/).map(s => s.trim()).filter(Boolean).slice(0, 12);
  }

  // ---- the one GPU step -------------------------------------------------------------------------------------------
  // erase first (the things erased by Krea 2 edit, the scenery split from the erased picture, the things back on top
  // as cutouts) whenever ComfyUI has loaded the nodes for it; else the split as before
  async canErase() { return (await this.caps()).erase; }

  // what the loaded nodes can do (read once per page load): a pack loaded before a restart keeps working, it just
  // doesn't get the new inputs
  async caps() {
    if (this.S.caps) return this.S.caps;
    const get = (n) => fetch(`/object_info/${n}`).then(r => r.json()).then(j => j[n] || null).catch(() => null);
    const [er, se, sur, ap, bg, lora] = await Promise.all(["ValisErase", "ValisStageErased", "ValisStageSurround", "Krea2AnyPaintPrepare",
      "LoadBackgroundRemovalModel", "LoraLoaderModelOnly"].map(get));
    const ins = (o) => ({...(o?.input?.required || {}), ...(o?.input?.optional || {})});
    const combo = (v) => Array.isArray(v?.[0]) ? v[0] : (v?.[1]?.options || []);
    const bgFiles = bg ? combo(ins(bg).bg_removal_name) : [], loras = lora ? combo(ins(lora).lora_name) : [];
    this.S.caps = {
      erase: !!se,
      retry: !!(er && ins(er).plate_rest),
      matte: (se && ins(se).bg_model && bgFiles.find(f => /biref/i.test(f))) || null,
      prompt: !!(se && ins(se).prompt),
      kreaDome: !!(sur && ins(sur).pad && ap && loras.some(f => /anypaint/i.test(f))),
    };
    return this.S.caps;
  }

  drawDomeEngine(caps) {
    const {h, $} = this, el = $("#st-domeeng");
    if (!el) return;
    const opts = [["qwen", "Qwen Image 2.1"], ["krea", "Krea 2 AnyPaint"]];
    const set = (id) => {
      this.S.domeEngine = id;
      [...el.children].forEach(b => b.classList.toggle("on", b.dataset.id === id));
      const sub = $("#st-domesub");
      if (sub) sub.textContent = id === "krea" ? "past the frame · Krea 2 AnyPaint"
        : "past the frame · Qwen Image 2.1";
    };
    el.replaceChildren(...opts.map(([id, n]) => h("button", {class: id === this.S.domeEngine ? "on" : "", "data-id": id,
      disabled: id === "krea" && !caps.kreaDome, title: id === "krea" && !caps.kreaDome ? "needs the Krea 2 AnyPaint nodes and LoRA, and a ComfyUI restart" : "",
      onclick: () => set(id)}, n)));
    // Krea 2 when it can (Oct 21 A/B on the astronaut and the lighthouse: as coherent as Qwen, a little faster, Krea's
    // licence, and Krea is already loaded for the erase); Qwen stays one click away
    set(caps.kreaDome ? "krea" : "qwen");
  }

  async split() {
    if (!this.S.image) throw new Error("Drop a still first");
    const names = this.names();
    if (!names.length) throw new Error("Name at least one thing in the picture");
    const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
    const name = `stage_${stamp}`;
    const btn = this.$("#sg-split");
    const short = Math.min(this.S.imgW || 0, this.S.imgH || 0);
    const sharpen = short && short < SHARP_BELOW && this.$("#sg-sharp")?.checked !== false ? SHARP_TO : 0;
    btn.disabled = true;
    try {
      const caps = await this.caps(), erase = caps.erase;
      const job = await this.api.submit(this.G.stage({image: this.S.image, names, name, far: +this.$("#sg-far").value, sharpen, erase, caps}), `Stage: ${names.join(", ")}`, "stage");
      this.toast(sharpen ? `Splitting the still: SeedVR2 sharpens it to ${SHARP_TO}p, SAM 3 finds each name${erase ? ", Krea 2 erases the things standing in it" : ""}, Depth Anything 3 orders them`
        : short && short < 1000 ? `This still is only ${short} px on its short side: 1080p exports will be soft` : `Splitting the still: SAM 3 finds each name${erase ? ", Krea 2 erases the things standing in it" : ""}, Depth Anything 3 orders them`);
      await this.until(job);
      const sub = `valis/stage/${name}`;
      await this.listStages(sub);
      await this.open(sub);
    } finally { btn.disabled = false; }
  }

  // words in, a set out: Krea 2 paints the still, SeedVR2 sharpens it, SAM 3 + Depth Anything split it, in one job
  async make() {
    const prompt = this.$("#sg-prompt").value.trim();
    if (!prompt) throw new Error("Describe the scene first");
    if (!this.S.namesTouched) this.$("#sg-names").value = suggestNames(prompt).join("\n");
    const names = this.names();
    if (!names.length) throw new Error("Name at least one thing in the picture");
    const name = `stage_${new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14)}`;
    const sharpen = this.$("#sg-sharp")?.checked !== false ? SHARP_TO : 0;
    const btn = this.$("#sg-make"), label = btn.innerHTML;
    btn.disabled = true; btn.textContent = "Making the set…";
    try {
      // the seed field decides the still: the same seed paints the same still (ComfyUI then reuses it, so a changed
      // name or setting re-splits in ~30 s); "Try another seed" picks a new one
      const seed = Math.max(0, Math.round(+this.$("#st-seed")?.value || 7101));
      this.S.makeSeed = seed;
      const caps = await this.caps(), erase = caps.erase;
      const job = await this.api.submit(this.G.stage({prompt, names, name, far: +this.$("#sg-far").value, sharpen, seed, erase, caps}),
        `Stage from words: ${names.join(", ")} (seed ${seed})`, "stage");
      this.toast(`Seed ${seed}: Krea 2 paints the still${sharpen ? ", SeedVR2 sharpens it" : ""}, then SAM 3 finds ${names.length} things in it${erase ? " and Krea 2 erases the ones standing in it, so a move uncovers real paint" : ""}`);
      await this.until(job);
      const sub = `valis/stage/${name}`;
      await this.listStages(sub);
      await this.open(sub);
    } finally { btn.disabled = false; btn.innerHTML = label; }
  }

  until(job) {
    return new Promise((res, rej) => {
      const off = this.api.on((ev) => {
        if (ev.job?.id !== job.id) return;
        if (ev.job.status === "done") { off(); res(); } else if (ev.job.status === "error") { off(); rej(new Error(ev.job.error)); }
      });
    });
  }

  // the world past the frame, painted (Qwen Image 2.1 + the outpaint LoRA) into the stage's dome: the studio's wide
  // moves and the 3D set then show the room, the street, the sky going on instead of a blur
  async paintDome() {
    if (!this.S.sub) throw new Error("Split a still (or open a stage) first");
    const have = await fetch("/object_info/ValisStagePlate").then(r => r.json()).catch(() => ({}));
    if (!have.ValisStagePlate) throw new Error("Restart ComfyUI once to load the new Valis Stage nodes, then paint again");
    const btn = this.$("#sg-paintdome"), label = btn.innerHTML;
    btn.disabled = true; btn.textContent = "Painting what the camera uncovers…";
    try {
      this.S.domeSeed = (this.S.domeSeed ?? 100) + 1;          // each press paints a new take
      const erased = !!this.S.meta?.erased?.length;      // erased first: what's behind the things is already real paint
      const krea = this.S.domeEngine === "krea" && (await this.caps()).kreaDome;
      const words = this.S.meta?.prompt || (this.stage?.layers || []).map(l => l.name).filter(n => n !== "the rest" && !/farther back/.test(n)).join(", ");
      const graph = this.G.stagePaint({stage: this.S.sub, seed: this.S.domeSeed, plate: !erased, engine: krea ? "krea" : "qwen", prompt: words});
      const est = await EST.estimate(graph).catch(() => null), eta = est ? EST.fmt(est) : "";
      const job = await this.api.submit(graph, `Paint: ${this.S.sub.split("/").pop()}${krea ? " (Krea 2)" : ""}`, "stage");
      const who = krea ? "Krea 2 + AnyPaint" : "Qwen Image 2.1";
      this.toast(erased ? `${who} paints the world past the frame${eta ? ` (${eta})` : ""}`
        : `${who} paints the world past the frame, Krea 2 edit a clean plate behind the people and things${eta ? ` (${eta})` : ""}`);
      await this.until(job);
      // the layers (behind) and the dome changed: reload them, but keep the camera, the sequence and the effects
      const keep = Object.fromEntries(this.stage.layers.map(l => [l.name, {visible: l.visible, zoff: l.zoff}]));
      const meta = await fetch(this.file(this.S.sub, "stage.json") + `&t=${Date.now()}`).then(r => r.json());
      const rev = meta.dome?.rev || Date.now();
      await this.stage.load(f => this.file(this.S.sub, f) + (/^(layer|dome|outer)/.test(f) ? `&v=${rev}` : ""), meta);
      this.S.meta = meta;
      for (const l of this.stage.layers) Object.assign(l, keep[l.name] || {});
      this.refit();
      const and = (xs) => xs.length > 1 ? `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}` : xs[0];
      const removed = meta.plate?.removed?.length ? ` and behind ${and(meta.plate.removed)}`
        : meta.erased?.length ? `; ${and(meta.erased)} ${meta.erased.length > 1 ? "were" : "was"} erased from the still first, so a move shows real paint behind ${meta.erased.length > 1 ? "them" : "it"}` : "";
      this.toast(`Painted the world past the frame${removed}. Save the 3D set again to take it along.`);
    } finally { btn.disabled = false; btn.innerHTML = label; }
  }

  file(sub, f) { return `/view?filename=${encodeURIComponent(f)}&subfolder=${encodeURIComponent(sub)}&type=output`; }

  async open(sub) {
    const meta = await fetch(this.file(sub, "stage.json") + `&t=${Date.now()}`).then(r => { if (!r.ok) throw new Error("stage not found"); return r.json(); });
    this.S.meta = meta; this.S.sub = sub;
    const cv = this.$("#st-canvas");
    const H = 720, W = Math.round(H * meta.width / meta.height / 2) * 2;
    cv.width = W; cv.height = H;
    this.stage = this.stage || new Stage(cv);
    await this.stage.load(f => this.file(sub, f), meta);
    // the subject: the biggest thing that isn't a backdrop, else the nearest
    // the subject: a compact thing (the temple, not 26 scattered rocks), weighted by size
    const score = l => {
      const b = l.bbox || [0, 0, 1, 1], box = Math.max(1, (b[2] - b[0]) * (b[3] - b[1]));
      const edge = b[0] <= 2 || b[1] <= 2 || b[2] >= meta.width - 3 || b[3] >= meta.height - 3 ? 0.3 : 1;   // cut by the frame: scenery, not a subject
      return Math.sqrt(l.area) * Math.min(1, l.area * meta.width * meta.height / box) * edge;
    };
    const objs = this.stage.layers.filter(l => !l.backdrop);
    const pick = (objs.length ? [...objs].sort((a, b) => score(b) - score(a))[0] : this.stage.layers[this.stage.layers.length - 1]);
    this.S.focus = pick.name;
    const {h, $} = this;
    $("#sg-focus").replaceChildren(...this.stage.layers.map(l => h("option", {value: l.name, selected: l.name === pick.name}, l.name)));
    this.S.then = []; this.S.active = 0;
    this.drawLayers(); this.drawRules(); this.drawThen();
    $("#sg-empty").style.display = "none"; cv.style.display = "block";
    $("#sg-controls").style.display = "";
    this.drawChecks(meta);
    this.refit(); this.play();
  }

  // the set's checks (stage.json "checks", written when it was split): what a move will show before anyone looks
  drawChecks(meta) {
    const {h, $} = this, el = $("#st-checks");
    if (!el) return;
    const cs = meta.checks || [];
    if (!cs.length) { el.replaceChildren(); return; }
    const mark = (ok) => ok === true ? "✓" : ok === false ? "!" : "·";
    const color = (ok) => ok === true ? "var(--muted, #8d8d9b)" : ok === false ? "var(--ember, #ff8a4c)" : "var(--muted, #8d8d9b)";
    const short = {first_frame: "first frame", ghost: "outlines", names: "names", erase: "erase", tears: "tears", guessed: "guessed paint"};
    el.replaceChildren(h("details", {open: cs.some(c => c.ok === false)},
      h("summary", {class: "hint", style: "cursor:pointer;margin:6px 0"}, `Checks: ${cs.filter(c => c.ok === true).length} of ${cs.length} pass` +
        (cs.some(c => c.ok === false) ? ` · look at: ${cs.filter(c => c.ok === false).map(c => short[c.id] || c.id).join(", ")}` : "")),
      ...cs.map(c => h("div", {class: "hint", style: `margin:2px 0;color:${color(c.ok)}`}, h("b", {}, `${mark(c.ok)} ${c.name}`), ` · ${c.note || ""}`))));
    const warn = cs.find(c => c.id === "names" && c.ok === false);
    if (warn) this.toast(`Names: ${warn.note}`, true);
  }

  drawLayers() {
    const {h, $} = this;
    $("#sg-layers").replaceChildren(...[...this.stage.layers].reverse().map(l => h("div", {class: "maprow"},
      h("label", {class: "check", style: "min-width:150px"}, h("input", {type: "checkbox", checked: l.visible, onchange: (e) => { l.visible = e.target.checked; this.draw(); }}), " ", l.name),
      h("span", {class: "hint", style: "margin:0 6px 0 auto"}, l.backdrop ? "backdrop" : `z ${l.z_med.toFixed(2)}`),
      h("input", {type: "range", min: 0.6, max: 1.4, step: 0.01, value: l.zoff, title: "nearer / farther",
        oninput: (e) => { l.zoff = +e.target.value; this.refit(); this.draw(); }}))));
  }

  depth(name) { const L = this.stage.layer(name); return L ? L.z_med * L.zoff : 2; }

  opts() { return {amount: this.S.amount, focus: this.depth(this.S.focus), easing: this.S.easing}; }

  // the camera as a sequence: the main move from "move starts at", then each later move from its own start
  shots() {
    const main = {move: this.S.move, start: this.S.camStart, amount: this.S.amount, focus: this.depth(this.S.focus), easing: this.S.easing};
    const later = this.S.then.map(t => ({move: t.move, start: t.start, amount: t.amount, focus: this.depth(t.focus), easing: "inout"}));
    return [main, ...later].sort((a, b) => a.start - b.start);
  }

  drawThen() {
    const {h, $} = this;
    if (!$("#sg-then")) return;
    const layers = this.stage ? this.stage.layers.map(l => l.name) : [];
    $("#sg-then").replaceChildren(...this.S.then.map((t, i) => h("div", {class: "maprow rule" + (this.S.active === i + 1 ? " on" : ""), onclick: () => { this.S.active = i + 1; this.drawThen(); this.drawWave(); }},
      h("select", {onchange: (e) => { t.move = e.target.value; this.refit(); }}, ...Object.entries(MOVES).filter(([k]) => k !== "show_layers").map(([k, n]) => h("option", {value: k, selected: k === t.move}, `then ${n.toLowerCase()}`))),
      h("select", {onchange: (e) => { t.focus = e.target.value; this.refit(); }}, ...layers.map(n => h("option", {value: n, selected: n === t.focus}, n))),
      h("input", {type: "number", min: 0, step: 0.05, value: t.start.toFixed(2), title: "starts at (s)", onchange: (e) => { t.start = Math.max(0, +e.target.value || 0); this.refit(); }}),
      h("input", {type: "range", min: 0.2, max: 2.5, step: 0.05, value: t.amount, title: "amount", oninput: (e) => { t.amount = +e.target.value; this.refit(); }}),
      h("button", {class: "chip", title: "remove", onclick: (e) => { e.stopPropagation(); this.S.then.splice(i, 1); this.S.active = 0; this.drawThen(); this.refit(); }}, "×"))));
  }

  refit() {
    if (!this.stage) return;
    const wide = this.S.wide && !!this.stage.dome;
    this.S.fit = fitSeq(this.S.meta, this.shots(), this.S.sec, {wide});
    const crop = this.S.fit.crop, srcH = this.S.meta.height / crop, outH = SIZES.find(s => s.id === this.S.size).h;
    const ok = srcH >= outH * 0.85;
    this.$("#sg-crop").innerHTML = `framed ${crop.toFixed(2)}× ${wide ? "· the edge may show, fading into the dome" : this.S.wide ? "so no edge ever shows (this stage has no dome: split it again to get one)" : "so no edge ever shows"} · ${Math.round(srcH)} px of the still's ${this.S.meta.height} fill the ${outH}p frame` +
      (ok ? "" : ` <b style="color:var(--ember)">· will look soft at ${outH}p: lower the amount, pick 720p, or upscale the still first</b>`);
    this.draw();
  }

  frameAt(T) {
    const cam = camSeq(this.shots(), T, this.S.sec, this.S.fit);
    cam.zoom *= punchAt(this.S.cues, this.S.punch, T);
    const fx = directAt(this.S.rules, this.S.cues, T, this.stage);
    fx.wide = this.S.wide && !!this.stage.dome;
    return [cam, fx];
  }

  draw() {
    if (!this.stage) return;
    const T = this.S.T ?? 0;
    const [cam, fx] = this.frameAt(T);
    this.stage.draw(cam, fx);
    this.$("#sg-scrub").value = T / this.S.sec;
    this.$("#st-time").textContent = `${T.toFixed(2)} s`;
    this.drawWave();
  }

  playBtn() { this.$("#st-play").textContent = this.S.playing ? "Pause" : "Play"; }

  play() {
    if (!this.stage) return;
    this.S.playing = true; this.playBtn();
    if ((this.S.T ?? 0) >= this.S.sec - 1e-3) this.S.T = 0;
    const t0 = performance.now(), T0 = this.S.T ?? 0;
    if (this.player) { this.player.currentTime = T0; this.player.play().catch(() => {}); }
    const tick = (now) => {
      if (!this.S.playing) { this.player?.pause(); return; }
      this.S.T = this.player && !this.player.paused ? this.player.currentTime : T0 + (now - t0) / 1000;
      if (this.S.T >= this.S.sec) { this.S.T = this.S.sec; this.draw(); this.S.playing = false; this.player?.pause(); this.playBtn(); return; }
      this.draw(); requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  async exportJpeg(job, fps, n, outW, outH, name, btn) {
    const cv = this.$("#st-canvas");
    for (let i = 0; i < n; i++) {
      const [cam, fx] = this.frameAt(i / fps);
      this.stage.draw(cam, fx);
      const blob = await new Promise(r => cv.toBlob(r, "image/jpeg", 0.95));
      const r = await fetch(`/valis/stage/frame?job=${job}&i=${i}`, {method: "POST", body: blob});
      if (!r.ok) throw new Error("frame upload failed");
      if (i % 6 === 0) btn.textContent = `Rendering ${Math.round(100 * i / n)}%`;
    }
    btn.textContent = "Encoding…";
    const r = await fetch("/valis/stage/encode", {method: "POST", headers: {"Content-Type": "application/json"},
      body: JSON.stringify({job, fps, subfolder: this.S.sub, name, audio: this.S.audio ? this.S.audioName : null})}).then(r => r.json());
    if (r.error) throw new Error(r.error);
    this.toast(`Saved ${r.subfolder}/${r.filename}`);
    this.$("#sg-last").replaceChildren(this.h("video", {src: `/view?filename=${encodeURIComponent(r.filename)}&subfolder=${encodeURIComponent(r.subfolder)}&type=output`, controls: true, loop: true, style: "width:100%;border-radius:8px"}));
    this.S.lastExport = r;
  }

  // ---- export: the same frames as the preview, encoded by ComfyUI (PyAV) --------------------------------------------
  // the stage as a 3D Gaussian splat file, written here in the browser from the layers already on screen
  async saveSplat() {
    if (!this.stage?.layers?.length) throw new Error("Split a still (or open a stage) first");
    const btn = this.$("#st-splat"), label = btn.innerHTML;
    btn.disabled = true; btn.textContent = "Writing the splats…";
    try {
      const {blob, count, dome, domeCount} = await stageToSplat(this.stage, {format: "ply"});
      const name = `${(this.S.sub || "stage").split("/").pop()}_set.ply`;
      const a = this.h("a", {href: URL.createObjectURL(blob), download: name});
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 60000);
      this.toast(`${name}: ${count.toLocaleString()} splats, ${(blob.size / 1e6).toFixed(1)} MB` +
        (dome ? ` · with the far dome (${domeCount.toLocaleString()} of them)` : " · no dome: split the still again to get one") + " · hidden layers left out");
    } finally { btn.disabled = false; btn.innerHTML = label; }
  }

  // The camera move as an INRIA cameras.json (the format 3DGS training writes): SuperSplat turns it into one timeline
  // key per entry, so the same move plays on the 3D set in a real splat renderer (and renders to video there). One
  // key per frame at 30 fps; the stage's space is already the .ply's (x right, y down, looking down +z).
  async saveCameras() {
    if (!this.stage) throw new Error("Open a stage first");
    const fps = 30, n = Math.max(2, Math.round(this.S.sec * fps)), m = this.S.meta;
    const cams = [];
    for (let i = 0; i < n; i++) {
      const [cam] = this.frameAt(i / fps);
      const a = cam.rot, f = this.stage.f0 * (cam.zoom ?? 1);
      // cam.rot is world -> camera, column-major (WebGL): camera -> world, row by row, is a[r * 3 + c]
      const rotation = [0, 1, 2].map(r => [0, 1, 2].map(c => +a[r * 3 + c].toFixed(6)));
      cams.push({id: i + 1, img_name: `valis_${String(i + 1).padStart(4, "0")}`, width: m.width, height: m.height,
                 position: cam.pos.map(v => +v.toFixed(6)), rotation, fx: +f.toFixed(3), fy: +f.toFixed(3)});
    }
    const blob = new Blob([JSON.stringify(cams)], {type: "application/json"});
    const shot = [this.S.move, ...this.S.then.map(t => t.move)].join("_then_");
    const name = `${(this.S.sub || "stage").split("/").pop()}_${shot}_cameras.json`;
    const el = this.h("a", {href: URL.createObjectURL(blob), download: name});
    document.body.append(el); el.click(); el.remove();
    setTimeout(() => URL.revokeObjectURL(el.href), 60000);
    this.toast(`${name}: ${n} keys at ${fps} fps. In SuperSplat: open the 3D set, then drop this file on it; render at ${fps} fps.`);
    return cams;
  }

  async export() {
    if (!this.stage) throw new Error("Open a stage first");
    this.S.playing = false; this.playBtn();
    const outH = SIZES.find(s => s.id === this.S.size).h, outW = Math.round(outH * this.S.meta.width / this.S.meta.height / 2) * 2;
    const cv = this.$("#st-canvas"), prev = [cv.width, cv.height];
    cv.width = outW; cv.height = outH;
    const fps = 24, n = Math.max(2, Math.round(this.S.sec * fps)), job = `x${Date.now()}`;
    const btn = this.$("#st-export"); btn.disabled = true;
    try {
      const name = [this.S.move, ...this.S.then.map(t => t.move)].join("_then_") + `_${this.S.focus.replace(/[^a-z0-9]+/gi, "_")}`;
      const rb = await fetch("/valis/stage/begin", {method: "POST", headers: {"Content-Type": "application/json"},
        body: JSON.stringify({job, fps, width: outW, height: outH, subfolder: this.S.sub, name, seconds: this.S.sec, audio: this.S.audio ? this.S.audioName : null})});
      if (rb.status === 404 || rb.status === 405) return await this.exportJpeg(job, fps, n, outW, outH, name, btn);   // a pack loaded before the raw route
      const b = await rb.json();
      if (!b.ok) throw new Error(b.error || "could not start the export");
      // raw pixels straight from the GPU: no JPEG in the browser, encoded by ComfyUI as they arrive
      const gl = this.stage.gl, px = new Uint8Array(outW * outH * 4);
      const t0 = performance.now();
      for (let i = 0; i < n; i++) {
        const [cam, fx] = this.frameAt(i / fps);
        this.stage.draw(cam, fx);
        gl.readPixels(0, 0, outW, outH, gl.RGBA, gl.UNSIGNED_BYTE, px);
        const r = await fetch(`/valis/stage/raw?job=${job}&w=${outW}&h=${outH}`, {method: "POST", body: px});
        if (!r.ok) throw new Error("frame upload failed");
        if (i % 6 === 0) btn.textContent = `Rendering ${Math.round(100 * i / n)}%`;
      }
      btn.textContent = "Encoding…";
      const r = await fetch("/valis/stage/finish", {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({job})}).then(r => r.json());
      if (r.error) throw new Error(r.error);
      const secs = ((performance.now() - t0) / 1000).toFixed(1);
      this.toast(`Saved ${r.subfolder}/${r.filename} · ${r.frames} frames in ${secs} s`);
      const v = this.$("#sg-last");
      v.replaceChildren(this.h("video", {src: `/view?filename=${encodeURIComponent(r.filename)}&subfolder=${encodeURIComponent(r.subfolder)}&type=output`, controls: true, loop: true, style: "width:100%;border-radius:8px"}));
      this.S.lastExport = {...r, seconds: +secs};
    } finally {
      cv.width = prev[0]; cv.height = prev[1]; btn.disabled = false; btn.innerHTML = `Export MP4<span class="sub">the preview's frames</span>`;
      this.draw();
    }
  }
}
