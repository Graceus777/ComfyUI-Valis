// The genre cards' thumbnails: each genre's own words on one scene (Krea 2, 768x576).
//   node tools/genre_thumbs.mjs <out.json> [genre ...]   -> {genre id: graph}; the stills come out as output/valis_genres/<id>_*
// and are shrunk to app/assets/thumbs/<id>.jpg.
import {writeFileSync} from "node:fs";
import {GENRES} from "../app/js/presets.js";
import {keyframes} from "../app/js/graphs.js";
const SCENE = {thriller: "a detective in a raincoat stands at a rain-streaked window over the city", romance: "two lovers about to kiss by a sunlit window",
  period: "a woman in a long dress walks across the lawn of a grand house", scifi: "a lone pilot walks down the corridor of a vast starship",
  horror: "a figure stands at the end of a dark hallway in a quiet house", adventure: "an explorer climbs the steps of a ruined temple in the jungle",
  anime: "a swordswoman in a long coat stands on a hill above a valley at dusk, a train crossing far below"};
const [out, ...only] = process.argv.slice(2);
const jobs = {};
for (const g of GENRES.filter(g => SCENE[g.id] && (!only.length || only.includes(g.id))))
  jobs[g.id] = keyframes({prompt: `${g.style} Wide shot: ${SCENE[g.id]}.`, width: 768, height: 576, seeds: [7101], prefix: `valis_genres/${g.id}`});
writeFileSync(out, JSON.stringify(jobs));
console.log(Object.keys(jobs).length, "genres");
