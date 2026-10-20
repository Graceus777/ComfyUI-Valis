// The Score tab: a Valis score's event map drawn as lanes, rules mapping events to effects, and playback that
// follows the shots. The score json is what the Valis score engine writes (bar/beat/event times + envelopes).
export const EFFECTS = [
  {id: "candles", name: "Candles light", color: "#ffb35c"},
  {id: "shockwave", name: "Shockwave", color: "#9cc2ff"},
  {id: "lightning", name: "Lightning arc", color: "#c9b6ff"},
  {id: "rim", name: "Rim pulse", color: "#7fd3ff"},
  {id: "crowd", name: "Ghost crowd", color: "#b8d8ff"},
  {id: "ripple", name: "Floor ripple", color: "#8fe0d0"},
  {id: "ignite", name: "Reveal (ignite)", color: "#ff8a4c"},
  {id: "flare", name: "Flare", color: "#ffd27f"},
  {id: "vanish", name: "Vanish (burn away)", color: "#ff6b6b"},
  {id: "halo", name: "Halo", color: "#e6f0ff"},
  {id: "whiteout", name: "Whiteout", color: "#ffffff"},
  {id: "glint", name: "Glint", color: "#fff1c9"},
  {id: "punch", name: "Camera punch", color: "#9a9aa8"},
];
const DEFAULT_RULES = [
  ["musicbox", "candles"], ["stroke", "shockwave"], ["violin", "lightning"], ["heartbeat", "rim"], ["pah", "crowd"],
  ["kick", "ignite"], ["stab", "flare"], ["response_right", "vanish"], ["impact", "halo"], ["final_hit", "whiteout"], ["glint", "glint"],
];
const LANES = ["musicbox", "tick", "stroke", "violin", "heartbeat", "pah", "ghost_pah", "melody", "kick", "clap", "stab", "call_left", "response_right", "impact", "breath", "final_hit", "glint"];
const SEC_COL = {prologue: "#2b2238", midnight: "#1c2440", call: "#2b2440", waltz: "#1d3036", build: "#33301d", drop: "#3a2219", breakdown: "#1d2430", reveal: "#2a1a22", finale: "#3a1f1f", dawn: "#3a311d"};

