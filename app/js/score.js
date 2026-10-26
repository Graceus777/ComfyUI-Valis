// The Score tab. A score is every hit in a song, lane by lane (kick, snare, beat, bar, the notes of its sheet music, the
// cues you write), with sections and shots cut on whole bars. Make one here from any song (Valis hears it), from a song
// YuE2 writes, or from a cue sheet; open a saved .json; or start from the DANSE MACABRE example. Map lanes to effects,
// lay a clip on each shot, watch it live, render it with Valis and cut it on the bars.
import * as api from "./api.js";
import * as G from "./graphs.js";
import * as EST from "./estimate.js";
import {Bin} from "./bin.js";
import {LivePreview, FX_COLOR} from "./livefx.js";
import {h, $, $$, esc, toast, section, seg, dropzone, fillDrop, media} from "./ui.js";

// the DANSE engine (ValisFX): effects made for DANSE MACABRE's score, each listening to one of its events
export const CLASSIC = [
  {id: "candles", name: "Candles light"}, {id: "shockwave", name: "Shockwave"}, {id: "lightning", name: "Lightning arc"}, {id: "rim", name: "Rim pulse"},
  {id: "crowd", name: "Ghost crowd"}, {id: "ripple", name: "Floor ripple"}, {id: "ignite", name: "Reveal (ignite)"}, {id: "flare", name: "Flare"},
  {id: "vanish", name: "Vanish (burn away)"}, {id: "halo", name: "Halo"}, {id: "whiteout", name: "Whiteout"}, {id: "glint", name: "Glint"}, {id: "punch", name: "Camera punch"},
];
const DANSE_RULES = [["musicbox", "candles"], ["stroke", "shockwave"], ["violin", "lightning"], ["heartbeat", "rim"], ["pah", "crowd"], ["kick", "ignite"],
  ["stab", "flare"], ["response_right", "vanish"], ["impact", "halo"], ["final_hit", "whiteout"], ["glint", "glint"]].map(([lane, effect]) => ({lane, effect}));
// lanes in a sensible order (anything else after them)
const ORDER = ["bar", "downbeat", "beat", "kick", "snare", "hat", "onset", "melody", "lead", "bass", "chord", "note", "ins", "section", "syllable",
  "musicbox", "tick", "stroke", "violin", "heartbeat", "pah", "ghost_pah", "clap", "stab", "call_left", "response_right", "impact", "breath", "final_hit", "glint"];
const SEC_COL = {prologue: "#2b2238", midnight: "#1c2440", call: "#2b2440", waltz: "#1d3036", build: "#33301d", drop: "#3a2219", breakdown: "#1d2430",
  reveal: "#2a1a22", finale: "#3a1f1f", dawn: "#3a311d", intro: "#22283a", verse: "#1d2a33", chorus: "#2e2238", outro: "#26262c"};
// first rules for a score made here: whatever of these lanes it has
// light first: a score made here starts with effects that read as the scene's own light
const STARTER = [["beat", "Flicker"], ["downbeat", "Rays"], ["melody", "Glow"], ["bar", "Sweep"], ["kick", "Punch"]];
// a set of rules to start from, by mood: each names the lanes it would like; a score without one gets the nearest it has
const RULE_SETS = [
  {id: "candle", name: "Candlelit", tip: "Flames that breathe on the beat, a glow on the melody, a glint on the downbeats", rules: [["beat", "Flicker"], ["melody", "Glow:dream"], ["downbeat", "Glint"]]},
  {id: "storm", name: "Storm", tip: "Lightning on the downbeats, a bulb browning out on the kick, heat in the air", rules: [["downbeat", "Lightning"], ["kick", "Flicker:bulb"], ["bar", "Rays:moon"]]},
  {id: "fire", name: "Fire", tip: "Firelight on the beat, the air shimmering, a glint on the downbeats", rules: [["beat", "Firelight"], ["bar", "Haze"], ["downbeat", "Glint"]]},
  {id: "night", name: "Night drive", tip: "Headlights on the bars, neon glow on the beat, a kick on the kick", rules: [["bar", "Sweep"], ["beat", "Glow:neon"], ["kick", "Punch"]]},
  {id: "memory", name: "Memory", tip: "Projected film on the bars, a dreamy glow, moonlight on the downbeats", rules: [["bar", "Projector"], ["melody", "Glow:dream"], ["downbeat", "Rays:moon"]]},
  {id: "impact", name: "Impact", tip: "The loud set: a ripple on the downbeats, a kick, a glitch on the snare", rules: [["downbeat", "Shockwave"], ["kick", "Punch"], ["snare", "Glitch"]]},
];
const NEAREST = ["beat", "downbeat", "kick", "bar", "melody", "onset", "snare", "hat"];
const SOURCES = [
  {id: "song", name: "From a song", tip: "Drop any song: Valis hears its beats, bars, kick, snare and hats, how loud and bright it is, and lays out sections and shots on its bars."},
  {id: "yue", name: "YuE2 writes it", tip: "YuE2 writes the sheet music and plays it; the score has every note it wrote (melody, bass, chords) as well as the beats."},
  {id: "cues", name: "Cue sheet", tip: "No music: write the hits yourself, in seconds or bar:beat. The score is made from your cues."},
  {id: "open", name: "Open .json", tip: "A score saved from here (Save .json), or any Valis score, with its song."},
  {id: "demo", name: "Example", tip: "DANSE MACABRE: the score the first Valis film was cut to, with its own effects engine."},
];

