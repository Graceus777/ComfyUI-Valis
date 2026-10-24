// The studio's UI, clicked through in a headless browser against the mock ComfyUI: every tab opens without an error,
// every section opens, every choice has a tooltip, the controls change what they say they change (the prompt, the
// size, the estimate), and a screenshot of each screen goes to tests/ui/screens/.
//
//   npm i -D playwright && npx playwright install chromium     (once)
//   node tests/ui/run.mjs [--object-info path] [--media dir] [--screens dir]
import {spawn} from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import {fileURLToPath} from "node:url";
import {createRequire} from "node:module";

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2), opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const require = createRequire(import.meta.url);
const {chromium} = require("playwright");
const PORT = 8288, URL = `http://localhost:${PORT}/valis`, SHOTS = opt("--screens", path.join(here, "screens"));
fs.mkdirSync(SHOTS, {recursive: true});
const srv = spawn(process.execPath, [path.join(here, "mock_server.mjs"), String(PORT), ...args.filter((a, i) => /^--(object-info|media)$/.test(args[i - 1]) || /^--(object-info|media)$/.test(a))], {stdio: ["ignore", "pipe", "inherit"]});
await new Promise(r => srv.stdout.once("data", r));
let pass = 0, fail = 0; const fails = [];
const ok = (c, name, d = "") => { if (c) pass++; else { fail++; fails.push(`${name}${d ? ": " + d : ""}`); } };
const browser = await chromium.launch();
const page = await browser.newPage({viewport: {width: 1440, height: 900}, deviceScaleFactor: 1});
const errors = [];
page.on("pageerror", e => errors.push(e.message));
page.on("console", m => { if (m.type() === "error" && !/Failed to load resource|WebSocket/.test(m.text())) errors.push(m.text()); });
const shot = async (name) => page.screenshot({path: path.join(SHOTS, `${name}.png`)});
try {
  await page.goto(`${URL}#create`); await page.waitForTimeout(1200);
  // ---- every tab opens
  for (const view of ["film", "create", "edit", "genjutsu", "score", "fx", "extras", "renders"]) {
    await page.click(`.tab[data-view="${view}"]`); await page.waitForTimeout(500);
    ok(await page.$(".view.on"), `${view} opens`);
    await shot(`tab_${view}`);
  }
  // ---- Create: sections open, choices change the prompt, size and length
  await page.click('.tab[data-view="create"]');
  await page.$$eval("#c-sections > details", ds => ds.forEach(d => { d.open = true; }));
  await page.fill("#c-subject", "a lighthouse keeper on the rocks"); await page.waitForTimeout(300);
  await page.click('#c-body .chip[data-id="imax"]'); await page.click('#c-kit .chip[data-id="fisheye"]'); await page.click('#c-era .chip[data-id="1950s"]');
  await page.waitForTimeout(300);
  const prompt = await page.$eval("#c-prompts", e => e.textContent);
  ok(/^KEYFRAME \(Krea 2\)\nIMAX 65mm/.test(prompt), "Create: the camera body leads the keyframe prompt", prompt.slice(0, 120));
  ok(/fisheye/i.test(prompt) && /1950s/.test(prompt), "Create: lens kit and era are in it");
  ok(/IMAX 65mm/.test(await page.$eval("#c-sec-camera summary", e => e.textContent)), "Create: the Camera section says what's chosen");
  // the palette: hover shows a preview, a click picks it, the swatches can be edited
  await page.$eval('.pp-group[data-g="Black & white"]', d => { d.open = true; });
  await page.hover('.pp-item[data-id="noir"]'); await page.waitForTimeout(400);
  ok(await page.$eval(".pp-plbl", e => /Noir/.test(e.textContent)), "Create: hovering a palette previews it");
  await page.click('.pp-item[data-id="noir"]'); await page.waitForTimeout(300);
  const p2 = await page.$eval("#c-prompts", e => e.textContent);
  ok(/^KEYFRAME \(Krea 2\)\nBlack-and-white film noir/.test(p2), "Create: a black-and-white look leads the prompt", p2.slice(0, 100));
  ok((await page.$$(".pp-cur .sw.edit input[type=color]")).length === 5, "Create: the chosen look has five editable colours");
  await page.$eval(".pp-cur .sw.edit input", (i) => { i.value = "#ff0000"; i.dispatchEvent(new Event("input", {bubbles: true})); });
  await page.waitForTimeout(300);
  ok(/your colours/.test(await page.$eval(".pp-cur b", e => e.textContent)), "Create: editing a colour makes it your colours");
  ok(/colour palette of/.test(await page.$eval("#c-prompts", e => e.textContent)), "Create: your colours are named in the prompt");
  // resolution and length
  await page.$eval("#c-res input[type=range]", (i) => { i.value = 384; i.dispatchEvent(new Event("input")); });
  await page.$eval("#c-len input[type=range]", (i) => { i.value = 3; i.dispatchEvent(new Event("input")); });
  await page.waitForTimeout(500);
  ok(/384×672/.test(await page.$eval("#c-res output", e => e.textContent)), "Create: the resolution slider sizes the shot");
  ok(/73 frames/.test(await page.$eval("#c-len output", e => e.textContent)), "Create: the length snaps to H3's frame grid");
  ok(/384×672 · 3\.0 s/.test(await page.$eval("#c-shoot-sub", e => e.textContent)), "Create: the Shoot button says what it will make", await page.$eval("#c-shoot-sub", e => e.textContent));
  ok(/~/.test(await page.$eval("#c-frame-sub", e => e.textContent)), "Create: Frame it has an estimate");
  await shot("create_open");
  // tooltips: every chip, card and palette has one
  const untipped = await page.$$eval("#c-sections .chip, #c-sections .card, .pp-item", els => els.filter(e => !e.dataset.tip).map(e => e.textContent.trim()));
  ok(!untipped.length, "Create: every choice has a tooltip", untipped.slice(0, 8).join(", "));
  await page.hover('#c-move .chip[data-id="orbit_360"]'); await page.waitForTimeout(600);
  ok(await page.$eval(".tipbox", e => e.classList.contains("on") && /trained move/i.test(e.textContent)), "Create: a tooltip shows on hover");
  await shot("create_tooltip");
  // ---- Film: steps are there before a plan, and say so
  await page.click('.tab[data-view="film"]'); await page.waitForTimeout(300);
  ok(/Plan the film first/.test(await page.$eval("#m-steps", e => e.textContent)), "Film: nothing renders before the plan");
  // ---- Score: the example loads and plays the timeline; a source can be picked
  await page.click('.tab[data-view="score"]'); await page.click('#s-source button[data-id="demo"]');
  await page.waitForFunction(() => /danse/i.test(document.querySelector("#s-info")?.textContent || ""), null, {timeout: 8000}).catch(() => {});
  ok(/danse/i.test(await page.$eval("#s-info", e => e.textContent)), "Score: the example loads");
  ok((await page.$$("#s-shots .shotrow")).length > 5, "Score: its shots are listed");
  ok((await page.$$("#s-map .rule")).length > 3, "Score: its rules are listed");
  await shot("score_example");
  await page.click('#s-source button[data-id="song"]'); await page.waitForTimeout(300);
  ok(await page.$("#s-song"), "Score: From a song asks for a song");
  // ---- Extras: the three modes
  await page.click('.tab[data-view="extras"]');
  for (const m of ["stereo", "loop", "stage"]) {
    await page.click(`.view.on .seg.xmode button[data-id="${m}"]`); await page.waitForTimeout(600);
    ok(await page.$(`#view-extras-${m}.on`), `Extras: ${m} opens`);
    await shot(`extras_${m}`);
  }
  // ---- Renders: the machine panel
  await page.click('.tab[data-view="renders"]'); await page.waitForTimeout(800);
  ok(/RTX 4080/.test(await page.$eval("#r-machine", e => e.textContent)), "Renders: the machine is read");
  ok(/Safe shot size/.test(await page.$eval("#r-machine", e => e.textContent)), "Renders: a safe shot size is advised");
  // ---- the bin opens
  await page.click("#binBtn"); await page.waitForTimeout(400);
  ok(await page.$("body.binopen"), "the bin opens");
  await shot("bin");
  ok(!errors.length, "no errors in the page", errors.slice(0, 5).join(" | "));
} finally {
  await browser.close(); srv.kill();
}
console.log(`${pass} passed, ${fail} failed. Screens in ${SHOTS}`);
if (fail) { console.log(fails.join("\n")); process.exit(1); }
