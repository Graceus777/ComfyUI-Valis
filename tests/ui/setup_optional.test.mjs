// The full-quality shot (H3 int8, 30 steps) is an extra: its model is a separate download and the 8-step shot is what the
// studio shoots with. Setup and the shot card only offer it on a machine that has the file, so a fresh machine isn't shown a
// "model file not found" for something it never asked for, nor a box that can only fail.
import {spawn} from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import {fileURLToPath} from "node:url";
import {createRequire} from "node:module";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.join(here, "..", "..");
const require = createRequire(import.meta.url);
const {chromium} = require("playwright");
const FULL = "minimax_h3_fl2va_pruned_int8_convrot.safetensors";
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "valis-setup-"));
const oi = JSON.parse(fs.readFileSync(path.join(repo, "tests", "fixtures", "object_info.json"), "utf8"));
const unets = oi.UNETLoader.input.required.unet_name[0];
const withFull = path.join(TMP, "object_info_full.json");
fs.writeFileSync(withFull, JSON.stringify({...oi, UNETLoader: {...oi.UNETLoader, input: {...oi.UNETLoader.input, required: {...oi.UNETLoader.input.required, unet_name: [[...unets, FULL]]}}}}));
let pass = 0, fail = 0; const fails = [];
const ok = (c, name, d = "") => { if (c) pass++; else { fail++; fails.push(`${name}${d ? ": " + d : ""}`); } };
const start = async (port, extra) => {
  const user = fs.mkdtempSync(path.join(TMP, "user-"));
  const srv = spawn(process.execPath, [path.join(here, "mock_server.mjs"), String(port), "--user", user, ...extra], {stdio: ["ignore", "pipe", "inherit"]});
  await new Promise(r => srv.stdout.once("data", r));
  return {srv, user, url: `http://localhost:${port}/valis`};
};
const A = await start(8401, []), B = await start(8402, ["--object-info", withFull]);
const browser = await chromium.launch();
const errors = [];
const look = async (s) => {
  const page = await browser.newPage({viewport: {width: 1440, height: 900}});
  page.on("pageerror", e => errors.push(e.message));
  page.on("console", m => { if (m.type() === "error" && !/Failed to load resource|WebSocket/.test(m.text())) errors.push(m.text()); });
  page.setDefaultNavigationTimeout(30000);
  await page.goto(`${s.url}#renders`); await page.waitForTimeout(2000);
  const setup = await page.$eval("#r-setup", e => e.textContent);
  const pill = await page.$eval("#setupPill", e => ({text: e.textContent, tip: e.dataset.tip || ""}));
  const count = Number((await page.$eval("#r-setup .setok summary", e => e.textContent).catch(() => "")).match(/\d+/)?.[0] || 0);
  await page.click('.tab[data-view="film"]'); await page.waitForTimeout(400);
  await page.click("#m-blank"); await page.waitForTimeout(600);
  const boxes = await page.$$eval("#view-film label.bkind", ls => ls.filter(l => /full quality/.test(l.textContent)).map(l => ({off: l.querySelector("input").disabled, tip: l.dataset.tip || ""})));
  return {page, setup, pill, count, boxes};
};
try {
  const a = await look(A), b = await look(B);
  // ---- a machine without the full-quality model (as most are): nothing about it in Setup, and the box can't be ticked
  ok(a.pill.text === "setup ready", "no model: Setup still reads ready", a.pill.text);
  ok(!/full quality/.test(a.setup), "no model: Setup doesn't list the full-quality shot", a.setup.slice(0, 200));
  ok(!/model file not found: minimax_h3_fl2va_pruned_int8/.test(a.setup), "no model: Setup doesn't say its file is not found");
  ok(!/optional/i.test(a.setup) && !/optional/i.test(a.pill.tip), "no model: nothing is called optional or not installed", a.pill.tip);
  ok(a.boxes.length > 0, "no model: the shot cards are there", String(a.boxes.length));
  ok(a.boxes.every(x => x.off), "no model: the full-quality box is off on every shot", JSON.stringify(a.boxes));
  ok(a.boxes.every(x => x.tip.includes(FULL)), "no model: its tip names the file it needs", a.boxes[0]?.tip);
  // ---- a machine with it: the row is checked like any other and the box can be ticked
  ok(b.pill.text === "setup ready", "model: Setup reads ready", b.pill.text);
  ok(/full quality/.test(b.setup), "model: Setup lists the full-quality shot", b.setup.slice(0, 200));
  ok(b.count === a.count + 1, "model: it is one more workflow checked", `${a.count} -> ${b.count}`);
  ok(b.boxes.length > 0 && b.boxes.every(x => !x.off), "model: the full-quality box can be ticked", JSON.stringify(b.boxes));
  // ---- a shot already saved as full quality keeps a box you can untick, model or not
  const dir = path.join(A.user, "valis/films"), f = fs.readdirSync(dir).find(n => n.endsWith(".json")), tag = f?.replace(/\.json$/, "");
  const plan = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
  plan.shots[0].full = true;
  fs.writeFileSync(path.join(dir, f), JSON.stringify(plan));
  await a.page.reload(); await a.page.waitForTimeout(1500);
  await a.page.click('.tab[data-view="film"]'); await a.page.waitForTimeout(400);
  await a.page.click(`#m-recent .chip`); await a.page.waitForTimeout(1200);
  const kept = await a.page.$$eval("#view-film label.bkind", ls => ls.filter(l => /full quality/.test(l.textContent)).map(l => ({on: l.querySelector("input").checked, off: l.querySelector("input").disabled})));
  ok(kept[0]?.on && !kept[0].off, "a shot saved as full quality keeps its box ticked and usable", JSON.stringify(kept));
  ok(kept.slice(1).every(x => x.off), "(the others stay off)", JSON.stringify(kept));
  ok(!errors.length, "no errors in the page", errors.slice(0, 5).join(" | "));
} finally {
  await browser.close(); A.srv.kill(); B.srv.kill();
}
console.log(`${pass} passed, ${fail} failed`);
if (fail) { console.log(fails.join("\n")); process.exit(1); }
