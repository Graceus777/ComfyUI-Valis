// The stage as 3D Gaussians, written in the browser (no server, no GPU job): every pixel of every layer, its own paint
// and the completion painted behind nearer layers, becomes one splat where the original camera saw it, sized to its
// pixel's footprint, laid along the surface the depth describes, with soft depth edges snapped so nothing floats.
// The same thing valis_fx/lib/splat.py writes, in the standard 3DGS .ply that splat tools open (SuperSplat, Spark,
// Blender add-ons, game engines), or the smaller antimatter15 .splat.
//
//   const {blob, count, dome} = await stageToSplat(stage, {format: "ply"});

const C0 = 0.28209479177387814;            // SH degree-0 constant

function loadImage(src) {
  return new Promise((res, rej) => { const im = new Image(); im.crossOrigin = "anonymous"; im.onload = () => res(im); im.onerror = () => rej(new Error("could not load " + src)); im.src = src; });
}

// rotation with columns a, b, c (the splat's local axes in the world) -> unit quaternion w,x,y,z
function quat(a, b, c, out, o) {
  const m00 = a[0], m10 = a[1], m20 = a[2], m01 = b[0], m11 = b[1], m21 = b[2], m02 = c[0], m12 = c[1], m22 = c[2];
  const t = m00 + m11 + m22;
  let w, x, y, z;
  if (t > 0) { const s = Math.sqrt(t + 1) * 2; w = 0.25 * s; x = (m21 - m12) / s; y = (m02 - m20) / s; z = (m10 - m01) / s; }
  else if (m00 >= m11 && m00 >= m22) { const s = Math.sqrt(1 + m00 - m11 - m22) * 2; w = (m21 - m12) / s; x = 0.25 * s; y = (m01 + m10) / s; z = (m02 + m20) / s; }
  else if (m11 >= m22) { const s = Math.sqrt(1 + m11 - m00 - m22) * 2; w = (m02 - m20) / s; x = (m01 + m10) / s; y = 0.25 * s; z = (m12 + m21) / s; }
  else { const s = Math.sqrt(1 + m22 - m00 - m11) * 2; w = (m10 - m01) / s; x = (m02 + m20) / s; y = (m12 + m21) / s; z = 0.25 * s; }
  const n = Math.hypot(w, x, y, z) || 1;
  out[o] = w / n; out[o + 1] = x / n; out[o + 2] = y / n; out[o + 3] = z / n;
}

// a (2r+1)^2 window min or max, separable, clamped at the borders (cv2.erode / cv2.dilate)
function minmax(src, W, H, r, f) {
  const t = new Float32Array(W * H), o = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let v = src[y * W + x];
    for (let k = Math.max(0, x - r); k <= Math.min(W - 1, x + r); k++) v = f(v, src[y * W + k]);
    t[y * W + x] = v;
  }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let v = t[y * W + x];
    for (let k = Math.max(0, y - r); k <= Math.min(H - 1, y + r); k++) v = f(v, t[k * W + x]);
    o[y * W + x] = v;
  }
  return o;
}

