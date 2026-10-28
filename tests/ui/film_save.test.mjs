// Film tab saves: opening a film keeps its shot length (#1), a song of your own survives a reload (#2), and a save
// waiting when you switch films lands in the film it belongs to (#3).
import {spawn} from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import {fileURLToPath} from "node:url";
import {createRequire} from "node:module";

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const {chromium} = require("playwright");
const PORT = 8391, URL = `http://localhost:${PORT}/valis`;
const USER = fs.mkdtempSync(path.join(os.tmpdir(), "valis-user-"));
const srv = spawn(process.execPath, [path.join(here, "mock_server.mjs"), String(PORT), "--user", USER], {stdio: ["ignore", "pipe", "inherit"]});
await new Promise(r => srv.stdout.once("data", r));
let pass = 0, fail = 0; const fails = [];
const ok = (c, name, d = "") => { if (c) pass++; else { fail++; fails.push(`${name}${d ? ": " + d : ""}`); } };
const films = () => Object.fromEntries((fs.existsSync(path.join(USER, "valis/films")) ? fs.readdirSync(path.join(USER, "valis/films")) : [])
  .map(f => [f.replace(/\.json$/, ""), JSON.parse(fs.readFileSync(path.join(USER, "valis/films", f), "utf8"))]));
const byTitle = (t) => Object.values(films()).find(f => f.title === t);
const browser = await chromium.launch();
const page = await browser.newPage({viewport: {width: 1440, height: 900}});
const errors = [];
page.on("pageerror", e => errors.push(e.message));
page.on("console", m => { if (m.type() === "error" && !/Failed to load resource|WebSocket/.test(m.text())) errors.push(m.text()); });
const slide = (sel, v) => page.$eval(sel, (i, v) => { i.value = v; i.dispatchEvent(new Event("input")); }, v);
const title = async (t) => { await page.fill("#m-planbox .ptitle input.title", t); };
const blank = async (t) => { await page.click("#m-blank"); await page.waitForTimeout(150); await title(t); await page.waitForTimeout(900); };
const open = async (t) => { await page.click(`#m-recent .chip:has-text("${t}")`); await page.waitForTimeout(500); };
try {
  await page.goto(`${URL}#film`); await page.waitForTimeout(1200);
  await page.click('.tab[data-view="film"]'); await page.waitForTimeout(300);

  // ---- #1: a film at 8 s a shot, reopened after a reload, is still 8 s
  await blank("Eight seconds");
  await slide("#m-len input[type=range]", 8); await page.waitForTimeout(900);
  ok(byTitle("Eight seconds")?.shotSeconds === 8, "#1: the film saved at 8 s", String(byTitle("Eight seconds")?.shotSeconds));
  await page.reload(); await page.waitForTimeout(1200);
  await page.click('.tab[data-view="film"]'); await page.waitForTimeout(500);
  await open("Eight seconds"); await page.waitForTimeout(1200);
  ok(/× 8\.0 s/.test(await page.$eval("#m-sec-shape .val", e => e.textContent)), "#1: the shape line says 8.0 s", await page.$eval("#m-sec-shape .val", e => e.textContent));
  ok(byTitle("Eight seconds")?.shotSeconds === 8, "#1: opening it left the saved length at 8 s", String(byTitle("Eight seconds")?.shotSeconds));
  ok(Number(await page.$eval("#m-len input[type=range]", i => i.value)) === 8, "#1: the slider sits at 8");
  // a length the slider can't hit (half-second steps) is kept exactly
  await slide("#m-len input[type=range]", 7.5); await page.waitForTimeout(900);
  const f = films(), tag = Object.keys(f).find(k => f[k].title === "Eight seconds");
  fs.writeFileSync(path.join(USER, "valis/films", `${tag}.json`), JSON.stringify({...f[tag], shotSeconds: 7.3}));
  await page.reload(); await page.waitForTimeout(1200); await page.click('.tab[data-view="film"]'); await page.waitForTimeout(400);
  await open("Eight seconds"); await page.waitForTimeout(1200);
  ok(films()[tag].shotSeconds === 7.3, "#1: a length between the slider's steps is kept as it is", String(films()[tag].shotSeconds));

  // ---- #3: a save waiting when you switch films is written to its own film
  await blank("Film B");
  await open("Film B"); await page.waitForTimeout(300);
  await open("Eight seconds"); await page.waitForTimeout(300);
  await title("Eight seconds EDITED");                      // a save is now waiting (600 ms)…
  await page.click('#m-recent .chip:has-text("Film B")');   // …and Film B opens at once
  await page.waitForTimeout(2000);
  ok(byTitle("Eight seconds EDITED"), "#3: the edit waiting when you switched landed in its own film", Object.values(films()).map(x => x.title).join(" | "));
  ok(byTitle("Film B") && !/EDITED/.test(byTitle("Film B").title), "#3: Film B's file still holds Film B", Object.values(films()).map(x => x.title).join(" | "));
  ok(Object.values(films()).filter(x => x.title === "Film B").length === 1, "#3: there is one Film B");

  // ---- #2: your own song is still there after a reload
  await page.$$eval("#view-film details", ds => ds.forEach(d => { d.open = true; }));
  await page.click('#m-song-src button[data-id="own"]'); await page.waitForTimeout(200);
  const wav = Buffer.alloc(44 + 4000); wav.write("RIFF", 0); wav.writeUInt32LE(36 + 4000, 4); wav.write("WAVEfmt ", 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22); wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write("data", 36); wav.writeUInt32LE(4000, 40);
  for (let i = 0; i < 2000; i++) wav.writeInt16LE(Math.round(8000 * Math.sin(i / 5)), 44 + 2 * i);
  await page.setInputFiles("#m-song-drop input[type=file]", {name: "my song.wav", mimeType: "audio/wav", buffer: wav});
  await page.waitForTimeout(1500);
  const saved = byTitle("Film B");
  ok(saved?.song?.file?.__kept?.name === "my song.wav", "#2: the plan saves a pointer to the song", JSON.stringify(saved?.song));
  ok(saved?.song?.fileName === "my song.wav", "#2: and its name");
  const kept = saved?.song?.file?.__kept?.path;
  ok(kept && fs.existsSync(path.join(USER, kept)) && fs.statSync(path.join(USER, kept)).size === wav.length, "#2: the song's bytes are in the user folder", String(kept));
  const up0 = (await (await fetch(`http://localhost:${PORT}/__uploads`)).json()).length;
  await page.reload(); await page.waitForTimeout(1200); await page.click('.tab[data-view="film"]'); await page.waitForTimeout(500);
  await open("Film B"); await page.waitForTimeout(1500);
  const ups = await (await fetch(`http://localhost:${PORT}/__uploads`)).json();
  ok(ups.length === up0 + 1 && ups.at(-1).file_path === "my song.wav", "#2: opening the film uploaded the song again", JSON.stringify(ups.slice(-2)));
  ok(/my song\.wav/.test(await page.$eval("#m-song-drop", e => e.textContent)) && await page.$("#m-song-drop audio"), "#2: the Song section shows it");
  ok(/my song\.wav/.test(await page.$eval("#m-planbox", e => e.textContent)), "#2: the plan names it");
  // saved again, it still points at the song
  await title("Film B again"); await page.waitForTimeout(1000);
  ok(byTitle("Film B again")?.song?.file?.__kept?.path === kept, "#2: saved after a reopen it still points at the song", JSON.stringify(byTitle("Film B again")?.song));
  ok(!errors.length, "no errors in the page", errors.slice(0, 5).join(" | "));
} finally {
  await browser.close(); srv.kill();
}
console.log(`${pass} passed, ${fail} failed`);
if (fail) { console.log(fails.join("\n")); process.exit(1); }
