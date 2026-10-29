// Stage's controls under a click: a "then" move's start box keeps the focus when it is clicked (the row used to be rebuilt under
// the click), "Try another seed" pressed during a Make starts no second set and leaves the button as it was, a second dropped
// song stops the first, and choosing a move while it plays starts no second play loop.
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
const PORT = 8396, URL = `http://localhost:${PORT}/valis`;
const MEDIA = fs.mkdtempSync(path.join(os.tmpdir(), "valis-media-"));
const png = (w, h, px) => {                                       // a PNG, with no library
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const o = y * (w * 4 + 1) + 1 + x * 4, p = px(x, y); raw[o] = p[0]; raw[o + 1] = p[1]; raw[o + 2] = p[2]; raw[o + 3] = p[3]; }
  const chunk = (t, d) => { const b = Buffer.alloc(12 + d.length); b.writeUInt32BE(d.length, 0); b.write(t, 4, "latin1"); d.copy(b, 8); b.writeUInt32BE(zlib.crc32(Buffer.concat([Buffer.from(t, "latin1"), d])) >>> 0, 8 + d.length); return b; };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
};
{ // one stage, two layers
  const W = 64, H = 48, d = path.join(MEDIA, "valis", "stage", "t1"); fs.mkdirSync(d, {recursive: true});
  const layers = ["sky", "front"].map((n, i) => ({name: n, image: `layer_0${i}.png`, depth: `depth_0${i}.png`, z_med: i ? 6 : 50, area: i ? .3 : 1,
    bbox: i ? [W >> 2, H >> 2, W - (W >> 2), H - (H >> 2)] : [0, 0, W - 1, H - 1], backdrop: !i}));
  fs.writeFileSync(path.join(d, "stage.json"), JSON.stringify({width: W, height: H, far: 100, layers, source: "test"}));
  layers.forEach((L, i) => {
    fs.writeFileSync(path.join(d, L.image), png(W, H, (x, y) => i ? (x > W / 4 && x < W * 3 / 4 && y > H / 4 && y < H * 3 / 4 ? [200, 90, 60, 255] : [0, 0, 0, 0]) : [90, 120, 160, 255]));
    fs.writeFileSync(path.join(d, L.depth), png(W, H, () => i ? [3, 0, 0, 255] : [200, 0, 0, 255]));
  });
}
const srv = spawn(process.execPath, [path.join(here, "mock_server.mjs"), String(PORT), "--media", MEDIA], {stdio: ["ignore", "pipe", "inherit"]});
await new Promise(r => srv.stdout.once("data", r));
let pass = 0, fail = 0; const fails = [];
const ok = (c, name, d = "") => { if (c) pass++; else { fail++; fails.push(`${name}${d ? ": " + d : ""}`); } };
const browser = await chromium.launch({args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"]});
const ctx = await browser.newContext({viewport: {width: 1440, height: 900}});
await ctx.addInitScript(() => {
  try { localStorage.setItem("valis.extras", "stage"); } catch { /* */ }
  // what plays is noted, not played; each animation frame notes how many callbacks it ran (one per play loop)
  HTMLMediaElement.prototype.play = function () { this.__on = true; return Promise.resolve(); };
  HTMLMediaElement.prototype.pause = function () { this.__on = false; };
  window.__raf = new Map();
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) => raf((ts) => { window.__raf.set(ts, (window.__raf.get(ts) || 0) + 1); cb(ts); });
});
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", e => errors.push(e.message));
page.on("console", m => { if (m.type() === "error" && !/Failed to load resource|WebSocket|status of 500|status of 404/.test(m.text())) errors.push(m.text()); });
const json = (route, body, status = 200) => route.fulfill({status, contentType: "application/json", body: JSON.stringify(body)});
await page.route("**/valis/stage/list", r => json(r, {stages: [{name: "t1", subfolder: "valis/stage/t1", layers: 2, names: ["sky", "front"]}]}));
await page.route("**/valis/stage/cues", r => json(r, {lanes: {kick: [0.5, 1.5]}, wave: [0.2, 0.4, 0.3], duration: 2}));
const wav = Buffer.alloc(44 + 800); wav.write("RIFF", 0); wav.writeUInt32LE(36 + 800, 4); wav.write("WAVEfmt ", 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20);
wav.writeUInt16LE(1, 22); wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write("data", 36); wav.writeUInt32LE(800, 40);
page.setDefaultTimeout(5000); page.setDefaultNavigationTimeout(30000);
// a section that throws (a control that isn't there, a click that never lands) is a failed check, and the next one starts from the Stage tab
const section = async (name, fn) => {
  await page.evaluate(() => document.querySelector('.tab[data-view="extras"]').click()).catch(() => {});
  try { await fn(); } catch (e) { ok(false, `${name} threw`, String(e.message).split("\n")[0]); }
};
try {
  await page.goto(`${URL}#extras`); await page.waitForTimeout(1500);
  await page.click('.tab[data-view="extras"]'); await page.waitForTimeout(800);
  await page.selectOption("#sg-open", "valis/stage/t1");
  await page.waitForFunction(() => document.querySelector("#st-canvas")?.style.display === "block", null, {timeout: 15000}).catch(() => {});
  const loaded = await page.evaluate(() => document.querySelector("#st-canvas")?.style.display === "block");
  ok(loaded, "the stage opened (WebGL2 in this browser)");
  if (loaded) {
    // ---- the start box of a "then" move keeps the focus when it is clicked (the active row, and another one)
    await section("the then rows", async () => {
    await page.click("#sg-addthen"); await page.click("#sg-addthen");
    const box = (i) => `#sg-then .maprow:nth-child(${i}) input[type=number]`;
    const focused = () => page.evaluate(() => { const a = document.activeElement; return a?.type === "number" && !!a.closest("#sg-then") ? [...document.querySelectorAll("#sg-then .maprow")].indexOf(a.closest(".maprow")) + 1 : 0; });
    await page.click(box(2));
    ok(await focused() === 2, "a click in the active row's start box leaves it focused", String(await focused()));
    await page.click(box(1));
    ok(await focused() === 1, "a click in another row's start box leaves it focused", String(await focused()));
    ok(await page.evaluate(() => window.valisStage.S.active) === 1 && await page.$$eval("#sg-then .maprow", rs => rs.map(r => r.classList.contains("on")).join()) === "true,false", "and that row is the one chosen");
    await page.keyboard.press("Control+A"); await page.keyboard.type("2.25"); await page.keyboard.press("Tab");
    ok(await page.evaluate(() => window.valisStage.S.then[0].start) === 2.25, "so what is typed there is the start", String(await page.evaluate(() => window.valisStage.S.then[0].start)));
    await page.click(`#sg-then .maprow:nth-child(2) select`); await page.keyboard.press("Escape");
    ok(await page.evaluate(() => window.valisStage.S.active) === 2, "a click on another row's menu chooses that row");
    });

    // ---- Make, and "Try another seed" pressed while it makes
    await section("Make", async () => {
    await page.evaluate(() => {
      const v = window.valisStage; window.__made = []; window.__done = [];
      v.caps = async () => ({}); v.listStages = async () => {}; v.open = async () => {};
      v.api = {...v.api, submit: async (g, label) => { window.__made.push(label); return {id: `j${window.__made.length}`}; }};
      v.G = {...v.G, stage: (o) => ({seed: o.seed})};
      v.until = () => new Promise(r => window.__done.push(r));
    });
    await page.fill("#sg-prompt", "a lighthouse in fog");
    const label = await page.$eval("#sg-make", b => b.innerHTML), seed0 = await page.$eval("#st-seed", i => i.value);
    await page.click("#sg-make"); await page.waitForFunction(() => window.__made.length === 1);
    ok(await page.$eval("#sg-make", b => b.disabled && b.textContent === "Making the set…"), "Make says it is making");
    await page.evaluate(() => document.querySelector("#st-reseed").click());       // pressed during the make
    await page.waitForTimeout(300);
    ok(await page.evaluate(() => window.__made.length) === 1, "Try another seed during a make starts no second set", String(await page.evaluate(() => window.__made.length)));
    ok(await page.$eval("#st-seed", i => i.value) === seed0, "and leaves the seed alone", await page.$eval("#st-seed", i => i.value));
    await page.evaluate(() => window.__done.forEach(r => r()));
    await page.waitForFunction(() => !document.querySelector("#sg-make").disabled, null, {timeout: 5000}).catch(() => {});
    await page.waitForTimeout(200);
    ok(await page.$eval("#sg-make", b => !b.disabled && b.innerHTML) === label, "the Make button is back as it was", await page.$eval("#sg-make", b => b.innerHTML));
    ok(await page.$eval("#st-reseed", b => !b.disabled), "and so is Try another seed");
    await page.click("#st-reseed"); await page.waitForFunction(() => window.__made.length === 2, null, {timeout: 5000}).catch(() => {});
    const seed1 = await page.$eval("#st-seed", i => i.value);
    ok(await page.evaluate(() => window.__made.length) === 2 && seed1 !== seed0 && (await page.evaluate(() => window.__made[1])).includes(`seed ${seed1}`), "pressed on its own it makes a set with a new seed", `${seed1} ${await page.evaluate(() => window.__made[1])}`);
    await page.evaluate(() => window.__done.forEach(r => r()));
    await page.waitForTimeout(200);
    });

    // ---- a second dropped song stops the first
    await section("the second song", async () => {
    // dropped on the zone (it takes its file input out once a song is in, so a second one can only be dropped)
    const drop = (name) => page.evaluate(([name, b64]) => {
      const dt = new DataTransfer(); dt.items.add(new File([Uint8Array.from(atob(b64), c => c.charCodeAt(0))], name, {type: "audio/wav"}));
      document.querySelector("#st-audio").dispatchEvent(new DragEvent("drop", {dataTransfer: dt, bubbles: true, cancelable: true}));
    }, [name, wav.toString("base64")]);
    await drop("first.wav");
    await page.waitForFunction(() => window.valisStage.player && window.valisStage.S.cues, null, {timeout: 5000});
    await page.evaluate(() => { window.__first = window.valisStage.player; window.valisStage.play(); });
    ok(await page.evaluate(() => window.__first.__on === true && window.valisStage.S.playing), "the first song plays");
    await drop("second.wav");
    await page.waitForFunction(() => window.valisStage.player !== window.__first, null, {timeout: 5000});
    ok(await page.evaluate(() => window.__first.__on === false), "a second dropped song stops the first");
    ok(await page.evaluate(() => !window.valisStage.S.playing) && await page.$eval("#st-play", b => b.textContent === "Play"), "and the Play button says Play");
    ok(await page.evaluate(() => !!window.valisStage.player && window.valisStage.player !== window.__first && window.valisStage.S.audioName.endsWith("second.wav")), "the second is the song now");
    });

    // ---- choosing a move while it plays starts no second play loop
    await section("the play loop", async () => {
    await page.evaluate(() => { const v = window.valisStage; v.S.sec = 12; v.S.T = 0; v.play(); });
    const perFrame = async () => { await page.evaluate(() => window.__raf.clear()); await page.waitForTimeout(500); return page.evaluate(() => Math.max(0, ...window.__raf.values())); };
    const one = await perFrame();
    for (let i = 2; i <= 6; i++) await page.click(`#sg-moves .chip:nth-child(${i})`);
    await page.waitForTimeout(150);                                                // (the frame the last loop was already waiting for)
    const after = await perFrame();
    ok(one >= 1 && after === one && await page.evaluate(() => window.valisStage.S.playing), "five moves chosen while playing: still one callback a frame", `${one} before, ${after} after`);
    await page.evaluate(() => { window.valisStage.S.playing = false; });
    await page.waitForTimeout(200);
    ok(await perFrame() <= Math.max(0, one - 1), "and pausing stops it");
    });
  }
  ok(!errors.length, "no errors in the page", errors.slice(0, 5).join(" | "));
} finally {
  await browser.close(); srv.kill();
}
console.log(`${pass} passed, ${fail} failed`);
if (fail) { console.log(fails.join("\n")); process.exit(1); }
