// The Film tab's groundwork cards: renaming a character (or a prop) follows into every frame that calls them by that name,
// the "gone" lists included, and a setup named with a colon ("kitchen: night") can be picked for a frame.
import {spawn} from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import {fileURLToPath} from "node:url";
import {createRequire} from "node:module";

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const {chromium} = require("playwright");
const PORT = 8398, URL = `http://localhost:${PORT}/valis`;
const USER = fs.mkdtempSync(path.join(os.tmpdir(), "valis-user-"));
const srv = spawn(process.execPath, [path.join(here, "mock_server.mjs"), String(PORT), "--user", USER], {stdio: ["ignore", "pipe", "inherit"]});
await new Promise(r => srv.stdout.once("data", r));
let pass = 0, fail = 0; const fails = [];
const ok = (c, name, d = "") => { if (c) pass++; else { fail++; fails.push(`${name}${d ? ": " + d : ""}`); } };
const dir = path.join(USER, "valis/films");
const films = () => Object.fromEntries((fs.existsSync(dir) ? fs.readdirSync(dir) : []).map(f => [f.replace(/\.json$/, ""), JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"))]));
const byTitle = (t) => Object.entries(films()).find(([, f]) => f.title === t);
const browser = await chromium.launch();
const page = await browser.newPage({viewport: {width: 1440, height: 900}});
const errors = [];
page.on("pageerror", e => errors.push(e.message));
page.on("console", m => { if (m.type() === "error" && !/Failed to load resource|WebSocket/.test(m.text())) errors.push(m.text()); });
const toFilm = async () => { await page.click('.tab[data-view="film"]'); await page.waitForTimeout(400); };
const open = async (t) => { await page.click(`#m-recent .chip:has-text("${t}")`); await page.waitForTimeout(900); };
const rename = async (sel, to) => { await page.fill(sel, to); await page.$eval(sel, e => e.dispatchEvent(new Event("change", {bubbles: true}))); await page.waitForTimeout(900); };
try {
  await page.goto(`${URL}#film`); await page.waitForTimeout(1200); await toFilm();
  await page.click("#m-blank"); await page.waitForTimeout(150);
  await page.fill("#m-planbox .ptitle input.title", "Names"); await page.waitForTimeout(900);
  // a film with two people, two setups (one named with a colon) and three frames, the later ones telling who has gone
  const [tag, f0] = byTitle("Names");
  fs.writeFileSync(path.join(dir, `${tag}.json`), JSON.stringify({...f0,
    cast: [{name: "Anna", look: "a"}, {name: "Ben", look: "b"}],
    setups: [{name: "kitchen: night", view: "a view"}, {name: "yard", view: "another"}],
    frames: [{name: "f1", setup: "kitchen: night", with: ["Anna", "Ben"], seat: "s"}, {name: "f2", from: "f1", with: [], gone: ["Ben"], edit: "e"}, {name: "f3", from: "f2", with: [], gone: ["Ben", "Anna"], edit: "e"}]}));
  await page.reload(); await page.waitForTimeout(1200); await toFilm(); await open("Names");
  ok(await page.$$eval("#m-build .bcard", c => c.length) === 7, "the cards drew: 2 people, 2 setups, 3 frames", String(await page.$$eval("#m-build .bcard", c => c.length)));

  // ---- a rename follows into every frame's "gone" list
  await rename("#m-build .bsec:nth-child(1) .bcard:nth-child(2) input.bname", "Bob");
  let p = films()[tag];
  ok(p.cast[1].name === "Bob", "the character was renamed", JSON.stringify(p.cast.map(c => c.name)));
  ok(JSON.stringify(p.frames[0].with) === '["Anna","Bob"]', "the frame that seats them follows", JSON.stringify(p.frames[0].with));
  ok(JSON.stringify(p.frames[1].gone) === '["Bob"]', "a frame that says they have gone follows", JSON.stringify(p.frames[1].gone));
  ok(JSON.stringify(p.frames[2].gone) === '["Bob","Anna"]', "and so does a later one, with the others in it", JSON.stringify(p.frames[2].gone));
  ok(await page.$$eval("#m-build .bgone .chip.on", cs => cs.map(c => c.textContent).join()) === "Bob,Anna,Bob", "the chips on screen name them as Bob (frame 2: Bob; frame 3: Anna, Bob)", await page.$$eval("#m-build .bgone .chip.on", cs => cs.map(c => c.textContent).join()));

  // ---- a setup named with a colon can be picked
  await page.reload(); await page.waitForTimeout(1200); await toFilm(); await open("Names");
  const sel = "#m-build .bsec:nth-child(3) .bcard:nth-child(1) select";
  ok(await page.$eval(sel, s => s.selectedOptions[0]?.textContent) === "seated in the kitchen: night", "the frame shows the setup it is in", await page.$eval(sel, s => s.selectedOptions[0]?.textContent));
  await page.selectOption(sel, "setup:yard"); await page.waitForTimeout(900);
  ok(films()[tag].frames[0].setup === "yard", "another setup is picked", String(films()[tag].frames[0].setup));
  await page.selectOption(sel, "setup:kitchen: night"); await page.waitForTimeout(900);
  p = films()[tag];
  ok(p.frames[0].setup === "kitchen: night" && !p.frames[0].from, "a setup with a colon in its name is picked whole", JSON.stringify({setup: p.frames[0].setup, from: p.frames[0].from}));
  ok(await page.$eval(sel, s => s.selectedOptions[0]?.textContent) === "seated in the kitchen: night", "and the card shows it", await page.$eval(sel, s => s.selectedOptions[0]?.textContent));
  // a frame named with a colon can be the one another frame is a change of
  await rename("#m-build .bsec:nth-child(3) .bcard:nth-child(2) input.bname", "scene 2: dusk");
  const sel3 = "#m-build .bsec:nth-child(3) .bcard:nth-child(3) select";
  await page.selectOption(sel3, "from:f1"); await page.waitForTimeout(900);
  await page.selectOption(sel3, "from:scene 2: dusk"); await page.waitForTimeout(900);
  p = films()[tag];
  ok(p.frames[2].from === "scene 2: dusk" && !p.frames[2].setup, "a frame with a colon in its name can be the one a frame changes", JSON.stringify({from: p.frames[2].from, setup: p.frames[2].setup}));
  ok(!errors.length, "no errors in the page", errors.slice(0, 5).join(" | "));
} finally {
  await browser.close(); srv.kill();
}
console.log(`${pass} passed, ${fail} failed`);
if (fail) { console.log(fails.join("\n")); process.exit(1); }
