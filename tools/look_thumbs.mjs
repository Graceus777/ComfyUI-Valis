// The Edit tab's look thumbnails: every look made on one of three SÉANCE costume-test sheets by the Transform's own
// first step (graphs.js lookStill), so the picker shows what each look does to a person.
//   node tools/look_thumbs.mjs <out.json> [look ...]     -> {look id: graph}; queue them in ComfyUI (POST /prompt each)
// Faithfulness is capped at 2 for the thumbnail: the looks made for clothing (fire, chrome) keep a whole person too
// well at their own setting to show anything. They are made at 0.45 MP (the card is 320 px): about half the time of the Transform's 1 MP.
// The bases are ComfyUI input files: valis_presets/base_{man,woman,medium}.png (head to waist, square). The stills come
// out as output/valis_looks/<id>_00001_.png; shrink them to app/assets/thumbs/looks/<id>.jpg (320 px).
import {writeFileSync} from "node:fs";
import {LOOKS} from "../app/js/presets.js";
import {lookStill} from "../app/js/graphs.js";

const WOMAN = ["bride", "ghost", "drowned", "angel", "elf", "porcelain", "ice", "flowers", "cosmos", "victorian", "hologram", "biolum", "crystal"];
const MEDIUM = ["overgrown", "royal", "gold", "soaked", "runes", "lightning"];
const base = (id) => WOMAN.includes(id) ? "woman" : MEDIUM.includes(id) ? "medium" : "man";
const who = {man: "the man", woman: "the woman", medium: "the woman"};
const [out, ...only] = process.argv.slice(2);
const jobs = {};
for (const l of LOOKS.filter(l => !only.length || only.includes(l.id))) {
  const b = base(l.id);
  jobs[l.id] = lookStill({image: `valis_presets/base_${b}.png`, prompt: l.anchor.replaceAll("{T}", who[b]), refBoost: Math.min(l.rb, 2.0), seed: 31, prefix: `valis_looks/${l.id}`, megapixels: .45});
}
writeFileSync(out, JSON.stringify(jobs));
console.log(Object.keys(jobs).length, "looks");
