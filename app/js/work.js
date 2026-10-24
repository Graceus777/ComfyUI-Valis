// What a graph is, for the time estimates: its kind (the heaviest model in it) and how much work it is
// (pixels x frames x steps). No browser APIs, so the tests can use it too.
const num = (v, d = 0) => typeof v === "number" ? v : d;
// graph -> {kind, work, label} (the heaviest thing in it decides the kind)
export function workOf(graph) {
  const nodes = Object.values(graph || {}), find = (t) => nodes.filter(n => n.class_type === t);
  const steps = () => { const s = nodes.find(n => n.class_type === "BasicScheduler")?.inputs?.steps; const acc = nodes.find(n => /PDDAcc/.test(n.class_type)); return acc ? 8 : num(s, 8); };
  // sizes wired from another node (a crop, a megapixel budget) aren't known until it runs: half a megapixel, 121 frames
  const mpf = (n, lenKey = "length") => {
    const w = num(n.inputs.width), hh = num(n.inputs.height), len = num(n.inputs[lenKey], 121);
    return (w && hh ? w * hh / 1e6 : .5) * len;
  };
  const loop = find("MiniMaxH3Loop")[0];
  const r2v = find("MiniMaxH3ReferenceToVideo"), i2v = find("MiniMaxH3ImageToVideo"), wan = find("WanImageToVideo");
  if (loop && r2v.length) return {kind: "loop", work: mpf(r2v[0]) * steps() / 8 * num(loop.inputs.views, 1)};
  if (i2v.length) return {kind: "h3", work: i2v.reduce((a, n) => a + mpf(n), 0) * steps() / 8};
  if (r2v.length) return {kind: "h3ref", work: r2v.reduce((a, n) => a + mpf(n), 0) * steps() / 8};
  if (wan.length) return {kind: "wan", work: wan.reduce((a, n) => a + mpf(n), 0) * num(nodes.find(n => n.class_type === "KSamplerAdvanced")?.inputs?.steps, 4) / 4};
  const seed = nodes.find(n => /SeedVR2/i.test(n.class_type));
  if (seed) return {kind: "seedvr2", work: 1.0 * 120};          // refined when the clip length is known (finish bar)
  const yue = find("YuE2GenerateMusic")[0];
  if (yue) return {kind: "yue2", work: num(yue.inputs.max_duration, 30)};
  if (find("TextGenerate").length || nodes.some(n => /TextGenerate|Qwen3.*Generate/i.test(n.class_type))) return {kind: "llm", work: 1};
  const lat = find("EmptySD3LatentImage")[0];
  if (lat) { const ks = find("KSampler").length || 1; return {kind: "krea", work: num(lat.inputs.width) * num(lat.inputs.height) / 1e6 * ks}; }
  const q = find("TextEncodeQwenImage21").length;
  if (q) return {kind: "qwen", work: q};
  if (find("SAM3_VideoTrack").length && !nodes.some(n => /^Valis(FX|Render)$/.test(n.class_type))) return {kind: "sam3", work: 120};
  if (nodes.some(n => /^Valis(FX|Render|LoopRender)$/.test(n.class_type))) return {kind: "valis", work: .5 * 120};
  return {kind: "other", work: 1};
}

