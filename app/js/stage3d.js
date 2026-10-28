// Valis Stage: plays a stage folder (layer_XX.png + depth_XX.png + stage.json, made by the Valis Stage node) through a
// real pinhole camera in WebGL2. Every pixel of every layer is put back where the original camera saw it (along its
// ray, at its depth), so at rest the picture is exactly the still; move the camera and each layer shows true parallax,
// and the completion painted behind nearer layers fills what they uncover. Nothing is diffused per frame.
//
//   const st = new Stage(canvas); await st.load(baseUrl, meta); st.draw(camAt(meta, "dolly_zoom_in", t, opts));

const VS = `#version 300 es
precision highp float;
in vec2 a_uv;
uniform sampler2D u_depth;
uniform vec2 u_size;      // source W, H
uniform float u_f0;       // source focal (px)
uniform float u_f;        // camera focal (px, output space)
uniform vec2 u_out;       // output W, H
uniform vec3 u_cam;       // camera position (world)
uniform mat3 u_rot;       // world -> camera rotation
uniform float u_far, u_relief, u_zmed, u_zoff;
uniform vec3 u_off;       // world offset of this layer (drift, shake, rise)
uniform vec3 u_scale;     // scale about a pivot (x, y in px of the source), z = factor
uniform vec4 u_sway;      // amplitude (fraction of width), frequency (Hz), time (s), bottom of the layer (uv y)
uniform float u_swayh;    // height of the layer (uv)
out vec2 v_uv;
out vec2 v_raw;
out float v_z;
void main() {
  vec2 uvc = clamp(a_uv, 0.0, 1.0);
  v_raw = a_uv;
  float zr = texture(u_depth, uvc).r;                    // distance, 1 .. far
  float z = mix(u_zmed, zr, u_relief) * u_zoff;          // relief 0 = a flat card at the layer's median depth
  vec2 px = a_uv * u_size;
  px = u_scale.xy + (px - u_scale.xy) * u_scale.z;
  if (u_sway.x != 0.0) {
    float wgt = clamp((u_sway.w - uvc.y) / max(u_swayh, 1e-3), 0.0, 1.0);   // anchored at the bottom, the top moves most
    px.x += u_sway.x * u_size.x * wgt * wgt * sin(6.2831 * u_sway.y * u_sway.z + uvc.y * 4.0 + uvc.x * 2.0);
  }
  px -= 0.5 * u_size;
  vec3 X = vec3(px / u_f0 * z, z) + u_off * z;
  vec3 p = u_rot * (X - u_cam);
  v_uv = uvc;
  v_z = p.z;
  vec2 s = u_f * p.xy / max(p.z, 1e-3);
  gl_Position = vec4(s.x / (0.5 * u_out.x), -s.y / (0.5 * u_out.y), clamp(1.0 - 1.0 / max(p.z, 1e-3), 0.0, 1.0), 1.0);
}`;

const FS = `#version 300 es
precision highp float;
in vec2 v_uv;
in vec2 v_raw;
in float v_z;
uniform sampler2D u_color;
uniform float u_clip;     // 1 = show only the picture itself (no clamped margin), for the exploded view
uniform float u_opacity, u_tear;
uniform vec4 u_tint;      // rgb multiply, a = add glow
uniform float u_glow;     // glow pass: how much of this layer's light blooms (0 = it only occludes)
uniform int u_pass;       // 0 = picture, 1 = glow
uniform float u_feather;  // > 0: past the frame edge a layer's stretched edge fades out over this fraction of the width, into the dome
uniform float u_fstart;   // ... starting this far past the edge
uniform float u_aspect;   // H / W of the source
uniform sampler2D u_outer; // the painted world past the frame for this layer (outer_XX.png, written with a painted dome)
uniform float u_outer_on, u_margin;
out vec4 o;
void main() {
  // a triangle stretched across a depth jump inside one layer is a rubber sheet: drop it
  if (fwidth(v_z) / v_z > u_tear) discard;
  if (u_clip > 0.5 && (v_raw.x < 0.0 || v_raw.y < 0.0 || v_raw.x > 1.0 || v_raw.y > 1.0)) discard;
  vec4 c = texture(u_color, v_uv);
  float ox = max(max(-v_raw.x, v_raw.x - 1.0), 0.0), oyr = max(max(-v_raw.y, v_raw.y - 1.0), 0.0);
  float d = u_outer_on > 0.5 ? max(ox, oyr) : max(ox, oyr * u_aspect);
  if (u_outer_on > 0.5 && d > 0.0) {
    // past the frame: the painted world instead of the stretched edge, where this layer is what the camera sees at
    // the edge (outer alpha), and everywhere in the last stretch where it fades into the dome
    vec4 q = texture(u_outer, (v_raw + u_margin) / (1.0 + 2.0 * u_margin));
    c.rgb = mix(c.rgb, q.rgb, max(q.a, smoothstep(u_fstart - 0.02, u_fstart, d)));
  }
  if (u_feather > 0.0) {      // inside the frame nothing changes: at rest the picture is exactly the still
    float e = 1.0 - clamp((d - u_fstart) / u_feather, 0.0, 1.0);
    c.a *= e * e * (3.0 - 2.0 * e);
  }
  c.rgb = c.rgb * u_tint.rgb + u_tint.a * c.rgb;
  if (u_pass == 1) {
    // only the light blooms: the layer's bright paint, scaled by its glow; everything else occludes in black
    float lum = dot(c.rgb, vec3(0.3, 0.59, 0.11));
    float k = smoothstep(0.18, 0.85, lum) * u_glow;
    o = vec4(c.rgb * k * c.a, c.a) * u_opacity;
    return;
  }
  o = vec4(c.rgb * c.a, c.a) * u_opacity;                // premultiplied
}`;

