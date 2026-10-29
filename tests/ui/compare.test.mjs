// The before/after divider (ui.js compare): the drag follows the pointer even outside the picture and ends when it is let go, and
// no window listener is added for it (each compare added two that were never removed, one pair for every result shown).
import {spawn} from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import {fileURLToPath} from "node:url";
import {createRequire} from "node:module";

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const {chromium} = require("playwright");
const PORT = 8395, URL = `http://localhost:${PORT}/valis`;
const USER = fs.mkdtempSync(path.join(os.tmpdir(), "valis-user-"));
const srv = spawn(process.execPath, [path.join(here, "mock_server.mjs"), String(PORT), "--user", USER], {stdio: ["ignore", "pipe", "inherit"]});
await new Promise(r => srv.stdout.once("data", r));
let pass = 0, fail = 0; const fails = [];
const ok = (c, name, d = "") => { if (c) pass++; else { fail++; fails.push(`${name}${d ? ": " + d : ""}`); } };
const browser = await chromium.launch();
const page = await browser.newPage({viewport: {width: 1200, height: 800}});
const errors = [];
page.on("pageerror", e => errors.push(e.message));
page.on("console", m => { if (m.type() === "error" && !/Failed to load resource|WebSocket/.test(m.text())) errors.push(m.text()); });
// count what is added to the window (before the studio loads)
await page.addInitScript(() => {
  window.__added = {};
  const add = window.addEventListener.bind(window);
  window.addEventListener = (type, ...rest) => { window.__added[type] = (window.__added[type] || 0) + 1; return add(type, ...rest); };
});
try {
  await page.goto(`${URL}#film`); await page.waitForTimeout(1200);
  const before = await page.evaluate(() => ({...window.__added}));
  const cut = () => page.$eval("#cmp", e => e.style.getPropertyValue("--cut"));
  await page.evaluate(async () => {
    const {compare} = await import("/valis/app/js/ui.js");
    for (let i = 0; i < 6; i++) { const w = compare("a.mp4", "b.mp4"); if (i === 5) { w.id = "cmp"; w.style.cssText = "position:fixed;left:200px;top:100px;width:400px;height:300px;background:#222;z-index:99999"; document.body.append(w); } }
  });
  const after = await page.evaluate(() => ({...window.__added}));
  ok((after.pointermove || 0) === (before.pointermove || 0) && (after.pointerup || 0) === (before.pointerup || 0), "six compares add no window listeners for the drag", JSON.stringify({before: before.pointermove, after: after.pointermove}));
  // press at a third of the way, drag out past the right edge, then let go and move: the divider follows only while held
  await page.mouse.move(300, 200); await page.mouse.down();
  ok(Math.abs(parseFloat(await cut()) - 25) < 1, "pressing sets the divider (25%)", await cut());
  await page.mouse.move(450, 220);
  ok(Math.abs(parseFloat(await cut()) - 62.5) < 1, "dragging moves it (62.5%)", await cut());
  await page.mouse.move(900, 600);
  ok(parseFloat(await cut()) === 100, "dragging out past the picture holds it at the edge (100%)", await cut());
  await page.mouse.move(250, 650);
  ok(Math.abs(parseFloat(await cut()) - 12.5) < 1, "and it follows back in from outside (12.5%)", await cut());
  await page.mouse.up();
  await page.mouse.move(500, 200);
  ok(Math.abs(parseFloat(await cut()) - 12.5) < 1, "after letting go it stays where it was", await cut());
  await page.mouse.move(400, 200); await page.mouse.move(500, 200);
  ok(Math.abs(parseFloat(await cut()) - 12.5) < 1, "and moving over it does not drag it", await cut());
  ok(!errors.length, "no errors in the page", errors.slice(0, 5).join(" | "));
} finally {
  await browser.close(); srv.kill();
}
console.log(`${pass} passed, ${fail} failed`);
if (fail) { console.log(fails.join("\n")); process.exit(1); }
