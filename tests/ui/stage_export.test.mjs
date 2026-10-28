// Stage's MP4 export: when a frame doesn't upload, the studio tells ComfyUI to drop the export (its open video and half-written
// file used to stay for the life of the server), and a good export doesn't. A stand-in ComfyUI and routes that fail on demand.
import {spawn} from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import zlib from "node:zlib";
import {fileURLToPath} from "node:url";
import {createRequire} from "node:module";

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const {chromium} = require("playwright");
const PORT = 8393, URL = `http://localhost:${PORT}/valis`;
const MEDIA = fs.mkdtempSync(path.join(os.tmpdir(), "valis-media-"));
const dir = path.join(MEDIA, "valis", "stage", "t1"); fs.mkdirSync(dir, {recursive: true});
const png = (w, h, px) => {                                       // a PNG, with no library
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const o = y * (w * 4 + 1) + 1 + x * 4, p = px(x, y); raw[o] = p[0]; raw[o + 1] = p[1]; raw[o + 2] = p[2]; raw[o + 3] = p[3]; }
  const chunk = (t, d) => { const b = Buffer.alloc(12 + d.length); b.writeUInt32BE(d.length, 0); b.write(t, 4, "latin1"); d.copy(b, 8); b.writeUInt32BE(zlib.crc32(Buffer.concat([Buffer.from(t, "latin1"), d])) >>> 0, 8 + d.length); return b; };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
};
const W = 64, H = 48;
const layers = [{name: "sky", image: "layer_00.png", depth: "depth_00.png", z_med: 50, area: 1, bbox: [0, 0, W - 1, H - 1], backdrop: true},
  {name: "front", image: "layer_01.png", depth: "depth_01.png", z_med: 5, area: .3, bbox: [20, 14, 44, 34], backdrop: false}];
