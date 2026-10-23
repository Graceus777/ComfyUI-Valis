// The FX tab: the Valis library on any clip. Effects are layers that each listen to a lane; the lanes come from a song
// (beats, bands, loudness), a song YuE2 writes (its own sheet music), a soundless cue sheet, or a Valis score.
export class FxView {
  constructor({$, h, toast, assets, api, G, run, VID}) {
    Object.assign(this, {$, h, toast, assets, api, G, run, VID});
    this.F = {clip: null, clipUrl: null, other: null, source: "sheet", audio: null, layers: [], beds: new Set(["room"])};
    this.lanes = new Set(["beat", "downbeat", "kick", "snare", "hat", "onset", "loud", "bright", "low"]);
    this.init();
  }

  init() {
    const {$, h, G} = this;
    $("#f-cues").value = G.CUE_SHEET_EXAMPLE;
    const srcs = [{id: "sheet", name: "Cues"}, {id: "song", name: "Music"}, {id: "write", name: "New song"}, {id: "score", name: "Score"}];
    $("#f-source").replaceChildren(...srcs.map(s => h("button", {"data-id": s.id, class: s.id === this.F.source ? "on" : "",
      onclick: () => this.setSource(s.id)}, s.name)));
    this.setSource("sheet");
    $("#f-beds").replaceChildren(...G.BEDS.map(b => h("button", {class: "chip" + (this.F.beds.has(b) ? " on" : ""), onclick: (e) => {
      this.F.beds.has(b) ? this.F.beds.delete(b) : this.F.beds.add(b); e.target.classList.toggle("on"); }}, b)));
    this.library();
    this.drawLayers();
    this.dropzone($("#f-clip"), "video/*", async (f) => {
      const u = await this.api.upload(f); this.setClip(this.api.inputRef(u), URL.createObjectURL(f), f.name);
    });
    this.dropzone($("#f-song"), "audio/*", async (f) => {
      const u = await this.api.upload(f); this.F.audio = this.api.inputRef(u);
      $("#f-song").replaceChildren(h("audio", {src: URL.createObjectURL(f), controls: true, style: "width:100%"}), h("span", {}, f.name));
      this.toast("Music ready: Valis will hear its beats and bands");
    });
    $("#f-clip-sel").addEventListener("change", (e) => { const o = e.target.selectedOptions[0]; if (o.value) this.setClip(o.value, o.dataset.url, o.textContent); });
    $("#f-other-sel").addEventListener("change", (e) => { this.F.other = e.target.value || null; this.drawLayers(); });
    $("#f-render").addEventListener("click", () => this.render());
  }

  dropzone(el, accept, onFile) {
    const input = this.h("input", {type: "file", accept, style: "display:none"});
    el.append(input);
    el.addEventListener("click", (e) => { if (e.target.tagName !== "AUDIO") input.click(); });
    input.addEventListener("change", () => input.files[0] && onFile(input.files[0]).catch(e => this.toast(e.message, true)));
    el.addEventListener("dragover", (e) => { e.preventDefault(); el.classList.add("over"); });
    el.addEventListener("dragleave", () => el.classList.remove("over"));
    el.addEventListener("drop", (e) => { e.preventDefault(); el.classList.remove("over"); const f = e.dataTransfer.files[0]; if (f) onFile(f).catch(er => this.toast(er.message, true)); });
  }

  setSource(id) {
    const {$} = this;
    this.F.source = id;
    [...$("#f-source").children].forEach(b => b.classList.toggle("on", b.dataset.id === id));
    $("#f-src-song").style.display = id === "song" ? "" : "none";
    $("#f-src-write").style.display = id === "write" ? "" : "none";
    $("#f-src-sheet").style.display = id === "sheet" ? "" : "none";
    const extra = {sheet: [], song: [], write: ["melody", "ins", "note", "bass", "lead", "chord", "bar", "section"],
                   score: ["kick", "impact", "stroke", "melody", "pah", "violin", "heartbeat", "musicbox", "stab"]}[id];
    extra.forEach(l => this.lanes.add(l));
    this.drawLayers();
    $("#f-render .sub").textContent = id === "write" ? "YuE2 song ~1 min, then Valis · CPU" : "Valis · CPU · ~1 min per 4 s";
  }

