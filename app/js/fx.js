// The FX tab: the Valis library on any clip. Effects are layers that each listen to a lane; the lanes come from a song
// (beats, bands, loudness), a song YuE2 writes (its own sheet music), a soundless cue sheet, or a Valis score.
export class FxView {
  constructor({$, h, toast, assets, api, G, run, VID, bin, getScore = () => null, estimate = null}) {
    Object.assign(this, {$, h, toast, assets, api, G, run, VID, getScore, bin});
    this.estimate = () => setTimeout(() => estimate?.(), 0);      // after the studio has finished building
    this.F = {clip: null, clipUrl: null, other: null, source: "sheet", audio: null, layers: [], beds: new Set(["room"])};
    this.lanes = new Set(["beat", "downbeat", "kick", "snare", "hat", "onset", "loud", "bright", "low"]);
    this.init();
  }

  init() {
    const {$, h, G} = this;
    $("#f-cues").value = G.CUE_SHEET_EXAMPLE;
    const srcs = [{id: "sheet", name: "Cues", tip: "A cue sheet you write: no music needed"}, {id: "song", name: "Music", tip: "Any song: its beats and hits are the lanes"},
      {id: "write", name: "New song", tip: "YuE2 writes a song; effects fire on the notes it wrote"}, {id: "score", name: "Score", tip: "The score open in the Score tab: its lanes and its song"}];
    $("#f-source").replaceChildren(...srcs.map(s => h("button", {"data-id": s.id, "data-tip": s.tip, class: s.id === this.F.source ? "on" : "",
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
    $("#f-clip")._onItem = (it) => { if (it.kind === "clip") this.setClip(this.api.fileRef(it.file), this.api.viewUrl(it.file), it.label || it.file.filename); };
    $("#f-song")._onItem = (it) => { if (it.kind !== "audio" && it.kind !== "clip") return; this.F.audio = this.api.fileRef(it.file);
      $("#f-song").replaceChildren(h("audio", {src: this.api.viewUrl(it.file), controls: true, style: "width:100%"}), h("span", {}, it.file.filename)); };
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
    el.addEventListener("drop", (e) => {
      e.preventDefault(); el.classList.remove("over");
      const f = e.dataTransfer.files[0]; if (f) return onFile(f).catch(er => this.toast(er.message, true));
      const raw = e.dataTransfer.getData("application/x-valis-item");          // dragged from the bin
      if (raw && el._onItem) el._onItem(JSON.parse(raw));
    });
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
    this.estimate?.();
  }

  // the clips to pick from: the bin (everything the studio made, kept between sessions)
  async refreshClips() {
    const {$, h} = this, Bin = this.bin;
    await Bin.load();
    const clips = Bin.list("clip").slice(0, 60);
    const opts = (first) => [h("option", {value: ""}, first), ...clips.map(it => h("option", {value: Bin.ref(it), "data-url": Bin.url(it)}, it.label ? `${it.label} · ${it.file.filename}` : it.file.filename))];
    const a = $("#f-clip-sel"), b = $("#f-other-sel"), ka = a.value, kb = b.value;
    a.replaceChildren(...opts("…or pick a clip from the bin")); b.replaceChildren(...opts("none"));
    if (ka) a.value = ka; if (kb) b.value = kb;
  }

  setClip(ref, url, label = "clip") {
    const {$, h} = this;
    this.F.clip = ref; this.F.clipUrl = url; this.F.seconds = 0;
    const m = document.createElement("video"); m.preload = "metadata"; m.muted = true;
    m.onloadedmetadata = () => { this.F.seconds = m.duration || 0; this.estimate?.(); }; m.src = url;
    $("#f-clip").replaceChildren(h("video", {src: url, muted: true, autoplay: true, loop: true, playsinline: true}), h("span", {}, label));
    $("#f-viewer").replaceChildren(h("video", {src: url, controls: true, autoplay: true, loop: true, muted: true, playsinline: true}));
    $("#f-render").disabled = false;
  }

  library() {
    const {$, h, G, assets} = this;
    const card = (fx) => {
      const vid = h("video", {src: `${assets}/fx/${fx.id}.webm`, muted: true, loop: true, playsinline: true, autoplay: true, preload: "auto"});
      vid.addEventListener("error", () => vid.replaceWith(h("div", {class: "ph"})));
      const ps = fx.presets || [];
      const tip = `${fx.blurb}<br><span class="tw">listens to</span> ${fx.on || fx.by}${(fx.needs || []).length ? ` · <span class="tw">needs</span> ${fx.needs.join(" and ")}` : ""}` +
        (ps.length > 1 ? `<br><span class="tw">presets</span> ${ps.map(p => p.name).join(" · ")}` : "");
      return h("div", {class: "fxcard", "data-id": fx.id, "data-tip": tip, onclick: () => this.addLayer(fx.id)}, vid,
        h("span", {class: "add"}, "+ add"), h("div", {class: "lbl"}, h("b", {}, fx.name), ps.length > 1 ? null : h("span", {}, fx.blurb),
          ps.length > 1 ? h("span", {class: "presets"}, ...ps.map((p, k) => h("button", {type: "button", class: "chip", "data-tip": p.tip || null,
            onclick: (e) => { e.stopPropagation(); this.addLayer(k ? `${fx.id}:${p.id}` : fx.id); }}, p.name))) : null));
    };
    $("#f-lib").replaceChildren(...G.FX_GROUPS.flatMap(g => [
      h("div", {class: "fxgroup", "data-tip": g.tip}, h("b", {}, g.name), h("span", {}, g.tip)),
      ...G.LIBRARY.filter(fx => fx.group === g.id).map(card)]));
  }

  addLayer(key) {
    const f = this.G.fxPreset(key);
    if (!f) return;
    this.F.layers.push({effect: f.id, key: f.key, name: f.name, on: f.on || "", by: f.by || "", needs: f.needs});
    this.drawLayers();
  }

  drawLayers() {
    const {$, h, G} = this;
    const dl = h("datalist", {id: "f-lanes"}, ...[...this.lanes].map(l => h("option", {value: l})));
    const rows = this.F.layers.map((l, k) => {
      const lane = h("input", {type: "text", list: "f-lanes", value: l.by || l.on, title: l.by ? "a held amount: a curve or a lane's envelope" : "the lane that fires it"});
      lane.addEventListener("input", () => { if (l.by) l.by = lane.value; else l.on = lane.value; });
      const f = G.fxPreset(l.key || l.effect), ps = f?.lib.presets || [];
      const pick = ps.length > 1 ? h("select", {class: "preset", tip: "The preset", onchange: (e) => {
        const g = G.fxPreset(e.target.value); l.key = g.key; l.name = g.name; l.needs = g.needs; this.drawLayers(); }},
        ...ps.map((p, j) => { const key = j ? `${f.id}:${p.id}` : f.id; return h("option", {value: key, selected: key === f.key}, p.name); })) : null;
      const missing = (l.needs || []).filter(n => (n === "other" && !this.F.other) || (n === "subject" && !$("#f-subject").value.trim()));
      return h("div", {class: "layer"},
        h("div", {}, h("b", {}, f?.lib.name || l.name), pick, missing.length ? h("div", {class: "hint", style: "margin:2px 0 0"}, `needs ${missing.join(" and ")}`) : null),
        lane, h("button", {class: "x", title: "remove", onclick: () => { this.F.layers.splice(k, 1); this.drawLayers(); }}, "×"));
    });
    $("#f-layers").replaceChildren(dl, ...rows);
    $("#f-layers-hint").style.display = this.F.layers.length ? "none" : "";
    [...$("#f-lib").querySelectorAll(".fxcard")].forEach(c => c.classList.toggle("on", this.F.layers.some(l => l.effect === c.dataset.id)));
  }

  async render() {
    const {$, h, G, run, api, VID, F} = this;
    if (!F.clip) return this.toast("Pick a clip first", true);
    if (!F.layers.length) return this.toast("Add at least one effect from the library", true);
    if (F.source === "song" && !F.audio) return this.toast("Drop the music first", true);
    const songSpec = F.source === "write" ? {style: $("#f-style").value.trim() || "instrumental, cinematic", lyrics: $("#f-lyrics").value.trim() || "[Instrumental]",
      seconds: Number($("#f-secs").value) || 20} : null;
    const sc = F.source === "score" ? this.getScore() : null;
    if (F.source === "score" && !sc) return this.toast("Make or open a score in the Score tab first: FX fires on its lanes", true);
    const g = G.fx({clip: F.clip, other: F.other, subject: $("#f-subject").value.trim(), source: F.source, audio: sc ? sc.audio : F.audio, songSpec,
      cueSheet: $("#f-cues").value, score: sc?.score || null,
      layers: F.layers.map(l => ({...G.fxLayer(l.key || l.effect, l.on), by: l.by})), beds: [...F.beds], sound: $("#f-sound").checked,
      seconds: F.seconds || 107 / 24, prefix: `valis/fx_${Date.now().toString(36)}`, loop: $("#f-loop").checked, retime: await api.hasNode("ValisFrameRate")});
    run(g, `FX · ${F.layers.map(l => l.name).join(" + ")}`, $("#f-viewer"), {onDone: (j) => {
      const v = j.outputs.find(f => VID.test(f.filename));
      if (v) $("#f-viewer").replaceChildren(h("video", {src: api.viewUrl(v), controls: true, autoplay: true, loop: true, playsinline: true}));
      if (v) $("#f-viewer").append(h("div", {class: "finishrow"}));
    }});
  }
}
