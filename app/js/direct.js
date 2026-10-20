// Direction: what each named layer does, and when. A rule is {layer, effect, on, amount}: `on` is a cue lane (kick,
// beat, syllable, a cue-sheet name…) or "always". Lanes come from the Valis cue engine (cues.py) through
// /valis/stage/cues, so the same music, voice or cue sheet that drives the FX library drives the stage.
//
//   const fx = directAt(rules, cues, sec, stage);   stage.draw(cam, fx)

export const EFFECTS = {
  glow:    {name: "Glow",    hint: "lights up on the cue (lamps, windows, the moon)"},
  flicker: {name: "Flicker", hint: "a flame's unsteady light, flaring on the cue"},
  pulse:   {name: "Pulse",   hint: "swells on the cue, like a heartbeat"},
  appear:  {name: "Appear",  hint: "absent until the first cue, then fades in"},
  vanish:  {name: "Vanish",  hint: "there until the first cue, then fades out"},
  drift:   {name: "Drift",   hint: "slides slowly sideways (clouds, mist)"},
  rise:    {name: "Rise",    hint: "floats up (smoke, steam, embers)"},
  sway:    {name: "Sway",    hint: "moves in the wind, anchored at its base (trees, grass, hair)"},
  shake:   {name: "Shake",   hint: "jolts on every cue"},
  dim:     {name: "Dim",     hint: "darkens on the cue, then recovers"},
  embers:  {name: "Embers",  hint: "throws glowing embers that rise and fade (fire, braziers, torches)", particles: true},
  sparks:  {name: "Sparks",  hint: "a burst of sparks on every cue", particles: true},
  motes:   {name: "Motes",   hint: "dust or snow drifting in the light", particles: true},
};

// a struck envelope, the same shape as Cues.env in cues.py
export function env(times, vals, t, tau = 0.3, attack = 0.015, cap = 1.5) {
  if (!times || !times.length) return 0;
  let s = 0;
  for (let i = 0; i < times.length; i++) {
    const dt = t - times[i];
    if (dt < 0) break;
    if (dt > tau * 8) continue;
    s += (vals ? vals[i] ?? 1 : 1) * (1 - Math.exp(-dt / attack)) * Math.exp(-dt / tau);
  }
  return Math.min(cap, s);
}

function firstAfter(times, t0 = 0) { for (const x of times || []) if (x >= t0) return x; return null; }

// cheap smooth noise for flames
function noise(t, seed) { return 0.5 + 0.25 * Math.sin(t * 7.3 + seed) + 0.15 * Math.sin(t * 13.1 + seed * 2.1) + 0.1 * Math.sin(t * 23.7 + seed * 3.7); }

export function directAt(rules, cues, sec, stage) {
  const out = {layers: {}};
  const W = stage.meta.width, f0 = stage.f0;
  for (const [k, r] of rules.entries()) {
    if (!r.layer || !r.effect) continue;
    const o = out.layers[r.layer] ??= {tint: [1, 1, 1, 0], off: [0, 0, 0], scale: 1, opacity: 1, sway: [0, 0, 0]};
    const a = r.amount ?? 1;
    const always = !r.on || r.on === "always";
    const ts = always ? null : cues?.lanes?.[r.on];
    const vs = always ? null : cues?.vals?.[r.on];
    const e = always ? 1 : env(ts, vs, sec, r.effect === "glow" ? 0.45 : 0.3);
    const first = always ? 0 : firstAfter(ts, 0);
    switch (r.effect) {
      case "glow": { const g = Math.min(1, e) * a; o.tint[3] += always ? 0.2 * a : 0.4 * g; o.tint[0] *= 1 + 0.08 * g; o.tint[2] *= 1 - 0.12 * g;
        o.glow = (o.glow ?? 0) + (always ? 0.45 * a : 1.1 * g); break; }
      case "flicker": { const n = noise(sec, k * 3.1), f = 0.25 * (n - 0.5) * 2 + 0.45 * (always ? 0 : Math.min(1, e));
        o.tint[3] += a * f * 0.7; o.glow = (o.glow ?? 0) + a * (0.35 + 0.6 * (n - 0.5) + (always ? 0 : 0.6 * Math.min(1, e))); break; }
      case "pulse": o.scale *= 1 + 0.06 * a * e; break;
      case "appear": o.opacity *= first == null ? 0 : Math.min(1, Math.max(0, (sec - first) / 0.4)); break;
      case "vanish": o.opacity *= first == null ? 1 : 1 - Math.min(1, Math.max(0, (sec - first) / 0.4)); break;
      case "drift": o.off[0] += 0.012 * a * sec * W / f0 / 1; break;
      case "rise": o.off[1] -= 0.01 * a * sec * W / f0; break;
      case "sway": o.sway = [0.006 * a, 0.35, sec]; break;
      case "shake": { const j = (always ? 0.3 : e) * 0.004 * a * W / f0; o.off[0] += j * Math.sin(sec * 61 + k); o.off[1] += j * Math.cos(sec * 53 + k); break; }
      case "dim": { const d = Math.max(0.15, 1 - 0.7 * a * e); o.tint[0] *= d; o.tint[1] *= d; o.tint[2] *= d; break; }
    }
  }
  out.particles = particlesAt(rules, cues, sec, stage);
  return out;
}