export class ScoreView {
  constructor({run, onFilm}) {
    this.run = run; this.onFilm = onFilm;
    this.sc = null; this.audio = $("#s-audio"); this.audioRef = null; this.scoreRef = null; this.scoreFile = null;
    this.engine = "library"; this.rules = []; this.assign = {}; this.results = {}; this.thumbs = []; this.subject = "";
    this.canvas = $("#s-canvas"); this.t = 0; this.loaded = false; this.src = "song";
    this.live = new LivePreview($("#s-viewer"));
    this.live.onReady = () => { if (this.audio.paused) this.preview(true); };     // a clip or still finished loading: draw it
    this.build();
  }
  build() {
    seg($("#s-source"), SOURCES, (x) => this.setSource(x.id), "song");
    this.secRules = section("Effects on the music", {id: "s-sec-rules", open: true, tip: "Each rule: a lane of the score fires an effect. Library effects work on any score; the classic engine's are made for the example."},
      h("div", {class: "seg", id: "s-engine"}), h("div", {class: "chips rulesets", id: "s-sets"}), h("div", {class: "map", id: "s-map"}), h("button", {class: "btn small", id: "s-add", type: "button", style: "margin-top:8px"}, "+ Add a rule"),
      h("label", {class: "bkind", style: "display:block;margin-top:8px", tip: "Each effect plays a sound of its own on its hits, mixed under the music. Untick it to keep the song alone, as it is (a score you composed)"},
        h("input", {type: "checkbox", id: "s-fxsound", checked: true}), " the effects make sounds"),
      h("h3", {class: "lab", tip: "SAM 3 follows this in every shot: Echo, Lens, Vertigo, Double exposure and the classic reveals use it"}, "Subject"),
      h("div", {class: "row"}, h("input", {type: "text", id: "s-a", value: "the woman", tip: "subject A (the classic engine takes two)"}), h("input", {type: "text", id: "s-b", value: "the man", tip: "subject B"})));
    this.secShots = section("Shots", {id: "s-sec-shots", open: true, tip: "The score's shots, cut on whole bars. Give each a clip (drag one from the bin, or pick it), then render."},
      h("div", {class: "row", style: "margin-bottom:8px"}, h("button", {class: "btn small", type: "button", id: "s-fill", tip: "Lay the newest clips from the bin on the shots that have none, in order"}, "Fill from the bin")),
      h("div", {class: "map", id: "s-shots"}));
    $("#s-sections").replaceChildren(this.secRules, this.secShots);
    this.engineSeg = seg($("#s-engine"), [{id: "library", name: "Library", tip: "The Valis library (the FX tab's effects): any lane, any score"}, {id: "classic", name: "Classic", tip: "ValisFX, the engine the first Valis film (DANSE MACABRE) was made with: candles, ghost crowd, reveals. Made for the example's lanes"}],
      (x) => { this.engine = x.id; if (this.sc) { this.rules = this.defaultRules(); this.renderRules(); this.draw(); } }, "library");
    $("#s-sets").replaceChildren(h("span", {class: "lab"}, "Start from"), ...RULE_SETS.map(rs => h("button", {class: "chip", type: "button", tip: rs.tip, onclick: () => this.useSet(rs)}, rs.name)));
    $("#s-add").addEventListener("click", () => { this.rules.push({lane: this.lanes?.[0] || "kick", effect: this.engine === "classic" ? "flare" : "Rays"}); this.renderRules(); this.draw(); });
    $("#s-fill").addEventListener("click", () => this.fill());
    $("#s-play").addEventListener("click", () => this.toggle());
    $("#s-render").addEventListener("click", () => this.renderAll());
    $("#s-cut").addEventListener("click", () => this.cut());
    $("#s-save").addEventListener("click", () => this.save());
    $("#s-tofilm").addEventListener("click", () => this.sc && this.onFilm?.(this));
    $("#s-a").addEventListener("input", (e) => { this.subject = e.target.value; });
    this.canvas.addEventListener("click", (e) => {
      if (!this.sc) return;
      const r = this.canvas.getBoundingClientRect(), t = (e.clientX - r.left - this.L) / (r.width - this.L - 12) * this.sc.duration_seconds;
      if (t >= 0) { this.audio.currentTime = t; this.t = t; this.draw(); this.preview(); }
    });
    addEventListener("resize", () => this.draw());
    Bin.on(() => { if ($("#view-score").classList.contains("on")) this.renderShots(); });
  }
  ensure() { if (!this.loaded) { this.loaded = true; this.setSource(this.src); } else this.draw(); }