export class ScoreView {
  constructor({$, h, toast, assets, api, G, run}) {
    Object.assign(this, {$, h, toast, assets, api, G, run});
    this.assign = {}; this.results = {}; this.scoreRef = null; this.scoreFile = null;
    this.sc = null; this.rules = DEFAULT_RULES.map(([e, f]) => ({event: e, effect: f}));
    this.audio = $("#s-audio"); this.canvas = $("#s-canvas"); this.t = 0; this.loaded = false;
    this.thumbs = [];
    $("#s-play").addEventListener("click", () => this.toggle());
    $("#s-add").addEventListener("click", () => { this.rules.push({event: "kick", effect: "flare"}); this.renderRules(); this.draw(); });
    $("#s-export").addEventListener("click", () => this.exportRules());
    $("#s-render").addEventListener("click", () => this.renderAll());
    this.canvas.addEventListener("click", (e) => {
      if (!this.sc) return;
      const r = this.canvas.getBoundingClientRect();
      const t = (e.clientX - r.left - this.L) / (r.width - this.L - 12) * this.sc.duration_seconds;
      if (t >= 0) { this.audio.currentTime = t; this.t = t; this.draw(); this.preview(); }
    });
    addEventListener("resize", () => this.draw());
    const segEl = $("#s-source");
    segEl.replaceChildren(...[["demo", "DANSE MACABRE"], ["mine", "My score"]].map(([id, name], k) =>
      h("button", {class: k ? "" : "on", onclick: (e) => { [...segEl.children].forEach(b => b.classList.toggle("on", b === e.target)); $("#s-drop").style.display = id === "mine" ? "" : "none"; if (id === "demo") this.loadDemo(); }}, name)));
    const drop = $("#s-drop");
    const input = h("input", {type: "file", multiple: true, accept: ".json,audio/*", style: "display:none"});
    drop.append(input); drop.onclick = () => input.click();
    input.onchange = () => this.loadFiles([...input.files]);
    drop.ondragover = (e) => { e.preventDefault(); drop.classList.add("over"); };
    drop.ondragleave = () => drop.classList.remove("over");
    drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove("over"); this.loadFiles([...e.dataTransfer.files]); };
  }
  ensure() { if (!this.loaded) this.loadDemo(); else this.draw(); }
  async loadDemo() {
    this.loaded = true;
    try {
      const sc = await (await fetch(`${this.assets}/demo/danse_v3_score.json`)).json();
      this.audio.src = `${this.assets}/demo/danse_v3.mp3`;
      this.thumbs = sc.shots.map(s => `${this.assets}/demo/shots/${s.id}.jpg`);
      this.scoreRef = null; this.scoreFile = new File([JSON.stringify(sc)], "danse_v3_score.json", {type: "application/json"});
      this.set(sc);
    } catch (e) { this.toast("Demo score missing from the pack", true); }
  }
  async loadFiles(files) {
    const j = files.find(f => f.name.endsWith(".json")), a = files.find(f => f.type.startsWith("audio/"));
    if (j) { this.thumbs = []; this.scoreRef = null; this.scoreFile = j; this.set(JSON.parse(await j.text())); }
    if (a) this.audio.src = URL.createObjectURL(a);
  }
  set(sc) {
    this.sc = sc; this.t = 0;
    const lanes = LANES.filter(k => sc.events[k]?.length);
    this.lanes = lanes;
    this.$("#s-info").innerHTML = `${sc.title || "score"} · ${sc.meter} at ${sc.bpm.toFixed(1)} BPM · ${sc.bars} bars · ${sc.duration_seconds.toFixed(1)} s<br>${lanes.length} event lanes, ${Object.values(sc.events).reduce((a, v) => a + v.length, 0)} events`;
    this.$("#s-tempo").textContent = `${sc.meter} · ${sc.bpm.toFixed(1)} BPM · ${sc.key || ""}`;
    this.renderRules(); this.draw(); this.preview(); this.renderShots();
  }
  async videos() {
    const hist = await this.api.history(120).catch(() => ({}));
    const out = [];
    for (const e of Object.values(hist)) for (const f of this.api.outputsOf(e))
      if ((f.type || "output") === "output" && /\.(mp4|webm|mov)$/i.test(f.filename) && !/matte|overlay|mask/.test(f.filename)) out.push(f);
    return out.reverse();
  }
  async renderShots() {
    const sc = this.sc, {h} = this; if (!sc?.shots) return;
    const vids = await this.videos();
    const opts = (cur) => [h("option", {value: ""}, "— no clip —"), ...vids.map(f => { const ref = this.api.outputRef(f); return h("option", {value: ref, selected: ref === cur}, `${f.subfolder}/${f.filename}`); })];
    this.$("#s-shots").replaceChildren(...sc.shots.map(shot => {
      const sec = this.sectionAt(shot.start_frame / 24);
      const a = this.assign[shot.id] || (this.assign[shot.id] = {clip: "", layer: ""});
      const clip = h("select", {onchange: (e) => a.clip = e.target.value}, ...opts(a.clip));
      const layer = h("select", {onchange: (e) => a.layer = e.target.value}, h("option", {value: ""}, "— no layer (plate only) —"), ...opts(a.layer).slice(1));
      const row = h("div", {class: "shotrow" + (this.results[shot.id] ? " done" : ""), "data-shot": shot.id},
        h("div", {class: "nm"}, `${shot.id} ${shot.name || ""}`, h("span", {}, `bar ${shot.start_bar + 1} · ${sec?.name || ""}`)),
        h("button", {class: "btn go", onclick: () => this.renderShot(shot)}, "Render"), clip, layer);
      return row;
    }));
  }
  sectionAt(t) { return this.sc.sections.find(s => t >= s.start - 1e-6 && t < s.end); }
  async ensureScore() {
    if (this.scoreRef) return this.scoreRef;
    const u = await this.api.upload(this.scoreFile);
    this.scoreRef = this.api.inputRef(u);
    return this.scoreRef;
  }
  async renderShot(shot) {
    const a = this.assign[shot.id] || {};
    if (!a.clip) return this.toast(`Pick a clip for ${shot.id} first`, true);
    const score = await this.ensureScore();
    const sec = this.sectionAt(shot.start_frame / 24);
    const g = this.G.valisShot({clip: a.clip, score, startBar: shot.start_bar, section: sec?.name || "", layer: a.layer || null, rules: this.rules,
      targetA: this.$("#s-a").value.trim(), targetB: this.$("#s-b").value.trim(), prefix: `valis/valis_${shot.id}`});
    return this.run(g, `Valis ${shot.id} ${shot.name || ""}`, this.$("#s-viewer"), {onDone: (j) => {
      const v = j.outputs.find(f => /\.(mp4|webm|mov)$/i.test(f.filename));
      if (!v) return;
      this.results[shot.id] = this.api.viewUrl(v);
      this.$(`[data-shot="${shot.id}"]`)?.classList.add("done");
      this.$("#s-viewer").replaceChildren(this.h("video", {src: this.results[shot.id], autoplay: true, loop: true, muted: true, controls: true, playsinline: true, style: "height:100%;max-height:520px"}));
    }});
  }
  async renderAll() {
    const todo = (this.sc?.shots || []).filter(s => this.assign[s.id]?.clip);
    if (!todo.length) return this.toast("Give at least one shot a clip (Shots, on the left)", true);
    for (const s of todo) await this.renderShot(s);
  }
  renderRules() {
    const {h} = this;
    const evs = this.lanes || LANES;
    this.$("#s-map").replaceChildren(...this.rules.map((r, k) => {
      const ev = h("select", {onchange: (e) => { r.event = e.target.value; this.draw(); }}, ...evs.map(x => h("option", {value: x, selected: x === r.event}, x.replace("_", " "))));
      const fx = h("select", {onchange: (e) => { r.effect = e.target.value; this.draw(); }}, ...EFFECTS.map(x => h("option", {value: x.id, selected: x.id === r.effect}, x.name)));
      return h("div", {class: "maprow"}, ev, h("span", {class: "arrow"}, "→"), fx);
    }));
  }
  colorFor(lane) { const r = this.rules.find(r => r.event === lane); return r ? EFFECTS.find(e => e.id === r.effect)?.color : null; }
  draw() {
    const c = this.canvas, sc = this.sc; if (!sc) return;
    const dpr = devicePixelRatio || 1, W = c.clientWidth, laneH = 17, top = 70;
    const H = top + this.lanes.length * laneH + 34;
    c.style.height = `${H}px`; c.width = W * dpr; c.height = H * dpr;
    const x = c.getContext("2d"); x.setTransform(dpr, 0, 0, dpr, 0, 0);
    const L = this.L = 112, R = 12, D = sc.duration_seconds, X = (t) => L + (W - L - R) * t / D;
    x.fillStyle = "#0c0c11"; x.fillRect(0, 0, W, H);
    for (const s of sc.sections) { x.fillStyle = SEC_COL[s.name] || "#1a1a22"; x.globalAlpha = .55; x.fillRect(X(s.start), 0, X(s.end) - X(s.start), H); x.globalAlpha = 1;
      x.fillStyle = "#c9c9d6"; x.font = "600 10px Inter, sans-serif"; x.fillText(s.name.toUpperCase(), X(s.start) + 5, 13); }
    const env = sc.envelopes?.mix || [];
    if (env.length) { x.beginPath(); const mid = 44;
      env.forEach((v, i) => { const xx = X(i / 24); x.moveTo(xx, mid - v * 22); x.lineTo(xx, mid + v * 22); });
      x.strokeStyle = "rgba(220,226,255,.35)"; x.lineWidth = 1; x.stroke(); }
    x.strokeStyle = "rgba(255,255,255,.07)"; x.lineWidth = 1;
    (sc.events.bar || []).forEach((t, i) => { if (i % 4 === 0) { x.beginPath(); x.moveTo(X(t), 20); x.lineTo(X(t), H - 20); x.stroke(); } });
    this.lanes.forEach((lane, k) => {
      const y = top + k * laneH;
      const col = this.colorFor(lane);
      x.fillStyle = col ? "#e8e8f0" : "#6b6b78"; x.font = "11px Inter, sans-serif"; x.fillText(lane.replace("_", " "), 10, y + 12);
      if (col) { x.fillStyle = col; x.fillRect(L - 14, y + 4, 8, 8); }
      x.fillStyle = col || "#4a4a56";
      for (const t of sc.events[lane]) { const xx = X(t); x.globalAlpha = col ? .95 : .55; x.fillRect(xx - 1, y + 3, col ? 3 : 2, laneH - 6); }
      x.globalAlpha = 1;
    });
    x.font = "10px Inter, sans-serif"; x.fillStyle = "#8d8d9b";
    (sc.shots || []).forEach((s, i) => { const t0 = s.start_frame / 24, t1 = t0 + s.frames / 24; x.fillText(s.name || s.id, X(t0) + 3, H - 8);
      x.fillStyle = "rgba(255,255,255,.06)"; x.fillRect(X(t0) + 1, H - 22, X(t1) - X(t0) - 2, 3); x.fillStyle = "#8d8d9b"; });
    const px = X(this.t); x.fillStyle = "#ff8a4c"; x.fillRect(px - 1, 0, 2, H);
    // events firing right now glow
    this.lanes.forEach((lane, k) => { const col = this.colorFor(lane); if (!col) return;
      for (const t of sc.events[lane]) { const a = this.t - t; if (a >= 0 && a < .35) { x.globalAlpha = 1 - a / .35; x.fillStyle = col; x.beginPath(); x.arc(X(t), top + k * laneH + 8.5, 7, 0, 7); x.fill(); x.globalAlpha = 1; } } });
  }
  preview() {
    const sc = this.sc; if (!sc) return;
    const shot = (sc.shots || []).find(s => this.t >= s.start_frame / 24 && this.t < (s.start_frame + s.frames) / 24) || sc.shots?.[sc.shots.length - 1];
    const sec = sc.sections.find(s => this.t >= s.start && this.t < s.end);
    this.$("#s-section").textContent = `${sec ? sec.name : "tail"} · bar ${Math.floor(this.t / sc.bar_seconds) + 1}${shot ? ` · ${shot.id} ${shot.name || ""}` : ""}`;
    const m = Math.floor(this.t / 60), s = (this.t % 60).toFixed(1).padStart(4, "0");
    this.$("#s-time").textContent = `${m}:${s}`;
    if (!shot) return;
    const idx = sc.shots.indexOf(shot);
    const res = this.results[shot.id];
    if (res) {                         // a rendered shot plays in sync with the score
      let v = this.$("#s-viewer video[data-shot]");
      if (this.cur !== idx || !v) { this.cur = idx; v = this.h("video", {src: res, muted: true, playsinline: true, "data-shot": shot.id, style: "height:100%;max-height:520px;border-radius:8px"}); this.$("#s-viewer").replaceChildren(v);
        const s0 = shot.start_frame / 24; v.addEventListener("loadedmetadata", () => { v.currentTime = Math.max(0, this.t - s0); }, {once: true}); }
      // re-sync only on a real drift, and never while a seek is still landing: re-seeking on every frame of a slow
      // load keeps the preview stuck on one frame
      const want = Math.max(0, this.t - shot.start_frame / 24);
      if (v.readyState >= 2 && !v.seeking && Math.abs(v.currentTime - want) > .35) v.currentTime = want;
      if (!this.audio.paused && v.paused) v.play().catch(() => {});
      if (this.audio.paused && !v.paused) v.pause();
      return;
    }
    if (!this.thumbs.length) return;
    if (this.cur !== idx) { this.cur = idx;
      const fired = this.rules.filter(r => (sc.events[r.event] || []).some(t => t >= shot.start_frame / 24 && t < (shot.start_frame + shot.frames) / 24));
      const v = this.$("#s-viewer");
      v.replaceChildren(this.h("img", {src: this.thumbs[idx], style: "height:100%;max-height:520px;border-radius:8px"}),
        this.h("div", {style: "position:absolute;left:14px;bottom:12px;display:flex;gap:6px;flex-wrap:wrap;max-width:60%"},
          ...fired.map(r => { const e = EFFECTS.find(x => x.id === r.effect); return this.h("span", {class: "badge", style: `border-color:${e.color};color:${e.color}`}, `${r.event.replace("_", " ")} → ${e.name}`); })));
    }
  }
  toggle() {
    if (!this.sc) return;
    if (this.audio.paused) { this.audio.play(); this.$("#s-play").textContent = "❚❚ Pause"; this.loop(); }
    else { this.audio.pause(); this.$("#s-play").textContent = "▶ Play"; }
  }
  loop() {
    if (this.audio.paused) return;
    this.t = this.audio.currentTime; this.draw(); this.preview();
    requestAnimationFrame(() => this.loop());
  }
  exportRules() {
    const sc = this.sc; if (!sc) return;
    const out = {score: sc.title, bpm: sc.bpm, rules: this.rules, shots: (sc.shots || []).map(s => ({id: s.id, name: s.name, start_bar: s.start_bar,
      effects: this.rules.filter(r => (sc.events[r.event] || []).some(t => t >= s.start_frame / 24 && t < (s.start_frame + s.frames) / 24)).map(r => r.effect)}))};
    const a = this.h("a", {href: URL.createObjectURL(new Blob([JSON.stringify(out, null, 1)], {type: "application/json"})), download: "valis_rules.json"});
    a.click();
  }
}
