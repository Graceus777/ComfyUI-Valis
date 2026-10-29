// Create's colour picker: a swatch's colour input is the one the browser's picker is open on, so it must be the same input through
// every change made in it (it used to be replaced by the first one, which ended the picker), while the name and the reset button
// beside the swatches follow the edit.
import {spawn} from "node:child_process";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {createRequire} from "node:module";

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const {chromium} = require("playwright");
const PORT = 8399, URL = `http://localhost:${PORT}/valis`;
const srv = spawn(process.execPath, [path.join(here, "mock_server.mjs"), String(PORT)], {stdio: ["ignore", "pipe", "inherit"]});
await new Promise(r => srv.stdout.once("data", r));
let pass = 0, fail = 0; const fails = [];
const ok = (c, name, d = "") => { if (c) pass++; else { fail++; fails.push(`${name}${d ? ": " + d : ""}`); } };
const browser = await chromium.launch();
const page = await browser.newPage({viewport: {width: 1440, height: 900}});
const errors = [];
page.on("pageerror", e => errors.push(e.message));
page.on("console", m => { if (m.type() === "error" && !/Failed to load resource|WebSocket/.test(m.text())) errors.push(m.text()); });
const bg = (n) => page.$eval(`#c-palette .sw.edit label:nth-child(${n})`, l => l.style.background);
const edit = (v, n = 1) => page.evaluate(([v, n]) => { const i = document.querySelector(`#c-palette .sw.edit label:nth-child(${n}) input`); i.value = v; i.dispatchEvent(new Event("input", {bubbles: true})); }, [v, n]);
page.setDefaultTimeout(5000); page.setDefaultNavigationTimeout(30000);
try {
  await page.goto(`${URL}#create`); await page.waitForTimeout(1500);
  await page.$$eval("#view-create details", ds => ds.forEach(d => { d.open = true; }));
  await page.evaluate(() => document.querySelector('#c-palette .pp-item[data-id="teal_orange"]').click());
  await page.waitForTimeout(200);
  const own = [await bg(1), await bg(2), await bg(3)];
  const name0 = await page.$eval("#c-palette .pp-cur b", b => b.textContent);
  ok(name0 === "Teal & orange", "a look is chosen", name0);
  await page.evaluate(() => { window.__in = document.querySelector("#c-palette .sw.edit label:nth-child(1) input"); });
  // a colour dragged in the browser's picker is a run of input events on the one input
  await edit("#aa0000");
  ok(await page.evaluate(() => window.__in.isConnected && window.__in === document.querySelector("#c-palette .sw.edit label:nth-child(1) input")), "after the first change the input is the same one", "");
  await edit("#00aa00"); await edit("#0000aa");
  ok(await page.evaluate(() => window.__in.isConnected && window.__in === document.querySelector("#c-palette .sw.edit label:nth-child(1) input") && window.__in.value === "#0000aa"), "and after more of them", "");
  ok(await bg(1) === "rgb(0, 0, 170)", "its swatch shows the last colour", await bg(1));
  ok(await bg(2) === own[1] && await bg(3) === own[2], "the other swatches are the look's own", `${await bg(2)} ${await bg(3)}`);
  ok(await page.$eval("#c-palette .pp-cur b", b => b.textContent) === `${name0} · your colours`, "the name says they are your colours", await page.$eval("#c-palette .pp-cur b", b => b.textContent));
  ok(await page.$$eval("#c-palette .pp-cur .linkbtn", bs => bs.map(b => b.textContent).join()) === "reset,custom", "the reset button is there once, beside custom", await page.$$eval("#c-palette .pp-cur .linkbtn", bs => bs.map(b => b.textContent).join()));
  // another swatch of the same look, edited, keeps the first edit
  await edit("#123456", 3);
  ok(await bg(1) === "rgb(0, 0, 170)" && await bg(3) === "rgb(18, 52, 86)", "a second swatch is edited beside the first", `${await bg(1)} ${await bg(3)}`);
  ok(await page.$$eval("#c-palette .pp-cur .linkbtn", bs => bs.length) === 2, "with no extra buttons");
  // reset
  await page.click('#c-palette .pp-cur .linkbtn:has-text("reset")'); await page.waitForTimeout(200);
  ok(await page.$eval("#c-palette .pp-cur b", b => b.textContent) === name0 && await bg(1) === own[0] && await bg(3) === own[2], "reset goes back to the look's own colours", `${await page.$eval("#c-palette .pp-cur b", b => b.textContent)} ${await bg(1)}`);
  ok(await page.$$eval("#c-palette .pp-cur .linkbtn", bs => bs.map(b => b.textContent).join()) === "custom", "and the reset button goes");
  // custom: its own colours, edited the same way
  await page.click('#c-palette .pp-cur .linkbtn:has-text("custom")'); await page.waitForTimeout(200);
  await page.evaluate(() => { window.__in = document.querySelector("#c-palette .sw.edit label:nth-child(2) input"); });
  await edit("#ff00ff", 2); await edit("#ffff00", 2);
  ok(await page.evaluate(() => window.__in.isConnected) && await bg(2) === "rgb(255, 255, 0)", "your own colours are edited the same way", await bg(2));
  ok(!errors.length, "no errors in the page", errors.slice(0, 5).join(" | "));
} finally {
  await browser.close(); srv.kill();
}
console.log(`${pass} passed, ${fail} failed`);
if (fail) { console.log(fails.join("\n")); process.exit(1); }
