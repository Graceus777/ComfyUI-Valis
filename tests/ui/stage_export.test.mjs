// Stage's MP4 export: when a frame doesn't upload, the studio tells ComfyUI to drop the export (its open video and half-written
// file used to stay for the life of the server), and a good export doesn't. And two stages opened at once, or one opened during
// an export, never mix their layers. A stand-in ComfyUI and routes that fail or wait on demand.
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
const png = (w, h, px) => {                                       // a PNG, with no library
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const o = y * (w * 4 + 1) + 1 + x * 4, p = px(x, y); raw[o] = p[0]; raw[o + 1] = p[1]; raw[o + 2] = p[2]; raw[o + 3] = p[3]; }
  const chunk = (t, d) => { const b = Buffer.alloc(12 + d.length); b.writeUInt32BE(d.length, 0); b.write(t, 4, "latin1"); d.copy(b, 8); b.writeUInt32BE(zlib.crc32(Buffer.concat([Buffer.from(t, "latin1"), d])) >>> 0, 8 + d.length); return b; };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
};
// two stages: t1 (4:3, two layers) and t2 (2:1, three layers)
const makeStage = (name, W, H, names) => {
  const d = path.join(MEDIA, "valis", "stage", name); fs.mkdirSync(d, {recursive: true});
  const layers = names.map((n, i) => ({name: n, image: `layer_0${i}.png`, depth: `depth_0${i}.png`, z_med: i ? 5 + i : 50, area: i ? .3 : 1,
    bbox: i ? [W >> 2, H >> 2, W - (W >> 2), H - (H >> 2)] : [0, 0, W - 1, H - 1], backdrop: !i}));
  fs.writeFileSync(path.join(d, "stage.json"), JSON.stringify({width: W, height: H, far: 100, layers, source: "test"}));
  layers.forEach((L, i) => {
    fs.writeFileSync(path.join(d, L.image), png(W, H, (x, y) => i ? (x > W / 4 && x < W * 3 / 4 && y > H / 4 && y < H * 3 / 4 ? [200, 60 + 30 * i, 60, 255] : [0, 0, 0, 0]) : [90, 120, 160, 255]));
    fs.writeFileSync(path.join(d, L.depth), png(W, H, () => i ? [3 * i, 0, 0, 255] : [200, 0, 0, 255]));
  });
};
makeStage("t1", 64, 48, ["sky", "front"]);
makeStage("t2", 48, 24, ["far", "mid", "near"]);
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
await page.route("**/valis/stage/list", r => json(r, {stages: [{name: "t1", subfolder: "valis/stage/t1", layers: 2, names: ["sky", "front"]},
  {name: "t2", subfolder: "valis/stage/t2", layers: 3, names: ["far", "mid", "near"]}]}));
const slow = {t1: 0, rawMs: 0};                                                // t1's pictures arrive late; each frame upload takes a while
await page.route(/\/view\?.*subfolder=valis%2Fstage%2Ft1.*filename=(layer|depth)/, async r => { if (slow.t1) await new Promise(x => setTimeout(x, slow.t1)); return r.continue(); });
const sizes = new Set();
await page.route("**/valis/stage/begin", r => { calls.begin.push(JSON.parse(r.request().postData())); return mode.begin404 ? r.fulfill({status: 404, body: "no"}) : json(r, {ok: true, filename: "move.mp4"}); });
await page.route("**/valis/stage/raw**", async r => { calls.raw++; sizes.add(new globalThis.URL(r.request().url()).search.replace(/job=[^&]*&/, "")); if (slow.rawMs) await new Promise(x => setTimeout(x, slow.rawMs)); return mode.rawFailsAt && calls.raw === mode.rawFailsAt ? r.fulfill({status: 500, body: "boom"}) : json(r, {ok: true, n: calls.raw}); });
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
  if (loaded) {
    const state = () => page.evaluate(() => ({sub: window.valisStage.S.sub, names: window.valisStage.stage.layers.map(l => l.name), cw: document.querySelector("#st-canvas").width,
      picker: document.querySelector("#sg-open").disabled}));
    // two stages opened at once, the first one's pictures late: the last one asked for is what's on screen, whole
    reset(); slow.t1 = 400;
    await page.evaluate(() => { window.valisStage.open("valis/stage/t1").catch(() => {}); window.valisStage.open("valis/stage/t2"); });
    await page.waitForFunction(() => window.valisStage.S.sub === "valis/stage/t2", null, {timeout: 10000}).catch(() => {});
    await page.waitForTimeout(900);                                            // (and past the late one)
    let st = await state();
    ok(st.sub === "valis/stage/t2" && st.names.join() === "far,mid,near", "two opens at once: the last one is on screen, whole", JSON.stringify(st));
    slow.t1 = 0;
    // a stage opened during an export waits for it: the video is the stage it began with, and then the new one opens
    await page.evaluate(() => window.valisStage.open("valis/stage/t1")); await page.waitForTimeout(300);
    reset(); sizes.clear(); slow.rawMs = 60;
    await page.evaluate(() => { window.valisStage.S.sec = 1; document.querySelector("#st-export").click(); });
    await page.waitForFunction(() => document.querySelector("#st-export").disabled, null, {timeout: 5000});
    while (calls.raw < 4) await page.waitForTimeout(30);
    await page.evaluate(() => { window.__opened = window.valisStage.open("valis/stage/t2").then(() => true); });
    await page.waitForTimeout(400);
    st = await state();
    ok(st.sub === "valis/stage/t1" && st.names.join() === "sky,front" && st.cw === 1440 && st.picker, "an open during an export waits: the export's stage stays on screen", JSON.stringify(st));
    await page.waitForFunction(() => !document.querySelector("#st-export").disabled, null, {timeout: 20000});
    await page.waitForFunction(() => window.__opened, null, {timeout: 10000});
    st = await state();
    ok(calls.raw === 24 && sizes.size === 1 && calls.finish === 1 && calls.abort.length === 0, "the export finished whole, every frame the same size", JSON.stringify({raw: calls.raw, sizes: [...sizes], fin: calls.finish}));
    ok(st.sub === "valis/stage/t2" && st.names.join() === "far,mid,near" && !st.picker, "and then the stage opened", JSON.stringify(st));
    slow.rawMs = 0;
  }
  ok(!errors.length, "no errors in the page", errors.slice(0, 5).join(" | "));
} finally {
  await browser.close(); srv.kill();
}
console.log(`${pass} passed, ${fail} failed`);
if (fail) { console.log(fails.join("\n")); process.exit(1); }
