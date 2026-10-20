// The Stage tab: one still -> named depth layers -> a live 2.5D camera. Splitting a still is one short GPU job (SAM 3
// finds each name, Depth Anything 3 orders them, Valis completes every layer behind the ones in front); after that
// every camera move, amount, subject and duration plays live in the browser with no new diffusion job. Export renders
// the same frames the preview draws and ComfyUI's own encoder writes the MP4.
import {Stage, MOVES, fitSeq, camSeq} from "./stage3d.js";
import {EFFECTS, directAt, punchAt} from "./direct.js";
import {stageToSplat} from "./splat.js";

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
    $("#s-names").value = "the sky\nthe moon\nthe temple\nthe rocks\nthe path\nthe lamps";
    this.dropzone($("#s-still"), "image/*", async (f) => {
      const u = await this.api.upload(f);
      this.S.image = this.api.inputRef(u); this.S.imageUrl = URL.createObjectURL(f);
      const im = new Image(); im.src = this.S.imageUrl; await im.decode().catch(() => {});
      this.S.imgW = im.naturalWidth; this.S.imgH = im.naturalHeight;
      const small = Math.min(this.S.imgW, this.S.imgH) < SHARP_BELOW;
      $("#s-still").replaceChildren(h("img", {src: this.S.imageUrl, style: "width:100%;border-radius:8px;display:block"}),
        h("span", {class: "hint"}, `${f.name} · ${this.S.imgW}×${this.S.imgH}${small ? " · small: sharpened to 1440p when split" : ""}`));
      $("#s-split").disabled = false;
    });
    $("#s-split").addEventListener("click", () => this.split().catch(e => this.toast(e.message, true)));
    $("#s-open").addEventListener("change", (e) => e.target.value && this.open(e.target.value).catch(er => this.toast(er.message, true)));
    $("#s-moves").replaceChildren(...Object.entries(MOVES).map(([id, name]) => h("button", {class: "chip" + (id === this.S.move ? " on" : ""), "data-id": id,
      onclick: () => { this.S.move = id; [...$("#s-moves").children].forEach(c => c.classList.toggle("on", c.dataset.id === id)); this.refit(); this.play(); }}, name)));
    $("#s-ease").replaceChildren(...EASES.map(e => h("button", {class: e.id === this.S.easing ? "on" : "", "data-id": e.id,
      onclick: () => { this.S.easing = e.id; [...$("#s-ease").children].forEach(b => b.classList.toggle("on", b.dataset.id === e.id)); this.refit(); }}, e.name)));
    $("#s-size").replaceChildren(...SIZES.map(e => h("button", {class: e.id === this.S.size ? "on" : "", "data-id": e.id,
      onclick: () => { this.S.size = e.id; [...$("#s-size").children].forEach(b => b.classList.toggle("on", b.dataset.id === e.id)); this.refit(); }}, e.name)));
    $("#s-edge").replaceChildren(...[[false, "Crop in"], [true, "Show the dome"]].map(([id, n]) => h("button", {class: id === this.S.wide ? "on" : "", "data-id": String(id),
      title: id ? "the camera may see past the still's edge: the set fades into the far dome (less crop, wider moves)" : "zoom in just enough that the still's edge never shows",
      onclick: () => { this.S.wide = id; [...$("#s-edge").children].forEach(b => b.classList.toggle("on", b.dataset.id === String(id))); this.refit(); }}, n)));
    $("#s-amount").addEventListener("input", (e) => { this.S.amount = +e.target.value; $("#s-amount-v").textContent = (+e.target.value).toFixed(2); this.refit(); });
    $("#s-sec").addEventListener("input", (e) => { this.S.sec = +e.target.value; $("#s-sec-v").textContent = `${(+e.target.value).toFixed(1)} s`; this.refit(); });
    $("#s-focus").addEventListener("change", (e) => { this.S.focus = e.target.value; this.refit(); this.play(); });
    $("#s-scrub").addEventListener("input", (e) => { this.S.playing = false; this.player?.pause(); this.S.T = +e.target.value * this.S.sec; this.draw(); this.playBtn(); });
    $("#st-play").addEventListener("click", () => this.S.playing ? (this.S.playing = false, this.playBtn()) : this.play());
    $("#st-export").addEventListener("click", () => this.export().catch(e => this.toast(e.message, true)));
    $("#st-splat").addEventListener("click", () => this.saveSplat().catch(e => this.toast(e.message, true)));
    $("#s-akind").replaceChildren(...[["music", "Music"], ["voice", "Voice"], ["both", "Both"]].map(([id, n]) => h("button", {class: id === this.S.akind ? "on" : "", "data-id": id,
      onclick: () => { this.S.akind = id; [...$("#s-akind").children].forEach(b => b.classList.toggle("on", b.dataset.id === id)); this.S.audio && this.loadCues().catch(e => this.toast(e.message, true)); }}, n)));
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
    $("#s-sheet").addEventListener("change", () => this.loadCues().catch(e => this.toast(e.message, true)));
    $("#s-camstart").addEventListener("input", (e) => { this.S.camStart = Math.max(0, +e.target.value || 0); this.refit(); });
    $("#s-camstart").addEventListener("focus", () => { this.S.active = 0; this.drawThen(); });
    $("#s-addthen").addEventListener("click", () => {
      const last = this.shots().slice(-1)[0];
      const start = Math.min(this.S.sec - 0.5, Math.max((last?.start ?? 0) + 1, this.S.T ?? 0));
      this.S.then.push({move: "dolly_zoom_in", amount: 0.6, focus: this.S.focus, start});
      this.S.active = this.S.then.length; this.drawThen(); this.refit();
      this.toast("Click the sound strip to start this move on a word or a hit");
    });
    $("#s-punch").addEventListener("change", (e) => { this.S.punch = e.target.value; });
    $("#s-addrule").addEventListener("click", () => { this.S.rules.push({layer: this.stage?.layers.find(l => !l.backdrop)?.name || "", effect: "glow", on: this.lanes()[0] || "always", amount: 1}); this.drawRules(); });
    $("#s-wave").addEventListener("click", (e) => {
      const r = e.target.getBoundingClientRect(), T = (e.clientX - r.left) / r.width * this.S.sec;
      // snap to the nearest syllable/hit when one is close: "start the move on that word"
      let best = T, bd = 0.25;
      for (const ts of Object.values(this.S.cues?.lanes || {})) for (const x of ts) if (Math.abs(x - T) < bd) { bd = Math.abs(x - T); best = x; }
      const at = Math.max(0, Math.min(this.S.sec - 0.2, best));
      if (this.S.active > 0 && this.S.then[this.S.active - 1]) { this.S.then[this.S.active - 1].start = at; this.drawThen(); }
      else { this.S.camStart = at; $("#s-camstart").value = at.toFixed(2); }
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
    $("#s-open").replaceChildren(h("option", {value: ""}, r.stages.length ? "open a stage…" : "no stages yet"),
      ...r.stages.map(s => h("option", {value: s.subfolder, selected: s.subfolder === select}, `${s.name} · ${s.layers} layers`)));
  }

  lanes() { return Object.keys(this.S.cues?.lanes || {}).filter(k => (this.S.cues.lanes[k] || []).length); }

  async loadCues() {
    const body = {audio: this.S.audio ? (this.S.audioName) : null, kind: this.S.akind, sheet: this.$("#s-sheet").value, duration: this.S.sec};
    if (!body.audio && !body.sheet.trim()) { this.S.cues = null; this.drawRules(); this.drawWave(); return; }
    const r = await fetch("/valis/stage/cues", {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(body)}).then(r => r.json());
    if (r.error) throw new Error(r.error);
    this.S.cues = r; this.S.wave = r.wave;
    if (r.duration) { this.S.sec = Math.min(30, Math.max(1, r.duration)); this.$("#s-sec").max = Math.max(12, Math.ceil(this.S.sec)); this.$("#s-sec").value = this.S.sec; this.$("#s-sec-v").textContent = `${this.S.sec.toFixed(1)} s`; }
    const ls = this.lanes();
    this.toast(ls.length ? `Heard: ${ls.map(k => `${k} ×${r.lanes[k].length}`).join(", ")}` : "No cues found");
    this.$("#s-punch").replaceChildren(...["none", ...ls].map(k => this.h("option", {value: k, selected: k === this.S.punch}, k === "none" ? "no punch" : `punch on ${k}`)));
    this.drawRules(); this.drawWave();
  }

  drawWave() {
    const cv = this.$("#s-wave"); if (!cv) return;
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
    $("#s-rules").replaceChildren(...this.S.rules.map((r, i) => h("div", {class: "maprow rule"},
      h("select", {onchange: (e) => { r.layer = e.target.value; this.draw(); }}, ...layers.map(n => h("option", {value: n, selected: n === r.layer}, n))),
      h("select", {onchange: (e) => { r.effect = e.target.value; this.draw(); }}, ...Object.entries(EFFECTS).map(([k, v]) => h("option", {value: k, selected: k === r.effect, title: v.hint}, v.name))),
      h("select", {onchange: (e) => { r.on = e.target.value; this.draw(); }}, ...lanes.map(n => h("option", {value: n, selected: n === r.on}, n === "always" ? "always" : `on ${n}`))),
      h("input", {type: "range", min: 0.1, max: 3, step: 0.05, value: r.amount, title: "amount", oninput: (e) => { r.amount = +e.target.value; this.draw(); }}),
      h("button", {class: "chip", title: "remove", onclick: () => { this.S.rules.splice(i, 1); this.drawRules(); this.draw(); }}, "×"))));
  }

  names() {
    return this.$("#s-names").value.split(/\n|,/).map(s => s.trim()).filter(Boolean).slice(0, 12);
  }

  // ---- the one GPU step -------------------------------------------------------------------------------------------
  async split() {
    if (!this.S.image) throw new Error("Drop a still first");
    const names = this.names();
    if (!names.length) throw new Error("Name at least one thing in the picture");
    const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
    const name = `stage_${stamp}`;
    const btn = this.$("#s-split");
    const short = Math.min(this.S.imgW || 0, this.S.imgH || 0);
    const sharpen = short && short < SHARP_BELOW && this.$("#s-sharp")?.checked !== false ? SHARP_TO : 0;
    btn.disabled = true;
    try {
      const job = await this.api.submit(this.G.stage({image: this.S.image, names, name, far: +this.$("#s-far").value, sharpen}), `Stage: ${names.join(", ")}`, "stage");
      this.toast(sharpen ? `Splitting the still: SeedVR2 sharpens it to ${SHARP_TO}p (~1 min), SAM 3 finds each name, Depth Anything 3 orders them`
        : short && short < 1000 ? `This still is only ${short} px on its short side: 1080p exports will be soft` : "Splitting the still: SAM 3 finds each name, Depth Anything 3 orders them");
      await new Promise((res, rej) => {
        const off = this.api.on((ev) => {
          if (ev.job?.id !== job.id) return;
          if (ev.job.status === "done") { off(); res(); } else if (ev.job.status === "error") { off(); rej(new Error(ev.job.error)); }
        });
      });
      const sub = `valis/stage/${name}`;
      await this.listStages(sub);
      await this.open(sub);
    } finally { btn.disabled = false; }
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
    $("#s-focus").replaceChildren(...this.stage.layers.map(l => h("option", {value: l.name, selected: l.name === pick.name}, l.name)));
    this.S.then = []; this.S.active = 0;
    this.drawLayers(); this.drawRules(); this.drawThen();
    $("#s-empty").style.display = "none"; cv.style.display = "block";
    $("#s-controls").style.display = "";
    this.refit(); this.play();
  }

  drawLayers() {
    const {h, $} = this;
    $("#s-layers").replaceChildren(...[...this.stage.layers].reverse().map(l => h("div", {class: "maprow"},
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
    if (!$("#s-then")) return;
    const layers = this.stage ? this.stage.layers.map(l => l.name) : [];
    $("#s-then").replaceChildren(...this.S.then.map((t, i) => h("div", {class: "maprow rule" + (this.S.active === i + 1 ? " on" : ""), onclick: () => { this.S.active = i + 1; this.drawThen(); this.drawWave(); }},
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
    this.$("#s-crop").innerHTML = `framed ${crop.toFixed(2)}× ${wide ? "· the edge may show, fading into the dome" : this.S.wide ? "so no edge ever shows (this stage has no dome: split it again to get one)" : "so no edge ever shows"} · ${Math.round(srcH)} px of the still's ${this.S.meta.height} fill the ${outH}p frame` +
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
    this.$("#s-scrub").value = T / this.S.sec;
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
    this.$("#s-last").replaceChildren(this.h("video", {src: `/view?filename=${encodeURIComponent(r.filename)}&subfolder=${encodeURIComponent(r.subfolder)}&type=output`, controls: true, loop: true, style: "width:100%;border-radius:8px"}));
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
      const v = this.$("#s-last");
      v.replaceChildren(this.h("video", {src: `/view?filename=${encodeURIComponent(r.filename)}&subfolder=${encodeURIComponent(r.subfolder)}&type=output`, controls: true, loop: true, style: "width:100%;border-radius:8px"}));
      this.S.lastExport = {...r, seconds: +secs};
    } finally {
      cv.width = prev[0]; cv.height = prev[1]; btn.disabled = false; btn.innerHTML = `Export MP4<span class="sub">same frames as the preview · no GPU job</span>`;
      this.draw();
    }
  }
}