async function layerSplats(stage, L, stride, orient, snap, cx, feather = 0) {
  const m = stage.meta, W = m.width, H = m.height, far = m.far, f0 = stage.f0;
  const [ci, di] = await Promise.all([loadImage(stage._url(L.image)), loadImage(stage._url(L.depth))]);
  cx.clearRect(0, 0, W, H); cx.drawImage(ci, 0, 0, W, H);
  const rgba = cx.getImageData(0, 0, W, H).data;
  cx.clearRect(0, 0, W, H); cx.drawImage(di, 0, 0, W, H);
  const dp = cx.getImageData(0, 0, W, H).data;
  const relief = L.relief ?? (L.backdrop ? 1 : 0.35);       // the same flattening the studio's camera uses
  const z = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) { const d = 1 + (dp[i * 4] * 256 + dp[i * 4 + 1]) / 65535 * (far - 1); z[i] = L.z_med + (d - L.z_med) * relief; }
  if (snap) {
    // depth maps are soft at edges, so a jump (an arm in front of the chest, a wall behind a shoulder) is a ramp of
    // in-between depths: a curtain of floating splats once the camera moves. Every pixel on a jump of more than 12%
    // within 7 px snaps to whichever side it is nearer, so the edge splits cleanly and nothing floats between.
    const lo = minmax(z, W, H, 3, Math.min), hi = minmax(z, W, H, 3, Math.max);
    for (let i = 0; i < W * H; i++) if (hi[i] - lo[i] > 0.12 * lo[i]) z[i] = z[i] - lo[i] < hi[i] - z[i] ? lo[i] : hi[i];
  }
  // world position of pixel (x, y) in the 3DGS/COLMAP convention every trained .ply uses (x right, y down, the
  // camera looking down +z): splat tools expect it (SuperSplat turns PLY data 180 degrees about z to show it upright)
  const P = (x, y, o) => { const zz = z[y * W + x]; o[0] = (x + 0.5 - W / 2) / f0 * zz; o[1] = (y + 0.5 - H / 2) / f0 * zz; o[2] = zz; return o; };
  const solid = (x, y) => rgba[(y * W + x) * 4 + 3] > 89;
  const out = new Float32Array(Math.ceil(W / stride) * Math.ceil(H / stride) * F);
  let n = 0;
  const p = [0, 0, 0], pa = [0, 0, 0], pb = [0, 0, 0], du = [0, 0, 0], dv = [0, 0, 0];
  for (let y = 0; y < H; y += stride) for (let x = 0; x < W; x += stride) {
    const i = y * W + x;
    let a = rgba[i * 4 + 3] / 255;
    if (a <= 0.35) continue;
    if (feather > 0) {     // the set fades out at the frame's edge, into the dome, instead of ending on a hard cut
      const e = Math.min(1, Math.min(x + 0.5, W - 0.5 - x, y + 0.5, H - 0.5 - y) / (feather * W));
      a *= e * e * (3 - 2 * e);
      if (a <= 0.01) continue;
    }
    P(x, y, p);
    const zz = z[i], foot = stride * zz / f0;
    let s0 = foot * 0.62, s1 = foot * 0.62, s2 = foot * 0.15, q = [1, 0, 0, 0];
    if (orient) {
      // lay the splat along the surface (central differences inside the layer), so a slanted floor or a sleeve turning
      // away stays closed when the camera moves instead of breaking into rows of dots
      const x0 = Math.max(0, x - 1), x1 = Math.min(W - 1, x + 1), y0 = Math.max(0, y - 1), y1 = Math.min(H - 1, y + 1);
      if (solid(x0, y) && solid(x1, y) && solid(x, y0) && solid(x, y1)) {
        P(x1, y, pa); P(x0, y, pb); for (let k = 0; k < 3; k++) du[k] = (pa[k] - pb[k]) / Math.max(1, x1 - x0);
        P(x, y1, pa); P(x, y0, pb); for (let k = 0; k < 3; k++) dv[k] = (pa[k] - pb[k]) / Math.max(1, y1 - y0);
        const lu = Math.hypot(...du), lv = Math.hypot(...dv), unit = zz / f0;
        const n = [du[1] * dv[2] - du[2] * dv[1], du[2] * dv[0] - du[0] * dv[2], du[0] * dv[1] - du[1] * dv[0]], nl = Math.hypot(...n);
        if (lu < 4 * unit && lv < 4 * unit && nl > 1e-12) {        // a jump inside the layer stays camera-facing
          const t1 = du.map(v => v / lu), nr = n.map(v => v / nl);
          const t2 = [nr[1] * t1[2] - nr[2] * t1[1], nr[2] * t1[0] - nr[0] * t1[2], nr[0] * t1[1] - nr[1] * t1[0]];
          quat(t1, t2, nr, q, 0);
          s0 = stride * lu * 0.62;
          s1 = stride * Math.max(Math.abs(dv[0] * t2[0] + dv[1] * t2[1] + dv[2] * t2[2]), 0.25 * lv) * 0.62;
          s2 = foot * 0.08;
        }
      }
    }
    out.set([p[0], p[1], p[2], rgba[i * 4] / 255, rgba[i * 4 + 1] / 255, rgba[i * 4 + 2] / 255, a, s0, s1, s2, q[0], q[1], q[2], q[3]], n * F); n++;
  }
  return out.subarray(0, n * F);
}

// The dome (dome.png, an angular map Valis writes when it splits a still: the farthest backdrop inside the frame, the
// still mirrored and blurred out past it) as splats on a sphere three times as far as the set's farthest point, so
// a camera moving through the set sees its air and light go on past the frame edge instead of a void.
async function domeSplats(stage, cx) {
  const m = stage.meta, d = m.dome;
  if (!d) return null;
  const du = stage._url(d.image), dv = d.rev ? `${du}${du.includes("?") ? "&" : "?"}v=${d.rev}` : du;
  const im = await loadImage(dv).catch(() => null);
  if (!im) return null;
  // a painted dome has 4x the texels (0.2 deg): keep ~120-150k splats, each as wide as the texels it stands for
  const k = Math.max(1, Math.ceil(Math.sqrt(im.naturalWidth * im.naturalHeight / 150000)));
  const nx = Math.floor(im.naturalWidth / k), ny = Math.floor(im.naturalHeight / k);
  cx.canvas.width = Math.max(cx.canvas.width, nx); cx.canvas.height = Math.max(cx.canvas.height, ny);
  cx.clearRect(0, 0, nx, ny); cx.imageSmoothingQuality = "high"; cx.drawImage(im, 0, 0, nx, ny);
  const px = cx.getImageData(0, 0, nx, ny).data;
  const R = 3 * m.far, w = R * d.step * k * Math.PI / 180, rad = Math.PI / 180;
  const out = new Float32Array(nx * ny * F), q = [0, 0, 0, 0];
  for (let j = 0; j < ny; j++) {
    const pa = (d.pitch - 2 * d.pitch * j / (ny - 1)) * rad, cp = Math.cos(pa), sp = Math.sin(pa);
    for (let i = 0; i < nx; i++) {
      const ya = (-d.yaw + 2 * d.yaw * i / (nx - 1)) * rad;
      const nr = [Math.sin(ya) * cp, -sp, Math.cos(ya) * cp];                         // y down, +z ahead
      const l = Math.hypot(nr[2], nr[0]) || 1, t1 = [-nr[2] / l, 0, nr[0] / l];       // up x n (up = -y), normalised
      const t2 = [nr[1] * t1[2] - nr[2] * t1[1], nr[2] * t1[0] - nr[0] * t1[2], nr[0] * t1[1] - nr[1] * t1[0]];
      quat(t1, t2, nr, q, 0);
      const k = j * nx + i, o = k * F;
      out.set([nr[0] * R, nr[1] * R, nr[2] * R, px[k * 4] / 255, px[k * 4 + 1] / 255, px[k * 4 + 2] / 255, 0.98,
        w * 0.75 * Math.min(1, Math.max(0.2, cp)), w * 0.75, w * 0.05, q[0], q[1], q[2], q[3]], o);
    }
  }
  return out;
}