fs.writeFileSync(path.join(dir, "stage.json"), JSON.stringify({width: W, height: H, far: 100, layers, source: "test"}));
layers.forEach((L, i) => {
  fs.writeFileSync(path.join(dir, L.image), png(W, H, (x, y) => i ? (x > 20 && x < 44 && y > 14 && y < 34 ? [200, 60, 60, 255] : [0, 0, 0, 0]) : [90, 120, 160, 255]));
  fs.writeFileSync(path.join(dir, L.depth), png(W, H, () => i ? [3, 0, 0, 255] : [200, 0, 0, 255]));
});
const srv = spawn(process.execPath, [path.join(here, "mock_server.mjs"), String(PORT), "--media", MEDIA], {stdio: ["ignore", "pipe", "inherit"]});
await new Promise(r => srv.stdout.once("data", r));
let pass = 0, fail = 0; const fails = [];
const ok = (c, name, d = "") => { if (c) pass++; else { fail++; fails.push(`${name}${d ? ": " + d : ""}`); } };
const browser = await chromium.launch({args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"]});
const ctx = await browser.newContext({viewport: {width: 1440, height: 900}});
await ctx.addInitScript(() => { try { localStorage.setItem("valis.extras", "stage"); } catch { /* */ } });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", e => errors.push(e.message));
page.on("console", m => { if (m.type() === "error" && !/Failed to load resource|WebSocket|status of 500|status of 404/.test(m.text())) errors.push(m.text()); });
const calls = {begin: [], raw: 0, frame: 0, finish: 0, abort: []};
const mode = {rawFailsAt: 0, begin404: false, frameFailsAt: 0};
const json = (route, body, status = 200) => route.fulfill({status, contentType: "application/json", body: JSON.stringify(body)});
await page.route("**/valis/stage/list", r => json(r, {stages: [{name: "t1", subfolder: "valis/stage/t1", layers: 2, names: ["sky", "front"]}]}));
await page.route("**/valis/stage/begin", r => { calls.begin.push(JSON.parse(r.request().postData())); return mode.begin404 ? r.fulfill({status: 404, body: "no"}) : json(r, {ok: true, filename: "move.mp4"}); });
await page.route("**/valis/stage/raw**", r => { calls.raw++; return mode.rawFailsAt && calls.raw === mode.rawFailsAt ? r.fulfill({status: 500, body: "boom"}) : json(r, {ok: true, n: calls.raw}); });
await page.route("**/valis/stage/frame**", r => { calls.frame++; return mode.frameFailsAt && calls.frame === mode.frameFailsAt ? r.fulfill({status: 500, body: "boom"}) : json(r, {ok: true}); });
await page.route("**/valis/stage/finish", r => { calls.finish++; return json(r, {filename: "move.mp4", subfolder: "valis/stage", frames: 2}); });
await page.route("**/valis/stage/encode", r => json(r, {filename: "move.mp4", subfolder: "valis/stage", frames: 2}));
await page.route("**/valis/stage/abort", r => { calls.abort.push(JSON.parse(r.request().postData())); return json(r, {ok: true, dropped: true}); });
const reset = () => { calls.begin.length = 0; calls.abort.length = 0; calls.raw = calls.frame = calls.finish = 0; mode.rawFailsAt = mode.frameFailsAt = 0; mode.begin404 = false; };
const run = async (sec) => {
  await page.evaluate((s) => { window.valisStage.S.sec = s; }, sec);
  await page.click("#st-export");
  await page.waitForFunction(() => !document.querySelector("#st-export").disabled, null, {timeout: 20000});
  await page.waitForTimeout(400);
};
try {
  await page.goto(`${URL}#extras`); await page.waitForTimeout(1500);
  await page.click('.tab[data-view="extras"]'); await page.waitForTimeout(800);
  await page.selectOption("#sg-open", "valis/stage/t1");
  await page.waitForFunction(() => document.querySelector("#st-canvas")?.style.display === "block", null, {timeout: 15000}).catch(() => {});
  const loaded = await page.evaluate(() => document.querySelector("#st-canvas")?.style.display === "block");
  ok(loaded, "the stage opened (WebGL2 in this browser)");
  if (loaded) {
    // a good export: no abort
    reset(); await run(.1);
    ok(calls.begin.length === 1 && calls.raw === 2 && calls.finish === 1 && calls.abort.length === 0, "a finished export is not aborted", JSON.stringify({b: calls.begin.length, raw: calls.raw, fin: calls.finish, ab: calls.abort}));
    // a frame that doesn't upload: dropped on the server, and no more frames sent
    reset(); mode.rawFailsAt = 3; await run(1);
    ok(calls.raw === 3, "a failed frame stops the export", String(calls.raw));
    ok(calls.abort.length === 1 && calls.abort[0].job === calls.begin[0]?.job && /^x\d+$/.test(calls.abort[0].job), "a failed frame tells the server to drop that job", JSON.stringify({a: calls.abort, b: calls.begin.map(b => b.job)}));
    ok(calls.finish === 0, "and the export is not finished");
    ok(await page.$eval("#st-export", b => !b.disabled && /Export MP4/.test(b.textContent)), "the button is back");
    // the JPEG fallback (a pack loaded before the raw route): a failed frame is dropped too, a good one isn't
    reset(); mode.begin404 = true; mode.frameFailsAt = 2; await run(1);
    ok(calls.frame === 2 && calls.abort.length === 1, "the jpeg export drops the job when a frame fails", JSON.stringify({f: calls.frame, a: calls.abort}));
    reset(); mode.begin404 = true; await run(.1);
    ok(calls.abort.length === 0, "and not when it finishes", JSON.stringify(calls.abort));
  }
  ok(!errors.length, "no errors in the page", errors.slice(0, 5).join(" | "));
} finally {
  await browser.close(); srv.kill();
}
console.log(`${pass} passed, ${fail} failed`);
if (fail) { console.log(fails.join("\n")); process.exit(1); }