// ---- full-screen passes: blur and add
const QVS = `#version 300 es
precision highp float;
out vec2 v_uv;
void main() { vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2); v_uv = p; gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0); }`;
const BLUR = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_tex;
uniform vec2 u_dir;       // texel step along the blur direction
out vec4 o;
void main() {
  vec4 a = texture(u_tex, v_uv) * 0.227027;
  a += (texture(u_tex, v_uv + u_dir * 1.384615) + texture(u_tex, v_uv - u_dir * 1.384615)) * 0.316216;
  a += (texture(u_tex, v_uv + u_dir * 3.230769) + texture(u_tex, v_uv - u_dir * 3.230769)) * 0.070270;
  o = a;
}`;
const ADD = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_a, u_b;
uniform float u_ka, u_kb;
out vec4 o;
void main() { o = vec4(texture(u_a, v_uv).rgb * u_ka + texture(u_b, v_uv).rgb * u_kb, 0.0); }`;

// ---- the dome: the world past the frame (dome.png, an angular map around the original camera), on a sphere three
// times as far as the set's farthest point. Drawn first, so it shows wherever the set doesn't: past the frame edge
// when the camera goes wide, and through any tear.
const DFS = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_dome;
uniform vec2 u_out;
uniform float u_f, u_R;
uniform vec3 u_cam;
uniform mat3 u_rot;
uniform vec2 u_ang;       // yaw, pitch half-ranges (radians)
out vec4 o;
void main() {
  vec2 px = vec2(v_uv.x, 1.0 - v_uv.y) * u_out - 0.5 * u_out;
  vec3 dw = transpose(u_rot) * normalize(vec3(px / u_f, 1.0));
  float b = dot(dw, u_cam), c = dot(u_cam, u_cam) - u_R * u_R;
  vec3 p = (u_cam + dw * (-b + sqrt(max(b * b - c, 0.0)))) / u_R;
  float yaw = atan(p.x, p.z), pitch = asin(clamp(-p.y, -1.0, 1.0));
  o = vec4(texture(u_dome, vec2((yaw + u_ang.x) / (2.0 * u_ang.x), (u_ang.y - pitch) / (2.0 * u_ang.y))).rgb, 1.0);
}`;

// ---- particles: points in the world, drawn through the same camera, additive
const PVS = `#version 300 es
precision highp float;
in vec4 a_p;              // world x, y, z, size (source px)
in vec4 a_c;              // rgb, intensity
uniform float u_f, u_f0, u_px;
uniform vec2 u_out, u_size;
uniform vec3 u_cam;
uniform mat3 u_rot;
out vec4 v_c;
void main() {
  vec3 p = u_rot * (a_p.xyz - u_cam);
  vec2 s = u_f * p.xy / max(p.z, 1e-3);
  gl_Position = vec4(s.x / (0.5 * u_out.x), -s.y / (0.5 * u_out.y), 0.0, 1.0);
  gl_PointSize = max(1.0, a_p.w * (u_f / u_f0) * (a_p.z / max(p.z, 1e-3)) * u_px);
  v_c = a_c;
  if (p.z < 0.05) v_c.a = 0.0;
}`;
const PFS = `#version 300 es
precision highp float;
in vec4 v_c;
out vec4 o;
void main() {
  vec2 d = gl_PointCoord * 2.0 - 1.0;
  float r = dot(d, d);
  if (r > 1.0) discard;
  float k = exp(-r * 3.0) * v_c.a;
  o = vec4(v_c.rgb * k, 0.0);
}`;

function prog(gl, vs, fs) {
  const p = gl.createProgram();
  gl.attachShader(p, sh(gl, gl.VERTEX_SHADER, vs)); gl.attachShader(p, sh(gl, gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  return p;
}

function sh(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src); gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
  return s;
}

function loadImage(url) {
  return new Promise((res, rej) => { const im = new Image(); im.crossOrigin = "anonymous"; im.onload = () => res(im); im.onerror = () => rej(new Error("could not load " + url)); im.src = url; });
}

export function rotY(a) { const c = Math.cos(a), s = Math.sin(a); return [c, 0, -s, 0, 1, 0, s, 0, c]; }
export function rotX(a) { const c = Math.cos(a), s = Math.sin(a); return [1, 0, 0, 0, c, s, 0, -s, c]; }
export function mul3(a, b) {   // column-major 3x3, as WebGL expects
  const o = new Array(9);
  for (let c = 0; c < 3; c++) for (let r = 0; r < 3; r++) o[c * 3 + r] = a[r] * b[c * 3] + a[3 + r] * b[c * 3 + 1] + a[6 + r] * b[c * 3 + 2];
  return o;
}

export class Stage {
  constructor(canvas, { step = 4, fov = 50 } = {}) {
    this.canvas = canvas;
    const gl = canvas.getContext("webgl2", { premultipliedAlpha: true, preserveDrawingBuffer: true, antialias: true });
    if (!gl) throw new Error("WebGL2 is needed for the stage");
    this.gl = gl; this.step = step; this.fov = fov;
    const p = gl.createProgram();
    gl.attachShader(p, sh(gl, gl.VERTEX_SHADER, VS)); gl.attachShader(p, sh(gl, gl.FRAGMENT_SHADER, FS)); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    this.prog = p;
    this.loc = {};
    for (const n of ["u_depth", "u_color", "u_size", "u_f0", "u_f", "u_out", "u_cam", "u_rot", "u_far", "u_relief", "u_zmed", "u_zoff", "u_opacity", "u_tear", "u_tint", "u_off", "u_scale", "u_sway", "u_swayh", "u_glow", "u_pass", "u_clip", "u_feather", "u_aspect", "u_fstart", "u_outer", "u_outer_on", "u_margin"]) this.loc[n] = gl.getUniformLocation(p, n);
    this.blank = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, this.blank);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 0]));
    this.blur = prog(gl, QVS, BLUR); this.add = prog(gl, QVS, ADD); this.pts = prog(gl, PVS, PFS); this.domeProg = prog(gl, QVS, DFS);
    this.dome = null; this.layers = [];
    this.pbuf = gl.createBuffer(); this.pvao = gl.createVertexArray();
    gl.bindVertexArray(this.pvao); gl.bindBuffer(gl.ARRAY_BUFFER, this.pbuf);
    const ap = gl.getAttribLocation(this.pts, "a_p"), ac = gl.getAttribLocation(this.pts, "a_c");
    gl.enableVertexAttribArray(ap); gl.vertexAttribPointer(ap, 4, gl.FLOAT, false, 32, 0);
    gl.enableVertexAttribArray(ac); gl.vertexAttribPointer(ac, 4, gl.FLOAT, false, 32, 16);
    gl.bindVertexArray(null);
    this.fbos = null;
    this.layers = [];
  }

  // half-resolution targets for the glow (bloom) pass
  _targets() {
    const gl = this.gl, w = Math.max(2, this.canvas.width >> 1), h = Math.max(2, this.canvas.height >> 1);
    if (this.fbos && this.fbos.w === w && this.fbos.h === h) return this.fbos;
    const mk = () => {
      const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
      const f = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, f);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
      return {t, f};
    };
    this.fbos = {w, h, a: mk(), b: mk(), c: mk()};
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return this.fbos;
  }

  // the still's own pixels of a layer, as spawn points for particles (bright paint first: flames, lamps, windows)
  samples(name, n = 600) {
    const l = this.layer(name);
    if (!l) return null;
    if (l._samples) return l._samples;
    const W = this.meta.width, H = this.meta.height, im = l._img;
    if (!im) return null;
    const cv = document.createElement("canvas"); cv.width = W; cv.height = H;
    const cx = cv.getContext("2d", {willReadFrequently: true}); cx.drawImage(im, 0, 0);
    const px = cx.getImageData(0, 0, W, H).data, b = l.bbox || [0, 0, W - 1, H - 1];
    const pts = [], bright = [];
    for (let y = b[1]; y <= b[3]; y += 2) for (let x = b[0]; x <= b[2]; x += 2) {
      const i = (y * W + x) * 4;
      if (px[i + 3] < 200) continue;
      const lum = (0.3 * px[i] + 0.59 * px[i + 1] + 0.11 * px[i + 2]) / 255;
      (lum > 0.45 ? bright : pts).push(x, y);
    }
    const src = bright.length >= 40 ? bright : bright.concat(pts);
    const out = new Float32Array(n * 2);
    let seed = 1234567;
    for (let k = 0; k < n; k++) {
      seed = (seed * 1103515245 + 12345) >>> 0;
      const j = (seed % Math.max(1, src.length / 2)) * 2;
      out[k * 2] = src[j] ?? W / 2; out[k * 2 + 1] = src[j + 1] ?? H / 2;
    }
    l._samples = out;
    return out;
  }

  _grid(W, H, margin) {
    // vertices every `step` px; backdrops reach past the frame edge (clamped texels) so a moving camera never sees void
    const gl = this.gl, st = this.step;
    const gx = Math.ceil(W * (1 + 2 * margin) / st) + 1, gy = Math.ceil(H * (1 + 2 * margin) / st) + 1;
    const uv = new Float32Array(gx * gy * 2);
    let k = 0;
    for (let j = 0; j < gy; j++) for (let i = 0; i < gx; i++) { uv[k++] = -margin + i / (gx - 1) * (1 + 2 * margin); uv[k++] = -margin + j / (gy - 1) * (1 + 2 * margin); }
    const idx = new Uint32Array((gx - 1) * (gy - 1) * 6);
    k = 0;
    for (let j = 0; j < gy - 1; j++) for (let i = 0; i < gx - 1; i++) {
      const a = j * gx + i, b = a + 1, c = a + gx, d = c + 1;
      idx[k++] = a; idx[k++] = c; idx[k++] = b; idx[k++] = b; idx[k++] = c; idx[k++] = d;
    }
    const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
    const vb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vb); gl.bufferData(gl.ARRAY_BUFFER, uv, gl.STATIC_DRAW);
    const al = gl.getAttribLocation(this.prog, "a_uv"); gl.enableVertexAttribArray(al); gl.vertexAttribPointer(al, 2, gl.FLOAT, false, 0, 0);
    const ib = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    return { vao, count: idx.length };
  }

  async load(base, meta) {
    const gl = this.gl;
    const W = meta.width, H = meta.height, far = meta.far;
    const f0 = (W / 2) / Math.tan(this.fov / 2 * Math.PI / 180);
    const cv = document.createElement("canvas"); cv.width = W; cv.height = H;
    const cx = cv.getContext("2d", { willReadFrequently: true });
    const url = typeof base === "function" ? base : (f => base + (base.endsWith("/") ? "" : "/") + f);
    // built aside and swapped in only if no newer load has started: two overlapping loads (a second stage opened while the
    // first is still reading its pictures) shared one layer list and drew a mix of both; the stage on screen stays as it was
    // until this one is whole
    const tok = this._loadTok = (this._loadTok || 0) + 1;
    const layers = [];
    const free = (ls, dome) => { for (const l of ls) { gl.deleteTexture(l.ct); gl.deleteTexture(l.dt); if (l.ot) gl.deleteTexture(l.ot); } if (dome) gl.deleteTexture(dome.t); };
    let dome = null;
    try {
    dome = await this._domeTexture(meta.dome, url);
    for (const L of meta.layers) {
      const [ci, di] = await Promise.all([loadImage(url(L.image)), loadImage(url(L.depth))]);
      const ct = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, ct);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, ci);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      // depth: 16 bits packed in R (high) and G (low) -> a float texture of distances
      cx.clearRect(0, 0, W, H); cx.drawImage(di, 0, 0, W, H);
      const px = cx.getImageData(0, 0, W, H).data;
      const zf = new Float32Array(W * H);
      for (let i = 0; i < W * H; i++) zf[i] = 1 + (px[i * 4] * 256 + px[i * 4 + 1]) / 65535 * (far - 1);
      const dt = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, dt);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, W, H, 0, gl.RED, gl.FLOAT, zf);
      for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.NEAREST], [gl.TEXTURE_MAG_FILTER, gl.NEAREST], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
      const backdrop = L.backdrop ?? (L.area >= 0.12 || L === meta.layers[0]);
      // a layer cut by the frame (a cliff, a table) reaches past the edge too, so a wide move sees it go on and fade
      const b = L.bbox || [0, 0, W - 1, H - 1], cut = b[0] <= 2 || b[1] <= 2 || b[2] >= W - 3 || b[3] >= H - 3;
      const margin = meta.outer?.margin ?? 0.12;
      const grid = this._grid(W, H, backdrop || cut ? margin : 0);
      // with a painted dome, the painted world past the frame for this layer (Valis Stage Dome writes it)
      let ot = null;
      if (L.outer && (backdrop || cut)) {
        const oi = await loadImage(url(L.outer)).catch(() => null);
        if (oi) {
          ot = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, ot);
          gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, oi);
          for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
        }
      }
      layers.push({ ...L, ct, dt, ot, margin, grid, backdrop, visible: true, relief: L.relief ?? (backdrop ? 1 : 0.35), zoff: 1, opacity: 1, tint: [1, 1, 1, 0], _img: ci });
    }
    } catch (e) { free(layers, dome); throw e; }
    if (tok !== this._loadTok) { free(layers, dome); return; }          // a newer load took over: this one is dropped
    const old = this.layers || [];
    if (this.dome) gl.deleteTexture(this.dome.t);
    this.meta = meta; this.f0 = f0; this._url = url;                      // (splat.js reads the layers again, from _url, to write the 3D set)
    this.layers = layers; this.dome = dome;
    free(old);
  }

  // the far dome (dome.png); called again after the world past the frame is repainted
  async loadDome(d) {
    const gl = this.gl, tok = this._loadTok, meta = this.meta;
    const dome = await this._domeTexture(d, this._url);
    if (tok !== this._loadTok || meta !== this.meta) { if (dome) gl.deleteTexture(dome.t); return; }   // another stage was opened meanwhile
    if (this.dome) gl.deleteTexture(this.dome.t);
    this.dome = dome;
    if (this.meta) this.meta.dome = d;
  }

  // the dome's texture (not yet the stage's): null with no dome, or none that loads
  async _domeTexture(d, urlOf) {
    const gl = this.gl;
    if (!d) return null;
    const du = urlOf(d.image), dv = d.rev ? `${du}${du.includes("?") ? "&" : "?"}v=${d.rev}` : du;   // repainted: skip the cache
    const im = await loadImage(dv).catch(() => null);
    if (!im) return null;
    const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, im);
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
    return {t, yaw: d.yaw * Math.PI / 180, pitch: d.pitch * Math.PI / 180, painted: !!d.painted};
  }

  layer(name) { return this.layers.find(l => l.name === name); }

  _layers(pass, fx, explode = 0) {
    const gl = this.gl, m = this.meta, L = this.loc;
    gl.uniform1i(L.u_pass, pass);
    gl.uniform1f(L.u_clip, explode > 0.02 ? 1 : 0);
    const n = this.layers.length;
    this.layers.forEach((l, rank) => {
      if (!l.visible) return;
      const lfx = (fx.layers && fx.layers[l.name]) || {};
      // exploded view: each layer pushed back by its place in the order, flattened toward a card
      const spread = explode ? 1 + explode * 0.9 * (n - 1 - rank) / Math.max(1, n - 1) : 1;
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, l.ct); gl.uniform1i(L.u_color, 0);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, l.dt); gl.uniform1i(L.u_depth, 1);
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, l.ot || this.blank); gl.uniform1i(L.u_outer, 2);
      gl.activeTexture(gl.TEXTURE0);
      gl.uniform1f(L.u_outer_on, l.ot ? 1 : 0); gl.uniform1f(L.u_margin, l.margin ?? 0.12);
      // painted past the frame: it goes on in real paint and fades into the dome only over the mesh's last stretch
      if (this._feather > 0 && l.ot) { gl.uniform1f(L.u_fstart, (l.margin ?? 0.12) - 0.04); gl.uniform1f(L.u_feather, 0.04); }
      else { gl.uniform1f(L.u_fstart, 0); gl.uniform1f(L.u_feather, this._feather || 0); }
      gl.uniform1f(L.u_relief, l.relief * (1 - 0.6 * explode)); gl.uniform1f(L.u_zmed, l.z_med); gl.uniform1f(L.u_zoff, l.zoff * (lfx.zoff ?? 1) * spread);
      gl.uniform1f(L.u_opacity, l.opacity * (lfx.opacity ?? 1));
      gl.uniform1f(L.u_glow, lfx.glow ?? 0);
      const t = lfx.tint || l.tint; gl.uniform4f(L.u_tint, t[0], t[1], t[2], t[3]);
      const off = lfx.off || [0, 0, 0]; gl.uniform3f(L.u_off, off[0], off[1], off[2]);
      const bb = l.bbox || [0, 0, m.width, m.height];
      gl.uniform3f(L.u_scale, (bb[0] + bb[2]) / 2, (bb[1] + bb[3]) / 2, lfx.scale ?? 1);
      const sw = lfx.sway || [0, 0, 0];
      gl.uniform4f(L.u_sway, sw[0], sw[1], sw[2], bb[3] / m.height); gl.uniform1f(L.u_swayh, Math.max(1, bb[3] - bb[1]) / m.height);
      gl.bindVertexArray(l.grid.vao); gl.drawElements(gl.TRIANGLES, l.grid.count, gl.UNSIGNED_INT, 0);
    });
    gl.bindVertexArray(null);
  }

  _points(cam, f, parts, pxScale = 1) {
    // parts: Float32Array of [x, y, z, size, r, g, b, a] per particle, world space
    const gl = this.gl, c = this.canvas, m = this.meta;
    gl.useProgram(this.pts);
    const u = n => gl.getUniformLocation(this.pts, n);
    gl.uniform1f(u("u_f"), f); gl.uniform1f(u("u_f0"), this.f0); gl.uniform1f(u("u_px"), pxScale); gl.uniform2f(u("u_out"), c.width, c.height); gl.uniform2f(u("u_size"), m.width, m.height);
    gl.uniform3fv(u("u_cam"), cam.pos); gl.uniformMatrix3fv(u("u_rot"), false, cam.rot);
    gl.bindVertexArray(this.pvao); gl.bindBuffer(gl.ARRAY_BUFFER, this.pbuf); gl.bufferData(gl.ARRAY_BUFFER, parts, gl.DYNAMIC_DRAW);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.drawArrays(gl.POINTS, 0, parts.length / 8);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.bindVertexArray(null);
  }

  // cam: {pos:[x,y,z], rot: mat3 (column-major), zoom}; zoom 1 = the source framing
  // fx: {layers: {name: {tint, glow, off, scale, opacity, sway, zoff}}, particles: Float32Array, bloom}
  draw(cam, fx = {}) {
    const gl = this.gl, c = this.canvas, m = this.meta, L = this.loc;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, c.width, c.height);
    gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE);
    // output focal: the source focal scaled to the output size, times zoom
    const f = this.f0 * (c.width / m.width) * (cam.zoom ?? 1);
    if (this.dome && fx.dome !== false) {
      gl.disable(gl.BLEND);
      const D = this.domeProg, u = n => gl.getUniformLocation(D, n);
      gl.useProgram(D);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.dome.t); gl.uniform1i(u("u_dome"), 0);
      gl.uniform2f(u("u_out"), c.width, c.height); gl.uniform1f(u("u_f"), f); gl.uniform1f(u("u_R"), 3 * m.far);
      gl.uniform3fv(u("u_cam"), cam.pos); gl.uniformMatrix3fv(u("u_rot"), false, cam.rot); gl.uniform2f(u("u_ang"), this.dome.yaw, this.dome.pitch);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    gl.useProgram(this.prog);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.uniform2f(L.u_size, m.width, m.height); gl.uniform1f(L.u_f0, this.f0); gl.uniform1f(L.u_f, f);
    gl.uniform2f(L.u_out, c.width, c.height); gl.uniform3fv(L.u_cam, cam.pos); gl.uniformMatrix3fv(L.u_rot, false, cam.rot);
    gl.uniform1f(L.u_far, m.far); gl.uniform1f(L.u_tear, fx.tear ?? 0.08);
    this._feather = fx.wide && this.dome && !(cam.explode > 0.02) ? 0.06 : 0;
    gl.uniform1f(L.u_feather, this._feather); gl.uniform1f(L.u_aspect, m.height / m.width);
    this._layers(0, fx, cam.explode || 0);
    const parts = fx.particles && fx.particles.length ? fx.particles : null;
    if (parts) this._points(cam, f, parts);
    const glowing = Object.values(fx.layers || {}).some(v => (v.glow ?? 0) > 0) || parts;
    if (!glowing) return;
    // bloom: the glowing paint (occluded by what's in front of it) and the particles, blurred at half res, added
    const T = this._targets();
    gl.bindFramebuffer(gl.FRAMEBUFFER, T.a.f); gl.viewport(0, 0, T.w, T.h);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.prog);
    this._layers(1, fx, cam.explode || 0);
    if (parts) this._points(cam, f, parts, T.w / c.width);
    gl.disable(gl.BLEND);
    gl.useProgram(this.blur);
    const ub = n => gl.getUniformLocation(this.blur, n);
    gl.uniform1i(ub("u_tex"), 0); gl.activeTexture(gl.TEXTURE0);
    const pass = (src, dst, dx, dy) => { gl.bindFramebuffer(gl.FRAMEBUFFER, dst.f); gl.bindTexture(gl.TEXTURE_2D, src.t); gl.uniform2f(ub("u_dir"), dx / T.w, dy / T.h); gl.drawArrays(gl.TRIANGLES, 0, 3); };
    pass(T.a, T.b, 1.5, 0); pass(T.b, T.c, 0, 1.5);           // tight halo
    pass(T.c, T.b, 4, 0); pass(T.b, T.a, 0, 4);               // wide halo (a is overwritten: tight is in c)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, c.width, c.height);
    gl.useProgram(this.add);
    const ua = n => gl.getUniformLocation(this.add, n);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, T.c.t); gl.uniform1i(ua("u_a"), 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, T.a.t); gl.uniform1i(ua("u_b"), 1);
    const k = fx.bloom ?? 1;
    gl.uniform1f(ua("u_ka"), 0.55 * k); gl.uniform1f(ua("u_kb"), 0.85 * k);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  }
}

// ---- camera moves ---------------------------------------------------------------------------------------------------
// Every move is a function of t in [0, 1] (eased) and an amount (1 = the default size). Distances are in world units
// (the nearest pixel of the still sits at z = 1); `focus` is the depth of the subject the move is built around.

export const MOVES = {
  still:          "Locked off",
  push_in:        "Push in",
  pull_back:      "Pull back",
  truck_left:     "Truck left",
  truck_right:    "Truck right",
  crane_up:       "Crane up",
  crane_down:     "Crane down",
  arc_left:       "Arc left",
  arc_right:      "Arc right",
  dolly_zoom_in:  "Dolly zoom (in)",
  dolly_zoom_out: "Dolly zoom (out)",
  zoom_in:        "Zoom in (lens)",
  drift:          "Drift (handheld breath)",
  show_layers:    "Show the layers (the set, exploded)",
};

export function ease(t, kind = "inout") {
  t = Math.min(1, Math.max(0, t));
  if (kind === "linear") return t;
  if (kind === "out") return 1 - (1 - t) * (1 - t);
  if (kind === "in") return t * t;
  return t * t * (3 - 2 * t);
}

const I3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

// The move itself, before framing: position, rotation and a zoom *shape* (1 = no lens change). `pull_back` and
// `dolly_zoom_out` are their forward moves played backwards, so they start tight and never show past the picture.
export function moveAt(move, t, { amount = 1, focus = 2, easing = "inout" } = {}) {
  if (move === "pull_back") return moveAt("push_in", 1 - t, { amount, focus, easing });
  if (move === "dolly_zoom_out") return moveAt("dolly_zoom_in", 1 - t, { amount, focus, easing });
  const e = ease(t, easing), a = amount, zf = focus;
  let pos = [0, 0, 0], rot = I3, shape = 1;
  switch (move) {
    case "push_in": pos = [0, 0, 0.25 * a * zf * e]; break;
    case "truck_left": pos = [-0.035 * a * zf * e, 0, 0]; break;
    case "truck_right": pos = [0.035 * a * zf * e, 0, 0]; break;
    case "crane_up": pos = [0, -0.04 * a * zf * e, 0.03 * a * zf * e]; rot = rotX(0.025 * a * e); break;
    case "crane_down": pos = [0, 0.035 * a * zf * e, 0]; rot = rotX(-0.02 * a * e); break;
    case "arc_left": case "arc_right": {
      const th = (move === "arc_left" ? -1 : 1) * 0.07 * a * e;      // radians around the subject
      pos = [zf * Math.sin(th), 0, zf * (1 - Math.cos(th))];
      rot = rotY(th);
      break;
    }
    case "dolly_zoom_in": {
      const cz = 0.30 * a * zf * e;
      pos = [0, 0, cz];
      shape = (zf - cz) / zf;                                          // the subject plane keeps its size
      break;
    }
    case "zoom_in": shape = 1 + 0.25 * a * e; break;
    case "show_layers": {
      // the set pulled apart in depth and seen from the side, then put back: shows what Valis built
      const e = Math.sin(Math.PI * Math.min(1, Math.max(0, t)));
      const ease2 = e * e * (3 - 2 * e);
      const th = 0.38 * a * ease2;
      const zc = zf * (1 + 0.45 * ease2 * a), R = zc + 1.1 * zf * ease2;          // orbit the middle of the pulled-apart set
      pos = [R * Math.sin(th), -0.12 * zf * ease2, zc - R * Math.cos(th)];
      rot = mul3(rotX(-0.04 * ease2), rotY(th));
      return { pos, rot, shape: 1 - 0.25 * ease2, explode: ease2 * a };
    }
    case "drift": {
      const T = t * Math.PI * 2;
      pos = [0.008 * a * zf * Math.sin(T * 0.9), 0.006 * a * zf * Math.sin(T * 1.3 + 1), 0.02 * a * zf * Math.sin(T * 0.6)];
      rot = mul3(rotY(0.003 * a * Math.sin(T * 0.7)), rotX(0.002 * a * Math.sin(T * 1.1 + 2)));
      break;
    }
  }
  return { pos, rot, shape };
}

function project(m, p) {               // world point -> screen offset (px, source scale, zoom 1)
  const r = m.rot, d = [p[0] - m.pos[0], p[1] - m.pos[1], p[2] - m.pos[2]];
  const x = r[0] * d[0] + r[3] * d[1] + r[6] * d[2], y = r[1] * d[0] + r[4] * d[1] + r[7] * d[2], z = r[2] * d[0] + r[5] * d[1] + r[8] * d[2];
  return [x / Math.max(z, 1e-3), y / Math.max(z, 1e-3)];
}

// Auto-framing: the smallest zoom that keeps the picture's own edges outside the frame for the whole move, so a camera
// move never shows a border or a smeared clamp. Uses the depth along the still's border (stage.json "border").
// Returns {zoom0, crop}: zoom(t) = zoom0 * shape(t); crop = the largest zoom used (resolution cost of the move).
function borderPoints(meta, fov = 50) {
  const W = meta.width, H = meta.height, f0 = (W / 2) / Math.tan(fov / 2 * Math.PI / 180);
  const B = meta.border, pts = [];
  const add = (side, arr) => arr.forEach((z, i) => {
    const u = (i + 0.5) / arr.length;
    let px, py;
    if (side === "top") [px, py] = [u * W, 0]; else if (side === "bottom") [px, py] = [u * W, H];
    else if (side === "left") [px, py] = [0, u * H]; else [px, py] = [W, u * H];
    pts.push({ side, X: [(px - W / 2) / f0 * z, (py - H / 2) / f0 * z, z] });
  });
  if (B) for (const s of ["top", "bottom", "left", "right"]) add(s, B[s]);
  return { pts, W, H, f0 };
}

// slack: how far inside the frame an edge may come (a fraction of the half-frame), when the dome shows past it
function need(m, P, slack = 0) {
  let n = 1;
  const hw = (P.W / 2) * (1 - slack), hh = (P.H / 2) * (1 - slack);
  for (const p of P.pts) {
    const [sx, sy] = project(m, p.X).map(v => v * P.f0);
    if (p.side === "top" && sy < 0) n = Math.max(n, hh / -sy);
    if (p.side === "bottom" && sy > 0) n = Math.max(n, hh / sy);
    if (p.side === "left" && sx < 0) n = Math.max(n, hw / -sx);
    if (p.side === "right" && sx > 0) n = Math.max(n, hw / sx);
    if ((p.side === "top" && sy >= 0) || (p.side === "bottom" && sy <= 0) || (p.side === "left" && sx >= 0) || (p.side === "right" && sx <= 0)) n = 4;
  }
  return n;
}

// the smallest zoom that keeps the still's own edges out of frame for a whole path (a function sample -> move state)
function fitPath(meta, at, samples, frame, fov, slack = 0) {
  const P = borderPoints(meta, fov);
  let z0 = frame, crop = frame;
  for (let k = 0; k <= samples; k++) { const m = at(k / samples); if (!m.explode) z0 = Math.max(z0, need(m, P, slack) * frame / m.shape); }
  for (let k = 0; k <= samples; k++) { const m = at(k / samples); if (!m.explode) crop = Math.max(crop, z0 * m.shape); }
  return { zoom0: Math.min(z0, 3), crop: Math.min(crop, 3) };
}

export function fitMove(meta, move, opts = {}, { frame = 1.02, steps = 24 } = {}) {
  return fitPath(meta, t => moveAt(move, t, opts), steps, frame, opts.fov ?? 50);
}

// ---- camera sequences: one move, then the next starting at a chosen moment (a word, a hit) --------------------------
// shots: [{move, start (s), amount, focus, easing}], sorted by start. Each runs from its start to the next one's start
// (the last to the end) and keeps its final state after. The first move is absolute (a pull-back starts tight); later
// moves are relative to where the camera already is.
function transpose3(r) { return [r[0], r[3], r[6], r[1], r[4], r[7], r[2], r[5], r[8]]; }

export function seqAt(shots, T, end) {
  let pos = [0, 0, 0], rot = I3, shape = 1, explode = 0;
  shots.forEach((s, i) => {
    const s1 = i + 1 < shots.length ? shots[i + 1].start : end;
    const len = Math.max(0.05, s1 - s.start);
    const t = Math.min(1, Math.max(0, (T - s.start) / len));
    // the subject's distance from where the camera already is (a dolly zoom after a push holds the subject as it is now)
    const o = { amount: s.amount ?? 1, focus: Math.max(0.2, (s.focus ?? 2) - (i > 0 ? pos[2] : 0)), easing: s.easing ?? "inout" };
    let m = moveAt(s.move, t, o);
    if (i > 0) {
      const m0 = moveAt(s.move, 0, o);
      m = { pos: [m.pos[0] - m0.pos[0], m.pos[1] - m0.pos[1], m.pos[2] - m0.pos[2]], rot: mul3(m.rot, transpose3(m0.rot)), shape: m.shape / m0.shape, explode: m.explode };
    }
    pos = [pos[0] + m.pos[0], pos[1] + m.pos[1], pos[2] + m.pos[2]];
    rot = mul3(m.rot, rot);
    shape *= m.shape;
    explode = Math.max(explode, m.explode || 0);
  });
  return { pos, rot, shape, explode };
}

// wide: the dome shows past the frame edge, so an edge may come a fifth of the way in (less crop, wider moves)
export function fitSeq(meta, shots, end, { frame = 1.02, steps = 48, fov = 50, wide = false } = {}) {
  return fitPath(meta, u => seqAt(shots, u * end, end), steps, wide ? 1.0 : frame, fov, wide ? 0.2 : 0);
}

export function camSeq(shots, T, end, fit) {
  const m = seqAt(shots, T, end);
  const z0 = m.explode > 0.01 && shots.length === 1 ? 1.0 : (fit ? fit.zoom0 : 1.06);
  return { pos: m.pos, rot: m.rot, zoom: z0 * m.shape, explode: m.explode };
}

export function camAt(move, t, opts = {}, fit = null) {
  const m = moveAt(move, t, opts);
  const z0 = move === "show_layers" ? (opts.frame ?? 1.0) : (fit ? fit.zoom0 : (opts.frame ?? 1.06));
  return { pos: m.pos, rot: m.rot, zoom: z0 * m.shape, explode: m.explode || 0 };
}