const F = 14;                                  // floats a splat: x y z, r g b, a, s0 s1 s2, w x y z

function writePly(v, n) {
  const names = ["x", "y", "z", "nx", "ny", "nz", "f_dc_0", "f_dc_1", "f_dc_2", "opacity", "scale_0", "scale_1", "scale_2", "rot_0", "rot_1", "rot_2", "rot_3"];
  const head = `ply\nformat binary_little_endian 1.0\nelement vertex ${n}\n` + names.map(k => `property float ${k}\n`).join("") + "end_header\n";
  const body = new Float32Array(n * 17);
  for (let i = 0; i < n; i++) {
    const s = i * F, o = i * 17, a = Math.min(1 - 1e-4, Math.max(1e-4, v[s + 6]));
    body[o] = v[s]; body[o + 1] = v[s + 1]; body[o + 2] = v[s + 2];
    body[o + 6] = (v[s + 3] - 0.5) / C0; body[o + 7] = (v[s + 4] - 0.5) / C0; body[o + 8] = (v[s + 5] - 0.5) / C0;
    body[o + 9] = Math.log(a / (1 - a));
    for (let k = 0; k < 3; k++) body[o + 10 + k] = Math.log(Math.max(1e-7, v[s + 7 + k]));
    for (let k = 0; k < 4; k++) body[o + 13 + k] = v[s + 10 + k];
  }
  return new Blob([new TextEncoder().encode(head), body.buffer], {type: "application/octet-stream"});
}

function writeSplat(v, n) {
  // antimatter15 .splat: 32 bytes a splat (position, scale, RGBA, rotation), biggest and most opaque first
  const order = Array.from({length: n}, (_, i) => i);
  const key = new Float32Array(n);
  for (let i = 0; i < n; i++) { const s = i * F; key[i] = v[s + 7] * v[s + 8] * v[s + 9] * v[s + 6]; }
  order.sort((a, b) => key[b] - key[a]);
  const buf = new ArrayBuffer(n * 32), f = new Float32Array(buf), u = new Uint8Array(buf);
  const c8 = x => Math.max(0, Math.min(255, Math.round(x)));
  order.forEach((i, r) => {
    const s = i * F;
    f.set([v[s], v[s + 1], v[s + 2], v[s + 7], v[s + 8], v[s + 9]], r * 8);
    u.set([c8(v[s + 3] * 255), c8(v[s + 4] * 255), c8(v[s + 5] * 255), c8(v[s + 6] * 255),
      c8(v[s + 10] * 128 + 128), c8(v[s + 11] * 128 + 128), c8(v[s + 12] * 128 + 128), c8(v[s + 13] * 128 + 128)], r * 32 + 24);
  });
  return new Blob([buf], {type: "application/octet-stream"});
}

// stride: a splat every `stride` px (default 2, or 3 for a still over 1800 px wide: ~650k splats for a 1440p set)
export async function stageToSplat(stage, {stride = null, format = "ply", orient = true, snap = true, layers = null, dome = true, feather = 0.03} = {}) {
  const m = stage.meta;
  stride = stride || (m.width > 1800 ? 3 : 2);
  const cv = document.createElement("canvas"); cv.width = m.width; cv.height = m.height;
  const cx = cv.getContext("2d", {willReadFrequently: true});
  const parts = [];
  for (const L of stage.layers) {
    if ((layers && !layers.includes(L.name)) || !L.visible) continue;
    parts.push(await layerSplats(stage, L, stride, orient, snap, cx, feather));
  }
  const dm = dome ? await domeSplats(stage, cx) : null;
  if (dm) parts.push(dm);
  const v = new Float32Array(parts.reduce((s, p) => s + p.length, 0));
  parts.reduce((o, p) => (v.set(p, o), o + p.length), 0);
  const n = v.length / F;
  return {blob: format === "splat" ? writeSplat(v, n) : writePly(v, n), count: n, dome: !!dm, domeCount: dm ? dm.length / F : 0};
}