  // ---- where the score comes from
  setSource(id) {
    this.src = id;
    const box = $("#s-make"), {h: _} = {h};
    const btn = (label, sub, fn, tip) => h("button", {class: "btn", type: "button", style: "width:100%;margin-top:8px", tip, onclick: fn}, label, h("span", {class: "sub"}, sub));
    if (id === "demo") { box.replaceChildren(h("p", {class: "hint"}, "DANSE MACABRE's score: 3/4 waltz at 161.5 BPM, with its stills as stand-ins until you lay clips on the shots.")); this.loadDemo(); return; }
    if (id === "song") {
      const drop = h("div", {class: "drop", id: "s-song"}, "Drop a song (wav, flac, mp3, or a clip with sound)", h("br"), h("span", {class: "hint"}, "Valis hears its tempo, bars and hits"));
      const bpm = h("input", {type: "number", id: "s-bpm", min: 0, max: 300, step: .1, placeholder: "BPM (auto)", tip: "Your own tempo, if the analysis gets it wrong (0 = what it hears)"});
      const meter = h("select", {id: "s-meter", tip: "Beats per bar. Music analysis assumes 4/4: a waltz needs 3/4"}, ...[["0", "meter: auto (4/4)"], ["3", "3/4"], ["4", "4/4"], ["6", "6/8"], ["5", "5/4"], ["7", "7/8"]].map(([v, n]) => h("option", {value: v}, n)));
      box.replaceChildren(drop, h("div", {class: "row", style: "margin-top:8px"}, bpm, meter),
        btn("Make the score", "Valis · CPU", () => this.makeFromSong(), "Valis Cues hears the song; Valis Score (make) lays out the bars, sections and shots"));
      dropzone(drop, "audio/*,video/*", async (f) => {
        const u = await api.upload(f); this.pendingSong = {ref: api.inputRef(u), url: URL.createObjectURL(f), name: f.name};
        fillDrop(drop, h("audio", {src: this.pendingSong.url, controls: true, style: "width:100%"}), h("span", {}, f.name));
      });
      drop._onItem = (it) => { if (it.kind === "audio" || it.kind === "clip") { this.pendingSong = {ref: Bin.ref(it), url: Bin.url(it), name: it.file.filename}; fillDrop(drop, h("span", {}, it.file.filename)); } };
      return;
    }
    if (id === "yue") {
      box.replaceChildren(h("textarea", {id: "s-style", rows: 2, placeholder: "style: southern gothic, slow slide guitar, brushed drums, 84 BPM", tip: "Genre, instruments, mood and tempo, in a few words"}),
        h("textarea", {id: "s-lyrics", rows: 3, placeholder: "[Instrumental] or lyrics with [verse] [chorus]", style: "margin-top:6px", tip: "[Instrumental] for no singing"}, "[Instrumental]"),
        h("div", {class: "row", style: "margin-top:6px"}, h("label", {class: "hint", style: "margin:0;flex:0 0 auto"}, "seconds"), h("input", {type: "number", id: "s-secs", value: 30, min: 8, max: 120})),
        btn("Write it and make the score", "YuE2 · GPU", () => this.makeFromYue(), "YuE2 writes the sheet music, plays it, and the score is made from both"));
      EST.estimate(G.song({style: "x", lyrics: "x", seconds: 30}).graph).then(e => { const s = box.querySelector(".btn .sub"); if (s) s.textContent = `YuE2 · ${EST.fmt(e)}`; });
      return;
    }
    if (id === "cues") {
      box.replaceChildren(h("textarea", {id: "s-cues", rows: 8, class: "mono", spellcheck: "false", tip: "One cue per line: seconds or bar:beat, a lane name, an optional strength. 'every' makes grids, 'ramp' makes held curves, 'bpm 96 3/4' sets the grid."}, G.CUE_SHEET_EXAMPLE),
        btn("Make the score", "Valis · CPU", () => this.makeFromCues(), "Your cues become a score"));
      return;
    }
    if (id === "open") {
      const drop = h("div", {class: "drop", id: "s-drop"}, "Drop a Valis score (.json) and its song");
      box.replaceChildren(drop);
      const input = h("input", {type: "file", multiple: true, accept: ".json,audio/*", style: "display:none"});
      drop.append(input); drop.onclick = () => input.click(); input.onchange = () => this.loadFiles([...input.files]);
      drop.ondragover = (e) => { e.preventDefault(); drop.classList.add("over"); }; drop.ondragleave = () => drop.classList.remove("over");
      drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove("over"); this.loadFiles([...e.dataTransfer.files]); };
    }
  }
  async loadDemo() {
    try {
      const sc = await (await fetch(`/valis/app/assets/demo/danse_v3_score.json`)).json();
      this.audio.src = `/valis/app/assets/demo/danse_v3.mp3`; this.audioRef = null; this.audioUrl = this.audio.src;
      this.thumbs = sc.shots.map(s => `/valis/app/assets/demo/shots/${s.id}.jpg`);
      this.scoreRef = null; this.scoreFile = new File([JSON.stringify(sc)], "danse_v3_score.json", {type: "application/json"});
      this.engineSet("classic");
      this.set(sc);
    } catch (e) { toast("The example score is missing from the pack", true); }
  }
  engineSet(id) { this.engine = id; $$("#s-engine button").forEach(b => b.classList.toggle("on", b.dataset.id === id)); }
  async loadFiles(files) {
    const j = files.find(f => f.name.endsWith(".json")), a = files.find(f => f.type.startsWith("audio/"));
    if (a) { this.audio.src = this.audioUrl = URL.createObjectURL(a); const u = await api.upload(a); this.audioRef = api.inputRef(u); }
    if (j) { const sc = JSON.parse(await j.text()); this.thumbs = []; this.scoreRef = null; this.scoreFile = j; this.engineSet(sc.made_by ? "library" : "classic"); this.set(sc); }
  }
  // a made score comes back as a .json in output/valis/scores; its song is the file you gave, or YuE2's
  async made(j, audio) {
    const jf = j.outputs.find(o => /\.json$/i.test(o.filename));
    if (!jf) return toast("The score job saved no .json", true);
    const sc = JSON.parse(await (await fetch(api.viewUrl(jf))).text());
    this.scoreFile = new File([JSON.stringify(sc)], jf.filename, {type: "application/json"}); this.scoreRef = null; this.thumbs = [];
    if (audio) { this.audio.src = this.audioUrl = audio.url; this.audioRef = audio.ref; }
    Bin.add(jf, {from: "Score", label: sc.title || "score"});
    this.engineSet("library"); this.results = {}; this.set(sc);
    toast(`Score made: ${sc.bars} bars at ${sc.bpm} BPM, ${sc.shots.length} shots`);
  }
  makeFromSong() {
    const s = this.pendingSong; if (!s) return toast("Drop a song first", true);
    const bpm = Number($("#s-bpm").value) || 0, meter = Number($("#s-meter").value) || 0, title = s.name.replace(/\.\w+$/, "");
    this.run(G.scoreMake({audio: s.ref, title, bpm, meter, prefix: `valis/scores/${title.replace(/\W+/g, "_").slice(0, 40)}`}), "Score · hear the song", $("#s-viewer"),
      {onDone: (j) => this.made(j, s)});
  }
  makeFromYue() {
    const style = $("#s-style").value.trim() || "cinematic, instrumental, 96 BPM", lyrics = $("#s-lyrics").value.trim() || "[Instrumental]", seconds = Number($("#s-secs").value) || 30;
    const title = style.split(",")[0].slice(0, 30);
    this.run(G.songScore({style, lyrics, seconds, title, prefix: `valis/scores/yue_${Date.now().toString(36)}`}), "Score · YuE2 writes a song", $("#s-viewer"), {onDone: (j) => {
      const a = j.outputs.find(o => /\.(flac|wav|mp3)$/i.test(o.filename));
      this.made(j, a ? {ref: api.fileRef(a), url: api.viewUrl(a)} : null);
    }});
  }
  makeFromCues() {
    this.run(G.scoreMake({cueSheet: $("#s-cues").value, title: "cue sheet", prefix: `valis/scores/cues_${Date.now().toString(36)}`}), "Score · cue sheet", $("#s-viewer"), {onDone: (j) => {
      this.audio.removeAttribute("src"); this.audioRef = null; this.made(j, null);
    }});
  }
  save() {
    if (!this.sc) return;
    const a = h("a", {href: URL.createObjectURL(new Blob([JSON.stringify({...this.sc, valis_rules: this.rules, valis_engine: this.engine}, null, 1)], {type: "application/json"})),
                      download: `${(this.sc.title || "score").replace(/\W+/g, "_")}.valis.json`});
    a.click();
  }

  // a rule set on this score: each lane it names, or the nearest lane the score has
  useSet(rs) {
    if (!this.sc) return toast("Make or open a score first", true);
    if (this.engine === "classic") { this.engine = "library"; this.engineSeg?.set("library", true); }       // the sets are library effects
    const has = (l) => this.sc.events[l]?.length, used = new Set();
    this.rules = rs.rules.map(([lane, effect]) => {
      const l = has(lane) && !used.has(lane) ? lane : NEAREST.find(x => has(x) && !used.has(x)) || this.lanes[0];
      used.add(l); return {lane: l, effect};
    });
    this.renderRules(); this.draw();
  }
  // ---- the score
  defaultRules() {
    if (this.engine === "classic") return DANSE_RULES.filter(r => this.sc.events[r.lane]?.length);
    return STARTER.filter(([lane]) => this.sc.events[lane]?.length).slice(0, 3).map(([lane, effect]) => ({lane, effect}));
  }
  set(sc) {
    this.sc = sc; this.t = 0; this.assign = {}; this.cur = null;
    if (!sc.duration_seconds) sc.duration_seconds = sc.duration || Math.max(...Object.values(sc.events).flat(), 1) + 1;
    this.lanes = Object.keys(sc.events).filter(k => Array.isArray(sc.events[k]) && sc.events[k].length && typeof sc.events[k][0] === "number")
      .sort((a, b) => (ORDER.indexOf(a) + 1 || 99) - (ORDER.indexOf(b) + 1 || 99));
    this.rules = sc.valis_rules || this.defaultRules();
    const nEv = this.lanes.reduce((a, k) => a + sc.events[k].length, 0);
    $("#s-info").innerHTML = `<b>${esc(sc.title || "score")}</b> · ${esc(sc.meter || "")} at ${(+sc.bpm).toFixed(1)} BPM · ${sc.bars} bars · ${sc.duration_seconds.toFixed(1)} s<br>${this.lanes.length} lanes, ${nEv} hits, ${(sc.shots || []).length} shots`;
    $("#s-tempo").textContent = `${sc.meter || ""} · ${(+sc.bpm).toFixed(1)} BPM${sc.key ? " · " + sc.key : ""}`;
    this.renderRules(); this.renderShots(); this.live.mount(); this.draw(); this.preview(); this.estimates();
  }
  renderRules() {
    const classic = this.engine === "classic";
    const blurb = (id) => classic ? "" : (G.FX_CHOICES.find(c => c.key === id)?.blurb || "");
    this.secRules.setValue(`${this.rules.length} rule${this.rules.length === 1 ? "" : "s"}${this.engine === "classic" ? " · classic engine" : ""}`);
    $("#s-map").replaceChildren(...this.rules.map((r, k) => {
      const lane = h("select", {onchange: (e) => { r.lane = e.target.value; this.draw(); }, tip: "The lane that fires it"},
        ...this.lanes.map(x => h("option", {value: x, selected: x === r.lane}, `${x.replaceAll("_", " ")} (${this.sc.events[x].length})`)));
      const fx = h("select", {onchange: (e) => { r.effect = e.target.value; this.renderRules(); this.draw(); }, tip: esc(blurb(r.effect))},
        ...(classic ? CLASSIC.map(x => h("option", {value: x.id, selected: x.id === r.effect}, x.name))
          : G.FX_GROUPS.map(g => h("optgroup", {label: g.name}, ...G.FX_CHOICES.filter(c => c.group === g.id).map(c => h("option", {value: c.key, selected: c.key === r.effect}, c.name))))));
      return h("div", {class: "maprow rule"}, h("i", {class: "swatch", style: `background:${FX_COLOR[r.effect.split(":")[0]] || "#777"}`}), lane, h("span", {class: "arrow"}, "→"), fx,
        h("button", {class: "x", type: "button", tip: "Remove", onclick: () => { this.rules.splice(k, 1); this.renderRules(); this.draw(); }}, "×"));
    }));
  }
  clipsInBin() { return Bin.list("clip").slice(0, 60); }
  renderShots() {
    const sc = this.sc; if (!sc?.shots) return;
    const clips = this.clipsInBin(), done = Object.keys(this.results).length, have = sc.shots.filter(s => this.assign[s.id]?.clip).length;
    this.secShots.setValue(`${sc.shots.length} shots · ${have} with clips · ${done} rendered`);
    $("#s-shots").replaceChildren(...sc.shots.map((shot, k) => {
      const sec = this.sectionAt(shot.start_frame / 24), a = this.assign[shot.id] || (this.assign[shot.id] = {clip: null});
      const sel = h("select", {tip: "A clip from the bin", onchange: (e) => { const it = clips.find(c => c.id === e.target.value); a.clip = it ? {ref: Bin.ref(it), url: Bin.url(it), label: it.label || it.file.filename} : null; delete this.results[shot.id]; this.renderShots(); this.preview(true); }},
        h("option", {value: ""}, a.clip ? a.clip.label : "— no clip —"), ...clips.map(c => h("option", {value: c.id}, `${c.label || c.file.filename}`)));
      const res = this.results[shot.id];
      const row = h("div", {class: "shotrow" + (res ? " done" : "") + (this.cur === k ? " cur" : ""), "data-shot": shot.id},
        h("div", {class: "nm", onclick: () => this.seek(shot.start_frame / 24 + .01)}, `${shot.id}${shot.name ? " " + shot.name : ""}`,
          h("span", {}, `bars ${shot.start_bar + 1}–${shot.start_bar + Math.round(shot.frames / 24 / sc.bar_seconds)} · ${sec?.name || ""} · ${(shot.frames / 24).toFixed(1)} s`)),
        h("button", {class: "btn go", type: "button", disabled: !a.clip, onclick: () => this.renderShot(shot)}, res ? "again" : "Render"), sel);
      row.addEventListener("dragover", (e) => { e.preventDefault(); row.classList.add("over"); });
      row.addEventListener("dragleave", () => row.classList.remove("over"));
      row.addEventListener("drop", (e) => { e.preventDefault(); row.classList.remove("over"); const raw = e.dataTransfer.getData("application/x-valis-item"); if (!raw) return;
        const it = JSON.parse(raw); if (it.kind !== "clip") return; a.clip = {ref: Bin.ref(it), url: Bin.url(it), label: it.label || it.file.filename}; delete this.results[shot.id]; this.renderShots(); this.preview(true); });
      return row;
    }));
  }
  fill() {
    const clips = this.clipsInBin(); let i = 0;
    for (const s of this.sc?.shots || []) { const a = this.assign[s.id] || (this.assign[s.id] = {}); if (!a.clip && clips[i]) { const it = clips[i++]; a.clip = {ref: Bin.ref(it), url: Bin.url(it), label: it.label || it.file.filename}; } }
    this.renderShots(); this.preview(true);
    toast(i ? `${i} shot${i > 1 ? "s" : ""} got a clip from the bin` : "No clips in the bin yet", !i);
  }
  sectionAt(t) { return (this.sc.sections || []).find(s => t >= s.start - 1e-6 && t < s.end); }
  // for the FX tab's "Score" lanes: the score (uploaded to input/) and its song
  async forFx() { if (!this.sc) return null; return {score: await this.ensureScore(), audio: this.audioRef, title: this.sc.title}; }
  async ensureScore() {
    if (this.scoreRef) return this.scoreRef;
    const u = await api.upload(this.scoreFile);
    return (this.scoreRef = api.inputRef(u));
  }
  async estimates() {
    const e = await EST.estimate(G.fx({clip: "x", layers: [{effect: "Punch", on: "kick"}]}));
    const n = (this.sc?.shots || []).filter(s => this.assign[s.id]?.clip).length;
    $("#s-render-sub").textContent = n ? `${n} shots with a clip · ${EST.fmt({...e, seconds: e.seconds * n})}` : "shots that have a clip";
  }
  // a shot plays until the next one starts (the bars' own grid: 106 or 107 frames), so the cut never repeats a frame of the song
  span(shot) { const all = this.sc.shots, next = all[all.indexOf(shot) + 1]; return (next ? next.start_frame - shot.start_frame : shot.frames) / 24; }
  async renderShot(shot) {
    const a = this.assign[shot.id] || {};
    if (!a.clip) return toast(`Give ${shot.id} a clip first`, true);
    const score = await this.ensureScore(), sec = this.sectionAt(shot.start_frame / 24), tag = Date.now().toString(36);
    const g = this.engine === "classic"
      ? G.valisShot({clip: a.clip.ref, score, startBar: shot.start_bar, section: sec?.name || "", layer: null, rules: this.rules.map(r => ({event: r.lane, effect: r.effect})),
          targetA: $("#s-a").value.trim(), targetB: $("#s-b").value.trim(), prefix: `valis/score_${shot.id}_${tag}`})
      : G.fx({clip: a.clip.ref, subject: this.rules.some(r => { const f = G.fxPreset(r.effect); return f && (f.needs.includes("subject") || f.params.at === "subject"); }) ? $("#s-a").value.trim() : "",
          source: "score", score, audio: this.audioRef, layers: this.rules.map(r => G.fxLayer(r.effect, r.lane)).filter(Boolean),
          sound: $("#s-fxsound").checked, seconds: this.span(shot), start: shot.start_frame / 24, fit: true, prefix: `valis/score_${shot.id}_${tag}`});
    return new Promise((res) => this.run(g, `Score · ${shot.id}`, null, {onDone: (j) => {
      const v = j.outputs.find(f => /\.(mp4|webm|mov)$/i.test(f.filename));
      if (v) { this.results[shot.id] = v; Bin.add(v, {from: "Score", label: `${this.sc.title || "score"} ${shot.id}`}); }
      this.renderShots(); this.preview(true); res(v);
    }}));
  }
  async renderAll() {
    const todo = (this.sc?.shots || []).filter(s => this.assign[s.id]?.clip && !this.results[s.id]);
    if (!todo.length) return toast((this.sc?.shots || []).some(s => this.assign[s.id]?.clip) ? "Every shot with a clip is rendered" : "Give at least one shot a clip (Shots, or Fill from the bin)", true);
    for (const s of todo) this.renderShot(s);
  }
  async cut() {
    const sc = this.sc; if (!sc) return;
    const shots = sc.shots.filter(s => this.results[s.id]);
    if (!shots.length) return toast("Render some shots first", true);
    if (shots.length < sc.shots.length) toast(`Cutting the ${shots.length} rendered shots of ${sc.shots.length}`);
    // the song goes on past the last shot: an end card plays over the rest of it (up to 8 s), so the cut ends with the song
    const last = shots[shots.length - 1], end = last.start_frame / 24 + this.span(last), rest = sc.duration_seconds - end, text = $("#s-title").value.trim();
    let title = null;
    if (text && this.audioRef && rest > 1) {
      const v = await new Promise((res) => { const e = document.createElement("video"); e.preload = "metadata"; e.onloadedmetadata = () => res(e); e.onerror = () => res(null); e.src = api.viewUrl(this.results[last.id]); });
      if (v?.videoWidth) title = {text, song: this.audioRef, start: end, seconds: Math.min(8, rest), width: v.videoWidth, height: v.videoHeight};
    }
    // no effect sounds and no gaps between the shots: the song runs unbroken under the whole cut
    const all = sc.shots, gapless = shots.every((s, k) => !k || all.indexOf(s) === all.indexOf(shots[k - 1]) + 1);
    const song = !$("#s-fxsound").checked && this.audioRef && gapless
      ? {audio: this.audioRef, start: shots[0].start_frame / 24, seconds: shots.reduce((t, s) => t + this.span(s), 0) + (title ? title.seconds : 0)} : null;
    this.run(G.filmCut({shots: shots.map(s => ({file: api.fileRef(this.results[s.id]), seconds: this.span(s)})), title, song, prefix: `valis/score_cut_${Date.now().toString(36)}`}),
      "Score · cut", $("#s-viewer"), {onDone: (j) => {
        const v = j.outputs.find(f => /\.(mp4|webm|mov)$/i.test(f.filename));
        if (!v) return;
        Bin.add(v, {from: "Score", label: `${sc.title || "score"} · cut`});
        this.stopped = true; this.audio.pause();
        $("#s-viewer").replaceChildren(media(v)); toast("Cut on the bars: it's in the bin too");
      }});
  }

  // ---- the timeline and the live preview
  colorFor(lane) { const r = this.rules.find(r => r.lane === lane); return r ? FX_COLOR[r.effect.split(":")[0]] || "#bbb" : null; }
  draw() {
    const c = this.canvas, sc = this.sc; if (!sc) return;
    const dpr = devicePixelRatio || 1, W = c.clientWidth, laneH = 17, top = 70;
    const H = top + this.lanes.length * laneH + 34;
    c.style.height = `${H}px`; c.width = W * dpr; c.height = H * dpr;
    const x = c.getContext("2d"); x.setTransform(dpr, 0, 0, dpr, 0, 0);
    const L = this.L = 112, R = 12, D = sc.duration_seconds, X = (t) => L + (W - L - R) * t / D;
    x.fillStyle = "#0c0c11"; x.fillRect(0, 0, W, H);
    for (const s of sc.sections || []) { x.fillStyle = SEC_COL[s.name] || "#1a1a22"; x.globalAlpha = .55; x.fillRect(X(s.start), 0, X(s.end) - X(s.start), H); x.globalAlpha = 1;
      x.fillStyle = "#c9c9d6"; x.font = "600 10px Inter, sans-serif"; x.fillText(String(s.name).toUpperCase(), X(s.start) + 5, 13); }
    const env = sc.envelopes?.mix || sc.envelopes?.loud || [];
    if (env.length) { x.beginPath(); const mid = 44, mx = Math.max(...env.slice(0, 5000), 1e-6);
      env.forEach((v, i) => { const xx = X(i / 24); x.moveTo(xx, mid - v / mx * 22); x.lineTo(xx, mid + v / mx * 22); });
      x.strokeStyle = "rgba(220,226,255,.35)"; x.lineWidth = 1; x.stroke(); }
    x.strokeStyle = "rgba(255,255,255,.07)"; x.lineWidth = 1;
    (sc.events.bar || []).forEach((t, i) => { if (i % 4 === 0) { x.beginPath(); x.moveTo(X(t), 20); x.lineTo(X(t), H - 20); x.stroke(); } });
    this.lanes.forEach((lane, k) => {
      const y = top + k * laneH, col = this.colorFor(lane);
      x.fillStyle = col ? "#e8e8f0" : "#6b6b78"; x.font = "11px Inter, sans-serif"; x.fillText(lane.replaceAll("_", " "), 10, y + 12);
      if (col) { x.fillStyle = col; x.fillRect(L - 14, y + 4, 8, 8); }
      x.fillStyle = col || "#4a4a56";
      for (const t of sc.events[lane]) { const xx = X(t); x.globalAlpha = col ? .95 : .55; x.fillRect(xx - 1, y + 3, col ? 3 : 2, laneH - 6); }
      x.globalAlpha = 1;
    });
    x.font = "10px Inter, sans-serif";
    (sc.shots || []).forEach((s) => { const t0 = s.start_frame / 24, t1 = t0 + s.frames / 24, has = this.results[s.id] ? "#6fe3a1" : this.assign[s.id]?.clip ? "#9cc2ff" : "rgba(255,255,255,.12)";
      x.fillStyle = "#8d8d9b"; x.fillText(s.name || s.id, X(t0) + 3, H - 8); x.fillStyle = has; x.fillRect(X(t0) + 1, H - 22, X(t1) - X(t0) - 2, 3); });
    const px = X(this.t); x.fillStyle = "#ff8a4c"; x.fillRect(px - 1, 0, 2, H);
    this.lanes.forEach((lane, k) => { const col = this.colorFor(lane); if (!col) return;
      for (const t of sc.events[lane]) { const a = this.t - t; if (a >= 0 && a < .35) { x.globalAlpha = 1 - a / .35; x.fillStyle = col; x.beginPath(); x.arc(X(t), top + k * laneH + 8.5, 7, 0, 7); x.fill(); x.globalAlpha = 1; } } });
  }
  seek(t) { this.audio.currentTime = t; this.t = t; this.draw(); this.preview(); }
  preview(force = false) {
    const sc = this.sc; if (!sc) return;
    if (this.stopped && !force) return;
    this.stopped = false;
    if (!$("#s-viewer canvas.livefx")) this.live.mount();
    const idx = (sc.shots || []).findIndex(s => this.t >= s.start_frame / 24 && this.t < (s.start_frame + s.frames) / 24);
    const k = idx < 0 ? (sc.shots || []).length - 1 : idx, shot = sc.shots?.[k];
    const sec = this.sectionAt(this.t);
    $("#s-section").textContent = `${sec ? sec.name : "tail"} · bar ${Math.floor(this.t / sc.bar_seconds) + 1}${shot ? ` · ${shot.id}` : ""}`;
    $("#s-time").textContent = `${Math.floor(this.t / 60)}:${(this.t % 60).toFixed(1).padStart(4, "0")}`;
    if (k !== this.cur) { this.cur = k; $$("#s-shots .shotrow").forEach((r, i) => r.classList.toggle("cur", i === k)); }
    const res = shot && this.results[shot.id], clip = shot && this.assign[shot.id]?.clip;
    // the rendered shot plays as it is; otherwise its clip (or the example's still) with the effects sketched live
    if (res) this.live.source(api.viewUrl(res), "video");
    else if (clip) this.live.source(clip.url, "video");
    else if (this.thumbs[k]) this.live.source(this.thumbs[k], "image");
    else this.live.source(null);
    const local = shot ? this.t - shot.start_frame / 24 : 0;
    this.live.draw({t: this.t, local, lanes: sc.events, rules: res ? [] : this.rules, playing: !this.audio.paused,
      note: res ? `${shot.id} · rendered` : clip ? `${shot.id} · live preview: effects sketched, Render for the real thing` : this.thumbs[k] ? `${shot.id} · the example's still, effects sketched` : `${shot?.id || ""} · no clip on this shot: drag one from the bin`});
  }
  toggle() {
    if (!this.sc) return;
    if (!this.audio.src) return toast("This score has no song (a cue sheet): drop one under Open .json to hear it", true);
    if (this.audio.paused) { this.audio.play(); $("#s-play").textContent = "❚❚ Pause"; this.loop(); }
    else { this.audio.pause(); $("#s-play").textContent = "▶ Play"; this.preview(true); }
  }
  loop() {
    if (this.audio.paused) return;
    this.t = this.audio.currentTime; this.draw(); this.preview();
    requestAnimationFrame(() => this.loop());
  }
}
