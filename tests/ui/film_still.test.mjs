// A still dropped on Create from disk can be sent to a Film shot (#19): the plan holds a file ComfyUI has (an input
// file), never the dropped file's blob: URL or its upload handle.
import {spawn} from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import {fileURLToPath} from "node:url";
import {createRequire} from "node:module";

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const {chromium} = require("playwright");
const PORT = 8394, URL = `http://localhost:${PORT}/valis`;
const USER = fs.mkdtempSync(path.join(os.tmpdir(), "valis-user-"));
const srv = spawn(process.execPath, [path.join(here, "mock_server.mjs"), String(PORT), "--user", USER], {stdio: ["ignore", "pipe", "inherit"]});
await new Promise(r => srv.stdout.once("data", r));
let pass = 0, fail = 0; const fails = [];
const ok = (c, name, d = "") => { if (c) pass++; else { fail++; fails.push(`${name}${d ? ": " + d : ""}`); } };
const films = () => Object.values(fs.existsSync(path.join(USER, "valis/films")) ? Object.fromEntries(fs.readdirSync(path.join(USER, "valis/films"))
  .map(f => [f, JSON.parse(fs.readFileSync(path.join(USER, "valis/films", f), "utf8"))])) : {});
const images = async () => (await fetch(`http://localhost:${PORT}/__images`)).json();
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const browser = await chromium.launch();
const page = await browser.newPage({viewport: {width: 1440, height: 900}});
const errors = [];
page.on("pageerror", e => errors.push(e.message));
page.on("console", m => { if (m.type() === "error" && !/Failed to load resource|WebSocket/.test(m.text())) errors.push(m.text()); });
const toCreate = async () => { await page.click('#m-shots .fshot button:has-text("Create ↗")'); await page.waitForTimeout(400); };
const useStill = async () => { await page.click('#c-film-return button:has-text("Use the picked still")'); await page.waitForTimeout(1500); };
try {
  await page.goto(`${URL}#film`); await page.waitForTimeout(1200);
  await page.click('.tab[data-view="film"]'); await page.waitForTimeout(300);
  await page.click("#m-blank"); await page.waitForTimeout(150);
  await page.fill("#m-planbox .ptitle input.title", "Still film"); await page.waitForTimeout(900);

  // a still from disk dropped on Create, then sent to the shot
  await toCreate();
  await page.setInputFiles("#c-viewer input[type=file]", {name: "mine.png", mimeType: "image/png", buffer: PNG}); await page.waitForTimeout(800);
  ok(await page.$('#c-strip .thumb:has-text("your still")'), "the dropped still is in the strip");
  const up0 = (await images()).length;
  await useStill();
  ok(await page.isVisible("#m-shots .fshot"), "Film is showing again");
  const key = () => films().find(f => f.title === "Still film")?.shots?.[0]?.key;
  ok(JSON.stringify(key()) === JSON.stringify({filename: "mine.png", subfolder: "valis_refs", type: "input"}), "the shot holds an input file", JSON.stringify(key()));
  const text = JSON.stringify(films().find(f => f.title === "Still film"));
  ok(!/blob:|"ref"|"url"/.test(text), "the saved film holds no blob: URL or upload handle", text.slice(0, 300));
  const imgs = await images();
  ok(imgs.length === up0 + 1 && imgs.at(-1).subfolder === "valis_refs" && imgs.at(-1).type === "input" && imgs.at(-1).name === "mine.png", "the still went into ComfyUI's input folder", JSON.stringify(imgs));
  const src = await page.$eval("#m-shots .fshot .fmedia img", i => i.getAttribute("src"));
  ok(/filename=mine\.png/.test(src) && /type=input/.test(src) && /subfolder=valis_refs/.test(src), "the shot's keyframe is shown from /view", src);

  // sent again, the same still is not uploaded twice
  await toCreate();
  await page.click('#c-strip .thumb:has-text("your still")'); await page.waitForTimeout(200);
  await useStill();
  ok((await images()).length === up0 + 1, "the same still is uploaded once", String((await images()).length - up0));
  ok(JSON.stringify(key()) === JSON.stringify({filename: "mine.png", subfolder: "valis_refs", type: "input"}), "and the shot still holds it", JSON.stringify(key()));

  // after a reload the film opens with the still
  await page.reload(); await page.waitForTimeout(1200); await page.click('.tab[data-view="film"]'); await page.waitForTimeout(400);
  await page.click('#m-recent .chip:has-text("Still film")'); await page.waitForTimeout(800);
  const src2 = await page.$eval("#m-shots .fshot .fmedia img", i => i.getAttribute("src")).catch(() => "");
  ok(/filename=mine\.png/.test(src2), "reopened, the film shows the still", src2);
  ok(!errors.length, "no errors in the page", errors.slice(0, 5).join(" | "));
} finally {
  await browser.close(); srv.kill();
}
console.log(`${pass} passed, ${fail} failed`);
if (fail) { console.log(fails.join("\n")); process.exit(1); }
