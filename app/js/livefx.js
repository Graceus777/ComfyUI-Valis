// The Score tab's live preview: the shot's own clip (or still) drawn on a canvas in step with the song, with every
// mapped effect firing on its lane as you watch. Each effect here is a quick sketch of the real one (a flash and a kick
// for Punch, a ring for Shockwave, slipping slices for Glitch...), cheap enough to run live; Render makes the real thing
// with the Valis library.
export const FX_COLOR = {Punch: "#ffd27f", Shockwave: "#9cc2ff", Glitch: "#ff6bd6", Frost: "#cfefff", Rays: "#fff1c9", Echo: "#b8d8ff", Datamosh: "#ff8a4c",
  Projector: "#e8dcc0", Shatter: "#d6e2ff", Lens: "#c9b6ff", Vertigo: "#8fe0d0", SlitScan: "#7fd3ff", DoubleExposure: "#ffb35c", TimeSlip: "#e6c08a",
  Tear: "#ff6b6b", Split: "#9aa0ff", Eras: "#d8b4a0",
  // the DANSE engine's (Valis classic)
  candles: "#ffb35c", shockwave: "#9cc2ff", lightning: "#c9b6ff", rim: "#7fd3ff", crowd: "#b8d8ff", ripple: "#8fe0d0", ignite: "#ff8a4c",
  flare: "#ffd27f", vanish: "#ff6b6b", halo: "#e6f0ff", whiteout: "#ffffff", glint: "#fff1c9", punch: "#9a9aa8"};
// what each classic effect looks like in the sketch
const CLASSIC_AS = {candles: "Rays", shockwave: "Shockwave", lightning: "Projector", rim: "Rays", crowd: "Echo", ripple: "Shockwave", ignite: "Punch",
  flare: "Rays", vanish: "Datamosh", halo: "Rays", whiteout: "Punch", glint: "Rays", punch: "Punch"};

// hits on a lane, as a struck envelope: how much it is ringing at t, and the last hit before t
function ring(times, t, tau = .28) {
  let e = 0, last = -1e9;
  for (let i = times.length - 1; i >= 0; i--) {
    const d = t - times[i];
    if (d < 0) continue;
    if (d > tau * 6) break;
    e += Math.exp(-d / tau); if (last < -1e8) last = times[i];
  }
  if (last < -1e8) { for (let i = times.length - 1; i >= 0; i--) if (times[i] <= t) { last = times[i]; break; } }
  return {e: Math.min(1.5, e), last};
}
const rand = (s) => { const x = Math.sin(s * 12.9898) * 43758.5453; return x - Math.floor(x); };

