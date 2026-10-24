// The colour grade of valis_fx/lib/palette.py, in the browser: the same steps in the same order on a canvas's pixels,
// so the studio can show a look on your own keyframe while you hover it, and show its colours as swatches.
// What renders the shot is still ValisColorPalette in Python; tools/check_grade.mjs compares the two.
import {PALETTES, NEUTRAL} from "./palettes.js";

const LUMA = [.2126, .7152, .0722];
const luma3 = (c) => c[0] * LUMA[0] + c[1] * LUMA[1] + c[2] * LUMA[2];
const clamp01 = (v) => v < 0 ? 0 : v > 1 ? 1 : v;
// mixing your own colours into a named look: how much of the gradient map goes over the look (palette.py OWN_AMOUNT): nearly all of it, so the colours you pick are the colours you get, with the look's contrast, grain and glow kept
export const OWN_AMOUNT = 0.9;

const hexRgb = (h) => { const c = h.trim().replace("#", ""); return [0, 2, 4].map(i => parseInt(c.slice(i, i + 2), 16) / 255); };
export const rgbHex = (c) => "#" + c.map(v => Math.round(clamp01(v) * 255).toString(16).padStart(2, "0")).join("");

// the parameters for a look by id, optionally with your own colours: alone (id "custom", palette.py hex_look) or mapped
// over the named look
export function lookParams(id, hex = null) {
  const p = {...NEUTRAL, ...(PALETTES.find(x => x.id === id)?.grade || {})};
  if (hex && hex.length >= 2) {
    const cols = hex.map(hexRgb).sort((a, b) => luma3(a) - luma3(b));
    if (id === "custom" || !PALETTES.some(x => x.id === id) || id === "natural" || id === "auto") return {...NEUTRAL, palette: cols, palette_amount: .85, contrast: .1};
    return {...p, palette: cols, palette_amount: OWN_AMOUNT};
  }
  return p;
}

// ---- blur: Gaussian, separable; wide ones at quarter size like palette.py's _blur
function gauss1d(src, W, H, C, sigma, horiz) {
  const r = Math.max(1, Math.ceil(sigma * 3)), k = new Float32Array(2 * r + 1);
  let s = 0; for (let i = -r; i <= r; i++) { k[i + r] = Math.exp(-i * i / (2 * sigma * sigma)); s += k[i + r]; }
  for (let i = 0; i < k.length; i++) k[i] /= s;
  const out = new Float32Array(src.length);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) for (let c = 0; c < C; c++) {
    let acc = 0;
    for (let i = -r; i <= r; i++) {
      let xx = horiz ? x + i : x, yy = horiz ? y : y + i;
      if (xx < 0) xx = -xx - 1; if (yy < 0) yy = -yy - 1; if (xx >= W) xx = 2 * W - xx - 1; if (yy >= H) yy = 2 * H - yy - 1;   // reflect, like cv2's default
      xx = Math.min(W - 1, Math.max(0, xx)); yy = Math.min(H - 1, Math.max(0, yy));
      acc += src[(yy * W + xx) * C + c] * k[i + r];
    }
    out[(y * W + x) * C + c] = acc;
  }
  return out;
}
function resize(src, W, H, C, w, h) {          // bilinear (area-ish when shrinking by whole steps is close enough for a preview)
  const out = new Float32Array(w * h * C);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const fx = Math.min(W - 1, Math.max(0, (x + .5) * W / w - .5)), fy = Math.min(H - 1, Math.max(0, (y + .5) * H / h - .5));
    const x0 = Math.floor(fx), y0 = Math.floor(fy), x1 = Math.min(W - 1, x0 + 1), y1 = Math.min(H - 1, y0 + 1), ax = fx - x0, ay = fy - y0;
    for (let c = 0; c < C; c++) {
      const a = src[(y0 * W + x0) * C + c], b = src[(y0 * W + x1) * C + c], d = src[(y1 * W + x0) * C + c], e = src[(y1 * W + x1) * C + c];
      out[(y * w + x) * C + c] = (a * (1 - ax) + b * ax) * (1 - ay) + (d * (1 - ax) + e * ax) * ay;
    }
  }
  return out;
}
function blur(src, W, H, C, sigma) {
  if (sigma <= 0) return src;
  if (sigma < 4) return gauss1d(gauss1d(src, W, H, C, sigma, true), W, H, C, sigma, false);
  const w = Math.max(1, W >> 2), h = Math.max(1, H >> 2);
  let sm = resize(src, W, H, C, w, h);
  sm = gauss1d(gauss1d(sm, w, h, C, sigma / 4, true), w, h, C, sigma / 4, false);
  return resize(sm, w, h, C, W, H);
}
// a seeded normal sampler (the Python grain is numpy's; a preview only needs grain of the same size and strength)
function rng(seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }

// px: Float32Array RGB 0..1 (W*H*3). scale: preview width / the width the shot renders at (blur and grain sizes follow it).
export function gradePixels(px, W, H, lk, {strength = 1, scale = 1, seed = 0, t = 0, effects = true} = {}) {
  const n = W * H, x = new Float32Array(px), src = px;
  const wb = [1 + .09 * lk.temp, 1 - .07 * lk.tint, 1 - .11 * lk.temp], ex = 2 ** lk.exposure;
  const lift = lk.lift, gam = lk.gamma.map(g => 1 / Math.max(g, .05)), gain = lk.gain, mix = lk.mix;
  const doLift = lift.some(v => v), doGam = lk.gamma.some(v => v !== 1), doGain = gain.some(v => v !== 1);
  const c = lk.contrast, p = lk.pivot, k = 4 + 10 * Math.abs(c), s0 = 1 / (1 + Math.exp(k * p)), s1 = 1 / (1 + Math.exp(-k * (1 - p)));
  const sh = lk.shadows, hi = lk.highlights, doSplit = sh.some(v => v) || hi.some(v => v), b = lk.balance;
  const shL = luma3(sh), hiL = luma3(hi);
  const pal = lk.palette && lk.palette_amount ? lk.palette : null, pa = lk.palette_amount;
  for (let i = 0; i < n; i++) {
    let r = clamp01(x[3 * i]), g = clamp01(x[3 * i + 1]), bl = clamp01(x[3 * i + 2]);
    r *= wb[0] * ex; g *= wb[1] * ex; bl *= wb[2] * ex;
    if (mix) { const R = r, Gg = g, B = bl; r = mix[0][0] * R + mix[0][1] * Gg + mix[0][2] * B; g = mix[1][0] * R + mix[1][1] * Gg + mix[1][2] * B; bl = mix[2][0] * R + mix[2][1] * Gg + mix[2][2] * B; }
    r = Math.max(0, r); g = Math.max(0, g); bl = Math.max(0, bl);
    if (doLift) { r += lift[0] * (1 - clamp01(r)); g += lift[1] * (1 - clamp01(g)); bl += lift[2] * (1 - clamp01(bl)); }
    if (doGam) { r = r ** gam[0]; g = g ** gam[1]; bl = bl ** gam[2]; }
    if (doGain) { r *= gain[0]; g *= gain[1]; bl *= gain[2]; }
    if (c) {
      const sc = (v) => { let s = 1 / (1 + Math.exp(-k * (v - p))); s = (s - s0) / (s1 - s0); return c > 0 ? v + (s - v) * c : v + (v - s) * c * .5; };
      r = sc(r); g = sc(g); bl = sc(bl);
    }
    let L = r * LUMA[0] + g * LUMA[1] + bl * LUMA[2];
    r = L + (r - L) * lk.sat; g = L + (g - L) * lk.sat; bl = L + (bl - L) * lk.sat;
    if (lk.vib) { const st = Math.max(Math.abs(r - L), Math.abs(g - L), Math.abs(bl - L)), f = 1 + lk.vib * (1 - clamp01(st * 3)); r = L + (r - L) * f; g = L + (g - L) * f; bl = L + (bl - L) * f; }
    if (doSplit) {
      L = clamp01(r * LUMA[0] + g * LUMA[1] + bl * LUMA[2]);
      const ws = clamp01(1 - L / Math.max(b, 1e-3)) ** 1.5, wh = clamp01((L - b) / Math.max(1 - b, 1e-3)) ** 1.5;
      r += ws * (sh[0] - shL) + wh * (hi[0] - hiL); g += ws * (sh[1] - shL) + wh * (hi[1] - hiL); bl += ws * (sh[2] - shL) + wh * (hi[2] - hiL);
    }
    if (lk.mono) {
      const m = clamp01(r) * LUMA[0] + clamp01(g) * LUMA[1] + clamp01(bl) * LUMA[2], t3 = lk.mono_tint, mo = lk.mono;
      r = r * (1 - mo) + m * t3[0] * mo; g = g * (1 - mo) + m * t3[1] * mo; bl = bl * (1 - mo) + m * t3[2] * mo;
    }
    if (pal) {
      const Lp = clamp01(clamp01(r) * LUMA[0] + clamp01(g) * LUMA[1] + clamp01(bl) * LUMA[2]);
      const kk = pal.length - 1, f = Lp * kk, j = Math.min(kk - 1, Math.floor(f)), a = f - j;
      const gm = [0, 1, 2].map(ch => pal[j][ch] * (1 - a) + pal[j + 1][ch] * a);
      const sc = Lp / Math.max(luma3(gm), 1e-3);
      r = r * (1 - pa) + gm[0] * sc * pa; g = g * (1 - pa) + gm[1] * sc * pa; bl = bl * (1 - pa) + gm[2] * sc * pa;
    }
    r = Math.max(0, r); g = Math.max(0, g); bl = Math.max(0, bl);
    if (lk.roll) { r = r / (1 + lk.roll * r) * (1 + lk.roll); g = g / (1 + lk.roll * g) * (1 + lk.roll); bl = bl / (1 + lk.roll * bl) * (1 + lk.roll); }
    if (lk.fade) { r = lk.fade + r * (1 - lk.fade * 1.3); g = lk.fade + g * (1 - lk.fade * 1.3); bl = lk.fade + bl * (1 - lk.fade * 1.3); }
    x[3 * i] = clamp01(r); x[3 * i + 1] = clamp01(g); x[3 * i + 2] = clamp01(bl);
  }
  if (effects) {
    if (lk.bloom || lk.halation) {
      const hl = new Float32Array(3 * n);
      for (let i = 0; i < 3 * n; i++) hl[i] = clamp01(x[i] - .7) / .3;
      if (lk.bloom) { const bb = blur(hl, W, H, 3, 12 * scale); for (let i = 0; i < 3 * n; i++) x[i] = 1 - (1 - x[i]) * (1 - bb[i] * lk.bloom * .6); }
      if (lk.halation) {
        const m = new Float32Array(n); for (let i = 0; i < n; i++) m[i] = Math.max(hl[3 * i], hl[3 * i + 1], hl[3 * i + 2]);
        const hb = blur(m, W, H, 1, 6 * scale), tint = [1, .35, .15];
        for (let i = 0; i < n; i++) for (let ch = 0; ch < 3; ch++) x[3 * i + ch] = 1 - (1 - x[3 * i + ch]) * (1 - hb[i] * tint[ch] * lk.halation * .7);
      }
    }
    if (lk.soft) { const sb = blur(x, W, H, 3, 1.6 * scale); for (let i = 0; i < 3 * n; i++) x[i] = x[i] * (1 - lk.soft) + sb[i] * lk.soft; }
    if (lk.vignette) for (let yy = 0; yy < H; yy++) for (let xx = 0; xx < W; xx++) {
      const rr = Math.sqrt(((xx - W / 2) / (W * .7)) ** 2 + ((yy - H / 2) / (H * .7)) ** 2), f = 1 - lk.vignette * clamp01(rr - .35) ** 1.6, i = yy * W + xx;
      x[3 * i] *= f; x[3 * i + 1] *= f; x[3 * i + 2] *= f;
    }
    if (lk.grain) {
      const rnd = rng(seed * 1000003 + t + 1), noise = new Float32Array(W * H);
      const cell = Math.max(1, 2 * scale);           // grain cells are 2 px at render size
      const cw = Math.ceil(W / cell) + 1, chh = Math.ceil(H / cell) + 1, cells = new Float32Array(cw * chh);
      for (let i = 0; i < cells.length; i++) { const u = Math.max(1e-7, rnd()), v = rnd(); cells[i] = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
      for (let yy = 0; yy < H; yy++) for (let xx = 0; xx < W; xx++) noise[yy * W + xx] = cells[Math.min(chh - 1, Math.floor(yy / cell)) * cw + Math.min(cw - 1, Math.floor(xx / cell))];
      for (let i = 0; i < n; i++) {
        const L = x[3 * i] * LUMA[0] + x[3 * i + 1] * LUMA[1] + x[3 * i + 2] * LUMA[2], v = noise[i] * lk.grain * .045 * (1 - Math.abs(L * 2 - 1));
        x[3 * i] += v; x[3 * i + 1] += v; x[3 * i + 2] += v;
      }
    }
  }
  for (let i = 0; i < 3 * n; i++) x[i] = clamp01(x[i]);
  if (strength < 1) for (let i = 0; i < 3 * n; i++) x[i] = src[i] * (1 - strength) + x[i] * strength;
  return x;
}

// ImageData in, ImageData out
export function gradeImageData(img, lk, opts) {
  const n = img.width * img.height, px = new Float32Array(3 * n), d = img.data;
  for (let i = 0; i < n; i++) { px[3 * i] = d[4 * i] / 255; px[3 * i + 1] = d[4 * i + 1] / 255; px[3 * i + 2] = d[4 * i + 2] / 255; }
  const out = gradePixels(px, img.width, img.height, lk, opts), o = new ImageData(img.width, img.height);
  for (let i = 0; i < n; i++) { o.data[4 * i] = out[3 * i] * 255 + .5; o.data[4 * i + 1] = out[3 * i + 1] * 255 + .5; o.data[4 * i + 2] = out[3 * i + 2] * 255 + .5; o.data[4 * i + 3] = 255; }
  return o;
}

// a look's colours: a grey ramp from shadow to highlight, graded (what the look turns blacks, mids and whites into),
// plus a skin tone. Used for the swatches, and as the starting colours when you edit a look's palette.
const RAMP = [.06, .22, .42, .64, .88];
export function swatches(lk) {
  const px = new Float32Array(RAMP.flatMap(v => [v, v, v]));
  const out = gradePixels(px, RAMP.length, 1, lk, {effects: false});
  return RAMP.map((_, i) => rgbHex([out[3 * i], out[3 * i + 1], out[3 * i + 2]]));
}
export function skinOf(lk) {
  const out = gradePixels(new Float32Array([.78, .56, .45]), 1, 1, lk, {effects: false});
  return rgbHex([out[0], out[1], out[2]]);
}