// ---- particles: deterministic in time (the export draws exactly what the preview drew) -------------------------------
function hash(a, b) { const x = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return x - Math.floor(x); }

const KINDS = {
  //            life  rate/s  burst  speed  spread  grav  size   colour             peak
  embers: {life: 2.4, rate: 22, burst: 14, vy: -70, vx: 18, g: -8,  size: 7.0, c: [1.0, 0.55, 0.18], k: 1.3},
  sparks: {life: 0.8, rate: 6,  burst: 26, vy: -160, vx: 160, g: 320, size: 5.0, c: [1.0, 0.82, 0.45], k: 1.6},
  motes:  {life: 7.0, rate: 16, burst: 30, vy: -6, vx: 10, g: 0,   size: 4.0, c: [0.85, 0.88, 1.0], k: 0.4},
};

export function particlesAt(rules, cues, sec, stage) {
  const out = [];
  const W = stage.meta.width, H = stage.meta.height, f0 = stage.f0;
  rules.forEach((r, k) => {
    const K = KINDS[r.effect];
    if (!K || !r.layer) return;
    const L = stage.layer(r.layer), pts = stage.samples(r.layer);
    if (!L || !pts || !L.visible) return;
    const a = r.amount ?? 1, z = L.z_med * L.zoff, n = pts.length / 2;
    const emit = (seedA, t0) => {
      const age = sec - t0;
      if (age < 0 || age > K.life) return;
      const j = Math.floor(hash(seedA, 1.7) * n);
      const vx = (hash(seedA, 2.3) - 0.5) * 2 * K.vx, vy = K.vy * (0.6 + 0.8 * hash(seedA, 3.1));
      let x = pts[j * 2] + vx * age + 6 * Math.sin(age * 2.1 + seedA), y = pts[j * 2 + 1] + vy * age + 0.5 * K.g * age * age;
      if (r.effect === "motes") { x += 30 * Math.sin(age * 0.4 + seedA * 3); }
      const u = age / K.life, life = r.effect === "sparks" ? Math.pow(1 - u, 1.5) : Math.sin(Math.PI * Math.min(1, u * 1.1));
      const flick = 0.75 + 0.25 * Math.sin(sec * 23 + seedA * 7);
      const size = K.size * (0.6 + 0.8 * hash(seedA, 4.9)) * Math.sqrt(a);
      out.push((x - W / 2) / f0 * z, (y - H / 2) / f0 * z, z, size, K.c[0], K.c[1], K.c[2], K.k * life * flick);
    };
    const always = !r.on || r.on === "always";
    if (always) {
      const rate = K.rate * a;
      for (let i = Math.floor((sec - K.life) * rate); i <= Math.floor(sec * rate); i++) emit(i * 1.37 + k * 101.3, i / rate);
    } else {
      const ts = cues?.lanes?.[r.on] || [];
      ts.forEach((t, h) => {
        if (t > sec || sec - t > K.life) return;
        const m = Math.round(K.burst * a * (cues?.vals?.[r.on]?.[h] ?? 1));
        for (let q = 0; q < m; q++) emit(h * 31.7 + q * 1.13 + k * 101.3, t + q * 0.004);
      });
    }
  });
  return out.length ? new Float32Array(out) : null;
}

// camera punch: a short zoom kick on a lane (the drop, a stroke, a word)
export function punchAt(cues, lane, sec, amount = 1) {
  if (!lane || lane === "none") return 1;
  return 1 + 0.035 * amount * env(cues?.lanes?.[lane], cues?.vals?.[lane], sec, 0.18);
}