export class LivePreview {
  constructor(el) {
    this.el = el; this.cv = document.createElement("canvas"); this.cv.className = "livefx";
    this.x = this.cv.getContext("2d"); this.src = null; this.srcUrl = null; this.history = []; this.label = document.createElement("span");
    this.label.className = "lfx-label"; this.badges = document.createElement("div"); this.badges.className = "lfx-badges";
  }
  mount() { this.el.replaceChildren(this.cv, this.label, this.badges); }
  // url: a clip or a still for the current shot; t0: where the shot starts in the song
  source(url, kind = "video") {
    if (url === this.srcUrl) return;
    this.srcUrl = url; this.history = [];
    if (!url) { this.src = null; return; }
    if (kind === "video") {
      const v = document.createElement("video"); v.src = url; v.muted = true; v.playsInline = true; v.preload = "auto"; v.loop = true;
      v.addEventListener("loadeddata", () => this.onReady?.(), {once: true});
      this.src = v;
    } else { const i = new Image(); i.onload = () => this.onReady?.(); i.src = url; this.src = i; }
  }
  // t: song time; local: time inside the shot; lanes: {lane: [times]}; rules: [{lane, effect}]; playing: is the song playing
  draw({t, local, lanes, rules, playing, note = ""}) {
    const cv = this.cv, x = this.x, el = this.el;
    const W = Math.max(200, Math.round(el.clientWidth - 2)), H = Math.max(200, Math.round((el.clientHeight || 520) - 2));
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
    const s = this.src;
    // keep the clip on the song's clock
    if (s && s.tagName === "VIDEO") {
      if (s.readyState >= 2 && !s.seeking && Math.abs(s.currentTime - local) > .3) s.currentTime = Math.max(0, Math.min(local, (s.duration || 1) - .05));
      if (playing && s.paused) s.play().catch(() => {}); if (!playing && !s.paused) s.pause();
    }
    const sw = s?.videoWidth || s?.naturalWidth || 9, sh = s?.videoHeight || s?.naturalHeight || 16;
    const sc = Math.min(W / sw, H / sh), dw = sw * sc, dh = sh * sc, ox = (W - dw) / 2, oy = (H - dh) / 2, cx = ox + dw / 2, cy = oy + dh / 2;
    const active = rules.map(r => ({...r, as: CLASSIC_AS[r.effect] || r.effect, ...ring(lanes[r.lane] || [], t)}));
    const get = (name) => active.filter(a => a.as === name).reduce((m, a) => a.e > m.e ? a : m, {e: 0, last: -1e9});
    const punch = get("Punch"), dm = get("Datamosh"), echo = get("Echo"), proj = get("Projector"), vert = get("Vertigo");
    // the frame: a dragged smear for Datamosh, else a fresh draw (zoom kick for Punch, a weave for Projector, a breath for Vertigo)
    if (dm.e < .05) { x.fillStyle = "#07070a"; x.fillRect(0, 0, W, H); }
    x.save();
    const z = 1 + .07 * punch.e + .05 * vert.e * Math.sin(t * 3);
    const jx = proj.e > .05 ? (rand(Math.floor(t * 24)) - .5) * 6 * proj.e : 0, jy = proj.e > .05 ? (rand(Math.floor(t * 24) + 7) - .5) * 6 * proj.e : 0;
    x.translate(cx + jx, cy + jy); x.scale(z, z); x.translate(-cx, -cy);
    x.globalAlpha = dm.e > .05 ? Math.max(.15, 1 - .7 * Math.min(1, dm.e)) : 1;
    if (s && (s.readyState >= 2 || s.complete)) x.drawImage(s, ox + (dm.e > .05 ? 4 * dm.e : 0), oy, dw, dh);
    else { const g = x.createLinearGradient(ox, oy, ox + dw, oy + dh); g.addColorStop(0, "#1a1d2a"); g.addColorStop(1, "#0b0b10"); x.fillStyle = g; x.fillRect(ox, oy, dw, dh); }
    x.globalAlpha = 1;
    // Echo: the last frames, fading
    if (echo.e > .05 && this.history.length) this.history.forEach((f, i) => { x.globalAlpha = .18 * echo.e * (i + 1) / this.history.length; x.drawImage(f, ox - 6 * (this.history.length - i), oy, dw, dh); });
    x.globalAlpha = 1;
    x.restore();
    if (s && playing && Math.floor(t * 12) !== this._ht) {            // a short history for Echo
      this._ht = Math.floor(t * 12);
      const c = document.createElement("canvas"); c.width = 160; c.height = Math.round(160 * dh / dw);
      try { c.getContext("2d").drawImage(s, 0, 0, c.width, c.height); this.history.push(c); if (this.history.length > 4) this.history.shift(); } catch { /* not ready */ }
    }
    x.save(); x.beginPath(); x.rect(ox, oy, dw, dh); x.clip();
    // Punch: a flash and a colour split
    if (punch.e > .03) {
      x.globalCompositeOperation = "screen"; x.fillStyle = `rgba(255,240,220,${.32 * Math.min(1, punch.e)})`; x.fillRect(ox, oy, dw, dh);
      x.globalCompositeOperation = "source-over";
    }
    // Glitch: slices slipping sideways, and a channel split
    const gl = get("Glitch");
    if (gl.e > .08) {
      const n = 7, seed = Math.floor(gl.last * 100);
      for (let i = 0; i < n; i++) {
        const y = oy + rand(seed + i) * dh, hh = 6 + rand(seed + i + 50) * dh * .06, dx = (rand(seed + i + 90) - .5) * 60 * gl.e;
        try { x.drawImage(this.cv, 0, y, W, hh, dx, y, W, hh); } catch { /* */ }
      }
      x.globalCompositeOperation = "lighter"; x.fillStyle = `rgba(255,0,90,${.08 * gl.e})`; x.fillRect(ox + 5 * gl.e, oy, dw, dh); x.globalCompositeOperation = "source-over";
    }
    // Shockwave (and the classic ripple): a ring racing out from the middle
    for (const a of active.filter(a => a.as === "Shockwave" && a.last > -1e8)) {
      const age = t - a.last; if (age < 0 || age > .9) continue;
      const r = age * Math.max(dw, dh) * 1.3;
      x.strokeStyle = `rgba(200,225,255,${.65 * (1 - age / .9)})`; x.lineWidth = 10 * (1 - age / .9) + 1;
      x.beginPath(); x.arc(cx, cy, r, 0, Math.PI * 2); x.stroke();
      x.strokeStyle = `rgba(255,120,80,${.3 * (1 - age / .9)})`; x.lineWidth = 3; x.beginPath(); x.arc(cx, cy, r * .96, 0, Math.PI * 2); x.stroke();
    }
    // Rays (and the classic glows): light streaming from the top
    const ra = get("Rays");
    if (ra.e > .03) {
      x.globalCompositeOperation = "screen";
      const g = x.createRadialGradient(cx, oy + dh * .2, 0, cx, oy + dh * .2, dh * .8);
      g.addColorStop(0, `rgba(255,236,200,${.55 * Math.min(1, ra.e)})`); g.addColorStop(1, "rgba(255,236,200,0)");
      x.fillStyle = g; x.fillRect(ox, oy, dw, dh);
      for (let i = 0; i < 9; i++) { const a0 = -Math.PI / 2 + (i - 4) * .18; x.strokeStyle = `rgba(255,240,210,${.08 * ra.e})`; x.lineWidth = 18; x.beginPath(); x.moveTo(cx, oy + dh * .2); x.lineTo(cx + Math.cos(a0) * -dh, oy + dh * .2 + Math.sin(a0) * -dh); x.stroke(); }
      x.globalCompositeOperation = "source-over";
    }
    // Frost: white crystals creeping in from the edges after each hit
    const fr = get("Frost");
    if (fr.e > .03) {
      const g = x.createRadialGradient(cx, cy, Math.min(dw, dh) * .25, cx, cy, Math.max(dw, dh) * .7);
      g.addColorStop(0, "rgba(220,240,255,0)"); g.addColorStop(1, `rgba(230,245,255,${.7 * Math.min(1, fr.e)})`);
      x.fillStyle = g; x.fillRect(ox, oy, dw, dh);
    }
    // Projector: flicker and scratches
    if (proj.e > .03) {
      x.fillStyle = `rgba(0,0,0,${.18 * proj.e * rand(Math.floor(t * 24))})`; x.fillRect(ox, oy, dw, dh);
      x.strokeStyle = `rgba(240,235,220,${.35 * proj.e})`; x.lineWidth = 1;
      for (let i = 0; i < 3; i++) { const sx = ox + rand(Math.floor(t * 24) + i * 31) * dw; x.beginPath(); x.moveTo(sx, oy); x.lineTo(sx + 3, oy + dh); x.stroke(); }
    }
    // Shatter: cracks from a point
    const shat = get("Shatter");
    if (shat.e > .05) {
      x.strokeStyle = `rgba(230,240,255,${.6 * Math.min(1, shat.e)})`; x.lineWidth = 1.5; const seed = Math.floor(shat.last * 10);
      for (let i = 0; i < 12; i++) { let px = cx, py = cy; x.beginPath(); x.moveTo(px, py); const a0 = rand(seed + i) * Math.PI * 2;
        for (let k = 0; k < 5; k++) { px += Math.cos(a0 + (rand(seed + i * 9 + k) - .5)) * dw * .12; py += Math.sin(a0 + (rand(seed + i * 7 + k) - .5)) * dw * .12; x.lineTo(px, py); } x.stroke(); }
    }
    // Lens: a dark core and a bright ring at the middle
    const ln = get("Lens");
    if (ln.e > .05) { const r = Math.min(dw, dh) * .12 * (1 + .3 * ln.e); x.fillStyle = `rgba(0,0,0,${.6 * Math.min(1, ln.e)})`; x.beginPath(); x.arc(cx, cy, r, 0, 7); x.fill();
      x.strokeStyle = `rgba(255,250,235,${.6 * Math.min(1, ln.e)})`; x.lineWidth = 3; x.beginPath(); x.arc(cx, cy, r * 1.25, 0, 7); x.stroke(); }
    // the rest (another clip, slit-scan, tear...): a coloured wash on the hit, so you can still see when they fire
    for (const a of active.filter(a => ["SlitScan", "DoubleExposure", "TimeSlip", "Tear", "Split", "Eras"].includes(a.as) && a.e > .05)) {
      x.globalCompositeOperation = "soft-light"; x.fillStyle = FX_COLOR[a.as]; x.globalAlpha = .4 * Math.min(1, a.e); x.fillRect(ox, oy, dw, dh); x.globalAlpha = 1; x.globalCompositeOperation = "source-over";
    }
    x.restore();
    this.label.textContent = note;
    // which lanes are firing right now
    const firing = active.filter(a => a.e > .25);
    const key = firing.map(a => a.lane + a.effect).join();
    if (key !== this._bk) {
      this._bk = key;
      this.badges.replaceChildren(...firing.map(a => { const b = document.createElement("span"); b.className = "badge"; b.style.cssText = `border-color:${FX_COLOR[a.effect] || "#888"};color:${FX_COLOR[a.effect] || "#ccc"}`; b.textContent = `${a.lane} → ${a.effect}`; return b; }));
    }
  }
}
