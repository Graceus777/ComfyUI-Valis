// Each library effect's default preset as the preview renderer takes it: node tools/fx_preview_spec.mjs > spec.json
import {LIBRARY, fxPreset} from "../app/js/graphs.js";
const out = {};
for (const l of LIBRARY) { const f = fxPreset(l.id); out[l.id] = {params: f.params, on: f.on, by: f.by}; }
console.log(JSON.stringify(out, null, 1));
