// A Valis score you open is someone else's file: its title, meter, bars, key, lane, section and shot names are shown as
// text, never run as HTML (a shared score used to run script in the studio's page, where it can queue jobs and write files).
import {spawn} from "node:child_process";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {createRequire} from "node:module";

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const {chromium} = require("playwright");
const PORT = 8392, URL = `http://localhost:${PORT}/valis`;
const srv = spawn(process.execPath, [path.join(here, "mock_server.mjs"), String(PORT)], {stdio: ["ignore", "pipe", "inherit"]});
await new Promise(r => srv.stdout.once("data", r));
let pass = 0, fail = 0; const fails = [];
const ok = (c, name, d = "") => { if (c) pass++; else { fail++; fails.push(`${name}${d ? ": " + d : ""}`); } };
const browser = await chromium.launch();
const page = await browser.newPage({viewport: {width: 1440, height: 900}});
const errors = [];
page.on("pageerror", e => errors.push(e.message));
page.on("console", m => { if (m.type() === "error" && !/Failed to load resource|WebSocket/.test(m.text())) errors.push(m.text()); });
const PWN = '<img src=x onerror="window.__pwn=(window.__pwn||0)+1">';
const score = {valis_score: 1, title: PWN, made_by: "test", source: PWN, meter: PWN, bpm: 100, bars: PWN, duration_seconds: 8, fps: 24, key: PWN,
  bar_seconds: 1.8, beat_seconds: .6, bpm_unit: 4,
  events: {kick: [0.5, 1.5, 2.5], bar: [0, 1.8, 3.6, 5.4], beat: [0, .6, 1.2], [PWN]: [1, 2]}, velocities: {}, envelopes: {},
  sections: [{name: PWN, start: 0, end: 8}], shots: [{id: "s01", name: PWN, start_bar: 0, start_frame: 0, frames: 86}]};
try {
  await page.goto(`${URL}#score`); await page.waitForTimeout(1200);
  await page.click('.tab[data-view="score"]'); await page.waitForTimeout(300);
  await page.click('#s-source button[data-id="open"]'); await page.waitForTimeout(200);
  await page.setInputFiles("#s-drop input[type=file]", {name: "shared.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(score))});
  await page.waitForTimeout(1500);
  await page.$$eval("#view-score details", ds => ds.forEach(d => { d.open = true; }));
  await page.waitForTimeout(300);
  ok(await page.$eval("#s-info b", e => e.textContent) === PWN, "#12: the title is shown as the text it is", await page.$eval("#s-info", e => e.innerHTML));
  ok((await page.$eval("#s-info", e => e.textContent)).includes(PWN + " bars"), "#12: and so are the bars", await page.$eval("#s-info", e => e.textContent));
  ok(await page.$$eval("#view-score img", els => els.filter(i => i.getAttribute("src") === "x").length) === 0, "#12: no element came out of the score's text");
  ok(await page.$$eval("#s-info *", els => els.map(e => e.tagName).join(",")) === "B,BR", "#12: the info line is a bold title and a break", await page.$eval("#s-info", e => e.innerHTML));
  ok(await page.evaluate(() => window.__pwn) === undefined, "#12: no script ran");
  // the same file again, after the tooltips had their pause: still nothing
  await page.hover("#s-info"); await page.waitForTimeout(600);
  await page.hover("#s-map select"); await page.waitForTimeout(600);
  ok(await page.evaluate(() => window.__pwn) === undefined, "#12: no script ran after hovering the score's controls");
  ok(await page.$eval("#s-tempo", (e, p) => e.textContent.includes(p), PWN), "#12: the tempo line shows the meter and key as text");
  ok(!errors.length, "no errors in the page", errors.slice(0, 5).join(" | "));
} finally {
  await browser.close(); srv.kill();
}
console.log(`${pass} passed, ${fail} failed`);
if (fail) { console.log(fails.join("\n")); process.exit(1); }