  async refreshClips() {
    const {$, h, api, VID} = this;
    const hist = await api.history(80).catch(() => ({}));
    const vids = [];
    for (const e of Object.values(hist).reverse()) for (const f of api.outputsOf(e))
      if (VID.test(f.filename) && !/matte|overlay/.test(f.filename) && (f.type || "output") === "output") vids.push(f);
    const opts = (first) => [h("option", {value: ""}, first), ...vids.slice(0, 60).map(f => h("option", {value: api.outputRef(f), "data-url": api.viewUrl(f)}, `${f.subfolder}/${f.filename}`))];
    const a = $("#f-clip-sel"), b = $("#f-other-sel"), ka = a.value, kb = b.value;
    a.replaceChildren(...opts("…or pick a render")); b.replaceChildren(...opts("none"));
    if (ka) a.value = ka; if (kb) b.value = kb;
  }

  setClip(ref, url, label = "clip") {
    const {$, h} = this;
    this.F.clip = ref; this.F.clipUrl = url;
    $("#f-clip").replaceChildren(h("video", {src: url, muted: true, autoplay: true, loop: true, playsinline: true}), h("span", {}, label));
    $("#f-viewer").replaceChildren(h("video", {src: url, controls: true, autoplay: true, loop: true, muted: true, playsinline: true}));
    $("#f-render").disabled = false;
  }

  library() {
    const {$, h, G, assets} = this;
    $("#f-lib").replaceChildren(...G.LIBRARY.map(fx => {
      const vid = h("video", {src: `${assets}/fx/${fx.id}.webm`, muted: true, loop: true, playsinline: true, autoplay: true, preload: "auto"});
      vid.addEventListener("error", () => vid.replaceWith(h("div", {class: "ph"})));
      return h("div", {class: "fxcard", "data-id": fx.id, title: fx.blurb, onclick: () => this.addLayer(fx)}, vid,
        h("span", {class: "add"}, "+ add"), h("div", {class: "lbl"}, h("b", {}, fx.name), h("span", {}, fx.blurb)));
    }));
  }

  addLayer(fx) {
    this.F.layers.push({effect: fx.id, name: fx.name, on: fx.on || "", by: fx.by || "", params: {...fx.params}, needs: fx.needs});
    this.drawLayers();
  }

  drawLayers() {
    const {$, h} = this;
    const dl = h("datalist", {id: "f-lanes"}, ...[...this.lanes].map(l => h("option", {value: l})));
    const rows = this.F.layers.map((l, k) => {
      const lane = h("input", {type: "text", list: "f-lanes", value: l.by || l.on, title: l.by ? "a held amount: a curve or a lane's envelope" : "the lane that fires it"});
      lane.addEventListener("input", () => { if (l.by) l.by = lane.value; else l.on = lane.value; });
      const missing = (l.needs || []).filter(n => (n === "other" && !this.F.other) || (n === "subject" && !$("#f-subject").value.trim()));
      return h("div", {class: "layer"},
        h("div", {}, h("b", {}, l.name), missing.length ? h("div", {class: "hint", style: "margin:2px 0 0"}, `needs ${missing.join(" and ")}`) : null),
        lane, h("button", {class: "x", title: "remove", onclick: () => { this.F.layers.splice(k, 1); this.drawLayers(); }}, "×"));
    });
    $("#f-layers").replaceChildren(dl, ...rows);
    $("#f-layers-hint").style.display = this.F.layers.length ? "none" : "";
    [...$("#f-lib").children].forEach(c => c.classList.toggle("on", this.F.layers.some(l => l.effect === c.dataset.id)));
  }

  render() {
    const {$, h, G, run, api, VID, F} = this;
    if (!F.clip) return this.toast("Pick a clip first", true);
    if (!F.layers.length) return this.toast("Add at least one effect from the library", true);
    if (F.source === "song" && !F.audio) return this.toast("Drop the music first", true);
    const songSpec = F.source === "write" ? {style: $("#f-style").value.trim() || "instrumental, cinematic", lyrics: $("#f-lyrics").value.trim() || "[Instrumental]",
      seconds: Number($("#f-secs").value) || 20} : null;
    const g = G.fx({clip: F.clip, other: F.other, subject: $("#f-subject").value.trim(), source: F.source, audio: F.audio, songSpec,
      cueSheet: $("#f-cues").value, score: "valis/danse_v3_score.json",
      layers: F.layers.map(l => ({effect: l.effect, on: l.on, by: l.by, params: l.params})), beds: [...F.beds], sound: $("#f-sound").checked,
      seconds: 4.46, prefix: `valis/fx_${Date.now().toString(36)}`, loop: $("#f-loop").checked});
    run(g, `FX · ${F.layers.map(l => l.name).join(" + ")}`, $("#f-viewer"), {onDone: (j) => {
      const v = j.outputs.find(f => VID.test(f.filename));
      if (v) $("#f-viewer").replaceChildren(h("video", {src: api.viewUrl(v), controls: true, autoplay: true, loop: true, playsinline: true}));
    }});
  }
}
